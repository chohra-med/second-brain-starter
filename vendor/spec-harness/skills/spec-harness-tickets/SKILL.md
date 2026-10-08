---
name: spec-harness-tickets
description: Intake exact ticket text or a retrieved body from an explicitly connected provider. Use when the user asks to run /sdd on ticket text, a connected issue, or a feature request. Bare issue names without a retrievable body stop for clarification. Produces a feature-owned specs/<feature>/ packet and goal.
---

# spec-harness-tickets

Use `commands/sdd.md` for the full route. Preserve exact input, pin its provenance and source/rule state, then create a checkable feature-specific spec and goal. Never write the ticket back without separate approval.

## Run it
1. **Load the shared SDD procedure first** — `.claude/commands/sdd.md` (installed project) or source `commands/sdd.md`.
2. **Load this stage contract** — `.claude/commands/spec-harness/tickets.md` (installed project) or source `commands/tickets.md`.
3. **Resolve roles from the receipt** — use only `.claude/agents/.init-synthesis.json` selected paths; file presence or model frontmatter does not prove binding or capability.
4. **Stay inside the 3 pillars** — Memory bank (`.memory/`) · Spec-Driven Development · Harness. Read `SPEC-HARNESS.md` for setup status.

## Non-negotiables
- Preserve failures and classify feedback; rules change only after reviewed learning.
- A ticket is done only after a fresh verifier passes `specs/<feature>/goal.md`.
- Green tests/review do not grant commit, merge, release, or ticket write-back authority.
