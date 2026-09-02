"""Waybar custom-module JSON for a pomo-link status snapshot."""

from __future__ import annotations

import json

WORK_ICON = ""
BREAK_ICON = ""
OFFLINE_ICON = ""
SEP = "│"
DIM = "#6a6a6a"


def format_mmss(seconds):
    try:
        n = int(seconds)
    except (TypeError, ValueError):
        n = 0
    if n < 0:
        n = 0
    return "%d:%02d" % (n // 60, n % 60)


def _sep():
    return "<span foreground='%s'>%s</span>" % (DIM, SEP)


def format_waybar(status):
    if not isinstance(status, dict):
        return json.dumps(
            {
                "text": "%s %s --:--" % (OFFLINE_ICON, _sep()),
                "class": "stopped work offline",
                "tooltip": "pomo-link is not running",
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )

    mode = str(status.get("mode") or "")
    st = str(status.get("status") or "stopped")
    phase = str(status.get("phase") or "work")
    remaining = status.get("remaining") or 0
    completed = status.get("completed") or 0
    goal = status.get("goal") or 0
    has_token = status.get("has_token") is True
    local_owner = status.get("local_owner") is True
    online = mode == "SYNCED"
    net = "online" if online else "offline"

    if mode == "UNPAIRED" or not has_token:
        icon = OFFLINE_ICON
    elif phase in ("short", "long"):
        icon = BREAK_ICON
    else:
        icon = WORK_ICON

    text = "%s %s %s" % (icon, _sep(), format_mmss(remaining))
    tooltip = "%s %s - %s/%s sessions" % (st, phase, completed, goal)
    if not online:
        if local_owner:
            tooltip += " (local)"
        elif mode:
            tooltip += " (%s)" % mode.lower()

    return json.dumps(
        {
            "text": text,
            "class": "%s %s %s" % (st, phase, net),
            "tooltip": tooltip,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
