# scroll-story API

The runtime is one file, [assets/scroll-story.tsx](../assets/scroll-story.tsx), with two headless React 19 components: `ScrollStory` turns scroll position into a film clock with chapters and reading pauses, and `ScrollVideo` seeks a paused video to that clock and plays an optional idle loop at the opening. It adds no wrapper elements and no CSS, and React is its only dependency. The imports below assume you copied it to `src/components/scroll-story.tsx` with an `@/` path alias; adjust the path to wherever you put it.

## Quickstart

```tsx
'use client'
import { ScrollStory, ScrollVideo, type Chapters, type ScrollChapter } from '@/components/scroll-story'

interface Beat extends ScrollChapter { title: string }

const beats: Chapters<Beat> = [
  { id: 'intro', start: 0, seek: 0, title: 'Lay out the pieces' },
  { id: 'build', start: 2, seek: 3, title: 'Join the pieces' },
]

export function Story() {
  return (
    <ScrollStory id="assembly" chapters={beats} duration={4} smoothing={110}>
      {story => (
        <section {...story.sectionProps} style={{ height: '400svh' }}>
          <div style={{ position: 'sticky', top: 0, height: '100svh' }}>
            <ScrollVideo time={story.targetTime} reducedMotion={story.reducedMotion}
              isVisible={story.isVisible} storySrc="/assembly.mp4" storyPoster="/assembly.jpg"
              onTimeSettled={story.onTimeSettled} onFailureChange={story.onFailureChange}
              onAvailabilityChange={story.onAvailabilityChange}>
              {movie => <video {...movie.storyVideoProps} style={{ width: '100%' }} />}
            </ScrollVideo>
            <h2>{story.activeChapter.title}</h2>
            <nav {...story.navProps}>
              {beats.map((beat, i) => <a key={beat.id} {...story.getChapterLinkProps(i)}>{beat.title}</a>)}
            </nav>
          </div>
        </section>
      )}
    </ScrollStory>
  )
}
```

The section is 400svh tall with a 100svh sticky stage, so the film plays across 300svh of scroll. That is the whole contract: spread the props, keep the scroll length, bring your own film.

The full example in [assets/example.tsx](../assets/example.tsx) adds two independent stories on one page, an idle opening loop with a pause control, static chapters for reduced motion and no JavaScript, and fallbacks for missing media.

## API

### `ScrollStory`

| Prop | Type | Default | What it does |
|---|---|---|---|
| `id` | `string` | required | Unique story id; default chapter hashes are `${id}-chapter-${chapter.id}`. |
| `chapters` | `Chapters<C>` | required | Non-empty tuple. `start` values ascend from 0; `seek` is where a chapter link lands. Optional `hash` and `aliases`. |
| `duration` | `number` | required | Film length in seconds. |
| `frameDuration` | `number` | `1 / 24` | Seek tolerance, one frame. |
| `smoothing` | `number` | `0` | Time constant in ms that eases the clock toward the scroll target. `0` follows scroll exactly. Chapter jumps always snap. |
| `holds` | `ScrollHold[]` | `[]` | Reading pauses, ascending: `{ time, length }`. The film stays on `time` while the visitor scrolls `length` film-seconds of travel. Chapter links land in the middle of a hold at their `seek`. |
| `children` | `(state) => ReactNode` | required | Render callback. Do not call hooks inside it. |

The render state gives you `activeChapter`, `activeIndex`, `targetTime`, `displayedTime`, `clock`, `motionReady`, `reducedMotion`, `isVisible`, `chaptersOverflow`, `travel` (duration plus every hold length, in film-seconds), `timeToProgress(time)`, plus `sectionProps`, `navProps`, `getChapterId(i)`, `getChapterLinkProps(i)` and the three callbacks to hand to `ScrollVideo`.

`clock` is the time to drive your visuals with. It is the decoded frame time in normal playback, and the target time at the opening, in reduced motion or while the film is unavailable. Fading copy in and out with `clock` keeps text and picture in step in both directions.

### `ScrollVideo`

| Prop | Type | What it does |
|---|---|---|
| `time` | `number` | Pass `targetTime`. |
| `storySrc`, `storyPoster` | `string` | The scrubbed film and its poster. |
| `idleSrc`, `idlePoster` | `string?` | Optional opening loop. |
| `idlePaused` | `boolean?` | Controlled pause for the idle loop. |
| `reducedMotion`, `isVisible` | `boolean` | Pass them through from `ScrollStory`. |
| `onTimeSettled`, `onFailureChange`, `onAvailabilityChange` | callbacks | Pass them through from `ScrollStory`. |
| `children` | `(movie) => ReactNode` | Spread `storyVideoProps` on one `<video>` and, when not null, `idleVideoProps` on another. |

`movie.fallback` tells you when to show a still, and `data-visible` on each video prop tells your CSS which film to show.

## Reading pauses

Give readers time where the film shows something worth reading. A hold freezes the film on one frame for a stretch of scroll, so the label and the copy stay put while the visitor reads:

```tsx
const holds = [{ time: 0, length: 2.5 }, { time: 3, length: 3.5 }]
<ScrollStory id="assembly" chapters={beats} duration={4} holds={holds}>
  {story => (
    <section {...story.sectionProps} style={{ position: 'relative', height: `${story.travel * 100 + 100}svh` }}>
      {holds.map(h => <span key={h.time} style={{ position: 'absolute', top: `${story.timeToProgress(h.time) * story.travel * 100}svh`, scrollSnapAlign: 'start', scrollSnapStop: 'always' }} />)}
      {/* sticky stage as in the quickstart */}
    </section>
  )}
</ScrollStory>
```

Size the section from `travel` so the film keeps its pace between holds: here 100svh of scroll per film-second, plus one viewport for the sticky stage. The snap markers are optional: with `scroll-snap-type: y proximity` on the root, a scroll that stops near a hold settles on it and a fling stops there instead of flying past the text. Scrolling itself is never blocked.

## Preparing the film

Most scrub jank comes from the encode. A browser can only land on a keyframe and decode forward from it, so sparse keyframes mean slow seeks.

```sh
# desktop: keyframe every 6 frames, no B-frames, metadata up front
ffmpeg -i film.mov -an -c:v libx264 -pix_fmt yuv420p -crf 25 -g 6 -keyint_min 6 \
  -sc_threshold 0 -bf 0 -movflags +faststart story.mp4
# phones: same settings at 960x540
ffmpeg -i film.mov -an -vf scale=960:540 -c:v libx264 -pix_fmt yuv420p -crf 26 -g 6 \
  -keyint_min 6 -sc_threshold 0 -bf 0 -movflags +faststart story-540.mp4
```

For one 36.75 second, 720p film this took the file from 25.5 MB to 16.2 MB with twice the keyframes, plus a 10.4 MB phone version. Pick the source before the story is requested, then keep it stable; changing `storySrc` mid-story is not supported, so remount with a new `key` instead.

Keep text out of the film. Put labels and copy in HTML so they stay sharp, translatable and readable by screen readers.

## Rules that keep it working

- Chapter ids, hashes and aliases must be unique on the page, without `#` or spaces. Invalid configuration throws while you author it.
- Render every chapter as real, readable content before JavaScript runs and under reduced motion. Hide the static copy only once `motionReady && !reducedMotion`.
- Keep `chapters`, `duration` and media URLs stable for a mount.
- A fix to the runtime reaches a site only after you copy the newer file into it, rebuild and deploy.
