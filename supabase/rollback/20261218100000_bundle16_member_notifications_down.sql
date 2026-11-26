-- 16번 묶음 되돌리기(supabase/migrations/20261218100000_bundle16_member_notifications.sql 의 down). 계획 docs/plan-bundle16-notification-copy.md 5-5.
-- 순서(코드를 되돌리면 13번 코드가 옛 키·옛 4인자 거절 함수를 다시 쓰므로):
--   1. 키 되살리기 스크립트(supabase/scripts/20261218_bundle16_support_notification_keys_restore.sql)를 코드 되돌리기 전에 돌린다
--      (support_page_content 답변 알림 키 5개, 정리 스크립트가 지운 옛 4인자 거절 함수).
--   2. 코드 되돌리기(16번 커밋만 revert).
--   3. 이 파일(새벽, lock_timeout 3초).
-- 머리 확인: 옛 4인자 reject_point_charge_refund(uuid,uuid,text,boolean) 가 있고 권한이 postgres·service_role 뿐이어야 한다.
--   없으면 1단계를 먼저 하라고 멈춘다(새 서명을 지운 뒤 거절 함수가 하나도 없게 되는 것을 막는다).
--   회수하지 않은 공지 알림이 회원 알림 목록에 남아 있으면 멈춘다: broadcast_id 칸을 지우면 기록 표와 연결이 끊겨, 다시 적용해도
--   회수(개인정보 가림 포함)로 찾을 수 없다. 대표가 '알림' 화면에서 먼저 회수할지 정한다.
-- 지우는 것: 함수 5개·내부 검사 함수 → notifications.broadcast_id 칸(FK·인덱스와 함께) → 기록 표의 post_id FK 제약(값은 남김) → 5인자 거절 함수.
-- 남기는 것(5-5 의 4): 기록 표·가드(증빙), 설정 행과 그 쓰기 막기 정책(행이 남는 동안 대표 세션 쓰기에 열리지 않게 짝으로),
--   refund_requests.member_reject_reason 칸, 넓힌 payment_admin_actions action CHECK(지울 수 없는 refund_rejected 행이 남으므로 옛 목록으로
--   되돌리면 실패), member_withdrawal_facts·redact_member_text 의 새 칸 확장(칸과 값이 남는 동안 가릴 수 있어야 하므로).
--   확장은 허용 칸이 하나 느는 것뿐이라 옛 코드와 충돌하지 않는다. 다시 적용은 마이그레이션 5-1 의 '이미 있음' 경로를 탄다.
-- 14번과의 순서: 이 down 뒤에는 14번 down 의 머리 확인(16번 함수 이름·5인자 거절·site_board_posts 를 가리키는 다른 FK)이 통과한다.
-- 이 파일은 이력 행을 지우지 않는다. 다시 적용하려면 같은 거래에서 schema_migrations 의 '20261218100000' 행을 지운 뒤 마이그레이션과 이력 INSERT 를 넣는다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $precheck_bundle16_member_notifications_down$
BEGIN
  IF to_regprocedure('public.reject_point_charge_refund(uuid,uuid,text,boolean)') IS NULL
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure('public.reject_point_charge_refund(uuid,uuid,text,boolean)'))
        IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'DOWN PRECHECK: old 4-arg reject_point_charge_refund missing or privileges differ — run the restore script first';
  END IF;
  IF to_regclass('public.member_notification_broadcasts') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'broadcast_id')
     OR to_regprocedure('public.send_member_broadcast(uuid,uuid,text,text,text,text,uuid,integer,integer,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'DOWN PRECHECK: bundle 16 is not applied';
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_notification_broadcasts b
              WHERE b.retracted_at IS NULL
                AND EXISTS (SELECT 1 FROM public.notifications n WHERE n.broadcast_id = b.id)) THEN
    RAISE EXCEPTION 'DOWN PRECHECK: unretracted broadcast notifications remain — retract them first (or owner decides to keep them unlinked)';
  END IF;
END;
$precheck_bundle16_member_notifications_down$;

-- [16번] 시작: 되돌림 ----------------------------------------------------------------------------------------------
-- 1. 함수(함수 5개, 내부 검사 함수)
DROP FUNCTION public.retract_member_broadcast(uuid, uuid, text, boolean, jsonb);
DROP FUNCTION public.send_member_broadcast(uuid, uuid, text, text, text, text, uuid, integer, integer, jsonb);
DROP FUNCTION public.save_member_notification_texts(uuid, integer, jsonb, jsonb);
DROP FUNCTION public.member_broadcast_preview(uuid, text);
DROP FUNCTION public.member_broadcast_recipients(text, uuid);
DROP FUNCTION public.member_notification_texts_problem(jsonb);
-- 2. notifications.broadcast_id(FK·부분 인덱스도 함께 지워진다)
ALTER TABLE public.notifications DROP COLUMN broadcast_id;
-- 3. 기록 표의 post_id FK 제약(값은 남김 — 14번 down 이 이 FK 로 멈추지 않게)
ALTER TABLE public.member_notification_broadcasts DROP CONSTRAINT member_notification_broadcasts_post_id_fkey;
-- 4. 새 거절 서명(옛 4인자는 머리 확인에서 있음을 봤다)
DROP FUNCTION public.reject_point_charge_refund(uuid, uuid, text, boolean, text);
-- [16번] 끝: 되돌림 -----------------------------------------------------------------------------------------------

DO $verify_bundle16_member_notifications_down$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('member_broadcast_recipients', 'member_broadcast_preview', 'save_member_notification_texts',
                                'send_member_broadcast', 'retract_member_broadcast', 'member_notification_texts_problem'))
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'reject_point_charge_refund' AND p.pronargs = 5)
     OR to_regprocedure('public.reject_point_charge_refund(uuid,uuid,text,boolean)') IS NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'broadcast_id')
     OR EXISTS (SELECT 1 FROM pg_constraint c WHERE c.contype = 'f' AND c.confrelid = 'public.site_board_posts'::regclass
                 AND c.conrelid = 'public.member_notification_broadcasts'::regclass) THEN
    RAISE EXCEPTION 'VERIFY DOWN: bundle 16 objects remain';
  END IF;
  -- 남기는 것
  IF to_regclass('public.member_notification_broadcasts') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'member_notification_texts')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings'
                     AND policyname = 'system_settings_member_notification_texts_no_client_write')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'refund_requests' AND column_name = 'member_reject_reason')
     OR (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid = 'public.payment_admin_actions'::regclass
           AND c.conname = 'payment_admin_actions_action_check') NOT LIKE '%''refund_rejected''::text%' THEN
    RAISE EXCEPTION 'VERIFY DOWN: kept objects missing';
  END IF;
END;
$verify_bundle16_member_notifications_down$;

NOTIFY pgrst, 'reload schema';
