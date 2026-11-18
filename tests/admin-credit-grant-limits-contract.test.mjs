import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

// 직원 크레딧 지급의 1회·하루 한도와 기본 한도 설정(20261118120000, 계획 U3-6).
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const MIGRATION = read('supabase/migrations/20261118120000_admin_credit_grant_limits.sql')
const DOWN = read('supabase/rollback/20261118120000_admin_credit_grant_limits_down.sql')

const fnBody = (name) => {
  const match = MIGRATION.match(new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]*?\\$fn_${name}\\$;`))
  assert.ok(match, name)
  return match[0]
}

test('기본 한도는 설정 행(1회 10,000·하루 50,000)이고, 화면 세션으로는 그 행을 고치지 못한다', () => {
  assert.match(MIGRATION, /'admin_credit_grant_limits',\n\s+'\{"per_grant": 10000, "per_day": 50000\}'::jsonb/)
  assert.match(MIGRATION, /CREATE POLICY system_settings_admin_credit_grant_limits_no_client_write\n\s+ON public\.system_settings\n\s+AS RESTRICTIVE\n\s+FOR UPDATE\n\s+USING \(key <> 'admin_credit_grant_limits'\)\n\s+WITH CHECK \(key <> 'admin_credit_grant_limits'\);/)
  assert.match(MIGRATION, /SET LOCAL lock_timeout = '3s';/)
})

test('두 새 함수와 권한 교체 함수: SECURITY DEFINER, search_path 고정, EXECUTE는 service_role만', () => {
  for (const [name, signature] of [
    ['grant_admin_credits', 'uuid, uuid, integer, text, text, jsonb, text'],
    ['set_admin_credit_grant_limits', 'uuid, integer, integer'],
  ]) {
    assert.match(fnBody(name), /\n SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'\n/, name)
    assert.ok(MIGRATION.includes(`REVOKE ALL ON FUNCTION public.${name}(${signature}) FROM PUBLIC, anon, authenticated, service_role;`), name)
    assert.ok(MIGRATION.includes(`GRANT EXECUTE ON FUNCTION public.${name}(${signature}) TO service_role;`), name)
  }
  assert.doesNotMatch(MIGRATION, /TO (anon|authenticated)\b/)
  // 권한 교체 함수는 현재 정의를 확인한 뒤에만 바꾼다(목록에 한 이름만 더한다 — 본문 비교는 권한 부여 계약 테스트).
  assert.ok(MIGRATION.indexOf("<> 'b04254ce36e496885442ceab4387b964'") < MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.replace_admin_permission_grants('))
})

test('지급 함수: 대표는 한도 없음, 직원은 권한 행을 잠근 뒤 1회·오늘 합계(한국 시간)를 보고, 재요청은 한도와 무관하다', () => {
  const body = fnBody('grant_admin_credits')
  const staffBranch = body.indexOf("IF v_actor_role = 'staff' THEN")
  const lockGrant = body.search(/WHERE g\.user_id = p_actor_id AND g\.permission = 'credits\.grant'\n\s+FOR UPDATE;/)
  const replayCheck = body.indexOf('v_is_replay := EXISTS')
  const perGrant = body.indexOf("RAISE EXCEPTION 'ADMIN_GRANT_LIMIT_PER_GRANT limit=%', v_per_grant;")
  const daySum = body.indexOf("AND l.created_at >= (date_trunc('day', v_now AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul');")
  const perDay = body.indexOf("RAISE EXCEPTION 'ADMIN_GRANT_LIMIT_PER_DAY limit=% used=%', v_per_day, v_used_today;")
  const lockTarget = body.search(/PERFORM 1\n\s+FROM public\.profiles\n\s+WHERE id = p_user_id\n\s+FOR UPDATE;/)
  // 순서: 직원 분기 → 권한 행 잠금 → 재요청 확인 → 1회 → 오늘 합계 → 하루 → 대상 잠금
  const order = [staffBranch, lockGrant, replayCheck, perGrant, daySum, perDay, lockTarget]
  assert.ok(order.every((index) => index > 0), JSON.stringify(order))
  assert.deepEqual([...order].sort((a, b) => a - b), order)
  // 계정별 값이 우선, 없으면 기본 한도. 둘 다 없으면 거부.
  // 계정에 키가 있으면 그 값(숫자가 아니면 NULL → 거부), 없으면 기본 한도.
  for (const key of ['per_grant', 'per_day']) {
    assert.match(body, new RegExp(`WHEN v_grant_limits \\? '${key}' THEN\\n\\s+CASE WHEN jsonb_typeof\\(v_grant_limits -> '${key}'\\) = 'number' THEN \\(v_grant_limits ->> '${key}'\\)::numeric END\\n\\s+WHEN jsonb_typeof\\(v_default_limits -> '${key}'\\) = 'number'`), key)
  }
  assert.match(body, /RAISE EXCEPTION 'ADMIN_GRANT_LIMIT_NOT_SET'/)
  // 하루 합계는 그 직원의 credit_grant 기록에서
  assert.match(body, /FROM public\.admin_audit_log l\n\s+WHERE l\.actor_id = p_actor_id\n\s+AND l\.action = 'credit_grant'/)
  // 재요청으로 한도를 건너뛰었는데 기존 거래가 없으면 지급하지 않는다.
  assert.match(body, /IF v_is_replay THEN\n\s+RAISE EXCEPTION 'ADMIN_GRANT_REPLAY_MISSING';/)
  // 본인·비관리자·의존 권한 빠짐 거부, 원장 문구
  assert.match(body, /IF p_actor_id = p_user_id THEN\n\s+RAISE EXCEPTION 'ADMIN_GRANT_SELF_TARGET';/)
  assert.match(body, /g\.permission IN \('members\.view', 'credits\.view'\)\) <> 2 THEN\n\s+RAISE EXCEPTION 'ADMIN_GRANT_ACTOR_NOT_ALLOWED';/)
  assert.match(body, /format\('크레딧 %s개 관리자 지급'/)
  assert.doesNotMatch(body, /BETWEEN 1 AND 10000|> 10000/)
})

test('기본 한도 변경 함수: 대표 또는 credits.limits.manage+credits.view 직원, 1회 ≤ 하루, 전/후를 작업 기록에 남긴다', () => {
  const body = fnBody('set_admin_credit_grant_limits')
  assert.match(body, /OR p_per_grant < 1 OR p_per_day < 1 OR p_per_grant > p_per_day THEN\n\s+RAISE EXCEPTION 'ADMIN_GRANT_LIMITS_INVALID';/)
  assert.match(body, /g\.permission IN \('credits\.limits\.manage', 'credits\.view'\)\) <> 2 THEN/)
  assert.match(body, /WHERE s\.key = 'admin_credit_grant_limits'\n\s+FOR UPDATE;/)
  assert.ok(body.indexOf('UPDATE public.system_settings') < body.indexOf("'credit_grant_limits_update'"))
  assert.match(body, /jsonb_build_object\('before', v_before, 'after', v_after\)/)
})

test('되돌리기: 새 권한을 받은 계정이 있으면 멈추고, 함수·정책·설정을 지우고 권한 교체 함수를 원래 목록으로 되돌린다', () => {
  assert.match(DOWN, /WHERE g\.permission = 'credits\.limits\.manage'\) THEN\n\s+RAISE EXCEPTION 'ROLLBACK_PRECHECK/)
  assert.match(DOWN, /<> 'dcb2155fae26443c98231627d102a821' THEN/)
  for (const statement of [
    'DROP FUNCTION public.grant_admin_credits(uuid, uuid, integer, text, text, jsonb, text);',
    'DROP FUNCTION public.set_admin_credit_grant_limits(uuid, integer, integer);',
    'DROP POLICY system_settings_admin_credit_grant_limits_no_client_write ON public.system_settings;',
    "DELETE FROM public.system_settings WHERE key = 'admin_credit_grant_limits';",
  ]) assert.ok(DOWN.includes(statement), statement)
  assert.doesNotMatch(DOWN, /credits\.limits\.manage'\n\s+\]::text\[\]/)
  assert.doesNotMatch(DOWN, /DROP FUNCTION public\.grant_admin_credits\(uuid, integer/)
})

test('화면: 크레딧 관리에 기본 한도 카드(변경은 credits.limits.manage), 지급 창·route에 10,000 하드코딩 없음', () => {
  const page = read('src/app/(admin)/admin/credits/page.tsx')
  assert.match(page, /<CreditGrantLimitsCard limits=\{grantLimits\} canEdit=\{hasAdminPermission\(access, 'credits\.limits\.manage'\)\} \/>/)
  const card = read('src/app/(admin)/admin/credits/credit-grant-limits-card.tsx')
  assert.match(card, /fetch\('\/api\/admin\/users\/credits\/limits', \{\n\s+method: 'PUT'/)
  assert.match(card, /\{canEdit && \(/)
  for (const path of ['src/app/(admin)/admin/credits/grant-credit-dialog.tsx', 'src/app/api/admin/users/credits/route.ts']) {
    assert.doesNotMatch(read(path), /10000|10,000/, path)
  }
})
