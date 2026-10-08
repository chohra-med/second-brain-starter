---
name: spec-harness
description: The Spec Harness orchestrator — spec-driven development wrapped in a harness (reviewed ratchet + independent verifier + learning loop) over a persistent memory bank. Use when the user says 'use spec harness', 'run the spec harness', 'spec-harness this feature', or wants the full /sdd init or ticket → feature spec/goal → plan → tasks → independent gates flow. Routes to the sub-skills and enforces the 3 pillars (Memory bank · SDD · Harness).
---

# spec-harness

You are the orchestrator for a Spec Harness project. Read the shared `sdd` procedure first, then route initialization or ticket work through the appropriate stage skill. Resolve every project-specific role from the synthesis receipt. The implementer does not own acceptance.

## Run it
1. **Load the shared SDD procedure first** — `.claude/commands/sdd.md` (installed project) or source `commands/sdd.md`.
2. **Load this stage contract** — `.claude/commands/spec-harness/build.md` (installed project) or source `commands/build.md`.
3. **Resolve roles from the receipt** — use only `.claude/agents/.init-synthesis.json` selected paths; file presence or model frontmatter does not prove binding or capability.
4. **Stay inside the 3 pillars** — Memory bank (`.memory/`) · Spec-Driven Development · Harness. Read `SPEC-HARNESS.md` for setup status.

## Non-negotiables
- Preserve failures and classify feedback; rules change only after reviewed learning.
- A ticket is done only after a fresh verifier passes `specs/<feature>/goal.md`.
- Green tests/review do not grant commit, merge, release, or ticket write-back authority.
