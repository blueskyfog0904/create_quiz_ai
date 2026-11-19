// 크레딧 충전 화면(/pricing)의 문구. 관리자 요금제 화면에서 고치고 system_settings에 한 묶음으로 둔다.
// 처음 값은 마이그레이션(20261119100000)이 넣는다. 코드에는 기본 문구를 두지 않는다.
// 정책·상품에서 오는 숫자는 자리표시로 쓰고, 화면에 그릴 때 실제 값으로 바꾼다.

export const PRICING_PAGE_CONTENT_SETTING_KEY = 'pricing_page_content'

export const PRICING_PAGE_PLACEHOLDERS = {
    '{사용기한}': '크레딧 사용 기한(년)',
    '{환불기간}': '미사용 환불 가능 기간(일)',
    '{충전한도}': '1회 충전 한도(원)',
    '{최대보너스}': '판매 중인 상품의 보너스 최대 %',
} as const

export type PricingPagePlaceholderValues = Record<keyof typeof PRICING_PAGE_PLACEHOLDERS, string>

export interface PricingPageNoticeItem {
    title: string
    body: string
}

export interface PricingPageContent {
    banner_eyebrow: string
    banner_title: string
    banner_title_no_bonus: string
    guest_balance_text: string
    summary_note: string
    notice_title: string
    notice_items: PricingPageNoticeItem[]
    refund_title: string
    refund_items: string[]
}

const LINE_MAX = 120
const PARAGRAPH_MAX = 400
const NOTICE_ITEMS_MAX = 6
const REFUND_ITEMS_MAX = 12

const TEXT_FIELDS = {
    banner_eyebrow: { label: '배너 윗줄', max: LINE_MAX, required: false },
    banner_title: { label: '배너 제목(보너스 상품이 있을 때)', max: LINE_MAX, required: true },
    banner_title_no_bonus: { label: '배너 제목(보너스 상품이 없을 때)', max: LINE_MAX, required: true },
    guest_balance_text: { label: '비로그인 보유 크레딧 안내', max: LINE_MAX, required: true },
    summary_note: { label: '결제 요약 아래 안내', max: PARAGRAPH_MAX, required: false },
    notice_title: { label: '확인 사항 제목', max: LINE_MAX, required: true },
    refund_title: { label: '환불 정책 제목', max: LINE_MAX, required: true },
} as const

function readText(value: unknown, label: string, max: number, required: boolean): string {
    if (value !== undefined && value !== null && typeof value !== 'string') {
        throw new Error(`${label}은(는) 글자로 입력해 주세요.`)
    }
    const text = typeof value === 'string' ? value.trim() : ''
    if (required && !text) throw new Error(`${label}을(를) 입력해 주세요.`)
    if (text.length > max) throw new Error(`${label}은(는) ${max}자 이하여야 합니다.`)
    // 자리표시 오타(예: {사용 기한})가 화면에 그대로 나가지 않게, 목록에 없는 {…}는 받지 않는다.
    const unknown = (text.match(/\{[^{}]*\}/g) ?? []).find((token) => !(token in PRICING_PAGE_PLACEHOLDERS))
    if (unknown) {
        throw new Error(`${label}의 ${unknown}는 쓸 수 없는 자리표시입니다. ${Object.keys(PRICING_PAGE_PLACEHOLDERS).join(' ')} 중에서 써 주세요.`)
    }
    return text
}

// 저장 전에 검사하고 정리한다(앞뒤 공백 제거, 빈 항목 제외). 잘못되면 한국어 오류를 던진다.
export function normalizePricingPageContent(input: unknown): PricingPageContent {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('충전 화면 문구 형식이 올바르지 않습니다.')
    }
    const source = input as Record<string, unknown>
    const texts = Object.fromEntries(
        Object.entries(TEXT_FIELDS).map(([key, rule]) => [key, readText(source[key], rule.label, rule.max, rule.required)])
    ) as Omit<PricingPageContent, 'notice_items' | 'refund_items'>

    if (!Array.isArray(source.notice_items)) throw new Error('확인 사항 형식이 올바르지 않습니다.')
    const noticeItems = source.notice_items
        .map((item, index) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error(`확인 사항 ${index + 1}번 형식이 올바르지 않습니다.`)
            }
            const record = item as Record<string, unknown>
            return {
                title: readText(record.title, `확인 사항 ${index + 1}번 제목`, LINE_MAX, false),
                body: readText(record.body, `확인 사항 ${index + 1}번 내용`, PARAGRAPH_MAX, false),
            }
        })
        .filter((item) => item.title || item.body)
    if (noticeItems.some((item) => !item.title || !item.body)) {
        throw new Error('확인 사항은 제목과 내용을 함께 입력해 주세요.')
    }
    if (noticeItems.length > NOTICE_ITEMS_MAX) throw new Error(`확인 사항은 ${NOTICE_ITEMS_MAX}개까지 넣을 수 있습니다.`)

    if (!Array.isArray(source.refund_items)) throw new Error('환불 정책 형식이 올바르지 않습니다.')
    const refundItems = source.refund_items
        .map((item, index) => readText(item, `환불 정책 ${index + 1}번`, PARAGRAPH_MAX, false))
        .filter(Boolean)
    if (refundItems.length === 0) throw new Error('환불 정책을 1줄 이상 입력해 주세요.')
    if (refundItems.length > REFUND_ITEMS_MAX) throw new Error(`환불 정책은 ${REFUND_ITEMS_MAX}줄까지 넣을 수 있습니다.`)

    return { ...texts, notice_items: noticeItems, refund_items: refundItems }
}

// DB 값을 읽을 때: 형식이 어긋나면 화면을 깨지 않도록 null을 돌려준다(그 경우 문구 영역을 그리지 않는다).
export function parsePricingPageContent(value: unknown): PricingPageContent | null {
    try {
        return normalizePricingPageContent(value)
    } catch {
        return null
    }
}

// 자리표시를 실제 값으로 바꾼다. 모르는 중괄호 글자는 그대로 둔다.
export function fillPricingPagePlaceholders(text: string, values: PricingPagePlaceholderValues): string {
    return (Object.keys(values) as Array<keyof PricingPagePlaceholderValues>).reduce(
        (result, placeholder) => result.split(placeholder).join(values[placeholder]),
        text
    )
}
