# Complete init: the full set of questions

Use this when you want a ready second brain: records that already hold your work, your rules and your rhythm. It is longer than init. It is split into six sections. You can stop after any answer or any section, and continue later.

## Before the first question

Read what init saved, if it ran. Read `00-Meta/Profile.md` and each `01-Projects/*/FACTS.md`. Never ask again a question that already has a real answer. Ask only the questions whose saved answer is `Unknown` or missing.

`init.md` asks Role, How I want answers and Never touch. This procedure does not ask them again. It asks Stack, and the questions about your work, your projects and your rules.

Some questions fit an employee, a freelancer and a founder alike. Answer with the words that fit you. Nothing here assumes that you own a company.

## Rules for the assistant

- Ask one question. Wait for the answer. Show the exact text you will save. Write only after the user says yes. Each answer needs its own yes.
- `skip` saves `Unknown` for that answer and needs no yes. List the skipped question by its number and text under `## Unknown` in `00-Meta/Profile.md`. `stop` ends the questions at once.
- After a stop, say which section is next. The next run starts at that section.
- Name tools and places only. Never ask for, and never write, a password, a key, a token, a login or a link that carries a secret.
- Never guess. Never invent a deadline, a person, a fact or a preference.
- Record the kind of boundary, never a client's name or a secret.

## Section 1: Your tools

1. Which tools and shared places do you use every day? Names only.
   - Saved to: `00-Meta/Profile.md`, section `## Stack`.
   - Example answer: `The shared drive, the team chat, the ticket tracker and a spreadsheet for the budget.`

## Section 2: Who you answer to and who depends on you

2. Who do you answer to: a manager, a client, a board, or nobody?
   - Saved to: `02-Areas/Areas.md`, one row for your main area. Put the answer in Current note.
   - Example answer: `My operations director.`

3. Who depends on your work, and what do they need from you?
   - Saved to: the same row in `02-Areas/Areas.md`, in Standard to maintain.
   - Example answer: `The three managers need the report by Monday noon.`

## Section 3: Each project

Repeat these five questions for each project, one project at a time. Use the project folder that init or quick start made. If there is none, ask for the project's name, then copy `03-Resources/_templates/project/` into `01-Projects/` only after the user says yes.

4. What is the goal, in one sentence?
   - Saved to: that project's `FACTS.md`, row Goal.
   - Example answer: `Send the quarterly client report by the tenth.`

5. Who is on it?
   - Saved to: that project's `FACTS.md`, row Scope, and the Owner column of its `roadmap.md`.
   - Optional follow-up, part of question 5: who decides. Ask it only if the answer does not say. Save it in the same place.
   - Example answer: `Dana prepares the data. I decide the final numbers.`

6. Is there a deadline? If there is none, say none.
   - Saved to: that project's `FACTS.md`, row Constraint.
   - Example answer: `The tenth of each quarter, as the contract says.`

7. What does done look like? Name the proof a reviewer would check.
   - Saved to: that project's `roadmap.md`, Evidence for done.
   - Example answer: `The client confirms receipt, and the totals match the finance export.`

8. Where do its files live? A folder or system name is enough.
   - Saved to: that project's `FACTS.md`, row Source of truth.
   - Example answer: `The shared drive, folder Q3 reports.`

## Section 4: Recurring work and its rhythm

9. What do you do every week or every month without a new request? Name each one.
   - Saved to: `02-Areas/Areas.md`, one row for each recurring area.
   - Example answer: `The weekly status report, the monthly budget check.`

10. When does each one happen? Give the day or the date.
    - Saved to: the Standard to maintain column of the same row.
    - Example answer: `Status report every Monday. Budget check on the last Friday.`

## Section 5: Rules and red lines

11. What needs a human yes before the assistant acts?
    - Saved to: `00-Meta/Decisions.md`, one row for each rule that affects more than one project. A rule for one project goes to that project's `Decisions.md`.
    - Example answer: `Any message sent to a client needs my yes first.`

## Section 6: How you review progress

12. How do you want to review progress, and how often: a weekly check, a monthly check, or only when you ask?
    - Saved to: `00-Meta/Decisions.md`, one row, with the reason and the condition for a new review.
    - Example answer: `A short weekly review on Friday. Revisit it if the team size changes.`

## After each section

Show what the section saved, in one line per answer. Then list what is still `Unknown`. Ask whether to continue or stop. The next run starts at the first section that still has an `Unknown` answer.

## Closing prompt

When the last section ends, or after a stop that the user does not resume, give the closing prompt. Tell the user to ask: **What should I focus on this week?**

Answer that question this way:

- At most three points. Each names a saved project and its next action.
- Then the one thing to start with.
- Then what is still `Unknown`.
- A point with no saved evidence is not made.
