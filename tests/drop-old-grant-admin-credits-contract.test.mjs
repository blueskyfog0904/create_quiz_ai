import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 옛 크레딧 지급 함수(5인자) 삭제(20261118130000). 새 7인자 함수(20261118120000)만 남는다.
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const MIGRATION = read('supabase/migrations/20261118130000_drop_old_grant_admin_credits.sql')
const DOWN = read('supabase/rollback/20261118130000_drop_old_grant_admin_credits_down.sql')

test('마이그레이션: 새 함수가 있고 옛 정의가 확인한 값일 때만 옛 5인자 함수를 지운다', () => {
  const check = MIGRATION.indexOf("RAISE EXCEPTION 'NEW_GRANT_ADMIN_CREDITS_MISSING'")
  const md5 = MIGRATION.indexOf("<> '05b1c69bfb2d0e69662df8738dde1020' THEN\n    RAISE EXCEPTION 'OLD_GRANT_ADMIN_CREDITS_DEFINITION_CHANGED'")
  const drop = MIGRATION.indexOf('DROP FUNCTION public.grant_admin_credits(uuid, integer, text, text, text);')
  assert.ok(check > 0 && md5 > check && drop > md5)
  // 새 7인자 함수는 건드리지 않는다.
  assert.doesNotMatch(MIGRATION, /DROP FUNCTION public\.grant_admin_credits\(uuid, uuid/)
  assert.doesNotMatch(MIGRATION, /CREATE (OR REPLACE )?FUNCTION/)
  assert.match(MIGRATION, /SET LOCAL lock_timeout = '3s';/)
})

test('되돌리기: 20261110110000의 정의와 권한을 글자 그대로 다시 만든다', () => {
  const original = read('supabase/migrations/20261110110000_credit_ledger_integrity.sql')
  const block = original.match(/CREATE FUNCTION public\.grant_admin_credits\([\s\S]*?GRANT EXECUTE ON FUNCTION public\.grant_admin_credits\(uuid, integer, text, text, text\) TO service_role;/)[0]
  assert.ok(DOWN.includes(block))
})

test('코드는 옛 5인자 인자(p_payment_method)로 지급 함수를 부르지 않는다', () => {
  const walk = (dir) => readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = `${dir}/${name}`
    return statSync(join(ROOT, path)).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
  })
  const callers = walk('src').filter((path) => read(path).includes("rpc('grant_admin_credits'"))
  assert.deepEqual(callers, ['src/lib/credits.ts'])
  const call = read('src/lib/credits.ts').match(/rpc\('grant_admin_credits', \{[\s\S]*?\}\)/)[0]
  assert.match(call, /p_actor_id: actorId/)
  assert.doesNotMatch(call, /p_payment_method/)
  // 생성 타입도 새 인자만 안다.
  const types = read('src/types/supabase.ts').match(/grant_admin_credits: \{\n\s+Args: \{[\s\S]*?\}/)[0]
  assert.doesNotMatch(types, /p_payment_method/)
  assert.match(types, /p_actor_id: string/)
})
