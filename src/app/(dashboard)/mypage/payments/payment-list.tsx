'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CreditCard, Calendar, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { format } from 'date-fns'
import { ko } from 'date-fns/locale'
import type { NormalizedPaymentHistoryRecord } from '@/lib/payment-history'
import { HistoryFilterBar } from '@/components/features/mypage/history-filter-bar'
import {
  filterPaymentsByHistoryFilter,
  type PaymentHistoryFilter,
} from '@/lib/mypage-history-filters'

interface PaymentListProps {
  payments: NormalizedPaymentHistoryRecord[]
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

export function PaymentList({ payments }: PaymentListProps) {
  const [filters, setFilters] = useState<PaymentHistoryFilter>({
    fromDate: '',
    toDate: '',
  })

  const filteredPayments = useMemo(
    () => filterPaymentsByHistoryFilter(payments, filters),
    [filters, payments]
  )

  if (payments.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed bg-gray-50/50 p-12 text-center">
        <CreditCard className="mx-auto mb-4 h-12 w-12 text-gray-300" />
        <h3 className="mb-2 text-lg font-medium text-gray-900">결제 내역이 없습니다</h3>
        <p className="text-gray-500">
          아직 요금제를 실제로 결제하신 내역이 없습니다.
        </p>
      </div>
    )
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="border-none bg-green-100 text-green-700 hover:bg-green-100">결제 완료</Badge>
      case 'refunded':
        return <Badge variant="secondary" className="border-none bg-gray-100 text-gray-700 hover:bg-gray-100">환불 완료</Badge>
      case 'failed':
        return <Badge variant="destructive" className="border-none bg-red-100 text-red-700 hover:bg-red-100">결제 실패</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />
      case 'refunded':
        return <AlertCircle className="h-5 w-5 text-gray-400" />
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-500" />
      default:
        return <CreditCard className="h-5 w-5 text-gray-400" />
    }
  }

  return (
    <div className="space-y-4">
      <HistoryFilterBar
        initialValues={filters}
        onApply={(next) => setFilters({ fromDate: next.fromDate, toDate: next.toDate })}
        resultCount={filteredPayments.length}
      />

      {filteredPayments.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-gray-50/60 p-10 text-center text-sm text-gray-500">
          선택한 기간에 해당하는 결제 내역이 없습니다.
        </div>
      ) : null}

      {filteredPayments.map((payment) => (
        <Card key={payment.id} className="overflow-hidden transition-shadow hover:shadow-md">
          <CardContent className="p-0">
            <div className="flex flex-col justify-between gap-4 p-6 sm:flex-row sm:items-center">
              <div className="flex items-start gap-4">
                <div className="mt-1 rounded-full bg-gray-100 p-3 sm:mt-0">
                  {getStatusIcon(payment.status)}
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">
                      {payment.pricing_plans?.name || '요금제 결제'}
                    </h3>
                    {getStatusBadge(payment.status)}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {format(new Date(payment.created_at), 'yyyy년 MM월 dd일 HH:mm', { locale: ko })}
                    </div>
                    <div className="flex items-center gap-1">
                      <CreditCard className="h-3.5 w-3.5" />
                      {payment.payment_method === 'toss' ? '토스페이먼츠' : payment.payment_method}
                    </div>
                    {payment.order_id && (
                      <span>주문번호 {payment.order_id}</span>
                    )}
                    <span>
                      결제사 상태 {getProviderStatusLabel(payment.provider_status)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pl-14 text-right sm:pl-0">
                <span
                  className={`text-lg font-bold ${
                    payment.status === 'refunded'
                      ? 'text-gray-400 line-through'
                      : payment.status === 'failed'
                        ? 'text-red-500'
                        : 'text-gray-900'
                  }`}
                >
                  ₩{payment.amount.toLocaleString()}
                </span>
                {payment.status === 'refunded' && (
                  <p className="text-xs font-medium text-red-500">환불됨</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
