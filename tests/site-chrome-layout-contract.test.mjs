import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// 예전 전역 헤더·푸터(SiteChrome)는 그 크롬을 쓰는 화면의 layout에서만 그린다.
// 루트 template에서 그리면 공개 마켓·관리자 화면에서도 서버가 헤더(DB 조회 여러 번)를 만들고 버린다.
const CHROME_LAYOUTS = [
  'src/app/(dashboard)/layout.tsx',
  'src/app/[workspaceSubject]/layout.tsx',
  'src/app/checkout/layout.tsx',
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
