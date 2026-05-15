"""
GET /api/status?id=<task_id>&kind=<text2video|image2video>

Polls the Kling task and normalizes the response for the frontend.

Response:
    200 { "status": "processing" | "succeeded" | "failed",
          "message": "<human readable status>",
          "videoUrl": "<url when succeeded>",
          "progress": 0..100 }
    4xx / 5xx { "error": "..." }
"""

import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler


KLING_ACCESS_KEY = os.environ.get("KLING_ACCESS_KEY", "")
KLING_SECRET_KEY = os.environ.get("KLING_SECRET_KEY", "")
KLING_API_BASE   = os.environ.get("KLING_API_BASE", "https://api.klingai.com").rstrip("/")


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def make_jwt(access_key: str, secret_key: str) -> str:
    header  = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "iss": access_key,
        "exp": int(time.time()) + 1800,
        "nbf": int(time.time()) - 5,
    }
    h_b = _b64url(json.dumps(header,  separators=(",", ":")).encode())
    p_b = _b64url(json.dumps(payload, separators=(",", ":")).encode())
    msg = f"{h_b}.{p_b}".encode()
    sig = hmac.new(secret_key.encode(), msg, hashlib.sha256).digest()
    return f"{h_b}.{p_b}.{_b64url(sig)}"


def _kling_get(path: str, token: str) -> dict:
    req = urllib.request.Request(
        f"{KLING_API_BASE}{path}",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


# Kling reports task_status in CAPS strings — map to our frontend vocabulary
STATUS_MAP = {
    "submitted":   "processing",
    "processing":  "processing",
    "succeed":     "succeeded",
    "successful":  "succeeded",
    "failed":      "failed",
}


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
        if not KLING_ACCESS_KEY or not KLING_SECRET_KEY:
            self._send(503, {"error": "KLING_ACCESS_KEY / KLING_SECRET_KEY not configured"})
            return
        try:
            qs = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(qs)
            task_id = (params.get("id") or [""])[0]
            kind    = (params.get("kind") or ["text2video"])[0]
            if not task_id:
                self._send(400, {"error": "missing id"})
                return
            if kind not in ("text2video", "image2video"):
                kind = "text2video"

            token = make_jwt(KLING_ACCESS_KEY, KLING_SECRET_KEY)
            resp = _kling_get(f"/v1/videos/{kind}/{task_id}", token)

            if resp.get("code") not in (0, 200, None):
                self._send(502, {"error": f"kling error: {resp.get('message', 'unknown')}"})
                return

            data = resp.get("data") or {}
            raw_status = (data.get("task_status") or "").lower()
            status = STATUS_MAP.get(raw_status, "processing")
            message = data.get("task_status_msg") or raw_status or "rendering"

            out = {"status": status, "message": message}

            if status == "succeeded":
                videos = (data.get("task_result") or {}).get("videos") or []
                if videos:
                    out["videoUrl"] = videos[0].get("url")
                if not out.get("videoUrl"):
                    out["status"]  = "failed"
                    out["message"] = "kling reported success but no video url returned"

            self._send(200, out)

        except urllib.error.HTTPError as e:
            try:
                detail = e.read().decode("utf-8")[:300]
            except Exception:
                detail = ""
            self._send(502, {"error": f"kling http {e.code}: {detail}"})
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": str(e)})
