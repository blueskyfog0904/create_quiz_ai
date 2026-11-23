/**
 * /pricing 페이지
 * 크레딧 충전 상품 선택 페이지
 */

import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getCreditBalanceSnapshot, selectDisplayBalance } from '@/lib/credit-balance'
import { MAX_POINT_CHARGE_AMOUNT, MIN_POINT_CHARGE_AMOUNT } from '@/lib/payment-constants'
import { POINT_CHARGE_MAX_AMOUNT_TEXT, POINT_CHARGE_VALIDITY_YEARS } from '@/lib/point-charge-policy'
import { getPointChargePolicyCached } from '@/lib/point-charge-policy-server'
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
    // {환불기간} 은 충전 정책 설정(point_charge_policy.refundDays) 값. 읽지 못하면 그 자리표시가 든 줄은 그리지 않는다.
    const pointChargePolicy = await getPointChargePolicyCached()
    const refundDaysText = pointChargePolicy ? String(pointChargePolicy.refundDays) : null
    const shows = (text: string) => refundDaysText !== null || !text.includes('{환불기간}')
    const maxBonusPercent = (plans || []).reduce(
        (max, plan) => Math.max(max, getChargePlanBonus(plan.price, plan.credits)?.percent ?? 0),
        0
    )
    const fill = (text: string) =>
        fillPricingPagePlaceholders(text, {
            '{사용기한}': String(POINT_CHARGE_VALIDITY_YEARS),
            '{환불기간}': refundDaysText ?? '{환불기간}',
            '{충전한도}': POINT_CHARGE_MAX_AMOUNT_TEXT,
            '{최대보너스}': String(maxBonusPercent),
        })
    const copy: PricingPageCopy | null = content
        ? {
            bannerEyebrow: fill(content.banner_eyebrow),
            bannerTitle: fill(maxBonusPercent > 0 ? content.banner_title : content.banner_title_no_bonus),
            guestBalanceText: fill(content.guest_balance_text),
            summaryNote: shows(content.summary_note) ? fill(content.summary_note) : '',
        }
        : null

    const noticeItems = content ? content.notice_items.filter((item) => shows(item.title) && shows(item.body)) : []
    const refundItems = content ? content.refund_items.filter(shows) : []

    const linkClass =
        'inline-flex min-h-11 items-center text-[var(--studio-muted)] underline underline-offset-4 hover:text-[var(--studio-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'

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

                {/* 결제 전 안내(유의사항). 카드 없이 바탕 위에 작은 제목과 목록으로 둔다.
                    문구를 읽지 못했으면 그리지 않고, 결제 버튼도 막힌다(PricingClient). */}
                <section aria-label="유의사항" className="mt-8 px-1 sm:mt-10">
                    {content && (
                        <>
                            <h2 className="text-sm font-bold text-[var(--studio-ink)]">{fill(content.notice_title)}</h2>
                            {noticeItems.length > 0 && (
                                <ul className="mt-3 flex flex-col gap-1.5 text-[13px] leading-5 text-[var(--studio-muted)] break-keep">
                                    {noticeItems.map((item, index) => (
                                        <li key={index} className="flex gap-1.5">
                                            <span aria-hidden="true">·</span>
                                            <span>
                                                <strong className="font-semibold text-[var(--studio-text)]">{fill(item.title)}</strong>{' '}
                                                {fill(item.body)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}

                            {/* 환불 정책은 접지 않고 항상 보인다. */}
                            <h2 className="mt-6 text-sm font-bold text-[var(--studio-ink)]">{fill(content.refund_title)}</h2>
                            <ul className="mt-3 flex flex-col gap-1.5 text-[13px] leading-5 text-[var(--studio-muted)] break-keep">
                                {refundItems.map((item, index) => (
                                    <li key={index} className="flex gap-1.5">
                                        <span aria-hidden="true">·</span>
                                        <span>{fill(item)}</span>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}

                    {/* 약관·내역 링크는 문구 유무와 상관없이 항상 보인다. */}
                    <div className="mt-4 flex flex-wrap gap-x-5 text-[13px]">
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
