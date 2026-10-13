# Complete init: the full set of questions

Use this when you want a ready second brain: records that already hold your work, your rules and your rhythm. It is longer than init. It is split into seven sections. You can stop after any answer or any section, and continue later.

## Before the first question

Read what init saved, if it ran. Read `00-Meta/Profile.md` and each `01-Projects/*/FACTS.md`. Never ask again a question that already has a real answer. Ask only the questions whose saved answer is `Unknown` or missing.

Some questions fit an employee, a freelancer and a founder alike. Answer with the words that fit you. Nothing here assumes that you own a company.

## Rules for the assistant

- Ask one question. Wait for the answer. Show the exact text you will save. Write only after the user says yes. Each answer needs its own yes.
- `skip` saves `Unknown` for that answer. `stop` ends the questions at once.
- After a stop, say which section is next. The next run starts at that section.
- Name tools and places only. Never ask for, and never write, a password, a key, a token, a login or a link that carries a secret.
- Never guess. Never invent a deadline, a person, a fact or a preference.
- Record the kind of boundary, never a client's name or a secret.

## Section 1: Who you are and how you work

1. How do you work best: how many things at once, and how often you want to check in?
   - Saved to: `00-Meta/Profile.md`, section `## How I want answers`, one added line.
   - Example answer: `One main task at a time. A short check-in on Monday.`

2. Which tools do you use every day?
   - Saved to: `00-Meta/Profile.md`, section `## Stack`. Names only.
   - Example answer: `The shared drive, the team chat and a spreadsheet for the budget.`

## Section 2: Your job or business, in one paragraph

3. In one paragraph: what do you do, for whom, and what does a good week look like?
   - Saved to: `00-Meta/Profile.md`, section `## Role`. Replace the `Unknown` line with the paragraph.
   - Example answer: `I coordinate the reports for three regional managers. A good week is one report sent on time and no surprises.`

4. Who do you answer to: a manager, a client, a board, or nobody?
   - Saved to: `02-Areas/Areas.md`, one row for your main area. Put the answer in Current note.
   - Example answer: `My operations director.`

5. Who depends on your work, and what do they need from you?
   - Saved to: the same row in `02-Areas/Areas.md`, in Standard to maintain.
   - Example answer: `The three managers need the report by Monday noon.`

## Section 3: Each project

Repeat these five questions for each project, one project at a time. Use the project folder that init or quick start made. If there is none, ask for the project's name, then copy `03-Resources/_templates/project/` into `01-Projects/` only after the user says yes.

6. What is the goal, in one sentence?
   - Saved to: that project's `FACTS.md`, row Goal.
   - Example answer: `Send the quarterly client report by the tenth.`

7. Who is on it, and who decides?
   - Saved to: that project's `FACTS.md`, row Scope, and the Owner column of its `roadmap.md`.
   - Example answer: `Dana prepares the data. I decide the final numbers.`

8. Is there a deadline? If there is none, say none.
   - Saved to: that project's `FACTS.md`, row Constraint.
   - Example answer: `The tenth of each quarter, as the contract says.`

9. What does done look like? Name the proof a reviewer would check.
   - Saved to: that project's `roadmap.md`, Evidence for done.
   - Example answer: `The client confirms receipt, and the totals match the finance export.`

10. Where do its files live? A folder or system name is enough.
    - Saved to: that project's `FACTS.md`, row Source of truth.
    - Example answer: `The shared drive, folder Q3 reports.`

## Section 4: Recurring work and its rhythm

11. What do you do every week or every month without a new request? Name each one.
    - Saved to: `02-Areas/Areas.md`, one row for each recurring area.
    - Example answer: `The weekly status report, the monthly budget check.`

12. When does each one happen? Give the day or the date.
    - Saved to: the Standard to maintain column of the same row.
    - Example answer: `Status report every Monday. Budget check on the last Friday.`

## Section 5: Tools and places where your information lives

13. Which tools and shared places hold your work? Names only.
    - Saved to: `00-Meta/Profile.md`, section `## Stack`. Add the names to the list from question 2.
    - Example answer: `The shared drive, the ticket tracker and the team chat.`

## Section 6: Rules and red lines

14. What is confidential, and what must never leave your machine?
    - Saved to: `00-Meta/Profile.md`, section `## Never touch`.
    - Example answer: `Payroll files. Anything marked confidential by a client.`

15. What needs a human yes before the assistant acts?
    - Saved to: `00-Meta/Decisions.md`, one row for each rule that affects more than one project. A rule for one project goes to that project's `Decisions.md`.
    - Example answer: `Any message sent to a client needs my yes first.`

## Section 7: How you review progress

16. How do you want to review progress, and how often: a weekly check, a monthly check, or only when you ask?
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
