"""Atomic JSON persistence under $XDG_DATA_HOME/pomo/omarchy."""

from __future__ import annotations

import json
import os


def data_dir():
    override = os.environ.get("POMO_OMARCHY_DATA_DIR")
    if override:
        return override
    xdg = os.environ.get("XDG_DATA_HOME")
    if xdg:
        return os.path.join(xdg, "pomo", "omarchy")
    home = os.environ.get("HOME") or os.path.expanduser("~")
    return os.path.join(home, ".local", "share", "pomo", "omarchy")


def atomic_write(path, obj, mode=0o600):
    directory = os.path.dirname(path)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    try:
        os.chmod(directory, 0o700)
    except OSError:
        pass
    payload = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    # Deterministic sibling tmp name: load_json() and clear_timer_snapshot()
    # recover/clean exactly this name after a crash between write and replace.
    # The engine is single-threaded for file writes, so the fixed name cannot
    # collide with itself.
    tmp = path + ".tmp"
    fd = None
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
        os.write(fd, payload)
        os.fsync(fd)
        os.close(fd)
        fd = -1
        os.chmod(tmp, mode)
        os.replace(tmp, path)
        os.chmod(path, mode)
    except Exception:
        if fd is not None and fd >= 0:
            try:
                os.close(fd)
            except OSError:
                pass
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _read_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def load_json(path):
    """Load committed JSON, recovering a sibling .tmp if the rename was interrupted."""
    tmp = path + ".tmp"
    if os.path.exists(path):
        try:
            return _read_json(path)
        except (OSError, json.JSONDecodeError, ValueError, TypeError):
            return None
    if os.path.exists(tmp):
        try:
            data = _read_json(tmp)
        except (OSError, json.JSONDecodeError, ValueError, TypeError):
            return None
        try:
            os.replace(tmp, path)
        except OSError:
            pass
        return data
    return None
