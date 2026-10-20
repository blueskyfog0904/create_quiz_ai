-- 페이앱 일반결제 추가 + 카카오페이 직접결제 유지 (마이그레이션 A: 추가와 기존 결함 수정)
-- 계획: docs/payapp-kakaopay-payment-implementation-plan.md 5장, 체크리스트: docs/payapp-db-migration-checklist.md
-- 토스·카카오 동작은 그대로 두고 페이앱 객체를 추가한다. 페이앱 판매 스위치는 false로 시작한다.

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 바꿀 테이블을 한 번에 같은 순서로 잠근다. health cron(payment_orders 읽기 → payment_runtime_config 쓰기)과는
-- 교착하지 않는다. 진행 중인 환불 RPC와 엇갈리면 교착 탐지나 lock_timeout으로 한쪽이 롤백되므로 다시 적용한다.
LOCK TABLE
  public.payment_orders,
  public.payment_provider_transactions,
  public.refund_requests,
  public.checkout_attempts,
  public.payment_reconciliation_items,
  public.payment_runtime_config
  IN ACCESS EXCLUSIVE MODE;

-- ---------------------------------------------------------------------------
-- 1. 결제수단 목록 (5.1)
-- ---------------------------------------------------------------------------

CREATE TABLE public.payment_methods (
  code text PRIMARY KEY,
  label text NOT NULL,
  description text,
  provider text NOT NULL,
  provider_open_pay_type text,
  provider_pay_types integer[],
  sort_order integer NOT NULL DEFAULT 0,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_methods_code_provider_key UNIQUE (code, provider),
  CONSTRAINT payment_methods_provider_check
    CHECK (provider IN ('payapp', 'kakaopay')),
  CONSTRAINT payment_methods_label_check
    CHECK (NULLIF(BTRIM(label), '') IS NOT NULL),
  CONSTRAINT payment_methods_provider_fields_check
    CHECK (
      (provider = 'payapp') = (
        provider_open_pay_type IS NOT NULL
        AND COALESCE(cardinality(provider_pay_types), 0) > 0
      )
    )
);

CREATE TRIGGER update_payment_methods_updated_at
  BEFORE UPDATE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_methods FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.payment_methods TO service_role;

INSERT INTO public.payment_methods (
  code,
  label,
  description,
  provider,
  provider_open_pay_type,
  provider_pay_types,
  sort_order
) VALUES
  ('card', '신용·체크카드', NULL, 'payapp', 'card', ARRAY[1], 10),
  ('kakaopay', '카카오페이', NULL, 'kakaopay', NULL, NULL, 20),
  ('naverpay', '네이버페이', NULL, 'payapp', 'naverpay', ARRAY[16], 30),
  ('tosspay', '토스페이', NULL, 'payapp', 'tosspay', ARRAY[25], 40),
  ('phone', '휴대폰 결제', '결제한 달이 지나면 환불이 늦어질 수 있어요', 'payapp', 'phone', ARRAY[2], 50);

-- ---------------------------------------------------------------------------
-- 2. 운영 스위치 (5.3). 페이앱은 꺼진 상태로 시작한다.
-- ---------------------------------------------------------------------------

ALTER TABLE public.payment_runtime_config
  ADD COLUMN payapp_accepts_new_orders boolean NOT NULL DEFAULT false,
  ADD COLUMN payapp_merchant_id text;

-- ---------------------------------------------------------------------------
-- 3. 결제사 값 'payapp' (5.2). 토스 이력 행 때문에 'toss'는 남긴다.
-- ---------------------------------------------------------------------------

ALTER TABLE public.payment_orders
  ALTER COLUMN provider DROP DEFAULT,
  ADD COLUMN payment_method_code text,
  DROP CONSTRAINT payment_orders_provider_check,
  ADD CONSTRAINT payment_orders_provider_check
    CHECK (provider IN ('toss', 'kakaopay', 'payapp')),
  DROP CONSTRAINT payment_orders_provider_snapshot_check,
  ADD CONSTRAINT payment_orders_provider_snapshot_check
    CHECK (
      provider_environment = environment
      AND (
        (
          provider = 'toss'
          AND mid IS NOT NULL
          AND provider_merchant_id = mid
        )
        OR (
          provider = 'kakaopay'
          AND mid IS NULL
          AND tax_free_amount = 0
          AND vat_amount = round(expected_amount::numeric / 11)::integer
        )
        OR (
          provider = 'payapp'
          AND mid IS NULL
          AND provider_environment = 'live'
          AND tax_free_amount = 0
          AND vat_amount IS NOT NULL
          AND vat_amount = round(expected_amount::numeric / 11)::integer
        )
      )
    ),
  ADD CONSTRAINT payment_orders_payment_method_fkey
    FOREIGN KEY (payment_method_code, provider)
    REFERENCES public.payment_methods (code, provider)
    ON DELETE RESTRICT,
  ADD CONSTRAINT payment_orders_payapp_payment_method_check
    CHECK (provider <> 'payapp' OR payment_method_code IS NOT NULL);

ALTER TABLE public.checkout_attempts
  DROP CONSTRAINT checkout_attempts_claimed_provider_check,
  ADD CONSTRAINT checkout_attempts_claimed_provider_check
    CHECK (claimed_provider IN ('toss', 'kakaopay', 'payapp'));

ALTER TABLE public.payment_provider_transactions
  DROP CONSTRAINT payment_provider_transactions_provider_check,
  ADD CONSTRAINT payment_provider_transactions_provider_check
    CHECK (provider IN ('toss', 'kakaopay', 'payapp'));

ALTER TABLE public.refund_requests
  DROP CONSTRAINT refund_requests_provider_check,
  ADD CONSTRAINT refund_requests_provider_check
    CHECK (provider IN ('toss', 'kakaopay', 'payapp'));

ALTER TABLE public.payment_reconciliation_items
  DROP CONSTRAINT payment_reconciliation_items_provider_check,
  ADD CONSTRAINT payment_reconciliation_items_provider_check
    CHECK (provider IN ('toss', 'kakaopay', 'payapp'));

-- ---------------------------------------------------------------------------
-- 4. 결제사 거래 표식 컬럼 (5.2 표). 한 번 설정하면 트리거가 변경을 막는다.
--    카카오는 partial_cancel_feedback_recorded_at·partial_cancel_processed_at만 쓴다.
-- ---------------------------------------------------------------------------

ALTER TABLE public.payment_provider_transactions
  ADD COLUMN paid_feedback_recorded_at timestamptz,
  ADD COLUMN paid_amount integer,
  ADD COLUMN cancel_feedback_recorded_at timestamptz,
  ADD COLUMN partial_cancel_feedback_recorded_at timestamptz,
  ADD COLUMN admin_paid_confirmed_at timestamptz,
  ADD COLUMN fulfillment_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN cancel_processed_at timestamptz,
  ADD COLUMN partial_cancel_processed_at timestamptz,
  ADD COLUMN provider_paid_at timestamptz,
  ADD COLUMN provider_cancelled_at timestamptz,
  ADD COLUMN partial_cancel_amount integer,
  ADD CONSTRAINT payment_provider_transactions_paid_amount_check
    CHECK (paid_amount IS NULL OR paid_amount BETWEEN 1 AND 100000),
  ADD CONSTRAINT payment_provider_transactions_partial_cancel_amount_check
    CHECK (partial_cancel_amount IS NULL OR partial_cancel_amount BETWEEN 1 AND 100000),
  ADD CONSTRAINT payment_provider_transactions_fulfillment_attempt_count_check
    CHECK (fulfillment_attempt_count >= 0);

-- ---------------------------------------------------------------------------
-- 5. 환불 요청 출처와 환불 키 인덱스 (5.2, 5.5 인덱스 수정)
-- ---------------------------------------------------------------------------

ALTER TABLE public.refund_requests
  ADD COLUMN origin text NOT NULL DEFAULT 'user',
  ADD CONSTRAINT refund_requests_origin_check
    CHECK (origin IN ('user', 'external_cancel', 'partial_cancel'));

-- 상태와 무관한 unique였던 탓에 거절 뒤 재신청·외부 취소 격리가 23505로 실패했다.
-- 열린 상태로 좁히는 것이라 기존 행은 모두 통과한다.
DROP INDEX public.refund_requests_cancel_idempotency_key;
CREATE UNIQUE INDEX refund_requests_cancel_idempotency_key
  ON public.refund_requests (cancel_idempotency_key)
  WHERE cancel_idempotency_key IS NOT NULL
    AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review');

-- ---------------------------------------------------------------------------
-- 6. 불변 트리거 (5.2). 트리거 함수는 SECURITY INVOKER 그대로 둔다.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_payment_order_snapshot_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
     OR NEW.plan_name_snapshot IS DISTINCT FROM OLD.plan_name_snapshot
     OR NEW.expected_amount IS DISTINCT FROM OLD.expected_amount
     OR NEW.expected_credits IS DISTINCT FROM OLD.expected_credits
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.environment IS DISTINCT FROM OLD.environment
     OR NEW.provider_environment IS DISTINCT FROM OLD.provider_environment
     OR NEW.mid IS DISTINCT FROM OLD.mid
     OR NEW.provider_merchant_id IS DISTINCT FROM OLD.provider_merchant_id
     OR NEW.partner_order_id IS DISTINCT FROM OLD.partner_order_id
     OR NEW.partner_user_id IS DISTINCT FROM OLD.partner_user_id
     OR NEW.tax_free_amount IS DISTINCT FROM OLD.tax_free_amount
     OR NEW.vat_amount IS DISTINCT FROM OLD.vat_amount
     OR NEW.checkout_attempt_id IS DISTINCT FROM OLD.checkout_attempt_id
     OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
     OR NEW.checkout_expires_at IS DISTINCT FROM OLD.checkout_expires_at
     OR NEW.ready_requested_at IS DISTINCT FROM OLD.ready_requested_at
     OR NEW.ready_expires_at IS DISTINCT FROM OLD.ready_expires_at
     OR NEW.payment_method_code IS DISTINCT FROM OLD.payment_method_code THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_IMMUTABLE_SNAPSHOT';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_payment_provider_identifier_replacement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (OLD.provider_transaction_id IS NOT NULL
      AND NEW.provider_transaction_id IS DISTINCT FROM OLD.provider_transaction_id)
     OR (OLD.provider_approval_id IS NOT NULL
         AND NEW.provider_approval_id IS DISTINCT FROM OLD.provider_approval_id)
     OR (OLD.callback_state_hash IS NOT NULL
         AND NEW.callback_state_hash IS DISTINCT FROM OLD.callback_state_hash)
     OR (OLD.result_token_hash IS NOT NULL
         AND NEW.result_token_hash IS DISTINCT FROM OLD.result_token_hash) THEN
    RAISE EXCEPTION 'PAYMENT_PROVIDER_IDENTIFIER_IMMUTABLE';
  END IF;

  -- 결제·취소 표식과 처리 시각은 되돌리면 같은 처리가 다시 실행되므로 한 번만 설정한다.
  IF (OLD.paid_feedback_recorded_at IS NOT NULL
      AND NEW.paid_feedback_recorded_at IS DISTINCT FROM OLD.paid_feedback_recorded_at)
     OR (OLD.paid_amount IS NOT NULL
         AND NEW.paid_amount IS DISTINCT FROM OLD.paid_amount)
     OR (OLD.cancel_feedback_recorded_at IS NOT NULL
         AND NEW.cancel_feedback_recorded_at IS DISTINCT FROM OLD.cancel_feedback_recorded_at)
     OR (OLD.partial_cancel_feedback_recorded_at IS NOT NULL
         AND NEW.partial_cancel_feedback_recorded_at IS DISTINCT FROM OLD.partial_cancel_feedback_recorded_at)
     OR (OLD.admin_paid_confirmed_at IS NOT NULL
         AND NEW.admin_paid_confirmed_at IS DISTINCT FROM OLD.admin_paid_confirmed_at)
     OR (OLD.provider_paid_at IS NOT NULL
         AND NEW.provider_paid_at IS DISTINCT FROM OLD.provider_paid_at)
     OR (OLD.cancel_processed_at IS NOT NULL
         AND NEW.cancel_processed_at IS DISTINCT FROM OLD.cancel_processed_at)
     OR (OLD.partial_cancel_processed_at IS NOT NULL
         AND NEW.partial_cancel_processed_at IS DISTINCT FROM OLD.partial_cancel_processed_at)
     OR (OLD.partial_cancel_amount IS NOT NULL
         AND NEW.partial_cancel_amount IS DISTINCT FROM OLD.partial_cancel_amount) THEN
    RAISE EXCEPTION 'PAYMENT_PROVIDER_MARKER_IMMUTABLE';
  END IF;

  RETURN NEW;
END;
$function$;

-- 환불 요청 출처는 'user'에서 격리 출처로 한 방향으로만 바뀐다.
CREATE FUNCTION public.prevent_refund_request_origin_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.origin IS DISTINCT FROM OLD.origin
     AND NOT (
       OLD.origin = 'user'
       AND NEW.origin IN ('external_cancel', 'partial_cancel')
     ) THEN
    RAISE EXCEPTION 'REFUND_REQUEST_ORIGIN_IMMUTABLE';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER prevent_refund_request_origin_change
  BEFORE UPDATE OF origin ON public.refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.prevent_refund_request_origin_change();

-- ---------------------------------------------------------------------------
-- 7. 관리자 조치 감사 기록 (5.6). append-only. 참조 컬럼은 FK 없이 uuid만 둔다
--    (FK의 SET NULL·CASCADE가 append-only와 충돌하고 RESTRICT는 계정 삭제를 막는다).
-- ---------------------------------------------------------------------------

CREATE TABLE public.payment_admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  action text NOT NULL,
  payment_order_id uuid,
  refund_request_id uuid,
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text NOT NULL,
  recovered_credits integer,
  unrecovered_credits integer,
  external_method text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_admin_actions_action_check
    CHECK (action IN (
      'paid_confirmed',
      'unpaid_confirmed',
      'cancel_handled',
      'manual_refund_completed',
      'manual_review_refund_rejected'
    )),
  CONSTRAINT payment_admin_actions_note_check
    CHECK (NULLIF(BTRIM(note), '') IS NOT NULL),
  CONSTRAINT payment_admin_actions_external_method_check
    CHECK (external_method IS NULL OR external_method IN ('payapp_cancel_request', 'bank_transfer', 'provider_admin_cancel'))
);

CREATE INDEX idx_payment_admin_actions_order
  ON public.payment_admin_actions (payment_order_id, created_at DESC);
CREATE INDEX idx_payment_admin_actions_refund
  ON public.payment_admin_actions (refund_request_id, created_at DESC);

CREATE FUNCTION public.prevent_payment_admin_action_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION 'PAYMENT_ADMIN_ACTIONS_APPEND_ONLY';
END;
$function$;

CREATE TRIGGER prevent_payment_admin_action_mutation
  BEFORE UPDATE OR DELETE ON public.payment_admin_actions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_payment_admin_action_mutation();

CREATE TRIGGER prevent_payment_admin_action_truncate
  BEFORE TRUNCATE ON public.payment_admin_actions
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_payment_admin_action_mutation();

ALTER TABLE public.payment_admin_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_admin_actions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.payment_admin_actions TO service_role;

-- ---------------------------------------------------------------------------
-- 8. 경보 기록 (5.6). 지급·환불과 별도 트랜잭션에서 부른다.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.record_payment_alert(
  p_code text,
  p_severity text,
  p_message text,
  p_details jsonb
)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_inserted integer;
BEGIN
  IF NULLIF(BTRIM(p_code), '') IS NULL
     OR p_severity NOT IN ('warning', 'critical')
     OR NULLIF(BTRIM(p_message), '') IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_ALERT_INPUT_INVALID';
  END IF;

  INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
  VALUES (LEFT(p_code, 120), p_severity, LEFT(p_message, 500), COALESCE(p_details, '{}'::jsonb))
  ON CONFLICT (code) WHERE resolved_at IS NULL DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted = 1;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 9. 주문 준비 (5.5 prepare_payment_order). 17개 인자 함수를 지우고 결제수단 인자를
--    끝에 더해 같은 트랜잭션에서 다시 만든다(오버로드 금지). 토스·카카오 동작은 그대로다.
-- ---------------------------------------------------------------------------

DROP FUNCTION public.prepare_payment_order(
  uuid, uuid, text, uuid, text, text, integer, integer, text, text, text, text, text,
  timestamp with time zone, integer, integer, text
);

CREATE FUNCTION public.prepare_payment_order(
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
  IF p_provider NOT IN ('toss', 'kakaopay', 'payapp')
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
     OR (p_provider IN ('toss', 'kakaopay') AND p_payment_method_code IS NOT NULL
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
-- 10. 페이앱 결제 요청 상태 (5.5 begin/store/fail_payapp_request)
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.begin_payapp_request(p_payment_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_runtime public.payment_runtime_config%ROWTYPE;
BEGIN
  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  IF NOT FOUND OR v_order.provider <> 'payapp' THEN
    RAISE EXCEPTION 'PAYAPP_ORDER_NOT_FOUND';
  END IF;

  SELECT *
    INTO v_runtime
    FROM public.payment_runtime_config
   WHERE id = true;

  -- 페이앱은 accepted_provider_environment를 보지 않고 항상 live다(5.3).
  IF NOT FOUND
     OR NOT v_runtime.master_accepts_new_orders
     OR NOT v_runtime.payapp_accepts_new_orders
     OR v_runtime.payapp_merchant_id IS DISTINCT FROM v_order.provider_merchant_id
     OR v_order.provider_environment <> 'live' THEN
    RAISE EXCEPTION 'PAYMENT_RUNTIME_GATE_CLOSED';
  END IF;

  IF v_order.status IN ('ready', 'ready_unknown') THEN
    RETURN jsonb_build_object('claimed', false, 'status', v_order.status);
  END IF;

  IF v_order.status <> 'preparing'
     OR v_order.ready_expires_at IS NULL
     OR v_order.ready_expires_at <= now()
     OR NOT EXISTS (
       SELECT 1
         FROM public.payment_methods pm
        WHERE pm.code = v_order.payment_method_code
          AND pm.provider = 'payapp'
          AND pm.is_enabled
     ) THEN
    RAISE EXCEPTION 'PAYAPP_REQUEST_NOT_CLAIMABLE';
  END IF;

  INSERT INTO public.payment_provider_transactions (
    payment_order_id,
    provider,
    provider_merchant_id
  ) VALUES (
    v_order.id,
    'payapp',
    v_order.provider_merchant_id
  );

  UPDATE public.payment_orders
     SET status = 'ready_unknown',
         failure_code = NULL,
         failure_message = NULL,
         updated_at = now()
   WHERE id = v_order.id;

  RETURN jsonb_build_object('claimed', true, 'status', 'ready_unknown');
END;
$function$;

CREATE FUNCTION public.store_payapp_request(
  p_payment_order_id uuid,
  p_mul_no text,
  p_payurl text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
BEGIN
  IF p_mul_no IS NULL
     OR p_mul_no !~ '^[0-9]+$'
     OR p_payurl IS NULL
     OR p_payurl NOT LIKE 'https://%' THEN
    RAISE EXCEPTION 'PAYAPP_REQUEST_RESULT_INVALID';
  END IF;

  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  SELECT *
    INTO v_ppt
    FROM public.payment_provider_transactions
   WHERE payment_order_id = p_payment_order_id
   FOR UPDATE;

  IF v_order.id IS NULL
     OR v_ppt.id IS NULL
     OR v_order.provider <> 'payapp'
     OR v_ppt.provider <> 'payapp' THEN
    RAISE EXCEPTION 'PAYAPP_REQUEST_RESULT_INVALID';
  END IF;

  IF v_ppt.provider_transaction_id IS NOT NULL
     AND v_ppt.provider_transaction_id <> p_mul_no THEN
    RAISE EXCEPTION 'PAYAPP_MUL_NO_CONFLICT';
  END IF;

  IF v_order.status NOT IN ('ready_unknown', 'ready') THEN
    RETURN jsonb_build_object('stored', false, 'status', v_order.status);
  END IF;

  BEGIN
    UPDATE public.payment_provider_transactions
       SET provider_transaction_id = COALESCE(provider_transaction_id, p_mul_no),
           next_redirect_pc_url = COALESCE(next_redirect_pc_url, p_payurl),
           ready_stored_at = COALESCE(ready_stored_at, now()),
           updated_at = now()
     WHERE id = v_ppt.id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'PAYAPP_MUL_NO_CONFLICT';
  END;

  UPDATE public.payment_orders
     SET status = 'ready',
         failure_code = NULL,
         failure_message = NULL,
         updated_at = now()
   WHERE id = v_order.id
     AND status = 'ready_unknown';

  RETURN jsonb_build_object('stored', true, 'status', 'ready');
END;
$function$;

CREATE FUNCTION public.fail_payapp_request(
  p_payment_order_id uuid,
  p_error_code text,
  p_error_message text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
BEGIN
  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  IF NOT FOUND OR v_order.provider <> 'payapp' THEN
    RAISE EXCEPTION 'PAYAPP_ORDER_NOT_FOUND';
  END IF;

  SELECT *
    INTO v_ppt
    FROM public.payment_provider_transactions
   WHERE payment_order_id = v_order.id
   FOR UPDATE;

  -- payrequest가 state=0으로 요청 미생성을 확정한 경우에만 실패로 닫는다.
  IF v_order.status <> 'ready_unknown'
     OR v_ppt.provider_transaction_id IS NOT NULL
     OR v_ppt.paid_feedback_recorded_at IS NOT NULL
     OR v_ppt.cancel_feedback_recorded_at IS NOT NULL
     OR v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL THEN
    RETURN jsonb_build_object('changed', false, 'status', v_order.status);
  END IF;

  UPDATE public.payment_orders
     SET status = 'failed',
         failure_code = LEFT(COALESCE(NULLIF(BTRIM(p_error_code), ''), 'PAYAPP_REQUEST_FAILED'), 100),
         failure_message = LEFT(COALESCE(NULLIF(BTRIM(p_error_message), ''), '페이앱 결제 요청을 만들지 못했습니다.'), 500),
         updated_at = now()
   WHERE id = v_order.id;

  UPDATE public.checkout_attempts
     SET status = 'cancelled',
         updated_at = now()
   WHERE id = v_order.checkout_attempt_id
     AND status <> 'completed';

  RETURN jsonb_build_object('changed', true, 'status', 'failed');
END;
$function$;

-- ---------------------------------------------------------------------------
-- 11. 지급 내부 함수 (5.5). 호출자가 payment_orders → payment_provider_transactions를
--     이미 잠근 상태에서만 부른다. service_role에도 실행 권한을 주지 않는다.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.payapp_fulfill_order_internal(
  p_payment_order_id uuid,
  p_approved_at timestamp with time zone
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_method_label text;
  v_source_id uuid;
  v_payment_history_id uuid;
  v_new_balance integer;
BEGIN
  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  SELECT * INTO v_ppt
    FROM public.payment_provider_transactions
   WHERE payment_order_id = p_payment_order_id
   FOR UPDATE;

  IF v_order.id IS NULL
     OR v_ppt.id IS NULL
     OR v_order.provider <> 'payapp'
     OR v_ppt.provider <> 'payapp'
     OR v_order.source_id IS NOT NULL
     OR v_order.status IN ('completed', 'refunded')
     OR v_ppt.provider_transaction_id IS NULL
     OR v_ppt.cancel_feedback_recorded_at IS NOT NULL
     OR v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL
     OR NOT COALESCE(
       (v_ppt.paid_feedback_recorded_at IS NOT NULL
        AND v_ppt.paid_amount IS NOT DISTINCT FROM v_order.expected_amount)
       OR v_ppt.admin_paid_confirmed_at IS NOT NULL,
       false
     )
     OR p_approved_at IS NULL THEN
    RAISE EXCEPTION 'PAYAPP_ORDER_NOT_FULFILLABLE';
  END IF;

  SELECT pm.label INTO v_method_label
    FROM public.payment_methods pm
   WHERE pm.code = v_order.payment_method_code
     AND pm.provider = 'payapp';

  IF v_method_label IS NULL THEN
    RAISE EXCEPTION 'PAYAPP_ORDER_NOT_FULFILLABLE';
  END IF;

  PERFORM 1
    FROM public.profiles
   WHERE id = v_order.user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_USER_NOT_FOUND';
  END IF;

  INSERT INTO public.credit_sources (
    user_id,
    plan_id,
    initial_credits,
    remaining_credits,
    status,
    source_category,
    purchased_at,
    expires_at,
    payment_order_id
  ) VALUES (
    v_order.user_id,
    v_order.plan_id,
    v_order.expected_credits,
    v_order.expected_credits,
    'active',
    'plan_purchase',
    p_approved_at,
    p_approved_at + interval '1 year',
    v_order.id
  )
  RETURNING id INTO v_source_id;

  SELECT COALESCE(SUM(remaining_credits), 0)::integer
    INTO v_new_balance
    FROM public.credit_sources
   WHERE user_id = v_order.user_id
     AND status IN ('active', 'pending_refund')
     AND (expires_at IS NULL OR expires_at > now());

  UPDATE public.profiles
     SET credits = v_new_balance
   WHERE id = v_order.user_id;

  INSERT INTO public.payment_history (
    user_id,
    source_id,
    plan_id,
    amount,
    payment_method,
    payment_key,
    status,
    payment_order_id,
    order_id,
    provider,
    provider_status,
    approved_at
  ) VALUES (
    v_order.user_id,
    v_source_id,
    v_order.plan_id,
    v_order.expected_amount,
    v_method_label,
    NULL,
    'completed',
    v_order.id,
    v_order.order_id,
    'payapp',
    v_ppt.provider_status,
    p_approved_at
  )
  RETURNING id INTO v_payment_history_id;

  INSERT INTO public.credit_transactions (
    user_id,
    type,
    amount,
    balance_after,
    description,
    source_id,
    resource_type,
    resource_id
  ) VALUES (
    v_order.user_id,
    'purchase',
    v_order.expected_credits,
    v_new_balance,
    format('크레딧 %s개 구매', v_order.expected_credits),
    v_source_id,
    'payment_order',
    v_order.id
  );

  UPDATE public.payment_orders
     SET status = 'completed',
         provider_method = v_method_label,
         approved_at = p_approved_at,
         fulfilled_at = now(),
         source_id = v_source_id,
         payment_history_id = v_payment_history_id,
         failure_code = NULL,
         failure_message = NULL,
         next_reconcile_at = NULL
   WHERE id = v_order.id;

  UPDATE public.checkout_attempts
     SET status = 'completed',
         updated_at = now()
   WHERE id = v_order.checkout_attempt_id;

  RETURN jsonb_build_object(
    'source_id', v_source_id,
    'payment_history_id', v_payment_history_id,
    'new_balance', v_new_balance,
    'credits', v_order.expected_credits
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 12. 페이앱 통보 처리 진입점 (5.5.1). linkkey·linkval 검증은 route가 먼저 끝낸다.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.apply_payapp_feedback(
  p_userid text,
  p_mul_no text,
  p_orig_mul_no text,
  p_order_id text,
  p_pay_state integer,
  p_price integer,
  p_orig_price integer,
  p_pay_type integer,
  p_pay_date timestamp with time zone,
  p_canceldate timestamp with time zone
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_marker boolean := p_pay_state IN (9, 64, 70, 71);
  v_lookup_mul_no text;
  v_by_mul_no uuid;
  v_by_order_id uuid;
  v_order_id uuid;
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_reason text;
  v_status_text text;
  v_already boolean;
  v_expected_pay_types integer[];
  v_pay_type_mismatch boolean := false;
  v_paid_amount_conflict boolean := false;
  v_fulfill jsonb;
  v_error_state text;
BEGIN
  IF p_pay_state IS NULL THEN
    RETURN jsonb_build_object('result', 'ignored', 'reason', 'PAY_STATE_MISSING');
  END IF;

  -- 1. 주문 찾기(잠금 없음). 판단은 2단계에서 잠근 행으로 한다.
  v_lookup_mul_no := CASE WHEN p_pay_state IN (70, 71) THEN p_orig_mul_no ELSE p_mul_no END;

  IF v_lookup_mul_no IS NOT NULL THEN
    SELECT ppt.payment_order_id INTO v_by_mul_no
      FROM public.payment_provider_transactions ppt
     WHERE ppt.provider = 'payapp'
       AND ppt.provider_transaction_id = v_lookup_mul_no;
  END IF;

  IF NULLIF(BTRIM(p_order_id), '') IS NOT NULL THEN
    SELECT po.id INTO v_by_order_id
      FROM public.payment_orders po
     WHERE po.order_id = p_order_id
       AND po.provider = 'payapp';
  END IF;

  IF v_by_mul_no IS NOT NULL AND v_by_order_id IS NOT NULL
     AND v_by_mul_no <> v_by_order_id THEN
    RETURN jsonb_build_object('result', 'ignored', 'reason', 'PAYAPP_ORDER_REFERENCE_MISMATCH');
  END IF;

  v_order_id := COALESCE(v_by_mul_no, v_by_order_id);

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('result', 'order_not_found');
  END IF;

  -- 2·3. 취소 표식 경로: payment_provider_transactions 한 행만 잠그고 주문 행은 쓰지 않는다.
  IF v_is_marker THEN
    SELECT * INTO v_ppt
      FROM public.payment_provider_transactions
     WHERE payment_order_id = v_order_id
     FOR UPDATE;

    -- 불변 스냅샷 값만 읽는다(잠금 없음).
    SELECT * INTO v_order
      FROM public.payment_orders
     WHERE id = v_order_id;

    IF v_ppt.id IS NULL OR v_ppt.provider <> 'payapp' THEN
      v_reason := 'PAYAPP_TRANSACTION_NOT_FOUND';
    ELSIF p_userid IS DISTINCT FROM v_order.provider_merchant_id THEN
      v_reason := 'PAYAPP_FEEDBACK_MERCHANT_MISMATCH';
    ELSIF p_pay_state IN (9, 64) AND p_price IS DISTINCT FROM v_order.expected_amount THEN
      v_reason := 'PAYAPP_FEEDBACK_AMOUNT_MISMATCH';
    ELSIF p_pay_state IN (70, 71) AND p_orig_price IS DISTINCT FROM v_order.expected_amount THEN
      v_reason := 'PAYAPP_FEEDBACK_AMOUNT_MISMATCH';
    ELSIF v_lookup_mul_no IS NULL
       OR (v_ppt.provider_transaction_id IS NOT NULL
           AND v_ppt.provider_transaction_id <> v_lookup_mul_no) THEN
      v_reason := 'PAYAPP_FEEDBACK_MUL_NO_MISMATCH';
    END IF;

    IF v_reason IS NOT NULL THEN
      RETURN jsonb_build_object(
        'result', 'ignored',
        'reason', v_reason,
        'payment_order_id', v_order_id,
        'order_id', v_order.order_id
      );
    END IF;

    IF p_pay_state IN (9, 64) THEN
      v_already := v_ppt.cancel_feedback_recorded_at IS NOT NULL;
    ELSE
      v_already := v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL;
      -- 금액은 처음 값만 남기고, 다른 금액이 다시 오면 결과 키로 알려 route가 경보를 남긴다.
      v_paid_amount_conflict := v_ppt.partial_cancel_amount IS NOT NULL
        AND p_price IS DISTINCT FROM v_ppt.partial_cancel_amount;
    END IF;

    BEGIN
      UPDATE public.payment_provider_transactions
         SET provider_transaction_id = COALESCE(provider_transaction_id, v_lookup_mul_no),
             cancel_feedback_recorded_at = CASE
               WHEN p_pay_state IN (9, 64) THEN COALESCE(cancel_feedback_recorded_at, now())
               ELSE cancel_feedback_recorded_at
             END,
             provider_cancelled_at = CASE
               WHEN p_pay_state IN (9, 64) THEN COALESCE(provider_cancelled_at, p_canceldate)
               ELSE provider_cancelled_at
             END,
             partial_cancel_feedback_recorded_at = CASE
               WHEN p_pay_state IN (70, 71) THEN COALESCE(partial_cancel_feedback_recorded_at, now())
               ELSE partial_cancel_feedback_recorded_at
             END,
             -- 부분취소 통보의 price는 취소된 금액이다. 원금 미만일 때만 기록한다.
             partial_cancel_amount = CASE
               WHEN p_pay_state IN (70, 71) AND p_price BETWEEN 1 AND v_order.expected_amount - 1
                 THEN COALESCE(partial_cancel_amount, p_price)
               ELSE partial_cancel_amount
             END,
             -- 표시용 상태는 진행 순위가 낮은 값으로 되돌리지 않는다.
             provider_status = CASE
               WHEN CASE provider_status WHEN '1' THEN 1 WHEN '10' THEN 2 WHEN '8' THEN 3 WHEN '16' THEN 3 WHEN '32' THEN 3 WHEN '4' THEN 4 WHEN '70' THEN 5 WHEN '71' THEN 5 WHEN '9' THEN 6 WHEN '64' THEN 6 ELSE 0 END >= CASE p_pay_state::text WHEN '1' THEN 1 WHEN '10' THEN 2 WHEN '8' THEN 3 WHEN '16' THEN 3 WHEN '32' THEN 3 WHEN '4' THEN 4 WHEN '70' THEN 5 WHEN '71' THEN 5 WHEN '9' THEN 6 WHEN '64' THEN 6 ELSE 0 END
                 THEN provider_status
               ELSE p_pay_state::text
             END,
             updated_at = now()
       WHERE id = v_ppt.id;
    EXCEPTION
      WHEN unique_violation THEN
        RETURN jsonb_build_object(
          'result', 'ignored',
          'reason', 'PAYAPP_MUL_NO_CONFLICT',
          'payment_order_id', v_order_id,
          'order_id', v_order.order_id
        );
    END;

    RETURN jsonb_build_object(
      'result', 'cancel_marker_recorded',
      'marker', CASE WHEN p_pay_state IN (9, 64) THEN 'cancel' ELSE 'partial_cancel' END,
      'already_recorded', v_already,
      'partial_cancel_amount_mismatch', v_paid_amount_conflict,
      'payment_order_id', v_order_id,
      'order_id', v_order.order_id
    );
  END IF;

  -- 2. 그 밖의 상태: payment_orders → payment_provider_transactions 순으로 잠그고 다시 읽는다.
  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = v_order_id
   FOR UPDATE;

  SELECT * INTO v_ppt
    FROM public.payment_provider_transactions
   WHERE payment_order_id = v_order_id
   FOR UPDATE;

  IF v_order.provider <> 'payapp' OR v_ppt.id IS NULL OR v_ppt.provider <> 'payapp' THEN
    v_reason := 'PAYAPP_TRANSACTION_NOT_FOUND';
  ELSIF p_userid IS DISTINCT FROM v_order.provider_merchant_id THEN
    v_reason := 'PAYAPP_FEEDBACK_MERCHANT_MISMATCH';
  ELSIF p_price IS DISTINCT FROM v_order.expected_amount THEN
    v_reason := 'PAYAPP_FEEDBACK_AMOUNT_MISMATCH';
  ELSIF p_mul_no IS NULL
     OR (v_ppt.provider_transaction_id IS NOT NULL
         AND v_ppt.provider_transaction_id <> p_mul_no) THEN
    v_reason := 'PAYAPP_FEEDBACK_MUL_NO_MISMATCH';
  ELSIF v_ppt.provider_transaction_id IS NULL THEN
    BEGIN
      UPDATE public.payment_provider_transactions
         SET provider_transaction_id = p_mul_no,
             updated_at = now()
       WHERE id = v_ppt.id;
      v_ppt.provider_transaction_id := p_mul_no;
    EXCEPTION
      WHEN unique_violation THEN
        v_reason := 'PAYAPP_MUL_NO_CONFLICT';
    END;
  END IF;

  IF v_reason IS NOT NULL THEN
    -- 미지급 주문이면 manual_review로 보낸다. 지급·환불이 끝난 주문은 바꾸지 않는다.
    IF v_reason <> 'PAYAPP_TRANSACTION_NOT_FOUND'
       AND p_pay_state IN (1, 4, 8, 16, 32)
       AND v_order.source_id IS NULL
       AND v_order.status NOT IN ('completed', 'refunded', 'manual_review') THEN
      UPDATE public.payment_orders
         SET status = 'manual_review',
             failure_code = CASE
               WHEN v_reason = 'PAYAPP_MUL_NO_CONFLICT' THEN 'PAYAPP_MUL_NO_CONFLICT'
               ELSE 'PAYAPP_FEEDBACK_MISMATCH'
             END,
             failure_message = LEFT(format('페이앱 통보 검증 실패: %s', v_reason), 500),
             next_reconcile_at = NULL,
             updated_at = now()
       WHERE id = v_order.id;

      UPDATE public.checkout_attempts
         SET status = 'manual_review',
             updated_at = now()
       WHERE id = v_order.checkout_attempt_id
         AND status <> 'completed';
    END IF;

    RETURN jsonb_build_object(
      'result', 'ignored',
      'reason', v_reason,
      'payment_order_id', v_order_id,
      'order_id', v_order.order_id
    );
  END IF;

  -- 표시용 상태는 진행 순위(1 < 10 < 8·16·32 < 4 < 70·71 < 9·64)가 낮은 값으로 되돌리지 않는다.
  v_status_text := CASE
    WHEN CASE v_ppt.provider_status WHEN '1' THEN 1 WHEN '10' THEN 2 WHEN '8' THEN 3 WHEN '16' THEN 3 WHEN '32' THEN 3 WHEN '4' THEN 4 WHEN '70' THEN 5 WHEN '71' THEN 5 WHEN '9' THEN 6 WHEN '64' THEN 6 ELSE 0 END >= CASE p_pay_state::text WHEN '1' THEN 1 WHEN '10' THEN 2 WHEN '8' THEN 3 WHEN '16' THEN 3 WHEN '32' THEN 3 WHEN '4' THEN 4 WHEN '70' THEN 5 WHEN '71' THEN 5 WHEN '9' THEN 6 WHEN '64' THEN 6 ELSE 0 END
      THEN v_ppt.provider_status
    ELSE p_pay_state::text
  END;

  -- 결제 요청(1): mul_no 저장만 한다.
  IF p_pay_state = 1 THEN
    UPDATE public.payment_provider_transactions
       SET provider_status = v_status_text,
           updated_at = now()
     WHERE id = v_ppt.id;

    RETURN jsonb_build_object(
      'result', 'request_recorded',
      'payment_order_id', v_order.id,
      'order_id', v_order.order_id
    );
  END IF;

  -- 결제완료(4): 기록은 바깥 블록, 지급은 모든 예외를 잡는 서브블록.
  IF p_pay_state = 4 THEN
    IF v_ppt.paid_amount IS NOT NULL AND v_ppt.paid_amount <> p_price THEN
      v_paid_amount_conflict := true;
    END IF;

    UPDATE public.payment_provider_transactions
       SET paid_feedback_recorded_at = COALESCE(paid_feedback_recorded_at, now()),
           provider_paid_at = COALESCE(provider_paid_at, p_pay_date),
           paid_amount = COALESCE(paid_amount, p_price),
           payment_method_type = COALESCE(payment_method_type, p_pay_type::text),
           provider_status = v_status_text,
           updated_at = now()
     WHERE id = v_ppt.id
    RETURNING * INTO v_ppt;

    SELECT pm.provider_pay_types INTO v_expected_pay_types
      FROM public.payment_methods pm
     WHERE pm.code = v_order.payment_method_code
       AND pm.provider = 'payapp';

    v_pay_type_mismatch := p_pay_type IS NULL
      OR v_expected_pay_types IS NULL
      OR NOT (p_pay_type = ANY (v_expected_pay_types));

    IF v_ppt.cancel_feedback_recorded_at IS NOT NULL
       OR v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL THEN
      RETURN jsonb_build_object(
        'result', 'cancelled_before_fulfillment',
        'payment_order_id', v_order.id,
        'order_id', v_order.order_id
      );
    END IF;

    IF v_order.source_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'result', 'already_fulfilled',
        'payment_order_id', v_order.id,
        'order_id', v_order.order_id,
        'paid_amount_conflict', v_paid_amount_conflict
      );
    END IF;

    -- 결제 전 대기 동안 쌓인 대사 백오프를 지워, 지급이 실패하면 다음 회차에 바로 재시도한다.
    UPDATE public.payment_orders
       SET status = 'fulfillment_pending',
           provider_status = v_status_text,
           failure_code = NULL,
           failure_message = NULL,
           next_reconcile_at = NULL,
           reconcile_attempt_count = 0,
           updated_at = now()
     WHERE id = v_order.id;

    BEGIN
      v_fulfill := public.payapp_fulfill_order_internal(
        v_order.id,
        COALESCE(v_ppt.provider_paid_at, v_ppt.paid_feedback_recorded_at)
      );
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_error_state = RETURNED_SQLSTATE;
        v_fulfill := NULL;
    END;

    -- pay_type·금액 기록 불일치 경보와 관리자 알림은 route가 별도 트랜잭션에서 남긴다(5.6).
    RETURN jsonb_build_object(
      'result', CASE WHEN v_fulfill IS NULL THEN 'recorded_pending' ELSE 'fulfilled' END,
      'payment_order_id', v_order.id,
      'order_id', v_order.order_id,
      'user_id', v_order.user_id,
      'fulfillment_error_state', v_error_state,
      'new_balance', v_fulfill->'new_balance',
      'pay_type_mismatch', v_pay_type_mismatch,
      'paid_amount_conflict', v_paid_amount_conflict
    );
  END IF;

  -- 요청 취소(8·16·32): 미결제 주문만 만료한다.
  IF p_pay_state IN (8, 16, 32) THEN
    UPDATE public.payment_provider_transactions
       SET provider_status = v_status_text,
           updated_at = now()
     WHERE id = v_ppt.id;

    IF v_order.source_id IS NULL
       AND v_ppt.paid_feedback_recorded_at IS NULL
       AND v_ppt.admin_paid_confirmed_at IS NULL
       AND v_ppt.cancel_feedback_recorded_at IS NULL
       AND v_ppt.partial_cancel_feedback_recorded_at IS NULL
       AND (
         v_order.status IN ('ready', 'ready_unknown')
         OR (v_order.status = 'manual_review'
             AND v_order.failure_code = 'PAYAPP_READY_CANCEL_FAILED')
       ) THEN
      UPDATE public.payment_orders
         SET status = 'expired',
             provider_status = v_status_text,
             failure_code = 'PAYAPP_REQUEST_CANCELLED',
             failure_message = '페이앱 결제 요청이 취소되었습니다.',
             next_reconcile_at = NULL,
             updated_at = now()
       WHERE id = v_order.id;

      UPDATE public.checkout_attempts
         SET status = 'expired',
             updated_at = now()
       WHERE id = v_order.checkout_attempt_id
         AND status <> 'completed';

      RETURN jsonb_build_object(
        'result', 'expired',
        'payment_order_id', v_order.id,
        'order_id', v_order.order_id
      );
    END IF;

    RETURN jsonb_build_object(
      'result', 'unchanged',
      'payment_order_id', v_order.id,
      'order_id', v_order.order_id
    );
  END IF;

  -- 가상계좌 대기(10)와 그 밖의 상태: 기록만 한다.
  UPDATE public.payment_provider_transactions
     SET provider_status = v_status_text,
         updated_at = now()
   WHERE id = v_ppt.id;

  RETURN jsonb_build_object(
    'result', 'recorded',
    'payment_order_id', v_order.id,
    'order_id', v_order.order_id
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 13. 대사의 지급 재시도 (5.5 retry_payapp_fulfillment)
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.retry_payapp_fulfillment(p_payment_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_fulfill jsonb;
  v_error_state text;
  v_attempts integer;
BEGIN
  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  SELECT * INTO v_ppt
    FROM public.payment_provider_transactions
   WHERE payment_order_id = p_payment_order_id
   FOR UPDATE;

  IF v_order.id IS NULL OR v_order.provider <> 'payapp' OR v_ppt.id IS NULL THEN
    RAISE EXCEPTION 'PAYAPP_ORDER_NOT_FOUND';
  END IF;

  IF v_order.source_id IS NOT NULL OR v_order.status = 'completed' THEN
    RETURN jsonb_build_object('result', 'already_fulfilled', 'status', v_order.status);
  END IF;

  IF v_order.status <> 'fulfillment_pending'
     OR v_ppt.cancel_feedback_recorded_at IS NOT NULL
     OR v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL
     OR v_ppt.paid_feedback_recorded_at IS NULL
     OR v_ppt.paid_amount IS DISTINCT FROM v_order.expected_amount THEN
    RETURN jsonb_build_object('result', 'not_retryable', 'status', v_order.status);
  END IF;

  BEGIN
    v_fulfill := public.payapp_fulfill_order_internal(
      v_order.id,
      COALESCE(v_ppt.provider_paid_at, v_ppt.paid_feedback_recorded_at)
    );
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error_state = RETURNED_SQLSTATE;
      v_fulfill := NULL;
  END;

  IF v_fulfill IS NOT NULL THEN
    RETURN jsonb_build_object(
      'result', 'fulfilled',
      'user_id', v_order.user_id,
      'new_balance', v_fulfill->'new_balance'
    );
  END IF;

  UPDATE public.payment_provider_transactions
     SET fulfillment_attempt_count = fulfillment_attempt_count + 1,
         updated_at = now()
   WHERE id = v_ppt.id
  RETURNING fulfillment_attempt_count INTO v_attempts;

  IF v_attempts >= 3 THEN
    UPDATE public.payment_orders
       SET status = 'manual_review',
           failure_code = 'PAYAPP_FULFILLMENT_RETRY_EXHAUSTED',
           failure_message = '페이앱 결제완료 건의 크레딧 지급을 3회 재시도했지만 실패했습니다.',
           next_reconcile_at = NULL,
           updated_at = now()
     WHERE id = v_order.id
       AND status = 'fulfillment_pending';

    RETURN jsonb_build_object(
      'result', 'retry_exhausted',
      'attempts', v_attempts,
      'error_state', v_error_state
    );
  END IF;

  RETURN jsonb_build_object(
    'result', 'retry_failed',
    'attempts', v_attempts,
    'error_state', v_error_state
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 14. 대사 종료 처리 (5.5 mark_payapp_order_terminal, mark_payment_reconciliation_terminal)
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.mark_payapp_order_terminal(
  p_payment_order_id uuid,
  p_expected_status text,
  p_status text,
  p_failure_code text,
  p_failure_message text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
BEGIN
  IF p_status IS NULL
     OR p_status NOT IN ('failed', 'expired', 'manual_review')
     OR p_expected_status IS NULL
     OR p_expected_status IN ('completed', 'refunded') THEN
    RAISE EXCEPTION 'PAYMENT_RECONCILIATION_TERMINAL_STATUS_INVALID';
  END IF;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  IF NOT FOUND OR v_order.provider <> 'payapp' THEN
    RAISE EXCEPTION 'PAYAPP_ORDER_NOT_FOUND';
  END IF;

  SELECT * INTO v_ppt
    FROM public.payment_provider_transactions
   WHERE payment_order_id = v_order.id
   FOR UPDATE;

  IF v_order.status IS DISTINCT FROM p_expected_status THEN
    RETURN jsonb_build_object('changed', false, 'status', v_order.status);
  END IF;

  IF p_status IN ('failed', 'expired') AND v_order.source_id IS NOT NULL THEN
    RAISE EXCEPTION 'PAYMENT_FULFILLED_ORDER_NOT_TERMINABLE';
  END IF;

  IF p_status IN ('failed', 'expired')
     AND v_order.source_id IS NULL
     AND (v_ppt.paid_feedback_recorded_at IS NOT NULL OR v_ppt.admin_paid_confirmed_at IS NOT NULL)
     AND v_ppt.cancel_feedback_recorded_at IS NULL
     AND v_ppt.partial_cancel_feedback_recorded_at IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_PAID_ORDER_NOT_TERMINABLE';
  END IF;

  UPDATE public.payment_orders
     SET status = p_status,
         failure_code = LEFT(COALESCE(p_failure_code, 'PAYMENT_RECONCILIATION_TERMINAL'), 100),
         failure_message = LEFT(COALESCE(p_failure_message, '결제 상태를 자동으로 확정할 수 없습니다.'), 500),
         next_reconcile_at = NULL,
         last_reconciled_at = now(),
         updated_at = now()
   WHERE id = v_order.id;

  IF v_ppt.id IS NOT NULL THEN
    UPDATE public.payment_provider_transactions
       SET next_reconcile_at = NULL,
           last_reconciled_at = now(),
           last_error_code = LEFT(COALESCE(p_failure_code, 'PAYMENT_RECONCILIATION_TERMINAL'), 100),
           last_error_message = LEFT(COALESCE(p_failure_message, '결제 상태를 자동으로 확정할 수 없습니다.'), 500),
           updated_at = now()
     WHERE id = v_ppt.id;
  END IF;

  UPDATE public.checkout_attempts
     SET status = CASE
           WHEN p_status = 'expired' THEN 'expired'
           WHEN p_status = 'manual_review' THEN 'manual_review'
           ELSE 'cancelled'
         END,
         updated_at = now()
   WHERE id = v_order.checkout_attempt_id
     AND status <> 'completed';

  RETURN jsonb_build_object('changed', true, 'status', p_status);
END;
$function$;

-- 2차 방어선: 결제완료가 기록된 페이앱 주문을 만료·실패로 덮지 않는다. 카카오·토스는 그대로다.
CREATE OR REPLACE FUNCTION public.mark_payment_reconciliation_terminal(p_payment_order_id uuid, p_status text, p_provider_status text, p_failure_code text, p_failure_message text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
BEGIN
  IF p_status NOT IN ('failed', 'expired', 'manual_review') THEN
    RAISE EXCEPTION 'PAYMENT_RECONCILIATION_TERMINAL_STATUS_INVALID';
  END IF;

  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_RECONCILIATION_ORDER_NOT_FOUND';
  END IF;

  IF v_order.status IN ('completed', 'refunded') THEN
    RETURN;
  END IF;

  IF v_order.provider = 'payapp'
     AND p_status IN ('failed', 'expired')
     AND v_order.source_id IS NULL
     AND EXISTS (
       SELECT 1
         FROM public.payment_provider_transactions ppt
        WHERE ppt.payment_order_id = v_order.id
          AND (ppt.paid_feedback_recorded_at IS NOT NULL OR ppt.admin_paid_confirmed_at IS NOT NULL)
          AND ppt.cancel_feedback_recorded_at IS NULL
          AND ppt.partial_cancel_feedback_recorded_at IS NULL
     ) THEN
    RAISE EXCEPTION 'PAYMENT_PAID_ORDER_NOT_TERMINABLE';
  END IF;

  UPDATE public.payment_orders
     SET status = p_status,
         provider_status = COALESCE(p_provider_status, provider_status),
         failure_code = LEFT(COALESCE(p_failure_code, 'PAYMENT_RECONCILIATION_TERMINAL'), 100),
         failure_message = LEFT(COALESCE(p_failure_message, '결제 상태를 자동으로 확정할 수 없습니다.'), 500),
         next_reconcile_at = NULL,
         last_reconciled_at = now(),
         updated_at = now()
   WHERE id = v_order.id;

  UPDATE public.payment_provider_transactions
     SET provider_status = COALESCE(p_provider_status, provider_status),
         next_reconcile_at = NULL,
         last_reconciled_at = now(),
         last_error_code = LEFT(COALESCE(p_failure_code, 'PAYMENT_RECONCILIATION_TERMINAL'), 100),
         last_error_message = LEFT(COALESCE(p_failure_message, '결제 상태를 자동으로 확정할 수 없습니다.'), 500),
         updated_at = now()
   WHERE payment_order_id = v_order.id;

  UPDATE public.checkout_attempts
     SET status = CASE
           WHEN p_status = 'expired' THEN 'expired'
           WHEN p_status = 'manual_review' THEN 'manual_review'
           ELSE 'cancelled'
         END,
         updated_at = now()
   WHERE id = v_order.checkout_attempt_id
     AND status <> 'completed';
END;
$function$;

-- ---------------------------------------------------------------------------
-- 15. 외부 전취소 격리 (5.5). 카카오·토스 분기의 잠금 순서와 동작은 그대로 두고
--     origin='external_cancel'만 더한다. 페이앱 분기는 5.4 환불 순서로 잠근다.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.quarantine_external_provider_cancellation(p_payment_order_id uuid, p_provider_cancel_transaction_key text, p_provider_cancelled_at timestamp with time zone, p_provider_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_request public.refund_requests%ROWTYPE;
  v_used_credits integer;
  v_already_quarantined boolean := false;
  v_provider text;
  v_pre_source_id uuid;
  v_pre_request_id uuid;
  v_now_request_id uuid;
BEGIN
  SELECT provider, source_id INTO v_provider, v_pre_source_id
    FROM public.payment_orders
   WHERE id = p_payment_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND';
  END IF;

  IF v_provider = 'payapp' THEN
    IF NULLIF(BTRIM(p_provider_cancel_transaction_key), '') IS NULL
       OR p_provider_cancelled_at IS NULL
       OR p_provider_status <> 'CANCELED' THEN
      RAISE EXCEPTION 'EXTERNAL_PROVIDER_CANCELLATION_INVALID';
    END IF;

    -- 열린 환불 요청을 잠금 없이 찾고, 환불 순서로 잠근 뒤 다시 확인한다.
    IF v_pre_source_id IS NOT NULL THEN
      SELECT id INTO v_pre_request_id
        FROM public.refund_requests
       WHERE source_id = v_pre_source_id
         AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review')
       ORDER BY created_at DESC
       LIMIT 1;
    END IF;

    IF v_pre_request_id IS NOT NULL THEN
      SELECT * INTO v_request
        FROM public.refund_requests
       WHERE id = v_pre_request_id
       FOR UPDATE;
    END IF;

    IF v_pre_source_id IS NOT NULL THEN
      SELECT * INTO v_source
        FROM public.credit_sources
       WHERE id = v_pre_source_id
       FOR UPDATE;
    END IF;

    SELECT * INTO v_order
      FROM public.payment_orders
     WHERE id = p_payment_order_id
     FOR UPDATE;

    PERFORM 1
      FROM public.payment_provider_transactions
     WHERE payment_order_id = v_order.id
     FOR UPDATE;

    PERFORM 1
      FROM public.profiles
     WHERE id = v_order.user_id
     FOR UPDATE;

    IF v_pre_source_id IS NOT NULL THEN
      SELECT id INTO v_now_request_id
        FROM public.refund_requests
       WHERE source_id = v_pre_source_id
         AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review')
       ORDER BY created_at DESC
       LIMIT 1;
    END IF;

    IF v_order.source_id IS DISTINCT FROM v_pre_source_id
       OR v_now_request_id IS DISTINCT FROM v_pre_request_id THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'PAYAPP_CANCELLATION_STATE_CHANGED';
    END IF;

    IF v_order.status = 'refunded' THEN
      RETURN jsonb_build_object('already_completed', true, 'credits_used', false);
    END IF;

    IF v_source.id IS NULL OR v_source.status = 'refunded' THEN
      RAISE EXCEPTION 'EXTERNAL_PROVIDER_CANCELLATION_SOURCE_NOT_FOUND';
    END IF;

    v_already_quarantined := v_request.id IS NOT NULL
      AND v_request.origin = 'external_cancel'
      AND v_request.last_error_code = 'EXTERNAL_PROVIDER_CANCELLATION'
      AND v_request.provider_cancel_transaction_key IS NOT DISTINCT FROM p_provider_cancel_transaction_key;

    IF v_request.id IS NULL THEN
      INSERT INTO public.refund_requests (
        user_id,
        source_id,
        reason,
        status,
        payment_order_id,
        provider,
        refund_amount,
        cancel_idempotency_key,
        provider_cancel_transaction_key,
        provider_cancelled_at,
        last_error_code,
        last_error_message,
        origin
      ) VALUES (
        v_order.user_id,
        v_source.id,
        '결제사 외부 취소 감지',
        'manual_review',
        v_order.id,
        v_order.provider,
        v_order.expected_amount,
        v_order.cancel_idempotency_key,
        p_provider_cancel_transaction_key,
        p_provider_cancelled_at,
        'EXTERNAL_PROVIDER_CANCELLATION',
        '결제사에서 직접 취소된 거래입니다. 크레딧 회수 상태를 확인하세요.',
        'external_cancel'
      )
      RETURNING * INTO v_request;
    ELSE
      UPDATE public.refund_requests
         SET status = 'manual_review',
             provider_cancel_transaction_key = p_provider_cancel_transaction_key,
             provider_cancelled_at = p_provider_cancelled_at,
             next_attempt_at = NULL,
             last_error_code = 'EXTERNAL_PROVIDER_CANCELLATION',
             last_error_message = '결제사에서 직접 취소된 거래입니다. 크레딧 회수 상태를 확인하세요.',
             origin = CASE WHEN origin = 'user' THEN 'external_cancel' ELSE origin END
       WHERE id = v_request.id;
    END IF;

    UPDATE public.credit_sources
       SET status = 'pending_refund'
     WHERE id = v_source.id
       AND status = 'active';

    UPDATE public.payment_orders
       SET status = 'manual_review',
           provider_status = p_provider_status,
           canceled_at = COALESCE(canceled_at, p_provider_cancelled_at),
           failure_code = 'EXTERNAL_PROVIDER_CANCELLATION',
           failure_message = '결제사 외부 취소가 감지되어 크레딧을 격리했습니다.',
           next_reconcile_at = NULL
     WHERE id = v_order.id;

    UPDATE public.payment_history
       SET provider_status = p_provider_status
     WHERE payment_order_id = v_order.id;

    v_used_credits := v_source.initial_credits - v_source.remaining_credits;

    IF NOT v_already_quarantined THEN
      INSERT INTO public.notifications (user_id, type, title, message, link, is_read)
      SELECT id,
             'warning',
             '외부 결제 취소 확인 필요',
             format('%s 결제가 외부에서 취소되었습니다. 사용자 %s, 사용 크레딧 %s', v_order.provider, v_order.user_id, v_used_credits),
             '/admin/refunds',
             false
        FROM public.profiles
       WHERE is_admin = true;
    END IF;

    RETURN jsonb_build_object(
      'already_completed', false,
      'already_quarantined', v_already_quarantined,
      'request_id', v_request.id,
      'credits_used', v_used_credits > 0,
      'used_credit_amount', v_used_credits
    );
  END IF;

  -- 카카오·토스: 기존 순서(payment_orders → credit_sources → profiles → refund_requests) 그대로.
  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND';
  END IF;

  IF v_order.status = 'refunded' THEN
    RETURN jsonb_build_object('already_completed', true, 'credits_used', false);
  END IF;

  IF NULLIF(BTRIM(p_provider_cancel_transaction_key), '') IS NULL
     OR p_provider_cancelled_at IS NULL
     OR (v_order.provider = 'toss' AND p_provider_status <> 'CANCELED')
     OR (v_order.provider = 'kakaopay' AND p_provider_status <> 'CANCEL_PAYMENT') THEN
    RAISE EXCEPTION 'EXTERNAL_PROVIDER_CANCELLATION_INVALID';
  END IF;

  SELECT * INTO v_source
    FROM public.credit_sources
   WHERE payment_order_id = v_order.id
   FOR UPDATE;

  IF NOT FOUND OR v_source.status = 'refunded' THEN
    RAISE EXCEPTION 'EXTERNAL_PROVIDER_CANCELLATION_SOURCE_NOT_FOUND';
  END IF;

  PERFORM 1
    FROM public.profiles
   WHERE id = v_order.user_id
   FOR UPDATE;

  SELECT * INTO v_request
    FROM public.refund_requests
   WHERE source_id = v_source.id
     AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review')
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  v_already_quarantined := FOUND
    AND v_request.last_error_code = 'EXTERNAL_PROVIDER_CANCELLATION'
    AND v_request.provider_cancel_transaction_key IS NOT DISTINCT FROM p_provider_cancel_transaction_key;

  IF v_request.id IS NULL THEN
    INSERT INTO public.refund_requests (
      user_id,
      source_id,
      reason,
      status,
      payment_order_id,
      provider,
      refund_amount,
      cancel_idempotency_key,
      provider_cancel_transaction_key,
      provider_cancelled_at,
      last_error_code,
      last_error_message,
      origin
    ) VALUES (
      v_order.user_id,
      v_source.id,
      '결제사 외부 취소 감지',
      'manual_review',
      v_order.id,
      v_order.provider,
      v_order.expected_amount,
      v_order.cancel_idempotency_key,
      p_provider_cancel_transaction_key,
      p_provider_cancelled_at,
      'EXTERNAL_PROVIDER_CANCELLATION',
      '결제사에서 직접 취소된 거래입니다. 크레딧 회수 상태를 확인하세요.',
      'external_cancel'
    )
    RETURNING * INTO v_request;
  ELSE
    UPDATE public.refund_requests
       SET status = 'manual_review',
           provider_cancel_transaction_key = p_provider_cancel_transaction_key,
           provider_cancelled_at = p_provider_cancelled_at,
           next_attempt_at = NULL,
           last_error_code = 'EXTERNAL_PROVIDER_CANCELLATION',
           last_error_message = '결제사에서 직접 취소된 거래입니다. 크레딧 회수 상태를 확인하세요.',
           origin = CASE WHEN origin = 'user' THEN 'external_cancel' ELSE origin END
     WHERE id = v_request.id;
  END IF;

  UPDATE public.credit_sources
     SET status = 'pending_refund'
   WHERE id = v_source.id;

  UPDATE public.payment_orders
     SET status = 'manual_review',
         provider_status = p_provider_status,
         canceled_at = p_provider_cancelled_at,
         failure_code = 'EXTERNAL_PROVIDER_CANCELLATION',
         failure_message = '결제사 외부 취소가 감지되어 크레딧을 격리했습니다.'
   WHERE id = v_order.id;

  UPDATE public.payment_history
     SET provider_status = p_provider_status
   WHERE payment_order_id = v_order.id;

  IF v_order.provider = 'kakaopay' THEN
    UPDATE public.payment_provider_transactions
       SET provider_status = 'CANCEL_PAYMENT',
           last_reconciled_at = now(),
           updated_at = now()
     WHERE payment_order_id = v_order.id
       AND provider = 'kakaopay';
  END IF;

  v_used_credits := v_source.initial_credits - v_source.remaining_credits;

  IF NOT v_already_quarantined THEN
    INSERT INTO public.notifications (
      user_id,
      type,
      title,
      message,
      link,
      is_read
    )
    SELECT
      id,
      'warning',
      '외부 결제 취소 확인 필요',
      format(
        '%s 결제가 외부에서 취소되었습니다. 사용자 %s, 사용 크레딧 %s',
        v_order.provider,
        v_order.user_id,
        v_used_credits
      ),
      '/admin/refunds',
      false
      FROM public.profiles
     WHERE is_admin = true;
  END IF;

  RETURN jsonb_build_object(
    'already_completed', false,
    'already_quarantined', v_already_quarantined,
    'request_id', v_request.id,
    'credits_used', v_used_credits > 0,
    'used_credit_amount', v_used_credits
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 16. 페이앱 부분취소 격리 (5.5 quarantine_payapp_partial_cancellation).
--     지급된 주문의 부분취소(70·71). 환불 순서로 잠근다.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.quarantine_payapp_partial_cancellation(p_payment_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_request public.refund_requests%ROWTYPE;
  v_pre_source_id uuid;
  v_pre_request_id uuid;
  v_now_request_id uuid;
  v_outcome text;
  v_notify boolean := false;
BEGIN
  SELECT source_id INTO v_pre_source_id
    FROM public.payment_orders
   WHERE id = p_payment_order_id
     AND provider = 'payapp';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYAPP_ORDER_NOT_FOUND';
  END IF;

  IF v_pre_source_id IS NULL THEN
    RAISE EXCEPTION 'PAYAPP_PARTIAL_CANCEL_SOURCE_NOT_FOUND';
  END IF;

  SELECT id INTO v_pre_request_id
    FROM public.refund_requests
   WHERE source_id = v_pre_source_id
     AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review')
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_pre_request_id IS NOT NULL THEN
    SELECT * INTO v_request
      FROM public.refund_requests
     WHERE id = v_pre_request_id
     FOR UPDATE;
  END IF;

  SELECT * INTO v_source
    FROM public.credit_sources
   WHERE id = v_pre_source_id
   FOR UPDATE;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  SELECT * INTO v_ppt
    FROM public.payment_provider_transactions
   WHERE payment_order_id = p_payment_order_id
   FOR UPDATE;

  PERFORM 1
    FROM public.profiles
   WHERE id = v_order.user_id
   FOR UPDATE;

  SELECT id INTO v_now_request_id
    FROM public.refund_requests
   WHERE source_id = v_pre_source_id
     AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review')
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_order.source_id IS DISTINCT FROM v_pre_source_id
     OR v_now_request_id IS DISTINCT FROM v_pre_request_id THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'PAYAPP_CANCELLATION_STATE_CHANGED';
  END IF;

  IF v_ppt.partial_cancel_feedback_recorded_at IS NULL THEN
    RAISE EXCEPTION 'PAYAPP_PARTIAL_CANCEL_MARKER_MISSING';
  END IF;

  IF v_ppt.partial_cancel_processed_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'already_processed', 'already_quarantined', true);
  END IF;

  IF v_order.status = 'refunded' OR v_source.status = 'refunded' THEN
    -- 전액 환불로 부분취소가 흡수됐다. 크레딧은 이미 전액 회수됐다.
    v_outcome := 'absorbed_by_refund';
  ELSIF v_request.id IS NOT NULL AND v_request.status = 'processing' THEN
    -- 전취소가 진행 중이다. 처리 시각을 두지 않고 환불이 끝난 뒤 대사가 다시 집는다.
    RETURN jsonb_build_object('outcome', 'deferred_refund_processing', 'request_id', v_request.id);
  ELSIF v_request.id IS NOT NULL AND v_request.origin IN ('external_cancel', 'partial_cancel') THEN
    v_outcome := 'already_quarantined';
  ELSE
    IF v_request.id IS NULL THEN
      INSERT INTO public.refund_requests (
        user_id,
        source_id,
        reason,
        status,
        payment_order_id,
        provider,
        refund_amount,
        cancel_idempotency_key,
        last_error_code,
        last_error_message,
        origin
      ) VALUES (
        v_order.user_id,
        v_source.id,
        '결제사 부분취소 감지',
        'manual_review',
        v_order.id,
        'payapp',
        v_order.expected_amount,
        v_order.cancel_idempotency_key,
        'PAYAPP_PARTIAL_CANCEL_QUARANTINED',
        '페이앱에서 부분취소된 결제입니다. 회수할 크레딧과 실제 환불액을 확인해 수동 완료하세요.',
        'partial_cancel'
      )
      RETURNING * INTO v_request;
    ELSE
      UPDATE public.refund_requests
         SET status = 'manual_review',
             next_attempt_at = NULL,
             last_error_code = 'PAYAPP_PARTIAL_CANCEL_QUARANTINED',
             last_error_message = '페이앱에서 부분취소된 결제입니다. 회수할 크레딧과 실제 환불액을 확인해 수동 완료하세요.',
             origin = 'partial_cancel'
       WHERE id = v_request.id;
    END IF;

    UPDATE public.credit_sources
       SET status = 'pending_refund'
     WHERE id = v_source.id
       AND status = 'active';

    UPDATE public.payment_orders
       SET status = 'manual_review',
           failure_code = 'PAYAPP_PARTIAL_CANCEL_QUARANTINED',
           failure_message = '페이앱 부분취소가 감지되어 크레딧을 격리했습니다.',
           next_reconcile_at = NULL
     WHERE id = v_order.id;

    v_outcome := 'quarantined';
    v_notify := true;
  END IF;

  UPDATE public.payment_provider_transactions
     SET partial_cancel_processed_at = COALESCE(partial_cancel_processed_at, now()),
         updated_at = now()
   WHERE id = v_ppt.id;

  IF v_notify THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, is_read)
    SELECT id,
           'warning',
           '페이앱 부분취소 확인 필요',
           format('주문 %s가 페이앱에서 부분취소되었습니다. 사용 크레딧 %s', v_order.order_id, v_source.initial_credits - v_source.remaining_credits),
           '/admin/refunds',
           false
      FROM public.profiles
     WHERE is_admin = true;
  END IF;

  -- 전액 환불로 흡수된 부분취소는 실제 환불액(원금 − 부분취소 금액)을 돌려주고 route가 경보 details로 남긴다.
  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'already_quarantined', v_outcome IN ('already_quarantined', 'absorbed_by_refund'),
    'request_id', v_request.id,
    'partial_cancel_amount', v_ppt.partial_cancel_amount,
    'actual_refund_amount', CASE
      WHEN v_outcome = 'absorbed_by_refund' AND v_ppt.partial_cancel_amount IS NOT NULL
        THEN v_order.expected_amount - v_ppt.partial_cancel_amount
    END
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 17. 페이앱 취소 표식 처리 (5.5.2). 웹훅이 표식 기록 직후, 대사가 미처리 표식에 부른다.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.process_payapp_cancellation(p_payment_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_request public.refund_requests%ROWTYPE;
  v_marker text;
  v_pre_source_id uuid;
  v_pre_request_id uuid;
  v_now_request_id uuid;
  v_result text;
  v_detail jsonb := '{}'::jsonb;
  v_error_state text;
  v_error_message text;
  v_cancel_key text;
BEGIN
  -- 잠금 없이 읽어 처리할 표식과 잠글 행을 정한다.
  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id;

  SELECT * INTO v_ppt
    FROM public.payment_provider_transactions
   WHERE payment_order_id = p_payment_order_id;

  IF v_order.id IS NULL OR v_order.provider <> 'payapp' OR v_ppt.id IS NULL THEN
    RAISE EXCEPTION 'PAYAPP_ORDER_NOT_FOUND';
  END IF;

  IF v_ppt.cancel_feedback_recorded_at IS NOT NULL AND v_ppt.cancel_processed_at IS NULL THEN
    v_marker := 'cancel';
  ELSIF v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL AND v_ppt.partial_cancel_processed_at IS NULL THEN
    v_marker := 'partial_cancel';
  ELSE
    RETURN jsonb_build_object('result', 'nothing_to_process');
  END IF;

  v_pre_source_id := v_order.source_id;
  IF v_pre_source_id IS NOT NULL THEN
    SELECT id INTO v_pre_request_id
      FROM public.refund_requests
     WHERE source_id = v_pre_source_id
       AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review')
     ORDER BY created_at DESC
     LIMIT 1;
  END IF;

  BEGIN
    -- 환불 순서: refund_requests → credit_sources → payment_orders → payment_provider_transactions → profiles
    IF v_pre_request_id IS NOT NULL THEN
      SELECT * INTO v_request
        FROM public.refund_requests
       WHERE id = v_pre_request_id
       FOR UPDATE;
    END IF;

    IF v_pre_source_id IS NOT NULL THEN
      SELECT * INTO v_source
        FROM public.credit_sources
       WHERE id = v_pre_source_id
       FOR UPDATE;
    END IF;

    SELECT * INTO v_order
      FROM public.payment_orders
     WHERE id = p_payment_order_id
     FOR UPDATE;

    SELECT * INTO v_ppt
      FROM public.payment_provider_transactions
     WHERE payment_order_id = p_payment_order_id
     FOR UPDATE;

    PERFORM 1
      FROM public.profiles
     WHERE id = v_order.user_id
     FOR UPDATE;

    IF v_pre_source_id IS NOT NULL THEN
      SELECT id INTO v_now_request_id
        FROM public.refund_requests
       WHERE source_id = v_pre_source_id
         AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review')
       ORDER BY created_at DESC
       LIMIT 1;
    END IF;

    -- 잠금 전 판단과 다르면 아무것도 쓰지 않고 재시도한다.
    IF v_order.source_id IS DISTINCT FROM v_pre_source_id
       OR v_now_request_id IS DISTINCT FROM v_pre_request_id
       OR (v_marker = 'cancel' AND v_ppt.cancel_processed_at IS NOT NULL)
       OR (v_marker = 'partial_cancel' AND (
             v_ppt.partial_cancel_processed_at IS NOT NULL
             OR (v_ppt.cancel_feedback_recorded_at IS NOT NULL AND v_ppt.cancel_processed_at IS NULL)
           )) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'PAYAPP_CANCELLATION_STATE_CHANGED';
    END IF;

    v_cancel_key := 'payapp-cancel:' || v_ppt.provider_transaction_id;

    IF v_marker = 'cancel' THEN
      IF v_order.source_id IS NULL THEN
        -- 지급 전 승인취소: 어떤 경로로도 지급하지 않는다.
        UPDATE public.payment_orders
           SET status = 'failed',
               canceled_at = COALESCE(canceled_at, v_ppt.provider_cancelled_at, now()),
               failure_code = 'PAYAPP_CANCELLED_BEFORE_FULFILLMENT',
               failure_message = '크레딧 지급 전에 페이앱 결제가 취소되었습니다.',
               next_reconcile_at = NULL,
               updated_at = now()
         WHERE id = v_order.id;

        UPDATE public.checkout_attempts
           SET status = 'cancelled',
               updated_at = now()
         WHERE id = v_order.checkout_attempt_id
           AND status <> 'completed';

        v_result := 'cancelled_before_fulfillment';
      ELSIF v_order.status = 'refunded' THEN
        v_result := 'already_refunded';
        IF EXISTS (
          SELECT 1
            FROM public.refund_requests rr
            JOIN public.payment_admin_actions paa
              ON paa.refund_request_id = rr.id
             AND paa.action = 'manual_refund_completed'
           WHERE rr.source_id = v_order.source_id
             AND rr.status = 'completed'
             AND rr.provider_cancel_transaction_key IS NULL
             AND paa.external_method = 'bank_transfer'
        ) THEN
          v_result := 'double_refund_suspected';
        END IF;
      ELSIF v_request.id IS NOT NULL AND v_request.origin IN ('external_cancel', 'partial_cancel') THEN
        v_result := 'already_quarantined';
      ELSIF v_request.id IS NOT NULL
            AND (v_request.status IN ('processing', 'retryable_failed')
                 OR (v_request.status = 'manual_review' AND v_request.origin = 'user')) THEN
        v_detail := public.finalize_point_charge_refund(
          v_request.id,
          v_cancel_key,
          COALESCE(v_ppt.provider_cancelled_at, now()),
          'CANCELED'
        );
        v_result := 'refund_finalized';
        v_detail := v_detail || jsonb_build_object('request_id', v_request.id, 'user_id', v_request.user_id);
      ELSE
        v_detail := public.quarantine_external_provider_cancellation(
          v_order.id,
          v_cancel_key,
          COALESCE(v_ppt.provider_cancelled_at, now()),
          'CANCELED'
        );
        v_result := 'external_cancel_quarantined';
      END IF;

      UPDATE public.payment_provider_transactions
         SET cancel_processed_at = COALESCE(cancel_processed_at, now()),
             updated_at = now()
       WHERE id = v_ppt.id;
    ELSE
      IF v_ppt.cancel_processed_at IS NOT NULL THEN
        -- 승인취소를 이미 처리한 뒤에 온 부분취소: 바꾸지 않고 경보만.
        v_result := 'partial_cancel_after_cancel';
        IF v_order.status = 'refunded' THEN
          v_detail := jsonb_build_object(
            'partial_cancel_amount', v_ppt.partial_cancel_amount,
            'actual_refund_amount', CASE
              WHEN v_ppt.partial_cancel_amount IS NOT NULL
                THEN v_order.expected_amount - v_ppt.partial_cancel_amount
            END
          );
        END IF;
        UPDATE public.payment_provider_transactions
           SET partial_cancel_processed_at = COALESCE(partial_cancel_processed_at, now()),
               updated_at = now()
         WHERE id = v_ppt.id;
      ELSIF v_order.source_id IS NULL THEN
        UPDATE public.payment_orders
           SET status = 'manual_review',
               failure_code = 'PAYAPP_PARTIAL_CANCEL',
               failure_message = '크레딧 지급 전에 페이앱 결제가 부분취소되었습니다.',
               next_reconcile_at = NULL,
               updated_at = now()
         WHERE id = v_order.id;

        UPDATE public.checkout_attempts
           SET status = 'manual_review',
               updated_at = now()
         WHERE id = v_order.checkout_attempt_id
           AND status <> 'completed';

        UPDATE public.payment_provider_transactions
           SET partial_cancel_processed_at = COALESCE(partial_cancel_processed_at, now()),
               updated_at = now()
         WHERE id = v_ppt.id;

        v_result := 'partial_cancel_unpaid';
      ELSE
        v_detail := public.quarantine_payapp_partial_cancellation(v_order.id);
        v_result := CASE
          WHEN v_detail->>'outcome' = 'deferred_refund_processing' THEN 'deferred_refund_processing'
          ELSE 'partial_cancel_quarantined'
        END;
      END IF;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_error_state = RETURNED_SQLSTATE,
        v_error_message = MESSAGE_TEXT;
      IF v_error_state IN ('40P01', '40001', '55P03') THEN
        RAISE;
      END IF;
      v_result := NULL;
  END;

  IF v_result IS NOT NULL THEN
    RETURN jsonb_build_object(
      'result', v_result,
      'marker', v_marker,
      'payment_order_id', v_order.id,
      'order_id', v_order.order_id,
      'user_id', v_order.user_id
    ) || v_detail;
  END IF;

  -- 실패 대체 처리: 크레딧을 묶고 manual_review로 보낸 뒤 처리 시각을 남긴다.
  v_request := NULL;
  v_source := NULL;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id;

  IF v_order.source_id IS NOT NULL THEN
    SELECT * INTO v_request
      FROM public.refund_requests
     WHERE source_id = v_order.source_id
       AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review')
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE;

    SELECT * INTO v_source
      FROM public.credit_sources
     WHERE id = v_order.source_id
     FOR UPDATE;
  END IF;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  SELECT * INTO v_ppt
    FROM public.payment_provider_transactions
   WHERE payment_order_id = p_payment_order_id
   FOR UPDATE;

  PERFORM 1
    FROM public.profiles
   WHERE id = v_order.user_id
   FOR UPDATE;

  IF v_source.id IS NOT NULL AND v_source.status <> 'refunded' THEN
    UPDATE public.credit_sources
       SET status = 'pending_refund'
     WHERE id = v_source.id
       AND status = 'active';

    IF v_request.id IS NOT NULL THEN
      UPDATE public.refund_requests
         SET status = 'manual_review',
             next_attempt_at = NULL,
             last_error_code = 'PAYAPP_CANCEL_HANDLING_FAILED',
             last_error_message = LEFT(format('페이앱 취소 처리 실패(%s): %s', v_error_state, v_error_message), 500),
             origin = CASE WHEN origin = 'user' THEN 'external_cancel' ELSE origin END
       WHERE id = v_request.id;
    ELSE
      INSERT INTO public.refund_requests (
        user_id,
        source_id,
        reason,
        status,
        payment_order_id,
        provider,
        refund_amount,
        cancel_idempotency_key,
        last_error_code,
        last_error_message,
        origin
      ) VALUES (
        v_order.user_id,
        v_source.id,
        '결제사 취소 처리 실패',
        'manual_review',
        v_order.id,
        'payapp',
        v_order.expected_amount,
        v_order.cancel_idempotency_key,
        'PAYAPP_CANCEL_HANDLING_FAILED',
        LEFT(format('페이앱 취소 처리 실패(%s): %s', v_error_state, v_error_message), 500),
        'external_cancel'
      );
    END IF;
  END IF;

  IF v_order.status <> 'refunded' THEN
    UPDATE public.payment_orders
       SET status = 'manual_review',
           failure_code = 'PAYAPP_CANCEL_HANDLING_FAILED',
           failure_message = '페이앱 취소 통보를 자동으로 처리하지 못해 크레딧을 격리했습니다.',
           next_reconcile_at = NULL,
           updated_at = now()
     WHERE id = v_order.id;
  END IF;

  UPDATE public.payment_provider_transactions
     SET cancel_processed_at = CASE
           WHEN v_marker = 'cancel' THEN COALESCE(cancel_processed_at, now())
           ELSE cancel_processed_at
         END,
         partial_cancel_processed_at = CASE
           WHEN v_marker = 'partial_cancel' THEN COALESCE(partial_cancel_processed_at, now())
           ELSE partial_cancel_processed_at
         END,
         updated_at = now()
   WHERE id = v_ppt.id;

  RETURN jsonb_build_object(
    'result', 'cancel_handling_failed',
    'marker', v_marker,
    'payment_order_id', v_order.id,
    'order_id', v_order.order_id,
    'error_state', v_error_state
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 18. 카카오 대사 부분취소 (6.5 "카카오 대사 부분취소"). 표식 기록 → 격리 2단계.
--     호출 코드 교체는 단계 4이고, 이 마이그레이션만 적용된 동안은 아무도 부르지 않는다.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.record_kakaopay_partial_cancel_marker(
  p_payment_order_id uuid,
  p_provider_status text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ppt public.payment_provider_transactions%ROWTYPE;
BEGIN
  IF p_provider_status IS DISTINCT FROM 'PART_CANCEL_PAYMENT' THEN
    RAISE EXCEPTION 'KAKAOPAY_PARTIAL_CANCEL_MARKER_INVALID';
  END IF;

  -- 이 행 하나만 잠근다(교착 고리가 생기지 않게 주문 행은 쓰지 않는다).
  SELECT * INTO v_ppt
    FROM public.payment_provider_transactions
   WHERE payment_order_id = p_payment_order_id
     AND provider = 'kakaopay'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'KAKAOPAY_ORDER_NOT_FOUND';
  END IF;

  IF v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'recorded', false,
      'already_recorded', true,
      'processed', v_ppt.partial_cancel_processed_at IS NOT NULL
    );
  END IF;

  UPDATE public.payment_provider_transactions
     SET partial_cancel_feedback_recorded_at = now(),
         updated_at = now()
   WHERE id = v_ppt.id;

  RETURN jsonb_build_object('recorded', true, 'already_recorded', false, 'processed', false);
END;
$function$;

CREATE FUNCTION public.quarantine_kakaopay_partial_cancellation(
  p_payment_order_id uuid,
  p_provider_status text,
  p_cancelled_amount integer
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_request public.refund_requests%ROWTYPE;
  v_pre_source_id uuid;
  v_pre_request_id uuid;
  v_now_request_id uuid;
  v_status_writable boolean;
  v_amount integer;
  v_message text;
  v_outcome text;
  v_already boolean := false;
  v_used_credits integer;
BEGIN
  IF NULLIF(BTRIM(p_provider_status), '') IS NULL THEN
    RAISE EXCEPTION 'KAKAOPAY_PARTIAL_CANCEL_INPUT_INVALID';
  END IF;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id;

  SELECT * INTO v_ppt
    FROM public.payment_provider_transactions
   WHERE payment_order_id = p_payment_order_id;

  IF v_order.id IS NULL OR v_order.provider <> 'kakaopay'
     OR v_ppt.id IS NULL OR v_ppt.provider <> 'kakaopay' THEN
    RAISE EXCEPTION 'KAKAOPAY_ORDER_NOT_FOUND';
  END IF;

  IF v_ppt.partial_cancel_feedback_recorded_at IS NULL THEN
    RAISE EXCEPTION 'KAKAOPAY_PARTIAL_CANCEL_MARKER_MISSING';
  END IF;

  IF v_ppt.partial_cancel_processed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'outcome', 'already_processed',
      'already_completed', v_order.status = 'refunded',
      'already_quarantined', true,
      'credits_used', false
    );
  END IF;

  v_status_writable := p_provider_status IN ('PART_CANCEL_PAYMENT', 'CANCEL_PAYMENT');
  v_amount := CASE
    WHEN p_cancelled_amount BETWEEN 1 AND v_order.expected_amount - 1 THEN p_cancelled_amount
    ELSE NULL
  END;
  v_message := CASE
    WHEN v_amount IS NULL THEN '카카오페이에서 부분취소된 결제입니다. 회수할 크레딧과 실제 환불액을 확인해 수동 완료하세요.'
    ELSE format('카카오페이 부분취소 %s원. 회수할 크레딧과 실제 환불액을 확인해 수동 완료하세요.', v_amount)
  END;

  -- 열린 환불 요청을 잠금 없이 찾고, 환불 순서로 잠근 뒤 다시 읽는다.
  v_pre_source_id := v_order.source_id;
  IF v_pre_source_id IS NOT NULL THEN
    SELECT id INTO v_pre_request_id
      FROM public.refund_requests
     WHERE source_id = v_pre_source_id
       AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review')
     ORDER BY created_at DESC
     LIMIT 1;
  END IF;

  IF v_pre_request_id IS NOT NULL THEN
    SELECT * INTO v_request
      FROM public.refund_requests
     WHERE id = v_pre_request_id
     FOR UPDATE;
  END IF;

  IF v_pre_source_id IS NOT NULL THEN
    SELECT * INTO v_source
      FROM public.credit_sources
     WHERE id = v_pre_source_id
     FOR UPDATE;
  END IF;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  SELECT * INTO v_ppt
    FROM public.payment_provider_transactions
   WHERE payment_order_id = p_payment_order_id
   FOR UPDATE;

  PERFORM 1
    FROM public.profiles
   WHERE id = v_order.user_id
   FOR UPDATE;

  IF v_pre_source_id IS NOT NULL THEN
    SELECT id INTO v_now_request_id
      FROM public.refund_requests
     WHERE source_id = v_pre_source_id
       AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review')
     ORDER BY created_at DESC
     LIMIT 1;
  END IF;

  IF v_order.source_id IS DISTINCT FROM v_pre_source_id
     OR v_now_request_id IS DISTINCT FROM v_pre_request_id
     OR v_ppt.partial_cancel_processed_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'KAKAOPAY_PARTIAL_CANCEL_STATE_CHANGED';
  END IF;

  IF v_order.status = 'refunded' OR v_source.status = 'refunded' THEN
    -- ① 이미 전액 환불됐다.
    v_outcome := 'already_completed';
    v_already := true;
  ELSIF v_order.source_id IS NULL THEN
    IF v_order.status = 'manual_review' THEN
      -- ②′ 이미 수동 확인 중인 미지급 주문.
      v_outcome := 'manual_review';
      v_already := true;
    ELSE
      -- ② 미지급 주문. manual_review 뒤에는 승인 콜백이 지급하지 못한다.
      UPDATE public.payment_orders
         SET status = 'manual_review',
             provider_status = CASE WHEN v_status_writable THEN p_provider_status ELSE provider_status END,
             failure_code = 'KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW',
             failure_message = '부분 취소된 카카오페이 결제는 수동 확인이 필요합니다.',
             next_reconcile_at = NULL,
             last_reconciled_at = now(),
             updated_at = now()
       WHERE id = v_order.id;

      UPDATE public.checkout_attempts
         SET status = 'manual_review',
             updated_at = now()
       WHERE id = v_order.checkout_attempt_id
         AND status <> 'completed';

      v_outcome := 'manual_review';
    END IF;
  ELSE
    -- ③ 지급된 주문: 크레딧을 묶고 수동 완료로만 끝나는 환불 요청으로 격리한다.
    IF v_request.id IS NOT NULL AND v_request.origin IN ('external_cancel', 'partial_cancel') THEN
      v_already := true;
    ELSIF v_request.id IS NOT NULL THEN
      UPDATE public.refund_requests
         SET status = 'manual_review',
             next_attempt_at = NULL,
             last_error_code = 'KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW',
             last_error_message = v_message,
             origin = 'partial_cancel'
       WHERE id = v_request.id;
    ELSE
      INSERT INTO public.refund_requests (
        user_id,
        source_id,
        reason,
        status,
        payment_order_id,
        provider,
        refund_amount,
        cancel_idempotency_key,
        last_error_code,
        last_error_message,
        origin
      ) VALUES (
        v_order.user_id,
        v_source.id,
        '결제사 부분취소 감지',
        'manual_review',
        v_order.id,
        'kakaopay',
        v_order.expected_amount,
        v_order.cancel_idempotency_key,
        'KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW',
        v_message,
        'partial_cancel'
      )
      RETURNING * INTO v_request;
    END IF;

    -- 이미 격리된 건은 요청·원천·주문을 그대로 두고 처리 시각만 설정한다.
    IF NOT v_already THEN
      UPDATE public.credit_sources
         SET status = 'pending_refund'
       WHERE id = v_source.id
         AND status = 'active';

      UPDATE public.payment_orders
         SET status = 'manual_review',
             provider_status = CASE WHEN v_status_writable THEN p_provider_status ELSE provider_status END,
             failure_code = 'KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW',
             failure_message = '부분 취소된 카카오페이 결제는 수동 확인이 필요합니다.',
             next_reconcile_at = NULL,
             last_reconciled_at = now(),
             updated_at = now()
       WHERE id = v_order.id;
    END IF;

    v_outcome := 'manual_review';
  END IF;

  UPDATE public.payment_provider_transactions
     SET provider_status = CASE WHEN v_status_writable AND NOT v_already THEN p_provider_status ELSE provider_status END,
         partial_cancel_processed_at = COALESCE(partial_cancel_processed_at, now()),
         last_reconciled_at = now(),
         updated_at = now()
   WHERE id = v_ppt.id;

  v_used_credits := COALESCE(v_source.initial_credits - v_source.remaining_credits, 0);

  IF NOT v_already THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, is_read)
    SELECT id,
           'warning',
           '카카오페이 부분취소 확인 필요',
           format('주문 %s가 카카오페이에서 부분취소되었습니다. %s', v_order.order_id, v_message),
           '/admin/refunds',
           false
      FROM public.profiles
     WHERE is_admin = true;
  END IF;

  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'already_completed', v_outcome = 'already_completed',
    'already_quarantined', v_already,
    'request_id', v_request.id,
    'credits_used', v_used_credits > 0,
    'used_credit_amount', v_used_credits,
    'state_unexpected', NOT v_status_writable,
    'cancelled_amount_invalid', p_cancelled_amount IS NOT NULL AND v_amount IS NULL
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 19. 환불 자격·요청 처리 (5.5, 6.5). 토스·카카오 조건은 그대로 두고 페이앱 조건을 더한다.
--     모든 provider 공통: 원천에 완료된 환불 요청이 있으면 다시 신청할 수 없다.
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

  IF v_order.provider = 'toss' AND v_order.payment_key IS NULL THEN
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

CREATE OR REPLACE FUNCTION public.finalize_point_charge_refund(p_request_id uuid, p_provider_cancel_transaction_key text, p_provider_cancelled_at timestamp with time zone, p_provider_status text)
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
  v_new_balance integer;
BEGIN
  SELECT * INTO v_request
    FROM public.refund_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_FOUND';
  END IF;

  IF v_request.status = 'completed' THEN
    SELECT credits INTO v_new_balance
      FROM public.profiles
     WHERE id = v_request.user_id;

    RETURN jsonb_build_object('already_completed', true, 'new_balance', v_new_balance);
  END IF;

  -- 카카오 부분취소 격리는 실제 환불액이 정해지지 않았으므로 수동 완료로만 끝낸다.
  IF v_request.provider = 'kakaopay' AND v_request.origin = 'partial_cancel' THEN
    RAISE EXCEPTION 'REFUND_REQUIRES_MANUAL_COMPLETION';
  END IF;

  IF v_request.status NOT IN ('processing', 'retryable_failed', 'manual_review')
     OR NULLIF(BTRIM(p_provider_cancel_transaction_key), '') IS NULL
     OR p_provider_cancelled_at IS NULL THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_READY_TO_FINALIZE';
  END IF;

  SELECT * INTO v_source
    FROM public.credit_sources
   WHERE id = v_request.source_id
   FOR UPDATE;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = v_request.payment_order_id
   FOR UPDATE;

  IF NOT FOUND
     OR v_request.provider IS DISTINCT FROM v_order.provider
     OR v_source.status <> 'pending_refund'
     OR v_source.remaining_credits <> v_source.initial_credits
     OR v_order.status NOT IN ('completed', 'manual_review')
     OR (
       v_request.provider_cancel_transaction_key IS NOT NULL
       AND v_request.provider_cancel_transaction_key IS DISTINCT FROM p_provider_cancel_transaction_key
     ) THEN
    RAISE EXCEPTION 'REFUND_REQUEST_REVALIDATION_FAILED';
  END IF;

  IF v_order.provider = 'toss' AND p_provider_status <> 'CANCELED' THEN
    RAISE EXCEPTION 'REFUND_PROVIDER_STATUS_INVALID';
  END IF;

  IF v_order.provider = 'kakaopay' AND p_provider_status <> 'CANCEL_PAYMENT' THEN
    RAISE EXCEPTION 'REFUND_PROVIDER_STATUS_INVALID';
  END IF;

  IF v_order.provider = 'payapp' AND p_provider_status <> 'CANCELED' THEN
    RAISE EXCEPTION 'REFUND_PROVIDER_STATUS_INVALID';
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
       OR v_provider_transaction.payment_method_type <> 'MONEY'
       OR v_provider_transaction.provider_status NOT IN ('SUCCESS_PAYMENT', 'CANCEL_PAYMENT') THEN
      RAISE EXCEPTION 'REFUND_REQUEST_REVALIDATION_FAILED';
    END IF;

    UPDATE public.payment_provider_transactions
       SET provider_status = 'CANCEL_PAYMENT',
           last_reconciled_at = now(),
           updated_at = now()
     WHERE id = v_provider_transaction.id;
  END IF;

  IF v_order.provider = 'payapp' THEN
    SELECT * INTO v_provider_transaction
      FROM public.payment_provider_transactions
     WHERE payment_order_id = v_order.id
       AND provider = 'payapp'
     FOR UPDATE;

    IF NOT FOUND
       OR v_provider_transaction.provider_transaction_id IS NULL
       OR p_provider_cancel_transaction_key IS DISTINCT FROM
          'payapp-cancel:' || v_provider_transaction.provider_transaction_id THEN
      RAISE EXCEPTION 'REFUND_REQUEST_REVALIDATION_FAILED';
    END IF;

    UPDATE public.payment_provider_transactions
       SET provider_cancelled_at = COALESCE(provider_cancelled_at, p_provider_cancelled_at),
           last_reconciled_at = now(),
           updated_at = now()
     WHERE id = v_provider_transaction.id;
  END IF;

  PERFORM 1
    FROM public.profiles
   WHERE id = v_request.user_id
   FOR UPDATE;

  UPDATE public.credit_sources
     SET status = 'refunded',
         remaining_credits = 0
   WHERE id = v_source.id;

  SELECT COALESCE(SUM(remaining_credits), 0)::integer
    INTO v_new_balance
    FROM public.credit_sources
   WHERE user_id = v_request.user_id
     AND status IN ('active', 'pending_refund')
     AND (expires_at IS NULL OR expires_at > now());

  UPDATE public.profiles
     SET credits = v_new_balance
   WHERE id = v_request.user_id;

  UPDATE public.payment_orders
     SET status = 'refunded',
         provider_status = p_provider_status,
         canceled_at = p_provider_cancelled_at
   WHERE id = v_order.id;

  UPDATE public.payment_history
     SET status = 'refunded',
         provider_status = p_provider_status
   WHERE payment_order_id = v_order.id;

  INSERT INTO public.credit_transactions (
    user_id,
    type,
    amount,
    balance_after,
    description,
    source_id,
    resource_type,
    resource_id
  ) VALUES (
    v_request.user_id,
    'refund',
    -v_source.initial_credits,
    v_new_balance,
    format('원 결제수단 환불 완료 (%s 크레딧)', v_source.initial_credits),
    v_source.id,
    'refund_request',
    v_request.id
  );

  UPDATE public.refund_requests
     SET status = 'completed',
         provider_cancel_transaction_key = p_provider_cancel_transaction_key,
         provider_cancelled_at = p_provider_cancelled_at,
         processed_at = now(),
         next_attempt_at = NULL,
         last_error_code = NULL,
         last_error_message = NULL
   WHERE id = v_request.id;

  UPDATE public.checkout_attempts
     SET status = 'cancelled',
         updated_at = now()
   WHERE id = v_order.checkout_attempt_id;

  RETURN jsonb_build_object('already_completed', false, 'new_balance', v_new_balance);
END;
$function$;

-- 서버가 claim 직후 죽어 processing에 멈춘 페이앱 환불을 관리자 재승인 대상으로 돌린다.
CREATE FUNCTION public.requeue_stuck_point_charge_refund(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_request public.refund_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request
    FROM public.refund_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_FOUND';
  END IF;

  IF v_request.provider <> 'payapp'
     OR v_request.status <> 'processing'
     OR v_request.updated_at > now() - interval '10 minutes' THEN
    RETURN jsonb_build_object('changed', false, 'status', v_request.status);
  END IF;

  UPDATE public.refund_requests
     SET status = 'retryable_failed',
         next_attempt_at = NULL,
         last_error_code = 'REFUND_PROCESSING_STUCK',
         last_error_message = '환불 처리가 10분 넘게 끝나지 않았습니다. 페이앱 관리자에서 취소 여부를 확인한 뒤 다시 승인하세요.'
   WHERE id = v_request.id;

  RETURN jsonb_build_object('changed', true, 'status', 'retryable_failed');
END;
$function$;

-- ---------------------------------------------------------------------------
-- 20. 환불 거절 (5.5). manual_review 거절을 허용하되 격리·취소 기록이 있으면 막는다.
--     관리자 확인 인자를 더하므로 지우고 다시 만든다(기존 3개 인자 호출은 그대로 동작).
-- ---------------------------------------------------------------------------

DROP FUNCTION public.reject_point_charge_refund(uuid, uuid, text);

CREATE FUNCTION public.reject_point_charge_refund(
  p_request_id uuid,
  p_admin_id uuid,
  p_admin_note text,
  p_provider_not_cancelled_confirmed boolean DEFAULT false
)
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
$function$;

-- ---------------------------------------------------------------------------
-- 21. 수동 환불 완료 (6.5). 결제사 관리자 취소나 계좌 송금으로 끝낸 환불을 기록한다.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.complete_manual_point_charge_refund(
  p_request_id uuid,
  p_admin_id uuid,
  p_note text,
  p_external_method text,
  p_refund_amount integer,
  p_recovered_credits integer DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_request public.refund_requests%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_partial boolean;
  v_recovered integer;
  v_remaining_after integer;
  v_used_before integer;
  v_balance_before integer;
  v_new_balance integer;
  v_source_status_after text;
BEGIN
  IF p_admin_id IS NULL
     OR NULLIF(BTRIM(p_note), '') IS NULL
     OR p_external_method IS NULL
     OR p_external_method NOT IN ('payapp_cancel_request', 'bank_transfer', 'provider_admin_cancel')
     OR p_refund_amount IS NULL
     OR p_refund_amount NOT BETWEEN 1 AND 100000 THEN
    RAISE EXCEPTION 'MANUAL_REFUND_INPUT_INVALID';
  END IF;

  SELECT * INTO v_request
    FROM public.refund_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_FOUND';
  END IF;

  IF v_request.status = 'completed' THEN
    SELECT credits INTO v_new_balance
      FROM public.profiles
     WHERE id = v_request.user_id;

    RETURN jsonb_build_object('already_completed', true, 'new_balance', v_new_balance);
  END IF;

  IF v_request.status <> 'manual_review' THEN
    RAISE EXCEPTION 'MANUAL_REFUND_NOT_ALLOWED';
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

  SELECT credits INTO v_balance_before
    FROM public.profiles
   WHERE id = v_request.user_id
   FOR UPDATE;

  IF v_order.id IS NULL
     OR v_order.status NOT IN ('completed', 'manual_review')
     OR v_source.id IS NULL
     OR v_source.status <> 'pending_refund'
     OR p_refund_amount > v_order.expected_amount THEN
    RAISE EXCEPTION 'MANUAL_REFUND_REVALIDATION_FAILED';
  END IF;

  -- 처리되지 않은 부분취소 표식이 있으면 격리가 끝난 뒤에 완료한다(나중에 원천이 다시 묶이지 않게).
  IF v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL
     AND v_ppt.partial_cancel_processed_at IS NULL THEN
    RAISE EXCEPTION 'MANUAL_REFUND_MARKER_PENDING';
  END IF;

  v_partial := COALESCE(
    v_request.origin = 'partial_cancel'
    OR v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL
    OR v_request.last_error_code IN ('KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW'),
    false
  );

  IF v_partial THEN
    IF p_recovered_credits IS NULL
       OR p_recovered_credits NOT BETWEEN 0 AND v_source.remaining_credits THEN
      RAISE EXCEPTION 'MANUAL_REFUND_RECOVERY_INVALID';
    END IF;
    v_recovered := p_recovered_credits;
  ELSE
    IF p_recovered_credits IS NOT NULL
       AND p_recovered_credits <> v_source.remaining_credits THEN
      RAISE EXCEPTION 'MANUAL_REFUND_RECOVERY_INVALID';
    END IF;
    v_recovered := v_source.remaining_credits;
  END IF;

  v_used_before := v_source.initial_credits - v_source.remaining_credits;
  v_remaining_after := v_source.remaining_credits - v_recovered;
  v_source_status_after := CASE WHEN v_remaining_after > 0 THEN 'active' ELSE 'refunded' END;

  UPDATE public.credit_sources
     SET remaining_credits = v_remaining_after,
         status = v_source_status_after
   WHERE id = v_source.id;

  SELECT COALESCE(SUM(remaining_credits), 0)::integer
    INTO v_new_balance
    FROM public.credit_sources
   WHERE user_id = v_request.user_id
     AND status IN ('active', 'pending_refund')
     AND (expires_at IS NULL OR expires_at > now());

  UPDATE public.profiles
     SET credits = v_new_balance
   WHERE id = v_request.user_id;

  IF v_recovered > 0 THEN
    INSERT INTO public.credit_transactions (
      user_id,
      type,
      amount,
      balance_after,
      description,
      source_id,
      resource_type,
      resource_id
    ) VALUES (
      v_request.user_id,
      'refund',
      -v_recovered,
      v_new_balance,
      format('수동 환불 완료 (%s 크레딧 회수)', v_recovered),
      v_source.id,
      'refund_request',
      v_request.id
    );
  END IF;

  IF v_source_status_after = 'refunded' THEN
    UPDATE public.payment_orders
       SET status = 'refunded',
           canceled_at = COALESCE(canceled_at, now()),
           next_reconcile_at = NULL
     WHERE id = v_order.id;

    UPDATE public.payment_history
       SET status = 'refunded'
     WHERE payment_order_id = v_order.id;

    UPDATE public.checkout_attempts
       SET status = 'cancelled',
           updated_at = now()
     WHERE id = v_order.checkout_attempt_id;
  ELSE
    UPDATE public.payment_orders
       SET status = 'completed',
           failure_code = NULL,
           failure_message = NULL,
           next_reconcile_at = NULL
     WHERE id = v_order.id;
  END IF;

  UPDATE public.refund_requests
     SET status = 'completed',
         refund_amount = p_refund_amount,
         processed_by = p_admin_id,
         processed_at = now(),
         next_attempt_at = NULL
   WHERE id = v_request.id;

  INSERT INTO public.payment_admin_actions (
    actor_id,
    action,
    payment_order_id,
    refund_request_id,
    before_state,
    after_state,
    note,
    recovered_credits,
    unrecovered_credits,
    external_method,
    details
  ) VALUES (
    p_admin_id,
    'manual_refund_completed',
    v_order.id,
    v_request.id,
    jsonb_build_object(
      'request_status', v_request.status,
      'order_status', v_order.status,
      'source_status', v_source.status,
      'remaining_credits', v_source.remaining_credits,
      'profile_credits', v_balance_before
    ),
    jsonb_build_object(
      'request_status', 'completed',
      'order_status', CASE WHEN v_source_status_after = 'refunded' THEN 'refunded' ELSE 'completed' END,
      'source_status', v_source_status_after,
      'remaining_credits', v_remaining_after,
      'profile_credits', v_new_balance
    ),
    p_note,
    v_recovered,
    v_remaining_after,
    p_external_method,
    jsonb_build_object(
      'used_credits_before', v_used_before,
      'refund_amount', p_refund_amount,
      'partial', v_partial,
      'origin', v_request.origin
    )
  );

  RETURN jsonb_build_object(
    'already_completed', false,
    'new_balance', v_new_balance,
    'recovered_credits', v_recovered,
    'remaining_credits', v_remaining_after,
    'user_id', v_request.user_id
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 22. 대사 후보 (5.5). 두 함수의 후보 조건식은 글자 그대로 같아야 한다(계약 테스트).
--     ① 미처리 취소 표식(payapp·kakaopay)은 백오프 밖에서 후보가 된다.
--     ② payapp 환불의 retryable_failed는 자동 재시도하지 않는다.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_payment_reconciliation_batch(p_run_id uuid, p_limit integer)
 RETURNS TABLE(order_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'PAYMENT_RECONCILIATION_LIMIT_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.payment_reconciliation_scheduler prs
     WHERE prs.id = 1
       AND prs.lease_owner = p_run_id
       AND prs.lease_expires_at > now()
  ) THEN
    RAISE EXCEPTION 'PAYMENT_RECONCILIATION_LEASE_INVALID';
  END IF;

  UPDATE public.payment_reconciliation_scheduler
     SET lease_expires_at = now() + interval '4 minutes',
         updated_at = now()
   WHERE id = 1
     AND lease_owner = p_run_id;

  UPDATE public.payment_reconciliation_runs
     SET heartbeat_at = now(),
         lease_expires_at = now() + interval '4 minutes'
   WHERE id = p_run_id
     AND status = 'running';

  RETURN QUERY
  WITH candidates AS (
    SELECT po.id
      FROM public.payment_orders po
     WHERE (
            (
              po.status IN (
                'preparing',
                'ready_unknown',
                'ready',
                'confirming',
                'fulfillment_pending',
                'cancel_pending'
              )
              OR EXISTS (
                SELECT 1
                  FROM public.refund_requests rr
                 WHERE rr.payment_order_id = po.id
                   AND rr.status IN ('processing', 'retryable_failed')
                   AND (rr.next_attempt_at IS NULL OR rr.next_attempt_at <= now())
                   AND NOT (rr.provider = 'payapp' AND rr.status = 'retryable_failed')
              )
              OR EXISTS (
                SELECT 1
                  FROM public.payment_webhook_events pwe
                 WHERE pwe.order_id = po.order_id
                   AND pwe.processing_status IN ('pending', 'failed')
              )
            )
            AND (po.next_reconcile_at IS NULL OR po.next_reconcile_at <= now())
          )
        OR (
          po.provider IN ('payapp', 'kakaopay')
          AND EXISTS (
            SELECT 1
              FROM public.payment_provider_transactions ppt
             WHERE ppt.payment_order_id = po.id
               AND (
                 (ppt.cancel_feedback_recorded_at IS NOT NULL AND ppt.cancel_processed_at IS NULL)
                 OR (ppt.partial_cancel_feedback_recorded_at IS NOT NULL AND ppt.partial_cancel_processed_at IS NULL)
               )
          )
        )
     ORDER BY po.updated_at ASC, po.id ASC
     FOR UPDATE OF po SKIP LOCKED
     LIMIT p_limit
  ), claimed AS (
    UPDATE public.payment_orders po
       SET reconcile_attempt_count = po.reconcile_attempt_count + 1,
           next_reconcile_at = now() + interval '4 minutes',
           updated_at = po.updated_at
      FROM candidates c
     WHERE po.id = c.id
     RETURNING po.order_id
  )
  SELECT claimed.order_id
    FROM claimed;
END;
$function$;

CREATE OR REPLACE FUNCTION public.payment_reconciliation_backlog_count()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COUNT(DISTINCT po.id)::integer
    FROM public.payment_orders po
     WHERE (
            (
              po.status IN (
                'preparing',
                'ready_unknown',
                'ready',
                'confirming',
                'fulfillment_pending',
                'cancel_pending'
              )
              OR EXISTS (
                SELECT 1
                  FROM public.refund_requests rr
                 WHERE rr.payment_order_id = po.id
                   AND rr.status IN ('processing', 'retryable_failed')
                   AND (rr.next_attempt_at IS NULL OR rr.next_attempt_at <= now())
                   AND NOT (rr.provider = 'payapp' AND rr.status = 'retryable_failed')
              )
              OR EXISTS (
                SELECT 1
                  FROM public.payment_webhook_events pwe
                 WHERE pwe.order_id = po.order_id
                   AND pwe.processing_status IN ('pending', 'failed')
              )
            )
            AND (po.next_reconcile_at IS NULL OR po.next_reconcile_at <= now())
          )
        OR (
          po.provider IN ('payapp', 'kakaopay')
          AND EXISTS (
            SELECT 1
              FROM public.payment_provider_transactions ppt
             WHERE ppt.payment_order_id = po.id
               AND (
                 (ppt.cancel_feedback_recorded_at IS NOT NULL AND ppt.cancel_processed_at IS NULL)
                 OR (ppt.partial_cancel_feedback_recorded_at IS NOT NULL AND ppt.partial_cancel_processed_at IS NULL)
               )
          )
        );
$function$;

-- ---------------------------------------------------------------------------
-- 23. health 점검 (5.7). 기존 카카오페이 블록(SELECT COUNT … 경보 INSERT의 END IF)은
--     한 글자도 바꾸지 않는다. 카카오 부분취소 표식 블록과 페이앱 블록은 그 뒤에 따로 둔다.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_payment_reconciliation_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_scheduler public.payment_reconciliation_scheduler%ROWTYPE;
  v_stale_count integer;
  v_manual_count integer;
  v_backlog integer;
  v_scheduler_stale boolean;
  v_should_disable boolean;
  v_code text;
  v_message text;
  v_kakao_marker_active_count integer;
  v_kakao_marker_frozen_count integer;
  v_kakao_marker_disable boolean;
  v_payapp_unfulfilled_count integer;
  v_payapp_money_review_count integer;
  v_payapp_cancel_active_count integer;
  v_payapp_cancel_frozen_count integer;
  v_payapp_scheduler_unhealthy boolean;
  v_payapp_disable boolean;
  v_payapp_code text;
  v_payapp_message text;
BEGIN
  SELECT *
    INTO v_scheduler
    FROM public.payment_reconciliation_scheduler
   WHERE id = 1;

  SELECT COUNT(*)::integer
    INTO v_stale_count
    FROM public.payment_orders
   WHERE provider = 'kakaopay'
     AND status IN ('confirming', 'fulfillment_pending')
     AND updated_at <= now() - interval '10 minutes';

  SELECT COUNT(*)::integer
    INTO v_manual_count
    FROM public.payment_orders
   WHERE provider = 'kakaopay'
     AND status = 'manual_review';

  v_backlog := public.payment_reconciliation_backlog_count();
  v_scheduler_stale := v_scheduler.last_started_at IS NOT NULL
    AND (
      v_scheduler.last_succeeded_at IS NULL
      OR v_scheduler.last_succeeded_at <= now() - interval '15 minutes'
    );
  v_should_disable := v_stale_count > 0
    OR v_manual_count > 0
    OR v_scheduler_stale
    OR v_scheduler.consecutive_failures >= 3;

  IF v_stale_count > 0 THEN
    v_code := 'PAYMENT_RECONCILIATION_STALE_PAYMENT';
    v_message := '10분 이상 완료되지 않은 카카오페이 승인 또는 지급 건이 있습니다.';
  ELSIF v_manual_count > 0 THEN
    v_code := 'PAYMENT_RECONCILIATION_MANUAL_REVIEW';
    v_message := '카카오페이 대사 수동 확인 건이 있습니다.';
  ELSIF v_scheduler.consecutive_failures >= 3 THEN
    v_code := 'PAYMENT_RECONCILIATION_REPEATED_FAILURE';
    v_message := '결제 대사 작업이 3회 연속 실패했습니다.';
  ELSIF v_scheduler_stale THEN
    v_code := 'PAYMENT_RECONCILIATION_SCHEDULER_STALE';
    v_message := '결제 대사 성공 기록이 15분 이상 갱신되지 않았습니다.';
  END IF;

  IF v_should_disable THEN
    UPDATE public.payment_runtime_config
       SET kakaopay_accepts_new_orders = false,
           changed_at = now(),
           changed_by = 'payment_reconciliation_health',
           change_ticket = v_code
     WHERE id = true
       AND kakaopay_accepts_new_orders = true;

    INSERT INTO public.payment_reconciliation_alerts (
      code,
      severity,
      message,
      details
    )
    SELECT
      v_code,
      'critical',
      v_message,
      jsonb_build_object(
        'stale_count', v_stale_count,
        'manual_review_count', v_manual_count,
        'backlog', v_backlog,
        'consecutive_failures', v_scheduler.consecutive_failures,
        'last_succeeded_at', v_scheduler.last_succeeded_at
      )
    WHERE NOT EXISTS (
      SELECT 1
        FROM public.payment_reconciliation_alerts pra
       WHERE pra.code = v_code
         AND pra.resolved_at IS NULL
    );
  END IF;

  -- 카카오 부분취소 표식 블록: 미처리 표식 + 크레딧 사용 가능이 10분을 넘으면 카카오 판매를 끈다.
  SELECT
    COUNT(*) FILTER (WHERE cs.status = 'active')::integer,
    COUNT(*) FILTER (WHERE cs.status IS DISTINCT FROM 'active')::integer
    INTO v_kakao_marker_active_count, v_kakao_marker_frozen_count
    FROM public.payment_orders po
    JOIN public.payment_provider_transactions ppt ON ppt.payment_order_id = po.id
    LEFT JOIN public.credit_sources cs ON cs.payment_order_id = po.id
   WHERE po.provider = 'kakaopay'
     AND ppt.partial_cancel_feedback_recorded_at <= now() - interval '10 minutes'
     AND ppt.partial_cancel_processed_at IS NULL;

  v_kakao_marker_disable := v_kakao_marker_active_count > 0;

  IF v_kakao_marker_disable THEN
    UPDATE public.payment_runtime_config
       SET kakaopay_accepts_new_orders = false,
           changed_at = now(),
           changed_by = 'payment_reconciliation_health',
           change_ticket = 'KAKAOPAY_PARTIAL_CANCEL_UNPROCESSED'
     WHERE id = true
       AND kakaopay_accepts_new_orders = true;

    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'KAKAOPAY_PARTIAL_CANCEL_UNPROCESSED',
      'critical',
      '카카오페이 부분취소 처리가 10분 넘게 끝나지 않았고 크레딧을 쓸 수 있는 상태입니다.',
      jsonb_build_object('count', v_kakao_marker_active_count)
    )
    ON CONFLICT (code) WHERE resolved_at IS NULL DO NOTHING;
  ELSIF v_kakao_marker_frozen_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'KAKAOPAY_PARTIAL_CANCEL_UNPROCESSED_FROZEN',
      'warning',
      '카카오페이 부분취소 처리가 10분 넘게 끝나지 않았습니다(크레딧은 묶여 있음).',
      jsonb_build_object('count', v_kakao_marker_frozen_count)
    )
    ON CONFLICT (code) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  -- 페이앱 블록: 돈이 걸린 위험만 판매를 끈다.
  SELECT COUNT(*)::integer
    INTO v_payapp_unfulfilled_count
    FROM public.payment_orders po
    JOIN public.payment_provider_transactions ppt ON ppt.payment_order_id = po.id
   WHERE po.provider = 'payapp'
     AND ppt.paid_feedback_recorded_at <= now() - interval '10 minutes'
     AND po.source_id IS NULL
     AND ppt.cancel_feedback_recorded_at IS NULL
     AND ppt.partial_cancel_feedback_recorded_at IS NULL;

  SELECT COUNT(*)::integer
    INTO v_payapp_money_review_count
    FROM public.payment_orders po
   WHERE po.provider = 'payapp'
     AND po.status = 'manual_review'
     AND po.failure_code IN (
       'PAYAPP_FEEDBACK_MISMATCH',
       'PAYAPP_MUL_NO_CONFLICT',
       'PAYAPP_PARTIAL_CANCEL',
       'PAYAPP_READY_CANCEL_FAILED',
       'PAYAPP_FULFILLMENT_RETRY_EXHAUSTED',
       'PAYAPP_CANCEL_HANDLING_FAILED'
     );

  SELECT
    COUNT(*) FILTER (WHERE cs.status = 'active')::integer,
    COUNT(*) FILTER (WHERE cs.status IS DISTINCT FROM 'active')::integer
    INTO v_payapp_cancel_active_count, v_payapp_cancel_frozen_count
    FROM public.payment_orders po
    JOIN public.payment_provider_transactions ppt ON ppt.payment_order_id = po.id
    LEFT JOIN public.credit_sources cs ON cs.payment_order_id = po.id
   WHERE po.provider = 'payapp'
     AND (
       (ppt.cancel_feedback_recorded_at <= now() - interval '10 minutes'
        AND ppt.cancel_processed_at IS NULL)
       OR (ppt.partial_cancel_feedback_recorded_at <= now() - interval '10 minutes'
           AND ppt.partial_cancel_processed_at IS NULL)
     );

  v_payapp_scheduler_unhealthy := v_scheduler_stale OR v_scheduler.consecutive_failures >= 3;

  v_payapp_disable := v_payapp_unfulfilled_count > 0
    OR v_payapp_money_review_count > 0
    OR v_payapp_cancel_active_count > 0
    OR v_payapp_scheduler_unhealthy;

  IF v_payapp_unfulfilled_count > 0 THEN
    v_payapp_code := 'PAYAPP_PAID_UNFULFILLED';
    v_payapp_message := '결제완료가 기록됐지만 10분 넘게 크레딧이 지급되지 않은 페이앱 건이 있습니다.';
  ELSIF v_payapp_cancel_active_count > 0 THEN
    v_payapp_code := 'PAYAPP_CANCEL_UNPROCESSED';
    v_payapp_message := '페이앱 취소 처리가 10분 넘게 끝나지 않았고 크레딧을 쓸 수 있는 상태입니다.';
  ELSIF v_payapp_money_review_count > 0 THEN
    v_payapp_code := 'PAYAPP_MONEY_RISK_REVIEW';
    v_payapp_message := '돈이 걸린 페이앱 수동 확인 건이 있습니다.';
  ELSIF v_payapp_scheduler_unhealthy THEN
    v_payapp_code := 'PAYAPP_RECONCILIATION_UNHEALTHY';
    v_payapp_message := '결제 대사 작업이 정상 동작하지 않아 페이앱 신규 결제를 멈췄습니다.';
  END IF;

  IF v_payapp_disable THEN
    UPDATE public.payment_runtime_config
       SET payapp_accepts_new_orders = false,
           changed_at = now(),
           changed_by = 'payment_reconciliation_health',
           change_ticket = v_payapp_code
     WHERE id = true
       AND payapp_accepts_new_orders = true;
  END IF;

  -- 스케줄러 이상은 기존 블록이 이미 경보를 남기므로 돈 위험 조건만 페이앱 경보로 남긴다.
  IF v_payapp_disable AND v_payapp_code <> 'PAYAPP_RECONCILIATION_UNHEALTHY' THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      v_payapp_code,
      'critical',
      v_payapp_message,
      jsonb_build_object(
        'paid_unfulfilled_count', v_payapp_unfulfilled_count,
        'money_review_count', v_payapp_money_review_count,
        'cancel_unprocessed_active_count', v_payapp_cancel_active_count,
        'consecutive_failures', v_scheduler.consecutive_failures,
        'last_succeeded_at', v_scheduler.last_succeeded_at
      )
    )
    ON CONFLICT (code) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  IF v_payapp_cancel_frozen_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'PAYAPP_CANCEL_UNPROCESSED_FROZEN',
      'warning',
      '페이앱 취소 처리가 10분 넘게 끝나지 않았습니다(크레딧은 묶여 있거나 지급 전).',
      jsonb_build_object('count', v_payapp_cancel_frozen_count)
    )
    ON CONFLICT (code) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'healthy', NOT (v_should_disable OR v_kakao_marker_disable),
    'backlog', v_backlog,
    'stale_count', v_stale_count,
    'manual_review_count', v_manual_count,
    'consecutive_failures', v_scheduler.consecutive_failures,
    'last_started_at', v_scheduler.last_started_at,
    'last_succeeded_at', v_scheduler.last_succeeded_at,
    'kakaopay_disabled', v_should_disable OR v_kakao_marker_disable,
    'payapp_disabled', v_payapp_disable
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 24. 사용자 결제내역·환불 조회 (5.5). 반환 컬럼이 늘어 지우고 다시 만든다.
--     기존 컬럼 순서는 유지하고 끝에만 더한다.
-- ---------------------------------------------------------------------------

DROP FUNCTION public.get_my_payment_history();

CREATE FUNCTION public.get_my_payment_history()
 RETURNS TABLE(
   id uuid,
   created_at timestamp with time zone,
   amount integer,
   status text,
   payment_method text,
   order_id text,
   provider text,
   provider_status text,
   approved_at timestamp with time zone,
   plan_id uuid,
   plan_name text,
   payment_method_label text,
   refunded_amount integer
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    ph.id,
    ph.created_at,
    ph.amount,
    ph.status,
    ph.payment_method,
    ph.order_id,
    ph.provider,
    ph.provider_status,
    ph.approved_at,
    ph.plan_id,
    pp.name,
    pm.label,
    COALESCE((
      SELECT SUM(rr.refund_amount)
        FROM public.refund_requests rr
       WHERE rr.source_id = ph.source_id
         AND rr.status = 'completed'
    ), 0)::integer
  FROM public.payment_history ph
  LEFT JOIN public.pricing_plans pp ON pp.id = ph.plan_id
  LEFT JOIN public.payment_orders po ON po.id = ph.payment_order_id
  LEFT JOIN public.payment_methods pm
    ON pm.code = COALESCE(
         po.payment_method_code,
         CASE WHEN po.provider = 'kakaopay' THEN 'kakaopay' END
       )
   AND pm.provider = po.provider
  WHERE ph.user_id = (SELECT auth.uid())
    AND ph.amount > 0
    AND ph.plan_id IS NOT NULL
  ORDER BY ph.created_at DESC;
$function$;

DROP FUNCTION public.get_my_refund_requests();

CREATE FUNCTION public.get_my_refund_requests()
 RETURNS TABLE(
   id uuid,
   source_id uuid,
   reason text,
   status text,
   refund_amount integer,
   processed_at timestamp with time zone,
   created_at timestamp with time zone,
   updated_at timestamp with time zone,
   origin text
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    rr.id,
    rr.source_id,
    rr.reason,
    rr.status,
    rr.refund_amount,
    rr.processed_at,
    rr.created_at,
    rr.updated_at,
    rr.origin
  FROM public.refund_requests rr
  WHERE rr.user_id = (SELECT auth.uid())
  ORDER BY rr.created_at DESC;
$function$;

-- ---------------------------------------------------------------------------
-- 25. manual_review 해소 (6.4). 지급 경로 순서(payment_orders → ppt → profiles → 원천)로 잠근다.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.resolve_payment_order_review(
  p_payment_order_id uuid,
  p_action text,
  p_actor_id uuid,
  p_note text,
  p_mul_no text DEFAULT NULL,
  p_paid_at timestamp with time zone DEFAULT NULL,
  p_external_method text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_fulfill jsonb;
  v_paid_via text;
  v_after_status text;
  v_approved_at timestamptz;
BEGIN
  IF p_action IS NULL
     OR p_action NOT IN ('paid_confirmed', 'unpaid_confirmed', 'cancel_handled')
     OR p_actor_id IS NULL
     OR NULLIF(BTRIM(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_REVIEW_INPUT_INVALID';
  END IF;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND';
  END IF;

  SELECT * INTO v_ppt
    FROM public.payment_provider_transactions
   WHERE payment_order_id = v_order.id
   FOR UPDATE;

  IF v_order.status <> 'manual_review' THEN
    RAISE EXCEPTION 'PAYMENT_REVIEW_NOT_PENDING';
  END IF;

  IF p_action = 'paid_confirmed' THEN
    IF v_order.provider <> 'payapp'
       OR v_ppt.id IS NULL
       OR v_order.source_id IS NOT NULL
       OR v_ppt.cancel_feedback_recorded_at IS NOT NULL
       OR v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL
       OR v_order.failure_code IN ('EXTERNAL_PROVIDER_CANCELLATION', 'PAYAPP_PARTIAL_CANCEL_QUARANTINED', 'PAYAPP_CANCEL_HANDLING_FAILED') THEN
      RAISE EXCEPTION 'PAYMENT_REVIEW_ACTION_NOT_ALLOWED';
    END IF;

    IF v_ppt.paid_feedback_recorded_at IS NOT NULL
       AND v_ppt.paid_amount = v_order.expected_amount THEN
      v_paid_via := 'feedback';
      v_approved_at := COALESCE(v_ppt.provider_paid_at, v_ppt.paid_feedback_recorded_at);
    ELSE
      IF p_mul_no IS NULL OR p_mul_no !~ '^[0-9]+$'
         OR (v_ppt.provider_transaction_id IS NOT NULL AND v_ppt.provider_transaction_id <> p_mul_no) THEN
        RAISE EXCEPTION 'PAYMENT_REVIEW_MUL_NO_INVALID';
      END IF;

      v_paid_via := 'admin';
      v_approved_at := COALESCE(p_paid_at, now());

      -- 결제 시각은 만료(1년)와 환불 기한(7일)의 기준이므로 주문 생성 이후·현재 이전만 받는다.
      IF v_approved_at > now() OR v_approved_at < v_order.created_at THEN
        RAISE EXCEPTION 'PAYMENT_REVIEW_PAID_AT_INVALID';
      END IF;

      BEGIN
        UPDATE public.payment_provider_transactions
           SET provider_transaction_id = COALESCE(provider_transaction_id, p_mul_no),
               admin_paid_confirmed_at = COALESCE(admin_paid_confirmed_at, v_approved_at),
               updated_at = now()
         WHERE id = v_ppt.id;
      EXCEPTION
        WHEN unique_violation THEN
          RAISE EXCEPTION 'PAYAPP_MUL_NO_CONFLICT';
      END;
    END IF;

    UPDATE public.payment_orders
       SET status = 'fulfillment_pending',
           updated_at = now()
     WHERE id = v_order.id;

    v_fulfill := public.payapp_fulfill_order_internal(v_order.id, v_approved_at);
    v_after_status := 'completed';
  ELSIF p_action = 'unpaid_confirmed' THEN
    IF v_order.provider <> 'payapp'
       OR v_order.source_id IS NOT NULL
       OR v_ppt.paid_feedback_recorded_at IS NOT NULL
       OR v_ppt.admin_paid_confirmed_at IS NOT NULL
       OR v_ppt.cancel_feedback_recorded_at IS NOT NULL
       OR v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL THEN
      RAISE EXCEPTION 'PAYMENT_REVIEW_ACTION_NOT_ALLOWED';
    END IF;

    UPDATE public.payment_orders
       SET status = 'expired',
           next_reconcile_at = NULL,
           updated_at = now()
     WHERE id = v_order.id;

    UPDATE public.checkout_attempts
       SET status = 'expired',
           updated_at = now()
     WHERE id = v_order.checkout_attempt_id
       AND status <> 'completed';

    v_after_status := 'expired';
  ELSE
    IF v_order.source_id IS NOT NULL THEN
      SELECT * INTO v_source
        FROM public.credit_sources
       WHERE id = v_order.source_id;
    END IF;

    IF p_external_method IS NULL
       OR p_external_method NOT IN ('payapp_cancel_request', 'bank_transfer', 'provider_admin_cancel')
       OR NOT (
         (v_order.provider = 'payapp' AND v_order.failure_code IN ('PAYAPP_PARTIAL_CANCEL', 'PAYAPP_CANCEL_HANDLING_FAILED'))
         OR (v_order.provider = 'kakaopay' AND v_order.failure_code = 'KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW')
       )
       OR (v_source.id IS NOT NULL AND v_source.status <> 'refunded') THEN
      -- 활성·묶인 원천이 있으면 complete_manual_point_charge_refund로 해소한다.
      RAISE EXCEPTION 'PAYMENT_REVIEW_ACTION_NOT_ALLOWED';
    END IF;

    v_after_status := CASE WHEN v_source.id IS NULL THEN 'failed' ELSE 'refunded' END;

    UPDATE public.payment_orders
       SET status = v_after_status,
           next_reconcile_at = NULL,
           updated_at = now()
     WHERE id = v_order.id;

    IF v_after_status = 'refunded' THEN
      UPDATE public.payment_history
         SET status = 'refunded'
       WHERE payment_order_id = v_order.id;
    END IF;

    UPDATE public.checkout_attempts
       SET status = 'cancelled',
           updated_at = now()
     WHERE id = v_order.checkout_attempt_id
       AND status <> 'completed';
  END IF;

  INSERT INTO public.payment_admin_actions (
    actor_id,
    action,
    payment_order_id,
    before_state,
    after_state,
    note,
    external_method,
    details
  ) VALUES (
    p_actor_id,
    p_action,
    v_order.id,
    jsonb_build_object('order_status', v_order.status, 'failure_code', v_order.failure_code),
    jsonb_build_object('order_status', v_after_status),
    p_note,
    p_external_method,
    jsonb_build_object(
      'paid_via', v_paid_via,
      'mul_no', COALESCE(v_ppt.provider_transaction_id, p_mul_no),
      'approved_at', v_approved_at,
      'fulfillment', v_fulfill
    )
  );

  UPDATE public.payment_reconciliation_alerts
     SET resolved_at = now()
   WHERE resolved_at IS NULL
     AND details->>'payment_order_id' = v_order.id::text;

  RETURN jsonb_build_object(
    'status', v_after_status,
    'user_id', v_order.user_id,
    'new_balance', v_fulfill->'new_balance'
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 26. 권한 (5.4). 이 DB의 기본 권한은 새 함수를 anon·authenticated에 열어 두므로
--     신규·재정의 결제 함수는 모두 명시적으로 회수하고 service_role에만 준다.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.record_payment_alert(text, text, text, jsonb)',
    'public.prepare_payment_order(uuid, uuid, text, uuid, text, text, integer, integer, text, text, text, text, text, timestamp with time zone, integer, integer, text, text)',
    'public.begin_payapp_request(uuid)',
    'public.store_payapp_request(uuid, text, text)',
    'public.fail_payapp_request(uuid, text, text)',
    'public.apply_payapp_feedback(text, text, text, text, integer, integer, integer, integer, timestamp with time zone, timestamp with time zone)',
    'public.retry_payapp_fulfillment(uuid)',
    'public.mark_payapp_order_terminal(uuid, text, text, text, text)',
    'public.mark_payment_reconciliation_terminal(uuid, text, text, text, text)',
    'public.quarantine_external_provider_cancellation(uuid, text, timestamp with time zone, text)',
    'public.quarantine_payapp_partial_cancellation(uuid)',
    'public.process_payapp_cancellation(uuid)',
    'public.record_kakaopay_partial_cancel_marker(uuid, text)',
    'public.quarantine_kakaopay_partial_cancellation(uuid, text, integer)',
    'public.get_point_charge_refund_eligibility(uuid, uuid)',
    'public.claim_point_charge_refund(uuid, uuid, text)',
    'public.finalize_point_charge_refund(uuid, text, timestamp with time zone, text)',
    'public.requeue_stuck_point_charge_refund(uuid)',
    'public.reject_point_charge_refund(uuid, uuid, text, boolean)',
    'public.complete_manual_point_charge_refund(uuid, uuid, text, text, integer, integer)',
    'public.claim_payment_reconciliation_batch(uuid, integer)',
    'public.payment_reconciliation_backlog_count()',
    'public.enforce_payment_reconciliation_health()',
    'public.resolve_payment_order_review(uuid, text, uuid, text, text, timestamp with time zone, text)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_signature);
  END LOOP;
END;
$$;

-- 사용자 세션에서 부르는 조회 함수
REVOKE ALL ON FUNCTION public.get_my_payment_history() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_payment_history() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_refund_requests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_refund_requests() TO authenticated, service_role;

-- 지급 내부 함수: postgres 소유 SECURITY DEFINER 호출자만 부를 수 있다.
REVOKE ALL ON FUNCTION public.payapp_fulfill_order_internal(uuid, timestamp with time zone)
  FROM PUBLIC, anon, authenticated, service_role;

-- 운영에만 있는 크레딧 함수의 실행 권한 회수(사용자 결정 2026-10-19). 로컬에는 함수가 없다.
DO $$
BEGIN
  IF to_regprocedure('public.consume_credits_once(uuid,integer,text,uuid,text,text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.consume_credits_once(uuid, integer, text, uuid, text, text)
      FROM PUBLIC, anon, authenticated;
  ELSE
    RAISE NOTICE 'consume_credits_once 없음';
  END IF;

  IF to_regprocedure('public.refund_credits_once(uuid,integer,text,uuid,text,text,text,integer)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.refund_credits_once(uuid, integer, text, uuid, text, text, text, integer)
      FROM PUBLIC, anon, authenticated;
  ELSE
    RAISE NOTICE 'refund_credits_once 없음';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 27. 검증 블록 (체크리스트 A-post). 하나라도 틀리면 전체를 롤백한다.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_count integer;
  v_text text;
  v_signature text;
BEGIN
  -- 1. prepare_payment_order 오버로드 1개, 인자 18개, 기본값 1개
  SELECT COUNT(*) INTO v_count
    FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname = 'prepare_payment_order';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'VERIFY: prepare_payment_order overloads = %', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname = 'prepare_payment_order'
     AND pronargs = 18
     AND pronargdefaults = 1;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'VERIFY: prepare_payment_order signature';
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname = 'reject_point_charge_refund';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'VERIFY: reject_point_charge_refund overloads = %', v_count;
  END IF;

  -- 2. payment_orders.provider 기본값 없음
  SELECT column_default INTO v_text
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'payment_orders'
     AND column_name = 'provider';
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: payment_orders.provider default = %', v_text;
  END IF;

  -- 3(a). PUBLIC/anon이 실행할 수 있는 SECURITY DEFINER 함수는 handle_new_user뿐
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_text
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prokind = 'f'
     AND p.prosecdef
     AND (p.proacl IS NULL OR p.proacl::text ~ '(\{|,)(=|anon=)X')
     AND p.proname <> 'handle_new_user';
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: public/anon executable definer functions: %', v_text;
  END IF;

  -- 3(b). 이번에 만들거나 고친 결제 함수: 서버 전용, SECURITY DEFINER, search_path 고정
  FOREACH v_signature IN ARRAY ARRAY[
    'public.record_payment_alert(text, text, text, jsonb)',
    'public.prepare_payment_order(uuid, uuid, text, uuid, text, text, integer, integer, text, text, text, text, text, timestamp with time zone, integer, integer, text, text)',
    'public.begin_payapp_request(uuid)',
    'public.store_payapp_request(uuid, text, text)',
    'public.fail_payapp_request(uuid, text, text)',
    'public.apply_payapp_feedback(text, text, text, text, integer, integer, integer, integer, timestamp with time zone, timestamp with time zone)',
    'public.retry_payapp_fulfillment(uuid)',
    'public.mark_payapp_order_terminal(uuid, text, text, text, text)',
    'public.mark_payment_reconciliation_terminal(uuid, text, text, text, text)',
    'public.quarantine_external_provider_cancellation(uuid, text, timestamp with time zone, text)',
    'public.quarantine_payapp_partial_cancellation(uuid)',
    'public.process_payapp_cancellation(uuid)',
    'public.record_kakaopay_partial_cancel_marker(uuid, text)',
    'public.quarantine_kakaopay_partial_cancellation(uuid, text, integer)',
    'public.get_point_charge_refund_eligibility(uuid, uuid)',
    'public.claim_point_charge_refund(uuid, uuid, text)',
    'public.finalize_point_charge_refund(uuid, text, timestamp with time zone, text)',
    'public.requeue_stuck_point_charge_refund(uuid)',
    'public.reject_point_charge_refund(uuid, uuid, text, boolean)',
    'public.complete_manual_point_charge_refund(uuid, uuid, text, text, integer, integer)',
    'public.claim_payment_reconciliation_batch(uuid, integer)',
    'public.payment_reconciliation_backlog_count()',
    'public.enforce_payment_reconciliation_health()',
    'public.resolve_payment_order_review(uuid, text, uuid, text, text, timestamp with time zone, text)'
  ]
  LOOP
    SELECT COUNT(*) INTO v_count
      FROM pg_proc p
     WHERE p.oid = v_signature::regprocedure
       AND p.prosecdef
       AND COALESCE(p.proconfig, '{}') @> ARRAY['search_path=public, pg_temp']
       AND p.proacl IS NOT NULL
       AND p.proacl::text !~ '(\{|,)(=|anon=|authenticated=)X'
       AND p.proacl::text ~ 'service_role=X';
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'VERIFY: function privileges %', v_signature;
    END IF;
  END LOOP;

  -- 지급 내부 함수는 소유자만 실행할 수 있다.
  SELECT proacl::text INTO v_text
    FROM pg_proc
   WHERE oid = 'public.payapp_fulfill_order_internal(uuid, timestamp with time zone)'::regprocedure
     AND prosecdef
     AND COALESCE(proconfig, '{}') @> ARRAY['search_path=public, pg_temp'];
  IF v_text IS DISTINCT FROM '{postgres=X/postgres}' THEN
    RAISE EXCEPTION 'VERIFY: payapp_fulfill_order_internal acl = %', v_text;
  END IF;

  -- 3(c). 사용자 조회 함수는 authenticated만 더 허용한다.
  SELECT COUNT(*) INTO v_count
    FROM pg_proc p
   WHERE p.oid IN (
           'public.get_my_payment_history()'::regprocedure,
           'public.get_my_refund_requests()'::regprocedure
         )
     AND p.prosecdef
     AND COALESCE(p.proconfig, '{}') @> ARRAY['search_path=public, pg_temp']
     AND p.proacl::text ~ 'authenticated=X'
     AND p.proacl::text ~ 'service_role=X'
     AND p.proacl::text !~ '(\{|,)(=|anon=)X';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'VERIFY: get_my_* privileges';
  END IF;

  -- 운영에만 있는 크레딧 함수: 있으면 서버 전용이어야 한다.
  IF to_regprocedure('public.consume_credits_once(uuid,integer,text,uuid,text,text)') IS NOT NULL THEN
    SELECT proacl::text INTO v_text
      FROM pg_proc
     WHERE oid = to_regprocedure('public.consume_credits_once(uuid,integer,text,uuid,text,text)');
    IF v_text ~ '(\{|,)(=|anon=|authenticated=)X' OR v_text !~ 'service_role=X' THEN
      RAISE EXCEPTION 'VERIFY: consume_credits_once acl = %', v_text;
    END IF;
  END IF;

  IF to_regprocedure('public.refund_credits_once(uuid,integer,text,uuid,text,text,text,integer)') IS NOT NULL THEN
    SELECT proacl::text INTO v_text
      FROM pg_proc
     WHERE oid = to_regprocedure('public.refund_credits_once(uuid,integer,text,uuid,text,text,text,integer)');
    IF v_text ~ '(\{|,)(=|anon=|authenticated=)X' OR v_text !~ 'service_role=X' THEN
      RAISE EXCEPTION 'VERIFY: refund_credits_once acl = %', v_text;
    END IF;
  END IF;

  -- 4. 새 테이블: RLS 켜짐, anon·authenticated 권한 없음, service_role은 SELECT만
  SELECT COUNT(*) INTO v_count
    FROM pg_class c
   WHERE c.oid IN ('public.payment_methods'::regclass, 'public.payment_admin_actions'::regclass)
     AND c.relrowsecurity
     AND c.relacl::text = '{postgres=arwdDxtm/postgres,service_role=r/postgres}';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'VERIFY: new table privileges';
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM pg_constraint
   WHERE conrelid = 'public.payment_admin_actions'::regclass
     AND contype = 'f';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'VERIFY: payment_admin_actions must not have foreign keys';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.payment_methods;
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'VERIFY: payment_methods rows = %', v_count;
  END IF;

  -- 5. 결제사 CHECK 6개에 payapp, 모두 검증됨. 복합 FK와 payapp 결제수단 CHECK.
  SELECT COUNT(*) INTO v_count
    FROM pg_constraint
   WHERE conname IN (
           'payment_orders_provider_check',
           'checkout_attempts_claimed_provider_check',
           'payment_provider_transactions_provider_check',
           'refund_requests_provider_check',
           'payment_reconciliation_items_provider_check',
           'payment_orders_provider_snapshot_check'
         )
     AND convalidated
     AND pg_get_constraintdef(oid) ~ 'payapp';
  IF v_count <> 6 THEN
    RAISE EXCEPTION 'VERIFY: provider checks = %', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM pg_constraint
   WHERE conname IN ('payment_orders_payment_method_fkey', 'payment_orders_payapp_payment_method_check')
     AND conrelid = 'public.payment_orders'::regclass
     AND convalidated;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'VERIFY: payment method constraints = %', v_count;
  END IF;

  -- 6. 환불 키 인덱스가 열린 상태로 한정됐다.
  SELECT pg_get_indexdef('public.refund_requests_cancel_idempotency_key'::regclass) INTO v_text;
  IF v_text !~ '^CREATE UNIQUE INDEX'
     OR v_text !~ 'pending_review'
     OR v_text !~ 'processing'
     OR v_text !~ 'retryable_failed'
     OR v_text !~ 'manual_review' THEN
    RAISE EXCEPTION 'VERIFY: refund key index = %', v_text;
  END IF;

  -- 7. 페이앱 스위치는 꺼진 상태
  SELECT COUNT(*) INTO v_count
    FROM public.payment_runtime_config
   WHERE id = true
     AND payapp_accepts_new_orders = false
     AND payapp_merchant_id IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'VERIFY: payapp runtime switch';
  END IF;

  -- 8. 트리거 함수에 새 컬럼이 반영됐다.
  IF pg_get_functiondef('public.prevent_payment_order_snapshot_update()'::regprocedure) !~ 'payment_method_code' THEN
    RAISE EXCEPTION 'VERIFY: snapshot trigger function';
  END IF;

  SELECT pg_get_functiondef('public.prevent_payment_provider_identifier_replacement()'::regprocedure) INTO v_text;
  FOREACH v_signature IN ARRAY ARRAY[
    'paid_feedback_recorded_at', 'paid_amount', 'cancel_feedback_recorded_at',
    'partial_cancel_feedback_recorded_at', 'admin_paid_confirmed_at', 'provider_paid_at',
    'cancel_processed_at', 'partial_cancel_processed_at', 'partial_cancel_amount'
  ]
  LOOP
    IF v_text !~ ('OLD\.' || v_signature || ' IS NOT NULL') THEN
      RAISE EXCEPTION 'VERIFY: marker trigger misses %', v_signature;
    END IF;
  END LOOP;

  SELECT COUNT(*) INTO v_count
    FROM pg_constraint
   WHERE conrelid = 'public.refund_requests'::regclass
     AND conname = 'refund_requests_origin_check'
     AND convalidated;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'VERIFY: refund_requests origin check';
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM pg_trigger
   WHERE NOT tgisinternal
     AND tgname IN ('prevent_refund_request_origin_change', 'prevent_payment_admin_action_mutation', 'prevent_payment_admin_action_truncate');
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'VERIFY: new triggers = %', v_count;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
