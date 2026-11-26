'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { StudioEmptyState } from '@/components/design-system/studio-empty-state'
import { StudioListPagination } from '@/components/design-system/studio-list-pagination'
import { useListQuery } from '@/hooks/use-list-query'
import { getListPagination } from '@/lib/list-pagination'
import {
  getPartialRefundAmount,
  getPaymentMethodLabel,
  getProviderStatusLabel,
  type NormalizedPaymentHistoryRecord,
} from '@/lib/payment-history'
import {
  buildQuickRangeFilter,
  filterPaymentsByHistoryFilter,
  type PaymentHistoryFilter,
} from '@/lib/mypage-history-filters'
import { formatKstDateTime } from '@/lib/kst-date-format'
import { formatMarketRefundLastDay } from '@/lib/market-refund-rules'
import type { PaymentChargeDetail } from '@/lib/mypage-payment-details-server'

const controlClassName =
  'min-h-10 rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm text-[var(--studio-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'

const QUICK_RANGES = [
  { label: '1개월', days: 30 },
  { label: '3개월', days: 90 },
  { label: '6개월', days: 180 },
] as const

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  completed: {
    label: '결제 완료',
    className: 'bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]',
  },
  refunded: {
    label: '환불 완료',
    className: 'bg-[var(--studio-background)] text-[var(--studio-muted)]',
  },
  failed: {
    label: '결제 실패',
    className: 'bg-[var(--studio-highlight)] text-[var(--studio-ink)]',
  },
}

function formatKoreanDateTime(value: string) {
  return formatKstDateTime(value)
}

const refundPolicyLinkClassName =
  'underline underline-offset-4 hover:text-[var(--studio-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'

// 결제 상세: 결제·지급 일시(한국 시간), 환불 신청 마감(DB 판정 값), 이 결제에 동의한 결제 전 확인 문구.
function PaymentDetail({ detail }: { detail: PaymentChargeDetail }) {
  const approvedText = detail.approvedAt ? formatKoreanDateTime(detail.approvedAt) : null
  const creditedText = detail.creditedAt ? formatKoreanDateTime(detail.creditedAt) : null
  return (
    <details className="mt-2 text-xs text-[var(--studio-text)]">
      <summary className="inline-flex min-h-9 cursor-pointer items-center font-medium text-[var(--studio-muted)] hover:text-[var(--studio-ink)]">
        결제 상세·결제 전 확인
      </summary>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-keep">
        {approvedText ? (
          <>
            <dt className="text-[var(--studio-muted)]">결제 일시</dt>
            <dd>{approvedText}(한국 시간)</dd>
          </>
        ) : null}
        {creditedText && creditedText !== approvedText ? (
          <>
            <dt className="text-[var(--studio-muted)]">크레딧 지급 일시</dt>
            <dd>{creditedText}(한국 시간)</dd>
          </>
        ) : null}
        <dt className="text-[var(--studio-muted)]">환불 신청 마감</dt>
        <dd>
          {detail.refundDeadline.status === 'ok' ? (
            formatMarketRefundLastDay(detail.refundDeadline.refundableUntil)
          ) : detail.refundDeadline.status === 'unknown' ? (
            '확인할 수 없음'
          ) : (
            <Link href="/terms/refund" className={refundPolicyLinkClassName}>취소·환불정책 참고</Link>
          )}
        </dd>
      </dl>
      <div className="mt-2 rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] p-3">
        {detail.consent ? (
          // 11번: 2판(접는 동의) 기록 — 제목·요약 줄·항목 이름·본문. 링크 항목은 지금 문서 링크(원문의 링크 키 줄은 보이지 않음).
          <>
            <p className="font-semibold text-[var(--studio-ink)]">이 결제에 동의한 결제 전 확인</p>
            <p className="mt-1 break-keep font-semibold">{detail.consent.title}</p>
            <ul className="mt-1 list-disc space-y-0.5 break-keep pl-4">
              {detail.consent.summary.map((line, index) => <li key={index}>{line}</li>)}
            </ul>
            {detail.consent.items.map((item, index) => (
              <div key={index} className="mt-2">
                {item.view === 'text' ? (
                  <>
                    <p className="font-semibold text-[var(--studio-ink)]">{item.label}</p>
                    {item.texts.map((text, textIndex) => (
                      <p key={textIndex} className="mt-0.5 whitespace-pre-line break-keep">{text}</p>
                    ))}
                  </>
                ) : (
                  <p className="break-keep">
                    {item.href ? (
                      <Link href={item.href} className={refundPolicyLinkClassName}>{item.label}</Link>
                    ) : item.label}
                    <span className="ml-1 text-[var(--studio-muted)]">(결제 당시 판과 다를 수 있어요)</span>
                  </p>
                )}
              </div>
            ))}
          </>
        ) : detail.noticeText ? (
          <>
            <p className="font-semibold text-[var(--studio-ink)]">이 결제에 동의한 결제 전 확인</p>
            <p className="mt-1 whitespace-pre-line break-keep">{detail.noticeText}</p>
          </>
        ) : (
          <p className="break-keep">
            이 결제는 결제 전 확인 기록 이전 결제입니다 — 기준은{' '}
            <Link href="/terms/refund" className={refundPolicyLinkClassName}>취소·환불정책</Link>
          </p>
        )}
      </div>
    </details>
  )
}

export function PaymentsView({
  payments,
  details,
}: {
  payments: NormalizedPaymentHistoryRecord[]
  details: Record<string, PaymentChargeDetail>
}) {
  const listQuery = useListQuery()
  const filters = useMemo(() => ({ fromDate: listQuery.params.get('fromDate') ?? '', toDate: listQuery.params.get('toDate') ?? '' }), [listQuery.params])
  const setFilters = (value: PaymentHistoryFilter) => listQuery.update({ ...value, page: 1 })

  const filteredPayments = useMemo(
    () => filterPaymentsByHistoryFilter(payments, filters),
    [filters, payments]
  )

  const hasActiveFilter = Boolean(filters.fromDate || filters.toDate)
  const pagination = getListPagination(filteredPayments.length, listQuery.page, listQuery.pageSize)
  const pagedPayments = filteredPayments.slice(pagination.offset, pagination.offset + pagination.pageSize)

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--studio-ink)] sm:text-3xl">결제 내역</h1>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {QUICK_RANGES.map((range) => (
          <button
            key={range.days}
            type="button"
            onClick={() => setFilters(buildQuickRangeFilter(range.days))}
            className="inline-flex min-h-10 items-center rounded-lg border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3.5 text-sm font-medium text-[var(--studio-muted)] outline-none transition-colors hover:border-[var(--studio-ink)] hover:text-[var(--studio-ink)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
          >
            {range.label}
          </button>
        ))}
        <input
          type="date"
          aria-label="조회 시작일"
          value={filters.fromDate}
          onChange={(event) => setFilters({ ...filters, fromDate: event.target.value })}
          className={controlClassName}
        />
        <span className="text-sm text-[var(--studio-muted)]">~</span>
        <input
          type="date"
          aria-label="조회 종료일"
          value={filters.toDate}
          onChange={(event) => setFilters({ ...filters, toDate: event.target.value })}
          className={controlClassName}
        />
        {hasActiveFilter ? (
          <button
            type="button"
            onClick={() => setFilters({ fromDate: '', toDate: '' })}
            className="inline-flex min-h-10 items-center rounded-lg px-2 text-sm font-medium text-[var(--studio-text)] outline-none transition-colors hover:text-[var(--studio-ink)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
          >
            초기화
          </button>
        ) : null}
        <span className="ml-auto text-sm text-[var(--studio-muted)]">총 {filteredPayments.length}건</span>
      </div>

      {payments.length === 0 ? (
        <div className="mt-6">
          <StudioEmptyState
            title="결제 내역이 없습니다"
            description="아직 충전 상품을 실제로 결제하신 내역이 없습니다."
          />
        </div>
      ) : filteredPayments.length === 0 ? (
        <div className="mt-6">
          <StudioEmptyState
            title="조회 결과가 없습니다"
            description="선택한 기간에 해당하는 결제 내역이 없습니다."
          />
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-[var(--studio-border)] rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)]">
          {pagedPayments.map((payment) => {
            const badge = STATUS_BADGES[payment.status] ?? {
              label: payment.status,
              className: 'bg-[var(--studio-background)] text-[var(--studio-muted)]',
            }
            return (
              <li key={payment.id} className="flex flex-col justify-between gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-semibold text-[var(--studio-ink)] break-keep">
                      {payment.pricing_plans?.name || '충전 상품 결제'}
                    </p>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}>
                      {badge.label}
                    </span>
                  </div>
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--studio-muted)]">
                    <span>{formatKoreanDateTime(payment.created_at)}</span>
                    <span>{getPaymentMethodLabel(payment)}</span>
                    {payment.order_id ? <span>주문번호 {payment.order_id}</span> : null}
                    <span>결제사 상태 {getProviderStatusLabel(payment.provider_status)}</span>
                  </p>
                  {details[payment.id] ? <PaymentDetail detail={details[payment.id]} /> : null}
                </div>
                <div className="shrink-0 text-right">
                  <span
                    className={`[font-family:var(--studio-font-price)] text-lg font-bold ${
                      payment.status === 'refunded'
                        ? 'text-[var(--studio-muted)] line-through'
                        : payment.status === 'failed'
                          ? 'text-red-500'
                          : 'text-[var(--studio-ink)]'
                    }`}
                  >
                    ₩{payment.amount.toLocaleString()}
                  </span>
                  {payment.status === 'refunded' ? (
                    <p className="text-xs font-medium text-red-500">환불됨</p>
                  ) : null}
                  {getPartialRefundAmount(payment) ? (
                    <p className="text-xs font-medium text-[var(--studio-muted)]">
                      부분 환불 {getPartialRefundAmount(payment)?.toLocaleString()}원
                    </p>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <StudioListPagination {...pagination} onPageChange={listQuery.setPage} onPageSizeChange={listQuery.setPageSize} />
    </div>
  )
}
