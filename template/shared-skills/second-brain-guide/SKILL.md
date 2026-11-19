---
name: second-brain-guide
description: "Explains what the Second Brain starter is, how to read the installed template version, how to update an older install, and how to confirm that a fix landed. Use when the person asks how to use or update the Second Brain, whether this install is current, what changed since the installed version, or whether a fix landed."
metadata:
  scope: oss
---

# Second Brain guide

This skill answers four questions about an installed workspace: what the tool is, which version is installed, how to update an older install, and whether the fixes of a newer version landed. Every command below is read-only until the person approves an update. Each command block stands alone: it sets no variable that a later block needs, so it runs in a fresh shell.

## Do not use this when

- The person wants to set up a new workspace or connect a repository. Use `ONBOARDING.md` in the starter source copy.
- The person wants to change a rule, skill or workflow. Use `second-brain-icm`.
- You have to fetch a newer copy of the starter. That is a network step: ask the person first and say what you would fetch.

## What the tool is

- The Second Brain starter is a template for a local Markdown workspace: a map of rules and records, plus shared skills that every agent tool reads from `.agents/skills/` (and `.claude/skills/` for Claude Code).
- The workspace holds the installed files. The command line tool that installs, checks and updates them (`bin/second-brain.mjs`) is in the starter source copy, a separate folder. It is not inside the workspace.
- The commands are `status` (read-only summary), `verify` (read-only check), `upgrade` (a plan; you apply it with its digest only after the person confirms that digest in the chat) and `rollback`.

## Steps

1. **Read the installed version.** Run this in the workspace root:

   ```sh
   node -e "console.log(JSON.parse(require('fs').readFileSync('.second-brain/installed-state.json','utf8')).templateVersion)"
   ```

   Check: it prints one version such as `1.2.3`. If the file is missing, this is not an installed workspace: stop and tell the person.
2. **Find the source copy.** Ask the person for the folder of the starter source copy. Do not search the disk. If the person does not know it, say that you can fetch a fresh copy, that this is a network step, and what you would fetch. Wait for a yes. In every command below, write that folder in place of `<starter>`:

   ```sh
   test -f "<starter>/bin/second-brain.mjs" && cat "<starter>/VERSION"
   ```

   Check: the second command prints the source version. If it prints nothing, the folder is wrong.
3. **Compare.** Run, still in the workspace root:

   ```sh
   node "<starter>/bin/second-brain.mjs" status --target "$PWD"
   ```

   Check: the output has `Installed: template X` and `This CLI: template Y`. The line `Upgrade would plan:` counts the files by state. If X is lower than Y, or any file is not `IDENTICAL`, the install is behind the source. Say so and quote the lines. The `Agent guide:` line names this skill.
4. **Read what changed.** List the release headings of the changelog, then read every entry newer than X (and the `Unreleased` entries when the person asks about them). Read the same versions in `UPGRADING.md`:

   ```sh
   grep -n '^## ' "<starter>/CHANGELOG.md"
   grep -n '^## Upgrading to' "<starter>/UPGRADING.md"
   ```

   Check: you can name the first heading newer than X, and each entry you read is a fix you will report in step 7.
5. **Update (only when the person says yes).** Print the plan. It writes nothing:

   ```sh
   node "<starter>/bin/second-brain.mjs" upgrade --target "$PWD"
   ```

   Show the person the summary and any `CONFLICT` or `CUSTOMIZED-KEEP` lines. The plan ends with a `Plan digest:` line and an `Apply this exact plan with:` line. Apply only when the person confirms that exact digest. Never reuse a digest from an earlier plan. When the `Versions:` line shows the same version twice and every line is `IDENTICAL`, there is nothing to update. Check: after applying, step 6 passes and step 1 prints Y. To undo, see `docs/verify-update-rollback.md` in the starter source copy.
6. **Run the read-only checks.**

   ```sh
   node "<starter>/bin/second-brain.mjs" verify --target "$PWD"
   ```

   Check: the last line is `Verification: OK`. `MODIFIED` or `PERSONALIZED` lines are the person's own edits, not damage. On an install older than the source, `SOURCE_MANIFEST_MISMATCH` and `UNMANAGED` lines are expected: they say the install is behind.
7. **Report each fix.** For each changelog entry between X and Y, find the file it names (a skill, a procedure, a script) and read that file's state in the plan:

   ```sh
   node "<starter>/bin/second-brain.mjs" upgrade --target "$PWD" | grep -F "<path named in the entry>"
   ```

   Report one line per fix, with the output line as proof:

   | Report | When |
   |---|---|
   | landed | the plan line starts with `IDENTICAL` |
   | not landed | it starts with `CREATE` or `MANAGED-UPDATE` |
   | cannot tell | it starts with `CUSTOMIZED-KEEP`, `CONFLICT`, `SEED-UPDATE` or `PERSONALIZED`, there is no line, or the entry names no file |

   Check: every fix you list has one of the three words and one quoted line, or says that no line exists.

## An install that does not have this skill yet

An older install has no copy of this skill. The skill comes with the source copy: read `template/shared-skills/second-brain-guide/SKILL.md` in the starter source copy and follow it from step 2. `status` run from a newer source prints that path on its `Agent guide:` line. Step 5 then installs the skill into the workspace.

## What not to do

- Do not run `upgrade` with a digest, `rollback` or `verify --adopt` unless the person asked for exactly that.
- Do not change the installed files by hand to make `verify` pass.
- Do not report a fix as landed from the version number alone. Quote the plan line.
