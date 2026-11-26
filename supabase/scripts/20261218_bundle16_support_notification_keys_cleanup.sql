-- 16번 묶음 5-6: 13번 답변 알림 키 정리 + 옛 4인자 충전 환불 거절 함수 삭제(계획 docs/plan-bundle16-notification-copy.md 5-6, 13절 6단계).
-- 마이그레이션이 아니다(적용 이력에 넣지 않는다). 운영 SQL 편집기(postgres)에서 파일 전체를 한 번에 실행한다(대표 승인 뒤).
-- 언제: 16번 코드가 배포되고, 답변 알림이 새 행(member_notification_texts)에서 읽히는 것을 확인한 뒤(10-2 운영 확인).
--   DB 적용~배포 사이에는 대표에게 '고객지원 안내 문구의 답변 알림 칸을 고치지 말 것'을 알린다.
-- 키마다(5-2 대응표):
--   이미 없음 → 정리된 것으로 보고 넘어감 / member_notification_texts 값과 같음 → 지움 / 다름 → 멈추고 대표가 어느 글을 쓸지 정한다.
--   지운 것이 있으면 revision + 1, 작업 기록 support_page_content_update(details.bundle = 'bundle16_support_keys_cleanup').
-- 옛 4인자 reject_point_charge_refund(uuid,uuid,text,boolean): 새 코드는 5인자만 부른다. 지우기 전에 5인자의 권한이 postgres·service_role 뿐인지 본다.
--   되돌릴 때는 되살리기 스크립트(20261218_bundle16_support_notification_keys_restore.sql)가 다시 만든다.
-- 기록자: 대표(owner) 계정 중 가장 최근에 로그인한 계정(10번·15번 스크립트와 같음).
-- 잠금: support_page_content 행 잠금(몇 밀리초)과 함수 삭제뿐이다.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $bundle16_support_keys_cleanup$
DECLARE
  -- support_page_content 경로 ↔ member_notification_texts 경로(5-2 대응표)
  c_pairs constant text[][] := ARRAY[
    ARRAY['{member,answerCreatedNotificationTitle}', '{kinds,supportAnswerCreated,title}'],
    ARRAY['{member,answerCreatedNotificationMessage}', '{kinds,supportAnswerCreated,message}'],
    ARRAY['{member,answerEditedNotificationTitle}', '{kinds,supportAnswerEdited,title}'],
    ARRAY['{member,answerEditedNotificationMessage}', '{kinds,supportAnswerEdited,message}'],
    ARRAY['{admin,notifyOnAnswerEdit}', '{kinds,supportAnswerEdited,enabled}']];
  v_actor uuid;
  v_texts jsonb;
  v_support jsonb;
  v_new jsonb;
  v_pair text[];
  v_removed text[] := ARRAY[]::text[];
  v_revision integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT p.id INTO v_actor FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.is_admin IS TRUE AND p.admin_role = 'owner' AND p.withdrawn_at IS NULL AND u.last_sign_in_at IS NOT NULL
   ORDER BY u.last_sign_in_at DESC LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'KEYS_CLEANUP: signed-in owner account not found';
  END IF;
  SELECT value INTO v_texts FROM public.system_settings WHERE key = 'member_notification_texts';
  IF v_texts IS NULL THEN
    RAISE EXCEPTION 'KEYS_CLEANUP: member_notification_texts missing (bundle 16 migration not applied)';
  END IF;
  SELECT value INTO v_support FROM public.system_settings WHERE key = 'support_page_content' FOR UPDATE;
  IF v_support IS NULL THEN
    RAISE EXCEPTION 'KEYS_CLEANUP: support_page_content missing';
  END IF;

  v_new := v_support;
  FOREACH v_pair SLICE 1 IN ARRAY c_pairs LOOP
    IF v_support #> v_pair[1]::text[] IS NULL THEN
      CONTINUE;
    END IF;
    IF v_support #> v_pair[1]::text[] IS DISTINCT FROM v_texts #> v_pair[2]::text[] THEN
      RAISE EXCEPTION 'KEYS_CLEANUP: support_page_content % differs from member_notification_texts % — owner decides which text to keep', v_pair[1], v_pair[2];
    END IF;
    v_new := v_new #- v_pair[1]::text[];
    v_removed := v_removed || v_pair[1];
  END LOOP;

  IF cardinality(v_removed) > 0 THEN
    v_revision := (v_support ->> 'revision')::integer;
    v_new := jsonb_set(v_new, '{revision}', to_jsonb(v_revision + 1));
    UPDATE public.system_settings SET value = v_new, updated_at = v_now WHERE key = 'support_page_content';
    PERFORM public.record_admin_audit(v_actor, 'support_page_content_update', 'system_settings', 'support_page_content', NULL, NULL, NULL,
      jsonb_build_object('bundle', 'bundle16_support_keys_cleanup', 'removed', to_jsonb(v_removed),
        'revision_before', v_revision, 'revision_after', v_revision + 1, 'saved_at', v_now),
      NULL);
  END IF;

  -- 옛 4인자 거절 함수: 새 5인자의 권한을 먼저 본다
  IF to_regprocedure('public.reject_point_charge_refund(uuid,uuid,text,boolean,text)') IS NULL
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure('public.reject_point_charge_refund(uuid,uuid,text,boolean,text)'))
        IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'KEYS_CLEANUP: 5-arg reject_point_charge_refund missing or privileges differ';
  END IF;
  IF to_regprocedure('public.reject_point_charge_refund(uuid,uuid,text,boolean)') IS NOT NULL THEN
    DROP FUNCTION public.reject_point_charge_refund(uuid, uuid, text, boolean);
  END IF;

  RAISE NOTICE 'KEYS_CLEANUP: removed % key(s), old 4-arg reject function dropped', cardinality(v_removed);
END;
$bundle16_support_keys_cleanup$;

-- [확인] 남은 키(0이어야 함)와 거절 함수 서명(5인자 하나)
SELECT (SELECT count(*) FROM public.system_settings s,
          unnest(ARRAY['answerCreatedNotificationTitle', 'answerCreatedNotificationMessage', 'answerEditedNotificationTitle',
                       'answerEditedNotificationMessage']) k
         WHERE s.key = 'support_page_content' AND s.value -> 'member' ? k)
       + (SELECT count(*) FROM public.system_settings s WHERE s.key = 'support_page_content' AND s.value -> 'admin' ? 'notifyOnAnswerEdit') AS keys_left,
       (SELECT array_agg(p.oid::regprocedure::text) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'reject_point_charge_refund') AS reject_signatures;
COMMIT;
