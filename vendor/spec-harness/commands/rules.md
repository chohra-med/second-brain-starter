# Command: `rules` — derive and resolve package-scoped rules

> Each package boundary needs rules grounded in its own policies and code. The inventory finds boundaries and representative paths; a capable model reads those files and derives the rules. Neither a shell scaffold nor a dependency name proves an architecture rule.

## Invocation

```text
spec-harness rules --generate [<package-path>]
spec-harness rules --scan [<package-path>]
spec-harness rules --check <file-path>
```

`--generate` is a native-model procedure, not a shell rule generator. `--scan` inventories boundaries and reports gaps. `--check` resolves the nearest `RULES.md` sections for a file.

## Required evidence

1. Run `bin/sh-index.sh <target>` and read `ai_rules/project_inventory.json` when present, otherwise the generated `ai_rules/context_map.md`.
2. Read applicable project instructions first, including startup sequences. Preserve their precedence and existing text.
3. For each package, open its actual representative source and relevant tests/configuration. Cite `path:line` and the source SHA-256. Inventory paths are discovery evidence, not architecture evidence.
4. Read the package manifest. The inventory parser supports `package.json` and `pyproject.toml`; any other format stays visibly `unsupported` and must not be interpreted from its filename.
5. Use official primary documentation only when a recommendation depends on current or disputed framework/package behavior. Cite its URL and access date. Keep documentation advice labeled `RECOMMENDATION`; code/policy observations are `OBSERVED`.

## Boundaries and output

Use a root `RULES.md` plus deeper files only for packages with distinct manifests or demonstrated conventions. Each file uses the existing five sections: Coding, Architecture, Packages, Testing and Reviewing. Cite each project-specific rule to a concrete package path and source/config/test line. Do not repeat an inherited rule, and do not copy guidance between different stacks.

- Existing populated rules remain authoritative and byte-identical. Map or cite them; surface a source contradiction for human resolution.
- Fill only empty sections or unmistakable Spec Harness PENDING scaffolds. Never overwrite a human-authored section.
- An `ai_rules/rules/frequent_rules.md` stub, a generic `RULES.md`, a missing citation, or a source/code conflict unresolved by the project owner is PENDING.
- SOLID and performance advice without direct project evidence is a labeled review heuristic, not a project fact. Do not invent metrics or prescribe blanket memoization.
- Record unsupported formats and incomplete scans as `PARTIAL`. They cannot produce overall initialization `READY` until the missing evidence is resolved or explicitly excluded by the project owner.

## Rule record

Each generated rule should be short, checkable and scoped. Use this shape where practical:

```text
- [OBSERVED|RECOMMENDATION] <checkable rule> — package: `<path>`; evidence: `<file>:<start>-<end>` (sha256: `<digest>`).
```

State uncertainty or a conflict instead of smoothing it into a rule. A project-specific recommendation never silently forces an architecture migration.

## Completion check

`generate-agents` consumes the completed rules and binds applicable roles. Then run:

```bash
bash <spec-harness>/bin/sh-gen-agents.sh --check <target>
```

The check must reject PENDING templates, false or stale source citations, stale role blocks, missing skills and unresolved conflicts. A successful static check validates structure and hashes; a fresh reviewer still judges whether each cited line supports its rule.
