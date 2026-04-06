import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  DEFAULT_ADMIN_SIDEBAR_NAVIGATION_CONFIG,
  normalizeAdminSidebarNavigationConfig,
  resolveAdminSidebarMenuItems,
} from '../src/lib/admin-sidebar.ts'

const adminSidebarSource = readFileSync(
  new URL('../src/components/layout/admin-sidebar.tsx', import.meta.url),
  'utf8'
)

test('normalizeAdminSidebarNavigationConfig de-dupes saved hrefs and appends missing defaults', () => {
  const normalized = normalizeAdminSidebarNavigationConfig({
    items: [
      '/admin/passages',
      '/admin/passages',
      '/not-real',
      '/admin/questions',
    ],
  })

  const remainingDefaults = DEFAULT_ADMIN_SIDEBAR_NAVIGATION_CONFIG.items.filter(
    (href) => !['/admin/passages', '/admin/questions'].includes(href)
  )

  assert.deepEqual(normalized.items, [
    '/admin/passages',
    '/admin/questions',
    ...remainingDefaults,
  ])
})

test('resolveAdminSidebarMenuItems applies saved order and subject-specific labels', () => {
  const items = resolveAdminSidebarMenuItems('korean', {
    items: ['/admin/passages', '/admin/menu-management'],
  })

  assert.equal(items[0].href, '/admin/passages')
  assert.equal(items[0].name, '국어지문 관리')
  assert.equal(items[0].icon, 'bookOpen')
  assert.equal(items[1].href, '/admin/menu-management')
  assert.equal(items[1].name, '메뉴관리')
  assert.equal(items.some((item) => item.href === '/admin/users'), true)
})

test('admin sidebar server wrapper preloads navigation configs for both subjects', () => {
  assert.match(adminSidebarSource, /getAdminSidebarNavigationConfig\('english'\)/)
  assert.match(adminSidebarSource, /getAdminSidebarNavigationConfig\('korean'\)/)
  assert.match(adminSidebarSource, /AdminSidebarClient/)
})
