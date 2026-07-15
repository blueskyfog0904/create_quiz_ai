import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const routeUrl = new URL('../src/app/preview/scholarly-library/page.tsx', import.meta.url)
const componentUrl = new URL('../src/components/features/landing/ScholarlyLibraryPreview.tsx', import.meta.url)

test('scholarly library preview is isolated in a dedicated route and component', () => {
  assert.equal(existsSync(routeUrl), true, 'preview route must exist')
  assert.equal(existsSync(componentUrl), true, 'preview component must exist')
})

test('scholarly library preview exposes the complete education workflow', () => {
  const source = existsSync(componentUrl) ? readFileSync(componentUrl, 'utf8') : ''

  assert.match(source, /지문 아카이브/)
  assert.match(source, /AI 문제 생성/)
  assert.match(source, /문항 관리/)
  assert.match(source, /시험지 제작/)
  assert.match(source, /PDF/)
  assert.match(source, /Word/)
  assert.match(source, /HWPX/)
})

test('scholarly library preview links to existing english workspace flows', () => {
  const source = existsSync(componentUrl) ? readFileSync(componentUrl, 'utf8') : ''

  assert.match(source, /\/english\/generate\/personal/)
  assert.match(source, /\/english\/library\/purchased/)
  assert.match(source, /\/english\/library\/exam-papers/)
  assert.doesNotMatch(source, /MainLandingView|WorkspaceLandingView/)
  assert.doesNotMatch(source, /'use client'/)
})
