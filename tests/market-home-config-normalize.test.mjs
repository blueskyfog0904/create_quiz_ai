import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  readMarketHomeConfig,
  validateMarketHomeConfig,
} from '../src/lib/market-home.ts'

// 22번(계획 3-1·3-3, 의도적 변경): 판 1 값은 새 코드에서 '설정 없음'이다. 기본값(인기 12·최근 8)으로 돌아가지 않고
// 회원 홈은 섹션 0개 + 관리 화면 빨간 띠, 저장은 revision 0 경로(3-4)로 판 2 를 쓴다.
// 예전 '문제마켓 카테고리'(categories) 키가 남은 판 1 값도 같다.
const legacy = {
  version: 1,
  popular: { isActive: false, limit: 5, rankingWindowDays: 7 },
  categories: { isActive: true, menuEntryIds: ['x'] },
  recent: { isActive: false, limit: 3 },
}

test('판 1 값(예전 categories 키 포함)과 행 없음은 설정 없음(revision 0)이고 기본값으로 바꾸지 않는다', () => {
  for (const value of [legacy, { ...legacy, categories: undefined }, null, undefined]) {
    const read = readMarketHomeConfig(value)
    assert.equal(read.state, 'missing')
    assert.equal(read.revision, 0)
    assert.equal(read.config, null)
  }
})

test('저장된 값 검사는 판 1 을 거절하고 입력은 바꾸지 않는다', () => {
  const input = structuredClone(legacy)
  assert.throws(() => validateMarketHomeConfig(input), /version|칸/)
  assert.deepEqual(input, legacy)
})

test('저장 라우트에 게시판 허용 목록 검사가 없다', () => {
  const route = readFileSync(
    new URL('../src/app/api/admin/market-main-settings/route.ts', import.meta.url),
    'utf8'
  )
  assert.doesNotMatch(route, /getMarketHomeAdminOptions|validateAllowlist/)
})
