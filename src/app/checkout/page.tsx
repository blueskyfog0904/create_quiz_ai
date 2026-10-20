/**
 * 결제 페이지 (서버 컴포넌트)
 * 
 * URL: /checkout?planId=xxx
 * - 로그인 확인 → 미로그인 시 로그인 페이지로 리다이렉트
 * - 요금제 정보 조회 후 클라이언트 컴포넌트로 전달
 */

import { redirect } from 'next/navigation'
import { buildAuthRedirectPath } from '@/lib/auth-paths'
import { assertKakaoPayReady } from '@/lib/kakaopay-server'
import { assertPayAppReady } from '@/lib/payapp-server'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import { createClient } from '@/lib/supabase/server'
import { formatMemberDisplayName } from '@/lib/member-display-name'
import { CheckoutClient, type CheckoutPaymentMethod } from './checkout-client'

interface CheckoutPageProps {
  searchParams: Promise<{ planId?: string }>
}

export default async function CheckoutPage({ searchParams }: CheckoutPageProps) {
  const params = await searchParams
  const planId = params.planId

  if (!planId) {
    redirect('/pricing')
  }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect(buildAuthRedirectPath(`/checkout?planId=${planId}`))
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, phone')
    .eq('id', user.id)
    .single()

  const { data: plan, error } = await supabase
    .from('pricing_plans')
    .select('*')
    .eq('id', planId)
    .eq('is_active', true)
    .single()

  if (error || !plan) {
    redirect('/pricing')
  }

  // 운영 스위치와 키 설정을 모두 통과한 결제사의 결제수단만 보여 준다.
  const availableProviders = new Set<string>()
  const admin = createPaymentAdminClient()
  const { data: runtimeRows } = await admin
    .from('payment_runtime_config')
    .select(`
      accepted_provider_environment,
      master_accepts_new_orders,
      kakaopay_accepts_new_orders,
      kakaopay_merchant_id,
      payapp_accepts_new_orders,
      payapp_merchant_id
    `)
    .eq('id', true)
    .limit(2)
  const runtime = runtimeRows?.length === 1 ? runtimeRows[0] : null

  if (runtime?.master_accepts_new_orders) {
    try {
      const payapp = assertPayAppReady()
      if (
        runtime.payapp_accepts_new_orders &&
        runtime.payapp_merchant_id === payapp.userId
      ) {
        availableProviders.add('payapp')
      }
    } catch {
      // Fail closed when PayApp configuration is incomplete.
    }

    try {
      const kakao = assertKakaoPayReady()
      if (
        runtime.kakaopay_accepts_new_orders &&
        runtime.accepted_provider_environment === kakao.environment &&
        runtime.kakaopay_merchant_id === kakao.cid
      ) {
        availableProviders.add('kakaopay')
      }
    } catch {
      // Fail closed when KakaoPay configuration is incomplete.
    }
  }

  // 결제수단 목록·순서·안내 문구는 DB(payment_methods)에서 읽는다.
  const { data: methodRows } = availableProviders.size > 0
    ? await admin
      .from('payment_methods')
      .select('code, label, description, provider, provider_open_pay_type')
      .eq('is_enabled', true)
      .order('sort_order')
    : { data: [] }
  const paymentMethods: CheckoutPaymentMethod[] = (methodRows ?? [])
    // 페이앱 수단은 결제창 수단 값이 있어야 주문 route가 받는다.
    .filter((method) => availableProviders.has(method.provider) &&
      (method.provider !== 'payapp' || Boolean(method.provider_open_pay_type)))
    .map((method) => ({
      code: method.code,
      label: method.label,
      description: method.description,
      provider: method.provider === 'kakaopay' ? 'kakaopay' : 'payapp',
    }))

  return (
    <CheckoutClient
      plan={plan}
      user={{
        id: user.id,
        // 회원 이름은 저장하지 않는다. 결제창 구매자명은 회원 표시 이름을 쓴다.
        name: formatMemberDisplayName(profile?.email ?? user.email, user.id),
        email: user.email || '',
        phone: profile?.phone ?? null,
      }}
      paymentMethods={paymentMethods}
    />
  )
}
