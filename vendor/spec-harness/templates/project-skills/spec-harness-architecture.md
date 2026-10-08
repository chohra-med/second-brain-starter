---
name: spec-harness-architecture
description: Derive or review package-scoped architecture rules from a project's actual source, tests, manifests and existing policies. Use when mapping boundaries, layering, module ownership, or architecture constraints during Spec Harness initialization or rule review.
---

# Project architecture procedure

This source procedure is a generic scaffold. During initialization, create a project-specific copy only when this name is absent. Until that copy cites the target's actual files and passes the synthesis check, it remains PENDING.

## Read and derive

1. Read the target's applicable instructions and startup sequence before source analysis. Preserve their authority.
2. Read `ai_rules/project_inventory.json`, or the generated `ai_rules/context_map.md` when the JSON is unavailable. Enumerate each package path, representative source path, manifest status, applicable instructions, exclusions and unsupported formats.
3. Open actual representative source and relevant tests/config for each package. Cite exact `path:line` spans and SHA-256. Do not infer boundaries or layering from package names, folders, or dependency labels alone.
4. Describe observed module boundaries, dependency direction, entry points, shared contracts and test patterns. Keep each rule scoped to the package where the evidence was read. Consider SOLID only when source shows a concrete boundary or testability issue; otherwise label it as a review heuristic, not a project fact.
5. If advice depends on current framework behavior or a correctness issue, consult official primary documentation; cite URL and access date and label it `RECOMMENDATION`. Existing policy/code disagreement is reported for resolution, never silently overwritten.

## Output contract

The project copy names package applicability, separates `OBSERVED` facts from `RECOMMENDATION`, and gives every project-specific rule a source citation. It does not prescribe an architecture migration or copy rules across different stacks without evidence. Unsupported or unreadable packages are listed and remain PENDING.

Record output path, citations and source hashes in `.claude/agents/.init-synthesis.json`. After changing a cited source or rule, refresh only affected bindings. Run `bash <spec-harness>/bin/sh-gen-agents.sh --check <target>`; a passing structural check does not replace a fresh semantic review.
