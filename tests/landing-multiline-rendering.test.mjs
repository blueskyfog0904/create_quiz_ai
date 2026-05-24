import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const mainLandingViewSource = readFileSync(
  new URL('../src/components/features/landing/MainLandingView.tsx', import.meta.url),
  'utf8'
)

const workspaceLandingViewSource = readFileSync(
  new URL('../src/components/features/landing/WorkspaceLandingView.tsx', import.meta.url),
  'utf8'
)

test('main landing view preserves multiline admin textarea content', () => {
  assert.match(mainLandingViewSource, /whitespace-pre-line/)
})

test('workspace landing view preserves multiline admin textarea content', () => {
  assert.match(workspaceLandingViewSource, /whitespace-pre-line/)
})

test('workspace landing hero copy starts aligned with the Quick Entry label', () => {
  assert.match(workspaceLandingViewSource, /mt-6 grid gap-10 lg:grid-cols-\[1\.4fr_0\.9fr\] lg:items-start/)
  assert.match(workspaceLandingViewSource, /<div className="lg:pt-6">[\s\S]*?<h1/)
})

test('workspace landing admin editor uses a textarea for the hero title field', () => {
  const landingPagesClientSource = readFileSync(
    new URL('../src/app/(admin)/admin/landing-pages/landing-pages-client.tsx', import.meta.url),
    'utf8'
  )

  assert.match(landingPagesClientSource, /<Label>제목<\/Label>[\s\S]*?<Textarea[\s\S]*value=\{activeWorkspaceConfig\.title\}/)
})

test('workspace landing admin editor exposes guide label and url controls', () => {
  const landingPagesClientSource = readFileSync(
    new URL('../src/app/(admin)/admin/landing-pages/landing-pages-client.tsx', import.meta.url),
    'utf8'
  )

  assert.match(landingPagesClientSource, /<Label>사용방법 가이드 명칭<\/Label>/)
  assert.match(landingPagesClientSource, /value=\{activeWorkspaceConfig\.guide\.label\}/)
  assert.match(landingPagesClientSource, /<Label>사용방법 가이드 주소<\/Label>/)
  assert.match(landingPagesClientSource, /value=\{activeWorkspaceConfig\.guide\.url\}/)
})
