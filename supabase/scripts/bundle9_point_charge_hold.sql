-- 9번 묶음 런북 0(사용 보류 수단) — 충전 크레딧 수동 사용 보류 템플릿(대표 승인 뒤, SQL 편집기 postgres 로).
-- 쓰는 때: PG(페이앱 콘솔)로 결제를 취소할 수 없는 경우(휴대폰 결제 당월 경과·미성년자 결제 취소의 PG 불가 분기 등).
--   PG 로 취소할 수 있으면 이 템플릿 대신 '접수 즉시 페이앱 콘솔 전취소'(취소 통보 → 격리가 원래·다시 지급한 크레딧을 묶음).
-- 하는 일(한 트랜잭션): 원래 충전 원천의 열린 요청을 확인해
--   manual_review 면 멈춤(이미 격리됨 — 수동 완료로), processing 이면 멈춤,
--   pending_review·retryable_failed 면 새로 만들지 않고 그 요청을 manual_review·origin 'external_cancel'·last_error_code 'MANUAL_TEMPLATE_HOLD' 로 바꿈
--   (바꾸기 전 origin·status 와 취소·부분취소 표식 값을 작업 기록 details 에 남김), 없으면 같은 값으로 요청을 만든다
--   (origin 'external_cancel' 이라 관리자 거절이 막힌다 — 자손이 묶인 채 남지 않게 해제는 release 템플릿으로만).
--   → 원래 원천을 pending_refund → 이 결제에서 비롯해 다시 지급한 크레딧 중 active 를 id 순으로 잠가 pending_refund
--   → 같은 요청의 held_reissued_source_ids 에 기록 → 경보(다시 지급한 크레딧이 있을 때) → 작업 기록 'point_charge_source_hold'.
-- 잔액(profiles.credits)은 바꾸지 않는다(보류 중인 크레딧은 쓸 수 없고, 회수는 수동 완료가 한다).
-- 잠금 순서: 요청 → 원래 원천 → 주문 → 결제 기록 → profiles → 자손(id 순) — 외부 취소 격리와 같다.
-- 다음 단계: 관리자 환불 화면의 수동 완료(전액 모드, bank_transfer 등). 보류를 풀 때는 bundle9_point_charge_release.sql.
--
-- 1) 아래 세 자리(<<…>>)를 바꾼다. 2) [확인] 을 먼저 실행해 대상을 본다. 3) [실행] 을 실행한다(실패하면 아무것도 바뀌지 않음).

-- [확인] 읽기 전용 -----------------------------------------------------------------------------------------------
SELECT c.id AS source_id, c.user_id, c.source_category, c.status, c.initial_credits, c.remaining_credits, c.expires_at,
       o.id AS payment_order_id, o.order_id, o.status AS order_status, o.expected_amount, o.approved_at,
       t.cancel_feedback_recorded_at, t.partial_cancel_feedback_recorded_at,
       (SELECT jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'origin', r.origin, 'last_error_code', r.last_error_code))
          FROM public.refund_requests r WHERE r.source_id = c.id) AS refund_requests,
       (SELECT jsonb_agg(jsonb_build_object('id', d.id, 'status', d.status, 'remaining', d.remaining_credits, 'expires_at', d.expires_at))
          FROM public.credit_sources d WHERE d.id IN (SELECT x FROM public.credit_source_reissued_descendants(c.id) x)) AS reissued_sources
  FROM public.credit_sources c
  LEFT JOIN public.payment_orders o ON o.id = c.payment_order_id
  LEFT JOIN public.payment_provider_transactions t ON t.payment_order_id = o.id
 WHERE c.id = '<<원래_충전_원천_ID>>';

-- [실행] ---------------------------------------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $point_charge_hold$
DECLARE
  v_source_id uuid := '<<원래_충전_원천_ID>>';
  v_actor_id uuid := '<<지시한_관리자_profiles_ID>>';
  v_reason text := '<<사유: 런북 번호·접수 시각·근거>>';
  v_pre_request_id uuid;
  v_now_request_id uuid;
  v_request public.refund_requests%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_request_before jsonb;
  v_created boolean := false;
  v_held uuid[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_actor_id AND is_admin IS TRUE) THEN
    RAISE EXCEPTION 'HOLD_ACTOR_NOT_ADMIN';
  END IF;
  IF NULLIF(btrim(v_reason), '') IS NULL OR v_reason LIKE '<<%' THEN
    RAISE EXCEPTION 'HOLD_REASON_REQUIRED';
  END IF;

  SELECT id INTO v_pre_request_id
    FROM public.refund_requests
   WHERE source_id = v_source_id
     AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review')
   ORDER BY created_at DESC
   LIMIT 1;
  IF v_pre_request_id IS NOT NULL THEN
    SELECT * INTO v_request FROM public.refund_requests WHERE id = v_pre_request_id FOR UPDATE;
  END IF;

  SELECT * INTO v_source FROM public.credit_sources WHERE id = v_source_id FOR UPDATE;
  IF NOT FOUND OR v_source.source_category <> 'plan_purchase' OR v_source.payment_order_id IS NULL THEN
    RAISE EXCEPTION 'HOLD_PAID_SOURCE_REQUIRED: 결제로 충전한 원래 원천 id 를 넣어 주세요';
  END IF;
  SELECT * INTO v_order FROM public.payment_orders WHERE id = v_source.payment_order_id FOR UPDATE;
  SELECT * INTO v_ppt FROM public.payment_provider_transactions WHERE payment_order_id = v_order.id FOR UPDATE;
  PERFORM 1 FROM public.profiles WHERE id = v_source.user_id FOR UPDATE;

  SELECT id INTO v_now_request_id
    FROM public.refund_requests
   WHERE source_id = v_source_id
     AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review')
   ORDER BY created_at DESC
   LIMIT 1;
  IF v_now_request_id IS DISTINCT FROM v_pre_request_id THEN
    RAISE EXCEPTION 'HOLD_STATE_CHANGED: 다시 실행해 주세요';
  END IF;

  IF v_request.status = 'manual_review' THEN
    RAISE EXCEPTION 'HOLD_ALREADY_QUARANTINED: 이미 격리된 결제입니다 — 관리자 환불 화면에서 수동 완료로 처리하세요 (요청 %)', v_request.id;
  END IF;
  IF v_request.status = 'processing' THEN
    RAISE EXCEPTION 'HOLD_REQUEST_PROCESSING: 결제 취소를 처리 중인 요청이 있습니다 — 끝난 뒤 다시 확인하세요 (요청 %)', v_request.id;
  END IF;
  IF v_order.status <> 'completed' THEN
    RAISE EXCEPTION 'HOLD_ORDER_NOT_COMPLETED: 주문 상태 % — 관리자 환불 화면에서 확인하세요', v_order.status;
  END IF;
  IF v_source.status NOT IN ('active', 'pending_refund')
     OR (v_source.status = 'pending_refund' AND v_request.id IS NULL) THEN
    RAISE EXCEPTION 'HOLD_SOURCE_STATE: 원래 원천 상태 % — 관리자 환불 화면에서 확인하세요', v_source.status;
  END IF;

  IF v_request.id IS NOT NULL THEN
    v_request_before := jsonb_build_object('id', v_request.id, 'origin', v_request.origin, 'status', v_request.status,
                                           'last_error_code', v_request.last_error_code);
    UPDATE public.refund_requests
       SET status = 'manual_review',
           origin = 'external_cancel',
           next_attempt_at = NULL,
           last_error_code = 'MANUAL_TEMPLATE_HOLD',
           last_error_message = '대표 승인 사용 보류(SQL 템플릿). 관리자 환불 화면에서 수동 완료하거나 해제 템플릿으로 푸세요.'
     WHERE id = v_request.id;
  ELSE
    INSERT INTO public.refund_requests (
      user_id, source_id, reason, status, payment_order_id, provider, refund_amount,
      cancel_idempotency_key, last_error_code, last_error_message, origin
    ) VALUES (
      v_source.user_id, v_source.id, '대표 승인 사용 보류(SQL 템플릿)', 'manual_review', v_order.id, v_order.provider,
      v_order.expected_amount, v_order.cancel_idempotency_key, 'MANUAL_TEMPLATE_HOLD',
      '대표 승인 사용 보류(SQL 템플릿). 관리자 환불 화면에서 수동 완료하거나 해제 템플릿으로 푸세요.', 'external_cancel'
    )
    RETURNING * INTO v_request;
    v_created := true;
  END IF;

  UPDATE public.credit_sources SET status = 'pending_refund' WHERE id = v_source.id AND status = 'active';
  v_held := public.point_charge_hold_reissued(v_source.id, v_request.id);
  PERFORM public.point_charge_reissued_alert('REISSUED_CREDIT_HELD', v_request.id, v_order.id, v_source.id);

  PERFORM public.record_admin_audit(v_actor_id, 'point_charge_source_hold', 'refund_request', v_request.id::text, v_source.user_id, NULL, v_reason,
    jsonb_build_object(
      'source_id', v_source.id, 'source_status_before', v_source.status, 'payment_order_id', v_order.id, 'order_id', v_order.order_id,
      'request_created', v_created, 'request_before', v_request_before,
      'cancel_feedback_recorded_at', v_ppt.cancel_feedback_recorded_at,
      'partial_cancel_feedback_recorded_at', v_ppt.partial_cancel_feedback_recorded_at,
      'held_reissued_source_ids', to_jsonb(v_held), 'template', 'supabase/scripts/bundle9_point_charge_hold.sql'),
    NULL);

  RAISE NOTICE 'HOLD_OK request % (created %), held reissued %', v_request.id, v_created, v_held;
END;
$point_charge_hold$;

COMMIT;
