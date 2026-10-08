#!/usr/bin/env bash
# sh-make-skills.sh — generate the Spec Harness skill set into spec-harness/skills/.
# One Claude Code skill per command (SKILL.md w/ trigger-rich description). The installer
# distributes skills/* into each repo's .claude/skills/. Re-run to regenerate after a command
# doc changes — single source of truth stays the command docs; skills are thin invocable entries.
set -euo pipefail
SYS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$SYS_DIR/skills"
[ ! -L "$OUT" ] || { echo "refusing to generate through a skills symlink: $OUT" >&2; exit 2; }
mkdir -p "$OUT"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/sh-make-skills.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

# name|doc|agents|description (description = the model-invocation trigger; keep it phrase-rich)
emit() {
  local name="$1" doc="$2" agents="$3" desc="$4" role="$5" shared_route="${6:-no}"
  local dir="$STAGE/$name"; mkdir -p "$dir"
  {
    printf -- '---\n'
    printf 'name: %s\n' "$name"
    printf 'description: %s\n' "$desc"
    printf -- '---\n\n'
    printf '# %s\n\n%s\n\n' "$name" "$role"
    printf '## Run it\n'
    if [ "$shared_route" = method ]; then
      printf '1. **Load this reusable method owner** — `.claude/commands/spec-harness/%s.md` (installed project) or source `commands/%s.md`. This method is usable during initialization before a synthesis receipt or feature goal exists.\n' "$doc" "$doc"
      printf '2. **Use shared SDD context when applicable** — `.claude/commands/sdd.md`; do not infer role bindings or native discovery from this skill file.\n\n'
    elif [ "$shared_route" = yes ]; then
      printf '1. **Load the shared SDD procedure first** — `.claude/commands/sdd.md` (installed project) or source `commands/sdd.md`.\n'
      printf '2. **Load this stage contract** — `.claude/commands/spec-harness/%s.md` (installed project) or source `commands/%s.md`.\n' "$doc" "$doc"
      printf '3. **Resolve roles from the receipt** — use only `.claude/agents/.init-synthesis.json` selected paths; file presence or model frontmatter does not prove binding or capability.\n'
      printf '4. **Stay inside the 3 pillars** — Memory bank (`.memory/`) · Spec-Driven Development · Harness. Read `SPEC-HARNESS.md` for setup status.\n\n'
    else
      printf '1. **Load the full procedure** — read the command doc and follow it exactly:\n'
      printf '   `.claude/commands/spec-harness/%s.md` (this repo) or the spec-harness source `commands/%s.md`.\n' "$doc" "$doc"
      if [ -n "$agents" ]; then
        printf '2. **Agents** — follow this command and project policy for role selection.\n'
      fi
      printf '3. **Stay inside the 3 pillars** — Memory bank (`.memory/`) · Spec-Driven Development · Harness (ratchet `AGENTS.md` + verifier + learning loop). Read `SPEC-HARNESS.md` for how this repo is wired.\n\n'
    fi
    printf '## Non-negotiables\n'
    if [ "$shared_route" = method ]; then
      printf -- '- Follow the method owner and target project policy; preserve its evidence and write boundaries.\n'
      printf -- '- This route does not prove that a native client discovered or executed the skill.\n'
    elif [ "$shared_route" = yes ]; then
      printf -- '- Preserve failures and classify feedback; rules change only after reviewed learning.\n'
      printf -- '- A ticket is done only after a fresh verifier passes `specs/<feature>/goal.md`.\n'
      printf -- '- Green tests/review do not grant commit, merge, release, or ticket write-back authority.\n'
    else
      printf -- '- The ratchet only tightens after a reviewed rule change.\n'
      printf -- '- Nothing is "done" until the separate verifier returns PASS against the applicable goal.\n'
      printf -- '- Every correction or FAIL cause goes through `spec-harness-learn` classification.\n'
      printf -- '- Never commit, push or merge unless asked.\n'
    fi
  } > "$dir/SKILL.md"
  echo "  staged $name"
}

emit spec-harness "build" "" \
"The Spec Harness orchestrator — spec-driven development wrapped in a harness (reviewed ratchet + independent verifier + learning loop) over a persistent memory bank. Use when the user says 'use spec harness', 'run the spec harness', 'spec-harness this feature', or wants the full /sdd init or ticket → feature spec/goal → plan → tasks → independent gates flow. Routes to the sub-skills and enforces the 3 pillars (Memory bank · SDD · Harness)." \
"You are the orchestrator for a Spec Harness project. Read the shared \`sdd\` procedure first, then route initialization or ticket work through the appropriate stage skill. Resolve every project-specific role from the synthesis receipt. The implementer does not own acceptance." yes

emit spec-harness-install "init" "researcher" \
"Add or refresh Spec Harness in a repo, greenfield or existing. Use when the user asks to install or initialize Spec Harness. The shell stages files and leaves project synthesis PENDING." \
"Stage the harness, then follow \`.claude/commands/spec-harness/init.md\` as a capable model (source checkout fallback: \`commands/init.md\`): read the inventory, applicable project rules and actual representative source; derive package-scoped rules, three core project skills and a skill per major technology; bind project-aware planner, implementer, fresh tester, verifier and reviewer roles; record evidence and run the structural/provenance check. A separate fresh reviewer must confirm claim support before overall initialization is READY. Shell staging remains PENDING."

emit spec-harness-tickets "tickets" "researcher, planner" \
"Intake exact ticket text or a retrieved body from an explicitly connected provider. Use when the user asks to run /sdd on ticket text, a connected issue, or a feature request. Bare issue names without a retrievable body stop for clarification. Produces a feature-owned specs/<feature>/ packet and goal." \
"Use \`commands/sdd.md\` for the full route. Preserve exact input, pin its provenance and source/rule state, then create a checkable feature-specific spec and goal. Never write the ticket back without separate approval." yes

emit spec-harness-spec "spec" "researcher" \
"Turn accepted ticket text into a structured, testable feature spec and goal. Use when the user says 'spec this', 'write the spec for X', or asks what the requirements are. First SDD artifact stage." \
"Write \`specs/<feature>/spec.md\` with provenance and checkable acceptance, then derive \`specs/<feature>/goal.md\`. Keep root \`goal.md\` untouched." yes

emit spec-harness-plan "plan" "planner" \
"Plan a ticket against actual source and target rules. Use when the user says 'plan the implementation', 'how should we build this', or 'design this'. Apply full Ponytail and source-grounded Grill Me before finalizing the plan." \
"Use the bound planner. Record source-backed decisions, the highest successful Ponytail rung, reuse and exclusions, and only material unresolved Grill Me choices. Keep the plan tied to the feature goal and source/rule hashes." yes

for method in ponytail grill-me package-finder skill-finder; do
  description="Use the portable Spec Harness $method method when initializing a project or planning a ticket that needs this method. Read actual target evidence first; do not install third-party skills or dependencies automatically."
  if [ "$method" = ponytail ]; then
    description="Use the portable Spec Harness Ponytail method for code or implementation work, project initialization, or ticket planning that needs this method. Read actual target evidence first; do not install third-party skills or dependencies automatically."
  fi
  emit "spec-harness-$method" "$method" "" \
    "$description" \
    "Read the installed method owner at .claude/commands/spec-harness/$method.md and follow it. This skill is only a route; it does not replace the shared SDD procedure or prove native client discovery." method
done

emit spec-harness-tasks "tasks" "planner" \
"Break an accepted feature plan into ordered, testable tasks. Use when the user says 'break this into tasks' or 'what are the steps'." \
"Use the bound planner. Each task names repo-relative files, a criterion from \`specs/<feature>/goal.md\`, a real test command, dependencies and any authority boundary." yes

emit spec-harness-build "build" "implementer, tester, verifier, reviewer" \
"Execute a feature packet one task at a time with independent acceptance. Use when the user says 'build it', 'run the pipeline', or 'implement the tasks'." \
"Use the bound implementer, then separate fresh tester, verifier and reviewer contexts. Record each result against the same source/rule revisions and \`specs/<feature>/goal.md\`. Failing or unavailable gates stay open; no merger authority is implied." yes

emit spec-harness-verify "verify" "verifier" \
"Run a fresh verifier against the current feature-specific goal. Use when the user says 'verify it', 'is it actually done', or 'check against the goal'. Tests passing ≠ goal met." \
"Resolve the bound verifier from \`.claude/agents/.init-synthesis.json\`; check each literal criterion in \`specs/<feature>/goal.md\` with evidence. Root \`goal.md\` is not a substitute." yes

emit spec-harness-tester "tester" "workflow-tester" \
"Adversarially validate the app's critical workflows — for each journey in workflows/, a clean-context agent RUNS it end-to-end and actively tries to BREAK it (bad inputs, kill mid-flow, races, double-submit, offline, boundary values), then reports which are BROKEN, ranked P0 first. Use when the user says 'test the workflows', 'try to break the app', 'which critical flows are broken', 'run the workflow tester', or 'is checkout/onboarding still working'. The tester checks reality against critical journeys alongside the verifier's goal check. \`--scan\` and \`tester <id>\` use a capable client; the shell reports PENDING/manual. A BROKEN result sends its repro and candidate guard through reviewed learning; policy changes require approval." \
"Load the workflows/ bank (P0 first). For each workflow spawn a fresh sdd-workflow-tester (clean context, no stake): it runs the journey via how_to_run, then attacks its invariants (bad inputs · kill mid-flow · races/double-submit · offline · boundary · replay) and returns PASS or BROKEN with a concrete repro. Aggregate a ranked report; send each BROKEN repro, likely cause and candidate guard through commands/learn.md for capture, classification and review. Apply a policy change only after approval. The shell prints PENDING/manual; a capable client may propose candidate workflows from app evidence (routes/entry points/write paths) for human confirmation."

emit spec-harness-learn "learn" "learner" \
"Capture a human correction, review finding, bug postmortem or verifier/tester failure as one testable rule. Use when the user says 'learn this', 'remember this', 'capture this lesson', or a separate acceptance role finds a cause." \
"Run commands/learn.md: capture raw feedback, propose a testable cause and owner, and record the existing human/reviewer decision. Apply a canonical rule only after approval; report affected skill/role bindings as stale for the orchestrator's guarded refresh. Unsupported or pending proposals stay captured and proposed. Report LEARNED only after reviewed application; otherwise report PENDING."

emit spec-harness-rules "rules" "researcher, implementer" \
"Derive or review package-scoped rules from an inventory, applicable policies, actual source, tests and configuration. Use during initialization or when a mixed-stack package needs its own rules." \
"Read \`.claude/commands/spec-harness/rules.md\` (source checkout fallback: \`commands/rules.md\`). Open every cited source file and separate OBSERVED facts from RECOMMENDATIONS. Preserve populated policies; fill only explicit scaffolds. Unknown manifests and missing citations remain visible PENDING. Run generate-agents and its --check for structural/provenance readiness; use a separate fresh reviewer to confirm claim support before reporting overall initialization READY."

emit spec-harness-generate-agents "generate-agents" "researcher" \
"Bind applicable SDD roles to project rules and source evidence. Use during initialization or after a changed rule/source requires a binding refresh. Role selection must distinguish project need from installed templates." \
"Run \`bash <spec-harness>/bin/sh-gen-agents.sh <target>\`, then follow its work order using the inventory, existing policies and actual representative code. Bind the required project-aware planner, implementer, fresh tester, verifier and reviewer roles; select merger, design and workflow roles only when evidence supports them. Edit only GEN:rules blocks, cite package paths and source line/hash evidence, write the synthesis receipt, and run \`bash <spec-harness>/bin/sh-gen-agents.sh --check <target>\`. A separate fresh reviewer must confirm claim support before overall initialization is READY. Staging alone is PENDING."

emit spec-harness-audit "audit" "researcher" \
"Health-check the memory bank, rules, and index — flag stale, contradictory, or redundant entries and spec↔code drift. Use when the user says 'audit the bank', 'is the memory stale', 'check spec harness health', or 'clean up the rules'." \
"Cross-check the bank, ai_rules, and index for staleness, contradiction, redundancy, and drift from the real code. Report fixes; promote durable learnings up into the curated bank."

for staged in "$STAGE"/*; do
  [ -d "$staged" ] || continue
  name="${staged##*/}"
  destination="$OUT/$name"
  [ ! -L "$destination" ] || { echo "refusing to write through skill symlink: $destination" >&2; exit 2; }
  if [ -e "$destination" ] && [ ! -d "$destination" ]; then
    echo "refusing to replace non-directory skill path: $destination" >&2
    exit 2
  fi
  mkdir -p "$destination"
  skill_file="$destination/SKILL.md"
  [ ! -L "$skill_file" ] || { echo "refusing to write through skill-file symlink: $skill_file" >&2; exit 2; }
  temp_file="$(mktemp "$destination/.SKILL.md.XXXXXX")"
  cp "$staged/SKILL.md" "$temp_file"
  mv "$temp_file" "$skill_file"
done
count="$(find "$STAGE" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
echo "✅ regenerated $count owned command skills into $OUT; other skill paths were preserved"
