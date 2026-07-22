#pragma once
#include <Arduino.h>

#include "TimerModel.h"

// Renders the 16x2 LCD. Redraws only cells whose content changed — a full
// lcd.clear() every second produces visible flicker over I2C.
class Display {
 public:
  void begin();

  // Cheap to call every loop; only touches the LCD when the rendered text
  // actually differs from what is on screen.
  void render(const TimerModel& model, ConnState conn);

  // Starts the 3x backlight blink used on work completion. Non-blocking.
  void blinkBacklight();

  void tick();

 private:
  void writeRow(uint8_t row, const char* text);

  char shown_[2][17] = {"", ""};
  bool blinking_ = false;
  uint8_t blinkStep_ = 0;
  unsigned long blinkStepAt_ = 0;
};
