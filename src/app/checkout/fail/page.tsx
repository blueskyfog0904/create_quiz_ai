'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, CircleAlert, Loader2, MessageCircle } from 'lucide-react'
import { StudioContainer } from '@/components/design-system'
import { Button } from '@/components/ui/button'

const errorDescriptions: Record<string, string> = {
  PAY_PROCESS_CANCELED: '결제가 취소되었으며 금액은 청구되지 않았습니다.',
  PAY_PROCESS_ABORTED: '결제가 중단되었습니다.',
  REJECT_CARD_COMPANY: '카드사에서 결제를 거부했습니다.',
  INVALID_CARD_EXPIRATION: '카드 유효기간이 올바르지 않습니다.',
  INVALID_CARD_NUMBER: '카드 번호가 올바르지 않습니다.',
  INVALID_CARD_LOST_OR_STOLEN: '분실 또는 도난된 카드입니다.',
  NOT_ALLOWED_POINT_USE: '포인트 사용이 불가한 카드입니다.',
  EXCEED_MAX_DAILY_PAYMENT_COUNT: '일일 결제 한도를 초과했습니다.',
  EXCEED_MAX_PAYMENT_AMOUNT: '결제 금액 한도를 초과했습니다.',
  INVALID_STOPPED_CARD: '정지된 카드입니다.',
  NOT_SUPPORTED_INSTALLMENT_PLAN_CARD: '할부가 지원되지 않는 카드입니다.',
  BELOW_MINIMUM_AMOUNT: '최소 결제 금액 미만입니다.',
  INVALID_REQUEST: '잘못된 요청입니다.',
  NOT_FOUND_TERMINAL_ID: '단말기 정보를 찾을 수 없습니다.',
  COMMON_ERROR: '일시적인 오류가 발생했습니다.',
  USER_CANCEL: '결제가 취소되었으며 금액은 청구되지 않았습니다.',
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

function CheckoutFailContent() {
  const searchParams = useSearchParams()
  const errorCode = searchParams.get('code') || 'UNKNOWN_ERROR'
  const providerMessage =
    searchParams.get('message') || '결제 처리 중 오류가 발생했습니다.'
  const message = errorDescriptions[errorCode] || providerMessage
  const cancelled = ['PAY_PROCESS_CANCELED', 'USER_CANCEL'].includes(errorCode)

  return (
    <ResultFrame>
      <div className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 text-center shadow-[var(--studio-shadow-card)] sm:p-8">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]">
          <CircleAlert aria-hidden="true" className="size-6" />
        </div>
        <h1 className="mt-5 text-2xl font-black tracking-[-0.03em] text-[var(--studio-ink)]">
          {cancelled ? '결제가 취소되었습니다' : '결제를 완료하지 못했습니다'}
        </h1>
        <p
          role={cancelled ? 'status' : 'alert'}
          aria-live="polite"
          className="mt-3 break-keep text-sm leading-6 text-[var(--studio-muted)]"
        >
          {message}
        </p>
        <p className="mt-2 break-all text-xs text-[var(--studio-muted)]">
          오류 코드: {errorCode}
        </p>

        <div className="mt-7 flex flex-col gap-2">
          <Button asChild variant="brand" className="min-h-11 w-full">
            <Link href="/pricing">
              <ArrowLeft aria-hidden="true" className="size-4" />
              충전 상품으로 돌아가기
            </Link>
          </Button>
          <Button asChild variant="brandOutline" className="min-h-11 w-full">
            <Link href="/mypage/support">
              <MessageCircle aria-hidden="true" className="size-4" />
              고객센터 문의
            </Link>
          </Button>
        </div>
        <p className="mt-5 text-xs leading-5 text-[var(--studio-muted)]">
          같은 문제가 계속되면 오류 코드와 함께 고객센터로 문의해 주세요.
        </p>
      </div>
    </ResultFrame>
  )
}

function CheckoutFailLoading() {
  return (
    <ResultFrame>
      <div className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-8 text-center shadow-[var(--studio-shadow-card)]">
        <Loader2
          aria-hidden="true"
          className="mx-auto size-8 animate-spin text-[var(--studio-primary)] motion-reduce:animate-none"
        />
        <p role="status" className="mt-4 text-sm text-[var(--studio-muted)]">
          결제 결과를 확인하고 있습니다.
        </p>
      </div>
    </ResultFrame>
  )
}

export default function CheckoutFailPage() {
  return (
    <Suspense fallback={<CheckoutFailLoading />}>
      <CheckoutFailContent />
    </Suspense>
  )
}
