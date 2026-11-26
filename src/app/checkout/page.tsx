/**
 * 결제 페이지 (서버 컴포넌트)
 * 
 * URL: /checkout?planId=xxx
 * - 로그인 확인 → 미로그인 시 로그인 페이지로 리다이렉트
 * - 요금제 정보 조회 후 클라이언트 컴포넌트로 전달
 */

import { redirect } from 'next/navigation'
import { buildAuthRedirectPath } from '@/lib/auth-paths'
import { assertPayAppReady } from '@/lib/payapp-server'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import { getPointChargeCheckoutNotice } from '@/lib/point-charge-policy-server'
import { createClient } from '@/lib/supabase/server'
import { getSolvookFooterData } from '@/lib/solvook-footer-data'
import { formatMemberDisplayName } from '@/lib/member-display-name'
import { UpcomingPolicyNotice } from '@/components/legal/upcoming-policy-notice'
import { CheckoutConsentPreviewBand } from '@/components/checkout/checkout-consent-preview-band'
import { getSiteFooterContent } from '@/lib/footer-content-server'
import { buildMarketPurchaseInfo } from '@/lib/market-purchase-info'
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
    .select('id, email, phone, display_tag')
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

  // 운영 스위치와 키 설정을 모두 통과한 결제사의 결제수단만 보여 준다(카카오페이는 종료 — 주문 라우트가 503).
  const availableProviders = new Set<string>()
  const admin = createPaymentAdminClient()
  const { data: runtimeRows } = await admin
    .from('payment_runtime_config')
    .select(`
      master_accepts_new_orders,
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
      provider: 'payapp' as const,
    }))

  // 결제 문의 연락처는 관리자 'Footer 설정'의 상담/주문 이메일·고객센터 값을 쓴다(코드에 적지 않는다).
  const { cs } = await getSolvookFooterData()
  const supportContact = [cs.email, cs.phone].filter(Boolean).join(' · ')

  // 결제 전 확인 문구(DB point_charge_policy, 캐시 없음). 1판 고지와 2판 묶음 중 하나만 값이 있다(11번 5-2).
  // 둘 다 null 이면 결제 버튼을 막는다(1판 정책 읽기 실패 경보는 함수가 남긴다).
  const { checkoutNotice, checkoutConsent, preview } = await getPointChargeCheckoutNotice(user.id)
  // 약관·환불정책 링크는 하단 정보(DB)에서 읽고 판과 관계없이 늘 내려 준다(1판으로 연 화면이 409 로 2판을 받아도 그 자리에서 그림).
  const { termsLink, refundPolicyLink } = buildMarketPurchaseInfo(await getSiteFooterContent())

  return (
    <>
    <CheckoutConsentPreviewBand preview={preview} />
    <CheckoutClient
      plan={plan}
      supportContact={supportContact}
      user={{
        id: user.id,
        // 회원 이름은 저장하지 않는다. 결제창 구매자명은 회원 표시 이름을 쓴다.
        name: formatMemberDisplayName(profile?.email ?? user.email, profile?.display_tag),
        email: user.email || '',
        phone: profile?.phone ?? null,
      }}
      paymentMethods={paymentMethods}
      checkoutNotice={checkoutNotice}
      checkoutConsent={checkoutConsent}
      termsLink={termsLink}
      refundPolicyLink={refundPolicyLink}
      upcomingNotice={<UpcomingPolicyNotice />}
    />
    </>
  )
}
