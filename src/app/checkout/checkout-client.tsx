'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
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
import {
  parsePointChargeCheckoutNotice,
  POINT_CHARGE_CHECKOUT_ITEM_KEYS,
  type PointChargeCheckoutNotice,
} from '@/lib/point-charge-policy'
import { redirectToConsentIfRequired } from '@/lib/consent-client'
import { parseCheckoutConsentBundle, type CheckoutConsentBundle } from '@/lib/checkout-consent'
import type { MarketPurchaseLink } from '@/lib/market-purchase-info'
import {
  canRenderCheckoutConsent,
  CheckoutConsent,
  isCheckoutConsentComplete,
} from '@/components/checkout/checkout-consent'

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
  provider: 'payapp'
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
  // 결제 문의 연락처(관리자 Footer 설정 값). 비어 있으면 그 줄을 그리지 않는다.
  supportContact: string
  // 결제 전 확인 문구(DB, 서버가 채우고 지문을 붙임). 11번: 1판 고지(펼친 고지)와 2판 묶음(접는 동의) 중 하나만 값이 있다.
  // 둘 다 null 이면 고지 없음 — 결제 버튼을 막는다.
  checkoutNotice: PointChargeCheckoutNotice | null
  checkoutConsent: CheckoutConsentBundle | null
  // 약관·환불정책 전문 링크(하단 정보 DB). 판과 관계없이 늘 받는다.
  termsLink: MarketPurchaseLink | null
  refundPolicyLink: MarketPurchaseLink | null
  // 변경 예정 약관 한 줄 안내(서버 부품, 15번 6-2). 동의 문구는 바꾸지 않는다.
  upcomingNotice?: ReactNode
}

interface PaymentResponse {
  status?: string
  orderId?: string
  amount?: number
  credits?: number
  payUrl?: string
  resultUrl?: string
  error?: string
  code?: string
  // 409 CHECKOUT_NOTICE_CHANGED·CHECKOUT_PLAN_CHANGED: 새 결제 전 확인 문구와 지금 상품 값.
  notice?: unknown
  plan?: { price?: unknown; credits?: unknown }
}

// 결제 전 확인 문구나 상품 값이 바뀌어 동의를 다시 받아야 하는 응답.
const CHECKOUT_CHANGED_CODES = ['CHECKOUT_NOTICE_CHANGED', 'CHECKOUT_PLAN_CHANGED']

// 동의 문구 안의 정책 이름은 정책 전문 링크로 감싼다.
const REFUND_POLICY_NAME = '취소·환불정책'

// 2판 동의 부품의 색(CSS 변수)은 충전 화면 잉크 값으로 준다. 창은 포털이라 패널에도 다시 붙인다(11번 6-5).
const CONSENT_INK_VARS = '[--consent-ink:var(--ck-ink)] [--consent-muted:var(--ck-muted)] [--consent-line:var(--ck-line)] [--consent-ring:var(--ck-ink)]'
const CK_INK_VARS = '[--ck-bg:#FAF8F5] [--ck-ink:#1C1917] [--ck-text:#44403C] [--ck-muted:#78716C] [--ck-line:#E7E5E4] [--ck-line-strong:#D6D3D1]'

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

// 결제수단·휴대폰 번호·상품 금액·크레딧·결제 전 확인 문구(지문)가 바뀌면 새 결제 시도를 만든다. 같으면 같은 시도를 이어서 쓴다.
// 서버도 같은 시도인지 이 값들로 판단하므로(요청 지문), 관리자가 가격을 바꾸면 여기서도 새 시도로 시작한다.
// 결제 전 확인 동의는 시도마다 기록되므로 문구가 바뀌면 새 시도로 다시 동의받는다.
function getCheckoutAttemptId(
  userId: string,
  planId: string,
  methodCode: string,
  phone: string,
  amount: number,
  credits: number,
  noticeSha256: string
) {
  const storageKey = getCheckoutAttemptStorageKey(userId, planId)
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(storageKey) ?? 'null') as {
      id?: string
      method?: string
      phone?: string
      amount?: number
      credits?: number
      noticeSha256?: string
    } | null
    if (
      stored?.id &&
      stored.method === methodCode && stored.phone === phone &&
      stored.amount === amount && stored.credits === credits &&
      stored.noticeSha256 === noticeSha256
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
      JSON.stringify({ id: checkoutAttemptId, method: methodCode, phone, amount, credits, noticeSha256 })
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

// 1판(펼친 고지): 결제 전 확인(제목·항목·미성년자 안내). 동의 체크 바로 위에 둔다. 지문 대상이라 접지 않는다.
// 11번: 환불정책 주소는 코드에 두지 않고 하단 정보(DB) 링크를 쓴다(없으면 링크 줄을 그리지 않음).
function CheckoutNoticeSection({ notice, refundPolicyLink }: { notice: PointChargeCheckoutNotice; refundPolicyLink: MarketPurchaseLink | null }) {
  return (
    <section aria-labelledby="checkout-notice-title" className="mt-6 min-w-0 border-t border-[var(--ck-line)] pt-5 text-sm leading-6">
      <h3 id="checkout-notice-title" className="font-bold text-[var(--ck-ink)]">{notice.checkoutTitle}</h3>
      <ol className="mt-2 list-decimal space-y-1.5 break-keep pl-5 text-[var(--ck-muted)]">
        {POINT_CHARGE_CHECKOUT_ITEM_KEYS.map((key) => (
          <li key={key}>{notice.checkoutItems[key]}</li>
        ))}
      </ol>
      <p className="mt-3 break-keep text-[var(--ck-muted)]">{notice.minorNotice}</p>
      {refundPolicyLink ? (
        <Link
          href={refundPolicyLink.href}
          className="mt-1 inline-flex min-h-11 items-center font-bold text-[var(--ck-ink)] underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ck-ink)]"
        >
          {refundPolicyLink.label} 전문 보기
        </Link>
      ) : null}
    </section>
  )
}

// 고지 없음(11번 8절·6-4): 동의 자리에 안내와 [다시 불러오기]. 빨강이 아니고 1판 부품으로 떨어뜨리지 않는다.
// 첫 값으로 state 를 만들므로 router.refresh 로는 바뀌지 않아 문서를 다시 읽는다.
function CheckoutNoticeUnavailable() {
  return (
    <section className="mt-6 min-w-0 border-t border-[var(--ck-line)] pt-5 text-sm leading-6">
      <p role="alert" className="break-keep text-[var(--ck-ink)]">
        결제 전 확인 내용을 불러오지 못해 지금은 결제할 수 없습니다. 잠시 후 다시 시도해 주세요.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-1 inline-flex min-h-11 items-center font-bold text-[var(--ck-ink)] underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ck-ink)]"
      >
        다시 불러오기
      </button>
    </section>
  )
}

// 동의 문구(DB)의 필수 표기는 코드가 여기서 한 번만 붙이고, 정책 이름은 전문 링크로 감싼다.
function AgreeLabel({ label, refundPolicyLink }: { label: string; refundPolicyLink: MarketPurchaseLink | null }) {
  const parts = label.split(REFUND_POLICY_NAME)
  return (
    <span>
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 ? (
            refundPolicyLink ? (
              <Link href={refundPolicyLink.href} className="font-bold text-[var(--ck-ink)] underline underline-offset-4">
                {REFUND_POLICY_NAME}
              </Link>
            ) : REFUND_POLICY_NAME
          ) : null}
          {part}
        </span>
      ))}
      {' '}(필수)
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
  plan: initialPlan,
  user,
  paymentMethods,
  supportContact,
  checkoutNotice,
  checkoutConsent,
  termsLink,
  refundPolicyLink,
  upcomingNotice,
}: CheckoutClientProps) {
  // 결제 요청이 409(문구·상품 변경)를 받으면 응답의 새 값으로 바꾸고 다시 동의받는다.
  // 11번: 409 로 받은 고지는 판이 바뀔 수 있다(1판 ↔ 2판). 둘 중 하나만 값을 둔다.
  const [plan, setPlan] = useState(initialPlan)
  const [notice, setNotice] = useState<PointChargeCheckoutNotice | null>(checkoutConsent ? null : checkoutNotice)
  const [consent, setConsent] = useState<CheckoutConsentBundle | null>(checkoutConsent)
  const [consentKeys, setConsentKeys] = useState<string[]>([])
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
  const consentLinks = { refundPolicy: refundPolicyLink?.href ?? null, serviceTerms: termsLink?.href ?? null }
  // 2판 묶음은 링크 주소가 모두 있을 때만 그린다(없으면 고지 없음).
  const visibleConsent = consent && canRenderCheckoutConsent(consent, consentLinks) ? consent : null
  // 보인 고지의 지문(시도 키도 이 값으로 갈린다). 고지 없음이면 null — 결제 버튼을 막는다.
  const noticeSha256 = visibleConsent?.noticeSha256 ?? notice?.noticeSha256 ?? null
  const consentAgreed = visibleConsent ? isCheckoutConsentComplete(visibleConsent, consentKeys) : notice ? agreed : false

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
    if (!selectedMethod || !consentAgreed || !noticeSha256 || inFlightRef.current) return
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
        plan.credits,
        noticeSha256
      )
      const response = await fetch('/api/payments/payapp/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: plan.id,
          checkoutAttemptId,
          paymentMethodCode: selectedMethod.code,
          phone,
          savePhone: !profilePhone && savePhone,
          acknowledgeCheckoutNotice: consentAgreed,
          noticeSha256,
          expectedAmount: plan.price,
          expectedCredits: plan.credits,
        }),
      })
      const body = await response.json() as PaymentResponse

      if (response.status === 202 || body.status === 'preparing') {
        setPhase('pendingVerification')
        setMessage('결제 준비 결과를 확인하고 있습니다. 잠시 후 같은 버튼으로 다시 시도해 주세요.')
        return
      }

      // 필수 약관 동의가 필요하면 동의 화면으로 보낸다(동의 뒤 이 화면으로 돌아온다).
      if (redirectToConsentIfRequired(response.status, body)) {
        return
      }

      // 결제 전 확인 문구나 상품 값이 바뀌었다. 새 값으로 바꾸고 체크를 풀어 다시 동의받는다(새 결제 시도).
      if (response.status === 409 && body.code && CHECKOUT_CHANGED_CODES.includes(body.code)) {
        clearCheckoutAttempt(user.id, plan.id)
        // 11번: 2판 묶음이면 접는 동의로, 1판 고지면 펼친 고지로 바꿔 그린다(해석 실패면 고지 없음).
        const nextConsent = parseCheckoutConsentBundle(body.notice)
        setConsent(nextConsent)
        setNotice(nextConsent ? null : parsePointChargeCheckoutNotice(body.notice))
        setConsentKeys([])
        if (typeof body.plan?.price === 'number' && typeof body.plan.credits === 'number') {
          const nextPrice = body.plan.price
          const nextCredits = body.plan.credits
          setPlan((current) => ({ ...current, price: nextPrice, credits: nextCredits }))
        }
        setAgreed(false)
        failWith(body.error || '결제 전 확인 내용이 바뀌었습니다. 다시 확인한 뒤 동의해 주세요.', body.code)
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

      if (body.amount !== plan.price || body.credits !== plan.credits) {
        failWith('상품 금액 또는 크레딧이 변경되었습니다. 충전 상품을 다시 확인해 주세요.')
        return
      }

      const redirectUrl = body.payUrl
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
    <div className={`studio-theme min-h-screen overflow-x-clip bg-[var(--ck-bg)] ${CK_INK_VARS}`}>
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
        {upcomingNotice ? <div className="mb-6">{upcomingNotice}</div> : null}
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


            <aside
              aria-labelledby="order-summary-title"
              className="min-w-0 self-start rounded-lg border border-[var(--ck-line)] bg-white p-5 sm:p-6 lg:sticky lg:top-36 lg:col-start-2 lg:row-span-2 lg:row-start-1"
            >
              <OrderSummary plan={plan} user={user} amount={amount} />

              {/* 2판: 주문 요약 아래·결제 버튼 바로 위에 접는 동의. 1판: 결제 전 확인을 동의 체크 바로 위에 펼쳐 둔다. */}
              {visibleConsent ? (
                <div className={`mt-6 border-t border-[var(--ck-line)] pt-4 ${CONSENT_INK_VARS}`}>
                  <CheckoutConsent
                    consent={visibleConsent}
                    links={consentLinks}
                    checkedKeys={consentKeys}
                    onCheckedKeysChange={setConsentKeys}
                    disabled={isBusy}
                    dialogClassName={`${CK_INK_VARS} ${CONSENT_INK_VARS}`}
                  />
                </div>
              ) : notice ? (
                <>
                  <CheckoutNoticeSection notice={notice} refundPolicyLink={refundPolicyLink} />
                  <label className="mt-4 flex min-h-11 items-start gap-2 text-sm leading-6 text-[var(--ck-text)]">
                    <input
                      type="checkbox"
                      checked={agreed}
                      disabled={isBusy}
                      onChange={(event) => setAgreed(event.target.checked)}
                      className="mt-1 size-4 shrink-0 accent-[var(--ck-ink)]"
                    />
                    <AgreeLabel label={notice.agreeLabel} refundPolicyLink={refundPolicyLink} />
                  </label>
                </>
              ) : (
                <CheckoutNoticeUnavailable />
              )}

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
                disabled={isBusy || !selectedMethod || !noticeSha256 || !consentAgreed || (needsPhone && !phoneValid)}
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
          {supportContact ? <p>결제 문의: {supportContact}</p> : null}
          <p>
            결제 후 충전된 크레딧은 문제마켓 자료 구매에 사용할 수 있습니다.
          </p>
        </div>
      </StudioContainer>
    </div>
  )
}
