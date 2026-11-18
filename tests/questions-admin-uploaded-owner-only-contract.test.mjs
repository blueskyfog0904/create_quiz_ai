import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

// 회원 세션으로 '관리자 업로드' 문제를 만들거나 바꾸지 못하게(20261118140000).
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const MIGRATION = read('supabase/migrations/20261118140000_questions_admin_uploaded_owner_only.sql')
const DOWN = read('supabase/rollback/20261118140000_questions_admin_uploaded_owner_only_down.sql')
const CONDITION = "((source)::text IS DISTINCT FROM 'admin_uploaded' OR (SELECT public.is_owner()))"

test('INSERT·UPDATE에 RESTRICTIVE 정책: admin_uploaded는 대표만, 기존 정책은 건드리지 않는다', () => {
  assert.ok(MIGRATION.includes(`CREATE POLICY questions_admin_uploaded_insert_owner_only\n  ON public.questions\n  AS RESTRICTIVE\n  FOR INSERT\n  WITH CHECK ${CONDITION};`))
  assert.ok(MIGRATION.includes(`CREATE POLICY questions_admin_uploaded_update_owner_only\n  ON public.questions\n  AS RESTRICTIVE\n  FOR UPDATE\n  USING ${CONDITION}\n  WITH CHECK ${CONDITION};`))
  assert.doesNotMatch(MIGRATION, /DROP POLICY|ALTER POLICY|ALTER TABLE|GRANT|REVOKE/)
  assert.match(MIGRATION, /SET LOCAL lock_timeout = '3s';/)
})

test('되돌리기는 두 정책만 지운다', () => {
  assert.deepEqual([...DOWN.matchAll(/DROP POLICY (\w+) ON public\.questions;/g)].map((match) => match[1]), [
    'questions_admin_uploaded_insert_owner_only',
    'questions_admin_uploaded_update_owner_only',
  ])
})

test('앱의 세션 쓰기는 admin_uploaded를 넣지 않는다(관리자 업로드는 정의자 함수로)', () => {
  for (const path of ['src/app/api/questions/route.ts', 'src/app/api/generate/listboard-jobs/[jobId]/save/route.ts', 'src/app/api/questions/save-from-community/route.ts', 'src/app/api/questions/[id]/route.ts']) {
    assert.doesNotMatch(read(path), /source: 'admin_uploaded'/, path)
  }
  assert.match(read('src/app/api/admin/questions/route.ts'), /p_source: 'admin_uploaded'/)
})
