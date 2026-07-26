import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import '../src/components/features/passages/node-test-register.mjs'

import {
  ADMIN_QUESTION_BANK_MENU_HREFS,
  DEFAULT_ADMIN_SIDEBAR_NAVIGATION_CONFIG,
  moveAdminSidebarHref,
  moveAdminSidebarNavigationNode,
  normalizeAdminSidebarNavigationConfig,
  resolveAdminSidebarMenuItems,
  resolveAdminSidebarNavigationNodes,
} from '../src/lib/admin-sidebar.ts'

const adminSidebarSource = readFileSync(
  new URL('../src/components/layout/admin-sidebar.tsx', import.meta.url),
  'utf8'
)
const adminSidebarClientSource = readFileSync(
  new URL('../src/components/layout/admin-sidebar-client.tsx', import.meta.url),
  'utf8'
)
const menuManagementSource = readFileSync(
  new URL('../src/app/(admin)/admin/menu-management/menu-management-client.tsx', import.meta.url),
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
    items: ['/admin/passages', '/admin/footer', '/admin/menu-management'],
  })

  assert.equal(items[0].href, '/admin/passages')
  assert.equal(items[0].name, '국어지문 관리')
  assert.equal(items[0].icon, 'bookOpen')
  assert.equal(items[1].href, '/admin/footer')
  assert.equal(items[1].name, 'Footer 설정')
  assert.equal(items[2].href, '/admin/menu-management')
  assert.equal(items[2].name, '메뉴관리')
  assert.equal(items.some((item) => item.href === '/admin/users'), true)
})

test('admin sidebar includes AI API connection management near AI problem type settings', () => {
  const defaultItems = DEFAULT_ADMIN_SIDEBAR_NAVIGATION_CONFIG.items
  const problemTypeIndex = defaultItems.indexOf('/admin/problem-types')
  const connectionIndex = defaultItems.indexOf('/admin/ai-connections')
  const generationRunsIndex = defaultItems.indexOf('/admin/ai-question-generation-runs')
  const items = resolveAdminSidebarMenuItems('english')
  const connectionItem = items.find((item) => item.href === '/admin/ai-connections')
  const generationRunsItem = items.find((item) => item.href === '/admin/ai-question-generation-runs')

  assert.notEqual(problemTypeIndex, -1)
  assert.notEqual(connectionIndex, -1)
  assert.notEqual(generationRunsIndex, -1)
  assert.equal(connectionIndex, problemTypeIndex + 1)
  assert.equal(generationRunsIndex, connectionIndex + 1)
  assert.ok(connectionItem)
  assert.equal(connectionItem.name, 'AI API 연결 관리')
  assert.equal(connectionItem.icon, 'settings')
  assert.ok(generationRunsItem)
  assert.equal(generationRunsItem.name, 'AI 생성 로그')
  assert.equal(generationRunsItem.icon, 'fileText')
})

test('admin sidebar exposes the temporary main ad settings page', () => {
  const defaultItems = DEFAULT_ADMIN_SIDEBAR_NAVIGATION_CONFIG.items
  const landingIndex = defaultItems.indexOf('/admin/landing-pages')
  const mainAdIndex = defaultItems.indexOf('/admin/main-ad-settings')
  const item = resolveAdminSidebarMenuItems('english')
    .find((entry) => entry.href === '/admin/main-ad-settings')

  assert.notEqual(mainAdIndex, -1)
  assert.equal(mainAdIndex, landingIndex + 1)
  assert.ok(item)
  assert.equal(item.name, '(임시)메인광고설정')
})

test('resolveAdminSidebarNavigationNodes groups question bank admin services under one parent', () => {
  const nodes = resolveAdminSidebarNavigationNodes('english', {
    items: [
      '/admin/questions/upload',
      '/admin/users',
      '/admin/questions',
      '/admin/question-bank/problem-types',
      '/admin/question-bank/options',
      '/admin/question-bank/backfill',
    ],
  })

  const questionBankNode = nodes.find((node) => node.type === 'group' && node.id === 'questionBank')

  assert.ok(questionBankNode)
  assert.equal(questionBankNode.name, '문제은행')
  assert.equal(questionBankNode.icon, 'database')
  assert.deepEqual(
    questionBankNode.items.map((item) => item.href),
    [
      '/admin/questions/upload',
      '/admin/questions',
      '/admin/question-bank/problem-types',
      '/admin/question-bank/options',
      '/admin/question-bank/backfill',
    ]
  )
  assert.deepEqual([...ADMIN_QUESTION_BANK_MENU_HREFS], [
    '/admin/questions',
    '/admin/questions/upload',
    '/admin/question-bank/options',
    '/admin/question-bank/problem-types',
    '/admin/question-bank/backfill',
  ])
  assert.equal(nodes.some((node) => node.type === 'item' && node.item.href === '/admin/questions'), false)
  assert.equal(nodes.some((node) => node.type === 'item' && node.item.href === '/admin/questions/upload'), false)
})

test('resolveAdminSidebarMenuItems remains a flat compatibility resolver', () => {
  const items = resolveAdminSidebarMenuItems('english', {
    items: ['/admin/questions', '/admin/questions/upload'],
  })

  assert.equal(Array.isArray(items), true)
  assert.equal(items[0].href, '/admin/questions')
  assert.equal(items[1].href, '/admin/questions/upload')
  assert.equal(items.some((item) => item.name === '문제 목록'), true)
  assert.equal(items.some((item) => item.name === '문제 업로드'), true)
})

test('moveAdminSidebarNavigationNode moves the question bank group as one href block', () => {
  const items = [
    '/admin',
    '/admin/questions',
    '/admin/questions/upload',
    '/admin/question-bank/options',
    '/admin/question-bank/problem-types',
    '/admin/question-bank/backfill',
    '/admin/passages',
  ]
  const nodes = resolveAdminSidebarNavigationNodes('english', { items })
  const moved = moveAdminSidebarNavigationNode(items, nodes, 'questionBank', 'down')

  assert.deepEqual(moved.slice(0, 2), ['/admin', '/admin/passages'])
  assert.deepEqual(moved.slice(2, 7), [...ADMIN_QUESTION_BANK_MENU_HREFS])
  assert.equal(Array.isArray(moved), true)
})

test('moveAdminSidebarNavigationNode condenses scattered question bank hrefs into one moved block', () => {
  const items = [
    '/admin/questions/upload',
    '/admin/users',
    '/admin/questions',
    '/admin/question-bank/problem-types',
    '/admin/question-bank/options',
    '/admin/question-bank/backfill',
    '/admin/passages',
  ]
  const nodes = resolveAdminSidebarNavigationNodes('english', { items })
  const moved = moveAdminSidebarNavigationNode(items, nodes, 'questionBank', 'down')
  const nonQuestionBankHrefs = moved.filter((href) => !ADMIN_QUESTION_BANK_MENU_HREFS.includes(href))

  assert.deepEqual(moved.slice(0, 6), [
    '/admin/users',
    '/admin/questions/upload',
    '/admin/questions',
    '/admin/question-bank/problem-types',
    '/admin/question-bank/options',
    '/admin/question-bank/backfill',
  ])
  assert.deepEqual(nonQuestionBankHrefs.slice(0, 2), ['/admin/users', '/admin/passages'])
  assert.equal(new Set(moved).size, moved.length)
})

test('moveAdminSidebarHref reorders only question bank child href peers', () => {
  const items = [
    '/admin',
    '/admin/questions',
    '/admin/questions/upload',
    '/admin/question-bank/options',
    '/admin/passages',
  ]
  const moved = moveAdminSidebarHref(
    items,
    '/admin/questions/upload',
    ['/admin/questions', '/admin/questions/upload', '/admin/question-bank/options'],
    'up'
  )

  assert.deepEqual(moved, [
    '/admin',
    '/admin/questions/upload',
    '/admin/questions',
    '/admin/question-bank/options',
    '/admin/passages',
  ])
})

test('admin sidebar server wrapper preloads navigation configs for both subjects', () => {
  assert.match(adminSidebarSource, /getAdminSidebarNavigationConfig\('english'\)/)
  assert.match(adminSidebarSource, /getAdminSidebarNavigationConfig\('korean'\)/)
  assert.match(adminSidebarSource, /AdminSidebarClient/)
})

test('admin sidebar client renders grouped question bank navigation and preserves subject query', () => {
  assert.match(adminSidebarClientSource, /resolveAdminSidebarNavigationNodes/)
  assert.match(adminSidebarClientSource, /aria-current=\{active \? 'page' : undefined\}/)
  assert.match(adminSidebarClientSource, /href=\{withAdminWorkspaceSubject\(item\.href, workspaceSubject\)\}/)
  assert.doesNotMatch(adminSidebarClientSource, /subjectScopedAdminHrefs/)
})

test('menu management presents question bank entries as an admin sidebar group without changing storage shape', () => {
  assert.match(menuManagementSource, /관리자 패널 메뉴 순서/)
  assert.match(menuManagementSource, /resolveAdminSidebarNavigationNodes/)
  assert.match(menuManagementSource, /문제은행/)
  assert.match(menuManagementSource, /saveAdminSidebarNavigationConfigAction/)
  assert.match(menuManagementSource, /관리자 패널 순서 저장/)
  assert.match(menuManagementSource, /handleMoveAdminSidebarNode/)
  assert.match(menuManagementSource, /handleMoveAdminSidebarChild/)
  assert.match(menuManagementSource, /aria-label=\{`\$\{node\.name\} 대메뉴 위로 이동`\}/)
  assert.match(menuManagementSource, /aria-label=\{`\$\{node\.name\} \$\{item\.name\} 위로 이동`\}/)
})
