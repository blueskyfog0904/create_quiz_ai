import type { CreditSourceCategory } from '@/lib/credit-source-display'

export interface BaseHistoryFilter {
  fromDate: string
  toDate: string
}

export type PaymentHistoryFilter = BaseHistoryFilter

export interface CreditSourceHistoryFilter extends BaseHistoryFilter {
  sourceCategory: string
}

export interface CreditTransactionHistoryFilter extends BaseHistoryFilter {
  transactionType: string
}

interface DatedRecord {
  created_at?: string
  purchased_at?: string
}

interface SourceCategoryRecord extends DatedRecord {
  source_category: CreditSourceCategory
}

interface TransactionTypeRecord extends DatedRecord {
  type: string
}

function getRecordDate(record: DatedRecord): Date {
  return new Date(record.created_at ?? record.purchased_at ?? '')
}

function getStartOfDay(value: string): Date {
  return new Date(`${value}T00:00:00`)
}

function getEndOfDay(value: string): Date {
  return new Date(`${value}T23:59:59.999`)
}

export function matchesDateRange(record: DatedRecord, filter: BaseHistoryFilter): boolean {
  const target = getRecordDate(record)

  if (Number.isNaN(target.getTime())) {
    return false
  }

  if (filter.fromDate) {
    const from = getStartOfDay(filter.fromDate)
    if (target < from) {
      return false
    }
  }

  if (filter.toDate) {
    const to = getEndOfDay(filter.toDate)
    if (target > to) {
      return false
    }
  }

  return true
}

export function filterPaymentsByHistoryFilter<T extends DatedRecord>(
  payments: T[],
  filter: PaymentHistoryFilter
): T[] {
  return payments.filter((payment) => matchesDateRange(payment, filter))
}

export function filterCreditSourcesByHistoryFilter<T extends SourceCategoryRecord>(
  sources: T[],
  filter: CreditSourceHistoryFilter
): T[] {
  return sources.filter((source) => {
    if (!matchesDateRange(source, filter)) {
      return false
    }

    if (!filter.sourceCategory || filter.sourceCategory === 'all') {
      return true
    }

    return source.source_category === filter.sourceCategory
  })
}

export function filterCreditTransactionsByHistoryFilter<T extends TransactionTypeRecord>(
  transactions: T[],
  filter: CreditTransactionHistoryFilter
): T[] {
  return transactions.filter((transaction) => {
    if (!matchesDateRange(transaction, filter)) {
      return false
    }

    if (!filter.transactionType || filter.transactionType === 'all') {
      return true
    }

    return transaction.type === filter.transactionType
  })
}
