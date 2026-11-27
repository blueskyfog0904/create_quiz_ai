import 'server-only'

import { readFile } from 'node:fs/promises'
import { unstable_cache } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/bypass'
import type { AdminRequestMeta } from '@/lib/admin-request-meta'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import {
  MARKET_ITEM_DISPLAY_CACHE_TAG,
  MARKET_ITEM_DISPLAY_SETTING_KEY,
  MARKET_ITEM_OPTIONS_CACHE_SECONDS,
  MARKET_ITEM_OPTIONS_CACHE_TAG,
  MARKET_ITEM_OPTION_REJECT_MESSAGES,
  MARKET_ITEM_PRODUCT_OPTION_KINDS,
  checkMarketItemOptionValue,
  extractMarketItemOptionError,
  parseMarketItemDisplay,
  type MarketItemDisplay,
  type MarketItemOption,
  type MarketItemOptionErrorCode,
  type MarketItemOptionKind,
  type MarketItemProductOptionKind,
} from '@/lib/market-item-options'

// 17번 계획 6절: 상품 학년·자료유형·이용 근거 목록과 상품 표시 설정의 서버 읽기(서버 키)와 DB 함수 호출.
// 표는 anon·authenticated 권한이 없어 세션 클라이언트로 읽지 않는다. 회원 화면은 getMarketItemDisplay(필터 이름)만 부른다.
// 상품별 이용 근거(내부 전용 표)는 이 파일이 아니라 market-item-usage-basis-server.ts 에만 있다.

const OPTION_COLUMNS = 'id, workspace_subject, kind, label, sort_order, is_active, revision'

interface OptionRow {
  id: string
  workspace_subject: 'korean' | 'english'
  kind: MarketItemOptionKind
  label: string
  sort_order: number
  is_active: boolean
  revision: number
}

const toOption = (row: OptionRow): MarketItemOption => ({
  id: row.id,
  subject: row.workspace_subject,
  kind: row.kind,
  label: row.label,
  sortOrder: row.sort_order,
  isActive: row.is_active,
  revision: row.revision,
})

function catalogDb() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('market item options: service key missing')
  }
  return createAdminClient() as unknown as SupabaseClient
}

// 경로는 환경 변수 그대로 읽는다(상대 경로는 Node 가 작업 폴더 기준으로 푼다). process.cwd() 로 만들면 배포 때 파일 추적이 저장소 전체를 함수에 담아 250MB 를 넘긴다.
// ── 10-2. 개발 전용 미리보기(운영 DB 의 17번 표를 읽거나 쓰지 않고 예시 값을 메모리에서 그린다) ──────────────────────────
// 켜는 법: `PRODUCT_INFO_PREVIEW=1 PRODUCT_INFO_PREVIEW_FILE=output/b17-product-info-preview.json npm run dev`
// 파일은 생성기(node supabase/scripts/bundle17_rehearsal/generate.mjs --preview)가 마이그레이션 첫 값에서 만든다.
// 미리보기에서는 저장 route 가 DB 함수를 부르지 않는다(isProductInfoPreviewEnabled 로 막음).
export function isProductInfoPreviewEnabled() {
  return process.env.NODE_ENV === 'development'
    && !process.env.VERCEL
    && process.env.PRODUCT_INFO_PREVIEW === '1'
}

export interface ProductInfoPreviewData {
  options: MarketItemOption[]
  display: unknown
  usageBasis: unknown
}

export async function readProductInfoPreviewData(): Promise<ProductInfoPreviewData> {
  const file = process.env.PRODUCT_INFO_PREVIEW_FILE
  if (!isProductInfoPreviewEnabled() || !file) throw new Error('product info preview file missing')
  const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<ProductInfoPreviewData>
  return { options: Array.isArray(parsed.options) ? parsed.options : [], display: parsed.display ?? null, usageBasis: parsed.usageBasis ?? null }
}

// 19번 9-2: 상품 상세 표시 미리보기(개발 전용 — 예시 상품·설정 값을 메모리에서 그린다. 상세 주소를 열지 않아 조회 기록이 쓰이지 않는다).
// 켜는 법: `PRODUCT_DISPLAY_PREVIEW=1 PRODUCT_DISPLAY_PREVIEW_FILE=output/b19-product-display-preview.json npm run dev`
//   → /preview/solvook-concept/product-display. 파일은 생성기(node supabase/scripts/bundle19_rehearsal/generate.mjs --preview)가 만든다.
export function isProductDisplayPreviewEnabled() {
  return process.env.NODE_ENV === 'development'
    && !process.env.VERCEL
    && process.env.PRODUCT_DISPLAY_PREVIEW === '1'
}

export async function readProductDisplayPreviewData(): Promise<{ display: unknown; detailPreview: unknown }> {
  const file = process.env.PRODUCT_DISPLAY_PREVIEW_FILE
  if (!isProductDisplayPreviewEnabled() || !file) throw new Error('product display preview file missing')
  const parsed = JSON.parse(await readFile(file, 'utf8')) as { display?: unknown; detailPreview?: unknown }
  return { display: parsed.display ?? null, detailPreview: parsed.detailPreview ?? null }
}

const sortOptions = (options: MarketItemOption[]) =>
  [...options].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))

async function readOptionsFromDb(subject: WorkspaceSubject, kind: MarketItemOptionKind): Promise<MarketItemOption[]> {
  const { data, error } = await catalogDb().from('market_item_attribute_options').select(OPTION_COLUMNS)
    .eq('workspace_subject', subject).eq('kind', kind)
    .order('sort_order', { ascending: true }).order('id', { ascending: true })
  if (error) throw new Error(`상품 목록 항목 읽기 실패: ${error.message}`)
  return ((data ?? []) as OptionRow[]).map(toOption)
}

const getCachedProductOptions = unstable_cache(
  async (subject: WorkspaceSubject, kind: MarketItemProductOptionKind) => readOptionsFromDb(subject, kind),
  ['market-item-options'],
  { revalidate: MARKET_ITEM_OPTIONS_CACHE_SECONDS, tags: [MARKET_ITEM_OPTIONS_CACHE_TAG] }
)

// 상품 편집 화면의 선택 목록(학년·자료유형, 캐시 60초 + 태그). 저장 검사에는 쓰지 않는다(readMarketItemOptionsUncached).
export async function listMarketItemOptions(subject: WorkspaceSubject, kind: MarketItemProductOptionKind): Promise<MarketItemOption[]> {
  if (!(MARKET_ITEM_PRODUCT_OPTION_KINDS as readonly string[]).includes(kind)) throw new Error('product option kind only')
  if (isProductInfoPreviewEnabled()) {
    const data = await readProductInfoPreviewData()
    return sortOptions(data.options.filter((option) => option.subject === subject && option.kind === kind))
  }
  return getCachedProductOptions(subject, kind)
}

// 캐시 없이 DB 에서 읽는다(상품 저장 route 의 목록 검사·관리자 설정 화면). 이름을 바꾼 직후 옛 이름이 캐시로 통과하지 않게 한다.
export async function readMarketItemOptionsUncached(subject: WorkspaceSubject, kind: MarketItemOptionKind): Promise<MarketItemOption[]> {
  if (isProductInfoPreviewEnabled()) {
    const data = await readProductInfoPreviewData()
    return sortOptions(data.options.filter((option) => option.subject === subject && option.kind === kind))
  }
  return readOptionsFromDb(subject, kind)
}

// 관리자 '상품 표시 설정' 목록 탭: 항목마다 그 이름을 쓰는 상품 수(이름 바꾸기 확인 창에 서버가 센 수). 이용 근거는 상품 칸이 아니라 0.
export interface MarketItemOptionWithCount extends MarketItemOption {
  itemCount: number
}

export async function readMarketItemOptionsWithCounts(subject: WorkspaceSubject, kind: MarketItemOptionKind): Promise<MarketItemOptionWithCount[]> {
  const options = await readMarketItemOptionsUncached(subject, kind)
  if (kind === 'usage_basis' || isProductInfoPreviewEnabled()) return options.map((option) => ({ ...option, itemCount: 0 }))
  const column = kind === 'grade' ? 'grade_level' : 'source_type'
  const db = catalogDb()
  // 항목마다 센다(행 수 상한에 걸리지 않게 count 만 읽음). 이름 바꾸기 함수와 같은 조건(과목 + 칸 = 이름).
  return Promise.all(options.map(async (option) => {
    const { count, error } = await db.from('market_items').select('id', { count: 'exact', head: true })
      .eq('workspace_subject', subject).eq(column, option.label)
    if (error) throw new Error(`상품 값 읽기 실패: ${error.message}`)
    return { ...option, itemCount: count ?? 0 }
  }))
}

// ── 표시 설정(검색·보관함 필터 이름, 두 과목 공통 1행) ───────────────────────────────────────────────────────
async function readDisplayRow(): Promise<unknown> {
  const { data, error } = await catalogDb()
    .from('system_settings').select('value').eq('key', MARKET_ITEM_DISPLAY_SETTING_KEY).maybeSingle()
  if (error) throw new Error(`${MARKET_ITEM_DISPLAY_SETTING_KEY} 읽기 실패: ${error.message}`)
  return data?.value ?? null
}

const getCachedDisplayValue = unstable_cache(
  async () => readDisplayRow(),
  ['market-item-display'],
  { revalidate: MARKET_ITEM_OPTIONS_CACHE_SECONDS, tags: [MARKET_ITEM_DISPLAY_CACHE_TAG] }
)

// 회원 화면 필터 이름·상품 상세 안내 문구(19번 — 상세 page 만 부름. 장바구니·결제 경로는 부르지 않는다).
// 행이 없거나 필수 키가 비면 예외 — 부르는 화면은 설정에 기대는 글만 숨기고 동작(필터·담기)은 그대로 둔다.
export async function getMarketItemDisplay(): Promise<MarketItemDisplay> {
  const raw = isProductInfoPreviewEnabled() ? (await readProductInfoPreviewData()).display : await getCachedDisplayValue()
  const display = parseMarketItemDisplay(raw)
  if (!display) throw new Error(`${MARKET_ITEM_DISPLAY_SETTING_KEY} missing or invalid`)
  return display
}

// 관리자 화면(캐시 없음). 읽지 못하거나 모양이 다르면 null.
export async function readMarketItemDisplayForAdmin(): Promise<MarketItemDisplay | null> {
  const raw = isProductInfoPreviewEnabled() ? (await readProductInfoPreviewData()).display : await readDisplayRow()
  return parseMarketItemDisplay(raw)
}

// ── DB 함수 호출(관리자 route 만 부른다) ─────────────────────────────────────────────────────────────────
export type MarketCatalogCallResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: { code: MarketItemOptionErrorCode; detail: string | null } | null }

export async function callMarketCatalogRpc(name: string, args: Record<string, unknown>): Promise<MarketCatalogCallResult> {
  const { data, error } = await catalogDb().rpc(name, args)
  if (error) {
    const parsed = extractMarketItemOptionError(error.message)
    if (!parsed) console.error(`[market-item-options] ${name} 실패`, error.message)
    return { ok: false, error: parsed }
  }
  return { ok: true, data: (data && typeof data === 'object' ? data : {}) as Record<string, unknown> }
}

export function callSaveMarketItemOption(actorId: string, input: {
  id: string | null
  expectedRevision: number | null
  subject: WorkspaceSubject
  kind: MarketItemOptionKind
  label: string
  isActive: boolean
}, requestMeta: AdminRequestMeta) {
  return callMarketCatalogRpc('save_market_item_option', {
    p_actor_id: actorId,
    p_id: input.id,
    p_expected_revision: input.expectedRevision,
    p_subject: input.subject,
    p_kind: input.kind,
    p_label: input.label,
    p_is_active: input.isActive,
    p_request_meta: requestMeta,
  })
}

export function callReorderMarketItemOptions(actorId: string, subject: WorkspaceSubject, kind: MarketItemOptionKind, ids: string[], requestMeta: AdminRequestMeta) {
  return callMarketCatalogRpc('reorder_market_item_options', {
    p_actor_id: actorId, p_subject: subject, p_kind: kind, p_ids: ids, p_request_meta: requestMeta,
  })
}

// 19번 4-3: 탭마다 자기 최상위 키만 보낸다(검색 필터 이름 탭은 facetLabels·libraryEmptyFilterHint, 상세 탭들은 detail).
// 보내지 않은 키는 DB 함수가 지금 값 그대로 둔다.
export type MarketItemDisplayPatch = Partial<Omit<MarketItemDisplay, 'revision'>>

export function callSaveMarketItemDisplay(actorId: string, expectedRevision: number, value: MarketItemDisplayPatch, requestMeta: AdminRequestMeta) {
  return callMarketCatalogRpc('save_market_item_display', {
    p_actor_id: actorId, p_expected_revision: expectedRevision, p_value: value, p_request_meta: requestMeta,
  })
}

// 19번 4-4: 상품의 서브상품 순서(지우지 않은 서브상품 전부, 사용 안 함 포함). 10·20·30… 으로 다시 매긴다.
export function callReorderMarketItemSubproducts(actorId: string, itemId: string, ids: string[], requestMeta: AdminRequestMeta) {
  return callMarketCatalogRpc('reorder_market_item_subproducts', {
    p_actor_id: actorId, p_item_id: itemId, p_ids: ids, p_request_meta: requestMeta,
  })
}

// ── 상품 저장 route 의 학년·자료유형 검사(캐시 없이 DB 에서 읽음 — 계획 6절 2판) ─────────────────────────────────────
// undefined(보내지 않음)는 검사하지 않는다(저장 함수가 지금 값을 그대로 둔다). 거절이면 그 종류의 문구를 돌려준다.
export async function findMarketItemProductOptionProblem(subject: WorkspaceSubject, input: {
  gradeLevel: string | undefined
  sourceType: string | undefined
}, current: { gradeLevel: string | null; sourceType: string | null } | null): Promise<string | null> {
  const checks: { kind: MarketItemProductOptionKind; value: string | undefined; current: string | null }[] = [
    { kind: 'grade', value: input.gradeLevel, current: current?.gradeLevel ?? null },
    { kind: 'material_type', value: input.sourceType, current: current?.sourceType ?? null },
  ]
  for (const check of checks) {
    if (check.value === undefined) continue
    const options = await readMarketItemOptionsUncached(subject, check.kind)
    if (!checkMarketItemOptionValue({ value: check.value, current: check.current, options }).ok) {
      return MARKET_ITEM_OPTION_REJECT_MESSAGES[check.kind]
    }
  }
  return null
}
