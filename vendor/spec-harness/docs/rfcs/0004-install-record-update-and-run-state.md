# RFC 0004: install record, update states, stale marker and uninstall plan

Status: Accepted. Implemented in 0.4.0 (parts 1 and 2).

## Problem

Before 0.4.0 an install copied files and kept no list of what it wrote. `update` could not tell a harness
file from an edit made after install, and nothing could say what to remove. The docs named the branch as
the only undo. Once `status`, `update` and `uninstall` existed, the words they print (the seven update
states, the synthesis stale marker, the record format) became promises that a user or a reviewer relies on.
None of them had a written record outside the code.

This RFC records what the code does. It proposes nothing new. Every fact cites `file:line` in `bin/` at the
commit that adds this RFC. If those files change, the line numbers move and this record must move with them.

## 1. Install record

The record is `.spec-harness/install.json` (`bin/sh-update.py:39`; the state directory is `STATE_DIR` at
`bin/sh-install.sh:111`). The installer writes it in the `PYRECORD` block (`bin/sh-install.sh:338-387`) after
staging the files. A fresh record is created with these fields (`bin/sh-install.sh:356-357`):

| Field | Value | Source |
|---|---|---|
| `format` | `spec-harness-install-record` (the reader refuses any other value) | `bin/sh-install.sh:356`; `bin/sh-update.py:84-85` |
| `schema_version` | `1` | `bin/sh-install.sh:356` |
| `harness_version` | the `version` of the checkout's `package.json` | `bin/sh-install.sh:335`, `:356` |
| `harness_commit` | the checkout's `git rev-parse HEAD`, or `null` when the checkout is not a git repository | `bin/sh-install.sh:331-334`, `:357` |
| `project_name` | the name given at install | `bin/sh-install.sh:357` |
| `harness_commit_dirty` | `true` only when an update ran from a checkout with local changes; removed on a clean update | `bin/sh-update.py:302-304` |
| `files` | map from target path to `{"managed": bool}` plus `"sha256"` when managed | `bin/sh-install.sh:364-374` |

Each entry in `files` is one of three kinds (`bin/sh-install.sh:325-329`, `:363-371`):

- **managed, `sha256` set**: a file the installer added, or a file that already existed and was byte-identical
  to the harness file. `sha256` is the hash of the harness bytes.
- **unmanaged, `{"managed": false}`**: a file that already existed and differed from the harness file (a
  CONFLICT at install time). It belongs to the user and is never updated or removed by the harness.
- A rerun adds only the paths the record does not yet list (`bin/sh-install.sh:364-365`); it never rewrites
  an existing entry.

**Base copies.** For every managed file the installer writes the pristine harness bytes to
`.spec-harness/base/<path>` (`bin/sh-install.sh:373`). `update` writes a base copy for every file it writes
(`bin/sh-update.py:297`). The base copy is the three-way merge ancestor (section 3, MERGE). A merged file
therefore still differs from its base copy, so the next update still sees it as edited.

**No record.** If `python3` is missing, the installer writes no record and says so
(`bin/sh-install.sh:390`). An install from before 0.4.0 has no record. `status` says it is unknown. `update` keeps every
differing file as `CUSTOMIZED-KEEP` (`bin/sh-update.py:225`) and adopts the files already byte-identical to
the harness (`UNCHANGED`, section 3), which gives the target a record.

The reader refuses a record that is a link, a FIFO, oversized, not a JSON object, not this format, or has an
unsafe path key (`bin/sh-update.py:77-85`).

## 2. Update: plan, then apply exactly the plan

`spec-harness update <target>` prints a plan and does not write (`bin/sh-update.py:239-258`). The plan has one
line per file, a summary, and a `PLAN DIGEST`. `spec-harness update <target> --apply <digest>` writes the plan
only when the digest equals the digest of the plan computed now; otherwise it refuses and writes nothing
(`bin/sh-update.py:395-396`). The digest covers each path, its state and the hashes involved (`build_plan`,
`bin/sh-update.py:176`).

The harness file set is rendered by the installer itself into an empty temporary directory
(`render_plan`, `bin/sh-update.py:103`). The plan is computed from that rendering.

## 3. The seven update states

COMPLETE: the planner assigns exactly these seven state words, and no others (`state="`, `["state"] =` and
`row["state"] =` in `bin/sh-update.py` return these seven and nothing else).

| State | When it happens (planner line) | What `--apply` does |
|---|---|---|
| `UNCHANGED` | the target already holds the current harness bytes (`bin/sh-update.py:206-207`); or a synthesis output already equals its rendered bytes (`:196`) | nothing; an unowned file with no record entry is adopted: base copy and record entry written (`:291-292`, `:297-298`). A record entry marked not managed is never adopted (`:291`) |
| `UPDATE` | managed, and the target bytes still equal the recorded `sha256`, so the file was not edited; the template changed (`:209`) | writes the new harness bytes, then the base copy and record entry (`:282`, `:297-298`) |
| `CUSTOMIZED-KEEP` | several cases, all kept as they are: a synthesis output that differs from its rendering (`:196`); a managed file deleted locally, not restored (`:201`); a file that was yours before install, deleted locally, not restored (`:203`); edited locally while the template did not change, so base equals the new bytes (`:213`); no install record, so a local edit cannot be told from an older template (`:225`); a file that was there before install and is not managed (`:227`) | nothing |
| `MERGE` | managed, edited locally, and the template changed with no overlap: `git merge-file` against the stored base copy returns a clean result (`:220`) | writes the merged bytes, then the base copy (`:285`, `:297`) |
| `CONFLICT` | the three-way merge overlaps (`:217-218`), or there is no valid base copy to merge with (`:222-223`) | writes `<file>.spec-harness-proposed` (`PROPOSED`, `:42`) and leaves the file alone (`:287-290`) |
| `NEW` | not in the record and absent on disk (`:205`) | writes the file, then the base copy and record entry (`:282`, `:297-298`) |
| `REMOVED-UPSTREAM` | in the record as managed, and no longer rendered by the harness (`:229-233`) | nothing; listed only |

**Updates never delete a file.** The planner and the apply step remove no target file. The only `rmtree` calls
in `bin/sh-update.py` delete the script's own temporary directories (`:109`, `:117`, `:173`). A renamed file is
listed as `REMOVED-UPSTREAM` (its note says "renamed to ...") and its replacement as `NEW`.

**Renames.** `install-migrations.tsv` is read by `load_migrations` (`bin/sh-update.py:121`). Each non-comment
line is three tab-separated fields: the old target path, the new target path, and the harness version that
renamed it. Blank lines and lines starting with `#` are skipped; a malformed row refuses the plan. The rows only
label the notes; they cause no deletion.

**CONFLICT file.** `<file>.spec-harness-proposed` sits beside the user's file and holds the proposal. The user
resolves it by hand. The apply output names each one (`bin/sh-update.py:309-310`, the `CONFLICT: resolve ...`
line).

**Errors while writing.** Every write in apply goes through `write_or_refuse` (`bin/sh-update.py:59-64`). An OS
error, such as a read-only directory, becomes a refusal that names the path. It is printed as a `PENDING:` line
on stderr with exit 1 (`bin/sh-update.py:403-405`). Writes that already happened are not rolled back; the
stale marker (section 4) is left in place.

## 4. The synthesis stale marker

Synthesis outputs are the rules, skills, role bindings and receipt that `init` writes. The receipt is
`.claude/agents/.init-synthesis.json` (`bin/sh-update.py:41`). `update` never writes a synthesis output: a
synthesis output is `UNCHANGED` or `CUSTOMIZED-KEEP` (section 3). But a harness update can change installed
files that the synthesis read, so the receipt can go stale. The marker records that.

- **Path and format.** `.spec-harness/synthesis-stale.json` (`bin/sh-update.py:40`), with `format`
  `spec-harness-synthesis-stale`, `schema_version` 1, `reason`, `harness_version`, `receipt_sha256` and `paths`
  (`bin/sh-update.py:261-265`).
- **When it is written.** Only when the receipt exists and the plan has at least one `UPDATE`, `NEW` or `MERGE`
  (`bin/sh-update.py:275`). With no receipt there is nothing to mark. A `CONFLICT` alone does not mark.
- **Before the first write.** The marker is written before any file, and lists every `UPDATE`, `NEW` and `MERGE` path of the plan
  (`bin/sh-update.py:276-277`). After every write succeeds it is rewritten with the paths actually written
  (`bin/sh-update.py:306-307`). A failure partway through therefore leaves a marker that lists the planned
  paths, so a later check cannot pass over a file that changed. The fixture is `tests/update-fixtures.sh`
  section 11.
- **What it blocks.** `generate-agents --check` refuses READY while the marker path exists, whatever the receipt
  bytes (`bin/sh-gen-agents.sh:446-447`). A link or an unreadable marker counts as present.
- **Who removes it.** Only the init procedure, as the last write of its guarded refresh. This is an instruction,
  not code: the check does not delete the marker, and no harness command does. The instruction is in
  `commands/init.md` (step 8) and in the native work order that `bin/sh-gen-agents.sh` writes (its work order
  text, `bin/sh-gen-agents.sh:506`).
- **What it shows.** `status` prints the marker line while the file exists (`bin/sh-update.py:336-337`).

## 5. Status

`spec-harness status <target>` writes nothing to the target (`bin/sh-update.py:316-341`). It prints the
installed version and commit from the record, or `unknown` with a note that the install predates 0.4.0; the
source version and commit; one count per state; the marker line when present; and `update available: yes` when
the plan has an actionable state (`UPDATE`, `MERGE`, `NEW`, `CONFLICT`) or a `REMOVED-UPSTREAM` row.

## 6. Uninstall: plan only

`spec-harness uninstall <target>` prints a plan and deletes nothing (`bin/sh-update.py:344-371`). It reads the
record and lists, from the record only:

1. `UNCHANGED since install (safe to delete)`: managed files whose bytes still equal the recorded `sha256`.
2. `EDITED since install (review before deleting)`: managed files whose bytes differ.
3. `ALREADY GONE`: managed files not on disk.
4. `YOURS before install (never delete)`: unmanaged entries.

It then names the state directory `.spec-harness/` for removal, and notes that synthesis outputs are listed by
the receipt, not by the record (`bin/sh-update.py:369-370`).

It refuses, with exit 1 and a `PENDING:` line, when the record is absent: the install predates 0.4.0, so the
list cannot be exact (`bin/sh-update.py:346-347`). It refuses a target that is the harness checkout itself
(`bin/sh-update.py:386`).

The branch the user created before install is the undo for the rest (see the Undo section of
`docs/GETTING-STARTED.md`). The uninstall steps are owned by the README's `## Uninstall` section.

## 7. Routes and words

This RFC covers the `update`, `status` and `uninstall` routes and the seven state words. Changing any of them
starts a new RFC (`CONTRIBUTING.md`, "Proposals"). The receipt schema is RFC 0003.

## Part 2: run state, the Grill Me checkpoint and the /sdd-first rule

Part 2 records the workflow routes that the run-state method added. Like part 1, it proposes nothing new.
Each fact is taken from the code or the document named beside it. A line number appears only where the
line was read for this part; elsewhere the function or heading is named, because line numbers move.

## 8. Run state

- **Location and command.** The state is `.spec-harness/runs/<ticket>/run-state.json` under the target. The
  dispatcher `bin/spec-harness` runs `bin/sh-run-state.py` with `python3 -I -B` for `run-state`. The
  command is `spec-harness run-state --check <ticket> [target]`.
- **Exit codes.** `main()` in `bin/sh-run-state.py` returns 2 when the target is not a directory
  (`bin/sh-run-state.py:151`) or the ticket is not a slug (`:154`). It returns 1 when `check_state()` reports
  any defect, and 0 when the state is valid (`:160`, `:162`). A missing state file is a defect, so it exits 1.
- **Reading.** The file is read through `load_json_object` and `read_bounded` in `bin/sh_safe_io.py`, with a
  256 KiB limit (`MAX_STATE_BYTES`). A symbolic link, a FIFO, a device, an oversized file or a JSON value
  that is not an object is refused.
- **Shape.** The only top-level keys are the ten in `TOP_KEYS`: `format`, `schema_version`, `ticket`, `stage`,
  `completed`, `spec_path`, `plan_path`, `checkpoint`, `review` and `test`. An unknown key is a defect. The
  format is `spec-harness-run-state` at schema version 1.
- **Stage order.** The stages are `spec`, `plan`, `checkpoint`, `implement`, `review`, `test` and `summary`
  (`STAGES`, `bin/sh-run-state.py:22`). `completed` must list every earlier stage in order. A state that
  reaches a stage without completing an earlier one is a defect that names the missing stage.
- **Plan approval.** From the checkpoint stage on, `checkpoint` needs `approved_by`, `approved_at` and
  `plan_sha256`. The digest must equal the SHA-256 of the plan file on disk, so a plan that changes after
  approval makes the state invalid until the approval is taken again.
- **Evidence.** From the review stage on, `review.verdict` must be `APPROVE` and `review.context` must be
  `fresh`. From the test stage on, `test.result` must be `PASS` and `test.command` must name the command that
  ran.
- **Who writes it.** No harness command writes the file. The run writes it when each stage completes, as
  `commands/sdd.md` section "Resumable run state" directs (`commands/sdd.md:286-293`). The checker only reads
  it. It repairs nothing.
- **Tests.** `tests/run-state-fixtures.sh`.

## 9. Grill Me checkpoint

- **The stop.** The plan stops before implementation so that the owner can answer. `commands/plan.md`,
  section "Grill Me checkpoint and grounded conventions", step 2, requires the material decision frontier
  with a recommended answer for each question. It then waits for approval (`commands/plan.md:42`).
- **The record.** The approval is recorded in the run state's `checkpoint` object, with the approver, the time
  and the SHA-256 of the approved `plan.md` bytes (`plan_sha256`). It is not recorded in `plan.md`: a file cannot
  contain its own hash, so the record lives outside the bytes it approves (`commands/plan.md`, step 2 of the Grill
  Me checkpoint section). An edit after approval needs a new approval. With no approval the ticket stays PENDING
  at this checkpoint.
- **Which tickets stop.** LITE and FULL tickets stop here (`commands/sdd.md:184-188`). A MICRO ticket does not
  require Grill Me or Ponytail receipts (`commands/sdd.md:167`).
- **The run-state checkpoint.** The `checkpoint` object in the run state is the only place the approval is
  recorded. `check_state()` compares its digest with the plan file on disk. No command checks that a person
  approved. The approval is a procedure that the run follows.
- **Conventions.** Before a plan relies on a convention, it labels the convention `EXPLICIT`, `OBSERVED`,
  `ADOPTED BASELINE` or `PROPOSED`, and it names the source. A `PROPOSED` convention is not applied as project
  policy (`commands/plan.md`, step 1 of the same section).
- **Tests.** The checkpoint text is a procedure, so no test reads it. The digest check is covered by
  `tests/run-state-fixtures.sh`.

## 10. The six method owners

Each project receives six method owners under `.claude/commands/spec-harness/`: `ponytail`, `grill-me`,
`package-finder`, `skill-finder`, `conventions` and `technology-profiles`. Their `.claude/commands/spec-harness/`
copies come from the commands loop in `bin/sh-install.sh` (the `for source in "$SYS_DIR"/commands/*.md` loop, which
copies every command file except `sdd.md`). A separate loop over the six names in `bin/sh-install.sh` (the
`for method in` loop over `ponytail`, `grill-me` and the rest) writes their `.agents/skills/spec-harness-<method>/SKILL.md`
files, not `.claude/` files. `commands/sdd.md:34` names the same six. Tests: `tests/portable-skills-contract.sh`.

## 11. The /sdd-first rule

**The definition.** The rule is one sentence block, identical in every carrier:

> A code ticket is any change to a tracked file outside `specs/` and `.memory/`. It goes through `/sdd` before the first source edit, even when it looks small: the light route is still `/sdd`. Keep the ticket's code inside this repository: no worktree, clone or copy elsewhere unless the user asks for one.

**The carriers.** `tests/sdd-rule-carriers.sh` checks that this block is a substring of one line in each of
these source files: `templates/CLAUDE.md`, `templates/AGENTS.md`, `templates/install/SPEC-HARNESS.md`,
`skills/spec-harness/SKILL.md` (generated from the `emit` text in `bin/sh-make-skills.sh`) and
`docs/GETTING-STARTED.md` (the step-3 block that users paste into an existing instruction file). It checks the
same block in the four files an install writes into a target: `CLAUDE.md`, `AGENTS.md`, `SPEC-HARNESS.md` and
`.claude/skills/spec-harness/SKILL.md`. A carrier that drops the sentence fails the test by name.

**Not in 0.4.0: runtime enforcement of the rule.** The rule is prose that agents load, plus the presence check
above. A runtime check, such as `doctor` or `run-state` flagging source edits that have no packet, is deferred.
The reasons, recorded in the 0.4.0 planning record: such a check would run after the edit it is meant to
prevent; nothing calls `doctor` during a ticket; and git-state heuristics misfire on edits that are not
tickets.

## 12. Routes and words

Part 2 adds these public words: the `run-state --check` results `VALID` and `INVALID`; the Grill Me checkpoint
record and its `PENDING` state; the six method names; and the `/sdd`-first sentence. Changing any of them starts
a new RFC (`CONTRIBUTING.md`, "Proposals"). The run-state schema is version 1 and is described in
`docs/RUN-STATE.md`.
