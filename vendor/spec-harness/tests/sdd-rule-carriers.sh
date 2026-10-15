#!/usr/bin/env bash
# The "/sdd first for code tickets" rule is one sentence block. It must be byte-identical in every
# carrier an agent loads before it edits a target, and in the files an install writes into a target.
# A carrier that drops it fails this test by name.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
HARNESS_DIR="${SPEC_HARNESS_DIR:-$(cd "$TEST_DIR/.." && pwd -P)}"
CLI="$HARNESS_DIR/bin/spec-harness"
PORTABLE="$TEST_DIR/lib/portable.sh"
# shellcheck source=lib/portable.sh
. "$PORTABLE"
require_tools git grep
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sh-sdd-rule-carriers.XXXXXX")" || exit 1
FAILURES=0

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1"
  FAILURES=$((FAILURES + 1))
}

RULE='A code ticket is any change to a tracked file outside `specs/` and `.memory/`. It goes through `/sdd` before the first source edit, even when it looks small: the light route is still `/sdd`. Keep the ticket'"'"'s code inside this repository: no worktree, clone or copy elsewhere unless the user asks for one.'

# check_carrier LABEL FILE: the rule must be a substring of one line of FILE. A missing file is a
# failure with its own message, never a silent pass.
check_carrier() {
  local label="$1" file="$2" rc=0
  if [ ! -f "$file" ]; then
    fail "$label: file not found: $file"
    return
  fi
  grep -Fq -- "$RULE" "$file" || rc=$?
  if [ "$rc" -eq 0 ]; then
    printf 'PASS: %s carries the rule\n' "$label"
  elif [ "$rc" -eq 1 ]; then
    fail "$label does not carry the exact /sdd-first rule sentence block: $file"
  else
    fail "grep failed reading $file"
  fi
}

# Source carriers: the files a human or agent reads in this repository.
check_carrier "templates/CLAUDE.md (auto-loaded entry point)" "$HARNESS_DIR/templates/CLAUDE.md"
check_carrier "templates/AGENTS.md (ratchet and hard constraints)" "$HARNESS_DIR/templates/AGENTS.md"
check_carrier "templates/install/SPEC-HARNESS.md (startup step 1, SDD entry)" "$HARNESS_DIR/templates/install/SPEC-HARNESS.md"
check_carrier "skills/spec-harness/SKILL.md (orchestrator skill)" "$HARNESS_DIR/skills/spec-harness/SKILL.md"
check_carrier "docs/GETTING-STARTED.md (step 3 block pasted into an existing CLAUDE.md or AGENTS.md)" "$HARNESS_DIR/docs/GETTING-STARTED.md"

# Installed carriers: what an install writes into an empty target.
target="$TMP/target"
mkdir -p "$target"
git -C "$target" init -q || { echo "FAIL: git init failed in $target" >&2; exit 1; }
install_log="$TMP/init.log"
(cd "$target" && "$CLI" init . integrate) >"$install_log" 2>&1 || {
  echo "FAIL: spec-harness init failed; log:" >&2
  cat "$install_log" >&2
  exit 1
}
check_carrier "installed CLAUDE.md" "$target/CLAUDE.md"
check_carrier "installed AGENTS.md" "$target/AGENTS.md"
check_carrier "installed SPEC-HARNESS.md" "$target/SPEC-HARNESS.md"
check_carrier "installed .claude/skills/spec-harness/SKILL.md" "$target/.claude/skills/spec-harness/SKILL.md"

if [ "$FAILURES" -gt 0 ]; then
  printf 'sdd-rule-carriers: %s check(s) failed\n' "$FAILURES"
  exit 1
fi
echo 'PASS: the /sdd-first rule sentence block is byte-identical in every source and installed carrier'
