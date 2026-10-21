# Companion skills and tools

Spec Harness is deliberately small. These are the tools it is designed to work beside. Three ship
inside it; the others are separate projects you install yourself. An agent following the harness
checks for them and uses them when present. It never installs one without your yes.

| Tool | Ships with Spec Harness | What it adds | Used at |
|---|---|---|---|
| **Ponytail** | Yes (`commands/ponytail.md`) | The smallest correct change: reuse first, no speculative abstraction | planning, implementing |
| **Grill Me** | Yes (`commands/grill-me.md`) | Questions that ground a plan in the real source before any code | planning |
| **teach** | Yes (`commands/teach.md`) | Explains a system to a human as one interactive page | onboarding, after setup |
| **Understand-Anything** | No; offered on every `init` | A knowledge graph of the codebase with a dashboard, guided tours and diff impact | indexing, onboarding, review |
| **graphify** | No | A visual, queryable map of the codebase | indexing |
| **diagram-design** | No | An editorial design system for diagrams | every diagram |
| **Superpowers** | No | Planned companion; not wired in yet | later |

## Understand-Anything: a map you can ask questions

[Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) (MIT) builds a knowledge
graph of a codebase and gives you a dashboard, guided tours, plain-language explanations of a file
or function, and the likely impact of a diff. `/sdd init` offers it every time; it is installed only
when you say yes.

In Claude Code:

```text
/plugin marketplace add Egonex-AI/Understand-Anything
/plugin install understand-anything
```

Pin what you reviewed: note the plugin version `/plugin` shows after the install in
`.memory/30-tech.md`, and read the release notes before you update it. It needs Node.js 18 or newer.

Then, from your project root:

```text
/understand              # build the graph; later runs only re-read what changed
/understand-dashboard    # open the map
```

The first `/understand` reads the whole codebase and spends many tokens; run it once, on purpose.
It writes `.ua/knowledge-graph.json` and `.ua/config.json`, which a team can commit. Add
`.ua/intermediate/` and `.ua/diff-overlay.json` to `.gitignore`. Other commands include
`/understand-chat`, `/understand-diff`, `/understand-explain`, `/understand-onboard` and
`/understand-domain`.

The graph helps an agent find where to look. It is never evidence: a rule, plan or review still
cites the real file and line.

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
