#!/usr/bin/env bash
# examples/react-ts-minimal (a synthetic project with one unusual planted convention) runs through
# init -> index -> generate-agents --check on a copy, and the check reports PENDING because no
# synthesis receipt exists yet. The example directory itself is never written to.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=lib/portable.sh
. "$ROOT/tests/lib/portable.sh"
require_tools bash git
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sh-examples.XXXXXX")" || exit 1
trap 'rm -rf "$TMP"' EXIT
failures=0
fail() { printf 'FAIL: %s\n' "$*"; failures=$((failures + 1)); }
pass() { printf 'PASS: %s\n' "$*"; }

app="$TMP/react-ts-minimal"
cp -R "$ROOT/examples/react-ts-minimal" "$app"
git init -q "$app" && git -C "$app" add -A && git -C "$app" -c user.email=smoke@example.invalid -c user.name=smoke commit -qm 'example snapshot'

export PATH="$ROOT/bin:$PATH"
before="$(git -C "$ROOT/examples/react-ts-minimal" status --porcelain --ignored | wc -l | tr -d ' ')"

out="$(spec-harness index "$app" 2>&1)"; rc=$?
if [[ $rc -eq 0 && "$out" == *"Indexed 1 package boundary"* && "$out" == *"ai_rules/context_map.md"* ]]; then
  pass 'index reads the example and writes its context map'
else
  fail "index (rc=$rc): $out"
fi

out="$(spec-harness generate-agents --check "$app" 2>&1)"; rc=$?
if [[ $rc -eq 1 && "$out" == *"PENDING: missing or unsafe synthesis receipt"* ]]; then
  pass 'generate-agents --check reports PENDING before synthesis'
else
  fail "generate-agents --check (rc=$rc): $out"
fi

if grep -q 'Money is stored as an integer' "$app/CONVENTIONS.md"; then
  pass 'the planted convention is present in the copy'
else
  fail 'the planted convention is missing from the copy'
fi

after="$(git -C "$ROOT/examples/react-ts-minimal" status --porcelain --ignored | wc -l | tr -d ' ')"
if [[ "$before" == "$after" && ! -e "$ROOT/examples/react-ts-minimal/ai_rules" ]]; then
  pass 'the example directory is not written to'
else
  fail 'the example directory changed during the smoke run'
fi

if [[ "$failures" -gt 0 ]]; then printf 'RED: %s example check(s) failed\n' "$failures"; exit 1; fi
printf 'GREEN: examples smoke\n'
