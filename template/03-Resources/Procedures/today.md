# Today

Return today's briefing from the workspace records. It reads the current plan and two daily notes, lists every open item, and ends with one concrete first action. It writes no file.

Get today's date from the system clock (`date +%F`), never from memory or from a file.

## Reads

Read these, in this order, when they exist. Open nothing else.

1. [00-Meta/Profile.md](../../00-Meta/Profile.md): how the person wants answers given, and what is never touched.
2. [00-Meta/Daily-Task-Plan.md](../../00-Meta/Daily-Task-Plan.md): the one source of the current tasks. Its `Date:` line says which day it was written for.
3. The daily note for today and the one for yesterday, in the daily notes folder: `05-Daily/YYYY-MM-DD.md`. Either may be missing.

Do not read the project folders, the inbox, older daily notes or the earlier conversation to fill a gap. If a project matters for the first action, say so and offer `context <project>`.

What the person says in the current conversation overrides the files. Where a file disagrees, trust them, say so, and correct the file in the same session.

## Steps

1. Compare the plan's `Date:` line with today's date. If it is not today, the plan is stale: say `stale plan dated YYYY-MM-DD`, list its open items under that label, and do not treat them as today's focus. If the line is missing or still the placeholder, say that.
2. List every open task (`- [ ]`) from the plan's Today section and from its Open decisions or blockers section. List all of them, in the order the plan has them, each with its priority. Do not pick a few and do not shorten the list. A task leaves the list only when the person says it is done.
3. From yesterday's note, copy its `Open` and `Next` lines as the carry-over. If there is no note, write `None recorded`.
4. From today's note, list what is already done today. If there is no note, write `Nothing yet`.
5. Pick the first action: the highest-priority open task that is not blocked. Name the file or tool it starts in and the check that shows it is done. If nothing is open, say so and ask what the day is for.

## The briefing

Keep it under one mobile screen.

```
# Today: YYYY-MM-DD, <weekday>

## Open items
- [ ] P0 <task>
- [ ] P1 <task>

## Blocked or waiting on a decision
- [ ] P2 <item>

## Carry-over from yesterday
<Open and Next lines, or "None recorded">

## Already done today
<list, or "Nothing yet">

## Start here
<one action, the file or tool it starts in, and the check that shows it is done>
```

If the plan is stale, put `stale plan dated YYYY-MM-DD` as the first line under the title and keep its open items under that label.

End with one concrete offer, such as `Want me to start <the first action> now?` Do not end with "let me know".

## Inputs

- Reference (every run): [00-Meta/Profile.md](../../00-Meta/Profile.md).
- Working (this run): the task plan and the two daily notes named above.

## Outputs

- The briefing above, returned in the chat. This procedure writes no file. To start today's note, copy `05-Daily/daily-template.md` only after the person says yes.

## Human check

Read the Open items list against the plan. If a task is missing, wrong or already done, correct the plan, because the plan owns the tasks.

## Changing the system

This procedure reads records for ordinary work. Before you change a rule, skill, procedure or context route, use the `second-brain-icm` skill. It owns the change contract and names the method.
