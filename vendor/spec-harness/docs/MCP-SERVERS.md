# MCP servers: a dated illustrative map

> This list was assembled in July 2026 as an illustration of possible pipeline categories. It is not
> a verified current inventory, integration promise, or install guide. Before use, verify each vendor
> capability, endpoint, authentication flow, version, and safety boundary against current official
> vendor documentation. The procedures and their limits are in [GUARDRAILS.md](./GUARDRAILS.md).

The examples below show kinds of tool connections that may appear along a path from *idea* to
*delivery*. Do not infer that a listed server is available, current, suitable, or authorized in a
particular project.

## The mental model: actuator vs guardrail

An MCP server can expose actions to a connected client. A server listing does not establish what the
client can do, which credentials it uses, or which checks run. Confirm the actual configuration and
authorization at the action boundary.

## Illustrative examples (verify before use)

| Stage | Example named in the July 2026 map | Illustrative operation | Detail to verify against current official documentation |
|---|---|---|---|
| **Source control** | GitHub | Repository, issue, and pull-request workflows | Availability, scope, and write permissions |
| **Backend deploy** | fly.io | Deployment and machine operations | Endpoint, authentication, and destructive-action controls |
| **Mobile build** | Expo / EAS | Build and workflow operations | Supported tools, account scope, and client configuration |
| **Backend-as-a-service** | Firebase | Firebase project operations | Credential scope and supported operations |
| **DB + auth** | Supabase | Database and auth operations | Project scope and write/delete boundaries |
| **Payments** | Stripe | Product and subscription operations | Permission scope and financial-action controls |
| **Web deploy** | Vercel | Deployment operations | Project scope and deployment permissions |
| **Work intake** | Linear / Jira / GitHub Issues | Ticket retrieval | Read/write scope and the actual endpoint |
| **Errors** | Sentry | Issue and trace retrieval | Read/write scope and organization access |
| **Design handoff** | Figma | Design-file retrieval | File scope, endpoint, and current client support |

## Before connecting a tool

Use current official vendor documentation to confirm the actual endpoint, authentication flow,
supported version, available actions, data access, and destructive-action controls. Treat a setup
example from another project as unverified until checked against that project's client and provider.

## Security — read this before you paste a token

- **Scope tokens to the minimum.** An MCP with prod write is a live foot-gun with a fast trigger.
- **Prefer read-only** for anything you're only inspecting (logs, revenue, issues).
- **Never paste credentials into a chat.** Use the vendor's current supported authentication flow and secure local configuration.
- **Check the action boundary.** Apply project-specific checks and obtain explicit authorization where
  required. A connected MCP does not grant permission to deploy, publish, or write to production.

## Where Spec Harness fits

`commands/ship.md` records delivery evidence and whether a delivery is eligible for a decision; it
does not authorize or perform a commit, push, merge, deployment, or publication. Apply the checks
configured for the project and obtain explicit authority at the action boundary. `release-preflight`,
`eas-env-sync`, and `backend-secrets-lock` are historical, non-bundled examples; they do not run or
gate actions in this source package. See [GUARDRAILS.md](./GUARDRAILS.md) for the current procedures
and their limits.

---

*Maintained as part of [Spec Harness](https://github.com/chohra-med/spec-harness-oss) by
[Malik Chohra](https://getwireai.com) · [Code Meet AI newsletter](https://codemeetai.substack.com).
Illustrative list assembled July 2026 — verify all vendor details against current official documentation before use.*
