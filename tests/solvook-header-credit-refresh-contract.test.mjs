import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const header = readFileSync('src/app/preview/solvook-concept/_components/preview-header.tsx', 'utf8')
const balanceEffect = header.slice(
  header.indexOf('const balanceRequestRef = useRef(0)'),
  header.indexOf('}, [isLoggedIn, pathname])') + '}, [isLoggedIn, pathname])'.length
)

test('header balance is refetched on navigation and when the tab becomes visible again', () => {
  // 레이아웃의 헤더는 페이지 이동에도 유지되므로 마운트 한 번만 조회하면 다른 탭의 환불·지급을 놓친다.
  assert.ok(balanceEffect.length > 0, 'balance effect exists')
  assert.match(balanceEffect, /\}, \[isLoggedIn, pathname\]\)$/)
  assert.doesNotMatch(header, /\}, \[isLoggedIn\]\)/)
  assert.match(balanceEffect, /fetch\('\/api\/credits\/balance', \{ cache: 'no-store' \}\)/)
  assert.match(balanceEffect, /document\.addEventListener\('visibilitychange', handleVisibilityChange\)/)
  assert.match(balanceEffect, /document\.removeEventListener\('visibilitychange', handleVisibilityChange\)/)
  assert.match(balanceEffect, /document\.visibilityState === 'visible'\)\s*\{\s*refreshBalance\(\)/)
  // 창을 나란히 띄운 경우에는 visibilitychange가 없으므로 창 focus에서도 다시 조회한다.
  assert.match(balanceEffect, /window\.addEventListener\('focus', refreshBalance\)/)
  assert.match(balanceEffect, /window\.removeEventListener\('focus', refreshBalance\)/)
})

test('only the latest balance response is applied and purchase events win over in-flight fetches', () => {
  assert.match(balanceEffect, /const requestId = \+\+balanceRequestRef\.current/)
  assert.match(balanceEffect, /requestId === balanceRequestRef\.current && typeof data\?\.balance === 'number'/)
  // 구매 이벤트 값은 그대로 반영하고, 진행 중인 조회 응답이 덮지 못하게 순번을 올린다.
  assert.match(
    balanceEffect,
    /typeof balance === 'number'\) \{\s*balanceRequestRef\.current \+= 1\s*setCreditBalance\(balance\)/
  )
  // 정리할 때 순번을 올려 이전 페이지의 늦은 응답을 버린다.
  assert.match(balanceEffect, /return \(\) => \{\s*balanceRequestRef\.current \+= 1/)
  assert.match(balanceEffect, /window\.removeEventListener\('credit-balance-updated', handleBalanceUpdated\)/)
})
