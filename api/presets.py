"""
/api/presets — save and recall named chip combinations.

GET    /api/presets               → list all presets
POST   /api/presets               → save a new preset
                                     body: { name, page, selections, director }
DELETE /api/presets?id=<preset_id> → remove a preset by id

Storage: a single KV key xa-presets holding a JSON array of preset objects.

Schema:
    {
      "id":         "p_<timestamp>_<rand>",
      "name":       "Yeat-style cold open",
      "page":       "image" | "video",
      "selections": { "theme": "opium", "mood": "menacing", ... },
      "director":   "lone figure under a single streetlight...",
      "createdAt":  "2026-05-14T17:30:00.000Z"
    }
"""

import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import check_request


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
STORE_KEY = "xa-presets"
MAX_PRESETS = 50  # safety cap


def _kv_request(method: str, path: str, data: str | None = None):
    if not KV_URL or not KV_TOKEN:
        return None
    req = urllib.request.Request(
        f"{KV_URL}{path}",
        data=data.encode("utf-8") if data is not None else None,
        method=method,
        headers={"Authorization": f"Bearer {KV_TOKEN}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError:
        return None


def _load_presets() -> list:
    res = _kv_request("GET", f"/get/{STORE_KEY}")
    if not res or not res.get("result"):
        return []
    try:
        data = json.loads(res["result"])
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def _save_presets(presets: list) -> bool:
    res = _kv_request("POST", f"/set/{STORE_KEY}", json.dumps(presets))
    return bool(res and res.get("result") == "OK")


def _make_id() -> str:
    return f"p_{int(time.time())}_{secrets.token_hex(3)}"


def _safe_str(v, max_len: int = 200) -> str:
    return str(v or "")[:max_len].strip()


class handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _kv_missing(self) -> bool:
        if not KV_URL or not KV_TOKEN:
            self._send(503, {"error": "kv not configured"})
            return True
        return False

    def do_GET(self) -> None:
        if not check_request(self):
            return
        if self._kv_missing():
            return
        self._send(200, {"presets": _load_presets()})

    def do_POST(self) -> None:
        if not check_request(self):
            return
        if self._kv_missing():
            return
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            if length <= 0 or length > 20_000:
                self._send(400, {"error": "empty or oversized body"})
                return
            req = json.loads(self.rfile.read(length).decode("utf-8"))

            name        = _safe_str(req.get("name"), 60)
            page        = _safe_str(req.get("page"), 20)
            director    = _safe_str(req.get("director"), 600)
            selections  = req.get("selections") or {}

            if not name:
                self._send(400, {"error": "missing name"})
                return
            if page not in ("image", "video"):
                self._send(400, {"error": "page must be 'image' or 'video'"})
                return
            if not isinstance(selections, dict):
                self._send(400, {"error": "selections must be an object"})
                return

            presets = _load_presets()
            if len(presets) >= MAX_PRESETS:
                self._send(400, {"error": f"preset limit reached ({MAX_PRESETS})"})
                return

            preset = {
                "id":         _make_id(),
                "name":       name,
                "page":       page,
                "selections": {k: _safe_str(v, 100) for k, v in selections.items()},
                "director":   director,
                "createdAt":  time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            presets.insert(0, preset)
            if not _save_presets(presets):
                self._send(503, {"error": "kv write failed"})
                return
            self._send(200, {"preset": preset, "presets": presets})

        except json.JSONDecodeError:
            self._send(400, {"error": "invalid json"})
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": str(e)})

    def do_DELETE(self) -> None:
        if not check_request(self):
            return
        if self._kv_missing():
            return
        try:
            qs = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(qs)
            preset_id = (params.get("id") or [""])[0]
            if not preset_id:
                self._send(400, {"error": "missing id"})
                return

            presets = [p for p in _load_presets() if p.get("id") != preset_id]
            if not _save_presets(presets):
                self._send(503, {"error": "kv write failed"})
                return
            self._send(200, {"presets": presets})
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": str(e)})
