#include "Buzzer.h"

namespace {

// Derived from the archived standalone sketch's playRewardSound()
// (Pomodoro_timer.ino:654-711) with countFactor fixed at 1, which is what that
// sketch always used. Frequencies are baseNote 543 Hz scaled by the major-scale
// intervals {1.0, 1.125, 1.25, 1.33, 1.5, 1.67, 1.875, 2.0}.
const Buzzer::Note kWorkComplete[] = {
    // Intro flourish: ascending arpeggio, intervals 0..2
    {543, 70, 20}, {611, 70, 20}, {679, 70, 20},
    // Main melody: melodyPattern {0, 2, 4}, durations 135/145/155
    {543, 135, 67}, {679, 145, 67}, {815, 155, 67},
    // Finale: interval 4 then interval 7
    {815, 150, 30}, {1086, 330, 0},
};

// Derived from the short-break completion melody
// (Pomodoro_timer.ino:520-550): baseNote 799 Hz, gentle rising arpeggio then a
// two-note resolution. Softer and shorter than the work melody by design.
const Buzzer::Note kBreakComplete[] = {
    {799, 85, 20}, {899, 85, 20}, {999, 85, 80},
    {1063, 160, 30},
    {799, 265, 0},
};

}  // namespace

void Buzzer::begin(uint8_t pin) {
  pin_ = pin;
  pinMode(pin_, OUTPUT);
  digitalWrite(pin_, LOW);
}

void Buzzer::playWorkComplete() {
  start(kWorkComplete, sizeof(kWorkComplete) / sizeof(kWorkComplete[0]));
}

void Buzzer::playBreakComplete() {
  start(kBreakComplete, sizeof(kBreakComplete) / sizeof(kBreakComplete[0]));
}

// A new melody replaces one already playing rather than queueing behind it.
// Two completions cannot legitimately arrive back to back, so a queue would
// only ever delay the melody that reflects current reality.
void Buzzer::start(const Note* notes, uint8_t count) {
  noTone(pin_);
  notes_ = notes;
  count_ = count;
  index_ = 0;
  playing_ = true;
  inGap_ = false;
  stepStartedAt_ = millis();
  tone(pin_, notes_[0].frequency, notes_[0].duration);
}

void Buzzer::tick() {
  if (!playing_) return;

  const Note& note = notes_[index_];
  const unsigned long elapsed = millis() - stepStartedAt_;

  if (!inGap_) {
    if (elapsed < note.duration) return;
    noTone(pin_);
    inGap_ = true;
    stepStartedAt_ = millis();
    return;
  }

  if (elapsed < note.gap) return;

  index_++;
  if (index_ >= count_) {
    playing_ = false;
    notes_ = nullptr;
    noTone(pin_);
    return;
  }

  inGap_ = false;
  stepStartedAt_ = millis();
  tone(pin_, notes_[index_].frequency, notes_[index_].duration);
}
