#!/usr/bin/env bash
# Runs every contract test in tests/*.sh (not tests/tools/) and exits 1 if any of them fails.
# Each test's output goes to a log in ${TMPDIR:-/tmp}, as the README describes. `npm test` calls this.
# A SKIP line means a check did not run. It is never counted as a pass: the summary names it, and
# with SPEC_HARNESS_STRICT_SKIP=1 (set in CI) any SKIP fails the run.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
LOG_DIR="${TMPDIR:-/tmp}"
failed=0
ran=0
skips=0
skip_report=""

cd "$ROOT" || exit 1
for test in tests/*.sh; do
  [ "$test" = tests/run-all.sh ] && continue
  ran=$((ran + 1))
  log="$LOG_DIR/sh-$(basename "$test").log"
  bash "$test" > "$log" 2>&1
  code=$?
  echo "exit $code $test"
  [ "$code" -eq 0 ] || failed=$((failed + 1))
  # A SKIP means a check did not run. It is reported after the run as a non-pass.
  while IFS= read -r line; do
    case "$line" in
      SKIP*) skips=$((skips + 1)); skip_report="$skip_report  $test: $line"$'\n' ;;
    esac
  done < "$log"
done

# The shipped bin/ must stay free of Python bytecode; npm pack would include it.
if [ -n "$(find bin -name __pycache__ -o -name '*.pyc' 2>/dev/null | head -n 1)" ]; then
  echo "run-all: Python bytecode appeared under bin/; a test or script ran Python without -B" >&2
  failed=$((failed + 1))
fi

if [ "$ran" -eq 0 ]; then
  echo "run-all: no tests found under tests/*.sh" >&2
  exit 1
fi
if [ "$skips" -gt 0 ]; then
  echo "run-all: NOT RUN: $skips skipped check(s); a skipped check is not a pass:"
  printf '%s' "$skip_report"
fi
if [ "$failed" -gt 0 ]; then
  echo "run-all: $failed of $ran tests failed; $((ran - failed)) passed; $skips check(s) skipped; logs in $LOG_DIR" >&2
  exit 1
fi
if [ "$skips" -gt 0 ] && [ "${SPEC_HARNESS_STRICT_SKIP:-0}" = 1 ]; then
  echo "run-all: SPEC_HARNESS_STRICT_SKIP=1 and $skips check(s) skipped; failing the run" >&2
  exit 1
fi
if [ "$skips" -gt 0 ]; then
  echo "run-all: $((ran - failed)) of $ran tests exited 0; $skips check(s) skipped and NOT passed (set SPEC_HARNESS_STRICT_SKIP=1 to fail on skips)"
else
  echo "run-all: $((ran - failed)) of $ran tests passed; no check skipped"
fi
