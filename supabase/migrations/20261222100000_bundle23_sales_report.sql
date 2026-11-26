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

-- 8. [23번 기존 표 DDL] 시작 — system_settings 정책 만들기(짧은 표 잠금, 새벽, lock_timeout 3초). 리허설 light 사본은 이 구역과 아래 VERIFY 블록을 뺀다. --
--    화면 세션(대표 포함)이 설정 행을 직접 고치지 못한다(저장은 서버 키 서버 액션만 — 작업 기록 sales_report_content_update). down 이 지우므로 없을 때 만든다.
DO $policy_bundle23_sales_report_content$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings'
                  AND policyname = 'system_settings_sales_report_content_no_client_write') THEN
    CREATE POLICY system_settings_sales_report_content_no_client_write ON public.system_settings
      AS RESTRICTIVE FOR UPDATE
      USING (key <> 'sales_report_content')
      WITH CHECK (key <> 'sales_report_content');
  END IF;
END;
$policy_bundle23_sales_report_content$;

DO $verify_bundle23_settings_policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings'
                  AND policyname = 'system_settings_sales_report_content_no_client_write' AND permissive = 'RESTRICTIVE' AND cmd = 'UPDATE'
                  AND qual = '(key <> ''sales_report_content''::text)' AND with_check = '(key <> ''sales_report_content''::text)') THEN
    RAISE EXCEPTION 'VERIFY: system_settings_sales_report_content_no_client_write policy';
  END IF;
END;
$verify_bundle23_settings_policy$;
-- [23번 기존 표 DDL] 끝 ---------------------------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';
