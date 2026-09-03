"""Unix-socket command channel for the pomo-link daemon."""

from __future__ import annotations

import json
import os
import socket
import stat


def _probe_live(path):
    probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    probe.settimeout(0.3)
    try:
        probe.connect(path)
    except OSError:
        return False
    finally:
        try:
            probe.close()
        except OSError:
            pass
    return True


class UnixCommandServer:
    def __init__(self, path):
        from .paths import ensure_socket_dir

        self.path = path
        ensure_socket_dir(path)
        try:
            st = os.lstat(path)
        except FileNotFoundError:
            st = None
        except OSError:
            st = None
        if st is not None:
            if not stat.S_ISSOCK(st.st_mode):
                raise OSError("refusing to replace non-socket path: %s" % path)
            if _probe_live(path):
                raise OSError("pomo-link daemon is already running at %s" % path)
            try:
                os.unlink(path)
            except OSError:
                pass
        self.listen = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.listen.setblocking(False)
        self.listen.bind(path)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
        try:
            self._sock_id = (os.stat(path).st_dev, os.stat(path).st_ino)
        except OSError:
            self._sock_id = None
        self.listen.listen(16)
        self.clients = {}

    def sockets(self):
        return [self.listen, *self.clients]

    def close(self):
        for sock in list(self.clients):
            self._drop(sock)
        try:
            self.listen.close()
        except OSError:
            pass
        try:
            st = os.lstat(self.path)
        except OSError:
            return
        if self._sock_id is not None:
            if (st.st_dev, st.st_ino) != self._sock_id:
                return
        elif not stat.S_ISSOCK(st.st_mode):
            return
        try:
            os.unlink(self.path)
        except OSError:
            pass

    def pump(self, ready, on_line):
        if self.listen in ready:
            try:
                conn, _ignored = self.listen.accept()
            except BlockingIOError:
                conn = None
            except OSError:
                conn = None
            if conn is not None:
                conn.setblocking(False)
                self.clients[conn] = bytearray()
        for sock in list(self.clients):
            if sock not in ready:
                continue
            try:
                chunk = sock.recv(4096)
            except BlockingIOError:
                continue
            except OSError:
                chunk = b""
            if not chunk:
                self._drop(sock)
                continue
            self.clients[sock].extend(chunk)
            self._flush_lines(sock, on_line)

    def _flush_lines(self, sock, on_line):
        buf = self.clients.get(sock)
        if buf is None:
            return
        while True:
            idx = buf.find(b"\n")
            if idx < 0:
                break
            line = bytes(buf[:idx]).decode("utf-8", "replace")
            del buf[: idx + 1]
            reply = on_line(line)
            if reply is None:
                continue
            if isinstance(reply, dict):
                payload = json.dumps(reply, separators=(",", ":"), ensure_ascii=False) + "\n"
            else:
                payload = str(reply)
                if not payload.endswith("\n"):
                    payload += "\n"
            try:
                sock.sendall(payload.encode("utf-8"))
            except OSError:
                self._drop(sock)
                return

    def _drop(self, sock):
        self.clients.pop(sock, None)
        try:
            sock.close()
        except OSError:
            pass


def send_command(path, command, timeout=5.0):
    if isinstance(command, dict):
        line = json.dumps(command, separators=(",", ":"), ensure_ascii=False)
    else:
        line = str(command)
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect(path)
        sock.sendall((line + "\n").encode("utf-8"))
        chunks = []
        while True:
            try:
                chunk = sock.recv(4096)
            except socket.timeout:
                break
            if not chunk:
                break
            chunks.append(chunk)
            if b"\n" in chunk:
                break
    finally:
        try:
            sock.close()
        except OSError:
            pass
    raw = b"".join(chunks).decode("utf-8", "replace").strip()
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"raw": raw}
