import { createClient } from '@/lib/supabase/server'
import { Database } from '@/types/supabase'

export type CreditTransactionType = 
  | 'admin_grant' 
  | 'ai_generation' 
  | 'question_import' 
  | 'system_refund'
  | 'bonus'

interface CreditMetadata {
  description: string
  resourceType?: string
  resourceId?: string
  category?: string
  admin_id?: string
}

export class CreditService {
  /**
   * 사용자의 현재 크레딧 잔액을 조회합니다.
   */
  static async getBalance(userId: string): Promise<number> {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('user_credits')
      .select('balance')
      .eq('user_id', userId)
      .single()
    
    if (error) {
      console.error('Error fetching credit balance:', error)
      // 만약 지갑이 없으면 0 리턴 (혹은 에러 처리)
      return 0
    }
    
    return data.balance
  }

  /**
   * 크레딧을 안전하게 차감합니다. (Atomic Operation)
   * 잔액이 부족하면 에러를 던집니다.
   * 성공 시 차감 후 잔액을 반환합니다.
   */
  static async deductCredits(
    userId: string,
    amount: number,
    type: CreditTransactionType,
    metadata: CreditMetadata
  ): Promise<number> {
    const supabase = await createClient()
    
    // RPC 함수 호출 (deduct_credits)
    // 파라미터: p_user_id, p_amount, p_description, p_resource_type, p_resource_id
    const { data: newBalance, error } = await supabase.rpc('deduct_credits', {
      p_user_id: userId,
      p_amount: amount,
      p_description: metadata.description,
      p_resource_type: metadata.resourceType || null,
      p_resource_id: metadata.resourceId || null
    })

    if (error) {
      console.error('Error deducting credits:', error)
      throw new Error(`Credit deduction failed: ${error.message}`)
    }

    // RPC가 -1을 반환하면 잔액 부족
    if (newBalance === -1) {
      throw new Error('Insufficient credits')
    }

    return newBalance as number
  }

  /**
   * 크레딧을 지급합니다. (관리자 또는 시스템 환불용)
   * 성공 시 지급 후 잔액을 반환합니다.
   */
  static async grantCredits(
    userId: string,
    amount: number,
    type: CreditTransactionType,
    metadata: CreditMetadata
  ): Promise<number> {
    const supabase = await createClient()

    const { data: newBalance, error } = await supabase.rpc('grant_credits', {
      p_user_id: userId,
      p_amount: amount,
      p_description: metadata.description,
      p_type: type,
      p_resource_type: metadata.resourceType || null,
      p_resource_id: metadata.resourceId || null
    })

    if (error) {
      console.error('Error granting credits:', error)
      throw new Error(`Credit grant failed: ${error.message}`)
    }

    return newBalance as number
  }
}
