"""finalize-init: guarded, binding-only refresh of an already valid synthesis receipt.

After a model has written the rules, skills, roles and receipt and `generate-agents --check`
prints READY, a later `index` can produce raw inventory bytes that differ only in ways that do not
change any semantic input (for example formatting). This command re-indexes, proves that no package,
policy, workspace, lockfile or exclusion evidence changed, and then rewrites only the
`inventory-sha256=` markers (role files: inside their GEN:rules block only) and the receipt hashes.
It never writes a claim or a citation. Any semantic change stops it: that needs model-led synthesis.

Default is a dry run that prints the planned writes and changes nothing. `--apply` writes through a
durable journal in `--evidence-dir` (outside the target) and rolls back on any failure, SIGINT or
SIGTERM. `--recover` restores the exact prior bytes after a crash.

Run it as `spec-harness finalize-init <target> [--apply|--recover] --evidence-dir <dir>`.
"""
import argparse
import base64
import copy
import hashlib
import json
import os
import re
import shlex
import signal
import stat
import subprocess
import sys

sys.dont_write_bytecode = True
# Isolated mode (-I) leaves this directory off sys.path; import the shared reader explicitly.
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from sh_safe_io import (MAX_FILE_BYTES, MAX_JOURNAL_BYTES, MAX_RECEIPT_BYTES, SafeReadError,  # noqa: E402
                        load_json_object, read_bounded, safe_relative)

RECEIPT = ".claude/agents/.init-synthesis.json"
LOCK = ".claude/agents/.sh-finalize.lock"
JOURNAL = "journal.json"
JOURNAL_FORMAT = "spec-harness-finalize-journal"
TEMP_PREFIX = ".sh-finalize-"
BIND = re.compile(rb"(?<=inventory-sha256=)[0-9a-f]{64}")
HEX64 = re.compile(r"[0-9a-f]{64}")
GEN_START, GEN_END = b"<!-- GEN:rules START -->", b"<!-- GEN:rules END -->"
HARNESS_BIN = os.path.dirname(os.path.realpath(__file__))
# Seconds one tool step (generate-agents --check, index --preview) may run. A normal step takes about
# 0.05 s on a small READY target, so 600 s is far above any real run and still bounds a hung child.
TOOL_TIMEOUT = 600


class Refused(Exception):
    """A precondition failed; the message is reported as PENDING."""


class RollbackFailed(Refused):
    """A restore raised partway: some files may hold the prior bytes and others this run's bytes; the lock is kept."""


class Interrupted(BaseException):
    """SIGINT or SIGTERM arrived; the apply path rolls back before exiting."""


# The run record: apply() fills it before it takes the lock; interrupted_exit() rolls the run back from it.
RUN = {}
# True only while this process holds a lock it created: take_lock sets it, release_lock clears it. A lock file that
# predates this run, or that another run wrote, never sets it, so a stale lock is never this run's to remove.
LOCK_CREATED = False


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encode(data):
    return base64.b64encode(data).decode("ascii")


def decode(text):
    return base64.b64decode(text, validate=True)


# --- write-set allow-list -------------------------------------------------------------------------
# The same rule decides what --apply may write and what --recover may restore.

def allowed_output(path, role=False):
    if not safe_relative(path):
        return False
    if role:
        return re.fullmatch(r"\.claude/agents/sdd-[a-z0-9-]+\.md", path) is not None
    return (
        path == "RULES.md"
        or path.endswith("/RULES.md")
        or re.fullmatch(r"(?:.+/)?ai_rules/rules/[a-z0-9]+(?:-[a-z0-9]+)*\.md", path) is not None
        or re.fullmatch(r"\.claude/skills/spec-harness-[a-z0-9-]+/SKILL\.md", path) is not None
    )


def allowed_inventory(path):
    return path in {"ai_rules/project_inventory.json", "ai_rules/context_map.md"}


def write_set_from_receipt(receipt):
    """Every path a finalize of this receipt may touch, or Refused if one is outside the allow-list."""
    inventory = receipt.get("inventory_path")
    if not allowed_inventory(inventory):
        raise Refused(f"receipt inventory_path is not an allowed inventory output: {inventory!r}")
    paths = {RECEIPT: False, inventory: False}
    for row in receipt.get("packages", []) if isinstance(receipt.get("packages"), list) else []:
        if not isinstance(row, dict):
            raise Refused("receipt package row is not an object")
        paths[row.get("rules_path")] = False
        for module in row.get("rule_modules", []) if isinstance(row.get("rule_modules"), list) else []:
            paths[module.get("path") if isinstance(module, dict) else None] = False
    for key, role in (("skills", False), ("roles", True)):
        for row in receipt.get(key, []) if isinstance(receipt.get(key), list) else []:
            paths[row.get("path") if isinstance(row, dict) else None] = role
    for path, role in paths.items():
        if path in (RECEIPT, inventory):
            continue
        if not allowed_output(path, role):
            raise Refused(f"receipt names a path outside the finalize write set: {path!r}")
    return paths


# --- durable file operations ----------------------------------------------------------------------

def full_sync(fd):
    """fsync, using F_FULLFSYNC on macOS where plain fsync does not reach stable storage."""
    try:
        import fcntl
        if hasattr(fcntl, "F_FULLFSYNC"):
            fcntl.fcntl(fd, fcntl.F_FULLFSYNC)
            return
    except (ImportError, OSError):
        pass
    os.fsync(fd)


def open_parent(root, path):
    """Open each directory of a relative path without following links; return the descriptors."""
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptors = [os.open(root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))]
    try:
        for part in path.split("/")[:-1]:
            descriptors.append(os.open(part, flags, dir_fd=descriptors[-1]))
    except OSError:
        for fd in reversed(descriptors):
            os.close(fd)
        raise Refused(f"cannot open the directory of {path} without following a link")
    return descriptors


def read_target(root, path):
    try:
        return read_bounded(path, MAX_FILE_BYTES, root=root)
    except SafeReadError as error:
        raise Refused(str(error)) from None


def replace(root, path, expected, data):
    """Atomically replace an existing regular file whose current hash is `expected`.

    The temporary file sits next to the target. The current bytes are hashed again immediately
    before the rename; the file and its directory are fully synced after it.
    """
    if not safe_relative(path):
        raise Refused(f"unsafe write path: {path!r}")
    descriptors = open_parent(root, path)
    directory = descriptors[-1]
    name = path.split("/")[-1]
    temporary = None
    try:
        if sha(read_target(root, path)) != expected:
            raise Refused(f"concurrent edit preserved: {path}")
        initial = os.stat(name, dir_fd=directory, follow_symlinks=False)
        temporary = f"{TEMP_PREFIX}{os.getpid()}-{os.urandom(8).hex()}"
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
                     stat.S_IMODE(initial.st_mode), dir_fd=directory)
        try:
            view = memoryview(data)
            while view:
                view = view[os.write(fd, view):]
            full_sync(fd)
        finally:
            os.close(fd)
        # Re-hash right before the rename: a concurrent edit since the plan is preserved.
        if sha(read_target(root, path)) != expected:
            raise Refused(f"concurrent edit preserved: {path}")
        os.replace(temporary, name, src_dir_fd=directory, dst_dir_fd=directory)
        temporary = None
        full_sync(directory)
    finally:
        if temporary:
            try:
                os.unlink(temporary, dir_fd=directory)
            except FileNotFoundError:
                pass
        for fd in reversed(descriptors):
            os.close(fd)


def store_journal(evidence, journal):
    """Write the journal durably: temp file, full sync, rename, then sync the directory."""
    data = (json.dumps(journal, indent=2, sort_keys=True) + "\n").encode()
    directory = os.open(evidence, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    temporary = f".{JOURNAL}.{os.getpid()}.tmp"
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0), 0o600, dir_fd=directory)
        try:
            view = memoryview(data)
            while view:
                view = view[os.write(fd, view):]
            full_sync(fd)
        finally:
            os.close(fd)
        os.replace(temporary, JOURNAL, src_dir_fd=directory, dst_dir_fd=directory)
        full_sync(directory)
    finally:
        os.close(directory)


def cleanup_temporaries(root, paths):
    """Remove leftover .sh-finalize-* temporaries next to every journaled path (after a crash)."""
    removed = []
    for directory_rel in sorted({os.path.dirname(path) for path in paths}):
        descriptors = open_parent(root, (directory_rel + "/x") if directory_rel else "x")
        try:
            directory = descriptors[-1]
            for entry in os.listdir(directory):
                if entry.startswith(TEMP_PREFIX):
                    info = os.stat(entry, dir_fd=directory, follow_symlinks=False)
                    if stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
                        os.unlink(entry, dir_fd=directory)
                        removed.append((directory_rel + "/" if directory_rel else "") + entry)
            full_sync(directory)
        finally:
            for fd in reversed(descriptors):
                os.close(fd)
    return removed


# --- lock -----------------------------------------------------------------------------------------

def acquire_lock(root):
    descriptors = open_parent(root, LOCK)
    name = LOCK.split("/")[-1]
    try:
        try:
            fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600, dir_fd=descriptors[-1])
        except FileExistsError:
            raise Refused(f"another finalize-init holds {LOCK}; wait for it, or run --recover if a previous run crashed") from None
        # The lock file exists from here on. If the write or the sync fails, close the descriptor and remove
        # the file before the error propagates, so a failure never leaves a lock this run created.
        try:
            os.write(fd, f"{os.getpid()}\n".encode())
            full_sync(fd)
        except BaseException:
            try:
                os.close(fd)
            finally:
                try:
                    os.unlink(name, dir_fd=descriptors[-1])
                except FileNotFoundError:
                    pass
            raise
        os.close(fd)
    finally:
        for fd in reversed(descriptors):
            os.close(fd)


def release_lock(root):
    global LOCK_CREATED
    descriptors = open_parent(root, LOCK)
    try:
        os.unlink(LOCK.split("/")[-1], dir_fd=descriptors[-1])
    except FileNotFoundError:
        pass
    finally:
        for fd in reversed(descriptors):
            os.close(fd)
    LOCK_CREATED = False


def take_lock(root):
    """Take the lock with SIGINT and SIGTERM held back until the lock is recorded.

    A held-back signal is delivered as Interrupted when the mask is restored. If it lands after this
    run created the lock, the lock is removed again before Interrupted propagates, so an interrupt
    cannot leave a lock this run created. A busy lock (Refused) is left alone: this run did not create it.
    """
    global LOCK_CREATED
    created = False
    # Assumption: pthread_sigmask changes the mask of the calling thread only. Holding SIGINT and SIGTERM
    # back is therefore correct only in a single-threaded process, and this finalizer creates no threads.
    held = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGTERM})
    try:
        try:
            acquire_lock(root)
            created = True
            LOCK_CREATED = True
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, held)
    except BaseException:
        if created:
            try:
                release_lock(root)
            except (Refused, OSError):
                pass
        raise


# --- plan -----------------------------------------------------------------------------------------

def run_tool(step, command, journal=None, evidence=None):
    try:
        result = subprocess.run(command, capture_output=True, timeout=TOOL_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise Refused(f"step '{step}' timed out after {TOOL_TIMEOUT} s: its direct child was stopped, but a child process it started may keep running; command: {shlex.join(command)}") from None
    if journal is not None:
        stdout = b"" if "--preview" in command else result.stdout
        journal["commands"].append({"args": command[1:], "exit": result.returncode,
                                    "stdout": stdout.decode("utf-8", "replace")[-4000:],
                                    "stderr": result.stderr.decode("utf-8", "replace")[-4000:]})
        store_journal(evidence, journal)
    if result.returncode:
        raise Refused("command failed: " + " ".join(command[1:3]) + ": " + (result.stdout + result.stderr).decode("utf-8", "replace").strip())
    return result.stdout


def check_command(root):
    return ["bash", os.path.join(HARNESS_BIN, "sh-gen-agents.sh"), "--check", root]


def index_command(root, sources):
    command = ["bash", os.path.join(HARNESS_BIN, "sh-index.sh"), root]
    for path in sources:
        command += ["--source", path]
    return command + ["--preview"]


def load_receipt(root):
    try:
        return load_json_object(RECEIPT, MAX_RECEIPT_BYTES, root=root, what="receipt")
    except SafeReadError as error:
        raise Refused(str(error)) from None


def plan(root, sources, journal=None, evidence=None):
    """Return (receipt, write set, frozen inputs, before bytes, rewritten bytes, new inventory hash)."""
    run_tool("generate-agents --check", check_command(root), journal, evidence)
    receipt = load_receipt(root)
    receipt_bytes = read_target(root, RECEIPT)
    write_set = write_set_from_receipt(receipt)
    inventory_path = receipt["inventory_path"]
    if inventory_path != "ai_rules/project_inventory.json":
        raise Refused("binding refresh supports the JSON inventory only; re-run init for a Markdown context map")
    before = {RECEIPT: receipt_bytes, inventory_path: read_target(root, inventory_path)}
    if sha(before[inventory_path]) != receipt.get("inventory_sha256"):
        raise Refused("inventory changed since the check")
    outputs = {}

    def add(path, digest, role):
        if path in outputs:
            raise Refused(f"duplicate output in receipt: {path}")
        data = read_target(root, path)
        if sha(data) != digest:
            raise Refused(f"output changed since the check: {path}")
        if role and (data.count(GEN_START) != 1 or data.count(GEN_END) != 1 or data.index(GEN_START) > data.index(GEN_END)):
            raise Refused(f"role file has no single GEN:rules region: {path}")
        outputs[path] = role
        before[path] = data

    for row in receipt["packages"]:
        add(row["rules_path"], row["sha256"], False)
        for module in row.get("rule_modules", []):
            add(module["path"], module["sha256"], False)
    for row in receipt["skills"]:
        add(row["path"], row["sha256"], False)
    for row in receipt["roles"]:
        add(row["path"], row["sha256"], True)

    # Freeze every cited source and policy input recorded by the receipt or the inventory.
    inputs = {}

    def collect(value):
        if isinstance(value, dict):
            path = value.get("rules_path", value.get("path"))
            digest = value.get("sha256")
            if safe_relative(path) and isinstance(digest, str) and HEX64.fullmatch(digest) and path not in outputs and path not in before:
                if sha(read_target(root, path)) != digest:
                    raise Refused(f"input changed since the check: {path}")
                inputs[path] = digest
            for child in value.values():
                collect(child)
        elif isinstance(value, list):
            for child in value:
                collect(child)

    collect(receipt)
    old_inventory = json.loads(before[inventory_path])
    collect(old_inventory.get("rule_files", []))

    after_inventory = run_tool("index --preview", index_command(root, sources), journal, evidence)
    if not after_inventory.startswith(b"{"):
        raise Refused("index preview is not a JSON inventory")
    new_inventory = json.loads(after_inventory)

    def semantic(value):
        value = copy.deepcopy(value)
        value["rule_files"] = [row for row in value.get("rule_files", []) if row.get("path") not in outputs]
        for package in value.get("packages", []):
            package["applicable_instructions"] = [path for path in package.get("applicable_instructions", []) if path not in outputs]
        return value

    prior, current = semantic(old_inventory), semantic(new_inventory)
    # Visited counts grow when synthesis adds its outputs; every other scan field must hold.
    for value in (prior, current):
        value["scan"] = {key: item for key, item in value.get("scan", {}).items() if not key.startswith("visited_")}
    for key in ("packages", "rule_files", "workspace_files", "lockfiles", "workspace_declarations", "exclusions", "scan", "limitations"):
        if prior.get(key) != current.get(key):
            raise Refused(f"semantic inventory inputs changed ({key}); model-led synthesis is required, not a binding refresh")

    old_hash, new_hash = receipt["inventory_sha256"], sha(after_inventory)
    rewritten = {inventory_path: after_inventory}
    for path, role in outputs.items():
        data = before[path]

        def rebind(region):
            for mark in BIND.findall(region):
                if mark.decode() != old_hash:
                    raise Refused(f"unexpected inventory marker in {path}")
            return BIND.sub(new_hash.encode(), region)

        if role:
            start, end = data.index(GEN_START), data.index(GEN_END)
            rewritten[path] = data[:start] + rebind(data[start:end]) + data[end:]
        else:
            rewritten[path] = rebind(data)
    updated = copy.deepcopy(receipt)
    updated["inventory_sha256"] = new_hash

    def rehash(value):
        if isinstance(value, dict):
            path = value.get("rules_path", value.get("path"))
            if path in rewritten and path != inventory_path and "sha256" in value:
                value["sha256"] = sha(rewritten[path])
            for child in value.values():
                rehash(child)
        elif isinstance(value, list):
            for child in value:
                rehash(child)

    rehash(updated)
    rewritten[RECEIPT] = (json.dumps(updated, indent=2, ensure_ascii=False) + "\n").encode()
    if new_hash == old_hash:
        # Nothing to rebind: keep every byte, including the receipt's own formatting.
        rewritten = {path: before[path] for path in rewritten}
    return receipt, write_set, inputs, before, rewritten, new_hash


# --- apply / recover ------------------------------------------------------------------------------

def verify_inputs(root, inputs):
    for path, digest in inputs.items():
        if sha(read_target(root, path)) != digest:
            raise Refused(f"concurrent input edit preserved: {path}")


def restore(root, journal, evidence):
    """Put back the exact prior bytes of every journaled file whose postimage is still ours.

    journal["restored"] lists each file that now holds its prior bytes, in the order restore reached it, so a
    failure partway can be reported by name.
    """
    conflicts = []
    journal["restored"] = []
    for path, row in reversed(list(journal["files"].items())):
        if not row["expected_after"]:
            # This run never wrote the file, so there is no postimage of its own to put back. Whatever it holds now
            # (including a human edit) is left alone and is not a conflict.
            continue
        current = read_target(root, path)
        prior = decode(row["before"])
        if current == prior:
            journal["restored"].append(path)
            continue
        if sha(current) not in row["expected_after"]:
            conflicts.append(path)
            continue
        replace(root, path, sha(current), prior)
        journal["restored"].append(path)
    removed = cleanup_temporaries(root, journal["files"])
    journal["removed_temporaries"] = removed
    journal["recovery_conflicts"] = conflicts
    return conflicts


def install_signal_handlers():
    """Install the interrupt handler once, before the run record and the lock.

    The first SIGINT or SIGTERM ignores both signals and raises Interrupted, so a second one cannot escape
    the rollback. The handlers stay installed until the process exits.
    """
    def handler(signum, _frame):
        ignore_signals()
        raise Interrupted(signal.Signals(signum).name)
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, handler)


def ignore_signals():
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, signal.SIG_IGN)


def save_journal_quietly(evidence, journal):
    try:
        store_journal(evidence, journal)
    except OSError:
        pass


def lock_holder(root):
    """The PID recorded in the lock, or None when the lock is absent or unreadable."""
    try:
        return int(read_bounded(LOCK, 64, root=root).strip() or b"0")
    except (SafeReadError, ValueError, OSError):
        return None


def hold_lock_for_rollback(root):
    """Hold the finalize lock before a rollback writes anything.

    A commit releases the lock, so after it the lock may be absent (take it again, with take_lock's protections),
    held by another run (refuse with the usual lock message, write nothing) or still this run's (keep it).
    Only a lock this run created (LOCK_CREATED) that still records this process counts as this run's.
    """
    try:
        take_lock(root)
    except Refused:
        if not (LOCK_CREATED and lock_holder(root) == os.getpid()):
            raise
    except OSError as error:
        # The lock step failed before any write: a named refusal, so interrupted_exit and apply print it.
        raise Refused(f"cannot take the finalize lock for the rollback: {error}") from None


def conflict_message(failure, conflicts, evidence):
    return (f"{failure}; concurrent edits kept, manual recovery needed: {', '.join(conflicts)}; lock kept. "
            f"Restore each of those files to the bytes its \"before\" entry records in {evidence}/journal.json "
            "(base64-decoded), then run --recover with the same --evidence-dir")


def roll_back(failure):
    """The one rollback path. apply() calls it on a refusal and interrupted_exit() on an interrupt.

    It works from RUN alone, with signals ignored. It holds the lock before it writes (hold_lock_for_rollback),
    restores every journaled file whose bytes are still this run's postimage, records the outcome in the journal,
    and releases the lock only after a complete rollback. Returns the conflicting paths; the lock is kept for them.
    """
    ignore_signals()
    root, evidence, journal = RUN["root"], RUN["evidence"], RUN["journal"]
    journal["failure"] = failure
    try:
        hold_lock_for_rollback(root)
    except Refused as refusal:
        journal["failure"] = f"{failure}; rollback refused: {refusal}"
        save_journal_quietly(evidence, journal)
        raise Refused(journal["failure"]) from None
    try:
        conflicts = restore(root, journal, evidence)
        journal["status"] = "RECOVERY_CONFLICT" if conflicts else "ROLLED_BACK"
        store_journal(evidence, journal)
    except (Refused, OSError, ValueError) as recovery_error:
        journal["status"] = "RECOVERY_FAILED"
        save_journal_quietly(evidence, journal)
        raise RollbackFailed(f"{failure}; rollback failed: {recovery_error}; lock kept; run --recover") from None
    if not conflicts and LOCK_CREATED:
        try:
            release_lock(root)
        except (Refused, OSError):
            pass
    return conflicts


def interrupted_exit(error):
    """Top-level rollback: an interrupt reached __main__. Returns the process exit code.

    A rolled-back run exits 130. A refused rollback (the lock is held by another run, or the lock step failed)
    writes nothing and exits 1. A failed restore keeps the lock, says which files it restored and which it did
    not, and exits 1. A conflict keeps the conflicting files and exits 1.
    """
    if not RUN:
        print(f"PENDING: interrupted by {error}", file=sys.stderr)
        return 130
    try:
        conflicts = roll_back(f"interrupted by {error}")
    except RollbackFailed as failed:
        journal = RUN["journal"]
        restored = journal.get("restored", [])
        unrestored = [path for path, row in journal["files"].items() if row["expected_after"] and path not in restored]
        if restored:
            outcome = (f"the rollback was partial: restored {', '.join(restored)}; "
                       f"not restored: {', '.join(unrestored)}")
        else:
            outcome = "the rollback failed before it restored any file; this run's writes are still on disk"
        print(f"PENDING: interrupted by {error}; {outcome}: {failed}", file=sys.stderr)
        return 1
    except Refused as refusal:
        print(f"PENDING: interrupted by {error}; the rollback was refused and wrote nothing: {refusal}", file=sys.stderr)
        return 1
    if conflicts:
        print("PENDING: " + conflict_message(f"interrupted by {error}", conflicts, RUN["evidence"]), file=sys.stderr)
        return 1
    print(f"PENDING: interrupted by {error}; every write was rolled back", file=sys.stderr)
    return 130


def apply(root, evidence, sources):
    if os.path.lexists(evidence):
        raise Refused("use a fresh --evidence-dir; --recover handles a previous run")
    os.makedirs(evidence, mode=0o700)
    journal = {"format": JOURNAL_FORMAT, "schema_version": 1, "target": root, "status": "PENDING",
               "files": {}, "commands": [], "receipt_sha256": None}
    # The handlers and the run record go in before the lock and before any write. From here on an interrupt is an
    # Interrupted: it unwinds to __main__, which rolls the run back from RUN. The snapshot (journal["files"]) is
    # complete before the first target write.
    install_signal_handlers()
    RUN.update(root=root, evidence=evidence, journal=journal)
    take_lock(root)
    try:
        store_journal(evidence, journal)
        receipt, write_set, inputs, before, rewritten, new_hash = plan(root, sources, journal, evidence)
        journal["receipt_sha256"] = sha(before[RECEIPT])
        for path, data in before.items():
            journal["files"][path] = {"before": encode(data), "before_sha256": sha(data), "expected_after": []}
        journal["input_sha256"] = inputs
        store_journal(evidence, journal)
        order = [receipt["inventory_path"]] + [path for path in rewritten if path not in (receipt["inventory_path"], RECEIPT)] + [RECEIPT]
        for path in order:
            data = rewritten[path]
            row = journal["files"][path]
            verify_inputs(root, inputs)
            if data == decode(row["before"]):
                continue
            row["expected_after"].append(sha(data))
            journal["status"] = "APPLYING"
            store_journal(evidence, journal)
            replace(root, path, row["before_sha256"], data)
        verify_inputs(root, inputs)
        run_tool("generate-agents --check", check_command(root), journal, evidence)
        second = run_tool("index --preview", index_command(root, sources), journal, evidence)
        if second != rewritten[receipt["inventory_path"]]:
            raise Refused("a second index did not reach the same inventory (no fixed point)")
        for path, data in rewritten.items():
            if read_target(root, path) != data:
                raise Refused(f"postimage changed during the final check: {path}")
        journal.update({"status": "STRUCTURAL_READY", "inventory_sha256": new_hash,
                        "receipt_sha256_after": sha(rewritten[RECEIPT]),
                        "semantic_review": "PENDING", "client_loading": "PENDING"})
        store_journal(evidence, journal)
        # Commit point: the lock is released here. An interrupt after this still rolls the run back, and roll_back
        # takes the lock again before it writes, so a second finalizer that holds the lock when roll_back runs is refused.
        release_lock(root)
        writes = sum(bool(row["expected_after"]) for row in journal["files"].values())
    except Interrupted:
        raise  # __main__ rolls the run back from RUN (interrupted_exit)
    except (Refused, OSError, ValueError, KeyError, TypeError) as error:
        conflicts = roll_back(str(error))
        if conflicts:
            raise Refused(conflict_message(str(error), conflicts, evidence)) from None
        raise Refused(f"{error}; every write was rolled back") from None
    except BaseException as error:
        # A failure the list above does not name still rolls back. A conflict the rollback finds is printed with its
        # file list, as the named branch does; with no conflict the original error propagates as it did before.
        failure = f"unexpected {type(error).__name__}: {error}"
        conflicts = roll_back(failure)
        if conflicts:
            raise Refused(conflict_message(failure, conflicts, evidence)) from error
        raise
    # The run is committed (the lock was released above). A failure to print its success line must not roll it back,
    # so the print sits outside the rollback handlers. The journal still records STRUCTURAL_READY.
    try:
        print(f"STRUCTURAL_READY: binding refresh wrote {writes} file(s); a second index reached the same inventory. "
              "Semantic review and client loading remain PENDING.")
        sys.stdout.flush()
    except (OSError, ValueError):
        pass
    return 0


def load_journal(evidence):
    try:
        return load_json_object(JOURNAL, MAX_JOURNAL_BYTES, root=evidence, what="journal")
    except SafeReadError as error:
        raise Refused(f"journal refused: {error}") from None


def recover(root, evidence):
    journal = load_journal(evidence)
    if journal.get("format") != JOURNAL_FORMAT or journal.get("schema_version") != 1 or not isinstance(journal.get("files"), dict):
        raise Refused("unsupported recovery journal")
    if journal.get("target") != root:
        raise Refused("journal belongs to another target")
    status = journal.get("status")
    if status == "STRUCTURAL_READY":
        raise Refused("that finalize completed (STRUCTURAL_READY); there is nothing to recover and the result is kept")
    if status in {"RECOVERED", "ROLLED_BACK"}:
        raise Refused(f"that journal was already restored ({status})")
    files = journal["files"]
    for path, row in files.items():
        if not isinstance(row, dict) or not isinstance(row.get("before"), str) or not isinstance(row.get("expected_after"), list):
            raise Refused(f"malformed journal entry: {path!r}")
        try:
            prior = decode(row["before"])
        except ValueError:
            raise Refused(f"journal entry is not valid base64: {path!r}") from None
        if sha(prior) != row.get("before_sha256") or not all(isinstance(item, str) and HEX64.fullmatch(item) for item in row["expected_after"]):
            raise Refused(f"journal entry is inconsistent: {path!r}")
    adopted = acquire_or_adopt_lock(root)
    succeeded = False
    try:
        if files:
            if RECEIPT not in files:
                raise Refused("journal has no receipt entry")
            prior_receipt = files[RECEIPT]
            if journal.get("receipt_sha256") != prior_receipt["before_sha256"]:
                raise Refused("journal receipt binding is inconsistent")
            # Bind the journal to the receipt on disk: it must be the receipt this run started from,
            # or the exact receipt this run wrote.
            current_receipt = sha(read_target(root, RECEIPT))
            if current_receipt != prior_receipt["before_sha256"] and current_receipt not in prior_receipt["expected_after"]:
                raise Refused("the receipt on disk is not the one this journal started from or wrote; refusing to restore")
            try:
                frozen = json.loads(decode(prior_receipt["before"]))
            except ValueError:
                raise Refused("journal receipt preimage is not JSON") from None
            if not isinstance(frozen, dict):
                raise Refused("journal receipt preimage is not an object")
            allowed = write_set_from_receipt(frozen)
            if set(files) - set(allowed):
                raise Refused("journal lists paths outside the finalize write set: " + ", ".join(sorted(set(files) - set(allowed))))
        conflicts = restore(root, journal, evidence)
        journal["status"] = "RECOVERY_CONFLICT" if conflicts else "RECOVERED"
        store_journal(evidence, journal)
        if conflicts:
            raise Refused("concurrent edits kept; manual recovery needed: " + ", ".join(conflicts) + ("; lock kept. " if adopted else "; this run's own lock is released. ") +
                          f"Restore each of those files to the bytes its \"before\" entry records in {evidence}/journal.json "
                          "(base64-decoded), then run --recover again with the same --evidence-dir")
        removed = journal.get("removed_temporaries", [])
        print(f"RECOVERED: prior bytes restored; {len(removed)} leftover temporary file(s) removed")
        succeeded = True
        return 0
    finally:
        # A crashed run's lock stays until a genuine recovery succeeds; our own lock is always released.
        if succeeded or not adopted:
            release_lock(root)


def acquire_or_adopt_lock(root):
    """Recovery runs after a crash, so a lock left by the dead run is expected and taken over."""
    try:
        acquire_lock(root)
        return False
    except Refused:
        try:
            data = read_bounded(LOCK, 64, root=root)
            pid = int(data.strip() or b"0")
            if pid <= 0:
                raise ValueError(pid)
        except (SafeReadError, ValueError):
            raise Refused(f"{LOCK} is not a finalize lock; remove it by hand after checking") from None
        try:
            os.kill(pid, 0)
            alive = pid != os.getpid()
        except ProcessLookupError:
            alive = False
        except PermissionError:
            alive = True
        if alive:
            raise Refused(f"finalize-init process {pid} is still running; wait for it") from None
        return True


def dry_run(root, sources):
    receipt, _, inputs, before, rewritten, new_hash = plan(root, sources)
    writes = [path for path, data in rewritten.items() if data != before[path]]
    print("DRY-RUN: finalize-init plan (nothing was written)")
    print(f"  target            : {root}")
    print(f"  inventory sha256  : {receipt['inventory_sha256']} -> {new_hash}")
    print(f"  frozen inputs     : {len(inputs)}")
    for path in rewritten:
        state = "WRITE" if path in writes else "KEEP "
        print(f"  {state} {path}  {sha(before[path])[:12]} -> {sha(rewritten[path])[:12]}")
    print(f"  planned writes    : {len(writes)}")
    print("Apply with: spec-harness finalize-init <target> --apply --evidence-dir <new directory outside the target>")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog="spec-harness finalize-init", description=__doc__.split("\n\n")[0])
    parser.add_argument("target")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="print the planned writes (the default)")
    mode.add_argument("--apply", action="store_true", help="write through a journal in --evidence-dir")
    mode.add_argument("--recover", action="store_true", help="restore prior bytes from the journal in --evidence-dir")
    parser.add_argument("--evidence-dir", help="a directory outside the target for the journal")
    parser.add_argument("--source", action="append", default=[], help="repeat the index --source options used for the inventory")
    args = parser.parse_args(argv)
    selected = os.path.abspath(os.path.expanduser(args.target))
    if not os.path.isdir(selected) or os.path.islink(selected):
        raise Refused("select an existing target directory, not a symbolic link")
    root = os.path.realpath(selected)
    if not (args.apply or args.recover):
        return dry_run(root, args.source)
    if not args.evidence_dir:
        raise Refused("--apply and --recover need --evidence-dir <directory outside the target>")
    evidence = os.path.realpath(os.path.abspath(os.path.expanduser(args.evidence_dir)))
    if evidence == root or evidence.startswith(root + os.sep):
        raise Refused("--evidence-dir must be outside the target")
    if args.recover:
        return recover(root, evidence)
    return apply(root, evidence, args.source)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Refused as error:
        print(f"PENDING: {error}", file=sys.stderr)
        sys.exit(1)
    except Interrupted as error:
        # The interrupt reached the top level: roll the run back from RUN (the same path apply() uses on a refusal).
        sys.exit(interrupted_exit(error))
