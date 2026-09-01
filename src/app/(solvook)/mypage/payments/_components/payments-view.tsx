'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { CreditCard } from 'lucide-react'
import { StudioContainer } from '@/components/design-system/studio-container'
import { StudioEmptyState } from '@/components/design-system/studio-empty-state'
import type { NormalizedPaymentHistoryRecord } from '@/lib/payment-history'
import {
  buildQuickRangeFilter,
  filterPaymentsByHistoryFilter,
  type PaymentHistoryFilter,
} from '@/lib/mypage-history-filters'

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

function getProviderStatusLabel(providerStatus?: string | null) {
  switch (providerStatus) {
    case 'DONE':
      return '승인 완료'
    case 'CANCELED':
      return '결제 취소 완료'
    default:
      return providerStatus ?? '상태 확인 중'
  }
}

function formatKoreanDateTime(value: string) {
  const date = new Date(value)
  const day = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
  return `${day} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function PaymentsView({ payments }: { payments: NormalizedPaymentHistoryRecord[] }) {
  const [filters, setFilters] = useState<PaymentHistoryFilter>({ fromDate: '', toDate: '' })

  const filteredPayments = useMemo(
    () => filterPaymentsByHistoryFilter(payments, filters),
    [filters, payments]
  )

  const hasActiveFilter = Boolean(filters.fromDate || filters.toDate)

  return (
    <StudioContainer className="py-8 sm:py-10">
      <Link
        href="/mypage"
        className="inline-flex min-h-9 items-center rounded-[var(--studio-radius-control)] text-sm font-medium text-[var(--studio-muted)] outline-none transition-colors hover:text-[var(--studio-ink)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
      >
        ← 마이페이지
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-[var(--studio-ink)] sm:text-3xl">결제 내역</h1>
      <p className="mt-2 text-sm text-[var(--studio-muted)] break-keep">
        요금제에서 실제로 결제한 구매 및 환불 기록을 확인하실 수 있습니다.
      </p>

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
          onChange={(event) => setFilters((current) => ({ ...current, fromDate: event.target.value }))}
          className={controlClassName}
        />
        <span className="text-sm text-[var(--studio-muted)]">~</span>
        <input
          type="date"
          aria-label="조회 종료일"
          value={filters.toDate}
          onChange={(event) => setFilters((current) => ({ ...current, toDate: event.target.value }))}
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
            icon={<CreditCard aria-hidden="true" className="size-6" />}
            title="결제 내역이 없습니다"
            description="아직 요금제를 실제로 결제하신 내역이 없습니다."
          />
        </div>
      ) : filteredPayments.length === 0 ? (
        <div className="mt-6">
          <StudioEmptyState
            icon={<CreditCard aria-hidden="true" className="size-6" />}
            title="조회 결과가 없습니다"
            description="선택한 기간에 해당하는 결제 내역이 없습니다."
          />
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-[var(--studio-border)] rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] shadow-[var(--studio-shadow-card)]">
          {filteredPayments.map((payment) => {
            const badge = STATUS_BADGES[payment.status] ?? {
              label: payment.status,
              className: 'bg-[var(--studio-background)] text-[var(--studio-muted)]',
            }
            return (
              <li key={payment.id} className="flex flex-col justify-between gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-semibold text-[var(--studio-ink)] break-keep">
                      {payment.pricing_plans?.name || '요금제 결제'}
                    </p>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}>
                      {badge.label}
                    </span>
                  </div>
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--studio-muted)]">
                    <span>{formatKoreanDateTime(payment.created_at)}</span>
                    <span>{payment.payment_method === 'toss' ? '토스페이먼츠' : payment.payment_method}</span>
                    {payment.order_id ? <span>주문번호 {payment.order_id}</span> : null}
                    <span>결제사 상태 {getProviderStatusLabel(payment.provider_status)}</span>
                  </p>
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
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </StudioContainer>
  )
}
