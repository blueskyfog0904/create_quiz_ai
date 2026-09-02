'use client'

import type { MouseEvent } from 'react'
import Link from 'next/link'
import { FileImage } from 'lucide-react'
import type { MarketSearchRow } from '@/lib/market-search-server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface MarketItemCardProps {
  row: MarketSearchRow
  subject: WorkspaceSubject
  onSamplePrefetch: (itemId: string) => void
  onSampleOpen: (event: MouseEvent<HTMLButtonElement>, itemId: string) => void
}

// /search 카드에서 추출한 공용 상품 카드 — 시각·동작은 검색 카드와 동일하게 유지한다.
export function MarketItemCard({ row, subject, onSamplePrefetch, onSampleOpen }: MarketItemCardProps) {
  return (
    <article
      className="relative flex flex-col rounded-md border border-[var(--studio-border)] bg-[var(--studio-surface)] transition-colors hover:border-[var(--studio-primary-border)]"
    >
      <div className="flex flex-1 gap-4 p-5">
        <div className="flex w-[92px] shrink-0 flex-col gap-2.5">
          {row.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- 어드민이 등록한 외부 썸네일 URL을 그대로 사용
            <img
              src={row.thumbnailUrl}
              alt=""
              loading="lazy"
              className="h-[130px] w-[92px] rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] object-contain"
            />
          ) : (
            <div className="flex h-[130px] w-[92px] items-center justify-center rounded-[var(--studio-radius-control)] border border-dashed border-[var(--studio-border)] bg-[var(--studio-background)] text-[var(--studio-muted)]">
              <FileImage aria-hidden="true" className="h-5 w-5" />
            </div>
          )}
          {row.sampleAvailable && (
            <button
              type="button"
              onFocus={() => onSamplePrefetch(row.itemId)}
              onMouseEnter={() => onSamplePrefetch(row.itemId)}
              onClick={(event) => onSampleOpen(event, row.itemId)}
              className="relative z-10 inline-flex min-h-9 w-full items-center justify-center rounded-md border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-2 text-sm font-semibold text-[var(--studio-muted)] outline-none transition-colors hover:border-[var(--studio-ink)] hover:text-[var(--studio-ink)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
            >
              샘플 보기
            </button>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {row.questionCount ? (
            <span className="inline-flex items-center rounded bg-[var(--studio-primary-soft)] px-2 py-0.5 text-sm font-semibold text-[var(--studio-primary)]">
              {row.questionCount}문항
            </span>
          ) : null}
          <h2 className="mt-1.5">
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
          <p className="mt-1 text-base text-[var(--studio-muted)]">{row.categoryTitle}</p>
          {row.minPriceCredits !== null ? (
            <p className="mt-4 [font-family:var(--studio-font-price)] text-xl font-bold text-[var(--studio-text)]">
              {row.minPriceCredits.toLocaleString()} 크레딧~
            </p>
          ) : null}
        </div>
      </div>

      {row.typeNames.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--studio-border)] px-5 py-3 text-sm text-[var(--studio-muted)]">
          {row.typeNames.map((name, index) => (
            <span key={name} className="flex items-center gap-2">
              {index > 0 && (
                <span aria-hidden="true" className="text-[var(--studio-border)]">
                  |
                </span>
              )}
              {name}
            </span>
          ))}
        </div>
      )}
    </article>
  )
}
