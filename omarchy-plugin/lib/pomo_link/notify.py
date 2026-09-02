"""Desktop notifications for daemon phase completions."""

from __future__ import annotations

import os
import shutil
import subprocess


def notify_phase_complete(phase):
    value = str(phase or "work")
    title = "Focus complete"
    body = "Work block finished"
    if value == "short":
        title = "Break complete"
        body = "Break finished"
    elif value == "long":
        title = "Long break complete"
        body = "Break finished"
    send = shutil.which("notify-send")
    if not send:
        return False
    try:
        subprocess.Popen(
            [send, "--app-name=Pomo", "--urgency=normal", title, body],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
            env=os.environ,
        )
    except OSError:
        return False
    return True
