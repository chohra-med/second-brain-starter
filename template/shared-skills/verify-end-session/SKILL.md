---
name: verify-end-session
description: The /verify-end-session command. Before closing a chat, confirm that nothing it asked for is lost. Lists every ask, checks each once against the real files, ranks what is left, and ends with SAFE TO CLOSE or DO NOT CLOSE. Use when the person types /verify-end-session, or asks whether it is safe to close this chat.
---

# Verify end session

Use this before closing a chat, when the person wants to know whether anything they asked for in it would be lost. The person can also invoke it as `/verify-end-session dry`, which writes nothing.

Do not use this when:

- The session needs its records written. Use `end-session`.
- The person wants a note to continue in a fresh chat. Use `next-session`.
- The person wants context loaded. Use `context`.

Read and follow `03-Resources/Procedures/verify-end-session.md`. That procedure owns the steps, the checks, the one write it may make and the verdict. This skill only names when to use it.
