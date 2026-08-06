#include "SessionQueue.h"

#include <ArduinoJson.h>
#include <LittleFS.h>
#include <string.h>

namespace {

const char* kPath = "/pomo_sessions.json";
const char* kTmpPath = "/pomo_sessions.tmp";
bool gFsMounted = false;

bool ensureFs() {
  if (gFsMounted) return true;
  if (!LittleFS.begin()) {
    Serial.println("[SessionQueue] LittleFS mount failed");
    return false;
  }
  gFsMounted = true;
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

bool typeIsValid(const char* type) {
  return type != nullptr &&
         (strcmp(type, "work") == 0 || strcmp(type, "short") == 0 ||
          strcmp(type, "long") == 0);
}

}  // namespace

bool SessionQueue::begin() {
  fsReady_ = ensureFs();
  if (fsReady_) load();
  return fsReady_;
}

void SessionQueue::load() {
  count_ = 0;
  if (!ensureFs()) {
    fsReady_ = false;
    return;
  }
  fsReady_ = true;

  // Prefer the committed file; if it is missing but a temp survived a crash
  // mid-rename, try the temp (rename may have been interrupted after write).
  const char* path = nullptr;
  if (LittleFS.exists(kPath)) {
    path = kPath;
  } else if (LittleFS.exists(kTmpPath)) {
    Serial.println("[SessionQueue] committed file missing, trying temp");
    path = kTmpPath;
  } else {
    Serial.println("[SessionQueue] no file");
    return;
  }

  File f = LittleFS.open(path, "r");
  if (!f) {
    Serial.println("[SessionQueue] open failed");
    return;
  }

  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, f);
  f.close();
  if (err) {
    // Corrupt file: leave count_ at 0 but do not delete — a later successful
    // save overwrites via temp+rename. Silent wipe would lose history.
    Serial.printf("[SessionQueue] parse failed: %s (queue empty until rewrite)\n",
                  err.c_str());
    return;
  }

  JsonArray arr = doc["sessions"].as<JsonArray>();
  if (arr.isNull()) {
    Serial.println("[SessionQueue] missing sessions array");
    return;
  }

  int skipped = 0;
  for (JsonObject row : arr) {
    if (count_ >= kCapacity) {
      skipped++;
      continue;
    }
    const char* clientId = row["client_id"] | "";
    const char* type = row["type"] | "";
    const int duration = row["duration"] | 0;
    if (clientId[0] == '\0' || !typeIsValid(type) || duration <= 0) {
      skipped++;
      continue;
    }

    QueuedSession& s = items_[count_];
    copyBounded(s.clientId, sizeof(s.clientId), clientId);
    copyBounded(s.type, sizeof(s.type), type);
    s.durationSec = duration;
    s.completed = true;
    if (!row["start"].isNull()) {
      const long start = row["start"] | 0L;
      // Reject obviously broken starts; keep the row without start.
      if (start > 0) {
        s.hasStart = true;
        s.start = start;
      } else {
        s.hasStart = false;
        s.start = 0;
      }
    } else {
      s.hasStart = false;
      s.start = 0;
    }
    copyBounded(s.tag, sizeof(s.tag), row["tag"] | "");
    count_++;
  }

  // Promote a recovered temp into the committed path so the next boot is clean.
  if (path == kTmpPath && count_ > 0) {
    if (LittleFS.exists(kPath)) LittleFS.remove(kPath);
    if (LittleFS.rename(kTmpPath, kPath)) {
      Serial.println("[SessionQueue] promoted temp to committed");
    }
  }

  Serial.printf("[SessionQueue] loaded %d session(s)%s\n", count_,
                skipped > 0 ? " (some rows skipped)" : "");
  if (skipped > 0) {
    Serial.printf("[SessionQueue] skipped %d invalid/overflow row(s)\n", skipped);
  }
}

bool SessionQueue::save() const {
  if (!ensureFs()) {
    Serial.println("[SessionQueue] save aborted: FS not ready");
    return false;
  }

  JsonDocument doc;
  JsonArray arr = doc["sessions"].to<JsonArray>();
  for (int i = 0; i < count_; i++) {
    const QueuedSession& s = items_[i];
    JsonObject row = arr.add<JsonObject>();
    row["client_id"] = s.clientId;
    row["type"] = s.type;
    row["duration"] = s.durationSec;
    row["completed"] = true;
    if (s.hasStart) row["start"] = s.start;
    if (s.tag[0] != '\0') row["tag"] = s.tag;
  }

  // Crash-safe: write temp, then replace committed path. A power loss during
  // the temp write leaves the previous committed file intact.
  File f = LittleFS.open(kTmpPath, "w");
  if (!f) {
    Serial.println("[SessionQueue] write open failed (tmp)");
    return false;
  }
  const size_t n = serializeJson(doc, f);
  f.close();
  if (n == 0) {
    Serial.println("[SessionQueue] write empty");
    LittleFS.remove(kTmpPath);
    return false;
  }

  if (LittleFS.exists(kPath)) {
    if (!LittleFS.remove(kPath)) {
      Serial.println("[SessionQueue] remove committed failed");
      // Still try rename — some FS builds replace on rename.
    }
  }
  if (!LittleFS.rename(kTmpPath, kPath)) {
    Serial.println("[SessionQueue] rename tmp -> committed failed");
    return false;
  }
  return true;
}

void SessionQueue::dropOldest() {
  if (count_ <= 0) return;
  for (int i = 1; i < count_; i++) {
    items_[i - 1] = items_[i];
  }
  count_--;
}

bool SessionQueue::enqueue(const char* clientId, const char* type, int durationSec,
                           long startEpoch, const char* tag) {
  if (clientId == nullptr || clientId[0] == '\0') {
    Serial.println("[SessionQueue] enqueue rejected: empty client_id");
    return false;
  }
  if (type == nullptr || !typeIsValid(type)) {
    Serial.println("[SessionQueue] enqueue rejected: bad type");
    return false;
  }
  if (durationSec <= 0) {
    Serial.println("[SessionQueue] enqueue rejected: duration <= 0");
    return false;
  }

  if (count_ >= kCapacity) {
    Serial.println("[SessionQueue] full, dropping oldest");
    dropOldest();
  }

  QueuedSession& s = items_[count_];
  copyBounded(s.clientId, sizeof(s.clientId), clientId);
  copyBounded(s.type, sizeof(s.type), type);
  s.durationSec = durationSec;
  s.completed = true;
  if (startEpoch >= 0) {
    s.hasStart = true;
    s.start = startEpoch;
  } else {
    s.hasStart = false;
    s.start = 0;
  }
  copyBounded(s.tag, sizeof(s.tag), tag);
  count_++;

  const bool ok = save();
  Serial.printf("[SessionQueue] enqueue %s type=%s dur=%d start=%ld count=%d save=%d\n",
                s.clientId, s.type, s.durationSec,
                s.hasStart ? s.start : -1L, count_, ok ? 1 : 0);
  if (!ok) {
    Serial.println("[SessionQueue] ENQUEUE PERSIST FAILED — RAM holds row until reboot");
  }
  return ok;
}

int SessionQueue::dropAccepted(const char* const* clientIds, int acceptedCount) {
  if (clientIds == nullptr || acceptedCount <= 0 || count_ == 0) return 0;

  int dropped = 0;
  int write = 0;
  for (int i = 0; i < count_; i++) {
    bool accept = false;
    for (int j = 0; j < acceptedCount; j++) {
      if (clientIds[j] != nullptr &&
          strcmp(items_[i].clientId, clientIds[j]) == 0) {
        accept = true;
        break;
      }
    }
    if (accept) {
      dropped++;
      continue;
    }
    if (write != i) items_[write] = items_[i];
    write++;
  }
  count_ = write;
  if (dropped > 0) {
    if (!save()) {
      Serial.println("[SessionQueue] dropAccepted save failed");
    }
    Serial.printf("[SessionQueue] dropped %d accepted, remaining %d\n", dropped,
                  count_);
  }
  return dropped;
}

int SessionQueue::stripImplausibleStarts(long nowEpoch) {
  if (nowEpoch <= 0 || count_ == 0) return 0;

  // Match SessionImportPayloads on the phone so omitted starts are assigned
  // instead of rejected forever (dropAccepted only removes accepted ids).
  const long maxFuture = nowEpoch + 5L * 60L;
  const long minStart = nowEpoch - 14L * 24L * 60L * 60L;

  int stripped = 0;
  for (int i = 0; i < count_; i++) {
    if (!items_[i].hasStart) continue;
    if (items_[i].start > maxFuture || items_[i].start < minStart) {
      items_[i].hasStart = false;
      items_[i].start = 0;
      stripped++;
    }
  }
  if (stripped > 0) {
    if (!save()) {
      Serial.println("[SessionQueue] stripImplausibleStarts save failed");
    }
    Serial.printf("[SessionQueue] stripped hasStart on %d implausible row(s)\n",
                  stripped);
  }
  return stripped;
}

void SessionQueue::clear() {
  count_ = 0;
  if (!save()) {
    Serial.println("[SessionQueue] clear save failed");
  }
}
