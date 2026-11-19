/**
 * /pricing 페이지
 * 크레딧 충전 상품 선택 페이지
 */

import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getCreditBalanceSnapshot, selectDisplayBalance } from '@/lib/credit-balance'
import { MAX_POINT_CHARGE_AMOUNT, MIN_POINT_CHARGE_AMOUNT } from '@/lib/payment-constants'
import { POINT_CHARGE_MAX_AMOUNT_TEXT, POINT_CHARGE_REFUND_DAYS, POINT_CHARGE_VALIDITY_YEARS } from '@/lib/point-charge-policy'
import { PricingClient } from './pricing-client'

export const dynamic = 'force-dynamic'

export default async function PricingPage() {
    const supabase = await createClient()

    // 요금제 목록 조회
    const { data: plans } = await supabase
        .from('pricing_plans')
        .select('*')
        .eq('is_active', true)
        .gte('price', MIN_POINT_CHARGE_AMOUNT)
        .lte('price', MAX_POINT_CHARGE_AMOUNT)
        .order('sort_order', { ascending: true })

    // 현재 사용자 정보
    const { data: { user } } = await supabase.auth.getUser()

    let credits = 0
    if (user) {
        const snapshot = await getCreditBalanceSnapshot(user.id, supabase)
        credits = selectDisplayBalance(user.id, snapshot)
    }

    const linkClass =
        'inline-flex min-h-11 items-center text-[var(--studio-text)] underline underline-offset-4 hover:text-[var(--studio-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'

    return (
        <div className="min-h-screen bg-[var(--studio-background-sunken)] px-4 py-8 sm:py-12">
            <div className="mx-auto max-w-5xl">
                <h1 className="sr-only">크레딧 충전</h1>

                {/* 안내 배너, 보유 크레딧, 상품 선택과 결제 요약 */}
                <PricingClient
                    plans={plans || []}
                    isLoggedIn={!!user}
                    currentCredits={credits}
                />

                {/* 결제 전에 확인할 것 */}
                <section
                    aria-labelledby="charge-notice-heading"
                    className="mt-4 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] px-6 py-6 sm:mt-5 sm:px-8"
                >
                    <h2 id="charge-notice-heading" className="text-base font-bold text-[var(--studio-ink)]">
                        결제 전에 확인해 주세요
                    </h2>
                    <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
                        <div>
                            <dt className="font-semibold text-[var(--studio-text)]">사용 기한</dt>
                            <dd className="mt-1 text-[var(--studio-muted)] break-keep">결제일로부터 {POINT_CHARGE_VALIDITY_YEARS}년. 문제마켓 자료 구매에 씁니다.</dd>
                        </div>
                        <div>
                            <dt className="font-semibold text-[var(--studio-text)]">환불</dt>
                            <dd className="mt-1 text-[var(--studio-muted)] break-keep">구매 후 {POINT_CHARGE_REFUND_DAYS}일 안에 1개도 쓰지 않았다면 환불을 요청할 수 있습니다(원 결제수단으로 환불).</dd>
                        </div>
                        <div>
                            <dt className="font-semibold text-[var(--studio-text)]">충전 한도</dt>
                            <dd className="mt-1 text-[var(--studio-muted)] break-keep">1회 최대 {POINT_CHARGE_MAX_AMOUNT_TEXT}. 자동결제되지 않습니다.</dd>
                        </div>
                    </dl>

                    <details className="group mt-6 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-background)]">
                        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold text-[var(--studio-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] [&::-webkit-details-marker]:hidden">
                            환불 정책 자세히 보기
                            <span aria-hidden="true" className="text-[var(--studio-muted)] transition-transform group-open:rotate-180">▾</span>
                        </summary>
                        <ul className="flex list-disc flex-col gap-1.5 border-t border-[var(--studio-border)] py-4 pl-9 pr-4 text-sm leading-6 text-[var(--studio-muted)] break-keep">
                            <li>1회 최대 {POINT_CHARGE_MAX_AMOUNT_TEXT}까지만 충전할 수 있으며 자동결제되지 않습니다.</li>
                            <li>구매한 크레딧은 결제일로부터 {POINT_CHARGE_VALIDITY_YEARS}년 동안 사용할 수 있으며, 환불은 구매 후 {POINT_CHARGE_REFUND_DAYS}일 이내에 크레딧을 1개도 사용하지 않은 경우 가능합니다.</li>
                            <li>문제마켓 자료의 다운로드/열람이 완료된 사용분은 환불이 제한됩니다.</li>
                            <li>충전한 크레딧은 구매 계정에서만 사용할 수 있으며, 회원 간 양도·이전은 지원하지 않습니다.</li>
                            <li>결제 오류·중복 결제·서비스 장애는 확인 후 환불 또는 크레딧 복구가 가능합니다.</li>
                            <li>승인된 환불은 결제 당시 사용한 원 결제수단으로 처리되며, 카드·간편결제는 결제사 기준 영업일 2~5일이 소요될 수 있습니다.</li>
                        </ul>
                    </details>

                    <div className="mt-4 flex flex-wrap gap-x-5 text-sm">
                        <Link href="/terms/refund" className={linkClass}>
                            취소/환불정책 전문
                        </Link>
                        {user && (
                            <>
                                <Link href="/mypage/credits" className={linkClass}>
                                    충전·사용 내역
                                </Link>
                                <Link href="/mypage/payments" className={linkClass}>
                                    결제 내역
                                </Link>
                            </>
                        )}
                    </div>
                </section>
            </div>
        </div>
    )
}
