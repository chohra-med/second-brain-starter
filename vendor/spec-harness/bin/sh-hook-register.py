"""hook-register: add or remove the Spec Harness edit guard in a target's .claude/settings.local.json.

    python3 -I -B sh-hook-register.py add <target>
    python3 -I -B sh-hook-register.py remove <target>

`add` merges one PreToolUse entry into the target's settings.local.json (never settings.json, which
is committed). It keeps every other key and hook, in their order, and is idempotent: an entry that
runs the same command is not added twice. In a git target it also adds the settings file to
.git/info/exclude, once, unless git already ignores or tracks it. `remove` takes out only that entry
(and any container it leaves empty), and deletes the file only when nothing else is left in it.

A settings file that is a link, not a regular file, not valid JSON or not shaped as expected is left
untouched and named in the output (exit 1). A staged hook that is missing, differs from the edit guard this
harness ships or is not executable is refused too (exit 1): `add` does not register a file it did not stage,
and it takes out an earlier harness entry the way `remove` does, because that entry would keep running the
refused file on every edit. Writes go through sh_safe_io: temporary file, then
atomic replace, with no link followed on the way. Exit 0 on success, 1 when refused, 2 for a bad
argument. Standard library only.
"""
import json
import os
import shlex
import stat
import subprocess
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from sh_safe_io import SafeReadError, WriteRefused, read_bounded, write_regular  # noqa: E402

SETTINGS = ".claude/settings.local.json"
MATCHER = "Edit|Write|MultiEdit|NotebookEdit"
SCRIPT = ".claude/spec-harness/hooks/sdd-gate.sh"
COMMAND = '"$CLAUDE_PROJECT_DIR"/' + SCRIPT
MAX_BYTES = 1024 * 1024
# The edit guard this harness ships, next to this program's bin/ folder.
SHIPPED = os.path.join(os.path.dirname(os.path.dirname(os.path.realpath(__file__))), "hooks", "sdd-gate.sh")


class Refused(Exception):
    pass


def load(root):
    """The parsed settings object, or None when the file does not exist."""
    try:
        data = read_bounded(SETTINGS, MAX_BYTES, root=root)
    except SafeReadError as error:
        if error.reason == "missing":
            return None
        raise Refused("%s is not a plain readable file (%s)" % (SETTINGS, error.reason))
    try:
        value = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise Refused("%s is not valid JSON; it was left as it is" % SETTINGS)
    if not isinstance(value, dict):
        raise Refused("%s is not a JSON object; it was left as it is" % SETTINGS)
    return value


def save(root, settings):
    path = os.path.join(root, SETTINGS)
    mode = None
    try:
        mode = stat.S_IMODE(os.lstat(path).st_mode)
    except OSError:
        pass
    data = (json.dumps(settings, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    try:
        write_regular(root, SETTINGS, data)
        if mode is not None and mode != 0o644:
            os.chmod(path, mode)
    except (WriteRefused, OSError) as error:
        raise Refused("cannot write %s: %s" % (SETTINGS, getattr(error, "strerror", None) or error))


def is_ours(hook):
    return isinstance(hook, dict) and hook.get("command") == COMMAND


def pre_tool_groups(settings, create):
    hooks = settings.get("hooks")
    if hooks is None:
        if not create:
            return None
        hooks = settings["hooks"] = {}
    if not isinstance(hooks, dict):
        raise Refused('"hooks" in %s is not an object; it was left as it is' % SETTINGS)
    groups = hooks.get("PreToolUse")
    if groups is None:
        if not create:
            return None
        groups = hooks["PreToolUse"] = []
    if not isinstance(groups, list):
        raise Refused('"hooks.PreToolUse" in %s is not a list; it was left as it is' % SETTINGS)
    return groups


def command_line(action, root):
    """This registrar's command for one target, quoted for a shell, as the refusals print it."""
    return "python3 -I -B %s %s %s" % (shlex.quote(os.path.realpath(__file__)), action, shlex.quote(root))


def check_script(root):
    """Refuse a staged hook that is missing, differs from the shipped edit guard, or is not executable.

    The registered command runs that file on every edit, so a file that came with the repository (the installer
    keeps every existing file) would otherwise run as the guard, and a file Claude Code cannot execute lets every
    edit through. update keeps a changed or foreign file too, so the refusal names the steps that work."""
    try:
        staged = read_bounded(SCRIPT, MAX_BYTES, root=root)
    except SafeReadError as error:
        state = "not staged" if error.reason == "missing" else "not a plain readable file (%s)" % error.reason
        raise Refused("%s is %s" % (SCRIPT, state))
    try:
        with open(SHIPPED, "rb") as handle:
            shipped = handle.read()
    except OSError:
        raise Refused("the shipped edit guard %s cannot be read" % SHIPPED)
    path = os.path.join(root, SCRIPT)
    if staged != shipped:
        # A hand-added entry for this path would be removed by the next refused add, so a custom hook needs its own name.
        raise Refused("%s differs from the shipped edit guard (it was changed, or it came with the repository). To use the "
                      "shipped one, replace the file with it and keep its mode (cp -p %s %s), then run %s. This registrar "
                      "only registers the shipped edit guard: to run your own hook instead, review it, save it under another "
                      "name and register that name in %s yourself"
                      % (SCRIPT, shlex.quote(SHIPPED), shlex.quote(path), command_line("add", root), SETTINGS))
    try:
        mode = os.lstat(path).st_mode  # the file itself: a link is never followed
    except OSError:
        mode = 0
    if not stat.S_ISREG(mode):
        raise Refused("%s changed while it was checked" % SCRIPT)
    if not mode & stat.S_IXUSR:
        raise Refused("%s is not executable, so Claude Code could not run it and edits would go unguarded. Run chmod +x %s, "
                      "then run %s" % (SCRIPT, shlex.quote(path), command_line("add", root)))


def unregister(root):
    """After a refusal, take out an earlier harness entry, which would keep running the refused file on every edit.

    Returns the sentence the refusal adds: empty when there was no entry."""
    try:
        outcome = remove(root)
    except (Refused, OSError) as error:
        return ". Nothing was changed in %s, so an earlier registration in it, if there is one, was not removed (%s)" % (
            SETTINGS, getattr(error, "strerror", None) or error)
    if outcome.startswith("removed"):
        return ". The earlier registration was removed from %s, so this file no longer runs on every edit" % SETTINGS
    return ""


def add(root):
    try:
        check_script(root)
    except Refused as refusal:
        raise Refused("%s%s" % (refusal, unregister(root)))
    settings = load(root)
    created = settings is None
    if created:
        settings = {}
    groups = pre_tool_groups(settings, True)
    for group in groups:
        inner = group.get("hooks") if isinstance(group, dict) else None
        if isinstance(inner, list) and any(is_ours(hook) for hook in inner):
            return "already registered in " + SETTINGS
    groups.append({"matcher": MATCHER, "hooks": [{"type": "command", "command": COMMAND}]})
    save(root, settings)
    return "registered in %s" % SETTINGS


def remove(root):
    settings = load(root)
    if settings is None:
        return "nothing to remove: %s does not exist" % SETTINGS
    groups = pre_tool_groups(settings, False)
    removed = 0
    if groups is not None:
        kept = []
        for group in groups:
            inner = group.get("hooks") if isinstance(group, dict) else None
            if isinstance(inner, list) and any(is_ours(hook) for hook in inner):
                left = [hook for hook in inner if not is_ours(hook)]
                removed += len(inner) - len(left)
                if not left and set(group) <= {"matcher", "hooks"}:
                    continue
                group = dict(group, hooks=left)
            kept.append(group)
        if removed:
            hooks = settings["hooks"]
            if kept:
                hooks["PreToolUse"] = kept
            else:
                del hooks["PreToolUse"]
                if not hooks:
                    del settings["hooks"]
    if not removed:
        return "nothing to remove: no harness entry in " + SETTINGS
    if not settings:
        os.unlink(os.path.join(root, SETTINGS))
        return "removed the harness entry and deleted %s, which held nothing else" % SETTINGS
    save(root, settings)
    return "removed the harness entry from " + SETTINGS


def git(root, *args):
    try:
        return subprocess.run(["git", "-C", root, *args], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        return None


def exclude_settings(root):
    """Keep the settings file out of git without touching a committed file. Returns one line."""
    prefix = git(root, "rev-parse", "--show-prefix")
    if prefix is None or prefix.returncode != 0:
        return "not a git repository; nothing added to .git/info/exclude"
    rel = prefix.stdout.strip() + SETTINGS
    tracked = git(root, "ls-files", "--error-unmatch", "--", SETTINGS)
    if tracked is not None and tracked.returncode == 0:
        return "%s is tracked by git; .git/info/exclude left alone" % SETTINGS
    ignored = git(root, "check-ignore", "-q", "--", SETTINGS)
    if ignored is not None and ignored.returncode == 0:
        return "git already ignores %s" % SETTINGS
    where = git(root, "rev-parse", "--git-path", "info/exclude")
    if where is None or where.returncode != 0 or not where.stdout.strip():
        return "could not find .git/info/exclude; add /%s to it yourself" % rel
    path = where.stdout.strip()
    if not os.path.isabs(path):
        path = os.path.join(root, path)
    line = "/" + rel
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(path, flags, 0o644)
        try:
            text = b""
            while True:
                chunk = os.read(fd, 65536)
                if not chunk:
                    break
                text += chunk
            if line.encode("utf-8") in text.splitlines():
                return "git already excludes %s" % SETTINGS
            os.lseek(fd, 0, os.SEEK_END)
            os.write(fd, (b"" if not text or text.endswith(b"\n") else b"\n") + line.encode("utf-8") + b"\n")
        finally:
            os.close(fd)
    except OSError as error:
        return "could not update .git/info/exclude (%s); add %s to it yourself" % (error.strerror or error, line)
    return "added %s to .git/info/exclude" % line


def main(argv):
    if len(argv) != 3 or argv[1] not in {"add", "remove"}:
        print("usage: sh-hook-register.py add|remove <target-dir>", file=sys.stderr)
        return 2
    selected = os.path.abspath(os.path.expanduser(argv[2]))
    if not os.path.isdir(selected) or os.path.islink(selected):
        print("hook-register: select an existing target directory, not a symbolic link", file=sys.stderr)
        return 2
    root = os.path.realpath(selected)
    try:
        if argv[1] == "add":
            print(add(root))
            print(exclude_settings(root))
        else:
            print(remove(root))
    except Refused as error:
        print("NOT registered: %s" % error if argv[1] == "add" else "NOT removed: %s" % error)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
