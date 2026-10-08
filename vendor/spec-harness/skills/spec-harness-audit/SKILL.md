---
name: spec-harness-audit
description: Health-check the memory bank, rules, and index — flag stale, contradictory, or redundant entries and spec↔code drift. Use when the user says 'audit the bank', 'is the memory stale', 'check spec harness health', or 'clean up the rules'.
---

# spec-harness-audit

Cross-check the bank, ai_rules, and index for staleness, contradiction, redundancy, and drift from the real code. Report fixes; promote durable learnings up into the curated bank.

## Run it
1. **Load the full procedure** — read the command doc and follow it exactly:
   `.claude/commands/spec-harness/audit.md` (this repo) or the spec-harness source `commands/audit.md`.
2. **Agents** — follow this command and project policy for role selection.
3. **Stay inside the 3 pillars** — Memory bank (`.memory/`) · Spec-Driven Development · Harness (ratchet `AGENTS.md` + verifier + learning loop). Read `SPEC-HARNESS.md` for how this repo is wired.

## Non-negotiables
- The ratchet only tightens after a reviewed rule change.
- Nothing is "done" until the separate verifier returns PASS against the applicable goal.
- Every correction or FAIL cause goes through `spec-harness-learn` classification.
- Never commit, push or merge unless asked.
