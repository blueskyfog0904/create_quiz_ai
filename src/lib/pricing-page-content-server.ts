import 'server-only'

import { createAdminClient } from '@/lib/supabase/bypass'
import {
    normalizePricingPageContent,
    parsePricingPageContent,
    PRICING_PAGE_CONTENT_SETTING_KEY,
    type PricingPageContent,
} from '@/lib/pricing-page-content'
import type { Json } from '@/types/supabase'

// 충전 화면은 비로그인도 보므로 서버 키로 이 설정 한 줄만 읽는다(system_settings는 로그인 회원만 읽을 수 있다).
// 행이 없거나 형식이 어긋나거나 읽기에 실패하면 null(문구 영역을 그리지 않는다).
export async function getPricingPageContent(): Promise<PricingPageContent | null> {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
    try {
        const { data, error } = await createAdminClient()
            .from('system_settings')
            .select('value')
            .eq('key', PRICING_PAGE_CONTENT_SETTING_KEY)
            .maybeSingle()
        if (error) throw error
        return parsePricingPageContent(data?.value)
    } catch (error) {
        console.error('[pricing-page-content] 충전 화면 문구를 읽지 못했습니다.', error)
        return null
    }
}

// 관리자 화면용: "행 없음"과 "읽기 실패"를 구분한다(읽기 실패를 빈 양식으로 보여 주면 기존 문구를 덮어쓸 수 있다).
export async function readPricingPageContentForAdmin(): Promise<
    { status: 'ok'; content: PricingPageContent } | { status: 'missing' } | { status: 'invalid' } | { status: 'error' }
> {
    try {
        const { data, error } = await createAdminClient()
            .from('system_settings')
            .select('value')
            .eq('key', PRICING_PAGE_CONTENT_SETTING_KEY)
            .maybeSingle()
        if (error) throw error
        if (!data) return { status: 'missing' }
        const content = parsePricingPageContent(data.value)
        // 행은 있는데 형식이 어긋나면(DB 직접 수정 등) 화면에서 다시 저장해 고칠 수 있게 따로 알린다.
        return content ? { status: 'ok', content } : { status: 'invalid' }
    } catch (error) {
        console.error('[pricing-page-content] 관리자 화면에서 충전 화면 문구를 읽지 못했습니다.', error)
        return { status: 'error' }
    }
}

// 관리자 저장(권한 검사는 부르는 쪽 서버 액션이 한다). 검사·정리한 값을 저장하고 돌려준다.
export async function savePricingPageContent(input: unknown): Promise<PricingPageContent> {
    const content = normalizePricingPageContent(input)
    const { error } = await createAdminClient()
        .from('system_settings')
        .upsert(
            {
                key: PRICING_PAGE_CONTENT_SETTING_KEY,
                value: content as unknown as Json,
                description: '크레딧 충전 화면 문구(관리자 요금제 화면에서 수정)',
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'key' }
        )
    if (error) throw new Error('충전 화면 문구를 저장하지 못했습니다.')
    return content
}
