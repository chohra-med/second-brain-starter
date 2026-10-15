# Context

Before working, name the projects you are working in: one, several, or `all` from the [project index](../../01-Projects/Index.md). Each one is a folder `01-Projects/<project>/`: the seeded `Selected-Project` or another project folder made by copying the project template. Then read the route in [00-Meta/AGENTS.md](../../00-Meta/AGENTS.md).

Return this compact note, one block per selected project, followed by a cross-project line when several are selected:

- Goal: [from facts]
- Constraints: [from facts and decisions]
- Open work: [from roadmap]
- Latest evidence: [from progress]
- Next action: [one action]
- Conflict: [none, or a mismatch that needs repair]
- Focus: [from `00-Meta/Daily-Task-Plan.md`; if its date is not today, write `stale plan dated YYYY-MM-DD` and do not treat it as today's focus]

Across projects (several selected): [shared blockers, dependencies, or none]

Fictional example: a task called "test signup copy" stays open in the roadmap, even if progress says a draft was completed. The draft is Done. The task is not Verified until the stated review evidence exists.

## Recover in a separate new chat

Read the installed Home, the operating route above, and the map of each selected project. Load only the records that route lists, at the depth it states. Recover the goal, constraints, actual artifact path and check evidence, Open work and saved Next action into the compact note above. Open the artifact to confirm the claimed evidence; name any mismatch as Conflict before proceeding. Ask only for information still missing from these owners.

Use a genuinely separate new chat with only the installed target and this manual owner route. A same-chat reread does not establish recovery. Native automatic loading remains unverified until observed in the client.

## Inputs

- Reference (every run): [00-Meta/AGENTS.md](../../00-Meta/AGENTS.md), which owns the read order and depth.
- Working (this run): the records that route lists for each selected project, in the project folders you named (the seeded project lives under `01-Projects/Selected-Project/`).
- Connected repository (when you name one): its folder under `01-Projects/` is the project folder. Its `Connection.md` shows the status at connect time; run `node ./bin/second-brain.mjs verify --target <this folder>` from the starter copy for the current status.

## Outputs

- The compact note above, returned in the chat. This procedure writes no file.

## Human check

Read the note and confirm that its goal and next action match the work you intend to do. If a line is wrong, correct the record that owns it.

## Changing the system

This procedure loads context for ordinary work. Before changing a rule, skill, procedure or context route, use the `second-brain-icm` skill. It owns the local change contract and names the method.
