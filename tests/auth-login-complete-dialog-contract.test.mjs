import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const loginPage = readFileSync(
  new URL('../src/app/(auth)/login/page.tsx', import.meta.url),
  'utf8'
)
const authCallback = readFileSync(
  new URL('../src/app/auth/callback/route.ts', import.meta.url),
  'utf8'
)
const rootTemplate = readFileSync(
  new URL('../src/app/template.tsx', import.meta.url),
  'utf8'
)
const dialogPath = new URL('../src/components/auth/login-complete-dialog.tsx', import.meta.url)
const loginCompleteDialog = existsSync(dialogPath) ? readFileSync(dialogPath, 'utf8') : ''

test('email login redirects with a one-time login success signal instead of pre-redirect toast', () => {
  assert.match(loginPage, /const nextUrl = new URL\(next, window\.location\.origin\)/)
  assert.match(loginPage, /nextUrl\.searchParams\.set\('login', 'success'\)/)
  assert.match(loginPage, /window\.location\.assign\(`\$\{nextUrl\.pathname\}\$\{nextUrl\.search\}\$\{nextUrl\.hash\}`\)/)
  assert.doesNotMatch(loginPage, /toast\.success\('로그인이 되었습니다\.'\)/)
})

test('kakao callback appends login success signal only for login flow', () => {
  assert.match(authCallback, /if \(!signupMode\) \{/)
  assert.match(authCallback, /nextUrl\.searchParams\.set\('login', 'success'\)/)
  assert.match(authCallback, /return NextResponse\.redirect\(nextUrl\.toString\(\)\)/)
})

test('root template mounts the login completion dialog globally', () => {
  assert.match(rootTemplate, /import \{ Suspense \} from 'react'/)
  assert.match(rootTemplate, /import \{ LoginCompleteDialog \} from '@\/components\/auth\/login-complete-dialog'/)
  assert.match(rootTemplate, /<Suspense fallback=\{null\}>\s*<LoginCompleteDialog \/>\s*<\/Suspense>/)
})

test('login completion dialog uses the shared success dialog pattern and clears the signal', () => {
  assert.ok(loginCompleteDialog, 'login complete dialog component should exist')
  assert.match(loginCompleteDialog, /useSearchParams/)
  assert.match(loginCompleteDialog, /searchParams\.get\('login'\) === 'success'/)
  assert.match(loginCompleteDialog, /DialogContent showCloseButton=\{false\} className="sm:max-w-md"/)
  assert.match(loginCompleteDialog, /CheckCircle2/)
  assert.match(loginCompleteDialog, /<DialogTitle>로그인 완료<\/DialogTitle>/)
  assert.match(loginCompleteDialog, /로그인이 완료되었습니다\./)
  assert.match(loginCompleteDialog, /nextParams\.delete\('login'\)/)
  assert.match(loginCompleteDialog, /router\.replace\(nextUrl, \{ scroll: false \}\)/)
})
