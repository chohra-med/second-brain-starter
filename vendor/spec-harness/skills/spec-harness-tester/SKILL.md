---
name: spec-harness-tester
description: Adversarially validate the app's critical workflows — for each journey in workflows/, a clean-context agent RUNS it end-to-end and actively tries to BREAK it (bad inputs, kill mid-flow, races, double-submit, offline, boundary values), then reports which are BROKEN, ranked P0 first. Use when the user says 'test the workflows', 'try to break the app', 'which critical flows are broken', 'run the workflow tester', or 'is checkout/onboarding still working'. The tester checks reality against critical journeys alongside the verifier's goal check. `--scan` and `tester <id>` use a capable client; the shell reports PENDING/manual. A BROKEN result sends its repro and candidate guard through reviewed learning; policy changes require approval.
---

# spec-harness-tester

Load the workflows/ bank (P0 first). For each workflow spawn a fresh sdd-workflow-tester (clean context, no stake): it runs the journey via how_to_run, then attacks its invariants (bad inputs · kill mid-flow · races/double-submit · offline · boundary · replay) and returns PASS or BROKEN with a concrete repro. Aggregate a ranked report; send each BROKEN repro, likely cause and candidate guard through commands/learn.md for capture, classification and review. Apply a policy change only after approval. The shell prints PENDING/manual; a capable client may propose candidate workflows from app evidence (routes/entry points/write paths) for human confirmation.

## Run it
1. **Load the full procedure** — read the command doc and follow it exactly:
   `.claude/commands/spec-harness/tester.md` (this repo) or the spec-harness source `commands/tester.md`.
2. **Agents** — follow this command and project policy for role selection.
3. **Stay inside the 3 pillars** — Memory bank (`.memory/`) · Spec-Driven Development · Harness (ratchet `AGENTS.md` + verifier + learning loop). Read `SPEC-HARNESS.md` for how this repo is wired.

## Non-negotiables
- The ratchet only tightens after a reviewed rule change.
- Nothing is "done" until the separate verifier returns PASS against the applicable goal.
- Every correction or FAIL cause goes through `spec-harness-learn` classification.
- Never commit, push or merge unless asked.
