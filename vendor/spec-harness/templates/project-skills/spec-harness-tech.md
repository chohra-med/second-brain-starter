---
name: spec-harness-tech
description: Derive one project skill for a major technology the selected project actually uses, from its manifests, its own source and that technology's official documentation. Use during initialization or when a new framework or platform enters the project.
---

# Project technology procedure

This source procedure is a generic scaffold. During initialization, create one project-specific copy per major technology, named `spec-harness-tech-<technology>` (for example `spec-harness-tech-react-native`), only when that name is absent. The technology part is lowercase letters and digits joined by single hyphens, so `Next.js` becomes `nextjs`. Until a copy cites the target's actual files and passes the synthesis check, it remains PENDING.

## Select

1. Read the inventory manifests and representative source. A technology qualifies when a manifest declares it and first-party source imports or configures it. A dependency that is declared but unused does not qualify.
2. Pick the frameworks, platforms and state or data layers that shape how code is written in this project, at most five. Skip utilities and anything the architecture, performance or packages skills already cover.
3. Record each selected technology with its evidence, and each skipped candidate with the reason.

## Derive

1. For each selected technology, state the package paths that use it. A technology skill applies only to those packages.
2. Record how this project uses the technology, from its own source. Cite exact `path:line` spans and SHA-256, and label these `OBSERVED`.
3. Add the practices from the technology's official documentation that this project should follow for its installed version. Cite the URL and access date, and label these `RECOMMENDATION`. Where the project's code contradicts one, surface the conflict for a human decision.
4. Keep the skill short: what to do, what to avoid, and which project file shows the pattern. State `not established` where evidence is absent.

## Output contract

Each copy lives at `.claude/skills/spec-harness-tech-<technology>/SKILL.md`, names the package paths it covers, carries the inventory-hash source-bound marker and cites the lines that support it.

Record its name, path, package paths, citations and hash in `.claude/agents/.init-synthesis.json` beside the three core skills. Run `bash <spec-harness>/bin/sh-gen-agents.sh --check <target>`; a passing structural check does not replace a fresh semantic review.
