import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import '../src/components/features/passages/node-test-register.mjs'
import {
  isAllowedStorefrontHref,
  normalizeStorefrontHeaderLinks,
  validateStorefrontHeaderLinks,
} from '../src/lib/storefront-header-links.ts'

// 출시 전 작업 순서표 3번 묶음(상단 메뉴 연결, 2026-11-20)
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('헤더 링크 주소는 사이트 안 주소(/…)나 https 주소만 받는다', () => {
  assert.equal(isAllowedStorefrontHref('/pricing'), true)
  assert.equal(isAllowedStorefrontHref('https://example.com/event'), true)
  for (const bad of ['', '//evil.com', 'http://example.com', 'javascript:alert(1)', 'pricing', 'mailto:a@b.c', '/\\evil.com', '/\\/evil.com', '/\t/evil.com', '/\n/evil.com', '/a b']) {
    assert.equal(isAllowedStorefrontHref(bad), false, bad)
  }
})

test('정규화는 깨진 항목·허용하지 않는 주소를 버리고 최대 5개만 남긴다', () => {
  const links = normalizeStorefrontHeaderLinks({
    links: [
      { label: ' 크레딧 충전 ', href: '/pricing', isActive: true, emphasis: true },
      { label: '', href: '/x' },
      { label: '나쁜 링크', href: 'javascript:alert(1)' },
      null,
      { label: '이벤트', href: 'https://example.com', isActive: false },
      ...Array.from({ length: 6 }, (_, index) => ({ label: `링크${index}`, href: `/l${index}` })),
    ],
  })
  assert.equal(links.length, 5)
  assert.deepEqual(links[0], { label: '크레딧 충전', href: '/pricing', isActive: true, emphasis: true })
  assert.deepEqual(links[1], { label: '이벤트', href: 'https://example.com', isActive: false, emphasis: false })
  assert.deepEqual(normalizeStorefrontHeaderLinks(null), [])
  assert.match(validateStorefrontHeaderLinks([{ label: '', href: '/a', isActive: true, emphasis: false }]), /이름/)
  assert.match(validateStorefrontHeaderLinks([{ label: 'a', href: '//x', isActive: true, emphasis: false }]), /주소/)
  assert.equal(validateStorefrontHeaderLinks([{ label: 'a', href: '/a', isActive: true, emphasis: false }]), null)
})

test('회원 헤더는 크레딧 충전을 코드로 그리지 않고 DB 링크 목록을 그린다', () => {
  const header = read('src/app/preview/solvook-concept/_components/preview-header.tsx')
  assert.doesNotMatch(header, /href="\/pricing"/)
  assert.doesNotMatch(header, /<span>크레딧 충전<\/span>/)
  assert.equal(header.match(/headerLinks\.map\(\(link, index\) =>/g).length, 2)
  assert.match(header, /isExternalStorefrontHref\(link\.href\) \? \{ target: '_blank', rel: 'noopener noreferrer' \}/)
  const layout = read('src/app/layout.tsx')
  assert.match(layout, /getActiveStorefrontHeaderLinks\(\)/)
  assert.match(layout, /<StorefrontHeaderLinksProvider links=\{headerLinks\}>/)
})

test('관리자 상단 메뉴: site.manage 화면·저장, 서버 검사 뒤 저장, 저장 뒤 기록, 사이드바 사이트 설정 묶음', () => {
  assert.match(read('src/app/(admin)/admin/storefront-menu/page.tsx'), /requireAdminPagePermission\('site\.manage'\)/)
  const actions = read('src/app/(admin)/admin/storefront-menu/actions.ts')
  assert.match(actions, /assertAdminActionPermission\('site\.manage'\)[\s\S]*?validateStorefrontHeaderLinks\(candidate\)[\s\S]*?saveStorefrontHeaderLinks\(candidate\)[\s\S]*?action: 'storefront_header_links_update'/)
  const sidebar = read('src/lib/admin-sidebar.ts')
  assert.match(sidebar, /'\/admin\/storefront-menu': 'site\.manage'/)
  assert.match(sidebar, /ADMIN_SITE_MENU_HREFS = \[[\s\S]*?'\/admin\/storefront-menu',\n\] as const/)
  const migration = read('supabase/migrations/20261120110000_storefront_header_links.sql')
  assert.match(migration, /"label": "크레딧 충전", "href": "\/pricing", "isActive": true, "emphasis": true/)
  assert.match(migration, /ON CONFLICT \(key\) DO NOTHING;/)
  assert.match(read('supabase/rollback/20261120110000_storefront_header_links_down.sql'), /WHERE key = 'storefront_header_links';/)
})

test('메뉴관리 화면은 회원 헤더 링크가 상단 메뉴에서 관리된다고 알린다', () => {
  assert.match(read('src/app/(admin)/admin/menu-management/menu-management-client.tsx'), /<Link href="\/admin\/storefront-menu"[^>]*>상단 메뉴<\/Link> 화면에서 관리합니다/)
})
