import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/bypass'
import type { AdminRequestMeta } from '@/lib/admin-request-meta'
import type { MarketItemOption } from '@/lib/market-item-options'
import {
  callMarketCatalogRpc,
  isProductInfoPreviewEnabled,
  readMarketItemOptionsUncached,
  readProductInfoPreviewData,
} from '@/lib/market-item-options-server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

// 17번 계획 5-3·6절: 상품별 원저작물 이용 근거(내부 전용). 회원에게는 어떤 경로로도 보이지 않는다.
// - 이 표 이름은 src/ 안에서 이 파일에만 쓴다(공용 select 상수에 끼워 넣지 않는다 — 회원 route 도 그 상수를 쓴다).
// - 이 모듈은 관리자 route(src/app/api/admin/**)와 관리자 화면(src/app/(admin)/**)만 가져다 쓴다(계약 시험이 고정).
// - 18번 '이용 근거 미입력' 칩은 이 모듈이 돌려주는 상품 id 집합만 받는다.
const USAGE_BASIS_TABLE = 'market_item_usage_bases'

export interface MarketItemUsageBasis {
  basisOptionId: string
  note: string | null
  evidenceRef: string | null
  revision: number
  updatedAt: string
  updatedBy: string | null
}

export interface MarketItemUsageBasisAdminData {
  subject: WorkspaceSubject
  basis: MarketItemUsageBasis | null
  // 그 과목의 이용 근거 목록(숨김 포함 — 지금 근거가 숨긴 항목이면 '(숨김)'으로 보인다)
  options: MarketItemOption[]
  preview: boolean
}

interface UsageBasisRow {
  basis_option_id: string
  note: string | null
  evidence_ref: string | null
  revision: number
  updated_at: string
  updated_by: string | null
}

function usageBasisDb() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('market item usage basis: service key missing')
  }
  return createAdminClient() as unknown as SupabaseClient
}

// 상품이 있고 그 과목이 주소의 과목과 같은지(읽기·저장 route 가 같은 규칙으로 본다). 아니면 false(404).
export async function isMarketItemInSubject(itemId: string, expectedSubject: WorkspaceSubject): Promise<boolean> {
  const { data: item, error } = await usageBasisDb().from('market_items').select('workspace_subject').eq('id', itemId).maybeSingle()
  if (error) throw new Error(`상품 읽기 실패: ${error.message}`)
  return Boolean(item) && item?.workspace_subject === expectedSubject
}

// 상품의 과목(주소의 과목과 같아야 함)과 지금 근거·근거 목록. 상품이 없거나 과목이 다르면 null.
export async function readMarketItemUsageBasisForAdmin(itemId: string, expectedSubject: WorkspaceSubject): Promise<MarketItemUsageBasisAdminData | null> {
  if (!(await isMarketItemInSubject(itemId, expectedSubject))) return null
  const db = usageBasisDb()
  const subject = expectedSubject

  if (isProductInfoPreviewEnabled()) {
    const preview = await readProductInfoPreviewData()
    const options = preview.options.filter((option) => option.subject === subject && option.kind === 'usage_basis')
    return { subject, basis: (preview.usageBasis as MarketItemUsageBasis | null) ?? null, options, preview: true }
  }

  const [basisResult, options] = await Promise.all([
    db.from(USAGE_BASIS_TABLE).select('basis_option_id, note, evidence_ref, revision, updated_at, updated_by').eq('item_id', itemId).maybeSingle(),
    readMarketItemOptionsUncached(subject, 'usage_basis'),
  ])
  if (basisResult.error) throw new Error(`이용 근거 읽기 실패: ${basisResult.error.message}`)
  const row = basisResult.data as UsageBasisRow | null
  return {
    subject,
    basis: row
      ? { basisOptionId: row.basis_option_id, note: row.note, evidenceRef: row.evidence_ref, revision: row.revision, updatedAt: row.updated_at, updatedBy: row.updated_by }
      : null,
    options,
    preview: false,
  }
}

export function callSaveMarketItemUsageBasis(actorId: string, itemId: string, input: {
  expectedRevision: number | null
  basisOptionId: string
  note: string
  evidenceRef: string
}, requestMeta: AdminRequestMeta) {
  return callMarketCatalogRpc('save_market_item_usage_basis', {
    p_actor_id: actorId,
    p_item_id: itemId,
    p_expected_revision: input.expectedRevision,
    p_basis_option_id: input.basisOptionId,
    p_note: input.note,
    p_evidence_ref: input.evidenceRef,
    p_request_meta: requestMeta,
  })
}
