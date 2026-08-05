/**
 * 크레딧 서비스 (FIFO 기반)
 * 
 * 이 모듈은 FIFO(First-In-First-Out) 방식으로 크레딧을 차감합니다.
 * 가장 먼저 구매한 credit_source부터 크레딧을 차감하며,
 * 환불 대기 중(pending_refund)인 구매건은 차감에서 제외됩니다.
 */

import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import type { CreditSourceCategory } from '@/lib/credit-source-display'
import { getCreditBalanceSnapshot, reportCreditBalanceMismatch, syncProfileBalanceCacheFromLedger } from '@/lib/credit-balance'

// ============================================================================
// 타입 정의
// ============================================================================

export interface CreditSource {
  id: string
  user_id: string
  plan_id: string | null
  source_category: CreditSourceCategory
  initial_credits: number
  remaining_credits: number
  status: 'active' | 'pending_refund' | 'refunded'
  purchased_at: string
  expires_at: string | null
}

export interface CreditTransaction {
  id: string
  user_id: string
  type: 'purchase' | 'consume' | 'refund' | 'admin_grant' | 'bonus'
  amount: number
  balance_after: number
  description: string
  source_id?: string
  resource_type?: string
  resource_id?: string
  created_at: string
}

export interface DeductResult {
  success: boolean
  newBalance: number
  consumptions: Array<{
    sourceId: string
    amount: number
  }>
}

const toFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const rpcErrorMessage = (error: { message?: unknown } | null | undefined): string => {
  if (error && typeof error.message === 'string' && error.message.trim()) {
    return error.message
  }
  return '크레딧 처리 중 오류가 발생했습니다.'
}

interface CreditRpcConsumeResult {
  new_balance: number
  consumptions: Array<{
    source_id: string
    amount: number
  }>
}

interface CreditRpcRefundResult {
  new_balance: number
  refunded: number
}

async function finalizeCreditBalanceMutation(
  userId: string,
  context: string,
  client: Parameters<typeof getCreditBalanceSnapshot>[1]
) {
  const newBalance = await syncProfileBalanceCacheFromLedger(userId, client)
  const snapshot = await getCreditBalanceSnapshot(userId, client)

  if (snapshot.hasMismatch) {
    await reportCreditBalanceMismatch(context, userId, snapshot)
  }

  return {
    newBalance,
    snapshot,
  }
}

// ============================================================================
// CreditService 클래스
// ============================================================================

export class CreditService {

  /**
   * 사용자의 현재 크레딧 잔액을 조회합니다.
   * DB 시각 기준으로 만료되지 않은 사용 가능 원장 잔액을 조회합니다.
   */
  static async getBalance(userId: string): Promise<number> {
    const snapshot = await getCreditBalanceSnapshot(userId)
    return snapshot.spendableBalance
  }

  /**
   * 사용자의 활성 크레딧 소스(구매건)를 FIFO 순서로 조회합니다.
   * status가 'active'인 것만 조회하며, purchased_at 오름차순으로 정렬합니다.
   */
  static async getActiveSources(userId: string): Promise<CreditSource[]> {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('credit_sources')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .gt('remaining_credits', 0) // 남은 크레딧이 있는 것만
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('expires_at', { ascending: true, nullsFirst: false })
      .order('purchased_at', { ascending: true })
      .order('id', { ascending: true })

    if (error) {
      console.error('[CreditService] getActiveSources error:', error)
      return []
    }

    return data ?? []
  }

  /**
   * 사용자의 모든 크레딧 소스(구매건)를 조회합니다.
   */
  static async getAllSources(userId: string): Promise<CreditSource[]> {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('credit_sources')
      .select(`
        *,
        plan:pricing_plans(name, price)
      `)
      .eq('user_id', userId)
      .order('purchased_at', { ascending: false })

    if (error) {
      console.error('[CreditService] getAllSources error:', error)
      return []
    }

    return data ?? []
  }

  /**
   * FIFO 방식으로 크레딧을 차감합니다.
   * 
   * 1. 활성 상태(status='active')인 credit_sources를 purchased_at 오름차순으로 조회
   * 2. 가장 오래된 source부터 크레딧 차감
   * 3. credit_consumption에 차감 내역 기록
   * 4. profiles.credits 총 잔액 감소
   * 5. credit_transactions에 로그 기록
   * 
   * @param userId - 사용자 ID
   * @param amount - 차감할 크레딧 양 (양수)
   * @param resourceType - 리소스 유형 (예: 'ai_generation', 'question_import')
   * @param resourceId - 관련 리소스 ID
   * @param description - 설명
   * @returns DeductResult - 차감 결과
   */
  static async deductCredits(
    userId: string,
    amount: number,
    resourceType: string,
    resourceId: string | null,
    description: string
  ): Promise<DeductResult> {
    const adminSupabase = createAdminClient()
    const rpcClient = adminSupabase as unknown as {
      rpc: (fn: string, params: Record<string, unknown>) => Promise<{
        data: unknown
        error: { message: string } | null
      }>
    }

    const { data, error } = await rpcClient.rpc('consume_credits', {
      p_user_id: userId,
      p_amount: amount,
      p_resource_type: resourceType,
      p_resource_id: resourceId,
      p_description: description
    })

    if (error) {
      const message = rpcErrorMessage(error)
      throw new Error(message.includes('INSUFFICIENT') || message.includes('부족') ? 'INSUFFICIENT_CREDITS' : message)
    }

    const result = (Array.isArray(data) ? data[0] : data) as CreditRpcConsumeResult | undefined
    const newBalance = toFiniteNumber(result?.new_balance)

    if (result === undefined || !Array.isArray(result.consumptions) || newBalance === null) {
      throw new Error('크레딧이 부족합니다.')
    }

    const consumptions = result.consumptions
      .map(({ source_id, amount }) => ({
        sourceId: String(source_id),
        amount: toFiniteNumber(amount) ?? 0
      }))
      .filter(consumption => consumption.amount > 0)

    if (consumptions.length === 0) {
      throw new Error('크레딧 차감 응답이 올바르지 않습니다.')
    }

    const { newBalance: syncedBalance } = await finalizeCreditBalanceMutation(
      userId,
      'Deduct',
      adminSupabase
    )

    return {
      success: true,
      newBalance: syncedBalance,
      consumptions
    }
  }

  /**
   * 크레딧 차감을 롤백(환불)합니다.
   *
   * 1. 지정된 source들의 remaining_credits를 되돌려 FIFO 소비 내역 기준으로 복구
   * 2. profiles.credits 복원
   * 3. credit_transactions에 refund 로그 기록
   */
  static async refundCredits(
    userId: string,
    amount: number,
    resourceType: string,
    resourceId: string | null,
    description: string,
    consumptions: Array<{
      sourceId: string
      amount: number
    }>,
    targetBalance?: number
  ): Promise<number> {
    if (amount <= 0) {
      return this.getBalance(userId)
    }

    if (!consumptions || consumptions.length === 0) {
      throw new Error('환불 대상 소비 내역이 없습니다.')
    }

    const adminSupabase = createAdminClient()
    const rpcClient = adminSupabase as unknown as {
      rpc: (fn: string, params: Record<string, unknown>) => Promise<{
        data: unknown
        error: { message: string } | null
      }>
    }

    const rpcPayload = consumptions.map(({ sourceId, amount }) => ({
      source_id: sourceId,
      amount
    }))

    if (rpcPayload.length === 0) {
      throw new Error('환불 대상 소비 내역이 없습니다.')
    }

    const { data, error } = await rpcClient.rpc('refund_credits', {
      p_user_id: userId,
      p_amount: amount,
      p_resource_type: resourceType,
      p_resource_id: resourceId,
      p_description: description,
      p_target_balance: targetBalance ?? null,
      p_consumptions: rpcPayload
    })

    if (error) {
      throw new Error(error.message || '잔액 복구 중 오류가 발생했습니다.')
    }

    const result = (Array.isArray(data) ? data[0] : data) as CreditRpcRefundResult | undefined
    const newBalance = toFiniteNumber(result?.new_balance)
    if (newBalance === null) {
      return this.getBalance(userId)
    }

    const { newBalance: syncedBalance } = await finalizeCreditBalanceMutation(
      userId,
      'Refund',
      adminSupabase
    )

    return syncedBalance
  }

  /**
   * 크레딧을 구매(충전)합니다.
   * 
   * 1. credit_sources에 새 구매건 추가
   * 2. profiles.credits 증가
   * 3. payment_history에 결제 내역 기록
   * 4. credit_transactions에 로그 기록
   */
  static async purchaseCredits(
    userId: string,
    planId: string | null,
    credits: number,
    price: number,
    paymentMethod: string = 'test',
    paymentKey?: string,
    sourceCategory: CreditSourceCategory = 'plan_purchase'
  ): Promise<{ sourceId: string; newBalance: number }> {
    const adminSupabase = createAdminClient()

    // 1. credit_sources에 새 구매건 추가
    const { data: source, error: sourceError } = await adminSupabase
      .from('credit_sources')
      .insert({
        user_id: userId,
        plan_id: planId,
        initial_credits: credits,
        remaining_credits: credits,
        status: 'active',
        source_category: sourceCategory
      })
      .select()
      .single()

    if (sourceError) {
      console.error('[CreditService] Failed to create source:', sourceError)
      throw new Error('구매건 생성 중 오류가 발생했습니다.')
    }

    // 2. profile cache를 ledger 기준으로 동기화
    const { newBalance } = await finalizeCreditBalanceMutation(userId, 'Purchase', adminSupabase)

    // 3. payment_history에 결제 내역 기록
    const { error: paymentError } = await adminSupabase
      .from('payment_history')
      .insert({
        user_id: userId,
        source_id: source.id,
        plan_id: planId,
        amount: price,
        payment_method: paymentMethod,
        payment_key: paymentKey,
        status: 'completed'
      })

    if (paymentError) {
      console.error('[CreditService] Failed to create payment history:', paymentError)
    }

    // 4. credit_transactions에 로그 기록
    const { error: txError } = await adminSupabase
      .from('credit_transactions')
      .insert({
        user_id: userId,
        type: 'purchase',
        amount: credits,
        balance_after: newBalance,
        description: `크레딧 ${credits.toLocaleString()}개 구매`,
        source_id: source.id
      })

    if (txError) {
      console.error('[CreditService] Failed to insert transaction:', txError)
    }

    return {
      sourceId: source.id,
      newBalance
    }
  }

  /**
   * 관리자가 사용자의 크레딧을 직접 지급합니다.
   *
   * 관리자 지급은 service role 클라이언트로 처리해서 대상 사용자 profile을
   * 안정적으로 갱신하고, 기록(source/transaction/payment history)과 잔액이
   * 서로 어긋나지 않도록 합니다.
   */
  static async grantCreditsAsAdmin(
    userId: string,
    credits: number,
    sourceCategory: CreditSourceCategory = 'admin_grant',
    paymentMethod: string = 'admin_grant',
  ): Promise<{ sourceId: string; newBalance: number }> {
    const adminSupabase = createAdminClient()

    const { data: source, error: sourceError } = await adminSupabase
      .from('credit_sources')
      .insert({
        user_id: userId,
        plan_id: null,
        initial_credits: credits,
        remaining_credits: credits,
        status: 'active',
        source_category: sourceCategory
      })
      .select()
      .single()

    if (sourceError || !source) {
      console.error('[CreditService] Failed to create admin grant source:', sourceError)
      throw new Error('관리자 지급 구매건 생성 중 오류가 발생했습니다.')
    }

    const { newBalance } = await finalizeCreditBalanceMutation(userId, 'Admin grant', adminSupabase)

    const { error: paymentError } = await adminSupabase
      .from('payment_history')
      .insert({
        user_id: userId,
        source_id: source.id,
        plan_id: null,
        amount: 0,
        payment_method: paymentMethod,
        status: 'completed'
      })

    if (paymentError) {
      console.error('[CreditService] Failed to create admin grant payment history:', paymentError)
    }

    const { error: txError } = await adminSupabase
      .from('credit_transactions')
      .insert({
        user_id: userId,
        type: 'purchase',
        amount: credits,
        balance_after: newBalance,
        description: `크레딧 ${credits.toLocaleString()}개 구매`,
        source_id: source.id
      })

    if (txError) {
      console.error('[CreditService] Failed to insert admin grant transaction:', txError)
    }

    return {
      sourceId: source.id,
      newBalance
    }
  }

  /**
   * 크레딧 거래 내역을 조회합니다.
   */
  static async getTransactions(userId: string, limit = 50): Promise<CreditTransaction[]> {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('credit_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[CreditService] getTransactions error:', error)
      return []
    }

    return data ?? []
  }
}
