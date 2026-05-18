"""
POST /api/generate — kicks off a Kling video render.

Request body (JSON):
    {
      "prompt":        "<assembled prompt string>",
      "duration":      "5" | "10",
      "reference":     "data:image/png;base64,..." | "data:video/mp4;base64,..."  (optional)
      "referenceType": "image" | "video"  (optional, paired with reference)
    }

Response:
    200  { "taskId": "<kling task id>" }
    4xx  { "error": "..." }
    5xx  { "error": "..." }

Env vars required (set in Vercel dashboard):
    KLING_ACCESS_KEY   — issuer for the JWT (Kling console "Access Key")
    KLING_SECRET_KEY   — HMAC secret for signing the JWT
    KLING_API_BASE     — optional, defaults to https://api.klingai.com

Kling auth is JWT (HS256) signed from access_key + secret_key with a short
TTL. No external libs — built from stdlib hmac/hashlib/base64.
"""

import base64
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import check_request


KLING_ACCESS_KEY = os.environ.get("KLING_ACCESS_KEY", "")
KLING_SECRET_KEY = os.environ.get("KLING_SECRET_KEY", "")
KLING_API_BASE   = os.environ.get("KLING_API_BASE", "https://api.klingai.com").rstrip("/")

# fallback model if no quality preset is matched (or env override)
KLING_MODEL = os.environ.get("KLING_MODEL", "kling-v1-6")

# quality preset → (model_name, mode). frontend "QUALITY" chip selects one.
QUALITY_PRESETS = {
    "draft":    {"model": "kling-v1-5",      "mode": "std"},
    "standard": {"model": "kling-v1-6",      "mode": "std"},
    "pro":      {"model": "kling-v1-6",      "mode": "pro"},
    "master":   {"model": "kling-v2-master", "mode": "std"},
}


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def make_jwt(access_key: str, secret_key: str) -> str:
    """Build a HS256 JWT in the shape Kling expects."""
    header  = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "iss": access_key,
        "exp": int(time.time()) + 1800,  # 30 min
        "nbf": int(time.time()) - 5,
    }
    h_b = _b64url(json.dumps(header,  separators=(",", ":")).encode())
    p_b = _b64url(json.dumps(payload, separators=(",", ":")).encode())
    msg = f"{h_b}.{p_b}".encode()
    sig = hmac.new(secret_key.encode(), msg, hashlib.sha256).digest()
    return f"{h_b}.{p_b}.{_b64url(sig)}"


def _kling_post(path: str, body: dict, token: str) -> dict:
    req = urllib.request.Request(
        f"{KLING_API_BASE}{path}",
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _strip_data_url(s: str) -> str:
    """Turns 'data:image/png;base64,XXXX' into just 'XXXX'."""
    if s.startswith("data:") and ";base64," in s:
        return s.split(";base64,", 1)[1]
    return s


class handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self) -> None:
        if not check_request(self):
            return
        if not KLING_ACCESS_KEY or not KLING_SECRET_KEY:
            self._send(503, {"error": "KLING_ACCESS_KEY / KLING_SECRET_KEY not configured in vercel env"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            if length <= 0 or length > 6_000_000:  # vercel hobby ~4.5MB; allow a little slack
                self._send(400, {"error": "empty or oversized body"})
                return
            req = json.loads(self.rfile.read(length).decode("utf-8"))

            prompt = (req.get("prompt") or "").strip()
            if not prompt:
                self._send(400, {"error": "missing prompt"})
                return

            duration  = str(req.get("duration") or "5")
            reference = req.get("reference")
            ref_type  = req.get("referenceType")

            # resolve model + mode from quality preset (frontend chip)
            quality = (req.get("quality") or "standard").lower()
            preset  = QUALITY_PRESETS.get(quality)
            if preset:
                model_name = preset["model"]
                mode       = preset["mode"]
            else:
                model_name = KLING_MODEL  # fallback to env var
                mode       = "std"

            token = make_jwt(KLING_ACCESS_KEY, KLING_SECRET_KEY)

            # image-to-video if a reference image was supplied, otherwise text-to-video
            if reference and ref_type == "image":
                body = {
                    "model_name":   model_name,
                    "mode":         mode,
                    "image":        _strip_data_url(reference),
                    "prompt":       prompt,
                    "duration":     duration,
                    "aspect_ratio": "16:9",
                }
                kling_resp    = _kling_post("/v1/videos/image2video", body, token)
                endpoint_kind = "image2video"
            else:
                body = {
                    "model_name":   model_name,
                    "mode":         mode,
                    "prompt":       prompt,
                    "duration":     duration,
                    "aspect_ratio": "16:9",
                }
                kling_resp    = _kling_post("/v1/videos/text2video", body, token)
                endpoint_kind = "text2video"

            # Kling responses wrap data in { code, message, data: { task_id, ... } }
            if kling_resp.get("code") not in (0, 200, None):
                self._send(502, {"error": f"kling error: {kling_resp.get('message', 'unknown')}"})
                return

            task_id = (kling_resp.get("data") or {}).get("task_id")
            if not task_id:
                self._send(502, {"error": "kling response missing task_id"})
                return

            self._send(200, {"taskId": task_id, "kind": endpoint_kind})

        except urllib.error.HTTPError as e:
            try:
                detail = e.read().decode("utf-8")[:300]
            except Exception:
                detail = ""
            self._send(502, {"error": f"kling http {e.code}: {detail}"})
        except json.JSONDecodeError:
            self._send(400, {"error": "invalid json body"})
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": str(e)})
