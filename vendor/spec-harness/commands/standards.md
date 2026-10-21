# Method: standards and compliance

Use this during initialisation, and in planning when a ticket touches accessibility, personal data,
payments, security or a regulated market. It finds which named standards and laws the project has,
must meet or plans to meet, records the owner's commitment, and turns each commitment into rules.

This method is usable before a synthesis receipt or feature goal exists. It records commitments and
rules; it never certifies compliance. Whether a law applies, and whether the project meets it, is a
decision for the owner and their legal or compliance advisers.

## 1. Look for signals

Read before asking. Record each signal with the file and line where it was seen.

- Markets and users: store listings, locales and translations, currency and country lists, app
  config, privacy policy or terms in the repository, the memory bank (`.memory/00`, `01`, `10`).
- Data: authentication, payments, health, location, children, analytics and error reporting SDKs.
- Existing commitments: an accessibility statement, a security policy, audit or certificate files,
  CI checks for accessibility or security, decisions in `.memory/60-decisions.md`.

A signal is a reason to ask, never proof that a standard applies.

## 2. Ask the owner once

Ask one Grill Me question (`grill-me.md`) that lists the candidates from the catalogue below that the
signals point to, plus "other". For each, the owner answers one status:

- `in place`: the company already meets it or holds the certificate;
- `required`: it must be met (law, contract, customer), with the date if one is known;
- `planned`: the company intends to meet it, with a target date;
- `no`: not applicable. Record nothing for it.

When the owner is not available, record the candidates as an open question in `.memory/40-active.md`
and write no commitment.

## 3. Record each commitment

Write one line per commitment under `## Standards and compliance` in `.memory/10-product.md`:

```text
- **STD-01** The app meets the European Accessibility Act through EN 301 549. (source: product owner, 2026-10-21, status: required)
```

The full official name goes in the sentence. A business-layer `STD-` commitment outranks decisions,
project, tool and baseline rules (`rules.md`, Rule layers).

## 4. Turn the commitment into rules

- When a standard pack exists in `.claude/spec-harness/rule-packs/` (source checkout:
  `templates/rule-packs/standard-*.md`), copy it to `ai_rules/rules/standard-<name>.md` as `rules.md`
  describes and add `<!-- commitment: STD-<n> -->`. First check the standard's current version against
  its official source; when it has moved, say so and keep the module PENDING until the pack is updated.
- When no pack exists, write `ai_rules/rules/standard-<name>.md` with `<!-- rule-layer: standard -->`,
  the commitment marker, and rules from the official text, each with its URL and `checked YYYY-MM-DD`.
  When the text is paywalled (most ISO standards), cite the clause titles the owner's own documents
  use and keep the module PENDING until the owner or their adviser reviews it.
- Use only generic queries (the standard's name, version, topic). Never send project code, names or data.
- Confirm a compliance fact against at least one independent source before writing it, and say which.

## Catalogue: names to ask about

This lists names, not claims that they apply. Check the current version of any standard before use.

| Standard or law | Covers | Ask when | Pack |
|---|---|---|---|
| European Accessibility Act, Directive (EU) 2019/882, with harmonised standard EN 301 549 | Accessibility of consumer products and services in the EU, including apps | The app is offered to consumers in the EU | `standard-eu-accessibility` |
| WCAG 2.2 (W3C) | Web and app content accessibility | Any user-facing app; `baseline-accessibility` already adopts part of it | baseline |
| OWASP MASVS | Mobile app security and privacy controls | Any mobile app | `standard-owasp-masvs` |
| GDPR, Regulation (EU) 2016/679 | Personal data of people in the EU | The app processes personal data of people in the EU | none yet |
| ISO/IEC 27001 | Information security management system | The company holds or seeks the certificate, or customers ask for it | none yet |
| ISO/IEC 27701 | Privacy information management, an extension of ISO/IEC 27001 | The company holds or seeks it | none yet |
| SOC 2 (AICPA) | Security, availability and confidentiality controls of a service | Business customers in the United States ask for a report | none yet |
| PCI DSS | Payment card data | The app or backend stores, processes or transmits card data | none yet |
| HIPAA | Health information in the United States | The app handles protected health information for US entities | none yet |
| IEC 62304 | Software life cycle for medical device software | The software is, or is part of, a medical device | none yet |

## Output

The `STD-` lines in `.memory/10-product.md`, one `standard-<name>.md` module per commitment, and in
the init report: each signal, each candidate asked about, the owner's answers, and every module still
PENDING with the reason. The readiness check (schema 4) refuses READY when a commitment has no status
or no module, or a standard module names a commitment that does not exist.
