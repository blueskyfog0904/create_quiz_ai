/**
 * 크레딧 서비스 (FIFO 기반)
 * 
 * 이 모듈은 FIFO(First-In-First-Out) 방식으로 크레딧을 차감합니다.
 * 가장 먼저 구매한 credit_source부터 크레딧을 차감하며,
 * 환불 대기 중(pending_refund)인 구매건은 차감에서 제외됩니다.
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { sendSlackNotification } from '@/lib/slack'

// ============================================================================
// 타입 정의
// ============================================================================

export interface CreditSource {
  id: string
  user_id: string
  plan_id: string | null
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

export interface RefundEligibility {
  allowed: boolean
  reason?: string
}

// ============================================================================
// CreditService 클래스
// ============================================================================

export class CreditService {

  /**
   * 사용자의 현재 크레딧 잔액을 조회합니다.
   * profiles.credits 필드에서 직접 조회합니다.
   */
  static async getBalance(userId: string): Promise<number> {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('profiles')
      .select('credits')
      .eq('id', userId)
      .single()

    if (error) {
      console.error('[CreditService] getBalance error:', error)
      return 0
    }

    return data?.credits ?? 0
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
      .order('purchased_at', { ascending: true }) // FIFO: 가장 오래된 것부터

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
    const supabase = await createClient()
    const rpcClient = supabase as unknown as {
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

    return {
      success: true,
      newBalance,
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

    const supabase = await createClient()
    const rpcClient = supabase as unknown as {
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

    return newBalance
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
    paymentKey?: string
  ): Promise<{ sourceId: string; newBalance: number }> {
    const supabase = await createClient()

    // 1. credit_sources에 새 구매건 추가
    const { data: source, error: sourceError } = await supabase
      .from('credit_sources')
      .insert({
        user_id: userId,
        plan_id: planId,
        initial_credits: credits,
        remaining_credits: credits,
        status: 'active'
      })
      .select()
      .single()

    if (sourceError) {
      console.error('[CreditService] Failed to create source:', sourceError)
      throw new Error('구매건 생성 중 오류가 발생했습니다.')
    }

    // 2. profiles.credits 증가
    const currentBalance = await this.getBalance(userId)
    const newBalance = currentBalance + credits

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ credits: newBalance })
      .eq('id', userId)

    if (profileError) {
      console.error('[CreditService] Failed to update profile credits:', profileError)
      throw new Error('잔액 업데이트 중 오류가 발생했습니다.')
    }

    // 3. payment_history에 결제 내역 기록
    const { error: paymentError } = await supabase
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
    const { error: txError } = await supabase
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
   * 환불 가능 여부를 확인합니다.
   * 
   * 조건:
   * 1. 해당 구매건의 크레딧을 하나도 사용하지 않음 (remaining = initial)
   * 2. 구매 후 7일 이내
   * 3. 현재 status가 'active'임 (이미 환불 요청 중이면 불가)
   */
  static canRequestRefund(source: CreditSource): RefundEligibility {
    // 1. 이미 환불 요청 중인지 확인
    if (source.status === 'pending_refund') {
      return { allowed: false, reason: '이미 환불 요청 중입니다.' }
    }

    // 2. 이미 환불된 건인지 확인
    if (source.status === 'refunded') {
      return { allowed: false, reason: '이미 환불된 구매건입니다.' }
    }

    // 3. 사용한 크레딧이 있는지 확인
    if (source.remaining_credits < source.initial_credits) {
      return { allowed: false, reason: '이미 사용한 크레딧이 있습니다.' }
    }

    // 4. 구매 후 7일 초과 여부 확인
    const purchasedAt = new Date(source.purchased_at)
    const now = new Date()
    const daysDiff = Math.floor((now.getTime() - purchasedAt.getTime()) / (1000 * 60 * 60 * 24))

    if (daysDiff > 7) {
      return { allowed: false, reason: '구매 후 7일이 지나 환불이 불가합니다.' }
    }

    return { allowed: true }
  }

  /**
   * 환불 요청을 생성합니다.
   * 
   * 1. credit_sources.status를 'pending_refund'로 변경
   * 2. refund_requests 레코드 생성
   */
  static async requestRefund(
    userId: string,
    sourceId: string,
    reason?: string
  ): Promise<{ requestId: string }> {
    const supabase = await createClient()

    // 1. source 조회 및 검증
    const { data: source, error: sourceError } = await supabase
      .from('credit_sources')
      .select('*')
      .eq('id', sourceId)
      .eq('user_id', userId)
      .single()

    if (sourceError || !source) {
      throw new Error('구매건을 찾을 수 없습니다.')
    }

    // 2. 환불 가능 여부 확인
    const eligibility = this.canRequestRefund(source)
    if (!eligibility.allowed) {
      throw new Error(eligibility.reason)
    }

    // 3. credit_sources.status 변경
    const { error: updateError } = await supabase
      .from('credit_sources')
      .update({ status: 'pending_refund' })
      .eq('id', sourceId)

    if (updateError) {
      throw new Error('환불 요청 처리 중 오류가 발생했습니다.')
    }

    // 4. refund_requests 생성
    const { data: request, error: requestError } = await supabase
      .from('refund_requests')
      .insert({
        user_id: userId,
        source_id: sourceId,
        reason: reason || '사유 없음',
        status: 'pending'
      })
      .select()
      .single()

    if (requestError) {
      throw new Error('환불 요청 생성 중 오류가 발생했습니다.')
    }

    // 5. 관리자에게 웹 알림 발송
    try {
      const { data: admins } = await supabase
        .from('profiles')
        .select('id')
        .eq('is_admin', true)

      if (admins && admins.length > 0) {
        const notifications = admins.map(admin => ({
          user_id: admin.id,
          type: 'warning',
          title: '새 환불 요청',
          message: `사용자가 크레딧 환불을 요청했습니다. 검토가 필요합니다.`,
          link: '/admin/refunds',
          is_read: false
        }))

        await supabase.from('notifications').insert(notifications)
      }
    } catch (notifyError) {
      console.error('[CreditService] Failed to notify admins:', notifyError)
    }

    // 6. Slack 알림 발송
    try {
      // 사용자 정보 조회
      const { data: user } = await supabase
        .from('profiles')
        .select('name, email')
        .eq('id', userId)
        .single()

      // 구매 정보 조회
      const { data: sourceInfo } = await supabase
        .from('credit_sources')
        .select('initial_credits, plan:pricing_plans(name, price)')
        .eq('id', sourceId)
        .single()

      const planInfo = (sourceInfo?.plan as unknown) as { name: string; price: number } | null

      await sendSlackNotification(
        '💰 *새로운 환불 요청이 접수되었습니다*',
        {
          '사용자': user?.name || user?.email || '알 수 없음',
          '요금제': planInfo?.name || '알 수 없음',
          '크레딧': `${sourceInfo?.initial_credits?.toLocaleString() || 0}C`,
          '금액': `₩${planInfo?.price?.toLocaleString() || 0}`,
          '사유': reason || '사유 없음',
          '관리자 페이지': 'https://your-domain.com/admin/refunds'
        }
      )
    } catch (slackError) {
      console.error('[CreditService] Failed to send Slack notification:', slackError)
    }

    return { requestId: request.id }
  }

  /**
   * 환불을 승인합니다. (관리자 전용)
   * 
   * 1. profiles.credits에서 해당 source의 initial_credits만큼 차감
   * 2. credit_sources.status를 'refunded'로 변경
   * 3. refund_requests.status를 'approved'로 변경
   * 4. payment_history.status를 'refunded'로 변경
   * 5. credit_transactions에 환불 로그 기록
   */
  static async approveRefund(
    requestId: string,
    adminId: string,
    adminNote?: string
  ): Promise<void> {
    // RLS 우회를 위해 service role 클라이언트 사용
    const adminSupabase = createAdminClient()

    // 1. refund_request 조회
    const { data: request, error: requestError } = await (adminSupabase as any)
      .from('refund_requests')
      .select(`
        *,
        source:credit_sources(*)
      `)
      .eq('id', requestId)
      .single()

    if (requestError || !request) {
      throw new Error('환불 요청을 찾을 수 없습니다.')
    }

    const source = request.source as CreditSource

    // 2. profiles.credits 차감 (service role로 RLS 우회)
    const { data: profile } = await (adminSupabase as any)
      .from('profiles')
      .select('credits')
      .eq('id', request.user_id)
      .single()

    const currentBalance = profile?.credits || 0
    const newBalance = currentBalance - source.initial_credits

    const { error: profileError } = await (adminSupabase as any)
      .from('profiles')
      .update({ credits: Math.max(0, newBalance) })
      .eq('id', request.user_id)

    if (profileError) {
      console.error('[CreditService] Profile update error:', profileError)
      throw new Error('잔액 차감 중 오류가 발생했습니다.')
    }

    // 3. credit_sources.status 변경
    await (adminSupabase as any)
      .from('credit_sources')
      .update({ status: 'refunded', remaining_credits: 0 })
      .eq('id', source.id)

    // 4. refund_requests 업데이트
    await (adminSupabase as any)
      .from('refund_requests')
      .update({
        status: 'approved',
        admin_note: adminNote,
        processed_by: adminId,
        processed_at: new Date().toISOString()
      })
      .eq('id', requestId)

    // 5. payment_history 업데이트
    await (adminSupabase as any)
      .from('payment_history')
      .update({ status: 'refunded' })
      .eq('source_id', source.id)

    // 6. credit_transactions에 환불 로그
    await (adminSupabase as any)
      .from('credit_transactions')
      .insert({
        user_id: request.user_id,
        type: 'refund',
        amount: -source.initial_credits,
        balance_after: Math.max(0, newBalance),
        description: `환불 승인 (${source.initial_credits.toLocaleString()} 크레딧)`,
        source_id: source.id
      })

    // 7. 사용자에게 환불 승인 알림 발송
    try {
      await (adminSupabase as any).from('notifications').insert({
        user_id: request.user_id,
        type: 'success',
        title: '환불이 승인되었습니다',
        message: `${source.initial_credits.toLocaleString()} 크레딧 환불이 승인되었습니다. 결제 대금은 영업일 기준 3-5일 내에 환불됩니다.`,
        link: '/mypage/credits',
        is_read: false
      })
    } catch (notifyError) {
      console.error('[CreditService] Failed to notify user on refund approval:', notifyError)
    }
  }

  /**
   * 환불을 거부합니다. (관리자 전용)
   * 
   * 1. credit_sources.status를 'active'로 복원
   * 2. refund_requests.status를 'rejected'로 변경
   */
  static async rejectRefund(
    requestId: string,
    adminId: string,
    adminNote?: string
  ): Promise<void> {
    // RLS 우회를 위해 service role 클라이언트 사용
    const adminSupabase = createAdminClient()

    // 1. refund_request 조회
    const { data: request, error: requestError } = await (adminSupabase as any)
      .from('refund_requests')
      .select('*, source:credit_sources(*)')
      .eq('id', requestId)
      .single()

    if (requestError || !request) {
      throw new Error('환불 요청을 찾을 수 없습니다.')
    }

    const source = request.source as CreditSource

    // 2. credit_sources.status 복원
    await (adminSupabase as any)
      .from('credit_sources')
      .update({ status: 'active' })
      .eq('id', source.id)

    // 3. refund_requests 업데이트
    await (adminSupabase as any)
      .from('refund_requests')
      .update({
        status: 'rejected',
        admin_note: adminNote,
        processed_by: adminId,
        processed_at: new Date().toISOString()
      })
      .eq('id', requestId)

    // 4. 사용자에게 환불 거절 알림 발송
    try {
      await (adminSupabase as any).from('notifications').insert({
        user_id: request.user_id,
        type: 'warning',
        title: '환불 요청이 거절되었습니다',
        message: adminNote
          ? `환불 요청이 거절되었습니다. 사유: ${adminNote}`
          : '환불 요청이 거절되었습니다. 자세한 내용은 고객센터로 문의해주세요.',
        link: '/mypage/credits',
        is_read: false
      })
    } catch (notifyError) {
      console.error('[CreditService] Failed to notify user on refund rejection:', notifyError)
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
