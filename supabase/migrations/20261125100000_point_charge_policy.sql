-- 출시 전 작업 순서표 9번 묶음: 결제·환불 안내 DB화 + 다시 지급한 크레딧 처리(계획 docs/plan-bundle9-payment-refund-notice.md 8판, 확정).
-- 만드는 것:
--   1. system_settings 'point_charge_policy'(충전 환불 기간 refundDays 7, 결제 전 확인·동의·미성년자 안내·크레딧 화면 문구 — 자리표시는 {충전환불기간} 하나).
--      RESTRICTIVE FOR UPDATE 정책으로 화면 세션 직접 수정을 막는다(관리자 저장은 서버 키 + pricing.manage).
--   2. refund_requests.held_reissued_source_ids(취소로 함께 보류한 재지급 크레딧 — 표시·감사용, 회수 판단은 수동 완료 때 다시 계산).
--   3. point_charge_checkout_acks(결제 직전 동의 기록, 추가만 — 7번 market_purchase_notice_acks 와 같은 규칙).
--   4. 내부 함수: point_charge_refund_days, point_charge_refund_deadline, credit_source_paid_root, credit_source_reissued_descendants,
--      point_charge_hold_reissued, point_charge_reissued_alert (모두 ACL postgres 만).
--   5. service_role 함수: record_point_charge_checkout_ack(결제 동의 기록), get_manual_refund_recovery_preview(수동 완료 화면 원자료).
--   6. 재정의(원래 정의에 [9번] 표시 구역만 더함, 원래 줄은 '-- [9번 원래]' 주석으로 보존):
--      get_point_charge_refund_eligibility(마감 셈법·설정값·재지급 원천 사유), quarantine_external_provider_cancellation·
--      quarantine_payapp_partial_cancellation·process_payapp_cancellation 실패 대체 경로(재지급 크레딧 함께 보류·경보),
--      complete_manual_point_charge_refund(재지급 크레딧 함께 회수·원천별 원자료 기록), market_refund_allocate(⓪ 판정에 뿌리 상태).
-- 함수 지문은 md5(pg_get_functiondef(oid)) — 8번과 같은 측정. 사전 값이 다르면 멈춘다.
-- 순서: DB 적용 → 타입 재생성·코드 배포 → VERIFY·사후 점검 → 약관·충전 화면·8번 정책 본문 스크립트(한 트랜잭션).
--   DB 적용부터 코드 배포까지(그리고 되돌린 기간에도) 관리자 요금제 문구·약관 저장, 수동 환불 완료, 자료 환불 대표 정산을 하지 않는다.
-- 되돌리기: supabase/rollback/20261125100000_point_charge_policy_down_a.sql — (가) 돈 경로, _down_b.sql — (나) 판정·동의(코드 배포 전에만).
--   다시 적용할 때는 같은 트랜잭션에서 schema_migrations 의 '20261125100000' 행을 지운 뒤 이 파일과 이력 INSERT 를 넣는다. 9번 적용 뒤에는 8번 down·재적용을 하지 않는다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

-- 0. 사전 점검 -------------------------------------------------------------------------------------------------
DO $precheck$
DECLARE
  v_sig text;
  v_md5 text;
  v_expect text[];
  v_pairs text[][] := ARRAY[
    -- 재정의(원래 값 또는 9번 값 — 되돌린 뒤 재적용 허용)
    ARRAY['public.get_point_charge_refund_eligibility(uuid,uuid)', '0245acd07bad83535eb6e1099cffae7a'],
    ARRAY['public.quarantine_external_provider_cancellation(uuid,text,timestamp with time zone,text)', '7262e621179dda8b3094b8455a6718a1'],
    ARRAY['public.quarantine_payapp_partial_cancellation(uuid)', 'e0d24cd68b52d8011bf3adce4e0c5eb7'],
    ARRAY['public.process_payapp_cancellation(uuid)', '31878a1c6c5247c501c46b3d49091a82'],
    ARRAY['public.complete_manual_point_charge_refund(uuid,uuid,text,text,integer,integer)', '90c81af8fb2ebf8cb9a4a848d81dc688'],
    ARRAY['public.market_refund_allocate(uuid,integer,uuid[])', '0eca13d1b2dcce79e5872a4ce8b82453'],
    -- 그대로여야 함
    ARRAY['public.request_point_charge_refund(uuid,uuid,text)', 'c73ccb6ce327baa49ff8d327150ee32f'],
    ARRAY['public.claim_point_charge_refund(uuid,uuid,text)', 'd2ff0d91837f27466e471437ab2cdb26'],
    ARRAY['public.finalize_point_charge_refund(uuid,text,timestamp with time zone,text)', '1503dbe6cde53241b7ab2e2ed17be814'],
    ARRAY['public.reject_point_charge_refund(uuid,uuid,text,boolean)', '20384719deba112e977fbd3bf8e266e5'],
    ARRAY['public.fail_point_charge_refund(uuid,text,text,boolean)', '88e2b4cb94d68da451b42994f19adb14'],
    ARRAY['public.requeue_stuck_point_charge_refund(uuid)', 'd2129147f1ed7c465ede85815edb653c'],
    ARRAY['public.record_payment_alert(text,text,text,jsonb)', '80ee3155bf958c47a908fba4b28935e1'],
    ARRAY['public.consume_credits(uuid,integer,text,uuid,text)', '2c2398857d424d5522462517e26479c0'],
    ARRAY['public.market_refund_settle(uuid,uuid,jsonb,text)', '7682e64882413f0d31a943e3c515a492'],
    ARRAY['public.approve_market_refund(uuid,uuid,text,integer)', '5039e98d8060a72f40b93e5f4db00417'],
    ARRAY['public.settle_market_refund_by_owner(uuid,uuid,jsonb,text,integer)', '2ac88461650e13da79673e362ba0e677'],
    ARRAY['public.quarantine_kakaopay_partial_cancellation(uuid,text,integer)', '2907ff25ef4f84f3507713363528f09f'],
    ARRAY['public.revoke_admin_credits(uuid,uuid,integer,text,text)', '8c1f5e5e316c18b48556c18ca9bad86f'],
    ARRAY['public.get_credit_balance_snapshot(uuid)', '1c30e49ad8edb7b767af6356bda2ef8d'],
    ARRAY['public.refund_credits(uuid,integer,text,uuid,text,jsonb,integer)', 'bdfb58486f758ba173fae2691b0f4385'],
    ARRAY['public.resolve_payment_order_review(uuid,text,uuid,text,text,timestamp with time zone,text)', 'c9be280b25e58591f026dd196f2bc1ef'],
    ARRAY['public.market_refund_deadline(timestamp with time zone,integer)', 'c84efdd69d9bdb2e8562945e47cf885d'],
    ARRAY['public.payapp_fulfill_order_internal(uuid,timestamp with time zone)', '78cd0333f01a23a4d63228369175f517'],
    ARRAY['public.prepare_payment_order(uuid,uuid,text,uuid,text,text,integer,integer,text,text,text,text,text,timestamp with time zone,integer,integer,text,text)', '462fed08230394ce2b047818477ddc74'],
    ARRAY['public.grant_admin_credits(uuid,uuid,integer,text,text,jsonb,text)', 'dc251535d674a072f1b36ab3d78a864d'],
    ARRAY['public.approve_market_partial_refund(uuid,uuid,text,integer)', '222c7849cfe61fbc81328c75be6a1f27'],
    ARRAY['public.admin_exception_market_refund(uuid,uuid,text,text,uuid[],integer,integer,text,uuid,uuid,timestamp with time zone,integer)', 'af93b0e327efbf8ccaaef88994a84785']
  ];
  v_new text[][] := ARRAY[
    ARRAY['public.get_point_charge_refund_eligibility(uuid,uuid)', '60fc28afe44e7be776c189265e87b6ec'],
    ARRAY['public.quarantine_external_provider_cancellation(uuid,text,timestamp with time zone,text)', '1836e0a7859ff7e49bd3af0693655a30'],
    ARRAY['public.quarantine_payapp_partial_cancellation(uuid)', '1b5587b64788d8b7ac8be0c5d5fcd2be'],
    ARRAY['public.process_payapp_cancellation(uuid)', 'f45eed1de563b453dc2330e520744f06'],
    ARRAY['public.complete_manual_point_charge_refund(uuid,uuid,text,text,integer,integer)', '97967251a6478441c18e748ba322a00c'],
    ARRAY['public.market_refund_allocate(uuid,integer,uuid[])', '5987e703f9e4be0410f44a97e0cff826']
  ];
  i integer;
  j integer;
  v_ok boolean;
BEGIN
  FOR i IN 1 .. array_length(v_pairs, 1) LOOP
    v_sig := v_pairs[i][1];
    v_md5 := md5(pg_get_functiondef(v_sig::regprocedure));
    v_ok := v_md5 = v_pairs[i][2];
    IF NOT v_ok THEN
      FOR j IN 1 .. array_length(v_new, 1) LOOP
        IF v_new[j][1] = v_sig AND v_new[j][2] = v_md5 THEN
          v_ok := true;
        END IF;
      END LOOP;
    END IF;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'PRECHECK: % changed (%)', v_sig, v_md5;
    END IF;
  END LOOP;
END;
$precheck$;

-- 1. 충전 정책 설정 ---------------------------------------------------------------------------------------------
-- 첫 적용에서만 넣는다(되돌린 뒤 재적용해도 그사이 관리자가 고친 문구를 덮지 않음).
INSERT INTO public.system_settings (key, value, description, updated_at)
VALUES (
  'point_charge_policy',
  $json${
    "version": 1,
    "refundDays": 7,
    "checkoutTitle": "결제 전 확인",
    "checkoutItems": {
      "product": "자동결제 없이 한 번만 결제되는 충전 상품이며, 1회 최대 100,000원까지 충전할 수 있습니다. 결제 금액과 받는 크레딧(보너스 포함)은 주문 내용과 같고, 크레딧은 결제가 끝나면 바로 지급됩니다.",
      "validity": "충전한 크레딧은 결제한 때부터 1년 동안 쓸 수 있고(만료 일시는 크레딧 화면에 표시), 기간이 지나면 남은 크레딧은 쓸 수 없습니다. 다른 회원에게 넘길 수 없습니다.",
      "refund": "결제일 다음 날부터 {충전환불기간}일째 되는 날까지(크레딧 지급이 결제보다 늦어지면 지급일 다음 날부터) 이 충전 건의 크레딧을 하나도 쓰지 않았다면, 크레딧 화면이나 고객센터로 신청해 결제 금액 전액을 돌려받을 수 있습니다. 신청 후 3영업일 안에 원래 결제수단의 취소를 요청합니다(휴대폰 결제는 결제한 달이 지나면 취소되지 않을 수 있어, 이때는 본인 명의 계좌로 환불합니다).",
      "restriction": "이 충전 건의 크레딧을 하나라도 쓰면 단순 변심으로 취소할 수 없습니다. 크레딧은 유효기간이 먼저 끝나는 것부터 쓰입니다.",
      "otherCases": "결제 오류·중복 결제·주문 내용과 다르게 제공된 경우·서비스 종료는 취소·환불정책의 별도 기준을 따릅니다."
    },
    "minorNotice": "미성년자가 법정대리인의 동의 없이 결제한 경우 본인이나 법정대리인이 결제를 취소할 수 있습니다(법정대리인이 쓰도록 허락한 돈이거나, 성년인 것처럼 속인 경우 등은 제외). 고객센터(1:1 문의·이메일·전화)로 알려 주세요. 취소되면 남은 크레딧은 회수하며, 자세한 기준은 취소·환불정책 7절을 따릅니다.",
    "agreeLabel": "주문 내용과 결제 전 확인, 취소·환불정책을 확인했으며 결제에 동의합니다.",
    "creditsGuide": "구매건마다 남은 크레딧과 환불 가능 여부를 볼 수 있습니다. 크레딧은 유효기간이 먼저 끝나는 것부터 쓰입니다.",
    "refundRequestConfirm": [
      "결제일 다음 날부터 {충전환불기간}일째 되는 날까지, 이 충전 건을 하나도 쓰지 않았을 때만 신청할 수 있습니다.",
      "신청 뒤 담당자가 확인하며, 확인하는 동안 이 충전 건의 크레딧은 쓸 수 없습니다.",
      "신청 후 3영업일 안에 원래 결제수단으로 결제 금액 전액의 취소를 요청합니다(휴대폰 결제는 결제한 달이 지나면 본인 명의 계좌로 환불, 카드사 반영은 며칠 걸릴 수 있음)."
    ],
    "refundRequestAccepted": "환불 신청이 접수되었습니다. 신청일부터 3영업일 안에 원래 결제수단의 취소를 요청합니다(휴대폰 결제는 결제한 달이 지나면 본인 명의 계좌로 환불).",
    "refundBlockReasons": {
      "REFUND_SOURCE_NOT_FOUND": "구매건을 찾을 수 없습니다.",
      "REFUND_PAID_SOURCE_REQUIRED": "결제로 충전한 크레딧만 환불할 수 있습니다.",
      "REFUND_REISSUED_SOURCE": "자료 환불로 다시 받은 크레딧은 단순 변심 결제 취소 대상이 아닙니다(미성년자 결제 취소·서비스 종료는 취소·환불정책 7·8절).",
      "REFUND_COMPLETED_PAYMENT_REQUIRED": "원래 결제를 확인할 수 없어 환불을 신청할 수 없습니다.",
      "REFUND_SOURCE_NOT_ACTIVE": "이미 환불 처리 중이거나 끝난 구매건입니다.",
      "REFUND_CREDITS_ALREADY_USED": "이 충전 건의 크레딧을 이미 써서 환불할 수 없습니다.",
      "REFUND_SOURCE_EXPIRED": "이용기간이 끝난 크레딧은 환불할 수 없습니다.",
      "REFUND_REQUEST_PERIOD_EXPIRED": "환불 신청 기간(결제일 다음 날부터 {충전환불기간}일)이 지났습니다.",
      "REFUND_POLICY_UNAVAILABLE": "지금은 환불 가능 여부를 확인할 수 없습니다. 잠시 후 다시 시도하거나 고객센터로 알려 주세요(알린 시각을 신청 시각으로 봅니다)."
    }
  }$json$::jsonb,
  '충전 환불 기간·결제 전 확인·크레딧 화면 문구(src/lib/point-charge-policy.ts). 문구 변경은 관리자 요금제 화면에서만(pricing.manage). refundDays 는 낮추지 않는다(올릴 때는 약관 문장과 함께, 365 이하).',
  now()
)
ON CONFLICT (key) DO NOTHING;

DROP POLICY IF EXISTS system_settings_point_charge_policy_no_client_write ON public.system_settings;
CREATE POLICY system_settings_point_charge_policy_no_client_write
  ON public.system_settings
  AS RESTRICTIVE
  FOR UPDATE
  USING (key <> 'point_charge_policy')
  WITH CHECK (key <> 'point_charge_policy');

-- 2. 함께 보류한 재지급 크레딧(표시·감사용) -------------------------------------------------------------------------
ALTER TABLE public.refund_requests ADD COLUMN IF NOT EXISTS held_reissued_source_ids uuid[] NOT NULL DEFAULT '{}';

-- 3. 결제 직전 동의 기록(추가만) --------------------------------------------------------------------------------
-- checkout_attempt_id 는 checkout_attempts.checkout_attempt_id(화면 UUID). 주문과는 payment_orders.checkout_attempt_id → checkout_attempts.id 로 잇는다.
CREATE TABLE IF NOT EXISTS public.point_charge_checkout_acks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  checkout_attempt_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  plan_name text NOT NULL,
  amount integer NOT NULL,
  credits integer NOT NULL,
  refund_days integer NOT NULL,
  notice_text text NOT NULL,
  notice_sha256 text NOT NULL,
  refund_policy_sha256 text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT point_charge_checkout_acks_sha_check CHECK (notice_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT point_charge_checkout_acks_text_check CHECK (notice_text <> ''),
  CONSTRAINT point_charge_checkout_acks_days_check CHECK (refund_days >= 7),
  CONSTRAINT point_charge_checkout_acks_user_attempt_key UNIQUE (user_id, checkout_attempt_id)
);

-- UPDATE·TRUNCATE 는 늘 거부. DELETE 는 부모 profiles 가 이미 없을 때(탈퇴 연쇄 삭제)만(결제 회원은 payment_orders RESTRICT 로 프로필이 남아 5년 보존).
CREATE OR REPLACE FUNCTION public.guard_point_charge_checkout_acks_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_point_charge_checkout_acks$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id) THEN
      RAISE EXCEPTION 'POINT_CHARGE_CHECKOUT_ACKS_APPEND_ONLY';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'POINT_CHARGE_CHECKOUT_ACKS_APPEND_ONLY';
END;
$fn_guard_point_charge_checkout_acks$;

DROP TRIGGER IF EXISTS guard_point_charge_checkout_acks_mutation ON public.point_charge_checkout_acks;
CREATE TRIGGER guard_point_charge_checkout_acks_mutation
  BEFORE UPDATE OR DELETE ON public.point_charge_checkout_acks
  FOR EACH ROW EXECUTE FUNCTION public.guard_point_charge_checkout_acks_mutation();
DROP TRIGGER IF EXISTS guard_point_charge_checkout_acks_truncate ON public.point_charge_checkout_acks;
CREATE TRIGGER guard_point_charge_checkout_acks_truncate
  BEFORE TRUNCATE ON public.point_charge_checkout_acks
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_point_charge_checkout_acks_mutation();

ALTER TABLE public.point_charge_checkout_acks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.point_charge_checkout_acks FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.point_charge_checkout_acks TO service_role;

-- 4. 내부 함수 -------------------------------------------------------------------------------------------------
-- 4-1. 충전 환불 일수(7~3650 정수, 아니면 NULL — 부르는 쪽이 동의 일수·법정 7 로 대체)
CREATE OR REPLACE FUNCTION public.point_charge_refund_days()
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_pcrd$
DECLARE
  v_value jsonb;
  v_num numeric;
BEGIN
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'point_charge_policy';
  IF v_value IS NULL OR jsonb_typeof(v_value -> 'refundDays') IS DISTINCT FROM 'number' THEN
    RETURN NULL;
  END IF;
  v_num := (v_value ->> 'refundDays')::numeric;
  IF v_num <> trunc(v_num) OR v_num < 7 OR v_num > 3650 THEN
    RETURN NULL;
  END IF;
  RETURN v_num::integer;
END;
$fn_pcrd$;

-- 4-2. 마감 = 기준일(한국 날짜) 다음 날부터 p_days 일째 되는 날 24시(자료 환불 market_refund_deadline 과 같은 식)
CREATE OR REPLACE FUNCTION public.point_charge_refund_deadline(p_base timestamptz, p_days integer)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_pcrdl$
  SELECT CASE WHEN p_base IS NULL OR p_days IS NULL THEN NULL ELSE public.market_refund_deadline(p_base, p_days) END
$fn_pcrdl$;

-- 4-3. 다시 지급한 크레딧의 자손(사슬 전체, 20단계, 순환 중단)
CREATE OR REPLACE FUNCTION public.credit_source_reissued_descendants(p_root_source_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_csrd$
  WITH RECURSIVE d(id, depth, path) AS (
    SELECT l.source_id, 1, ARRAY[p_root_source_id, l.source_id]
      FROM public.market_refund_reissued_sources l
     WHERE l.original_source_id = p_root_source_id
    UNION ALL
    SELECT l.source_id, d.depth + 1, d.path || l.source_id
      FROM public.market_refund_reissued_sources l
      JOIN d ON l.original_source_id = d.id
     WHERE d.depth < 20 AND NOT (l.source_id = ANY (d.path))
  )
  SELECT DISTINCT id FROM d
$fn_csrd$;

-- 4-4. 유료 뿌리: 다시 지급한 크레딧을 원래 충전 원천까지 따라간다(끊김·순환이면 행 없음, RAISE 하지 않음).
CREATE OR REPLACE FUNCTION public.credit_source_paid_root(p_source_id uuid)
 RETURNS TABLE(root_source_id uuid, payment_order_id uuid, root_status text, root_cash_flag boolean, root_in_progress boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_cspr$
DECLARE
  v_id uuid := p_source_id;
  v_next uuid;
  v_seen uuid[] := '{}';
  v_src public.credit_sources%ROWTYPE;
  v_open boolean;
  v_done boolean;
  v_marker boolean;
  i integer := 0;
BEGIN
  LOOP
    SELECT * INTO v_src FROM public.credit_sources WHERE id = v_id;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    IF v_src.source_category = 'plan_purchase' THEN
      IF v_src.payment_order_id IS NULL THEN
        RETURN;
      END IF;
      v_open := EXISTS (SELECT 1 FROM public.refund_requests rr WHERE rr.source_id = v_src.id
                         AND rr.status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review'));
      v_done := EXISTS (SELECT 1 FROM public.refund_requests rr WHERE rr.source_id = v_src.id AND rr.status = 'completed');
      v_marker := EXISTS (SELECT 1 FROM public.payment_provider_transactions t
                           WHERE t.payment_order_id = v_src.payment_order_id
                             AND ((t.cancel_feedback_recorded_at IS NOT NULL AND t.cancel_processed_at IS NULL)
                               OR (t.partial_cancel_feedback_recorded_at IS NOT NULL AND t.partial_cancel_processed_at IS NULL)));
      root_source_id := v_src.id;
      payment_order_id := v_src.payment_order_id;
      root_status := v_src.status;
      root_cash_flag := v_open OR v_done OR v_marker;
      root_in_progress := v_open OR v_marker OR v_src.status = 'pending_refund';
      RETURN NEXT;
      RETURN;
    END IF;
    IF v_src.source_category <> 'system_refund' OR i >= 20 THEN
      RETURN;
    END IF;
    SELECT l.original_source_id INTO v_next FROM public.market_refund_reissued_sources l WHERE l.source_id = v_id;
    IF v_next IS NULL OR v_next = ANY (v_seen) THEN
      RETURN;
    END IF;
    v_seen := v_seen || v_id;
    v_id := v_next;
    i := i + 1;
  END LOOP;
END;
$fn_cspr$;

-- 4-5. 보류: 원래 원천의 재지급 자손 중 active 를 id 순으로 잠가 pending_refund, 요청에 기록. 부르는 쪽이 profiles 를 먼저 잠근다.
CREATE OR REPLACE FUNCTION public.point_charge_hold_reissued(p_root_source_id uuid, p_request_id uuid)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_pchr$
DECLARE
  v_ids uuid[] := '{}';
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT c.id
      FROM public.credit_sources c
     WHERE c.id IN (SELECT d FROM public.credit_source_reissued_descendants(p_root_source_id) d)
       AND c.status = 'active'
     ORDER BY c.id
       FOR UPDATE
  LOOP
    v_ids := v_ids || v_id;
  END LOOP;

  IF cardinality(v_ids) > 0 THEN
    UPDATE public.credit_sources SET status = 'pending_refund' WHERE id = ANY (v_ids) AND status = 'active';
  END IF;

  IF p_request_id IS NOT NULL AND cardinality(v_ids) > 0 THEN
    UPDATE public.refund_requests
       SET held_reissued_source_ids = ARRAY(SELECT DISTINCT x FROM unnest(held_reissued_source_ids || v_ids) x ORDER BY x)
     WHERE id = p_request_id;
  END IF;
  RETURN v_ids;
END;
$fn_pchr$;

-- 4-6. 재지급 크레딧 경보(자손이 있을 때만, p_force 면 언제나). 예외를 삼켜 취소·완료 본체를 실패시키지 않는다.
-- details 에 payment_order_id·mul_no 키를 넣지 않는다(유일 인덱스 COALESCE 순서·resolve_payment_order_review 일괄 해소 때문).
CREATE OR REPLACE FUNCTION public.point_charge_reissued_alert(p_code text, p_request_id uuid, p_order_id uuid, p_root_source_id uuid,
                                                              p_force boolean DEFAULT false, p_extra jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_pcra$
DECLARE
  v_sources jsonb;
  v_order_no text;
  v_message text;
  v_new boolean;
BEGIN
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('source_id', c.id, 'initial', c.initial_credits, 'remaining', c.remaining_credits,
                                                 'status', c.status, 'expires_at', c.expires_at) ORDER BY c.id), '[]'::jsonb)
      INTO v_sources
      FROM public.credit_sources c
     WHERE c.id IN (SELECT d FROM public.credit_source_reissued_descendants(p_root_source_id) d);
    IF jsonb_array_length(v_sources) = 0 AND NOT p_force THEN
      RETURN;
    END IF;
    -- '함께 보류했습니다' 는 지금 보류 중인 재지급 크레딧이 있을 때만(이미 모두 환불·해제됐으면 남기지 않음).
    IF p_code = 'REISSUED_CREDIT_HELD' AND NOT p_force
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_sources) x WHERE x ->> 'status' = 'pending_refund') THEN
      RETURN;
    END IF;
    SELECT o.order_id INTO v_order_no FROM public.payment_orders o WHERE o.id = p_order_id;
    v_message := CASE p_code
      WHEN 'REISSUED_CREDIT_HELD' THEN '취소된 결제에서 비롯해 다시 지급한 크레딧을 함께 사용 보류했습니다. 수동 완료 화면에서 원천별로 확인하세요.'
      WHEN 'REISSUED_CREDIT_HOLD_FAILED' THEN '취소된 결제에서 비롯해 다시 지급한 크레딧을 묶지 못했습니다. 원래 크레딧은 묶였습니다. 바로 확인하세요.'
      WHEN 'REISSUED_CREDIT_SETTLE_REVIEW' THEN '다시 지급한 크레딧이 있는 결제를 수동 완료했습니다. 원천별 원자료로 이미 쓴 몫과 정산을 확인하세요.'
      ELSE '다시 지급한 크레딧 확인이 필요합니다.'
    END;
    v_new := public.record_payment_alert(
      p_code,
      CASE WHEN p_code = 'REISSUED_CREDIT_HOLD_FAILED' THEN 'critical' ELSE 'warning' END,
      v_message,
      jsonb_build_object(
        'dedupe_key', COALESCE('refund_request:' || p_request_id::text, 'hold:' || p_order_id::text || ':' || clock_timestamp()::text),
        'order_payment_order_id', p_order_id, 'order_id', v_order_no, 'root_source_id', p_root_source_id,
        'refund_request_id', p_request_id, 'reissued_sources', v_sources, 'source', 'point_charge_reissued_alert') || COALESCE(p_extra, '{}'::jsonb)
    );
    -- 같은 경보가 이미 열려 있으면(같은 취소를 다시 통보받음) 관리자 알림을 다시 쌓지 않는다.
    IF v_new IS NOT TRUE THEN
      RETURN;
    END IF;
    INSERT INTO public.notifications (user_id, type, title, message, link, is_read)
    SELECT id, 'warning', '다시 지급한 크레딧 확인 필요',
           format('주문 %s: %s', COALESCE(v_order_no, p_order_id::text), v_message), '/admin/refunds', false
      FROM public.profiles
     WHERE is_admin = true;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      PERFORM public.record_payment_alert('REISSUED_CREDIT_ALERT_FAILED', 'warning', '다시 지급한 크레딧 경보를 남기지 못했습니다.',
        jsonb_build_object('dedupe_key', 'alert_failed:' || COALESCE(p_request_id::text, p_order_id::text, '') || ':' || p_code,
                           'order_payment_order_id', p_order_id, 'code', p_code));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END;
END;
$fn_pcra$;

-- 5. service_role 함수 ------------------------------------------------------------------------------------------
-- 5-1. 결제 직전 동의 기록. 지문 = sha256(fill(checkoutTitle) LF fill(product) LF fill(validity) LF fill(refund) LF fill(restriction)
--      LF fill(otherCases) LF fill(minorNotice) LF fill(agreeLabel)), fill = {충전환불기간} → refundDays. 코드(src/lib/point-charge-policy.ts)도 같은 규칙.
CREATE OR REPLACE FUNCTION public.record_point_charge_checkout_ack(p_user_id uuid, p_checkout_attempt_id uuid, p_plan_id uuid,
                                                                    p_expected_amount integer, p_expected_credits integer, p_notice_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_rpcca$
DECLARE
  v_existing public.point_charge_checkout_acks%ROWTYPE;
  v_value jsonb;
  v_items jsonb;
  v_days integer;
  v_parts text[];
  v_part text;
  v_key text;
  v_text text;
  v_sha text;
  v_plan public.pricing_plans%ROWTYPE;
  v_details jsonb;
  v_policy_sha text;
  v_inserted uuid;
BEGIN
  IF p_user_id IS NULL OR p_checkout_attempt_id IS NULL OR p_plan_id IS NULL OR p_expected_amount IS NULL OR p_expected_credits IS NULL
     OR p_notice_sha256 IS NULL OR p_notice_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_INPUT_INVALID');
  END IF;

  SELECT * INTO v_existing FROM public.point_charge_checkout_acks a
   WHERE a.user_id = p_user_id AND a.checkout_attempt_id = p_checkout_attempt_id;

  -- 지금 정책(필수 키·자리표시 규칙 — TS 저장 검사와 같음)
  v_days := public.point_charge_refund_days();
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'point_charge_policy';
  v_items := v_value -> 'checkoutItems';
  IF v_days IS NULL OR jsonb_typeof(v_items) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE');
  END IF;
  v_parts := ARRAY[v_value ->> 'checkoutTitle', v_items ->> 'product', v_items ->> 'validity', v_items ->> 'refund',
                   v_items ->> 'restriction', v_items ->> 'otherCases', v_value ->> 'minorNotice', v_value ->> 'agreeLabel'];
  FOREACH v_part IN ARRAY v_parts LOOP
    IF v_part IS NULL OR v_part !~ '\S' OR replace(v_part, '{충전환불기간}', '') ~ '[{}]' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE');
    END IF;
  END LOOP;
  IF strpos(v_items ->> 'refund', '{충전환불기간}') = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE');
  END IF;
  v_text := array_to_string(ARRAY(SELECT replace(x, '{충전환불기간}', v_days::text) FROM unnest(v_parts) WITH ORDINALITY AS t(x, n) ORDER BY n), chr(10));
  v_sha := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');

  SELECT * INTO v_plan FROM public.pricing_plans p WHERE p.id = p_plan_id;
  v_details := jsonb_build_object(
    'checkoutTitle', replace(v_value ->> 'checkoutTitle', '{충전환불기간}', v_days::text),
    'checkoutItems', jsonb_build_object(
      'product', replace(v_items ->> 'product', '{충전환불기간}', v_days::text),
      'validity', replace(v_items ->> 'validity', '{충전환불기간}', v_days::text),
      'refund', replace(v_items ->> 'refund', '{충전환불기간}', v_days::text),
      'restriction', replace(v_items ->> 'restriction', '{충전환불기간}', v_days::text),
      'otherCases', replace(v_items ->> 'otherCases', '{충전환불기간}', v_days::text)),
    'minorNotice', replace(v_value ->> 'minorNotice', '{충전환불기간}', v_days::text),
    'agreeLabel', replace(v_value ->> 'agreeLabel', '{충전환불기간}', v_days::text),
    'noticeSha256', v_sha, 'refundDays', v_days,
    'plan', CASE WHEN v_plan.id IS NULL THEN NULL ELSE jsonb_build_object('price', v_plan.price, 'credits', v_plan.credits) END);

  IF v_plan.id IS NULL OR NOT v_plan.is_active THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PLAN_UNAVAILABLE', 'details', v_details);
  END IF;
  IF v_plan.price <> p_expected_amount OR v_plan.credits <> p_expected_credits THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PLAN_CHANGED', 'details', v_details);
  END IF;
  -- 같은 시도의 재요청: 요금제가 그대로일 때만(위 검사 뒤) 같은 기록으로 본다.
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.notice_sha256 = p_notice_sha256 AND v_existing.plan_id = p_plan_id
       AND v_existing.amount = p_expected_amount AND v_existing.credits = p_expected_credits THEN
      RETURN jsonb_build_object('ok', true, 'replay', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details);
  END IF;
  IF v_sha <> p_notice_sha256 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_CHANGED', 'details', v_details);
  END IF;

  SELECT s.content_sha256 INTO v_policy_sha FROM public.policy_document_snapshots s
   WHERE s.doc_key = 'refundPolicy' ORDER BY s.seq DESC LIMIT 1;

  INSERT INTO public.point_charge_checkout_acks (user_id, checkout_attempt_id, plan_id, plan_name, amount, credits, refund_days,
                                                 notice_text, notice_sha256, refund_policy_sha256)
  VALUES (p_user_id, p_checkout_attempt_id, v_plan.id, v_plan.name, v_plan.price, v_plan.credits, v_days, v_text, v_sha, v_policy_sha)
  ON CONFLICT (user_id, checkout_attempt_id) DO NOTHING
  RETURNING id INTO v_inserted;
  IF v_inserted IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'replay', false);
  END IF;

  SELECT * INTO v_existing FROM public.point_charge_checkout_acks a
   WHERE a.user_id = p_user_id AND a.checkout_attempt_id = p_checkout_attempt_id;
  IF v_existing.notice_sha256 = p_notice_sha256 AND v_existing.plan_id = p_plan_id
     AND v_existing.amount = p_expected_amount AND v_existing.credits = p_expected_credits THEN
    RETURN jsonb_build_object('ok', true, 'replay', true);
  END IF;
  RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details);
END;
$fn_rpcca$;

-- 5-2. 수동 완료 화면 원자료(계산값 없음 — 이미 쓴 몫은 대표가 판단). 수동 완료와 같은 헬퍼·같은 '쓸 수 있는 몫' 정의.
CREATE OR REPLACE FUNCTION public.get_manual_refund_recovery_preview(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_gmrrp$
DECLARE
  v_request public.refund_requests%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_desc uuid[];
  v_sources jsonb;
  v_usable integer;
  v_refunded integer;
  v_previous jsonb;
  v_partial boolean;
BEGIN
  SELECT * INTO v_request FROM public.refund_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'REFUND_REQUEST_NOT_FOUND');
  END IF;
  SELECT * INTO v_order FROM public.payment_orders WHERE id = v_request.payment_order_id;
  IF v_order.id IS NOT NULL THEN
    SELECT * INTO v_ppt FROM public.payment_provider_transactions WHERE payment_order_id = v_order.id;
  END IF;
  v_desc := ARRAY(SELECT d FROM public.credit_source_reissued_descendants(v_request.source_id) d ORDER BY d);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'source_id', c.id, 'root', c.id = v_request.source_id, 'category', c.source_category, 'status', c.status,
           'initial', c.initial_credits, 'remaining', c.remaining_credits, 'expires_at', c.expires_at,
           'usable', CASE WHEN c.status IN ('active', 'pending_refund') AND (c.expires_at IS NULL OR c.expires_at > now())
                          THEN c.remaining_credits ELSE 0 END,
           'consumed_total', (SELECT COALESCE(sum(cc.amount), 0) FROM public.credit_consumption cc WHERE cc.source_id = c.id),
           'restored_by_material_refund', (SELECT COALESCE(sum((x ->> 'restored')::integer), 0)
                                             FROM public.market_refund_requests r, jsonb_array_elements(COALESCE(r.allocated_items, '[]'::jsonb)) x
                                            WHERE r.status = 'approved' AND (x ->> 'source_id') = c.id::text),
           'reissued_out', (SELECT COALESCE(sum((x ->> 'reissued')::integer), 0)
                              FROM public.market_refund_requests r, jsonb_array_elements(COALESCE(r.allocated_items, '[]'::jsonb)) x
                             WHERE r.status = 'approved' AND (x ->> 'source_id') = c.id::text),
           'net_used', c.initial_credits - c.remaining_credits
         ) ORDER BY c.expires_at ASC NULLS LAST, c.id), '[]'::jsonb)
    INTO v_sources
    FROM public.credit_sources c
   WHERE c.id = v_request.source_id OR c.id = ANY (v_desc);

  SELECT COALESCE(sum((x ->> 'usable')::integer), 0)::integer INTO v_usable FROM jsonb_array_elements(v_sources) x;
  SELECT COALESCE(sum(rr.refund_amount), 0)::integer INTO v_refunded
    FROM public.refund_requests rr WHERE rr.payment_order_id = v_order.id AND rr.status = 'completed';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('created_at', a.created_at, 'refund_request_id', a.refund_request_id,
                                               'recovered', a.recovered_credits, 'unrecovered', a.unrecovered_credits,
                                               'refund_amount', a.details -> 'refund_amount', 'sources', a.details -> 'sources')
                            ORDER BY a.created_at), '[]'::jsonb)
    INTO v_previous
    FROM public.payment_admin_actions a
   WHERE a.payment_order_id = v_order.id AND a.action = 'manual_refund_completed';

  v_partial := v_ppt.cancel_feedback_recorded_at IS NULL
    AND COALESCE(v_request.origin = 'partial_cancel' OR v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL
                 OR v_request.last_error_code IN ('KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW'), false);

  RETURN jsonb_build_object(
    'ok', true, 'request_id', v_request.id, 'request_status', v_request.status, 'origin', v_request.origin,
    'mode', CASE WHEN v_partial THEN 'partial' ELSE 'full' END,
    'payment_order_id', v_order.id, 'order_id', v_order.order_id, 'expected_amount', v_order.expected_amount,
    'partial_cancel_amount', v_ppt.partial_cancel_amount,
    'refunded_before', v_refunded, 'remaining_refundable_amount', GREATEST(COALESCE(v_order.expected_amount, 0) - v_refunded, 0),
    'usable_total', v_usable, 'has_reissued', cardinality(v_desc) > 0,
    'held_reissued_source_ids', to_jsonb(v_request.held_reissued_source_ids),
    'sources', v_sources, 'previous_completions', v_previous);
END;
$fn_gmrrp$;

-- 6. 재정의 -----------------------------------------------------------------------------------------------------

-- 6-elig. 판정 함수
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
  -- [9번] 시작
  v_setting_days integer;
  v_ack_days integer;
  v_days integer;
  v_policy_fallback boolean;
  v_extra jsonb;
  -- [9번] 끝
BEGIN
  SELECT * INTO v_source
    FROM public.credit_sources
   WHERE id = p_source_id
     AND user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason_code', 'REFUND_SOURCE_NOT_FOUND');
  END IF;
  -- [9번] 시작
  -- 자료 환불로 다시 지급한 크레딧은 단순 변심 결제 취소 대상이 아니다(미성년자·서비스 종료는 런북).
  IF v_source.source_category = 'system_refund'
     AND EXISTS (SELECT 1 FROM public.market_refund_reissued_sources l WHERE l.source_id = v_source.id) THEN
    RETURN jsonb_build_object('allowed', false, 'reason_code', 'REFUND_REISSUED_SOURCE');
  END IF;
  -- [9번] 끝

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

  -- [9번] 시작
-- [9번 원래]   v_refundable_until := v_order.approved_at + interval '7 days';
-- [9번 원래] 
-- [9번 원래]   IF v_source.status <> 'active'
-- [9번 원래]      OR EXISTS (
-- [9번 원래]        SELECT 1
-- [9번 원래]          FROM public.refund_requests rr
-- [9번 원래]         WHERE rr.source_id = v_source.id
-- [9번 원래]           AND rr.status = 'completed'
-- [9번 원래]      ) THEN
-- [9번 원래]     RETURN jsonb_build_object(
-- [9번 원래]       'allowed', false,
-- [9번 원래]       'reason_code', 'REFUND_SOURCE_NOT_ACTIVE',
-- [9번 원래]       'refundable_until', v_refundable_until
-- [9번 원래]     );
-- [9번 원래]   END IF;
-- [9번 원래] 
-- [9번 원래]   IF v_source.remaining_credits <> v_source.initial_credits THEN
-- [9번 원래]     RETURN jsonb_build_object(
-- [9번 원래]       'allowed', false,
-- [9번 원래]       'reason_code', 'REFUND_CREDITS_ALREADY_USED',
-- [9번 원래]       'refundable_until', v_refundable_until
-- [9번 원래]     );
-- [9번 원래]   END IF;
-- [9번 원래] 
-- [9번 원래]   IF v_source.expires_at IS NOT NULL AND v_source.expires_at <= now() THEN
-- [9번 원래]     RETURN jsonb_build_object(
-- [9번 원래]       'allowed', false,
-- [9번 원래]       'reason_code', 'REFUND_SOURCE_EXPIRED',
-- [9번 원래]       'refundable_until', v_refundable_until
-- [9번 원래]     );
-- [9번 원래]   END IF;
-- [9번 원래] 
-- [9번 원래]   IF now() > v_refundable_until THEN
-- [9번 원래]     RETURN jsonb_build_object(
-- [9번 원래]       'allowed', false,
-- [9번 원래]       'reason_code', 'REFUND_REQUEST_PERIOD_EXPIRED',
-- [9번 원래]       'refundable_until', v_refundable_until
-- [9번 원래]     );
-- [9번 원래]   END IF;
-- [9번 원래] 
-- [9번 원래]   -- 토스 결제는 종료했다(마이그레이션 B2). 다른 불가 사유가 먼저 보이도록 마지막에 막는다.
-- [9번 원래]   IF v_order.provider = 'toss' THEN
-- [9번 원래]     RETURN jsonb_build_object(
-- [9번 원래]       'allowed', false,
-- [9번 원래]       'reason_code', 'REFUND_COMPLETED_PAYMENT_REQUIRED',
-- [9번 원래]       'refundable_until', v_refundable_until
-- [9번 원래]     );
-- [9번 원래]   END IF;
-- [9번 원래] 
-- [9번 원래]   RETURN jsonb_build_object(
-- [9번 원래]     'allowed', true,
-- [9번 원래]     'reason_code', null,
-- [9번 원래]     'provider', v_order.provider,
-- [9번 원래]     'refundable_until', v_refundable_until
-- [9번 원래]   );
  -- 일수 = GREATEST(지금 설정, 이 결제에 동의한 일수). 설정을 못 읽으면 동의 일수, 그것도 없으면 법정 최소 7.
  -- 기준시각 = GREATEST(결제 승인, 크레딧 지급) — 지급이 늦으면 지급일(전자상거래법 17조1항 단서).
  -- 마감 = 기준일(한국 날짜) 다음 날부터 N일째 되는 날 24시(자료 환불과 같은 셈법). 쓰기를 하지 않는다(STABLE).
  v_setting_days := public.point_charge_refund_days();
  SELECT a.refund_days INTO v_ack_days
    FROM public.checkout_attempts ca
    JOIN public.point_charge_checkout_acks a
      ON a.user_id = ca.user_id AND a.checkout_attempt_id = ca.checkout_attempt_id
   WHERE ca.id = v_order.checkout_attempt_id;
  v_policy_fallback := v_setting_days IS NULL;
  v_days := COALESCE(GREATEST(v_setting_days, v_ack_days), 7);
  v_refundable_until := public.point_charge_refund_deadline(GREATEST(v_order.approved_at, v_source.created_at), v_days);
  v_extra := jsonb_build_object('policy_fallback', v_policy_fallback, 'refund_days', v_days);

  IF v_source.status <> 'active'
     OR EXISTS (
       SELECT 1
         FROM public.refund_requests rr
        WHERE rr.source_id = v_source.id
          AND rr.status = 'completed'
     ) THEN
    RETURN jsonb_build_object('allowed', false, 'reason_code', 'REFUND_SOURCE_NOT_ACTIVE', 'refundable_until', v_refundable_until) || v_extra;
  END IF;

  IF v_source.remaining_credits <> v_source.initial_credits THEN
    RETURN jsonb_build_object('allowed', false, 'reason_code', 'REFUND_CREDITS_ALREADY_USED', 'refundable_until', v_refundable_until) || v_extra;
  END IF;

  IF v_source.expires_at IS NOT NULL AND v_source.expires_at <= now() THEN
    RETURN jsonb_build_object('allowed', false, 'reason_code', 'REFUND_SOURCE_EXPIRED', 'refundable_until', v_refundable_until) || v_extra;
  END IF;

  IF v_refundable_until IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason_code', 'REFUND_POLICY_UNAVAILABLE', 'refundable_until', NULL) || v_extra;
  END IF;

  IF NOT (now() < v_refundable_until) THEN
    RETURN jsonb_build_object('allowed', false, 'reason_code', 'REFUND_REQUEST_PERIOD_EXPIRED', 'refundable_until', v_refundable_until) || v_extra;
  END IF;

  -- 토스 결제는 종료했다(마이그레이션 B2). 다른 불가 사유가 먼저 보이도록 마지막에 막는다.
  IF v_order.provider = 'toss' THEN
    RETURN jsonb_build_object('allowed', false, 'reason_code', 'REFUND_COMPLETED_PAYMENT_REQUIRED', 'refundable_until', v_refundable_until) || v_extra;
  END IF;

  RETURN jsonb_build_object('allowed', true, 'reason_code', null, 'provider', v_order.provider, 'refundable_until', v_refundable_until) || v_extra;
  -- [9번] 끝
END;
$function$;

-- 6-ext. 외부 취소 격리
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
    -- [9번] 시작
    -- 이 결제에서 비롯해 다시 지급한 크레딧도 함께 사용 보류(profiles 잠금 뒤, id 순). 실패는 삼키지 않는다.
    PERFORM public.point_charge_hold_reissued(v_source.id, v_request.id);
    PERFORM public.point_charge_reissued_alert('REISSUED_CREDIT_HELD', v_request.id, v_order.id, v_source.id);
    -- [9번] 끝

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
  -- [9번] 시작
  -- 이 결제에서 비롯해 다시 지급한 크레딧도 함께 사용 보류(profiles 잠금 뒤, id 순). 실패는 삼키지 않는다.
  PERFORM public.point_charge_hold_reissued(v_source.id, v_request.id);
  PERFORM public.point_charge_reissued_alert('REISSUED_CREDIT_HELD', v_request.id, v_order.id, v_source.id);
  -- [9번] 끝

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

-- 6-part. 부분취소 격리
CREATE OR REPLACE FUNCTION public.quarantine_payapp_partial_cancellation(p_payment_order_id uuid)
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
    -- [9번] 시작
    -- 이 결제에서 비롯해 다시 지급한 크레딧도 함께 사용 보류(profiles 잠금 뒤, id 순). 실패는 삼키지 않는다.
    PERFORM public.point_charge_hold_reissued(v_source.id, v_request.id);
    PERFORM public.point_charge_reissued_alert('REISSUED_CREDIT_HELD', v_request.id, v_order.id, v_source.id);
    -- [9번] 끝

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

-- 6-proc. 취소 통보 처리(실패 대체 경로)
CREATE OR REPLACE FUNCTION public.process_payapp_cancellation(p_payment_order_id uuid)
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
  v_alert_code text;
  v_alert_details jsonb;
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
        -- 관리자 결제확인 주문에 부분취소가 먼저 와서 격리된 경우도 결제번호가 검증되지 않았다. 경보 문구를 콘솔 대조로 안내한다.
        IF v_ppt.paid_feedback_recorded_at IS NULL AND v_ppt.admin_paid_confirmed_at IS NOT NULL THEN
          v_detail := jsonb_build_object('reason', 'admin_confirmed_mul_no_unverified');
        END IF;
      ELSIF v_request.id IS NOT NULL
            AND v_request.status = 'manual_review' AND v_request.origin = 'user'
            AND v_ppt.paid_feedback_recorded_at IS NULL
            AND v_ppt.admin_paid_confirmed_at IS NOT NULL THEN
        -- 관리자가 입력한 결제번호라 이 취소가 우리 결제인지 검증되지 않았다. 자동 완료하지 않는다.
        v_result := 'already_quarantined';
        v_detail := jsonb_build_object('reason', 'admin_confirmed_mul_no_unverified');
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
    -- 취소 후속 경보를 처리 시각과 같은 트랜잭션에 남긴다. code·문구는 TS cancellationFollowUps와 같다.
    -- TS가 같은 경보를 다시 기록해도 (code, payment_order_id) 키라 DO NOTHING이 된다.
    v_alert_code := CASE
      WHEN v_result = 'double_refund_suspected' THEN 'PAYAPP_DOUBLE_REFUND_SUSPECTED'
      WHEN v_result = 'already_quarantined' AND v_marker = 'cancel' THEN 'PAYAPP_CANCEL_AFTER_QUARANTINE'
      WHEN v_result = 'partial_cancel_after_cancel' THEN 'PAYAPP_PARTIAL_CANCEL_AFTER_CANCEL'
      WHEN v_result = 'partial_cancel_quarantined' AND v_detail->>'outcome' = 'absorbed_by_refund' THEN 'PAYAPP_PARTIAL_CANCEL_ABSORBED'
      WHEN v_result = 'deferred_refund_processing' THEN 'PAYAPP_PARTIAL_CANCEL_DEFERRED'
      -- 관리자 결제확인 주문에 열린 manual_review·user 요청이 없으면 외부 전취소 격리로 간다.
      -- 결제번호가 페이앱 통보로 검증되지 않았으므로 critical로 남긴다.
      WHEN v_result = 'external_cancel_quarantined'
           AND v_ppt.paid_feedback_recorded_at IS NULL
           AND v_ppt.admin_paid_confirmed_at IS NOT NULL THEN 'PAYAPP_CANCEL_AFTER_QUARANTINE'
    END;

    IF v_alert_code IS NOT NULL THEN
      v_alert_details := jsonb_build_object('order_id', v_order.order_id, 'payment_order_id', v_order.id, 'source', 'process_payapp_cancellation')
        || (COALESCE(v_detail, '{}'::jsonb) - 'request_id' - 'user_id');
      IF v_result = 'external_cancel_quarantined' THEN
        v_alert_details := v_alert_details || jsonb_build_object('reason', 'admin_confirmed_mul_no_unverified');
      END IF;

      PERFORM public.record_payment_alert(
        v_alert_code,
        CASE WHEN v_alert_code IN ('PAYAPP_DOUBLE_REFUND_SUSPECTED', 'PAYAPP_CANCEL_AFTER_QUARANTINE') THEN 'critical' ELSE 'warning' END,
        CASE v_alert_code
          WHEN 'PAYAPP_DOUBLE_REFUND_SUSPECTED' THEN '계좌이체로 환불한 결제가 페이앱에서도 취소되었습니다.'
          WHEN 'PAYAPP_CANCEL_AFTER_QUARANTINE' THEN
            CASE WHEN v_alert_details->>'reason' = 'admin_confirmed_mul_no_unverified'
              THEN '관리자가 결제확인한 결제가 페이앱에서 승인취소되었습니다. 이 사이트 결제의 취소인지 페이앱 콘솔과 먼저 대조하세요.'
              ELSE '수동 확인 중인 결제가 페이앱에서 승인취소되었습니다. 전액 환불 기준으로 처리하세요.'
            END
          WHEN 'PAYAPP_PARTIAL_CANCEL_AFTER_CANCEL' THEN '승인취소를 처리한 결제에 부분취소가 통보되었습니다. 실제 환불액을 확인하세요.'
          WHEN 'PAYAPP_PARTIAL_CANCEL_ABSORBED' THEN '전액 환불된 결제에 부분취소가 통보되었습니다. 실제 환불액을 확인하세요.'
          WHEN 'PAYAPP_PARTIAL_CANCEL_DEFERRED' THEN '환불 처리 중인 결제에 부분취소가 통보되었습니다. 환불이 끝난 뒤 대사가 정리합니다.'
        END,
        v_alert_details
      );
    END IF;

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
    -- [9번] 시작
    -- 실패 대체 경로도 다시 지급한 크레딧을 묶는다. 원래 원천 격리는 위에서 끝났으므로, 묶기가 실패해도 그것은 유지하고 경보만 남긴다.
    SELECT * INTO v_request
      FROM public.refund_requests
     WHERE source_id = v_source.id AND status = 'manual_review'
     ORDER BY created_at DESC
     LIMIT 1;
    BEGIN
      PERFORM public.point_charge_hold_reissued(v_source.id, v_request.id);
      PERFORM public.point_charge_reissued_alert('REISSUED_CREDIT_HELD', v_request.id, v_order.id, v_source.id);
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.point_charge_reissued_alert('REISSUED_CREDIT_HOLD_FAILED', v_request.id, v_order.id, v_source.id, true);
    END;
    -- [9번] 끝
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

  -- 실패 대체 처리의 경보도 처리 시각과 같은 트랜잭션에 남긴다(TS cancellationFollowUps와 같은 code·문구).
  PERFORM public.record_payment_alert(
    'PAYAPP_CANCEL_HANDLING_FAILED',
    'critical',
    '페이앱 취소 처리에 실패해 크레딧을 묶고 수동 확인으로 보냈습니다.',
    jsonb_build_object('order_id', v_order.order_id, 'payment_order_id', v_order.id, 'source', 'process_payapp_cancellation',
                       'error_state', v_error_state)
  );

  RETURN jsonb_build_object(
    'result', 'cancel_handling_failed',
    'marker', v_marker,
    'payment_order_id', v_order.id,
    'order_id', v_order.order_id,
    'error_state', v_error_state
  );
END;
$function$;

-- 6-man. 수동 완료
CREATE OR REPLACE FUNCTION public.complete_manual_point_charge_refund(p_request_id uuid, p_admin_id uuid, p_note text, p_external_method text, p_refund_amount integer, p_recovered_credits integer DEFAULT NULL::integer)
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
  v_double boolean := false;
  -- [9번] 시작
  v_desc uuid[];
  v_refunded_before integer;
  v_usable_total integer;
  v_left integer;
  v_take integer;
  v_expired integer;
  v_after integer;
  v_family_after integer;
  v_sources jsonb;
  v_row public.credit_sources%ROWTYPE;
  -- [9번] 끝
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
    -- 계좌 송금 외의 방식(결제사 취소 통보, 페이앱 취소 요청, 페이앱 관리자 취소)으로 이미 완료된 요청에
    -- 계좌 송금 완료가 들어오면 이중 환불 의심이다. 같은 계좌 송금의 재클릭은 제외한다.
    IF p_external_method = 'bank_transfer' AND NOT EXISTS (
         SELECT 1 FROM public.payment_admin_actions paa
          WHERE paa.refund_request_id = v_request.id
            AND paa.action = 'manual_refund_completed'
            AND paa.external_method = 'bank_transfer') THEN
      PERFORM public.record_payment_alert('PAYAPP_DOUBLE_REFUND_SUSPECTED', 'critical',
        '이미 다른 방식으로 환불이 완료된 요청에 계좌 송금 완료가 입력되었습니다. 송금했다면 회수가 필요합니다.',
        jsonb_build_object('payment_order_id', v_request.payment_order_id, 'refund_request_id', v_request.id,
                           'actor_id', p_admin_id, 'provider_cancel_transaction_key', v_request.provider_cancel_transaction_key,
                           'dedupe_key', 'refund_request:' || v_request.id::text,
                           'source', 'complete_manual_after_completed'));
      v_double := true;
    END IF;

    SELECT credits INTO v_new_balance
      FROM public.profiles
     WHERE id = v_request.user_id;

    RETURN jsonb_build_object('already_completed', true, 'new_balance', v_new_balance, 'double_refund_suspected', v_double);
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

  -- 승인취소(전액) 표식이 있으면 PG는 전액 환불이므로 부분 회수를 허용하지 않는다(남은 크레딧 전량 회수).
  v_partial := v_ppt.cancel_feedback_recorded_at IS NULL
    AND COALESCE(
    v_request.origin = 'partial_cancel'
    OR v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL
    OR v_request.last_error_code IN ('KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW'),
    false
  );

  -- [9번] 시작
-- [9번 원래]   IF v_partial THEN
-- [9번 원래]     IF p_recovered_credits IS NULL
-- [9번 원래]        OR p_recovered_credits NOT BETWEEN 0 AND v_source.remaining_credits THEN
-- [9번 원래]       RAISE EXCEPTION 'MANUAL_REFUND_RECOVERY_INVALID';
-- [9번 원래]     END IF;
-- [9번 원래]     v_recovered := p_recovered_credits;
-- [9번 원래]   ELSE
-- [9번 원래]     IF p_recovered_credits IS NOT NULL
-- [9번 원래]        AND p_recovered_credits <> v_source.remaining_credits THEN
-- [9번 원래]       RAISE EXCEPTION 'MANUAL_REFUND_RECOVERY_INVALID';
-- [9번 원래]     END IF;
-- [9번 원래]     v_recovered := v_source.remaining_credits;
-- [9번 원래]   END IF;
-- [9번 원래] 
-- [9번 원래]   v_used_before := v_source.initial_credits - v_source.remaining_credits;
-- [9번 원래]   v_remaining_after := v_source.remaining_credits - v_recovered;
-- [9번 원래]   v_source_status_after := CASE WHEN v_remaining_after > 0 THEN 'active' ELSE 'refunded' END;
-- [9번 원래] 
-- [9번 원래]   UPDATE public.credit_sources
-- [9번 원래]      SET remaining_credits = v_remaining_after,
-- [9번 원래]          status = v_source_status_after
-- [9번 원래]    WHERE id = v_source.id;
-- [9번 원래] 
-- [9번 원래]   SELECT COALESCE(SUM(remaining_credits), 0)::integer
-- [9번 원래]     INTO v_new_balance
-- [9번 원래]     FROM public.credit_sources
-- [9번 원래]    WHERE user_id = v_request.user_id
-- [9번 원래]      AND status IN ('active', 'pending_refund')
-- [9번 원래]      AND (expires_at IS NULL OR expires_at > now());
-- [9번 원래] 
-- [9번 원래]   UPDATE public.profiles
-- [9번 원래]      SET credits = v_new_balance
-- [9번 원래]    WHERE id = v_request.user_id;
-- [9번 원래] 
-- [9번 원래]   IF v_recovered > 0 THEN
-- [9번 원래]     INSERT INTO public.credit_transactions (
-- [9번 원래]       user_id,
-- [9번 원래]       type,
-- [9번 원래]       amount,
-- [9번 원래]       balance_after,
-- [9번 원래]       description,
-- [9번 원래]       source_id,
-- [9번 원래]       resource_type,
-- [9번 원래]       resource_id
-- [9번 원래]     ) VALUES (
-- [9번 원래]       v_request.user_id,
-- [9번 원래]       'refund',
-- [9번 원래]       -v_recovered,
-- [9번 원래]       v_new_balance,
-- [9번 원래]       format('수동 환불 완료 (%s 크레딧 회수)', v_recovered),
-- [9번 원래]       v_source.id,
-- [9번 원래]       'refund_request',
-- [9번 원래]       v_request.id
-- [9번 원래]     );
-- [9번 원래]   END IF;
-- [9번 원래] 
-- [9번 원래]   IF v_source_status_after = 'refunded' THEN
-- [9번 원래]     UPDATE public.payment_orders
-- [9번 원래]        SET status = 'refunded',
-- [9번 원래]            canceled_at = COALESCE(canceled_at, now()),
-- [9번 원래]            next_reconcile_at = NULL
-- [9번 원래]      WHERE id = v_order.id;
-- [9번 원래] 
-- [9번 원래]     UPDATE public.payment_history
-- [9번 원래]        SET status = 'refunded'
-- [9번 원래]      WHERE payment_order_id = v_order.id;
-- [9번 원래] 
-- [9번 원래]     UPDATE public.checkout_attempts
-- [9번 원래]        SET status = 'cancelled',
-- [9번 원래]            updated_at = now()
-- [9번 원래]      WHERE id = v_order.checkout_attempt_id;
-- [9번 원래]   ELSE
-- [9번 원래]     UPDATE public.payment_orders
-- [9번 원래]        SET status = 'completed',
-- [9번 원래]            failure_code = NULL,
-- [9번 원래]            failure_message = NULL,
-- [9번 원래]            next_reconcile_at = NULL
-- [9번 원래]      WHERE id = v_order.id;
-- [9번 원래]   END IF;
-- [9번 원래] 
-- [9번 원래]   UPDATE public.refund_requests
-- [9번 원래]      SET status = 'completed',
-- [9번 원래]          refund_amount = p_refund_amount,
-- [9번 원래]          processed_by = p_admin_id,
-- [9번 원래]          processed_at = now(),
-- [9번 원래]          next_attempt_at = NULL
-- [9번 원래]    WHERE id = v_request.id;
-- [9번 원래] 
-- [9번 원래]   INSERT INTO public.payment_admin_actions (
-- [9번 원래]     actor_id,
-- [9번 원래]     action,
-- [9번 원래]     payment_order_id,
-- [9번 원래]     refund_request_id,
-- [9번 원래]     before_state,
-- [9번 원래]     after_state,
-- [9번 원래]     note,
-- [9번 원래]     recovered_credits,
-- [9번 원래]     unrecovered_credits,
-- [9번 원래]     external_method,
-- [9번 원래]     details
-- [9번 원래]   ) VALUES (
-- [9번 원래]     p_admin_id,
-- [9번 원래]     'manual_refund_completed',
-- [9번 원래]     v_order.id,
-- [9번 원래]     v_request.id,
-- [9번 원래]     jsonb_build_object(
-- [9번 원래]       'request_status', v_request.status,
-- [9번 원래]       'order_status', v_order.status,
-- [9번 원래]       'source_status', v_source.status,
-- [9번 원래]       'remaining_credits', v_source.remaining_credits,
-- [9번 원래]       'profile_credits', v_balance_before
-- [9번 원래]     ),
-- [9번 원래]     jsonb_build_object(
-- [9번 원래]       'request_status', 'completed',
-- [9번 원래]       'order_status', CASE WHEN v_source_status_after = 'refunded' THEN 'refunded' ELSE 'completed' END,
-- [9번 원래]       'source_status', v_source_status_after,
-- [9번 원래]       'remaining_credits', v_remaining_after,
-- [9번 원래]       'profile_credits', v_new_balance
-- [9번 원래]     ),
-- [9번 원래]     p_note,
-- [9번 원래]     v_recovered,
-- [9번 원래]     v_remaining_after,
-- [9번 원래]     p_external_method,
-- [9번 원래]     jsonb_build_object(
-- [9번 원래]       'used_credits_before', v_used_before,
-- [9번 원래]       'refund_amount', p_refund_amount,
-- [9번 원래]       'partial', v_partial,
-- [9번 원래]       'origin', v_request.origin
-- [9번 원래]     )
-- [9번 원래]   );
  -- 같은 결제(원래 원천 A)에서 비롯해 다시 지급한 크레딧을 지금 다시 찾아 잠근다(profiles 잠금 뒤, id 순).
  v_desc := ARRAY(SELECT d FROM public.credit_source_reissued_descendants(v_source.id) d ORDER BY d);
  PERFORM 1 FROM public.credit_sources c WHERE c.id = ANY (v_desc) ORDER BY c.id FOR UPDATE;

  -- 같은 결제를 여러 번 완료할 수 있으므로 완료된 환불액 합 + 이번 환불액이 결제 금액을 넘지 않게 한다.
  SELECT COALESCE(sum(rr.refund_amount), 0)::integer INTO v_refunded_before
    FROM public.refund_requests rr
   WHERE rr.payment_order_id = v_order.id AND rr.status = 'completed';
  IF v_refunded_before + p_refund_amount > v_order.expected_amount THEN
    RAISE EXCEPTION 'MANUAL_REFUND_INPUT_INVALID';
  END IF;

  -- 쓸 수 있는 몫 = 원래 + 자손 중 active·pending_refund 이고 유효기간이 남은 원천의 잔량.
  SELECT COALESCE(sum(c.remaining_credits), 0)::integer INTO v_usable_total
    FROM public.credit_sources c
   WHERE (c.id = v_source.id OR c.id = ANY (v_desc))
     AND c.status IN ('active', 'pending_refund')
     AND (c.expires_at IS NULL OR c.expires_at > now());

  IF v_partial THEN
    IF p_recovered_credits IS NULL
       OR p_recovered_credits NOT BETWEEN 0 AND v_usable_total THEN
      RAISE EXCEPTION 'MANUAL_REFUND_RECOVERY_INVALID';
    END IF;
    v_recovered := p_recovered_credits;
  ELSE
    IF p_recovered_credits IS NOT NULL
       AND p_recovered_credits <> v_usable_total THEN
      RAISE EXCEPTION 'MANUAL_REFUND_RECOVERY_INVALID';
    END IF;
    v_recovered := v_usable_total;
  END IF;

  -- 원래 원천 기준 사용량(관리자 화면 호환용 — 다시 지급한 크레딧이 있으면 결제 기준 사용량과 다르다)
  v_used_before := v_source.initial_credits - v_source.remaining_credits;

  -- 회수는 유효기간이 먼저 끝나는 원천부터(consume 순서). 만료된 잔량은 0 으로 정리하되 회수량과 따로 기록한다.
  v_left := v_recovered;
  v_sources := '[]'::jsonb;
  v_family_after := 0;
  FOR v_row IN
    SELECT c.*
      FROM public.credit_sources c
     WHERE (c.id = v_source.id OR c.id = ANY (v_desc))
       AND c.status IN ('active', 'pending_refund')
     ORDER BY c.expires_at ASC NULLS LAST, c.id
  LOOP
    v_expired := CASE WHEN v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN v_row.remaining_credits ELSE 0 END;
    v_take := CASE WHEN v_expired > 0 THEN 0 ELSE LEAST(v_left, v_row.remaining_credits) END;
    v_left := v_left - v_take;
    v_after := v_row.remaining_credits - v_take - v_expired;
    v_family_after := v_family_after + v_after;
    UPDATE public.credit_sources SET remaining_credits = v_after WHERE id = v_row.id;
    v_sources := v_sources || jsonb_build_array(jsonb_build_object(
      'source_id', v_row.id, 'root', v_row.id = v_source.id, 'category', v_row.source_category,
      'initial', v_row.initial_credits, 'remaining_before', v_row.remaining_credits, 'status_before', v_row.status,
      'expires_at', v_row.expires_at, 'recovered', v_take, 'expired_cleared', v_expired, 'remaining_after', v_after));
  END LOOP;

  -- 끝 상태: 자손은 각자 잔량으로, 원래 원천은 원래 + 자손 잔량 합이 0 일 때만 refunded(아니면 잔량 0 이어도 active — 다음 취소가 같은 경로를 타게).
  UPDATE public.credit_sources c
     SET status = CASE WHEN c.remaining_credits > 0 THEN 'active' ELSE 'refunded' END
   WHERE c.id = ANY (v_desc) AND c.status IN ('active', 'pending_refund');
  v_source_status_after := CASE WHEN v_family_after > 0 THEN 'active' ELSE 'refunded' END;
  UPDATE public.credit_sources SET status = v_source_status_after WHERE id = v_source.id;
  SELECT remaining_credits INTO v_remaining_after FROM public.credit_sources WHERE id = v_source.id;

  SELECT COALESCE(SUM(remaining_credits), 0)::integer
    INTO v_new_balance
    FROM public.credit_sources
   WHERE user_id = v_request.user_id
     AND status IN ('active', 'pending_refund')
     AND (expires_at IS NULL OR expires_at > now());

  UPDATE public.profiles
     SET credits = v_new_balance
   WHERE id = v_request.user_id;

  -- 원장에는 회수량만 원천별 1행(만료 정리는 payment_admin_actions.details 에만 — credit_transactions type 에 expire 없음).
  INSERT INTO public.credit_transactions (user_id, type, amount, balance_after, description, source_id, resource_type, resource_id)
  SELECT v_request.user_id, 'refund', -((x ->> 'recovered')::integer), v_new_balance,
         format('수동 환불 완료 (%s 크레딧 회수)', x ->> 'recovered'), (x ->> 'source_id')::uuid, 'refund_request', v_request.id
    FROM jsonb_array_elements(v_sources) x
   WHERE (x ->> 'recovered')::integer > 0;

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
    actor_id, action, payment_order_id, refund_request_id, before_state, after_state, note,
    recovered_credits, unrecovered_credits, external_method, details
  ) VALUES (
    p_admin_id, 'manual_refund_completed', v_order.id, v_request.id,
    jsonb_build_object('request_status', v_request.status, 'order_status', v_order.status, 'source_status', v_source.status,
                       'remaining_credits', v_source.remaining_credits, 'profile_credits', v_balance_before),
    jsonb_build_object('request_status', 'completed',
                       'order_status', CASE WHEN v_source_status_after = 'refunded' THEN 'refunded' ELSE 'completed' END,
                       'source_status', v_source_status_after, 'remaining_credits', v_remaining_after,
                       'family_remaining_after', v_family_after, 'profile_credits', v_new_balance),
    p_note,
    v_recovered,
    v_family_after,
    p_external_method,
    jsonb_build_object('used_credits_before', v_used_before, 'used_credits_basis', 'root_source',
                       'refund_amount', p_refund_amount, 'refunded_before', v_refunded_before,
                       'partial', v_partial, 'origin', v_request.origin, 'sources', v_sources)
  );

  -- 다시 지급한 크레딧이 얽힌 결제는 대표가 원천별 원자료로 정산을 확인한다(이미 쓴 몫은 자동 계산하지 않음).
  IF cardinality(v_desc) > 0 THEN
    PERFORM public.point_charge_reissued_alert('REISSUED_CREDIT_SETTLE_REVIEW', v_request.id, v_order.id, v_source.id, false,
      jsonb_build_object('sources', v_sources, 'recovered', v_recovered, 'refund_amount', p_refund_amount));
  END IF;
  -- [9번] 끝

  RETURN jsonb_build_object(
    'already_completed', false,
    'new_balance', v_new_balance,
    'recovered_credits', v_recovered,
    'remaining_credits', v_remaining_after,
    'user_id', v_request.user_id
  );
END;
$function$;

-- 6-alloc. 자료 환불 배정(⓪)
CREATE OR REPLACE FUNCTION public.market_refund_allocate(p_order_id uuid, p_amount integer, p_exclude uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_order public.market_purchase_orders%ROWTYPE;
  v_src record;
  v_source public.credit_sources%ROWTYPE;
  v_items jsonb := '[]'::jsonb;
  v_left integer := p_amount;
  v_take integer;
  v_cap integer;
  v_restore integer;
  v_restored integer := 0;
  v_reissued integer := 0;
  v_unrecovered integer := 0;
  v_needs_owner boolean := false;
  v_in_progress boolean := false;
  v_flags jsonb := '[]'::jsonb;
  v_po uuid;
  v_has_cash boolean;
  v_open boolean;
  v_marker boolean;
  v_reason text;
  v_purchase_left interval;
  -- [9번] 시작
  v_root record;
  v_root_flag boolean;
  v_root_progress boolean;
  v_root_id uuid;
  -- [9번] 끝
BEGIN
  SELECT * INTO v_order FROM public.market_purchase_orders WHERE id = p_order_id;
  IF NOT FOUND OR p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('code', 'INVALID');
  END IF;

  FOR v_src IN
    WITH cons AS (
      SELECT NULLIF(COALESCE(e ->> 'source_id', e ->> 'sourceId'), '')::uuid AS source_id,
             COALESCE((e ->> 'amount')::integer, 0) AS amount, ord
        FROM jsonb_array_elements(COALESCE(v_order.credit_consumptions, '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)
    ), grouped AS (
      SELECT source_id, sum(amount)::integer AS consumed, min(ord) AS first_ord
        FROM cons WHERE source_id IS NOT NULL AND amount > 0 GROUP BY source_id
    ), prior AS (
      SELECT (x ->> 'source_id')::uuid AS source_id, sum(COALESCE((x ->> 'taken')::integer, 0))::integer AS taken
        FROM public.market_refund_requests r, jsonb_array_elements(COALESCE(r.allocated_items, '[]'::jsonb)) x
       WHERE r.order_id = p_order_id AND r.status = 'approved' AND x ? 'source_id' AND (x ->> 'source_id') IS NOT NULL
       GROUP BY 1
    )
    SELECT g.source_id, GREATEST(g.consumed - COALESCE(p.taken, 0), 0) AS remaining_consumed, g.first_ord
      FROM grouped g LEFT JOIN prior p ON p.source_id = g.source_id
     ORDER BY g.first_ord DESC
  LOOP
    CONTINUE WHEN v_src.remaining_consumed <= 0 OR v_src.source_id = ANY (COALESCE(p_exclude, '{}'));

    SELECT * INTO v_source FROM public.credit_sources WHERE id = v_src.source_id AND user_id = v_order.user_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CREDIT_REFUND_SOURCE_NOT_FOUND';
    END IF;

    v_po := COALESCE(v_source.payment_order_id,
                     (SELECT rr.payment_order_id FROM public.refund_requests rr WHERE rr.source_id = v_source.id
                       AND rr.payment_order_id IS NOT NULL ORDER BY rr.created_at LIMIT 1));
    v_has_cash := EXISTS (SELECT 1 FROM public.refund_requests rr WHERE rr.source_id = v_source.id AND rr.status = 'completed');
    v_open := EXISTS (SELECT 1 FROM public.refund_requests rr WHERE rr.source_id = v_source.id
                       AND rr.status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review'));
    v_marker := v_po IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.payment_provider_transactions t
       WHERE t.payment_order_id = v_po
         AND ((t.cancel_feedback_recorded_at IS NOT NULL AND t.cancel_processed_at IS NULL)
           OR (t.partial_cancel_feedback_recorded_at IS NOT NULL AND t.partial_cancel_processed_at IS NULL)));

    -- [9번] 시작
-- [9번 원래]     IF v_has_cash OR v_open OR v_marker OR v_source.status <> 'active' THEN
    -- 다시 지급한 크레딧이면 뿌리(원래 충전) 원천의 현금 환불·취소 상태도 본다(취소된 결제에서 비롯한 크레딧이 자동으로 다시 채워지지 않게).
    v_root_flag := false;
    v_root_progress := false;
    v_root_id := NULL;
    IF v_source.source_category = 'system_refund' THEN
      SELECT * INTO v_root FROM public.credit_source_paid_root(v_source.id);
      IF v_root.root_source_id IS NOT NULL AND (v_root.root_cash_flag OR v_root.root_status <> 'active') THEN
        v_root_flag := true;
        v_root_id := v_root.root_source_id;
        v_root_progress := v_root.root_in_progress;
      END IF;
    END IF;
    IF v_has_cash OR v_open OR v_marker OR v_source.status <> 'active' OR v_root_flag THEN
    -- [9번] 끝
      v_needs_owner := true;
      -- [9번] 시작
-- [9번 원래]       IF v_open OR v_marker OR v_source.status = 'pending_refund' THEN
      IF v_open OR v_marker OR v_source.status = 'pending_refund' OR v_root_progress THEN
      -- [9번] 끝
        v_in_progress := true;
      END IF;
      v_flags := v_flags || jsonb_build_array(jsonb_build_object(
        'source_id', v_source.id, 'remaining_consumed', v_src.remaining_consumed, 'status', v_source.status,
        -- [9번] 시작
-- [9번 원래]         'cash_refunded', v_has_cash, 'refund_open', v_open, 'cancel_marker', v_marker));
        'cash_refunded', v_has_cash, 'refund_open', v_open, 'cancel_marker', v_marker,
        'root_source_id', v_root_id, 'root_flag', v_root_flag, 'root_in_progress', v_root_progress));
        -- [9번] 끝
    END IF;
  END LOOP;

  IF v_needs_owner THEN
    RETURN jsonb_build_object('code', 'NEEDS_OWNER', 'in_progress', v_in_progress, 'owner_sources', v_flags);
  END IF;

  FOR v_src IN
    WITH cons AS (
      SELECT NULLIF(COALESCE(e ->> 'source_id', e ->> 'sourceId'), '')::uuid AS source_id,
             COALESCE((e ->> 'amount')::integer, 0) AS amount, ord
        FROM jsonb_array_elements(COALESCE(v_order.credit_consumptions, '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)
    ), grouped AS (
      SELECT source_id, sum(amount)::integer AS consumed, min(ord) AS first_ord
        FROM cons WHERE source_id IS NOT NULL AND amount > 0 GROUP BY source_id
    ), prior AS (
      SELECT (x ->> 'source_id')::uuid AS source_id, sum(COALESCE((x ->> 'taken')::integer, 0))::integer AS taken
        FROM public.market_refund_requests r, jsonb_array_elements(COALESCE(r.allocated_items, '[]'::jsonb)) x
       WHERE r.order_id = p_order_id AND r.status = 'approved' AND (x ->> 'source_id') IS NOT NULL
       GROUP BY 1
    )
    SELECT g.source_id, GREATEST(g.consumed - COALESCE(p.taken, 0), 0) AS remaining_consumed, g.first_ord
      FROM grouped g LEFT JOIN prior p ON p.source_id = g.source_id
     ORDER BY g.first_ord DESC
  LOOP
    EXIT WHEN v_left <= 0;
    CONTINUE WHEN v_src.remaining_consumed <= 0 OR v_src.source_id = ANY (COALESCE(p_exclude, '{}'));
    SELECT * INTO v_source FROM public.credit_sources WHERE id = v_src.source_id FOR UPDATE;
    v_take := LEAST(v_src.remaining_consumed, v_left);
    v_purchase_left := CASE WHEN v_source.expires_at IS NULL THEN NULL ELSE v_source.expires_at - v_order.created_at END;

    IF v_source.expires_at IS NULL
       OR (v_source.expires_at > v_now AND v_source.expires_at - v_now >= LEAST(v_purchase_left, interval '30 days')) THEN
      v_cap := GREATEST(v_source.initial_credits - v_source.remaining_credits, 0);
      v_restore := LEAST(v_take, v_cap);
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'source_id', v_source.id, 'taken', v_take, 'restored', v_restore, 'reissued', 0,
        'unrecovered', v_take - v_restore, 'reason', CASE WHEN v_take > v_restore THEN 'capped' END));
      v_restored := v_restored + v_restore;
      v_unrecovered := v_unrecovered + (v_take - v_restore);
    ELSE
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'source_id', v_source.id, 'taken', v_take, 'restored', 0, 'reissued', v_take, 'unrecovered', 0,
        'reason', NULL,
        'reissued_expires_at', v_now + GREATEST(v_purchase_left, interval '1 day')));
      v_reissued := v_reissued + v_take;
    END IF;
    v_left := v_left - v_take;
  END LOOP;

  IF v_left > 0 THEN
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'source_id', NULL, 'taken', v_left, 'restored', 0, 'reissued', 0, 'unrecovered', v_left, 'reason', 'unmatched'));
    v_unrecovered := v_unrecovered + v_left;
  END IF;

  RETURN jsonb_build_object('code', 'OK', 'items', v_items, 'requested', p_amount,
    'restored', v_restored, 'reissued', v_reissued, 'unrecovered', v_unrecovered,
    'restorable', v_restored + v_reissued);
END;
$function$;

-- 7. 권한 -------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.point_charge_refund_days() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.point_charge_refund_deadline(timestamptz, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.credit_source_reissued_descendants(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.credit_source_paid_root(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.point_charge_hold_reissued(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.point_charge_reissued_alert(text, uuid, uuid, uuid, boolean, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_point_charge_checkout_acks_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_point_charge_checkout_ack(uuid, uuid, uuid, integer, integer, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_manual_refund_recovery_preview(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_point_charge_checkout_ack(uuid, uuid, uuid, integer, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_manual_refund_recovery_preview(uuid) TO service_role;

-- 8. VERIFY -----------------------------------------------------------------------------------------------------
DO $verify_point_charge_policy$
DECLARE
  v_value jsonb;
  v_items jsonb;
  v_part text;
  v_text text;
  v_count integer;
  v_acl text;
  v_sig text;
  v_new text[][] := ARRAY[
    ARRAY['public.get_point_charge_refund_eligibility(uuid,uuid)', '60fc28afe44e7be776c189265e87b6ec'],
    ARRAY['public.quarantine_external_provider_cancellation(uuid,text,timestamp with time zone,text)', '1836e0a7859ff7e49bd3af0693655a30'],
    ARRAY['public.quarantine_payapp_partial_cancellation(uuid)', '1b5587b64788d8b7ac8be0c5d5fcd2be'],
    ARRAY['public.process_payapp_cancellation(uuid)', 'f45eed1de563b453dc2330e520744f06'],
    ARRAY['public.complete_manual_point_charge_refund(uuid,uuid,text,text,integer,integer)', '97967251a6478441c18e748ba322a00c'],
    ARRAY['public.market_refund_allocate(uuid,integer,uuid[])', '5987e703f9e4be0410f44a97e0cff826']
  ];
  i integer;
BEGIN
  -- 8-1. 설정 모양
  SELECT value INTO v_value FROM public.system_settings WHERE key = 'point_charge_policy';
  v_items := v_value -> 'checkoutItems';
  IF v_value IS NULL OR jsonb_typeof(v_value -> 'version') IS DISTINCT FROM 'number' OR (v_value ->> 'version')::numeric < 1
     OR public.point_charge_refund_days() IS NULL OR public.point_charge_refund_days() > 365
     OR jsonb_typeof(v_items) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_value -> 'refundRequestConfirm') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_value -> 'refundBlockReasons') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'VERIFY: point_charge_policy shape';
  END IF;
  FOREACH v_part IN ARRAY ARRAY[v_value ->> 'checkoutTitle', v_items ->> 'product', v_items ->> 'validity', v_items ->> 'refund',
                                v_items ->> 'restriction', v_items ->> 'otherCases', v_value ->> 'minorNotice', v_value ->> 'agreeLabel'] LOOP
    IF v_part IS NULL OR v_part !~ '\S' OR replace(v_part, '{충전환불기간}', '') ~ '[{}]' THEN
      RAISE EXCEPTION 'VERIFY: point_charge_policy notice parts';
    END IF;
  END LOOP;
  IF strpos(v_items ->> 'refund', '{충전환불기간}') = 0 THEN
    RAISE EXCEPTION 'VERIFY: refund item placeholder';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings'
                  AND policyname = 'system_settings_point_charge_policy_no_client_write' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'VERIFY: no_client_write policy';
  END IF;

  -- 8-2. 열·표
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'refund_requests'
                  AND column_name = 'held_reissued_source_ids') THEN
    RAISE EXCEPTION 'VERIFY: held_reissued_source_ids';
  END IF;
  SELECT string_agg(format('%s:%s', grantee, privilege_type), ', ') INTO v_text
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'point_charge_checkout_acks'
     AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
     AND NOT (grantee = 'service_role' AND privilege_type = 'SELECT');
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: acks grants: %', v_text;
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.point_charge_checkout_acks'::regclass) THEN
    RAISE EXCEPTION 'VERIFY: acks RLS';
  END IF;
  SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public' AND tablename = 'point_charge_checkout_acks';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'VERIFY: acks policies = %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM pg_trigger WHERE tgrelid = 'public.point_charge_checkout_acks'::regclass AND NOT tgisinternal;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'VERIFY: acks triggers = %', v_count;
  END IF;

  -- 8-3. (3a) PUBLIC/anon 이 실행할 수 있는 SECURITY DEFINER 함수는 handle_new_user 뿐
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_text
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.prosecdef
     AND (p.proacl IS NULL OR p.proacl::text ~ '(\{|,)(=|anon=)X')
     AND p.proname <> 'handle_new_user';
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: public/anon executable definer functions: %', v_text;
  END IF;

  -- 8-4. 함수 ACL·정의자
  FOREACH v_sig IN ARRAY ARRAY['public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)',
                               'public.get_manual_refund_recovery_preview(uuid)'] LOOP
    SELECT p.proacl::text INTO v_acl FROM pg_proc p WHERE p.oid = v_sig::regprocedure;
    IF v_acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
      RAISE EXCEPTION 'VERIFY: service acl % = %', v_sig, v_acl;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_sig::regprocedure AND p.prosecdef
                    AND p.proconfig = ARRAY['search_path=public, pg_temp']) THEN
      RAISE EXCEPTION 'VERIFY: definer/search_path %', v_sig;
    END IF;
  END LOOP;
  FOREACH v_sig IN ARRAY ARRAY['public.point_charge_refund_days()', 'public.point_charge_refund_deadline(timestamp with time zone,integer)',
                               'public.credit_source_reissued_descendants(uuid)', 'public.credit_source_paid_root(uuid)',
                               'public.point_charge_hold_reissued(uuid,uuid)', 'public.point_charge_reissued_alert(text,uuid,uuid,uuid,boolean,jsonb)',
                               'public.guard_point_charge_checkout_acks_mutation()'] LOOP
    SELECT p.proacl::text INTO v_acl FROM pg_proc p WHERE p.oid = v_sig::regprocedure;
    IF v_acl IS DISTINCT FROM '{postgres=X/postgres}' THEN
      RAISE EXCEPTION 'VERIFY: internal acl % = %', v_sig, v_acl;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_sig::regprocedure AND p.prosecdef) THEN
      RAISE EXCEPTION 'VERIFY: internal must not be definer %', v_sig;
    END IF;
  END LOOP;

  -- 8-5. 재정의 함수 새 지문
  FOR i IN 1 .. array_length(v_new, 1) LOOP
    IF v_new[i][1] <> '' AND md5(pg_get_functiondef(v_new[i][1]::regprocedure)) <> v_new[i][2] THEN
      RAISE EXCEPTION 'VERIFY: redefined md5 %', v_new[i][1];
    END IF;
  END LOOP;

  -- 8-6. 마감식: 2026-11-23 23:30 KST 결제·7일 → 2026-12-01 00:00 KST, 지급 지연(11-01 결제·11-05 지급) → 11-13 00:00 KST
  IF public.point_charge_refund_deadline('2026-11-23 23:30:00+09'::timestamptz, 7) <> '2026-12-01 00:00:00+09'::timestamptz
     OR public.point_charge_refund_deadline(GREATEST('2026-11-01 10:00:00+09'::timestamptz, '2026-11-05 09:00:00+09'::timestamptz), 7)
        <> '2026-11-13 00:00:00+09'::timestamptz THEN
    RAISE EXCEPTION 'VERIFY: deadline';
  END IF;
END;
$verify_point_charge_policy$;

NOTIFY pgrst, 'reload schema';
