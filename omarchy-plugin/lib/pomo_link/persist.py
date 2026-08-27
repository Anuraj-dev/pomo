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
    tmp = path + ".tmp"
    try:
        with open(tmp, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, path)
        os.chmod(path, mode)
    except Exception:
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
