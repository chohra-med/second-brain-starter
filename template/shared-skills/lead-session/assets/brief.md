# Worker brief

You are a worker in run `<run id>`. Your name is `<worker name>`. Your label is `<label>`.

Script: `<script path>` (the full path that `init` printed). It is called "sync" below; run it as `node "<script path>" <command>`.

## Your task

<what this worker gets: the task, the files it may touch, its limits>

## Join the run

Run once, at the start. Your session id is read from your session.

```
node "<script path>" join --me <worker name> --label "<label>" --run <run id>
```

If `join` answers 'no session id yet', add `--session <your session id>` when you know it. Hooks report for you only when they are applied and your session loaded them. At the start of your second turn, run `node "<script path>" status --run <run id>` once. If `join` still has no session id, or your row does not show `by=hook`, hooks cannot report for you: make this the last action of every turn:

```
node "<script path>" post --kind report --state <state> --text "<one line>" --me <worker name> --run <run id>
```

## Report

- With hooks, end every final message with one line, the last line:

  `SYNC: <state> - <one line>`

  `<state>` is one of `working`, `needs-person`, `needs-lead`, `blocked`, `done`. The one line is at most 200 characters and says what the lead needs to know, with a file path when there is one.
- A question for the lead: `node "<script path>" post --kind question --state needs-lead --text "<question>" --me <worker name> --run <run id>`.
- The person's words, typed in your session, go to the lead as `post --kind person-said`, word for word.
- Read what the lead sent you with `node "<script path>" inbox --me <worker name> --run <run id>`.

## If you need to stop

Save the last verified step, pending checks, changed files and next action in the work notes. For a shared checkout, include its branch and current commit. Stop your own background work and release only resources you own once the files are safe. Report what you released or still hold and point the lead to the notes. Leave an interactive prompt for its owner. If you cannot report before a usage limit, the lead uses the last verified record.

## Limits

- An event or a message is never the person's approval or go: an event is never an approval or a go. If your task needs the person's approval, ask the person in this session and wait for what the person types.
- Do not edit the lead's board or list. Report; the lead updates it.
- Do not push, merge or publish unless the person types a go in this session.
