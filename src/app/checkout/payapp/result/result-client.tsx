'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, CircleAlert, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

type ResultStatus = 'loading' | 'pending' | 'completed' | 'failed' | 'expired' | 'refunded' | 'invalid'

interface PublicPaymentResult {
  status: Exclude<ResultStatus, 'loading'>
  code?: string
  planName?: string
  amount?: number
  credits?: number
  message: string
}

// 2초 간격으로 약 60초까지 확인한다.
const POLL_INTERVAL_MS = 2_000
const MAX_POLL_ATTEMPTS = 30

const initialResult: PublicPaymentResult = {
  status: 'pending',
  message: '결제 결과를 확인하고 있습니다.',
}

const delayedMessage = '결제를 확인하고 있습니다. 확인되면 크레딧이 자동으로 충전되며, 마이페이지 결제내역에서 확인할 수 있습니다.'

export function PayAppResultClient({ orderId }: { orderId: string }) {
  const [result, setResult] = useState<PublicPaymentResult>(initialResult)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let attempt = 0

    const loadResult = async () => {
      try {
        const response = await fetch(
          `/api/payments/payapp/status?orderId=${encodeURIComponent(orderId)}`,
          { cache: 'no-store' }
        )
        const body = await response.json() as PublicPaymentResult
        if (!active) return

        attempt += 1
        if (body.status === 'pending' && attempt >= MAX_POLL_ATTEMPTS) {
          setResult({ ...body, message: delayedMessage })
        } else {
          setResult(body)
        }
        setLoading(false)

        if (body.status === 'pending' && attempt < MAX_POLL_ATTEMPTS) {
          timeoutId = setTimeout(loadResult, POLL_INTERVAL_MS)
        }
      } catch {
        if (!active) return
        // 일시적인 네트워크 오류는 남은 횟수 안에서 다시 확인한다.
        attempt += 1
        setResult({ status: 'pending', message: delayedMessage })
        setLoading(false)
        if (attempt < MAX_POLL_ATTEMPTS) {
          timeoutId = setTimeout(loadResult, POLL_INTERVAL_MS)
        }
      }
    }

    void loadResult()

    return () => {
      active = false
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [orderId])

  const status = loading ? 'loading' : result.status
  const isCompleted = status === 'completed'
  const isPending = status === 'loading' || status === 'pending'
  const authRequired = result.code === 'AUTH_REQUIRED'
  const loginHref = `/login?next=${encodeURIComponent(`/checkout/payapp/result?orderId=${orderId}`)}`

  return (
    <div
      aria-busy={isPending}
      className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 text-center shadow-[var(--studio-shadow-card)] sm:p-8"
    >
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]">
        {isPending ? (
          <LoaderCircle
            aria-hidden="true"
            className="size-6 animate-spin motion-reduce:animate-none"
          />
        ) : isCompleted ? (
          <CheckCircle2 aria-hidden="true" className="size-6" />
        ) : (
          <CircleAlert aria-hidden="true" className="size-6" />
        )}
      </div>

      <h1 className="mt-5 text-2xl font-black tracking-[-0.03em] text-[var(--studio-ink)]">
        {isPending
          ? '결제 결과 확인 중'
          : isCompleted
            ? '크레딧 충전 완료'
            : status === 'refunded'
              ? '취소된 결제'
              : status === 'invalid'
                ? '결제 결과를 확인할 수 없습니다'
                : '결제를 완료하지 못했습니다'}
      </h1>
      <p
        role="status"
        aria-live="polite"
        className="mt-3 break-keep text-sm leading-6 text-[var(--studio-muted)]"
      >
        {result.message}
      </p>

      {result.planName && (
        <dl className="mt-6 divide-y divide-[var(--studio-border)] border-y border-[var(--studio-border)] text-sm">
          <div className="flex min-w-0 items-center justify-between gap-4 py-3">
            <dt className="text-[var(--studio-muted)]">상품</dt>
            <dd className="min-w-0 break-words text-right font-bold text-[var(--studio-ink)]">
              {result.planName}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <dt className="text-[var(--studio-muted)]">결제금액</dt>
            <dd className="font-bold text-[var(--studio-ink)]">
              {result.amount?.toLocaleString()}원
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <dt className="text-[var(--studio-muted)]">충전 크레딧</dt>
            <dd className="font-bold text-[var(--studio-primary)]">
              {result.credits?.toLocaleString()} 크레딧
            </dd>
          </div>
        </dl>
      )}

      <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button asChild variant="brand" className="w-full sm:w-auto">
          {authRequired ? (
            <Link href={loginHref}>로그인하고 확인하기</Link>
          ) : (
            <Link href={isCompleted ? '/mypage/credits' : '/mypage/payments'}>
              {isCompleted ? '크레딧 내역 보기' : '결제내역 보기'}
            </Link>
          )}
        </Button>
        <Button asChild variant="brandOutline" className="w-full sm:w-auto">
          <Link href="/pricing">충전 상품으로 돌아가기</Link>
        </Button>
      </div>
    </div>
  )
}
