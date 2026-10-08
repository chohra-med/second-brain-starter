# {{PROJECT_NAME}} — Spec Harness entry point

Auto-loaded by Claude Code at session start. Read fully before any other action.

## 🧠 Behavioral foundation (override everything below on ambiguity)
1. Surface uncertainty first — state assumptions + tradeoffs before code.
2. Minimum code that solves the task. No speculative abstraction.
3. Surgical changes only. Touch only what the task requires.
4. State success criteria before coding. Verify before reporting done.

## 🛑 Mandatory startup sequence (do NOT write code until 1–5 done)
1. Setup status → `SPEC-HARNESS.md`; if it says PENDING, keep that status until the listed work is checked.
2. Rules index → `ai_rules/globalRules.md`
3. Hot memory → `.memory/40-active.md` + `.memory/50-progress.md`
4. **Frequent rules (REQUIRED before any code edit)** → `ai_rules/rules/frequent_rules.md`
5. Anti-hallucination checklist → `ai_rules/rules/context_management.md`
6. Context map → `ai_rules/context_map.md`
7. Confirm internally: "Spec Harness startup complete — frequent_rules.md loaded."

The deterministic installer stages files only. Generic templates, unbound roles, and a goal
template are not project-derived policy or acceptance; never call them READY by their presence.

## 🔒 The SDD pipeline (how work happens here)
Use `/sdd init` for project synthesis and `/sdd <ticket text or connected reference>` for feature
work. The shared procedure is `.claude/commands/sdd.md`; it creates a ticket-specific
`specs/<feature>/goal.md` and runs the independent tester, verifier and reviewer. A small fix takes
the light route instead: one `specs/<feature>/ticket.md`, an implementer and one fresh verifier. Never substitute
the unrelated root `goal.md`. Tests passing is necessary, not sufficient.

## ⚖️ The non-negotiables
- `constitution.md` — SDD articles (TDD, minimalism, type-safety, harness-around-the-dev).
- `AGENTS.md` — the reviewed ratchet. A failure is preserved and classified through `learn`; only
  reviewed durable corrections become dated rules.

## 🧠 Memory tiering
| Tier | Files | Load |
|---|---|---|
| Hot | `40-active`, `50-progress` | every session |
| Warm | `20-system`, `30-tech`, `60-decisions`, `70-knowledge` | architecture/decisions |
| Cold | `00-description`, `01-brief`, `10-product` | planning/onboarding |

**This is a Spec Harness project.** The scaffolding wraps the dev; the shipped artifact stays clean.
