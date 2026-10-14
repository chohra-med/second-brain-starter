---
name: spec-harness-install
description: Add or refresh Spec Harness in a repo, greenfield or existing. Use when the user asks to install or initialize Spec Harness. The shell stages files and leaves project synthesis PENDING.
---

# spec-harness-install

Stage the harness, then follow `.claude/commands/spec-harness/init.md` as a capable model (source checkout fallback: `commands/init.md`): read the inventory, applicable project rules and actual representative source; derive package-scoped rules, the core project skills (five on first initialisation) and a skill per major technology; bind project-aware planner, implementer, fresh tester, verifier and reviewer roles; record evidence and run the structural/provenance check. A separate fresh reviewer must confirm claim support before overall initialization is READY. Shell staging remains PENDING.

## Run it
1. **Load the full procedure** — read the command doc and follow it exactly:
   `.claude/commands/spec-harness/init.md` (this repo) or the spec-harness source `commands/init.md`.
2. **Agents** — follow this command and project policy for role selection.
3. **Stay inside the 3 pillars** — Memory bank (`.memory/`) · Spec-Driven Development · Harness (ratchet `AGENTS.md` + verifier + learning loop). Read `SPEC-HARNESS.md` for how this repo is wired.

## Non-negotiables
- The ratchet only tightens after a reviewed rule change.
- Nothing is "done" until the separate verifier returns PASS against the applicable goal.
- Every correction or FAIL cause goes through `spec-harness-learn` classification.
- Never commit, push or merge unless asked.
