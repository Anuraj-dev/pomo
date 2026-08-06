#include "PomoClient.h"

#include <ArduinoJson.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266WiFi.h>
#include <ESP8266mDNS.h>
#include <WebSocketsClient.h>
#include <string.h>

#include "secrets.h"

// KNOWN LIMITATION — this client is not actually non-blocking.
//
// HTTPClient::GET/POST, MDNS.queryService() and the TCP connect that happens
// inside WebSocketsClient::loop() are all synchronous. When the phone is
// unreachable, loop() can stall for roughly kHttpTimeoutMs on a poll or a
// command, plus the mDNS query time on a rediscovery pass. During that stall
// the buzzer, the button debounce and the display do not advance.
//
// This is accepted deliberately rather than overlooked: the timeouts below are
// kept short so the worst-case stall stays sub-second-ish and the UI only
// hitches rather than freezing. Making it genuinely non-blocking means
// replacing HTTPClient with an async TCP state machine (ESPAsyncTCP), which is
// a larger change than the first flash warrants.

namespace {

const unsigned long kPollIntervalMs = 30000;
const unsigned long kConnectingPollMs = 3000;    // faster REST while CONNECTING
const unsigned long kOfflineProbeMs = 5000;      // REST reachability while OFFLINE
const unsigned long kStaleAfterMs = 45000;       // SYNCED / CONNECTING → OFFLINE
// Each phase gets this budget separately: WiFi wait, then DISCOVERING restarts
// the clock on association (see tickWifi). Worst case ~2 * kBootProbeMs.
const unsigned long kBootProbeMs = 45000;
const unsigned long kRediscoverMs = 90000;       // OFFLINE baseline after fast retries
const unsigned long kProbeRetryMs = 1000;        // short retry inside probe
const unsigned long kUnpairedRetryMs = 300000;   // 5 minutes
// Config: periodic refresh with heartbeat; faster retry after a failed fetch.
const unsigned long kConfigRefreshMs = 30000;
const unsigned long kConfigRetryMs = 5000;
// Short first rediscover attempts after leave-SYNC / connect fail, then baseline.
const unsigned long kRediscoverFastMs[] = {3000UL, 8000UL, 20000UL};
const uint8_t kRediscoverFastCount =
    sizeof(kRediscoverFastMs) / sizeof(kRediscoverFastMs[0]);
// Short on purpose — see the blocking note above.
const uint16_t kHttpTimeoutMs = 1500;
// Import/adopt can be a larger body; still bounded.
const uint16_t kHttpFlushTimeoutMs = 4000;

WebSocketsClient webSocket;
PomoClient* activeClient = nullptr;

const char* connStateName(ConnState s) {
  switch (s) {
    case CONN_BOOT: return "BOOT";
    case CONN_WIFI: return "WIFI";
    case CONN_DISCOVERING: return "DISCOVERING";
    case CONN_CONNECTING: return "CONNECTING";
    case CONN_SYNCED: return "SYNCED";
    case CONN_OFFLINE: return "OFFLINE";
    case CONN_UNPAIRED: return "UNPAIRED";
  }
  return "UNKNOWN";
}

}  // namespace

void PomoClient::begin(TimerModel* model, SessionQueue* queue, ConfigStore* config) {
  model_ = model;
  queue_ = queue;
  config_ = config;
  activeClient = this;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  // Boot probe covers WiFi wait as well as post-WiFi DISCOVERING so a missing
  // SSID cannot leave the LCD on permanent "Starting up".
  probeStartedAt_ = millis();
  probeActive_ = true;
  setState(CONN_BOOT);
  Serial.println("[PomoClient] boot: waiting for WiFi");
}

void PomoClient::setPhaseCompleteHandler(void (*handler)(const char* phase)) {
  phaseCompleteHandler_ = handler;
}

bool PomoClient::inBootProbe() const {
  return probeActive_ && !everSynced_;
}

void PomoClient::setState(ConnState next) {
  if (state_ == next) return;
  const ConnState prev = state_;
  state_ = next;
  Serial.printf("[PomoClient] mode %s -> %s\n", connStateName(prev),
                connStateName(next));

  // Ownership: only OFFLINE / UNPAIRED run the local engine. SYNCED releases
  // the desk clock. CONNECTING / DISCOVERING keep whatever ownership they had
  // so a mid-session rediscover does not freeze buttons or dual-own.
  if (model_ == nullptr) return;
  if (next == CONN_OFFLINE || next == CONN_UNPAIRED) {
    model_->setLocalOwner(true);
  } else if (next == CONN_SYNCED) {
    model_->setLocalOwner(false);
    // Phone is sole live clock — drop offline reboot snapshot so a later
    // power cycle does not resurrect a desk session after successful sync.
    if (config_ != nullptr) {
      config_->clearTimerSnapshot();
    }
  } else if (prev == CONN_SYNCED &&
             (next == CONN_DISCOVERING || next == CONN_CONNECTING ||
              next == CONN_WIFI)) {
    // Explicit leave-SYNC path that did not go through enterOffline.
    model_->setLocalOwner(true);
  }
}

void PomoClient::enterOffline(const char* reason) {
  if (state_ == CONN_OFFLINE) return;
  Serial.printf("[PomoClient] leave SYNC/probe → OFFLINE: %s\n", reason);
  // Progressive rediscover backoff continues only across rediscover misses.
  // Fresh leave from SYNC / CONNECTING / boot starts with a short first retry
  // so reopening the phone app reconnects within seconds, not a fixed 90s.
  const bool continueBackoff = (state_ == CONN_DISCOVERING && !inBootProbe());
  if (!continueBackoff) {
    retryCount_ = 0;
  }
  probeActive_ = false;
  enteringSync_ = false;
  preferKnownHost_ = false;
  // Allow an immediate OFFLINE reachability probe on the next tick.
  lastPollAt_ = 0;
  // Persist epoch basis so offline session starts stay wall-clock aligned.
  if (config_ != nullptr) config_->save();
  scheduleRediscover();
  // Flip mode before disconnect so a nested DISCONNECTED callback is a no-op.
  setState(CONN_OFFLINE);
  webSocket.disconnect();
}

void PomoClient::enterUnpaired(const char* reason) {
  if (state_ == CONN_UNPAIRED) return;
  Serial.printf("[PomoClient] token rejected → UNPAIRED: %s (local timer stays usable)\n",
                reason);
  probeActive_ = false;
  enteringSync_ = false;
  if (config_ != nullptr) config_->save();
  retryStartedAt_ = millis();
  retryDelayMs_ = kUnpairedRetryMs;
  // Local owner on: unpaired is still offline-capable (marker '?').
  // Mode first so nested DISCONNECTED from disconnect() does not re-enter.
  setState(CONN_UNPAIRED);
  webSocket.disconnect();
}

void PomoClient::scheduleProbeRetry() {
  retryStartedAt_ = millis();
  retryDelayMs_ = kProbeRetryMs;
  if (retryCount_ < 5) retryCount_++;
}

void PomoClient::scheduleRediscover() {
  retryStartedAt_ = millis();
  // 3s → 8s → 20s → 90s baseline. retryCount_ advances on each schedule;
  // enterOffline resets it except after a rediscover miss.
  if (retryCount_ < kRediscoverFastCount) {
    retryDelayMs_ = kRediscoverFastMs[retryCount_];
  } else {
    retryDelayMs_ = kRediscoverMs;
  }
  if (retryCount_ < 250) retryCount_++;
  Serial.printf("[PomoClient] schedule rediscover in %lu ms (n=%u)\n",
                retryDelayMs_, (unsigned)retryCount_);
}

void PomoClient::tick() {
  // Pump only while a socket is part of the mode. OFFLINE / UNPAIRED / WIFI
  // rediscover is owned by the state machine; pumping in those modes lets the
  // library auto-reconnect and deliver state frames we would ignore (desk
  // would stay ~ forever despite a live phone).
  if (state_ == CONN_CONNECTING || state_ == CONN_SYNCED) {
    webSocket.loop();
  }

  tickProbeWatchdog();

  switch (state_) {
    case CONN_BOOT:
    case CONN_WIFI:
      tickWifi();
      break;
    case CONN_DISCOVERING:
      tickDiscovery();
      break;
    case CONN_OFFLINE:
      // Progressive rediscover (fast first retries, then 90s baseline). Stay
      // OFFLINE (marker ~) between attempts. Reconnect marker (.) only while
      // actively probing. Wait for WiFi first so we do not thrash discovery
      // while STA is still down.
      if (WiFi.status() != WL_CONNECTED) break;
      // Known host: probe REST so the phone reappearing triggers rediscover
      // within a few seconds without waiting out the full backoff.
      if (host_.length() > 0) {
        const unsigned long now = millis();
        if (lastPollAt_ == 0 || now - lastPollAt_ >= kOfflineProbeMs) {
          lastPollAt_ = now;
          if (fetchStatus()) {
            Serial.println(
                "[PomoClient] phone reachable while OFFLINE → reconnect known host");
            retryDelayMs_ = 0;
            retryCount_ = 0;
            // REST already reached this host — skip mDNS so a multicast miss
            // cannot throw away a working address.
            preferKnownHost_ = true;
            setState(CONN_DISCOVERING);
            break;
          }
        }
      }
      if (retryDelayMs_ != 0 && millis() - retryStartedAt_ >= retryDelayMs_) {
        retryDelayMs_ = 0;
        // Keep retryCount_ so the next miss continues progressive backoff.
        Serial.println("[PomoClient] rediscover timer elapsed → DISCOVERING");
        setState(CONN_DISCOVERING);
      }
      break;
    case CONN_CONNECTING:
    case CONN_SYNCED:
      tickWebSocket();
      tickHeartbeat();
      break;
    case CONN_UNPAIRED:
      // Not terminal, but deliberately slow. Local timer stays usable (marker ?).
      if (millis() - retryStartedAt_ >= retryDelayMs_) {
        Serial.println("[PomoClient] unpaired cooldown over, re-discovering");
        retryCount_ = 0;
        retryDelayMs_ = 0;
        setState(CONN_DISCOVERING);
      }
      break;
  }
}

void PomoClient::tickProbeWatchdog() {
  if (state_ == CONN_SYNCED || state_ == CONN_OFFLINE || state_ == CONN_UNPAIRED) {
    return;
  }
  // Never abort mid enter-SYNC (import/adopt/config) or mid handshake —
  // tickHeartbeat's CONNECTING stale (kStaleAfterMs) owns those timeouts.
  if (enteringSync_) return;
  if (state_ == CONN_CONNECTING) return;

  // BOOT / WIFI: do not strand without local ownership if STA never associates.
  if (state_ == CONN_BOOT || state_ == CONN_WIFI) {
    const wl_status_t st = WiFi.status();
    if (st == WL_NO_SSID_AVAIL || st == WL_CONNECT_FAILED) {
      Serial.printf("[PomoClient] WiFi hard fail status=%d → OFFLINE\n", (int)st);
      enterOffline("wifi hard fail");
      return;
    }
    if (probeActive_ && (millis() - probeStartedAt_ >= kBootProbeMs)) {
      Serial.println("[PomoClient] boot WiFi wait timeout → OFFLINE");
      enterOffline("boot wifi timeout");
    }
    return;
  }

  // DISCOVERING boot probe only (post-WiFi window).
  if (!inBootProbe()) return;
  if (millis() - probeStartedAt_ < kBootProbeMs) return;

  // Still DISCOVERING past the boot window — desk becomes usable now.
  Serial.println("[PomoClient] boot probe timeout (DISCOVERING window elapsed)");
  enterOffline("boot probe timeout");
}

void PomoClient::tickWifi() {
  if (WiFi.status() != WL_CONNECTED) {
    // Hard-fail / timeout owned by tickProbeWatchdog so BOOT and WIFI cannot
    // stick on "Starting up" with buttons ignored.
    return;
  }

  Serial.print("[PomoClient] WiFi up, IP ");
  Serial.println(WiFi.localIP());
  if (!MDNS.begin("pomolink")) {
    Serial.println("[PomoClient] mDNS responder failed to start");
  }
  retryCount_ = 0;
  retryDelayMs_ = 0;
  // Fresh post-WiFi DISCOVERING window (boot probe budget restarts here).
  probeStartedAt_ = millis();
  probeActive_ = true;
  setState(CONN_DISCOVERING);
}

void PomoClient::tickDiscovery() {
  if (WiFi.status() != WL_CONNECTED) {
    // During rediscover WiFi may drop; prefer offline-usable over a stuck probe.
    if (everSynced_ || !inBootProbe()) {
      enterOffline("wifi lost during discovery");
    } else {
      setState(CONN_WIFI);
    }
    return;
  }
  if (retryDelayMs_ != 0 && millis() - retryStartedAt_ < retryDelayMs_) return;

  // A configured host wins outright. mDNS hands the pairing token to whatever
  // answers _pomo._tcp first, and a bearer token cannot authenticate the server
  // it is sent to — so pinning the host in secrets.h is the way to opt out of
  // trusting the LAN, not merely a fallback for routers that block multicast.
  // After an OFFLINE REST probe proves the last host, reuse it once without
  // mDNS so a multicast miss cannot discard a working address.
  if (strlen(POMO_HOST_FALLBACK) > 0) {
    preferKnownHost_ = false;
    host_ = POMO_HOST_FALLBACK;
    port_ = POMO_PORT_FALLBACK;
    Serial.printf("[PomoClient] using configured host %s:%u (mDNS not queried)\n",
                  host_.c_str(), port_);
  } else if (preferKnownHost_ && host_.length() > 0 && port_ > 0) {
    preferKnownHost_ = false;
    Serial.printf("[PomoClient] reusing known host %s:%u (REST-proven)\n",
                  host_.c_str(), port_);
  } else {
    preferKnownHost_ = false;
    MDNS.update();
    const int found = MDNS.queryService("pomo", "tcp");
    if (found <= 0) {
      Serial.println("[PomoClient] mDNS miss, no configured host");
      if (inBootProbe()) {
        // Keep trying quickly inside the boot probe window; the watchdog flips
        // OFFLINE only while still DISCOVERING (not during CONNECTING).
        scheduleProbeRetry();
      } else {
        // Rediscover miss — back to OFFLINE; progressive backoff keeps local
        // ownership (fast first retries, then 90s baseline).
        enterOffline("mDNS miss on rediscover");
      }
      return;
    }
    // Multiple _pomo._tcp responders (dev + release, or two phones) are common.
    // Blind first-responder pick can bind the wrong token/server. Probe each
    // with GET /api/status using our token; take the first HTTP 200.
    bool picked = false;
    int unauthorized = 0;
    for (int i = 0; i < found; i++) {
      const String candidateHost = MDNS.IP(i).toString();
      const uint16_t candidatePort = MDNS.port(i);
      Serial.printf("[PomoClient] mDNS candidate %d/%d %s:%u — probing token\n",
                    i + 1, found, candidateHost.c_str(), candidatePort);
      const int code = probeHostStatus(candidateHost, candidatePort);
      if (code == 200) {
        host_ = candidateHost;
        port_ = candidatePort;
        picked = true;
        Serial.printf("[PomoClient] discovered %s:%u via mDNS (selected %d of %d)\n",
                      host_.c_str(), port_, i + 1, found);
        break;
      }
      if (code == 401) {
        unauthorized++;
        Serial.printf("[PomoClient] candidate %s:%u rejected token (401)\n",
                      candidateHost.c_str(), candidatePort);
        continue;
      }
      Serial.printf("[PomoClient] candidate %s:%u probe code=%d\n",
                    candidateHost.c_str(), candidatePort, code);
    }
    if (!picked) {
      if (unauthorized > 0 && unauthorized == found) {
        // Every responder rejected the token — genuine unpaired, not a miss.
        Serial.println("[PomoClient] all mDNS responders rejected token");
        enterUnpaired("mDNS all 401");
        return;
      }
      Serial.printf("[PomoClient] mDNS had %d responders but none authed\n", found);
      if (inBootProbe()) {
        scheduleProbeRetry();
      } else {
        enterOffline("mDNS candidates failed auth/reachability");
      }
      return;
    }
  }

  webSocket.begin(host_, port_, "/ws");
  webSocket.onEvent([](WStype_t type, uint8_t* payload, size_t length) {
    if (activeClient == nullptr) return;
    if (type == WStype_CONNECTED) {
      // Refresh so the hello / first-state wait starts now, not at begin().
      activeClient->onWebSocketConnected();
      char hello[160];
      snprintf(hello, sizeof(hello), "{\"type\":\"hello\",\"token\":\"%s\"}", POMO_TOKEN);
      webSocket.sendTXT(hello);
      Serial.println("[PomoClient] WS connected, hello sent");
    } else if (type == WStype_TEXT) {
      activeClient->onWebSocketText((const char*)payload, length);
    } else if (type == WStype_DISCONNECTED) {
      activeClient->onWebSocketDisconnected();
    }
  });
  // Do not auto-reconnect under us: the state machine owns rediscover cadence
  // (fast retries → 90s baseline / 5min unpaired) so the LCD marker stays honest.
  webSocket.setReconnectInterval(kRediscoverMs);

  lastContactAt_ = millis();
  // Seeded so CONNECTING has a full kStaleAfterMs window to open the socket
  // (boot watchdog does not hard-cut CONN_CONNECTING).
  lastSocketContactAt_ = lastContactAt_;
  lastPollAt_ = 0;
  retryDelayMs_ = 0;
  setState(CONN_CONNECTING);
}

void PomoClient::tickWebSocket() {
  if (WiFi.status() != WL_CONNECTED) {
    // WiFi loss means the phone is unreachable: take the local clock rather
    // than parking in CONN_WIFI with no ownership (which would freeze control).
    enterOffline("wifi lost");
  }
}

void PomoClient::tickHeartbeat() {
  const unsigned long now = millis();

  // Poll REST: every 30s while SYNCED (drift + half-open detect); faster while
  // CONNECTING so a healthy phone can complete enter-SYNC via /api/status when
  // the first WS state frame never arrives (reconnect dead-end fix).
  const unsigned long pollEvery =
      (state_ == CONN_CONNECTING) ? kConnectingPollMs : kPollIntervalMs;
  if (lastPollAt_ == 0 || now - lastPollAt_ >= pollEvery) {
    lastPollAt_ = now;
    if (fetchStatus()) {
      lastContactAt_ = now;
    }
  }

  // Phone setting changes while SYNCED: refresh /api/config with the heartbeat
  // (or sooner after a failed enter-SYNC / periodic fetch).
  if (state_ == CONN_SYNCED && !enteringSync_) {
    tickConfigRefresh();
  }

  // Socket stale uses kStaleAfterMs for both SYNCED and CONNECTING (boot or
  // rediscover). DISCOVERING-phase boot misses are owned only by
  // tickProbeWatchdog (kBootProbeMs). While enter-SYNC is in progress, do not
  // tear down mid-import/adopt/config.
  // REST contact must not refresh lastSocketContactAt_ (half-open sockets).
  if (!enteringSync_ && state_ != CONN_UNPAIRED &&
      (now - lastSocketContactAt_) >= kStaleAfterMs) {
    if (state_ == CONN_SYNCED) {
      Serial.println("[PomoClient] heartbeat stale: SYNCED socket");
      enterOffline("stale socket");
    } else if (state_ == CONN_CONNECTING) {
      // Handshake / first-state wait exceeded kStaleAfterMs.
      if (inBootProbe()) {
        Serial.println("[PomoClient] heartbeat stale: boot connect");
        enterOffline("boot connect stale");
      } else {
        Serial.println("[PomoClient] heartbeat stale: reconnect connect");
        enterOffline("reconnect stale");
      }
    }
  }
}

void PomoClient::tickConfigRefresh() {
  const unsigned long now = millis();
  const unsigned long every =
      configFetchFailed_ ? kConfigRetryMs : kConfigRefreshMs;
  if (lastConfigFetchAt_ != 0 && now - lastConfigFetchAt_ < every) return;

  lastConfigFetchAt_ = now;
  if (fetchAndCacheConfig()) {
    configFetchFailed_ = false;
  } else {
    configFetchFailed_ = true;
    Serial.println("[PomoClient] config refresh failed; will retry");
  }
}

void PomoClient::onWebSocketConnected() {
  lastContactAt_ = millis();
  lastSocketContactAt_ = lastContactAt_;
}

void PomoClient::onWebSocketText(const char* payload, size_t length) {
  // A frame that arrives after the token was rejected must not resurrect the
  // connection or silently re-enable commands.
  if (state_ == CONN_UNPAIRED) return;

  JsonDocument doc;
  const DeserializationError error = deserializeJson(doc, payload, length);
  if (error) {
    Serial.printf("[PomoClient] bad frame: %s\n", error.c_str());
    return;
  }

  const char* type = doc["type"] | "";
  lastContactAt_ = millis();
  lastSocketContactAt_ = lastContactAt_;

  if (strcmp(type, "state") == 0) {
    JsonObject data = doc["data"];
    if (data.isNull()) return;

    if (state_ == CONN_SYNCED) {
      // Steady-state SYNC: phone is sole clock. Apply against the existing
      // epoch basis first so lag projection (rem -= epochNow - server_time)
      // can run; then re-anchor. force=false drops stale frames.
      applyPhoneObject(data, /*force=*/false);
      cacheServerTime(data);
      return;
    }

    if (state_ == CONN_CONNECTING && !enteringSync_) {
      // Ordered enter-SYNC pipeline; marker stays '.' until complete.
      enterSyncFromPhoneState(data);
      return;
    }
    return;
  }

  if (strcmp(type, "event") == 0) {
    // phase_complete only drives the buzzer while the phone owns the clock.
    // During CONNECTING the desk may still own a local timer.
    if (state_ != CONN_SYNCED) return;
    const char* event = doc["event"] | "";
    if (strcmp(event, "phase_complete") == 0 && phaseCompleteHandler_ != nullptr) {
      phaseCompleteHandler_(doc["phase"] | "work");
    }
    return;
  }

  // Unknown frame types are ignored by contract — see docs/protocol.md.
}

void PomoClient::onWebSocketDisconnected() {
  if (state_ == CONN_UNPAIRED || state_ == CONN_OFFLINE) return;
  if (enteringSync_) {
    // Mid flush/adopt: let the HTTP path surface 401 or transport fail.
    Serial.println("[PomoClient] WS drop during enter-SYNC pipeline");
    return;
  }

  if (state_ == CONN_CONNECTING) {
    // Phone closes immediately after a bad hello without a REST 401 path.
    // Probe /api/status: 401 → UNPAIRED (?); 200 → enter-SYNC via status JSON
    // (reconnect dead-end fix — do not wait for socket stale + 90s rediscover).
    Serial.println("[PomoClient] WS drop while CONNECTING — probing REST status");
    fetchStatus();
    return;
  }

  if (state_ == CONN_SYNCED) {
    // Immediate leave-SYNC on socket loss (faster than waiting for 45s stale).
    enterOffline("ws disconnected");
  }
}

void PomoClient::cacheServerTime(JsonObjectConst data) {
  if (config_ == nullptr) return;
  if (data["server_time"].isNull()) return;
  const long serverTime = data["server_time"] | 0L;
  if (serverTime <= 0) return;
  // Do not regress wall-clock from delayed/out-of-order frames. Compare
  // against estimateEpochNow (not only epochSec_) so elapsed millis since
  // the last sample is preserved when the phone sample is older than now.
  if (config_->hasEpoch() && serverTime < config_->estimateEpochNow()) {
    return;
  }
  // RAM only on the hot path — flash is written on enter/leave SYNC and config fetch.
  config_->setEpochBasis(serverTime, millis());
}

void PomoClient::applyPhoneObject(JsonObjectConst data, bool force) {
  if (model_ == nullptr) return;
  const double startTime = data["start_time"] | 0.0;
  long serverTime = 0;
  if (!data["server_time"].isNull()) {
    serverTime = data["server_time"] | 0L;
    if (serverTime < 0) serverTime = 0;
  }
  long epochNow = 0;
  if (config_ != nullptr && config_->hasEpoch()) {
    epochNow = config_->estimateEpochNow();
  } else if (serverTime > 0) {
    // No prior basis: treat the snapshot as current (lag unknown).
    epochNow = serverTime;
  }
  // daily_goal may be 0 on the phone; only fall back when the field is absent.
  int goal = 8;
  if (!data["daily_goal"].isNull()) {
    goal = data["daily_goal"] | 0;
    if (goal < 0) goal = 0;
  }
  if (!model_->applyState(data["status"] | "stopped", data["phase"] | "work",
                          data["remaining"] | 0.0, data["duration"] | 0.0,
                          data["completed"] | 0, goal, startTime, serverTime,
                          epochNow, force)) {
    Serial.println("[PomoClient] state frame ignored (stale/out-of-order)");
  }
}

void PomoClient::enterSyncFromPhoneState(JsonObjectConst data) {
  if (model_ == nullptr) return;
  enteringSync_ = true;
  Serial.println("[PomoClient] enter SYNC pipeline start");

  // (1) Phone snapshot ok (WS state frame or REST /api/status while CONNECTING).
  cacheServerTime(data);

  // Snapshot phone status before any blocking HTTP so we can decide adopt.
  char phoneStatus[10];
  strncpy(phoneStatus, data["status"] | "stopped", sizeof(phoneStatus) - 1);
  phoneStatus[sizeof(phoneStatus) - 1] = '\0';
  const bool phoneStopped = (strcmp(phoneStatus, "stopped") == 0);
  // Restored flash sessions are live but localOwner_ stays false until
  // OFFLINE/UNPAIRED (CONNECTING preserves ownership). On first enter-SYNC
  // this boot, treat a live model as desk-owned so we still try adopt
  // (phone-stopped + restored live) instead of skip desk_idle → snap.
  const bool deskLive =
      model_->isLive() && (model_->isLocalOwner() || !everSynced_);

  // (2)+(3) Flush offline history; drop accepted client_ids from flash queue.
  const bool flushOk = flushSessionQueue();
  Serial.printf("[PomoClient] flush result=%s\n", flushOk ? "ok" : "failed");
  if (state_ == CONN_UNPAIRED) {
    enteringSync_ = false;
    Serial.println("[PomoClient] enter SYNC aborted (unpaired during import)");
    return;
  }

  // (4)+(5) Least remaining wins when both are live; never dual clocks after merge.
  // tryAdopt: 1 = model phone-side (adopt ok or 409 body), 0 = snap, -1 = transport.
  // Phone stopped + desk live → always try adopt.
  // Both live → adopt only if desk rem < phone rem (strict); else snap phone_wins.
  // Missing phone rem → try adopt and let the phone decide.
  // Desk idle → snap. Transport fail: keep local only when phone was stopped.
  if (deskLive) {
    bool shouldTryAdopt = true;
    if (phoneStopped) {
      Serial.println("[PomoClient] desk live + phone stopped → try adopt");
    } else if (!data["remaining"].isNull()) {
      const long phoneRem = (long)(data["remaining"] | 0.0);
      const long deskRem = model_->displayedSeconds();
      if (deskRem < phoneRem) {
        Serial.printf(
            "[PomoClient] desk shorter rem=%ld < phone rem=%ld → try adopt\n",
            deskRem, phoneRem);
      } else {
        Serial.printf(
            "[PomoClient] desk longer/equal rem=%ld >= phone rem=%ld → snap "
            "phone_wins\n",
            deskRem, phoneRem);
        shouldTryAdopt = false;
        applyPhoneObject(data);
      }
    } else {
      // Phone live but remaining absent from snapshot — let the phone decide.
      Serial.println(
          "[PomoClient] desk live + phone live, phone rem missing → try adopt");
    }

    if (shouldTryAdopt) {
      const int adoptResult = tryAdoptLocalTimer();
      if (state_ == CONN_UNPAIRED) {
        enteringSync_ = false;
        Serial.println("[PomoClient] enter SYNC aborted (unpaired during adopt)");
        return;
      }
      if (adoptResult < 0) {
        if (phoneStopped) {
          // Transport failure: do not throw away a live local timer for a stopped phone.
          enteringSync_ = false;
          Serial.println("[PomoClient] adopt result=transport_fail (keep local)");
          enterOffline("adopt transport fail");
          return;
        }
        // Phone was already active on WS: snap rather than dual-clock offline.
        Serial.println(
            "[PomoClient] adopt result=transport_fail phone_active → snap");
        applyPhoneObject(data);
      } else if (adoptResult == 0) {
        // 409 without body (or unexpected): snap to the WS snapshot we already hold.
        Serial.println("[PomoClient] adopt result=snap (not applied)");
        applyPhoneObject(data);
      } else {
        Serial.println("[PomoClient] adopt result=ok (phone owns clock)");
      }
    }
  } else {
    Serial.println("[PomoClient] adopt result=skip desk_idle → snap");
    applyPhoneObject(data);
  }

  // (6) Cache GET /api/config + persist epoch basis to flash. Always attempt;
  // on failure retry once immediately, then keep retrying while SYNCED.
  if (!fetchAndCacheConfig()) {
    Serial.println("[PomoClient] config fetch failed on enter-SYNC; retrying once");
    if (!fetchAndCacheConfig()) {
      Serial.println(
          "[PomoClient] config fetch retry failed; will retry while SYNCED");
      configFetchFailed_ = true;
    } else {
      configFetchFailed_ = false;
    }
  } else {
    configFetchFailed_ = false;
  }
  lastConfigFetchAt_ = millis();
  if (state_ == CONN_UNPAIRED) {
    enteringSync_ = false;
    Serial.println("[PomoClient] enter SYNC aborted (unpaired during config)");
    return;
  }
  if (config_ != nullptr) config_->save();

  retryCount_ = 0;
  probeActive_ = false;
  everSynced_ = true;
  enteringSync_ = false;
  // Full stale window after enter-SYNC (WS- or REST-promoted). A REST-only
  // promote must not be torn down immediately by a pre-pipeline socket seed.
  lastContactAt_ = millis();
  lastSocketContactAt_ = lastContactAt_;
  setState(CONN_SYNCED);
  Serial.println("[PomoClient] enter SYNC pipeline done → SYNCED");
}

bool PomoClient::flushSessionQueue() {
  if (queue_ == nullptr || queue_->empty()) {
    Serial.println("[PomoClient] flush skip: empty queue");
    return true;
  }
  if (host_.length() == 0) {
    Serial.println("[PomoClient] flush failed: no host");
    return false;
  }

  // Drop absurd starts (e.g. from a pre-fix reboot millis wrap) so the phone
  // assigns wall time instead of rejecting rows that would stick forever.
  if (config_ != nullptr && config_->hasEpoch()) {
    queue_->stripImplausibleStarts(config_->estimateEpochNow());
  }

  JsonDocument doc;
  doc["source"] = "desk";
  JsonArray sessions = doc["sessions"].to<JsonArray>();
  for (int i = 0; i < queue_->count(); i++) {
    const QueuedSession& s = queue_->at(i);
    JsonObject row = sessions.add<JsonObject>();
    row["client_id"] = s.clientId;
    row["type"] = s.type;
    row["duration"] = s.durationSec;
    row["completed"] = true;
    if (s.hasStart) row["start"] = s.start;
    if (s.tag[0] != '\0') row["tag"] = s.tag;
  }

  String body;
  serializeJson(doc, body);
  Serial.printf("[PomoClient] flush POST /api/sessions/import count=%d bytes=%u\n",
                queue_->count(), (unsigned)body.length());

  String response;
  const int code =
      httpRequest("POST", "/api/sessions/import", body.c_str(), &response,
                  kHttpFlushTimeoutMs);
  if (code == 401) {
    // httpRequest already flipped UNPAIRED.
    Serial.println("[PomoClient] flush rejected: unauthorized");
    return false;
  }
  if (code != 200) {
    Serial.printf("[PomoClient] flush rejected: http %d\n", code);
    return false;
  }

  JsonDocument resp;
  if (deserializeJson(resp, response)) {
    Serial.println("[PomoClient] flush rejected: response parse failed");
    return false;
  }

  JsonArray accepted = resp["accepted"].as<JsonArray>();
  if (accepted.isNull()) {
    Serial.println("[PomoClient] flush rejected: no accepted array");
    return resp["success"] | false;
  }

  // Collect accepted client_ids for drop (bounded by queue capacity).
  const char* ids[SessionQueue::kCapacity];
  char idStorage[SessionQueue::kCapacity][24];
  int n = 0;
  for (JsonVariant v : accepted) {
    if (n >= SessionQueue::kCapacity) break;
    const char* id = v.as<const char*>();
    if (id == nullptr || id[0] == '\0') continue;
    strncpy(idStorage[n], id, sizeof(idStorage[n]) - 1);
    idStorage[n][sizeof(idStorage[n]) - 1] = '\0';
    ids[n] = idStorage[n];
    n++;
  }
  queue_->dropAccepted(ids, n);

  int rejectedCount = 0;
  JsonArray rejected = resp["rejected"].as<JsonArray>();
  if (!rejected.isNull()) {
    for (JsonObject row : rejected) {
      rejectedCount++;
      Serial.printf("[PomoClient] flush row rejected id=%s err=%s\n",
                    row["client_id"] | "", row["error"] | "");
    }
  }

  Serial.printf("[PomoClient] flush accepted=%d rejected=%d queue_remaining=%d\n",
                n, rejectedCount, queue_->count());
  return true;
}

double PomoClient::resolveLocalStartTime() const {
  if (model_ == nullptr) return 0.0;
  if (model_->startTime() > 0.0) return model_->startTime();
  if (config_ == nullptr || !config_->hasEpoch()) return 0.0;

  // Reconstruct: phase started (duration - remaining) seconds ago.
  const long rem = model_->displayedSeconds();
  long elapsed = (long)model_->duration() - rem;
  if (elapsed < 0) elapsed = 0;
  const long now = config_->estimateEpochNow();
  long start = now - elapsed;
  if (start < 0) start = 0;
  return (double)start;
}

int PomoClient::tryAdoptLocalTimer() {
  if (model_ == nullptr || host_.length() == 0) return -1;

  const double remaining = (double)model_->displayedSeconds();
  double duration = model_->duration();
  if (duration <= 0.0) duration = remaining > 0.0 ? remaining : 1.0;
  double remClamped = remaining;
  if (remClamped < 0.0) remClamped = 0.0;
  if (remClamped > duration) remClamped = duration;

  JsonDocument doc;
  doc["status"] = model_->status();
  doc["phase"] = model_->phase();
  doc["remaining"] = remClamped;
  doc["duration"] = duration;
  doc["start_time"] = resolveLocalStartTime();
  doc["completed"] = model_->completed();
  doc["daily_goal"] = model_->goal();
  doc["tag"] = "";

  String body;
  serializeJson(doc, body);
  Serial.printf("[PomoClient] POST /api/timer/adopt body=%s\n", body.c_str());

  String response;
  const int code = httpRequest("POST", "/api/timer/adopt", body.c_str(),
                               &response, kHttpFlushTimeoutMs);

  if (code == 401) {
    Serial.println("[PomoClient] adopt result=unauthorized");
    return -1;
  }
  if (code == 0) {
    Serial.println("[PomoClient] adopt result=transport_fail");
    return -1;
  }

  if (code == 409) {
    Serial.println("[PomoClient] adopt result=409 timer_busy");
    JsonDocument resp;
    if (!deserializeJson(resp, response)) {
      JsonObject state = resp["state"];
      if (!state.isNull()) {
        applyPhoneObject(state);
        Serial.println("[PomoClient] adopt 409 applied phone state");
        return 1;  // model is phone; not adopted, but no further snap needed
      }
    }
    // Caller snaps to the original WS snapshot.
    return 0;
  }

  if (code != 200) {
    Serial.printf("[PomoClient] adopt result=http_%d (snap)\n", code);
    // Unexpected HTTP from a reachable phone — snap rather than dual-clock.
    return 0;
  }

  JsonDocument resp;
  if (deserializeJson(resp, response)) {
    Serial.println("[PomoClient] adopt result=parse_fail (apply local payload)");
    // HTTP 200: release desk clock with the payload we sent until next state.
    model_->applyState(model_->status(), model_->phase(), remClamped, duration,
                       model_->completed(), model_->goal(),
                       resolveLocalStartTime());
    return 1;
  }

  if (!(resp["success"] | false)) {
    Serial.println("[PomoClient] adopt result=success_false (snap)");
    return 0;
  }

  JsonObject state = resp["state"];
  if (!state.isNull()) {
    applyPhoneObject(state);
  } else {
    model_->applyState(model_->status(), model_->phase(), remClamped, duration,
                       model_->completed(), model_->goal(),
                       resolveLocalStartTime());
  }
  Serial.println("[PomoClient] adopt result=ok");
  return 1;
}

bool PomoClient::fetchAndCacheConfig() {
  if (host_.length() == 0 || config_ == nullptr) {
    Serial.println("[PomoClient] GET /api/config skipped: no host/config");
    return false;
  }

  String response;
  const int code =
      httpRequest("GET", "/api/config", nullptr, &response, kHttpTimeoutMs);
  if (code != 200) {
    Serial.printf("[PomoClient] GET /api/config failed code=%d\n", code);
    return false;
  }

  JsonDocument doc;
  if (deserializeJson(doc, response)) {
    Serial.println("[PomoClient] config parse failed");
    return false;
  }

  JsonObject durations = doc["durations"];
  const int work = durations["work"] | config_->workMinutes();
  const int shortM = durations["short_break"] | config_->shortMinutes();
  const int longM = durations["long_break"] | config_->longMinutes();
  const int longAfter = doc["long_break_after"] | config_->longAfter();
  // daily_goal is non-negative; 0 is valid. Only fall back when absent.
  int goal = config_->goal();
  if (!doc["daily_goal"].isNull()) {
    goal = doc["daily_goal"] | 0;
    if (goal < 0) goal = 0;
  }

  config_->setDurations(work, shortM, longM, longAfter, goal);
  config_->save();

  if (model_ != nullptr) {
    model_->setConfig(work, shortM, longM, longAfter, goal);
  }
  Serial.printf("[PomoClient] config cached %d/%d/%d after=%d goal=%d\n", work,
                shortM, longM, longAfter, goal);
  return true;
}

int PomoClient::probeHostStatus(const String& host, uint16_t port) {
  if (host.length() == 0 || port == 0) return 0;

  WiFiClient client;
  HTTPClient http;
  char url[96];
  snprintf(url, sizeof(url), "http://%s:%u/api/status", host.c_str(), port);

  http.setTimeout(kHttpTimeoutMs);
  if (!http.begin(client, url)) return 0;
  http.addHeader("X-Pomo-Token", POMO_TOKEN);
  const int code = http.GET();
  http.end();
  return code > 0 ? code : 0;
}

int PomoClient::httpRequest(const char* method, const char* path, const char* body,
                            String* bodyOut, uint16_t timeoutMs) {
  if (host_.length() == 0) return 0;

  WiFiClient client;
  HTTPClient http;
  char url[96];
  snprintf(url, sizeof(url), "http://%s:%u%s", host_.c_str(), port_, path);

  http.setTimeout(timeoutMs);
  if (!http.begin(client, url)) return 0;
  http.addHeader("X-Pomo-Token", POMO_TOKEN);
  if (body != nullptr) {
    http.addHeader("Content-Type", "application/json");
  }

  int code = 0;
  if (strcmp(method, "GET") == 0) {
    code = http.GET();
  } else if (strcmp(method, "POST") == 0) {
    code = http.POST(body == nullptr ? "" : body);
  } else {
    http.end();
    return 0;
  }

  if (code == 401) {
    if (bodyOut != nullptr) *bodyOut = http.getString();
    http.end();
    enterUnpaired(path);
    return 401;
  }

  if (bodyOut != nullptr) {
    *bodyOut = http.getString();
  }
  http.end();

  if (code > 0 && code < 500) {
    lastContactAt_ = millis();
  }
  return code;
}

bool PomoClient::fetchStatus() {
  if (host_.length() == 0) return false;

  String response;
  const int code =
      httpRequest("GET", "/api/status", nullptr, &response, kHttpTimeoutMs);
  if (code == 401) return false;
  if (code != 200) return false;

  JsonDocument doc;
  if (deserializeJson(doc, response)) return false;

  // SYNCED: REST snaps the model (drift correction / missed broadcast) with
  // the same lag projection + stale rejection as WS state frames.
  // CONNECTING: successful status proves the phone is reachable + authed —
  // run the same ordered enter-SYNC pipeline as the first WS state frame so
  // a missing WS state cannot leave us stuck in CONNECTING until stale.
  // OFFLINE / other: reachability only — never clobber a desk-owned timer
  // before ordered enter-SYNC (import/adopt) runs.
  if (state_ == CONN_SYNCED) {
    // Apply first (lag project on existing basis), then re-anchor epoch.
    applyPhoneObject(doc.as<JsonObject>(), /*force=*/false);
    cacheServerTime(doc.as<JsonObject>());
  } else if (state_ == CONN_CONNECTING && !enteringSync_) {
    Serial.println(
        "[PomoClient] REST /api/status while CONNECTING → enter SYNC pipeline");
    enterSyncFromPhoneState(doc.as<JsonObject>());
  }
  return true;
}

bool PomoClient::postCommand(const char* path, const char* body) {
  const int code =
      httpRequest("POST", path, body == nullptr ? "" : body, nullptr,
                  kHttpTimeoutMs);
  if (code == 200) return true;
  if (code != 401 && code != 0) {
    Serial.printf("[PomoClient] %s failed, code %d\n", path, code);
  }
  return false;
}

void PomoClient::sendGesture(Gesture gesture) {
  if (gesture == GESTURE_NONE) return;

  if (state_ == CONN_SYNCED) {
    switch (gesture) {
      case GESTURE_SINGLE:
        postCommand("/api/toggle", "");
        break;
      case GESTURE_DOUBLE:
        postCommand("/api/skip", "");
        break;
      case GESTURE_TRIPLE:
        postCommand("/api/reset", "");
        break;
      case GESTURE_HOLD:
        postCommand("/api/extend", "{\"seconds_delta\":300}");
        break;
      case GESTURE_NONE:
        break;
    }
    return;
  }

  // Desk-owned clock: OFFLINE / UNPAIRED, and still owned during rediscover
  // CONNECTING so a mid-session reconnect attempt does not freeze the button.
  // Boot probe (no local owner yet) ignores gestures.
  if (model_ == nullptr || !model_->isLocalOwner()) return;

  switch (gesture) {
    case GESTURE_SINGLE: {
      const bool wasStopped = model_->isStopped();
      model_->toggle();
      // Stamp local start_time when a phase leaves stopped → running and we
      // have a phone epoch basis (helps adopt identity).
      if (wasStopped && model_->isRunning() && config_ != nullptr &&
          config_->hasEpoch()) {
        model_->setStartTime((double)config_->estimateEpochNow());
      }
      break;
    }
    case GESTURE_DOUBLE:
      model_->skip();
      break;
    case GESTURE_TRIPLE:
      model_->reset();
      break;
    case GESTURE_HOLD:
      model_->extend(300);
      break;
    case GESTURE_NONE:
      break;
  }
}
