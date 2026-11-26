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
// 설정 행 필수 키(마이그레이션 save_market_item_display·VERIFY 와 같은 목록 — 계약 시험이 대조한다)
export const MARKET_ITEM_DISPLAY_REQUIRED_KEYS = [
  'facetLabels.category',
  'facetLabels.type',
  'facetLabels.year',
  'facetLabels.grade',
  'libraryEmptyFilterHint',
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

export interface MarketItemDisplay {
  revision: number
  facetLabels: Record<MarketItemFacetKey, string>
  libraryEmptyFilterHint: string
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
  return { revision: value.revision, facetLabels, libraryEmptyFilterHint: hint.trim() }
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

export type MarketItemOptionErrorCode = keyof typeof MARKET_ITEM_OPTION_ERROR_MESSAGES

export const MARKET_ITEM_OPTION_FIELD_LABELS: Record<string, string> = {
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
}

export function extractMarketItemOptionError(message: string | null | undefined): { code: MarketItemOptionErrorCode; detail: string | null } | null {
  const match = /(MARKET_[A-Z_]+)(?::([A-Za-z0-9_.]+))?/.exec(message ?? '')
  if (!match || !(match[1] in MARKET_ITEM_OPTION_ERROR_MESSAGES)) return null
  return { code: match[1] as MarketItemOptionErrorCode, detail: match[2] ?? null }
}

export function marketItemOptionErrorMessage(error: { code: MarketItemOptionErrorCode; detail: string | null }): string {
  const base: string = MARKET_ITEM_OPTION_ERROR_MESSAGES[error.code]
  if (!error.detail) return base
  return `${base} (${MARKET_ITEM_OPTION_FIELD_LABELS[error.detail] ?? error.detail})`
}
