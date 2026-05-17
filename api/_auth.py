"""
Shared auth helpers for the /api/* serverless functions.

Tokens are HMAC-SHA256 signed payloads (JWT-ish but simpler — no header,
since we only support one algorithm). Format: <base64url(payload)>.<base64url(sig)>

The leading underscore in the filename keeps this from being treated as a
public endpoint by anything routing on filename. Vercel still includes it
in the deployment so sibling files can import.
"""

import base64
import hashlib
import hmac
import json
import os
import time


AUTH_SECRET    = os.environ.get("AUTH_SECRET", "")
USER_PASSWORD  = os.environ.get("AUTH_USER_PASSWORD", "")
DEV_PASSWORD   = os.environ.get("AUTH_DEV_PASSWORD", "")
SESSION_DAYS   = 30


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode((s + pad).encode())


def make_token(user: str) -> str:
    """Sign and encode a session token for the given user identifier."""
    payload = {"user": user, "exp": int(time.time()) + SESSION_DAYS * 86400}
    payload_b = _b64url(json.dumps(payload, separators=(",", ":")).encode())
    sig = hmac.new(AUTH_SECRET.encode(), payload_b.encode(), hashlib.sha256).digest()
    return f"{payload_b}.{_b64url(sig)}"


def verify_token(token: str) -> dict | None:
    """Returns the payload if the token is valid and not expired, else None."""
    if not token or "." not in token or not AUTH_SECRET:
        return None
    try:
        payload_b, sig_b = token.rsplit(".", 1)
        expected_sig = _b64url(
            hmac.new(AUTH_SECRET.encode(), payload_b.encode(), hashlib.sha256).digest()
        )
        if not hmac.compare_digest(sig_b, expected_sig):
            return None
        payload = json.loads(_b64url_decode(payload_b))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload
    except (ValueError, json.JSONDecodeError):
        return None


def check_password(submitted: str) -> str | None:
    """Returns the user identifier if the password matches an env var, else None."""
    if not submitted:
        return None
    # constant-time comparison so we don't leak which password matched
    if USER_PASSWORD and hmac.compare_digest(submitted, USER_PASSWORD):
        return "operator"
    if DEV_PASSWORD and hmac.compare_digest(submitted, DEV_PASSWORD):
        return "dev"
    return None


def check_request(handler) -> dict | None:
    """
    Gates an endpoint. If the request has a valid token, returns the payload.
    Otherwise writes a 401 response on the handler and returns None.
    Caller should `return` immediately when None is returned.
    """
    auth = handler.headers.get("Authorization", "") or ""
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    payload = verify_token(token)
    if payload:
        return payload

    body = json.dumps({"error": "unauthorized"}).encode("utf-8")
    handler.send_response(401)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)
    return None
