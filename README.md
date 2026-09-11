# Second Brain Starter

A free, plain-Markdown Second Brain foundation for one active project. It gives that project a PARA + CODE structure, a bounded operating route, five project-local skills, and a safe initializer. You can also read and use the Markdown manually in a text editor.

**Source version and releases:** [VERSION](VERSION) identifies these source bytes: `v1.1.0`. `v1.0.0` is the first published public release. A source version does not say that an archive is published: use the repository's Releases page to identify released tags and their archives.

## License and boundaries

This starter is licensed under the [MIT License](LICENSE). You may use, copy, modify, publish, distribute, sublicense, and sell copies under those terms. Keep the copyright and license notices with substantial copies.

This is the free Second Brain foundation. It contains PARA, CODE, the one-project workflow, manual procedures, and the local initializer below. It does not include a private application, native file discovery, a mobile-only workflow, a cloud-only assistant without local file access, a support call, installation service, or an outcome guarantee.

Read [PRIVACY.md](PRIVACY.md), [ATTRIBUTION.md](ATTRIBUTION.md), and [CONTRIBUTING.md](CONTRIBUTING.md) before sharing a copy.

## Get started

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

1. Open the installed `Home.md` in your target. The source template is [template/Home.md](template/Home.md); it is not the workspace you will edit.
2. Choose one active project. Do not turn this into a life archive on day one. That way lies tasteful digital archaeology.
3. Replace bracketed examples in your installed `01-Projects/Selected-Project/FACTS.md`, `roadmap.md`, `progress.md`, and `Decisions.md`.
4. The initializer writes compatible root loader and skill files for supported-client discovery: five skills to `.claude/skills/` and `.agents/skills/`, plus installed `AGENTS.md` and `CLAUDE.md` loaders. Give a client local-file access only when you intend it, then inspect those files in the target. Clean authenticated discovery evidence for the named supported clients is pending. These files do not grant file access, enforce compliance, or establish universal client support.
5. A text editor remains enough. You may test a copied target as an Obsidian vault, but current Obsidian desktop compatibility has not been verified.

### 4. Run the free first loop

The following links are source-template examples. After initialization, use the same relative paths inside your target:

1. **Capture:** add one real incoming task to the selected project's [roadmap](template/01-Projects/Selected-Project/roadmap.md) with an owner, `Open` status, evidence for done, and one next action. Follow [capture](template/03-Resources/Procedures/capture.md).
2. **Context:** read the project route and return the compact context note from [context](template/03-Resources/Procedures/context.md).
3. **Do and close:** complete the next action. Record what changed and its evidence in [progress](template/01-Projects/Selected-Project/progress.md), then use [close](template/03-Resources/Procedures/close.md). A task is not `Verified` until its stated evidence exists.
4. **Review:** before a handoff or weekly, use [review](template/03-Resources/Procedures/review.md). Repair any mismatch between a `Done` claim and its required evidence, then name one `Next` action.

PARA gives records a home and CODE gives work a direction. Read [PARA + CODE](template/03-Resources/PARA-CODE.md) when you need the definitions.

## Verify, update, and roll back

Run verification from the source root against the installed target:

```sh
node ./bin/second-brain.mjs verify --target "$PROJECT"
```

Verification reports each managed path and exits nonzero if an installed managed file is missing or has changed. It does not inspect unrelated project files.

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
