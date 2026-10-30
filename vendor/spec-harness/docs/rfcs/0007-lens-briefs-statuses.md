# RFC 0007: Task type, project lens, gate briefs, blind-first review and implementer statuses

Status: proposal, implemented on this branch for review.

## Problem

Real runs showed three gaps.
- The reviewer reads the orchestrator's framing (plan, gate records) before the diff, so it tends to check what it was told to check. In one run, both blocking defects came from a reviewer pass that had not read the brief.
- A project has no place for checks that must hold on every ticket, such as "no private names in a public repo" or, for writing, "matches the voice file". Each brief re-states them or forgets them.
- The implementer's hand-back is free text, so the orchestrator cannot tell "done" from "done but worried" from "blocked". The router sizes a ticket but does not say what kind of work it is, so non-code work (a document, a decision) gets code-shaped gates.

## Proposal

1. **Task type (router).** The `## Route` block gains one line after `class:`:
   `type: code | doc | research | decision | review`. The class still decides which gates run.
   For a type other than `code`, "tests" means the checks that the goal and the lens name. The project test command runs only when the change touches code. `/sdd` copies `type` into the class record with the class.
2. **Project lens.** An optional file, `ai_rules/review-lens.md`, holds standing checks, one per line: `- **LENS-<n>** <check sentence>.` (a source tag is optional). Init stages a PENDING template. When the file exists, every LITE and FULL review must give each lens item a verdict (`MET`, `VIOLATED`, `NOT-APPLICABLE`). A missing verdict makes the review incomplete. A brief may add checks, never remove a lens item. `VIOLATED` is a `NEEDED` finding. MICRO is unchanged.
3. **Gate briefs.** For LITE and FULL, `plan.md` gains `## Gate briefs` with `### Tester brief` and `### Reviewer brief`. These are the orchestrator's extra cases and questions. They sit inside the approved `plan.md` bytes, so the existing checkpoint hash in the run state pins them. A later edit needs a new approval, as today.
4. **Blind-first review.** The reviewer works in two passes in one fresh context.
   - **Pass 1:** spec, goal, lens, rules, diff and the plan, except `## Gate briefs`. No gate records.
   - **Pass 2:** the reviewer reads the brief and the tester and verifier records, answers the brief, then writes `## What the brief missed`.
   - The report keeps both passes. The verdict covers both.
5. **Implementer statuses.** The implementer's hand-back ends with one status line, `STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`.
   - `DONE`: the gates run.
   - `DONE_WITH_CONCERNS`: the concerns are copied into the tester and reviewer dispatch, then the gates run.
   - `NEEDS_CONTEXT`: the orchestrator supplies the missing context and re-dispatches. This does not count as a correction round.
   - `BLOCKED`: stop, record the cause, and propose a changed strategy. It counts as a correction round.
6. **Reviewer bound to the lens.** `generate-agents` names the lens path and its item IDs in the reviewer's `GEN:rules` block. It names them and never copies their text, the same rule as for rule IDs.
7. **Policy citations.** A receipt citation may point at a project policy file listed in the inventory's `rule_files`, with `read_status: read` and a matching sha256, when that file is in the cited package's `applicable_instructions`. Each package still needs at least one representative-source citation. Today only sampled source files can be cited, so a rule taken from `AGENTS.md` cannot point at its real source.
8. **Memory kinds.** Optional extra memory files for projects that are not only code, staged under `.claude/spec-harness/memory-kinds/` the way rule packs are:
   - `content/voice-dna.md` and `content/audience.md`
   - `automation/pipeline.md`
   - `research/sources.md`

   Init copies the kinds that fit into `.memory/`. The core files stay as they are. `docs/MEMORY.md` maps the five roles to their one home each: product → `10-product`, decisions → `60-decisions`, active → `40-active`, progress → `50-progress`, lessons → `80-feedback`.

## Compatibility

- A route block without `type:` reads as `type: code`. A target without a lens file reviews exactly as today. A plan without `## Gate briefs` is valid; the reviewer then states "no brief" in Pass 2.
- The status words are new. The orchestrator treats a hand-back without a status line as `DONE_WITH_CONCERNS` with the concern "no status given".
- Receipt schemas do not change. Point 7 widens what one citation may point at, and old receipts stay valid.
- New staged files: `ai_rules/review-lens.md` (template) and `.claude/spec-harness/memory-kinds/**`. Existing target files are preserved as today.

## Tests

- `tests/router-contract.sh`: `type:` is in the block and in `/sdd`'s copy rule.
- `tests/sdd-fixtures.sh`: the reviewer has two passes, the lens verdicts and `What the brief missed`; the implementer has the four statuses; `plan.md` documents `## Gate briefs`.
- `tests/installer-fixtures.sh` and the install-manifest contract: the lens template and the kind files are staged and preserved.
- A synthesis fixture: a citation to an inventoried, read, hash-matching `AGENTS.md` passes. A citation to an unlisted file, a stale hash, or a package with only policy citations fails.

Red first for each.
