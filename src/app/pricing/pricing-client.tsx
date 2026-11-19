'use client'

/**
 * 크레딧 충전 화면의 상품 선택과 결제 요약
 * 상품(금액·크레딧·이름·설명·배지·강조·문구)은 관리자 요금제 화면(DB) 값으로만 그린다.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { buildAuthRedirectPath } from '@/lib/auth-paths'
import { POINT_CHARGE_REFUND_DAYS, POINT_CHARGE_VALIDITY_YEARS } from '@/lib/point-charge-policy'
import { getChargePlanBonus } from '@/lib/pricing-plan-display'

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

const formatNumber = (value: number) => value.toLocaleString('ko-KR')

export function PricingClient({ plans, isLoggedIn, currentCredits }: PricingClientProps) {
    const router = useRouter()
    // 처음에는 관리자가 강조한 상품을, 없으면 첫 상품을 고른 상태로 연다.
    const [selectedId, setSelectedId] = useState<string | null>(
        () => (plans.find((plan) => plan.is_highlighted === true) ?? plans[0])?.id ?? null
    )
    const selected = plans.find((plan) => plan.id === selectedId) ?? null
    const selectedBonus = selected ? getChargePlanBonus(selected.price, selected.credits) : null

    const handlePurchase = () => {
        if (!selected) return
        const checkoutPath = `/checkout?planId=${selected.id}`
        if (!isLoggedIn) {
            toast.error('로그인이 필요합니다.')
            router.push(buildAuthRedirectPath(checkoutPath))
            return
        }
        router.push(checkoutPath)
    }

    const purchaseLabel = selected
        ? isLoggedIn
            ? `${formatNumber(selected.price)}원 충전하기`
            : '로그인하고 충전하기'
        : '상품을 선택해 주세요'
    const purchaseButtonClass =
        'inline-flex min-h-11 items-center justify-center rounded-[var(--studio-radius-control)] bg-[var(--studio-primary)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--studio-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] focus-visible:ring-offset-2 disabled:opacity-50'

    if (plans.length === 0) {
        return (
            <p className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] px-6 py-10 text-center text-sm text-[var(--studio-muted)]">
                지금 판매 중인 충전 상품이 없습니다.
            </p>
        )
    }

    return (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
            <section aria-labelledby="charge-plan-heading">
                <h2 id="charge-plan-heading" className="mb-3 text-sm font-semibold text-[var(--studio-text)]">
                    크레딧 충전 상품
                </h2>
                <div role="radiogroup" aria-labelledby="charge-plan-heading" className="flex flex-col gap-2">
                    {plans.map((plan) => {
                        const isSelected = plan.id === selectedId
                        // 배지·강조·문구는 관리자가 요금제 화면에서 정한 DB 값으로만 그린다.
                        const highlighted = plan.is_highlighted === true
                        const bonus = getChargePlanBonus(plan.price, plan.credits)
                        const subline = [plan.name, plan.description].filter(Boolean).join(' · ')

                        return (
                            <label
                                key={plan.id}
                                className={`group relative flex min-h-11 cursor-pointer items-center gap-4 rounded-[var(--studio-radius-card)] border bg-[var(--studio-surface)] px-4 py-4 transition-colors sm:px-5 ${isSelected
                                    ? 'border-[var(--studio-primary)] ring-1 ring-[var(--studio-primary)]'
                                    : 'border-[var(--studio-border)] hover:border-[var(--studio-primary-border)]'
                                    } has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--studio-focus-ring)]`}
                            >
                                <input
                                    type="radio"
                                    name="charge-plan"
                                    value={plan.id}
                                    checked={isSelected}
                                    onChange={() => setSelectedId(plan.id)}
                                    className="sr-only"
                                />
                                <span
                                    aria-hidden="true"
                                    className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${isSelected
                                        ? 'border-[var(--studio-primary)]'
                                        : 'border-[var(--studio-control-border)]'
                                        }`}
                                >
                                    {isSelected && <span className="size-2.5 rounded-full bg-[var(--studio-primary)]" />}
                                </span>

                                <span className="flex min-w-0 flex-1 flex-col gap-1">
                                    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                                        <span className="[font-family:var(--studio-font-price)] text-xl font-bold tabular-nums text-[var(--studio-ink)] max-sm:w-full sm:w-32">
                                            {formatNumber(plan.price)}원
                                        </span>
                                        <span className="[font-family:var(--studio-font-price)] text-base font-semibold tabular-nums text-[var(--studio-text)]">
                                            {formatNumber(plan.credits)} 크레딧
                                        </span>
                                        {bonus && (
                                            <span className="rounded-full bg-[var(--studio-primary-soft)] px-2 py-0.5 text-xs font-semibold tabular-nums text-[var(--studio-primary)]">
                                                보너스 +{formatNumber(bonus.credits)} · {bonus.percent}%
                                            </span>
                                        )}
                                        {plan.discount_text && (
                                            <span className="text-xs font-medium text-[var(--studio-highlight-text)]">
                                                {plan.discount_text}
                                            </span>
                                        )}
                                    </span>
                                    {subline && (
                                        <span className="text-xs text-[var(--studio-muted)] break-keep">{subline}</span>
                                    )}
                                </span>

                                {plan.badge_text && (
                                    <span
                                        className={`max-w-[40%] rounded-[var(--studio-radius-control)] px-2 py-1 text-center text-xs font-semibold break-keep ${highlighted
                                            ? 'bg-[var(--studio-primary)] text-white'
                                            : 'border border-[var(--studio-border)] text-[var(--studio-text)]'
                                            }`}
                                    >
                                        {plan.badge_text}
                                    </span>
                                )}
                            </label>
                        )
                    })}
                </div>
            </section>

            <aside
                aria-label="결제 요약"
                className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 shadow-[var(--studio-shadow-card)] lg:sticky lg:top-28"
            >
                <h2 className="text-sm font-semibold text-[var(--studio-text)]">결제 요약</h2>
                {selected && (
                    <dl className="mt-4 flex flex-col gap-3 text-sm">
                        <div className="flex items-baseline justify-between gap-3">
                            <dt className="text-[var(--studio-muted)]">결제 금액</dt>
                            <dd className="[font-family:var(--studio-font-price)] text-lg font-bold tabular-nums text-[var(--studio-ink)]">
                                {formatNumber(selected.price)}원
                            </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                            <dt className="text-[var(--studio-muted)]">받는 크레딧</dt>
                            <dd className="[font-family:var(--studio-font-price)] font-semibold tabular-nums text-[var(--studio-text)]">
                                {formatNumber(selected.credits)}
                                {selectedBonus && (
                                    <span className="ml-1 text-xs font-medium text-[var(--studio-primary)]">
                                        (보너스 +{formatNumber(selectedBonus.credits)})
                                    </span>
                                )}
                            </dd>
                        </div>
                        {isLoggedIn && (
                            <div className="flex items-baseline justify-between gap-3 border-t border-[var(--studio-border)] pt-3">
                                <dt className="text-[var(--studio-muted)]">충전 후 잔액</dt>
                                <dd className="[font-family:var(--studio-font-price)] font-semibold tabular-nums text-[var(--studio-ink)]">
                                    {formatNumber(currentCredits + selected.credits)} 크레딧
                                </dd>
                            </div>
                        )}
                    </dl>
                )}

                <button
                    type="button"
                    onClick={handlePurchase}
                    disabled={!selected}
                    className={`mt-5 w-full max-lg:hidden ${purchaseButtonClass}`}
                >
                    {purchaseLabel}
                </button>

                <p className="mt-3 text-xs leading-5 text-[var(--studio-muted)] break-keep">
                    문제마켓 이용에 쓰는 선불 크레딧입니다. 사용 기한 {POINT_CHARGE_VALIDITY_YEARS}년, 자동결제 없음.
                    구매 후 {POINT_CHARGE_REFUND_DAYS}일 안에 1개도 쓰지 않았다면 환불을 요청할 수 있습니다.
                </p>
            </aside>

            {/* 모바일: 고른 상품과 결제 버튼을 상품 영역의 화면 아래에 붙인다(목록을 내려 보지 않아도 결제할 수 있게).
                상품 영역 안에서만 붙어 있으므로 아래 안내·바닥글을 가리지 않는다. */}
            {selected && (
                <div className="sticky bottom-0 z-30 -mx-4 border-t border-[var(--studio-border)] bg-[var(--studio-surface)] px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 lg:hidden">
                    <div className="mx-auto flex max-w-5xl items-center gap-3">
                        <div className="min-w-0 flex-1">
                            <p className="[font-family:var(--studio-font-price)] text-base font-bold tabular-nums text-[var(--studio-ink)]">
                                {formatNumber(selected.price)}원
                            </p>
                            <p className="truncate text-xs tabular-nums text-[var(--studio-muted)]">
                                {formatNumber(selected.credits)} 크레딧
                                {isLoggedIn && ` · 충전 후 ${formatNumber(currentCredits + selected.credits)}`}
                            </p>
                        </div>
                        <button type="button" onClick={handlePurchase} className={`shrink-0 ${purchaseButtonClass}`}>
                            {isLoggedIn ? '충전하기' : '로그인하고 충전하기'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
