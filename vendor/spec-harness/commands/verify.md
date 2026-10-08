# Command: `verify` — check a feature goal in a separate context

> A shell handoff is not a verifier run. A feature verifier uses the accepted ticket's own goal and
> returns measured evidence.

## Invocation

```text
/sdd <feature packet>
spec-harness verify --goal specs/<feature>/goal.md   # prints a PENDING manual handoff; exit 2
```

Read `.claude/commands/sdd.md` and the packet's `spec.md`, `goal.md`, source state and relevant
rules. Use the `sdd-verifier` path recorded in `.claude/agents/.init-synthesis.json` and a fresh
review-tier context distinct from the implementer and tester (`Model tiers` in
`.claude/commands/sdd.md`). If no separate context is available, keep the gate PENDING/UNVERIFIED.

## Verifier result

1. Confirm that the feature goal names the accepted `spec.md` hash and current source/rule revision.
2. Check every criterion against the exact command, file, endpoint or observation it names.
3. Return `RESULT: PASS|FAIL` with one evidence item for each criterion. An unmet or unverifiable
   criterion is FAIL; stale inputs or unavailable tools are PENDING.
4. Save the context/model identity, source/rule/goal hashes and result at
   `specs/<feature>/gates/verifier.md`.

For a MICRO ticket the goal is `specs/<feature>/ticket.md`: return the result to the orchestrator,
save no hashes and write no `gates/` file.

The verifier checks `specs/<feature>/goal.md`, never an unrelated root `goal.md`. A result does not
grant commit, merge, deployment or release authority.
