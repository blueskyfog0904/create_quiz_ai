import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import test from 'node:test'

const dashboardPreviewPagePath = 'src/app/(dashboard)/market/[slug]/board-preview/page.tsx'
const workspacePreviewPagePath = 'src/app/[workspaceSubject]/market/[slug]/board-preview/page.tsx'
const previewClientPath = 'src/app/(dashboard)/market/[slug]/market-board-preview-client.tsx'

test('board preview route is available under dashboard and workspace market paths', () => {
  assert.equal(existsSync(dashboardPreviewPagePath), true, 'dashboard board preview page should exist')
  assert.equal(existsSync(workspacePreviewPagePath), true, 'workspace-subject board preview proxy page should exist')

  const workspaceProxy = readFileSync(workspacePreviewPagePath, 'utf8')
  assert.match(workspaceProxy, /MarketBoardPreviewPage/, 'workspace route should proxy to the dashboard preview page')
  assert.match(workspaceProxy, /withWorkspaceSubjectSearchParams/, 'workspace route should preserve subject search params')
})

test('board preview route reuses the production market board component', () => {
  const previewPage = readFileSync(dashboardPreviewPagePath, 'utf8')

  assert.equal(existsSync(previewClientPath), false, 'preview-only board client should be removed after promotion')
  assert.match(previewPage, /MarketListboardClient/, 'preview route should render the shared production listboard client')
  assert.match(previewPage, /\.\.\/market-listboard-client/, 'preview route should import the shared production client')
  assert.doesNotMatch(previewPage, /market-board-preview-client/, 'preview route should not import a forked preview client')
})
