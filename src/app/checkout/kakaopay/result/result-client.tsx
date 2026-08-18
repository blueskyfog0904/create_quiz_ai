'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, CircleAlert, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

type ResultStatus = 'loading' | 'pending' | 'completed' | 'failed' | 'invalid'

interface PublicPaymentResult {
  status: Exclude<ResultStatus, 'loading'>
  planName?: string
  amount?: number
  credits?: number
  message: string
}

const initialResult: PublicPaymentResult = {
  status: 'pending',
  message: '카카오페이 결제 결과를 확인하고 있습니다.',
}

export function KakaoPayResultClient() {
  const [result, setResult] = useState<PublicPaymentResult>(initialResult)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let attempt = 0

    const loadResult = async () => {
      try {
        const response = await fetch('/api/payments/kakaopay/status', {
          cache: 'no-store',
        })
        const body = await response.json() as PublicPaymentResult
        if (!active) return
        setResult(body)
        setLoading(false)

        if (body.status === 'pending' && attempt < 14) {
          attempt += 1
          timeoutId = setTimeout(loadResult, 2_000)
        }
      } catch {
        if (!active) return
        setResult({
          status: 'pending',
          message: '결제 결과 확인이 지연되고 있습니다. 잠시 후 다시 확인해 주세요.',
        })
        setLoading(false)
      }
    }

    void loadResult()

    return () => {
      active = false
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [])

  const status = loading ? 'loading' : result.status
  const isCompleted = status === 'completed'
  const isPending = status === 'loading' || status === 'pending'

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
            : '결제를 완료하지 못했습니다'}
      </h1>
      <p
        role={status === 'failed' || status === 'invalid' ? 'alert' : 'status'}
        aria-live={isPending ? 'polite' : undefined}
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
          <Link href="/mypage/credits">크레딧 내역 보기</Link>
        </Button>
        <Button asChild variant="brandOutline" className="w-full sm:w-auto">
          <Link href="/pricing">충전 상품으로 돌아가기</Link>
        </Button>
      </div>
    </div>
  )
}
