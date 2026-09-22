<div align="center">

# Second Brain Starter

**Give one project a memory your AI can continue.**

A free, plain-Markdown foundation for keeping facts, decisions, progress and next work available across Claude Code or Codex sessions.

[![license](https://img.shields.io/github/license/chohra-med/second-brain-starter.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/chohra-med/second-brain-starter.svg?style=social)](https://github.com/chohra-med/second-brain-starter/stargazers)

Created by [**Malik Chohra**](https://getwireai.com?utm_source=github&utm_medium=readme&utm_campaign=creator) · [Code Meet AI newsletter](https://codemeetai.substack.com?utm_source=github&utm_medium=readme&utm_campaign=newsletter)

Sponsored by [Builder AI OS](https://choumed.gumroad.com/l/builder-ai-os?utm_source=github&utm_medium=readme&utm_campaign=sponsor) and [CasaInnov](https://casainnov.com?utm_source=github&utm_medium=readme&utm_campaign=sponsor)

</div>

---

> **Need the learning layer too?** Start free here. **[Builder AI OS](https://choumed.gumroad.com/l/builder-ai-os?utm_source=github&utm_medium=readme&utm_campaign=builder-ai-os)** is the optional paid version. It adds prepared diagnostics, worked sessions and a controlled learning ratchet that records approved improvements in the changelog.

## Start in one sentence

Clone the repository:

```sh
git clone https://github.com/chohra-med/second-brain-starter.git
cd second-brain-starter
```

Open that folder in Claude Code, Codex CLI or the Codex app, then type:

> Set this up for me

The assistant asks you to select one project, reads that project's rules, checks the required Node runtime and shows the full setup plan. Nothing is written until you approve that exact plan. After installation, it verifies the result and sends you to `Home.md`.

Ordinary web chat cannot perform this local setup. Your client and operating system still control file access and permission prompts.

## Your first useful result

The starter gives one project:

- one official home for current facts, decisions, roadmap and progress;
- a `Home.md` dashboard that points to the next useful action;
- five local skills for context, capture, close, review and learning;
- a safe initializer with plan approval, verification, receipts and rollback;
- plain Markdown files you can inspect without a private application.

Start with one project. Turning the whole laptop into a knowledge empire on day one is how tasteful digital archaeology begins.

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
| Public MIT foundation for one selected project | Paid operating layer for builders |
| Home dashboard and five shared skills | Extended dashboards, skills and adapters |
| Safe initializer, verification and rollback | Prepared diagnostics, worked sessions and failure clinic |
| Learning procedure | Controlled learning ratchet with human approval and changelog history |
| Community source updates | Paid product updates and private repository access |

Use the free starter first. [Builder AI OS](https://choumed.gumroad.com/l/builder-ai-os?utm_source=github&utm_medium=readme&utm_campaign=builder-ai-os-comparison) is optional when you want the prepared learning and operating layer.

## License and boundaries

This starter is licensed under the [MIT License](LICENSE). You may use, copy, modify, publish, distribute, sublicense and sell copies under those terms. Keep the copyright and license notices with substantial copies.

This is the free Second Brain foundation. It contains PARA, CODE, the one-project workflow, manual procedures and the local initializer below. It does not include Builder AI OS, a private application, native file discovery, a cloud-only assistant without local file access, a support call, installation service or outcome guarantee.

Read [PRIVACY.md](PRIVACY.md), [ATTRIBUTION.md](ATTRIBUTION.md), and [CONTRIBUTING.md](CONTRIBUTING.md) before sharing a copy.

**Source version and releases:** [VERSION](VERSION) identifies these source bytes as `v1.1.0`. Use the repository's [Releases](https://github.com/chohra-med/second-brain-starter/releases) page to identify published tags and archives.

## Manual and recovery setup

### 1. Get a source copy

For a published release, choose one route:

- **Git:** clone the repository to a location you control. Git is optional and useful when you want to inspect or pull later source updates.
- **ZIP:** download a published release ZIP, extract it, and keep the extracted folder as your untouched base copy.

If you use a source checkout rather than a release ZIP, keep its structure intact. Its `bin/`, `lib/`, `template/`, and `template-manifest.json` files are the initializer source. Your project is a separate target directory, not an edited installer checkout.

### 2. Initialize a project safely

The initializer needs Node.js `>=22`, an existing target directory, and an absolute target path. macOS, Linux, and Windows are the V1 portability target; no npm package is required or published.

From the extracted or cloned starter root, set `PROJECT` to the absolute directory you want to prepare. On macOS/Linux shells:

```sh
SOURCE_ROOT="$(pwd -P)"
PROJECT="$(dirname "$SOURCE_ROOT")/my project"
mkdir -p "$PROJECT"
node ./bin/second-brain.mjs init --target "$PROJECT"
```

On PowerShell:

```powershell
$PROJECT = [IO.Path]::GetFullPath((Join-Path $PWD '..\my-project'))
New-Item -ItemType Directory -Force -Path $PROJECT | Out-Null
node .\bin\second-brain.mjs init --target $PROJECT
```

In an interactive terminal, `init` prints the complete plan and asks you to type its exact plan digest before it writes. Read the listed `CREATE`, `IDENTICAL`, `MANAGED-UPDATE`, `CONFLICT`, and `DEPRECATED` entries first. A conflicting plan is not applied.

In a non-interactive shell, the same command prints a plan only. After reviewing that exact output, rerun it with its exact digest:

```sh
node ./bin/second-brain.mjs init --target "$PROJECT" --apply YOUR_PLAN_DIGEST
```

Do not substitute a digest from another target or a previous plan. `--force` does not exist in V1.

The target may already contain your project files. Differing managed files remain conflicts. A nonempty unmanaged root `AGENTS.md` or `CLAUDE.md` also stops for manual resolution. The only loader merge surface is an existing compatible `second-brain` managed block; keep your project-specific instructions outside that block. The initializer never grants an AI client file access or proves that a client follows the files.

### 3. Start one project

1. Open the installed `Home.md` in your target. It is the dashboard for the project you will run. The source template is [template/Home.md](template/Home.md); it is not the workspace you will edit.
2. Choose one active project. Do not turn this into a life archive on day one. That way lies tasteful digital archaeology.
3. Follow Home's Start here route: replace bracketed examples in your installed `01-Projects/Selected-Project/FACTS.md`, `roadmap.md`, and `Decisions.md`, then choose one outcome in `00-Meta/Daily-Task-Plan.md`. Add dated Done, Verified, Open, and Next entries to `progress.md` as work happens.
4. The initializer writes compatible root loader and skill files for supported-client discovery: five skills to `.claude/skills/` and `.agents/skills/`, plus installed `AGENTS.md` and `CLAUDE.md` loaders. Give a client local-file access only when you intend it, then inspect those files in the target. Clean authenticated discovery evidence for the named supported clients is pending. These files do not grant file access, enforce compliance, or establish universal client support.
5. A text editor remains enough. You may test a copied target as an Obsidian vault, but current Obsidian desktop compatibility has not been verified.

### 4. Run the free first loop

The following links are source-template examples. After initialization, use the same relative paths inside your target:

1. **Focus:** choose one outcome in the installed `00-Meta/Daily-Task-Plan.md`.
2. **Context:** read the project route and return the compact context note from [context](template/03-Resources/Procedures/context.md).
3. **Do:** complete the next action from the selected project's [roadmap](template/01-Projects/Selected-Project/roadmap.md). When new work arrives, follow [capture](template/03-Resources/Procedures/capture.md) to record it with an owner, `Open` status, evidence for done, and one next action.
4. **Close:** record what changed and its evidence in [progress](template/01-Projects/Selected-Project/progress.md), then use [close](template/03-Resources/Procedures/close.md). A task is not `Verified` until its stated evidence exists.
5. **Review:** before a handoff or weekly, use [review](template/03-Resources/Procedures/review.md). Repair any mismatch between a `Done` claim and its required evidence, then name one `Next` action.

PARA gives records a home and CODE gives work a direction. Read [PARA + CODE](template/03-Resources/PARA-CODE.md) when you need the definitions.

## Verify, update, and roll back

Run verification from the source root against the installed target:

```sh
node ./bin/second-brain.mjs verify --target "$PROJECT"
```

Verification reports each managed path and exits nonzero if an installed managed file is missing or has changed. It does not inspect unrelated project files. Editable seed records are expected to change after setup; once the v1.1.0 seed policy is installed, verification reports those existing contained records as `PERSONALIZED` and still succeeds. Missing, unsafe, or escaping seed paths still fail.

Personalizing a managed record intentionally creates baseline drift, so `verify` names that path and exits nonzero. That expected result is not proof of damage: review the named paths against the changes you intended. Do not alter installed state merely to make `verify` green.

For a later starter version, obtain a fresh source copy first, then run its `upgrade` command against the same target. It prints a complete three-way plan using the installed record, your current bytes, and the new template bytes. As with `init`, an interactive terminal requires the displayed digest; non-interactive use requires `--apply` with that exact digest. Read [UPGRADING.md](UPGRADING.md) before upgrading.

Every applied transaction prints a receipt ID and stores its receipt inside the target's `.second-brain` state. To undo only that receipt's writes:

```sh
node ./bin/second-brain.mjs rollback --target "$PROJECT" --receipt RECEIPT_ID
```

The rollback checks that receipt's current preconditions and does not undo unrelated project work. Keep a dated copy of your target before any migration.

## Recovery and removal

If a change goes wrong, stop editing the target. Use the relevant receipt rollback when its preconditions hold, or return to the dated copy made before the update. Your records remain plain Markdown and readable without Obsidian.

To remove the starter, first keep any Markdown files you want to retain. Then delete your copied workspace and, if you used Git, your local clone. Removing a local copy cannot revoke rights granted by the MIT License for copies you already received.

## Contribute

See [CONTRIBUTING.md](CONTRIBUTING.md) and use the public repository's current contribution route for proposed source changes.
