# First loop and projects

This page covers what to do after setup: the first project, the working loop, a second project, and the file tools you can use.

## Start one project

1. Open the installed `Home.md` in your target. It is the dashboard for the project you will run. The source template is [template/Home.md](../template/Home.md). It is not the workspace you will edit.
2. Choose one active project. Do not turn this into a life archive on day one. Start with one project and add others later.
3. Follow Home's [First use](../template/03-Resources/Procedures/first-use.md) route in the installed target. Agree the missing goal and constraints, approve the exact record edits, then approve and finish one small artifact with a check. Preserve existing personalized records. Close the result and start a new chat in that target to recover the next action.
4. The Profile interview is part of that route. It asks only the four questions whose answers are still missing in `00-Meta/Profile.md`: your role, how you want answers given and what must never be touched (asked by `init.md`), and your stack (asked by `complete-init.md`). An answer you do not give stays `Unknown`, so a later session asks again instead of guessing.
5. The initializer writes compatible root loader and skill files for supported-client discovery. These are twelve skills in `.claude/skills/` and `.agents/skills/`, plus installed `AGENTS.md` and `CLAUDE.md` loaders. Give a client local-file access only when you intend it, then inspect those files in the target. Clean authenticated discovery evidence for the named supported clients is pending. These files do not grant file access, enforce compliance, or establish universal client support.
6. A text editor is enough. You may test a copied target as an Obsidian vault, but current Obsidian desktop compatibility has not been verified.

## The working loop

```text
Focus -> Context -> Do -> Close -> Review
```

1. **Focus:** choose one outcome in the installed `00-Meta/Daily-Task-Plan.md`.
2. **Context:** read the project route and return the compact context note from [context](../template/03-Resources/Procedures/context.md).
3. **Do:** complete the next action from the selected project's [roadmap](../template/01-Projects/Selected-Project/roadmap.md). When new work arrives, follow [capture](../template/03-Resources/Procedures/capture.md) to record it with an owner, `Open` status, evidence for done, and one next action.
4. **Close:** record what changed and its evidence in [progress](../template/01-Projects/Selected-Project/progress.md), then use [close](../template/03-Resources/Procedures/close.md). A task is not `Verified` until its stated evidence exists.
5. **Review:** before a handoff or weekly, use [review](../template/03-Resources/Procedures/review.md). Repair any mismatch between a `Done` claim and its required evidence, then name one `Next` action.

The folders follow the PARA method, and the work follows CODE. Read [PARA + CODE](../template/03-Resources/PARA-CODE.md) for the short definitions.

For system architecture maintenance, use `second-brain-icm` before changing rules, skills or context routes. It holds this workspace's local bindings and change contract, and it names its method owner: the bundled [`icm-architect`](../template/shared-skills/icm-architect/SKILL.md) skill by Jake Van Clief, copied unmodified under its MIT license (see [ATTRIBUTION.md](../ATTRIBUTION.md)). Ordinary notes keep the compact project route. If native invocation is unavailable, manually read both installed skill files. Automatic discovery remains unverified.

## A second project

To start a second project, copy the installed `03-Resources/_templates/project/` folder into `01-Projects/` under the new project's name. The initializer still seeds one project, `Selected-Project`, and does not rename it. To register a repository you already work in, use `connect` instead. See [connect a repository](connect-a-repository.md).

## Extend the workspace

For a repeated need after setup, follow installed Home, then Your extensions. The [extension guide](../template/03-Resources/Procedures/extend.md) covers user-owned references, methods and optional thin skills.
