"""Unix-socket command channel for the pomo-link daemon."""

from __future__ import annotations

import json
import os
import socket


class UnixCommandServer:
    def __init__(self, path):
        self.path = path
        directory = os.path.dirname(path)
        if directory:
            os.makedirs(directory, mode=0o700, exist_ok=True)
            try:
                os.chmod(directory, 0o700)
            except OSError:
                pass
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
