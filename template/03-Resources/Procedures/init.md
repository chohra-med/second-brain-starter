# Init: five questions

Use this for a short setup. The assistant asks five questions, one at a time. Each answer is saved as soon as you approve it. You can stop at any point. A stop leaves a valid workspace.

An answer you skip or cannot give is saved as the word `Unknown`. That tells a later run to ask again.

## Rules for the assistant

- Ask one question. Wait for the answer. Show the exact text you will save. Write only after the user says yes. Each answer needs its own yes.
- If the user replies `skip`, save `Unknown` for that answer and move to the next question.
- If the user replies `stop`, end the questions at once. Say what is saved and which questions remain. Then give the closing prompt.
- A later run asks only the questions whose saved answer is still `Unknown`.
- Never ask for a password, a key or a token.
- Never guess. Never invent a fact, a deadline or a preference.
- Save the kind of boundary in question 5, never a client's name or a secret.

## The five questions

1. What do you do, and is this workspace for your job, for personal projects, or both?
   - Saved to: `00-Meta/Profile.md`, section `## Role`.
   - Example answer: `I run client reporting for a small team. This is for my job.`

2. Which one to three projects or areas of work should this hold first? One line each.
   - Saved to: one folder under `01-Projects/` for each project. Each line goes to that folder's `FACTS.md`, row Goal.
   - The first project fills the seeded `Selected-Project` folder. Its name does not change.
   - Each further project is a copy of `03-Resources/_templates/project/`, with its own name, made only after the user says yes to that folder.
   - Example answer: `Monthly report for the operations team.`

3. For the first one: what does done look like in the next two weeks?
   - Saved to: the first project's `roadmap.md`, its first row. Put the evidence in Evidence for done and one small step in Next action.
   - Example answer: `The report goes to the team lead by Friday, with the three charts checked.`

4. How do you want answers: length, language, how much explanation?
   - Saved to: `00-Meta/Profile.md`, section `## How I want answers`.
   - Example answer: `Short. English. One reason for each recommendation.`

5. What must the assistant never touch or share: paths, systems, client work, anything private?
   - Saved to: `00-Meta/Profile.md`, section `## Never touch`.
   - Example answer: `The finance folder. Client files, but not client names.`

`Stack` is not asked here. It stays `Unknown` in `00-Meta/Profile.md` until the first-use procedure asks it.

## If you stop after question 2

Say this to the user, in these words:

- Saved: your answer to question 1 in `00-Meta/Profile.md`, section Role. Your first project's line is in the Goal row of `01-Projects/Selected-Project/FACTS.md`. Each further project you named has its own folder under `01-Projects/`, with the line in its Goal row.
- Not saved yet: the done-definition for the first project, how you want answers, and what the assistant must never touch.
- Still `Unknown`: the Profile sections for answers and boundaries, and the roadmap of the first project.
- Next time: the assistant asks question 3 first, then 4 and 5.

The workspace is valid at this point. Nothing is missing that setup needs.

## Closing prompt

When the questions end, whether after question 5 or after a `stop`, give the closing prompt. Tell the user to ask: **What should I focus on this week?**

Answer that question this way:

- At most three points. Each names a saved project and its next action.
- Then the one thing to start with.
- Then what is still `Unknown`.
- A point with no saved evidence is not made.
