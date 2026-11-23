# Decision log

One entry per decision, newest at the bottom. The master writes it the moment you decide, then sends it to every live tab it touches
(`herdr agent prompt <pane> "DECISION UPDATE <date>: <your words>. Do not ask this again."`).
Every new task file starts with the entries whose `touches` names that task, under `DECISIONS ALREADY MADE for this task`.

Entry shape:

```
## <date> · <short title>
- touches: <task names this decision affects>
- Your words: "<verbatim>"
- Status: WRITTEN in <file that now carries it> | OPEN
```

## 2026-01-12 · Launch post is about the free version only
- touches: Launch post; Pricing page copy
- Your words: "The launch post only talks about the free version. Pricing waits."
- Status: WRITTEN in tasks/launch-post-2026-01-12.md
