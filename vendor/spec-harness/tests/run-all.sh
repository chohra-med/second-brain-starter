#!/usr/bin/env bash
# Runs every contract test in tests/*.sh (not tests/tools/) and exits 1 if any of them fails.
# Each test's output goes to a log in ${TMPDIR:-/tmp}, as the README describes. `npm test` calls this.
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
  # A SKIP means a check did not run. It is reported after the run, never counted as a failure.
  while IFS= read -r line; do
    case "$line" in
      SKIP*) skips=$((skips + 1)); skip_report="$skip_report  $test: $line"$'\n' ;;
    esac
  done < "$log"
done

if [ "$ran" -eq 0 ]; then
  echo "run-all: no tests found under tests/*.sh" >&2
  exit 1
fi
if [ "$skips" -gt 0 ]; then
  echo "run-all: SKIP lines seen ($skips):"
  printf '%s' "$skip_report"
fi
if [ "$failed" -gt 0 ]; then
  echo "run-all: $failed of $ran tests failed; $((ran - failed)) passed; $skips SKIP line(s) seen; logs in $LOG_DIR" >&2
  exit 1
fi
echo "run-all: $((ran - failed)) of $ran tests passed; $skips SKIP line(s) seen (a SKIP does not fail the run)"
