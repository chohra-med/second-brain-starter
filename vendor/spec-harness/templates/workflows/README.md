# `workflows/` — the critical-journey bank (peer of `specs/`)

> **What `specs/` is to a change, `workflows/` is to reality.** A spec describes one feature you're
> about to build; a workflow describes a **critical user journey that must never break** — the paths
> that, if broken in production, cost you users, money, or trust. The `tester` command loads this
> bank and, for each workflow, spawns a clean-context **`sdd-workflow-tester`** agent that runs the
> journey end-to-end **and adversarially tries to break it**, then reports PASS or BROKEN.

This is the proactive complement to the verifier: the `sdd-verifier` checks a *specific change*
against `/goal`; the tester checks *the whole app's critical journeys* against reality and actively
tries to break them. A BROKEN workflow goes to `commands/learn.md` for capture, cause and owner
proposal, classification, and review by the existing authority. Apply a dated rule or guard only
after approval.

## One file per workflow

Each critical journey is one markdown file, `workflows/<id>.md`, in the small stack-agnostic format
below (see `EXAMPLE.md` for a filled, copy-ready P0). Keep it a **journey**, not a unit test — the
smallest thing a real user does end-to-end that must hold.

```
---
id: <kebab-case-id>            # stable handle; `spec-harness tester <id>` runs just this one
title: <one line — the journey in plain language>
importance: P0 | P1 | P2       # P0 = app is broken if this fails (test these first / hardest)
---

## Preconditions
- <state that must exist before the journey starts — fresh install, a seeded user, an auth token>

## Steps
1. (user) <a user action — tap, type, navigate>            # or (api) for a request
2. (api)  <POST /endpoint with body …>
3. …

## Expected
- Outcomes: <what the user/caller should observe — a screen, a 200, a persisted row>
- Invariants: <what must ALWAYS hold, the adversarial target — e.g. "runs exactly once
  (idempotent): replaying step 2 creates no second record", "no partial write on interruption",
  "state survives a kill + relaunch">

## How to run
- <e2e command, e.g. `npm run e2e -- onboarding` — the preferred, automatable path>
- <API calls, e.g. a `curl` sequence — for a backend workflow>
- <agent-driven UI: "drive with the agent-browser skill: open …, tap …, assert …" — when there's
  no e2e harness and a human/agent must exercise the real UI>
```

## Importance ranking (drives the report order and the adversarial budget)

| Tier | Meaning | The tester's posture |
|---|---|---|
| **P0** | The app is broken without it (sign-up, checkout, the core action, data that must persist). | Run first, break hardest. A P0 BROKEN is a stop-the-line finding. |
| **P1** | Important but survivable for a short window (secondary flows, settings, non-blocking sync). | Run after P0; standard adversarial pass. |
| **P2** | Nice-to-have / edge journeys. | Run if budget allows. |

## How the bank gets filled

- **By hand:** copy `EXAMPLE.md`, rename the file to `<id>.md`, fill the five sections.
- **By `--scan`:** the shell route prints PENDING/manual. A capable client may inspect app evidence
  (routes, entry points, key features, and write paths) and propose candidate P0/P1 workflows as
  draft files here for a human to confirm. Keep only what matches the actual app.

## Rules for a good workflow

- **A journey, not an assertion.** "User completes onboarding and it persists once" — not "the POST
  returns 200". The invariant is the assertion; the steps are the journey around it.
- **Name the invariant that can break under stress.** Idempotency, no-partial-write, survives-kill,
  no-double-charge. That line is what the tester attacks.
- **Give a runnable `how_to_run`.** A workflow with no way to execute it can't be tested — prefer an
  e2e command or API sequence; fall back to an agent-driven-UI recipe only when nothing else exists.
- **Stack-agnostic.** The same format holds for an RN app (e2e / agent-driven UI), a FastAPI backend
  (curl / httpx sequence), or a web app (Playwright / agent-browser). Put the stack specifics in
  `how_to_run`, keep the rest portable.
