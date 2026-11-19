---
name: design-check
description: Checks one web page or app screen against the brand file and accessibility, from screenshots at one width. It reviews the message, the visual and the UI floor (contrast to WCAG 2.2 AA, spacing, touch-target size with its WCAG level named), ranks the findings most important first with one fix each on a local page, and lets the person pick what to fix; it changes no code. Use when the person asks to review, audit or check the design, look, brand fit or accessibility of a page or screen. Not for making a new design, turning a design into code, or checking a text before it is sent (use writing-check).
metadata:
  scope: oss
---

# Design check

This skill reviews one page or screen and returns a ranked list of findings, each with one fix. The person picks what to fix; the skill edits nothing in the page's code. It ships one script, `contrast.mjs`, which computes the WCAG contrast ratio of two colours (Node.js 22 or newer, no packages; it reads its arguments only), and one page template. It installs nothing and signs in nowhere.

## Do not use this when

- You want a new design made, or a design turned into code.
- You want a text checked before it is sent. Use `writing-check`.
- You need a full accessibility audit, for example for a legal statement. This check covers the floor below, not every WCAG criterion.

## The brand file

Read the project's `01-Projects/<project>/Brand.md`, else `00-Meta/Brand.md`. Its Visual part gives the colours, type, spacing, controls and themes; its Voice part gives the words. When there is none, offer to copy the template that `writing-check` uses, `assets/Brand.md` in the `writing-check` skill folder, and go on with the built-in floor alone.

## The page checklist

Message:

- The first screen says what the page is and what to do next.
- There is one main action, and it looks like the main action.
- Headings and labels say what follows, in the words of the brand's Voice part.

Visual:

- Colours, type sizes and weights come from `Brand.md`.
- Alignment and spacing follow one scale; related items sit closer than unrelated ones.
- Nothing is cut off, overlaps or runs past the edge at the captured width.

UI floor, built in, to WCAG 2.2; it applies with or without a brand file:

- Text contrast, WCAG 2.2 success criterion 1.4.3 Contrast (Minimum), level AA: at least 4.5:1, and at least 3:1 for large-scale text (at least 18 point, or 14 point bold: at least 24 CSS px, or 18.66 CSS px bold).
- Non-text contrast, WCAG 2.2 success criterion 1.4.11 Non-text Contrast, level AA: at least 3:1 against the adjacent colours, for control borders, focus indicators and icons that carry meaning.
- Spacing: no text touches an edge or another element, and the gaps come from the brand's spacing scale.
- Touch-target size, WCAG 2.2 success criterion 2.5.8 Target Size (Minimum), level AA: at least 24 by 24 CSS px, with exceptions, for example a smaller target spaced so that a 24 CSS px circle centred on it touches no other target, or a link inside a sentence; read the criterion for the full list. Success criterion 2.5.5 Target Size (Enhanced), level AAA in WCAG 2.2: at least 44 by 44 CSS px. Name the level in each finding, for example "fails 2.5.8 (AA)" or "meets AA, fails 2.5.5 (AAA)". The 44 by 44 pt of Apple's guidelines and the 48 by 48 dp of Android's are platform guidance, not WCAG levels; name them that way when the brand file asks for them.

Source: the W3C Recommendation Web Content Accessibility Guidelines (WCAG) 2.2, https://www.w3.org/TR/WCAG22/. The values above were checked against it on 2026-11-06.

For each colour pair, run `node .claude/skills/design-check/contrast.mjs <foreground> <background>` (or the copy under `.agents/skills/`). It prints the ratio rounded down and whether it meets each AA threshold; it compares the unrounded ratio, so 4.499 fails 4.5. Exit 0 means it printed a result, 2 a usage error.

## Companions

The built-in checks above are the baseline and always run. A companion only adds a second view, and it is used only when all three hold, checked each time before it is invoked:

1. Its folder is in `.claude/skills/` or `.agents/skills/` of the workspace.
2. Your skill-sync lock, `.skill-sync/skills.lock.json`, has a row under its folder name (skill-sync names a skill by its folder), with a `commit` and an `approved` date.
3. That row's security result is PASS or FLAG, never BLOCK.

A companion whose verdict below is BLOCK is never invoked, even when it is installed and in the lock. The pinned commit is the one checked with the `security-check` skill; a later commit needs its own check and your yes in the lock, through `skill-sync`.

| Companion | Source | Pinned commit | Licence | Security check at that commit | When it is invoked |
|---|---|---|---|---|---|
| Taste (folder `taste-skill`, front matter name `design-taste-frontend`) | https://github.com/Leonxlnx/taste-skill (folder `skills/taste-skill`) | `9b4bf937a1f69348126959c15d2f99a73e65699b` | MIT; its photos carry their own licences | FLAG, 0 BLOCK | Step 3, for a second view of the visual part (layout, type, colour), only when the three conditions hold. |
| UI UX Pro Max | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill (folder `.claude/skills`) | `b7d5353e0130feb8c5574ef1251f8a1db1873ccb` | MIT; its fonts under OFL | BLOCK | Never while the BLOCK stands. A later commit that checks without BLOCK, with your yes, would add style and UX guideline lookups in step 3. |
| Impeccable | https://github.com/pbakaus/impeccable (folder `plugin/skills/impeccable`) | `c3bb418ee38ee49a6b999b7752c1368f3123a2bd` | Apache-2.0 | BLOCK | Never while the BLOCK stands. A later commit that checks without BLOCK, with your yes, would add a design critique in step 3. |

## Steps

1. **Inputs.** Ask for the page address or the screens, the page's job in one sentence, the brand file, the width to check, whether a dark mode should be checked too, and whether the page needs a login. Ask all of these here, before any capture. Check: you can name the page, its job, the width, the themes to capture, and how the login is handled.
2. **Capture.** Take one screenshot per theme at that one width, of the whole page or of each screen: with a browser tool your client already has, after the person's yes, or from screenshots the person sends. When the page needs a login, the person signs in or sends the screenshots; you never type a password. Install nothing for this. Save the screenshots in `01-Projects/<project>/local/design-check/<date>-<page>/`; before the first write there, run `git check-ignore -q` on that folder, and when git would track it, ask the person where to save instead. Check: one screenshot per theme, each file named with its theme and width.
3. **Review.** Go through the page checklist: message, visual, UI floor. Read colour values from the CSS, the design file or `Brand.md` when you can; a value picked from a screenshot is approximate, so say so. Run `contrast.mjs` for each text and control colour pair. Measure targets in CSS px; a screenshot taken at 2x holds two image pixels per CSS px. Ask Taste for a second view of the visual part only when the companion rule allows it. Check: every checklist line has a result: a pass, a finding, or "not checked" with the reason.
4. **Result.** Rank the findings: first what stops the page's job, then UI floor failures at level AA, then what is off brand, then polish; within a rank, what affects more people comes first. Give each finding a number, where it is, what you measured, the rule it breaks (the WCAG criterion and level, or the `Brand.md` line), and one fix the person can act on. Write them, in that order, into the `findings` block of a copy of [the result page](assets/result-page.html) in the screenshot folder, with each screenshot named by its file name in that folder. Write every `<` in that block as `\u003c`, so text quoted from the page cannot end the block, and change nothing else in the page: its one script runs only while it matches the hash in the page's header. Give the page's full path. Check: every finding has a rule and a fix, the page lists them in rank order, and the findings block holds no `<`.
5. **Decide.** The person picks the findings to fix, by number. Change nothing in the page's code; making the fixes is a new task, for example through `factory`. Check: you have the person's pick in their words, and no file of the page changed.

## Example

The person asks for a check of a sign-up page at 390 CSS px, light and dark, with no login. Two screenshots go into the project's `local/design-check/` folder. `contrast.mjs` gives 3.03:1 for the grey hint text `#949494` on white (fails 1.4.3, AA) and 1.74:1 for the input border `#c4c4c4` (fails 1.4.11, AA). The Continue button is 40 by 40 CSS px: it meets 2.5.8 (AA) and fails 2.5.5 (AAA). The page lists four findings: 1, the main action sits below the first screen; 2, the hint text, fix `#6b6b6b` at 5.32:1; 3, the input border, fix `#8a8a8a` at 3.45:1; 4, the button size at AAA, as polish, since the brand file asks for no more than AA. The person picks 1, 2 and 3.
