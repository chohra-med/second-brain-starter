#!/usr/bin/env bash
# Ticket run state (bin/sh-run-state.py, docs/RUN-STATE.md): a valid state passes; a skipped stage,
# an unapproved or changed plan, missing or failing review and test evidence, a malformed,
# oversized or linked state file, and a bad ticket name all fail, with the reason named.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=lib/portable.sh
. "$ROOT/tests/lib/portable.sh"
require_python311
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sh-run-state.XXXXXX")" || exit 1
trap 'rm -rf "$TMP"' EXIT

if python3 -I -B - "$ROOT" "$TMP" <<'PY'
import hashlib, json, os, subprocess, sys
from pathlib import Path

root, tmp = Path(sys.argv[1]), Path(sys.argv[2])
checker = root / "bin" / "sh-run-state.py"
target = tmp / "target"
run_dir = target / ".spec-harness" / "runs" / "PROJ-7"
run_dir.mkdir(parents=True)
(target / "docs").mkdir()
(target / "docs" / "spec.md").write_text("# Spec\n", encoding="utf-8")
plan_bytes = b"# Plan\n- step one\n"
(target / "docs" / "plan.md").write_bytes(plan_bytes)
plan_sha = hashlib.sha256(plan_bytes).hexdigest()
STAGES = ["spec", "plan", "checkpoint", "implement", "review", "test", "summary"]
failures = []

def good(stage):
    index = STAGES.index(stage)
    state = {
        "format": "spec-harness-run-state", "schema_version": 1, "ticket": "PROJ-7", "stage": stage,
        "completed": STAGES[:index], "spec_path": "docs/spec.md", "plan_path": "docs/plan.md",
    }
    if index >= STAGES.index("checkpoint"):
        state["checkpoint"] = {"approved_by": "reviewer", "approved_at": "2026-10-14T09:00:00Z", "plan_sha256": plan_sha}
    if index >= STAGES.index("review"):
        state["review"] = {"verdict": "APPROVE", "context": "fresh"}
    if index >= STAGES.index("test"):
        state["test"] = {"command": "npm test", "result": "PASS"}
    return state

def write(obj=None, raw=None):
    path = run_dir / "run-state.json"
    if path.is_symlink() or path.exists():
        path.unlink()
    path.write_text(raw if raw is not None else json.dumps(obj), encoding="utf-8")

def check(label, expect_rc, needle=None, ticket="PROJ-7"):
    proc = subprocess.run([sys.executable, "-I", "-B", str(checker), "--check", ticket, str(target)],
                          capture_output=True, text=True)
    out = proc.stdout + proc.stderr
    ok = proc.returncode == expect_rc and (needle is None or needle in out)
    if ok:
        print(f"PASS: {label} (exit {proc.returncode})")
    else:
        failures.append(label)
        print(f"FAIL: {label}: exit {proc.returncode}, wanted {expect_rc}; output: {out.strip()}")

write(good("test"))
check("a complete state through test passes", 0, "VALID (stage test)")
write(good("spec"))
check("a state at the spec stage passes", 0, "VALID (stage spec)")

skipped = good("review")
skipped["completed"] = ["spec", "plan", "implement"]
write(skipped)
check("a skipped checkpoint is refused", 1, "stage order")

changed = good("test")
(target / "docs" / "plan.md").write_bytes(plan_bytes + b"- sneaked in\n")
write(changed)
check("a plan changed after approval is refused", 1, "changed after approval")
(target / "docs" / "plan.md").write_bytes(plan_bytes)

no_review = good("test")
del no_review["review"]
write(no_review)
check("missing review evidence is refused", 1, "review evidence is required")

shared = good("test")
shared["review"]["context"] = "shared"
write(shared)
check("a reviewer that is not fresh is refused", 1, "review.context must be 'fresh'")

failing = good("test")
failing["test"]["result"] = "FAIL"
write(failing)
check("a failing test result is refused", 1, "test.result must be PASS")

extra = good("test")
extra["surprise"] = True
write(extra)
check("an unknown top-level key is refused", 1, "unknown top-level key: 'surprise'")

escaping = good("spec")
escaping["spec_path"] = "../outside.md"
write(escaping)
check("a spec path that leaves the target is refused", 1, "relative path inside the target")

write(raw="{not json")
check("a malformed state file is refused", 1)
write(raw="[1, 2, 3]")
check("a JSON value that is not an object is refused", 1)
write(raw=json.dumps({"padding": "x" * (300 * 1024)}))
check("an oversized state file is refused", 1)

write(good("test"))
state_path = run_dir / "run-state.json"
outside = tmp / "elsewhere.json"
outside.write_text(json.dumps(good("test")), encoding="utf-8")
state_path.unlink()
os.symlink(outside, state_path)
check("a symlinked state file is refused", 1)
state_path.unlink()

check("a bad ticket name exits 2", 2, ticket="../PROJ")
check("a missing run state for a ticket is named", 1, "no run state for ticket", ticket="PROJ-9")

# A ticket with a trailing newline is not a slug: the pattern must match the whole string.
check("a ticket ending in a newline exits 2", 2, "ticket must be a slug", ticket="PROJ-7\n")

# Paths: a backslash is refused at the stage that holds the path; a '..' segment is refused, but
# a file name that only contains two dots is not a segment and stays allowed.
backslash_spec = good("spec")
backslash_spec["spec_path"] = "docs\\spec.md"
write(backslash_spec)
check("a backslash in spec_path is refused", 1, "spec_path must be a relative path inside the target")
backslash_plan = good("plan")
backslash_plan["plan_path"] = "docs\\plan.md"
write(backslash_plan)
check("a backslash in plan_path is refused", 1, "plan_path must be a relative path inside the target")
escaping_plan = good("plan")
escaping_plan["plan_path"] = "docs/../../outside.md"
write(escaping_plan)
check("a plan path that leaves the target is refused", 1, "plan_path must be a relative path inside the target")
dotted = good("spec")
dotted["spec_path"] = "docs/a..b.md"
write(dotted)
check("a name with two dots inside a segment is allowed", 0, "VALID (stage spec)")
# A state at the spec stage has no plan yet: an absent plan_path is not a defect before the plan stage.
no_plan = good("spec")
del no_plan["plan_path"]
write(no_plan)
check("a spec-stage state with no plan_path yet is valid", 0, "VALID (stage spec)")

def raw_check(label, expect_rc, needle):
    # Target-controlled text may not put a raw ESC byte on the terminal; the escaped form must appear.
    proc = subprocess.run([sys.executable, "-I", "-B", str(checker), "--check", "PROJ-7", str(target)],
                          capture_output=True, text=True)
    out = proc.stdout + proc.stderr
    ok = proc.returncode == expect_rc and "\x1b" not in out and needle in out
    if ok:
        print(f"PASS: {label} (exit {proc.returncode})")
    else:
        failures.append(label)
        print(f"FAIL: {label}: exit {proc.returncode}, wanted {expect_rc}; output: {out.encode('unicode_escape').decode()}")

# A target path given on the command line is echoed escaped too.
proc = subprocess.run([sys.executable, "-I", "-B", str(checker), "--check", "PROJ-7", str(tmp / "no\x1b[2Jdir")],
                      capture_output=True, text=True)
out = proc.stdout + proc.stderr
if proc.returncode == 2 and "\x1b" not in out and "\\x1b" in out:
    print("PASS: a target path with an escape sequence prints no raw ESC byte (exit 2)")
else:
    failures.append("target path escape")
    print(f"FAIL: a target path with an escape sequence prints no raw ESC byte: exit {proc.returncode}; output: {out.encode('unicode_escape').decode()}")

hostile = good("test")
hostile["\x1b[2J"] = True
write(hostile)
raw_check("an unknown key with an escape sequence prints no raw ESC byte", 1, "unknown top-level key: '\\x1b[2J'")
hostile_plan = good("checkpoint")
hostile_plan["plan_path"] = "docs/\x1b[2Jplan.md"
write(hostile_plan)
raw_check("a plan path with an escape sequence prints no raw ESC byte", 1, "docs/\\x1b[2Jplan.md")

# Plan approval (docs/RUN-STATE.md, commands/plan.md): plan.md holds no hash. The approver, the time
# and the SHA-256 of the plan.md bytes live in the run state checkpoint, which the checker reads.
approved = b"# Plan\n- approved step\n"
(target / "docs" / "plan.md").write_bytes(approved)
recorded = good("checkpoint")
recorded["checkpoint"]["plan_sha256"] = hashlib.sha256(approved).hexdigest()
write(recorded)
check("an approval recorded in the run state for the plan.md bytes is VALID", 0, "VALID (stage checkpoint)")
(target / "docs" / "plan.md").write_bytes(approved + b"- edited after approval\n")
check("editing plan.md after the recorded approval is refused", 1, "changed after approval")
(target / "docs" / "plan.md").write_bytes(plan_bytes)

if failures:
    print(f"RED: {len(failures)} run-state check(s) failed")
    sys.exit(1)
print("GREEN: run state checker")
PY
then
  exit 0
fi
exit 1
