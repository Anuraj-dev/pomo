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
const unsigned long kStaleAfterMs = 45000;
const unsigned long kBaseRetryMs = 1000;
const unsigned long kMaxRetryMs = 30000;
// A 401 must not brick the device: a rogue LAN responder could answer the mDNS
// query and reject us forever. Re-discover after this long instead.
const unsigned long kUnpairedRetryMs = 300000;  // 5 minutes
// Short on purpose — see the blocking note above.
const uint16_t kHttpTimeoutMs = 1500;

WebSocketsClient webSocket;
PomoClient* activeClient = nullptr;

}  // namespace

void PomoClient::begin(TimerModel* model) {
  model_ = model;
  activeClient = this;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  setState(CONN_WIFI);
}

void PomoClient::setPhaseCompleteHandler(void (*handler)(const char* phase)) {
  phaseCompleteHandler_ = handler;
}

void PomoClient::setState(ConnState next) {
  if (state_ == next) return;
  state_ = next;
  Serial.printf("[PomoClient] state -> %d\n", (int)next);
}

void PomoClient::scheduleRetry() {
  unsigned long backoff = kBaseRetryMs << (retryCount_ < 5 ? retryCount_ : 5);
  if (backoff > kMaxRetryMs) backoff = kMaxRetryMs;
  if (retryCount_ < 5) retryCount_++;
  retryStartedAt_ = millis();
  retryDelayMs_ = backoff;
}

void PomoClient::tick() {
  // Not pumped while unpaired: the socket would otherwise keep auto-reconnecting
  // and re-sending the token the phone has already rejected.
  if (state_ != CONN_UNPAIRED) webSocket.loop();

  switch (state_) {
    case CONN_BOOT:
    case CONN_WIFI:
      tickWifi();
      break;
    case CONN_DISCOVERING:
      tickDiscovery();
      break;
    case CONN_OFFLINE:
      // Stay visibly OFFLINE while retrying, so the LCD keeps showing '!'
      // instead of flickering back to the connecting marker every backoff.
      tickDiscovery();
      break;
    case CONN_CONNECTING:
    case CONN_SYNCED:
      tickWebSocket();
      tickHeartbeat();
      break;
    case CONN_UNPAIRED:
      // Not terminal, but deliberately slow. A 401 from a rogue mDNS responder
      // must not brick the device, so after kUnpairedRetryMs we re-discover and
      // may find the real phone. A genuinely rotated token simply 401s again
      // five minutes later, which is a slow blink of '?' on the LCD rather than
      // hammering the phone's unauthorized rate limiter — and still tells the
      // user to reflash.
      if (millis() - retryStartedAt_ >= retryDelayMs_) {
        Serial.println("[PomoClient] unpaired cooldown over, re-discovering");
        retryCount_ = 0;
        retryDelayMs_ = 0;
        setState(CONN_DISCOVERING);
      }
      break;
  }
}

void PomoClient::tickWifi() {
  if (WiFi.status() != WL_CONNECTED) return;

  Serial.print("[PomoClient] WiFi up, IP ");
  Serial.println(WiFi.localIP());
  if (!MDNS.begin("pomolink")) {
    Serial.println("[PomoClient] mDNS responder failed to start");
  }
  retryCount_ = 0;
  retryDelayMs_ = 0;
  setState(CONN_DISCOVERING);
}

void PomoClient::tickDiscovery() {
  if (WiFi.status() != WL_CONNECTED) {
    setState(CONN_WIFI);
    return;
  }
  if (retryDelayMs_ != 0 && millis() - retryStartedAt_ < retryDelayMs_) return;

  // A configured host wins outright. mDNS hands the pairing token to whatever
  // answers _pomo._tcp first, and a bearer token cannot authenticate the server
  // it is sent to — so pinning the host in secrets.h is the way to opt out of
  // trusting the LAN, not merely a fallback for routers that block multicast.
  if (strlen(POMO_HOST_FALLBACK) > 0) {
    host_ = POMO_HOST_FALLBACK;
    port_ = POMO_PORT_FALLBACK;
    Serial.printf("[PomoClient] using configured host %s:%u (mDNS not queried)\n",
                  host_.c_str(), port_);
  } else {
    MDNS.update();
    const int found = MDNS.queryService("pomo", "tcp");
    if (found <= 0) {
      Serial.println("[PomoClient] mDNS miss, no configured host");
      scheduleRetry();
      return;
    }
    host_ = MDNS.IP(0).toString();
    port_ = MDNS.port(0);
    Serial.printf("[PomoClient] discovered %s:%u via mDNS (first of %d responders)\n",
                  host_.c_str(), port_, found);
  }

  webSocket.begin(host_, port_, "/ws");
  webSocket.onEvent([](WStype_t type, uint8_t* payload, size_t length) {
    if (activeClient == nullptr) return;
    if (type == WStype_CONNECTED) {
      char hello[160];
      snprintf(hello, sizeof(hello), "{\"type\":\"hello\",\"token\":\"%s\"}", POMO_TOKEN);
      webSocket.sendTXT(hello);
    } else if (type == WStype_TEXT) {
      activeClient->onWebSocketText((const char*)payload, length);
    }
  });
  webSocket.setReconnectInterval(kMaxRetryMs);

  lastContactAt_ = millis();
  // Seeded too, so the socket gets a full kStaleAfterMs window to make its
  // first connection instead of timing out on the very next heartbeat.
  lastSocketContactAt_ = lastContactAt_;
  lastPollAt_ = 0;
  setState(CONN_CONNECTING);
}

void PomoClient::tickWebSocket() {
  if (WiFi.status() != WL_CONNECTED) {
    webSocket.disconnect();
    setState(CONN_WIFI);
  }
}

void PomoClient::tickHeartbeat() {
  const unsigned long now = millis();

  // The 30s poll corrects any drift, re-seeds state after a missed broadcast,
  // and detects a half-open socket that webSocket.loop() still believes is up.
  if (now - lastPollAt_ >= kPollIntervalMs) {
    lastPollAt_ = now;
    if (fetchStatus()) {
      // Deliberately does NOT promote to CONN_SYNCED and does NOT touch
      // lastSocketContactAt_. REST answering proves the phone is alive, not
      // that the socket is; only a socket frame earns the synced marker.
      lastContactAt_ = now;
    }
  }

  if (state_ != CONN_UNPAIRED && (now - lastSocketContactAt_) >= kStaleAfterMs) {
    Serial.println("[PomoClient] no contact, going offline");
    webSocket.disconnect();
    scheduleRetry();
    // Deliberately NOT CONN_DISCOVERING: tick() drives rediscovery from the
    // OFFLINE state, so the LCD keeps showing '!' the whole time the phone is
    // actually unreachable rather than a misleading 'connecting' marker.
    setState(CONN_OFFLINE);
  }
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
    model_->applyState(data["status"] | "stopped", data["phase"] | "work",
                       data["remaining"] | 0.0, data["duration"] | 0.0,
                       data["completed"] | 0, data["daily_goal"] | 8);
    // A good frame proves the path works end to end, so the next disconnect
    // starts backing off from 1s again rather than from a 30s ceiling.
    retryCount_ = 0;
    setState(CONN_SYNCED);
    return;
  }

  if (strcmp(type, "event") == 0) {
    const char* event = doc["event"] | "";
    if (strcmp(event, "phase_complete") == 0 && phaseCompleteHandler_ != nullptr) {
      phaseCompleteHandler_(doc["phase"] | "work");
    }
    return;
  }

  // Unknown frame types are ignored by contract — see docs/protocol.md.
}

bool PomoClient::fetchStatus() {
  if (host_.length() == 0) return false;

  WiFiClient client;
  HTTPClient http;
  char url[64];
  snprintf(url, sizeof(url), "http://%s:%u/api/status", host_.c_str(), port_);

  http.setTimeout(kHttpTimeoutMs);
  if (!http.begin(client, url)) return false;
  http.addHeader("X-Pomo-Token", POMO_TOKEN);

  const int code = http.GET();
  if (code == 401) {
    Serial.println("[PomoClient] token rejected");
    http.end();
    webSocket.disconnect();
    retryStartedAt_ = millis();
    retryDelayMs_ = kUnpairedRetryMs;
    setState(CONN_UNPAIRED);
    return false;
  }
  if (code != 200) {
    http.end();
    return false;
  }

  JsonDocument doc;
  const DeserializationError error = deserializeJson(doc, http.getString());
  http.end();
  if (error) return false;

  model_->applyState(doc["status"] | "stopped", doc["phase"] | "work",
                     doc["remaining"] | 0.0, doc["duration"] | 0.0,
                     doc["completed"] | 0, doc["daily_goal"] | 8);
  return true;
}

bool PomoClient::postCommand(const char* path, const char* body) {
  if (host_.length() == 0) return false;

  WiFiClient client;
  HTTPClient http;
  char url[64];
  snprintf(url, sizeof(url), "http://%s:%u%s", host_.c_str(), port_, path);

  http.setTimeout(kHttpTimeoutMs);
  if (!http.begin(client, url)) return false;
  http.addHeader("X-Pomo-Token", POMO_TOKEN);
  http.addHeader("Content-Type", "application/json");

  const int code = http.POST(body);
  http.end();

  if (code == 401) {
    Serial.println("[PomoClient] token rejected");
    webSocket.disconnect();
    retryStartedAt_ = millis();
    retryDelayMs_ = kUnpairedRetryMs;
    setState(CONN_UNPAIRED);
    return false;
  }
  if (code == 200) {
    lastContactAt_ = millis();
    return true;
  }
  Serial.printf("[PomoClient] %s failed, code %d\n", path, code);
  return false;
}

void PomoClient::sendGesture(Gesture gesture) {
  if (state_ != CONN_SYNCED) return;

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
}
