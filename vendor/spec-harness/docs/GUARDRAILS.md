# Guardrails — current procedures and their limits

> This page maps the bundled SDD procedures for checking work and preparing a delivery. Markdown
> describes a process; it does not enforce file or provider permissions, block tool calls, or prove a
> check ran.

## Layer 1 — Project rules and reviewed learning

Project `AGENTS.md`, `RULES.md`, and the shipped constitution scaffold describe expected constraints.
The [`constitution template`](../templates/constitution.md) says a release action needs an applicable
check configured for that project and explicit authorization. The template's presence alone does not
install a check or enforce that rule.

The [`learn` procedure](../commands/learn.md) preserves raw feedback, proposes a cause and owner,
classifies it, and waits for the project's existing human or reviewer authority. Canonical policy
changes happen only after approval; a FAIL or BROKEN report does not automatically become a rule.

## Layer 2 — Goal and workflow evidence

- [`verify`](../commands/verify.md) uses a separate context to check the accepted feature's own
goal against its named evidence. It reports `RESULT: PASS|FAIL` per the criteria; stale inputs or
unavailable tools remain PENDING. The shell invocation is a manual PENDING handoff, not a verifier
run.
- [`tester`](../commands/tester.md) runs configured workflows that have a runnable `how_to_run`,
then tests their stated invariants in a separate context. Its report covers those observed runs and
checks; it does not certify every application path. Findings can be captured and classified through
`learn`, whose approval step controls whether canonical policy changes.

## Layer 3 — Delivery authority and connected actions

[`ship`](../commands/ship.md) reads the feature packet, source revision, and gate records. Fresh
tester, verifier, and reviewer results must refer to the same current inputs before delivery is
eligible for a decision. `ship` does not authorize or perform a commit, push, merge, deployment, or
publication. Each effect needs explicit authority at its action boundary; apply project secret,
protected-path, and release checks where they exist.

[`MCP-SERVERS.md`](./MCP-SERVERS.md) is a design inventory, not proof that a server is installed,
connected, or authorized. This source package does not enforce MCP permissions or gate tool calls.

## Historical examples

`release-preflight`, `eas-env-sync`, and `backend-secrets-lock` are historical, non-bundled release
guardrail patterns. Their directories and scripts are absent from this distribution. They do not run
or block actions here, and this guide provides no `check.sh` invocation for them.

## The one-liner

Project rules describe expectations; `verify` and `tester` report evidence for their configured
checks; `learn` sends feedback through review; `ship` records delivery gates and authority. The
client and provider still control actual access to connected tools.
