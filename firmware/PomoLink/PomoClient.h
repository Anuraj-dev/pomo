#pragma once
#include <Arduino.h>

#include "Buttons.h"
#include "TimerModel.h"

// Owns WiFi, mDNS discovery, the WebSocket connection and REST commands.
//
// Commands go out over REST and state comes back over the WebSocket, matching
// the contract in docs/protocol.md. This client never writes canonical state:
// it does not optimistically update the model after sending a command, it waits
// for the phone's broadcast, so what the LCD shows is always something the
// phone actually said.
class PomoClient {
 public:
  void begin(TimerModel* model);
  void tick();

  ConnState state() const { return state_; }

  // Ignored unless state() == CONN_SYNCED. Commands are never queued for
  // replay: a command applied minutes late would control a timer the user has
  // since changed.
  void sendGesture(Gesture gesture);

  // Called with "work", "short" or "long" when the phone reports a phase ran
  // down on its own.
  void setPhaseCompleteHandler(void (*handler)(const char* phase));

 private:
  void tickWifi();
  void tickDiscovery();
  void tickWebSocket();
  void tickHeartbeat();
  void onWebSocketText(const char* payload, size_t length);
  bool postCommand(const char* path, const char* body);
  bool fetchStatus();
  void setState(ConnState next);
  void scheduleRetry();

  TimerModel* model_ = nullptr;
  ConnState state_ = CONN_BOOT;
  void (*phaseCompleteHandler_)(const char*) = nullptr;

  String host_;
  uint16_t port_ = 0;
  unsigned long lastContactAt_ = 0;
  unsigned long lastPollAt_ = 0;
  unsigned long retryAfter_ = 0;
  uint8_t retryCount_ = 0;
};
