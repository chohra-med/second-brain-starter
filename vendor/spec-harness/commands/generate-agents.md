# Command: `generate-agents` — bind roles to checked project evidence

> The shell stages a work order and checks a receipt. A capable model reads the target inventory, existing rules and actual source, then fills the project-specific role blocks. Staging alone is always PENDING.

## Invocation

```text
bash <spec-harness>/bin/sh-gen-agents.sh <target>
bash <spec-harness>/bin/sh-gen-agents.sh --check <target>
```

The first command writes `.claude/agents/.generate-agents.prompt.md`. In an installed consumer, the stage documents are under `.claude/commands/spec-harness/`; use the source-tree `commands/` paths only when working in the source checkout. The model follows that work order and writes `.claude/agents/.init-synthesis.json`. The second command validates the receipt, inventory identity, outputs, role markers and cited source paths/hashes. Each generated project skill carries `<!-- source-bound: inventory-sha256=<raw inventory file hash> -->` so source changes are detectable. It cannot decide whether a citation semantically supports a claim; that needs a fresh reviewer.

## Inputs and boundaries

Read the target's applicable instructions and startup sequence, `ai_rules/project_inventory.json` or generated `ai_rules/context_map.md`, package-scoped `RULES.md` files, source-backed skills and actual cited source lines. Do not copy a stack rule from an unrelated package. Preserve existing policies and all bytes outside `GEN:rules` markers. If a marker is absent, duplicated or user-customized content would be overwritten, report a conflict and keep that role PENDING.

## Role selection

Always bind the project-aware `sdd-planner`, `sdd-implementer`, `sdd-tester`, `sdd-verifier` and `sdd-reviewer`. Ticket planning requires the package-grounded planner binding. The tester, verifier and reviewer instructions must each require a separate fresh context. Bind `sdd-merger` only when an explicit policy grants merge authority and the current task needs it; quote/cite that authority and preserve all human approval gates. Bind optional research, design or workflow roles only when actual project or task evidence calls for them. Record selected role, package paths, evidence and why; record the exclusion reason for each optional role not selected. Claude agent frontmatter is a Claude carrier, not proof that a Codex/native role exists or was dispatched.

## Generated role blocks

Within each selected role's `<!-- GEN:rules START -->` and `<!-- GEN:rules END -->` block, write separate package subsections where packages differ. Each contains concise, checkable rules with `OBSERVED` or `RECOMMENDATION`, package applicability and source citations. Preserve the canonical role contract outside the markers byte-for-byte: frontmatter, role-specific duties, safety constraints, procedures and output format. Bindings add project context; they must not replace the planner's planning work, tester's test reporting, verifier's acceptance/coherence checks, or reviewer's code-review duties with a generic source summary. Keep fresh-context instructions in acceptance roles. End the block with:

```text
<!-- bound: YYYY-MM-DD inventory-sha256=<raw inventory file hash> -->
```

Do not fill unselected roles merely because a template exists. A change to the inventory or to any cited source makes affected bindings stale. For an initialized target, follow the single guarded refresh procedure in `.claude/commands/sdd.md`: capture exact receipt, inventory and output preimages before reindex; prove prior generated ownership and absence of intervening custom edits; re-ground changed citations; then enumerate every skill and selected role GEN block whose raw inventory marker changed. Refresh only verified generated content and receipt rows. A matching receipt hash alone never authorizes replacement. Preserve custom/mismatched skills, populated human rules without an authorized generated region and role bytes outside GEN, reporting `CONFLICT/PENDING` when ownership is unproven.

## Receipt schema and readiness

`.claude/agents/.init-synthesis.json` uses `format: "spec-harness-synthesis"` and `schema_version: 1`. It records:

- `status`, `inventory_path`, raw `inventory_sha256`, exact inventoried `package_paths`, and `pending_reasons`;
- each package's `rules_path`, output SHA-256 and `citations`;
- the three core skill names `spec-harness-architecture`, `spec-harness-performance`, `spec-harness-packages`, plus at most five `spec-harness-tech-<technology>` skills scoped to the packages that use that technology, each with output paths/hashes, package paths and citations;
- selected `roles` and `excluded_roles`, with role file paths/hashes, package paths, citations, and selection/exclusion reasons.

Each citation has `package_path`, `path`, `line_start`, `line_end` and `sha256`. Cite representative code/config/test paths actually listed by the inventory. The readiness check rejects missing files, changed hashes, out-of-package citations, invalid line spans, generic/stub rule text, unsupported or incomplete inventory, skill conflicts, missing required roles, missing markers or stale role blocks. It prints each detected defect and exits nonzero. PENDING is the only honest result when synthesis or evidence is unresolved.

A passing `--check` proves structural integrity and current cited bytes only. Before declaring overall initialization READY, a separate fresh reviewer must check that every cited span supports its claim, package boundaries are respected, and policy conflicts or unsupported recommendations are surfaced. Record the review outcome; if no independent review context is available, keep overall initialization PENDING even when this checker prints READY. The check does not prove a role was dispatched or that a feature goal passed; feature acceptance remains separate.
