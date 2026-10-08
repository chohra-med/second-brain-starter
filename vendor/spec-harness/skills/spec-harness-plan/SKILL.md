---
name: spec-harness-plan
description: Plan a ticket against actual source and target rules. Use when the user says 'plan the implementation', 'how should we build this', or 'design this'. Apply full Ponytail and source-grounded Grill Me before finalizing the plan.
---

# spec-harness-plan

Use the bound planner. Record source-backed decisions, the highest successful Ponytail rung, reuse and exclusions, and only material unresolved Grill Me choices. Keep the plan tied to the feature goal and source/rule hashes.

## Run it
1. **Load the shared SDD procedure first** — `.claude/commands/sdd.md` (installed project) or source `commands/sdd.md`.
2. **Load this stage contract** — `.claude/commands/spec-harness/plan.md` (installed project) or source `commands/plan.md`.
3. **Resolve roles from the receipt** — use only `.claude/agents/.init-synthesis.json` selected paths; file presence or model frontmatter does not prove binding or capability.
4. **Stay inside the 3 pillars** — Memory bank (`.memory/`) · Spec-Driven Development · Harness. Read `SPEC-HARNESS.md` for setup status.

## Non-negotiables
- Preserve failures and classify feedback; rules change only after reviewed learning.
- A ticket is done only after a fresh verifier passes `specs/<feature>/goal.md`.
- Green tests/review do not grant commit, merge, release, or ticket write-back authority.
