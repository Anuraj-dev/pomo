"""Long-lived pomo-link: stdin newline commands, stdout NDJSON status."""

from __future__ import annotations

import json
import os
import select
import signal
import sys
import time

from .client import PomoClient, parse_pairing_payload
from .constants import TIMER_SNAP_INTERVAL_S
from .queue import SessionQueue
from .store import ConfigStore, wall_adjust_remaining
from .timer import TimerModel

_last_error_message = ""
_last_error_at = 0.0

GESTURE_COMMANDS = ("toggle", "skip", "reset", "extend")


def _emit(obj):
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _emit_error(message):
    """Best-effort error event. Must never raise — a broken stdout would
    otherwise turn one loop exception into a live-lock. The same message is
    suppressed for 5s so a persistent failure cannot flood the UI at ~5 Hz."""
    global _last_error_message, _last_error_at
    text = str(message or "")[:200]
    now = time.monotonic()
    if text == _last_error_message and now - _last_error_at < 5.0:
        return
    _last_error_message = text
    _last_error_at = now
    try:
        _emit({"type": "error", "message": text})
    except Exception:
        pass


class Engine:
    def __init__(self, directory=None):
        self.store = ConfigStore(directory)
        self.model = TimerModel()
        self.model.set_config(
            self.store.work_minutes,
            self.store.short_minutes,
            self.store.long_minutes,
            self.store.long_after,
            self.store.goal,
        )
        self.queue = SessionQueue(self.store.sessions_path)
        self.queue.strip_implausible_starts(int(time.time()))
        self.model.phase_complete_handler = self._on_phase_complete
        self.model.session_complete_handler = self._on_session_complete
        self._restore_timer()
        if not self.model.has_state:
            # Stopped work idle for the bar during `.` probe. No local ownership
            # yet — boot probe ignores gestures until OFFLINE / UNPAIRED.
            self.model.set_local_owner(True)
            self.model.set_local_owner(False)
        self.client = PomoClient(self.model, self.queue, self.store)
        self.last_timer_snap_at = 0.0
        self.last_status = None
        self.last_status_at = 0.0
        self.running = True
        self.pending_events = []
        # Last-wins gesture slot: a press replaces the queued one instead of
        # queueing behind it, so 3x Start is one toggle, not start-pause-start.
        self.pending_gesture = None
        self._stdin_remainder = b""
        try:
            os.set_blocking(sys.stdin.fileno(), False)
        except (OSError, ValueError):
            pass

    def _drain_stdin(self):
        """Read every complete stdin line available now.

        Raw os.read on the fd: select() on sys.stdin cannot see bytes already
        buffered inside TextIOWrapper, so one readline per wake could stall on
        line 2 until line 3 arrived.
        """
        if sys.stdin.closed:
            return
        fd = sys.stdin.fileno()
        while True:
            try:
                chunk = os.read(fd, 4096)
            except (BlockingIOError, InterruptedError):
                return
            except OSError:
                self.running = False
                return
            if not chunk:
                self.running = False
                return
            data = self._stdin_remainder + chunk
            lines = data.split(b"\n")
            self._stdin_remainder = lines.pop()
            for raw in lines:
                self.handle_line(raw.decode("utf-8", "replace"))

    def drain_pending_gesture(self):
        if self.pending_gesture is None or self.client.busy:
            return
        if not (self.client.phone_commands_active() or self.model.local_owner):
            # Held until the mode change that allows it (BOOT / first
            # CONNECTING / enter-SYNC). Never dropped silently.
            return
        gesture = self.pending_gesture
        if self.client.message == "waiting to connect":
            self.client.message = ""
        # Announce busy, then submit. On the phone path the gesture goes to
        # the worker and busy stays set until its result lands; on the local
        # path it is applied synchronously and busy is released here.
        self.client.busy = True
        self.emit_status(force=True)
        try:
            went_async = self.client.send_gesture(gesture)
        except Exception:
            self.client.busy = False
            raise
        self.pending_gesture = None
        if not went_async:
            self.client.busy = False
            if self.model.local_owner:
                if self.model.is_live():
                    self.persist_live_timer()
                else:
                    self.clear_live_timer()
        self.emit_status(force=True)

    def _restore_timer(self):
        snap = self.store.load_timer_snapshot()
        if not snap:
            return
        rem = wall_adjust_remaining(snap)
        if snap["status"] == "running" and rem <= 0.0:
            self.store.clear_timer_snapshot()
            if snap.get("start_time", 0.0) > 0.0 and snap.get("duration", 0.0) > 0.0:
                self._on_session_complete(
                    snap["phase"],
                    snap["duration"],
                    snap.get("completed", 0),
                    snap["start_time"],
                )
            return
        if not self.model.restore_live_state(
            snap["status"],
            snap["phase"],
            rem,
            snap["duration"],
            snap["completed"],
            snap["start_time"],
        ):
            self.store.clear_timer_snapshot()
            return
        if snap.get("goal") is not None and int(snap["goal"]) >= 0:
            self.model.set_config(
                self.model.work_minutes,
                self.model.short_minutes,
                self.model.long_minutes,
                self.model.long_after,
                snap["goal"],
            )

    def _on_phase_complete(self, phase):
        self.pending_events.append({"type": "event", "event": "phase_complete", "phase": phase})

    def _on_session_complete(self, phase, duration_sec, completed_work, start_time):
        del completed_work
        self.store.clear_timer_snapshot()
        self.last_timer_snap_at = 0.0
        seq = self.store.take_next_client_seq()
        client_id = "omarchy-%04x" % (seq & 0xFFFF)
        start_epoch = None
        if start_time and start_time > 0:
            start_epoch = int(start_time)
        else:
            start_epoch = int(time.time()) - int(duration_sec)
            if start_epoch < 0:
                start_epoch = 0
        self.queue.enqueue(client_id, phase, duration_sec, start_epoch, "")

    def persist_live_timer(self):
        if not self.model.local_owner or not self.model.is_live():
            return False
        self.model.snap_for_persist()
        snap = {
            "status": self.model.status,
            "phase": self.model.phase,
            "remaining": self.model.remaining,
            "duration": self.model.duration,
            "start_time": self.model.start_time,
            "completed": self.model.completed,
            "goal": self.model.goal,
            "saved_epoch": int(time.time()),
        }
        ok = self.store.save_timer_snapshot(snap)
        if ok:
            self.last_timer_snap_at = time.monotonic()
        return ok

    def clear_live_timer(self):
        self.store.clear_timer_snapshot()
        self.last_timer_snap_at = 0.0

    def status_payload(self):
        remaining = self.model.displayed_seconds()
        if self.model.is_stopped() and self.model.has_state:
            remaining = int(self.model.duration)
        return {
            "type": "status",
            "mode": self.client.mode,
            "marker": self.client.marker(),
            "status": self.model.status,
            "phase": self.model.phase,
            "remaining": remaining,
            "duration": int(self.model.duration),
            "completed": self.model.completed,
            "goal": self.model.goal,
            "start_time": self.model.start_time,
            "local_owner": self.model.local_owner,
            "ever_synced": self.client.ever_synced,
            "busy": self.client.busy,
            "host": self.client.host,
            "port": self.client.port,
            "has_token": bool(self.client.token),
            "queue_count": self.queue.count(),
            "message": self.client.message,
        }

    def emit_status(self, force=False):
        payload = self.status_payload()
        now = time.monotonic()
        interval = 0.5 if self.model.is_running() else 2.0
        if (
            not force
            and payload == self.last_status
            and now - self.last_status_at < interval
        ):
            return
        # remaining/busy change without other fields moving
        if (
            not force
            and self.last_status
            and payload.get("remaining") == self.last_status.get("remaining")
            and payload.get("mode") == self.last_status.get("mode")
            and payload.get("status") == self.last_status.get("status")
            and payload.get("phase") == self.last_status.get("phase")
            and payload.get("busy") == self.last_status.get("busy")
            and now - self.last_status_at < interval
        ):
            return
        self.last_status = payload
        self.last_status_at = now
        _emit(payload)

    def handle_line(self, line):
        text = line.strip()
        if not text:
            return
        cmd = None
        payload = {}
        if text[0] == "{":
            try:
                doc = json.loads(text)
            except json.JSONDecodeError:
                return
            if not isinstance(doc, dict):
                return
            cmd = str(doc.get("cmd") or doc.get("command") or "").strip()
            payload = doc
        else:
            parts = text.split(None, 1)
            cmd = parts[0]
            if len(parts) > 1:
                extra = parts[1]
                try:
                    parsed = json.loads(extra)
                    if isinstance(parsed, dict):
                        payload = parsed
                    else:
                        payload = {"arg": extra}
                except json.JSONDecodeError:
                    payload = {"arg": extra}

        if cmd in ("quit", "exit"):
            self.running = False
            return
        if cmd == "ping":
            self.emit_status(force=True)
            return
        if cmd in GESTURE_COMMANDS:
            self.pending_gesture = cmd
            if self.client.message == "waiting to connect":
                self.client.message = ""
            if not (
                self.client.phone_commands_active() or self.model.local_owner
            ):
                if not self.client.message:
                    self.client.message = "waiting to connect"
                self.emit_status(force=True)
            return
        if cmd == "pair":
            data = payload
            if payload.get("arg") and not payload.get("url") and not payload.get("token"):
                data = parse_pairing_payload(payload.get("arg"))
            self.client.apply_pairing(data)
            self.emit_status(force=True)
            return
        if cmd in ("set_token", "token"):
            self.client.apply_pairing({"token": payload.get("token") or payload.get("arg") or ""})
            self.emit_status(force=True)
            return
        if cmd in ("set_host", "host"):
            self.client.apply_pairing(
                {
                    "host": payload.get("host") or payload.get("arg") or "",
                    "port": payload.get("port", self.store.port),
                }
            )
            self.emit_status(force=True)
            return

    def tick_persist(self):
        if self.client.mode == "SYNCED":
            return
        if self.model.local_owner and self.model.is_live():
            now = time.monotonic()
            if self.last_timer_snap_at == 0 or now - self.last_timer_snap_at >= TIMER_SNAP_INTERVAL_S:
                self.persist_live_timer()
        elif self.model.local_owner and self.model.is_stopped():
            if self.last_timer_snap_at:
                self.clear_live_timer()

    def loop(self):
        self.emit_status(force=True)
        while self.running:
            try:
                self._loop_once()
            except Exception as exc:
                try:
                    sys.stderr.write("[pomo-link] loop error: %r\n" % (exc,))
                    sys.stderr.flush()
                except Exception:
                    pass
                _emit_error("engine error: %s" % exc)

    def _loop_once(self):
        timeout = 0.2
        readers = []
        stdin_fd = None if sys.stdin.closed else sys.stdin.fileno()
        if stdin_fd is not None:
            readers.append(stdin_fd)
        if self.client.ws.connected and self.client.ws.sock is not None:
            readers.append(self.client.ws.sock)
        try:
            ready, _, _ = select.select(readers, [], [], timeout)
        except (InterruptedError, ValueError):
            ready = []

        if stdin_fd is not None and stdin_fd in ready:
            self._drain_stdin()
        if not self.running:
            return

        finished = self.model.tick()
        if finished:
            self.emit_status(force=True)
        if self.client.last_event:
            event = self.client.last_event
            self.client.last_event = None
            _emit({"type": "event", "event": event["event"], "phase": event.get("phase") or "work"})
        while self.pending_events:
            _emit(self.pending_events.pop(0))

        self.client.tick()
        self.client.drain_worker_results()
        for msg in self.client.drain_errors():
            _emit_error(msg)
        self.drain_pending_gesture()
        for line in self.client.drain_logs():
            sys.stderr.write("[pomo-link] %s\n" % line)
            sys.stderr.flush()

        self.tick_persist()
        self.emit_status(force=False)


def main(argv=None):
    del argv
    try:
        engine = Engine()
    except Exception as exc:
        try:
            sys.stderr.write("[pomo-link] init failed: %r\n" % (exc,))
            sys.stderr.flush()
        except Exception:
            pass
        return 1

    def _stop(_signum, _frame):
        engine.running = False

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    try:
        engine.loop()
    finally:
        if engine.model.local_owner and engine.model.is_live():
            engine.persist_live_timer()
        engine.client.ws.close()
        engine.client.worker.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
