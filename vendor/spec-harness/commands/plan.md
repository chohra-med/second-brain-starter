# Command: `plan` — accepted spec → bounded design

> The shared SDD procedure owns the run. This stage describes the smallest justified way to meet
> the feature goal.

## Invocation

```text
/sdd <accepted ticket packet>
```

Read `.claude/commands/sdd.md`, the accepted `specs/<feature>/input.md`, `spec.md`, `goal.md`, any
existing `plan.md` and `tasks.md`, target rules, relevant source, inventory and current receipt
before planning. Read `design.md` and `research.md` when present or selected for this ticket. The
bound planner writes or updates `plan.md` first, then `tasks.md`; neither optional artifact is a
prerequisite for a trivial ticket.

Before dispatch, resolve planner, implementer, separate fresh tester, verifier, reviewer and
finisher to model tiers using the `Model tiers` table in `.claude/commands/sdd.md` (source checkout:
`commands/sdd.md`), and confirm the serving models with the active client. Planning runs on the
strong tier. An unavailable model moves to the nearest available tier and is recorded; a missing
separate context leaves that gate PENDING. Never infer dispatch from `model:` frontmatter.

## Grill Me and Ponytail receipts

Read the installed method owners from `.claude/commands/spec-harness/{ponytail,grill-me,package-finder,skill-finder}.md` when relevant (source checkout fallback: `commands/`). First inspect actual project rules, source, package boundaries, manifests/lockfiles and project-local installed skills. Follow those owners and record their evidence and outcomes in `plan.md`; do not duplicate their procedures here.

Use Package Finder for version-dependent package decisions and Skill Finder when reusable agent
skills may apply. Check available Context7/Vercel discovery capability and inspect actual candidate
contents. Record selected/excluded evidence; unavailable tools, docs or compatibility remain
PENDING for the affected decision. Do not install packages or third-party skills during planning.

## `plan.md` must contain

- a source-grounded architecture/data-flow map;
- decisions with context, options, choice and reason;
- the hardest technical risk and its smallest testable approach;
- reused source paths/symbols and package boundaries;
- changed-file outline and the order that protects the accepted goal;
- the Ponytail receipt and Grill Me rulings/open questions;
- source, rule and goal hashes this plan assumes.

An unanswered material decision or changed input hash returns the packet to PENDING for resolution
or re-planning.
