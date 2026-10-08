#!/usr/bin/env bash
# Disposable acceptance fixtures for the portable installer. No fixture writes outside TMPDIR.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
HARNESS_DIR="${SPEC_HARNESS_DIR:-$(cd "$TEST_DIR/.." && pwd -P)}"
CLI="$HARNESS_DIR/bin/spec-harness"
INIT="$HARNESS_DIR/bin/sh-init.sh"
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

hash_file() { shasum -a 256 "$1" | awk '{print $1}'; }

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
