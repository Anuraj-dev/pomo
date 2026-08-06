#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

#include "Buttons.h"
#include "ConfigStore.h"
#include "SessionQueue.h"
#include "TimerModel.h"

// Owns WiFi, mDNS discovery, the WebSocket connection and REST commands.
//
// SYNCED: commands go out over REST and state comes back over the WebSocket.
// The phone is the sole live clock; this client never optimistically updates
// the model after sending a command.
//
// OFFLINE / UNPAIRED: the desk owns the live clock on TimerModel. Gestures
// drive the local engine. Rediscovery uses short first retries then a ~90s
// baseline (or unpaired cooldown) without dual-owning the timer. While
// OFFLINE with a known host, REST reachability probes can trigger immediate
// rediscover when the phone reappears.
//
// Enter SYNC (ordered, while marker stays '.'):
//   (1) first WS state frame OR successful GET /api/status while CONNECTING
//   (2) POST /api/sessions/import full queue
//   (3) drop accepted client_ids
//   (4) if desk live: adopt when phone stopped, or when phone live and
//       desk remaining < phone remaining (strict; missing rem → try adopt)
//   (5) on 409 / desk rem >= phone rem → snap to phone (phone_wins).
//       Adopt transport fail: keep local offline only if phone was stopped;
//       if phone was already live on WS, snap (prefer single clock)
//   (6) cache server_time + GET /api/config to flash (retry once on fail;
//       keep retrying while SYNCED until success)
//
// While SYNCED: periodic GET /api/config with the heartbeat so phone setting
// changes land; steady-state state frames use force=false apply (lag project
// + stale reject). Leave SYNC: local takeover; marker ~; completions enqueue.
//
// Boot: WiFi wait and post-WiFi DISCOVERING each get a ~45s probe window; the
// DISCOVERING clock restarts when WiFi associates so a late join still has a
// full discovery budget (worst case ~90s). Missing SSID cannot strand the UI
// on "Starting up". Once CONN_CONNECTING, the handshake/hello wait uses the
// full ~45s socket-stale window instead of the probe cutoff. REST /api/status
// while CONNECTING can complete enter-SYNC if the socket never delivers a
// state frame.
class PomoClient {
 public:
  void begin(TimerModel* model, SessionQueue* queue, ConfigStore* config);
  void tick();

  ConnState state() const { return state_; }

  // SYNCED → REST. When TimerModel is local owner (OFFLINE / UNPAIRED, and
  // still during rediscover) → local engine. Ignored during boot probe.
  void sendGesture(Gesture gesture);

  // Called with "work", "short" or "long" when the phone reports a phase ran
  // down on its own (SYNC path). Local completions use TimerModel's own handler.
  void setPhaseCompleteHandler(void (*handler)(const char* phase));

 private:
  void tickWifi();
  void tickDiscovery();
  void tickWebSocket();
  void tickHeartbeat();
  void tickProbeWatchdog();
  void onWebSocketText(const char* payload, size_t length);
  // Refresh contact stamps when the TCP/WS layer reports connected so the
  // hello / first-state wait gets a full stale window (not leftover seed age).
  void onWebSocketConnected();
  // Called when the socket drops. While CONNECTING, probes REST so a bad token
  // (phone closed after hello) becomes UNPAIRED with marker '?' quickly; a
  // healthy status response runs the enter-SYNC pipeline rather than waiting
  // for the stale window to fall through to OFFLINE.
  void onWebSocketDisconnected();
  bool postCommand(const char* path, const char* body);
  // GET /api/status. While SYNCED: snap model. While CONNECTING: may run
  // enter-SYNC from the status object. While OFFLINE: reachability only
  // (does not clobber a desk-owned timer).
  bool fetchStatus();
  void setState(ConnState next);
  void enterOffline(const char* reason);
  void enterUnpaired(const char* reason);
  void scheduleProbeRetry();
  void scheduleRediscover();
  bool inBootProbe() const;

  // Ordered enter-SYNC pipeline. Keeps CONN_CONNECTING (marker '.') until done.
  void enterSyncFromPhoneState(JsonObjectConst data);
  bool flushSessionQueue();
  // 1 = model updated (adopt ok or 409 body applied), 0 = snap to phone,
  // -1 = transport/auth failure (keep local timer).
  int tryAdoptLocalTimer();
  // force=true: always snap (enter-SYNC / adopt). force=false: SYNCED path
  // with wall-clock projection + stale-frame rejection.
  void applyPhoneObject(JsonObjectConst data, bool force = true);
  bool fetchAndCacheConfig();
  void cacheServerTime(JsonObjectConst data);
  double resolveLocalStartTime() const;
  // Enter-SYNC + SYNCED heartbeat config refresh / retry.
  void tickConfigRefresh();

  // Low-level HTTP. Returns status code (0 on transport failure). bodyOut optional.
  int httpRequest(const char* method, const char* path, const char* body,
                  String* bodyOut, uint16_t timeoutMs);
  // Discovery-only probe: GET /api/status against a candidate host without
  // mutating conn state (no enterUnpaired on 401). Used to pick among mDNS
  // responders. 200 = token ok; 401 = wrong server/token; 0 = transport fail.
  int probeHostStatus(const String& host, uint16_t port);

  TimerModel* model_ = nullptr;
  SessionQueue* queue_ = nullptr;
  ConfigStore* config_ = nullptr;
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
  // Wall time when the post-WiFi probe window opened (first DISCOVERING).
  unsigned long probeStartedAt_ = 0;
  bool probeActive_ = false;
  bool everSynced_ = false;
  uint8_t retryCount_ = 0;
  // True while enterSyncFromPhoneState is running (re-entrancy guard).
  bool enteringSync_ = false;
  // After OFFLINE REST proves the last host, skip mDNS once and reconnect to it.
  bool preferKnownHost_ = false;
  // Config refresh while SYNCED. lastConfigFetchAt_==0 means "soon".
  unsigned long lastConfigFetchAt_ = 0;
  bool configFetchFailed_ = false;
};
