'use client'

import { useState } from 'react'
import { ScrollStory, ScrollVideo } from './scroll-story'
import type { Chapters, ScrollChapter } from './scroll-story'
import type { CSSProperties } from 'react'

interface DemoChapter extends ScrollChapter {
  title: string
  body: string
}

const assembly: Chapters<DemoChapter> = [
  { id: 'intro', start: 0, seek: 0, title: 'Lay out the pieces', body: 'Each piece has a place before assembly starts.' },
  { id: 'finish', start: 2, seek: 3, title: 'Join the pieces', body: 'The finished shape connects the same pieces.' },
]
const garden: Chapters<DemoChapter> = [
  { id: 'intro', start: 0, seek: 0, title: 'Plant a seed', body: 'Start with one seed and enough space to grow.' },
  { id: 'grow', start: 2, seek: 3, title: 'Watch the leaves grow', body: 'Water and light support the new leaves.' },
  { id: 'finish', start: 5, seek: 6, title: 'Harvest the garden', body: 'Keep a few seeds for the next season.' },
]

// Original example artwork. Supply your own local films; none ship in the package.
const assemblyPoster = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#edf2f7"/><g fill="#244c70"><rect x="120" y="120" width="100" height="100" rx="12"/><rect x="270" y="120" width="100" height="100" rx="12"/><rect x="420" y="120" width="100" height="100" rx="12"/></g></svg>',
)
const gardenPoster = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#f2f6ec"/><path d="M320 280V160" stroke="#345b31" stroke-width="12"/><g fill="#547b42"><ellipse cx="280" cy="160" rx="50" ry="25" transform="rotate(30 280 160)"/><ellipse cx="360" cy="120" rx="50" ry="25" transform="rotate(-30 360 120)"/></g><path d="M120 290H520" stroke="#6f513a" stroke-width="16"/></svg>',
)
const stageStyle: CSSProperties = {
  boxSizing: 'border-box',
  padding: '2rem 1rem', background: '#fff', color: '#172e40',
}
const linkStyle: CSSProperties = {
  display: 'inline-flex', minHeight: 44, minWidth: 44, alignItems: 'center',
  padding: '0 1rem', color: 'inherit',
}
const videoStyle: CSSProperties = {
  position: 'absolute', inset: 0, width: '100%', height: '100%',
  objectFit: 'contain',
}

interface DemoStoryProps {
  id: string
  chapters: Chapters<DemoChapter>
  duration: number
  frameDuration: number
  storySrc: string
  poster: string
  idleSrc?: string
}

const demoCss = `
.scrollDemoStage { position: relative; }
.scrollDemoMotion { display: none; }
.scrollDemoChapter { padding: 2rem 1rem; scroll-margin-top: 1rem; }
.scrollDemoChapter svg { max-width: 640px; display: block; }
.scrollDemoChapter:focus-visible, .scrollDemo a:focus-visible, .scrollDemo button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.scrollDemo[data-motion-ready='true'][data-reduced-motion='false'] { height: 400svh; }
.scrollDemo[data-motion-ready='true'][data-reduced-motion='false'] .scrollDemoStage { position: sticky; top: 0; min-height: 100svh; }
.scrollDemo[data-motion-ready='true'][data-reduced-motion='false'] .scrollDemoMotion { display: block; }
.scrollDemo[data-motion-ready='true'][data-reduced-motion='false'] .scrollDemoChapter { position: absolute; top: var(--chapter-top); width: 1px; height: 1px; overflow: hidden; padding: 0; clip-path: inset(50%); white-space: nowrap; scroll-margin-top: 0; }
.scrollDemo[data-motion-ready='true'][data-reduced-motion='false'] .scrollDemoStaticLink { display: none; }
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto !important; }
  .scrollDemo[data-motion-ready='true'] { height: auto; }
  .scrollDemo[data-motion-ready='true'] .scrollDemoStage { position: relative; top: auto; min-height: 0; }
  .scrollDemo[data-motion-ready='true'] .scrollDemoMotion { display: none; }
  .scrollDemo[data-motion-ready='true'] .scrollDemoChapter { position: relative; top: auto; width: auto; height: auto; padding: 2rem 1rem; overflow: visible; clip-path: none; white-space: normal; scroll-margin-top: 1rem; }
  .scrollDemo[data-motion-ready='true'] .scrollDemoStaticLink { display: inline-flex; }
}
`

function DemoStill({ id, index, title }: { id: string; index: number; title: string }) {
  return <svg viewBox="0 0 640 360" role="img" aria-label={`${id}: ${title}`} width="100%" height="100%">
    <rect width="640" height="360" fill={id === 'garden' ? '#f2f6ec' : '#edf2f7'} />
    {id === 'assembly'
      ? <g fill="#244c70">
        {[0, 1, 2].map(piece => <rect key={piece} x={120 + piece * 150}
          y={index === 0 ? 100 + piece * 20 : 140} width="100" height="100" rx="12" />)}
      </g>
      : <g stroke="#345b31" strokeWidth="12" fill="#547b42">
        <path d={`M320 280V${240 - index * 70}`} />
        {index > 0 && <ellipse cx="280" cy="170" rx="48" ry="22" />}
        {index > 1 && <ellipse cx="360" cy="105" rx="48" ry="22" />}
      </g>}
  </svg>
}

function DemoStory({
  id, chapters, duration, frameDuration, storySrc, poster, idleSrc,
}: DemoStoryProps) {
  const [idlePaused, setIdlePaused] = useState(false)
  return (
    <ScrollStory id={id} chapters={chapters} duration={duration} frameDuration={frameDuration}>
      {state => (
        <section {...state.sectionProps} aria-label={`${id} story`} className="scrollDemo"
          style={{ position: 'relative', color: '#172e40', background: '#fff' }}>
          <div style={stageStyle} className="scrollDemoStage" data-demo-story={id}
            data-target-time={state.targetTime} data-displayed-time={state.displayedTime}>
            <div className="scrollDemoMotion">
              <div aria-hidden="true"><p><strong>{state.activeChapter.title}</strong></p><p>{state.activeChapter.body}</p></div>
              <ScrollVideo time={state.targetTime} reducedMotion={state.reducedMotion}
                isVisible={state.isVisible} frameDuration={frameDuration} idlePaused={idlePaused}
                storySrc={storySrc} storyPoster={poster} idleSrc={idleSrc} idlePoster={poster}
                onTimeSettled={state.onTimeSettled} onFailureChange={state.onFailureChange}
                onAvailabilityChange={state.onAvailabilityChange}>
                {movie => (
                  <div style={{ position: 'relative', width: 'min(100%, 640px)', aspectRatio: '16 / 9' }}
                    data-story-state={movie.storyState} data-idle-state={movie.idleState}
                    data-story-unavailable={movie.storyUnavailable}>
                    {movie.fallback && <DemoStill id={id} index={state.activeIndex} title={state.activeChapter.title} />}
                    <video {...movie.storyVideoProps} aria-hidden="true"
                      style={{ ...videoStyle, visibility: movie.storyVideoProps['data-visible'] ? 'visible' : 'hidden' }} />
                    {movie.idleVideoProps && <video {...movie.idleVideoProps} aria-hidden="true"
                      style={{ ...videoStyle, visibility: movie.idleVideoProps['data-visible'] ? 'visible' : 'hidden' }} />}
                  </div>
                )}
              </ScrollVideo>
              {idleSrc && <button type="button" aria-pressed={idlePaused} style={linkStyle}
                onClick={() => setIdlePaused(value => !value)}>
                {idlePaused ? 'Resume background animation' : 'Pause background animation'}
              </button>}
              {state.activeIndex === chapters.length - 1 && <a href="#demo-next" style={linkStyle}>Continue with your own story</a>}
            </div>
            <nav {...state.navProps} aria-label={`${id} chapters`}
              style={{ display: 'flex', overflowX: 'auto', maxWidth: '100%' }}>
              {chapters.map((chapter, index) => <a key={chapter.id}
                {...state.getChapterLinkProps(index)} style={linkStyle}>{chapter.id}</a>)}
            </nav>
            {state.chaptersOverflow && <p>Scroll chapters ↔</p>}
          </div>
          {chapters.map((chapter, index) => <section key={chapter.id} id={state.getChapterId(index)}
            className="scrollDemoChapter" tabIndex={-1}
            style={{ '--chapter-top': `${chapter.seek / duration * 300}svh` } as CSSProperties}>
            <h2>{chapter.title}</h2><p>{chapter.body}</p>
            <DemoStill id={id} index={index} title={chapter.title} />
            {index === chapters.length - 1 && <a href="#demo-next" className="scrollDemoStaticLink" style={linkStyle}>Continue with your own story</a>}
          </section>)}
        </section>
      )}
    </ScrollStory>
  )
}

export interface TwoStoriesProps {
  assemblySrc?: string
  assemblyIdleSrc?: string
  gardenSrc?: string
}

export function TwoStories({
  assemblySrc = '/assembly.mp4', assemblyIdleSrc = '/assembly-idle.mp4',
  gardenSrc = '/garden.mp4',
}: TwoStoriesProps) {
  const [showGarden, setShowGarden] = useState(true)
  const [failGarden, setFailGarden] = useState(false)
  const [failIdle, setFailIdle] = useState(false)
  const idleSrc = failIdle ? '/missing-demo-idle.mp4' : assemblyIdleSrc
  const storySrc = failGarden ? '/missing-demo-story.mp4' : gardenSrc
  return (
    <>
      <style>{demoCss}</style>
      <header style={{ padding: '1rem', color: '#172e40', background: '#fff' }}>
        <h1>Two independent scroll stories</h1>
        <p>Both use local chapter ids intro and finish. Their page hashes stay distinct.</p>
        <a href="#garden-chapter-finish" style={linkStyle}>Open garden finish</a>
        <a href="#assembly-chapter-finish" style={linkStyle}>Open assembly finish</a>
        <a href="#unknown-chapter" style={linkStyle}>Unknown hash</a>
        <button style={linkStyle} onClick={() => setShowGarden(value => !value)}>
          {showGarden ? 'Unmount garden' : 'Mount garden'}
        </button>
        <button style={linkStyle} onClick={() => setFailGarden(value => !value)}>
          {failGarden ? 'Restore garden source' : 'Fail garden story'}
        </button>
        <button style={linkStyle} onClick={() => setFailIdle(value => !value)}>
          {failIdle ? 'Restore assembly idle' : 'Fail assembly idle'}
        </button>
        <p>Supply local films to exercise seeking. Missing films show the original SVG fallback.</p>
      </header>
      <DemoStory key={`assembly:${assemblySrc}:${idleSrc}`} id="assembly"
        chapters={assembly} duration={4} frameDuration={1 / 24}
        storySrc={assemblySrc} poster={assemblyPoster} idleSrc={idleSrc} />
      {showGarden && <DemoStory key={`garden:${storySrc}`} id="garden"
        chapters={garden} duration={8} frameDuration={1 / 30}
        storySrc={storySrc} poster={gardenPoster} />}
      <footer id="demo-next" tabIndex={-1} style={{ padding: '2rem 1rem', scrollMarginTop: '1rem' }}>
        <h2>Continue with your own story</h2>
        <p>Bring your own film, chapter text and matching stills.</p>
      </footer>
    </>
  )
}
