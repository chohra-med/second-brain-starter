# Extend your workspace

Use after first use when you have an actual repeated need and a named input. Follow [Context](context.md), including selected-project rules and the ICM change contract. Read only those owners and the input needed for this extension. Keep facts, work and history in their existing project owners.

## Choose the smallest addition

Ask what recurs, which exact input supplies it, and what saved output would help. Reuse an existing owner when it already fits.

- A **reference** preserves reusable information: `03-Resources/References/<unique-name>.md`. A reference alone needs no skill.
- A **procedure** owns a repeatable method: `03-Resources/Procedures/<unique-name>.md`. Name its purpose, required inputs, optional inputs, exact output, falsifiable check, permitted effects, approval, undo, stop rule and next action. Link references rather than copying their facts.
- An optional **skill** is a thin adapter to that procedure: `.agents/skills/<unique-name>/SKILL.md` or `.claude/skills/<unique-name>/SKILL.md`. Its name/description identifies the trigger; its body names the workspace-relative procedure and asks the client to read it. Keep mutable instructions in the procedure. Confirm client capability before claiming discovery; manual reading works without native invocation.

## Approve exact paths and bytes

Compare proposed names with the confirmed target's `.second-brain/installed-state.json` `managedPaths` destinations (read-only, no backups or unrelated hidden files), exact proposed paths and immediate entries in their parent directories, including case-insensitive collisions. Reject shipped names, symlinks, escaping paths and existing differing bytes. Do not recursively scan the target or browse unrelated hidden directories. If identical custom files already exist, reuse them; ask only for missing inputs.

Show the exact additions or edits and obtain approval for those files and effects. Preserve separate exact preimages for later edits, and check current bytes before writing to detect concurrent work. Installer rollback covers installation only; it cannot undo these custom edits. Never change managed Home, maps, shared skills, installed-state hashes or source manifests from the workspace.

On conflict, interruption, unexpected effect or failed check, stop and preserve the partial work and evidence. Record it as Open in existing roadmap/progress. Resume only after inspecting the approved files and filling actual gaps; do not replay an effect. Undo only the approved custom writes whose current bytes still match their recorded postimages, restoring preimages or archiving new files. If that precondition fails, stop for a scoped repair instead of overwriting user work.

## Run, check and save the route

For a reference alone, read the saved reference back against the supplied input, record its source and the observed comparison, then save its route and close. No procedure or adapter is required. For a procedure, agree and approve one bounded run with its exact input, output and check. Execute the method, save the result, and record the observed check. A template or promise is not a result. Plant one relevant bad input or missing required output and confirm the check fails, then restore and check the clean result.

Only after the custom files and passing evidence exist, add their links to the user-owned [Extensions](../Extensions.md) record. That record is navigation, not another task tracker. Follow [Close](close.md) to save the artifact path, check evidence, Open work and Next in existing progress and reconcile the roadmap. Incomplete work stays Open, never Verified.

## Fictional practice run

Adapt this example with approval; it is not an observed buyer result.

A repeated need is turning a supplied three-item packing list into a checked departure note. Create `References/my-packing-input.md` under Resources with the supplied items: notebook, charger, bottle. Create `Procedures/my-departure-note.md` under Resources with those input and output paths, local-only writes, approval and recovery boundaries. Its output is `01-Projects/Selected-Project/departure-note.md`; its check compares the saved note's item set with the reference and requires one Next action. Run it and record the actual result. Remove charger from a disposable output: the check must fail. Restore it and check again. An optional uniquely named adapter points only to that method. Record observed mechanics, not a human success claim.

## Recover in a NEW chat

Start a separate new chat with the installed target and Home only. Manually read root `AGENTS.md`, its operating route and [Context](context.md). Follow Home → Extensions → the chosen custom owner, open the saved artifact and its check evidence in progress, and recover Open and Next. Name broken links or conflicting records before continuing. A same-chat reread is rehearsal; this route does not prove native automatic loading.
