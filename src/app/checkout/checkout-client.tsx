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
    clientKey: string
}

// 고유한 주문번호 생성 (영문 대소문자, 숫자, -, _, = 조합)
function generateOrderId(): string {
    const timestamp = Date.now().toString(36)
    const randomStr = Math.random().toString(36).substring(2, 10)
    return `ORDER_${timestamp}_${randomStr}`.toUpperCase()
}

export function CheckoutClient({ plan, user, clientKey }: CheckoutClientProps) {
    const router = useRouter()
    const [isLoading, setIsLoading] = useState(true)
    const [isProcessing, setIsProcessing] = useState(false)
    const [isScriptLoaded, setIsScriptLoaded] = useState(false)
    const [orderId] = useState(() => generateOrderId())

    // 위젯 인스턴스 참조
    const widgetsRef = useRef<any>(null)
    const paymentMethodWidgetRef = useRef<any>(null)
    const agreementWidgetRef = useRef<any>(null)

    // SDK 스크립트 로드 완료 핸들러
    const handleScriptLoad = () => {
        setIsScriptLoaded(true)
    }

    // 결제위젯 초기화
    useEffect(() => {
        if (!isScriptLoaded) return

        const initWidget = async () => {
            try {
                // @ts-ignore - 전역 TossPayments 객체 사용
                const tossPayments = TossPayments(clientKey)

                // customerKey는 사용자 고유 ID 사용
                const widgets = tossPayments.widgets({
                    customerKey: user.id,
                })

                widgetsRef.current = widgets

                // 결제 금액 설정
                await widgets.setAmount({
                    currency: 'KRW',
                    value: plan.price,
                })

                // 결제 UI 렌더링 (DOM이 준비된 후)
                const paymentMethodWidget = await widgets.renderPaymentMethods({
                    selector: '#payment-method',
                    variantKey: 'DEFAULT',
                })
                paymentMethodWidgetRef.current = paymentMethodWidget

                // 약관 UI 렌더링
                const agreementWidget = await widgets.renderAgreement({
                    selector: '#agreement',
                    variantKey: 'AGREEMENT',
                })
                agreementWidgetRef.current = agreementWidget

                setIsLoading(false)
            } catch (error) {
                console.error('결제위젯 초기화 오류:', error)
                setIsLoading(false)
            }
        }

        // DOM이 준비된 후 위젯 초기화
        const timer = setTimeout(initWidget, 100)
        return () => clearTimeout(timer)
    }, [isScriptLoaded, clientKey, user.id, plan.price])

    // 결제 요청 처리
    const handlePayment = async () => {
        if (!widgetsRef.current || isProcessing) return

        setIsProcessing(true)

        try {
            await widgetsRef.current.requestPayment({
                orderId: orderId,
                orderName: `${plan.name} 요금제 (${plan.credits.toLocaleString()} 크레딧)`,
                customerEmail: user.email,
                customerName: user.name,
                successUrl: `${window.location.origin}/checkout/success?planId=${plan.id}`,
                failUrl: `${window.location.origin}/checkout/fail`,
            })
        } catch (error: any) {
            // 사용자가 결제창을 닫은 경우
            if (error.code === 'USER_CANCEL') {
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
            <Script
                src="https://js.tosspayments.com/v2/standard"
                onLoad={handleScriptLoad}
            />

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
                            요금제로 돌아가기
                        </Button>
                        <h1 className="text-2xl font-bold">결제하기</h1>
                        <p className="text-gray-600 mt-1">안전하게 결제를 완료해주세요</p>
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
                                            <p className="font-medium">{plan.name} 요금제</p>
                                            <p className="text-sm text-gray-500">
                                                {plan.credits.toLocaleString()} 크레딧
                                            </p>
                                        </div>
                                        <p className="font-semibold">
                                            ₩{plan.price.toLocaleString()}
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

                                    {/* 결제 금액 */}
                                    <div className="flex justify-between items-center">
                                        <span className="font-medium">총 결제금액</span>
                                        <span className="text-2xl font-bold text-blue-600">
                                            ₩{plan.price.toLocaleString()}
                                        </span>
                                    </div>

                                    {/* 결제 버튼 */}
                                    <Button
                                        onClick={handlePayment}
                                        disabled={isLoading || isProcessing}
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
                                                ₩{plan.price.toLocaleString()} 결제하기
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
                                    {/* 로딩 상태 */}
                                    {isLoading && (
                                        <div className="flex items-center justify-center py-20">
                                            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                                            <span className="ml-3 text-gray-500">결제 수단을 불러오는 중...</span>
                                        </div>
                                    )}

                                    {/* 결제수단 선택 UI */}
                                    <div
                                        id="payment-method"
                                        className={isLoading ? 'hidden' : ''}
                                    />

                                    {/* 약관 동의 UI */}
                                    <div
                                        id="agreement"
                                        className={`mt-4 ${isLoading ? 'hidden' : ''}`}
                                    />
                                </CardContent>
                            </Card>
                        </div>
                    </div>

                    {/* 하단 안내 */}
                    <div className="mt-8 text-center text-sm text-gray-500">
                        <p>결제 문의: support@createquizai.com</p>
                        <p className="mt-1">
                            결제 후 즉시 크레딧이 충전되며, 환불은 미사용 크레딧에 한해 가능합니다.
                        </p>
                    </div>
                </div>
            </div>
        </>
    )
}
