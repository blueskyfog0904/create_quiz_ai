/**
 * /pricing 페이지
 * 요금제 선택 및 구매 페이지
 */

import { createClient } from '@/lib/supabase/server'
import { PricingClient } from './pricing-client'

export const dynamic = 'force-dynamic'

export default async function PricingPage() {
    const supabase = await createClient()

    // 요금제 목록 조회
    const { data: plans } = await supabase
        .from('pricing_plans')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })

    // 현재 사용자 정보
    const { data: { user } } = await supabase.auth.getUser()

    let credits = 0
    if (user) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('credits')
            .eq('id', user.id)
            .single()
        credits = profile?.credits ?? 0
    }

    return (
        <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white py-12 px-4">
            <div className="max-w-6xl mx-auto">
                {/* 헤더 */}
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold text-gray-900 mb-4">
                        요금제 선택
                    </h1>
                    <p className="text-xl text-gray-600 max-w-2xl mx-auto">
                        AI 문제 생성과 문제은행 이용에 필요한 크레딧을 충전하세요.
                        <br />
                        더 많은 크레딧을 구매할수록 더 큰 할인을 받을 수 있습니다.
                    </p>

                    {user && (
                        <div className="mt-6 inline-flex items-center gap-2 bg-amber-50 px-4 py-2 rounded-full">
                            <span className="text-amber-700">현재 보유 크레딧:</span>
                            <span className="text-2xl font-bold text-amber-600">
                                {credits.toLocaleString()}
                            </span>
                        </div>
                    )}
                </div>

                {/* 요금제 카드 */}
                <PricingClient
                    plans={plans || []}
                    isLoggedIn={!!user}
                    currentCredits={credits}
                />

                {/* 안내 사항 */}
                <div className="mt-16 max-w-3xl mx-auto">
                    <h2 className="text-xl font-semibold text-gray-800 mb-4 text-center">
                        크레딧 사용 안내
                    </h2>
                    <div className="grid md:grid-cols-2 gap-6">
                        <div className="bg-white p-6 rounded-xl shadow-sm border">
                            <h3 className="font-medium text-gray-800 mb-2">🤖 AI 문제 생성</h3>
                            <p className="text-gray-600 text-sm">
                                지문을 입력하면 AI가 다양한 유형의 문제를 자동으로 생성합니다.
                                문제 유형에 따라 크레딧이 차감됩니다.
                            </p>
                        </div>
                        <div className="bg-white p-6 rounded-xl shadow-sm border">
                            <h3 className="font-medium text-gray-800 mb-2">📚 문제은행 이용</h3>
                            <p className="text-gray-600 text-sm">
                                다른 사용자가 공유한 문제를 내 문제은행으로 가져올 때 크레딧이 사용됩니다.
                            </p>
                        </div>
                    </div>

                    {/* 환불 정책 */}
                    <div className="mt-8 bg-blue-50 p-6 rounded-xl border border-blue-100">
                        <h3 className="font-medium text-blue-800 mb-2">💡 환불 정책</h3>
                        <ul className="text-blue-700 text-sm space-y-1">
                            <li>• 구매 후 7일 이내에만 환불 요청이 가능합니다.</li>
                            <li>• 크레딧을 1개라도 사용한 경우 환불이 불가합니다.</li>
                            <li>• 환불 요청 후 관리자 승인 절차를 거칩니다.</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    )
}
