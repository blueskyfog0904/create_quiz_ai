import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export type PaymentOrderStatus =
  | 'ready'
  | 'confirming'
  | 'fulfillment_pending'
  | 'completed'
  | 'cancel_pending'
  | 'refunded'
  | 'failed'
  | 'manual_review'

export interface PaymentOrderRow {
  id: string
  user_id: string
  order_id: string
  plan_id: string | null
  plan_name_snapshot: string
  expected_amount: number
  expected_credits: number
  environment: 'test' | 'live'
  mid: string
  payment_key: string | null
  provider_method: string | null
  provider_status: string | null
  status: PaymentOrderStatus
  confirm_idempotency_key: string
  cancel_idempotency_key: string
  failure_code: string | null
  failure_message: string | null
  source_id: string | null
  payment_history_id: string | null
  expires_at: string
  approved_at: string | null
  fulfilled_at: string | null
  canceled_at: string | null
  created_at: string
  updated_at: string
}

export interface FinalizeTossPaymentResult {
  source_id: string
  payment_history_id: string
  new_balance: number
  credits: number
  already_completed: boolean
}

export function createPaymentAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error('PAYMENT_DATABASE_CONFIGURATION_INVALID')
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
