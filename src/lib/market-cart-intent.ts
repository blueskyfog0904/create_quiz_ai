// 비로그인 상세에서 [로그인 후 담기]·[로그인 후 구매]를 누른 선택을 로그인 복귀 뒤 1회 소비하기 위한 저장소.
// node 단위 테스트가 직접 import하므로 alias import·enum 같은 TS 전용 런타임 문법 없이 순수 모듈로 둔다.
// 가격·제목은 저장하지 않는다. 복귀 시 현재 상세의 옵션과 다시 대조한다.

export const MARKET_CART_INTENT_KEY = 'market-cart-intent:v1'
// 로그인 폼 작성·OAuth 왕복에 충분하고, 공용 PC에 남는 시간을 줄인다.
export const MARKET_CART_INTENT_TTL_MS = 30 * 60 * 1000

const MAX_TARGETS = 50
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type MarketCartIntentAction = 'cart' | 'purchase'

export interface MarketCartIntentTarget {
  targetKind: 'subproduct' | 'bundle'
  targetId: string
}

export interface MarketCartIntent {
  action: MarketCartIntentAction
  itemId: string
  workspaceSubject: string
  targets: MarketCartIntentTarget[]
  createdAt: number
}

export interface MarketCartIntentStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface StorageOptions {
  storage?: MarketCartIntentStorage | null
  now?: number
}

function resolveStorage(storage: MarketCartIntentStorage | null | undefined): MarketCartIntentStorage | null {
  if (storage !== undefined) {
    return storage
  }
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

function isValidTarget(value: unknown): value is MarketCartIntentTarget {
  if (!value || typeof value !== 'object') {
    return false
  }
  const target = value as Record<string, unknown>
  return (target.targetKind === 'subproduct' || target.targetKind === 'bundle')
    && typeof target.targetId === 'string'
    && UUID_PATTERN.test(target.targetId)
}

function isValidIntent(value: unknown): value is MarketCartIntent {
  if (!value || typeof value !== 'object') {
    return false
  }
  const intent = value as Record<string, unknown>
  return (intent.action === 'cart' || intent.action === 'purchase')
    && typeof intent.itemId === 'string'
    && typeof intent.workspaceSubject === 'string'
    && typeof intent.createdAt === 'number'
    && Array.isArray(intent.targets)
    && intent.targets.length >= 1
    && intent.targets.length <= MAX_TARGETS
    && intent.targets.every(isValidTarget)
}

// 선택이 0건이거나 형식이 맞지 않으면 기존 값을 지우고 저장하지 않는다. storage 실패는 무시한다(로그인 이동은 그대로).
export function saveMarketCartIntent(
  intent: Omit<MarketCartIntent, 'createdAt'>,
  { storage, now = Date.now() }: StorageOptions = {}
) {
  const target = resolveStorage(storage)
  if (!target) {
    return
  }
  try {
    const value = { ...intent, createdAt: now }
    if (!isValidIntent(value)) {
      target.removeItem(MARKET_CART_INTENT_KEY)
      return
    }
    target.setItem(MARKET_CART_INTENT_KEY, JSON.stringify(value))
  } catch {
    // sessionStorage 차단·용량 초과: 의도 없이 기존 동작(로그인 후 다시 선택)으로 퇴화한다.
  }
}

// 읽는 즉시 지운다(새로고침·이중 실행에도 1회만 소비). 같은 상세·TTL 안·형식 유효일 때만 값을 돌려준다.
export function takeMarketCartIntent(
  expected: { itemId: string; workspaceSubject: string },
  { storage, now = Date.now() }: StorageOptions = {}
): MarketCartIntent | null {
  const target = resolveStorage(storage)
  if (!target) {
    return null
  }

  let raw: string | null
  try {
    raw = target.getItem(MARKET_CART_INTENT_KEY)
    target.removeItem(MARKET_CART_INTENT_KEY)
  } catch {
    return null
  }
  if (raw === null) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isValidIntent(parsed)) {
    return null
  }
  const age = now - parsed.createdAt
  if (age < 0 || age > MARKET_CART_INTENT_TTL_MS) {
    return null
  }
  if (parsed.itemId !== expected.itemId || parsed.workspaceSubject !== expected.workspaceSubject) {
    return null
  }
  return parsed
}
