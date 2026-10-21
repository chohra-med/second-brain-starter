# RFC 0005: PR preparation checklist and packet check

Status: proposal, implemented on this branch for review.

## Problem

Rules about pull request text, evidence and pushes lived in several places (instructions, memory,
decisions, skills). None was read at the moment the action happened, so a PR body could ship without
the project's real test names, with separate screenshots or a video, or with a claim the evidence did
not show. The merger role checked the gates but not the PR packet.

## Proposal

- `commands/pr-prepare.md`: one ordered checklist, from pending PRs to the report. Procedure only; it
  grants no permission to commit, push, open, edit or merge. A project's own PR rules win where they
  differ, and the report names the difference.
- `bin/sh-pr-packet.py`, run as `spec-harness pr-packet`: a read-only structural check of a saved PR
  body. It checks the Summary and Evidence sections, exactly one combined Before/After image, no video,
  no local path, no placeholder, at most three Merge Danger bullets, and that every real test name is in
  the text. Test names come from a file or from `git diff BASE...HEAD` of the branch's test files. It
  reports claims and the Before source as UNVERIFIED, because a script cannot prove them.
- `agents/sdd-merger.md`: a PR packet gate. A merge needs a passing packet check on the exact head, a
  finished passing pipeline on that head, and every dependent PR updated or listed as PENDING.
- `commands/ship.md`: a check that cannot run locally may be left to CI only by a recorded project
  decision, and it is reported as `left to CI`, not as passed.
- `commands/learn.md`: a lesson that conflicts with an adopted rule becomes a narrow, dated `EXPLICIT`
  carve-out only after the review authority decides for it.

## Compatibility

- New command and new CLI subcommand; no existing route, receipt or status word changes.
- `commands/pr-prepare.md` is staged with the other commands. No generated skill is added, as for `ship`.
- The evidence rules (one combined image, no video) are defaults. A project that wants different
  evidence records that in its PR rules, which win.

## Tests

`tests/pr-packet-fixtures.sh`: a complete body passes; each broken property fails with the check named;
test names are collected from a branch diff; the CLI routes exist; the merger carries the gate. Red
first: disabling the video check makes the suite fail.
