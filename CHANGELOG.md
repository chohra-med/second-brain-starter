# Changelog

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
