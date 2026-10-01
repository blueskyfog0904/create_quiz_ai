import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MARKET_CART_INTENT_KEY,
  MARKET_CART_INTENT_TTL_MS,
  saveMarketCartIntent,
  takeMarketCartIntent,
} from '../src/lib/market-cart-intent.ts'

// docs/cart-detail-multiselect-plan.md 12절 D15·D16
const ITEM = 'ca7e0002-0000-4000-8000-0000000000e1'
const OTHER_ITEM = 'ca7e0002-0000-4000-8000-0000000000e2'
const PDF = 'ca7e0002-0000-4000-8000-0000000000a1'
const BUNDLE = 'ca7e0002-0000-4000-8000-0000000000b1'
const NOW = 1_800_000_000_000
const expected = { itemId: ITEM, workspaceSubject: 'english' }

function memoryStorage() {
  const map = new Map()
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: (key) => { map.delete(key) },
  }
}

function intent(overrides = {}) {
  return {
    action: 'cart',
    itemId: ITEM,
    workspaceSubject: 'english',
    targets: [{ targetKind: 'subproduct', targetId: PDF }, { targetKind: 'bundle', targetId: BUNDLE }],
    ...overrides,
  }
}

test('saved intent is taken exactly once and removed from storage', () => {
  const storage = memoryStorage()
  saveMarketCartIntent(intent(), { storage, now: NOW })
  assert.deepEqual(JSON.parse(storage.map.get(MARKET_CART_INTENT_KEY)), { ...intent(), createdAt: NOW })

  const first = takeMarketCartIntent(expected, { storage, now: NOW + 1000 })
  assert.deepEqual(first, { ...intent(), createdAt: NOW })
  assert.equal(storage.map.has(MARKET_CART_INTENT_KEY), false)
  assert.equal(takeMarketCartIntent(expected, { storage, now: NOW + 2000 }), null)
})

test('purchase intent keeps its action for selection restore', () => {
  const storage = memoryStorage()
  saveMarketCartIntent(intent({ action: 'purchase' }), { storage, now: NOW })
  assert.equal(takeMarketCartIntent(expected, { storage, now: NOW })?.action, 'purchase')
})

test('intent older than 30 minutes or from the future is discarded', () => {
  const storage = memoryStorage()
  saveMarketCartIntent(intent(), { storage, now: NOW })
  assert.equal(takeMarketCartIntent(expected, { storage, now: NOW + MARKET_CART_INTENT_TTL_MS }) !== null, true)

  saveMarketCartIntent(intent(), { storage, now: NOW })
  assert.equal(takeMarketCartIntent(expected, { storage, now: NOW + 31 * 60 * 1000 }), null)
  assert.equal(storage.map.has(MARKET_CART_INTENT_KEY), false)

  saveMarketCartIntent(intent(), { storage, now: NOW })
  assert.equal(takeMarketCartIntent(expected, { storage, now: NOW - 1 }), null)
})

test('intent for another item or subject is discarded and removed', () => {
  const storage = memoryStorage()
  saveMarketCartIntent(intent({ itemId: OTHER_ITEM }), { storage, now: NOW })
  assert.equal(takeMarketCartIntent(expected, { storage, now: NOW }), null)
  assert.equal(storage.map.has(MARKET_CART_INTENT_KEY), false)

  saveMarketCartIntent(intent({ workspaceSubject: 'korean' }), { storage, now: NOW })
  assert.equal(takeMarketCartIntent(expected, { storage, now: NOW }), null)
})

test('broken JSON, 51 targets and unknown kinds are rejected', () => {
  const storage = memoryStorage()
  for (const raw of [
    '{not json',
    JSON.stringify({ ...intent(), createdAt: NOW, targets: Array.from({ length: 51 }, () => ({ targetKind: 'subproduct', targetId: PDF })) }),
    JSON.stringify({ ...intent(), createdAt: NOW, targets: [{ targetKind: 'legacy_pdf', targetId: PDF }] }),
    JSON.stringify({ ...intent(), createdAt: NOW, targets: [{ targetKind: 'subproduct', targetId: 'not-a-uuid' }] }),
    JSON.stringify({ ...intent(), createdAt: NOW, action: 'download' }),
    JSON.stringify({ ...intent(), createdAt: String(NOW) }),
  ]) {
    storage.setItem(MARKET_CART_INTENT_KEY, raw)
    assert.equal(takeMarketCartIntent(expected, { storage, now: NOW }), null, raw.slice(0, 60))
    assert.equal(storage.map.has(MARKET_CART_INTENT_KEY), false)
  }
})

test('empty or oversized selections are not saved and clear a previous intent', () => {
  const storage = memoryStorage()
  saveMarketCartIntent(intent(), { storage, now: NOW })
  saveMarketCartIntent(intent({ targets: [] }), { storage, now: NOW })
  assert.equal(storage.map.has(MARKET_CART_INTENT_KEY), false)

  saveMarketCartIntent(intent({ targets: Array.from({ length: 51 }, () => ({ targetKind: 'subproduct', targetId: PDF })) }), { storage, now: NOW })
  assert.equal(storage.map.has(MARKET_CART_INTENT_KEY), false)
})

test('storage failures never throw', () => {
  const throwing = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') },
    removeItem: () => { throw new Error('blocked') },
  }
  assert.doesNotThrow(() => saveMarketCartIntent(intent(), { storage: throwing, now: NOW }))
  assert.equal(takeMarketCartIntent(expected, { storage: throwing, now: NOW }), null)
  // window가 없는 환경(SSR·node)은 storage 없이 조용히 무시한다
  assert.doesNotThrow(() => saveMarketCartIntent(intent()))
  assert.equal(takeMarketCartIntent(expected), null)
})
