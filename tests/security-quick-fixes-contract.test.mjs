import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { readTaxonomySettingsSource } from './helpers/product-admin-sources.mjs'

// 출시 전 작업 순서표 1번 묶음(보안 즉시 조치, 2026-11-20)
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('로그인·가입 로그에 이메일·휴대폰을 남기지 않는다', () => {
  const actions = read('src/app/auth/actions.ts')
  for (const line of actions.split('\n').filter((entry) => /console\.(log|warn|info)/.test(entry))) {
    assert.doesNotMatch(line, /\$\{\s*(email|phone)\s*\}|,\s*(email|phone)\s*\)/, line.trim())
  }
})

test('관리자 비밀번호 최소 길이는 공용 상수 12자를 화면·API·서버가 함께 쓴다', () => {
  assert.match(read('src/lib/admin-accounts-shared.ts'), /export const ADMIN_PASSWORD_MIN_LENGTH = 12/)
  for (const path of [
    'src/app/api/admin/admin-accounts/route.ts',
    'src/app/api/admin/admin-accounts/[userId]/route.ts',
    'src/app/api/admin/my-password/route.ts',
    'src/lib/admin-accounts-server.ts',
    'src/app/(admin)/admin/admin-accounts/admin-accounts-client.tsx',
    'src/app/(admin)/admin/my-password/my-password-client.tsx',
  ]) {
    const source = read(path)
    assert.match(source, /ADMIN_PASSWORD_MIN_LENGTH/, path)
    assert.doesNotMatch(source, /\.min\(8\b|length < 8\b|8자 이상/, path)
  }
})

test('서비스 롤 클라이언트는 서버 전용이다', () => {
  assert.match(read('src/lib/supabase/bypass.ts'), /^\/\/[^\n]*\nimport 'server-only'/)
})

test('서브상품 카테고리 slug와 파일 유형 code는 만든 뒤에 바꿀 수 없다(서버·화면)', () => {
  const server = read('src/lib/market-items-server.ts')
  assert.match(server, /normalizeText\(input\.slug\) !== existing\.slug\) \{\s+throw new Error\('서브상품 카테고리의 slug는 만든 뒤에 바꿀 수 없습니다/)
  assert.match(server, /if \(nextCode !== existing\.code\) \{\s+throw new Error\('파일 유형의 코드는 만든 뒤에 바꿀 수 없습니다/)
  assert.doesNotMatch(server, /payload\.slug = /)
  assert.doesNotMatch(server, /payload\.code = nextCode/)
  // 19번: 구성·파일 유형 설정은 '상품 표시 설정' [구성·파일 유형] 탭으로 옮겼다(slug·code 는 만든 뒤 읽기만)
  const client = readTaxonomySettingsSource()
  assert.match(client, /placeholder="예: workbook" readOnly=\{Boolean\(editingCategoryId\)\} disabled=\{Boolean\(editingCategoryId\)\}/)
  assert.match(client, /placeholder="예: pdf" readOnly=\{Boolean\(editingFileTypeId\)\} disabled=\{Boolean\(editingFileTypeId\)\}/)
})
