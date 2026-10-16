# Getting started: adopt Spec Harness in an existing project

This is the step-by-step route for a real codebase, including a large app that already has its own
`CLAUDE.md`, `AGENTS.md` and `.claude/` directory. It takes about half an hour, most of it reading
what the initialiser wrote; allow longer on a large app.

## The words used here

| Word | Meaning |
|---|---|
| **SDD** | Spec-driven development: write what "done" means, then build against it. |
| **Ticket** | The text of one piece of work, pasted in full. A title alone is not a ticket. |
| **Role** | One agent file with one job: planner, implementer, tester, verifier, reviewer, merger, learner. |
| **Tier** | The class of model a role asks for: `strong`, `fast` or `review`. Never a model name. |
| **Fresh context** | A new agent that has not seen the implementation conversation. |
| **PENDING** | Files are staged, but a model or a reviewer has not done its part yet. Not an error. |
| **READY** | The structural check passes and a separate reviewer accepted the generated rules. |
| **Receipt** | `.claude/agents/.init-synthesis.json`: what initialisation produced and from which source lines. |

## What you need

| Tool | Needed for |
|---|---|
| `git`, `bash` 3.2 or newer | everything |
| Python 3.11 or newer | `index`, `doctor`, `finalize-init` and `generate-agents` (the structural check is `generate-agents --check`) |
| Node.js | only the `npx` route; a checkout needs none |
| Claude Code, or Codex | the model-led steps (`/sdd init`, `/sdd <ticket>`) |

The harness adds no dependency to your application and never edits application source during
install or initialisation.

## Get the CLI: two routes

The CLI only copies files and runs checks. Pick one route and use it for every `spec-harness`
command in the steps below.

### Route A: `npx`, nothing to install

```sh
npx -y github:chohra-med/spec-harness-oss help
```

`npx` downloads the repository from GitHub each time and runs it. Good for a first try. To make
every run use the same version, pin a commit. Replace `1777c79` with the commit you want, from
the repository's commit list on GitHub:

```sh
npx -y "github:chohra-med/spec-harness-oss#1777c79" help
```

### Route B: `git clone`, a local checkout

Use this when you want to read the source first, work offline, pin a version for a team, or when
`npx` from GitHub is blocked on your network. It needs no Node.js.

1. **Clone it outside your project.** The checkout is a tool, not part of your application.

   ```sh
   mkdir -p ~/tools
   git clone https://github.com/chohra-med/spec-harness-oss.git ~/tools/spec-harness-oss
   ```

2. **Check what you got.**

   ```sh
   cd ~/tools/spec-harness-oss
   git log --oneline -1          # the version you are about to use
   bash bin/spec-harness help    # prints the command list
   python3 --version             # 3.11 or newer
   ```

3. **Put the CLI on your `PATH`.** For the current terminal only:

   ```sh
   export PATH="$HOME/tools/spec-harness-oss/bin:$PATH"
   spec-harness help
   ```

   To keep it, add that `export` line to `~/.zshrc` (or `~/.bashrc`) and open a new terminal.
   If you would rather not change `PATH`, call it by its full path instead:
   `bash ~/tools/spec-harness-oss/bin/spec-harness help`.

4. **Optional: run its own tests** before trusting it.

   ```sh
   cd ~/tools/spec-harness-oss
   for t in tests/*.sh; do bash "$t" >/dev/null 2>&1; echo "exit $? $t"; done
   ```

   Every line should say `exit 0`.

5. **Update later** with `git -C ~/tools/spec-harness-oss pull`. To stay on one version, check out
   a commit: `git -C ~/tools/spec-harness-oss checkout <commit>`. A pinned checkout no longer follows
   updates; run `git -C ~/tools/spec-harness-oss checkout main` before the next `pull`. Updating the checkout does not
   change a project you already staged; re-running `init` there only adds files that are missing.

With route B, every command below that starts with
`npx -y github:chohra-med/spec-harness-oss` becomes `spec-harness`:

| Step | Route A | Route B |
|---|---|---|
| 2. Stage | `npx -y github:chohra-med/spec-harness-oss init . integrate` | `spec-harness init . integrate` |
| 4. Inventory | `npx -y github:chohra-med/spec-harness-oss index .` | `spec-harness index .` |
| 5. Check | `npx -y github:chohra-med/spec-harness-oss generate-agents --check .` | `spec-harness generate-agents --check .` |

**Let an agent do it.** With a checkout on your machine, open your project in Claude Code or Codex
and say: "Read `~/tools/spec-harness-oss/AGENTS.md` and add Spec Harness to this project." That file
walks the agent through these same steps and tells it what it must not touch.

The files staged into your project are the same on both routes. Inside Claude Code, `/sdd init`
runs `spec-harness` when it is on your `PATH` and falls back to the `npx` form when it is not.

## Step by step

### 1. Start on a branch

```sh
cd /path/to/your-project
git switch -c chore/spec-harness
git status   # commit or stash first: a clean tree makes the next diff readable
```

`spec-harness uninstall <target>` prints what the install record says was written and deletes
nothing. The branch is your undo: delete it, or see [Undo](#undo). The uninstall steps are in the
README's `## Uninstall` section.

### 2. Stage the harness

```sh
npx -y github:chohra-med/spec-harness-oss init . integrate   # route A
spec-harness init . integrate                                # route B, from your project root
```

Run one of the two, from the root of your project (not from the harness checkout). `integrate` is for an existing project, `new` for an empty one, and leaving the mode out picks for
you. The command only copies files. It prints a status and four lists:

| List | Meaning |
|---|---|
| `ADDED` | New files, one per entry in `install-manifest.json` on a project that had none of them. |
| `PRESERVED` | Your files that already existed. They are never overwritten. |
| `CONFLICTS` | Preserved files whose content differs from the harness version. Yours was kept. |
| `PENDING` | What still needs a model: rules, roles and skills. |
| `status : PENDING` | Expected. Nothing has read your code yet. |

Running it a second time is safe: it adds nothing and changes nothing.

**Read `learning_human.html` now.** It was just copied to your project root. Open it in a browser:
it is a ten-minute interactive tour of how the harness works, and it makes the next steps obvious.
The agent opens it for you when you run `/sdd init`. You can delete it afterwards.

`install-manifest.json` at the repository root records the staged set (the installer's own code still decides what is staged, and the test below keeps the two in step): every destination, its source file, the two substitutions, the directories and the loader block below. `tests/install-manifest-contract.sh` installs into an empty git repository and checks that the files created match the manifest exactly, byte for byte.

What lands in the repository:

| Path | What it is |
|---|---|
| `.claude/commands/sdd.md`, `.claude/commands/spec-harness/` | the procedures |
| `.claude/agents/sdd-*.md` | the thirteen roles, next to any agents you already have |
| `.claude/skills/spec-harness*`, `.agents/skills/` | skill entry points for Claude Code and Codex |
| `.memory/` | the project memory bank |
| `ai_rules/`, `RULES.md`, `AGENTS.md`, `CLAUDE.md`, `constitution.md` | rules, only where you had none |
| `specs/`, `workflows/`, `learning/`, `SPEC-HARNESS.md`, `goal.md` | ticket packets, critical journeys, lessons, status |
| `learning_human.html` | the interactive explainer for people; delete it once read |
| `loop.sh` | a legacy placeholder; you can delete it |

### 3. Existing instruction files

If `CONFLICTS` lists `CLAUDE.md` or `AGENTS.md`, your own file was kept and it does not mention
the harness yet, so your client will not load the harness rules. Add this block to your
`CLAUDE.md` (and to `AGENTS.md` if Codex or another client reads that one):

```markdown
## Spec Harness

- Setup status: `SPEC-HARNESS.md`. Keep PENDING items PENDING until they are checked.
- Before code edits read `ai_rules/rules/frequent_rules.md`, `.memory/40-active.md` and the nearest `RULES.md`.
- Feature work goes through `/sdd <ticket text>`. The procedure is `.claude/commands/sdd.md`.
- A code ticket is any change to a tracked file outside `specs/` and `.memory/`. It goes through `/sdd` before the first source edit, even when it looks small: the light route is still `/sdd`. Keep the ticket's code inside this repository: no worktree, clone or copy elsewhere unless the user asks for one.
- A task is done when a fresh verifier returns PASS against the ticket's own goal, not when tests pass.
- Rules change only through `.claude/commands/spec-harness/learn.md`, after review.
```

Your existing rules stay the authority. Where they already name protected paths, a merge policy or
a startup sequence, the initialiser reads and preserves them.

### 4. Inventory the code

```sh
npx -y github:chohra-med/spec-harness-oss index .
```

This writes the inventory: package boundaries, manifests and a small sample of representative source
files per package. It reads `package.json` and `pyproject.toml`. Native iOS and Android folders are not
packages of their own; `Pods`, `DerivedData` and `build` are skipped.

The file it writes depends on what is already in `ai_rules/`:

- No `ai_rules/context_map.md`, or one the harness generated earlier: `index` writes `ai_rules/context_map.md`.
- Your own `ai_rules/context_map.md`, meaning any file the harness did not generate (a symlink or other non-file counts too): `index` leaves it as it is and writes `ai_rules/project_inventory.json` instead.

The line `index` prints as `Wrote:` names the file it wrote.

On a large app the default sample may miss the files that show how the app is really written.
Choose up to five yourself, five in total across the repository, and pass the same flags every time you re-index:

```sh
npx -y github:chohra-med/spec-harness-oss index . \
  --source src/store/api/baseApi.ts \
  --source src/navigation/RootNavigator.tsx \
  --source src/components/Button.tsx
```

### 5. Initialise

Open the project in Claude Code and run:

```text
/sdd init
```

Use your strongest model for this step. It reads your instruction files (such as `AGENTS.md`, `RULES.md`,
`CONTRIBUTING.md`, `ai_rules/`, `.memory/`, `.cursor/rules/`, `.agents/`), your `README.md`, the project structure, package
manifests and lockfiles, relevant tests and configuration, the source sample that `index` recorded, the first-party source
the procedure opens, and project-local installed skills, then writes:

| Output | Where |
|---|---|
| Source-backed rules, each citing a file and line | `RULES.md`, `ai_rules/rules/frequent_rules.md` |
| Five core skills on a first initialisation: architecture, performance, packages, quality, conduct (an existing schema-1 receipt keeps its three) | `.claude/skills/spec-harness-*/SKILL.md` |
| One skill per major technology the code really uses, at most five | `.claude/skills/spec-harness-tech-<technology>/SKILL.md` |
| Project rules inside each role | the `GEN:rules` block of `.claude/agents/sdd-*.md` |
| The receipt | `.claude/agents/.init-synthesis.json` |

"Client" here means the coding agent you run it in (Claude Code, or Codex). The client sends what it reads to the model
provider it uses. Read your client's data terms before you run these steps on private code.

The source sample is capped. A package with no `--source` path gets up to five files by default. A `--source` path applies to the package it names; other packages still get the default. The `--source` list is capped at five paths in total. Every sampled file is capped at 128 KiB, the whole sample at 2 MiB, and each instruction file at 256 KiB. A source or instruction file over its cap is left out and recorded as excluded, except a generated output the receipt registers, where `index` stops with a PENDING message and exit 1; a `--source` file over 128 KiB also stops `index` with exit 1. A manifest over 256 KiB is recorded as unreadable and listed under excluded paths. A manifest in any format other than `package.json` and `pyproject.toml` (such as `go.mod`, `Cargo.toml` or `pom.xml`) is marked unsupported at any size, because `index` does not parse that format, so the project cannot pass this check as a real fix until a later release of index reads that format, then re-run index. This is a known limit. After initialisation, `generate-agents --check` fails with a message containing "unsupported or unreadable manifest" until the manifest clears it. The check clears in four ways once index has run again: the manifest is made smaller (for size only), it is moved outside the project folder, it is moved into a directory that is skipped by name (such as `node_modules`, `build`, `dist`, `vendor`, `target` or `coverage`), or it is repaired so that it parses. The skipped-directory move clears the check without the file being read, so it is not a fix. A malformed package.json or pyproject.toml is marked unsupported, or unreadable when it is over 256 KiB. `--check` does not run `index`, so after any change run `index` again, then refresh the synthesis outputs (the generated rule, skill and role files the receipt lists). For the default Markdown context map, which `finalize-init` refuses to refresh, re-run init for a Markdown context map. The init procedure may open more first-party source than the sample (`commands/init.md:18`). The code cannot enforce a bound on that reading, so check the source each rule cites in step 9.

It then runs the structural check:

```sh
npx -y github:chohra-med/spec-harness-oss generate-agents --check .
```

`READY: ...` means the receipt, hashes and citations are consistent. It does not mean the rules are
right. That is the next step.

### 6. Review what it wrote

```sh
git status
git diff
```

Read the generated `RULES.md` and the technology skills as you would a pull request from a new
colleague: is each rule true for this codebase, and does the cited line show it? Then ask a fresh
session, not the one that ran `/sdd init`, to check the claims against their citations. Fix or
delete anything wrong and re-run the check. When you agree with it, commit:

```sh
git add .claude .agents .memory ai_rules specs workflows learning \
  AGENTS.md CLAUDE.md RULES.md SPEC-HARNESS.md constitution.md goal.md
git commit -m "chore: add Spec Harness"
```

Commit all of it, the inventory and the receipt included. The roles read them. In a monorepo, also
add each `<package>/RULES.md` the receipt lists. If your team ignores `.claude/` in git, decide first
whether the harness files are shared or personal.

### 7. Run a first small ticket

Pick a real, small, low-risk fix: one or two files and a test. Paste the full ticket text:

```text
/sdd Free shipping should start at exactly 50.00, not above it. total() in src/cart.js
uses > where the rule is >=. Add a test for an order of exactly 50.00.
```

A small model first reads the ticket and returns its route: the size, the model tier for each
stage and the files to read first (`sdd-router`). A small fix is classed **MICRO** and takes the
light route:

1. The orchestrator writes one file, `specs/<feature>/ticket.md`, with the goal checks and the
   paths expected to change.
2. A fast-tier **implementer** writes a failing test, then the fix.
3. One **fresh verifier** on the fast tier runs the tests, checks each goal line, reads the diff
   and returns `RESULT: PASS` or `FAIL`.

Nothing is committed, pushed or merged for you. Review the diff and commit it yourself, or say so
explicitly.

### 8. Larger work

A change across several files is **LITE**; shared interfaces, security-sensitive or multi-repo
work is **FULL**. These keep a packet under `specs/<feature>/` and run the roles in separate
contexts (LITE may skip the planner when there is no design decision to make):

```text
planner (strong) -> implementer (fast) -> tester -> verifier -> reviewer -> merger (only with your say-so)
```

The implementer never writes its own acceptance. A merge needs an explicit grant from you each
time; green gates do not grant it.

### 9. Let it learn

When a gate fails, when you correct the work, or when you make a decision later tickets should
follow, the **learner** runs after the ticket. You can also hand it a correction directly through
the `spec-harness-learn` skill:

```text
/spec-harness-learn We never call the API from a component; always through the store layer.
```

It records the signal, looks for causes that repeat, and proposes one change to one rule or skill.
It applies nothing until you approve, and it never edits application source.

### 10. Choose your models

Roles ask for a tier. The mapping lives in one table in `.claude/commands/sdd.md`:

| Tier | Roles | Model |
|---|---|---|
| strong | planner, merger | your provider's strongest |
| fast | implementer, tester, researcher, documenter, router | a cheap, fast one; the router on its smallest |
| review | verifier, reviewer, architect, learner | strong when the token budget allows, otherwise fast |

To change it for your project or your provider, add a `Model tiers` table with the same columns to
your own `AGENTS.md`; it overrides the default. If a model is not available, the run uses the
nearest tier and says so. It does not stop.

## Known limits

- **Initialisation is thorough, not light.** It reads every instruction file and writes rules, skills
  and memory entries. On a tiny repository that is more harness than code; the payoff is on a real
  codebase.
- **Editing a generated rule makes the receipt stale.** Rules, skills and role blocks carry hashes,
  so one edit means a refresh of the files that cite it. Batch your review edits, then refresh once.
- **A green structural check is not a quality verdict.** It proves hashes and citations line up. The
  fresh reviewer in step 6 is the gate that finds wrong rules.
- **Only source files can be cited.** Claims about `package.json` or a README are not covered by the
  structural check, so read those rules yourself.

## Updating

Update the source checkout, then the installed target. Each step is safe to repeat; `update` plans
first and applies only the digest you pass back:

```sh
git -C <checkout> pull --ff-only
spec-harness status <target>
spec-harness update <target>
spec-harness update <target> --apply DIGEST
```

The README's Updating section lists what each planned state means (`UPDATE`, `MERGE`, `CONFLICT`).
A `CONFLICT` leaves a `<file>.spec-harness-proposed` beside the file for you to resolve by hand.

## Undo

Before the commit:

Do not run this while a finalize-init run may be in progress: it removes untracked files under `.claude`, including the finalizer's lock file. Check for a lock first (`ls .claude/agents/.sh-finalize.lock`); if it exists, stop and report.

```sh
git restore .
git clean -fd .claude .agents .memory .spec-harness ai_rules specs workflows learning
git clean -f AGENTS.md CLAUDE.md RULES.md SPEC-HARNESS.md constitution.md goal.md loop.sh learning_human.html
```

`git clean` removes only untracked files, so anything of yours that was already committed stays.
Run it with `-n` first to see the list. Two cautions: `git restore .` also discards any other
uncommitted edit in the working tree, and `git clean -fd .claude` also removes your own untracked
files there. In a monorepo, remove each generated `<package>/RULES.md` as well. After the commit, revert the commit or delete the branch.

## Exit codes

Two terms recur below. The run's **commit point** is the point after which the run has written every new file and its final `STRUCTURAL_READY` status, and has released the lock. An interrupt after the commit point still rolls the run back, unless the rollback is refused. The **lock step** is taking the lock (creating the lock file and writing the run's PID, the number the operating system gives a running program, into it) or releasing it. A rollback takes the lock before it writes, so a rollback that cannot take the lock is refused and writes nothing.

| Code | Meaning |
|---|---|
| `0` | The shell step finished. The status may still be PENDING. `finalize-init --apply` also exits `0` in the one measured case (an interrupt from an `atexit` hook, a function Python runs as it shuts down, after a completed run). Reported for that case, not covered by a test in the repository, not re-run: a traceback on stderr ending `Interrupted: SIGINT`, the journal (`journal.json` in the evidence directory: the directory you pass as `--evidence-dir`, outside the target; it records each run's status) reads `STRUCTURAL_READY`, and the completed run stays in place. Other exit points are not measured (RFC 0003, section 3). |
| `1` | A check failed and printed what is missing or stale. `index` or `finalize-init` refused an argument, a precondition or a busy lock (the lock is `.claude/agents/.sh-finalize.lock` in the target: a file that stops a second `finalize-init` from running at the same time). A `finalize-init` tool step (`generate-agents --check` or `index --preview`) that runs longer than 600 seconds has its direct child process stopped and is refused, and the run is rolled back. A child process that the step started may keep running. `doctor` reports structural PENDING. A `finalize-init` rollback that could not finish keeps the lock. |
| `2` | A missing target or unknown command, a bad argument, or a command that only prints a procedure for a model to follow. `doctor`, `index`, `finalize-init` and `generate-agents` also exit 2 on Python older than 3.11. |
| `130` | The rollback case: `finalize-init --apply` was interrupted by Ctrl-C or SIGTERM, and the rollback finished. The journal reads `ROLLED_BACK`, which means every write was restored. The lock is released, unless removing it failed: then the status is still `ROLLED_BACK` and the lock file is kept (see [Stale lock after a rollback](#stale-lock-after-a-rollback)). Three other interrupt outcomes exit `1`: a refused rollback (before or after the commit point), a conflict, and a failed restore. A refused rollback, because another finalize-init holds the lock or because the lock step fails, leaves the target as the interrupt left it. After the commit point, the completed run stays in place (status `STRUCTURAL_READY`). Before the commit point, the status stays what it was (`APPLYING`, or `PENDING` before the first write), the target keeps the writes already made, and the command exits `1`. A rollback that finds a changed file (status `RECOVERY_CONFLICT`) keeps that file and the lock. A restore that fails partway (status `RECOVERY_FAILED`) means some files still hold this run's bytes, and keeps the lock. An interrupt that lands while Python is exiting is a different path and is not rolled back: it can exit `0` (see the `0` row, and RFC 0003, section 3). |

## When something looks wrong

| You see | Cause | Do |
|---|---|---|
| `PENDING: missing or unsafe synthesis receipt` | `/sdd init` has not run yet | run step 5 |
| The client ignores the harness | your own `CLAUDE.md` was preserved | step 3 |
| `Indexed 0 package boundary/boundaries` | no `package.json` or `pyproject.toml` at the root you indexed | index the directory that has one |
| The check fails after you edited a generated file | the receipt hash is stale | if your inventory is `ai_rules/project_inventory.json`, ask the client to run the guarded refresh in `/sdd init`. A Markdown context map (the default `index` output) cannot be refreshed that way: the refresh refuses it with "re-run init for a Markdown context map", and the policy-drift check does nothing for it |
| `/sdd` is not recognised in Codex | the project skill was not discovered | open `.agents/skills/sdd/SKILL.md` and follow it |
| `concurrent edits kept, manual recovery needed` (from `--apply`) or `concurrent edits kept; manual recovery needed` (from `--recover`) | a file changed while `finalize-init --apply` was writing it | follow [Recovery conflict](#recovery-conflict) below |
| `step '<name>' timed out after 600 s: its direct child was stopped, but a child process it started may keep running; command: <command>; every write was rolled back` (no conflict and no failed restore: the message ends here) | a `finalize-init` tool step ran past its limit, so the run was refused and rolled back | The lock was released, unless removing it failed. If a lock file is still there, use [Stale lock after a rollback](#stale-lock-after-a-rollback) before running again. Before you run again, check with `ps` that no process the stalled step started is still running; if one is, stop and report it, and do not run again. Then find why the step stalled and run `finalize-init` again with a new `--evidence-dir` |
| `step '<name>' timed out after 600 s: its direct child was stopped, but a child process it started may keep running; command: <command>; concurrent edits kept, manual recovery needed: <path>` (a journaled file changed during the wait) | the same timeout, and the rollback found a file that changed while the step was waiting | The rollback did not finish: the status is `RECOVERY_CONFLICT` and the lock is kept. Do not use the stale-lock steps. Follow [Recovery conflict](#recovery-conflict) |
| `step '<name>' timed out after 600 s: its direct child was stopped, but a child process it started may keep running; command: <command>; rollback failed: <error>; lock kept; run --recover` | the same timeout, and a restore raised an error partway | Some files may still hold this run's bytes, and the lock is kept. Do not remove the lock. Follow the row that says `rollback failed` in this table: run `--recover` with the same `--evidence-dir` |
| `another finalize-init holds .claude/agents/.sh-finalize.lock`, and `--recover` answers `that journal was already restored (ROLLED_BACK)` | a rollback restored every file, but removing its lock failed; the lock now records a process that has exited | follow [Stale lock after a rollback](#stale-lock-after-a-rollback) below |
| The command exits `0` and prints no `STRUCTURAL_READY:` line | Python's `sys.stdout` was closed before the success line. The run had passed its commit point: the lock is released and nothing rolls back | Nothing needs undoing. Check the journal: `status` must read `STRUCTURAL_READY`. Then run the check in step 5 |
| The command exits `120` and stderr has two lines: `Exception ignored while flushing sys.stdout:`, then `BrokenPipeError: [Errno 32] Broken pipe` | the reader of the pipe closed early (for example a pipe into `head`), so the final flush fails at exit. The run had passed its commit point: the lock is released and nothing rolls back. Probed on the same print block, not run on the finalizer | Same as above |
| The command exits `1` with an `AttributeError: 'NoneType' object has no attribute 'flush'` traceback | file descriptor 1 was closed when the command started (`>&-`), so `sys.stdout` is `None`. The run had passed its commit point: the lock is released and nothing rolls back. Probed on the same print block, not run on the finalizer | Same as above |
| A traceback on stderr, exit `1`, and no `PENDING:` line, from an error the run did not name while it was applying | the run rolled back before the traceback printed, and the rollback finished with no conflict | Check the journal. `status` must read `ROLLED_BACK`, which means every write was restored. If it reads anything else, the rollback did not finish: stop and report the journal and the traceback |
| A `PENDING:` line that says `rollback failed` and ends `lock kept; run --recover`, exit `1`, no traceback. The line names the restore error that stopped the restore | a restore raised a named error partway (an `OSError`, a `ValueError`, or a refusal from the restore), so some files may still hold this run's bytes. The journal `status` is `RECOVERY_FAILED` and the lock is kept | Do not remove the lock. Run `--recover` with the same `--evidence-dir`: the Route A or Route B command in [Recovery conflict](#recovery-conflict), step 3, pointed at that directory. If it fails again, stop and report the message it prints |
| A traceback ending `KeyboardInterrupt` on stderr, from a Ctrl-C at the very start of `--apply`, with no journal | the interrupt landed before the run installed its handler. Nothing is written to the target and no lock is taken. The exit code was not measured on the finalizer | Nothing to undo. Check `git status` in the target, then run again with a new `--evidence-dir` |
| A traceback with no journal, when `--apply` hit an `OSError` on the lock file: the create, or a failed write, sync or close | the lock step runs before the run's rollback handlers, so no rollback runs. A lock file the run created is removed after a failed write or sync, unless removing it failed; a failure while closing the lock file leaves the lock in place. A lock left behind means no journal was written, so stop and report it (Stale lock after a rollback needs a journal). Read from the code: the test suite plants this failure but does not check the traceback | The lock stays. Stop and report; do not run again until a person has ruled on the lock. |
| A traceback from the success line, after `STRUCTURAL_READY` was written (see the closed-stdout rows above) | the run is past its commit point, so nothing rolls back | Check the journal: `status` must read `STRUCTURAL_READY`. Then run the check in step 5 |

## Stale lock after a rollback

**Step 0, the safety question. Answer it before anything else here:** Has any other computer, container or shared mount run `finalize-init` on this target, or is one still running on it? If a run is still in progress, stop and report, and do not run this block. If you do not know, stop and report, and do not run this block.

A `finalize-init` run whose journal (the JSON file, `journal.json`, in its `--evidence-dir`, that records each run's status) reads `ROLLED_BACK` (every write restored) has put back every file it wrote.
If removing its lock failed at the same time,
`.claude/agents/.sh-finalize.lock` stays in the target and records the PID (process ID: the number the operating system
gives a running program) of a process that has exited. `--recover` refuses that journal, so it cannot clear the lock.
The block below removes the lock only when no process on this machine holds it. It checks processes on this machine
only. On a shared volume, or when a finalizer runs in another container or on another computer, this check cannot
see that process: do not use this procedure for such a lock. Stop and report. The block uses `pwd -P` (the physical path of the current directory, with symlinks resolved) and `ps` (the command that lists running processes). Run it from the target root, with
`EVIDENCE` set to the `--evidence-dir` of that run:

```sh
EVIDENCE=/path/outside/the/target    # the directory you passed as --evidence-dir
STATUS=$(python3 -I -B -c 'import json, sys; print(json.load(open(sys.argv[1]))["status"])' "$EVIDENCE/journal.json")
TARGET=$(python3 -I -B -c 'import json, sys; print(json.load(open(sys.argv[1]))["target"])' "$EVIDENCE/journal.json")
PID=$(cat .claude/agents/.sh-finalize.lock); LINES=$(wc -l < .claude/agents/.sh-finalize.lock | tr -d ' ')
case "$PID" in
  ''|*[!0-9]*|0*) GONE=invalid; ARGS=; RC=invalid ;;
  *) if [ "$LINES" -gt 1 ]; then GONE=invalid; ARGS=; RC=invalid
     else
       GONE=$(python3 -I -B -c 'import os, sys
try:
    os.kill(int(sys.argv[1]), 0)
    print("no")
except ProcessLookupError:
    print("yes")
except PermissionError:
    print("no")
except OverflowError:
    print("no")' "$PID")
       ARGS=$(ps -p "$PID" -o args=); RC=$?
     fi ;;
esac
if [ "$STATUS" != "ROLLED_BACK" ]; then echo "journal status is '$STATUS', not ROLLED_BACK: stop and report; the lock is kept"
elif [ "$TARGET" != "$(pwd -P)" ]; then echo "the journal's target is '$TARGET', not this directory: stop and report; the lock is kept"
elif [ "$GONE" = invalid ]; then echo "the lock does not hold a process ID: stop and report; the lock is kept"
elif [ "$RC" -eq 1 ] && [ "$GONE" = yes ]; then
  if [ "$(cat .claude/agents/.sh-finalize.lock)" = "$PID" ]; then rm .claude/agents/.sh-finalize.lock && echo "PID $PID is not running: lock removed" || echo "removal failed: stop and report; the lock is kept"
  else echo "the lock changed during the check: stop and report; the lock is kept"; fi
elif [ "$RC" -eq 127 ]; then echo "ps is not available: stop and report; the lock is kept"
elif [ "$RC" -eq 0 ] && printf '%s\n' "$ARGS" | grep -q sh-finalize-init; then echo "PID $PID is a running finalizer: $ARGS; wait for it, then run this block once more; the lock is kept"
else echo "PID $PID is still running, or its state is unclear (ps exit $RC, process check '$GONE'): command line: ${ARGS:-none}; the lock is kept"
fi
```

A number above 2147483647 is kept and reported with the still-running line, because the signal-0 check (the operating system's check that a process exists) cannot represent it. The 4300-digit limit on converting a string to an integer applies to recent Python releases: a number up to 4300 digits gives no Python traceback, and a longer one is also kept and reported with the still-running line, and it prints a traceback on stderr. Older Python releases may not raise this limit. A number the system can hold (2147483647 or below) for which `ps` exits with status 1 (ps does not know the number) is not treated as dead by `ps` alone: the lock is removed only when the signal-0 check also reports the process gone. For a kept number, stop and report; do not remove the lock.

The block removes the lock only if all of these hold. The journal status is exactly `ROLLED_BACK`. The journal's
`target` is the current directory (`pwd -P`). The lock holds one line that is a process ID made of digits, not zero, and no leading zero. `ps` exits `1` and
the operating system also reports that process as gone. The lock still holds the same process ID just before the
removal. The operating system check sends signal 0, which delivers nothing; it only asks whether the process exists. A
process that is still running keeps the lock whatever its name, so a `ps` that exits `1` for a live process, or any
`ps` exit other than `0` or `1` (including a missing `ps`), keeps the lock too. The block exits `0` in every branch, so
its exit code tells you nothing. Read the line it prints.

The target check shows only that the journal names this directory. The procedure cannot tell which run wrote the
lock beyond that. Recording a run ID and the hostname in the lock is a named follow-up in RFC 0003 ("Not in
0.4.0", Run-ID binding), and it is not in this release.

The lock is exclusive: a run takes it before it writes anything to the target and holds it until the commit point. So
while another finalizer runs on this target and has not yet passed its commit point, the lock records that finalizer's
PID. After the commit point the run releases the lock, so the lock does not record its PID again, unless an interrupt
after the commit point starts a rollback, which takes the lock again. A dry run writes nothing and takes no lock.

Steps 1 to 3 below cover the two lines that name a live process. Every other printed line, except `is not running: lock removed`, stands alone: read it, and stop and report, keeping the lock. The `lock removed` line removes the lock only when the PID is gone. A
stale lock whose PID another program now uses stays in place until that program exits.

If the line is `PID <PID> is a running finalizer: <command line>; wait for it, then run this block once more; the lock is
kept`, or `PID <PID> is still running, or its state is unclear (ps exit <RC>, process check '<GONE>'): command line:
<command line>; the lock is kept`, the block could not confirm that the recorded process has exited, so the lock stays. A process that has exited but has not been reaped by its parent still counts as running to this check, so its lock is kept with a live line, and the reader stops and reports.

1. If the line is `PID <PID> is a running finalizer`, wait for that run to finish, then run this block once more.
2. If the block prints a live line again after step 1, stop and report the PID and the command line to the person who runs the finalizer. Do not remove the lock.
3. If the line is `PID <PID> is still running, or its state is unclear`, stop and report the PID and the command line to the person who runs the finalizer. Do not remove the lock.

Only after the block prints `lock removed`, start a new run with a new evidence directory outside the target. Route A (`npx`, nothing installed):

```sh
npx -y github:chohra-med/spec-harness-oss finalize-init . --apply --source <each path you passed to index in step 4> --evidence-dir <new directory outside the target>
```

Route B (`spec-harness` on your PATH):

```sh
spec-harness finalize-init . --apply --source <each path you passed to index in step 4> --evidence-dir <new directory outside the target>
```

Repeat the same `--source` flags you gave the index step, and give none if you gave none. A run without the original
sources plans from a different index. The run plans again from the files as they are now.

Do not use this step when the status is `STRUCTURAL_READY`, `RECOVERY_CONFLICT` or `RECOVERY_FAILED`: a completed run
keeps its result, a conflict needs the steps in [Recovery conflict](#recovery-conflict), and a failed restore
(`RECOVERY_FAILED`) is retried with `--recover` as the table in [When something looks wrong](#when-something-looks-wrong) says.

## Recovery conflict

`finalize-init --apply` keeps the lock (`.claude/agents/.sh-finalize.lock` in the target: a file that
stops a second `finalize-init` from running at the same time; a run releases it when it finishes cleanly or its rollback
completes with no conflict, unless removing it fails). `--recover` keeps it too, unless it took its own lock because the
crashed run's lock was removed by hand (step 3 says which message that prints). It prints `concurrent edits kept, manual recovery
needed: <path>` from `--apply`, or `concurrent edits kept; manual recovery needed: <path>` from `--recover`,
when a file holds neither the bytes the run started from nor a write the run made. `--recover`
does not overwrite that file for you, and it cannot clear the conflict by itself. Put the file back yourself,
then run recovery again. From the target root:

1. Save the file first if your edit matters. Step 2 overwrites it.
2. Write back the bytes the journal recorded for that file. The journal is `journal.json` in your evidence directory,
   outside the target: it records each file's bytes from before the run, the run's status and the commands it ran.

   ```sh
   EVIDENCE=/path/outside/the/target   # the directory you passed as --evidence-dir
   FILE=ai_rules/project_inventory.json # the path the message names; repeat for each path it names
   python3 -I -B -c 'import base64, json, sys
   entry = json.load(open(sys.argv[1]))["files"][sys.argv[2]]
   open(sys.argv[2], "wb").write(base64.b64decode(entry["before"]))' "$EVIDENCE/journal.json" "$FILE"
   ```

   Steps 2 and 3 must run in the same shell session, because `$EVIDENCE` is set in step 2. If you open a new
   terminal, set `EVIDENCE` again to the same path before step 3.

3. Run recovery with the same evidence directory. Route A (`npx`, nothing installed):

   ```sh
   npx -y github:chohra-med/spec-harness-oss finalize-init . --recover --evidence-dir "$EVIDENCE"
   ```

   Route B (`spec-harness` on your PATH):

   ```sh
   spec-harness finalize-init . --recover --evidence-dir "$EVIDENCE"
   ```

   Expect `RECOVERED: prior bytes restored` and exit 0. When recovery takes over the crashed run's lock, that lock is released only after that success, so you do
   not remove it by hand. If you removed the lock before recovery, recovery takes its own lock and releases it
   when recovery fails too; when it leaves a conflict, the message says `this run's own lock is released`.

A hand edit to some other content does not work: recovery accepts only the recorded bytes or a write the run
made, so any other content stays a conflict.
