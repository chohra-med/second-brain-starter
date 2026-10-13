# Changelog

## Unreleased

- `init` and `upgrade` append the managed block to a root `AGENTS.md` or `CLAUDE.md` that has your text and no loader markers, when this tool has no install record for that file. The plan shows `APPEND`. Your bytes stay in front of the block, and rollback restores the file byte for byte. A root file with a broken comment shows `CONFLICT`, with the line number and the reason: a comment that is never closed, or a comment that names the tool and is not the one clean managed block. A plain sentence that names the tool does not. The same rule covers `.gitignore`, with `#` lines. The tool cannot recognise every possible damage, so read the plan before you approve it. An installed file whose markers were removed also shows `CONFLICT`. Known limit, not fixed here: appending to a file with CRLF line endings leaves mixed line endings, because the block is LF and your bytes are kept as they are.
- `verify` checks only the managed block of a root `AGENTS.md` or `CLAUDE.md`, and of `.gitignore`. Text you add above or below the block passes. A change inside the block, or a damaged or missing marker, is reported. Every other managed file is still compared whole.
- A root `AGENTS.md`, `CLAUDE.md` or `.gitignore` that is not UTF-8 text (a null byte, or a UTF-16 or UTF-32 byte-order mark) shows `CONFLICT` with a reason that says so, because the marker scan reads bytes. A UTF-8 byte-order mark is kept, and the block goes after the text.
- In `.gitignore`, only a `#` line shaped like a privacy marker outside the block counts as a damaged marker. A `#` comment such as `# second-brain notes` is your own text and does not stop the install.
- An installed `AGENTS.md`, `CLAUDE.md` or `.gitignore` whose marker lines were removed shows `CONFLICT` with the two lines to put back, exactly as shipped.
- A typed `no` at the approval prompt declines the plan in any folder and prints `Plan not applied.`, with exit code 0. Before, a typed `no` in a folder that was not empty printed a digest mismatch.
- Two refusal lines are clearer. An edited installed block says that its text differs from the block this tool installed, not that its markers are malformed. A refused rollback says the files differ from what this receipt wrote, not what `connect` wrote.
- At the terminal prompt, a new folder or an empty folder accepts a plain `yes` (or `y`, in any case, with spaces ignored) in place of the digest. Every other target still needs the exact digest. `--apply yes` is refused, and Enter, Ctrl-C and end of input are refusals as before.
- Adds six shared skills, installed to `.agents/skills/` and `.claude/skills/`: `humanizer` and `skill-creator` copied unmodified from pinned upstream commits (see [ATTRIBUTION.md](ATTRIBUTION.md)); `grill-me`, `readme-generator` and `graphify` rewritten as generic skills; and `writing-skills`, a short guide to writing a skill. The `graphify` skill describes an optional outside tool that is not bundled. The installed set is thirteen skills.
- Adds the procedure `03-Resources/Procedures/showcase-readme.md`, an example of three skills used in order to write a README for one project. The procedures index links to it.
- The install writes a managed `.gitignore` block, or appends it to your existing `.gitignore`. Git ignores the installer state, the daily notes in the daily notes folder (its shipped `daily-template.md` stays tracked), the Profile and Daily-Task-Plan seeds, and each project `Connection.md`. The plan prints these paths.
- Adds three ways to start, listed on Home in order from fastest to fullest, each a procedure in `03-Resources/Procedures/`: `quick-start.md` (index one to three repositories you name), `init.md` (five questions, saved one at a time) and `complete-init.md` (the full question set, in sections you can stop and resume). Each one shows its exact draft and writes only after a yes, and each ends with the same closing prompt.
- Design decision, starting layer for several projects (recorded as [CONTRIBUTING.md](CONTRIBUTING.md) requires): quick start is a procedure an assistant follows. It adds no command, no code that reads a disk and no dependency. It works one repository at a time, and only for a repository the person names. It runs the existing `connect` plan and approval for that repository, then reads only the rule files that [ONBOARDING.md](ONBOARDING.md) stage 9 names: `AGENTS.md`, `RULES.md`, `CONTRIBUTING.md`, `ai_rules/`, `.memory/` and `README.md`. It drafts that project's `FACTS.md`, `roadmap.md` and first `progress.md` entry, and writes them only after a yes. It never lists or searches for repositories, siblings, parents or home folders. A project with nothing readable is recorded as `Unknown`.
- The Profile questions move from `first-use.md`. `init.md` owns the questions for role, answer style and boundaries, and `complete-init.md` owns the one question for stack, so each Profile field has one owner. `first-use.md` keeps its `## 2a. Profile: only what is missing` section, which points to `init.md` and `complete-init.md` and asks only what is still `Unknown`. `complete-init.md` no longer asks the role, answer style or boundary questions again. Stage 8 of ONBOARDING names the three ways in one sentence. The nine stages keep their names and numbers.
- Adds `test/easy-start.test.mjs`: exactly five numbered questions in `init.md`, each with a `Saved to:` owner, the words `skip` and `stop`, the closing prompt last in each procedure, Home order, no question that asks for a password, key, token, secret or credential, line limits, and no em dash.

## v1.3.0 (2026-10-09)

- Design decision, multi-repository layer (recorded as [CONTRIBUTING.md](CONTRIBUTING.md) requires): `connect` is one digest-approved transaction over two roots, the workspace and one repository the person names. One plan and one digest cover both roots. Files in the repository are create-only: an existing file is preserved and listed, never overwritten, and never blocks the plan. Each applied connect writes a receipt that lists its files, and rolling back a receipt removes exactly the files it created in both roots, refusing if any of them changed. `connect` runs no subprocess and no git command. Connection records live in a new versioned `.second-brain/connections.json` beside the unchanged `installed-state.json`, so an install made by v1.x keeps its files and records, and nothing forces the hub shape. A v1.x install reports `SOURCE_MANIFEST_MISMATCH` from the 1.3.0 source until it is upgraded. There is still no discovery: each `connect` covers one repository that the person names.
- Vendors Spec Harness 0.2.0 at commit `a663397c2aafa35071fb1fe899bd6a174cd423e6` under `vendor/spec-harness/` with its MIT `LICENSE`, a pin record in `vendor/SPEC-HARNESS-PIN.json` and a test that checks each vendored file against the pin. The pin records the executable paths and recomputes the pinned git tree hash in Node, so a wrong tree, a stripped executable bit, a removed file or a swapped `LICENSE` fails `test/vendor.test.mjs`. `connect` reads the vendored manifest and copies the files it names. The vendored shell scripts are never executed. See [ATTRIBUTION.md](ATTRIBUTION.md).
- Adds a `00-Meta/Profile.md` seed and a missing-only Profile interview in `first-use.md`. It rewords Home, `00-Meta/AGENTS.md`, `01-Projects/README.md` and the context procedure so another project can sit beside the seeded `Selected-Project`. All seeds stay in the manifest. An upgrade plans a named CONFLICT if you already made your own `00-Meta/Profile.md`.
- Adds a real v1.2.0 install fixture, `test/fixtures/v1.2.0-install.json`, and tests that the current source verifies and upgrades it, and that `connect` leaves its installed state, verify result and bytes untouched.
- Adds `connect --target <workspace> --repo <repository> [--name NAME] [--apply DIGEST]`. It prints one plan for the workspace and the named repository, and writes nothing without the exact digest. A repository with no Spec Harness files gets the harness files staged and uncommitted, and reports STAGED until `/sdd init` writes its receipt. A repository that already has harness files is registered only, with no repository writes.
- `verify` states each connection from what is on disk: STAGED, INITIALISED, CHANGED (with counts of missing and differing staged files), MISSING, REGISTERED (with what detection finds now), or NO_RECEIPT, and prints the receipt ID on each `CONNECTION` line. It lists an interrupted or unfinished connect with its recovery command and makes `verify` exit non-zero. Leftovers are listed as RESIDUE and do not change the exit code. `rollback --receipt` reports recovered, completed and nothing-to-recover results in plain words.
- The connect and rollback refusals that have their own wording name a next command in the CLI tests, and so does the symlink refusal for init, upgrade, verify and rollback. A repository whose default name cannot be used says so and asks for `--name`. Printed commands use the absolute path of the script, so they run from any folder. They are quoted by platform: single quotes on macOS and Linux, double quotes on Windows, where `%` is not escaped.
- `init`, `upgrade` and `connect` print the exact apply command after the plan digest. Pressing Enter (empty input) at the approval prompt exits 0 for all three commands, printing `Plan not applied.`. Ctrl-C or end of input at the approval prompt exits 1 with `Plan not applied.` for all three commands. **Behaviour change:** before this version, `init` and `upgrade` exited 0 on Ctrl-C with no message. A run without a terminal that only plans prints `Plan only: nothing was applied.` and exits 0.
- Rolling back the workspace's own `init` or upgrade is refused while connections exist. The refusal prints the rollback command for each connection.
- Documents the hub shape and `connect` in the README, ONBOARDING (new stage 9, connecting a repository), PRIVACY (what connection records hold, and what `connect` reads), UPGRADING (a v1.3.0 section and the Ctrl-C change), CONTRIBUTING (the Spec Harness re-pin procedure, the `.DS_Store` note and the design decision), ATTRIBUTION, AGENTS and both onboarding skills. Tests check the command and flag names in those documents, the version carriers, the relative and anchor links, the verify line prefixes against the README table, the amended PRIVACY statement, and the stage-9 phrases in `test/onboarding.test.mjs`. They do not check the rest of the prose.
- Version: `VERSION`, `package.json`, the manifest's `templateVersion` and the CLI help move to 1.3.0.

This entry describes source bytes at `v1.3.0`. It does not create or assert a tag or a published release. The repository's Releases page is the authority for tagged archive availability.

## v1.2.0

First use and navigation:

- Adds an installed first-use owner for missing-only personalization, approved artifacts, checked evidence and new-chat continuation. Missing targets are created only by the approved initializer transaction.
- Leads setup with a source-copy choice and one natural-language request, with a concrete separate project-folder example.
- Gives Home distinct first-result and continuation routes, keeps current records with their owners, and places secondary maps below the work.
- Offers the existing supplied-paragraph learning example when undecided and separates the fictional roadmap demonstration from editable work.
- Uses shared AGENTS instructions, thin CLAUDE imports and scoped navigation maps for canonical owners.
- Requires selected-project rules, memory and README before current project facts, and clarifies editable seeds versus managed-file verification drift.
- Adds a conditional ICM maintenance skill from one shared source to both client paths.

ICM method:

- Bundles the `icm-architect` skill by Jake Van Clief, unmodified from upstream commit `e16cafe6a664dcf6d787a726b452adba77d913f4`, with its MIT `LICENSE`, and installs it to `.claude/skills/icm-architect/` and `.agents/skills/icm-architect/`. See [ATTRIBUTION.md](ATTRIBUTION.md).
- Rewrites `second-brain-icm` as local bindings only. The method owner is `icm-architect`; folder routers stay `README.md`; nothing is renamed; material is archived, never deleted; the walk test runs after a structural change. The six-field change contract moves here from the context procedure.
- Returns `context.md` to one job. Its change-contract and maintenance-safeguard sections are replaced by one pointer to `second-brain-icm`, and its recovery read depth now defers to `00-Meta/AGENTS.md`.
- Gives the five loop procedures (capture, close, context, review, learning and scaling) explicit `## Inputs`, `## Outputs` and `## Human check` sections.
- Cuts the five loop skills to a trigger and a pointer to their procedure, so each step has one home.

Design decision, multi-project stamp (recorded as [CONTRIBUTING.md](CONTRIBUTING.md) requires for a multi-project layer):

- Adds `03-Resources/_templates/project/` with the five seed project files, and one line in `01-Projects/README.md`: a new project is a copy of that folder.
- This is template and manifest only. The initializer logic is unchanged, and its complete-plan, exact-digest approval, conflict, receipt and rollback boundaries are untouched. The initializer still seeds one project named `Selected-Project` and does not rename it.

Version: `VERSION`, `package.json` and the manifest's `templateVersion` move to 1.2.0, because tag `v1.1.0` already identifies different bytes.

This entry describes source bytes at `v1.2.0`. It does not create or assert a tag or a published release. The repository's Releases page is the authority for tagged archive availability.

## v1.1.0

- Adds the Node.js `>=22` zero-dependency initializer, verification, three-way upgrade planning, and receipt-scoped rollback for an explicit absolute project target.
- Moves the installable Markdown payload beneath `template/` and adds bounded root loaders plus project-local Claude and Codex skill copies.
- Documents the safe plan/approval workflow and the manual migration path for earlier direct-clone workspaces.

This entry describes source bytes at `v1.1.0`. It does not create or assert a published release. The repository's Releases page is the authority for tagged archive availability.

## v1.0.1

- Repairs stale pre-publication repository and release language after the `v1.0.0` public release.
- Qualifies current Obsidian desktop compatibility because it has not been verified.

This entry describes the source changes in `v1.0.1`. The repository's Releases page is the authority for whether a tagged release archive is available.
