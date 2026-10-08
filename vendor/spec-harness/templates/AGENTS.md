# Agent rules — {{PROJECT_NAME}}

> **Reviewed ratchet:** this file may be sharpened after a failure is understood and classified;
> failures do not add policy automatically. Preserve feedback and rule history.
> This is the harness. A decent model with a great harness beats a great model with a bad one.
>
> Read by every agent in the SDD pipeline before it acts. Stack-specific content is derived only
> after install from this project's evidence; the bullets remain PENDING until that work is checked.

## Setup status

The installer creates a **PENDING scaffold**. This file is not a completed project policy until
the protected paths, stop conditions, retry limit, and stack rules below are derived from the
project's own policies and code, then reviewed. Do not report the harness READY while any setup
or acceptance work remains.

## Hard constraints (never violate)

- Never run a destructive or merge action (`rm -rf`, `git push`, schema drop) without a
  passing **verifier** result.
- Never touch protected paths: `{{PROTECTED_PATHS}}`.
- Never invent an import, function, type, or component. Confirm it exists (grep/Read/index)
  before you call it. If you can't cite it, you don't use it.
- Stop and flag a human if: `{{STOP_CONDITIONS}}`.

## Definition of done

- A ticket task is done only when a fresh verifier returns PASS against that ticket's
  `specs/<feature>/goal.md`; do not substitute the unrelated root `goal.md`.
- "It ran without erroring" is **NOT** done. "Tests pass" is necessary, not sufficient — the
  goal end-state is the bar.

## On failure (the ratchet in motion)

- Do not retry blindly more than {{MAX_RETRIES}} times.
- Preserve the failure in the feedback log, then follow
  `.claude/commands/spec-harness/learn.md` to classify its cause.
  Add or sharpen a dated rule only after review establishes that it belongs in this policy owner.

## Stack-specific rules (generated at init)

{{STACK_RULES}}

## Ratchet log (append-only — reviewed policy changes with their cause)

<!-- ## YYYY-MM-DD — <what broke> → <the rule that now prevents it> -->
- *(none yet — the system is fresh)*
