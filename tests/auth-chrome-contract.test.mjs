import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

// docs/auth-header-plan.md 4절: 로그인·회원가입 화면에 최신(솔북) 헤더·푸터
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const authLayoutPath = '../src/app/(auth)/layout.tsx'
const authLayout = existsSync(new URL(authLayoutPath, import.meta.url)) ? read(authLayoutPath) : ''
const header = read('../src/app/preview/solvook-concept/_components/preview-header.tsx')

test('(auth) layout renders the Studio shell with the Solvook header, one main and the Solvook footer', () => {
  assert.notEqual(authLayout, '', '(auth)/layout.tsx exists')
  assert.match(authLayout, /<StudioThemeShell>/)
  assert.match(authLayout, /<PreviewHeader isLoggedIn=\{Boolean\(userId\)\} userId=\{userId\} cartCount=\{cartCount\} \/>/)
  assert.match(authLayout, /<SolvookFooter/)
  assert.equal(authLayout.match(/<main/g)?.length, 1)
  assert.match(authLayout, /<main className="flex-1">/)
  assert.doesNotMatch(authLayout, /initialSubject=/, 'subject defaults to korean like /terms')
  assert.doesNotMatch(authLayout, /#[0-9a-fA-F]{3,8}\b/)
})

test('login and admin login pages do not get the legacy global chrome', () => {
  assert.doesNotMatch(authLayout, /SiteChrome/)
  // 전역 크롬은 루트 template이 아니라 그 크롬을 쓰는 화면의 layout이 그린다
  assert.doesNotMatch(read('../src/app/template.tsx'), /<Header\b|SiteChrome/)
  assert.doesNotMatch(read('../src/app/(admin-auth)/admin/login/page.tsx'), /SiteChrome/)
})

test('header auth links keep the incoming next on /login and /signup', () => {
  assert.match(header, /const isAuthPage = pathname === '\/login' \|\| pathname === '\/signup'/)
  assert.match(header, /const currentLocation = isAuthPage\s+\? searchParams\.get\('next'\)\s+: `\$\{pathname \?\? '\/'\}\$\{searchParams\.toString\(\) \? `\?\$\{searchParams\.toString\(\)\}` : ''\}`/)
  assert.match(header, /buildAuthRedirectPath\(currentLocation, '\/login'\)/)
  assert.match(header, /buildAuthRedirectPath\(currentLocation, '\/signup'\)/)
})

// docs/admin-implementation-workplan.md W3-8a: 문제마켓 헤더 알림 벨은 로그인 상태에서만
test('market header renders the notification bell only when logged in', () => {
  const bell = read('../src/components/ui/notification-bell.tsx')
  assert.match(header, /import \{ NotificationBell \} from '@\/components\/ui\/notification-bell'/)
  assert.equal(header.match(/<NotificationBell\b/g)?.length, 2, 'mobile bar and desktop bar')
  // 모바일 상단: 장바구니 바로 앞, isLoggedIn && 안
  assert.match(header, /\{isLoggedIn && \(\s+<NotificationBell\b[^>]*\/>\s+\)\}\s+<MarketCartIndicator/)
  // 데스크톱: 로그인 분기 안, 크레딧 링크 앞
  assert.match(header, /\{isLoggedIn \? \(\s+<>\s+<NotificationBell\b[^>]*\/>\s+\{creditBalance !== null && \(\s+<Link\s+href="\/mypage\/credits"/)
  assert.doesNotMatch(header, /<NotificationBell\b[^>]*isAdmin/, 'member header does not pull admin counts')
  assert.match(bell, /<Button variant="ghost" size="icon" aria-label="알림"/)
})
