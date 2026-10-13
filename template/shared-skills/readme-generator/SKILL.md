---
name: readme-generator
description: Write a README.md for any software project. It says what the project is, who it is for, and gives a quickstart that runs. Use when a project needs its first README, a rewrite, or a check before it is shared or published.
---

# README generator

A README answers three questions on its first screen: what is this, who is it for, and how do I try it. Write the answers in that order. Check every command and name against the source before you write it down.

## Do not use this when

- The project has no users yet and no decided purpose. Settle the purpose first, for example with the `grill-me` skill.
- The task is a comment or a single line in an existing README.

## Step 1: Read the project

Read these, in order, if they exist:

1. The package or project manifest: name, description, scripts, binaries, license field, and any "private" flag.
2. The file tree, two levels deep.
3. The existing README, the LICENSE file and the CONTRIBUTING file.
4. The git remote, if there is one.

Fix four facts before you write:

- **What it is.** A library, a command-line tool, an app, a template, or a set of documents.
- **Who it is for**, and the one job it does.
- **Is it published?** Only a published package gets install badges.
- **Is the repository public?** Only a public repository gets public badges such as license or stars. Check with your host's tool if you are not sure.

If two facts conflict, ask one short question instead of guessing.

## Step 2: Write the sections in order

Trim any section the project does not need.

1. **Title and summary.** One plain sentence under the title, saying what the project does.
2. **Quickstart.** The smallest real example that runs: the install command and a short usage example. Put it near the top.
3. **What it does.** Three to six short bullets. Each bullet names a capability.
4. **Install.** The exact commands. Name the required tools and their versions, and any setup step.
5. **Usage or API.** Real names from the source, in a table or short examples.
6. **Configuration.** Each variable or flag, what it does, and its default.
7. **Contributing.** One line, or a link to the CONTRIBUTING file.
8. **License.** One line that names the license file.

Rules for the draft:

- Every code block must run. If it needs setup first, say so above it.
- Use names copied from the source. Do not invent a name.
- Put options in a table.
- Do not add filler headings such as "Introduction".
- Do not repeat the summary three times.
- Do not add a badge that does not resolve. A broken badge reads worse than no badge.
- Do not include secrets, private file paths, client names or internal notes.

## Step 3: Write in plain words

- Use short sentences. One idea per sentence.
- Define a term the first time you use it.
- Do not use em dashes. Use a comma, a period or parentheses.
- Cut hype words such as "seamless", "robust", "powerful", "unlock" and "game-changer". Replace each with the concrete fact.
- Say what is missing or not yet built.

## Step 4: Check before you hand it over

1. Run each quickstart command in an empty folder. Record what it printed.
2. Compare each name, flag and path with the source. Search the source. Do not rely on memory.
3. Check each link. It must open.
4. Read each sentence once. If a sentence has two readings, split it.
5. Run a writing cleanup on the prose if your tools have one. Do not change code blocks, commands or links.

End your report with two lines: what you checked, and what you could not check, such as a command that needs an account you do not have.

## Example skeleton

```markdown
# example-tool

A command-line tool that counts lines in Markdown files.

## Quickstart

    npm install example-tool
    npx example-tool count notes/

## What it does

- Counts lines in every `.md` file under a folder.
- Prints one total per folder.

## Options

| Flag | Default | What it does |
|---|---|---|
| `--json` | off | Print the counts as JSON |

## License

MIT. See LICENSE.
```
