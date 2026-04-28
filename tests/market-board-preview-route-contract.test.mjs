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

test('board preview client presents a compact board-style list with purchase controls', () => {
  assert.equal(existsSync(previewClientPath), true, 'board preview client should exist')
  const source = readFileSync(previewClientPath, 'utf8')

  assert.match(source, /게시판형 디자인 테스트/, 'preview should clearly identify itself as a test design')
  assert.match(source, /선택 파일 결제/, 'preview should include the same purchase tray action as the live list')
  assert.match(source, /CreditConfirmationDialog/, 'preview should confirm credit payment before purchase')
  assert.match(source, /번호/, 'preview should include a board number column')
  assert.match(source, /자료명/, 'preview should include a title/material column')
  assert.match(source, /HWP & PDF/, 'preview should use the updated bundle label')
  assert.match(source, /border-t-2 border-slate-950/, 'preview table should use a strong board-like top divider')
  assert.match(source, /min-w-\[410px\]/, 'file column should be wide enough to keep purchase options on one line')
  assert.match(source, /flex-nowrap/, 'file choices should not wrap into multiple rows')
  assert.match(source, /md:grid-cols-\[1fr_auto_1fr\]/, 'pagination row should use balanced columns for centered navigation')
  assert.match(source, /justify-self-center/, 'pagination controls should be centered in the board')
  assert.match(source, /api\/market\/purchases\/batch/, 'preview should submit selected files to the batch purchase API')
})
