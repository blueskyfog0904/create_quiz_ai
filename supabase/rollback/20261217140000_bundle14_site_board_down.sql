-- 14번 묶음 되돌리기(supabase/migrations/20261217140000_bundle14_site_board.sql 의 down). 계획 docs/plan-bundle14-notice-faq.md 5-7.
-- 코드를 14번 전으로 되돌린 뒤에만 실행한다(새 코드는 표·함수가 없으면 하단 링크만 빼고, 공지·FAQ 화면은 오류가 난다).
-- 머리 확인(하나라도 어기면 멈춤):
--   ① 14번 표 2개가 있음(14번 적용 상태)
--   ② 16번 함수가 없음 — member_facing_text_pii_hits 를 부르는 16번 함수는 plpgsql 본문이라 의존성으로 잡히지 않으므로 이름으로 본다:
--      send_member_broadcast·save_member_notification_texts·retract_member_broadcast·member_broadcast_preview, 5인자 reject_point_charge_refund(16번 5-8).
--      개인정보 판정 함수를 지워 환불 거절이 실행 중에 깨지는 일을 막는다.
--   ③ site_board_posts 를 가리키는 FK 가운데 14번 판 이력 표(site_board_post_revisions)의 것이 아닌 것이 없음.
--      16번 down 은 함수와 post_id FK 를 지우고 기록 표는 증빙으로 남기므로, 기록 표가 있는 것만으로는 멈추지 않는다.
--   ④ 글이 1건이라도 있으면 대표 확인(c_allow_drop_posts = true) 전 멈춤. 지울 때 16번 기록 표에 post_id 가 남으면 그 값은 지워진 글을
--      가리키게 된다(기록 표는 가드로 고칠 수 없음) — 그래서 16번을 다시 적용할 때 FK 를 NOT VALID 로 붙인다(16번 5-1).
-- 순서: 함수 → 표 2개(가드 트리거는 표와 함께) → 가드 함수 → 설정 행.
-- 이 파일은 이력 행을 지우지 않는다. 다시 적용하려면 같은 거래에서 schema_migrations 의 '20261217140000' 행을 지운 뒤 마이그레이션과 이력 INSERT 를 넣는다.
-- 잠금: 14번 표만 지운다(ACCESS EXCLUSIVE, 새 표). system_settings 는 행 1개 삭제뿐.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $precheck_bundle14_site_board_down$
DECLARE
  c_allow_drop_posts constant boolean := false;
  v_bundle16_functions text[] := ARRAY['send_member_broadcast', 'save_member_notification_texts', 'retract_member_broadcast', 'member_broadcast_preview'];
BEGIN
  IF to_regclass('public.site_board_posts') IS NULL OR to_regclass('public.site_board_post_revisions') IS NULL THEN
    RAISE EXCEPTION 'DOWN PRECHECK: bundle 14 tables missing (not the bundle 14 state)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (v_bundle16_functions))
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'reject_point_charge_refund' AND p.pronargs = 5) THEN
    RAISE EXCEPTION 'DOWN PRECHECK: bundle 16 functions exist — roll back bundle 16 first';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint c
              WHERE c.contype = 'f' AND c.confrelid = 'public.site_board_posts'::regclass
                AND c.conrelid <> 'public.site_board_post_revisions'::regclass) THEN
    RAISE EXCEPTION 'DOWN PRECHECK: other foreign keys reference site_board_posts — roll back that bundle first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.site_board_posts) AND NOT c_allow_drop_posts THEN
    RAISE EXCEPTION 'DOWN PRECHECK: posts exist — owner confirms (c_allow_drop_posts)';
  END IF;
END;
$precheck_bundle14_site_board_down$;

-- [14번] 시작: 되돌림 ----------------------------------------------------------------------------------------------
-- 1. 함수
DROP FUNCTION public.save_site_board_content(uuid, integer, jsonb, jsonb);
DROP FUNCTION public.redact_site_board_post(uuid, uuid, text, jsonb);
DROP FUNCTION public.reorder_site_board_posts(uuid, text, text, uuid[], jsonb);
DROP FUNCTION public.delete_site_board_post(uuid, uuid, integer, jsonb);
DROP FUNCTION public.save_site_board_post(uuid, uuid, integer, text, text, text, text, text, text, boolean, boolean, jsonb);
DROP FUNCTION public.member_facing_text_pii_hits(text);
DROP FUNCTION public.site_board_actor_allowed(uuid);

-- 2. 표(판 이력 먼저 — 글 표를 가리킨다). 가드 트리거는 표와 함께 지워진다.
DROP TABLE public.site_board_post_revisions;
DROP TABLE public.site_board_posts;
DROP FUNCTION public.guard_site_board_post_revisions_mutation();

-- 3. 설정 행
DELETE FROM public.system_settings WHERE key = 'site_board_content';

DO $verify_bundle14_site_board_down$
BEGIN
  IF to_regclass('public.site_board_posts') IS NOT NULL OR to_regclass('public.site_board_post_revisions') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN (
       'site_board_actor_allowed', 'member_facing_text_pii_hits', 'save_site_board_post', 'delete_site_board_post',
       'reorder_site_board_posts', 'redact_site_board_post', 'save_site_board_content', 'guard_site_board_post_revisions_mutation'))
     OR EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'site_board_content') THEN
    RAISE EXCEPTION 'DOWN VERIFY: bundle 14 objects remain';
  END IF;
END;
$verify_bundle14_site_board_down$;

NOTIFY pgrst, 'reload schema';
