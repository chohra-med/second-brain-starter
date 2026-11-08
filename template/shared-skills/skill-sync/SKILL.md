---
name: skill-sync
description: Builds a weekly report on the skills installed in a workspace. It compares the copies in .claude/skills and .agents/skills by hash, compares each skill with the person's lock file, runs the security check with its best-practices pass, and reads the newest commit of each approved outside source. It reports only and changes nothing. It also finds candidate skills for a new need on request, after two yeses from the person, and installs nothing. Use when the person asks whether their skills are up to date, safe or out of step, for the weekly skill check, or when the person asks whether a skill exists for a new need.
metadata:
  scope: oss
---

# Skill sync

This skill ships one script, `sync.mjs`, that needs Node.js 22 or newer and nothing else. It reads every skill in the workspace, runs the `security-check` skill's `check.mjs` over them, and writes one report page. This edition reports only: the script never downloads, installs or updates a skill, and it never writes your lock file or your sources list. The find steps below run only when you ask: they fetch a candidate only into a scratch folder, and they install nothing.

## Do not use this when

- You want to install or update one skill now. Read the new version with the `security-check` skill first.
- You want to know whether the starter's own installed files changed. Run `verify` from the starter copy.
- You want one downloaded folder checked. Use the `security-check` skill on that folder.

## Your two files

Both live in `.skill-sync/` in the workspace. Both are optional, and both are yours: the script reads them and never changes them.

- `skills-sources.json`: one row for each outside skill you track. Only a row with an `approved` date (`"approved": "YYYY-MM-DD"`, the day of your yes) is looked up, only an `https://` or `file://` address is used, and a skill whose kind is `local` is never looked up outside. A `ref` of `HEAD` reads the source's default branch.

  The example lists the companion skills that `writing-check` and `design-check` can call. No row has an `approved` date, so each run lists them under Left for you and contacts none of them. Add the date only after you read the companion's verdict in the companions table of the skill that calls it; a companion with a BLOCK verdict there is never called, approved or not. When you install one, write the commit you installed into your lock as `commit`.

  ```json
  {
    "sources": [
      { "name": "diagram-design", "address": "https://github.com/cathrynlavery/diagram-design", "ref": "HEAD", "path": "skills/diagram-design", "licence": "MIT" },
      { "name": "taste-skill", "address": "https://github.com/Leonxlnx/taste-skill", "ref": "HEAD", "path": "skills/taste-skill", "licence": "MIT" },
      { "name": "ui-ux-pro-max", "address": "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill", "ref": "HEAD", "path": ".claude/skills/ui-ux-pro-max", "licence": "MIT" },
      { "name": "impeccable", "address": "https://github.com/pbakaus/impeccable", "ref": "HEAD", "path": "plugin/skills/impeccable", "licence": "Apache-2.0" }
    ]
  }
  ```

- `skills.lock.json`: your baseline. Each run writes a proposed lock beside its report, with today's hashes. You decide whether to save it as your lock.

## Steps

1. **Run it.** From the workspace root, run the copy your client reads:

   ```sh
   node .claude/skills/skill-sync/sync.mjs --workspace .
   node .agents/skills/skill-sync/sync.mjs --workspace .
   ```

   Add `--offline` to skip the outside lookup. Check: the exit code is 0 (nothing for you), 3 (something needs you), 4 (the security check found a BLOCK) or 2 (usage or read error: fix the command and run it again).
2. **Read the report.** Open the page it names. Counts sit on top, then the addresses it contacted, then four sections: Need your review, Left for you, Waiting and Done. Check: you can say how many items each section holds.
3. **Decide each item.** A newer outside commit, copies that differ and a security FLAG wait for your decision. A security BLOCK is final: fix the files or remove the skill. A file or folder in a skill that cannot be read is a security FLAG (`not-scanned-unreadable`) that names it, never skipped; the other skills are still checked, and a BLOCK in any of them still gives exit 4. Best-practice FLAGs are listed for you; they never block and never change the exit code. Check: every item under Need your review and Waiting has your answer.
4. **Save your baseline.** When the report reads right, copy the proposed lock over your lock. The page gives the exact `cp` line with a Copy button. Check: the next run lists those skills under Done.
5. **Update by hand, if you choose.** For a newer outside commit, download that version into a new, empty folder, run the `security-check` skill on it, and copy it into both skill folders only when nothing BLOCKs and you have decided each FLAG. Then write the new commit and hashes into your lock. Check: the next run shows the skill under Done.
6. **Schedule it weekly.** `node .claude/skills/skill-sync/sync.mjs --print-schedule --workspace "$PWD"` prints your three full paths (node, `sync.mjs` and the workspace), then, unchanged, the part of [the schedule file](assets/schedule.txt) for your system: a job for Monday at 09:00 in your own time zone, the steps to add and check it, and how to stop it. Put your paths in place of the three names in capitals. It installs nothing. On Linux, for example, the job is this one line:

   ```text
   0 9 * * 1 "NODE_PATH" "SCRIPT_PATH" --workspace "WORKSPACE_PATH" >> "WORKSPACE_PATH/.skill-sync/skill-sync.log" 2>&1
   ```

   Check: the first Monday report exists in `.skill-sync/reports/`.

## Find a skill for a new need

Only when the person asks, never in the weekly run. The assistant follows these steps; `sync.mjs` takes no part.

1. **Look here first.** Read the skills in both skill folders. Stop when one already meets the need.
2. **First yes: the query.** Turn the need into one generic query with no company, client, product, project, person or ticket name. Show it and how it will be sent (the pinned skills CLI, which runs third-party npm code, or a web search limited to skills.sh), and send it only after the person's yes.
3. **Search.** Run `DISABLE_TELEMETRY=1 DO_NOT_TRACK=1 npx -y skills@1.7.6 find "<generic query>"`, at this exact version (a release with the installer's symlink fixes), and name the version in your reply. Telemetry off does not make the query private: the skills service receives it. When the person does not want third-party npm code run, use a client web search limited to skills.sh instead. Keep at most 3 candidates.
4. **List.** For each candidate: its repository and commit, licence, last commit date, install count, stars, and its skills.sh audit verdicts (Gen, Socket, Snyk). These are weak signals: the audit is one input and never replaces step 5.
5. **Second yes: the fetch.** Show the addresses, `https://` only. After the person's yes, fetch each candidate on its own, at the listed commit, into a new, empty scratch folder outside the workspace (`git clone --no-checkout -- <address> <folder>`, then `GIT_LFS_SKIP_SMUDGE=1 git -C <folder> checkout --detach <commit>`, so no large-file download reaches another address). Read every file without following a link, run nothing from it, and run the `security-check` skill on its skill folder with `--report-dir` in the scratch folder.
6. **Report.** One table: take, skip or adapt the idea, with each candidate's verdicts and what it overlaps among the installed skills. Never run the CLI's `add` command, and never `-g -y`: nothing is installed. Taking one is a separate step with its own yes: install it as step 5 of Steps says ("Update by hand"), then add its row to your sources list and your lock.

Check: the reply names the query, the CLI version, every address contacted and each candidate's verdicts.

## What the report holds

| Section | Items |
|---|---|
| Need your review | a newer commit at an approved source; copies in the two skill folders that differ; a security FLAG |
| Left for you | no lock yet; a skill not in the lock; a skill edited since the lock; a locked skill that is missing; no pinned commit; a source row without an `approved` date; an address that was refused |
| Waiting | a security BLOCK; a security check that did not finish; an address that could not be read |
| Done | every skill with nothing to report |

The inventory counts the skill files, the names, the names with a copy in both folders, the copies that differ, and the skills only one client sees. Each run writes `skill-sync-<date>.html`, the same report as `.json`, the proposed lock `skill-sync-<date>.lock.json`, and the address list `skill-sync-<date>-addresses.txt`. The security check's own reports go to a `security-check/` folder beside them.

## Options

| Option | What it does |
|---|---|
| `--workspace <dir>` | The workspace to read. Required, except with `--print-schedule`. |
| `--offline` | Contacts no address. Everything else runs. |
| `--report-dir <dir>` | Saves the reports in this folder. Without it they go to `.skill-sync/reports/` in the workspace; when git would track that folder, the script writes nothing and stops with exit 2. The privacy block in the workspace's `.gitignore` makes git ignore `.skill-sync/reports/` and the weekly job's log (`.skill-sync/*.log`). |
| `--json` | Prints the whole report as JSON instead of a summary. |
| `--security-check <file>` | The `check.mjs` to use, when it is not in the `security-check` folder beside this skill. |
| `--print-schedule [--os macos\|linux\|windows]` | Prints your three paths and the weekly job from `assets/schedule.txt` for your system, or for the one you name. |

## Network use

The script's only outside call is `git ls-remote <address> <branch or tag>` for each approved row: it reads the newest commit id, with no download and no stored password or token. The script writes the address list into the report folder before the first call, contacts each address unchanged, and reports a timeout or an error once instead of retrying. A newer commit may not touch the skill itself; this edition does not download it to compare.

The find steps contact more addresses, each only after its own yes. After the first: the npm registry, which serves the pinned skills package, and the skills service, which receives the generic query. After the second: the repository of each listed candidate.

## Example

A workspace with a lock and one approved source runs on Monday. One skill was edited by hand since the lock, and the source has a newer commit. The run exits 3. The report lists the edited files under Left for you and the pinned and newest commits under Need your review. Nothing in the workspace changed.
