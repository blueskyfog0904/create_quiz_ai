-- 출시 전 작업 순서표 13번 묶음 M2: 문의 답변 잠금(계획 docs/plan-bundle13-cs-tools.md 3판, 4-5). 새 코드 배포 뒤에만 적용한다(15절 6단계).
-- 하는 것:
--   1. authenticated 의 support_tickets UPDATE(status, admin_response, responded_at, updated_at) 칸 권한을 회수하고,
--      정책 support_tickets_admin_update 를 지운다. 세션으로 support_tickets 를 UPDATE 하던 코드는 옛 답변 route 하나뿐이었고,
--      새 코드는 서버 키로 save_support_ticket_answer 를 부른다(5절). 상태만 바꾸는 화면은 4단계(U4-1)에서 함수로 만든다.
--   2. 트리거 guard_support_ticket_answer_write: admin_response·responded_at·response_edited_at 을 SET 하는 UPDATE 는
--      app.support_answer_write = 그 문의 id(저장 함수) 또는 app.member_withdrawal_bypass = 그 회원 id(10번 가림·익명화)일 때만 통과.
--      아니면 SUPPORT_ANSWER_RPC_ONLY — service_role 이 직접 UPDATE 해도 막힌다.
-- 새 트리거는 CREATE TRIGGER 만 쓴다(DROP TRIGGER IF EXISTS 없음 — 사전 점검이 없음을 확인).
-- 잠금: support_tickets 에 트리거·정책 DROP(ACCESS EXCLUSIVE, 짧게). lock_timeout 3초면 전체 취소.
-- 되돌리기: supabase/rollback/20261217120000_bundle13_support_answer_guard_down.sql(M3 down 뒤, 코드를 되돌리기 전에).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 0. 사전 점검 -----------------------------------------------------------------------------------------------------
DO $precheck_bundle13_answer_guard$
BEGIN
  -- M1 이 적용돼 있어야 한다(저장 함수·수정 시각 칸)
  IF to_regprocedure('public.save_support_ticket_answer(uuid,uuid,text,text,text,text,text,jsonb)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'support_tickets' AND column_name = 'response_edited_at') THEN
    RAISE EXCEPTION 'PRECHECK: M1 (20261217110000) is not applied';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.support_tickets'::regclass AND t.tgname = 'guard_support_ticket_answer_write')
     OR to_regprocedure('public.guard_support_ticket_answer_write()') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECHECK: guard_support_ticket_answer_write already exists';
  END IF;
  -- 지울 정책·회수할 권한이 지금 모양(20261117140000)인지
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_tickets'
                  AND policyname = 'support_tickets_admin_update' AND cmd = 'UPDATE' AND permissive = 'PERMISSIVE' AND roles = '{authenticated}'
                  AND qual = '( SELECT has_admin_permission(''support.manage''::text) AS has_admin_permission)'
                  AND with_check = '( SELECT has_admin_permission(''support.manage''::text) AS has_admin_permission)') THEN
    RAISE EXCEPTION 'PRECHECK: support_tickets_admin_update policy changed';
  END IF;
  IF NOT (has_column_privilege('authenticated', 'public.support_tickets', 'status', 'UPDATE')
          AND has_column_privilege('authenticated', 'public.support_tickets', 'admin_response', 'UPDATE')
          AND has_column_privilege('authenticated', 'public.support_tickets', 'responded_at', 'UPDATE')
          AND has_column_privilege('authenticated', 'public.support_tickets', 'updated_at', 'UPDATE')) THEN
    RAISE EXCEPTION 'PRECHECK: authenticated support_tickets column privileges changed';
  END IF;
END;
$precheck_bundle13_answer_guard$;

-- [13번 M2] 시작 ------------------------------------------------------------------------------------------------
REVOKE UPDATE (status, admin_response, responded_at, updated_at) ON public.support_tickets FROM authenticated;
DROP POLICY support_tickets_admin_update ON public.support_tickets;

CREATE FUNCTION public.guard_support_ticket_answer_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_support_ticket_answer_write$
BEGIN
  IF COALESCE(current_setting('app.support_answer_write', true), '') = NEW.id::text
     OR COALESCE(current_setting('app.member_withdrawal_bypass', true), '') = NEW.user_id::text THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'SUPPORT_ANSWER_RPC_ONLY';
END;
$fn_guard_support_ticket_answer_write$;
REVOKE ALL ON FUNCTION public.guard_support_ticket_answer_write() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER guard_support_ticket_answer_write
  BEFORE UPDATE OF admin_response, responded_at, response_edited_at ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.guard_support_ticket_answer_write();
-- [13번 M2] 끝 ------------------------------------------------------------------------------------------------

-- VERIFY -----------------------------------------------------------------------------------------------------------
DO $verify_bundle13_answer_guard$
BEGIN
  IF has_column_privilege('authenticated', 'public.support_tickets', 'status', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.support_tickets', 'admin_response', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.support_tickets', 'responded_at', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.support_tickets', 'updated_at', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.support_tickets', 'response_edited_at', 'UPDATE') THEN
    RAISE EXCEPTION 'VERIFY: authenticated still has support_tickets UPDATE';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_tickets' AND cmd IN ('UPDATE', 'ALL') AND permissive = 'PERMISSIVE') THEN
    RAISE EXCEPTION 'VERIFY: support_tickets still has a permissive UPDATE policy';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t
       WHERE t.tgrelid = 'public.support_tickets'::regclass AND NOT t.tgisinternal AND t.tgenabled = 'O'
         AND t.tgname = 'guard_support_ticket_answer_write'
         AND pg_get_triggerdef(t.oid) LIKE '%BEFORE UPDATE OF admin_response, responded_at, response_edited_at ON public.support_tickets FOR EACH ROW%') <> 1 THEN
    RAISE EXCEPTION 'VERIFY: guard_support_ticket_answer_write trigger';
  END IF;
  IF has_function_privilege('service_role', 'public.guard_support_ticket_answer_write()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.guard_support_ticket_answer_write()', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY: guard function must not be executable by API roles';
  END IF;
END;
$verify_bundle13_answer_guard$;

NOTIFY pgrst, 'reload schema';
