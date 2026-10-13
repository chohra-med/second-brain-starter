# Install and recovery

This page holds the full setup steps and the repair steps for a damaged loader. The [README](../README.md) has the short version.

## Get a source copy

Use either route:

- **Clone** the repository to a location you control.
- **Download and extract the latest release ZIP** from [Releases](https://github.com/chohra-med/second-brain-starter/releases).

Keep the source copy as your untouched base copy. If you use a source checkout, keep its structure intact. Its `bin/`, `lib/`, `template/`, and `template-manifest.json` files are the initializer source. Your project is a separate target directory, not an edited installer checkout.

## Initialize a project

The initializer needs Node.js `>=22`, an existing project directory or a missing empty target outside the source copy, and an absolute target path. macOS, Linux, and Windows are the V1 portability target. No npm package is required or published.

From the source root, set `PROJECT` to the absolute directory you want to prepare.

On macOS or Linux:

```sh
SOURCE_ROOT="$(pwd -P)"
PROJECT="$(dirname "$SOURCE_ROOT")/my project"
node ./bin/second-brain.mjs init --target "$PROJECT"
```

On PowerShell:

```powershell
$PROJECT = [IO.Path]::GetFullPath((Join-Path $PWD '..\my-project'))
node .\bin\second-brain.mjs init --target $PROJECT
```

### Approve the plan

In an interactive terminal, `init` prints the complete plan and asks you to type its exact plan digest before it writes. For a new folder or an empty folder, a plain `yes` also approves the plan.

Read the listed `CREATE`, `APPEND`, `IDENTICAL`, `MANAGED-UPDATE`, `CONFLICT`, and `DEPRECATED` entries first. A conflicting plan is not applied.

In a non-interactive shell, the same command prints a plan only. It ends with `Plan only: nothing was applied.`. That line is the normal end of a plan-only run, not an error. A declined terminal prompt prints `Plan not applied.` instead.

After you review that exact output, rerun the command with its exact digest:

```sh
node ./bin/second-brain.mjs init --target "$PROJECT" --apply YOUR_PLAN_DIGEST
```

Do not use a digest from another target or from a previous plan. `--force` does not exist in V1.

## Existing files and loader blocks

The target may already contain your project files. Differing managed files remain conflicts.

A nonempty root `AGENTS.md` or `CLAUDE.md` with no harness markers is not rejected. For a file this tool has no install record for, the plan marks it `APPEND`. The initializer adds the managed block after your existing text, and your text stays byte for byte in front of it.

Other cases stop for manual resolution:

- An installed file whose markers were removed is a `CONFLICT`.
- A file with a broken comment stops the install. A comment that is never closed stops it. So does a comment that names the tool and is not the one clean managed block, such as a half-present marker, two blocks, or a marker whose name is spelled differently.
- A plain sentence that names the tool, outside any comment, does not stop it.
- The same rule covers `.gitignore`. The comment there is a line that starts with `#`, and only a `#` line shaped like a marker counts.
- A root `AGENTS.md`, `CLAUDE.md` or `.gitignore` that is not UTF-8 text stops the install. It is not UTF-8 text when it has a null byte or starts with a UTF-16 or UTF-32 byte-order mark. Convert it to UTF-8 first. A UTF-8 byte-order mark is allowed. The block goes after your text, and the mark stays at the start.

The plan prints the line number and the reason. For example: `Manual resolution required: AGENTS.md line 4 has an HTML comment that is never closed, so the install stops; write the comment in full, ending with -->, or remove it, then plan again.`

The initializer never grants an AI client file access or proves that a client follows the files. Keep your project-specific instructions outside the managed block.

## The marker lines

The marker lines, exactly as shipped, are these two in `AGENTS.md` and `CLAUDE.md`:

```text
<!-- second-brain:loader:start -->
<!-- second-brain:loader:end -->
```

and these two in `.gitignore`:

```text
# second-brain:privacy:start
# second-brain:privacy:end
```

The start line comes first in the block and the end line comes last.

## Repair a damaged loader or ignore file

If an installed `AGENTS.md`, `CLAUDE.md` or `.gitignore` has lost a marker line, or its whole block, the plan and `verify` name the damage and the line when there is one. Only you can restore it. An assistant must not write markers by hand. The tool cannot recognise every possible damage, so read the plan before you approve it.

The one way out for each damage:

- **The start or end marker line is missing:** put back that one line, keeping your own text. Put the start line above the block text and the end line below it.
- **Both marker lines are gone, but the block text is still there:** put back both lines, above and below that text.
- **The block is gone, or the file is empty:** paste every line of the shipped file into the file, keeping your own text. The shipped file is `template/AGENTS.md`, `template/CLAUDE.md` or `template/privacy-gitignore.txt`, in the starter copy you run the command from. Putting back only the marker lines does not work here.
- **The file is missing:** run `upgrade` and approve the plan that shows `CREATE` for it.
- **The file was saved as UTF-16:** save it again as UTF-8 text.

After any of these, run `upgrade` again to plan the file, then run `verify`. Check which case you have before you change the file.

## Start one project

After setup, follow [first use and the first loop](first-loop-and-projects.md) inside your target.

## Upgrade

For a later starter version, get a fresh source copy first, then run its `upgrade` command against the same target. Read [UPGRADING.md](../UPGRADING.md) before you upgrade. `upgrade` prints a complete plan, and the approval rules are the same as for `init`.
