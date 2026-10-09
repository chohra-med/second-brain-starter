# Upgrading the free starter

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
- If you already created `00-Meta/Profile.md` yourself, the plan shows `CONFLICT` for it and the apply is refused. Move your file aside, or keep it outside the workspace, and plan again. The upgrade never overwrites it.

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

`connect` is a separate command. Run it once for each repository you want the workspace to know about. Each run prints its own plan and needs its own digest. [ONBOARDING.md](ONBOARDING.md) stage 9 and [README.md](README.md) describe it.

- A connect receipt covers both the workspace and the repository. Rolling it back removes exactly the files that receipt created, in both folders. It refuses if one of those files changed since, and it removes nothing.
- Files that `/sdd init` writes in the repository afterwards are not in the receipt. Rollback does not remove them.
- `verify` lists each connection with its state and its receipt ID. An interrupted connect makes `verify` exit non-zero, and it prints the rollback command for that connect.
- If you edited a file that an interrupted connect wrote, its rollback stops with `ROLLBACK_FAILED` and keeps the edit. The README Recovery section describes what to do.
- Rolling back the workspace's own `init` or upgrade is refused while connections exist. The refusal prints the rollback command for each connection. Roll those back first.

### The vendored Spec Harness

A pinned copy of Spec Harness ships under `vendor/spec-harness/`. It is not installed into the workspace. `connect` reads it and copies the files it names into a repository you name. No code in `lib` or `bin` starts a process, so the vendored shell scripts are never executed.

### Rolling back an upgrade

Rolling back an upgrade removes that receipt's folder under `.second-brain/backups/`, and it leaves the empty `.second-brain/backups/` folder in place.

## Upgrading to v1.2.0

This version adds managed first-use/navigation files. Upgrade from a baseline-seeded workspace preserves safe personalized seed records. Review the exact new plan and verify afterward; later personalization and artifacts have separate recovery preimages. A failed transaction into a missing target may leave an empty directory. Inspect the receipt and current state, produce a fresh plan and obtain current approval before retrying; do not blindly replay an earlier digest.

It also adds the bundled `icm-architect` skill in both client skill folders and a project template under `03-Resources/_templates/project/`. Managed procedures and skills changed in this version, so read each line of the new plan before approving it.

## Before an initializer upgrade

1. Read [CHANGELOG.md](CHANGELOG.md). A source [VERSION](VERSION) is not proof that a matching archive is published; use the Releases page for publication status.
2. Duplicate your personalized target workspace and label the copy with the date.
3. Get a fresh source root through Git or a published ZIP release. Confirm its `VERSION`, `template-manifest.json`, and Node.js version (`node --version`, Node `>=22`) before applying any update.
4. From the fresh source root, keep the same absolute target path and run:

   ```sh
   node ./bin/second-brain.mjs upgrade --target "$PROJECT"
   ```

   The command prints a complete plan. In a terminal, review it and type the exact plan digest when prompted. In a non-interactive shell it changes nothing unless you rerun the command with `--apply` and that exact digest. That run ends with `Plan only: nothing was applied.`, which is normal and not an error.

## Read the three-way plan

The upgrader compares the previous installed template digest, the current target bytes, and the fresh template digest. It reports the complete path-by-path outcome before writing:

- `IDENTICAL` needs no work.
- `MANAGED-UPDATE` has a safe update path defined by the installed state.
- `CONFLICT` requires manual resolution and prevents application.
- `DEPRECATED` identifies a formerly managed path that needs an explicit decision.

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
