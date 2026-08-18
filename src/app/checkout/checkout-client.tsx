'use client'

/**
 * 결제 페이지 클라이언트 컴포넌트
 * 
 * 토스페이먼츠 결제위젯을 렌더링합니다.
 * - PC: 좌측 결제위젯, 우측 주문정보
 * - 모바일: 상단 주문정보, 하단 결제위젯
 */

import { useEffect, useRef, useState } from 'react'
import Script from 'next/script'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Loader2, CreditCard, ShieldCheck, ArrowLeft } from 'lucide-react'

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

interface CheckoutClientProps {
    plan: PricingPlan
    user: User
    paymentConfig: {
        clientKey: string
        paymentVariantKey: string
        agreementVariantKey: string
    } | null
}

interface PreparedOrder {
    orderId: string
    orderName: string
    amount: number
    credits: number
    expiresAt: string
}

interface TossWidgets {
    setAmount(input: { currency: 'KRW'; value: number }): Promise<void>
    renderPaymentMethods(input: { selector: string; variantKey: string }): Promise<unknown>
    renderAgreement(input: { selector: string; variantKey: string }): Promise<unknown>
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

function getCheckoutAttemptId(userId: string, planId: string) {
    const storageKey = `point-checkout-attempt:${userId}:${planId}:toss`
    const stored = window.sessionStorage.getItem(storageKey)
    if (stored) return stored

    const checkoutAttemptId = crypto.randomUUID()
    window.sessionStorage.setItem(storageKey, checkoutAttemptId)
    return checkoutAttemptId
}

export function CheckoutClient({ plan, user, paymentConfig }: CheckoutClientProps) {
    const router = useRouter()
    const [isLoading, setIsLoading] = useState(true)
    const [isProcessing, setIsProcessing] = useState(false)
    const [isScriptLoaded, setIsScriptLoaded] = useState(false)
    const [order, setOrder] = useState<PreparedOrder | null>(null)
    const [preparationError, setPreparationError] = useState<string | null>(
        paymentConfig ? null : '현재 포인트 충전 기능을 준비 중입니다.'
    )

    const widgetsRef = useRef<TossWidgets | null>(null)
    const preparationStartedRef = useRef(false)
    const initializedOrderRef = useRef<string | null>(null)

    // SDK 스크립트 로드 완료 핸들러
    const handleScriptLoad = () => {
        setIsScriptLoaded(true)
    }

    useEffect(() => {
        if (!paymentConfig || preparationStartedRef.current) return
        preparationStartedRef.current = true

        const prepareOrder = async () => {
            try {
                const response = await fetch('/api/payments/orders', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        planId: plan.id,
                        checkoutAttemptId: getCheckoutAttemptId(user.id, plan.id),
                    }),
                })
                const data = await response.json()

                if (!response.ok) {
                    throw new Error(data.error || '결제 주문을 준비하지 못했습니다.')
                }

                setOrder(data as PreparedOrder)
            } catch (error) {
                setPreparationError(
                    error instanceof Error
                        ? error.message
                        : '결제 주문을 준비하지 못했습니다.'
                )
                setIsLoading(false)
            }
        }

        void prepareOrder()
    }, [paymentConfig, plan.id, user.id])

    // 결제위젯 초기화
    useEffect(() => {
        if (
            !isScriptLoaded ||
            !paymentConfig ||
            !order ||
            initializedOrderRef.current === order.orderId
        ) {
            return
        }
        initializedOrderRef.current = order.orderId

        const initWidget = async () => {
            try {
                if (!window.TossPayments) {
                    throw new Error('결제 모듈을 불러오지 못했습니다.')
                }
                const tossPayments = window.TossPayments(paymentConfig.clientKey)

                const widgets = tossPayments.widgets({
                    customerKey: user.id,
                })

                widgetsRef.current = widgets

                await widgets.setAmount({
                    currency: 'KRW',
                    value: order.amount,
                })

                await widgets.renderPaymentMethods({
                    selector: '#payment-method',
                    variantKey: paymentConfig.paymentVariantKey,
                })

                await widgets.renderAgreement({
                    selector: '#agreement',
                    variantKey: paymentConfig.agreementVariantKey,
                })

                setIsLoading(false)
            } catch (error) {
                console.error('결제위젯 초기화 오류:', error)
                setPreparationError('결제 수단을 불러오지 못했습니다.')
                setIsLoading(false)
            }
        }

        // DOM이 준비된 후 위젯 초기화
        const timer = setTimeout(initWidget, 100)
        return () => clearTimeout(timer)
    }, [isScriptLoaded, order, paymentConfig, user.id])

    // 결제 요청 처리
    const handlePayment = async () => {
        if (!widgetsRef.current || !order || isProcessing) return

        setIsProcessing(true)

        try {
            await widgetsRef.current.requestPayment({
                orderId: order.orderId,
                orderName: order.orderName,
                customerEmail: user.email,
                customerName: user.name,
                successUrl: `${window.location.origin}/checkout/success`,
                failUrl: `${window.location.origin}/checkout/fail`,
            })
        } catch (error: unknown) {
            // 사용자가 결제창을 닫은 경우
            if (getPaymentErrorCode(error) === 'USER_CANCEL') {
                console.log('사용자가 결제를 취소했습니다.')
            } else {
                console.error('결제 요청 오류:', error)
            }
            setIsProcessing(false)
        }
    }

    return (
        <>
            {/* 토스페이먼츠 SDK 스크립트 */}
            {paymentConfig && (
                <Script
                    src="https://js.tosspayments.com/v2/standard"
                    onLoad={handleScriptLoad}
                />
            )}

            <div className="min-h-screen bg-gray-50 py-8">
                <div className="container max-w-6xl mx-auto px-4">
                    {/* 헤더 */}
                    <div className="mb-8">
                        <Button
                            variant="ghost"
                            onClick={() => router.push('/pricing')}
                            className="mb-4"
                        >
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            충전 상품으로 돌아가기
                        </Button>
                        <h1 className="text-2xl font-bold">크레딧 충전 결제</h1>
                        <p className="text-gray-600 mt-1">
                            자동결제 없이 한 번만 결제되는 충전 상품입니다.
                        </p>
                    </div>

                    {/* 메인 레이아웃: PC는 좌우, 모바일은 상하 */}
                    <div className="flex flex-col lg:flex-row gap-6">
                        {/* 모바일: 주문정보가 먼저 / PC: 오른쪽에 배치 */}
                        <div className="lg:order-2 lg:w-[380px]">
                            <Card className="sticky top-4">
                                <CardHeader>
                                    <CardTitle className="text-lg">주문 정보</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    {/* 상품 정보 */}
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <p className="font-medium">{plan.name} 크레딧 충전</p>
                                            <p className="text-sm text-gray-500">
                                                {plan.credits.toLocaleString()} 크레딧
                                            </p>
                                        </div>
                                        <p className="font-semibold">
                                            ₩{(order?.amount ?? plan.price).toLocaleString()}
                                        </p>
                                    </div>

                                    <Separator />

                                    {/* 구매자 정보 */}
                                    <div className="space-y-2">
                                        <p className="text-sm font-medium text-gray-700">구매자 정보</p>
                                        <div className="text-sm text-gray-600 space-y-1">
                                            <p>{user.name}</p>
                                            <p>{user.email}</p>
                                        </div>
                                    </div>

                                    <Separator />

                                    <div className="space-y-2 rounded-md bg-muted p-3 text-xs text-muted-foreground">
                                        <p className="font-medium text-foreground">결제 전 확인</p>
                                        <p>1회 최대 100,000원 · 자동결제 없음</p>
                                        <p>사용기한은 결제일로부터 1년이며 회원 간 양도는 불가합니다.</p>
                                        <p>구매 후 7일 이내 완전 미사용 시 원 결제수단으로 환불합니다.</p>
                                        <Link
                                            href="/terms/refund"
                                            className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-4"
                                        >
                                            취소/환불정책 전문 보기
                                        </Link>
                                    </div>

                                    <Separator />

                                    {/* 결제 금액 */}
                                    <div className="flex justify-between items-center">
                                        <span className="font-medium">총 결제금액</span>
                                        <span className="text-2xl font-bold text-blue-600">
                                            ₩{(order?.amount ?? plan.price).toLocaleString()}
                                        </span>
                                    </div>

                                    {/* 결제 버튼 */}
                                    <Button
                                        onClick={handlePayment}
                                        disabled={isLoading || isProcessing || !order || Boolean(preparationError)}
                                        className="w-full h-12 text-base"
                                        size="lg"
                                    >
                                        {isProcessing ? (
                                            <>
                                                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                                결제 진행 중...
                                            </>
                                        ) : isLoading ? (
                                            <>
                                                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                                결제 준비 중...
                                            </>
                                        ) : (
                                            <>
                                                <CreditCard className="w-5 h-5 mr-2" />
                                                ₩{(order?.amount ?? plan.price).toLocaleString()} 결제하기
                                            </>
                                        )}
                                    </Button>

                                    {/* 보안 안내 */}
                                    <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
                                        <ShieldCheck className="w-4 h-4" />
                                        <span>토스페이먼츠 안전결제</span>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* 결제위젯 영역 */}
                        <div className="lg:order-1 flex-1">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg">결제 수단</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="mb-4 rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
                                        <p className="font-medium text-foreground">이용 가능한 결제수단</p>
                                        <p className="mt-1">
                                            신용·체크카드, 카카오페이, 네이버페이, 페이코, 토스페이
                                        </p>
                                        <p className="mt-2">
                                            계좌이체·가상계좌 및 하나카드는 포인트 충전에 사용할 수 없습니다.
                                            일부 카드사는 심사 정책에 따라 제한될 수 있습니다.
                                        </p>
                                    </div>
                                    {preparationError && (
                                        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                                            {preparationError}
                                        </div>
                                    )}
                                    {/* 로딩 상태 */}
                                    {isLoading && !preparationError && (
                                        <div className="flex items-center justify-center py-20">
                                            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                                            <span className="ml-3 text-gray-500">결제 수단을 불러오는 중...</span>
                                        </div>
                                    )}

                                    {/* 결제수단 선택 UI */}
                                    <div
                                        id="payment-method"
                                        className={isLoading || preparationError ? 'hidden' : ''}
                                    />

                                    {/* 약관 동의 UI */}
                                    <div
                                        id="agreement"
                                        className={`mt-4 ${isLoading || preparationError ? 'hidden' : ''}`}
                                    />
                                </CardContent>
                            </Card>
                        </div>
                    </div>

                    {/* 하단 안내 */}
                    <div className="mt-8 text-center text-sm text-gray-500">
                        <p>결제 문의: support@createquizai.com</p>
                        <p className="mt-1">
                            결제 후 즉시 크레딧이 충전되며, 크레딧은 문제마켓 자료 구매에 사용합니다.
                        </p>
                    </div>
                </div>
            </div>
        </>
    )
}
