# Pipeline

Status: PENDING. Fill this in once, then link to it. Do not copy it into other files.

**Home:** the one place that describes how the automated flow runs, step by step.

## What goes here

- The steps in order: trigger, each stage, output. One line per step with the tool or script that does it.
- Inputs and outputs of each step, and where they are stored.
- Schedules, retry rules and what happens on failure.
- What a person must approve before a step runs, and who.
- How to run one step by hand, and how to tell it worked.

## One home per fact

- Credentials and keys are never written here. Name where they are kept, not their values.
- Why a step exists or was chosen goes in `.memory/60-decisions.md`.
- Commands and tool versions live in `.memory/30-tech.md`; link to it.
- The current run state lives in `.memory/40-active.md`, not in this file.
