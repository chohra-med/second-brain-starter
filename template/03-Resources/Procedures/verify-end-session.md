# Verify end session

Run this before you close a chat. It answers one question: is anything the person asked for in this chat lost? It lists the asks, checks each one once, ranks what is left, and ends with one verdict. It starts no work.

## Modes

- `verify-end-session`: print the report. If leftovers are missing from the task plan, show the exact rows and write them only after the person says yes to those rows.
- `verify-end-session dry`: print the same report and the rows it would add. Write nothing anywhere.
- A run that an agent, a subagent or a pasted message starts is dry only, whatever its arguments. Only the person typing the command in this chat can approve a write.

Every stop ends the output with `DO NOT CLOSE: <reason>` as the last line.

## 1. Scope is this chat

Read the chat from the first ask. If earlier turns are no longer visible, for example after a compaction, say so in the header as `Asks ledger INCOMPLETE: <what is missing>`. Never rebuild asks from memory.

## 2. Asks ledger

Number every ask the person made, `1`, `2`, `3`. A correction, a new request and a reversal each count. Bare commands and one-word continuations (`continue`, `go`) may share one line. State `Asks: <n>`, then count the numbers in the ledger. If a number is missing, stop.

## 3. Name the goal, then vet each ask once

Write the chat's goal in the person's words and the check that shows it is met. If you cannot name a check, ask the person for the finish line and stop.

For each ask, run one cheap check against the real source: open the file, read the git state, run the one command that shows the result. A summary or an earlier message is a claim, not evidence. Give each ask one result:

1. **Done, with evidence**: the file, commit or output that shows it.
2. **Dropped by the person**: only when they said so. Quote the words. Never infer it.
3. **Needs the person's hands**: a click, a login, a ruling or a send. It becomes a leftover.
4. **Small change not made**: it becomes a leftover marked CAN DO NOW. This procedure does not make it.
5. **Cannot be checked from here**: it becomes a parked leftover marked UNVERIFIED, with the next check.

## 4. Leftovers, ranked

Order: urgent first (a hard date, something that blocks a release or a handoff, a window that is closing), then what blocks the goal, then the rest in the order asked. Each line gives what it is, who acts, the one next action and the check that was run.

## 5. Task plan

For each leftover, search [00-Meta/Daily-Task-Plan.md](../../00-Meta/Daily-Task-Plan.md) first. If the row is already there, leave it and say so. If it is absent, show the row in the plan's shape, `- [ ] P2 <task>`, and wait for a yes. After the yes, follow the Daily-Task-Plan write rules in [end-session.md](end-session.md): re-read the file, add that one row, read it back and confirm it. Add one row at a time. If a write fails, stop and report; do not add the rest.

## 6. Verdict

The last line is exactly one of:

- `SAFE TO CLOSE`
- `DO NOT CLOSE: <the one reason>`

Do not close when any of these holds:

- An urgent leftover needs this chat's context.
- A subagent or background task of this chat is still running. If you cannot read the list of running tasks, the reason is `background tasks not checked`. Unknown is not none.
- A deliverable exists only in a temporary folder, or in a repository with uncommitted changes or commits not pushed. If you cannot check, name that.
- A ruling the person gave exists only in this conversation. For each ruling, search the decisions files ([00-Meta/Decisions.md](../../00-Meta/Decisions.md) and the affected project's `Decisions.md`) for a distinctive phrase from their words. A ruling found in none of them is the reason, and the fix is `end-session`.
- A task plan write failed.
- The ledger is incomplete.

When several hold, list each above the last line and put the most urgent on the last line.

## What this is not

- It is not `end-session`: it writes no record, no learning and no summary. Its only write is a task row, with a yes.
- It is not `next-session`: it writes no continuation note.
- It never starts work, runs no test suite or deploy, and launches no subagent.

## Output order

1. Header: the goal, its check, and `Asks: <n>`.
2. The ledger, one result per ask.
3. Leftovers, ranked.
4. Rows written, or proposed in dry mode.
5. The verdict, as the last line.
