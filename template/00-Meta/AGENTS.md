# Manual context route

Use this only for the selected project folder. Do not scan the broader vault, parent folders, secrets, unrelated projects, or private notes.

Shared instructions belong in `AGENTS.md`; `CLAUDE.md` imports that owner. For navigation, choose the relevant [operating](README.md), [project](../01-Projects/README.md), or [resource](../03-Resources/README.md) map and follow its owner links only when needed. Maps do not replace the prerequisite order below.

Read in this order when the files exist:

0. `00-Meta/Profile.md`: it sets how answers are given and what is never touched
1. `00-Meta/Decisions.md`
2. The selected project's own `AGENTS.md`, `RULES.md`, `CONTRIBUTING.md`, relevant `ai_rules/`, memory bank, and `README.md` before diagnosing or changing its files
3. `01-Projects/Selected-Project/FACTS.md`
4. `01-Projects/Selected-Project/roadmap.md`
5. `01-Projects/Selected-Project/Decisions.md`
6. The three newest entries in `01-Projects/Selected-Project/progress.md`
7. `00-Meta/Daily-Task-Plan.md` only if today's focus changes the task

`Selected-Project` is the seeded project and stands for the project you are working in: for another project, read the same four records in its folder under `01-Projects/`. Its code stays where it is. This route never scans for repositories; the person names each one. A new project is a copy of `03-Resources/_templates/project/`; the [project map](../01-Projects/README.md) owns that rule.

Then state: selected root, selected project, files read, current goal, constraints, next useful action, evidence required for done, and any conflict. If a completed progress entry conflicts with an open roadmap item, name the conflict. Do not call the project ready.

Capture new work with `03-Resources/Procedures/capture.md`. Never invent a fact, decision, or verification result.

For system architecture changes to rules, commands, skills, workflows, automations, handoffs or context routing, use `second-brain-icm` before editing. If native skill invocation is unavailable, manually read `.agents/skills/second-brain-icm/SKILL.md` or `.claude/skills/second-brain-icm/SKILL.md`, then the method it names, `icm-architect/SKILL.md` in the same skills folder. Ordinary note work uses the selected-project route above without loading architecture safeguards.
