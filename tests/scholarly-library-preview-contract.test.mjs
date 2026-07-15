import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const routeUrl = new URL('../src/app/preview/scholarly-library/page.tsx', import.meta.url)
const componentUrl = new URL('../src/components/features/landing/ScholarlyLibraryPreview.tsx', import.meta.url)

test('scholarly library preview is isolated in a dedicated route and component', () => {
  assert.equal(existsSync(routeUrl), true, 'preview route must exist')
  assert.equal(existsSync(componentUrl), true, 'preview component must exist')
})

test('scholarly library preview presents ai english generation and the problem market as equal pillars', () => {
  const source = existsSync(componentUrl) ? readFileSync(componentUrl, 'utf8') : ''

  assert.match(source, /AI 영어문제 생성/)
  assert.match(source, /현재 영어만 제공/)
  assert.match(source, /문제마켓/)
  assert.match(source, /내신 문제 전문가/)
  assert.match(source, /무료 샘플/)
  assert.match(source, /개별 구매/)
  assert.match(source, /전체 패키지/)
  assert.match(source, /PDF/)
  assert.match(source, /HWP/)
})

test('scholarly library preview links to existing english workspace flows', () => {
  const source = existsSync(componentUrl) ? readFileSync(componentUrl, 'utf8') : ''

  assert.match(source, /\/english\/generate\/personal/)
  assert.match(source, /\/english\/library\/purchased/)
  assert.match(source, /\/english\/market/)
  assert.match(source, /\/korean\/market/)
  assert.match(source, /href="\/english\/market"[\s\S]*?영어문제마켓 둘러보기/)
  assert.match(source, /href="\/korean\/market"[\s\S]*?국어문제마켓 둘러보기/)
  assert.match(source, /bg-\[#b7791f\][^>]*>[\s\S]*?<Link href="\/korean\/market">국어 문제마켓<\/Link>/)
  assert.doesNotMatch(source, /MainLandingView|WorkspaceLandingView/)
  assert.doesNotMatch(source, /'use client'/)
})
