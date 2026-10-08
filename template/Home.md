# Home

## Start my first result

> Read Home and First use. Help me agree one small saved result, ask only what is missing, and show the exact plan before edits.

Follow [First use](03-Resources/Procedures/first-use.md). Undecided? Try learning one idea from a paragraph you supply.

## Continue my project

> Read Home and Context. Recover my saved Next action and its evidence, then help me continue without repeating setup.

Follow [Context](03-Resources/Procedures/context.md), then [Close](03-Resources/Procedures/close.md) to save what changed and the next step.

## Connect a repository

A repository you already work in can be registered here. From the starter copy, run `node ./bin/second-brain.mjs connect --target <this folder> --repo <that repository>`. It prints the complete plan and writes nothing until you approve that exact digest.

On a repository with no Spec Harness files (the harness is the set of agent rules and commands that Spec Harness installs), approval stages them there. The files are uncommitted, and your team decides whether they go in by pull request. Then open the repository in your client and run `/sdd init`. The repository stays STAGED until `.claude/agents/.init-synthesis.json` exists.

Each connection gets a folder under `01-Projects/` with its own `README.md` and a `Connection.md` record. Run `node ./bin/second-brain.mjs verify --target <this folder>` from the starter copy to see each connection's current status.

## Current records

These four link to `Selected-Project`, the seeded project. For another project, use the same four records in its folder under `01-Projects/`.

[Facts](01-Projects/Selected-Project/FACTS.md) · [Roadmap](01-Projects/Selected-Project/roadmap.md) · [Progress](01-Projects/Selected-Project/progress.md) · [Decisions](01-Projects/Selected-Project/Decisions.md)

Current values live in these owners. Home only points to them. Any other project keeps its records in its own folder under `01-Projects/`, a copy of the project template, with its own `README.md` map. Its code stays where it is.

## When a need repeats

[Your extensions](03-Resources/Extensions.md) links your reusable references and methods. Use [Extend](03-Resources/Procedures/extend.md) for a named repeated need after first use.

## More

- Daily work: [Focus](00-Meta/Daily-Task-Plan.md), [Capture](03-Resources/Procedures/capture.md), [Review](03-Resources/Procedures/review.md).
- Maps: [Operating](00-Meta/README.md), [Projects](01-Projects/README.md), [Seeded project](01-Projects/Selected-Project/README.md), [Resources](03-Resources/README.md), [Procedures](03-Resources/Procedures/README.md).
- Who I am: [Profile](00-Meta/Profile.md) sets how answers are given and what is never touched.
- Reference: [Assistant route](00-Meta/AGENTS.md), [Cross-project decisions](00-Meta/Decisions.md), [PARA + CODE](03-Resources/PARA-CODE.md), [Areas](02-Areas/Areas.md), [Learning and scaling](03-Resources/Procedures/learning-and-scaling.md), [Archive guide](04-Archives/Projects/Archive-Guide.md), [Daily template](05-Daily/daily-template.md).
