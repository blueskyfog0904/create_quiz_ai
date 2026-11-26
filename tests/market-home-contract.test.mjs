import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const contractSource = fs.readFileSync(
  new URL('../src/lib/market-home.ts', import.meta.url),
  'utf8'
)
const serverSource = fs.readFileSync(
  new URL('../src/lib/market-home-server.ts', import.meta.url),
  'utf8'
)

// 22번: 판 2(섹션 배열). 기본값으로 돌아가는 normalize 대신 '설정 없음' 상태가 있다(3-3). 새 섹션 숫자 시작값만 코드에 있다.
test('market home config has bounded strict validation and no default fallback', () => {
  assert.doesNotMatch(contractSource, /DEFAULT_MARKET_HOME_CONFIG|normalizeMarketHomeConfig/)
  assert.match(contractSource, /rankingWindowDays:\s*30/)
  assert.match(contractSource, /validateMarketHomeConfig/)
  assert.match(contractSource, /assertExactKeys/)
  assert.match(contractSource, /MARKET_HOME_LIMITS\.popular/)
  assert.match(contractSource, /MARKET_HOME_LIMITS\.recent/)
  assert.match(contractSource, /sections: \{ min: 1, max: 8 \}/)
  assert.match(contractSource, /featuredItems: \{ min: 0, max: 24 \}/)
})

test('public home queries are subject and publication scoped', () => {
  assert.match(serverSource, /\.eq\('workspace_subject',\s*workspaceSubject\)/)
  assert.match(serverSource, /\.eq\('status',\s*'published'\)/)
  assert.match(serverSource, /\.eq\('is_active',\s*true\)/)
  assert.match(serverSource, /\.is\('deleted_at',\s*null\)/)
  // 노출은 상품 상태만으로 정한다(S3 — 게시판 게이트 없음)
  assert.doesNotMatch(serverSource, /is_visible|market_menu_entries|visibleMenuIds/)
})

test('recent sorting is deterministic', () => {
  assert.match(serverSource, /\.order\('published_at',\s*\{\s*ascending:\s*false,\s*nullsFirst:\s*false\s*\}\)/)
  assert.match(serverSource, /\.order\('created_at',\s*\{\s*ascending:\s*false\s*\}\)/)
  assert.match(serverSource, /\.order\('id',\s*\{\s*ascending:\s*true\s*\}\)/)
})

// 22번(계획 3-3, 의도적 변경): 일시 읽기 오류는 섹션을 비우지 않고 던진다 → unstable_cache 가 이전 정상 값을 유지한다.
// 첫 채움부터 실패하면 page 가 받아 '배너만'(marketHomeReadFailed)으로 그린다.
test('home read errors throw inside the cached function and pages fall back to banner-only', () => {
  assert.doesNotMatch(serverSource, /Promise\.allSettled|fulfilledOr/)
  assert.match(serverSource, /if \(error\) throw new Error\(error\.message\)/)
  const memberPage = fs.readFileSync(new URL('../src/app/(solvook)/page.tsx', import.meta.url), 'utf8')
  const previewPage = fs.readFileSync(new URL('../src/app/preview/solvook-concept/page.tsx', import.meta.url), 'utf8')
  assert.match(memberPage, /getCachedMarketHomeData\(subject\)\.catch\([\s\S]*marketHomeReadFailed\(subject\)/)
  assert.match(previewPage, /getCachedMarketHomeData\(subject\)\.catch\(\(\) => marketHomeReadFailed\(subject\)\)/)
})

