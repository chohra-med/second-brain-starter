---
description: Default end-of-session routine for a task tab. Saves what happened and leaves a report the master can check. Replace it with your own if you have one.
---

Close out this task. Do not start new work.

1. Write `reports/<short-task-name>-<YYYY-MM-DD>.md` with four headings: What was asked, What I did (file paths), What is not done, Anything the human should know.
2. If you changed a rule, a decision or a lesson that other tabs need, append it to `state/decisions.md` in the entry shape that file shows.
3. Print exactly one last line, with the real path: `report: reports/<file>.md`
