// PomoLink — an ESP8266 desk display and remote for the Pomo Android app.
//
// The phone owns the timer. This device renders broadcast state and sends
// button gestures to the phone's REST API. It runs no timer of its own and
// never records a session.
//
// See firmware/README.md for wiring, libraries and flashing steps.

#include <string.h>

#include "Buttons.h"
#include "Buzzer.h"
#include "Display.h"
#include "PomoClient.h"
#include "TimerModel.h"

namespace {

const uint8_t kButtonPin = 0;   // GPIO0, the onboard FLASH button
const uint8_t kBuzzerPin = D5;

// Declared before use so the Arduino builder does not synthesise a conflicting
// global prototype for it — the generated declaration would be ambiguous with
// this anonymous-namespace definition at the point it is taken as a pointer.
void onPhaseComplete(const char* phase);

TimerModel model;
Display display;
Buttons buttons;
Buzzer buzzer;
PomoClient client;

void onPhaseComplete(const char* phase) {
  if (strcmp(phase, "work") == 0) {
    buzzer.playWorkComplete();
    display.blinkBacklight();
  } else {
    buzzer.playBreakComplete();
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.println("PomoLink starting");

  display.begin();
  buttons.begin(kButtonPin);
  buzzer.begin(kBuzzerPin);

  client.setPhaseCompleteHandler(onPhaseComplete);
  client.begin(&model);

  display.render(model, client.state());
}

// No delay() anywhere in this loop. The WebSocket must be pumped every
// iteration; a blocking melody or debounce would stall it and drop the
// connection.
void loop() {
  client.tick();

  const Gesture gesture = buttons.tick();
  if (gesture != GESTURE_NONE) {
    client.sendGesture(gesture);
  }

  buzzer.tick();
  display.tick();
  display.render(model, client.state());
}
