# Command: `migrate` — inventory an existing repository

> Migration starts with bounded read-only inventory. It does not derive architecture from a path
> list or write README files into product source.

## Invocation

```text
spec-harness index <target>
/sdd init
```

`spec-harness index` reads the selected tree and writes a bounded inventory under
`ai_rules/`. With no custom `context_map.md`, it writes `ai_rules/context_map.md`; when a custom
map already exists, it preserves that file and writes `ai_rules/project_inventory.json` instead.
The inventory records recognized package manifests, declared dependency/script names, bounded
representative source paths and exclusions. It does not parse source symbols or write inventory
READMEs into product-source directories. No manifest command is executed.

After indexing, `/sdd init` reads the target's own policies and actual representative source, then
follows `.claude/commands/spec-harness/init.md` to synthesize package rules, project skills and
role bindings. Unsupported manifests, incomplete scans or missing citations remain PENDING/PARTIAL.
A structural receipt check does not replace fresh semantic review.

Never skip project instructions or claim architecture from inventory paths alone. Keep target
customizations and all unrelated source bytes intact.
