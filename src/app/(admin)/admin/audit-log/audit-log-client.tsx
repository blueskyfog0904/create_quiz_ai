'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { StudioListPagination } from '@/components/design-system/studio-list-pagination'
import { AdminDataTable, type AdminDataTableColumn } from '@/components/admin/kit/admin-data-table'
import { AdminFilterBar } from '@/components/admin/kit/admin-filter-bar'
import { AdminNotice } from '@/components/admin/kit/admin-notice'
import { AdminStatusBadge } from '@/components/admin/kit/admin-status-badge'
import { AdminTableState } from '@/components/admin/kit/admin-table-state'
import { ADMIN_UNAVAILABLE, formatCount } from '@/lib/admin-format'
import { useListQuery } from '@/hooks/use-list-query'
import { ADMIN_AUDIT_ACTIONS, ADMIN_AUDIT_SOURCE_LABELS } from '@/lib/admin-audit-log'
import { PAYMENT_ADMIN_ACTION_LABELS, labelOf } from '@/lib/admin-orders'
import type { AdminAuditTimelineResult, AdminAuditTimelineRow } from '@/lib/admin-audit-log-server'

const FILTER_SELECT_CLASS =
  'h-10 rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm text-[var(--studio-text)] max-sm:w-full'
const ACTION_LABELS: Record<string, string> = { ...ADMIN_AUDIT_ACTIONS, ...PAYMENT_ADMIN_ACTION_LABELS }

const formatDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'

// 날짜 표기는 지금 모양 그대로(20번: 대표가 바꾸기로 정하기 전까지).
// 대상 칸: 회원이면 회원 상세로 잇고, 관리자 계정이면 기록에 남은 아이디를 보인다.
function TargetCell({ row }: { row: AdminAuditTimelineRow }) {
  const details = (row.details && typeof row.details === 'object' && !Array.isArray(row.details) ? row.details : {}) as Record<string, unknown>
  if (row.targetUserId) {
    return (
      <Link href={`/admin/users/${row.targetUserId}`} className="text-sm font-medium hover:underline">
        {row.targetUserEmail ?? row.targetUserId}
      </Link>
    )
  }
  const label = typeof details.login_id === 'string'
    ? details.login_id
    : typeof details.target_email === 'string'
      ? details.target_email
      : typeof details.title === 'string'
        ? details.title
        : typeof details.name === 'string'
          ? details.name
          : row.targetId
  return <span className="text-sm">{label ?? '-'}</span>
}

// 목록·필터·페이지는 주소(actor, action, source, from, to, page, pageSize)가 정하고 서버가 걸러 준다.
export function AuditLogClient() {
  const listQuery = useListQuery()
  const { page, pageSize, setPage, setPageSize } = listQuery
  const actor = listQuery.params.get('actor') ?? ''
  const action = listQuery.params.get('action') ?? ''
  const source = listQuery.params.get('source') ?? ''
  const from = listQuery.params.get('from') ?? ''
  const to = listQuery.params.get('to') ?? ''
  const setFilter = (key: string, value: string) => listQuery.update({ [key]: value, page: 1 })

  const [loaded, setLoaded] = useState<{ key: string; data: AdminAuditTimelineResult | null; error: string | null } | null>(null)
  const [selected, setSelected] = useState<AdminAuditTimelineRow | null>(null)

  const requestParams = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  for (const [key, value] of Object.entries({ actor, action, source, from, to })) {
    if (value) requestParams.set(key, value)
  }
  const requestKey = requestParams.toString()
  const isLoading = loaded?.key !== requestKey
  const data = isLoading ? null : loaded.data
  const loadError = isLoading ? null : loaded.error

  useEffect(() => {
    let ignore = false
    fetch(`/api/admin/audit-log?${requestKey}`)
      .then(async (response) => {
        const result = await response.json().catch(() => null)
        if (!response.ok || !result?.success) throw new Error(result?.error ?? '작업 기록을 불러오지 못했습니다.')
        if (!ignore) setLoaded({ key: requestKey, data: result.data, error: null })
      })
      .catch((error) => {
        // 읽지 못한 것을 "기록 없음"으로 보이지 않게 오류로 알린다.
        if (!ignore) setLoaded({ key: requestKey, data: null, error: error instanceof Error ? error.message : '작업 기록을 불러오지 못했습니다.' })
      })
    return () => {
      ignore = true
    }
  }, [requestKey])

  const hasFilter = Boolean(actor || action || source || from || to)

  const columns: AdminDataTableColumn<AdminAuditTimelineRow>[] = [
    { key: 'createdAt', header: '시각', className: 'whitespace-nowrap text-xs text-[var(--studio-muted)]', cell: (row) => formatDateTime(row.createdAt) },
    {
      key: 'actor',
      header: '처리자',
      className: 'text-sm',
      cell: (row) => row.actor ?? <span className="font-mono text-xs text-[var(--studio-muted)]">{row.actorId.slice(0, 8)}</span>,
    },
    {
      key: 'action',
      header: '종류',
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-sm">{labelOf(ACTION_LABELS, row.action)}</span>
          {row.source === 'payment' && <AdminStatusBadge label={ADMIN_AUDIT_SOURCE_LABELS.payment} tone="neutral" />}
        </div>
      ),
    },
    // 대상이 회원이면 이메일이 보인다(화면 비교 때 가린다).
    { key: 'target', header: '대상', pii: true, cell: (row) => <TargetCell row={row} /> },
    { key: 'amount', header: '수량', numeric: true, className: 'text-sm', cell: (row) => formatCount(row.amount) },
    {
      key: 'reason',
      header: '사유',
      className: 'max-w-[16rem] truncate text-sm',
      cell: (row) => <span title={row.reason ?? undefined}>{row.reason ?? '-'}</span>,
    },
    {
      key: 'detail',
      header: '상세',
      align: 'right',
      cell: (row) => <Button type="button" size="sm" variant="adminTable" onClick={() => setSelected(row)}>상세</Button>,
    },
  ]

  return (
    <div className="space-y-6">
      <AdminFilterBar
        className="mb-0"
        filters={
          <>
            <select value={actor} onChange={(event) => setFilter('actor', event.target.value)} aria-label="처리자" className={FILTER_SELECT_CLASS}>
              <option value="">전체 처리자</option>
              {(data?.actors ?? []).map((item) => <option key={item.id} value={item.id}>{item.loginId}</option>)}
              {actor && data && !data.actors.some((item) => item.id === actor) && <option value={actor}>선택한 처리자</option>}
            </select>
            <select value={source} onChange={(event) => setFilter('source', event.target.value)} aria-label="출처" className={FILTER_SELECT_CLASS}>
              <option value="">관리자 작업·결제 조치 전체</option>
              {Object.entries(ADMIN_AUDIT_SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={action} onChange={(event) => setFilter('action', event.target.value)} aria-label="종류" className={FILTER_SELECT_CLASS}>
              <option value="">전체 종류</option>
              <optgroup label={ADMIN_AUDIT_SOURCE_LABELS.admin}>
                {Object.entries(ADMIN_AUDIT_ACTIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </optgroup>
              <optgroup label={ADMIN_AUDIT_SOURCE_LABELS.payment}>
                {Object.entries(PAYMENT_ADMIN_ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </optgroup>
            </select>
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
        <AdminNotice kind="error" title={`작업 기록을 불러오지 못했습니다: ${loadError}`}>
          기록이 없는 것이 아닙니다. 새로고침해도 같으면 개발 담당자에게 알려 주세요.
        </AdminNotice>
      )}

      <AdminDataTable
        caption="작업 기록 목록"
        columns={columns}
        rows={data?.rows ?? []}
        getRowKey={(row) => `${row.source}:${row.id}`}
        minWidth={760}
        state={isLoading ? (
          <AdminTableState kind="loading" />
        ) : !data ? (
          <AdminTableState kind="error" message="작업 기록을 불러오지 못했습니다." />
        ) : data.rows.length === 0 ? (
          <AdminTableState kind="empty" message={hasFilter ? '조건에 맞는 기록이 없습니다.' : '기록이 없습니다.'} />
        ) : undefined}
      />

      {data && (
        <StudioListPagination page={data.page} pageSize={data.pageSize} totalCount={data.totalCount} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{labelOf(ACTION_LABELS, selected.action)}</DialogTitle>
                <DialogDescription>{formatDateTime(selected.createdAt)} · {selected.actor ?? selected.actorId}</DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-[var(--studio-muted)]">출처</dt>
                <dd>{labelOf(ADMIN_AUDIT_SOURCE_LABELS, selected.source)}</dd>
                <dt className="text-[var(--studio-muted)]">대상</dt>
                {/* 경보 해소처럼 대상이 없는 결제 조치는 대상 종류·id가 모두 비어 있다. */}
                <dd className="break-all">{[selected.targetType, selected.targetId].filter(Boolean).join(' · ') || '-'}</dd>
                <dt className="text-[var(--studio-muted)]">사유</dt>
                <dd className="whitespace-pre-wrap break-all">{selected.reason ?? '-'}</dd>
              </dl>
              <pre data-admin-pii="" className="mt-2 overflow-x-auto rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] p-3 text-xs">{JSON.stringify(selected.details, null, 2)}</pre>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
