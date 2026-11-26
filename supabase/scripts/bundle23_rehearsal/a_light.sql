-- 23번 묶음 리허설: A light — 23번 light 사본, 경우 R1~R6
-- 생성 파일(손으로 고치지 않는다): node supabase/scripts/bundle23_rehearsal/generate.mjs 가 원본에서 만든다.
-- 실행: supabase db query --remote --yes -o json --file supabase/scripts/bundle23_rehearsal/<이 파일> (COMMIT 없음, 마지막 SELECT 가 결과)
-- 언제: 지금(낮) 돌려도 됨: 함수 만들기·설정 행 INSERT(표 잠금 없음)·기존 표에는 새 행 INSERT 만. 이력 표는 쓰지 않는다.
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

SELECT pg_temp.ctx_set('src_migration', $rh_src_migration$-- 출시 전 작업 순서표 23번 묶음: 매출·정산 CSV(계획 docs/plan-bundle23-sales-csv.md 4판, 4절).
-- 하는 것(표는 만들지 않는다):
--   1. 읽기 전용 보고 함수 4개(4-1): report_charge_daily·report_payment_lines·report_credit_flow·report_credit_usage_value.
--      모두 STABLE SECURITY INVOKER, search_path 고정, EXECUTE 는 service_role 만(PUBLIC·anon·authenticated 회수 — 운영 pg_default_acl 이
--      새 함수에 anon·authenticated EXECUTE 를 준다). 기간은 [p_from, p_to) 이고 366일을 넘으면 SALES_REPORT_PERIOD_INVALID.
--      운영 helper(credit_source_paid_root·credit_source_reissued_descendants)는 부르지 않는다(EXECUTE 가 postgres 에만 있다) —
--      유상 뿌리 규칙은 함수 안 재귀 CTE 로 직접 쓴다. 탈퇴 보관함(회원 보관 표)은 읽지 않고 GRANT 도 더하지 않는다.
--      읽는 표(고정 목록): payment_orders·refund_requests·payment_methods·payment_provider_transactions·payment_admin_actions·
--      credit_sources·credit_transactions·credit_consumption·market_purchase_orders·market_refund_requests·
--      market_refund_reissued_sources·admin_audit_log — 모두 service_role SELECT 가 이미 있다.
--   2. 설정 행 system_settings.sales_report_content(4-2, 초안 문구 — 대표가 관리자 화면에서 고친다). 있으면 그대로(ON CONFLICT DO NOTHING).
--      이 행은 로그인 회원 누구나 읽을 수 있으므로 내부 절차·계좌·담당자 정보를 넣지 않는다.
--   3. 쓰기 막기 RESTRICTIVE 정책 system_settings_sales_report_content_no_client_write(15번 방식) — '[23번 기존 표 DDL]' 구역.
--      표 잠금이라 새벽에 짧게(lock_timeout 3초). 리허설 light 사본은 이 구역과 그 VERIFY 블록을 뺀다.
-- 결제·크레딧 기록은 읽기만 한다(결제·환불 함수는 바꾸지 않는다).
-- 되돌리기: supabase/rollback/20261222100000_bundle23_sales_report_down.sql(23번 코드를 먼저 되돌려 배포한 뒤, 21번 코드가 쓰면 21번부터).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 0. 사전 점검 ------------------------------------------------------------------------------------------------------
DO $precheck_bundle23_sales_report$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('report_charge_daily', 'report_payment_lines', 'report_credit_flow', 'report_credit_usage_value')) THEN
    RAISE EXCEPTION 'PRECHECK: bundle 23 report functions already exist';
  END IF;
  -- 함수가 읽는 칸이 있다(이름이 바뀌었으면 멈춤)
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payment_orders'
        AND column_name IN ('order_id', 'provider', 'provider_environment', 'status', 'approved_at', 'expected_amount', 'vat_amount',
                            'payment_method_code', 'plan_name_snapshot', 'created_at')) <> 10
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'refund_requests'
        AND column_name IN ('payment_order_id', 'provider', 'status', 'refund_amount', 'provider_cancelled_at', 'processed_at', 'origin', 'created_at')) <> 8
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'credit_sources'
        AND column_name IN ('initial_credits', 'remaining_credits', 'status', 'expires_at', 'created_at', 'source_category', 'payment_order_id')) <> 7
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'market_refund_requests'
        AND column_name IN ('approved_refund_credits', 'processed_at', 'allocated_items', 'status', 'order_id', 'workspace_subject')) <> 6
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'credit_consumption'
        AND column_name IN ('source_id', 'amount', 'resource_type', 'created_at')) <> 4
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payment_admin_actions'
        AND column_name IN ('refund_request_id', 'external_method', 'details', 'action', 'created_at')) <> 5 THEN
    RAISE EXCEPTION 'PRECHECK: report source columns changed';
  END IF;
END
$precheck_bundle23_sales_report$;

-- [23번] 시작 -------------------------------------------------------------------------------------------------------
-- 1. 충전 결제 기준(원) 한국 날짜별(3-1, RB-10 9-1·9-2 와 같은 식). 0 채움. 완료 환불에 금액이 비면 REFUND_AMOUNT_MISSING(전체 확인 불가).
--    부가세는 저장된 vat_amount, 환불 부가세는 round(refund_amount / 11). 충전(원)만 담는다(21번이 reports.view 구역에서만 부름).
--    돌려주는 값: { days: [{ day, paymentCount, paymentAmount, paymentVat, refundCount, refundAmount, refundVat,
--                           manualRefundCount, manualRefundAmount, byMethod[], byPlan[], refundByOrigin[], refundByMethod[] }],
--                  warnings: { manualReviewOrders, cancelPendingOrders, fulfillmentPendingOrders, partialCancelOpen, fullRefundVatMismatch,
--                              manualActionsWithoutRefund } }
--    지급 대기(fulfillment_pending)는 결제사 승인은 됐지만 크레딧 지급 전이라 approved_at 이 아직 비어 합계에 없다(지급 때 승인 시각으로 채워져 지난 기간에 소급해 들어감).
CREATE FUNCTION public.report_charge_daily(p_from timestamptz, p_to timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $fn_report_charge_daily$
DECLARE
  v_days jsonb;
  v_warnings jsonb;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to OR p_to - p_from > interval '366 days' THEN
    RAISE EXCEPTION 'SALES_REPORT_PERIOD_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.refund_requests rr
              WHERE rr.provider = 'payapp' AND rr.status = 'completed' AND rr.refund_amount IS NULL
                AND COALESCE(rr.provider_cancelled_at, rr.processed_at) >= p_from AND COALESCE(rr.provider_cancelled_at, rr.processed_at) < p_to) THEN
    RAISE EXCEPTION 'REFUND_AMOUNT_MISSING';
  END IF;

  WITH days AS (
    SELECT d::date AS day
      FROM generate_series((p_from AT TIME ZONE 'Asia/Seoul')::date, ((p_to - interval '1 microsecond') AT TIME ZONE 'Asia/Seoul')::date, interval '1 day') d
  ), pay AS (
    SELECT (po.approved_at AT TIME ZONE 'Asia/Seoul')::date AS day, po.expected_amount AS amount, po.vat_amount AS vat,
           po.payment_method_code AS method_code, COALESCE(pm.label, po.payment_method_code) AS method_label, po.plan_name_snapshot AS plan_name
      FROM public.payment_orders po
      LEFT JOIN public.payment_methods pm ON pm.code = po.payment_method_code AND pm.provider = po.provider
     WHERE po.provider = 'payapp' AND po.provider_environment = 'live' AND po.status IN ('completed', 'refunded')
       AND po.approved_at IS NOT NULL AND po.approved_at >= p_from AND po.approved_at < p_to
  ), ref AS (
    SELECT (COALESCE(rr.provider_cancelled_at, rr.processed_at) AT TIME ZONE 'Asia/Seoul')::date AS day, rr.refund_amount AS amount,
           round(rr.refund_amount::numeric / 11)::integer AS vat, rr.origin,
           po.payment_method_code AS method_code, COALESCE(pm.label, po.payment_method_code) AS method_label,
           (SELECT a.external_method FROM public.payment_admin_actions a
             WHERE a.refund_request_id = rr.id AND a.external_method IS NOT NULL ORDER BY a.created_at DESC LIMIT 1) AS external_method
      FROM public.refund_requests rr
      LEFT JOIN public.payment_orders po ON po.id = rr.payment_order_id
      LEFT JOIN public.payment_methods pm ON pm.code = po.payment_method_code AND pm.provider = po.provider
     WHERE rr.provider = 'payapp' AND rr.status = 'completed'
       AND COALESCE(rr.provider_cancelled_at, rr.processed_at) >= p_from AND COALESCE(rr.provider_cancelled_at, rr.processed_at) < p_to
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'day', to_char(d.day, 'YYYY-MM-DD'),
           'paymentCount', (SELECT count(*) FROM pay WHERE pay.day = d.day),
           'paymentAmount', (SELECT COALESCE(sum(amount), 0) FROM pay WHERE pay.day = d.day),
           'paymentVat', (SELECT COALESCE(sum(vat), 0) FROM pay WHERE pay.day = d.day),
           'refundCount', (SELECT count(*) FROM ref WHERE ref.day = d.day),
           'refundAmount', (SELECT COALESCE(sum(amount), 0) FROM ref WHERE ref.day = d.day),
           'refundVat', (SELECT COALESCE(sum(vat), 0) FROM ref WHERE ref.day = d.day),
           'manualRefundCount', (SELECT count(*) FROM ref WHERE ref.day = d.day AND ref.external_method IS NOT NULL),
           'manualRefundAmount', (SELECT COALESCE(sum(amount), 0) FROM ref WHERE ref.day = d.day AND ref.external_method IS NOT NULL),
           'byMethod', (SELECT COALESCE(jsonb_agg(jsonb_build_object('code', g.method_code, 'label', g.method_label, 'count', g.n, 'amount', g.amount, 'vat', g.vat)
                          ORDER BY g.method_label), '[]'::jsonb)
                          FROM (SELECT method_code, method_label, count(*) AS n, sum(amount) AS amount, sum(vat) AS vat
                                  FROM pay WHERE pay.day = d.day GROUP BY method_code, method_label) g),
           'byPlan', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', g.plan_name, 'count', g.n, 'amount', g.amount, 'vat', g.vat)
                        ORDER BY g.plan_name), '[]'::jsonb)
                        FROM (SELECT plan_name, count(*) AS n, sum(amount) AS amount, sum(vat) AS vat
                                FROM pay WHERE pay.day = d.day GROUP BY plan_name) g),
           'refundByOrigin', (SELECT COALESCE(jsonb_agg(jsonb_build_object('origin', g.origin, 'count', g.n, 'amount', g.amount, 'vat', g.vat)
                                ORDER BY g.origin), '[]'::jsonb)
                                FROM (SELECT origin, count(*) AS n, sum(amount) AS amount, sum(vat) AS vat
                                        FROM ref WHERE ref.day = d.day GROUP BY origin) g),
           'refundByMethod', (SELECT COALESCE(jsonb_agg(jsonb_build_object('code', g.method_code, 'label', g.method_label, 'count', g.n, 'amount', g.amount, 'vat', g.vat)
                                ORDER BY g.method_label), '[]'::jsonb)
                                FROM (SELECT method_code, method_label, count(*) AS n, sum(amount) AS amount, sum(vat) AS vat
                                        FROM ref WHERE ref.day = d.day GROUP BY method_code, method_label) g)
         ) ORDER BY d.day), '[]'::jsonb)
    INTO v_days
    FROM days d;

  -- 경고(3-1): 기간 끝까지 만들어진 주문 중 지금 수동 확인·취소 처리 중·지급 대기인 것, 완료 전 부분취소, 전액 환불 부가세 불일치, 환불 요청 없는 수동 처리 기록
  SELECT jsonb_build_object(
    'manualReviewOrders', (SELECT count(*) FROM public.payment_orders po
                            WHERE po.provider = 'payapp' AND po.provider_environment = 'live' AND po.status = 'manual_review' AND po.created_at < p_to),
    'cancelPendingOrders', (SELECT count(*) FROM public.payment_orders po
                             WHERE po.provider = 'payapp' AND po.provider_environment = 'live' AND po.status = 'cancel_pending' AND po.created_at < p_to),
    'fulfillmentPendingOrders', (SELECT count(*) FROM public.payment_orders po
                                  WHERE po.provider = 'payapp' AND po.provider_environment = 'live' AND po.status = 'fulfillment_pending' AND po.created_at < p_to),
    'partialCancelOpen', (SELECT count(*) FROM public.refund_requests rr
                           WHERE rr.provider = 'payapp' AND rr.origin = 'partial_cancel' AND rr.status NOT IN ('completed', 'rejected') AND rr.created_at < p_to),
    'fullRefundVatMismatch', (SELECT count(*) FROM public.refund_requests rr JOIN public.payment_orders po ON po.id = rr.payment_order_id
                               WHERE rr.provider = 'payapp' AND rr.status = 'completed'
                                 AND COALESCE(rr.provider_cancelled_at, rr.processed_at) >= p_from AND COALESCE(rr.provider_cancelled_at, rr.processed_at) < p_to
                                 AND rr.refund_amount = po.expected_amount AND round(rr.refund_amount::numeric / 11)::integer IS DISTINCT FROM po.vat_amount),
    'manualActionsWithoutRefund', (SELECT count(*) FROM public.payment_admin_actions a
                                    WHERE a.external_method IS NOT NULL AND a.refund_request_id IS NULL AND a.created_at >= p_from AND a.created_at < p_to))
    INTO v_warnings;

  RETURN jsonb_build_object('days', v_days, 'warnings', v_warnings);
END;
$fn_report_charge_daily$;

-- 2. 충전 결제 건별(4-1 열 허용 목록). 결제 줄은 승인 시각, 환불 줄은 COALESCE(결제사 취소 시각, 처리 시각) 이 기간 안.
--    넣지 않는 칸: 환불 사유·관리자 메모·처리 메모·details·before/after_state·결제사 회원 키·결제 키·회원 id·이메일·전화·IP.
--    환불 금액은 양수(구분 칸이 '환불'), 환불 줄의 결제 시각은 원 주문 승인 시각(다른 달 결제의 환불을 알아볼 수 있게).
CREATE FUNCTION public.report_payment_lines(p_from timestamptz, p_to timestamptz)
 RETURNS TABLE(line_kind text, order_id text, payment_request_id text, payment_method_code text, payment_method_label text,
               plan_name text, order_status text, amount integer, vat integer, supply_amount integer,
               paid_at timestamptz, refunded_at timestamptz, refund_origin text, external_method text)
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $fn_report_payment_lines$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to OR p_to - p_from > interval '366 days' THEN
    RAISE EXCEPTION 'SALES_REPORT_PERIOD_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.refund_requests rr
              WHERE rr.provider = 'payapp' AND rr.status = 'completed' AND rr.refund_amount IS NULL
                AND COALESCE(rr.provider_cancelled_at, rr.processed_at) >= p_from AND COALESCE(rr.provider_cancelled_at, rr.processed_at) < p_to) THEN
    RAISE EXCEPTION 'REFUND_AMOUNT_MISSING';
  END IF;

  RETURN QUERY
  SELECT x.line_kind, x.order_id, x.payment_request_id, x.payment_method_code, x.payment_method_label, x.plan_name, x.order_status,
         x.amount, x.vat, x.amount - x.vat, x.paid_at, x.refunded_at, x.refund_origin, x.external_method
    FROM (
      SELECT 'payment'::text AS line_kind, po.order_id, ppt.provider_transaction_id AS payment_request_id, po.payment_method_code,
             COALESCE(pm.label, po.payment_method_code) AS payment_method_label, po.plan_name_snapshot AS plan_name, po.status AS order_status,
             po.expected_amount AS amount, po.vat_amount AS vat, po.approved_at AS paid_at, NULL::timestamptz AS refunded_at,
             NULL::text AS refund_origin, NULL::text AS external_method, po.approved_at AS sort_at
        FROM public.payment_orders po
        LEFT JOIN public.payment_provider_transactions ppt ON ppt.payment_order_id = po.id
        LEFT JOIN public.payment_methods pm ON pm.code = po.payment_method_code AND pm.provider = po.provider
       WHERE po.provider = 'payapp' AND po.provider_environment = 'live' AND po.status IN ('completed', 'refunded')
         AND po.approved_at IS NOT NULL AND po.approved_at >= p_from AND po.approved_at < p_to
      UNION ALL
      SELECT 'refund'::text, po.order_id, ppt.provider_transaction_id, po.payment_method_code,
             COALESCE(pm.label, po.payment_method_code), po.plan_name_snapshot, po.status,
             rr.refund_amount, round(rr.refund_amount::numeric / 11)::integer, po.approved_at, COALESCE(rr.provider_cancelled_at, rr.processed_at),
             rr.origin,
             (SELECT a.external_method FROM public.payment_admin_actions a
               WHERE a.refund_request_id = rr.id AND a.external_method IS NOT NULL ORDER BY a.created_at DESC LIMIT 1),
             COALESCE(rr.provider_cancelled_at, rr.processed_at)
        FROM public.refund_requests rr
        LEFT JOIN public.payment_orders po ON po.id = rr.payment_order_id
        LEFT JOIN public.payment_provider_transactions ppt ON ppt.payment_order_id = po.id
        LEFT JOIN public.payment_methods pm ON pm.code = po.payment_method_code AND pm.provider = po.provider
       WHERE rr.provider = 'payapp' AND rr.status = 'completed'
         AND COALESCE(rr.provider_cancelled_at, rr.processed_at) >= p_from AND COALESCE(rr.provider_cancelled_at, rr.processed_at) < p_to
    ) x
   ORDER BY x.sort_at, x.line_kind, x.order_id;
END;
$fn_report_payment_lines$;

-- 3. 크레딧 흐름(C, 3-2). 운영 참고 표. 돌려주는 값:
--    { lines: [{ line, category, subject, purchaseType, count, credits }], balance: { active, pendingRefund }, warnings: [{ code, ... }] }
--    line: grant(분류별 지급) · market_refund_restored/_reissued/_unrecovered(새 방식 자료 환불, 과목별) · market_refund_legacy(옛 방식, 나눔 없음) ·
--          market_usage_ledger(원장 자료 구매 사용) · market_usage_order(주문 표, 과목·구매 방식별) · market_usage_without_order(원장 − 주문 표) ·
--          charge_refund_recovered(충전 환불 회수, 원천 분류별) · admin_revoke · expired(만료 시점 잔량, 분류별) ·
--          withdrawal_expired_cleared(탈퇴 때 정리된 만료 잔량, 탈퇴 처리 시각) · withdrawal_forfeit · generation_usage(꺼진 생성 기능 사용)
--    만료 줄은 기간 끝과 지금 중 이른 때까지 만료된 출처만 센다(아직 만료되지 않은 잔량을 소멸로 세지 않게).
--    탈퇴 때 정리된 만료 잔량은 작업 기록 member_withdraw 의 details.expired_cleared 합(회원 보관 표는 읽지 않는다, 4판).
--    잔액은 부르는 시각 기준(active·pending_refund, 만료 전).
CREATE FUNCTION public.report_credit_flow(p_from timestamptz, p_to timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $fn_report_credit_flow$
DECLARE
  v_lines jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_balance jsonb;
  v_ledger_usage bigint;
  v_order_usage bigint;
  v_alloc_reissued bigint;
  v_linked_reissued bigint;
  v_audit_revokes bigint;
  v_ledger_revokes bigint;
  v_generation bigint;
  v_revoke_credits bigint;
  v_withdraw_cleared bigint;
  v_expire_to timestamptz := LEAST(p_to, now());
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to OR p_to - p_from > interval '366 days' THEN
    RAISE EXCEPTION 'SALES_REPORT_PERIOD_INVALID';
  END IF;

  -- 지급(출처 initial_credits, 분류별)
  v_lines := v_lines || COALESCE((
    SELECT jsonb_agg(jsonb_build_object('line', 'grant', 'category', g.source_category, 'subject', NULL, 'purchaseType', NULL,
                                        'count', g.n, 'credits', g.credits) ORDER BY g.source_category)
      FROM (SELECT s.source_category, count(*) AS n, sum(s.initial_credits) AS credits
              FROM public.credit_sources s WHERE s.created_at >= p_from AND s.created_at < p_to GROUP BY s.source_category) g), '[]'::jsonb);

  -- 자료 환불(승인, 처리 시각): 새 방식은 allocated_items 의 restored·reissued·unrecovered, 옛 방식(나눔 없음)은 approved_refund_credits
  v_lines := v_lines || COALESCE((
    SELECT jsonb_agg(jsonb_build_object('line', g.line, 'category', NULL, 'subject', g.workspace_subject, 'purchaseType', NULL,
                                        'count', g.n, 'credits', g.credits) ORDER BY g.line, g.workspace_subject)
      FROM (
        SELECT v.line, r.workspace_subject, count(DISTINCT r.id) AS n, sum(v.credits) AS credits
          FROM public.market_refund_requests r
          CROSS JOIN LATERAL jsonb_array_elements(r.allocated_items) x
          CROSS JOIN LATERAL (VALUES ('market_refund_restored', COALESCE((x ->> 'restored')::integer, 0)),
                                     ('market_refund_reissued', COALESCE((x ->> 'reissued')::integer, 0)),
                                     ('market_refund_unrecovered', COALESCE((x ->> 'unrecovered')::integer, 0))) v(line, credits)
         WHERE r.status = 'approved' AND r.processed_at >= p_from AND r.processed_at < p_to
           AND jsonb_typeof(r.allocated_items) = 'array' AND jsonb_array_length(r.allocated_items) > 0
         GROUP BY v.line, r.workspace_subject
        HAVING sum(v.credits) <> 0
        UNION ALL
        SELECT 'market_refund_legacy', r.workspace_subject, count(*), sum(COALESCE(r.approved_refund_credits, 0))
          FROM public.market_refund_requests r
         WHERE r.status = 'approved' AND r.processed_at >= p_from AND r.processed_at < p_to
           AND (r.allocated_items IS NULL OR jsonb_typeof(r.allocated_items) <> 'array' OR jsonb_array_length(r.allocated_items) = 0)
         GROUP BY r.workspace_subject) g), '[]'::jsonb);

  -- 자료 구매 사용: 원장 기준 합계 + 주문 표(실패 제외) 과목·구매 방식 나눔 + 차이
  SELECT COALESCE(sum(-t.amount), 0) INTO v_ledger_usage
    FROM public.credit_transactions t
   WHERE t.type = 'consume' AND t.resource_type LIKE 'market_purchase%' AND t.created_at >= p_from AND t.created_at < p_to;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('line', 'market_usage_ledger', 'category', NULL, 'subject', NULL, 'purchaseType', NULL,
    'count', (SELECT count(*) FROM public.credit_transactions t
               WHERE t.type = 'consume' AND t.resource_type LIKE 'market_purchase%' AND t.created_at >= p_from AND t.created_at < p_to),
    'credits', v_ledger_usage));
  SELECT COALESCE(sum(o.charged_credits), 0) INTO v_order_usage
    FROM public.market_purchase_orders o WHERE o.status <> 'failed' AND o.created_at >= p_from AND o.created_at < p_to;
  v_lines := v_lines || COALESCE((
    SELECT jsonb_agg(jsonb_build_object('line', 'market_usage_order', 'category', NULL, 'subject', g.workspace_subject, 'purchaseType', g.purchase_type,
                                        'count', g.n, 'credits', g.credits) ORDER BY g.workspace_subject, g.purchase_type)
      FROM (SELECT o.workspace_subject, o.purchase_type, count(*) AS n, sum(o.charged_credits) AS credits
              FROM public.market_purchase_orders o WHERE o.status <> 'failed' AND o.created_at >= p_from AND o.created_at < p_to
             GROUP BY o.workspace_subject, o.purchase_type) g), '[]'::jsonb);
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('line', 'market_usage_without_order', 'category', NULL, 'subject', NULL, 'purchaseType', NULL,
    'count', NULL, 'credits', v_ledger_usage - v_order_usage));

  -- 충전 환불 회수(원장 refund_request 음수 행 = 실제 회수량, 자동·수동 모두), 원천 분류별
  v_lines := v_lines || COALESCE((
    SELECT jsonb_agg(jsonb_build_object('line', 'charge_refund_recovered', 'category', g.category, 'subject', NULL, 'purchaseType', NULL,
                                        'count', g.n, 'credits', g.credits) ORDER BY g.category)
      FROM (SELECT COALESCE(s.source_category, 'unknown_source') AS category, count(*) AS n, sum(-t.amount) AS credits
              FROM public.credit_transactions t LEFT JOIN public.credit_sources s ON s.id = t.source_id
             WHERE t.type = 'refund' AND t.resource_type = 'refund_request' AND t.amount < 0 AND t.created_at >= p_from AND t.created_at < p_to
             GROUP BY 1) g), '[]'::jsonb);

  -- 관리자 회수(작업 기록 credit_revoke), 원장 회수 행 수와 대조
  SELECT count(*), COALESCE(sum(a.amount), 0) INTO v_audit_revokes, v_revoke_credits
    FROM public.admin_audit_log a WHERE a.action = 'credit_revoke' AND a.created_at >= p_from AND a.created_at < p_to;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('line', 'admin_revoke', 'category', NULL, 'subject', NULL, 'purchaseType', NULL,
    'count', v_audit_revokes, 'credits', v_revoke_credits));
  SELECT count(*) INTO v_ledger_revokes
    FROM public.credit_transactions t
   WHERE t.type = 'refund' AND t.resource_type IS NULL AND t.amount < 0 AND t.created_at >= p_from AND t.created_at < p_to;

  -- 만료 소멸: 만료 시점 잔량 = 지금 잔량 + 수동 충전 환불이 정리한 만료분(payment_admin_actions.details.sources[].expired_cleared)
  v_lines := v_lines || COALESCE((
    SELECT jsonb_agg(jsonb_build_object('line', 'expired', 'category', g.source_category, 'subject', NULL, 'purchaseType', NULL,
                                        'count', g.n, 'credits', g.credits) ORDER BY g.source_category)
      FROM (SELECT s.source_category, count(*) FILTER (WHERE s.remaining_credits + COALESCE(c.cleared, 0) > 0) AS n,
                   sum(s.remaining_credits + COALESCE(c.cleared, 0)) AS credits
              FROM public.credit_sources s
              LEFT JOIN LATERAL (
                SELECT sum(COALESCE((x ->> 'expired_cleared')::integer, 0)) AS cleared
                  FROM public.payment_admin_actions a
                  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a.details -> 'sources') = 'array' THEN a.details -> 'sources' ELSE '[]'::jsonb END) x
                 WHERE a.action = 'manual_refund_completed' AND x ->> 'source_id' = s.id::text) c ON true
             WHERE s.expires_at >= p_from AND s.expires_at < v_expire_to
             GROUP BY s.source_category
            HAVING sum(s.remaining_credits + COALESCE(c.cleared, 0)) > 0) g), '[]'::jsonb);

  -- 탈퇴 때 정리된 만료 잔량(탈퇴 처리 시각 기준)
  SELECT COALESCE(sum(COALESCE((a.details ->> 'expired_cleared')::integer, 0)), 0) INTO v_withdraw_cleared
    FROM public.admin_audit_log a WHERE a.action = 'member_withdraw' AND a.created_at >= p_from AND a.created_at < p_to;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('line', 'withdrawal_expired_cleared', 'category', NULL, 'subject', NULL, 'purchaseType', NULL,
    'count', (SELECT count(*) FROM public.admin_audit_log a WHERE a.action = 'member_withdraw' AND a.created_at >= p_from AND a.created_at < p_to
                AND COALESCE((a.details ->> 'expired_cleared')::integer, 0) > 0),
    'credits', v_withdraw_cleared));

  -- 탈퇴 소멸(원장 withdrawal_forfeit, 음수 행)
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('line', 'withdrawal_forfeit', 'category', NULL, 'subject', NULL, 'purchaseType', NULL,
    'count', (SELECT count(*) FROM public.credit_transactions t
               WHERE t.type = 'withdrawal_forfeit' AND t.amount <> 0 AND t.created_at >= p_from AND t.created_at < p_to),
    'credits', (SELECT COALESCE(sum(-t.amount), 0) FROM public.credit_transactions t
                 WHERE t.type = 'withdrawal_forfeit' AND t.created_at >= p_from AND t.created_at < p_to)));

  -- 생성 기능 사용(자료 구매 외 consume — 꺼진 기능)
  SELECT COALESCE(sum(-t.amount), 0) INTO v_generation
    FROM public.credit_transactions t
   WHERE t.type = 'consume' AND (t.resource_type IS NULL OR t.resource_type NOT LIKE 'market_purchase%') AND t.created_at >= p_from AND t.created_at < p_to;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('line', 'generation_usage', 'category', NULL, 'subject', NULL, 'purchaseType', NULL,
    'count', NULL, 'credits', v_generation));

  -- 잔액(부르는 시각)
  SELECT jsonb_build_object(
           'active', COALESCE(sum(s.remaining_credits) FILTER (WHERE s.status = 'active'), 0),
           'pendingRefund', COALESCE(sum(s.remaining_credits) FILTER (WHERE s.status = 'pending_refund'), 0),
           'at', now())
    INTO v_balance
    FROM public.credit_sources s
   WHERE s.status IN ('active', 'pending_refund') AND (s.expires_at IS NULL OR s.expires_at > now());

  -- 대조 경고
  SELECT COALESCE(sum(COALESCE((x ->> 'reissued')::integer, 0)), 0) INTO v_alloc_reissued
    FROM public.market_refund_requests r
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.allocated_items) = 'array' THEN r.allocated_items ELSE '[]'::jsonb END) x
   WHERE r.status = 'approved' AND r.processed_at >= p_from AND r.processed_at < p_to;
  SELECT COALESCE(sum(s.initial_credits), 0) INTO v_linked_reissued
    FROM public.market_refund_reissued_sources l JOIN public.credit_sources s ON s.id = l.source_id
   WHERE l.created_at >= p_from AND l.created_at < p_to;
  IF v_alloc_reissued <> v_linked_reissued THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'reissue_mismatch', 'allocated', v_alloc_reissued, 'linked', v_linked_reissued));
  END IF;
  IF v_ledger_usage <> v_order_usage THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'usage_without_order', 'credits', v_ledger_usage - v_order_usage));
  END IF;
  IF v_audit_revokes <> v_ledger_revokes THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'revoke_count_mismatch', 'audit', v_audit_revokes, 'ledger', v_ledger_revokes));
  END IF;
  IF v_generation <> 0 THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'generation_usage', 'credits', v_generation));
  END IF;
  IF v_withdraw_cleared > 0 THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'expired_undercount', 'credits', v_withdraw_cleared));
  END IF;

  RETURN jsonb_build_object('lines', v_lines, 'balance', v_balance, 'warnings', v_warnings);
END;
$fn_report_credit_flow$;

-- 4. 사용분 참고 금액(원, 3-3). 출처마다 유상 뿌리를 재귀 CTE 로 찾는다(credit_source_paid_root 와 같은 규칙: system_refund 이면
--    market_refund_reissued_sources.original_source_id 로 거슬러 올라가고(최대 20번, 돌아오면 멈춤), plan_purchase 에서 멈춘다).
--    뿌리 분류: paid(요금제 구매 + 실결제 주문 — provider_environment live, 상태 completed·refunded. 단가 = 주문 expected_amount ÷ 뿌리 initial_credits) ·
--    paid_test(주문은 있으나 시험 환경·미완료 결제, 0원 + 경고 test_payment) · paid_unknown_price(주문 없는 옛 요금제 구매, 0원) ·
--    admin_grant · bonus · legacy_unknown · system_refund(뿌리를 못 찾은 재지급) · unknown_source(출처 행 없음) — paid 밖은 0원.
--    총사용 = credit_consumption(자료 구매) 출처별 양 × 단가(차감 시각 기간). 환불 차감 = 승인 자료 환불의 allocated_items 출처별
--    (restored + reissued) × 단가, 옛 행은 주문 credit_consumptions 비율로 나눔(내림, 나머지는 첫 출처). 원 미만 버림, 끝수는 따로.
--    돌려주는 값: { gross: { rows: [{ category, credits, won }], credits, won, fraction }, refund: {…}, net: { credits, won, fraction }, warnings: [] }
CREATE FUNCTION public.report_credit_usage_value(p_from timestamptz, p_to timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $fn_report_credit_usage_value$
DECLARE
  v_result jsonb;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to OR p_to - p_from > interval '366 days' THEN
    RAISE EXCEPTION 'SALES_REPORT_PERIOD_INVALID';
  END IF;

  WITH RECURSIVE cons AS (
    SELECT cc.source_id, sum(cc.amount)::bigint AS credits
      FROM public.credit_consumption cc
     WHERE cc.resource_type LIKE 'market_purchase%' AND cc.created_at >= p_from AND cc.created_at < p_to
     GROUP BY cc.source_id
  ), refund_new AS (
    SELECT NULLIF(x ->> 'source_id', '')::uuid AS source_id,
           (COALESCE((x ->> 'restored')::integer, 0) + COALESCE((x ->> 'reissued')::integer, 0))::bigint AS credits
      FROM public.market_refund_requests r
      CROSS JOIN LATERAL jsonb_array_elements(r.allocated_items) x
     WHERE r.status = 'approved' AND r.processed_at >= p_from AND r.processed_at < p_to
       AND jsonb_typeof(r.allocated_items) = 'array' AND jsonb_array_length(r.allocated_items) > 0
  ), legacy AS (
    SELECT r.id, COALESCE(r.approved_refund_credits, 0)::bigint AS approved, o.credit_consumptions AS cons
      FROM public.market_refund_requests r
      LEFT JOIN public.market_purchase_orders o ON o.id = r.order_id
     WHERE r.status = 'approved' AND r.processed_at >= p_from AND r.processed_at < p_to
       AND (r.allocated_items IS NULL OR jsonb_typeof(r.allocated_items) <> 'array' OR jsonb_array_length(r.allocated_items) = 0)
       AND COALESCE(r.approved_refund_credits, 0) > 0
  ), legacy_parts AS (
    SELECT l.id, l.approved, NULLIF(COALESCE(e ->> 'source_id', e ->> 'sourceId'), '')::uuid AS source_id,
           COALESCE((e ->> 'amount')::integer, 0) AS amount, t.ord
      FROM legacy l
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(l.cons) = 'array' THEN l.cons ELSE '[]'::jsonb END) WITH ORDINALITY AS t(e, ord)
  ), legacy_valid AS (
    SELECT p.*, sum(p.amount) OVER (PARTITION BY p.id) AS total, row_number() OVER (PARTITION BY p.id ORDER BY p.ord) AS rn
      FROM legacy_parts p WHERE p.source_id IS NOT NULL AND p.amount > 0
  ), legacy_floor AS (
    SELECT v.id, v.source_id, v.rn, v.approved, floor(v.approved::numeric * v.amount / v.total)::bigint AS base FROM legacy_valid v
  ), legacy_shares AS (
    SELECT f.source_id, f.base + CASE WHEN f.rn = 1 THEN f.approved - sum(f.base) OVER (PARTITION BY f.id) ELSE 0 END AS credits FROM legacy_floor f
  ), refund_all AS (
    SELECT source_id, credits FROM refund_new WHERE credits <> 0
    UNION ALL SELECT source_id, credits FROM legacy_shares WHERE credits <> 0
    UNION ALL SELECT NULL::uuid, l.approved FROM legacy l WHERE NOT EXISTS (SELECT 1 FROM legacy_valid v WHERE v.id = l.id)
  ), starts AS (
    SELECT source_id FROM cons WHERE source_id IS NOT NULL
    UNION SELECT source_id FROM refund_all WHERE source_id IS NOT NULL
  ), walk AS (
    SELECT s.source_id AS start_id, s.source_id AS cur_id, 0 AS depth, ARRAY[s.source_id] AS seen FROM starts s
    UNION ALL
    SELECT w.start_id, l.original_source_id, w.depth + 1, w.seen || l.original_source_id
      FROM walk w
      JOIN public.credit_sources c ON c.id = w.cur_id AND c.source_category = 'system_refund'
      JOIN public.market_refund_reissued_sources l ON l.source_id = w.cur_id
     WHERE l.original_source_id IS NOT NULL AND NOT (l.original_source_id = ANY (w.seen)) AND w.depth < 20
  ), root AS (
    SELECT DISTINCT ON (w.start_id) w.start_id, w.cur_id FROM walk w ORDER BY w.start_id, w.depth DESC
  ), priced AS (
    SELECT r.start_id AS source_id,
           CASE WHEN c.id IS NULL THEN 'unknown_source'
                WHEN c.source_category = 'plan_purchase' AND po.id IS NOT NULL AND po.provider_environment = 'live'
                     AND po.status IN ('completed', 'refunded') THEN 'paid'
                WHEN c.source_category = 'plan_purchase' AND po.id IS NOT NULL THEN 'paid_test'
                WHEN c.source_category = 'plan_purchase' THEN 'paid_unknown_price'
                ELSE c.source_category END AS category,
           CASE WHEN c.source_category = 'plan_purchase' AND po.id IS NOT NULL AND po.provider_environment = 'live'
                     AND po.status IN ('completed', 'refunded')
                THEN po.expected_amount::numeric / c.initial_credits ELSE 0 END AS unit_price
      FROM root r
      LEFT JOIN public.credit_sources c ON c.id = r.cur_id
      LEFT JOIN public.payment_orders po ON po.id = c.payment_order_id
  ), gross AS (
    SELECT COALESCE(p.category, 'unknown_source') AS category, sum(x.credits)::bigint AS credits, sum(x.credits * COALESCE(p.unit_price, 0)) AS exact
      FROM cons x LEFT JOIN priced p ON p.source_id = x.source_id GROUP BY 1
  ), refund AS (
    SELECT COALESCE(p.category, 'unknown_source') AS category, sum(x.credits)::bigint AS credits, sum(x.credits * COALESCE(p.unit_price, 0)) AS exact
      FROM refund_all x LEFT JOIN priced p ON p.source_id = x.source_id GROUP BY 1
  ), sections AS (
    SELECT 'gross' AS section, g.category, g.credits, g.exact, trunc(g.exact)::bigint AS won FROM gross g
    UNION ALL
    SELECT 'refund', r.category, r.credits, r.exact, trunc(r.exact)::bigint FROM refund r
  ), totals AS (
    SELECT s.section, sum(s.credits)::bigint AS credits, sum(s.won)::bigint AS won, round(sum(s.exact) - sum(s.won), 4) AS fraction
      FROM sections s GROUP BY s.section
  )
  SELECT jsonb_build_object(
    'gross', jsonb_build_object(
      'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object('category', s.category, 'credits', s.credits, 'won', s.won) ORDER BY s.category)
                          FROM sections s WHERE s.section = 'gross'), '[]'::jsonb),
      'credits', COALESCE((SELECT t.credits FROM totals t WHERE t.section = 'gross'), 0),
      'won', COALESCE((SELECT t.won FROM totals t WHERE t.section = 'gross'), 0),
      'fraction', COALESCE((SELECT t.fraction FROM totals t WHERE t.section = 'gross'), 0)),
    'refund', jsonb_build_object(
      'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object('category', s.category, 'credits', s.credits, 'won', s.won) ORDER BY s.category)
                          FROM sections s WHERE s.section = 'refund'), '[]'::jsonb),
      'credits', COALESCE((SELECT t.credits FROM totals t WHERE t.section = 'refund'), 0),
      'won', COALESCE((SELECT t.won FROM totals t WHERE t.section = 'refund'), 0),
      'fraction', COALESCE((SELECT t.fraction FROM totals t WHERE t.section = 'refund'), 0)),
    'net', jsonb_build_object(
      'credits', COALESCE((SELECT t.credits FROM totals t WHERE t.section = 'gross'), 0) - COALESCE((SELECT t.credits FROM totals t WHERE t.section = 'refund'), 0),
      'won', COALESCE((SELECT t.won FROM totals t WHERE t.section = 'gross'), 0) - COALESCE((SELECT t.won FROM totals t WHERE t.section = 'refund'), 0),
      'fraction', COALESCE((SELECT t.fraction FROM totals t WHERE t.section = 'gross'), 0) - COALESCE((SELECT t.fraction FROM totals t WHERE t.section = 'refund'), 0)),
    'warnings', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', CASE s.category WHEN 'paid_unknown_price' THEN 'unknown_price'
                                                                                  WHEN 'paid_test' THEN 'test_payment' ELSE 'unknown_source' END,
                                                              'section', s.section, 'credits', s.credits) ORDER BY s.section, s.category)
                            FROM sections s WHERE s.category IN ('paid_unknown_price', 'paid_test', 'unknown_source') AND s.credits <> 0), '[]'::jsonb))
    INTO v_result;

  RETURN v_result;
END;
$fn_report_credit_usage_value$;

-- 5. 함수 권한: PUBLIC·anon·authenticated(와 기본 권한으로 받은 service_role)을 회수한 뒤 service_role 만 EXECUTE.
REVOKE ALL ON FUNCTION public.report_charge_daily(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.report_payment_lines(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.report_credit_flow(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.report_credit_usage_value(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_charge_daily(timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.report_payment_lines(timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.report_credit_flow(timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.report_credit_usage_value(timestamptz, timestamptz) TO service_role;

-- 6. 설정 행(4-2). 초안 문구 — 대표가 관리자 화면 '매출·정산'의 안내 문구 카드에서 고친다. 필수 키 목록은
--    src/lib/sales-report.ts SALES_REPORT_CONTENT_TEXT_KEYS(아래 VERIFY 와 같은 목록). 회원도 읽을 수 있는 행이라 내부 정보는 넣지 않는다.
INSERT INTO public.system_settings (key, value, description)
VALUES ('sales_report_content', $json_bundle23_content$
{
  "definitionVersion": 1,
  "revision": 1,
  "fileTitle": "매출·정산 CSV",
  "headerNotice": "사이트 DB 기록으로 만든 대조용 자료입니다. 세금 신고 수치는 페이앱 정산 자료를 기준으로 합니다.",
  "kstNotice": "모든 기간과 시각은 한국 시간 기준입니다.",
  "netNotice": "순액은 결제와 환불을 각자 일어난 시각으로 셉니다. 다른 달에 결제한 주문의 환불이 섞일 수 있습니다.",
  "creditNotice": "크레딧 표는 운영 참고용입니다. 지난 시점의 잔액은 다시 만들 수 없어 기간 흐름이 잔액과 맞아떨어지지 않습니다.",
  "withdrawalNotice": "결제하지 않은 회원이 탈퇴하면 그 회원의 크레딧·자료 구매 기록이 지워져 지난 기간 크레딧 흐름이 줄 수 있습니다. 결제 기준 표는 영향이 없습니다.",
  "expiryNotice": "탈퇴 때 정리된 만료 잔량은 탈퇴 처리 시각 기준으로 따로 셉니다. 그만큼 지난 기간의 만료 소멸이 줄어 보일 수 있습니다.",
  "usageNotice": "참고 금액은 사용한 크레딧을 요금제 결제 단가로 바꾼 값입니다. 관리자 지급·보너스 같은 무상 크레딧은 0원입니다. 원 미만은 버리고 끝수를 따로 적습니다.",
  "screenGuide": "페이앱 정산 자료와 맞춰 보세요 · 절차는 런북 RB-10"
}
$json_bundle23_content$::jsonb, '23번: 매출·정산 CSV 머리 문구·화면 안내(대표가 관리자 화면에서 고침, 회원도 읽을 수 있는 행 — 내부 정보 금지)')
ON CONFLICT (key) DO NOTHING;
-- [23번] 끝 ---------------------------------------------------------------------------------------------------------

-- 7. VERIFY(4-3) ---------------------------------------------------------------------------------------------------
DO $verify_bundle23_sales_report$
DECLARE
  v_fn text;
  v_value jsonb;
  v_key text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.report_charge_daily(timestamptz,timestamptz)', 'public.report_payment_lines(timestamptz,timestamptz)',
                              'public.report_credit_flow(timestamptz,timestamptz)', 'public.report_credit_usage_value(timestamptz,timestamptz)'] LOOP
    IF to_regprocedure(v_fn) IS NULL
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS NOT FALSE
       OR (SELECT p.provolatile FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) <> 's'
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND 'search_path=public, pg_temp' = ANY (p.proconfig))
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = to_regprocedure(v_fn) AND a.grantee = 0) THEN
      RAISE EXCEPTION 'VERIFY: % SECURITY INVOKER / STABLE / search_path / EXECUTE', v_fn;
    END IF;
    -- 운영 helper·회원 보관 표를 읽지 않는다(4-1)
    IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) ~ '(credit_source_paid_root|credit_source_reissued_descendants|withdrawn_member_records)' THEN
      RAISE EXCEPTION 'VERIFY: % reads a forbidden helper or table', v_fn;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('report_charge_daily', 'report_payment_lines', 'report_credit_flow', 'report_credit_usage_value')) <> 4 THEN
    RAISE EXCEPTION 'VERIFY: overloads';
  END IF;
  -- 건별 반환 열 = 허용 목록(순서까지)
  IF (SELECT array_agg(n ORDER BY i)
        FROM pg_proc p, unnest(p.proargnames, p.proargmodes) WITH ORDINALITY AS a(n, m, i)
       WHERE p.oid = to_regprocedure('public.report_payment_lines(timestamptz,timestamptz)') AND a.m = 't')
     IS DISTINCT FROM ARRAY['line_kind', 'order_id', 'payment_request_id', 'payment_method_code', 'payment_method_label', 'plan_name',
                            'order_status', 'amount', 'vat', 'supply_amount', 'paid_at', 'refunded_at', 'refund_origin', 'external_method']::text[] THEN
    RAISE EXCEPTION 'VERIFY: report_payment_lines columns are not the allow-list';
  END IF;
  -- 회원 보관 표에 service_role 권한을 더하지 않았다
  IF has_table_privilege('service_role', 'public.withdrawn_member_records', 'SELECT') THEN
    RAISE EXCEPTION 'VERIFY: withdrawn_member_records must stay closed to service_role';
  END IF;
  -- 설정 행 필수 키(SALES_REPORT_CONTENT_TEXT_KEYS): 비지 않은 한 줄 글 1~300자, 정의 판·revision 은 정수
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'sales_report_content';
  IF v_value IS NULL OR jsonb_typeof(v_value -> 'definitionVersion') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_value -> 'revision') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'VERIFY: sales_report_content shape';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['fileTitle', 'headerNotice', 'kstNotice', 'netNotice', 'creditNotice', 'withdrawalNotice', 'expiryNotice',
                               'usageNotice', 'screenGuide'] LOOP
    IF jsonb_typeof(v_value -> v_key) IS DISTINCT FROM 'string' OR btrim(v_value ->> v_key) = '' OR char_length(v_value ->> v_key) > 300
       OR (v_value ->> v_key) ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'VERIFY: sales_report_content.%', v_key;
    END IF;
  END LOOP;
END;
$verify_bundle23_sales_report$;

-- (light 사본: [23번 기존 표 DDL] 시작 ~ 끝 구역을 뺐다)

NOTIFY pgrst, 'reload schema';
$rh_src_migration$);
SELECT pg_temp.ctx_set('src_down', $rh_src_down$-- 23번 묶음 되돌리기(supabase/migrations/20261222100000_bundle23_sales_report.sql 의 down). 계획 docs/plan-bundle23-sales-csv.md 4-3.
-- 23번 코드(/admin/reports 화면·CSV route, 21번이 쓰면 21번 대시보드 코드)를 먼저 되돌려 배포한 뒤에만 실행한다(새 코드는 함수가 없으면 500).
-- 하는 것: ① 보고 함수 4개 지우기 ② 설정 행 sales_report_content 지우기(대표가 고친 문구도 지워진다 — 필요하면 먼저 값을 떠 둔다)
--   ③ 쓰기 막기 정책 지우기('[23번 기존 표 DDL]' 구역 — 표 잠금, 새벽 짧게. 정책이 남았는지 검사도 이 구역 안에 있어 리허설 light 사본은 함께 뺀다).
-- 하지 않는 것: 작업 기록(sales_report_export·sales_report_content_update)은 그대로 둔다(지울 수 없는 기록 표).
-- 이 파일은 이력 행을 지우지 않는다. 다시 적용하려면 같은 거래에서 schema_migrations 의 '20261222100000' 행을 지운 뒤 마이그레이션과 이력 INSERT 를 넣는다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $precheck_bundle23_sales_report_down$
BEGIN
  IF to_regprocedure('public.report_charge_daily(timestamptz,timestamptz)') IS NULL
     OR to_regprocedure('public.report_payment_lines(timestamptz,timestamptz)') IS NULL
     OR to_regprocedure('public.report_credit_flow(timestamptz,timestamptz)') IS NULL
     OR to_regprocedure('public.report_credit_usage_value(timestamptz,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'DOWN PRECHECK: bundle 23 report functions missing (not the bundle 23 state)';
  END IF;
END;
$precheck_bundle23_sales_report_down$;

-- [23번] 시작: 되돌림 ----------------------------------------------------------------------------------------------
DROP FUNCTION public.report_charge_daily(timestamptz, timestamptz);
DROP FUNCTION public.report_payment_lines(timestamptz, timestamptz);
DROP FUNCTION public.report_credit_flow(timestamptz, timestamptz);
DROP FUNCTION public.report_credit_usage_value(timestamptz, timestamptz);
DELETE FROM public.system_settings WHERE key = 'sales_report_content';
-- [23번] 끝: 되돌림 ------------------------------------------------------------------------------------------------

-- (light 사본: [23번 기존 표 DDL] 시작 ~ 끝 구역을 뺐다)

DO $verify_bundle23_sales_report_down$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('report_charge_daily', 'report_payment_lines', 'report_credit_flow', 'report_credit_usage_value'))
     OR EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'sales_report_content') THEN
    RAISE EXCEPTION 'DOWN VERIFY: bundle 23 leftovers';
  END IF;
END;
$verify_bundle23_sales_report_down$;

NOTIFY pgrst, 'reload schema';
$rh_src_down$);

-- ===== 23번 마이그레이션(light 사본 — '[23번 기존 표 DDL]' 구역(system_settings 정책)을 뺌) =====
-- 출시 전 작업 순서표 23번 묶음: 매출·정산 CSV(계획 docs/plan-bundle23-sales-csv.md 4판, 4절).
-- 하는 것(표는 만들지 않는다):
--   1. 읽기 전용 보고 함수 4개(4-1): report_charge_daily·report_payment_lines·report_credit_flow·report_credit_usage_value.
--      모두 STABLE SECURITY INVOKER, search_path 고정, EXECUTE 는 service_role 만(PUBLIC·anon·authenticated 회수 — 운영 pg_default_acl 이
--      새 함수에 anon·authenticated EXECUTE 를 준다). 기간은 [p_from, p_to) 이고 366일을 넘으면 SALES_REPORT_PERIOD_INVALID.
--      운영 helper(credit_source_paid_root·credit_source_reissued_descendants)는 부르지 않는다(EXECUTE 가 postgres 에만 있다) —
--      유상 뿌리 규칙은 함수 안 재귀 CTE 로 직접 쓴다. 탈퇴 보관함(회원 보관 표)은 읽지 않고 GRANT 도 더하지 않는다.
--      읽는 표(고정 목록): payment_orders·refund_requests·payment_methods·payment_provider_transactions·payment_admin_actions·
--      credit_sources·credit_transactions·credit_consumption·market_purchase_orders·market_refund_requests·
--      market_refund_reissued_sources·admin_audit_log — 모두 service_role SELECT 가 이미 있다.
--   2. 설정 행 system_settings.sales_report_content(4-2, 초안 문구 — 대표가 관리자 화면에서 고친다). 있으면 그대로(ON CONFLICT DO NOTHING).
--      이 행은 로그인 회원 누구나 읽을 수 있으므로 내부 절차·계좌·담당자 정보를 넣지 않는다.
--   3. 쓰기 막기 RESTRICTIVE 정책 system_settings_sales_report_content_no_client_write(15번 방식) — '[23번 기존 표 DDL]' 구역.
--      표 잠금이라 새벽에 짧게(lock_timeout 3초). 리허설 light 사본은 이 구역과 그 VERIFY 블록을 뺀다.
-- 결제·크레딧 기록은 읽기만 한다(결제·환불 함수는 바꾸지 않는다).
-- 되돌리기: supabase/rollback/20261222100000_bundle23_sales_report_down.sql(23번 코드를 먼저 되돌려 배포한 뒤, 21번 코드가 쓰면 21번부터).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 0. 사전 점검 ------------------------------------------------------------------------------------------------------
DO $precheck_bundle23_sales_report$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('report_charge_daily', 'report_payment_lines', 'report_credit_flow', 'report_credit_usage_value')) THEN
    RAISE EXCEPTION 'PRECHECK: bundle 23 report functions already exist';
  END IF;
  -- 함수가 읽는 칸이 있다(이름이 바뀌었으면 멈춤)
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payment_orders'
        AND column_name IN ('order_id', 'provider', 'provider_environment', 'status', 'approved_at', 'expected_amount', 'vat_amount',
                            'payment_method_code', 'plan_name_snapshot', 'created_at')) <> 10
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'refund_requests'
        AND column_name IN ('payment_order_id', 'provider', 'status', 'refund_amount', 'provider_cancelled_at', 'processed_at', 'origin', 'created_at')) <> 8
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'credit_sources'
        AND column_name IN ('initial_credits', 'remaining_credits', 'status', 'expires_at', 'created_at', 'source_category', 'payment_order_id')) <> 7
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'market_refund_requests'
        AND column_name IN ('approved_refund_credits', 'processed_at', 'allocated_items', 'status', 'order_id', 'workspace_subject')) <> 6
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'credit_consumption'
        AND column_name IN ('source_id', 'amount', 'resource_type', 'created_at')) <> 4
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payment_admin_actions'
        AND column_name IN ('refund_request_id', 'external_method', 'details', 'action', 'created_at')) <> 5 THEN
    RAISE EXCEPTION 'PRECHECK: report source columns changed';
  END IF;
END
$precheck_bundle23_sales_report$;

-- [23번] 시작 -------------------------------------------------------------------------------------------------------
-- 1. 충전 결제 기준(원) 한국 날짜별(3-1, RB-10 9-1·9-2 와 같은 식). 0 채움. 완료 환불에 금액이 비면 REFUND_AMOUNT_MISSING(전체 확인 불가).
--    부가세는 저장된 vat_amount, 환불 부가세는 round(refund_amount / 11). 충전(원)만 담는다(21번이 reports.view 구역에서만 부름).
--    돌려주는 값: { days: [{ day, paymentCount, paymentAmount, paymentVat, refundCount, refundAmount, refundVat,
--                           manualRefundCount, manualRefundAmount, byMethod[], byPlan[], refundByOrigin[], refundByMethod[] }],
--                  warnings: { manualReviewOrders, cancelPendingOrders, fulfillmentPendingOrders, partialCancelOpen, fullRefundVatMismatch,
--                              manualActionsWithoutRefund } }
--    지급 대기(fulfillment_pending)는 결제사 승인은 됐지만 크레딧 지급 전이라 approved_at 이 아직 비어 합계에 없다(지급 때 승인 시각으로 채워져 지난 기간에 소급해 들어감).
CREATE FUNCTION public.report_charge_daily(p_from timestamptz, p_to timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $fn_report_charge_daily$
DECLARE
  v_days jsonb;
  v_warnings jsonb;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to OR p_to - p_from > interval '366 days' THEN
    RAISE EXCEPTION 'SALES_REPORT_PERIOD_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.refund_requests rr
              WHERE rr.provider = 'payapp' AND rr.status = 'completed' AND rr.refund_amount IS NULL
                AND COALESCE(rr.provider_cancelled_at, rr.processed_at) >= p_from AND COALESCE(rr.provider_cancelled_at, rr.processed_at) < p_to) THEN
    RAISE EXCEPTION 'REFUND_AMOUNT_MISSING';
  END IF;

  WITH days AS (
    SELECT d::date AS day
      FROM generate_series((p_from AT TIME ZONE 'Asia/Seoul')::date, ((p_to - interval '1 microsecond') AT TIME ZONE 'Asia/Seoul')::date, interval '1 day') d
  ), pay AS (
    SELECT (po.approved_at AT TIME ZONE 'Asia/Seoul')::date AS day, po.expected_amount AS amount, po.vat_amount AS vat,
           po.payment_method_code AS method_code, COALESCE(pm.label, po.payment_method_code) AS method_label, po.plan_name_snapshot AS plan_name
      FROM public.payment_orders po
      LEFT JOIN public.payment_methods pm ON pm.code = po.payment_method_code AND pm.provider = po.provider
     WHERE po.provider = 'payapp' AND po.provider_environment = 'live' AND po.status IN ('completed', 'refunded')
       AND po.approved_at IS NOT NULL AND po.approved_at >= p_from AND po.approved_at < p_to
  ), ref AS (
    SELECT (COALESCE(rr.provider_cancelled_at, rr.processed_at) AT TIME ZONE 'Asia/Seoul')::date AS day, rr.refund_amount AS amount,
           round(rr.refund_amount::numeric / 11)::integer AS vat, rr.origin,
           po.payment_method_code AS method_code, COALESCE(pm.label, po.payment_method_code) AS method_label,
           (SELECT a.external_method FROM public.payment_admin_actions a
             WHERE a.refund_request_id = rr.id AND a.external_method IS NOT NULL ORDER BY a.created_at DESC LIMIT 1) AS external_method
      FROM public.refund_requests rr
      LEFT JOIN public.payment_orders po ON po.id = rr.payment_order_id
      LEFT JOIN public.payment_methods pm ON pm.code = po.payment_method_code AND pm.provider = po.provider
     WHERE rr.provider = 'payapp' AND rr.status = 'completed'
       AND COALESCE(rr.provider_cancelled_at, rr.processed_at) >= p_from AND COALESCE(rr.provider_cancelled_at, rr.processed_at) < p_to
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'day', to_char(d.day, 'YYYY-MM-DD'),
           'paymentCount', (SELECT count(*) FROM pay WHERE pay.day = d.day),
           'paymentAmount', (SELECT COALESCE(sum(amount), 0) FROM pay WHERE pay.day = d.day),
           'paymentVat', (SELECT COALESCE(sum(vat), 0) FROM pay WHERE pay.day = d.day),
           'refundCount', (SELECT count(*) FROM ref WHERE ref.day = d.day),
           'refundAmount', (SELECT COALESCE(sum(amount), 0) FROM ref WHERE ref.day = d.day),
           'refundVat', (SELECT COALESCE(sum(vat), 0) FROM ref WHERE ref.day = d.day),
           'manualRefundCount', (SELECT count(*) FROM ref WHERE ref.day = d.day AND ref.external_method IS NOT NULL),
           'manualRefundAmount', (SELECT COALESCE(sum(amount), 0) FROM ref WHERE ref.day = d.day AND ref.external_method IS NOT NULL),
           'byMethod', (SELECT COALESCE(jsonb_agg(jsonb_build_object('code', g.method_code, 'label', g.method_label, 'count', g.n, 'amount', g.amount, 'vat', g.vat)
                          ORDER BY g.method_label), '[]'::jsonb)
                          FROM (SELECT method_code, method_label, count(*) AS n, sum(amount) AS amount, sum(vat) AS vat
                                  FROM pay WHERE pay.day = d.day GROUP BY method_code, method_label) g),
           'byPlan', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', g.plan_name, 'count', g.n, 'amount', g.amount, 'vat', g.vat)
                        ORDER BY g.plan_name), '[]'::jsonb)
                        FROM (SELECT plan_name, count(*) AS n, sum(amount) AS amount, sum(vat) AS vat
                                FROM pay WHERE pay.day = d.day GROUP BY plan_name) g),
           'refundByOrigin', (SELECT COALESCE(jsonb_agg(jsonb_build_object('origin', g.origin, 'count', g.n, 'amount', g.amount, 'vat', g.vat)
                                ORDER BY g.origin), '[]'::jsonb)
                                FROM (SELECT origin, count(*) AS n, sum(amount) AS amount, sum(vat) AS vat
                                        FROM ref WHERE ref.day = d.day GROUP BY origin) g),
           'refundByMethod', (SELECT COALESCE(jsonb_agg(jsonb_build_object('code', g.method_code, 'label', g.method_label, 'count', g.n, 'amount', g.amount, 'vat', g.vat)
                                ORDER BY g.method_label), '[]'::jsonb)
                                FROM (SELECT method_code, method_label, count(*) AS n, sum(amount) AS amount, sum(vat) AS vat
                                        FROM ref WHERE ref.day = d.day GROUP BY method_code, method_label) g)
         ) ORDER BY d.day), '[]'::jsonb)
    INTO v_days
    FROM days d;

  -- 경고(3-1): 기간 끝까지 만들어진 주문 중 지금 수동 확인·취소 처리 중·지급 대기인 것, 완료 전 부분취소, 전액 환불 부가세 불일치, 환불 요청 없는 수동 처리 기록
  SELECT jsonb_build_object(
    'manualReviewOrders', (SELECT count(*) FROM public.payment_orders po
                            WHERE po.provider = 'payapp' AND po.provider_environment = 'live' AND po.status = 'manual_review' AND po.created_at < p_to),
    'cancelPendingOrders', (SELECT count(*) FROM public.payment_orders po
                             WHERE po.provider = 'payapp' AND po.provider_environment = 'live' AND po.status = 'cancel_pending' AND po.created_at < p_to),
    'fulfillmentPendingOrders', (SELECT count(*) FROM public.payment_orders po
                                  WHERE po.provider = 'payapp' AND po.provider_environment = 'live' AND po.status = 'fulfillment_pending' AND po.created_at < p_to),
    'partialCancelOpen', (SELECT count(*) FROM public.refund_requests rr
                           WHERE rr.provider = 'payapp' AND rr.origin = 'partial_cancel' AND rr.status NOT IN ('completed', 'rejected') AND rr.created_at < p_to),
    'fullRefundVatMismatch', (SELECT count(*) FROM public.refund_requests rr JOIN public.payment_orders po ON po.id = rr.payment_order_id
                               WHERE rr.provider = 'payapp' AND rr.status = 'completed'
                                 AND COALESCE(rr.provider_cancelled_at, rr.processed_at) >= p_from AND COALESCE(rr.provider_cancelled_at, rr.processed_at) < p_to
                                 AND rr.refund_amount = po.expected_amount AND round(rr.refund_amount::numeric / 11)::integer IS DISTINCT FROM po.vat_amount),
    'manualActionsWithoutRefund', (SELECT count(*) FROM public.payment_admin_actions a
                                    WHERE a.external_method IS NOT NULL AND a.refund_request_id IS NULL AND a.created_at >= p_from AND a.created_at < p_to))
    INTO v_warnings;

  RETURN jsonb_build_object('days', v_days, 'warnings', v_warnings);
END;
$fn_report_charge_daily$;

-- 2. 충전 결제 건별(4-1 열 허용 목록). 결제 줄은 승인 시각, 환불 줄은 COALESCE(결제사 취소 시각, 처리 시각) 이 기간 안.
--    넣지 않는 칸: 환불 사유·관리자 메모·처리 메모·details·before/after_state·결제사 회원 키·결제 키·회원 id·이메일·전화·IP.
--    환불 금액은 양수(구분 칸이 '환불'), 환불 줄의 결제 시각은 원 주문 승인 시각(다른 달 결제의 환불을 알아볼 수 있게).
CREATE FUNCTION public.report_payment_lines(p_from timestamptz, p_to timestamptz)
 RETURNS TABLE(line_kind text, order_id text, payment_request_id text, payment_method_code text, payment_method_label text,
               plan_name text, order_status text, amount integer, vat integer, supply_amount integer,
               paid_at timestamptz, refunded_at timestamptz, refund_origin text, external_method text)
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $fn_report_payment_lines$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to OR p_to - p_from > interval '366 days' THEN
    RAISE EXCEPTION 'SALES_REPORT_PERIOD_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.refund_requests rr
              WHERE rr.provider = 'payapp' AND rr.status = 'completed' AND rr.refund_amount IS NULL
                AND COALESCE(rr.provider_cancelled_at, rr.processed_at) >= p_from AND COALESCE(rr.provider_cancelled_at, rr.processed_at) < p_to) THEN
    RAISE EXCEPTION 'REFUND_AMOUNT_MISSING';
  END IF;

  RETURN QUERY
  SELECT x.line_kind, x.order_id, x.payment_request_id, x.payment_method_code, x.payment_method_label, x.plan_name, x.order_status,
         x.amount, x.vat, x.amount - x.vat, x.paid_at, x.refunded_at, x.refund_origin, x.external_method
    FROM (
      SELECT 'payment'::text AS line_kind, po.order_id, ppt.provider_transaction_id AS payment_request_id, po.payment_method_code,
             COALESCE(pm.label, po.payment_method_code) AS payment_method_label, po.plan_name_snapshot AS plan_name, po.status AS order_status,
             po.expected_amount AS amount, po.vat_amount AS vat, po.approved_at AS paid_at, NULL::timestamptz AS refunded_at,
             NULL::text AS refund_origin, NULL::text AS external_method, po.approved_at AS sort_at
        FROM public.payment_orders po
        LEFT JOIN public.payment_provider_transactions ppt ON ppt.payment_order_id = po.id
        LEFT JOIN public.payment_methods pm ON pm.code = po.payment_method_code AND pm.provider = po.provider
       WHERE po.provider = 'payapp' AND po.provider_environment = 'live' AND po.status IN ('completed', 'refunded')
         AND po.approved_at IS NOT NULL AND po.approved_at >= p_from AND po.approved_at < p_to
      UNION ALL
      SELECT 'refund'::text, po.order_id, ppt.provider_transaction_id, po.payment_method_code,
             COALESCE(pm.label, po.payment_method_code), po.plan_name_snapshot, po.status,
             rr.refund_amount, round(rr.refund_amount::numeric / 11)::integer, po.approved_at, COALESCE(rr.provider_cancelled_at, rr.processed_at),
             rr.origin,
             (SELECT a.external_method FROM public.payment_admin_actions a
               WHERE a.refund_request_id = rr.id AND a.external_method IS NOT NULL ORDER BY a.created_at DESC LIMIT 1),
             COALESCE(rr.provider_cancelled_at, rr.processed_at)
        FROM public.refund_requests rr
        LEFT JOIN public.payment_orders po ON po.id = rr.payment_order_id
        LEFT JOIN public.payment_provider_transactions ppt ON ppt.payment_order_id = po.id
        LEFT JOIN public.payment_methods pm ON pm.code = po.payment_method_code AND pm.provider = po.provider
       WHERE rr.provider = 'payapp' AND rr.status = 'completed'
         AND COALESCE(rr.provider_cancelled_at, rr.processed_at) >= p_from AND COALESCE(rr.provider_cancelled_at, rr.processed_at) < p_to
    ) x
   ORDER BY x.sort_at, x.line_kind, x.order_id;
END;
$fn_report_payment_lines$;

-- 3. 크레딧 흐름(C, 3-2). 운영 참고 표. 돌려주는 값:
--    { lines: [{ line, category, subject, purchaseType, count, credits }], balance: { active, pendingRefund }, warnings: [{ code, ... }] }
--    line: grant(분류별 지급) · market_refund_restored/_reissued/_unrecovered(새 방식 자료 환불, 과목별) · market_refund_legacy(옛 방식, 나눔 없음) ·
--          market_usage_ledger(원장 자료 구매 사용) · market_usage_order(주문 표, 과목·구매 방식별) · market_usage_without_order(원장 − 주문 표) ·
--          charge_refund_recovered(충전 환불 회수, 원천 분류별) · admin_revoke · expired(만료 시점 잔량, 분류별) ·
--          withdrawal_expired_cleared(탈퇴 때 정리된 만료 잔량, 탈퇴 처리 시각) · withdrawal_forfeit · generation_usage(꺼진 생성 기능 사용)
--    만료 줄은 기간 끝과 지금 중 이른 때까지 만료된 출처만 센다(아직 만료되지 않은 잔량을 소멸로 세지 않게).
--    탈퇴 때 정리된 만료 잔량은 작업 기록 member_withdraw 의 details.expired_cleared 합(회원 보관 표는 읽지 않는다, 4판).
--    잔액은 부르는 시각 기준(active·pending_refund, 만료 전).
CREATE FUNCTION public.report_credit_flow(p_from timestamptz, p_to timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $fn_report_credit_flow$
DECLARE
  v_lines jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_balance jsonb;
  v_ledger_usage bigint;
  v_order_usage bigint;
  v_alloc_reissued bigint;
  v_linked_reissued bigint;
  v_audit_revokes bigint;
  v_ledger_revokes bigint;
  v_generation bigint;
  v_revoke_credits bigint;
  v_withdraw_cleared bigint;
  v_expire_to timestamptz := LEAST(p_to, now());
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to OR p_to - p_from > interval '366 days' THEN
    RAISE EXCEPTION 'SALES_REPORT_PERIOD_INVALID';
  END IF;

  -- 지급(출처 initial_credits, 분류별)
  v_lines := v_lines || COALESCE((
    SELECT jsonb_agg(jsonb_build_object('line', 'grant', 'category', g.source_category, 'subject', NULL, 'purchaseType', NULL,
                                        'count', g.n, 'credits', g.credits) ORDER BY g.source_category)
      FROM (SELECT s.source_category, count(*) AS n, sum(s.initial_credits) AS credits
              FROM public.credit_sources s WHERE s.created_at >= p_from AND s.created_at < p_to GROUP BY s.source_category) g), '[]'::jsonb);

  -- 자료 환불(승인, 처리 시각): 새 방식은 allocated_items 의 restored·reissued·unrecovered, 옛 방식(나눔 없음)은 approved_refund_credits
  v_lines := v_lines || COALESCE((
    SELECT jsonb_agg(jsonb_build_object('line', g.line, 'category', NULL, 'subject', g.workspace_subject, 'purchaseType', NULL,
                                        'count', g.n, 'credits', g.credits) ORDER BY g.line, g.workspace_subject)
      FROM (
        SELECT v.line, r.workspace_subject, count(DISTINCT r.id) AS n, sum(v.credits) AS credits
          FROM public.market_refund_requests r
          CROSS JOIN LATERAL jsonb_array_elements(r.allocated_items) x
          CROSS JOIN LATERAL (VALUES ('market_refund_restored', COALESCE((x ->> 'restored')::integer, 0)),
                                     ('market_refund_reissued', COALESCE((x ->> 'reissued')::integer, 0)),
                                     ('market_refund_unrecovered', COALESCE((x ->> 'unrecovered')::integer, 0))) v(line, credits)
         WHERE r.status = 'approved' AND r.processed_at >= p_from AND r.processed_at < p_to
           AND jsonb_typeof(r.allocated_items) = 'array' AND jsonb_array_length(r.allocated_items) > 0
         GROUP BY v.line, r.workspace_subject
        HAVING sum(v.credits) <> 0
        UNION ALL
        SELECT 'market_refund_legacy', r.workspace_subject, count(*), sum(COALESCE(r.approved_refund_credits, 0))
          FROM public.market_refund_requests r
         WHERE r.status = 'approved' AND r.processed_at >= p_from AND r.processed_at < p_to
           AND (r.allocated_items IS NULL OR jsonb_typeof(r.allocated_items) <> 'array' OR jsonb_array_length(r.allocated_items) = 0)
         GROUP BY r.workspace_subject) g), '[]'::jsonb);

  -- 자료 구매 사용: 원장 기준 합계 + 주문 표(실패 제외) 과목·구매 방식 나눔 + 차이
  SELECT COALESCE(sum(-t.amount), 0) INTO v_ledger_usage
    FROM public.credit_transactions t
   WHERE t.type = 'consume' AND t.resource_type LIKE 'market_purchase%' AND t.created_at >= p_from AND t.created_at < p_to;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('line', 'market_usage_ledger', 'category', NULL, 'subject', NULL, 'purchaseType', NULL,
    'count', (SELECT count(*) FROM public.credit_transactions t
               WHERE t.type = 'consume' AND t.resource_type LIKE 'market_purchase%' AND t.created_at >= p_from AND t.created_at < p_to),
    'credits', v_ledger_usage));
  SELECT COALESCE(sum(o.charged_credits), 0) INTO v_order_usage
    FROM public.market_purchase_orders o WHERE o.status <> 'failed' AND o.created_at >= p_from AND o.created_at < p_to;
  v_lines := v_lines || COALESCE((
    SELECT jsonb_agg(jsonb_build_object('line', 'market_usage_order', 'category', NULL, 'subject', g.workspace_subject, 'purchaseType', g.purchase_type,
                                        'count', g.n, 'credits', g.credits) ORDER BY g.workspace_subject, g.purchase_type)
      FROM (SELECT o.workspace_subject, o.purchase_type, count(*) AS n, sum(o.charged_credits) AS credits
              FROM public.market_purchase_orders o WHERE o.status <> 'failed' AND o.created_at >= p_from AND o.created_at < p_to
             GROUP BY o.workspace_subject, o.purchase_type) g), '[]'::jsonb);
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('line', 'market_usage_without_order', 'category', NULL, 'subject', NULL, 'purchaseType', NULL,
    'count', NULL, 'credits', v_ledger_usage - v_order_usage));

  -- 충전 환불 회수(원장 refund_request 음수 행 = 실제 회수량, 자동·수동 모두), 원천 분류별
  v_lines := v_lines || COALESCE((
    SELECT jsonb_agg(jsonb_build_object('line', 'charge_refund_recovered', 'category', g.category, 'subject', NULL, 'purchaseType', NULL,
                                        'count', g.n, 'credits', g.credits) ORDER BY g.category)
      FROM (SELECT COALESCE(s.source_category, 'unknown_source') AS category, count(*) AS n, sum(-t.amount) AS credits
              FROM public.credit_transactions t LEFT JOIN public.credit_sources s ON s.id = t.source_id
             WHERE t.type = 'refund' AND t.resource_type = 'refund_request' AND t.amount < 0 AND t.created_at >= p_from AND t.created_at < p_to
             GROUP BY 1) g), '[]'::jsonb);

  -- 관리자 회수(작업 기록 credit_revoke), 원장 회수 행 수와 대조
  SELECT count(*), COALESCE(sum(a.amount), 0) INTO v_audit_revokes, v_revoke_credits
    FROM public.admin_audit_log a WHERE a.action = 'credit_revoke' AND a.created_at >= p_from AND a.created_at < p_to;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('line', 'admin_revoke', 'category', NULL, 'subject', NULL, 'purchaseType', NULL,
    'count', v_audit_revokes, 'credits', v_revoke_credits));
  SELECT count(*) INTO v_ledger_revokes
    FROM public.credit_transactions t
   WHERE t.type = 'refund' AND t.resource_type IS NULL AND t.amount < 0 AND t.created_at >= p_from AND t.created_at < p_to;

  -- 만료 소멸: 만료 시점 잔량 = 지금 잔량 + 수동 충전 환불이 정리한 만료분(payment_admin_actions.details.sources[].expired_cleared)
  v_lines := v_lines || COALESCE((
    SELECT jsonb_agg(jsonb_build_object('line', 'expired', 'category', g.source_category, 'subject', NULL, 'purchaseType', NULL,
                                        'count', g.n, 'credits', g.credits) ORDER BY g.source_category)
      FROM (SELECT s.source_category, count(*) FILTER (WHERE s.remaining_credits + COALESCE(c.cleared, 0) > 0) AS n,
                   sum(s.remaining_credits + COALESCE(c.cleared, 0)) AS credits
              FROM public.credit_sources s
              LEFT JOIN LATERAL (
                SELECT sum(COALESCE((x ->> 'expired_cleared')::integer, 0)) AS cleared
                  FROM public.payment_admin_actions a
                  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a.details -> 'sources') = 'array' THEN a.details -> 'sources' ELSE '[]'::jsonb END) x
                 WHERE a.action = 'manual_refund_completed' AND x ->> 'source_id' = s.id::text) c ON true
             WHERE s.expires_at >= p_from AND s.expires_at < v_expire_to
             GROUP BY s.source_category
            HAVING sum(s.remaining_credits + COALESCE(c.cleared, 0)) > 0) g), '[]'::jsonb);

  -- 탈퇴 때 정리된 만료 잔량(탈퇴 처리 시각 기준)
  SELECT COALESCE(sum(COALESCE((a.details ->> 'expired_cleared')::integer, 0)), 0) INTO v_withdraw_cleared
    FROM public.admin_audit_log a WHERE a.action = 'member_withdraw' AND a.created_at >= p_from AND a.created_at < p_to;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('line', 'withdrawal_expired_cleared', 'category', NULL, 'subject', NULL, 'purchaseType', NULL,
    'count', (SELECT count(*) FROM public.admin_audit_log a WHERE a.action = 'member_withdraw' AND a.created_at >= p_from AND a.created_at < p_to
                AND COALESCE((a.details ->> 'expired_cleared')::integer, 0) > 0),
    'credits', v_withdraw_cleared));

  -- 탈퇴 소멸(원장 withdrawal_forfeit, 음수 행)
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('line', 'withdrawal_forfeit', 'category', NULL, 'subject', NULL, 'purchaseType', NULL,
    'count', (SELECT count(*) FROM public.credit_transactions t
               WHERE t.type = 'withdrawal_forfeit' AND t.amount <> 0 AND t.created_at >= p_from AND t.created_at < p_to),
    'credits', (SELECT COALESCE(sum(-t.amount), 0) FROM public.credit_transactions t
                 WHERE t.type = 'withdrawal_forfeit' AND t.created_at >= p_from AND t.created_at < p_to)));

  -- 생성 기능 사용(자료 구매 외 consume — 꺼진 기능)
  SELECT COALESCE(sum(-t.amount), 0) INTO v_generation
    FROM public.credit_transactions t
   WHERE t.type = 'consume' AND (t.resource_type IS NULL OR t.resource_type NOT LIKE 'market_purchase%') AND t.created_at >= p_from AND t.created_at < p_to;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('line', 'generation_usage', 'category', NULL, 'subject', NULL, 'purchaseType', NULL,
    'count', NULL, 'credits', v_generation));

  -- 잔액(부르는 시각)
  SELECT jsonb_build_object(
           'active', COALESCE(sum(s.remaining_credits) FILTER (WHERE s.status = 'active'), 0),
           'pendingRefund', COALESCE(sum(s.remaining_credits) FILTER (WHERE s.status = 'pending_refund'), 0),
           'at', now())
    INTO v_balance
    FROM public.credit_sources s
   WHERE s.status IN ('active', 'pending_refund') AND (s.expires_at IS NULL OR s.expires_at > now());

  -- 대조 경고
  SELECT COALESCE(sum(COALESCE((x ->> 'reissued')::integer, 0)), 0) INTO v_alloc_reissued
    FROM public.market_refund_requests r
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.allocated_items) = 'array' THEN r.allocated_items ELSE '[]'::jsonb END) x
   WHERE r.status = 'approved' AND r.processed_at >= p_from AND r.processed_at < p_to;
  SELECT COALESCE(sum(s.initial_credits), 0) INTO v_linked_reissued
    FROM public.market_refund_reissued_sources l JOIN public.credit_sources s ON s.id = l.source_id
   WHERE l.created_at >= p_from AND l.created_at < p_to;
  IF v_alloc_reissued <> v_linked_reissued THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'reissue_mismatch', 'allocated', v_alloc_reissued, 'linked', v_linked_reissued));
  END IF;
  IF v_ledger_usage <> v_order_usage THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'usage_without_order', 'credits', v_ledger_usage - v_order_usage));
  END IF;
  IF v_audit_revokes <> v_ledger_revokes THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'revoke_count_mismatch', 'audit', v_audit_revokes, 'ledger', v_ledger_revokes));
  END IF;
  IF v_generation <> 0 THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'generation_usage', 'credits', v_generation));
  END IF;
  IF v_withdraw_cleared > 0 THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'expired_undercount', 'credits', v_withdraw_cleared));
  END IF;

  RETURN jsonb_build_object('lines', v_lines, 'balance', v_balance, 'warnings', v_warnings);
END;
$fn_report_credit_flow$;

-- 4. 사용분 참고 금액(원, 3-3). 출처마다 유상 뿌리를 재귀 CTE 로 찾는다(credit_source_paid_root 와 같은 규칙: system_refund 이면
--    market_refund_reissued_sources.original_source_id 로 거슬러 올라가고(최대 20번, 돌아오면 멈춤), plan_purchase 에서 멈춘다).
--    뿌리 분류: paid(요금제 구매 + 실결제 주문 — provider_environment live, 상태 completed·refunded. 단가 = 주문 expected_amount ÷ 뿌리 initial_credits) ·
--    paid_test(주문은 있으나 시험 환경·미완료 결제, 0원 + 경고 test_payment) · paid_unknown_price(주문 없는 옛 요금제 구매, 0원) ·
--    admin_grant · bonus · legacy_unknown · system_refund(뿌리를 못 찾은 재지급) · unknown_source(출처 행 없음) — paid 밖은 0원.
--    총사용 = credit_consumption(자료 구매) 출처별 양 × 단가(차감 시각 기간). 환불 차감 = 승인 자료 환불의 allocated_items 출처별
--    (restored + reissued) × 단가, 옛 행은 주문 credit_consumptions 비율로 나눔(내림, 나머지는 첫 출처). 원 미만 버림, 끝수는 따로.
--    돌려주는 값: { gross: { rows: [{ category, credits, won }], credits, won, fraction }, refund: {…}, net: { credits, won, fraction }, warnings: [] }
CREATE FUNCTION public.report_credit_usage_value(p_from timestamptz, p_to timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $fn_report_credit_usage_value$
DECLARE
  v_result jsonb;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to OR p_to - p_from > interval '366 days' THEN
    RAISE EXCEPTION 'SALES_REPORT_PERIOD_INVALID';
  END IF;

  WITH RECURSIVE cons AS (
    SELECT cc.source_id, sum(cc.amount)::bigint AS credits
      FROM public.credit_consumption cc
     WHERE cc.resource_type LIKE 'market_purchase%' AND cc.created_at >= p_from AND cc.created_at < p_to
     GROUP BY cc.source_id
  ), refund_new AS (
    SELECT NULLIF(x ->> 'source_id', '')::uuid AS source_id,
           (COALESCE((x ->> 'restored')::integer, 0) + COALESCE((x ->> 'reissued')::integer, 0))::bigint AS credits
      FROM public.market_refund_requests r
      CROSS JOIN LATERAL jsonb_array_elements(r.allocated_items) x
     WHERE r.status = 'approved' AND r.processed_at >= p_from AND r.processed_at < p_to
       AND jsonb_typeof(r.allocated_items) = 'array' AND jsonb_array_length(r.allocated_items) > 0
  ), legacy AS (
    SELECT r.id, COALESCE(r.approved_refund_credits, 0)::bigint AS approved, o.credit_consumptions AS cons
      FROM public.market_refund_requests r
      LEFT JOIN public.market_purchase_orders o ON o.id = r.order_id
     WHERE r.status = 'approved' AND r.processed_at >= p_from AND r.processed_at < p_to
       AND (r.allocated_items IS NULL OR jsonb_typeof(r.allocated_items) <> 'array' OR jsonb_array_length(r.allocated_items) = 0)
       AND COALESCE(r.approved_refund_credits, 0) > 0
  ), legacy_parts AS (
    SELECT l.id, l.approved, NULLIF(COALESCE(e ->> 'source_id', e ->> 'sourceId'), '')::uuid AS source_id,
           COALESCE((e ->> 'amount')::integer, 0) AS amount, t.ord
      FROM legacy l
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(l.cons) = 'array' THEN l.cons ELSE '[]'::jsonb END) WITH ORDINALITY AS t(e, ord)
  ), legacy_valid AS (
    SELECT p.*, sum(p.amount) OVER (PARTITION BY p.id) AS total, row_number() OVER (PARTITION BY p.id ORDER BY p.ord) AS rn
      FROM legacy_parts p WHERE p.source_id IS NOT NULL AND p.amount > 0
  ), legacy_floor AS (
    SELECT v.id, v.source_id, v.rn, v.approved, floor(v.approved::numeric * v.amount / v.total)::bigint AS base FROM legacy_valid v
  ), legacy_shares AS (
    SELECT f.source_id, f.base + CASE WHEN f.rn = 1 THEN f.approved - sum(f.base) OVER (PARTITION BY f.id) ELSE 0 END AS credits FROM legacy_floor f
  ), refund_all AS (
    SELECT source_id, credits FROM refund_new WHERE credits <> 0
    UNION ALL SELECT source_id, credits FROM legacy_shares WHERE credits <> 0
    UNION ALL SELECT NULL::uuid, l.approved FROM legacy l WHERE NOT EXISTS (SELECT 1 FROM legacy_valid v WHERE v.id = l.id)
  ), starts AS (
    SELECT source_id FROM cons WHERE source_id IS NOT NULL
    UNION SELECT source_id FROM refund_all WHERE source_id IS NOT NULL
  ), walk AS (
    SELECT s.source_id AS start_id, s.source_id AS cur_id, 0 AS depth, ARRAY[s.source_id] AS seen FROM starts s
    UNION ALL
    SELECT w.start_id, l.original_source_id, w.depth + 1, w.seen || l.original_source_id
      FROM walk w
      JOIN public.credit_sources c ON c.id = w.cur_id AND c.source_category = 'system_refund'
      JOIN public.market_refund_reissued_sources l ON l.source_id = w.cur_id
     WHERE l.original_source_id IS NOT NULL AND NOT (l.original_source_id = ANY (w.seen)) AND w.depth < 20
  ), root AS (
    SELECT DISTINCT ON (w.start_id) w.start_id, w.cur_id FROM walk w ORDER BY w.start_id, w.depth DESC
  ), priced AS (
    SELECT r.start_id AS source_id,
           CASE WHEN c.id IS NULL THEN 'unknown_source'
                WHEN c.source_category = 'plan_purchase' AND po.id IS NOT NULL AND po.provider_environment = 'live'
                     AND po.status IN ('completed', 'refunded') THEN 'paid'
                WHEN c.source_category = 'plan_purchase' AND po.id IS NOT NULL THEN 'paid_test'
                WHEN c.source_category = 'plan_purchase' THEN 'paid_unknown_price'
                ELSE c.source_category END AS category,
           CASE WHEN c.source_category = 'plan_purchase' AND po.id IS NOT NULL AND po.provider_environment = 'live'
                     AND po.status IN ('completed', 'refunded')
                THEN po.expected_amount::numeric / c.initial_credits ELSE 0 END AS unit_price
      FROM root r
      LEFT JOIN public.credit_sources c ON c.id = r.cur_id
      LEFT JOIN public.payment_orders po ON po.id = c.payment_order_id
  ), gross AS (
    SELECT COALESCE(p.category, 'unknown_source') AS category, sum(x.credits)::bigint AS credits, sum(x.credits * COALESCE(p.unit_price, 0)) AS exact
      FROM cons x LEFT JOIN priced p ON p.source_id = x.source_id GROUP BY 1
  ), refund AS (
    SELECT COALESCE(p.category, 'unknown_source') AS category, sum(x.credits)::bigint AS credits, sum(x.credits * COALESCE(p.unit_price, 0)) AS exact
      FROM refund_all x LEFT JOIN priced p ON p.source_id = x.source_id GROUP BY 1
  ), sections AS (
    SELECT 'gross' AS section, g.category, g.credits, g.exact, trunc(g.exact)::bigint AS won FROM gross g
    UNION ALL
    SELECT 'refund', r.category, r.credits, r.exact, trunc(r.exact)::bigint FROM refund r
  ), totals AS (
    SELECT s.section, sum(s.credits)::bigint AS credits, sum(s.won)::bigint AS won, round(sum(s.exact) - sum(s.won), 4) AS fraction
      FROM sections s GROUP BY s.section
  )
  SELECT jsonb_build_object(
    'gross', jsonb_build_object(
      'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object('category', s.category, 'credits', s.credits, 'won', s.won) ORDER BY s.category)
                          FROM sections s WHERE s.section = 'gross'), '[]'::jsonb),
      'credits', COALESCE((SELECT t.credits FROM totals t WHERE t.section = 'gross'), 0),
      'won', COALESCE((SELECT t.won FROM totals t WHERE t.section = 'gross'), 0),
      'fraction', COALESCE((SELECT t.fraction FROM totals t WHERE t.section = 'gross'), 0)),
    'refund', jsonb_build_object(
      'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object('category', s.category, 'credits', s.credits, 'won', s.won) ORDER BY s.category)
                          FROM sections s WHERE s.section = 'refund'), '[]'::jsonb),
      'credits', COALESCE((SELECT t.credits FROM totals t WHERE t.section = 'refund'), 0),
      'won', COALESCE((SELECT t.won FROM totals t WHERE t.section = 'refund'), 0),
      'fraction', COALESCE((SELECT t.fraction FROM totals t WHERE t.section = 'refund'), 0)),
    'net', jsonb_build_object(
      'credits', COALESCE((SELECT t.credits FROM totals t WHERE t.section = 'gross'), 0) - COALESCE((SELECT t.credits FROM totals t WHERE t.section = 'refund'), 0),
      'won', COALESCE((SELECT t.won FROM totals t WHERE t.section = 'gross'), 0) - COALESCE((SELECT t.won FROM totals t WHERE t.section = 'refund'), 0),
      'fraction', COALESCE((SELECT t.fraction FROM totals t WHERE t.section = 'gross'), 0) - COALESCE((SELECT t.fraction FROM totals t WHERE t.section = 'refund'), 0)),
    'warnings', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', CASE s.category WHEN 'paid_unknown_price' THEN 'unknown_price'
                                                                                  WHEN 'paid_test' THEN 'test_payment' ELSE 'unknown_source' END,
                                                              'section', s.section, 'credits', s.credits) ORDER BY s.section, s.category)
                            FROM sections s WHERE s.category IN ('paid_unknown_price', 'paid_test', 'unknown_source') AND s.credits <> 0), '[]'::jsonb))
    INTO v_result;

  RETURN v_result;
END;
$fn_report_credit_usage_value$;

-- 5. 함수 권한: PUBLIC·anon·authenticated(와 기본 권한으로 받은 service_role)을 회수한 뒤 service_role 만 EXECUTE.
REVOKE ALL ON FUNCTION public.report_charge_daily(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.report_payment_lines(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.report_credit_flow(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.report_credit_usage_value(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_charge_daily(timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.report_payment_lines(timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.report_credit_flow(timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.report_credit_usage_value(timestamptz, timestamptz) TO service_role;

-- 6. 설정 행(4-2). 초안 문구 — 대표가 관리자 화면 '매출·정산'의 안내 문구 카드에서 고친다. 필수 키 목록은
--    src/lib/sales-report.ts SALES_REPORT_CONTENT_TEXT_KEYS(아래 VERIFY 와 같은 목록). 회원도 읽을 수 있는 행이라 내부 정보는 넣지 않는다.
INSERT INTO public.system_settings (key, value, description)
VALUES ('sales_report_content', $json_bundle23_content$
{
  "definitionVersion": 1,
  "revision": 1,
  "fileTitle": "매출·정산 CSV",
  "headerNotice": "사이트 DB 기록으로 만든 대조용 자료입니다. 세금 신고 수치는 페이앱 정산 자료를 기준으로 합니다.",
  "kstNotice": "모든 기간과 시각은 한국 시간 기준입니다.",
  "netNotice": "순액은 결제와 환불을 각자 일어난 시각으로 셉니다. 다른 달에 결제한 주문의 환불이 섞일 수 있습니다.",
  "creditNotice": "크레딧 표는 운영 참고용입니다. 지난 시점의 잔액은 다시 만들 수 없어 기간 흐름이 잔액과 맞아떨어지지 않습니다.",
  "withdrawalNotice": "결제하지 않은 회원이 탈퇴하면 그 회원의 크레딧·자료 구매 기록이 지워져 지난 기간 크레딧 흐름이 줄 수 있습니다. 결제 기준 표는 영향이 없습니다.",
  "expiryNotice": "탈퇴 때 정리된 만료 잔량은 탈퇴 처리 시각 기준으로 따로 셉니다. 그만큼 지난 기간의 만료 소멸이 줄어 보일 수 있습니다.",
  "usageNotice": "참고 금액은 사용한 크레딧을 요금제 결제 단가로 바꾼 값입니다. 관리자 지급·보너스 같은 무상 크레딧은 0원입니다. 원 미만은 버리고 끝수를 따로 적습니다.",
  "screenGuide": "페이앱 정산 자료와 맞춰 보세요 · 절차는 런북 RB-10"
}
$json_bundle23_content$::jsonb, '23번: 매출·정산 CSV 머리 문구·화면 안내(대표가 관리자 화면에서 고침, 회원도 읽을 수 있는 행 — 내부 정보 금지)')
ON CONFLICT (key) DO NOTHING;
-- [23번] 끝 ---------------------------------------------------------------------------------------------------------

-- 7. VERIFY(4-3) ---------------------------------------------------------------------------------------------------
DO $verify_bundle23_sales_report$
DECLARE
  v_fn text;
  v_value jsonb;
  v_key text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.report_charge_daily(timestamptz,timestamptz)', 'public.report_payment_lines(timestamptz,timestamptz)',
                              'public.report_credit_flow(timestamptz,timestamptz)', 'public.report_credit_usage_value(timestamptz,timestamptz)'] LOOP
    IF to_regprocedure(v_fn) IS NULL
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS NOT FALSE
       OR (SELECT p.provolatile FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) <> 's'
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND 'search_path=public, pg_temp' = ANY (p.proconfig))
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = to_regprocedure(v_fn) AND a.grantee = 0) THEN
      RAISE EXCEPTION 'VERIFY: % SECURITY INVOKER / STABLE / search_path / EXECUTE', v_fn;
    END IF;
    -- 운영 helper·회원 보관 표를 읽지 않는다(4-1)
    IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) ~ '(credit_source_paid_root|credit_source_reissued_descendants|withdrawn_member_records)' THEN
      RAISE EXCEPTION 'VERIFY: % reads a forbidden helper or table', v_fn;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('report_charge_daily', 'report_payment_lines', 'report_credit_flow', 'report_credit_usage_value')) <> 4 THEN
    RAISE EXCEPTION 'VERIFY: overloads';
  END IF;
  -- 건별 반환 열 = 허용 목록(순서까지)
  IF (SELECT array_agg(n ORDER BY i)
        FROM pg_proc p, unnest(p.proargnames, p.proargmodes) WITH ORDINALITY AS a(n, m, i)
       WHERE p.oid = to_regprocedure('public.report_payment_lines(timestamptz,timestamptz)') AND a.m = 't')
     IS DISTINCT FROM ARRAY['line_kind', 'order_id', 'payment_request_id', 'payment_method_code', 'payment_method_label', 'plan_name',
                            'order_status', 'amount', 'vat', 'supply_amount', 'paid_at', 'refunded_at', 'refund_origin', 'external_method']::text[] THEN
    RAISE EXCEPTION 'VERIFY: report_payment_lines columns are not the allow-list';
  END IF;
  -- 회원 보관 표에 service_role 권한을 더하지 않았다
  IF has_table_privilege('service_role', 'public.withdrawn_member_records', 'SELECT') THEN
    RAISE EXCEPTION 'VERIFY: withdrawn_member_records must stay closed to service_role';
  END IF;
  -- 설정 행 필수 키(SALES_REPORT_CONTENT_TEXT_KEYS): 비지 않은 한 줄 글 1~300자, 정의 판·revision 은 정수
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'sales_report_content';
  IF v_value IS NULL OR jsonb_typeof(v_value -> 'definitionVersion') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_value -> 'revision') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'VERIFY: sales_report_content shape';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['fileTitle', 'headerNotice', 'kstNotice', 'netNotice', 'creditNotice', 'withdrawalNotice', 'expiryNotice',
                               'usageNotice', 'screenGuide'] LOOP
    IF jsonb_typeof(v_value -> v_key) IS DISTINCT FROM 'string' OR btrim(v_value ->> v_key) = '' OR char_length(v_value ->> v_key) > 300
       OR (v_value ->> v_key) ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'VERIFY: sales_report_content.%', v_key;
    END IF;
  END LOOP;
END;
$verify_bundle23_sales_report$;

-- (light 사본: [23번 기존 표 DDL] 시작 ~ 끝 구역을 뺐다)

NOTIFY pgrst, 'reload schema';


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

DO $rh_r1$
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

    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'R1', 'down');
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('report_charge_daily', 'report_payment_lines', 'report_credit_flow', 'report_credit_usage_value'))
      AND NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'sales_report_content'), 'R1', '남는 함수·설정 행 0');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK', 'R1', '없을 때 down 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'R1', '다시 적용(VERIFY 통과)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'ERR PRECHECK: bundle 23 report functions already exist', 'R1', '두 번 적용 멈춤');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R1', m FROM unnest(v_log) m;
END
$rh_r1$;

DO $rh_r2$
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

    v_j := public.report_charge_daily(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'));
    v_k := public.report_credit_flow(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'));
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
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'paymentCount'), 5, 'R2', '3-4 결제 건수');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'paymentAmount'), 60600, 'R2', '3-4 결제 금액');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'paymentVat'), 5509, 'R2', '3-4 부가세');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'paymentAmount') - pg_temp.day_sum(v_j, 'paymentVat'), 55091, 'R2', '3-4 공급가액');
    v_log := v_log || pg_temp.eq(pg_temp.method_sum(v_j, '네이버페이', 'count'), 3, 'R2', '3-4 네이버페이 건수');
    v_log := v_log || pg_temp.eq(pg_temp.method_sum(v_j, '네이버페이', 'amount'), 49700, 'R2', '3-4 네이버페이 금액');
    v_log := v_log || pg_temp.eq(pg_temp.method_sum(v_j, '네이버페이', 'vat'), 4518, 'R2', '3-4 네이버페이 부가세');
    v_log := v_log || pg_temp.eq(pg_temp.method_sum(v_j, '신용·체크카드', 'count'), 2, 'R2', '3-4 신용·체크카드 건수');
    v_log := v_log || pg_temp.eq(pg_temp.method_sum(v_j, '신용·체크카드', 'amount'), 10900, 'R2', '3-4 신용·체크카드 금액');
    v_log := v_log || pg_temp.eq(pg_temp.method_sum(v_j, '신용·체크카드', 'vat'), 991, 'R2', '3-4 신용·체크카드 부가세');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'refundCount'), 1, 'R2', '3-4 환불 건수');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'refundAmount'), 1000, 'R2', '3-4 환불 금액');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'refundVat'), 91, 'R2', '3-4 환불 부가세');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'paymentAmount') - pg_temp.day_sum(v_j, 'refundAmount'), 59600, 'R2', '3-4 순액');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'paymentVat') - pg_temp.day_sum(v_j, 'refundVat'), 5418, 'R2', '3-4 순 부가세');
    v_log := v_log || pg_temp.eq(pg_temp.day_sum(v_j, 'manualRefundCount'), 0, 'R2', '3-4 수동 처리 환불 0건');
    v_log := v_log || pg_temp.eq((v_j -> 'warnings' ->> 'manualReviewOrders')::numeric, 0, 'R2', '3-4 수동 확인 주문 0건');
    v_log := v_log || pg_temp.eq((v_j -> 'warnings' ->> 'fullRefundVatMismatch')::numeric, 0, 'R2', '전액 환불 부가세 = 원 주문 부가세');
    v_log := v_log || pg_temp.eq(jsonb_array_length(v_j -> 'days'), 30, 'R2', '11월 30일 0 채움');
    -- 건별 합 = 요약
    v_log := v_log || pg_temp.eq((SELECT COALESCE(sum(amount), 0) FROM public.report_payment_lines(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01')) WHERE line_kind = 'payment'),
      pg_temp.day_sum(v_j, 'paymentAmount'), 'R2', '건별 결제 합 = 요약');
    v_log := v_log || pg_temp.eq((SELECT COALESCE(sum(vat), 0) FROM public.report_payment_lines(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01')) WHERE line_kind = 'refund'),
      pg_temp.day_sum(v_j, 'refundVat'), 'R2', '건별 환불 부가세 합 = 요약');
    v_log := v_log || pg_temp.eq((SELECT count(*) FROM public.report_payment_lines(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01')) WHERE line_kind = 'payment' AND payment_request_id IS NULL), 0,
      'R2', '결제 줄마다 결제요청번호 있음');
    -- 크레딧(3-4)
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_k, 'grant', 'count', 'plan_purchase'), 5, 'R2', '3-4 지급 plan_purchase 건수');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_k, 'grant', 'credits', 'plan_purchase'), 63100, 'R2', '3-4 지급 plan_purchase C');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_k, 'grant', 'count', 'admin_grant'), 4, 'R2', '3-4 지급 admin_grant 건수');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_k, 'grant', 'credits', 'admin_grant'), 10200, 'R2', '3-4 지급 admin_grant C');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_k, 'market_usage_ledger', 'credits'), 48000, 'R2', '3-4 자료 구매 사용(원장)');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_k, 'market_usage_order', 'credits'), 43000, 'R2', '3-4 자료 구매 사용(주문 표)');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_k, 'market_usage_without_order', 'credits'), 5000, 'R2', '3-4 주문 행 없는 사용');
    v_log := v_log || pg_temp.ensure(pg_temp.has_warning(v_k, 'usage_without_order'), 'R2', '주문 행 없는 사용 경고');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_k, 'market_refund_legacy', 'count'), 2, 'R2', '3-4 자료 환불 옛 방식 건수');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_k, 'market_refund_legacy', 'credits'), 5000, 'R2', '3-4 자료 환불 옛 방식 C');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_k, 'charge_refund_recovered', 'credits'), 100, 'R2', '3-4 충전 환불 회수');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_k, 'admin_revoke', 'count'), 3, 'R2', '3-4 관리자 회수 건수');
    v_log := v_log || pg_temp.eq(pg_temp.flow(v_k, 'admin_revoke', 'credits'), 200, 'R2', '3-4 관리자 회수 C');
    v_log := v_log || pg_temp.ensure(NOT pg_temp.has_warning(v_k, 'revoke_count_mismatch'), 'R2', '관리자 회수 기록 수 = 원장 회수 행 수');
    -- 참고 금액: 총사용 C = 원장 자료 구매 사용(3-3)
    v_usage := public.report_credit_usage_value(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'));
    v_log := v_log || pg_temp.eq((v_usage -> 'gross' ->> 'credits')::numeric, 48000, 'R2', '참고 금액 총사용 C = 원장 사용');
    INSERT INTO _rh_log (test, msg, payload) VALUES ('R2', '11월 크레딧 흐름·참고 금액(참고)', jsonb_build_object('flow', v_k, 'usage', v_usage));
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R2', m FROM unnest(v_log) m;
END
$rh_r2$;

DO $rh_r3$
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
      'OK', 'R3', '다른 기간(11월)은 그대로');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R3', m FROM unnest(v_log) m;
END
$rh_r3$;

DO $rh_r4$
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

    v_before := public.report_credit_flow(pg_temp.kst('2025-06-01'), pg_temp.kst('2025-07-01'));
    v_usage := public.report_credit_usage_value(pg_temp.kst('2025-06-01'), pg_temp.kst('2025-07-01'));
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

    v_after := public.report_credit_flow(pg_temp.kst('2025-06-01'), pg_temp.kst('2025-07-01'));
    v_usage := public.report_credit_usage_value(pg_temp.kst('2025-06-01'), pg_temp.kst('2025-07-01'));
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
    v_log := v_log || pg_temp.eq((v_usage -> 'net' ->> 'fraction')::numeric, 0.6, 'R4', '순사용 끝수 0.7 − 0.1');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R4', m FROM unnest(v_log) m;
END
$rh_r4$;

DO $rh_r5$
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
    RESET ROLE;
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R5', m FROM unnest(v_log) m;
END
$rh_r5$;

DO $rh_r6$
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
      'ERR SALES_REPORT_PERIOD_INVALID', 'R6', '거꾸로 된 기간 예외');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R6', m FROM unnest(v_log) m;
END
$rh_r6$;

DO $rh_leftover$
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

    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.payment_orders WHERE order_id LIKE 'rh23-%') = 0
      AND (SELECT count(*) FROM public.credit_transactions WHERE description = 'rh23') = 0, 'Z', '경우 밖에 남은 가짜 행 0(ROLLBACK 전)');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'Z', m FROM unnest(v_log) m;
END
$rh_leftover$;

SELECT n, test, msg, payload FROM _rh_log ORDER BY n;
ROLLBACK;
