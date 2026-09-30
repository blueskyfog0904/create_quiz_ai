'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, ChevronLeft, Clock, Coins, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { StudioContainer, StudioEmptyState } from '@/components/design-system'
import { StudioListPagination } from '@/components/design-system/studio-list-pagination'
import { useListQuery } from '@/hooks/use-list-query'
import { getListPagination } from '@/lib/list-pagination'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getCreditSourceCategoryLabel, type CreditSourceCategory } from '@/lib/credit-source-display'
import {
  getCreditTransactionDescription,
  getCreditTransactionTypeLabel,
} from '@/lib/credit-transaction-display'
import {
  buildQuickRangeFilter,
  filterCreditSourcesByHistoryFilter,
  filterCreditTransactionsByHistoryFilter,
  type CreditSourceHistoryFilter,
  type CreditTransactionHistoryFilter,
} from '@/lib/mypage-history-filters'

export interface CreditSourceItem {
  id: string
  initial_credits: number
  remaining_credits: number
  status: 'active' | 'pending_refund' | 'refunded'
  purchased_at: string
  expires_at: string | null
  source_category: CreditSourceCategory
  canRefund: boolean
  refundBlockedReason: string | null
  refundableUntil: string | null
  plan: {
    name: string
    price: number
  } | null
}

export interface CreditTransactionItem {
  id: string
  type: string
  amount: number
  balance_after: number
  description: string
  created_at: string
  source?: {
    source_category: CreditSourceCategory
  } | null
}

interface CreditsViewProps {
  balance: number
  spendableBalance: number
  expiredBalance: number
  nextExpirationAt: string | null
  databaseNow: string
  sources: CreditSourceItem[]
  transactions: CreditTransactionItem[]
}

const controlClassName =
  'min-h-11 rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm text-[var(--studio-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'

const refundButtonClassName =
  'inline-flex min-h-9 items-center rounded-[var(--studio-radius-control)] border border-red-500 bg-[var(--studio-surface)] px-3 text-sm font-semibold text-red-600 transition-colors hover:bg-red-500 hover:text-white disabled:opacity-50 disabled:hover:bg-[var(--studio-surface)] disabled:hover:text-red-600 outline-none focus-visible:ring-2 focus-visible:ring-red-300'

const cardClassName =
  'rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 shadow-[var(--studio-shadow-card)] sm:p-7'

const badgeBaseClassName =
  'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold'

const QUICK_RANGES = [
  { label: '1개월', days: 30 },
  { label: '3개월', days: 90 },
  { label: '6개월', days: 180 },
]

function formatDate(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}.${month}.${day}`
}

function formatDateTime(value: string) {
  const date = new Date(value)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${formatDate(value)} ${hours}:${minutes}`
}

interface HistoryFilterValues {
  fromDate: string
  toDate: string
  category: string
}

interface HistoryFilterBarProps {
  categoryLabel: string
  categoryOptions: { value: string; label: string }[]
  values: HistoryFilterValues
  onChange: (next: HistoryFilterValues) => void
  resultCount: number
}

function HistoryFilterBar({
  categoryLabel,
  categoryOptions,
  values,
  onChange,
  resultCount,
}: HistoryFilterBarProps) {
  const [activeQuickDays, setActiveQuickDays] = useState<number | null>(null)

  const hasActiveFilter =
    values.fromDate !== '' || values.toDate !== '' || values.category !== 'all'

  return (
    <div className="mb-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {QUICK_RANGES.map((range) => {
          const active = activeQuickDays === range.days
          return (
            <button
              key={range.days}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setActiveQuickDays(range.days)
                onChange({ ...values, ...buildQuickRangeFilter(range.days) })
              }}
              className={`inline-flex min-h-10 items-center rounded-lg border bg-[var(--studio-surface)] px-3.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] ${
                active
                  ? 'border-[var(--studio-ink)] font-bold text-[var(--studio-ink)]'
                  : 'border-[var(--studio-control-border)] font-medium text-[var(--studio-muted)] hover:border-[var(--studio-ink)] hover:text-[var(--studio-ink)]'
              }`}
            >
              {range.label}
            </button>
          )
        })}
        <input
          type="date"
          value={values.fromDate}
          aria-label="기간 시작"
          onChange={(event) => {
            setActiveQuickDays(null)
            onChange({ ...values, fromDate: event.target.value })
          }}
          className={controlClassName}
        />
        <span aria-hidden="true" className="text-sm text-[var(--studio-muted)]">
          ~
        </span>
        <input
          type="date"
          value={values.toDate}
          aria-label="기간 종료"
          onChange={(event) => {
            setActiveQuickDays(null)
            onChange({ ...values, toDate: event.target.value })
          }}
          className={controlClassName}
        />
        <select
          value={values.category}
          aria-label={categoryLabel}
          onChange={(event) => onChange({ ...values, category: event.target.value })}
          className={controlClassName}
        >
          {categoryOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {hasActiveFilter && (
          <button
            type="button"
            onClick={() => {
              setActiveQuickDays(null)
              onChange({ fromDate: '', toDate: '', category: 'all' })
            }}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-[var(--studio-muted)] outline-none hover:text-[var(--studio-ink)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            초기화
          </button>
        )}
      </div>
      <p className="text-sm text-[var(--studio-muted)]">총 {resultCount}건</p>
    </div>
  )
}

export function CreditsView({
  balance,
  spendableBalance,
  expiredBalance,
  nextExpirationAt,
  databaseNow,
  sources,
  transactions,
}: CreditsViewProps) {
  const router = useRouter()
  const [refundSourceId, setRefundSourceId] = useState<string | null>(null)
  const [refundReason, setRefundReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const sourceQuery = useListQuery('source_')
  const transactionQuery = useListQuery('transaction_')
  const sourceFilters = useMemo(() => ({
    fromDate: sourceQuery.params.get('source_from') ?? '',
    toDate: sourceQuery.params.get('source_to') ?? '',
    sourceCategory: sourceQuery.params.get('source_category') ?? 'all',
  }), [sourceQuery.params])
  const transactionFilters = useMemo(() => ({
    fromDate: transactionQuery.params.get('transaction_from') ?? '',
    toDate: transactionQuery.params.get('transaction_to') ?? '',
    transactionType: transactionQuery.params.get('transaction_type') ?? 'all',
  }), [transactionQuery.params])
  const setSourceFilters = (next: CreditSourceHistoryFilter) => sourceQuery.update({ source_from: next.fromDate, source_to: next.toDate, source_category: next.sourceCategory, source_page: 1 })
  const setTransactionFilters = (next: CreditTransactionHistoryFilter) => transactionQuery.update({ transaction_from: next.fromDate, transaction_to: next.toDate, transaction_type: next.transactionType, transaction_page: 1 })

  const filteredSources = useMemo(
    () => filterCreditSourcesByHistoryFilter(sources, sourceFilters),
    [sourceFilters, sources]
  )

  const filteredTransactions = useMemo(
    () => filterCreditTransactionsByHistoryFilter(transactions, transactionFilters),
    [transactionFilters, transactions]
  )

  const refundSource = refundSourceId
    ? sources.find((source) => source.id === refundSourceId) ?? null
    : null
  const sourcePagination = getListPagination(filteredSources.length, sourceQuery.page, sourceQuery.pageSize)
  const transactionPagination = getListPagination(filteredTransactions.length, transactionQuery.page, transactionQuery.pageSize)
  const pagedSources = filteredSources.slice(sourcePagination.offset, sourcePagination.offset + sourcePagination.pageSize)
  const pagedTransactions = filteredTransactions.slice(transactionPagination.offset, transactionPagination.offset + transactionPagination.pageSize)

  const isExpired = (source: CreditSourceItem) =>
    source.expires_at !== null &&
    new Date(source.expires_at).getTime() <= new Date(databaseNow).getTime()

  const handleRefundRequest = async () => {
    if (!refundSource) return

    setIsSubmitting(true)
    try {
      const response = await fetch('/api/refunds/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: refundSource.id,
          reason: refundReason || '사유 없음',
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '환불 요청 중 오류가 발생했습니다.')
      }

      toast.success(data.message)
      setRefundSourceId(null)
      setRefundReason('')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '환불 요청 중 오류가 발생했습니다.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const getStatusBadge = (source: CreditSourceItem) => {
    if (isExpired(source)) {
      return (
        <span className={`${badgeBaseClassName} bg-[var(--studio-background)] text-[var(--studio-muted)]`}>
          사용기한 만료
        </span>
      )
    }

    switch (source.status) {
      case 'active':
        return (
          <span className={`${badgeBaseClassName} bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]`}>
            사용 가능
          </span>
        )
      case 'pending_refund':
        return (
          <span className={`${badgeBaseClassName} bg-[var(--studio-highlight)] text-[var(--studio-ink)]`}>
            환불 대기
          </span>
        )
      case 'refunded':
        return (
          <span className={`${badgeBaseClassName} bg-[var(--studio-background)] text-[var(--studio-muted)]`}>
            환불 완료
          </span>
        )
      default:
        return (
          <span className={`${badgeBaseClassName} bg-[var(--studio-background)] text-[var(--studio-muted)]`}>
            {source.status}
          </span>
        )
    }
  }

  const getTypeBadge = (transaction: CreditTransactionItem) => {
    const label = getCreditTransactionTypeLabel(transaction)
    const className =
      label === '충전' || label === '지급'
        ? `${badgeBaseClassName} bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]`
        : label === '환불'
          ? `${badgeBaseClassName} bg-[var(--studio-highlight)] text-[var(--studio-ink)]`
          : `${badgeBaseClassName} bg-[var(--studio-background)] text-[var(--studio-muted)]`

    return <span className={className}>{label}</span>
  }

  const sourceCategoryOptions = [
    { value: 'all', label: '구분 전체' },
    { value: 'plan_purchase', label: '요금제 구매' },
    { value: 'admin_grant', label: '관리자 지급' },
    { value: 'system_refund', label: '환불' },
    { value: 'bonus', label: '보너스' },
    { value: 'legacy_unknown', label: '기타 지급' },
  ]

  const transactionTypeOptions = [
    { value: 'all', label: '유형 전체' },
    { value: 'purchase', label: '충전/지급' },
    { value: 'consume', label: '사용' },
    { value: 'refund', label: '환불' },
    { value: 'admin_grant', label: '지급' },
  ]

  return (
    <StudioContainer className="py-8 sm:py-10">
      <Link
        href="/mypage"
        className="inline-flex min-h-9 items-center gap-1 rounded-md text-sm font-medium text-[var(--studio-muted)] outline-none hover:text-[var(--studio-ink)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
      >
        <ChevronLeft aria-hidden="true" className="h-4 w-4" />
        마이페이지
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-[var(--studio-ink)] sm:text-3xl">크레딧 관리</h1>
      <p className="mt-2 break-keep text-sm text-[var(--studio-muted)]">
        크레딧 잔액과 구매·거래 내역을 확인하고 환불을 신청할 수 있습니다.
      </p>

      {/* 잔액 카드 */}
      <section aria-label="크레딧 잔액" className={`mt-6 ${cardClassName}`}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-[var(--studio-muted)]">
              <Coins aria-hidden="true" className="h-4 w-4 text-[var(--studio-primary)]" />
              현재 보유 크레딧
            </p>
            <p className="mt-2 text-4xl font-bold text-[var(--studio-ink)] sm:text-5xl">
              {balance.toLocaleString()}
              <span className="ml-1 text-lg font-semibold text-[var(--studio-muted)]">크레딧</span>
            </p>
            {nextExpirationAt && (
              <p className="mt-2 text-xs text-[var(--studio-muted)]">
                다음 사용기한 {formatDate(nextExpirationAt)}
              </p>
            )}
            {expiredBalance > 0 && (
              <p className="mt-1 text-xs text-[var(--studio-muted)]">
                만료 크레딧 {expiredBalance.toLocaleString()}C
              </p>
            )}
            <span className="sr-only">
              사용 가능 잔액 {spendableBalance.toLocaleString()} 크레딧
            </span>
          </div>
          <Button asChild variant="brand" className="min-h-11 px-5">
            <Link href="/pricing">크레딧 충전</Link>
          </Button>
        </div>
      </section>

      {/* 충전·사용 경로 (컴플라이언스) */}
      <section aria-label="크레딧 충전·사용 경로" className={`mt-4 ${cardClassName}`}>
        <h2 className="text-base font-bold text-[var(--studio-ink)]">크레딧 충전·사용 경로</h2>
        <p className="mt-1 break-keep text-sm text-[var(--studio-muted)]">
          충전한 크레딧은 문제마켓 자료 구매에 사용됩니다.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild variant="outline" className="min-h-11">
            <Link href="/pricing">크레딧 충전</Link>
          </Button>
          <Button asChild variant="outline" className="min-h-11">
            <Link href="/mypage/payments">결제 내역</Link>
          </Button>
          <Button asChild variant="outline" className="min-h-11">
            <Link href="/terms/refund">취소/환불정책</Link>
          </Button>
        </div>
      </section>

      {/* 구매/거래 내역 탭 */}
      <Tabs value={sourceQuery.params.get('tab') === 'transactions' ? 'transactions' : 'sources'} onValueChange={(tab) => sourceQuery.update({ tab })} className="mt-8 gap-0">
        <div className="overflow-x-auto border-b border-[var(--studio-border)]">
          <TabsList variant="line" aria-label="크레딧 내역 메뉴" className="h-14 min-w-max gap-5 px-1">
            <TabsTrigger value="sources" className="min-h-11 px-2 font-bold">
              구매 내역
            </TabsTrigger>
            <TabsTrigger value="transactions" className="min-h-11 px-2 font-bold">
              거래 내역
            </TabsTrigger>
          </TabsList>
        </div>

        {/* 구매건 목록 */}
        <TabsContent value="sources" className="pt-6">
          <p className="mb-5 break-keep text-sm text-[var(--studio-muted)]">
            각 구매건의 잔여 크레딧과 환불 가능 여부를 확인할 수 있습니다. 크레딧은 가장 오래된
            구매건부터 차감됩니다.
          </p>
          {sources.length === 0 ? (
            <StudioEmptyState
              icon={<Coins className="size-6" aria-hidden />}
              title="아직 구매 내역이 없습니다"
              description="크레딧을 충전하면 구매건별 잔여 크레딧과 환불 가능 여부를 확인할 수 있습니다."
              action={
                <Link
                  href="/pricing"
                  className="inline-flex min-h-11 items-center rounded-[var(--studio-radius-control)] bg-[var(--studio-primary)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[var(--studio-primary-hover)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                >
                  요금제 보기
                </Link>
              }
            />
          ) : (
            <>
              <HistoryFilterBar
                categoryLabel="구분"
                categoryOptions={sourceCategoryOptions}
                values={{
                  fromDate: sourceFilters.fromDate,
                  toDate: sourceFilters.toDate,
                  category: sourceFilters.sourceCategory,
                }}
                onChange={(next) =>
                  setSourceFilters({
                    fromDate: next.fromDate,
                    toDate: next.toDate,
                    sourceCategory: next.category,
                  })
                }
                resultCount={filteredSources.length}
              />

              {filteredSources.length === 0 ? (
                <div className="rounded-[var(--studio-radius-card)] bg-[var(--studio-background)] p-10 text-center text-sm text-[var(--studio-muted)]">
                  선택한 조건에 해당하는 구매 내역이 없습니다.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] shadow-[var(--studio-shadow-card)]">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-[var(--studio-border)] text-xs text-[var(--studio-muted)]">
                        <th scope="col" className="px-4 py-3 font-medium">구매일</th>
                        <th scope="col" className="px-4 py-3 font-medium">사용기한</th>
                        <th scope="col" className="px-4 py-3 font-medium">환불 신청 마감</th>
                        <th scope="col" className="px-4 py-3 font-medium">구분</th>
                        <th scope="col" className="px-4 py-3 text-right font-medium">구매 크레딧</th>
                        <th scope="col" className="px-4 py-3 text-right font-medium">잔여 크레딧</th>
                        <th scope="col" className="px-4 py-3 font-medium">상태</th>
                        <th scope="col" className="px-4 py-3 text-right font-medium">환불</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--studio-border)]">
                      {pagedSources.map((source) => (
                        <tr key={source.id} className="text-[var(--studio-ink)]">
                          <td className="px-4 py-3">{formatDate(source.purchased_at)}</td>
                          <td className="px-4 py-3">
                            {source.expires_at ? formatDate(source.expires_at) : '별도 기한 없음'}
                          </td>
                          <td className="px-4 py-3">
                            {source.refundableUntil ? formatDate(source.refundableUntil) : '-'}
                          </td>
                          <td className="break-keep px-4 py-3">
                            {getCreditSourceCategoryLabel({
                              status: source.status,
                              plan: source.plan,
                              sourceCategory: source.source_category,
                            })}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {source.initial_credits.toLocaleString()}
                          </td>
                          <td
                            className={`px-4 py-3 text-right ${
                              source.remaining_credits === 0
                                ? 'text-[var(--studio-muted)]'
                                : 'font-semibold'
                            }`}
                          >
                            {source.remaining_credits.toLocaleString()}
                          </td>
                          <td className="px-4 py-3">{getStatusBadge(source)}</td>
                          <td className="px-4 py-3 text-right">
                            {source.status === 'active' && (
                              <button
                                type="button"
                                disabled={!source.canRefund}
                                title={source.refundBlockedReason || undefined}
                                onClick={() => setRefundSourceId(source.id)}
                                className={`${refundButtonClassName} break-keep`}
                              >
                                {source.canRefund ? '환불 신청' : source.refundBlockedReason}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        <StudioListPagination {...sourcePagination} onPageChange={sourceQuery.setPage} onPageSizeChange={sourceQuery.setPageSize} />
        </TabsContent>

        {/* 거래 내역 */}
        <TabsContent value="transactions" className="pt-6">
          <p className="mb-5 break-keep text-sm text-[var(--studio-muted)]">
            크레딧 충전 및 사용 내역입니다.
          </p>
          {transactions.length === 0 ? (
            <StudioEmptyState
              icon={<Clock className="size-6" aria-hidden />}
              title="아직 거래 내역이 없습니다"
              description="크레딧을 충전하거나 사용하면 이곳에서 내역을 확인할 수 있습니다."
            />
          ) : (
            <>
              <HistoryFilterBar
                categoryLabel="유형"
                categoryOptions={transactionTypeOptions}
                values={{
                  fromDate: transactionFilters.fromDate,
                  toDate: transactionFilters.toDate,
                  category: transactionFilters.transactionType,
                }}
                onChange={(next) =>
                  setTransactionFilters({
                    fromDate: next.fromDate,
                    toDate: next.toDate,
                    transactionType: next.category,
                  })
                }
                resultCount={filteredTransactions.length}
              />

              {filteredTransactions.length === 0 ? (
                <div className="rounded-[var(--studio-radius-card)] bg-[var(--studio-background)] p-10 text-center text-sm text-[var(--studio-muted)]">
                  선택한 조건에 해당하는 거래 내역이 없습니다.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] shadow-[var(--studio-shadow-card)]">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-[var(--studio-border)] text-xs text-[var(--studio-muted)]">
                        <th scope="col" className="px-4 py-3 font-medium">일시</th>
                        <th scope="col" className="px-4 py-3 font-medium">유형</th>
                        <th scope="col" className="px-4 py-3 font-medium">내용</th>
                        <th scope="col" className="px-4 py-3 text-right font-medium">변동</th>
                        <th scope="col" className="px-4 py-3 text-right font-medium">잔액</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--studio-border)]">
                      {pagedTransactions.map((tx) => (
                        <tr key={tx.id} className="text-[var(--studio-ink)]">
                          <td className="whitespace-nowrap px-4 py-3 text-[var(--studio-muted)]">
                            {formatDateTime(tx.created_at)}
                          </td>
                          <td className="px-4 py-3">{getTypeBadge(tx)}</td>
                          <td className="break-keep px-4 py-3">
                            {getCreditTransactionDescription(tx)}
                          </td>
                          <td
                            className={`px-4 py-3 text-right font-semibold ${
                              tx.amount > 0
                                ? 'text-[var(--studio-primary)]'
                                : 'text-[var(--studio-ink)]'
                            }`}
                          >
                            {tx.amount > 0 ? '+' : ''}
                            {tx.amount.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--studio-muted)]">
                            {tx.balance_after.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        <StudioListPagination {...transactionPagination} onPageChange={transactionQuery.setPage} onPageSizeChange={transactionQuery.setPageSize} />
        </TabsContent>
      </Tabs>

      {/* 환불 신청 다이얼로그 */}
      <Dialog
        open={refundSource !== null}
        onOpenChange={(open) => {
          if (!open) setRefundSourceId(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>환불 신청</DialogTitle>
            <DialogDescription className="break-keep">
              {refundSource && (
                <>
                  <strong>
                    {getCreditSourceCategoryLabel({
                      status: refundSource.status,
                      plan: refundSource.plan,
                      sourceCategory: refundSource.source_category,
                    })}
                  </strong>{' '}
                  ({refundSource.initial_credits.toLocaleString()} 크레딧)에 대한 환불을 신청합니다.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg bg-[var(--studio-background)] p-4">
            <div className="flex gap-2">
              <AlertCircle
                aria-hidden="true"
                className="h-5 w-5 shrink-0 text-[var(--studio-primary)]"
              />
              <div className="break-keep text-sm text-[var(--studio-text,var(--studio-ink))]">
                <p className="mb-1 font-semibold text-[var(--studio-ink)]">환불 안내</p>
                <ul className="list-inside list-disc space-y-1">
                  <li>환불 신청 후 관리자 승인 절차가 필요합니다.</li>
                  <li>환불 대기 중에는 해당 크레딧을 사용할 수 없습니다.</li>
                  <li>승인 시 결제 금액이 환불됩니다.</li>
                </ul>
              </div>
            </div>
          </div>

          <div>
            <label
              htmlFor="refund-reason"
              className="mb-2 block text-sm font-medium text-[var(--studio-ink)]"
            >
              환불 사유 (선택)
            </label>
            <textarea
              id="refund-reason"
              rows={3}
              maxLength={500}
              placeholder="환불 사유를 입력해주세요"
              value={refundReason}
              onChange={(event) => setRefundReason(event.target.value)}
              className={`${controlClassName} w-full resize-y py-2`}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => setRefundSourceId(null)}
              disabled={isSubmitting}
            >
              취소
            </Button>
            <button
              type="button"
              onClick={handleRefundRequest}
              disabled={isSubmitting}
              className={`${refundButtonClassName} min-h-11 justify-center px-5`}
            >
              {isSubmitting ? '신청 중…' : '환불 신청'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StudioContainer>
  )
}
