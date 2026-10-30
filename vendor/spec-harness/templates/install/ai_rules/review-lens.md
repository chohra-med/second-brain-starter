# Review lens

Status: PENDING. Add standing checks below, or leave this file as it is and reviews run without a lens.

The lens holds checks that must hold on **every** LITE and FULL ticket in this project, so no ticket brief has to repeat them. Each line is one check, in this exact shape:

`- **LENS-<n>** <one check sentence>. (source: <file or decision>)`

The source tag is optional. Keep each check answerable from the diff, the goal or the files it names.

## How reviews use it

- The reviewer gives every `LENS-<n>` item one verdict per review: `MET`, `VIOLATED` or `NOT-APPLICABLE`.
- `VIOLATED` is a `NEEDED` finding. A missing verdict makes the review incomplete.
- A ticket brief may add checks. It may never remove or weaken a lens item. Change the lens itself, with the owner's approval, to change a standing check.
- Only the lines of the form shown above count: lines inside HTML comments are not items, and a lens with no items means no lens.
- A MICRO ticket has no reviewer, so the lens does not apply to it.
- This file is not a rules file: rule IDs and rule modules live under `ai_rules/rules/` and `RULES.md`. Do not copy a rule here; name its ID in the check instead.

## Items

<!-- Example only, delete or replace (synthetic):
- **LENS-1** No customer name, address or key appears in any file of the diff. (source: security policy)
- **LENS-2** A new written page keeps the voice described in the voice file. (source: .memory/ voice file)
-->
