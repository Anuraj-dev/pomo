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
  // Any contact at all, REST included — keeps the display honest.
  unsigned long lastContactAt_ = 0;
  // WebSocket frames only. A REST poll must not vouch for the socket, or a
  // half-open socket could never be detected while REST still answers.
  unsigned long lastSocketContactAt_ = 0;
  unsigned long lastPollAt_ = 0;
  // Start-plus-interval rather than an absolute deadline: comparing millis()
  // against a stored deadline breaks across the ~49.7-day rollover.
  unsigned long retryStartedAt_ = 0;
  unsigned long retryDelayMs_ = 0;
  uint8_t retryCount_ = 0;
};
