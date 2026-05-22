import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const generateSidebarSource = readFileSync(
  new URL('../src/app/(dashboard)/generate/generate-sidebar.tsx', import.meta.url),
  'utf8'
)
const workspaceSecondLevelSidebarSource = readFileSync(
  new URL('../src/components/layout/workspace-second-level-sidebar.tsx', import.meta.url),
  'utf8'
)
const workspaceChildMenuSidebarSource = readFileSync(
  new URL('../src/components/layout/workspace-child-menu-sidebar.tsx', import.meta.url),
  'utf8'
)
const menuManagementSource = readFileSync(
  new URL('../src/app/(admin)/admin/menu-management/menu-management-client.tsx', import.meta.url),
  'utf8'
)
const headerShellSource = readFileSync(
  new URL('../src/components/layout/header-shell-client.tsx', import.meta.url),
  'utf8'
)
const headerClientSource = readFileSync(
  new URL('../src/components/layout/header-client.tsx', import.meta.url),
  'utf8'
)
const marketSidebarSource = readFileSync(
  new URL('../src/app/(dashboard)/market/market-sidebar.tsx', import.meta.url),
  'utf8'
)
const librarySidebarSource = readFileSync(
  new URL('../src/app/(dashboard)/library/library-sidebar.tsx', import.meta.url),
  'utf8'
)

test('generate sidebar no longer hardcodes divider rendering', () => {
  assert.doesNotMatch(generateSidebarSource, /renderDividerBeforeItem/)
})

test('shared sidebar renderers honor item-level divider metadata', () => {
  assert.match(workspaceSecondLevelSidebarSource, /item\.showDividerBefore/)
  assert.match(workspaceChildMenuSidebarSource, /item\.showDividerBefore/)
})

test('menu management exposes divider options for second-level menus', () => {
  assert.match(menuManagementSource, /이 메뉴 앞에 구분선 표시/)
  assert.match(menuManagementSource, /showDividerBefore/)
  assert.match(menuManagementSource, /구분선/)
})


test('header second-level menus also honor divider metadata', () => {
  assert.match(headerShellSource, /shouldRenderChildDivider/)
  assert.match(headerShellSource, /child\.showDividerBefore/)
  assert.match(headerClientSource, /shouldRenderWorkspaceChildDivider/)
  assert.match(headerClientSource, /shouldRenderWorkspaceChildDivider/)
})

test('header dropdown uses a subtle shadow to avoid halo over body content', () => {
  assert.match(headerShellSource, /shadow-md shadow-slate-900\/10/)
  assert.doesNotMatch(headerShellSource, /headerDropdownContentClassName = '.*shadow-xl shadow-slate-200\/70/)
})

test('market and library sidebars use the shared second-level sidebar component', () => {
  assert.match(marketSidebarSource, /WorkspaceSecondLevelSidebar/)
  assert.match(librarySidebarSource, /WorkspaceSecondLevelSidebar/)
  assert.doesNotMatch(librarySidebarSource, /WorkspaceChildMenuSidebar/)
})
