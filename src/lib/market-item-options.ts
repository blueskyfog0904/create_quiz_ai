// 17번 계획 6절: 상품 학년·자료유형 목록과 상품 표시 설정의 규칙(순수 함수 — 서버·화면 모두 쓴다).
// 목록 이름·필터 이름 같은 데이터는 DB(market_item_attribute_options·system_settings.market_item_display)에만 두고,
// 여기에는 종류 이름·글자 수 상한·필터 key·검사 규칙·오류 문구(관리자 조작 문구)만 둔다.
// 이용 근거(상품별, 내부 전용) 읽기·쓰기는 src/lib/market-item-usage-basis-server.ts 에만 있다.

export const MARKET_ITEM_OPTION_KINDS = ['grade', 'material_type', 'usage_basis'] as const
export type MarketItemOptionKind = typeof MARKET_ITEM_OPTION_KINDS[number]

// 상품 칸(grade_level·source_type)에 들어가는 종류. 이용 근거는 상품 칸이 아니라 id 로 이어진다.
export const MARKET_ITEM_PRODUCT_OPTION_KINDS = ['grade', 'material_type'] as const
export type MarketItemProductOptionKind = typeof MARKET_ITEM_PRODUCT_OPTION_KINDS[number]

// 관리자 화면의 종류 이름(관리자 조작 문구 — Q4)
export const MARKET_ITEM_OPTION_KIND_LABELS: Record<MarketItemOptionKind, string> = {
  grade: '학년',
  material_type: '자료유형',
  usage_basis: '이용 근거(내부)',
}

export const MARKET_ITEM_OPTION_LABEL_MAX = 40
export const MARKET_ITEM_SOURCE_MAX = 100
export const MARKET_USAGE_BASIS_NOTE_MAX = 2000
export const MARKET_USAGE_BASIS_EVIDENCE_MAX = 300
export const MARKET_ITEM_FACET_LABEL_MAX = 20
export const MARKET_ITEM_EMPTY_HINT_MAX = 60

// 검색·자료 보관함 필터 key(주소 ?type= 등). 이름은 DB facetLabels 에 있다.
export const MARKET_ITEM_FACET_KEYS = ['category', 'type', 'year', 'grade'] as const
export type MarketItemFacetKey = typeof MARKET_ITEM_FACET_KEYS[number]
export const MARKET_ITEM_EMPTY_HINT_PLACEHOLDER = '{type}'

export const MARKET_ITEM_DISPLAY_SETTING_KEY = 'market_item_display'

// 19번 4-2: 상품 상세 안내 문구·자료 정보 항목(설정 행 detail 키). 글은 DB 에만 두고 여기는 키·상한·규칙만 둔다.
// 짧은 글(제목·이름·버튼) 1~30자, 긴 글(설명·안내) 1~200자, 모두 한 줄. 자리표시 {장수} 는 COUNT 키 두 개에서만 받는다.
export const MARKET_ITEM_DETAIL_SHORT_KEYS = [
  'sampleTitle', 'sampleTitleEmpty', 'sampleRowButton', 'sampleButton', 'sampleButtonEmpty', 'hwpPdfNoticeLabel', 'bundleDefaultTitle',
] as const
export const MARKET_ITEM_DETAIL_LONG_KEYS = ['sampleDescription', 'sampleDescriptionLegacy', 'sampleDescriptionEmpty', 'hwpPdfNoticeText'] as const
export const MARKET_ITEM_DETAIL_COUNT_KEYS = ['sampleDescription', 'sampleButton'] as const
export const MARKET_ITEM_SUMMARY_LABEL_KEYS = ['questionCount', 'samplePages', 'unknown', 'noSample'] as const
// 자료 정보 항목 key(상품 칸과 1:1 — 새 항목은 코드가 필요해 더하거나 지우지 않는다, Q3). 이름·보이기·순서는 DB infoItems.
export const MARKET_ITEM_INFO_KEYS = ['subject', 'grade', 'sources', 'materialType', 'questionCount', 'registeredAt'] as const
export const MARKET_ITEM_DETAIL_SHORT_MAX = 30
export const MARKET_ITEM_DETAIL_LONG_MAX = 200
export const MARKET_ITEM_SAMPLE_COUNT_PLACEHOLDER = '{장수}'

export type MarketItemDetailShortKey = typeof MARKET_ITEM_DETAIL_SHORT_KEYS[number]
export type MarketItemDetailLongKey = typeof MARKET_ITEM_DETAIL_LONG_KEYS[number]
export type MarketItemDetailTextKey = MarketItemDetailShortKey | MarketItemDetailLongKey
export type MarketItemSummaryLabelKey = typeof MARKET_ITEM_SUMMARY_LABEL_KEYS[number]
export type MarketItemInfoKey = typeof MARKET_ITEM_INFO_KEYS[number]

// 설정 행 필수 키(마이그레이션 save_market_item_display·VERIFY 와 같은 목록 — 계약 시험이 대조한다). 표시 설정 필수 키는 이 한 곳에만 둔다.
export const MARKET_ITEM_DISPLAY_REQUIRED_KEYS = [
  'facetLabels.category',
  'facetLabels.type',
  'facetLabels.year',
  'facetLabels.grade',
  'libraryEmptyFilterHint',
  ...MARKET_ITEM_DETAIL_SHORT_KEYS.map((key) => `detail.${key}` as const),
  ...MARKET_ITEM_DETAIL_LONG_KEYS.map((key) => `detail.${key}` as const),
  ...MARKET_ITEM_SUMMARY_LABEL_KEYS.map((key) => `detail.summaryLabels.${key}` as const),
  'detail.infoItems',
] as const

export const MARKET_ITEM_OPTIONS_CACHE_TAG = 'market_item_options'
export const MARKET_ITEM_DISPLAY_CACHE_TAG = 'market_item_display'
export const MARKET_ITEM_OPTIONS_CACHE_SECONDS = 60

export interface MarketItemOption {
  id: string
  subject: 'korean' | 'english'
  kind: MarketItemOptionKind
  label: string
  sortOrder: number
  isActive: boolean
  revision: number
}

export interface MarketItemInfoItem {
  key: MarketItemInfoKey
  label: string
  visible: boolean
}

export type MarketItemDetailDisplay = Record<MarketItemDetailTextKey, string> & {
  summaryLabels: Record<MarketItemSummaryLabelKey, string>
  infoItems: MarketItemInfoItem[]
}

export interface MarketItemDisplay {
  revision: number
  facetLabels: Record<MarketItemFacetKey, string>
  libraryEmptyFilterHint: string
  // 19번: 상세 안내 문구·자료 정보 항목(필수 — 빠지거나 모양이 다르면 설정 전체를 읽지 못한 것으로 본다)
  detail: MarketItemDetailDisplay
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

export function isMarketItemOptionKind(value: unknown): value is MarketItemOptionKind {
  return typeof value === 'string' && (MARKET_ITEM_OPTION_KINDS as readonly string[]).includes(value)
}

// 목록 이름·상품 값 다듬기: NFC, 앞뒤 공백 정리(DB 함수와 같은 규칙)
export function normalizeMarketItemOptionLabel(value: string | null | undefined): string {
  return (value ?? '').normalize('NFC').trim()
}

export function isValidMarketItemOptionLabel(label: string): boolean {
  return label.length > 0 && label.length <= MARKET_ITEM_OPTION_LABEL_MAX && !CONTROL_CHARACTERS.test(label)
}

// 설정 행 → 화면 값. 필수 키가 비거나 모양이 다르면 null(기본 문구를 코드에 두지 않는다).
export function parseMarketItemDisplay(raw: unknown): MarketItemDisplay | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (typeof value.revision !== 'number') return null
  const facets = value.facetLabels
  if (!facets || typeof facets !== 'object' || Array.isArray(facets)) return null
  const facetLabels = {} as Record<MarketItemFacetKey, string>
  for (const key of MARKET_ITEM_FACET_KEYS) {
    const label = (facets as Record<string, unknown>)[key]
    if (typeof label !== 'string' || label.trim() === '') return null
    facetLabels[key] = label.trim()
  }
  const hint = value.libraryEmptyFilterHint
  if (typeof hint !== 'string' || hint.trim() === '') return null
  const detail = parseMarketItemDetailDisplay(value.detail)
  if (!detail) return null
  return { revision: value.revision, facetLabels, libraryEmptyFilterHint: hint.trim(), detail }
}

// 19번: detail 키 → 화면 값(필수 키 전부, infoItems 는 6개 key 가 한 번씩). 하나라도 어긋나면 null.
export function parseMarketItemDetailDisplay(raw: unknown): MarketItemDetailDisplay | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const texts = {} as Record<MarketItemDetailTextKey, string>
  for (const key of [...MARKET_ITEM_DETAIL_SHORT_KEYS, ...MARKET_ITEM_DETAIL_LONG_KEYS]) {
    const text = value[key]
    if (typeof text !== 'string' || text.trim() === '') return null
    texts[key] = text.trim()
  }
  const summary = value.summaryLabels
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null
  const summaryLabels = {} as Record<MarketItemSummaryLabelKey, string>
  for (const key of MARKET_ITEM_SUMMARY_LABEL_KEYS) {
    const text = (summary as Record<string, unknown>)[key]
    if (typeof text !== 'string' || text.trim() === '') return null
    summaryLabels[key] = text.trim()
  }
  const items = value.infoItems
  if (!Array.isArray(items) || items.length !== MARKET_ITEM_INFO_KEYS.length) return null
  const infoItems: MarketItemInfoItem[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') return null
    const { key, label, visible } = item as Record<string, unknown>
    if (typeof key !== 'string' || !(MARKET_ITEM_INFO_KEYS as readonly string[]).includes(key)) return null
    if (infoItems.some((existing) => existing.key === key)) return null
    if (typeof label !== 'string' || label.trim() === '' || typeof visible !== 'boolean') return null
    infoItems.push({ key: key as MarketItemInfoKey, label: label.trim(), visible })
  }
  return { ...texts, summaryLabels, infoItems }
}

// {장수} 자리에 샘플 장수를 채운다(자리표시가 없으면 글 그대로).
export function fillSampleCount(text: string, count: number): string {
  return text.split(MARKET_ITEM_SAMPLE_COUNT_PLACEHOLDER).join(String(count))
}

// 자료 정보 표의 행: 보이는 항목만, 설정 순서대로, 빈 값 행은 뺀다. 출처는 1~4 중 비지 않은 것을 ' · '로 잇는다.
// 값 꼴(과목 이름·등록일 글자)은 부르는 화면이 만들어 넘긴다.
export interface MarketItemInfoValues {
  subject: string | null
  grade: string | null
  sources: (string | null | undefined)[]
  materialType: string | null
  questionCount: number | null
  registeredAt: string | null
}

export function buildMaterialInfoRows(item: MarketItemInfoValues, display: Pick<MarketItemDetailDisplay, 'infoItems'>): { key: MarketItemInfoKey; label: string; value: string }[] {
  const sources = item.sources.map((source) => source?.trim()).filter((source): source is string => Boolean(source))
  const values: Record<MarketItemInfoKey, string | null> = {
    subject: item.subject?.trim() || null,
    grade: item.grade?.trim() || null,
    sources: sources.length > 0 ? sources.join(' · ') : null,
    materialType: item.materialType?.trim() || null,
    questionCount: item.questionCount === null ? null : item.questionCount.toLocaleString('ko-KR'),
    registeredAt: item.registeredAt?.trim() || null,
  }
  return display.infoItems
    .filter((info) => info.visible)
    .map((info) => ({ key: info.key, label: info.label, value: values[info.key] }))
    .filter((row): row is { key: MarketItemInfoKey; label: string; value: string } => Boolean(row.value))
}

// 그 항목을 보이는지(설정을 읽지 못했으면 보이지 않음 — 배지·등록일 줄도 함께 숨긴다).
export function isInfoItemVisible(display: Pick<MarketItemDetailDisplay, 'infoItems'> | null, key: MarketItemInfoKey): boolean {
  return Boolean(display?.infoItems.some((info) => info.key === key && info.visible))
}

// 전체구매 제목: 앞뒤 공백을 뺀 표시명, 비면 설정의 기본 제목. 둘 다 없으면 null(부르는 곳이 상품 제목 등으로 채운다).
export function resolveBundleTitle(label: string | null | undefined, display: Pick<MarketItemDetailDisplay, 'bundleDefaultTitle'> | null): string | null {
  return label?.trim() || display?.bundleDefaultTitle || null
}

// 관리자 저장 전 detail 검사(DB 함수와 같은 규칙). 문제가 있는 칸 이름(detail.…)을 돌려주고, 없으면 null.
const UNKNOWN_PLACEHOLDER = /\{[^{}]*\}/
function isBadDetailText(text: string, max: number, allowCount: boolean) {
  const checked = allowCount ? text.split(MARKET_ITEM_SAMPLE_COUNT_PLACEHOLDER).join('') : text
  return !text || text.length > max || CONTROL_CHARACTERS.test(text) || UNKNOWN_PLACEHOLDER.test(checked)
}

export function findMarketItemDetailDisplayProblem(detail: MarketItemDetailDisplay): string | null {
  for (const key of [...MARKET_ITEM_DETAIL_SHORT_KEYS, ...MARKET_ITEM_DETAIL_LONG_KEYS]) {
    const max = (MARKET_ITEM_DETAIL_LONG_KEYS as readonly string[]).includes(key) ? MARKET_ITEM_DETAIL_LONG_MAX : MARKET_ITEM_DETAIL_SHORT_MAX
    if (isBadDetailText((detail[key] ?? '').trim(), max, (MARKET_ITEM_DETAIL_COUNT_KEYS as readonly string[]).includes(key))) return `detail.${key}`
  }
  for (const key of MARKET_ITEM_SUMMARY_LABEL_KEYS) {
    if (isBadDetailText((detail.summaryLabels?.[key] ?? '').trim(), MARKET_ITEM_DETAIL_SHORT_MAX, false)) return `detail.summaryLabels.${key}`
  }
  const keys = (detail.infoItems ?? []).map((info) => info.key)
  if (keys.length !== MARKET_ITEM_INFO_KEYS.length || new Set(keys).size !== keys.length
      || keys.some((key) => !(MARKET_ITEM_INFO_KEYS as readonly string[]).includes(key))) return 'detail.infoItems'
  for (const info of detail.infoItems) {
    if (isBadDetailText((info.label ?? '').trim(), MARKET_ITEM_DETAIL_SHORT_MAX, false)) return 'detail.infoItems.label'
    if (typeof info.visible !== 'boolean') return 'detail.infoItems.visible'
  }
  return null
}

// 보관함 빈 화면 안내: {type} 자리에 '구성' 필터 이름을 채운다.
export function fillLibraryEmptyFilterHint(display: Pick<MarketItemDisplay, 'facetLabels' | 'libraryEmptyFilterHint'>): string {
  return display.libraryEmptyFilterHint.split(MARKET_ITEM_EMPTY_HINT_PLACEHOLDER).join(display.facetLabels.type)
}

// 관리자 저장 전 검사(DB 함수와 같은 규칙). 문제가 있는 칸 이름을 돌려주고, 없으면 null.
export function findMarketItemDisplayProblem(value: Pick<MarketItemDisplay, 'facetLabels' | 'libraryEmptyFilterHint'>): string | null {
  for (const key of MARKET_ITEM_FACET_KEYS) {
    const label = (value.facetLabels[key] ?? '').trim()
    if (!label || label.length > MARKET_ITEM_FACET_LABEL_MAX || CONTROL_CHARACTERS.test(label) || label.includes(MARKET_ITEM_EMPTY_HINT_PLACEHOLDER)) {
      return `facetLabels.${key}`
    }
  }
  const hint = (value.libraryEmptyFilterHint ?? '').trim()
  if (!hint || hint.length > MARKET_ITEM_EMPTY_HINT_MAX || CONTROL_CHARACTERS.test(hint)) return 'libraryEmptyFilterHint'
  return null
}

// 상품 저장(route)의 학년·자료유형 검사: 빈 값은 통과(NULL), 상품의 지금 값과 같으면 통과(숨긴 항목·옛 값으로 저장된 상품도
// 다른 칸을 고칠 수 있게), 아니면 그 과목·종류의 사용 중 목록에 있어야 한다. options 는 이미 그 과목·종류로 거른 목록이다.
export type MarketItemOptionValueCheck =
  | { ok: true; value: string | null }
  | { ok: false; value: string }

export function checkMarketItemOptionValue(input: {
  value: string | null | undefined
  current: string | null | undefined
  options: Pick<MarketItemOption, 'label' | 'isActive'>[]
}): MarketItemOptionValueCheck {
  const value = normalizeMarketItemOptionLabel(input.value)
  if (!value) return { ok: true, value: null }
  if (input.current !== null && input.current !== undefined && normalizeMarketItemOptionLabel(input.current) === value) {
    return { ok: true, value }
  }
  if (input.options.some((option) => option.isActive && option.label === value)) return { ok: true, value }
  return { ok: false, value }
}

// 상품 저장 route 의 거절 문구(목록이 바뀐 뒤 열린 화면이 옛 값을 다시 보내는 경우 포함)
export const MARKET_ITEM_OPTION_REJECT_MESSAGES: Record<MarketItemProductOptionKind, string> = {
  grade: '목록에 없는 학년입니다. 목록이 바뀌었습니다. 새로고침한 뒤 다시 저장해 주세요.',
  material_type: '목록에 없는 자료유형입니다. 목록이 바뀌었습니다. 새로고침한 뒤 다시 저장해 주세요.',
}

// ── DB 함수 오류 코드 → 관리자 문구(마이그레이션의 RAISE 코드와 같은 목록 — 계약 시험이 대조) ──────────────────────────
export const MARKET_ITEM_OPTION_ERROR_MESSAGES = {
  MARKET_CATALOG_ACTOR_NOT_ALLOWED: '이 작업을 할 권한이 없습니다.',
  MARKET_OPTION_INPUT_INVALID: '입력값을 확인해 주세요.',
  MARKET_OPTION_NOT_FOUND: '항목을 찾을 수 없습니다. 화면을 새로고침해 주세요.',
  MARKET_OPTION_REVISION_CONFLICT: '다른 곳에서 먼저 고쳤습니다. 화면을 새로고침한 뒤 다시 저장해 주세요.',
  MARKET_OPTION_DUPLICATE: '같은 이름의 항목이 이미 있습니다(숨긴 항목 포함). 숨긴 항목이면 숨김을 풀어 주세요.',
  MARKET_OPTION_REORDER_MISMATCH: '목록이 바뀌었습니다. 화면을 새로고침한 뒤 다시 순서를 저장해 주세요.',
  MARKET_ITEM_NOT_FOUND: '상품을 찾을 수 없습니다. 화면을 새로고침해 주세요.',
  MARKET_USAGE_BASIS_INPUT_INVALID: '이용 근거 입력값을 확인해 주세요.',
  MARKET_USAGE_BASIS_REVISION_CONFLICT: '다른 곳에서 먼저 고쳤습니다. 화면을 새로고침한 뒤 다시 저장해 주세요.',
  MARKET_ITEM_DISPLAY_MISSING: '상품 표시 설정이 없습니다. 관리자에게 알려 주세요.',
  MARKET_ITEM_DISPLAY_REVISION_CONFLICT: '다른 곳에서 먼저 고쳤습니다. 화면을 새로고침한 뒤 다시 저장해 주세요.',
  MARKET_ITEM_DISPLAY_INPUT_INVALID: '입력값을 확인해 주세요.',
  MARKET_IDENTIFIER_LOCKED: '식별값(slug·code)과 과목은 만든 뒤에 바꾸거나 지울 수 없습니다.',
} as const

// 19번 순서 함수 reorder_market_item_subproducts 만의 오류 코드(19번 마이그레이션 RAISE 코드 — 계약 시험이 대조)
export const MARKET_SUBPRODUCT_ORDER_ERROR_MESSAGES = {
  MARKET_SUBPRODUCT_REORDER_INPUT_INVALID: '순서 입력값을 확인해 주세요.',
  MARKET_SUBPRODUCT_REORDER_MISMATCH: '서브상품 목록이 바뀌었습니다. 화면을 새로고침한 뒤 다시 순서를 저장해 주세요.',
} as const

const MARKET_CATALOG_ERROR_MESSAGES = { ...MARKET_ITEM_OPTION_ERROR_MESSAGES, ...MARKET_SUBPRODUCT_ORDER_ERROR_MESSAGES }

export type MarketItemOptionErrorCode = keyof typeof MARKET_CATALOG_ERROR_MESSAGES

// 19번: 관리자 [상세 안내 문구] 칸 이름(관리자 조작 문구 — 회원에게 보이는 글은 DB 값). 저장 오류 문구에도 쓴다.
export const MARKET_ITEM_DETAIL_FIELD_LABELS: Record<string, string> = {
  'detail.sampleTitle': '샘플 줄 제목(샘플 있음)',
  'detail.sampleTitleEmpty': '샘플 줄 제목(샘플 없음)',
  'detail.sampleDescription': '샘플 줄 설명(샘플 있음)',
  'detail.sampleDescriptionLegacy': '샘플 줄 설명(옛 샘플 PDF만 있음)',
  'detail.sampleDescriptionEmpty': '샘플 줄 설명(샘플 없음)',
  'detail.sampleRowButton': '샘플 줄 버튼',
  'detail.sampleButton': '표지 아래 샘플 버튼(샘플 있음)',
  'detail.sampleButtonEmpty': '표지 아래 샘플 버튼(샘플 없음)',
  'detail.hwpPdfNoticeLabel': 'HWP+PDF 기본 안내 이름표',
  'detail.hwpPdfNoticeText': 'HWP+PDF 기본 안내 본문',
  'detail.bundleDefaultTitle': '전체구매 기본 제목(표시명을 비운 상품)',
  'detail.summaryLabels.questionCount': '요약: 문항 수 이름',
  'detail.summaryLabels.samplePages': '요약: 샘플 장수 이름',
  'detail.summaryLabels.unknown': '요약: 문항 수가 없을 때',
  'detail.summaryLabels.noSample': '요약: 샘플이 없을 때',
}

export const MARKET_ITEM_OPTION_FIELD_LABELS: Record<string, string> = {
  ...MARKET_ITEM_DETAIL_FIELD_LABELS,
  label: '이름(1~40자, 한 줄)',
  isActive: '사용 여부',
  scope: '과목·종류는 바꿀 수 없음',
  ids: '순서 목록',
  basisOptionId: '근거(같은 과목의 사용 중 항목)',
  note: '메모(2,000자 이하)',
  evidenceRef: '증빙 위치(한 줄, 300자 이하)',
  'facetLabels.category': '카테고리 필터 이름(1~20자, 한 줄)',
  'facetLabels.type': '구성 필터 이름(1~20자, 한 줄)',
  'facetLabels.year': '연도 필터 이름(1~20자, 한 줄)',
  'facetLabels.grade': '학년 필터 이름(1~20자, 한 줄)',
  libraryEmptyFilterHint: '보관함 빈 화면 안내(1~60자, 한 줄)',
  // 19번: 상세 안내 문구·자료 정보 항목(칸별 이름은 관리자 화면 표가 따로 보인다 — 여기는 묶음 이름만)
  detail: '상세 안내 문구',
  'detail.infoItems': '자료 정보 항목(6개 한 번씩)',
  'detail.infoItems.label': '자료 정보 항목 이름(1~30자, 한 줄)',
  'detail.infoItems.visible': '자료 정보 항목 보이기',
  itemId: '상품',
}

export function extractMarketItemOptionError(message: string | null | undefined): { code: MarketItemOptionErrorCode; detail: string | null } | null {
  const match = /(MARKET_[A-Z_]+)(?::([A-Za-z0-9_.]+))?/.exec(message ?? '')
  if (!match || !(match[1] in MARKET_CATALOG_ERROR_MESSAGES)) return null
  return { code: match[1] as MarketItemOptionErrorCode, detail: match[2] ?? null }
}

export function marketItemOptionErrorMessage(error: { code: MarketItemOptionErrorCode; detail: string | null }): string {
  const base: string = MARKET_CATALOG_ERROR_MESSAGES[error.code]
  if (!error.detail) return base
  return `${base} (${MARKET_ITEM_OPTION_FIELD_LABELS[error.detail] ?? error.detail})`
}
