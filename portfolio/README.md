# Portfolio — XPERIMENT_AI (`mw-agent`)

> University portfolio for the project. Organised by learning outcome with cross-links to the decision logs, the development plan, and the diagrams.
>
> The project itself is in the parent directory: Razor source under [`mw-agent/`](../mw-agent/), serverless functions under [`api/`](../api/), build script in [`scripts/build-docs.py`](../scripts/build-docs.py), deploy config in [`vercel.json`](../vercel.json).

## How to read this

Start at **proposal → development plan → C4 diagrams** for the overall shape. Then either follow the **decision logs** (the non-obvious choices) or jump straight to a **learning outcome** for the evidence on that LO.

Every document mentions the iterative sprint cadence in context. Each decision log walks the full template (context → criteria → decision → verification → unlock). The C4 diagrams include alternatives considered and the design pressure that caused each change — not just a picture.

---

## Top-level

- [Project proposal](proposal.docx) (`.docx`) — problem statement, scope, stakeholders, risks, success criteria. *(Markdown source kept at [proposal.md](proposal.md) for editing.)*
- [Development plan](development-plan.docx) (`.docx`) — sprint cadence and a per-sprint goal / plan / review / adaptation record. *(Markdown source kept at [development-plan.md](development-plan.md) for editing.)*

## Diagrams (design)

Rendered to JPG in [`diagrams/img/`](diagrams/img/):

1. [L1 — System context](diagrams/img/01-c4-context.jpg)
2. [L2 — Container view](diagrams/img/02-c4-container.jpg)
3. [L3 — Component view (GENERATE flow)](diagrams/img/03-c4-component-generate.jpg)
4. [Data flow — video render sequence](diagrams/img/04-dataflow-video-render.jpg)
5. [Data flow — auth flow](diagrams/img/05-dataflow-auth.jpg)

The accompanying reasoning (alternatives considered, why this shape, what would change at scale) is in [diagrams/architecture-c4.md](diagrams/architecture-c4.md) and [diagrams/data-flow.md](diagrams/data-flow.md), each of which embeds the JPGs alongside the text.

## Decision logs

In-depth, template-driven. Each one is at the full template depth (criteria, methodology, evidence, verification, what surprised me, what this unlocks).

- [DL-01 — Build & deploy architecture](decision-logs/DL-01-build-and-deploy.md)
- [DL-02 — Video provider choice and the QUALITY chip mapping](decision-logs/DL-02-video-provider-and-quality-mapping.md)
- [DL-03 — Auth model and role-aware UI](decision-logs/DL-03-auth-and-role-model.md)
- [DL-04 — Prompt assembly pipeline (chips → readout → enhancer)](decision-logs/DL-04-prompt-assembly-and-enhancement.md)

## Learning outcomes

| LO | First document | Second document |
|---|---|---|
| **LO1 — Analyzing** | [Problem & audience](lo/LO1-analyzing/01-problem-and-audience.md) | [Provider & stack landscape](lo/LO1-analyzing/02-provider-and-stack-landscape.md) |
| **LO2 — Advising** | [Stack recommendation](lo/LO2-advising/01-stack-recommendation.md) | [Quality tiers & cost model](lo/LO2-advising/02-quality-tier-and-cost-model.md) |
| **LO3 — Designing** | [System architecture](lo/LO3-designing/01-system-architecture.md) | [Prompt pipeline design](lo/LO3-designing/02-prompt-pipeline-design.md) |
| **LO4 — Realizing** | [Implementation report](lo/LO4-realizing/01-implementation-report.md) | [Testing & verification](lo/LO4-realizing/02-testing-and-verification.md) |
| **LO5 — Managing** | [Sprint cadence & control](lo/LO5-managing/01-sprint-cadence-and-control.md) | [Monitoring, evaluation, adaptation](lo/LO5-managing/02-monitoring-and-adaptation.md) |

## Cross-reference matrix (LO ↔ decision log ↔ code)

| LO | Strongest decision-log evidence | Code anchor |
|---|---|---|
| LO1 | [DL-02](decision-logs/DL-02-video-provider-and-quality-mapping.md), [DL-01](decision-logs/DL-01-build-and-deploy.md) | [`data/defaults.json`](../data/defaults.json), provider scoring tables |
| LO2 | [DL-01](decision-logs/DL-01-build-and-deploy.md), [DL-02](decision-logs/DL-02-video-provider-and-quality-mapping.md) | [`vercel.json`](../vercel.json), [`api/generate.py`](../api/generate.py) `QUALITY_PRESETS` |
| LO3 | [DL-04](decision-logs/DL-04-prompt-assembly-and-enhancement.md), [DL-03](decision-logs/DL-03-auth-and-role-model.md) | [`api/`](../api/) layout, [`site.js`](../mw-agent/wwwroot/js/site.js) `renderReadout` |
| LO4 | [DL-03](decision-logs/DL-03-auth-and-role-model.md), [DL-02](decision-logs/DL-02-video-provider-and-quality-mapping.md) | every `/api/*.py`, [`scripts/build-docs.py`](../scripts/build-docs.py) |
| LO5 | (cadence is in [development-plan.md](development-plan.md)) | the commit log, the Lab page |

## Sprint timeline (one-glance)

| Sprint | Dates (2026) | Goal | Status |
|---|---|---|---|
| **S0** | May 13–14 | Bootstrap scaffold + pick a stack | done |
| **S1** | May 14–18 | First end-to-end: deploy + Kling + auth | done |
| **S2** | May 18–26 | Output quality lift + image gen + enhancer | done |
| **S3** | May 26–28 | History, expanded chips, dev Lab | done |
| **S4** | May 28–31 | Portfolio + session TTL tightening | in flight |
| **S5** | Jun 1–4 | Stripe + multi-user prep | planned |

## Status of the deployed system as of 2026-05-28

- Live behind the `xa-token` password gate.
- All four sprint-1-through-3 features are reachable on the deployed site.
- Five `/api/info` provider rows green (kling, bfl, claude, kv, auth).
- One uncommitted change in working tree: `SESSION_DAYS` 30 → 7 in [`api/_auth.py`](../api/_auth.py) (Sprint 4 tightening).
