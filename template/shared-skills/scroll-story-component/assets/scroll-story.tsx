// scroll-story runtime, MIT licence. Shipped inside the scroll-story-component skill.
// Copy this one file into your project (for example src/components/scroll-story.tsx).
// Once copied it is your code: edit it freely; recopy from a newer skill to update.
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentPropsWithRef as Props, ReactNode } from 'react'

export interface ScrollChapter {
  id: string
  start: number
  seek: number
  hash?: string
  aliases?: readonly string[]
}

export type Chapters<C extends ScrollChapter> = readonly [C, ...C[]]

/** A reading pause: the film holds at `time` while the visitor scrolls `length` film-seconds of travel. */
export interface ScrollHold {
  time: number
  length: number
}
export type ChapterLinkProps = Pick<Props<'a'>,
  'href' | 'aria-current' | 'onFocus' | 'onClick'>

export interface ScrollStoryState<C extends ScrollChapter> {
  activeChapter: C
  activeIndex: number
  targetTime: number
  displayedTime: number
  clock: number
  motionReady: boolean
  reducedMotion: boolean
  isVisible: boolean
  chaptersOverflow: boolean
  /** Scroll travel in film-seconds: duration plus every hold length. */
  travel: number
  /** Fraction (0..1) of scroll travel where `time` is shown; a hold resolves to its middle. */
  timeToProgress: (time: number) => number
  sectionProps: Pick<Props<'section'>, 'ref' | 'id'> & {
    'data-reduced-motion': boolean
    'data-motion-ready': boolean
  }
  navProps: Pick<Props<'nav'>, 'ref' | 'onPointerDown'>
  getChapterId: (index: number) => string
  getChapterLinkProps: (index: number) => ChapterLinkProps
  onTimeSettled: (time: number) => void
  onFailureChange: (storyFailed: boolean) => void
  onAvailabilityChange: (storyUnavailable: boolean) => void
}

export interface ScrollStoryProps<C extends ScrollChapter> {
  id: string
  chapters: Chapters<C>
  duration: number
  frameDuration?: number
  /** Time constant in ms for easing the scroll target; 0 follows scroll exactly. */
  smoothing?: number
  /** Reading pauses, ascending by time. */
  holds?: readonly ScrollHold[]
  children: (state: ScrollStoryState<C>) => ReactNode
}

export type VideoState = 'loading' | 'ready' | 'failed'
export type ManagedVideoProps = Pick<Props<'video'>,
  | 'ref' | 'src' | 'poster' | 'muted' | 'playsInline' | 'loop'
  | 'preload' | 'tabIndex' | 'onLoadedMetadata' | 'onLoadedData'
  | 'onSeeked' | 'onError'> & { 'data-visible': boolean }

export interface ScrollVideoState {
  idle: boolean
  fallback: boolean
  storyRequested: boolean
  storyState: VideoState
  storyUnavailable: boolean
  idleState: VideoState | 'absent'
  storyVideoProps: ManagedVideoProps
  idleVideoProps: ManagedVideoProps | null
}

export interface ScrollVideoProps {
  time: number
  reducedMotion: boolean
  isVisible: boolean
  storySrc: string
  storyPoster: string
  idleSrc?: string
  idlePoster?: string
  idlePaused?: boolean
  frameDuration?: number
  onTimeSettled: (time: number) => void
  onFailureChange: (storyFailed: boolean) => void
  onAvailabilityChange?: (storyUnavailable: boolean) => void
  children: (state: ScrollVideoState) => ReactNode
}

const noHolds: readonly ScrollHold[] = []

function holdMap(holds: readonly ScrollHold[], duration: number) {
  holds.forEach((hold, index) => {
    if (!Number.isFinite(hold.time) || hold.time < 0 || hold.time > duration ||
      !Number.isFinite(hold.length) || hold.length <= 0 ||
      (index > 0 && hold.time <= holds[index - 1].time)) {
      throw new Error('ScrollStory holds need ascending times inside duration and positive lengths')
    }
  })
  const travel = duration + holds.reduce((sum, hold) => sum + hold.length, 0)
  const progressToTime = (progress: number) => {
    let position = progress * travel
    for (const hold of holds) {
      if (position <= hold.time) return position
      if (position <= hold.time + hold.length) return hold.time
      position -= hold.length
    }
    return Math.min(duration, position)
  }
  const timeToProgress = (time: number) => {
    let position = time
    for (const hold of holds) {
      if (hold.time < time) position += hold.length
      else if (hold.time === time) position += hold.length / 2
    }
    return Math.max(0, Math.min(1, position / travel))
  }
  return { travel, progressToTime, timeToProgress }
}

function validId(value: string) {
  return value.length > 0 && !/[\s#]/.test(value)
}

function validateFrameDuration(frameDuration: number) {
  if (!Number.isFinite(frameDuration) || frameDuration <= 0) {
    throw new Error('Scroll story frameDuration must be finite and positive')
  }
}

export function ScrollStory<C extends ScrollChapter>({
  id, chapters, duration, frameDuration = 1 / 24, smoothing = 0, holds = noHolds, children,
}: ScrollStoryProps<C>): ReactNode {
  if (!Number.isFinite(smoothing) || smoothing < 0) {
    throw new Error('ScrollStory smoothing must be a finite number of milliseconds >= 0')
  }
  const hashes = useMemo(() => {
    validateFrameDuration(frameDuration)
    if (!validId(id) || !Number.isFinite(duration) || duration <= 0 ||
      !chapters.length || chapters[0].start !== 0) {
      throw new Error('ScrollStory needs an id, positive duration and chapters starting at 0')
    }
    const ids = new Set<string>()
    const ownedHashes = new Set<string>([id])
    return chapters.map((chapter, index) => {
      const hash = chapter.hash ?? `${id}-chapter-${chapter.id}`
      if (!validId(chapter.id) || ids.has(chapter.id) ||
        !Number.isFinite(chapter.start) || chapter.start < 0 ||
        chapter.start > duration || (index > 0 && chapter.start <= chapters[index - 1].start) ||
        !Number.isFinite(chapter.seek) || chapter.seek < 0 || chapter.seek > duration) {
        throw new Error('ScrollStory chapters need unique ids and ordered finite times inside duration')
      }
      ids.add(chapter.id)
      for (const value of [hash, ...(chapter.aliases ?? [])]) {
        if (!validId(value) || ownedHashes.has(value)) {
          throw new Error('ScrollStory hashes and aliases must be unique and omit #')
        }
        ownedHashes.add(value)
      }
      return hash
    })
  }, [id, chapters, duration, frameDuration])
  const map = useMemo(() => holdMap(holds, duration), [holds, duration])
  const [targetTime, setTargetTime] = useState(0)
  const [displayedTime, setDisplayedTime] = useState(0)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [motionReady, setMotionReady] = useState(false)
  const [storyFailed, setStoryFailed] = useState(false)
  const [storyUnavailable, setStoryUnavailable] = useState(false)
  const [isVisible, setIsVisible] = useState(true)
  const [chaptersOverflow, setChaptersOverflow] = useState(false)
  const storyRef = useRef<HTMLElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const heldChapterRef = useRef<number | null>(null)
  const pointerDownRef = useRef(false)
  const easedRef = useRef(0)
  const snapRef = useRef(true)
  const clock = reducedMotion || storyFailed || storyUnavailable || targetTime <= frameDuration
    ? targetTime : displayedTime
  let activeIndex = chapters.length - 1
  while (activeIndex > 0 && clock < chapters[activeIndex].start) activeIndex--
  const onTimeSettled = useCallback((time: number) => setDisplayedTime(time), [])
  const onFailureChange = useCallback((failed: boolean) => setStoryFailed(failed), [])
  const onAvailabilityChange = useCallback((unavailable: boolean) => setStoryUnavailable(unavailable), [])
  const getChapterId = useCallback((index: number) => hashes[index], [hashes])
  const matchHash = useCallback(() => {
    const hash = window.location.hash.slice(1)
    return chapters.findIndex((chapter, index) =>
      hash === hashes[index] || chapter.aliases?.includes(hash))
  }, [chapters, hashes])

  const scrollToChapter = useCallback((index: number, instant = false) => {
    const story = storyRef.current
    if (!story) return
    const time = chapters[index].seek
    heldChapterRef.current = index
    if (instant) snapRef.current = true
    if (reducedMotion) {
      setTargetTime(time)
      document.getElementById(hashes[index])?.scrollIntoView({ behavior: 'instant', block: 'start' })
      return
    }
    const length = Math.max(0, story.offsetHeight - window.innerHeight)
    window.scrollTo({
      top: story.getBoundingClientRect().top + window.scrollY + length * map.timeToProgress(time),
      behavior: instant ? 'instant' : 'smooth',
    })
    if (instant) setTargetTime(time)
  }, [chapters, map, reducedMotion, hashes])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => { setReducedMotion(media.matches); setMotionReady(true) }
    update(); media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const story = storyRef.current
    if (!story) return
    let frame = 0
    let last = 0
    const update = (now: number) => {
      frame = 0
      if (!motionReady || reducedMotion) return
      const length = story.offsetHeight - window.innerHeight
      const progress = Math.max(0, Math.min(1,
        length > 0 ? -story.getBoundingClientRect().top / length : 0))
      const target = map.progressToTime(progress)
      // Ease toward the scroll target; snap on first paint, jumps and the last sub-frame.
      const step = last ? now - last : 0
      last = now
      let next = target
      if (smoothing > 0 && !snapRef.current) {
        next = easedRef.current + (target - easedRef.current) * (1 - Math.exp(-step / smoothing))
        if (Math.abs(target - next) < frameDuration / 4) next = target
      }
      snapRef.current = false
      easedRef.current = next
      setTargetTime(next)
      if (next !== target) frame = requestAnimationFrame(update)
      else last = 0
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    const visibility = () => {
      const rect = story.getBoundingClientRect()
      const visible = document.visibilityState === 'visible' &&
        rect.bottom > 0 && rect.top < window.innerHeight
      setIsVisible(visible)
      if (visible) schedule()
    }
    const observer = new IntersectionObserver(([entry]) => {
      setIsVisible(entry.isIntersecting && document.visibilityState === 'visible')
      if (entry.isIntersecting) schedule()
    })
    observer.observe(story)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    document.addEventListener('visibilitychange', visibility)
    visibility(); schedule()
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [map, frameDuration, smoothing, motionReady, reducedMotion])

  useEffect(() => {
    let frame = 0
    const release = () => {
      heldChapterRef.current = null
      cancelAnimationFrame(frame); frame = 0
    }
    const queue = (index: number, hash: string) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = 0
        if (window.location.hash !== hash || matchHash() !== index ||
          heldChapterRef.current !== index) return
        scrollToChapter(index, true)
      })
    }
    const preserve = () => {
      const index = heldChapterRef.current
      if (index === null) return
      if (matchHash() !== index) { release(); return }
      queue(index, window.location.hash)
    }
    const restore = () => {
      const index = matchHash()
      if (index < 0) { release(); return }
      heldChapterRef.current = index
      queue(index, window.location.hash)
    }
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown']
    window.addEventListener('resize', preserve)
    for (const event of events) window.addEventListener(event, release, { passive: true })
    if (document.readyState === 'complete') restore()
    else window.addEventListener('load', restore, { once: true })
    window.addEventListener('pageshow', restore)
    window.addEventListener('hashchange', restore)
    window.addEventListener('popstate', restore)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', preserve)
      for (const event of events) window.removeEventListener(event, release)
      window.removeEventListener('load', restore)
      window.removeEventListener('pageshow', restore)
      window.removeEventListener('hashchange', restore)
      window.removeEventListener('popstate', restore)
    }
  }, [matchHash, scrollToChapter, motionReady])

  const centerLink = useCallback((link: HTMLElement) => {
    const nav = navRef.current
    if (!nav || pointerDownRef.current) return
    const left = link.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft
    nav.scrollTo({
      left: Math.max(0, left - (nav.clientWidth - link.clientWidth) / 2),
      behavior: 'instant',
    })
  }, [])

  useEffect(() => {
    const center = () => {
      const nav = navRef.current
      if (!nav || pointerDownRef.current || nav.contains(document.activeElement) || nav.matches(':hover')) return
      const active = nav.querySelector<HTMLElement>("[aria-current='step']")
      if (active) centerLink(active)
    }
    center(); window.addEventListener('resize', center)
    return () => window.removeEventListener('resize', center)
  }, [activeIndex, centerLink])

  useEffect(() => {
    const release = () => { pointerDownRef.current = false }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
    }
  }, [])

  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const measure = () => setChaptersOverflow(nav.scrollWidth > nav.clientWidth + 1)
    const observer = new ResizeObserver(measure)
    observer.observe(nav)
    measure()
    return () => observer.disconnect()
  }, [])

  const getChapterLinkProps = (index: number): ChapterLinkProps => ({
    href: `#${getChapterId(index)}`,
    'aria-current': activeIndex === index ? 'step' : undefined,
    onFocus: event => {
      const link = event.currentTarget
      if (!CSS.supports('selector(:focus-visible)') || !link.matches(':focus-visible')) return
      centerLink(link)
    },
    onClick: event => {
      const link = event.currentTarget
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
        event.shiftKey || event.altKey || link.hasAttribute('download') ||
        (link.target && link.target !== '_self') || reducedMotion || !motionReady) return
      event.preventDefault()
      const hash = `#${getChapterId(index)}`
      if (window.location.hash !== hash) window.history.pushState(window.history.state, '', hash)
      scrollToChapter(index)
    },
  })

  return children({
    activeChapter: chapters[activeIndex], activeIndex,
    targetTime, displayedTime, clock, motionReady, reducedMotion, isVisible, chaptersOverflow,
    travel: map.travel, timeToProgress: map.timeToProgress,
    sectionProps: { ref: storyRef, id, 'data-reduced-motion': reducedMotion, 'data-motion-ready': motionReady },
    navProps: { ref: navRef, onPointerDown: () => { pointerDownRef.current = true } }, getChapterId, getChapterLinkProps,
    onTimeSettled, onFailureChange, onAvailabilityChange,
  })
}

export function ScrollVideo({
  time, reducedMotion, isVisible, storySrc, storyPoster, idleSrc, idlePoster,
  idlePaused = false, frameDuration = 1 / 24,
  onTimeSettled, onFailureChange, onAvailabilityChange, children,
}: ScrollVideoProps): ReactNode {
  validateFrameDuration(frameDuration)
  if (!Number.isFinite(time)) throw new Error('ScrollVideo time must be finite')
  const videoRef = useRef<HTMLVideoElement>(null)
  const idleRef = useRef<HTMLVideoElement>(null)
  const desiredRef = useRef(time)
  const [storyReady, setStoryReady] = useState(false)
  const [storyRequested, setStoryRequested] = useState(false)
  const [storyFailed, setStoryFailed] = useState(false)
  const [idleReady, setIdleReady] = useState(false)
  const [idleFailed, setIdleFailed] = useState(false)
  const [motionAdmitted, setMotionAdmitted] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [progress, setProgress] = useState(0)
  const lastSettledRef = useRef<number | null>(null)
  const waitRemainingRef = useRef(5000)
  const progressSeenRef = useRef(0)
  const idle = time <= frameDuration
  const storyUnavailable = !storyReady || storyFailed || recovering
  const fallback = !motionAdmitted || reducedMotion || (idle && idleSrc
    ? !idleReady || idleFailed : storyUnavailable)
  desiredRef.current = time

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const admit = () => { if (!media.matches) setMotionAdmitted(true) }
    admit(); media.addEventListener('change', admit)
    return () => media.removeEventListener('change', admit)
  }, [])

  useEffect(() => {
    if (motionAdmitted && !reducedMotion && (!idleSrc || time > frameDuration)) setStoryRequested(true)
  }, [motionAdmitted, reducedMotion, time, idleSrc, frameDuration])

  const settle = useCallback((video: HTMLVideoElement) => {
    if (video.readyState < 2 || video.seeking) return
    const target = Math.max(0, Math.min(desiredRef.current, video.duration - frameDuration))
    if (Math.abs(video.currentTime - target) < frameDuration) {
      setStoryReady(true)
      setRecovering(false)
    }
    if (lastSettledRef.current === null ||
      Math.abs(video.currentTime - lastSettledRef.current) >= frameDuration) {
      lastSettledRef.current = video.currentTime
      setProgress(value => value + 1)
    }
    onTimeSettled(video.currentTime)
  }, [frameDuration, onTimeSettled])

  const seekLatest = useCallback(() => {
    const video = videoRef.current
    if (!video || video.readyState < 1 || video.seeking || reducedMotion ||
      storyFailed || !isVisible) return
    video.pause()
    if (!Number.isFinite(video.duration) || video.duration <= 0) return
    const target = Math.max(0, Math.min(desiredRef.current, video.duration - frameDuration))
    if (Math.abs(video.currentTime - target) < frameDuration) {
      settle(video)
      return
    }
    try { video.currentTime = target } catch { setStoryFailed(true) }
  }, [storyFailed, isVisible, settle, reducedMotion, frameDuration])

  useEffect(() => { seekLatest() }, [seekLatest, time, storyRequested])
  useEffect(() => { onFailureChange(storyFailed) }, [storyFailed, onFailureChange])
  useEffect(() => { onAvailabilityChange?.(storyUnavailable) }, [storyUnavailable, onAvailabilityChange])
  useEffect(() => {
    const video = videoRef.current
    if (progressSeenRef.current !== progress) {
      progressSeenRef.current = progress
      waitRemainingRef.current = 5000
    }
    if (!video || !storyReady || storyFailed || recovering) return
    const target = Math.max(0, Math.min(time, video.duration - frameDuration))
    if (!video.seeking && video.readyState >= 2 &&
      Math.abs(video.currentTime - target) < frameDuration) {
      waitRemainingRef.current = 5000
      return
    }
    if (!isVisible || reducedMotion || (idle && idleSrc)) return
    // New scroll targets spend the same budget until a decoded frame advances.
    const started = performance.now()
    const timer = window.setTimeout(() => setRecovering(true), waitRemainingRef.current)
    return () => {
      window.clearTimeout(timer)
      waitRemainingRef.current = Math.max(0, waitRemainingRef.current - (performance.now() - started))
    }
  }, [time, progress, storyReady, storyFailed, recovering, isVisible, reducedMotion, idle, idleSrc, frameDuration])
  useEffect(() => {
    const video = idleRef.current
    if (!video) return
    let active = true
    if (idle && idleReady && isVisible && motionAdmitted && !reducedMotion && !idleFailed && !idlePaused) {
      void video.play().catch(() => { if (active) setIdleFailed(true) })
    } else video.pause()
    return () => { active = false; video.pause() }
  }, [idle, idleReady, idleFailed, isVisible, motionAdmitted, reducedMotion, idlePaused])

  useEffect(() => {
    const video = videoRef.current
    return () => video?.pause()
  }, [])

  const handleSeeked = () => {
    const video = videoRef.current
    if (!video) return
    settle(video)
    seekLatest()
  }

  return children({
    idle, fallback, storyRequested, storyUnavailable,
    storyState: storyFailed ? 'failed' : storyReady ? 'ready' : 'loading',
    idleState: !idleSrc ? 'absent' : idleFailed ? 'failed' : idleReady ? 'ready' : 'loading',
    storyVideoProps: {
      ref: videoRef, src: storyRequested ? storySrc : undefined,
      poster: storyPoster, muted: true, playsInline: true,
      preload: storyRequested ? 'auto' : 'none', tabIndex: -1,
      'data-visible': (!idle || !idleSrc) && !fallback,
      onLoadedMetadata: seekLatest, onLoadedData: seekLatest,
      onSeeked: handleSeeked, onError: () => setStoryFailed(true),
    },
    idleVideoProps: idleSrc ? {
      ref: idleRef, src: motionAdmitted ? idleSrc : undefined, poster: idlePoster, muted: true,
      playsInline: true, loop: true, preload: motionAdmitted ? 'auto' : 'none', tabIndex: -1,
      'data-visible': idle && !fallback,
      onLoadedData: () => setIdleReady(true), onError: () => setIdleFailed(true),
    } : null,
  })
}
