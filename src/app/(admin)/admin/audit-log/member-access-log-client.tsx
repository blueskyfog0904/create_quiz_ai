'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StudioListPagination } from '@/components/design-system/studio-list-pagination'
import { AdminDataTable, type AdminDataTableColumn } from '@/components/admin/kit/admin-data-table'
import { AdminFilterBar } from '@/components/admin/kit/admin-filter-bar'
import { AdminNotice } from '@/components/admin/kit/admin-notice'
import { AdminTableState } from '@/components/admin/kit/admin-table-state'
import { ADMIN_UNAVAILABLE } from '@/lib/admin-format'
import { useListQuery } from '@/hooks/use-list-query'
import { ADMIN_MEMBER_ACCESS_FIELDS, ADMIN_MEMBER_ACCESS_SCREENS } from '@/lib/admin-member-access-log'
import { labelOf } from '@/lib/admin-orders'
import type { AdminMemberAccessLogResult } from '@/lib/admin-member-access-log-view-server'

type AccessLogRow = AdminMemberAccessLogResult['rows'][number]

const FILTER_SELECT_CLASS =
  'h-10 rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm text-[var(--studio-text)] max-sm:w-full'
const FIELD_LABELS: Record<string, string> = ADMIN_MEMBER_ACCESS_FIELDS
const SCREEN_LABELS: Record<string, string> = ADMIN_MEMBER_ACCESS_SCREENS

// 날짜 표기는 지금 모양 그대로(20번: 대표가 바꾸기로 정하기 전까지).
const formatDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'

// 13번 8-3: 개인정보 열람 기록(대표 전용). 목록·필터·쪽은 주소(actor, screen, member, from, to, page, pageSize)가 정하고 서버가 거른다.
// 이메일은 다시 펼치지 않는다: 회원은 표시 이름(앞 3명)과 회원 상세 링크만. 이 탭을 연 것도 서버가 기록한다.
export function MemberAccessLogClient() {
  const listQuery = useListQuery()
  const { page, pageSize, setPage, setPageSize } = listQuery
  const actor = listQuery.params.get('actor') ?? ''
  const screen = listQuery.params.get('screen') ?? ''
  const member = listQuery.params.get('member') ?? ''
  const from = listQuery.params.get('from') ?? ''
  const to = listQuery.params.get('to') ?? ''
  const setFilter = (key: string, value: string) => listQuery.update({ [key]: value, page: 1 })

  const [loaded, setLoaded] = useState<{ key: string; data: AdminMemberAccessLogResult | null; error: string | null } | null>(null)

  const requestParams = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  for (const [key, value] of Object.entries({ actor, screen, member, from, to })) {
    if (value) requestParams.set(key, value)
  }
  const requestKey = requestParams.toString()
  const isLoading = loaded?.key !== requestKey
  const data = isLoading ? null : loaded.data
  const loadError = isLoading ? null : loaded.error

  useEffect(() => {
    let ignore = false
    fetch(`/api/admin/audit-log/access?${requestKey}`)
      .then(async (response) => {
        const result = await response.json().catch(() => null)
        if (!response.ok || !result?.success) throw new Error(result?.error ?? '열람 기록을 불러오지 못했습니다.')
        if (!ignore) setLoaded({ key: requestKey, data: result.data, error: null })
      })
      .catch((error) => {
        // 읽지 못한 것을 "기록 없음"으로 보이지 않게 오류로 알린다.
        if (!ignore) setLoaded({ key: requestKey, data: null, error: error instanceof Error ? error.message : '열람 기록을 불러오지 못했습니다.' })
      })
    return () => {
      ignore = true
    }
  }, [requestKey])

  const hasFilter = Boolean(actor || screen || member || from || to)

  const columns: AdminDataTableColumn<AccessLogRow>[] = [
    { key: 'createdAt', header: '시각', className: 'whitespace-nowrap text-xs text-[var(--studio-muted)]', cell: (row) => formatDateTime(row.createdAt) },
    {
      key: 'actor',
      header: '처리자',
      className: 'text-sm',
      cell: (row) => row.actor ?? <span className="font-mono text-xs text-[var(--studio-muted)]">{row.actorId.slice(0, 8)}</span>,
    },
    { key: 'screen', header: '화면', className: 'text-sm', cell: (row) => labelOf(SCREEN_LABELS, row.screen) },
    {
      key: 'members',
      header: '회원',
      // 회원 표시 이름은 이메일에서 온다(화면 비교 때 가린다).
      pii: true,
      className: 'text-sm',
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {row.members.map((item) => (
            <Link key={item.id} href={`/admin/users/${item.id}`} className="hover:underline">
              {item.withdrawn ? '탈퇴 회원' : item.name ?? item.id.slice(0, 8)}
            </Link>
          ))}
          {row.memberCount > row.members.length && <span className="text-[var(--studio-muted)]">외 {row.memberCount - row.members.length}명</span>}
        </div>
      ),
    },
    { key: 'fields', header: '항목', className: 'text-sm', cell: (row) => row.fields.map((field) => labelOf(FIELD_LABELS, field)).join(', ') || '-' },
    {
      key: 'reason',
      header: '사유',
      className: 'max-w-[12rem] truncate text-sm',
      cell: (row) => <span title={row.reason ?? undefined}>{row.reason ?? '-'}</span>,
    },
    // IP 는 화면 비교 때 가린다.
    { key: 'ip', header: 'IP', pii: true, className: 'font-mono text-xs text-[var(--studio-muted)]', cell: (row) => row.ipPrefix ?? '-' },
  ]

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--studio-muted)]">
        관리자가 회원 연락처(이메일·전화)를 보여 주는 화면을 연 기록입니다. 기록은 고치거나 지울 수 없습니다.
        탈퇴 회원 보관 기록 열람은{' '}
        <Link href="/admin/audit-log?tab=actions&action=withdrawn_record_view" className="text-[var(--studio-primary)] hover:underline">작업 기록의 &apos;탈퇴 회원 보관 기록 열람&apos;</Link>
        에서 봅니다.
      </p>

      <AdminFilterBar
        className="mb-0"
        filters={
          <>
            <select value={actor} onChange={(event) => setFilter('actor', event.target.value)} aria-label="처리자" className={FILTER_SELECT_CLASS}>
              <option value="">전체 처리자</option>
              {(data?.actors ?? []).map((item) => <option key={item.id} value={item.id}>{item.loginId}</option>)}
              {actor && data && !data.actors.some((item) => item.id === actor) && <option value={actor}>선택한 처리자</option>}
            </select>
            <select value={screen} onChange={(event) => setFilter('screen', event.target.value)} aria-label="화면" className={FILTER_SELECT_CLASS}>
              <option value="">전체 화면</option>
              {Object.entries(ADMIN_MEMBER_ACCESS_SCREENS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            {member && (
              <span className="flex items-center gap-2 rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] px-3 py-1.5 text-sm">
                <span data-admin-pii="">회원: {data?.member?.name ?? member.slice(0, 8)}</span>
                <Button type="button" size="sm" variant="adminTable" onClick={() => setFilter('member', '')}>필터 해제</Button>
              </span>
            )}
          </>
        }
        period={
          <div className="flex items-center gap-2 text-sm text-[var(--studio-muted)] max-sm:w-full">
            <Input type="date" value={from} max={to || undefined} onChange={(event) => setFilter('from', event.target.value)} aria-label="시작일(한국 시간)" className="w-40 max-sm:w-full" />
            <span>~</span>
            <Input type="date" value={to} min={from || undefined} onChange={(event) => setFilter('to', event.target.value)} aria-label="종료일(한국 시간)" className="w-40 max-sm:w-full" />
          </div>
        }
        resultCount={isLoading ? undefined : data ? data.totalCount : ADMIN_UNAVAILABLE}
      />

      {loadError && (
        <AdminNotice kind="error" title={`열람 기록을 불러오지 못했습니다: ${loadError}`}>
          기록이 없는 것이 아닙니다. 새로고침해도 같으면 개발 담당자에게 알려 주세요.
        </AdminNotice>
      )}

      <AdminDataTable
        caption="개인정보 열람 기록 목록"
        columns={columns}
        rows={data?.rows ?? []}
        getRowKey={(row) => row.id}
        minWidth={760}
        state={isLoading ? (
          <AdminTableState kind="loading" />
        ) : !data ? (
          <AdminTableState kind="error" message="열람 기록을 불러오지 못했습니다." />
        ) : data.rows.length === 0 ? (
          <AdminTableState kind="empty" message={hasFilter ? '조건에 맞는 기록이 없습니다.' : '기록이 없습니다.'} />
        ) : undefined}
      />

      {data && (
        <StudioListPagination page={data.page} pageSize={data.pageSize} totalCount={data.totalCount} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}
    </div>
  )
}
