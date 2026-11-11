'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowLeft,
  Loader2,
  ShieldCheck,
} from 'lucide-react'
import {
  StudioContainer,
  StudioPageHeader,
} from '@/components/design-system'
import { Button } from '@/components/ui/button'

type CheckoutPhase =
  | 'idle'
  | 'preparingOrder'
  | 'openingProvider'
  | 'pendingVerification'
  | 'recoverableError'

export interface CheckoutPaymentMethod {
  code: string
  label: string
  description: string | null
  provider: 'payapp' | 'kakaopay'
}

interface PricingPlan {
  id: string
  name: string
  credits: number
  price: number
  description: string | null
}

interface User {
  id: string
  name: string
  email: string
  phone: string | null
}

interface CheckoutClientProps {
  plan: PricingPlan
  user: User
  paymentMethods: CheckoutPaymentMethod[]
}

interface PaymentResponse {
  status?: string
  orderId?: string
  amount?: number
  payUrl?: string
  resultUrl?: string
  nextRedirectPcUrl?: string
  nextRedirectMobileUrl?: string
  error?: string
  code?: string
}

// 같은 결제 시도로 다시 요청하면 서버가 기존 결과를 돌려준다. 이 코드들은 새 시도로 다시 해야 한다.
const NEW_ATTEMPT_CODES = [
  'PAYMENT_ATTEMPT_PAYLOAD_CONFLICT',
  'PAYMENT_ATTEMPT_UNKNOWN',
  'PAYMENT_ATTEMPT_EXPIRED',
]

const PHONE_PATTERN = /^01[016789][0-9]{7,8}$/

function getCheckoutAttemptStorageKey(userId: string, planId: string) {
  return `point-checkout-attempt:${userId}:${planId}`
}

// 결제수단·휴대폰 번호·상품 금액·크레딧이 바뀌면 새 결제 시도를 만든다. 같으면 같은 시도를 이어서 쓴다.
// 서버도 같은 시도인지 이 값들로 판단하므로(요청 지문), 관리자가 가격을 바꾸면 여기서도 새 시도로 시작한다.
function getCheckoutAttemptId(
  userId: string,
  planId: string,
  methodCode: string,
  phone: string,
  amount: number,
  credits: number
) {
  const storageKey = getCheckoutAttemptStorageKey(userId, planId)
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(storageKey) ?? 'null') as {
      id?: string
      method?: string
      phone?: string
      amount?: number
      credits?: number
    } | null
    if (
      stored?.id &&
      stored.method === methodCode && stored.phone === phone &&
      stored.amount === amount && stored.credits === credits
    ) {
      return stored.id
    }
  } catch {
    // 저장값을 읽지 못하면 새 시도로 시작한다.
  }

  const checkoutAttemptId = crypto.randomUUID()
  try {
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({ id: checkoutAttemptId, method: methodCode, phone, amount, credits })
    )
  } catch {
    // 저장하지 못해도 이번 요청은 진행한다.
  }
  return checkoutAttemptId
}

function clearCheckoutAttempt(userId: string, planId: string) {
  try {
    window.sessionStorage.removeItem(getCheckoutAttemptStorageKey(userId, planId))
  } catch {
    // 무시한다.
  }
}

function getLastMethodStorageKey(userId: string) {
  return `point-checkout-method:${userId}`
}

function isMobileBrowser() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

function toPhoneDigits(value: string | null) {
  return (value ?? '').replace(/[^0-9]/g, '')
}

function maskPhone(digits: string) {
  if (digits.length < 10) return digits
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`
}

// 받침이 있으면 '으로', 없거나 ㄹ 받침이면 '로'를 붙인다.
function withDirectionParticle(word: string) {
  const code = word.charCodeAt(word.length - 1) - 0xac00
  if (code < 0 || code > 11171) return `${word}로`
  const finalConsonant = code % 28
  return finalConsonant === 0 || finalConsonant === 8 ? `${word}로` : `${word}으로`
}

// 결제수단 대표 이미지. 파일은 public/payment-methods/{결제수단 code}.svg 규칙으로 둔다
// (결제사가 PNG만 준 로고는 SVG로 감싸 둔다). 파일이 없으면 자리만 두고 이름만 보인다.
function PaymentMethodMark({ code }: { code: string }) {
  const [missing, setMissing] = useState(false)
  return (
    <span aria-hidden="true" className="flex h-9 w-24 shrink-0 items-center justify-center">
      {missing ? null : (
        <Image
          src={`/payment-methods/${code}.svg`}
          alt=""
          width={96}
          height={24}
          unoptimized
          className="h-6 w-auto max-w-24 object-contain"
          style={{ width: 'auto' }}
          onError={() => setMissing(true)}
        />
      )}
    </span>
  )
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4">
      <dt className="shrink-0 text-[var(--ck-muted)]">{label}</dt>
      <dd className="min-w-0 break-words text-right tabular-nums text-[var(--ck-ink)]">{value}</dd>
    </div>
  )
}

function OrderSummary({
  plan,
  user,
  amount,
}: {
  plan: PricingPlan
  user: User
  amount: number
}) {
  return (
    <>
      <h2
        id="order-summary-title"
        className="text-base font-bold text-[var(--ck-ink)]"
      >
        결제 정보
      </h2>
      <dl className="mt-5 space-y-3 text-sm">
        <ReceiptRow label="충전 상품" value={plan.name} />
        <ReceiptRow label="충전 크레딧" value={`${plan.credits.toLocaleString()} 크레딧`} />
        <ReceiptRow label="상품 금액" value={`${amount.toLocaleString()}원`} />
      </dl>
      <div className="my-5 border-t border-dashed border-[var(--ck-line-strong)]" />
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm font-bold text-[var(--ck-ink)]">총 결제금액</span>
        <span className="text-2xl font-bold tabular-nums tracking-tight text-[var(--ck-ink)]">
          {amount.toLocaleString()}원
        </span>
      </div>
      <p className="mt-1 text-right text-xs text-[var(--ck-muted)]">부가세 포함</p>
      <div className="my-5 border-t border-dashed border-[var(--ck-line-strong)]" />
      <div className="min-w-0 text-sm">
        <p className="text-[var(--ck-muted)]">구매자</p>
        <p className="mt-1 break-words text-[var(--ck-ink)]">{user.name}</p>
        <p className="break-all text-[var(--ck-muted)]">{user.email}</p>
      </div>
    </>
  )
}

export function CheckoutClient({
  plan,
  user,
  paymentMethods,
}: CheckoutClientProps) {
  const profilePhone = toPhoneDigits(user.phone)
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [phone, setPhone] = useState(profilePhone)
  const [editingPhone, setEditingPhone] = useState(!PHONE_PATTERN.test(profilePhone))
  const [savePhone, setSavePhone] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [phase, setPhase] = useState<CheckoutPhase>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const inFlightRef = useRef(false)

  // 결제창에서 뒤로가기로 돌아와 페이지가 그대로 복원되면 잠긴 화면을 푼다.
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      inFlightRef.current = false
      setPhase('idle')
      setMessage(null)
    }
    window.addEventListener('pageshow', handlePageShow)
    return () => window.removeEventListener('pageshow', handlePageShow)
  }, [])

  // 마지막에 쓴 결제수단을 기본으로 고른다. 처음이면 고르지 않은 채로 둔다.
  useEffect(() => {
    try {
      const lastCode = window.localStorage.getItem(getLastMethodStorageKey(user.id))
      if (lastCode && paymentMethods.some((method) => method.code === lastCode)) {
        setSelectedCode(lastCode)
      }
    } catch {
      // 브라우저 저장소를 쓸 수 없으면 무시한다.
    }
  }, [paymentMethods, user.id])

  const selectedMethod = paymentMethods.find((method) => method.code === selectedCode) ?? null
  const needsPhone = selectedMethod?.provider === 'payapp'
  const phoneValid = PHONE_PATTERN.test(phone)
  const isBusy = phase === 'preparingOrder' || phase === 'openingProvider'
  const amount = plan.price

  const changeMethod = (code: string) => {
    if (isBusy || inFlightRef.current) return
    setSelectedCode(code)
    setMessage(null)
    setErrorCode(null)
    setPhase('idle')
  }

  const startNewAttempt = () => {
    clearCheckoutAttempt(user.id, plan.id)
    setErrorCode(null)
    setMessage(null)
    setPhase('idle')
  }

  const failWith = (nextMessage: string, code: string | null = null) => {
    setPhase('recoverableError')
    setErrorCode(code)
    setMessage(nextMessage)
  }

  const beginPayment = async () => {
    if (!selectedMethod || !agreed || inFlightRef.current) return
    if (needsPhone && !phoneValid) {
      failWith('결제 안내를 받을 휴대폰 번호를 확인해 주세요.')
      return
    }

    inFlightRef.current = true
    setPhase('preparingOrder')
    setMessage('결제 주문을 안전하게 준비하고 있습니다.')
    setErrorCode(null)

    try {
      try {
        window.localStorage.setItem(getLastMethodStorageKey(user.id), selectedMethod.code)
      } catch {
        // 저장하지 못해도 결제는 진행한다.
      }

      const checkoutAttemptId = getCheckoutAttemptId(
        user.id,
        plan.id,
        selectedMethod.code,
        needsPhone ? phone : '',
        plan.price,
        plan.credits
      )
      const response = selectedMethod.provider === 'kakaopay'
        ? await fetch('/api/payments/kakaopay/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ planId: plan.id, checkoutAttemptId }),
          })
        : await fetch('/api/payments/payapp/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              planId: plan.id,
              checkoutAttemptId,
              paymentMethodCode: selectedMethod.code,
              phone,
              savePhone: !profilePhone && savePhone,
            }),
          })
      const body = await response.json() as PaymentResponse

      if (response.status === 202 || body.status === 'preparing') {
        setPhase('pendingVerification')
        setMessage('결제 준비 결과를 확인하고 있습니다. 잠시 후 같은 버튼으로 다시 시도해 주세요.')
        return
      }

      if (!response.ok) {
        // 페이앱이 요청을 거절(state=0)해 결제창이 만들어지지 않았다. 이 주문은 결제될 수 없다
        // (실패로 닫히고, 닫지 못했으면 대사가 정리한다). 같은 시도로 다시 보내면 만료나 확인 불가 응답만
        // 받으므로 다음 클릭은 새 시도로 시작한다.
        if (body.code === 'PAYAPP_REQUEST_REJECTED') {
          clearCheckoutAttempt(user.id, plan.id)
        }
        failWith(body.error || '결제 주문을 준비하지 못했습니다.', body.code ?? null)
        return
      }

      // 결제됐을 수 있는 이전 주문이면 다시 결제하지 않고 결과 화면으로 보낸다.
      // 결과를 한 번 보여 준 뒤에는 다음 결제가 새 시도로 시작되게 한다(같은 상품 재구매).
      if (body.status === 'result' && body.resultUrl) {
        clearCheckoutAttempt(user.id, plan.id)
        setPhase('openingProvider')
        window.location.assign(body.resultUrl)
        return
      }

      if (body.amount !== plan.price) {
        failWith('상품 금액이 변경되었습니다. 충전 상품을 다시 확인해 주세요.')
        return
      }

      const redirectUrl = selectedMethod.provider === 'kakaopay'
        ? isMobileBrowser() ? body.nextRedirectMobileUrl : body.nextRedirectPcUrl
        : body.payUrl
      if (body.status !== 'ready' || !redirectUrl) {
        setPhase('pendingVerification')
        setMessage('결제 준비 결과를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.')
        return
      }

      setPhase('openingProvider')
      setMessage(`${selectedMethod.label} 결제 화면으로 이동합니다.`)
      window.location.assign(redirectUrl)
    } catch {
      failWith('결제 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      inFlightRef.current = false
    }
  }

  const ctaLabel = phase === 'preparingOrder'
    ? '주문 준비 중'
    : phase === 'openingProvider'
      ? '결제 화면 여는 중'
      : selectedMethod
        ? `${withDirectionParticle(selectedMethod.label)} ${amount.toLocaleString()}원 결제하기`
        : '결제수단을 선택해 주세요'

  return (
    <div className="studio-theme min-h-screen overflow-x-clip bg-[var(--ck-bg)] [--ck-bg:#FAF8F5] [--ck-ink:#1C1917] [--ck-text:#44403C] [--ck-muted:#78716C] [--ck-line:#E7E5E4] [--ck-line-strong:#D6D3D1]">
      <StudioPageHeader
        breadcrumbs={(
          <Link href="/pricing" className="inline-flex min-h-11 items-center gap-2">
            <ArrowLeft aria-hidden="true" className="size-4" />
            충전 상품으로 돌아가기
          </Link>
        )}
        title="크레딧 충전 결제"
        description="자동결제 없이 한 번만 결제되는 충전 상품입니다. 모든 표시 금액에는 부가세가 포함되어 있습니다."
      />

      <StudioContainer className="py-8 sm:py-10">
        {paymentMethods.length === 0 ? (
          <div className="rounded-lg border border-[var(--ck-line)] bg-white p-6 text-center sm:p-8">
            <h2 className="text-xl font-bold text-[var(--ck-ink)]">
              결제 기능을 준비 중입니다
            </h2>
            <p className="mt-2 break-keep text-sm leading-6 text-[var(--ck-muted)]">
              현재 사용할 수 있는 결제수단이 없습니다. 잠시 후 다시 확인해 주세요.
            </p>
            <Link
              href="/pricing"
              className="mt-6 inline-flex min-h-11 items-center rounded-lg border border-[var(--ck-ink)] px-5 text-sm font-bold text-[var(--ck-ink)]"
            >
              충전 상품으로 돌아가기
            </Link>
          </div>
        ) : (
          <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-x-12 lg:gap-y-10">
            <section aria-labelledby="payment-method-title" className="min-w-0 lg:col-start-1 lg:row-start-1">
              <div className="flex items-center gap-4">
                <h2
                  id="payment-method-title"
                  className="shrink-0 text-base font-bold text-[var(--ck-ink)]"
                >
                  결제수단
                </h2>
                <span aria-hidden="true" className="h-px flex-1 bg-[var(--ck-line)]" />
              </div>

              <fieldset className="mt-4 min-w-0" disabled={isBusy}>
                <legend className="sr-only">결제수단 선택</legend>
                <div className="space-y-1">
                  {paymentMethods.map((method) => (
                    <label
                      key={method.code}
                      className="group flex min-h-11 cursor-pointer items-center gap-4 rounded-lg border-[1.5px] border-transparent px-3 py-3.5 transition-colors hover:has-[:enabled]:bg-white has-[:checked]:border-[var(--ck-ink)] has-[:checked]:bg-white has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--ck-ink)] has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-[var(--ck-bg)] has-[:disabled]:cursor-not-allowed"
                    >
                      <PaymentMethodMark code={method.code} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold text-[var(--ck-ink)]">{method.label}</span>
                        {method.description ? (
                          <span className="mt-0.5 block break-keep text-xs leading-5 text-[var(--ck-muted)]">
                            {method.description}
                          </span>
                        ) : null}
                      </span>
                      <input
                        type="radio"
                        name="payment-method"
                        value={method.code}
                        checked={selectedCode === method.code}
                        onChange={() => changeMethod(method.code)}
                        className="sr-only"
                      />
                      <span
                        aria-hidden="true"
                        className="flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-[var(--ck-muted)] group-has-[:checked]:border-[var(--ck-ink)]"
                      >
                        <span className="size-2.5 rounded-full bg-[var(--ck-ink)] opacity-0 group-has-[:checked]:opacity-100" />
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {needsPhone ? (
                <div className="mt-4 min-w-0 border-t border-[var(--ck-line)] px-3 pt-4 text-sm">
                  {!editingPhone ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-[var(--ck-muted)]">결제 안내 휴대폰</span>
                      <strong className="tabular-nums text-[var(--ck-ink)]">{maskPhone(phone)}</strong>
                      <button
                        type="button"
                        className="min-h-11 font-bold text-[var(--ck-ink)] underline underline-offset-4 disabled:opacity-50"
                        disabled={isBusy}
                        onClick={() => setEditingPhone(true)}
                      >
                        변경
                      </button>
                    </div>
                  ) : (
                    <div className="min-w-0 max-w-sm">
                      <label htmlFor="checkout-phone" className="block font-bold text-[var(--ck-ink)]">
                        결제 안내를 받을 휴대폰 번호
                      </label>
                      <input
                        id="checkout-phone"
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel"
                        placeholder="01012345678"
                        value={phone}
                        disabled={isBusy}
                        onChange={(event) => setPhone(toPhoneDigits(event.target.value).slice(0, 11))}
                        aria-invalid={phone.length > 0 && !phoneValid}
                        className="mt-2 min-h-11 w-full rounded-lg border border-[var(--ck-line-strong)] bg-white px-3 tabular-nums text-[var(--ck-ink)] outline-none focus-visible:border-[var(--ck-ink)] focus-visible:ring-1 focus-visible:ring-[var(--ck-ink)]"
                      />
                      {phone.length > 0 && !phoneValid ? (
                        <p className="mt-1 text-xs text-destructive">휴대폰 번호 형식을 확인해 주세요.</p>
                      ) : null}
                      {PHONE_PATTERN.test(profilePhone) ? (
                        <button
                          type="button"
                          className="mt-1 min-h-11 text-sm font-bold text-[var(--ck-ink)] underline underline-offset-4 disabled:opacity-50"
                          disabled={isBusy}
                          onClick={() => {
                            setPhone(profilePhone)
                            setEditingPhone(false)
                          }}
                        >
                          변경 취소
                        </button>
                      ) : null}
                      {!profilePhone ? (
                        <label className="mt-2 flex min-h-11 items-center gap-2 text-[var(--ck-text)]">
                          <input
                            type="checkbox"
                            checked={savePhone}
                            disabled={isBusy}
                            onChange={(event) => setSavePhone(event.target.checked)}
                            className="size-4 accent-[var(--ck-ink)]"
                          />
                          다음에도 이 번호 사용
                        </label>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
            </section>

            <section className="order-last min-w-0 border-t border-[var(--ck-line)] pt-6 text-sm leading-6 lg:order-none lg:col-start-1 lg:row-start-2">
              <h2 className="font-bold text-[var(--ck-ink)]">결제 전 확인</h2>
              <ul className="mt-2 space-y-1 text-[var(--ck-muted)]">
                <li>자동결제 없음 · 1회 최대 100,000원입니다.</li>
                <li>사용기한은 결제일로부터 1년이며 회원 간 양도할 수 없습니다.</li>
                <li>구매 후 7일 이내 완전 미사용 시 원 결제수단으로 환불합니다.</li>
              </ul>
              <Link
                href="/terms/refund"
                className="mt-2 inline-flex min-h-11 items-center font-bold text-[var(--ck-ink)] underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ck-ink)]"
              >
                취소·환불정책 전문 보기
              </Link>
            </section>

            <aside
              aria-labelledby="order-summary-title"
              className="min-w-0 self-start rounded-lg border border-[var(--ck-line)] bg-white p-5 sm:p-6 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1"
            >
              <OrderSummary plan={plan} user={user} amount={amount} />

              <label className="mt-6 flex min-h-11 items-start gap-2 text-sm leading-6 text-[var(--ck-text)]">
                <input
                  type="checkbox"
                  checked={agreed}
                  disabled={isBusy}
                  onChange={(event) => setAgreed(event.target.checked)}
                  className="mt-1 size-4 shrink-0 accent-[var(--ck-ink)]"
                />
                <span>
                  주문 내용과{' '}
                  <Link
                    href="/terms/refund"
                    className="font-bold text-[var(--ck-ink)] underline underline-offset-4"
                  >
                    취소·환불정책
                  </Link>
                  을 확인했으며 결제에 동의합니다 (필수)
                </span>
              </label>

              {/* 안내 영역은 항상 두고 내용만 바꾼다. 오류는 따로 알린다. */}
              <p
                role="status"
                aria-live="polite"
                className="break-words text-sm leading-6 text-[var(--ck-muted)] [&:not(:empty)]:mt-3"
              >
                {phase !== 'recoverableError' ? message : null}
              </p>
              <p
                role="alert"
                className="break-words text-sm leading-6 text-destructive [&:not(:empty)]:mt-3"
              >
                {phase === 'recoverableError' ? message : null}
              </p>

              <Button
                type="button"
                className="mt-4 h-auto min-h-12 w-full whitespace-normal break-keep rounded-lg bg-[var(--ck-ink)] py-3 text-base font-bold text-white shadow-none hover:bg-[var(--ck-ink)]/90 disabled:bg-[var(--ck-line)] disabled:text-[var(--ck-muted)] disabled:opacity-100"
                disabled={isBusy || !selectedMethod || !agreed || (needsPhone && !phoneValid)}
                onClick={beginPayment}
              >
                {isBusy ? (
                  <Loader2
                    aria-hidden="true"
                    className="size-5 animate-spin motion-reduce:animate-none"
                  />
                ) : null}
                {ctaLabel}
              </Button>

              {errorCode && NEW_ATTEMPT_CODES.includes(errorCode) ? (
                <button
                  type="button"
                  className="mt-2 min-h-11 w-full text-sm font-bold text-[var(--ck-ink)] underline underline-offset-4"
                  onClick={startNewAttempt}
                >
                  새 결제 시도 시작하기
                </button>
              ) : null}

              <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-[var(--ck-muted)]">
                <ShieldCheck aria-hidden="true" className="size-3.5" />
                결제는 결제사(페이앱) 안전결제 화면에서 진행됩니다
              </p>
            </aside>
          </div>
        )}

        <div className="mt-12 text-center text-sm leading-6 text-[var(--ck-muted)]">
          <p>결제 문의: support@createquizai.com</p>
          <p>
            결제 후 충전된 크레딧은 문제마켓 자료 구매에 사용할 수 있습니다.
          </p>
        </div>
      </StudioContainer>
    </div>
  )
}
