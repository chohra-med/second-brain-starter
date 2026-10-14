---
name: spec-harness-conduct
description: Derive how a project works from its own policy files, including the test command and what green means, the review bar, commit and pull request conventions, the code of conduct and what needs a human decision. Use during initialization or before a change that needs the project's contribution rules.
---

# Project conduct procedure

This source procedure is a generic scaffold. During initialization, create a project-specific copy only when this name is absent. Until that copy cites the target's actual files and passes the synthesis check, it remains PENDING.

## Read and derive

1. Read the policy files that exist: `AGENTS.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `RULES.md`, CI configuration, test configuration and pull request templates. Follow each file's own startup sequence. Record each file read and each one absent.
2. State the test command from the file that names it: a package script, a CI job or a policy file. Cite exact `path:line` spans and SHA-256. Record what green means there, meaning which command must exit 0 and which checks are required.
3. State the review bar, the commit and pull request conventions and the branch and merge rules only from those files. Quote the owning file and line for each rule.
4. Name what needs a human: publishing, merging, tagging, releasing, deleting data, or changing an external system. Cite the policy that assigns that authority. If no policy assigns it, write `not established` and mark the step as the owner's decision.
5. Where no policy file covers a topic, write `not established` for that topic. Never invent a conduct rule, a review rule or a commit format.

## Output contract

The project copy lists the policy files it read with their paths, gives the test command with its citation, and states the code of conduct, review, commit, pull request and human-decision rules, each with a citation or `not established`. Conflicts between policy files are listed for the owner. Unsupported or unreadable policy is listed and remains PENDING.

Record output path, citations and source hashes in `.claude/agents/.init-synthesis.json`. After changing a cited source or rule, refresh only affected bindings. Run `spec-harness generate-agents --check <target>` (with no install: `npx -y github:chohra-med/spec-harness-oss generate-agents --check <target>`); a passing structural check does not replace a fresh semantic review.
