import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20261116110000_admin_permissions_base.sql')
const rollback = read('supabase/rollback/20261116110000_admin_permissions_base_down.sql')

const squash = (sql) => sql.replace(/\s+/g, ' ')
// 주석을 뺀 실행문만 본다.
const stripComments = (sql) => sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n')
const code = stripComments(migration)
const flat = squash(code)
const down = squash(stripComments(rollback))

const functionNames = [...code.matchAll(/CREATE FUNCTION public\.(\w+)\(/g)].map((m) => m[1])
const tableNames = [...code.matchAll(/CREATE TABLE public\.(\w+) \(/g)].map((m) => m[1])

// 함수 정의 전체(머리말 + 본문). 본문 태그는 함수마다 $fn_<이름>$ 이다.
const functionSource = (name) => {
  const start = code.indexOf(`CREATE FUNCTION public.${name}(`)
  assert.ok(start >= 0, `${name} 정의가 있어야 한다`)
  const tag = `$fn_${name}$`
  const open = code.indexOf(tag, start)
  const close = code.indexOf(tag, open + tag.length)
  assert.ok(open > start && close > open, `${name} 본문 태그 ${tag} 가 열리고 닫혀야 한다`)
  return code.slice(start, close)
}

const tableStart = flat.indexOf('CREATE TABLE public.admin_permission_grants (')
const tableSource = flat.slice(tableStart, flat.indexOf(' );', tableStart) + 3)

test('만드는 것의 목록: 역할 열, 권한 표 1개, 함수 2개 — 추가만 한다', () => {
  assert.deepEqual(tableNames, ['admin_permission_grants'])
  assert.deepEqual(functionNames, ['is_owner', 'has_admin_permission'])
  // 새 객체는 CREATE만 쓴다(이미 있으면 실패해서 전체가 되돌아간다).
  assert.doesNotMatch(code, /CREATE OR REPLACE/)
  assert.doesNotMatch(code, /(CREATE [A-Z ]+|ADD COLUMN|ADD CONSTRAINT) IF NOT EXISTS/)
  // 기존 객체를 없애거나 바꾸지 않는다.
  assert.doesNotMatch(code, /\bDROP\b|\bTRUNCATE\b|DELETE FROM|CREATE TRIGGER|ALTER PUBLICATION|cron\.|ALTER POLICY|ALTER FUNCTION/)
  const altered = [...code.matchAll(/ALTER TABLE public\.(\w+)/g)].map((m) => m[1])
  assert.deepEqual(altered, ['profiles', 'admin_permission_grants'])
  // 기존 행을 바꾸는 문장은 역할 배정 하나뿐이다.
  assert.equal(code.match(/\bUPDATE public\./g).length, 1)
  assert.doesNotMatch(code, /INSERT INTO/)
})

test('역할 열: NULL 허용 text, 값은 owner·staff만, 표를 다시 쓰지 않는다', () => {
  assert.ok(flat.includes(
    `ALTER TABLE public.profiles ADD COLUMN admin_role text, ADD CONSTRAINT profiles_admin_role_check CHECK (admin_role IN ('owner', 'staff'));`))
  // 기본값·NOT NULL을 붙이지 않는다(옛 코드가 만든 관리자는 NULL = 권한 0개 staff).
  assert.doesNotMatch(flat, /ADD COLUMN admin_role text (NOT NULL|DEFAULT)/)
  assert.equal(code.match(/ADD COLUMN/g).length, 1)
  // is_admin과 admin_role을 묶는 제약은 뒤 단계(DB-P2)다.
  assert.doesNotMatch(flat, /CHECK \([^;]*is_admin/)
})

test('기존 관리자는 모두 owner로 시작하고, owner가 0명이면 전체를 되돌린다', () => {
  assert.ok(flat.includes(`UPDATE public.profiles SET admin_role = 'owner' WHERE is_admin IS TRUE;`))
  assert.ok(flat.includes(
    `DO $owners$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE is_admin IS TRUE AND admin_role = 'owner') THEN RAISE EXCEPTION 'ADMIN_OWNER_MISSING'; END IF; END; $owners$;`))
  // 특정 계정을 코드에 박지 않는다.
  assert.doesNotMatch(code, /[0-9a-f]{8}-[0-9a-f]{4}-|@|email/i)
  assert.doesNotMatch(flat, /admin_role = 'staff'/)
  // 순서: 열 추가 → 배정 → 가드 → 표
  const order = ['ADD COLUMN admin_role', `SET admin_role = 'owner'`, 'DO $owners$', 'CREATE TABLE public.admin_permission_grants']
  let position = -1
  for (const marker of order) {
    const next = flat.indexOf(marker)
    assert.ok(next > position, `순서가 맞아야 한다: ${marker}`)
    position = next
  }
})

test('권한 표: 열·PK·FK(프로필 삭제 시 함께 삭제)·CHECK', () => {
  assert.equal(tableSource, [
    'CREATE TABLE public.admin_permission_grants (',
    'user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,',
    'permission text NOT NULL,',
    `limits jsonb NOT NULL DEFAULT '{}'::jsonb,`,
    'granted_by uuid NOT NULL,',
    'granted_at timestamptz NOT NULL DEFAULT now(),',
    'PRIMARY KEY (user_id, permission),',
    `CONSTRAINT admin_permission_grants_permission_check CHECK (permission <> ''),`,
    `CONSTRAINT admin_permission_grants_limits_check CHECK (jsonb_typeof(limits) = 'object')`,
    ');',
  ].join(' '))
  // FK는 user_id 하나(부여한 사람이 지워져도 부여 기록은 남는다).
  assert.equal(tableSource.match(/REFERENCES/g).length, 1)
  assert.equal(tableSource.match(/CHECK \(/g).length, 2)
})

test('permission 값은 목록 CHECK로 묶지 않는다(항목은 코드, 부여는 데이터)', () => {
  assert.doesNotMatch(flat, /permission (IN|= ANY) ?\(/i)
  assert.doesNotMatch(flat, /CHECK \(permission (?!<> ''\))/)
  // 권한 항목 이름(영역.동작)을 마이그레이션에 박지 않는다.
  assert.doesNotMatch(code, /'[a-z_]+\.[a-z_]+'/)
  assert.doesNotMatch(code, /CREATE TYPE|CREATE DOMAIN/)
})

test('표 권한: RLS 켬, 전부 회수한 뒤 authenticated는 SELECT만·쓰기는 service_role만', () => {
  assert.ok(code.includes('ALTER TABLE public.admin_permission_grants ENABLE ROW LEVEL SECURITY;'))
  assert.doesNotMatch(code, /FORCE ROW LEVEL SECURITY|DISABLE ROW LEVEL SECURITY/)
  assert.ok(code.includes('REVOKE ALL ON TABLE public.admin_permission_grants FROM PUBLIC, anon, authenticated, service_role;'))
  const grants = [...code.matchAll(/GRANT ([A-Z, ]+) ON TABLE public\.(\w+) TO (\w+);/g)].map((m) => `${m[2]}:${m[3]}:${m[1]}`)
  assert.deepEqual(grants.sort(), [
    'admin_permission_grants:authenticated:SELECT',
    'admin_permission_grants:service_role:SELECT, INSERT, UPDATE, DELETE',
  ])
  assert.equal(code.match(/GRANT [^;]* ON TABLE/g).length, 2)
  assert.doesNotMatch(code, /GRANT [^;]* TO [^;]*\b(anon|PUBLIC)\b/)
  // profiles의 권한은 건드리지 않는다(authenticated에 UPDATE가 없는 상태 유지).
  assert.doesNotMatch(code, /(GRANT|REVOKE) [^;]* ON TABLE public\.profiles/)
  // 회수가 부여보다 앞이다.
  assert.ok(code.indexOf('REVOKE ALL ON TABLE public.admin_permission_grants') < code.indexOf('GRANT SELECT ON TABLE public.admin_permission_grants TO authenticated;'))
})

test('정책은 조회 하나뿐: 본인 것 또는 대표. 쓰기 정책은 없다', () => {
  assert.ok(flat.includes(
    'CREATE POLICY admin_permission_grants_select ON public.admin_permission_grants FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_owner()));'))
  assert.equal(code.match(/CREATE POLICY/g).length, 1)
  assert.doesNotMatch(flat, /FOR (INSERT|UPDATE|DELETE|ALL)\b/)
  assert.doesNotMatch(flat, /WITH CHECK/)
  // 정책이 부르는 함수가 먼저 만들어진다.
  assert.ok(code.indexOf('CREATE FUNCTION public.is_owner()') < code.indexOf('CREATE POLICY'))
})

test('두 함수: SQL·STABLE·SECURITY DEFINER·고정 search_path, 로그인한 사용자 기준', () => {
  for (const name of functionNames) {
    const source = functionSource(name)
    assert.match(source, /RETURNS boolean\s+LANGUAGE sql\s+STABLE\s+SECURITY DEFINER\s+SET search_path TO 'public', 'pg_temp'\s+AS \$fn_/, name)
    const body = squash(source.slice(source.indexOf(`$fn_${name}$`)))
    // 누구인지는 auth.uid()로만 정한다(인자로 받지 않는다).
    assert.equal(body.match(/auth\.uid\(\)/g).length, 1, name)
    assert.ok(body.includes('FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin IS TRUE AND'), name)
    // 읽기만 한다. 표는 스키마를 붙여 부른다.
    assert.doesNotMatch(body, /INSERT|UPDATE|DELETE|FOR UPDATE|SET LOCAL|set_config/i, name)
    assert.doesNotMatch(body, /(FROM|JOIN) (?!public\.)/, name)
  }
  assert.ok(code.includes('CREATE FUNCTION public.is_owner()\n'))
  assert.ok(code.includes('CREATE FUNCTION public.has_admin_permission(p_permission text)\n'))
})

test('is_owner: 관리자이면서 역할이 owner일 때만 참', () => {
  const body = squash(functionSource('is_owner'))
  assert.ok(body.includes(
    `SELECT EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin IS TRUE AND p.admin_role = 'owner' );`))
  assert.doesNotMatch(body, /admin_permission_grants/)
})

test('has_admin_permission: 관리자여야 하고, owner가 먼저, 아니면 그 권한을 받았을 때', () => {
  const body = squash(functionSource('has_admin_permission'))
  assert.ok(body.includes(
    `SELECT EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin IS TRUE AND ( p.admin_role = 'owner' OR EXISTS ( SELECT 1 FROM public.admin_permission_grants g WHERE g.user_id = p.id AND g.permission = p_permission ) ) );`))
  // 권한 행만으로는 통과하지 못한다: is_admin 조건이 OR 묶음 밖에 있다.
  assert.ok(body.indexOf('p.is_admin IS TRUE AND (') < body.indexOf(`p.admin_role = 'owner' OR`))
  // 한도(limits)는 함수가 보지 않는다(코드가 판정).
  assert.doesNotMatch(body, /limits/)
  // 표가 함수보다 먼저 만들어진다(SQL 함수는 만들 때 본문을 검사한다).
  assert.ok(code.indexOf('CREATE TABLE public.admin_permission_grants') < code.indexOf('CREATE FUNCTION public.has_admin_permission('))
})

test('함수 실행 권한: 전부 회수한 뒤 authenticated·service_role만(anon·PUBLIC 없음)', () => {
  assert.ok(code.includes('REVOKE ALL ON FUNCTION public.is_owner() FROM PUBLIC, anon, authenticated, service_role;'))
  assert.ok(code.includes('REVOKE ALL ON FUNCTION public.has_admin_permission(text) FROM PUBLIC, anon, authenticated, service_role;'))
  const executes = [...code.matchAll(/GRANT EXECUTE ON FUNCTION public\.(\w+)\(([a-z]*)\) TO ([a-z_, ]+);/g)].map((m) => `${m[1]}(${m[2]}):${m[3]}`)
  assert.deepEqual(executes.sort(), [
    'has_admin_permission(text):authenticated, service_role',
    'is_owner():authenticated, service_role',
  ])
  assert.equal(code.match(/GRANT EXECUTE/g).length, 2)
  assert.ok(code.lastIndexOf('REVOKE ALL ON FUNCTION') < code.indexOf('GRANT EXECUTE'))
  // 정책은 실행 권한이 정해진 뒤에 만든다.
  assert.ok(code.lastIndexOf('GRANT EXECUTE') < code.indexOf('CREATE POLICY'))
})

test('마이그레이션 형식: 시간 제한, 겹치지 않는 달러 태그, 스키마 새로고침', () => {
  assert.ok(code.startsWith(`SET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '60s';`))
  assert.ok(code.trimEnd().endsWith(`NOTIFY pgrst, 'reload schema';`))
  assert.equal(code.match(/NOTIFY pgrst/g).length, 1)
  // 파일 전문을 한 트랜잭션 안에서 실행하므로 트랜잭션 제어문을 넣지 않는다.
  assert.doesNotMatch(code, /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/m)
  for (const sql of [migration, rollback]) {
    assert.ok(!sql.includes('$file$'))
    assert.doesNotMatch(sql, /\$\$/)
    // 태그마다 정확히 한 번 열리고 한 번 닫힌다.
    const counts = {}
    for (const [tag] of sql.matchAll(/\$[a-z_]+\$/g)) counts[tag] = (counts[tag] ?? 0) + 1
    for (const [tag, count] of Object.entries(counts)) assert.equal(count, 2, tag)
  }
  assert.deepEqual([...new Set(code.match(/\$[a-z_]+\$/g))].sort(), ['$fn_has_admin_permission$', '$fn_is_owner$', '$owners$'])
  assert.match(migration, /^-- /)
  assert.ok(migration.includes('supabase/rollback/20261116110000_admin_permissions_base_down.sql'))
})

test('되돌리기: 정책 → 함수 → 표 → 역할 열 순서로, 만든 것을 모두 없앤다', () => {
  assert.equal(down.trim(), [
    `SET LOCAL lock_timeout = '3s';`,
    `SET LOCAL statement_timeout = '60s';`,
    'DROP POLICY admin_permission_grants_select ON public.admin_permission_grants;',
    'DROP FUNCTION public.has_admin_permission(text);',
    'DROP FUNCTION public.is_owner();',
    'DROP TABLE public.admin_permission_grants;',
    'ALTER TABLE public.profiles DROP CONSTRAINT profiles_admin_role_check, DROP COLUMN admin_role;',
    `NOTIFY pgrst, 'reload schema';`,
  ].join(' '))
  for (const name of functionNames) assert.match(down, new RegExp(`DROP FUNCTION public\\.${name}\\(`), name)
  for (const table of tableNames) assert.ok(down.includes(`DROP TABLE public.${table};`), table)
  // 뒤 단계가 얹혀 있으면 조용히 지우지 않고 실패한다.
  assert.doesNotMatch(down, /CASCADE|IF EXISTS/)
  // is_admin은 건드리지 않는다(관리자 로그인 유지).
  assert.doesNotMatch(down, /is_admin|\bUPDATE\b|DELETE FROM/)
})
