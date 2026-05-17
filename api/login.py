"""
POST /api/login
Body: { "password": "..." }

Returns:
    200 { "token": "...", "user": "operator" | "dev" }   on success
    401 { "error": "invalid credentials" }                on bad password
    503 { "error": "auth not configured" }                if env vars missing
"""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler

# import the helper from this directory (vercel includes _-prefixed files)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import check_password, make_token, AUTH_SECRET


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
        if not AUTH_SECRET:
            self._send(503, {"error": "AUTH_SECRET / AUTH_USER_PASSWORD not configured in vercel env"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            if length <= 0 or length > 4096:
                self._send(400, {"error": "empty or oversized body"})
                return
            req = json.loads(self.rfile.read(length).decode("utf-8"))
            submitted = (req.get("password") or "").strip()

            user = check_password(submitted)
            if not user:
                # tiny artificial delay would help against brute force, but
                # vercel hobby plan cost-per-invocation makes it not worth it
                self._send(401, {"error": "invalid credentials"})
                return

            self._send(200, {"token": make_token(user), "user": user})

        except json.JSONDecodeError:
            self._send(400, {"error": "invalid json"})
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": str(e)})
