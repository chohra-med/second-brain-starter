# Command: `tester` — adversarially validate the critical workflows

> The proactive complement to `verify`. `verify` checks one *change* against `/goal`; `tester` checks
> **reality against the critical journeys** — it loads the `workflows/` bank and, for each journey,
> spawns a clean-context agent that RUNS it end-to-end **and actively tries to break it**, then reports
> which workflows are BROKEN, ranked by importance (P0 first). A BROKEN result preserves evidence and
> can be sent through the reviewed `learn` procedure; it does not automatically change policy.

## Invocation
```
spec-harness tester                 # PENDING/manual handoff; no workflows run
spec-harness tester <id>             # same handoff, with a workflow id
spec-harness tester --scan [<sub>]   # same handoff; no scan runs
```
The shell invocations print this manual procedure and return `PENDING`; they do not run a workflow.
In a capable client with the installed route, `/spec-harness:tester` ("test the workflows", "try to
break the app", "which critical flows are broken") invokes the `sdd-workflow-tester` agent — one
**clean context per workflow**.

## What it does
1. **Load the bank.** Read every `workflows/*.md` (or the one `<id>`). Sort by `importance` — **P0
   first**, then P1, then P2. A workflow with no runnable `how_to_run` is reported as *untestable*
   (fix the workflow before you can trust a PASS — same spirit as an unverifiable goal).
2. **Per workflow, spawn a fresh `sdd-workflow-tester`** (clean context, no stake). It:
   - (a) **runs the journey end-to-end** via the workflow's `how_to_run` (e2e command / API calls /
     agent-driven UI), establishing the happy-path baseline;
   - (b) **adversarially tries to break it** — bad/malformed inputs, killed/interrupted mid-flow,
     races & double-submits, offline/flaky network, repeated taps/replays, boundary values,
     out-of-order re-entry — attacking the workflow's **named invariants** first;
   - (c) returns **PASS** or **BROKEN** with a concrete **repro** (steps → input → observed failure →
     violated invariant → likely cause → recommended regression guard).
3. **Aggregate into a ranked report.** Collect every verdict into ONE report, **BROKEN P0s at the
   top**, each with its repro. This is the "what's on fire, worst first" view.
4. **Route BROKEN evidence through the learning loop** (below) for capture and review.

## The adversarial playbook (what "try to break it" means)
The agent doesn't just re-run the happy path — it attacks the invariant the workflow says must hold:

| Attack | Hunts for |
|---|---|
| Bad / malformed inputs | unhandled errors, corrupt writes |
| Kill / interrupt mid-flow | **partial writes**, wedged state |
| Races / double-submit / concurrency | **double records, double charges**, lost updates |
| Repeated / replayed actions | **idempotency breaks** |
| Offline / flaky network | silent data loss, desync, stuck UI |
| Boundary values (0/1/max/max+1/empty/unicode) | off-by-one, overflow, truncation |
| Out-of-order / re-entry | state-machine holes |

Budget by importance: a **P0** gets the hardest, widest attack; P1 a standard pass; P2 if time allows.

## `--scan` — derive candidate workflows from the app (like `rules --scan`)
When the bank is thin or empty, don't invent journeys — **derive** them from the real app, then let a
human confirm:
1. **Read the app's surface** — routes/screens, entry points, key features, and (most telling) the
   **write paths** in the code (what persists, what charges, what mutates shared state). A journey that
   writes or takes money is a P0 candidate.
2. **Propose** each candidate as a draft `workflows/<id>.md` in the standard format (id/title/
   importance/preconditions/steps/expected/how_to_run), with a best-guess `how_to_run` from the
   detected stack (e2e command, API route, or an agent-driven-UI recipe).
3. **It proposes; you keep what's real.** Confirm/trim the drafts — then `spec-harness tester` runs them.
Same discovery posture as `rules --scan`: generated from the real code, never fabricated.

## Feed BROKEN evidence through the learning review
A BROKEN workflow is evidence to preserve and classify, not a policy change. For each result, use
`learn` (see `commands/learn.md`) to:
- **CAPTURE** the exact repro in `.memory/80-feedback.md` with its date.
- **PROPOSE and CLASSIFY** a likely cause, candidate rule or regression guard, and canonical owner.
- **OBTAIN the project's existing human or reviewer decision** before changing canonical policy.
  Pending or rejected proposals stay recorded without policy mutation.
- **APPLY after approval only.** Add a dated rule or regression test only when approved, then refresh
  affected bindings and run their relevant structural or provenance check.

## Output (always report)
```markdown
# Workflow test report — <N> workflows (<P0>/<P1>/<P2>)

RESULT: <B> BROKEN, <P> PASS, <U> untestable

## 🔴 BROKEN — ranked (P0 first)
1. [P0] <id> — <title>
   - repro: <steps → input → observed failure>
   - violated invariant: "<…>"
   - → learn: captured · proposed: `<cause, owner, candidate guard>` · review: PENDING
2. [P1] <id> — …

## ✅ PASS (held under attack)
- [P0] <id> · [P1] <id> · …

## ⚠ Untestable (no runnable how_to_run — fix the workflow)
- <id> — <why>
```

## Why a separate command (and a separate agent)
So you can point it at the app **any time** — after a refactor, before a release, on a schedule — not
only when a specific change is in flight. The agent that wrote the feature is the last one who'll go
looking for how it breaks; a clean-context adversary with no stake is the one who finds the double-submit
that creates two records. `verify` checks *this change* against its goal; `tester` attacks configured
journeys. Both can send evidence through `learn`; only the project's existing review authority can
approve a canonical policy change.

## Hard rules
- **The tester never fixes code.** It reports BROKEN + a repro; the orchestrator routes the fix through
  the implementer, then re-runs `tester <id>` to confirm the journey holds.
- **P0 first, hardest.** Ranking is by `importance`; a P0 BROKEN stops the line.
- **No repro, no bug.** A BROKEN verdict without a replayable repro is not actionable — reject it.
- **Route every BROKEN through `learn` for review.** Capture and classify the evidence; apply a dated
  rule or regression test only after the project's existing authority approves it. No guard guarantees
  that a journey cannot break again.
- **Derive, never fabricate.** `--scan` proposes workflows from the real app surface; a human confirms.
