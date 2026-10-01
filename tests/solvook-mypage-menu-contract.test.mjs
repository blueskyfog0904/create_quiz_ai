import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

// docs/mypage-hover-menu-plan.md 5절: 헤더 '마이페이지' hover 드롭다운
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const menuPath = '../src/app/preview/solvook-concept/_components/mypage-menu.tsx'
const menu = existsSync(new URL(menuPath, import.meta.url)) ? read(menuPath) : ''
const header = read('../src/app/preview/solvook-concept/_components/preview-header.tsx')

function pageFileFor(href) {
  const path = href.split('?')[0]
  if (path === '/pricing') return '../src/app/pricing/page.tsx'
  return `../src/app/(solvook)${path}/page.tsx`
}

test('every menu link resolves to an existing page', () => {
  const hrefs = [...menu.matchAll(/href: '([^']+)'/g)].map((match) => match[1])
  assert.deepEqual(hrefs, [
    '/mypage',
    '/mypage/credits',
    '/pricing',
    '/mypage/payments',
    '/mypage/history',
    '/mypage/profile',
    '/mypage/support',
  ])
  assert.match(menu, /href: libraryHref/)
  for (const href of [...hrefs, '/library']) {
    assert.ok(existsSync(new URL(pageFileFor(href), import.meta.url)), `${href} page.tsx exists`)
  }
  assert.doesNotMatch(menu, /\/mypage\/withdraw|회원 탈퇴/)
})

test('mypage link navigates while a separate chevron button is the menu trigger', () => {
  assert.match(menu, /<Link\s+href="\/mypage"/)
  assert.match(menu, /<DropdownMenuTrigger asChild>\s+<button\s/)
  assert.match(menu, /aria-label="마이페이지 메뉴 열기"/)
  assert.match(menu, /min-h-11 min-w-11/)
  assert.match(menu, /<DropdownMenu open=\{open\} onOpenChange=\{handleOpenChange\} modal=\{false\}>/)
  assert.match(menu, /align="end"/)
})

test('hover and mouse click open the menu only for mouse pointers', () => {
  assert.match(menu, /event\.pointerType === 'mouse'/)
  // 마우스 pointerdown은 Radix 토글을 막고 열기만 한다(닫기는 leave·바깥 클릭·Esc). 터치·펜은 Radix 기본 토글(N3)
  // click의 pointerType은 Safari에서 믿을 수 없어 열기 판정에 쓰지 않는다(B1)
  assert.match(menu, /onPointerDown=\{\(event\) => \{[\s\S]{0,200}?if \(event\.pointerType === 'mouse'\) \{\s+event\.preventDefault\(\)\s+openByMouse\(\)\s+\}/)
  const trigger = menu.slice(menu.indexOf('<DropdownMenuTrigger asChild>'), menu.indexOf('</DropdownMenuTrigger>'))
  assert.doesNotMatch(trigger, /onClick=/)
  assert.doesNotMatch(menu, /nativeEvent/)
  assert.match(menu, /터치·펜은 Radix 기본 토글/)
  assert.match(menu, /CLOSE_DELAY_MS = 150/)
  // Link 클릭·경로 변경 시 닫는다
  assert.match(menu, /<Link\s+href="\/mypage"[\s\S]{0,200}?onClick=\{closeMenu\}/)
  assert.match(menu, /if \(pathname !== lastPathname\) \{\s+setLastPathname\(pathname\)\s+setOpen\(false\)/)
})

test('Radix menu still composes the runtime onOpenAutoFocus prop into FocusScope', () => {
  // DropdownMenuContent 타입에 없는 onOpenAutoFocus를 런타임으로 넘긴다. Radix가 올라가 이 경로가 사라지면 여기서 깨진다.
  const radixMenu = read('../node_modules/@radix-ui/react-menu/dist/index.mjs')
  assert.match(radixMenu, /onOpenAutoFocus,\n/)
  assert.match(radixMenu, /onMountAutoFocus: composeEventHandlers\(onOpenAutoFocus, \(event\) => \{\s+event\.preventDefault\(\);\s+contentRef\.current\?\.focus\(/)
  const radixDropdown = read('../node_modules/@radix-ui/react-dropdown-menu/dist/index.mjs')
  assert.match(radixDropdown, /const \{ __scopeDropdownMenu, \.\.\.contentProps \} = props;[\s\S]{0,400}?MenuPrimitive\.Content,[\s\S]{0,200}?\.\.\.contentProps,/)
})

test('menu does not steal focus or flicker when opened by hover', () => {
  assert.match(menu, /onInteractOutside=\{\(event\) => \{\s+if \(anchorRef\.current\?\.contains\(event\.target as Node\)\) \{\s+event\.preventDefault\(\)/)
  // 타입에 없는 onOpenAutoFocus는 런타임 prop으로 넘긴다(Radix Menu 2.1.16 MenuContentImpl이 FocusScope에 합성)
  assert.match(menu, /onOpenAutoFocus: \(event: Event\) => \{\s+if \(isHoverMode\) \{\s+event\.preventDefault\(\)/)
  assert.match(menu, /\{\.\.\.hoverOpenAutoFocusProps\}/)
  assert.match(menu, /onCloseAutoFocus=\{\(event\) => \{\s+if \(isHoverMode\) \{\s+event\.preventDefault\(\)/)
  // Radix 항목은 pointermove에서 focus(), pointerleave(onItemLeave)에서 content.focus()를 부른다. hover 모드에서는 둘 다 막는다(N1)
  assert.match(menu, /const preventHoverFocus = \(event: PointerEvent<HTMLElement>\) => \{\s+if \(isHoverMode\) \{\s+event\.preventDefault\(\)/)
  assert.match(menu, /onPointerMove: preventHoverFocus,\s+onPointerLeave: preventHoverFocus,/)
  assert.match(menu, /hover:bg-\[var\(--studio-background\)\]/)
  // hover로 연 상태에서 chevron 키보드 진입(N2)
  assert.match(menu, /if \(open && isHoverMode && \['ArrowDown', 'Enter', ' '\]\.includes\(event\.key\)\) \{\s+event\.preventDefault\(\)/)
  assert.match(menu, /focusFirstItem\(\)/)
  assert.match(menu, /querySelector<HTMLElement>\('\[role="menuitem"\]:not\(\[data-disabled\]\)'\)/)
})

test('logout is a separated coral item using the existing logout flow', () => {
  assert.match(menu, /<DropdownMenuSeparator/)
  assert.match(menu, /fetch\('\/api\/auth\/logout', \{ method: 'POST' \}\)/)
  assert.match(menu, /window\.location\.href = '\/login\?logout=success'/)
  assert.match(menu, /toast\.error\('로그아웃에 실패했습니다\.'\)/)
  assert.match(menu, /bg-\[var\(--studio-highlight\)\] [^"]*text-\[var\(--studio-ink\)\] [^"]*font-extrabold/)
  assert.match(menu, /<LogOut /)
  assert.match(menu, /isLoggingOut \? '로그아웃 중…' : '로그아웃'/)
  assert.match(menu, /event\.preventDefault\(\)\s+void handleLogout\(\)/)
})

test('menu uses Studio tokens only', () => {
  assert.notEqual(menu, '', 'mypage-menu.tsx exists')
  assert.doesNotMatch(menu, /#[0-9a-fA-F]{3,8}\b/)
  assert.doesNotMatch(menu, /\b(?:bg|text|border|ring)-(?:red|orange|slate|gray)-/)
  for (const radius of menu.match(/rounded-\[[^\]]+\]/g) ?? []) {
    assert.match(radius, /^rounded-\[var\(--studio-radius-/)
  }
  assert.match(menu, /min-h-11/)
  for (const word of ['선생님', '학생', 'AI 문제생성', '문제은행', '라이브러리']) {
    assert.ok(!menu.includes(word), `no ${word}`)
  }
})

test('header renders MypageMenu and keeps credit and cart badge code', () => {
  assert.match(header, /import \{ MypageMenu \} from '\.\/mypage-menu'/)
  assert.match(header, /<MypageMenu libraryHref=\{libraryHref\} \/>/)
  assert.doesNotMatch(header, /href="\/mypage"/)
  assert.doesNotMatch(header, /UserRound/)
  assert.doesNotMatch(header, /라이브러리/)
  assert.match(header, /<MarketCartIndicator/)
  assert.match(header, /href="\/mypage\/credits"/)
  assert.match(header, /\{creditBalance\.toLocaleString\(\)\} 크레딧/)
})
