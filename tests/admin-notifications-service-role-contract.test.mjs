import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// 회원 알림 INSERT는 서버 키로만 한다. 관리자 세션의 알림 INSERT 정책과 표 권한은 20261118100000이 없앤다.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const MIGRATION = 'supabase/migrations/20261118100000_drop_admin_notifications_insert.sql'
const DOWN = 'supabase/rollback/20261118100000_drop_admin_notifications_insert_down.sql'

function listSourceFiles(dir) {
  const root = new URL(`../${dir}`, import.meta.url).pathname
  const files = []
  const walk = (path) => {
    for (const name of readdirSync(path)) {
      const full = join(path, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(name)) files.push(full)
    }
  }
  walk(root)
  return files
}

test('문의 답변·크레딧 지급 알림은 서버 키(createAdminClient)로 넣는다', () => {
  // 16번: 회원 알림 INSERT 는 공용 함수(member-notifications-server.ts) 한 곳이 서버 키로 한다. route 는 종류만 넘긴다.
  const shared = read('src/lib/member-notifications-server.ts')
  assert.match(shared, /import \{ createAdminClient \} from '@\/lib\/supabase\/bypass'/)
  assert.match(shared, /await createAdminClient\(\)\.from\('notifications'\)\.insert\(/)
  assert.doesNotMatch(shared, /@\/lib\/supabase\/server|createClient\(\)/)

  for (const path of ['src/app/api/admin/support/tickets/[id]/route.ts', 'src/app/api/admin/users/credits/route.ts']) {
    const route = read(path)
    assert.match(route, /import \{ notificationFailed, sendMemberNotification \} from '@\/lib\/member-notifications-server'/, path)
    assert.doesNotMatch(route, /from\('notifications'\)/, path)
  }
  assert.doesNotMatch(read('src/app/api/admin/users/credits/route.ts'), /@\/lib\/supabase\/server|createClient\(\)/)
})

test('세션 클라이언트로 notifications에 INSERT하는 코드가 없다', () => {
  let found = 0
  for (const file of listSourceFiles('src')) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/(\w+(?:\.\w+)?(?:\(\))?)\s*\.from\(['"`]notifications['"`]\)\s*\.(?:insert|upsert)\(/g)) {
      found += 1
      // 서버 키 클라이언트만 허용: createAdminClient() 결과를 바로 쓰거나, 그 결과를 담은 admin 변수.
      assert.ok(
        match[1] === 'createAdminClient()' || match[1] === 'admin',
        `${file}: ${match[1]}.from('notifications').insert`
      )
      if (match[1] === 'admin') {
        // 서버 키로 만든 변수이거나, 서버 키 클라이언트 타입으로 받은 인자
        assert.match(source, /const admin = (createAdminClient|createPaymentAdminClient)\(\)|admin: PaymentAdminClient/, file)
      }
    }
  }
  // 정규식이 망가져 0건으로 조용히 통과하지 않게, 알려진 곳을 찾았는지 본다.
  // 16번: 12곳(문의 답변·크레딧 지급·회수·마켓 환불·예외 환불·결제 확인·충전 환불·페이앱 통보·대사)이 공용 함수 한 곳으로 모였다.
  assert.equal(found, 1, `알림 INSERT ${found}곳`)
})

test('마이그레이션은 정책 삭제와 INSERT 권한 회수만 하고, 되돌리기는 같은 정의로 되살린다', () => {
  const migration = read(MIGRATION)
  assert.match(migration, /SET LOCAL lock_timeout = '3s';/)
  assert.match(migration, /^DROP POLICY notifications_admin_insert ON public\.notifications;$/m)
  assert.match(migration, /^REVOKE INSERT ON TABLE public\.notifications FROM authenticated;$/m)
  assert.match(migration, /NOTIFY pgrst, 'reload schema';\s*$/)
  const statements = migration.split('\n').filter((line) => line.trim() && !line.startsWith('--'))
  assert.deepEqual(statements, [
    "SET LOCAL lock_timeout = '3s';",
    "SET LOCAL statement_timeout = '60s';",
    'DROP POLICY notifications_admin_insert ON public.notifications;',
    'REVOKE INSERT ON TABLE public.notifications FROM authenticated;',
    "NOTIFY pgrst, 'reload schema';",
  ])

  assert.ok(existsSync(new URL(`../${DOWN}`, import.meta.url)))
  const down = read(DOWN)
  assert.match(down, /GRANT INSERT ON TABLE public\.notifications TO authenticated;/)
  // 20261117140000이 만든 정책과 같은 정의
  const created = read('supabase/migrations/20261117140000_admin_rls_by_permission.sql')
  const policy = (source) => source.match(/CREATE POLICY notifications_admin_insert ON public\.notifications[\s\S]*?\);\n/)[0]
  assert.equal(policy(down), policy(created))
})
