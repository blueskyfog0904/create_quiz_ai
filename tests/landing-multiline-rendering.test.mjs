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

test('workspace landing admin editor uses a textarea for the hero title field', () => {
  const landingPagesClientSource = readFileSync(
    new URL('../src/app/(admin)/admin/landing-pages/landing-pages-client.tsx', import.meta.url),
    'utf8'
  )

  assert.match(landingPagesClientSource, /<Label>제목<\/Label>[\s\S]*?<Textarea[\s\S]*value=\{activeWorkspaceConfig\.title\}/)
})
