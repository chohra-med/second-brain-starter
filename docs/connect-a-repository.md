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
- `PRESERVED` lines are files the repository already has. connect creates a file in the repository only where none exists, keeps the existing ones unchanged and lists them. If a preserved `AGENTS.md`, `CLAUDE.md` or `RULES.md` is listed, the plan prints a loader block for you to add by hand. Until you add it, your client does not load the harness. The edit guard registration below is the one exception: it can add an entry to `.claude/settings.local.json` and a line to `.git/info/exclude`.
- A `CREATE` line for an executable file ends with its mode, for example `(mode 0755)`.
- The `repo:.claude/settings.local.json` and `repo:.git/info/exclude` lines say what the edit guard registration will do, and why. They appear when the vendored Spec Harness declares that registration. The `Hook registration:` line above them sums it up: the entry is merged, an entry is already there, or none is written.
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

Nothing is committed. connect runs no git command. The files it creates are uncommitted, and your team decides whether they go in by pull request. Each staged file is created with the mode the harness manifest names, less your umask, so `loop.sh` and the edit guard hook `.claude/spec-harness/hooks/sdd-gate.sh` are executable.

If the result has a `Not done:` line, the edit guard was not registered, or one exclude line is left for you to add. The line says why, and the `Next:` lines under it say what to do:

- When only the settings file stopped the registration, the guard is staged but not active. The `Next:` line gives the command that registers it once you have dealt with the reason.
- When the hook file itself was refused, the file at the hook path is not the shipped guard, so the guard is not called staged. A `Next:` line names each settings file that already has an entry running that file. For `.claude/settings.local.json` it gives the command that removes the entry. connect never writes `.claude/settings.json`, so an entry there is yours to take out by hand. A settings file connect could not read is named for you to check. When no entry runs that file, the `Next:` line gives the command that registers the guard once you have dealt with the reason.

The Spec Harness `index` step is optional and is not run by connect. It needs Python 3.11 or newer. The vendored script is Bash and uses POSIX-only file APIs, so this project has not tested it on native Windows and does not guarantee it there. See `vendor/spec-harness/docs/GETTING-STARTED.md` in the starter copy.

## The edit guard registration

Spec Harness 0.7.0 and later ship an edit guard: a hook that Claude Code runs before each edit. The harness installer turns it on with its own registrar, and connect does the same thing itself, because it starts no program. In a repository with no Spec Harness files:

- It adds one `PreToolUse` entry for the guard to `.claude/settings.local.json`. It creates that file when it is missing. When the file exists, every other key and hook stays, in its order, and the file is written the way the registrar writes it, with two-space indentation. It keeps its mode, whatever your umask. It never writes `.claude/settings.json`, which teams commit. An entry that already runs the guard is not added twice.
- It registers the guard only when `.claude/spec-harness/hooks/sdd-gate.sh` is the shipped one: a file connect creates, or an existing file that is byte for byte the same. A different file, for example one that came with the repository, is kept as it is and is not registered. The plan says that it differs from the shipped edit guard. An existing shipped copy without the execute bit is not registered either, because Claude Code could not run it and edits would go unguarded; the plan gives the `chmod +x` to run first. When the hook is refused, connect also reads `.claude/settings.local.json` and `.claude/settings.json`, without following a link, to see whether an entry there already runs the refused file. If one does, connect leaves it, since it did not write it, and the plan names the file that holds it. Here connect differs from the harness registrar on purpose: the registrar's own `add` takes such an entry out of `.claude/settings.local.json` when it refuses, while connect only ever undoes what it wrote. If connect cannot read one of those files, for example because it is a link or is not valid JSON, the plan says that it cannot tell whether an entry there runs the file.
- A settings file that is a link, is not valid JSON, or is not shaped as the registrar expects is left as it is and named in the plan. The rest of the harness is still staged.
- In a git repository, it adds the line `/.claude/settings.local.json` to `.git/info/exclude`, so git does not offer the file for a commit. It reads `.git/info/exclude` only to see whether that exact line is already there; if it is, connect adds nothing. It does not read `.git/index` or any `.gitignore` file, so it adds the line even when git already tracks the settings file or another rule already ignores it. The line is harmless then: an exclude line does not change how git treats a tracked file, and a second rule that ignores the same file changes nothing. In those two cases connect differs from the harness registrar, which leaves `.git/info/exclude` alone. When the guard was not registered, connect adds no line.
- connect writes only inside the repository folder. If `.git` is a file (a linked worktree or a submodule), or the repository folder sits inside another repository, the plan prints the exclude line for you to add by hand.

Rolling the connection back by its receipt treats the two files like this:

- From a settings file that existed before connect, it takes out every entry that runs the guard command, including one that you added yourself, and any group, list or `hooks` object that this leaves empty, unless a group holds other keys. The other keys and values stay, in their order. The file is written the way the registrar writes it: two-space indentation, a key that appears twice kept once with its last value, and numbers and escapes in Python's form, so `1E2` becomes `100.0` and `\u00e9` becomes `é`. It keeps its mode, whatever your umask.
- A settings file that connect created is removed when nothing else is in it after that.
- The line connect added to `.git/info/exclude` comes out, and every other line stays. A file and folder that connect created for it are removed when nothing else is in them.
- A settings file that can no longer be read as JSON, or an exclude file that now holds that line twice, is left as it is and named, and the rollback refuses and removes nothing.

A connect that fails, or that is stopped before it finishes, is undone more exactly. While connect runs, it keeps a copy of a settings file that already existed in the workspace, at `.second-brain/backups/<receipt ID>/repo/.claude/settings.local.json`. The undo writes that copy back, so the file comes back byte for byte, with its mode, unless someone edited it in the meantime; then only the entry is taken out, as above. A file this undo cannot read as JSON is left and listed while the rest is removed. connect deletes the copy as soon as it finishes. If it is stopped after it finished but before it deleted the copy, `verify` lists the copy as `RESIDUE`, and the next approved connect, rollback or recovery deletes it.

## What connect does not do

- It does not find repositories. You name each one, and each connect covers one repository.
- It does not commit, push, branch or stash.
- It does not run `/sdd init` or the `index` step. No code in `lib` or `bin` starts a process, so no vendored shell script runs.
- It does not write into a repository that already has harness files.
- It does not add a loader block to your files. You add it, when the plan asks.
- It does not work from ordinary web chat. Your client still needs local file access.

## Recover from an interrupted connect

If an apply stops, do not retry blindly. Run `node ./bin/second-brain.mjs verify --target "$PROJECT"`. It lists each connection. Only a CHANGED connection and a PENDING interrupted connect print a command, and each such line names it. A NO_RECEIPT connection prints none. Use `rollback --receipt` only with the receipt ID it names. The full recovery rules are in [verify, update and roll back](verify-update-rollback.md#recover-a-connect).
