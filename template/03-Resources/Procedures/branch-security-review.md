# Branch security review

## Inputs

Name the repository, exact base and head, and their diff. Read the selected repository's rules and relevant security and test evidence.

## Process

Use a native `/security-review` command when actually available. Otherwise use an available independent reviewer or the repository's human-review path, following its own independence requirements. Review changed trust boundaries, authentication and authorization, secrets and data exposure, untrusted input and command injection, dependency, install and configuration changes, and relevant missing tests. A folder scanner PASS never substitutes for source review.

## Outputs

Record exact base and head, actual method and reviewer, scope examined, findings, unresolved questions and verdict. If the required reviewer or independence is unavailable, preserve completed work and mark the review pending. Do not invent native execution or weaken repository rules.

## Human check

Check that the evidence identifies the reviewed base and head and that unresolved findings or pending review remain visible before delivery.
