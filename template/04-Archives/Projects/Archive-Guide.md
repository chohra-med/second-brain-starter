# Archive guide

Archive a project after its outcome is complete, cancelled, or no longer active. Preserve its facts, roadmap, decisions, and progress together under `04-Archives/Projects/`.

Before moving it, add a final progress entry with Done, Verified, Open, and Next. If Open work remains, say where it moved. An archive is a retrieval boundary, not a shredder. Never delete an archived record; move it to the same folder path it had under `04-Archives/`, as [keeping it clean](../../00-Meta/README.md#keeping-it-clean) explains.

## Keep active records small

An active project keeps only current work in its folder. Older material moves here, under `04-Archives/Projects/<project>/`, and a pointer stays behind.

- Rotation rule, owned by the [close procedure](../../03-Resources/Procedures/close.md): a record file keeps at most 10 entries or about 15 KB, newest at the bottom.
- Progress: when `progress.md` passes the rule, move the older entries to `progress-YYYY.md` (the year of those entries). Leave one line in `progress.md` that links to that file. Newest entries stay at the bottom, and each entry has at most four bullets that link to their evidence.
- Decisions: when a project's `Decisions.md` passes the same rule, move the older rows to `decisions-YYYY.md` and leave one line that links to that file immediately above or below the table, never inside it.
- Roadmap: one table per roadmap. At close or review, rows that read `Verified` move to `roadmap-YYYY.md`, with one line that links to that file immediately above or below the table, never inside it. The status words are `Open`, `In progress`, `Blocked`, `Done` and `Verified`, and no others.
- `verify --records` reports rows outside the table, unknown status words and oversized files. It reads only and changes nothing.

## Snapshots

Links inside an archived snapshot are not rewritten when the folder moves. Check them after a move, and repair a link that no longer resolves.
