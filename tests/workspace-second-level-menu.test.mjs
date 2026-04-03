import assert from 'node:assert/strict'
import test from 'node:test'

import { buildWorkspaceSecondLevelMenuItems } from '../src/lib/workspace-second-level-menu.ts'

test('market-style second-level menu keeps item order and active item without a parent shell row', () => {
  const items = buildWorkspaceSecondLevelMenuItems({
    currentPath: '/market/mock-exams',
    items: [
      { id: 'market-1', title: '모의고사', href: '/market/mock-exams', isActive: true },
      { id: 'market-2', title: '수능특강', href: '/market/entlec', isActive: true },
    ],
  })

  assert.deepEqual(
    items.map((item) => item.title),
    ['모의고사', '수능특강']
  )
  assert.equal(items[0].active, true)
  assert.equal(items[1].active, false)
})

test('generate-style second-level menu can move personal to the end and treat /generate/multi as active', () => {
  const items = buildWorkspaceSecondLevelMenuItems({
    currentPath: '/generate/multi',
    items: [
      { id: 'personal', title: '개인지문', href: '/generate/personal', isActive: true },
      { id: 'mock-exams', title: '모의고사', href: '/generate/boards/mock-exams', isActive: true },
    ],
    reorderItems: (input) => {
      const personal = input.find((item) => item.href === '/generate/personal') ?? null
      const others = input.filter((item) => item.href !== '/generate/personal')
      return personal ? [...others, personal] : input
    },
    isItemActive: (item, currentPath) => {
      if (item.href === '/generate/personal') {
        return currentPath === '/generate/personal' || currentPath === '/generate/multi'
      }

      return currentPath === item.href || currentPath.startsWith(`${item.href}/`)
    },
  })

  assert.deepEqual(
    items.map((item) => item.title),
    ['모의고사', '개인지문']
  )
  assert.equal(items[1].active, true)
})
