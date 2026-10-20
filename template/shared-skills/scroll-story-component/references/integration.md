# Integrating the shared scroll runtime

## Locate and install

The local development owner is the target checkout's `packages/scroll-story/`. The portable release includes a generated copy at `assets/scroll-story/` and an installable archive at `assets/scroll-story.tgz`. `RELEASE.json` binds the package revision and delivered files. Edit the canonical source, then regenerate exports; do not maintain two runtimes.

From an existing React 19 website, install the public source, which builds on install:

```bash
npm install github:chohra-med/scroll-story
```

Or install the portable archive using its actual full path:

```bash
npm install /absolute/path/scroll-story-component/assets/scroll-story.tgz
```

Import from `@casainnov/scroll-story`. The built package is ESM, uses React as its only runtime peer, and includes TypeScript declarations. It does not depend on Next.js, Tailwind or a vault. React 18 and CommonJS compatibility are not claimed. A Next.js consumer calling render callbacks must be a client component; retain server metadata outside it.

For source-linked development, map one import to the canonical package source. CasaInnov uses `@/scroll-story` in its TypeScript paths. Other websites can install the same built revision. A copied source file is a fork, not shared maintenance.

## Compose the page

Read the package README and shipped examples for the exact API.

- `ScrollStory` owns progress, reduced motion, visibility, displayed-time chapter selection, URL restoration, chapter links, keyboard focus and overflow state. Its render callback returns the website's section and stage; the runtime adds no layout wrapper.
- `ScrollVideo` owns latest-target seeking, movie readiness, separate story/idle failures and ambient playback. Its render callback supplies managed props for the video elements and a fallback flag.
- Spread runtime-owned refs and event props on the corresponding elements. Add your classes, accessibility labels and visual inspection attributes without replacing managed handlers.
- Keep still selection, writing, annotations and layout in your adapter. Use the website's image component. `onTimeSettled`, `onFailureChange` and `onAvailabilityChange` connect the player to the story clock. Preserve all three: explicit error is distinct from first-load or bounded recovery availability.

Chapters are a nonempty, ordered list with unique IDs. Start at zero; all timestamps must be finite and navigation seeks must stay inside the film duration. Set `duration` from the decoded film. Supply the same `frameDuration` to both components when changing the default 1/24 second. Keep chapter/media configuration stable during a mount; use a new React key to replace its identity.

Give every instance a unique `id`. Default chapter hashes are namespaced to that story. Explicit hashes and aliases preserve existing links, but must be unique across the page. Render complete readable chapter targets with matching canonical and alias IDs before the client initializes. `motionReady` starts false; static HTML must remain meaningful without JavaScript. One page still has one viewport and one URL hash.

CSS owns the long scroll container and sticky viewport. Derive marker positions from the same declared scroll range. Keep the film in a common aspect-ratio frame, maintain readable copy and label space, and use complete in-flow chapter text and stable stills before motion admission and for reduced motion. Keep one stable page H1 and a meaningful later heading hierarchy. A nested custom scroll container is outside this runtime's window-scroll contract.

## Availability and playback controls

The exact API belongs to the package README. `ScrollVideo` attaches neither MP4 before client motion admission and attaches neither source under initial reduced motion. First-load unavailable frames use matching stills and target-time copy. A subsequent pending seek enters still recovery after five visible seconds without decoded progress; changing scroll targets does not renew that budget. Hidden or offscreen time pauses it. Late matching frames restore synchronization without reloading or labeling slow media failed. Preserve `onAvailabilityChange` separately from explicit `onFailureChange`.

The adapter owns an accessible Pause/Resume control and passes controlled `idlePaused` (default false). Keep this control outside any decorative `aria-hidden` scene. Retain pause across reverse scrolling and visibility changes; pausing the opening does not disable story seeking.

Managed primary chapter links preserve host history state. Modified clicks, alternate buttons, target and download anchors remain native. Preserve back/forward and meaningful static fragments. Automatic nav centering must not move a hovered, pressed or focused pointer target. Supply a native terminal link to the next meaningful section when the story ends.

## Shared fixes across websites

1. Reproduce the issue in the runtime's canonical source and fix it there.
2. Build and pack a new revision; inspect the actual installed output.
3. Update each declared website's package pin or shared source import.
4. Build and review that consumer, then deploy under its own authority.
5. Retain the previous package and consumer build for rollback.

Source-linked development can reflect one change on the next rebuild. Websites already deployed with a versioned package retain their old bundle until updated and rebuilt. Do not promise automatic propagation to live sites.

## Bounded acceptance

Inspect ordinary forward/reverse scrolling, a pending seek followed by a newer target, direct chapter entry before metadata, first pointer click, keyboard focus/Enter, phone nav overflow, a resize after navigation, independent story/idle failure, pause persistence, bounded stalled-seek recovery, all-chapter JavaScript-disabled and reduced-motion layout, and terminal navigation. Use two differently configured story instances to expose accidental shared state or hash ownership. Browser/media differences require their own evidence; a successful compile does not qualify every browser.

The skill explains integration. Film preparation and narrative planning remain separate methods; no amount of package reuse can join unrelated camera states into the same physical graph.
