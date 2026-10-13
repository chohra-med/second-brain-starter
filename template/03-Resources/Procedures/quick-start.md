# Quick start: index one to three projects

Use this for the least effort. The assistant reads the repositories you name and drafts a first record for each project. You approve each draft before anything is saved.

Two words first:

- **Workspace:** the Second Brain folder that setup created on your computer.
- **Repository:** a project folder you already work in. It can hold code, or a team's reports and notes.

## Before you start

- The workspace must be installed and verified. If it is not, follow stages 1 to 7 of the starter's `ONBOARDING.md` first.
- You name each repository. The assistant never looks for repositories, never lists folders beside or above one, and never searches your home folder.

## Steps

1. Ask for the path of one repository. Repeat the exact path and ask the user to confirm it. Read nothing in it yet.
2. Read only these items in that repository, in this order, when they exist: `AGENTS.md`, `RULES.md`, `CONTRIBUTING.md`, `ai_rules/`, `.memory/` and `README.md`. Follow their rules. If a rule conflicts with this procedure, stop and say so. Do not open `.env` files, credentials or unrelated files.
3. Connect that one repository. Follow stage 9 of the starter's `ONBOARDING.md` for it: the plan, the approval of the exact plan, then the apply. Nothing is committed. Read the plan before you approve it, and say which case it is from its `Repository writes` line: harness files staged and uncommitted (the `Detection: NONE` case), or no repository writes at all, because the repository is only registered (`ONBOARDING.md`, stage 9, step 4).
4. Draft three records in that project's folder under the workspace's `01-Projects/`. The folder already holds copies of the project template. connect names it after the repository's folder name, which the plan shows as `Name:`, and that folder is separate from any project folder that init made; to merge two by hand, copy the lines you want from one folder to the other and keep both. If the plan shows a `CONFLICT` line, nothing is written. Move that file aside by hand, or choose another name with `--name` (stage 9, step 3), and plan again.
   - `FACTS.md`: Goal, Scope, Constraint and Source of truth. One line each, with today's date in its Checked column, including for `Unknown`.
   - `roadmap.md`: one row for the first outcome, with its status, owner, evidence for done and next action.
   - `progress.md`: one dated entry with Done, Verified, Open and Next.

   Use only what you read in step 2 or what the user says. Write `Unknown` for anything else. Never guess. Never copy a password, a key, a token or a whole file.
5. Show the exact text of all three drafts for that project. Before the user says yes, say in one sentence that these three files hold a summary of the repository, that git tracks them, and that they should not be approved if the repository is private and the workspace will be shared. To keep them out of git, add the three paths to your own lines below the privacy block in `.gitignore`: `01-Projects/<name>/FACTS.md`, `01-Projects/<name>/roadmap.md` and `01-Projects/<name>/progress.md`. Write nothing until the user says yes. One yes covers that project's three files only.
6. Write the three files. Leave every other file as it is.
7. Repeat steps 1 to 6 for the next repository, one at a time. Stop at three.

## Example (fictional)

A shared folder holds one client's monthly report.

- FACTS Goal: `Monthly report for one client, sent on the fifth working day.`
- roadmap row: `September report` | `Open` | `Report owner` | `Client receives the file` | `Confirm the data export is ready.`
- progress Next: `Confirm the data export is ready.`

If the folder has no readable file, the draft says `Unknown` in every field.

## If the user says stop

Stop at once. Say which repositories are connected, which records are written and which drafts are not written.

## Closing prompt

Before the closing prompt, give one line per project: what it is, its next action, and what is still unknown. A project with nothing readable gets `Unknown`, never an invented line.

Then tell the user to ask: **What should I focus on this week?**

Answer that question this way:

- At most three points. Each names a saved project and its next action.
- Then the one thing to start with.
- Then what is still `Unknown`.
- A point with no saved evidence is not made.
