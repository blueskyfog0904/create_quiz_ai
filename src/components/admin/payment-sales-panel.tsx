'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { PAYMENT_ORDER_TTL_MINUTES } from '@/lib/payment-constants'
import type { PaymentSalesStatus } from '@/lib/payment-sales-status-server'

// 충전 판매 상태와 "충전 판매 중지" 버튼. 중지만 할 수 있고, 재개는 SQL Editor에서 한다.
export function PaymentSalesPanel({ status }: { status: PaymentSalesStatus | null }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleStop = async () => {
    setSubmitting(true)
    try {
      const response = await fetch('/api/admin/payments/sales-stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || '충전 판매를 중지하지 못했습니다.')
      }
      toast.success(data.message)
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '충전 판매를 중지하지 못했습니다.')
    } finally {
      setSubmitting(false)
      // 성공·실패와 무관하게 실제 상태를 다시 읽는다.
      router.refresh()
    }
  }

  if (!status) {
    return (
      <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
        충전 판매 상태를 확인하지 못했습니다. 새로고침해도 같으면 개발 담당자에게 알려 주세요.
      </div>
    )
  }

  const changedAt = new Date(status.changedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })

  if (!status.acceptsNewOrders) {
    return (
      <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
        <p className="font-semibold">
          충전 판매 중지됨 — 고객이 새로 충전할 수 없습니다
          ({[!status.masterAcceptsNewOrders && '전체 스위치', !status.payappAcceptsNewOrders && '페이앱 스위치'].filter(Boolean).join('·')} 꺼짐)
        </p>
        <p className="mt-1 break-all">
          마지막 변경: {changedAt} · {status.changedBy} · {status.changeTicket}
        </p>
        <p className="mt-1">이미 결제된 건의 지급·환불 처리는 계속됩니다. 재개는 원인을 해결한 뒤 운영 절차(SQL)로 합니다.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white px-4 py-3 text-sm">
      <p>
        <span className="font-semibold text-green-700">충전 판매 중</span>
        <span className="ml-2 text-gray-500">마지막 변경 {changedAt}</span>
      </p>
      <Button
        variant="outline"
        size="sm"
        className="border-red-300 text-red-700 hover:bg-red-50"
        onClick={() => {
          setReason('')
          setOpen(true)
        }}
      >
        충전 판매 중지
      </Button>

      <Dialog open={open} onOpenChange={(next) => !submitting && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>충전 판매 중지</DialogTitle>
            <DialogDescription>
              중지하면 모든 고객이 새 충전을 시작할 수 없게 됩니다. 이미 결제창을 연 고객은 최대 {PAYMENT_ORDER_TTL_MINUTES}분 안에
              결제를 마칠 수 있고, 그 건과 이미 결제된 건의 지급·환불 처리는 계속됩니다.
              이 화면에서는 다시 켤 수 없고, 재개는 운영 절차(SQL)로 합니다.
            </DialogDescription>
          </DialogHeader>
          <div>
            <label htmlFor="sales-stop-reason" className="mb-2 block text-sm font-medium text-gray-700">
              중지 사유 (필수)
            </label>
            <Textarea
              id="sales-stop-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={300}
              placeholder="무슨 일이 있어 중지하는지 적어 주세요."
            />
          </div>
          <DialogFooter className="justify-center gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              취소
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700"
              onClick={handleStop}
              disabled={submitting || reason.trim().length === 0}
            >
              {submitting ? '처리 중...' : '판매 중지'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
