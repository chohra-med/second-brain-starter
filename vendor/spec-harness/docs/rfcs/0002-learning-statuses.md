# RFC 0002: learning statuses

Status: proposal. Not implemented in 0.4.0.

## Problem

The learning loop records feedback, but it has no status that says whether a correction was applied
or verified in a later run. A correction can therefore look finished when it was never checked.

## Proposal

Add two statuses to each learning entry:

- `APPLIED`: the correction was written into the rule, skill or method it targets.
- `VERIFIED`: a fresh run, with the correction present, passed the check that the correction was meant
  to satisfy.

A learning entry moves `PROPOSED` → `APPLIED` → `VERIFIED`. It never moves backwards silently.

## Compatibility

- Existing entries keep their current status words. They read as `PROPOSED` until someone reviews them.
- The status is a plain word in the entry, so an older reader sees an unknown word, not a crash. The
  records lint in `verify --records` should accept the new words once this is accepted.

## Test to add when accepted

A fixture with one entry in each status passes the records lint. An entry marked `VERIFIED` without a
passing check reference fails it.
