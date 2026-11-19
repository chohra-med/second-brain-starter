---
name: writing-check
description: Checks and rewrites a text before it goes to people (a chat message, email, ticket comment, PR text, post or document) so it reads clear, short and in the person's own voice. It loads the brand file and the voice DNA, scores AI tells, voice match, clarity and length for the channel, checks each claim against its source, offers two rewrites, adds one diagram when the text explains a flow, flags keys, emails and phone numbers, and shows a local page with one Copy button per text. The person sends the text; this skill never sends. Use when the person asks to check, tighten, review or rewrite a message, comment, post or PR text before sending it. Not for writing a skill (use writing-skills), and not for removing AI tells alone (use humanizer).
metadata:
  scope: oss
---

# Writing check

This skill takes one text that goes to people, or the facts for it, and returns two checked versions in the person's voice on a local page. The person picks one, edits it if they like, and sends it themselves. The skill ships no script and contacts no address. It writes three things: the review page, the brand and voice files when the person first copies them, and the voice DNA after the person's yes.

## Do not use this when

- You are writing or editing a skill. Use `writing-skills`.
- You only want AI tells removed, with no channel or voice rules. Use `humanizer` directly.
- You want the text sent, posted or published for you. This skill never sends; the person does.
- You want a page or a screen reviewed. Use `design-check`.

## Your files

| File | What it holds | First use |
|---|---|---|
| `00-Meta/Brand.md` | Your default voice: words to use and to avoid, tone per audience, format rules. Its Visual part is for `design-check`. | Copy [the brand template](assets/Brand.md) there. |
| `01-Projects/<project>/Brand.md` | A project's own brand, when it has one. For that project it wins over `00-Meta/Brand.md`. | Copy the same template there. |
| `00-Meta/Voice-DNA.md` | 3 to 5 texts you wrote, and what they show about how you write. | Copy [the voice DNA template](assets/Voice-DNA.md) there, then paste your texts into its slots. |

Why there: the voice DNA describes you across projects, so it sits in `00-Meta/` beside `Profile.md` and `Word-Map.md`. A brand belongs to a project when the project has one, beside its `FACTS.md`; your own default lives in `00-Meta/`. The two templates ship inside this skill folder, the way `factory` ships its board, so an upgrade refreshes the templates and never touches your filled copies.

The voice DNA holds your own texts. Before you paste one, take out names, email addresses, phone numbers, keys and anything confidential. The privacy block in `.gitignore` lists this file and the `local/writing-check/` folders, so git does not track them; a copy of the workspace folder still holds them.

## Rules per channel

| Channel | Length | Format |
|---|---|---|
| Chat | Up to 60 words, 1 to 4 short lines | No headings. The ask comes first, one ask per message. Bullets only for 3 or more items. |
| Email | Up to 150 words in the body | A subject line that names the ask. The ask in the first two lines. One closing line. |
| Ticket comment | Up to 120 words | The state or the answer first. Short bullets, one fact each. Links written in full. |
| PR text | A Summary of up to 5 bullets, then the Evidence | A Summary part and an Evidence part. Every claim matches the evidence. |
| Post | Up to 200 words | One idea. The first line works on its own. No list of hashtags. |
| Document | Sections of up to 150 words | Headings, short paragraphs, a numbered list for steps. |

The bullets rule, for every channel: a bullet holds one fact in a short sentence. Two facts joined by "and" become two bullets. The format rules in your `Brand.md` win over this table.

## Companions

This skill calls another skill only when a step needs it. A companion from outside the starter is used only when all three hold, checked each time before it is invoked:

1. Its folder is in `.claude/skills/` or `.agents/skills/` of the workspace.
2. Your skill-sync lock, `.skill-sync/skills.lock.json`, has a row under its folder name (skill-sync names a skill by its folder), with a `commit` and an `approved` date.
3. That row's security result is PASS or FLAG, never BLOCK.

Otherwise the step uses its built-in way and says so. The pinned commit below is the one checked with the `security-check` skill; a later commit needs its own check and your yes in the lock, through `skill-sync`.

| Companion | Source | Pinned commit | Licence | Security check at that commit | When it is invoked |
|---|---|---|---|---|---|
| `humanizer` | Bundled with this starter, copied unmodified from https://github.com/Aboudjem/humanizer-skill (folder `skills/humanizer`); see the starter's ATTRIBUTION.md | `a58df065367550b6ce40ff3f648335018d8e0589` | MIT | FLAG, 0 BLOCK | Step 3, to find and score AI tells, and step 4, to remove them from both rewrites. Always installed with the starter. |
| `diagram-design` | https://github.com/cathrynlavery/diagram-design (folder `skills/diagram-design`) | `e57eda6102a19444538ebd611d39534fad65b663` | MIT | FLAG, 0 BLOCK | Step 5, when the text explains a flow, a process, a structure or a comparison, and only when the three conditions above hold. Otherwise step 5 writes a Mermaid block. |

## Steps

1. **In.** Take the text, or the facts for it, with the channel and the audience. Ask once for whatever is missing. For a PR text, also ask for the Before/After evidence or the test output. Check: you can name the channel (one row of the table), the audience, and the source of each fact.
2. **Load.** Read the brand file (the project's `Brand.md`, else `00-Meta/Brand.md`) and `00-Meta/Voice-DNA.md`. When one is missing, offer to copy its template and go on without it. When the voice DNA holds fewer than 3 texts, say that voice match cannot be scored yet. When it holds 3 or more and its "What your texts show" table is still empty, propose the traits from the texts and write them only after the person's yes. Check: you can say which files you read, and which were missing or empty.
3. **Check.** Score four parts from 0 to 10, each with its fixes in plain words: AI tells (run `humanizer` in detect mode with its score, `--mode detect --score`; its score runs from 0 to 100 and higher is worse, while every score here runs from 0 to 10 and higher is better, so AI tells = round((100 - humanizer score) / 10): a humanizer score of 30 gives AI tells 7), voice match (against the voice DNA), clarity (one idea per sentence, the ask easy to find) and length (against the channel row). Then apply the bullets rule, and check every claim against its source; for a PR text, against the Before/After evidence or the test output. A claim with no source is listed as unchecked, never kept silently. Check: four scores, each with at least one fix or "nothing to fix", and every claim listed with its source or as unchecked.
4. **Rewrite.** Write two versions. Version A stays close to the draft and fixes only what step 3 found. Version B is shorter and plainer, in the order the reader needs. Remove AI tells from both with `humanizer` (`--mode rewrite`, with the voice closest to the tone your `Brand.md` gives this audience). Keep every fact and add none. Check: both versions fit the channel row, keep every checked claim and add no new claim.
5. **Diagram.** When the text explains a flow, a process, a structure or a comparison, add one diagram; otherwise skip this step and say so. Use `diagram-design` when the companion rule allows it, else write a Mermaid block, which GitHub and many other hosts draw. Label it with the words the text uses. Set no colours, so it reads in light and dark. Check: every label appears in the text, and the diagram sets no colour.
6. **Data check.** Read both versions and the diagram labels for keys (a value after "key", "token", "secret" or "password", a long run of random letters and digits, a private key block), email addresses and phone numbers. List each hit with its version and line, showing only its last four characters. Ask the person about each hit before it stays. Check: the list is empty, or every hit has the person's answer.
7. **Review.** Copy [the review page](assets/review-page.html) to `01-Projects/<project>/local/writing-check/<date>-<topic>.html`, in the project the text belongs to, or the selected project. Replace the example cards with one visible card and one uniquely identified copy target per version or diagram. Render prose as semantic HTML: paragraphs, headings, nested lists, bold and links as appropriate; never use a `pre` target for prose. Mark Mermaid source or terminal commands as `data-plain` when they are code-only copy targets; those buttons copy their exact text as plain text only. Escape all text and attribute values for HTML; use only safe http/https link URLs. The visible target is the source of both clipboard formats. Update the metadata JSON, writing every `<` in that block as `\u003c`. Do not change the script or its CSP hash. Before the first write there, run `git check-ignore -q` on that folder; when git would track it, ask the person where to write instead. Run the applicable workspace's rich-copy checker when configured and fix every FAIL before handover. Inspect that each button points to its visible target and that its rich and plain text preserve the intended content. If rich copying is unavailable, the page reports plain-text-only copying. Give the page's full path. Check: all targets are real, semantic and safe; the configured checker passes; metadata JSON contains no literal `<`.
8. **Out.** The person picks a version, edits it if they like, and sends it. You never send, post or publish it, and you never fill a send form for them. Check: nothing was sent by you.
9. **Learn.** Ask whether the person's edits should go into the voice DNA. Only after a yes, add one line per edit under "Learned from edits" in `00-Meta/Voice-DNA.md`: the channel, what changed, and the rule it shows. Keep at most 10 lines there; fold older ones into the table above them. Check: the voice DNA changed only after a yes, and only in "What your texts show" and "Learned from edits".

## Example

The person pastes a 220-word ticket comment for a partner team: a fix is done. The brand file gives the partner tone as plain, with no jargon, and the voice DNA holds four texts. Step 3 scores AI tells 5 (three filler openings, one stacked dash), voice match 6, clarity 5 (the answer sits in the last paragraph) and length 3 (220 words against 120); the claim "all tests pass" is checked against the test output the person shared. Version A keeps the order in 115 words; version B opens with the answer and lists three facts as bullets. The text explains no flow, so step 5 is skipped. The data check finds one email address in the signature and asks about it. The page shows two texts, each with a Copy button. The person copies B, changes one word and sends it. After their yes, one line goes into the voice DNA: ticket comment, "fixed" instead of "resolved".
