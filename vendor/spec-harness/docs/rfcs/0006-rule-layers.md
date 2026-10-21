# RFC 0006: rule layers, the generated stack and curated rule packs

Status: proposal, implemented on this branch for review.

## Problem

Initialisation produced rules a person could not read. The schema 3 ledger only required that a
`rule_anchor` text appear in a rule file, so a rule file could pass the check with lines such as
"Apply the canonical package requirements from `X`. Coverage IDs: policy-266, policy-267" and never
state the rule itself. Facts were also written in several places: one package version could appear in
a React Native rule, a router rule, a review rule and a feedback note, so an upgrade left some of them
stale. Baseline practices (security, clean code, performance) were regenerated in different words for
every project, and tool practices (for example error reporting) depended on what the model remembered.

Other tools solve parts of this: Claude Code rules keep one topic per file and warn that contradictory
instructions are resolved arbitrarily; Spec Kit keeps one constitution built only from what is already
true; Conductor keeps one file per concern (product, tech stack, guidelines); gstack generates
documents from single sources and marks drifted output stale. None of them checks that a rule exists
once, in readable form, at the version in use.

## Proposal

One fact, one home, checked by the readiness check for receipt schema 4.

| Layer | Home | Source |
|---|---|---|
| business | `.memory/10-product.md`, `BIZ-` rules | memory bank, README, owner |
| standard | commitment as `STD-` in `.memory/10-product.md`; rules in `ai_rules/rules/standard-<name>.md` | `commands/standards.md`: owner's answer, then a standard pack or the official text |
| decision | `.memory/60-decisions.md`, `DEC-` rules | owner, with date |
| project | `RULES.md` and `ai_rules/rules/<topic>.md` | project policy and accepted code patterns |
| tool | `ai_rules/rules/tool-<package>.md` with an `applies` range | curated pack, or official docs with URL and check date |
| baseline | `ai_rules/rules/baseline-<topic>.md` | curated pack only |
| versions | `ai_rules/stack.md` | generated from manifests and lockfiles |

- **Rule line.** `- **ID** One sentence of 4 to 60 words. (source: ...)`. The exact span and hash stay in
  the receipt.
- **Stack.** `bin/sh_stack.py` (`spec-harness stack`) builds `ai_rules/stack.md` deterministically from
  `package.json` or `pyproject.toml` and the lockfile. The check rebuilds it and compares bytes.
  `index` does not hash it as policy.
- **Packs.** `templates/rule-packs/` ships six baseline packs and five tool packs, each rule citing an
  official source. Targets copy pack lines byte for byte and may leave a rule out but not reword it.
  In v1 packs are recommended, not required.
- **Standards.** Init asks the owner once which named standards and laws the company has, must meet or
  plans (for example the European Accessibility Act with EN 301 549 for an app offered to consumers in
  the EU). Each answer is a `STD-` commitment with a status, carried out by a standard module. Standard
  packs are adopted only on a commitment. Init records commitments; it never certifies compliance.
- **Precedence.** Business, standard, decision, project, tool, baseline. A winning rule says `overrides <ID>`; a
  lower layer cannot override a higher one. What precedence cannot settle goes to `rule_conflicts` and
  refuses READY while open.
- **Conventions.** Repeated code patterns are proposals until the owner accepts them; an accepted one is
  a project rule plus a `DEC-` line. A `PROPOSED` rule refuses READY.
- **Consumers.** Skills and role `GEN:rules` blocks name rule IDs and link to the stack. The check fails
  when one copies a rule sentence of eight words or more, or names a stack version.
- **Ledger.** A schema 4 `captured` row anchors to a rule ID defined in its rule file.
- **Companion.** `init` offers Understand-Anything every time and installs it only on the user's yes.

## Compatibility

Schemas 1, 2 and 3 keep their meaning; only schema 4 receipts are asked for layers. A first
initialisation writes schema 4. A schema 4 receipt with no project policy file records empty
`policy_sources` and `policy_coverage` lists. The installer stages thirteen pack files, one new
directory, `.claude/spec-harness/rule-packs/`, and the `standards` method with its skill.

## Limits

- The check proves structure: a rule is readable, defined once, in its layer, at a matching version.
  It cannot prove a rule is right for the project; the fresh semantic review still decides that.
- Duplicate detection (v1) flags rules with the same set of words. Two rules that say the same thing in
  different words still need the reviewer.
- The policy ledger is optional in v1 and checked when the receipt has one.
- Version detection (v1) covers each stack version written in full, such as `57.0.27`; a bare "SDK 57" is not caught.
- Lockfiles read: `package-lock.json`, `yarn.lock`, `uv.lock`, `poetry.lock`. `pnpm-lock.yaml` and
  `bun.lock` are named in the stack as not read, and their locked versions show as unknown.
- Pack sources were checked on 2026-10-21. Pack content changes only in this repository.

## Tests

`tests/rule-layers-fixtures.sh`: a READY schema 4 fixture, a lint of every shipped pack, twenty-four
planted faults (one per check) and seven green controls (among them a pack left out, a receipt with no
ledger, a decision overriding a baseline rule and a resolved conflict). `tests/index-exclusion-fixtures.sh`
covers `--exclude-dir`. `tests/synthesis-contract.sh` now treats 5 as the next unknown
schema.
