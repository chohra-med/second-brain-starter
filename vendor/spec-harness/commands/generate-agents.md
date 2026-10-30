# Command: `generate-agents`, bind roles to checked project evidence

> The shell stages a work order and checks a receipt. A capable model reads the target inventory, existing rules and actual source, then fills the project-specific role blocks. Staging alone is always PENDING.

## Invocation

```text
bash <spec-harness>/bin/sh-gen-agents.sh <target>  # from a checkout
bash <spec-harness>/bin/sh-gen-agents.sh --check <target>  # from a checkout
npx -y github:chohra-med/spec-harness-oss generate-agents <target>        # no checkout
npx -y github:chohra-med/spec-harness-oss generate-agents --check <target>  # no checkout
```

The `npx` lines run the same subcommand through the package's `spec-harness` CLI, which routes `generate-agents` to `bin/sh-gen-agents.sh`. Use them when no harness checkout is on the machine.

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

The reviewer's `GEN:rules` block also names the lens path `ai_rules/review-lens.md` and its item IDs (`LENS-<n>`) when that file has items: lines inside HTML comments are not items, and a lens with no items means no lens. It names them and never copies their text, the same rule as for rule IDs: the review reads the file itself.

Do not fill unselected roles merely because a template exists. A change to the inventory or to any cited source makes affected bindings stale. For an initialized target, follow the single guarded refresh procedure in `.claude/commands/sdd.md`: capture exact receipt, inventory and output preimages before reindex; prove prior generated ownership and absence of intervening custom edits; re-ground changed citations; then enumerate every skill and selected role GEN block whose raw inventory marker changed. Refresh only verified generated content and receipt rows. A matching receipt hash alone never authorizes replacement. A harness update (`spec-harness update`) that writes an `UPDATE`, `NEW` or `MERGE` file while a synthesis receipt exists leaves `.spec-harness/synthesis-stale.json`. A plan that writes only `CONFLICT` proposals leaves no marker. Its presence refuses READY whatever the receipt bytes say; the init procedure deletes that marker as the last write of the guarded refresh, after the receipt and every generated output are written, and only then runs the check. Preserve custom/mismatched skills, populated human rules without an authorized generated region and role bytes outside GEN, reporting `CONFLICT/PENDING` when ownership is unproven.

## Receipt schema and readiness

`.claude/agents/.init-synthesis.json` uses `format: "spec-harness-synthesis"` and `schema_version: 1`. It records:

- `status`, `inventory_path`, raw `inventory_sha256`, exact inventoried `package_paths`, and `pending_reasons`;
- each package's `rules_path`, output SHA-256 and `citations`;
- the core skill names `spec-harness-architecture`, `spec-harness-performance`, `spec-harness-packages`, plus `spec-harness-quality` and `spec-harness-conduct` on a first initialisation (schema 2; an existing schema-1 receipt keeps only the first three), plus at most five `spec-harness-tech-<technology>` skills scoped to the packages that use that technology, each with output paths/hashes, package paths and citations;
- selected `roles` and `excluded_roles`, with role file paths/hashes, package paths, citations, and selection/exclusion reasons.

Status words differ by row: the receipt, each package row and each skill row say `"READY"`; each
selected role row says `"BOUND"`. A role row has exactly this shape (one per selected role; the
`package_paths` list equals the receipt's own):

```json
{ "name": "sdd-implementer", "path": ".claude/agents/sdd-implementer.md", "status": "BOUND",
  "sha256": "<sha256 of the role file after its GEN:rules block is filled>",
  "package_paths": ["."], "citations": [ ... ], "reason": "core role required for ticket work" }
```

A package row may also list `rule_modules`: package-local topic files at `<package>/ai_rules/rules/<topic>.md` (`ai_rules/rules/<topic>.md` for the root), each with `name`, `path`, `sha256` and `citations`. Each module carries the raw-inventory source-bound marker, cites its own lines, and is linked from that package's `RULES.md`. While a router or module still matches the receipt, `index` records it as `receipt-generated` without a hash, so refreshing its marker does not change the inventory.

**Schema 3 (policy coverage).** Use `schema_version: 3` when the receipt also records how the project's own policy files were covered. Schema 3 keeps every schema 2 requirement, including the five core skills, and adds:

- `policy_sources`: one row per project policy file read (`path`, `sha256`, `requirement_ids`, the atomic requirements found in it);
- `policy_coverage`: exactly one row per requirement id, with `id`, `path`, `sha256`, `line_start`, `line_end` and a `disposition`. `captured` names a registered `rule_path` (a package `RULES.md` or rule module) and a `rule_anchor` text found in it; `not-applicable` gives a `reason`; `conflict` and `owner-decision` give a reason and keep the receipt PENDING until resolved.

For schema 3 the check also rejects a policy file whose bytes changed after `index` hashed it. Schema 1 and 2 receipts keep their meaning and are not asked for a ledger.

A `policy_coverage` row may carry `text_sha256`: the SHA-256 of its own span. The span text is the file decoded as UTF-8 (invalid bytes replaced), split with Python's `str.splitlines()` (so `\r\n`, `\r` and the other Unicode line breaks all end a line), lines `line_start` to `line_end` joined with `\n`, no final newline: `python3 -c 'import hashlib,sys; l=open(sys.argv[1],"rb").read().decode("utf-8","replace").splitlines(); print(hashlib.sha256("\n".join(l[int(sys.argv[2])-1:int(sys.argv[3])]).encode()).hexdigest())' <file> <start> <end>`. Write it on every row whose source is under `.memory/`. The span must hold the whole requirement text: a span of only blank or heading lines is refused, and so is a span whose next non-blank line is indented deeper than the span's first line (the item goes on, also after a blank line). A sibling item or a labelled line (`Evidence: ...`) at the same indent is a new item; the check cannot tell a plain wrapped paragraph from that, so the span of a requirement written over several plain lines must cover all of them. A `null` `text_sha256` is malformed, not absent. Memory is edited every session, so when a `.memory/` source no longer matches its recorded `sha256`, the check looks for each row's text instead: at its recorded span, or moved to exactly one span of the same length. When every row is found, READY stays and a `NOTE:` line names the file; a requirement written into it since synthesis (or a note that contradicts a recorded one) is not in the ledger until the next guarded refresh, so the NOTE is the signal to review that file. A row whose text changed or is gone fails, and so does one whose text moved and is found more than once (text still at its recorded span passes, even with a copy elsewhere), and so does a changed memory source with a row that has no `text_sha256`; every disposition, reason and anchor check still runs on each row. Limits: an identical copy of a deleted requirement elsewhere in the same file (a quoted log line) counts as the requirement moved; a change inside invalid UTF-8 bytes is not seen. Every other policy source keeps the whole-file hash check, and a `text_sha256` on an unchanged source must match its span.

**Schema 4 (rule layers).** A first initialisation writes `schema_version: 4`. It keeps every schema 2 requirement, checks the schema 3 ledger when the receipt has one (in v1 the ledger is optional), and checks the rule layers in `rules.md` (`Rule layers`):

- `stack`: `{ "path": "ai_rules/stack.md", "sha256": "<hash>" }`. The check rebuilds the file from the manifests and lockfiles (`spec-harness stack <target>`) and refuses READY when it differs.
- Every rule module declares `<!-- rule-layer: baseline|tool|project -->`; a tool module also declares `<!-- applies: <package> <range> -->`, and the stack version must be inside that range. A module made from a pack keeps `<!-- pack: <name> -->` and copies the pack's rule lines byte for byte.
- A standard module (`<!-- rule-layer: standard -->`) names the owner's commitment with `<!-- commitment: STD-<n> -->`; each `STD-` line in `.memory/10-product.md` states `status: in place|required|planned` and has at least one standard module. Standard packs are never required by default.
- `rule_conflicts`: `[{ "ids": ["SEC-04", "DEC-007"], "status": "resolved", "winner": "DEC-007", "reason": "..." }]`. An open conflict refuses READY.
- A `captured` ledger row's `rule_anchor` is the ID of a rule line in its `rule_path`, never free text or a list of requirement IDs. The `rule_path` may be `.memory/10-product.md` or `.memory/60-decisions.md` when the requirement is a business rule or a decision.

The check parses every rule line in the package `RULES.md` files, the rule modules, `.memory/10-product.md` and `.memory/60-decisions.md`, and fails on an unreadable or pointer line, an ID defined twice, two rules with the same words, an override by a lower layer, a `PROPOSED` rule, a package version outside `ai_rules/stack.md` (in a rule, a skill or a role's `GEN:rules` block), and a skill or role block that copies a rule sentence instead of naming its ID. Schema 1, 2 and 3 receipts keep their meaning and are not asked for layers.

Each citation has `package_path`, `path`, `line_start`, `line_end` and `sha256`. A citation is a representative source, an applicable policy file, or an in-package first-party source file (a supported source suffix or `package.json`/`pyproject.toml`/`composer.json`). An in-package file is refused when it is hidden; inside a dependency or build folder such as `node_modules`, `vendor` or `build`; a private, credential or signing file; an env file; a dataset; a generated file; an excluded path; in a nested package or nested repository; a harness file; a symlink or other unsafe file; over 128 KiB; a secret-like name (the file name, ignoring case, `-`, `_` and `.`, contains `secret`, `credential`, `password`, `passwd`, `apikey`, `privatekey` or `token`, so `tokenizer.py` is refused too); or spelled differently from the disk. A hard link to a file outside the project is not detected (the indexer has the same limit). Each package row cites at least one representative source. A technology skill (`spec-harness-tech-<technology>`) chooses its own `package_paths`, so it cites at least one source file from each of them. A core skill or a role cites at least one source file and need not cite a file from every package in its `package_paths`, because each listed package already has a package row with a representative source; a span repeated only to cover a package is filler, not evidence. The check enforces these counts only: whether each OBSERVED claim cites the file that shows it is for the semantic reviewer. A citation may also point at a project policy file (for example `AGENTS.md`) when the inventory's `rule_files` lists it with `read_status: read` and a matching `sha256`, and the cited package's `applicable_instructions` includes it (project inventory JSON only); the line span and hash checks still apply. Policy citations add provenance and never replace source evidence: every package row still needs at least one representative-source citation. The readiness check rejects missing files, changed hashes, out-of-package citations, invalid line spans, generic/stub rule text, unsupported or incomplete inventory, skill conflicts, missing required roles, missing markers or stale role blocks. It prints each detected defect and exits nonzero. PENDING is the only honest result when synthesis or evidence is unresolved.

A passing `--check` proves structural integrity and current cited bytes only. Before declaring overall initialization READY, `spec-harness doctor <target>` must report `structural: READY` and a separate fresh reviewer must check that every cited span supports its claim, that each claim holds for every package the output lists, package boundaries are respected, and policy conflicts or unsupported recommendations are surfaced. Record the review outcome; if no independent review context is available, keep overall initialization PENDING even when this checker prints READY. The check does not prove a role was dispatched or that a feature goal passed; feature acceptance remains separate.
