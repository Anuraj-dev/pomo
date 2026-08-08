#pragma once
#include <Arduino.h>
#include <string.h>

enum ConnState {
  CONN_BOOT,
  CONN_WIFI,         // connecting to WiFi
  CONN_DISCOVERING,  // resolving the phone via mDNS
  CONN_CONNECTING,   // opening the WebSocket
  CONN_SYNCED,       // authenticated, receiving broadcasts
  CONN_OFFLINE,      // phone unreachable — desk owns the live clock
  CONN_UNPAIRED,     // token rejected — timer still offline-usable
};

// Hybrid timer model.
//
// SYNCED: holds the last state the phone reported and extrapolates the
// countdown between broadcasts. applyState() re-snaps the baseline so error
// cannot accumulate. The phone is the sole live clock.
//
// SYNCED invariant (same running session = equal start_time + phase):
//   - remaining is monotonic non-increasing across applied frames unless
//     server_time advances or duration grows (phone extend);
//   - frames with older server_time are ignored (stale / out-of-order);
//   - when server_time + epochNow are provided, remaining is projected to
//     wall-clock now so network delay cannot rebase the countdown upward.
// force=true (enter-SYNC, adopt) always applies; force=false enforces the
// invariant for steady-state broadcasts.
//
// OFFLINE / UNPAIRED: the desk owns the live clock. toggle/skip/reset/extend
// mutate local state; tick() advances the countdown with millis and fires
// phase-complete (buzzer) plus an optional session-complete hook (queue).
//
// There is never dual live ownership: setLocalOwner(false) / applyState()
// release the desk clock; setLocalOwner(true) takes it over from the current
// displayed remaining.
class TimerModel {
 public:
  // Phone snapshot (SYNC path). Clears local ownership when applied.
  // serverTime / epochNow enable lag projection + stale rejection when
  // force is false. Returns false if the snapshot was ignored as stale.
  bool applyState(const char* status, const char* phase, double remaining,
                  double duration, int completed, int goal,
                  double startTime = 0.0, long serverTime = 0,
                  long epochNow = 0, bool force = true);

  // Durations in minutes; longAfter is the work-block cadence for long breaks.
  // Defaults 25/5/15, 4, 8. Loaded from ConfigStore / phone GET /api/config.
  // daily goal may be 0 (phone allows non-negative).
  void setConfig(int workMinutes, int shortMinutes, int longMinutes,
                 int longAfter, int goal);

  // Desk takes or releases the live clock. Taking ownership with no prior
  // state installs a stopped work idle at the configured work duration.
  void setLocalOwner(bool owns);
  bool isLocalOwner() const { return localOwner_; }

  // Local engine controls — no-ops unless localOwner_.
  void toggle();
  void skip();
  void reset();
  void extend(int secondsDelta = 300);

  // Call every loop. Completes the phase when remaining hits zero while the
  // desk owns a running timer. No delay().
  void tick();

  // Natural phase rundown (local or forwarded from phone). phase is the one
  // that just finished ("work" / "short" / "long").
  void setPhaseCompleteHandler(void (*handler)(const char* phase));

  // Hook for offline session queue. Fires after a natural local completion
  // with the finished phase, its duration in whole seconds, whether a work
  // block counted as completed, and the phase start_time (epoch seconds, or
  // 0 if unknown — callers must not invent completion−duration when 0 unless
  // that is the only available fallback).
  void setSessionCompleteHandler(void (*handler)(const char* phase,
                                                 int durationSec,
                                                 bool completedWork,
                                                 double startTime));

  // Restore a live offline timer from flash after reboot. Does not change
  // localOwner_; caller takes ownership when entering OFFLINE / UNPAIRED.
  // remaining should already be wall-clock adjusted by the loader when possible.
  // Only running/paused are accepted.
  bool restoreLiveState(const char* status, const char* phase, double remaining,
                        double duration, int completed, double startTime);

  // Snap displayed remaining into remaining_ (for flash persistence).
  void snapForPersist();

  // Seconds to show, clamped at zero. Extrapolates only while running.
  long displayedSeconds() const;

  // Wall-clock phase start (epoch seconds). Set from phone snapshots, or by
  // the client when a local phase starts with a known epoch basis. Used for
  // POST /api/timer/adopt identity and offline session history.
  void setStartTime(double startTime) { startTime_ = startTime; }
  double startTime() const { return startTime_; }

  const char* status() const { return status_; }
  const char* phase() const { return phase_; }
  int completed() const { return completed_; }
  int goal() const { return goal_; }
  double duration() const { return duration_; }
  double remaining() const { return remaining_; }
  bool isRunning() const { return strcmp(status_, "running") == 0; }
  bool isPaused() const { return strcmp(status_, "paused") == 0; }
  bool isStopped() const { return strcmp(status_, "stopped") == 0; }
  // Live local timer that may be handed to the phone via adopt.
  bool isLive() const { return isRunning() || isPaused(); }
  bool hasState() const { return hasState_; }

  int workMinutes() const { return workMinutes_; }
  int shortMinutes() const { return shortMinutes_; }
  int longMinutes() const { return longMinutes_; }
  int longAfter() const { return longAfter_; }

 private:
  void initLocalIdle();
  void snapRemaining();
  void armRunningBaseline();
  double durationSecondsForPhase(const char* phase) const;
  void advanceAfterWorkComplete();
  void advanceAfterBreakComplete();
  void advanceAfterWorkSkip();
  void handleLocalComplete();

  char status_[10] = "stopped";
  char phase_[8] = "work";
  double remaining_ = 0.0;
  double duration_ = 0.0;
  double startTime_ = 0.0;
  int completed_ = 0;
  int goal_ = 8;
  unsigned long receivedAt_ = 0;
  // Last applied phone server_time (epoch sec); 0 if unknown. Used to drop
  // out-of-order state frames for the same session.
  long lastServerTime_ = 0;
  bool hasState_ = false;
  bool localOwner_ = false;

  int workMinutes_ = 25;
  int shortMinutes_ = 5;
  int longMinutes_ = 15;
  int longAfter_ = 4;

  void (*phaseCompleteHandler_)(const char*) = nullptr;
  void (*sessionCompleteHandler_)(const char*, int, bool, double) = nullptr;
};
