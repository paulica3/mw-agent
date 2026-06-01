# Decision Log Entry #4 — Prompt assembly pipeline (chips → readout → optional enhancer)

## 0. Context: Why does this question exist?

**Project / sprint:** XPERIMENT_AI · Sprint 2 (output-quality lift).

**Why this matters right now.** After Sprint 1 the end-to-end loop worked, but the *output* did not look like the scene we were aiming at. The chip vocabulary alone produced a prompt that was *technically correct* ("rage scene aesthetic, neo-noir, slow motion, cold blue color grade") but visually flat. Kling and Flux both improve dramatically when given **cinematographer-grade prompt language** (specific lens, lighting ratios, references to directors). Writing that prose by hand is what an artist would pay a prompt engineer to do. I needed to decide how to bridge from chip selection → final prompt without either dumbing it down or making the user write prose.

**🔗 Where this fits**
- Sprint 2 goal in [`development-plan.md`](../development-plan.md): "Make the *output* feel on-brand, not just the UI."
- The chip → prompt assembly logic: [`site.js`](../../mw-agent/wwwroot/js/site.js) `renderReadout()` and the `PROMPT_ORDER` constant.
- The enhancer endpoint: [`api/enhance.py`](../../api/enhance.py).
- The seed fragments and the per-page intros: [`data/defaults.json`](../../data/defaults.json).
- Commits: `ce87840` ("ADD: ai prompt enhancer (claude) + named presets + audio bpm sync + perf labels"), `b3dd3a8` ("ADD PROMPTS: richer fragments + style category + intro anchors for new wave rap").

## 1. My research question

> *How do I turn a small set of chip selections into a prompt rich enough to drive Kling and Flux toward on-brand new-wave / rap-scene output, without forcing the user to write prose and without losing the user's intent if they do?*

## 2. Current LO stage

[x] Analyzing    [ ] Advising    [x] Designing    [x] Realizing    [ ] Managing

This was primarily a design decision (which I then realised).

## 3. What makes a good decision here?

**My criteria for success**

- **C1 — A user who clicks 3–5 chips and writes no director note gets a prompt that, when run through Kling at `standard`, produces an on-brief clip 8 out of 10 times.** *Why:* this is the most-likely path through the UI. If it fails most of the time, the tool fails. "8 of 10" is a heuristic I can grade by eye on a small batch.
- **C2 — The user's hand-typed director note is never overwritten** by chip changes unless they explicitly ask to reset. *Why:* their note is the most-specific intent; auto-overwriting is the cardinal UX sin.
- **C3 — The enhancer is optional and reversible.** *Why:* sometimes the chip-assembled prompt is *closer* to what the artist wants than Claude's cinematographer-style rewrite. The artist has to be able to walk away from the enhancer.
- **C4 — Adding a new chip vocabulary (new style, new mood) is one Dashboard edit, not a code deploy.** *Why:* I want the artist's visual director to extend the system without me.
- **C5 — The whole pipeline runs without any model call for the default path.** *Why:* Claude calls cost money; chip assembly is free. The free path must be good enough to ship.

## 4. What I decided

A three-layer pipeline:

```
[ chip selections ] → renderReadout() ─┐
                                       ├─ assembled prompt (contenteditable readout)
[ per-page intro  ] ──────────────────┤
                                       │
[ director note   ] ──────────────────┤
                                       │
[ audio meta      ] ──────────────────┘
                       │
                       │   user can edit by hand (sets userEditedPrompt=true)
                       │       └─ "↺ reset to auto" returns to chip-assembly
                       │
                       └─ optional: "✦ enhance" → POST /api/enhance (Claude)
                              → replaces the readout text, treated as user-edit
                              → reset button still works to throw it away
```

Key decisions inside:

1. **Canonical assembly order** (`PROMPT_ORDER = ["theme", "style", "camera", "motion", "mood", "color"]`) prepended by the page-specific intro, followed by chips not in the order list, followed by audio-derived language, followed by the director's note. Joined with `". "` so the result reads as full sentences (Kling and Flux both prefer that to comma chains).
2. **Per-page intros editable from the Dashboard.** The "Album cover artwork or music video still frame for a contemporary new-wave..." anchor lives in [`data/defaults.json`](../../data/defaults.json) and is overridable by the operator. This is the single biggest lever for output style and putting it under operator control was a deliberate trust-the-user move.
3. **The readout is a contenteditable element**, not a `<textarea>`. The placeholder is rendered via CSS `:empty` so it never leaks into `textContent`. When the user types, a flag (`userEditedPrompt`) flips and subsequent chip changes do not overwrite. A visible "↺ reset to auto" button (only shown while edited) returns to chip-assembled state.
4. **The enhancer is a discrete button**, not a setting. Its result *also* sets `userEditedPrompt = true`, so the chip changes the user makes afterward don't silently destroy the enhanced text. Pressing reset throws the enhancement away.
5. **Claude system prompt is scene-aware.** The system prompt in [`api/enhance.py`](../../api/enhance.py) names specific cinematographers (Hype Williams, Director X, Roger Deakins, Greig Fraser, Cole Bennett) and specific Opium-era artists (Carti, Yeat, Destroy Lonely, Ken Carson, Lucki). The model is told to output a single dense paragraph of 400–600 chars with no preamble.

## 5. Why this decision

### Method

1. **Hand-prompted Kling and Flux** with three styles of input for the same shoot brief:
   - Bare chip-string (the old joined fragments).
   - Chip-string with a hand-written 200-char director's note.
   - Chip-string rewritten by Claude in the cinematographer style.
2. **Compared 18 outputs** (3 styles × 6 chip combinations) on subjective "on-brief" scoring.
3. **Read Kling's and BFL's published prompt examples** to confirm both prefer prose to keyword salads.
4. **Tried two assembly orders** (theme-first vs. mood-first) on the same chip set; theme-first wins because the model establishes the world before it considers atmosphere.

### What I found / observed

- The hand-written cinematographer prompts produced visibly better output, in the predicted ratio (something like 6–7 of 10 vs. 2–3 of 10 for the bare chip-string).
- Claude-rewritten prompts were *also* visibly better, and roughly equivalent to a careful human rewrite when given the right system prompt. The system prompt's specificity (named directors, named artists, exact character-length target) was the difference between "a creative writing exercise" and "a usable prompt".
- **Surprise**: a chip-only prompt + a *short* hand-written director's note often produced output as good as a full enhancer rewrite. The director's note is the highest-leverage input the user has. This is why C2 (don't overwrite the note) became my hard rule.
- The `". "` join made Kling's parser noticeably happier than the `, ` join. I attribute this to its training on prose-shaped captions, not keyword-style ones.

### 🔗 Evidence & artifacts

- **Assembly logic**: [`site.js`](../../mw-agent/wwwroot/js/site.js) `renderReadout()` (around lines 535–570).
- **Order constant**: `PROMPT_ORDER` in [`site.js`](../../mw-agent/wwwroot/js/site.js).
- **Excluded from prompt text**: `PROMPT_EXCLUDE_SET = new Set(["size", "duration", "quality"])` — these are API config, not prompt content.
- **Per-page intros (seed)**: [`data/defaults.json`](../../data/defaults.json) lines 3–6.
- **Chip vocabulary (seed)**: [`data/defaults.json`](../../data/defaults.json) — the categories array, including genre, theme, style, mood, camera, motion, location, time, deliverable.
- **Enhancer endpoint**: [`api/enhance.py`](../../api/enhance.py), including the system prompt verbatim.
- **UI for the enhancer button + reset**: [`site.js`](../../mw-agent/wwwroot/js/site.js) `enhanceBtn` handler (around lines 609–646).
- **Lab prompt tester**: lets me dry-run the enhancer without burning a render, located in [`mw-agent/Pages/Lab.cshtml`](../../mw-agent/Pages/Lab.cshtml) section "PROMPT_TESTER".

### What this means

The cheap-path (chips + intro + optional director note) is good enough to be the default. The Claude enhancer is a one-click lift when the user wants more cinematic prose, and crucially it never burns money silently — the user has to opt in by clicking the button. The architecture has exactly one place to extend the vocabulary (the Dashboard → KV → defaults fallback chain) and the user's hand-typing is the highest-priority signal in the pipeline.

### So I decided

Three-layer pipeline with the chip-assembly as default, the enhancer as a button, the director's note as sacred, and the operator-editable intros as the per-deploy "style anchor".

## 6. Does this hold up?

### How well this meets my criteria

- **C1 — 8/10 on-brief for the default path:** 🟡 — informally measured at 6–8 of 10 on `standard` Kling. Not as high as I'd hoped without the enhancer; this is honest. With the enhancer it rises to ~9 of 10 by my own grading. The `intros` field (operator-editable anchor) has the biggest swing here.
- **C2 — director note never overwritten:** ✅ — verified by code (the `userEditedPrompt` flag) and by behaviour (typing in the readout instantly hides the rendered-from-chips output until the user clicks reset).
- **C3 — enhancer is optional and reversible:** ✅ — it's a button, and the reset button discards its result.
- **C4 — adding vocabulary is dashboard-only:** ✅ — the Dashboard page CRUDs the `xa-chips` KV blob; the front-end re-renders the panels on the next load.
- **C5 — default path uses zero Claude calls:** ✅ — the only Claude call is the explicit `enhance` press. Verified by `/api/info` showing `claude.configured` independent of usage and by Anthropic's billing dashboard showing flat spend when I avoided the button for a day.

### Assumptions I'm making

- That Claude Sonnet 4.5 (`claude-sonnet-4-5`, currently named in [`api/enhance.py`](../../api/enhance.py)) stays available and behaves consistently. If Anthropic deprecates the slug I'll have to swap it; the model name is one env-var override away (`ANTHROPIC_MODEL`).
- That the `". "` separator works equally well for Flux. So far it does, but I haven't tested it across all Flux modes.
- That the operator-editable intros won't be misused to inject prompt-injection attacks against Claude. The enhancer is gated by `check_request`, so only authenticated users can hit it — the worst case is an authenticated operator confuses the model. Acceptable.

### What surprised me

- **Audio sync was less impactful than expected.** A 5 s clip rarely showed clear differences when "synced to a 140 BPM track" was added vs. omitted. It looks great in demos but the visual delta is small. I kept the feature because the *artists* expected it (the option to add audio is a signal the tool is for them), but I would not invest more time in it.
- **`intros` was more impactful than the chips.** Editing the intro to mention "Magazine-quality professional photography" raised the perceived quality of every Flux output noticeably. The chips give variation; the intro sets the floor.
- **Claude's system prompt length was load-bearing.** Earlier drafts of the system prompt were 4–5 sentences and produced mediocre rewrites. Spelling out the scene, the named references, the format ("single dense paragraph"), the length target, and the negative instructions ("no preamble, no commentary") together raised the win-rate to acceptable.

## 7. What this unlocks

### 🔗 Implementation evidence

- The deployed Image and Video pages render dynamic panels off `xa-chips` with the static color/duration/quality panels appended.
- The contenteditable readout shows the assembled prompt in real time as chips are clicked.
- The `↺ reset to auto` button appears only when needed.
- The `✦ enhance` button calls Claude and visibly replaces the readout.
- The Lab page's PROMPT_TESTER lets me iterate on the system prompt without burning a render.

### Next LO stage

**Realising** (already done) → **Managing** — I need to keep watching whether the chip vocabulary is staying relevant. The Dashboard chip-count badges (`23 chips · 14 chips ...`) added in S3 are the start of that observability; longer term I would log how often each chip is selected so unused chips can be retired.

### What I can now do (that I couldn't before)

- I can give the URL to an artist who has never written a prompt and get on-brief output in two clicks.
- I can ship a new style cluster (e.g. "JERSEY_CLUB" or "EMO_RAP") by editing the Dashboard, no code deploy.
- I can A/B a system-prompt change in five minutes by editing [`api/enhance.py`](../../api/enhance.py) and pushing.
- I can defend the prompt assembly choices on a slide — the order, the join character, and the optional-enhancer split are all deliberate, not accidental.

### How I'll know this worked

- Operator session feedback: do they touch the director's note? They should sometimes (it's the highest-leverage input). They should not have to.
- History → Recent Renders shows a mix of `enhanced` and `non-enhanced` prompts (length distribution gives this away: enhanced prompts cluster at 400–600 chars, chip-only at 200–400).
- Chip-count badges trend up over time, indicating the operator is extending the vocabulary themselves.
