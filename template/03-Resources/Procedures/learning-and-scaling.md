# Learning and scaling

Learning is a recorded correction, not a claim that an AI silently improved itself.

1. Capture one confirmed miss and its cause, or one standing rule the person gives.
2. Put the rule where it belongs: facts for changing values, decisions for choices, procedures for repeatable work, and `00-Meta/Working-Agreement.md` for a rule that holds in every project. Never keep a rule only in one assistant's private memory; that memory may hold at most a one-line pointer to the owner, so every agent tool reads the same rule.
3. In a fresh session, ask for the rule before work begins.
4. Mark it verified only when that session follows it.

As the vault grows, keep one owner per fact, archive finished projects, and load procedures only when the task needs them. Add automation after the manual path works and you can explain its failure mode.

## Inputs

- Working (this run): one confirmed miss and its cause, or one standing rule the person gives.
- Reference (every run): the owner the rule belongs in, which is the selected project's [facts](../../01-Projects/Selected-Project/FACTS.md), its [decisions](../../01-Projects/Selected-Project/Decisions.md), one procedure in this folder, or the [working agreement](../../00-Meta/Working-Agreement.md) for a rule that holds in every project.

## Outputs

- The rule, written once in its owner.
- Its verified mark, added only after step 4.

## Human check

Start a fresh session, ask for the rule before work begins, and watch whether the session follows it.
