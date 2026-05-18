"""
POST /api/enhance — rewrite the user's assembled prompt into a pro-grade
cinematography prompt via Claude.

Body:
    { "prompt": "...", "page": "image" | "video" }

Returns:
    200 { "enhanced": "..." }
    4xx { "error": "..." }
    503 { "error": "..." } if ANTHROPIC_API_KEY env var missing

Uses Claude Sonnet 4.5 (cheap, fast, and the rewrite is short).
"""

import json
import os
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _auth import check_request


ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL   = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-5")
ANTHROPIC_URL     = "https://api.anthropic.com/v1/messages"


SYSTEM_PROMPT = """You are a cinematographer and music video director specializing in contemporary new wave / underground rap (rage scene, opium aesthetic, hyperpop-adjacent — Carti, Yeat, Destroy Lonely, Ken Carson, Lucki territory).

You rewrite raw chip-assembled prompts into dense, pro-grade prompts optimized for AI video/image models like Kling and Flux Pro Ultra. Your rewrites:

- preserve every concrete element the user already specified (subject, mood, references, director's notes)
- add specific cinematic vocabulary: lens (24mm, 35mm anamorphic, 85mm prime, f-stop), film stock or sensor look, lighting (key/fill ratios, practical sources, color temperature in Kelvin), framing (rule of thirds, leading lines, headroom)
- inject genre-aware texture: location specifics (project rooftops, late-night corner stores, abandoned mansions, neon-lit interiors), wardrobe details, ambient elements (rain, fog, smoke, sparks)
- reference real cinematographers / directors when relevant (Hype Williams, Director X, Roger Deakins, Greig Fraser, Cole Bennett, Nick Walker, Lonewolf)
- output a SINGLE DENSE PARAGRAPH (no line breaks, no bullets, no labels like "Subject:" or "Style:")
- no preamble, no commentary, no "Here's the enhanced prompt:" — just the prompt itself
- length: roughly 400–600 characters. denser than a tweet, shorter than a paragraph essay.

If the input is empty or nonsense, return the input unchanged."""


def _call_claude(user_prompt: str, page: str) -> str:
    context = f"Target: {'static image / album cover' if page == 'image' else 'video clip'}.\n\nUser's assembled prompt:\n{user_prompt}"
    body = {
        "model":      ANTHROPIC_MODEL,
        "max_tokens": 800,
        "system":     SYSTEM_PROMPT,
        "messages":   [{"role": "user", "content": context}],
    }
    req = urllib.request.Request(
        ANTHROPIC_URL,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type":      "application/json",
            "x-api-key":         ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    # Claude returns content as a list of blocks; we want the first text block
    blocks = data.get("content") or []
    for b in blocks:
        if b.get("type") == "text":
            return (b.get("text") or "").strip()
    return ""


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
        if not ANTHROPIC_API_KEY:
            self._send(503, {"error": "ANTHROPIC_API_KEY not configured in vercel env"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            if length <= 0 or length > 20_000:
                self._send(400, {"error": "empty or oversized body"})
                return
            req = json.loads(self.rfile.read(length).decode("utf-8"))

            prompt = (req.get("prompt") or "").strip()
            page   = req.get("page") or "video"
            if not prompt:
                self._send(400, {"error": "missing prompt"})
                return

            enhanced = _call_claude(prompt, page)
            if not enhanced:
                self._send(502, {"error": "claude returned empty response"})
                return
            self._send(200, {"enhanced": enhanced})

        except urllib.error.HTTPError as e:
            try:
                detail = e.read().decode("utf-8")[:300]
            except Exception:
                detail = ""
            self._send(502, {"error": f"claude http {e.code}: {detail}"})
        except json.JSONDecodeError:
            self._send(400, {"error": "invalid json"})
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": str(e)})
