#include "TimerModel.h"

#include <string.h>

void TimerModel::applyState(const char* status, const char* phase,
                            double remaining, double duration, int completed,
                            int goal) {
  strncpy(status_, status, sizeof(status_) - 1);
  status_[sizeof(status_) - 1] = '\0';
  strncpy(phase_, phase, sizeof(phase_) - 1);
  phase_[sizeof(phase_) - 1] = '\0';
  remaining_ = remaining;
  duration_ = duration;
  completed_ = completed;
  goal_ = goal;
  receivedAt_ = millis();
  hasState_ = true;
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
