"""Default socket, status, pairing, and systemd paths for pomo-link."""

from __future__ import annotations

import os


def home():
    return os.environ.get("HOME") or os.path.expanduser("~")


def socket_path():
    override = os.environ.get("POMO_LINK_SOCKET")
    if override:
        return override
    runtime = os.environ.get("XDG_RUNTIME_DIR")
    if runtime:
        return os.path.join(runtime, "pomo", "pomo-link.sock")
    return os.path.join("/tmp", "pomo-%s" % os.getuid(), "pomo-link.sock")


def status_path():
    override = os.environ.get("POMO_LINK_STATUS")
    if override:
        return override
    xdg = os.environ.get("XDG_STATE_HOME")
    if xdg:
        return os.path.join(xdg, "pomo", "waybar.json")
    return os.path.join(home(), ".local", "state", "pomo", "waybar.json")


def desktop_client_config_path():
    override = os.environ.get("POMO_DESKTOP_CLIENT_CONFIG")
    if override:
        return override
    xdg = os.environ.get("XDG_CONFIG_HOME")
    if xdg:
        return os.path.join(xdg, "pomo", "desktop-client.json")
    return os.path.join(home(), ".config", "pomo", "desktop-client.json")


def systemd_user_dir():
    xdg = os.environ.get("XDG_CONFIG_HOME")
    if xdg:
        return os.path.join(xdg, "systemd", "user")
    return os.path.join(home(), ".config", "systemd", "user")


def systemd_unit_path():
    return os.path.join(systemd_user_dir(), "pomo-link.service")


def local_bin_dir():
    return os.path.join(home(), ".local", "bin")
