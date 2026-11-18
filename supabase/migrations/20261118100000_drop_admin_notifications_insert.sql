-- 관리자 세션의 회원 알림 INSERT 길을 닫는다(20261117140000 3절의 후속).
-- 배경: 문의 답변 알림(api/admin/support/tickets/[id]/route.ts)과 크레딧 지급 알림(api/admin/users/credits/route.ts)이
--       관리자 로그인 세션으로 notifications에 INSERT해서, notifications_admin_insert 정책과 authenticated INSERT 표 권한이 필요했다.
--       그 정책 때문에 support.manage 권한만 있는 staff도 PostgREST로 직접 아무 회원에게 아무 내용의 알림을 넣을 수 있었다.
--       두 곳을 서버 키(service role)로 옮겼다(이 파일과 같은 커밋). 이제 세션으로 알림을 넣는 코드는 없다.
-- 바꾸는 것:
--   notifications_admin_insert 정책 삭제, authenticated의 notifications INSERT 표 권한 회수.
--   회원 조회(SELECT)·읽음 표시(UPDATE (is_read)) 정책과 권한은 그대로 둔다.
-- 영향 없음: 알림을 넣는 DB 함수(quarantine_*_cancellation 3개)는 SECURITY DEFINER라 표 권한·정책과 무관하다.
--           나머지 알림 INSERT(결제 확인·충전 환불·마켓 환불·페이앱 통보)는 처음부터 서버 키다.
-- 선행: 두 route를 서버 키로 옮긴 코드의 배포. 먼저 적용하면 그 사이 문의 답변·크레딧 지급의 회원 알림만 실패한다
--       (답변·지급은 저장되고, 문의 화면은 "회원 알림을 만들지 못했습니다" 경고를 띄운다. 크레딧 지급 쪽 옛 코드는
--       알림 결과를 보지 않아 경고·로그 없이 알림만 빠진다 — 반드시 배포 뒤에 적용한다).
-- 잠금: notifications에 ACCESS EXCLUSIVE(정책 삭제). 최대 3초 대기.
-- 적용: 반드시 한 트랜잭션으로 실행한다(BEGIN 없이 SQL 편집기에 붙여 넣으면 SET LOCAL lock_timeout이 걸리지 않는다).
-- 되돌리기: supabase/rollback/20261118100000_drop_admin_notifications_insert_down.sql
--   20261117140000의 되돌리기보다 먼저 실행한다(그 파일은 이 정책이 있다고 보고 DROP POLICY를 한다).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DROP POLICY notifications_admin_insert ON public.notifications;

REVOKE INSERT ON TABLE public.notifications FROM authenticated;

NOTIFY pgrst, 'reload schema';
