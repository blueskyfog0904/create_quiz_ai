-- 13번 묶음 리허설: A light — M0(원본)·M1 사본(칸 추가·FK·slug 트리거 뺌), 경우 A·E·T·C(이력 가드·가림 함수·탈퇴 열람)
-- 생성 파일(손으로 고치지 않는다): node supabase/scripts/bundle13_rehearsal/generate.mjs 가 원본에서 만든다.
-- 실행: supabase db query --remote --yes -o json --file supabase/scripts/bundle13_rehearsal/<이 파일> (COMMIT 없음, 마지막 SELECT 가 결과)
-- 언제: 지금 돌려도 됨(새 표·함수 생성, 시험 계정 행의 행 잠금뿐 — 기존 표의 LOCK/ALTER TABLE·TRIGGER·POLICY·FK 없음). 저장 함수·잠금·M3·되돌리기는 새벽의 b_full 이 본다.
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
-- 동적 SQL 을 실행하고 'OK' 또는 'ERR 메시지 [SQLSTATE]'(앞 300자)를 돌려준다. 실패하면 그 문장의 변경은 되돌려진다.
CREATE FUNCTION pg_temp.try_sql(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR ' || left(SQLERRM, 300) || ' [' || SQLSTATE || ']';
END $f$;
-- 결과(jsonb)를 돌려주는 함수 호출: 'OK {json}' 또는 'ERR 메시지'
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
  RETURN p_msg || ' → ' || left(p_actual, 120);
END $f$;
CREATE FUNCTION pg_temp.ensure(p_cond boolean, p_test text, p_msg text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_cond IS NOT TRUE THEN
    PERFORM pg_temp.fail(p_test, p_msg);
  END IF;
  RETURN p_msg;
END $f$;
CREATE FUNCTION pg_temp.subst_once(p_src text, p_from text, p_to text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_from = '' OR (length(p_src) - length(replace(p_src, p_from, ''))) / length(p_from) <> 1 THEN
    RAISE EXCEPTION 'RH FAIL copy line not found exactly once: %', left(p_from, 200);
  END IF;
  RETURN replace(p_src, p_from, p_to);
END $f$;
CREATE FUNCTION pg_temp.md5_def(p_sig text) RETURNS text LANGUAGE sql AS $f$
  SELECT CASE WHEN to_regprocedure(p_sig) IS NULL THEN 'missing' ELSE md5(pg_get_functiondef(to_regprocedure(p_sig))) END
$f$;
CREATE FUNCTION pg_temp.md5_src(p_sig text) RETURNS text LANGUAGE sql AS $f$
  SELECT CASE WHEN to_regprocedure(p_sig) IS NULL THEN 'missing' ELSE (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure(p_sig)) END
$f$;
CREATE FUNCTION pg_temp.grants(p_owner uuid, p_staff uuid, p_keys text[]) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.replace_admin_permission_grants(%L, %L, %L::jsonb)', p_owner, p_staff,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('permission', k)), '[]'::jsonb) FROM unnest(p_keys) k)))
$f$;
-- 이 거래에서 남긴 작업 기록(created_at 기본값 now() = 거래 시작 시각, 앞 경우들은 되돌려져 없다)
CREATE FUNCTION pg_temp.audit_count(p_action text, p_target text DEFAULT NULL) RETURNS integer LANGUAGE sql AS $f$
  SELECT count(*)::integer FROM public.admin_audit_log
   WHERE action = p_action AND created_at >= now() AND (p_target IS NULL OR target_id = p_target)
$f$;
-- 그 종류의 기록이 모두: reason NULL, details 키가 정한 목록과 같음, request 가 객체, 넘긴 자유 글이 들어 있지 않음
CREATE FUNCTION pg_temp.audit_ok(p_action text, p_keys text[], p_forbidden text[]) RETURNS boolean LANGUAGE sql AS $f$
  SELECT count(*) > 0 AND bool_and(a.reason IS NULL
     AND ARRAY(SELECT k FROM jsonb_object_keys(a.details) k ORDER BY k COLLATE "C") = p_keys
     AND jsonb_typeof(a.details -> 'request') = 'object'
     AND NOT EXISTS (SELECT 1 FROM unnest(p_forbidden) f WHERE strpos(a.details::text, f) > 0))
    FROM public.admin_audit_log a WHERE a.action = p_action AND a.created_at >= now()
$f$;
CREATE FUNCTION pg_temp.sha(p_text text) RETURNS text LANGUAGE sql AS $f$
  SELECT encode(sha256(convert_to(COALESCE(p_text, ''), 'UTF8')), 'hex')
$f$;
-- 답변 저장(결과 'OK {json}' 또는 'ERR …'). p_seen = 화면이 본 지금 답변(없으면 NULL)
CREATE FUNCTION pg_temp.save(p_actor uuid, p_ticket uuid, p_response text, p_seen text, p_reason text DEFAULT NULL, p_key text DEFAULT NULL,
  p_status text DEFAULT NULL) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.save_support_ticket_answer(%L, %L, %L, %L, %L, %L, %L, %L::jsonb)', p_actor, p_ticket, p_response,
    p_status, pg_temp.sha(p_seen), p_reason, coalesce(p_key, 'rh13-' || gen_random_uuid()), '{"ip": "203.0.113.13", "user_agent": "rh13"}'))
$f$;
-- 시험 문의(postgres 로 바로 넣음 — 회원 RPC 는 auth.uid() 를 쓴다). 카테고리는 slug 로.
CREATE FUNCTION pg_temp.new_ticket(p_user uuid, p_slug text, p_subject text DEFAULT '시험 문의', p_message text DEFAULT '시험 내용')
  RETURNS uuid LANGUAGE sql AS $f$
  INSERT INTO public.support_tickets (user_id, subject, message, status, category_id)
  VALUES (p_user, p_subject, p_message, 'pending', (SELECT c.id FROM public.support_ticket_categories c WHERE c.slug = p_slug))
  RETURNING id
$f$;
CREATE FUNCTION pg_temp.access(p_actor uuid, p_screen text, p_ids uuid[], p_fields text[], p_reason text DEFAULT NULL) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_sql(format('SELECT public.record_admin_member_access(%L, %L, %L::uuid[], %L::text[], %L::jsonb, %L, %L::jsonb)',
    p_actor, p_screen, p_ids, p_fields, '{"ticketId": "rh13"}', p_reason, '{"ip": "203.0.113.13", "user_agent": "rh13"}'))
$f$;
-- 화면 세션처럼(역할 + JWT claims) 한 값을 읽는다: 'OK 값' 또는 'ERR … [SQLSTATE]'. 끝나면 역할·claims 를 되돌린다.
CREATE FUNCTION pg_temp.as_session(p_sub uuid, p_role text, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v text;
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN p_sub IS NULL THEN '' ELSE jsonb_build_object('sub', p_sub, 'role', p_role)::text END, true);
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql INTO v;
    RESET ROLE;
    v := 'OK ' || coalesce(v, 'null');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v := 'ERR ' || left(SQLERRM, 300) || ' [' || SQLSTATE || ']';
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v;
END $f$;

-- 원본 사본(생성기가 원본 파일에서 꺼낸 글 그대로, 바꾼 곳은 생성기가 정함)
SELECT pg_temp.ctx_set('src_m0', $rh_src_m0$-- 출시 전 작업 순서표 13번 묶음 M0: 관리자 회원 연락처 열람 기록(계획 docs/plan-bundle13-cs-tools.md 3판, 4-1·8절).
-- 만드는 것:
--   1. 표 admin_member_access_log(추가 전용): 누가·언제·어느 회원(uuid 만, FK 없음 — 회원을 완전 삭제해도 기록이 남음)·어느 화면·무슨 항목·
--      화면 정보(context, 검색어 원문은 넣지 않음)·사유·IP·기기. RLS 켬·정책 0, anon·authenticated 권한 없음, service_role 은 SELECT 만.
--   2. 가드 트리거: UPDATE·DELETE·TRUNCATE 를 거부한다(service_role 도). DB 소유자(postgres) 권한으로는 바꿀 수 있다(8-4 한계).
--   3. 기록 함수 record_admin_member_access(service_role 만): 행위자가 관리자인지 profiles 에서 보고, 개수·글자 수를 검사하고,
--      시각과 actor_role 을 함수가 정한다.
-- 01-11 시행 처리방침(10번 스크립트 apply)이 이 표·함수가 있는지 본다 — 2027-01-10 까지 운영에 있어야 한다(15절).
-- 잠금: 새 표만 만든다(기존 표 잠금 없음). profiles 는 함수 안에서 읽기만 한다.
-- 되돌리기 파일이 없다(법정 보관 기록, 4-1). M1·M2·M3 를 되돌리고 다시 적용해도 이 표에 걸리지 않는다(리허설 경우 F).
--   적용 직후 행이 0건일 때만(그 밖에는 쓰지 않는다) 아래를 한 거래에서 손으로 돌린다:
--     -- SELECT count(*) FROM public.admin_member_access_log;  -- 0 이어야 한다
--     -- DROP FUNCTION public.record_admin_member_access(uuid, text, uuid[], text[], jsonb, text, jsonb);
--     -- DROP TABLE public.admin_member_access_log;
--     -- DROP FUNCTION public.guard_admin_member_access_log_mutation();
-- 버전: 20261217100000~130000 은 운영 마지막 적용 11번(20261216100000)·12번(20261214100000) 뒤다(적용 순서 = 파일 시각 순서). 적용 직전에 schema_migrations 최신 버전을 다시 보고 그보다 뒤가 아니면 같은 순서로 다시 정한다. 파일 단위로 적용하고 이력은 같은 거래의 schema_migrations INSERT 로 넣는다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 0. 사전 점검 -----------------------------------------------------------------------------------------------------
DO $precheck_bundle13_access_log$
BEGIN
  IF to_regclass('public.admin_member_access_log') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECHECK: admin_member_access_log already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('record_admin_member_access', 'guard_admin_member_access_log_mutation')) THEN
    RAISE EXCEPTION 'PRECHECK: bundle 13 access log functions already exist';
  END IF;
  -- 12번이 먼저 적용돼 있어야 한다(16절 순서)
  IF to_regclass('public.member_suspensions') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK: bundle 12 (20261214100000) is not applied';
  END IF;
END;
$precheck_bundle13_access_log$;

-- [13번 M0] 시작 ------------------------------------------------------------------------------------------------
-- 1. 표(4-1) ----------------------------------------------------------------------------------------------------
CREATE TABLE public.admin_member_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid NOT NULL,
  actor_role text,
  screen text NOT NULL CHECK (char_length(screen) BETWEEN 1 AND 60),
  member_ids uuid[] NOT NULL CHECK (cardinality(member_ids) BETWEEN 1 AND 200 AND array_position(member_ids, NULL) IS NULL),
  fields text[] NOT NULL CHECK (cardinality(fields) BETWEEN 1 AND 10 AND array_position(fields, NULL) IS NULL),
  context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context) = 'object'),
  reason text CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 200),
  ip text CHECK (ip IS NULL OR char_length(ip) <= 100),
  user_agent text CHECK (user_agent IS NULL OR char_length(user_agent) <= 300)
);
CREATE INDEX admin_member_access_log_created ON public.admin_member_access_log (created_at DESC);
CREATE INDEX admin_member_access_log_actor_created ON public.admin_member_access_log (actor_id, created_at DESC);
CREATE INDEX admin_member_access_log_member_ids ON public.admin_member_access_log USING gin (member_ids);

COMMENT ON TABLE public.admin_member_access_log IS
  '13번: 관리자 회원 연락처 열람 기록(추가 전용, 보관 2년 — support_page_content.admin.accessLogRetentionYears). 쓰기는 record_admin_member_access 만.';

ALTER TABLE public.admin_member_access_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_member_access_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.admin_member_access_log TO service_role;

-- 2. 가드 트리거(추가 전용) --------------------------------------------------------------------------------------------
CREATE FUNCTION public.guard_admin_member_access_log_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_admin_member_access_log_mutation$
BEGIN
  RAISE EXCEPTION 'ADMIN_MEMBER_ACCESS_LOG_APPEND_ONLY';
END;
$fn_guard_admin_member_access_log_mutation$;

CREATE TRIGGER guard_admin_member_access_log_mutation
  BEFORE UPDATE OR DELETE ON public.admin_member_access_log
  FOR EACH ROW EXECUTE FUNCTION public.guard_admin_member_access_log_mutation();
CREATE TRIGGER guard_admin_member_access_log_truncate
  BEFORE TRUNCATE ON public.admin_member_access_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_admin_member_access_log_mutation();

-- 3. 기록 함수(8-1) -------------------------------------------------------------------------------------------------
--    화면 키·항목 이름은 코드 목록(src/lib/admin-member-access-log.ts)이고, 여기서는 형식만 본다(작업 기록 action 과 같은 방식).
--    p_request_meta 는 {ip, user_agent}(adminRequestMeta). 회원 수 1~200·중복 없음, 사유 200자, context 2000자.
CREATE FUNCTION public.record_admin_member_access(p_actor_id uuid, p_screen text, p_member_ids uuid[], p_fields text[],
  p_context jsonb DEFAULT '{}'::jsonb, p_reason text DEFAULT NULL, p_request_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_record_admin_member_access$
DECLARE
  v_role text;
  v_reason text := NULLIF(btrim(p_reason), '');
  v_id uuid;
BEGIN
  IF p_actor_id IS NULL OR p_screen IS NULL OR p_screen !~ '^[a-z][a-z0-9_.]{0,59}$'
     OR p_member_ids IS NULL OR cardinality(p_member_ids) NOT BETWEEN 1 AND 200 OR array_position(p_member_ids, NULL) IS NOT NULL
     OR cardinality(p_member_ids) <> (SELECT count(DISTINCT m) FROM unnest(p_member_ids) AS m)
     OR p_fields IS NULL OR cardinality(p_fields) NOT BETWEEN 1 AND 10
     OR EXISTS (SELECT 1 FROM unnest(p_fields) AS f WHERE f IS NULL OR f !~ '^[a-z][a-z0-9_]{0,39}$')
     OR (p_context IS NOT NULL AND (jsonb_typeof(p_context) <> 'object' OR length(p_context::text) > 2000))
     OR char_length(COALESCE(v_reason, '')) > 200
     OR (p_request_meta IS NOT NULL AND jsonb_typeof(p_request_meta) <> 'object') THEN
    RAISE EXCEPTION 'ADMIN_MEMBER_ACCESS_INPUT_INVALID';
  END IF;
  SELECT p.admin_role INTO v_role
    FROM public.profiles p
   WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.admin_role IN ('owner', 'staff');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_MEMBER_ACCESS_ACTOR_INVALID';
  END IF;
  INSERT INTO public.admin_member_access_log (created_at, actor_id, actor_role, screen, member_ids, fields, context, reason, ip, user_agent)
  VALUES (clock_timestamp(), p_actor_id, v_role, p_screen, p_member_ids, p_fields, COALESCE(p_context, '{}'::jsonb), v_reason,
          left(NULLIF(btrim(p_request_meta ->> 'ip'), ''), 100), left(NULLIF(p_request_meta ->> 'user_agent', ''), 300))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn_record_admin_member_access$;

REVOKE ALL ON FUNCTION public.record_admin_member_access(uuid, text, uuid[], text[], jsonb, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_admin_member_access(uuid, text, uuid[], text[], jsonb, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.guard_admin_member_access_log_mutation() FROM PUBLIC, anon, authenticated, service_role;
-- [13번 M0] 끝 ------------------------------------------------------------------------------------------------

-- 4. VERIFY --------------------------------------------------------------------------------------------------------
DO $verify_bundle13_access_log$
DECLARE
  v_rel constant text := 'public.admin_member_access_log';
  v_fn constant text := 'public.record_admin_member_access(uuid,text,uuid[],text[],jsonb,text,jsonb)';
BEGIN
  IF to_regclass(v_rel) IS NULL OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass(v_rel))
     OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = to_regclass(v_rel)) THEN
    RAISE EXCEPTION 'VERIFY: access log table / RLS / no policies';
  END IF;
  IF NOT has_table_privilege('service_role', v_rel, 'SELECT')
     OR has_table_privilege('service_role', v_rel, 'INSERT') OR has_table_privilege('service_role', v_rel, 'UPDATE')
     OR has_table_privilege('service_role', v_rel, 'DELETE') OR has_table_privilege('service_role', v_rel, 'TRUNCATE')
     OR has_table_privilege('anon', v_rel, 'SELECT') OR has_table_privilege('authenticated', v_rel, 'SELECT')
     OR has_table_privilege('anon', v_rel, 'INSERT') OR has_table_privilege('authenticated', v_rel, 'INSERT')
     OR has_table_privilege('authenticated', v_rel, 'UPDATE') OR has_table_privilege('authenticated', v_rel, 'DELETE') THEN
    RAISE EXCEPTION 'VERIFY: access log privileges';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = to_regclass(v_rel) AND NOT t.tgisinternal AND t.tgenabled = 'O'
       AND t.tgname IN ('guard_admin_member_access_log_mutation', 'guard_admin_member_access_log_truncate')) <> 2 THEN
    RAISE EXCEPTION 'VERIFY: access log guard triggers';
  END IF;
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'admin_member_access_log'
       AND indexname IN ('admin_member_access_log_created', 'admin_member_access_log_actor_created', 'admin_member_access_log_member_ids')) <> 3 THEN
    RAISE EXCEPTION 'VERIFY: access log indexes';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS NOT TRUE
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND 'search_path=public, pg_temp' = ANY (p.proconfig)) THEN
    RAISE EXCEPTION 'VERIFY: record_admin_member_access EXECUTE / SECURITY DEFINER';
  END IF;
  IF has_function_privilege('service_role', 'public.guard_admin_member_access_log_mutation()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.guard_admin_member_access_log_mutation()', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY: guard function must not be executable by API roles';
  END IF;
END;
$verify_bundle13_access_log$;

NOTIFY pgrst, 'reload schema';
$rh_src_m0$);
SELECT pg_temp.ctx_set('src_m1', $rh_src_m1$-- 출시 전 작업 순서표 13번 묶음 M1: CS 도구 추가분(계획 docs/plan-bundle13-cs-tools.md 3판, 4-2~4-4).
-- 만드는 것:
--   1. support_tickets.response_edited_at(기본값 없는 칸 — 짧은 ACCESS EXCLUSIVE).
--   2. 표 support_ticket_answer_revisions(답변 이력, 추가 전용): 그때 회원이 보던 글·보이기 시작한 시각·고친 사람·사유. RLS 켬·정책 0,
--      service_role 은 SELECT 만(쓰기는 save_support_ticket_answer 만). 가드: UPDATE·DELETE·TRUNCATE 거부 — 부모 문의 연쇄 삭제와
--      가림 함수(app.member_withdrawal_bypass = 그 회원 id)의 previous_response·reason·redaction_reviewed_at UPDATE 만 예외.
--   3. 표 support_reply_templates(답변 템플릿): RLS SELECT 정책 has_admin_permission('support.manage'), 쓰기 정책 없음(서버 키만).
--      비어 있을 때만 런북 12절 14개를 넣는다(10-2).
--   4. 설정 행 system_settings.support_page_content(회원 화면 문구 10-1·관리자 값, revision 1 — 있으면 그대로).
--   5. slug 지키기 트리거 guard_support_category_slug(문의가 있거나 탈퇴 가림 정책 slug 이면 slug 변경 거부).
--   6. 답변 저장 함수 save_support_ticket_answer(service_role 만, 4-3).
--   7. 10번 함수 재정의 4개(4-4): member_withdrawal_facts·redact_member_text·mark_member_text_reviewed·read_withdrawn_member_ticket.
--      운영 원문(pg_get_functiondef)에서 바뀐 곳만 '-- [13번]' 표시로 고쳤다. anonymize_member 는 고치지 않고 지문만 본다.
-- 작업 기록(admin_audit_log)에는 답변 글·수정 사유 원문을 넣지 않는다(가릴 수 없는 표) — 글자 수와 이력 id 만.
-- 함수 지문은 md5(pg_get_functiondef(oid))(2026-11-26 운영 읽기 전용 값, 1-3). 다르면 멈춘다.
-- 잠금: support_tickets 에 칸 추가(ACCESS EXCLUSIVE)·FK(SHARE ROW EXCLUSIVE), support_ticket_categories 에 FK·트리거(SHARE ROW EXCLUSIVE).
--   새벽 짧은 창에서 적용하고, 잡지 못하면(lock_timeout 3초) 전체가 취소된다.
-- 옛 코드와 함께 돌아간다(추가만 함 — 옛 답변 route 의 세션 UPDATE 도 M2 전까지 허용).
-- 되돌리기: supabase/rollback/20261217110000_bundle13_cs_tools_down.sql(M3·M2 를 먼저 되돌린 뒤).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 0. 사전 점검(4-2) -----------------------------------------------------------------------------------------------
DO $precheck_bundle13_cs_tools$
DECLARE
  -- 재정의할 4개(10번 원문)와 그대로여야 하는 anonymize_member
  v_same text[][] := ARRAY[
    ARRAY['public.member_withdrawal_facts(uuid,boolean)', 'a7674770964dac2fe5c9179b8403c3b4'],
    ARRAY['public.redact_member_text(uuid,text,uuid,text,text,text)', '90778a74269a727608f028b21b43b8f6'],
    ARRAY['public.mark_member_text_reviewed(uuid,text,uuid)', 'b626dc43a8bb8402575f99a58bb5969b'],
    ARRAY['public.read_withdrawn_member_ticket(uuid,uuid,text,jsonb)', 'cce39fd0ab514d2c9cdd9e42d225688e'],
    ARRAY['public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)', '1346d870d3623abae580a011b0484339'],
    ARRAY['public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)', 'a42b474d9d95753ffba5041acb0c1c77'],
    ARRAY['public.guard_withdrawn_member_write()', '764d47be26a0254ba61c71bbd005ee9b']
  ];
  i integer;
BEGIN
  FOR i IN 1 .. array_length(v_same, 1) LOOP
    IF to_regprocedure(v_same[i][1]) IS NULL OR md5(pg_get_functiondef(to_regprocedure(v_same[i][1]))) <> v_same[i][2] THEN
      RAISE EXCEPTION 'PRECHECK: % changed (%)', v_same[i][1],
        CASE WHEN to_regprocedure(v_same[i][1]) IS NULL THEN 'missing' ELSE md5(pg_get_functiondef(to_regprocedure(v_same[i][1]))) END;
    END IF;
  END LOOP;
  IF to_regclass('public.support_ticket_answer_revisions') IS NOT NULL OR to_regclass('public.support_reply_templates') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECHECK: bundle 13 tables already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('save_support_ticket_answer', 'guard_support_ticket_answer_revisions_mutation', 'guard_support_category_slug')) THEN
    RAISE EXCEPTION 'PRECHECK: bundle 13 functions already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'support_tickets' AND column_name = 'response_edited_at') THEN
    RAISE EXCEPTION 'PRECHECK: support_tickets.response_edited_at already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'support_page_content') THEN
    RAISE EXCEPTION 'PRECHECK: support_page_content row already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.support_ticket_categories'::regclass AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'PRECHECK: support_ticket_categories triggers changed';
  END IF;
  IF to_regclass('public.admin_member_access_log') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK: M0 (20261217100000) is not applied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'member_withdrawal_policy') THEN
    RAISE EXCEPTION 'PRECHECK: member_withdrawal_policy missing';
  END IF;
END;
$precheck_bundle13_cs_tools$;

-- [13번 M1] 시작 ------------------------------------------------------------------------------------------------
-- 1. 답변 수정 시각 칸(4-2 의 1) --------------------------------------------------------------------------------------

-- 2. 답변 이력(4-2 의 2) -------------------------------------------------------------------------------------------
--    edited_by 는 FK 없는 uuid(관리자 계정을 지워도 이력이 남음).
CREATE TABLE public.support_ticket_answer_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL,
  previous_response text NOT NULL,
  previous_shown_at timestamptz NOT NULL,
  edited_by uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  redaction_reviewed_at timestamptz
);
CREATE INDEX support_ticket_answer_revisions_ticket ON public.support_ticket_answer_revisions (ticket_id, created_at);

COMMENT ON TABLE public.support_ticket_answer_revisions IS
  '13번: 문의 답변 수정 이력(그때 회원이 보던 글). 쓰기는 save_support_ticket_answer 만, 탈퇴 가림 대상(support_ticket_answer_revision).';

ALTER TABLE public.support_ticket_answer_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.support_ticket_answer_revisions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.support_ticket_answer_revisions TO service_role;

--    DELETE: 부모 문의가 이미 없으면(연쇄 삭제) 통과. UPDATE: 가림 함수 거래(bypass = 부모 문의의 회원)에서 가릴 칸만.
CREATE FUNCTION public.guard_support_ticket_answer_revisions_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_support_ticket_answer_revisions_mutation$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = OLD.ticket_id) THEN
      RAISE EXCEPTION 'SUPPORT_ANSWER_REVISIONS_APPEND_ONLY';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
     AND COALESCE(current_setting('app.member_withdrawal_bypass', true), '') <> ''
     AND current_setting('app.member_withdrawal_bypass', true)
         = (SELECT t.user_id::text FROM public.support_tickets t WHERE t.id = OLD.ticket_id)
     AND (NEW.id, NEW.ticket_id, NEW.previous_shown_at, NEW.edited_by, NEW.created_at)
         IS NOT DISTINCT FROM (OLD.id, OLD.ticket_id, OLD.previous_shown_at, OLD.edited_by, OLD.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'SUPPORT_ANSWER_REVISIONS_APPEND_ONLY';
END;
$fn_guard_support_ticket_answer_revisions_mutation$;

CREATE TRIGGER guard_support_ticket_answer_revisions_mutation
  BEFORE UPDATE OR DELETE ON public.support_ticket_answer_revisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_support_ticket_answer_revisions_mutation();
CREATE TRIGGER guard_support_ticket_answer_revisions_truncate
  BEFORE TRUNCATE ON public.support_ticket_answer_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_support_ticket_answer_revisions_mutation();
REVOKE ALL ON FUNCTION public.guard_support_ticket_answer_revisions_mutation() FROM PUBLIC, anon, authenticated, service_role;

-- 3. 답변 템플릿(4-2 의 3, 6절) ---------------------------------------------------------------------------------------
CREATE TABLE public.support_reply_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60 AND btrim(title) <> ''),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000 AND btrim(body) <> ''),
  category_id uuid,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);
CREATE INDEX support_reply_templates_sort ON public.support_reply_templates (sort_order, created_at);

COMMENT ON TABLE public.support_reply_templates IS
  '13번: 문의 답변 템플릿(○○ 빈칸·{사이트이름}·{문의제목}·{접수일}). 쓰기는 서버 키(관리자 고객지원 화면 서버 액션)만.';

ALTER TABLE public.support_reply_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.support_reply_templates FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.support_reply_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.support_reply_templates TO service_role;
CREATE POLICY support_reply_templates_admin_select ON public.support_reply_templates
  FOR SELECT TO authenticated
  USING ((SELECT public.has_admin_permission('support.manage')));

--    첫 값: 런북 12절 중 1:1 답변용 12-2~12-7·12-10(14개). '써머썬 연구소' → {사이트이름}, 한 글자 빈칸 '○' 도 '○○' 로 맞춤(빈칸 검사),
--    12-5 의 '구매 후 7일' → 30일(8번 이후 기준). category_id 는 칸이 하나라 두 카테고리(market_refund·credit_refund)에 함께 쓰는 글은 비운다
--    (모든 문의에서 보임). 회원 화면 문구처럼 데이터다 — 대표·직원이 '답변 템플릿' 탭에서 고친다.
INSERT INTO public.support_reply_templates (title, body, category_id, sort_order)
SELECT s.title, s.body, (SELECT c.id FROM public.support_ticket_categories c WHERE c.slug = s.slug), s.sort_order
  FROM (VALUES
    ('크레딧 미반영 — 접수', E'안녕하세요, {사이트이름}입니다.\n결제 후 크레딧이 반영되지 않아 불편을 드려 죄송합니다. 결제 내역을 확인하고 있으며, 확인되는 대로 크레딧을 지급해 드리겠습니다.\n빠른 확인을 위해 결제하신 일시와 금액, 결제수단을 알려 주시면 감사하겠습니다.', 'credit_error', 10),
    ('크레딧 미반영 — 처리 완료', E'결제가 확인되어 ○○ 크레딧을 지급해 드렸습니다. 마이페이지의 크레딧 내역에서 확인하실 수 있습니다. 기다려 주셔서 감사합니다.', 'credit_error', 20),
    ('크레딧 미반영 — 결제 확인 안 됨', E'확인 결과 해당 일시에 완료된 결제 내역이 없습니다. 카드사나 결제 앱에서 결제가 승인되었는지 한 번 더 확인해 주시고, 승인 내역이 있다면 승인 일시와 금액을 알려 주시면 다시 확인하겠습니다.', 'credit_error', 30),
    ('환불 접수', E'안녕하세요, {사이트이름}입니다.\n환불 요청이 접수되었습니다. 확인 후 영업일 기준 ○○일 이내에 처리해 드리겠습니다. 처리되는 동안 해당 크레딧은 사용하실 수 없습니다.', NULL, 40),
    ('환불 접수 — 계좌 송금 안내', E'고객님의 결제는 결제 수단의 사정(휴대폰 결제의 경우 결제하신 달이 지난 경우 등)으로 결제 취소가 되지 않아, 계좌로 환불해 드리고자 합니다.\n환불받으실 은행명, 계좌번호, 예금주(결제하신 본인 명의)를 알려 주시면 확인 후 송금해 드리겠습니다.', 'credit_refund', 50),
    ('환불 완료 — 결제 취소', E'○○원 결제 취소가 완료되었습니다. 카드사·결제수단에 따라 실제 반영까지 며칠이 걸릴 수 있습니다. 해당 크레딧은 회수되었습니다.', 'credit_refund', 60),
    ('환불 완료 — 계좌 송금', E'○○월 ○○일 알려 주신 계좌로 ○○원을 송금해 드렸습니다. 해당 크레딧은 회수되었습니다. 확인 부탁드립니다.', 'credit_refund', 70),
    ('환불 완료 — 자료 문제로 크레딧 환불', E'구매하신 「○○」 자료의 문제를 확인했습니다. 불편을 드려 죄송합니다. 사용하신 ○○ 크레딧을 돌려 드렸으며, 마이페이지의 크레딧 내역에서 확인하실 수 있습니다.', 'market_refund', 80),
    ('환불 거절', E'안녕하세요, {사이트이름}입니다.\n요청하신 환불은 아래 사유로 처리해 드리기 어렵습니다.\n- 사유: ○○ (예: 충전하신 크레딧 중 일부를 이미 사용하셨습니다 / 구매 후 30일이 지났습니다 / 자료를 이미 내려받으셨습니다)\n자세한 기준은 사이트의 취소/환불정책에서 확인하실 수 있습니다. 양해 부탁드립니다.', NULL, 90),
    ('잘못 지급한 크레딧 회수 — 안내', E'안녕하세요, {사이트이름}입니다.\n○○월 ○○일 고객님 계정에 ○○ 크레딧이 지급되었는데, 이는 저희의 처리 실수로 잘못 지급된 것입니다. 혼란을 드려 죄송합니다.\n해당 크레딧은 며칠 안에 회수될 예정이오니, 그때까지 사용하지 말아 주시기를 부탁드립니다. 회수가 끝나면 다시 안내해 드리겠습니다.\n고객님께서 직접 충전하신 크레딧에는 영향이 없습니다.', NULL, 100),
    ('잘못 지급한 크레딧 회수 — 완료', E'잘못 지급되었던 ○○ 크레딧의 회수를 마쳤습니다. 현재 잔액은 ○○ 크레딧입니다. 불편을 드려 다시 한번 죄송합니다.', NULL, 110),
    ('영수증 안내', E'안녕하세요, {사이트이름}입니다.\n요청하신 ○○월 ○○일 ○○원 결제 건의 영수증(매출전표)을 보내 드립니다. (첨부 / 아래 주소에서 확인하실 수 있습니다.)\n다른 형태의 증빙이 필요하시면 말씀해 주세요.', NULL, 120),
    ('비밀번호 분실 — 카카오 가입', E'고객님은 카카오 계정으로 가입하셨습니다. 로그인 화면에서 "카카오로 시작하기"를 눌러 로그인해 주세요. 별도의 비밀번호는 없습니다.', 'account', 130),
    ('비밀번호 분실 — 이메일 가입', E'안녕하세요, {사이트이름}입니다.\n죄송하게도 현재 비밀번호 재설정 기능을 준비하고 있어, 고객님 계정은 저희가 직접 확인해 도와 드려야 합니다. 본인 확인을 위해 가입하신 이메일 주소로 이 안내에 답장해 주시면, 확인 후 처리 방법을 안내해 드리겠습니다.', 'account', 140)
  ) AS s(title, body, slug, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM public.support_reply_templates);

-- 4. 설정 행(4-2 의 4, 10-1) — 문구는 초안이다. 대표가 관리자 고객지원 화면 '안내 문구' 탭에서 고친다. -----------------------------
--    member: 회원 화면 문구(필수 키가 비면 저장 거부, 선택 키가 비면 그 칸을 숨김). 자리표시는 알림 문구의 {문의제목} 하나.
--    admin: templateBlankMarker(관리자 화면에서 고치지 않음 — 템플릿과 함께 스크립트로), answerEditReasonGuide, notifyOnAnswerEdit,
--           accessLogRetentionYears(2 — 01-11 시행 처리방침 3절 '기록한 날부터 2년'과 같아야 함, 관리자 화면에서 고치지 않음).
INSERT INTO public.system_settings (key, value, description)
VALUES ('support_page_content', $json_support_page_content$
{
  "revision": 1,
  "member": {
    "pageTitle": "고객지원",
    "pageDescription": "1:1 문의를 남기고 답변을 확인합니다.",
    "formTitle": "1:1 문의하기",
    "formNotice": "답변은 이메일로 보내지 않습니다. 화면 위쪽 알림(종 모양)과 아래 문의 내역에서 확인해 주세요.",
    "responseTimeNote": "",
    "defaultCategoryHelp": "선택한 문의 유형에 맞춰 내용을 적어 주세요.",
    "historyTitle": "문의 내역",
    "historyIntro": "남겨 주신 문의와 답변을 확인하실 수 있습니다.",
    "emptyTitle": "아직 문의하신 내역이 없습니다",
    "emptyDescription": "궁금한 점이 있으시면 언제든지 문의해 주세요.",
    "categoryLabel": "문의 카테고리",
    "categoryPlaceholder": "문의 유형을 선택해 주세요",
    "subjectLabel": "제목",
    "messageLabel": "내용",
    "defaultSubjectPlaceholder": "문의 제목을 입력해 주세요",
    "defaultMessagePlaceholder": "문의 내용을 자세히 적어 주세요",
    "submitLabel": "문의 등록하기",
    "submittingLabel": "접수 중…",
    "uncategorizedLabel": "미분류",
    "editCategoryLabel": "문의 카테고리 수정",
    "editSubjectLabel": "제목 수정",
    "editMessageLabel": "내용 수정",
    "editSubjectPlaceholder": "제목을 입력하세요",
    "editMessagePlaceholder": "내용을 입력하세요",
    "cancelLabel": "취소",
    "saveEditLabel": "수정 완료",
    "editIconTitle": "문의 수정",
    "deleteIconTitle": "문의 내역 삭제",
    "needCategoryToast": "문의 카테고리를 선택해 주세요.",
    "needContentToast": "제목과 내용을 모두 입력해 주세요.",
    "deletedToast": "문의 내역이 삭제되었습니다.",
    "updatedToast": "문의 내용이 수정되었습니다.",
    "submittedTitle": "문의가 등록되었습니다",
    "submittedDescription": "빠른 시일 내에 답변드리겠습니다. 답변은 이메일로 보내지 않으니, 화면 위쪽 알림(종 모양)과 아래 문의 내역에서 확인해 주세요.",
    "deleteConfirmTitle": "문의 내역을 삭제할까요?",
    "deleteConfirmDescription": "삭제하면 내 문의 내역에서 사라지고 되돌릴 수 없습니다. 처리에 필요한 기록은 개인정보 처리방침에 따라 보관될 수 있습니다.",
    "deleteConfirmLabel": "삭제",
    "submitFailedToast": "문의 등록에 실패했습니다.",
    "updateFailedToast": "수정에 실패했습니다.",
    "deleteFailedToast": "삭제에 실패했습니다.",
    "answerLabel": "관리자 답변",
    "answerEditedLabel": "수정됨",
    "answerCreatedNotificationTitle": "문의하신 내용에 답변이 등록되었습니다.",
    "answerCreatedNotificationMessage": "제목: {문의제목}\n\n답변을 확인해보세요.",
    "answerEditedNotificationTitle": "문의 답변이 수정되었습니다.",
    "answerEditedNotificationMessage": "제목: {문의제목}\n\n수정된 답변을 확인해 보세요."
  },
  "admin": {
    "templateBlankMarker": "○○",
    "answerEditReasonGuide": "회원에게 보이지 않는 내부 기록입니다. 왜 고쳤는지 짧게 적어 주세요. 계좌·전화 같은 개인정보는 적지 마세요.",
    "notifyOnAnswerEdit": true,
    "accessLogRetentionYears": 2
  }
}
$json_support_page_content$::jsonb, '고객지원 회원 화면 문구·답변 설정(13번, 관리자 고객지원 화면 안내 문구 탭에서 수정)')
ON CONFLICT (key) DO NOTHING;

-- 5. 카테고리 slug 지키기(4-2 의 5, Q11) — slug 가 바뀔 때만 본다. SECURITY DEFINER 라 직원 세션의 RLS 와 상관없이 센다. -------------
--    문의(회원 삭제·탈퇴 회원 문의 포함)가 1건이라도 있거나, 옛 slug 가 탈퇴 가림 정책 redactionRefundCategorySlugs 에 있으면 거부.
CREATE FUNCTION public.guard_support_category_slug()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_support_category_slug$
DECLARE
  v_slugs jsonb;
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    IF EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.category_id = OLD.id) THEN
      RAISE EXCEPTION 'SUPPORT_CATEGORY_SLUG_LOCKED';
    END IF;
    v_slugs := (SELECT s.value -> 'redactionRefundCategorySlugs' FROM public.system_settings s WHERE s.key = 'member_withdrawal_policy');
    IF jsonb_typeof(v_slugs) = 'array' AND v_slugs ? OLD.slug THEN
      RAISE EXCEPTION 'SUPPORT_CATEGORY_SLUG_LOCKED';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn_guard_support_category_slug$;
REVOKE ALL ON FUNCTION public.guard_support_category_slug() FROM PUBLIC, anon, authenticated, service_role;


-- 6. 답변 저장 함수(4-3) -------------------------------------------------------------------------------------------
--    순서: 입력 → 행위자(owner 이거나 support.manage) → 문의 FOR UPDATE → 회원 삭제·탈퇴 → 재요청(작업 기록의 action·target_id·request_id·actor_id) →
--    충돌(sha256) → 첫 답변 / 수정(이력 1행·redaction_reviewed_at 비움) → 작업 기록(같은 거래).
--    app.support_answer_write = 문의 id 는 M2 잠금 트리거가 보는 표지다(거래 로컬).
CREATE FUNCTION public.save_support_ticket_answer(p_actor_id uuid, p_ticket_id uuid, p_response text, p_status text,
  p_expected_sha256 text, p_reason text, p_operation_key text, p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_save_support_ticket_answer$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
  v_audit public.admin_audit_log%ROWTYPE;
  v_key text := btrim(p_operation_key);
  v_reason text := NULLIF(btrim(p_reason), '');
  v_previous text;
  v_history uuid;
  v_is_edit boolean;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_actor_id IS NULL OR p_ticket_id IS NULL OR p_response IS NULL OR btrim(p_response) = '' OR char_length(p_response) > 10000
     OR (p_status IS NOT NULL AND p_status NOT IN ('in_progress', 'resolved', 'closed'))
     OR p_expected_sha256 IS NULL OR p_expected_sha256 !~ '^[0-9a-f]{64}$'
     OR NULLIF(v_key, '') IS NULL OR char_length(v_key) > 200
     OR p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'SUPPORT_ANSWER_INPUT_INVALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = p_actor_id AND p.is_admin IS TRUE
                    AND (p.admin_role = 'owner'
                         OR (p.admin_role = 'staff' AND EXISTS (SELECT 1 FROM public.admin_permission_grants g
                                                                  WHERE g.user_id = p.id AND g.permission = 'support.manage')))) THEN
    RAISE EXCEPTION 'SUPPORT_ANSWER_ACTOR_NOT_ALLOWED';
  END IF;

  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPPORT_TICKET_NOT_FOUND';
  END IF;

  IF v_ticket.is_deleted_by_user IS TRUE THEN
    RAISE EXCEPTION 'SUPPORT_TICKET_DELETED_BY_MEMBER';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_ticket.user_id AND p.withdrawn_at IS NOT NULL) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAWN';
  END IF;

  -- 재요청: 같은 처리자·같은 문의·같은 키의 기록이 있으면 그 결과를 다시 만든다(이력·작업 기록·알림 추가 없음).
  --   회원 삭제·탈퇴 검사 뒤에 둔다 — 탈퇴 회원 문의는 재요청이어도 본문을 돌려주지 않는다.
  SELECT a.* INTO v_audit
    FROM public.admin_audit_log a
   WHERE a.action IN ('support_ticket_reply', 'support_ticket_reply_edit')
     AND a.target_id = p_ticket_id::text
     AND a.request_id = v_key
     AND a.actor_id = p_actor_id
   ORDER BY a.created_at
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ticket', jsonb_build_object('id', v_ticket.id, 'user_id', v_ticket.user_id, 'subject', v_ticket.subject, 'status', v_ticket.status,
        'admin_response', v_ticket.admin_response, 'responded_at', v_ticket.responded_at, 'response_edited_at', v_ticket.response_edited_at,
        'updated_at', v_ticket.updated_at, 'created_at', v_ticket.created_at, 'category_id', v_ticket.category_id),
      'isEdit', v_audit.action = 'support_ticket_reply_edit',
      'historyId', v_audit.details -> 'historyId',
      'replayed', true);
  END IF;

  IF encode(sha256(convert_to(COALESCE(v_ticket.admin_response, ''), 'UTF8')), 'hex') <> p_expected_sha256 THEN
    RAISE EXCEPTION 'SUPPORT_ANSWER_CONFLICT';
  END IF;

  PERFORM set_config('app.support_answer_write', p_ticket_id::text, true);
  IF v_ticket.admin_response IS NULL THEN
    -- 첫 답변
    UPDATE public.support_tickets
       SET admin_response = p_response,
           status = COALESCE(p_status, 'resolved'),
           responded_at = v_now,
           updated_at = v_now
     WHERE id = p_ticket_id
    RETURNING * INTO v_ticket;
    PERFORM public.record_admin_audit(p_actor_id, 'support_ticket_reply', 'support_ticket', p_ticket_id::text, v_ticket.user_id, NULL, NULL,
      jsonb_build_object('status', v_ticket.status, 'length', char_length(p_response), 'request', p_request_meta), v_key);
    v_is_edit := false;
  ELSE
    -- 수정: 사유 필수, 같은 글 거부, 상태는 그대로
    IF v_reason IS NULL OR char_length(v_reason) > 300 THEN
      RAISE EXCEPTION 'SUPPORT_ANSWER_REASON_REQUIRED';
    END IF;
    IF p_response = v_ticket.admin_response THEN
      RAISE EXCEPTION 'SUPPORT_ANSWER_UNCHANGED';
    END IF;
    v_previous := v_ticket.admin_response;
    INSERT INTO public.support_ticket_answer_revisions (ticket_id, previous_response, previous_shown_at, edited_by, reason)
    VALUES (p_ticket_id, v_previous,
            COALESCE(v_ticket.response_edited_at, v_ticket.responded_at, v_ticket.updated_at, v_ticket.created_at), p_actor_id, v_reason)
    RETURNING id INTO v_history;
    UPDATE public.support_tickets
       SET admin_response = p_response,
           response_edited_at = v_now,
           updated_at = v_now,
           redaction_reviewed_at = NULL
     WHERE id = p_ticket_id
    RETURNING * INTO v_ticket;
    PERFORM public.record_admin_audit(p_actor_id, 'support_ticket_reply_edit', 'support_ticket', p_ticket_id::text, v_ticket.user_id, NULL, NULL,
      jsonb_build_object('historyId', v_history, 'lengthBefore', char_length(v_previous), 'lengthAfter', char_length(p_response),
                         'reasonLength', char_length(v_reason), 'request', p_request_meta), v_key);
    v_is_edit := true;
  END IF;
  PERFORM set_config('app.support_answer_write', '', true);

  RETURN jsonb_build_object(
    'ticket', jsonb_build_object('id', v_ticket.id, 'user_id', v_ticket.user_id, 'subject', v_ticket.subject, 'status', v_ticket.status,
      'admin_response', v_ticket.admin_response, 'responded_at', v_ticket.responded_at, 'response_edited_at', v_ticket.response_edited_at,
      'updated_at', v_ticket.updated_at, 'created_at', v_ticket.created_at, 'category_id', v_ticket.category_id),
    'isEdit', v_is_edit,
    'historyId', v_history,
    'replayed', false);
END;
$fn_save_support_ticket_answer$;
REVOKE ALL ON FUNCTION public.save_support_ticket_answer(uuid, uuid, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_support_ticket_answer(uuid, uuid, text, text, text, text, text, jsonb) TO service_role;

-- 7. 10번 함수 재정의(4-4) — 운영 원문 그대로에 '-- [13번]' 줄만 더하거나 바꿨다. 권한(EXECUTE)은 CREATE OR REPLACE 가 그대로 둔다. ------
-- 7-1. member_withdrawal_facts: (가) 계좌 요청 시각에 이력, (나) 가림 항목 support_ticket_answer_revision, (다) v_last_ticket 에 수정 시각,
--      문의 '확인됨' 판정에 수정 시각.
CREATE OR REPLACE FUNCTION public.member_withdrawal_facts(p_user_id uuid, p_ticket_retention_agreed boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_policy jsonb := public.member_withdrawal_policy();
  v_now timestamptz := now();
  v_profile public.profiles%ROWTYPE;
  v_order_ids uuid[];
  v_order_id_texts text[];
  v_order_keys text[];
  v_mul_nos text[];
  v_paid_reasons text[] := ARRAY[]::text[];
  v_had_payment boolean;
  v_has_orders boolean;
  v_in_orders integer;
  v_in_attempts integer;
  v_in_markers integer;
  v_in_webhooks integer;
  v_in_point_refunds integer;
  v_in_market_refunds integer;
  v_in_sources integer;
  v_in_alerts integer;
  v_in_jobs integer;
  v_in_total integer;
  v_open_periods jsonb := '[]'::jsonb;
  v_unverified jsonb;
  v_redaction jsonb := '[]'::jsonb;
  v_slugs text[];
  v_keywords text[];
  v_account_at timestamptz;
  v_quiet integer := public.member_withdrawal_policy_days('selfWithdrawOrderQuietDays');
  v_buffer integer := public.member_withdrawal_policy_days('withdrawRefundDeadlineBufferDays');
  v_setting_days integer := public.point_charge_refund_days();
  v_src record;
  v_order public.payment_orders%ROWTYPE;
  v_root_created timestamptz;
  v_ack_days integer;
  v_days integer;
  v_deadline timestamptz;
  v_until timestamptz;
  v_breakdown jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_paid integer := 0;
  v_free integer := 0;
  v_expired integer := 0;
  v_cash integer := 0;
  v_cash_unknown boolean := false;
  v_is_paid boolean;
  v_value integer;
  v_last_activity timestamptz;
  v_quiet_until timestamptz;
  v_recent boolean;
  v_last_payment timestamptz;
  v_last_market timestamptz;
  v_last_ticket timestamptz;
  v_refund_tickets uuid[];
  v_ticket_count integer;
  v_pending_tickets integer;
  v_open_request uuid;
  v_has_request boolean;
  v_marketing_agreed boolean;
  v_self_enabled boolean;
  v_self_reasons text[] := ARRAY[]::text[];
  v_request_reasons text[] := ARRAY[]::text[];
  v_retain_tickets boolean;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('userId', p_user_id, 'exists', false);
  END IF;

  SELECT COALESCE(array_agg(o.id), '{}'), COALESCE(array_agg(o.id::text), '{}'), COALESCE(array_agg(o.order_id), '{}')
    INTO v_order_ids, v_order_id_texts, v_order_keys
    FROM public.payment_orders o
   WHERE o.user_id = p_user_id;
  SELECT COALESCE(array_agg(t.provider_transaction_id) FILTER (WHERE t.provider_transaction_id IS NOT NULL), '{}')
    INTO v_mul_nos
    FROM public.payment_provider_transactions t
   WHERE t.payment_order_id = ANY (v_order_ids);
  v_has_orders := cardinality(v_order_ids) > 0
    OR EXISTS (SELECT 1 FROM public.checkout_attempts a WHERE a.user_id = p_user_id);

  -- 결제 회원(had_payment)
  IF EXISTS (
    SELECT 1 FROM public.payment_orders o
     WHERE o.user_id = p_user_id
       AND (o.status IN ('completed', 'refunded', 'cancel_pending', 'fulfillment_pending', 'confirming', 'manual_review')
            OR o.approved_at IS NOT NULL
            OR o.canceled_at IS NOT NULL
            OR EXISTS (SELECT 1 FROM public.payment_history h WHERE h.payment_order_id = o.id)
            OR EXISTS (SELECT 1 FROM public.payment_provider_transactions t
                        WHERE t.payment_order_id = o.id
                          AND (t.paid_feedback_recorded_at IS NOT NULL OR t.admin_paid_confirmed_at IS NOT NULL
                               OR t.cancel_feedback_recorded_at IS NOT NULL OR t.partial_cancel_feedback_recorded_at IS NOT NULL)))
  ) THEN
    v_paid_reasons := v_paid_reasons || 'MONEY_ORDER'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_history h WHERE h.user_id = p_user_id AND h.amount > 0) THEN
    v_paid_reasons := v_paid_reasons || 'PAYMENT_HISTORY'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.credit_sources s WHERE s.user_id = p_user_id AND s.source_category = 'plan_purchase') THEN
    v_paid_reasons := v_paid_reasons || 'PLAN_PURCHASE_SOURCE'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_orders o
              WHERE o.user_id = p_user_id AND o.failure_code IN ('PAYAPP_FEEDBACK_MISMATCH', 'PAYAPP_MUL_NO_CONFLICT')) THEN
    v_paid_reasons := v_paid_reasons || 'FEEDBACK_VERIFICATION_FAILED'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_admin_actions paa WHERE paa.payment_order_id = ANY (v_order_ids)) THEN
    v_paid_reasons := v_paid_reasons || 'PAYMENT_ADMIN_ACTION'::text;
  END IF;
  v_had_payment := cardinality(v_paid_reasons) > 0;
  v_retain_tickets := v_had_payment OR p_ticket_retention_agreed IS NOT FALSE;

  -- 진행 중(종류별)
  SELECT count(*)::integer INTO v_in_orders
    FROM public.payment_orders o
   WHERE o.user_id = p_user_id AND o.status NOT IN ('completed', 'refunded', 'failed', 'expired');
  SELECT count(*)::integer INTO v_in_attempts
    FROM public.checkout_attempts a
   WHERE a.user_id = p_user_id
     AND a.status IN ('claimed', 'manual_review')
     AND ((a.payment_order_id IS NULL AND a.expires_at > v_now)
          OR EXISTS (SELECT 1 FROM public.payment_orders o
                      WHERE o.id = a.payment_order_id AND o.status NOT IN ('completed', 'refunded', 'failed', 'expired')));
  SELECT count(*)::integer INTO v_in_markers
    FROM public.payment_provider_transactions t
   WHERE t.payment_order_id = ANY (v_order_ids)
     AND ((t.cancel_feedback_recorded_at IS NOT NULL AND t.cancel_processed_at IS NULL)
          OR (t.partial_cancel_feedback_recorded_at IS NOT NULL AND t.partial_cancel_processed_at IS NULL));
  SELECT count(*)::integer INTO v_in_webhooks
    FROM public.payment_webhook_events w
   WHERE w.processing_status IN ('pending', 'failed')
     AND w.transmission_id LIKE 'payapp:%'
     AND split_part(w.transmission_id, ':', 2) = ANY (v_mul_nos);
  SELECT count(*)::integer INTO v_in_point_refunds
    FROM public.refund_requests rr
   WHERE rr.user_id = p_user_id AND rr.status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review');
  SELECT count(*)::integer INTO v_in_market_refunds
    FROM public.market_refund_requests mr
   WHERE mr.user_id = p_user_id AND mr.status = 'pending';
  SELECT count(*)::integer INTO v_in_sources
    FROM public.credit_sources s
   WHERE s.user_id = p_user_id
     AND (s.status = 'pending_refund'
          OR (s.source_category = 'system_refund'
              AND COALESCE((SELECT r.root_in_progress FROM public.credit_source_paid_root(s.id) r LIMIT 1), false)));
  SELECT count(*)::integer INTO v_in_alerts
    FROM public.payment_reconciliation_alerts a
   WHERE a.resolved_at IS NULL
     AND ((a.details ->> 'payment_order_id') = ANY (v_order_id_texts)
          OR (a.details ->> 'order_payment_order_id') = ANY (v_order_id_texts)
          OR (a.details ->> 'mul_no') = ANY (v_mul_nos)
          OR (a.details ->> 'orig_mul_no') = ANY (v_mul_nos)
          OR (a.details ->> 'order_id') = ANY (v_order_keys)
          OR (a.details ->> 'user_id') = p_user_id::text);
  SELECT count(*)::integer INTO v_in_jobs
    FROM public.generate_listboard_generation_jobs j
   WHERE j.user_id = p_user_id AND j.status IN ('queued', 'running');
  v_in_total := v_in_orders + v_in_attempts + v_in_markers + v_in_webhooks + v_in_point_refunds
    + v_in_market_refunds + v_in_sources + v_in_alerts + v_in_jobs;

  -- 크레딧(원천별, 만료 순)과 환불 기간이 남은 유료 충전 건
  FOR v_src IN
    SELECT s.id, s.source_category, s.status, s.remaining_credits, s.expires_at, s.created_at, s.payment_order_id,
           r.root_source_id, r.payment_order_id AS root_order_id
      FROM public.credit_sources s
      LEFT JOIN LATERAL (SELECT x.root_source_id, x.payment_order_id FROM public.credit_source_paid_root(s.id) x LIMIT 1) r ON true
     WHERE s.user_id = p_user_id AND s.remaining_credits > 0
     ORDER BY s.expires_at NULLS LAST, s.id
  LOOP
    v_is_paid := v_src.root_source_id IS NOT NULL OR v_src.source_category = 'plan_purchase';
    IF v_src.expires_at IS NOT NULL AND v_src.expires_at <= v_now THEN
      v_expired := v_expired + v_src.remaining_credits;
      v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
        'source_id', v_src.id, 'category', v_src.source_category, 'paid', v_is_paid, 'paid_root_id', v_src.root_source_id,
        'credits', v_src.remaining_credits, 'forfeited', 0, 'expired_cleared', v_src.remaining_credits,
        'expires_at', v_src.expires_at, 'cash_value', NULL));
    ELSE
      v_total := v_total + v_src.remaining_credits;
      v_value := NULL;
      IF v_is_paid THEN
        v_paid := v_paid + v_src.remaining_credits;
        v_value := public.point_charge_cash_value(v_src.id, v_src.remaining_credits);
        IF v_value IS NULL THEN
          v_cash_unknown := true;
        ELSE
          v_cash := v_cash + v_value;
        END IF;
      ELSE
        v_free := v_free + v_src.remaining_credits;
      END IF;
      v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
        'source_id', v_src.id, 'category', v_src.source_category, 'paid', v_is_paid, 'paid_root_id', v_src.root_source_id,
        'credits', v_src.remaining_credits, 'forfeited', v_src.remaining_credits, 'expired_cleared', 0,
        'expires_at', v_src.expires_at, 'cash_value', v_value));
    END IF;

    IF v_is_paid THEN
      -- eligibility 와 같은 식: 뿌리 주문·뿌리 원천 기준, 일수 COALESCE(GREATEST(설정, 결제 전 동의), 7)
      v_order := NULL;
      SELECT * INTO v_order FROM public.payment_orders o WHERE o.id = COALESCE(v_src.root_order_id, v_src.payment_order_id);
      SELECT c.created_at INTO v_root_created FROM public.credit_sources c WHERE c.id = COALESCE(v_src.root_source_id, v_src.id);
      v_ack_days := NULL;
      SELECT a.refund_days INTO v_ack_days
        FROM public.checkout_attempts ca
        JOIN public.point_charge_checkout_acks a
          ON a.user_id = ca.user_id AND a.checkout_attempt_id = ca.checkout_attempt_id
       WHERE ca.id = v_order.checkout_attempt_id;
      v_days := COALESCE(GREATEST(v_setting_days, v_ack_days), 7);
      v_deadline := public.point_charge_refund_deadline(GREATEST(v_order.approved_at, v_root_created), v_days);
      v_until := CASE WHEN v_deadline IS NULL OR v_buffer IS NULL THEN NULL ELSE v_deadline + make_interval(days => v_buffer) END;
      IF v_until IS NULL OR v_until > v_now THEN
        v_open_periods := v_open_periods || jsonb_build_array(jsonb_build_object(
          'sourceId', v_src.id, 'rootSourceId', COALESCE(v_src.root_source_id, v_src.id), 'paymentOrderId', v_order.id,
          'deadline', v_deadline, 'blockedUntil', v_until, 'refundDays', v_days,
          'inBuffer', v_deadline IS NOT NULL AND v_deadline <= v_now));
      END IF;
    END IF;
  END LOOP;

  -- 페이앱 요청 미확인 주문
  SELECT COALESCE(jsonb_agg(o.id ORDER BY o.created_at), '[]'::jsonb) INTO v_unverified
    FROM public.payment_orders o
    JOIN public.payment_provider_transactions t ON t.payment_order_id = o.id
   WHERE o.user_id = p_user_id
     AND o.status = 'expired'
     AND o.failure_code IN ('PAYAPP_REQUEST_OUTCOME_EXPIRED', 'PAYAPP_READY_CANCEL_FAILED')
     AND t.provider_transaction_id IS NOT NULL
     AND COALESCE(t.provider_status, '') NOT IN ('8', '16', '32');

  -- 문의
  v_slugs := ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_policy -> 'redactionRefundCategorySlugs') = 'array'
                                                         THEN v_policy -> 'redactionRefundCategorySlugs' ELSE '[]'::jsonb END));
  v_keywords := ARRAY(SELECT k FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_policy -> 'redactionAccountRequestKeywords') = 'array'
                                                                  THEN v_policy -> 'redactionAccountRequestKeywords' ELSE '[]'::jsonb END) AS k
                       WHERE btrim(k) <> '');
  -- [13번] (가) 계좌 요청 시각: 지금 답변과 답변 수정 이력(그때 회원이 보던 글·보이기 시작한 시각)을 함께 본다.
  SELECT min(x.at) INTO v_account_at
    FROM (SELECT t.responded_at AS at
            FROM public.support_tickets t
           WHERE t.user_id = p_user_id
             AND t.responded_at IS NOT NULL
             AND EXISTS (SELECT 1 FROM unnest(v_keywords) AS k WHERE strpos(COALESCE(t.admin_response, ''), k) > 0)
          UNION ALL
          SELECT ar.previous_shown_at
            FROM public.support_ticket_answer_revisions ar
            JOIN public.support_tickets t ON t.id = ar.ticket_id
           WHERE t.user_id = p_user_id
             AND EXISTS (SELECT 1 FROM unnest(v_keywords) AS k WHERE strpos(ar.previous_response, k) > 0)) x;

  SELECT count(*)::integer,
         count(*) FILTER (WHERE t.status IN ('pending', 'in_progress'))::integer,
         max(GREATEST(t.responded_at, t.response_edited_at, t.member_updated_at, t.created_at)) -- [13번] (다) 답변 수정 시각
    INTO v_ticket_count, v_pending_tickets, v_last_ticket
    FROM public.support_tickets t
   WHERE t.user_id = p_user_id;

  SELECT COALESCE(array_agg(t.id ORDER BY t.created_at), '{}') INTO v_refund_tickets
    FROM public.support_tickets t
   WHERE t.user_id = p_user_id
     AND (COALESCE(t.category_snapshot ->> 'slug', (SELECT c.slug FROM public.support_ticket_categories c WHERE c.id = t.category_id)) = ANY (v_slugs)
          OR EXISTS (SELECT 1 FROM public.market_refund_requests mr WHERE mr.support_ticket_id = t.id));

  -- 가림 확인 필요(확인 뒤 회원이 고쳤거나 답변이 달렸으면 다시 필요)
  IF v_retain_tickets THEN
    WITH tk AS (
      SELECT t.*,
             (t.id = ANY (v_refund_tickets)) AS refund_related,
             (v_account_at IS NOT NULL AND (t.created_at > v_account_at OR t.member_updated_at > v_account_at)) AS after_account,
             (t.redaction_reviewed_at IS NOT NULL
              AND t.redaction_reviewed_at >= COALESCE(GREATEST(t.member_updated_at, t.responded_at, t.response_edited_at), '-infinity'::timestamptz)) AS reviewed -- [13번] 수정 시각
        FROM public.support_tickets t
       WHERE t.user_id = p_user_id
    ), items AS (
      SELECT 'support_ticket'::text AS kind, tk.id, tk.created_at,
             left(regexp_replace(tk.subject, '\s+', ' ', 'g'), 30) AS preview,
             array_remove(ARRAY[
               CASE WHEN tk.refund_related THEN 'REFUND_RELATED' END,
               CASE WHEN tk.after_account THEN 'AFTER_ACCOUNT_REQUEST' END,
               CASE WHEN public.member_text_has_long_number(tk.subject) OR public.member_text_has_long_number(tk.message)
                         OR public.member_text_has_long_number(tk.admin_response) THEN 'LONG_NUMBER' END], NULL) AS reasons
        FROM tk
       WHERE NOT tk.reviewed
      UNION ALL
      SELECT 'support_ticket_revision', rv.id, rv.created_at,
             left(regexp_replace(COALESCE(rv.subject, ''), '\s+', ' ', 'g'), 30),
             array_remove(ARRAY[
               CASE WHEN tk.refund_related THEN 'REFUND_RELATED' END,
               CASE WHEN tk.after_account THEN 'AFTER_ACCOUNT_REQUEST' END,
               CASE WHEN public.member_text_has_long_number(rv.subject) OR public.member_text_has_long_number(rv.message) THEN 'LONG_NUMBER' END], NULL)
        FROM public.support_ticket_revisions rv
        JOIN tk ON tk.id = rv.ticket_id
       WHERE rv.redaction_reviewed_at IS NULL
      -- [13번] (나) 답변 수정 이력: 부모 문의의 환불 관련·계좌 요청 뒤, 이전 답변·수정 사유의 긴 숫자
      UNION ALL
      SELECT 'support_ticket_answer_revision', ar.id, ar.created_at,
             left(regexp_replace(COALESCE(tk.subject, ''), '\s+', ' ', 'g'), 30),
             array_remove(ARRAY[
               CASE WHEN tk.refund_related THEN 'REFUND_RELATED' END,
               CASE WHEN tk.after_account THEN 'AFTER_ACCOUNT_REQUEST' END,
               CASE WHEN public.member_text_has_long_number(ar.previous_response) OR public.member_text_has_long_number(ar.reason) THEN 'LONG_NUMBER' END], NULL)
        FROM public.support_ticket_answer_revisions ar
        JOIN tk ON tk.id = ar.ticket_id
       WHERE ar.redaction_reviewed_at IS NULL
      UNION ALL
      SELECT 'refund_request', rr.id, rr.created_at, NULL::text,
             ARRAY['LONG_NUMBER']::text[]
        FROM public.refund_requests rr
       WHERE v_had_payment
         AND rr.user_id = p_user_id
         AND (rr.redaction_reviewed_at IS NULL OR rr.redaction_reviewed_at < rr.updated_at)
         AND (public.member_text_has_long_number(rr.reason) OR public.member_text_has_long_number(rr.admin_note))
      UNION ALL
      SELECT 'market_refund_request', mr.id, mr.created_at, NULL::text,
             ARRAY['LONG_NUMBER']::text[]
        FROM public.market_refund_requests mr
       WHERE v_had_payment
         AND mr.user_id = p_user_id
         AND (mr.redaction_reviewed_at IS NULL OR mr.redaction_reviewed_at < mr.updated_at)
         AND (public.member_text_has_long_number(mr.reason) OR public.member_text_has_long_number(mr.admin_note))
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', i.kind, 'id', i.id, 'preview', i.preview, 'reasons', to_jsonb(i.reasons))
                              ORDER BY i.created_at, i.id), '[]'::jsonb)
      INTO v_redaction
      FROM items i
     WHERE cardinality(i.reasons) > 0;
  END IF;

  -- 사건 시각
  SELECT GREATEST(max(o.created_at), max(o.approved_at), max(o.canceled_at),
                  (SELECT max(a.created_at) FROM public.checkout_attempts a WHERE a.user_id = p_user_id),
                  max(t.paid_feedback_recorded_at), max(t.cancel_feedback_recorded_at),
                  max(t.partial_cancel_feedback_recorded_at), max(t.admin_paid_confirmed_at))
    INTO v_last_activity
    FROM public.payment_orders o
    LEFT JOIN public.payment_provider_transactions t ON t.payment_order_id = o.id
   WHERE o.user_id = p_user_id;
  IF v_last_activity IS NULL THEN
    SELECT max(a.created_at) INTO v_last_activity FROM public.checkout_attempts a WHERE a.user_id = p_user_id;
  END IF;
  v_quiet_until := CASE WHEN v_last_activity IS NULL THEN NULL
                        WHEN v_quiet IS NULL THEN 'infinity'::timestamptz
                        ELSE v_last_activity + make_interval(days => v_quiet) END;
  v_recent := v_quiet_until IS NOT NULL AND v_quiet_until > v_now;

  SELECT GREATEST(max(o.approved_at), max(o.canceled_at),
                  max(t.paid_feedback_recorded_at), max(t.cancel_feedback_recorded_at),
                  max(t.partial_cancel_feedback_recorded_at), max(t.admin_paid_confirmed_at),
                  (SELECT max(rr.processed_at) FROM public.refund_requests rr WHERE rr.user_id = p_user_id),
                  (SELECT max(a.created_at) FROM public.checkout_attempts a WHERE a.user_id = p_user_id))
    INTO v_last_payment
    FROM public.payment_orders o
    LEFT JOIN public.payment_provider_transactions t ON t.payment_order_id = o.id
   WHERE o.user_id = p_user_id;
  IF v_last_payment IS NULL THEN
    SELECT GREATEST((SELECT max(rr.processed_at) FROM public.refund_requests rr WHERE rr.user_id = p_user_id),
                    (SELECT max(a.created_at) FROM public.checkout_attempts a WHERE a.user_id = p_user_id))
      INTO v_last_payment;
  END IF;
  SELECT GREATEST((SELECT max(mo.created_at) FROM public.market_purchase_orders mo WHERE mo.user_id = p_user_id),
                  (SELECT max(mr.processed_at) FROM public.market_refund_requests mr WHERE mr.user_id = p_user_id))
    INTO v_last_market;

  -- 요청·마케팅·스위치
  SELECT r.id INTO v_open_request FROM public.member_withdrawal_requests r WHERE r.user_id = p_user_id AND r.status = 'pending';
  v_has_request := EXISTS (SELECT 1 FROM public.member_withdrawal_requests r WHERE r.user_id = p_user_id);
  SELECT c.agreed INTO v_marketing_agreed
    FROM public.user_consents c
    JOIN public.signup_consent_items i ON i.id = c.item_id
   WHERE c.user_id = p_user_id
     AND i.key = (v_policy ->> 'marketingConsentItemKey')
   ORDER BY c.seq DESC
   LIMIT 1;
  v_self_enabled := COALESCE((v_policy -> 'selfAnonymizeEnabled') = 'true'::jsonb, false);

  -- 스스로 익명화·결제 회원 탈퇴 요청 가능 여부와 이유
  IF v_profile.is_admin IS TRUE THEN
    v_self_reasons := v_self_reasons || 'ADMIN'::text;
    v_request_reasons := v_request_reasons || 'ADMIN'::text;
  END IF;
  IF v_profile.withdrawn_at IS NOT NULL THEN
    v_self_reasons := v_self_reasons || 'WITHDRAWN'::text;
    v_request_reasons := v_request_reasons || 'WITHDRAWN'::text;
  END IF;
  IF NOT v_self_enabled THEN
    v_self_reasons := v_self_reasons || 'DISABLED'::text;
    v_request_reasons := v_request_reasons || 'DISABLED'::text;
  END IF;
  IF v_had_payment THEN
    v_self_reasons := v_self_reasons || 'PAYER'::text;
  ELSE
    v_request_reasons := v_request_reasons || 'NOT_PAYER'::text;
  END IF;
  IF v_in_total > 0 THEN
    v_self_reasons := v_self_reasons || 'IN_PROGRESS'::text;
    v_request_reasons := v_request_reasons || 'IN_PROGRESS'::text;
  END IF;
  IF jsonb_array_length(v_open_periods) > 0 THEN
    v_self_reasons := v_self_reasons || 'REFUND_PERIOD_OPEN'::text;
    v_request_reasons := v_request_reasons || 'REFUND_PERIOD_OPEN'::text;
  END IF;
  IF jsonb_array_length(v_unverified) > 0 THEN
    v_self_reasons := v_self_reasons || 'PROVIDER_UNVERIFIED'::text;
  END IF;
  IF jsonb_array_length(v_redaction) > 0 THEN
    v_self_reasons := v_self_reasons || 'REDACTION_REQUIRED'::text;
  END IF;
  IF v_recent THEN
    v_self_reasons := v_self_reasons || 'RECENT_PAYMENT_ACTIVITY'::text;
  END IF;
  IF v_open_request IS NOT NULL THEN
    v_request_reasons := v_request_reasons || 'REQUEST_PENDING'::text;
  END IF;
  -- 원 환산을 계산할 수 없는 유료 원천(주문 없는 옛 plan_purchase 등): 화면에서는 받지 않고 대표가 결제 내역으로 금액을 확인해 처리한다.
  IF v_cash_unknown THEN
    v_self_reasons := v_self_reasons || 'CASH_VALUE_UNKNOWN'::text;
    v_request_reasons := v_request_reasons || 'CASH_VALUE_UNKNOWN'::text;
  END IF;

  RETURN jsonb_build_object(
    'userId', p_user_id,
    'exists', true,
    'isAdmin', v_profile.is_admin IS TRUE,
    'withdrawnAt', v_profile.withdrawn_at,
    'provider', v_profile.provider,
    'hadPayment', v_had_payment,
    'hadPaymentReasons', to_jsonb(v_paid_reasons),
    'hasOrdersOrAttempts', v_has_orders,
    'hasRequestHistory', v_has_request,
    'openRequestId', v_open_request,
    'ticketCount', v_ticket_count,
    'pendingTicketCount', v_pending_tickets,
    'ticketRetentionAgreed', p_ticket_retention_agreed,
    'inProgress', jsonb_build_object(
      'orders', v_in_orders, 'attempts', v_in_attempts, 'cancelMarkers', v_in_markers, 'webhookEvents', v_in_webhooks,
      'pointRefunds', v_in_point_refunds, 'marketRefunds', v_in_market_refunds, 'pendingSources', v_in_sources,
      'alerts', v_in_alerts, 'generationJobs', v_in_jobs),
    'inProgressTotal', v_in_total,
    'refundPeriodOpen', v_open_periods,
    'providerUnverified', v_unverified,
    'redactionRequired', v_redaction,
    'refundTicketIds', to_jsonb(v_refund_tickets),
    'lastPaymentActivityAt', v_last_activity,
    'quietUntil', v_quiet_until,
    'lastPaymentEventAt', v_last_payment,
    'lastMarketEventAt', v_last_market,
    'lastTicketEventAt', v_last_ticket,
    'balance', jsonb_build_object(
      'spendable', (public.get_credit_balance_snapshot(p_user_id) ->> 'spendable_balance')::integer,
      'forfeitTotal', v_total, 'forfeitPaid', v_paid, 'forfeitFree', v_free, 'expired', v_expired,
      'paidCashValue', v_cash, 'paidCashValueUnknown', v_cash_unknown, 'breakdown', v_breakdown),
    'marketingAgreed', COALESCE(v_marketing_agreed, false),
    'selfAnonymizeEnabled', v_self_enabled,
    'fullDeleteAllowed', v_profile.is_admin IS NOT TRUE AND v_profile.withdrawn_at IS NULL AND NOT v_had_payment
                         AND NOT v_has_orders AND NOT v_has_request
                         AND (v_ticket_count = 0 OR p_ticket_retention_agreed IS FALSE),
    'selfAllowed', cardinality(v_self_reasons) = 0,
    'selfReasons', to_jsonb(v_self_reasons),
    'requestAllowed', cardinality(v_request_reasons) = 0,
    'requestReasons', to_jsonb(v_request_reasons)
  );
END;
$function$
;

-- 7-2. redact_member_text: 대상 종류 support_ticket_answer_revision(칸 previous_response·reason), 관리자 이벤트 가림은 부모 문의 기준.
CREATE OR REPLACE FUNCTION public.redact_member_text(p_actor_id uuid, p_target_kind text, p_target_id uuid, p_field text, p_target_text text, p_operation_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mask text := NULLIF(btrim(public.member_withdrawal_policy() -> 'texts' ->> 'redactionMask'), '');
  v_table text;
  v_user uuid;
  v_value text;
  v_ref_table text;
  v_ref_id uuid;
  v_occurrences integer;
  v_events integer;
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  IF p_target_id IS NULL OR p_target_text IS NULL OR btrim(p_target_text) = '' OR length(p_target_text) > 2000
     OR NULLIF(btrim(p_operation_key), '') IS NULL OR length(p_operation_key) > 200
     OR NOT ((p_target_kind = 'support_ticket' AND p_field IN ('subject', 'message', 'admin_response'))
             OR (p_target_kind = 'support_ticket_revision' AND p_field IN ('subject', 'message'))
             OR (p_target_kind = 'support_ticket_answer_revision' AND p_field IN ('previous_response', 'reason')) -- [13번]
             OR (p_target_kind IN ('refund_request', 'market_refund_request') AND p_field IN ('reason', 'admin_note'))) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  IF v_mask IS NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_POLICY_UNAVAILABLE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_audit_log a WHERE a.action = 'member_text_redact' AND a.request_id = p_operation_key) THEN
    RETURN jsonb_build_object('redacted', true, 'replay', true);
  END IF;

  v_table := CASE p_target_kind WHEN 'support_ticket' THEN 'support_tickets' WHEN 'support_ticket_revision' THEN 'support_ticket_revisions'
                                WHEN 'support_ticket_answer_revision' THEN 'support_ticket_answer_revisions' -- [13번]
                                WHEN 'refund_request' THEN 'refund_requests' ELSE 'market_refund_requests' END;
  IF p_target_kind = 'support_ticket_revision' THEN
    SELECT t.user_id, t.id INTO v_user, v_ref_id
      FROM public.support_ticket_revisions rv JOIN public.support_tickets t ON t.id = rv.ticket_id
     WHERE rv.id = p_target_id;
    v_ref_table := 'support_tickets';
    EXECUTE format('SELECT %I FROM public.support_ticket_revisions WHERE id = $1 FOR UPDATE', p_field) INTO v_value USING p_target_id;
  -- [13번] 답변 수정 이력: 관리자 이벤트 가림은 수정 이력처럼 부모 문의 기준
  ELSIF p_target_kind = 'support_ticket_answer_revision' THEN
    SELECT t.user_id, t.id INTO v_user, v_ref_id
      FROM public.support_ticket_answer_revisions ar JOIN public.support_tickets t ON t.id = ar.ticket_id
     WHERE ar.id = p_target_id;
    v_ref_table := 'support_tickets';
    EXECUTE format('SELECT %I FROM public.support_ticket_answer_revisions WHERE id = $1 FOR UPDATE', p_field) INTO v_value USING p_target_id;
  ELSE
    EXECUTE format('SELECT user_id, %I FROM public.%I WHERE id = $1 FOR UPDATE', p_field, v_table) INTO v_user, v_value USING p_target_id;
    v_ref_table := v_table;
    v_ref_id := p_target_id;
  END IF;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'MEMBER_REDACTION_TARGET_NOT_FOUND';
  END IF;
  IF v_value IS NULL OR strpos(v_value, p_target_text) = 0 THEN
    RAISE EXCEPTION 'MEMBER_REDACTION_TEXT_NOT_FOUND';
  END IF;
  v_occurrences := (length(v_value) - length(replace(v_value, p_target_text, ''))) / length(p_target_text);

  PERFORM set_config('app.member_withdrawal_bypass', v_user::text, true);
  EXECUTE format('UPDATE public.%I SET %I = replace(%I, $1, $2), redaction_reviewed_at = clock_timestamp() WHERE id = $3',
                 v_table, p_field, p_field)
    USING p_target_text, v_mask, p_target_id;

  UPDATE public.admin_events e
     SET title = replace(e.title, p_target_text, v_mask),
         body = replace(e.body, p_target_text, v_mask)
   WHERE ((e.ref_table = v_ref_table AND e.ref_id = v_ref_id)
          OR (e.ref_table = 'admin_events'
              AND e.ref_id IN (SELECT x.id FROM public.admin_events x WHERE x.ref_table = v_ref_table AND x.ref_id = v_ref_id)))
     AND (strpos(e.title, p_target_text) > 0 OR strpos(COALESCE(e.body, ''), p_target_text) > 0);
  GET DIAGNOSTICS v_events = ROW_COUNT;

  PERFORM public.record_admin_audit(p_actor_id, 'member_text_redact', p_target_kind, p_target_id::text, v_user, NULL, NULL,
    jsonb_build_object('field', p_field, 'length', length(p_target_text), 'occurrences', v_occurrences, 'admin_events', v_events),
    p_operation_key);

  RETURN jsonb_build_object('redacted', true, 'occurrences', v_occurrences, 'adminEventsUpdated', v_events);
END;
$function$
;

-- 7-3. mark_member_text_reviewed: 대상 종류 support_ticket_answer_revision 만 더함.
CREATE OR REPLACE FUNCTION public.mark_member_text_reviewed(p_actor_id uuid, p_target_kind text, p_target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_table text;
  v_user uuid;
  v_at timestamptz := clock_timestamp();
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  IF p_target_id IS NULL OR p_target_kind IS NULL
     OR p_target_kind NOT IN ('support_ticket', 'support_ticket_revision', 'support_ticket_answer_revision', 'refund_request', 'market_refund_request') THEN -- [13번]
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  v_table := CASE p_target_kind WHEN 'support_ticket' THEN 'support_tickets' WHEN 'support_ticket_revision' THEN 'support_ticket_revisions'
                                WHEN 'support_ticket_answer_revision' THEN 'support_ticket_answer_revisions' -- [13번]
                                WHEN 'refund_request' THEN 'refund_requests' ELSE 'market_refund_requests' END;
  IF p_target_kind = 'support_ticket_revision' THEN
    SELECT t.user_id INTO v_user FROM public.support_ticket_revisions rv JOIN public.support_tickets t ON t.id = rv.ticket_id WHERE rv.id = p_target_id;
  ELSIF p_target_kind = 'support_ticket_answer_revision' THEN -- [13번]
    SELECT t.user_id INTO v_user FROM public.support_ticket_answer_revisions ar JOIN public.support_tickets t ON t.id = ar.ticket_id WHERE ar.id = p_target_id;
  ELSE
    EXECUTE format('SELECT user_id FROM public.%I WHERE id = $1 FOR UPDATE', v_table) INTO v_user USING p_target_id;
  END IF;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'MEMBER_REDACTION_TARGET_NOT_FOUND';
  END IF;
  PERFORM set_config('app.member_withdrawal_bypass', v_user::text, true);
  EXECUTE format('UPDATE public.%I SET redaction_reviewed_at = $1 WHERE id = $2', v_table) USING v_at, p_target_id;
  PERFORM public.record_admin_audit(p_actor_id, 'member_text_reviewed', p_target_kind, p_target_id::text, v_user, NULL, NULL, '{}'::jsonb, NULL);
  RETURN jsonb_build_object('reviewed', true, 'reviewedAt', v_at);
END;
$function$
;

-- 7-4. read_withdrawn_member_ticket: 결과에 answerRevisions(답변 수정 이력) 더함.
CREATE OR REPLACE FUNCTION public.read_withdrawn_member_ticket(p_actor_id uuid, p_ticket_id uuid, p_reason text, p_request_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  IF NULLIF(btrim(p_reason), '') IS NULL OR length(p_reason) > 500
     OR (p_request_meta IS NOT NULL AND jsonb_typeof(p_request_meta) <> 'object') THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_ticket.user_id AND p.withdrawn_at IS NOT NULL) THEN
    RAISE EXCEPTION 'MEMBER_NOT_WITHDRAWN';
  END IF;
  PERFORM public.record_admin_audit(p_actor_id, 'withdrawn_record_view', 'support_ticket', p_ticket_id::text, v_ticket.user_id,
    NULL, p_reason, jsonb_build_object('kind', 'ticket', 'request', COALESCE(p_request_meta, '{}'::jsonb)), NULL);
  RETURN to_jsonb(v_ticket) || jsonb_build_object('revisions', (
    SELECT COALESCE(jsonb_agg(to_jsonb(rv) ORDER BY rv.written_at), '[]'::jsonb)
      FROM public.support_ticket_revisions rv WHERE rv.ticket_id = p_ticket_id),
    -- [13번] 답변 수정 이력(그때 회원이 보던 글·수정 사유)
    'answerRevisions', (
    SELECT COALESCE(jsonb_agg(to_jsonb(ar) ORDER BY ar.created_at, ar.id), '[]'::jsonb)
      FROM public.support_ticket_answer_revisions ar WHERE ar.ticket_id = p_ticket_id));
END;
$function$
;

-- [13번 M1] 끝 ------------------------------------------------------------------------------------------------

-- 8. VERIFY ---------------------------------------------------------------------------------------------------------
DO $verify_bundle13_cs_tools$
DECLARE
  v_rel text;
  v_fn text;
  v_value jsonb;
  v_key text;
  -- 회원 화면 필수 키(10-1 표 '필수', 코드 SUPPORT_PAGE_REQUIRED_KEYS 와 같은 목록·순서 — 계약 시험이 대조)
  v_required text[] := ARRAY[
    'pageTitle', 'formTitle', 'historyTitle', 'emptyTitle', 'categoryLabel', 'categoryPlaceholder', 'subjectLabel', 'messageLabel',
    'submitLabel', 'submittingLabel', 'uncategorizedLabel', 'editCategoryLabel', 'editSubjectLabel', 'editMessageLabel',
    'editSubjectPlaceholder', 'editMessagePlaceholder', 'cancelLabel', 'saveEditLabel', 'editIconTitle', 'deleteIconTitle',
    'needCategoryToast', 'needContentToast', 'deletedToast', 'updatedToast', 'submittedTitle', 'submittedDescription',
    'deleteConfirmTitle', 'deleteConfirmDescription', 'deleteConfirmLabel', 'submitFailedToast', 'updateFailedToast', 'deleteFailedToast',
    'answerLabel', 'answerCreatedNotificationTitle', 'answerCreatedNotificationMessage', 'answerEditedNotificationTitle',
    'answerEditedNotificationMessage'];
  v_optional text[] := ARRAY[
    'pageDescription', 'formNotice', 'responseTimeNote', 'defaultCategoryHelp', 'historyIntro', 'emptyDescription',
    'defaultSubjectPlaceholder', 'defaultMessagePlaceholder', 'answerEditedLabel'];
BEGIN
  -- 답변 이력: RLS·정책 0·service_role SELECT 만·가드 2개
  v_rel := 'public.support_ticket_answer_revisions';
  IF to_regclass(v_rel) IS NULL OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass(v_rel))
     OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = to_regclass(v_rel))
     OR NOT has_table_privilege('service_role', v_rel, 'SELECT')
     OR has_table_privilege('service_role', v_rel, 'INSERT') OR has_table_privilege('service_role', v_rel, 'UPDATE')
     OR has_table_privilege('service_role', v_rel, 'DELETE') OR has_table_privilege('service_role', v_rel, 'TRUNCATE')
     OR has_table_privilege('anon', v_rel, 'SELECT') OR has_table_privilege('authenticated', v_rel, 'SELECT')
     OR has_table_privilege('authenticated', v_rel, 'INSERT') OR has_table_privilege('authenticated', v_rel, 'UPDATE') THEN
    RAISE EXCEPTION 'VERIFY: answer revisions table / RLS / privileges';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = to_regclass(v_rel) AND NOT t.tgisinternal AND t.tgenabled = 'O'
       AND t.tgname IN ('guard_support_ticket_answer_revisions_mutation', 'guard_support_ticket_answer_revisions_truncate')) <> 2 THEN
    RAISE EXCEPTION 'VERIFY: answer revisions guard triggers';
  END IF;

  -- 템플릿: RLS·SELECT 정책 1개(support.manage)·anon 없음·authenticated SELECT 만·service_role 은 DELETE 없음·첫 값 14개
  v_rel := 'public.support_reply_templates';
  IF to_regclass(v_rel) IS NULL OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass(v_rel))
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_reply_templates') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_reply_templates'
                     AND policyname = 'support_reply_templates_admin_select' AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'
                     AND roles = '{authenticated}' AND qual LIKE '%has_admin_permission(''support.manage''::text)%')
     OR has_table_privilege('anon', v_rel, 'SELECT')
     OR NOT has_table_privilege('authenticated', v_rel, 'SELECT')
     OR has_table_privilege('authenticated', v_rel, 'INSERT') OR has_table_privilege('authenticated', v_rel, 'UPDATE')
     OR has_table_privilege('authenticated', v_rel, 'DELETE')
     OR NOT has_table_privilege('service_role', v_rel, 'INSERT') OR NOT has_table_privilege('service_role', v_rel, 'UPDATE')
     OR has_table_privilege('service_role', v_rel, 'DELETE') OR has_table_privilege('service_role', v_rel, 'TRUNCATE') THEN
    RAISE EXCEPTION 'VERIFY: reply templates table / policy / privileges';
  END IF;
  IF (SELECT count(*) FROM public.support_reply_templates WHERE created_by IS NULL AND revision = 1) <> 14
     OR EXISTS (SELECT 1 FROM public.support_reply_templates WHERE body ~ '써머썬|[^○]○[^○]|^○[^○]|[^○]○$') THEN
    RAISE EXCEPTION 'VERIFY: reply template seed';
  END IF;

  -- 설정 행: revision·필수 키(비지 않은 글)·선택 키(글)·관리자 값
  SELECT value INTO v_value FROM public.system_settings WHERE key = 'support_page_content';
  IF v_value IS NULL OR jsonb_typeof(v_value -> 'revision') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_value -> 'member') IS DISTINCT FROM 'object' OR jsonb_typeof(v_value -> 'admin') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'VERIFY: support_page_content shape';
  END IF;
  FOREACH v_key IN ARRAY v_required LOOP
    IF jsonb_typeof(v_value -> 'member' -> v_key) IS DISTINCT FROM 'string' OR btrim(v_value -> 'member' ->> v_key) = '' THEN
      RAISE EXCEPTION 'VERIFY: support_page_content required member key %', v_key;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY v_optional LOOP
    IF jsonb_typeof(v_value -> 'member' -> v_key) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'VERIFY: support_page_content optional member key %', v_key;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_object_keys(v_value -> 'member')) <> cardinality(v_required) + cardinality(v_optional)
     OR btrim(COALESCE(v_value -> 'admin' ->> 'templateBlankMarker', '')) = ''
     OR jsonb_typeof(v_value -> 'admin' -> 'answerEditReasonGuide') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_value -> 'admin' -> 'notifyOnAnswerEdit') IS DISTINCT FROM 'boolean'
     OR (v_value -> 'admin' -> 'accessLogRetentionYears') IS DISTINCT FROM '2'::jsonb THEN
    RAISE EXCEPTION 'VERIFY: support_page_content keys / admin values';
  END IF;

  -- 함수: 저장 함수는 service_role 만, 트리거 함수는 아무도. 모두 search_path 고정.
  v_fn := 'public.save_support_ticket_answer(uuid,uuid,text,text,text,text,text,jsonb)';
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS NOT TRUE THEN
    RAISE EXCEPTION 'VERIFY: save_support_ticket_answer EXECUTE / SECURITY DEFINER';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY['public.guard_support_category_slug()', 'public.guard_support_ticket_answer_revisions_mutation()'] LOOP
    IF has_function_privilege('service_role', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'VERIFY: % must not be executable by API roles', v_fn;
    END IF;
  END LOOP;
  IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.guard_support_category_slug()'::regprocedure) IS NOT TRUE THEN
    RAISE EXCEPTION 'VERIFY: guard_support_category_slug must be SECURITY DEFINER';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY['public.save_support_ticket_answer(uuid,uuid,text,text,text,text,text,jsonb)', 'public.guard_support_category_slug()',
                              'public.guard_support_ticket_answer_revisions_mutation()'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND 'search_path=public, pg_temp' = ANY (p.proconfig)) THEN
      RAISE EXCEPTION 'VERIFY: % search_path', v_fn;
    END IF;
  END LOOP;

  -- 재정의 4개: 본문 md5(prosrc)(로컬 계산 값)와 anonymize_member 그대로
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.member_withdrawal_facts(uuid,boolean)'::regprocedure) IS DISTINCT FROM '15147d898bdd615963fd7173e154d9f5'
     OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure) IS DISTINCT FROM '7ddf1b9245c429205af6b36fa01bfb21'
     OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.mark_member_text_reviewed(uuid,text,uuid)'::regprocedure) IS DISTINCT FROM '1284e5d70af808bb2b949432d92e255b'
     OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.read_withdrawn_member_ticket(uuid,uuid,text,jsonb)'::regprocedure) IS DISTINCT FROM 'ba416c661c7e9fb4c036c8516cd85d2c' THEN
    RAISE EXCEPTION 'VERIFY: bundle 10 redefinitions body';
  END IF;
  IF md5(pg_get_functiondef('public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)'::regprocedure))
     <> '1346d870d3623abae580a011b0484339' THEN
    RAISE EXCEPTION 'VERIFY: anonymize_member changed';
  END IF;
END;
$verify_bundle13_cs_tools$;

-- 기존 표에 거는 것(칸·FK·slug 트리거) 검사는 이름 붙인 별도 블록이다(리허설 light 사본은 이 DDL 과 이 블록을 뺀다).

NOTIFY pgrst, 'reload schema';
$rh_src_m1$);
SELECT pg_temp.ctx_set('mode', 'light');

-- ===== 계정: @test.com 시험 계정만(관리자·탈퇴 아님, 가입 완료). 결제·결제 시도·자료 구매·탈퇴 요청이 없는 계정 둘(A·B)은 익명화(경우 C)용,
--       나머지 셋은 대표(owner)·직원(staff, 경우마다 권한을 거래 안에서 바꿈)·대상 회원(E). 모자라면 멈춘다(실회원 id 로 대신하지 않음). =====
DO $rh_setup$
DECLARE
  v_clean uuid[];
  v_rest uuid[];
  v_pool uuid[];
BEGIN
  SELECT coalesce(array_agg(p.id ORDER BY u.created_at), '{}') INTO v_clean
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE u.email LIKE '%@test.com' AND p.withdrawn_at IS NULL AND p.is_admin IS NOT TRUE AND p.signup_completed IS TRUE
     AND NOT EXISTS (SELECT 1 FROM public.payment_orders o WHERE o.user_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM public.checkout_attempts a WHERE a.user_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM public.market_purchase_orders m WHERE m.user_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM public.member_withdrawal_requests r WHERE r.user_id = p.id);
  SELECT coalesce(array_agg(p.id ORDER BY u.created_at), '{}') INTO v_rest
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE u.email LIKE '%@test.com' AND p.withdrawn_at IS NULL AND p.is_admin IS NOT TRUE AND p.signup_completed IS TRUE
     AND NOT (p.id = ANY (v_clean));
  IF cardinality(v_clean) < 2 OR cardinality(v_clean) + cardinality(v_rest) < 5 THEN
    RAISE EXCEPTION 'RH FAIL [setup] @test.com 시험 계정이 모자람(결제 없는 계정 %개·전체 %개, 필요 2·5) — 실회원 id 로 대신하지 않고 멈춘다',
      cardinality(v_clean), cardinality(v_clean) + cardinality(v_rest);
  END IF;
  v_pool := v_rest || v_clean[3:];
  PERFORM pg_temp.ctx_set('A', v_clean[1]::text);
  PERFORM pg_temp.ctx_set('B', v_clean[2]::text);
  PERFORM pg_temp.ctx_set('owner', v_pool[1]::text);
  PERFORM pg_temp.ctx_set('staff', v_pool[2]::text);
  PERFORM pg_temp.ctx_set('E', v_pool[3]::text);
  INSERT INTO _rh_log (test, msg, payload) VALUES ('setup', '시험 계정 배정(@test.com 만)',
    jsonb_build_object('clean', cardinality(v_clean), 'total', cardinality(v_clean) + cardinality(v_rest)));
END
$rh_setup$;

-- ===== 13번 M0(원본 그대로) =====
-- 출시 전 작업 순서표 13번 묶음 M0: 관리자 회원 연락처 열람 기록(계획 docs/plan-bundle13-cs-tools.md 3판, 4-1·8절).
-- 만드는 것:
--   1. 표 admin_member_access_log(추가 전용): 누가·언제·어느 회원(uuid 만, FK 없음 — 회원을 완전 삭제해도 기록이 남음)·어느 화면·무슨 항목·
--      화면 정보(context, 검색어 원문은 넣지 않음)·사유·IP·기기. RLS 켬·정책 0, anon·authenticated 권한 없음, service_role 은 SELECT 만.
--   2. 가드 트리거: UPDATE·DELETE·TRUNCATE 를 거부한다(service_role 도). DB 소유자(postgres) 권한으로는 바꿀 수 있다(8-4 한계).
--   3. 기록 함수 record_admin_member_access(service_role 만): 행위자가 관리자인지 profiles 에서 보고, 개수·글자 수를 검사하고,
--      시각과 actor_role 을 함수가 정한다.
-- 01-11 시행 처리방침(10번 스크립트 apply)이 이 표·함수가 있는지 본다 — 2027-01-10 까지 운영에 있어야 한다(15절).
-- 잠금: 새 표만 만든다(기존 표 잠금 없음). profiles 는 함수 안에서 읽기만 한다.
-- 되돌리기 파일이 없다(법정 보관 기록, 4-1). M1·M2·M3 를 되돌리고 다시 적용해도 이 표에 걸리지 않는다(리허설 경우 F).
--   적용 직후 행이 0건일 때만(그 밖에는 쓰지 않는다) 아래를 한 거래에서 손으로 돌린다:
--     -- SELECT count(*) FROM public.admin_member_access_log;  -- 0 이어야 한다
--     -- DROP FUNCTION public.record_admin_member_access(uuid, text, uuid[], text[], jsonb, text, jsonb);
--     -- DROP TABLE public.admin_member_access_log;
--     -- DROP FUNCTION public.guard_admin_member_access_log_mutation();
-- 버전: 20261217100000~130000 은 운영 마지막 적용 11번(20261216100000)·12번(20261214100000) 뒤다(적용 순서 = 파일 시각 순서). 적용 직전에 schema_migrations 최신 버전을 다시 보고 그보다 뒤가 아니면 같은 순서로 다시 정한다. 파일 단위로 적용하고 이력은 같은 거래의 schema_migrations INSERT 로 넣는다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 0. 사전 점검 -----------------------------------------------------------------------------------------------------
DO $precheck_bundle13_access_log$
BEGIN
  IF to_regclass('public.admin_member_access_log') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECHECK: admin_member_access_log already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('record_admin_member_access', 'guard_admin_member_access_log_mutation')) THEN
    RAISE EXCEPTION 'PRECHECK: bundle 13 access log functions already exist';
  END IF;
  -- 12번이 먼저 적용돼 있어야 한다(16절 순서)
  IF to_regclass('public.member_suspensions') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK: bundle 12 (20261214100000) is not applied';
  END IF;
END;
$precheck_bundle13_access_log$;

-- [13번 M0] 시작 ------------------------------------------------------------------------------------------------
-- 1. 표(4-1) ----------------------------------------------------------------------------------------------------
CREATE TABLE public.admin_member_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid NOT NULL,
  actor_role text,
  screen text NOT NULL CHECK (char_length(screen) BETWEEN 1 AND 60),
  member_ids uuid[] NOT NULL CHECK (cardinality(member_ids) BETWEEN 1 AND 200 AND array_position(member_ids, NULL) IS NULL),
  fields text[] NOT NULL CHECK (cardinality(fields) BETWEEN 1 AND 10 AND array_position(fields, NULL) IS NULL),
  context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context) = 'object'),
  reason text CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 200),
  ip text CHECK (ip IS NULL OR char_length(ip) <= 100),
  user_agent text CHECK (user_agent IS NULL OR char_length(user_agent) <= 300)
);
CREATE INDEX admin_member_access_log_created ON public.admin_member_access_log (created_at DESC);
CREATE INDEX admin_member_access_log_actor_created ON public.admin_member_access_log (actor_id, created_at DESC);
CREATE INDEX admin_member_access_log_member_ids ON public.admin_member_access_log USING gin (member_ids);

COMMENT ON TABLE public.admin_member_access_log IS
  '13번: 관리자 회원 연락처 열람 기록(추가 전용, 보관 2년 — support_page_content.admin.accessLogRetentionYears). 쓰기는 record_admin_member_access 만.';

ALTER TABLE public.admin_member_access_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_member_access_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.admin_member_access_log TO service_role;

-- 2. 가드 트리거(추가 전용) --------------------------------------------------------------------------------------------
CREATE FUNCTION public.guard_admin_member_access_log_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_admin_member_access_log_mutation$
BEGIN
  RAISE EXCEPTION 'ADMIN_MEMBER_ACCESS_LOG_APPEND_ONLY';
END;
$fn_guard_admin_member_access_log_mutation$;

CREATE TRIGGER guard_admin_member_access_log_mutation
  BEFORE UPDATE OR DELETE ON public.admin_member_access_log
  FOR EACH ROW EXECUTE FUNCTION public.guard_admin_member_access_log_mutation();
CREATE TRIGGER guard_admin_member_access_log_truncate
  BEFORE TRUNCATE ON public.admin_member_access_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_admin_member_access_log_mutation();

-- 3. 기록 함수(8-1) -------------------------------------------------------------------------------------------------
--    화면 키·항목 이름은 코드 목록(src/lib/admin-member-access-log.ts)이고, 여기서는 형식만 본다(작업 기록 action 과 같은 방식).
--    p_request_meta 는 {ip, user_agent}(adminRequestMeta). 회원 수 1~200·중복 없음, 사유 200자, context 2000자.
CREATE FUNCTION public.record_admin_member_access(p_actor_id uuid, p_screen text, p_member_ids uuid[], p_fields text[],
  p_context jsonb DEFAULT '{}'::jsonb, p_reason text DEFAULT NULL, p_request_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_record_admin_member_access$
DECLARE
  v_role text;
  v_reason text := NULLIF(btrim(p_reason), '');
  v_id uuid;
BEGIN
  IF p_actor_id IS NULL OR p_screen IS NULL OR p_screen !~ '^[a-z][a-z0-9_.]{0,59}$'
     OR p_member_ids IS NULL OR cardinality(p_member_ids) NOT BETWEEN 1 AND 200 OR array_position(p_member_ids, NULL) IS NOT NULL
     OR cardinality(p_member_ids) <> (SELECT count(DISTINCT m) FROM unnest(p_member_ids) AS m)
     OR p_fields IS NULL OR cardinality(p_fields) NOT BETWEEN 1 AND 10
     OR EXISTS (SELECT 1 FROM unnest(p_fields) AS f WHERE f IS NULL OR f !~ '^[a-z][a-z0-9_]{0,39}$')
     OR (p_context IS NOT NULL AND (jsonb_typeof(p_context) <> 'object' OR length(p_context::text) > 2000))
     OR char_length(COALESCE(v_reason, '')) > 200
     OR (p_request_meta IS NOT NULL AND jsonb_typeof(p_request_meta) <> 'object') THEN
    RAISE EXCEPTION 'ADMIN_MEMBER_ACCESS_INPUT_INVALID';
  END IF;
  SELECT p.admin_role INTO v_role
    FROM public.profiles p
   WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.admin_role IN ('owner', 'staff');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_MEMBER_ACCESS_ACTOR_INVALID';
  END IF;
  INSERT INTO public.admin_member_access_log (created_at, actor_id, actor_role, screen, member_ids, fields, context, reason, ip, user_agent)
  VALUES (clock_timestamp(), p_actor_id, v_role, p_screen, p_member_ids, p_fields, COALESCE(p_context, '{}'::jsonb), v_reason,
          left(NULLIF(btrim(p_request_meta ->> 'ip'), ''), 100), left(NULLIF(p_request_meta ->> 'user_agent', ''), 300))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn_record_admin_member_access$;

REVOKE ALL ON FUNCTION public.record_admin_member_access(uuid, text, uuid[], text[], jsonb, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_admin_member_access(uuid, text, uuid[], text[], jsonb, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.guard_admin_member_access_log_mutation() FROM PUBLIC, anon, authenticated, service_role;
-- [13번 M0] 끝 ------------------------------------------------------------------------------------------------

-- 4. VERIFY --------------------------------------------------------------------------------------------------------
DO $verify_bundle13_access_log$
DECLARE
  v_rel constant text := 'public.admin_member_access_log';
  v_fn constant text := 'public.record_admin_member_access(uuid,text,uuid[],text[],jsonb,text,jsonb)';
BEGIN
  IF to_regclass(v_rel) IS NULL OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass(v_rel))
     OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = to_regclass(v_rel)) THEN
    RAISE EXCEPTION 'VERIFY: access log table / RLS / no policies';
  END IF;
  IF NOT has_table_privilege('service_role', v_rel, 'SELECT')
     OR has_table_privilege('service_role', v_rel, 'INSERT') OR has_table_privilege('service_role', v_rel, 'UPDATE')
     OR has_table_privilege('service_role', v_rel, 'DELETE') OR has_table_privilege('service_role', v_rel, 'TRUNCATE')
     OR has_table_privilege('anon', v_rel, 'SELECT') OR has_table_privilege('authenticated', v_rel, 'SELECT')
     OR has_table_privilege('anon', v_rel, 'INSERT') OR has_table_privilege('authenticated', v_rel, 'INSERT')
     OR has_table_privilege('authenticated', v_rel, 'UPDATE') OR has_table_privilege('authenticated', v_rel, 'DELETE') THEN
    RAISE EXCEPTION 'VERIFY: access log privileges';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = to_regclass(v_rel) AND NOT t.tgisinternal AND t.tgenabled = 'O'
       AND t.tgname IN ('guard_admin_member_access_log_mutation', 'guard_admin_member_access_log_truncate')) <> 2 THEN
    RAISE EXCEPTION 'VERIFY: access log guard triggers';
  END IF;
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'admin_member_access_log'
       AND indexname IN ('admin_member_access_log_created', 'admin_member_access_log_actor_created', 'admin_member_access_log_member_ids')) <> 3 THEN
    RAISE EXCEPTION 'VERIFY: access log indexes';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS NOT TRUE
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND 'search_path=public, pg_temp' = ANY (p.proconfig)) THEN
    RAISE EXCEPTION 'VERIFY: record_admin_member_access EXECUTE / SECURITY DEFINER';
  END IF;
  IF has_function_privilege('service_role', 'public.guard_admin_member_access_log_mutation()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.guard_admin_member_access_log_mutation()', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY: guard function must not be executable by API roles';
  END IF;
END;
$verify_bundle13_access_log$;

NOTIFY pgrst, 'reload schema';


-- ===== 13번 M1 사본(light) =====
-- 출시 전 작업 순서표 13번 묶음 M1: CS 도구 추가분(계획 docs/plan-bundle13-cs-tools.md 3판, 4-2~4-4).
-- 만드는 것:
--   1. support_tickets.response_edited_at(기본값 없는 칸 — 짧은 ACCESS EXCLUSIVE).
--   2. 표 support_ticket_answer_revisions(답변 이력, 추가 전용): 그때 회원이 보던 글·보이기 시작한 시각·고친 사람·사유. RLS 켬·정책 0,
--      service_role 은 SELECT 만(쓰기는 save_support_ticket_answer 만). 가드: UPDATE·DELETE·TRUNCATE 거부 — 부모 문의 연쇄 삭제와
--      가림 함수(app.member_withdrawal_bypass = 그 회원 id)의 previous_response·reason·redaction_reviewed_at UPDATE 만 예외.
--   3. 표 support_reply_templates(답변 템플릿): RLS SELECT 정책 has_admin_permission('support.manage'), 쓰기 정책 없음(서버 키만).
--      비어 있을 때만 런북 12절 14개를 넣는다(10-2).
--   4. 설정 행 system_settings.support_page_content(회원 화면 문구 10-1·관리자 값, revision 1 — 있으면 그대로).
--   5. slug 지키기 트리거 guard_support_category_slug(문의가 있거나 탈퇴 가림 정책 slug 이면 slug 변경 거부).
--   6. 답변 저장 함수 save_support_ticket_answer(service_role 만, 4-3).
--   7. 10번 함수 재정의 4개(4-4): member_withdrawal_facts·redact_member_text·mark_member_text_reviewed·read_withdrawn_member_ticket.
--      운영 원문(pg_get_functiondef)에서 바뀐 곳만 '-- [13번]' 표시로 고쳤다. anonymize_member 는 고치지 않고 지문만 본다.
-- 작업 기록(admin_audit_log)에는 답변 글·수정 사유 원문을 넣지 않는다(가릴 수 없는 표) — 글자 수와 이력 id 만.
-- 함수 지문은 md5(pg_get_functiondef(oid))(2026-11-26 운영 읽기 전용 값, 1-3). 다르면 멈춘다.
-- 잠금: support_tickets 에 칸 추가(ACCESS EXCLUSIVE)·FK(SHARE ROW EXCLUSIVE), support_ticket_categories 에 FK·트리거(SHARE ROW EXCLUSIVE).
--   새벽 짧은 창에서 적용하고, 잡지 못하면(lock_timeout 3초) 전체가 취소된다.
-- 옛 코드와 함께 돌아간다(추가만 함 — 옛 답변 route 의 세션 UPDATE 도 M2 전까지 허용).
-- 되돌리기: supabase/rollback/20261217110000_bundle13_cs_tools_down.sql(M3·M2 를 먼저 되돌린 뒤).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 0. 사전 점검(4-2) -----------------------------------------------------------------------------------------------
DO $precheck_bundle13_cs_tools$
DECLARE
  -- 재정의할 4개(10번 원문)와 그대로여야 하는 anonymize_member
  v_same text[][] := ARRAY[
    ARRAY['public.member_withdrawal_facts(uuid,boolean)', 'a7674770964dac2fe5c9179b8403c3b4'],
    ARRAY['public.redact_member_text(uuid,text,uuid,text,text,text)', '90778a74269a727608f028b21b43b8f6'],
    ARRAY['public.mark_member_text_reviewed(uuid,text,uuid)', 'b626dc43a8bb8402575f99a58bb5969b'],
    ARRAY['public.read_withdrawn_member_ticket(uuid,uuid,text,jsonb)', 'cce39fd0ab514d2c9cdd9e42d225688e'],
    ARRAY['public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)', '1346d870d3623abae580a011b0484339'],
    ARRAY['public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)', 'a42b474d9d95753ffba5041acb0c1c77'],
    ARRAY['public.guard_withdrawn_member_write()', '764d47be26a0254ba61c71bbd005ee9b']
  ];
  i integer;
BEGIN
  FOR i IN 1 .. array_length(v_same, 1) LOOP
    IF to_regprocedure(v_same[i][1]) IS NULL OR md5(pg_get_functiondef(to_regprocedure(v_same[i][1]))) <> v_same[i][2] THEN
      RAISE EXCEPTION 'PRECHECK: % changed (%)', v_same[i][1],
        CASE WHEN to_regprocedure(v_same[i][1]) IS NULL THEN 'missing' ELSE md5(pg_get_functiondef(to_regprocedure(v_same[i][1]))) END;
    END IF;
  END LOOP;
  IF to_regclass('public.support_ticket_answer_revisions') IS NOT NULL OR to_regclass('public.support_reply_templates') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECHECK: bundle 13 tables already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('save_support_ticket_answer', 'guard_support_ticket_answer_revisions_mutation', 'guard_support_category_slug')) THEN
    RAISE EXCEPTION 'PRECHECK: bundle 13 functions already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'support_tickets' AND column_name = 'response_edited_at') THEN
    RAISE EXCEPTION 'PRECHECK: support_tickets.response_edited_at already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'support_page_content') THEN
    RAISE EXCEPTION 'PRECHECK: support_page_content row already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.support_ticket_categories'::regclass AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'PRECHECK: support_ticket_categories triggers changed';
  END IF;
  IF to_regclass('public.admin_member_access_log') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK: M0 (20261217100000) is not applied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'member_withdrawal_policy') THEN
    RAISE EXCEPTION 'PRECHECK: member_withdrawal_policy missing';
  END IF;
END;
$precheck_bundle13_cs_tools$;

-- [13번 M1] 시작 ------------------------------------------------------------------------------------------------
-- 1. 답변 수정 시각 칸(4-2 의 1) --------------------------------------------------------------------------------------

-- 2. 답변 이력(4-2 의 2) -------------------------------------------------------------------------------------------
--    edited_by 는 FK 없는 uuid(관리자 계정을 지워도 이력이 남음).
CREATE TABLE public.support_ticket_answer_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL,
  previous_response text NOT NULL,
  previous_shown_at timestamptz NOT NULL,
  edited_by uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  redaction_reviewed_at timestamptz
);
CREATE INDEX support_ticket_answer_revisions_ticket ON public.support_ticket_answer_revisions (ticket_id, created_at);

COMMENT ON TABLE public.support_ticket_answer_revisions IS
  '13번: 문의 답변 수정 이력(그때 회원이 보던 글). 쓰기는 save_support_ticket_answer 만, 탈퇴 가림 대상(support_ticket_answer_revision).';

ALTER TABLE public.support_ticket_answer_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.support_ticket_answer_revisions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.support_ticket_answer_revisions TO service_role;

--    DELETE: 부모 문의가 이미 없으면(연쇄 삭제) 통과. UPDATE: 가림 함수 거래(bypass = 부모 문의의 회원)에서 가릴 칸만.
CREATE FUNCTION public.guard_support_ticket_answer_revisions_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_support_ticket_answer_revisions_mutation$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = OLD.ticket_id) THEN
      RAISE EXCEPTION 'SUPPORT_ANSWER_REVISIONS_APPEND_ONLY';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
     AND COALESCE(current_setting('app.member_withdrawal_bypass', true), '') <> ''
     AND current_setting('app.member_withdrawal_bypass', true)
         = (SELECT t.user_id::text FROM public.support_tickets t WHERE t.id = OLD.ticket_id)
     AND (NEW.id, NEW.ticket_id, NEW.previous_shown_at, NEW.edited_by, NEW.created_at)
         IS NOT DISTINCT FROM (OLD.id, OLD.ticket_id, OLD.previous_shown_at, OLD.edited_by, OLD.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'SUPPORT_ANSWER_REVISIONS_APPEND_ONLY';
END;
$fn_guard_support_ticket_answer_revisions_mutation$;

CREATE TRIGGER guard_support_ticket_answer_revisions_mutation
  BEFORE UPDATE OR DELETE ON public.support_ticket_answer_revisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_support_ticket_answer_revisions_mutation();
CREATE TRIGGER guard_support_ticket_answer_revisions_truncate
  BEFORE TRUNCATE ON public.support_ticket_answer_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_support_ticket_answer_revisions_mutation();
REVOKE ALL ON FUNCTION public.guard_support_ticket_answer_revisions_mutation() FROM PUBLIC, anon, authenticated, service_role;

-- 3. 답변 템플릿(4-2 의 3, 6절) ---------------------------------------------------------------------------------------
CREATE TABLE public.support_reply_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60 AND btrim(title) <> ''),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000 AND btrim(body) <> ''),
  category_id uuid,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);
CREATE INDEX support_reply_templates_sort ON public.support_reply_templates (sort_order, created_at);

COMMENT ON TABLE public.support_reply_templates IS
  '13번: 문의 답변 템플릿(○○ 빈칸·{사이트이름}·{문의제목}·{접수일}). 쓰기는 서버 키(관리자 고객지원 화면 서버 액션)만.';

ALTER TABLE public.support_reply_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.support_reply_templates FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.support_reply_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.support_reply_templates TO service_role;
CREATE POLICY support_reply_templates_admin_select ON public.support_reply_templates
  FOR SELECT TO authenticated
  USING ((SELECT public.has_admin_permission('support.manage')));

--    첫 값: 런북 12절 중 1:1 답변용 12-2~12-7·12-10(14개). '써머썬 연구소' → {사이트이름}, 한 글자 빈칸 '○' 도 '○○' 로 맞춤(빈칸 검사),
--    12-5 의 '구매 후 7일' → 30일(8번 이후 기준). category_id 는 칸이 하나라 두 카테고리(market_refund·credit_refund)에 함께 쓰는 글은 비운다
--    (모든 문의에서 보임). 회원 화면 문구처럼 데이터다 — 대표·직원이 '답변 템플릿' 탭에서 고친다.
INSERT INTO public.support_reply_templates (title, body, category_id, sort_order)
SELECT s.title, s.body, (SELECT c.id FROM public.support_ticket_categories c WHERE c.slug = s.slug), s.sort_order
  FROM (VALUES
    ('크레딧 미반영 — 접수', E'안녕하세요, {사이트이름}입니다.\n결제 후 크레딧이 반영되지 않아 불편을 드려 죄송합니다. 결제 내역을 확인하고 있으며, 확인되는 대로 크레딧을 지급해 드리겠습니다.\n빠른 확인을 위해 결제하신 일시와 금액, 결제수단을 알려 주시면 감사하겠습니다.', 'credit_error', 10),
    ('크레딧 미반영 — 처리 완료', E'결제가 확인되어 ○○ 크레딧을 지급해 드렸습니다. 마이페이지의 크레딧 내역에서 확인하실 수 있습니다. 기다려 주셔서 감사합니다.', 'credit_error', 20),
    ('크레딧 미반영 — 결제 확인 안 됨', E'확인 결과 해당 일시에 완료된 결제 내역이 없습니다. 카드사나 결제 앱에서 결제가 승인되었는지 한 번 더 확인해 주시고, 승인 내역이 있다면 승인 일시와 금액을 알려 주시면 다시 확인하겠습니다.', 'credit_error', 30),
    ('환불 접수', E'안녕하세요, {사이트이름}입니다.\n환불 요청이 접수되었습니다. 확인 후 영업일 기준 ○○일 이내에 처리해 드리겠습니다. 처리되는 동안 해당 크레딧은 사용하실 수 없습니다.', NULL, 40),
    ('환불 접수 — 계좌 송금 안내', E'고객님의 결제는 결제 수단의 사정(휴대폰 결제의 경우 결제하신 달이 지난 경우 등)으로 결제 취소가 되지 않아, 계좌로 환불해 드리고자 합니다.\n환불받으실 은행명, 계좌번호, 예금주(결제하신 본인 명의)를 알려 주시면 확인 후 송금해 드리겠습니다.', 'credit_refund', 50),
    ('환불 완료 — 결제 취소', E'○○원 결제 취소가 완료되었습니다. 카드사·결제수단에 따라 실제 반영까지 며칠이 걸릴 수 있습니다. 해당 크레딧은 회수되었습니다.', 'credit_refund', 60),
    ('환불 완료 — 계좌 송금', E'○○월 ○○일 알려 주신 계좌로 ○○원을 송금해 드렸습니다. 해당 크레딧은 회수되었습니다. 확인 부탁드립니다.', 'credit_refund', 70),
    ('환불 완료 — 자료 문제로 크레딧 환불', E'구매하신 「○○」 자료의 문제를 확인했습니다. 불편을 드려 죄송합니다. 사용하신 ○○ 크레딧을 돌려 드렸으며, 마이페이지의 크레딧 내역에서 확인하실 수 있습니다.', 'market_refund', 80),
    ('환불 거절', E'안녕하세요, {사이트이름}입니다.\n요청하신 환불은 아래 사유로 처리해 드리기 어렵습니다.\n- 사유: ○○ (예: 충전하신 크레딧 중 일부를 이미 사용하셨습니다 / 구매 후 30일이 지났습니다 / 자료를 이미 내려받으셨습니다)\n자세한 기준은 사이트의 취소/환불정책에서 확인하실 수 있습니다. 양해 부탁드립니다.', NULL, 90),
    ('잘못 지급한 크레딧 회수 — 안내', E'안녕하세요, {사이트이름}입니다.\n○○월 ○○일 고객님 계정에 ○○ 크레딧이 지급되었는데, 이는 저희의 처리 실수로 잘못 지급된 것입니다. 혼란을 드려 죄송합니다.\n해당 크레딧은 며칠 안에 회수될 예정이오니, 그때까지 사용하지 말아 주시기를 부탁드립니다. 회수가 끝나면 다시 안내해 드리겠습니다.\n고객님께서 직접 충전하신 크레딧에는 영향이 없습니다.', NULL, 100),
    ('잘못 지급한 크레딧 회수 — 완료', E'잘못 지급되었던 ○○ 크레딧의 회수를 마쳤습니다. 현재 잔액은 ○○ 크레딧입니다. 불편을 드려 다시 한번 죄송합니다.', NULL, 110),
    ('영수증 안내', E'안녕하세요, {사이트이름}입니다.\n요청하신 ○○월 ○○일 ○○원 결제 건의 영수증(매출전표)을 보내 드립니다. (첨부 / 아래 주소에서 확인하실 수 있습니다.)\n다른 형태의 증빙이 필요하시면 말씀해 주세요.', NULL, 120),
    ('비밀번호 분실 — 카카오 가입', E'고객님은 카카오 계정으로 가입하셨습니다. 로그인 화면에서 "카카오로 시작하기"를 눌러 로그인해 주세요. 별도의 비밀번호는 없습니다.', 'account', 130),
    ('비밀번호 분실 — 이메일 가입', E'안녕하세요, {사이트이름}입니다.\n죄송하게도 현재 비밀번호 재설정 기능을 준비하고 있어, 고객님 계정은 저희가 직접 확인해 도와 드려야 합니다. 본인 확인을 위해 가입하신 이메일 주소로 이 안내에 답장해 주시면, 확인 후 처리 방법을 안내해 드리겠습니다.', 'account', 140)
  ) AS s(title, body, slug, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM public.support_reply_templates);

-- 4. 설정 행(4-2 의 4, 10-1) — 문구는 초안이다. 대표가 관리자 고객지원 화면 '안내 문구' 탭에서 고친다. -----------------------------
--    member: 회원 화면 문구(필수 키가 비면 저장 거부, 선택 키가 비면 그 칸을 숨김). 자리표시는 알림 문구의 {문의제목} 하나.
--    admin: templateBlankMarker(관리자 화면에서 고치지 않음 — 템플릿과 함께 스크립트로), answerEditReasonGuide, notifyOnAnswerEdit,
--           accessLogRetentionYears(2 — 01-11 시행 처리방침 3절 '기록한 날부터 2년'과 같아야 함, 관리자 화면에서 고치지 않음).
INSERT INTO public.system_settings (key, value, description)
VALUES ('support_page_content', $json_support_page_content$
{
  "revision": 1,
  "member": {
    "pageTitle": "고객지원",
    "pageDescription": "1:1 문의를 남기고 답변을 확인합니다.",
    "formTitle": "1:1 문의하기",
    "formNotice": "답변은 이메일로 보내지 않습니다. 화면 위쪽 알림(종 모양)과 아래 문의 내역에서 확인해 주세요.",
    "responseTimeNote": "",
    "defaultCategoryHelp": "선택한 문의 유형에 맞춰 내용을 적어 주세요.",
    "historyTitle": "문의 내역",
    "historyIntro": "남겨 주신 문의와 답변을 확인하실 수 있습니다.",
    "emptyTitle": "아직 문의하신 내역이 없습니다",
    "emptyDescription": "궁금한 점이 있으시면 언제든지 문의해 주세요.",
    "categoryLabel": "문의 카테고리",
    "categoryPlaceholder": "문의 유형을 선택해 주세요",
    "subjectLabel": "제목",
    "messageLabel": "내용",
    "defaultSubjectPlaceholder": "문의 제목을 입력해 주세요",
    "defaultMessagePlaceholder": "문의 내용을 자세히 적어 주세요",
    "submitLabel": "문의 등록하기",
    "submittingLabel": "접수 중…",
    "uncategorizedLabel": "미분류",
    "editCategoryLabel": "문의 카테고리 수정",
    "editSubjectLabel": "제목 수정",
    "editMessageLabel": "내용 수정",
    "editSubjectPlaceholder": "제목을 입력하세요",
    "editMessagePlaceholder": "내용을 입력하세요",
    "cancelLabel": "취소",
    "saveEditLabel": "수정 완료",
    "editIconTitle": "문의 수정",
    "deleteIconTitle": "문의 내역 삭제",
    "needCategoryToast": "문의 카테고리를 선택해 주세요.",
    "needContentToast": "제목과 내용을 모두 입력해 주세요.",
    "deletedToast": "문의 내역이 삭제되었습니다.",
    "updatedToast": "문의 내용이 수정되었습니다.",
    "submittedTitle": "문의가 등록되었습니다",
    "submittedDescription": "빠른 시일 내에 답변드리겠습니다. 답변은 이메일로 보내지 않으니, 화면 위쪽 알림(종 모양)과 아래 문의 내역에서 확인해 주세요.",
    "deleteConfirmTitle": "문의 내역을 삭제할까요?",
    "deleteConfirmDescription": "삭제하면 내 문의 내역에서 사라지고 되돌릴 수 없습니다. 처리에 필요한 기록은 개인정보 처리방침에 따라 보관될 수 있습니다.",
    "deleteConfirmLabel": "삭제",
    "submitFailedToast": "문의 등록에 실패했습니다.",
    "updateFailedToast": "수정에 실패했습니다.",
    "deleteFailedToast": "삭제에 실패했습니다.",
    "answerLabel": "관리자 답변",
    "answerEditedLabel": "수정됨",
    "answerCreatedNotificationTitle": "문의하신 내용에 답변이 등록되었습니다.",
    "answerCreatedNotificationMessage": "제목: {문의제목}\n\n답변을 확인해보세요.",
    "answerEditedNotificationTitle": "문의 답변이 수정되었습니다.",
    "answerEditedNotificationMessage": "제목: {문의제목}\n\n수정된 답변을 확인해 보세요."
  },
  "admin": {
    "templateBlankMarker": "○○",
    "answerEditReasonGuide": "회원에게 보이지 않는 내부 기록입니다. 왜 고쳤는지 짧게 적어 주세요. 계좌·전화 같은 개인정보는 적지 마세요.",
    "notifyOnAnswerEdit": true,
    "accessLogRetentionYears": 2
  }
}
$json_support_page_content$::jsonb, '고객지원 회원 화면 문구·답변 설정(13번, 관리자 고객지원 화면 안내 문구 탭에서 수정)')
ON CONFLICT (key) DO NOTHING;

-- 5. 카테고리 slug 지키기(4-2 의 5, Q11) — slug 가 바뀔 때만 본다. SECURITY DEFINER 라 직원 세션의 RLS 와 상관없이 센다. -------------
--    문의(회원 삭제·탈퇴 회원 문의 포함)가 1건이라도 있거나, 옛 slug 가 탈퇴 가림 정책 redactionRefundCategorySlugs 에 있으면 거부.
CREATE FUNCTION public.guard_support_category_slug()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_support_category_slug$
DECLARE
  v_slugs jsonb;
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    IF EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.category_id = OLD.id) THEN
      RAISE EXCEPTION 'SUPPORT_CATEGORY_SLUG_LOCKED';
    END IF;
    v_slugs := (SELECT s.value -> 'redactionRefundCategorySlugs' FROM public.system_settings s WHERE s.key = 'member_withdrawal_policy');
    IF jsonb_typeof(v_slugs) = 'array' AND v_slugs ? OLD.slug THEN
      RAISE EXCEPTION 'SUPPORT_CATEGORY_SLUG_LOCKED';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn_guard_support_category_slug$;
REVOKE ALL ON FUNCTION public.guard_support_category_slug() FROM PUBLIC, anon, authenticated, service_role;


-- 6. 답변 저장 함수(4-3) -------------------------------------------------------------------------------------------
--    순서: 입력 → 행위자(owner 이거나 support.manage) → 문의 FOR UPDATE → 회원 삭제·탈퇴 → 재요청(작업 기록의 action·target_id·request_id·actor_id) →
--    충돌(sha256) → 첫 답변 / 수정(이력 1행·redaction_reviewed_at 비움) → 작업 기록(같은 거래).
--    app.support_answer_write = 문의 id 는 M2 잠금 트리거가 보는 표지다(거래 로컬).
CREATE FUNCTION public.save_support_ticket_answer(p_actor_id uuid, p_ticket_id uuid, p_response text, p_status text,
  p_expected_sha256 text, p_reason text, p_operation_key text, p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_save_support_ticket_answer$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
  v_audit public.admin_audit_log%ROWTYPE;
  v_key text := btrim(p_operation_key);
  v_reason text := NULLIF(btrim(p_reason), '');
  v_previous text;
  v_history uuid;
  v_is_edit boolean;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_actor_id IS NULL OR p_ticket_id IS NULL OR p_response IS NULL OR btrim(p_response) = '' OR char_length(p_response) > 10000
     OR (p_status IS NOT NULL AND p_status NOT IN ('in_progress', 'resolved', 'closed'))
     OR p_expected_sha256 IS NULL OR p_expected_sha256 !~ '^[0-9a-f]{64}$'
     OR NULLIF(v_key, '') IS NULL OR char_length(v_key) > 200
     OR p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'SUPPORT_ANSWER_INPUT_INVALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = p_actor_id AND p.is_admin IS TRUE
                    AND (p.admin_role = 'owner'
                         OR (p.admin_role = 'staff' AND EXISTS (SELECT 1 FROM public.admin_permission_grants g
                                                                  WHERE g.user_id = p.id AND g.permission = 'support.manage')))) THEN
    RAISE EXCEPTION 'SUPPORT_ANSWER_ACTOR_NOT_ALLOWED';
  END IF;

  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPPORT_TICKET_NOT_FOUND';
  END IF;

  IF v_ticket.is_deleted_by_user IS TRUE THEN
    RAISE EXCEPTION 'SUPPORT_TICKET_DELETED_BY_MEMBER';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_ticket.user_id AND p.withdrawn_at IS NOT NULL) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAWN';
  END IF;

  -- 재요청: 같은 처리자·같은 문의·같은 키의 기록이 있으면 그 결과를 다시 만든다(이력·작업 기록·알림 추가 없음).
  --   회원 삭제·탈퇴 검사 뒤에 둔다 — 탈퇴 회원 문의는 재요청이어도 본문을 돌려주지 않는다.
  SELECT a.* INTO v_audit
    FROM public.admin_audit_log a
   WHERE a.action IN ('support_ticket_reply', 'support_ticket_reply_edit')
     AND a.target_id = p_ticket_id::text
     AND a.request_id = v_key
     AND a.actor_id = p_actor_id
   ORDER BY a.created_at
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ticket', jsonb_build_object('id', v_ticket.id, 'user_id', v_ticket.user_id, 'subject', v_ticket.subject, 'status', v_ticket.status,
        'admin_response', v_ticket.admin_response, 'responded_at', v_ticket.responded_at, 'response_edited_at', v_ticket.response_edited_at,
        'updated_at', v_ticket.updated_at, 'created_at', v_ticket.created_at, 'category_id', v_ticket.category_id),
      'isEdit', v_audit.action = 'support_ticket_reply_edit',
      'historyId', v_audit.details -> 'historyId',
      'replayed', true);
  END IF;

  IF encode(sha256(convert_to(COALESCE(v_ticket.admin_response, ''), 'UTF8')), 'hex') <> p_expected_sha256 THEN
    RAISE EXCEPTION 'SUPPORT_ANSWER_CONFLICT';
  END IF;

  PERFORM set_config('app.support_answer_write', p_ticket_id::text, true);
  IF v_ticket.admin_response IS NULL THEN
    -- 첫 답변
    UPDATE public.support_tickets
       SET admin_response = p_response,
           status = COALESCE(p_status, 'resolved'),
           responded_at = v_now,
           updated_at = v_now
     WHERE id = p_ticket_id
    RETURNING * INTO v_ticket;
    PERFORM public.record_admin_audit(p_actor_id, 'support_ticket_reply', 'support_ticket', p_ticket_id::text, v_ticket.user_id, NULL, NULL,
      jsonb_build_object('status', v_ticket.status, 'length', char_length(p_response), 'request', p_request_meta), v_key);
    v_is_edit := false;
  ELSE
    -- 수정: 사유 필수, 같은 글 거부, 상태는 그대로
    IF v_reason IS NULL OR char_length(v_reason) > 300 THEN
      RAISE EXCEPTION 'SUPPORT_ANSWER_REASON_REQUIRED';
    END IF;
    IF p_response = v_ticket.admin_response THEN
      RAISE EXCEPTION 'SUPPORT_ANSWER_UNCHANGED';
    END IF;
    v_previous := v_ticket.admin_response;
    INSERT INTO public.support_ticket_answer_revisions (ticket_id, previous_response, previous_shown_at, edited_by, reason)
    VALUES (p_ticket_id, v_previous,
            COALESCE(v_ticket.response_edited_at, v_ticket.responded_at, v_ticket.updated_at, v_ticket.created_at), p_actor_id, v_reason)
    RETURNING id INTO v_history;
    UPDATE public.support_tickets
       SET admin_response = p_response,
           response_edited_at = v_now,
           updated_at = v_now,
           redaction_reviewed_at = NULL
     WHERE id = p_ticket_id
    RETURNING * INTO v_ticket;
    PERFORM public.record_admin_audit(p_actor_id, 'support_ticket_reply_edit', 'support_ticket', p_ticket_id::text, v_ticket.user_id, NULL, NULL,
      jsonb_build_object('historyId', v_history, 'lengthBefore', char_length(v_previous), 'lengthAfter', char_length(p_response),
                         'reasonLength', char_length(v_reason), 'request', p_request_meta), v_key);
    v_is_edit := true;
  END IF;
  PERFORM set_config('app.support_answer_write', '', true);

  RETURN jsonb_build_object(
    'ticket', jsonb_build_object('id', v_ticket.id, 'user_id', v_ticket.user_id, 'subject', v_ticket.subject, 'status', v_ticket.status,
      'admin_response', v_ticket.admin_response, 'responded_at', v_ticket.responded_at, 'response_edited_at', v_ticket.response_edited_at,
      'updated_at', v_ticket.updated_at, 'created_at', v_ticket.created_at, 'category_id', v_ticket.category_id),
    'isEdit', v_is_edit,
    'historyId', v_history,
    'replayed', false);
END;
$fn_save_support_ticket_answer$;
REVOKE ALL ON FUNCTION public.save_support_ticket_answer(uuid, uuid, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_support_ticket_answer(uuid, uuid, text, text, text, text, text, jsonb) TO service_role;

-- 7. 10번 함수 재정의(4-4) — 운영 원문 그대로에 '-- [13번]' 줄만 더하거나 바꿨다. 권한(EXECUTE)은 CREATE OR REPLACE 가 그대로 둔다. ------
-- 7-1. member_withdrawal_facts: (가) 계좌 요청 시각에 이력, (나) 가림 항목 support_ticket_answer_revision, (다) v_last_ticket 에 수정 시각,
--      문의 '확인됨' 판정에 수정 시각.
CREATE OR REPLACE FUNCTION public.member_withdrawal_facts(p_user_id uuid, p_ticket_retention_agreed boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_policy jsonb := public.member_withdrawal_policy();
  v_now timestamptz := now();
  v_profile public.profiles%ROWTYPE;
  v_order_ids uuid[];
  v_order_id_texts text[];
  v_order_keys text[];
  v_mul_nos text[];
  v_paid_reasons text[] := ARRAY[]::text[];
  v_had_payment boolean;
  v_has_orders boolean;
  v_in_orders integer;
  v_in_attempts integer;
  v_in_markers integer;
  v_in_webhooks integer;
  v_in_point_refunds integer;
  v_in_market_refunds integer;
  v_in_sources integer;
  v_in_alerts integer;
  v_in_jobs integer;
  v_in_total integer;
  v_open_periods jsonb := '[]'::jsonb;
  v_unverified jsonb;
  v_redaction jsonb := '[]'::jsonb;
  v_slugs text[];
  v_keywords text[];
  v_account_at timestamptz;
  v_quiet integer := public.member_withdrawal_policy_days('selfWithdrawOrderQuietDays');
  v_buffer integer := public.member_withdrawal_policy_days('withdrawRefundDeadlineBufferDays');
  v_setting_days integer := public.point_charge_refund_days();
  v_src record;
  v_order public.payment_orders%ROWTYPE;
  v_root_created timestamptz;
  v_ack_days integer;
  v_days integer;
  v_deadline timestamptz;
  v_until timestamptz;
  v_breakdown jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_paid integer := 0;
  v_free integer := 0;
  v_expired integer := 0;
  v_cash integer := 0;
  v_cash_unknown boolean := false;
  v_is_paid boolean;
  v_value integer;
  v_last_activity timestamptz;
  v_quiet_until timestamptz;
  v_recent boolean;
  v_last_payment timestamptz;
  v_last_market timestamptz;
  v_last_ticket timestamptz;
  v_refund_tickets uuid[];
  v_ticket_count integer;
  v_pending_tickets integer;
  v_open_request uuid;
  v_has_request boolean;
  v_marketing_agreed boolean;
  v_self_enabled boolean;
  v_self_reasons text[] := ARRAY[]::text[];
  v_request_reasons text[] := ARRAY[]::text[];
  v_retain_tickets boolean;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('userId', p_user_id, 'exists', false);
  END IF;

  SELECT COALESCE(array_agg(o.id), '{}'), COALESCE(array_agg(o.id::text), '{}'), COALESCE(array_agg(o.order_id), '{}')
    INTO v_order_ids, v_order_id_texts, v_order_keys
    FROM public.payment_orders o
   WHERE o.user_id = p_user_id;
  SELECT COALESCE(array_agg(t.provider_transaction_id) FILTER (WHERE t.provider_transaction_id IS NOT NULL), '{}')
    INTO v_mul_nos
    FROM public.payment_provider_transactions t
   WHERE t.payment_order_id = ANY (v_order_ids);
  v_has_orders := cardinality(v_order_ids) > 0
    OR EXISTS (SELECT 1 FROM public.checkout_attempts a WHERE a.user_id = p_user_id);

  -- 결제 회원(had_payment)
  IF EXISTS (
    SELECT 1 FROM public.payment_orders o
     WHERE o.user_id = p_user_id
       AND (o.status IN ('completed', 'refunded', 'cancel_pending', 'fulfillment_pending', 'confirming', 'manual_review')
            OR o.approved_at IS NOT NULL
            OR o.canceled_at IS NOT NULL
            OR EXISTS (SELECT 1 FROM public.payment_history h WHERE h.payment_order_id = o.id)
            OR EXISTS (SELECT 1 FROM public.payment_provider_transactions t
                        WHERE t.payment_order_id = o.id
                          AND (t.paid_feedback_recorded_at IS NOT NULL OR t.admin_paid_confirmed_at IS NOT NULL
                               OR t.cancel_feedback_recorded_at IS NOT NULL OR t.partial_cancel_feedback_recorded_at IS NOT NULL)))
  ) THEN
    v_paid_reasons := v_paid_reasons || 'MONEY_ORDER'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_history h WHERE h.user_id = p_user_id AND h.amount > 0) THEN
    v_paid_reasons := v_paid_reasons || 'PAYMENT_HISTORY'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.credit_sources s WHERE s.user_id = p_user_id AND s.source_category = 'plan_purchase') THEN
    v_paid_reasons := v_paid_reasons || 'PLAN_PURCHASE_SOURCE'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_orders o
              WHERE o.user_id = p_user_id AND o.failure_code IN ('PAYAPP_FEEDBACK_MISMATCH', 'PAYAPP_MUL_NO_CONFLICT')) THEN
    v_paid_reasons := v_paid_reasons || 'FEEDBACK_VERIFICATION_FAILED'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_admin_actions paa WHERE paa.payment_order_id = ANY (v_order_ids)) THEN
    v_paid_reasons := v_paid_reasons || 'PAYMENT_ADMIN_ACTION'::text;
  END IF;
  v_had_payment := cardinality(v_paid_reasons) > 0;
  v_retain_tickets := v_had_payment OR p_ticket_retention_agreed IS NOT FALSE;

  -- 진행 중(종류별)
  SELECT count(*)::integer INTO v_in_orders
    FROM public.payment_orders o
   WHERE o.user_id = p_user_id AND o.status NOT IN ('completed', 'refunded', 'failed', 'expired');
  SELECT count(*)::integer INTO v_in_attempts
    FROM public.checkout_attempts a
   WHERE a.user_id = p_user_id
     AND a.status IN ('claimed', 'manual_review')
     AND ((a.payment_order_id IS NULL AND a.expires_at > v_now)
          OR EXISTS (SELECT 1 FROM public.payment_orders o
                      WHERE o.id = a.payment_order_id AND o.status NOT IN ('completed', 'refunded', 'failed', 'expired')));
  SELECT count(*)::integer INTO v_in_markers
    FROM public.payment_provider_transactions t
   WHERE t.payment_order_id = ANY (v_order_ids)
     AND ((t.cancel_feedback_recorded_at IS NOT NULL AND t.cancel_processed_at IS NULL)
          OR (t.partial_cancel_feedback_recorded_at IS NOT NULL AND t.partial_cancel_processed_at IS NULL));
  SELECT count(*)::integer INTO v_in_webhooks
    FROM public.payment_webhook_events w
   WHERE w.processing_status IN ('pending', 'failed')
     AND w.transmission_id LIKE 'payapp:%'
     AND split_part(w.transmission_id, ':', 2) = ANY (v_mul_nos);
  SELECT count(*)::integer INTO v_in_point_refunds
    FROM public.refund_requests rr
   WHERE rr.user_id = p_user_id AND rr.status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review');
  SELECT count(*)::integer INTO v_in_market_refunds
    FROM public.market_refund_requests mr
   WHERE mr.user_id = p_user_id AND mr.status = 'pending';
  SELECT count(*)::integer INTO v_in_sources
    FROM public.credit_sources s
   WHERE s.user_id = p_user_id
     AND (s.status = 'pending_refund'
          OR (s.source_category = 'system_refund'
              AND COALESCE((SELECT r.root_in_progress FROM public.credit_source_paid_root(s.id) r LIMIT 1), false)));
  SELECT count(*)::integer INTO v_in_alerts
    FROM public.payment_reconciliation_alerts a
   WHERE a.resolved_at IS NULL
     AND ((a.details ->> 'payment_order_id') = ANY (v_order_id_texts)
          OR (a.details ->> 'order_payment_order_id') = ANY (v_order_id_texts)
          OR (a.details ->> 'mul_no') = ANY (v_mul_nos)
          OR (a.details ->> 'orig_mul_no') = ANY (v_mul_nos)
          OR (a.details ->> 'order_id') = ANY (v_order_keys)
          OR (a.details ->> 'user_id') = p_user_id::text);
  SELECT count(*)::integer INTO v_in_jobs
    FROM public.generate_listboard_generation_jobs j
   WHERE j.user_id = p_user_id AND j.status IN ('queued', 'running');
  v_in_total := v_in_orders + v_in_attempts + v_in_markers + v_in_webhooks + v_in_point_refunds
    + v_in_market_refunds + v_in_sources + v_in_alerts + v_in_jobs;

  -- 크레딧(원천별, 만료 순)과 환불 기간이 남은 유료 충전 건
  FOR v_src IN
    SELECT s.id, s.source_category, s.status, s.remaining_credits, s.expires_at, s.created_at, s.payment_order_id,
           r.root_source_id, r.payment_order_id AS root_order_id
      FROM public.credit_sources s
      LEFT JOIN LATERAL (SELECT x.root_source_id, x.payment_order_id FROM public.credit_source_paid_root(s.id) x LIMIT 1) r ON true
     WHERE s.user_id = p_user_id AND s.remaining_credits > 0
     ORDER BY s.expires_at NULLS LAST, s.id
  LOOP
    v_is_paid := v_src.root_source_id IS NOT NULL OR v_src.source_category = 'plan_purchase';
    IF v_src.expires_at IS NOT NULL AND v_src.expires_at <= v_now THEN
      v_expired := v_expired + v_src.remaining_credits;
      v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
        'source_id', v_src.id, 'category', v_src.source_category, 'paid', v_is_paid, 'paid_root_id', v_src.root_source_id,
        'credits', v_src.remaining_credits, 'forfeited', 0, 'expired_cleared', v_src.remaining_credits,
        'expires_at', v_src.expires_at, 'cash_value', NULL));
    ELSE
      v_total := v_total + v_src.remaining_credits;
      v_value := NULL;
      IF v_is_paid THEN
        v_paid := v_paid + v_src.remaining_credits;
        v_value := public.point_charge_cash_value(v_src.id, v_src.remaining_credits);
        IF v_value IS NULL THEN
          v_cash_unknown := true;
        ELSE
          v_cash := v_cash + v_value;
        END IF;
      ELSE
        v_free := v_free + v_src.remaining_credits;
      END IF;
      v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
        'source_id', v_src.id, 'category', v_src.source_category, 'paid', v_is_paid, 'paid_root_id', v_src.root_source_id,
        'credits', v_src.remaining_credits, 'forfeited', v_src.remaining_credits, 'expired_cleared', 0,
        'expires_at', v_src.expires_at, 'cash_value', v_value));
    END IF;

    IF v_is_paid THEN
      -- eligibility 와 같은 식: 뿌리 주문·뿌리 원천 기준, 일수 COALESCE(GREATEST(설정, 결제 전 동의), 7)
      v_order := NULL;
      SELECT * INTO v_order FROM public.payment_orders o WHERE o.id = COALESCE(v_src.root_order_id, v_src.payment_order_id);
      SELECT c.created_at INTO v_root_created FROM public.credit_sources c WHERE c.id = COALESCE(v_src.root_source_id, v_src.id);
      v_ack_days := NULL;
      SELECT a.refund_days INTO v_ack_days
        FROM public.checkout_attempts ca
        JOIN public.point_charge_checkout_acks a
          ON a.user_id = ca.user_id AND a.checkout_attempt_id = ca.checkout_attempt_id
       WHERE ca.id = v_order.checkout_attempt_id;
      v_days := COALESCE(GREATEST(v_setting_days, v_ack_days), 7);
      v_deadline := public.point_charge_refund_deadline(GREATEST(v_order.approved_at, v_root_created), v_days);
      v_until := CASE WHEN v_deadline IS NULL OR v_buffer IS NULL THEN NULL ELSE v_deadline + make_interval(days => v_buffer) END;
      IF v_until IS NULL OR v_until > v_now THEN
        v_open_periods := v_open_periods || jsonb_build_array(jsonb_build_object(
          'sourceId', v_src.id, 'rootSourceId', COALESCE(v_src.root_source_id, v_src.id), 'paymentOrderId', v_order.id,
          'deadline', v_deadline, 'blockedUntil', v_until, 'refundDays', v_days,
          'inBuffer', v_deadline IS NOT NULL AND v_deadline <= v_now));
      END IF;
    END IF;
  END LOOP;

  -- 페이앱 요청 미확인 주문
  SELECT COALESCE(jsonb_agg(o.id ORDER BY o.created_at), '[]'::jsonb) INTO v_unverified
    FROM public.payment_orders o
    JOIN public.payment_provider_transactions t ON t.payment_order_id = o.id
   WHERE o.user_id = p_user_id
     AND o.status = 'expired'
     AND o.failure_code IN ('PAYAPP_REQUEST_OUTCOME_EXPIRED', 'PAYAPP_READY_CANCEL_FAILED')
     AND t.provider_transaction_id IS NOT NULL
     AND COALESCE(t.provider_status, '') NOT IN ('8', '16', '32');

  -- 문의
  v_slugs := ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_policy -> 'redactionRefundCategorySlugs') = 'array'
                                                         THEN v_policy -> 'redactionRefundCategorySlugs' ELSE '[]'::jsonb END));
  v_keywords := ARRAY(SELECT k FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_policy -> 'redactionAccountRequestKeywords') = 'array'
                                                                  THEN v_policy -> 'redactionAccountRequestKeywords' ELSE '[]'::jsonb END) AS k
                       WHERE btrim(k) <> '');
  -- [13번] (가) 계좌 요청 시각: 지금 답변과 답변 수정 이력(그때 회원이 보던 글·보이기 시작한 시각)을 함께 본다.
  SELECT min(x.at) INTO v_account_at
    FROM (SELECT t.responded_at AS at
            FROM public.support_tickets t
           WHERE t.user_id = p_user_id
             AND t.responded_at IS NOT NULL
             AND EXISTS (SELECT 1 FROM unnest(v_keywords) AS k WHERE strpos(COALESCE(t.admin_response, ''), k) > 0)
          UNION ALL
          SELECT ar.previous_shown_at
            FROM public.support_ticket_answer_revisions ar
            JOIN public.support_tickets t ON t.id = ar.ticket_id
           WHERE t.user_id = p_user_id
             AND EXISTS (SELECT 1 FROM unnest(v_keywords) AS k WHERE strpos(ar.previous_response, k) > 0)) x;

  SELECT count(*)::integer,
         count(*) FILTER (WHERE t.status IN ('pending', 'in_progress'))::integer,
         max(GREATEST(t.responded_at, t.response_edited_at, t.member_updated_at, t.created_at)) -- [13번] (다) 답변 수정 시각
    INTO v_ticket_count, v_pending_tickets, v_last_ticket
    FROM public.support_tickets t
   WHERE t.user_id = p_user_id;

  SELECT COALESCE(array_agg(t.id ORDER BY t.created_at), '{}') INTO v_refund_tickets
    FROM public.support_tickets t
   WHERE t.user_id = p_user_id
     AND (COALESCE(t.category_snapshot ->> 'slug', (SELECT c.slug FROM public.support_ticket_categories c WHERE c.id = t.category_id)) = ANY (v_slugs)
          OR EXISTS (SELECT 1 FROM public.market_refund_requests mr WHERE mr.support_ticket_id = t.id));

  -- 가림 확인 필요(확인 뒤 회원이 고쳤거나 답변이 달렸으면 다시 필요)
  IF v_retain_tickets THEN
    WITH tk AS (
      SELECT t.*,
             (t.id = ANY (v_refund_tickets)) AS refund_related,
             (v_account_at IS NOT NULL AND (t.created_at > v_account_at OR t.member_updated_at > v_account_at)) AS after_account,
             (t.redaction_reviewed_at IS NOT NULL
              AND t.redaction_reviewed_at >= COALESCE(GREATEST(t.member_updated_at, t.responded_at, t.response_edited_at), '-infinity'::timestamptz)) AS reviewed -- [13번] 수정 시각
        FROM public.support_tickets t
       WHERE t.user_id = p_user_id
    ), items AS (
      SELECT 'support_ticket'::text AS kind, tk.id, tk.created_at,
             left(regexp_replace(tk.subject, '\s+', ' ', 'g'), 30) AS preview,
             array_remove(ARRAY[
               CASE WHEN tk.refund_related THEN 'REFUND_RELATED' END,
               CASE WHEN tk.after_account THEN 'AFTER_ACCOUNT_REQUEST' END,
               CASE WHEN public.member_text_has_long_number(tk.subject) OR public.member_text_has_long_number(tk.message)
                         OR public.member_text_has_long_number(tk.admin_response) THEN 'LONG_NUMBER' END], NULL) AS reasons
        FROM tk
       WHERE NOT tk.reviewed
      UNION ALL
      SELECT 'support_ticket_revision', rv.id, rv.created_at,
             left(regexp_replace(COALESCE(rv.subject, ''), '\s+', ' ', 'g'), 30),
             array_remove(ARRAY[
               CASE WHEN tk.refund_related THEN 'REFUND_RELATED' END,
               CASE WHEN tk.after_account THEN 'AFTER_ACCOUNT_REQUEST' END,
               CASE WHEN public.member_text_has_long_number(rv.subject) OR public.member_text_has_long_number(rv.message) THEN 'LONG_NUMBER' END], NULL)
        FROM public.support_ticket_revisions rv
        JOIN tk ON tk.id = rv.ticket_id
       WHERE rv.redaction_reviewed_at IS NULL
      -- [13번] (나) 답변 수정 이력: 부모 문의의 환불 관련·계좌 요청 뒤, 이전 답변·수정 사유의 긴 숫자
      UNION ALL
      SELECT 'support_ticket_answer_revision', ar.id, ar.created_at,
             left(regexp_replace(COALESCE(tk.subject, ''), '\s+', ' ', 'g'), 30),
             array_remove(ARRAY[
               CASE WHEN tk.refund_related THEN 'REFUND_RELATED' END,
               CASE WHEN tk.after_account THEN 'AFTER_ACCOUNT_REQUEST' END,
               CASE WHEN public.member_text_has_long_number(ar.previous_response) OR public.member_text_has_long_number(ar.reason) THEN 'LONG_NUMBER' END], NULL)
        FROM public.support_ticket_answer_revisions ar
        JOIN tk ON tk.id = ar.ticket_id
       WHERE ar.redaction_reviewed_at IS NULL
      UNION ALL
      SELECT 'refund_request', rr.id, rr.created_at, NULL::text,
             ARRAY['LONG_NUMBER']::text[]
        FROM public.refund_requests rr
       WHERE v_had_payment
         AND rr.user_id = p_user_id
         AND (rr.redaction_reviewed_at IS NULL OR rr.redaction_reviewed_at < rr.updated_at)
         AND (public.member_text_has_long_number(rr.reason) OR public.member_text_has_long_number(rr.admin_note))
      UNION ALL
      SELECT 'market_refund_request', mr.id, mr.created_at, NULL::text,
             ARRAY['LONG_NUMBER']::text[]
        FROM public.market_refund_requests mr
       WHERE v_had_payment
         AND mr.user_id = p_user_id
         AND (mr.redaction_reviewed_at IS NULL OR mr.redaction_reviewed_at < mr.updated_at)
         AND (public.member_text_has_long_number(mr.reason) OR public.member_text_has_long_number(mr.admin_note))
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', i.kind, 'id', i.id, 'preview', i.preview, 'reasons', to_jsonb(i.reasons))
                              ORDER BY i.created_at, i.id), '[]'::jsonb)
      INTO v_redaction
      FROM items i
     WHERE cardinality(i.reasons) > 0;
  END IF;

  -- 사건 시각
  SELECT GREATEST(max(o.created_at), max(o.approved_at), max(o.canceled_at),
                  (SELECT max(a.created_at) FROM public.checkout_attempts a WHERE a.user_id = p_user_id),
                  max(t.paid_feedback_recorded_at), max(t.cancel_feedback_recorded_at),
                  max(t.partial_cancel_feedback_recorded_at), max(t.admin_paid_confirmed_at))
    INTO v_last_activity
    FROM public.payment_orders o
    LEFT JOIN public.payment_provider_transactions t ON t.payment_order_id = o.id
   WHERE o.user_id = p_user_id;
  IF v_last_activity IS NULL THEN
    SELECT max(a.created_at) INTO v_last_activity FROM public.checkout_attempts a WHERE a.user_id = p_user_id;
  END IF;
  v_quiet_until := CASE WHEN v_last_activity IS NULL THEN NULL
                        WHEN v_quiet IS NULL THEN 'infinity'::timestamptz
                        ELSE v_last_activity + make_interval(days => v_quiet) END;
  v_recent := v_quiet_until IS NOT NULL AND v_quiet_until > v_now;

  SELECT GREATEST(max(o.approved_at), max(o.canceled_at),
                  max(t.paid_feedback_recorded_at), max(t.cancel_feedback_recorded_at),
                  max(t.partial_cancel_feedback_recorded_at), max(t.admin_paid_confirmed_at),
                  (SELECT max(rr.processed_at) FROM public.refund_requests rr WHERE rr.user_id = p_user_id),
                  (SELECT max(a.created_at) FROM public.checkout_attempts a WHERE a.user_id = p_user_id))
    INTO v_last_payment
    FROM public.payment_orders o
    LEFT JOIN public.payment_provider_transactions t ON t.payment_order_id = o.id
   WHERE o.user_id = p_user_id;
  IF v_last_payment IS NULL THEN
    SELECT GREATEST((SELECT max(rr.processed_at) FROM public.refund_requests rr WHERE rr.user_id = p_user_id),
                    (SELECT max(a.created_at) FROM public.checkout_attempts a WHERE a.user_id = p_user_id))
      INTO v_last_payment;
  END IF;
  SELECT GREATEST((SELECT max(mo.created_at) FROM public.market_purchase_orders mo WHERE mo.user_id = p_user_id),
                  (SELECT max(mr.processed_at) FROM public.market_refund_requests mr WHERE mr.user_id = p_user_id))
    INTO v_last_market;

  -- 요청·마케팅·스위치
  SELECT r.id INTO v_open_request FROM public.member_withdrawal_requests r WHERE r.user_id = p_user_id AND r.status = 'pending';
  v_has_request := EXISTS (SELECT 1 FROM public.member_withdrawal_requests r WHERE r.user_id = p_user_id);
  SELECT c.agreed INTO v_marketing_agreed
    FROM public.user_consents c
    JOIN public.signup_consent_items i ON i.id = c.item_id
   WHERE c.user_id = p_user_id
     AND i.key = (v_policy ->> 'marketingConsentItemKey')
   ORDER BY c.seq DESC
   LIMIT 1;
  v_self_enabled := COALESCE((v_policy -> 'selfAnonymizeEnabled') = 'true'::jsonb, false);

  -- 스스로 익명화·결제 회원 탈퇴 요청 가능 여부와 이유
  IF v_profile.is_admin IS TRUE THEN
    v_self_reasons := v_self_reasons || 'ADMIN'::text;
    v_request_reasons := v_request_reasons || 'ADMIN'::text;
  END IF;
  IF v_profile.withdrawn_at IS NOT NULL THEN
    v_self_reasons := v_self_reasons || 'WITHDRAWN'::text;
    v_request_reasons := v_request_reasons || 'WITHDRAWN'::text;
  END IF;
  IF NOT v_self_enabled THEN
    v_self_reasons := v_self_reasons || 'DISABLED'::text;
    v_request_reasons := v_request_reasons || 'DISABLED'::text;
  END IF;
  IF v_had_payment THEN
    v_self_reasons := v_self_reasons || 'PAYER'::text;
  ELSE
    v_request_reasons := v_request_reasons || 'NOT_PAYER'::text;
  END IF;
  IF v_in_total > 0 THEN
    v_self_reasons := v_self_reasons || 'IN_PROGRESS'::text;
    v_request_reasons := v_request_reasons || 'IN_PROGRESS'::text;
  END IF;
  IF jsonb_array_length(v_open_periods) > 0 THEN
    v_self_reasons := v_self_reasons || 'REFUND_PERIOD_OPEN'::text;
    v_request_reasons := v_request_reasons || 'REFUND_PERIOD_OPEN'::text;
  END IF;
  IF jsonb_array_length(v_unverified) > 0 THEN
    v_self_reasons := v_self_reasons || 'PROVIDER_UNVERIFIED'::text;
  END IF;
  IF jsonb_array_length(v_redaction) > 0 THEN
    v_self_reasons := v_self_reasons || 'REDACTION_REQUIRED'::text;
  END IF;
  IF v_recent THEN
    v_self_reasons := v_self_reasons || 'RECENT_PAYMENT_ACTIVITY'::text;
  END IF;
  IF v_open_request IS NOT NULL THEN
    v_request_reasons := v_request_reasons || 'REQUEST_PENDING'::text;
  END IF;
  -- 원 환산을 계산할 수 없는 유료 원천(주문 없는 옛 plan_purchase 등): 화면에서는 받지 않고 대표가 결제 내역으로 금액을 확인해 처리한다.
  IF v_cash_unknown THEN
    v_self_reasons := v_self_reasons || 'CASH_VALUE_UNKNOWN'::text;
    v_request_reasons := v_request_reasons || 'CASH_VALUE_UNKNOWN'::text;
  END IF;

  RETURN jsonb_build_object(
    'userId', p_user_id,
    'exists', true,
    'isAdmin', v_profile.is_admin IS TRUE,
    'withdrawnAt', v_profile.withdrawn_at,
    'provider', v_profile.provider,
    'hadPayment', v_had_payment,
    'hadPaymentReasons', to_jsonb(v_paid_reasons),
    'hasOrdersOrAttempts', v_has_orders,
    'hasRequestHistory', v_has_request,
    'openRequestId', v_open_request,
    'ticketCount', v_ticket_count,
    'pendingTicketCount', v_pending_tickets,
    'ticketRetentionAgreed', p_ticket_retention_agreed,
    'inProgress', jsonb_build_object(
      'orders', v_in_orders, 'attempts', v_in_attempts, 'cancelMarkers', v_in_markers, 'webhookEvents', v_in_webhooks,
      'pointRefunds', v_in_point_refunds, 'marketRefunds', v_in_market_refunds, 'pendingSources', v_in_sources,
      'alerts', v_in_alerts, 'generationJobs', v_in_jobs),
    'inProgressTotal', v_in_total,
    'refundPeriodOpen', v_open_periods,
    'providerUnverified', v_unverified,
    'redactionRequired', v_redaction,
    'refundTicketIds', to_jsonb(v_refund_tickets),
    'lastPaymentActivityAt', v_last_activity,
    'quietUntil', v_quiet_until,
    'lastPaymentEventAt', v_last_payment,
    'lastMarketEventAt', v_last_market,
    'lastTicketEventAt', v_last_ticket,
    'balance', jsonb_build_object(
      'spendable', (public.get_credit_balance_snapshot(p_user_id) ->> 'spendable_balance')::integer,
      'forfeitTotal', v_total, 'forfeitPaid', v_paid, 'forfeitFree', v_free, 'expired', v_expired,
      'paidCashValue', v_cash, 'paidCashValueUnknown', v_cash_unknown, 'breakdown', v_breakdown),
    'marketingAgreed', COALESCE(v_marketing_agreed, false),
    'selfAnonymizeEnabled', v_self_enabled,
    'fullDeleteAllowed', v_profile.is_admin IS NOT TRUE AND v_profile.withdrawn_at IS NULL AND NOT v_had_payment
                         AND NOT v_has_orders AND NOT v_has_request
                         AND (v_ticket_count = 0 OR p_ticket_retention_agreed IS FALSE),
    'selfAllowed', cardinality(v_self_reasons) = 0,
    'selfReasons', to_jsonb(v_self_reasons),
    'requestAllowed', cardinality(v_request_reasons) = 0,
    'requestReasons', to_jsonb(v_request_reasons)
  );
END;
$function$
;

-- 7-2. redact_member_text: 대상 종류 support_ticket_answer_revision(칸 previous_response·reason), 관리자 이벤트 가림은 부모 문의 기준.
CREATE OR REPLACE FUNCTION public.redact_member_text(p_actor_id uuid, p_target_kind text, p_target_id uuid, p_field text, p_target_text text, p_operation_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mask text := NULLIF(btrim(public.member_withdrawal_policy() -> 'texts' ->> 'redactionMask'), '');
  v_table text;
  v_user uuid;
  v_value text;
  v_ref_table text;
  v_ref_id uuid;
  v_occurrences integer;
  v_events integer;
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  IF p_target_id IS NULL OR p_target_text IS NULL OR btrim(p_target_text) = '' OR length(p_target_text) > 2000
     OR NULLIF(btrim(p_operation_key), '') IS NULL OR length(p_operation_key) > 200
     OR NOT ((p_target_kind = 'support_ticket' AND p_field IN ('subject', 'message', 'admin_response'))
             OR (p_target_kind = 'support_ticket_revision' AND p_field IN ('subject', 'message'))
             OR (p_target_kind = 'support_ticket_answer_revision' AND p_field IN ('previous_response', 'reason')) -- [13번]
             OR (p_target_kind IN ('refund_request', 'market_refund_request') AND p_field IN ('reason', 'admin_note'))) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  IF v_mask IS NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_POLICY_UNAVAILABLE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_audit_log a WHERE a.action = 'member_text_redact' AND a.request_id = p_operation_key) THEN
    RETURN jsonb_build_object('redacted', true, 'replay', true);
  END IF;

  v_table := CASE p_target_kind WHEN 'support_ticket' THEN 'support_tickets' WHEN 'support_ticket_revision' THEN 'support_ticket_revisions'
                                WHEN 'support_ticket_answer_revision' THEN 'support_ticket_answer_revisions' -- [13번]
                                WHEN 'refund_request' THEN 'refund_requests' ELSE 'market_refund_requests' END;
  IF p_target_kind = 'support_ticket_revision' THEN
    SELECT t.user_id, t.id INTO v_user, v_ref_id
      FROM public.support_ticket_revisions rv JOIN public.support_tickets t ON t.id = rv.ticket_id
     WHERE rv.id = p_target_id;
    v_ref_table := 'support_tickets';
    EXECUTE format('SELECT %I FROM public.support_ticket_revisions WHERE id = $1 FOR UPDATE', p_field) INTO v_value USING p_target_id;
  -- [13번] 답변 수정 이력: 관리자 이벤트 가림은 수정 이력처럼 부모 문의 기준
  ELSIF p_target_kind = 'support_ticket_answer_revision' THEN
    SELECT t.user_id, t.id INTO v_user, v_ref_id
      FROM public.support_ticket_answer_revisions ar JOIN public.support_tickets t ON t.id = ar.ticket_id
     WHERE ar.id = p_target_id;
    v_ref_table := 'support_tickets';
    EXECUTE format('SELECT %I FROM public.support_ticket_answer_revisions WHERE id = $1 FOR UPDATE', p_field) INTO v_value USING p_target_id;
  ELSE
    EXECUTE format('SELECT user_id, %I FROM public.%I WHERE id = $1 FOR UPDATE', p_field, v_table) INTO v_user, v_value USING p_target_id;
    v_ref_table := v_table;
    v_ref_id := p_target_id;
  END IF;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'MEMBER_REDACTION_TARGET_NOT_FOUND';
  END IF;
  IF v_value IS NULL OR strpos(v_value, p_target_text) = 0 THEN
    RAISE EXCEPTION 'MEMBER_REDACTION_TEXT_NOT_FOUND';
  END IF;
  v_occurrences := (length(v_value) - length(replace(v_value, p_target_text, ''))) / length(p_target_text);

  PERFORM set_config('app.member_withdrawal_bypass', v_user::text, true);
  EXECUTE format('UPDATE public.%I SET %I = replace(%I, $1, $2), redaction_reviewed_at = clock_timestamp() WHERE id = $3',
                 v_table, p_field, p_field)
    USING p_target_text, v_mask, p_target_id;

  UPDATE public.admin_events e
     SET title = replace(e.title, p_target_text, v_mask),
         body = replace(e.body, p_target_text, v_mask)
   WHERE ((e.ref_table = v_ref_table AND e.ref_id = v_ref_id)
          OR (e.ref_table = 'admin_events'
              AND e.ref_id IN (SELECT x.id FROM public.admin_events x WHERE x.ref_table = v_ref_table AND x.ref_id = v_ref_id)))
     AND (strpos(e.title, p_target_text) > 0 OR strpos(COALESCE(e.body, ''), p_target_text) > 0);
  GET DIAGNOSTICS v_events = ROW_COUNT;

  PERFORM public.record_admin_audit(p_actor_id, 'member_text_redact', p_target_kind, p_target_id::text, v_user, NULL, NULL,
    jsonb_build_object('field', p_field, 'length', length(p_target_text), 'occurrences', v_occurrences, 'admin_events', v_events),
    p_operation_key);

  RETURN jsonb_build_object('redacted', true, 'occurrences', v_occurrences, 'adminEventsUpdated', v_events);
END;
$function$
;

-- 7-3. mark_member_text_reviewed: 대상 종류 support_ticket_answer_revision 만 더함.
CREATE OR REPLACE FUNCTION public.mark_member_text_reviewed(p_actor_id uuid, p_target_kind text, p_target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_table text;
  v_user uuid;
  v_at timestamptz := clock_timestamp();
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  IF p_target_id IS NULL OR p_target_kind IS NULL
     OR p_target_kind NOT IN ('support_ticket', 'support_ticket_revision', 'support_ticket_answer_revision', 'refund_request', 'market_refund_request') THEN -- [13번]
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  v_table := CASE p_target_kind WHEN 'support_ticket' THEN 'support_tickets' WHEN 'support_ticket_revision' THEN 'support_ticket_revisions'
                                WHEN 'support_ticket_answer_revision' THEN 'support_ticket_answer_revisions' -- [13번]
                                WHEN 'refund_request' THEN 'refund_requests' ELSE 'market_refund_requests' END;
  IF p_target_kind = 'support_ticket_revision' THEN
    SELECT t.user_id INTO v_user FROM public.support_ticket_revisions rv JOIN public.support_tickets t ON t.id = rv.ticket_id WHERE rv.id = p_target_id;
  ELSIF p_target_kind = 'support_ticket_answer_revision' THEN -- [13번]
    SELECT t.user_id INTO v_user FROM public.support_ticket_answer_revisions ar JOIN public.support_tickets t ON t.id = ar.ticket_id WHERE ar.id = p_target_id;
  ELSE
    EXECUTE format('SELECT user_id FROM public.%I WHERE id = $1 FOR UPDATE', v_table) INTO v_user USING p_target_id;
  END IF;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'MEMBER_REDACTION_TARGET_NOT_FOUND';
  END IF;
  PERFORM set_config('app.member_withdrawal_bypass', v_user::text, true);
  EXECUTE format('UPDATE public.%I SET redaction_reviewed_at = $1 WHERE id = $2', v_table) USING v_at, p_target_id;
  PERFORM public.record_admin_audit(p_actor_id, 'member_text_reviewed', p_target_kind, p_target_id::text, v_user, NULL, NULL, '{}'::jsonb, NULL);
  RETURN jsonb_build_object('reviewed', true, 'reviewedAt', v_at);
END;
$function$
;

-- 7-4. read_withdrawn_member_ticket: 결과에 answerRevisions(답변 수정 이력) 더함.
CREATE OR REPLACE FUNCTION public.read_withdrawn_member_ticket(p_actor_id uuid, p_ticket_id uuid, p_reason text, p_request_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  IF NULLIF(btrim(p_reason), '') IS NULL OR length(p_reason) > 500
     OR (p_request_meta IS NOT NULL AND jsonb_typeof(p_request_meta) <> 'object') THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_ticket.user_id AND p.withdrawn_at IS NOT NULL) THEN
    RAISE EXCEPTION 'MEMBER_NOT_WITHDRAWN';
  END IF;
  PERFORM public.record_admin_audit(p_actor_id, 'withdrawn_record_view', 'support_ticket', p_ticket_id::text, v_ticket.user_id,
    NULL, p_reason, jsonb_build_object('kind', 'ticket', 'request', COALESCE(p_request_meta, '{}'::jsonb)), NULL);
  RETURN to_jsonb(v_ticket) || jsonb_build_object('revisions', (
    SELECT COALESCE(jsonb_agg(to_jsonb(rv) ORDER BY rv.written_at), '[]'::jsonb)
      FROM public.support_ticket_revisions rv WHERE rv.ticket_id = p_ticket_id),
    -- [13번] 답변 수정 이력(그때 회원이 보던 글·수정 사유)
    'answerRevisions', (
    SELECT COALESCE(jsonb_agg(to_jsonb(ar) ORDER BY ar.created_at, ar.id), '[]'::jsonb)
      FROM public.support_ticket_answer_revisions ar WHERE ar.ticket_id = p_ticket_id));
END;
$function$
;

-- [13번 M1] 끝 ------------------------------------------------------------------------------------------------

-- 8. VERIFY ---------------------------------------------------------------------------------------------------------
DO $verify_bundle13_cs_tools$
DECLARE
  v_rel text;
  v_fn text;
  v_value jsonb;
  v_key text;
  -- 회원 화면 필수 키(10-1 표 '필수', 코드 SUPPORT_PAGE_REQUIRED_KEYS 와 같은 목록·순서 — 계약 시험이 대조)
  v_required text[] := ARRAY[
    'pageTitle', 'formTitle', 'historyTitle', 'emptyTitle', 'categoryLabel', 'categoryPlaceholder', 'subjectLabel', 'messageLabel',
    'submitLabel', 'submittingLabel', 'uncategorizedLabel', 'editCategoryLabel', 'editSubjectLabel', 'editMessageLabel',
    'editSubjectPlaceholder', 'editMessagePlaceholder', 'cancelLabel', 'saveEditLabel', 'editIconTitle', 'deleteIconTitle',
    'needCategoryToast', 'needContentToast', 'deletedToast', 'updatedToast', 'submittedTitle', 'submittedDescription',
    'deleteConfirmTitle', 'deleteConfirmDescription', 'deleteConfirmLabel', 'submitFailedToast', 'updateFailedToast', 'deleteFailedToast',
    'answerLabel', 'answerCreatedNotificationTitle', 'answerCreatedNotificationMessage', 'answerEditedNotificationTitle',
    'answerEditedNotificationMessage'];
  v_optional text[] := ARRAY[
    'pageDescription', 'formNotice', 'responseTimeNote', 'defaultCategoryHelp', 'historyIntro', 'emptyDescription',
    'defaultSubjectPlaceholder', 'defaultMessagePlaceholder', 'answerEditedLabel'];
BEGIN
  -- 답변 이력: RLS·정책 0·service_role SELECT 만·가드 2개
  v_rel := 'public.support_ticket_answer_revisions';
  IF to_regclass(v_rel) IS NULL OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass(v_rel))
     OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = to_regclass(v_rel))
     OR NOT has_table_privilege('service_role', v_rel, 'SELECT')
     OR has_table_privilege('service_role', v_rel, 'INSERT') OR has_table_privilege('service_role', v_rel, 'UPDATE')
     OR has_table_privilege('service_role', v_rel, 'DELETE') OR has_table_privilege('service_role', v_rel, 'TRUNCATE')
     OR has_table_privilege('anon', v_rel, 'SELECT') OR has_table_privilege('authenticated', v_rel, 'SELECT')
     OR has_table_privilege('authenticated', v_rel, 'INSERT') OR has_table_privilege('authenticated', v_rel, 'UPDATE') THEN
    RAISE EXCEPTION 'VERIFY: answer revisions table / RLS / privileges';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = to_regclass(v_rel) AND NOT t.tgisinternal AND t.tgenabled = 'O'
       AND t.tgname IN ('guard_support_ticket_answer_revisions_mutation', 'guard_support_ticket_answer_revisions_truncate')) <> 2 THEN
    RAISE EXCEPTION 'VERIFY: answer revisions guard triggers';
  END IF;

  -- 템플릿: RLS·SELECT 정책 1개(support.manage)·anon 없음·authenticated SELECT 만·service_role 은 DELETE 없음·첫 값 14개
  v_rel := 'public.support_reply_templates';
  IF to_regclass(v_rel) IS NULL OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass(v_rel))
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_reply_templates') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_reply_templates'
                     AND policyname = 'support_reply_templates_admin_select' AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'
                     AND roles = '{authenticated}' AND qual LIKE '%has_admin_permission(''support.manage''::text)%')
     OR has_table_privilege('anon', v_rel, 'SELECT')
     OR NOT has_table_privilege('authenticated', v_rel, 'SELECT')
     OR has_table_privilege('authenticated', v_rel, 'INSERT') OR has_table_privilege('authenticated', v_rel, 'UPDATE')
     OR has_table_privilege('authenticated', v_rel, 'DELETE')
     OR NOT has_table_privilege('service_role', v_rel, 'INSERT') OR NOT has_table_privilege('service_role', v_rel, 'UPDATE')
     OR has_table_privilege('service_role', v_rel, 'DELETE') OR has_table_privilege('service_role', v_rel, 'TRUNCATE') THEN
    RAISE EXCEPTION 'VERIFY: reply templates table / policy / privileges';
  END IF;
  IF (SELECT count(*) FROM public.support_reply_templates WHERE created_by IS NULL AND revision = 1) <> 14
     OR EXISTS (SELECT 1 FROM public.support_reply_templates WHERE body ~ '써머썬|[^○]○[^○]|^○[^○]|[^○]○$') THEN
    RAISE EXCEPTION 'VERIFY: reply template seed';
  END IF;

  -- 설정 행: revision·필수 키(비지 않은 글)·선택 키(글)·관리자 값
  SELECT value INTO v_value FROM public.system_settings WHERE key = 'support_page_content';
  IF v_value IS NULL OR jsonb_typeof(v_value -> 'revision') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_value -> 'member') IS DISTINCT FROM 'object' OR jsonb_typeof(v_value -> 'admin') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'VERIFY: support_page_content shape';
  END IF;
  FOREACH v_key IN ARRAY v_required LOOP
    IF jsonb_typeof(v_value -> 'member' -> v_key) IS DISTINCT FROM 'string' OR btrim(v_value -> 'member' ->> v_key) = '' THEN
      RAISE EXCEPTION 'VERIFY: support_page_content required member key %', v_key;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY v_optional LOOP
    IF jsonb_typeof(v_value -> 'member' -> v_key) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'VERIFY: support_page_content optional member key %', v_key;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_object_keys(v_value -> 'member')) <> cardinality(v_required) + cardinality(v_optional)
     OR btrim(COALESCE(v_value -> 'admin' ->> 'templateBlankMarker', '')) = ''
     OR jsonb_typeof(v_value -> 'admin' -> 'answerEditReasonGuide') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_value -> 'admin' -> 'notifyOnAnswerEdit') IS DISTINCT FROM 'boolean'
     OR (v_value -> 'admin' -> 'accessLogRetentionYears') IS DISTINCT FROM '2'::jsonb THEN
    RAISE EXCEPTION 'VERIFY: support_page_content keys / admin values';
  END IF;

  -- 함수: 저장 함수는 service_role 만, 트리거 함수는 아무도. 모두 search_path 고정.
  v_fn := 'public.save_support_ticket_answer(uuid,uuid,text,text,text,text,text,jsonb)';
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS NOT TRUE THEN
    RAISE EXCEPTION 'VERIFY: save_support_ticket_answer EXECUTE / SECURITY DEFINER';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY['public.guard_support_category_slug()', 'public.guard_support_ticket_answer_revisions_mutation()'] LOOP
    IF has_function_privilege('service_role', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'VERIFY: % must not be executable by API roles', v_fn;
    END IF;
  END LOOP;
  IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.guard_support_category_slug()'::regprocedure) IS NOT TRUE THEN
    RAISE EXCEPTION 'VERIFY: guard_support_category_slug must be SECURITY DEFINER';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY['public.save_support_ticket_answer(uuid,uuid,text,text,text,text,text,jsonb)', 'public.guard_support_category_slug()',
                              'public.guard_support_ticket_answer_revisions_mutation()'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND 'search_path=public, pg_temp' = ANY (p.proconfig)) THEN
      RAISE EXCEPTION 'VERIFY: % search_path', v_fn;
    END IF;
  END LOOP;

  -- 재정의 4개: 본문 md5(prosrc)(로컬 계산 값)와 anonymize_member 그대로
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.member_withdrawal_facts(uuid,boolean)'::regprocedure) IS DISTINCT FROM '15147d898bdd615963fd7173e154d9f5'
     OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure) IS DISTINCT FROM '7ddf1b9245c429205af6b36fa01bfb21'
     OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.mark_member_text_reviewed(uuid,text,uuid)'::regprocedure) IS DISTINCT FROM '1284e5d70af808bb2b949432d92e255b'
     OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.read_withdrawn_member_ticket(uuid,uuid,text,jsonb)'::regprocedure) IS DISTINCT FROM 'ba416c661c7e9fb4c036c8516cd85d2c' THEN
    RAISE EXCEPTION 'VERIFY: bundle 10 redefinitions body';
  END IF;
  IF md5(pg_get_functiondef('public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)'::regprocedure))
     <> '1346d870d3623abae580a011b0484339' THEN
    RAISE EXCEPTION 'VERIFY: anonymize_member changed';
  END IF;
END;
$verify_bundle13_cs_tools$;

-- 기존 표에 거는 것(칸·FK·slug 트리거) 검사는 이름 붙인 별도 블록이다(리허설 light 사본은 이 DDL 과 이 블록을 뺀다).

NOTIFY pgrst, 'reload schema';


-- ===== 적용 직후: 관리자 역할(거래 안에서만), 다시 적용 거절, 함수 지문(구현 메모용) =====
DO $rh_after_apply$
DECLARE
  v_r text;
BEGIN
  UPDATE public.profiles SET is_admin = true, admin_role = 'owner' WHERE id = pg_temp.uid('owner');
  UPDATE public.profiles SET is_admin = true, admin_role = 'staff' WHERE id = pg_temp.uid('staff');
  PERFORM pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_m0')), 'ERR PRECHECK: admin_member_access_log already exists', 'A', 'M0 다시 적용 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_m1')), 'ERR PRECHECK:', 'A', 'M1 다시 적용 거절');
  INSERT INTO _rh_log (test, msg, payload)
  SELECT 'A', '적용 뒤 함수 지문(md5(pg_get_functiondef))', jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)))
    FROM pg_proc p
   WHERE (p.pronamespace = 'public'::regnamespace AND p.proname IN (
     'record_admin_member_access', 'guard_admin_member_access_log_mutation', 'save_support_ticket_answer',
     'guard_support_ticket_answer_revisions_mutation', 'guard_support_category_slug', 'guard_support_ticket_answer_write',
     'member_withdrawal_facts', 'redact_member_text', 'mark_member_text_reviewed', 'read_withdrawn_member_ticket', 'anonymize_member'))
      OR p.pronamespace = to_regnamespace('private');
  INSERT INTO _rh_log (test, msg, payload)
  SELECT 'A', '재정의 4개 본문 md5(prosrc)', jsonb_object_agg(s, pg_temp.md5_src(s))
    FROM unnest(ARRAY['public.member_withdrawal_facts(uuid,boolean)', 'public.redact_member_text(uuid,text,uuid,text,text,text)',
                      'public.mark_member_text_reviewed(uuid,text,uuid)', 'public.read_withdrawn_member_ticket(uuid,uuid,text,jsonb)']) s;
  PERFORM pg_temp.expect(pg_temp.md5_def('public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)'),
    '1346d870d3623abae580a011b0484339', 'A', 'anonymize_member 지문 그대로');
END
$rh_after_apply$;

DO $rh_e$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_t uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.access(v_owner, 'users.detail', ARRAY[v_e], ARRAY['email', 'phone']), 'OK', 'E', '대표 기록');
    v_log := v_log || pg_temp.expect(pg_temp.access(v_staff, 'support.list', ARRAY[v_e, v_a], ARRAY['email'], '확인 사유'), 'OK', 'E', '직원 기록(사유 있음)');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.admin_member_access_log WHERE created_at >= now()) = 2
      AND (SELECT actor_role FROM public.admin_member_access_log WHERE actor_id = v_owner AND created_at >= now()) = 'owner'
      AND (SELECT actor_role FROM public.admin_member_access_log WHERE actor_id = v_staff AND created_at >= now()) = 'staff'
      AND (SELECT ip = '203.0.113.13' AND user_agent = 'rh13' AND reason = '확인 사유' AND context = '{"ticketId": "rh13"}'::jsonb
             FROM public.admin_member_access_log WHERE actor_id = v_staff AND created_at >= now()),
      'E', '2행·actor_role·IP·기기·사유·context');
    v_log := v_log || pg_temp.expect(pg_temp.access(v_e, 'users.detail', ARRAY[v_a], ARRAY['email']), 'ERR ADMIN_MEMBER_ACCESS_ACTOR_INVALID', 'E', '관리자가 아닌 행위자 거절');
    v_log := v_log || pg_temp.expect(pg_temp.access(v_owner, 'users.detail', ARRAY[]::uuid[], ARRAY['email']), 'ERR ADMIN_MEMBER_ACCESS_INPUT_INVALID', 'E', '빈 배열 거절');
    v_log := v_log || pg_temp.expect(pg_temp.access(v_owner, 'users.list', ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 201)), ARRAY['email']),
      'ERR ADMIN_MEMBER_ACCESS_INPUT_INVALID', 'E', '201개 거절');
    v_log := v_log || pg_temp.expect(pg_temp.access(v_owner, 'users.list', ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 200)), ARRAY['email']),
      'OK', 'E', '200개 받음');
    v_log := v_log || pg_temp.expect(pg_temp.access(v_owner, 'users.list', ARRAY[v_e, v_e], ARRAY['email']), 'ERR ADMIN_MEMBER_ACCESS_INPUT_INVALID', 'E', '중복 거절');
    v_log := v_log || pg_temp.expect(pg_temp.access(v_owner, 'Users List', ARRAY[v_e], ARRAY['email']), 'ERR ADMIN_MEMBER_ACCESS_INPUT_INVALID', 'E', '화면 키 형식 거절');
    v_log := v_log || pg_temp.expect(pg_temp.access(v_owner, 'users.list', ARRAY[v_e], ARRAY['email'], repeat('가', 201)), 'ERR ADMIN_MEMBER_ACCESS_INPUT_INVALID', 'E', '사유 201자 거절');
    -- 추가 전용: postgres(소유자)도 트리거가 막고, service_role 은 권한부터 없다
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('UPDATE public.admin_member_access_log SET reason = NULL'), 'ERR ADMIN_MEMBER_ACCESS_LOG_APPEND_ONLY', 'E', 'UPDATE 거부(소유자)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('DELETE FROM public.admin_member_access_log'), 'ERR ADMIN_MEMBER_ACCESS_LOG_APPEND_ONLY', 'E', 'DELETE 거부(소유자)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('TRUNCATE public.admin_member_access_log'), 'ERR ADMIN_MEMBER_ACCESS_LOG_APPEND_ONLY', 'E', 'TRUNCATE 거부(소유자)');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role', 'WITH d AS (DELETE FROM public.admin_member_access_log RETURNING 1) SELECT count(*)::text FROM d'),
      'ERR', 'E', 'service_role DELETE 거부');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role', 'WITH d AS (UPDATE public.admin_member_access_log SET reason = NULL RETURNING 1) SELECT count(*)::text FROM d'),
      'ERR', 'E', 'service_role UPDATE 거부');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role', 'SELECT count(*)::text FROM public.admin_member_access_log'), 'OK', 'E', 'service_role 조회는 됨');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', 'SELECT count(*)::text FROM public.admin_member_access_log'), 'ERR', 'E', '대표 세션도 조회 불가');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'anon', 'SELECT count(*)::text FROM public.admin_member_access_log'), 'ERR', 'E', 'anon 조회 불가');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated',
      format('SELECT public.record_admin_member_access(%L, %L, ARRAY[%L]::uuid[], ARRAY[%L])::text', v_owner, 'users.detail', v_e, 'email')),
      'ERR', 'E', 'authenticated 는 기록 함수를 부를 수 없음');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'E', m FROM unnest(v_log) m;
END
$rh_e$;

DO $rh_t$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_t uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.support_reply_templates) = 14
      AND (SELECT count(*) FROM public.support_reply_templates WHERE category_id IS NOT NULL) = 9
      AND NOT EXISTS (SELECT 1 FROM public.support_reply_templates WHERE body LIKE '%써머썬%' OR body LIKE '%7일%'), 'T', '템플릿 14개·카테고리 9개 연결·사이트 이름·30일');
    v_log := v_log || pg_temp.ensure((SELECT value #>> '{admin,accessLogRetentionYears}' FROM public.system_settings WHERE key = 'support_page_content') = '2'
      AND (SELECT value #>> '{admin,templateBlankMarker}' FROM public.system_settings WHERE key = 'support_page_content') = '○○'
      AND (SELECT (value -> 'revision')::integer FROM public.system_settings WHERE key = 'support_page_content') = 1,
      'T', '문구 행: 보관 2년(10번 스크립트 대조 값)·빈칸 표시·revision 1');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['support.manage']), 'OK', 'T', '직원에게 support.manage');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_staff, 'authenticated', 'SELECT count(*)::text FROM public.support_reply_templates'), 'OK 14', 'T', '문의 권한 직원 세션 14');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', 'SELECT count(*)::text FROM public.support_reply_templates'), 'OK 14', 'T', '대표 세션 14');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_staff, 'authenticated',
      'WITH u AS (UPDATE public.support_reply_templates SET title = title RETURNING 1) SELECT count(*)::text FROM u'), 'ERR', 'T', '직원 세션 UPDATE 불가(권한 없음)');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['members.view']), 'OK', 'T', 'support.manage 회수');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_staff, 'authenticated', 'SELECT count(*)::text FROM public.support_reply_templates'), 'OK 0', 'T', '문의 권한 없는 직원 0');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_e, 'authenticated', 'SELECT count(*)::text FROM public.support_reply_templates'), 'OK 0', 'T', '회원 0');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'anon', 'SELECT count(*)::text FROM public.support_reply_templates'), 'ERR', 'T', 'anon 권한 없음');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'T', m FROM unnest(v_log) m;
END
$rh_t$;

DO $rh_c_light$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_t uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
BEGIN
  BEGIN

    v_t := pg_temp.new_ticket(v_e, 'account');
    INSERT INTO public.support_ticket_answer_revisions (ticket_id, previous_response, previous_shown_at, edited_by, reason)
    VALUES (v_t, '이전 답변 01012345678', now(), v_owner, '번호 고침 1234567890') RETURNING id INTO v_id;
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.support_ticket_answer_revisions SET reason = %L WHERE id = %L', 'x', v_id)),
      'ERR SUPPORT_ANSWER_REVISIONS_APPEND_ONLY', 'C', '이력 UPDATE 거부(가림 거래 아님)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('DELETE FROM public.support_ticket_answer_revisions WHERE id = %L', v_id)),
      'ERR SUPPORT_ANSWER_REVISIONS_APPEND_ONLY', 'C', '이력 DELETE 거부(부모 있음)');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.redact_member_text(%L, %L, %L, %L, %L, %L)', v_owner, 'support_ticket_answer_revision', v_id,
      'previous_response', '01012345678', 'rh13-c-1')), 'OK', 'C', '이전 답변 가림');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.redact_member_text(%L, %L, %L, %L, %L, %L)', v_owner, 'support_ticket_answer_revision', v_id,
      'reason', '1234567890', 'rh13-c-2')), 'OK', 'C', '수정 사유 가림');
    v_log := v_log || pg_temp.ensure((SELECT previous_response NOT LIKE '%01012345678%' AND reason NOT LIKE '%1234567890%' AND redaction_reviewed_at IS NOT NULL
      FROM public.support_ticket_answer_revisions WHERE id = v_id), 'C', '가린 글·확인 시각');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.redact_member_text(%L, %L, %L, %L, %L, %L)', v_owner, 'support_ticket_answer_revision', v_id,
      'subject', '이전', 'rh13-c-3')), 'ERR MEMBER_WITHDRAW_INPUT_INVALID', 'C', '없는 칸 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.mark_member_text_reviewed(%L, %L, %L)', v_owner, 'support_ticket_answer_revision', v_id)),
      'OK', 'C', '확인 표시');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.mark_member_text_reviewed(%L, %L, %L)', v_staff, 'support_ticket_answer_revision', v_id)),
      'ERR', 'C', '직원 확인 표시 거절(대표만)');
    PERFORM set_config('app.member_withdrawal_bypass', v_e::text, true);
    UPDATE public.profiles SET withdrawn_at = now() WHERE id = v_e;
    PERFORM set_config('app.member_withdrawal_bypass', '', true);
    v_r := pg_temp.try_json(format('SELECT public.read_withdrawn_member_ticket(%L, %L, %L, %L::jsonb)', v_owner, v_t, '시험 열람', '{"ip": "203.0.113.13", "user_agent": "rh13"}'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'C', '탈퇴 회원 문의 열람');
    v_log := v_log || pg_temp.ensure(jsonb_array_length(pg_temp.res(v_r) -> 'answerRevisions') = 1
      AND pg_temp.res(v_r) #>> '{answerRevisions,0,id}' = v_id::text, 'C', '열람 결과에 answerRevisions 1건');
    v_log := v_log || 'light: 저장 함수·facts·익명화는 칸(response_edited_at)이 있는 b_full 에서 본다'::text;
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'C', m FROM unnest(v_log) m;
END
$rh_c_light$;

DO $rh_leftover$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_t uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.admin_member_access_log) = 0
      AND (SELECT count(*) FROM public.support_ticket_answer_revisions) = 0, 'Z', '경우 밖에 남은 열람 기록·답변 이력 0(ROLLBACK 전)');
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
