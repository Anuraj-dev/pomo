#include "PomoClient.h"

#include <ArduinoJson.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266WiFi.h>
#include <ESP8266mDNS.h>
#include <WebSocketsClient.h>

#include "secrets.h"

namespace {

const unsigned long kPollIntervalMs = 30000;
const unsigned long kStaleAfterMs = 45000;
const unsigned long kBaseRetryMs = 1000;
const unsigned long kMaxRetryMs = 30000;
const uint16_t kHttpTimeoutMs = 4000;

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
  retryAfter_ = millis() + backoff;
}

void PomoClient::tick() {
  webSocket.loop();

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
      // Terminal until reflashed with a valid token. Retrying would only
      // hammer the phone's unauthorized rate limiter.
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
  retryAfter_ = 0;
  setState(CONN_DISCOVERING);
}

void PomoClient::tickDiscovery() {
  if (WiFi.status() != WL_CONNECTED) {
    setState(CONN_WIFI);
    return;
  }
  if (millis() < retryAfter_) return;

  MDNS.update();
  const int found = MDNS.queryService("pomo", "tcp");
  if (found > 0) {
    host_ = MDNS.IP(0).toString();
    port_ = MDNS.port(0);
    Serial.printf("[PomoClient] discovered %s:%u\n", host_.c_str(), port_);
  } else if (strlen(POMO_HOST_FALLBACK) > 0) {
    host_ = POMO_HOST_FALLBACK;
    port_ = POMO_PORT_FALLBACK;
    Serial.printf("[PomoClient] mDNS miss, using fallback %s:%u\n", host_.c_str(), port_);
  } else {
    Serial.println("[PomoClient] mDNS miss, no fallback configured");
    scheduleRetry();
    return;
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
      lastContactAt_ = now;
      if (state_ != CONN_UNPAIRED) setState(CONN_SYNCED);
    }
  }

  if (state_ != CONN_UNPAIRED && (now - lastContactAt_) >= kStaleAfterMs) {
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
  JsonDocument doc;
  const DeserializationError error = deserializeJson(doc, payload, length);
  if (error) {
    Serial.printf("[PomoClient] bad frame: %s\n", error.c_str());
    return;
  }

  const char* type = doc["type"] | "";
  lastContactAt_ = millis();

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
