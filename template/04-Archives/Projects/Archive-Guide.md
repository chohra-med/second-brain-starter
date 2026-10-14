# Archive guide

Archive a project after its outcome is complete, cancelled, or no longer active. Preserve its facts, roadmap, decisions, and progress together under `04-Archives/Projects/`.

Before moving it, add a final progress entry with Done, Verified, Open, and Next. If Open work remains, say where it moved. An archive is a retrieval boundary, not a shredder. Never delete an archived record; move it to the same folder path it had under `04-Archives/`, as [keeping it clean](../../00-Meta/README.md#keeping-it-clean) explains.

## Keep active records small

An active project keeps only current work in its folder. Older material moves here, under `04-Archives/Projects/<project>/`, and a pointer stays behind.

- Progress: when `progress.md` has more than 10 entries, or is larger than about 15 KB, move the older entries to `progress-YYYY.md` (the year of those entries). Leave one line in `progress.md` that links to that file. Newest entries stay at the bottom, and each entry has at most four bullets that link to their evidence.
- Roadmap: one table per roadmap. At review, rows that read `Verified` move to `roadmap-YYYY.md`. The status words are `Open`, `In progress`, `Blocked`, `Done` and `Verified`, and no others.
- `verify --records` reports rows outside the table, unknown status words and oversized files. It reads only and changes nothing.
