'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type TransitionEvent,
} from 'react'
import Link from 'next/link'
import {
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { StudioContainer } from '@/components/design-system'
import { Button } from '@/components/ui/button'
import type { PublicMainAdCarouselItem } from '@/lib/main-ad-carousel'
import type { MarketHomeMenuEntry } from '@/lib/market-home'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { ProblemMarketMenu } from '../ProblemMarketMenu'

interface MainAdCarouselProps {
  subject: WorkspaceSubject
  items: PublicMainAdCarouselItem[]
  categories: MarketHomeMenuEntry[]
}

type SlideDirection = 'previous' | 'next'

interface TransitionState {
  fromIndex: number
  toIndex: number
  direction: SlideDirection
  isRunning: boolean
  token: number
}

const SLIDE_DURATION_MS = 450
const SLIDE_FALLBACK_MS = SLIDE_DURATION_MS + 80

function getPerformanceNow() {
  return performance.now()
}

function MainAdLink({
  href,
  children,
  className,
  ariaLabel,
  tabIndex,
  ariaHidden,
}: {
  href: string
  children: ReactNode
  className: string
  ariaLabel: string
  tabIndex?: number
  ariaHidden?: true
}) {
  if (href.startsWith('/')) {
    return (
      <Link href={href} className={className} aria-label={ariaLabel} tabIndex={tabIndex} aria-hidden={ariaHidden}>
        {children}
      </Link>
    )
  }

  return (
    <a href={href} className={className} aria-label={ariaLabel} tabIndex={tabIndex} aria-hidden={ariaHidden}>
      {children}
    </a>
  )
}

function subscribeToDocumentVisibility(onStoreChange: () => void) {
  document.addEventListener('visibilitychange', onStoreChange)
  return () => document.removeEventListener('visibilitychange', onStoreChange)
}

function subscribeToReducedMotion(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  mediaQuery.addEventListener('change', onStoreChange)
  return () => mediaQuery.removeEventListener('change', onStoreChange)
}

export function MainAdCarousel({ subject, items, categories }: MainAdCarouselProps) {
  const activeItems = items
  const carouselState = activeItems.length === 0
    ? 'empty'
    : activeItems.length === 1
      ? 'single'
      : 'multiple'
  const subjectLabel = subject === 'korean' ? '국어' : '영어'
  const marketHref = categories[0]
    ? `/${subject}/market/${categories[0].slug}`
    : `/${subject}/market`
  const [activeIndex, setActiveIndex] = useState(0)
  const [cycleKey, setCycleKey] = useState(0)
  const [transitionState, setTransitionState] = useState<TransitionState | null>(null)
  const isDocumentHidden = useSyncExternalStore(
    subscribeToDocumentVisibility,
    () => document.hidden,
    () => false
  )
  const prefersReducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false
  )
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const progressLayerRefs = useRef<Record<string, HTMLSpanElement | null>>({})
  const progressStartFrameRef = useRef<number | null>(null)
  const progressCompleteTimeoutRef = useRef<number | null>(null)
  const autoAdvanceFrameRef = useRef<number | null>(null)
  const settleTimeoutRef = useRef<number | null>(null)
  const transitionStartFrameRef = useRef<number | null>(null)
  const transitionTokenRef = useRef(0)
  const transitionRef = useRef<TransitionState | null>(null)
  const clockRef = useRef({
    startedAt: 0,
    elapsedMs: 0,
    durationMs: 0,
  })
  const itemsSignature = activeItems
    .map((item) => [
      item.id,
      item.title,
      item.href,
      item.alt,
      item.pcImageUrl,
      item.mobileImageUrl ?? '',
      item.durationSeconds,
    ].join('\u001f'))
    .join('\u001e')
  const [renderedItemsSignature, setRenderedItemsSignature] = useState(itemsSignature)
  const previousItemsSignatureRef = useRef(itemsSignature)
  const itemsHaveChanged = renderedItemsSignature !== itemsSignature

  if (itemsHaveChanged) {
    setRenderedItemsSignature(itemsSignature)
    setActiveIndex(0)
    setTransitionState(null)
  }

  const resolvedActiveIndex = activeItems.length === 0
    ? 0
    : itemsHaveChanged
      ? 0
      : Math.min(activeIndex, activeItems.length - 1)
  const activeItem = activeItems[resolvedActiveIndex]
  const hasMultipleItems = activeItems.length > 1
  const isTransitioning = !itemsHaveChanged && transitionState !== null
  const isInteractionLocked = isTransitioning
  const isCyclePaused = isDocumentHidden

  const clearProgressStartFrame = useCallback(() => {
    if (progressStartFrameRef.current !== null) {
      window.cancelAnimationFrame(progressStartFrameRef.current)
      progressStartFrameRef.current = null
    }
  }, [])

  const clearProgressCompleteTimeout = useCallback(() => {
    if (progressCompleteTimeoutRef.current !== null) {
      window.clearTimeout(progressCompleteTimeoutRef.current)
      progressCompleteTimeoutRef.current = null
    }
  }, [])

  const clearAutoAdvanceFrame = useCallback(() => {
    if (autoAdvanceFrameRef.current !== null) {
      window.cancelAnimationFrame(autoAdvanceFrameRef.current)
      autoAdvanceFrameRef.current = null
    }
  }, [])

  const clearSettleTimeout = useCallback(() => {
    if (settleTimeoutRef.current !== null) {
      window.clearTimeout(settleTimeoutRef.current)
      settleTimeoutRef.current = null
    }
  }, [])

  const clearTransitionStartFrame = useCallback(() => {
    if (transitionStartFrameRef.current !== null) {
      window.cancelAnimationFrame(transitionStartFrameRef.current)
      transitionStartFrameRef.current = null
    }
  }, [])

  const clearProgressScheduling = useCallback(() => {
    clearProgressStartFrame()
    clearProgressCompleteTimeout()
    clearAutoAdvanceFrame()
  }, [clearAutoAdvanceFrame, clearProgressCompleteTimeout, clearProgressStartFrame])

  const syncProgressLayers = useCallback((progress: number) => {
    const activeItemId = activeItem?.id

    for (const [itemId, layer] of Object.entries(progressLayerRefs.current)) {
      if (!layer) {
        continue
      }

      layer.style.transition = 'none'
      layer.style.transform = itemId === activeItemId ? `scaleX(${progress})` : 'scaleX(0)'
    }
  }, [activeItem?.id])

  const resetClock = useCallback(() => {
    clockRef.current.startedAt = 0
    clockRef.current.elapsedMs = 0
    clockRef.current.durationMs = activeItem ? activeItem.durationSeconds * 1000 : 0
    setCycleKey((current) => current + 1)
  }, [activeItem])

  const finishTransition = useCallback((token: number) => {
    const currentTransition = transitionRef.current

    if (!currentTransition || currentTransition.token !== token) {
      return
    }

    clearSettleTimeout()
    transitionRef.current = null
    setTransitionState(null)
    setActiveIndex(currentTransition.toIndex)
    resetClock()
  }, [clearSettleTimeout, resetClock])

  const startTransition = useCallback((nextIndex: number, direction: SlideDirection) => {
    clearProgressScheduling()
    clearSettleTimeout()
    clearTransitionStartFrame()

    if (nextIndex === resolvedActiveIndex) {
      setTransitionState(null)
      transitionRef.current = null
      resetClock()
      return
    }

    if (prefersReducedMotion || activeItems.length <= 1) {
      setTransitionState(null)
      transitionRef.current = null
      setActiveIndex(nextIndex)
      clockRef.current.startedAt = 0
      clockRef.current.elapsedMs = 0
      clockRef.current.durationMs = 0
      setCycleKey((current) => current + 1)
      return
    }

    syncProgressLayers(1)

    const token = transitionTokenRef.current + 1
    transitionTokenRef.current = token
    const nextTransition = {
      fromIndex: resolvedActiveIndex,
      toIndex: nextIndex,
      direction,
      isRunning: false,
      token,
    }

    transitionRef.current = nextTransition
    setTransitionState(nextTransition)
    transitionStartFrameRef.current = window.requestAnimationFrame(() => {
      transitionStartFrameRef.current = null
      setTransitionState((currentTransition) => {
        if (!currentTransition || currentTransition.token !== token) {
          return currentTransition
        }

        const runningTransition = {
          ...currentTransition,
          isRunning: true,
        }

        transitionRef.current = runningTransition
        return runningTransition
      })
    })
    settleTimeoutRef.current = window.setTimeout(() => {
      finishTransition(token)
    }, SLIDE_FALLBACK_MS)
  }, [
    activeItems.length,
    clearProgressScheduling,
    clearSettleTimeout,
    clearTransitionStartFrame,
    finishTransition,
    prefersReducedMotion,
    resetClock,
    resolvedActiveIndex,
    syncProgressLayers,
  ])

  function selectIndex(nextIndex: number) {
    if (nextIndex === resolvedActiveIndex) {
      startTransition(nextIndex, 'next')
      return
    }

    startTransition(nextIndex, nextIndex > resolvedActiveIndex ? 'next' : 'previous')
  }

  function move(direction: SlideDirection) {
    const offset = direction === 'previous' ? -1 : 1
    const nextIndex = (resolvedActiveIndex + offset + activeItems.length) % activeItems.length
    startTransition(nextIndex, direction)
  }

  function handleTransitionEnd(event: TransitionEvent<HTMLDivElement>, token: number) {
    if (event.propertyName !== 'transform') {
      return
    }

    if (event.target !== event.currentTarget) {
      return
    }

    if (transitionRef.current?.token !== token) {
      return
    }

    finishTransition(token)
  }

  useEffect(() => {
    return () => {
      if (progressStartFrameRef.current !== null) {
        window.cancelAnimationFrame(progressStartFrameRef.current)
      }

      if (progressCompleteTimeoutRef.current !== null) {
        window.clearTimeout(progressCompleteTimeoutRef.current)
      }

      if (autoAdvanceFrameRef.current !== null) {
        window.cancelAnimationFrame(autoAdvanceFrameRef.current)
      }

      if (settleTimeoutRef.current !== null) {
        window.clearTimeout(settleTimeoutRef.current)
      }

      if (transitionStartFrameRef.current !== null) {
        window.cancelAnimationFrame(transitionStartFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    transitionRef.current = transitionState
  }, [transitionState])

  useLayoutEffect(() => {
    if (previousItemsSignatureRef.current === itemsSignature) {
      return
    }

    previousItemsSignatureRef.current = itemsSignature
    clearProgressScheduling()
    clearSettleTimeout()
    clearTransitionStartFrame()
    transitionTokenRef.current += 1
    transitionRef.current = null
    clockRef.current.startedAt = 0
    clockRef.current.elapsedMs = 0
    clockRef.current.durationMs = 0
    syncProgressLayers(0)
  }, [
    clearProgressScheduling,
    clearSettleTimeout,
    clearTransitionStartFrame,
    itemsSignature,
    syncProgressLayers,
  ])

  useEffect(() => {
    if (activeItem) {
      itemRefs.current[activeItem.id]?.scrollIntoView({
        block: 'nearest',
      })
    }
  }, [activeItem])

  useEffect(() => {
    if (!activeItem) {
      return
    }

    clockRef.current.durationMs = activeItem.durationSeconds * 1000

    if (!hasMultipleItems || prefersReducedMotion) {
      clearProgressScheduling()
      clockRef.current.startedAt = 0
      clockRef.current.elapsedMs = 0
      syncProgressLayers(0)
      return
    }

    if (isTransitioning) {
      clearProgressScheduling()
      clockRef.current.startedAt = 0
      clockRef.current.elapsedMs = clockRef.current.durationMs
      syncProgressLayers(1)
      return
    }

    const durationMs = clockRef.current.durationMs

    if (isCyclePaused) {
      if (clockRef.current.startedAt !== 0) {
        clockRef.current.elapsedMs = Math.min(durationMs, Math.max(0, getPerformanceNow() - clockRef.current.startedAt))
        clockRef.current.startedAt = 0
      }

      clearProgressScheduling()
      syncProgressLayers(durationMs === 0 ? 1 : clockRef.current.elapsedMs / durationMs)
      return
    }

    if (clockRef.current.startedAt === 0) {
      clockRef.current.startedAt = getPerformanceNow() - clockRef.current.elapsedMs
    }

    const remainingMs = Math.max(durationMs - clockRef.current.elapsedMs, 0)
    const currentProgress = durationMs === 0 ? 1 : clockRef.current.elapsedMs / durationMs

    clearProgressScheduling()
    syncProgressLayers(currentProgress)

    if (remainingMs === 0) {
      syncProgressLayers(1)
      autoAdvanceFrameRef.current = window.requestAnimationFrame(() => {
        autoAdvanceFrameRef.current = null

        if (transitionRef.current || prefersReducedMotion || isCyclePaused || activeItems.length <= 1) {
          return
        }

        startTransition((resolvedActiveIndex + 1) % activeItems.length, 'next')
      })

      return () => {
        clearProgressScheduling()
      }
    }

    progressStartFrameRef.current = window.requestAnimationFrame(() => {
      progressStartFrameRef.current = null
      const layer = progressLayerRefs.current[activeItem.id]

      if (!layer) {
        return
      }

      layer.style.transition = `transform ${remainingMs}ms linear`
      layer.style.transform = 'scaleX(1)'
    })

    progressCompleteTimeoutRef.current = window.setTimeout(() => {
      progressCompleteTimeoutRef.current = null
      clockRef.current.startedAt = 0
      clockRef.current.elapsedMs = durationMs
      syncProgressLayers(1)
      autoAdvanceFrameRef.current = window.requestAnimationFrame(() => {
        autoAdvanceFrameRef.current = null

        if (transitionRef.current || prefersReducedMotion || isCyclePaused || activeItems.length <= 1) {
          return
        }

        startTransition((resolvedActiveIndex + 1) % activeItems.length, 'next')
      })
    }, remainingMs)

    return () => {
      clearProgressScheduling()
    }
  }, [
    activeIndex,
    activeItem,
    activeItems.length,
    clearProgressScheduling,
    cycleKey,
    hasMultipleItems,
    isCyclePaused,
    isTransitioning,
    itemsSignature,
    prefersReducedMotion,
    resolvedActiveIndex,
    startTransition,
    syncProgressLayers,
  ])

  const activeTransition = itemsHaveChanged ? null : transitionState
  const outgoingItem = activeTransition ? activeItems[activeTransition.fromIndex] : null
  const incomingItem = activeTransition ? activeItems[activeTransition.toIndex] : null

  return (
    <section
      data-slot="main-ad-carousel"
      data-state={carouselState}
      className="border-b border-[var(--studio-border)] bg-[var(--studio-surface)] py-6 sm:py-8"
    >
      <StudioContainer className="relative">
        <ProblemMarketMenu
          subject={subject}
          entries={categories.map((category) => ({
            id: category.id,
            title: category.title,
            href: `/preview/solvook-concept/boards/${category.slug}?subject=${subject}`,
          }))}
          className="mb-3 p-5 min-[1720px]:absolute min-[1720px]:inset-y-0 min-[1720px]:left-6 min-[1720px]:mb-0 min-[1720px]:-ml-3 min-[1720px]:w-56 min-[1720px]:-translate-x-full"
        />

        <div className="relative h-[220px] overflow-hidden rounded-xl border border-[var(--studio-border)] bg-[var(--studio-background)] sm:h-[300px] min-[641px]:h-[360px]">
          <div className="hidden min-[1080px]:absolute min-[1080px]:inset-y-0 min-[1080px]:left-0 min-[1080px]:z-10 min-[1080px]:flex min-[1080px]:w-[200px] min-[1080px]:flex-col min-[1080px]:overflow-y-auto min-[1080px]:border-r min-[1080px]:border-[var(--studio-border)] min-[1080px]:bg-[var(--studio-surface)] min-[1200px]:w-60">
            {carouselState === 'empty' ? (
              <div
                aria-hidden="true"
                className="flex min-h-[60px] items-center border-b border-[var(--studio-border)] px-4"
              >
                <span className="break-keep text-sm font-semibold leading-5 text-[var(--studio-muted)]">
                  등록된 광고가 없습니다
                </span>
              </div>
            ) : (
              activeItems.map((item, index) => {
                const selected = index === resolvedActiveIndex

                return (
                  <button
                    key={item.id}
                    ref={(node) => {
                      itemRefs.current[item.id] = node
                    }}
                    type="button"
                    disabled={!hasMultipleItems || isInteractionLocked}
                    aria-current={selected ? 'true' : undefined}
                    className="relative flex min-h-[60px] w-full shrink-0 items-center overflow-hidden border-b border-[var(--studio-border)] px-4 text-left outline-none transition-colors hover:bg-[var(--studio-background)] aria-[current=true]:hover:bg-transparent disabled:cursor-default disabled:opacity-100 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--studio-focus-ring)]"
                    onClick={() => selectIndex(index)}
                  >
                    {hasMultipleItems ? (
                      <span
                        data-slot="main-ad-progress"
                        aria-hidden="true"
                        ref={(node) => {
                          progressLayerRefs.current[item.id] = node
                        }}
                        className="absolute inset-0 bg-[var(--studio-control-border)] opacity-40"
                        style={{
                          transform: 'scaleX(0)',
                          transformOrigin: 'left center',
                        }}
                      />
                    ) : null}
                    <span className="relative z-10 break-keep text-sm font-semibold leading-5 text-[var(--studio-text)]">
                      {item.title}
                    </span>
                  </button>
                )
              })
            )}
          </div>

          <div className="relative h-full min-[1080px]:ml-[200px] min-[1200px]:ml-60">
            {!activeItem ? (
              <div className="flex h-full items-center justify-center px-6 text-center sm:px-10">
                <div role="status" className="max-w-md">
                  <p className="text-lg font-bold text-[var(--studio-text)] sm:text-xl">
                    등록된 {subjectLabel} 광고가 없습니다
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--studio-muted)]">
                    {subjectLabel} 문제마켓에 등록된 수업 자료를 먼저 둘러보세요.
                  </p>
                  <Button asChild className="mt-5 min-h-11">
                    <Link href={marketHref}>{subjectLabel} 문제마켓 보기</Link>
                  </Button>
                </div>
              </div>
            ) : activeTransition && outgoingItem && incomingItem ? (
              <>
                <div
                  className="absolute inset-0"
                  onTransitionEnd={(event) => handleTransitionEnd(event, activeTransition.token)}
                  style={{
                    transform: activeTransition.isRunning
                      ? activeTransition.direction === 'next'
                        ? 'translateX(-100%)'
                        : 'translateX(100%)'
                      : 'translateX(0%)',
                    transitionDuration: `${SLIDE_DURATION_MS}ms`,
                    transitionProperty: 'transform',
                    transitionTimingFunction: 'ease-out',
                  }}
                >
                  <MainAdLink
                    href={outgoingItem.href}
                    ariaLabel={`${outgoingItem.title} 바로가기`}
                    tabIndex={isTransitioning ? -1 : undefined}
                    ariaHidden={isTransitioning ? true : undefined}
                    className="pointer-events-none block h-full w-full outline-none"
                  >
                    <picture className="block h-full w-full">
                      <source
                        media="(max-width: 640px)"
                        srcSet={outgoingItem.mobileImageUrl || outgoingItem.pcImageUrl}
                      />
                      <img
                        src={outgoingItem.pcImageUrl}
                        alt={outgoingItem.alt}
                        className="h-full w-full object-cover"
                      />
                    </picture>
                  </MainAdLink>
                </div>
                <div
                  className="absolute inset-0"
                  onTransitionEnd={(event) => handleTransitionEnd(event, activeTransition.token)}
                  style={{
                    transform: activeTransition.isRunning
                      ? 'translateX(0%)'
                      : activeTransition.direction === 'next'
                        ? 'translateX(100%)'
                        : 'translateX(-100%)',
                    transitionDuration: `${SLIDE_DURATION_MS}ms`,
                    transitionProperty: 'transform',
                    transitionTimingFunction: 'ease-out',
                  }}
                >
                  <MainAdLink
                    href={incomingItem.href}
                    ariaLabel={`${incomingItem.title} 바로가기`}
                    tabIndex={isTransitioning ? -1 : undefined}
                    ariaHidden={isTransitioning ? true : undefined}
                    className="pointer-events-none block h-full w-full outline-none"
                  >
                    <picture className="block h-full w-full">
                      <source
                        media="(max-width: 640px)"
                        srcSet={incomingItem.mobileImageUrl || incomingItem.pcImageUrl}
                      />
                      <img
                        src={incomingItem.pcImageUrl}
                        alt={incomingItem.alt}
                        className="h-full w-full object-cover"
                      />
                    </picture>
                  </MainAdLink>
                </div>
              </>
            ) : (
              <MainAdLink
                href={activeItem.href}
                ariaLabel={`${activeItem.title} 바로가기`}
                tabIndex={isTransitioning ? -1 : undefined}
                ariaHidden={isTransitioning ? true : undefined}
                className="block h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--studio-focus-ring)]"
              >
                <picture className="block h-full w-full">
                  <source
                    media="(max-width: 640px)"
                    srcSet={activeItem.mobileImageUrl || activeItem.pcImageUrl}
                  />
                  <img
                    key={activeItem.id}
                    src={activeItem.pcImageUrl}
                    alt={activeItem.alt}
                    className="h-full w-full object-cover"
                  />
                </picture>
              </MainAdLink>
            )}

            {activeItem && hasMultipleItems ? (
              <div className="absolute bottom-0 left-0 flex min-h-11 items-center overflow-hidden rounded-tr-lg bg-black/60 text-white min-[641px]:left-auto min-[641px]:right-0 min-[641px]:rounded-tr-none min-[641px]:rounded-tl-lg">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={isInteractionLocked}
                  className="h-11 w-11 rounded-none text-white hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                  aria-label="이전 광고"
                  onClick={() => move('previous')}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
                <span className="min-w-[62px] px-3 text-center text-xs font-bold">
                  {resolvedActiveIndex + 1} / {activeItems.length}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={isInteractionLocked}
                  className="h-11 w-11 rounded-none text-white hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                  aria-label="다음 광고"
                  onClick={() => move('next')}
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </StudioContainer>
    </section>
  )
}
