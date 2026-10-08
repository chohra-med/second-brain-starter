---
name: spec-harness-rules
description: Derive or review package-scoped rules from an inventory, applicable policies, actual source, tests and configuration. Use during initialization or when a mixed-stack package needs its own rules.
---

# spec-harness-rules

Read `.claude/commands/spec-harness/rules.md` (source checkout fallback: `commands/rules.md`). Open every cited source file and separate OBSERVED facts from RECOMMENDATIONS. Preserve populated policies; fill only explicit scaffolds. Unknown manifests and missing citations remain visible PENDING. Run generate-agents and its --check for structural/provenance readiness; use a separate fresh reviewer to confirm claim support before reporting overall initialization READY.

## Run it
1. **Load the full procedure** — read the command doc and follow it exactly:
   `.claude/commands/spec-harness/rules.md` (this repo) or the spec-harness source `commands/rules.md`.
2. **Agents** — follow this command and project policy for role selection.
3. **Stay inside the 3 pillars** — Memory bank (`.memory/`) · Spec-Driven Development · Harness (ratchet `AGENTS.md` + verifier + learning loop). Read `SPEC-HARNESS.md` for how this repo is wired.

## Non-negotiables
- The ratchet only tightens after a reviewed rule change.
- Nothing is "done" until the separate verifier returns PASS against the applicable goal.
- Every correction or FAIL cause goes through `spec-harness-learn` classification.
- Never commit, push or merge unless asked.
