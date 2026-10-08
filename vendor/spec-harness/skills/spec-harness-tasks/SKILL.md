---
name: spec-harness-tasks
description: Break an accepted feature plan into ordered, testable tasks. Use when the user says 'break this into tasks' or 'what are the steps'.
---

# spec-harness-tasks

Use the bound planner. Each task names repo-relative files, a criterion from `specs/<feature>/goal.md`, a real test command, dependencies and any authority boundary.

## Run it
1. **Load the shared SDD procedure first** — `.claude/commands/sdd.md` (installed project) or source `commands/sdd.md`.
2. **Load this stage contract** — `.claude/commands/spec-harness/tasks.md` (installed project) or source `commands/tasks.md`.
3. **Resolve roles from the receipt** — use only `.claude/agents/.init-synthesis.json` selected paths; file presence or model frontmatter does not prove binding or capability.
4. **Stay inside the 3 pillars** — Memory bank (`.memory/`) · Spec-Driven Development · Harness. Read `SPEC-HARNESS.md` for setup status.

## Non-negotiables
- Preserve failures and classify feedback; rules change only after reviewed learning.
- A ticket is done only after a fresh verifier passes `specs/<feature>/goal.md`.
- Green tests/review do not grant commit, merge, release, or ticket write-back authority.
