---
name: "second-brain-icm"
description: "Use before changing Second Brain system architecture: rules, commands, skills, workflows, automations, handoffs or context routing."
---

# Second Brain ICM

This skill holds local bindings only. The method owner is the bundled `icm-architect` skill, installed beside this one at `icm-architect/SKILL.md`. Read that file for the ten invariants, the build and restructure modes and the walk test. This file states only how this workspace applies them.

## Local bindings

- Folder routers stay `README.md`. Do not add a `CONTEXT.md` router: `03-Resources/Procedures/context.md` already exists, and macOS and Windows treat the two names as one file.
- Never rename a folder or a linked record. Add the new owner and update every reader in the same change.
- Archive, never delete. Finished or superseded material moves under `04-Archives/`.
- Run the `icm-architect` walk test after every structural change and keep its result with the change.
- A new project is a copy of `03-Resources/_templates/project/`, placed under `01-Projects/` with its own name.

## Change contract

Before changing a rule, command, skill, workflow, automation, handoff or context route, record:

- Owner: one canonical file remains authoritative.
- Context: list only files the task needs; follow the selected-project route in `00-Meta/AGENTS.md`.
- Effects: name the permitted changes and excluded effects.
- Evidence: name a completion check and a failure case that must be rejected.
- Continuity: preserve user-owned records and name the recovery path.
- Learning: route confirmed misses through `03-Resources/Procedures/learning-and-scaling.md`, then verify the correction in a fresh session.

Ordinary note work uses `second-brain-context`.

If native invocation is unavailable, read this file and `icm-architect/SKILL.md` manually. Installation does not prove automatic discovery or client compliance.
