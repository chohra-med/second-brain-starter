---
name: end-session
description: End-of-session closeout that writes instead of only reporting: workspace write-back, learning capture, a reconciled gap list, a ranked queue of next actions and one closing recap. Use at the end of a real work session. It is bounded by default, and the full audited mode is opt-in.
---

# End session

Use this at the end of a real work session, when the session changed files, decisions or project state. The person can also invoke it as `/end-session`, or as `/end-session full` for the audited mode.

Do not use this when:

- The session was only a question, with no work to record.
- The person wants one roadmap item matched to its evidence. Use `second-brain-close`.
- The person wants context loaded, not a closeout. Use `context-modes`.

Read and follow `03-Resources/Procedures/end-session.md`. That procedure owns the phases, their order, the checks and the closing recap. This skill only names when to use it.
