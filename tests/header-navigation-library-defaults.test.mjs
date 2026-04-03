import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getWorkspaceDefaultHeaderNavigationConfig,
  withWorkspaceHeaderDefaults,
} from '../src/lib/header-navigation.ts'

test('workspace defaults still seed library children for a fresh english config', () => {
  const config = getWorkspaceDefaultHeaderNavigationConfig('english')
  const libraryItem = config.items.find((item) => item.href === '/library')

  assert.ok(libraryItem)
  assert.equal(libraryItem.children.length > 0, true)
})

test('explicitly emptied library children are preserved instead of being re-seeded', () => {
  const nextConfig = withWorkspaceHeaderDefaults({
    logoText: 'AI영어문제팩토리',
    items: [
      {
        id: 'menu-library-english',
        title: '영어 라이브러리',
        href: '/library',
        isActive: true,
        children: [],
      },
    ],
  }, 'english')

  const libraryItem = nextConfig.items.find((item) => item.href === '/library')

  assert.ok(libraryItem)
  assert.deepEqual(libraryItem.children, [])
})
