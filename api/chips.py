"""
/api/chips — read and write the user's chip configuration.

Storage: Vercel KV (Upstash Redis under the hood). The vercel.com dashboard
auto-injects KV_REST_API_URL and KV_REST_API_TOKEN into the function env
when a KV store is connected to the project.

Endpoints:
    GET    /api/chips          → returns the stored chips JSON, or the
                                  bundled defaults if KV is empty / unset
    POST   /api/chips          → overwrites the stored chips with the
                                  request body (must be valid JSON)
    DELETE /api/chips          → resets to defaults (wipes the KV entry)

The handler uses stdlib only — no Python deps to declare. Calls Upstash's
HTTP REST API directly via urllib.
"""

import json
import os
import pathlib
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler


# accept either set of env var names — vercel has used both over time
KV_URL = (
    os.environ.get("KV_REST_API_URL")
    or os.environ.get("UPSTASH_REDIS_REST_URL")
    or ""
).rstrip("/")
KV_TOKEN = (
    os.environ.get("KV_REST_API_TOKEN")
    or os.environ.get("UPSTASH_REDIS_REST_TOKEN")
    or ""
)
STORE_KEY = "xa-chips"

DEFAULTS_PATH = pathlib.Path(__file__).resolve().parent.parent / "data" / "defaults.json"


def _load_defaults() -> dict:
    return json.loads(DEFAULTS_PATH.read_text(encoding="utf-8"))


def _kv_get(key: str):
    """Returns the stored value (string) or None if missing / KV not configured."""
    if not KV_URL or not KV_TOKEN:
        return None
    req = urllib.request.Request(
        f"{KV_URL}/get/{key}",
        headers={"Authorization": f"Bearer {KV_TOKEN}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("result")
    except urllib.error.URLError:
        return None


def _kv_set(key: str, value: str) -> bool:
    if not KV_URL or not KV_TOKEN:
        return False
    req = urllib.request.Request(
        f"{KV_URL}/set/{key}",
        data=value.encode("utf-8"),
        method="POST",
        headers={"Authorization": f"Bearer {KV_TOKEN}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("result") == "OK"
    except urllib.error.URLError:
        return False


def _kv_del(key: str) -> bool:
    if not KV_URL or not KV_TOKEN:
        return False
    req = urllib.request.Request(
        f"{KV_URL}/del/{key}",
        method="POST",
        headers={"Authorization": f"Bearer {KV_TOKEN}"},
    )
    try:
        urllib.request.urlopen(req, timeout=10)
        return True
    except urllib.error.URLError:
        return False


def _validate(payload) -> bool:
    """Loose schema validation for chip config."""
    if not isinstance(payload, dict):
        return False
    cats = payload.get("categories")
    if not isinstance(cats, list):
        return False
    for cat in cats:
        if not isinstance(cat, dict):
            return False
        if not all(k in cat for k in ("id", "label", "showOn", "chips")):
            return False
        if not isinstance(cat["chips"], list):
            return False
        for chip in cat["chips"]:
            if not isinstance(chip, dict):
                return False
            if not all(k in chip for k in ("value", "label", "fragment")):
                return False
    return True


class handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        try:
            stored = _kv_get(STORE_KEY)
            if stored:
                self._send(200, json.loads(stored))
                return
            self._send(200, _load_defaults())
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": str(e)})

    def do_POST(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            if length <= 0 or length > 200_000:  # 200KB ceiling, way more than needed
                self._send(400, {"error": "empty or oversized body"})
                return
            raw = self.rfile.read(length).decode("utf-8")
            parsed = json.loads(raw)
            if not _validate(parsed):
                self._send(400, {"error": "invalid schema"})
                return
            ok = _kv_set(STORE_KEY, json.dumps(parsed))
            if not ok:
                self._send(503, {"error": "kv unavailable — check vercel storage setup"})
                return
            self._send(200, {"ok": True})
        except json.JSONDecodeError:
            self._send(400, {"error": "invalid json"})
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": str(e)})

    def do_DELETE(self) -> None:
        try:
            _kv_del(STORE_KEY)
            self._send(200, _load_defaults())
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": str(e)})
