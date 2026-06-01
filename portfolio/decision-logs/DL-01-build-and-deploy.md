# Decision Log Entry #1 — Build & deploy architecture

## 0. Context: Why does this question exist?

**Project / sprint:** XPERIMENT_AI · Sprint 0 (bootstrap) and the first deploy migration in early Sprint 1.

**Why this matters right now.** I had a Razor Pages project on my machine but no public URL. Without a deploy target I could not invite anyone to look at the work, could not call any third-party API that requires a server-side secret (Kling, Anthropic), and could not start any of the downstream work (auth, video gen, history). Every subsequent feature depends on the answer to "where does this run, and how does code get from my laptop to a URL the user can hit?"

**🔗 Where this fits**
- Project brief: [`proposal.md`](../proposal.md) §3 ("deployed, password-gated web app")
- Sprint 0 goal: stand up the skeleton.
- The migration itself: commit `c855bf9` "switch deploy from github pages to vercel build-on-push"; static-build script: [`scripts/build-docs.py`](../../scripts/build-docs.py); deploy config: [`vercel.json`](../../vercel.json).

## 1. My research question

> *What is the lowest-overhead way to host a small, mostly-static web app that needs ~6 lightweight backend endpoints, one of which proxies a video CDN, while keeping API keys server-side?*

## 2. Current LO stage

[x] Analyzing    [x] Advising    [ ] Designing    [ ] Realizing    [ ] Managing

This is principally an analyse-and-advise decision — by the time the build landed I had also realised it, but the *decision* itself sat in LO1/LO2.

## 3. What makes a good decision here?

**My criteria for success**

- **C1 — Zero-config push-to-deploy.** A `git push` to `main` triggers a build and updates the live URL. No manual deploy step. *Why this number/threshold:* if I have to remember to deploy I will, on a tight day, forget and demo stale code.
- **C2 — Time-to-first-byte ≤ 200 ms for a returning visitor.** The app is image- and animation-heavy; if the HTML itself is slow, the perceived chaos aesthetic looks broken. *Why:* the noise canvas + sparkle cursor only start once the document is parsed; if the document takes >500 ms the page looks frozen at first.
- **C3 — A backend secret stays out of the static bundle.** Kling/BFL/Anthropic keys must never end up in a JS bundle a logged-in operator could read in DevTools.
- **C4 — Free tier covers expected traffic (< 100 invocations/day in current usage).** I'm a student; an always-on VM is overkill.
- **C5 — I can keep the Razor templating I already wrote in S0.** Sunk cost is real; rewriting the seven pages into a different templating language inside S1 would push the first end-to-end into S2.

These thresholds are deliberately modest because the system is small. If I targeted "99.9% uptime" or ">5k req/sec" I would over-design for a one-person tool.

## 4. What I decided

I host on **Vercel**. The Razor templates stay as the source of truth; a Python script flattens them into static `.html` at build time (`vercel.json: buildCommand`). The dynamic surface is a folder of Python serverless functions (`api/*.py`) using only the standard library so there are no Python dependencies to declare. Persistence is **Vercel KV** (Upstash Redis under the hood).

I considered and rejected:

1. **GitHub Pages** (S0's initial choice).
2. **Netlify + Netlify Functions.**
3. **Self-hosted on Fly.io with a FastAPI app.**
4. **A pure SPA on Cloudflare Pages + Workers.**

## 5. Why this decision

### Method

I prototyped two stacks during S0:

- The first day I deployed to GitHub Pages from `docs/` and used [`build-docs.py`](../../scripts/build-docs.py) to flatten Razor. Worked great for the static side. Pages cannot run a backend.
- The next day I rebuilt the same `docs/` output on Vercel via `buildCommand` and added a one-line `api/hello.py`. Confirmed cold-start under 600 ms and the static cache TTFB under 80 ms from EU.

I compared options on a small table I keep in my notes (reproduced here):

| Option | Push-to-deploy | Backend support | Secret-safe | TTFB (static) | Free tier covers me | Keeps Razor templates |
|---|---|---|---|---|---|---|
| GitHub Pages | ✅ | ❌ none | n/a | ~50 ms | ✅ | ✅ |
| Vercel (static + functions) | ✅ | ✅ Python runtime | ✅ env vars | ~80 ms | ✅ (100k invocations/mo) | ✅ via `buildCommand` |
| Netlify + Functions | ✅ | ✅ but Node-first | ✅ | ~100 ms | ✅ | ✅ |
| Fly.io + FastAPI | △ via CI | ✅ | ✅ | ~200 ms (cold) / ~30 ms (warm) | △ (1 small VM free) | ⚠️ would need a runtime |
| Cloudflare Pages + Workers | ✅ | ✅ but TS-first | ✅ | ~30 ms | ✅ | ⚠️ would need a runtime |

### What I found / observed

- **GitHub Pages eliminated immediately** as soon as the second sprint goal ("call Kling from the server") was added — there is no place to put the Kling secret.
- **Netlify** is technically equivalent to Vercel for this shape, but its Python runtime is slower to cold-start (≈1.2 s vs ≈0.6 s for Vercel at the time of testing) and its first-class language is Node. I preferred staying inside one provider's well-trodden path.
- **Fly.io** would force me to write a Dockerfile, manage a long-running process, learn `fly.toml`, and pay (in attention) for an always-on VM. The traffic does not justify it. Cold-start fear is overblown for my access pattern: I hit the API a handful of times per session.
- **Cloudflare Workers** is the best long-term answer for a real audience (the TTFB is genuinely lower) but Python on Workers is still a beta and the Kling SDK is not available there. The migration cost was too high for an MVP.

### 🔗 Evidence & artifacts

- The actual config that resulted: [`vercel.json`](../../vercel.json) (only ~12 lines — that's part of the win).
- The static-build script that lets me keep Razor templates: [`scripts/build-docs.py`](../../scripts/build-docs.py).
- Commit `c855bf9` ("switch deploy from github pages to vercel build-on-push") — the move itself.
- Commit `e767067` ("clean up build script after vercel migration") — the cleanup once Pages was no longer a target.
- The Lab page's `/api/info` endpoint ([`api/info.py`](../../api/info.py)) reports `vercel_env` and `vercel_region` at runtime, which I use to confirm a given user is hitting the deploy I expect.

### What this means

Vercel hits every criterion at the lowest learning-cost. The Razor-as-source pattern is not standard but it's a 200-line script I wrote myself; I can fix or replace it whenever I want. I am paying a small ergonomic tax (the script is not a real Razor parser; if I ever add `@if` blocks it breaks) in exchange for never having to introduce a JS framework to a project that doesn't need one.

### So I decided

Vercel, static-build-at-deploy, Python serverless functions, KV for state. The advice would be the same for anyone in a similar position: a small templated site with a few thin endpoints does not need Next.js, does not need a relational DB, and especially does not need an always-on container.

## 6. Does this hold up?

### How well this meets my criteria

- **C1 — push-to-deploy:** ✅ `git push origin main` → live within ~40 s.
- **C2 — TTFB ≤ 200 ms:** ✅ measured 60–110 ms from EU on returning visits (Vercel edge cache).
- **C3 — secrets stay server-side:** ✅ Kling, BFL, Anthropic, Auth, KV env vars are configured in the Vercel dashboard. The static bundle is grepable from the browser — no secrets in it.
- **C4 — free tier:** ✅ current usage is far below the 100k monthly function invocations limit.
- **C5 — keep Razor:** ✅ `build-docs.py` flattens the templates; the `.cshtml` files remained the source of truth across all four realised sprints.

### Assumptions I'm making

- That Vercel will not change its Python runtime in a way that breaks stdlib-only functions (currently pinned to `@vercel/python@4.3.1` in `vercel.json`).
- That `data/defaults.json` being read from disk inside a serverless function is fast enough (it is — the file is included in the deployment package and lives in the function's local filesystem).
- That Razor's syntax will not grow features I rely on (`@if`, `@foreach`). I have deliberately avoided using them so my hand-rolled flattener stays simple.

### What surprised me

- **`build-docs.py` turned out to be a stability win, not a cost.** I expected it to be a maintenance burden but in 4 sprints I had to touch it exactly once, for the auth-gate pre-paint script (commit `d471591` "build script was stripping the auth gate from static pages"). That was a real bug but the fix was a 10-line regex change.
- **Cold-start on stdlib-only Python functions is much lower than I expected** — sub-400 ms even after a long idle period. If I had brought `requests` along the cold-start would jump.
- **Vercel KV's REST API is enough.** I never needed the official SDK. `urllib.request` against the REST endpoint is two screens of code in each function and zero dependency to manage.

## 7. What this unlocks

### 🔗 Implementation evidence

- Live deploy: behind the `xa-token` password gate; visible in the Vercel dashboard.
- Build script: [`scripts/build-docs.py`](../../scripts/build-docs.py).
- Function manifest: [`vercel.json`](../../vercel.json).
- All API endpoints under [`api/`](../../api/).

### Next LO stage

**Designing** — with the platform decided, I can now design the auth model, the chip data shape, and the generation flow on top of it. This decision constrains those: e.g., no long-running server-side processes (functions only run while a request is open), which is why poll-from-the-browser became the chosen pattern in [DL-02](DL-02-video-provider-and-quality-mapping.md).

### What I can now do (that I couldn't before)

- I can call the Kling and BFL APIs from a place that holds their secret, with a URL I can hand to anyone.
- I can iterate on the front-end (chip UI, theme, prompt readout) without touching the deploy.
- I can give a non-technical operator the URL + a password and expect them to use it without my help.
- I can roll back a bad deploy by reverting one commit.

### How I'll know this worked

- A successful end-to-end render from a stranger's browser in ≤ 3 minutes for a `standard`-quality 5 s clip (Sprint 1 acceptance criterion — met).
- TTFB measured from a non-EU region stays < 300 ms (Vercel global CDN; checked once with `curl -w` from a US proxy).
- The `/api/info` health check on the Lab page shows all five providers (`kling`, `bfl`, `claude`, `kv`, `auth`) configured.

This decision is the foundation under every later one. If I undo it, every other decision log on this project changes shape.
