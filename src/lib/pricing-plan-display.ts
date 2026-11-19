// 충전 상품 카드에 보이는 짧은 문구(배지·할인 문구)의 저장 규칙. DB의 CHECK(앞뒤 공백 없는 1~20자 또는 NULL)와 같다.
export const PRICING_PLAN_DISPLAY_TEXT_MAX_LENGTH = 20
// 상품 설명: 충전 화면 상품 줄의 작은 글씨("상품명 · 설명")로 보인다.
export const PRICING_PLAN_DESCRIPTION_MAX_LENGTH = 60

// 앞뒤 공백을 떼고, 비어 있으면 null로 바꾼다. 20자를 넘으면 한국어 오류를 던진다.
export function normalizePricingPlanDisplayText(value: unknown, label: string): string | null {
    if (value === null || value === undefined) return null
    if (typeof value !== 'string') throw new Error(`${label}는 글자로 입력해 주세요.`)

    const trimmed = value.trim()
    if (trimmed === '') return null
    if (trimmed.length > PRICING_PLAN_DISPLAY_TEXT_MAX_LENGTH) {
        throw new Error(`${label}는 ${PRICING_PLAN_DISPLAY_TEXT_MAX_LENGTH}자 이하여야 합니다.`)
    }
    return trimmed
}

// 충전 상품의 보너스 크레딧. 기준은 결제 금액 1원 = 1크레딧(사용자 결정 2026-11-19)이고,
// 금액·크레딧은 상품(DB) 값이다. 받는 크레딧이 결제 금액보다 많을 때만 보너스로 보고, 비율은 내림한 정수 %다.
export function getChargePlanBonus(price: number, credits: number): { credits: number; percent: number } | null {
    if (!Number.isFinite(price) || !Number.isFinite(credits) || price <= 0) return null
    const bonus = credits - price
    if (bonus <= 0) return null
    return { credits: bonus, percent: Math.floor((bonus / price) * 100) }
}
