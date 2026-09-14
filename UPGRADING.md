# Upgrading the free starter

## Before an initializer upgrade

1. Read [CHANGELOG.md](CHANGELOG.md). A source [VERSION](VERSION) is not proof that a matching archive is published; use the Releases page for publication status.
2. Duplicate your personalized target workspace and label the copy with the date.
3. Get a fresh source root through Git or a published ZIP release. Confirm its `VERSION`, `template-manifest.json`, and Node.js version (`node --version`, Node `>=22`) before applying any update.
4. From the fresh source root, keep the same absolute target path and run:

   ```sh
   node ./bin/second-brain.mjs upgrade --target "$PROJECT"
   ```

   The command prints a complete plan. In a terminal, review it and type the exact plan digest when prompted. In a non-interactive shell it changes nothing unless you rerun the command with `--apply` and that exact digest.

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

Earlier direct-clone workspaces have no `.second-brain` installed-state record. V1.1.0 does not silently adopt or overwrite them.

1. Keep the direct clone unchanged as your historical base and create a dated backup of your working copy.
2. Create a separate empty target directory and initialize it from the v1.1.0 source root.
3. Compare the old working copy with the new target. Manually transfer only the records you intend to keep: facts, decisions, roadmap, progress, daily notes, and any deliberately customized procedures.
4. Resolve any root `AGENTS.md` or `CLAUDE.md` instructions manually. Preserve project-specific rules outside the initializer's compatible managed block.
5. Run `verify` against the new target, then review every named managed path. Existing safe seed records are reported as `PERSONALIZED` and preserved; copied personalized managed records intentionally make baseline `verify` non-green. Neither result adopts or overwrites your records. Open the installed `Home.md` and complete one first-loop item before retiring the old working copy.

Plain Markdown remains readable in any text editor; current Obsidian desktop compatibility has not been verified.

There are no automatic migrations or automatic overwrites in this starter.
