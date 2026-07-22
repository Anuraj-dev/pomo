#include "Display.h"

#include <LiquidCrystal_I2C.h>
#include <Wire.h>
#include <string.h>

namespace {

const uint8_t kLcdAddress = 0x27;
const uint8_t kSdaPin = D2;
const uint8_t kSclPin = D1;
const uint8_t kBlinkSteps = 6;   // 3 off/on pairs
const unsigned long kBlinkMs = 200;

LiquidCrystal_I2C lcd(kLcdAddress, 16, 2);

const char* phaseLabel(const TimerModel& model) {
  if (strcmp(model.status(), "paused") == 0) return "Paused";
  if (strcmp(model.status(), "stopped") == 0) return "Pomo";
  if (strcmp(model.phase(), "work") == 0) return "Focus";
  if (strcmp(model.phase(), "short") == 0) return "Break";
  if (strcmp(model.phase(), "long") == 0) return "Long";
  return "Pomo";
}

char connMarker(ConnState conn) {
  switch (conn) {
    case CONN_SYNCED: return ' ';
    case CONN_OFFLINE: return '!';
    case CONN_UNPAIRED: return '?';
    default: return '.';
  }
}

}  // namespace

void Display::begin() {
  Wire.begin(kSdaPin, kSclPin);
  lcd.begin();
  lcd.backlight();
  lcd.clear();
}

void Display::render(const TimerModel& model, ConnState conn) {
  char row0[17];
  char row1[17];

  // Row 0: phase label left, MM:SS right-aligned at columns 11-15.
  long seconds = model.hasState() ? model.displayedSeconds() : 0;
  if (!model.hasState()) seconds = 0;
  if (strcmp(model.status(), "stopped") == 0 && model.hasState()) {
    // Idle shows the configured phase length rather than a zeroed countdown.
    seconds = (long)model.duration();
  }
  const long minutes = seconds / 60;
  const long secs = seconds % 60;
  snprintf(row0, sizeof(row0), "%-11s%02ld:%02ld", phaseLabel(model), minutes, secs);

  // Row 1: progress left, connection marker at column 15.
  char left[16];
  if (!model.hasState()) {
    snprintf(left, sizeof(left), "Starting up");
  } else if (strcmp(model.status(), "stopped") == 0) {
    snprintf(left, sizeof(left), "Press to start");
  } else {
    snprintf(left, sizeof(left), "%d/%d today", model.completed(), model.goal());
  }
  snprintf(row1, sizeof(row1), "%-15s%c", left, connMarker(conn));

  writeRow(0, row0);
  writeRow(1, row1);
}

void Display::writeRow(uint8_t row, const char* text) {
  if (strcmp(shown_[row], text) == 0) return;

  for (uint8_t col = 0; col < 16; col++) {
    const char next = text[col] ? text[col] : ' ';
    const char prev = shown_[row][col] ? shown_[row][col] : ' ';
    if (next == prev) continue;
    lcd.setCursor(col, row);
    lcd.print(next);
  }

  strncpy(shown_[row], text, 16);
  shown_[row][16] = '\0';
}

void Display::blinkBacklight() {
  blinking_ = true;
  blinkStep_ = 0;
  blinkStepAt_ = millis();
  lcd.noBacklight();
}

void Display::tick() {
  if (!blinking_) return;
  if (millis() - blinkStepAt_ < kBlinkMs) return;

  blinkStep_++;
  blinkStepAt_ = millis();

  if (blinkStep_ >= kBlinkSteps) {
    blinking_ = false;
    lcd.backlight();
    return;
  }

  if (blinkStep_ % 2 == 0) {
    lcd.noBacklight();
  } else {
    lcd.backlight();
  }
}
