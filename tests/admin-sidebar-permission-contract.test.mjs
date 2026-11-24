import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import '../src/components/features/passages/node-test-register.mjs'
import { load } from './helpers/market-images-harness.mjs'

import {
  ADMIN_SIDEBAR_MENU_REQUIREMENTS,
  DEFAULT_ADMIN_SIDEBAR_NAVIGATION_CONFIG,
} from '../src/lib/admin-sidebar.ts'

// 메뉴·버튼 숨김(U3-1): 권한이 없는 메뉴와 버튼은 그리지 않는다. 막는 일은 화면·API 가드가 하고, 이것은 보이는 쪽을 맞춘다.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const { buildAdminAccess, meetsAdminRequirement } = load('src/lib/admin-permissions.ts')

const USER_ID = '00000000-0000-4000-8000-000000000001'
const owner = buildAdminAccess(USER_ID, { is_admin: true, admin_role: 'owner' }, [])
const staff = (...permissions) => buildAdminAccess(
  USER_ID,
  { is_admin: true, admin_role: 'staff' },
  permissions.map((permission) => ({ permission, limits: {} }))
)
// 사이드바 서버 컴포넌트와 같은 판정(꺼진 기능 제외)
const visibleMenus = (access) => DEFAULT_ADMIN_SIDEBAR_NAVIGATION_CONFIG.items.filter((href) => {
  const requirement = ADMIN_SIDEBAR_MENU_REQUIREMENTS[href]
  return requirement !== undefined && meetsAdminRequirement(access, requirement)
})

// 화면 파일의 가드 요구 조건을 읽는다. 대시보드는 관리자면 누구나(requireAdminPanelUser).
function pageRequirement(href) {
  const path = `src/app/(admin)${href}/page.tsx`
  assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `${href} 화면 파일이 있다`)
  const source = read(path)
  const match = source.match(/requireAdminPagePermission\((\[[^\]]*\]|'[^']+')\)/)
  if (!match) {
    assert.match(source, /await requireAdminPanelUser\(\)/, `${href}는 가드를 부른다`)
    return 'admin'
  }
  return match[1].startsWith('[')
    ? [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1])
    : match[1].slice(1, -1)
}

test('사이드바 메뉴마다 권한이 있고, 그 값은 화면 가드의 요구 조건과 같다', () => {
  assert.deepEqual(
    Object.keys(ADMIN_SIDEBAR_MENU_REQUIREMENTS).sort(),
    [...DEFAULT_ADMIN_SIDEBAR_NAVIGATION_CONFIG.items].sort(),
    '메뉴 목록과 권한 표의 주소가 같다'
  )
  for (const href of DEFAULT_ADMIN_SIDEBAR_NAVIGATION_CONFIG.items) {
    assert.deepEqual(ADMIN_SIDEBAR_MENU_REQUIREMENTS[href], pageRequirement(href), href)
  }
})

test('대표는 모든 메뉴, staff는 받은 권한의 메뉴와 대시보드만, 관리자 정보가 없으면 아무것도 보지 않는다', () => {
  assert.deepEqual(visibleMenus(owner), DEFAULT_ADMIN_SIDEBAR_NAVIGATION_CONFIG.items)
  assert.deepEqual(visibleMenus(null), [])
  assert.deepEqual(visibleMenus(staff()), ['/admin'])

  // 'CS 기본' 묶음
  assert.deepEqual(
    visibleMenus(staff('support.manage', 'orders.view', 'members.view', 'credits.view', 'refunds.market')),
    ['/admin', '/admin/users', '/admin/support', '/admin/credits', '/admin/refunds', '/admin/orders']
  )
  // 상품 권한만 — 상품·이미지·카테고리 메뉴
  assert.deepEqual(
    visibleMenus(staff('products.edit')),
    ['/admin', '/admin/market/products/new', '/admin/market/products', '/admin/market/images', '/admin/market-categories']
  )
  // 함께 필요한 권한이 빠지면(마켓 환불에 주문 조회 없음) 그 메뉴도 보이지 않는다.
  assert.deepEqual(visibleMenus(staff('refunds.market')), ['/admin'])
})

test('사이드바: 권한 없는 메뉴를 숨기고, 메뉴 이름 바꾸기는 site.manage일 때만 보인다', () => {
  const sidebar = read('src/components/layout/admin-sidebar.tsx')
  assert.match(sidebar, /const access = await getAdminAccess\(\)\.catch\(\(\) => null\)/)
  assert.match(sidebar, /requirement === undefined\s*\|\| !meetsAdminRequirement\(access, requirement\)/)
  assert.match(sidebar, /canRenameMenus=\{hasAdminPermission\(access, 'site\.manage'\)\}/)

  const client = read('src/components/layout/admin-sidebar-client.tsx')
  assert.match(client, /\{!collapsed && canRenameMenus \? renderMenuLabelEditButton\(slotId, item\.href, item\.name, active\) : null\}/)
  assert.match(client, /\{canRenameMenus \? renderMenuLabelEditButton\(node\.id, node\.labelKey, node\.name, false, 'heading'\) : null\}/)
  assert.match(client, /\{canRenameMenus \? renderMenuLabelEditButton\(node\.id, node\.labelKey, baseName, false, 'heading'\) : null\}/)
  // 메뉴·공통 묶음 제목·과목 묶음 제목 3곳. 모두 canRenameMenus 조건 안에서만 그린다.
  assert.equal(client.match(/renderMenuLabelEditButton\(/g).length, 3, '연필 버튼을 그리는 곳은 위 세 곳뿐이다')
  assert.match(read('src/app/(admin)/admin/menu-management/actions.ts'), /assertAdminActionPermission\('site\.manage'\)/)
})

test('크레딧 지급 버튼은 credits.grant일 때만 보인다(회원 목록·크레딧 관리)', () => {
  for (const [page, client] of [
    ['src/app/(admin)/admin/users/page.tsx', 'src/app/(admin)/admin/users/users-client.tsx'],
    ['src/app/(admin)/admin/credits/page.tsx', 'src/app/(admin)/admin/credits/credits-client.tsx'],
  ]) {
    assert.match(read(page), /canGrantCredits=\{hasAdminPermission\(access, 'credits\.grant'\)\}/, page)
    const source = read(client)
    // 10번: 회원 목록은 탈퇴 회원 줄에서도 버튼을 뺀다(DB가 MEMBER_WITHDRAWN 으로 거절).
    assert.match(source, /\{canGrantCredits(?: && !user\.withdrawn_at)? \? \(\s*(<div[^>]*>\s*)?<Button[\s\S]{0,400}크레딧 지급\s*<\/Button>/, client)
    assert.equal(source.match(/크레딧 지급\s*<\/Button>/g).length, 1, client)
  }
})

test('충전 판매 중지 버튼은 대표에게만 보인다(대시보드·환불 관리)', () => {
  const panel = read('src/components/admin/payment-sales-panel.tsx')
  assert.match(panel, /\{canStopSales \? \(\s*<Button[\s\S]{0,400}충전 판매 중지\s*<\/Button>\s*\) : null\}/)
  for (const page of ['src/app/(admin)/admin/page.tsx', 'src/app/(admin)/admin/refunds/page.tsx']) {
    assert.match(read(page), /canStopSales=\{hasAdminPermission\(access, 'owner'\)\}/, page)
  }
  assert.match(read('src/app/api/admin/payments/sales-stop/route.ts'), /requireAdminApiPermission\('owner'\)/)
})

test('상품 완전 삭제(폼 메뉴·목록 행 메뉴·선택 삭제)는 products.delete일 때만 보인다', () => {
  for (const page of ['src/app/(admin)/admin/market/products/page.tsx', 'src/app/(admin)/admin/market/products/new/page.tsx']) {
    assert.match(read(page), /canDeleteProducts=\{hasAdminPermission\(access, 'products\.delete'\)\}/, page)
  }
  const client = read('src/app/(admin)/admin/market/products/market-products-client.tsx')
  assert.match(client, /\{canDeleteProducts \? \(\s*<>\s*<DropdownMenuSeparator \/>\s*<DropdownMenuItem[^>]*onSelect=\{\(\) => void handleArchive\(\)\}/)
  assert.match(client, /\{canDeleteProducts \? \(\s*<>\s*\{status === 'published' \|\| isHidden \? <DropdownMenuSeparator \/> : null\}\s*<DropdownMenuItem[^>]*onSelect=\{\(\) => setDeleteTarget\(item\)\}/)
  assert.match(client, /\{canDeleteProducts \? \(\s*<Button[\s\S]{0,300}onClick=\{\(\) => setBulkDeleteTargetIds\(/)
  // 임시 업로드 안내는 보이지 않는 버튼을 누르라고 하지 않는다.
  assert.match(client, /\{canDeleteProducts\s*\? '상품 등록을 완료하지 않고 업로드 파일을 삭제하려면 등록 취소 및 파일 삭제를 눌러주세요\.'\s*: '[^']*상품 삭제 권한이 필요합니다[^']*'\}/)
  // 항목이 하나도 없는 더보기 메뉴는 그리지 않는다.
  assert.match(client, /\{status === 'published' \|\| isHidden \|\| canDeleteProducts \? \(\s*<DropdownMenu>/)
  // 삭제를 여는 곳은 이 셋뿐이다.
  assert.equal(client.match(/void handleArchive\(\)/g).length, 1)
  assert.equal(client.match(/setDeleteTarget\(item\)/g).length, 1)
  assert.equal(client.match(/setBulkDeleteTargetIds\(selectedItems/g).length, 1)
  assert.match(read('src/app/api/admin/market/items/[id]/route.ts'), /requireAdminUser\('products\.delete'\)/)
})
