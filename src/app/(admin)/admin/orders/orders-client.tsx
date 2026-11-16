'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StudioListPagination } from '@/components/design-system/studio-list-pagination'
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

export const FILTER_SELECT_CLASS = 'h-10 rounded-md border border-input bg-background px-3 text-sm max-sm:w-full'

export const formatDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'
const formatWon = (value: number | null | undefined) => (value == null ? '-' : `${value.toLocaleString()}원`)

function statusBadgeClass(status: string) {
  if (status === 'completed') return 'bg-green-100 text-green-700 hover:bg-green-100'
  if (status === 'refunded') return 'bg-blue-100 text-blue-700 hover:bg-blue-100'
  if (status === 'manual_review') return 'bg-red-100 text-red-700 hover:bg-red-100'
  if (status === 'failed' || status === 'expired') return 'bg-gray-100 text-gray-700 hover:bg-gray-100'
  return 'bg-amber-100 text-amber-800 hover:bg-amber-100'
}

// 결제수단 이름은 DB(payment_methods.label)에서 읽는다. 라벨이 없는 카카오·과거 결제만 결제사 이름으로 표시한다.
const methodLabel = (order: AdminPaymentOrder) => order.methodLabel ?? labelOf(PAYMENT_PROVIDER_LABELS, order.provider)

export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-gray-700">{title}</h3>
      {children}
    </section>
  )
}

export function DetailList({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-gray-500">{label}</dt>
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-4 shadow-sm">
        <form
          role="search"
          className="flex w-full gap-2 sm:w-96"
          onSubmit={(event) => {
            event.preventDefault()
            setFilter('q', String(new FormData(event.currentTarget).get('q') ?? '').trim())
          }}
        >
          <Input key={search} name="q" defaultValue={search} placeholder="이메일, 주문번호, 결제사 거래번호" aria-label="주문 검색" />
          <Button type="submit" variant="outline">검색</Button>
        </form>
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
        <div className="flex items-center gap-2 text-sm text-gray-500 max-sm:w-full">
          <Input type="date" value={from} max={to || undefined} onChange={(event) => setFilter('from', event.target.value)} aria-label="주문 시작일(한국 시간)" className="w-40 max-sm:w-full" />
          <span>~</span>
          <Input type="date" value={to} min={from || undefined} onChange={(event) => setFilter('to', event.target.value)} aria-label="주문 종료일(한국 시간)" className="w-40 max-sm:w-full" />
        </div>
      </div>

      {loadError && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-semibold">주문 목록을 불러오지 못했습니다: {loadError}</p>
          <p className="mt-1">주문이 없는 것이 아닙니다. 새로고침해도 같으면 개발 담당자에게 알려 주세요.</p>
        </div>
      )}

      {data?.searchTruncated && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          검색어에 맞는 회원이 많아 일부 회원의 주문만 보입니다. 이메일을 더 길게 입력해 주세요.
        </div>
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="max-md:min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>주문 시각</TableHead>
                <TableHead>회원</TableHead>
                <TableHead>요금제 · 금액</TableHead>
                <TableHead>결제수단</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>주문번호</TableHead>
                <TableHead className="text-right">상세</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">불러오는 중…</TableCell></TableRow>
              ) : !data ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-red-700">목록을 불러오지 못했습니다.</TableCell></TableRow>
              ) : data.orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    {hasFilter ? '조건에 맞는 주문이 없습니다.' : '주문이 없습니다.'}
                  </TableCell>
                </TableRow>
              ) : (
                data.orders.map((order) => {
                  const latestRefund = order.refunds.reduce<AdminPaymentOrder['refunds'][number] | null>(
                    (latest, refund) => (!latest || refund.created_at > latest.created_at ? refund : latest),
                    null
                  )
                  return (
                    <TableRow key={order.id}>
                      <TableCell className="text-xs text-gray-500">{formatDateTime(order.createdAt)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">{formatMemberDisplayName(order.user?.email, order.user?.display_tag)}</span>
                          <span className="text-xs text-gray-400">{order.user?.email || '-'}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{order.planName}</div>
                        <div className="text-xs text-gray-500">{formatWon(order.amount)} · {order.credits.toLocaleString()} 크레딧</div>
                      </TableCell>
                      <TableCell className="text-sm">{methodLabel(order)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="secondary" className={statusBadgeClass(order.status)}>{labelOf(PAYMENT_ORDER_STATUS_LABELS, order.status)}</Badge>
                          {order.environment !== 'live' && <Badge variant="outline">{labelOf(PAYMENT_ENVIRONMENT_LABELS, order.environment)}</Badge>}
                          {latestRefund && <Badge variant="outline">환불 요청: {labelOf(REFUND_REQUEST_STATUS_LABELS, latestRefund.status)}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{order.orderId}</TableCell>
                      <TableCell className="text-right">
                        <Button type="button" size="sm" variant="outline" onClick={() => setSelectedOrder(order)}>상세</Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
                    ['회원', `${formatMemberDisplayName(selectedOrder.user?.email, selectedOrder.user?.display_tag)} (${selectedOrder.user?.email || '-'})`],
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
                      ['지급된 크레딧', selectedOrder.source.initial_credits.toLocaleString()],
                      ['남은 크레딧', selectedOrder.source.remaining_credits.toLocaleString()],
                      ['만료일', selectedOrder.source.expires_at ? formatDateTime(selectedOrder.source.expires_at) : '만료 없음'],
                      ['크레딧 상태', labelOf(CREDIT_SOURCE_STATUS_LABELS, selectedOrder.source.status)],
                    ]} />
                  ) : (
                    <p className="text-sm text-gray-500">이 주문으로 지급된 크레딧이 없습니다. (주문 시 예정 크레딧 {selectedOrder.credits.toLocaleString()})</p>
                  )}
                </DetailSection>

                <DetailSection title="환불 요청">
                  {selectedOrder.refunds.length === 0 ? (
                    <p className="text-sm text-gray-500">환불 요청이 없습니다.</p>
                  ) : (
                    <ul className="space-y-2">
                      {selectedOrder.refunds.map((refund) => (
                        <li key={refund.id} className="rounded-md border p-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary">{labelOf(REFUND_REQUEST_STATUS_LABELS, refund.status)}</Badge>
                            <span>{labelOf(REFUND_REQUEST_ORIGIN_LABELS, refund.origin)}</span>
                            <span className="font-medium">{refund.refund_amount == null ? '환불액 미정' : formatWon(refund.refund_amount)}</span>
                          </div>
                          <p className="mt-1 text-xs text-gray-500">요청 {formatDateTime(refund.created_at)} · 처리 {formatDateTime(refund.processed_at)}</p>
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
                    <p className="text-sm text-gray-500">결제사 거래 기록이 없습니다.</p>
                  )}
                </DetailSection>

                <DetailSection title="관리자 조치 기록">
                  {data?.actionsUnavailable ? (
                    <p role="alert" className="text-sm text-red-700">조치 기록을 불러오지 못했습니다. 기록이 없는 것이 아닙니다.</p>
                  ) : selectedOrder.actions.length === 0 ? (
                    <p className="text-sm text-gray-500">관리자 조치 기록이 없습니다.</p>
                  ) : (
                    <ul className="space-y-2">
                      {selectedOrder.actions.map((action) => (
                        <li key={action.id} className="rounded-md border p-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{labelOf(PAYMENT_ADMIN_ACTION_LABELS, action.action)}</span>
                            <span className="text-xs text-gray-500">{formatDateTime(action.createdAt)} · {action.actor ?? '관리자 확인 불가'}</span>
                          </div>
                          <p className="mt-1 whitespace-pre-line break-all">{action.note}</p>
                          {(action.externalMethod || action.recoveredCredits != null || action.unrecoveredCredits != null) && (
                            <p className="mt-1 text-xs text-gray-500">
                              {[
                                action.externalMethod ? `처리 방법: ${labelOf(PAYMENT_EXTERNAL_METHOD_LABELS, action.externalMethod)}` : null,
                                action.recoveredCredits != null ? `회수한 크레딧 ${action.recoveredCredits.toLocaleString()}` : null,
                                action.unrecoveredCredits != null ? `회수하지 못한 크레딧 ${action.unrecoveredCredits.toLocaleString()}` : null,
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
