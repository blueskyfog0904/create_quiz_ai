-- 13번 묶음 M3 되돌리기(계획 docs/plan-bundle13-cs-tools.md 4-7). 13번 되돌리기 중 가장 먼저 한다: M3 down → M2 down → 코드 → (필요하면) M1 down.
-- 순서: 좁힌 조회 정책 3개를 is_admin() 으로 → 탈퇴 가림 정책 4개를 10번 원래 식으로 → 판정 함수 2개를 지운다(private 스키마는 비어 있을 때만).
--   이 순서여야 함수를 지울 때 그 함수를 쓰는 정책이 남지 않는다. 정책 이름이 같으므로 10번 되돌리기(down_a, 이름으로 DROP)와 충돌하지 않는다.
-- CS 계정을 발급한 뒤에 되돌리면, 다시 적용할 때까지 직원 계정의 문의·회원 조회 권한을 회수한다(회수하지 않으려면 대표가 Q14 (나) 한계를
--   받아들였다는 기록을 남긴다 — 런북 10-10).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $down_precheck_bundle13_select_narrow$
BEGIN
  IF to_regprocedure('private.is_withdrawn_member(uuid)') IS NULL OR to_regprocedure('private.is_withdrawn_ticket_member(uuid)') IS NULL THEN
    RAISE EXCEPTION 'DOWN PRECHECK: M3 is not applied (private judge functions missing)';
  END IF;
  IF (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public'
       AND ((p.tablename = 'profiles' AND p.policyname = 'Admins can view all profiles' AND p.qual = 'is_owner()')
         OR (p.tablename = 'support_tickets' AND p.policyname = 'Admins can view all tickets' AND p.qual = 'has_admin_permission(''support.manage''::text)')
         OR (p.tablename = 'market_download_events' AND p.policyname = 'Admins can view all market download events' AND p.qual = 'is_owner()'))) <> 3 THEN
    RAISE EXCEPTION 'DOWN PRECHECK: narrowed select policies are not the M3 definition';
  END IF;
END;
$down_precheck_bundle13_select_narrow$;

-- 1. 조회 정책을 is_admin() 으로(역할·명령은 ALTER POLICY 라 그대로)
ALTER POLICY "Admins can view all profiles" ON public.profiles
  USING (public.is_admin());
ALTER POLICY "Admins can view all tickets" ON public.support_tickets
  USING (public.is_admin());
ALTER POLICY "Admins can view all market download events" ON public.market_download_events
  USING (public.is_admin());

-- 2. 탈퇴 가림 정책 4개를 10번(20261126100000 3-6) 원래 식으로
ALTER POLICY support_tickets_withdrawn_hidden ON public.support_tickets
  USING (NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = support_tickets.user_id AND p.withdrawn_at IS NOT NULL))
  WITH CHECK (NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = support_tickets.user_id AND p.withdrawn_at IS NOT NULL));
ALTER POLICY market_refund_requests_withdrawn_hidden ON public.market_refund_requests
  USING (NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = market_refund_requests.user_id AND p.withdrawn_at IS NOT NULL));
ALTER POLICY support_ticket_revisions_withdrawn_hidden ON public.support_ticket_revisions
  USING (NOT EXISTS (SELECT 1 FROM public.support_tickets t JOIN public.profiles p ON p.id = t.user_id
                      WHERE t.id = support_ticket_revisions.ticket_id AND p.withdrawn_at IS NOT NULL));
ALTER POLICY refund_requests_withdrawn_hidden ON public.refund_requests
  USING (NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = refund_requests.user_id AND p.withdrawn_at IS NOT NULL));

-- 3. 판정 함수를 지운다(정책이 더는 쓰지 않음). private 스키마는 비어 있을 때만 지운다.
DROP FUNCTION private.is_withdrawn_ticket_member(uuid);
DROP FUNCTION private.is_withdrawn_member(uuid);
DO $down_drop_private_schema$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'private'::regnamespace)
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'private'::regnamespace)
     AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'private'::regnamespace) THEN
    EXECUTE 'DROP SCHEMA private';
  END IF;
END;
$down_drop_private_schema$;

-- 확인: 역할·명령·RESTRICTIVE 그대로, 식은 적용 전과 같음
DO $down_verify_bundle13_select_narrow$
BEGIN
  IF (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.permissive = 'PERMISSIVE' AND p.cmd = 'SELECT' AND p.qual = 'is_admin()'
       AND ((p.tablename = 'profiles' AND p.policyname = 'Admins can view all profiles' AND p.roles = '{authenticated}')
         OR (p.tablename = 'support_tickets' AND p.policyname = 'Admins can view all tickets' AND p.roles = '{public}')
         OR (p.tablename = 'market_download_events' AND p.policyname = 'Admins can view all market download events' AND p.roles = '{authenticated}'))) <> 3 THEN
    RAISE EXCEPTION 'DOWN VERIFY: select policies';
  END IF;
  IF (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.permissive = 'RESTRICTIVE' AND p.roles = '{public}'
       AND ((p.tablename = 'support_tickets' AND p.policyname = 'support_tickets_withdrawn_hidden' AND p.cmd = 'ALL'
             AND regexp_replace(p.qual, '\s+', ' ', 'g') = '(NOT (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = support_tickets.user_id) AND (p.withdrawn_at IS NOT NULL)))))'
             AND regexp_replace(p.with_check, '\s+', ' ', 'g') = '(NOT (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = support_tickets.user_id) AND (p.withdrawn_at IS NOT NULL)))))')
         OR (p.tablename = 'market_refund_requests' AND p.policyname = 'market_refund_requests_withdrawn_hidden' AND p.cmd = 'SELECT'
             AND regexp_replace(p.qual, '\s+', ' ', 'g') = '(NOT (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = market_refund_requests.user_id) AND (p.withdrawn_at IS NOT NULL)))))')
         OR (p.tablename = 'refund_requests' AND p.policyname = 'refund_requests_withdrawn_hidden' AND p.cmd = 'SELECT'
             AND regexp_replace(p.qual, '\s+', ' ', 'g') = '(NOT (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = refund_requests.user_id) AND (p.withdrawn_at IS NOT NULL)))))')
         OR (p.tablename = 'support_ticket_revisions' AND p.policyname = 'support_ticket_revisions_withdrawn_hidden' AND p.cmd = 'SELECT'
             AND regexp_replace(p.qual, '\s+', ' ', 'g') = '(NOT (EXISTS ( SELECT 1 FROM (support_tickets t JOIN profiles p ON ((p.id = t.user_id))) WHERE ((t.id = support_ticket_revisions.ticket_id) AND (p.withdrawn_at IS NOT NULL)))))'))) <> 4 THEN
    RAISE EXCEPTION 'DOWN VERIFY: withdrawn hidden policies';
  END IF;
  IF to_regprocedure('private.is_withdrawn_member(uuid)') IS NOT NULL OR to_regprocedure('private.is_withdrawn_ticket_member(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'DOWN VERIFY: judge functions remain';
  END IF;
END;
$down_verify_bundle13_select_narrow$;

NOTIFY pgrst, 'reload schema';
