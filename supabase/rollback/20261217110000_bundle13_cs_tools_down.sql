-- 13번 묶음 M1 되돌리기(계획 docs/plan-bundle13-cs-tools.md 4-7). 순서: M3 down → M2 down → 코드 되돌림 → (필요하면) 이 파일.
-- 코드를 먼저 되돌려도 되는 것은 답변 수정 이력이 0건일 때뿐이다. 이력이 있으면 이 파일은 멈추고 재정의된 member_withdrawal_facts 가 남아
--   새 가림 종류(support_ticket_answer_revision)를 내놓는다 — 옛 탈퇴 route 는 그 종류를 거부하므로 5-1 코드는 되돌리지 않는다(4-7 조건).
--   2027-01-11 처리방침 시행 뒤에는 8절 열람 기록 코드도 되돌리지 않는다. 이 파일을 돌리기 전에 회원 고객지원 화면을 옛 코드로 되돌린다
--   (새 화면은 support_page_content 행이 없으면 오류 화면). 10번을 되돌려야 하면 13번을 먼저 되돌린다.
-- 두 단계: 문의 CS 도구 코드를 먼저 되돌려 배포한 뒤 이력 건수를 다시 보고, 0 일 때만 5-1 코드를 되돌리고 이 파일을 돌린다.
-- 2027-01-11 처리방침 시행 뒤에는 이 파일을 쓰지 않는다: support_page_content 행(열람 기록 보관 연수 accessLogRetentionYears = 2,
--   처리방침 3절의 근거 값)을 지우기 때문이다. 그때 M1 을 되돌려야 하면 그 행을 남기는 별도 스크립트를 먼저 만든다.
-- 멈춤 조건:
--   1. M2 가 아직 적용돼 있으면(잠금 트리거가 있거나 정책 support_tickets_admin_update 가 없으면).
--   2. 재정의 4개가 13번 정의(본문 md5(prosrc))가 아니면 — 뒤 묶음이 다시 정의했으면 덮어쓰지 않는다.
--   3. 답변 이력 행이 1건이라도 있으면 — 회원이 본 글의 유일한 사본이고, 지우면 가림 판정도 사라진다.
--   4. 템플릿·안내 문구가 첫 값과 다르면 c_export_confirmed 를 true 로 바꾼 뒤에만(내보내기 확인, 12번과 같은 틀).
-- 하는 것: 재정의 4개를 10번 원문(2026-11-26 운영 pg_get_functiondef 그대로)으로 되돌리고, 저장 함수·slug 트리거와 함수·이력 표(가드 포함)·
--   템플릿 표·support_page_content 행·response_edited_at 칸을 지운다. M0(열람 기록)은 건드리지 않는다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $down_precheck_bundle13_cs_tools$
DECLARE
  c_export_confirmed constant boolean := false;
BEGIN
  IF to_regclass('public.support_ticket_answer_revisions') IS NULL OR to_regclass('public.support_reply_templates') IS NULL THEN
    RAISE EXCEPTION 'DOWN PRECHECK: bundle 13 M1 tables missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.support_tickets'::regclass AND t.tgname = 'guard_support_ticket_answer_write')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_tickets' AND policyname = 'support_tickets_admin_update') THEN
    RAISE EXCEPTION 'DOWN PRECHECK: M2 is still applied — run 20261217120000_bundle13_support_answer_guard_down.sql first';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.member_withdrawal_facts(uuid,boolean)'::regprocedure) IS DISTINCT FROM '15147d898bdd615963fd7173e154d9f5'
     OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure) IS DISTINCT FROM '7ddf1b9245c429205af6b36fa01bfb21'
     OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.mark_member_text_reviewed(uuid,text,uuid)'::regprocedure) IS DISTINCT FROM '1284e5d70af808bb2b949432d92e255b'
     OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.read_withdrawn_member_ticket(uuid,uuid,text,jsonb)'::regprocedure) IS DISTINCT FROM 'ba416c661c7e9fb4c036c8516cd85d2c' THEN
    RAISE EXCEPTION 'DOWN PRECHECK: bundle 10 functions are not the bundle 13 definition';
  END IF;
  IF EXISTS (SELECT 1 FROM public.support_ticket_answer_revisions) THEN
    RAISE EXCEPTION 'DOWN PRECHECK: answer revisions exist (회원이 본 글의 유일한 사본 — 지우지 않는다)';
  END IF;
  IF NOT c_export_confirmed
     AND ((SELECT count(*) FROM public.support_reply_templates) <> 14
          OR EXISTS (SELECT 1 FROM public.support_reply_templates
                      WHERE created_by IS NOT NULL OR updated_by IS NOT NULL OR revision <> 1 OR deleted_at IS NOT NULL OR is_active IS NOT TRUE)
          OR (SELECT value -> 'revision' FROM public.system_settings WHERE key = 'support_page_content') IS DISTINCT FROM '1'::jsonb) THEN
    RAISE EXCEPTION 'DOWN PRECHECK: templates / support_page_content changed — export them, then set c_export_confirmed';
  END IF;
END;
$down_precheck_bundle13_cs_tools$;

-- 1. 10번 원문으로(운영 2026-11-26 pg_get_functiondef 그대로 — 지문 1-3)
CREATE OR REPLACE FUNCTION public.member_withdrawal_facts(p_user_id uuid, p_ticket_retention_agreed boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_policy jsonb := public.member_withdrawal_policy();
  v_now timestamptz := now();
  v_profile public.profiles%ROWTYPE;
  v_order_ids uuid[];
  v_order_id_texts text[];
  v_order_keys text[];
  v_mul_nos text[];
  v_paid_reasons text[] := ARRAY[]::text[];
  v_had_payment boolean;
  v_has_orders boolean;
  v_in_orders integer;
  v_in_attempts integer;
  v_in_markers integer;
  v_in_webhooks integer;
  v_in_point_refunds integer;
  v_in_market_refunds integer;
  v_in_sources integer;
  v_in_alerts integer;
  v_in_jobs integer;
  v_in_total integer;
  v_open_periods jsonb := '[]'::jsonb;
  v_unverified jsonb;
  v_redaction jsonb := '[]'::jsonb;
  v_slugs text[];
  v_keywords text[];
  v_account_at timestamptz;
  v_quiet integer := public.member_withdrawal_policy_days('selfWithdrawOrderQuietDays');
  v_buffer integer := public.member_withdrawal_policy_days('withdrawRefundDeadlineBufferDays');
  v_setting_days integer := public.point_charge_refund_days();
  v_src record;
  v_order public.payment_orders%ROWTYPE;
  v_root_created timestamptz;
  v_ack_days integer;
  v_days integer;
  v_deadline timestamptz;
  v_until timestamptz;
  v_breakdown jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_paid integer := 0;
  v_free integer := 0;
  v_expired integer := 0;
  v_cash integer := 0;
  v_cash_unknown boolean := false;
  v_is_paid boolean;
  v_value integer;
  v_last_activity timestamptz;
  v_quiet_until timestamptz;
  v_recent boolean;
  v_last_payment timestamptz;
  v_last_market timestamptz;
  v_last_ticket timestamptz;
  v_refund_tickets uuid[];
  v_ticket_count integer;
  v_pending_tickets integer;
  v_open_request uuid;
  v_has_request boolean;
  v_marketing_agreed boolean;
  v_self_enabled boolean;
  v_self_reasons text[] := ARRAY[]::text[];
  v_request_reasons text[] := ARRAY[]::text[];
  v_retain_tickets boolean;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('userId', p_user_id, 'exists', false);
  END IF;

  SELECT COALESCE(array_agg(o.id), '{}'), COALESCE(array_agg(o.id::text), '{}'), COALESCE(array_agg(o.order_id), '{}')
    INTO v_order_ids, v_order_id_texts, v_order_keys
    FROM public.payment_orders o
   WHERE o.user_id = p_user_id;
  SELECT COALESCE(array_agg(t.provider_transaction_id) FILTER (WHERE t.provider_transaction_id IS NOT NULL), '{}')
    INTO v_mul_nos
    FROM public.payment_provider_transactions t
   WHERE t.payment_order_id = ANY (v_order_ids);
  v_has_orders := cardinality(v_order_ids) > 0
    OR EXISTS (SELECT 1 FROM public.checkout_attempts a WHERE a.user_id = p_user_id);

  -- 결제 회원(had_payment)
  IF EXISTS (
    SELECT 1 FROM public.payment_orders o
     WHERE o.user_id = p_user_id
       AND (o.status IN ('completed', 'refunded', 'cancel_pending', 'fulfillment_pending', 'confirming', 'manual_review')
            OR o.approved_at IS NOT NULL
            OR o.canceled_at IS NOT NULL
            OR EXISTS (SELECT 1 FROM public.payment_history h WHERE h.payment_order_id = o.id)
            OR EXISTS (SELECT 1 FROM public.payment_provider_transactions t
                        WHERE t.payment_order_id = o.id
                          AND (t.paid_feedback_recorded_at IS NOT NULL OR t.admin_paid_confirmed_at IS NOT NULL
                               OR t.cancel_feedback_recorded_at IS NOT NULL OR t.partial_cancel_feedback_recorded_at IS NOT NULL)))
  ) THEN
    v_paid_reasons := v_paid_reasons || 'MONEY_ORDER'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_history h WHERE h.user_id = p_user_id AND h.amount > 0) THEN
    v_paid_reasons := v_paid_reasons || 'PAYMENT_HISTORY'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.credit_sources s WHERE s.user_id = p_user_id AND s.source_category = 'plan_purchase') THEN
    v_paid_reasons := v_paid_reasons || 'PLAN_PURCHASE_SOURCE'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_orders o
              WHERE o.user_id = p_user_id AND o.failure_code IN ('PAYAPP_FEEDBACK_MISMATCH', 'PAYAPP_MUL_NO_CONFLICT')) THEN
    v_paid_reasons := v_paid_reasons || 'FEEDBACK_VERIFICATION_FAILED'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_admin_actions paa WHERE paa.payment_order_id = ANY (v_order_ids)) THEN
    v_paid_reasons := v_paid_reasons || 'PAYMENT_ADMIN_ACTION'::text;
  END IF;
  v_had_payment := cardinality(v_paid_reasons) > 0;
  v_retain_tickets := v_had_payment OR p_ticket_retention_agreed IS NOT FALSE;

  -- 진행 중(종류별)
  SELECT count(*)::integer INTO v_in_orders
    FROM public.payment_orders o
   WHERE o.user_id = p_user_id AND o.status NOT IN ('completed', 'refunded', 'failed', 'expired');
  SELECT count(*)::integer INTO v_in_attempts
    FROM public.checkout_attempts a
   WHERE a.user_id = p_user_id
     AND a.status IN ('claimed', 'manual_review')
     AND ((a.payment_order_id IS NULL AND a.expires_at > v_now)
          OR EXISTS (SELECT 1 FROM public.payment_orders o
                      WHERE o.id = a.payment_order_id AND o.status NOT IN ('completed', 'refunded', 'failed', 'expired')));
  SELECT count(*)::integer INTO v_in_markers
    FROM public.payment_provider_transactions t
   WHERE t.payment_order_id = ANY (v_order_ids)
     AND ((t.cancel_feedback_recorded_at IS NOT NULL AND t.cancel_processed_at IS NULL)
          OR (t.partial_cancel_feedback_recorded_at IS NOT NULL AND t.partial_cancel_processed_at IS NULL));
  SELECT count(*)::integer INTO v_in_webhooks
    FROM public.payment_webhook_events w
   WHERE w.processing_status IN ('pending', 'failed')
     AND w.transmission_id LIKE 'payapp:%'
     AND split_part(w.transmission_id, ':', 2) = ANY (v_mul_nos);
  SELECT count(*)::integer INTO v_in_point_refunds
    FROM public.refund_requests rr
   WHERE rr.user_id = p_user_id AND rr.status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review');
  SELECT count(*)::integer INTO v_in_market_refunds
    FROM public.market_refund_requests mr
   WHERE mr.user_id = p_user_id AND mr.status = 'pending';
  SELECT count(*)::integer INTO v_in_sources
    FROM public.credit_sources s
   WHERE s.user_id = p_user_id
     AND (s.status = 'pending_refund'
          OR (s.source_category = 'system_refund'
              AND COALESCE((SELECT r.root_in_progress FROM public.credit_source_paid_root(s.id) r LIMIT 1), false)));
  SELECT count(*)::integer INTO v_in_alerts
    FROM public.payment_reconciliation_alerts a
   WHERE a.resolved_at IS NULL
     AND ((a.details ->> 'payment_order_id') = ANY (v_order_id_texts)
          OR (a.details ->> 'order_payment_order_id') = ANY (v_order_id_texts)
          OR (a.details ->> 'mul_no') = ANY (v_mul_nos)
          OR (a.details ->> 'orig_mul_no') = ANY (v_mul_nos)
          OR (a.details ->> 'order_id') = ANY (v_order_keys)
          OR (a.details ->> 'user_id') = p_user_id::text);
  SELECT count(*)::integer INTO v_in_jobs
    FROM public.generate_listboard_generation_jobs j
   WHERE j.user_id = p_user_id AND j.status IN ('queued', 'running');
  v_in_total := v_in_orders + v_in_attempts + v_in_markers + v_in_webhooks + v_in_point_refunds
    + v_in_market_refunds + v_in_sources + v_in_alerts + v_in_jobs;

  -- 크레딧(원천별, 만료 순)과 환불 기간이 남은 유료 충전 건
  FOR v_src IN
    SELECT s.id, s.source_category, s.status, s.remaining_credits, s.expires_at, s.created_at, s.payment_order_id,
           r.root_source_id, r.payment_order_id AS root_order_id
      FROM public.credit_sources s
      LEFT JOIN LATERAL (SELECT x.root_source_id, x.payment_order_id FROM public.credit_source_paid_root(s.id) x LIMIT 1) r ON true
     WHERE s.user_id = p_user_id AND s.remaining_credits > 0
     ORDER BY s.expires_at NULLS LAST, s.id
  LOOP
    v_is_paid := v_src.root_source_id IS NOT NULL OR v_src.source_category = 'plan_purchase';
    IF v_src.expires_at IS NOT NULL AND v_src.expires_at <= v_now THEN
      v_expired := v_expired + v_src.remaining_credits;
      v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
        'source_id', v_src.id, 'category', v_src.source_category, 'paid', v_is_paid, 'paid_root_id', v_src.root_source_id,
        'credits', v_src.remaining_credits, 'forfeited', 0, 'expired_cleared', v_src.remaining_credits,
        'expires_at', v_src.expires_at, 'cash_value', NULL));
    ELSE
      v_total := v_total + v_src.remaining_credits;
      v_value := NULL;
      IF v_is_paid THEN
        v_paid := v_paid + v_src.remaining_credits;
        v_value := public.point_charge_cash_value(v_src.id, v_src.remaining_credits);
        IF v_value IS NULL THEN
          v_cash_unknown := true;
        ELSE
          v_cash := v_cash + v_value;
        END IF;
      ELSE
        v_free := v_free + v_src.remaining_credits;
      END IF;
      v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
        'source_id', v_src.id, 'category', v_src.source_category, 'paid', v_is_paid, 'paid_root_id', v_src.root_source_id,
        'credits', v_src.remaining_credits, 'forfeited', v_src.remaining_credits, 'expired_cleared', 0,
        'expires_at', v_src.expires_at, 'cash_value', v_value));
    END IF;

    IF v_is_paid THEN
      -- eligibility 와 같은 식: 뿌리 주문·뿌리 원천 기준, 일수 COALESCE(GREATEST(설정, 결제 전 동의), 7)
      v_order := NULL;
      SELECT * INTO v_order FROM public.payment_orders o WHERE o.id = COALESCE(v_src.root_order_id, v_src.payment_order_id);
      SELECT c.created_at INTO v_root_created FROM public.credit_sources c WHERE c.id = COALESCE(v_src.root_source_id, v_src.id);
      v_ack_days := NULL;
      SELECT a.refund_days INTO v_ack_days
        FROM public.checkout_attempts ca
        JOIN public.point_charge_checkout_acks a
          ON a.user_id = ca.user_id AND a.checkout_attempt_id = ca.checkout_attempt_id
       WHERE ca.id = v_order.checkout_attempt_id;
      v_days := COALESCE(GREATEST(v_setting_days, v_ack_days), 7);
      v_deadline := public.point_charge_refund_deadline(GREATEST(v_order.approved_at, v_root_created), v_days);
      v_until := CASE WHEN v_deadline IS NULL OR v_buffer IS NULL THEN NULL ELSE v_deadline + make_interval(days => v_buffer) END;
      IF v_until IS NULL OR v_until > v_now THEN
        v_open_periods := v_open_periods || jsonb_build_array(jsonb_build_object(
          'sourceId', v_src.id, 'rootSourceId', COALESCE(v_src.root_source_id, v_src.id), 'paymentOrderId', v_order.id,
          'deadline', v_deadline, 'blockedUntil', v_until, 'refundDays', v_days,
          'inBuffer', v_deadline IS NOT NULL AND v_deadline <= v_now));
      END IF;
    END IF;
  END LOOP;

  -- 페이앱 요청 미확인 주문
  SELECT COALESCE(jsonb_agg(o.id ORDER BY o.created_at), '[]'::jsonb) INTO v_unverified
    FROM public.payment_orders o
    JOIN public.payment_provider_transactions t ON t.payment_order_id = o.id
   WHERE o.user_id = p_user_id
     AND o.status = 'expired'
     AND o.failure_code IN ('PAYAPP_REQUEST_OUTCOME_EXPIRED', 'PAYAPP_READY_CANCEL_FAILED')
     AND t.provider_transaction_id IS NOT NULL
     AND COALESCE(t.provider_status, '') NOT IN ('8', '16', '32');

  -- 문의
  v_slugs := ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_policy -> 'redactionRefundCategorySlugs') = 'array'
                                                         THEN v_policy -> 'redactionRefundCategorySlugs' ELSE '[]'::jsonb END));
  v_keywords := ARRAY(SELECT k FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_policy -> 'redactionAccountRequestKeywords') = 'array'
                                                                  THEN v_policy -> 'redactionAccountRequestKeywords' ELSE '[]'::jsonb END) AS k
                       WHERE btrim(k) <> '');
  SELECT min(t.responded_at) INTO v_account_at
    FROM public.support_tickets t
   WHERE t.user_id = p_user_id
     AND t.responded_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM unnest(v_keywords) AS k WHERE strpos(COALESCE(t.admin_response, ''), k) > 0);

  SELECT count(*)::integer,
         count(*) FILTER (WHERE t.status IN ('pending', 'in_progress'))::integer,
         max(GREATEST(t.responded_at, t.member_updated_at, t.created_at))
    INTO v_ticket_count, v_pending_tickets, v_last_ticket
    FROM public.support_tickets t
   WHERE t.user_id = p_user_id;

  SELECT COALESCE(array_agg(t.id ORDER BY t.created_at), '{}') INTO v_refund_tickets
    FROM public.support_tickets t
   WHERE t.user_id = p_user_id
     AND (COALESCE(t.category_snapshot ->> 'slug', (SELECT c.slug FROM public.support_ticket_categories c WHERE c.id = t.category_id)) = ANY (v_slugs)
          OR EXISTS (SELECT 1 FROM public.market_refund_requests mr WHERE mr.support_ticket_id = t.id));

  -- 가림 확인 필요(확인 뒤 회원이 고쳤거나 답변이 달렸으면 다시 필요)
  IF v_retain_tickets THEN
    WITH tk AS (
      SELECT t.*,
             (t.id = ANY (v_refund_tickets)) AS refund_related,
             (v_account_at IS NOT NULL AND (t.created_at > v_account_at OR t.member_updated_at > v_account_at)) AS after_account,
             (t.redaction_reviewed_at IS NOT NULL
              AND t.redaction_reviewed_at >= COALESCE(GREATEST(t.member_updated_at, t.responded_at), '-infinity'::timestamptz)) AS reviewed
        FROM public.support_tickets t
       WHERE t.user_id = p_user_id
    ), items AS (
      SELECT 'support_ticket'::text AS kind, tk.id, tk.created_at,
             left(regexp_replace(tk.subject, '\s+', ' ', 'g'), 30) AS preview,
             array_remove(ARRAY[
               CASE WHEN tk.refund_related THEN 'REFUND_RELATED' END,
               CASE WHEN tk.after_account THEN 'AFTER_ACCOUNT_REQUEST' END,
               CASE WHEN public.member_text_has_long_number(tk.subject) OR public.member_text_has_long_number(tk.message)
                         OR public.member_text_has_long_number(tk.admin_response) THEN 'LONG_NUMBER' END], NULL) AS reasons
        FROM tk
       WHERE NOT tk.reviewed
      UNION ALL
      SELECT 'support_ticket_revision', rv.id, rv.created_at,
             left(regexp_replace(COALESCE(rv.subject, ''), '\s+', ' ', 'g'), 30),
             array_remove(ARRAY[
               CASE WHEN tk.refund_related THEN 'REFUND_RELATED' END,
               CASE WHEN tk.after_account THEN 'AFTER_ACCOUNT_REQUEST' END,
               CASE WHEN public.member_text_has_long_number(rv.subject) OR public.member_text_has_long_number(rv.message) THEN 'LONG_NUMBER' END], NULL)
        FROM public.support_ticket_revisions rv
        JOIN tk ON tk.id = rv.ticket_id
       WHERE rv.redaction_reviewed_at IS NULL
      UNION ALL
      SELECT 'refund_request', rr.id, rr.created_at, NULL::text,
             ARRAY['LONG_NUMBER']::text[]
        FROM public.refund_requests rr
       WHERE v_had_payment
         AND rr.user_id = p_user_id
         AND (rr.redaction_reviewed_at IS NULL OR rr.redaction_reviewed_at < rr.updated_at)
         AND (public.member_text_has_long_number(rr.reason) OR public.member_text_has_long_number(rr.admin_note))
      UNION ALL
      SELECT 'market_refund_request', mr.id, mr.created_at, NULL::text,
             ARRAY['LONG_NUMBER']::text[]
        FROM public.market_refund_requests mr
       WHERE v_had_payment
         AND mr.user_id = p_user_id
         AND (mr.redaction_reviewed_at IS NULL OR mr.redaction_reviewed_at < mr.updated_at)
         AND (public.member_text_has_long_number(mr.reason) OR public.member_text_has_long_number(mr.admin_note))
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', i.kind, 'id', i.id, 'preview', i.preview, 'reasons', to_jsonb(i.reasons))
                              ORDER BY i.created_at, i.id), '[]'::jsonb)
      INTO v_redaction
      FROM items i
     WHERE cardinality(i.reasons) > 0;
  END IF;

  -- 사건 시각
  SELECT GREATEST(max(o.created_at), max(o.approved_at), max(o.canceled_at),
                  (SELECT max(a.created_at) FROM public.checkout_attempts a WHERE a.user_id = p_user_id),
                  max(t.paid_feedback_recorded_at), max(t.cancel_feedback_recorded_at),
                  max(t.partial_cancel_feedback_recorded_at), max(t.admin_paid_confirmed_at))
    INTO v_last_activity
    FROM public.payment_orders o
    LEFT JOIN public.payment_provider_transactions t ON t.payment_order_id = o.id
   WHERE o.user_id = p_user_id;
  IF v_last_activity IS NULL THEN
    SELECT max(a.created_at) INTO v_last_activity FROM public.checkout_attempts a WHERE a.user_id = p_user_id;
  END IF;
  v_quiet_until := CASE WHEN v_last_activity IS NULL THEN NULL
                        WHEN v_quiet IS NULL THEN 'infinity'::timestamptz
                        ELSE v_last_activity + make_interval(days => v_quiet) END;
  v_recent := v_quiet_until IS NOT NULL AND v_quiet_until > v_now;

  SELECT GREATEST(max(o.approved_at), max(o.canceled_at),
                  max(t.paid_feedback_recorded_at), max(t.cancel_feedback_recorded_at),
                  max(t.partial_cancel_feedback_recorded_at), max(t.admin_paid_confirmed_at),
                  (SELECT max(rr.processed_at) FROM public.refund_requests rr WHERE rr.user_id = p_user_id),
                  (SELECT max(a.created_at) FROM public.checkout_attempts a WHERE a.user_id = p_user_id))
    INTO v_last_payment
    FROM public.payment_orders o
    LEFT JOIN public.payment_provider_transactions t ON t.payment_order_id = o.id
   WHERE o.user_id = p_user_id;
  IF v_last_payment IS NULL THEN
    SELECT GREATEST((SELECT max(rr.processed_at) FROM public.refund_requests rr WHERE rr.user_id = p_user_id),
                    (SELECT max(a.created_at) FROM public.checkout_attempts a WHERE a.user_id = p_user_id))
      INTO v_last_payment;
  END IF;
  SELECT GREATEST((SELECT max(mo.created_at) FROM public.market_purchase_orders mo WHERE mo.user_id = p_user_id),
                  (SELECT max(mr.processed_at) FROM public.market_refund_requests mr WHERE mr.user_id = p_user_id))
    INTO v_last_market;

  -- 요청·마케팅·스위치
  SELECT r.id INTO v_open_request FROM public.member_withdrawal_requests r WHERE r.user_id = p_user_id AND r.status = 'pending';
  v_has_request := EXISTS (SELECT 1 FROM public.member_withdrawal_requests r WHERE r.user_id = p_user_id);
  SELECT c.agreed INTO v_marketing_agreed
    FROM public.user_consents c
    JOIN public.signup_consent_items i ON i.id = c.item_id
   WHERE c.user_id = p_user_id
     AND i.key = (v_policy ->> 'marketingConsentItemKey')
   ORDER BY c.seq DESC
   LIMIT 1;
  v_self_enabled := COALESCE((v_policy -> 'selfAnonymizeEnabled') = 'true'::jsonb, false);

  -- 스스로 익명화·결제 회원 탈퇴 요청 가능 여부와 이유
  IF v_profile.is_admin IS TRUE THEN
    v_self_reasons := v_self_reasons || 'ADMIN'::text;
    v_request_reasons := v_request_reasons || 'ADMIN'::text;
  END IF;
  IF v_profile.withdrawn_at IS NOT NULL THEN
    v_self_reasons := v_self_reasons || 'WITHDRAWN'::text;
    v_request_reasons := v_request_reasons || 'WITHDRAWN'::text;
  END IF;
  IF NOT v_self_enabled THEN
    v_self_reasons := v_self_reasons || 'DISABLED'::text;
    v_request_reasons := v_request_reasons || 'DISABLED'::text;
  END IF;
  IF v_had_payment THEN
    v_self_reasons := v_self_reasons || 'PAYER'::text;
  ELSE
    v_request_reasons := v_request_reasons || 'NOT_PAYER'::text;
  END IF;
  IF v_in_total > 0 THEN
    v_self_reasons := v_self_reasons || 'IN_PROGRESS'::text;
    v_request_reasons := v_request_reasons || 'IN_PROGRESS'::text;
  END IF;
  IF jsonb_array_length(v_open_periods) > 0 THEN
    v_self_reasons := v_self_reasons || 'REFUND_PERIOD_OPEN'::text;
    v_request_reasons := v_request_reasons || 'REFUND_PERIOD_OPEN'::text;
  END IF;
  IF jsonb_array_length(v_unverified) > 0 THEN
    v_self_reasons := v_self_reasons || 'PROVIDER_UNVERIFIED'::text;
  END IF;
  IF jsonb_array_length(v_redaction) > 0 THEN
    v_self_reasons := v_self_reasons || 'REDACTION_REQUIRED'::text;
  END IF;
  IF v_recent THEN
    v_self_reasons := v_self_reasons || 'RECENT_PAYMENT_ACTIVITY'::text;
  END IF;
  IF v_open_request IS NOT NULL THEN
    v_request_reasons := v_request_reasons || 'REQUEST_PENDING'::text;
  END IF;
  -- 원 환산을 계산할 수 없는 유료 원천(주문 없는 옛 plan_purchase 등): 화면에서는 받지 않고 대표가 결제 내역으로 금액을 확인해 처리한다.
  IF v_cash_unknown THEN
    v_self_reasons := v_self_reasons || 'CASH_VALUE_UNKNOWN'::text;
    v_request_reasons := v_request_reasons || 'CASH_VALUE_UNKNOWN'::text;
  END IF;

  RETURN jsonb_build_object(
    'userId', p_user_id,
    'exists', true,
    'isAdmin', v_profile.is_admin IS TRUE,
    'withdrawnAt', v_profile.withdrawn_at,
    'provider', v_profile.provider,
    'hadPayment', v_had_payment,
    'hadPaymentReasons', to_jsonb(v_paid_reasons),
    'hasOrdersOrAttempts', v_has_orders,
    'hasRequestHistory', v_has_request,
    'openRequestId', v_open_request,
    'ticketCount', v_ticket_count,
    'pendingTicketCount', v_pending_tickets,
    'ticketRetentionAgreed', p_ticket_retention_agreed,
    'inProgress', jsonb_build_object(
      'orders', v_in_orders, 'attempts', v_in_attempts, 'cancelMarkers', v_in_markers, 'webhookEvents', v_in_webhooks,
      'pointRefunds', v_in_point_refunds, 'marketRefunds', v_in_market_refunds, 'pendingSources', v_in_sources,
      'alerts', v_in_alerts, 'generationJobs', v_in_jobs),
    'inProgressTotal', v_in_total,
    'refundPeriodOpen', v_open_periods,
    'providerUnverified', v_unverified,
    'redactionRequired', v_redaction,
    'refundTicketIds', to_jsonb(v_refund_tickets),
    'lastPaymentActivityAt', v_last_activity,
    'quietUntil', v_quiet_until,
    'lastPaymentEventAt', v_last_payment,
    'lastMarketEventAt', v_last_market,
    'lastTicketEventAt', v_last_ticket,
    'balance', jsonb_build_object(
      'spendable', (public.get_credit_balance_snapshot(p_user_id) ->> 'spendable_balance')::integer,
      'forfeitTotal', v_total, 'forfeitPaid', v_paid, 'forfeitFree', v_free, 'expired', v_expired,
      'paidCashValue', v_cash, 'paidCashValueUnknown', v_cash_unknown, 'breakdown', v_breakdown),
    'marketingAgreed', COALESCE(v_marketing_agreed, false),
    'selfAnonymizeEnabled', v_self_enabled,
    'fullDeleteAllowed', v_profile.is_admin IS NOT TRUE AND v_profile.withdrawn_at IS NULL AND NOT v_had_payment
                         AND NOT v_has_orders AND NOT v_has_request
                         AND (v_ticket_count = 0 OR p_ticket_retention_agreed IS FALSE),
    'selfAllowed', cardinality(v_self_reasons) = 0,
    'selfReasons', to_jsonb(v_self_reasons),
    'requestAllowed', cardinality(v_request_reasons) = 0,
    'requestReasons', to_jsonb(v_request_reasons)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.redact_member_text(p_actor_id uuid, p_target_kind text, p_target_id uuid, p_field text, p_target_text text, p_operation_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mask text := NULLIF(btrim(public.member_withdrawal_policy() -> 'texts' ->> 'redactionMask'), '');
  v_table text;
  v_user uuid;
  v_value text;
  v_ref_table text;
  v_ref_id uuid;
  v_occurrences integer;
  v_events integer;
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  IF p_target_id IS NULL OR p_target_text IS NULL OR btrim(p_target_text) = '' OR length(p_target_text) > 2000
     OR NULLIF(btrim(p_operation_key), '') IS NULL OR length(p_operation_key) > 200
     OR NOT ((p_target_kind = 'support_ticket' AND p_field IN ('subject', 'message', 'admin_response'))
             OR (p_target_kind = 'support_ticket_revision' AND p_field IN ('subject', 'message'))
             OR (p_target_kind IN ('refund_request', 'market_refund_request') AND p_field IN ('reason', 'admin_note'))) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  IF v_mask IS NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_POLICY_UNAVAILABLE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_audit_log a WHERE a.action = 'member_text_redact' AND a.request_id = p_operation_key) THEN
    RETURN jsonb_build_object('redacted', true, 'replay', true);
  END IF;

  v_table := CASE p_target_kind WHEN 'support_ticket' THEN 'support_tickets' WHEN 'support_ticket_revision' THEN 'support_ticket_revisions'
                                WHEN 'refund_request' THEN 'refund_requests' ELSE 'market_refund_requests' END;
  IF p_target_kind = 'support_ticket_revision' THEN
    SELECT t.user_id, t.id INTO v_user, v_ref_id
      FROM public.support_ticket_revisions rv JOIN public.support_tickets t ON t.id = rv.ticket_id
     WHERE rv.id = p_target_id;
    v_ref_table := 'support_tickets';
    EXECUTE format('SELECT %I FROM public.support_ticket_revisions WHERE id = $1 FOR UPDATE', p_field) INTO v_value USING p_target_id;
  ELSE
    EXECUTE format('SELECT user_id, %I FROM public.%I WHERE id = $1 FOR UPDATE', p_field, v_table) INTO v_user, v_value USING p_target_id;
    v_ref_table := v_table;
    v_ref_id := p_target_id;
  END IF;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'MEMBER_REDACTION_TARGET_NOT_FOUND';
  END IF;
  IF v_value IS NULL OR strpos(v_value, p_target_text) = 0 THEN
    RAISE EXCEPTION 'MEMBER_REDACTION_TEXT_NOT_FOUND';
  END IF;
  v_occurrences := (length(v_value) - length(replace(v_value, p_target_text, ''))) / length(p_target_text);

  PERFORM set_config('app.member_withdrawal_bypass', v_user::text, true);
  EXECUTE format('UPDATE public.%I SET %I = replace(%I, $1, $2), redaction_reviewed_at = clock_timestamp() WHERE id = $3',
                 v_table, p_field, p_field)
    USING p_target_text, v_mask, p_target_id;

  UPDATE public.admin_events e
     SET title = replace(e.title, p_target_text, v_mask),
         body = replace(e.body, p_target_text, v_mask)
   WHERE ((e.ref_table = v_ref_table AND e.ref_id = v_ref_id)
          OR (e.ref_table = 'admin_events'
              AND e.ref_id IN (SELECT x.id FROM public.admin_events x WHERE x.ref_table = v_ref_table AND x.ref_id = v_ref_id)))
     AND (strpos(e.title, p_target_text) > 0 OR strpos(COALESCE(e.body, ''), p_target_text) > 0);
  GET DIAGNOSTICS v_events = ROW_COUNT;

  PERFORM public.record_admin_audit(p_actor_id, 'member_text_redact', p_target_kind, p_target_id::text, v_user, NULL, NULL,
    jsonb_build_object('field', p_field, 'length', length(p_target_text), 'occurrences', v_occurrences, 'admin_events', v_events),
    p_operation_key);

  RETURN jsonb_build_object('redacted', true, 'occurrences', v_occurrences, 'adminEventsUpdated', v_events);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_member_text_reviewed(p_actor_id uuid, p_target_kind text, p_target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_table text;
  v_user uuid;
  v_at timestamptz := clock_timestamp();
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  IF p_target_id IS NULL OR p_target_kind IS NULL
     OR p_target_kind NOT IN ('support_ticket', 'support_ticket_revision', 'refund_request', 'market_refund_request') THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  v_table := CASE p_target_kind WHEN 'support_ticket' THEN 'support_tickets' WHEN 'support_ticket_revision' THEN 'support_ticket_revisions'
                                WHEN 'refund_request' THEN 'refund_requests' ELSE 'market_refund_requests' END;
  IF p_target_kind = 'support_ticket_revision' THEN
    SELECT t.user_id INTO v_user FROM public.support_ticket_revisions rv JOIN public.support_tickets t ON t.id = rv.ticket_id WHERE rv.id = p_target_id;
  ELSE
    EXECUTE format('SELECT user_id FROM public.%I WHERE id = $1 FOR UPDATE', v_table) INTO v_user USING p_target_id;
  END IF;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'MEMBER_REDACTION_TARGET_NOT_FOUND';
  END IF;
  PERFORM set_config('app.member_withdrawal_bypass', v_user::text, true);
  EXECUTE format('UPDATE public.%I SET redaction_reviewed_at = $1 WHERE id = $2', v_table) USING v_at, p_target_id;
  PERFORM public.record_admin_audit(p_actor_id, 'member_text_reviewed', p_target_kind, p_target_id::text, v_user, NULL, NULL, '{}'::jsonb, NULL);
  RETURN jsonb_build_object('reviewed', true, 'reviewedAt', v_at);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.read_withdrawn_member_ticket(p_actor_id uuid, p_ticket_id uuid, p_reason text, p_request_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  IF NULLIF(btrim(p_reason), '') IS NULL OR length(p_reason) > 500
     OR (p_request_meta IS NOT NULL AND jsonb_typeof(p_request_meta) <> 'object') THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_ticket.user_id AND p.withdrawn_at IS NOT NULL) THEN
    RAISE EXCEPTION 'MEMBER_NOT_WITHDRAWN';
  END IF;
  PERFORM public.record_admin_audit(p_actor_id, 'withdrawn_record_view', 'support_ticket', p_ticket_id::text, v_ticket.user_id,
    NULL, p_reason, jsonb_build_object('kind', 'ticket', 'request', COALESCE(p_request_meta, '{}'::jsonb)), NULL);
  RETURN to_jsonb(v_ticket) || jsonb_build_object('revisions', (
    SELECT COALESCE(jsonb_agg(to_jsonb(rv) ORDER BY rv.written_at), '[]'::jsonb)
      FROM public.support_ticket_revisions rv WHERE rv.ticket_id = p_ticket_id));
END;
$function$
;

-- 2. 13번 객체 지우기
DROP FUNCTION public.save_support_ticket_answer(uuid, uuid, text, text, text, text, text, jsonb);
DROP TRIGGER guard_support_category_slug ON public.support_ticket_categories;
DROP FUNCTION public.guard_support_category_slug();
DROP TABLE public.support_ticket_answer_revisions;
DROP FUNCTION public.guard_support_ticket_answer_revisions_mutation();
DROP TABLE public.support_reply_templates;
DELETE FROM public.system_settings WHERE key = 'support_page_content';
ALTER TABLE public.support_tickets DROP COLUMN response_edited_at;

DO $down_verify_bundle13_cs_tools$
BEGIN
  IF md5(pg_get_functiondef('public.member_withdrawal_facts(uuid,boolean)'::regprocedure)) <> 'a7674770964dac2fe5c9179b8403c3b4'
     OR md5(pg_get_functiondef('public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure)) <> '90778a74269a727608f028b21b43b8f6'
     OR md5(pg_get_functiondef('public.mark_member_text_reviewed(uuid,text,uuid)'::regprocedure)) <> 'b626dc43a8bb8402575f99a58bb5969b'
     OR md5(pg_get_functiondef('public.read_withdrawn_member_ticket(uuid,uuid,text,jsonb)'::regprocedure)) <> 'cce39fd0ab514d2c9cdd9e42d225688e' THEN
    RAISE EXCEPTION 'DOWN VERIFY: bundle 10 fingerprints';
  END IF;
  IF to_regclass('public.support_ticket_answer_revisions') IS NOT NULL OR to_regclass('public.support_reply_templates') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                 AND p.proname IN ('save_support_ticket_answer', 'guard_support_category_slug', 'guard_support_ticket_answer_revisions_mutation'))
     OR EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'support_page_content')
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'support_tickets' AND column_name = 'response_edited_at')
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.support_ticket_categories'::regclass AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'DOWN VERIFY: bundle 13 M1 objects remain';
  END IF;
END;
$down_verify_bundle13_cs_tools$;

NOTIFY pgrst, 'reload schema';
