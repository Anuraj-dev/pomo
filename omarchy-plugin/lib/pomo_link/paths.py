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
    # noqa: S108 -- stable per-uid fallback when XDG_RUNTIME_DIR is unset;
    # ensure_socket_dir() requires user-owned 0700 before bind.
    return os.path.join("/tmp", "pomo-%s" % os.getuid(), "pomo-link.sock")


def ensure_socket_dir(sock_path):
    """Require a user-owned, non-symlink 0700 parent dir before IPC bind."""
    import stat

    directory = os.path.dirname(sock_path)
    if not directory:
        return
    try:
        st = os.lstat(directory)
    except FileNotFoundError:
        os.makedirs(directory, mode=0o700, exist_ok=True)
        os.chmod(directory, 0o700)
        return
    if stat.S_ISLNK(st.st_mode):
        raise OSError("refusing IPC dir symlink: %s" % directory)
    if not stat.S_ISDIR(st.st_mode):
        raise OSError("IPC parent is not a directory: %s" % directory)
    if st.st_uid != os.getuid():
        raise OSError("IPC dir not owned by current user: %s" % directory)
    if stat.S_IMODE(st.st_mode) != 0o700:
        os.chmod(directory, 0o700)


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
