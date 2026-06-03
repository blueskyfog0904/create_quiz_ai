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

test('workspace landing linked areas communicate clickability with hover and focus states', () => {
  assert.match(workspaceLandingView, /group\/entry rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white\/70 focus-visible:ring-offset-2 focus-visible:ring-offset-blue-700/)
  assert.match(workspaceLandingView, /hover:-translate-y-0\.5 hover:border-white\/40 hover:bg-white\/15 hover:text-white hover:shadow-lg/)
  assert.match(workspaceLandingView, /group-hover\/entry:translate-x-0\.5/)
  assert.match(workspaceLandingView, /group\/guide rounded-2xl[\s\S]+hover:border-white\/30 hover:bg-white\/15 hover:ring-white\/25/)
  assert.match(workspaceLandingView, /group-hover\/guide:translate-x-0\.5 group-hover\/guide:-translate-y-0\.5/)
  assert.match(workspaceLandingView, /focus-visible:ring-sky-500/)
  assert.match(workspaceLandingView, /group-hover:border-sky-200 group-hover:shadow-xl group-hover:shadow-sky-100\/70/)
  assert.match(workspaceLandingView, /opacity-80 transition-opacity duration-200 group-hover:opacity-100/)
  assert.match(workspaceLandingView, /group-hover:bg-blue-600 group-hover:shadow-blue-200\/70/)
})
