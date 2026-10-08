# Command: `tickets` — resolve input into a feature packet

> Ticket intake is the first stage of the shared `/sdd` procedure. The route owns one feature
> packet and one feature-specific verifier goal; this file supplies the intake details.

## Invocation

```text
/sdd <exact ticket text>
/sdd ticket <connected provider reference>
spec-harness sdd <input>       # shell-only manual handoff; exit 2 / PENDING
```

Read `.claude/commands/sdd.md` first. The shell CLI cannot retrieve issues or synthesize artifacts.
Continue in a capable model context only after checking the declared client/provider/model route.

## Accepted input

1. **Inline text:** preserve the exact supplied bytes at `specs/<feature>/input.md` before
   interpretation. Record its SHA-256 in `spec.md`.
2. **Connected reference:** retrieve the full body through an actually connected read-capable
   provider. Record provider, ticket ID or URL, retrieval time and body SHA-256, then preserve the
   retrieved text at `input.md`.

A bare issue name, title, inaccessible URL or unconnected provider has no retrievable body. Return
`PENDING: ticket body unavailable; provide the body or connect a retrievable reference`. Never
invent requirements, overwrite an existing packet, or write status back to the issue.

## Output

Create one new `specs/<feature>/` packet as described by `.claude/commands/sdd.md`:

- `input.md` — exact input and source identity;
- `spec.md` — problem, scope and checkable acceptance;
- `goal.md` — literal feature end-state checks derived from the accepted spec;
- `plan.md` — design, Ponytail receipt and resolved Grill Me rulings;
- `tasks.md` — ordered work with changed paths, acceptance, tests and dependencies;
- `gates/` — separate tester, verifier, reviewer and merger records.

A MICRO ticket writes one `ticket.md` instead of this packet; its goal checks are the verifier
target. Otherwise the ticket's `goal.md` is the verifier target. Root `goal.md` remains untouched. No external
write-back, commit, push, merge, deployment or release follows from intake.
