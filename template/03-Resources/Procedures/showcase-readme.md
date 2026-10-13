# Write a README for one project, with three skills

This is an example to copy and change. It shows three skills used in order on one task: write the README for one project. Use it as a worked case. Change the stages to fit your own project.

Read the `writing-skills` skill next if you want to write or change a skill of your own.

Each stage names what it reads, what it writes, and what you check before the next stage starts. Do not skip a check.

## 1. Pin down what the project is (`grill-me`)

Use this stage only when two or more files describe the project differently. If one file says what the project is and nothing contradicts it, skip `grill-me`: write the three answers yourself, with the date, and go to stage 2.

### Inputs

- The project folder, with its own README, its package or project file, and its file list.
- The selected project's [decisions](../../01-Projects/Selected-Project/Decisions.md) file, if it already holds rulings.

### Steps

1. Open the `grill-me` skill and give it the project folder.
2. Let it list each place where the files disagree, with a file and a line for each.
3. Answer its questions one at a time. Each answer must say what the project is, who it is for, and the one job it does.
4. Write each answer into the decisions file, with the date.

### Outputs

A short set of dated answers in the decisions file.

### Human check

In one sentence each, say what the project is, who it is for, and what it does not do. A second reader must give the same three answers.

## 2. Draft the README (`readme-generator`)

### Inputs

- The dated answers from stage 1.
- The project's source: its manifest, its file list, and its real commands.

### Steps

1. Open the `readme-generator` skill and give it the answers from stage 1.
2. Let it check each command and each name against the source. It must not invent a name.
3. Let it write the draft in this order: summary, quickstart, what it does, install, usage, configuration, license.

### Outputs

A draft `README.md` in the project folder. Mark it as a draft.

### Human check

Run each quickstart command in an empty folder. Each one must work, and its output must match what the README says. Search the source for every name in the README. Each name must exist.

## 3. Remove machine-sounding writing (`humanizer`)

### Inputs

- The draft README from stage 2.

### Steps

1. Open the `humanizer` skill and give it the draft.
2. Let it list each pattern it finds, with the sentence that has it.
3. Accept each edit only if the meaning stays the same.
4. Leave code blocks, commands, file names and links exactly as they were.

### Outputs

The final `README.md`, with the prose edited and the commands unchanged.

### Human check

Compare the code blocks, the commands and the links with the draft from stage 2. They must be identical. Read each section once. The meaning of each section must match the answers from stage 1.

## When to stop

- Stop at stage 1 if you cannot write a one-sentence answer for what the project is. A README cannot fix a project that has no clear purpose.
- Stop at stage 2 if a quickstart command fails. Fix the command or the setup step, then check again.
- Stop at stage 3 if an edit changes a command, a name or a link. Undo that edit.

## Inputs, outputs and the record

- Keep the dated answers from stage 1. They are the record of why the README says what it says.
- Keep the draft from stage 2 until the final README passes its check.
