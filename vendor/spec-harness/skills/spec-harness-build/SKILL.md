---
name: spec-harness-build
description: Execute a feature packet one task at a time with independent acceptance. Use when the user says 'build it', 'run the pipeline', or 'implement the tasks'.
---

# spec-harness-build

Use the bound implementer, then separate fresh tester, verifier and reviewer contexts. Record each result against the same source/rule revisions and `specs/<feature>/goal.md`. Failing or unavailable gates stay open; no merger authority is implied.

## Run it
1. **Load the shared SDD procedure first** — `.claude/commands/sdd.md` (installed project) or source `commands/sdd.md`.
2. **Load this stage contract** — `.claude/commands/spec-harness/build.md` (installed project) or source `commands/build.md`.
3. **Resolve roles from the receipt** — use only `.claude/agents/.init-synthesis.json` selected paths; file presence or model frontmatter does not prove binding or capability.
4. **Stay inside the 3 pillars** — Memory bank (`.memory/`) · Spec-Driven Development · Harness. Read `SPEC-HARNESS.md` for setup status.

## Non-negotiables
- Preserve failures and classify feedback; rules change only after reviewed learning.
- A ticket is done only after a fresh verifier passes `specs/<feature>/goal.md`.
- Green tests/review do not grant commit, merge, release, or ticket write-back authority.
