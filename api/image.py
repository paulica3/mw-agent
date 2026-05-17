"""
/api/image — image generation via Black Forest Labs (Flux 1.1 Pro Ultra).

POST  /api/image                  → start generation, returns { taskId }
GET   /api/image?id=<task_id>     → poll status, returns { status, imageUrl?, message? }

Request body for POST (JSON):
    {
      "prompt":        "<assembled prompt string>",
      "aspectRatio":   "1:1" | "16:9" | "9:16" | "21:9" | "4:3" | "3:4",
      "reference":     "data:image/png;base64,..."  (optional, for image-to-image)
    }

Env vars:
    BFL_API_KEY        — required, your Black Forest Labs API key
    BFL_API_BASE       — optional, defaults to https://api.bfl.ai
    BFL_MODEL          — optional, defaults to flux-pro-1.1-ultra

BFL responses look like:
    POST creates a task: { "id": "<task_id>", "polling_url": "..." }
    GET polls: { "status": "Pending"|"Ready"|"Error"|..., "result": { "sample": "<url>" } }
"""

import base64
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler


BFL_API_KEY  = os.environ.get("BFL_API_KEY", "")
BFL_API_BASE = os.environ.get("BFL_API_BASE", "https://api.bfl.ai").rstrip("/")
BFL_MODEL    = os.environ.get("BFL_MODEL", "flux-pro-1.1-ultra")

# valid aspect ratios accepted by Flux 1.1 Pro Ultra
ALLOWED_RATIOS = {"1:1", "16:9", "9:16", "21:9", "9:21", "4:3", "3:4", "3:2", "2:3"}


def _strip_data_url(s: str) -> str:
    if s.startswith("data:") and ";base64," in s:
        return s.split(";base64,", 1)[1]
    return s


def _bfl_request(method: str, path: str, body: dict | None = None) -> dict:
    url = f"{BFL_API_BASE}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Content-Type": "application/json",
            "accept": "application/json",
            "x-key": BFL_API_KEY,
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


# normalize BFL's status strings into our frontend vocabulary
STATUS_MAP = {
    "pending":            "processing",
    "request moderated":  "failed",
    "content moderated":  "failed",
    "ready":              "succeeded",
    "error":              "failed",
    "task not found":     "failed",
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

    def _key_missing(self) -> bool:
        if not BFL_API_KEY:
            self._send(503, {"error": "BFL_API_KEY not configured in vercel env"})
            return True
        return False

    # ---------- POST: kick off a generation ----------
    def do_POST(self) -> None:
        if self._key_missing():
            return
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            if length <= 0 or length > 6_000_000:
                self._send(400, {"error": "empty or oversized body"})
                return
            req = json.loads(self.rfile.read(length).decode("utf-8"))

            prompt = (req.get("prompt") or "").strip()
            if not prompt:
                self._send(400, {"error": "missing prompt"})
                return

            aspect = req.get("aspectRatio") or "1:1"
            if aspect not in ALLOWED_RATIOS:
                self._send(400, {"error": f"invalid aspectRatio (try one of {sorted(ALLOWED_RATIOS)})"})
                return

            payload = {
                "prompt":        prompt,
                "aspect_ratio":  aspect,
                "output_format": "png",
                "safety_tolerance": 2,
            }

            reference = req.get("reference")
            if reference:
                # Flux Ultra supports an image_prompt for img2img-style steering
                payload["image_prompt"] = _strip_data_url(reference)

            resp = _bfl_request("POST", f"/v1/{BFL_MODEL}", payload)

            task_id     = resp.get("id")
            polling_url = resp.get("polling_url")  # region-specific GET endpoint
            if not task_id:
                self._send(502, {"error": f"bfl response missing id: {resp}"})
                return

            # we hand pollingUrl back to the client so subsequent polls hit
            # the exact regional endpoint where the task was created — bfl
            # load-balances by region and a "wrong" region returns 404.
            self._send(200, {"taskId": task_id, "pollingUrl": polling_url})

        except urllib.error.HTTPError as e:
            try:
                detail = e.read().decode("utf-8")[:300]
            except Exception:
                detail = ""
            self._send(502, {"error": f"bfl http {e.code}: {detail}"})
        except json.JSONDecodeError:
            self._send(400, {"error": "invalid json body"})
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": str(e)})

    # ---------- GET: poll task status ----------
    def do_GET(self) -> None:
        if self._key_missing():
            return
        try:
            qs = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(qs)
            polling_url = (params.get("pollingUrl") or [""])[0]
            task_id     = (params.get("id") or [""])[0]

            if polling_url:
                # validate it's a real bfl url (SSRF guard)
                parsed = urllib.parse.urlparse(polling_url)
                host = (parsed.hostname or "").lower()
                if parsed.scheme != "https" or not host.endswith("bfl.ai"):
                    self._send(400, {"error": "invalid pollingUrl host"})
                    return
                req = urllib.request.Request(
                    polling_url,
                    headers={
                        "accept": "application/json",
                        "x-key": BFL_API_KEY,
                    },
                )
                with urllib.request.urlopen(req, timeout=15) as r:
                    resp = json.loads(r.read().decode("utf-8"))
            elif task_id:
                # fallback: best-effort against default region (may 404 if task is elsewhere)
                resp = _bfl_request("GET", f"/v1/get_result?id={urllib.parse.quote(task_id)}")
            else:
                self._send(400, {"error": "missing id or pollingUrl"})
                return

            raw_status = (resp.get("status") or "").lower()
            status = STATUS_MAP.get(raw_status, "processing")

            out = {"status": status, "message": resp.get("status") or "rendering"}

            if status == "succeeded":
                result = resp.get("result") or {}
                image_url = result.get("sample")
                if image_url:
                    out["imageUrl"] = image_url
                else:
                    out["status"]  = "failed"
                    out["message"] = "bfl reported ready but no image url"

            elif status == "failed":
                # surface moderation/error reasons
                out["message"] = resp.get("status") or "generation failed"

            self._send(200, out)

        except urllib.error.HTTPError as e:
            try:
                detail = e.read().decode("utf-8")[:300]
            except Exception:
                detail = ""
            self._send(502, {"error": f"bfl http {e.code}: {detail}"})
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": str(e)})
