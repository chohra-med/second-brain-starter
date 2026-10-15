"""run-state --check: validate one ticket's resumable run state.

The state lives at <target>/.spec-harness/runs/<ticket>/run-state.json (schema in docs/RUN-STATE.md).
The checker reads it through sh_safe_io, so a symlink, a FIFO, a device, an oversized file or a
non-object JSON value fails closed. It checks the shape, the stage order (no skipped stage), the
plan approval bound to the plan bytes on disk, and the review and test evidence the later stages need.

Exit 0 when the state is valid, 1 when it is not, 2 for a bad target or ticket argument.
"""
import argparse
import hashlib
import os
import re
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from sh_safe_io import MAX_FILE_BYTES, MAX_STATE_BYTES, SafeReadError, load_json_object, read_bounded  # noqa: E402

FORMAT = "spec-harness-run-state"
SCHEMA_VERSION = 1
STAGES = ["spec", "plan", "checkpoint", "implement", "review", "test", "summary"]
TICKET = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
TOP_KEYS = {"format", "schema_version", "ticket", "stage", "completed", "spec_path", "plan_path",
            "checkpoint", "review", "test"}


class Defects:
    def __init__(self):
        self.items = []

    def add(self, text):
        self.items.append(text)


def _relative_in_root(value, label, defects):
    """A stored path must be relative, have no backslash, no '..' segment and stay under the target root."""
    if not isinstance(value, str) or not value:
        defects.add(f"{label} must be a non-empty relative path")
        return None
    if os.path.isabs(value) or "\\" in value or ".." in value.split("/") or "\x00" in value:
        defects.add(f"{label} must be a relative path inside the target: {value!r}")
        return None
    return value


def check_state(target, ticket):
    defects = Defects()
    if not TICKET.fullmatch(ticket):
        return None, ["ticket must be a slug of letters, digits, '.', '_' or '-' (max 64)"]
    state_rel = f".spec-harness/runs/{ticket}/run-state.json"
    try:
        state = load_json_object(state_rel, MAX_STATE_BYTES, root=target, what="run state")
    except SafeReadError as error:
        if error.reason == "missing":
            return None, [f"{state_rel}: no run state for ticket {ticket}"]
        return None, [f"{state_rel}: {error.reason}"]

    unknown = sorted(set(state) - TOP_KEYS)
    for key in unknown:
        defects.add(f"unknown top-level key: {key!r}")
    if state.get("format") != FORMAT:
        defects.add(f"format must be {FORMAT!r}")
    if state.get("schema_version") != SCHEMA_VERSION or isinstance(state.get("schema_version"), bool):
        defects.add(f"schema_version must be {SCHEMA_VERSION}")
    if state.get("ticket") != ticket:
        defects.add("ticket field must equal the ticket directory name")

    # A stored path is checked whenever its key is present, before the stage gate can return early;
    # the stage rules below say from which stage each path is required.
    spec_path = _relative_in_root(state["spec_path"], "spec_path", defects) if "spec_path" in state else None
    plan_path = _relative_in_root(state["plan_path"], "plan_path", defects) if "plan_path" in state else None

    stage = state.get("stage")
    if stage not in STAGES:
        defects.add(f"stage must be one of {', '.join(STAGES)}")
        return None, defects.items
    index = STAGES.index(stage)

    completed = state.get("completed")
    if not isinstance(completed, list) or not all(isinstance(item, str) for item in completed):
        defects.add("completed must be a list of stage names")
        completed = []
    expected = STAGES[:index]
    if completed != expected:
        missing = [name for name in expected if name not in completed]
        if missing:
            defects.add(f"stage order: stage {stage!r} reached without completing {missing[0]!r}")
        else:
            defects.add(f"completed must list the earlier stages in order: {expected}")

    needs_plan = index >= STAGES.index("plan")
    if needs_plan and plan_path is None:
        defects.add("plan_path is required from the plan stage on")
    if index >= STAGES.index("spec") and spec_path is None:
        defects.add("spec_path is required from the spec stage on")

    if index >= STAGES.index("checkpoint") or "checkpoint" in completed:
        checkpoint = state.get("checkpoint")
        if not isinstance(checkpoint, dict):
            defects.add("checkpoint is required before implementation (approver, time, plan hash)")
        else:
            if not isinstance(checkpoint.get("approved_by"), str) or not checkpoint.get("approved_by", "").strip():
                defects.add("checkpoint.approved_by must name the approver")
            if not isinstance(checkpoint.get("approved_at"), str) or not checkpoint.get("approved_at"):
                defects.add("checkpoint.approved_at is required")
            digest = checkpoint.get("plan_sha256")
            if not isinstance(digest, str) or not SHA256.fullmatch(digest):
                defects.add("checkpoint.plan_sha256 must be a lowercase SHA-256 hex digest")
            elif plan_path is not None:
                try:
                    actual = hashlib.sha256(read_bounded(plan_path, MAX_FILE_BYTES, root=target)).hexdigest()
                except SafeReadError as error:
                    defects.add(f"plan_path {plan_path!r}: {error.reason}")
                else:
                    if actual != digest:
                        defects.add("checkpoint.plan_sha256 does not match the plan file on disk; the plan changed after approval")

    if index >= STAGES.index("review") or "review" in completed:
        review = state.get("review")
        if not isinstance(review, dict):
            defects.add("review evidence is required before the review stage completes")
        else:
            if review.get("verdict") != "APPROVE":
                defects.add("review.verdict must be APPROVE before the review stage completes")
            if review.get("context") != "fresh":
                defects.add("review.context must be 'fresh' (a separate reviewer with only the spec, the diff and the rules)")

    if index >= STAGES.index("test") or "test" in completed:
        test = state.get("test")
        if not isinstance(test, dict):
            defects.add("test evidence is required before the test stage completes")
        else:
            if not isinstance(test.get("command"), str) or not test.get("command"):
                defects.add("test.command must record the command that ran")
            if test.get("result") != "PASS":
                defects.add("test.result must be PASS before the test stage completes")

    return state, defects.items


def main(argv=None):
    parser = argparse.ArgumentParser(prog="spec-harness run-state")
    parser.add_argument("--check", metavar="TICKET", required=True, help="validate the run state of one ticket")
    parser.add_argument("target", nargs="?", default=".", help="target project root (default: current directory)")
    args = parser.parse_args(argv)
    target = os.path.realpath(args.target)
    if not os.path.isdir(target):
        print(f"run-state: target is not a directory: {args.target!r}", file=sys.stderr)
        return 2
    if not TICKET.fullmatch(args.check):
        print("run-state: ticket must be a slug of letters, digits, '.', '_' or '-' (max 64)", file=sys.stderr)
        return 2
    state, defects = check_state(target, args.check)
    if defects:
        print(f"run-state: {args.check}: INVALID")
        for item in defects:
            print(f"  defect: {item}")
        return 1
    print(f"run-state: {args.check}: VALID (stage {state['stage']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
