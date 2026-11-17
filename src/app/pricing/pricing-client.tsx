'use client'

/**
 * 요금제 페이지 클라이언트 컴포넌트
 * 요금제 카드 표시 및 구매 처리
 */


import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Check, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { buildAuthRedirectPath } from '@/lib/auth-paths'

interface PricingPlan {
    id: string
    name: string
    credits: number
    price: number
    description: string | null
    is_active: boolean
    sort_order: number
    badge_text?: string | null
    is_highlighted?: boolean
    discount_text?: string | null
}

interface PricingClientProps {
    plans: PricingPlan[]
    isLoggedIn: boolean
    currentCredits: number
}

export function PricingClient({ plans, isLoggedIn }: PricingClientProps) {
    const router = useRouter()

    const handlePurchase = (plan: PricingPlan) => {
        if (!isLoggedIn) {
            toast.error('로그인이 필요합니다.')
            router.push(buildAuthRedirectPath(`/checkout?planId=${plan.id}`))
            return
        }

        // 결제 페이지로 이동
        router.push(`/checkout?planId=${plan.id}`)
    }

    // 크레딧당 가격 계산
    const getPricePerCredit = (plan: PricingPlan) => {
        return plan.price / plan.credits
    }

    return (
        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {plans.map((plan) => {
                const pricePerCredit = getPricePerCredit(plan)
                // 배지·강조·할인 문구는 관리자가 요금제 화면에서 정한 DB 값으로만 그린다.
                const highlighted = plan.is_highlighted === true

                return (
                    <Card
                        key={plan.id}
                        className={`relative flex flex-col ${highlighted
                            ? 'border-2 border-blue-500 shadow-lg scale-105'
                            : 'border border-gray-200'
                            }`}
                    >
                        {/* 강조 카드의 배지 */}
                        {plan.badge_text && highlighted && (
                            <div className="absolute -top-3 left-1/2 w-max max-w-full -translate-x-1/2">
                                <Badge className="bg-blue-500 text-white px-4 py-1 whitespace-normal text-center">
                                    <Sparkles className="w-3 h-3 mr-1" />
                                    {plan.badge_text}
                                </Badge>
                            </div>
                        )}

                        {/* 그 외 카드의 배지 */}
                        {plan.badge_text && !highlighted && (
                            <div className="absolute -top-3 left-1/2 w-max max-w-full -translate-x-1/2">
                                <Badge className="bg-green-500 text-white px-4 py-1 whitespace-normal text-center">
                                    {plan.badge_text}
                                </Badge>
                            </div>
                        )}

                        <CardHeader className="text-center pt-8">
                            <CardTitle className="text-2xl">{plan.name}</CardTitle>
                            <CardDescription className="text-gray-500">
                                {plan.description || '크레딧 요금제'}
                            </CardDescription>
                        </CardHeader>

                        <CardContent className="flex-1 flex flex-col">
                            {/* 가격 */}
                            <div className="text-center mb-6">
                                <div className="text-4xl font-bold text-gray-900">
                                    ₩{plan.price.toLocaleString()}
                                </div>
                                <div className="text-gray-500 mt-1">
                                    {plan.credits.toLocaleString()} 크레딧
                                </div>
                                {plan.discount_text && (
                                    <Badge variant="secondary" className="mt-2 max-w-full whitespace-normal text-center bg-green-100 text-green-700">
                                        {plan.discount_text}
                                    </Badge>
                                )}
                            </div>

                            {/* 혜택 목록 */}
                            <ul className="space-y-3 mb-6 flex-1">
                                <li className="flex items-center gap-2 text-sm text-gray-600">
                                    <Check className="w-4 h-4 text-green-500" />
                                    문제마켓 이용
                                </li>
                                <li className="flex items-center gap-2 text-sm text-gray-600">
                                    <Check className="w-4 h-4 text-green-500" />
                                    사용 기한 1년
                                </li>
                            </ul>

                            {/* 구매 버튼 */}
                            <Button
                                onClick={() => handlePurchase(plan)}
                                className={`min-h-11 w-full ${highlighted
                                    ? 'bg-blue-600 hover:bg-blue-700'
                                    : ''
                                    }`}
                                size="lg"
                            >
                                충전하기
                            </Button>

                            {/* 크레딧당 가격 */}
                            <p className="text-center text-xs text-gray-400 mt-3">
                                크레딧당 ₩{pricePerCredit.toFixed(2)}
                            </p>
                        </CardContent>
                    </Card>
                )
            })}
        </div>
    )
}
