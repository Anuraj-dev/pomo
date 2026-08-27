"""mDNS discovery of _pomo._tcp via avahi-browse."""

from __future__ import annotations

import subprocess


def parse_avahi_browse(text):
    found = []
    for line in (text or "").splitlines():
        if not line.startswith("="):
            continue
        parts = line.split(";")
        if len(parts) < 9:
            continue
        proto = parts[2]
        address = parts[7].strip()
        try:
            port = int(parts[8])
        except ValueError:
            continue
        if not address or port <= 0:
            continue
        found.append({"host": address, "port": port, "proto": proto})
    v4 = [c for c in found if c["proto"] == "IPv4"]
    return v4 or found


def browse_pomo(timeout=4.0):
    """One-shot resolved browse. Empty list if avahi is missing or finds nothing."""
    try:
        proc = subprocess.run(
            ["avahi-browse", "-prt", "_pomo._tcp"],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except OSError:
        return []
    except subprocess.TimeoutExpired as exc:
        out = ""
        if exc.stdout:
            out = exc.stdout if isinstance(exc.stdout, str) else exc.stdout.decode("utf-8", "replace")
        return parse_avahi_browse(out)
    return parse_avahi_browse(proc.stdout or "")
