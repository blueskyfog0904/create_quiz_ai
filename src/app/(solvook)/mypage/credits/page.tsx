import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getCreditBalanceSnapshot,
  logCreditBalanceMismatch,
  selectDisplayBalance,
} from '@/lib/credit-balance'
import {
  getPointChargeRefundEligibility,
  reportPointChargePolicyFallback,
  resolvePointChargeRefundBlockReason,
} from '@/lib/point-charge-refunds-server'
import { fillPointChargeRefundDays } from '@/lib/point-charge-policy'
import { getPointChargePolicyCached } from '@/lib/point-charge-policy-server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { readAllQueryRows } from '@/lib/read-all-query-rows'
import type { CreditSourceCategory } from '@/lib/credit-source-display'
import {
  CreditsView,
  type CreditSourceItem,
  type CreditTransactionItem,
} from './_components/credits-view'

// supabase 타입 추론이 단일 FK 조인을 배열로 넓히는 경우가 있어 양쪽 모두 수용한다.
function firstOrNull<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }
  return value ?? null
}

export const metadata: Metadata = {
  title: '크레딧 관리',
  description: '크레딧 잔액과 구매·거래 내역을 확인하고 환불을 신청할 수 있습니다.',
}

export default async function CreditsPage() {
  await connection()

  const userId = await getRequestAuthUserId()
  if (!userId) {
    redirect('/login?next=' + encodeURIComponent('/mypage/credits'))
  }

  const supabase = await createClient()
  const snapshot = await getCreditBalanceSnapshot(userId, supabase)

  if (snapshot.hasMismatch) {
    logCreditBalanceMismatch('mypage credits', userId, snapshot)
  }

  // 화면 문구(DB). 못 읽어도 화면은 그리고 키별 일반 문구로 대체한다(판정은 DB 함수).
  const policyPromise = getPointChargePolicyCached()
  const [sources, transactions] = await Promise.all([
    // 구매건 목록 (plan 정보 포함)
    readAllQueryRows((from, to) => supabase
      .from('credit_sources')
      .select(
        'id, initial_credits, remaining_credits, status, purchased_at, expires_at, source_category, payment_order_id, plan:pricing_plans(name, price)'
      )
      .eq('user_id', userId)
      .order('purchased_at', { ascending: false }).order('id').range(from, to)),
    // 거래 내역
    readAllQueryRows((from, to) => supabase
      .from('credit_transactions')
      .select(
        'id, type, amount, balance_after, description, created_at, source:credit_sources(source_category)'
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .order('id').range(from, to)),
  ])

  const policy = await policyPromise
  const sourceItems: CreditSourceItem[] = await Promise.all(
    (sources ?? []).map(async (source) => {
      // 원천마다 판정 실패를 잡는다(잔액·내역은 그대로, 이 원천의 환불 칸만 '확인하지 못했습니다').
      const eligibility = await getPointChargeRefundEligibility({
        userId,
        sourceId: source.id,
      }).catch((error) => {
        console.error('[mypage credits] 환불 판정 조회 실패', { sourceId: source.id, error })
        return null
      })
      if (eligibility?.policyFallback) {
        await reportPointChargePolicyFallback({
          userId,
          sourceId: source.id,
          paymentOrderId: source.payment_order_id,
          screen: 'mypage_credits',
        })
      }

      return {
        id: source.id,
        initial_credits: source.initial_credits,
        remaining_credits: source.remaining_credits,
        status: source.status as CreditSourceItem['status'],
        purchased_at: source.purchased_at,
        expires_at: source.expires_at,
        source_category: source.source_category as CreditSourceCategory,
        plan: firstOrNull(source.plan) as CreditSourceItem['plan'],
        canRefund: eligibility?.allowed ?? false,
        refundCheckFailed: eligibility === null,
        refundBlockedReason: eligibility
          ? resolvePointChargeRefundBlockReason(eligibility.reasonCode, policy, eligibility.refundDays)
          : null,
        refundableUntil: eligibility?.refundableUntil ?? null,
      }
    })
  )

  const transactionItems: CreditTransactionItem[] = (transactions ?? []).map((tx) => {
    const source = firstOrNull(tx.source)

    return {
      id: tx.id,
      type: tx.type,
      amount: tx.amount,
      balance_after: tx.balance_after,
      description: tx.description ?? '',
      created_at: tx.created_at,
      source: source
        ? { source_category: source.source_category as CreditSourceCategory }
        : null,
    }
  })

  return (
    <Suspense fallback={null}>
      <CreditsView
        balance={selectDisplayBalance(userId, snapshot)}
        spendableBalance={snapshot.spendableBalance}
        expiredBalance={snapshot.expiredBalance}
        nextExpirationAt={snapshot.nextExpirationAt}
        databaseNow={snapshot.databaseNow}
        sources={sourceItems}
        transactions={transactionItems}
        creditsGuide={policy?.creditsGuide ? fillPointChargeRefundDays(policy.creditsGuide, policy.refundDays) : null}
        refundRequestConfirm={policy ? policy.refundRequestConfirm.map((line) => fillPointChargeRefundDays(line, policy.refundDays)) : []}
      />
    </Suspense>
  )
}
