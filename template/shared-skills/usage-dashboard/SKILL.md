---
name: usage-dashboard
description: Summarise how much Claude Code was used on this machine, from its transcript files. It prints tokens per session, an estimated cost at list prices, peak context, and how often each skill and slash command was used. Use when a user asks what Claude Code sessions used, what they would cost at list prices, which skills or commands get used, or how full the context got. It only reads and prints numbers, session ids, project folder names, disk paths and names of a fixed shape.
---

# Usage dashboard

This skill runs one local script, `usage-dashboard.mjs`, that reads the Claude Code transcript files on this machine and prints a text report. The starter's installer never runs it. You, or your AI client, run it. It needs Node.js 22 or newer and nothing else.

## Do not use this when

- You want the amount on a bill or the usage left in a subscription. The script prints an estimate at list prices, not a bill and not an allowance.
- You want to read what was said in a session. The script never prints prompts, answers, tool input, tool results or titles.
- The transcripts are on another machine. The script reads only this machine's folder.
- You want a chart, a web page or a background job. The script has none of these.

## What it reads

- The Claude Code transcript files, one `*.jsonl` file per session, in the `.claude/projects` folder of your home folder. Each project has its own folder inside it. Sub-agent transcripts are in a `subagents` folder inside the session folder.
- The price file beside the script, `usage-prices.json`, or the file you name with `--prices`.
- The default projects folder is outside the workspace, and a folder you name with `--projects-dir` may not be. The script reads nothing else.

It never follows a symbolic link below the projects folder. A linked project folder, session folder, `subagents` folder or transcript file is skipped and counted in the header as a skipped link. The projects folder you name is read even when it is itself a link, because you named it.

## Steps

1. Check that Node.js is version 22 or newer: `node --version`. Check: the version printed is 22 or higher.
2. From the workspace root, run the copy your client reads. Use the path that matches your client:

   ```sh
   node .claude/skills/usage-dashboard/usage-dashboard.mjs
   node .agents/skills/usage-dashboard/usage-dashboard.mjs
   ```

   The two copies are the same file. Either one works. Check: the report starts with a line that begins `Usage dashboard:`.

3. Add flags only when you need them:

   | Flag | What it does |
   |---|---|
   | `--projects-dir DIR` | Read this folder instead of `.claude/projects` in your home folder. |
   | `--prices FILE` | Use this price file instead of the one beside the script. Without any price file the report shows tokens only. |
   | `--since DATE` | Keep sessions that started on or after `DATE`, in the form `YYYY-MM-DD`, UTC. |
   | `--until DATE` | Keep sessions that started on or before `DATE`, both ends included. |
   | `--project TEXT` | Keep project folders whose name contains `TEXT`. |
   | `--top N` | Show `N` sessions in the table, default 20. `0` shows all. Totals always cover every kept session. |
   | `--json` | Print one JSON object instead of text. It carries the same numbers and an `estimateNote` field when it shows money. |
   | `--help` | Print the options and exit. |

4. Read the report from the top. Check: the header line gives the folder read, the number of files read and the number of calls counted. A count of zero files, or zero calls, means the folder was empty, the path is wrong, or the filters kept nothing. Fix the path before you read any number.
5. If the report has a `Bad input` section, go to that section before you trust the totals. Check: each line names a file and a line number, and the reason is one of a fixed set of words. The totals still show every line that could be read.

## What it prints

- Counts, token sums, estimated cost, dates and the share of tokens from sub-agents.
- Session ids (shortened in the table), and project folder names. Claude Code builds a project folder name from the folder path, so the name can show a client or project name.
- The disk paths of the projects folder that was read, of the price file that was used, and of any file with bad input.
- Skill, command and model names, only when each name has a fixed shape. Any other name shows as `(unreadable name)`.
- Nothing from inside a transcript message: no prompt, answer, thinking, tool input, tool result or session title.

## What the sections mean

- **Header.** The folder read, the price file used (or `none (tokens only)`), the number of files read, the date range of the sessions kept, the number of calls counted and the number of skipped links.
- **Totals.** Sessions kept, calls counted, tokens by kind, the estimated cost, the number of calls that had no price, and the share of tokens that came from sub-agents.
- **By model.** One row per model id, with its calls, tokens and estimated cost. A model that is not in the price file shows `no price`. Its tokens still count in the totals.
- **Sessions.** One row per session, highest estimated cost first. The session id is shortened to eight characters. Peak context is the largest context of any one model call in the main session, not the sub-agents. Sub-agent share is a share of tokens.
- **Skills.** `Uses` counts how often the skill tool was called for that skill. `Attributed` counts the model calls that were written while that skill was active. These two numbers come from different fields, so they are shown side by side and not added together.
- **Commands.** How often each slash command was typed, and in how many sessions. Built-in commands such as `/model` appear here with your own commands. The report does not tell them apart.
- **Bad input.** Each line that could not be read, as `path:line reason`. A line `0` means the whole file or folder could not be read.
- **Estimate sentence.** The last line of a report that shows money says that the figures are estimates at list prices and not a bill.

## About the money

- The estimate is the number of tokens multiplied by the list price of the model, for the pay-per-token API. It is not what you were charged, and it is not what your subscription allows.
- The prices live in `usage-prices.json`, beside the script. You own this file. Edit a price only when you have a dated source for it.
- The file carries one `asOf` date and one `source` line for all its rows. When you change a price, change both lines to match the source you used.
- A model with no row in the file has no price. A total that has only unpriced calls shows `no price`, never a zero amount.

## Exit codes

- **0.** The run finished and every transcript line was read.
- **1.** The run finished, but a transcript had bad input: a line that is not valid JSON, except a last line with no line ending, which the script skips as a session still being written and does not report, a token count that is not a whole number of zero or more (or is `null`), or a file or folder that could not be read. The report lists each one.
- **2.** Wrong use. Nothing is printed on standard output. One line on standard error says what is wrong. The cases are: an unknown option; a flag given twice (including `--json`); a flag with no value, an empty value, or a value that starts with two dashes; a date that is not a real `YYYY-MM-DD` date; `--since` later than `--until`; a `--top` that is not a whole number of zero or more; a projects folder that does not exist, is not a folder, or cannot be listed; a price file that cannot be read, is not JSON, has no `models` object, has a model row that is not an object, or has a price that is missing, not a number, or negative.

## What it never does

- It opens no network connection.
- It starts no other program.
- It writes no file. Nothing is saved, cached or logged.
- It prints no prompt, answer, thinking, tool input, tool result or session title.
- It prints a skill, command or model name only when the name has a fixed shape, such as a skill name or a model id. Any other name shows as `(unreadable name)`. It also prints session ids, project folder names and disk paths, as they are on disk.

## Warning for AI clients

When an AI client runs this script, the printed numbers, session ids and project folder names become part of that client's tool output. That output goes to the client's model provider under the client's own settings. The script does not decide that. Run it yourself, or confirm your client's settings first, if you do not want those figures sent.
