# Command: `spec` — input → feature spec and goal

> The shared SDD procedure owns the run. This stage writes the ticket's checkable "what".

## Invocation

```text
/sdd <ticket text or connected reference>
```

Read `.claude/commands/sdd.md` and `.claude/commands/spec-harness/tickets.md` first. Write only
inside `specs/<feature>/`; preserve root `goal.md` and every older feature packet.

## `spec.md` must contain

- **Intake provenance:** inline or provider source, exact input path/hash and retrieval time;
- **Source state:** commit plus working-diff hash, or an explicit non-Git marker and scoped hashes;
- **Rule context:** applicable policy/rule paths and hashes and the package paths in scope;
- **Authority:** the user's task scope, project policy, and each effect that still requires separate
  approval;
- **Problem and user request:** grounded in the ticket and inspected source;
- **Acceptance criteria:** each criterion has an observable true/false check;
- **Out of scope and constraints:** include external writes/releases that are not authorized.

No implementation details belong in the spec. If the request does not establish a checkable
end-state, use Grill Me after checking source evidence; unresolved material choices keep the packet
PENDING.

## `goal.md`

Derive `specs/<feature>/goal.md` from the accepted spec. Every checkbox states one literal end-state
and names the observation or command that proves it. Record the accepted `spec.md` SHA-256. Do not
point verification at the root goal or copy criteria that do not apply to this feature.
