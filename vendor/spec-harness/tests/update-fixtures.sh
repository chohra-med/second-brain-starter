#!/usr/bin/env bash
# status / update / uninstall on a disposable harness copy and disposable targets. No network.
# Covers: fresh install -> all UNCHANGED; template change -> UPDATE; local edit with an unchanged
# template -> CUSTOMIZED-KEEP; both changed without overlap -> MERGE; overlap -> CONFLICT with a
# proposed file; NEW; REMOVED-UPSTREAM (never deleted); a rename from install-migrations.tsv;
# a wrong digest is refused; a second update is idempotent; synthesis outputs are never written and
# synthesis is marked stale; an install without a record; uninstall is plan-only.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=lib/portable.sh
. "$ROOT/tests/lib/portable.sh"
require_tools bash git
require_python311
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sh-update.XXXXXX")" || exit 1
trap 'rm -rf "$TMP"' EXIT

python3 -I -B - "$ROOT" "$TMP" <<'PY'
import hashlib, json, os, re, shutil, subprocess, sys
from pathlib import Path

root, tmp = Path(sys.argv[1]), Path(sys.argv[2])
sys.path.insert(0, str(root / "tests/lib"))
import ready_fixture as fx

harness = tmp / "harness"
harness.mkdir()
for name in ("bin", "hooks", "agents", "commands", "skills", "templates"):
    shutil.copytree(root / name, harness / name)
for name in ("install-manifest.json", "install-migrations.tsv", "package.json", "learning_human.html"):
    shutil.copy2(root / name, harness / name)
(harness / "docs").mkdir()
shutil.copy2(root / "docs/MEMORY.md", harness / "docs/MEMORY.md")
git = ["git", "-C", str(harness), "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false"]
subprocess.run(["git", "init", "-q", str(harness)], check=True)
subprocess.run(git + ["add", "-A"], check=True)
subprocess.run(git + ["commit", "-q", "-m", "fixture harness"], check=True)
commit = subprocess.run(["git", "-C", str(harness), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
CLI = ["bash", str(harness / "bin/spec-harness")]


def run(args, expected, label):
    result = subprocess.run(args, capture_output=True, text=True)
    output = result.stdout + result.stderr
    assert result.returncode == expected, f"{label}: expected exit {expected}, got {result.returncode}\n{output}"
    return output


def plan(target):
    out = run(CLI + ["update", str(target)], 0, "update plan")
    states = {}
    for line in out.splitlines():
        match = re.match(r"\s+(UNCHANGED|UPDATE|CUSTOMIZED-KEEP|MERGE|CONFLICT|NEW|REMOVED-UPSTREAM)\s+(\S+)", line)
        if match:
            states[match.group(2)] = match.group(1)
    digest = re.search(r"PLAN DIGEST: ([0-9a-f]{64})", out).group(1)
    return states, digest, out


def install(target, name="demo"):
    target.mkdir(parents=True, exist_ok=True)
    run(CLI + ["init", str(target), "integrate", name], 0, "install")


def edit_source(rel, old, new):
    path = harness / rel
    text = path.read_text()
    assert text.count(old) >= 1, (rel, old)
    path.write_text(text.replace(old, new, 1))


def commit_source(message):
    subprocess.run(git + ["commit", "-q", "-am", message], check=True)


# 1. A fresh install: status names the installed and source commit; the plan is all UNCHANGED.
target = tmp / "target"
install(target)
record = json.loads((target / ".spec-harness/install.json").read_text())
assert record["harness_commit"] == commit and record["project_name"] == "demo"
out = run(CLI + ["status", str(target)], 0, "status")
assert f"installed commit  : {commit}" in out and f"source commit     : {commit}" in out and "update available  : no" in out, out
states, digest, out = plan(target)
assert states and set(states.values()) == {"UNCHANGED"}, out
assert "Nothing to apply." in out
before = fx.snapshot(target)
run(CLI + ["update", str(target), "--apply", digest], 0, "apply the empty plan")
after = fx.snapshot(target)
assert {k: v for k, v in after.items() if k != ".spec-harness/install.json"} == {k: v for k, v in before.items() if k != ".spec-harness/install.json"}
print(f"PASS: fresh install -> {len(states)} files UNCHANGED; status shows installed and source commit; no update available")

# 2. Template changes upstream: UPDATE (untouched file), CUSTOMIZED-KEEP (local edit, template
#    unchanged), MERGE (both changed, no overlap), CONFLICT (overlap), NEW, REMOVED-UPSTREAM, rename.
(target / ".claude/commands/spec-harness/tasks.md").write_text((target / ".claude/commands/spec-harness/tasks.md").read_text() + "\nLocal note kept by the team.\n")
build = target / ".claude/commands/spec-harness/build.md"
build_lines = build.read_text().splitlines(keepends=True)
build.write_text("".join(["Local preface line.\n"] + build_lines))
verify = target / ".claude/commands/spec-harness/verify.md"
verify_lines = verify.read_text().splitlines(keepends=True)
verify.write_text("".join(["# Local title for verify\n"] + verify_lines[1:]))

edit_source("commands/plan.md", "\n", "\nUpstream plan change.\n")
source_build = (harness / "commands/build.md").read_text()
(harness / "commands/build.md").write_text(source_build + "\nUpstream build appendix.\n")
source_verify = (harness / "commands/verify.md").read_text().splitlines(keepends=True)
(harness / "commands/verify.md").write_text("".join(["# Upstream title for verify\n"] + source_verify[1:]))
(harness / "commands/newthing.md").write_text("# New method\n\nShipped by the newer harness.\n")
(harness / "commands/audit.md").unlink()
(harness / "commands/teach.md").rename(harness / "commands/teach-human.md")
with open(harness / "install-migrations.tsv", "a", encoding="utf-8") as handle:
    handle.write(".claude/commands/spec-harness/teach.md\t.claude/commands/spec-harness/teach-human.md\t0.4.0\n")
subprocess.run(git + ["add", "-A"], check=True)
commit_source("upstream template changes")

out = run(CLI + ["status", str(target)], 0, "status after upstream change")
assert "update available  : yes" in out, out
states, digest, out = plan(target)
expect = {
    ".claude/commands/spec-harness/plan.md": "UPDATE",
    ".claude/commands/spec-harness/tasks.md": "CUSTOMIZED-KEEP",
    ".claude/commands/spec-harness/build.md": "MERGE",
    ".claude/commands/spec-harness/verify.md": "CONFLICT",
    ".claude/commands/spec-harness/newthing.md": "NEW",
    ".claude/commands/spec-harness/audit.md": "REMOVED-UPSTREAM",
    ".claude/commands/spec-harness/teach-human.md": "NEW",
    ".claude/commands/spec-harness/teach.md": "REMOVED-UPSTREAM",
}
for path, state in expect.items():
    assert states.get(path) == state, (path, states.get(path), out)
assert "renamed from .claude/commands/spec-harness/teach.md" in out and "renamed to .claude/commands/spec-harness/teach-human.md" in out
print("PASS: plan shows UPDATE, CUSTOMIZED-KEEP, MERGE, CONFLICT, NEW, REMOVED-UPSTREAM and the rename notes")

# 3. A wrong digest is refused and nothing changes.
snapshot = fx.snapshot(target)
wrong = run(CLI + ["update", str(target), "--apply", "0" * 64], 1, "wrong digest")
assert "does not match the current plan" in wrong and fx.snapshot(target) == snapshot
run(CLI + ["update", str(target), "--apply", "not-a-digest"], 1, "malformed digest")
print("RED control observed: a wrong or malformed digest is refused and no byte changes")

# 4. Apply exactly the reviewed plan.
out = run(CLI + ["update", str(target), "--apply", digest], 0, "apply")
assert (target / ".claude/commands/spec-harness/plan.md").read_bytes() == (harness / "commands/plan.md").read_bytes()
assert (target / ".claude/commands/spec-harness/tasks.md").read_text().endswith("Local note kept by the team.\n")
merged = build.read_text()
assert merged.startswith("Local preface line.\n") and merged.endswith("Upstream build appendix.\n") and "<<<<<<<" not in merged
assert verify.read_text().startswith("# Local title for verify\n"), "a CONFLICT path was overwritten"
proposed = (target / ".claude/commands/spec-harness/verify.md.spec-harness-proposed").read_text()
assert "<<<<<<< local" in proposed and ">>>>>>> harness" in proposed
assert (target / ".claude/commands/spec-harness/newthing.md").is_file()
assert (target / ".claude/commands/spec-harness/teach-human.md").is_file()
assert (target / ".claude/commands/spec-harness/audit.md").is_file() and (target / ".claude/commands/spec-harness/teach.md").is_file()
record = json.loads((target / ".spec-harness/install.json").read_text())
assert record["harness_commit"] != commit and (target / ".spec-harness/base/.claude/commands/spec-harness/build.md").read_bytes() == (harness / "commands/build.md").read_bytes()
assert not (target / ".spec-harness/synthesis-stale.json").exists(), "H1: an update with no receipt wrote a stale marker"
print("PASS: apply wrote UPDATE/MERGE/NEW, kept CUSTOMIZED-KEEP and the CONFLICT file, wrote one proposal, deleted nothing")

# 5. A second update is idempotent: nothing actionable except the unresolved conflict.
states, digest2, out = plan(target)
assert all(state in {"UNCHANGED", "CUSTOMIZED-KEEP", "REMOVED-UPSTREAM", "CONFLICT"} for state in states.values()), out
assert states[".claude/commands/spec-harness/build.md"] == "CUSTOMIZED-KEEP" and states[".claude/commands/spec-harness/plan.md"] == "UNCHANGED"
snapshot = fx.snapshot(target)
run(CLI + ["update", str(target), "--apply", digest2], 0, "second apply")
again = fx.snapshot(target)
changed = sorted(path for path in set(snapshot) | set(again) if snapshot.get(path) != again.get(path))
assert changed == [".spec-harness/install.json"] or changed == [], changed
assert plan(target)[1] == digest2
print("PASS: the second update is idempotent (same plan digest; only the record is rewritten)")

# 6. Synthesis outputs are never written; an update after synthesis marks it stale for --check.
ready = tmp / "ready"
fx.build(ready, harness)
install(ready, "ready")
assert "READY:" in run(CLI + ["generate-agents", "--check", str(ready)], 0, "ready before update")
reviewer = ready / ".claude/agents/sdd-reviewer.md"
reviewer_bytes = reviewer.read_bytes()
edit_source("agents/sdd-reviewer.md", "\n", "\nUpstream reviewer change.\n")
edit_source("commands/tasks.md", "\n", "\nUpstream tasks change.\n")
commit_source("reviewer and tasks change")
states, digest, out = plan(ready)
assert states[".claude/agents/sdd-reviewer.md"] == "CUSTOMIZED-KEEP" and "synthesis output" in out, out
assert states[".claude/commands/spec-harness/tasks.md"] == "UPDATE"
run(CLI + ["update", str(ready), "--apply", digest], 0, "apply on an initialized target")
assert reviewer.read_bytes() == reviewer_bytes, "update wrote a synthesis output"
stale = run(CLI + ["generate-agents", "--check", str(ready)], 1, "check after update")
assert "harness update applied after synthesis" in stale, stale
print("RED control observed: after an update, generate-agents --check reports stale synthesis; the role binding was not touched")
# H8: a byte-only rewrite of the receipt (a re-indent) must not clear the marker. Only its removal does.
receipt = ready / ".claude/agents/.init-synthesis.json"
receipt.write_text(json.dumps(json.loads(receipt.read_text()), indent=4) + "\n")
blocked = run(CLI + ["generate-agents", "--check", str(ready)], 1, "re-indented receipt while marked")
assert "READY:" not in blocked and ".spec-harness/synthesis-stale.json" in blocked and "removes" in blocked, blocked
print("RED control observed (H8): a re-indented receipt does not clear the marker; the check names the file and says init removes it")
(ready / ".spec-harness/synthesis-stale.json").unlink()
assert "READY:" in run(CLI + ["generate-agents", "--check", str(ready)], 0, "READY once init removes the marker")
print("PASS: READY needs the marker removed by init, whatever the receipt bytes")

# 7. An install without a record (installed before 0.4.0): status says so; update adopts.
legacy = tmp / "legacy"
install(legacy)
shutil.rmtree(legacy / ".spec-harness")
(legacy / ".claude/commands/spec-harness/learn.md").write_text("# team version\n")
out = run(CLI + ["status", str(legacy)], 0, "legacy status")
assert "no .spec-harness/install.json" in out
states, digest, out = plan(legacy)
assert states[".claude/commands/spec-harness/learn.md"] == "CUSTOMIZED-KEEP" and "no install record" in out
run(CLI + ["update", str(legacy), "--apply", digest], 0, "legacy apply")
assert (legacy / ".claude/commands/spec-harness/learn.md").read_text() == "# team version\n"
record = json.loads((legacy / ".spec-harness/install.json").read_text())
assert record["files"][".claude/commands/spec-harness/plan.md"]["managed"] and ".claude/commands/spec-harness/learn.md" not in record["files"]
print("PASS: an install without a record keeps differing files and adopts identical ones")

# 8. uninstall is plan-only and lists exactly the recorded files.
snapshot = fx.snapshot(target)
out = run(CLI + ["uninstall", str(target)], 0, "uninstall plan")
assert "nothing is deleted" in out and "EDITED since install" in out and ".claude/commands/spec-harness/tasks.md" in out
assert fx.snapshot(target) == snapshot
assert "harness checkout" in run(CLI + ["uninstall", str(harness)], 1, "uninstall pointed at the harness itself")
assert "predates 0.4.0" in run(CLI + ["uninstall", str(legacy / "specs")], 1, "uninstall without a record")
print("PASS: uninstall prints a plan and deletes nothing")

# 9. A planted link in the state directory is refused.
linked = tmp / "linked"
install(linked)
(linked / ".spec-harness/install.json").rename(tmp / "moved-record.json")
(linked / ".spec-harness/install.json").symlink_to(tmp / "moved-record.json")
out = run(CLI + ["update", str(linked)], 1, "symlinked record")
assert "PENDING" in out and "not a regular" in out, out
print("RED control observed: a symlinked install record is refused")

# 10. A git merge-file error (exit 255) is not a conflict count. The update must refuse the plan.
#     The stub sits first on PATH and sends every other git call to the real binary.
merge = tmp / "merge-error"
install(merge)
build_local = merge / ".claude/commands/spec-harness/build.md"
build_local.write_text("Local preface line.\n" + build_local.read_text())
(harness / "commands/build.md").write_text((harness / "commands/build.md").read_text() + "\nSecond upstream appendix.\n")
subprocess.run(git + ["add", "-A"], check=True)
commit_source("build change for the merge error case")
states, _, out = plan(merge)
assert states[".claude/commands/spec-harness/build.md"] == "MERGE", ("positive control: the scenario must need a merge", out)
print("PASS positive control: the scenario needs a three-way merge (build.md is MERGE with the real git)")

real_git = shutil.which("git")
stub_dir = tmp / "git-stub"
stub_dir.mkdir()
(stub_dir / "git").write_text('#!/bin/bash\nif [ "$1" = merge-file ]; then echo "simulated merge-file error" >&2; exit 255; fi\nexec "%s" "$@"\n' % real_git)
os.chmod(stub_dir / "git", 0o755)
stub_env = dict(os.environ, PATH=str(stub_dir) + os.pathsep + os.environ["PATH"])
before = fx.snapshot(merge)
result = subprocess.run(CLI + ["update", str(merge)], capture_output=True, text=True, env=stub_env)
output = result.stdout + result.stderr
assert result.returncode == 1 and "git merge-file failed" in output, ("a merge-file error must refuse the plan", result.returncode, output)
assert "conflicting hunk" not in output and "CONFLICT" not in output, output
assert fx.snapshot(merge) == before, "a refused plan wrote a byte"
print("PASS: git merge-file exit 255 refuses the plan with 'git merge-file failed' (exit 1); no CONFLICT and no byte written")

# 11. H6: a write that fails partway leaves the stale marker behind, listing every planned path, so a
#     later READY cannot pass over the files that did change. The first planned file is written; the
#     second is not (its parent directory is read-only), so apply fails with the marker already on disk.
partial = tmp / "partial"
fx.build(partial, harness)
install(partial, "partial")
edit_source("commands/plan.md", "\n", "\nUpstream plan change for the partial write.\n")
edit_source("learning_human.html", "\n", "\nUpstream explainer change for the partial write.\n")
subprocess.run(git + ["add", "-A"], check=True)
commit_source("two upstream files for the partial write case")
states, digest, out = plan(partial)
planned = sorted(path for path, state in states.items() if state in {"UPDATE", "NEW", "MERGE"})
assert planned == [".claude/commands/spec-harness/plan.md", "learning_human.html"], ("positive control: two planned writes in two directories", planned, out)
plan_before = (partial / ".claude/commands/spec-harness/plan.md").read_bytes()
os.chmod(partial, 0o555)
try:
    failed = subprocess.run(CLI + ["update", str(partial), "--apply", digest], capture_output=True, text=True)
finally:
    os.chmod(partial, 0o755)
assert failed.returncode == 1, ("apply must fail on the read-only second write", failed.returncode, failed.stdout + failed.stderr)
assert "Traceback" not in failed.stdout + failed.stderr, ("a read-only write must be a named refusal, not a traceback", failed.stderr)
assert "PENDING" in failed.stderr and "learning_human.html" in failed.stderr, ("the refusal must be a PENDING line that names the path", failed.stderr)
assert (partial / ".claude/commands/spec-harness/plan.md").read_bytes() == (harness / "commands/plan.md").read_bytes() != plan_before, "the first planned file was not written before the failure"
marker = json.loads((partial / ".spec-harness/synthesis-stale.json").read_text())
assert sorted(marker["paths"]) == planned, ("H6: the marker must list every planned path", marker, planned)
assert marker["receipt_sha256"] == hashlib.sha256((partial / ".claude/agents/.init-synthesis.json").read_bytes()).hexdigest(), "marker binds the receipt bytes as information"
print("PASS: a write that fails at file 2 leaves file 1 written and the stale marker listing both planned paths")

# 12. N1: a file the user owned before install (recorded managed: false) stays theirs. Once the user makes
#     it byte-identical to the template, update must not adopt it (no flag flip, no base copy). Uninstall
#     lists it under YOURS. If the user deletes it, update does not restore it into a path they own.
owned = tmp / "owned"
owned.mkdir()
(owned / "goal.md").write_text("# My own goal, written before the harness\n")
install(owned, "owned")
record = json.loads((owned / ".spec-harness/install.json").read_text())
assert record["files"]["goal.md"] == {"managed": False}, ("positive control: goal.md is recorded as the user's", record["files"].get("goal.md"))
scratch = tmp / "scratch-goal"
install(scratch, "owned")
shutil.copyfile(scratch / "goal.md", owned / "goal.md")
states, digest, out = plan(owned)
assert states.get("goal.md") == "UNCHANGED", ("positive control: the user's goal.md now matches the template", states.get("goal.md"), out)
run(CLI + ["update", str(owned), "--apply", digest], 0, "apply on a user-owned file that now matches the template")
record = json.loads((owned / ".spec-harness/install.json").read_text())
assert record["files"]["goal.md"] == {"managed": False}, ("N1: update flipped a user-owned record entry", record["files"]["goal.md"])
assert not (owned / ".spec-harness/base/goal.md").exists(), "N1: update wrote a base copy for a user-owned file"
kept = run(CLI + ["uninstall", str(owned)], 0, "uninstall after the no-op apply")
removable_part, yours_part = kept.split("YOURS before install (never delete):", 1)
assert "    - goal.md" in yours_part.split("\n  then delete", 1)[0], ("N1: goal.md must be listed under YOURS", kept)
assert "    - goal.md" not in removable_part, ("N1: goal.md was listed as safe to delete", kept)
(owned / "goal.md").unlink()
states, digest, out = plan(owned)
assert states.get("goal.md") == "CUSTOMIZED-KEEP" and "not restored" in out, ("N1: a deleted user-owned file must not be restored", states.get("goal.md"), out)
run(CLI + ["update", str(owned), "--apply", digest], 0, "apply after the user deleted their own file")
assert not (owned / "goal.md").exists(), "N1: update restored a file the record says is the user's"
assert json.loads((owned / ".spec-harness/install.json").read_text())["files"]["goal.md"] == {"managed": False}
print("PASS: a user-owned record entry is never adopted, flipped or restored by update; uninstall lists it under YOURS")
# A project's own copy of a harness procedure, present before install, is kept; the plan line says the
# shipped procedure differs, so the project does not silently keep running the old one.
proc = tmp / "own-procedure"
proc.mkdir()
(proc / ".claude/commands/spec-harness").mkdir(parents=True)
(proc / ".claude/commands/spec-harness/init.md").write_text("# Our own init procedure\n")
(proc / "goal.md").write_text("# Our goal\n")
install(proc, "proc")
states, digest, out = plan(proc)
assert states.get(".claude/commands/spec-harness/init.md") == "CUSTOMIZED-KEEP", (states.get(".claude/commands/spec-harness/init.md"), out)
assert "your copy of a harness procedure; the shipped version differs" in out, out
assert "goal.md  (your file from before the install; not managed by the harness)" in out, out
print("PASS: a project's own harness procedure is kept and the plan says the shipped version differs")
# 13. update --apply registers the edit guard the way install does (the --render-plan path never ran the
#     registration step). Idempotent, merges beside other hooks, never writes settings.json, and doctor
#     says hook_registered: OK afterwards.
hooked = tmp / "hook-register"
install(hooked, "hooked")
settings = hooked / ".claude/settings.local.json"
assert settings.is_file(), "positive control: the installer registers the hook"
settings.write_text(json.dumps({"permissions": {"allow": ["Read"]}, "hooks": {"PreToolUse": [
    {"matcher": "Bash", "hooks": [{"type": "command", "command": "echo mine"}]}]}}, indent=2) + "\n")
doctor = lambda target: json.loads(subprocess.run(CLI + ["doctor", str(target)], capture_output=True, text=True).stdout)
assert doctor(hooked)["guards"]["hook_registered"] == "MISSING", "positive control: not registered before the update"
_, digest, _ = plan(hooked)
out = run(CLI + ["update", str(hooked), "--apply", digest], 0, "apply registers the hook")
assert "hook registration: registered in .claude/settings.local.json" in out, out
merged = json.loads(settings.read_text())
commands = [hook["command"] for group in merged["hooks"]["PreToolUse"] for hook in group["hooks"]]
assert commands.count("echo mine") == 1 and sum("sdd-gate.sh" in c for c in commands) == 1, commands
assert merged["permissions"] == {"allow": ["Read"]}, merged
assert not (hooked / ".claude/settings.json").exists(), "update wrote the committed settings.json"
assert doctor(hooked)["guards"]["hook_registered"] == "OK", doctor(hooked)["guards_notes"]
_, digest, _ = plan(hooked)
out = run(CLI + ["update", str(hooked), "--apply", digest], 0, "second apply")
assert "hook registration: already registered in .claude/settings.local.json" in out, out
assert sum("sdd-gate.sh" in hook["command"] for group in json.loads(settings.read_text())["hooks"]["PreToolUse"] for hook in group["hooks"]) == 1
# An install from before the hook existed: no script, no registration, no record entry. Update stages and registers it.
old = tmp / "pre-hook"
install(old, "old")
(old / ".claude/spec-harness/hooks/sdd-gate.sh").unlink()
(old / ".spec-harness/base/.claude/spec-harness/hooks/sdd-gate.sh").unlink()
(old / ".claude/settings.local.json").unlink()
record = json.loads((old / ".spec-harness/install.json").read_text())
del record["files"][".claude/spec-harness/hooks/sdd-gate.sh"]
(old / ".spec-harness/install.json").write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")
states, digest, out = plan(old)
assert states.get(".claude/spec-harness/hooks/sdd-gate.sh") == "NEW", (states, out)
out = run(CLI + ["update", str(old), "--apply", digest], 0, "apply on an install from before the hook")
assert "hook registration: registered in .claude/settings.local.json" in out, out
assert doctor(old)["guards"]["hook_registered"] == "OK"
# A settings file the registrar cannot trust is left alone and named; the update itself still succeeds.
bad = tmp / "bad-settings"
install(bad, "bad")
(bad / ".claude/settings.local.json").write_text("{not json")
_, digest, _ = plan(bad)
out = run(CLI + ["update", str(bad), "--apply", digest], 0, "apply with an untrusted settings file")
assert "hook registration: NOT registered" in out and (bad / ".claude/settings.local.json").read_text() == "{not json", out
print("PASS: update --apply registers the hook (merge, idempotent, doctor OK, settings.json untouched) and names a settings file it cannot trust")
# A hook edited since install is kept (CUSTOMIZED-KEEP), so the registrar refuses it and removes the earlier entry,
# which would otherwise keep running the edited file on every edit. The hook registration line says so.
edited = tmp / "hook-edited"
install(edited, "edited")
assert doctor(edited)["guards"]["hook_registered"] == "OK", "positive control: registered after install"
with open(edited / ".claude/spec-harness/hooks/sdd-gate.sh", "a") as handle:
    handle.write("# local edit\n")
states, digest, _ = plan(edited)
assert states.get(".claude/spec-harness/hooks/sdd-gate.sh") == "CUSTOMIZED-KEEP", states
out = run(CLI + ["update", str(edited), "--apply", digest], 0, "apply over a locally edited hook")
assert "hook registration: NOT registered" in out and "earlier registration was removed" in out, out
assert not (edited / ".claude/settings.local.json").exists(), "the earlier registration still runs the edited hook"
assert doctor(edited)["guards"]["hook_registered"] == "MISSING", doctor(edited)["guards_notes"]
print("PASS: update --apply over an edited hook removes the earlier registration and says so")
print("All update fixtures passed.")
PY
