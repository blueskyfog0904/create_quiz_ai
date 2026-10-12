import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_MARKET_HOME_CONFIG,
  normalizeMarketHomeConfig,
  validateMarketHomeConfig,
} from '../src/lib/market-home.ts'

// 삭제된 '문제마켓 카테고리' 설정이 남은 예전 형태 값. popular·recent는 기본값과 다르게 둔다.
const legacy = {
  version: 1,
  popular: { isActive: false, limit: 5, rankingWindowDays: 7 },
  categories: { isActive: true, menuEntryIds: ['x'] },
  recent: { isActive: false, limit: 3 },
}
const expected = {
  version: 1,
  popular: { isActive: false, limit: 5, rankingWindowDays: 7 },
  recent: { isActive: false, limit: 3 },
}

test('예전 categories 키가 남은 값도 인기·최근 설정을 그대로 유지한다', () => {
  assert.deepEqual(normalizeMarketHomeConfig(legacy), expected)
  assert.equal('categories' in normalizeMarketHomeConfig(legacy), false)
})

test('저장 API가 쓰는 validate도 예전 값을 받아들여 categories 없이 돌려주고 입력은 바꾸지 않는다', () => {
  const input = structuredClone(legacy)
  assert.deepEqual(validateMarketHomeConfig(input), expected)
  assert.deepEqual(input, legacy)
})

test('categories 외의 모르는 키는 지금처럼 거절하고 normalize는 기본값을 돌려준다', () => {
  for (const extra of [{ sourceExplorer: { isActive: true } }, { extra: 1 }]) {
    const value = { ...expected, ...extra }
    assert.throws(() => validateMarketHomeConfig(value), /is not supported/)
    assert.deepEqual(normalizeMarketHomeConfig(value), DEFAULT_MARKET_HOME_CONFIG)
  }
  assert.equal('categories' in DEFAULT_MARKET_HOME_CONFIG, false)
})

test('저장 라우트에 게시판 허용 목록 검사가 없다', () => {
  const route = readFileSync(
    new URL('../src/app/api/admin/market-main-settings/route.ts', import.meta.url),
    'utf8'
  )
  assert.doesNotMatch(route, /getMarketHomeAdminOptions|validateAllowlist/)
})
