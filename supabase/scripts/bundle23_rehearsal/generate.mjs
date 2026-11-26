// 23번 묶음 리허설 생성기(계획 docs/plan-bundle23-sales-csv.md 4-4: 실제 파일을 실행하고, 사본은 생성기로 만들어 계약 시험으로 고정).
//   node supabase/scripts/bundle23_rehearsal/generate.mjs           → 이 폴더의 *.sql 을 다시 쓴다
//   node supabase/scripts/bundle23_rehearsal/generate.mjs --check   → 다시 만든 값과 파일이 다르면 실패
// 실행(운영 DB, postgres): supabase db query --remote --yes -o json --file supabase/scripts/bundle23_rehearsal/<파일>
//   모든 파일은 BEGIN … 마지막 SELECT … ROLLBACK 이다(COMMIT 없음). 결과는 ON COMMIT DROP 임시 표 _rh_log 로 받는다.
//   경우마다 표지 예외(RH_ISOLATE)로 격리한다 — 경우 안에서 만든 행·기록은 그 경우가 끝나면 되돌려진다.
//   계정: @test.com 시험 계정만 쓴다(실회원 id 를 쓰지 않음). 가짜 주문·출처·원장 행은 그 시험 계정에만 만든다.
//   가짜 행의 시각은 실데이터가 없는 2025년(R3: 2025-11·12, R4: 2025-06)이고, 실데이터 기간(R2: 2026-11)은 읽기만 한다.
//   a_light.sql — 지금(낮) 돌려도 됨: 함수 4개 만들기·설정 행 INSERT 만(기존 표 DDL '[23번 기존 표 DDL]' 구역 — system_settings 정책 — 을 뺀 사본).
//     기존 표에는 새 행 INSERT 만(ROW EXCLUSIVE) 한다. 이력 표는 쓰지 않는다.
//   b_full.sql — DB 적용 직전(새벽): 원본 그대로(정책 포함) + 적용 절차(이력 INSERT)·down·이력 지우고 다시 적용(F).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const read = (path) => readFileSync(join(ROOT, path), 'utf8')

export const SOURCES = {
  migration: 'supabase/migrations/20261222100000_bundle23_sales_report.sql',
  down: 'supabase/rollback/20261222100000_bundle23_sales_report_down.sql',
}
export const MIGRATION_VERSION = '20261222100000'
export const MIGRATION_NAME = 'bundle23_sales_report'
// light 에 남으면 안 되는 글(기존 표를 잠그는 DDL·이력 표 쓰기·COMMIT)
export const LIGHT_FORBIDDEN = ['ALTER TABLE', 'CREATE TRIGGER', 'DROP TRIGGER', 'CREATE POLICY', 'DROP POLICY', 'LOCK TABLE', 'CREATE INDEX',
  'DROP TABLE', 'supabase_migrations', 'COMMIT;']
// 3-4 11월 대조 예시(운영 읽기, 2026-11-26). R2 가 함수 결과·RB-10 다시 계산 값과 함께 맞춰 본다.
export const NOVEMBER_EXAMPLE = {
  paymentCount: 5, paymentAmount: 60600, paymentVat: 5509,
  methods: { '네이버페이': [3, 49700, 4518], '신용·체크카드': [2, 10900, 991] },
  refundCount: 1, refundAmount: 1000, refundVat: 91, net: 59600, netVat: 5418,
  grants: { plan_purchase: [5, 63100], admin_grant: [4, 10200] },
  ledgerUsage: 48000, orderUsage: 43000, legacyRefund: [2, 5000], chargeRecovered: 100, adminRevoke: [3, 200],
}

const DDL_START = '[23번 기존 표 DDL] 시작'
const DDL_END = '[23번 기존 표 DDL] 끝'

function dollar(tag, text) {
  if (text.includes(`$${tag}$`)) throw new Error(`source contains $${tag}$`)
  return `$${tag}$${text}$${tag}$`
}
const sqlString = (text) => `'${text.replaceAll("'", "''")}'`

function assertLight(sql, label) {
  const body = sql.replace(/--[^\n]*/g, '')
  for (const word of LIGHT_FORBIDDEN) {
    if (body.includes(word)) throw new Error(`${label} still has ${word}`)
  }
}

// '[23번 기존 표 DDL]' 시작 줄부터 끝 줄까지 뺀다(표지 줄 포함).
export function stripExistingTableDdl(sql, label) {
  const lines = sql.split('\n')
  const start = lines.findIndex((line) => line.includes(DDL_START))
  const end = lines.findIndex((line) => line.includes(DDL_END))
  if (start < 0 || end < start) throw new Error(`${label}: DDL section markers missing`)
  const light = [...lines.slice(0, start), `-- (light 사본: ${DDL_START} ~ 끝 구역을 뺐다)`, ...lines.slice(end + 1)].join('\n')
  assertLight(light, label)
  return light
}

export const migrationSource = () => read(SOURCES.migration)
export const downSource = () => read(SOURCES.down)
export const migrationCopy = (mode) => (mode === 'light' ? stripExistingTableDdl(migrationSource(), 'migration') : migrationSource())
export const downCopy = (mode) => (mode === 'light' ? stripExistingTableDdl(downSource(), 'down') : downSource())

function prelude({ title, when, mode }) {
  return `-- 23번 묶음 리허설: ${title}
-- 생성 파일(손으로 고치지 않는다): node supabase/scripts/bundle23_rehearsal/generate.mjs 가 원본에서 만든다.
-- 실행: supabase db query --remote --yes -o json --file supabase/scripts/bundle23_rehearsal/<이 파일> (COMMIT 없음, 마지막 SELECT 가 결과)
-- 언제: ${when}
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '300s';
CREATE TEMP TABLE _rh_log (n serial PRIMARY KEY, test text NOT NULL, msg text NOT NULL, payload jsonb) ON COMMIT DROP;
CREATE TEMP TABLE _rh_ctx (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON _rh_log, _rh_ctx TO PUBLIC;
GRANT USAGE ON SEQUENCE _rh_log_n_seq TO PUBLIC;

CREATE FUNCTION pg_temp.ctx_set(p_k text, p_v text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO _rh_ctx (k, v) VALUES (p_k, p_v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v
$f$;
CREATE FUNCTION pg_temp.ctx(p_k text) RETURNS text LANGUAGE sql AS $f$ SELECT v FROM _rh_ctx WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.uid(p_k text) RETURNS uuid LANGUAGE sql AS $f$ SELECT v::uuid FROM _rh_ctx WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.fail(p_test text, p_msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  RAISE EXCEPTION 'RH FAIL [%] %', p_test, left(p_msg, 850);
END $f$;
CREATE FUNCTION pg_temp.try_sql(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR ' || left(SQLERRM, 300) || ' [' || SQLSTATE || ']';
END $f$;
CREATE FUNCTION pg_temp.try_json(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v jsonb;
BEGIN
  EXECUTE p_sql INTO v;
  RETURN 'OK ' || coalesce(v::text, 'null');
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR ' || left(SQLERRM, 300) || ' [' || SQLSTATE || ']';
END $f$;
CREATE FUNCTION pg_temp.res(p_result text) RETURNS jsonb LANGUAGE sql AS $f$ SELECT substr(p_result, 4)::jsonb $f$;
CREATE FUNCTION pg_temp.expect(p_actual text, p_prefix text, p_test text, p_msg text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_actual IS NULL OR p_actual NOT LIKE p_prefix || '%' THEN
    PERFORM pg_temp.fail(p_test, p_msg || ' — 기대 "' || p_prefix || '", 실제 "' || left(coalesce(p_actual, 'NULL'), 400) || '"');
  END IF;
  RETURN p_msg || ' → ' || left(p_actual, 160);
END $f$;
CREATE FUNCTION pg_temp.ensure(p_cond boolean, p_test text, p_msg text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_cond IS NOT TRUE THEN
    PERFORM pg_temp.fail(p_test, p_msg);
  END IF;
  RETURN p_msg;
END $f$;
CREATE FUNCTION pg_temp.eq(p_actual numeric, p_expected numeric, p_test text, p_msg text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    PERFORM pg_temp.fail(p_test, p_msg || ' — 기대 ' || coalesce(p_expected::text, 'NULL') || ', 실제 ' || coalesce(p_actual::text, 'NULL'));
  END IF;
  RETURN p_msg || ' = ' || coalesce(p_actual::text, 'NULL');
END $f$;
-- 한국 날짜 → 그날 0시(KST)
CREATE FUNCTION pg_temp.kst(p_day text) RETURNS timestamptz LANGUAGE sql AS $f$ SELECT (p_day || ' 00:00:00+09')::timestamptz $f$;
-- 함수 결과에서 합 꺼내기
CREATE FUNCTION pg_temp.day_sum(p_charge jsonb, p_key text) RETURNS numeric LANGUAGE sql AS $f$
  SELECT COALESCE(sum((d ->> p_key)::numeric), 0) FROM jsonb_array_elements(p_charge -> 'days') d
$f$;
CREATE FUNCTION pg_temp.method_sum(p_charge jsonb, p_label text, p_key text) RETURNS numeric LANGUAGE sql AS $f$
  SELECT COALESCE(sum((m ->> p_key)::numeric), 0) FROM jsonb_array_elements(p_charge -> 'days') d, jsonb_array_elements(d -> 'byMethod') m
   WHERE m ->> 'label' = p_label
$f$;
CREATE FUNCTION pg_temp.flow(p_flow jsonb, p_line text, p_key text, p_category text DEFAULT NULL) RETURNS numeric LANGUAGE sql AS $f$
  SELECT COALESCE(sum((l ->> p_key)::numeric), 0) FROM jsonb_array_elements(p_flow -> 'lines') l
   WHERE l ->> 'line' = p_line AND (p_category IS NULL OR l ->> 'category' = p_category)
$f$;
CREATE FUNCTION pg_temp.usage_cat(p_usage jsonb, p_section text, p_category text, p_key text) RETURNS numeric LANGUAGE sql AS $f$
  SELECT COALESCE(sum((r ->> p_key)::numeric), 0) FROM jsonb_array_elements(p_usage -> p_section -> 'rows') r WHERE r ->> 'category' = p_category
$f$;
CREATE FUNCTION pg_temp.has_warning(p_json jsonb, p_code text) RETURNS boolean LANGUAGE sql AS $f$
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(p_json -> 'warnings') w WHERE w ->> 'code' = p_code)
$f$;

SELECT pg_temp.ctx_set('src_migration', ${dollar('rh_src_migration', migrationCopy(mode))});
SELECT pg_temp.ctx_set('src_down', ${dollar('rh_src_down', downCopy(mode))});
`
}

const SETUP = `
-- ===== 계정(@test.com 시험 계정 2개)·결제수단·상품(읽기만) =====
DO $rh_setup$
DECLARE
  v_pool uuid[];
  v_item uuid;
  v_item_subject text;
BEGIN
  SELECT coalesce(array_agg(p.id ORDER BY u.created_at), '{}') INTO v_pool
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE u.email LIKE '%@test.com' AND p.withdrawn_at IS NULL AND p.is_admin IS NOT TRUE AND p.signup_completed IS TRUE;
  IF cardinality(v_pool) < 2 THEN
    RAISE EXCEPTION 'RH FAIL [setup] @test.com 시험 계정이 모자람(%개, 필요 2) — 실회원 id 로 대신하지 않고 멈춘다', cardinality(v_pool);
  END IF;
  PERFORM pg_temp.ctx_set('U', v_pool[1]::text);
  PERFORM pg_temp.ctx_set('A', v_pool[2]::text);
  IF NOT EXISTS (SELECT 1 FROM public.payment_methods WHERE code = 'card' AND provider = 'payapp') THEN
    RAISE EXCEPTION 'RH FAIL [setup] payapp card 결제수단 없음';
  END IF;
  SELECT i.id, i.workspace_subject INTO v_item, v_item_subject FROM public.market_items i ORDER BY i.created_at LIMIT 1;
  IF v_item IS NULL THEN
    RAISE EXCEPTION 'RH FAIL [setup] 상품 행 없음(자료 환불 가짜 행의 FK)';
  END IF;
  PERFORM pg_temp.ctx_set('item', v_item::text);
  PERFORM pg_temp.ctx_set('item_subject', v_item_subject);
  INSERT INTO _rh_log (test, msg) VALUES ('setup', '시험 계정 2개·결제수단·상품 id 확인');
END
$rh_setup$;

-- 가짜 충전 주문(payapp live): 'OK id' 로 돌려준다
CREATE FUNCTION pg_temp.fake_order(p_user uuid, p_amount integer, p_status text, p_approved timestamptz, p_method text DEFAULT 'card',
                                   p_created timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_id uuid;
  v_key text := 'rh23-' || gen_random_uuid()::text;
BEGIN
  INSERT INTO public.payment_orders (user_id, order_id, plan_name_snapshot, expected_amount, expected_credits, provider, environment,
                                     provider_environment, provider_merchant_id, status, confirm_idempotency_key, cancel_idempotency_key,
                                     expires_at, checkout_expires_at, approved_at, tax_free_amount, vat_amount, payment_method_code, created_at)
  VALUES (p_user, v_key, 'rh23 요금제', p_amount, p_amount / 10, 'payapp', 'live', 'live', 'rh23-merchant', p_status, v_key || '-c', v_key || '-x',
          COALESCE(p_approved, now()) + interval '1 hour', COALESCE(p_approved, now()) + interval '1 hour', p_approved, 0,
          round(p_amount::numeric / 11)::integer, p_method, COALESCE(p_created, p_approved - interval '1 minute', now()))
  RETURNING id INTO v_id;
  RETURN v_id;
END $f$;
CREATE FUNCTION pg_temp.fake_source(p_user uuid, p_category text, p_initial integer, p_remaining integer, p_created timestamptz,
                                    p_expires timestamptz DEFAULT NULL, p_order uuid DEFAULT NULL, p_status text DEFAULT 'active')
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.credit_sources (user_id, initial_credits, remaining_credits, status, source_category, payment_order_id, expires_at,
                                     purchased_at, created_at)
  VALUES (p_user, p_initial, p_remaining, p_status, p_category, p_order, p_expires, p_created, p_created)
  RETURNING id INTO v_id;
  RETURN v_id;
END $f$;
CREATE FUNCTION pg_temp.fake_ledger(p_user uuid, p_type text, p_amount integer, p_source uuid, p_resource text, p_at timestamptz)
RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.credit_transactions (user_id, type, amount, balance_after, description, source_id, resource_type, created_at)
  VALUES (p_user, p_type, p_amount, 0, 'rh23', p_source, p_resource, p_at)
$f$;
CREATE FUNCTION pg_temp.fake_consumption(p_user uuid, p_source uuid, p_amount integer, p_at timestamptz) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.credit_consumption (user_id, source_id, amount, resource_type, description, created_at)
  VALUES (p_user, p_source, p_amount, 'market_purchase_subproduct_v2', 'rh23', p_at)
$f$;
`

function isolatedCase(tag, test, body) {
  return `
DO $${tag}$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_k jsonb;
  v_before jsonb;
  v_after jsonb;
  v_usage jsonb;
  v_t timestamptz;
  v_ms numeric;
  v_u uuid := pg_temp.uid('U');
  v_a uuid := pg_temp.uid('A');
  v_item uuid := pg_temp.uid('item');
  v_subject text := pg_temp.ctx('item_subject');
  v_o1 uuid; v_o2 uuid; v_o3 uuid; v_o4 uuid; v_o5 uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_e1 uuid; v_e2 uuid; v_e3 uuid; v_w uuid; v_l uuid; v_rs uuid;
  v_mo1 uuid; v_mo2 uuid; v_mr1 uuid; v_mr2 uuid; v_rr uuid;
BEGIN
  BEGIN
${body}
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT ${sqlString(test)}, m FROM unnest(v_log) m;
END
$${tag}$;
`
}

const N = NOVEMBER_EXAMPLE
const NOV = `pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01')`

// R1: 적용(위에서 끝남) → down → 남는 것 0 → 다시 적용(VERIFY 통과)
const R1 = isolatedCase('rh_r1', 'R1', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'R1', 'down');
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('report_charge_daily', 'report_payment_lines', 'report_credit_flow', 'report_credit_usage_value'))
      AND NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'sales_report_content'), 'R1', '남는 함수·설정 행 0');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK', 'R1', '없을 때 down 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'R1', '다시 적용(VERIFY 통과)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'ERR PRECHECK: bundle 23 report functions already exist', 'R1', '두 번 적용 멈춤');`)

// R2: 2026-11 결과 = RB-10 9-1·9-2·9-3 다시 계산(읽기 전용) = 3-4 표
const R2 = isolatedCase('rh_r2', 'R2', `
    v_j := public.report_charge_daily(${NOV});
    v_k := public.report_credit_flow(${NOV});
    -- RB-10 9-1·9-2·9-3 을 여기서 다시 계산
    v_before := (SELECT jsonb_build_object('n', count(*), 'amount', COALESCE(sum(po.expected_amount), 0), 'vat', COALESCE(sum(po.vat_amount), 0))
                   FROM public.payment_orders po
                  WHERE po.provider = 'payapp' AND po.provider_environment = 'live' AND po.status IN ('completed', 'refunded')
                    AND po.approved_at IS NOT NULL AND po.approved_at >= pg_temp.kst('2026-11-01') AND po.approved_at < pg_temp.kst('2026-12-01'));
    v_after := (SELECT jsonb_build_object('n', count(*), 'amount', COALESCE(sum(rr.refund_amount), 0))
                  FROM public.refund_requests rr
                 WHERE rr.provider = 'payapp' AND rr.status = 'completed'
                   AND COALESCE(rr.provider_cancelled_at, rr.processed_at) >= pg_temp.kst('2026-11-01')
                   AND COALESCE(rr.provider_cancelled_at, rr.processed_at) < pg_temp.kst('2026-12-01'));
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'paymentCount'), (v_before ->> 'n')::numeric, 'R2', '결제 건수 = RB-10 9-1');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'paymentAmount'), (v_before ->> 'amount')::numeric, 'R2', '결제 금액 = RB-10 9-1');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'paymentVat'), (v_before ->> 'vat')::numeric, 'R2', '부가세 = 저장된 vat_amount 합');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'refundCount'), (v_after ->> 'n')::numeric, 'R2', '환불 건수 = RB-10 9-2');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'refundAmount'), (v_after ->> 'amount')::numeric, 'R2', '환불 금액 = RB-10 9-2');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'manualRefundCount'),
      (SELECT count(*) FROM public.payment_admin_actions a JOIN public.refund_requests rr ON rr.id = a.refund_request_id
        WHERE a.external_method IS NOT NULL AND rr.provider = 'payapp' AND rr.status = 'completed'
          AND COALESCE(rr.provider_cancelled_at, rr.processed_at) >= pg_temp.kst('2026-11-01')
          AND COALESCE(rr.provider_cancelled_at, rr.processed_at) < pg_temp.kst('2026-12-01')), 'R2', '수동 처리 환불 = RB-10 9-3(환불 요청 있는 줄)');
    -- 3-4 표(2026-11-26 운영 읽기)
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'paymentCount'), ${N.paymentCount}, 'R2', '3-4 결제 건수');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'paymentAmount'), ${N.paymentAmount}, 'R2', '3-4 결제 금액');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'paymentVat'), ${N.paymentVat}, 'R2', '3-4 부가세');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'paymentAmount') - pg_temp.day_sum(v_j, 'paymentVat'), ${N.paymentAmount - N.paymentVat}, 'R2', '3-4 공급가액');
${Object.entries(N.methods).map(([label, [n, amount, vat]]) => `    v_log := v_log || pg_temp.eq(pg_temp.method_sum(v_j, ${sqlString(label)}, 'count'), ${n}, 'R2', '3-4 ${label} 건수');
    v_log := v_log || pg_temp.eq(pg_temp.method_sum(v_j, ${sqlString(label)}, 'amount'), ${amount}, 'R2', '3-4 ${label} 금액');
    v_log := v_log || pg_temp.eq(pg_temp.method_sum(v_j, ${sqlString(label)}, 'vat'), ${vat}, 'R2', '3-4 ${label} 부가세');`).join('\n')}
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'refundCount'), ${N.refundCount}, 'R2', '3-4 환불 건수');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'refundAmount'), ${N.refundAmount}, 'R2', '3-4 환불 금액');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'refundVat'), ${N.refundVat}, 'R2', '3-4 환불 부가세');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'paymentAmount') - pg_temp.day_sum(v_j, 'refundAmount'), ${N.net}, 'R2', '3-4 순액');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'paymentVat') - pg_temp.day_sum(v_j, 'refundVat'), ${N.netVat}, 'R2', '3-4 순 부가세');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'manualRefundCount'), 0, 'R2', '3-4 수동 처리 환불 0건');
    v_log := v_log || pg_temp.eq((v_j -> 'warnings' ->> 'manualReviewOrders')::numeric, 0, 'R2', '3-4 수동 확인 주문 0건');
    v_log := v_log || pg_temp.eq((v_j -> 'warnings' ->> 'fullRefundVatMismatch')::numeric, 0, 'R2', '전액 환불 부가세 = 원 주문 부가세');
    v_log := v_log || pg_temp.eq(jsonb_array_length(v_j -> 'days'), 30, 'R2', '11월 30일 0 채움');
    -- 건별 합 = 요약
    v_log := v_log || pg_temp.eq((SELECT COALESCE(sum(amount), 0) FROM public.report_payment_lines(${NOV}) WHERE line_kind = 'payment'),
      pg_temp.day_sum(v_j, 'paymentAmount'), 'R2', '건별 결제 합 = 요약');
    v_log := v_log || pg_temp.eq((SELECT COALESCE(sum(vat), 0) FROM public.report_payment_lines(${NOV}) WHERE line_kind = 'refund'),
      pg_temp.day_sum(v_j, 'refundVat'), 'R2', '건별 환불 부가세 합 = 요약');
    v_log := v_log || pg_temp.eq((SELECT count(*) FROM public.report_payment_lines(${NOV}) WHERE line_kind = 'payment' AND payment_request_id IS NULL), 0,
      'R2', '결제 줄마다 결제요청번호 있음');
    -- 크레딧(3-4)
${Object.entries(N.grants).map(([category, [n, credits]]) => `    v_log := v_log || pg_temp.eq(pg_temp.flow(v_k, 'grant', 'count', ${sqlString(category)}), ${n}, 'R2', '3-4 지급 ${category} 건수');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_k, 'grant', 'credits', ${sqlString(category)}), ${credits}, 'R2', '3-4 지급 ${category} C');`).join('\n')}
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_k, 'market_usage_ledger', 'credits'), ${N.ledgerUsage}, 'R2', '3-4 자료 구매 사용(원장)');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_k, 'market_usage_order', 'credits'), ${N.orderUsage}, 'R2', '3-4 자료 구매 사용(주문 표)');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_k, 'market_usage_without_order', 'credits'), ${N.ledgerUsage - N.orderUsage}, 'R2', '3-4 주문 행 없는 사용');
    v_log := v_log || pg_temp.ensure(pg_temp.has_warning(v_k, 'usage_without_order'), 'R2', '주문 행 없는 사용 경고');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_k, 'market_refund_legacy', 'count'), ${N.legacyRefund[0]}, 'R2', '3-4 자료 환불 옛 방식 건수');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_k, 'market_refund_legacy', 'credits'), ${N.legacyRefund[1]}, 'R2', '3-4 자료 환불 옛 방식 C');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_k, 'charge_refund_recovered', 'credits'), ${N.chargeRecovered}, 'R2', '3-4 충전 환불 회수');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_k, 'admin_revoke', 'count'), ${N.adminRevoke[0]}, 'R2', '3-4 관리자 회수 건수');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_k, 'admin_revoke', 'credits'), ${N.adminRevoke[1]}, 'R2', '3-4 관리자 회수 C');
    v_log := v_log || pg_temp.ensure(NOT pg_temp.has_warning(v_k, 'revoke_count_mismatch'), 'R2', '관리자 회수 기록 수 = 원장 회수 행 수');
    -- 참고 금액: 총사용 C = 원장 자료 구매 사용(3-3)
    v_usage := public.report_credit_usage_value(${NOV});
    v_log := v_log || pg_temp.eq((v_usage -> 'gross' ->> 'credits')::numeric, ${N.ledgerUsage}, 'R2', '참고 금액 총사용 C = 원장 사용');
    INSERT INTO _rh_log (test, msg, payload) VALUES ('R2', '11월 크레딧 흐름·참고 금액(참고)', jsonb_build_object('flow', v_k, 'usage', v_usage));`)

// R3: 경계·제외·빈 환불 금액(가짜 주문, 2025-11·12)
const R3 = isolatedCase('rh_r3', 'R3', `
    v_before := public.report_charge_daily(pg_temp.kst('2025-11-01'), pg_temp.kst('2025-12-01'));
    v_after := public.report_charge_daily(pg_temp.kst('2025-12-01'), pg_temp.kst('2026-01-01'));
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_before, 'paymentCount') + pg_temp.day_sum(v_after, 'paymentCount'), 0, 'R3', '2025-11·12 실데이터 0건(가짜만 셈)');
    v_o1 := pg_temp.fake_order(v_u, 1100, 'completed', '2025-11-30 23:59:59+09');
    v_o2 := pg_temp.fake_order(v_u, 2200, 'completed', '2025-12-01 00:00:00+09');
    v_o3 := pg_temp.fake_order(v_u, 3300, 'refunded', '2025-11-15 12:00:00+09');
    v_o4 := pg_temp.fake_order(v_u, 4400, 'manual_review', '2025-11-20 12:00:00+09');
    v_o5 := pg_temp.fake_order(v_u, 5500, 'failed', '2025-11-21 12:00:00+09');
    -- 지급 대기(승인 시각이 아직 빔 — 지급 때 채워짐): 합계에 없고 경고로만
    PERFORM pg_temp.fake_order(v_u, 7700, 'fulfillment_pending', NULL, 'card', '2025-11-25 12:00:00+09');
    -- test 주문(카카오페이 test 환경)은 payapp 이 아니어서 빠진다
    INSERT INTO public.payment_orders (user_id, order_id, plan_name_snapshot, expected_amount, expected_credits, provider, environment,
                                       provider_environment, provider_merchant_id, status, confirm_idempotency_key, cancel_idempotency_key,
                                       expires_at, checkout_expires_at, approved_at, tax_free_amount, vat_amount)
    VALUES (v_u, 'rh23-test-env', 'rh23', 6600, 660, 'kakaopay', 'test', 'test', 'rh23-kakao', 'completed', 'rh23-test-c', 'rh23-test-x',
            now() + interval '1 hour', now() + interval '1 hour', '2025-11-22 12:00:00+09', 0, 600);
    v_s1 := pg_temp.fake_source(v_u, 'plan_purchase', 330, 0, '2025-11-15 12:00:00+09', NULL, v_o3, 'refunded');
    -- 11월 결제·12월 환불(결제사 취소 시각 12-02, 처리 시각 11-30 — 취소 시각이 먼저)
    INSERT INTO public.refund_requests (user_id, source_id, status, payment_order_id, refund_amount, provider, origin, provider_cancelled_at, processed_at)
    VALUES (v_u, v_s1, 'completed', v_o3, 3300, 'payapp', 'user', '2025-12-02 10:00:00+09', '2025-11-30 10:00:00+09');
    v_j := public.report_charge_daily(pg_temp.kst('2025-11-01'), pg_temp.kst('2025-12-01'));
    v_k := public.report_charge_daily(pg_temp.kst('2025-12-01'), pg_temp.kst('2026-01-01'));
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'paymentCount'), 2, 'R3', '11월: 11-30 23:59:59 주문 + 11월 결제·12월 환불 주문(manual_review·failed·test 제외)');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'paymentAmount'), 4400, 'R3', '11월 결제 금액 1,100 + 3,300');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'refundCount'), 0, 'R3', '11월 환불 0(취소 시각이 12월)');
    v_log := v_log || pg_temp.eq((SELECT (d ->> 'paymentAmount')::numeric FROM jsonb_array_elements(v_j -> 'days') d WHERE d ->> 'day' = '2025-11-30'), 1100,
      'R3', '23:59:59 KST 는 11-30 줄');
    v_log := v_log || pg_temp.eq((v_j -> 'warnings' ->> 'manualReviewOrders')::numeric, 1, 'R3', '수동 확인 주문 경고 1');
    v_log := v_log || pg_temp.eq((v_j -> 'warnings' ->> 'fulfillmentPendingOrders')::numeric
      - (SELECT count(*) FROM public.payment_orders po WHERE po.provider = 'payapp' AND po.provider_environment = 'live'
           AND po.status = 'fulfillment_pending' AND po.order_id NOT LIKE 'rh23-%' AND po.created_at < pg_temp.kst('2025-12-01')), 1,
      'R3', '지급 대기 결제 경고 +1(합계에는 없음)');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_k, 'paymentCount'), 1, 'R3', '12월: 12-01 00:00 주문');
    v_log := v_log || pg_temp.eq((SELECT (d ->> 'paymentAmount')::numeric FROM jsonb_array_elements(v_k -> 'days') d WHERE d ->> 'day' = '2025-12-01'), 2200,
      'R3', '00:00 KST 는 12-01 줄');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_k, 'refundAmount'), 3300, 'R3', '12월 환불 3,300');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_k, 'refundVat'), 300, 'R3', '환불 부가세 round(3,300/11)');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_k, 'paymentAmount') - pg_temp.day_sum(v_k, 'refundAmount'), -1100, 'R3', '12월 순액 음수 −1,100');
    v_log := v_log || pg_temp.eq((SELECT count(*) FROM public.report_payment_lines(pg_temp.kst('2025-12-01'), pg_temp.kst('2026-01-01'))
        WHERE line_kind = 'refund' AND paid_at = '2025-11-15 12:00:00+09' AND refund_origin = 'user'), 1, 'R3', '환불 줄의 결제 시각은 원 주문(11월)');
    -- 빈 환불 금액 → 그 기간 결제 기준 전체 예외
    INSERT INTO public.refund_requests (user_id, source_id, status, payment_order_id, refund_amount, provider, origin, processed_at)
    VALUES (v_u, v_s1, 'completed', v_o2, NULL, 'payapp', 'user', '2025-12-10 10:00:00+09');
    v_log := v_log || pg_temp.expect(pg_temp.try_json('SELECT public.report_charge_daily(pg_temp.kst(''2025-12-01''), pg_temp.kst(''2026-01-01''))'),
      'ERR REFUND_AMOUNT_MISSING', 'R3', '빈 환불 금액 → 요약 예외');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('SELECT * FROM public.report_payment_lines(pg_temp.kst(''2025-12-01''), pg_temp.kst(''2026-01-01''))'),
      'ERR REFUND_AMOUNT_MISSING', 'R3', '빈 환불 금액 → 건별 예외');
    v_log := v_log || pg_temp.expect(pg_temp.try_json('SELECT public.report_charge_daily(pg_temp.kst(''2025-11-01''), pg_temp.kst(''2025-12-01''))'),
      'OK', 'R3', '다른 기간(11월)은 그대로');`)

// R4: 크레딧 흐름·참고 금액(가짜 출처·주문, 2025-06)
const JUNE = `pg_temp.kst('2025-06-01'), pg_temp.kst('2025-07-01')`
const R4 = isolatedCase('rh_r4', 'R4', `
    v_before := public.report_credit_flow(${JUNE});
    v_usage := public.report_credit_usage_value(${JUNE});
    v_log := v_log || pg_temp.eq((v_usage -> 'gross' ->> 'credits')::numeric + (v_usage -> 'refund' ->> 'credits')::numeric, 0, 'R4', '2025-06 실데이터 사용 0(가짜만 셈)');
    -- 유상 출처: S2 = 9,900원 / 1,000 C(단가 9.9), S1 = 미사용 자동 환불, E3 = 만료 뒤 수동 환불로 0 된 유상 출처
    v_o1 := pg_temp.fake_order(v_u, 9900, 'completed', '2025-06-02 10:00:00+09');
    v_o2 := pg_temp.fake_order(v_u, 1000, 'refunded', '2025-06-02 11:00:00+09');
    v_o3 := pg_temp.fake_order(v_u, 5000, 'completed', '2025-05-01 10:00:00+09');
    v_s2 := pg_temp.fake_source(v_u, 'plan_purchase', 1000, 267, '2025-06-02 10:00:00+09', '2026-06-02 10:00:00+09', v_o1);
    v_s1 := pg_temp.fake_source(v_u, 'plan_purchase', 100, 0, '2025-06-02 11:00:00+09', '2026-06-02 11:00:00+09', v_o2, 'refunded');
    v_e3 := pg_temp.fake_source(v_u, 'plan_purchase', 500, 0, '2025-05-01 10:00:00+09', '2025-06-20 00:00:00+09', v_o3);
    -- 무상·옛 출처: E1 관리자 지급(기간 안 만료, 잔량 300), E2 관리자 지급(기간 밖 만료), L 주문 없는 옛 요금제 구매, W 탈퇴로 0 된 만료 출처
    v_e1 := pg_temp.fake_source(v_u, 'admin_grant', 500, 300, '2025-06-03 10:00:00+09', '2025-06-15 00:00:00+09');
    v_e2 := pg_temp.fake_source(v_u, 'admin_grant', 400, 400, '2025-06-03 10:00:00+09', '2025-07-05 00:00:00+09');
    v_l := pg_temp.fake_source(v_u, 'plan_purchase', 200, 130, '2025-06-04 10:00:00+09');
    v_w := pg_temp.fake_source(v_a, 'bonus', 120, 0, '2025-05-01 10:00:00+09', '2025-06-10 00:00:00+09');
    -- 시험 환경(카카오페이 test) 결제에 이어진 요금제 구매 출처 T: 'paid' 가 아니라 시험 결제(0원) + 경고
    INSERT INTO public.payment_orders (user_id, order_id, plan_name_snapshot, expected_amount, expected_credits, provider, environment,
                                       provider_environment, provider_merchant_id, status, confirm_idempotency_key, cancel_idempotency_key,
                                       expires_at, checkout_expires_at, approved_at, tax_free_amount, vat_amount)
    VALUES (v_u, 'rh23-r4-test-env', 'rh23', 2900, 290, 'kakaopay', 'test', 'test', 'rh23-kakao', 'completed', 'rh23-r4-test-c', 'rh23-r4-test-x',
            now() + interval '1 hour', now() + interval '1 hour', '2025-06-01 12:00:00+09', 0, 264) RETURNING id INTO v_o4;
    v_o5 := (SELECT pg_temp.fake_source(v_u, 'plan_purchase', 290, 280, '2025-06-01 12:00:00+09', '2026-06-01 12:00:00+09', v_o4));

    -- 미사용 자동 환불(S1 전체 100 회수) + 사용분 있는 수동 환불(S2 잔량만 400 회수) + 자손 회수(재지급 출처 RS 에서 20)
    v_rr := (SELECT id FROM (SELECT gen_random_uuid() AS id) x);
    INSERT INTO public.refund_requests (id, user_id, source_id, status, payment_order_id, refund_amount, provider, origin, provider_cancelled_at, processed_at)
    VALUES (v_rr, v_u, v_s1, 'completed', v_o2, 1000, 'payapp', 'user', '2025-06-05 10:00:00+09', '2025-06-05 10:00:00+09');
    PERFORM pg_temp.fake_ledger(v_u, 'refund', -100, v_s1, 'refund_request', '2025-06-05 10:00:00+09');

    -- 자료 구매 주문 MO1(S2 333 + E1 100 = 433 C)
    INSERT INTO public.market_purchase_orders (workspace_subject, user_id, item_id, purchase_type, original_price_credits, charged_credits, status,
                                               credit_consumptions, created_at)
    VALUES (v_subject, v_u, v_item, 'subproduct', 433, 433, 'completed',
            jsonb_build_array(jsonb_build_object('source_id', v_s2, 'amount', 333), jsonb_build_object('source_id', v_e1, 'amount', 100)),
            '2025-06-06 10:00:00+09') RETURNING id INTO v_mo1;
    PERFORM pg_temp.fake_consumption(v_u, v_s2, 333, '2025-06-06 10:00:00+09');
    PERFORM pg_temp.fake_consumption(v_u, v_e1, 100, '2025-06-06 10:00:00+09');
    PERFORM pg_temp.fake_ledger(v_u, 'consume', -433, NULL, 'market_purchase_subproduct_v2', '2025-06-06 10:00:00+09');
    -- 옛 방식 자료 환불(allocated_items 없음, 55 C 승인 → S2 70: E1 30 비율 = 39·16)
    INSERT INTO public.market_purchase_orders (workspace_subject, user_id, item_id, purchase_type, original_price_credits, charged_credits, status,
                                               credit_consumptions, created_at)
    VALUES (v_subject, v_u, v_item, 'subproduct', 100, 100, 'completed',
            jsonb_build_array(jsonb_build_object('source_id', v_s2, 'amount', 70), jsonb_build_object('sourceId', v_e1, 'amount', 30)),
            '2025-05-20 10:00:00+09') RETURNING id INTO v_mo2;
    INSERT INTO public.market_refund_requests (workspace_subject, user_id, item_id, target_kind, order_id, requested_refund_credits,
                                               approved_refund_credits, status, refund_kind, processed_at)
    VALUES (v_subject, v_u, v_item, 'v2_order', v_mo2, 55, 55, 'approved', 'partial', '2025-06-07 10:00:00+09') RETURNING id INTO v_mr2;
    -- 새 방식 자료 환불: S2 restored 100, S2 reissued 50(새 출처 RS, 뿌리 S2), unmatched unrecovered 30
    INSERT INTO public.market_refund_requests (workspace_subject, user_id, item_id, target_kind, order_id, requested_refund_credits,
                                               approved_refund_credits, status, refund_kind, processed_at, allocated_items)
    VALUES (v_subject, v_u, v_item, 'v2_order', v_mo1, 180, 150, 'approved', 'partial', '2025-06-08 10:00:00+09', '[]'::jsonb)
    RETURNING id INTO v_mr1;
    v_rs := pg_temp.fake_source(v_u, 'system_refund', 50, 0, '2025-06-08 10:00:00+09', '2025-07-08 10:00:00+09');
    UPDATE public.market_refund_requests SET allocated_items = jsonb_build_array(
        jsonb_build_object('source_id', v_s2, 'taken', 100, 'restored', 100, 'reissued', 0, 'unrecovered', 0),
        jsonb_build_object('source_id', v_s2, 'taken', 50, 'restored', 0, 'reissued', 50, 'unrecovered', 0, 'reissued_source_id', v_rs),
        jsonb_build_object('source_id', NULL, 'taken', 30, 'restored', 0, 'reissued', 0, 'unrecovered', 30, 'reason', 'unmatched'))
     WHERE id = v_mr1;
    INSERT INTO public.market_refund_reissued_sources (source_id, request_id, original_source_id, created_at)
    VALUES (v_rs, v_mr1, v_s2, '2025-06-08 10:00:00+09');
    -- 재지급 출처 RS 를 다른 구매에서 30 사용(뿌리 S2 단가) — 그 구매는 주문 행 없이(옛 시험 흔적처럼) 원장·차감만
    PERFORM pg_temp.fake_consumption(v_u, v_rs, 30, '2025-06-09 10:00:00+09');
    PERFORM pg_temp.fake_ledger(v_u, 'consume', -30, v_rs, 'market_purchase_subproduct_v2', '2025-06-09 10:00:00+09');
    -- 주문 없는 옛 요금제 구매 출처 L 70 사용(단가 알 수 없음)
    PERFORM pg_temp.fake_consumption(v_u, v_l, 70, '2025-06-09 11:00:00+09');
    PERFORM pg_temp.fake_ledger(v_u, 'consume', -70, v_l, 'market_purchase_subproduct_v2', '2025-06-09 11:00:00+09');
    -- 시험 결제 출처 T 10 사용(주문 행 없이)
    PERFORM pg_temp.fake_consumption(v_u, v_o5, 10, '2025-06-09 12:00:00+09');
    PERFORM pg_temp.fake_ledger(v_u, 'consume', -10, v_o5, 'market_purchase_subproduct_v2', '2025-06-09 12:00:00+09');
    -- 수동 충전 환불: S2 잔량 400 회수(사용분 있음, 부분 환불 400원) + 자손 RS 20 회수 + E3 만료 잔량 250 정리(expired_cleared)
    INSERT INTO public.refund_requests (user_id, source_id, status, payment_order_id, refund_amount, provider, origin, processed_at)
    VALUES (v_u, v_s2, 'completed', v_o1, 4000, 'payapp', 'partial_cancel', '2025-06-25 10:00:00+09') RETURNING id INTO v_rr;
    PERFORM pg_temp.fake_ledger(v_u, 'refund', -400, v_s2, 'refund_request', '2025-06-25 10:00:00+09');
    PERFORM pg_temp.fake_ledger(v_u, 'refund', -20, v_rs, 'refund_request', '2025-06-25 10:00:00+09');
    INSERT INTO public.payment_admin_actions (actor_id, action, payment_order_id, refund_request_id, note, recovered_credits, unrecovered_credits,
                                              external_method, details, created_at)
    VALUES (v_a, 'manual_refund_completed', v_o1, v_rr, 'rh23', 420, 0, 'bank_transfer',
            jsonb_build_object('sources', jsonb_build_array(
              jsonb_build_object('source_id', v_s2, 'recovered', 400, 'expired_cleared', 0),
              jsonb_build_object('source_id', v_rs, 'recovered', 20, 'expired_cleared', 0),
              jsonb_build_object('source_id', v_e3, 'recovered', 0, 'expired_cleared', 250))),
            '2025-06-25 10:00:00+09');
    -- 결제 회원 탈퇴(대표 경로)로 0 된 만료 출처 W: 작업 기록 member_withdraw 의 expired_cleared 120(탈퇴 시각 6-26)
    INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, target_user_id, amount, details, created_at)
    VALUES (v_a, 'member_withdraw', 'profile', v_a::text, v_a, 0, jsonb_build_object('method', 'owner', 'expired_cleared', 120, 'forfeited_paid', 0, 'forfeited_free', 0),
            '2025-06-26 10:00:00+09');

    v_after := public.report_credit_flow(${JUNE});
    v_usage := public.report_credit_usage_value(${JUNE});
    INSERT INTO _rh_log (test, msg, payload) VALUES ('R4', '2025-06 결과(참고)', jsonb_build_object('flow', v_after, 'usage', v_usage));
    -- 충전 환불 회수 = 실제 회수량(미사용 자동 100 + 수동 잔량 400 + 자손 20), initial_credits 가 아님
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_after, 'charge_refund_recovered', 'credits') - pg_temp.flow(v_before, 'charge_refund_recovered', 'credits'), 520,
      'R4', '충전 환불 회수 520(100 + 잔량 400 + 자손 20)');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_after, 'charge_refund_recovered', 'credits', 'system_refund'), 20, 'R4', '자손 회수는 재지급 분류 줄');
    -- 만료: E1 잔량 300(관리자 지급) + E3 정리분 250(요금제 구매), E2(기간 밖)·W(탈퇴 정리) 빠짐
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_after, 'expired', 'credits', 'admin_grant'), 300, 'R4', '기간 안 만료 잔량 300, 기간 밖 만료 제외');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_after, 'expired', 'credits', 'plan_purchase'), 250, 'R4', '만료 뒤 수동 환불로 0 된 출처 = expired_cleared 로 복원');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_after, 'expired', 'credits', 'bonus'), 0, 'R4', '탈퇴로 0 된 만료 출처는 만료 줄에서 빠짐');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_after, 'withdrawal_expired_cleared', 'credits'), 120, 'R4', '탈퇴 때 정리된 만료 잔량 120(탈퇴 시각 줄)');
    v_log := v_log || pg_temp.ensure(pg_temp.has_warning(v_after, 'expired_undercount'), 'R4', '만료 과소 집계 가능 경고');
    -- 자료 환불: restored·reissued·unrecovered 따로, 옛 행 따로
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_after, 'market_refund_restored', 'credits'), 100, 'R4', '되돌림 100');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_after, 'market_refund_reissued', 'credits'), 50, 'R4', '재지급 50');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_after, 'market_refund_unrecovered', 'credits'), 30, 'R4', '못 돌려줌 30');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_after, 'market_refund_legacy', 'credits'), 55, 'R4', '옛 방식 55');
    v_log := v_log || pg_temp.ensure(NOT pg_temp.has_warning(v_after, 'reissue_mismatch'), 'R4', '재지급 합 = 이어진 출처 initial_credits 합');
    -- 자료 구매 사용: 원장 543(433 + 30 + 70 + 10), 주문 표 433(MO1; MO2 는 기간 밖), 주문 행 없는 사용 110
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_after, 'market_usage_ledger', 'credits') - pg_temp.flow(v_before, 'market_usage_ledger', 'credits'), 543, 'R4', '원장 사용 543');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_after, 'market_usage_order', 'credits') - pg_temp.flow(v_before, 'market_usage_order', 'credits'), 433, 'R4', '주문 표 433');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_after, 'market_usage_without_order', 'credits') - pg_temp.flow(v_before, 'market_usage_without_order', 'credits'), 110,
      'R4', '주문 행 없는 사용 110');
    -- 참고 금액(3-3): 총사용 paid = S2 333 + RS 30(뿌리 S2) = 363 C × 9.9 = 3,593.7 → 3,593원(끝수 0.7), 관리자 지급 100 C 0원, 단가 모름 70 C
    v_log := v_log || pg_temp.eq(pg_temp.usage_cat(v_usage, 'gross', 'paid', 'credits'), 363, 'R4', '총사용 유상 363 C(재지급 뿌리 포함)');
    v_log := v_log || pg_temp.eq(pg_temp.usage_cat(v_usage, 'gross', 'paid', 'won'), 3593, 'R4', '총사용 유상 3,593원(원 미만 버림)');
    v_log := v_log || pg_temp.eq(pg_temp.usage_cat(v_usage, 'gross', 'admin_grant', 'won'), 0, 'R4', '관리자 지급 0원');
    v_log := v_log || pg_temp.eq(pg_temp.usage_cat(v_usage, 'gross', 'paid_unknown_price', 'credits'), 70, 'R4', '주문 없는 옛 요금제 구매 70 C(단가 알 수 없음)');
    v_log := v_log || pg_temp.ensure(pg_temp.has_warning(v_usage, 'unknown_price'), 'R4', '단가 알 수 없음 경고');
    v_log := v_log || pg_temp.eq(pg_temp.usage_cat(v_usage, 'gross', 'paid_test', 'credits'), 10, 'R4', '시험 환경 결제 출처 10 C 는 시험 결제 분류');
    v_log := v_log || pg_temp.eq(pg_temp.usage_cat(v_usage, 'gross', 'paid_test', 'won'), 0, 'R4', '시험 결제 0원');
    v_log := v_log || pg_temp.ensure(pg_temp.has_warning(v_usage, 'test_payment'), 'R4', '시험 결제 경고');
    v_log := v_log || pg_temp.eq((v_usage -> 'gross' ->> 'credits')::numeric, 543, 'R4', '총사용 C = 원장 자료 구매 사용');
    v_log := v_log || pg_temp.eq((v_usage -> 'gross' ->> 'fraction')::numeric, 0.7, 'R4', '총사용 끝수 0.7');
    -- 환불 차감: 새 방식 S2 150 C(restored 100 + reissued 50, unrecovered 30 은 빼지 않음) + 옛 행 S2 39 = 189 C × 9.9 = 1,871.1 → 1,871원, E1 16 C 0원
    v_log := v_log || pg_temp.eq(pg_temp.usage_cat(v_usage, 'refund', 'paid', 'credits'), 189, 'R4', '환불 차감 유상 189 C(옛 행 비율 39 포함)');
    v_log := v_log || pg_temp.eq(pg_temp.usage_cat(v_usage, 'refund', 'paid', 'won'), 1871, 'R4', '환불 차감 1,871원');
    v_log := v_log || pg_temp.eq(pg_temp.usage_cat(v_usage, 'refund', 'admin_grant', 'credits'), 16, 'R4', '옛 행 E1 몫 16 C');
    v_log := v_log || pg_temp.eq((v_usage -> 'net' ->> 'won')::numeric, 3593 - 1871, 'R4', '순사용 = 총사용 − 환불 차감');
    v_log := v_log || pg_temp.eq((v_usage -> 'net' ->> 'fraction')::numeric, 0.6, 'R4', '순사용 끝수 0.7 − 0.1');`)

// R5: 네 함수 모두 service_role 로 실행(가짜 탈퇴 기록 포함 기간), anon·authenticated 거절
const R5 = isolatedCase('rh_r5', 'R5', `
    INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, target_user_id, amount, details, created_at)
    VALUES (v_a, 'member_withdraw', 'profile', v_a::text, v_a, 0, jsonb_build_object('method', 'owner', 'expired_cleared', 7), '2025-06-26 10:00:00+09');
    SET LOCAL ROLE service_role;
    v_log := v_log || pg_temp.expect(pg_temp.try_json('SELECT public.report_charge_daily(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''))'), 'OK', 'R5', 'service_role 요약');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('SELECT * FROM public.report_payment_lines(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''))'), 'OK', 'R5', 'service_role 건별');
    v_log := v_log || pg_temp.expect(pg_temp.try_json('SELECT public.report_credit_flow(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''))'), 'OK', 'R5', 'service_role 크레딧 흐름');
    v_log := v_log || pg_temp.expect(pg_temp.try_json('SELECT public.report_credit_usage_value(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''))'), 'OK', 'R5', 'service_role 참고 금액(재귀 CTE)');
    v_r := pg_temp.try_json('SELECT public.report_credit_flow(pg_temp.kst(''2025-06-01''), pg_temp.kst(''2025-07-01''))');
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R5', 'service_role 탈퇴 기록 있는 기간(보관 표를 읽지 않음)');
    v_log := v_log || pg_temp.ensure(pg_temp.flow(pg_temp.res(v_r), 'withdrawal_expired_cleared', 'credits') >= 7, 'R5', '탈퇴 정리분을 작업 기록에서 읽음');
    v_log := v_log || pg_temp.expect(pg_temp.try_json('SELECT count(*) FROM public.withdrawn_member_records'), 'ERR permission denied', 'R5', 'service_role 은 회원 보관 표를 못 읽음(그대로)');
    RESET ROLE;
    SET LOCAL ROLE authenticated;
    v_log := v_log || pg_temp.expect(pg_temp.try_json('SELECT public.report_charge_daily(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''))'), 'ERR permission denied', 'R5', 'authenticated 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('SELECT * FROM public.report_payment_lines(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''))'), 'ERR permission denied', 'R5', 'authenticated 건별 거절');
    RESET ROLE;
    SET LOCAL ROLE anon;
    v_log := v_log || pg_temp.expect(pg_temp.try_json('SELECT public.report_credit_flow(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''))'), 'ERR permission denied', 'R5', 'anon 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json('SELECT public.report_credit_usage_value(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''))'), 'ERR permission denied', 'R5', 'anon 참고 금액 거절');
    RESET ROLE;`)

// R6: 366일 실행 시간, 367일 예외
const R6 = isolatedCase('rh_r6', 'R6', `
    SET LOCAL ROLE service_role;
    v_t := clock_timestamp();
    v_j := public.report_charge_daily(pg_temp.kst('2025-11-27'), pg_temp.kst('2026-11-28'));
    PERFORM * FROM public.report_payment_lines(pg_temp.kst('2025-11-27'), pg_temp.kst('2026-11-28'));
    v_k := public.report_credit_flow(pg_temp.kst('2025-11-27'), pg_temp.kst('2026-11-28'));
    v_usage := public.report_credit_usage_value(pg_temp.kst('2025-11-27'), pg_temp.kst('2026-11-28'));
    v_ms := round(extract(epoch FROM clock_timestamp() - v_t) * 1000);
    RESET ROLE;
    v_log := v_log || pg_temp.eq(jsonb_array_length(v_j -> 'days'), 366, 'R6', '366일 0 채움');
    v_log := v_log || pg_temp.ensure(v_ms < 20000, 'R6', '366일 네 함수 ' || v_ms || 'ms(20초 안)');
    v_log := v_log || pg_temp.expect(pg_temp.try_json('SELECT public.report_charge_daily(pg_temp.kst(''2025-11-27''), pg_temp.kst(''2026-11-29''))'),
      'ERR SALES_REPORT_PERIOD_INVALID', 'R6', '367일 예외');
    v_log := v_log || pg_temp.expect(pg_temp.try_json('SELECT public.report_credit_usage_value(pg_temp.kst(''2026-11-02''), pg_temp.kst(''2026-11-01''))'),
      'ERR SALES_REPORT_PERIOD_INVALID', 'R6', '거꾸로 된 기간 예외');`)

const LEFTOVER = isolatedCase('rh_leftover', 'Z', `
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.payment_orders WHERE order_id LIKE 'rh23-%') = 0
      AND (SELECT count(*) FROM public.credit_transactions WHERE description = 'rh23') = 0, 'Z', '경우 밖에 남은 가짜 행 0(ROLLBACK 전)');`)

const BEFORE_APPLY = isolatedCase('rh_before', 'F0', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK', 'F0', '적용 전 down 멈춤');
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = ${sqlString(MIGRATION_VERSION)}), 'F0', '이력 행 없음');`)

const HISTORY_INSERT = `
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES (${sqlString(MIGRATION_VERSION)}, ${sqlString(MIGRATION_NAME)});
`

const CASE_F = isolatedCase('rh_f', 'F', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'F', 'down 원본(정책 포함)');
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'system_settings'
      AND policyname = 'system_settings_sales_report_content_no_client_write'), 'F', '정책 지워짐');
    DELETE FROM supabase_migrations.schema_migrations WHERE version = ${sqlString(MIGRATION_VERSION)};
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'F', '이력 행 지운 뒤 다시 적용');
    INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES (${sqlString(MIGRATION_VERSION)}, ${sqlString(MIGRATION_NAME)});`)

const APPLY_HEAD = (mode) => `
-- ===== 23번 마이그레이션(${mode === 'light' ? "light 사본 — '[23번 기존 표 DDL]' 구역(system_settings 정책)을 뺌" : '원본 그대로'}) =====
`

const FOOT = `
SELECT n, test, msg, payload FROM _rh_log ORDER BY n;
ROLLBACK;
`

export function buildRehearsalFiles() {
  const cases = SETUP + R1 + R2 + R3 + R4 + R5 + R6
  const light = prelude({
    title: 'A light — 23번 light 사본, 경우 R1~R6',
    when: '지금(낮) 돌려도 됨: 함수 만들기·설정 행 INSERT(표 잠금 없음)·기존 표에는 새 행 INSERT 만. 이력 표는 쓰지 않는다.',
    mode: 'light',
  }) + APPLY_HEAD('light') + migrationCopy('light') + '\n' + cases + LEFTOVER + FOOT
  const full = prelude({
    title: 'B full — 23번 원본(정책 포함) + 적용 절차(이력 INSERT) + 경우 R1~R6 + down·이력 지우고 다시 적용(F)',
    when: 'DB 적용 직전(새벽 — system_settings 정책 만들기가 ROLLBACK 까지 표 잠금을 쥔다, supabase_migrations 이력 표에 씀 — ROLLBACK 됨).',
    mode: 'full',
  }) + BEFORE_APPLY + APPLY_HEAD('full') + migrationCopy('full') + '\n' + HISTORY_INSERT + cases + CASE_F + LEFTOVER + FOOT

  const files = { 'a_light.sql': light, 'b_full.sql': full }
  for (const [name, content] of Object.entries(files)) {
    if (/\bCOMMIT\s*;/.test(content)) throw new Error(`${name} contains a COMMIT statement`)
    if (!content.trimEnd().endsWith('ROLLBACK;')) throw new Error(`${name} must end with ROLLBACK`)
  }
  assertLight(light.replace(/^SELECT pg_temp\.ctx_set\('src_[\s\S]*?\$rh_src_\w+\$\);$/gm, ''), 'a_light.sql')
  return files
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = buildRehearsalFiles()
  const check = process.argv.includes('--check')
  let stale = 0
  for (const [name, content] of Object.entries(files)) {
    const path = join(HERE, name)
    if (check) {
      let current = ''
      try { current = readFileSync(path, 'utf8') } catch { /* 없음 */ }
      if (current !== content) { stale += 1; console.error(`stale: ${name}`) }
    } else {
      writeFileSync(path, content)
      console.log(`wrote ${name} (${content.split('\n').length} lines)`)
    }
  }
  if (stale) process.exit(1)
}
