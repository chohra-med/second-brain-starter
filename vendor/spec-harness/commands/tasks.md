# Command: `tasks` — accepted plan → ordered task list

> The task list stays inside the feature packet and translates the accepted plan into executable,
> checkable units.

## Invocation

```text
/sdd <accepted ticket packet>
```

Read `.claude/commands/sdd.md`, `specs/<feature>/spec.md`, `goal.md`, `plan.md`, the target rules and
the synthesis receipt. The bound project-aware planner owns decomposition; the implementer does not
approve its own tasks or goal.

## Each task records

- title and exact repo-relative files to create or edit;
- criterion(s) from `specs/<feature>/goal.md` that it advances;
- literal task acceptance and the real command(s) that prove it;
- dependencies and the smallest safe order;
- any policy or user authorization boundary before an effect.

Put risky core behavior and its failing test before integration. Do not invent a test command where
the target has none; record the gap for Grill Me or the ticket owner. The final task list records
the accepted spec, goal, source and rule hashes. Any changed hash invalidates affected tasks and
gate evidence.
