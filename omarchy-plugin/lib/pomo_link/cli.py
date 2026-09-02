"""pomo-link CLI: Omarchy stdin engine, Waybar daemon, and socket commands."""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import time

from .ipc import send_command
from .main import run_engine
from .paths import local_bin_dir, socket_path, status_path, systemd_unit_path
from .persist import load_json
from .waybar import format_waybar

USAGE = """pomo-link

Commands:
  (no args)              Omarchy mode: stdin commands, stdout NDJSON
  --daemon               Waybar daemon: unix socket + status file
  cmd <toggle|skip|reset|extend|ping>
                         Send a command to the running daemon
  waybar                 Stream Waybar JSON from the daemon status file
  service install        Write and enable the systemd user unit
  service start|stop|status
  pair-json '<payload>'  Send a {url, token} payload to the daemon
"""

SYSTEMD_UNIT = "pomo-link.service"


def _package_bin():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, "..", "..", "bin", "pomo-link"))


def _executable():
    override = os.environ.get("POMO_LINK")
    if override:
        return os.path.abspath(override)
    packaged = _package_bin()
    if os.path.isfile(packaged):
        return packaged
    found = shutil.which(sys.argv[0])
    if found:
        return os.path.realpath(found)
    return os.path.abspath(sys.argv[0])


def _service_template(exec_path):
    quoted = '"%s"' % exec_path.replace('"', '\\"')
    return """[Unit]
Description=Pomo hybrid timer for Waybar
After=default.target

[Service]
Type=simple
ExecStart=%s --daemon
Restart=on-failure
RestartSec=2
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=default.target
""" % quoted


def _systemctl(*args):
    return subprocess.run(
        ["systemctl", "--user", *args],
        check=False,
        capture_output=True,
        text=True,
    )


def run_daemon():
    return run_engine(
        status_path=status_path(),
        socket_path=socket_path(),
        stdout_status=False,
        notify_events=True,
        import_desktop_pairing=True,
        use_stdin=False,
    )


def run_cmd(args):
    if not args:
        sys.stderr.write("usage: pomo-link cmd <toggle|skip|reset|extend|ping>\n")
        return 2
    gesture = args[0]
    if gesture not in ("toggle", "skip", "reset", "extend", "ping"):
        sys.stderr.write("unknown command: %s\n" % gesture)
        return 2
    path = socket_path()
    try:
        reply = send_command(path, {"cmd": gesture})
    except (OSError, ConnectionError) as exc:
        sys.stderr.write("pomo-link daemon is not running (%s)\n" % exc)
        return 1
    if reply is None:
        sys.stderr.write("pomo-link daemon returned no status\n")
        return 1
    sys.stdout.write(json.dumps(reply, separators=(",", ":")) + "\n")
    return 0


def run_pair_json(raw):
    path = socket_path()
    try:
        reply = send_command(path, {"cmd": "pair", "arg": raw})
    except (OSError, ConnectionError) as exc:
        sys.stderr.write("pomo-link daemon is not running (%s)\n" % exc)
        return 1
    if reply is None:
        sys.stderr.write("pomo-link daemon returned no status\n")
        return 1
    sys.stdout.write(json.dumps(reply, separators=(",", ":")) + "\n")
    return 0


def run_waybar():
    path = status_path()

    def _stop(_signum, _frame):
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    last = None
    while True:
        data = load_json(path)
        line = format_waybar(data if isinstance(data, dict) else None)
        if line != last:
            sys.stdout.write(line + "\n")
            sys.stdout.flush()
            last = line
        time.sleep(0.5)


def _install_symlink(exec_path):
    dest_dir = local_bin_dir()
    os.makedirs(dest_dir, mode=0o755, exist_ok=True)
    dest = os.path.join(dest_dir, "pomo-link")
    if os.path.islink(dest) or os.path.exists(dest):
        if os.path.realpath(dest) == os.path.realpath(exec_path):
            return dest
        try:
            os.unlink(dest)
        except OSError:
            return dest
    try:
        os.symlink(exec_path, dest)
    except OSError:
        try:
            shutil.copy2(exec_path, dest)
            os.chmod(dest, 0o755)
        except OSError:
            return None
    return dest


def run_service(args):
    action = args[0] if args else ""
    if action == "install":
        exec_path = _executable()
        unit_path = systemd_unit_path()
        os.makedirs(os.path.dirname(unit_path), mode=0o755, exist_ok=True)
        with open(unit_path, "w", encoding="utf-8") as handle:
            handle.write(_service_template(exec_path))
        link = _install_symlink(exec_path)
        reload = _systemctl("daemon-reload")
        enable = _systemctl("enable", "--now", SYSTEMD_UNIT)
        if reload.returncode != 0 or enable.returncode != 0:
            err = (enable.stderr or reload.stderr or "").strip()
            sys.stderr.write("wrote %s" % unit_path)
            if link:
                sys.stderr.write("; linked %s" % link)
            sys.stderr.write(", but systemctl failed: %s\n" % (err or "unknown error"))
            return 1
        sys.stdout.write("Installed and started %s\n" % unit_path)
        if link:
            sys.stdout.write("Linked %s\n" % link)
        return 0
    if action == "start":
        result = _systemctl("start", SYSTEMD_UNIT)
        sys.stdout.write((result.stdout or result.stderr or "started\n"))
        return result.returncode
    if action == "stop":
        result = _systemctl("stop", SYSTEMD_UNIT)
        sys.stdout.write((result.stdout or result.stderr or "stopped\n"))
        return result.returncode
    if action == "status":
        result = _systemctl("status", "--no-pager", SYSTEMD_UNIT)
        sys.stdout.write(result.stdout or "")
        sys.stderr.write(result.stderr or "")
        return 0 if result.returncode in (0, 3) else result.returncode
    sys.stderr.write("usage: pomo-link service <install|start|stop|status>\n")
    return 2


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        return run_engine()
    head = argv[0]
    if head in ("-h", "--help", "help"):
        sys.stdout.write(USAGE)
        return 0
    if head in ("--daemon", "daemon"):
        return run_daemon()
    if head == "cmd":
        return run_cmd(argv[1:])
    if head == "waybar":
        return run_waybar()
    if head == "service":
        return run_service(argv[1:])
    if head == "pair-json":
        if len(argv) < 2:
            sys.stderr.write("usage: pomo-link pair-json '<payload>'\n")
            return 2
        return run_pair_json(argv[1])
    sys.stderr.write(USAGE)
    return 2
