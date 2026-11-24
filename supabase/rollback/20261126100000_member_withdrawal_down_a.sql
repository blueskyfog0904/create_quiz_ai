-- 되돌리기 (가) 표·칸·설정: 20261126100000_member_withdrawal.sql 이 만든 정책·표·CHECK·칸·설정과 새 함수(내부·service_role·트리거 함수)를 지운다.
-- 반드시 _down_b.sql 다음에 실행한다(재정의 함수가 원래 지문이 아니면 멈춘다). 10번 코드가 돌고 있으면 실행하지 않는다.
-- 사전 조건: 탈퇴 기록이 하나도 없어야 한다(보관함·요청·추가 기록, 탈퇴 소멸 거래, 탈퇴 동의 기록, 보류 주문 닫기 기록, 가림 확인 표시,
--   탈퇴 회원, 풀리지 않은 MEMBER_*·PAYMENT_FOR_WITHDRAWN_MEMBER 경보, 탈퇴 보류 주문 송금 뒤 이중 환불 경보). 하나라도 있으면 멈춘다.
-- 다시 적용하려면 같은 트랜잭션에서 schema_migrations 의 '20261126100000' 행을 지운 뒤 마이그레이션과 이력 INSERT 를 넣는다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $down_a_precheck$
DECLARE
  v_orig text[][] := ARRAY[
    ARRAY['public.payapp_fulfill_order_internal(uuid,timestamp with time zone)', '78cd0333f01a23a4d63228369175f517'],
    ARRAY['public.apply_payapp_feedback(text,text,text,text,integer,integer,integer,integer,timestamp with time zone,timestamp with time zone)', '179f00a9693bb7b8d11dc26ce1c12c6c'],
    ARRAY['public.retry_payapp_fulfillment(uuid)', '1125573d41ab522c63a64836aa839f05'],
    ARRAY['public.resolve_payment_order_review(uuid,text,uuid,text,text,timestamp with time zone,text)', 'c9be280b25e58591f026dd196f2bc1ef'],
    ARRAY['public.prepare_payment_order(uuid,uuid,text,uuid,text,text,integer,integer,text,text,text,text,text,timestamp with time zone,integer,integer,text,text)', '462fed08230394ce2b047818477ddc74'],
    ARRAY['public.begin_payapp_request(uuid)', '6deb115ebe9995bf2a0477f795e73a3e'],
    ARRAY['public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)', '0047854ac79ddae6fba6dde114fb575d'],
    ARRAY['public.process_payapp_cancellation(uuid)', 'f45eed1de563b453dc2330e520744f06'],
    ARRAY['public.payapp_sales_resume_blockers()', '22f52c8934fe53005acf64ea21ca770a'],
    ARRAY['public.enforce_payment_reconciliation_health()', '2c7b70c6757abc8e9f078bf5626a8a8b'],
    ARRAY['public.prevent_payment_order_snapshot_update()', 'd7df22fd210082e75ae46fc5c36cd4ba'],
    ARRAY['public.consent_record_internal(uuid,jsonb,text)', '254dc713e8f9710cfd0bacf8623558a0'],
    ARRAY['public.guard_user_consents_mutation()', 'e6518c872c2be65b8c9f9e65350253e0'],
    ARRAY['public.guard_market_purchase_notice_acks_mutation()', 'aa8e0414ddbfcbd47878ccbaad2e6d23'],
    ARRAY['public.prevent_admin_event_mutation()', 'c5ec0c9e2e5f1ccc057461c207c5f074'],
    ARRAY['public.remind_unanswered_admin_work()', 'c5f96dc4237cb19a83d277a65216904b'],
    ARRAY['public.guard_support_ticket_revisions_mutation()', '1104177c1ea4a098ce06e01dfc8608e6'],
    ARRAY['public.cancel_incomplete_kakao_signup(uuid)', '7efb18ab95e4ab052a0d1f157f579ef3'],
    ARRAY['public.complete_kakao_signup_with_consents(uuid,jsonb,text,text,text,text)', 'e40ece6e830d9ccf5e5ebb691f825fd0'],
    ARRAY['public.consent_eligible_member_count()', '56fcd7334482cb97b778c97ff8947e12']
  ];
  i integer;
BEGIN
  FOR i IN 1 .. array_length(v_orig, 1) LOOP
    IF md5(pg_get_functiondef(v_orig[i][1]::regprocedure)) <> v_orig[i][2] THEN
      RAISE EXCEPTION 'DOWN_A_BLOCKED: % is not the original definition (run down_b first)', v_orig[i][1];
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.withdrawn_member_record_events) THEN
    RAISE EXCEPTION 'DOWN_A_BLOCKED: withdrawn member record events exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.withdrawn_member_records) THEN
    RAISE EXCEPTION 'DOWN_A_BLOCKED: withdrawn member records exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_withdrawal_requests) THEN
    RAISE EXCEPTION 'DOWN_A_BLOCKED: withdrawal requests exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.credit_transactions WHERE type = 'withdrawal_forfeit') THEN
    RAISE EXCEPTION 'DOWN_A_BLOCKED: withdrawal_forfeit transactions exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_consents WHERE source = 'withdrawal') THEN
    RAISE EXCEPTION 'DOWN_A_BLOCKED: withdrawal consent records exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_admin_actions WHERE action = 'withdrawn_held_order_closed') THEN
    RAISE EXCEPTION 'DOWN_A_BLOCKED: withdrawn_held_order_closed actions exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE withdrawn_at IS NOT NULL) THEN
    RAISE EXCEPTION 'DOWN_A_BLOCKED: withdrawn members exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.support_tickets WHERE redaction_reviewed_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.support_ticket_revisions WHERE redaction_reviewed_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.refund_requests WHERE redaction_reviewed_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.market_refund_requests WHERE redaction_reviewed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'DOWN_A_BLOCKED: redaction_reviewed_at values exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts
              WHERE resolved_at IS NULL AND (code LIKE 'MEMBER\_%' OR code = 'PAYMENT_FOR_WITHDRAWN_MEMBER')) THEN
    RAISE EXCEPTION 'DOWN_A_BLOCKED: unresolved member withdrawal alerts exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts
              WHERE code = 'PAYAPP_DOUBLE_REFUND_SUSPECTED' AND details ->> 'source' = 'withdrawn_held_order_bank_transfer') THEN
    RAISE EXCEPTION 'DOWN_A_BLOCKED: withdrawn held order double refund alerts exist';
  END IF;
END;
$down_a_precheck$;

-- 1. RESTRICTIVE 정책(withdrawn_at 을 참조)
DROP POLICY IF EXISTS support_tickets_withdrawn_hidden ON public.support_tickets;
DROP POLICY IF EXISTS market_refund_requests_withdrawn_hidden ON public.market_refund_requests;
DROP POLICY IF EXISTS support_ticket_revisions_withdrawn_hidden ON public.support_ticket_revisions;
DROP POLICY IF EXISTS refund_requests_withdrawn_hidden ON public.refund_requests;

-- 2. 새 표(추가 기록 → 보관함 → 요청, 가드 트리거는 표와 함께 지워진다)
DROP TABLE IF EXISTS public.withdrawn_member_record_events;
DROP TABLE IF EXISTS public.withdrawn_member_records;
DROP TABLE IF EXISTS public.member_withdrawal_requests;

-- 3. CHECK 원래 값
ALTER TABLE public.credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_type_check;
ALTER TABLE public.credit_transactions ADD CONSTRAINT credit_transactions_type_check
  CHECK ((type = ANY (ARRAY['purchase'::text, 'consume'::text, 'refund'::text, 'admin_grant'::text, 'bonus'::text])));
ALTER TABLE public.user_consents DROP CONSTRAINT IF EXISTS user_consents_source_check;
ALTER TABLE public.user_consents ADD CONSTRAINT user_consents_source_check
  CHECK ((source = ANY (ARRAY['email_signup'::text, 'kakao_signup'::text, 'consent_gate'::text, 'mypage'::text])));
ALTER TABLE public.payment_admin_actions DROP CONSTRAINT IF EXISTS payment_admin_actions_action_check;
ALTER TABLE public.payment_admin_actions ADD CONSTRAINT payment_admin_actions_action_check
  CHECK ((action = ANY (ARRAY['paid_confirmed'::text, 'unpaid_confirmed'::text, 'cancel_handled'::text, 'manual_refund_completed'::text, 'manual_review_refund_rejected'::text, 'alert_resolved'::text])));

-- 4. 칸
ALTER TABLE public.profiles DROP COLUMN IF EXISTS withdrawn_at;
ALTER TABLE public.support_tickets DROP COLUMN IF EXISTS redaction_reviewed_at;
ALTER TABLE public.support_ticket_revisions DROP COLUMN IF EXISTS redaction_reviewed_at;
ALTER TABLE public.refund_requests DROP COLUMN IF EXISTS redaction_reviewed_at;
ALTER TABLE public.market_refund_requests DROP COLUMN IF EXISTS redaction_reviewed_at;

-- 5. 설정 행·정책
DROP POLICY IF EXISTS system_settings_member_withdrawal_policy_no_client_write ON public.system_settings;
DELETE FROM public.system_settings WHERE key = 'member_withdrawal_policy';

-- 6. 새 함수(service_role·내부·트리거 함수)
DROP FUNCTION IF EXISTS public.get_member_withdrawal_preview(uuid, boolean);
DROP FUNCTION IF EXISTS public.get_member_withdrawal_notice(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.create_member_withdrawal_request(uuid, text, text, text, integer, integer, integer, text, uuid, boolean, text, timestamptz, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.record_member_withdrawal_request_reply(uuid, uuid, timestamptz, timestamptz, boolean);
DROP FUNCTION IF EXISTS public.cancel_member_withdrawal_request(uuid, uuid);
DROP FUNCTION IF EXISTS public.anonymize_member(uuid, uuid, text, uuid, integer, text, boolean, text, text, boolean, boolean);
DROP FUNCTION IF EXISTS public.redact_member_text(uuid, text, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.mark_member_text_reviewed(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.close_withdrawn_member_held_order(uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.add_withdrawn_member_event(uuid, uuid, text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.mark_withdrawn_member_auth_scrubbed(uuid);
DROP FUNCTION IF EXISTS public.withdrawn_member_kakao_unlink_target(uuid);
DROP FUNCTION IF EXISTS public.clear_withdrawn_member_kakao_unlink(uuid, text);
DROP FUNCTION IF EXISTS public.read_withdrawn_member_record(uuid, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.read_withdrawn_member_ticket(uuid, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.scrub_member_admin_events(uuid);
DROP FUNCTION IF EXISTS public.withdrawn_member_account_status(uuid);
DROP FUNCTION IF EXISTS public.resolve_member_full_delete_auth_alert(uuid);
DROP FUNCTION IF EXISTS public.withdrawn_member_held_order_ids(uuid[]);
DROP FUNCTION IF EXISTS public.member_withdrawal_policy();
DROP FUNCTION IF EXISTS public.member_withdrawal_policy_days(text);
DROP FUNCTION IF EXISTS public.member_text_has_long_number(text);
DROP FUNCTION IF EXISTS public.point_charge_cash_value(uuid, integer);
DROP FUNCTION IF EXISTS public.member_withdrawal_facts(uuid, boolean);
DROP FUNCTION IF EXISTS public.member_withdrawal_notice_text(text, jsonb, boolean);
DROP FUNCTION IF EXISTS public.member_admin_event_owner(text, uuid);
DROP FUNCTION IF EXISTS public.member_withdrawal_scrub_admin_events(uuid);
DROP FUNCTION IF EXISTS public.member_withdrawal_require_owner(uuid);
DROP FUNCTION IF EXISTS public.guard_member_withdrawal_requests_mutation();
DROP FUNCTION IF EXISTS public.guard_withdrawn_member_records_mutation();
DROP FUNCTION IF EXISTS public.guard_withdrawn_member_record_events_mutation();
DROP FUNCTION IF EXISTS public.guard_withdrawn_member_write();
DROP FUNCTION IF EXISTS public.guard_withdrawn_member_view_event();
DROP FUNCTION IF EXISTS public.guard_withdrawn_member_credit_source();
DROP FUNCTION IF EXISTS public.guard_withdrawn_member_notification();
DROP FUNCTION IF EXISTS public.record_withdrawn_member_manual_refund();

DO $down_a_verify$
DECLARE
  v_text text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_text
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('get_member_withdrawal_preview', 'get_member_withdrawal_notice', 'create_member_withdrawal_request', 'record_member_withdrawal_request_reply', 'cancel_member_withdrawal_request', 'anonymize_member', 'redact_member_text', 'mark_member_text_reviewed', 'close_withdrawn_member_held_order', 'add_withdrawn_member_event', 'mark_withdrawn_member_auth_scrubbed', 'withdrawn_member_kakao_unlink_target', 'clear_withdrawn_member_kakao_unlink', 'read_withdrawn_member_record', 'read_withdrawn_member_ticket', 'scrub_member_admin_events', 'withdrawn_member_account_status', 'resolve_member_full_delete_auth_alert', 'withdrawn_member_held_order_ids', 'member_withdrawal_policy', 'member_withdrawal_policy_days', 'member_text_has_long_number', 'point_charge_cash_value', 'member_withdrawal_facts', 'member_withdrawal_notice_text', 'member_admin_event_owner', 'member_withdrawal_scrub_admin_events', 'member_withdrawal_require_owner', 'guard_member_withdrawal_requests_mutation', 'guard_withdrawn_member_records_mutation', 'guard_withdrawn_member_record_events_mutation', 'guard_withdrawn_member_write', 'guard_withdrawn_member_view_event', 'guard_withdrawn_member_credit_source', 'guard_withdrawn_member_notification', 'record_withdrawn_member_manual_refund');
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'DOWN_A_VERIFY: functions left: %', v_text;
  END IF;
  IF to_regclass('public.member_withdrawal_requests') IS NOT NULL OR to_regclass('public.withdrawn_member_records') IS NOT NULL
     OR to_regclass('public.withdrawn_member_record_events') IS NOT NULL THEN
    RAISE EXCEPTION 'DOWN_A_VERIFY: tables left';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
              AND ((table_name = 'profiles' AND column_name = 'withdrawn_at') OR column_name = 'redaction_reviewed_at')) THEN
    RAISE EXCEPTION 'DOWN_A_VERIFY: columns left';
  END IF;
  IF EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'member_withdrawal_policy')
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE '%withdraw%') THEN
    RAISE EXCEPTION 'DOWN_A_VERIFY: setting or policies left';
  END IF;
END;
$down_a_verify$;

NOTIFY pgrst, 'reload schema';
