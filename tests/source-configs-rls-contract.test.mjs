import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20261113110000_source_configs_rls.sql')
const rollback = read('supabase/rollback/20261113110000_source_configs_rls_down.sql')

test('source_configs는 RLS를 켜고 관리자만 읽고 쓰게 한다', () => {
  assert.match(migration, /ALTER TABLE public\.source_configs ENABLE ROW LEVEL SECURITY;/)
  assert.match(migration, /REVOKE ALL ON public\.source_configs FROM anon;/)
  assert.match(migration, /REVOKE TRUNCATE, TRIGGER, REFERENCES ON public\.source_configs FROM authenticated;/)
  assert.match(
    migration,
    /CREATE POLICY "Admins can manage source configs" ON public\.source_configs\s+FOR ALL TO authenticated\s+USING \(public\.is_admin\(\)\)\s+WITH CHECK \(public\.is_admin\(\)\);/,
  )
})

test('source_configs를 쓰는 route는 관리자 확인 뒤 세션 클라이언트로 접근한다', () => {
  for (const path of ['src/app/api/admin/source-configs/route.ts', 'src/app/api/admin/source-configs/[id]/route.ts']) {
    const source = read(path)
    assert.match(source, /is_admin/, path)
    assert.match(source, /from\('source_configs'\)/, path)
  }
})

test('되돌리기는 정책을 지우고 RLS를 끈 뒤 권한을 복원한다', () => {
  const dropAt = rollback.indexOf('DROP POLICY "Admins can manage source configs"')
  const disableAt = rollback.indexOf('DISABLE ROW LEVEL SECURITY')
  assert.ok(dropAt >= 0 && dropAt < disableAt)
  assert.match(rollback, /GRANT ALL ON public\.source_configs TO anon, authenticated;/)
})
