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
| Python 3.11 or newer | `index` and the structural check |
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

4. **Optional: run its own tests** before trusting it. They need `rg` (ripgrep) on your `PATH`.

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

The files staged into your project are the same on both routes. Inside Claude Code, `/sdd init`
runs `spec-harness` when it is on your `PATH` and falls back to the `npx` form when it is not.

## Step by step

### 1. Start on a branch

```sh
cd /path/to/your-project
git switch -c chore/spec-harness
git status   # commit or stash first: a clean tree makes the next diff readable
```

There is no uninstall command. The branch is your undo: delete it, or see
[Undo](#undo).

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

`install-manifest.json` at the repository root records the staged set (the installer's own code still decides what is staged, and the test below keeps the two in step): every destination, its source file, the two substitutions, the directories and the loader block below. `tests/install-manifest-contract.sh` installs into an empty git repository and checks that the files created match the manifest exactly, byte for byte.

What lands in the repository:

| Path | What it is |
|---|---|
| `.claude/commands/sdd.md`, `.claude/commands/spec-harness/` | the procedures |
| `.claude/agents/sdd-*.md` | the twelve roles, next to any agents you already have |
| `.claude/skills/spec-harness*`, `.agents/skills/` | skill entry points for Claude Code and Codex |
| `.memory/` | the project memory bank |
| `ai_rules/`, `RULES.md`, `AGENTS.md`, `CLAUDE.md`, `constitution.md` | rules, only where you had none |
| `specs/`, `workflows/`, `learning/`, `SPEC-HARNESS.md`, `goal.md` | ticket packets, critical journeys, lessons, status |
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
- A task is done when a fresh verifier returns PASS against the ticket's own goal, not when tests pass.
- Rules change only through `.claude/commands/spec-harness/learn.md`, after review.
```

Your existing rules stay the authority. Where they already name protected paths, a merge policy or
a startup sequence, the initialiser reads and preserves them.

### 4. Inventory the code

```sh
npx -y github:chohra-med/spec-harness-oss index .
```

This writes `ai_rules/project_inventory.json`: package boundaries, manifests and a small sample of
representative source files per package. It reads `package.json` and `pyproject.toml`. Native iOS
and Android folders are not packages of their own; `Pods`, `DerivedData` and `build` are skipped.

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

Use your strongest model for this step. It reads your instruction files and the sampled source,
then writes:

| Output | Where |
|---|---|
| Source-backed rules, each citing a file and line | `RULES.md`, `ai_rules/rules/frequent_rules.md` |
| Three core skills: architecture, performance, packages | `.claude/skills/spec-harness-*/SKILL.md` |
| One skill per major technology the code really uses, at most five | `.claude/skills/spec-harness-tech-<technology>/SKILL.md` |
| Project rules inside each role | the `GEN:rules` block of `.claude/agents/sdd-*.md` |
| The receipt | `.claude/agents/.init-synthesis.json` |

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

A small fix is classed **MICRO** and takes the light route:

1. The orchestrator writes one file, `specs/<feature>/ticket.md`, with the goal checks and the
   paths expected to change.
2. A fast-tier **implementer** writes a failing test, then the fix.
3. One **fresh verifier** on the review tier runs the tests, checks each goal line, reads the diff
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
| fast | implementer, tester, researcher, documenter | a cheap, fast one |
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

## Undo

Before the commit:

```sh
git restore .
git clean -fd .claude .agents .memory ai_rules specs workflows learning
git clean -f AGENTS.md CLAUDE.md RULES.md SPEC-HARNESS.md constitution.md goal.md loop.sh
```

`git clean` removes only untracked files, so anything of yours that was already committed stays.
Run it with `-n` first to see the list. Two cautions: `git restore .` also discards any other
uncommitted edit in the working tree, and `git clean -fd .claude` also removes your own untracked
files there. In a monorepo, remove each generated `<package>/RULES.md` as well. After the commit, revert the commit or delete the branch.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | The shell step finished. The status may still be PENDING. |
| `1` | A check failed and printed what is missing or stale, or `index` refused an argument. |
| `2` | A missing target or unknown command, or a command that only prints a procedure for a model to follow. |

## When something looks wrong

| You see | Cause | Do |
|---|---|---|
| `PENDING: missing or unsafe synthesis receipt` | `/sdd init` has not run yet | run step 5 |
| The client ignores the harness | your own `CLAUDE.md` was preserved | step 3 |
| `Indexed 0 package boundary/boundaries` | no `package.json` or `pyproject.toml` at the root you indexed | index the directory that has one |
| The check fails after you edited a generated file | the receipt hash is stale | ask the client to run the guarded refresh in `/sdd init` |
| `/sdd` is not recognised in Codex | the project skill was not discovered | open `.agents/skills/sdd/SKILL.md` and follow it |
