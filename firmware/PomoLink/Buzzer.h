#pragma once
#include <Arduino.h>

// Plays melodies without blocking. The WebSocket client must be pumped every
// loop iteration; the archived standalone sketch used delay() between notes,
// which would stall the connection for seconds and drop it mid-celebration.
class Buzzer {
 public:
  // Public because the melody tables in Buzzer.cpp are file-scope constants of
  // this type. A private nested struct would not be nameable there.
  struct Note {
    uint16_t frequency;  // Hz, 0 = rest
    uint16_t duration;   // ms the note sounds
    uint16_t gap;        // ms of silence after the note
  };

  void begin(uint8_t pin);
  void playWorkComplete();
  void playBreakComplete();
  void tick();
  bool isPlaying() const { return playing_; }

 private:
  void start(const Note* notes, uint8_t count);

  uint8_t pin_ = 0;
  const Note* notes_ = nullptr;
  uint8_t count_ = 0;
  uint8_t index_ = 0;
  bool playing_ = false;
  bool inGap_ = false;
  unsigned long stepStartedAt_ = 0;
};
