"""doctor: a read-only report on one target's Spec Harness setup.

It reports three separate fields, because they are separate facts:
- structural: the staged files are present and filled, and `generate-agents --check` prints READY;
- semantic: whether the generated rules say true things about the code. Only a separate fresh
  reviewer can decide that, so doctor reports NOT_ASSESSED;
- client: whether the coding client actually loads the startup files. Doctor can see that a startup
  route is written down, not that a client follows it, so it reports NOT_ASSESSED with that evidence.

- guards: a separate field with six checks that keep the V1 setup from silently breaking
  (`claude_imports_agents`, `hook_registered`, `lens_present`, `memory_complete`) plus two about the
  edit guard hook: `hook_python` (python3 on PATH, or the hook fails open) and `runs_current` (open and
  expired runs and tickets, listed). `hook_registered` is OK only when the registered matcher equals the
  registrar's and the registrar accepts the staged script (the shipped bytes, executable). Each is OK, MISSING or NOT_APPLICABLE, with a one-line note in `guards_notes`. Guards never change structural or the
  exit code, so a target installed before the hook existed is not suddenly PENDING.

- memory and index: advisory fields that never change structural or the exit code. `memory` gives the size of
  each Hot memory file (OK, WARN from 3,200 bytes, OVER above 4,000). `index` says whether the project
  inventory is CURRENT, STALE, INCOMPLETE, UNKNOWN, MISSING or UNREADABLE, by comparing its source_head with git HEAD.

It also checks the prerequisites (bash, git, python 3.11+, npm, tar, a SHA-256 tool) and the
platform. Guards read through sh_safe_io: links, FIFOs and oversized files are UNSAFE. The memory budget opens
each Hot candidate with O_NOFOLLOW and O_NONBLOCK and checks it with fstat, so a link or FIFO is never read.
Exit 0 when structural is READY, 1 otherwise, 2 for a bad target.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import sys
import time

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from sh_safe_io import MAX_FILE_BYTES, SafeReadError, read_bounded  # noqa: E402


def _registrar():
    """The hook registrar's own constants (settings file, matcher, command, script), loaded from its file, never copied."""
    path = os.path.join(os.path.dirname(os.path.realpath(__file__)), "sh-hook-register.py")
    spec = importlib.util.spec_from_file_location("sh_hook_register", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


REGISTRAR = _registrar()

MEMORY = ["00-description", "01-brief", "10-product", "20-system", "30-tech",
          "40-active", "50-progress", "60-decisions", "70-knowledge", "80-feedback"]
# The startup set the installer stages and init fills, plus the receipt init writes.
PATHS = ["AGENTS.md", "CLAUDE.md", "RULES.md", "SPEC-HARNESS.md", "ai_rules/globalRules.md",
         "ai_rules/rules/core.md", "ai_rules/rules/context_management.md",
         "ai_rules/rules/frequent_rules.md", ".claude/commands/sdd.md", ".agents/skills/sdd/SKILL.md",
         ".claude/agents/.init-synthesis.json"] + [f".memory/{name}.md" for name in MEMORY]
INVENTORIES = ["ai_rules/project_inventory.json", "ai_rules/context_map.md"]
ROUTE = ".claude/commands/sdd.md"
# The edit guard hook exactly as bin/sh-hook-register.py registers it (imported, not copied).
HOOK_SETTINGS = REGISTRAR.SETTINGS
HOOK_SCRIPT = REGISTRAR.SCRIPT
HOOK_COMMAND = REGISTRAR.COMMAND
HOOK_MATCHER = REGISTRAR.MATCHER
# The hook ignores a run-state or an open ticket older than this (the hook script keeps the same number).
RUN_EXPIRY_DAYS = 7
LENS = "ai_rules/review-lens.md"
IMPORT = re.compile(r"@AGENTS\.md(?![\w.-])")
# A staged scaffold line starts with "PENDING:"; templates also use {{TOKEN}} and _<placeholder>_.
SCAFFOLD = re.compile(r"(?m)^[ \t>*_#-]*PENDING:|\{\{[A-Z_]+\}\}|_\s*<[^>\n]+>_|generated at init|No project-specific rules generated yet")
# SPEC-HARNESS.md is the setup status file: it may say PENDING by design, so only presence counts.
STATUS_FILES = {"SPEC-HARNESS.md"}


def classify(root, rel):
    try:
        data = read_bounded(rel, MAX_FILE_BYTES, root=root)
    except SafeReadError as error:
        if error.reason == "missing":
            return "MISSING", None
        if "not a regular" in error.reason or "unsafe" in error.reason:
            return "UNSAFE", None
        return "UNREADABLE", None
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return "UNREADABLE", None
    if not text.strip() or (rel not in STATUS_FILES and SCAFFOLD.search(text)):
        return "SCAFFOLD", text
    return "PRESENT", text


def inspect(root):
    rows, texts = [], {}
    for rel in PATHS:
        status, text = classify(root, rel)
        rows.append({"path": rel, "status": status})
        texts[rel] = text
    inventory = None
    for rel in INVENTORIES:
        status, _ = classify(root, rel)
        if status != "MISSING":
            inventory = {"path": rel, "status": status}
            break
    rows.append(inventory or {"path": " or ".join(INVENTORIES), "status": "MISSING"})
    startup = [name for name in ("AGENTS.md", "CLAUDE.md") if texts.get(name) and ROUTE in texts[name]]
    return rows, startup


def guards(root):
    """Six checks, each (status, one-line note). Read only; every file goes through sh_safe_io."""
    out = {}
    # 1. Claude Code reads CLAUDE.md, not AGENTS.md, so CLAUDE.md must import it.
    agents, _ = classify(root, "AGENTS.md")
    claude, claude_text = classify(root, "CLAUDE.md")
    if agents == "MISSING":
        out["claude_imports_agents"] = ("NOT_APPLICABLE", "no AGENTS.md, so there is nothing for CLAUDE.md to import")
    elif claude_text is not None and IMPORT.search(claude_text):
        out["claude_imports_agents"] = ("OK", "CLAUDE.md contains @AGENTS.md")
    elif claude == "MISSING":
        out["claude_imports_agents"] = ("MISSING", "CLAUDE.md is missing, so Claude Code does not load AGENTS.md")
    else:
        out["claude_imports_agents"] = ("MISSING", "CLAUDE.md does not contain @AGENTS.md, so Claude Code does not load AGENTS.md")
    # 2. The edit guard hook: registered in settings.local.json and the script is there and executable.
    route, _ = classify(root, ROUTE)
    if route == "MISSING":
        out["hook_registered"] = ("NOT_APPLICABLE", f"no {ROUTE}: this target does not use the Claude Code route")
    else:
        out["hook_registered"] = hook_state(root)
    # 3. The project review lens.
    lens, _ = classify(root, LENS)
    if lens in ("PRESENT", "SCAFFOLD"):
        out["lens_present"] = ("OK", f"{LENS} exists" + (" (still the template; filling it is a review matter)" if lens == "SCAFFOLD" else ""))
    else:
        out["lens_present"] = ("MISSING", f"{LENS} is {'unsafe to read' if lens == 'UNSAFE' else 'missing'}")
    # 4. The ten core memory files are present and filled.
    gaps = []
    for name in MEMORY:
        status, _ = classify(root, f".memory/{name}.md")
        if status != "PRESENT":
            gaps.append(f"{name} ({status.lower()})")
    if gaps:
        out["memory_complete"] = ("MISSING", "not filled or not present: " + ", ".join(gaps))
    else:
        out["memory_complete"] = ("OK", f"all {len(MEMORY)} core .memory files are present and filled")
    # 5. The hook is a bash script that runs python3; without it on PATH the hook allows every edit.
    # 6. Open and expired runs and tickets, which decide whether a source edit is allowed.
    if route == "MISSING":
        out["hook_python"] = ("NOT_APPLICABLE", f"no {ROUTE}: this target does not use the Claude Code route")
        out["runs_current"] = ("NOT_APPLICABLE", f"no {ROUTE}: this target does not use the Claude Code route")
    else:
        if shutil.which("python3"):
            out["hook_python"] = ("OK", "python3 is on PATH, so the edit guard hook can decide")
        else:
            out["hook_python"] = ("MISSING", "python3 is not on PATH: the edit guard hook cannot decide and fails open, allowing every edit")
        out["runs_current"] = runs_state(root)
    return out


def listed(names, limit=5):
    shown = ", ".join(names[:limit])
    return shown + (f" (+{len(names) - limit} more)" if len(names) > limit else "")


def run_files(root):
    """(relative path, parsed or raw text, mtime) for each regular run-state.json and ticket.md, read through sh_safe_io."""
    found = []
    for base, name, kind in ((".spec-harness/runs", "run-state.json", "run"), ("specs", "ticket.md", "ticket")):
        folder = os.path.join(root, base)
        try:
            if not stat.S_ISDIR(os.lstat(folder).st_mode):
                continue
            entries = sorted(os.listdir(folder))
        except OSError:
            continue
        for entry in entries:
            rel = f"{base}/{entry}/{name}"
            try:
                if not stat.S_ISDIR(os.lstat(os.path.join(folder, entry)).st_mode):
                    continue
                data = read_bounded(rel, MAX_FILE_BYTES, root=root)
                mtime = os.lstat(os.path.join(root, rel)).st_mtime
            except (SafeReadError, OSError):
                continue
            found.append((kind, rel, entry, data, mtime))
    return found


def runs_state(root):
    """Which runs and tickets the hook counts as open, and which it ignores because they are older than a week."""
    opened, expired = [], []
    for kind, rel, entry, data, mtime in run_files(root):
        text = data.decode("utf-8", "replace")
        if kind == "run":
            try:
                state = json.loads(text)
            except (ValueError, RecursionError):
                continue
            completed = state.get("completed") if isinstance(state, dict) else None
            if not isinstance(completed, list) or "checkpoint" not in completed or "summary" in completed:
                continue
            label = entry
        else:
            if any(line.strip().upper().replace("*", "").replace("`", "").strip().startswith("RESULT:")
                   and line.strip().upper().replace("*", "").replace("`", "").strip()[len("RESULT:"):].strip().startswith("PASS")
                   for line in text.splitlines()):
                continue
            label = rel
        (expired if time.time() - mtime > RUN_EXPIRY_DAYS * 86400 else opened).append(label)
    if not opened and not expired:
        return ("OK", "no open run-state or MICRO ticket: source edits are blocked until /sdd reaches its checkpoint")
    parts = []
    if opened:
        parts.append(f"open (source edits allowed): {listed(opened)}")
    if expired:
        parts.append(f"expired, older than {RUN_EXPIRY_DAYS} days, no longer open the gate: {listed(expired)}; close each with the summary stage or delete it")
    return ("MISSING" if expired else "OK", "; ".join(parts))


def hook_state(root):
    try:
        settings = json.loads(read_bounded(HOOK_SETTINGS, MAX_FILE_BYTES, root=root).decode("utf-8"))
    except SafeReadError as error:
        if error.reason == "missing":
            return ("MISSING", f"{HOOK_SETTINGS} does not exist, so the edit guard is not registered")
        return ("MISSING", f"{HOOK_SETTINGS} cannot be read safely ({error.reason})")
    except (UnicodeDecodeError, ValueError, RecursionError):
        return ("MISSING", f"{HOOK_SETTINGS} is not valid JSON")
    groups = settings.get("hooks", {}).get("PreToolUse") if isinstance(settings, dict) and isinstance(settings.get("hooks"), dict) else None
    ours = [group for group in groups if isinstance(group, dict) and isinstance(group.get("hooks"), list)
            and any(isinstance(hook, dict) and hook.get("command") == HOOK_COMMAND for hook in group["hooks"])] if isinstance(groups, list) else []
    if not ours:
        return ("MISSING", f"{HOOK_SETTINGS} has no entry for the edit guard hook")
    if not any(group.get("matcher") == HOOK_MATCHER for group in ours):
        seen = ", ".join(repr(group.get("matcher")) for group in ours)
        return ("MISSING", f"the edit guard hook is registered with matcher {seen} in {HOOK_SETTINGS}; expected {HOOK_MATCHER!r}, so some edit tools are not guarded")
    script = os.path.join(root, HOOK_SCRIPT)
    try:
        info = os.lstat(script)
    except OSError:
        return ("MISSING", f"the hook script {HOOK_SCRIPT} does not exist")
    if not stat.S_ISREG(info.st_mode):
        return ("MISSING", f"the hook script {HOOK_SCRIPT} is not a regular file")
    if not os.access(script, os.X_OK):
        return ("MISSING", f"the hook script {HOOK_SCRIPT} is not executable")
    # The registrar's own check: a script it would refuse to register (a foreign or changed file) is not the guard.
    try:
        REGISTRAR.check_script(root)
    except REGISTRAR.Refused as refusal:
        return ("MISSING", str(refusal))
    return ("OK", "registered in " + HOOK_SETTINGS + "; the script is the shipped edit guard and is executable")


HOT_FILES = ("40-active.md", "50-progress.md", "80-feedback.md")
MEMORY_WARN_BYTES = 3200
MEMORY_OVER_BYTES = 4000


def _open_regular_head(path):
    """(first 4 KB, size) of one regular file. The open refuses a link (O_NOFOLLOW) and never blocks on a FIFO (O_NONBLOCK).

    Raises FileNotFoundError when missing, and OSError for anything that is not a readable regular file.
    """
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    fd = os.open(path, flags)
    with os.fdopen(fd, "rb") as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode):
            raise OSError("not a regular file")
        return handle.read(4096), info.st_size


def memory_budget(root):
    """Advisory size of each Hot memory file: OK, WARN (3,200 to 4,000 bytes), OVER (above 4,000), MISSING or UNSAFE.

    A Hot file is one of HOT_FILES or any other .memory/*.md whose first 5 lines say "> Tier: Hot". Symlinks and
    non-regular files are never followed. Only the first 4 KB of an unnamed file is read, to find its tier line.
    """
    folder = os.path.join(root, ".memory")
    try:
        if not stat.S_ISDIR(os.lstat(folder).st_mode):
            return {}
        names = sorted(os.listdir(folder))
    except OSError:
        return {}
    budget = {}
    for name in sorted(set(names) | set(HOT_FILES)):
        if not name.endswith(".md"):
            continue
        path = os.path.join(folder, name)
        named_hot = name in HOT_FILES
        try:
            head, size = _open_regular_head(path)
        except FileNotFoundError:
            if named_hot:
                budget[name] = {"status": "MISSING", "bytes": None}
            continue
        except OSError:
            # A link (refused by O_NOFOLLOW), a FIFO (refused by O_NONBLOCK) or an unreadable file.
            if named_hot:
                budget[name] = {"status": "UNSAFE", "bytes": None}
            continue
        if not named_hot:
            if not any(re.match(r"> Tier: Hot(?=[.\s]|$)", line) for line in head.decode("utf-8", "replace").splitlines()[:5]):
                continue
        if size < MEMORY_WARN_BYTES:
            status = "OK"
        elif size <= MEMORY_OVER_BYTES:
            status = "WARN"
        else:
            status = "OVER"
        budget[name] = {"status": status, "bytes": size}
    return budget


INDEX_PATH = "ai_rules/project_inventory.json"
MAP_PATH = "ai_rules/context_map.md"


def git_head(root):
    """HEAD of the root when the root is itself the top of a git repository, else None (matches sh-index.sh)."""
    try:
        top = subprocess.run(["git", "-C", root, "rev-parse", "--show-toplevel"], capture_output=True, encoding="utf-8", errors="replace", timeout=10)
        if top.returncode != 0 or os.path.realpath(top.stdout.strip()) != os.path.realpath(root):
            return None
        head = subprocess.run(["git", "-C", root, "rev-parse", "HEAD"], capture_output=True, encoding="utf-8", errors="replace", timeout=10)
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    return head.stdout.strip() if head.returncode == 0 and head.stdout.strip() else None


def partial_clone(root):
    """True when the repository has any partial-clone or promisor setting, or when that cannot be read.

    Presence is enough, whatever the value: git writes these keys for a filtered clone (remote.<name>.promisor and
    remote.<name>.partialclonefilter) and sometimes extensions.partialclone. A false positive only gives UNKNOWN, the
    safe answer. Entries are NUL-separated (-z), so a remote name with a space is read whole.
    """
    try:
        found = subprocess.run(["git", "-C", root, "config", "-z", "--get-regexp",
                                r"^(extensions\.partialclone|remote\..*\.(promisor|partialclonefilter))$"],
                               capture_output=True, encoding="utf-8", errors="replace", timeout=10, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError, ValueError):
        return True
    if found.returncode not in (0, 1):
        return True
    return any(entry for entry in found.stdout.split("\0"))


INDEX_OWN_FILES = frozenset({"ai_rules/context_map.md", "ai_rules/project_inventory.json"})
COMMIT_ID = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")


def only_index_files_changed(root, recorded, current):
    """True when at least one path changed between the two commits and every such path is one of the index's own files.

    Both ids must be full hex commit ids: the recorded one comes from a JSON file and must never reach git as an option.
    Renames are reported as a delete and an add, so a source file moved into ai_rules/ still counts as a source change.
    """
    if not (COMMIT_ID.fullmatch(recorded) and COMMIT_ID.fullmatch(current)):
        return False
    # No lazy fetch: a missing object must not make git contact a remote. index_state() returns before this call for any
    # repository with a promisor or partial-clone setting (partial_clone()), so there is no remote to fetch from here.
    # GIT_NO_LAZY_FETCH is the second guard (git 2.44 or newer).
    quiet = dict(os.environ, GIT_NO_LAZY_FETCH="1", GIT_TERMINAL_PROMPT="0")
    try:
        diff = subprocess.run(["git", "-C", root, "diff", "--no-renames", "--name-only", "--end-of-options", recorded, current],
                              capture_output=True, encoding="utf-8", errors="replace", timeout=10, env=quiet, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError, ValueError):
        return False
    if diff.returncode != 0:
        return False
    changed = diff.stdout.splitlines()
    return bool(changed) and all(path in INDEX_OWN_FILES for path in changed)


def generated_map(data):
    """True when the bytes end in sh-index.sh's marker and the marker's sha256 matches the body (the same test as sh-index.sh)."""
    match = re.search(rb"<!-- spec-harness-index:v1 sha256=([0-9a-f]{64}) -->\n$", data)
    return bool(match and hashlib.sha256(data[:match.start()]).hexdigest().encode("ascii") == match.group(1))


def index_state(root):
    """Whether the project index is current: MISSING, UNREADABLE, INCOMPLETE, UNKNOWN, STALE or CURRENT.

    The record is the generated ai_rules/context_map.md when its integrity marker is valid (its "Scan complete" and
    "Source HEAD" lines). Otherwise, when a hand-written map made sh-index.sh write the JSON inventory, the record is
    that JSON. A stale JSON left from an earlier hand-written map is ignored once the map is generated again.
    Freshness compares the record's commit with the root's git HEAD. Uncommitted changes are not seen.
    """
    state = {"status": None, "source_head": None, "current_head": None, "note": ""}
    map_unsafe = False
    try:
        map_bytes = read_bounded(MAP_PATH, MAX_FILE_BYTES, root=root)
    except SafeReadError as error:
        # A link or other unsafe map is not read; the JSON record next to it may still be used.
        map_unsafe = error.reason != "missing"
        map_bytes = None
    if map_bytes is not None and generated_map(map_bytes):
        text = map_bytes.decode("utf-8", "replace")
        complete_line = re.search(r"(?m)^- Scan complete: `(true|false)`", text)
        head_line = re.search(r"(?m)^- Source HEAD: `([0-9a-f]+|none)`", text)
        if complete_line is None:
            state.update(status="UNKNOWN", note=f"{MAP_PATH} is generated but has no Scan complete line")
            return state
        complete = complete_line.group(1) == "true"
        head = head_line.group(1) if head_line and head_line.group(1) != "none" else None
    else:
        try:
            inventory = json.loads(read_bounded(INDEX_PATH, MAX_FILE_BYTES, root=root).decode("utf-8"))
        except SafeReadError as error:
            if error.reason != "missing":
                state.update(status="UNREADABLE", note=f"{INDEX_PATH} cannot be read safely ({error.reason})")
                return state
            if map_unsafe:
                state.update(status="UNREADABLE", note=f"{MAP_PATH} is a link or unsafe to read, and there is no inventory JSON")
            elif map_bytes is None:
                state.update(status="MISSING", note=f"neither {MAP_PATH} nor {INDEX_PATH} exists; run sh-index.sh")
            else:
                state.update(status="UNKNOWN", note=f"{MAP_PATH} is not a generated map (its marker is missing or wrong) and there is no inventory JSON")
            return state
        except (UnicodeDecodeError, ValueError, RecursionError):
            state.update(status="UNREADABLE", note=f"{INDEX_PATH} is not valid JSON")
            return state
        scan = inventory.get("scan") if isinstance(inventory, dict) else None
        if not isinstance(scan, dict) or not isinstance(scan.get("complete"), bool):
            state.update(status="UNREADABLE", note=f"{INDEX_PATH} has no scan object with a boolean complete flag")
            return state
        complete = scan["complete"]
        head = scan.get("source_head")
    state["source_head"] = head
    state["current_head"] = git_head(root)
    if not complete:
        state.update(status="INCOMPLETE", note="the last scan did not finish, so the inventory is partial")
    elif not isinstance(head, str) or not head:
        state.update(status="UNKNOWN", note="the inventory has no source_head (a non-git folder, or it was built before source_head existed)")
    elif not COMMIT_ID.fullmatch(head):
        state.update(status="UNKNOWN", note="the inventory's source_head is not a full commit id, so it is not compared")
    elif state["current_head"] is None:
        state.update(status="UNKNOWN", note="the root is not a git repository now, so freshness cannot be compared")
    elif head != state["current_head"] and partial_clone(root):
        state.update(status="UNKNOWN", note="the repository is a partial clone; freshness is not compared, so no object is fetched from a remote")
    elif head != state["current_head"] and only_index_files_changed(root, head, state["current_head"]):
        state.update(status="CURRENT", note="HEAD moved only through the index's own two files (context map and inventory); the source is unchanged since the index ran")
    elif head != state["current_head"]:
        state.update(status="STALE", note="HEAD is not the commit the index records, or that commit is not in local history; run sh-index.sh")
    else:
        state.update(status="CURRENT", note="the inventory matches the root's git HEAD (uncommitted changes are not checked)")
    return state


def tool_version(command):
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        return None
    output = (result.stdout or result.stderr).strip().splitlines()
    return output[0][:120] if output else ""


def prerequisites():
    found = {}
    for name, command in (("bash", ["bash", "--version"]), ("git", ["git", "--version"]),
                          ("npm", ["npm", "--version"]), ("tar", ["tar", "--version"])):
        if shutil.which(name):
            found[name] = {"status": "OK", "version": tool_version(command)}
        else:
            found[name] = {"status": "MISSING"}
    found["npm"]["needed_for"] = "the npx route only; a checkout does not need it"
    version = sys.version_info
    found["python3"] = {"status": "OK" if version >= (3, 11) else "TOO_OLD", "version": platform.python_version(),
                        "needed": "3.11 or newer"}
    sha_tool = next((name for name in ("shasum", "sha256sum") if shutil.which(name)), None)
    found["sha256"] = {"status": "OK", "tool": sha_tool or "python3 hashlib"}
    return found


def platform_report():
    system = sys.platform
    if system.startswith("win") or system in {"cygwin", "msys"}:
        return {"name": system, "status": "UNSUPPORTED", "note": "native Windows is not supported; use WSL2, which works like Linux"}
    if system.startswith("linux"):
        try:
            with open("/proc/version", encoding="utf-8", errors="replace") as handle:
                if "microsoft" in handle.read(4096).lower():
                    return {"name": "linux (WSL)", "status": "SUPPORTED", "note": "WSL2 works like Linux"}
        except OSError:
            pass
        return {"name": "linux", "status": "SUPPORTED"}
    if system == "darwin":
        return {"name": "macos", "status": "SUPPORTED"}
    return {"name": system, "status": "UNTESTED"}


def main(argv=None):
    parser = argparse.ArgumentParser(prog="spec-harness doctor", description=__doc__.split("\n\n")[0])
    parser.add_argument("target")
    args = parser.parse_args(argv)
    selected = os.path.abspath(os.path.expanduser(args.target))
    if not os.path.isdir(selected) or os.path.islink(selected):
        print("doctor: select an existing target directory, not a symbolic link", file=sys.stderr)
        return 2
    root = os.path.realpath(selected)
    rows, startup = inspect(root)
    unsafe = [row["path"] for row in rows if row["status"] == "UNSAFE"]
    if unsafe:
        check = {"exit": 1, "output": "PENDING: unsafe setup path; synthesis receipt not read: " + ", ".join(unsafe)}
    else:
        checker = os.path.join(os.path.dirname(os.path.realpath(__file__)), "sh-gen-agents.sh")
        result = subprocess.run(["bash", checker, "--check", root], capture_output=True, text=True)
        check = {"exit": result.returncode, "output": (result.stdout + result.stderr).strip()}
    complete = all(row["status"] == "PRESENT" for row in rows)
    structural = "READY" if complete and startup and check["exit"] == 0 else "PENDING"
    reasons = []
    if not complete:
        reasons.append("some setup files are missing, unsafe or still scaffolds")
    if not startup:
        reasons.append(f"neither AGENTS.md nor CLAUDE.md names {ROUTE}")
    if check["exit"] != 0:
        reasons.append("generate-agents --check is not READY")
    guard_rows = guards(root)
    report = {
        "target": root,
        "structural": structural,
        "structural_reasons": reasons,
        "semantic": "NOT_ASSESSED",
        "semantic_note": "a separate fresh reviewer must check each generated claim against its cited lines",
        "client": "NOT_ASSESSED",
        "client_note": "a fresh client session must show it loads the startup files; doctor only sees that a route is written down",
        "guards": {name: row[0] for name, row in guard_rows.items()},
        "guards_notes": {name: row[1] for name, row in guard_rows.items()},
        "memory": memory_budget(root),
        "index": index_state(root),
        "memory_note": "advisory; WARN at 3200 bytes, OVER above 4000; see docs/MEMORY.md",
        "startup_route_in": startup,
        "paths": rows,
        "synthesis_check": check,
        "prerequisites": prerequisites(),
        "platform": platform_report(),
    }
    print(json.dumps(report, indent=2))
    return 0 if structural == "READY" else 1


if __name__ == "__main__":
    sys.exit(main())
