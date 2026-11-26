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
