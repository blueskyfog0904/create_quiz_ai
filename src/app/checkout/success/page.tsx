'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { CheckCircle2, CircleAlert, Coins, Loader2 } from 'lucide-react'
import { StudioContainer } from '@/components/design-system'
import { Button } from '@/components/ui/button'

type ResultStatus = 'loading' | 'success' | 'error'

interface PaymentInfo {
  credits?: number
  newBalance?: number
  orderName?: string
  method?: string
}

function ResultFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="studio-theme min-h-screen bg-[var(--studio-background)]">
      <StudioContainer className="grid min-h-screen items-center py-8 lg:grid-cols-3">
        <div className="min-w-0 lg:col-start-2">{children}</div>
      </StudioContainer>
    </div>
  )
}

function CheckoutSuccessContent() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<ResultStatus>('loading')
  const [message, setMessage] = useState('')
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null)

  useEffect(() => {
    let active = true

    const confirmPayment = async () => {
      try {
        const paymentKey = searchParams.get('paymentKey')
        const orderId = searchParams.get('orderId')
        const amount = searchParams.get('amount')

        if (!paymentKey || !orderId || !amount) {
          if (!active) return
          setStatus('error')
          setMessage('결제 정보가 올바르지 않습니다.')
          return
        }

        const response = await fetch('/api/payments/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paymentKey,
            orderId,
            amount: Number.parseInt(amount, 10),
          }),
        })
        const data = await response.json()
        if (!active) return

        if (response.ok && data.success) {
          setStatus('success')
          setMessage('결제와 크레딧 충전이 완료되었습니다.')
          setPaymentInfo({
            credits: data.credits,
            newBalance: data.newBalance,
            orderName: data.payment?.orderName,
            method: data.payment?.method,
          })
          return
        }

        setStatus('error')
        setMessage(data.error || '결제 승인에 실패했습니다.')
      } catch {
        if (!active) return
        setStatus('error')
        setMessage('결제 처리 중 오류가 발생했습니다.')
      }
    }

    void confirmPayment()
    return () => {
      active = false
    }
  }, [searchParams])

  const isLoading = status === 'loading'
  const isSuccess = status === 'success'

  return (
    <ResultFrame>
      <div
        aria-busy={isLoading}
        className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 text-center shadow-[var(--studio-shadow-card)] sm:p-8"
      >
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]">
          {isLoading ? (
            <Loader2
              aria-hidden="true"
              className="size-6 animate-spin motion-reduce:animate-none"
            />
          ) : isSuccess ? (
            <CheckCircle2 aria-hidden="true" className="size-6" />
          ) : (
            <CircleAlert aria-hidden="true" className="size-6" />
          )}
        </div>

        <h1 className="mt-5 text-2xl font-black tracking-[-0.03em] text-[var(--studio-ink)]">
          {isLoading
            ? '결제 확인 중'
            : isSuccess
              ? '크레딧 충전 완료'
              : '결제를 완료하지 못했습니다'}
        </h1>
        <p
          role={status === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          className="mt-3 break-keep text-sm leading-6 text-[var(--studio-muted)]"
        >
          {isLoading
            ? '결제 승인과 크레딧 충전을 확인하고 있습니다.'
            : message}
        </p>

        {isSuccess && paymentInfo ? (
          <dl className="mt-6 divide-y divide-[var(--studio-border)] border-y border-[var(--studio-border)] text-sm">
            <div className="flex min-w-0 items-center justify-between gap-4 py-3">
              <dt className="text-[var(--studio-muted)]">상품</dt>
              <dd className="min-w-0 break-words text-right font-bold text-[var(--studio-ink)]">
                {paymentInfo.orderName}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-[var(--studio-muted)]">결제수단</dt>
              <dd className="font-bold text-[var(--studio-ink)]">
                {paymentInfo.method}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="text-[var(--studio-muted)]">충전 크레딧</dt>
              <dd className="font-bold text-[var(--studio-primary)]">
                +{paymentInfo.credits?.toLocaleString()} 크레딧
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-3">
              <dt className="flex items-center gap-2 text-[var(--studio-muted)]">
                <Coins aria-hidden="true" className="size-4" />
                현재 보유 크레딧
              </dt>
              <dd className="font-bold text-[var(--studio-ink)]">
                {paymentInfo.newBalance?.toLocaleString()} 크레딧
              </dd>
            </div>
          </dl>
        ) : null}

        {!isLoading ? (
          <div className="mt-7 flex flex-col gap-2 sm:flex-row">
            <Button asChild variant="brand" className="min-h-11 flex-1">
              <Link href={isSuccess ? '/mypage/credits' : '/pricing'}>
                {isSuccess ? '크레딧 내역 보기' : '충전 상품으로 돌아가기'}
              </Link>
            </Button>
            <Button asChild variant="brandOutline" className="min-h-11 flex-1">
              <Link href={isSuccess ? '/market' : '/mypage/support'}>
                {isSuccess ? '문제마켓 둘러보기' : '고객센터 문의'}
              </Link>
            </Button>
          </div>
        ) : null}
      </div>
    </ResultFrame>
  )
}

function CheckoutSuccessLoading() {
  return (
    <ResultFrame>
      <div className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-8 text-center shadow-[var(--studio-shadow-card)]">
        <Loader2
          aria-hidden="true"
          className="mx-auto size-8 animate-spin text-[var(--studio-primary)] motion-reduce:animate-none"
        />
        <p role="status" className="mt-4 text-sm text-[var(--studio-muted)]">
          결제 처리 중입니다.
        </p>
      </div>
    </ResultFrame>
  )
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={<CheckoutSuccessLoading />}>
      <CheckoutSuccessContent />
    </Suspense>
  )
}
