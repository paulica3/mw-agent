"""
/api/stats — track generation counts in Vercel KV.

GET  /api/stats         → returns { videos, images, currentMonth, firstUse }
POST /api/stats         → increments counters for one successful generation
                          body: { "type": "video"|"image", "taskId": "..." }

Each taskId is deduped via a TTL'd key so multiple polls of the same task
only ever count once. If the user generates a new render, the new taskId
counts separately.

Storage shape under STATS_KEY:
    {
      "videos":  47,
      "images":  132,
      "monthly": { "2026-05": 18, "2026-04": 22, ... },
      "firstUse": "2026-01-15"
    }
"""

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date
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
STATS_KEY  = "xa-stats"
DEDUP_TTL  = 7 * 24 * 60 * 60  # 7 days — plenty for polling stragglers


# ---------- KV helpers ----------

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


def _kv_get(key: str):
    res = _kv_request("GET", f"/get/{key}")
    return res.get("result") if res else None


def _kv_set(key: str, value: str) -> bool:
    res = _kv_request("POST", f"/set/{key}", value)
    return bool(res and res.get("result") == "OK")


def _kv_setex(key: str, seconds: int, value: str) -> bool:
    """SET key value EX seconds — used for dedup flags so KV cleans them up."""
    res = _kv_request("POST", f"/setex/{key}/{seconds}", value)
    return bool(res and res.get("result") == "OK")


# ---------- stats shape ----------

def _default_stats() -> dict:
    return {"videos": 0, "images": 0, "monthly": {}, "firstUse": None}


def _load_stats() -> dict:
    raw = _kv_get(STATS_KEY)
    if not raw:
        return _default_stats()
    try:
        data = json.loads(raw)
        base = _default_stats()
        base.update(data if isinstance(data, dict) else {})
        return base
    except (json.JSONDecodeError, TypeError):
        return _default_stats()


def _save_stats(stats: dict) -> bool:
    return _kv_set(STATS_KEY, json.dumps(stats))


def _enrich(stats: dict) -> dict:
    """Adds derived `currentMonth` from the monthly buckets."""
    month_key = date.today().strftime("%Y-%m")
    out = dict(stats)
    out["currentMonth"] = (stats.get("monthly") or {}).get(month_key, 0)
    return out


# ---------- handler ----------

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
        if not check_request(self):
            return
        try:
            self._send(200, _enrich(_load_stats()))
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": str(e)})

    def do_POST(self) -> None:
        if not check_request(self):
            return
        if not KV_URL or not KV_TOKEN:
            self._send(503, {"error": "kv not configured"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            if length <= 0 or length > 4096:
                self._send(400, {"error": "empty or oversized body"})
                return
            req = json.loads(self.rfile.read(length).decode("utf-8"))

            gen_type = req.get("type")
            task_id  = (req.get("taskId") or "").strip()
            if gen_type not in ("video", "image"):
                self._send(400, {"error": "type must be 'video' or 'image'"})
                return
            if not task_id:
                self._send(400, {"error": "missing taskId"})
                return

            # dedup: only count each taskId once even if the frontend retries
            dedup_key = f"xa-stats-counted:{gen_type}:{task_id}"
            if _kv_get(dedup_key):
                self._send(200, _enrich(_load_stats()))
                return
            _kv_setex(dedup_key, DEDUP_TTL, "1")

            stats = _load_stats()
            field = "videos" if gen_type == "video" else "images"
            stats[field] = int(stats.get(field, 0)) + 1

            today_iso = date.today().isoformat()
            month_key = today_iso[:7]
            monthly = dict(stats.get("monthly") or {})
            monthly[month_key] = int(monthly.get(month_key, 0)) + 1
            stats["monthly"] = monthly

            if not stats.get("firstUse"):
                stats["firstUse"] = today_iso

            _save_stats(stats)
            self._send(200, _enrich(stats))

        except json.JSONDecodeError:
            self._send(400, {"error": "invalid json"})
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": str(e)})
