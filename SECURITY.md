# Security review

The public package is intended to contain only the files in `FILE-ALLOWLIST.txt`. The source and candidate archive scanner enumerates every regular package member, compares it to that allowlist, and reports relative paths plus rule identifiers. It never prints matched file content or credential values.

The scanner rejects unallowlisted files, symlink and non-regular members, private-path markers, authorization material, token-shaped JWTs, private keys, credential assignments, personal absolute paths, and encoded versions of those markers. It scans every shipped regular-file byte, including tests and fixtures, and scans declared before/after diff bytes when they are supplied by the build or review tooling. One harmless test assertion is removed only by its exact path and exact synthetic text before matching; it is not a general test-directory exception. The extracted consumer candidate is scanned as its own tree.

Run the scanner from a trusted local checkout or extracted candidate. It is a source and archive hygiene check, not a claim that a filename or scanner can secure an AI client, erase data from a copied workspace, or prove an external service's behavior.

If the scanner reports a finding, stop distribution, remove the material from the candidate source, and re-run the complete build and review gates. Do not paste a flagged value into an issue, commit message, pull request, or support channel. Rotate a real credential through its owner before treating a cleaned copy as safe.
