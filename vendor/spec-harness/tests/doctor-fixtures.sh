#!/usr/bin/env bash
# doctor: separate structural, semantic and client fields; prerequisites and platform; presence,
# scaffold, missing, route and symlink/FIFO controls; reads only through sh_safe_io; planted modules.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=lib/portable.sh
. "$ROOT/tests/lib/portable.sh"
require_tools bash git
require_python311
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sh-doctor.XXXXXX")" || exit 1
trap 'rm -rf "$TMP"' EXIT

python3 -I -B - "$ROOT" "$TMP" <<'PY'
import json, os, shutil, subprocess, sys
from pathlib import Path

harness, tmp = Path(sys.argv[1]), Path(sys.argv[2])
sys.path.insert(0, str(harness / "tests/lib"))
import ready_fixture as fx


def doctor(target, expected, cwd=None):
    result = subprocess.run(["bash", str(harness / "bin/spec-harness"), "doctor", str(target)], capture_output=True, text=True, cwd=cwd)
    assert result.returncode == expected, (expected, result.returncode, result.stdout, result.stderr)
    return json.loads(result.stdout) if result.stdout.strip().startswith("{") else result


def status(report, path):
    return next(row["status"] for row in report["paths"] if row["path"] == path)


# A fresh install: structural PENDING, scaffolds named, semantic and client never claimed.
fresh = tmp / "fresh"
fresh.mkdir()
subprocess.run(["bash", str(harness / "bin/spec-harness"), "init", str(fresh), "integrate", "demo"], check=True, capture_output=True)
report = doctor(fresh, 1)
assert report["structural"] == "PENDING" and report["semantic"] == "NOT_ASSESSED" and report["client"] == "NOT_ASSESSED", report
assert status(report, ".memory/40-active.md") == "SCAFFOLD" and status(report, "AGENTS.md") == "SCAFFOLD"
assert status(report, ".claude/agents/.init-synthesis.json") == "MISSING"
assert "CLAUDE.md" in report["startup_route_in"]
assert report["synthesis_check"]["exit"] == 1 and "PENDING" in report["synthesis_check"]["output"]
prereq = report["prerequisites"]
for name in ("bash", "git", "python3", "npm", "tar", "sha256"):
    assert prereq[name]["status"] in {"OK", "MISSING", "TOO_OLD"}, (name, prereq[name])
assert prereq["python3"]["status"] == "OK" and prereq["sha256"]["status"] == "OK"
assert report["platform"]["status"] in {"SUPPORTED", "UNTESTED"}
print("PASS: fresh install reports structural PENDING with scaffolds; semantic and client stay NOT_ASSESSED; prerequisites listed")

# A filled, checked target: structural READY, still no semantic or client claim.
ready = tmp / "ready"
fx.build(ready, harness)
filled = "# Filled\n- Reviewed project fact.\n"
for rel in ["CLAUDE.md", "SPEC-HARNESS.md", "ai_rules/globalRules.md", "ai_rules/rules/core.md",
            "ai_rules/rules/context_management.md", ".claude/commands/sdd.md", ".agents/skills/sdd/SKILL.md"] + \
           [f".memory/{name}.md" for name in ("00-description", "01-brief", "10-product", "20-system", "30-tech",
                                               "40-active", "50-progress", "60-decisions", "70-knowledge", "80-feedback")]:
    fx.write(ready / rel, filled)
fx.write(ready / "AGENTS.md", "# Agents\nFeature work goes through `.claude/commands/sdd.md`.\n")
report = doctor(ready, 0)
assert report["structural"] == "READY" and report["semantic"] == "NOT_ASSESSED" and report["client"] == "NOT_ASSESSED", report
assert report["startup_route_in"] == ["AGENTS.md"]
print("PASS: a filled target with a READY check is structural READY; semantic and client remain NOT_ASSESSED")

def expect(condition, report):
    if not condition:
        raise AssertionError(json.dumps(report, indent=2)[:3000])


def red(label, mutate, restore, check):
    mutate()
    try:
        report = doctor(ready, 1)
        assert report["structural"] == "PENDING", (label, report)
        check(report)
        print("RED control observed: " + label)
    finally:
        restore()
    assert doctor(ready, 0)["structural"] == "READY"

active = ready / ".memory/40-active.md"
red("missing memory file", lambda: active.unlink(), lambda: fx.write(active, filled), lambda r: expect(status(r, ".memory/40-active.md") == "MISSING", r))
red("scaffold memory file", lambda: fx.write(active, "# Active\n\nPENDING: fill only from this project's evidence.\n"), lambda: fx.write(active, filled),
    lambda r: expect(status(r, ".memory/40-active.md") == "SCAFFOLD", r))
agents = ready / "AGENTS.md"
agents_text = agents.read_text()
red("no startup route", lambda: fx.write(agents, "# Agents\nOld instructions only.\n"), lambda: fx.write(agents, agents_text),
    lambda r: expect(r["startup_route_in"] == [], r))

def link_memory():
    active.unlink()
    active.symlink_to(ready / "AGENTS.md")
red("symlinked memory file", link_memory, lambda: (active.unlink(), fx.write(active, filled)),
    lambda r: expect((status(r, ".memory/40-active.md") == "UNSAFE" and "not read" in r["synthesis_check"]["output"]), r))

def fifo_memory():
    active.unlink()
    os.mkfifo(active)
red("FIFO memory file (no hang)", fifo_memory, lambda: (active.unlink(), fx.write(active, filled)),
    lambda r: expect(status(r, ".memory/40-active.md") == "UNSAFE", r))

def link_claude_dir():
    (ready / ".claude").rename(ready / "claude-real")
    (ready / ".claude").symlink_to(ready / "claude-real", target_is_directory=True)
def unlink_claude_dir():
    (ready / ".claude").unlink()
    (ready / "claude-real").rename(ready / ".claude")
red("symlinked .claude/ directory", link_claude_dir, unlink_claude_dir,
    lambda r: expect(status(r, ".claude/commands/sdd.md") == "UNSAFE", r))

rules = ready / "RULES.md"
rules_text = rules.read_text()
red("stale rules output", lambda: fx.write(rules, rules_text + "\nhuman edit\n"), lambda: fx.write(rules, rules_text),
    lambda r: expect(r["synthesis_check"]["exit"] == 1 and "stale" in r["synthesis_check"]["output"], r))

# Planted modules in the working directory do not change the report.
cwd = tmp / "planted-cwd"
cwd.mkdir()
for name in ("json", "hashlib", "subprocess"):
    (cwd / f"{name}.py").write_text("import sys\nsys.exit(0)\n")
report = doctor(ready, 0, cwd=cwd)
assert report["structural"] == "READY"
missing = doctor(tmp / "does-not-exist", 2)
assert "existing target directory" in missing.stderr
print("PASS: planted modules do not change the report; a missing target exits 2")
print("All doctor fixtures passed.")
PY
