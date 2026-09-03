"""Minimal RFC6455 client. Stdlib only — no websockets package."""

from __future__ import annotations

import base64
import hashlib
import os
import select
import socket
import struct
import time

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_FRAME = 1024 * 1024


class WebSocketError(Exception):
    pass


def _accept_key(key):
    digest = hashlib.sha1((key + GUID).encode("ascii")).digest()
    return base64.b64encode(digest).decode("ascii")


def encode_frame(payload, opcode=1):
    if isinstance(payload, str):
        payload = payload.encode("utf-8")
    header = bytearray()
    header.append(0x80 | (opcode & 0x0F))
    length = len(payload)
    mask_bit = 0x80
    if length < 126:
        header.append(mask_bit | length)
    elif length < 65536:
        header.append(mask_bit | 126)
        header.extend(struct.pack("!H", length))
    else:
        header.append(mask_bit | 127)
        header.extend(struct.pack("!Q", length))
    key = os.urandom(4)
    header.extend(key)
    masked = bytes(b ^ key[i % 4] for i, b in enumerate(payload))
    return bytes(header) + masked


def _decode_frames(buf):
    """Return (messages, rest, ping_payloads, should_close)."""
    messages = []
    pings = []
    close = False
    i = 0
    while True:
        if len(buf) - i < 2:
            break
        b0 = buf[i]
        b1 = buf[i + 1]
        opcode = b0 & 0x0F
        masked = (b1 & 0x80) != 0
        length = b1 & 0x7F
        header_len = 2
        if length == 126:
            if len(buf) - i < 4:
                break
            length = struct.unpack("!H", buf[i + 2 : i + 4])[0]
            header_len = 4
        elif length == 127:
            if len(buf) - i < 10:
                break
            length = struct.unpack("!Q", buf[i + 2 : i + 10])[0]
            header_len = 10
        if length > MAX_FRAME:
            raise WebSocketError("frame too large")
        mask_len = 4 if masked else 0
        total = header_len + mask_len + length
        if len(buf) - i < total:
            break
        start = i + header_len
        if masked:
            key = buf[start : start + 4]
            start += 4
            payload = bytes(buf[start + j] ^ key[j % 4] for j in range(length))
        else:
            payload = bytes(buf[start : start + length])
        i += total
        if opcode == 0x8:
            close = True
            break
        if opcode == 0x9:
            pings.append(payload)
            continue
        if opcode == 0xA:
            continue
        if opcode in (0x1, 0x2, 0x0):
            messages.append((opcode, payload))
            continue
        # Unknown control/data: ignore.
    return messages, buf[i:], pings, close


class Rfc6455Client:
    def __init__(self):
        self.sock = None
        self.buffer = bytearray()
        self.connected = False
        self.host = ""
        self.port = 0

    def fileno(self):
        return self.sock.fileno() if self.sock is not None else -1

    def close(self):
        self.connected = False
        sock = self.sock
        self.sock = None
        self.buffer = bytearray()
        if sock is not None:
            try:
                sock.sendall(encode_frame(b"", opcode=0x8))
            except OSError:
                pass
            try:
                sock.close()
            except OSError:
                pass

    def connect(self, host, port, path="/ws", timeout=5.0):
        self.close()
        self.host = host
        self.port = int(port)
        sock = socket.create_connection((host, int(port)), timeout=timeout)
        sock.settimeout(timeout)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        host_header = host if ":" not in host else "[%s]" % host
        request = (
            "GET %s HTTP/1.1\r\n"
            "Host: %s:%d\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Key: %s\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "\r\n"
        ) % (path, host_header, int(port), key)
        sock.sendall(request.encode("ascii"))
        data = b""
        deadline = time.monotonic() + timeout
        while b"\r\n\r\n" not in data:
            if time.monotonic() > deadline:
                sock.close()
                raise WebSocketError("handshake timeout")
            chunk = sock.recv(4096)
            if not chunk:
                sock.close()
                raise WebSocketError("handshake closed")
            data += chunk
            if len(data) > 65536:
                sock.close()
                raise WebSocketError("handshake too large")
        header, rest = data.split(b"\r\n\r\n", 1)
        status_line = header.split(b"\r\n", 1)[0].decode("ascii", "replace")
        if " 101 " not in status_line:
            sock.close()
            raise WebSocketError("expected 101, got %s" % status_line)
        accept = None
        for line in header.split(b"\r\n")[1:]:
            if line.lower().startswith(b"sec-websocket-accept:"):
                accept = line.split(b":", 1)[1].strip().decode("ascii")
        if accept != _accept_key(key):
            sock.close()
            raise WebSocketError("bad Sec-WebSocket-Accept")
        sock.setblocking(False)
        self.sock = sock
        self.buffer = bytearray(rest)
        self.connected = True
        return True

    def send_text(self, text):
        if not self.connected or self.sock is None:
            raise WebSocketError("not connected")
        self.sock.setblocking(True)
        try:
            self.sock.sendall(encode_frame(text, opcode=1))
        finally:
            try:
                self.sock.setblocking(False)
            except OSError:
                pass

    def send_pong(self, payload=b""):
        if not self.connected or self.sock is None:
            return
        try:
            self.sock.setblocking(True)
            self.sock.sendall(encode_frame(payload, opcode=0xA))
        except OSError:
            self.connected = False
        finally:
            try:
                if self.sock is not None:
                    self.sock.setblocking(False)
            except OSError:
                pass

    def recv_ready(self, timeout=0.0):
        if not self.connected or self.sock is None:
            return False
        try:
            r, _, _ = select.select([self.sock], [], [], timeout)
            return bool(r)
        except (OSError, ValueError):
            return False

    def read_texts(self):
        """Read available frames. Returns list of text strings. Empty list if none.

        Raises WebSocketError on close/error.
        """
        if not self.connected or self.sock is None:
            raise WebSocketError("not connected")
        while True:
            try:
                chunk = self.sock.recv(65536)
            except BlockingIOError:
                break
            except OSError as exc:
                self.connected = False
                raise WebSocketError("recv failed") from exc
            if not chunk:
                self.connected = False
                raise WebSocketError("socket closed")
            self.buffer.extend(chunk)
            if len(chunk) < 65536:
                break
        texts = []
        try:
            frames, rest, pings, close = _decode_frames(self.buffer)
        except WebSocketError:
            self.connected = False
            raise
        self.buffer = bytearray(rest)
        for payload in pings:
            self.send_pong(payload)
        if close:
            self.connected = False
            raise WebSocketError("peer closed")
        for opcode, payload in frames:
            if opcode == 0x1:
                texts.append(payload.decode("utf-8", "replace"))
            elif opcode == 0x0:
                # Treat continuation as text if we have no fragment state.
                texts.append(payload.decode("utf-8", "replace"))
        return texts
