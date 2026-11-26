-- 13번 묶음 M2 되돌리기(계획 docs/plan-bundle13-cs-tools.md 4-7). M3 down 뒤, 코드를 되돌리기 **전에** 한다:
--   옛 코드는 세션으로 답변을 UPDATE 하므로 칸 권한과 정책 support_tickets_admin_update 가 먼저 돌아와야 바로 동작한다.
-- 하는 것: 트리거·함수 지움 → authenticated 에 4칸 UPDATE 권한과 정책(20261117140000 정의 그대로)을 다시 준다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $down_precheck_bundle13_answer_guard$
BEGIN
  IF to_regprocedure('private.is_withdrawn_member(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'DOWN PRECHECK: M3 is still applied — run 20261217130000_bundle13_admin_select_narrow_down.sql first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.support_tickets'::regclass AND t.tgname = 'guard_support_ticket_answer_write')
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_tickets' AND policyname = 'support_tickets_admin_update') THEN
    RAISE EXCEPTION 'DOWN PRECHECK: M2 is not applied';
  END IF;
END;
$down_precheck_bundle13_answer_guard$;

DROP TRIGGER guard_support_ticket_answer_write ON public.support_tickets;
DROP FUNCTION public.guard_support_ticket_answer_write();
GRANT UPDATE (status, admin_response, responded_at, updated_at) ON public.support_tickets TO authenticated;
CREATE POLICY support_tickets_admin_update ON public.support_tickets
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_admin_permission('support.manage')))
  WITH CHECK ((SELECT public.has_admin_permission('support.manage')));

DO $down_verify_bundle13_answer_guard$
BEGIN
  IF NOT (has_column_privilege('authenticated', 'public.support_tickets', 'status', 'UPDATE')
          AND has_column_privilege('authenticated', 'public.support_tickets', 'admin_response', 'UPDATE')
          AND has_column_privilege('authenticated', 'public.support_tickets', 'responded_at', 'UPDATE')
          AND has_column_privilege('authenticated', 'public.support_tickets', 'updated_at', 'UPDATE'))
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_tickets'
                     AND policyname = 'support_tickets_admin_update' AND cmd = 'UPDATE' AND roles = '{authenticated}'
                     AND qual = '( SELECT has_admin_permission(''support.manage''::text) AS has_admin_permission)'
                     AND with_check = '( SELECT has_admin_permission(''support.manage''::text) AS has_admin_permission)')
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.support_tickets'::regclass AND t.tgname = 'guard_support_ticket_answer_write')
     OR to_regprocedure('public.guard_support_ticket_answer_write()') IS NOT NULL THEN
    RAISE EXCEPTION 'DOWN VERIFY: M2 rollback';
  END IF;
END;
$down_verify_bundle13_answer_guard$;

NOTIFY pgrst, 'reload schema';
