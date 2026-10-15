#!/usr/bin/env bash
# finalize-init: dry run by default, journaled apply, exact recovery after a hard crash before or
# after every write, SIGINT/SIGTERM rollback, leftover temporaries, a lock against two finalizers,
# and refusal of tampered, linked, FIFO, oversized or unbound journals and of recovery after success.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=lib/portable.sh
. "$ROOT/tests/lib/portable.sh"
require_tools bash
require_python311
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sh-finalize.XXXXXX")" || exit 1
trap 'rm -rf "$TMP"' EXIT

python3 -u -I -B - "$ROOT" "$TMP" <<'PY'
import base64, json, os, re, shutil, signal, subprocess, sys, time
from pathlib import Path

harness, tmp = Path(sys.argv[1]), Path(sys.argv[2])
sys.path.insert(0, str(harness / "tests/lib"))
import ready_fixture as fx

CLI = ["bash", str(harness / "bin/spec-harness")]
FINALIZE = str(harness / "bin/sh-finalize-init.py")
LOCK = ".claude/agents/.sh-finalize.lock"


def run(args, expected, label, cwd=None):
    result = subprocess.run(args, capture_output=True, text=True, cwd=cwd)
    output = result.stdout + result.stderr
    assert result.returncode == expected, f"{label}: expected exit {expected}, got {result.returncode}\n{output}"
    return output


def finalize(target, *extra, expected=0, label="finalize", cwd=None):
    return run(CLI + ["finalize-init", str(target), *extra], expected, label, cwd=cwd)


# A hook runner. It runs the shipped finalizer's top level, applies one patch, then runs the shipped file's own
# `if __name__ == "__main__":` block unchanged, so an interrupt reaches the real top-level handler. The source is
# split at that line only to put the patch in between; the block is compiled with its original line numbers.
HOOK = r'''
import importlib.util, os, signal, subprocess, sys, time, types
ARGS = list(sys.argv)
MAIN_MARK = '\nif __name__ == "__main__":\n'
module = types.ModuleType("finalizer")
module.__file__ = ARGS[1]
source = open(ARGS[1]).read()
assert source.count(MAIN_MARK) == 1, "the finalizer must have exactly one __main__ block"
head, main_block = source.split(MAIN_MARK)
exec(compile(head, ARGS[1], "exec"), module.__dict__)
mode, number = ARGS[4], int(ARGS[5])
count = [0]
original_replace = module.replace
def counted_replace(*args):
    count[0] += 1
    if mode == "unnamed-conflict" and count[0] == number:
        raise RuntimeError("planted unnamed failure")
    if mode in ("restore-fails", "restore-conflict", "error-then-sigint-in-restore") and count[0] == number:
        raise OSError("planted write failure")
    if mode == "double-signal" and count[0] == number:
        # Probe: the first SIGINT raises Interrupted; a second SIGINT lands while the first unwinds.
        try:
            os.kill(os.getpid(), signal.SIGINT)
        except module.Interrupted:
            state = "SIG_IGN" if signal.getsignal(signal.SIGINT) == signal.SIG_IGN else "handler"
            print("PROBE first-handler=" + state, file=sys.stderr)
            try:
                os.kill(os.getpid(), signal.SIGINT)
                print("PROBE second-signal=ignored", file=sys.stderr)
            except module.Interrupted:
                print("PROBE second-signal=raised", file=sys.stderr)
            raise
    if mode == "crash-before" and count[0] == number:
        os._exit(23)
    original_replace(*args)
    if mode == "crash-after" and count[0] == number:
        os._exit(23)
    if mode in ("partial-restore", "rollback-lock-oserror", "unwritten-edit") and count[0] == number:
        # An interrupt after the third write: the run has written three journaled files and then unwinds.
        os.kill(os.getpid(), signal.SIGINT)
        time.sleep(1)
    if mode in ("SIGINT", "SIGTERM") and count[0] == number:
        os.kill(os.getpid(), getattr(signal, mode))
        time.sleep(1)
module.replace = counted_replace
if mode == "restore-fails":
    def failing_restore(*args):
        raise OSError("planted restore failure")
    module.restore = failing_restore
if mode == "error-then-sigint-in-restore":
    original_restore_sig = module.restore
    def sigint_restore(root, journal, evidence):
        os.kill(os.getpid(), signal.SIGINT)
        return original_restore_sig(root, journal, evidence)
    module.restore = sigint_restore
if mode == "restore-conflict":
    # A human edit to the written inventory lands before the rollback reads it: a conflict.
    original_restore = module.restore
    def conflicting_restore(root, journal, evidence):
        with open(os.path.join(root, "ai_rules/project_inventory.json"), "ab") as handle:
            handle.write(b"\n")
        return original_restore(root, journal, evidence)
    module.restore = conflicting_restore
if mode == "crash-at-rename":
    real = module.os.replace
    def rename(src, dst, **kwargs):
        if str(src).startswith(module.TEMP_PREFIX):
            count[0] += 1
            if count[0] == number:
                os._exit(23)
        return real(src, dst, **kwargs)
    module.os.replace = rename
if mode == "edit-before-rename":
    # The third read of the inventory is the re-hash just before its rename; a human edits first.
    original_read = module.read_target
    reads = [0]
    def read_with_edit(root, path):
        if path == "ai_rules/project_inventory.json":
            reads[0] += 1
            if reads[0] == number:
                with open(os.path.join(root, path), "ab") as handle:
                    handle.write(b"\n")
        return original_read(root, path)
    module.read_target = read_with_edit
if mode == "sigint-after-lock":
    # The lock window: a SIGINT lands right after the lock file exists (the old code had no handler yet).
    original_acquire = module.acquire_lock
    def acquire_then_sigint(root):
        original_acquire(root)
        os.kill(os.getpid(), signal.SIGINT)
    module.acquire_lock = acquire_then_sigint
if mode in ("lock-sync-fails", "lock-sync-fails-sigint"):
    # The first fsync while the lock file exists is the lock's own: it fails, and with the -sigint mode a
    # SIGINT is sent first, so the signal is held back by take_lock and lands after the error.
    real_full_sync = module.full_sync
    lock_syncs = [0]
    def failing_lock_sync(fd):
        if lock_syncs[0] == 0 and os.path.exists(os.path.join(ARGS[2], ".claude/agents/.sh-finalize.lock")):
            lock_syncs[0] += 1
            if mode == "lock-sync-fails-sigint":
                os.kill(os.getpid(), signal.SIGINT)
            raise OSError("planted lock sync failure")
        return real_full_sync(fd)
    module.full_sync = failing_lock_sync
if mode == "release-sigint":
    # A SIGINT lands after STRUCTURAL_READY is recorded, at the release call in apply's finally.
    original_release = module.release_lock
    def release_with_sigint(root):
        os.kill(os.getpid(), signal.SIGINT)
        return original_release(root)
    module.release_lock = release_with_sigint
if mode == "release-after":
    # A SIGINT lands after the release call has removed the lock file (the commit point).
    original_release_after = module.release_lock
    def release_then_sigint(root):
        original_release_after(root)
        os.kill(os.getpid(), signal.SIGINT)
    module.release_lock = release_then_sigint
if mode == "status-sigint":
    # A SIGINT lands at the STRUCTURAL_READY write: number 0 before the journal write, number 1 after it.
    original_store = module.store_journal
    def store_with_sigint(evidence, journal):
        ready = journal.get("status") == "STRUCTURAL_READY"
        if ready and number == 0:
            os.kill(os.getpid(), signal.SIGINT)
        original_store(evidence, journal)
        if ready and number == 1:
            os.kill(os.getpid(), signal.SIGINT)
    module.store_journal = store_with_sigint
if mode == "return-sigint":
    # A SIGINT lands on the line that returns 0 after the success message (traced by line number).
    lines = open(ARGS[1]).read().splitlines()
    marker = next(i for i, text in enumerate(lines, 1) if "STRUCTURAL_READY: binding refresh" in text)
    return_line = next(i for i in range(marker, len(lines) + 1) if lines[i - 1].strip() == "return 0")
    fired = [False]
    def tracer(frame, event, arg):
        if frame.f_code.co_name != "apply":
            return None
        def local(frame, event, arg):
            if event == "line" and frame.f_lineno == return_line and not fired[0]:
                fired[0] = True
                os.kill(os.getpid(), signal.SIGINT)
            return local
        return local
    sys.settrace(tracer)
if mode == "after-main-sigint":
    # A SIGINT lands after apply() has returned 0: the top level (the shipped __main__ block) must roll back.
    original_main = module.main
    def main_then_sigint(argv=None):
        code = original_main(argv)
        os.kill(os.getpid(), signal.SIGINT)
        return code
    module.main = main_then_sigint
if mode == "race-after-commit":
    # The commit point releases the lock. A second finalizer then takes the lock and holds it until the test
    # releases it (hold-lock below); the interrupt lands while the lock is busy, so the rollback must refuse.
    original_release_race = module.release_lock
    def release_then_race(root):
        original_release_race(root)
        base = ARGS[3]
        holder = subprocess.Popen([sys.executable, "-I", "-B", os.environ["HOOK_FILE"], ARGS[1], root, base + "-other-ev", "hold-lock", "0"],
                                  stdout=open(base + "-other.log", "w"), stderr=subprocess.STDOUT,
                                  env=dict(os.environ, HOLD_FILE=base + "-release"))
        with open(base + "-holder", "w") as record:
            record.write(str(holder.pid))
        lock_path = os.path.join(root, ".claude/agents/.sh-finalize.lock")
        deadline = time.time() + 30
        while time.time() < deadline:
            try:
                if open(lock_path).read() == f"{holder.pid}\n":
                    break
            except FileNotFoundError:
                pass
            time.sleep(0.01)
        os.kill(os.getpid(), signal.SIGINT)
    module.release_lock = release_then_race
if mode == "hold-lock":
    # Runs as the second finalizer: it holds the lock inside plan() until the test writes HOLD_FILE.
    original_plan_hold = module.plan
    def hold_plan(*args, **kwargs):
        deadline = time.time() + 60
        while not os.path.exists(os.environ["HOLD_FILE"]) and time.time() < deadline:
            time.sleep(0.05)
        return original_plan_hold(*args, **kwargs)
    module.plan = hold_plan
if mode == "slow-tool":
    # A tool step that outlives its limit: the check sleeps 150 s. The limit is the timeout argument run_tool
    # passes to subprocess.run, which this hook records. The module constant is NOT overwritten, so a changed
    # constant or call argument reaches the test. The documented 600 s is shortened to 2 s here only so the
    # test is fast; any other argument (a day, None) passes through unchanged, and the test's 60 s bound fires.
    module.check_command = lambda root: [sys.executable, "-c", "import time; time.sleep(150)"]
    real_run = subprocess.run
    def bounded_run(command, *args, **kwargs):
        print("PROBE run-timeout=" + repr(kwargs.get("timeout")), file=sys.stderr, flush=True)
        if kwargs.get("timeout") == 600:
            kwargs["timeout"] = 2
        return real_run(command, *args, **kwargs)
    subprocess.run = bounded_run
if mode == "rollback-lock-oserror":
    # The second lock take is the rollback's: its create fails with an OSError (not a Refused).
    original_acquire_os = module.acquire_lock
    acquire_calls = [0]
    def acquire_second_fails(root):
        acquire_calls[0] += 1
        if acquire_calls[0] == 2:
            raise OSError(13, "planted lock create failure")
        return original_acquire_os(root)
    module.acquire_lock = acquire_second_fails
if mode == "unnamed-conflict":
    # An unnamed failure (not a Refused, OSError, ValueError, KeyError or TypeError) after the second write, and a
    # concurrent human edit to the inventory that the rollback then finds: the conflict must still be printed.
    original_restore_unnamed = module.restore
    def conflicting_restore_after_unnamed(root, journal, evidence):
        with open(os.path.join(root, "ai_rules/project_inventory.json"), "ab") as handle:
            handle.write(b"\n")
        return original_restore_unnamed(root, journal, evidence)
    module.restore = conflicting_restore_after_unnamed
if mode == "edit-then-foreign-lock":
    # The re-hash before the inventory's rename (the third read) sees a human edit, and the lock file is then
    # replaced by another run's record: the rollback's lock take is refused.
    original_read_foreign = module.read_target
    foreign_reads = [0]
    def read_edit_then_foreign_lock(root, path):
        if path == "ai_rules/project_inventory.json":
            foreign_reads[0] += 1
            if foreign_reads[0] == number:
                with open(os.path.join(root, path), "ab") as handle:
                    handle.write(b"\n")
                with open(os.path.join(root, ".claude/agents/.sh-finalize.lock"), "w") as handle:
                    handle.write("1\n")
        return original_read_foreign(root, path)
    module.read_target = read_edit_then_foreign_lock
if mode == "unwritten-edit":
    # RULES.md is journaled but this run never wrote it. A human edit lands in it before the rollback reads it.
    original_restore_unwritten = module.restore
    def restore_after_unwritten_edit(root, journal, evidence):
        with open(os.path.join(root, "RULES.md"), "ab") as handle:
            handle.write(b"\nhuman edit\n")
        return original_restore_unwritten(root, journal, evidence)
    module.restore = restore_after_unwritten_edit
if mode == "print-closed-stdout":
    # The lock is released at the commit point; then stdout is closed, so the success line cannot be printed.
    original_release_closed = module.release_lock
    def release_then_close_stdout(root):
        original_release_closed(root)
        sys.stdout.close()
    module.release_lock = release_then_close_stdout
if mode == "partial-restore":
    # Restore puts back the first written file, then the second written file has gone missing: its read fails.
    original_restore_partial = module.restore
    def restore_with_missing_second(root, journal, evidence):
        # The in-process journal order is the order restore walks; the journal on disk is sorted, so the test
        # takes the order from this probe, not from the file.
        written = [path for path, row in reversed(list(journal["files"].items())) if row["expected_after"]]
        print("PROBE partial-restore first=" + written[0] + " removed=" + written[1], file=sys.stderr, flush=True)
        os.remove(os.path.join(root, written[1]))
        return original_restore_partial(root, journal, evidence)
    module.restore = restore_with_missing_second
if mode == "busy-take-sigint":
    # A stale lock that records this process's PID is present before the run. The first take (apply's) sees it busy
    # and a SIGINT lands inside that busy take; the rollback then takes the lock again and must not remove it.
    original_acquire_busy = module.acquire_lock
    def acquire_busy_with_stale_lock(root):
        path = os.path.join(root, ".claude/agents/.sh-finalize.lock")
        if not os.path.exists(path):
            with open(path, "w") as handle:
                handle.write(f"{os.getpid()}\n")
        os.kill(os.getpid(), signal.SIGINT)
        return original_acquire_busy(root)
    module.acquire_lock = acquire_busy_with_stale_lock
if mode == "slow":
    original_plan = module.plan
    def slow_plan(*args, **kwargs):
        time.sleep(number)
        return original_plan(*args, **kwargs)
    module.plan = slow_plan
# Run the shipped __main__ block as written: the finalizer's own argv, its own Refused and Interrupted handlers.
module.__dict__["__name__"] = "__main__"
sys.argv = [ARGS[1], ARGS[2], "--apply", "--evidence-dir", ARGS[3]]
exec(compile("\n" * (head.count("\n") + 1) + 'if __name__ == "__main__":\n' + main_block, ARGS[1], "exec"), module.__dict__)
'''


HOOK_PATH = tmp / "finalize-hook.py"
HOOK_PATH.write_text(HOOK)


def hooked(target, evidence, mode, number, expected, label):
    return run([sys.executable, "-I", "-B", "-c", HOOK, FINALIZE, str(target), str(evidence), mode, str(number)], expected, label)


start = tmp / "start"
fx.build(start, harness)
initial = fx.snapshot(start)
print("PASS: READY fixture built (inventory first, synthesis outputs after)")

# 1. Dry run is the default and writes nothing.
target = tmp / "dry"
shutil.copytree(start, target)
out = finalize(target, label="dry run")
assert "DRY-RUN" in out and "WRITE ai_rules/project_inventory.json" in out and "planned writes    : 13" in out, out
assert fx.snapshot(target) == initial and not (target / LOCK).exists()
out = finalize(target, "--dry-run", label="explicit dry run")
assert "nothing was written" in out and fx.snapshot(target) == initial
finalize(target, "--apply", expected=1, label="apply without evidence dir")
inside = finalize(target, "--apply", "--evidence-dir", str(target / "evidence"), expected=1, label="evidence inside target")
assert "outside the target" in inside and fx.snapshot(target) == initial
print("PASS: dry run (default and --dry-run) prints 13 planned writes and changes no byte")

# 2. Apply, check, repeat: the second run writes nothing (a fixed point across runs).
target = tmp / "apply"
shutil.copytree(start, target)
out = finalize(target, "--apply", "--evidence-dir", str(tmp / "apply-ev"), label="apply")
assert "STRUCTURAL_READY" in out and "wrote 13 file(s)" in out, out
assert "READY:" in run(CLI + ["generate-agents", "--check", str(target)], 0, "check after apply")
after = fx.snapshot(target)
for path in (".claude/agents/sdd-reviewer.md",):
    before_text, after_text = initial[path].decode(), after[path].decode()
    outside = lambda text: text[:text.index("<!-- GEN:rules START -->")] + text[text.index("<!-- GEN:rules END -->"):]
    assert outside(before_text) == outside(after_text), "role bytes outside GEN changed"
assert after["RULES.md"] == initial["RULES.md"] and after["src/App.tsx"] == initial["src/App.tsx"]
out = finalize(target, "--apply", "--evidence-dir", str(tmp / "apply-ev2"), label="repeat apply")
assert "wrote 0 file(s)" in out and fx.snapshot(target) == after, out
journal = json.loads((tmp / "apply-ev/journal.json").read_text())
assert journal["status"] == "STRUCTURAL_READY" and journal["semantic_review"] == "PENDING"
writes = sum(bool(row["expected_after"]) for row in journal["files"].values())
assert writes == 13, writes
print("PASS: apply writes 13 files, keeps role text outside GEN and human rules, and a repeat writes 0")

# 3. Recover after success is refused and keeps the result.
out = finalize(target, "--recover", "--evidence-dir", str(tmp / "apply-ev"), expected=1, label="recover after success")
assert "nothing to recover" in out and fx.snapshot(target) == after
print("RED control observed: --recover after STRUCTURAL_READY is refused and the result is kept")

# 4. Hard crash before and after every write, then --recover restores the exact prior bytes.
for mode in ("crash-before", "crash-after"):
    for number in range(1, writes + 1):
        target = tmp / f"{mode}-{number}"
        shutil.copytree(start, target)
        evidence = tmp / f"{mode}-{number}-ev"
        hooked(target, evidence, mode, number, 23, f"{mode} {number}")
        assert (target / LOCK).exists(), "a crashed run leaves its lock"
        blocked = finalize(target, "--apply", "--evidence-dir", str(tmp / f"{mode}-{number}-other"), expected=1, label="apply over a stale lock")
        assert "another finalize-init holds" in blocked
        out = finalize(target, "--recover", "--evidence-dir", str(evidence), label=f"recover {mode} {number}")
        assert "RECOVERED" in out, out
        assert fx.snapshot(target) == initial, (mode, number)
        shutil.rmtree(target)
print(f"PASS: exact recovery after a hard crash before and after each of the {writes} writes; the stale lock blocks a new apply until --recover")

# 5. A crash between writing the temporary file and renaming it leaves a .sh-finalize-* file.
target = tmp / "temp-crash"
shutil.copytree(start, target)
evidence = tmp / "temp-crash-ev"
hooked(target, evidence, "crash-at-rename", 2, 23, "crash at rename")
leftovers = [path for path in target.rglob(".sh-finalize-*")]
assert leftovers, "the crash left no temporary file"
out = finalize(target, "--recover", "--evidence-dir", str(evidence), label="recover temporaries")
assert "RECOVERED" in out and "1 leftover temporary file(s) removed" in out, out
assert not list(target.rglob(".sh-finalize-*")) and fx.snapshot(target) == initial
print("PASS: --recover removes the leftover .sh-finalize-* temporary and restores the prior bytes")

# 6. SIGINT and SIGTERM during the writes roll back through the journal.
for sig in ("SIGINT", "SIGTERM"):
    target = tmp / f"{sig}-target"
    shutil.copytree(start, target)
    evidence = tmp / f"{sig}-ev"
    out = hooked(target, evidence, sig, 3, 130, sig)
    assert "rolled back" in out, out
    assert fx.snapshot(target) == initial and not (target / LOCK).exists()
    assert json.loads((evidence / "journal.json").read_text())["status"] == "ROLLED_BACK"
print("PASS: SIGINT and SIGTERM during writes roll every write back, release the lock and exit 130")

# 6b. A human edit that lands after the plan but before the rename is preserved, not overwritten.
target = tmp / "late-edit"
shutil.copytree(start, target)
out = hooked(target, tmp / "late-edit-ev", "edit-before-rename", 3, 1, "edit before rename")
assert "concurrent edit preserved: ai_rules/project_inventory.json" in out, out
assert (target / "ai_rules/project_inventory.json").read_bytes() == initial["ai_rules/project_inventory.json"] + b"\n"
print("RED control observed: the re-hash right before the rename keeps a late human edit")

# 6c. H5: a failed rollback keeps the lock, so a second finalizer is refused and --recover adopts it.
for mode, expected_status, label in (("restore-fails", "RECOVERY_FAILED", "rollback fails"),
                                     ("restore-conflict", "RECOVERY_CONFLICT", "rollback conflicts")):
    target = tmp / f"lock-{mode}"
    shutil.copytree(start, target)
    evidence = tmp / f"lock-{mode}-ev"
    out = hooked(target, evidence, mode, 2, 1, label)
    assert json.loads((evidence / "journal.json").read_text())["status"] == expected_status
    assert (target / LOCK).exists(), f"{expected_status} must keep the lock; output: {out}"
    if mode == "restore-fails":
        assert "lock kept; run --recover" in out, out
    else:
        # A conflict is not fixed by --recover alone: the message must name the manual step.
        assert "then run --recover" in out and "journal.json" in out and '"before"' in out, out
    blocked = finalize(target, "--apply", "--evidence-dir", str(tmp / f"lock-{mode}-other"), expected=1, label=f"apply after {label}")
    assert "another finalize-init holds" in blocked, blocked
    if mode == "restore-conflict":
        stuck = finalize(target, "--recover", "--evidence-dir", str(evidence), expected=1, label="recover while the conflict stands")
        assert "then run --recover" in stuck and (target / LOCK).exists(), stuck
        # The crashed run's lock removed by hand: --recover takes its own lock, and releases it when recovery fails.
        (target / LOCK).unlink()
        own = finalize(target, "--recover", "--evidence-dir", str(evidence), expected=1, label="recover with its own lock")
        assert "this run's own lock is released" in own and not (target / LOCK).exists(), own
        # The documented manual step: put the file back to the bytes its journal entry records, then --recover.
        row = json.loads((evidence / "journal.json").read_text())["files"]["ai_rules/project_inventory.json"]
        (target / "ai_rules/project_inventory.json").write_bytes(base64.b64decode(row["before"]))
        out = finalize(target, "--recover", "--evidence-dir", str(evidence), label="recover after the manual step")
        assert "RECOVERED" in out and fx.snapshot(target) == initial and not (target / LOCK).exists(), out
    if mode == "restore-fails":
        out = finalize(target, "--recover", "--evidence-dir", str(evidence), label="recover after failed rollback")
        assert "RECOVERED" in out and fx.snapshot(target) == initial and not (target / LOCK).exists(), out
print("RED control observed: a failed rollback keeps the lock; --recover adopts it and restores the prior bytes")

# PROBE-6e: a SIGINT that lands during the rollback of a non-signal failure must not abort the rollback.
target = tmp / "sig-in-restore"
shutil.copytree(start, target)
evidence = tmp / "sig-in-restore-ev"
out = hooked(target, evidence, "error-then-sigint-in-restore", 2, 1, "signal during rollback")
journal_status = json.loads((evidence / "journal.json").read_text())["status"]
print("PROBE-6e status=" + journal_status + " lock_exists=" + str((target / LOCK).exists()) + " out=" + out.replace(chr(10), " | "), file=sys.stderr)
assert journal_status == "ROLLED_BACK" and not (target / LOCK).exists() and fx.snapshot(target) == initial, out

# 6d. H5: after the first SIGINT, a second signal that lands while the first unwinds is ignored.
# The probe is deterministic (the signal is sent inside the unwind), so twenty runs must agree.
red = []
for attempt in range(20):
    target = tmp / f"double-{attempt}"
    shutil.copytree(start, target)
    evidence = tmp / f"double-{attempt}-ev"
    out = hooked(target, evidence, "double-signal", 3, 130, f"double SIGINT {attempt}")
    if "PROBE first-handler=SIG_IGN" not in out or "PROBE second-signal=ignored" not in out:
        red.append(attempt)
    assert fx.snapshot(target) == initial and not (target / LOCK).exists(), f"run {attempt}: rollback incomplete"
    assert json.loads((evidence / "journal.json").read_text())["status"] == "ROLLED_BACK", f"run {attempt}"
    shutil.rmtree(target)
assert not red, f"{len(red)} of 20 runs let a second SIGINT escape the rollback handler; last output:\n{out}"
print("PASS: twenty double-SIGINT runs ignore the second signal, roll back every write and release the lock")

# 6f. A SIGINT that lands right after this run creates the lock must not leave that lock behind,
# and must roll back and exit 130 like any other interrupt (the handler is installed before the lock).
target = tmp / "lock-window"
shutil.copytree(start, target)
evidence = tmp / "lock-window-ev"
proc = subprocess.run([sys.executable, "-I", "-B", "-c", HOOK, FINALIZE, str(target), str(evidence), "sigint-after-lock", "0"],
                      capture_output=True, text=True)
out = proc.stdout + proc.stderr
assert not (target / LOCK).exists(), f"a SIGINT in the lock window left {LOCK} behind:\n{out}"
assert proc.returncode == 130 and "interrupted by SIGINT" in out, f"expected exit 130 via the handler, got {proc.returncode}:\n{out}"
assert fx.snapshot(target) == initial, "a SIGINT in the lock window changed the target"
print("PASS: a SIGINT right after the lock is created leaves no lock, changes no byte and exits 130")

# 6g. A tool step that outlives TOOL_TIMEOUT fails the run with the step and the command named, rolls back,
# and releases the lock. The finalizer must not hang: the test bounds its own run at 60 seconds.
target = tmp / "tool-timeout"
shutil.copytree(start, target)
evidence = tmp / "tool-timeout-ev"
log_path = tmp / "tool-timeout.log"
with open(log_path, "w") as log:
    try:
        timed_exit = subprocess.run([sys.executable, "-I", "-B", "-c", HOOK, FINALIZE, str(target), str(evidence), "slow-tool", "0"],
                                    stdout=log, stderr=subprocess.STDOUT, timeout=60).returncode
    except subprocess.TimeoutExpired:
        timed_exit = "hung (no result within 60 s)"
out = log_path.read_text()
# The limit the code passed to subprocess.run (recorded by the hook) must be the documented 600 s, and the
# refusal must name that same value. A day in the call or in the constant reaches the 60 s bound instead.
probe = re.search(r"PROBE run-timeout=(\S+)", out)
passed = probe.group(1) if probe else "no PROBE line"
assert timed_exit == 1 and passed == "600" and "step 'generate-agents --check' timed out after 600 s: its direct child was stopped, but a child process it started may keep running" in out and "every write was rolled back" in out, \
    f"expected a named timeout refusal for the documented 600 s limit, got {timed_exit} with passed timeout {passed}:\n{out}"
assert fx.snapshot(target) == initial and not (target / LOCK).exists(), "a timed-out run changed the target or kept its lock"
assert json.loads((evidence / "journal.json").read_text())["status"] == "ROLLED_BACK"
print("PASS: a tool step past its timeout fails the run with the step and command named, and rolls back")

# 6h. NEEDED-1: a failure right after the lock file is created (its fsync raises) leaves no lock behind.
target = tmp / "lock-sync-fails"
shutil.copytree(start, target)
out = hooked(target, tmp / "lock-sync-fails-ev", "lock-sync-fails", 0, 1, "lock fsync fails")
assert not (target / LOCK).exists(), f"a failed lock fsync left {LOCK} behind:\n{out}"
assert fx.snapshot(target) == initial, "a failed lock fsync changed the target"
print("PASS: a failed fsync right after the lock is created leaves no lock and changes no byte")

# 6i. NEEDED-1 with a signal: a SIGINT that lands together with that failure leaves no lock and exits 130.
target = tmp / "lock-sync-fails-sigint"
shutil.copytree(start, target)
out = hooked(target, tmp / "lock-sync-fails-sigint-ev", "lock-sync-fails-sigint", 0, 130, "lock fsync fails with SIGINT")
assert not (target / LOCK).exists(), f"a SIGINT with a failed lock fsync left {LOCK} behind:\n{out}"
assert "interrupted by SIGINT" in out and fx.snapshot(target) == initial, out
print("PASS: a SIGINT with a failed lock fsync leaves no lock, changes no byte and exits 130")

# 6j. Ruling (2026-10-15): a SIGINT at ANY point after the first target write, before the run returns, rolls the
# run back: exit 130, status ROLLED_BACK, every byte restored to the start snapshot, no lock file. A completed
# run is never kept when it is interrupted. Points: the release call (lock still present), the STRUCTURAL_READY
# write (before and after the journal write), the line that returns 0 after the success message, and the point
# after apply() has returned 0 (the top level still rolls back).
for label, mode, number in (("the release call", "release-sigint", 0),
                            ("the STRUCTURAL_READY write, before it", "status-sigint", 0),
                            ("the STRUCTURAL_READY write, after it", "status-sigint", 1),
                            ("the line before return 0", "return-sigint", 0),
                            ("after apply() returned 0", "after-main-sigint", 0)):
    target = tmp / f"6j-{mode}-{number}"
    shutil.copytree(start, target)
    evidence = tmp / f"6j-{mode}-{number}-ev"
    out = hooked(target, evidence, mode, number, 130, f"SIGINT at {label}")
    status = json.loads((evidence / "journal.json").read_text())["status"]
    assert status == "ROLLED_BACK", f"SIGINT at {label}: status {status}, expected ROLLED_BACK:\n{out}"
    assert not (target / LOCK).exists(), f"SIGINT at {label} left {LOCK} behind:\n{out}"
    assert fx.snapshot(target) == initial, f"SIGINT at {label} did not restore every byte:\n{out}"
    assert "every write was rolled back" in out, f"SIGINT at {label}: {out}"
print("PASS: a SIGINT at the release call, the STRUCTURAL_READY write or the line before return 0 rolls back, releases the lock and exits 130")

# 6k. Ruling (2026-10-15): a SIGINT that lands after the release call has already removed the lock file (the
# commit point) still rolls the run back, leaves no lock, restores every byte and exits 130.
target = tmp / "6k-release-after"
shutil.copytree(start, target)
evidence = tmp / "6k-release-after-ev"
out = hooked(target, evidence, "release-after", 0, 130, "SIGINT after the release call")
assert not (target / LOCK).exists(), f"a SIGINT after the release call left {LOCK} behind:\n{out}"
assert json.loads((evidence / "journal.json").read_text())["status"] == "ROLLED_BACK", out
assert fx.snapshot(target) == initial, f"a SIGINT after the release call did not restore every byte:\n{out}"
assert "interrupted by SIGINT" in out, out
print("PASS: a SIGINT after the release call has removed the lock still rolls back, leaves no lock and exits 130")

# 6l. Ruling (2026-10-15), race: the commit point releases the lock, so a second finalizer can take it before a
# top-level rollback writes. The rollback must hold the lock before it writes. While another run holds it, the
# rollback refuses with the lock message, writes nothing, leaves the other run's lock alone and exits 1.
done = tmp / "race-done"
shutil.copytree(start, done)
finalize(done, "--apply", "--evidence-dir", str(tmp / "race-done-ev"), label="clean run for the completed snapshot")
def content(root):
    snap = fx.snapshot(root)
    snap.pop(LOCK, None)
    return snap


completed = content(done)
assert completed != initial
target = tmp / "race-window"
shutil.copytree(start, target)
race_ev = tmp / "race-ev"
proc = subprocess.run([sys.executable, "-I", "-B", str(HOOK_PATH), FINALIZE, str(target), str(race_ev), "race-after-commit", "0"],
                      capture_output=True, text=True, timeout=120, env=dict(os.environ, HOOK_FILE=str(HOOK_PATH)))
race_out = proc.stdout + proc.stderr
assert proc.returncode == 1, f"a rollback that finds the lock busy must exit 1, got {proc.returncode}:\n{race_out}"
assert f"another finalize-init holds {LOCK}" in race_out, race_out
race_journal = json.loads((race_ev / "journal.json").read_text())
assert race_journal["status"] == "STRUCTURAL_READY" and "rollback refused" in race_journal["failure"], race_journal
assert content(target) == completed, "the rollback wrote while another run held the lock"
holder_pid = (tmp / "race-ev-holder").read_text()
assert (target / LOCK).read_text() == f"{holder_pid}\n", "the rollback removed or changed the other run's lock"
open(str(race_ev) + "-release", "w").close()
deadline = time.time() + 120
while (target / LOCK).exists() and time.time() < deadline:
    time.sleep(0.05)
assert not (target / LOCK).exists(), "the other run did not finish after the release"
other_log = (tmp / "race-ev-other.log").read_text()
assert "STRUCTURAL_READY" in other_log and "Traceback" not in other_log, other_log
assert content(target) == completed, "the other run changed the completed target"
print("PASS: a rollback that finds the lock busy after the commit point refuses, writes nothing and leaves the other run's lock")

# 6m. N6: a stale lock that records this process's PID is not this run's. A SIGINT that lands in the busy take
# must not make the rollback remove it: the run refuses (exit 1) and the lock file stays.
target = tmp / "stale-lock-busy"
shutil.copytree(start, target)
evidence = tmp / "stale-lock-busy-ev"
out = hooked(target, evidence, "busy-take-sigint", 0, 1, "busy take with a stale lock and SIGINT")
assert (target / LOCK).exists(), f"a busy take with SIGINT removed a lock this run did not create:\n{out}"
assert "another finalize-init holds" in out and "interrupted by SIGINT" in out, out
print("PASS: a SIGINT inside a busy lock take refuses the rollback and leaves a lock this run did not create")

# 6n. N5: an OSError from the rollback's own lock take is not a Refused. It must still end as a named refusal: the
# rollback writes nothing, the journal status stays as it was (APPLYING), interrupted_exit prints the refusal, exits 1
# and no traceback is printed.
target = tmp / "rollback-lock-oserror"
shutil.copytree(start, target)
evidence = tmp / "rollback-lock-oserror-ev"
out = hooked(target, evidence, "rollback-lock-oserror", 3, 1, "rollback lock create fails")
assert "Traceback" not in out, f"an OSError from the rollback's lock take escaped as a traceback:\n{out}"
assert "the rollback was refused and wrote nothing" in out and "planted lock create failure" in out, out
status = json.loads((evidence / "journal.json").read_text())["status"]
assert status == "APPLYING", f"status {status}, expected APPLYING (as it was before the refusal):\n{out}"
print("PASS: an OSError from the rollback's lock take is a named refusal: nothing written, status kept, exit 1")

# 6o. N2: a rollback that restores some files and then fails is partial. The interrupt print must say so and name
# the files, and must not say that nothing was written. Restore puts back the first written file, then the second
# written file cannot be read (it was removed).
target = tmp / "partial-restore"
shutil.copytree(start, target)
evidence = tmp / "partial-restore-ev"
out = hooked(target, evidence, "partial-restore", 3, 1, "partial restore")
assert "wrote nothing" not in out, f"a partial restore must not claim that nothing was written:\n{out}"
probe = re.search(r"PROBE partial-restore first=(\S+) removed=(\S+)", out)
assert probe, f"no probe line:\n{out}"
first, removed = probe.group(1), probe.group(2)
journal = json.loads((evidence / "journal.json").read_text())
assert journal["status"] == "RECOVERY_FAILED", journal["status"]
assert journal["restored"] == [first], f"expected only {first} restored, got {journal['restored']}"
assert (target / first).read_bytes() == base64.b64decode(journal["files"][first]["before"]), "the restored file is not the prior bytes"
assert "partial" in out and first in out and removed in out, f"the partial restore must name the files:\n{out}"
assert (target / LOCK).exists(), "a failed restore keeps the lock"
print("PASS: a partial rollback says so and names the restored and the not-restored files")

# 6p. N3: an unnamed failure rolls back, and a conflict that the rollback finds must still be printed as the
# conflict message (the file list for manual recovery). The traceback is not the only output.
target = tmp / "unnamed-conflict"
shutil.copytree(start, target)
evidence = tmp / "unnamed-conflict-ev"
out = hooked(target, evidence, "unnamed-conflict", 2, 1, "unnamed failure with a conflict")
assert "concurrent edits kept, manual recovery needed: ai_rules/project_inventory.json" in out, f"the conflict list was dropped:\n{out}"
assert "Traceback" not in out, f"the conflict must be a named refusal, not a traceback:\n{out}"
assert json.loads((evidence / "journal.json").read_text())["status"] == "RECOVERY_CONFLICT"
assert (target / LOCK).exists(), "a conflict keeps the lock"
print("PASS: an unnamed failure whose rollback finds a conflict prints the conflict list as a named refusal")

# 6q. A3: a failure whose rollback is refused by another run's lock must print the original failure too. The journal
# records it; the printed text carried only the other run's lock message.
target = tmp / "foreign-lock-after-failure"
shutil.copytree(start, target)
evidence = tmp / "foreign-lock-after-failure-ev"
out = hooked(target, evidence, "edit-then-foreign-lock", 3, 1, "a failure whose rollback finds a foreign lock")
assert "concurrent edit preserved: ai_rules/project_inventory.json" in out and "another finalize-init holds" in out, f"the printed text lost the original failure:\n{out}"
assert (target / LOCK).read_text() == "1\n", "the rollback changed or removed another run's lock"
print("PASS: a failure whose rollback is refused by a lock prints the original failure with the refusal")

# 6r. A2: a journaled file this run never wrote (expected_after empty) is not part of the rollback. A human edit to
# it is not a conflict: the rollback completes (exit 130), keeps the edit, and restores every file this run wrote.
target = tmp / "unwritten-edit"
shutil.copytree(start, target)
evidence = tmp / "unwritten-edit-ev"
out = hooked(target, evidence, "unwritten-edit", 3, 130, "a human edit to a file this run never wrote")
journal = json.loads((evidence / "journal.json").read_text())
assert journal["files"]["RULES.md"]["expected_after"] == [], "RULES.md must be a journaled, never-written file for this test"
assert journal["status"] == "ROLLED_BACK", f"status {journal['status']}, expected ROLLED_BACK:\n{out}"
assert "manual recovery" not in out, f"an unwritten file's edit must not be a conflict:\n{out}"
assert (target / "RULES.md").read_bytes() == initial["RULES.md"] + b"\nhuman edit\n", "the human edit was overwritten"
rest, base = fx.snapshot(target), dict(initial)
rest.pop("RULES.md"); base.pop("RULES.md")
assert rest == base and not (target / LOCK).exists(), "the rollback did not restore every file this run wrote"
print("PASS: a human edit to a file this run never wrote is kept, is not a conflict, and the rollback completes")

# 6s. N8: the run is committed at the lock release. A failure to print its success line afterwards (stdout closed)
# must not roll the verified run back: exit 0, status STRUCTURAL_READY, the completed bytes kept, no lock.
target = tmp / "print-closed-stdout"
shutil.copytree(start, target)
evidence = tmp / "print-closed-stdout-ev"
out = hooked(target, evidence, "print-closed-stdout", 0, 0, "a closed stdout after the commit")
journal = json.loads((evidence / "journal.json").read_text())
assert journal["status"] == "STRUCTURAL_READY", f"status {journal['status']}, expected STRUCTURAL_READY:\n{out}"
assert (target / "ai_rules/project_inventory.json").read_bytes() != initial["ai_rules/project_inventory.json"], "the committed run was undone"
assert not (target / LOCK).exists(), "a committed run left its lock behind"
print("PASS: a print failure after the commit point does not roll the committed run back")

# 7. Two finalizers at once: exactly one gets the lock.
target = tmp / "concurrent"
shutil.copytree(start, target)
slow = subprocess.Popen([sys.executable, "-I", "-B", "-c", HOOK, FINALIZE, str(target), str(tmp / "slow-ev"), "slow", "3"],
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
deadline = time.time() + 20
while not (target / LOCK).exists() and time.time() < deadline:
    time.sleep(0.05)
assert (target / LOCK).exists(), "first finalizer never took the lock"
second = finalize(target, "--apply", "--evidence-dir", str(tmp / "fast-ev"), expected=1, label="second concurrent finalizer")
assert "another finalize-init holds" in second, second
first_out, _ = slow.communicate(timeout=120)
assert slow.returncode == 0 and "STRUCTURAL_READY" in first_out, first_out
assert not (tmp / "fast-ev/journal.json").exists() or json.loads((tmp / "fast-ev/journal.json").read_text())["files"] == {}
print("RED control observed: a second concurrent finalizer is refused while the first holds the lock; the first completes")

# 8. Tampered, linked, FIFO, oversized and unbound journals are refused without touching the target.
def interrupted_copy(label):
    target = tmp / f"tamper-{label}"
    shutil.copytree(start, target)
    evidence = tmp / f"tamper-{label}-ev"
    hooked(target, evidence, "crash-after", 2, 23, f"tamper base {label}")
    return target, evidence, fx.snapshot(target)

target, evidence, crashed = interrupted_copy("outside")
journal = json.loads((evidence / "journal.json").read_text())
journal["files"]["package.json"] = {"before": base64.b64encode(b"{}\n").decode(), "before_sha256": fx.sha(b"{}\n"), "expected_after": [fx.sha((target / "package.json").read_bytes())]}
(evidence / "journal.json").write_text(json.dumps(journal))
out = finalize(target, "--recover", "--evidence-dir", str(evidence), expected=1, label="journal outside write set")
assert "outside the finalize write set" in out and fx.snapshot(target) == crashed, out
print("RED control observed: a journal that lists package.json is refused; package.json is unchanged")

target, evidence, crashed = interrupted_copy("inconsistent")
journal = json.loads((evidence / "journal.json").read_text())
journal["files"]["RULES.md"]["before"] = base64.b64encode(b"# planted rules\n").decode()
(evidence / "journal.json").write_text(json.dumps(journal))
out = finalize(target, "--recover", "--evidence-dir", str(evidence), expected=1, label="inconsistent journal entry")
assert "inconsistent" in out and fx.snapshot(target) == crashed, out
print("RED control observed: a journal entry whose bytes do not match its recorded hash is refused")

target, evidence, crashed = interrupted_copy("unbound")
receipt = target / ".claude/agents/.init-synthesis.json"
receipt.write_text(json.dumps(json.loads(receipt.read_text())) + "\n")
crashed = fx.snapshot(target)
out = finalize(target, "--recover", "--evidence-dir", str(evidence), expected=1, label="journal not bound to receipt")
assert "not the one this journal started from" in out and fx.snapshot(target) == crashed, out
print("RED control observed: a journal not bound to the receipt on disk is refused")

target, evidence, crashed = interrupted_copy("link")
(evidence / "journal.json").rename(evidence / "real.json")
(evidence / "journal.json").symlink_to(evidence / "real.json")
out = finalize(target, "--recover", "--evidence-dir", str(evidence), expected=1, label="symlinked journal")
assert "journal refused" in out and fx.snapshot(target) == crashed, out
(evidence / "journal.json").unlink()
os.mkfifo(evidence / "journal.json")
out = finalize(target, "--recover", "--evidence-dir", str(evidence), expected=1, label="FIFO journal")
assert "journal refused" in out and fx.snapshot(target) == crashed, out
(evidence / "journal.json").unlink()
with open(evidence / "journal.json", "wb") as handle:
    handle.truncate(64 * 1024 * 1024 + 1)
out = finalize(target, "--recover", "--evidence-dir", str(evidence), expected=1, label="oversized journal")
assert "read limit" in out and fx.snapshot(target) == crashed, out
(evidence / "journal.json").unlink()
(evidence / "real.json").rename(evidence / "journal.json")
assert "RECOVERED" in finalize(target, "--recover", "--evidence-dir", str(evidence), label="genuine journal still recovers")
assert fx.snapshot(target) == initial
print("RED control observed: symlinked, FIFO and oversized journals are refused; the genuine journal then recovers")

# 9. A changed semantic input stops the refresh before any write.
target = tmp / "semantic"
shutil.copytree(start, target)
(target / "src/Other.tsx").write_text("export const other = 1;\n")
(target / "package.json").write_text('{"name":"ready-fixture","dependencies":{"react":"18.3.1","zod":"3.0.0"}}\n')
changed = fx.snapshot(target)
out = finalize(target, "--apply", "--evidence-dir", str(tmp / "semantic-ev"), expected=1, label="semantic change")
assert "PENDING" in out and fx.snapshot(target) == changed, out
print("RED control observed: a semantic source change stops finalize with every byte preserved")

# 10. Planted hashlib.py/json.py in the target and the current directory change nothing.
# (Planted in the working directory: inside the target a .py file would be new source evidence.)
target = tmp / "planted"
shutil.copytree(start, target)
cwd = tmp / "planted-cwd"
cwd.mkdir()
for name in ("hashlib", "json"):
    (cwd / f"{name}.py").write_text("import sys\nsys.exit(0)\n")
out = finalize(target, label="dry run with planted modules", cwd=cwd)
assert "DRY-RUN" in out and "planned writes" in out, out
out = finalize(target, "--apply", "--evidence-dir", str(tmp / "planted-ev"), label="apply with planted modules", cwd=cwd)
assert "STRUCTURAL_READY" in out, out
print("PASS: planted hashlib.py and json.py do not hijack finalize-init")
print("All finalize-init fixtures passed.")
PY
