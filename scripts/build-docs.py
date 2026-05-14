#!/usr/bin/env python3
"""
Build the static `docs/` site from the Razor source.

Run locally:
    python scripts/build-docs.py

Run automatically:
    .github/workflows/build-docs.yml runs this on every push that touches
    mw-agent/wwwroot/** or mw-agent/Pages/**, then commits the rebuilt
    docs/ back to main so GitHub Pages picks it up.

The transformation is intentionally simple — string substitution against
the known Razor patterns we use. No real Razor parser; if the templates
grow more dynamic, swap this for a proper static-site approach.
"""

import re
import shutil
from pathlib import Path

ROOT     = Path(__file__).resolve().parent.parent
SRC      = ROOT / "mw-agent"
WWWROOT  = SRC / "wwwroot"
PAGES    = SRC / "Pages"
DOCS     = ROOT / "docs"
LAYOUT   = PAGES / "Shared" / "_Layout.cshtml"

# slug → source .cshtml path
PAGE_FILES = {
    "index": PAGES / "Index.cshtml",
    "image": PAGES / "Image.cshtml",
    "video": PAGES / "Video.cshtml",
}

# inline script we substitute for the server-side cookie reader
# (no leading indent — the regex captures the surrounding whitespace itself)
PRE_PAINT_SCRIPT = """<script>
        // pre-paint theme sync from localStorage (avoids FOUC)
        (function(){
            try {
                var stored = localStorage.getItem('xa-theme');
                if (stored === 'bloom' || stored === 'chaos') {
                    document.documentElement.setAttribute('data-theme', stored);
                    var meta = document.querySelector('meta[name="theme-color"]');
                    if (meta) meta.setAttribute('content', stored === 'bloom' ? '#f1e9da' : '#050505');
                }
            } catch(e) {}
        })();
    </script>"""


def read_source(path: Path) -> str:
    """Read a Razor file, stripping any UTF-8 BOM that breaks anchored regex."""
    return path.read_text(encoding="utf-8-sig")

# script that populates the current year in any <span class="year">
YEAR_SCRIPT = (
    '<script>document.querySelectorAll(\'.year\').forEach('
    'function(el){ el.textContent = new Date().getUTCFullYear(); });</script>\n'
)


# ---------- step 1: copy static assets verbatim ----------

def sync_assets() -> None:
    DOCS.mkdir(exist_ok=True)
    (DOCS / "css").mkdir(exist_ok=True)
    (DOCS / "js").mkdir(exist_ok=True)
    shutil.copy(WWWROOT / "css" / "site.css", DOCS / "css" / "site.css")
    shutil.copy(WWWROOT / "js"  / "site.js",  DOCS / "js"  / "site.js")
    shutil.copy(WWWROOT / "favicon.svg",      DOCS / "favicon.svg")
    (DOCS / ".nojekyll").touch()
    print("synced css, js, favicon, .nojekyll")


# ---------- step 2: razor → html ----------

def strip_top_razor_block(text: str) -> str:
    """Remove leading @page / @model directives and the opening @{ ... } block."""
    text = re.sub(r"^@page\s*\n",          "", text, flags=re.MULTILINE)
    text = re.sub(r"^@model\s+\w+\s*\n",   "", text, flags=re.MULTILINE)
    text = re.sub(r"@\{.*?\}\s*\n?",       "", text, count=1, flags=re.DOTALL)
    return text.lstrip()


def extract_title(page_text: str) -> str:
    m = re.search(r'ViewData\["Title"\]\s*=\s*"([^"]+)"', page_text)
    return m.group(1) if m else "PAGE"


# all string substitutions that apply to both layout and page bodies
COMMON_REPLACEMENTS = [
    # asp-page → static href
    ('asp-page="/Index"', 'href="index.html"'),
    ('asp-page="/Image"', 'href="image.html"'),
    ('asp-page="/Video"', 'href="video.html"'),
    # razor path tilde → relative
    ('~/favicon.svg',  'favicon.svg'),
    ('~/css/site.css', 'css/site.css'),
    ('~/js/site.js',   'js/site.js'),
]


def apply_common(text: str) -> str:
    for old, new in COMMON_REPLACEMENTS:
        text = text.replace(old, new)
    # strip asp-append-version="true" attributes (and the preceding whitespace)
    text = re.sub(r'\s*asp-append-version="true"', "", text)
    return text


def transform_layout(layout: str, slug: str, title: str, body_html: str) -> str:
    out = layout

    # drop the leading @{ ... } directive block
    out = re.sub(r"@\{.*?\}\s*\n", "", out, count=1, flags=re.DOTALL)

    # razor interpolations in the layout → static values
    out = out.replace('data-theme="@theme"',     'data-theme="chaos"')
    out = out.replace('content="@themeColor"',   'content="#050505"')
    out = out.replace('@ViewData["Title"]',      title)
    out = out.replace('class="page-@bodyClass"', f'class="page-{slug}"')
    out = out.replace('@DateTime.UtcNow.Year',   '<span class="year">2026</span>')

    out = apply_common(out)

    # replace the cookie-syncing pre-paint script with the localStorage-only version
    out = re.sub(
        r'<script>\s*//\s*belt-and-suspenders.*?</script>',
        PRE_PAINT_SCRIPT,
        out,
        flags=re.DOTALL,
    )

    # no razor sections in a static build
    out = re.sub(r"@await RenderSectionAsync\([^)]*\)\s*", "", out)

    # inject the page body
    out = out.replace("@RenderBody()", body_html)

    # populate year placeholders client-side
    out = out.replace("</body>", YEAR_SCRIPT + "</body>")

    return out


def build_html() -> None:
    layout = read_source(LAYOUT)
    for slug, src in PAGE_FILES.items():
        raw   = read_source(src)
        title = extract_title(raw)
        body  = apply_common(strip_top_razor_block(raw))
        html  = transform_layout(layout, slug, title, body)
        out   = DOCS / f"{slug}.html"
        out.write_text(html, encoding="utf-8")
        print(f"built {out.relative_to(ROOT).as_posix()}")


def main() -> None:
    sync_assets()
    build_html()
    print("\ndocs/ rebuilt successfully")


if __name__ == "__main__":
    main()
