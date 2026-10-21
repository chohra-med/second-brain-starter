#!/usr/bin/env bash
# Receipt-owned generated rule files (package RULES.md routers and ai_rules/rules/*.md modules) stay
# out of the inventory's hashes while their bytes equal the receipt, so refreshing their inventory
# marker does not change the inventory (no refresh cycle). Root and nested packages, a large receipt,
# malformed receipts, links, missing and oversized outputs, and one read per file are covered.
# The stability oracle is also run against two planted regressions of bin/sh-index.sh (ownership
# disabled; a size-only leak) and must fail at the named assertion for each.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=lib/portable.sh
. "$ROOT/tests/lib/portable.sh"
require_tools bash
require_python311
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sh-receipt-index.XXXXXX")" || exit 1
trap 'rm -rf "$TMP"' EXIT

ORACLE="$TMP/oracle.py"
cat > "$ORACLE" <<'PY'
import hashlib, json, os, shutil, subprocess, sys
from pathlib import Path

harness = Path(sys.argv[1])
base = Path(sys.argv[2])
mode = sys.argv[3]
sha = lambda data: hashlib.sha256(data).hexdigest()


class Named(AssertionError):
    pass


def require(condition, name, detail=""):
    if not condition:
        raise Named(f"ASSERTION {name} failed {detail}")


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data if isinstance(data, bytes) else data.encode())


def index(root):
    return subprocess.run(["bash", str(harness / "bin/sh-index.sh"), str(root)], capture_output=True, text=True)


def receipt_file(root):
    return root / ".claude/agents/.init-synthesis.json"


def fixture(root, packages, padding=0):
    write(root / "package.json", '{"name":"fixture"}\n')
    write(root / "ai_rules/context_map.md", "# Custom map\n")
    rows = []
    for package in packages:
        prefix = "" if package == "." else package + "/"
        write(root / (prefix + "package.json"), '{"name":"package"}\n')
        write(root / (prefix + "src/index.ts"), "export const fixture = true;\n")
        router, module = prefix + "RULES.md", prefix + "ai_rules/rules/coding.md"
        write(root / router, "# Generated router\n")
        write(root / module, "# Coding\n<!-- source-bound: inventory-sha256=" + "a" * 64 + " -->\n")
        rows.append({"path": package, "rules_path": router, "sha256": sha((root / router).read_bytes()),
                     "rule_modules": [{"name": "coding", "path": module, "sha256": sha((root / module).read_bytes())}]})
    receipt = {"format": "spec-harness-synthesis", "schema_version": 2, "packages": rows, "padding": "x" * padding}
    write(receipt_file(root), json.dumps(receipt))
    return receipt


def snapshot(path, into):
    """An independent, immutable copy: bytes on disk in another file plus its own hash."""
    shutil.copyfile(path, into)
    data = Path(into).read_bytes()
    return sha(data), into


def stability(name, packages, padding):
    root = base / f"{mode}-{name}"
    receipt = fixture(root, packages, padding)
    first = index(root)
    require(first.returncode == 0, "first-index-exit", first.stderr)
    inventory = root / "ai_rules/project_inventory.json"
    before_hash, before_copy = snapshot(inventory, base / f"{mode}-{name}.before.json")
    rows = {row["path"]: row for row in json.loads(Path(before_copy).read_text())["rule_files"]}
    for row in receipt["packages"]:
        for path in (row["rules_path"], row["rule_modules"][0]["path"]):
            require(rows[path].get("ownership") == "receipt-generated", "owned-row-marked", path)
            require("sha256" not in rows[path], "owned-row-has-no-hash", path)
            require("bytes" not in rows[path], "owned-row-has-no-size", path)
    # Refresh: each module's marker takes the new inventory hash (and its size changes); the receipt
    # records the new module hashes. The inventory must not move.
    for row in receipt["packages"]:
        module = row["rule_modules"][0]
        path = root / module["path"]
        write(path, path.read_text().replace("a" * 64, before_hash) + "refreshed binding, different size\n")
        module["sha256"] = sha(path.read_bytes())
    write(receipt_file(root), json.dumps(receipt))
    second = index(root)
    require(second.returncode == 0, "refresh-index-exit", second.stderr)
    after_hash, after_copy = snapshot(inventory, base / f"{mode}-{name}.after.json")
    require(after_hash == before_hash and Path(after_copy).read_bytes() == Path(before_copy).read_bytes(),
            "refresh-is-a-fixed-point", name)
    # A human edit to an owned file is no longer receipt-owned: it must show up, hashed.
    module = root / receipt["packages"][0]["rule_modules"][0]["path"]
    write(module, module.read_text() + "human edit\n")
    third = index(root)
    require(third.returncode == 0, "edited-index-exit", third.stderr)
    edited_hash, edited_copy = snapshot(inventory, base / f"{mode}-{name}.edited.json")
    require(edited_hash != before_hash, "human-edit-visible", name)
    row = next(x for x in json.loads(Path(edited_copy).read_text())["rule_files"] if x["path"] == module.relative_to(root).as_posix())
    require(row.get("sha256") == sha(module.read_bytes()) and "ownership" not in row, "human-edit-hashed", name)
    print(f"PASS: {name}: refresh is a fixed point across independent snapshots; a human edit is hashed")


if mode in {"real", "mutant"}:
    try:
        stability("root", ["."], 0)
        stability("nested", ["apps/web", "services/api"], 0)
        stability("large-receipt", ["."], 270 * 1024)
    except Named as error:
        print(str(error))
        sys.exit(3)
    sys.exit(0)

# mode == "controls": malformed receipts, links, missing and oversized outputs.
root = base / "invalid"
receipt = fixture(root, ["."])
assert index(root).returncode == 0
inventory = root / "ai_rules/project_inventory.json"
before = inventory.read_bytes()
bad = [[], None, 1, "value", {}, dict(receipt, schema_version=True), dict(receipt, schema_version=5),
       dict(receipt, packages={}), dict(receipt, packages=[[]]),
       dict(receipt, packages=[dict(receipt["packages"][0], path="../escape")]),
       dict(receipt, packages=[dict(receipt["packages"][0], rules_path="other/RULES.md")]),
       dict(receipt, packages=[dict(receipt["packages"][0], rule_modules=[{}])]),
       dict(receipt, packages=[dict(receipt["packages"][0], rule_modules=[{"path": "src/x.md", "sha256": "0" * 64}])])]
for value in bad:
    write(receipt_file(root), json.dumps(value))
    result = index(root)
    assert result.returncode != 0 and "PENDING:" in result.stderr and "Traceback" not in result.stderr, (value, result.stderr)
    assert inventory.read_bytes() == before, "a rejected receipt replaced the inventory"
write(receipt_file(root), "not json")
result = index(root)
assert result.returncode != 0 and "PENDING:" in result.stderr and inventory.read_bytes() == before
print("PASS: malformed receipt types, schema, rows and paths preserve the inventory without a traceback")

limit = 1024 * 1024
for size in (limit - 1, limit, limit + 1):
    value = dict(receipt, padding="")
    value["padding"] = "x" * (size - len(json.dumps(value).encode()))
    write(receipt_file(root), json.dumps(value))
    assert receipt_file(root).stat().st_size == size
    result = index(root)
    if size <= limit:
        assert result.returncode == 0, result.stderr
    else:
        assert result.returncode != 0 and "read limit" in result.stderr and inventory.read_bytes() == before, result.stderr
print("PASS: receipt below, at and above the 1 MiB budget")
write(receipt_file(root), json.dumps(receipt))
assert index(root).returncode == 0
before = inventory.read_bytes()

module = root / "ai_rules/rules/coding.md"
module.unlink()
write(base / "outside.md", "outside sentinel")
module.symlink_to(base / "outside.md")
result = index(root)
assert result.returncode != 0 and "PENDING:" in result.stderr and inventory.read_bytes() == before, result.stderr
module.unlink()
write(module, "# restored\n")
parent = root / "ai_rules/rules"
parent.rename(root / "ai_rules/saved-rules")
parent.symlink_to(root / "ai_rules/saved-rules", target_is_directory=True)
result = index(root)
assert result.returncode != 0 and inventory.read_bytes() == before, result.stderr
parent.unlink()
(root / "ai_rules/saved-rules").rename(parent)
print("PASS: a symlinked registered output and a symlinked parent directory are refused before writing")
write(module, "x" * (256 * 1024 + 1))
result = index(root)
assert result.returncode != 0 and "read limit" in result.stderr and inventory.read_bytes() == before, result.stderr
module.unlink()
result = index(root)
assert result.returncode != 0 and "missing" in result.stderr and inventory.read_bytes() == before, result.stderr
print("PASS: missing and oversized registered outputs are refused and the inventory is preserved")

# A folder rename does not change the inventory bytes (project_root_name stays out of the digest).
write(module, "# Coding\n")
receipt["packages"][0]["rule_modules"][0]["sha256"] = sha(module.read_bytes())
write(receipt_file(root), json.dumps(receipt))
assert index(root).returncode == 0
named = inventory.read_bytes()
renamed = base / "renamed-project-folder"
root.rename(renamed)
assert index(renamed).returncode == 0
assert (renamed / "ai_rules/project_inventory.json").read_bytes() == named
print("PASS: renaming the project folder leaves the inventory bytes unchanged")
PY

failures=0
if python3 -I -B "$ORACLE" "$ROOT" "$TMP" real; then printf 'PASS: stability oracle on the real index\n'; else printf 'FAIL: stability oracle on the real index\n'; failures=$((failures + 1)); fi
if python3 -I -B "$ORACLE" "$ROOT" "$TMP" controls; then printf 'PASS: receipt and output controls\n'; else printf 'FAIL: receipt and output controls\n'; failures=$((failures + 1)); fi

# One read per instruction file: run the index program in-process with the shared reader counted.
COUNTER="$TMP/count.py"
cat > "$COUNTER" <<'PY'
import collections, hashlib, json, re, sys
from pathlib import Path
harness, target = Path(sys.argv[1]), sys.argv[2]
source = (harness / "bin/sh-index.sh").read_text()
program = re.search(r"<<'PY'\n(.*?)\nPY\n", source, re.S).group(1)
sys.path.insert(0, str(harness / "bin"))
import sh_safe_io
counts = collections.Counter()
real = sh_safe_io.read_bounded_result
def counted(path, limit, **kwargs):
    counts[path] += 1
    return real(path, limit, **kwargs)
sh_safe_io.read_bounded_result = counted
sys.argv = ["-", str(harness / "bin"), target]
try:
    exec(compile(program, "sh-index", "exec"), {"__name__": "__main__"})
except SystemExit as exit_:
    assert not exit_.code, exit_.code
for path in ("RULES.md", "ai_rules/rules/coding.md"):
    assert counts[path] == 1, ("read count", path, counts[path])
print("PASS: each receipt-owned rule file is read exactly once; ownership and the row come from that read")
PY
t="$TMP/once"; mkdir -p "$t/src" "$t/ai_rules/rules" "$t/.claude/agents"
printf '{"name":"once"}\n' > "$t/package.json"; printf 'export const a = 1;\n' > "$t/src/index.ts"
printf '# custom map\n' > "$t/ai_rules/context_map.md"
printf '# Router\n' > "$t/RULES.md"; printf '# Coding\n' > "$t/ai_rules/rules/coding.md"
python3 -I -B -c 'import hashlib, json, sys
t = sys.argv[1]
h = lambda p: hashlib.sha256(open(t + "/" + p, "rb").read()).hexdigest()
json.dump({"format": "spec-harness-synthesis", "schema_version": 2, "packages": [{"path": ".", "rules_path": "RULES.md", "sha256": h("RULES.md"), "rule_modules": [{"name": "coding", "path": "ai_rules/rules/coding.md", "sha256": h("ai_rules/rules/coding.md")}]}]}, open(t + "/.claude/agents/.init-synthesis.json", "w"))' "$t"
if python3 -I -B "$COUNTER" "$ROOT" "$t"; then :; else printf 'FAIL: single-read ownership\n'; failures=$((failures + 1)); fi

# Planted regressions in a scratch copy: each must fail the oracle at its named assertion.
mutant() {
  local label=$1 expected=$2 from=$3 to=$4 copy="$TMP/mutant-$1"
  mkdir -p "$copy"
  cp -R "$ROOT/bin" "$copy/bin"
  python3 -I -B - "$copy/bin/sh-index.sh" "$from" "$to" <<'PY'
import sys
path, old, new = sys.argv[1:4]
text = open(path).read()
assert text.count(old) == 1, ("mutation anchor not found once", old)
open(path, "w").write(text.replace(old, new))
PY
  local out
  out="$(python3 -I -B "$ORACLE" "$copy" "$TMP" mutant 2>&1)"
  if [[ "$out" == *"ASSERTION $expected failed"* ]]; then
    printf 'RED control observed: %s fails at %s\n' "$label" "$expected"
  else
    printf 'FAIL: planted regression %s did not fail at %s: %s\n' "$label" "$expected" "$out"
    failures=$((failures + 1))
  fi
  rm -rf "$TMP/mutant-"*.json "$TMP"/mutant-root "$TMP"/mutant-nested "$TMP"/mutant-large-receipt
}
mutant ownership-disabled owned-row-marked 'receipt_owned = receipt_owned_rule_digests()' 'receipt_owned = {}'
mutant size-only-leak owned-row-has-no-size '            row["ownership"] = "receipt-generated"' '            row["ownership"] = "receipt-generated"; row["bytes"] = len(data)'

if [[ "$failures" -gt 0 ]]; then printf 'RED: %s receipt-index check group(s) failed\n' "$failures"; exit 1; fi
printf 'GREEN: receipt-owned inventory\n'
