#!/usr/bin/env bash
# A first /sdd init must be able to fix a bad role row from the check's message alone: the check
# names which field is wrong (status, path or package_paths) and what it expected. Each planted
# defect starts from a READY fixture and must produce its own named reason.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=lib/portable.sh
. "$ROOT/tests/lib/portable.sh"
require_tools bash git
require_python311
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sh-role-binding.XXXXXX")" || exit 1
trap 'rm -rf "$TMP"' EXIT

python3 -I -B - "$ROOT" "$TMP" <<'PY'
import json, subprocess, sys
from pathlib import Path

harness, tmp = Path(sys.argv[1]), Path(sys.argv[2])
sys.path.insert(0, str(harness / "tests/lib"))
import ready_fixture as fx

failures = 0
cases = [
    ("status READY instead of BOUND", lambda r: r.update(status="READY"), 'status must be "BOUND" (got \'READY\')'),
    ("wrong role path", lambda r: r.update(path=".claude/agents/other.md"), 'path must be ".claude/agents/sdd-planner.md"'),
    ("package_paths not the receipt's", lambda r: r.update(package_paths=["src"]), "package_paths must equal the receipt's package_paths ['.']"),
]
for label, mutate, expected in cases:
    root = tmp / label.replace(" ", "-").replace("'", "")
    root.mkdir()
    fx.build(root, harness)
    receipt_path = root / ".claude/agents/.init-synthesis.json"
    receipt = json.loads(receipt_path.read_text())
    mutate(next(r for r in receipt["roles"] if r["name"] == "sdd-planner"))
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
    result = subprocess.run(["bash", str(harness / "bin/sh-gen-agents.sh"), "--check", str(root)], capture_output=True, text=True)
    out = result.stdout + result.stderr
    if result.returncode != 0 and "role sdd-planner:" in out and expected in out:
        print(f"PASS: {label} is named: {expected}")
    else:
        failures += 1
        print(f"FAIL: {label}: exit {result.returncode}, expected {expected!r} in:\n{out}")

print("RESULT: PASS (role binding messages)" if not failures else f"RESULT: FAIL ({failures} role binding message check(s) failed)")
sys.exit(1 if failures else 0)
PY
