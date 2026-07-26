'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { StudioContainer } from '@/components/design-system'
import { Button } from '@/components/ui/button'
import type { PublicMainAdCarouselItem } from '@/lib/main-ad-carousel'

interface MainAdCarouselProps {
  items: PublicMainAdCarouselItem[]
}

function MainAdLink({
  href,
  children,
  className,
  ariaLabel,
}: {
  href: string
  children: ReactNode
  className: string
  ariaLabel: string
}) {
  if (href.startsWith('/')) {
    return (
      <Link href={href} className={className} aria-label={ariaLabel}>
        {children}
      </Link>
    )
  }

  return (
    <a href={href} className={className} aria-label={ariaLabel}>
      {children}
    </a>
  )
}

function ProgressFill({
  durationSeconds,
}: {
  durationSeconds: number
}) {
  const [running, setRunning] = useState(false)

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setRunning(true)
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [])

  return (
    <span
      aria-hidden="true"
      className="absolute inset-0 origin-left bg-[var(--studio-border)]"
      style={{
        transform: running ? 'scaleX(1)' : 'scaleX(0)',
        transitionDuration: `${durationSeconds}s`,
        transitionProperty: 'transform',
        transitionTimingFunction: 'linear',
      }}
    />
  )
}

export function MainAdCarousel({ items }: MainAdCarouselProps) {
  const activeItems = items
  const [activeIndex, setActiveIndex] = useState(0)
  const [timerKey, setTimerKey] = useState(0)
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const resolvedActiveIndex = activeIndex < activeItems.length ? activeIndex : 0
  const activeItem = activeItems[resolvedActiveIndex]

  useEffect(() => {
    if (!activeItem || activeItems.length <= 1) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setActiveIndex((current) => (current + 1) % activeItems.length)
      setTimerKey((current) => current + 1)
    }, activeItem.durationSeconds * 1000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [activeItem, activeItems.length, timerKey])

  useEffect(() => {
    if (activeItem) {
      itemRefs.current[activeItem.id]?.scrollIntoView({
        block: 'nearest',
      })
    }
  }, [activeItem])

  if (!activeItem) {
    return null
  }

  const selectIndex = (index: number) => {
    setActiveIndex(index)
    setTimerKey((current) => current + 1)
  }

  const move = (direction: 'previous' | 'next') => {
    const offset = direction === 'previous' ? -1 : 1
    const nextIndex = (resolvedActiveIndex + offset + activeItems.length) % activeItems.length
    selectIndex(nextIndex)
  }

  return (
    <section className="border-b border-[var(--studio-border)] bg-[var(--studio-surface)] py-6 sm:py-8">
      <StudioContainer>
        <div className="relative h-[220px] overflow-hidden rounded-xl border border-[var(--studio-border)] bg-[var(--studio-background)] sm:h-[300px] min-[641px]:h-[360px]">
          <div className="hidden min-[1080px]:absolute min-[1080px]:inset-y-0 min-[1080px]:left-0 min-[1080px]:z-10 min-[1080px]:flex min-[1080px]:w-[200px] min-[1080px]:flex-col min-[1080px]:overflow-y-auto min-[1080px]:border-r min-[1080px]:border-[var(--studio-border)] min-[1080px]:bg-[var(--studio-surface)] min-[1200px]:w-60">
            {activeItems.map((item, index) => {
              const selected = index === resolvedActiveIndex

              return (
                <button
                  key={item.id}
                  ref={(node) => {
                    itemRefs.current[item.id] = node
                  }}
                  type="button"
                  aria-current={selected ? 'true' : undefined}
                  className="relative flex min-h-[60px] w-full shrink-0 items-center overflow-hidden border-b border-[var(--studio-border)] px-4 text-left outline-none transition-colors last:border-b-0 hover:bg-[var(--studio-background)] focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--studio-focus-ring)]"
                  onClick={() => selectIndex(index)}
                >
                  {selected && activeItems.length > 1 ? (
                    <ProgressFill
                      key={`${item.id}-${timerKey}`}
                      durationSeconds={item.durationSeconds}
                    />
                  ) : null}
                  <span className="relative z-10 break-keep text-sm font-semibold leading-5 text-[var(--studio-text)]">
                    {item.title}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="relative h-full min-[1080px]:ml-[200px] min-[1200px]:ml-60">
            <MainAdLink
              href={activeItem.href}
              ariaLabel={`${activeItem.title} 바로가기`}
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

            <div className="absolute bottom-0 left-0 flex min-h-11 items-center overflow-hidden rounded-tr-lg bg-black/60 text-white min-[641px]:left-auto min-[641px]:right-0 min-[641px]:rounded-tr-none min-[641px]:rounded-tl-lg">
              {activeItems.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="hidden h-11 w-11 rounded-none text-white hover:bg-white/10 hover:text-white min-[1200px]:inline-flex"
                  aria-label="이전 광고"
                  onClick={() => move('previous')}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : null}
              <span className="min-w-[62px] px-3 text-center text-xs font-bold">
                {resolvedActiveIndex + 1} / {activeItems.length}
              </span>
              {activeItems.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="hidden h-11 w-11 rounded-none text-white hover:bg-white/10 hover:text-white min-[1200px]:inline-flex"
                  aria-label="다음 광고"
                  onClick={() => move('next')}
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </StudioContainer>
    </section>
  )
}
