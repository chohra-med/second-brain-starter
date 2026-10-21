---
name: scroll-story-component
description: Add a scroll-driven video story to a React site, where scrolling scrubs a film through chapters, pauses at each labelled moment so the visitor can read, and falls back to static chapters. Ships the runtime as one file to copy into the project. Use when a page should explain an idea by scrolling through a film, or when fixing an existing scroll story.
license: MIT
---

# Scroll story component

This skill carries the whole runtime: [assets/scroll-story.tsx](assets/scroll-story.tsx), one React 19 file with no dependency beyond React. Copy it into the target project and build the page on it. Do not recreate scroll or video seeking by hand. Read the target project's own rules before changing it.

## Required inputs

- Target project and page, its framework (React 19; Next.js, Vite or similar) and its build and test commands.
- The story film, an optional fixed-camera idle loop for the opening, matching stills, and the film's real duration and frame rate.
- Chapters: stable ids, start times, navigation seek times and one short paragraph per idea.
- The measured positions of anything a label points at, and the moments where the film holds still on it.
- The page's existing styles and its phone and desktop layout.

No film yet? Use [the media brief](references/media-brief.md) and settle the storyboard first. A player cannot repair camera resets or drifting geometry. Keep all writing and labels in HTML.

## Demo

What a finished page looks like, recorded on a live page built with this skill: [desktop scroll-through](https://github.com/chohra-med/second-brain-starter/releases/download/v1.7.0/scroll-story-demo-desktop.mp4), [phone scroll-through](https://github.com/chohra-med/second-brain-starter/releases/download/v1.7.0/scroll-story-demo-phone.mp4), [short GIF](https://github.com/chohra-med/second-brain-starter/releases/download/v1.7.0/scroll-story-demo.gif), and every reading pause on [desktop](https://github.com/chohra-med/second-brain-starter/blob/main/docs/media/scroll-story-holds-desktop.jpg) and [phone](https://github.com/chohra-med/second-brain-starter/blob/main/docs/media/scroll-story-holds-phone.jpg). The film scrubs with scroll, stops on each labelled moment while the copy is read, and pans toward the label on phones.

## Workflow

1. Copy [assets/scroll-story.tsx](assets/scroll-story.tsx) into the project, for example `src/components/scroll-story.tsx`. It is now the project's own code. Read [the API](references/api.md) and [integration](references/integration.md).
2. Start from [assets/example.tsx](assets/example.tsx): change its import to the path you chose, then replace the demo chapters, media and styles with the page's own. Keep scroll clock, seeking, recovery and chapter navigation in the copied runtime; keep content, media URLs, labels and styling in the page's adapter.
3. Set `chapters` and `duration` from the decoded film. Give each story a unique `id`. Keep an optional idle loop separate from the paused story film.
4. Design the page with [the design patterns](references/design-patterns.md): reading pauses (`holds`) with snap points at every labelled moment, copy that fades with film time, one display-size line per screen, a chapter rail that never overflows, an enlarged and panned frame on phones, and a film encoded with dense keyframes.
5. Keep decoded-time copy sync and matching stills for recovery. Before JavaScript runs and under reduced motion, render every chapter in flow with stable stills and real fragment targets. Pass all three callbacks (`onTimeSettled`, `onFailureChange`, `onAvailabilityChange`). During camera travel use a short semantic label; point a label at a node only during a measured hold.
6. Add an accessible Pause/Resume control for the idle loop outside the decorative media and pass `idlePaused`. Keep native modified links and back/forward behaviour.
7. Build the project and check in a real browser at desktop, tablet and two phone widths, portrait and landscape: the opening, every reading pause, a chapter-link click, a hash deep link, a reverse scroll, reduced motion and no horizontal scroll. Report what you checked and what you could not.

## Updating

The copied file does not update itself. To take a newer runtime, diff the project's copy against the newer `assets/scroll-story.tsx`, keep any local edits, rebuild and recheck. Do not publish or deploy without the task's authorization.

## Outputs

Return the changed files, where the runtime was copied, a local preview, the media used and the checks you ran, with their limits. Bring your own media; no film ships with this skill.
