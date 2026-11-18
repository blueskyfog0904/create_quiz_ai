import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// 닫아 둔 문제은행의 관리자 함수 7개를 대표 전용으로(20261118110000). 화면·API는 이미 대표 전용이다.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MIGRATION = 'supabase/migrations/20261118110000_question_bank_rpcs_owner_only.sql'
const DOWN = 'supabase/rollback/20261118110000_question_bank_rpcs_owner_only_down.sql'
const migration = read(MIGRATION)
const down = read(DOWN)

const FUNCTIONS = [
  'admin_audit_question_bank_metadata',
  'admin_list_bank_questions',
  'admin_list_question_bank_backfill_candidates',
  'backfill_question_bank_metadata',
  'create_admin_bank_question',
  'create_admin_bank_questions_bulk',
  'update_admin_bank_question',
]

// 이 함수들을 부르는 route와 그 가드
const CALLERS = {
  'src/app/api/admin/questions/route.ts': ['admin_list_bank_questions'],
  'src/app/api/admin/questions/[id]/route.ts': ['update_admin_bank_question'],
  'src/app/api/admin/questions/upload/route.ts': ['create_admin_bank_questions_bulk', 'create_admin_bank_question'],
  'src/app/api/admin/question-bank/backfill/route.ts': [
    'admin_audit_question_bank_metadata',
    'admin_list_question_bank_backfill_candidates',
    'backfill_question_bank_metadata',
  ],
}

const pairs = (source, columns) => [...source.matchAll(new RegExp(
  `\\('public\\.(\\w+)\\(([^)]*)\\)'${', \'([0-9a-f]{32})\''.repeat(columns)}\\)`,
  'g'
))].map((match) => ({ name: match[1], args: match[2], md5s: match.slice(3) }))

test('마이그레이션은 7개 함수의 검사 한 줄만 is_owner()로 바꾸고, 정의가 확인한 값과 다르면 전체를 취소한다', () => {
  const targets = pairs(migration, 1)
  assert.deepEqual(targets.map((target) => target.name).sort(), [...FUNCTIONS].sort())
  assert.match(migration, /IF md5\(v_def\) <> v_target\.expected_md5 THEN\s+RAISE EXCEPTION 'QUESTION_BANK_RPC_DEFINITION_CHANGED/)
  assert.match(migration, /regexp_matches\(v_def, 'public\\\.is_admin\\\(\\\)', 'g'\)\) <> 1/)
  assert.match(migration, /v_new := replace\(v_def, 'public\.is_admin\(\)', 'public\.is_owner\(\)'\);/)
  assert.match(migration, /OR v_new ~ 'is_admin' THEN\s+RAISE EXCEPTION 'QUESTION_BANK_RPC_REPLACE_FAILED/)
  assert.match(migration, /EXECUTE v_new;/)
  // 권한·소유자를 바꾸는 문장이 없다(CREATE OR REPLACE가 그대로 둔다).
  assert.doesNotMatch(migration, /^\s*(GRANT|REVOKE|ALTER FUNCTION|DROP FUNCTION)/m)
  assert.match(migration, /SET LOCAL lock_timeout = '3s';/)
})

test('되돌리기는 적용 직후 정의일 때만 is_admin()으로 되돌리고, 결과가 적용 전 정의와 같아야 한다', () => {
  assert.ok(existsSync(new URL(`../${DOWN}`, import.meta.url)))
  const up = pairs(migration, 1)
  const back = pairs(down, 2)
  assert.deepEqual(back.map((row) => row.name), up.map((row) => row.name))
  for (const [index, row] of back.entries()) {
    assert.equal(row.args, up[index].args, row.name)
    assert.equal(row.md5s[1], up[index].md5s[0], `${row.name}: 되돌린 정의 = 적용 전 정의`)
    assert.notEqual(row.md5s[0], row.md5s[1], row.name)
  }
  assert.match(down, /IF md5\(v_def\) <> v_target\.applied_md5 THEN/)
  assert.match(down, /v_new := replace\(v_def, 'public\.is_owner\(\)', 'public\.is_admin\(\)'\);/)
  assert.match(down, /IF md5\(v_new\) <> v_target\.original_md5 THEN/)
})

test('앱에서 이 함수들을 부르는 route는 모두 대표 전용이다(대표 동작은 바뀌지 않는다)', () => {
  const called = new Set()
  for (const [route, functions] of Object.entries(CALLERS)) {
    const source = read(route)
    assert.match(source, /requireAdminApiPermission\('owner'\)/, route)
    assert.doesNotMatch(source, /requireAdminApiPermission\('(?!owner)/, route)
    for (const name of functions) {
      assert.match(source, new RegExp(`\\.rpc\\('${name}'`), `${route} → ${name}`)
      called.add(name)
    }
  }
  assert.deepEqual([...called].sort(), [...FUNCTIONS].sort())

  // 거꾸로: src 전체에서 이 함수들을 부르는 파일은 위 4개뿐이다(새 호출처가 생기면 여기서 확인하게).
  const callers = new Set()
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(name) && FUNCTIONS.some((fn) => readFileSync(full, 'utf8').includes(`.rpc('${fn}'`))) {
        callers.add(relative(ROOT, full))
      }
    }
  }
  walk(join(ROOT, 'src'))
  assert.deepEqual([...callers].sort(), Object.keys(CALLERS).sort())
})
