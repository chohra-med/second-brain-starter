# Design patterns for a scroll story

The runtime gives you a clock and chapters. The page still has to look and read well. These patterns come from reviewing a real scroll-story page at 1440, 768, 390 and 360 widths, plus a source check of scrollytelling guidance (Scrollama, The Pudding, MDN, WCAG). Each one names the failure it prevents.

## Copy follows the film, both ways

Failure: copy that swaps instantly when the chapter changes reads as a slideshow, and nothing tells the visitor that scrolling back works.

Drive copy opacity and a small vertical lift from `clock`, the decoded film time:

```ts
const smooth = (v: number) => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t) }
const end = chapters[activeIndex + 1]?.start ?? duration
const enter = activeIndex === 0 ? 1 : smooth((clock - chapter.start) / FADE)
const leave = activeIndex === chapters.length - 1 ? 1 : smooth((end - clock) / FADE)
// style: opacity enter*leave; translateY (1-enter)*2.5rem - (1-leave)*2.5rem
```

`FADE` is film seconds, about 0.6. Set the two values as CSS custom properties and let CSS compute `opacity` and `transform`, so only composited properties animate. The first chapter never fades in and the last never fades out. Pair the copy with a side scrim (or a bottom scrim on phones) that uses the same opacity, so text stays readable over a bright frame.

## Stop where there is something to read

Failure: the film keeps moving while the visitor reads a label or a paragraph, so they scroll past the moment the text describes.

Pass `holds` to `ScrollStory`: one `{ time, length }` at every chapter landing (`time` = the chapter's `seek`) and at every measured label hold, with `time` inside the label's anchored window. About 3.5 film-seconds of scroll for a chapter and 2 for a secondary label read well. Size the section from `travel` so the film keeps its pace between holds, and place a 1px marker with `scroll-snap-align: start; scroll-snap-stop: always` at `timeToProgress(time)` of each hold, with `scroll-snap-type: y proximity` on the root only while motion is on. The scroll then settles on a hold when the visitor stops near it and a fling stops there; scrolling is never blocked. Keep the copy fade window shorter than the gap between a hold and its chapter edge, or the copy is half-faded during the pause. When the film labels one item of a list in the copy (PARA's four homes), highlight that item too.

## One display-size line per screen

Failure: an intro headline at body-adjacent size next to a full-screen film; the picture wins and the promise disappears.

The intro line is the biggest thing on screen, at about `clamp(2.75rem, 5.4vw, 5.25rem)` with tight leading and a `max-width` near 11ch. Chapter headings sit a step down. Body copy stays at the project's body floor (16px or more) with a 34 to 38ch measure. Add a numbered eyebrow (`03 / 07 · PARA`) so the visitor always knows where they are.

## A chapter rail that never overflows

Failure: a row of chapter pills overflows on phones, cuts labels mid-word and needs a "scroll chapters" hint.

Render one segment per chapter in a single row, each a real link carrying `getChapterLinkProps(index)`. Fill each segment with `scaleX` of that chapter's progress (`(clock - start) / (end - start)`); fill earlier segments fully. Show names on wide screens and only the segments on phones. Keep every segment at least 44px tall. The active link already carries `aria-current="step"`.

## Phones: enlarge, crop, pan

Failure: a 16:9 film on a portrait phone becomes a 220px strip with a tiny subject and a band of black.

On narrow screens make the frame wider than the viewport (about `min(180vw, 110svh)`), pin it under the header and pan it toward the labelled node with a transformed `translateX`:

```css
transform: translate3d(clamp(calc(100vw - var(--frame-w)), calc(50vw - var(--focus-x) * var(--frame-w)), 0px), 0, 0);
transition: transform 900ms cubic-bezier(0.2, 0.7, 0.2, 1);
```

Set `--focus-x` per chapter from the measured label and node x positions (0 to 1 of the frame), and 0.5 when nothing is labelled. Labels positioned in frame percentages stay attached because they move with the frame. Put copy at the bottom over a bottom scrim, above the rail.

## Motion that waits for the visitor

- Show a "Scroll to explore" cue at the opening and fade it out with `clock` in the first half second.
- Show the idle-loop pause control only while the idle loop is on screen, icon-only with an `aria-label`. It satisfies WCAG 2.2.2 (Pause, Stop, Hide) for the loop.
- Never move the page for the visitor. Scroll position stays native; the film, copy and rail react to it.

## Scrubbing smoothness: encode first

Failure: stepped or stuck frames on fast scroll.

A browser seeks to a keyframe and decodes forward, so keyframe spacing sets the seek cost. Encode H.264 with a keyframe every 6 frames, no B-frames, scene-cut detection off and fast-start metadata (`-g 6 -keyint_min 6 -sc_threshold 0 -bf 0 -movflags +faststart`). Ship a separate 960x540 encode for screens under 1024px and choose it before the story source is requested. Compare quality with SSIM against the source before replacing a film (`ffmpeg -i new.mp4 -i old.mp4 -lavfi ssim -f null -`); above 0.97 is visually equivalent at these sizes.

`smoothing` on `ScrollStory` (a time constant in ms, about 110) eases the clock toward the scroll target so wheel jumps arrive as a short glide. No source found measures lerp on `currentTime`, so treat it as a feel choice and check it in a real browser: the shown frame should settle within a few hundred milliseconds after a wheel burst.

## What to check before calling it done

At desktop, tablet and two phone widths: the opening, every chapter at its seek point, an intermediate seek, a reverse wheel burst, a chapter-link click, a hash deep link, reduced motion (static chapters render in flow) and no horizontal scroll. Dismiss any cookie banner before judging the bottom of the stage, or the rail and CTA look missing.
