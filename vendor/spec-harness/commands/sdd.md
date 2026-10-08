# Command: `sdd` — initialize the harness or execute one ticket

> One shared, model-led procedure for project initialization and ticket work. Claude's `/sdd`
> command and the Codex `sdd` project skill are thin entrypoints to this file. Shell commands only
> stage deterministic files or print this procedure; they never claim that model work or a gate ran.

## Entry

```text
/sdd init [optional ticket text or connected ticket reference]
/sdd <ticket text>
/sdd ticket <connected provider reference>
spec-harness sdd ...       # shell handoff only; expect PENDING until a capable model continues
```

The installed shared procedure is `.claude/commands/sdd.md`. The Codex skill at
`.agents/skills/sdd/SKILL.md` points here. The source command documents under
`.claude/commands/spec-harness/` own detailed stages; the synthesis receipt owns the target's
project-specific role and skill paths. Do not maintain a second copy of those generated rules.

## 1. Check the route and project state

For `init`, follow `.claude/commands/spec-harness/init.md`,
`.claude/commands/spec-harness/rules.md` and
`.claude/commands/spec-harness/generate-agents.md`: inventory the target, preserve its policy,
derive package-scoped rules, the three core project skills and a skill per major technology, then bind the core roles. Run
`spec-harness index "$PWD"` before synthesis and
`spec-harness generate-agents --check "$PWD"` after it. That result proves structure and
provenance only. A separate fresh reviewer must accept the cited claims before overall
initialization is READY. Missing evidence or an unavailable reviewer leaves it PENDING. When
`spec-harness` is not on `PATH`, run the same subcommand through
`npx -y github:chohra-med/spec-harness-oss <subcommand> ...`. If neither is available, report that limitation and keep initialization PENDING. If `init` also carries optional ticket text or a connected reference, continue through input resolution and the ticket steps after initialization. If no optional ticket is present, complete the initialization gates and return; init-only work does not request ticket content or classify a ticket.

Initialization reads project rules, structure, manifests/lockfiles, representative source and project-local installed skills before selecting reusable methods. The four portable method owners at `.claude/commands/spec-harness/{ponytail,grill-me,package-finder,skill-finder}.md` are usable before synthesis or a feature goal exists. Keep the project-specific outputs and schema-1 receipt unchanged.

For ticket work, record the current source state before planning:

- Git source: `git rev-parse HEAD` and SHA-256 of the exact `git diff --binary HEAD` bytes. MICRO records `HEAD` only.
- Non-Git source: mark Git state unavailable and hash the relevant files and rule inputs.
- Record the applicable rule paths and hashes. Read the target's `AGENTS.md`, `RULES.md`,
  `CONTRIBUTING.md`, `ai_rules/`, `.memory/`, `.cursor/rules/`, `.Codex/` and README, following
  their startup instructions. Load only the package/source evidence needed for this ticket.
- Read `.claude/agents/.init-synthesis.json` and validate it with
  `spec-harness generate-agents --check "$PWD"`. Use only role and skill paths named by the receipt.
  The harness-owned `sdd-learner` is the one exception: it binds to no package source, needs no
  receipt row and is dispatched from `.claude/agents/sdd-learner.md`.
  A structural `READY` is not semantic approval. Missing/stale bindings or unresolved semantic
  review leave the run PENDING; do not substitute generic templates.

### Refresh an initialized target after source changes

If an initialized target's source, applicable policy or inventory changed, use this guarded refresh
before ticket gates. This is a model-led procedure; no receipt hash alone grants permission to
replace existing bytes.

1. Before reindexing, read the old receipt and inventory and snapshot their exact bytes and hashes,
   plus every selected package rule, all project skills and every selected role file. Enumerate
   each output's trusted generated ownership from its prior synthesis/review evidence and source-bound
   markers. Confirm the receipt path, citation identity, output hashes, skill markers and role GEN
   boundaries agree with those preimages. A receipt match is necessary for reuse, never sufficient
   authority to rewrite a human-authored file. If a preimage, trusted ownership or prior semantic
   review is missing, or a concurrent edit changes a captured byte, preserve it and mark that output
   `CONFLICT/PENDING`.
2. Reindex only after preserving those preimages. Read the changed representative source and current
   applicable policy, then re-ground affected claims, citations, line spans and hashes. Compute the
   raw inventory hash and enumerate every skill and selected role GEN block whose embedded inventory
   marker changed, including consumers outside the edited package. Refresh only verified generated
   content and its receipt rows. Preserve human policy, custom files and all role bytes outside
   `GEN:rules`. A populated `RULES.md` without a clearly authorized generated region is never replaced;
   surface its conflict as PENDING. A missing skill may be created under init's existing absent-only
   rule, while a custom, mismatched or unproven existing reserved name remains byte-identical and
   PENDING.
3. Run `spec-harness generate-agents --check "$PWD"` against the refreshed receipt. A separate fresh
   semantic reviewer must recheck citations, package scope and policy conflicts. Recheck packet,
   source, rule and goal identities; invalidate stale tester, verifier and reviewer records and run
   fresh independent gates against the current revision. Structural `READY` alone is not feature
   acceptance. Ordinary source evolution is a metadata/binding refresh, not a permanent learned rule;
   use `learn` only for an observed reusable failure that passes its review.

Stop and preserve bytes whenever the inventory, source or output preimage moves during refresh. Keep
the old receipt and output preimages as history/evidence. No generic merge engine or automatic human
policy writer is implied by this procedure.

Before delegating, resolve every stage to a model tier and confirm with the client actually in use
which model serves that tier and that required stages have genuinely separate contexts. Before work
begins, record the tier and model chosen for each stage the ticket's class runs: planner,
implementer, fresh tester, verifier, reviewer and finisher for FULL. Correct the record if a
different model ran. A role file's `model:` frontmatter carries the Claude default for its tier;
pass the tier's model at dispatch, and the table below wins where they differ. `model:` frontmatter
and files on disk do not prove availability or dispatch.

### Model tiers

Roles ask for a tier, never a model. This table is the only place a model ID appears, so changing
provider means filling one column. A `Model tiers` table in the target's own `AGENTS.md` overrides it.

| Tier | Roles | Claude | Codex/OpenAI |
|---|---|---|---|
| strong | planner, finisher, merger | `opus` | `gpt-6-sol` |
| fast | implementer, tester, researcher, documenter | `sonnet`; `haiku` for the tester | `gpt-6-luna` |
| review | verifier, reviewer, architect, learner, design and workflow testers | strong when budget allows, otherwise fast | same rule |

- **Plan strong, implement fast.** The plan carries the detail, so a cheaper model can execute it.
- **Budget picks the review tier.** Review on the strong tier when the token budget allows. Drop to
  the fast tier when the user says the budget is low or the client reports it.
- **Unavailable model: use the nearest available tier and say so.** Record the requested tier, the
  model that ran and the reason in that stage's gate file (`ticket.md` for MICRO). A missing model
  does not stop the run.
  Never carry one provider's model IDs to another provider.
- **Independence never bends.** The implementer cannot write its own acceptance. Tester, verifier
  and reviewer are separate fresh contexts, on a different model from the implementer when one is
  available. If a separate context cannot be had, that gate stays PENDING; separate manual contexts
  count only when their independence is real.
- For a provider without a column, add one naming its strongest model and its cheapest capable model.
- The finisher is the orchestrator's own final strong-tier judgment, not a role file.

## 2. Resolve the ticket input

Accept either exact inline ticket text or a reference whose body is retrieved through an actually
connected, read-capable provider. For a connected reference, retrieve its exact body first. Record the provider, ticket ID/URL, retrieval time and body hash before classification.
Copy inline text byte-for-byte into the packet's `input.md` before interpretation; punctuation is
data, never shell syntax. A title, bare name, inaccessible URL or unconnected provider is not ticket
content. Stop with `PENDING: ticket body unavailable; provide the body or connect a retrievable
reference`. Do not invent requirements or write back to the provider.

## 3. Classify after resolving ticket input

For ticket runs only, after the exact inline text or connected-reference body is resolved and hashed,
complete classification before optional history, research or broad package recall. Use the exact input,
touched scope and risk:

- **MICRO:** one bounded, reversible local change with no shared contract or security-sensitive effect.
- **LITE:** a small multi-file change or one contained behavior change with declared local dependencies.
- **FULL:** multi-repository, shared-interface, security-sensitive, externally consequential, or otherwise
  high-risk work. When uncertain, use FULL.

Record the class and reason in the packet. Every class retains exact input provenance, a literal
goal, source identity, the applicable rules and independent acceptance. LITE and FULL also keep an
accepted `spec.md`/`goal.md`, rule paths and hashes, and declared dependencies. LITE may keep concise inline intent in the existing `plan.md` and `tasks.md` and skip a
delegated planner when there are no material architecture/reuse decisions. Keep the same feature packet
and enough accepted plan/task evidence for independent roles to audit the change. MICRO uses the
light route below instead of a packet. FULL retains the
complete feature packet and applicable research/design/coherence work. Required startup rules and security
constraints are never optional context.

### MICRO light route

A MICRO ticket is a small fix, typically one or two source files plus a test. It runs in one file
and two stages. Where this section differs from the rest of this procedure, this section wins for
MICRO.

- **One file.** Before implementation the orchestrator writes `specs/<feature>/ticket.md` with the
  exact input, one to five literal goal checks, the starting `git rev-parse HEAD` and the paths
  expected to change. Do not create `spec.md`, `goal.md`, `plan.md`, `tasks.md` or `gates/`, and do
  not record file or diff hashes. The implementer never edits `ticket.md`. Only the orchestrator does.
- **Two stages.** The fast-tier implementer makes the change with a test that fails first. Then one
  fresh review-tier `sdd-verifier` receives the goal checks and expected paths in its dispatch,
  together with the `ticket.md` path. It runs the project's test command, checks every goal line and
  reads the diff against the applicable rules. It returns FAIL when the goal checks in `ticket.md`
  differ from the dispatched ones, or when `git diff --name-only <starting HEAD>` on the working tree or
  `git status --porcelain --untracked-files=all` lists a path outside the expected ones and `ticket.md` itself. It returns `RESULT: PASS|FAIL` with its evidence, and the
  orchestrator copies that return unchanged into `ticket.md`. No separate tester, reviewer, planner
  or finisher stage runs.
- **Still required.** The target's startup rules and security constraints, a verifier context that
  is not the implementer's, and explicit authority before any commit, push or merge. A merge
  decision uses the verifier's PASS in `ticket.md` as its gate set and records the grant there.
- **Not required.** Rule hashes, Grill Me and Ponytail receipts, and a stage map beyond the two
  models used. Apply Ponytail directly while implementing.
- **Escalate to LITE** when the change grows past the stated files, touches a shared contract or
  security-sensitive code, or the verifier fails twice.

Evidence is proportional for every class: record what this procedure names and nothing more. Do not
produce manifests or hashes of unchanged files, copies of reports, or receipts about receipts.

## 4. Ground and resolve the work

Open relevant source, tests, package manifests and rules, then follow the installed Grill Me and
Ponytail method owners in `.claude/commands/spec-harness/` (source checkout fallback:
`commands/`). Package Finder and Skill Finder apply when package or reusable-skill discovery is
relevant. Record evidence, selected/excluded candidates and unavailable capabilities in the plan;
keep affected decisions PENDING when required evidence is unavailable. These method owners define
the procedures; this shared route records their outcomes and does not duplicate their ladders.

## 5. Pin a feature-owned packet

Choose a filesystem-safe feature slug. If `specs/<feature>/` already exists, inspect it and stop on
an identity collision; never overwrite an older ticket packet. Keep root `goal.md` untouched. MICRO
writes only `specs/<feature>/ticket.md` (light route, section 3). LITE and FULL create:

```text
specs/<feature>/input.md
specs/<feature>/spec.md
specs/<feature>/goal.md
specs/<feature>/plan.md
specs/<feature>/tasks.md
specs/<feature>/gates/tester.md
specs/<feature>/gates/verifier.md
specs/<feature>/gates/reviewer.md
specs/<feature>/gates/merge.md
```

`spec.md` records the exact input provenance/body hash, source commit or non-Git marker, working
diff hash, relevant rules and hashes, package paths, user/project authority, and the external effects
that remain unauthorized. The four specification artifacts carry the feature slug and their source
revision; the goal records the `spec.md` hash it accepts. If any accepted spec, goal, applicable rule, source identity or declared dependency changes,
invalidate affected evidence and rerun only the affected gates in fresh contexts. A shared-interface
change widens the affected set through its declared dependents.

Use `.claude/commands/spec-harness/tickets.md`, then `.claude/commands/spec-harness/spec.md`,
`.claude/commands/spec-harness/plan.md` and `.claude/commands/spec-harness/tasks.md` as detailed
stage contracts. Route verifier failures and other corrections through
`.claude/commands/spec-harness/learn.md`. When selected for FULL or material planning, the planner consumes the accepted packet's `input.md`,
`spec.md`, `goal.md`, existing `plan.md` and existing `tasks.md`; it produces or updates those files.
For LITE without material planning decisions, the orchestrator records concise intent and checks
in the packet directly. Optional `design.md` and `research.md` are read when present or
selected for the ticket, never required for every ticket. The reviewer reads the feature goal, plan
and assigned tasks alongside the diff, rules and gate evidence. `spec.md` states the problem, testable
acceptance criteria, constraints and scope.
`goal.md` converts those criteria into literal true/false end-state checks. `plan.md` holds the
architecture/reuse decisions and Ponytail receipt. `tasks.md` breaks the plan into ordered units
with changed paths, checkable acceptance, test commands and dependencies. Do not use root `goal.md`
as the verifier target for this ticket.

## 6. Implement and run independent gates

Use the project-bound `sdd-planner`, `sdd-implementer`, `sdd-tester`, `sdd-verifier` and
`sdd-reviewer` files named in `.claude/agents/.init-synthesis.json`; keep role-specific project
facts in those canonical files, not duplicated in a client skill. MICRO follows its light route in
section 3. For LITE and FULL the minimum order is:

1. For FULL or material planning, the bound planner plans the accepted feature packet. For LITE
   without material planning decisions, keep the accepted intent concise in `plan.md` and `tasks.md`.
2. Bound implementer makes one task-sized change at a time and records the exact source revision.
3. A fresh bound tester runs the task's actual test commands and adversarial cases; record commands,
   outputs, model, client/context identity, source revision and goal hash in `gates/tester.md`.
4. A different fresh bound verifier checks every literal criterion in
   `specs/<feature>/goal.md`; record PASS/FAIL and evidence in `gates/verifier.md`. A passing root
   goal cannot override a failing feature goal.
5. A third fresh bound reviewer checks the changed files against the accepted spec, rules, scope,
   and test evidence; record findings and revision identity in `gates/reviewer.md`.

The implementer cannot write its own acceptance result. A fresh `sdd-verifier` remains mandatory for
MICRO, LITE and FULL and checks every literal criterion in the accepted feature goal. Tester, verifier
and reviewer answer distinct questions. Reuse a prior manual gate receipt only when its recorded exact
source identity, accepted goal hash, applicable rule hashes and declared dependency identities match
the current packet; otherwise invalidate that receipt and rerun that gate in a fresh context. A changed
input invalidates only evidence that depends on it. This receipt rule is an instruction-level reuse
contract, not an automatic cache or scheduler. If an independent context or
required project role is unavailable, record PENDING/UNVERIFIED rather than borrowing an earlier
agent's context. Fixes that change an accepted input or source revision invalidate only evidence tied to the affected
input and its declared dependents; widen review for shared-interface changes. After two unsuccessful
ordinary correction rounds, stop: keep the work unaccepted, record a causal diagnosis, and propose a
changed bounded strategy before another attempt. Do not reset the count or record PASS. This ordinary
limit does not replace or shorten the separate adversarial release loop.

For a ticket that changes UI or visual output, first load that ticket's own design-review skill and
brand contract. Pin target viewports, visual budget, screenshots and stop conditions in its packet
before visual implementation. Do not invent universal design constraints for non-visual work.

## 7. Apply merger authority

Select a merger role only when a merge decision is needed. Read the target project's explicit
merge policy and record its path/hash and the user's task-specific grant in `gates/merge.md`. The
merger verifies current source, rules, feature goal and all gate revisions. With no explicit
authority, write `report-and-wait`; green tests or review do not grant permission. No ticket
write-back, commit, push, merge, deployment, release or settings change occurs without its own
explicit authorization. The final strong-tier judgment applies that policy; it does not expand it.

## 8. Learn from the ticket

When a gate failed, a human corrected the work, or a decision was made that later tickets should
follow, dispatch `sdd-learner` in a fresh review-tier context after the gates, for every class
including MICRO. It follows
`.claude/commands/spec-harness/learn.md`: it captures the signal, proposes one change to one rule or
project skill, and applies it only after the project's review authority approves. A clean ticket with
no correction and no new decision skips this stage.

## Output

Report the selected input and provenance, packet and feature goal paths, source/rule revisions,
Ponytail and Grill Me receipts, each independent gate path and observed result, unavailable client
capabilities, and the next action. For MICRO, report the `ticket.md` path and its result in place of
packet, receipt and gate paths. File presence, a shell handoff, a structural checker, or a green
review is not a completed feature or authorization to ship.
