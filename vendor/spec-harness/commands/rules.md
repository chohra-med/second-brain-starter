# Command: `rules`, derive and resolve package-scoped rules

> Each package boundary needs rules grounded in its own policies and code. The inventory finds boundaries and representative paths; a capable model reads those files and derives the rules. Neither a shell scaffold nor a dependency name proves an architecture rule.

## Invocation

The shell CLI does not run these modes. `spec-harness rules ...` only prints this procedure and exits 2 (PENDING). A model follows the procedure with these modes:

```text
rules --generate [<package-path>]
rules --scan [<package-path>]
rules --check <file-path>
```

`--generate` is a native-model procedure, not a shell rule generator. `--scan` inventories boundaries and reports gaps. `--check` resolves the nearest `RULES.md` sections for a file.

## Required evidence

1. Run `spec-harness index <target>` (from a checkout, `bash <spec-harness>/bin/sh-index.sh <target>`; with no install, `npx -y github:chohra-med/spec-harness-oss index <target>`) and read `ai_rules/project_inventory.json` when present, otherwise the generated `ai_rules/context_map.md`.
2. Read applicable project instructions first, including startup sequences. Preserve their precedence and existing text.
3. For each package, open its actual representative source and relevant tests/configuration. Cite `path:line` and the source SHA-256. Inventory paths are discovery evidence, not architecture evidence.
4. Read the package manifest. The inventory parser supports `package.json`, `pyproject.toml` and `composer.json`; any other format stays visibly `unsupported` and must not be interpreted from its filename.
5. Use official primary documentation only when a recommendation depends on current or disputed framework/package behavior. Cite its URL and access date. Keep documentation advice labeled `RECOMMENDATION`; code/policy observations are `OBSERVED`.

## Boundaries and output

Use a root `RULES.md` plus deeper files only for packages with distinct manifests or demonstrated conventions. Each file uses the existing five sections: Coding, Architecture, Packages, Testing and Reviewing. Cite each project-specific rule to a concrete package path and source/config/test line. Do not repeat an inherited rule, and do not copy guidance between different stacks.

- Existing populated rules remain authoritative and byte-identical. Map or cite them; surface a source contradiction for human resolution.
- Fill only empty sections or unmistakable Spec Harness PENDING scaffolds. Never overwrite a human-authored section.
- An `ai_rules/rules/frequent_rules.md` stub, a generic `RULES.md`, a missing citation, or a source/code conflict unresolved by the project owner is PENDING.
- SOLID and performance advice without direct project evidence is a labeled review heuristic, not a project fact. Do not invent metrics or prescribe blanket memoization.
- Record unsupported formats and incomplete scans as `PARTIAL`. They cannot produce overall initialization `READY` until the missing evidence is resolved or explicitly excluded by the project owner.

## Rule record

Every rule is one line: an ID, one plain sentence a reviewer can check, and a source tag.

```text
- **NAV-01** Extend the existing file-based route tree instead of adding a second navigator. (source: CONVENTIONS.md, Navigation; src/app/_layout.tsx:12-30)
```

- The ID is upper case, a topic prefix and a number (`NAV-01`, `SEC-03`, `BIZ-02`, `DEC-004`). It is defined once in the whole project; everything else names the ID.
- The sentence is the rule itself, 4 to 60 words, ending with a full stop. A line that only points elsewhere ("Apply the canonical requirements from ...", a list of coverage IDs) is not a rule and fails the check. Rule lines are read with HTML comments removed, so an example inside a comment is not a rule and a trailing comment is not part of the rule text.
- The source tag names where the rule comes from: a policy file and section, the cited `path:start-end`, a pack document, or `decision DEC-004`. The exact span and hash stay in the receipt, not in the sentence.
- Label inferred or advised rules in the source tag (`observed in ...`, `recommendation, <URL>`). State uncertainty or a conflict instead of smoothing it into a rule. A project-specific recommendation never silently forces an architecture migration.

## Rule layers (one fact, one home)

A first initialisation writes receipt schema 4, which checks these homes. Each fact has exactly one.

| Layer | What it holds | Home | Where the rules come from |
|---|---|---|---|
| business | what the product is, its goals, users and domain rules | `.memory/10-product.md` (`BIZ-` rules under `## Domain rules`) | the memory bank, the README and the owner |
| standard | named standards and laws the owner committed to (in place, required or planned), such as the European Accessibility Act with EN 301 549 | commitment as a `STD-` line in `.memory/10-product.md`; rules in `ai_rules/rules/standard-<name>.md` with `<!-- rule-layer: standard -->` and `<!-- commitment: STD-<n> -->` | `standards.md`: a curated standard pack; or the official text by URL with `checked YYYY-MM-DD`; or, when the text cannot be opened, the text named as `official text: <instrument and article>` (no date, because nothing was checked) |
| decision | choices the owner made, including accepted conventions and overrides | `.memory/60-decisions.md` (`DEC-` rules) | the owner, with the date and reason |
| project | how this codebase does things | package `RULES.md` and `ai_rules/rules/<topic>.md` with `<!-- rule-layer: project -->` | the project's own policy files and repeated code patterns |
| tool | rules for one package at the version in use | `ai_rules/rules/tool-<package>.md` with `<!-- rule-layer: tool -->` and `<!-- applies: <package> <range> -->` | a curated pack from `.claude/spec-harness/rule-packs/`, or official documentation with its URL and `checked YYYY-MM-DD` |
| baseline | clean code, security, error handling, performance, testing, accessibility | `ai_rules/rules/baseline-<topic>.md` with `<!-- rule-layer: baseline -->` | the curated packs only |
| stack facts | every package version | `ai_rules/stack.md` | generated by `spec-harness stack <target>`; never written by hand |

- **Packs are copied, never reworded.** A module made from a pack keeps its `rule-layer`, `pack` and `applies` markers and copies each adopted rule line byte for byte. Leave out a rule that does not apply; do not edit one. In v1 packs are recommended: adopt every baseline pack and every tool pack whose package and version are in the stack, unless one does not apply.
- **A tool without a pack** gets a `tool-<package>.md` module whose rules each cite an official documentation URL and the date checked, for the version in the stack. Research that is not finished stays `PENDING`, which refuses READY.
- **Conventions are proposed, then accepted.** A pattern repeated in the code (`conventions.md`) is shown to the owner as a proposal. Only an accepted one becomes a project rule, with a `DEC-` entry in `.memory/60-decisions.md` that records who accepted it and when. A rule still marked `PROPOSED` refuses READY.
- **Conflicts follow precedence:** business, then standard, then decision, then project, then tool, then baseline. A higher-layer rule that replaces a lower one says `overrides <ID>` in its source tag; a lower layer can never override a higher one. A conflict precedence cannot settle is recorded in the receipt's `rule_conflicts` and stays open until the owner decides.
- **Policy sources are the project's own files.** The ledger never lists a generated output (`RULES.md`, a rule module, `ai_rules/rules/frequent_rules.md`) or an installed harness file (`.claude/commands/`, `.claude/spec-harness/`, `.claude/agents/`); with schema 4 the check refuses one.
- **`ai_rules/rules/frequent_rules.md` is an index.** It lists `WHEN <situation>: <rule IDs>` triggers for the rules read before every edit, and never restates a rule.
- **Skills and roles hold no rules and no versions.** A skill or a role's `GEN:rules` block names the rule IDs and files it applies and links to `ai_rules/stack.md` for versions. Change a rule or upgrade a package in one place and every reader follows.

## Completion check

`generate-agents` consumes the completed rules and binds applicable roles. Then run:

```bash
bash <spec-harness>/bin/sh-gen-agents.sh --check <target>  # from a checkout
npx -y github:chohra-med/spec-harness-oss generate-agents --check <target>   # no checkout
```

The check must reject PENDING templates, false or stale source citations, stale role blocks, missing skills and unresolved conflicts. With schema 4 it also rejects unreadable or pointer rule lines, a rule ID defined twice, two rules that say the same thing, a version outside `ai_rules/stack.md`, a stale stack, a tool module outside its version range, a reworded pack rule, an unaccepted convention and an open rule conflict. A successful static check validates structure and hashes; a fresh reviewer still judges whether each cited line supports its rule.
