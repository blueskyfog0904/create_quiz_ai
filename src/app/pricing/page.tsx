/**
 * /pricing 페이지
 * 크레딧 충전 상품 선택 페이지
 */

import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getCreditBalanceSnapshot, selectDisplayBalance } from '@/lib/credit-balance'
import { MAX_POINT_CHARGE_AMOUNT, MIN_POINT_CHARGE_AMOUNT } from '@/lib/payment-constants'
import { POINT_CHARGE_MAX_AMOUNT_TEXT, POINT_CHARGE_REFUND_DAYS, POINT_CHARGE_VALIDITY_YEARS } from '@/lib/point-charge-policy'
import { getChargePlanBonus } from '@/lib/pricing-plan-display'
import { fillPricingPagePlaceholders } from '@/lib/pricing-page-content'
import { getPricingPageContent } from '@/lib/pricing-page-content-server'
import { PricingClient, type PricingPageCopy } from './pricing-client'

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

    // 충전 화면 문구(관리자 요금제 화면에서 고침). 자리표시는 정책 값과 판매 중인 상품으로 채운다.
    const content = await getPricingPageContent()
    const maxBonusPercent = (plans || []).reduce(
        (max, plan) => Math.max(max, getChargePlanBonus(plan.price, plan.credits)?.percent ?? 0),
        0
    )
    const fill = (text: string) =>
        fillPricingPagePlaceholders(text, {
            '{사용기한}': String(POINT_CHARGE_VALIDITY_YEARS),
            '{환불기간}': String(POINT_CHARGE_REFUND_DAYS),
            '{충전한도}': POINT_CHARGE_MAX_AMOUNT_TEXT,
            '{최대보너스}': String(maxBonusPercent),
        })
    const copy: PricingPageCopy | null = content
        ? {
            bannerEyebrow: fill(content.banner_eyebrow),
            bannerTitle: fill(maxBonusPercent > 0 ? content.banner_title : content.banner_title_no_bonus),
            guestBalanceText: fill(content.guest_balance_text),
            summaryNote: fill(content.summary_note),
        }
        : null

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
                    copy={copy}
                />

                {/* 결제 전에 확인할 것. 문구를 읽지 못했으면 그리지 않고, 결제 버튼도 막힌다(PricingClient). */}
                {content && (
                    <section
                        aria-labelledby="charge-notice-heading"
                        className="mt-4 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] px-6 py-6 sm:mt-5 sm:px-8"
                    >
                        <h2 id="charge-notice-heading" className="text-base font-bold text-[var(--studio-ink)]">
                            {fill(content.notice_title)}
                        </h2>
                        {content.notice_items.length > 0 && (
                            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
                                {content.notice_items.map((item, index) => (
                                    <div key={index}>
                                        <dt className="font-semibold text-[var(--studio-text)]">{fill(item.title)}</dt>
                                        <dd className="mt-1 text-[var(--studio-muted)] break-keep">{fill(item.body)}</dd>
                                    </div>
                                ))}
                            </dl>
                        )}

                        {/* 환불 정책은 접지 않고 항상 보인다. */}
                        <div className="mt-6 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-background)] px-4 py-4">
                            <h3 className="text-sm font-semibold text-[var(--studio-text)]">{fill(content.refund_title)}</h3>
                            <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm leading-6 text-[var(--studio-muted)] break-keep">
                                {content.refund_items.map((item, index) => (
                                    <li key={index}>{fill(item)}</li>
                                ))}
                            </ul>
                        </div>
                    </section>
                )}

                {/* 약관·내역 링크는 문구 유무와 상관없이 항상 보인다. */}
                <div className="mt-3 flex flex-wrap gap-x-5 px-1 text-sm">
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
            </div>
        </div>
    )
}
