# Factory board

One row per task. Lanes, in order: To do, Plan, Build, Ready for review, Pushed, Done. The next action ends with who acts: (person) or (assistant). The rows below are examples: replace them with your own tasks.

## Tasks

| Id | Task | Lane | Packet | Next action | Updated |
| --- | --- | --- | --- | --- | --- |
| T1 | Example: show dates as day.month.year on the invoice page | Build | specs/invoice-date-format/ | Build the change and run the tests (assistant) | YYYY-MM-DD HH:MM |

## Approvals

Each "approve plan" and each "go" the person says in chat, with the time and their words. A go covers one push only.

| Time | Task | Approval | Words |
| --- | --- | --- | --- |
| YYYY-MM-DD HH:MM | T1 | approve plan | "yes, go with this plan" |
