<div align="center">

# Spec Harness

**Spec Harness wraps spec-driven development with project memory, source-backed rules, independent checks, and a learning loop.**

Spec-driven development, wrapped in a harness: a reviewed ratchet, a separate verifier that says PASS/FAIL, and a learning loop that classifies feedback so durable corrections can become rules.

Created by [**Malik Chohra**](https://getwireai.com?utm_source=github&utm_medium=readme&utm_campaign=creator) · [Code Meet AI newsletter](https://codemeetai.substack.com?utm_source=github&utm_medium=readme&utm_campaign=newsletter)

Sponsored by [AI Mobile Launcher](https://aimobilelauncher.com?utm_source=github&utm_medium=readme&utm_campaign=sponsor) and [CasaInnov](https://casainnov.com?utm_source=github&utm_medium=readme&utm_campaign=sponsor)

</div>

---

## Name and method

**Spec** means a written, checkable description of a change. **Harness** means the project memory, source-backed rules, independent checks, and learning loop around that work. Spec-driven development (SDD) is the workflow; `spec-harness` is the package and local CLI. The shared workflow entry is `/sdd` in Claude Code, or `$sdd` in Codex when the project skill is discovered.

The method stages the harness, inspects the target repository, derives project-bound rules and roles from its source, then takes one ticket through independent checks. The harness keeps project context and reviewed corrections available for later work.

Roles ask for a model tier, not a model: plan on the strongest model, implement on a fast cheap one,
and review on whichever the token budget allows. One table in [`commands/sdd.md`](./commands/sdd.md)
maps tiers to models per provider, so changing provider means filling one column.

Small fixes take a light route: one ticket file, one implementer and one fresh verifier. Larger or
riskier work keeps the full packet with separate tester, verifier and reviewer.

## The three pillars

Everything in Spec Harness is one of three things. The name is literal: **Spec** + **Harness**.

| Pillar | What it is | What it addresses |
|---|---|---|
| **Memory bank** | The context/memory engine: a 10-file `.memory/` bank + an index of the codebase (`context_map`). Persistent project context and a codebase index. | Cold start every session; hallucinated files/symbols. |
| **Spec-Driven Development** | A feature-owned `spec → goal → plan → tasks → build` packet. The project-bound planner and implementer work with fresh tester, verifier and reviewer contexts; researcher and merger roles are selected when needed. | A structured path from ticket to checkable tasks with project-bound roles. |
| **Harness** | The ratchet (`AGENTS.md` rules that only tighten after reviewed classification) + the **verifier** (a fresh context, PASS/FAIL vs the feature's checkable goal) + the **tester** (a separate agent that adversarially runs + breaks the critical `workflows/`) + the **learning loop** (feedback is classified before it becomes policy). | Reviewed feedback, independent verification, and checks for critical project workflows. |

## The harness, in detail (where the new work is)

The harness has four moving parts that together make the system *converge* instead of drift:

- **The ratchet** — `AGENTS.md` + `ai_rules/`. Reviewed rules only get added or sharpened; a failure does not become policy automatically.
- **The verifier** — `sdd-verifier`, a fresh context that checks
  `specs/<feature>/goal.md` against current evidence and returns `RESULT: PASS|FAIL`. It works from
  the ticket goal and evidence, not the implementation conversation.
- **The tester** — `sdd-workflow-tester`, the proactive complement to the verifier. It loads the
  `workflows/` bank (critical journeys, ranked P0→P2) and, per journey, a clean-context agent *runs
  it end-to-end and adversarially tries to break it* — bad inputs, killed mid-flow, races, offline,
  double-submits, boundary values — returning `BROKEN` + a concrete repro. The verifier checks *a
  change* against the goal; the tester checks *reality* against the critical journeys.
- **The learning loop** (`learn`) — the verifier or tester records a failure; `learn` captures and
  classifies it, then a reviewed durable correction can become a dated rule (a BROKEN workflow can
  also yield a recommended regression guard). The `sdd-learner` agent owns it: it also records
  decisions, promotes a cause that repeats, and corrects project skills as well as rules. Feedback never evaporates. The machine learns from its failures
  (→ rules); the operator learns from its wins (→ `learning/` lessons). *This is the "loop" —
  reframed: not a cron schedule, a learning schedule.*

## What this is (and isn't)

- **It is** a portable, stack-agnostic system for project memory, bounded package inventory,
  source-backed rules and skills, SDD roles, independent gates, and a learning loop. It adds no
  application dependency. The source commands use Bash. Python 3.11+ is required for the complete
  index-and-check flow. This source repository is MIT-licensed; see [LICENSE](./LICENSE). Run the
  CLI with `npx` from GitHub, from a checkout, or from a locally packed tarball. This source release
  is not published to npm; the registry package with the same name is unrelated. Model-led work needs a capable client; the shell stages files and reports
  `PENDING` rather than claiming that agents ran.
- **It runs the dev, not the product.** The harness guides the development workflow; the shipped
  application remains yours.

## Quick start

From the root of an existing project, with Node (only for `npx`), Bash and Python 3.11+ available:

```sh
npx -y github:chohra-med/spec-harness-oss init . integrate
```

Then open the project in Claude Code and run `/sdd init`. The first command stages the harness and
reports `PENDING`. The second reads the codebase and writes its rules, skills and roles.

**Adopting it in an existing project?** Follow [docs/GETTING-STARTED.md](./docs/GETTING-STARTED.md):
both ways to get the CLI (`npx`, or a `git clone` you keep on your machine), then ten steps from a clean branch to a first verified ticket, including what to do when the project
already has its own `CLAUDE.md` and `AGENTS.md`, how to review what the initialiser wrote, and how
to undo it.

## Install and stage from a checkout

Clone the source and run the CLI directly; npm is not needed for this route:

```sh
git clone https://github.com/chohra-med/spec-harness-oss.git
cd spec-harness-oss
TARGET="/path/to/existing-project"
PATH="$PWD/bin:$PATH" spec-harness install "$TARGET" integrate
```

`install-manifest.json` lists every file `install` stages and where each one comes from. `bash tests/install-manifest-contract.sh` runs a real install into an empty git repository and checks the result against that list, byte for byte.

To install the CLI from a local tarball instead, run `npm pack` from the checkout, then install the
filename it prints. For the current version, that is:

```sh
npm install --global ./spec-harness-0.2.0.tgz
```

Staging reports `PENDING`. It copies a scaffold; it does not synthesize project rules, run agents,
or execute independent gates. With a capable client, inspect the target repository first, then run
`/sdd init` to derive project-bound rules and roles from its source. Use `/sdd <exact ticket body>`
for one ticket and collect independent tester, verifier, and reviewer results against that ticket's
goal and source revision.

Claude Code uses `/sdd`. In Codex, use `$sdd` only if the project skill is discovered; otherwise
open `.agents/skills/sdd/SKILL.md` and follow its shared procedure manually. Skill-file presence
alone does not prove native discovery or delegation. Native skill discovery, live Context7/Vercel
matching, and the result of a first real-ticket run remain unverified for this release.

## The commands

| Command | Does |
|---|---|
| [`install`](./bin/sh-install.sh) | Add/refresh the system in any repo. One entry point for **both** "start new" (`new`) and "integrate into existing" (`integrate`). Idempotent. |
| [`/sdd`](./commands/sdd.md) | Shared entry for project initialization and ticket-text/reference execution. Runs only in a capable client; the shell route stays PENDING/manual. |
| [`init`](./commands/init.md) | Stage then synthesize project-specific rules, three core skills plus one per major technology, and source-bound roles. Overall READY requires structural checks and a separate fresh semantic review. |
| [`index`](./bin/sh-index.sh) / [`migrate`](./commands/migrate.md) | Adopt an existing repo: inventory the codebase into the index layer, then enrich. |
| [`tickets`](./commands/tickets.md) | Accept exact ticket text or a retrieved body from an explicitly connected provider → one `specs/<feature>/` packet with its own `goal.md`. Unretrievable names stop for clarification. |
| [`rules`](./commands/rules.md) | **Per-directory rules.** Resolve the nearest `RULES.md` for a path (coding/architecture/packages/testing/reviewing), or generate it from a directory's real code. Each section owned by one agent; deepest-wins cascade. Built for mixed-stack monorepos. |
| [`spec`](./commands/spec.md) → [`plan`](./commands/plan.md) → [`tasks`](./commands/tasks.md) | Ticket input → checkable feature spec/goal → reuse-aware plan → atomic ordered units. |
| [`build`](./commands/build.md) | Execute one task at a time with separate fresh tester, verifier and reviewer evidence tied to the feature goal and source revision. |
| [`verify`](./commands/verify.md) | A separate fresh verifier checks `specs/<feature>/goal.md`. The shell CLI returns PENDING and does not run the check. |
| [`tester`](./commands/tester.md) | Adversarially validate the critical `workflows/` — per journey, a clean-context agent **runs it + tries to break it** (bad inputs, kill mid-flow, races, offline, boundaries), reporting what's BROKEN, ranked P0 first. `--scan` derives candidate workflows from the app; every BROKEN feeds `learn`. The proactive complement to `verify`. |
| [`document`](./commands/document.md) | Docs + comments to **the project technology's own standard** (Python docstrings, TS/JS TSDoc/JSDoc, GoDoc, rustdoc, Javadoc, …) + truthful README/ARCHITECTURE. Comments the WHY, never the WHAT. Behavior-locked (re-runs the suite to prove zero logic change). |
| [`ship`](./commands/ship.md) | Records delivery evidence and applies explicit merger authority. Green gates do not authorize a commit, push, merge, deploy or release. |
| [`learn`](./commands/learn.md) | Classify feedback/corrections and add durable rules only after review (+ optional human lesson). |
| [`audit`](./commands/audit.md) | Health-check the bank, rules, and index. Flag stale/contradictory/redundant. |

The source exposes the native Claude `/sdd` command and a thin Codex project-skill adapter at
`.agents/skills/sdd/SKILL.md`; native discovery and delegation must be measured in the actual client.
Every command is also a **model-invocable skill** (`skills/spec-harness*`, generated by
[`bin/sh-make-skills.sh`](./bin/sh-make-skills.sh)): an umbrella `spec-harness` orchestrator +
one skill per command (`spec-harness-build`, `spec-harness-learn`, `spec-harness-tickets`, …),
each with trigger phrases. `install` stages them in a repo's `.claude/skills/`; each routes through
the shared SDD procedure. Four reusable methods have the exact skill identifiers
`spec-harness-ponytail`, `spec-harness-grill-me`, `spec-harness-package-finder` and
`spec-harness-skill-finder`. Each has a thin Claude route under `.claude/skills/` and Codex route
under `.agents/skills/`; both point to the same installed command owner. Native discovery remains
client-dependent and unverified until measured in that client. The shell `loop.sh` is a legacy illustrative placeholder, separate from
the supported ticket entrypoint.

## Guardrails: current procedures and MCP examples

The current package includes the SDD verifier and delivery-authority procedures described above.
Three optional release-guardrail examples — `release-preflight`, `eas-env-sync`, and
`backend-secrets-lock` — are historical references: their skill directories and check scripts are
absent from the current source and package, so they are not executable from this distribution.

The current procedure and authority map for verification, learning review, and delivery is in
[**docs/GUARDRAILS.md**](./docs/GUARDRAILS.md). The July 2026 illustrative MCP map is in
[**docs/MCP-SERVERS.md**](./docs/MCP-SERVERS.md); verify vendor details against current official
documentation before connecting a tool.

## Read next

1. [`docs/GETTING-STARTED.md`](./docs/GETTING-STARTED.md) — step by step: stage, initialise, review, first ticket, undo.
1. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — the diagrams: the 3 pillars, the SDD flow, the
   ratchet, and the verifier + learning loop wired in.
2. [`docs/GUARDRAILS.md`](./docs/GUARDRAILS.md) — current procedures for evidence, reviewed learning, and delivery authority.
3. [`docs/MCP-SERVERS.md`](./docs/MCP-SERVERS.md) — a dated illustrative MCP map; recheck vendor details before use.
4. [`commands/init.md`](./commands/init.md) — start here to use it on a project.

## More from Code Meet AI

**Open source:** [wireai-rn](https://github.com/chohra-med/wireai-rn) · [expo_boilerplate](https://github.com/chohra-med/expo_boilerplate) · [colorway-c-brand](https://github.com/chohra-med/colorway-c-brand) · [claude_design_skill](https://github.com/chohra-med/claude_design_skill)
**Products:** [AI Mobile Launcher](https://aimobilelauncher.com) · [AI Web Launcher](https://aiweblauncher.com) · [Wire AI](https://getwireai.com) · [CasaInnov](https://casainnov.com)
**Follow:** [Newsletter](https://codemeetai.substack.com) · [YouTube](https://youtube.com/@codemeetai)
