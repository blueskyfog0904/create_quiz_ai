import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import '../src/components/features/passages/node-test-register.mjs'

import {
  ADMIN_SIDEBAR_LABEL_MAX_LENGTH,
  isAdminSidebarLabelKey,
  normalizeAdminSidebarNavigationConfig,
  resolveAdminSidebarMenuItems,
  resolveAdminSidebarNavigationNodes,
} from '../src/lib/admin-sidebar.ts'

const sidebarClient = readFileSync(new URL('../src/components/layout/admin-sidebar-client.tsx', import.meta.url), 'utf8')
const sidebarServer = readFileSync(new URL('../src/lib/admin-sidebar-server.ts', import.meta.url), 'utf8')
const menuActions = readFileSync(new URL('../src/app/(admin)/admin/menu-management/actions.ts', import.meta.url), 'utf8')
const menuManagementClient = readFileSync(
  new URL('../src/app/(admin)/admin/menu-management/menu-management-client.tsx', import.meta.url),
  'utf8'
)

test('바꾼 메뉴 이름은 메뉴 주소·대메뉴 id에만 붙고, 빈 이름·모르는 키는 버린다', () => {
  const normalized = normalizeAdminSidebarNavigationConfig({
    items: [],
    labels: {
      '/admin/main-ad-settings': '  메인 광고  ',
      market: '마켓',
      '/admin/footer': '   ',
      '/not-real': '없는 메뉴',
      '/admin/users': 'x'.repeat(ADMIN_SIDEBAR_LABEL_MAX_LENGTH + 5),
    },
  })

  assert.deepEqual(normalized.labels, {
    '/admin/main-ad-settings': '메인 광고',
    market: '마켓',
    '/admin/users': 'x'.repeat(ADMIN_SIDEBAR_LABEL_MAX_LENGTH),
  })
  assert.equal(isAdminSidebarLabelKey('questionBank'), true)
  assert.equal(isAdminSidebarLabelKey('/not-real'), false)
})

test('사이드바는 바꾼 이름을 보여 주고 기본 이름도 함께 알고 있다', () => {
  const config = { items: [], labels: { '/admin/main-ad-settings': '메인 광고', market: '마켓' } }
  const item = resolveAdminSidebarMenuItems('korean', config).find((candidate) => candidate.href === '/admin/main-ad-settings')
  assert.equal(item.name, '메인 광고')
  assert.equal(item.defaultName, '(임시)메인광고설정')

  const marketGroup = resolveAdminSidebarNavigationNodes('korean', config).find((node) => node.type === 'group' && node.id === 'market')
  assert.equal(marketGroup.name, '마켓')
  assert.equal(marketGroup.defaultName, '문제마켓')

  const untouched = resolveAdminSidebarMenuItems('korean', config).find((candidate) => candidate.href === '/admin/users')
  assert.equal(untouched.name, '사용자 관리')
})

test('순서 저장은 이름을 지우지 않고, 이름 저장은 관리자만 가능하다', () => {
  assert.match(sidebarServer, /persistAdminSidebarNavigationConfig\(\{ items: config\.items, labels: current\.labels \}, workspaceSubject\)/)
  assert.match(sidebarServer, /export async function saveAdminSidebarMenuLabel/)
  assert.match(menuActions, /export async function renameAdminSidebarMenuAction[\s\S]*?await requireAdmin\(\)[\s\S]*?isAdminSidebarLabelKey\(key\)/)
  // 메뉴관리 화면이 순서를 옮길 때 이름을 떨어뜨리지 않는다
  assert.equal((menuManagementClient.match(/setAdminSidebarConfig\(\(current\) => \(\{\n\s+\.\.\.current,/g) ?? []).length, 2)
})

test('사이드바 메뉴 옆 연필 버튼으로 이름을 바꾼다 (Enter 저장, Esc 취소)', () => {
  assert.match(sidebarClient, /aria-label=\{`\$\{currentName\} 이름 바꾸기`\}/)
  assert.match(sidebarClient, /<Pencil className="h-3\.5 w-3\.5" \/>/)
  assert.match(sidebarClient, /renderMenuLabelEditButton\(item\.href, item\.name, active\)/)
  assert.match(sidebarClient, /renderMenuLabelEditButton\(node\.id, node\.name, false, 'heading'\)/)
  assert.match(sidebarClient, /renameAdminSidebarMenuAction\(key, labelToSave, workspaceSubject\)/)
  assert.match(sidebarClient, /event\.key === 'Escape'/)
  assert.match(sidebarClient, /비우고 저장하면 기본 이름/)
})
