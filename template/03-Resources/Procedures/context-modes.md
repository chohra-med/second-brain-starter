# Context modes

Load bounded context for the workspace in one of three explicit modes. The mode comes from the words the person used. Never promote a default or scoped run to `full`.

| Mode | Request | Reads | Stop rule |
|---|---|---|---|
| `context` (default) | `context`, with no target | The route and the operating map only | None needed; return the orientation |
| `context <project or task>` (scoped) | Names one project folder or one task | The default reads, then that target's own records | Target missing or ambiguous: stop and ask |
| `context full` (explicit) | Says `full` | The broad baseline below | Scope too large: report it and ask whether to continue |

For every mode, what the person says in the current conversation overrides the files. Where a file disagrees with what they said, trust them, say so, and correct the file in the same session.

## Default mode (`context`)

1. Read [00-Meta/AGENTS.md](../../00-Meta/AGENTS.md). It owns the route, the read order and the depth for the workspace.
2. Read [00-Meta/README.md](../../00-Meta/README.md), the operating map, for the working rules it names.
3. Do not read the current-task plan, the daily notes, project records or the earlier conversation as a stand-in for a target. Check: you opened only the two files above.
4. Return a short orientation: the workspace's purpose as its route states it, the open items the route's own records show, and the next useful action.

## Scoped mode (`context <project or task>`)

1. Do the default reads first.
2. Resolve the target to exactly one project folder under [01-Projects/](../../01-Projects/README.md), or to exactly one task in the current-task plan. If it matches nothing or more than one thing, stop and ask for a clearer target. Never guess.
3. Before you read the target's records, list their paths and report their byte total as file bytes only, as in full mode. Name every record file over the rotation limit in [close.md](close.md) step 5 and offer to rotate it; do not rotate it in this run.
4. Read the records that the route lists for that project, at the depth it states. For the seeded project, that is its facts, roadmap, decisions and the newest progress entries named in the route. Open a `progress.md` only for the project in scope.
5. If the target is a repository the person named and registered, read that repository's own rule files before you read or change its files, as the route requires.
6. Answer from those records only. Name any conflict between them, such as a completed progress entry under an open roadmap item. Do not call the project ready if a conflict is open.

## Full mode (`context full`)

1. Before you read anything, list the paths you will read and measure their byte total. Report the total as file bytes only. Do not present it as tokens, a share of the context window, time or cost saved.
2. If the listed scope is too large to read in full, report the size and ask whether to continue. Do not silently truncate a required file.
3. Read these in order, when they exist:
   1. [00-Meta/AGENTS.md](../../00-Meta/AGENTS.md): the shared operating policy and the route.
   2. [00-Meta/Daily-Task-Plan.md](../../00-Meta/Daily-Task-Plan.md): the current-task source. Its Today section sets the current focus. Its open decisions or blockers section lists what waits on the person.
   3. The five most recent dated notes in the daily notes folder. Match only file names shaped like `YYYY-MM-DD.md`, then sort them newest first. A plain sort puts a non-dated file first and drops a real day. Example: `ls <daily-notes-folder>/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].md | sort -r | head -5`.
   4. [01-Projects/README.md](../../01-Projects/README.md): the project map and the coordinates of each project.
   5. The map file of each project the session will touch. Do not read every project folder. Open a `progress.md` only when a specific project is in scope.
4. Overlay what the person said in this conversation, then reconcile any file that disagrees with it in the same session.
5. Return the situation report below.

Situation report, under one mobile screen:

```
# Context loaded: [today's date]

## Current focus
- [from the Today section of the current-task plan]

## Dated constraints in range
- [deadlines, review windows, freezes that expire]

## Gate measure
- [what the current phase is measured on]

## Recent days (last five daily notes)
- [pattern, win or friction]

## Projects (one line each)
- [project]: [status]

## Open decisions
- [from the open decisions section of the plan and the decisions files]

## Plan says
- [any constraint in the plan that changes what is allowed today]

Ready.
```

## Changing the system

This procedure loads context for ordinary work and writes no file. Before you change a rule, skill, procedure or context route, use the `second-brain-icm` skill. It owns the change contract and names the method.
