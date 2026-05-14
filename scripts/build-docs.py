#!/usr/bin/env python3
"""
Build the static site from the Razor source.

Vercel runs this on every push (see vercel.json: buildCommand). The output
goes to docs/, which Vercel serves as the deploy. The folder is gitignored
and never committed — it only ever exists on the build server (or on your
machine if you run the script locally to preview).

Run locally:
    python scripts/build-docs.py
    # then open docs/index.html in a browser

The transformation is intentionally simple string substitution against the
exact Razor patterns the templates use. There's no real Razor parser — if
the templates ever grow @if / @foreach logic, swap this script for a real
static-site generator (Astro / Eleventy / Hugo).
"""

import re
import shutil
from pathlib import Path

# ---------- paths ----------

ROOT    = Path(__file__).resolve().parent.parent
SRC     = ROOT / "mw-agent"
WWWROOT = SRC / "wwwroot"
PAGES   = SRC / "Pages"
LAYOUT  = PAGES / "Shared" / "_Layout.cshtml"
OUT     = ROOT / "docs"

PAGE_FILES = {
    "index": PAGES / "Index.cshtml",
    "image": PAGES / "Image.cshtml",
    "video": PAGES / "Video.cshtml",
}


# ---------- snippets injected into the output ----------

# replaces the layout's server-cookie pre-paint script with a localStorage-only
# version. no leading indent here — the regex captures the surrounding indent.
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

# populates the current year into every <span class="year"> placeholder
YEAR_SCRIPT = (
    '<script>document.querySelectorAll(\'.year\').forEach('
    'function(el){ el.textContent = new Date().getUTCFullYear(); });</script>\n'
)

# substitutions applied to both layout and page bodies
COMMON_REPLACEMENTS = [
    ('asp-page="/Index"', 'href="index.html"'),
    ('asp-page="/Image"', 'href="image.html"'),
    ('asp-page="/Video"', 'href="video.html"'),
    ('~/favicon.svg',     'favicon.svg'),
    ('~/css/site.css',    'css/site.css'),
    ('~/js/site.js',      'js/site.js'),
]


# ---------- helpers ----------

def read_source(path: Path) -> str:
    """Read a Razor file, stripping any UTF-8 BOM that would break ^ anchors."""
    return path.read_text(encoding="utf-8-sig")


def apply_common(text: str) -> str:
    for old, new in COMMON_REPLACEMENTS:
        text = text.replace(old, new)
    return re.sub(r'\s*asp-append-version="true"', "", text)


def strip_top_razor_block(text: str) -> str:
    """Remove leading @page / @model directives and the opening @{ ... } block."""
    text = re.sub(r"^@page\s*\n",        "", text, flags=re.MULTILINE)
    text = re.sub(r"^@model\s+\w+\s*\n", "", text, flags=re.MULTILINE)
    text = re.sub(r"@\{.*?\}\s*\n?",     "", text, count=1, flags=re.DOTALL)
    return text.lstrip()


def extract_title(page_text: str) -> str:
    m = re.search(r'ViewData\["Title"\]\s*=\s*"([^"]+)"', page_text)
    return m.group(1) if m else "PAGE"


# ---------- build steps ----------

def sync_assets() -> None:
    """Copy css, js, and favicon from wwwroot into the output directory."""
    OUT.mkdir(exist_ok=True)
    (OUT / "css").mkdir(exist_ok=True)
    (OUT / "js").mkdir(exist_ok=True)
    shutil.copy(WWWROOT / "css" / "site.css", OUT / "css" / "site.css")
    shutil.copy(WWWROOT / "js"  / "site.js",  OUT / "js"  / "site.js")
    shutil.copy(WWWROOT / "favicon.svg",      OUT / "favicon.svg")
    print("synced css, js, favicon")


def render_page(layout: str, slug: str, title: str, body_html: str) -> str:
    out = layout

    # drop the layout's leading @{ ... } directive block
    out = re.sub(r"@\{.*?\}\s*\n", "", out, count=1, flags=re.DOTALL)

    # replace razor interpolations with static values
    out = out.replace('data-theme="@theme"',     'data-theme="chaos"')
    out = out.replace('content="@themeColor"',   'content="#050505"')
    out = out.replace('@ViewData["Title"]',      title)
    out = out.replace('class="page-@bodyClass"', f'class="page-{slug}"')
    out = out.replace('@DateTime.UtcNow.Year',   '<span class="year">2026</span>')

    out = apply_common(out)

    # swap server cookie reader for localStorage-only pre-paint script
    out = re.sub(
        r'<script>\s*//\s*belt-and-suspenders.*?</script>',
        PRE_PAINT_SCRIPT,
        out,
        flags=re.DOTALL,
    )

    # razor sections don't exist in a static build
    out = re.sub(r"@await RenderSectionAsync\([^)]*\)\s*", "", out)

    # inject the page body and the year-population script
    out = out.replace("@RenderBody()", body_html)
    out = out.replace("</body>", YEAR_SCRIPT + "</body>")

    return out


def build_pages() -> None:
    layout = read_source(LAYOUT)
    for slug, src in PAGE_FILES.items():
        raw   = read_source(src)
        title = extract_title(raw)
        body  = apply_common(strip_top_razor_block(raw))
        html  = render_page(layout, slug, title, body)
        path  = OUT / f"{slug}.html"
        path.write_text(html, encoding="utf-8")
        print(f"built {path.relative_to(ROOT).as_posix()}")


def main() -> None:
    sync_assets()
    build_pages()
    print("\nbuild complete")


if __name__ == "__main__":
    main()
