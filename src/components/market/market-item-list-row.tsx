'use client'

import type { MouseEvent } from 'react'
import Link from 'next/link'
import { FileImage, Star } from 'lucide-react'
import type { MarketSearchRow } from '@/lib/market-search-server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface MarketItemListRowProps {
  row: MarketSearchRow
  subject: WorkspaceSubject
  onSamplePrefetch: (itemId: string) => void
  onSampleOpen: (event: MouseEvent<HTMLButtonElement>, itemId: string) => void
}

// 솔북 카테고리 페이지식 한 줄 리스트 행: 썸네일 | 제목·카테고리·가격 | 문항/유형 배지 | 샘플 보기
export function MarketItemListRow({ row, subject, onSamplePrefetch, onSampleOpen }: MarketItemListRowProps) {
  return (
    <li className="relative flex items-start gap-4 py-5 sm:items-center sm:gap-5">
      {row.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- 어드민이 등록한 외부 썸네일 URL을 그대로 사용
        <img
          src={row.thumbnailUrl}
          alt=""
          loading="lazy"
          className="h-[96px] w-[72px] shrink-0 rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] object-contain"
        />
      ) : (
        <div className="flex h-[96px] w-[72px] shrink-0 items-center justify-center rounded-[var(--studio-radius-control)] border border-dashed border-[var(--studio-border)] bg-[var(--studio-background)] text-[var(--studio-muted)]">
          <FileImage aria-hidden="true" className="h-5 w-5" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <h2>
          {row.categorySlug ? (
            <Link
              href={`/preview/solvook-concept/boards/${row.categorySlug}/items/${row.itemId}?subject=${subject}`}
              className="break-keep text-base font-semibold leading-6 text-[var(--studio-ink)] outline-none after:absolute after:inset-0 hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
            >
              {row.title}
            </Link>
          ) : (
            <span className="break-keep text-base font-semibold leading-6 text-[var(--studio-ink)]">
              {row.title}
            </span>
          )}
        </h2>
        <p className="mt-1 text-sm text-[var(--studio-muted)]">{row.categoryTitle}</p>
        {(row.minPriceCredits !== null || typeof row.ratingCount === 'number') && (
          <p className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {row.minPriceCredits !== null && (
              <span className="[font-family:var(--studio-font-price)] text-base font-bold text-[var(--studio-text)]">
                {row.minPriceCredits.toLocaleString()} 크레딧
              </span>
            )}
            {typeof row.ratingCount === 'number' && (
              <span className="inline-flex items-center gap-1 text-sm text-[var(--studio-muted)]">
                <Star aria-hidden="true" className="h-4 w-4 fill-amber-400 text-amber-400" />
                <span className="font-semibold text-[var(--studio-text)]">
                  {(row.ratingAverage ?? 0).toFixed(1)}
                </span>
                ({row.ratingCount.toLocaleString()})
              </span>
            )}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:hidden">
          {row.questionCount ? (
            <span className="inline-flex items-center rounded bg-[var(--studio-primary-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--studio-primary)]">
              {row.questionCount}문항
            </span>
          ) : null}
          {row.typeNames.map((name) => (
            <span
              key={name}
              className="inline-flex items-center rounded border border-[var(--studio-border)] bg-[var(--studio-background)] px-2 py-0.5 text-xs text-[var(--studio-muted)]"
            >
              {name}
            </span>
          ))}
        </div>
      </div>

      <div className="hidden w-32 shrink-0 flex-col items-center gap-1.5 sm:flex">
        {row.questionCount ? (
          <span className="inline-flex items-center rounded bg-[var(--studio-primary-soft)] px-2.5 py-0.5 text-sm font-semibold text-[var(--studio-primary)]">
            {row.questionCount}문항
          </span>
        ) : null}
        {row.typeNames.map((name) => (
          <span
            key={name}
            className="inline-flex items-center rounded border border-[var(--studio-border)] bg-[var(--studio-background)] px-2 py-0.5 text-xs text-[var(--studio-muted)]"
          >
            {name}
          </span>
        ))}
      </div>

      {row.sampleAvailable && (
        <div className="shrink-0 self-center">
          <button
            type="button"
            onFocus={() => onSamplePrefetch(row.itemId)}
            onMouseEnter={() => onSamplePrefetch(row.itemId)}
            onClick={(event) => onSampleOpen(event, row.itemId)}
            className="relative z-10 inline-flex min-h-9 items-center justify-center rounded-md border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-4 text-sm font-semibold text-[var(--studio-muted)] outline-none transition-colors hover:border-[var(--studio-ink)] hover:text-[var(--studio-ink)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
          >
            샘플 보기
          </button>
        </div>
      )}
    </li>
  )
}
