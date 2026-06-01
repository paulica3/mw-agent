# Decision Log Entry #2 — Video provider choice and the QUALITY chip → model mapping

## 0. Context: Why does this question exist?

**Project / sprint:** XPERIMENT_AI · Sprint 1 (first end-to-end video render) and Sprint 2 (quality chip + model mapping).

**Why this matters right now.** The whole project sits on top of a third-party video generator. The choice of provider determines the visual ceiling, the latency, the cost per render, and the failure modes I have to handle in the UI. Worse: every provider has at least three model variants with different price/quality trade-offs, and exposing those as raw model names ("kling-v2-master") to a non-technical artist would be hostile. I needed to decide both *which provider* and *how to expose its tiers* before I could ship the Video page.

**🔗 Where this fits**
- Sprint 1 goal in [`development-plan.md`](../development-plan.md): "a logged-in user can pick chips, press GENERATE, and get a Kling-rendered video downloaded to disk."
- Sprint 2 task: "Add a QUALITY chip mapping to four Kling model presets." Commit `aff6beb`.
- Provider call site: [`api/generate.py`](../../api/generate.py) (`QUALITY_PRESETS` dict, lines 49–54).
- Front-end chip definition: [`mw-agent/Pages/Video.cshtml`](../../mw-agent/Pages/Video.cshtml) lines 37–43.

## 1. My research question

> *Which video-generation provider best fits the new-wave / underground rap aesthetic at acceptable latency and cost, and how do I expose its quality/cost tiers in a way an artist (not an engineer) can choose between in one click?*

## 2. Current LO stage

[x] Analyzing    [x] Advising    [x] Designing    [ ] Realizing    [ ] Managing

This decision touches three LOs: I analysed the provider landscape (LO1), advised on one choice (LO2), and designed the user-facing mapping (LO3).

## 3. What makes a good decision here?

**My criteria for success**

- **C1 — A 5-second `standard` render finishes in ≤ 120 s wall-clock for the user.** *Why:* I want a demo to never feel "broken". 120 s is the patience window I observed in two early user tests before someone alt-tabs.
- **C2 — At least four meaningfully different quality tiers** that map to actual provider model variants, so the artist can pick a "draft me a take" vs "final cut" without thinking in model names.
- **C3 — Cost per 5-second `standard` clip ≤ ~$0.30** so I can give my friend the password without a billing scare.
- **C4 — Image-to-video supported**, so the prompt is not the only handle the user has on continuity — they can upload a frame as a seed.
- **C5 — JWT / HMAC server-side auth, not "set this in the URL".** Anything with a long-lived bearer in the request body is a non-starter.
- **C6 — The provider's output style fits the scene.** Each AI video model has a distinctive look baked in by its training data. Kling's renders trend toward stylised, kinetic, slightly anime-leaning motion, which is on-brief for rage / opium-core. Runway Gen-3's renders trend toward clean cinematic-realist footage — closer to a Netflix trailer than a Yeat music video. Same prompt, different aesthetic. The fit of the *output* matters; this is the qualitative criterion in the list and the one that knocked Runway out despite it being technically competitive on every other axis.

## 4. What I decided

**Provider:** Kling AI (`api.klingai.com`).

**Auth:** stdlib-only HS256 JWT signed from `KLING_ACCESS_KEY` + `KLING_SECRET_KEY`, 30-min TTL, built per request in [`api/generate.py` `make_jwt()`](../../api/generate.py).

**Quality chip → model mapping** (in [`api/generate.py`](../../api/generate.py)):

```python
QUALITY_PRESETS = {
    "draft":    {"model": "kling-v1-5",      "mode": "std"},
    "standard": {"model": "kling-v1-6",      "mode": "std"},
    "pro":      {"model": "kling-v1-6",      "mode": "pro"},
    "master":   {"model": "kling-v2-master", "mode": "std"},
}
```

The frontend exposes these as chip buttons labelled DRAFT / STANDARD / PRO / MASTER with sub-labels (`fast`, `balanced`, `sharp`, `premium`).

**Polling, not webhooks.** The browser polls `/api/status` every 5 s up to 5 minutes. No inbound webhook handler.

## 5. Why this decision

### Method

1. **Comparison spike.** I generated the same 5 s clip (a single text prompt: *"a hooded figure walks toward camera through a flooded city, sodium-orange streetlights, anamorphic lens, slow motion"*) on three providers via their public APIs to compare cost, latency, and visual fit:
   - Runway Gen-3 Alpha
   - Pika 1.5
   - Kling v1-5 and v1-6
2. **Audited the docs** for: image-to-video support, auth model, durations accepted, aspect ratios, and webhooks.
3. **Read two of the better-known commercial demos** ("Yeat-style cold open", "Carti-style derelict luxury") on social to verify which provider was being used by people whose aesthetic I want to emulate. Most cited Kling and Luma; very few cited Runway.

### What I found / observed

| Provider | Wall-clock for 5 s std | Image-to-video | Auth | Duration values | Cost/clip (5 s std) | Aesthetic fit |
|---|---|---|---|---|---|---|
| Runway Gen-3 | ~80 s | ✅ | API key bearer | open 1–10 s | $0.50 | cinematic-realist; off-brief for rage |
| Pika 1.5 | ~60 s | ✅ | API key bearer | 3 s only | $0.08 | low-resolution feel; off-brief |
| **Kling v1-5** | ~90 s | ✅ | HS256 JWT | **5 or 10 only** | $0.20 | stylised, kinetic — on-brief |
| **Kling v1-6** | ~110 s | ✅ | HS256 JWT | **5 or 10 only** | $0.30 | best aesthetic match in tests |
| Kling v1-6 Pro | ~180 s | ✅ | same | **5 or 10 only** | $0.50 | crisp; for final cuts |
| Kling v2-master | ~240 s | ✅ | same | **5 or 10 only** | $0.80 | top quality, slow |

The duration constraint (5 s or 10 s only) is a footgun: I lost half a day in Sprint 1 because my first version sent `duration=6` and Kling's response was a generic "invalid parameter" with no clarification. Fixed in commit `ded23d0`. This is recorded honestly so I remember to defend the design choice next time it bites.

### 🔗 Evidence & artifacts

- The comparison test prompts and outputs lived in a private folder; I no longer keep the videos but the choice and the latency numbers are reproducible if I re-run the spike. The fact that they aren't checked in is a portfolio gap I'd close on a re-do.
- The `QUALITY_PRESETS` dictionary itself: [`api/generate.py`](../../api/generate.py) lines 49–54.
- The duration-bug commit: `ded23d0` "FIX: kling only accepts 5s or 10s video durations".
- The quality-chip introduction: commit `aff6beb` "ADD VIDEO: add QUALITY chip (draft/standard/pro/master)".
- The chip UI: [`mw-agent/Pages/Video.cshtml`](../../mw-agent/Pages/Video.cshtml) lines 37–43.
- The polling lifecycle (no webhooks): [`mw-agent/wwwroot/js/site.js`](../../mw-agent/wwwroot/js/site.js) `pollStatus()`.

### What this means

Kling is the right artistic and economic fit. The duration constraint and the proprietary JWT shape are annoying but contained — both live in two files (`generate.py` and `status.py`) and the rest of the system is provider-agnostic.

The "QUALITY chip" abstraction is the right user-facing layer because:
- *Draft* sets the expectation that this is a take, not a final, so the user doesn't grade it harshly.
- *Standard* is the default, so an indecisive user gets the most-defensible quality without choosing.
- *Pro* enables Kling's "pro" mode on the same v1-6 base — same model, sharper post-processing.
- *Master* unlocks v2 for the artist's hero shot, with explicit "premium" framing.

### So I decided

Kling, four tiers, JWT signed per-request, polling not webhooks. The provider is hidden behind a tiny `QUALITY_PRESETS` map so if v3 lands tomorrow I edit one dict.

## 6. Does this hold up?

### How well this meets my criteria

- **C1 — ≤ 120 s for 5 s `standard`:** 🟡 — typical 90–110 s, but pro and master regularly exceed 120 s. Accepted because the UI labels them as `sharp` / `premium`. For the headline standard tier the criterion holds.
- **C2 — Four meaningful tiers:** ✅ — confirmed by both perceived sharpness and per-tier latency.
- **C3 — ≤ $0.30 per `standard` clip:** ✅ — exactly $0.30 by Kling's pricing; the `draft` tier is $0.20 if cost matters.
- **C4 — Image-to-video supported:** ✅ — handled in [`api/generate.py`](../../api/generate.py): the request body branches to `/v1/videos/image2video` when a base64 reference is supplied.
- **C5 — HMAC-signed auth, not bare URL secrets:** ✅ — HS256 JWT, signed per call, 30 min TTL.
- **C6 — Aesthetic fit:** ✅ — both my own tests and prior-art surveys converged on Kling for this scene.

### Assumptions I'm making

- That Kling won't change its accepted-duration set during the portfolio review. If it adds 3 s or 8 s I'd want to expose them.
- That my friend will not press MASTER on every render — if they do, monthly cost crosses my comfort threshold and I have to add per-user limits.
- That the polling interval (5 s) is gentle enough not to get me rate-limited. So far it has been; if rate-limit responses start appearing I'd back off exponentially.

### What surprised me

- **The duration constraint.** Kling's docs mention it but not at the field level; their error message is terse. Half a day of Sprint 1 lost.
- **Kling's response uses an envelope** (`{ code, message, data: { task_id } }`) rather than the raw object most APIs return. The code `0` means success — not `200`. Handled defensively in [`api/generate.py`](../../api/generate.py) by accepting `code in (0, 200, None)`.
- **Pro mode is `pro`, not `professional` or `premium` or `hi`** — the string is unobvious. Encoding the mapping in a dict in the function (not in the front-end) means the artist never sees the magic string.

## 7. What this unlocks

### 🔗 Implementation evidence

- [`api/generate.py`](../../api/generate.py) — POST route, JWT minting, model mapping.
- [`api/status.py`](../../api/status.py) — polling route, response normalisation.
- [`api/download.py`](../../api/download.py) — CDN proxy with SSRF guard for cross-origin saves.
- Front-end driver: [`site.js` `pollStatus`](../../mw-agent/wwwroot/js/site.js) lines ~1493–1584.

### Next LO stage

**Realizing**, and then **Managing** — once the provider was wired, I needed to monitor it (the Lab page's PROVIDER_STATUS row), record successful generations (the stats endpoint), and adapt when something failed (the modal's `error` pane). See [`lo/LO4-realizing/`](../lo/LO4-realizing/) and [`lo/LO5-managing/`](../lo/LO5-managing/).

### What I can now do (that I couldn't before)

- I can ship a single click that turns a chip-assembled prompt into a saved MP4.
- I can swap a model variant by editing one dictionary, with no front-end change.
- I can adopt a future provider by writing one new `api/<provider>.py` file and reusing the modal and the polling abstraction (`POLL_CONFIG`) which is already provider-keyed in the front-end.

### How I'll know this worked

- A new user, given only the password and the URL, completes a 5 s `standard` render end-to-end without me sitting next to them — **measured: yes, in two of two sessions.**
- The History page contains entries with both `kling-v1-6` and `kling-v2-master` `model` fields, demonstrating that more than one tier is being used in practice.
- The Lab page's PROVIDER_STATUS row for `kling` stays green (`configured: ✓`) across every deploy.
