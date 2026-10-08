# Command: `document` — docs + comments to the stack's standard

> Documentation is part of *done*. This raises comments + docs to **the idiomatic standard of the
> project's own technology** (Python docstrings, TS/JS TSDoc/JSDoc, GoDoc, rustdoc, Javadoc, …),
> without touching behavior — comment the WHY, never restate the WHAT.

## Invocation
```
spec-harness document [--scope <files|dir>] [--diff]
```
Runs the `sdd-documenter` agent. `--diff` documents only what changed (the current diff); `--scope`
targets named files/dirs; no flag → the public surface of the whole project.

## What it does
1. Detects the stack and reads the project's doc convention (`generate-agents`-filled rules + the
   nearest `RULES.md` **Coding/Docs** + how the already-well-documented files in the repo read).
2. Documents the public surface to that standard, fixes stale/contradictory comments, fills unfilled
   scaffolding placeholders, and refreshes README/ARCHITECTURE for anything the change altered.
3. Proves it changed **zero** behavior — re-runs the test suite — and, where present, runs the stack's
   doc build (`typedoc`/`go doc`/`cargo doc`/`javadoc`/doctest) so a doc that breaks the doc build fails.

## Where it sits in the pipeline
After the implementer's diff is green and the **verifier** returns PASS, before/with **review**:

```
spec → plan → tasks → build (implement → test → verify → review)
                                            └── document ──┘   # docs to standard, behavior-locked
```
Run it through a capable model/client anytime to bring a subtree up to the doc bar. Verification
uses the explicitly selected goal: ticket work uses `specs/<feature>/goal.md`, while standalone
work requires a caller-supplied goal path. The shell `spec-harness verify --goal <selected-goal>`
prints a PENDING handoff and exits 2; it does not execute verification checks.

## Why a separate agent
Documentation drifts because it's everyone's job and no one's gate. A dedicated pass with one bar —
*the stack's own standard, WHY over WHAT, truthful to the code* — stops "docs later" from meaning
never, and stops a well-meaning implementer from burying logic under comments that restate it.
