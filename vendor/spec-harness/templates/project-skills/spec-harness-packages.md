---
name: spec-harness-packages
description: Derive or review dependency and package-boundary guidance from the selected project's manifests and actual package source. Use during initialization, dependency work, or mixed-stack planning.
---

# Project package procedure

For current version-dependent recommendations, follow the reusable owner at
`.claude/commands/spec-harness/package-finder.md`. This project-derived copy records local
package evidence and boundaries; the reusable owner handles current documentation discovery.

This source procedure is a generic scaffold. During initialization, create a project-specific copy only when this name is absent. Until that copy cites the target's actual files and passes the synthesis check, it remains PENDING.

## Read and derive

1. Read the target's applicable instructions and inventory. Enumerate package paths, manifest formats/status, declared dependency names, scripts, representative source, lockfiles, workspace declarations and exclusions.
2. Open the manifest and actual representative source for each supported package. Cite exact `path:line` spans and SHA-256. The inventory parses `package.json` and `pyproject.toml` only; keep every other manifest format visible as `unsupported` and do not guess its dependency contents.
3. Record package-specific boundary rules from observed imports, exports, workspace declarations, tests and configuration. A declared dependency does not prove it is used or approved.
4. When a dependency recommendation depends on current version behavior, consult that package's official documentation and cite URL plus access date. Label recommendations separately; do not change manifests, versions or architecture as part of this procedure.
5. Keep package rules separate across different languages, runtimes and deployment boundaries. State `not established` when evidence is absent.

## Output contract

The project copy identifies the package paths it covers, the exact supported/unsupported manifests, dependencies and scripts it read, and source citations for its boundary rules. Incomplete inventories and unsupported formats are recorded as `PARTIAL/PENDING`, not hidden behind an aggregate stack label.

Record output path, citations and source hashes in `.claude/agents/.init-synthesis.json`. After changing a cited source or rule, refresh only affected bindings. Run `bash <spec-harness>/bin/sh-gen-agents.sh --check <target>`; a passing structural check does not replace a fresh semantic review.
