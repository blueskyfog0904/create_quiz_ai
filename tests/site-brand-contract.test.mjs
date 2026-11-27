import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import '../src/components/features/passages/node-test-register.mjs'
import { buildSiteTitleTemplate, normalizeSiteBrand, validateSiteBrand } from '../src/lib/site-brand.ts'

// 출시 전 작업 순서표 2번 묶음(사이트 기본 정보, 2026-11-20)
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

test('사이트 이름은 DB 설정을 정규화해 쓰고, 비어 있으면 탭 제목은 화면 이름만 남는다', () => {
  assert.deepEqual(normalizeSiteBrand(null), { name: '', description: '' })
  assert.deepEqual(normalizeSiteBrand({ name: '  예시 연구소 ', description: ' 소개 ' }), { name: '예시 연구소', description: '소개' })
  assert.equal(buildSiteTitleTemplate({ name: '예시 연구소', description: '' }), '%s | 예시 연구소')
  assert.equal(buildSiteTitleTemplate({ name: '', description: '' }), '%s')
  assert.equal(validateSiteBrand({ name: ' ', description: '' }), '사이트 이름을 입력해 주세요.')
  assert.equal(validateSiteBrand({ name: '예시', description: '' }), null)
})

test('회원 화면(헤더·탭 제목·하단·약관)에 사이트 이름을 코드로 박지 않는다', () => {
  const memberRoots = ['src/app/(solvook)', 'src/app/(auth)', 'src/app/terms', 'src/app/(admin-auth)', 'src/app/layout.tsx', 'src/app/preview/solvook-concept/_components/preview-header.tsx']
  const files = memberRoots.flatMap((root) => (root.endsWith('.tsx') ? [root] : walk(root))).filter((path) => /\.(ts|tsx)$/.test(path))
  for (const path of files) {
    assert.doesNotMatch(read(path), /써머썬 연구소/, path)
  }
  assert.doesNotMatch(read('src/lib/footer-content.ts'), /AI영어문제팩토리|DEFAULT_FOOTER_BRAND_NAME/)
})

test('루트 레이아웃이 DB 사이트 이름으로 탭 제목 템플릿을 만들고 화면에 내려 준다', () => {
  const layout = read('src/app/layout.tsx')
  assert.match(layout, /export async function generateMetadata\(\)/)
  assert.match(layout, /title: \{ default: brand\.name, template: buildSiteTitleTemplate\(brand\) \}/)
  assert.match(layout, /<SiteBrandProvider name=\{brand\.name\}>/)
  assert.match(read('src/app/preview/solvook-concept/_components/preview-header.tsx'), /const siteName = useSiteBrandName\(\)/)
  assert.match(read('src/lib/solvook-footer-data.ts'), /getFooterBrandName\(footerContent, siteBrand\.name\)/)
})

test('관리자 사이트 기본 정보: 이름 저장은 site.manage·검사·기록, 로고는 이 화면에서 바꾸고 기본값으로 되돌릴 수 있다', () => {
  const actions = read('src/app/(admin)/admin/footer/actions.ts')
  assert.match(actions, /export async function saveSiteBrandAction[\s\S]*?assertAdminActionPermission\('site\.manage'\)[\s\S]*?validateSiteBrand\(candidate\)[\s\S]*?saveSiteBrand\(candidate\)[\s\S]*?action: 'site_brand_update'/)
  const page = read('src/app/(admin)/admin/footer/page.tsx')
  assert.match(page, /<SiteBrandForm initial=\{data\.siteBrand\} \/>/)
  assert.match(page, /<SiteLogoSettings \/>/)
  assert.doesNotMatch(read('src/app/(admin)/admin/menu-management/menu-management-client.tsx'), /SiteLogoSettings/)
  const route = read('src/app/api/admin/site-logo/route.ts')
  assert.match(route, /export async function DELETE\(\) \{\n\s+const guard = await requireAdminApiPermission\('site\.manage'\)/)
  // 저장은 읽기 실패·검사 실패·저장 중·변경 없음이면 막힌다(20번 3-2: 저장 줄 부품이 저장 중을 막고, 나머지는 saveDisabled).
  const brandForm = read('src/app/(admin)/admin/footer/site-brand-form.tsx')
  assert.match(brandForm, /saveDisabled=\{loadFailed \|\| Boolean\(invalid\) \|\| !hasChanges\}/)
  assert.match(brandForm, /status=\{isSaving \? 'saving' :/)
})

test('사이트 이름 첫 값은 마이그레이션으로 넣고(관리자가 고친 값 보존), 되돌리기 파일이 있다', () => {
  const migration = read('supabase/migrations/20261120100000_site_brand.sql')
  assert.match(migration, /'site_brand',/)
  assert.match(migration, /ON CONFLICT \(key\) DO NOTHING;/)
  assert.match(read('supabase/rollback/20261120100000_site_brand_down.sql'), /DELETE FROM public\.system_settings WHERE key = 'site_brand';/)
})

test('관리자 화면 제목에는 사이트 이름 템플릿을 붙이지 않고, 미리보기 제목에 이름이 두 번 나오지 않는다', () => {
  assert.match(read('src/app/(admin)/admin/layout.tsx'), /title: \{ default: '관리자 패널', template: '%s' \}/)
  for (const path of ['src/app/preview/solvook-concept/page.tsx', 'src/app/preview/scholarly-library/page.tsx']) {
    assert.doesNotMatch(read(path), /title: '[^']*써머썬 연구소/, path)
  }
  assert.doesNotMatch(read('src/app/(admin)/admin/footer/footer-client.tsx'), /Footer 설정을 저장|Footer 설정 저장/)
})

