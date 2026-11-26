// 21번 묶음 리허설 생성기(계획 docs/plan-bundle21-dashboard.md 5절 D1~D7: 실제 파일을 실행하고, 사본은 생성기로 만들어 계약 시험으로 고정).
//   node supabase/scripts/bundle21_rehearsal/generate.mjs           → 이 폴더의 *.sql 을 다시 쓴다
//   node supabase/scripts/bundle21_rehearsal/generate.mjs --check   → 다시 만든 값과 파일이 다르면 실패
// 실행(운영 DB, postgres): supabase db query --remote --yes -o json --file supabase/scripts/bundle21_rehearsal/<파일>
//   모든 파일은 BEGIN … 마지막 SELECT … ROLLBACK 이다(COMMIT 없음). 결과는 ON COMMIT DROP 임시 표 _rh_log 로 받는다.
//   경우마다 표지 예외(RH_ISOLATE)로 격리한다 — 경우 안에서 만든 행은 그 경우가 끝나면 되돌려진다.
//   계정: @test.com 시험 계정만 쓴다(실회원 id 를 쓰지 않음). 가짜 자료 주문은 그 시험 계정에만 만든다(상품 id 는 읽기만).
//   가짜 행의 시각은 실데이터가 없는 2025년(D3: 2025-11·12, D6: 2025-06)이거나 '지금 − 7일' 경계 앞뒤 1분이고,
//   실데이터 기간(D2: 2026-11)은 읽기만 한다.
//   21번 마이그레이션은 함수만 만든다(기존 표 DDL 없음) — light 와 full 의 차이는 이력 표 쓰기·down 뒤 다시 적용(F)뿐이다.
//   23번 함수(report_charge_daily)가 아직 없으면(23번 미적용) 같은 거래 안에서 23번 light 사본을 먼저 적용한다(D2 요금제별 합 대조용, ROLLBACK 됨).
//   a_light.sql — 지금(낮) 돌려도 됨: 함수 만들기·문구 행 INSERT·시험 계정 가짜 주문 INSERT 만. 이력 표는 쓰지 않는다.
//   b_full.sql — DB 적용 직전: 위 + 적용 절차(이력 INSERT)·down·이력 지우고 다시 적용(F).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrationCopy as bundle23MigrationCopy } from '../bundle23_rehearsal/generate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const read = (path) => readFileSync(join(ROOT, path), 'utf8')

export const SOURCES = {
  migration: 'supabase/migrations/20261223100000_bundle21_dashboard_reports.sql',
  down: 'supabase/rollback/20261223100000_bundle21_dashboard_reports_down.sql',
  content: 'supabase/scripts/20261223_bundle21_dashboard_content.sql',
}
export const MIGRATION_VERSION = '20261223100000'
export const MIGRATION_NAME = 'bundle21_dashboard_reports'
// light 에 남으면 안 되는 글(기존 표를 잠그는 DDL·이력 표 쓰기·COMMIT)
export const LIGHT_FORBIDDEN = ['ALTER TABLE', 'CREATE TRIGGER', 'DROP TRIGGER', 'CREATE POLICY', 'DROP POLICY', 'LOCK TABLE', 'CREATE INDEX',
  'DROP TABLE', 'supabase_migrations', 'COMMIT;']
// D2 11월 대조 예시(운영 읽기, 2026-11-26 — 계획 12절 4: 리허설 직전 23번 3-4 표와 함께 다시 뽑는다).
export const NOVEMBER_EXAMPLE = {
  orders: 16, orderCredits: 43000, subproduct: [15, 38500], bundle: [1, 4500],
  refunds: 2, refundCredits: 5000, net: 38000, paymentAmount: 60600,
}

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

export const migrationSource = () => read(SOURCES.migration)
export const downSource = () => read(SOURCES.down)
// 문구 스크립트의 '[본문] 시작 ~ 끝' 구역(BEGIN·COMMIT 밖)
export function contentBody() {
  const lines = read(SOURCES.content).split('\n')
  const start = lines.findIndex((line) => line.includes('[본문] 시작'))
  const end = lines.findIndex((line) => line.includes('[본문] 끝'))
  if (start < 0 || end < start) throw new Error('content script: [본문] markers missing')
  const body = lines.slice(start + 1, end).join('\n')
  assertLight(body, 'content body')
  return body
}

function prelude({ title, when }) {
  const migration = migrationSource()
  assertLight(migration, 'migration')
  assertLight(downSource(), 'down')
  return `-- 21번 묶음 리허설: ${title}
-- 생성 파일(손으로 고치지 않는다): node supabase/scripts/bundle21_rehearsal/generate.mjs 가 원본에서 만든다.
-- 실행: supabase db query --remote --yes -o json --file supabase/scripts/bundle21_rehearsal/<이 파일> (COMMIT 없음, 마지막 SELECT 가 결과)
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
-- report_market_daily 합: 구매 n·c(과목·구매 방식 전부), 환불 n·c. 함수가 아래에서 만들어지므로 plpgsql(본문을 부를 때 확인).
CREATE FUNCTION pg_temp.buy_sum(p_from timestamptz, p_to timestamptz, p_subject text, p_key text, p_kind text DEFAULT NULL) RETURNS numeric LANGUAGE plpgsql AS $f$
BEGIN
  RETURN (SELECT COALESCE(sum((k.value ->> p_key)::numeric), 0)
            FROM public.report_market_daily(p_from, p_to, p_subject) d, jsonb_each(d.purchases) s, jsonb_each(s.value) k
           WHERE p_kind IS NULL OR k.key = p_kind);
END $f$;
CREATE FUNCTION pg_temp.refund_sum(p_from timestamptz, p_to timestamptz, p_subject text, p_key text) RETURNS numeric LANGUAGE plpgsql AS $f$
BEGIN
  RETURN (SELECT COALESCE(sum((s.value ->> p_key)::numeric), 0)
            FROM public.report_market_daily(p_from, p_to, p_subject) d, jsonb_each(d.refunds) s);
END $f$;
-- 가짜 자료 주문(시험 계정만): 'rh21-' 키로 표시
CREATE FUNCTION pg_temp.fake_order(p_user uuid, p_item uuid, p_subject text, p_credits integer, p_at timestamptz, p_type text DEFAULT 'subproduct')
RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.market_purchase_orders (workspace_subject, user_id, item_id, purchase_type, idempotency_key, original_price_credits,
                                             charged_credits, status, created_at, updated_at)
  VALUES (p_subject, p_user, p_item, p_type, 'rh21-' || gen_random_uuid()::text, p_credits, p_credits, 'completed', p_at, p_at)
$f$;

SELECT pg_temp.ctx_set('src_migration', ${dollar('rh_src_migration', migration)});
SELECT pg_temp.ctx_set('src_down', ${dollar('rh_src_down', downSource())});
SELECT pg_temp.ctx_set('src_content', ${dollar('rh_src_content', contentBody())});
SELECT pg_temp.ctx_set('src_23_light', ${dollar('rh_src_23_light', bundle23MigrationCopy('light'))});
`
}

// 23번 함수가 없으면(23번 미적용) 같은 거래 안에서 23번 light 사본을 먼저 적용(D2 요금제별 합 대조용)
const ENSURE_23 = `
-- ===== 23번 함수 확인(없으면 23번 light 사본 적용 — ROLLBACK 됨) =====
DO $rh_ensure_23$
BEGIN
  IF to_regprocedure('public.report_charge_daily(timestamptz,timestamptz)') IS NULL THEN
    PERFORM pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_23_light')), 'OK', 'setup', '23번 light 사본 적용');
    INSERT INTO _rh_log (test, msg) VALUES ('setup', '23번 함수가 없어 23번 light 사본을 이 거래 안에서 적용함');
  ELSE
    INSERT INTO _rh_log (test, msg) VALUES ('setup', '23번 함수 있음(적용된 상태)');
  END IF;
END
$rh_ensure_23$;
`

const SETUP = `
-- ===== 계정(@test.com 시험 계정 1개)·국어 상품 3개(읽기만) =====
DO $rh_setup$
DECLARE
  v_pool uuid[];
  v_items uuid[];
BEGIN
  SELECT coalesce(array_agg(p.id ORDER BY u.created_at), '{}') INTO v_pool
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE u.email LIKE '%@test.com' AND p.withdrawn_at IS NULL AND p.is_admin IS NOT TRUE;
  IF cardinality(v_pool) < 1 THEN
    RAISE EXCEPTION 'RH FAIL [setup] @test.com 시험 계정이 없음 — 실회원 id 로 대신하지 않고 멈춘다';
  END IF;
  PERFORM pg_temp.ctx_set('U', v_pool[1]::text);
  SELECT coalesce(array_agg(i.id ORDER BY i.id), '{}') INTO v_items
    FROM (SELECT id FROM public.market_items WHERE workspace_subject = 'korean' ORDER BY id LIMIT 3) i;
  IF cardinality(v_items) < 3 THEN
    RAISE EXCEPTION 'RH FAIL [setup] 국어 상품 3개 필요(가짜 주문의 FK)';
  END IF;
  PERFORM pg_temp.ctx_set('X', v_items[1]::text);
  PERFORM pg_temp.ctx_set('Y', v_items[2]::text);
  PERFORM pg_temp.ctx_set('Z', v_items[3]::text);
  INSERT INTO _rh_log (test, msg) VALUES ('setup', '시험 계정·상품 id 확인');
END
$rh_setup$;
`

function isolatedCase(tag, test, body) {
  return `
DO $${tag}$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_k jsonb;
  v_n numeric;
  v_m numeric;
  v_t timestamptz;
  v_ms numeric;
  v_ids uuid[];
  v_u uuid := pg_temp.uid('U');
  v_x uuid := pg_temp.uid('X');
  v_y uuid := pg_temp.uid('Y');
  v_z uuid := pg_temp.uid('Z');
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
const FN_MARKET = "public.report_market_daily(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''), NULL)"
const FN_ACTIVITY = "public.report_activity_daily(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''), NULL)"
const FN_RANKING = "public.report_market_item_ranking(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''), NULL, ''orders'', 5)"

// D1: 적용(위에서 끝남) → down → 남는 것 0 → 다시 적용(VERIFY 통과)
const D1 = isolatedCase('rh_d1', 'D1', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'D1', 'down');
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('report_market_daily', 'report_activity_daily', 'report_market_item_ranking')), 'D1', '남는 함수 0');
    v_log := v_log || pg_temp.ensure(to_regprocedure('public.report_charge_daily(timestamptz,timestamptz)') IS NOT NULL, 'D1', '23번 함수는 남음');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK', 'D1', '없을 때 down 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'D1', '다시 적용(VERIFY 통과)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'ERR PRECHECK: bundle 21 report functions already exist', 'D1', '두 번 적용 멈춤');`)

// D2: 2026-11 = 주문 표·자료 환불·가입·다운로드 SELECT(읽기 전용) = 계획 예시, 요금제별 합 = 순 충전 매출 카드의 결제 금액
const D2 = isolatedCase('rh_d2', 'D2', `
    -- 주문 표 SELECT(Q6)
    v_n := (SELECT count(*) FROM public.market_purchase_orders o WHERE o.status IN ('completed', 'refunded', 'revoked')
             AND o.created_at >= pg_temp.kst('2026-11-01') AND o.created_at < pg_temp.kst('2026-12-01'));
    v_m := (SELECT COALESCE(sum(o.charged_credits), 0) FROM public.market_purchase_orders o WHERE o.status IN ('completed', 'refunded', 'revoked')
             AND o.created_at >= pg_temp.kst('2026-11-01') AND o.created_at < pg_temp.kst('2026-12-01'));
    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(${NOV}, NULL, 'n'), v_n, 'D2', '구매 건수 = 주문 표 SELECT');
    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(${NOV}, NULL, 'c'), v_m, 'D2', '구매 C = 주문 표 SELECT');
    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(${NOV}, NULL, 'n'), ${N.orders}, 'D2', '예시 구매 건수');
    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(${NOV}, NULL, 'c'), ${N.orderCredits}, 'D2', '예시 구매 C');
    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(${NOV}, NULL, 'n', 'subproduct'), ${N.subproduct[0]}, 'D2', '예시 개별 구매 건수');
    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(${NOV}, NULL, 'c', 'subproduct'), ${N.subproduct[1]}, 'D2', '예시 개별 구매 C');
    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(${NOV}, NULL, 'n', 'bundle'), ${N.bundle[0]}, 'D2', '예시 전체 구매 건수');
    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(${NOV}, NULL, 'c', 'bundle'), ${N.bundle[1]}, 'D2', '예시 전체 구매 C');
    -- 자료 환불(승인, 처리 시각)
    v_n := (SELECT count(*) FROM public.market_refund_requests r WHERE r.status = 'approved'
             AND r.processed_at >= pg_temp.kst('2026-11-01') AND r.processed_at < pg_temp.kst('2026-12-01'));
    v_m := (SELECT COALESCE(sum(r.approved_refund_credits), 0) FROM public.market_refund_requests r WHERE r.status = 'approved'
             AND r.processed_at >= pg_temp.kst('2026-11-01') AND r.processed_at < pg_temp.kst('2026-12-01'));
    v_log := v_log || pg_temp.eq(pg_temp.refund_sum(${NOV}, NULL, 'n'), v_n, 'D2', '자료 환불 건수 = SELECT');
    v_log := v_log || pg_temp.eq(pg_temp.refund_sum(${NOV}, NULL, 'c'), v_m, 'D2', '자료 환불 C = SELECT');
    v_log := v_log || pg_temp.eq(pg_temp.refund_sum(${NOV}, NULL, 'n'), ${N.refunds}, 'D2', '예시 자료 환불 건수');
    v_log := v_log || pg_temp.eq(pg_temp.refund_sum(${NOV}, NULL, 'c'), ${N.refundCredits}, 'D2', '예시 자료 환불 C');
    -- 도넛 합(과목 × 구매 방식 C) = 카드 보조 줄의 구매 C, 카드 큰 값 = 구매 C − 환불 C
    v_log := v_log || pg_temp.eq((SELECT COALESCE(sum((k.value ->> 'c')::numeric), 0) FROM public.report_market_daily(${NOV}, NULL) d,
        jsonb_each(d.purchases) s, jsonb_each(s.value) k), ${N.orderCredits}, 'D2', '도넛 합 = 구매 C');
    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(${NOV}, NULL, 'c') - pg_temp.refund_sum(${NOV}, NULL, 'c'), ${N.net}, 'D2', '카드 큰 값(순 사용 C)');
    v_log := v_log || pg_temp.eq((SELECT count(*) FROM public.report_market_daily(${NOV}, NULL)), 30, 'D2', '11월 30행(날짜당 1행, 0 채움)');
    -- 충전: 요금제별 합 = 결제 금액(23번 report_charge_daily)
    v_j := public.report_charge_daily(${NOV});
    v_log := v_log || pg_temp.eq((SELECT COALESCE(sum((p ->> 'amount')::numeric), 0) FROM jsonb_array_elements(v_j -> 'days') d, jsonb_array_elements(d -> 'byPlan') p),
      (SELECT COALESCE(sum((d ->> 'paymentAmount')::numeric), 0) FROM jsonb_array_elements(v_j -> 'days') d), 'D2', '요금제별 합 = 결제 금액');
    v_log := v_log || pg_temp.eq((SELECT COALESCE(sum((d ->> 'paymentAmount')::numeric), 0) FROM jsonb_array_elements(v_j -> 'days') d), ${N.paymentAmount}, 'D2', '예시 결제 금액');
    -- 가입·다운로드 = 같은 시각 SELECT
    v_k := public.report_activity_daily(${NOV}, NULL);
    v_log := v_log || pg_temp.eq((v_k -> 'totals' ->> 'signups')::numeric, (SELECT count(*) FROM public.profiles p WHERE p.is_admin IS NOT TRUE
        AND p.created_at >= pg_temp.kst('2026-11-01') AND p.created_at < pg_temp.kst('2026-12-01')), 'D2', '가입 = SELECT');
    v_log := v_log || pg_temp.eq((SELECT sum((d ->> 'signups')::numeric) FROM jsonb_array_elements(v_k -> 'days') d), (v_k -> 'totals' ->> 'signups')::numeric, 'D2', '날짜별 가입 합 = 합계');
    v_log := v_log || pg_temp.eq((v_k -> 'totals' ->> 'downloads')::numeric, (SELECT count(*) FROM public.market_download_events e
        WHERE e.created_at >= pg_temp.kst('2026-11-01') AND e.created_at < pg_temp.kst('2026-12-01')), 'D2', '다운로드 = SELECT');
    v_log := v_log || pg_temp.eq((v_k -> 'totals' ->> 'downloadUsers')::numeric, (SELECT count(DISTINCT e.user_id) FROM public.market_download_events e
        WHERE e.created_at >= pg_temp.kst('2026-11-01') AND e.created_at < pg_temp.kst('2026-12-01')), 'D2', '다운로드한 회원 = SELECT(기간 안 서로 다른 회원)');
    v_log := v_log || pg_temp.eq(jsonb_array_length(v_k -> 'days'), 30, 'D2', '활동 11월 30일 0 채움');
    INSERT INTO _rh_log (test, msg, payload) VALUES ('D2', '11월 활동(참고)', v_k -> 'totals');`)

// D3: 한국 시간 경계(가짜 주문 2025-11-30 23:59:59 / 2025-12-01 00:00), 비교 기간 끝(지금 − 7일) 앞뒤 1분
const D3 = isolatedCase('rh_d3', 'D3', `
    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(pg_temp.kst('2025-11-01'), pg_temp.kst('2026-01-01'), NULL, 'n'), 0, 'D3', '2025-11·12 실데이터 0건(가짜만 셈)');
    PERFORM pg_temp.fake_order(v_u, v_x, 'korean', 100, '2025-11-30 23:59:59+09');
    PERFORM pg_temp.fake_order(v_u, v_x, 'korean', 200, '2025-12-01 00:00:00+09');
    v_log := v_log || pg_temp.eq((SELECT (d.purchases -> 'korean' -> 'subproduct' ->> 'c')::numeric FROM public.report_market_daily(pg_temp.kst('2025-11-01'), pg_temp.kst('2025-12-01'), NULL) d
        WHERE d.day = '2025-11-30'), 100, 'D3', '23:59:59 KST 는 11-30 줄');
    v_log := v_log || pg_temp.eq((SELECT (d.purchases -> 'korean' -> 'subproduct' ->> 'c')::numeric FROM public.report_market_daily(pg_temp.kst('2025-12-01'), pg_temp.kst('2026-01-01'), NULL) d
        WHERE d.day = '2025-12-01'), 200, 'D3', '00:00 KST 는 12-01 줄');
    v_log := v_log || pg_temp.eq((SELECT count(*) FROM public.report_market_daily(pg_temp.kst('2025-12-01'), pg_temp.kst('2025-12-01') + interval '36 hours', NULL)), 2,
      'D3', '끝이 자정이 아닌 기간은 마지막 날 줄까지(2행)');
    -- 7일 비교 기간 [시작 − 7일, 지금 − 7일): 지금 − 7일 − 1분은 들어가고, + 1분은 빠진다
    v_t := now() - interval '7 days';
    v_n := pg_temp.buy_sum(date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' - interval '13 days', v_t, NULL, 'n');
    PERFORM pg_temp.fake_order(v_u, v_x, 'korean', 10, v_t - interval '1 minute');
    PERFORM pg_temp.fake_order(v_u, v_x, 'korean', 10, v_t + interval '1 minute');
    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' - interval '13 days', v_t, NULL, 'n') - v_n, 1,
      'D3', '비교 기간 끝(지금 − 7일) 앞 1분만 들어감');`)

// D4: 과목 필터·잘못된 과목·p_limit·p_metric·367일 예외
const D4 = isolatedCase('rh_d4', 'D4', `
    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(${NOV}, 'korean', 'n'), (SELECT count(*) FROM public.market_purchase_orders o
        WHERE o.status IN ('completed', 'refunded', 'revoked') AND o.workspace_subject = 'korean'
          AND o.created_at >= pg_temp.kst('2026-11-01') AND o.created_at < pg_temp.kst('2026-12-01')), 'D4', '국어 = SELECT');
    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(${NOV}, 'english', 'n'), (SELECT count(*) FROM public.market_purchase_orders o
        WHERE o.status IN ('completed', 'refunded', 'revoked') AND o.workspace_subject = 'english'
          AND o.created_at >= pg_temp.kst('2026-11-01') AND o.created_at < pg_temp.kst('2026-12-01')), 'D4', '영어 = SELECT');
    v_log := v_log || pg_temp.ensure((SELECT bool_and(d.purchases ? 'english' AND NOT d.purchases ? 'korean' AND d.refunds ? 'english' AND NOT d.refunds ? 'korean')
        FROM public.report_market_daily(${NOV}, 'english') d), 'D4', '영어만 고르면 영어 키만');
    v_log := v_log || pg_temp.ensure((SELECT bool_and(d.purchases ? 'korean' AND d.purchases ? 'english' AND d.purchases -> 'korean' ? 'subproduct' AND d.purchases -> 'korean' ? 'bundle')
        FROM public.report_market_daily(${NOV}, NULL) d), 'D4', '전체면 두 과목·두 구매 방식 0 채움');
    v_log := v_log || pg_temp.eq(((public.report_activity_daily(${NOV}, 'english')) -> 'totals' ->> 'signups')::numeric,
      ((public.report_activity_daily(${NOV}, NULL)) -> 'totals' ->> 'signups')::numeric, 'D4', '가입 수는 과목과 무관');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('SELECT * FROM public.report_market_daily(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''), ''math'')'),
      'ERR DASHBOARD_SUBJECT_INVALID', 'D4', '잘못된 과목');
    v_log := v_log || pg_temp.expect(pg_temp.try_json('SELECT public.report_activity_daily(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''), '''')'),
      'ERR DASHBOARD_SUBJECT_INVALID', 'D4', '빈 과목 글');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('SELECT * FROM public.report_market_item_ranking(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''), NULL, ''orders'', 0)'),
      'ERR DASHBOARD_LIMIT_INVALID', 'D4', 'p_limit 0');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('SELECT * FROM public.report_market_item_ranking(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''), NULL, ''orders'', 21)'),
      'ERR DASHBOARD_LIMIT_INVALID', 'D4', 'p_limit 21');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('SELECT * FROM public.report_market_item_ranking(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''), NULL, ''views'', 5)'),
      'ERR DASHBOARD_METRIC_INVALID', 'D4', '모르는 순위 종류');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('SELECT * FROM public.report_market_item_ranking(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''), NULL, ''orders'', 20)'),
      'OK', 'D4', 'p_limit 20');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('SELECT * FROM public.report_market_daily(pg_temp.kst(''2025-11-01''), pg_temp.kst(''2025-11-01'') + interval ''367 days'', NULL)'),
      'OK', 'D4', '367일은 받음');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('SELECT * FROM public.report_market_daily(pg_temp.kst(''2025-11-01''), pg_temp.kst(''2025-11-01'') + interval ''367 days 1 second'', NULL)'),
      'ERR DASHBOARD_PERIOD_INVALID', 'D4', '367일 초과 예외');
    v_log := v_log || pg_temp.expect(pg_temp.try_json('SELECT public.report_activity_daily(pg_temp.kst(''2025-11-01''), pg_temp.kst(''2025-11-01'') + interval ''368 days'', NULL)'),
      'ERR DASHBOARD_PERIOD_INVALID', 'D4', '활동 367일 초과 예외');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('SELECT * FROM public.report_market_item_ranking(pg_temp.kst(''2026-11-02''), pg_temp.kst(''2026-11-01''), NULL, ''orders'', 5)'),
      'ERR DASHBOARD_PERIOD_INVALID', 'D4', '거꾸로 된 기간 예외');`)

// D5: service_role 만 실행, anon·authenticated 거절
const D5 = isolatedCase('rh_d5', 'D5', `
    SET LOCAL ROLE service_role;
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('SELECT * FROM ${FN_MARKET}'), 'OK', 'D5', 'service_role 자료 판매');
    v_log := v_log || pg_temp.expect(pg_temp.try_json('SELECT ${FN_ACTIVITY}'), 'OK', 'D5', 'service_role 활동');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('SELECT * FROM ${FN_RANKING}'), 'OK', 'D5', 'service_role 순위');
    RESET ROLE;
    SET LOCAL ROLE authenticated;
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('SELECT * FROM ${FN_MARKET}'), 'ERR permission denied', 'D5', 'authenticated 자료 판매 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json('SELECT ${FN_ACTIVITY}'), 'ERR permission denied', 'D5', 'authenticated 활동 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('SELECT * FROM ${FN_RANKING}'), 'ERR permission denied', 'D5', 'authenticated 순위 거절');
    RESET ROLE;
    SET LOCAL ROLE anon;
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('SELECT * FROM ${FN_MARKET}'), 'ERR permission denied', 'D5', 'anon 자료 판매 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json('SELECT ${FN_ACTIVITY}'), 'ERR permission denied', 'D5', 'anon 활동 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('SELECT * FROM ${FN_RANKING}'), 'ERR permission denied', 'D5', 'anon 순위 거절');
    RESET ROLE;`)

// D6: 순위 동점 정렬(건수 → C → 상품 id), 다운로드 순위 = 다운로드한 회원 수 SELECT
const JUNE = `pg_temp.kst('2025-06-01'), pg_temp.kst('2025-07-01')`
const D6 = isolatedCase('rh_d6', 'D6', `
    v_log := v_log || pg_temp.eq((SELECT count(*) FROM public.report_market_item_ranking(${JUNE}, NULL, 'orders', 20)), 0, 'D6', '2025-06 실데이터 0건(가짜만 셈)');
    -- X·Y 는 1건 1,000 C 로 같고, Z 는 1건 2,000 C, Y 는 하나 더(2건) → Y, Z, X 순(X < ... 는 id 순)
    PERFORM pg_temp.fake_order(v_u, v_x, 'korean', 1000, '2025-06-10 10:00:00+09');
    PERFORM pg_temp.fake_order(v_u, v_z, 'korean', 2000, '2025-06-10 11:00:00+09');
    PERFORM pg_temp.fake_order(v_u, v_y, 'korean', 500, '2025-06-11 10:00:00+09');
    PERFORM pg_temp.fake_order(v_u, v_y, 'korean', 500, '2025-06-12 10:00:00+09', 'bundle');
    v_ids := (SELECT array_agg(r.item_id ORDER BY ord) FROM public.report_market_item_ranking(${JUNE}, NULL, 'orders', 5) WITH ORDINALITY AS r(item_id, title, workspace_subject, item_status, is_active, is_deleted, order_count, charged_credits, download_users, download_count, ord));
    v_log := v_log || pg_temp.ensure(v_ids = ARRAY[v_y, v_z, v_x], 'D6', '건수 → C 순(Y 2건, Z 1건 2,000 C, X 1건 1,000 C)');
    PERFORM pg_temp.fake_order(v_u, v_z, 'korean', 1000, '2025-06-13 10:00:00+09');
    PERFORM pg_temp.fake_order(v_u, v_x, 'korean', 1000, '2025-06-13 11:00:00+09');
    -- 이제 Y·Z·X 모두 2건. C: Z 3,000 > X 2,000 = ... Y 1,000 → Z, X, Y
    v_ids := (SELECT array_agg(r.item_id ORDER BY ord) FROM public.report_market_item_ranking(${JUNE}, NULL, 'orders', 5) WITH ORDINALITY AS r(item_id, title, workspace_subject, item_status, is_active, is_deleted, order_count, charged_credits, download_users, download_count, ord));
    v_log := v_log || pg_temp.ensure(v_ids = ARRAY[v_z, v_x, v_y], 'D6', '같은 건수면 C 순');
    PERFORM pg_temp.fake_order(v_u, v_y, 'korean', 1000, '2025-06-14 10:00:00+09');
    PERFORM pg_temp.fake_order(v_u, v_x, 'korean', 1000, '2025-06-14 11:00:00+09');
    PERFORM pg_temp.fake_order(v_u, v_z, 'korean', 1000, '2025-06-14 12:00:00+09');
    PERFORM pg_temp.fake_order(v_u, v_y, 'korean', 1000, '2025-06-15 10:00:00+09');
    -- X 3건 3,000 C, Y 4건 3,000 C, Z 3건 4,000 C → Y, Z, X. 같은 건수·같은 C 는 상품 id 순(아래)
    v_ids := (SELECT array_agg(r.item_id ORDER BY ord) FROM public.report_market_item_ranking(${JUNE}, NULL, 'orders', 5) WITH ORDINALITY AS r(item_id, title, workspace_subject, item_status, is_active, is_deleted, order_count, charged_credits, download_users, download_count, ord));
    v_log := v_log || pg_temp.ensure(v_ids = ARRAY[v_y, v_z, v_x], 'D6', '건수 우선');
    v_ids := (SELECT array_agg(r.item_id ORDER BY ord) FROM public.report_market_item_ranking(pg_temp.kst('2025-06-10'), pg_temp.kst('2025-06-11'), NULL, 'orders', 5)
              WITH ORDINALITY AS r(item_id, title, workspace_subject, item_status, is_active, is_deleted, order_count, charged_credits, download_users, download_count, ord));
    v_log := v_log || pg_temp.ensure(v_ids = ARRAY[v_z, v_x], 'D6', '06-10: Z 2,000 C, X 1,000 C');
    PERFORM pg_temp.fake_order(v_u, v_z, 'korean', 1000, '2025-06-20 10:00:00+09');
    PERFORM pg_temp.fake_order(v_u, v_x, 'korean', 1000, '2025-06-20 11:00:00+09');
    v_ids := (SELECT array_agg(r.item_id ORDER BY ord) FROM public.report_market_item_ranking(pg_temp.kst('2025-06-20'), pg_temp.kst('2025-06-21'), NULL, 'orders', 5)
              WITH ORDINALITY AS r(item_id, title, workspace_subject, item_status, is_active, is_deleted, order_count, charged_credits, download_users, download_count, ord));
    v_log := v_log || pg_temp.ensure(v_ids = ARRAY[v_x, v_z], 'D6', '같은 건수·같은 C 는 상품 id 순(X < Z)');
    -- 다운로드 순위(11월 실데이터, 읽기만) = 상품별 다운로드한 회원 수 SELECT 순서
    v_ids := (SELECT array_agg(r.item_id ORDER BY ord) FROM public.report_market_item_ranking(${NOV}, NULL, 'downloads', 20)
              WITH ORDINALITY AS r(item_id, title, workspace_subject, item_status, is_active, is_deleted, order_count, charged_credits, download_users, download_count, ord));
    v_log := v_log || pg_temp.ensure(v_ids IS NOT DISTINCT FROM (SELECT array_agg(g.item_id ORDER BY g.users DESC, g.n DESC, g.item_id) FROM (
        SELECT e.item_id, count(DISTINCT e.user_id) AS users, count(*) AS n FROM public.market_download_events e
         WHERE e.created_at >= pg_temp.kst('2026-11-01') AND e.created_at < pg_temp.kst('2026-12-01') GROUP BY e.item_id ORDER BY 2 DESC, 3 DESC, 1 LIMIT 20) g),
      'D6', '다운로드 순위 = 회원 수 → 다운로드 수 → 상품 id SELECT');`)

// D7: 366일·과목 전체 report_market_daily 행 수 = 날짜 수(≤ 367)와 실행 시간
const D7 = isolatedCase('rh_d7', 'D7', `
    v_t := clock_timestamp();
    v_n := (SELECT count(*) FROM public.report_market_daily(pg_temp.kst('2025-11-28'), pg_temp.kst('2025-11-28') + interval '366 days', NULL));
    v_ms := round(extract(epoch FROM clock_timestamp() - v_t) * 1000);
    v_log := v_log || pg_temp.eq(v_n, 366, 'D7', '366일 = 366행(날짜당 1행)');
    v_log := v_log || pg_temp.ensure(v_n <= 367, 'D7', '행 수 ≤ 367(PostgREST 1,000행 상한 아래)');
    v_log := v_log || pg_temp.ensure(v_ms < 10000, 'D7', '366일 자료 판매 ' || v_ms || 'ms(10초 미만)');
    v_t := clock_timestamp();
    PERFORM public.report_activity_daily(pg_temp.kst('2025-11-28'), pg_temp.kst('2025-11-28') + interval '366 days', NULL);
    v_log := v_log || pg_temp.ensure(true, 'D7', '366일 활동 ' || round(extract(epoch FROM clock_timestamp() - v_t) * 1000) || 'ms');`)

// C: 문구 스크립트 본문(행이 없으면 넣고 VERIFY, 있으면 그대로)
const CASE_C = isolatedCase('rh_c', 'C', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_content')), 'OK', 'C', '문구 스크립트 본문(INSERT … ON CONFLICT DO NOTHING + VERIFY)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_content')), 'OK', 'C', '두 번 돌려도 그대로');`)

const LEFTOVER = isolatedCase('rh_leftover', 'Z', `
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.market_purchase_orders WHERE idempotency_key LIKE 'rh21-%') = 0, 'Z', '경우 밖에 남은 가짜 주문 0(ROLLBACK 전)');`)

const BEFORE_APPLY = isolatedCase('rh_before', 'F0', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK', 'F0', '적용 전 down 멈춤');
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = ${sqlString(MIGRATION_VERSION)}), 'F0', '이력 행 없음');`)

const HISTORY_INSERT = `
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES (${sqlString(MIGRATION_VERSION)}, ${sqlString(MIGRATION_NAME)});
`

const CASE_F = isolatedCase('rh_f', 'F', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'F', 'down 원본');
    DELETE FROM supabase_migrations.schema_migrations WHERE version = ${sqlString(MIGRATION_VERSION)};
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'F', '이력 행 지운 뒤 다시 적용');
    INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES (${sqlString(MIGRATION_VERSION)}, ${sqlString(MIGRATION_NAME)});`)

const APPLY_HEAD = `
-- ===== 21번 마이그레이션(원본 그대로 — 기존 표 DDL 없음) =====
`

const FOOT = `
SELECT n, test, msg, payload FROM _rh_log ORDER BY n;
ROLLBACK;
`

export function buildRehearsalFiles() {
  const cases = SETUP + D1 + D2 + D3 + D4 + D5 + D6 + D7 + CASE_C
  const light = prelude({
    title: 'A light — 21번 마이그레이션, 경우 D1~D7·C',
    when: '지금(낮) 돌려도 됨: 함수 만들기·문구 행 INSERT·시험 계정 가짜 주문 INSERT 만(표 잠금 없음). 이력 표는 쓰지 않는다.',
  }) + ENSURE_23 + APPLY_HEAD + migrationSource() + '\n' + cases + LEFTOVER + FOOT
  const full = prelude({
    title: 'B full — 21번 마이그레이션 + 적용 절차(이력 INSERT) + 경우 D1~D7·C + down·이력 지우고 다시 적용(F)',
    when: 'DB 적용 직전(supabase_migrations 이력 표에 씀 — ROLLBACK 됨). 23번이 먼저 적용돼 있어야 한다(없으면 23번 light 사본으로 대신 확인).',
  }) + ENSURE_23 + BEFORE_APPLY + APPLY_HEAD + migrationSource() + '\n' + HISTORY_INSERT + cases + CASE_F + LEFTOVER + FOOT

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
