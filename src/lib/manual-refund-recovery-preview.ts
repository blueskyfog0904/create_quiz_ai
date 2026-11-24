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
  // 10번: 회원 탈퇴로 소멸한 크레딧(withdrawal_forfeit 거래의 합, 사용 아님). 서버(route)가 원장에서 더한다.
  withdrawal_forfeited?: number
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
  // 10번: 탈퇴로 소멸한 크레딧 합(가족 전체)과, 소멸이 있을 때 가족 단위 실제 사용량 = 원래 충전 지급 − Σ남음 − Σ소멸(계획 14절 8번).
  withdrawal_forfeited_total?: number
  family_used_excluding_forfeit?: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// 원천별 탈퇴 소멸 합(source_id → 크레딧)을 미리보기에 붙인다. 소멸은 '지급−남음'에 섞여 있으므로 따로 보여 준다(계획 6-7).
export function attachWithdrawalForfeits(
  preview: ManualRefundRecoveryPreview,
  forfeitedBySource: ReadonlyMap<string, number>
): ManualRefundRecoveryPreview {
  const sources = preview.sources.map((source) => ({ ...source, withdrawal_forfeited: forfeitedBySource.get(source.source_id) ?? 0 }))
  const total = sources.reduce((sum, source) => sum + source.withdrawal_forfeited, 0)
  const root = sources.find((source) => source.root)
  const familyUsed = total > 0 && root
    ? root.initial - sources.reduce((sum, source) => sum + source.remaining + source.withdrawal_forfeited, 0)
    : null
  return { ...preview, sources, withdrawal_forfeited_total: total, family_used_excluding_forfeit: familyUsed }
}

// 모양이 어긋나면 null(화면은 수동 완료를 막고 새로고침을 안내).
export function parseManualRefundRecoveryPreview(input: unknown): ManualRefundRecoveryPreview | null {
  if (!isRecord(input) || input.ok !== true) return null
  if (input.mode !== 'partial' && input.mode !== 'full') return null
  if (typeof input.usable_total !== 'number' || typeof input.remaining_refundable_amount !== 'number') return null
  if (!Array.isArray(input.sources) || !Array.isArray(input.previous_completions)) return null
  return input as unknown as ManualRefundRecoveryPreview
}
