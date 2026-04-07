import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import { normalizeHeaderNavigationConfig } from '../src/lib/header-navigation.ts'

const generateMenuSource = readFileSync(
  new URL('../src/lib/generate-menu.ts', import.meta.url),
  'utf8'
)
const marketMenuSource = readFileSync(
  new URL('../src/lib/market-menu.ts', import.meta.url),
  'utf8'
)
const generateSidebarSource = readFileSync(
  new URL('../src/app/(dashboard)/generate/generate-sidebar.tsx', import.meta.url),
  'utf8'
)
const workspaceSecondLevelSidebarSource = readFileSync(
  new URL('../src/components/layout/workspace-second-level-sidebar.tsx', import.meta.url),
  'utf8'
)
const workspaceChildSidebarSource = readFileSync(
  new URL('../src/components/layout/workspace-child-menu-sidebar.tsx', import.meta.url),
  'utf8'
)

test('generate menu source exposes divider metadata helper and child mapping', () => {
  assert.match(generateMenuSource, /getGenerateMenuEntryShowDividerBefore/)
  assert.match(generateMenuSource, /showDividerBefore: getGenerateMenuEntryShowDividerBefore\(entry\)/)
  assert.match(generateMenuSource, /return entry\.entry_type === 'personal_generate'/)
})

test('market menu source exposes divider metadata helper and child mapping', () => {
  assert.match(marketMenuSource, /getMarketMenuEntryShowDividerBefore/)
  assert.match(marketMenuSource, /showDividerBefore: getMarketMenuEntryShowDividerBefore\(entry\)/)
})

test('header navigation normalization preserves child divider metadata', () => {
  const config = normalizeHeaderNavigationConfig({
    logoText: '테스트',
    items: [
      {
        id: 'library',
        title: '라이브러리',
        href: '/library',
        isActive: true,
        children: [
          { id: 'purchased', title: '문제 관리', href: '/purchased', isActive: true, showDividerBefore: true },
        ],
      },
    ],
  })

  assert.equal(config.items[0].children[0].showDividerBefore, true)
})

test('sidebar renderers use showDividerBefore metadata and generate sidebar no longer hardcodes divider', () => {
  assert.match(workspaceSecondLevelSidebarSource, /item\.showDividerBefore/)
  assert.match(workspaceChildSidebarSource, /item\.showDividerBefore/)
  assert.doesNotMatch(generateSidebarSource, /renderDividerBeforeItem/)
})
