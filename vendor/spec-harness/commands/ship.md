# Command: `ship` — prepare a separately authorized delivery

> The shared SDD procedure gates delivery. This command records the release plan; it does not
> grant permission to commit, push, merge, deploy or publish.

## Invocation

```text
/sdd <feature packet>
spec-harness ship             # manual instructions only; no external action is performed
```

Read the packet's `spec.md`, `goal.md`, source revision and gate records under
`specs/<feature>/gates/`. A delivery is eligible for a decision only when fresh tester, verifier and
reviewer results pass against the same current inputs. For a MICRO ticket the required set is the
single fresh verifier PASS in `specs/<feature>/ticket.md`, and the grant is recorded there.

## Merger authority

If the task requires a merge decision, select the project's merger role only when its policy grants
that role. The role records the policy path/hash, current goal/rule/source hashes, exact user grant,
and result in `specs/<feature>/gates/merge.md`. Without explicit authority, report-and-wait. Passing
gates do not authorize a delivery effect.

Each external or repository effect requires its own explicit authorization at the action boundary:
ticket write-back, commit, push, merge, deploy, release or publication. Apply the project's secret,
protected-path and release checks where they exist. Report unavailable checks; never imply a PR or
release exists from instructions or a green local suite.
