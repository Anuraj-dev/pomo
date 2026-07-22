#pragma once
#include <Arduino.h>
#include <string.h>

enum ConnState {
  CONN_BOOT,
  CONN_WIFI,         // connecting to WiFi
  CONN_DISCOVERING,  // resolving the phone via mDNS
  CONN_CONNECTING,   // opening the WebSocket
  CONN_SYNCED,       // authenticated, receiving broadcasts
  CONN_OFFLINE,      // phone unreachable
  CONN_UNPAIRED,     // token rejected
};

// Holds the last state the phone reported and extrapolates the countdown
// between broadcasts. Owns no hardware and performs no I/O.
//
// The phone sends `remaining` in seconds at the moment of the broadcast. This
// class records millis() at receipt and subtracts elapsed time when asked, so
// the display ticks smoothly without the device ever running its own timer.
// Every broadcast re-snaps the baseline, so error cannot accumulate.
class TimerModel {
 public:
  void applyState(const char* status, const char* phase, double remaining,
                  double duration, int completed, int goal);

  // Seconds to show, clamped at zero. Extrapolates only while running.
  long displayedSeconds() const;

  const char* status() const { return status_; }
  const char* phase() const { return phase_; }
  int completed() const { return completed_; }
  int goal() const { return goal_; }
  double duration() const { return duration_; }
  bool isRunning() const { return strcmp(status_, "running") == 0; }
  bool hasState() const { return hasState_; }

 private:
  char status_[10] = "stopped";
  char phase_[8] = "work";
  double remaining_ = 0.0;
  double duration_ = 0.0;
  int completed_ = 0;
  int goal_ = 8;
  unsigned long receivedAt_ = 0;
  bool hasState_ = false;
};
