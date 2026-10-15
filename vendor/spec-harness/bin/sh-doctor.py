"""doctor: a read-only report on one target's Spec Harness setup.

It reports three separate fields, because they are separate facts:
- structural: the staged files are present and filled, and `generate-agents --check` prints READY;
- semantic: whether the generated rules say true things about the code. Only a separate fresh
  reviewer can decide that, so doctor reports NOT_ASSESSED;
- client: whether the coding client actually loads the startup files. Doctor can see that a startup
  route is written down, not that a client follows it, so it reports NOT_ASSESSED with that evidence.

It also checks the prerequisites (bash, git, python 3.11+, npm, tar, a SHA-256 tool) and the
platform. Every file is read through sh_safe_io: links, FIFOs and oversized files are UNSAFE.
Exit 0 when structural is READY, 1 otherwise, 2 for a bad target.
"""
import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from sh_safe_io import MAX_FILE_BYTES, SafeReadError, read_bounded  # noqa: E402

MEMORY = ["00-description", "01-brief", "10-product", "20-system", "30-tech",
          "40-active", "50-progress", "60-decisions", "70-knowledge", "80-feedback"]
# The startup set the installer stages and init fills, plus the receipt init writes.
PATHS = ["AGENTS.md", "CLAUDE.md", "RULES.md", "SPEC-HARNESS.md", "ai_rules/globalRules.md",
         "ai_rules/rules/core.md", "ai_rules/rules/context_management.md",
         "ai_rules/rules/frequent_rules.md", ".claude/commands/sdd.md", ".agents/skills/sdd/SKILL.md",
         ".claude/agents/.init-synthesis.json"] + [f".memory/{name}.md" for name in MEMORY]
INVENTORIES = ["ai_rules/project_inventory.json", "ai_rules/context_map.md"]
ROUTE = ".claude/commands/sdd.md"
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
    report = {
        "target": root,
        "structural": structural,
        "structural_reasons": reasons,
        "semantic": "NOT_ASSESSED",
        "semantic_note": "a separate fresh reviewer must check each generated claim against its cited lines",
        "client": "NOT_ASSESSED",
        "client_note": "a fresh client session must show it loads the startup files; doctor only sees that a route is written down",
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
