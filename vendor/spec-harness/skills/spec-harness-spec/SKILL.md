---
name: spec-harness-spec
description: Turn accepted ticket text into a structured, testable feature spec and goal. Use when the user says 'spec this', 'write the spec for X', or asks what the requirements are. First SDD artifact stage.
---

# spec-harness-spec

Write `specs/<feature>/spec.md` with provenance and checkable acceptance, then derive `specs/<feature>/goal.md`. Keep root `goal.md` untouched.

## Run it
1. **Load the shared SDD procedure first** — `.claude/commands/sdd.md` (installed project) or source `commands/sdd.md`.
2. **Load this stage contract** — `.claude/commands/spec-harness/spec.md` (installed project) or source `commands/spec.md`.
3. **Resolve roles from the receipt** — use only `.claude/agents/.init-synthesis.json` selected paths; file presence or model frontmatter does not prove binding or capability.
4. **Stay inside the 3 pillars** — Memory bank (`.memory/`) · Spec-Driven Development · Harness. Read `SPEC-HARNESS.md` for setup status.

## Non-negotiables
- Preserve failures and classify feedback; rules change only after reviewed learning.
- A ticket is done only after a fresh verifier passes `specs/<feature>/goal.md`.
- Green tests/review do not grant commit, merge, release, or ticket write-back authority.
