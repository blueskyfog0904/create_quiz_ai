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
  assert.match(pageSource, /requireAdmin\('\/admin\/market-main-settings'\)/)
  assert.match(pageSource, /getMarketHomeAdminData\(workspaceSubject\)/)
  assert.match(
    pageSource,
    /<MarketMainSettingsClient[\s\S]*key=\{workspaceSubject\}[\s\S]*workspaceSubject=\{workspaceSubject\}/
  )
  assert.match(routeSource, /auth\.getUser\(\)/)
  assert.match(routeSource, /\.from\('profiles'\)/)
  assert.match(routeSource, /is_admin/)
  assert.match(routeSource, /UNAUTHORIZED/)
  assert.match(routeSource, /FORBIDDEN/)
  assert.match(routeSource, /UNAUTHORIZED[\s\S]*401/)
  assert.match(routeSource, /FORBIDDEN[\s\S]*403/)
})

test('market home settings POST strictly validates subject-scoped allowlists and persists the shared setting', () => {
  assert.match(routeSource, /isWorkspaceSubject/)
  assert.match(routeSource, /getMarketHomeAdminOptions\(workspaceSubject\)/)
  assert.match(routeSource, /validateMarketHomeConfig/)
  assert.match(routeSource, /upsertWorkspaceSetting/)
  assert.match(routeSource, /MARKET_HOME_SETTING_KEY/)
  assert.match(routeSource, /INVALID_INPUT/)
  assert.match(routeSource, /INVALID_INPUT[\s\S]*400/)
  assert.match(routeSource, /success:\s*true/)
  assert.match(routeSource, /revalidatePath\('\/admin\/market-main-settings'\)/)
  assert.match(routeSource, /revalidatePath\('\/preview\/solvook-concept'\)/)
  assert.match(serverSource, /export async function getMarketHomeAdminOptions/)
  assert.match(serverSource, /\.eq\('workspace_subject', workspaceSubject\)/)
  assert.match(serverSource, /\.eq\('is_visible', true\)/)
  assert.match(serverSource, /\.eq\('is_active', true\)/)
})

test('market home settings UI exposes only the approved controls and management links', () => {
  assert.match(clientSource, /\(임시\) 문제마켓 메인 관리/)
  assert.match(clientSource, /AdminWorkspaceSwitcher/)
  assert.match(clientSource, /Switch/)
  assert.match(clientSource, /Checkbox/)
  assert.match(clientSource, /ArrowUp/)
  assert.match(clientSource, /ArrowDown/)
  assert.match(clientSource, /withAdminWorkspaceSubject\('\/api\/admin\/market-main-settings'/)
  assert.match(clientSource, /\/admin\/market\/products/)
  assert.match(clientSource, /\/admin\/menu-management/)
  assert.match(clientSource, /\/admin\/source-configs/)
  assert.match(clientSource, /\/admin\/main-ad-settings/)
  assert.match(clientSource, /결손/)
  assert.doesNotMatch(clientSource, /manualItemIds|sectionOrder|drag-and-drop/)
})
