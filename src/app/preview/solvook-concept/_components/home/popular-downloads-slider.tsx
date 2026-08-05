'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { MarketHomePopularItem } from '@/lib/market-home'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { MaterialCover, type MaterialCoverTheme } from './material-cover'
import { SectionHeading } from './section-heading'

interface PopularDownloadsSliderProps {
  subject: WorkspaceSubject
  items: MarketHomePopularItem[]
  rankingWindowDays: number
}

const themes: MaterialCoverTheme[] = ['violet', 'mint', 'coral', 'navy']

export function PopularDownloadsSlider({ subject, items, rankingWindowDays }: PopularDownloadsSliderProps) {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(2)
  const [paused, setPaused] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)')
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      setPageSize(desktop.matches ? 4 : 2)
      setReducedMotion(motion.matches)
    }
    const onVisibility = () => setHidden(document.hidden)
    sync()
    desktop.addEventListener('change', sync)
    motion.addEventListener('change', sync)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      desktop.removeEventListener('change', sync)
      motion.removeEventListener('change', sync)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const pageCount = Math.ceil(items.length / pageSize)
  useEffect(() => {
    if (items.length <= pageSize || paused || hidden || reducedMotion) return
    const timer = window.setInterval(() => setPage((current) => (current + 1) % pageCount), 5000)
    return () => window.clearInterval(timer)
  }, [hidden, items.length, pageCount, pageSize, paused, reducedMotion])

  const resolvedPage = Math.min(page, Math.max(pageCount - 1, 0))
  const visibleItems = items.slice(resolvedPage * pageSize, resolvedPage * pageSize + pageSize)

  return (
    <section
      id="popular-downloads"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false)
      }}
    >
      {/* viewport 320, viewport 390, viewport 768: 2 cards; viewport 1200, viewport 1280: 4 cards */}
      <SectionHeading
        eyebrow="TEACHER'S PICK"
        title="인기 다운로드 자료"
        description={`최근 ${rankingWindowDays}일 다운로드 URL 발급 사용자 기준`}
      />
      {items.length === 0 ? (
        <div className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] px-5 py-12 text-center text-sm text-[var(--studio-muted)]">
          아직 다운로드 집계가 없습니다.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
            {visibleItems.map((item, index) => (
              <article key={item.id} className="min-w-0">
                <Link href={`/${subject}/market/${item.categorySlug}/items/${item.id}`} className="group block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] focus-visible:ring-offset-4">
                  <div className="aspect-[4/5] overflow-hidden rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] p-2 transition group-hover:-translate-y-1 group-hover:border-[var(--studio-primary-border)] group-hover:shadow-md sm:p-3">
                    <MaterialCover cover={{ eyebrow: `${resolvedPage * pageSize + index + 1}위 · ${item.categoryTitle}`, title: item.title, subtitle: item.sourceType ?? '문제마켓 자료', theme: themes[(resolvedPage * pageSize + index) % themes.length] }} />
                  </div>
                  <div className="px-0.5 pt-3">
                    <div className="flex flex-wrap gap-1">
                      <span className="rounded-[4px] bg-[var(--studio-primary-soft)] px-1.5 py-1 text-[9px] font-extrabold text-[var(--studio-primary)] sm:text-[10px]">{item.downloadUserCount}명</span>
                      <span className="rounded-[4px] bg-[#EFF1F5] px-1.5 py-1 text-[9px] font-bold text-[#5C6275] sm:text-[10px]">{item.categoryTitle}</span>
                    </div>
                    <h3 className="mt-2 line-clamp-2 break-keep text-sm font-extrabold leading-5 tracking-[-0.02em] text-[var(--studio-ink)] sm:text-base sm:leading-6">{item.title}</h3>
                    <p className="mt-1 truncate text-[11px] text-[var(--studio-muted)] sm:text-xs">{[item.sourceType, ...item.sources].filter(Boolean).join(' · ') || '출처 정보 없음'}</p>
                    <p className="mt-2 text-[10px] font-semibold text-[var(--studio-muted)] sm:text-xs">문항 {item.questionCount ?? 0}</p>
                  </div>
                </Link>
              </article>
            ))}
          </div>
          {items.length <= pageSize ? null : (
            <div className="mt-6 flex items-center justify-center gap-2">
              <Button type="button" variant="brandOutline" size="icon" aria-label="이전 인기 자료" onClick={() => setPage((current) => (current - 1 + pageCount) % pageCount)}><ChevronLeft aria-hidden="true" /></Button>
              <span className="min-w-14 text-center text-xs font-bold text-[var(--studio-muted)]">{resolvedPage + 1} / {pageCount}</span>
              <Button type="button" variant="brandOutline" size="icon" aria-label="다음 인기 자료" onClick={() => setPage((current) => (current + 1) % pageCount)}><ChevronRight aria-hidden="true" /></Button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
