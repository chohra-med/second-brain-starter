# Close

Open the roadmap item and its progress entries together, in the folder of the project that owns the work, `01-Projects/<project>/`.

1. Record what was Done in `progress.md`, including the actual useful artifact path. Add the entry at the bottom: the newest entry is last. An entry has at most four bullets, Done, Verified, Open and Next, and each links to its evidence.
2. Add the exact task-specific check and its result under Verified; compare the artifact content against the saved facts and intended outcome. Installer integrity verification alone does not establish usefulness. A completed action without evidence stays Open or In progress.
3. Update the roadmap status to `Verified` only when the evidence listed there was checked. A roadmap uses five status words only: `Open`, `In progress`, `Blocked`, `Done`, `Verified`.
4. Write any remaining work as Open and name the Next action.
5. If `progress.md` now has more than 10 entries, or is larger than about 15 KB, move the older entries to `04-Archives/Projects/<project>/progress-YYYY.md` (the year of those entries) and leave one line in their place that links to that file.
6. If `00-Meta/Daily-Task-Plan.md` carries a date other than today, it is stale. Offer to clear it, and clear it only when the person agrees.

Use these words plainly: Done, Verified, Open, Next. They make handoffs readable and expose wishful completion.

Request a separate new chat: “Read Home and [Context](context.md), recover the goal, constraints, artifact evidence and saved Next from the selected project owners, then tell me the next step.” Preserve unknowns and report conflicts. A same-chat reread does not prove recovery; manual new-chat recovery does not prove native automatic loading.

## Inputs

- Working (this run): the roadmap item in the project's `roadmap.md`, its entries in `progress.md`, and the artifact the work produced. The seeded example is the [Selected-Project roadmap](../../01-Projects/Selected-Project/roadmap.md) and its [progress](../../01-Projects/Selected-Project/progress.md).
- Reference (every run): the project's `FACTS.md`, to compare the artifact against (seeded example: [facts](../../01-Projects/Selected-Project/FACTS.md)).

## Outputs

- One dated entry at the bottom of `01-Projects/<project>/progress.md` with Done, Verified, Open and Next.
- The item's status in `01-Projects/<project>/roadmap.md`.
- When the log grew past its limit: the older entries in `04-Archives/Projects/<project>/progress-YYYY.md`, and one pointer line in their place.

## Human check

Open the artifact and the recorded check result side by side. Confirm they agree before the roadmap item reads `Verified`.
