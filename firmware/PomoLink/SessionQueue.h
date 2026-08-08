#pragma once
#include <Arduino.h>

// Bounded offline session history for flush via POST /api/sessions/import.
//
// Up to kCapacity completed sessions survive reboot on LittleFS
// (`/pomo_sessions.json`). Writes use temp + rename so a power loss mid-write
// cannot leave a truncated committed file. When full, the oldest entry is
// dropped. Corrupt loads leave count 0 and log; the prior file is kept until a
// successful save rewrites it.
//
// Shape matches protocol WireSession: client_id, type, duration, completed,
// optional start (epoch seconds), optional tag.
struct QueuedSession {
  char clientId[24];
  char type[8];       // work | short | long
  int durationSec;    // > 0
  bool completed;     // always true for enqueued rows
  bool hasStart;
  long start;         // epoch seconds when hasStart
  char tag[24];       // may be empty
};

class SessionQueue {
 public:
  static const int kCapacity = 32;

  bool begin();
  void load();
  bool save() const;

  int count() const { return count_; }
  const QueuedSession& at(int index) const { return items_[index]; }

  // Append a completed session. Drops the oldest when full.
  // startEpoch < 0 means omit start (phone will assign).
  // clientId must be non-empty and unique enough for phone idempotency.
  bool enqueue(const char* clientId, const char* type, int durationSec,
               long startEpoch, const char* tag);

  // Remove every session whose client_id appears in the list of terminal ids
  // (accepted or quarantined response ids). Returns how many rows were dropped.
  int dropByClientId(const char* const* clientIds, int clientIdCount);

  // Drop hasStart on rows whose start is outside the phone import window
  // (not older than 14 days, not more than 5 minutes ahead of nowEpoch).
  // Phone then assigns start. Returns how many rows were rewritten; persists
  // when any change is made. Clears one-time poison from a bad epoch basis.
  int stripImplausibleStarts(long nowEpoch);

  bool empty() const { return count_ == 0; }
  void clear();

 private:
  void dropOldest();

  QueuedSession items_[kCapacity];
  int count_ = 0;
  bool fsReady_ = false;
};
