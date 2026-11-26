'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { formatCount, type AdminNumberValue } from '@/lib/admin-format'
import { updateListQuery } from '@/lib/list-pagination'
import { cn } from '@/lib/utils'

type ListQueryChanges = Record<string, string | number | null>

// 필터 값을 주소에 남긴다(20번 Q5). 키 이름은 화면이 주는 목록 그대로(q·tab·ticket·page 등),
// 주소 고치기는 updateListQuery 규칙 그대로(빈 값·1쪽은 지움). 값 정규화는 화면의 지금 함수가 한다.
// baseQuery: 지금 주소 대신 쓸 기준 쿼리. 서버가 정규화한 값·아는 키만으로 주소를 다시 만들던 화면(예: 회원 목록)은
// 그 값을 넘겨 잘못된 값·모르는 키가 주소에 남지 않게 한다(동작 그대로). 주지 않으면 지금 주소를 이어받는다.
export function useAdminFilterParams<Key extends string>(keys: readonly Key[], options: { baseQuery?: string } = {}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const base = options.baseQuery ?? searchParams.toString()
  const baseParams = new URLSearchParams(base)

  const values = {} as Record<Key, string>
  for (const key of keys) values[key] = baseParams.get(key) ?? ''

  const buildHref = (changes: ListQueryChanges) => {
    const query = updateListQuery(base, changes)
    return query ? `${pathname}?${query}` : pathname
  }

  const push = (changes: ListQueryChanges) => router.push(buildHref(changes))

  // [초기화]: 화면이 준 키만 지운다(쪽 키도 목록에 있으면 함께).
  const resetChanges = Object.fromEntries(keys.map((key) => [key, null])) as ListQueryChanges

  return { values, buildHref, push, resetChanges }
}

interface AdminFilterBarProps {
  // 순서: 검색 → 선택 필터 → 기간
  search?: React.ReactNode
  filters?: React.ReactNode
  period?: React.ReactNode
  // 오른쪽 '결과 n건'. 세지 못했으면 ADMIN_UNAVAILABLE.
  resultCount?: AdminNumberValue
  onReset?: () => void
  resetDisabled?: boolean
  className?: string
}

// 목록 필터 한 줄(20번 5-2). 그리기만 한다.
export function AdminFilterBar({ search, filters, period, resultCount, onReset, resetDisabled, className }: AdminFilterBarProps) {
  const showCount = resultCount !== undefined
  return (
    <div
      role="search"
      className={cn(
        'mb-4 flex flex-wrap items-center gap-2 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-3',
        className
      )}
    >
      {search ? <div className="min-w-0 flex-1 basis-60">{search}</div> : null}
      {filters ? <div className="flex flex-wrap items-center gap-2">{filters}</div> : null}
      {period ? <div className="flex flex-wrap items-center gap-2">{period}</div> : null}
      {showCount || onReset ? (
        <div className="ml-auto flex items-center gap-2">
          {showCount ? (
            <span aria-live="polite" className="whitespace-nowrap text-sm text-[var(--studio-muted)]">
              결과 <span className="tabular-nums">{formatCount(resultCount, '건')}</span>
            </span>
          ) : null}
          {onReset ? (
            <Button type="button" variant="brandGhost" size="sm" onClick={onReset} disabled={resetDisabled}>
              초기화
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
