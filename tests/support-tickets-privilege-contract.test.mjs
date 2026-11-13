import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20261113100000_support_tickets_privilege_tighten.sql')
const rollback = read('supabase/rollback/20261113100000_support_tickets_privilege_tighten_down.sql')

test('회원이 본인 문의의 관리자 답변·상태를 직접 고칠 수 없게 정책과 권한을 줄인다', () => {
  assert.match(migration, /DROP POLICY "Users can soft delete their own tickets" ON public\.support_tickets;/)
  assert.match(migration, /REVOKE ALL ON public\.support_tickets FROM anon;/)
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public\.support_tickets FROM authenticated;/)
  // 관리자 답변이 쓰는 컬럼만 다시 준다(정책 "Admins can update tickets"가 관리자만 통과시킨다)
  assert.match(migration, /GRANT UPDATE \(status, admin_response, responded_at, updated_at\) ON public\.support_tickets TO authenticated;/)
  assert.doesNotMatch(migration, /GRANT UPDATE \([^)]*(message|subject|user_id)[^)]*\) ON public\.support_tickets/)
})

test('관리자 답변 route가 고치는 컬럼은 권한을 준 컬럼 안에 있다', () => {
  const route = read('src/app/api/admin/support/tickets/[id]/route.ts')
  const update = route.slice(route.indexOf(".from('support_tickets')"), route.indexOf('.eq(', route.indexOf(".from('support_tickets')")))
  const columns = [...update.matchAll(/^\s+([a-z_]+):/gm)].map((match) => match[1])
  assert.deepEqual(columns.sort(), ['admin_response', 'responded_at', 'status', 'updated_at'])
})

test('알림은 본인 행의 is_read만, 카테고리는 관리자 등록·수정만 남긴다', () => {
  assert.match(migration, /REVOKE ALL ON public\.notifications FROM anon;/)
  assert.match(migration, /REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public\.notifications FROM authenticated;/)
  assert.match(migration, /GRANT UPDATE \(is_read\) ON public\.notifications TO authenticated;/)
  assert.match(migration, /REVOKE ALL ON public\.support_ticket_categories FROM anon;/)
  assert.match(migration, /REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON public\.support_ticket_categories FROM authenticated;/)
})

test('회원 쪽 문의 쓰기는 RPC로만 하고, 구 관리자 답변 PATCH는 없다', () => {
  const route = read('src/app/api/support/route.ts')
  assert.doesNotMatch(route, /export async function PATCH/)
  assert.doesNotMatch(route, /from\('support_tickets'\)\s*\.(update|insert|delete)/)
  for (const rpc of ['create_support_ticket', 'update_own_pending_support_ticket', 'soft_delete_own_support_ticket']) {
    assert.match(route, new RegExp(`rpc\\('${rpc}'`))
  }
})

test('되돌리기는 정책과 권한을 적용 전 상태로 복원한다', () => {
  assert.match(rollback, /CREATE POLICY "Users can soft delete their own tickets" ON public\.support_tickets/)
  assert.match(rollback, /GRANT ALL ON public\.support_tickets TO anon, authenticated;/)
  assert.match(rollback, /GRANT ALL ON public\.notifications TO anon, authenticated;/)
})
