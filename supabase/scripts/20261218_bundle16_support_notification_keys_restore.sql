-- 16번 묶음 5-5 되돌리기 1단계: 13번 답변 알림 키 되살리기 + 옛 4인자 충전 환불 거절 함수 다시 만들기(계획 docs/plan-bundle16-notification-copy.md 5-5).
-- 마이그레이션이 아니다(적용 이력에 넣지 않는다). 운영 SQL 편집기(postgres)에서 파일 전체를 한 번에 실행한다(대표 승인 뒤).
-- 언제: 16번 코드를 되돌리기 **전에**(되돌린 13번 코드가 옛 키와 옛 4인자 함수를 다시 쓴다). 그다음 코드 되돌리기 → down 순서.
--   이 스크립트부터 코드 되돌리기까지는 대표에게 '13번 안내 문구 탭 저장 금지'를 알린다(16번 코드의 탭은 5개 키 없이 저장한다).
-- 키마다(5-2 대응표): 없음 → member_notification_texts 값으로 넣음 / 있음·같음 → 그대로 / 있음·다름 → 그대로 두고 기록에 남기며 알린다
--   (되돌리면 그 옛 값이 쓰인다 — 대표가 확인). 넣은 것이 있으면 revision + 1. 넣었거나 다른 것이 있으면 작업 기록
--   support_page_content_update(details.bundle = 'bundle16_support_keys_restore'). 키를 더해도 16번 코드에는 영향이 없다.
-- 옛 4인자 reject_point_charge_refund(uuid,uuid,text,boolean): 없으면(정리 스크립트 뒤) 적용 전 정의 그대로 다시 만들고
--   PUBLIC·anon·authenticated 를 회수, service_role 에 EXECUTE(새 함수 기본 권한이 anon 에게 열려 있어서). 끝에서 지문·권한을 본다.
-- 기록자: 대표(owner) 계정 중 가장 최근에 로그인한 계정.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $bundle16_support_keys_restore$
DECLARE
  c_pairs constant text[][] := ARRAY[
    ARRAY['{member,answerCreatedNotificationTitle}', '{kinds,supportAnswerCreated,title}'],
    ARRAY['{member,answerCreatedNotificationMessage}', '{kinds,supportAnswerCreated,message}'],
    ARRAY['{member,answerEditedNotificationTitle}', '{kinds,supportAnswerEdited,title}'],
    ARRAY['{member,answerEditedNotificationMessage}', '{kinds,supportAnswerEdited,message}'],
    ARRAY['{admin,notifyOnAnswerEdit}', '{kinds,supportAnswerEdited,enabled}']];
  -- 적용 전 운영 정의(2026-11-26 pg_get_functiondef 읽기 전용, md5 20384719deba112e977fbd3bf8e266e5)
  c_old_reject constant text := $old_reject$CREATE OR REPLACE FUNCTION public.reject_point_charge_refund(p_request_id uuid, p_admin_id uuid, p_admin_note text, p_provider_not_cancelled_confirmed boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_request public.refund_requests%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_request
    FROM public.refund_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF NOT FOUND OR v_request.status NOT IN ('pending_review', 'manual_review') THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_REJECTABLE';
  END IF;

  SELECT * INTO v_source
    FROM public.credit_sources
   WHERE id = v_request.source_id
   FOR UPDATE;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = v_request.payment_order_id
   FOR UPDATE;

  IF v_order.id IS NOT NULL THEN
    SELECT * INTO v_ppt
      FROM public.payment_provider_transactions
     WHERE payment_order_id = v_order.id
     FOR UPDATE;
  END IF;

  -- 결제사에서 취소된 흔적이 있으면 거절해서 크레딧 동결을 풀면 안 된다.
  IF v_request.origin <> 'user'
     OR v_order.canceled_at IS NOT NULL
     OR v_ppt.cancel_feedback_recorded_at IS NOT NULL
     OR v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL
     OR (v_order.provider = 'kakaopay' AND v_ppt.provider_status = 'CANCEL_PAYMENT')
     OR v_request.last_error_code IN ('KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW') THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_REJECTABLE';
  END IF;

  IF v_request.status = 'manual_review'
     AND (p_provider_not_cancelled_confirmed IS NOT TRUE
          OR p_admin_id IS NULL
          OR NULLIF(BTRIM(p_admin_note), '') IS NULL) THEN
    RAISE EXCEPTION 'REFUND_REJECT_CONFIRMATION_REQUIRED';
  END IF;

  UPDATE public.credit_sources
     SET status = 'active'
   WHERE id = v_request.source_id
     AND status = 'pending_refund';

  UPDATE public.refund_requests
     SET status = 'rejected',
         admin_note = p_admin_note,
         processed_by = p_admin_id,
         processed_at = now()
   WHERE id = v_request.id;

  IF v_request.status = 'manual_review' THEN
    INSERT INTO public.payment_admin_actions (
      actor_id,
      action,
      payment_order_id,
      refund_request_id,
      before_state,
      after_state,
      note,
      details
    ) VALUES (
      p_admin_id,
      'manual_review_refund_rejected',
      v_order.id,
      v_request.id,
      jsonb_build_object('request_status', v_request.status, 'source_status', v_source.status),
      jsonb_build_object('request_status', 'rejected', 'source_status', 'active'),
      p_admin_note,
      jsonb_build_object('provider_not_cancelled_confirmed', true, 'last_error_code', v_request.last_error_code)
    );
  END IF;
END;
$function$
$old_reject$;
  v_actor uuid;
  v_texts jsonb;
  v_support jsonb;
  v_new jsonb;
  v_pair text[];
  v_added text[] := ARRAY[]::text[];
  v_differs text[] := ARRAY[]::text[];
  v_revision integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT p.id INTO v_actor FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.is_admin IS TRUE AND p.admin_role = 'owner' AND p.withdrawn_at IS NULL AND u.last_sign_in_at IS NOT NULL
   ORDER BY u.last_sign_in_at DESC LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'KEYS_RESTORE: signed-in owner account not found';
  END IF;
  SELECT value INTO v_texts FROM public.system_settings WHERE key = 'member_notification_texts';
  IF v_texts IS NULL THEN
    RAISE EXCEPTION 'KEYS_RESTORE: member_notification_texts missing';
  END IF;
  SELECT value INTO v_support FROM public.system_settings WHERE key = 'support_page_content' FOR UPDATE;
  IF v_support IS NULL OR jsonb_typeof(v_support -> 'member') IS DISTINCT FROM 'object' OR jsonb_typeof(v_support -> 'admin') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'KEYS_RESTORE: support_page_content missing';
  END IF;

  v_new := v_support;
  FOREACH v_pair SLICE 1 IN ARRAY c_pairs LOOP
    IF v_texts #> v_pair[2]::text[] IS NULL THEN
      RAISE EXCEPTION 'KEYS_RESTORE: member_notification_texts % missing', v_pair[2];
    END IF;
    IF v_support #> v_pair[1]::text[] IS NULL THEN
      v_new := jsonb_set(v_new, v_pair[1]::text[], v_texts #> v_pair[2]::text[], true);
      v_added := v_added || v_pair[1];
    ELSIF v_support #> v_pair[1]::text[] IS DISTINCT FROM v_texts #> v_pair[2]::text[] THEN
      v_differs := v_differs || v_pair[1];
      RAISE NOTICE 'KEYS_RESTORE: support_page_content % differs from member_notification_texts % — the old value will be used after code rollback; tell the owner',
        v_pair[1], v_pair[2];
    END IF;
  END LOOP;

  v_revision := (v_support ->> 'revision')::integer;
  IF cardinality(v_added) > 0 THEN
    v_new := jsonb_set(v_new, '{revision}', to_jsonb(v_revision + 1));
    UPDATE public.system_settings SET value = v_new, updated_at = v_now WHERE key = 'support_page_content';
  END IF;
  IF cardinality(v_added) > 0 OR cardinality(v_differs) > 0 THEN
    PERFORM public.record_admin_audit(v_actor, 'support_page_content_update', 'system_settings', 'support_page_content', NULL, NULL, NULL,
      jsonb_build_object('bundle', 'bundle16_support_keys_restore', 'added', to_jsonb(v_added), 'differs', to_jsonb(v_differs),
        'revision_before', v_revision, 'revision_after', v_revision + CASE WHEN cardinality(v_added) > 0 THEN 1 ELSE 0 END, 'saved_at', v_now),
      NULL);
  END IF;

  -- 옛 4인자 거절 함수
  IF to_regprocedure('public.reject_point_charge_refund(uuid,uuid,text,boolean)') IS NULL THEN
    EXECUTE c_old_reject;
    REVOKE EXECUTE ON FUNCTION public.reject_point_charge_refund(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.reject_point_charge_refund(uuid, uuid, text, boolean) TO service_role;
  END IF;
  IF md5(pg_get_functiondef('public.reject_point_charge_refund(uuid,uuid,text,boolean)'::regprocedure)) <> '20384719deba112e977fbd3bf8e266e5'
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.reject_point_charge_refund(uuid,uuid,text,boolean)'::regprocedure)
        IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'KEYS_RESTORE: old 4-arg reject_point_charge_refund definition or privileges differ';
  END IF;

  RAISE NOTICE 'KEYS_RESTORE: added % key(s), % differ(s)', cardinality(v_added), cardinality(v_differs);
END;
$bundle16_support_keys_restore$;

NOTIFY pgrst, 'reload schema';
COMMIT;
