// 수동 환불 완료 화면의 원자료(DB 함수 get_manual_refund_recovery_preview 의 반환 모양).
// 화면은 이 값을 그대로 보여 주기만 한다 — 이미 쓴 몫·권장 회수량 같은 계산값을 만들지 않는다(대표가 원천별 원자료로 판단).

export interface ManualRefundRecoverySource {
  source_id: string
  root: boolean
  category: string
  status: string
  initial: number
  remaining: number
  usable: number
  expires_at: string | null
  consumed_total: number
  restored_by_material_refund: number
  reissued_out: number
  net_used: number
}

export interface ManualRefundPreviousCompletion {
  created_at: string
  refund_request_id: string | null
  recovered: number | null
  unrecovered: number | null
  refund_amount: number | null
}

export interface ManualRefundRecoveryPreview {
  request_id: string
  request_status: string
  origin: string
  mode: 'partial' | 'full'
  payment_order_id: string | null
  order_id: string | null
  expected_amount: number | null
  partial_cancel_amount: number | null
  refunded_before: number
  remaining_refundable_amount: number
  usable_total: number
  has_reissued: boolean
  held_reissued_source_ids: string[]
  sources: ManualRefundRecoverySource[]
  previous_completions: ManualRefundPreviousCompletion[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// 모양이 어긋나면 null(화면은 수동 완료를 막고 새로고침을 안내).
export function parseManualRefundRecoveryPreview(input: unknown): ManualRefundRecoveryPreview | null {
  if (!isRecord(input) || input.ok !== true) return null
  if (input.mode !== 'partial' && input.mode !== 'full') return null
  if (typeof input.usable_total !== 'number' || typeof input.remaining_refundable_amount !== 'number') return null
  if (!Array.isArray(input.sources) || !Array.isArray(input.previous_completions)) return null
  return input as unknown as ManualRefundRecoveryPreview
}
