"""Import {url, token} from the Node desktop-client config if the engine has none."""

from __future__ import annotations

from .client import parse_pairing_payload
from .paths import desktop_client_config_path
from .persist import load_json


def load_desktop_client_pairing(path=None):
    """Return a parse_pairing_payload dict, or {} if nothing usable is stored."""
    data = load_json(path or desktop_client_config_path())
    if not isinstance(data, dict):
        return {}
    token = str(data.get("pairing_token") or data.get("token") or "").strip()
    url = str(data.get("phone_url") or data.get("url") or "").strip()
    if not token:
        return {}
    payload = {"token": token}
    if url:
        payload["url"] = url
    parsed = parse_pairing_payload(payload)
    if not parsed.get("token"):
        return {}
    return parsed
