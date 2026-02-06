/**
 * 결제 페이지 (서버 컴포넌트)
 * 
 * URL: /checkout?planId=xxx
 * - 로그인 확인 → 미로그인 시 로그인 페이지로 리다이렉트
 * - 요금제 정보 조회 후 클라이언트 컴포넌트로 전달
 */

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CheckoutClient } from './checkout-client'

interface CheckoutPageProps {
    searchParams: Promise<{ planId?: string }>
}

export default async function CheckoutPage({ searchParams }: CheckoutPageProps) {
    const params = await searchParams
    const planId = params.planId

    // planId 없으면 pricing 페이지로 리다이렉트
    if (!planId) {
        redirect('/pricing')
    }

    const supabase = await createClient()

    // 로그인 확인
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        // 미로그인 시 로그인 페이지로 (결제 페이지로 돌아오도록 redirect 파라미터 포함)
        redirect(`/login?redirect=/checkout?planId=${planId}`)
    }

    // 사용자 프로필 조회
    const { data: profile } = await supabase
        .from('profiles')
        .select('id, name, email')
        .eq('id', user.id)
        .single()

    // 요금제 정보 조회
    const { data: plan, error } = await supabase
        .from('pricing_plans')
        .select('*')
        .eq('id', planId)
        .eq('is_active', true)
        .single()

    if (error || !plan) {
        redirect('/pricing')
    }

    // 클라이언트 키
    const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY

    if (!clientKey) {
        throw new Error('NEXT_PUBLIC_TOSS_CLIENT_KEY 환경 변수가 설정되지 않았습니다.')
    }

    return (
        <CheckoutClient
            plan={plan}
            user={{
                id: user.id,
                name: profile?.name || user.email?.split('@')[0] || '고객',
                email: user.email || ''
            }}
            clientKey={clientKey}
        />
    )
}
