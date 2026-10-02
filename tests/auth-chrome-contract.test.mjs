import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

// docs/auth-header-plan.md 4절: 로그인·회원가입 화면에 최신(솔북) 헤더·푸터
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const authLayoutPath = '../src/app/(auth)/layout.tsx'
const authLayout = existsSync(new URL(authLayoutPath, import.meta.url)) ? read(authLayoutPath) : ''
const pathAware = read('../src/components/layout/path-aware-site-chrome.tsx')
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

test('path-aware chrome skips the legacy chrome only for exact /login and /signup', () => {
  assert.match(pathAware, /pathname === '\/login' \|\| pathname === '\/signup'/)
  assert.doesNotMatch(pathAware, /startsWith\('\/login|startsWith\('\/signup/)
  // 관리자 로그인은 기존 /admin/ 제외로 처리된다
  assert.match(pathAware, /pathname\.startsWith\('\/admin\/'\)/)
})

test('header auth links keep the incoming next on /login and /signup', () => {
  assert.match(header, /const isAuthPage = pathname === '\/login' \|\| pathname === '\/signup'/)
  assert.match(header, /const currentLocation = isAuthPage\s+\? searchParams\.get\('next'\)\s+: `\$\{pathname \?\? '\/'\}\$\{searchParams\.toString\(\) \? `\?\$\{searchParams\.toString\(\)\}` : ''\}`/)
  assert.match(header, /buildAuthRedirectPath\(currentLocation, '\/login'\)/)
  assert.match(header, /buildAuthRedirectPath\(currentLocation, '\/signup'\)/)
})
