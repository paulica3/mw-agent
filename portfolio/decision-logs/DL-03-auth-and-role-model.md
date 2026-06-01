# Decision Log Entry #3 — Auth model and role-aware UI

## 0. Context: Why does this question exist?

**Project / sprint:** XPERIMENT_AI · Sprint 1 (gating every API endpoint before the first user got a link) and Sprint 4 (tightening the session TTL).

**Why this matters right now.** The deploy is on the public internet. Every API call costs me real money (Kling, BFL, Anthropic — each render is between $0.05 and $0.80). If the URL is reachable by a crawler or a random visitor, my Kling balance evaporates. I needed an auth model that:

- gates **every** `/api/*` endpoint, not just the front-end pages,
- has **no signup flow** (this is not a SaaS),
- distinguishes me (the developer) from any other operator so I can expose dev tooling (the Lab page) only to myself,
- and is small enough that I can write it without dragging in `python-jose` or `pyjwt`.

**🔗 Where this fits**
- Sprint 1 task: "Hard-code an operator + dev password and gate every API endpoint." Commit `ed2b924` ("ADD auth: hardcoded operator + dev login, all api endpoints gated").
- Sprint 4 task: "Drop session TTL from 30 days to 7." Currently uncommitted, see `git diff api/_auth.py`.
- Implementation: [`api/_auth.py`](../../api/_auth.py), [`api/login.py`](../../api/login.py), and the `fetch` wrapper in [`site.js`](../../mw-agent/wwwroot/js/site.js) lines 53–81.
- The "pre-paint" auth gate that runs synchronously *before* the page renders, injected by the static-build script: [`scripts/build-docs.py`](../../scripts/build-docs.py) `PRE_PAINT_SCRIPT`.

## 1. My research question

> *What is the lightest-weight authentication model that (a) protects costly provider calls from unauthenticated visitors, (b) lets me distinguish a developer session from a regular operator session without a real user database, and (c) has zero third-party dependencies in the Python functions?*

## 2. Current LO stage

[x] Analyzing    [x] Advising    [x] Designing    [x] Realizing    [ ] Managing

I analysed the threat model, advised the team-of-one (me) on the trade-offs, designed the token, and realised it in code. The follow-up TTL tightening in Sprint 4 is a tiny Managing step on top.

## 3. What makes a good decision here?

**My criteria for success**

- **C1 — A request without a valid bearer token returns 401 from *every* `/api/*` endpoint** (except `/api/login`). Cannot be circumvented by forgetting to add `check_request` to one new file. *Why this number:* one missed gate = a free renderer for the internet.
- **C2 — Signing/verification adds ≤ 5 ms per request on average.** *Why:* serverless cold-start budget is already tight (~400 ms). I do not want a slow auth helper on top.
- **C3 — Zero new pip dependencies.** *Why:* Vercel's stdlib-only Python path is faster cold and has no supply-chain surface to audit.
- **C4 — Two distinguishable roles** (`operator`, `dev`) carried in the token, **client cannot self-elevate.**
- **C5 — Session expiry ≤ 30 days, ideally shorter.** Sprint 4 update: ≤ 7 days. *Why:* the password is shared. Long-lived tokens are easy to forget about and impossible to revoke without rotating the secret.
- **C6 — Login UX is one field, one button, one redirect.** Anything more is too much for a non-technical operator.

## 4. What I decided

A self-contained HMAC token scheme:

```
<base64url(payload)>.<base64url(HMAC-SHA256(payload, AUTH_SECRET))>
```

- The payload is JSON: `{ "user": "operator"|"dev", "exp": <unix-seconds> }`.
- No JWT header section: we only ever sign with HS256, so encoding the algorithm in every token would be wasted bytes.
- Two env-var passwords: `AUTH_USER_PASSWORD` (issues `user: "operator"`) and `AUTH_DEV_PASSWORD` (issues `user: "dev"`).
- Constant-time comparison (`hmac.compare_digest`) on both password check and signature verification.
- `SESSION_DAYS = 7` (S4 update from 30).
- A shared helper file [`api/_auth.py`](../../api/_auth.py) is imported by every gated endpoint; the leading underscore stops Vercel from routing it as `/api/_auth`.

Two layers protect protected pages:

1. **Pre-paint script** (built into every static page by [`scripts/build-docs.py`](../../scripts/build-docs.py)): synchronous redirect to `/login` if `localStorage["xa-token"]` is missing, *before* any HTML renders.
2. **Server-side `check_request()`**: returns 401 if the token is missing, malformed, has a bad signature, or has expired.

Both layers exist because **the pre-paint layer is a UX optimisation** (no flash of protected content), not a security boundary. The security boundary is the server check.

## 5. Why this decision

### Method

I sketched four candidate schemes on paper, then prototyped the chosen one in two short coding sessions:

1. **Real JWT via `python-jose`.** Industry standard, three-segment, supports many algorithms.
2. **Auth0 / Clerk / a managed identity provider.** Industry standard, no code to maintain.
3. **Sliding signed cookie (no client-side storage).** Server sets a `Set-Cookie: __Host-xa=...; Secure; HttpOnly; SameSite=Lax`. Browser sends it automatically.
4. **My chosen "JWT-lite":** payload + HMAC, two-segment, stdlib only, stored in `localStorage`.

### What I found / observed

| Scheme | New deps | Cold-start cost | Revocable | Signup needed | Distinguishes roles | Single-page friction |
|---|---|---|---|---|---|---|
| Real JWT (`python-jose`) | +5–7 packages | +120 ms (lib import) | only via key rotation | no | yes | low |
| Managed IdP | SDK + provider | n/a (network hop) | yes (panel) | yes | yes | high (sign-up flow) |
| Signed cookie | none | minimal | only via key rotation | no | yes | low |
| **HMAC token in localStorage** | **none** | **+~1 ms** | **only via key rotation** | **no** | **yes** | **lowest** |

- The real JWT lib's import cost was the killer at this scale. A 120 ms cold-start tax on every gated endpoint, multiplied across 9 gated endpoints, made the whole system feel sluggish in cold-start.
- The managed IdP was the most "professional" answer but required signup, which I do not want — the user model is "I gave you the URL and the password, go".
- A signed cookie is *technically* a better answer than `localStorage` for XSS resistance (HttpOnly). I rejected it for one practical reason: I want the *client* to be able to read the role from the token to flip dev-only UI without a round-trip. `localStorage` lets `decodeTokenPayload(getToken())?.user` work in the browser. A pure HttpOnly cookie wouldn't. I'm taking on a small XSS-amplification risk in exchange for a cleaner UI gate. Mitigation: I'm strict about `escapeHTML()` on every user-supplied string that touches `innerHTML`.

### 🔗 Evidence & artifacts

- **Token helper:** [`api/_auth.py`](../../api/_auth.py) — `_b64url`, `make_token`, `verify_token`, `check_password`, `check_request`.
- **Login endpoint:** [`api/login.py`](../../api/login.py).
- **Every gated endpoint** imports the helper. Grep `from _auth import check_request` shows it across all of `chips.py`, `history.py`, `presets.py`, `stats.py`, `generate.py`, `status.py`, `image.py`, `download.py`, `enhance.py`, `info.py`.
- **Front-end wrapper:** [`site.js`](../../mw-agent/wwwroot/js/site.js) global `fetch` patch (lines 53–81). Adds `Authorization: Bearer <token>` to every `/api/*` request; on 401 (except `/api/login`) it clears the token and redirects to `/login?from=<current>`.
- **Pre-paint gate (UX layer):** [`scripts/build-docs.py`](../../scripts/build-docs.py) `PRE_PAINT_SCRIPT`. Runs before render.
- **Role-aware UI:** `isDev()` check in `site.js` controls: `[DEV]` nav badge, `void` theme button, `[ LAB ]` nav link, the backtick-toggle dev HUD, and the `rsmd` easter egg.
- **Honest role check on the server too:** the Lab page reads from `/api/info` which also enforces `check_request` — so even if a non-dev hand-edited their localStorage role string, the Lab page's data would be 401-blocked.

### What this means

This is the smallest scheme that hits every criterion. Verification is one HMAC-SHA256 per request (~10 µs on a warm container). The token shape is so trivial that I can mint one in `python -c` if I ever need to bypass the UI.

### So I decided

JWT-lite + two hardcoded passwords + `localStorage` storage + pre-paint UX layer + server `check_request` security layer. The tightening in S4 (`SESSION_DAYS` 30 → 7) is a no-code-change tweak.

## 6. Does this hold up?

### How well this meets my criteria

- **C1 — every `/api/*` gated:** ✅ — `grep "from _auth import check_request" api/*.py` returns every file except `_auth.py` (the helper itself), `login.py` (legitimately ungated, it issues tokens). I keep this grep as a habit before each deploy.
- **C2 — ≤ 5 ms signature work:** ✅ — measured in a warm container at ~0.2 ms. HMAC-SHA256 on a ~60-byte payload is essentially free.
- **C3 — zero new pip deps:** ✅ — Vercel deploy package contains only my source. `pip freeze` inside a function shows the stdlib runtime only.
- **C4 — two roles, no self-elevation:** ✅ — the role is signed into the token. Client can change `xa-user-role` in localStorage and the front-end will *try* to show dev UI, but the moment that UI calls `/api/info` the server verifies the token's payload and returns the real role. The Lab page also gates its content on the verified `/api/info` response.
- **C5 — session ≤ 7 days:** ✅ — as of S4. Was 30 days; the diff is the only uncommitted change in the repo right now.
- **C6 — one-field login:** ✅ — see [`mw-agent/Pages/Login.cshtml`](../../mw-agent/Pages/Login.cshtml).

### Assumptions I'm making

- That the `AUTH_SECRET` env var is set in Vercel and is at least 32 bytes of random. I don't enforce its strength programmatically.
- That XSS is not the dominant threat — I never render user-supplied content into the page without escaping, and I do not load third-party scripts.
- That the shared-password model is acceptable for the current user base (≤ 3 people). It is **not** acceptable for any growth; S5 plans a per-user migration.
- That `localStorage` is per-origin and same-origin scripts are mine. Both true on Vercel.

### What surprised me

- **The pre-paint gate had a subtle bug** at first: the build script's regex was stripping the gate from some static pages (`d471591` "FIX: build script was stripping the auth gate from static pages"). This is the kind of bug only an integration test catches. I now manually check by hitting a fresh page in incognito after each deploy.
- **The constant-time comparison was the easy part.** The hard part was making sure the `Authorization` header parsing was case-insensitive on the `Bearer ` prefix — there is a `lower().startswith("bearer ")` in `check_request` for that reason.
- **30-day tokens felt safe at first** because I have one user, but as soon as I shared the password with one more person, my mental model changed: 30 days × (n users) × (a leaked password) is too much. Dropping to 7 is a low-cost insurance policy and it makes me rotate the secret more naturally.

## 7. What this unlocks

### 🔗 Implementation evidence

- Working login flow: live at `/login` on the deploy.
- Dev-only UI: invisible to operator sessions, visible after a dev login (verified by switching passwords in two browsers).
- Pre-paint gate: visible in the page source of any built `.html` in `docs/` after `build-docs.py` runs.
- The TTL tightening: `git diff api/_auth.py` shows `SESSION_DAYS = 30` → `7`.

### Next LO stage

**Managing** — the auth model is the one thing I want to keep monitoring. The Lab page's SESSION row shows my token's `exp` countdown; if I see it stuck near 30 days I know a stale build slipped through.

### What I can now do (that I couldn't before)

- I can publish the URL without burning my Kling/BFL/Anthropic balance.
- I can give a non-developer the password and trust them not to be exposed to the dev tooling.
- I can rotate the secret in the Vercel dashboard and every existing session is invalidated within one request.
- I can write a new `/api/*` function and the gate is one `import` + one `if not check_request(self): return` line away.

### How I'll know this worked

- The Vercel logs show consistent 401s on `/api/*` from any IP without a token, and 200s only from sessions that have logged in.
- The provider balances (Kling, BFL, Anthropic) increase only when I or a known operator is using the tool — I check this on each sprint review.
- A grep across all `/api/*.py` files for `do_GET`/`do_POST` immediately followed by `check_request` shows the gate is present in every endpoint.
