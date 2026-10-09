<div align="center">

# Second Brain Starter

**A workspace that connects your repositories to a memory your AI can continue.**

A free, plain-Markdown foundation for keeping facts, decisions, progress and next work available across Claude Code or Codex sessions.

[![license](https://img.shields.io/github/license/chohra-med/second-brain-starter.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/chohra-med/second-brain-starter.svg?style=social)](https://github.com/chohra-med/second-brain-starter/stargazers)

Created by [**Malik Chohra**](https://getwireai.com?utm_source=github&utm_medium=readme&utm_campaign=creator) · [Code Meet AI newsletter](https://codemeetai.substack.com?utm_source=github&utm_medium=readme&utm_campaign=newsletter)

Sponsored by [Builder AI OS](https://choumed.gumroad.com/l/builder-ai-os?utm_source=github&utm_medium=readme&utm_campaign=sponsor) and [CasaInnov](https://casainnov.com?utm_source=github&utm_medium=readme&utm_campaign=sponsor)

</div>

---

> **Need the learning layer too?** Start free here. **[Builder AI OS](https://choumed.gumroad.com/l/builder-ai-os?utm_source=github&utm_medium=readme&utm_campaign=builder-ai-os)** is the optional paid version. It adds prepared diagnostics, worked sessions and a controlled learning ratchet that records approved improvements in the changelog.

## Start in one sentence

1. Get a source copy: download and extract a ZIP from [Releases](https://github.com/chohra-med/second-brain-starter/releases), or clone the [repository](https://github.com/chohra-med/second-brain-starter).
2. Open the extracted or cloned source folder in Claude Code, Codex CLI or the Codex app with local file access.
3. Type:

> Set this up for me

Keep the source copy separate from your work. For example, `Downloads/second-brain-starter` holds the installer; `Projects/learn-one-idea` is the project folder you choose and confirm. The project may already exist, or the assistant can plan a new folder under a parent you select.

Connecting a repository is a separate, optional step after setup, and it is covered below in [Connect a repository](#5-connect-a-repository-optional).

The assistant asks only missing questions about your goal, useful output and constraints, reads existing project rules and checks for Node.js `>=22`. If that runtime is missing, it explains the trusted installation options and asks before installing anything. The starter has zero production dependencies.

You confirm the exact project folder and review the full setup plan before approving it. After installation, the assistant verifies the result and opens the installed Home to finish one small, checked result. Later record edits and artifacts each keep their own approval.

Ordinary web chat cannot perform this local setup. Your client and operating system still control file access and permission prompts. Manual commands remain below under [Manual and recovery setup](#manual-and-recovery-setup).

## Your first useful result

The starter gives one workspace:

- one official home for current facts, decisions, roadmap and progress;
- a `Home.md` dashboard that points to the next useful action;
- a `00-Meta/Profile.md` seed, which the first-use interview fills in for role, stack, answer style and boundaries, leaving anything you do not answer as `Unknown`;
- seven local skills: context, capture, close, review, learning, the local ICM bindings and the bundled `icm-architect` method;
- a project template folder to copy when a second project starts, and a `connect` command that creates the same kind of folder for each repository you name;
- a `connect` command that stages Spec Harness into a repository you name and registers that repository with the workspace;
- a safe initializer with plan approval, verification, receipts and rollback;
- plain Markdown files you can inspect without a private application.

Start with one repository. Turning the whole laptop into a knowledge empire on day one is how tasteful digital archaeology begins.

## The first loop

```text
Focus -> Context -> Do -> Close -> Review
```

1. Choose one outcome in `00-Meta/Daily-Task-Plan.md`.
2. Load the selected project's current facts and decisions.
3. Complete the next action and keep evidence.
4. Record what changed in `progress.md`.
5. Review open work, stale facts and the next action.

PARA gives each record a home. CODE moves information from capture to finished work. Read [PARA + CODE](template/03-Resources/PARA-CODE.md) for the short definitions.

## Free foundation and Builder AI OS

| Second Brain Starter | Builder AI OS |
|---|---|
| Public MIT foundation for one workspace and the repositories you connect to it | Paid operating layer for builders |
| Home dashboard and seven shared skills: context, capture, close, review, learning, ICM bindings and the bundled `icm-architect` method | A premium Home page, more skills and adapters |
| Safe initializer, verification and rollback | Prepared diagnostics, worked sessions and failure clinic |
| Learning procedure | Controlled learning ratchet with human approval and changelog history |
| Community source updates | Paid product updates and private repository access |

Use the free starter first. [Builder AI OS](https://choumed.gumroad.com/l/builder-ai-os?utm_source=github&utm_medium=readme&utm_campaign=builder-ai-os-comparison) is optional when you want the prepared learning and operating layer.

## License and boundaries

This starter is licensed under the [MIT License](LICENSE). You may use, copy, modify, publish, distribute, sublicense and sell copies under those terms. Keep the copyright and license notices with substantial copies.

This is the free Second Brain foundation. It contains PARA, CODE, the per-project workflow, manual procedures, the local initializer and the `connect` command below. It does not include Builder AI OS, a private application, native file discovery, a cloud-only assistant without local file access, a support call, installation service or outcome guarantee.

This package also bundles Spec Harness under `vendor/spec-harness/` with its own MIT license. The `connect` command stages its files into a repository you name. No code in `lib` or `bin` starts a process, so the starter never runs the vendored shell scripts. See [ATTRIBUTION.md](ATTRIBUTION.md).

Read [PRIVACY.md](PRIVACY.md), [ATTRIBUTION.md](ATTRIBUTION.md), and [CONTRIBUTING.md](CONTRIBUTING.md) before sharing a copy.

**Source version and releases:** [VERSION](VERSION) identifies these source bytes as `v1.3.0`. Use the repository's [Releases](https://github.com/chohra-med/second-brain-starter/releases) page to identify published tags and archives.

## Manual and recovery setup

### 1. Get a source copy

For a published release, choose one route:

- **Git:** clone the repository to a location you control. Git is optional and useful when you want to inspect or pull later source updates.
- **ZIP:** download a published release ZIP, extract it, and keep the extracted folder as your untouched base copy.

If you use a source checkout rather than a release ZIP, keep its structure intact. Its `bin/`, `lib/`, `template/`, and `template-manifest.json` files are the initializer source. Your project is a separate target directory, not an edited installer checkout.

### 2. Initialize a project safely

The initializer needs Node.js `>=22`, an existing project directory or a missing empty target outside the source copy, and an absolute target path. macOS, Linux, and Windows are the V1 portability target; no npm package is required or published. `connect` is part of the same target, and its printed commands are quoted for the shell family in use.

From the extracted or cloned starter root, set `PROJECT` to the absolute directory you want to prepare. On macOS/Linux shells:

```sh
SOURCE_ROOT="$(pwd -P)"
PROJECT="$(dirname "$SOURCE_ROOT")/my project"
node ./bin/second-brain.mjs init --target "$PROJECT"
```

On PowerShell:

```powershell
$PROJECT = [IO.Path]::GetFullPath((Join-Path $PWD '..\my-project'))
node .\bin\second-brain.mjs init --target $PROJECT
```

In an interactive terminal, `init` prints the complete plan and asks you to type its exact plan digest before it writes. Read the listed `CREATE`, `IDENTICAL`, `MANAGED-UPDATE`, `CONFLICT`, and `DEPRECATED` entries first. A conflicting plan is not applied.

In a non-interactive shell, the same command prints a plan only, and it ends with `Plan only: nothing was applied.`. That line is the normal end of a plan-only run, not an error. A declined terminal prompt prints `Plan not applied.` instead. After reviewing that exact output, rerun it with its exact digest:

```sh
node ./bin/second-brain.mjs init --target "$PROJECT" --apply YOUR_PLAN_DIGEST
```

Do not substitute a digest from another target or a previous plan. `--force` does not exist in V1.

The target may already contain your project files. Differing managed files remain conflicts. A nonempty unmanaged root `AGENTS.md` or `CLAUDE.md` also stops for manual resolution. The plan marks it `CONFLICT` and prints `Manual resolution required: AGENTS.md has unmanaged or malformed loader markers.` That message is the same for a plain file with no harness block and for a file whose block is broken, so the plan names the file and you check which case you have. The only loader merge surface is an existing compatible `second-brain` managed block; keep your project-specific instructions outside that block. The initializer never grants an AI client file access or proves that a client follows the files.

### 3. Start one project

1. Open the installed `Home.md` in your target. It is the dashboard for the project you will run. The source template is [template/Home.md](template/Home.md); it is not the workspace you will edit.
2. Choose one active project. Do not turn this into a life archive on day one. That way lies tasteful digital archaeology.
3. Follow Home's [First use](template/03-Resources/Procedures/first-use.md) route in the installed target. Agree the missing goal and constraints, approve the exact record edits, then approve and finish one small artifact with a check. Preserve existing personalized records. Close the result and start a new chat in that target to recover the next action.
4. The Profile interview is part of that route. It asks only the four questions whose answers are still missing in `00-Meta/Profile.md`: your role, your stack, how you want answers given, and what must never be touched. An answer you do not give stays `Unknown`, so a later session asks again instead of guessing.
5. The initializer writes compatible root loader and skill files for supported-client discovery: seven skills (context, capture, close, review, learning, `second-brain-icm` and the bundled `icm-architect`) to `.claude/skills/` and `.agents/skills/`, plus installed `AGENTS.md` and `CLAUDE.md` loaders. Give a client local-file access only when you intend it, then inspect those files in the target. Clean authenticated discovery evidence for the named supported clients is pending. These files do not grant file access, enforce compliance, or establish universal client support.
6. A text editor remains enough. You may test a copied target as an Obsidian vault, but current Obsidian desktop compatibility has not been verified.

### 4. Run the free first loop

The following links are source-template examples. After initialization, use the same relative paths inside your target:

1. **Focus:** choose one outcome in the installed `00-Meta/Daily-Task-Plan.md`.
2. **Context:** read the project route and return the compact context note from [context](template/03-Resources/Procedures/context.md).
3. **Do:** complete the next action from the selected project's [roadmap](template/01-Projects/Selected-Project/roadmap.md). When new work arrives, follow [capture](template/03-Resources/Procedures/capture.md) to record it with an owner, `Open` status, evidence for done, and one next action.
4. **Close:** record what changed and its evidence in [progress](template/01-Projects/Selected-Project/progress.md), then use [close](template/03-Resources/Procedures/close.md). A task is not `Verified` until its stated evidence exists.
5. **Review:** before a handoff or weekly, use [review](template/03-Resources/Procedures/review.md). Repair any mismatch between a `Done` claim and its required evidence, then name one `Next` action.

PARA gives records a home and CODE gives work a direction. Read [PARA + CODE](template/03-Resources/PARA-CODE.md) when you need the definitions.

For system architecture maintenance, use `second-brain-icm` before changing rules, skills or context routes. It holds this workspace's local bindings and change contract, and it names its method owner: the bundled [`icm-architect`](template/shared-skills/icm-architect/SKILL.md) skill by Jake Van Clief, copied unmodified under its MIT license (see [ATTRIBUTION.md](ATTRIBUTION.md)). Ordinary notes keep the compact project route. If native invocation is unavailable, manually read both installed skill files; automatic discovery remains unverified.

To start a second project, copy the installed `03-Resources/_templates/project/` folder into `01-Projects/` under the new project's name. The initializer still seeds one project, `Selected-Project`, and does not rename it. To register a repository you already work in, use `connect` instead, as described in the next section.

### 5. Connect a repository (optional)

`connect` registers one repository you name with the workspace you set up. It does not search for repositories. Run it once for each repository, from the starter copy:

```sh
node ./bin/second-brain.mjs connect --target "$PROJECT" --repo "$REPOSITORY"
```

Add `--name NAME` when you want a folder name other than the repository's own. The `Connection.md` record holds the repository path and the remote. A remote the parser does not recognise is recorded as `unknown`. The name becomes the folder `01-Projects/NAME/` in the workspace. If the default name cannot be used, the refusal says so and asks for `--name`.

The command prints one plan for both folders and writes nothing. Without `--apply`, it is read-only in both folders. Read these lines first:

- `CREATE` lines are files and folders that connect will write: the connection folder and its `Connection.md` record in the workspace, and the harness files in the repository.
- `PRESERVED` lines are files the repository already has. connect creates a file in the repository only where none exists, keeps the existing ones unchanged and lists them. If a preserved `AGENTS.md`, `CLAUDE.md` or `RULES.md` is listed, the plan prints a loader block for you to add by hand. Until you add it, your client does not load the harness.
- `Detection` says what the repository already has. A repository with no Spec Harness files is `NONE`, and connect stages the harness files there. A repository with a harness receipt, `.claude/agents/.init-synthesis.json`, or with older Spec Harness files, is registered only, and connect writes nothing into it.

The plan ends with the exact apply command, with the plan digest. Approve that plan by running the same command with that digest:

```sh
node ./bin/second-brain.mjs connect --target "$PROJECT" --repo "$REPOSITORY" --apply YOUR_PLAN_DIGEST
```

The printed commands use the absolute path of the script, so you can paste them from any folder. They are quoted by platform: single quotes on macOS and Linux, and double quotes on Windows, where the CLI does not escape `%`, so a path that contains `%` may not paste into `cmd.exe` as written. A successful apply prints one of these statuses:

- `Status: STAGED`. The harness files are written and waiting for `/sdd init`. The repository is STAGED until `.claude/agents/.init-synthesis.json` exists, and it is not initialised before that.
- `Status: INITIALISED, registered` or `Status: already has harness files, registered`. The repository is register only. No file was written into it.

For a STAGED repository, open it in Claude Code or Codex and run `/sdd init` there. That step is written by the model, so the files it edits afterwards are outside the connect receipt.

Nothing is committed. connect runs no git command. The files it creates are uncommitted, and your team decides whether they go in by pull request. The staged `loop.sh` is copied as bytes, so it is not executable on this route.

The Spec Harness `index` step is optional and is not run by connect. It needs Python 3.11 or newer. The vendored script is Bash and uses POSIX-only file APIs, so this project has not tested it on native Windows and does not guarantee it there. See `vendor/spec-harness/docs/GETTING-STARTED.md` in the starter copy.

What connect does not do:

- It does not find repositories. You name each one, and each connect covers one repository.
- It does not commit, push, branch or stash.
- It does not run `/sdd init` or the `index` step. No code in `lib` or `bin` starts a process, so no vendored shell script runs.
- It does not write into a repository that already has harness files.
- It does not add a loader block to your files. You add it, when the plan asks.
- It does not work from ordinary web chat. Your client still needs local file access.

## Verify, update, and roll back

Run verification from the source root against the installed target:

```sh
node ./bin/second-brain.mjs verify --target "$PROJECT"
```

Verification reports each managed path and exits nonzero if an installed managed file is missing or has changed. It does not inspect unrelated project files. It also lists each connection, if the workspace has any, and the connections do not change the exit code. `verify` only reads: it writes nothing in either folder. Editable seed records are expected to change after setup; once the v1.1.0 seed policy is installed, verification reports those existing contained records as `PERSONALIZED` and still succeeds. Missing, unsafe, or escaping seed paths still fail.

Personalize editable seed records such as project facts, decisions, roadmap and progress as you work; those changes remain valid. Personalizing a managed record intentionally creates baseline drift: this includes managed procedures and loaders, so `verify` names that path and exits nonzero. That expected result is not proof of damage: review the named paths against the changes you intended. Do not alter installed state merely to make `verify` green. The one exception is a `NO_RECEIPT` connection, which the Recovery section describes.

For a later starter version, obtain a fresh source copy first, then run its `upgrade` command against the same target. It prints a complete three-way plan using the installed record, your current bytes, and the new template bytes. As with `init`, an interactive terminal requires the displayed digest; non-interactive use requires `--apply` with that exact digest. Read [UPGRADING.md](UPGRADING.md) before upgrading.

Every applied transaction prints a receipt ID and stores its receipt inside the target's `.second-brain` state. A connect prints its receipt ID too. Each `CONNECTION` line of `verify` ends with that ID. To undo only that receipt's writes:

```sh
node ./bin/second-brain.mjs rollback --target "$PROJECT" --receipt RECEIPT_ID
```

The rollback checks that receipt's current preconditions and does not undo unrelated project work. Rolling back an upgrade removes that receipt's folder under `.second-brain/backups/`, and it leaves the empty `.second-brain/backups/` folder in place. A connect receipt covers both folders: rolling it back removes exactly the files it created in the workspace and in the repository, and refuses if one of them changed. Keep a dated copy of your target before any migration.

`verify` prints one line for each connection:

| Label | Meaning |
|---|---|
| `STAGED` | The harness files connect wrote are present and unchanged. `/sdd init` has not written its receipt yet. |
| `INITIALISED` | The repository has the harness receipt `.claude/agents/.init-synthesis.json`. Connect may have staged files here earlier; this label reads the receipt on disk now. |
| `CHANGED` | Some staged files are missing or differ now. The line gives the count and the first names. You can roll the connection back, or keep the files. |
| `MISSING` | The repository folder is not at the path the connection recorded. |
| `REGISTERED (now: ...)` | The repository has Spec Harness files but no `.claude/agents/.init-synthesis.json` receipt, so connect registered it without writing. The bracket shows what detection finds on disk now: harness present, or no harness files found. |
| `UNREADABLE (...)` | verify could not read the repository safely, for example because its folder is now a symlink. The bracket gives the reason. It needs attention, and it does not change the exit code. |
| `NO_RECEIPT` | The receipt is missing, so the tool cannot roll the connection back. See Recovery. |

After the connection lines, one summary line says how many connections need attention, or that all are as recorded. Two more labels can appear:

- `PENDING` names an interrupted connect, or a finished connect whose marker was not cleared, with the command that recovers it. A pending record makes `verify` exit non-zero.
- `RESIDUE` names a leftover temporary file or empty folder from a connect. It is information only, and it does not change the exit code.

The exit code says whether the workspace's own managed files are intact, and whether a pending record exists. A connection in any state other than `PENDING` does not change it.

Every line that `verify` can print starts with one of these prefixes:

| Prefix | Meaning | Makes the exit code 1 |
|---|---|---|
| `VERIFIED` | A managed file matches its installed hash. | No |
| `PERSONALIZED` | An editable seed record that you may change. Expected after setup. | No |
| `UNMANAGED` | The installed state does not manage the path. You see this for a file that a newer source adds, such as `00-Meta/Profile.md` before an upgrade. | Yes |
| `MISSING` | A managed file is missing. | Yes |
| `CORRUPT` | A managed file differs from its installed hash. | Yes |
| `MISSING_STATE` | The installed state record is missing. | Yes |
| `SOURCE_MANIFEST_MISMATCH` | The installed state was made from a different source manifest. A newer source reports this until you upgrade. | Yes |
| `CONNECTION` | One connection: its name, repository path, state and receipt ID. | No |
| `PENDING` | An interrupted connect, or a finished one whose marker was not cleared. | Yes |
| `RESIDUE` | A leftover temporary file or folder from a connect. | No |
| `Connections` | The summary line: how many connections need attention, or that all are as recorded. | No |
| `Verification` | `OK` or `FAILED`. | Follows the lines above |

A path-check error can also print as its own code, such as `SYMLINK_PATH` or `NON_REGULAR_FILE`, for a path that verify cannot read safely. Each such line makes the exit code 1.

## Recovery and removal

If a change goes wrong, stop editing the target. Use the relevant receipt rollback when its preconditions hold, or return to the dated copy made before the update. Your records remain plain Markdown and readable without Obsidian.

If a connect is interrupted, `verify` lists a `PENDING` line with its receipt ID. Run the rollback command that line prints. When no file was edited, it restores both folders. Recovery never deletes a file whose bytes differ from what the connect wrote. It lists that file, and you decide what to do with it.

If you edited a file that the connect wrote, the rollback stops with `ROLLBACK_FAILED` and exits 1. The edit is kept, and the connect stays `PENDING`, so connect refuses that repository until the file is dealt with. Move the edited file out of the repository, or delete it yourself, then run the same rollback command again.

Two leftovers are known and accepted. A stop before any pending record exists can leave an empty `.second-brain/connect-pending/` folder, and at most one temporary engine file in it, in the workspace. The design writes the pending record before any repository file, so this leaves nothing in the repository. `verify` lists this as `RESIDUE`, and the next approved connect, rollback or recovery removes it.

Run one connect at a time per workspace. Two connects at the same time are not supported. In runs measured on this branch after the fix, both finished with exit 0 and both repositories were staged, but only one connection record was kept, so `verify` listed one. The unlisted connection's files stay in place, and its receipt stays in `.second-brain/receipts/`. Rolling back either connection by its receipt ID works, and it removes only that connection's files; this was measured in both orders. `verify` does not show the unlisted connection. There is no lock across processes.

`NO_RECEIPT` is the one state the tool cannot undo, because its receipt is missing and there is nothing to roll back. The only way to make `verify` stop listing that connection is to delete its entry from `.second-brain/connections.json` by hand. That does not delete the staged files in the repository, which stay until you remove them.

Rolling back the workspace's own `init` or upgrade is refused while connections exist. The refusal prints the rollback command for each connection. Roll those back first.

To remove the starter, first keep any Markdown files you want to retain. Then delete your copied workspace and, if you used Git, your local clone. Removing a local copy cannot revoke rights granted by the MIT License for copies you already received.

## Contribute

See [CONTRIBUTING.md](CONTRIBUTING.md) and use the public repository's current contribution route for proposed source changes.

For a repeated need after setup, follow installed Home → Your extensions. The [extension guide](template/03-Resources/Procedures/extend.md) covers user-owned references, methods and optional thin skills.
