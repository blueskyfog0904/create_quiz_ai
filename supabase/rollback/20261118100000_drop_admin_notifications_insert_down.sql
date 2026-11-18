-- 20261118100000_drop_admin_notifications_insert 되돌리기: 관리자 세션의 알림 INSERT 정책과 authenticated INSERT 표 권한을 되살린다.
-- 정책 정의는 2026-11-18 운영 DB의 pg_policies에서 그대로 옮겼다(20261117140000이 만든 모양).
-- 잠금: notifications에 ACCESS EXCLUSIVE. 최대 3초 대기. 반드시 한 트랜잭션으로 실행한다.
-- 순서: 20261117140000_admin_rls_by_permission_down.sql보다 먼저 실행한다(그 파일이 이 정책을 DROP한다).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

GRANT INSERT ON TABLE public.notifications TO authenticated;

CREATE POLICY notifications_admin_insert ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.has_admin_permission('support.manage'))
    OR (
      (SELECT public.has_admin_permission('credits.grant'))
      AND (SELECT public.has_admin_permission('members.view'))
      AND (SELECT public.has_admin_permission('credits.view'))
    )
  );

NOTIFY pgrst, 'reload schema';
