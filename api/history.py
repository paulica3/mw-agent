"""
/api/history — record + browse past generations.

GET    /api/history                  → list all (most recent first)
GET    /api/history?page=image       → filter by page
POST   /api/history                  → append a new entry
DELETE /api/history?id=<entry_id>    → remove one
DELETE /api/history?all=1            → wipe all

Storage: KV key xa-history holding a JSON array of entries, capped at MAX.

Entry schema:
    {
      "id":          "h_<timestamp>_<rand>",
      "page":        "image" | "video",
      "prompt":      "...",
      "mediaUrl":    "https://...",
      "model":       "kling-v1-6" | "flux-pro-1.1-ultra",
      "quality":     "standard",       (video only)
      "duration":    "5",              (video only)
      "aspectRatio": "1:1",            (image only)
      "taskId":      "...",
      "createdAt":   "2026-05-14T17:30:00Z"
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
STORE_KEY = "xa-history"
MAX_ENTRIES = 200


def _kv_request(method, path, data=None):
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


def _kv_del(key):
    res = _kv_request("POST", f"/del/{key}")
    return bool(res)


def _load() -> list:
    res = _kv_request("GET", f"/get/{STORE_KEY}")
    if not res or not res.get("result"):
        return []
    try:
        data = json.loads(res["result"])
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save(entries: list) -> bool:
    res = _kv_request("POST", f"/set/{STORE_KEY}", json.dumps(entries))
    return bool(res and res.get("result") == "OK")


def _make_id() -> str:
    return f"h_{int(time.time())}_{secrets.token_hex(3)}"


def _trim(s, max_len: int = 4000) -> str:
    return str(s or "")[:max_len]


class handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _kv_missing(self):
        if not KV_URL or not KV_TOKEN:
            self._send(503, {"error": "kv not configured"})
            return True
        return False

    def do_GET(self):
        if not check_request(self): return
        if self._kv_missing(): return
        try:
            qs = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(qs)
            page_filter = (params.get("page") or [""])[0]
            entries = _load()
            if page_filter in ("image", "video"):
                entries = [e for e in entries if e.get("page") == page_filter]
            self._send(200, {"history": entries})
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": str(e)})

    def do_POST(self):
        if not check_request(self): return
        if self._kv_missing(): return
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            if length <= 0 or length > 50_000:
                self._send(400, {"error": "empty or oversized body"})
                return
            req = json.loads(self.rfile.read(length).decode("utf-8"))

            page = req.get("page")
            if page not in ("image", "video"):
                self._send(400, {"error": "page must be 'image' or 'video'"})
                return

            entry = {
                "id":          _make_id(),
                "page":        page,
                "prompt":      _trim(req.get("prompt"), 3000),
                "mediaUrl":    _trim(req.get("mediaUrl"), 800),
                "model":       _trim(req.get("model"), 60),
                "taskId":      _trim(req.get("taskId"), 80),
                "createdAt":   time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            # optional per-page fields
            if page == "video":
                entry["quality"]  = _trim(req.get("quality"), 30)
                entry["duration"] = _trim(req.get("duration"), 10)
            else:
                entry["aspectRatio"] = _trim(req.get("aspectRatio"), 10)

            entries = _load()
            entries.insert(0, entry)
            if len(entries) > MAX_ENTRIES:
                entries = entries[:MAX_ENTRIES]

            if not _save(entries):
                self._send(503, {"error": "kv write failed"})
                return
            self._send(200, {"entry": entry})

        except json.JSONDecodeError:
            self._send(400, {"error": "invalid json"})
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": str(e)})

    def do_DELETE(self):
        if not check_request(self): return
        if self._kv_missing(): return
        try:
            qs = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(qs)
            if params.get("all") == ["1"]:
                _kv_del(STORE_KEY)
                self._send(200, {"history": []})
                return
            entry_id = (params.get("id") or [""])[0]
            if not entry_id:
                self._send(400, {"error": "missing id"})
                return
            entries = [e for e in _load() if e.get("id") != entry_id]
            if not _save(entries):
                self._send(503, {"error": "kv write failed"})
                return
            self._send(200, {"history": entries})
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": str(e)})
