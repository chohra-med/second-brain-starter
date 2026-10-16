#!/usr/bin/env bash
# The router contract: sdd-router is read-only, runs on the fast tier's smallest model, answers in
# one fixed block, and /sdd dispatches it first with a raise-only, fall-back-on-failure rule.
# An install stages it into the target. Each broken promise fails by name.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
HARNESS_DIR="${SPEC_HARNESS_DIR:-$(cd "$TEST_DIR/.." && pwd -P)}"
CLI="$HARNESS_DIR/bin/spec-harness"
PORTABLE="$TEST_DIR/lib/portable.sh"
# shellcheck source=lib/portable.sh
. "$PORTABLE"
require_tools git grep python3
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sh-router-contract.XXXXXX")" || exit 1
FAILURES=0
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
fail() { printf 'FAIL: %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
pass() { printf 'PASS: %s\n' "$1"; }

ROUTER="$HARNESS_DIR/agents/sdd-router.md"
SDD="$HARNESS_DIR/commands/sdd.md"

# check_router ROUTER_FILE SDD_FILE: prints one FAIL line per broken promise, exit 0 when none.
check_router() {
  python3 -I -B - "$1" "$2" <<'PY'
import re, sys
router_path, sdd_path = sys.argv[1], sys.argv[2]
bad = []
try:
    router = open(router_path, encoding="utf-8").read()
except OSError:
    print("FAIL: agents/sdd-router.md is missing"); sys.exit(1)
sdd = open(sdd_path, encoding="utf-8").read()
fm = re.match(r"---\n(.*?)\n---\n", router, re.S)
if not fm:
    bad.append("router frontmatter is missing")
else:
    meta = dict(l.split(": ", 1) for l in fm.group(1).splitlines() if ": " in l)
    tools = {t.strip() for t in meta.get("tools", "").split(",") if t.strip()}
    if not tools or not tools <= {"Read", "Glob", "Grep"}:
        bad.append(f"router tools must be a subset of Read, Glob, Grep (got {sorted(tools)})")
    fast = next((l for l in sdd.splitlines() if l.startswith("| fast |")), "")
    cells = [c.strip() for c in fast.split("|")]
    claude = cells[3] if len(cells) > 3 else ""
    m = re.search(r";\s*`([^`]+)`[^|]*\bthe router\b", claude)
    if "router" not in (cells[2] if len(cells) > 2 else ""):
        bad.append("the fast row of the Model tiers table does not list the router")
    if not m:
        bad.append("the fast row does not name a small model for the router after a semicolon")
    elif meta.get("model") != m.group(1):
        bad.append(f"router model {meta.get('model')!r} is not the fast row's router model {m.group(1)!r}")
block = re.search(r"```text\n## Route\n(.*?)```", router, re.S)
fields = ["class", "reason", "plan", "build", "test", "verify", "review", "grill-me", "load", "confidence"]
if not block:
    bad.append("router answer block '## Route' is missing")
else:
    got = [l.split(":", 1)[0].strip() for l in block.group(1).splitlines() if ":" in l]
    if got != fields:
        bad.append(f"route fields are {got}, expected {fields}")
for phrase, why in [
    ("never reads source contents", "the router must not read source contents"),
    ("Risk beats size", "risk must beat size"),
    ("pick the bigger class", "uncertainty must pick the bigger class"),
]:
    if phrase.lower() not in router.lower():
        bad.append(f"router file: {why} ({phrase!r} missing)")
sec3 = sdd.split("## 3. Classify", 1)[-1].split("### MICRO light route", 1)[0]
for phrase, why in [
    ("Dispatch `sdd-router`", "/sdd section 3 must dispatch sdd-router first"),
    ("Raise, never lower", "/sdd must only raise the router's class"),
    ("A missing router never stops the run", "/sdd must fall back when the router is unavailable"),
    ("confidence: low", "/sdd must fall back on low confidence"),
]:
    if phrase not in sec3:
        bad.append(f"sdd.md: {why} ({phrase!r} missing)")
for b in bad:
    print("FAIL: " + b)
sys.exit(1 if bad else 0)
PY
}

# 1. The source contract holds.
if out="$(check_router "$ROUTER" "$SDD")"; then pass "router contract holds in the source"; else printf '%s\n' "$out"; fail "router contract in the source"; fi

# 2. The checker can fail: each planted break is caught.
mutate() { # LABEL FILE PYTHON_EXPR(text)->text
  local label="$1" which="$2" expr="$3" r="$TMP/router.md" s="$TMP/sdd.md"
  cp "$ROUTER" "$r"; cp "$SDD" "$s"
  local f="$r"; [ "$which" = sdd ] && f="$s"
  python3 -I -B -c "import sys;p=sys.argv[1];t=open(p).read();open(p,'w').write($expr)" "$f"
  if check_router "$r" "$s" >/dev/null; then fail "planted break not caught: $label"; else pass "planted break caught: $label"; fi
}
mutate "router gains Edit" router 't.replace("tools: Read, Glob, Grep","tools: Read, Glob, Grep, Edit")'
mutate "router model drifts from the table" router 't.replace("model: haiku","model: opus")'
mutate "route block loses a field" router 't.replace("confidence: high | low\n","")'
mutate "sdd stops dispatching the router" sdd 't.replace("Dispatch `sdd-router`","Consider `sdd-router`")'
mutate "sdd allows lowering" sdd 't.replace("Raise, never lower","Raise or lower")'

# 3. An install stages the router into the target.
target="$TMP/target"
mkdir -p "$target" && git -C "$target" init -q
if (cd "$target" && bash "$CLI" init . integrate >/dev/null 2>&1) && [ -f "$target/.claude/agents/sdd-router.md" ] \
  && cmp -s "$ROUTER" "$target/.claude/agents/sdd-router.md"; then
  pass "install stages .claude/agents/sdd-router.md byte-identical"
else
  fail "install did not stage .claude/agents/sdd-router.md byte-identical"
fi

if [ "$FAILURES" -eq 0 ]; then echo "RESULT: PASS (router contract)"; exit 0; fi
echo "RESULT: FAIL ($FAILURES router contract check(s) failed)"; exit 1
