# Command: `learn` — capture feedback and review proposed learning

> `learn` preserves the raw correction, proposes one testable cause and owner, then uses the
> project's existing human or reviewer authority before changing canonical policy.

## When to run it

- A human correction, code-review finding, postmortem or verifier/tester failure.
- At the end of a build when a reusable rule may have been learned.
- A decision made during a ticket that later tickets should follow.

The `sdd-learner` role runs this procedure in a fresh context. It improves rules and project
skills; it never edits application source.

## Invocation

```text
spec-harness learn "<feedback or correction>"
spec-harness learn --from .memory/80-feedback.md
```

## Procedure

1. **Capture.** Append the original feedback to `.memory/80-feedback.md` with date, triggering
   file or behavior, expected behavior and exact evidence. Preserve the raw signal. Record a decision, its options and
   its reason in `.memory/60-decisions.md`.
2. **Propose.** Distill one testable cause and candidate rule. Label it proposed; do not modify
   canonical rules during capture or classification. A cause or decision that appears in two or more
   entries is a candidate even when each entry was a one-off.
3. **Classify.** Name the candidate owner, package path and concern (`Coding`, `Architecture`,
   `Packages`, `Testing`, `Reviewing`, or another applicable concern). Check that the evidence
   supports the cause and that the owner is current. A one-off, unsupported cause, rule conflict or
   unresolved owner stays captured/proposed and returns PENDING.
4. **Review.** Obtain the decision from the project's existing human or reviewer authority. Record
   the decision and evidence alongside the proposal. If rejected or deferred, keep the raw feedback
   and proposed classification; stop without changing canonical policy.
5. **Apply only after approval.** Append or sharpen the dated rule, or correct the project skill, in
   its reviewed canonical owner.
   Preserve history and unrelated policy. If another current rule conflicts, stop and return it to
   its owner rather than silently replacing it.
6. **Report stale bindings.** Name the roles and skills whose cited source, rule owner, package
   path or concern changed. The learner does not regenerate them: the orchestrator runs the guarded
   refresh in `.claude/commands/sdd.md` and the structural check. Until that passes, readiness is
   PENDING.

## Human learning (optional)

After review, a reusable technique may be recorded in `learning/NOTES.md` or
`learning/lessons/`. A one-off does not need a lesson.

## Output

Before an approved rule is applied, report:

```text
PENDING: feedback captured; classification proposed
  captured: .memory/80-feedback.md
  proposed: <cause and candidate rule>
  owner: <candidate file, package and concern>
  review: <existing authority and pending/approved/rejected decision>
```

After the existing authority approves and the rule is applied, report:

```text
LEARNED: <one-line testable rule>
  captured: .memory/80-feedback.md
  reviewed: <decision evidence>
  applied: <canonical file> (package + concern)
  stale bindings: <affected paths for the orchestrator to refresh, or none>
  readiness: <exact check and result, or PENDING reason>
  taught: <lesson path, or skipped with reason>
```

`LEARNED` means reviewed and applied. Capturing feedback or proposing a classification alone is
never `LEARNED`; feedback capture does not authorize policy mutation or external effects.
