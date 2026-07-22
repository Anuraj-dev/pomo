#include "Buttons.h"

void Buttons::begin(uint8_t pin) {
  pin_ = pin;
  pinMode(pin_, INPUT_PULLUP);
}

Gesture Buttons::tick() {
  const unsigned long now = millis();
  const bool rawPressed = digitalRead(pin_) == LOW;

  if (rawPressed != pressed_ && (now - lastEdgeAt_) >= kDebounceMs) {
    lastEdgeAt_ = now;
    pressed_ = rawPressed;

    if (pressed_) {
      pressedAt_ = now;
      holdConsumed_ = false;
    } else {
      // Long press resolves on release, so it can never be mistaken for the
      // first click of a multi-click sequence.
      if (!holdConsumed_ && (now - pressedAt_) >= kHoldMs) {
        clickCount_ = 0;
        holdConsumed_ = true;
        return GESTURE_HOLD;
      }
      clickCount_++;
      lastReleaseAt_ = now;
    }
  }

  if (clickCount_ > 0 && !pressed_ && (now - lastReleaseAt_) >= kMultiClickMs) {
    const uint8_t count = clickCount_;
    clickCount_ = 0;
    if (count == 1) return GESTURE_SINGLE;
    if (count == 2) return GESTURE_DOUBLE;
    return GESTURE_TRIPLE;
  }

  return GESTURE_NONE;
}
