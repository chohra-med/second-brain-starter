# Ticket run state

A ticket run can stop and resume. Its state lives at:

```
<target>/.spec-harness/runs/<ticket>/run-state.json
```

`spec-harness run-state --check <ticket> [target]` validates that file. It prints `VALID` with the
current stage, or `INVALID` with one line per defect. It exits 0 when the state is valid, 1 when it is
not, and 2 for a bad target or ticket argument. It changes nothing.

The checker reads the file through the bounded safe reader (`bin/sh_safe_io.py`). A symlink, a FIFO,
a device, a file over 256 KiB, or a JSON value that is not an object fails closed.

## Shape (schema version 1)

```json
{
  "format": "spec-harness-run-state",
  "schema_version": 1,
  "ticket": "PROJ-7",
  "stage": "test",
  "completed": ["spec", "plan", "checkpoint", "implement", "review"],
  "spec_path": "docs/specs/PROJ-7.md",
  "plan_path": "docs/plans/PROJ-7.md",
  "checkpoint": {
    "approved_by": "a named reviewer",
    "approved_at": "2026-10-14T09:00:00Z",
    "plan_sha256": "<64 lowercase hex digits of the plan file>"
  },
  "review": { "verdict": "APPROVE", "context": "fresh" },
  "test": { "command": "npm test", "result": "PASS" }
}
```

Only these top-level keys are allowed: `format`, `schema_version`, `ticket`, `stage`, `completed`,
`spec_path`, `plan_path`, `checkpoint`, `review`, `test`.

## Stages

The stages run in this order and cannot be skipped:

`spec` → `plan` → `checkpoint` → `implement` → `review` → `test` → `summary`

- `stage` is the stage the run has reached. `completed` must list every earlier stage, in order.
- `spec_path` is required from the spec stage on. `plan_path` is required from the plan stage on.
- `checkpoint` is required before implementation. Its `plan_sha256` must match the plan file on disk.
  A plan that changes after approval makes the state invalid, so the approval has to be taken again.
  The approval is recorded only here, never inside `plan.md`: a file cannot contain its own hash, so
  `plan.md` carries no approval record and its bytes stay the bytes that were approved.
- `review` is required before the review stage completes. The verdict must be `APPROVE`, and the
  context must be `fresh`: a separate reviewer that received only the spec, the diff and the rules.
- `test` is required before the test stage completes. `result` must be `PASS`, and `command` records the
  command that ran.

## Paths

`spec_path` and `plan_path` are relative to the target. A value that is absolute, contains a backslash, or
has a `..` segment is refused. A name such as `a..b.md` is not a `..` segment and is allowed. The checker
checks each path whenever its key is present, at any stage; the stage rules above say which stage requires it.

## Status

Schema version 1 is the only version. This is a method-level record. It does not yet schedule runs,
and no command writes this file automatically.
