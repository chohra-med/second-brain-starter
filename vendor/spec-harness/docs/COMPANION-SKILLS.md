# Companion skills and tools

Spec Harness is deliberately small. These are the tools it is designed to work beside. Three ship
inside it; the others are separate projects you install yourself. An agent following the harness
checks for them and uses them when present. It never installs one without your yes.

| Tool | Ships with Spec Harness | What it adds | Used at |
|---|---|---|---|
| **Ponytail** | Yes (`commands/ponytail.md`) | The smallest correct change: reuse first, no speculative abstraction | planning, implementing |
| **Grill Me** | Yes (`commands/grill-me.md`) | Questions that ground a plan in the real source before any code | planning |
| **teach** | Yes (`commands/teach.md`) | Explains a system to a human as one interactive page | onboarding, after setup |
| **graphify** | No | A visual, queryable map of the codebase | indexing |
| **diagram-design** | No | An editorial design system for diagrams | every diagram |
| **Superpowers** | No | Planned companion; not wired in yet | later |

## graphify: see what was indexed

[graphify](https://github.com/Graphify-Labs/graphify) (Apache-2.0) turns a folder of code into a knowledge
graph you can open in a browser. `spec-harness index` writes an inventory for agents; graphify
draws the same codebase for you.

```sh
pipx install graphifyy          # the package name has two y
graphify install --platform claude   # or codex, cursor, gemini, ...
```

Then, from your project root:

```sh
graphify update .               # code only, no model needed
open graphify-out/graph.html    # the map
```

It writes `graphify-out/` with `graph.html`, `graph.json` and `GRAPH_REPORT.md`. Add `graphify-out/`
to your `.gitignore` unless your team wants the graph in the repository. Inside an agent, `/graphify
.` adds a model-led pass over documents and images as well.

During `/sdd init` the agent checks `command -v graphify`. When it is there, the agent runs
`graphify update .` after indexing and tells you where the map is.

## diagram-design: diagrams that explain

[diagram-design](https://github.com/cathrynlavery/diagram-design) (MIT, by Cathryn Lavery) is a
skill for drawing architecture, flow, sequence, layer, loop and many other diagram types as
self-contained HTML with inline SVG, with a checklist that stops the usual mistakes.

In Claude Code:

```text
/plugin marketplace add cathrynlavery/diagram-design
/plugin install diagram-design@diagram-design
```

Or as an editable checkout:

```sh
git clone https://github.com/cathrynlavery/diagram-design.git ~/code/diagram-design
ln -s ~/code/diagram-design/skills/diagram-design ~/.claude/skills/diagram-design
```

The `teach` command uses it when it is installed and falls back to a short set of built-in rules
when it is not. The diagrams in `learning_human.html` follow its design system.

## Superpowers

Planned as a companion for later. Nothing in Spec Harness depends on it today.
