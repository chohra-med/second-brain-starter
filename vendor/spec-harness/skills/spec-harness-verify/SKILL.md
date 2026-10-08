---
name: spec-harness-verify
description: Run a fresh verifier against the current feature-specific goal. Use when the user says 'verify it', 'is it actually done', or 'check against the goal'. Tests passing ≠ goal met.
---

# spec-harness-verify

Resolve the bound verifier from `.claude/agents/.init-synthesis.json`; check each literal criterion in `specs/<feature>/goal.md` with evidence. Root `goal.md` is not a substitute.

## Run it
1. **Load the shared SDD procedure first** — `.claude/commands/sdd.md` (installed project) or source `commands/sdd.md`.
2. **Load this stage contract** — `.claude/commands/spec-harness/verify.md` (installed project) or source `commands/verify.md`.
3. **Resolve roles from the receipt** — use only `.claude/agents/.init-synthesis.json` selected paths; file presence or model frontmatter does not prove binding or capability.
4. **Stay inside the 3 pillars** — Memory bank (`.memory/`) · Spec-Driven Development · Harness. Read `SPEC-HARNESS.md` for setup status.

## Non-negotiables
- Preserve failures and classify feedback; rules change only after reviewed learning.
- A ticket is done only after a fresh verifier passes `specs/<feature>/goal.md`.
- Green tests/review do not grant commit, merge, release, or ticket write-back authority.
