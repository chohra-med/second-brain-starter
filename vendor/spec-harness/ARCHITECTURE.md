# Architecture

> Three pillars, one name. **Spec** + **Harness**: spec-driven development, wrapped in a harness.
>
> `Memory bank · Spec-Driven Development · Harness (ratchet + verifier + tester + learning loop)`
>
> Lineage it inherits (each wrapped the last, none replaced it): `prompt → context → harness →
> learning`. Feedback is preserved and classified; reviewed durable corrections may become rules.

---

## 0. The whole system on one page

```
                        ┌──────────────────────────────────────────┐
                        │   HARNESS  (reviewed guidance and separate checks)  │
                        │   ratchet (AGENTS.md, reviewed changes)   │
                        │   + VERIFIER (separate, PASS/FAIL)        │
                        │   + TESTER (adversarial, breaks the       │
                        │     critical workflows/, BROKEN + repro)  │
                        │   + LEARNING LOOP (feedback → classified  │
                        │     → reviewed durable rule when justified)│
                        └───────────────────┬──────────────────────┘
                                            │ guides + checks
                        ┌───────────────────▼──────────────────────┐
                        │   SPEC-DRIVEN DEVELOPMENT (the process)   │
                        │   feature spec + goal → plan → tasks      │
                        │   → implementation + independent gates    │
                        │   guided by a project constitution     │
                        └───────────────────┬──────────────────────┘
                                            │ stands on
                        ┌───────────────────▼──────────────────────┐
                        │   Memory bank: the memory/context engine  │
                        │   Index · Memory bank (.memory/, 10) ·    │
                        │   curated > structural > temporal         │
                        └──────────────────────────────────────────┘
```

The three pillars support different parts of the workflow: project memory can provide context; SDD
organizes work; and the harness describes guidance, independent checks, and reviewed learning. They
can help surface errors when project context is current and checks are configured, but they do not
guarantee correct outputs or prevent every mistake. The bundled `bin/loop.sh` is a legacy illustration
(§4b), not a verified autonomous runner.

---

## 1. Memory bank: the memory/context engine (pillar 1)

```
┌─ Layer 1 — INDEX ─────────────────────────────────────────────┐
│  context_map.md or project_inventory.json                    │
│  "where things live" — helps navigate; verify against source  │
└──────────────────────────┬────────────────────────────────────┘
                           ↓ feeds
┌─ Layer 2 — MEMORY (.memory/, 10 tiered files) ────────────────┐
│  Hot:  40-active · 50-progress · 80-feedback (learning inbox)  │
│  Warm: 20-system · 30-tech · 60-decisions · 70-knowledge     │
│  Cold: 00-description · 01-brief · 10-product                 │
└──────────────────────────┬────────────────────────────────────┘
                           ↓ governed by
┌─ Layer 3 — RULES (ai_rules/rules/) ───────────────────────────┐
│  Critical (always): core · context_management · frequent_rules│
│  Feature (on-demand): testing · api · algorithm · ...         │
│  Living: updated_rules.md (dated overrides)                   │
└──────────────────────────┬────────────────────────────────────┘
                           ↓ orchestrated by
┌─ Layer 4 — AGENTS (.claude/agents/) ──────────────────────────┐
│  researcher → planner → implementer → tester → VERIFIER → reviewer
│  UI diffs add a second gate after the verifier: DESIGN-VERIFIER
│  (impeccable detect + ui-ux-pro-max + design-taste as PASS/FAIL)
│  Small fixes: implementer → VERIFIER only. After a ticket: LEARNER.
│  Each role asks for a model tier: strong · fast · review.
└───────────────────────────────────────────────────────────────┘
```

### Three indexes, one precedence rule

```
   curated  >  structural  >  temporal
   .memory/    graphify-out/  claude-mem
   the truth   what imports   what happened
   (git)       what (AST)     across sessions
```

**Curated project memory is the preferred reference in this model.** Structural and temporal views
help locate evidence; check the underlying source when they disagree. Reviewed learnings may be
recorded in the appropriate project memory owner.

---

## 2. SDD workflow — intent as the source of truth (added)

```
  ticket input ──▶ spec.md + goal.md ──plan──▶ plan.md ──tasks──▶ tasks.md ──build──▶ code
   │                the WHAT + goal    the HOW               atomic units          + tests
   └───────────────┴─────────────────┴───────────────────┴───────────────────┘
                       guided by a project constitution when configured
                        (principles are reviewed for the target project)
```

Each artifact is a **markdown file that feeds the next** — structured context, not a wall of
prompt text. The spec is stable ("what"); the design is flexible ("how"); the tasks are the
executable bridge. `/analyze` (the `audit` command) is the cross-artifact consistency gate.

**Where Spec Harness plugs in:** the planner reads the selected package inventory, project rules
and relevant source before planning, so the packet references real components and records reuse.
Research is selected only when a material fact needs it.

---

## 3. The harness — the ratchet (added)

```
        mistake ──▶ fix the OUTPUT          (corrects this result)
        mistake ──▶ capture + review a correction (may reduce recurrence)

        The learn procedure asks for review before canonical policy changes:
        ┌───────────────────────────────┐
        │  v1: 3 rules                  │
        │  v2: reviewed rule added      │   preserve failure evidence
        │  v3: reviewed rule sharpened  │   add only durable corrections
        │  ...                          │
        └───────────────────────────────┘
        "A decent model with a great harness beats a great
         model with a bad harness." — the leverage is the structure.
```

The harness describes project guidance, roles, and checks intended to shape agent work. Agents can
still violate rules; a verifier, tester, or reviewer can report only the evidence it actually checks.
The shipped `learn` procedure preserves feedback, proposes and classifies a correction, then waits
for the project's existing human or reviewer authority before changing its canonical policy owner.
This can carry an approved correction into later work, but cannot guarantee the same failure will
never recur.

---

## 4. The learning loop — feedback may lead to a reviewed rule

The `learn` procedure preserves the original feedback, identifies its cause and classifies the
canonical owner. A reviewed, reusable correction may be added as a dated rule; conflicts return to
the policy owner. This keeps both the evidence and the ratchet without promoting every failure to
permanent policy.

```
        ┌─────────────┐    reads
        │   MEMORY    │◀───────────  .memory/ bank (before acting)
        └──────┬──────┘
               ▼
        ┌─────────────┐    obeys
        │    RULES    │◀───────────  AGENTS.md ratchet
        └──────┬──────┘
               ▼
        ┌─────────────┐
        │  ACT (SDD)  │  implementer produces the diff
        └──────┬──────┘
               ▼
        ┌─────────────┐    FEATURE GOAL CHECK
        │   VERIFY    │  fresh separate agent, only output: PASS/FAIL
        │  (verifier) │  against specs/<feature>/goal.md, not root goal.md.
        └──────┬──────┘
               │ PASS → record evidence tied to source/rule/goal revisions
               │ FAIL ─┐
               ▼       │ root cause
        ┌─────────────┐│  captured to .memory/80-feedback (the inbox)
        │   LEARN     │◀┘  classified → reviewed policy change when justified
        │ (the loop)  │   + optional human lesson → learning/lessons/
        └──────┬──────┘   preserve evidence; update policy only after review
               ▼
          (a durable reviewed rule can prevent recurrence)
```

> Human feedback enters the same route: `spec-harness learn "<correction>"` captures and classifies
> it. A durable rule is written only after review; otherwise the feedback remains preserved without
> changing project policy.

### 4b. Legacy illustration: `loop.sh`

The bundled `bin/loop.sh` is a legacy illustrative placeholder, not the supported ticket entrypoint
or a verified autonomous runtime. Use `/sdd` and the independent role gates for current work. The
notes below describe design concerns only; file presence is not evidence of a working runner.

> **The honest lesson this encodes:** a schedule or loop does not establish that work is correct.
> Verification needs a named goal and checks that actually ran. The bundled `loop.sh` does not
> provide or verify autonomous execution, budgets, permissions, or stop conditions.

### Why the verifier must be a separate agent

The agent that produced the work is not a neutral judge of the work. Same context = it
inherits the worker's optimism. The verifier gets a **clean context**, is told *"you did not
write this code, you have no stake in it passing,"* and runs each end-state check **literally**
(no inference). Only ALL-pass → PASS.

### Guardrails a future autonomous runner would need

| Guardrail | Why |
|---|---|
| **Run cap** (`MAX_RUNS`) | An unbounded loop on a metered model is the eye-watering-token-bill story, except it's yours. |
| **Spend cap** | Hard budget on the key. The schedule is never the only thing between you and the bill. |
| **Applicable check + authority** | A real runner would need configured checks and explicit approval for each guarded effect; `loop.sh` does not enforce them. |
| **Human stop-conditions** | The "open questions" in memory halt the loop; the loop does not get to decide what you didn't let it decide. |
| **Audit log** | `loop.log` with timestamps. If you can't read back what it did at 3am, you can't trust it at 3am. |

---

## 5. The agent pipeline (Layer 4, expanded)

```
  ┌────────────┐   ┌──────────┐   ┌─────────────┐   ┌────────┐   ┌──────────┐   ┌──────────┐
  │ researcher │──▶│ planner  │──▶│ implementer │──▶│ tester │──▶│ VERIFIER │──▶│ reviewer │
  │ as needed  │   │ feature  │   │ ONE task    │   │ fresh  │   │ fresh    │   │ fresh    │
  │ cites :LN  │   │ goal.md  │   │ writes code │   │ suite  │   │ PASS/    │   │ findings │
  │ no hallcn. │   │ ordered  │   │ + tests     │   │ green? │   │ /goal    │   │ changes  │
  └────────────┘   └──────────┘   └─────────────┘   └────────┘   └──────────┘   └──────────┘
       reads            reads          reads            runs        criterion       diff+rules
       source/rules     spec+goal      rules+research   commands    by criterion    +goal+tests
```

- **tester** reports which selected tests ran and what they returned.
- **verifier** checks the named end-state in `specs/<feature>/goal.md`; a green suite alone does not establish that the feature goal was met.
- **reviewer** answers *"is it RIGHT?"* (style, scope, acceptance criteria, the human-readable
  quality gate).

Three different questions. The split is the point.

---

## 5a. The tester — adversarial workflow validation (the proactive complement)

The feature verifier checks one change against its feature-specific goal. The workflow tester runs
configured journeys with a runnable `how_to_run` and attacks their stated invariants. Each report
covers the checks that actually ran; it does not certify every path in the application.

```
  workflows/ bank (peer of specs/)        for EACH workflow, clean context:
  ┌───────────────────────────┐           ┌──────────────────────────────────────────┐
  │ id · title · importance   │──tester──▶ │  sdd-workflow-tester                       │
  │ preconditions · steps     │  P0 first  │  (a) RUN the journey end-to-end            │
  │ expected (+ INVARIANTS)   │            │  (b) ATTACK it: bad input · kill mid-flow ·│
  │ how_to_run                │            │      race/double-submit · offline ·        │
  └───────────────────────────┘            │      boundary · replay                     │
                                          │  (c) → PASS  or  BROKEN + concrete repro   │
                                          └───────────────────┬────────────────────────┘
                                                              │ BROKEN (P0 first)
                                                              ▼
                                          ranked "what's broken" report ──▶ LEARN
                                          (capture + classify → proposed rule or guard;
                                           review before canonical change)
```

- **feature verifier** vs **workflow tester**: the verifier checks a feature goal; the workflow tester
  checks configured journeys. Both use separate contexts. Findings can enter `learn`; only an
  approved change from the existing human or reviewer authority updates canonical policy.
- The `workflows/` bank is a **peer of `specs/`**: a spec is one feature you're building; a workflow is
  one journey the project chooses to track or protect. `tester --scan` derives candidate workflows from the real app
  surface (routes, entry points, write paths) the same way `rules --scan` derives rules — proposes,
  human confirms.
- A **BROKEN** workflow is to the tester what a **FAIL** is to the verifier: preserve its repro and
  classify the cause. Rule changes wait for the `learn` review; a regression guard may be proposed.

---

## 5b. Per-directory rules — the cascade (each agent, its concern)

Global rules (`frequent_rules.md`, `30-tech.md`) describe ONE stack. A mixed-stack monorepo
breaks that: a pure-TS package, an RN app, and a Python example each need different rules. So
rules are **per directory**, resolved nearest-up-the-tree, with one section per concern, each
owned by one agent:

```
  repo root  RULES.md   ← base every subtree inherits
    └─ packages/core/    RULES.md   (pure TS: no RN/IO; vitest)        ── deepest wins
    └─ apps/mobile/      RULES.md   (RN + Restyle; jest-expo)
    └─ examples/coach/   RULES.md   (Python; ruff + pytest)

  RULES.md sections → owner agent:
    Coding ─ implementer   Architecture ─ researcher/planner   Packages ─ researcher
    Testing ─ tester       Reviewing ─ reviewer

  resolve(a/b/c/foo.ts) = merge of the concern section from
    root → a → a/b → a/b/c   (deepest overrides; empty = inherit)
```

**Auto-create:** a rules-boundary dir (its own manifest/stack) with no `RULES.md` gets one
**generated from its real code** — manifest deps, existing patterns, test config — never copied
from another directory's stack. Generated guidance should match the subtree, but stack labels do not guarantee correct isolation.
Review each rule against the cited source before treating it as project policy. The `rules` command
provides scan, generation, and resolution procedures (see `commands/rules.md`).

## 6. Stack-agnostic by design

The examples below are hypothetical guidance shapes, not reports about a customer project or a
measured outcome. Derive and review project rules against the target repository's policies, source,
and tests; a stack label alone is not evidence.

| Hypothetical example | Possible rule focus | Example check |
|---|---|---|
| Python service | type hints, input validation, predictable control flow | `python -m pytest` |
| TypeScript module | pure domain functions, explicit input validation, justified dependencies | `node --test` |

The file and role structure can be reused, while rule content should follow the actual target stack
and source evidence.

## 7. MCP integration — the action layer and its limits

MCP servers can expose actions to a connected client. A document that describes a check does not
install a server, run the check, enforce permissions, or prevent a tool call. Confirm the project's
actual client configuration, applicable checks, and authorization before an external action.

- **Work intake** accepts exact inline text or a connected read-capable ticket source. The
  [`tickets` procedure](./commands/tickets.md) returns PENDING when the body cannot be retrieved;
  ticket write-back is not part of intake.
- **Delivery authority** is described by [`ship`](./commands/ship.md): fresh tester, verifier, and
  reviewer results must refer to the same current inputs before delivery is eligible for a decision.
  Each commit, push, merge, deployment, or publication still needs explicit authority. Apply secret,
  protected-path, and release checks where they exist; `ship` records the plan and does not perform
  or enforce those actions.
- The shipped [`constitution template`](./templates/constitution.md) says a release action needs an
  applicable configured check and explicit authorization. It is a scaffold, not proof that a
  project installed a check or that a client enforces it.
- [`MCP-SERVERS.md`](./docs/MCP-SERVERS.md) is a dated illustrative vendor map, not a verified current
  inventory. Verify capabilities and setup against current official vendor documentation. A listed
  server is not evidence that it is connected or authorized in a given project.
  The former `release-preflight`, `eas-env-sync`, and `backend-secrets-lock` guardrail patterns are
  historical, non-bundled examples in this source tree; they do not gate MCP actions here.

```text
Project rules and templates — describe expected constraints
    │
    ├── verify / tester — produce evidence for configured goals and workflows when run
    ├── learn — captures and classifies feedback; reviewed authority decides policy changes
    └── ship — records delivery evidence and checks for explicit authority
          │
       Connected MCP — acts within the permissions of its client/provider configuration
```

The procedures help people decide what evidence and authorization a delivery needs. The bundle
itself does not enforce MCP permissions or guarantee that an external action is safe.
