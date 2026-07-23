#pragma once
#include <Arduino.h>

enum Gesture {
  GESTURE_NONE,
  GESTURE_SINGLE,
  GESTURE_DOUBLE,
  GESTURE_TRIPLE,
  GESTURE_HOLD,
};

// Single active-low button with millis-based debounce. The archived sketch used
// delay(50) inside its debounce, which is not acceptable here — see Buzzer.h.
class Buttons {
 public:
  void begin(uint8_t pin);

  // Call every loop. Returns GESTURE_NONE except on the single tick where a
  // gesture resolves.
  Gesture tick();

 private:
  static const unsigned long kDebounceMs = 50;
  static const unsigned long kMultiClickMs = 600;
  static const unsigned long kHoldMs = 1000;

  uint8_t pin_ = 0;
  bool pressed_ = false;
  uint8_t clickCount_ = 0;
  unsigned long lastEdgeAt_ = 0;
  unsigned long pressedAt_ = 0;
  unsigned long lastReleaseAt_ = 0;
  bool holdConsumed_ = false;
};
