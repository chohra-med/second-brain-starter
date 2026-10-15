# Capture

Capture an incoming task in the roadmap of the project that owns it, `01-Projects/<project>/roadmap.md`. Give it an owner, `Open` status, the evidence required for done, and one next action. Add the row inside the roadmap's one table. A task that spans projects gets one row in each project it changes, and each row links to the others.

Fictional example:

| Item | Status | Owner | Evidence for done | Next action |
| --- | --- | --- | --- | --- |
| Test signup copy | Open | Sam | Three reader notes saved in progress | Send draft to readers |

If the input is only an idea, record it as an idea. Do not manufacture a project or a deadline.

## Inputs

- Working (this run): the incoming task or idea, in the words it arrived in, and the project that owns it.
- Reference (every run): that project's `roadmap.md`, for its columns and status vocabulary. The seeded example is the [Selected-Project roadmap](../../01-Projects/Selected-Project/roadmap.md).

## Outputs

- One new row in `01-Projects/<project>/roadmap.md`, and one in each other project the task changes.

## Human check

Read the new row. Confirm that the owner is a real person and that the evidence for done is something you can collect.
