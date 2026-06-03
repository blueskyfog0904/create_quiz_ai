import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const workspaceLandingView = readFileSync(
  new URL('../src/components/features/landing/WorkspaceLandingView.tsx', import.meta.url),
  'utf8'
)

test('workspace landing feature cards resolve to their target service routes', () => {
  assert.match(workspaceLandingView, /function getWorkspaceLandingFeatureHref/)
  assert.match(workspaceLandingView, /index === 0[\s\S]+quickEntry\.primaryHref/)
  assert.match(workspaceLandingView, /index === 1[\s\S]+quickEntry\.secondaryHref[\s\S]+workspaceHref\(subject, 'market'\)/)
  assert.match(workspaceLandingView, /index === 2[\s\S]+workspaceHref\(subject, 'libraryPurchased'\)/)
  assert.match(workspaceLandingView, /index === 3[\s\S]+workspaceHref\(subject, 'libraryExamPapers'\)/)
})

test('workspace landing feature cards render as accessible links', () => {
  assert.match(workspaceLandingView, /config\.features\.map\(\(feature, index\)/)
  assert.match(workspaceLandingView, /const featureHref = getWorkspaceLandingFeatureHref\(subject, index, quickEntry\)/)
  assert.match(workspaceLandingView, /<Link[\s\S]+href=\{featureHref\}[\s\S]+aria-label=\{`\$\{feature\.title\} 페이지로 이동`\}/)
  assert.match(workspaceLandingView, /group block h-full rounded-3xl/)
  assert.match(workspaceLandingView, /group-hover:-translate-y-0\.5/)
})
