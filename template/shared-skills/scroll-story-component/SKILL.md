---
name: scroll-story-component
description: Integrate or maintain a shared React scroll-story component across websites, with reversible video seeking, an idle loop and site-specific chapters. Use when reusing the same scroll behavior or fixing its shared runtime.
license: MIT
---

# Shared scroll story component

Use the supplied React runtime instead of recreating scroll and video effects in each page. Read the target project's rules and the package README before changing its consumer.

## Required inputs

- Target website and page, existing component/package revision and build instructions.
- Approved story film, optional fixed-camera idle loop, matching stills and actual duration/frame rate.
- Chapters: stable IDs, starting times, navigation seek times and one short paragraph per concept.
- Existing styles, phone/desktop composition and measured label coordinates.

For a new scene, use [the media brief](references/media-brief.md), settle the storyboard and inspect film continuity first. A player cannot repair camera resets or drifting geometry. Keep writing and labels in HTML.

## Workflow

1. Locate the runtime: install it with `npm install github:chohra-med/scroll-story` (public source), or use the release included in `assets/scroll-story` or a checkout's own `packages/scroll-story`. Read [integration](references/integration.md). Install or link one shared revision; preserve the prior revision for rollback.
2. Keep scroll clock, latest-time seeking, idle/story recovery and chapter navigation in the shared runtime. Keep content, media URLs, labels and styling in the website adapter. Change the runtime once for a shared defect.
3. Mount the story using the package's example. Give each story a unique ID namespace and adapt its chapter times to the supplied film. Keep an optional idle loop separate from the paused story movie. Design the page with [the design patterns](references/design-patterns.md): reading pauses with snap points at every labelled moment, copy that fades with film time, one display-size line per screen, a chapter rail that never overflows, an enlarged and panned frame on phones, and an encode with dense keyframes.
4. Preserve decoded-time copy synchronization and target-matched still recovery. Before client motion admission, with JavaScript disabled or under reduced motion, render all chapters in flow with stable stills and real fragment targets. Forward both availability and explicit failure callbacks; loading and bounded recovery are distinct from an error. During camera travel use a semantic label; connect it to a specific node only at a measured hold.
5. Own a persistent accessible Pause/Resume control outside decorative media and pass controlled `idlePaused`. Preserve native modified links, host history and back/forward behavior. Keep pointer targets stationary until click release.
6. Build the consumer and inspect the opening, chapter clicks, an intermediate seek and reverse scroll at desktop and narrow-phone widths. Check keyboard focus without moving a pointer target before click release. Exercise actual no-JS and reduced-motion modes, loading/recovery, independent media failure, pause and terminal continuation. Report the observed scope and limits; simulated fixtures do not qualify a real browser mode.
7. For a shared fix, release a new package revision, update each declared consumer and rebuild it. A source edit does not change websites that already shipped an older bundle. Do not publish or deploy without the task's authorization.

## Outputs

Return the shared source/package revision, changed adapter, local preview, source/media identities, installation instructions and observed checks. List which websites consume that revision and which still need updating. Keep paid generation and public release separate from local integration.

The portable export contains original code/instructions and a media-free example. Bring your own media; generated CasaInnov films and commercial launcher code are not included.
