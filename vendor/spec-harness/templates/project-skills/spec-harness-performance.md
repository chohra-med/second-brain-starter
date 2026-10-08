---
name: spec-harness-performance
description: Derive or review performance guidance from measured project behavior, actual hot-path source, tests and configuration. Use when a project needs performance rules or when evaluating a performance-sensitive change.
---

# Project performance procedure

This source procedure is a generic scaffold. During initialization, create a project-specific copy only when this name is absent. Until that copy cites the target's actual files and passes the synthesis check, it remains PENDING.

## Read and derive

1. Read the target's applicable instructions, inventory and package-scoped rules. Preserve project constraints.
2. Open actual representative source, tests, benchmarks and runtime configuration for each applicable package. Cite exact `path:line` spans and SHA-256. Inventory paths alone do not prove a bottleneck.
3. Record an observed performance rule only when code, a benchmark or production measurement supports it. State the workload, metric and measurement source. If no measurement exists, label advice `RECOMMENDATION` or `REVIEW HEURISTIC`; do not invent a metric or claim improvement.
4. Do not prescribe blanket memoization, caching, concurrency or data-structure changes. Tie each recommendation to a measured or source-visible path and explain the correctness tradeoff.
5. For current framework/runtime guidance, consult official primary documentation and cite its URL and access date. Keep it distinct from project observations.

## Output contract

The project copy names its package paths, measured evidence (or says none was found), source citations and any recommended validation method. Different packages get separate guidance where runtimes or workloads differ. Unsupported or unreadable packages are listed and remain PENDING. Existing project policy stays authoritative unless its owner resolves a conflict.

Record output path, citations and source hashes in `.claude/agents/.init-synthesis.json`. After changing a cited source or rule, refresh only affected bindings. Run `bash <spec-harness>/bin/sh-gen-agents.sh --check <target>`; a passing structural check does not replace a fresh semantic review.
