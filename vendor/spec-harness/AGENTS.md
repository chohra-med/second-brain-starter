# AGENTS.md: how an agent uses and navigates this repository

You are an agent (Claude Code, Codex or similar) and a person has pointed you at this repository.
Read this file first. It tells you what the repository is, what to do for the three things people
usually ask, and where every fact lives.

**Do not confuse this file with `templates/AGENTS.md`.** This file is for agents working *with* or
*on* Spec Harness. `templates/AGENTS.md` is a scaffold that gets copied *into a user's project*.

## What this repository is

Spec Harness is a set of markdown procedures, agent role files and a small Bash CLI. It is installed
*into another project* to give that project a spec-driven workflow: project memory, source-backed
rules, a planner, an implementer, independent tester, verifier and reviewer roles, and a learning
loop. It adds no dependency to the project and never edits the project's application source during
install.

## First, work out which of three jobs you were given

| The person says something like | Your job | Go to |
|---|---|---|
| "add / install / set up Spec Harness in my project" | Install it into **their project** | [Job 1](#job-1-install-spec-harness-into-the-users-project) |
| "run this ticket", "use sdd", "plan / build / verify this" | Run the workflow **inside a project that already has it** | [Job 2](#job-2-run-the-workflow-in-a-project-that-has-it) |
| "change / fix / extend Spec Harness itself" | Work **on this repository** | [Job 3](#job-3-work-on-this-repository) |

If you cannot tell which, ask. Do not start installing anything on a guess.

## Words used here

| Word | Meaning |
|---|---|
| **Target** | The user's project that receives the harness. Never this repository. |
| **Ticket** | The full text of one piece of work. A title alone is not a ticket. |
| **MICRO / LITE / FULL** | The three ticket sizes. MICRO is one small, reversible, local fix. LITE is a small multi-file change. FULL is anything shared, security-sensitive, multi-repo, externally consequential or otherwise high-risk. When unsure, FULL. |
| **Light route** | How a MICRO ticket runs: one file `specs/<feature>/ticket.md`, one implementer, one fresh verifier. |
| **Packet** | The folder `specs/<feature>/` that a LITE or FULL ticket keeps: input, spec, goal, plan, tasks and gate records. |
| **Role** | One agent file with one job: planner, implementer, tester (runs things), verifier (checks each goal line), reviewer (reads the diff against the rules), merger, learner. |
| **Tier** | The class of model a role asks for: `strong`, `fast` or `review`. Never a model name. |
| **Inventory** | `ai_rules/project_inventory.json` in the target: its packages and a few sampled source files. Written by `index`. |
| **Receipt** | `.claude/agents/.init-synthesis.json` in the target: what initialisation produced, with hashes. |
| **PENDING / READY** | PENDING: files are staged but a model or reviewer has not done its part. READY: the structural check prints it when hashes and citations line up. That alone does not mean the generated rules are correct; the setup is fully ready only after a fresh reviewer accepts them. |

## Job 1: install Spec Harness into the user's project

The full human guide is [`docs/GETTING-STARTED.md`](./docs/GETTING-STARTED.md). The steps below
are the same route, written for an agent. The guide numbers its steps differently; where the two
differ in detail, the guide wins. Step numbers in this section mean the numbers in this section.

**If the user is not there to answer you:** step 2 still decides. If it tells you to stop, stop
there and change nothing. If it passes, do steps 3, 4, 6 and 8, which only add files, using the
default source sample in step 6. Do not edit their instruction files (step 5) and do not initialise
(step 7). Report exactly what you did and what is waiting for them.

1. **Find the target.** It is the root of the user's project, never this repository. If you are
   unsure which directory they mean, ask.
2. **Protect their work.** In the target: check `git status`. If it shows modified or staged
   tracked files, stop and tell them; do not stash, commit or discard their work. Create a branch (`git switch -c chore/spec-harness`; pick another name if that one
   exists). There is no uninstall command; the branch is the undo.
3. **Stage the files.** `cd` to the target root first; every command here runs from there. Use
   the checkout you are reading if there is one:

   ```sh
   bash /path/to/spec-harness-oss/bin/spec-harness init . integrate
   ```

   With no checkout on the machine:

   ```sh
   npx -y github:chohra-med/spec-harness-oss init . integrate
   ```

   Exit code 0 with a `status` line that says `PENDING` is success. It only copies files.
4. **Read the report.** `ADDED` are new files. `PRESERVED` is every file that already existed;
   none of them is overwritten. `CONFLICTS` is the subset of preserved files whose content differs
   from the harness version: those are the user's own. **Never overwrite a preserved or conflicting
   file.** If the target had no `AGENTS.md` or `CLAUDE.md`, the installer adds a scaffold one that
   stays a placeholder until step 7.
   **Then open `learning_human.html` for the user** (it was just staged at the target root): `open
   learning_human.html` on macOS, `xdg-open` on Linux, `start` on Windows, or give them the full path.
   It explains to a person what was installed and what happens next. Do this even when they are
   away; it changes nothing.
5. **If `CONFLICTS` lists `CLAUDE.md` or `AGENTS.md`**, the user's own instruction file was kept and
   does not mention the harness, so their client will not load the harness rules. The block to add
   is the fenced `## Spec Harness` block under the heading "3. Existing instruction files" in the
   guide. Show it to the user and add it to their file only when they agree.
6. **Inventory the code**: `bash /path/to/spec-harness-oss/bin/spec-harness index .`, or
   `npx -y github:chohra-med/spec-harness-oss index .` with no checkout. On a large project,
   ask the user which source files best show how the code is written and pass up to five with
   `--source <path>`.
7. **Initialise.** In Claude Code the user types `/sdd init`. If you are doing it yourself, follow
   `.claude/commands/sdd.md` section 1 and `.claude/commands/spec-harness/init.md` in the target.
   This step reads their code and writes rules, skills and role bindings, so use the strongest
   model available and do it only with the user present to review the result.
8. **Check**: `bash /path/to/spec-harness-oss/bin/spec-harness generate-agents --check .` (or the
   `npx` form). After initialisation it must print `READY`. Before initialisation it prints
   `PENDING: missing or unsafe synthesis receipt` and exits 1; that is the expected state, not a fault.
9. **Hand back.** Show the user `git status` (the staged files are untracked, so `git diff` alone
   shows nothing until they are added) and the diff of anything initialisation changed, and tell them a fresh session should
   review the generated rules against their cited lines. **Do not commit, push or merge unless the
   user tells you to.**

Things that are never yours to do during an install: edit the user's application source, install
packages, change their CI, or declare the setup READY because the files exist.

## Job 2: run the workflow in a project that has it

This job only exists in a project that already has `.claude/commands/sdd.md`. If the project does
not have it, that is Job 1 first. **Never run a ticket inside this repository.** If someone asks you
to "use sdd" while you are standing here, ask which project the ticket belongs to.

Work in **that project**. Its own files are the authority:

1. Read that project's `CLAUDE.md` / `AGENTS.md` and follow the startup sequence it declares.
2. The procedure is `.claude/commands/sdd.md` in that project (Codex reaches the same procedure
   through `.agents/skills/sdd/SKILL.md`). Stage contracts are under
   `.claude/commands/spec-harness/`. Roles are `.claude/agents/sdd-*.md`.
3. A small fix takes the light route: one `specs/<feature>/ticket.md`, an implementer, one fresh
   verifier. Larger work keeps a packet and separate tester, verifier and reviewer contexts.
4. The implementer never approves its own work. Commit, push and merge each need the user's
   explicit word.

The copies in this repository (`commands/`, `agents/`) are the *source* those installed files came
from. Read them here to understand the method; act on the installed copies in the project.

## Job 3: work on this repository

### Map

| Path | What it is | Open it when |
|---|---|---|
| [`README.md`](./README.md) | What the project is, the command table | you need the overview |
| [`docs/GETTING-STARTED.md`](./docs/GETTING-STARTED.md) | Step-by-step adoption guide for humans | someone installs it, or you change install behaviour |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Diagrams of the layers and the flow | you need the design |
| [`commands/sdd.md`](./commands/sdd.md) | **The central procedure**: routes, model tiers, ticket classes, light route, gates | almost always; start here |
| `commands/*.md` | One contract per stage (`init`, `plan`, `build`, `verify`, `learn`, ...) | you touch that stage |
| `agents/sdd-*.md` | The twelve role files, with `model:` and `tools:` frontmatter | you touch a role |
| `bin/spec-harness` | CLI dispatcher | you add or trace a subcommand |
| `bin/sh-install.sh` | Stages files into a target; refuses unsafe paths | install behaviour |
| `bin/sh-index.sh` | Writes the project inventory | inventory behaviour |
| `bin/sh-gen-agents.sh` | The structural check of an initialised project | receipt or check behaviour |
| `bin/sh-make-skills.sh` | **Generates** `skills/` | you change a skill's text |
| `skills/` | Generated skill entry points. **Never edit by hand** | read only |
| `templates/` | Files copied into a target: `AGENTS.md`, `CLAUDE.md`, `RULES.md`, `constitution.md`, `goal.template.md`, `workflows/`, `project-skills/` (methods), and `install/` (memory bank, `ai_rules/`, status file) | you change what a project receives |
| [`install-manifest.json`](./install-manifest.json) | Record of every staged file, with a hash per source | you add, remove or edit a staged file; then run `bash tests/tools/update-install-manifest.sh` |
| `tests/*.sh` | Contract and fixture tests | before and after every change |
| [`learning_human.html`](./learning_human.html) | The interactive explainer for humans. Staged into every target; init opens it | a person asks what this is, or you change what the harness does |
| [`docs/COMPANION-SKILLS.md`](./docs/COMPANION-SKILLS.md) | graphify, diagram-design and the built-in methods | someone asks about diagrams or a visual map of the code |
| [`docs/GUARDRAILS.md`](./docs/GUARDRAILS.md) | Who may verify, learn and deliver | you touch authority rules |

### Where each fact lives (one owner each)

| Fact | Owner |
|---|---|
| Which model each tier uses | the `Model tiers` table in `commands/sdd.md`. It maps tiers to models, and lists the roles in each tier. No other command may name a model |
| Which model a role file defaults to | its `model:` frontmatter, which must equal its tier's model (the review tier defaults to the strong model). `tests/sdd-fixtures.sh` holds the same role-to-tier map (`TIER_ROLES`) and fails when they disagree, so moving one role means changing the table row, the frontmatter, that map, and step 10 of the guide together |
| What to do when a model is missing | `commands/sdd.md`, under the tiers table: use the nearest tier, record the requested tier, the model that ran and the reason; a missing *separate context* is different and leaves that gate PENDING |
| MICRO / LITE / FULL and the light route | `commands/sdd.md` §3 |
| What init may write | `commands/init.md` |
| What the learner may change | `agents/sdd-learner.md` and `commands/learn.md` |
| The set of staged files | the code in `bin/sh-install.sh`; `install-manifest.json` records it and a test keeps them in step |
| Skill text | the `emit` calls in `bin/sh-make-skills.sh` |
| The version | `package.json`, `harnessVersion` in `install-manifest.json`, and the tarball name in `README.md` |

### Run the tests

They need `bash`, `git`, `python3` 3.11 or newer, `npm`, `tar`, `shasum` and `cmp` on `PATH`.

```sh
for t in tests/*.sh; do
  bash "$t" > "${TMPDIR:-/tmp}/sh-$(basename "$t").log" 2>&1
  echo "exit $? $t"
done
```

Every line must say `exit 0`. For any other code, read that script's log in the temp directory.
Run them before you change anything, so you know the baseline, and again after. There is no CI:
your local run is the only gate, so report the exit lines and the failing log as they are.

### Rules for changing this repository

- **Smallest correct change.** Reuse what is here before adding anything.
- **A test must be able to fail.** When you add a check, break the thing it guards once, watch the
  suite go red, then restore it.
- **After editing `bin/sh-make-skills.sh`**, run `bash bin/sh-make-skills.sh` and commit the
  regenerated `skills/`.
- **After editing any file that gets staged** (anything under `agents/`, `commands/`, `skills/`,
  `templates/`), run `bash tests/tools/update-install-manifest.sh`. It rewrites every `sha256` in
  `install-manifest.json` and sets `harnessVersion` from `package.json`, and changes nothing else.
  `tests/install-manifest-contract.sh` names the entry when you forget.
- **Keep the docs true.** If you change install behaviour, a count, a prerequisite or an exit code,
  update `README.md` and `docs/GETTING-STARTED.md` in the same change.
- **Nothing private in a public repository.** No client, employer or personal directory names.
- **Work on a branch and commit there.** Pushing the branch, opening a pull request, merging,
  tagging, publishing to npm and creating a release each need the word of the person you are working
  for. Never commit to `main`. This package is marked private and is not on npm; the registry
  package with the same name is unrelated.
- **Never run the installer with this repository as the target.**
- **Behavioural guidelines for code changes**: think before coding, simplicity first, surgical
  changes, goal-driven execution: see the upstream rules at
  https://github.com/multica-ai/andrej-karpathy-skills. Apply them only where they do not conflict
  with this file.

## Quick answers

| Question | Answer |
|---|---|
| How do I install it? | Job 1 above, or `docs/GETTING-STARTED.md` |
| Does it need Node? | Only for `npx`. A checkout needs `bash`, `git` and `python3` 3.11+ |
| What do the exit codes mean? | `0`: the shell step finished (status may still be PENDING). `1`: a check failed and said what is missing, or `index` refused an argument or its target. `2`: no target given, an unknown command, a missing target for `init`, or a subcommand that only prints a procedure for a model to follow |
| What does `PENDING` mean? | Files are staged; a model or reviewer has not done its part yet |
| How do I undo an install? | The "Undo" section of `docs/GETTING-STARTED.md` |
| Which model should plan? | The strongest available. Implement on a fast cheap one. Review on what the budget allows. See `Model tiers` |
| A named model is not available | Use the nearest tier, say so and record it. Do not stop the work. If a *separate fresh context* is not available, that gate stays PENDING |
| Can the implementer approve its own work? | Never |
