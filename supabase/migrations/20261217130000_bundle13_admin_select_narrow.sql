-- 출시 전 작업 순서표 13번 묶음 M3: 탈퇴 가림 정책을 판정 함수로 바꾸고 관리자 조회를 좁힌다(계획 docs/plan-bundle13-cs-tools.md 3판, 4-6, Q14 가·가-2·가-3).
-- 코드 배포 뒤에만 적용한다(15절 7단계). 적용하는 사람은 아래 c_code_deployed 를 true 로 바꿔야 한다:
--   12-1 '세션으로 profiles 를 읽는 형태 전수 시험'(tests/bundle13-cs-tools-contract.test.mjs)이 통과한 커밋이 운영에 배포됐다는 확인이다.
-- 순서(한 거래 안):
--   1. private 스키마(DB API 에 열리지 않음)에 판정 함수 2개 — SECURITY DEFINER·STABLE·search_path 고정, 소유자 postgres.
--      USAGE·EXECUTE 는 authenticated·service_role 만(정책 식에서 부르려면 부르는 역할에 권한이 있어야 한다). PUBLIC·anon 은 회수.
--   2. 탈퇴 가림 RESTRICTIVE 정책 4개의 식만 ALTER POLICY 로 바꾼다(이름·RESTRICTIVE·명령·역할 그대로). 이제 판정이 부른 사람의
--      profiles 조회 권한과 상관없다 — 다음 단계에서 profiles 를 좁혀도 직원에게 탈퇴 회원 기록이 보이지 않는다.
--   3. 조회 정책 3개를 ALTER POLICY 로 좁힌다: profiles 관리자 조회 → is_owner(), 문의 관리자 조회 → support.manage,
--      다운로드 기록(회원 IP) 관리자 조회 → is_owner().
-- 남는 한계(14절): 주문·충전 환불·자료 환불 행은 여전히 is_admin() 으로 조회된다(회원 id·금액·사유, 이메일 없음).
-- 잠금: 정책을 바꾸는 표 6개(profiles·support_tickets·support_ticket_revisions·refund_requests·market_refund_requests·market_download_events)에
--   ACCESS EXCLUSIVE(짧게). lock_timeout 3초면 전체 취소.
-- 되돌리기: supabase/rollback/20261217130000_bundle13_admin_select_narrow_down.sql(가장 먼저 되돌린다 — 4-7).
--   CS 계정을 발급한 뒤에 되돌리면, 다시 적용할 때까지 직원 계정의 문의·회원 조회 권한을 회수한다(런북 10-10).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 0. 사전 점검 -----------------------------------------------------------------------------------------------------
DO $precheck_bundle13_select_narrow$
DECLARE
  c_code_deployed constant boolean := false;
  -- 탈퇴 가림 정책 4개의 지금 식(10번 20261126100000 3-6 이 만든 식, pg_get_expr 를 공백 하나로 줄인 글)
  v_hidden text[][] := ARRAY[
    ARRAY['support_tickets', 'support_tickets_withdrawn_hidden', 'ALL',
      '(NOT (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = support_tickets.user_id) AND (p.withdrawn_at IS NOT NULL)))))'],
    ARRAY['market_refund_requests', 'market_refund_requests_withdrawn_hidden', 'SELECT',
      '(NOT (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = market_refund_requests.user_id) AND (p.withdrawn_at IS NOT NULL)))))'],
    ARRAY['refund_requests', 'refund_requests_withdrawn_hidden', 'SELECT',
      '(NOT (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = refund_requests.user_id) AND (p.withdrawn_at IS NOT NULL)))))'],
    ARRAY['support_ticket_revisions', 'support_ticket_revisions_withdrawn_hidden', 'SELECT',
      '(NOT (EXISTS ( SELECT 1 FROM (support_tickets t JOIN profiles p ON ((p.id = t.user_id))) WHERE ((t.id = support_ticket_revisions.ticket_id) AND (p.withdrawn_at IS NOT NULL)))))']
  ];
  -- 좁힐 조회 정책 3개의 지금 모양(표, 이름, 역할)
  v_narrow text[][] := ARRAY[
    ARRAY['profiles', 'Admins can view all profiles', '{authenticated}'],
    ARRAY['support_tickets', 'Admins can view all tickets', '{public}'],
    ARRAY['market_download_events', 'Admins can view all market download events', '{authenticated}']
  ];
  i integer;
BEGIN
  IF NOT c_code_deployed THEN
    RAISE EXCEPTION 'PRECHECK: c_code_deployed is false — 12-1 전수 시험이 통과한 커밋이 운영에 배포됐는지 확인한 뒤 true 로 바꾼다';
  END IF;
  FOR i IN 1 .. array_length(v_hidden, 1) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies p
                    WHERE p.schemaname = 'public' AND p.tablename = v_hidden[i][1] AND p.policyname = v_hidden[i][2]
                      AND p.permissive = 'RESTRICTIVE' AND p.cmd = v_hidden[i][3] AND p.roles = '{public}'
                      AND regexp_replace(p.qual, '\s+', ' ', 'g') = v_hidden[i][4]
                      AND (CASE WHEN v_hidden[i][3] = 'ALL' THEN regexp_replace(p.with_check, '\s+', ' ', 'g') = v_hidden[i][4]
                                ELSE p.with_check IS NULL END)) THEN
      RAISE EXCEPTION 'PRECHECK: % changed', v_hidden[i][2];
    END IF;
  END LOOP;
  FOR i IN 1 .. array_length(v_narrow, 1) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies p
                    WHERE p.schemaname = 'public' AND p.tablename = v_narrow[i][1] AND p.policyname = v_narrow[i][2]
                      AND p.permissive = 'PERMISSIVE' AND p.cmd = 'SELECT' AND p.roles::text = v_narrow[i][3]
                      AND p.qual = 'is_admin()' AND p.with_check IS NULL) THEN
      RAISE EXCEPTION 'PRECHECK: % changed', v_narrow[i][2];
    END IF;
  END LOOP;
  IF to_regprocedure('private.is_withdrawn_member(uuid)') IS NOT NULL OR to_regprocedure('private.is_withdrawn_ticket_member(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECHECK: private judge functions already exist';
  END IF;
  -- M0·M1 이 적용돼 있어야 한다(15절 순서)
  IF to_regclass('public.admin_member_access_log') IS NULL OR to_regclass('public.support_ticket_answer_revisions') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK: M0 / M1 is not applied';
  END IF;
END;
$precheck_bundle13_select_narrow$;

-- [13번 M3] 시작 ------------------------------------------------------------------------------------------------
-- 1. 판정 함수(private 스키마) -----------------------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE FUNCTION private.is_withdrawn_member(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_is_withdrawn_member$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.withdrawn_at IS NOT NULL);
$fn_is_withdrawn_member$;

CREATE FUNCTION private.is_withdrawn_ticket_member(p_ticket_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_is_withdrawn_ticket_member$
  SELECT EXISTS (SELECT 1 FROM public.support_tickets t JOIN public.profiles p ON p.id = t.user_id
                  WHERE t.id = p_ticket_id AND p.withdrawn_at IS NOT NULL);
$fn_is_withdrawn_ticket_member$;

ALTER FUNCTION private.is_withdrawn_member(uuid) OWNER TO postgres;
ALTER FUNCTION private.is_withdrawn_ticket_member(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.is_withdrawn_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_withdrawn_ticket_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_withdrawn_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_withdrawn_ticket_member(uuid) TO authenticated, service_role;

-- 2. 탈퇴 가림 정책 4개: 식만 바꾼다 ----------------------------------------------------------------------------------
ALTER POLICY support_tickets_withdrawn_hidden ON public.support_tickets
  USING (NOT private.is_withdrawn_member(user_id))
  WITH CHECK (NOT private.is_withdrawn_member(user_id));
ALTER POLICY refund_requests_withdrawn_hidden ON public.refund_requests
  USING (NOT private.is_withdrawn_member(user_id));
ALTER POLICY market_refund_requests_withdrawn_hidden ON public.market_refund_requests
  USING (NOT private.is_withdrawn_member(user_id));
ALTER POLICY support_ticket_revisions_withdrawn_hidden ON public.support_ticket_revisions
  USING (NOT private.is_withdrawn_ticket_member(ticket_id));

-- 3. 관리자 조회 좁히기(2단계 뒤) -----------------------------------------------------------------------------------
ALTER POLICY "Admins can view all profiles" ON public.profiles
  USING (public.is_owner());
ALTER POLICY "Admins can view all tickets" ON public.support_tickets
  USING (public.has_admin_permission('support.manage'));
ALTER POLICY "Admins can view all market download events" ON public.market_download_events
  USING (public.is_owner());
-- [13번 M3] 끝 ------------------------------------------------------------------------------------------------

-- VERIFY -----------------------------------------------------------------------------------------------------------
DO $verify_bundle13_select_narrow$
DECLARE
  v_fn text;
  v_bad text;
BEGIN
  -- 판정 함수: SECURITY DEFINER·STABLE·search_path 고정·소유자 postgres, EXECUTE 는 authenticated·service_role 만
  FOREACH v_fn IN ARRAY ARRAY['private.is_withdrawn_member(uuid)', 'private.is_withdrawn_ticket_member(uuid)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND p.prosecdef AND p.provolatile = 's'
                    AND 'search_path=public, pg_temp' = ANY (p.proconfig) AND pg_get_userbyid(p.proowner) = 'postgres')
       OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'VERIFY: % definition / privileges', v_fn;
    END IF;
  END LOOP;
  IF has_schema_privilege('anon', 'private', 'USAGE') OR NOT has_schema_privilege('authenticated', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'VERIFY: private schema usage';
  END IF;

  -- 탈퇴 가림 정책 4개: 이름·RESTRICTIVE·명령·역할 그대로, 식은 판정 함수
  IF (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.permissive = 'RESTRICTIVE' AND p.roles = '{public}'
       AND ((p.tablename = 'support_tickets' AND p.policyname = 'support_tickets_withdrawn_hidden' AND p.cmd = 'ALL'
             AND p.qual = '(NOT private.is_withdrawn_member(user_id))' AND p.with_check = '(NOT private.is_withdrawn_member(user_id))')
         OR (p.tablename = 'refund_requests' AND p.policyname = 'refund_requests_withdrawn_hidden' AND p.cmd = 'SELECT'
             AND p.qual = '(NOT private.is_withdrawn_member(user_id))')
         OR (p.tablename = 'market_refund_requests' AND p.policyname = 'market_refund_requests_withdrawn_hidden' AND p.cmd = 'SELECT'
             AND p.qual = '(NOT private.is_withdrawn_member(user_id))')
         OR (p.tablename = 'support_ticket_revisions' AND p.policyname = 'support_ticket_revisions_withdrawn_hidden' AND p.cmd = 'SELECT'
             AND p.qual = '(NOT private.is_withdrawn_ticket_member(ticket_id))'))) <> 4 THEN
    RAISE EXCEPTION 'VERIFY: withdrawn hidden policies';
  END IF;

  -- 좁힌 조회 정책 3개: PERMISSIVE·SELECT·역할 그대로
  IF (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.permissive = 'PERMISSIVE' AND p.cmd = 'SELECT' AND p.with_check IS NULL
       AND ((p.tablename = 'profiles' AND p.policyname = 'Admins can view all profiles' AND p.roles = '{authenticated}' AND p.qual = 'is_owner()')
         OR (p.tablename = 'support_tickets' AND p.policyname = 'Admins can view all tickets' AND p.roles = '{public}'
             AND p.qual = 'has_admin_permission(''support.manage''::text)')
         OR (p.tablename = 'market_download_events' AND p.policyname = 'Admins can view all market download events' AND p.roles = '{authenticated}'
             AND p.qual = 'is_owner()'))) <> 3 THEN
    RAISE EXCEPTION 'VERIFY: narrowed select policies';
  END IF;

  -- 적용 뒤 상태: 정책 식 안에서 profiles·support_tickets 를 직접 읽는 하위 조회는 자기 행 조건(auth.uid())뿐
  SELECT string_agg(p.tablename || '.' || p.policyname, ', ') INTO v_bad
    FROM pg_policies p
   WHERE (COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '')) ~ '(FROM|JOIN)\s+\(?\s*(public\.)?(profiles|support_tickets)\y'
     AND (COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '')) !~ 'auth\.uid\(\)';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: policies still subquery profiles/support_tickets without auth.uid(): %', v_bad;
  END IF;
END;
$verify_bundle13_select_narrow$;

NOTIFY pgrst, 'reload schema';
