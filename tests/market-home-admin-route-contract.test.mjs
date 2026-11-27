import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const routeSource = readFileSync(
  new URL('../src/app/api/admin/market-main-settings/route.ts', import.meta.url),
  'utf8'
)
const pageSource = readFileSync(
  new URL('../src/app/(admin)/admin/market-main-settings/page.tsx', import.meta.url),
  'utf8'
)
const clientSource = readFileSync(
  new URL('../src/app/(admin)/admin/market-main-settings/market-main-settings-client.tsx', import.meta.url),
  'utf8'
)
const serverSource = readFileSync(
  new URL('../src/lib/market-home-server.ts', import.meta.url),
  'utf8'
)

test('market home admin page and API both enforce the admin boundary', () => {
  assert.match(pageSource, /await requireAdminPagePermission\('storefront\.edit'\)/)
  assert.match(pageSource, /getMarketHomeAdminData\(workspaceSubject\)/)
  assert.match(
    pageSource,
    /<MarketMainSettingsClient[\s\S]*key=\{workspaceSubject\}[\s\S]*workspaceSubject=\{workspaceSubject\}/
  )
  assert.match(routeSource, /requireAdminApiPermission\(permission\)/)
  assert.match(routeSource, /permission: AdminPermissionRequirement = 'storefront\.edit'/)
  assert.match(routeSource, /UNAUTHORIZED/)
  assert.match(routeSource, /FORBIDDEN/)
  assert.match(routeSource, /guard\.status === 401 \? 'UNAUTHORIZED'/)
  assert.match(routeSource, /guard\.status === 403 \? 'FORBIDDEN'/)
})

test('market home settings POST strictly validates the config and persists the shared setting', () => {
  assert.match(routeSource, /isWorkspaceSubject/)
  assert.doesNotMatch(routeSource, /getMarketHomeAdminOptions|validateAllowlist/)
  // 22번 3-4: 판 2 초안 검사 + 조건부 저장(revision). 통째로 덮어쓰는 upsert 는 쓰지 않는다.
  assert.match(routeSource, /validateMarketHomeDraft/)
  assert.doesNotMatch(routeSource, /upsertWorkspaceSetting/)
  assert.match(routeSource, /saveMarketHomeConfig\(\{ workspaceSubject, expectedRevision, draft, actorId: user\.id \}\)/)
  assert.match(routeSource, /REVISION_CONFLICT', error\.message, 409/)
  assert.match(routeSource, /revalidateTag\(MARKET_HOME_CACHE_TAG, \{ expire: 0 \}\)/)
  assert.match(routeSource, /MARKET_HOME_SETTING_KEY/)
  assert.match(routeSource, /INVALID_INPUT/)
  assert.match(routeSource, /INVALID_INPUT[\s\S]*400/)
  assert.match(routeSource, /success:\s*true/)
  assert.match(routeSource, /revalidatePath\('\/admin\/market-main-settings'\)/)
  assert.match(routeSource, /revalidatePath\('\/preview\/solvook-concept'\)/)
  assert.doesNotMatch(serverSource, /getMarketHomeAdminOptions/)
  assert.match(serverSource, /\.eq\('workspace_subject', workspaceSubject\)/)
  assert.doesNotMatch(serverSource, /is_visible/)
  assert.match(serverSource, /\.eq\('is_active', true\)/)
})

test('market home settings UI exposes only the approved controls and management links', () => {
  assert.match(clientSource, /\(임시\) 문제마켓 메인 관리/)
  assert.match(clientSource, /AdminWorkspaceSwitcher/)
  assert.match(clientSource, /Switch/)
  assert.doesNotMatch(clientSource, /문제마켓 카테고리|menuEntryIds/)
  assert.match(clientSource, /withAdminWorkspaceSubject\('\/api\/admin\/market-main-settings'/)
  assert.match(clientSource, /\/admin\/market\/products/)
  assert.match(clientSource, /\['\/admin\/market-categories', '카테고리 관리'\]/)
  // 운영하지 않는 화면(메뉴관리·출처 관리)으로 가는 링크는 두지 않는다
  assert.doesNotMatch(clientSource, /\/admin\/menu-management|\/admin\/source-configs/)
  assert.match(clientSource, /\/admin\/main-ad-settings/)
  assert.doesNotMatch(clientSource, /교재·출처|교재 출처 노출|출처 경로|결손/)
  assert.doesNotMatch(clientSource, /manualItemIds|sectionOrder|drag-and-drop/)
})
