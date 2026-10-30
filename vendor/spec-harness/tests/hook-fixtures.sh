#!/usr/bin/env bash
# hooks/sdd-gate.sh: the Claude Code PreToolUse guard for Edit, Write, MultiEdit and NotebookEdit.
# Drives the real script with tool-call JSON on stdin. Covers: blocked without a run-state, allowed
# after the checkpoint stage, blocked again after the summary stage, outside-root paths (absolute, `..`,
# symlink), allowed path prefixes, a folder with no SPEC-HARNESS.md, the bypass log, fail-open on bad
# input, and paths that must never reach a shell. Further groups cover which repo the hook guards (the
# one that registered it, never the session folder), folder identity (case variants), another working
# tree anywhere below the root, a linked worktree of a harness repo, and the 7-day expiry. Block reasons
# are asserted by text needles. Controls: a hook that always allows, and mutants of the real hook (session
# folder first, string compare, no `.git` walk, no expiry) must each turn a group red.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=lib/portable.sh
. "$ROOT/tests/lib/portable.sh"
require_tools bash
require_python311
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sh-hook.XXXXXX")" || exit 1
trap 'rm -rf "$TMP"' EXIT

python3 -I -B - "$ROOT" "$TMP" <<'PY'
import json, os, subprocess, sys, time
from pathlib import Path

harness, tmp = Path(sys.argv[1]), Path(sys.argv[2])
real_hook = harness / "hooks/sdd-gate.sh"
stub_hook = tmp / "always-allow.sh"
stub_hook.write_text("#!/usr/bin/env bash\nexit 0\n")
stub_hook.chmod(0o755)
counter = [0]


def fresh(name):
    counter[0] += 1
    base = tmp / f"{name}-{counter[0]}"
    repo = base / "repo"
    (repo / "src").mkdir(parents=True)
    (base / "outside/.git").mkdir(parents=True)  # another git working tree: a worktree or copy of code
    (base / "plainout").mkdir()  # a folder in no git tree: memory, plan, scratch or temp files
    (repo / "SPEC-HARNESS.md").write_text("# status\n")
    (repo / "src/app.py").write_text("x = 1\n")
    return repo


def state(repo, completed, name="T-1"):
    folder = repo / ".spec-harness/runs" / name
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "run-state.json").write_text(json.dumps({"format": "spec-harness-run-state", "schema_version": 1,
                                                       "ticket": name, "completed": completed}))


def call(hook, repo, path, tool="Edit", cwd=None, env_extra=None, raw=None, key=None, minimal_path=False):
    payload = raw if raw is not None else json.dumps({
        "tool_name": tool, "cwd": str(cwd or repo),
        "tool_input": {key or ("notebook_path" if tool == "NotebookEdit" else "file_path"): str(path)}})
    env = {k: v for k, v in os.environ.items() if k not in ("SDD_BYPASS", "CLAUDE_PROJECT_DIR")}
    if (Path(repo) / "SPEC-HARNESS.md").is_file():
        env["CLAUDE_PROJECT_DIR"] = str(repo)  # what Claude Code sets for the project that registered the hook
    env["PATH"] = "/nonexistent" if minimal_path else env.get("PATH", "")
    for key_, value_ in (env_extra or {}).items():
        if value_ is None:
            env.pop(key_, None)
        else:
            env[key_] = value_
    return subprocess.run(["/bin/bash", str(hook)], input=payload, capture_output=True, text=True,
                          cwd=str(cwd or repo), env=env)


def run_cases(hook):
    plain_session = tmp / "plain-session"
    plain_session.mkdir(exist_ok=True)
    def allow(result, label):
        assert result.returncode == 0, (label, result.returncode, result.stdout, result.stderr)
        return result

    def block(result, label, needle=None):
        assert result.returncode == 2, (label, result.returncode, result.stdout, result.stderr)
        assert result.stderr.strip(), (label, "block needs a reason on stderr")
        if needle:
            assert needle in result.stderr, (label, needle, result.stderr)

    # 1-3: run-state decides for source files.
    repo = fresh("state")
    src = repo / "src/app.py"
    block(call(hook, repo, src), "no run-state", "/sdd")
    state(repo, ["spec", "plan"])
    block(call(hook, repo, src), "run-state before checkpoint", "/sdd")
    state(repo, ["spec", "plan", "checkpoint"])
    allow(call(hook, repo, src), "checkpoint completed")
    allow(call(hook, repo, repo / "src/new/deeper/not-yet.py", tool="Write"), "new file under a source dir after checkpoint")
    state(repo, ["spec", "plan", "checkpoint", "implement", "review", "test", "summary"], name="T-1")
    block(call(hook, repo, src), "summary completed", "/sdd")
    state(repo, ["spec", "plan", "checkpoint", "implement"], name="T-2")
    allow(call(hook, repo, src), "a second run still open")
    (repo / ".spec-harness/runs/T-2/run-state.json").write_text("{not json")
    block(call(hook, repo, src), "broken run-state is not a checkpoint", N_NO_RUN)
    (repo / ".spec-harness/runs/T-2/run-state.json").write_text(json.dumps({"completed": "checkpoint"}))
    block(call(hook, repo, src), "completed must be a list", N_NO_RUN)
    (repo / ".spec-harness/runs/T-2/run-state.json").unlink()
    (repo / ".spec-harness/runs/T-2/run-state.json").symlink_to(repo / ".spec-harness/runs/T-1/run-state.json")
    block(call(hook, repo, src), "a linked run-state is not trusted", N_NO_RUN)
    # The tool names and the notebook key.
    repo = fresh("tools")
    for tool in ("Edit", "Write", "MultiEdit"):
        block(call(hook, repo, repo / "src/app.py", tool=tool), tool, N_NO_RUN)
    block(call(hook, repo, repo / "src/nb.ipynb", tool="NotebookEdit"), "NotebookEdit", "/sdd")
    state(repo, ["spec", "plan", "checkpoint"])
    allow(call(hook, repo, repo / "src/nb.ipynb", tool="NotebookEdit"), "NotebookEdit after checkpoint")

    # MICRO: an open specs/<feature>/ticket.md (no recorded verifier PASS) allows source edits, a weaker
    # rule than a checkpoint. A recorded `RESULT: PASS` closes it again.
    repo = fresh("micro")
    src = repo / "src/app.py"
    block(call(hook, repo, src), "micro: no ticket.md", "/sdd")
    ticket = repo / "specs/fix-x/ticket.md"
    ticket.parent.mkdir(parents=True)
    ticket.write_text("# Ticket\n\nInput: fix x.\n\n## Goal checks\n1. x works\n")
    allow(call(hook, repo, src), "micro: open ticket.md")
    allow(call(hook, repo, repo / "src/new/y.py", tool="Write"), "micro: open ticket.md, new file")
    block(call(hook, repo, repo.parent / "outside/x.py"), "micro: an open ticket never allows an outside path", N_OUTSIDE)
    ticket.write_text("# Ticket\n\n## Goal checks\n1. x works\n\n## Verifier\nRESULT: PASS\n- evidence\n")
    block(call(hook, repo, src), "micro: PASS recorded and no run-state", "/sdd")
    for spelling in ("RESULT:PASS\n", "**RESULT:PASS**\n", "`RESULT: PASS`\n", "  result:  pass\n"):
        ticket.write_text("# Ticket\n\n" + spelling)
        block(call(hook, repo, src), "micro: PASS spelling " + spelling.strip(), "/sdd")
    ticket.write_text("# Ticket\n\n## Verifier\nRESULT: FAIL\n")
    allow(call(hook, repo, src), "micro: a FAIL is not a PASS, still open")
    other = repo / "specs/fix-y/ticket.md"
    other.parent.mkdir()
    other.write_text("# Ticket\n")
    ticket.write_text("RESULT: PASS\n")
    allow(call(hook, repo, src), "micro: a second ticket is still open")
    other.write_text("RESULT: PASS\n")
    block(call(hook, repo, src), "micro: both tickets closed", N_NO_RUN)
    # Links and look-alikes do not count.
    repo = fresh("micro-links")
    outside = repo.parent / "outside"
    (outside / "fix-z").mkdir()
    (outside / "fix-z/ticket.md").write_text("# open\n")
    (repo / "specs").symlink_to(outside, target_is_directory=True)
    block(call(hook, repo, repo / "src/app.py"), "micro: a symlinked specs dir does not count", "/sdd")
    (repo / "specs").unlink()
    (repo / "specs/fix-q").mkdir(parents=True)
    (repo / "specs/fix-link").symlink_to(outside / "fix-z", target_is_directory=True)
    block(call(hook, repo, repo / "src/app.py"), "micro: a symlinked feature dir does not count", "/sdd")
    (repo / "specs/fix-link").unlink()
    (repo / "specs/fix-q/ticket.md").symlink_to(outside / "fix-z/ticket.md")
    block(call(hook, repo, repo / "src/app.py"), "micro: a symlinked ticket.md does not count", "/sdd")
    (repo / "specs/fix-q/ticket.md").unlink()
    (repo / "specs/fix-q/ticket.md.bak").write_text("# open\n")
    (repo / "specs/ticket.md").write_text("# open\n")
    (repo / "specs/fix-q/spec.md").write_text("# open\n")
    block(call(hook, repo, repo / "src/app.py"), "micro: only specs/<feature>/ticket.md counts", "/sdd")

    # 4: outside the repo root, even with a valid run-state.
    repo = fresh("outside")
    state(repo, ["spec", "plan", "checkpoint"])
    outside = repo.parent / "outside"
    block(call(hook, repo, outside / "x.py"), "absolute outside path", N_OUTSIDE)
    block(call(hook, repo, "../outside/x.py"), "relative .. path", N_OUTSIDE)
    block(call(hook, repo, repo / "src/../../outside/x.py"), ".. under the root", N_OUTSIDE)
    (repo / "link").symlink_to(outside, target_is_directory=True)
    block(call(hook, repo, repo / "link/x.py"), "symlinked directory into another tree", N_OUTSIDE)
    block(call(hook, repo, repo / "link/new/deeper/x.py"), "symlinked directory, file not yet there", N_OUTSIDE)
    (outside / "real.py").write_text("y = 2\n")
    (repo / "src/alias.py").symlink_to(outside / "real.py")
    block(call(hook, repo, repo / "src/alias.py"), "symlinked file into another tree", N_OUTSIDE)
    block(call(hook, repo, repo / "specs/../../outside/x.py"), "specs/.. escaping the root", N_OUTSIDE)
    (repo.parent / "repo-sibling/.git").mkdir(parents=True)
    block(call(hook, repo, repo.parent / "repo-sibling/x.py"), "sibling git tree with the root name as a prefix", N_OUTSIDE)
    # Outside the root but in no git tree (memory, plan, scratch, temp files): allowed. Inside another git tree: blocked.
    plainout = repo.parent / "plainout"
    allow(call(hook, repo, plainout / "notes.md", tool="Write"), "outside file in no git tree")
    allow(call(hook, repo, plainout / "deep/er/new.md", tool="Write"), "outside new file in no git tree")
    allow(call(hook, repo, "../plainout/plan.md"), "relative outside file in no git tree")
    (plainout / "proj").mkdir()
    (plainout / "proj/.git").write_text("gitdir: elsewhere\n")
    block(call(hook, repo, plainout / "proj/x.py"), "a .git file (linked worktree) marks a git tree", N_OUTSIDE)
    (plainout / "nested/deeper").mkdir(parents=True)
    (plainout / "nested/.git").mkdir()
    block(call(hook, repo, plainout / "nested/deeper/x.py"), "a .git ancestor further up", N_OUTSIDE)
    # A symlink inside the repo that leaves the root is an escape even when the target is in no git tree.
    (repo / "plain-link").symlink_to(plainout, target_is_directory=True)
    block(call(hook, repo, repo / "plain-link/x.py"), "symlink out of the root into a non-git folder", N_OUTSIDE)
    # Another harness repo is not this one: its files are outside this root.
    other = repo.parent / "other-harness"
    (other / ".git").mkdir(parents=True)
    (other / "SPEC-HARNESS.md").write_text("# s\n")
    allow(call(hook, other, other / "specs/x.md", cwd=other), "inside its own harness repo the normal rules apply")
    block(call(hook, repo, other / "src/x.py"), "another harness repo from a session in this one", N_OUTSIDE)
    # No harness above the session folder: the path decides, so a harness repo is guarded from anywhere.
    unopened = fresh("unopened")
    block(call(hook, plain_session, unopened / "src/app.py", cwd=plain_session), "path in a harness repo, session elsewhere", "/sdd")
    allow(call(hook, plain_session, plain_session / "x.py", cwd=plain_session), "no harness anywhere")
    allow(call(hook, repo, repo / "specs/f/spec.md"), "inside path still fine")

    # 5: allowed prefixes need no run-state; look-alikes do.
    repo = fresh("prefix")
    for rel in ("AGENTS.md", "CLAUDE.md", "RULES.md", "pkg/RULES.md", "a/b/c/RULES.md", "learning/lessons/L1.md",
                ".agents/skills/sdd/SKILL.md", "learning/NOTES.md"):
        allow(call(hook, repo, repo / rel, tool="Write"), "init and learn file " + rel)
    for rel in ("AGENTS.md.bak", "src/AGENTS.md", "src/CLAUDE.md", "RULES.md.bak", "MYRULES.md", "RULES.mdx",
                "learning-evil/x.py", "learning.py", ".agents-evil/x.py", "src/learning/x.py"):
        block(call(hook, repo, repo / rel, tool="Write"), "not an init or learn file: " + rel, "/sdd")
    for rel in ("specs/f/spec.md", ".spec-harness/runs/T/run-state.json", ".memory/40-active.md",
                ".claude/commands/sdd.md", "ai_rules/rules/core.md", "SPEC-HARNESS.md", "specs/new/deeper/x.md"):
        allow(call(hook, repo, repo / rel, tool="Write"), "allowed prefix " + rel)
    for rel in ("specs-evil/x.py", "specs.py", ".claude-evil/x.py", "ai_rules_extra/x.py", ".memory2/x.md",
                "SPEC-HARNESS.md.bak", "src/specs/x.py", "specs/../src/x.py", "./src/x.py", "-rf.py", "a b/c d.py"):
        block(call(hook, repo, repo / rel, tool="Write"), "not an allowed prefix: " + rel, "/sdd")
    block(call(hook, repo, "-rf.py"), "leading dash, relative", "/sdd")
    # A relative path resolves against the session folder, which may be a subfolder.
    sub = repo / "src"
    block(call(hook, repo, "app.py", cwd=sub), "relative path from a subfolder", "/sdd")
    allow(call(hook, repo, "../specs/f/spec.md", cwd=sub), "relative allowed prefix from a subfolder")

    # 6: no SPEC-HARNESS.md above the path: everything is allowed.
    plain = tmp / "plain-folder"
    (plain / "deep").mkdir(parents=True, exist_ok=True)
    allow(call(hook, plain, plain / "deep/x.py", cwd=plain / "deep"), "folder without a harness")
    allow(call(hook, plain, plain / "deep/new/x.py", tool="Write", cwd=plain), "new file in a folder without a harness")

    # 7: the bypass logs one line per use; no line without it.
    repo = fresh("bypass")
    log = repo / ".spec-harness/bypass.log"
    block(call(hook, repo, repo / "src/app.py"), "no bypass", N_NO_RUN)
    assert not log.exists(), "a block without bypass must not write the log"
    allow(call(hook, repo, repo / "src/app.py", env_extra={"SDD_BYPASS": "1"}), "bypass")
    lines = log.read_text().splitlines()
    assert len(lines) == 1 and "Edit" in lines[0] and str(repo / "src/app.py") in lines[0] and "UTC" in lines[0], lines
    allow(call(hook, repo, repo / "src/app.py", tool="Write", env_extra={"SDD_BYPASS": "1"}), "bypass again")
    assert len(log.read_text().splitlines()) == 2
    block(call(hook, repo, repo / "src/app.py", env_extra={"SDD_BYPASS": "0"}), "SDD_BYPASS=0 is not a bypass", N_NO_RUN)
    block(call(hook, repo, repo / "src/app.py", env_extra={"SDD_BYPASS": "yes"}), "only the value 1 bypasses", N_NO_RUN)
    assert len(log.read_text().splitlines()) == 2
    allow(call(hook, repo, repo.parent / "outside/x.py", env_extra={"SDD_BYPASS": "1"}), "bypass outside the root")
    assert len(log.read_text().splitlines()) == 3
    weird = repo / "src" / "a\nb.py"
    allow(call(hook, repo, weird, env_extra={"SDD_BYPASS": "1"}), "bypass with a newline in the path")
    assert len(log.read_text().splitlines()) == 4, "a path cannot forge extra log lines"
    plain_log = tmp / "plain-folder/.spec-harness/bypass.log"
    allow(call(hook, plain, plain / "x.py", env_extra={"SDD_BYPASS": "1"}), "bypass outside a harness repo")
    assert not plain_log.exists(), "no log outside a harness repo"
    # The log is never reached through a link.
    repo = fresh("bypass-link")
    victim = repo.parent / "outside/victim.txt"
    victim.write_text("keep\n")
    (repo / ".spec-harness").mkdir()
    (repo / ".spec-harness/bypass.log").symlink_to(victim)
    allow(call(hook, repo, repo / "src/app.py", env_extra={"SDD_BYPASS": "1"}), "bypass with a linked log still allows")
    assert victim.read_text() == "keep\n", "the hook wrote through a linked log"

    # 8: fail open with a warning on internal errors.
    repo = fresh("failopen")
    for label, raw in (("garbage", "{{{ not json"), ("empty stdin", ""), ("json array", "[1, 2]"),
                       ("no tool_input", json.dumps({"tool_name": "Edit", "cwd": str(repo)})),
                       ("tool_input is a string", json.dumps({"tool_name": "Edit", "cwd": str(repo), "tool_input": "x"})),
                       ("file_path is a number", json.dumps({"tool_name": "Edit", "cwd": str(repo), "tool_input": {"file_path": 7}})),
                       ("empty file_path", json.dumps({"tool_name": "Edit", "cwd": str(repo), "tool_input": {"file_path": ""}})),
                       ("NUL in the path", json.dumps({"tool_name": "Edit", "cwd": str(repo), "tool_input": {"file_path": "a\u0000b"}}))):
        result = allow(call(hook, repo, "x", raw=raw), "fail open: " + label)
        assert "warning" in result.stderr.lower(), (label, result.stderr)
    result = allow(call(hook, repo, repo / "src/app.py", minimal_path=True), "no python3 on PATH")
    assert "warning" in result.stderr.lower(), result.stderr

    # Paths and JSON fields never reach a shell.
    repo = fresh("shell")
    marker = repo.parent / "PWNED"
    for rel in ("src/$(touch ../PWNED).py", "src/`touch ../PWNED`.py", "src/a;touch ../PWNED;.py", "src/'quote\".py"):
        block(call(hook, repo, repo / rel), "metacharacters stay data: " + rel, "/sdd")
    allow(call(hook, repo, repo / "src/x.py", cwd=repo, raw=json.dumps({
        "tool_name": "Edit; touch ../PWNED", "cwd": str(repo), "tool_input": {"file_path": str(repo / "specs/x.md")}})), "hostile tool name on an allowed path")
    assert not marker.exists(), "a path or field was executed"


# ---- Batch 3b groups: anchor, identity, other working trees, linked worktrees, expiry ----
N_OTHER_TREE = "another git working tree"
N_OUTSIDE = "outside the repository root"
N_LINKED = "linked worktree of the harness repository"
N_NO_RUN = "No ticket run has reached its checkpoint"
N_EXPIRED = "A run is expired"
N_SDD = "Run /sdd for this ticket first"
DAY = 24 * 60 * 60
CASE_INSENSITIVE = False
(tmp / "case-probe-file").write_text("x")
if (tmp / "CASE-PROBE-FILE").exists():
    CASE_INSENSITIVE = True


def allow(result, label):
    assert result.returncode == 0, (label, result.returncode, result.stdout, result.stderr)
    return result


def block(result, label, needle):
    assert result.returncode == 2, (label, result.returncode, result.stdout, result.stderr)
    assert needle in result.stderr, (label, needle, result.stderr)


def age(path, days):
    stamp = time.time() - days * DAY
    os.utime(path, (stamp, stamp))


(tmp / "plain-session").mkdir(exist_ok=True)


def group_nested_trees(hook):
    # Criterion 1: another working tree below the root is blocked, also under allowed folders, with and without a run.
    repo = fresh("nested")
    for rel in (".claude/worktrees/t1", "specs/clone", "learning/copy", ".memory/m", "ai_rules/r", ".agents/a", "src/vendored"):
        (repo / rel / "src").mkdir(parents=True)
        (repo / rel / ".git").mkdir()
        block(call(hook, repo, repo / rel / "src/a.py", tool="Write"), "nested clone, no run: " + rel, N_OTHER_TREE)
    (repo / ".claude/worktrees/t2/src").mkdir(parents=True)
    (repo / ".claude/worktrees/t2/.git").write_text("gitdir: /elsewhere/.git/worktrees/t2\n")
    block(call(hook, repo, repo / ".claude/worktrees/t2/src/a.py"), "a .git file marks a working tree, no run", N_OTHER_TREE)
    state(repo, ["spec", "plan", "checkpoint"])
    for rel in (".claude/worktrees/t1", "specs/clone", "learning/copy", ".memory/m", "ai_rules/r", ".agents/a", "src/vendored", ".claude/worktrees/t2"):
        block(call(hook, repo, repo / rel / "src/a.py", tool="Write"), "nested clone, open run: " + rel, N_OTHER_TREE)
    block(call(hook, repo, repo / ".claude/worktrees/t1/deep/er/new.py", tool="Write"), "new file in a nested clone", N_OTHER_TREE)
    # A `.git` in the root itself is the repo's own: not another tree.
    (repo / ".git").mkdir()
    allow(call(hook, repo, repo / "src/app.py"), "root .git is the repo itself, open run")
    allow(call(hook, repo, repo / "specs/f/spec.md", tool="Write"), "root .git, allowed folder")
    block(call(hook, repo, repo / "src/vendored/src/a.py"), "root .git does not hide a nested one", N_OTHER_TREE)


def group_anchor(hook):
    # Criterion 2: the guarded repo is the one that registered the hook, never the session folder.
    repo = fresh("anchor")
    outside = repo.parent / "outside"  # a git working tree with no SPEC-HARNESS.md
    (outside / "src").mkdir()
    block(call(hook, repo, outside / "src/a.py", cwd=outside), "cwd in an outside worktree, anchored", N_OUTSIDE)
    block(call(hook, repo, "src/a.py", cwd=outside / "src"), "relative path from an outside worktree, anchored", N_OUTSIDE)
    state(repo, ["spec", "plan", "checkpoint"])
    block(call(hook, repo, outside / "src/a.py", cwd=outside), "cwd in an outside worktree, open run", N_OUTSIDE)
    # A session folder inside another harness repo (with its own open run) does not move the guard.
    other = repo.parent / "other-harness"
    (other / "src").mkdir(parents=True)
    (other / "SPEC-HARNESS.md").write_text("# s\n")
    state(other, ["spec", "plan", "checkpoint"])
    solo = fresh("anchor-solo")
    block(call(hook, solo, solo / "src/app.py", cwd=other), "session in another harness repo with an open run", N_NO_RUN)
    allow(call(hook, other, other / "src/x.py", cwd=other, env_extra={"CLAUDE_PROJECT_DIR": str(other)}), "its own anchor, its own run")
    # Anchor unset: the repo around the script decides (an installed copy of the hook), not the session folder.
    installed = fresh("anchor-installed")
    script = installed / ".claude/spec-harness/hooks/sdd-gate.sh"
    script.parent.mkdir(parents=True)
    script.write_text(Path(hook).read_text())
    script.chmod(0o755)
    inst_outside = installed.parent / "outside"
    unset = {"CLAUDE_PROJECT_DIR": None}
    block(call(script, installed, installed / "src/app.py", cwd=other, env_extra=unset), "installed copy, session elsewhere, no run", N_NO_RUN)
    block(call(script, installed, inst_outside / "x.py", cwd=inst_outside, env_extra=unset), "installed copy, session in an outside worktree", N_OUTSIDE)
    state(installed, ["spec", "plan", "checkpoint"])
    allow(call(script, installed, installed / "src/app.py", cwd=inst_outside, env_extra=unset), "installed copy, open run")
    # A CLAUDE_PROJECT_DIR without SPEC-HARNESS.md is ignored and the script location still anchors.
    block(call(script, installed, inst_outside / "x.py", cwd=inst_outside, env_extra={"CLAUDE_PROJECT_DIR": str(inst_outside)}),
          "unusable CLAUDE_PROJECT_DIR falls back to the script", N_OUTSIDE)
    # No anchor and no harness around: nothing to guard.
    allow(call(hook, tmp / "plain-session", outside / "x.py", cwd=outside, env_extra=unset), "no anchor, no harness above")


def group_identity(hook):
    # Criterion 3: folders compare by identity, so a case variant is the same folder (case-insensitive disks only).
    if not CASE_INSENSITIVE:
        print("note: this disk is case-sensitive, so the case-variant cases do not apply here")
        return
    repo = fresh("case")
    for rel in ("specs/f", "learning", ".claude/commands", "ai_rules"):
        (repo / rel).mkdir(parents=True, exist_ok=True)
    (repo / "AGENTS.md").write_text("# a\n")
    (repo / "pkg").mkdir()
    (repo / "pkg/RULES.md").write_text("# r\n")
    variant = repo.parent / "REPO"
    assert variant.exists() and os.path.samestat(os.stat(variant), os.stat(repo))
    block(call(hook, repo, variant / "src/app.py"), "root case variant, no run", N_NO_RUN)
    block(call(hook, repo, repo / "SRC/app.py"), "source folder case variant, no run", N_NO_RUN)
    block(call(hook, repo, "../REPO/src/app.py", cwd=repo / "src"), "relative path through a case variant, no run", N_NO_RUN)
    block(call(hook, repo, variant / "SRC/new/x.py", tool="Write"), "new file under a case variant, no run", N_NO_RUN)
    # A case variant never counts as outside, so it cannot skip the gate by looking like another place.
    for rel in ("specs/f/spec.md", "SPECS/f/spec.md", "Learning/x.md", ".CLAUDE/commands/x.md", "AI_RULES/r.md", "agents.md", "PKG/rules.md"):
        allow(call(hook, repo, variant / rel, tool="Write"), "allowed names match as on disk: " + rel)
    block(call(hook, repo, repo / "LEARNING-evil/x.md", tool="Write"), "a look-alike is still not allowed", N_NO_RUN)
    state(repo, ["spec", "plan", "checkpoint"])
    allow(call(hook, repo, variant / "src/app.py"), "root case variant, open run")
    allow(call(hook, repo, repo / "SRC/app.py"), "source case variant, open run")
    allow(call(hook, repo, variant / "SRC/new/x.py", tool="Write"), "new file under a case variant, open run")
    allow(call(hook, repo, "../REPO/src/app.py", cwd=repo / "src"), "relative case variant, open run")
    allow(call(hook, repo, "SRC/app.py", cwd=variant), "session folder spelled as a variant, open run")
    # Nested working trees are found through a case variant too.
    (repo / ".claude/worktrees/t1/src").mkdir(parents=True)
    (repo / ".claude/worktrees/t1/.git").mkdir()
    block(call(hook, repo, variant / ".CLAUDE/worktrees/t1/src/a.py", tool="Write"), "nested clone through case variants", N_OTHER_TREE)
    # Outside the root, a variant of another tree is still that tree.
    block(call(hook, repo, repo.parent / "OUTSIDE/x.py"), "case variant of an outside git tree", N_OUTSIDE)
    # Link check by identity: a link out of the root is still a link when the root is spelled differently.
    (repo / "plain-link").symlink_to(repo.parent / "plainout", target_is_directory=True)
    block(call(hook, repo, variant / "plain-link/x.py"), "link out of a case-variant root", N_OUTSIDE)


def group_linked_worktree(hook):
    # A `.git` file with `gitdir:` into <M>/.git/worktrees/ of a harness repo M blocks, even outside the root.
    repo = fresh("linked")
    main = repo.parent / "mainrepo"
    (main / ".git/worktrees/wt1").mkdir(parents=True)
    (main / "SPEC-HARNESS.md").write_text("# s\n")
    wt = repo.parent / "wt1"
    (wt / "src").mkdir(parents=True)
    (wt / ".git").write_text("gitdir: %s\n" % (main / ".git/worktrees/wt1"))
    state(repo, ["spec", "plan", "checkpoint"])
    block(call(hook, repo, wt / "src/a.py"), "outside worktree of a harness repo, anchored", N_LINKED)
    unset = {"CLAUDE_PROJECT_DIR": None}
    block(call(hook, tmp / "plain-session", wt / "src/a.py", cwd=wt, env_extra=unset), "worktree of a harness repo, no anchor", N_LINKED)
    (repo.parent / "wt2/src").mkdir(parents=True)
    (repo.parent / "wt2/.git").write_text("gitdir: ../mainrepo/.git/worktrees/wt1\n")
    block(call(hook, tmp / "plain-session", repo.parent / "wt2/src/a.py", cwd=repo.parent / "wt2", env_extra=unset),
          "relative gitdir into a harness repo", N_LINKED)
    # A worktree of a repo that is not a harness repo, and no root: nothing to guard.
    plain_main = repo.parent / "plainmain"
    (plain_main / ".git/worktrees/w").mkdir(parents=True)
    (repo.parent / "wt3/src").mkdir(parents=True)
    (repo.parent / "wt3/.git").write_text("gitdir: %s\n" % (plain_main / ".git/worktrees/w"))
    allow(call(hook, tmp / "plain-session", repo.parent / "wt3/src/a.py", cwd=repo.parent / "wt3", env_extra=unset),
          "worktree of a non-harness repo, no anchor")
    block(call(hook, repo, repo.parent / "wt3/src/a.py"), "the same worktree, anchored, is another working tree", N_OUTSIDE)
    # Inside the root, a linked worktree is a nested tree.
    inner = repo / "specs/lw"
    (inner / "src").mkdir(parents=True)
    (inner / ".git").write_text("gitdir: %s\n" % (main / ".git/worktrees/wt1"))
    block(call(hook, repo, inner / "src/a.py"), "linked worktree under specs", N_OTHER_TREE)


def group_expiry(hook):
    # Criterion 5: a run-state or an open ticket not touched for 7 days no longer opens the gate.
    repo = fresh("expiry")
    src = repo / "src/app.py"
    state(repo, ["spec", "plan", "checkpoint"])
    stamp = repo / ".spec-harness/runs/T-1/run-state.json"
    allow(call(hook, repo, src), "fresh run-state")
    age(stamp, 6)
    allow(call(hook, repo, src), "six days old run-state")
    age(stamp, 8)
    block(call(hook, repo, src), "eight days old run-state", N_EXPIRED)
    result = call(hook, repo, src)
    assert ".spec-harness/runs/T-1/run-state.json" in result.stderr and N_SDD in result.stderr, result.stderr
    state(repo, ["spec", "plan", "checkpoint"], name="T-2")
    allow(call(hook, repo, src), "an expired run and a fresh one")
    age(repo / ".spec-harness/runs/T-2/run-state.json", 9)
    block(call(hook, repo, src), "both runs expired", N_EXPIRED)
    os.utime(stamp, None)
    allow(call(hook, repo, src), "touching the run-state reopens it")
    # An expired run that was already closed is not reported.
    closed = fresh("expiry-closed")
    state(closed, ["spec", "plan", "checkpoint", "summary"])
    age(closed / ".spec-harness/runs/T-1/run-state.json", 30)
    result = call(hook, closed, closed / "src/app.py")
    block(result, "a closed old run", N_NO_RUN)
    assert N_EXPIRED not in result.stderr, result.stderr
    # MICRO tickets expire the same way.
    micro = fresh("expiry-micro")
    ticket = micro / "specs/fix-x/ticket.md"
    ticket.parent.mkdir(parents=True)
    ticket.write_text("# Ticket\n\n## Goal checks\n1. x\n")
    allow(call(hook, micro, micro / "src/app.py"), "fresh open ticket")
    age(ticket, 6)
    allow(call(hook, micro, micro / "src/app.py"), "six days old open ticket")
    age(ticket, 8)
    result = call(hook, micro, micro / "src/app.py")
    block(result, "eight days old open ticket", N_EXPIRED)
    assert "specs/fix-x/ticket.md" in result.stderr, result.stderr
    # The expiry never blocks allowed folders, and never blocks an unexpired run elsewhere.
    allow(call(hook, micro, micro / "specs/fix-x/spec.md", tool="Write"), "allowed folder with an expired ticket")
    state(micro, ["spec", "plan", "checkpoint"])
    allow(call(hook, micro, micro / "src/app.py"), "a fresh run beside an expired ticket")


GROUPS = [("base", run_cases), ("nested trees", group_nested_trees), ("anchor", group_anchor),
          ("identity", group_identity), ("linked worktree", group_linked_worktree), ("expiry", group_expiry)]


def failing_groups(hook):
    failed = []
    for name, fn in GROUPS:
        try:
            fn(hook)
        except AssertionError as error:
            failed.append((name, str(error.args[0][0] if error.args and isinstance(error.args[0], tuple) else error.args)[:120]))
    return failed


failures = failing_groups(real_hook)
if failures:
    for name, label in failures:
        print("FAIL: group %r: %s" % (name, label))
    sys.exit(1)
print("PASS: hooks/sdd-gate.sh decides as the spec says (run-state, anchor, identity, other working trees, linked worktrees, expiry, outside-root, prefixes, non-harness folder, bypass, fail-open, no shell)")

# Control 1: a hook that always allows must turn every group that asserts a block red.
stub_failed = {name for name, _ in failing_groups(stub_hook)}
missing = {name for name, _ in GROUPS} - stub_failed - ({"identity"} if not CASE_INSENSITIVE else set())
assert not missing, "groups that cannot fail against an always-allow hook: %s" % sorted(missing)
print("RED control observed: a hook that always allows fails every group (%s)" % ", ".join(sorted(stub_failed)))

# Control 2: mutants of the real hook. Each must turn at least one group red.
source = real_hook.read_text()
MUTANTS = [
    ("session folder first", "root = anchor_root(SCRIPT) or find_root(cwd_real) or find_root(os.path.dirname(resolved))",
     "root = find_root(cwd_real) or anchor_root(SCRIPT) or find_root(os.path.dirname(resolved))", False),
    ("target path first (a harness repo above the written file wins over the anchor)",
     "root = anchor_root(SCRIPT) or find_root(cwd_real) or find_root(os.path.dirname(resolved))",
     "root = find_root(os.path.dirname(resolved)) or anchor_root(SCRIPT) or find_root(cwd_real)", False),
    ("no anchor at all (session folder, then path)", "root = anchor_root(SCRIPT) or find_root(cwd_real)",
     "root = find_root(cwd_real)", False),
    ("string compare instead of folder identity", "placed = locate(resolved, root_info)",
     "placed = locate(resolved, root_info) if (resolved + os.sep).startswith(root + os.sep) else None", True),
    ("no .git walk below the root", "nested = nested_git(folders)", "nested = None", False),
    ("no linked-worktree rule", "main_repo = linked_harness_worktree(resolved)\n        if main_repo is None:",
     "main_repo = None\n        if main_repo is None:", False),
    ("no expiry", "return time.time() - mtime > EXPIRY_SECONDS", "return False", False),
]
for name, old, new, needs_case_insensitive in MUTANTS:
    assert source.count(old) == 1, ("mutant text not found exactly once", name)
    mutated = source.replace(old, new)
    if needs_case_insensitive and not CASE_INSENSITIVE:
        print("note: mutant %r needs a case-insensitive disk to show red; not run here" % name)
        continue
    mutant = tmp / ("mutant-%d.sh" % MUTANTS.index((name, old, new, needs_case_insensitive)))
    mutant.write_text(mutated)
    mutant.chmod(0o755)
    red = failing_groups(mutant)
    assert red, "mutant stayed green: %s" % name
    print("RED mutant observed: %s -> %s" % (name, "; ".join("%s: %s" % item for item in red[:2])))
PY
