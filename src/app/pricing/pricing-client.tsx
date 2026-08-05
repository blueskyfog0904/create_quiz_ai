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

interface PricingPlan {
    id: string
    name: string
    credits: number
    price: number
    description: string | null
    is_active: boolean
    sort_order: number
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
            router.push(`/login?redirect=/checkout?planId=${plan.id}`)
            return
        }

        // 결제 페이지로 이동
        router.push(`/checkout?planId=${plan.id}`)
    }

    // 크레딧당 가격 계산 (할인율 표시용)
    const getPricePerCredit = (plan: PricingPlan) => {
        return plan.price / plan.credits
    }

    // 가장 인기있는 요금제 찾기 (Basic)
    const isPopular = (plan: PricingPlan) => plan.name === 'Basic'

    // 가장 저렴한 크레딧당 가격 찾기
    const lowestPricePerCredit = Math.min(...plans.map(getPricePerCredit))

    return (
        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {plans.map((plan) => {
                const pricePerCredit = getPricePerCredit(plan)
                const savingsPercent = Math.round((1 - pricePerCredit / (plans[0]?.price / plans[0]?.credits || 1)) * 100)
                const isLowestPrice = pricePerCredit === lowestPricePerCredit
                const popular = isPopular(plan)

                return (
                    <Card
                        key={plan.id}
                        className={`relative flex flex-col ${popular
                            ? 'border-2 border-blue-500 shadow-lg scale-105'
                            : 'border border-gray-200'
                            }`}
                    >
                        {/* 인기 배지 */}
                        {popular && (
                            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                                <Badge className="bg-blue-500 text-white px-4 py-1">
                                    <Sparkles className="w-3 h-3 mr-1" />
                                    가장 인기
                                </Badge>
                            </div>
                        )}

                        {/* 가장 저렴 배지 */}
                        {isLowestPrice && !popular && (
                            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                                <Badge className="bg-green-500 text-white px-4 py-1">
                                    최고 가성비
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
                                {savingsPercent > 0 && plan.sort_order > 1 && (
                                    <Badge variant="secondary" className="mt-2 bg-green-100 text-green-700">
                                        {savingsPercent}% 할인
                                    </Badge>
                                )}
                            </div>

                            {/* 혜택 목록 */}
                            <ul className="space-y-3 mb-6 flex-1">
                                <li className="flex items-center gap-2 text-sm text-gray-600">
                                    <Check className="w-4 h-4 text-green-500" />
                                    AI 문제 생성 이용
                                </li>
                                <li className="flex items-center gap-2 text-sm text-gray-600">
                                    <Check className="w-4 h-4 text-green-500" />
                                    문제은행 이용
                                </li>
                                <li className="flex items-center gap-2 text-sm text-gray-600">
                                    <Check className="w-4 h-4 text-green-500" />
                                    사용 기한 1년
                                </li>
                                {plan.sort_order >= 2 && (
                                    <li className="flex items-center gap-2 text-sm text-gray-600">
                                        <Check className="w-4 h-4 text-green-500" />
                                        우선 고객 지원
                                    </li>
                                )}
                            </ul>

                            {/* 구매 버튼 */}
                            <Button
                                onClick={() => handlePurchase(plan)}
                                className={`min-h-11 w-full ${popular
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
