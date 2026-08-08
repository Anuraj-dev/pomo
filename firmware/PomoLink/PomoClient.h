#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

#include "Buttons.h"
#include "ConfigStore.h"
#include "SessionQueue.h"
#include "TimerModel.h"

// Owns WiFi, mDNS discovery, the WebSocket connection and REST commands.
//
// SYNCED: phone is sole live clock. State arrives on WebSocket only. Commands
// go out over REST and the response body is applied immediately (do not wait
// for the next WS frame). Periodic REST while SYNCED is avoided — blocking
// HTTP on ESP8266 starves webSocket.loop() and drops the socket.
//
// Enter-SYNC requires a real WS state frame (never REST-only promote). REST
// while CONNECTING is reachability / token check only.
//
// Soft resync: if the WS drops or goes stale but the phone still answers REST
// on the known host, reopen the socket and stay phone-owned (no OFFLINE local
// timer takeover). That stops the SYNCED→OFFLINE→CONNECTING→SYNCED thrash.
// True OFFLINE (local engine) only when the phone is unreachable.
//
// Enter SYNC pipeline (marker stays '.' until done), triggered by first WS
// state frame only:
//   (1) WS state snapshot
//   (2) POST /api/sessions/import
//   (3) drop accepted client_ids and quarantine terminal rejected ids
//   (4)/(5) adopt or snap (least remaining)
//   (6) defer GET /api/config until SYNCED is stable; refresh is non-blocking
//       with respect to the state-machine retry cadence
//
// OFFLINE / UNPAIRED: desk owns the live clock. Gestures drive the local engine.
class PomoClient {
 public:
  void begin(TimerModel* model, SessionQueue* queue, ConfigStore* config);
  void tick();

  ConnState state() const { return state_; }

  // Phone commands while SYNCED, or while soft-reconnecting (phone still owns
  // the clock). Local engine only when model is local owner.
  void sendGesture(Gesture gesture);

  void setPhaseCompleteHandler(void (*handler)(const char* phase));

 private:
  void tickWifi();
  void tickDiscovery();
  void tickWebSocket();
  void tickHeartbeat();
  void tickProbeWatchdog();
  void tickDeferredDisconnect();
  void onWebSocketText(const char* payload, size_t length);
  void onWebSocketConnected();
  void onWebSocketDisconnected();
  // Open / re-open WS to host_/port_. Leaves state CONN_CONNECTING.
  void beginWebSocket(const char* reason);
  // Phone still reachable: reopen WS without taking the local clock.
  // Returns false and enters OFFLINE if the phone is gone or soft-resync budget
  // is exhausted.
  bool softResync(const char* reason);
  bool postCommand(const char* path, const char* body);
  // GET /api/status. Never promotes to SYNCED. SYNCED: optional snap.
  // CONNECTING / soft path: reachability + token only. OFFLINE: reachability.
  bool fetchStatus();
  void setState(ConnState next);
  void enterOffline(const char* reason);
  void enterUnpaired(const char* reason);
  void scheduleProbeRetry();
  void scheduleRediscover();
  bool inBootProbe() const;
  // True when desk should still talk to the phone (not local-only).
  bool phoneCommandsActive() const;

  void enterSyncFromPhoneState(JsonObjectConst data);
  bool flushSessionQueue();
  int tryAdoptLocalTimer();
  void applyPhoneObject(JsonObjectConst data, bool force = true);
  bool fetchAndCacheConfig();
  void cacheServerTime(JsonObjectConst data);
  double resolveLocalStartTime() const;
  void tickConfigRefresh();
  void tickSessionQueueRetry();

  int httpRequest(const char* method, const char* path, const char* body,
                  String* bodyOut, uint16_t timeoutMs);
  int probeHostStatus(const String& host, uint16_t port);

  TimerModel* model_ = nullptr;
  SessionQueue* queue_ = nullptr;
  ConfigStore* config_ = nullptr;
  ConnState state_ = CONN_BOOT;
  void (*phaseCompleteHandler_)(const char*) = nullptr;

  String host_;
  uint16_t port_ = 0;
  unsigned long lastContactAt_ = 0;
  // WebSocket frames / connect only. REST must never refresh this.
  unsigned long lastSocketContactAt_ = 0;
  unsigned long lastPollAt_ = 0;
  unsigned long retryStartedAt_ = 0;
  unsigned long retryDelayMs_ = 0;
  unsigned long probeStartedAt_ = 0;
  bool probeActive_ = false;
  bool everSynced_ = false;
  bool enteringSync_ = false;
  // WS dropped while import/adopt/config was blocking — soft-resync after.
  bool wsDroppedDuringEnter_ = false;
  // Import did not fully succeed; stay CONNECTING and retry on the shared
  // fixed-interval timer before allowing SYNCED.
  bool queueFlushPending_ = false;
  String pendingSyncStateJson_;
  bool preferKnownHost_ = false;
  unsigned long lastConfigFetchAt_ = 0;
  bool configFetchFailed_ = false;
  // Soft resync attempts since last successful SYNCED; cap prevents tight loops.
  uint8_t softResyncCount_ = 0;
  // Suppress DISCONNECTED callbacks from intentional webSocket.disconnect().
  bool ignoreDisconnect_ = false;
  bool softResyncing_ = false;
  bool deferredDisconnectPending_ = false;
  ConnState deferredDisconnectState_ = CONN_BOOT;
};
