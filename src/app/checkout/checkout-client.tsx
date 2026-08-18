'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Script from 'next/script'
import {
  ArrowLeft,
  CreditCard,
  Loader2,
  ShieldCheck,
  WalletCards,
} from 'lucide-react'
import {
  StudioContainer,
  StudioPageHeader,
} from '@/components/design-system'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'

type PaymentProvider = 'toss' | 'kakaopay'
type CheckoutPhase =
  | 'idle'
  | 'providerLoading'
  | 'ready'
  | 'preparingOrder'
  | 'openingProvider'
  | 'awaitingReturn'
  | 'cancelled'
  | 'recoverableError'
  | 'pendingVerification'
  | 'expired'

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
}

interface TossPaymentConfig {
  clientKey: string
  paymentVariantKey: string
  agreementVariantKey: string
}

interface CheckoutClientProps {
  plan: PricingPlan
  user: User
  paymentConfig: TossPaymentConfig | null
  availableProviders: PaymentProvider[]
}

interface PreparedOrder {
  provider: PaymentProvider
  orderId: string
  orderName: string
  amount: number
  credits: number
  expiresAt: string
  nextRedirectPcUrl?: string
  nextRedirectMobileUrl?: string
}

interface PaymentResponse {
  status?: string
  orderId?: string
  orderName?: string
  amount?: number
  credits?: number
  expiresAt?: string
  nextRedirectPcUrl?: string
  nextRedirectMobileUrl?: string
  error?: string
  code?: string
}

interface TossWidgets {
  setAmount(input: { currency: 'KRW'; value: number }): Promise<void>
  renderPaymentMethods(input: {
    selector: string
    variantKey: string
  }): Promise<unknown>
  renderAgreement(input: {
    selector: string
    variantKey: string
  }): Promise<unknown>
  requestPayment(input: {
    orderId: string
    orderName: string
    customerEmail: string
    customerName: string
    successUrl: string
    failUrl: string
  }): Promise<void>
}

interface TossPaymentsFactory {
  (clientKey: string): {
    widgets(input: { customerKey: string }): TossWidgets
  }
}

declare global {
  interface Window {
    TossPayments?: TossPaymentsFactory
  }
}

function getPaymentErrorCode(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code
  }
  return null
}

function getCheckoutAttemptStorageKey(userId: string, planId: string) {
  return `point-checkout-attempt:${userId}:${planId}`
}

function getCheckoutAttemptId(userId: string, planId: string) {
  const storageKey = getCheckoutAttemptStorageKey(userId, planId)
  const stored = window.sessionStorage.getItem(storageKey)
  if (stored) return stored

  const checkoutAttemptId = crypto.randomUUID()
  window.sessionStorage.setItem(storageKey, checkoutAttemptId)
  return checkoutAttemptId
}

function clearCheckoutAttempt(userId: string, planId: string) {
  window.sessionStorage.removeItem(
    getCheckoutAttemptStorageKey(userId, planId)
  )
}

function isMobileBrowser() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

function TossPaymentPanel({
  config,
  amount,
  userId,
  onReady,
  onError,
}: {
  config: TossPaymentConfig
  amount: number
  userId: string
  onReady: (widgets: TossWidgets | null) => void
  onError: (message: string) => void
}) {
  const [scriptLoaded, setScriptLoaded] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!scriptLoaded) return

    let active = true
    const timer = window.setTimeout(async () => {
      try {
        if (!window.TossPayments) {
          throw new Error('결제 모듈을 불러오지 못했습니다.')
        }

        const widgets = window.TossPayments(config.clientKey).widgets({
          customerKey: userId,
        })
        await widgets.setAmount({ currency: 'KRW', value: amount })
        await widgets.renderPaymentMethods({
          selector: '#payment-method',
          variantKey: config.paymentVariantKey,
        })
        await widgets.renderAgreement({
          selector: '#agreement',
          variantKey: config.agreementVariantKey,
        })

        if (!active) return
        onReady(widgets)
        setLoading(false)
      } catch {
        if (!active) return
        setLoading(false)
        onError('일반결제 수단을 불러오지 못했습니다.')
      }
    }, 100)

    return () => {
      active = false
      window.clearTimeout(timer)
      onReady(null)
    }
  }, [amount, config, onError, onReady, scriptLoaded, userId])

  return (
    <div aria-busy={loading} className="min-h-72 max-w-full overflow-x-clip">
      <Script
        src="https://js.tosspayments.com/v2/standard"
        onLoad={() => setScriptLoaded(true)}
        onReady={() => setScriptLoaded(true)}
      />

      <div className="mb-4 rounded-[var(--studio-radius-control)] bg-[var(--studio-primary-soft)] p-4 text-sm leading-6 text-[var(--studio-text)]">
        <p className="font-bold text-[var(--studio-ink)]">
          이용 가능한 일반결제 수단
        </p>
        <p className="mt-1">
          신용·체크카드, 네이버페이, 페이코, 토스페이를 이용할 수 있습니다.
        </p>
        <p className="mt-2 text-[var(--studio-muted)]">
          계좌이체·가상계좌 및 하나카드는 크레딧 충전에 사용할 수 없습니다.
        </p>
      </div>

      {loading ? (
        <div
          role="status"
          className="flex min-h-52 items-center justify-center gap-3 text-sm text-[var(--studio-muted)]"
        >
          <Loader2
            aria-hidden="true"
            className="size-6 animate-spin motion-reduce:animate-none"
          />
          결제 수단을 불러오는 중입니다.
        </div>
      ) : null}

      <div id="payment-method" className={loading ? 'hidden' : undefined} />
      <div
        id="agreement"
        className={loading ? 'hidden' : 'mt-4'}
      />
    </div>
  )
}

function KakaoPayPanel() {
  return (
    <div className="min-h-72 rounded-[var(--studio-radius-control)] bg-[var(--studio-primary-soft)] p-5 sm:p-6">
      <div className="flex size-11 items-center justify-center rounded-full bg-[var(--studio-surface)] text-[var(--studio-primary)]">
        <WalletCards aria-hidden="true" className="size-5" />
      </div>
      <h2 className="mt-5 text-xl font-extrabold text-[var(--studio-ink)]">
        카카오페이머니로 결제
      </h2>
      <p className="mt-2 break-keep text-sm leading-6 text-[var(--studio-text)]">
        결제 버튼을 누르면 카카오페이 인증 화면으로 이동합니다. 초기 제공
        수단은 카카오페이머니이며 카드 결제는 제공하지 않습니다.
      </p>
      <p className="mt-3 break-keep text-sm leading-6 text-[var(--studio-muted)]">
        잔액이 부족한 경우 카카오페이의 표준 충전 안내에 따라 연결 계좌에서
        충전할 수 있습니다.
      </p>
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
    <aside
      aria-labelledby="order-summary-title"
      className="min-w-0 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 shadow-[var(--studio-shadow-card)] sm:p-6"
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
    </aside>
  )
}

export function CheckoutClient({
  plan,
  user,
  paymentConfig,
  availableProviders,
}: CheckoutClientProps) {
  const initialProvider = availableProviders.includes('toss')
    ? 'toss'
    : availableProviders[0] ?? null
  const [selectedProvider, setSelectedProvider] =
    useState<PaymentProvider | null>(initialProvider)
  const [phase, setPhase] = useState<CheckoutPhase>(
    initialProvider === 'toss' ? 'providerLoading' : initialProvider ? 'ready' : 'idle'
  )
  const [message, setMessage] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [preparedOrder, setPreparedOrder] = useState<PreparedOrder | null>(null)
  const [lockedProvider, setLockedProvider] = useState<PaymentProvider | null>(null)
  const [tossMountKey, setTossMountKey] = useState(0)
  const widgetsRef = useRef<TossWidgets | null>(null)
  const inFlightRef = useRef(false)

  const handleTossReady = useCallback((widgets: TossWidgets | null) => {
    widgetsRef.current = widgets
    if (widgets) {
      setPhase((current) =>
        current === 'providerLoading' ? 'ready' : current
      )
      setMessage(null)
    }
  }, [])

  const handleTossError = useCallback((nextMessage: string) => {
    widgetsRef.current = null
    setPhase('recoverableError')
    setMessage(nextMessage)
  }, [])

  const changeProvider = (value: string) => {
    if (lockedProvider || inFlightRef.current) return
    const provider = value as PaymentProvider
    if (!availableProviders.includes(provider)) return

    setSelectedProvider(provider)
    setMessage(null)
    setErrorCode(null)
    setPhase(provider === 'toss' ? 'providerLoading' : 'ready')
  }

  const resetAttempt = () => {
    clearCheckoutAttempt(user.id, plan.id)
    setPreparedOrder(null)
    setLockedProvider(null)
    setErrorCode(null)
    setMessage(null)
    setPhase('ready')
  }

  const reloadTossPanel = () => {
    setMessage(null)
    setErrorCode(null)
    setPhase('providerLoading')
    setTossMountKey((current) => current + 1)
  }

  const beginPayment = async () => {
    if (!selectedProvider || inFlightRef.current) return
    if (lockedProvider && lockedProvider !== selectedProvider) return
    if (selectedProvider === 'toss' && !widgetsRef.current) {
      setPhase('recoverableError')
      setMessage('일반결제 수단을 먼저 불러와 주세요.')
      return
    }

    inFlightRef.current = true
    setPhase('preparingOrder')
    setMessage('결제 주문을 안전하게 준비하고 있습니다.')
    setErrorCode(null)

    try {
      let order = preparedOrder
      if (!order) {
        const endpoint = selectedProvider === 'toss'
          ? '/api/payments/orders'
          : '/api/payments/kakaopay/orders'
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            planId: plan.id,
            checkoutAttemptId: getCheckoutAttemptId(user.id, plan.id),
          }),
        })
        const body = await response.json() as PaymentResponse

        if (response.status === 202 || body.status === 'preparing') {
          setLockedProvider(selectedProvider)
          setPhase('pendingVerification')
          setMessage(
            '결제 준비 결과를 확인하고 있습니다. 잠시 후 같은 버튼으로 상태를 다시 확인해 주세요.'
          )
          return
        }

        if (!response.ok) {
          setErrorCode(body.code ?? null)
          throw new Error(body.error || '결제 주문을 준비하지 못했습니다.')
        }

        if (
          !body.orderId ||
          !body.orderName ||
          typeof body.amount !== 'number' ||
          typeof body.credits !== 'number' ||
          !body.expiresAt
        ) {
          throw new Error('결제 주문 응답을 확인하지 못했습니다.')
        }

        order = {
          provider: selectedProvider,
          orderId: body.orderId,
          orderName: body.orderName,
          amount: body.amount,
          credits: body.credits,
          expiresAt: body.expiresAt,
          nextRedirectPcUrl: body.nextRedirectPcUrl,
          nextRedirectMobileUrl: body.nextRedirectMobileUrl,
        }
        setPreparedOrder(order)
        setLockedProvider(selectedProvider)
      }

      if (order.amount !== plan.price) {
        throw new Error('상품 금액이 변경되었습니다. 충전 상품을 다시 확인해 주세요.')
      }

      if (order.provider === 'toss') {
        const widgets = widgetsRef.current
        if (!widgets) {
          throw new Error('일반결제 수단을 다시 불러와 주세요.')
        }

        setPhase('openingProvider')
        setMessage('일반결제 창을 열고 있습니다.')
        await widgets.setAmount({ currency: 'KRW', value: order.amount })
        setPhase('awaitingReturn')
        await widgets.requestPayment({
          orderId: order.orderId,
          orderName: order.orderName,
          customerEmail: user.email,
          customerName: user.name,
          successUrl: `${window.location.origin}/checkout/success`,
          failUrl: `${window.location.origin}/checkout/fail`,
        })
        return
      }

      const redirectUrl = isMobileBrowser()
        ? order.nextRedirectMobileUrl
        : order.nextRedirectPcUrl
      if (!redirectUrl) {
        setPhase('pendingVerification')
        setMessage(
          '카카오페이 결제 준비 결과를 확인하고 있습니다. 잠시 후 다시 확인해 주세요.'
        )
        return
      }

      setPhase('openingProvider')
      setMessage('카카오페이 인증 화면으로 이동합니다.')
      window.location.assign(redirectUrl)
    } catch (error) {
      if (getPaymentErrorCode(error) === 'USER_CANCEL') {
        setPhase('cancelled')
        setMessage('결제가 취소되었으며 금액은 청구되지 않았습니다.')
      } else {
        setPhase('recoverableError')
        setMessage(
          error instanceof Error
            ? error.message
            : '결제 요청을 처리하지 못했습니다.'
        )
      }
    } finally {
      inFlightRef.current = false
    }
  }

  const isBusy = [
    'preparingOrder',
    'openingProvider',
    'awaitingReturn',
  ].includes(phase)
  const amount = preparedOrder?.amount ?? plan.price
  const hasProviders = availableProviders.length > 0 && selectedProvider
  const ctaLabel = phase === 'preparingOrder'
    ? '주문 준비 중'
    : phase === 'openingProvider' || phase === 'awaitingReturn'
      ? '결제 화면 여는 중'
      : phase === 'pendingVerification'
        ? '결제 준비 상태 다시 확인'
        : phase === 'cancelled'
          ? '같은 결제로 다시 시도'
          : selectedProvider === 'kakaopay'
            ? `카카오페이로 ${amount.toLocaleString()}원 결제하기`
            : `일반결제로 ${amount.toLocaleString()}원 결제하기`

  const paymentPanel = selectedProvider === 'toss' ? (
    paymentConfig ? (
      <TossPaymentPanel
        key={tossMountKey}
        config={paymentConfig}
        amount={plan.price}
        userId={user.id}
        onReady={handleTossReady}
        onError={handleTossError}
      />
    ) : (
      <p role="alert" className="text-sm text-destructive">
        일반결제 설정을 확인할 수 없습니다.
      </p>
    )
  ) : selectedProvider === 'kakaopay' ? (
    <KakaoPayPanel />
  ) : null

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
        {!hasProviders ? (
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
                결제 방식
              </h2>

              {availableProviders.length === 2 ? (
                <Tabs
                  value={selectedProvider}
                  onValueChange={changeProvider}
                  className="mt-5"
                >
                  <TabsList
                    aria-label="결제 방식 선택"
                    className="grid h-auto min-h-11 w-full grid-cols-2 bg-[var(--studio-primary-soft)]"
                  >
                    <TabsTrigger
                      value="toss"
                      disabled={Boolean(lockedProvider) || isBusy}
                      className="min-h-11 min-w-11 data-[state=active]:bg-[var(--studio-surface)] data-[state=active]:text-[var(--studio-primary)] focus-visible:ring-[var(--studio-focus-ring)]"
                    >
                      일반결제
                    </TabsTrigger>
                    <TabsTrigger
                      value="kakaopay"
                      disabled={Boolean(lockedProvider) || isBusy}
                      className="min-h-11 min-w-11 data-[state=active]:bg-[var(--studio-surface)] data-[state=active]:text-[var(--studio-primary)] focus-visible:ring-[var(--studio-focus-ring)]"
                    >
                      카카오페이
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="toss" className="mt-5 min-w-0">
                    {selectedProvider === 'toss' ? paymentPanel : null}
                  </TabsContent>
                  <TabsContent value="kakaopay" className="mt-5 min-w-0">
                    {selectedProvider === 'kakaopay' ? paymentPanel : null}
                  </TabsContent>
                </Tabs>
              ) : (
                <div className="mt-5">{paymentPanel}</div>
              )}

              {phase === 'recoverableError' && selectedProvider === 'toss' && !widgetsRef.current ? (
                <Button
                  type="button"
                  variant="brandOutline"
                  className="mt-4 min-h-11"
                  onClick={reloadTossPanel}
                >
                  결제 수단 다시 불러오기
                </Button>
              ) : null}
            </section>

            <OrderSummary plan={plan} user={user} amount={amount} />

            <div className="min-w-0 lg:col-span-2">
              {message ? (
                <p
                  role={phase === 'recoverableError' ? 'alert' : 'status'}
                  aria-live="polite"
                  className="mb-3 break-words text-sm leading-6 text-[var(--studio-muted)]"
                >
                  {message}
                </p>
              ) : null}

              <Button
                type="button"
                variant="brand"
                className="min-h-11 w-full text-base"
                disabled={
                  isBusy ||
                  (selectedProvider === 'toss' && !widgetsRef.current)
                }
                onClick={beginPayment}
              >
                {isBusy ? (
                  <Loader2
                    aria-hidden="true"
                    className="size-5 animate-spin motion-reduce:animate-none"
                  />
                ) : selectedProvider === 'kakaopay' ? (
                  <WalletCards aria-hidden="true" className="size-5" />
                ) : (
                  <CreditCard aria-hidden="true" className="size-5" />
                )}
                {ctaLabel}
              </Button>

              {errorCode === 'PAYMENT_ATTEMPT_PAYLOAD_CONFLICT' ? (
                <Button
                  type="button"
                  variant="brandGhost"
                  className="mt-2 min-h-11 w-full"
                  onClick={resetAttempt}
                >
                  새 결제 시도 시작하기
                </Button>
              ) : null}
            </div>

            <div className="flex min-h-11 min-w-0 items-center justify-center gap-2 text-sm text-[var(--studio-muted)]">
              <ShieldCheck aria-hidden="true" className="size-4" />
              {selectedProvider === 'toss'
                ? '토스페이먼츠 안전결제'
                : '카카오페이 안전결제'}
            </div>

            <div className="min-w-0 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 text-sm leading-6 text-[var(--studio-text)] shadow-[var(--studio-shadow-card)] lg:col-span-3">
              <p className="font-bold text-[var(--studio-ink)]">결제 전 확인</p>
              <ul className="mt-2 space-y-1 text-[var(--studio-muted)]">
                <li>1회 최대 100,000원이며 자동결제되지 않습니다.</li>
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
