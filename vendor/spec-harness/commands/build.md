# Command: `build` — execute one accepted feature packet

> The shared `.claude/commands/sdd.md` procedure owns route, context, authorization and acceptance.
> This file owns the task-sized implementation cycle.

## Invocation

```text
/sdd <feature packet>
```

Before code, confirm the recorded MICRO/LITE/FULL class and reason, exact input, accepted spec and
feature goal, source identity, applicable rule hashes, declared dependencies and authority are current.
MICRO follows the light route in `.claude/commands/sdd.md`. For LITE, concise inline intent may replace a separate planning artifact when no material
architecture/reuse decision exists; preserve enough accepted plan/task evidence for the independent
verifier and reviewer. FULL uses the complete packet. If initialized source or policy changed, complete the guarded refresh
owned by `.claude/commands/sdd.md` and rerun its structural and semantic checks first. Use only the project-bound role paths in
`.claude/agents/.init-synthesis.json`. If the receipt or semantic initialization review is PENDING,
do not substitute generic agents.

## Per-task cycle

1. Research only when a material fact is unsettled; cite the actual source or primary reference.
2. After reviewing the actual target source and tests for the task, pass the fresh implementer context the Ponytail owner at `.claude/commands/spec-harness/ponytail.md` (source checkout fallback: `commands/ponytail.md`) before edits. The bound implementer, on the model its tier resolved to in the shared SDD stage map, makes one task-sized change and records changed paths and revision.
3. The fresh bound tester, using its separately confirmed model/context, runs the listed commands and adversarial cases. Save actual commands,
   outputs and its context/model identity to `specs/<feature>/gates/tester.md`.
4. The separate fresh bound verifier, using its separately confirmed model/context, checks each literal criterion in
   `specs/<feature>/goal.md`; save result and evidence to `gates/verifier.md`.
5. A third fresh bound reviewer, using its separately confirmed model/context, checks the diff against the spec, goal, rules and task scope;
   save findings to `gates/reviewer.md`.
6. If any gate fails, return to the implementer. Re-read changed inputs and invalidate only evidence
   tied to the affected spec, goal, rule, source or declared dependency; widen through declared
   dependents when a shared interface changes. After two unsuccessful ordinary correction rounds, stop
   unaccepted, record a causal diagnosis and propose a changed bounded strategy. Do not reset the count
   or record PASS. The separate adversarial release loop remains governed by its own policy.

The fresh goal verifier is mandatory for every class. Reuse a gate receipt only when its exact source,
accepted goal, applicable rules and declared dependency identities match; otherwise rerun that gate in a
fresh context. This is manual evidence reuse, not automatic caching. The implementer never writes its own tester, verifier or reviewer result. If a separate fresh
context is unavailable, leave the relevant gate PENDING; an unavailable model falls back to the nearest tier. Passing
tests/review does not authorize external write-back, commit, push, merge, deployment or release.

## Completion

The orchestrator marks a task complete only after fresh tester, verifier and reviewer records all
pass against the same source/rule/goal revisions. A MICRO ticket completes on the single fresh
verifier result in `specs/<feature>/ticket.md` (light route in `.claude/commands/sdd.md`). Merger action follows `.claude/commands/sdd.md`
and the project's explicit authority; default is report-and-wait.
