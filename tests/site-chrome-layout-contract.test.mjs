import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// 예전 전역 헤더·푸터(SiteChrome)는 그 크롬을 쓰는 화면의 layout에서만 그린다.
// 루트 template에서 그리면 공개 마켓·관리자 화면에서도 서버가 헤더(DB 조회 여러 번)를 만들고 버린다.
const CHROME_LAYOUTS = [
  'src/app/(dashboard)/layout.tsx',
  'src/app/[workspaceSubject]/layout.tsx',
  'src/app/dashboard/layout.tsx',
  'src/app/legacy/layout.tsx',
  'src/app/preview/design-system/layout.tsx',
  'src/app/preview/scholarly-library/layout.tsx',
]
const OWN_CHROME_LAYOUTS = [
  'src/app/(solvook)/layout.tsx',
  'src/app/(auth)/layout.tsx',
  'src/app/(admin)/admin/layout.tsx',
  'src/app/pricing/layout.tsx',
  'src/app/checkout/layout.tsx',
  'src/app/terms/layout.tsx',
  'src/app/preview/solvook-concept/layout.tsx',
]

test('전역 헤더·푸터는 루트 template이 아니라 SiteChrome layout에서만 그린다', () => {
  const template = read('src/app/template.tsx')
  assert.doesNotMatch(template, /<Header\b|<Footer\b|SiteChrome|PathAwareSiteChrome/)
  assert.doesNotMatch(read('src/app/layout.tsx'), /<Header\b|<Footer\b|SiteChrome/)
  assert.equal(existsSync(new URL('../src/components/layout/path-aware-site-chrome.tsx', import.meta.url)), false)

  const siteChrome = read('src/components/layout/site-chrome.tsx')
  assert.match(siteChrome, /<Header \/>/)
  assert.match(siteChrome, /<Footer \/>/)
  assert.doesNotMatch(siteChrome, /'use client'/)
})

test('예전 크롬을 쓰던 화면은 layout에서 SiteChrome으로 감싼다', () => {
  for (const path of CHROME_LAYOUTS) {
    assert.match(read(path), /<SiteChrome>\{children\}<\/SiteChrome>/, path)
  }
})

test('자체 헤더를 쓰는 화면은 SiteChrome을 쓰지 않는다', () => {
  for (const path of OWN_CHROME_LAYOUTS) {
    assert.doesNotMatch(read(path), /SiteChrome/, path)
  }
})

test('충전·결제 화면은 마켓 layout을 그대로 쓴다', () => {
  for (const path of ['src/app/pricing/layout.tsx', 'src/app/checkout/layout.tsx']) {
    assert.match(read(path), /^export \{ default \} from '@\/app\/\(solvook\)\/layout'\s*$/, path)
  }
  // layout이 이미 <main>으로 감싸므로 결과 화면은 <main>을 다시 두지 않는다.
  for (const path of ['src/app/checkout/payapp/result/page.tsx', 'src/app/checkout/kakaopay/result/page.tsx']) {
    assert.doesNotMatch(read(path), /<main\b/, path)
  }
  // 충전이 완료된 분기에서만 머리말의 보유 크레딧을 갱신하고, 실패는 결과 표시에 영향을 주지 않는다.
  assert.match(
    read('src/app/checkout/payapp/result/result-client.tsx'),
    /if \(body\.status === 'completed'\) \{\s*fetch\('\/api\/credits\/balance', \{ cache: 'no-store' \}\)[\s\S]*?new CustomEvent\('credit-balance-updated', \{ detail: \{ balance: data\.balance \} \}\)[\s\S]*?\.catch\(\(\) => undefined\)/
  )
})

test('결제 문의 연락처는 코드에 적지 않고 Footer 설정 값을 쓴다', () => {
  const page = read('src/app/checkout/page.tsx')
  const client = read('src/app/checkout/checkout-client.tsx')
  assert.match(page, /getSolvookFooterData\(\)/)
  assert.match(page, /supportContact=\{supportContact\}/)
  assert.match(client, /\{supportContact \? <p>결제 문의: \{supportContact\}<\/p> : null\}/)
  assert.doesNotMatch(client, /@[a-z0-9-]+\.(com|kr|net)/i)
})

