#include "ConfigStore.h"

#include <ArduinoJson.h>
#include <LittleFS.h>
#include <string.h>

namespace {

const char* kPath = "/pomo_config.json";
const char* kTmpPath = "/pomo_config.tmp";
const char* kTimerPath = "/pomo_timer.json";
const char* kTimerTmpPath = "/pomo_timer.tmp";
bool gFsMounted = false;

bool ensureFs() {
  if (gFsMounted) return true;
  // formatOnFail so a first boot or corrupt FS still works.
  if (!LittleFS.begin()) {
    Serial.println("[ConfigStore] LittleFS mount failed, formatting");
    if (!LittleFS.format() || !LittleFS.begin()) {
      Serial.println("[ConfigStore] LittleFS format/remount failed");
      return false;
    }
  }
  gFsMounted = true;
  return true;
}

bool writeFileAtomic(const char* path, const char* tmpPath, const JsonDocument& doc) {
  File f = LittleFS.open(tmpPath, "w");
  if (!f) {
    Serial.printf("[ConfigStore] tmp open failed %s\n", tmpPath);
    return false;
  }
  const size_t n = serializeJson(doc, f);
  f.close();
  if (n == 0) {
    Serial.println("[ConfigStore] tmp write empty");
    LittleFS.remove(tmpPath);
    return false;
  }
  // LittleFS rename fails if the destination already exists.
  if (LittleFS.exists(path)) {
    LittleFS.remove(path);
  }
  if (!LittleFS.rename(tmpPath, path)) {
    Serial.printf("[ConfigStore] rename %s -> %s failed\n", tmpPath, path);
    LittleFS.remove(tmpPath);
    return false;
  }
  return true;
}

void copyBounded(char* dest, size_t destSize, const char* src) {
  if (destSize == 0) return;
  if (src == nullptr) {
    dest[0] = '\0';
    return;
  }
  strncpy(dest, src, destSize - 1);
  dest[destSize - 1] = '\0';
}

bool statusIsLive(const char* status) {
  return status != nullptr &&
         (strcmp(status, "running") == 0 || strcmp(status, "paused") == 0);
}

bool phaseIsValid(const char* phase) {
  return phase != nullptr &&
         (strcmp(phase, "work") == 0 || strcmp(phase, "short") == 0 ||
          strcmp(phase, "long") == 0);
}

}  // namespace

bool ConfigStore::begin() {
  fsReady_ = ensureFs();
  if (fsReady_) load();
  return fsReady_;
}

void ConfigStore::load() {
  if (!ensureFs()) {
    fsReady_ = false;
    return;
  }
  fsReady_ = true;

  if (!LittleFS.exists(kPath)) {
    Serial.println("[ConfigStore] no file, using defaults");
    return;
  }

  File f = LittleFS.open(kPath, "r");
  if (!f) {
    Serial.println("[ConfigStore] open failed");
    return;
  }

  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, f);
  f.close();
  if (err) {
    Serial.printf("[ConfigStore] parse failed: %s\n", err.c_str());
    return;
  }

  const int work = doc["work"] | workMinutes_;
  const int shortM = doc["short"] | shortMinutes_;
  const int longM = doc["long"] | longMinutes_;
  const int longAfter = doc["long_after"] | longAfter_;
  const int goal = doc["goal"] | goal_;
  setDurations(work, shortM, longM, longAfter, goal);

  // Persist wall-clock seconds only. Never restore a raw millis sample from a
  // previous boot — millis() restarts at 0 and unsigned subtraction would jump
  // estimateEpochNow() by ~49 days, poisoning offline session starts.
  if (!doc["epoch"].isNull()) {
    const long savedWall = doc["epoch"] | 0L;
    if (savedWall > 0) {
      epochSec_ = savedWall;
      epochMillisAt_ = millis();
      hasEpoch_ = true;
    }
  }

  nextClientSeq_ = doc["next_seq"] | 1;
  if (nextClientSeq_ == 0) nextClientSeq_ = 1;

  Serial.printf("[ConfigStore] loaded work=%d short=%d long=%d longAfter=%d goal=%d epoch=%ld seq=%u\n",
                workMinutes_, shortMinutes_, longMinutes_, longAfter_, goal_,
                hasEpoch_ ? epochSec_ : 0L, nextClientSeq_);
}

bool ConfigStore::save() const {
  if (!ensureFs()) return false;

  JsonDocument doc;
  doc["work"] = workMinutes_;
  doc["short"] = shortMinutes_;
  doc["long"] = longMinutes_;
  doc["long_after"] = longAfter_;
  doc["goal"] = goal_;
  doc["next_seq"] = nextClientSeq_;
  if (hasEpoch_) {
    // Wall seconds at save time only. On load we re-anchor at current millis()
    // so clock freezes across power-off instead of wrapping.
    doc["epoch"] = estimateEpochNow();
  }

  return writeFileAtomic(kPath, kTmpPath, doc);
}

void ConfigStore::setDurations(int workMinutes, int shortMinutes, int longMinutes,
                               int longAfter, int goal) {
  if (workMinutes > 0) workMinutes_ = workMinutes;
  if (shortMinutes > 0) shortMinutes_ = shortMinutes;
  if (longMinutes > 0) longMinutes_ = longMinutes;
  if (longAfter > 0) longAfter_ = longAfter;
  // daily_goal may be 0 on the phone
  if (goal >= 0) goal_ = goal;
}

void ConfigStore::setEpochBasis(long epochSec, unsigned long millisAt) {
  if (epochSec <= 0) return;
  epochSec_ = epochSec;
  epochMillisAt_ = millisAt;
  hasEpoch_ = true;
}

long ConfigStore::estimateEpochNow() const {
  if (!hasEpoch_) return 0;
  // Unsigned millis subtraction is correct across rollover.
  const unsigned long elapsedMs = millis() - epochMillisAt_;
  return epochSec_ + (long)(elapsedMs / 1000UL);
}

uint16_t ConfigStore::takeNextClientSeq() {
  const uint16_t seq = nextClientSeq_;
  nextClientSeq_++;
  if (nextClientSeq_ == 0) nextClientSeq_ = 1;
  return seq;
}

bool ConfigStore::loadTimerSnapshot(TimerSnapshot* out) const {
  if (out == nullptr) return false;
  memset(out, 0, sizeof(*out));
  if (!ensureFs()) return false;

  // Prefer committed path; if missing after power loss mid-rename (writeFileAtomic
  // removes dest then renames tmp), recover from temp like SessionQueue::load.
  const char* path = nullptr;
  if (LittleFS.exists(kTimerPath)) {
    path = kTimerPath;
  } else if (LittleFS.exists(kTimerTmpPath)) {
    Serial.println("[ConfigStore] timer committed missing, trying temp");
    path = kTimerTmpPath;
  } else {
    Serial.println("[ConfigStore] no timer snapshot");
    return false;
  }

  File f = LittleFS.open(path, "r");
  if (!f) {
    Serial.println("[ConfigStore] timer snapshot open failed");
    return false;
  }

  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, f);
  f.close();
  if (err) {
    Serial.printf("[ConfigStore] timer snapshot parse failed: %s\n", err.c_str());
    return false;
  }

  const char* status = doc["status"] | "";
  const char* phase = doc["phase"] | "";
  if (!statusIsLive(status) || !phaseIsValid(phase)) {
    Serial.printf("[ConfigStore] timer snapshot invalid status/phase (%s/%s)\n",
                  status, phase);
    return false;
  }

  const double remaining = doc["remaining"] | -1.0;
  const double duration = doc["duration"] | -1.0;
  if (remaining < 0.0 || duration <= 0.0) {
    Serial.println("[ConfigStore] timer snapshot bad remaining/duration");
    return false;
  }

  copyBounded(out->status, sizeof(out->status), status);
  copyBounded(out->phase, sizeof(out->phase), phase);
  out->remaining = remaining;
  out->duration = duration;
  out->startTime = doc["start_time"] | 0.0;
  out->completed = doc["completed"] | 0;
  if (out->completed < 0) out->completed = 0;
  out->goal = doc["goal"] | goal_;
  if (out->goal < 0) out->goal = 0;
  out->savedEpoch = doc["saved_epoch"] | 0L;
  if (out->savedEpoch < 0) out->savedEpoch = 0;

  // Promote a recovered temp into the committed path so the next boot is clean.
  if (path == kTimerTmpPath) {
    if (LittleFS.exists(kTimerPath)) LittleFS.remove(kTimerPath);
    if (LittleFS.rename(kTimerTmpPath, kTimerPath)) {
      Serial.println("[ConfigStore] timer snapshot promoted temp to committed");
    }
  }

  Serial.printf(
      "[ConfigStore] timer snapshot loaded status=%s phase=%s rem=%.0f dur=%.0f "
      "completed=%d start=%.0f saved_epoch=%ld\n",
      out->status, out->phase, out->remaining, out->duration, out->completed,
      out->startTime, out->savedEpoch);
  return true;
}

bool ConfigStore::saveTimerSnapshot(const TimerSnapshot& snap) const {
  if (!ensureFs()) return false;
  if (!statusIsLive(snap.status) || !phaseIsValid(snap.phase)) {
    Serial.println("[ConfigStore] refuse to save non-live timer snapshot");
    return false;
  }
  if (snap.remaining < 0.0 || snap.duration <= 0.0) {
    Serial.println("[ConfigStore] refuse to save bad remaining/duration");
    return false;
  }

  JsonDocument doc;
  doc["status"] = snap.status;
  doc["phase"] = snap.phase;
  doc["remaining"] = snap.remaining;
  doc["duration"] = snap.duration;
  doc["start_time"] = snap.startTime;
  doc["completed"] = snap.completed < 0 ? 0 : snap.completed;
  doc["goal"] = snap.goal < 0 ? 0 : snap.goal;
  if (snap.savedEpoch > 0) {
    doc["saved_epoch"] = snap.savedEpoch;
  }

  const bool ok = writeFileAtomic(kTimerPath, kTimerTmpPath, doc);
  if (!ok) {
    Serial.println("[ConfigStore] timer snapshot save failed");
  }
  return ok;
}

bool ConfigStore::clearTimerSnapshot() const {
  if (!ensureFs()) return false;
  if (!LittleFS.exists(kTimerPath) && !LittleFS.exists(kTimerTmpPath)) {
    return true;
  }
  bool ok = true;
  if (LittleFS.exists(kTimerPath) && !LittleFS.remove(kTimerPath)) {
    Serial.println("[ConfigStore] timer snapshot remove failed");
    ok = false;
  }
  if (LittleFS.exists(kTimerTmpPath)) {
    LittleFS.remove(kTimerTmpPath);
  }
  if (ok) {
    Serial.println("[ConfigStore] timer snapshot cleared");
  }
  return ok;
}
