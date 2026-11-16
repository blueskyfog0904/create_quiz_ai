// 문제마켓 파일 다운로드가 되는지/왜 안 되는지를 DB에서 읽은 값만으로 판정한다(DB 조회 없음).
// 관리자 '주문 조회 › 마켓 구매'의 진단용이다. 사유의 한글 이름은 admin-orders.ts(MARKET_DOWNLOAD_BLOCK_REASON_LABELS)에 있다.
//
// 회원 다운로드 route(src/app/api/market/items/[itemId]/download/route.ts의 handleMarketV2Download)의 판정 순서 그대로다:
// [1] 상품   — market-items-server.ts getActiveMarketSubproductFileForDownload: 없음·삭제·비활성·(공개/숨김 아님) → 404
// [2] 파일   — 같은 함수의 market_subproduct_files 조회(is_active = true, deleted_at is null) → 404
// [3] 구성   — 같은 함수: 구성 없음·비활성·삭제, 파일 유형 없음 → 404
// [4] 권한   — 회원이 그 상품에 가진 사용 가능 권한 중 파일을 덮는 것이 없으면 403
// [5] 선택   — 덮는 권한 중 주문 정보가 있고 그 주문이 환불 심사 중이 아닌 것을 정해진 순서로 고른다. 없으면
//              환불 심사 중인 것이 있을 때 403(PENDING_REFUND), 아니면 500(INVALID_ENTITLEMENT)
// [4]·[5]의 권한 범위·순서·선택은 route와 같은 함수(market-purchase.ts)를 쓴다. [1]~[3]은 route 쪽 조회에 섞여 있어 여기에 옮겨 적었고,
// 전체가 route와 같은 결과를 내는지는 tests/market-download-diagnosis.test.mjs 가 실제 route를 돌려 대조한다.
// 이 뒤의 서명 URL 발급 실패(저장소에 파일이 없는 경우 등)는 DB 값으로 알 수 없어 진단하지 않는다.

import type { MARKET_DOWNLOAD_BLOCK_REASON_LABELS } from '@/lib/admin-orders'
import {
  findMarketSubproductFileV2Entitlement,
  isMarketSubproductFileCoveredByV2Entitlement,
  listMarketSubproductFileV2Entitlements,
} from '@/lib/market-purchase'

export type MarketDownloadBlockReason = keyof typeof MARKET_DOWNLOAD_BLOCK_REASON_LABELS

export interface MarketDownloadDiagnosis {
  downloadable: boolean
  // 다운로드할 수 있으면 null
  reason: MarketDownloadBlockReason | null
  // 받을 수 있을 때 route가 쓰는 권한의 주문 id(다운로드 기록도 이 주문에 남는다). 받을 수 없으면 null
  entitlementOrderId: string | null
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
    id: string
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

const blocked = (reason: MarketDownloadBlockReason): MarketDownloadDiagnosis => ({ downloadable: false, reason, entitlementOrderId: null })

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

  // [4]
  const target = { itemId: input.itemId, subproductId: file.subproduct_id, fileId: file.id }
  const covering = listMarketSubproductFileV2Entitlements(target, input.entitlements)
  if (covering.length === 0) {
    // 회원에게는 모두 "구매 후 다운로드" 403이다. 관리자가 원인을 알 수 있게, 범위는 맞지만 회수된 권한을 구분한다.
    const withdrawn = input.entitlements.filter((entitlement) => (
      isMarketSubproductFileCoveredByV2Entitlement(target, { ...entitlement, status: null })
    ))
    if (withdrawn.some((entitlement) => entitlement.status === 'refunded')) return blocked('entitlement_refunded')
    if (withdrawn.some((entitlement) => entitlement.status === 'revoked')) return blocked('entitlement_revoked')
    return blocked('no_entitlement')
  }

  // [5]
  const entitlement = findMarketSubproductFileV2Entitlement(target, covering, input.pendingRefundOrderIds)
  if (!entitlement) {
    const pendingRefund = covering.some((candidate) => candidate.source_order_id && input.pendingRefundOrderIds.includes(candidate.source_order_id))
    return blocked(pendingRefund ? 'pending_refund' : 'entitlement_order_missing')
  }

  return { downloadable: true, reason: null, entitlementOrderId: entitlement.source_order_id ?? null }
}
