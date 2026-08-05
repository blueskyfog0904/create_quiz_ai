/**
 * /pricing 페이지
 * 크레딧 충전 상품 선택 페이지
 */

import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getCreditBalanceSnapshot, selectDisplayBalance } from '@/lib/credit-balance'
import { MAX_POINT_CHARGE_AMOUNT } from '@/lib/payment-constants'
import { PricingClient } from './pricing-client'

export const dynamic = 'force-dynamic'

export default async function PricingPage() {
    const supabase = await createClient()

    // 요금제 목록 조회
    const { data: plans } = await supabase
        .from('pricing_plans')
        .select('*')
        .eq('is_active', true)
        .lte('price', MAX_POINT_CHARGE_AMOUNT)
        .order('sort_order', { ascending: true })

    // 현재 사용자 정보
    const { data: { user } } = await supabase.auth.getUser()

    let credits = 0
    if (user) {
        const snapshot = await getCreditBalanceSnapshot(user.id, supabase)
        credits = selectDisplayBalance(user.id, snapshot)
    }

    return (
        <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white py-12 px-4">
            <div className="max-w-6xl mx-auto">
                {/* 헤더 */}
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold text-gray-900 mb-4">
                        크레딧 충전 상품
                    </h1>
                    <p className="text-xl text-gray-600 max-w-2xl mx-auto">
                        AI 문제 생성, 문제은행, 문제마켓에서 사용할 크레딧을 충전하세요.
                        <br />
                        월 구독이나 자동결제가 아닌 1회 충전 상품입니다.
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
                    <div className="grid md:grid-cols-3 gap-6">
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
                        <div className="bg-white p-6 rounded-xl shadow-sm border">
                            <h3 className="font-medium text-gray-800 mb-2">🛒 문제마켓 자료 구매</h3>
                            <p className="text-gray-600 text-sm">
                                영어·국어 문제마켓에서 수업자료를 구매할 때 크레딧이 사용됩니다.
                            </p>
                        </div>
                    </div>

                    {/* 환불 정책 */}
                    <div className="mt-8 bg-blue-50 p-6 rounded-xl border border-blue-100">
                        <h3 className="font-medium text-blue-800 mb-2">💡 환불 정책</h3>
                        <ul className="flex flex-col gap-1 text-blue-700 text-sm">
                            <li>• 1회 최대 100,000원까지만 충전할 수 있으며 자동결제되지 않습니다.</li>
                            <li>• 구매한 크레딧은 결제일로부터 1년 동안 사용할 수 있으며, 환불은 구매 후 7일 이내에 크레딧을 1개도 사용하지 않은 경우 가능합니다.</li>
                            <li>• AI 생성, 문제지 생성, 자료 다운로드/열람이 완료된 사용분은 환불이 제한됩니다.</li>
                            <li>• 충전한 크레딧은 구매 계정에서만 사용할 수 있으며, 회원 간 양도·이전은 지원하지 않습니다.</li>
                            <li>• 결제 오류·중복 결제·서비스 장애는 확인 후 환불 또는 크레딧 복구가 가능합니다.</li>
                            <li>• 승인된 환불은 결제 당시 사용한 원 결제수단으로 처리되며, 카드·간편결제는 결제사 기준 영업일 2~5일이 소요될 수 있습니다.</li>
                        </ul>
                        <div className="mt-4 flex flex-wrap gap-4 text-sm font-medium">
                            <Link
                                href="/terms/refund"
                                className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                취소/환불정책 전문
                            </Link>
                            {user && (
                                <>
                                    <Link
                                        href="/mypage/credits"
                                        className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    >
                                        충전·사용 내역
                                    </Link>
                                    <Link
                                        href="/mypage/payments"
                                        className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    >
                                        결제 내역
                                    </Link>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
