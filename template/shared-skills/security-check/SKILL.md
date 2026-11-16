---
name: security-check
description: Reads a skill, plugin, MCP server config or hook folder before it is installed or updated, and reports what could harm the workspace with a verdict of PASS, FLAG or BLOCK, plus a separate best-practice verdict for skills. Use when adding or updating a skill or plugin, before trusting a downloaded folder, when auditing every skill under a folder, or when the person asks whether something is safe to install.
metadata:
  scope: oss
---

# Security check

This skill reads a folder and reports what in it could harm the workspace, before anything from it runs. It ships one script, `check.mjs`, that needs Node.js 22 or newer and nothing else. The script reads files only. It never starts a file from the folder, installs nothing and makes no network call.

## Do not use this when

- You want a review of your own code changes. Follow `03-Resources/Procedures/branch-security-review.md`, using native `/security-review` when available.
- You want the starter package scanned before a release. The starter's own package scan does that (`node --test` in the starter).
- You want to know what a running server does. The check reads files; it does not watch a process.

## Steps

1. **Collect.** Name the folder to check: a skill, a plugin, an MCP server config or a hook folder. Run nothing from it.
   Check: you can give the folder's full path.
2. **Run the static checks.** From the workspace root, run the copy your client reads. The two copies are the same file.

   ```sh
   node .claude/skills/security-check/check.mjs <folder> --project <project>
   node .agents/skills/security-check/check.mjs <folder> --project <project>
   ```

   Check: the exit code is 0 (PASS), 3 (FLAG), 4 (BLOCK) or 2 (usage or read error: fix the command and run it again). Node itself uses 1 only when it crashes. The report lists every file with its size and SHA-256.
3. **Read each hit.** Open each file at the reported line and decide whether the hit is real. You may lower a FLAG to PASS only with a one-line reason. You may never lower a BLOCK: a BLOCK is final, and the folder is not installed until its files are fixed and a new check passes.
   Check: every hit has a verdict, and every lowered FLAG has a reason.
4. **Report.** Give the person the report page and both verdicts.
   Check: the page opens offline and shows the folder hash.
5. **Decide.** The person decides each FLAG. Nothing is installed while a BLOCK stands.
   Check: each FLAG has the person's answer.
6. **Record.** For an approved item, write its name, version (tag or commit), folder hash, date, verdict and the reason for each lowered FLAG in the project's approvals list, for example a table in the project's `Decisions.md`.
   Check: the recorded hash equals the folder hash in the report.

## Options

| Option | What it does |
|---|---|
| `--project <name>` | Saves the report in `01-Projects/<name>/local/security-check/` of the workspace you run it in. |
| `--report-dir <dir>` | Saves the report in this folder instead. |
| `--json` | Prints the whole report as JSON instead of a summary. |
| `--all <root>` | Checks every folder under `<root>` that holds a `SKILL.md`, and writes one summary with an entry per skill. Use it in place of `<folder>`. |

Without `--project` or `--report-dir`, the report goes to `local/security-check/` under the current folder. When that folder would sit inside a git work tree (a repository, a worktree or a submodule), the script writes nothing and stops with exit 2, asking for `--report-dir`, so a report never lands in the repository you run it from. A project folder chosen with `--project` inside a workspace is allowed, because the workspace's privacy block in `.gitignore` keeps these report folders out of git. The script also refuses a report folder inside the folder it checks.

Each run writes `security-check-<name>-<date>.html` and the same report as `.json`. The page needs no outside file and works offline.

## The six checks

| Check | A hit gives FLAG | BLOCK when |
|---|---|---|
| 1. Runs on its own | hooks, MCP server entries, install-time package scripts, scheduled jobs, git hooks, files marked executable | one of them starts a package or a download that has no exact version |
| 2. Network calls | download commands, web requests in code, remote shells and copies, web tools, remote MCP servers, a web address inside code or a code block; also a program started from an argument list in code (a Node or Python process call with a list, an os exec or spawn call, a Go command) when the program is a download or remote tool, or git with clone, fetch, pull, push or ls-remote | never on its own |
| 3. Unpinned installs | package runners and installs without an exact version, also when started from an argument list in code; a download piped into a shell, a repository reference without a commit | never on its own; check 1 blocks the ones that run at start |
| 4. Orders aimed at the assistant | visible text that tells the assistant to drop its rules, keep something from the person, act without the person's yes or send data out; switches that turn approvals off | the same kind of text hidden from a human reader: invisible or direction-changing characters, comments, hidden styling, or encoded text that decodes to an order |
| 5. Keys in files | a personal home path; a file that was not scanned for keys because it is binary (`not-scanned-binary`) or larger than 128 KB (`not-scanned-large`) | authorization values, signed tokens, private keys and credential assignments, plain or encoded |
| 6. Writes outside its folder | a write to a home, parent or system path; naming a credential store | a write to a credential store, a shell start file, a scheduler or another tool's settings file; a link inside the folder that points outside it |

- A comment (HTML or Markdown) is a hit only when its text gives the assistant an order: the phrases of check 4, a request to send someone's keys or private data out, to open a web address or to drop the rules, or a line addressed to the assistant. Such a comment is BLOCK. A comment without an order, such as a drawing label or an author's note, is not a hit.
- Comment markers inside code open no comment: not inside a fenced code block or an inline code span in Markdown, and not inside a string in a page's script or style element.
- A web address in plain prose is listed with its host in the report but is not a hit.
- A plain script that nothing starts is listed in the file inventory, not counted as a hit.
- A stray invisible character also blocks. Delete it and check again.
- A file or folder inside the checked folder that cannot be read is never skipped silently: it gets a FLAG, `not-scanned-unreadable`, that names its path, and the rest of the folder is still checked. With `--all`, a skill folder that cannot be read at all gets that FLAG as its own entry, every other skill is still checked, and a BLOCK in any of them still gives exit 4. Only the folder you name failing to open is a read error (exit 2).
- The key scan reads text files up to 128 KB (131,072 bytes), including UTF-16 text. It decodes every word that could hide a key, and on dense data its time and memory grow fast: a 57 KB map file took 17 seconds and 1.8 GB. A larger file, or a binary file such as an image or a font, is not key-scanned. It gets a FLAG that names the file, so it never passes silently: read it by hand, or keep it out of the folder. The other checks still read text files up to 4 MB.
- Key values are masked: the report shows the first four characters and the length, never the value. Quoted text is escaped on the page.

## Best practices (check 7)

For a folder with a `SKILL.md`, the script also checks the skill against Anthropic's skill authoring best practices and the Agent Skills specification. This pass has its own verdict, PASS or FLAG. It never blocks and never changes the security verdict or the exit code.

- Front matter is present. `name` has 1 to 64 lowercase letters, digits and single hyphens, equals the folder name, has no reserved word and no XML tag, and is not vague.
- `description` is present, at most 1,024 characters, has no XML tag, is written in the third person, and says when to use the skill.
- `compatibility`, when present, is at most 500 characters.
- The `SKILL.md` body is under 500 lines.
- References are one level deep, and a reference file over 100 lines has a contents list near the top.
- Paths use forward slashes.
- No wording expires on a date.
- Every script in the folder is named in `SKILL.md`, so the reader knows whether to run it or read it.

Each finding has a rule id, a file, a line and a one-line fix.

## Example

A sample skill whose session-start hook runs a package runner with no version gets BLOCK: the report names the hook file and line, with rule `start-unpinned`. The same runner in a code block of `SKILL.md`, run only when the person asks, gets FLAG with rule `package-runner`.
