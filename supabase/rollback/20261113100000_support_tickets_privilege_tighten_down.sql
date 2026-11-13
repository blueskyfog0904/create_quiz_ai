-- 20261113100000_support_tickets_privilege_tighten 되돌리기. 적용 직전(2026-11-13 조회) 상태로 복원한다.
-- 주의: 되돌리면 회원이 본인 문의의 admin_response·status를 직접 고칠 수 있는 상태로 돌아간다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

REVOKE UPDATE (status, admin_response, responded_at, updated_at) ON public.support_tickets FROM authenticated;
REVOKE UPDATE (is_read) ON public.notifications FROM authenticated;

GRANT ALL ON public.support_tickets TO anon, authenticated;
GRANT ALL ON public.support_ticket_categories TO anon, authenticated;
GRANT ALL ON public.notifications TO anon, authenticated;

CREATE POLICY "Users can soft delete their own tickets" ON public.support_tickets
  FOR UPDATE TO public
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
