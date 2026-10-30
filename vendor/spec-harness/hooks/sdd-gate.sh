#!/usr/bin/env bash
# sdd-gate.sh: Claude Code PreToolUse guard for Edit, Write, MultiEdit and NotebookEdit.
#
# The repo it guards is the one that registered it: CLAUDE_PROJECT_DIR when that folder holds a
# SPEC-HARNESS.md, otherwise the repo around this script (<root>/.claude/spec-harness/hooks/). The
# session's working folder never decides which repo is guarded. Folders are compared by identity
# (samestat), not by spelling, so a differently cased path on a case-insensitive disk is the same folder.
# Only when neither anchor exists (the script runs from a checkout) does it fall back to the repo above
# the session folder, then above the target path.
#
# In a Spec Harness repo (a SPEC-HARNESS.md at the root) it blocks two things:
#   1. a write that lands inside another git working tree: a `.git` entry (folder or file) on the way
#      from the root down to the target, also under .claude/, specs/ and every allowed folder, or above
#      a target outside the root; a `.git` file whose `gitdir:` points into <M>/.git/worktrees/ of a
#      harness repo M (a linked worktree, which may not hold SPEC-HARNESS.md); or a link that leaves the
#      root. Memory, plan, scratch and temp files outside the root and outside any git tree are allowed;
#   2. a write to source files while no ticket run sits between its `checkpoint` and `summary`
#      stages (.spec-harness/runs/*/run-state.json, field `completed`). Run /sdd first.
#      A MICRO ticket has no checkpoint, so an open specs/<feature>/ticket.md (no line
#      `RESULT: PASS` yet) also allows source edits. That is a weaker rule than a checkpoint.
#      A run-state or ticket file not modified for 7 days is expired and no longer opens the gate;
#      the block message names an expired run.
# Packet, state, memory and setup files are always allowed: specs/, .spec-harness/, .memory/,
# .claude/, ai_rules/, learning/, .agents/, SPEC-HARNESS.md and the root AGENTS.md, CLAUDE.md and
# RULES.md, and any RULES.md. A gate against mistakes, not a sandbox: those folders stay writable.
#
# SDD_BYPASS=1 lets a call through and appends one line to .spec-harness/bypass.log when the call would have been blocked. Use it only
# for a person's own decision, never to get past a block that says "run /sdd".
#
# Block = exit 2 with the reason on stderr. Any internal error (bad JSON, no python3) allows the
# call and prints a warning on stderr: a broken guard must not lock the person out.
# The hook only reads, except for that one log. It never evaluates the path in a shell: the tool
# call is parsed by python3 in isolated mode and every value stays data.
set -u

if ! command -v python3 >/dev/null 2>&1; then
  printf 'sdd-gate warning: python3 not found; allowing the edit (fail open)\n' >&2
  exit 0
fi

read -r -d '' GATE_PY <<'PYEOF' || true
import datetime
import json
import os
import stat
import sys
import time

ALLOWED_PREFIXES = ("specs/", ".spec-harness/", ".memory/", ".claude/", "ai_rules/", "learning/", ".agents/")
ALLOWED_ROOT_FILES = ("SPEC-HARNESS.md", "AGENTS.md", "CLAUDE.md", "RULES.md")
MAX_STATE_BYTES = 256 * 1024
EXPIRY_SECONDS = 7 * 24 * 60 * 60
PROJECT_FILE = "SPEC-HARNESS.md"
SCRIPT = sys.argv[1] if len(sys.argv) > 1 else ""
HOOK_TAIL = (".claude", "spec-harness", "hooks", "sdd-gate.sh")


def allow_with_warning(message):
    sys.stderr.write("sdd-gate warning: %s; allowing the edit (fail open)\n" % message)
    sys.exit(0)


def find_root(start):
    current = start
    while True:
        if os.path.isfile(os.path.join(current, PROJECT_FILE)):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            return None
        current = parent


def anchor_root(script):
    """The repo that registered this hook: CLAUDE_PROJECT_DIR holding SPEC-HARNESS.md, else the repo around the script."""
    given = os.environ.get("CLAUDE_PROJECT_DIR")
    if given and os.path.isabs(given) and "\x00" not in given and os.path.isfile(os.path.join(given, PROJECT_FILE)):
        return os.path.realpath(given)
    if script and os.path.isabs(script):
        parts = os.path.normpath(script).split(os.sep)
        if tuple(parts[-len(HOOK_TAIL):]) == HOOK_TAIL:
            candidate = os.sep.join(parts[:-len(HOOK_TAIL)]) or os.sep
            if os.path.isfile(os.path.join(candidate, PROJECT_FILE)):
                return os.path.realpath(candidate)
    return None


def locate(path, root_info):
    """Where `path` sits under the root, comparing every folder by identity: (names, folders) or None.

    `names` are the components below the root; `folders` are the folders strictly between the root and
    `path`. A folder that does not exist yet never matches, so the walk simply goes up."""
    names, folders, current = [], [], path
    while True:
        try:
            if os.path.samestat(os.stat(current), root_info):
                names.reverse()
                folders.reverse()
                return names, folders
        except OSError:
            pass
        parent = os.path.dirname(current)
        if parent == current:
            return None
        names.append(os.path.basename(current))
        if current != path:
            folders.append(current)
        current = parent


def disk_name(folder, typed):
    """The name `typed` has on disk inside `folder`: a differently cased spelling of the same entry gives the real name."""
    probe = os.path.join(folder, typed)
    try:
        entries = os.listdir(folder)
        if typed in entries:
            return typed
        info = os.lstat(probe)
        for entry in sorted(entries):
            if entry.lower() == typed.lower() and os.path.samestat(os.lstat(os.path.join(folder, entry)), info):
                return entry
    except OSError:
        pass
    return typed


def nested_git(folders):
    """The first folder that holds a `.git` entry (a folder or a file), or None."""
    for folder in folders:
        if os.path.lexists(os.path.join(folder, ".git")):
            return folder
    return None


def nearest_git(path):
    """The first `.git` entry above `path`, or None."""
    current = os.path.dirname(path)
    while True:
        candidate = os.path.join(current, ".git")
        if os.path.lexists(candidate):
            return candidate
        parent = os.path.dirname(current)
        if parent == current:
            return None
        current = parent


def linked_harness_worktree(path):
    """The harness repo M when the nearest `.git` above `path` is a file with `gitdir:` into <M>/.git/worktrees/."""
    candidate = nearest_git(path)
    if candidate is None:
        return None
    try:
        if not stat.S_ISREG(os.lstat(candidate).st_mode):
            return None
        with open(candidate, "rb") as handle:
            first = handle.read(4096).decode("utf-8", "replace").splitlines()[:1]
    except (OSError, IndexError):
        return None
    if not first or not first[0].startswith("gitdir:"):
        return None
    target = first[0][len("gitdir:"):].strip()
    if not target:
        return None
    if not os.path.isabs(target):
        target = os.path.join(os.path.dirname(candidate), target)
    target = os.path.realpath(target)
    admin = os.path.dirname(target)
    git_dir = os.path.dirname(admin)
    if os.path.basename(admin).lower() != "worktrees" or os.path.basename(git_dir).lower() != ".git":
        return None
    main = os.path.dirname(git_dir)
    return main if os.path.isfile(os.path.join(main, PROJECT_FILE)) else None


def left_root_through_link(lexical, root_info):
    """True when a folder on the written path really is inside the root, so the path left it through a link."""
    current = os.path.dirname(lexical)
    while True:
        if locate(os.path.realpath(current), root_info) is not None:
            return True
        parent = os.path.dirname(current)
        if parent == current:
            return False
        current = parent


def is_plain_directory(path):
    try:
        return stat.S_ISDIR(os.lstat(path).st_mode)
    except OSError:
        return False


def read_small(path):
    """(bytes, mtime) of a small regular file opened without following a link, or None."""
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        fd = os.open(path, flags)
    except OSError:
        return None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_STATE_BYTES:
            return None
        return os.read(fd, MAX_STATE_BYTES + 1), info.st_mtime
    finally:
        os.close(fd)


def is_expired(mtime):
    return time.time() - mtime > EXPIRY_SECONDS


def run_state_status(path):
    """"open" when this run-state lists `checkpoint` and not `summary` and is under 7 days old, "expired" when only its age rules it out, else None."""
    got = read_small(path)
    if got is None:
        return None
    data, mtime = got
    try:
        state = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        return None
    if not isinstance(state, dict):
        return None
    completed = state.get("completed")
    if not isinstance(completed, list) or "checkpoint" not in completed or "summary" in completed:
        return None
    return "expired" if is_expired(mtime) else "open"


def child_folders(parent):
    if not is_plain_directory(parent):
        return []
    try:
        names = sorted(os.listdir(parent))
    except OSError:
        return []
    return [(name, os.path.join(parent, name)) for name in names if is_plain_directory(os.path.join(parent, name))]


def open_runs(root):
    """(a run is open, expired run-state paths relative to the root)."""
    state_dir = os.path.join(root, ".spec-harness")
    if not is_plain_directory(state_dir):
        return False, []
    is_open, expired = False, []
    for name, folder in child_folders(os.path.join(state_dir, "runs")):
        verdict = run_state_status(os.path.join(folder, "run-state.json"))
        if verdict == "open":
            is_open = True
        elif verdict == "expired":
            expired.append(".spec-harness/runs/%s/run-state.json" % name)
    return is_open, expired


def ticket_status(path):
    """"open" when this MICRO ticket.md records no verifier PASS (no line `RESULT: PASS`) and is under 7 days old, "expired" when only its age rules it out, else None."""
    got = read_small(path)
    if got is None:
        return None
    data, mtime = got
    for line in data.decode("utf-8", "replace").splitlines():
        text = line.strip().upper().replace("*", "").replace("`", "").strip()
        if text.startswith("RESULT:") and text[len("RESULT:"):].strip().startswith("PASS"):
            return None
    return "expired" if is_expired(mtime) else "open"


def open_tickets(root):
    """A weaker rule than a checkpoint: (some specs/<feature>/ticket.md has no recorded PASS, expired ticket paths)."""
    is_open, expired = False, []
    for name, folder in child_folders(os.path.join(root, "specs")):
        verdict = ticket_status(os.path.join(folder, "ticket.md"))
        if verdict == "open":
            is_open = True
        elif verdict == "expired":
            expired.append("specs/%s/ticket.md" % name)
    return is_open, expired


def write_bypass_log(root, tool, given):
    state_dir = os.path.join(root, ".spec-harness")
    try:
        if os.path.lexists(state_dir) and not is_plain_directory(state_dir):
            raise OSError("state folder is not a plain directory")
        os.makedirs(state_dir, exist_ok=True)
        flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(os.path.join(state_dir, "bypass.log"), flags, 0o644)
        try:
            stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
            line = "%s UTC\t%s\t%s\n" % (stamp, json.dumps(tool), json.dumps(given, ensure_ascii=False))
            os.write(fd, line.encode("utf-8", "replace"))
        finally:
            os.close(fd)
    except OSError as error:
        sys.stderr.write("sdd-gate warning: could not write .spec-harness/bypass.log (%s); the call is still allowed\n"
                         % (error.strerror or error.__class__.__name__))


def main():
    try:
        call = json.loads(sys.stdin.read())
    except Exception:
        allow_with_warning("could not read the tool call from stdin")
    if not isinstance(call, dict) or not isinstance(call.get("tool_input"), dict):
        allow_with_warning("the tool call has no tool_input object")
    tool_input = call["tool_input"]
    tool = call.get("tool_name") if isinstance(call.get("tool_name"), str) else "unknown"
    given = tool_input.get("file_path") or tool_input.get("notebook_path")
    if not isinstance(given, str) or not given or "\x00" in given:
        allow_with_warning("the tool call names no usable file path")
    cwd = call.get("cwd")
    if not isinstance(cwd, str) or not os.path.isabs(cwd) or "\x00" in cwd:
        cwd = os.getcwd()
    cwd_real = os.path.realpath(cwd)
    resolved = os.path.realpath(os.path.join(cwd_real, given))
    lexical = os.path.normpath(os.path.join(cwd, given))

    root = anchor_root(SCRIPT) or find_root(cwd_real) or find_root(os.path.dirname(resolved))
    if root is None:
        main_repo = linked_harness_worktree(resolved)
        if main_repo is None:
            return 0
        reason = ("sdd-gate: blocked %s of %s. It is inside a linked worktree of the harness repository %s. "
                  "Ticket work stays inside the repository: no worktree or copy elsewhere."
                  % (tool, json.dumps(given, ensure_ascii=False), json.dumps(main_repo, ensure_ascii=False)))
        sys.stderr.write(reason + "\n")
        return 0 if os.environ.get("SDD_BYPASS") == "1" else 2
    root_info = os.stat(root)

    reason = None
    placed = locate(resolved, root_info)
    if placed is None:
        # Outside the root. Memory, plan, scratch and temp files outside any git tree are fine; a path
        # inside another git working tree (a worktree or copy of code) or a link that leaves the root is not.
        main_repo = linked_harness_worktree(resolved)
        if main_repo is not None:
            reason = ("sdd-gate: blocked %s of %s. It resolves to %s, outside the repository root %s, inside a "
                      "linked worktree of the harness repository %s. Ticket work stays inside the repository: "
                      "no worktree or copy elsewhere."
                      % (tool, json.dumps(given, ensure_ascii=False), json.dumps(resolved, ensure_ascii=False),
                         root, json.dumps(main_repo, ensure_ascii=False)))
        elif nearest_git(resolved) is None and not left_root_through_link(lexical, root_info):
            return 0
        else:
            reason = ("sdd-gate: blocked %s of %s. It resolves to %s, outside the repository root %s, in another git "
                      "working tree or through a link out of the repository. Ticket work stays inside the repository: "
                      "no worktree or copy elsewhere."
                      % (tool, json.dumps(given, ensure_ascii=False), json.dumps(resolved, ensure_ascii=False), root))
    else:
        names, folders = placed
        nested = nested_git(folders)
        if nested is not None:
            reason = ("sdd-gate: blocked %s of %s. It is inside another git working tree: %s holds its own .git, "
                      "below the repository root %s. Ticket work stays inside the repository: no worktree or "
                      "clone under it, not even under an allowed folder."
                      % (tool, json.dumps(given, ensure_ascii=False), json.dumps(nested, ensure_ascii=False), root))
        else:
            folder, ondisk = root, []
            for name in names:
                real_name = disk_name(folder, name)
                ondisk.append(real_name)
                folder = os.path.join(folder, real_name)
            relative = "/".join(ondisk)
            if (relative in ALLOWED_ROOT_FILES or relative.startswith(ALLOWED_PREFIXES)
                    or (ondisk and ondisk[-1] == "RULES.md")):
                return 0
            runs_open, runs_expired = open_runs(root)
            tickets_open, tickets_expired = open_tickets(root)
            if runs_open or tickets_open:
                return 0
            expired = runs_expired + tickets_expired
            reason = ("sdd-gate: blocked %s of %s. No ticket run has reached its checkpoint "
                      "(.spec-harness/runs/*/run-state.json must list `checkpoint` and not `summary`), "
                      "and no specs/<feature>/ticket.md is open. "
                      % (tool, json.dumps(given, ensure_ascii=False)))
            if expired:
                reason += ("A run is expired: %s not modified for more than 7 days, so it no longer opens the "
                           "gate; finish or close it, or start a new run. " % ", ".join(expired))
            reason += "Run /sdd for this ticket first; a block is not a reason to bypass."
    if os.environ.get("SDD_BYPASS") == "1":
        write_bypass_log(root, tool, given)
        return 0
    sys.stderr.write(reason + "\n")
    return 2


try:
    code = main()
except SystemExit:
    raise
except BaseException as error:  # a broken guard must not lock the person out
    sys.stderr.write("sdd-gate warning: internal error (%s); allowing the edit (fail open)\n" % error.__class__.__name__)
    code = 0
sys.exit(code)
PYEOF

python3 -I -B -c "$GATE_PY" "$0"
code=$?
case "$code" in
  0) exit 0 ;;
  2) exit 2 ;;
  *) printf 'sdd-gate warning: the guard failed with status %s; allowing the edit (fail open)\n' "$code" >&2; exit 0 ;;
esac
