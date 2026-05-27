"""
GET /api/info — dev-facing diagnostic info.

Returns provider configuration (which keys are set, which models are active)
without ever exposing the secret values themselves. Used by the Lab page.
"""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import check_request


VERSION = "0.1.0"


def _has(*names: str) -> bool:
    return any(os.environ.get(n) for n in names)


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
        payload = check_request(self)
        if not payload:
            return
        try:
            info = {
                "version": VERSION,
                "user":    payload.get("user"),
                "providers": {
                    "kling": {
                        "configured": _has("KLING_ACCESS_KEY") and _has("KLING_SECRET_KEY"),
                        "model":      os.environ.get("KLING_MODEL", "kling-v1-6"),
                        "api_base":   os.environ.get("KLING_API_BASE", "https://api.klingai.com"),
                    },
                    "bfl": {
                        "configured": _has("BFL_API_KEY"),
                        "model":      os.environ.get("BFL_MODEL", "flux-pro-1.1-ultra"),
                        "api_base":   os.environ.get("BFL_API_BASE", "https://api.bfl.ai"),
                    },
                    "claude": {
                        "configured": _has("ANTHROPIC_API_KEY"),
                        "model":      os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-5"),
                    },
                    "kv": {
                        "configured": _has("KV_REST_API_URL", "UPSTASH_REDIS_REST_URL")
                                      and _has("KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN"),
                        "naming":     "vercel-kv" if _has("KV_REST_API_URL")
                                      else "upstash" if _has("UPSTASH_REDIS_REST_URL")
                                      else "none",
                    },
                    "auth": {
                        "configured":   _has("AUTH_SECRET"),
                        "user_pw_set":  _has("AUTH_USER_PASSWORD"),
                        "dev_pw_set":   _has("AUTH_DEV_PASSWORD"),
                    },
                },
                "runtime": {
                    "python":        sys.version.split()[0],
                    "vercel_region": os.environ.get("VERCEL_REGION") or "local",
                    "vercel_env":    os.environ.get("VERCEL_ENV") or "local",
                    "deployment":    os.environ.get("VERCEL_URL") or "local",
                },
            }
            self._send(200, info)
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": str(e)})
