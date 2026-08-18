/**
 * 결제 페이지 (서버 컴포넌트)
 * 
 * URL: /checkout?planId=xxx
 * - 로그인 확인 → 미로그인 시 로그인 페이지로 리다이렉트
 * - 요금제 정보 조회 후 클라이언트 컴포넌트로 전달
 */

import { redirect } from 'next/navigation'
import { assertKakaoPayReady } from '@/lib/kakaopay-server'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import { createClient } from '@/lib/supabase/server'
import { assertTossPaymentsReady } from '@/lib/toss-payments-server'
import { CheckoutClient } from './checkout-client'

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
    redirect(`/login?redirect=/checkout?planId=${planId}`)
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, name, email')
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

  const availableProviders: Array<'toss' | 'kakaopay'> = []
  let paymentConfig: {
    clientKey: string
    paymentVariantKey: string
    agreementVariantKey: string
  } | null = null

  const admin = createPaymentAdminClient()
  const { data: runtimeRows } = await admin
    .from('payment_runtime_config')
    .select(`
      accepted_provider_environment,
      master_accepts_new_orders,
      toss_accepts_new_orders,
      toss_merchant_id,
      kakaopay_accepts_new_orders,
      kakaopay_merchant_id
    `)
    .eq('id', true)
    .limit(2)
  const runtime = runtimeRows?.length === 1 ? runtimeRows[0] : null

  if (runtime?.master_accepts_new_orders) {
    try {
      const toss = assertTossPaymentsReady()
      if (
        runtime.toss_accepts_new_orders &&
        runtime.accepted_provider_environment === toss.environment &&
        runtime.toss_merchant_id === toss.mid
      ) {
        paymentConfig = {
          clientKey: toss.clientKey,
          paymentVariantKey: toss.paymentVariantKey,
          agreementVariantKey: toss.agreementVariantKey,
        }
        availableProviders.push('toss')
      }
    } catch {
      paymentConfig = null
    }

    try {
      const kakao = assertKakaoPayReady()
      if (
        runtime.kakaopay_accepts_new_orders &&
        runtime.accepted_provider_environment === kakao.environment &&
        runtime.kakaopay_merchant_id === kakao.cid
      ) {
        availableProviders.push('kakaopay')
      }
    } catch {
      // Fail closed when KakaoPay configuration is incomplete.
    }
  }

  return (
    <CheckoutClient
      plan={plan}
      user={{
        id: user.id,
        name: profile?.name || user.email?.split('@')[0] || '고객',
        email: user.email || '',
      }}
      paymentConfig={paymentConfig}
      availableProviders={availableProviders}
    />
  )
}
