# RFC 0001: neutral install route

Status: proposal. Not implemented in 0.4.0.

## Problem

Method owners are installed under `.claude/commands/spec-harness/`. That path is specific to Claude
Code, so Codex and other agents must open files by hand to find the same methods.

## Proposal

Install the method owners once, under a neutral `spec-harness/commands/` path that every client can
read. Keep the Claude route as a thin pointer or copy, so existing projects keep working.

## Compatibility

- The 0.3.0 and 0.4.0 routes under `.claude/commands/spec-harness/` stay in place until a later
  release says otherwise. Removing them would break projects that already reference them.
- `install-migrations.tsv` maps any moved route. The updater never deletes a file it did not install.
- Receipt schema 2 keeps its meaning. A neutral route needs a new receipt field, so it is a schema change
  and must follow the RFC process.

## Open questions

- Which client reads `spec-harness/commands/` without configuration?
- Do shadow copies in both locations drift, and who checks them?

## Test to add when accepted

A fresh install writes the neutral route, and the Claude route is a pointer that matches the neutral
file's bytes. A stale pointer fails `install-manifest-contract`.
