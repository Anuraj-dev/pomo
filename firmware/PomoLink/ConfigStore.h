#pragma once
#include <Arduino.h>

// Live offline timer snapshot for reboot survival (LittleFS `/pomo_timer.json`).
// Only running/paused states are restored as live; stopped clears the file.
struct TimerSnapshot {
  char status[10];   // running | paused
  char phase[8];     // work | short | long
  double remaining;  // seconds at save (snapped)
  double duration;
  double startTime;  // epoch seconds, 0 if unknown
  int completed;
  int goal;
  long savedEpoch;   // estimateEpochNow() at save, 0 if unknown
};

// Flash-backed timer config and phone epoch basis for offline wall-clock.
//
// LittleFS file `/pomo_config.json`. Defaults match the product: 25/5/15 min,
// long break every 4 work blocks, daily goal 8. server_time from the phone is
// held in RAM with a local millis() sample for estimateEpochNow() while the
// device stays up. Flash only stores wall-clock seconds (estimate at save);
// on load the basis is re-anchored at millis() so time freezes across power-off
// instead of jumping via unsigned millis wrap.
//
// Live timer snapshot is a separate small file so config writes are not coupled
// to countdown persistence (flash wear).
class ConfigStore {
 public:
  static const int kDefaultWorkMinutes = 25;
  static const int kDefaultShortMinutes = 5;
  static const int kDefaultLongMinutes = 15;
  static const int kDefaultLongAfter = 4;
  static const int kDefaultGoal = 8;

  // Mount LittleFS (if needed) and load. Safe to call once from setup().
  bool begin();

  void load();
  bool save() const;

  int workMinutes() const { return workMinutes_; }
  int shortMinutes() const { return shortMinutes_; }
  int longMinutes() const { return longMinutes_; }
  int longAfter() const { return longAfter_; }
  int goal() const { return goal_; }

  void setDurations(int workMinutes, int shortMinutes, int longMinutes,
                    int longAfter, int goal);

  // Phone wall-clock sample for this boot. epochSec is server_time (epoch
  // seconds); millisAt is the local millis() when that sample was taken.
  // Not written raw to flash — save() stores estimateEpochNow() only.
  void setEpochBasis(long epochSec, unsigned long millisAt);
  bool hasEpoch() const { return hasEpoch_; }
  long epochSec() const { return epochSec_; }
  unsigned long epochMillisAt() const { return epochMillisAt_; }

  // Approximate phone epoch now, or 0 when no basis is known.
  // Valid within a single boot after setEpochBasis or load re-anchor.
  long estimateEpochNow() const;

  // Monotonic client_id sequence (persisted). Returns the next value and
  // advances; caller is responsible for save() if they want durability before
  // power loss (SessionQueue::enqueue saves via its own path — this seq is
  // saved together with config when set).
  uint16_t takeNextClientSeq();

  // Live offline timer snapshot (running/paused). Crash-safe temp+rename.
  // Returns false if nothing valid was loaded / write failed.
  bool loadTimerSnapshot(TimerSnapshot* out) const;
  bool saveTimerSnapshot(const TimerSnapshot& snap) const;
  bool clearTimerSnapshot() const;

 private:
  int workMinutes_ = kDefaultWorkMinutes;
  int shortMinutes_ = kDefaultShortMinutes;
  int longMinutes_ = kDefaultLongMinutes;
  int longAfter_ = kDefaultLongAfter;
  int goal_ = kDefaultGoal;

  bool hasEpoch_ = false;
  long epochSec_ = 0;
  unsigned long epochMillisAt_ = 0;

  uint16_t nextClientSeq_ = 1;
  bool fsReady_ = false;
};
