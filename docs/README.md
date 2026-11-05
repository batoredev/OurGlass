# The docs, and which ones are current

Reorganised 2026-11-05. **Start with [`ROADMAP.md`](ROADMAP.md)** — the plan of record. A file
not listed under *Current* is history or reference: read it for *why* the code is the way it is,
not for what to do next.

## Current

| File | Read it to |
|---|---|
| [`ROADMAP.md`](ROADMAP.md) | Know the vision, the principles, the scope, what is built and the stages left |
| [`HANDOFF.md`](HANDOFF.md) | Resume work in a fresh session: state, rules, the Stage 0 findings, gotchas |
| [`YOUR-ACTIONS.md`](YOUR-ACTIONS.md) | See what only the owner can do: accounts, keys, decisions |
| [`DEMO-GUIDE.md`](DEMO-GUIDE.md) | Run a prototype demo with a seeded week of data |
| [`RUNBOOK.md`](RUNBOOK.md) | Deploy, smoke-check, roll back, handle incidents |
| [`DEPLOYMENT-DESIGN.md`](DEPLOYMENT-DESIGN.md) | Understand the Supabase + Cloudflare Pages hosting and why it replaced Workers |
| [`DECISIONS.md`](DECISIONS.md) | Find a locked decision and the research behind it before re-litigating it |
| [`SPEC.md`](SPEC.md) | Read the original product brief (still governs behaviour); [`SPEC-raw.txt`](SPEC-raw.txt) is the unformatted extraction |
| [`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md) | See where models are used and where they are deliberately not |
| [`AI_PROVIDERS.md`](AI_PROVIDERS.md) | Configure Claude, Gemini, Groq, Cerebras, OpenRouter or local Qwen |
| [`AI_FALLBACK.md`](AI_FALLBACK.md) | Know what happens when a model call fails |
| [`AI_EVALS.md`](AI_EVALS.md) | Measure extraction quality, and see which lanes have run |

## Design records — what each phase built, and why

Code comments cite these by section number, so they stay where they are. Each describes its
phase as designed; where later work changed something, the newer document says so.

| File | Phase |
|---|---|
| [`PHASE-1-DESIGN.md`](PHASE-1-DESIGN.md) | Structured state and the validated tool layer |
| [`PHASE-2-DESIGN.md`](PHASE-2-DESIGN.md) | Interpret and Resolve |
| [`PHASE-3-DESIGN.md`](PHASE-3-DESIGN.md) | The conversational loop and reminders |
| [`PHASE-4-DESIGN.md`](PHASE-4-DESIGN.md) | Memory over time: semantic search, provenance, correction |
| [`PHASE-5-DESIGN.md`](PHASE-5-DESIGN.md) | Dynamic entity types and the inspection UI |
| [`PHASE-6-DESIGN.md`](PHASE-6-DESIGN.md) | Uploads: images, PDFs, Word, Excel, text |
| [`PHASE-7-PERMISSIONS-DESIGN.md`](PHASE-7-PERMISSIONS-DESIGN.md) | The §35 permission model and access control |
| [`PLANNER-WIRING-DESIGN.md`](PLANNER-WIRING-DESIGN.md) | Making every built tool reachable from a sentence |
| [`design-prototype/`](design-prototype/README.md) | The supplied visual prototype, and the landscape theme over it |

## Reference

| File | What |
|---|---|
| [`reference/THE-MACHINE.md`](reference/THE-MACHINE.md) | The Machine from *Person of Interest*: what OurGlass borrows, and what it must never copy |

## Archive — superseded plans, kept as history

[`archive/`](archive/): `EXECUTION-PLAN.md` (the first plan), `PHASES.md` (its checklist),
`MASTER-EXECUTION-PLAN.md` and `REMAINING-EXECUTION-PLAN.md` (the later plans). All four were
replaced by `ROADMAP.md` on 2026-11-05.

## The agent-team operating system

[`agent-os/`](agent-os/): how the 46 agent roles in `.claude/agents/` are routed, staffed and
run — `ROUTER.md`, `MISSIONS.md`, `AGENT-HANDBOOK.md`, `AGENT-FLOW.md`, the security practice's
`SECURITY-ROUTER.md` and `SECURITY-MISSIONS.md`, skill coverage and routing, the WAT audit,
setup, and the operating guide PDF. About how this repository is built, not about the product.
