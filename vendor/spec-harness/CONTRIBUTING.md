# Contributing

Thank you for helping. Please keep changes small and tested.

## Run the tests

```sh
npm test
```

The suite is plain Bash and Python. It needs Bash, git, npm, tar, Python 3.11 or later, and a sha256
tool (`shasum` or `sha256sum`). It does not need `rg`; use `grep`. Run it with `TMPDIR` unset as well:

```sh
env -u TMPDIR npm test
```

A `SKIP` line in a test log is not a pass. CI sets `SPEC_HARNESS_STRICT_SKIP=1`, so any skip fails there.

## Generated files

Do not edit generated output by hand.

- `skills/` comes from `bin/sh-make-skills.sh`. Run it after changing a command or agent it describes.
- `install-manifest.json` comes from `tests/tools/update-install-manifest.sh`. Run it after changing any
  file the manifest lists, then run `bash tests/install-manifest-contract.sh`.

## Writing

- Do not use em dashes in new text. Follow the punctuation already in the file you are editing.
- Do not add project data. No company or app names, personal paths, tickets, or records from a real
  project belong in any file. Use synthetic examples.

## Behaviour changes

Every new behaviour needs a test that fails without the change and passes with it. Say in the pull
request which test was red first.

## Proposals

Changes that alter a route, a receipt schema or a status word start as an RFC in `docs/rfcs/`.
