"""Phone REST via urllib. Auth: X-Pomo-Token."""

from __future__ import annotations

import json
import urllib.error
import urllib.request

from .constants import HTTP_FLUSH_TIMEOUT_S, HTTP_TIMEOUT_S


class RestClient:
    def __init__(self):
        self.host = ""
        self.port = 0
        self.token = ""

    def configure(self, host, port, token):
        self.host = host or ""
        self.port = int(port or 0)
        self.token = token or ""

    def url(self, path, host=None, port=None):
        h = host if host is not None else self.host
        p = int(port if port is not None else self.port)
        if ":" in h and not h.startswith("["):
            h = "[%s]" % h
        return "http://%s:%d%s" % (h, p, path)

    def request(self, method, path, body=None, timeout=None, host=None, port=None, token=None):
        """Return (code, text). code 0 means transport failure."""
        timeout = HTTP_TIMEOUT_S if timeout is None else timeout
        tok = self.token if token is None else token
        data = None
        headers = {"X-Pomo-Token": tok or ""}
        if body is not None:
            if isinstance(body, (dict, list)):
                raw = json.dumps(body, separators=(",", ":")).encode("utf-8")
            elif isinstance(body, str):
                raw = body.encode("utf-8")
            else:
                raw = body
            data = raw
            headers["Content-Type"] = "application/json"
        if method == "POST" and data is None:
            data = b""
        req = urllib.request.Request(
            self.url(path, host=host, port=port),
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                text = resp.read().decode("utf-8", "replace")
                return int(resp.status), text
        except urllib.error.HTTPError as exc:
            try:
                text = exc.read().decode("utf-8", "replace")
            except Exception:
                text = ""
            return int(exc.code), text
        except Exception:
            return 0, ""

    def get_status(self, host=None, port=None, token=None, timeout=None):
        return self.request(
            "GET",
            "/api/status",
            timeout=timeout,
            host=host,
            port=port,
            token=token,
        )

    def get_config(self):
        return self.request("GET", "/api/config")

    def post(self, path, body=None, timeout=None):
        if timeout is None and path in ("/api/sessions/import", "/api/timer/adopt"):
            timeout = HTTP_FLUSH_TIMEOUT_S
        return self.request("POST", path, body=body, timeout=timeout)
