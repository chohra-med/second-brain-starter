# Integrating the shared scroll runtime

## Copy the runtime

The runtime is one file in this skill, `assets/scroll-story.tsx`. Copy it into the project, for example to `src/components/scroll-story.tsx`, and import from that path:

```tsx
import { ScrollStory, ScrollVideo, type Chapters, type ScrollChapter } from '@/components/scroll-story'
```

It needs React 19 and nothing else: no Next.js, Tailwind or animation library. Its first statement is `'use client'`, so in Next.js it works as a client component; keep server metadata in a separate server file. Keep one copy per project. Two stories on one page share the same file and need different `id` values.

## Compose the page

Read [the API](api.md) and `assets/example.tsx` for the exact props.

- `ScrollStory` owns progress, reduced motion, visibility, displayed-time chapter selection, URL restoration, chapter links, keyboard focus and overflow state. Its render callback returns the website's section and stage; the runtime adds no layout wrapper.
- `ScrollVideo` owns latest-target seeking, movie readiness, separate story/idle failures and ambient playback. Its render callback supplies managed props for the video elements and a fallback flag.
- Spread runtime-owned refs and event props on the corresponding elements. Add your classes, accessibility labels and visual inspection attributes without replacing managed handlers.
- Keep still selection, writing, annotations and layout in your adapter. Use the website's image component. `onTimeSettled`, `onFailureChange` and `onAvailabilityChange` connect the player to the story clock. Preserve all three: explicit error is distinct from first-load or bounded recovery availability.

Chapters are a nonempty, ordered list with unique IDs. Start at zero; all timestamps must be finite and navigation seeks must stay inside the film duration. Set `duration` from the decoded film. Supply the same `frameDuration` to both components when changing the default 1/24 second. Keep chapter/media configuration stable during a mount; use a new React key to replace its identity.

Give every instance a unique `id`. Default chapter hashes are namespaced to that story. Explicit hashes and aliases preserve existing links, but must be unique across the page. Render complete readable chapter targets with matching canonical and alias IDs before the client initializes. `motionReady` starts false; static HTML must remain meaningful without JavaScript. One page still has one viewport and one URL hash.

CSS owns the long scroll container and sticky viewport. Derive marker positions from the same declared scroll range. Keep the film in a common aspect-ratio frame, maintain readable copy and label space, and use complete in-flow chapter text and stable stills before motion admission and for reduced motion. Keep one stable page H1 and a meaningful later heading hierarchy. A nested custom scroll container is outside this runtime's window-scroll contract.

## Availability and playback controls

The exact props are in [the API](api.md). `ScrollVideo` attaches neither MP4 before client motion admission and attaches neither source under initial reduced motion. First-load unavailable frames use matching stills and target-time copy. A subsequent pending seek enters still recovery after five visible seconds without decoded progress; changing scroll targets does not renew that budget. Hidden or offscreen time pauses it. Late matching frames restore synchronization without reloading or labeling slow media failed. Preserve `onAvailabilityChange` separately from explicit `onFailureChange`.

The adapter owns an accessible Pause/Resume control and passes controlled `idlePaused` (default false). Keep this control outside any decorative `aria-hidden` scene. Retain pause across reverse scrolling and visibility changes; pausing the opening does not disable story seeking.

Managed primary chapter links preserve host history state. Modified clicks, alternate buttons, target and download anchors remain native. Preserve back/forward and meaningful static fragments. Automatic nav centering must not move a hovered, pressed or focused pointer target. Supply a native terminal link to the next meaningful section when the story ends.

## Fixes and updates

1. Reproduce the issue in the project's copy of `scroll-story.tsx` and fix it there.
2. If the fix belongs in the runtime itself, apply the same change to the skill's `assets/scroll-story.tsx` so the next project gets it.
3. A project that copied the file earlier keeps its old copy until you diff, update, rebuild and deploy it.

## Bounded acceptance

Inspect ordinary forward/reverse scrolling, a pending seek followed by a newer target, direct chapter entry before metadata, first pointer click, keyboard focus/Enter, phone nav overflow, a resize after navigation, independent story/idle failure, pause persistence, bounded stalled-seek recovery, all-chapter JavaScript-disabled and reduced-motion layout, and terminal navigation. Use two differently configured story instances to expose accidental shared state or hash ownership. Browser/media differences require their own evidence; a successful compile does not qualify every browser.

The skill explains integration. Film preparation and narrative planning remain separate methods; no amount of runtime reuse can join unrelated camera states into the same physical graph.
