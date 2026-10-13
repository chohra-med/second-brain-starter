# Verify, update and roll back

The [README](../README.md) has the short version. This page has what each check compares, what each line means, and how to undo a change.

## What verify compares

Run verification from the source root against the installed target:

```sh
node ./bin/second-brain.mjs verify --target "$PROJECT"
```

Verification reports each managed path and exits nonzero if an installed managed file is missing or has changed.

For `AGENTS.md`, `CLAUDE.md` and `.gitignore`, verify compares only the managed block. Text you add above or below the block passes, with two exceptions that count as damage:

- in `AGENTS.md` and `CLAUDE.md`, an HTML comment that names the tool or is never closed;
- in `.gitignore`, a `#` line shaped like a marker.

A `#` line is shaped like a marker when it starts `# second-brain:` and goes on like a marker name, such as `# second-brain:priv` or `# second-brain:privacy: notes`. Any other `#` line, such as `# my notes: keep`, is your own comment and passes.

Every other managed file is compared whole. Verify does not inspect unrelated project files.

Personalizing these three files makes verify fail when the change is inside the block, and also when the text outside the block is one of the two damage cases: in `AGENTS.md` and `CLAUDE.md`, an HTML comment that names the tool or is never closed; in `.gitignore`, a `#` line shaped like a marker. A change inside the block reports `CORRUPT`, and a damaged or missing marker is reported too.

Verify also lists each connection, if the workspace has any. The connections do not change the exit code. `verify` only reads: it writes nothing in either folder.

Editable seed records are expected to change after setup. Once the v1.1.0 seed policy is installed, verification reports those existing contained records as `PERSONALIZED` and still succeeds. Missing, unsafe, or escaping seed paths still fail.

Personalize editable seed records such as project facts, decisions, roadmap and progress as you work. Those changes remain valid. Personalizing a managed record intentionally creates baseline drift. This includes managed procedures, and a change inside a loader's managed block, so `verify` names that path and exits nonzero. That expected result is not proof of damage: review the named paths against the changes you intended. Do not alter installed state merely to make `verify` green. The one exception is a `NO_RECEIPT` connection, which the recovery section below describes.

## Verify output

`verify` prints one line for each connection:

| Label | Meaning |
|---|---|
| `STAGED` | The harness files connect wrote are present and unchanged. `/sdd init` has not written its receipt yet. |
| `INITIALISED` | The repository has the harness receipt `.claude/agents/.init-synthesis.json`. Connect may have staged files here earlier; this label reads the receipt on disk now. |
| `CHANGED` | Some staged files are missing or differ now. The line gives the count and the first names. You can roll the connection back, or keep the files. |
| `MISSING` | The repository folder is not at the path the connection recorded. |
| `REGISTERED (now: ...)` | The repository has Spec Harness files but no `.claude/agents/.init-synthesis.json` receipt, so connect registered it without writing. The bracket shows what detection finds on disk now: harness present, or no harness files found. |
| `UNREADABLE (...)` | verify could not read the repository safely, for example because its folder is now a symlink. The bracket gives the reason. It needs attention, and it does not change the exit code. |
| `NO_RECEIPT` | The receipt is missing, so the tool cannot roll the connection back. See the recovery section below. |

After the connection lines, one summary line says how many connections need attention, or that all are as recorded. Two more labels can appear:

- `PENDING` names an interrupted connect, or a finished connect whose marker was not cleared, with the command that recovers it. A pending record makes `verify` exit non-zero.
- `RESIDUE` names a leftover temporary file or empty folder from a connect. It is information only, and it does not change the exit code.

The exit code says whether the workspace's own managed files are intact, and whether a pending record exists. A connection in any state other than `PENDING` does not change it.

Most status lines that `verify` can print start with one of these prefixes. The exceptions print as their own code, with no prefix. They include the path-check codes, such as `SYMLINK_PATH` and `NON_REGULAR_FILE`, and `INVALID_STATE`, which reports an installed state file that cannot be parsed or fails its checks. The list is not exhaustive: any error code that `verify` reads from a managed file or from the installed state prints the same way. Explanation lines printed under a `CONNECTION` line are indented by two spaces, such as `  STAGED: ...`, `  To roll the connection back: ...` or `  Next: ...`. They are not status lines and are not in this table.

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

A read error can also print as its own code, such as `SYMLINK_PATH`, `NON_REGULAR_FILE` or `INVALID_STATE`, for a path or installed state that verify cannot read. Each such line makes the exit code 1.

## Empty or damaged root files

An empty installed `AGENTS.md` or `CLAUDE.md` loses its managed block. Measured on this branch:

- `upgrade` stops before it prints any plan. It prints one message that names the damage and the one way out, and exits 1. The plan has no `CONFLICT` line.
- `verify` prints `CORRUPT` for the file, with the same message, and exits 1.

An empty root file with no install record is different. A new `init` plans it as `APPEND`, and the block goes into the empty file.

The way out is in [install and recovery](install-and-recovery.md#repair-a-damaged-loader-or-ignore-file).

## Update

For a later starter version, obtain a fresh source copy first, then run its `upgrade` command against the same target. It prints a complete three-way plan using the installed record, your current bytes, and the new template bytes. As with `init`, an interactive terminal requires the displayed digest. Non-interactive use requires `--apply` with that exact digest. Read [UPGRADING.md](../UPGRADING.md) before upgrading.

## Roll back

If a change goes wrong, stop editing the target. Use the relevant receipt rollback when its preconditions hold, or return to the dated copy made before the update.

Every applied transaction prints a receipt ID and stores its receipt inside the target's `.second-brain` state. A connect prints its receipt ID too. Each `CONNECTION` line of `verify` ends with that ID. To undo only that receipt's writes:

```sh
node ./bin/second-brain.mjs rollback --target "$PROJECT" --receipt RECEIPT_ID
```

The rollback checks that receipt's current preconditions and does not undo unrelated project work.

Rollback of a loader block, measured on this branch:

- **File not edited since the install:** rollback removes the appended block and restores the file byte for byte.
- **File edited after the install, even outside the block:** rollback refuses with `POSTIMAGE_MISMATCH`, exits 1, and removes nothing. The edited file keeps its block.

Rolling back an upgrade removes that receipt's folder under `.second-brain/backups/`, and it leaves the empty `.second-brain/backups/` folder in place. A rollback may also leave other empty folders behind: it removes the files the receipt wrote, and it does not remove the folders that held them.

A connect receipt covers both folders: rolling it back removes exactly the files it created in the workspace and in the repository, and refuses if one of them changed. Keep a dated copy of your target before any migration.

Rolling back the workspace's own `init` or upgrade is refused while connections exist. The refusal prints the rollback command for each connection. Roll those back first.

## Recover a connect

If a connect is interrupted, `verify` lists a `PENDING` line with its receipt ID. Run the rollback command that line prints. When no file was edited, it restores both folders. Recovery never deletes a file whose bytes differ from what the connect wrote. It lists that file, and you decide what to do with it.

If you edited a file that the connect wrote, the rollback stops with `ROLLBACK_FAILED` and exits 1. The edit is kept, and the connect stays `PENDING`, so connect refuses that repository until the file is dealt with. Move the edited file out of the repository, or delete it yourself, then run the same rollback command again. This applies to an interrupted connect. For a completed connect (`STAGED` or `CHANGED`), the same edit is refused with `POSTIMAGE_MISMATCH` instead, which exits 1 and says `Nothing was removed in either root.`

Two leftovers are known and accepted. A stop before any pending record exists can leave an empty `.second-brain/connect-pending/` folder, and at most one temporary engine file in it, in the workspace. The design writes the pending record before any repository file, so this leaves nothing in the repository. `verify` lists this as `RESIDUE`, and the next approved connect, rollback or recovery removes it.

Run one connect at a time per workspace. Two connects at the same time are not supported. In runs measured on this branch after the fix, both finished with exit 0 and both repositories were staged, but only one connection record was kept, so `verify` listed one. The unlisted connection's files stay in place, and its receipt stays in `.second-brain/receipts/`. Rolling back either connection by its receipt ID works, and it removes only that connection's files; this was measured in both orders. `verify` does not show the unlisted connection. There is no lock across processes.

`NO_RECEIPT` is the one state the tool cannot undo, because its receipt is missing and there is nothing to roll back. The only way to make `verify` stop listing that connection is to delete its entry from `.second-brain/connections.json` by hand. That does not delete the staged files in the repository, which stay until you remove them.
