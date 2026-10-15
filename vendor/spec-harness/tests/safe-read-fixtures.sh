#!/usr/bin/env bash
# Bounded safe reads (bin/sh_safe_io.py): links, FIFOs, devices, oversized files and non-object JSON
# are refused with a PENDING-style reason, in the shared helper, in the readiness check and in the
# index. The helper must also load from a packed tarball invoked from another directory.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=lib/portable.sh
. "$ROOT/tests/lib/portable.sh"
require_tools bash npm tar
require_python311
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sh-safe-read.XXXXXX")" || exit 1
trap 'rm -rf "$TMP"' EXIT
failures=0
fail() { printf 'FAIL: %s\n' "$*"; failures=$((failures + 1)); }
pass() { printf 'PASS: %s\n' "$*"; }

# 1. The helper itself.
if python3 -I -B - "$ROOT/bin" "$TMP/unit" <<'PY'
import json, os, sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, sys.argv[1])
import sh_safe_io
from sh_safe_io import SafeReadError, load_json_object, read_bounded, read_bounded_result

root = Path(sys.argv[2]); root.mkdir()
(root / "dir").mkdir()
(root / "dir/file.txt").write_bytes(b"x" * 10)
(root / "outside.txt").write_bytes(b"outside")
(root / "dir/link.txt").symlink_to(root / "outside.txt")
(root / "linkdir").symlink_to(root / "dir", target_is_directory=True)
os.mkfifo(root / "dir/fifo")

def refused(label, call, needle):
    try:
        call()
    except SafeReadError as error:
        assert needle in str(error), (label, str(error))
        print("PASS: helper refuses " + label + " (" + error.reason + ")")
    else:
        raise AssertionError("helper accepted " + label)

assert read_bounded("dir/file.txt", 10, root=str(root)) == b"x" * 10
print("PASS: helper reads a regular file at exactly its byte limit")
refused("a file one byte over its limit", lambda: read_bounded("dir/file.txt", 9, root=str(root)), "exceeds 9-byte read limit")
refused("a symlinked final component", lambda: read_bounded("dir/link.txt", 100, root=str(root)), "not a regular")
refused("a symlinked parent directory", lambda: read_bounded("linkdir/file.txt", 100, root=str(root)), "not a regular")
refused("a FIFO without blocking", lambda: read_bounded("dir/fifo", 100, root=str(root)), "not a regular")
refused("a device", lambda: read_bounded("/dev/null", 100), "not a regular")
refused("a symlink given as a plain path", lambda: read_bounded(str(root / "dir/link.txt"), 100), "not a regular")
assert read_bounded(str(root / "dir/link.txt"), 100, allow_symlink=True) == b"outside"
print("PASS: allow_symlink=True is the only way to read through a link")
refused("a non-normalized relative path", lambda: read_bounded("dir/../outside.txt", 100, root=str(root)), "unsafe")
refused("a missing file", lambda: read_bounded("dir/none", 100, root=str(root)), "missing")
(root / "list.json").write_text("[]")
(root / "bad.json").write_text("{not json")
(root / "obj.json").write_text('{"a": 1}')
assert load_json_object("obj.json", 100, root=str(root)) == {"a": 1}
refused("a JSON array where an object is required", lambda: load_json_object("list.json", 100, root=str(root), what="receipt"), "receipt must be a JSON object")
refused("invalid JSON", lambda: load_json_object("bad.json", 100, root=str(root), what="journal"), "invalid JSON journal")
(root / "deep.json").write_text("[" * 100000 + "]" * 100000)
refused("deeply nested JSON without a traceback", lambda: load_json_object("deep.json", 10 ** 6, root=str(root)), "JSON")
real_read = os.read
changed = []
def mutate(fd, length):
    data = real_read(fd, length)
    if not changed:
        (root / "dir/file.txt").write_bytes(b"y" * 12)
        changed.append(True)
    return data
with patch("sh_safe_io.os.read", mutate):
    data, reason = read_bounded_result("dir/file.txt", 100, root=str(root))
assert data is None and "changed" in reason, (data, reason)
print("PASS: helper notices a file that changes while it is read")

# A regular file swapped for a link after the stat and before the open. The stat check cannot see
# this race, so O_NOFOLLOW on the open is the only guard that refuses the link with its reason.
def race_refused(label, relpath, *, plain=False):
    target = root / relpath
    target.write_bytes(b"regular")
    swapped = []
    real_open = os.open
    def swap_then_open(name, flags, *args, **kwargs):
        if not swapped and os.fspath(name).endswith(target.name):
            target.unlink()
            os.symlink(root / "outside.txt", target)
            swapped.append(True)
        return real_open(name, flags, *args, **kwargs)
    with patch("sh_safe_io.os.open", swap_then_open):
        if plain:
            data, reason = read_bounded_result(str(target), 100)
        else:
            data, reason = read_bounded_result(relpath, 100, root=str(root))
    assert swapped and data is None and reason == "not a regular in-root file", (label, data, reason)
    print("PASS: " + label)

race_refused("a link swapped in after the stat is refused by O_NOFOLLOW (in-root read)", "dir/race-root.txt")
race_refused("a link swapped in after the stat is refused by O_NOFOLLOW (plain path read)", "dir/race-plain.txt", plain=True)

# A DIRECTORY on the path swapped for a link to a directory outside the root, after its stat and
# before its open. O_NOFOLLOW on the directory open is what refuses it with the in-root reason. Without
# it the open follows the link and reads outside bytes, and only the later identity check refuses,
# with a different reason.
def dir_race_refused(label):
    base = root / "racedir"
    base.mkdir()
    (base / "leaf.txt").write_bytes(b"regular")
    outside_dir = root / "outdir"
    outside_dir.mkdir()
    (outside_dir / "leaf.txt").write_bytes(b"outside")
    swapped = []
    real_open = os.open
    def swap_then_open(name, flags, *args, **kwargs):
        if not swapped and os.fspath(name) == "racedir":
            os.rename(base, root / "racedir-away")
            os.symlink(outside_dir, base, target_is_directory=True)
            swapped.append(True)
        return real_open(name, flags, *args, **kwargs)
    with patch("sh_safe_io.os.open", swap_then_open):
        data, reason = read_bounded_result("racedir/leaf.txt", 100, root=str(root))
    assert swapped and data is None and reason == "not a regular in-root file", (label, data, reason)
    print("PASS: " + label)

dir_race_refused("a directory swapped for a link after its stat is refused by O_NOFOLLOW on the directory open")
PY
then pass 'shared helper contract'; else fail 'shared helper contract'; fi

# The helper's docstring names only callers that exist on this branch (run-state arrives in a later PR).
if grep -q 'run-state' "$ROOT/bin/sh_safe_io.py"; then
  fail "bin/sh_safe_io.py docstring names a later caller: $(grep -n 'run-state' "$ROOT/bin/sh_safe_io.py")"
else
  pass 'bin/sh_safe_io.py docstring names no later-PR caller'
fi

# 2. The readiness check reads its receipt through the helper.
check() { bash "$ROOT/bin/spec-harness" generate-agents --check "$1" 2>&1; }
t="$TMP/check"; mkdir -p "$t/real-claude/agents" "$t/.claude"
printf '{"format":"spec-harness-synthesis"}\n' > "$t/real-claude/agents/.init-synthesis.json"
rmdir "$t/.claude"; ln -s real-claude "$t/.claude"
out="$(check "$t")"; rc=$?
if [[ $rc -eq 1 && "$out" == *"PENDING: missing or unsafe synthesis receipt"* ]]; then pass 'check refuses a receipt under a symlinked .claude/ (in-root link)'; else fail "symlinked .claude/ read (rc=$rc): $out"; fi
rm "$t/.claude"; mkdir -p "$t/.claude/agents"
printf '{"format":"spec-harness-synthesis"}\n' > "$t/outside-receipt.json"
ln -s ../../outside-receipt.json "$t/.claude/agents/.init-synthesis.json"
out="$(check "$t")"; rc=$?
if [[ $rc -eq 1 && "$out" == *"PENDING: missing or unsafe synthesis receipt"* ]]; then pass 'check refuses a symlinked receipt'; else fail "symlinked receipt read (rc=$rc): $out"; fi
rm "$t/.claude/agents/.init-synthesis.json"; mkfifo "$t/.claude/agents/.init-synthesis.json"
out="$(check "$t")"; rc=$?
if [[ $rc -eq 1 && "$out" == *"PENDING: missing or unsafe synthesis receipt"* ]]; then pass 'check refuses a FIFO receipt without blocking'; else fail "FIFO receipt (rc=$rc): $out"; fi
rm "$t/.claude/agents/.init-synthesis.json"
python3 -I -B -c 'import json,sys; open(sys.argv[1],"w").write(json.dumps({"format":"spec-harness-synthesis","padding":"x"*(1024*1024)}))' "$t/.claude/agents/.init-synthesis.json"
out="$(check "$t")"; rc=$?
if [[ $rc -eq 1 && "$out" == *"read limit"* ]]; then pass 'check refuses a receipt over 1 MiB'; else fail "oversized receipt (rc=$rc): $out"; fi
printf '[]\n' > "$t/.claude/agents/.init-synthesis.json"
out="$(check "$t")"; rc=$?
if [[ $rc -eq 1 && "$out" == *"must be a JSON object"* && "$out" != *Traceback* ]]; then pass 'check reports a non-object receipt as PENDING without a traceback'; else fail "non-object receipt (rc=$rc): $out"; fi

# 3. The index refuses to read through links and does not block on a FIFO in the tree.
t="$TMP/index"; mkdir -p "$t/src"
printf '{"name":"fifo-fixture"}\n' > "$t/package.json"
printf 'export const a = 1;\n' > "$t/src/index.ts"
mkfifo "$t/src/pipe.ts"
printf '# outside rules\n' > "$TMP/outside-rules.md"
ln -s "$TMP/outside-rules.md" "$t/RULES.md"
out="$(bash "$ROOT/bin/spec-harness" index "$t" 2>&1)"; rc=$?
if [[ $rc -eq 0 ]] && grep -q 'src/pipe.ts' "$t/ai_rules/context_map.md" && grep -q '`RULES.md`: symbolic link' "$t/ai_rules/context_map.md"; then
  pass 'index excludes a FIFO and a symlinked rules file without reading them'
else
  fail "index FIFO/symlink handling (rc=$rc): $out"
fi
# The context map is generated text: it carries no em dash (U+2014). rc 1 is "no match"; a missing file fails.
cm="$t/ai_rules/context_map.md"
em_rc=0; grep -q $'\xe2\x80\x94' "$cm" || em_rc=$?
if [[ -f "$cm" && "$em_rc" -eq 1 ]]; then pass 'index writes ai_rules/context_map.md without an em dash'
else fail "context map has an em dash or is missing (rc=$em_rc): $(grep -n $'\xe2\x80\x94' "$cm" 2>/dev/null)"; fi

# 4. A packed tarball, invoked from another directory, imports the helper next to its scripts.
pack="$TMP/pack"; mkdir -p "$pack"
if (cd "$ROOT" && npm_config_cache="$TMP/npm-cache" npm pack --ignore-scripts --pack-destination "$pack" >"$TMP/pack.log" 2>&1); then
  archive="$(find "$pack" -maxdepth 1 -name '*.tgz' -print -quit)"
  # Capture the listing first: with pipefail, grep -q exiting early makes GNU tar die of SIGPIPE and the pipeline fail.
  listing="$(tar -tzf "$archive")"
  if grep -q '^package/bin/sh_safe_io\.py$' <<<"$listing"; then pass 'packed tarball ships bin/sh_safe_io.py'; else fail 'packed tarball omits bin/sh_safe_io.py'; fi
  if grep -q '__pycache__' <<<"$listing"; then fail 'packed tarball contains __pycache__'; else pass 'packed tarball has no __pycache__'; fi
  mkdir -p "$TMP/unpacked" "$TMP/elsewhere"
  tar -xzf "$archive" -C "$TMP/unpacked"
  t="$TMP/packed-target"; mkdir -p "$t/src" "$t/.claude/agents"
  printf '{"name":"packed"}\n' > "$t/package.json"; printf 'export const p = 1;\n' > "$t/src/index.ts"
  out="$(cd "$TMP/elsewhere" && bash "$TMP/unpacked/package/bin/spec-harness" index "$t" 2>&1 && printf '[]\n' > "$t/.claude/agents/.init-synthesis.json" && bash "$TMP/unpacked/package/bin/spec-harness" generate-agents --check "$t" 2>&1)"; rc=$?
  if [[ $rc -eq 1 && "$out" == *"Wrote: ai_rules/context_map.md"* && "$out" == *"must be a JSON object"* && "$out" != *ModuleNotFoundError* ]]; then
    pass 'packed CLI from another cwd imports sh_safe_io for index and --check'
  else
    fail "packed CLI import (rc=$rc): $out"
  fi
  if find "$TMP/unpacked/package/bin" -name '__pycache__' | grep -q .; then fail 'packed run wrote __pycache__ into bin/'; else pass 'packed run writes no bytecode into bin/'; fi
else
  fail "npm pack failed: $(cat "$TMP/pack.log")"
fi

if [[ "$failures" -gt 0 ]]; then printf 'RED: %s safe-read check(s) failed\n' "$failures"; exit 1; fi
printf 'GREEN: bounded safe reads\n'
