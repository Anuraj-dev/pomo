// PomoLink — an ESP8266 desk display and hybrid remote for the Pomo Android app.
//
// SYNCED: the phone owns the live clock. This device renders broadcast state,
// sends button gestures over REST, and buzzes on phone phase_complete events.
// On enter-SYNC it flushes the offline session queue and may adopt a live local
// timer onto the phone.
//
// OFFLINE / UNPAIRED: the desk owns the live clock. Local Pomodoro engine runs
// countdown, buttons, and buzzer; completed sessions are enqueued for flush.
// Never dual live clocks.
//
// See firmware/README.md for wiring, libraries and flashing steps.

#include <string.h>
#include <ESP8266WiFi.h>

#include "Buttons.h"
#include "Buzzer.h"
#include "ConfigStore.h"
#include "Display.h"
#include "PomoClient.h"
#include "SessionQueue.h"
#include "TimerModel.h"

namespace {

const uint8_t kButtonPin = 0;   // GPIO0, the onboard FLASH button
const uint8_t kBuzzerPin = D5;

// Persist live offline timer periodically — not every loop (flash wear).
const unsigned long kTimerSnapIntervalMs = 30000;

// Declared before use so the Arduino builder does not synthesise a conflicting
// global prototype for it — the generated declaration would be ambiguous with
// this anonymous-namespace definition at the point it is taken as a pointer.
void onPhaseComplete(const char* phase);
void onSessionComplete(const char* phase, int durationSec, bool completedWork,
                       double startTime);

TimerModel model;
Display display;
Buttons buttons;
Buzzer buzzer;
ConfigStore configStore;
SessionQueue sessionQueue;
PomoClient client;

unsigned long lastTimerSnapAt_ = 0;

// Build + write a live timer snapshot. No-op when not running/paused.
// Snaps remaining first so flash stores a stable value for this millis baseline.
bool persistLiveTimerSnapshot() {
  if (!model.isLive()) return false;
  model.snapForPersist();

  TimerSnapshot snap;
  memset(&snap, 0, sizeof(snap));
  strncpy(snap.status, model.status(), sizeof(snap.status) - 1);
  strncpy(snap.phase, model.phase(), sizeof(snap.phase) - 1);
  snap.remaining = model.remaining();
  snap.duration = model.duration();
  snap.startTime = model.startTime();
  snap.completed = model.completed();
  snap.goal = model.goal();
  snap.savedEpoch = configStore.hasEpoch() ? configStore.estimateEpochNow() : 0L;

  const bool ok = configStore.saveTimerSnapshot(snap);
  if (ok) {
    lastTimerSnapAt_ = millis();
  } else {
    Serial.println("[PomoLink] timer snapshot save failed");
  }
  return ok;
}

void clearLiveTimerSnapshot() {
  configStore.clearTimerSnapshot();
  lastTimerSnapAt_ = 0;
}

// Restore a live offline timer after reboot. Recomputes remaining from wall
// epoch when both sides know it; otherwise freezes remaining as saved.
void restoreLiveTimerFromFlash() {
  TimerSnapshot snap;
  if (!configStore.loadTimerSnapshot(&snap)) return;

  double rem = snap.remaining;
  if (strcmp(snap.status, "running") == 0 && snap.savedEpoch > 0 &&
      configStore.hasEpoch()) {
    const long now = configStore.estimateEpochNow();
    const long elapsed = now - snap.savedEpoch;
    if (elapsed > 0) {
      rem -= (double)elapsed;
      if (rem < 0.0) rem = 0.0;
    }
  }

  if (!model.restoreLiveState(snap.status, snap.phase, rem, snap.duration,
                              snap.completed, snap.startTime)) {
    Serial.println("[PomoLink] timer snapshot restore rejected");
    clearLiveTimerSnapshot();
    return;
  }

  // Apply goal from snapshot when present (0 is valid).
  if (snap.goal >= 0) {
    model.setConfig(model.workMinutes(), model.shortMinutes(), model.longMinutes(),
                    model.longAfter(), snap.goal);
  }

  Serial.printf(
      "[PomoLink] restored live timer status=%s phase=%s rem=%.0f completed=%d\n",
      model.status(), model.phase(), model.remaining(), model.completed());
  // Ownership (and natural completion) wait until client enters OFFLINE /
  // UNPAIRED. Display still extrapolates a running countdown from remaining.
}

void onPhaseComplete(const char* phase) {
  // Shared by phone phase_complete (SYNC) and local engine rundown (OFFLINE).
  if (strcmp(phase, "work") == 0) {
    buzzer.playWorkComplete();
    display.blinkBacklight();
  } else {
    buzzer.playBreakComplete();
  }
}

// Local natural completions only (TimerModel local owner). Enqueue for import.
void onSessionComplete(const char* phase, int durationSec, bool completedWork,
                       double startTime) {
  (void)completedWork;

  // Idle after complete — drop live snapshot so reboot does not resurrect it.
  clearLiveTimerSnapshot();

  char clientId[24];
  // desk-<chipid hex 6>-<seq hex 4> — unique enough for phone client_id idempotency.
  const uint16_t seq = configStore.takeNextClientSeq();
  snprintf(clientId, sizeof(clientId), "d%06x-%04x",
           (unsigned)(ESP.getChipId() & 0xFFFFFF), (unsigned)seq);
  // Persist seq even if enqueue fails later so ids never reuse after reboot.
  configStore.save();

  // Prefer the real phase start from TimerModel (pauses/resumes/extends).
  // Fallback to completion−duration only when start was never stamped.
  long startEpoch = -1;
  if (startTime > 0.0) {
    startEpoch = (long)startTime;
  } else if (configStore.hasEpoch()) {
    const long now = configStore.estimateEpochNow();
    startEpoch = now - (long)durationSec;
    if (startEpoch < 0) startEpoch = 0;
    Serial.println("[PomoLink] session start unknown — using completion-duration fallback");
  }

  Serial.printf("[PomoLink] session complete phase=%s duration=%d id=%s start=%ld\n",
                phase, durationSec, clientId, startEpoch);
  const bool enqueued = sessionQueue.enqueue(clientId, phase, durationSec,
                                             startEpoch, "");
  if (!enqueued) {
    Serial.println("[PomoLink] ENQUEUE FAILED — offline session may be lost on reboot");
    // Visible flash so a silent drop is not the only signal.
    display.blinkBacklight();
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.println("PomoLink starting");

  display.begin();
  buttons.begin(kButtonPin);
  buzzer.begin(kBuzzerPin);

  // Flash-backed durations / goal / epoch / client_id sequence.
  configStore.begin();
  sessionQueue.begin();
  // One-time cleanup: rows written under a bad post-reboot epoch basis.
  if (configStore.hasEpoch()) {
    sessionQueue.stripImplausibleStarts(configStore.estimateEpochNow());
  }

  model.setConfig(configStore.workMinutes(), configStore.shortMinutes(),
                  configStore.longMinutes(), configStore.longAfter(),
                  configStore.goal());
  model.setPhaseCompleteHandler(onPhaseComplete);
  model.setSessionCompleteHandler(onSessionComplete);

  // Survive reboot for an offline running/paused timer (before client probe).
  restoreLiveTimerFromFlash();

  client.begin(&model, &sessionQueue, &configStore);

  display.render(model, client.state());
}

// No delay() anywhere in this loop. The WebSocket must be pumped every
// iteration; a blocking melody or debounce would stall it and drop the
// connection. Local engine tick is millis-based and returns immediately.
void loop() {
  client.tick();
  model.tick();

  const Gesture gesture = buttons.tick();
  if (gesture != GESTURE_NONE) {
    client.sendGesture(gesture);
    // Local gestures mutate the desk clock — persist live state promptly.
    // SYNCED path is REST-only (no local mutate); persistLive no-ops if not live.
    if (model.isLocalOwner()) {
      if (model.isLive()) {
        persistLiveTimerSnapshot();
      } else {
        clearLiveTimerSnapshot();
      }
    }
  }

  // Periodic snapshot while a local timer is live (crash / power-loss safety).
  // Enter-SYNC clears the file inside PomoClient::setState.
  if (model.isLocalOwner() && model.isLive()) {
    if (lastTimerSnapAt_ == 0 ||
        (millis() - lastTimerSnapAt_) >= kTimerSnapIntervalMs) {
      persistLiveTimerSnapshot();
    }
  }

  buzzer.tick();
  display.tick();
  display.render(model, client.state());
}
