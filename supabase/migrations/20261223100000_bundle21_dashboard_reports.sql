-- 출시 전 작업 순서표 21번 묶음: 관리자 대시보드(계획 docs/plan-bundle21-dashboard.md 3판, 5절).
-- 하는 것(표는 만들지도 바꾸지도 않는다):
--   읽기 전용 보고 함수 3개: report_market_daily·report_activity_daily·report_market_item_ranking.
--   모두 STABLE SECURITY INVOKER, search_path 고정, EXECUTE 는 service_role 만(PUBLIC·anon·authenticated 회수 — 운영 pg_default_acl 이
--   새 함수에 anon·authenticated EXECUTE 를 준다). 기간은 [p_from, p_to) 이고 367일을 넘으면 DASHBOARD_PERIOD_INVALID.
--   p_subject 는 'korean'·'english'·NULL(전체)만. 원(돈)·회원 개인정보(이메일·전화·회원 id)는 돌려주지 않는다.
--   읽는 표(고정 목록): market_purchase_orders·market_refund_requests·market_download_events·market_items·profiles(가입 수 세기만)
--   — 모두 service_role SELECT 가 이미 있다.
--   충전(원) 숫자는 23번 report_charge_daily 를 그대로 쓴다(이 파일에 없음). 대시보드 코드는 권한별로 이 함수들을 부르고,
--   한 함수에 여러 권한 값이 섞인 것은 서버의 pickDashboardFields 한 곳에서 허용 필드만 남긴다(4-1).
-- 표 잠금 DDL 이 없어 리허설 light 사본은 원본과 같다(이력 표 쓰기만 뺀다).
-- 되돌리기: supabase/rollback/20261223100000_bundle21_dashboard_reports_down.sql(21번 대시보드 코드를 먼저 되돌려 배포한 뒤).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 0. 사전 점검 ------------------------------------------------------------------------------------------------------
DO $precheck_bundle21_dashboard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('report_market_daily', 'report_activity_daily', 'report_market_item_ranking')) THEN
    RAISE EXCEPTION 'PRECHECK: bundle 21 report functions already exist';
  END IF;
  -- 함수가 읽는 칸이 있다(이름이 바뀌었으면 멈춤)
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'market_purchase_orders'
        AND column_name IN ('item_id', 'workspace_subject', 'purchase_type', 'charged_credits', 'status', 'created_at')) <> 6
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'market_refund_requests'
        AND column_name IN ('workspace_subject', 'approved_refund_credits', 'status', 'processed_at')) <> 4
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'market_download_events'
        AND column_name IN ('item_id', 'user_id', 'workspace_subject', 'created_at')) <> 4
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'market_items'
        AND column_name IN ('id', 'title', 'workspace_subject', 'status', 'is_active', 'deleted_at')) <> 6
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles'
        AND column_name IN ('created_at', 'is_admin')) <> 2 THEN
    RAISE EXCEPTION 'PRECHECK: dashboard source columns changed';
  END IF;
END
$precheck_bundle21_dashboard$;

-- [21번] 시작 -------------------------------------------------------------------------------------------------------
-- 1. 자료 판매(주문 표 기준, Q6) 한국 날짜당 1행(최대 367행 — PostgREST 1,000행 상한 아래). 0 채움.
--    purchases = { 과목: { subproduct: {n, c}, bundle: {n, c}, (이전 방식이 있으면) legacy: {n, c} } }
--      구매: status IN ('completed','refunded','revoked'), 구매 시각 created_at, n = 건수, c = charged_credits 합(뒤에 환불된 것 포함).
--      legacy_backfill 은 'legacy' 키로 따로(지금 0건이라 없을 때는 키를 싣지 않는다).
--    refunds = { 과목: {n, c} } — 자료 환불 승인(status = 'approved')의 approved_refund_credits, 시각 processed_at, 과목 workspace_subject.
--    회수 건수는 넣지 않는다(주문 표에 회수 시각 열이 없음).
--    과목 키: p_subject 가 NULL 이면 korean·english 둘 다, 아니면 그 과목만.
CREATE FUNCTION public.report_market_daily(p_from timestamptz, p_to timestamptz, p_subject text)
 RETURNS TABLE(day date, purchases jsonb, refunds jsonb)
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $fn_report_market_daily$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to OR p_to - p_from > interval '367 days' THEN
    RAISE EXCEPTION 'DASHBOARD_PERIOD_INVALID';
  END IF;
  IF p_subject IS NOT NULL AND p_subject NOT IN ('korean', 'english') THEN
    RAISE EXCEPTION 'DASHBOARD_SUBJECT_INVALID';
  END IF;

  RETURN QUERY
  WITH kst_days AS (
    SELECT g::date AS kst_day
      FROM generate_series((p_from AT TIME ZONE 'Asia/Seoul')::date, ((p_to - interval '1 microsecond') AT TIME ZONE 'Asia/Seoul')::date, interval '1 day') g
  ), subjects AS (
    SELECT s.code FROM unnest(ARRAY['korean', 'english']) AS s(code) WHERE p_subject IS NULL OR s.code = p_subject
  ), buy AS (
    SELECT (o.created_at AT TIME ZONE 'Asia/Seoul')::date AS kst_day, o.workspace_subject AS code,
           CASE WHEN o.purchase_type IN ('subproduct', 'bundle') THEN o.purchase_type ELSE 'legacy' END AS kind,
           count(*)::integer AS n, COALESCE(sum(o.charged_credits), 0)::bigint AS c
      FROM public.market_purchase_orders o
     WHERE o.status IN ('completed', 'refunded', 'revoked')
       AND o.created_at >= p_from AND o.created_at < p_to
       AND (p_subject IS NULL OR o.workspace_subject = p_subject)
     GROUP BY 1, 2, 3
  ), ref AS (
    SELECT (r.processed_at AT TIME ZONE 'Asia/Seoul')::date AS kst_day, r.workspace_subject AS code,
           count(*)::integer AS n, COALESCE(sum(r.approved_refund_credits), 0)::bigint AS c
      FROM public.market_refund_requests r
     WHERE r.status = 'approved'
       AND r.processed_at >= p_from AND r.processed_at < p_to
       AND (p_subject IS NULL OR r.workspace_subject = p_subject)
     GROUP BY 1, 2
  )
  SELECT d.kst_day,
         (SELECT jsonb_object_agg(sj.code,
                   jsonb_build_object(
                     'subproduct', jsonb_build_object('n', COALESCE(sp.n, 0), 'c', COALESCE(sp.c, 0)),
                     'bundle', jsonb_build_object('n', COALESCE(bd.n, 0), 'c', COALESCE(bd.c, 0)))
                   || CASE WHEN lg.n IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('legacy', jsonb_build_object('n', lg.n, 'c', lg.c)) END)
            FROM subjects sj
            LEFT JOIN buy sp ON sp.kst_day = d.kst_day AND sp.code = sj.code AND sp.kind = 'subproduct'
            LEFT JOIN buy bd ON bd.kst_day = d.kst_day AND bd.code = sj.code AND bd.kind = 'bundle'
            LEFT JOIN buy lg ON lg.kst_day = d.kst_day AND lg.code = sj.code AND lg.kind = 'legacy'),
         (SELECT jsonb_object_agg(sj.code, jsonb_build_object('n', COALESCE(x.n, 0), 'c', COALESCE(x.c, 0)))
            FROM subjects sj
            LEFT JOIN ref x ON x.kst_day = d.kst_day AND x.code = sj.code)
    FROM kst_days d
   ORDER BY d.kst_day;
END;
$fn_report_market_daily$;

-- 2. 활동: 한국 날짜별 가입 수·다운로드 수·다운로드한 회원 수와 기간 합계(기간 합계의 회원 수는 날짜별 합이 아니라 기간 안 서로 다른 회원 수).
--    가입: profiles.created_at 기간 안, is_admin 아님(탈퇴 회원도 가입 시점에는 셈). 과목과 무관(회원에 과목이 없음, 4-3).
--    다운로드: market_download_events.created_at 기간 안, 과목 필터(workspace_subject).
--    돌려주는 값: { days: [{ day, signups, downloads, downloadUsers }], totals: { signups, downloads, downloadUsers } }
CREATE FUNCTION public.report_activity_daily(p_from timestamptz, p_to timestamptz, p_subject text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $fn_report_activity_daily$
DECLARE
  v_days jsonb;
  v_totals jsonb;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to OR p_to - p_from > interval '367 days' THEN
    RAISE EXCEPTION 'DASHBOARD_PERIOD_INVALID';
  END IF;
  IF p_subject IS NOT NULL AND p_subject NOT IN ('korean', 'english') THEN
    RAISE EXCEPTION 'DASHBOARD_SUBJECT_INVALID';
  END IF;

  WITH kst_days AS (
    SELECT g::date AS kst_day
      FROM generate_series((p_from AT TIME ZONE 'Asia/Seoul')::date, ((p_to - interval '1 microsecond') AT TIME ZONE 'Asia/Seoul')::date, interval '1 day') g
  ), joins AS (
    SELECT (p.created_at AT TIME ZONE 'Asia/Seoul')::date AS kst_day, count(*)::integer AS n
      FROM public.profiles p
     WHERE p.created_at >= p_from AND p.created_at < p_to AND p.is_admin IS NOT TRUE
     GROUP BY 1
  ), downloads AS (
    SELECT (e.created_at AT TIME ZONE 'Asia/Seoul')::date AS kst_day, count(*)::integer AS n, count(DISTINCT e.user_id)::integer AS users
      FROM public.market_download_events e
     WHERE e.created_at >= p_from AND e.created_at < p_to
       AND (p_subject IS NULL OR e.workspace_subject = p_subject)
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'day', to_char(d.kst_day, 'YYYY-MM-DD'),
           'signups', COALESCE(j.n, 0),
           'downloads', COALESCE(w.n, 0),
           'downloadUsers', COALESCE(w.users, 0)
         ) ORDER BY d.kst_day), '[]'::jsonb)
    INTO v_days
    FROM kst_days d
    LEFT JOIN joins j ON j.kst_day = d.kst_day
    LEFT JOIN downloads w ON w.kst_day = d.kst_day;

  SELECT jsonb_build_object(
    'signups', (SELECT count(*) FROM public.profiles p
                 WHERE p.created_at >= p_from AND p.created_at < p_to AND p.is_admin IS NOT TRUE),
    'downloads', (SELECT count(*) FROM public.market_download_events e
                   WHERE e.created_at >= p_from AND e.created_at < p_to AND (p_subject IS NULL OR e.workspace_subject = p_subject)),
    'downloadUsers', (SELECT count(DISTINCT e.user_id) FROM public.market_download_events e
                       WHERE e.created_at >= p_from AND e.created_at < p_to AND (p_subject IS NULL OR e.workspace_subject = p_subject)))
    INTO v_totals;

  RETURN jsonb_build_object('days', v_days, 'totals', v_totals);
END;
$fn_report_activity_daily$;

-- 3. 상품 순위(4-3). 숨김·삭제 상품도 넣고 상태를 함께 돌려준다(화면이 배지를 붙임).
--    p_metric = 'orders'   : 기간 안 자료 구매(completed·refunded·revoked) 상품별 건수 → C(charged_credits 합) → 상품 id 순.
--    p_metric = 'downloads': 기간 안 다운로드 상품별 '다운로드한 회원 수'(홈 인기와 같은 셈) → 다운로드 수 → 상품 id 순.
--    고르지 않은 쪽의 칸은 0. p_limit 은 1~20.
CREATE FUNCTION public.report_market_item_ranking(p_from timestamptz, p_to timestamptz, p_subject text, p_metric text, p_limit integer)
 RETURNS TABLE(item_id uuid, title text, workspace_subject text, item_status text, is_active boolean, is_deleted boolean,
               order_count integer, charged_credits bigint, download_users integer, download_count integer)
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $fn_report_market_item_ranking$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to OR p_to - p_from > interval '367 days' THEN
    RAISE EXCEPTION 'DASHBOARD_PERIOD_INVALID';
  END IF;
  IF p_subject IS NOT NULL AND p_subject NOT IN ('korean', 'english') THEN
    RAISE EXCEPTION 'DASHBOARD_SUBJECT_INVALID';
  END IF;
  IF p_metric IS NULL OR p_metric NOT IN ('orders', 'downloads') THEN
    RAISE EXCEPTION 'DASHBOARD_METRIC_INVALID';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 20 THEN
    RAISE EXCEPTION 'DASHBOARD_LIMIT_INVALID';
  END IF;

  IF p_metric = 'orders' THEN
    RETURN QUERY
    SELECT i.id, i.title, i.workspace_subject, i.status, i.is_active, i.deleted_at IS NOT NULL,
           g.n, g.c, 0, 0
      FROM (SELECT o.item_id AS gid, count(*)::integer AS n, COALESCE(sum(o.charged_credits), 0)::bigint AS c
              FROM public.market_purchase_orders o
             WHERE o.status IN ('completed', 'refunded', 'revoked')
               AND o.created_at >= p_from AND o.created_at < p_to
               AND (p_subject IS NULL OR o.workspace_subject = p_subject)
             GROUP BY o.item_id) g
      JOIN public.market_items i ON i.id = g.gid
     ORDER BY g.n DESC, g.c DESC, i.id ASC
     LIMIT p_limit;
  ELSE
    RETURN QUERY
    SELECT i.id, i.title, i.workspace_subject, i.status, i.is_active, i.deleted_at IS NOT NULL,
           0, 0::bigint, g.users, g.n
      FROM (SELECT e.item_id AS gid, count(DISTINCT e.user_id)::integer AS users, count(*)::integer AS n
              FROM public.market_download_events e
             WHERE e.created_at >= p_from AND e.created_at < p_to
               AND (p_subject IS NULL OR e.workspace_subject = p_subject)
             GROUP BY e.item_id) g
      JOIN public.market_items i ON i.id = g.gid
     ORDER BY g.users DESC, g.n DESC, i.id ASC
     LIMIT p_limit;
  END IF;
END;
$fn_report_market_item_ranking$;

-- 4. 함수 권한: PUBLIC·anon·authenticated(와 기본 권한으로 받은 service_role)을 회수한 뒤 service_role 만 EXECUTE.
REVOKE ALL ON FUNCTION public.report_market_daily(timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.report_activity_daily(timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.report_market_item_ranking(timestamptz, timestamptz, text, text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_market_daily(timestamptz, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.report_activity_daily(timestamptz, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.report_market_item_ranking(timestamptz, timestamptz, text, text, integer) TO service_role;
-- [21번] 끝 ---------------------------------------------------------------------------------------------------------

-- 5. VERIFY --------------------------------------------------------------------------------------------------------
DO $verify_bundle21_dashboard$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.report_market_daily(timestamptz,timestamptz,text)', 'public.report_activity_daily(timestamptz,timestamptz,text)',
                              'public.report_market_item_ranking(timestamptz,timestamptz,text,text,integer)'] LOOP
    IF to_regprocedure(v_fn) IS NULL
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS NOT FALSE
       OR (SELECT p.provolatile FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) <> 's'
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND 'search_path=public, pg_temp' = ANY (p.proconfig))
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = to_regprocedure(v_fn) AND a.grantee = 0) THEN
      RAISE EXCEPTION 'VERIFY: % SECURITY INVOKER / STABLE / search_path / EXECUTE', v_fn;
    END IF;
    -- 회원 개인정보·돈 칸을 읽지 않는다
    IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) ~ '(email|phone|display_tag|payment_orders|refund_amount|expected_amount|withdrawn_member_records)' THEN
      RAISE EXCEPTION 'VERIFY: % reads a forbidden column or table', v_fn;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('report_market_daily', 'report_activity_daily', 'report_market_item_ranking')) <> 3 THEN
    RAISE EXCEPTION 'VERIFY: overloads';
  END IF;
  -- 반환 열 = 허용 목록(순서까지)
  IF (SELECT array_agg(n ORDER BY i)
        FROM pg_proc p, unnest(p.proargnames, p.proargmodes) WITH ORDINALITY AS a(n, m, i)
       WHERE p.oid = to_regprocedure('public.report_market_daily(timestamptz,timestamptz,text)') AND a.m = 't')
     IS DISTINCT FROM ARRAY['day', 'purchases', 'refunds']::text[] THEN
    RAISE EXCEPTION 'VERIFY: report_market_daily columns are not the allow-list';
  END IF;
  IF (SELECT array_agg(n ORDER BY i)
        FROM pg_proc p, unnest(p.proargnames, p.proargmodes) WITH ORDINALITY AS a(n, m, i)
       WHERE p.oid = to_regprocedure('public.report_market_item_ranking(timestamptz,timestamptz,text,text,integer)') AND a.m = 't')
     IS DISTINCT FROM ARRAY['item_id', 'title', 'workspace_subject', 'item_status', 'is_active', 'is_deleted',
                            'order_count', 'charged_credits', 'download_users', 'download_count']::text[] THEN
    RAISE EXCEPTION 'VERIFY: report_market_item_ranking columns are not the allow-list';
  END IF;
END;
$verify_bundle21_dashboard$;

NOTIFY pgrst, 'reload schema';
