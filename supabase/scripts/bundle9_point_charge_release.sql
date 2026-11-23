-- 9번 묶음 런북 0 — 충전 크레딧 수동 사용 보류 해제 템플릿(대표 승인 뒤, SQL 편집기 postgres 로).
-- bundle9_point_charge_hold.sql 로 보류한 요청만 푼다. 먼저 확인하고 하나라도 어긋나면 멈춘다(그 경우 수동 완료로 처리):
--   요청이 manual_review·last_error_code 'MANUAL_TEMPLATE_HOLD', 주문이 refunded 아님,
--   취소·부분취소 통보 표식이 보류 작업 기록(details)의 값과 같음(보류 중 승인취소 통보가 왔으면 해제하지 않음),
--   보류 전 요청이 회원이 낸 신청(origin 'user')이었으면 해제하지 않는다 — 회원에게 연락한 뒤 수동 완료로.
-- 하는 일(한 트랜잭션): 그 요청을 rejected 로 닫고, 원래 원천과 held_reissued_source_ids 중 pending_refund 인 것만 active 로,
--   작업 기록 'point_charge_source_release'. 잔액(profiles.credits)은 그대로.
-- 잠금 순서: 요청 → 원래 원천 → 주문 → 결제 기록 → profiles → 자손(id 순).
--
-- 1) 아래 세 자리(<<…>>)를 바꾼다. 2) [확인] 을 먼저 실행한다. 3) [실행] 을 실행한다(실패하면 아무것도 바뀌지 않음).

-- [확인] 읽기 전용 -----------------------------------------------------------------------------------------------
SELECT r.id, r.status, r.origin, r.last_error_code, r.held_reissued_source_ids, r.source_id,
       c.status AS source_status, o.id AS payment_order_id, o.status AS order_status,
       t.cancel_feedback_recorded_at, t.partial_cancel_feedback_recorded_at,
       (SELECT a.details FROM public.admin_audit_log a
         WHERE a.action = 'point_charge_source_hold' AND a.target_id = r.id::text
         ORDER BY a.created_at DESC LIMIT 1) AS hold_details
  FROM public.refund_requests r
  LEFT JOIN public.credit_sources c ON c.id = r.source_id
  LEFT JOIN public.payment_orders o ON o.id = r.payment_order_id
  LEFT JOIN public.payment_provider_transactions t ON t.payment_order_id = o.id
 WHERE r.id = '<<보류한_환불_요청_ID>>';

-- [실행] ---------------------------------------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $point_charge_release$
DECLARE
  v_request_id uuid := '<<보류한_환불_요청_ID>>';
  v_actor_id uuid := '<<지시한_관리자_profiles_ID>>';
  v_reason text := '<<사유: 해제 근거>>';
  v_request public.refund_requests%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_hold jsonb;
  v_released uuid[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_actor_id AND is_admin IS TRUE) THEN
    RAISE EXCEPTION 'RELEASE_ACTOR_NOT_ADMIN';
  END IF;
  IF NULLIF(btrim(v_reason), '') IS NULL OR v_reason LIKE '<<%' THEN
    RAISE EXCEPTION 'RELEASE_REASON_REQUIRED';
  END IF;

  SELECT * INTO v_request FROM public.refund_requests WHERE id = v_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'manual_review' OR v_request.last_error_code IS DISTINCT FROM 'MANUAL_TEMPLATE_HOLD' THEN
    RAISE EXCEPTION 'RELEASE_NOT_TEMPLATE_HOLD: 보류 템플릿으로 만든 수동 확인 요청이 아닙니다 — 수동 완료로 처리하세요';
  END IF;
  SELECT * INTO v_source FROM public.credit_sources WHERE id = v_request.source_id FOR UPDATE;
  SELECT * INTO v_order FROM public.payment_orders WHERE id = v_request.payment_order_id FOR UPDATE;
  SELECT * INTO v_ppt FROM public.payment_provider_transactions WHERE payment_order_id = v_order.id FOR UPDATE;
  PERFORM 1 FROM public.profiles WHERE id = v_request.user_id FOR UPDATE;

  IF v_order.id IS NULL OR v_order.status = 'refunded' THEN
    RAISE EXCEPTION 'RELEASE_ORDER_REFUNDED: 이미 환불된 결제입니다';
  END IF;

  SELECT a.details INTO v_hold
    FROM public.admin_audit_log a
   WHERE a.action = 'point_charge_source_hold' AND a.target_id = v_request.id::text
   ORDER BY a.created_at DESC
   LIMIT 1;
  IF v_hold IS NULL THEN
    RAISE EXCEPTION 'RELEASE_HOLD_RECORD_MISSING: 보류 작업 기록이 없습니다 — 수동 완료로 처리하세요';
  END IF;
  -- 시각은 timestamptz 로 되돌려 비교한다(세션 시간대에 따라 글자가 달라도 같은 시각이면 같음).
  IF (v_hold ->> 'cancel_feedback_recorded_at')::timestamptz IS DISTINCT FROM v_ppt.cancel_feedback_recorded_at THEN
    RAISE EXCEPTION 'RELEASE_CANCEL_MARKER_CHANGED: 보류 중 결제 취소 통보가 왔습니다 — 수동 완료로 처리하세요';
  END IF;
  IF (v_hold ->> 'partial_cancel_feedback_recorded_at')::timestamptz IS DISTINCT FROM v_ppt.partial_cancel_feedback_recorded_at THEN
    RAISE EXCEPTION 'RELEASE_PARTIAL_CANCEL_MARKER_CHANGED: 보류 중 부분취소 통보가 왔습니다 — 수동 완료로 처리하세요';
  END IF;
  IF v_hold -> 'request_before' ->> 'origin' = 'user' THEN
    RAISE EXCEPTION 'RELEASE_MEMBER_REQUEST: 보류 전 회원이 낸 환불 신청이었습니다 — 회원에게 연락한 뒤 수동 완료로 처리하세요';
  END IF;

  SELECT ARRAY(
    SELECT c.id FROM public.credit_sources c
     WHERE c.id = ANY (v_request.held_reissued_source_ids) AND c.status = 'pending_refund'
     ORDER BY c.id
       FOR UPDATE
  ) INTO v_released;

  UPDATE public.refund_requests
     SET status = 'rejected',
         admin_note = v_reason,
         processed_by = v_actor_id,
         processed_at = now(),
         next_attempt_at = NULL
   WHERE id = v_request.id;
  UPDATE public.credit_sources SET status = 'active' WHERE id = v_source.id AND status = 'pending_refund';
  UPDATE public.credit_sources SET status = 'active' WHERE id = ANY (v_released) AND status = 'pending_refund';

  PERFORM public.record_admin_audit(v_actor_id, 'point_charge_source_release', 'refund_request', v_request.id::text, v_request.user_id, NULL, v_reason,
    jsonb_build_object(
      'source_id', v_source.id, 'source_status_before', v_source.status, 'payment_order_id', v_order.id, 'order_id', v_order.order_id,
      'released_reissued_source_ids', to_jsonb(v_released), 'template', 'supabase/scripts/bundle9_point_charge_release.sql'),
    NULL);

  RAISE NOTICE 'RELEASE_OK request %, released reissued %', v_request.id, v_released;
END;
$point_charge_release$;

COMMIT;
