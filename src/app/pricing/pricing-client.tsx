'use client'

/**
 * 크레딧 충전 화면: 안내 배너, 보유 크레딧, 충전 상품 선택, 결제 요약
 * 상품(금액·크레딧·이름·배지·강조·문구)은 관리자 요금제 화면(DB) 값으로만 그린다.
 */

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Tag } from 'lucide-react'
import { toast } from 'sonner'
import { buildAuthRedirectPath } from '@/lib/auth-paths'
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

// 충전 화면 문구(관리자 요금제 화면에서 고침). 자리표시는 서버에서 실제 값으로 채워 온다. 없으면 그 영역을 그리지 않는다.
export interface PricingPageCopy {
    bannerEyebrow: string
    bannerTitle: string
    guestBalanceText: string
    summaryNote: string
}

interface PricingClientProps {
    plans: PricingPlan[]
    isLoggedIn: boolean
    currentCredits: number
    copy: PricingPageCopy | null
}

const formatNumber = (value: number) => value.toLocaleString('ko-KR')

const cardClass = 'rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)]'

export function PricingClient({ plans, isLoggedIn, currentCredits, copy }: PricingClientProps) {
    const router = useRouter()
    // 처음에는 관리자가 강조한 상품을, 없으면 첫 상품을 고른 상태로 연다.
    const [selectedId, setSelectedId] = useState<string | null>(
        () => (plans.find((plan) => plan.is_highlighted === true) ?? plans[0])?.id ?? null
    )
    const selected = plans.find((plan) => plan.id === selectedId) ?? null
    const selectedBonus = selected ? getChargePlanBonus(selected.price, selected.credits) : null
    // 안내 문구(환불 정책 포함)를 읽지 못했으면 환불 조건을 보여 주지 않은 채 결제로 가지 않게 결제를 막는다.
    const purchaseBlocked = copy === null

    const handlePurchase = () => {
        if (!selected || purchaseBlocked) return
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

    return (
        <div className="flex flex-col gap-4 sm:gap-5">
            {/* 안내 배너 */}
            {copy && (
                <div className="flex items-center justify-between gap-4 rounded-[var(--studio-radius-card)] bg-[var(--studio-banner)] px-6 py-5 sm:px-10 sm:py-6">
                    <div className="min-w-0">
                        {copy.bannerEyebrow && (
                            <p className="text-sm text-[var(--studio-muted)] break-keep sm:text-base">{copy.bannerEyebrow}</p>
                        )}
                        <p className="mt-1 text-base font-bold text-[var(--studio-ink)] break-keep sm:text-xl">{copy.bannerTitle}</p>
                    </div>
                    <span
                        aria-hidden="true"
                        className="flex size-12 shrink-0 rotate-12 items-center justify-center rounded-xl bg-[var(--studio-highlight)] text-white shadow-sm sm:size-14"
                    >
                        <Tag className="size-6 sm:size-7" strokeWidth={2.5} />
                    </span>
                </div>
            )}

            {/* 보유 크레딧 */}
            <div className={`${cardClass} flex flex-wrap items-center justify-between gap-3 px-6 py-5 sm:px-8 sm:py-6`}>
                {isLoggedIn ? (
                    <p className="flex items-baseline gap-3 text-lg font-bold text-[var(--studio-ink)] sm:text-2xl">
                        보유 크레딧
                        <span className="[font-family:var(--studio-font-price)] tabular-nums text-[var(--studio-primary)]">
                            {formatNumber(currentCredits)}
                        </span>
                    </p>
                ) : (
                    <>
                        {copy?.guestBalanceText && (
                            <p className="text-base font-bold text-[var(--studio-ink)] sm:text-lg">{copy.guestBalanceText}</p>
                        )}
                        <Link
                            href={buildAuthRedirectPath('/pricing')}
                            className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--studio-primary)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                        >
                            로그인
                        </Link>
                    </>
                )}
            </div>

            <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
                {/* 충전 상품 */}
                <section className={`${cardClass} overflow-hidden`}>
                    <nav aria-label="크레딧 메뉴" className="flex gap-6 border-b border-[var(--studio-border)] px-6 sm:px-8">
                        <span
                            aria-current="page"
                            id="charge-plan-heading"
                            className="inline-flex min-h-14 items-center border-b-2 border-[var(--studio-ink)] text-base font-bold text-[var(--studio-ink)] sm:text-lg"
                        >
                            크레딧 충전
                        </span>
                        <Link
                            href="/mypage/credits"
                            className="inline-flex min-h-14 items-center border-b-2 border-transparent text-base font-semibold text-[var(--studio-muted)] hover:text-[var(--studio-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] sm:text-lg"
                        >
                            크레딧 내역
                        </Link>
                    </nav>

                    {plans.length === 0 ? (
                        <p className="px-6 py-10 text-center text-sm text-[var(--studio-muted)]">지금 판매 중인 크레딧 충전 상품이 없습니다.</p>
                    ) : (
                        <div role="radiogroup" aria-labelledby="charge-plan-heading" className="flex flex-col">
                            {plans.map((plan) => {
                                const isSelected = plan.id === selectedId
                                // 배지·강조·문구는 관리자가 요금제 화면에서 정한 DB 값으로만 그린다.
                                const highlighted = plan.is_highlighted === true
                                const bonus = getChargePlanBonus(plan.price, plan.credits)
                                // 작은 글씨는 요금제의 이름·설명(관리자 요금제 화면에서 고침)
                                const subline = [plan.name, plan.description?.trim()].filter(Boolean).join(' · ')

                                return (
                                    <label
                                        key={plan.id}
                                        className={`relative flex min-h-11 cursor-pointer items-center gap-4 border-b border-[var(--studio-border)] px-6 py-5 last:border-b-0 transition-colors sm:gap-5 sm:px-8 sm:py-6 ${isSelected
                                            ? 'bg-[var(--studio-primary-soft)]'
                                            : 'hover:bg-[var(--studio-background)]'
                                            } has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-[var(--studio-focus-ring)]`}
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
                                            className={`size-6 shrink-0 rounded-full ${isSelected
                                                ? 'border-[7px] border-[var(--studio-primary)] bg-white'
                                                : 'border-2 border-[var(--studio-border)] bg-white'
                                                }`}
                                        />

                                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                                            <span className="text-sm text-[var(--studio-muted)] break-keep">{subline}</span>
                                            <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                                                <span className="[font-family:var(--studio-font-price)] text-2xl font-bold tabular-nums text-[var(--studio-ink)] sm:text-[1.75rem]">
                                                    {formatNumber(plan.price)}원
                                                </span>
                                                {bonus ? (
                                                    <span className="[font-family:var(--studio-font-price)] text-lg font-semibold tabular-nums text-[var(--studio-bonus)] sm:text-xl">
                                                        +{formatNumber(bonus.credits)} 크레딧
                                                    </span>
                                                ) : (
                                                    <span className="[font-family:var(--studio-font-price)] text-base font-medium tabular-nums text-[var(--studio-muted)]">
                                                        {formatNumber(plan.credits)} 크레딧
                                                    </span>
                                                )}
                                                {plan.badge_text && (
                                                    <span
                                                        className={`inline-flex max-w-full items-center gap-1 rounded-[var(--studio-radius-control)] px-2 py-1 text-sm font-semibold break-keep ${highlighted
                                                            ? 'bg-[var(--studio-highlight-soft)] text-[var(--studio-highlight-text)]'
                                                            : 'bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]'
                                                            }`}
                                                    >
                                                        {/* 강조 상품 배지는 불꽃, 그 외 배지는 보석. Microsoft Fluent Emoji(MIT, public/emoji/LICENSE-fluentui-emoji.txt) */}
                                                        <Image
                                                            src={highlighted ? '/emoji/fire_3d.png' : '/emoji/gem_stone_3d.png'}
                                                            alt=""
                                                            width={18}
                                                            height={18}
                                                            className="size-[18px] shrink-0"
                                                        />
                                                        {plan.badge_text}
                                                    </span>
                                                )}
                                                {plan.discount_text && (
                                                    <span className="text-sm font-medium text-[var(--studio-highlight-text)]">
                                                        {plan.discount_text}
                                                    </span>
                                                )}
                                            </span>
                                        </span>
                                    </label>
                                )
                            })}
                        </div>
                    )}
                </section>

                {/* 결제 요약 */}
                <aside aria-label="결제 요약" className={`${cardClass} p-6 lg:sticky lg:top-28`}>
                    <h2 className="text-base font-bold text-[var(--studio-ink)]">결제 요약</h2>
                    {selected && (
                        <dl className="mt-4 flex flex-col gap-3 text-sm">
                            <div className="flex items-baseline justify-between gap-3">
                                <dt className="text-[var(--studio-muted)]">결제 금액</dt>
                                <dd className="[font-family:var(--studio-font-price)] text-xl font-bold tabular-nums text-[var(--studio-ink)]">
                                    {formatNumber(selected.price)}원
                                </dd>
                            </div>
                            <div className="flex items-baseline justify-between gap-3">
                                <dt className="text-[var(--studio-muted)]">받는 크레딧</dt>
                                <dd className="[font-family:var(--studio-font-price)] font-semibold tabular-nums text-[var(--studio-text)]">
                                    {formatNumber(selected.credits)}
                                </dd>
                            </div>
                            {selectedBonus && (
                                <div className="flex items-baseline justify-between gap-3">
                                    <dt className="text-[var(--studio-muted)]">추가 증정</dt>
                                    <dd className="[font-family:var(--studio-font-price)] font-semibold tabular-nums text-[var(--studio-bonus)]">
                                        +{formatNumber(selectedBonus.credits)} ({selectedBonus.percent}%)
                                    </dd>
                                </div>
                            )}
                            {isLoggedIn && (
                                <div className="flex items-baseline justify-between gap-3 border-t border-[var(--studio-border)] pt-3">
                                    <dt className="text-[var(--studio-muted)]">충전 후 잔액</dt>
                                    <dd className="[font-family:var(--studio-font-price)] font-bold tabular-nums text-[var(--studio-primary)]">
                                        {formatNumber(currentCredits + selected.credits)} 크레딧
                                    </dd>
                                </div>
                            )}
                        </dl>
                    )}

                    {purchaseBlocked && (
                        <p role="alert" className="mt-4 rounded-[var(--studio-radius-control)] bg-[var(--studio-highlight-soft)] px-3 py-2 text-sm text-[var(--studio-highlight-text)] break-keep">
                            충전 안내를 불러오지 못해 지금은 결제할 수 없습니다. 잠시 후 새로고침해 주세요.
                        </p>
                    )}
                    <button
                        type="button"
                        onClick={handlePurchase}
                        disabled={!selected || purchaseBlocked}
                        className={`mt-5 w-full max-lg:hidden ${purchaseButtonClass}`}
                    >
                        {purchaseLabel}
                    </button>

                    {copy?.summaryNote && (
                        <p className="mt-4 text-xs leading-5 text-[var(--studio-muted)] break-keep">{copy.summaryNote}</p>
                    )}
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
                            <button type="button" onClick={handlePurchase} disabled={purchaseBlocked} className={`shrink-0 ${purchaseButtonClass}`}>
                                {isLoggedIn ? '충전하기' : '로그인하고 충전하기'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
