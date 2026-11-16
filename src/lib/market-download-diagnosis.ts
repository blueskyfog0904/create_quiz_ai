// 문제마켓 파일 다운로드가 되는지/왜 안 되는지를 DB에서 읽은 값만으로 판정한다(순수 함수, DB·next에 기대지 않음).
// 관리자 '주문 조회 › 마켓 구매'의 진단용이다. 회원 다운로드 route는 이 함수를 쓰지 않는다 —
// route의 판정은 여러 조회 사이에 흩어져 있어(아래 [1]~[5]) 그대로 두고, 같은 규칙임을
// tests/market-download-diagnosis.test.mjs 가 실제 route를 돌려 대조한다. route 규칙을 바꾸면 여기도 같이 바꾼다.
//
// 대응하는 회원 쪽 판정(순서 그대로):
// [1] 상품   — market-items-server.ts getActiveMarketSubproductFileForDownload: 없음·삭제·비활성·(공개/숨김 아님) → 404
// [2] 파일   — 같은 함수의 market_subproduct_files 조회(is_active = true, deleted_at is null) → 404
// [3] 구성   — 같은 함수: 구성 없음·비활성·삭제, 파일 유형 없음 → 404
// [4] 권한   — listMarketV2EntitlementsForItem(status = 'active') + market-purchase.ts isMarketSubproductFileCoveredByV2Entitlement → 403
//              권한에 주문 id가 없으면 500(INVALID_ENTITLEMENT)
// [5] 환불   — market-refunds.ts hasPendingMarketRefundRequestForTarget(v2_order, status = 'pending') → 403
// route는 [4]에서 회원이 그 상품에 가진 사용 가능 권한을 정렬 없이 읽어 "처음 걸린 하나"만 고르고, [5]는 그 권한의 주문만 본다.
// 그래서 파일을 덮는 권한이 여러 개이고 일부의 주문만 막혀 있으면 결과가 DB 반환 순서에 달려 단정할 수 없다(uncertain_*).
// 이 뒤의 서명 URL 발급 실패(저장소에 파일이 없는 경우 등)는 DB 값으로 알 수 없어 진단하지 않는다.

export const MARKET_DOWNLOAD_BLOCK_REASON_LABELS = {
  item_missing: '상품을 찾을 수 없음',
  item_deleted: '상품이 삭제됨',
  item_inactive: '상품이 비활성 상태',
  item_unpublished: '상품이 임시저장·보관 상태',
  file_missing: '파일을 찾을 수 없음',
  file_deleted: '파일이 삭제됨',
  file_inactive: '파일이 비활성 상태',
  subproduct_missing: '구성을 찾을 수 없음',
  subproduct_inactive: '구성이 비활성 상태',
  subproduct_deleted: '구성이 삭제됨',
  file_type_missing: '파일 유형을 찾을 수 없음',
  no_entitlement: '다운로드 권한이 없음',
  entitlement_refunded: '권한이 환불로 회수됨',
  entitlement_revoked: '권한이 회수됨',
  entitlement_order_missing: '권한에 주문 정보가 없음',
  pending_refund: '환불 요청 심사 중',
  uncertain_pending_refund: '같은 상품의 권한이 여러 개이고 일부 주문이 환불 심사 중이라 다운로드가 막힐 수 있음',
  uncertain_entitlement_order_missing: '같은 상품의 권한이 여러 개이고 일부에 주문 정보가 없어 다운로드가 막힐 수 있음',
} as const

export type MarketDownloadBlockReason = keyof typeof MARKET_DOWNLOAD_BLOCK_REASON_LABELS

export interface MarketDownloadDiagnosis {
  // 확실히 받을 수 있을 때만 true
  downloadable: boolean
  // 받을 수 있는지 단정할 수 없다(어느 권한이 먼저 걸리느냐에 따라 달라진다). 이때 downloadable은 false, reason은 uncertain_*
  uncertain: boolean
  // 다운로드할 수 있으면 null
  reason: MarketDownloadBlockReason | null
  // 이 파일을 덮는 사용 가능 권한들의 주문 id(어느 주문의 권한으로 받는지 알리는 용도)
  entitlementOrderIds: string[]
}

export interface MarketDownloadDiagnosisInput {
  itemId: string
  item: { status: string; is_active: boolean; deleted_at: string | null } | null
  file: { id: string; subproduct_id: string; is_active: boolean; deleted_at: string | null } | null
  subproduct: { is_active: boolean; deleted_at: string | null } | null
  fileTypeExists: boolean
  // 그 회원이 이 상품에 가진 권한 — 주문과 무관하게 사용 가능한 것 전부(route가 보는 재료).
  // 회수된 권한을 함께 넘기면 권한이 없는 이유(환불·회수)를 구분해 준다.
  entitlements: Array<{
    item_id: string
    scope: string
    subproduct_id: string | null
    file_id: string | null
    status: string
    source_order_id: string | null
  }>
  // 심사 중(pending)인 환불 요청이 있는 주문 id
  pendingRefundOrderIds: string[]
}

const blocked = (reason: MarketDownloadBlockReason, entitlementOrderIds: string[] = []): MarketDownloadDiagnosis => (
  { downloadable: false, uncertain: false, reason, entitlementOrderIds }
)

export function diagnoseMarketFileDownload(input: MarketDownloadDiagnosisInput): MarketDownloadDiagnosis {
  const { item, file, subproduct } = input

  // [1] 숨김(hidden)은 새 노출·구매만 막는다. 이미 산 사람은 계속 내려받는다.
  if (!item) return blocked('item_missing')
  if (item.deleted_at !== null) return blocked('item_deleted')
  if (item.is_active === false) return blocked('item_inactive')
  if (item.status !== 'published' && item.status !== 'hidden') return blocked('item_unpublished')

  // [2]
  if (!file) return blocked('file_missing')
  if (file.deleted_at !== null) return blocked('file_deleted')
  if (file.is_active !== true) return blocked('file_inactive')

  // [3]
  if (!subproduct) return blocked('subproduct_missing')
  if (subproduct.is_active === false) return blocked('subproduct_inactive')
  if (subproduct.deleted_at !== null) return blocked('subproduct_deleted')
  if (!input.fileTypeExists) return blocked('file_type_missing')

  // [4] 권한 범위: 상품 전체 / 그 구성 / 그 파일. (legacy_asset 등 다른 범위는 이 파일을 덮지 않는다.)
  const covering = input.entitlements.filter((entitlement) => (
    entitlement.item_id === input.itemId && (
      entitlement.scope === 'item' ||
      (entitlement.scope === 'subproduct' && entitlement.subproduct_id === file.subproduct_id) ||
      (entitlement.scope === 'file' && entitlement.file_id === file.id)
    )
  ))
  const active = covering.filter((candidate) => candidate.status === 'active')
  if (active.length === 0) {
    // 회원에게는 모두 "구매 후 다운로드" 403이다. 관리자가 원인을 알 수 있게 회수된 권한을 구분한다.
    if (covering.some((candidate) => candidate.status === 'refunded')) return blocked('entitlement_refunded')
    if (covering.some((candidate) => candidate.status === 'revoked')) return blocked('entitlement_revoked')
    return blocked('no_entitlement')
  }

  // [4]의 주문 id 검사와 [5]: route는 처음 걸린 권한 하나로만 판정하므로, 권한마다 결과를 내고 서로 다르면 단정하지 않는다.
  const entitlementOrderIds = active.flatMap((candidate) => candidate.source_order_id ?? [])
  const orderMissing = active.some((candidate) => !candidate.source_order_id)
  const pendingRefund = entitlementOrderIds.some((orderId) => input.pendingRefundOrderIds.includes(orderId))
  const passes = entitlementOrderIds.some((orderId) => !input.pendingRefundOrderIds.includes(orderId))
  if (!passes) return blocked(pendingRefund ? 'pending_refund' : 'entitlement_order_missing', entitlementOrderIds)
  if (pendingRefund || orderMissing) {
    return {
      downloadable: false,
      uncertain: true,
      reason: pendingRefund ? 'uncertain_pending_refund' : 'uncertain_entitlement_order_missing',
      entitlementOrderIds,
    }
  }

  return { downloadable: true, uncertain: false, reason: null, entitlementOrderIds }
}
