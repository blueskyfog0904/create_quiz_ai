import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

// docs/mypage-hover-menu-plan.md 5절: 헤더 '마이페이지' hover 드롭다운
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const menuPath = '../src/app/preview/solvook-concept/_components/mypage-menu.tsx'
const menu = existsSync(new URL(menuPath, import.meta.url)) ? read(menuPath) : ''
const header = read('../src/app/preview/solvook-concept/_components/preview-header.tsx')
const tokens = read('../src/styles/studio-tokens.css')

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

const trigger = menu.includes('<DropdownMenuTrigger asChild>')
  ? menu.slice(menu.indexOf('<DropdownMenuTrigger asChild>'), menu.indexOf('</DropdownMenuTrigger>'))
  : ''

test('the mypage link itself is the menu trigger (no chevron button)', () => {
  assert.match(menu, /<DropdownMenuTrigger asChild>\s+<Link\s+href="\/mypage"/)
  assert.doesNotMatch(menu, /<button|ChevronDown|마이페이지 메뉴 열기/)
  assert.match(menu, /<DropdownMenu open=\{open\} onOpenChange=\{handleOpenChange\} modal=\{false\}>/)
  assert.match(menu, /align="end"/)
  // 링크 + 메뉴 trigger는 비표준 패턴이라 여는 방법을 sr-only로 안내한다
  assert.match(trigger, /aria-describedby=\{hintId\}/)
  assert.match(menu, /const hintId = useId\(\)/)
  assert.match(menu, /<span id=\{hintId\} className="sr-only">아래 화살표 키로 마이페이지 메뉴를 열 수 있습니다\.<\/span>/)
})

test('pointerdown never toggles the menu; hover opens for mouse pointers only', () => {
  // 모든 pointerType에서 Radix 토글을 건너뛴다. click은 그대로 발생해 Link가 이동한다(Safari pointerType 문제 회피)
  const pointerDown = trigger.match(/onPointerDown=\{\(event\) => \{[\s\S]+?\}\}/)?.[0] ?? ''
  assert.match(pointerDown, /event\.preventDefault\(\)/)
  assert.doesNotMatch(pointerDown, /pointerType|openByMouse/)
  // pointerType 판정은 hover enter/leave 두 곳뿐이다
  assert.deepEqual(menu.match(/event\.pointerType [!=]== 'mouse'/g), ["event.pointerType === 'mouse'", "event.pointerType !== 'mouse'"])
  assert.doesNotMatch(menu, /nativeEvent/)
  assert.match(menu, /const handleMouseEnter = \(event: PointerEvent<HTMLElement>\) => \{\s+if \(event\.pointerType === 'mouse'\) \{\s+openByMouse\(\)/)
  assert.match(menu, /CLOSE_DELAY_MS = 150/)
  // Link 클릭·경로 변경 시 닫는다
  assert.match(trigger, /<Link\s+href="\/mypage"[\s\S]{0,300}?onClick=\{closeMenu\}/)
  assert.match(menu, /if \(pathname !== lastPathname\) \{\s+setLastPathname\(pathname\)\s+setOpen\(false\)/)
})

test('link trigger handles Enter itself and enters the menu with ArrowDown or Space', () => {
  const keyDown = trigger.slice(trigger.indexOf('onKeyDown='))
  // Radix가 Enter를 토글로 쓰며 막으므로 이동을 직접 실행한다. repeat keydown도 항상 막고 click만 1회(R3 N1)
  assert.match(keyDown, /if \(event\.key === 'Enter'\) \{[\s\S]{0,300}?event\.preventDefault\(\)\s+if \(!event\.repeat\) \{/)
  assert.doesNotMatch(keyDown, /'Enter' && !event\.repeat|if \(!event\.repeat\) \{\s+event\.preventDefault/)
  assert.match(keyDown, /if \(event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey\) \{\s+window\.open\('\/mypage', '_blank', 'noopener'\)\s+\} else \{\s+event\.currentTarget\.click\(\)/)
  // 닫힘이면 Radix 기본(열고 첫 항목), 열림(hover 포함)이면 첫 항목으로 진입
  assert.match(keyDown, /if \(open && \(event\.key === 'ArrowDown' \|\| event\.key === ' '\)\) \{\s+event\.preventDefault\(\)[\s\S]{0,120}?setIsHoverMode\(false\)\s+focusFirstItem\(\)/)
})

test('Radix menu still composes the runtime onOpenAutoFocus prop into FocusScope', () => {
  // DropdownMenuContent 타입에 없는 onOpenAutoFocus를 런타임으로 넘긴다. Radix가 올라가 이 경로가 사라지면 여기서 깨진다.
  const radixMenu = read('../node_modules/@radix-ui/react-menu/dist/index.mjs')
  assert.match(radixMenu, /onOpenAutoFocus,\n/)
  assert.match(radixMenu, /onMountAutoFocus: composeEventHandlers\(onOpenAutoFocus, \(event\) => \{\s+event\.preventDefault\(\);\s+contentRef\.current\?\.focus\(/)
  const radixDropdown = read('../node_modules/@radix-ui/react-dropdown-menu/dist/index.mjs')
  assert.match(radixDropdown, /const \{ __scopeDropdownMenu, \.\.\.contentProps \} = props;[\s\S]{0,400}?MenuPrimitive\.Content,[\s\S]{0,200}?\.\.\.contentProps,/)
})

test('Radix trigger runs our handlers first and skips its toggle when defaultPrevented', () => {
  // Link(child) 핸들러 → Trigger 핸들러 순서(Slot 병합), Trigger는 composeEventHandlers로 defaultPrevented면 Radix 처리를 건너뛴다.
  const radixDropdown = read('../node_modules/@radix-ui/react-dropdown-menu/dist/index.mjs')
  assert.match(radixDropdown, /onPointerDown: composeEventHandlers\(props\.onPointerDown, \(event\) => \{[\s\S]{0,200}?context\.onOpenToggle\(\);/)
  assert.match(radixDropdown, /onKeyDown: composeEventHandlers\(props\.onKeyDown, \(event\) => \{[\s\S]{0,300}?if \(\["Enter", " ", "ArrowDown"\]\.includes\(event\.key\)\) event\.preventDefault\(\);/)
  const primitive = read('../node_modules/@radix-ui/primitive/dist/index.mjs')
  assert.match(primitive, /originalEventHandler\?\.\(event\);\s+if \(checkForDefaultPrevented === false \|\| !event\.defaultPrevented\) \{\s+return ourEventHandler\?\.\(event\);/)
  const nestedSlot = '../node_modules/@radix-ui/react-primitive/node_modules/@radix-ui/react-slot/dist/index.mjs'
  const slot = read(existsSync(new URL(nestedSlot, import.meta.url)) ? nestedSlot : '../node_modules/@radix-ui/react-slot/dist/index.mjs')
  assert.match(slot, /const result = childPropValue\(\.\.\.args\);\s+slotPropValue\(\.\.\.args\);/)
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
  assert.match(menu, /focusFirstItem\(\)/)
  assert.match(menu, /querySelector<HTMLElement>\('\[role="menuitem"\]:not\(\[data-disabled\]\)'\)/)
})

test('logout is a separated coral item using the existing logout flow', () => {
  assert.match(menu, /<DropdownMenuSeparator/)
  assert.match(menu, /fetch\('\/api\/auth\/logout', \{ method: 'POST' \}\)/)
  assert.match(menu, /window\.location\.href = '\/login\?logout=success'/)
  assert.match(menu, /toast\.error\('로그아웃에 실패했습니다\.'\)/)
  // 로그아웃은 배경 음영이 아니라 글자색(코랄 레드 계열)으로 강조한다.
  assert.match(menu, /text-\[var\(--studio-highlight-text\)\] [^"]*font-extrabold/)
  assert.doesNotMatch(menu, /bg-\[var\(--studio-highlight\)\]/)
  assert.match(tokens, /--studio-highlight-text: color-mix\(in srgb, var\(--studio-highlight\) 75%, black\);/)
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
