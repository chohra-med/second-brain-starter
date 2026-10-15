---
name: spec-harness-quality
description: Derive or review clean-code and SOLID guidance from a project's actual source, covering naming, function size, error handling, duplication and readability. Use when a project needs code-quality rules or when reviewing a change for maintainability.
---

# Project quality procedure

This source procedure is a generic scaffold. During initialization, create a project-specific copy only when this name is absent. Until that copy cites the target's actual files and passes the synthesis check, it remains PENDING.

## Read and derive

1. Read the target's applicable instructions and inventory. Keep each package's coding conventions in its own `RULES.md`; do not restate them here as new rules.
2. Open actual representative source for each applicable package. Cite exact `path:line` spans and SHA-256. Inventory names and paths alone do not show a quality pattern.
3. Derive clean-code rules only from that source: naming, function size, error handling, duplication and readability. Label each rule `OBSERVED` with its citation. Label a general practice the source does not show as `RECOMMENDATION`.
4. Mention SOLID only when source shows a concrete boundary or testability issue, with a `path:line` citation. Otherwise omit it or label it `REVIEW HEURISTIC`, not a project fact.
5. Do not invent a metric, a line-count limit or a style rule. Write `not established` where the source gives no evidence.

## Output contract

The project copy names the package paths it covers, separates `OBSERVED` rules from `RECOMMENDATION` and `REVIEW HEURISTIC` entries, and cites every observed rule. A linter or formatter configuration is cited as a configuration fact, not as proof of code quality. Unsupported or unreadable packages are listed and remain PENDING.

Record output path, citations and source hashes in `.claude/agents/.init-synthesis.json`. After changing a cited source or rule, refresh only affected bindings. Run `spec-harness generate-agents --check <target>` (with no install: `npx -y github:chohra-med/spec-harness-oss generate-agents --check <target>`); a passing structural check does not replace a fresh semantic review.
