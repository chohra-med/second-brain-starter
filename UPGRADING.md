# Upgrading the free starter

## Upgrading to v1.11.0

This version adds one seed file, updates procedures and two skills, and stops installing the optional `api-anything` skill. It deletes nothing.

Measured on a scratch workspace made by `init` from the v1.10.0 source (no edits), with this branch's `upgrade`: the plan reads `Versions: installed 1.10.0 -> available 1.11.0` and `Summary: 1 CREATE, 16 MANAGED-UPDATE, 3 SEED-UPDATE, 126 IDENTICAL, 4 DEPRECATED`. The new file is `00-Meta/Working-Agreement.md`, yours from the start and never overwritten. The updates are the procedure and skill changes in the changelog; a file you edited is kept or merged as the plan shows.

The four `DEPRECATED` files are the `api-anything` copies under `.claude/skills/` and `.agents/skills/`. The upgrade leaves them in place, your client still loads that skill, and `verify` and `upgrade` no longer manage them. To remove it, delete `.claude/skills/api-anything/` and `.agents/skills/api-anything/`; deleting them before the upgrade works too. To keep it on purpose, read `template/optional-skills/api-anything/SKILL.md` and [ATTRIBUTION.md](ATTRIBUTION.md) first.

A repository you connect from now on gets Spec Harness 0.7.0: 122 files and 52 folders instead of 114 and 46, with the edit guard executable and registered in `.claude/settings.local.json`. A repository connected earlier keeps its harness; update it with the harness's own `spec-harness update`.

## Upgrading to v1.10.0

This version adds three shared skills, `next-session`, `verify-end-session` and `harness-session`. Nothing in it changes or deletes a file you already have.

Measured on a scratch workspace made by `init` from the v1.9.0 source (no edits), with this branch's `upgrade`: the plan reads `Versions: installed 1.9.0 -> available 1.10.0` and `Summary: 8 CREATE, 141 IDENTICAL`. The eight new files are `SKILL.md` for each of the three skills, under both `.agents/skills/` and `.claude/skills/`, plus `03-Resources/Procedures/verify-end-session.md` and `03-Resources/Procedures/harness-session.md`. There is nothing to update or merge. `handover` is unchanged and still works; `next-session` reads the same procedure.

## Upgrading to v1.9.0

This version adds two shared skills, `today` and `context`. Nothing in it changes or deletes a file you already have.

Measured on a scratch workspace made by `init` from the v1.8.0 source (no edits), with this branch's `upgrade`: the plan reads `Versions: installed 1.8.0 -> available 1.9.0` and `Summary: 5 CREATE, 136 IDENTICAL`. The five new files are `SKILL.md` for `today` and for `context`, each under both `.agents/skills/` and `.claude/skills/`, plus `03-Resources/Procedures/today.md`. There is nothing to update or merge. `context-modes` is unchanged and still works.

## Upgrading to v1.8.0

This version adds two shared skills, `handover` and `api-anything`, and changes the vendored Spec Harness. Nothing in it changes or deletes a file you already have.

Measured on a scratch workspace made by `init` from the v1.7.1 source (no edits), with this branch's `upgrade`: the plan reads `Versions: installed 1.7.1 -> available 1.8.0` and `Summary: 7 CREATE, 129 IDENTICAL`. The seven new files are `SKILL.md` and `LICENSE` for `api-anything` and `SKILL.md` for `handover`, each under both `.agents/skills/` and `.claude/skills/`, plus `03-Resources/Procedures/handover.md`. There is nothing to update or merge. A handover note is saved to `00-Meta/Handovers/` the first time you approve one.

What else changes is what `connect` stages into a repository you connect from now on: Spec Harness 0.6.0 instead of 0.5.0, which is 114 files and 46 folders instead of 96 and 43. `upgrade` does not touch a repository you connected earlier, and this release did not measure moving one to 0.6.0; Spec Harness's own `update` command is the route for that.

## Upgrading to v1.7.1

This version adds a Demo section to the `scroll-story-component` skill. Nothing is created, merged or deleted.

Measured on a scratch workspace made by `init` from the v1.7.0 source (no edits), with this branch's `upgrade`: the plan reads `Versions: installed 1.7.0 -> available 1.7.1` and `Summary: 2 MANAGED-UPDATE, 127 IDENTICAL`. The two updates are the skill's `SKILL.md` in `.agents/skills/` and `.claude/skills/`. After the approved apply, `verify` reports `Verification: OK`. If you edited that `SKILL.md`, the plan shows it as a merge or a kept file instead.

## Upgrading to v1.7.0

This version adds one shared skill, `scroll-story-component`. Nothing is updated, merged or deleted.

Measured on a scratch workspace made by `init` from the v1.6.0 source (no edits), with this branch's `upgrade`: the plan reads `Versions: installed 1.6.0 -> available 1.7.0` and `Summary: 14 CREATE, 115 IDENTICAL`. The 14 new files are the skill's seven files (`SKILL.md`, four references and two assets) in both `.agents/skills/` and `.claude/skills/`. After the approved apply, `verify` reports `Verification: OK`.

The skill's `assets/scroll-story.tsx` is a React file for a website. The upgrade only writes it into the skill folder; it is copied into a site only when you ask an assistant to add a scroll story there.

## Upgrading to v1.6.0

This version changes the vendored Spec Harness, not the workspace template. Your workspace files do not change.

Measured on a scratch workspace made by `init` from the v1.5.0 source (no edits), with this branch's `upgrade`: the plan reads `Versions: installed 1.5.0 -> available 1.6.0` and `Summary: 115 IDENTICAL`. There is nothing to create, update or merge, and nothing is deleted.

What changes is what `connect` stages into a repository you connect from now on: Spec Harness 0.5.0 instead of 0.4.0, which is 96 files instead of 95 (the new `sdd-router` role). `upgrade` does not touch a repository you connected earlier, and this release did not measure moving one to 0.5.0; Spec Harness's own `update` command is the route for that.

## Upgrading to v1.5.0

This version adds one shared skill, `usage-dashboard`, and changes how an upgrade treats a file you have edited. Nothing in it deletes a file. Read the plan line by line before you approve it. From this release, `Home.md`, `01-Projects/README.md` and `01-Projects/Index.md` are seed files, which are yours to edit, and so are the two `usage-prices.json` files.

The plan lines below were printed by this branch's `upgrade` against scratch installs made from each release's own source tree, with that tree's `init`. The lines are copied from the plan. The `Target`, `Privacy`, `Base snapshots`, digest and apply lines, and the `IDENTICAL` lines, are not listed.

### What a v1.4.1 install sees

The install was made from `main` at 1.4.1 (commit `01d0144`), with no edits. The plan has 7 `CREATE`, 17 `MANAGED-UPDATE`, 2 `SEED-UPDATE` and 89 `IDENTICAL` lines.

```text
Versions: installed 1.4.1 -> available 1.5.0
MANAGED-UPDATE	.agents/skills/second-brain-capture/SKILL.md	undo=restore-preimage
MANAGED-UPDATE	.agents/skills/second-brain-close/SKILL.md	undo=restore-preimage
MANAGED-UPDATE	.agents/skills/second-brain-context/SKILL.md	undo=restore-preimage
MANAGED-UPDATE	.agents/skills/second-brain-review/SKILL.md	undo=restore-preimage
CREATE	.agents/skills/usage-dashboard/SKILL.md	undo=remove-created-file
CREATE	.agents/skills/usage-dashboard/usage-dashboard.mjs	undo=remove-created-file
CREATE	.agents/skills/usage-dashboard/usage-prices.json	undo=remove-created-file
MANAGED-UPDATE	.claude/skills/second-brain-capture/SKILL.md	undo=restore-preimage
MANAGED-UPDATE	.claude/skills/second-brain-close/SKILL.md	undo=restore-preimage
MANAGED-UPDATE	.claude/skills/second-brain-context/SKILL.md	undo=restore-preimage
MANAGED-UPDATE	.claude/skills/second-brain-review/SKILL.md	undo=restore-preimage
CREATE	.claude/skills/usage-dashboard/SKILL.md	undo=remove-created-file
CREATE	.claude/skills/usage-dashboard/usage-dashboard.mjs	undo=remove-created-file
CREATE	.claude/skills/usage-dashboard/usage-prices.json	undo=remove-created-file
MANAGED-UPDATE	00-Meta/AGENTS.md	undo=restore-preimage
SEED-UPDATE	00-Meta/Daily-Task-Plan.md	undo=restore-preimage
SEED-UPDATE	00-Meta/Profile.md	undo=restore-preimage
CREATE	01-Projects/Index.md	undo=remove-created-file
MANAGED-UPDATE	01-Projects/README.md	undo=restore-preimage
MANAGED-UPDATE	03-Resources/Procedures/capture.md	undo=restore-preimage
MANAGED-UPDATE	03-Resources/Procedures/close.md	undo=restore-preimage
MANAGED-UPDATE	03-Resources/Procedures/context.md	undo=restore-preimage
MANAGED-UPDATE	03-Resources/Procedures/first-use.md	undo=restore-preimage
MANAGED-UPDATE	03-Resources/Procedures/review.md	undo=restore-preimage
MANAGED-UPDATE	04-Archives/Projects/Archive-Guide.md	undo=restore-preimage
MANAGED-UPDATE	Home.md	undo=restore-preimage
Summary: 7 CREATE, 17 MANAGED-UPDATE, 2 SEED-UPDATE, 89 IDENTICAL
```

- The `CREATE` lines are the `usage-dashboard` skill in each skill folder, and `01-Projects/Index.md`, the project index.
- `Home.md` and `01-Projects/README.md` show `MANAGED-UPDATE`, because you have not edited them. The upgrade replaces each one with the new template. From the next upgrade on, they are seed files, so an edit you make is merged or kept.
- `00-Meta/Profile.md` and `00-Meta/Daily-Task-Plan.md` show `SEED-UPDATE`, because they are unedited. An edited seed is never overwritten.
- `usage-prices.json` is a seed file in both skill folders. An install made from this version writes it once. An unedited copy under an unchanged template shows `IDENTICAL`. An edited copy shows `PERSONALIZED`, and a later template change reaches an unedited copy as `SEED-UPDATE`. An upgrade does not overwrite your copy.

### What a v1.4.0 install sees

The install was made from tag `v1.4.0` (commit `3f2e899`), with that tree's `init`. Before the plan, one line was added to `Home.md` and one to `00-Meta/Profile.md`, so the plan shows what an edited install gets.

```text
Versions: installed 1.4.0 -> available 1.5.0
CREATE	.agents/skills/context-modes/SKILL.md	undo=remove-created-file
CREATE	.agents/skills/end-session/SKILL.md	undo=remove-created-file
MANAGED-UPDATE	.agents/skills/second-brain-capture/SKILL.md	undo=restore-preimage
MANAGED-UPDATE	.agents/skills/second-brain-close/SKILL.md	undo=restore-preimage
MANAGED-UPDATE	.agents/skills/second-brain-context/SKILL.md	undo=restore-preimage
MANAGED-UPDATE	.agents/skills/second-brain-review/SKILL.md	undo=restore-preimage
CREATE	.agents/skills/usage-dashboard/SKILL.md	undo=remove-created-file
CREATE	.agents/skills/usage-dashboard/usage-dashboard.mjs	undo=remove-created-file
CREATE	.agents/skills/usage-dashboard/usage-prices.json	undo=remove-created-file
CREATE	.claude/skills/context-modes/SKILL.md	undo=remove-created-file
CREATE	.claude/skills/end-session/SKILL.md	undo=remove-created-file
MANAGED-UPDATE	.claude/skills/second-brain-capture/SKILL.md	undo=restore-preimage
MANAGED-UPDATE	.claude/skills/second-brain-close/SKILL.md	undo=restore-preimage
MANAGED-UPDATE	.claude/skills/second-brain-context/SKILL.md	undo=restore-preimage
MANAGED-UPDATE	.claude/skills/second-brain-review/SKILL.md	undo=restore-preimage
CREATE	.claude/skills/usage-dashboard/SKILL.md	undo=remove-created-file
CREATE	.claude/skills/usage-dashboard/usage-dashboard.mjs	undo=remove-created-file
CREATE	.claude/skills/usage-dashboard/usage-prices.json	undo=remove-created-file
MANAGED-UPDATE	00-Meta/AGENTS.md	undo=restore-preimage
SEED-UPDATE	00-Meta/Daily-Task-Plan.md	undo=restore-preimage
PERSONALIZED	00-Meta/Profile.md	undo=none
CREATE	01-Projects/Index.md	undo=remove-created-file
MANAGED-UPDATE	01-Projects/README.md	undo=restore-preimage
MANAGED-UPDATE	03-Resources/Procedures/capture.md	undo=restore-preimage
MANAGED-UPDATE	03-Resources/Procedures/close.md	undo=restore-preimage
CREATE	03-Resources/Procedures/context-modes.md	undo=remove-created-file
MANAGED-UPDATE	03-Resources/Procedures/context.md	undo=restore-preimage
CREATE	03-Resources/Procedures/end-session.md	undo=remove-created-file
MANAGED-UPDATE	03-Resources/Procedures/first-use.md	undo=restore-preimage
MANAGED-UPDATE	03-Resources/Procedures/review.md	undo=restore-preimage
MANAGED-UPDATE	04-Archives/Projects/Archive-Guide.md	undo=restore-preimage
MERGE	Home.md	undo=restore-preimage
Summary: 13 CREATE, 16 MANAGED-UPDATE, 1 SEED-UPDATE, 1 MERGE, 1 PERSONALIZED, 83 IDENTICAL
Merged: Home.md keeps your edits and takes the template's non-overlapping changes; undo restores your current bytes.
Proposal: 00-Meta/Profile.md is yours from this release and is kept as it is. The template's changes are offered, optionally, in .second-brain/merge/1.5.0/00-Meta/Profile.md.proposed, which the approved apply writes.
```

- `Home.md` shows `MERGE`. Your added line stays, and the template's two changed lines are written in. Undo restores your bytes.
- If your edit had changed the same line the template changed, the plan would show `PERSONALIZED` for `Home.md`, and the template's version would be offered in `.second-brain/merge/1.5.0/Home.md.proposed`. A scratch copy with that overlapping edit gave `PERSONALIZED	Home.md` and a `Proposal:` line that says the file "is yours from this release and is kept as it is."
- `00-Meta/Profile.md` shows `PERSONALIZED`. It is a seed, so your bytes stay, and the template's version is offered in `.second-brain/merge/1.5.0/00-Meta/Profile.md.proposed`. The approved apply writes that file. To read a seed proposal, see [Read a seed proposal](docs/verify-update-rollback.md#read-a-seed-proposal).
- After `upgrade --apply` with the exact plan digest, `verify` printed `Verification: OK` and exited 0. It lists the seed files as `PERSONALIZED`, edited or not. That status describes a seed you own. It is a normal result.

### What a v1.2.0 install sees

The install was made from commit `6fc244e`, which has no `00-Meta/Profile.md`. The same two lines were added to `Home.md` and `00-Meta/Profile.md`, so `Profile.md` is a file you already have at a new seed path. The plan summary is:

```text
Versions: installed 1.2.0 -> available 1.5.0
Summary: 40 CREATE, 18 MANAGED-UPDATE, 1 SEED-UPDATE, 1 MERGE, 1 PERSONALIZED, 54 IDENTICAL
```

- `00-Meta/Profile.md` shows `PERSONALIZED`. Your file is kept, and the template's version is offered under `.second-brain/merge/1.5.0/`. Earlier versions refused the apply in this case.
- `Home.md` shows `MERGE`, as it does for a 1.4.0 install.

### Before this upgrade

Until you apply this upgrade, `verify` run from the v1.5.0 source exits 1. Measured on a 1.4.1 install, it reports `SOURCE_MANIFEST_MISMATCH` for the installed state, and an `UNMANAGED` line for each of the seven new files: the six `usage-dashboard` files and `01-Projects/Index.md`. Those lines go away after the upgrade.

### Rolling back this upgrade

Rolling back this upgrade removes the files it created, restores the files it changed, and removes any seed proposal it wrote. Measured on a 1.4.0 copy: the apply wrote `.second-brain/merge/1.5.0/00-Meta/Profile.md.proposed`, `rollback --receipt` printed `ROLLED_BACK` for that path, and no `.second-brain/merge` folder was left. After a rollback the workspace is on its earlier version again, so `verify` run from this 1.5.0 copy reports `SOURCE_MANIFEST_MISMATCH`, as it does before the upgrade. Run `verify` from the copy you installed with to check the rolled-back workspace: measured on a 1.4.1 copy, it printed `Verification: OK`.

## Upgrading to v1.4.1

This version adds two procedures and their shared skills. No existing installed file changes. The new files are the two procedure files and the skill files in `.agents/skills/` and `.claude/skills/`.

### What a v1.4.0 install sees

Until it runs `upgrade`, `verify` reports `SOURCE_MANIFEST_MISMATCH` on the installed state file. The source manifest changed, and the state still records the v1.4.0 manifest. Run `upgrade`, then read and approve its plan as described in [Read the three-way plan](#read-the-three-way-plan).

## Upgrading to v1.4.0

This version adds one managed file, `.gitignore`, and it changes how a root `AGENTS.md` or `CLAUDE.md` with no loader markers is handled.

### What a v1.3.0 install sees

The lines below are from a real upgrade. The v1.3.0 install was made from `main` at `7d46fe6`, with that tree's `init`. This branch's `upgrade` planned it, and the plan had 27 `CREATE`, 6 `MANAGED-UPDATE`, 2 `PERSONALIZED` and 67 `IDENTICAL` lines. The plan has no `CONFLICT` and no `DEPRECATED` line. The `IDENTICAL` lines are not listed.

```text
CREATE	.agents/skills/graphify/SKILL.md	undo=remove-created-file
CREATE	.agents/skills/grill-me/SKILL.md	undo=remove-created-file
CREATE	.agents/skills/humanizer/evals/evals.json	undo=remove-created-file
CREATE	.agents/skills/humanizer/LICENSE	undo=remove-created-file
CREATE	.agents/skills/humanizer/README.md	undo=remove-created-file
CREATE	.agents/skills/humanizer/references/always-on-templates.md	undo=remove-created-file
CREATE	.agents/skills/humanizer/references/patterns.md	undo=remove-created-file
CREATE	.agents/skills/humanizer/references/patterns.zh.md	undo=remove-created-file
CREATE	.agents/skills/humanizer/SKILL.md	undo=remove-created-file
CREATE	.agents/skills/readme-generator/SKILL.md	undo=remove-created-file
CREATE	.agents/skills/writing-skills/SKILL.md	undo=remove-created-file
CREATE	.claude/skills/graphify/SKILL.md	undo=remove-created-file
CREATE	.claude/skills/grill-me/SKILL.md	undo=remove-created-file
CREATE	.claude/skills/humanizer/evals/evals.json	undo=remove-created-file
CREATE	.claude/skills/humanizer/LICENSE	undo=remove-created-file
CREATE	.claude/skills/humanizer/README.md	undo=remove-created-file
CREATE	.claude/skills/humanizer/references/always-on-templates.md	undo=remove-created-file
CREATE	.claude/skills/humanizer/references/patterns.md	undo=remove-created-file
CREATE	.claude/skills/humanizer/references/patterns.zh.md	undo=remove-created-file
CREATE	.claude/skills/humanizer/SKILL.md	undo=remove-created-file
CREATE	.claude/skills/readme-generator/SKILL.md	undo=remove-created-file
CREATE	.claude/skills/writing-skills/SKILL.md	undo=remove-created-file
CREATE	.gitignore	undo=remove-created-file
PERSONALIZED	00-Meta/Daily-Task-Plan.md	undo=none
PERSONALIZED	00-Meta/Profile.md	undo=none
MANAGED-UPDATE	00-Meta/README.md	undo=restore-preimage
CREATE	03-Resources/Procedures/complete-init.md	undo=remove-created-file
MANAGED-UPDATE	03-Resources/Procedures/first-use.md	undo=restore-preimage
CREATE	03-Resources/Procedures/init.md	undo=remove-created-file
CREATE	03-Resources/Procedures/quick-start.md	undo=remove-created-file
MANAGED-UPDATE	03-Resources/Procedures/README.md	undo=restore-preimage
MANAGED-UPDATE	03-Resources/Procedures/review.md	undo=restore-preimage
CREATE	03-Resources/Procedures/showcase-readme.md	undo=remove-created-file
MANAGED-UPDATE	04-Archives/Projects/Archive-Guide.md	undo=restore-preimage
MANAGED-UPDATE	Home.md	undo=restore-preimage
```

After `upgrade --apply` with the exact plan digest, `verify` printed `Verification: OK` and exited 0.

- An upgrade adds one plan line. If the workspace has no `.gitignore`, the plan shows `CREATE .gitignore`. If it has one, the plan shows `APPEND .gitignore`. Your lines stay in front of the block.
- The block makes git ignore `.second-brain/`, the notes in `05-Daily/` (the shipped `05-Daily/daily-template.md` stays tracked), `00-Meta/Profile.md`, `00-Meta/Daily-Task-Plan.md` and `01-Projects/**/Connection.md`. To keep one of those paths in version control, leave the block alone and add an exception line (`!path`) below it, for example `!00-Meta/Profile.md`. Do not delete the block: `upgrade` and `verify` need it. A clone of your workspace made with git will not contain `00-Meta/Profile.md` or `00-Meta/Daily-Task-Plan.md`, so the links to them on Home will not resolve in that clone until you add an exception line or copy the files.
- A root `AGENTS.md` or `CLAUDE.md` with your text and no markers now shows `APPEND` instead of `CONFLICT`, when this tool has no install record for that file. An installed file whose markers were removed still shows `CONFLICT`. A broken comment in one of these files shows `CONFLICT` in the plan, and the apply is refused: a comment that is never closed, or a comment that names the tool and is not the one clean managed block. A plain sentence that names the tool does not. A root `AGENTS.md`, `CLAUDE.md` or `.gitignore` that is not UTF-8 text (it has a null byte, or starts with a UTF-16 or UTF-32 byte-order mark) shows `CONFLICT` in the plan, and the apply is refused: convert it to UTF-8 first. An installed file with a missing marker line, or with its whole block gone, shows `CONFLICT` in the plan, the apply is refused with `PLAN_CONFLICT`, and `verify` fails. An installed file that is empty stops the upgrade before any plan is printed. The plan names the damage and the one way out: put back the missing marker line exactly as shipped, or paste the whole shipped file from the starter copy, keeping your own text. [Install and recovery](docs/install-and-recovery.md#repair-a-damaged-loader-or-ignore-file) lists each case. Only you can restore them. The tool cannot recognise every possible damage, so read the plan before you approve it. Rollback of a file you have not edited since the install removes the appended block and restores the file byte for byte. If you edited the file after the install, even outside the block, rollback refuses with `POSTIMAGE_MISMATCH`, exits 1 and removes nothing.
- This change adds five skills (`grill-me`, `readme-generator`, `graphify`, `writing-skills` and `humanizer`) and one procedure, `03-Resources/Procedures/showcase-readme.md`. An upgrade from v1.3.0 shows their 11 skill files as 22 `CREATE` lines, one in each of `.agents/skills/` and `.claude/skills/`, plus the procedure's `CREATE` line. It shows `03-Resources/Procedures/README.md` as `MANAGED-UPDATE` because its list gained the new procedure. No existing file is removed.
- This change adds three managed procedures, `03-Resources/Procedures/quick-start.md`, `init.md` and `complete-init.md`. Each one shows as `CREATE` in the plan.
- It changes three managed files, which show as `MANAGED-UPDATE`: `Home.md` (a new first section, "Start here"), `03-Resources/Procedures/first-use.md` (its Profile section now points to `init.md` and `complete-init.md`) and `03-Resources/Procedures/README.md` (the index lists the three ways). `00-Meta/Profile.md` is a seed file, not a managed file. An existing install keeps its file, and the plan shows `PERSONALIZED` for it, even if you never edited it. The new seed text reaches new installs only. A `00-Meta/Profile.md` that you already filled in is kept as it is.
- In this version, if you edited `Home.md` or `03-Resources/Procedures/first-use.md` by hand, the plan showed `CONFLICT` for that file, and the upgrade was refused. Move your copy aside, or keep your edits outside the workspace, and plan again. The upgrade never overwrites a file you changed. From 1.5.0, `Home.md` is a seed file and an edit to it is merged or kept: see [Upgrading to v1.5.0](#upgrading-to-v150).
- An install made from an unreleased build that had a `skill-creator` folder shows those files as `DEPRECATED` on upgrade. Nothing is deleted. Those files are unchanged since that install, so you may delete them by hand if you do not want them; the tool does not delete them for you.
- This change edits three managed files, which show as `MANAGED-UPDATE` on upgrade: `00-Meta/README.md` (a new section, "Keeping it clean"), `03-Resources/Procedures/review.md` (one new step) and `04-Archives/Projects/Archive-Guide.md` (a sentence on never deleting). `00-Meta/Daily-Task-Plan.md` is a seed file, so its new task-line examples reach new installs only; an existing install keeps its file and shows `PERSONALIZED`. Your own edits to the three managed files make the plan show `CONFLICT`, as for any managed file.

## Upgrading to v1.3.0

Before you upgrade, make the dated copy described in [Before an initializer upgrade](#before-an-initializer-upgrade). This version adds the `connect` command, which registers one repository you name with a workspace, and a Profile interview that fills the `00-Meta/Profile.md` seed. Both are optional. An existing install keeps its files and its records. Nothing in this version forces a move to the hub shape.

### What an installed v1.2.0 workspace sees

The plan below is what this version prints when it upgrades a real v1.2.0 install. That install was created by the v1.2.0 CLI from commit `6fc244e`. The other 69 lines of the plan are `IDENTICAL`. The plan has no `CONFLICT` and no `DEPRECATED` line.

```text
MANAGED-UPDATE	00-Meta/AGENTS.md	undo=restore-preimage
CREATE	00-Meta/Profile.md	undo=remove-created-file
MANAGED-UPDATE	01-Projects/README.md	undo=restore-preimage
MANAGED-UPDATE	03-Resources/Procedures/context.md	undo=restore-preimage
MANAGED-UPDATE	03-Resources/Procedures/first-use.md	undo=restore-preimage
MANAGED-UPDATE	Home.md	undo=restore-preimage
```

- `CREATE 00-Meta/Profile.md` adds the Profile seed. The Profile interview fills it under the same exact-plan approval as your other records.
- The five `MANAGED-UPDATE` lines are managed files whose wording changed for the hub shape. Your records are not in this list.
- If you already created `00-Meta/Profile.md` yourself, this version's plan showed `CONFLICT` for it and refused the apply. Move your file aside, or keep it outside the workspace, and plan again. The upgrade never overwrites it. From 1.5.0 that file is yours: the plan shows `PERSONALIZED` and offers the template's version as a proposal, see [Upgrading to v1.5.0](#upgrading-to-v150).

Until you upgrade, `verify` run from the 1.3.0 source reports `SOURCE_MANIFEST_MISMATCH` and also `UNMANAGED 00-Meta/Profile.md`, and it exits non-zero. Measured on a copy of the real v1.2.0 install, before the upgrade:

```text
UNMANAGED	00-Meta/Profile.md
SOURCE_MANIFEST_MISMATCH	.second-brain/installed-state.json	Installed state was created from a different source manifest: .second-brain/installed-state.json
UNMANAGED	00-Meta/Profile.md	Installed state does not manage 00-Meta/Profile.md
Verification: FAILED
```

After the upgrade is applied, `verify` prints `Verification: OK` and exits 0.

### Approval prompt and exit codes

`init`, `upgrade` and `connect` all print the exact apply command after the plan digest. Pressing Enter (empty input) at the approval prompt exits 0 for all three commands, printing `Plan not applied.`. Ctrl-C or end of input at the approval prompt exits 1 with `Plan not applied.` for all three commands. Before this version, `init` and `upgrade` exited 0 on Ctrl-C with no message, so that exit code is the one change. A run without a terminal prints `Plan only: nothing was applied.` and exits 0; that line is the normal end of a plan-only run.

### connect is optional

`connect` is a separate command. Run it once for each repository you want the workspace to know about. Each run prints its own plan and needs its own digest. [ONBOARDING.md](ONBOARDING.md) stage 9 and [README.md](README.md) and [connect a repository](docs/connect-a-repository.md) describe it.

- A connect receipt covers both the workspace and the repository. Rolling it back removes exactly the files that receipt created, in both folders. It refuses if one of those files changed since, and it removes nothing.
- Files that `/sdd init` writes in the repository afterwards are not in the receipt. Rollback does not remove them.
- `verify` lists each connection with its state and its receipt ID. An interrupted connect makes `verify` exit non-zero, and it prints the rollback command for that connect.
- If you edited a file that an interrupted connect wrote, its rollback stops with `ROLLBACK_FAILED` and keeps the edit. For a completed connect (`STAGED` or `CHANGED`), the same edit is refused with `POSTIMAGE_MISMATCH` instead, and the refusal says `Nothing was removed in either root.` [Verify, update and roll back](docs/verify-update-rollback.md#recover-a-connect) describes what to do.
- Rolling back the workspace's own `init` or upgrade is refused while connections exist. The refusal prints the rollback command for each connection. Roll those back first.

### The vendored Spec Harness

A pinned copy of Spec Harness ships under `vendor/spec-harness/`. It is not installed into the workspace. `connect` reads it and copies the files it names into a repository you name. No code in `lib` or `bin` starts a process, so the vendored shell scripts are never executed.

### Rolling back an upgrade

Rolling back an upgrade removes that receipt's folder under `.second-brain/backups/`, and it leaves the empty `.second-brain/backups/` folder in place. A rollback may also leave other empty folders behind: it removes the files the receipt wrote, and it does not remove the folders that held them.

## Upgrading to v1.2.0

This version adds managed first-use/navigation files. Upgrade from a baseline-seeded workspace preserves safe personalized seed records. Review the exact new plan and verify afterward; later personalization and artifacts have separate recovery preimages. A failed transaction into a missing target may leave an empty directory. Inspect the receipt and current state, produce a fresh plan and obtain current approval before retrying; do not blindly replay an earlier digest.

It also adds the bundled `icm-architect` skill in both client skill folders and a project template under `03-Resources/_templates/project/`. Managed procedures and skills changed in this version, so read each line of the new plan before approving it.

## Before an initializer upgrade

1. Read [CHANGELOG.md](CHANGELOG.md). A source [VERSION](VERSION) is not proof that a matching archive is published; use the Releases page for publication status.
2. Duplicate your personalized target workspace and label the copy with the date.
3. Get a fresh source root by cloning the repository, or by downloading and extracting the latest release ZIP from [Releases](https://github.com/chohra-med/second-brain-starter/releases). Releases from v1.3.0 onward contain `connect`. Confirm its `VERSION`, `template-manifest.json`, and Node.js version (`node --version`, Node `>=22`) before applying any update.
4. From the fresh source root, keep the same absolute target path and run:

   ```sh
   node ./bin/second-brain.mjs upgrade --target "$PROJECT"
   ```

   The command prints a complete plan. In a terminal, review it and type the exact plan digest when prompted. In a non-interactive shell it changes nothing unless you rerun the command with `--apply` and that exact digest. That run ends with `Plan only: nothing was applied.`, which is normal and not an error.

## Read the three-way plan

The upgrader compares the bytes you have, the template bytes the install recorded when it last wrote each file, and this release's template. It reports the complete path-by-path outcome before writing:

- `IDENTICAL` needs no work.
- `CREATE` adds a file that is not there yet.
- `APPEND` adds the managed block after your own bytes in a root `AGENTS.md` or `CLAUDE.md` that has no loader markers and no install record. Your bytes stay in front of the block.
- `MANAGED-UPDATE` replaces an unedited managed file with the new template.
- `SEED-UPDATE` replaces an unedited seed file with the new template.
- `CUSTOMIZED-KEEP` keeps your edit to a managed file that the template did not change. The approved apply records your current bytes as accepted, as `verify --adopt` does, and the plan prints a `Kept:` line for each one.
- `MERGE` writes your edits together with the template's changes, when they do not overlap.
- `PERSONALIZED` keeps your seed file as it is. When the template changed, the template's version is offered as a proposal under `.second-brain/merge/<template version>/`, and the approved apply writes it. An existing file at that path is never overwritten.
- `CONFLICT` requires manual resolution and prevents application.
- `DEPRECATED` identifies a formerly managed path that needs an explicit decision.

Merging is line by line, as git does. An edit you made and a change the template made to the same line, or to lines directly next to each other, is a `CONFLICT`. Two edits with at least one unchanged line between them merge. This release has no word-by-word merge. A file that is not UTF-8 text is a `CONFLICT` with no proposal, and the plan prints `Manual resolution required`. A CRLF file merges in its own line endings.

A plan writes nothing. To print the proposal for a `CONFLICT` file, run `upgrade --proposal PATH`, then resolve it as described in [Resolve a CONFLICT](docs/verify-update-rollback.md#resolve-a-conflict). The plan digest covers these writes, so an approval from a plan made by an earlier build does not match. Plan again and approve the new digest.

Your facts, decisions, roadmap, progress, and daily notes are still your records. Once the v1.1.0 seed policy is installed, an existing safe seed record is reported as `PERSONALIZED` and preserved through upgrade. That status is not proof of damage. Do not treat the initializer as a blanket overwrite. There is no V1 `--force` option.

After an applied upgrade, run:

```sh
node ./bin/second-brain.mjs verify --target "$PROJECT"
```

Keep the receipt ID printed by the applied command. If you need to undo only that transaction, use:

```sh
node ./bin/second-brain.mjs rollback --target "$PROJECT" --receipt RECEIPT_ID
```

## Migrating a v1.0.x direct-clone workspace

Earlier direct-clone workspaces have no `.second-brain` installed-state record. This version does not silently adopt or overwrite them.

1. Keep the direct clone unchanged as your historical base and create a dated backup of your working copy.
2. Create a separate empty target directory and initialize it from this version's source root.
3. Compare the old working copy with the new target. Manually transfer only the records you intend to keep: facts, decisions, roadmap, progress, daily notes, and any deliberately customized procedures.
4. Resolve any root `AGENTS.md` or `CLAUDE.md` instructions manually. Preserve project-specific rules outside the initializer's compatible managed block.
5. Run `verify` against the new target, then review every named managed path. Existing safe seed records are reported as `PERSONALIZED` and preserved; copied personalized managed records intentionally make baseline `verify` non-green. Neither result adopts or overwrites your records. Open the installed `Home.md` and complete one first-loop item before retiring the old working copy.

Plain Markdown remains readable in any text editor; current Obsidian desktop compatibility has not been verified.

There are no automatic migrations or automatic overwrites in this starter.
