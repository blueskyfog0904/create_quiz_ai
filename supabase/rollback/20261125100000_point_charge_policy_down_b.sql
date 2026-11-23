-- 되돌리기 (나) 판정·동의: 판정 함수를 원래 정의로, 동의 기록 함수·수동 완료 미리보기 함수를 지운다.
-- 코드 배포 전에만 실행한다(새 코드는 동의 기록 함수가 없으면 결제를 막는다). 배포 뒤라면 코드를 먼저 9번 이전으로 되돌린다
-- (단 약관 스크립트가 돈 뒤에는 코드를 되돌리지 않는다 — 앞으로 고침). 동의 기록이 1건이라도 있으면 멈춘다(증빙).
-- 헬퍼 4개(credit_source_paid_root, credit_source_reissued_descendants, point_charge_refund_days, point_charge_refund_deadline)·
-- 설정·표·열·정책은 남긴다. 다시 적용하려면 schema_migrations 의 '20261125100000' 행도 지운다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $down_b_precheck$
BEGIN
  IF EXISTS (SELECT 1 FROM public.point_charge_checkout_acks) THEN
    RAISE EXCEPTION 'DOWN_B_BLOCKED: checkout acks exist (evidence)';
  END IF;
END;
$down_b_precheck$;

DROP FUNCTION IF EXISTS public.record_point_charge_checkout_ack(uuid, uuid, uuid, integer, integer, text);
DROP FUNCTION IF EXISTS public.get_manual_refund_recovery_preview(uuid);

CREATE OR REPLACE FUNCTION public.get_point_charge_refund_eligibility(p_user_id uuid, p_source_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_source public.credit_sources%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_refundable_until timestamptz;
BEGIN
  SELECT * INTO v_source
    FROM public.credit_sources
   WHERE id = p_source_id
     AND user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason_code', 'REFUND_SOURCE_NOT_FOUND');
  END IF;

  IF v_source.payment_order_id IS NULL
     OR v_source.source_category <> 'plan_purchase' THEN
    RETURN jsonb_build_object('allowed', false, 'reason_code', 'REFUND_PAID_SOURCE_REQUIRED');
  END IF;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = v_source.payment_order_id
     AND user_id = p_user_id;

  IF NOT FOUND
     OR v_order.status <> 'completed'
     OR v_order.approved_at IS NULL
     OR (
       v_order.provider = 'toss'
       AND v_order.payment_key IS NULL
     )
     OR (
       v_order.provider = 'kakaopay'
       AND NOT EXISTS (
         SELECT 1
           FROM public.payment_provider_transactions ppt
          WHERE ppt.payment_order_id = v_order.id
            AND ppt.provider = 'kakaopay'
            AND ppt.provider_transaction_id IS NOT NULL
            AND ppt.provider_approval_id IS NOT NULL
            AND ppt.provider_status = 'SUCCESS_PAYMENT'
            AND ppt.payment_method_type = 'MONEY'
       )
     )
     OR (
       v_order.provider = 'payapp'
       AND NOT EXISTS (
         SELECT 1
           FROM public.payment_provider_transactions ppt
          WHERE ppt.payment_order_id = v_order.id
            AND ppt.provider = 'payapp'
            AND ppt.provider_transaction_id IS NOT NULL
            AND (ppt.paid_feedback_recorded_at IS NOT NULL OR ppt.admin_paid_confirmed_at IS NOT NULL)
            AND ppt.cancel_feedback_recorded_at IS NULL
            AND ppt.partial_cancel_feedback_recorded_at IS NULL
       )
     ) THEN
    RETURN jsonb_build_object('allowed', false, 'reason_code', 'REFUND_COMPLETED_PAYMENT_REQUIRED');
  END IF;

  v_refundable_until := v_order.approved_at + interval '7 days';

  IF v_source.status <> 'active'
     OR EXISTS (
       SELECT 1
         FROM public.refund_requests rr
        WHERE rr.source_id = v_source.id
          AND rr.status = 'completed'
     ) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason_code', 'REFUND_SOURCE_NOT_ACTIVE',
      'refundable_until', v_refundable_until
    );
  END IF;

  IF v_source.remaining_credits <> v_source.initial_credits THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason_code', 'REFUND_CREDITS_ALREADY_USED',
      'refundable_until', v_refundable_until
    );
  END IF;

  IF v_source.expires_at IS NOT NULL AND v_source.expires_at <= now() THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason_code', 'REFUND_SOURCE_EXPIRED',
      'refundable_until', v_refundable_until
    );
  END IF;

  IF now() > v_refundable_until THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason_code', 'REFUND_REQUEST_PERIOD_EXPIRED',
      'refundable_until', v_refundable_until
    );
  END IF;

  -- 토스 결제는 종료했다(마이그레이션 B2). 다른 불가 사유가 먼저 보이도록 마지막에 막는다.
  IF v_order.provider = 'toss' THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason_code', 'REFUND_COMPLETED_PAYMENT_REQUIRED',
      'refundable_until', v_refundable_until
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'reason_code', null,
    'provider', v_order.provider,
    'refundable_until', v_refundable_until
  );
END;
$function$;

DO $down_b_verify$
BEGIN
  IF md5(pg_get_functiondef('public.get_point_charge_refund_eligibility(uuid,uuid)'::regprocedure)) <> '0245acd07bad83535eb6e1099cffae7a' THEN
    RAISE EXCEPTION 'DOWN_B_VERIFY: eligibility md5 not restored';
  END IF;
  IF to_regprocedure('public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'DOWN_B_VERIFY: record function left';
  END IF;
  IF to_regprocedure('public.get_manual_refund_recovery_preview(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'DOWN_B_VERIFY: preview function left';
  END IF;
END;
$down_b_verify$;

NOTIFY pgrst, 'reload schema';
