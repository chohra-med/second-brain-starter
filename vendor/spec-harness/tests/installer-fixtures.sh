#!/usr/bin/env bash
# Disposable acceptance fixtures for the portable installer. No fixture writes outside TMPDIR.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
HARNESS_DIR="${SPEC_HARNESS_DIR:-$(cd "$TEST_DIR/.." && pwd -P)}"
CLI="$HARNESS_DIR/bin/spec-harness"
INIT="$HARNESS_DIR/bin/sh-init.sh"
PORTABLE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib/portable.sh"
# shellcheck source=lib/portable.sh
. "$PORTABLE"
require_tools git cmp
TMP="$(mktemp -d "${TMPDIR:-/tmp}/spec-harness-installer.XXXXXX")" || exit 1
FAILURES=0
LAST_RC=0

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1"
  FAILURES=$((FAILURES + 1))
}

pass() { printf 'PASS: %s\n' "$1"; }

run_cli() {
  local log="$1"
  shift
  (cd "$TMP" && "$CLI" "$@") >"$log" 2>&1
  LAST_RC=$?
}

run_init() {
  local log="$1"
  shift
  (cd "$TMP" && bash "$INIT" "$@") >"$log" 2>&1
  LAST_RC=$?
}

assert_rc() {
  local wanted="$1" label="$2"
  if [ "$LAST_RC" -eq "$wanted" ]; then pass "$label (exit $LAST_RC)"; else fail "$label (expected exit $wanted, got $LAST_RC)"; fi
}

assert_contains() {
  local file="$1" text="$2" label="$3"
  if grep -Fq -- "$text" "$file"; then pass "$label"; else fail "$label (missing: $text)"; fi
}

assert_conflict() {
  local file="$1" text="$2" label="$3"
  if awk -v needle="$text" '
    /^  CONFLICTS paths:$/ { inside = 1; next }
    /^  PENDING paths:$/ { inside = 0 }
    inside && index($0, needle) { found = 1 }
    END { exit !found }
  ' "$file"; then pass "$label"; else fail "$label (not listed under CONFLICTS: $text)"; fi
}

assert_pending() {
  local file="$1" text="$2" label="$3"
  if awk -v needle="$text" '
    /^  PENDING paths:$/ { inside = 1; next }
    /^Next:/ { inside = 0 }
    inside && index($0, needle) { found = 1 }
    END { exit !found }
  ' "$file"; then pass "$label"; else fail "$label (not listed under PENDING: $text)"; fi
}

assert_file() {
  local path="$1" label="$2"
  if [ -f "$path" ]; then pass "$label"; else fail "$label (missing: $path)"; fi
}

assert_absent() {
  local path="$1" label="$2"
  if [ ! -e "$path" ]; then pass "$label"; else fail "$label (unexpected: $path)"; fi
}

hash_file() { sha256_file "$1"; }

check_startup() {
  local target="$1" label="$2" path
  local required=(
    CLAUDE.md AGENTS.md RULES.md constitution.md goal.md loop.sh SPEC-HARNESS.md
    .memory/00-description.md .memory/01-brief.md .memory/10-product.md .memory/20-system.md
    .memory/30-tech.md .memory/40-active.md .memory/50-progress.md .memory/60-decisions.md
    .memory/70-knowledge.md .memory/80-feedback.md
    ai_rules/globalRules.md ai_rules/context_map.md ai_rules/updated_rules.md
    ai_rules/rules/core.md ai_rules/rules/context_management.md ai_rules/rules/frequent_rules.md
    .claude/agents/sdd-implementer.md .claude/agents/sdd-verifier.md
    .claude/commands/spec-harness/verify.md .claude/commands/spec-harness/tickets.md
    .claude/skills/spec-harness/SKILL.md .claude/skills/spec-harness-verify/SKILL.md
  )
  local method
  for path in "${required[@]}"; do
    if [ -f "$target/$path" ]; then :; else fail "$label startup file exists: $path"; fi
  done
  for method in ponytail grill-me package-finder skill-finder; do
    for path in ".claude/commands/spec-harness/$method.md" ".claude/skills/spec-harness-$method/SKILL.md" ".agents/skills/spec-harness-$method/SKILL.md"; do
      if [ -f "$target/$path" ]; then :; else fail "$label portable method route exists: $path"; fi
    done
  done
  for path in .memory/40-active.md .memory/50-progress.md ai_rules/globalRules.md \
      ai_rules/rules/frequent_rules.md ai_rules/rules/context_management.md ai_rules/context_map.md; do
    if [ -f "$target/$path" ]; then :; else fail "$label referenced startup path exists: $path"; fi
  done
}

printf 'Installer fixture root: %s\n' "$TMP"

# Fresh install with a path containing spaces and a shell-sensitive project name.
NEW="$TMP/new project with spaces"
mkdir -p "$NEW"
SENSITIVE_NAME='Demo $(touch SHOULD_NOT_EXIST)'
run_cli "$TMP/new.log" init "$NEW" "$SENSITIVE_NAME"
assert_rc 0 'positional init stages a new project'
assert_contains "$TMP/new.log" 'status        : PENDING' 'fresh install reports PENDING'
assert_contains "$TMP/new.log" '.memory/40-active.md' 'fresh install enumerates pending paths'
assert_pending "$TMP/new.log" '.claude/agents/sdd-implementer.md' 'fresh install lists generic roles as pending'
assert_contains "$NEW/goal.md" '{{FEATURE}}' 'fresh goal remains an unresolved scaffold'
assert_contains "$NEW/.claude/agents/sdd-implementer.md" 'No project-specific rules generated yet' 'fresh role remains generic'
assert_contains "$NEW/SPEC-HARNESS.md" '- Claude: `/sdd init` or `/sdd <ticket text or connected reference>` → `.claude/commands/sdd.md`.' 'shared ticket route is written literally'
check_startup "$NEW" 'fresh install'
for method in architecture performance packages; do
  [ -f "$NEW/.claude/spec-harness/methods/spec-harness-$method.md" ] || fail "installed $method method is present"
  [ ! -e "$NEW/.claude/skills/spec-harness-$method/SKILL.md" ] || fail "generic $method method is not installed as a project skill"
done
assert_contains "$NEW/.claude/commands/spec-harness/init.md" '.claude/spec-harness/methods/' 'installed init points to consumer method paths'
assert_contains "$NEW/AGENTS.md" "$SENSITIVE_NAME" 'project name is written literally'
assert_absent "$TMP/SHOULD_NOT_EXIST" 'project name is never evaluated as shell code'
if grep -Eq 'status[[:space:]]*:[[:space:]]*READY|READY: true' "$TMP/new.log"; then fail 'fresh scaffold is never called READY'; else pass 'fresh scaffold is never called READY'; fi

# Existing startup text may reference a missing file; preserve it and keep the setup pending.
MISSING_REF="$TMP/missing-startup-reference"
mkdir -p "$MISSING_REF"
printf '# Local startup\nRead ai_rules/missing-local-rule.md before work.\n' >"$MISSING_REF/CLAUDE.md"
MISSING_REF_HASH="$(hash_file "$MISSING_REF/CLAUDE.md")"
run_cli "$TMP/missing-reference.log" init "$MISSING_REF" new MissingReference
assert_rc 0 'a missing existing startup reference does not prevent safe staging'
assert_contains "$TMP/missing-reference.log" 'status        : PENDING' 'missing existing reference remains PENDING'
assert_absent "$MISSING_REF/ai_rules/missing-local-rule.md" 'installer does not invent a missing referenced policy'
if [ "$(hash_file "$MISSING_REF/CLAUDE.md")" = "$MISSING_REF_HASH" ]; then pass 'missing-reference startup file is preserved byte-for-byte'; else fail 'missing-reference startup file is preserved byte-for-byte'; fi
if grep -Eq 'status[[:space:]]*:[[:space:]]*READY|READY: true' "$TMP/missing-reference.log"; then fail 'missing installed reference is never called READY'; else pass 'missing installed reference is never called READY'; fi

# The staged CLAUDE.md imports AGENTS.md so Claude Code loads the same rules; an existing one is never touched.
assert_line_present() {
  local file="$1" label="$2"
  if grep -Fxq '@AGENTS.md' "$file"; then pass "$label"; else fail "$label (no exact @AGENTS.md line in $file)"; fi
}
assert_line_present "$NEW/CLAUDE.md" 'fresh install CLAUDE.md imports AGENTS.md'
AGENTS_ONLY="$TMP/agents-only-target"
mkdir -p "$AGENTS_ONLY"
printf '# Local agents\nKeep changes small.\n' >"$AGENTS_ONLY/AGENTS.md"
run_cli "$TMP/agents-only.log" init "$AGENTS_ONLY" new AgentsOnly
assert_rc 0 'a target with only AGENTS.md installs'
assert_line_present "$AGENTS_ONLY/CLAUDE.md" 'a target with only AGENTS.md gets a CLAUDE.md that imports it'
if ! grep -Fxq '@AGENTS.md' "$MISSING_REF/CLAUDE.md"; then pass 'an existing CLAUDE.md gets no AGENTS.md import added'; else fail 'an existing CLAUDE.md gets no AGENTS.md import added'; fi

# The project lens template and the optional memory kinds are staged on an empty target; an existing lens is never touched.
assert_file "$NEW/ai_rules/review-lens.md" 'fresh install stages the review lens template'
assert_contains "$NEW/ai_rules/review-lens.md" '- **LENS-<n>** <one check sentence>.' 'lens template shows the line format'
assert_contains "$NEW/ai_rules/review-lens.md" '`MET`, `VIOLATED` or `NOT-APPLICABLE`' 'lens template names the three verdicts'
assert_contains "$NEW/ai_rules/review-lens.md" 'never remove or weaken a lens item' 'lens template says a brief may add and never remove'
assert_contains "$NEW/ai_rules/review-lens.md" 'Status: PENDING' 'lens template is PENDING'
for kind_file in content/voice-dna.md content/audience.md automation/pipeline.md research/sources.md; do
  assert_file "$NEW/.claude/spec-harness/memory-kinds/$kind_file" "fresh install stages memory kind $kind_file"
  assert_contains "$NEW/.claude/spec-harness/memory-kinds/$kind_file" 'Status: PENDING' "memory kind $kind_file is PENDING"
done
# The memory guide is staged where commands/init.md names it, and init.md names that exact path.
assert_file "$NEW/.claude/spec-harness/docs/MEMORY.md" 'fresh install stages the memory guide docs/MEMORY.md'
assert_contains "$NEW/.claude/spec-harness/docs/MEMORY.md" '## When a Hot file is full' 'staged memory guide has the Hot-file section'
assert_contains "$HARNESS_DIR/commands/init.md" '.claude/spec-harness/docs/MEMORY.md' 'init.md names the staged memory guide path'
LENS_TARGET="$TMP/lens-target"
mkdir -p "$LENS_TARGET/ai_rules"
printf '# My lens\n- **LENS-1** Own check.\n' >"$LENS_TARGET/ai_rules/review-lens.md"
LENS_HASH="$(hash_file "$LENS_TARGET/ai_rules/review-lens.md")"
run_cli "$TMP/lens-target.log" init "$LENS_TARGET" new LensTarget
assert_rc 0 'a target with its own review lens installs'
if [ "$(hash_file "$LENS_TARGET/ai_rules/review-lens.md")" = "$LENS_HASH" ]; then pass 'an existing review-lens.md stays byte-identical'; else fail 'an existing review-lens.md stays byte-identical'; fi

# The edit guard hook: staged executable, registered in the untracked settings.local.json by a merge,
# never in the committed settings.json, idempotent, and removable without touching anything else.
HOOK_CMD='"$CLAUDE_PROJECT_DIR"/.claude/spec-harness/hooks/sdd-gate.sh'
HOOK_REG="$HARNESS_DIR/bin/sh-hook-register.py"
HOOK_GIT="$TMP/hook-git"
mkdir -p "$HOOK_GIT"
git init -q "$HOOK_GIT"
run_cli "$TMP/hook-git.log" install "$HOOK_GIT" integrate HookGit
assert_rc 0 'install into a git target with the hook'
assert_file "$HOOK_GIT/.claude/spec-harness/hooks/sdd-gate.sh" 'install stages the edit guard hook'
if [ -x "$HOOK_GIT/.claude/spec-harness/hooks/sdd-gate.sh" ]; then pass 'the staged hook is executable'; else fail 'the staged hook is executable'; fi
assert_file "$HOOK_GIT/.claude/settings.local.json" 'install registers the hook in settings.local.json'
assert_absent "$HOOK_GIT/.claude/settings.json" 'install never writes the committed settings.json'
assert_contains "$TMP/hook-git.log" 'hook registration' 'the install report says what happened to the hook registration'
python3 -I -B - "$HOOK_GIT/.claude/settings.local.json" "$HOOK_CMD" <<'PYHOOK1' >"$TMP/hook-git-check.log" 2>&1
import json, sys
settings = json.load(open(sys.argv[1]))
groups = settings["hooks"]["PreToolUse"]
assert len(groups) == 1, groups
assert groups[0]["matcher"] == "Edit|Write|MultiEdit|NotebookEdit", groups
assert groups[0]["hooks"] == [{"type": "command", "command": sys.argv[2]}], groups
print("REGISTERED once with the expected matcher and command")
PYHOOK1
assert_contains "$TMP/hook-git-check.log" 'REGISTERED once with the expected matcher and command' 'settings.local.json holds exactly one harness entry'
HOOK_EXCLUDE_COUNT="$(grep -Fxc '/.claude/settings.local.json' "$HOOK_GIT/.git/info/exclude")"
if [ "$HOOK_EXCLUDE_COUNT" = 1 ]; then pass 'the settings file is added to .git/info/exclude once'; else fail "the settings file is added to .git/info/exclude once (found $HOOK_EXCLUDE_COUNT)"; fi
if git -C "$HOOK_GIT" check-ignore -q .claude/settings.local.json; then pass 'git ignores the settings file after install'; else fail 'git ignores the settings file after install'; fi
HOOK_SETTINGS_HASH="$(hash_file "$HOOK_GIT/.claude/settings.local.json")"
run_cli "$TMP/hook-git-2.log" install "$HOOK_GIT" integrate HookGit
assert_rc 0 'second install into the same target'
if [ "$(hash_file "$HOOK_GIT/.claude/settings.local.json")" = "$HOOK_SETTINGS_HASH" ]; then pass 'a second install leaves settings.local.json byte-identical'; else fail 'a second install leaves settings.local.json byte-identical'; fi
HOOK_EXCLUDE_COUNT="$(grep -Fxc '/.claude/settings.local.json' "$HOOK_GIT/.git/info/exclude")"
if [ "$HOOK_EXCLUDE_COUNT" = 1 ]; then pass 'a second install does not repeat the exclude line'; else fail "a second install does not repeat the exclude line (found $HOOK_EXCLUDE_COUNT)"; fi
if [ -z "$(find "$HOOK_GIT/.claude" -maxdepth 1 -name '.spec-harness-update-*')" ]; then pass 'the settings merge leaves no temporary file'; else fail 'the settings merge leaves no temporary file'; fi

# A different sdd-gate.sh already in the target (for example one that came with a cloned repository) is kept, as
# every existing file is, but never registered: the hook command would run it on every edit.
HOOK_FOREIGN="$TMP/hook-foreign"
mkdir -p "$HOOK_FOREIGN/.claude/spec-harness/hooks"
git init -q "$HOOK_FOREIGN"
printf '#!/bin/sh\necho foreign\n' >"$HOOK_FOREIGN/.claude/spec-harness/hooks/sdd-gate.sh"
chmod +x "$HOOK_FOREIGN/.claude/spec-harness/hooks/sdd-gate.sh"
run_cli "$TMP/hook-foreign.log" install "$HOOK_FOREIGN" integrate HookForeign
assert_absent "$HOOK_FOREIGN/.claude/settings.local.json" 'a foreign sdd-gate.sh in the target is not registered'
assert_contains "$TMP/hook-foreign.log" 'differs from the shipped edit guard' 'the install report says why the hook was not registered'
if python3 -I -B "$HOOK_REG" add "$HOOK_FOREIGN" >"$TMP/hook-foreign-add.log" 2>&1; then fail 'the registrar refuses a foreign sdd-gate.sh'; else pass 'the registrar refuses a foreign sdd-gate.sh'; fi
HOOK_BARE="$TMP/hook-bare"
mkdir -p "$HOOK_BARE"
if python3 -I -B "$HOOK_REG" add "$HOOK_BARE" >"$TMP/hook-bare-add.log" 2>&1; then fail 'the registrar refuses a target with no staged hook'; else pass 'the registrar refuses a target with no staged hook'; fi
assert_absent "$HOOK_BARE/.claude/settings.local.json" 'a refused registration writes no settings file'
# The refusal names the step that works: copy the shipped hook over it keeping the mode, then add again, or run your
# own hook under another name (an entry for this path would be removed by the next refused add). update keeps a
# changed or foreign hook, so it is not that step.
assert_contains "$TMP/hook-foreign-add.log" "$HARNESS_DIR/hooks/sdd-gate.sh" 'the refusal names the shipped hook path'
assert_contains "$TMP/hook-foreign-add.log" 'cp -p' 'the refusal says to keep the mode when replacing the hook'
assert_contains "$TMP/hook-foreign-add.log" 'sh-hook-register.py add' 'the refusal gives the add command to run again'
assert_contains "$TMP/hook-foreign-add.log" 'save it under another name and register that name in .claude/settings.local.json yourself' 'the refusal says how to run your own hook without the next add removing it'
if grep -Fq 'add the entry to' "$TMP/hook-foreign-add.log"; then fail 'the refusal does not offer a hand-added entry for this path, which the next refused add removes'; else pass 'the refusal does not offer a hand-added entry for this path, which the next refused add removes'; fi
if grep -Fq 'spec-harness update' "$TMP/hook-foreign-add.log"; then fail 'the refusal does not send the reader to update, which keeps the file'; else pass 'the refusal does not send the reader to update, which keeps the file'; fi

# A refused add also takes out an earlier registration, which would keep running the changed file on every edit.
# Only the harness entry goes, as with remove; the file goes only when it held nothing else.
HOOK_CHANGED="$TMP/hook-changed"
mkdir -p "$HOOK_CHANGED/.claude/spec-harness/hooks"
cp -p "$HARNESS_DIR/hooks/sdd-gate.sh" "$HOOK_CHANGED/.claude/spec-harness/hooks/sdd-gate.sh"
python3 -I -B "$HOOK_REG" add "$HOOK_CHANGED" >"$TMP/hook-changed-1.log" 2>&1
assert_contains "$HOOK_CHANGED/.claude/settings.local.json" 'sdd-gate.sh' 'positive control: the shipped hook is registered'
printf '#!/bin/sh\necho changed\n' >"$HOOK_CHANGED/.claude/spec-harness/hooks/sdd-gate.sh"
python3 -I -B "$HOOK_REG" add "$HOOK_CHANGED" >"$TMP/hook-changed-2.log" 2>&1
HOOK_RC=$?
if [ "$HOOK_RC" -eq 1 ]; then pass 'add over a changed hook exits 1'; else fail "add over a changed hook exits 1 (got $HOOK_RC)"; fi
assert_absent "$HOOK_CHANGED/.claude/settings.local.json" 'a refused add removes the earlier registration and the file that held only it'
assert_contains "$TMP/hook-changed-2.log" 'earlier registration was removed' 'the refusal says the earlier registration was removed'
HOOK_KEEP="$TMP/hook-changed-keep"
mkdir -p "$HOOK_KEEP/.claude/spec-harness/hooks"
cp -p "$HARNESS_DIR/hooks/sdd-gate.sh" "$HOOK_KEEP/.claude/spec-harness/hooks/sdd-gate.sh"
printf '{"permissions": {"allow": ["Read"]}, "hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "echo mine"}]}]}}\n' >"$HOOK_KEEP/.claude/settings.local.json"
cp "$HOOK_KEEP/.claude/settings.local.json" "$TMP/hook-changed-keep-before.json"
python3 -I -B "$HOOK_REG" add "$HOOK_KEEP" >"$TMP/hook-changed-keep-1.log" 2>&1
assert_contains "$HOOK_KEEP/.claude/settings.local.json" 'sdd-gate.sh' 'positive control: the hook is registered beside another hook'
printf '# local edit\n' >>"$HOOK_KEEP/.claude/spec-harness/hooks/sdd-gate.sh"
python3 -I -B "$HOOK_REG" add "$HOOK_KEEP" >"$TMP/hook-changed-keep-2.log" 2>&1
HOOK_RC=$?
if [ "$HOOK_RC" -eq 1 ]; then pass 'add over an edited hook exits 1'; else fail "add over an edited hook exits 1 (got $HOOK_RC)"; fi
python3 -I -B - "$TMP/hook-changed-keep-before.json" "$HOOK_KEEP/.claude/settings.local.json" <<'PYHOOK4' >"$TMP/hook-changed-keep-check.log" 2>&1
import json, sys
assert json.load(open(sys.argv[1])) == json.load(open(sys.argv[2]))
print("UNREGISTERED: only the harness entry went")
PYHOOK4
assert_contains "$TMP/hook-changed-keep-check.log" 'UNREGISTERED: only the harness entry went' 'a refused add keeps every other key and hook'
# A settings file that cannot be parsed is left byte-for-byte alone, and the refusal says so.
HOOK_UNPARSED="$TMP/hook-changed-bad-json"
mkdir -p "$HOOK_UNPARSED/.claude/spec-harness/hooks"
printf '#!/bin/sh\necho changed\n' >"$HOOK_UNPARSED/.claude/spec-harness/hooks/sdd-gate.sh"
chmod +x "$HOOK_UNPARSED/.claude/spec-harness/hooks/sdd-gate.sh"
printf '{"hooks": {"PreToolUse": [{"matcher": "Edit", "hooks": [{"type": "command", "command": "%s"}]}]}, oops\n' '\"$CLAUDE_PROJECT_DIR\"/.claude/spec-harness/hooks/sdd-gate.sh' >"$HOOK_UNPARSED/.claude/settings.local.json"
HOOK_UNPARSED_HASH="$(hash_file "$HOOK_UNPARSED/.claude/settings.local.json")"
python3 -I -B "$HOOK_REG" add "$HOOK_UNPARSED" >"$TMP/hook-changed-bad-json.log" 2>&1
HOOK_RC=$?
if [ "$HOOK_RC" -eq 1 ]; then pass 'add over a changed hook and an unparsable settings file exits 1'; else fail "add over a changed hook and an unparsable settings file exits 1 (got $HOOK_RC)"; fi
if [ "$(hash_file "$HOOK_UNPARSED/.claude/settings.local.json")" = "$HOOK_UNPARSED_HASH" ]; then pass 'an unparsable settings file is left byte-identical by a refused add'; else fail 'an unparsable settings file is left byte-identical by a refused add'; fi
assert_contains "$TMP/hook-changed-bad-json.log" 'is not valid JSON' 'the refusal names the settings file it could not parse'
assert_contains "$TMP/hook-changed-bad-json.log" 'was not removed' 'the refusal says an earlier registration in it was not removed'

# A staged hook without the owner execute bit is refused: Claude Code could not run it, so edits would go unguarded.
HOOK_NOEXEC="$TMP/hook-noexec"
mkdir -p "$HOOK_NOEXEC/.claude/spec-harness/hooks"
cp "$HARNESS_DIR/hooks/sdd-gate.sh" "$HOOK_NOEXEC/.claude/spec-harness/hooks/sdd-gate.sh"
chmod 644 "$HOOK_NOEXEC/.claude/spec-harness/hooks/sdd-gate.sh"
python3 -I -B "$HOOK_REG" add "$HOOK_NOEXEC" >"$TMP/hook-noexec.log" 2>&1
HOOK_RC=$?
if [ "$HOOK_RC" -eq 1 ]; then pass 'add refuses a hook without the execute bit (exit 1)'; else fail "add refuses a hook without the execute bit (got exit $HOOK_RC)"; fi
assert_absent "$HOOK_NOEXEC/.claude/settings.local.json" 'a hook without the execute bit is not registered'
assert_contains "$TMP/hook-noexec.log" 'is not executable' 'the refusal says the hook is not executable'
assert_contains "$TMP/hook-noexec.log" 'chmod +x' 'the refusal gives the chmod +x command'

# install over a registered target whose hook was edited since: install keeps the edited file, so the registration
# is refused and the earlier one removed. The report says that, and does not call the hook staged.
HOOK_REINSTALL="$TMP/hook-reinstall"
mkdir -p "$HOOK_REINSTALL"
git init -q "$HOOK_REINSTALL"
run_cli "$TMP/hook-reinstall-1.log" install "$HOOK_REINSTALL" integrate HookReinstall
assert_file "$HOOK_REINSTALL/.claude/settings.local.json" 'positive control: the first install registers the hook'
printf '# local edit\n' >>"$HOOK_REINSTALL/.claude/spec-harness/hooks/sdd-gate.sh"
run_cli "$TMP/hook-reinstall-2.log" install "$HOOK_REINSTALL" integrate HookReinstall
assert_rc 0 'install over an edited hook still stages the rest'
assert_absent "$HOOK_REINSTALL/.claude/settings.local.json" 'install over an edited hook removes the earlier registration'
assert_contains "$TMP/hook-reinstall-2.log" 'hook registration: NOT registered' 'the install report says the hook was not registered'
assert_contains "$TMP/hook-reinstall-2.log" 'earlier registration was removed' 'the install report says the earlier registration was removed'
if grep -Fq 'staged but not registered' "$TMP/hook-reinstall-2.log"; then fail 'the install report does not call a refused hook staged'; else pass 'the install report does not call a refused hook staged'; fi
assert_pending "$TMP/hook-reinstall-2.log" 'the edit guard hook was not registered' 'the PENDING line says the hook was not registered'

# An existing settings.local.json keeps every unrelated key and hook, in order, and its file mode.
HOOK_MERGE="$TMP/hook-merge"
mkdir -p "$HOOK_MERGE/.claude"
git init -q "$HOOK_MERGE"
cat >"$HOOK_MERGE/.claude/settings.local.json" <<'JSON'
{
  "permissions": {"allow": ["Bash(ls:*)"], "deny": []},
  "env": {"EXAMPLE": "1"},
  "hooks": {
    "PreToolUse": [
      {"matcher": "Bash", "hooks": [{"type": "command", "command": "echo before-bash"}]},
      {"matcher": "Edit", "hooks": [{"type": "command", "command": "echo own-edit-hook"}]}
    ],
    "PostToolUse": [{"matcher": "Write", "hooks": [{"type": "command", "command": "echo after-write"}]}]
  }
}
JSON
chmod 600 "$HOOK_MERGE/.claude/settings.local.json"
cp "$HOOK_MERGE/.claude/settings.local.json" "$TMP/hook-merge-before.json"
printf '{"permissions": {"allow": ["Read"]}}\n' >"$HOOK_MERGE/.claude/settings.json"
HOOK_COMMITTED_HASH="$(hash_file "$HOOK_MERGE/.claude/settings.json")"
run_cli "$TMP/hook-merge.log" install "$HOOK_MERGE" integrate HookMerge
assert_rc 0 'install over an existing settings.local.json'
run_cli "$TMP/hook-merge-2.log" install "$HOOK_MERGE" integrate HookMerge
assert_rc 0 'second install over an existing settings.local.json'
if [ "$(hash_file "$HOOK_MERGE/.claude/settings.json")" = "$HOOK_COMMITTED_HASH" ]; then pass 'the committed settings.json is byte-identical after install'; else fail 'the committed settings.json is byte-identical after install'; fi
python3 -I -B - "$TMP/hook-merge-before.json" "$HOOK_MERGE/.claude/settings.local.json" "$HOOK_CMD" <<'PYHOOK2' >"$TMP/hook-merge-check.log" 2>&1
import json, os, stat, sys
before = json.load(open(sys.argv[1]))
path = sys.argv[2]
after = json.load(open(path))
ours = {"matcher": "Edit|Write|MultiEdit|NotebookEdit", "hooks": [{"type": "command", "command": sys.argv[3]}]}
assert after["permissions"] == before["permissions"] and after["env"] == before["env"], after
assert after["hooks"]["PostToolUse"] == before["hooks"]["PostToolUse"], after
assert after["hooks"]["PreToolUse"][:2] == before["hooks"]["PreToolUse"], after["hooks"]["PreToolUse"]
assert after["hooks"]["PreToolUse"][2:] == [ours], after["hooks"]["PreToolUse"]
assert set(after) == set(before), after
assert stat.S_IMODE(os.stat(path).st_mode) == 0o600, oct(os.stat(path).st_mode)
print("MERGED: unrelated keys and hooks survive, one entry added, mode kept")
PYHOOK2
assert_contains "$TMP/hook-merge-check.log" 'MERGED: unrelated keys and hooks survive, one entry added, mode kept' 'a merge keeps unrelated keys and hooks, adds one entry once, keeps the mode'
# Remove deletes only the harness entry and restores the person's own file meaning.
python3 -I -B "$HOOK_REG" remove "$HOOK_MERGE" >"$TMP/hook-merge-remove.log" 2>&1
python3 -I -B "$HOOK_REG" remove "$HOOK_MERGE" >>"$TMP/hook-merge-remove.log" 2>&1
python3 -I -B - "$TMP/hook-merge-before.json" "$HOOK_MERGE/.claude/settings.local.json" <<'PYHOOK3' >"$TMP/hook-merge-remove-check.log" 2>&1
import json, sys
assert json.load(open(sys.argv[1])) == json.load(open(sys.argv[2]))
print("REMOVED: the file is back to the person's own content")
PYHOOK3
assert_contains "$TMP/hook-merge-remove-check.log" "REMOVED: the file is back to the person's own content" 'remove takes out only the harness entry (twice is safe)'
assert_file "$HOOK_MERGE/.claude/spec-harness/hooks/sdd-gate.sh" 'remove leaves the staged hook script alone'
python3 -I -B "$HOOK_REG" remove "$HOOK_GIT" >"$TMP/hook-git-remove.log" 2>&1
assert_absent "$HOOK_GIT/.claude/settings.local.json" 'remove deletes a settings file that held only the harness entry'

# A settings file the merge cannot trust is left byte-for-byte alone and named in the report.
HOOK_BAD="$TMP/hook-bad"
mkdir -p "$HOOK_BAD/.claude"
printf '{ not json\n' >"$HOOK_BAD/.claude/settings.local.json"
HOOK_BAD_HASH="$(hash_file "$HOOK_BAD/.claude/settings.local.json")"
run_cli "$TMP/hook-bad.log" install "$HOOK_BAD" integrate HookBad
assert_rc 0 'install next to an unreadable settings.local.json still stages the rest'
if [ "$(hash_file "$HOOK_BAD/.claude/settings.local.json")" = "$HOOK_BAD_HASH" ]; then pass 'an invalid settings.local.json is left byte-identical'; else fail 'an invalid settings.local.json is left byte-identical'; fi
assert_contains "$TMP/hook-bad.log" 'hook registration: NOT registered' 'the report says the hook was not registered'
HOOK_LINK="$TMP/hook-link"
mkdir -p "$HOOK_LINK/.claude"
printf '{"keep": true}\n' >"$TMP/hook-link-victim.json"
ln -s "$TMP/hook-link-victim.json" "$HOOK_LINK/.claude/settings.local.json"
run_cli "$TMP/hook-link.log" install "$HOOK_LINK" integrate HookLink
assert_rc 0 'install next to a linked settings.local.json still stages the rest'
if [ "$(cat "$TMP/hook-link-victim.json")" = '{"keep": true}' ]; then pass 'a linked settings.local.json is never written through'; else fail 'a linked settings.local.json is never written through'; fi
assert_contains "$TMP/hook-link.log" 'hook registration: NOT registered' 'the report says a linked settings file was not used'

# A target that already ignores the file, and a target that is not a git repository.
HOOK_IGN="$TMP/hook-ignored"
mkdir -p "$HOOK_IGN"
git init -q "$HOOK_IGN"
printf '.claude/settings.local.json\n' >"$HOOK_IGN/.gitignore"
run_cli "$TMP/hook-ignored.log" install "$HOOK_IGN" integrate HookIgnored
assert_rc 0 'install into a target that already ignores the settings file'
if ! grep -Fq 'settings.local.json' "$HOOK_IGN/.git/info/exclude"; then pass 'an already ignored settings file is not added to .git/info/exclude'; else fail 'an already ignored settings file is not added to .git/info/exclude'; fi
HOOK_PLAIN="$TMP/hook-plain"
mkdir -p "$HOOK_PLAIN"
run_cli "$TMP/hook-plain.log" install "$HOOK_PLAIN" new HookPlain
assert_rc 0 'install into a folder that is not a git repository'
assert_file "$HOOK_PLAIN/.claude/settings.local.json" 'a non-git target still gets the registration'
assert_absent "$HOOK_PLAIN/.git" 'the installer does not create a git repository'
run_cli "$TMP/hook-uninstall.log" uninstall "$HOOK_PLAIN"
assert_contains "$TMP/hook-uninstall.log" '.claude/spec-harness/hooks/sdd-gate.sh' 'the uninstall plan lists the hook script'
assert_contains "$TMP/hook-uninstall.log" 'sh-hook-register.py remove' 'the uninstall plan names the command that removes the settings entry'

# The removal command the uninstall plan prints must survive a path with a space: split it like a shell and run it.
HOOK_SPACE="$TMP/hook target with space"
mkdir -p "$HOOK_SPACE"
run_cli "$TMP/hook-space-install.log" install "$HOOK_SPACE" new HookSpace
run_cli "$TMP/hook-space-uninstall.log" uninstall "$HOOK_SPACE"
python3 -I -B - "$TMP/hook-space-uninstall.log" "$HOOK_SPACE" "$HOOK_REG" <<'PYSPACE' >"$TMP/hook-space-check.log" 2>&1
import shlex, subprocess, sys
line = next(l for l in open(sys.argv[1]).read().splitlines() if "sh-hook-register.py" in l and "remove" in l).strip()
words = shlex.split(line)
import os
assert os.path.realpath(words[-1]) == os.path.realpath(sys.argv[2]) and words[-2] == "remove" and words[-3] == sys.argv[3], words
result = subprocess.run(words, capture_output=True, text=True)
assert result.returncode == 0, (result.returncode, result.stdout, result.stderr)
print("QUOTED: the printed removal command works for a path with a space")
PYSPACE
assert_contains "$TMP/hook-space-check.log" 'QUOTED: the printed removal command works for a path with a space' 'the uninstall plan quotes the target path in the removal command'
assert_absent "$HOOK_SPACE/.claude/settings.local.json" 'the printed removal command removed the harness entry'

# Explicit integrate into an existing package-shaped fixture.
INTEGRATE="$TMP/integrate project"
mkdir -p "$INTEGRATE"
printf '{"name":"integrate-fixture"}\n' >"$INTEGRATE/package.json"
run_cli "$TMP/integrate.log" init "$INTEGRATE" integrate IntegrateFixture
assert_rc 0 'explicit integrate stages an existing project'
assert_contains "$TMP/integrate.log" 'mode          : integrate' 'integrate mode is reported'
assert_contains "$TMP/integrate.log" 'status        : PENDING' 'integrate reports PENDING'
check_startup "$INTEGRATE" 'integrate install'

# The advertised two-positional init form means new + project name.
LEGACY="$TMP/legacy-init"
mkdir -p "$LEGACY"
run_cli "$TMP/legacy.log" init "$LEGACY" LegacyProject
assert_rc 0 'init <target> <name> maps the name instead of mode'
assert_contains "$TMP/legacy.log" 'mode          : new' 'positional init selects new mode'
assert_contains "$LEGACY/AGENTS.md" 'LegacyProject' 'positional project name reaches the scaffold'

# The direct scaffold entry point must use the same safe writer.
SCAFFOLD="$TMP/direct-scaffold"
mkdir -p "$SCAFFOLD"
run_init "$TMP/scaffold.log" "$SCAFFOLD" DirectScaffold
assert_rc 0 'direct scaffold uses the safe new installer'
check_startup "$SCAFFOLD" 'direct scaffold'

# Invalid mode, invalid name and missing target must be rejected before writes.
INVALID="$TMP/invalid-mode"
mkdir -p "$INVALID"
run_cli "$TMP/invalid-mode.log" init "$INVALID" invalid-mode Project
if [ "$LAST_RC" -ne 0 ]; then pass 'invalid mode is rejected'; else fail 'invalid mode is rejected (unexpected success)'; fi
if [ -z "$(find "$INVALID" -mindepth 1 -print -quit)" ]; then pass 'invalid mode writes nothing'; else fail 'invalid mode writes nothing'; fi

BADNAME="$TMP/invalid-name"
mkdir -p "$BADNAME"
BAD_NAME=$'Bad\nName'
run_cli "$TMP/invalid-name.log" init "$BADNAME" new "$BAD_NAME"
if [ "$LAST_RC" -ne 0 ]; then pass 'multiline project name is rejected'; else fail 'multiline project name is rejected (unexpected success)'; fi
if [ -z "$(find "$BADNAME" -mindepth 1 -print -quit)" ]; then pass 'invalid name writes nothing'; else fail 'invalid name writes nothing'; fi

MISSING="$TMP/missing-target"
run_cli "$TMP/missing.log" init "$MISSING" new MissingTarget
if [ "$LAST_RC" -ne 0 ]; then pass 'missing target is rejected'; else fail 'missing target is rejected (unexpected success)'; fi
assert_absent "$MISSING" 'missing target is not created'

# A symlinked root that resolves into a vault-shaped path is refused before staging.
VAULT="$TMP/second-brain"
VAULT_LINK="$TMP/vault-alias"
mkdir -p "$VAULT"
ln -s "$VAULT" "$VAULT_LINK"
run_cli "$TMP/vault-link.log" init "$VAULT_LINK" new VaultAlias
if [ "$LAST_RC" -ne 0 ]; then pass 'vault-shaped symlink target is rejected'; else fail 'vault-shaped symlink target is rejected (unexpected success)'; fi
if [ -z "$(find "$VAULT" -mindepth 1 -print -quit)" ]; then pass 'vault-shaped symlink target writes nothing'; else fail 'vault-shaped symlink target writes nothing'; fi

# An escaping startup-directory symlink is caught before even unrelated files are added.
SYMLINK_ROOT="$TMP/symlink-target"
OUTSIDE="$TMP/outside-memory"
mkdir -p "$SYMLINK_ROOT" "$OUTSIDE"
ln -s "$OUTSIDE" "$SYMLINK_ROOT/.memory"
run_cli "$TMP/dest-symlink.log" init "$SYMLINK_ROOT" new SymlinkTarget
if [ "$LAST_RC" -ne 0 ]; then pass 'escaping destination symlink is rejected'; else fail 'escaping destination symlink is rejected (unexpected success)'; fi
if [ -z "$(find "$OUTSIDE" -mindepth 1 -print -quit)" ]; then pass 'escaping destination receives no writes'; else fail 'escaping destination receives no writes'; fi
assert_absent "$SYMLINK_ROOT/AGENTS.md" 'symlink preflight runs before unrelated writes'

# Empty directories created by the installer are also part of symlink preflight.
EMPTY_DIR_ROOT="$TMP/symlink-empty-directory"
OUTSIDE_EMPTY="$TMP/outside-empty-directory"
mkdir -p "$EMPTY_DIR_ROOT" "$OUTSIDE_EMPTY"
ln -s "$OUTSIDE_EMPTY" "$EMPTY_DIR_ROOT/specs"
run_cli "$TMP/empty-dir-symlink.log" init "$EMPTY_DIR_ROOT" new EmptyDirectoryLink
if [ "$LAST_RC" -ne 0 ]; then pass 'symlinked installer directory is rejected'; else fail 'symlinked installer directory is rejected (unexpected success)'; fi
if [ -z "$(find "$OUTSIDE_EMPTY" -mindepth 1 -print -quit)" ]; then pass 'symlinked installer directory receives no writes'; else fail 'symlinked installer directory receives no writes'; fi
assert_absent "$EMPTY_DIR_ROOT/AGENTS.md" 'directory preflight runs before unrelated writes'

# Rerun after personalizing every user-owned surface named by the brief.
PERSONAL="$TMP/personalized"
mkdir -p "$PERSONAL"
run_cli "$TMP/personal-first.log" init "$PERSONAL" new PersonalProject
if [ "$LAST_RC" -eq 0 ]; then :; else fail 'personalization fixture initial install'; fi
printf '\n## Local policy %s\n' "$(date +%s)" >>"$PERSONAL/AGENTS.md"
printf '\n## Local root rules\n' >>"$PERSONAL/RULES.md"
printf '\n## Local memory\n' >>"$PERSONAL/.memory/30-tech.md"
printf '\n## Local role\n' >>"$PERSONAL/.claude/agents/sdd-implementer.md"
printf '\n## Local skill\n' >>"$PERSONAL/.claude/skills/spec-harness/SKILL.md"
printf '\n## Local command\n' >>"$PERSONAL/.claude/commands/spec-harness/verify.md"
printf '\n## Local guide\n' >>"$PERSONAL/SPEC-HARNESS.md"
printf '\n## Local Claude startup\n' >>"$PERSONAL/CLAUDE.md"
USER_PATHS=(AGENTS.md RULES.md .memory/30-tech.md .claude/agents/sdd-implementer.md \
  .claude/skills/spec-harness/SKILL.md .claude/commands/spec-harness/verify.md SPEC-HARNESS.md CLAUDE.md)
BEFORE_HASHES=()
for path in "${USER_PATHS[@]}"; do BEFORE_HASHES+=("$(hash_file "$PERSONAL/$path")"); done
run_cli "$TMP/personal-rerun-new.log" init "$PERSONAL" new PersonalProject
assert_rc 0 'new-mode rerun completes staging'
assert_contains "$TMP/personal-rerun-new.log" 'status        : PENDING' 'rerun remains PENDING'
for i in "${!USER_PATHS[@]}"; do
  path="${USER_PATHS[$i]}"
  after="$(hash_file "$PERSONAL/$path")"
  if [ "$after" = "${BEFORE_HASHES[$i]}" ]; then pass "new rerun preserves exact bytes: $path"; else fail "new rerun preserves exact bytes: $path"; fi
  assert_conflict "$TMP/personal-rerun-new.log" "$path" "new rerun reports conflict: $path"
done
run_cli "$TMP/personal-rerun-integrate.log" init "$PERSONAL" integrate PersonalProject
assert_rc 0 'integrate-mode rerun completes staging'
for i in "${!USER_PATHS[@]}"; do
  path="${USER_PATHS[$i]}"
  after="$(hash_file "$PERSONAL/$path")"
  if [ "$after" = "${BEFORE_HASHES[$i]}" ]; then pass "integrate rerun preserves exact bytes: $path"; else fail "integrate rerun preserves exact bytes: $path"; fi
  assert_conflict "$TMP/personal-rerun-integrate.log" "$path" "integrate rerun reports conflict: $path"
done

# Documentation-only commands are explicit and cannot satisfy a shell && gate.
FALSE_GOAL="$TMP/false-goal.md"
printf '%s\n' '- [ ] absent-file-that-cannot-exist.txt exists' >"$FALSE_GOAL"
VERIFY_SENTINEL="$TMP/verify-then-commit-ran"
git() { touch "$VERIFY_SENTINEL"; }
"$CLI" verify --goal "$FALSE_GOAL" >"$TMP/verify.log" 2>&1 && git commit
LAST_RC=$?
unset -f git
assert_rc 2 'verify handoff for an unmet goal is PENDING (exit 2)'
assert_absent "$VERIFY_SENTINEL" 'verify failure prevents the following && action'
assert_contains "$TMP/verify.log" 'PENDING: documentation only' 'verify reports a documentation-only PENDING handoff'
for cmd in build plan tickets; do
  run_cli "$TMP/$cmd.log" "$cmd"
  assert_rc 2 "$cmd documentation-only handoff is PENDING (exit 2)"
  assert_contains "$TMP/$cmd.log" 'PENDING: documentation only' "$cmd reports a documentation-only PENDING handoff"
done
run_cli "$TMP/help.log" help
assert_rc 0 'explicit help remains successful'
run_cli "$TMP/unknown.log" misspelled-command
if [ "$LAST_RC" -ne 0 ]; then pass 'unknown command exits nonzero'; else fail 'unknown command exits nonzero'; fi
assert_contains "$TMP/unknown.log" 'unknown command: misspelled-command' 'unknown command is identified'

# A template that exists but cannot be read must abort before any target file is written.
UNREADABLE_SRC="$TMP/unreadable-source"
mkdir -p "$UNREADABLE_SRC"
(cd "$HARNESS_DIR" && tar -cf - --exclude=.git .) | (cd "$UNREADABLE_SRC" && tar -xf -)
UNREADABLE_TARGET="$TMP/unreadable-target"
mkdir -p "$UNREADABLE_TARGET"
chmod 000 "$UNREADABLE_SRC/templates/install/SPEC-HARNESS.md"
(cd "$TMP" && "$UNREADABLE_SRC/bin/spec-harness" init "$UNREADABLE_TARGET" new UnreadableTemplate) >"$TMP/unreadable.log" 2>&1
LAST_RC=$?
chmod 644 "$UNREADABLE_SRC/templates/install/SPEC-HARNESS.md"
assert_rc 1 'unreadable installer template aborts the install'
assert_contains "$TMP/unreadable.log" 'templates/install/SPEC-HARNESS.md' 'unreadable template is named on stderr'
if [ -z "$(find "$UNREADABLE_TARGET" -mindepth 1 -print -quit)" ]; then pass 'unreadable template writes no target files'; else fail 'unreadable template writes no target files'; fi

# The install record is written through the safe writer. A link planted at the old fixed temporary
# name (.spec-harness/install.json.tmp) must not be written through; the record must be a regular file.
RECORD_TMP_ROOT="$TMP/record-tmp-link"
RECORD_VICTIM="$TMP/record-victim.txt"
mkdir -p "$RECORD_TMP_ROOT/.spec-harness"
printf 'victim bytes that init must not touch\n' >"$RECORD_VICTIM"
ln -s "$RECORD_VICTIM" "$RECORD_TMP_ROOT/.spec-harness/install.json.tmp"
RECORD_VICTIM_BEFORE="$(hash_file "$RECORD_VICTIM")"
run_cli "$TMP/record-tmp-link.log" init "$RECORD_TMP_ROOT" integrate RecordTmpLink
assert_rc 0 'planted install.json.tmp link: install completes'
RECORD_VICTIM_AFTER="$(hash_file "$RECORD_VICTIM")"
if [ "$RECORD_VICTIM_AFTER" = "$RECORD_VICTIM_BEFORE" ]; then pass 'planted install.json.tmp link: outside victim bytes unchanged'; else fail "planted install.json.tmp link: outside victim changed ($RECORD_VICTIM_BEFORE -> $RECORD_VICTIM_AFTER)"; fi
if [ -f "$RECORD_TMP_ROOT/.spec-harness/install.json" ] && [ ! -L "$RECORD_TMP_ROOT/.spec-harness/install.json" ]; then pass 'planted install.json.tmp link: install.json is a regular file'; else fail 'planted install.json.tmp link: install.json is a regular file'; fi

# A1: a read-only .spec-harness/base is an OS refusal of the record step. It must be a named line that
# says the record could not be written, with exit 1 and no Python traceback (the update path does the same).
READONLY_RECORD="$TMP/record-readonly"
mkdir -p "$READONLY_RECORD/.spec-harness/base"
chmod 555 "$READONLY_RECORD/.spec-harness/base"
run_cli "$TMP/record-readonly.log" init "$READONLY_RECORD" integrate ReadOnlyRecord
chmod 755 "$READONLY_RECORD/.spec-harness/base"
assert_rc 1 'read-only base directory: the install record step exits 1'
assert_contains "$TMP/record-readonly.log" 'install record could not be written' 'read-only base directory: the record failure is named'
assert_contains "$TMP/record-readonly.log" 'install record: cannot write' 'read-only base directory: the refused path is named'
if grep -Fq 'Traceback' "$TMP/record-readonly.log"; then fail 'read-only base directory: no Python traceback is printed'; cat "$TMP/record-readonly.log"; else pass 'read-only base directory: no Python traceback is printed'; fi

# A link at a base-copy path is refused by the preflight before any file is staged (exit 2).
BASE_LINK_ROOT="$TMP/base-link"
BASE_VICTIM="$TMP/base-victim.txt"
mkdir -p "$BASE_LINK_ROOT/.spec-harness/base"
printf 'outside base victim\n' >"$BASE_VICTIM"
ln -s "$BASE_VICTIM" "$BASE_LINK_ROOT/.spec-harness/base/goal.md"
BASE_VICTIM_BEFORE="$(hash_file "$BASE_VICTIM")"
run_cli "$TMP/base-link.log" init "$BASE_LINK_ROOT" integrate BaseLink
assert_rc 2 'symlinked base copy goal.md is refused before staging'
assert_contains "$TMP/base-link.log" 'preflight failed; target was not modified.' 'symlinked base copy is named by the preflight refusal'
if [ "$(hash_file "$BASE_VICTIM")" = "$BASE_VICTIM_BEFORE" ]; then pass 'symlinked base copy: outside victim bytes unchanged'; else fail 'symlinked base copy: outside victim bytes unchanged'; fi
assert_absent "$BASE_LINK_ROOT/goal.md" 'symlinked base copy: no planned file is staged'

# The shared writer refuses a link at any path component and writes a plain file when the path is safe.
WRITE_REGULAR="$TMP/write-regular"
mkdir -p "$WRITE_REGULAR/root" "$WRITE_REGULAR/outside"
printf 'outside file for write_regular\n' >"$WRITE_REGULAR/outside/victim"
ln -s "$WRITE_REGULAR/outside" "$WRITE_REGULAR/root/linked-dir"
ln -s "$WRITE_REGULAR/outside/victim" "$WRITE_REGULAR/root/linked-file"
WRITE_VICTIM_BEFORE="$(hash_file "$WRITE_REGULAR/outside/victim")"
python3 -I -B - "$HARNESS_DIR/bin" "$WRITE_REGULAR/root" >"$TMP/write-regular.log" 2>&1 <<'PYWR'
import os, sys
sys.path.insert(0, sys.argv.pop(1))
from sh_safe_io import WriteRefused, write_regular
root = sys.argv[1]
refused = 0
for rel in ("linked-dir/new.txt", "linked-file", "linked-dir/deeper/new.txt", "../escape.txt"):
    try:
        write_regular(root, rel, b"must not land\n")
    except WriteRefused:
        refused += 1
write_regular(root, "sub/ok.txt", b"plain write\n")
with open(os.path.join(root, "sub/ok.txt"), "rb") as handle:
    plain = handle.read() == b"plain write\n"
print("REFUSED %d of 4; PLAIN %s" % (refused, plain))
PYWR
assert_contains "$TMP/write-regular.log" 'REFUSED 4 of 4; PLAIN True' 'write_regular refuses every link and unsafe path, and writes a plain path'
if [ "$(hash_file "$WRITE_REGULAR/outside/victim")" = "$WRITE_VICTIM_BEFORE" ] && [ "$(find "$WRITE_REGULAR/outside" -mindepth 1 | wc -l | tr -d ' ')" = 1 ]; then
  pass 'write_regular: the link target directory and file are unchanged'
else
  fail 'write_regular: the link target directory and file are unchanged'
fi

# Shell syntax is part of the brief's required gate.
for script in bin/spec-harness bin/sh-install.sh bin/sh-init.sh; do
  if bash -n "$HARNESS_DIR/$script"; then pass "bash -n $script"; else fail "bash -n $script"; fi
done

if [ "$FAILURES" -eq 0 ]; then
  printf 'RESULT: PASS (all installer fixtures)\n'
  exit 0
fi
printf 'RESULT: FAIL (%s installer fixture checks failed)\n' "$FAILURES"
exit 1
