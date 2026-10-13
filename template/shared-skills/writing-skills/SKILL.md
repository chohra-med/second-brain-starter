---
name: writing-skills
description: Explains how to write a good skill for an AI coding assistant. Covers what a skill is, how its name and description decide when it runs, and how to keep it short, checkable and free of facts that change. Use when you create or edit a SKILL.md file, or when a skill does not run when it should.
---

# Writing skills

A skill is a folder that holds one file, `SKILL.md`. The file tells an AI assistant how to do one kind of task. The assistant reads the header first, decides whether the task matches, and reads the rest only after it has chosen the skill.

For the full method, including how to test a skill, read the `skill-creator` skill that ships in this folder. This page covers the basics. It does not copy that method.

## Do not use this when

- You only need to run a skill. Read its instructions and run them.
- You need to test or measure a skill. Use `skill-creator`.

## What a skill is

- One folder with one `SKILL.md`.
- Optional folders beside it for references, templates or scripts.
- Plain Markdown. A header, then instructions.

The header is the block between the two lines of three dashes at the top of the file.

## The name and the description

```markdown
---
name: example-skill
description: One sentence on what the skill does, then when to use it.
---
```

- **`name`** is short and lowercase, with hyphens between words. It matches the folder name.
- **`description`** decides when the skill runs. The assistant compares the user's request with this text. Name the task and the words a user would use. Put the "use when" part here, not in the body, because the body is read only after the skill is chosen.

## One job per skill

One skill does one kind of task. If the description needs "and" twice, split the skill in two.

## Say when not to use it

Add a short "Do not use this when" list. It stops the skill from running on a request it does not fit.

## Keep changing facts out

Do not write prices, version numbers, people's names or private paths into a skill. Put each fact in the one file that owns it. Then point to that file by its path. A copied fact goes stale. A pointer to the owner stays correct until the owner moves, so check the path when you move a file.

## Steps a reader can check

Write numbered steps. Each step says three things: what to read, what to write, and what to check before the next step. A step with no check cannot be verified.

## A tiny complete example

```markdown
---
name: check-links
description: Find broken relative links in one Markdown file and list them. Use when a user asks to check the links in a document before sharing it.
---

# Check links

Do not use this for a whole website. Use a site crawler for that.

1. Open the file the user names. Read it from top to bottom.
2. List each link with its line number and its target.
3. For each relative link, check that the target file exists.
4. Report each broken link with its line number. Do not change any link unless the user asks.

Check: the report lists every relative link in the file. Each broken link has a line number.
```

## Checklist

1. The folder name matches `name`.
2. `description` says what the task is and when to use it.
3. The skill does one job.
4. A "Do not use this when" list is present.
5. There are no dates, prices, people's names or private paths.
6. Each fact points to the file that owns it.
7. Each step has a check.
8. There is a short example.
9. The sentences are plain. There are no em dashes.
10. In a fresh session, the assistant picks the skill for a matching request and skips it for a wrong one.
