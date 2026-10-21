#!/usr/bin/env bash
# PR packet check (bin/sh-pr-packet.py through `spec-harness pr-packet`, commands/pr-prepare.md):
# a complete body passes; a missing section, a second image, a video, a local path, a placeholder,
# too many Merge Danger bullets and a missing test name each fail with the check named. Test names
# are also collected from a branch's test diff. The checklist, the merger gate and the CLI route exist.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=lib/portable.sh
. "$ROOT/tests/lib/portable.sh"
require_python311
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sh-pr-packet.XXXXXX")" || exit 1
trap 'rm -rf "$TMP"' EXIT

if python3 -I -B - "$ROOT" "$TMP" <<'PY'
import subprocess, sys
from pathlib import Path

root, tmp = Path(sys.argv[1]), Path(sys.argv[2])
cli = root / "bin" / "spec-harness"
failures = []

GOOD = """# Add a total row

## Summary

The invoice table shows a total row.

## Evidence

![Before and After: the table without and with the total row](evidence/before-after.png)

- `npm test`: adds two numbers, keeps the order of rows

## Merge Danger

- The row reads the same column as the export.
"""
names = tmp / "names.txt"
names.write_text("adds two numbers\nkeeps the order of rows\n", encoding="utf-8")


def run(body, *extra):
    path = tmp / "body.md"
    path.write_text(body, encoding="utf-8")
    proc = subprocess.run(["bash", str(cli), "pr-packet", str(path), *extra], capture_output=True, text=True)
    return proc.returncode, proc.stdout + proc.stderr


def expect(label, body, code, needle, *extra):
    got, out = run(body, *extra)
    if got != code or needle not in out:
        failures.append(f"{label}: expected exit {code} with {needle!r}, got exit {got}:\n{out}")
    else:
        print(f"PASS: {label}")


expect("complete body passes", GOOD, 0, "PASS test names: 2 verbatim", "--test-names", str(names))
expect("missing Evidence section fails", GOOD.replace("## Evidence", "## Proof"), 1, "FAIL section evidence", "--test-names", str(names))
expect("a second image fails", GOOD.replace("- `npm test`", "![After](after.png)\n- `npm test`"), 1, "FAIL evidence image count")
expect("unlabelled image fails", GOOD.replace("Before and After: the", "The").replace("before-after.png", "table.png"), 1, "FAIL before/after labels")
expect("a video fails", GOOD + "\n[run](evidence/run.mp4)\n", 1, "FAIL no video")
local_dir = "/" + "home" + "/someone"
expect("a local path fails", GOOD + f"\nLog: {local_dir}/log.txt\n", 1, "FAIL no private paths")
expect("a placeholder fails", GOOD + "\nTODO: add numbers\n", 1, "FAIL no placeholders")
expect("four Merge Danger bullets fail", GOOD + "- two\n- three\n- four\n", 1, "FAIL merge danger bullets")
expect("a missing test name fails", GOOD.replace("keeps the order of rows", "keeps rows"), 1, "FAIL test names", "--test-names", str(names))
expect("no test names is UNVERIFIED, not PASS", GOOD, 0, "UNVERIFIED test names")
expect("claims are never passed by the script", GOOD, 0, "UNVERIFIED claims vs evidence")

repo = tmp / "repo"
repo.mkdir()
git = ["git", "-C", str(repo), "-c", "user.email=pr@example.invalid", "-c", "user.name=pr"]
subprocess.run(git + ["init", "-q", "-b", "main"], check=True)
(repo / "sum.test.js").write_text("test('adds two numbers', () => {});\n", encoding="utf-8")
subprocess.run(git + ["add", "-A"], check=True)
subprocess.run(git + ["commit", "-qm", "base"], check=True)
subprocess.run(git + ["switch", "-qc", "feature"], check=True)
(repo / "sum.test.js").write_text("test('adds two numbers', () => {});\ntest('keeps the order of rows', () => {});\n", encoding="utf-8")
subprocess.run(git + ["commit", "-qam", "head"], check=True)
repo_args = ("--repo", str(repo), "--base", "main", "--head", "feature")
expect("test names from the branch diff pass", GOOD, 0, "PASS test names: 1 verbatim", *repo_args)
expect("a branch test missing from the body fails", GOOD.replace("keeps the order of rows", ""), 1, "FAIL test names", *repo_args)
expect("a ref that looks like an option is refused", GOOD, 2, "must not start with", "--repo", str(repo), "--base=-x", "--head", "feature")
expect("--repo without refs is a usage error", GOOD, 2, "needs both --base and --head", "--repo", str(repo))

img_tag = GOOD.replace("![Before and After: the table without and with the total row](evidence/before-after.png)",
                       '<img alt="Before and After: the table without and with the total row" src="evidence/before-after.png">')
expect("an HTML img tag naming Before and After passes", img_tag, 0, "PASS before/after labels")
fenced = GOOD.replace("## Evidence\n\n", "## Evidence\n\n```sh\n# run the suite\nnpm test\n```\n\n")
expect("a shell comment inside a fenced block is not a heading", fenced, 0, "PASS evidence image count")
not_utf8 = tmp / "not-utf8.md"
not_utf8.write_bytes(b"## Summary\n\xff\n## Evidence\n")
proc = subprocess.run(["bash", str(cli), "pr-packet", str(not_utf8)], capture_output=True, text=True)
if proc.returncode != 2 or "FAIL read" not in proc.stdout:
    failures.append(f"a body that is not UTF-8 must exit 2 with FAIL read, got {proc.returncode}:\n{proc.stdout}{proc.stderr}")
else:
    print("PASS: a body that is not UTF-8 is a read error (exit 2), not a traceback")

proc = subprocess.run(["bash", str(cli), "pr-prepare"], capture_output=True, text=True)
if proc.returncode != 2 or "PENDING: documentation only" not in proc.stdout or "Packet check" not in proc.stdout:
    failures.append(f"pr-prepare route: expected exit 2 and the checklist, got {proc.returncode}:\n{proc.stdout}{proc.stderr}")
else:
    print("PASS: spec-harness pr-prepare prints the checklist and reports PENDING")

merger = (root / "agents" / "sdd-merger.md").read_text(encoding="utf-8")
if "## PR packet gate" not in merger or "spec-harness pr-packet" not in merger:
    failures.append("agents/sdd-merger.md lacks the PR packet gate naming spec-harness pr-packet")
else:
    print("PASS: the merger role carries the PR packet gate")

if failures:
    print("\n\n".join(failures))
    sys.exit(1)
PY
then
  if [ -n "$(find "$ROOT/bin" -name __pycache__ -o -name '*.pyc' 2>/dev/null | head -n 1)" ]; then
    echo "FAIL: Python bytecode appeared under bin/"
    exit 1
  fi
  echo "pr-packet-fixtures: all checks passed"
else
  echo "pr-packet-fixtures: FAILED"
  exit 1
fi
