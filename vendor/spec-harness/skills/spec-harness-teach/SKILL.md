---
name: spec-harness-teach
description: Explain a system to a human as one self-contained page: a two-minute quick guide first (what they get, how to start), then the longer version with diagrams. Use when the user says 'explain this to me', 'teach me how this works', 'make a learning page', 'onboard someone to this', or wants to understand a codebase, a feature or a decision.
---

# spec-harness-teach

Run commands/teach.md: read the real source, write the quick guide and cut it to two minutes, write the longer version underneath, then check it in a real browser at two widths and click every control. Never invent an excerpt or a number. Never edit application source.

## Run it
1. **Load the full procedure** — read the command doc and follow it exactly:
   `.claude/commands/spec-harness/teach.md` (this repo) or the spec-harness source `commands/teach.md`.
2. **Stay inside the 3 pillars** — Memory bank (`.memory/`) · Spec-Driven Development · Harness (ratchet `AGENTS.md` + verifier + learning loop). Read `SPEC-HARNESS.md` for how this repo is wired.

## Non-negotiables
- The ratchet only tightens after a reviewed rule change.
- Nothing is "done" until the separate verifier returns PASS against the applicable goal.
- Every correction or FAIL cause goes through `spec-harness-learn` classification.
- Never commit, push or merge unless asked.
