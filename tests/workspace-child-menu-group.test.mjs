import assert from 'node:assert/strict'
import test from 'node:test'

import { buildWorkspaceChildMenuGroup } from '../src/lib/workspace-child-menu.ts'

test('grouped sidebar model keeps a non-clickable parent shell even with one child', () => {
  const group = buildWorkspaceChildMenuGroup({
    parentTitle: '국어문제마켓',
    parentHref: '/market',
    items: [
      {
        id: 'market-entry-mock-exams',
        title: '모의고사',
        href: '/market/mock-exams',
        isActive: true,
      },
    ],
    currentPath: '/market/mock-exams',
  })

  assert.equal(group.parent.title, '국어문제마켓')
  assert.equal(group.parent.clickable, false)
  assert.equal(group.defaultExpanded, true)
  assert.equal(group.items.length, 1)
  assert.equal(group.items[0].clickable, true)
  assert.equal(group.items[0].active, true)
})
