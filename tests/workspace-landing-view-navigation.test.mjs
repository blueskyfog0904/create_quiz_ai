import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const workspaceLandingViewSource = readFileSync(
  new URL('../src/components/features/landing/WorkspaceLandingView.tsx', import.meta.url),
  'utf8'
)

test('workspace landing CTAs keep resolved public routes for guests', () => {
  assert.match(workspaceLandingViewSource, /const primaryHref = quickEntry\.primaryHref/)
  assert.match(workspaceLandingViewSource, /const secondaryHref = quickEntry\.secondaryHref/)
  assert.doesNotMatch(workspaceLandingViewSource, /\/login\?next=/)
})
