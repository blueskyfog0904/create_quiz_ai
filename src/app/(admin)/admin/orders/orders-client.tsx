'use client'

import { useEffect, useState, type ReactNode } from 'react'
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
import { ADMIN_TONE_TEXT_CLASSES } from '@/components/admin/kit/admin-tone-classes'
import { ADMIN_UNAVAILABLE, formatCredits, formatWon } from '@/lib/admin-format'
import { adminStatusTone } from '@/lib/admin-status-tone'
import { useListQuery } from '@/hooks/use-list-query'
import { formatMemberDisplayName } from '@/lib/member-display-name'
import {
  CREDIT_SOURCE_STATUS_LABELS,
  PAYMENT_ADMIN_ACTION_LABELS,
  PAYMENT_ENVIRONMENT_LABELS,
  PAYMENT_EXTERNAL_METHOD_LABELS,
  PAYMENT_ORDER_STATUS_LABELS,
  PAYMENT_PROVIDER_LABELS,
  REFUND_REQUEST_ORIGIN_LABELS,
  REFUND_REQUEST_STATUS_LABELS,
  labelOf,
} from '@/lib/admin-orders'
import type { AdminPaymentOrder, AdminPaymentOrderListResult } from '@/lib/admin-orders-server'

export const FILTER_SELECT_CLASS =
  'h-10 rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm text-[var(--studio-text)] max-sm:w-full'

// 날짜 표기는 지금 모양 그대로(20번: 대표가 바꾸기로 정하기 전까지).
export const formatDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'

// 상세 창 안 보조 글(비어 있음 안내 등)
export const DETAIL_MUTED_CLASS = 'text-sm text-[var(--studio-muted)]'
// 상세 창 안 목록 한 칸
export const DETAIL_ITEM_CLASS = 'rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] p-3 text-sm'

// 결제수단 이름은 DB(payment_methods.label)에서 읽는다. 라벨이 없는 카카오·과거 결제만 결제사 이름으로 표시한다.
const methodLabel = (order: AdminPaymentOrder) => order.methodLabel ?? labelOf(PAYMENT_PROVIDER_LABELS, order.provider)

export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-[var(--studio-ink)]">{title}</h3>
      {children}
    </section>
  )
}

export function DetailList({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-[var(--studio-muted)]">{label}</dt>
          <dd className="min-w-0 break-all">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

// 목록·검색·필터·페이지는 주소(q, provider, status, environment, from, to, page, pageSize)가 정하고 서버가 걸러 준다.
export function PaymentOrdersClient() {
  const listQuery = useListQuery()
  const { page, pageSize, setPage, setPageSize } = listQuery
  const search = listQuery.params.get('q') ?? ''
  const provider = listQuery.params.get('provider') ?? ''
  const status = listQuery.params.get('status') ?? ''
  const environment = listQuery.params.get('environment') ?? ''
  const from = listQuery.params.get('from') ?? ''
  const to = listQuery.params.get('to') ?? ''
  const setFilter = (key: string, value: string) => listQuery.update({ [key]: value, page: 1 })

  // 마지막으로 응답을 받은 요청. 주소의 조건과 다르면 아직 불러오는 중이다.
  const [loaded, setLoaded] = useState<{ key: string; data: AdminPaymentOrderListResult | null; error: string | null } | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<AdminPaymentOrder | null>(null)

  const requestParams = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  for (const [key, value] of Object.entries({ q: search, provider, status, environment, from, to })) {
    if (value) requestParams.set(key, value)
  }
  const requestKey = requestParams.toString()
  const isLoading = loaded?.key !== requestKey
  const data = isLoading ? null : loaded.data
  const loadError = isLoading ? null : loaded.error

  useEffect(() => {
    let ignore = false
    fetch(`/api/admin/orders/payments?${requestKey}`)
      .then(async (response) => {
        const result = await response.json().catch(() => null)
        if (!response.ok || !result?.success) throw new Error(result?.error ?? '주문을 불러오지 못했습니다.')
        if (!ignore) setLoaded({ key: requestKey, data: result.data, error: null })
      })
      .catch((error) => {
        // 읽지 못한 것을 "0건"으로 보이지 않게 목록 없이 오류로 알린다.
        if (!ignore) setLoaded({ key: requestKey, data: null, error: error instanceof Error ? error.message : '주문을 불러오지 못했습니다.' })
      })
    return () => {
      ignore = true
    }
  }, [requestKey])

  const hasFilter = Boolean(search || provider || status || environment || from || to)

  const columns: AdminDataTableColumn<AdminPaymentOrder>[] = [
    { key: 'createdAt', header: '주문 시각', className: 'whitespace-nowrap text-xs text-[var(--studio-muted)]', cell: (order) => formatDateTime(order.createdAt) },
    {
      key: 'member',
      header: '회원',
      pii: true,
      cell: (order) => (
        <div className="flex flex-col">
          <Link href={`/admin/users/${order.userId}`} className="text-sm font-medium hover:underline">{order.memberWithdrawn ? '탈퇴 회원' : formatMemberDisplayName(order.user?.email, order.user?.display_tag)}</Link>
          <span className="text-xs text-[var(--studio-muted)]">{order.memberWithdrawn ? '법정 보존' : order.user?.email || '-'}</span>
        </div>
      ),
    },
    {
      key: 'plan',
      header: '요금제 · 금액',
      cell: (order) => (
        <>
          <div className="text-sm">{order.planName}</div>
          <div className="text-xs tabular-nums text-[var(--studio-muted)]">{formatWon(order.amount)} · {formatCredits(order.credits)}</div>
        </>
      ),
    },
    { key: 'method', header: '결제수단', className: 'text-sm', cell: (order) => methodLabel(order) },
    {
      key: 'status',
      header: '상태',
      cell: (order) => {
        const latestRefund = order.refunds.reduce<AdminPaymentOrder['refunds'][number] | null>(
          (latest, refund) => (!latest || refund.created_at > latest.created_at ? refund : latest),
          null
        )
        return (
          <div className="flex flex-wrap gap-1">
            <AdminStatusBadge label={labelOf(PAYMENT_ORDER_STATUS_LABELS, order.status)} tone={adminStatusTone('paymentOrder', order.status)} />
            {order.environment !== 'live' && <AdminStatusBadge label={labelOf(PAYMENT_ENVIRONMENT_LABELS, order.environment)} tone="neutral" />}
            {latestRefund && <AdminStatusBadge label={`환불 요청: ${labelOf(REFUND_REQUEST_STATUS_LABELS, latestRefund.status)}`} tone={adminStatusTone('refundRequest', latestRefund.status)} />}
          </div>
        )
      },
    },
    { key: 'orderId', header: '주문번호', className: 'font-mono text-xs', cell: (order) => order.orderId },
    {
      key: 'detail',
      header: '상세',
      align: 'right',
      cell: (order) => <Button type="button" size="sm" variant="adminTable" onClick={() => setSelectedOrder(order)}>상세</Button>,
    },
  ]

  return (
    <div className="space-y-6">
      <AdminFilterBar
        className="mb-0"
        search={
          <form
            className="flex w-full gap-2 sm:w-96"
            onSubmit={(event) => {
              event.preventDefault()
              setFilter('q', String(new FormData(event.currentTarget).get('q') ?? '').trim())
            }}
          >
            <Input key={search} name="q" defaultValue={search} placeholder="이메일, 주문번호, 결제사 거래번호" aria-label="주문 검색" />
            <Button type="submit" variant="brand">검색</Button>
          </form>
        }
        filters={
          <>
            <select value={status} onChange={(event) => setFilter('status', event.target.value)} aria-label="주문 상태" className={FILTER_SELECT_CLASS}>
              <option value="">전체 상태</option>
              {Object.entries(PAYMENT_ORDER_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={provider} onChange={(event) => setFilter('provider', event.target.value)} aria-label="결제사" className={FILTER_SELECT_CLASS}>
              <option value="">전체 결제사</option>
              {Object.entries(PAYMENT_PROVIDER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={environment} onChange={(event) => setFilter('environment', event.target.value)} aria-label="결제 환경" className={FILTER_SELECT_CLASS}>
              <option value="">실결제·테스트 전체</option>
              {Object.entries(PAYMENT_ENVIRONMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </>
        }
        period={
          <div className="flex items-center gap-2 text-sm text-[var(--studio-muted)] max-sm:w-full">
            <Input type="date" value={from} max={to || undefined} onChange={(event) => setFilter('from', event.target.value)} aria-label="주문 시작일(한국 시간)" className="w-40 max-sm:w-full" />
            <span>~</span>
            <Input type="date" value={to} min={from || undefined} onChange={(event) => setFilter('to', event.target.value)} aria-label="주문 종료일(한국 시간)" className="w-40 max-sm:w-full" />
          </div>
        }
        resultCount={isLoading ? undefined : data ? data.totalCount : ADMIN_UNAVAILABLE}
      />

      {loadError && (
        <AdminNotice kind="error" title={`주문 목록을 불러오지 못했습니다: ${loadError}`}>
          주문이 없는 것이 아닙니다. 새로고침해도 같으면 개발 담당자에게 알려 주세요.
        </AdminNotice>
      )}

      {data?.searchTruncated && (
        <AdminNotice kind="warning">
          검색어에 맞는 회원이 많아 일부 회원의 주문만 보입니다. 이메일을 더 길게 입력해 주세요.
        </AdminNotice>
      )}

      <AdminDataTable
        caption="충전 결제 주문 목록"
        columns={columns}
        rows={data?.orders ?? []}
        getRowKey={(order) => order.id}
        minWidth={760}
        state={isLoading ? (
          <AdminTableState kind="loading" />
        ) : !data ? (
          <AdminTableState kind="error" message="목록을 불러오지 못했습니다." />
        ) : data.orders.length === 0 ? (
          <AdminTableState kind="empty" message={hasFilter ? '조건에 맞는 주문이 없습니다.' : '주문이 없습니다.'} />
        ) : undefined}
      />

      {data && (
        <StudioListPagination page={data.page} pageSize={data.pageSize} totalCount={data.totalCount} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}

      <Dialog open={Boolean(selectedOrder)} onOpenChange={(open) => { if (!open) setSelectedOrder(null) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {selectedOrder && (
            <>
              <DialogHeader>
                <DialogTitle>충전 결제 주문 상세</DialogTitle>
                <DialogDescription>시각은 모두 한국 시간입니다.</DialogDescription>
              </DialogHeader>
              <div className="space-y-6">
                <DetailSection title="주문">
                  <DetailList rows={[
                    ['주문번호', <span key="v" className="font-mono text-xs">{selectedOrder.orderId}</span>],
                    ['결제사 거래번호', <span key="v" className="font-mono text-xs">{selectedOrder.transaction?.provider_transaction_id ?? '-'}</span>],
                    ['회원', selectedOrder.memberWithdrawn ? '탈퇴 회원' : `${formatMemberDisplayName(selectedOrder.user?.email, selectedOrder.user?.display_tag)} (${selectedOrder.user?.email || '-'})`],
                    ['요금제', selectedOrder.planName],
                    ['주문 금액', formatWon(selectedOrder.amount)],
                    ['결제수단', methodLabel(selectedOrder)],
                    ['주문 상태', labelOf(PAYMENT_ORDER_STATUS_LABELS, selectedOrder.status)],
                    ['결제 환경', labelOf(PAYMENT_ENVIRONMENT_LABELS, selectedOrder.environment)],
                    ...(selectedOrder.failureCode || selectedOrder.failureMessage
                      ? [['실패·확인 사유', [selectedOrder.failureCode, selectedOrder.failureMessage].filter(Boolean).join(' · ')] as [string, ReactNode]]
                      : []),
                  ]} />
                </DetailSection>

                <DetailSection title="크레딧">
                  {selectedOrder.source ? (
                    <DetailList rows={[
                      ['지급된 크레딧', formatCredits(selectedOrder.source.initial_credits)],
                      ['남은 크레딧', formatCredits(selectedOrder.source.remaining_credits)],
                      ['만료일', selectedOrder.source.expires_at ? formatDateTime(selectedOrder.source.expires_at) : '만료 없음'],
                      ['크레딧 상태', labelOf(CREDIT_SOURCE_STATUS_LABELS, selectedOrder.source.status)],
                    ]} />
                  ) : (
                    <p className={DETAIL_MUTED_CLASS}>이 주문으로 지급된 크레딧이 없습니다. (주문 시 예정 크레딧 {formatCredits(selectedOrder.credits)})</p>
                  )}
                </DetailSection>

                <DetailSection title="환불 요청">
                  {selectedOrder.refunds.length === 0 ? (
                    <p className={DETAIL_MUTED_CLASS}>환불 요청이 없습니다.</p>
                  ) : (
                    <ul className="space-y-2">
                      {selectedOrder.refunds.map((refund) => (
                        <li key={refund.id} className={DETAIL_ITEM_CLASS}>
                          <div className="flex flex-wrap items-center gap-2">
                            <AdminStatusBadge label={labelOf(REFUND_REQUEST_STATUS_LABELS, refund.status)} tone={adminStatusTone('refundRequest', refund.status)} />
                            <span>{labelOf(REFUND_REQUEST_ORIGIN_LABELS, refund.origin)}</span>
                            <span className="font-medium">{refund.refund_amount == null ? '환불액 미정' : formatWon(refund.refund_amount)}</span>
                          </div>
                          <p className="mt-1 text-xs text-[var(--studio-muted)]">요청 {formatDateTime(refund.created_at)} · 처리 {formatDateTime(refund.processed_at)}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </DetailSection>

                <DetailSection title="진행 시각">
                  <DetailList rows={[
                    ['주문 생성', formatDateTime(selectedOrder.createdAt)],
                    ['결제 승인', formatDateTime(selectedOrder.approvedAt)],
                    ['크레딧 지급', formatDateTime(selectedOrder.fulfilledAt)],
                    ['결제 취소', formatDateTime(selectedOrder.canceledAt)],
                  ]} />
                </DetailSection>

                <DetailSection title="결제사 통보">
                  {selectedOrder.transaction ? (
                    <DetailList rows={[
                      ['결제사 상태값', selectedOrder.transaction.provider_status ?? '-'],
                      ['결제된 금액', formatWon(selectedOrder.transaction.paid_amount)],
                      ['결제 통보 기록', formatDateTime(selectedOrder.transaction.paid_feedback_recorded_at)],
                      ['관리자 결제 확인', formatDateTime(selectedOrder.transaction.admin_paid_confirmed_at)],
                      ['취소 통보 기록', formatDateTime(selectedOrder.transaction.cancel_feedback_recorded_at)],
                      ['취소 처리', formatDateTime(selectedOrder.transaction.cancel_processed_at)],
                      ['부분취소 통보 기록', formatDateTime(selectedOrder.transaction.partial_cancel_feedback_recorded_at)],
                      ['부분취소 처리', formatDateTime(selectedOrder.transaction.partial_cancel_processed_at)],
                      ['부분취소 금액', formatWon(selectedOrder.transaction.partial_cancel_amount)],
                    ]} />
                  ) : (
                    <p className={DETAIL_MUTED_CLASS}>결제사 거래 기록이 없습니다.</p>
                  )}
                </DetailSection>

                <DetailSection title="관리자 조치 기록">
                  {data?.actionsUnavailable ? (
                    <p role="alert" className={`text-sm ${ADMIN_TONE_TEXT_CLASSES.danger}`}>조치 기록을 불러오지 못했습니다. 기록이 없는 것이 아닙니다.</p>
                  ) : selectedOrder.actions.length === 0 ? (
                    <p className={DETAIL_MUTED_CLASS}>관리자 조치 기록이 없습니다.</p>
                  ) : (
                    <ul className="space-y-2">
                      {selectedOrder.actions.map((action) => (
                        <li key={action.id} className={DETAIL_ITEM_CLASS}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{labelOf(PAYMENT_ADMIN_ACTION_LABELS, action.action)}</span>
                            <span className="text-xs text-[var(--studio-muted)]">{formatDateTime(action.createdAt)} · {action.actor ?? '관리자 확인 불가'}</span>
                          </div>
                          <p className="mt-1 whitespace-pre-line break-all">{action.note}</p>
                          {(action.externalMethod || action.recoveredCredits != null || action.unrecoveredCredits != null) && (
                            <p className="mt-1 text-xs text-[var(--studio-muted)]">
                              {[
                                action.externalMethod ? `처리 방법: ${labelOf(PAYMENT_EXTERNAL_METHOD_LABELS, action.externalMethod)}` : null,
                                action.recoveredCredits != null ? `회수한 크레딧 ${formatCredits(action.recoveredCredits)}` : null,
                                action.unrecoveredCredits != null ? `회수하지 못한 크레딧 ${formatCredits(action.unrecoveredCredits)}` : null,
                              ].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </DetailSection>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
