import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import '../src/components/features/passages/node-test-register.mjs'

// 11번 계획 5-5·5-6·11-1·11-2: 마이그레이션·down·스크립트 A·B·되돌림·리허설 생성기의 계약(DB 동작은 리허설이 본다).
const consent = await import('../src/lib/checkout-consent.ts')
const { ADMIN_AUDIT_ACTIONS } = await import('../src/lib/admin-audit-log.ts')
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const MIGRATION_PATH = 'supabase/migrations/20261216100000_checkout_consent_v2.sql'
const migration = read(MIGRATION_PATH)
const down = read('supabase/rollback/20261216100000_checkout_consent_v2_down.sql')
const scripts = {
  keys: read('supabase/scripts/20261216_bundle11_consent_keys.sql'),
  format2: read('supabase/scripts/20261216_bundle11_consent_format_2.sql'),
  format1: read('supabase/scripts/20261216_bundle11_consent_format_1.sql'),
}
const NEW_MD5 = {
  'public.record_purchase_notice_ack(uuid,uuid,text,text)': '9d2cb23a7aa16e45970525248bcc4435',
  'public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)': '4b23fdf6b9c7bcf76e39ee5b7b1a629f',
  'public.build_checkout_consent_v2(text,jsonb,integer)': '3fd97051955741db213297804131c1e3',
  'public.build_market_cart_texts(jsonb)': '604251e0a0b5f85b58aaeccb0c593d05',
}

test('파일 이름은 운영 최신 판(20261205100000) 뒤, 거래 문장 없음, 잠금 설정·순서·NOTIFY', () => {
  const versions = readdirSync(new URL('../supabase/migrations/', import.meta.url)).map((name) => name.split('_')[0]).filter((v) => /^\d{14}$/.test(v)).sort()
  // 11번이 적용 당시 운영 최신 판이다. 그 뒤 파일은 뒤 묶음(13번 20261217…)만 온다.
  assert.equal(versions.filter((v) => v <= '20261216100000').at(-1), '20261216100000')
  assert.ok(versions.filter((v) => v > '20261216100000').every((v) => v >= '20261217100000'))
  for (const [name, sql] of [['migration', migration], ['down', down]]) {
    assert.doesNotMatch(sql, /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/m, name)
    assert.match(sql, /^SET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '120s';$/m, name)
    assert.ok(sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"), name)
  }
  assert.ok(migration.indexOf('LOCK TABLE public.market_purchase_notice_acks IN ACCESS EXCLUSIVE MODE;')
    < migration.indexOf('LOCK TABLE public.point_charge_checkout_acks IN ACCESS EXCLUSIVE MODE;'))
  assert.ok(migration.indexOf('LOCK TABLE') < migration.indexOf('DO $precheck_checkout_consent_v2$'))
  assert.match(migration, /-- \[11번\] 시작/)
  assert.match(migration, /-- \[11번\] 끝/)
})

test('사전 검사: 바탕 값·새 값·그대로 목록(5-5), VERIFY·down·스크립트의 새 md5 가 모두 같다', () => {
  const precheck = migration.slice(migration.indexOf('DO $precheck_checkout_consent_v2$'), migration.indexOf('$precheck_checkout_consent_v2$;'))
  assert.match(precheck, /'fa6a7edd836f21422d52dd184afb079b'/)
  assert.match(precheck, /'be4403fd993c45d618950a5908a91591'/)
  assert.doesNotMatch(precheck, /0047854ac79ddae6fba6dde114fb575d/)
  assert.match(precheck, /\(v_old IS NULL\) = \(v_new IS NULL\)/)
  for (const md5 of ['0cda5ff7689d998cc6cf2fd213b0004d', '60fc28afe44e7be776c189265e87b6ec', '7ab4d40c1634ade20de86517fa13cd40', 'c7ef25308c6c0aa2920991965fb87ab0',
    '3959ac2b8139d0f81365df59ed67ef10', '93e0bd5e41969f66f296f4353f3feeb9', '679b4474c0dc42de11e5e9a14a7d1d4d', '657bbb07ae4b250a2697f21e2aa805e9',
    '5d4030e7bedbace6189cefed80c3d27b', '4ffeca80346467f928c0a6f50b69018d', 'b1449554c094a90be7a6c864f367fdf8', 'a7674770964dac2fe5c9179b8403c3b4',
    '3a2e2c2f6eb6ecb15defe0879c88e0fc', '1346d870d3623abae580a011b0484339']) {
    assert.ok(precheck.includes(`'${md5}'`), md5)
  }
  const verify = migration.slice(migration.indexOf('DO $verify_checkout_consent_v2$'))
  for (const [sig, md5] of Object.entries(NEW_MD5)) {
    assert.ok(verify.includes(`ARRAY['${sig}', '${md5}'`), `verify ${sig}`)
    assert.ok(down.includes(`ARRAY['${sig}', '${md5}']`), `down ${sig}`)
    for (const [name, script] of Object.entries(scripts)) assert.ok(script.includes(`ARRAY['${sig}', '${md5}']`), `${name} ${sig}`)
  }
  assert.ok(precheck.includes("'9d2cb23a7aa16e45970525248bcc4435'") && precheck.includes("'4b23fdf6b9c7bcf76e39ee5b7b1a629f'"))
  for (const script of Object.values(scripts)) assert.match(script, /'a42b474d9d95753ffba5041acb0c1c77'/)
})

test('함수 모양: 4인자(DEFAULT NULL)·옛 3인자 지움, 권한은 service_role 만·내부 함수는 postgres 만, 모든 응답에 consentFormat', () => {
  assert.ok(migration.indexOf('DROP FUNCTION IF EXISTS public.record_purchase_notice_ack(uuid, uuid, text);')
    < migration.indexOf('CREATE OR REPLACE FUNCTION public.record_purchase_notice_ack(p_user_id uuid, p_idempotency_key uuid, p_notice_sha256 text, p_cart_texts_sha256 text DEFAULT NULL)'))
  for (const sig of ['record_purchase_notice_ack(uuid, uuid, text, text)', 'record_point_charge_checkout_ack(uuid, uuid, uuid, integer, integer, text)']) {
    assert.ok(migration.includes(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`), sig)
    assert.ok(migration.includes(`GRANT EXECUTE ON FUNCTION public.${sig} TO service_role;`), sig)
  }
  for (const sig of ['build_market_cart_texts(jsonb)', 'build_checkout_consent_v2(text, jsonb, integer)']) {
    assert.ok(migration.includes(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated, service_role;`), sig)
    assert.doesNotMatch(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig.replace(/[()]/g, '\\$&')}`))
  }
  for (const head of ['CREATE OR REPLACE FUNCTION public.record_purchase_notice_ack(', 'CREATE OR REPLACE FUNCTION public.record_point_charge_checkout_ack(']) {
    const start = migration.indexOf(head)
    const body = migration.slice(start, migration.indexOf('\n$function$;', start))
    const returns = body.match(/RETURN jsonb_build_object\([^;]*\);/g)
    assert.ok(returns.length > 8)
    for (const statement of returns) assert.match(statement, /'consentFormat'/, statement)
  }
  // 판 비교는 숫자만(글자 비교 금지)
  assert.equal((migration.match(/jsonb_typeof\(v_value -> 'consentFormat'\) = 'number' AND \(v_value ->> 'consentFormat'\)::numeric = [12]/g) ?? []).length, 4)
  // 5-4 replay 는 두 곳 모두 장바구니 지문 IS NOT DISTINCT FROM
  assert.equal((migration.match(/v_existing_cart IS NOT DISTINCT FROM p_cart_texts_sha256/g) ?? []).length, 2)
  // 칸: 상수 기본값·CHECK 는 없을 때만·IF NOT EXISTS
  assert.match(migration, /ADD COLUMN IF NOT EXISTS consent_format smallint NOT NULL DEFAULT 1/)
  assert.match(migration, /market_purchase_notice_acks_consent_format_check CHECK \(consent_format IN \(1, 2\)\)/)
  assert.match(migration, /point_charge_checkout_acks_consent_format_check CHECK \(consent_format IN \(1, 2\)\)/)
})

test('down: 바탕 정의로 되돌리고 내부 함수만 지운다(칸은 남김), 사전 검사는 11번 값일 때만', () => {
  assert.match(down, /DROP FUNCTION public\.record_purchase_notice_ack\(uuid, uuid, text, text\);\nCREATE OR REPLACE FUNCTION public\.record_purchase_notice_ack\(p_user_id uuid, p_idempotency_key uuid, p_notice_sha256 text\)/)
  assert.match(down, /GRANT EXECUTE ON FUNCTION public\.record_purchase_notice_ack\(uuid, uuid, text\) TO service_role;/)
  assert.match(down, /DROP FUNCTION public\.build_checkout_consent_v2\(text, jsonb, integer\);/)
  assert.match(down, /DROP FUNCTION public\.build_market_cart_texts\(jsonb\);/)
  assert.doesNotMatch(down, /DROP COLUMN|ALTER TABLE|LOCK TABLE/)
  assert.match(down, /'fa6a7edd836f21422d52dd184afb079b'/)
  assert.match(down, /'be4403fd993c45d618950a5908a91591'/)
  assert.match(down, /DOWN PRECHECK: 3-argument record_purchase_notice_ack already exists/)
  // 옛 정의 본문은 10번 운영 값 그대로(회귀 방지: 4인자 흔적 없음)
  const oldMarket = down.slice(down.indexOf('CREATE OR REPLACE FUNCTION public.record_purchase_notice_ack('), down.indexOf('REVOKE ALL ON FUNCTION public.record_purchase_notice_ack(uuid, uuid, text)'))
  assert.doesNotMatch(oldMarket, /consentFormat|cart_texts|\[11번\]/)
})

test('스크립트 A·B·되돌림: c_mode·md5 관문, 거래·잠금, 작업 기록 종류가 목록에 있음, 머리말 저장 금지', () => {
  for (const [name, script] of Object.entries(scripts)) {
    assert.match(script, /^BEGIN;\nSET LOCAL lock_timeout = '3s';/m, name)
    assert.match(script, /^COMMIT;$/m, name)
    assert.ok(script.includes('  c_mode constant text := NULL;'), name)
    assert.ok(script.includes('  c_market_policy_md5 constant text := NULL;') && script.includes('  c_point_policy_md5 constant text := NULL;'), name)
    assert.match(script, /IF c_mode IS DISTINCT FROM 'apply' THEN/, name)
    assert.match(script, /md5\(v_market::text\) IS DISTINCT FROM c_market_policy_md5/, name)
    assert.match(script, /관리자 구매 고지·충전 문구 저장 금지|관리자 문구 저장 금지/, name)
    assert.match(script, /'version', \(v_market ->> 'version'\)::integer \+ 1/, name)
    for (const match of script.matchAll(/record_admin_audit\(\s*[^,()]+,\s*'([a-z_]+)'/g)) {
      assert.ok(Object.hasOwn(ADMIN_AUDIT_ACTIONS, match[1]), `${name}: ${match[1]}`)
    }
    assert.match(script, /'before', v_market, 'after', v_market_new/, name)
  }
  assert.match(scripts.keys, /consentFormat already present/)
  assert.match(scripts.format2, /consent v2 builder returned NULL/)
  // 되돌림은 2판 묶음 결과를 보지 않는다(2판이 닫혔을 때가 가장 필요한 때)
  assert.doesNotMatch(scripts.format1, /build_checkout_consent_v2\('/)
  // A 는 purchaseCompleteNotice 를 넣지 않는다(4-2: 배포 뒤 관리자 화면에서 바꾼다)
  assert.doesNotMatch(scripts.keys.slice(scripts.keys.indexOf('c_market_keys'), scripts.keys.indexOf('BEGIN\n  IF c_mode')), /purchaseCompleteNotice/)
})

test('스크립트 A 초안(4-2)은 TS 검사를 지난다(현재 1판 키와 합친 값)', () => {
  const jsonOf = (tag) => JSON.parse(scripts.keys.split(`$${tag}$`)[1])
  const market = jsonOf('market_keys')
  const point = jsonOf('point_keys')
  const bundle8 = read('supabase/migrations/20261124100000_market_material_refund.sql')
  assert.ok(bundle8.includes('confirmNotice'))
  const marketPolicy = { refundDays: 30, confirmNotice: '본문', usageScopeNotice: '범위', downloadPeriodNotice: '기간', ...market }
  assert.deepEqual(consent.checkCheckoutConsentKeys('market', marketPolicy), [])
  assert.deepEqual(consent.checkMarketCartTexts(marketPolicy), [])
  const pointPolicy = { checkoutItems: { product: 'a', validity: 'b', refund: 'c {충전환불기간}', restriction: 'd', otherCases: 'e' }, minorNotice: 'f', ...point }
  assert.deepEqual(consent.checkCheckoutConsentKeys('point_charge', pointPolicy), [])
  // 0-6·12판 문구
  assert.equal(point.consentSummary.validity, '충전한 크레딧은 결제한 때부터 {충전유효기간}년 동안 쓸 수 있고, 기간이 지나면 남은 크레딧은 쓸 수 없어요.')
  assert.equal(point.consentItems[2].label, '미성년자 결제 취소 안내')
  assert.equal(market.cartCheckoutNotice, '크레딧으로 선택한 자료를 한 번에 구매합니다. 하나라도 구매할 수 없으면 전체 구매가 취소됩니다.')
})

test('리허설: 생성 파일이 원본과 같고, light 는 표 잠금 DDL·COMMIT 이 없으며 BEGIN … ROLLBACK 이다', () => {
  execFileSync(process.execPath, ['supabase/scripts/bundle11_rehearsal/generate.mjs', '--check'], { cwd: new URL('..', import.meta.url) })
  const light = read('supabase/scripts/bundle11_rehearsal/a_light.sql')
  const body = light.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n')
  for (const word of ['LOCK TABLE', 'ALTER TABLE', 'CREATE TRIGGER', 'DROP TRIGGER', 'CREATE POLICY', 'DROP POLICY', 'CREATE INDEX', 'COMMENT ON']) {
    assert.ok(!body.includes(word), word)
  }
  assert.doesNotMatch(body, /\bCOMMIT\s*;/)
  for (const name of ['a_light.sql', 'b_full.sql', 'c_snapshot_closed.sql']) {
    const sql = read(`supabase/scripts/bundle11_rehearsal/${name}`)
    assert.match(sql, /\nBEGIN;\nSET LOCAL lock_timeout = '3s';/, name)
    assert.ok(sql.trimEnd().endsWith('ROLLBACK;'), name)
    assert.doesNotMatch(sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n'), /\bCOMMIT\s*;/, name)
    for (const tag of ['R0', 'R4']) assert.ok(sql.includes(`'${tag}'`), `${name} ${tag}`)
  }
  const full = read('supabase/scripts/bundle11_rehearsal/b_full.sql')
  for (const tag of ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'FX']) assert.ok(full.includes(`'${tag}'`), tag)
  // 사본이 원본과 다른 곳은 생성기 목록뿐(표 이름·함수 이름·② 한 줄·칸 VERIFY)
  const generator = read('supabase/scripts/bundle11_rehearsal/generate.mjs')
  assert.match(generator, /export const MIGRATION_LIGHT_REMOVALS = \[/)
  assert.match(generator, /export const STEP6_LINE = \[/)
  assert.match(generator, /export const SCRIPT_LINES = \{/)
})

test('생성 타입: 4인자 함수와 새 칸(마이그레이션 적용 뒤 다시 만들 때 같은 모양)', () => {
  const types = read('src/types/supabase.ts')
  assert.match(types, /record_purchase_notice_ack: \{\n\s+Args: \{\n\s+p_cart_texts_sha256\?: string/)
  assert.match(types, /consent_format: number/)
  assert.match(types, /terms_policy_sha256: string \| null/)
})

// 구현 검증 반영(rollout minor)
test('리허설 R7 은 마이그레이션 v_same 14개 + record_admin_audit 를 그대로 보고, R6 에 판 2 + down 경우가 있으며, down 머리말은 이력 행을 지우지 않는다고 적는다', async () => {
  const generator = await import('../supabase/scripts/bundle11_rehearsal/generate.mjs')
  const pairs = generator.unchangedFunctions()
  assert.equal(pairs.length, 15)
  const light = read('supabase/scripts/bundle11_rehearsal/a_light.sql')
  for (const [sig, md5] of pairs) {
    assert.ok(migration.includes(`ARRAY['${sig}', '${md5}']`) || scripts.keys.includes(`ARRAY['${sig}', '${md5}']`), sig)
    assert.ok(light.includes(`('${sig}', '${md5}')`), `R7 ${sig}`)
  }
  for (const name of ['a_light.sql', 'b_full.sql']) {
    assert.ok(read(`supabase/scripts/bundle11_rehearsal/${name}`).includes('DO $rh_r6_format2_down$'), name)
  }
  assert.match(down, /이 파일은 이력 행을 지우지 않는다/)
  assert.doesNotMatch(down, /DELETE FROM supabase_migrations/)
})

test('리허설 안전: 기록 함수에 넘기는 회원은 @test.com 시험 계정만(없으면 멈춤), light 는 실제 기록 표에 쓰는 옛 함수 호출이 거절 경로뿐', () => {
  const light = read('supabase/scripts/bundle11_rehearsal/a_light.sql')
  const userFn = light.slice(light.indexOf('CREATE FUNCTION pg_temp.rh_user()'), light.indexOf('CREATE FUNCTION pg_temp.rh_plan()'))
  assert.match(userFn, /AND u\.email LIKE '%@test\.com'/)
  assert.match(userFn, /RAISE EXCEPTION 'RH FAIL \[setup\] @test\.com 시험 계정이 없음/)
  assert.doesNotMatch(userFn, /ORDER BY \(u\.email/)
  // light 에서 실제 함수(public.record_*)를 부르는 곳은 모두 틀린 지문·2판 지문·입력 오류(거절 경로)다
  const calls = [...light.matchAll(/public\.record_(purchase_notice_ack|point_charge_checkout_ack)\(((?:v_user|pg_temp\.rh_user\(\)|NULL|p_user_id)[^;]*)\);/g)]
  assert.ok(calls.length >= 8)
  for (const match of calls) {
    assert.match(match[2], /repeat\('[0-9e]', 64\)|noticeSha256\}'|'x'|NULL, NULL/, match[0].slice(0, 160))
  }
  assert.doesNotMatch(light, /옛 자료 함수는 판을 보지 않고 1판 지문으로 기록/)
  assert.match(read('supabase/scripts/bundle11_rehearsal/b_full.sql'), /옛 자료 함수는 판을 보지 않고 1판 지문으로 기록/)
})
