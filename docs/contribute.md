# Contribute a fix or a skill

This page is the short path from "I found a problem" or "I wrote a useful skill" to a pull request (PR) that a maintainer can merge. It adds to [CONTRIBUTING.md](../CONTRIBUTING.md); where they differ, that file wins. Reviewers use [Review a pull request](review-a-pr.md), so reading it first tells you what your PR will be measured against.

## Before you start

- Reproduce the problem in a fresh, empty folder with the released version, not only in your own workspace. A problem you can only see in your own files is usually a local setting.
- Search the open and closed PRs and the [CHANGELOG](../CHANGELOG.md) for the same idea. A recorded design decision can already answer it. Changing a recorded decision is allowed, but the PR must say so.
- Keep private material out. No company or client names, no personal paths, no credentials, no real project records, in the diff, the tests or the description. If you found the problem at work, rewrite the example with made-up names.
- One concern per PR.

## Fix a bug or a wrong sentence

1. Fork `chohra-med/second-brain-starter` and branch from `main`.
2. Write a test that fails because of the bug. Run `node --test` and watch it go red.
3. Make the smallest change that turns it green. Touch only the lines the fix needs.
4. Run the whole suite: `node --test`. Delete stray `.DS_Store` files first, as [CONTRIBUTING.md](../CONTRIBUTING.md#local-files-that-break-the-real-tree-tests) says.
5. Break your change on purpose, for example revert one line, and confirm a test goes red. A test that cannot fail proves nothing.
6. Open the PR and fill in the template.

## Add a skill

A skill is a folder with one `SKILL.md` that an assistant follows. The starter installs every shared skill twice, once for each client folder, so a new skill touches the manifest, the allowlist and the counts. One helper does the part people get wrong.

1. Write `template/shared-skills/<name>/SKILL.md`. The front matter needs `name:` (the same as the folder) and `description:`. Say what the skill reads and what it writes. A skill that runs nothing and writes nothing should say so. Other files the skill needs (references, assets) go in the same folder.
2. Register it: `node tools/add-skill.mjs <name>`. For every file in the folder it adds the two manifest entries with their SHA-256 and the allowlist line, and a second run adds nothing. It prints the new skill count.
3. Update by hand what it names: the skills table in [README.md](../README.md) and the count in words in two places, the same count in `docs/first-loop-and-projects.md` and `docs/free-and-builder-ai-os.md`, and the `installedSkills` list and count in `test/installer.test.mjs`.
4. If the skill needs a procedure file under `template/03-Resources/Procedures/`, add it to the manifest and the allowlist the way `today.md` is. The helper does not do this one.
5. Write a test for what the skill promises, in a file of its own like `test/today-context.test.mjs`.
6. Run `node --test`. The package scanner rejects a file that is not on the allowlist, a private path and a secret, so a green run covers those.
7. Write the "Design decision" lines in the PR description, as [CONTRIBUTING.md](../CONTRIBUTING.md) asks for a new automation: what the skill reads, what it writes, what it never does, and how it differs from the closest existing skill.

Do not change `VERSION`, `package.json`, the manifest's `templateVersion`, or the CHANGELOG and UPGRADING headings. The maintainer sets the version when a release is cut and writes the entry from the lines in your PR.

## Write the PR description

Use the template. The parts reviewers read first:

- **What and why**: two or three sentences, and the problem before the fix.
- **How I found it**: the smallest steps that show the problem in an empty folder. Say if an assistant wrote any of the code or tests; the review then checks the tests harder, because the same author wrote both sides.
- **Evidence**: the end of the `node --test` output, the name of the test that was red first, and the test that went red when you broke the change on purpose.
- **Rules this touches**: every recorded decision, privacy read scope or README claim your change relies on or changes. This is the part most often left out, and the one that matters most.
- **Existing installs**: what `upgrade` does for someone who already has these files, and how to undo it.

## After you open it

A maintainer runs the review in [Review a pull request](review-a-pr.md) and answers with one of four verdicts: merge, fix first (with a numbered list), split, or decline with the reason. Fix-first lists are short and ranked. Answer each number in the PR, then push to the same branch.
