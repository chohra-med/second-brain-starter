---
name: spec-harness-generate-agents
description: Bind applicable SDD roles to project rules and source evidence. Use during initialization or after a changed rule/source requires a binding refresh. Role selection must distinguish project need from installed templates.
---

# spec-harness-generate-agents

Run `bash <spec-harness>/bin/sh-gen-agents.sh <target>`, then follow its work order using the inventory, existing policies and actual representative code. Bind the required project-aware planner, implementer, fresh tester, verifier and reviewer roles; select merger, design and workflow roles only when evidence supports them. Edit only GEN:rules blocks, cite package paths and source line/hash evidence, write the synthesis receipt, and run `bash <spec-harness>/bin/sh-gen-agents.sh --check <target>`. A separate fresh reviewer must confirm claim support before overall initialization is READY. Staging alone is PENDING.

## Run it
1. **Load the full procedure** — read the command doc and follow it exactly:
   `.claude/commands/spec-harness/generate-agents.md` (this repo) or the spec-harness source `commands/generate-agents.md`.
2. **Agents** — follow this command and project policy for role selection.
3. **Stay inside the 3 pillars** — Memory bank (`.memory/`) · Spec-Driven Development · Harness (ratchet `AGENTS.md` + verifier + learning loop). Read `SPEC-HARNESS.md` for how this repo is wired.

## Non-negotiables
- The ratchet only tightens after a reviewed rule change.
- Nothing is "done" until the separate verifier returns PASS against the applicable goal.
- Every correction or FAIL cause goes through `spec-harness-learn` classification.
- Never commit, push or merge unless asked.
