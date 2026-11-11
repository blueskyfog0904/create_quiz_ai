'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  CreditCard,
  Loader2,
  ShieldCheck,
} from 'lucide-react'
import {
  StudioContainer,
  StudioPageHeader,
} from '@/components/design-system'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

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
    <aside
      aria-labelledby="order-summary-title"
      className="order-first min-w-0 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 shadow-[var(--studio-shadow-card)] sm:p-6 lg:order-none"
    >
      <h2
        id="order-summary-title"
        className="text-lg font-extrabold text-[var(--studio-ink)]"
      >
        주문 정보
      </h2>

      <dl className="mt-5 space-y-4 text-sm">
        <div className="flex min-w-0 justify-between gap-4">
          <dt className="text-[var(--studio-muted)]">상품</dt>
          <dd className="min-w-0 break-words text-right font-bold text-[var(--studio-ink)]">
            {plan.name} 크레딧 충전
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-[var(--studio-muted)]">충전 크레딧</dt>
          <dd className="font-bold text-[var(--studio-ink)]">
            {plan.credits.toLocaleString()} 크레딧
          </dd>
        </div>
      </dl>

      <Separator className="my-5 bg-[var(--studio-border)]" />

      <div className="min-w-0 text-sm">
        <p className="font-bold text-[var(--studio-ink)]">구매자 정보</p>
        <p className="mt-2 break-words text-[var(--studio-text)]">{user.name}</p>
        <p className="break-all text-[var(--studio-muted)]">{user.email}</p>
      </div>

      <Separator className="my-5 bg-[var(--studio-border)]" />

      <div className="flex items-center justify-between gap-4">
        <span className="font-bold text-[var(--studio-ink)]">총 결제금액</span>
        <span className="text-2xl font-black text-[var(--studio-primary)]">
          {amount.toLocaleString()}원
        </span>
      </div>
      <p className="mt-1 text-right text-xs text-[var(--studio-muted)]">부가세 포함</p>
    </aside>
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
    <div className="studio-theme min-h-screen overflow-x-hidden bg-[var(--studio-background)]">
      <StudioPageHeader
        breadcrumbs={(
          <Link href="/pricing" className="inline-flex min-h-11 items-center gap-2">
            <ArrowLeft aria-hidden="true" className="size-4" />
            충전 상품으로 돌아가기
          </Link>
        )}
        eyebrow="CREDIT CHECKOUT"
        title="크레딧 충전 결제"
        description="자동결제 없이 한 번만 결제되는 충전 상품입니다. 모든 표시 금액에는 부가세가 포함되어 있습니다."
      />

      <StudioContainer className="py-7 sm:py-9">
        {paymentMethods.length === 0 ? (
          <div className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 text-center shadow-[var(--studio-shadow-card)] sm:p-8">
            <h2 className="text-xl font-extrabold text-[var(--studio-ink)]">
              결제 기능을 준비 중입니다
            </h2>
            <p className="mt-2 break-keep text-sm leading-6 text-[var(--studio-muted)]">
              현재 사용할 수 있는 결제수단이 없습니다. 잠시 후 다시 확인해 주세요.
            </p>
            <Button asChild variant="brandOutline" className="mt-6 min-h-11">
              <Link href="/pricing">충전 상품으로 돌아가기</Link>
            </Button>
          </div>
        ) : (
          <div className="grid min-w-0 gap-6 lg:grid-cols-3">
            <section
              aria-labelledby="payment-method-title"
              className="min-w-0 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 shadow-[var(--studio-shadow-card)] sm:p-6 lg:col-span-2"
            >
              <h2
                id="payment-method-title"
                className="text-lg font-extrabold text-[var(--studio-ink)]"
              >
                결제수단
              </h2>

              <fieldset className="mt-5 min-w-0" disabled={isBusy}>
                <legend className="sr-only">결제수단 선택</legend>
                <div className="space-y-2">
                  {paymentMethods.map((method) => (
                    <label
                      key={method.code}
                      className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] px-4 py-3 has-[:checked]:border-[var(--studio-primary)] has-[:checked]:bg-[var(--studio-primary-soft)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--studio-focus-ring)] has-[:disabled]:cursor-not-allowed"
                    >
                      <input
                        type="radio"
                        name="payment-method"
                        value={method.code}
                        checked={selectedCode === method.code}
                        onChange={() => changeMethod(method.code)}
                        className="mt-1 size-4 shrink-0 accent-[var(--studio-primary)]"
                      />
                      <span className="min-w-0">
                        <span className="block font-bold text-[var(--studio-ink)]">{method.label}</span>
                        {method.description ? (
                          <span className="mt-0.5 block break-keep text-xs leading-5 text-[var(--studio-muted)]">
                            {method.description}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {needsPhone ? (
                <div className="mt-5 min-w-0 rounded-[var(--studio-radius-control)] bg-[var(--studio-primary-soft)] p-4 text-sm">
                  {!editingPhone ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[var(--studio-text)]">
                        결제 안내 휴대폰 <strong className="text-[var(--studio-ink)]">{maskPhone(phone)}</strong>
                      </span>
                      <Button
                        type="button"
                        variant="brandOutline"
                        className="min-h-11"
                        disabled={isBusy}
                        onClick={() => setEditingPhone(true)}
                      >
                        변경
                      </Button>
                    </div>
                  ) : (
                    <div className="min-w-0">
                      <label htmlFor="checkout-phone" className="block font-bold text-[var(--studio-ink)]">
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
                        className="mt-2 min-h-11 w-full rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-[var(--studio-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                      />
                      {phone.length > 0 && !phoneValid ? (
                        <p className="mt-1 text-xs text-destructive">휴대폰 번호 형식을 확인해 주세요.</p>
                      ) : null}
                      {PHONE_PATTERN.test(profilePhone) ? (
                        <Button
                          type="button"
                          variant="brandGhost"
                          className="mt-2 min-h-11"
                          disabled={isBusy}
                          onClick={() => {
                            setPhone(profilePhone)
                            setEditingPhone(false)
                          }}
                        >
                          변경 취소
                        </Button>
                      ) : null}
                      {!profilePhone ? (
                        <label className="mt-3 flex min-h-11 items-center gap-2 text-[var(--studio-text)]">
                          <input
                            type="checkbox"
                            checked={savePhone}
                            disabled={isBusy}
                            onChange={(event) => setSavePhone(event.target.checked)}
                            className="size-4 accent-[var(--studio-primary)]"
                          />
                          다음에도 이 번호 사용
                        </label>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
            </section>

            <OrderSummary plan={plan} user={user} amount={amount} />

            <div className="min-w-0 lg:col-span-2">
              <label className="mb-3 flex min-h-11 items-start gap-2 text-sm leading-6 text-[var(--studio-text)]">
                <input
                  type="checkbox"
                  checked={agreed}
                  disabled={isBusy}
                  onChange={(event) => setAgreed(event.target.checked)}
                  className="mt-1 size-4 shrink-0 accent-[var(--studio-primary)]"
                />
                <span>
                  주문 내용과{' '}
                  <Link
                    href="/terms/refund"
                    className="font-bold text-[var(--studio-ink)] underline underline-offset-4"
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
                className="break-words text-sm leading-6 text-[var(--studio-muted)] [&:not(:empty)]:mb-3"
              >
                {phase !== 'recoverableError' ? message : null}
              </p>
              <p
                role="alert"
                className="break-words text-sm leading-6 text-destructive [&:not(:empty)]:mb-3"
              >
                {phase === 'recoverableError' ? message : null}
              </p>

              <Button
                type="button"
                variant="brand"
                className="min-h-11 w-full text-base"
                disabled={isBusy || !selectedMethod || !agreed || (needsPhone && !phoneValid)}
                onClick={beginPayment}
              >
                {isBusy ? (
                  <Loader2
                    aria-hidden="true"
                    className="size-5 animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <CreditCard aria-hidden="true" className="size-5" />
                )}
                {ctaLabel}
              </Button>

              {errorCode && NEW_ATTEMPT_CODES.includes(errorCode) ? (
                <Button
                  type="button"
                  variant="brandGhost"
                  className="mt-2 min-h-11 w-full"
                  onClick={startNewAttempt}
                >
                  새 결제 시도 시작하기
                </Button>
              ) : null}
            </div>

            <div className="flex min-h-11 min-w-0 items-center justify-center gap-2 text-sm text-[var(--studio-muted)]">
              <ShieldCheck aria-hidden="true" className="size-4" />
              결제는 결제사 안전결제 화면에서 진행됩니다
            </div>

            <div className="min-w-0 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 text-sm leading-6 text-[var(--studio-text)] shadow-[var(--studio-shadow-card)] lg:col-span-3">
              <p className="font-bold text-[var(--studio-ink)]">결제 전 확인</p>
              <ul className="mt-2 space-y-1 text-[var(--studio-muted)]">
                <li>자동결제 없음 · 1회 최대 100,000원입니다.</li>
                <li>사용기한은 결제일로부터 1년이며 회원 간 양도할 수 없습니다.</li>
                <li>구매 후 7일 이내 완전 미사용 시 원 결제수단으로 환불합니다.</li>
              </ul>
              <Link
                href="/terms/refund"
                className="mt-3 inline-flex min-h-11 items-center font-bold text-[var(--studio-ink)] underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
              >
                취소·환불정책 전문 보기
              </Link>
            </div>
          </div>
        )}

        <div className="mt-8 text-center text-sm leading-6 text-[var(--studio-muted)]">
          <p>결제 문의: support@createquizai.com</p>
          <p>
            결제 후 충전된 크레딧은 문제마켓 자료 구매에 사용할 수 있습니다.
          </p>
        </div>
      </StudioContainer>
    </div>
  )
}
