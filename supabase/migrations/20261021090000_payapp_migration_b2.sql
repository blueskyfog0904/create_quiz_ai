-- 페이앱 전환 마이그레이션 B2 (정리). 계획 7단계, 체크리스트 B2-pre·B2-post.
-- 토스 제거 코드(24d5f7e)가 Production에 배포된 뒤(2026-10-21)에만 적용한다.
-- 1) prepare_payment_order가 'toss' 입력을 거부한다(인자·반환형 그대로, CREATE OR REPLACE).
-- 2) 토스 원천 환불을 막는다. 자격 함수는 REFUND_COMPLETED_PAYMENT_REQUIRED, claim은 REFUND_REQUEST_REVALIDATION_FAILED.
--    둘 다 기존 코드라 TS 문구 매핑은 바꾸지 않는다.
-- 3) 토스 전용 RPC 7개와 payment_runtime_config의 toss_* 컬럼 2개를 지운다.
-- 과거 이력을 위해 payment_orders.mid·payment_key, provider CHECK의 'toss', 스냅샷 CHECK의 toss 분기는 남긴다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 진행 중인 토스 주문·환불이 있으면 멈춘다(B2-pre 2). B2 뒤에는 이 건들을 처리할 함수가 없다.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.payment_orders
     WHERE provider = 'toss'
       AND status NOT IN ('completed', 'failed', 'expired', 'refunded')
  ) THEN
    RAISE EXCEPTION 'B2_PRECHECK: open toss payment orders';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.refund_requests
     WHERE provider = 'toss'
       AND status NOT IN ('completed', 'rejected')
  ) THEN
    RAISE EXCEPTION 'B2_PRECHECK: open toss refund requests';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. 주문 준비: 'toss' 입력 거부
--    아래 CASE의 toss 분기는 입력 검사에서 막혀 실행되지 않는다. A 정의와 차이를 줄이려고 남긴다.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prepare_payment_order(
  p_user_id uuid,
  p_checkout_attempt_id uuid,
  p_provider text,
  p_plan_id uuid,
  p_order_id text,
  p_plan_name_snapshot text,
  p_expected_amount integer,
  p_expected_credits integer,
  p_provider_environment text,
  p_provider_merchant_id text,
  p_request_fingerprint text,
  p_confirm_idempotency_key text,
  p_cancel_idempotency_key text,
  p_expires_at timestamp with time zone,
  p_tax_free_amount integer,
  p_vat_amount integer,
  p_partner_user_id text,
  p_payment_method_code text DEFAULT NULL
)
 RETURNS payment_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
BEGIN
  IF p_provider NOT IN ('kakaopay', 'payapp')
     OR p_provider_environment NOT IN ('test', 'live')
     OR NULLIF(BTRIM(p_provider_merchant_id), '') IS NULL
     OR NULLIF(BTRIM(p_request_fingerprint), '') IS NULL
     OR p_expected_amount NOT BETWEEN 1 AND 100000
     OR p_expected_credits < 1
     OR p_tax_free_amount NOT BETWEEN 0 AND p_expected_amount
     OR p_vat_amount NOT BETWEEN 0 AND p_expected_amount
     OR p_expires_at <= now()
     OR (p_provider = 'kakaopay' AND (
       NULLIF(BTRIM(p_partner_user_id), '') IS NULL
       OR p_tax_free_amount <> 0
       OR p_vat_amount <> round(p_expected_amount::numeric / 11)::integer
     ))
     OR (p_provider = 'payapp' AND (
       p_provider_environment <> 'live'
       OR p_vat_amount IS NULL
       OR p_tax_free_amount <> 0
       OR p_vat_amount <> round(p_expected_amount::numeric / 11)::integer
       OR NOT EXISTS (
         SELECT 1
           FROM public.payment_methods pm
          WHERE pm.code = p_payment_method_code
            AND pm.provider = 'payapp'
            AND pm.is_enabled
       )
     ))
     OR (p_provider = 'kakaopay' AND p_payment_method_code IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
             FROM public.payment_methods pm
            WHERE pm.code = p_payment_method_code
              AND pm.provider = p_provider
         )) THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_INPUT_INVALID';
  END IF;

  INSERT INTO public.checkout_attempts (
    user_id,
    checkout_attempt_id,
    claimed_provider,
    plan_id,
    request_fingerprint,
    expires_at
  ) VALUES (
    p_user_id,
    p_checkout_attempt_id,
    p_provider,
    p_plan_id,
    p_request_fingerprint,
    p_expires_at
  )
  ON CONFLICT (user_id, checkout_attempt_id) DO NOTHING;

  SELECT *
    INTO v_attempt
    FROM public.checkout_attempts
   WHERE user_id = p_user_id
     AND checkout_attempt_id = p_checkout_attempt_id
   FOR UPDATE;

  IF v_attempt.claimed_provider IS DISTINCT FROM p_provider
     OR v_attempt.plan_id IS DISTINCT FROM p_plan_id
     OR v_attempt.request_fingerprint IS DISTINCT FROM p_request_fingerprint THEN
    RAISE EXCEPTION 'PAYMENT_ATTEMPT_PAYLOAD_CONFLICT';
  END IF;

  IF v_attempt.payment_order_id IS NOT NULL THEN
    SELECT *
      INTO v_order
      FROM public.payment_orders
     WHERE id = v_attempt.payment_order_id;

    IF v_order.payment_method_code IS DISTINCT FROM p_payment_method_code THEN
      RAISE EXCEPTION 'PAYMENT_ATTEMPT_PAYLOAD_CONFLICT';
    END IF;

    RETURN v_order;
  END IF;

  INSERT INTO public.payment_orders (
    user_id,
    order_id,
    plan_id,
    plan_name_snapshot,
    expected_amount,
    expected_credits,
    provider,
    environment,
    provider_environment,
    mid,
    provider_merchant_id,
    partner_order_id,
    partner_user_id,
    tax_free_amount,
    vat_amount,
    status,
    request_fingerprint,
    checkout_attempt_id,
    confirm_idempotency_key,
    cancel_idempotency_key,
    expires_at,
    checkout_expires_at,
    ready_requested_at,
    ready_expires_at,
    payment_method_code
  ) VALUES (
    p_user_id,
    p_order_id,
    p_plan_id,
    p_plan_name_snapshot,
    p_expected_amount,
    p_expected_credits,
    p_provider,
    p_provider_environment,
    p_provider_environment,
    CASE
      WHEN p_provider = 'toss' THEN p_provider_merchant_id
      WHEN p_provider IN ('kakaopay', 'payapp') THEN NULL
    END,
    p_provider_merchant_id,
    p_order_id,
    CASE
      WHEN p_provider = 'kakaopay' THEN p_partner_user_id
      WHEN p_provider IN ('toss', 'payapp') THEN NULL
    END,
    p_tax_free_amount,
    p_vat_amount,
    CASE
      WHEN p_provider IN ('kakaopay', 'payapp') THEN 'preparing'
      WHEN p_provider = 'toss' THEN 'ready'
    END,
    p_request_fingerprint,
    v_attempt.id,
    p_confirm_idempotency_key,
    p_cancel_idempotency_key,
    p_expires_at,
    p_expires_at,
    CASE
      WHEN p_provider IN ('kakaopay', 'payapp') THEN now()
      WHEN p_provider = 'toss' THEN NULL
    END,
    CASE
      WHEN p_provider IN ('kakaopay', 'payapp') THEN p_expires_at
      WHEN p_provider = 'toss' THEN NULL
    END,
    p_payment_method_code
  )
  RETURNING * INTO v_order;

  UPDATE public.checkout_attempts
     SET payment_order_id = v_order.id,
         updated_at = now()
   WHERE id = v_attempt.id;

  RETURN v_order;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. 환불 자격·처리: 토스 원천 환불 불가
-- ---------------------------------------------------------------------------

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

CREATE OR REPLACE FUNCTION public.claim_point_charge_refund(p_request_id uuid, p_admin_id uuid, p_admin_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_request public.refund_requests%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_provider_transaction public.payment_provider_transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_request
    FROM public.refund_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_FOUND';
  END IF;

  IF v_request.status = 'completed' THEN
    RETURN jsonb_build_object(
      'already_completed', true,
      'request_id', v_request.id,
      'provider', v_request.provider
    );
  END IF;

  IF v_request.status NOT IN ('pending_review', 'retryable_failed') THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_CLAIMABLE';
  END IF;

  SELECT * INTO v_source
    FROM public.credit_sources
   WHERE id = v_request.source_id
   FOR UPDATE;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = v_request.payment_order_id
   FOR UPDATE;

  IF v_source.status <> 'pending_refund'
     OR v_source.remaining_credits <> v_source.initial_credits
     OR v_order.status <> 'completed'
     OR v_order.provider IS DISTINCT FROM v_request.provider THEN
    RAISE EXCEPTION 'REFUND_REQUEST_REVALIDATION_FAILED';
  END IF;

  -- 토스 결제는 종료했다(마이그레이션 B2). 토스 환불 요청은 처리할 수 없다.
  IF v_order.provider = 'toss' THEN
    RAISE EXCEPTION 'REFUND_REQUEST_REVALIDATION_FAILED';
  END IF;

  IF v_order.provider = 'kakaopay' THEN
    SELECT * INTO v_provider_transaction
      FROM public.payment_provider_transactions
     WHERE payment_order_id = v_order.id
       AND provider = 'kakaopay'
     FOR UPDATE;

    IF NOT FOUND
       OR v_provider_transaction.provider_transaction_id IS NULL
       OR v_provider_transaction.provider_approval_id IS NULL
       OR v_provider_transaction.provider_status <> 'SUCCESS_PAYMENT'
       OR v_provider_transaction.payment_method_type <> 'MONEY' THEN
      RAISE EXCEPTION 'REFUND_REQUEST_REVALIDATION_FAILED';
    END IF;
  END IF;

  IF v_order.provider = 'payapp' THEN
    SELECT * INTO v_provider_transaction
      FROM public.payment_provider_transactions
     WHERE payment_order_id = v_order.id
       AND provider = 'payapp'
     FOR UPDATE;

    IF NOT FOUND
       OR v_provider_transaction.provider_transaction_id IS NULL
       OR (v_provider_transaction.paid_feedback_recorded_at IS NULL
           AND v_provider_transaction.admin_paid_confirmed_at IS NULL)
       OR v_provider_transaction.cancel_feedback_recorded_at IS NOT NULL
       OR v_provider_transaction.partial_cancel_feedback_recorded_at IS NOT NULL THEN
      RAISE EXCEPTION 'REFUND_REQUEST_REVALIDATION_FAILED';
    END IF;
  END IF;

  UPDATE public.refund_requests
     SET status = 'processing',
         processed_by = p_admin_id,
         admin_note = p_admin_note,
         attempt_count = attempt_count + 1,
         next_attempt_at = NULL,
         last_error_code = NULL,
         last_error_message = NULL
   WHERE id = v_request.id;

  RETURN jsonb_build_object(
    'already_completed', false,
    'request_id', v_request.id,
    'user_id', v_request.user_id,
    'provider', v_order.provider,
    'payment_order_id', v_order.id,
    'provider_order_id', v_order.order_id,
    'payment_key', CASE WHEN v_order.provider = 'toss' THEN v_order.payment_key ELSE NULL END,
    'provider_transaction_id', v_provider_transaction.provider_transaction_id,
    'provider_approval_id', v_provider_transaction.provider_approval_id,
    'provider_merchant_id', v_order.provider_merchant_id,
    'partner_order_id', v_order.partner_order_id,
    'partner_user_id', v_order.partner_user_id,
    'cancel_idempotency_key', v_request.cancel_idempotency_key,
    'refund_amount', v_request.refund_amount,
    'tax_free_amount', v_order.tax_free_amount,
    'vat_amount', v_order.vat_amount
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.prepare_payment_order(uuid, uuid, text, uuid, text, text, integer, integer, text, text, text, text, text, timestamp with time zone, integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_payment_order(uuid, uuid, text, uuid, text, text, integer, integer, text, text, text, text, text, timestamp with time zone, integer, integer, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.get_point_charge_refund_eligibility(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_point_charge_refund_eligibility(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.claim_point_charge_refund(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_point_charge_refund(uuid, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. 토스 전용 RPC 7개와 토스 설정 컬럼 2개 삭제 (CASCADE 금지)
-- ---------------------------------------------------------------------------

DROP FUNCTION public.finalize_toss_payment(uuid, text, text, text, text, timestamp with time zone);
DROP FUNCTION public.get_toss_refund_eligibility(uuid, uuid);
DROP FUNCTION public.request_toss_refund(uuid, uuid, text);
DROP FUNCTION public.claim_toss_refund(uuid, uuid, text);
DROP FUNCTION public.finalize_toss_refund(uuid, text, timestamp with time zone);
DROP FUNCTION public.fail_toss_refund(uuid, text, text, boolean);
DROP FUNCTION public.reject_toss_refund(uuid, uuid, text);

ALTER TABLE public.payment_runtime_config
  DROP COLUMN toss_accepts_new_orders,
  DROP COLUMN toss_merchant_id;

-- 검증
DO $$
DECLARE
  v_message text;
BEGIN
  IF (SELECT COUNT(*) FROM pg_proc
       WHERE pronamespace = 'public'::regnamespace
         AND proname IN ('finalize_toss_payment', 'get_toss_refund_eligibility', 'request_toss_refund', 'claim_toss_refund', 'finalize_toss_refund', 'fail_toss_refund', 'reject_toss_refund')) <> 0 THEN
    RAISE EXCEPTION 'VERIFY: toss functions remain';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.payment_runtime_config'::regclass
       AND attname IN ('toss_accepts_new_orders', 'toss_merchant_id')
       AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'VERIFY: toss runtime columns remain';
  END IF;

  IF (SELECT COUNT(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'prepare_payment_order') <> 1
     OR (SELECT proacl::text FROM pg_proc WHERE oid = 'public.prepare_payment_order(uuid, uuid, text, uuid, text, text, integer, integer, text, text, text, text, text, timestamp with time zone, integer, integer, text, text)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.prepare_payment_order(uuid, uuid, text, uuid, text, text, integer, integer, text, text, text, text, text, timestamp with time zone, integer, integer, text, text)'::regprocedure)
     OR NOT (SELECT COALESCE(proconfig, '{}') @> ARRAY['search_path=public, pg_temp']
               FROM pg_proc WHERE oid = 'public.prepare_payment_order(uuid, uuid, text, uuid, text, text, integer, integer, text, text, text, text, text, timestamp with time zone, integer, integer, text, text)'::regprocedure) THEN
    RAISE EXCEPTION 'VERIFY: prepare_payment_order overload or privileges';
  END IF;

  IF (SELECT COUNT(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'get_point_charge_refund_eligibility') <> 1
     OR (SELECT proacl::text FROM pg_proc WHERE oid = 'public.get_point_charge_refund_eligibility(uuid, uuid)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_point_charge_refund_eligibility(uuid, uuid)'::regprocedure)
     OR NOT (SELECT COALESCE(proconfig, '{}') @> ARRAY['search_path=public, pg_temp']
               FROM pg_proc WHERE oid = 'public.get_point_charge_refund_eligibility(uuid, uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'VERIFY: get_point_charge_refund_eligibility overload or privileges';
  END IF;

  IF (SELECT COUNT(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'claim_point_charge_refund') <> 1
     OR (SELECT proacl::text FROM pg_proc WHERE oid = 'public.claim_point_charge_refund(uuid, uuid, text)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.claim_point_charge_refund(uuid, uuid, text)'::regprocedure)
     OR NOT (SELECT COALESCE(proconfig, '{}') @> ARRAY['search_path=public, pg_temp']
               FROM pg_proc WHERE oid = 'public.claim_point_charge_refund(uuid, uuid, text)'::regprocedure) THEN
    RAISE EXCEPTION 'VERIFY: claim_point_charge_refund overload or privileges';
  END IF;

  IF (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'prepare_payment_order') IS DISTINCT FROM '6cc574cf1d196a3bc9f1c4f445492a0a' THEN
    RAISE EXCEPTION 'VERIFY: prepare_payment_order body';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'get_point_charge_refund_eligibility') IS DISTINCT FROM 'd9f208c2d0ec4b1e758d04e2cf319468' THEN
    RAISE EXCEPTION 'VERIFY: get_point_charge_refund_eligibility body';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'claim_point_charge_refund') IS DISTINCT FROM '2f18542934ba152e3a8d72a037e56e71' THEN
    RAISE EXCEPTION 'VERIFY: claim_point_charge_refund body';
  END IF;

  -- 과거 이력을 위해 남기는 것: provider CHECK 5곳과 스냅샷 CHECK의 'toss', payment_orders.mid·payment_key
  IF (SELECT COUNT(*) FROM pg_constraint
       WHERE contype = 'c'
         AND connamespace = 'public'::regnamespace
         AND convalidated
         AND conname IN (
           'checkout_attempts_claimed_provider_check',
           'payment_orders_provider_check',
           'payment_orders_provider_snapshot_check',
           'payment_provider_transactions_provider_check',
           'payment_reconciliation_items_provider_check',
           'refund_requests_provider_check'
         )
         AND pg_get_constraintdef(oid) LIKE '%''toss''%') <> 6 THEN
    RAISE EXCEPTION 'VERIFY: toss history checks changed';
  END IF;

  IF (SELECT COUNT(*) FROM pg_attribute
       WHERE attrelid = 'public.payment_orders'::regclass
         AND attname IN ('mid', 'payment_key')
         AND NOT attisdropped) <> 2 THEN
    RAISE EXCEPTION 'VERIFY: payment_orders toss columns missing';
  END IF;

  -- 'toss' 주문 준비는 입력 검사에서 거부되어야 한다(행을 만들지 않는다).
  BEGIN
    PERFORM public.prepare_payment_order(
      gen_random_uuid(), gen_random_uuid(), 'toss', NULL, 'B2_VERIFY_ORDER', 'B2 verify', 1000, 10,
      'test', 'B2_VERIFY_MID', 'B2_VERIFY_FINGERPRINT', 'B2_VERIFY_CONFIRM', 'B2_VERIFY_CANCEL',
      now() + interval '10 minutes', 0, 91, NULL, NULL
    );
    RAISE EXCEPTION 'VERIFY: toss order was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message IS DISTINCT FROM 'PAYMENT_ORDER_INPUT_INVALID' THEN
      RAISE EXCEPTION 'VERIFY: toss order not rejected by input check (%)', v_message;
    END IF;
  END;
END;
$$;

NOTIFY pgrst, 'reload schema';
