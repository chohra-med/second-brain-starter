# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.5.0 - 2026-10-18

### Added

- `sdd-router`, a read-only role on the fast tier's smallest model (`haiku` on Claude). `/sdd`
  dispatches it before the ticket is classified; it reads the ticket, the startup rules and file names (never source contents)
  and returns a `## Route` block: class, the tier for each stage, whether to ask Grill Me and the
  files to load first. The orchestrator may raise its class, never lower it. Low confidence, a
  malformed block or no separate context falls back to the orchestrator's own classification.
- Size picks the tiers: a table in `commands/sdd.md` that maps MICRO, LITE and FULL to the tier that
  plans, implements and accepts. A MICRO ticket's single verifier runs on the fast tier.

### Fixed

- First `/sdd init` could not pass `generate-agents --check`: a role row needs `status: "BOUND"`
  (packages and skills say `"READY"`), and nothing said so. `commands/generate-agents.md` now shows
  the role row's exact shape, and the check names which of status, path or `package_paths` is wrong.
- The first ticket after `/sdd init` failed its verifier on the uncommitted init output. Init now
  ends by asking the user to review and commit it. A MICRO ticket stops with a named PENDING on a
  dirty tree instead of failing later; LITE and FULL record every listed path in `input.md`, the baseline's and init's. A
  same-run `init`'s own paths are exempt, and a path already dirty before `init` ran is not.
- The `spec-harness-plan` skill said to apply Grill Me with no size limit, while `commands/sdd.md` says a
  MICRO ticket never asks it. The generated description now says Grill Me is for LITE and FULL only, and the body says a MICRO ticket gets none.

### Changed

- The fast tier's cell names the router's model after a semicolon, so any provider column can give
  the router a smaller model than the implementer.
- `AGENTS.md`: run the tests as a normal user; the permission fixtures fail under root.

## 0.4.0 - 2026-10-15

### Added

- `spec-harness finalize-init <target> [--dry-run|--apply|--recover] --evidence-dir <dir>`: a guarded
  refresh of the binding-only receipt and inventory. It is a dry run by default. `--apply` writes through
  a journal kept outside the target and rolls back on failure. `--recover` restores the prior bytes after a
  crash. Tests: `tests/finalize-fixtures.sh`.
- `spec-harness doctor <target>`: a read-only setup report covering the prerequisites, the platform and the
  structural and client fields. Tests: `tests/doctor-fixtures.sh`.
- Receipt schema version 3, with a `policy_sources` list and a `policy_coverage` ledger. Schema 1 and 2
  receipts still validate. Proposal: RFC 0003. Tests: `tests/synthesis-contract.sh`.
- `spec-harness status`, `update` (a plan, then `update <target> --apply DIGEST`) and `uninstall` (a plan
  only). Each install writes `.spec-harness/install.json`, which lists what it wrote. Tests:
  `tests/update-fixtures.sh`, `tests/installer-fixtures.sh`.
- Seven update states: `UNCHANGED`, `UPDATE`, `CUSTOMIZED-KEEP`, `MERGE`, `CONFLICT`, `NEW` and
  `REMOVED-UPSTREAM`. A conflict writes a `<file>.spec-harness-proposed` beside your file. Update never
  deletes a file. Tests: `tests/update-fixtures.sh`.
- A stale-synthesis marker, `.spec-harness/synthesis-stale.json`. An update that changes installed files
  after synthesis writes it. `generate-agents --check` refuses READY while it exists. The init procedure
  (`commands/init.md`, step 8) instructs the agent to remove it as the last write of its refresh; no code deletes it.
  Tests: `tests/update-fixtures.sh`, `tests/synthesis-contract.sh`.
- `spec-harness run-state --check <ticket>` validates `.spec-harness/runs/<ticket>/run-state.json`. The
  schema is in `docs/RUN-STATE.md`. Tests: `tests/run-state-fixtures.sh`.
- Six method owners, installed into each project: `ponytail`, `grill-me`, `package-finder`, `skill-finder`,
  `conventions` and `technology-profiles`. Tests: `tests/portable-skills-contract.sh`.
- A Grill Me checkpoint in the plan and SDD procedures. The plan stops for the owner's approval. The approval
  is recorded in the run state's `checkpoint` object, with the SHA-256 of the approved `plan.md`, and not in
  `plan.md` itself, because a file cannot contain its own hash. Procedures: `commands/plan.md`, `commands/sdd.md`.
- The `/sdd`-first rule. A code ticket is any change to a tracked file outside `specs/` and `.memory/`, and
  it goes through `/sdd` before the first source edit. The same sentence is in five source carriers and in
  the four files an install writes. Test: `tests/sdd-rule-carriers.sh`.
- `examples/react-ts-minimal`, a synthetic project with one unusual convention. `tests/examples-smoke.sh`
  runs `index` and `generate-agents --check` on a copy of it.
- RFC 0001 (neutral install route), RFC 0002 (learning statuses), RFC 0003 (receipt schema 3 and
  finalize-init) and RFC 0004 (install record, update, run state and the `/sdd`-first rule).
- A rule-coverage matrix over the complete diff in the reviewer agent. Missing evidence is recorded as
  `PENDING`, and a `PENDING` row never becomes a blocking finding by itself.
- `CONTRIBUTING.md`, a pull request template, and a CI workflow (`.github/workflows/test.yml`). CI runs the
  suite on Linux and macOS, with Python 3.11 and 3.13 and Node 22. Any skipped check fails the run.

### Changed

- Every `python3` call in `bin/` runs with `-I -B`, so a file in the working directory cannot shadow a
  standard module. Python 3.11 or later is checked before any Python program is parsed. Tests:
  `tests/python-isolation-fixtures.sh`.
- Receipts, inventories, journals, install records and run states are read through `bin/sh_safe_io.py`.
  It refuses symbolic links, FIFOs, devices, files over their size limit and JSON values that are not
  objects. Install records and base copies are written with no-follow at every path component. Tests:
  `tests/safe-read-fixtures.sh`.
- `finalize-init` records the receipt hash in its journal, limits recovery to the files in its write set,
  takes a lock file, and rolls back on SIGINT and SIGTERM. Exit 130 marks an interrupt that was rolled back.
- The inventory digest no longer includes the project folder name, so renaming the folder keeps the hash.
  Tests: `tests/index-fixtures.sh`, `tests/receipt-index-fixtures.sh`.
- The tests and CI no longer need `rg`. They use `grep`, and CI shadows `rg` so any use fails. CI runs
  `env -u TMPDIR npm test` on Linux. macOS runs `npm test`.

### Fixed

- Finalize lock and signals: a lock is removed only when the run created it. A rollback that cannot take
  the lock writes nothing. A failed rollback keeps the lock. A second SIGINT or SIGTERM during the rollback
  is ignored. Signal handlers are installed before the lock is taken. Tests: `tests/finalize-fixtures.sh`.
- Finalize rollback messages: an error the rollback does not name still rolls back during `--apply`. The
  interrupt and refusal messages name a partial rollback, the conflicting files and the original failure.
  Tests: `tests/finalize-fixtures.sh`.
- Finalize restore: a journaled file that this run never wrote is skipped. A failed success print after the
  commit no longer rolls the run back. Each tool step has a 600 second limit.
- `--recover` says whose lock it keeps and prints its own-lock message. Tests: `tests/finalize-fixtures.sh`.
- RFC 0003 and the finalize recovery steps in `docs/GETTING-STARTED.md` match the code.
- The install record is read and written through the safe IO module, so a planted `install.json.tmp` link
  is refused. Tests: `tests/installer-fixtures.sh`.
- A `git merge-file` failure (exit status above 127) refuses the plan. It is no longer counted as conflicts.
  Tests: `tests/update-fixtures.sh`.
- The stale marker is written before the first file write, never without a receipt, and is cleared only by
  init. Tests: `tests/update-fixtures.sh`.
- A write refused by the operating system, for example in a read-only folder, is not a traceback. Update
  prints a named `PENDING:` refusal. Install's install-record step prints a named `install record: cannot write`
  message. A failed staging write in install prints `cannot create <path>; target may be partially staged.` for a
  folder or `copy failed for <path>; target may be partially staged.` for a file, and exits 1. Tests: `tests/update-fixtures.sh`, `tests/installer-fixtures.sh`.
- A file that was yours before install is never adopted, flipped to managed, or re-created by update.
  Tests: `tests/update-fixtures.sh`, `tests/installer-fixtures.sh`.
- The uninstall steps live in the README `## Uninstall` section. The Undo section covers `.spec-harness/`,
  and the "no uninstall" statements are removed.
- Every test `python3` run carries `-I -B`, and `tests/python-isolation-fixtures.sh` fails on a run without
  them.
- CI pins Node 22 and prints the tool versions. `AGENTS.md` states that CI runs `npm test` on pull requests
  and on main.
- Generated skills and the context map contain no em dashes.
- The `generate-agents` work order names only the files the shipped set contains.
- The index keeps over-cap sources out of its representative list, and the Codex client directory is
  spelled `.agents/`.
- The README and `docs/GETTING-STARTED.md` describe security, network use, sampling, the manifest and the
  citation check as the code does them.
- `/sdd` wording: the duplicate Quickstart paragraph in the README is removed. `commands/sdd.md` states
  that schemas 1 and 2 keep their meaning and that schema 3 adds the ledger. The `/sdd`-first sentence is in
  the step-3 block of `docs/GETTING-STARTED.md`.
- The safe-read tests check that `O_NOFOLLOW` is present on both the file open and the directory open. A
  test captures the tar listing before it greps the listing, so GNU tar cannot fail it with SIGPIPE.

### Behaviour changes

- An unnamed exception during `--apply` now rolls back every write. If the rollback finds a conflict, the
  run prints the conflicting files instead.
- A stale finalize lock held by another live program stays until that program exits. The refusal tells you
  to wait. Run `--recover` only after the other program has gone.
- An interrupt that arrives while the Python interpreter is exiting can exit 0 and keep the completed run.
  RFC 0003 section 3 describes this window.
- A user-owned file that you deleted locally is not re-created by `update`.

### Platform support

- macOS and Linux are supported. Native Windows is not. WSL2 works like Linux, and `doctor` says so.

### Security

- Generated rules and third-party skills are data. The skill-finder procedure (`commands/skill-finder.md`) runs
  `npx skills find` only when that discovery route is available, and says discovery never installs a skill.
  No code enforces either rule. They are procedure text, as the README's Security section says.

## 0.3.0

- Earlier release. See the git history for its changes.
