// 충전 상품 카드에 보이는 짧은 문구(배지·할인 문구)의 저장 규칙. DB의 CHECK(앞뒤 공백 없는 1~20자 또는 NULL)와 같다.
export const PRICING_PLAN_DISPLAY_TEXT_MAX_LENGTH = 20

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
