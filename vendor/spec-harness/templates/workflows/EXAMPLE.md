---
id: new-user-onboarding-persists-once
title: A new user completes onboarding and it persists exactly once
importance: P0
---

> Copy this file to `workflows/<your-id>.md` and edit. This is a filled, generic P0 — the single
> most common must-never-break journey (a first-run user finishes onboarding and the result is saved
> once and only once). Keep the **Invariants** line sharp: it's what the `sdd-workflow-tester` attacks.

## Preconditions
- Fresh state: no prior session / no existing profile for this user (clean install, or a DB with no
  row for this account).
- The app/backend is running and reachable (the `how_to_run` command below can hit it).

## Steps
1. (user) Launch the app for the first time → the onboarding flow is shown (not the home screen).
2. (user) Complete every onboarding step, submitting the required answers.
3. (api)  On the final step the client sends the completion, e.g. `POST /onboarding/complete`
   with the collected answers + the user/session id.
4. (user) Land on the post-onboarding home screen.

## Expected
- Outcomes:
  - The final step succeeds (2xx) and the user reaches the home screen.
  - Re-launching the app goes **straight to home** — onboarding does not show again.
  - The collected answers are readable back (profile/GET reflects what was submitted).
- Invariants (the adversarial target — these must ALWAYS hold):
  - **Idempotent — persists exactly once.** Replaying step 3 (double-submit, retry, repeated tap)
    creates **no second** onboarding record and does not overwrite/duplicate the profile.
  - **No partial write on interruption.** If the flow is killed between step 2 and step 4, the user
    is either "not onboarded" (flow restartable) or "fully onboarded" — never a half-saved profile.
  - **Survives kill + relaunch.** A completed onboarding stays completed across an app kill/restart.

## How to run
- e2e (preferred): `npm run e2e -- onboarding`   ← replace with THIS project's real e2e command.
- API-only (backend workflow): a `curl`/`httpx` sequence that POSTs completion twice with the same
  idempotency key and asserts a single persisted record:
  `curl -sX POST "$BASE/onboarding/complete" -H 'Idempotency-Key: t1' -d @answers.json` (×2) →
  `curl -s "$BASE/profile/$USER"` shows one record.
- agent-driven UI (no e2e harness): drive the real UI with the `agent-browser` skill — open the app,
  complete every step, force-quit and relaunch to check persistence, then double-submit the final
  step to check idempotency; assert the home screen and a single profile.
