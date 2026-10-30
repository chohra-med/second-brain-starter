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
import json, os, shlex, shutil, subprocess, sys, time
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
# A Hot file whose PENDING lines are replaced by an explicit "None recorded yet" is filled, not a scaffold.
fx.write(active, "# Active\n\n> Tier: Hot. current focus and next action\n\n## Current truth\n\nNone recorded yet (2026-10-28).\n\n## Log\n")
assert doctor(ready, 0)["structural"] == "READY"
fx.write(active, filled)
# init owns filling the memory bank and must say what doctor checks: every core file, and doctor in its READY.
init = (harness / "commands/init.md").read_text(encoding="utf-8")
for name in ("00-description", "01-brief", "10-product", "20-system", "30-tech", "40-active", "50-progress", "60-decisions", "70-knowledge", "80-feedback"):
    assert f"`{name}`" in init, f"commands/init.md does not name the core memory file {name}"
assert "None recorded yet (YYYY-MM-DD)." in init, "commands/init.md does not say how to fill a memory file with no evidence"
assert "`spec-harness doctor <target>` reports `structural: READY`" in init, "the READY definition in commands/init.md does not name doctor"
print("PASS: an explicit 'None recorded yet' fills a memory file; init names every core file doctor checks and doctor in READY")
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

# guards: a separate field. It never changes structural or the exit code; each guard is OK, MISSING or
# NOT_APPLICABLE with a one-line note.
OLD_GUARDS = ("claude_imports_agents", "hook_registered", "lens_present", "memory_complete")
GUARDS = OLD_GUARDS + ("hook_python", "runs_current")


def old_keys(guards):
    """The four guards that existed before the hook learned about python3 and run age; their values never change."""
    return {name: guards[name] for name in OLD_GUARDS}


def guards_of(target):
    result = subprocess.run(["bash", str(harness / "bin/spec-harness"), "doctor", str(target)], capture_output=True, text=True)
    report = json.loads(result.stdout)
    assert set(report["guards"]) == set(GUARDS), report["guards"]
    assert set(report["guards_notes"]) == set(GUARDS), report["guards_notes"]
    for name in GUARDS:
        assert report["guards"][name] in {"OK", "MISSING", "NOT_APPLICABLE"}, report["guards"]
        note = report["guards_notes"][name]
        assert isinstance(note, str) and note and "\n" not in note, (name, note)
    return report["guards"], report["guards_notes"], report, result.returncode


# A READY target without the hook, lens or CLAUDE.md import: structural and exit code stay as they were.
g, notes, report, code = guards_of(ready)
assert report["structural"] == "READY" and code == 0, (report["structural"], code)
assert old_keys(g) == {"claude_imports_agents": "MISSING", "hook_registered": "MISSING", "lens_present": "MISSING", "memory_complete": "OK"}, g
print("PASS: guards sit beside structural; a READY target keeps READY and exit 0 while a guard is MISSING")

# A real install: import OK, hook OK, lens OK; the memory files are still scaffolds.
g, notes, report, code = guards_of(fresh)
assert old_keys(g) == {"claude_imports_agents": "OK", "hook_registered": "OK", "lens_present": "OK", "memory_complete": "MISSING"}, (g, notes)
assert report["structural"] == "PENDING" and code == 1
assert "40-active" in notes["memory_complete"], notes
print("PASS: a fresh install reports import, hook and lens OK and memory MISSING with the file names")

# The hook guard, one failing state at a time, on a copy of the install.
import shutil
def variant(name):
    target = tmp / name
    shutil.copytree(fresh, target, symlinks=True)
    return target

settings_rel = ".claude/settings.local.json"
script_rel = ".claude/spec-harness/hooks/sdd-gate.sh"
target = variant("no-settings"); (target / settings_rel).unlink()
g, notes, *_ = guards_of(target)
assert g["hook_registered"] == "MISSING" and "settings.local.json" in notes["hook_registered"], (g, notes)
target = variant("other-hook-only")
(target / settings_rel).write_text(json.dumps({"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "echo hi"}]}]}}))
g, notes, *_ = guards_of(target)
assert g["hook_registered"] == "MISSING" and "no entry" in notes["hook_registered"], (g, notes)
target = variant("bad-json"); (target / settings_rel).write_text("{ nope")
g, notes, *_ = guards_of(target)
assert g["hook_registered"] == "MISSING" and "JSON" in notes["hook_registered"], (g, notes)
target = variant("not-executable"); (target / script_rel).chmod(0o644)
g, notes, *_ = guards_of(target)
assert g["hook_registered"] == "MISSING" and "executable" in notes["hook_registered"], (g, notes)
target = variant("no-script"); (target / script_rel).unlink()
g, notes, *_ = guards_of(target)
assert g["hook_registered"] == "MISSING" and "script" in notes["hook_registered"], (g, notes)
target = variant("linked-script"); (target / script_rel).unlink(); (target / script_rel).symlink_to(harness / "hooks/sdd-gate.sh")
g, notes, *_ = guards_of(target)
assert g["hook_registered"] == "MISSING", (g, notes)
# A registered, executable script that is not the shipped hook: the registrar refuses it, and so does doctor.
target = variant("foreign-script"); (target / script_rel).write_text("#!/bin/sh\necho foreign\n"); (target / script_rel).chmod(0o755)
g, notes, *_ = guards_of(target)
assert g["hook_registered"] == "MISSING" and "differs from the shipped edit guard" in notes["hook_registered"], (g, notes)
target = variant("no-claude-route"); (target / ".claude/commands/sdd.md").unlink()
g, notes, *_ = guards_of(target)
assert g["hook_registered"] == "NOT_APPLICABLE" and "Claude" in notes["hook_registered"], (g, notes)
print("PASS: hook_registered is MISSING for no file, another hook only, bad JSON, no exec bit, no script, a linked script, a foreign script; NOT_APPLICABLE without the Claude route")

# Batch 3b: python3 availability, the registered matcher, and open or expired runs. All read only.
DAY = 24 * 60 * 60
def age(path, days):
    stamp = time.time() - days * DAY
    os.utime(path, (stamp, stamp))

# The registered matcher must equal the registrar's, or the guard only covers some tools.
g, notes, *_ = guards_of(fresh)
assert g["hook_registered"] == "OK" and g["hook_python"] == "OK" and g["runs_current"] == "OK", (g, notes)
target = variant("wrong-matcher")
(target / settings_rel).write_text(json.dumps({"hooks": {"PreToolUse": [{"matcher": "Edit|Write", "hooks": [
    {"type": "command", "command": '"$CLAUDE_PROJECT_DIR"/' + script_rel}]}]}}))
g, notes, *_ = guards_of(target)
assert g["hook_registered"] == "MISSING" and "matcher" in notes["hook_registered"] and "Edit|Write|MultiEdit|NotebookEdit" in notes["hook_registered"], (g, notes)
target = variant("two-groups")
(target / settings_rel).write_text(json.dumps({"hooks": {"PreToolUse": [
    {"matcher": "Edit", "hooks": [{"type": "command", "command": '"$CLAUDE_PROJECT_DIR"/' + script_rel}]},
    {"matcher": "Edit|Write|MultiEdit|NotebookEdit", "hooks": [{"type": "command", "command": '"$CLAUDE_PROJECT_DIR"/' + script_rel}]}]}}))
assert guards_of(target)[0]["hook_registered"] == "OK", "one correct registration is enough"
target = variant("no-matcher")
(target / settings_rel).write_text(json.dumps({"hooks": {"PreToolUse": [{"hooks": [{"type": "command", "command": '"$CLAUDE_PROJECT_DIR"/' + script_rel}]}]}}))
g, notes, *_ = guards_of(target)
assert g["hook_registered"] == "MISSING" and "matcher" in notes["hook_registered"], (g, notes)
print("PASS: hook_registered is OK only when the registered matcher equals the expected one")

# Doctor imports the registrar's constants. A copy of the bin folder whose registrar expects another matcher
# must change the verdict on an unchanged install; and doctor itself carries no literal copy.
doctor_source = (harness / "bin/sh-doctor.py").read_text()
assert "Edit|Write|MultiEdit" not in doctor_source and "sdd-gate.sh" not in doctor_source, "doctor copies the registrar constants"
copy_bin = tmp / "bin-copy"
shutil.copytree(harness / "bin", copy_bin)
registrar = copy_bin / "sh-hook-register.py"
registrar.write_text(registrar.read_text().replace('MATCHER = "Edit|Write|MultiEdit|NotebookEdit"', 'MATCHER = "Edit|Write|MultiEdit|NotebookEdit|Other"'))
result = subprocess.run([sys.executable, "-I", "-B", str(copy_bin / "sh-doctor.py"), str(fresh)], capture_output=True, text=True)
copied = json.loads(result.stdout)
assert copied["guards"]["hook_registered"] == "MISSING" and "Other" in copied["guards_notes"]["hook_registered"], copied["guards_notes"]
print("PASS: doctor takes the matcher from the registrar (a changed registrar changes the verdict)")

# python3 missing: the hook cannot decide and lets every edit through.
no_python = tmp / "no-python-path"
no_python.mkdir()
for tool in ("bash", "git", "tar", "shasum", "cmp", "sed", "awk", "grep", "cat", "ls", "mkdir", "rm", "cp", "mv", "dirname", "basename",
             "sort", "find", "tr", "head", "tail", "wc", "env", "uname", "date", "od", "chmod", "tee", "xargs", "readlink", "stat", "mktemp"):
    found = shutil.which(tool)
    if found:
        (no_python / tool).symlink_to(found)
assert not (no_python / "python3").exists()
result = subprocess.run([sys.executable, "-I", "-B", str(harness / "bin/sh-doctor.py"), str(fresh)], capture_output=True, text=True,
                        env={"PATH": str(no_python), "HOME": str(tmp)})
bare = json.loads(result.stdout)
assert bare["guards"]["hook_python"] == "MISSING" and "python3" in bare["guards_notes"]["hook_python"] and "fail" in bare["guards_notes"]["hook_python"], bare["guards_notes"]
assert bare["guards"]["hook_registered"] == "OK", "the registration itself is still fine"
print("PASS: hook_python is MISSING when python3 is not on PATH (the hook would fail open), OK when it is")

# Open and expired runs and tickets are listed. Doctor writes nothing.
target = variant("runs")
runs = target / ".spec-harness/runs"
def run_state(name, completed, days=0):
    folder = runs / name
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "run-state.json").write_text(json.dumps({"format": "spec-harness-run-state", "schema_version": 1, "ticket": name, "completed": completed}))
    if days:
        age(folder / "run-state.json", days)
assert guards_of(target)[0]["runs_current"] == "OK"
run_state("T-open", ["spec", "plan", "checkpoint"])
run_state("T-done", ["spec", "plan", "checkpoint", "summary"], days=30)
g, notes, *_ = guards_of(target)
assert g["runs_current"] == "OK" and "T-open" in notes["runs_current"] and "T-done" not in notes["runs_current"] and "expired" not in notes["runs_current"], (g, notes)
run_state("T-old", ["spec", "plan", "checkpoint", "implement"], days=8)
run_state("T-fresh-ish", ["spec", "plan", "checkpoint"], days=6)
ticket = target / "specs/fix-x/ticket.md"
ticket.parent.mkdir(parents=True)
ticket.write_text("# Ticket\n\n## Goal checks\n1. x\n")
age(ticket, 9)
closed = target / "specs/fix-y/ticket.md"
closed.parent.mkdir(parents=True)
closed.write_text("RESULT: PASS\n")
age(closed, 20)
fresh_ticket = target / "specs/fix-z/ticket.md"
fresh_ticket.parent.mkdir(parents=True)
fresh_ticket.write_text("# Ticket\n")
snapshot = fx.snapshot(target)
g, notes, report, code = guards_of(target)
note = notes["runs_current"]
assert g["runs_current"] == "MISSING", (g, notes)
for needle in ("expired", "T-old", "specs/fix-x/ticket.md", "open", "T-open", "T-fresh-ish", "specs/fix-z/ticket.md"):
    assert needle in note, (needle, note)
for absent in ("T-done", "fix-y"):
    assert absent not in note, (absent, note)
assert fx.snapshot(target) == snapshot, "doctor wrote a file"
link = tmp / "linked-state.json"
link.write_text(json.dumps({"completed": ["checkpoint"]}))
(runs / "T-link").mkdir()
(runs / "T-link/run-state.json").symlink_to(link)
assert "T-link" not in guards_of(target)[2]["guards_notes"]["runs_current"], "a linked run-state must not be read"
print("PASS: runs_current lists open and expired runs and tickets, ignores closed and linked ones, and doctor writes nothing")

# The import, the lens and the memory guards.
target = variant("no-import"); (target / "CLAUDE.md").write_text("# Own file\nNo import here.\n")
assert guards_of(target)[0]["claude_imports_agents"] == "MISSING"
target = variant("no-claude-md"); (target / "CLAUDE.md").unlink()
assert guards_of(target)[0]["claude_imports_agents"] == "MISSING"
target = variant("no-agents-md"); (target / "AGENTS.md").unlink()
g, notes, *_ = guards_of(target)
assert g["claude_imports_agents"] == "NOT_APPLICABLE" and "AGENTS.md" in notes["claude_imports_agents"], (g, notes)
target = variant("no-lens"); (target / "ai_rules/review-lens.md").unlink()
assert guards_of(target)[0]["lens_present"] == "MISSING"
target = variant("linked-lens"); (target / "ai_rules/review-lens.md").unlink(); (target / "ai_rules/review-lens.md").symlink_to(target / "AGENTS.md")
assert guards_of(target)[0]["lens_present"] == "MISSING"
target = variant("memory-one-gone"); (target / ".memory/70-knowledge.md").unlink()
g, notes, *_ = guards_of(target)
assert g["memory_complete"] == "MISSING" and "70-knowledge" in notes["memory_complete"], (g, notes)
target = variant("memory-filled")
for name in ("00-description", "01-brief", "10-product", "20-system", "30-tech", "40-active", "50-progress", "60-decisions", "70-knowledge", "80-feedback"):
    fx.write(target / f".memory/{name}.md", filled)
assert guards_of(target)[0]["memory_complete"] == "OK"
print("PASS: import, lens and memory guards each fail in their own state and pass in theirs")

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

# The advisory memory budget: sizes at each threshold, Cold files ignored, missing and linked Hot files, exit unchanged.
def ready_copy(name):
    target = tmp / name
    shutil.copytree(ready, target, symlinks=True)
    return target


def sized(path, n, tier="Hot"):
    head = f"# Memory\n> Tier: {tier}. fixture\n\n".encode()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(head + b"a" * (n - len(head)))
    assert path.stat().st_size == n, (path, path.stat().st_size)


target = ready_copy("memory-edges")
sized(target / ".memory/40-active.md", 3199)
sized(target / ".memory/50-progress.md", 3200)
sized(target / ".memory/80-feedback.md", 4000)
sized(target / ".memory/10-product.md", 9000, tier="Cold")
budget = doctor(target, 0)["memory"]
assert budget["40-active.md"] == {"status": "OK", "bytes": 3199}, budget
assert budget["50-progress.md"] == {"status": "WARN", "bytes": 3200}, budget
assert budget["80-feedback.md"] == {"status": "WARN", "bytes": 4000}, budget
assert "10-product.md" not in budget, budget

target = ready_copy("memory-over")
sized(target / ".memory/80-feedback.md", 4001)
assert doctor(target, 0)["memory"]["80-feedback.md"] == {"status": "OVER", "bytes": 4001}
print("PASS: memory budget: 3199 OK, 3200 and 4000 WARN, 4001 OVER; a Cold 9000-byte file is not listed; exit unchanged")

target = ready_copy("memory-missing")
(target / ".memory/50-progress.md").unlink()
assert doctor(target, 1)["memory"]["50-progress.md"] == {"status": "MISSING", "bytes": None}
target = ready_copy("memory-linked")
(target / ".memory/40-active.md").unlink()
(target / ".memory/40-active.md").symlink_to(target / "AGENTS.md")
assert doctor(target, 1)["memory"]["40-active.md"]["status"] == "UNSAFE"
target = ready_copy("memory-unnamed-hot")
sized(target / ".memory/90-extra.md", 4001)
assert doctor(target, 0)["memory"]["90-extra.md"] == {"status": "OVER", "bytes": 4001}, "an unnamed file with the Hot tier line must be counted"
target = ready_copy("memory-bare-hot")
bare = b"# Bare\n> Tier: Hot\n"
(target / ".memory/95-bare.md").write_bytes(bare + b"a" * (4001 - len(bare)))
assert doctor(target, 0)["memory"]["95-bare.md"] == {"status": "OVER", "bytes": 4001}, "a bare '> Tier: Hot' line at the end of the line counts"
target = ready_copy("memory-tier-lookalikes")
sized(target / ".memory/90-hotfix.md", 4001, tier="Hotfix")
sized(target / ".memory/91-hot-ish.md", 4001, tier="Hot-ish")
budget = doctor(target, 0)["memory"]
assert "90-hotfix.md" not in budget and "91-hot-ish.md" not in budget, budget
target = ready_copy("memory-fifo")
(target / ".memory/40-active.md").unlink()
os.mkfifo(target / ".memory/40-active.md")
assert doctor(target, 1)["memory"]["40-active.md"]["status"] == "UNSAFE", "a FIFO must be UNSAFE and must not block the read"
print("PASS: a missing Hot file is MISSING; a linked or FIFO Hot file is UNSAFE and never read; an unnamed Hot-tier file is counted")

# The index: MISSING, UNKNOWN (non-git and a folder inside a repo), CURRENT, STALE (commit after indexing), INCOMPLETE, UNREADABLE.
def git(*args, cwd):
    return subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


def index_run(folder):
    subprocess.run(["bash", str(harness / "bin/sh-index.sh"), str(folder)], check=True, capture_output=True)
    return (folder / "ai_rules/context_map.md").read_text(encoding="utf-8")


def write_package(folder):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "package.json").write_text('{"name":"index-fixture","scripts":{"test":"node t.js"}}\n')


def resign(path, text):
    """Write a generated-looking map whose integrity marker matches its body (what sh-index.sh would write)."""
    import hashlib
    body = text.split("<!-- spec-harness-index:v1")[0]
    digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
    path.write_text(body + f"<!-- spec-harness-index:v1 sha256={digest} -->\n", encoding="utf-8")


repo = tmp / "index-repo"
write_package(repo)
assert doctor(repo, 1)["index"]["status"] == "MISSING"
git("init", "-q", cwd=repo)
git("add", "package.json", cwd=repo)
git("commit", "-q", "-m", "first", cwd=repo)
head = git("rev-parse", "HEAD", cwd=repo)
context = index_run(repo)
assert f"- Source HEAD: `{head}`" in context, context
state = doctor(repo, 1)["index"]
assert state["status"] == "CURRENT" and state["source_head"] == head == state["current_head"], state
(repo / "index.js").write_text("export {};\n")
git("add", "index.js", cwd=repo)
git("commit", "-q", "-m", "later", cwd=repo)
assert doctor(repo, 1)["index"]["status"] == "STALE", doctor(repo, 1)["index"]

incomplete = tmp / "index-incomplete"
shutil.copytree(repo, incomplete, symlinks=True)
index_run(incomplete)
map_path = incomplete / "ai_rules/context_map.md"
resign(map_path, map_path.read_text(encoding="utf-8").replace("Scan complete: `true`", "Scan complete: `false`"))
assert doctor(incomplete, 1)["index"]["status"] == "INCOMPLETE"

# A hand-edited generated map with a broken marker and no JSON has no usable record: UNKNOWN, never CURRENT.
broken = tmp / "index-broken-marker"
write_package(broken)
git("init", "-q", cwd=broken)
git("add", "package.json", cwd=broken)
git("commit", "-q", "-m", "first", cwd=broken)
index_run(broken)
broken_map = broken / "ai_rules/context_map.md"
broken_map.write_text(broken_map.read_text(encoding="utf-8") + "- hand edit\n")
state = doctor(broken, 1)["index"]
assert state["status"] == "UNKNOWN" and "not a generated map" in state["note"], state

# A validly marked map with no Scan complete line has no usable record: UNKNOWN.
no_scan_line = tmp / "index-no-scan-line"
shutil.copytree(repo, no_scan_line, symlinks=True)
index_run(no_scan_line)
map_text = (no_scan_line / "ai_rules/context_map.md").read_text(encoding="utf-8")
resign(no_scan_line / "ai_rules/context_map.md", "\n".join(line for line in map_text.splitlines() if not line.startswith("- Scan complete")) + "\n")
assert doctor(no_scan_line, 1)["index"]["status"] == "UNKNOWN", doctor(no_scan_line, 1)["index"]

# A committed generated map: HEAD moves only through ai_rules/, which stays CURRENT; a source commit makes it STALE.
committed = tmp / "index-committed-map"
write_package(committed)
git("init", "-q", cwd=committed)
git("add", "package.json", cwd=committed)
git("commit", "-q", "-m", "first", cwd=committed)
index_run(committed)
git("add", "ai_rules", cwd=committed)
git("commit", "-q", "-m", "commit the map", cwd=committed)
assert doctor(committed, 1)["index"]["status"] == "CURRENT", doctor(committed, 1)["index"]
(committed / "index.js").write_text("export {};\n")
git("add", "index.js", cwd=committed)
git("commit", "-q", "-m", "source change", cwd=committed)
assert doctor(committed, 1)["index"]["status"] == "STALE", doctor(committed, 1)["index"]

# A map that is a symlink is not read; the JSON record next to it is used instead.
maplink = tmp / "index-map-symlink"
write_package(maplink)
git("init", "-q", cwd=maplink)
git("add", "package.json", cwd=maplink)
git("commit", "-q", "-m", "first", cwd=maplink)
(maplink / "ai_rules").mkdir()
(maplink / "ai_rules/context_map.md").write_text("# hand-written map\n")
subprocess.run(["bash", str(harness / "bin/sh-index.sh"), str(maplink)], check=True, capture_output=True)
(maplink / "ai_rules/context_map.md").unlink()
(maplink / "ai_rules/context_map.md").symlink_to(maplink / "package.json")
assert doctor(maplink, 1)["index"]["status"] == "CURRENT", doctor(maplink, 1)["index"]

# A crafted source_head is never sent to git: an option, a ref name, or a non-id is UNKNOWN and writes nothing.
inject = tmp / "index-inject"
write_package(inject)
git("init", "-q", cwd=inject)
git("add", "package.json", cwd=inject)
git("commit", "-q", "-m", "first", cwd=inject)
(inject / "ai_rules").mkdir()
(inject / "ai_rules/context_map.md").write_text("# hand-written map\n")
subprocess.run(["bash", str(harness / "bin/sh-index.sh"), str(inject)], check=True, capture_output=True)
pwned = tmp / "PWNED.txt"
inventory_path = inject / "ai_rules/project_inventory.json"
for crafted in (f"--output={pwned}", "HEAD", "-h"):
    data = json.loads(inventory_path.read_text(encoding="utf-8"))
    data["scan"]["source_head"] = crafted
    inventory_path.write_text(json.dumps(data))
    state = doctor(inject, 1)["index"]
    assert state["status"] == "UNKNOWN" and "not a full commit id" in state["note"], (crafted, state)
assert not pwned.exists(), "a crafted source_head must not make git write a file"

# An empty commit after indexing is STALE, as the spec says (goal GA5).
emptyc = tmp / "index-empty-commit"
write_package(emptyc)
git("init", "-q", cwd=emptyc)
git("add", "package.json", cwd=emptyc)
git("commit", "-q", "-m", "first", cwd=emptyc)
index_run(emptyc)
git("commit", "-q", "--allow-empty", "-m", "empty", cwd=emptyc)
assert doctor(emptyc, 1)["index"]["status"] == "STALE", doctor(emptyc, 1)["index"]

# A rule module under ai_rules/ is not an index file: a commit that adds one is STALE.
rulemod = tmp / "index-rule-module"
write_package(rulemod)
git("init", "-q", cwd=rulemod)
git("add", "package.json", cwd=rulemod)
git("commit", "-q", "-m", "first", cwd=rulemod)
index_run(rulemod)
(rulemod / "ai_rules/rules").mkdir(parents=True)
(rulemod / "ai_rules/rules/core.md").write_text("# core\n")
git("add", "ai_rules/rules", cwd=rulemod)
git("commit", "-q", "-m", "rule module", cwd=rulemod)
assert doctor(rulemod, 1)["index"]["status"] == "STALE", doctor(rulemod, 1)["index"]

# A source file moved to a new name under ai_rules/ is STALE by the two-file rule (the next fixture covers renames onto an index file).
moved = tmp / "index-moved-into-rules"
write_package(moved)
(moved / "src").mkdir()
(moved / "src/a.ts").write_text("export const a = 1;\n")
git("init", "-q", cwd=moved)
git("add", ".", cwd=moved)
git("commit", "-q", "-m", "first", cwd=moved)
index_run(moved)
git("mv", "src/a.ts", "ai_rules/a.ts", cwd=moved)
git("commit", "-q", "-m", "move", cwd=moved)
assert doctor(moved, 1)["index"]["status"] == "STALE", doctor(moved, 1)["index"]

# A source file renamed onto one of the index's own files is STALE: with renames on, git would list only the destination.
renamed_in = tmp / "index-renamed-onto-inventory"
write_package(renamed_in)
(renamed_in / "src").mkdir()
pad = "x" * 400
(renamed_in / "src/inv.json").write_text(json.dumps({"scan": {"complete": True, "source_head": "PLACEHOLDER", "pad": pad}}, indent=2))
git("init", "-q", cwd=renamed_in)
git("add", ".", cwd=renamed_in)
git("commit", "-q", "-m", "first", cwd=renamed_in)
base = git("rev-parse", "HEAD", cwd=renamed_in)
# The same file, with the placeholder replaced by the base commit, is moved onto the inventory name: a rename git detects.
(renamed_in / "ai_rules").mkdir()
git("mv", "src/inv.json", "ai_rules/project_inventory.json", cwd=renamed_in)
(renamed_in / "ai_rules/project_inventory.json").write_text(json.dumps({"scan": {"complete": True, "source_head": base, "pad": pad}}, indent=2))
git("add", "-A", cwd=renamed_in)
git("commit", "-q", "-m", "rename a source file onto the inventory", cwd=renamed_in)
(renamed_in / "ai_rules/context_map.md").write_text("# hand-written map\n")
assert doctor(renamed_in, 1)["index"]["status"] == "STALE", doctor(renamed_in, 1)["index"]

# A partial clone (extensions.partialclone) is UNKNOWN when HEAD differs: the comparison may need objects git would fetch.
partial = tmp / "index-partial-clone"
write_package(partial)
git("init", "-q", cwd=partial)
git("add", "package.json", cwd=partial)
git("commit", "-q", "-m", "first", cwd=partial)
index_run(partial)
(partial / "index.js").write_text("export {};\n")
git("add", "index.js", cwd=partial)
git("commit", "-q", "-m", "source change", cwd=partial)
git("config", "extensions.partialclone", "origin", cwd=partial)
state = doctor(partial, 1)["index"]
assert state["status"] == "UNKNOWN" and "partial clone" in state["note"], state

# A real filtered clone from a local bare repo (no network): git records a promisor remote, and the doctor must treat it as partial.
origin_bare = tmp / "origin-bare.git"
subprocess.run(["git", "init", "-q", "--bare", "--initial-branch=main", str(origin_bare)], check=True)
subprocess.run(["git", "-C", str(origin_bare), "config", "uploadpack.allowFilter", "true"], check=True)
source = tmp / "index-filter-source"
write_package(source)
git("init", "-q", cwd=source)
git("add", "package.json", cwd=source)
git("commit", "-q", "-m", "first", cwd=source)
git("push", "-q", str(origin_bare), "HEAD:refs/heads/main", cwd=source)
clone = tmp / "index-filter-clone"
subprocess.run(["git", "clone", "-q", "--filter=blob:none", f"file://{origin_bare}", str(clone)], check=True, capture_output=True)
assert git("config", "--get", "remote.origin.promisor", cwd=clone) == "true", "the clone must be a real promisor clone"
(clone / "ai_rules").mkdir(exist_ok=True)
(clone / "ai_rules/project_inventory.json").write_text(json.dumps({"scan": {"complete": True, "source_head": "1" * 40}}))
state = doctor(clone, 1)["index"]
assert state["status"] == "UNKNOWN" and "partial clone" in state["note"], state

# A repository whose only partial-clone mark is remote.<name>.promisor=true (no extensions key) is also partial.
promisor = tmp / "index-promisor-only"
write_package(promisor)
git("init", "-q", cwd=promisor)
git("add", "package.json", cwd=promisor)
git("commit", "-q", "-m", "first", cwd=promisor)
git("config", "remote.origin.promisor", "true", cwd=promisor)
(promisor / "ai_rules").mkdir(exist_ok=True)
(promisor / "ai_rules/project_inventory.json").write_text(json.dumps({"scan": {"complete": True, "source_head": "1" * 40}}))
state = doctor(promisor, 1)["index"]
assert state["status"] == "UNKNOWN" and "partial clone" in state["note"], state

# Any partial-clone or promisor setting makes the repo partial, whatever its value, so a fetch is never attempted.
for label, setup in (
    ("filter-only", lambda folder: git("config", "remote.origin.partialclonefilter", "blob:none", cwd=folder)),
    ("bare-promisor", lambda folder: (folder / ".git/config").write_text((folder / ".git/config").read_text() + '[remote "origin"]\n\tpromisor\n')),
    ("promisor-false", lambda folder: git("config", "remote.origin.promisor", "false", cwd=folder)),
    ("spaced-remote", lambda folder: git("config", "remote.my remote.promisor", "true", cwd=folder)),
):
    folder = tmp / f"index-partial-{label}"
    write_package(folder)
    git("init", "-q", cwd=folder)
    git("add", "package.json", cwd=folder)
    git("commit", "-q", "-m", "first", cwd=folder)
    setup(folder)
    (folder / "ai_rules").mkdir(exist_ok=True)
    (folder / "ai_rules/project_inventory.json").write_text(json.dumps({"scan": {"complete": True, "source_head": "1" * 40}}))
    state = doctor(folder, 1)["index"]
    assert state["status"] == "UNKNOWN" and "partial clone" in state["note"], (label, state)

# If the partial-clone config read fails with an unexpected status, the repo counts as partial: UNKNOWN, never a fetch.
failing = tmp / "index-config-read-fails"
write_package(failing)
git("init", "-q", cwd=failing)
git("add", "package.json", cwd=failing)
git("commit", "-q", "-m", "first", cwd=failing)
index_run(failing)
(failing / "index.js").write_text("export {};\n")
git("add", "index.js", cwd=failing)
git("commit", "-q", "-m", "source change", cwd=failing)
wrapper_dir = tmp / "git-wrapper"
wrapper_dir.mkdir()
real_git = shutil.which("git")
(wrapper_dir / "git").write_text(f'#!/bin/sh\nfor arg in "$@"; do case "$arg" in --get-regexp) exit 3;; esac; done\nexec {shlex.quote(real_git)} "$@"\n')
(wrapper_dir / "git").chmod(0o755)
wrapped = subprocess.run(["bash", str(harness / "bin/spec-harness"), "doctor", str(failing)], capture_output=True, text=True,
                         env=dict(os.environ, PATH=f"{wrapper_dir}{os.pathsep}{os.environ['PATH']}"))
state = json.loads(wrapped.stdout)["index"]
assert state["status"] == "UNKNOWN" and "partial clone" in state["note"], state

# A map that is a symlink with no inventory JSON is UNREADABLE (it is never followed).
linked_only = tmp / "index-link-only"
write_package(linked_only)
(linked_only / "ai_rules").mkdir()
(linked_only / "ai_rules/context_map.md").symlink_to(linked_only / "package.json")
assert doctor(linked_only, 1)["index"]["status"] == "UNREADABLE", doctor(linked_only, 1)["index"]

# A folder inside a larger repo whose record holds the outer HEAD is UNKNOWN: the doctor never compares it as the folder's own HEAD.
outer = tmp / "index-outer"
outer.mkdir()
git("init", "-q", cwd=outer)
(outer / "outer.txt").write_text("outer\n")
git("add", "outer.txt", cwd=outer)
git("commit", "-q", "-m", "outer", cwd=outer)
outer_head = git("rev-parse", "HEAD", cwd=outer)
inner = outer / "sub"
write_package(inner)
(inner / "ai_rules").mkdir()
(inner / "ai_rules/context_map.md").write_text("# hand-written map\n")
subprocess.run(["bash", str(harness / "bin/sh-index.sh"), str(inner)], check=True, capture_output=True)
inner_inventory = json.loads((inner / "ai_rules/project_inventory.json").read_text(encoding="utf-8"))
inner_inventory["scan"]["source_head"] = outer_head
(inner / "ai_rules/project_inventory.json").write_text(json.dumps(inner_inventory))
state = doctor(inner, 1)["index"]
assert state["status"] == "UNKNOWN", state

# A folder with no git: the inventory JSON's source_head is null, asserted directly (not only by the pinned hash).
nongit_json = tmp / "index-nongit-json"
write_package(nongit_json)
(nongit_json / "ai_rules").mkdir()
(nongit_json / "ai_rules/context_map.md").write_text("# hand-written map\n")
subprocess.run(["bash", str(harness / "bin/sh-index.sh"), str(nongit_json)], check=True, capture_output=True)
assert json.loads((nongit_json / "ai_rules/project_inventory.json").read_text(encoding="utf-8"))["scan"]["source_head"] is None

# A stale JSON left from an earlier hand-written map must not override a freshly generated map.
leftover = tmp / "index-leftover-json"
shutil.copytree(repo, leftover, symlinks=True)
shutil.rmtree(leftover / "ai_rules", ignore_errors=True)
(leftover / "ai_rules").mkdir()
(leftover / "ai_rules/context_map.md").write_text("# hand-written map\n")
subprocess.run(["bash", str(harness / "bin/sh-index.sh"), str(leftover)], check=True, capture_output=True)
git("commit", "-q", "--allow-empty", "-m", "newer", cwd=leftover)
(leftover / "ai_rules/context_map.md").unlink()
index_run(leftover)
assert (leftover / "ai_rules/project_inventory.json").exists(), "the index never deletes an old JSON, so this case exists"
assert doctor(leftover, 1)["index"]["status"] == "CURRENT", doctor(leftover, 1)["index"]

plain = tmp / "index-plain"
write_package(plain)
assert "- Source HEAD: `none`" in index_run(plain)
assert doctor(plain, 1)["index"]["status"] == "UNKNOWN"

nested = tmp / "index-nested"
nested.mkdir()
git("init", "-q", cwd=nested)
(nested / "outer.txt").write_text("outer\n")
git("add", "outer.txt", cwd=nested)
git("commit", "-q", "-m", "outer", cwd=nested)
assert git("rev-parse", "HEAD", cwd=nested), "the outer repo must have a HEAD, or the test proves nothing"
write_package(nested / "sub")
assert "- Source HEAD: `none`" in index_run(nested / "sub"), "a folder inside a repo must not report the outer HEAD"
assert doctor(nested / "sub", 1)["index"]["status"] == "UNKNOWN"

json_incomplete = tmp / "index-json-incomplete"
shutil.copytree(repo, json_incomplete, symlinks=True)
shutil.rmtree(json_incomplete / "ai_rules", ignore_errors=True)
(json_incomplete / "ai_rules").mkdir()
(json_incomplete / "ai_rules/context_map.md").write_text("# hand-written map\n")
subprocess.run(["bash", str(harness / "bin/sh-index.sh"), str(json_incomplete)], check=True, capture_output=True)
inventory_path = json_incomplete / "ai_rules/project_inventory.json"
inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
inventory["scan"]["complete"] = False
inventory_path.write_text(json.dumps(inventory))
assert doctor(json_incomplete, 1)["index"]["status"] == "INCOMPLETE"

custom = tmp / "index-custom"
shutil.copytree(repo, custom, symlinks=True)
shutil.rmtree(custom / "ai_rules", ignore_errors=True)
(custom / "ai_rules").mkdir()
(custom / "ai_rules/context_map.md").write_text("# hand-written map\n")
subprocess.run(["bash", str(harness / "bin/sh-index.sh"), str(custom)], check=True, capture_output=True)
data = json.loads((custom / "ai_rules/project_inventory.json").read_text(encoding="utf-8"))
assert data["scan"]["source_head"] == git("rev-parse", "HEAD", cwd=custom), data["scan"]
assert doctor(custom, 1)["index"]["status"] == "CURRENT", doctor(custom, 1)["index"]

for label, payload in (("not-json", "{ not json"), ("not-object", "[]"), ("complete-not-bool", '{"scan":{"complete":"false"}}')):
    bad = tmp / f"index-bad-{label}"
    write_package(bad)
    (bad / "ai_rules").mkdir()
    (bad / "ai_rules/context_map.md").write_text("# hand-written map\n")
    (bad / "ai_rules/project_inventory.json").write_text(payload)
    assert doctor(bad, 1)["index"]["status"] == "UNREADABLE", (label, doctor(bad, 1)["index"])

# The index state does not change the exit code: a READY target with no index stays READY (exit 0).
ready_index = ready_copy("index-ready")
assert doctor(ready_index, 0)["index"]["status"] == "UNKNOWN", doctor(ready_index, 0)["index"]
print("PASS: index states MISSING, UNKNOWN (non-git and a folder inside a repo), CURRENT, STALE, INCOMPLETE, UNREADABLE")
print("All doctor fixtures passed.")
PY
