'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
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
  MARKET_DOWNLOAD_BLOCK_REASON_LABELS,
  MARKET_ENTITLEMENT_SCOPE_LABELS,
  MARKET_ENTITLEMENT_STATUS_LABELS,
  MARKET_ITEM_STATUS_LABELS,
  MARKET_ORDER_STATUS_LABELS,
  MARKET_PURCHASE_LINE_TYPE_LABELS,
  MARKET_REFUND_REQUEST_STATUS_LABELS,
  WORKSPACE_SUBJECT_LABELS,
  labelOf,
} from '@/lib/admin-orders'
import type { AdminMarketOrder, AdminMarketOrderListResult } from '@/lib/admin-orders-server'
import { DetailList, DetailSection, FILTER_SELECT_CLASS, formatDateTime } from './orders-client'
import { MarketExceptionRefundDialog } from './market-exception-refund-dialog'

const OK_BADGE_CLASS = 'bg-green-100 text-green-700 hover:bg-green-100'
const BLOCKED_BADGE_CLASS = 'bg-red-100 text-red-700 hover:bg-red-100'
const PARTIAL_BADGE_CLASS = 'bg-amber-100 text-amber-800 hover:bg-amber-100'

const formatCredits = (value: number | null | undefined) => (value == null ? '-' : `${value.toLocaleString()} 크레딧`)

function statusBadgeClass(status: string) {
  if (status === 'completed') return OK_BADGE_CLASS
  if (status === 'refunded') return 'bg-blue-100 text-blue-700 hover:bg-blue-100'
  return 'bg-gray-100 text-gray-700 hover:bg-gray-100'
}

// 상품이 판매 화면에서 내려가 있으면 그 사실을 알린다(숨김은 구매자 다운로드를 막지 않는다).
function itemStateNote(item: AdminMarketOrder['item']) {
  if (!item) return '상품 없음'
  if (item.deleted_at !== null) return '삭제된 상품'
  if (!item.is_active) return '비활성 상품'
  return item.status === 'published' ? null : `${labelOf(MARKET_ITEM_STATUS_LABELS, item.status)} 상품`
}

// 회원이 실제로 받을 수 있는지(그 회원이 이 상품에 가진 모든 권한 기준, 지금 제공 중인 파일로 셈): 가능 / 일부만 / 불가
function DownloadSummaryBadge({ download }: { download: AdminMarketOrder['download'] }) {
  const reason = labelOf(MARKET_DOWNLOAD_BLOCK_REASON_LABELS, download.reason)
  if (download.downloadableCount === 0) return <Badge variant="secondary" className={BLOCKED_BADGE_CLASS}>회원 다운로드 불가: {reason}</Badge>
  if (download.downloadableCount < download.fileCount) {
    return <Badge variant="secondary" className={PARTIAL_BADGE_CLASS}>회원 다운로드 일부만 가능 {download.downloadableCount}/{download.fileCount} · {reason}</Badge>
  }
  return <Badge variant="secondary" className={OK_BADGE_CLASS}>회원 다운로드 가능 (파일 {download.fileCount}개)</Badge>
}

// 이 주문 자체의 권한이 살아 있지 않으면 그 사실을, 그런데도 받을 수 있다면 어느 주문의 권한 덕분인지를 알린다.
function ownEntitlementNote(download: AdminMarketOrder['download']) {
  if (!download.ownEntitlementReason) return null
  const own = `이 주문: ${labelOf(MARKET_DOWNLOAD_BLOCK_REASON_LABELS, download.ownEntitlementReason)}`
  return download.otherOrderIds.length > 0
    ? `${own} · 같은 회원의 다른 주문(${download.otherOrderIds.map((orderId) => orderId.slice(0, 8)).join(', ')}) 권한으로 다운로드`
    : own
}

// 목록·검색·필터·페이지는 주소(q, status, orderSubject, from, to, page, pageSize)가 정하고 서버가 걸러 준다.
// 과목은 사이드바의 과목 전환(?subject=)과 따로 둔다 — 문의는 과목을 모르고 들어오므로 기본은 전체 과목이다.
export function MarketOrdersClient() {
  const listQuery = useListQuery()
  const { page, pageSize, setPage, setPageSize } = listQuery
  const search = listQuery.params.get('q') ?? ''
  const status = listQuery.params.get('status') ?? ''
  const subject = listQuery.params.get('orderSubject') ?? ''
  const from = listQuery.params.get('from') ?? ''
  const to = listQuery.params.get('to') ?? ''
  const setFilter = (key: string, value: string) => listQuery.update({ [key]: value, page: 1 })

  // 마지막으로 응답을 받은 요청. 주소의 조건과 다르면 아직 불러오는 중이다.
  const [loaded, setLoaded] = useState<{ key: string; data: AdminMarketOrderListResult | null; error: string | null } | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<AdminMarketOrder | null>(null)
  const [exceptionOrderId, setExceptionOrderId] = useState<string | null>(null)
  // 예외 환불 뒤 목록을 다시 읽는 신호
  const [reloadToken, setReloadToken] = useState(0)

  const requestParams = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  for (const [key, value] of Object.entries({ q: search, status, subject, from, to })) {
    if (value) requestParams.set(key, value)
  }
  const requestKey = requestParams.toString()
  const isLoading = loaded?.key !== requestKey
  const data = isLoading ? null : loaded.data
  const loadError = isLoading ? null : loaded.error

  useEffect(() => {
    let ignore = false
    fetch(`/api/admin/orders/market?${requestKey}`)
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
  }, [requestKey, reloadToken])

  const hasFilter = Boolean(search || status || subject || from || to)

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
          <Input key={search} name="q" defaultValue={search} placeholder="이메일, 상품명, 주문 ID" aria-label="주문 검색" />
          <Button type="submit" variant="adminAction">검색</Button>
        </form>
        <select value={status} onChange={(event) => setFilter('status', event.target.value)} aria-label="주문 상태" className={FILTER_SELECT_CLASS}>
          <option value="">전체 상태</option>
          {Object.entries(MARKET_ORDER_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={subject} onChange={(event) => setFilter('orderSubject', event.target.value)} aria-label="과목" className={FILTER_SELECT_CLASS}>
          <option value="">전체 과목</option>
          {Object.entries(WORKSPACE_SUBJECT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
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
          검색어에 맞는 회원·상품이 많아 일부의 주문만 보입니다. 검색어를 더 길게 입력해 주세요.
        </div>
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="max-md:min-w-[860px]">
            <TableHeader>
              <TableRow>
                <TableHead>주문 시각</TableHead>
                <TableHead>회원</TableHead>
                <TableHead>상품</TableHead>
                <TableHead>사용 크레딧</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>다운로드</TableHead>
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
                  const latestRefund = order.refunds.reduce<AdminMarketOrder['refunds'][number] | null>(
                    (latest, refund) => (!latest || refund.created_at > latest.created_at ? refund : latest),
                    null
                  )
                  const itemNote = itemStateNote(order.item)
                  return (
                    <TableRow key={order.id}>
                      <TableCell className="text-xs text-gray-500">{formatDateTime(order.createdAt)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <Link href={`/admin/users/${order.userId}`} className="text-sm font-medium hover:underline">{formatMemberDisplayName(order.user?.email, order.user?.display_tag)}</Link>
                          <span className="text-xs text-gray-400">{order.user?.email || '-'}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1 text-sm">
                          <span>{order.item?.title ?? '-'}</span>
                          <Badge variant="outline">{labelOf(WORKSPACE_SUBJECT_LABELS, order.workspaceSubject)}</Badge>
                          {itemNote && <Badge variant="outline" className="border-amber-300 text-amber-800">{itemNote}</Badge>}
                        </div>
                        <div className="text-xs text-gray-500">
                          {order.lines.map((line) => line.title ?? labelOf(MARKET_PURCHASE_LINE_TYPE_LABELS, line.lineType)).join(', ') || '구매 줄 없음'}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{formatCredits(order.chargedCredits)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="secondary" className={statusBadgeClass(order.status)}>{labelOf(MARKET_ORDER_STATUS_LABELS, order.status)}</Badge>
                          {latestRefund && <Badge variant="outline">환불 요청: {labelOf(MARKET_REFUND_REQUEST_STATUS_LABELS, latestRefund.status)}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <DownloadSummaryBadge download={order.download} />
                        {ownEntitlementNote(order.download) && <p className="mt-1 text-xs text-gray-500">{ownEntitlementNote(order.download)}</p>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button type="button" size="sm" variant="adminAction" onClick={() => setSelectedOrder(order)}>상세</Button>
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
                <DialogTitle>마켓 구매 주문 상세</DialogTitle>
                <DialogDescription>시각은 모두 한국 시간입니다.</DialogDescription>
              </DialogHeader>
              <div className="space-y-6">
                <DetailSection title="주문">
                  <DetailList rows={[
                    ['주문 ID', <span key="v" className="font-mono text-xs">{selectedOrder.id}</span>],
                    ['주문 시각', formatDateTime(selectedOrder.createdAt)],
                    ['회원', `${formatMemberDisplayName(selectedOrder.user?.email, selectedOrder.user?.display_tag)} (${selectedOrder.user?.email || '-'})`],
                    ['상품', [selectedOrder.item?.title ?? '-', itemStateNote(selectedOrder.item)].filter(Boolean).join(' · ')],
                    ['과목', labelOf(WORKSPACE_SUBJECT_LABELS, selectedOrder.workspaceSubject)],
                    ['주문 상태', labelOf(MARKET_ORDER_STATUS_LABELS, selectedOrder.status)],
                    ['정가', formatCredits(selectedOrder.originalPriceCredits)],
                    ['사용 크레딧', formatCredits(selectedOrder.chargedCredits)],
                  ]} />
                </DetailSection>

                <DetailSection title="구매 줄">
                  {selectedOrder.lines.length === 0 ? (
                    <p className="text-sm text-gray-500">구매 줄이 없습니다.</p>
                  ) : (
                    <ul className="space-y-2">
                      {selectedOrder.lines.map((line) => (
                        <li key={line.id} className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
                          <Badge variant="outline">{labelOf(MARKET_PURCHASE_LINE_TYPE_LABELS, line.lineType)}</Badge>
                          <span>{line.title ?? '-'}</span>
                          <span className="font-medium">{formatCredits(line.priceCredits)}</span>
                          <span className="text-xs text-gray-500">{labelOf(MARKET_ORDER_STATUS_LABELS, line.status)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </DetailSection>

                <DetailSection title="다운로드 권한">
                  {selectedOrder.entitlements.length === 0 ? (
                    <p role="alert" className="text-sm text-red-700">이 주문으로 만들어진 다운로드 권한이 없습니다.</p>
                  ) : (
                    <ul className="space-y-2">
                      {selectedOrder.entitlements.map((entitlement) => (
                        <li key={entitlement.id} className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
                          <Badge variant="secondary" className={entitlement.status === 'active' ? OK_BADGE_CLASS : BLOCKED_BADGE_CLASS}>
                            {labelOf(MARKET_ENTITLEMENT_STATUS_LABELS, entitlement.status)}
                          </Badge>
                          <span>{labelOf(MARKET_ENTITLEMENT_SCOPE_LABELS, entitlement.scope)}</span>
                          {entitlement.target && <span className="text-gray-500">{entitlement.target}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </DetailSection>

                <DetailSection title="파일별 다운로드 진단">
                  <div className="mb-2">
                    <DownloadSummaryBadge download={selectedOrder.download} />
                    {ownEntitlementNote(selectedOrder.download) && <p className="mt-1 text-xs text-gray-600">{ownEntitlementNote(selectedOrder.download)}</p>}
                  </div>
                  {selectedOrder.files.length === 0 ? (
                    <p className="text-sm text-gray-500">이 주문이 가리키는 파일이 없습니다.</p>
                  ) : (
                    <ul className="space-y-2">
                      {selectedOrder.files.map((file) => (
                        <li key={file.id} className={`rounded-md border p-3 text-sm ${file.removed ? 'bg-gray-50 text-gray-500' : ''}`}>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary" className={file.diagnosis.downloadable ? OK_BADGE_CLASS : file.removed ? '' : BLOCKED_BADGE_CLASS}>
                              {file.diagnosis.downloadable ? '가능' : `불가: ${labelOf(MARKET_DOWNLOAD_BLOCK_REASON_LABELS, file.diagnosis.reason)}`}
                            </Badge>
                            {file.diagnosis.entitlementOrderId && file.diagnosis.entitlementOrderId !== selectedOrder.id && (
                              <span className="text-xs text-gray-500">다른 주문({file.diagnosis.entitlementOrderId.slice(0, 8)}) 권한</span>
                            )}
                            <span className="break-all">{file.fileName}</span>
                          </div>
                          <p className="mt-1 text-xs text-gray-500">{[file.subproductTitle, file.fileTypeLabel].filter(Boolean).join(' · ') || '-'}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 text-xs text-gray-500">
                    회원이 실제로 받을 수 있는지를, 그 회원이 이 상품에 가진 모든 주문의 권한으로 판정합니다(이 주문의 권한 상태는 위 &lsquo;다운로드 권한&rsquo;에 있습니다).
                    파일 자체가 삭제·비활성이면 요약 건수에서 빼고, 구성·상품이 내려가 받을 수 없는 파일은 &lsquo;불가&rsquo;로 셉니다.
                    같은 상품의 권한이 여러 개면 환불 심사 중이 아닌 주문의 권한으로 받고, 다운로드 기록도 그 주문에 남습니다.
                    저장소에서 파일이 사라진 경우는 여기서 알 수 없습니다.
                  </p>
                </DetailSection>

                <DetailSection title="다운로드 기록">
                  {data?.downloadsUnavailable ? (
                    <p role="alert" className="text-sm text-red-700">다운로드 기록을 불러오지 못했습니다. 기록이 없는 것이 아닙니다.</p>
                  ) : selectedOrder.downloads.count === 0 && !data?.downloadsTruncated ? (
                    <p className="text-sm text-gray-500">다운로드 기록이 없습니다.</p>
                  ) : (
                    <>
                      <DetailList rows={[
                        ['다운로드 횟수', `${selectedOrder.downloads.count.toLocaleString()}회${data?.downloadsTruncated ? ' 이상 (기록이 많아 최근 것만 읽었습니다)' : ''}`],
                        ['최근 다운로드', formatDateTime(selectedOrder.downloads.latestAt)],
                      ]} />
                      <ul className="mt-2 space-y-1 text-xs text-gray-600">
                        {selectedOrder.downloads.recent.map((event) => (
                          <li key={event.id} className="break-all">{formatDateTime(event.createdAt)} · {event.fileName ?? '파일 정보 없음'}</li>
                        ))}
                      </ul>
                    </>
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
                            <Badge variant="secondary">{labelOf(MARKET_REFUND_REQUEST_STATUS_LABELS, refund.status)}</Badge>
                            <span>요청 {formatCredits(refund.requested_refund_credits)}</span>
                            {refund.approved_refund_credits != null && <span className="font-medium">환불 {formatCredits(refund.approved_refund_credits)}</span>}
                          </div>
                          <p className="mt-1 text-xs text-gray-500">요청 {formatDateTime(refund.created_at)} · 처리 {formatDateTime(refund.processed_at)}</p>
                          {refund.reason && <p className="mt-1 whitespace-pre-line break-all">사유: {refund.reason}</p>}
                          {refund.admin_note && <p className="mt-1 whitespace-pre-line break-all text-gray-500">관리자 메모: {refund.admin_note}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {selectedOrder.status === 'completed' ? (
                    <div className="mt-3 flex justify-end">
                      <Button type="button" size="sm" variant="adminAction" onClick={() => setExceptionOrderId(selectedOrder.id)}>
                        예외 환불
                      </Button>
                    </div>
                  ) : null}
                </DetailSection>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <MarketExceptionRefundDialog
        orderId={exceptionOrderId}
        onClose={() => setExceptionOrderId(null)}
        onDone={() => {
          setExceptionOrderId(null)
          setSelectedOrder(null)
          setLoaded(null)
          setReloadToken((token) => token + 1)
        }}
      />
    </div>
  )
}
