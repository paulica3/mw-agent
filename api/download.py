"""
GET /api/download?url=<encoded video url>&name=<filename>

Proxies a Kling-hosted video file through our origin so the browser respects
the `download` attribute and saves it locally instead of opening it in a tab.

Streams the response in chunks — no full-file buffer — so we stay within
Vercel hobby memory limits for larger renders.

SECURITY: we only proxy URLs from a hardcoded list of Kling/Aliyun CDN hosts
to prevent SSRF. Anything else gets a 403.
"""

import json
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler


# kling videos come from a few Aliyun-backed CDNs depending on region / model
ALLOWED_HOST_SUBSTRINGS = (
    "klingai.com",
    "kling-ai.com",
    "kling-cdn.com",
    "alicdn.com",
    "aliyuncs.com",
)

CHUNK_SIZE = 64 * 1024


def _host_allowed(url: str) -> bool:
    try:
        parts = urllib.parse.urlparse(url)
    except ValueError:
        return False
    if parts.scheme != "https":
        return False
    host = (parts.hostname or "").lower()
    return any(s in host for s in ALLOWED_HOST_SUBSTRINGS)


def _safe_filename(raw: str) -> str:
    # strip anything that could become a directory traversal or weird header
    cleaned = "".join(c for c in raw if c.isalnum() or c in "._- ")
    cleaned = cleaned.strip() or "xperiment.mp4"
    if not cleaned.lower().endswith((".mp4", ".webm", ".mov")):
        cleaned += ".mp4"
    return cleaned[:120]


class handler(BaseHTTPRequestHandler):
    def _send_err(self, status: int, msg: str) -> None:
        payload = json.dumps({"error": msg}).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        try:
            qs = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(qs)
            url      = (params.get("url")  or [""])[0]
            name_raw = (params.get("name") or ["xperiment.mp4"])[0]

            if not url:
                self._send_err(400, "missing url")
                return
            if not _host_allowed(url):
                self._send_err(403, "url host not allowed")
                return

            filename = _safe_filename(name_raw)

            req = urllib.request.Request(url, headers={"User-Agent": "xperiment-ai/1.0"})
            with urllib.request.urlopen(req, timeout=20) as upstream:
                ctype = upstream.headers.get("Content-Type", "video/mp4")
                clen  = upstream.headers.get("Content-Length")

                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header(
                    "Content-Disposition",
                    f'attachment; filename="{filename}"',
                )
                if clen:
                    self.send_header("Content-Length", clen)
                # let browser cache for 5 min (same file is unlikely to change)
                self.send_header("Cache-Control", "private, max-age=300")
                self.end_headers()

                # stream straight from upstream to client — no full buffer
                while True:
                    chunk = upstream.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    self.wfile.write(chunk)

        except urllib.error.HTTPError as e:
            self._send_err(502, f"upstream http {e.code}")
        except urllib.error.URLError as e:
            self._send_err(502, f"upstream unreachable: {e.reason}")
        except Exception as e:  # noqa: BLE001
            self._send_err(500, str(e))
