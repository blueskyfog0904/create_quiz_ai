'use client'

import * as React from 'react'
import { CircleHelp } from 'lucide-react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ADMIN_UNAVAILABLE_TEXT, type AdminDelta } from '@/lib/admin-format'
import type { AdminTone } from '@/lib/admin-status-tone'
import { cn } from '@/lib/utils'

import { ADMIN_TONE_TEXT_CLASSES } from './admin-tone-classes'

interface AdminMetricCardProps {
  title: string
  // 큰 값(이미 formatWon 등으로 만든 글). valueUnavailable 이면 '확인 불가'.
  value: React.ReactNode
  valueUnavailable?: boolean
  // 증감 줄(formatDelta 결과). 큰 값과 따로 '확인 불가'가 될 수 있다.
  delta?: AdminDelta
  // 비교 범위 글(예: '지난 7일 대비')
  deltaRangeLabel?: string
  // 증감 색. 주지 않으면 늘면 초록·줄면 빨강(21번 규칙).
  deltaTone?: AdminTone
  // 보조 줄
  sub?: React.ReactNode
  // 설명 말풍선(선택). 키보드로 열린다.
  help?: React.ReactNode
  // 누를 수 있는 카드: 누르면 화면이 고른 카드를 바꾼다.
  pressed?: boolean
  onPress?: () => void
  className?: string
}

const DELTA_SYMBOL = { up: '▲', down: '▼' } as const
const DELTA_SPOKEN = { up: '증가', down: '감소' } as const

function defaultDeltaTone(delta: AdminDelta): AdminTone {
  if (delta.direction === 'up') return 'success'
  if (delta.direction === 'down') return 'danger'
  return 'neutral'
}

// 지표 카드(20번 5-2). 바깥은 div, 누르는 영역(제목·큰 값·증감 줄)만 button.
// 말풍선 단추는 그 button 의 형제다(button 안에 button·a 를 두지 않는다).
export function AdminMetricCard({
  title,
  value,
  valueUnavailable = false,
  delta,
  deltaRangeLabel,
  deltaTone,
  sub,
  help,
  pressed,
  onPress,
  className,
}: AdminMetricCardProps) {
  const body = (
    <>
      <span className="block break-keep pr-10 text-sm font-medium text-[var(--studio-muted)]">{title}</span>
      <span className="mt-2 block text-2xl font-bold tabular-nums text-[var(--studio-ink)]">
        {valueUnavailable ? ADMIN_UNAVAILABLE_TEXT : value}
      </span>
      {delta ? (
        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs">
          {delta.direction === 'unavailable' ? (
            <span className="text-[var(--studio-muted)]">{ADMIN_UNAVAILABLE_TEXT}</span>
          ) : (
            <span className={cn('font-semibold tabular-nums', ADMIN_TONE_TEXT_CLASSES[deltaTone ?? defaultDeltaTone(delta)])}>
              {delta.direction === 'up' || delta.direction === 'down' ? (
                <>
                  <span aria-hidden="true">{DELTA_SYMBOL[delta.direction]} </span>
                  <span className="sr-only">{DELTA_SPOKEN[delta.direction]} </span>
                </>
              ) : null}
              {delta.text}
            </span>
          )}
          {deltaRangeLabel ? <span className="text-[var(--studio-muted)]">{deltaRangeLabel}</span> : null}
        </span>
      ) : null}
    </>
  )

  return (
    <div
      className={cn(
        'relative rounded-[var(--studio-radius-card)] border bg-[var(--studio-surface)]',
        pressed ? 'border-[var(--studio-primary)] ring-1 ring-[var(--studio-primary)]' : 'border-[var(--studio-border)]',
        className
      )}
    >
      {onPress ? (
        <button
          type="button"
          aria-pressed={pressed ?? false}
          onClick={onPress}
          className="block w-full rounded-[var(--studio-radius-card)] p-4 text-left outline-none hover:bg-[var(--studio-background)] focus-visible:ring-[3px] focus-visible:ring-[var(--studio-focus-ring)]"
        >
          {body}
        </button>
      ) : (
        <div className="p-4">{body}</div>
      )}
      {sub ? <div className="px-4 pb-4 text-xs text-[var(--studio-muted)]">{sub}</div> : null}
      {help ? (
        <Popover>
          <PopoverTrigger
            aria-label={`${title} 설명`}
            className="absolute right-0 top-0 inline-flex size-11 items-center md:right-2 md:top-2 md:size-8 justify-center rounded-full text-[var(--studio-muted)] outline-none hover:text-[var(--studio-primary)] focus-visible:ring-[3px] focus-visible:ring-[var(--studio-focus-ring)]"
          >
            <CircleHelp aria-hidden="true" className="size-4" />
          </PopoverTrigger>
          <PopoverContent align="end" className="break-keep text-sm leading-6">
            {help}
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  )
}

// 카드 1~4장 격자. 권한 없는 카드는 화면이 넣지 않는다(빠진 만큼 자리가 줄어든다).
export function AdminMetricGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-3', className)}>{children}</div>
}
