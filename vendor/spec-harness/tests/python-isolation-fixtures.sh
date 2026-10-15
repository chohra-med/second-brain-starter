#!/usr/bin/env bash
# Every Python program the CLI runs must be isolated (python3 -I): a hashlib.py or json.py planted in
# the target or the current directory must not replace the standard library. An interpreter older
# than 3.11 must get a clear "requires Python 3.11+" message, never a SyntaxError.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=lib/portable.sh
. "$ROOT/tests/lib/portable.sh"
require_tools bash git
require_python311
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sh-python-isolation.XXXXXX")" || exit 1
trap 'rm -rf "$TMP"' EXIT
CLI="$ROOT/bin/spec-harness"
failures=0
fail() { printf 'FAIL: %s\n' "$*"; failures=$((failures + 1)); }
pass() { printf 'PASS: %s\n' "$*"; }

plant() {
  # A planted module that, if imported, exits 0 at once and leaves a sentinel behind.
  local dir=$1 name
  for name in hashlib json; do
    printf 'import os, sys\nopen(os.path.join(%s, "HIJACKED-%s"), "w").close()\nsys.exit(0)\n' "'$dir'" "$name" > "$dir/$name.py"
  done
}
hijacked() { compgen -G "$1/HIJACKED-*" >/dev/null; }

target="$TMP/target"
mkdir -p "$target/src"
printf '{"name":"isolation-fixture","dependencies":{"react":"18.0.0"}}\n' > "$target/package.json"
printf 'export const value = 1;\n' > "$target/src/index.ts"
plant "$target"

# index from inside the target: before the fix the planted hashlib.py ran and the command exited 0
# without writing an inventory.
out="$(cd "$target" && bash "$CLI" index . 2>&1)"; rc=$?
if [[ "$rc" -eq 0 ]] && [[ -f "$target/ai_rules/context_map.md" ]] && ! hijacked "$target"; then
  pass 'index ignores a planted hashlib.py/json.py in the target and current directory'
else
  fail "index was hijacked or failed (rc=$rc, sentinel=$(ls "$target" | grep -c HIJACKED)): $out"
fi
rm -f "$target"/HIJACKED-*

# --check from inside the target: a hijacked check would exit 0 (READY-looking) with no receipt.
out="$(cd "$target" && bash "$CLI" generate-agents --check . 2>&1)"; rc=$?
if [[ "$rc" -eq 1 ]] && [[ "$out" == *"PENDING: missing or unsafe synthesis receipt"* ]] && ! hijacked "$target"; then
  pass 'generate-agents --check stays PENDING (exit 1) with planted modules'
else
  fail "--check was hijacked (rc=$rc): $out"
fi
rm -f "$target"/HIJACKED-*

# The work-order writer is the third Python program.
out="$(cd "$target" && bash "$CLI" generate-agents . 2>&1)"; rc=$?
if [[ "$rc" -eq 0 ]] && grep -q 'spec-harness-work-order:v1' "$target/.claude/agents/.generate-agents.prompt.md" && ! hijacked "$target"; then
  pass 'generate-agents work order is written by an isolated interpreter'
else
  fail "work order was hijacked (rc=$rc): $out"
fi
rm -f "$target"/HIJACKED-*

# doctor and finalize-init are Python scripts run with -I -B: a hijack would print nothing and exit 0.
out="$(cd "$target" && bash "$CLI" doctor . 2>&1)"; rc=$?
if [[ "$rc" -eq 1 && "$out" == *'"structural": "PENDING"'* ]] && ! hijacked "$target"; then
  pass 'doctor reports PENDING (exit 1) with planted modules'
else
  fail "doctor was hijacked (rc=$rc): $out"
fi
rm -f "$target"/HIJACKED-*
out="$(cd "$target" && bash "$CLI" finalize-init . 2>&1)"; rc=$?
if [[ "$rc" -eq 1 && "$out" == *"PENDING:"* ]] && ! hijacked "$target"; then
  pass 'finalize-init stays PENDING (exit 1) with planted modules'
else
  fail "finalize-init was hijacked (rc=$rc): $out"
fi
rm -f "$target"/HIJACKED-*

# PYTHONPATH must not reach the programs either.
out="$(cd "$TMP" && PYTHONPATH="$target" bash "$CLI" index "$target" 2>&1)"; rc=$?
if [[ "$rc" -eq 0 ]] && ! hijacked "$target"; then pass 'PYTHONPATH does not reach the index program'; else fail "PYTHONPATH hijack (rc=$rc): $out"; fi
rm -f "$target"/HIJACKED-*

# Static guard: every python3 call in bin/ is isolated.
unisolated="$(grep -nE '(^|[^A-Za-z0-9_-])python3( |$)' "$ROOT"/bin/*.sh "$ROOT"/bin/spec-harness | grep -vE 'python3 -I|command -v python3|python3 >= |Python 3|python3 and retry|newer python3' || true)"
if [[ -z "$unisolated" ]]; then pass 'every python3 invocation in bin/ uses -I'; else fail "python3 without -I in bin/: $unisolated"; fi

# Version guard with a stub interpreter that reports 3.9 and, like a real old parser, fails with a
# SyntaxError if the program is ever handed to it.
stub="$TMP/old-python"
mkdir -p "$stub"
cat > "$stub/python3" <<'STUB'
#!/usr/bin/env bash
for arg in "$@"; do
  case "$arg" in
    *version_info*) exit 1 ;;
    *python_version*) echo 3.9.0; exit 0 ;;
  esac
done
echo 'SyntaxError: stub interpreter received a program it cannot parse' >&2
exit 1
STUB
chmod +x "$stub/python3"
for route in "index $target" "generate-agents --check $target" "generate-agents $target" "doctor $target" "finalize-init $target"; do
  # shellcheck disable=SC2086
  out="$(PATH="$stub:$PATH" bash "$CLI" $route 2>&1)"; rc=$?
  if [[ "$rc" -eq 2 && "$out" == *"requires Python 3.11+ (found 3.9.0)"* && "$out" != *SyntaxError* ]]; then
    pass "old interpreter gets a clear version message: $route"
  else
    fail "old interpreter on '$route' (rc=$rc): $out"
  fi
done

# When the machine has a real interpreter older than 3.11, run it too.
for candidate in /usr/bin/python3 /usr/local/bin/python3.9 /usr/bin/python3.9 /usr/bin/python3.10; do
  [[ -x "$candidate" ]] || continue
  if "$candidate" -I -c 'import sys; sys.exit(0 if sys.version_info < (3, 11) else 1)' 2>/dev/null; then
    real="$TMP/real-old"; mkdir -p "$real"; ln -sf "$candidate" "$real/python3"
    out="$(PATH="$real:$PATH" bash "$CLI" index "$target" 2>&1)"; rc=$?
    if [[ "$rc" -eq 2 && "$out" == *"requires Python 3.11+"* && "$out" != *SyntaxError* ]]; then
      pass "real $("$candidate" -I -c 'import platform; print(platform.python_version())') gets the version message, not a SyntaxError"
    else
      fail "real old interpreter $candidate (rc=$rc): $out"
    fi
    break
  fi
done

# Every python3 program a shipped script runs carries -I (isolation) and -B (no bytecode written into the
# install tree). `command -v python3` is a lookup, not a run, so it is not matched. Output is file:line.
py_offenders=""
for f in "$ROOT"/bin/*.sh "$ROOT/bin/spec-harness"; do
  while IFS= read -r hit; do
    flags="$(printf '%s\n' "${hit#*:}" | grep -oE 'python3( +-[A-Za-z]+)+' | head -n 1)"
    ok=0
    case " $flags " in *" -I "*) case " $flags " in *" -B "*) ok=1 ;; esac ;; esac
    [[ "$ok" -eq 1 ]] || py_offenders="$py_offenders ${f#"$ROOT"/}:${hit%%:*}"
  done < <(grep -nE 'python3 +-' "$f")
done
if [[ -z "$py_offenders" ]]; then
  pass 'every python3 program in bin/*.sh and bin/spec-harness carries -I and -B'
else
  fail "python3 program without -I -B:$py_offenders"
fi

# Every test file runs its own Python programs (this file and run-all hold none); each carries -I -B like the shipped ones.
# (`python3 -m ...` inside a quoted string is data, not a run; only a leading `python3 -I`-style flag run is matched.)
pc_offenders=""
for tfp in "$ROOT"/tests/*.sh; do
  tf="$(basename "$tfp" .sh)"
  case "$tf" in run-all|python-isolation-fixtures) continue ;; esac
  while IFS= read -r hit; do
    flags="$(printf '%s\n' "${hit#*:}" | grep -oE 'python3( +-[A-Za-z]+)+' | head -n 1)"
    [[ " $flags " == *" -I "* && " $flags " == *" -B "* ]] || pc_offenders="$pc_offenders tests/$tf.sh:${hit%%:*}"
  done < <(grep -nE 'python3 +-([^m]|$)' "$ROOT/tests/$tf.sh")
done
if [[ -z "$pc_offenders" ]]; then
  pass 'every python3 program in the test files carries -I and -B'
else
  fail "python3 program without -I -B:$pc_offenders"
fi

# The GETTING-STARTED rows that state the Python 3.11 requirement must name every command that refuses an
# older interpreter (the dispatcher's require_python and the scripts' own version checks).
gs="$ROOT/docs/GETTING-STARTED.md"
prereq_row="$(grep -F '| Python 3.11 or newer |' "$gs" || true)"
exit_row="$(grep -F 'also exit 2 on Python older than 3.11' "$gs" || true)"
doc_missing=""
for cmd in index doctor finalize-init generate-agents; do
  [[ "$prereq_row" == *"\`$cmd\`"* ]] || doc_missing="$doc_missing prerequisite:$cmd"
  [[ "$exit_row" == *"\`$cmd\`"* ]] || doc_missing="$doc_missing exit-2:$cmd"
done
if [[ -n "$prereq_row" && -n "$exit_row" && -z "$doc_missing" ]]; then
  pass 'GETTING-STARTED names every command that refuses Python older than 3.11'
else
  fail "GETTING-STARTED Python 3.11 rows omit:${doc_missing:- (row not found)}"
fi

if [[ "$failures" -gt 0 ]]; then printf 'RED: %s python isolation check(s) failed\n' "$failures"; exit 1; fi
printf 'GREEN: python isolation and version guard\n'
