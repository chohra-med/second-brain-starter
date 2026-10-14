# Connect a repository

`connect` registers one repository you name with the workspace you set up. It does not search for repositories. Run it once for each repository, from the starter copy:

```sh
node ./bin/second-brain.mjs connect --target "$PROJECT" --repo "$REPOSITORY"
```

Add `--name NAME` when you want a folder name other than the repository's own. The `Connection.md` record holds the repository path and the remote. A remote the parser does not recognise is recorded as `unknown`. The name becomes the folder `01-Projects/NAME/` in the workspace. If the default name cannot be used, the refusal says so and asks for `--name`.

## Find the repositories to connect

To list the repositories in one folder, run `workspace-plan` against it. It reads that one folder and writes nothing:

```sh
node ./bin/second-brain.mjs workspace-plan --parent /absolute/folder
node ./bin/second-brain.mjs workspace-plan --parent /absolute/folder --list-projects
```

It proposes `<parent>/Second Brain` and lists each direct child folder that holds a real `.git` folder, with a ready `connect` command for each. Symbolic links, nested folders and files are not listed. `--list-projects` prints only the repository paths.

## Read the plan

The command prints one plan for both folders and writes nothing. Without `--apply`, it is read-only in both folders. Read these lines first:

- `CREATE` lines are files and folders that connect will write: the connection folder and its `Connection.md` record in the workspace, and the harness files in the repository.
- `PRESERVED` lines are files the repository already has. connect creates a file in the repository only where none exists, keeps the existing ones unchanged and lists them. If a preserved `AGENTS.md`, `CLAUDE.md` or `RULES.md` is listed, the plan prints a loader block for you to add by hand. Until you add it, your client does not load the harness.
- `Detection` says what the repository already has. A repository with no Spec Harness files is `NONE`, and connect stages the harness files there. A repository with a harness receipt, `.claude/agents/.init-synthesis.json`, or with older Spec Harness files, is registered only, and connect writes nothing into it.

The plan ends with the exact apply command, with the plan digest. Approve that plan by running the same command with that digest:

```sh
node ./bin/second-brain.mjs connect --target "$PROJECT" --repo "$REPOSITORY" --apply YOUR_PLAN_DIGEST
```

The printed commands use the absolute path of the script, so you can paste them from any folder. They are quoted by platform: single quotes on macOS and Linux, and double quotes on Windows, where the CLI does not escape `%`. A path that contains `%` may not paste into `cmd.exe` as written.

## Read the result

A successful apply prints one of these statuses:

- `Status: STAGED`. The harness files are written and waiting for `/sdd init`. The repository is STAGED until `.claude/agents/.init-synthesis.json` exists, and it is not initialised before that.
- `Status: INITIALISED, registered` or `Status: already has harness files, registered`. The repository is register only. No file was written into it.

For a STAGED repository, open it in Claude Code or Codex and run `/sdd init` there. That step is written by the model, so the files it edits afterwards are outside the connect receipt.

Nothing is committed. connect runs no git command. The files it creates are uncommitted, and your team decides whether they go in by pull request. The staged `loop.sh` is copied as bytes, so it is not executable on this route.

The Spec Harness `index` step is optional and is not run by connect. It needs Python 3.11 or newer. The vendored script is Bash and uses POSIX-only file APIs, so this project has not tested it on native Windows and does not guarantee it there. See `vendor/spec-harness/docs/GETTING-STARTED.md` in the starter copy.

## What connect does not do

- It does not find repositories. You name each one, and each connect covers one repository.
- It does not commit, push, branch or stash.
- It does not run `/sdd init` or the `index` step. No code in `lib` or `bin` starts a process, so no vendored shell script runs.
- It does not write into a repository that already has harness files.
- It does not add a loader block to your files. You add it, when the plan asks.
- It does not work from ordinary web chat. Your client still needs local file access.

## Recover from an interrupted connect

If an apply stops, do not retry blindly. Run `node ./bin/second-brain.mjs verify --target "$PROJECT"`. It lists each connection. Only a CHANGED connection and a PENDING interrupted connect print a command, and each such line names it. A NO_RECEIPT connection prints none. Use `rollback --receipt` only with the receipt ID it names. The full recovery rules are in [verify, update and roll back](verify-update-rollback.md#recover-a-connect).
