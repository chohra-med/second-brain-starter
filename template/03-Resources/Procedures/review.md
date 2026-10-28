# Review

Run this weekly or before a handoff, for each selected project in its folder `01-Projects/<project>/`.

1. Read facts, roadmap, decisions, and the newest three progress entries (the newest entries are at the bottom of `progress.md`).
2. Compare each `Done` claim with its roadmap item and required evidence.
3. If progress says complete while the roadmap is Open, record a conflict. Repair the record or collect the missing evidence. Do not report ready.
4. Promote a confirmed rule to the project's `Decisions.md`, or to `00-Meta/Decisions.md` only when it affects multiple projects.
5. Check the [keeping-it-clean rules](../../00-Meta/README.md#keeping-it-clean) and fix any file that breaks one. Keep the records small: the roadmap has one table and uses only `Open`, `In progress`, `Blocked`, `Done` and `Verified`. Move rows that read `Verified` to `04-Archives/Projects/<project>/roadmap-YYYY.md`. Rotate `progress.md` and `Decisions.md` as [Close](close.md) step 5 says (10 entries or about 15 KB, newest at the bottom). To check the shape without changing anything, run `node ./bin/second-brain.mjs verify --target <this folder> --records` from the starter copy.
6. End with one `Next` action.

Use [learning and scaling](learning-and-scaling.md) when a correction is worth keeping.

## Inputs

- Working (this run): the project's `roadmap.md` and the newest three entries in its `progress.md`. The seeded example is the [Selected-Project roadmap](../../01-Projects/Selected-Project/roadmap.md) and its [progress](../../01-Projects/Selected-Project/progress.md).
- Reference (every run): the project's `FACTS.md` and `Decisions.md` (seeded example: [facts](../../01-Projects/Selected-Project/FACTS.md) and [decisions](../../01-Projects/Selected-Project/Decisions.md)).

## Outputs

- Any repaired row in `01-Projects/<project>/roadmap.md` or conflict noted in `01-Projects/<project>/progress.md`.
- Verified rows moved to `04-Archives/Projects/<project>/roadmap-YYYY.md`.
- A confirmed rule in the project's `Decisions.md`, or in `00-Meta/Decisions.md` when it affects several projects.
- One `Next` action.

## Human check

Read the `Next` action and each conflict the review found. Confirm that no item reads ready while its evidence is missing.
