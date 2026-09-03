"""PomoClient state machine copied from firmware, adapted to unix time."""

from __future__ import annotations

import json
import time
from urllib.parse import urlparse

from .constants import (
    BOOT_PROBE_S,
    CONFIG_REFRESH_S,
    CONFIG_RETRY_S,
    DEFAULT_PORT,
    EXTEND_SECONDS,
    OFFLINE_PROBE_S,
    RECONNECT_INTERVAL_S,
    SOFT_RESYNC_MAX,
    STALE_AFTER_S,
    UNPAIRED_RETRY_S,
)
from .discovery import browse_pomo
from .rest import RestClient
from .ws import Rfc6455Client, WebSocketError


def marker_for(mode):
    if mode == "SYNCED":
        return " "
    if mode == "OFFLINE":
        return "~"
    if mode == "UNPAIRED":
        return "?"
    return "."


def _safe_float(value, default=0.0):
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    if out != out or out in (float("inf"), float("-inf")):
        # json.loads accepts Infinity/NaN literals; inf remaining would
        # OverflowError in displayed_seconds() later.
        return default
    return out


def _safe_int(value, default=None):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def parse_pairing_payload(value):
    """Accept pasted {url, token} JSON from Android Settings.

    Host/port from `url` pin the phone. Empty discrete host/port must not
    clobber that. A non-empty host (optional port) overrides the URL. An
    explicit empty host with no URL means mDNS.
    """
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return {}
        try:
            value = json.loads(text)
        except json.JSONDecodeError:
            return {}
    if not isinstance(value, dict):
        return {}
    out = {}
    token = value.get("token")
    if token is None:
        token = ""
    token = str(token).strip()
    if token:
        out["token"] = token
    url_host = None
    url = value.get("url")
    if isinstance(url, str) and url.strip():
        parsed = urlparse(url.strip())
        host = parsed.hostname or ""
        if host:
            url_host = host
            out["host"] = host
            try:
                out["port"] = int(parsed.port or DEFAULT_PORT)
            except ValueError:
                # urlparse raises on out-of-range ports; pair input must not
                # take the engine down.
                out["port"] = DEFAULT_PORT
    host_override = ""
    if "host" in value:
        host_override = str(value.get("host") or "").strip()
        if host_override:
            out["host"] = host_override
        elif url_host is None:
            out["host"] = ""
    if "port" in value and value["port"] not in ("", None):
        try:
            port = int(value["port"])
        except (TypeError, ValueError):
            port = None
        if port is not None and 1 <= port <= 65535:
            # Discrete port applies for mDNS-off host pin, not as a blank
            # default sitting next to a pasted url.
            if url_host is None or host_override:
                out["port"] = port
    return out


class PomoClient:
    def __init__(self, model, queue, store, rest=None, ws=None):
        self.model = model
        self.queue = queue
        self.store = store
        self.rest = rest or RestClient()
        self.ws = ws or Rfc6455Client()

        self.mode = "BOOT"
        self.host = store.host
        self.port = store.port or DEFAULT_PORT
        self.token = store.token
        self.rest.configure(self.host, self.port, self.token)

        self.ever_synced = False
        self.entering_sync = False
        self.ws_dropped_during_enter = False
        self.queue_flush_pending = False
        self.pending_sync_state = None
        self.prefer_known_host = False
        self.soft_resync_count = 0
        self.soft_resyncing = False
        self.probe_started_at = time.monotonic()
        self.probe_active = True
        self.last_contact_at = 0.0
        self.last_socket_contact_at = 0.0
        self.last_poll_at = 0.0
        self.retry_started_at = 0.0
        self.retry_delay_s = 0.0
        self.last_config_fetch_at = 0.0
        self.config_fetch_failed = False
        self.message = ""
        self.last_event = None
        self._ignore_disconnect = False
        self.log_lines = []

    def log(self, text):
        self.log_lines.append(text)
        if len(self.log_lines) > 50:
            self.log_lines = self.log_lines[-50:]

    def drain_logs(self):
        lines = self.log_lines
        self.log_lines = []
        return lines

    def set_mode(self, next_mode):
        if self.mode == next_mode:
            return
        prev = self.mode
        self.mode = next_mode
        self.log("mode %s -> %s" % (prev, next_mode))
        if next_mode in ("OFFLINE", "UNPAIRED"):
            self.model.set_local_owner(True)
        elif next_mode == "SYNCED":
            self.model.set_local_owner(False)
            self.store.clear_timer_snapshot()

    def marker(self):
        return marker_for(self.mode)

    def phone_commands_active(self):
        if not self.host:
            return False
        if self.mode == "SYNCED":
            return True
        if self.ever_synced and not self.model.local_owner:
            return self.mode in ("CONNECTING", "DISCOVERING")
        return False

    def in_boot_probe(self):
        return self.probe_active and not self.ever_synced

    def enter_offline(self, reason):
        if self.mode == "OFFLINE":
            return
        self.log("leave SYNC/probe -> OFFLINE: %s" % reason)
        self.probe_active = False
        self.entering_sync = False
        self.ws_dropped_during_enter = False
        self.soft_resync_count = 0
        self.queue_flush_pending = False
        self.pending_sync_state = None
        self.prefer_known_host = False
        self.last_poll_at = 0.0
        self.message = reason
        self.schedule_rediscover()
        self.set_mode("OFFLINE")
        self._disconnect_ws()

    def enter_unpaired(self, reason):
        if self.mode == "UNPAIRED":
            return
        self.log("token rejected -> UNPAIRED: %s" % reason)
        self.probe_active = False
        self.entering_sync = False
        self.ws_dropped_during_enter = False
        self.soft_resync_count = 0
        self.queue_flush_pending = False
        self.pending_sync_state = None
        self.retry_started_at = time.monotonic()
        self.retry_delay_s = UNPAIRED_RETRY_S
        self.message = reason
        self.set_mode("UNPAIRED")
        self._disconnect_ws()

    def schedule_rediscover(self):
        self.retry_started_at = time.monotonic()
        self.retry_delay_s = RECONNECT_INTERVAL_S
        self.log("schedule rediscover in %s ms" % int(self.retry_delay_s * 1000))

    def _disconnect_ws(self):
        self._ignore_disconnect = True
        try:
            self.ws.close()
        finally:
            self._ignore_disconnect = False

    def apply_pairing(self, payload):
        parsed = parse_pairing_payload(payload)
        if not parsed:
            return False
        host = parsed.get("host", self.host)
        port = parsed.get("port", self.port)
        token = parsed.get("token", self.token)
        self.store.set_pairing(host=host, port=port, token=token)
        self.host = self.store.host
        self.port = self.store.port
        self.token = self.store.token
        self.rest.configure(self.host, self.port, self.token)
        self.message = ""
        if self.token:
            self.retry_delay_s = 0
            if self.mode in ("UNPAIRED", "OFFLINE", "BOOT"):
                self.probe_active = True
                self.probe_started_at = time.monotonic()
                self.set_mode("DISCOVERING")
            elif self.mode in ("SYNCED", "CONNECTING"):
                self.ever_synced = False
                self.begin_websocket("pairing changed")
        else:
            self.enter_unpaired("empty token")
        return True

    def apply_phone_object(self, data, force=True):
        if not isinstance(data, dict):
            return False
        start_time = _safe_float(data.get("start_time"))
        remaining = _safe_float(data.get("remaining"))
        duration = _safe_float(data.get("duration"))
        completed = _safe_int(data.get("completed"))
        server_time = _safe_int(data.get("server_time"))
        if server_time is None or server_time < 0:
            server_time = 0
        epoch_now = int(time.time())
        # Missing or malformed goal keeps the store-cached goal (via the None
        # path in TimerModel.apply_state), never a hardcoded default.
        goal = None
        if data.get("daily_goal") is not None:
            goal = _safe_int(data.get("daily_goal"))
            if goal is not None and goal < 0:
                goal = 0
        ok = self.model.apply_state(
            data.get("status") or "stopped",
            data.get("phase") or "work",
            remaining,
            duration,
            completed,
            goal,
            start_time,
            server_time,
            epoch_now,
            force,
        )
        if not ok:
            self.log("state frame ignored (stale/out-of-order)")
        return ok

    def begin_websocket(self, reason):
        self.log("begin WebSocket %s:%s (%s)" % (self.host, self.port, reason))
        self._disconnect_ws()
        if not self.host or not self.port or not self.token:
            self.enter_unpaired("missing host/token")
            return False
        self.rest.configure(self.host, self.port, self.token)
        try:
            self.ws.connect(self.host, self.port, path="/ws", timeout=5.0)
            self.ws.send_text(json.dumps({"type": "hello", "token": self.token}))
            self.log("WS connected, hello sent")
        except Exception as exc:
            self.log("WS connect failed: %s" % exc)
            now = time.monotonic()
            self.last_contact_at = now
            self.last_socket_contact_at = now
            self.set_mode("CONNECTING")
            return False
        now = time.monotonic()
        self.last_contact_at = now
        self.last_socket_contact_at = now
        self.last_poll_at = now
        self.retry_delay_s = 0
        self.set_mode("CONNECTING")
        return True

    def soft_resync(self, reason):
        if self.soft_resyncing:
            return False
        if not self.host or not self.port:
            self.enter_offline(reason or "soft resync no host")
            return False
        if self.soft_resync_count >= SOFT_RESYNC_MAX:
            self.log("soft resync budget exhausted -> OFFLINE")
            self.enter_offline("soft resync budget")
            return False
        self.soft_resyncing = True
        code, _body = self.rest.get_status()
        if code == 401:
            self.soft_resyncing = False
            self.enter_unpaired("soft resync 401")
            return False
        if code != 200:
            self.soft_resyncing = False
            self.log("soft resync REST code=%s -> OFFLINE" % code)
            self.enter_offline(reason or "soft resync unreachable")
            return False
        self.soft_resync_count += 1
        self.entering_sync = False
        self.ws_dropped_during_enter = False
        self.model.set_local_owner(False)
        self.log("soft resync #%s: %s (phone still owns clock)" % (self.soft_resync_count, reason))
        ok = self.begin_websocket("soft resync")
        self.soft_resyncing = False
        return ok

    def probe_host_status(self, host, port):
        code, _body = self.rest.get_status(host=host, port=port, token=self.token)
        return code

    def fetch_status(self):
        if not self.host:
            return False
        code, body = self.rest.get_status()
        if code == 401:
            self.enter_unpaired("GET /api/status")
            return False
        if code != 200:
            return False
        # Never REST-promote to SYNCED.
        if self.mode == "SYNCED":
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                data = None
            if isinstance(data, dict):
                self.apply_phone_object(data, force=False)
        return True

    def tick_discovery(self):
        now = time.monotonic()
        if self.retry_delay_s and now - self.retry_started_at < self.retry_delay_s:
            return
        if not self.token:
            self.enter_unpaired("no token")
            return
        if self.store.host:
            self.prefer_known_host = False
            self.host = self.store.host
            self.port = self.store.port or DEFAULT_PORT
            self.log("using configured host %s:%s (mDNS not queried)" % (self.host, self.port))
        elif self.prefer_known_host and self.host and self.port:
            self.prefer_known_host = False
            self.log("reusing known host %s:%s (REST-proven)" % (self.host, self.port))
        else:
            self.prefer_known_host = False
            candidates = browse_pomo()
            if not candidates:
                self.log("mDNS miss, no configured host")
                if self.in_boot_probe():
                    self.retry_started_at = now
                    self.retry_delay_s = 1.0
                else:
                    self.enter_offline("mDNS miss on rediscover")
                return
            picked = None
            unauthorized = 0
            for i, cand in enumerate(candidates):
                self.log(
                    "mDNS candidate %s/%s %s:%s — probing token"
                    % (i + 1, len(candidates), cand["host"], cand["port"])
                )
                code = self.probe_host_status(cand["host"], cand["port"])
                if code == 200:
                    picked = cand
                    self.log(
                        "discovered %s:%s via mDNS (selected %s of %s)"
                        % (cand["host"], cand["port"], i + 1, len(candidates))
                    )
                    break
                if code == 401:
                    unauthorized += 1
                    self.log("candidate %s:%s rejected token (401)" % (cand["host"], cand["port"]))
                    continue
                self.log("candidate %s:%s probe code=%s" % (cand["host"], cand["port"], code))
            if picked is None:
                if unauthorized > 0 and unauthorized == len(candidates):
                    self.log("all mDNS responders rejected token")
                    self.enter_unpaired("mDNS all 401")
                    return
                self.log("mDNS had %s responders but none authed" % len(candidates))
                if self.in_boot_probe():
                    self.retry_started_at = now
                    self.retry_delay_s = 1.0
                else:
                    self.enter_offline("mDNS candidates failed auth/reachability")
                return
            self.host = picked["host"]
            self.port = picked["port"]
        self.rest.configure(self.host, self.port, self.token)
        self.begin_websocket("discovery")

    def on_websocket_text(self, payload):
        if self.mode == "UNPAIRED":
            return
        try:
            doc = json.loads(payload)
        except json.JSONDecodeError:
            self.log("bad frame")
            return
        if not isinstance(doc, dict):
            return
        frame_type = doc.get("type") or ""
        now = time.monotonic()
        self.last_contact_at = now
        self.last_socket_contact_at = now

        if frame_type == "state":
            data = doc.get("data")
            if not isinstance(data, dict):
                return
            if self.mode == "SYNCED":
                self.apply_phone_object(data, force=False)
                return
            if self.mode == "CONNECTING" and not self.entering_sync:
                self.pending_sync_state = data
                if self.queue_flush_pending:
                    return
                if self.ever_synced and not self.model.local_owner:
                    self.apply_phone_object(data, force=True)
                    self.soft_resync_count = 0
                    self.last_contact_at = time.monotonic()
                    self.set_mode("SYNCED")
                    self.log("soft resync complete -> SYNCED (light path)")
                    return
                self.enter_sync_from_phone_state(data)
            return

        if frame_type == "event":
            if self.mode != "SYNCED":
                return
            event = doc.get("event") or ""
            if event == "phase_complete":
                phase = doc.get("phase") or "work"
                self.last_event = {"event": "phase_complete", "phase": phase}
            return
        # Unknown types ignored by contract.

    def on_websocket_disconnected(self):
        if self._ignore_disconnect or self.soft_resyncing:
            return
        if self.mode in ("UNPAIRED", "OFFLINE"):
            return
        if self.entering_sync:
            self.ws_dropped_during_enter = True
            self.log("WS drop during enter-SYNC pipeline (deferred)")
            return
        if self.mode == "SYNCED":
            self.log("WS drop while SYNCED -> soft resync")
            self.soft_resync("ws disconnected")
            return
        if self.mode != "CONNECTING":
            return
        self.log("WS drop while CONNECTING — token/reachability probe")
        code, _body = self.rest.get_status()
        if code == 401:
            self.enter_unpaired("ws drop 401")
            return
        if code == 200:
            if self.ever_synced and not self.model.local_owner:
                self.soft_resync("ws drop phone up")
            elif self.soft_resync_count < SOFT_RESYNC_MAX:
                self.soft_resync_count += 1
                self.begin_websocket("ws drop retry")
            else:
                self.enter_offline("ws connect failed")
            return
        self.log("WS drop CONNECTING REST code=%s" % code)

    def pump_websocket(self):
        if self.mode not in ("CONNECTING", "SYNCED"):
            return
        if not self.ws.connected:
            # Never-connected / already closed: ~20s stale heartbeat owns retry.
            return
        try:
            if not self.ws.recv_ready(0.0):
                return
            texts = self.ws.read_texts()
        except WebSocketError:
            self.on_websocket_disconnected()
            return
        for text in texts:
            self.on_websocket_text(text)

    def flush_session_queue(self):
        if self.queue.empty():
            self.log("flush skip: empty queue")
            return True
        if not self.host:
            self.log("flush failed: no host")
            return False
        self.queue.strip_implausible_starts(int(time.time()))
        body = {
            "source": "omarchy",
            "sessions": [],
        }
        for item in self.queue.items:
            row = {
                "client_id": item["client_id"],
                "type": item["type"],
                "duration": int(item["duration"]),
                "completed": True,
            }
            if item.get("start"):
                row["start"] = int(item["start"])
            if item.get("tag"):
                row["tag"] = item["tag"]
            body["sessions"].append(row)
        self.log("flush POST /api/sessions/import count=%s" % self.queue.count())
        code, response = self.rest.post("/api/sessions/import", body)
        if code == 401:
            self.enter_unpaired("/api/sessions/import")
            return False
        if code != 200:
            self.log("flush rejected: http %s" % code)
            return False
        try:
            resp = json.loads(response)
        except json.JSONDecodeError:
            self.log("flush rejected: response parse failed")
            return False
        accepted = resp.get("accepted")
        if not isinstance(accepted, list):
            self.log("flush rejected: no accepted array")
            return False
        terminal = []
        for item in accepted:
            if isinstance(item, str) and item:
                terminal.append(item)
        rejected = resp.get("rejected")
        if isinstance(rejected, list):
            for row in rejected:
                if not isinstance(row, dict):
                    continue
                cid = str(row.get("client_id") or "")
                self.log("flush row rejected id=%s err=%s" % (cid, row.get("error") or ""))
                if cid:
                    terminal.append(cid)
        self.queue.drop_by_client_id(terminal)
        if not self.queue.empty():
            self.log("flush incomplete; retryable rows remain queued")
            return False
        return True

    def _ensure_live_start_time(self):
        """Live adopt requires start_time > 0. Stamp unix now; do not reconstruct."""
        if self.model.is_live() and self.model.start_time <= 0.0:
            self.model.set_start_time(float(int(time.time())))

    def try_adopt_local_timer(self):
        if not self.host:
            return -1
        remaining = float(self.model.displayed_seconds())
        duration = self.model.duration
        if duration <= 0.0:
            duration = remaining if remaining > 0.0 else 1.0
        rem = remaining
        if rem < 0.0:
            rem = 0.0
        if rem > duration:
            rem = duration
        self._ensure_live_start_time()
        body = {
            "status": self.model.status,
            "phase": self.model.phase,
            "remaining": rem,
            "duration": duration,
            "start_time": self.model.start_time,
            "completed": self.model.completed,
            "daily_goal": self.model.goal,
            "tag": "",
        }
        self.log("POST /api/timer/adopt")
        code, response = self.rest.post("/api/timer/adopt", body)
        if code == 401:
            self.enter_unpaired("/api/timer/adopt")
            return -1
        if code == 0:
            self.log("adopt result=transport_fail")
            return -1
        if code == 409:
            self.log("adopt result=409 timer_busy")
            try:
                resp = json.loads(response)
            except json.JSONDecodeError:
                resp = None
            if isinstance(resp, dict) and isinstance(resp.get("state"), dict):
                self.apply_phone_object(resp["state"], force=True)
                self.log("adopt 409 applied phone state")
                return 1
            return 0
        if code != 200:
            self.log("adopt result=http_%s (snap)" % code)
            return 0
        try:
            resp = json.loads(response)
        except json.JSONDecodeError:
            self.model.apply_state(
                self.model.status,
                self.model.phase,
                rem,
                duration,
                self.model.completed,
                self.model.goal,
                self.model.start_time,
            )
            return 1
        if not resp.get("success"):
            self.log("adopt result=success_false (snap)")
            return 0
        state = resp.get("state")
        if isinstance(state, dict):
            self.apply_phone_object(state, force=True)
        else:
            self.model.apply_state(
                self.model.status,
                self.model.phase,
                rem,
                duration,
                self.model.completed,
                self.model.goal,
                self.model.start_time,
            )
        self.log("adopt result=ok")
        return 1

    def enter_sync_from_phone_state(self, data):
        self.entering_sync = True
        self.log("enter SYNC pipeline start")
        phone_status = str(data.get("status") or "stopped")
        phone_stopped = phone_status == "stopped"
        desk_live = self.model.is_live() and (self.model.local_owner or not self.ever_synced)

        flush_ok = self.flush_session_queue()
        self.log("flush result=%s" % ("ok" if flush_ok else "failed"))
        if self.mode == "UNPAIRED":
            self.entering_sync = False
            return
        if not flush_ok:
            self.queue_flush_pending = True
            self.retry_started_at = time.monotonic()
            self.retry_delay_s = RECONNECT_INTERVAL_S
            self.entering_sync = False
            self.message = "session import incomplete"
            self.log("session import incomplete; staying CONNECTING")
            return
        self.queue_flush_pending = False

        if desk_live:
            # Always POST when live. Phone canAdopt / 409 decides same-session
            # vs least-remaining. Do not pre-filter on remaining (that skips
            # same-session refresh).
            self.log("desk live -> try adopt")
            adopt_result = self.try_adopt_local_timer()
            if self.mode == "UNPAIRED":
                self.entering_sync = False
                return
            if adopt_result < 0:
                if phone_stopped:
                    self.entering_sync = False
                    self.log("adopt result=transport_fail (keep local)")
                    self.enter_offline("adopt transport fail")
                    return
                self.log("adopt result=transport_fail phone_active -> snap")
                self.apply_phone_object(data, force=True)
            elif adopt_result == 0:
                self.log("adopt result=snap (not applied)")
                self.apply_phone_object(data, force=True)
            else:
                self.log("adopt result=ok (phone owns clock)")
        else:
            self.log("adopt result=skip desk_idle -> snap")
            self.apply_phone_object(data, force=True)

        self.config_fetch_failed = False
        self.last_config_fetch_at = time.monotonic()
        self.log("config fetch deferred until SYNC is stable")
        self.store.save()
        self.probe_active = False
        self.ever_synced = True
        self.entering_sync = False
        self.soft_resync_count = 0
        self.pending_sync_state = None
        self.last_contact_at = time.monotonic()
        self.set_mode("SYNCED")
        self.message = ""
        self.log("enter SYNC pipeline done -> SYNCED")
        if self.ws_dropped_during_enter:
            self.ws_dropped_during_enter = False
            self.log("WS died during enter-SYNC pipeline -> soft resync")
            self.soft_resync("ws drop during enter")

    def tick_session_queue_retry(self):
        if not self.queue_flush_pending or self.entering_sync or not self.pending_sync_state:
            return
        now = time.monotonic()
        if self.retry_delay_s and now - self.retry_started_at < self.retry_delay_s:
            return
        self.log("retrying pending session import")
        self.enter_sync_from_phone_state(self.pending_sync_state)

    def fetch_and_cache_config(self):
        if not self.host:
            return False
        code, response = self.rest.get_config()
        if code == 401:
            self.enter_unpaired("GET /api/config")
            return False
        if code != 200:
            return False
        try:
            doc = json.loads(response)
        except json.JSONDecodeError:
            return False
        durations = doc.get("durations") if isinstance(doc.get("durations"), dict) else {}
        work = durations.get("work", self.store.work_minutes)
        short_m = durations.get("short_break", self.store.short_minutes)
        long_m = durations.get("long_break", self.store.long_minutes)
        long_after = doc.get("long_break_after", self.store.long_after)
        goal = self.store.goal
        if doc.get("daily_goal") is not None:
            parsed_goal = _safe_int(doc.get("daily_goal"))
            if parsed_goal is not None:
                goal = max(0, parsed_goal)
        self.store.set_durations(work, short_m, long_m, long_after, goal)
        self.store.save()
        self.model.set_config(work, short_m, long_m, long_after, goal)
        self.log("config cached %s/%s/%s after=%s goal=%s" % (work, short_m, long_m, long_after, goal))
        return True

    def tick_config_refresh(self):
        now = time.monotonic()
        every = CONFIG_RETRY_S if self.config_fetch_failed else CONFIG_REFRESH_S
        if self.last_config_fetch_at and now - self.last_config_fetch_at < every:
            return
        self.last_config_fetch_at = now
        if self.fetch_and_cache_config():
            self.config_fetch_failed = False
        else:
            self.config_fetch_failed = True
            self.log("config refresh failed; will retry")

    def tick_heartbeat(self):
        now = time.monotonic()
        if self.mode == "CONNECTING" and self.queue_flush_pending:
            self.tick_session_queue_retry()
            if self.queue_flush_pending or self.entering_sync:
                return
        if self.mode == "SYNCED" and not self.entering_sync:
            self.tick_config_refresh()
        if self.entering_sync or self.mode == "UNPAIRED":
            return
        if self.last_socket_contact_at and (now - self.last_socket_contact_at) >= STALE_AFTER_S:
            if self.mode == "SYNCED":
                self.log("heartbeat stale: SYNCED socket -> soft resync")
                self.soft_resync("stale socket")
            elif self.mode == "CONNECTING":
                self.log("heartbeat stale: CONNECTING socket -> soft resync/offline")
                self.soft_resync("reconnect connect stale")

    def tick_probe_watchdog(self):
        if self.mode in ("SYNCED", "OFFLINE", "UNPAIRED"):
            return
        if self.entering_sync or self.mode == "CONNECTING":
            return
        if self.mode == "BOOT":
            self.set_mode("DISCOVERING")
            self.probe_started_at = time.monotonic()
            self.probe_active = True
            return
        if self.mode != "DISCOVERING":
            return
        if not self.in_boot_probe():
            return
        if time.monotonic() - self.probe_started_at < BOOT_PROBE_S:
            return
        self.log("boot probe timeout (DISCOVERING window elapsed)")
        self.enter_offline("boot probe timeout")

    def tick(self):
        self.tick_probe_watchdog()
        if self.mode in ("CONNECTING", "SYNCED"):
            self.pump_websocket()
        if self.mode in ("BOOT",):
            if not self.token:
                self.enter_unpaired("no token")
            else:
                self.set_mode("DISCOVERING")
                self.probe_started_at = time.monotonic()
                self.probe_active = True
            return
        if self.mode == "DISCOVERING":
            self.tick_discovery()
            return
        if self.mode == "OFFLINE":
            now = time.monotonic()
            if self.host:
                if self.last_poll_at == 0 or now - self.last_poll_at >= OFFLINE_PROBE_S:
                    self.last_poll_at = now
                    if self.fetch_status():
                        self.log("phone reachable while OFFLINE -> reconnect known host")
                        self.retry_delay_s = 0
                        self.prefer_known_host = True
                        self.set_mode("DISCOVERING")
                        return
            if self.retry_delay_s and now - self.retry_started_at >= self.retry_delay_s:
                self.retry_delay_s = 0
                self.log("rediscover timer elapsed -> DISCOVERING")
                self.set_mode("DISCOVERING")
            return
        if self.mode in ("CONNECTING", "SYNCED"):
            self.tick_heartbeat()
            return
        if self.mode == "UNPAIRED":
            if time.monotonic() - self.retry_started_at >= self.retry_delay_s:
                if self.token:
                    self.log("unpaired cooldown over, re-discovering")
                    self.retry_delay_s = 0
                    self.set_mode("DISCOVERING")

    def post_command(self, path, body=None):
        code, response = self.rest.post(path, body if body is not None else "")
        if code == 401:
            self.enter_unpaired(path)
            return False
        if code == 200:
            try:
                doc = json.loads(response) if response else {}
            except json.JSONDecodeError:
                doc = {}
            if isinstance(doc, dict) and doc.get("success") and isinstance(doc.get("state"), dict):
                self.apply_phone_object(doc["state"], force=True)
            return True
        if code not in (401, 0):
            self.log("%s failed, code %s" % (path, code))
        return False

    def send_gesture(self, gesture):
        if self.phone_commands_active():
            if gesture == "toggle":
                self.post_command("/api/toggle", "")
            elif gesture == "skip":
                self.post_command("/api/skip", "")
            elif gesture == "reset":
                self.post_command("/api/reset", "")
            elif gesture == "extend":
                self.post_command("/api/extend", {"seconds_delta": EXTEND_SECONDS})
            return
        if not self.model.local_owner:
            return
        if gesture == "toggle":
            self.model.toggle()
        elif gesture == "skip":
            self.model.skip()
        elif gesture == "reset":
            self.model.reset()
        elif gesture == "extend":
            self.model.extend(EXTEND_SECONDS)
