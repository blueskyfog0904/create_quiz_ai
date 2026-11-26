-- 21번 묶음 리허설: A light — 21번 마이그레이션, 경우 D1~D7·C
-- 생성 파일(손으로 고치지 않는다): node supabase/scripts/bundle21_rehearsal/generate.mjs 가 원본에서 만든다.
-- 실행: supabase db query --remote --yes -o json --file supabase/scripts/bundle21_rehearsal/<이 파일> (COMMIT 없음, 마지막 SELECT 가 결과)
-- 언제: 지금(낮) 돌려도 됨: 함수 만들기·문구 행 INSERT·시험 계정 가짜 주문 INSERT 만(표 잠금 없음). 이력 표는 쓰지 않는다.
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

SELECT pg_temp.ctx_set('src_migration', $rh_src_migration$-- 출시 전 작업 순서표 21번 묶음: 관리자 대시보드(계획 docs/plan-bundle21-dashboard.md 3판, 5절).
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
$rh_src_migration$);
SELECT pg_temp.ctx_set('src_down', $rh_src_down$-- 21번 묶음 되돌리기(supabase/migrations/20261223100000_bundle21_dashboard_reports.sql 의 down). 계획 docs/plan-bundle21-dashboard.md 5·11절.
-- 21번 대시보드 코드를 먼저 되돌려 배포한 뒤에만 실행한다(새 코드는 함수가 없으면 해당 카드가 '확인 불가'가 된다).
-- 하는 것: 보고 함수 3개 지우기. 23번 함수(report_charge_daily 등)는 남긴다.
-- 하지 않는 것: 문구 설정 행(admin_dashboard_content)은 데이터 스크립트가 넣으므로 여기서 지우지 않는다.
-- 이 파일은 이력 행을 지우지 않는다. 다시 적용하려면 같은 거래에서 schema_migrations 의 '20261223100000' 행을 지운 뒤 마이그레이션과 이력 INSERT 를 넣는다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $precheck_bundle21_dashboard_down$
BEGIN
  IF to_regprocedure('public.report_market_daily(timestamptz,timestamptz,text)') IS NULL
     OR to_regprocedure('public.report_activity_daily(timestamptz,timestamptz,text)') IS NULL
     OR to_regprocedure('public.report_market_item_ranking(timestamptz,timestamptz,text,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'DOWN PRECHECK: bundle 21 report functions missing (not the bundle 21 state)';
  END IF;
END;
$precheck_bundle21_dashboard_down$;

-- [21번] 시작: 되돌림 ----------------------------------------------------------------------------------------------
DROP FUNCTION public.report_market_daily(timestamptz, timestamptz, text);
DROP FUNCTION public.report_activity_daily(timestamptz, timestamptz, text);
DROP FUNCTION public.report_market_item_ranking(timestamptz, timestamptz, text, text, integer);
-- [21번] 끝: 되돌림 ------------------------------------------------------------------------------------------------

DO $verify_bundle21_dashboard_down$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('report_market_daily', 'report_activity_daily', 'report_market_item_ranking')) THEN
    RAISE EXCEPTION 'DOWN VERIFY: bundle 21 leftovers';
  END IF;
END;
$verify_bundle21_dashboard_down$;

NOTIFY pgrst, 'reload schema';
$rh_src_down$);
SELECT pg_temp.ctx_set('src_content', $rh_src_content$INSERT INTO public.system_settings (key, value, description)
VALUES ('admin_dashboard_content', $json_bundle21_content$
{
  "revision": 1,
  "helpCharge": "실결제 충전의 결제 금액에서 같은 기간 환불 금액을 뺀 값입니다(부가세 포함). 결제는 승인 시각, 환불은 결제사 취소 시각(없으면 처리 시각) 기준이며 매출·정산 CSV 요약과 같은 정의입니다. 충전에는 과목이 없어 과목 선택과 무관합니다.",
  "helpMarket": "자료 구매 주문 기준입니다. 구매 시각 기준 사용 크레딧(뒤에 환불된 것 포함)에서 같은 기간에 승인된 자료 환불 크레딧을 뺀 값입니다. 매출·정산 CSV 의 '자료 구매 사용'은 크레딧 원장 기준이라 이 숫자와 다를 수 있습니다.",
  "helpSignups": "기간 안에 가입한 회원 수입니다(관리자 제외, 나중에 탈퇴한 회원도 가입 시점에는 셉니다). 회원에는 과목이 없어 과목 선택과 무관합니다.",
  "helpDownloads": "구매한 파일을 내려받은 횟수입니다. 샘플 내려받기는 기록되지 않아 들어가지 않습니다.",
  "emptyChargeChart": "이 기간 충전 결제 없음",
  "emptyMarketChart": "이 기간 판매 없음",
  "emptySignupsChart": "이 기간 가입 없음",
  "emptyDownloadsChart": "이 기간 다운로드 없음",
  "emptyDonut": "데이터 없음",
  "emptyOrdersRanking": "판매된 상품 없음",
  "emptyDownloadsRanking": "다운로드된 상품 없음",
  "publishedCount": "공개 상품 {count}개"
}
$json_bundle21_content$::jsonb, '21번: 관리자 대시보드 정의 말풍선·빈 상태 문구(SQL 로 고침, 회원도 읽을 수 있는 행 — 내부 정보 금지)')
ON CONFLICT (key) DO NOTHING;

DO $verify_bundle21_dashboard_content$
DECLARE
  v_value jsonb;
  v_key text;
BEGIN
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'admin_dashboard_content';
  IF v_value IS NULL OR jsonb_typeof(v_value -> 'revision') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'VERIFY: admin_dashboard_content shape';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['helpCharge', 'helpMarket', 'helpSignups', 'helpDownloads', 'emptyChargeChart', 'emptyMarketChart',
                               'emptySignupsChart', 'emptyDownloadsChart', 'emptyDonut', 'emptyOrdersRanking', 'emptyDownloadsRanking',
                               'publishedCount'] LOOP
    IF jsonb_typeof(v_value -> v_key) IS DISTINCT FROM 'string' OR btrim(v_value ->> v_key) = '' OR char_length(v_value ->> v_key) > 300
       OR (v_value ->> v_key) ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'VERIFY: admin_dashboard_content.%', v_key;
    END IF;
  END LOOP;
END;
$verify_bundle21_dashboard_content$;$rh_src_content$);
SELECT pg_temp.ctx_set('src_23_light', $rh_src_23_light$-- 출시 전 작업 순서표 23번 묶음: 매출·정산 CSV(계획 docs/plan-bundle23-sales-csv.md 4판, 4절).
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
$rh_src_23_light$);

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

-- ===== 21번 마이그레이션(원본 그대로 — 기존 표 DDL 없음) =====
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

DO $rh_d1$
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

    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'D1', 'down');
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('report_market_daily', 'report_activity_daily', 'report_market_item_ranking')), 'D1', '남는 함수 0');
    v_log := v_log || pg_temp.ensure(to_regprocedure('public.report_charge_daily(timestamptz,timestamptz)') IS NOT NULL, 'D1', '23번 함수는 남음');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK', 'D1', '없을 때 down 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'D1', '다시 적용(VERIFY 통과)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'ERR PRECHECK: bundle 21 report functions already exist', 'D1', '두 번 적용 멈춤');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'D1', m FROM unnest(v_log) m;
END
$rh_d1$;

DO $rh_d2$
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

    -- 주문 표 SELECT(Q6)
    v_n := (SELECT count(*) FROM public.market_purchase_orders o WHERE o.status IN ('completed', 'refunded', 'revoked')
             AND o.created_at >= pg_temp.kst('2026-11-01') AND o.created_at < pg_temp.kst('2026-12-01'));
    v_m := (SELECT COALESCE(sum(o.charged_credits), 0) FROM public.market_purchase_orders o WHERE o.status IN ('completed', 'refunded', 'revoked')
             AND o.created_at >= pg_temp.kst('2026-11-01') AND o.created_at < pg_temp.kst('2026-12-01'));
    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), NULL, 'n'), v_n, 'D2', '구매 건수 = 주문 표 SELECT');
    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), NULL, 'c'), v_m, 'D2', '구매 C = 주문 표 SELECT');
    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), NULL, 'n'), 16, 'D2', '예시 구매 건수');
    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), NULL, 'c'), 43000, 'D2', '예시 구매 C');
    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), NULL, 'n', 'subproduct'), 15, 'D2', '예시 개별 구매 건수');
    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), NULL, 'c', 'subproduct'), 38500, 'D2', '예시 개별 구매 C');
    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), NULL, 'n', 'bundle'), 1, 'D2', '예시 전체 구매 건수');
    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), NULL, 'c', 'bundle'), 4500, 'D2', '예시 전체 구매 C');
    -- 자료 환불(승인, 처리 시각)
    v_n := (SELECT count(*) FROM public.market_refund_requests r WHERE r.status = 'approved'
             AND r.processed_at >= pg_temp.kst('2026-11-01') AND r.processed_at < pg_temp.kst('2026-12-01'));
    v_m := (SELECT COALESCE(sum(r.approved_refund_credits), 0) FROM public.market_refund_requests r WHERE r.status = 'approved'
             AND r.processed_at >= pg_temp.kst('2026-11-01') AND r.processed_at < pg_temp.kst('2026-12-01'));
    v_log := v_log || pg_temp.eq(pg_temp.refund_sum(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), NULL, 'n'), v_n, 'D2', '자료 환불 건수 = SELECT');
    v_log := v_log || pg_temp.eq(pg_temp.refund_sum(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), NULL, 'c'), v_m, 'D2', '자료 환불 C = SELECT');
    v_log := v_log || pg_temp.eq(pg_temp.refund_sum(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), NULL, 'n'), 2, 'D2', '예시 자료 환불 건수');
    v_log := v_log || pg_temp.eq(pg_temp.refund_sum(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), NULL, 'c'), 5000, 'D2', '예시 자료 환불 C');
    -- 도넛 합(과목 × 구매 방식 C) = 카드 보조 줄의 구매 C, 카드 큰 값 = 구매 C − 환불 C
    v_log := v_log || pg_temp.eq((SELECT COALESCE(sum((k.value ->> 'c')::numeric), 0) FROM public.report_market_daily(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), NULL) d,
        jsonb_each(d.purchases) s, jsonb_each(s.value) k), 43000, 'D2', '도넛 합 = 구매 C');
    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), NULL, 'c') - pg_temp.refund_sum(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), NULL, 'c'), 38000, 'D2', '카드 큰 값(순 사용 C)');
    v_log := v_log || pg_temp.eq((SELECT count(*) FROM public.report_market_daily(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), NULL)), 30, 'D2', '11월 30행(날짜당 1행, 0 채움)');
    -- 충전: 요금제별 합 = 결제 금액(23번 report_charge_daily)
    v_j := public.report_charge_daily(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'));
    v_log := v_log || pg_temp.eq((SELECT COALESCE(sum((p ->> 'amount')::numeric), 0) FROM jsonb_array_elements(v_j -> 'days') d, jsonb_array_elements(d -> 'byPlan') p),
      (SELECT COALESCE(sum((d ->> 'paymentAmount')::numeric), 0) FROM jsonb_array_elements(v_j -> 'days') d), 'D2', '요금제별 합 = 결제 금액');
    v_log := v_log || pg_temp.eq((SELECT COALESCE(sum((d ->> 'paymentAmount')::numeric), 0) FROM jsonb_array_elements(v_j -> 'days') d), 60600, 'D2', '예시 결제 금액');
    -- 가입·다운로드 = 같은 시각 SELECT
    v_k := public.report_activity_daily(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), NULL);
    v_log := v_log || pg_temp.eq((v_k -> 'totals' ->> 'signups')::numeric, (SELECT count(*) FROM public.profiles p WHERE p.is_admin IS NOT TRUE
        AND p.created_at >= pg_temp.kst('2026-11-01') AND p.created_at < pg_temp.kst('2026-12-01')), 'D2', '가입 = SELECT');
    v_log := v_log || pg_temp.eq((SELECT sum((d ->> 'signups')::numeric) FROM jsonb_array_elements(v_k -> 'days') d), (v_k -> 'totals' ->> 'signups')::numeric, 'D2', '날짜별 가입 합 = 합계');
    v_log := v_log || pg_temp.eq((v_k -> 'totals' ->> 'downloads')::numeric, (SELECT count(*) FROM public.market_download_events e
        WHERE e.created_at >= pg_temp.kst('2026-11-01') AND e.created_at < pg_temp.kst('2026-12-01')), 'D2', '다운로드 = SELECT');
    v_log := v_log || pg_temp.eq((v_k -> 'totals' ->> 'downloadUsers')::numeric, (SELECT count(DISTINCT e.user_id) FROM public.market_download_events e
        WHERE e.created_at >= pg_temp.kst('2026-11-01') AND e.created_at < pg_temp.kst('2026-12-01')), 'D2', '다운로드한 회원 = SELECT(기간 안 서로 다른 회원)');
    v_log := v_log || pg_temp.eq(jsonb_array_length(v_k -> 'days'), 30, 'D2', '활동 11월 30일 0 채움');
    INSERT INTO _rh_log (test, msg, payload) VALUES ('D2', '11월 활동(참고)', v_k -> 'totals');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'D2', m FROM unnest(v_log) m;
END
$rh_d2$;

DO $rh_d3$
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
      'D3', '비교 기간 끝(지금 − 7일) 앞 1분만 들어감');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'D3', m FROM unnest(v_log) m;
END
$rh_d3$;

DO $rh_d4$
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

    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), 'korean', 'n'), (SELECT count(*) FROM public.market_purchase_orders o
        WHERE o.status IN ('completed', 'refunded', 'revoked') AND o.workspace_subject = 'korean'
          AND o.created_at >= pg_temp.kst('2026-11-01') AND o.created_at < pg_temp.kst('2026-12-01')), 'D4', '국어 = SELECT');
    v_log := v_log || pg_temp.eq(pg_temp.buy_sum(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), 'english', 'n'), (SELECT count(*) FROM public.market_purchase_orders o
        WHERE o.status IN ('completed', 'refunded', 'revoked') AND o.workspace_subject = 'english'
          AND o.created_at >= pg_temp.kst('2026-11-01') AND o.created_at < pg_temp.kst('2026-12-01')), 'D4', '영어 = SELECT');
    v_log := v_log || pg_temp.ensure((SELECT bool_and(d.purchases ? 'english' AND NOT d.purchases ? 'korean' AND d.refunds ? 'english' AND NOT d.refunds ? 'korean')
        FROM public.report_market_daily(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), 'english') d), 'D4', '영어만 고르면 영어 키만');
    v_log := v_log || pg_temp.ensure((SELECT bool_and(d.purchases ? 'korean' AND d.purchases ? 'english' AND d.purchases -> 'korean' ? 'subproduct' AND d.purchases -> 'korean' ? 'bundle')
        FROM public.report_market_daily(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), NULL) d), 'D4', '전체면 두 과목·두 구매 방식 0 채움');
    v_log := v_log || pg_temp.eq(((public.report_activity_daily(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), 'english')) -> 'totals' ->> 'signups')::numeric,
      ((public.report_activity_daily(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), NULL)) -> 'totals' ->> 'signups')::numeric, 'D4', '가입 수는 과목과 무관');
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
      'ERR DASHBOARD_PERIOD_INVALID', 'D4', '거꾸로 된 기간 예외');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'D4', m FROM unnest(v_log) m;
END
$rh_d4$;

DO $rh_d5$
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

    SET LOCAL ROLE service_role;
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('SELECT * FROM public.report_market_daily(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''), NULL)'), 'OK', 'D5', 'service_role 자료 판매');
    v_log := v_log || pg_temp.expect(pg_temp.try_json('SELECT public.report_activity_daily(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''), NULL)'), 'OK', 'D5', 'service_role 활동');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('SELECT * FROM public.report_market_item_ranking(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''), NULL, ''orders'', 5)'), 'OK', 'D5', 'service_role 순위');
    RESET ROLE;
    SET LOCAL ROLE authenticated;
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('SELECT * FROM public.report_market_daily(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''), NULL)'), 'ERR permission denied', 'D5', 'authenticated 자료 판매 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json('SELECT public.report_activity_daily(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''), NULL)'), 'ERR permission denied', 'D5', 'authenticated 활동 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('SELECT * FROM public.report_market_item_ranking(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''), NULL, ''orders'', 5)'), 'ERR permission denied', 'D5', 'authenticated 순위 거절');
    RESET ROLE;
    SET LOCAL ROLE anon;
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('SELECT * FROM public.report_market_daily(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''), NULL)'), 'ERR permission denied', 'D5', 'anon 자료 판매 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json('SELECT public.report_activity_daily(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''), NULL)'), 'ERR permission denied', 'D5', 'anon 활동 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('SELECT * FROM public.report_market_item_ranking(pg_temp.kst(''2026-11-01''), pg_temp.kst(''2026-12-01''), NULL, ''orders'', 5)'), 'ERR permission denied', 'D5', 'anon 순위 거절');
    RESET ROLE;
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'D5', m FROM unnest(v_log) m;
END
$rh_d5$;

DO $rh_d6$
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

    v_log := v_log || pg_temp.eq((SELECT count(*) FROM public.report_market_item_ranking(pg_temp.kst('2025-06-01'), pg_temp.kst('2025-07-01'), NULL, 'orders', 20)), 0, 'D6', '2025-06 실데이터 0건(가짜만 셈)');
    -- X·Y 는 1건 1,000 C 로 같고, Z 는 1건 2,000 C, Y 는 하나 더(2건) → Y, Z, X 순(X < ... 는 id 순)
    PERFORM pg_temp.fake_order(v_u, v_x, 'korean', 1000, '2025-06-10 10:00:00+09');
    PERFORM pg_temp.fake_order(v_u, v_z, 'korean', 2000, '2025-06-10 11:00:00+09');
    PERFORM pg_temp.fake_order(v_u, v_y, 'korean', 500, '2025-06-11 10:00:00+09');
    PERFORM pg_temp.fake_order(v_u, v_y, 'korean', 500, '2025-06-12 10:00:00+09', 'bundle');
    v_ids := (SELECT array_agg(r.item_id ORDER BY ord) FROM public.report_market_item_ranking(pg_temp.kst('2025-06-01'), pg_temp.kst('2025-07-01'), NULL, 'orders', 5) WITH ORDINALITY AS r(item_id, title, workspace_subject, item_status, is_active, is_deleted, order_count, charged_credits, download_users, download_count, ord));
    v_log := v_log || pg_temp.ensure(v_ids = ARRAY[v_y, v_z, v_x], 'D6', '건수 → C 순(Y 2건, Z 1건 2,000 C, X 1건 1,000 C)');
    PERFORM pg_temp.fake_order(v_u, v_z, 'korean', 1000, '2025-06-13 10:00:00+09');
    PERFORM pg_temp.fake_order(v_u, v_x, 'korean', 1000, '2025-06-13 11:00:00+09');
    -- 이제 Y·Z·X 모두 2건. C: Z 3,000 > X 2,000 = ... Y 1,000 → Z, X, Y
    v_ids := (SELECT array_agg(r.item_id ORDER BY ord) FROM public.report_market_item_ranking(pg_temp.kst('2025-06-01'), pg_temp.kst('2025-07-01'), NULL, 'orders', 5) WITH ORDINALITY AS r(item_id, title, workspace_subject, item_status, is_active, is_deleted, order_count, charged_credits, download_users, download_count, ord));
    v_log := v_log || pg_temp.ensure(v_ids = ARRAY[v_z, v_x, v_y], 'D6', '같은 건수면 C 순');
    PERFORM pg_temp.fake_order(v_u, v_y, 'korean', 1000, '2025-06-14 10:00:00+09');
    PERFORM pg_temp.fake_order(v_u, v_x, 'korean', 1000, '2025-06-14 11:00:00+09');
    PERFORM pg_temp.fake_order(v_u, v_z, 'korean', 1000, '2025-06-14 12:00:00+09');
    PERFORM pg_temp.fake_order(v_u, v_y, 'korean', 1000, '2025-06-15 10:00:00+09');
    -- X 3건 3,000 C, Y 4건 3,000 C, Z 3건 4,000 C → Y, Z, X. 같은 건수·같은 C 는 상품 id 순(아래)
    v_ids := (SELECT array_agg(r.item_id ORDER BY ord) FROM public.report_market_item_ranking(pg_temp.kst('2025-06-01'), pg_temp.kst('2025-07-01'), NULL, 'orders', 5) WITH ORDINALITY AS r(item_id, title, workspace_subject, item_status, is_active, is_deleted, order_count, charged_credits, download_users, download_count, ord));
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
    v_ids := (SELECT array_agg(r.item_id ORDER BY ord) FROM public.report_market_item_ranking(pg_temp.kst('2026-11-01'), pg_temp.kst('2026-12-01'), NULL, 'downloads', 20)
              WITH ORDINALITY AS r(item_id, title, workspace_subject, item_status, is_active, is_deleted, order_count, charged_credits, download_users, download_count, ord));
    v_log := v_log || pg_temp.ensure(v_ids IS NOT DISTINCT FROM (SELECT array_agg(g.item_id ORDER BY g.users DESC, g.n DESC, g.item_id) FROM (
        SELECT e.item_id, count(DISTINCT e.user_id) AS users, count(*) AS n FROM public.market_download_events e
         WHERE e.created_at >= pg_temp.kst('2026-11-01') AND e.created_at < pg_temp.kst('2026-12-01') GROUP BY e.item_id ORDER BY 2 DESC, 3 DESC, 1 LIMIT 20) g),
      'D6', '다운로드 순위 = 회원 수 → 다운로드 수 → 상품 id SELECT');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'D6', m FROM unnest(v_log) m;
END
$rh_d6$;

DO $rh_d7$
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

    v_t := clock_timestamp();
    v_n := (SELECT count(*) FROM public.report_market_daily(pg_temp.kst('2025-11-28'), pg_temp.kst('2025-11-28') + interval '366 days', NULL));
    v_ms := round(extract(epoch FROM clock_timestamp() - v_t) * 1000);
    v_log := v_log || pg_temp.eq(v_n, 366, 'D7', '366일 = 366행(날짜당 1행)');
    v_log := v_log || pg_temp.ensure(v_n <= 367, 'D7', '행 수 ≤ 367(PostgREST 1,000행 상한 아래)');
    v_log := v_log || pg_temp.ensure(v_ms < 10000, 'D7', '366일 자료 판매 ' || v_ms || 'ms(10초 미만)');
    v_t := clock_timestamp();
    PERFORM public.report_activity_daily(pg_temp.kst('2025-11-28'), pg_temp.kst('2025-11-28') + interval '366 days', NULL);
    v_log := v_log || pg_temp.ensure(true, 'D7', '366일 활동 ' || round(extract(epoch FROM clock_timestamp() - v_t) * 1000) || 'ms');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'D7', m FROM unnest(v_log) m;
END
$rh_d7$;

DO $rh_c$
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

    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_content')), 'OK', 'C', '문구 스크립트 본문(INSERT … ON CONFLICT DO NOTHING + VERIFY)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_content')), 'OK', 'C', '두 번 돌려도 그대로');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'C', m FROM unnest(v_log) m;
END
$rh_c$;

DO $rh_leftover$
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

    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.market_purchase_orders WHERE idempotency_key LIKE 'rh21-%') = 0, 'Z', '경우 밖에 남은 가짜 주문 0(ROLLBACK 전)');
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
