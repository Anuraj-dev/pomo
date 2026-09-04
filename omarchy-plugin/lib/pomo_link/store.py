"""config.json + timer.json under the plugin data dir."""

from __future__ import annotations

import os
import time
from datetime import date as date_type

from .constants import (
    DEFAULT_GOAL,
    DEFAULT_LONG_AFTER,
    DEFAULT_LONG_MINUTES,
    DEFAULT_PORT,
    DEFAULT_SHORT_MINUTES,
    DEFAULT_WORK_MINUTES,
)
from .persist import atomic_write, data_dir, load_json


class ConfigStore:
    def __init__(self, directory=None):
        self.directory = directory or data_dir()
        self.work_minutes = DEFAULT_WORK_MINUTES
        self.short_minutes = DEFAULT_SHORT_MINUTES
        self.long_minutes = DEFAULT_LONG_MINUTES
        self.long_after = DEFAULT_LONG_AFTER
        self.goal = DEFAULT_GOAL
        self.next_seq = 1
        self.host = ""
        self.port = DEFAULT_PORT
        self.token = ""
        self.load()

    @property
    def config_path(self):
        return os.path.join(self.directory, "config.json")

    @property
    def timer_path(self):
        return os.path.join(self.directory, "timer.json")

    @property
    def sessions_path(self):
        return os.path.join(self.directory, "sessions.json")

    def load(self):
        data = load_json(self.config_path)
        if not isinstance(data, dict):
            return
        self.set_durations(
            data.get("work", self.work_minutes),
            data.get("short", self.short_minutes),
            data.get("long", self.long_minutes),
            data.get("long_after", self.long_after),
            data.get("goal", self.goal),
        )
        try:
            seq = int(data.get("next_seq") or 1)
        except (TypeError, ValueError):
            seq = 1
        self.next_seq = 1 if seq <= 0 else seq
        self.host = str(data.get("host") or "")
        try:
            port = int(data.get("port") or DEFAULT_PORT)
        except (TypeError, ValueError):
            port = DEFAULT_PORT
        self.port = port if 1 <= port <= 65535 else DEFAULT_PORT
        self.token = str(data.get("token") or "")

    def save(self):
        os.makedirs(self.directory, mode=0o700, exist_ok=True)
        doc = {
            "work": self.work_minutes,
            "short": self.short_minutes,
            "long": self.long_minutes,
            "long_after": self.long_after,
            "goal": self.goal,
            "next_seq": self.next_seq,
            "host": self.host,
            "port": self.port,
            "token": self.token,
        }
        atomic_write(self.config_path, doc, mode=0o600)

    def set_durations(self, work, short, long_, long_after, goal):
        """Coerce config values; corrupt-but-valid-JSON values keep defaults.

        Runs on every config load and phone config fetch — a raised ValueError
        here would crash the engine at startup or mid-sync.
        """

        def _positive_int(value, current):
            try:
                parsed = int(value)
            except (TypeError, ValueError):
                return current
            return parsed if parsed > 0 else current

        self.work_minutes = _positive_int(work, self.work_minutes)
        self.short_minutes = _positive_int(short, self.short_minutes)
        self.long_minutes = _positive_int(long_, self.long_minutes)
        self.long_after = _positive_int(long_after, self.long_after)
        if goal is not None:
            try:
                parsed_goal = int(goal)
            except (TypeError, ValueError):
                parsed_goal = self.goal
            if parsed_goal >= 0:
                self.goal = parsed_goal

    def set_pairing(self, host=None, port=None, token=None):
        if host is not None:
            self.host = str(host or "")
        if port is not None:
            try:
                p = int(port)
            except (TypeError, ValueError):
                p = self.port
            if 1 <= p <= 65535:
                self.port = p
        if token is not None:
            self.token = str(token or "")
        self.save()

    def take_next_client_seq(self):
        seq = self.next_seq
        self.next_seq += 1
        if self.next_seq == 0:
            self.next_seq = 1
        self.save()
        return seq

    def load_timer_snapshot(self):
        data = load_json(self.timer_path)
        if not isinstance(data, dict):
            return None
        status = str(data.get("status") or "")
        phase = str(data.get("phase") or "")
        if status not in ("running", "paused"):
            return None
        if phase not in ("work", "short", "long"):
            return None
        try:
            remaining = float(data.get("remaining"))
            duration = float(data.get("duration"))
        except (TypeError, ValueError):
            return None
        if remaining < 0.0 or duration <= 0.0:
            return None
        snap = {
            "status": status,
            "phase": phase,
            "remaining": remaining,
            "duration": duration,
            "start_time": float(data.get("start_time") or 0.0),
            "completed": int(data.get("completed") or 0),
            "goal": int(data.get("goal") if data.get("goal") is not None else self.goal),
            "saved_epoch": int(data.get("saved_epoch") or 0),
            "completed_date": self._safe_date(data.get("completed_date")),
        }
        if snap["completed"] < 0:
            snap["completed"] = 0
        if snap["goal"] < 0:
            snap["goal"] = 0
        if snap["saved_epoch"] < 0:
            snap["saved_epoch"] = 0
        return snap

    @staticmethod
    def _safe_date(value):
        if not isinstance(value, str):
            return ""
        value = value.strip()
        try:
            parsed = date_type.fromisoformat(value)
        except ValueError:
            return ""
        return value if parsed.isoformat() == value else ""

    def save_timer_snapshot(self, snap):
        status = snap.get("status")
        phase = snap.get("phase")
        if status not in ("running", "paused"):
            return False
        if phase not in ("work", "short", "long"):
            return False
        remaining = float(snap.get("remaining"))
        duration = float(snap.get("duration"))
        if remaining < 0.0 or duration <= 0.0:
            return False
        doc = {
            "status": status,
            "phase": phase,
            "remaining": remaining,
            "duration": duration,
            "start_time": float(snap.get("start_time") or 0.0),
            "completed": max(0, int(snap.get("completed") or 0)),
            "goal": max(0, int(snap.get("goal") if snap.get("goal") is not None else self.goal)),
            "completed_date": self._safe_date(snap.get("completed_date")),
        }
        saved_epoch = int(snap.get("saved_epoch") or 0)
        if saved_epoch > 0:
            doc["saved_epoch"] = saved_epoch
        atomic_write(self.timer_path, doc, mode=0o600)
        return True

    def clear_timer_snapshot(self):
        for path in (self.timer_path, self.timer_path + ".tmp"):
            try:
                os.unlink(path)
            except OSError:
                pass
        return True


def wall_adjust_remaining(snap):
    """Subtract real elapsed across engine restart for a running snapshot."""
    rem = float(snap["remaining"])
    if snap.get("status") != "running":
        return rem
    saved = int(snap.get("saved_epoch") or 0)
    if saved <= 0:
        return rem
    elapsed = int(time.time()) - saved
    if elapsed > 0:
        rem -= float(elapsed)
        if rem < 0.0:
            rem = 0.0
    return rem
