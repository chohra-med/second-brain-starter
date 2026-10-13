# Operating map

Read this map when finding workspace policy or today’s focus.

- [Shared policy](AGENTS.md): bounded context route.
- [Cross-project decisions](Decisions.md): choices affecting the workspace.
- [Daily task plan](Daily-Task-Plan.md): today’s selected outcome, when relevant.

- [First use](../03-Resources/Procedures/first-use.md): start after verified installation.

## Keeping it clean

These rules apply to you and to any assistant that works in this workspace. Check them when you add, move or finish something.

1. Put new things inside the folder they belong to, because the top level holds only the numbered folders, `Home.md` and the assistant rule files (`AGENTS.md`, `CLAUDE.md`) and `.gitignore`.
2. Keep scratch files, downloads, build output and test output out of the workspace, because they pile up and hide the records you need.
3. Before an assistant changes or moves a file you care about, it keeps one copy of the old version, and only one per change, so a bad edit can be undone.
4. Never delete a record: move it to `04-Archives/`, in the same folder path it had, because a move can be undone and a delete cannot.
5. Write each task as one line: a checkbox, a priority from P0 (now) to P4 (someday), then the task, for example `- [ ] P1 Draft the agenda`, because tools may read these lines and the shape matters. A finished task stays visible for 15 days, then moves to an archive note.
6. Keep one home for each fact: a number, a price, a date or a version lives in the project’s `FACTS.md`, and everything else points to it, so a change is made once.
7. Keep the files an assistant reads every time small: when a log passes about 60 KB, start a new one and move the old one to `04-Archives/`, so each read stays cheap.
8. Review weekly: the [review procedure](../03-Resources/Procedures/review.md) is the moment these rules are checked, because drift shows up only when someone looks.
