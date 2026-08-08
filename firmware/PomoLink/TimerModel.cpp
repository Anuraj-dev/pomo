#include "TimerModel.h"

#include <string.h>

void TimerModel::setConfig(int workMinutes, int shortMinutes, int longMinutes,
                           int longAfter, int goal) {
  if (workMinutes > 0) workMinutes_ = workMinutes;
  if (shortMinutes > 0) shortMinutes_ = shortMinutes;
  if (longMinutes > 0) longMinutes_ = longMinutes;
  if (longAfter > 0) longAfter_ = longAfter;
  // Phone daily_goal is non-negative (0 is valid — no goal).
  if (goal >= 0) goal_ = goal;
}

void TimerModel::setPhaseCompleteHandler(void (*handler)(const char* phase)) {
  phaseCompleteHandler_ = handler;
}

void TimerModel::setSessionCompleteHandler(
    void (*handler)(const char* phase, int durationSec, bool completedWork,
                    double startTime)) {
  sessionCompleteHandler_ = handler;
}

bool TimerModel::restoreLiveState(const char* status, const char* phase,
                                  double remaining, double duration,
                                  int completed, double startTime) {
  if (status == nullptr || phase == nullptr) return false;
  if (strcmp(status, "running") != 0 && strcmp(status, "paused") != 0) {
    return false;
  }
  if (strcmp(phase, "work") != 0 && strcmp(phase, "short") != 0 &&
      strcmp(phase, "long") != 0) {
    return false;
  }
  if (remaining < 0.0 || duration <= 0.0) return false;

  strncpy(status_, status, sizeof(status_) - 1);
  status_[sizeof(status_) - 1] = '\0';
  strncpy(phase_, phase, sizeof(phase_) - 1);
  phase_[sizeof(phase_) - 1] = '\0';
  remaining_ = remaining;
  duration_ = duration;
  completed_ = completed < 0 ? 0 : completed;
  startTime_ = startTime > 0.0 ? startTime : 0.0;
  lastServerTime_ = 0;
  receivedAt_ = millis();
  hasState_ = true;
  return true;
}

void TimerModel::snapForPersist() {
  if (!hasState_) return;
  if (isRunning()) {
    snapRemaining();
  }
  // paused/stopped: remaining_ already fixed
}

bool TimerModel::applyState(const char* status, const char* phase,
                            double remaining, double duration, int completed,
                            int goal, double startTime, long serverTime,
                            long epochNow, bool force) {
  // Identity vs the currently held snapshot (before we mutate).
  const bool sameSession =
      hasState_ && startTime > 0.0 && startTime_ == startTime &&
      phase != nullptr && strcmp(phase_, phase) == 0;

  // Project remaining onto wall-clock when the snapshot's server_time is older
  // than our epoch estimate (delayed delivery). end ≈ server_time + remaining.
  double rem = remaining;
  if (status != nullptr && strcmp(status, "running") == 0 && serverTime > 0 &&
      epochNow > serverTime) {
    rem -= (double)(epochNow - serverTime);
    if (rem < 0.0) rem = 0.0;
  }

  // Steady-state SYNC: drop stale / out-of-order frames that would jump the
  // countdown backward (higher remaining) for the same running session.
  // Rem increases count as extend only when duration grew — not merely because
  // server_time advanced (a delayed non-extend frame can still look "newer"
  // after local extrapolation; lag projection above already corrected rem).
  if (!force && hasState_ && !localOwner_ && sameSession) {
    if (serverTime > 0 && lastServerTime_ > 0 && serverTime < lastServerTime_) {
      return false;
    }
    if (isRunning() && status != nullptr && strcmp(status, "running") == 0) {
      const long cur = displayedSeconds();
      if (rem > (double)cur + 1.0) {
        // Extend grows duration (and remaining). server_time alone is not
        // sufficient: delayed frames may advance server_time without extend.
        const bool likelyExtend = (duration > duration_ + 0.5);
        if (!likelyExtend) {
          return false;
        }
      }
    }
  }

  // Phone snapshot means the phone is the sole live clock.
  localOwner_ = false;

  strncpy(status_, status, sizeof(status_) - 1);
  status_[sizeof(status_) - 1] = '\0';
  strncpy(phase_, phase, sizeof(phase_) - 1);
  phase_[sizeof(phase_) - 1] = '\0';
  remaining_ = rem;
  duration_ = duration;
  completed_ = completed;
  // daily_goal may be 0
  if (goal >= 0) {
    goal_ = goal;
  }
  startTime_ = startTime;
  receivedAt_ = millis();
  hasState_ = true;
  if (serverTime > 0) {
    lastServerTime_ = serverTime;
  } else if (!sameSession) {
    // No server_time and new session: clear tracker so we do not compare
    // timestamps across unrelated phases.
    lastServerTime_ = 0;
  }
  return true;
}

void TimerModel::setLocalOwner(bool owns) {
  if (owns == localOwner_) {
    if (owns && !hasState_) initLocalIdle();
    return;
  }

  if (owns) {
    if (hasState_) {
      // Continue from what the display is already showing so we do not jump
      // forward or rewind when the phone drops.
      snapRemaining();
    } else {
      initLocalIdle();
    }
    localOwner_ = true;
  } else {
    if (isRunning()) snapRemaining();
    localOwner_ = false;
  }
}

void TimerModel::initLocalIdle() {
  strncpy(status_, "stopped", sizeof(status_) - 1);
  status_[sizeof(status_) - 1] = '\0';
  strncpy(phase_, "work", sizeof(phase_) - 1);
  phase_[sizeof(phase_) - 1] = '\0';
  duration_ = durationSecondsForPhase("work");
  remaining_ = duration_;
  startTime_ = 0.0;
  lastServerTime_ = 0;
  // Preserve completed_ if we somehow already had a count; fresh boot is 0.
  goal_ = goal_;
  receivedAt_ = millis();
  hasState_ = true;
}

void TimerModel::snapRemaining() {
  remaining_ = (double)displayedSeconds();
  receivedAt_ = millis();
}

void TimerModel::armRunningBaseline() {
  receivedAt_ = millis();
}

double TimerModel::durationSecondsForPhase(const char* phase) const {
  if (strcmp(phase, "short") == 0) return (double)shortMinutes_ * 60.0;
  if (strcmp(phase, "long") == 0) return (double)longMinutes_ * 60.0;
  return (double)workMinutes_ * 60.0;
}

long TimerModel::displayedSeconds() const {
  if (!isRunning()) {
    // Paused and stopped states report a fixed remaining value; extrapolating
    // it would make a paused timer appear to tick down.
    return remaining_ < 0 ? 0 : (long)remaining_;
  }

  // Unsigned subtraction is correct across the millis() rollover at ~49 days.
  const unsigned long elapsedMs = millis() - receivedAt_;
  const long value = (long)remaining_ - (long)(elapsedMs / 1000UL);
  return value < 0 ? 0 : value;
}

void TimerModel::toggle() {
  if (!localOwner_) return;

  if (isRunning()) {
    snapRemaining();
    strncpy(status_, "paused", sizeof(status_) - 1);
    status_[sizeof(status_) - 1] = '\0';
    return;
  }

  // stopped or paused → running
  if (remaining_ <= 0.0) {
    remaining_ = durationSecondsForPhase(phase_);
    duration_ = remaining_;
  }
  // Fresh start from stopped: clear prior start_time so adopt rebuilds it.
  // Resume from paused keeps the original start_time when set.
  if (strcmp(status_, "stopped") == 0) {
    startTime_ = 0.0;
  }
  strncpy(status_, "running", sizeof(status_) - 1);
  status_[sizeof(status_) - 1] = '\0';
  armRunningBaseline();
}

void TimerModel::skip() {
  if (!localOwner_) return;

  // Match phone OfflineTimer.skip: work → short (never long-on-skip),
  // break → work. Does not increment completed. Silent — no phase_complete.
  if (strcmp(phase_, "work") == 0) {
    advanceAfterWorkSkip();
  } else {
    strncpy(phase_, "work", sizeof(phase_) - 1);
    phase_[sizeof(phase_) - 1] = '\0';
    duration_ = durationSecondsForPhase("work");
  }

  remaining_ = duration_;
  startTime_ = 0.0;
  strncpy(status_, "stopped", sizeof(status_) - 1);
  status_[sizeof(status_) - 1] = '\0';
  receivedAt_ = millis();
}

void TimerModel::reset() {
  if (!localOwner_) return;

  // Restart current phase; discard progress. Silent.
  duration_ = durationSecondsForPhase(phase_);
  remaining_ = duration_;
  startTime_ = 0.0;
  strncpy(status_, "stopped", sizeof(status_) - 1);
  status_[sizeof(status_) - 1] = '\0';
  receivedAt_ = millis();
}

void TimerModel::extend(int secondsDelta) {
  if (!localOwner_) return;
  if (!isRunning()) return;
  if (secondsDelta < 1) secondsDelta = 1;

  snapRemaining();
  duration_ += (double)secondsDelta;
  remaining_ += (double)secondsDelta;
  armRunningBaseline();
}

void TimerModel::tick() {
  if (!localOwner_) return;
  if (!isRunning()) return;
  if (displayedSeconds() > 0) return;
  handleLocalComplete();
}

void TimerModel::advanceAfterWorkComplete() {
  completed_ += 1;
  if (completed_ > 0 && (completed_ % longAfter_) == 0) {
    strncpy(phase_, "long", sizeof(phase_) - 1);
    phase_[sizeof(phase_) - 1] = '\0';
    duration_ = durationSecondsForPhase("long");
  } else {
    strncpy(phase_, "short", sizeof(phase_) - 1);
    phase_[sizeof(phase_) - 1] = '\0';
    duration_ = durationSecondsForPhase("short");
  }
}

void TimerModel::advanceAfterWorkSkip() {
  strncpy(phase_, "short", sizeof(phase_) - 1);
  phase_[sizeof(phase_) - 1] = '\0';
  duration_ = durationSecondsForPhase("short");
}

void TimerModel::advanceAfterBreakComplete() {
  strncpy(phase_, "work", sizeof(phase_) - 1);
  phase_[sizeof(phase_) - 1] = '\0';
  duration_ = durationSecondsForPhase("work");
}

void TimerModel::handleLocalComplete() {
  // Capture the phase that finished before we advance.
  char finishedPhase[8];
  strncpy(finishedPhase, phase_, sizeof(finishedPhase) - 1);
  finishedPhase[sizeof(finishedPhase) - 1] = '\0';
  const int finishedDurationSec = duration_ < 0 ? 0 : (int)duration_;
  const bool completedWork = (strcmp(finishedPhase, "work") == 0);
  // Real phase start for history — must capture before clearing startTime_.
  const double finishedStart = startTime_;

  remaining_ = 0.0;
  startTime_ = 0.0;
  strncpy(status_, "stopped", sizeof(status_) - 1);
  status_[sizeof(status_) - 1] = '\0';

  if (completedWork) {
    advanceAfterWorkComplete();
  } else {
    advanceAfterBreakComplete();
  }

  // Park at the next phase with a full duration, matching the phone: natural
  // complete does not auto-start.
  remaining_ = duration_;
  receivedAt_ = millis();

  if (phaseCompleteHandler_ != nullptr) {
    phaseCompleteHandler_(finishedPhase);
  }
  if (sessionCompleteHandler_ != nullptr) {
    sessionCompleteHandler_(finishedPhase, finishedDurationSec, completedWork,
                            finishedStart);
  }
}
