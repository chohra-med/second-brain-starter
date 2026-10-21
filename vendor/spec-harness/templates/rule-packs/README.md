# Rule packs

Curated rules that `init` copies into a target's `ai_rules/rules/` as rule modules. They are
written once here, reviewed with the harness and versioned with it, so every project gets the same
wording instead of rules regenerated in different words each time.

- `baseline-*.md`: engineering rules every project adopts (clean code, security, error handling,
  performance, testing, accessibility). Layer `baseline`.
- `standard-*.md`: rules for a named standard or law (for example the European Accessibility Act with
  EN 301 549, OWASP MASVS). Adopted only when the owner records a commitment in
  `.memory/10-product.md`; layer `standard`.
- `tool-*.md`: rules for one package, used only when that package is in the project's
  `ai_rules/stack.md` and its version is inside the pack's `applies` range. Layer `tool`.

Rule line format, the same in every layer:

```text
- **SEC-01** One plain sentence that a reviewer can check. (source: <document>, <URL>)
```

A target module made from a pack keeps the pack's `rule-layer`, `pack` and `applies` markers and
copies each rule line it adopts byte for byte. It may leave out a rule that does not apply; it may
not reword one. A project that needs a different rule writes its own rule in a higher layer with
`overrides <ID>` in its source tag and records the decision in `.memory/60-decisions.md`.

Sources were checked on 2026-10-21. A pack whose source moves or changes is updated here, never in
a target.
