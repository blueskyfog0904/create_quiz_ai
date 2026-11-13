-- 문의·알림 표의 과한 권한 축소 (계획 U0-1, DB-S1).
-- 문제: 정책 "Users can soft delete their own tickets"가 본인 문의의 모든 컬럼 UPDATE를 허용해,
--       회원이 PostgREST로 직접 admin_response·status를 고칠 수 있었다.
-- 앱의 쓰기 경로(2026-11-13 확인):
--   회원: SECURITY DEFINER RPC 3종(create_support_ticket, update_own_pending_support_ticket, soft_delete_own_support_ticket)
--   관리자 답변: 세션 클라이언트 UPDATE(status, admin_response, responded_at, updated_at) + "Admins can update tickets" 정책
--   카테고리: 관리자 세션 INSERT·UPDATE, 알림: 관리자 세션 INSERT, 읽음 처리는 service role
-- 되돌리기: supabase/rollback/20261113100000_support_tickets_privilege_tighten_down.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 1) support_tickets
DROP POLICY "Users can soft delete their own tickets" ON public.support_tickets;
REVOKE ALL ON public.support_tickets FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.support_tickets FROM authenticated;
GRANT UPDATE (status, admin_response, responded_at, updated_at) ON public.support_tickets TO authenticated;

-- 2) support_ticket_categories (비로그인은 지금도 읽지 못한다: 관리자 조회 정책의 is_admin() 실행 권한이 없어 오류)
REVOKE ALL ON public.support_ticket_categories FROM anon;
REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.support_ticket_categories FROM authenticated;

-- 3) notifications (본인 행은 is_read만 고칠 수 있게)
REVOKE ALL ON public.notifications FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.notifications FROM authenticated;
GRANT UPDATE (is_read) ON public.notifications TO authenticated;

NOTIFY pgrst, 'reload schema';
