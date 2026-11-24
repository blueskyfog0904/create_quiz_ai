-- 10번 묶음 리허설: BEGIN … 마이그레이션 → T13 되돌리기(down_b → down_a → 재적용) → T1~T15·가드 시험 … ROLLBACK. 운영 DB 에 아무것도 남기지 않는다.
-- 실행: supabase db query --remote --yes --file supabase/scripts/20261126_bundle10_rehearsal.sql (COMMIT 없음, 마지막 SELECT 가 시험 로그)
BEGIN;
-- 리허설 도우미(거래 안에서만 사는 임시 표·임시 함수). 실패는 RAISE EXCEPTION 'RH FAIL …', 성공은 RAISE NOTICE + 로그 행.
CREATE TEMP TABLE _rh_log (n serial PRIMARY KEY, test text NOT NULL, msg text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE _rh_ctx (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON _rh_log, _rh_ctx TO PUBLIC;
GRANT ALL ON SEQUENCE _rh_log_n_seq TO PUBLIC;

CREATE FUNCTION pg_temp.ok(p_test text, p_msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO _rh_log (test, msg) VALUES (p_test, p_msg);
  RAISE NOTICE '[%] %', p_test, p_msg;
END $f$;

CREATE FUNCTION pg_temp.check(p_cond boolean, p_test text, p_msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_cond IS NOT TRUE THEN
    RAISE EXCEPTION 'RH FAIL [%] %', p_test, p_msg;
  END IF;
  PERFORM pg_temp.ok(p_test, p_msg);
END $f$;

-- 결과 문자열이 기대 접두어로 시작하는지('OK …' 또는 'ERR 코드…')
CREATE FUNCTION pg_temp.expect(p_actual text, p_prefix text, p_test text, p_msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_actual IS NULL OR p_actual NOT LIKE p_prefix || '%' THEN
    RAISE EXCEPTION 'RH FAIL [%] % — 기대 "%", 실제 "%"', p_test, p_msg, p_prefix, left(COALESCE(p_actual, 'NULL'), 600);
  END IF;
  PERFORM pg_temp.ok(p_test, p_msg || ' → ' || left(p_actual, 160));
END $f$;

CREATE FUNCTION pg_temp.ctx_set(p_k text, p_v text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO _rh_ctx (k, v) VALUES (p_k, p_v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v
$f$;
CREATE FUNCTION pg_temp.ctx(p_k text) RETURNS text LANGUAGE sql AS $f$ SELECT v FROM _rh_ctx WHERE k = p_k $f$;

-- 동적 SQL 을 실행하고 'OK' 또는 'ERR 메시지'를 돌려준다(실패하면 그 문장의 변경은 되돌려진다).
CREATE FUNCTION pg_temp.try_sql(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v_n integer;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN 'OK rows=' || v_n;
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR ' || SQLERRM || ' [' || SQLSTATE || ']';
END $f$;

CREATE FUNCTION pg_temp.try_anon(p_actor uuid, p_user uuid, p_method text, p_request uuid, p_expected integer, p_notice text,
  p_confirmed boolean, p_reason text, p_key text, p_retention boolean, p_pending boolean) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  RETURN 'OK ' || public.anonymize_member(p_actor, p_user, p_method, p_request, p_expected, p_notice, p_confirmed, p_reason, p_key,
                                           p_retention, p_pending)::text;
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR ' || SQLERRM;
END $f$;

-- 스스로 익명화: 지금 고지 원문·잔액으로 요청
CREATE FUNCTION pg_temp.try_self(p_user uuid, p_retention boolean, p_key text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v_notice jsonb;
BEGIN
  v_notice := public.get_member_withdrawal_notice(p_user, 'self', p_retention);
  RETURN pg_temp.try_anon(p_user, p_user, 'self', NULL, (v_notice ->> 'expectedBalance')::integer, v_notice ->> 'text',
                          false, NULL, p_key, p_retention, false);
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR ' || SQLERRM;
END $f$;

-- 탈퇴 요청: 지금 고지 원문·잔액으로 요청(대표 기록이면 p_recorded_by 에 대표)
CREATE FUNCTION pg_temp.try_request(p_user uuid, p_channel text, p_recorded_by uuid, p_retention boolean DEFAULT NULL,
  p_kind text DEFAULT 'self', p_note text DEFAULT NULL, p_sent timestamptz DEFAULT NULL, p_reply timestamptz DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v_notice jsonb;
BEGIN
  v_notice := public.get_member_withdrawal_notice(p_user, 'request', p_retention);
  RETURN 'OK ' || public.create_member_withdrawal_request(p_user, p_channel, v_notice ->> 'text', v_notice ->> 'sha256',
    (v_notice ->> 'expectedBalance')::integer, (v_notice ->> 'expectedForfeitPaid')::integer, (v_notice ->> 'expectedForfeitFree')::integer,
    p_note, p_recorded_by, p_retention, p_kind, NULL, p_sent, p_reply)::text;
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR ' || SQLERRM;
END $f$;

CREATE FUNCTION pg_temp.req_id(p_result text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT (substr(p_result, 4)::jsonb ->> 'requestId')::uuid
$f$;
CREATE FUNCTION pg_temp.res(p_result text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT substr(p_result, 4)::jsonb
$f$;

-- 시험 회원: auth.users INSERT → handle_new_user 트리거가 profiles 를 만든다.
CREATE FUNCTION pg_temp.new_user(p_tag text, p_provider text DEFAULT 'email', p_kakao_completed boolean DEFAULT true) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
          'rh10.' || p_tag || '.' || left(v_id::text, 8) || '@example.invalid', '', now(),
          jsonb_build_object('provider', p_provider),
          jsonb_build_object('phone', '010-9' || lpad((floor(random() * 999))::int::text, 3, '0') || '-' || lpad((floor(random() * 9999))::int::text, 4, '0'),
                             'kakao_id', CASE WHEN p_provider = 'kakao' THEN 'rhk' || replace(left(v_id::text, 13), '-', '') END),
          now() - interval '90 days', now());
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_id) THEN
    RAISE EXCEPTION 'RH FAIL handle_new_user 가 프로필을 만들지 않음';
  END IF;
  IF p_provider = 'kakao' AND p_kakao_completed THEN
    UPDATE public.profiles SET signup_completed = true WHERE id = v_id;
  END IF;
  RETURN v_id;
END $f$;

-- 필수 항목 동의 + 마케팅 선택
CREATE FUNCTION pg_temp.consent_all(p_user uuid, p_marketing boolean) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM public.consent_record_internal(p_user,
    (SELECT jsonb_agg(jsonb_build_object('item_id', i.id, 'version', i.version,
                                         'agreed', CASE WHEN i.required THEN true ELSE p_marketing END))
       FROM public.signup_consent_items i WHERE i.is_active), 'consent_gate');
END $f$;

CREATE FUNCTION pg_temp.marketing_set(p_user uuid, p_agreed boolean) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM public.consent_record_internal(p_user,
    (SELECT jsonb_build_array(jsonb_build_object('item_id', i.id, 'version', i.version, 'agreed', p_agreed))
       FROM public.signup_consent_items i WHERE i.key = 'marketing'), 'mypage');
END $f$;

CREATE FUNCTION pg_temp.marketing_latest(p_user uuid) RETURNS text LANGUAGE sql AS $f$
  SELECT c.agreed::text || ':' || c.source FROM public.user_consents c JOIN public.signup_consent_items i ON i.id = c.item_id
   WHERE c.user_id = p_user AND i.key = 'marketing' ORDER BY c.seq DESC LIMIT 1
$f$;

CREATE FUNCTION pg_temp.mul() RETURNS text LANGUAGE sql AS $f$ SELECT 'RH10' || substr(md5(random()::text || clock_timestamp()::text), 1, 12) $f$;

-- 페이앱 주문 + 결제 시도 + 결제 기록 행(같은 시각 p_created)
CREATE FUNCTION pg_temp.new_order(p_user uuid, p_status text, p_created timestamptz DEFAULT now(), p_mul text DEFAULT NULL,
  p_amount integer DEFAULT 9900, p_credits integer DEFAULT 10000, p_attempt_status text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_attempt uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_mid text;
  v_plan uuid;
BEGIN
  SELECT payapp_merchant_id INTO v_mid FROM public.payment_runtime_config WHERE id = true;
  SELECT id INTO v_plan FROM public.pricing_plans WHERE is_active ORDER BY price LIMIT 1;
  INSERT INTO public.checkout_attempts (id, user_id, checkout_attempt_id, claimed_provider, plan_id, request_fingerprint, status,
                                        expires_at, created_at, updated_at)
  VALUES (v_attempt, p_user, gen_random_uuid(), 'payapp', v_plan, 'rhfp-' || v_order,
          COALESCE(p_attempt_status, CASE WHEN p_status IN ('completed') THEN 'completed' ELSE 'claimed' END),
          p_created + interval '30 minutes', p_created, p_created);
  INSERT INTO public.payment_orders (id, user_id, order_id, plan_id, plan_name_snapshot, expected_amount, expected_credits, provider,
    environment, provider_environment, provider_merchant_id, partner_order_id, tax_free_amount, vat_amount, status, request_fingerprint,
    checkout_attempt_id, confirm_idempotency_key, cancel_idempotency_key, expires_at, checkout_expires_at, ready_requested_at,
    ready_expires_at, payment_method_code, created_at, updated_at)
  VALUES (v_order, p_user, 'RH10' || replace(v_order::text, '-', ''), v_plan, 'RH10 시험 충전', p_amount, p_credits, 'payapp',
    'live', 'live', v_mid, 'RH10' || replace(v_order::text, '-', ''), 0, round(p_amount::numeric / 11)::integer, p_status, 'rhfp-' || v_order,
    v_attempt, 'rhc-' || v_order, 'rhx-' || v_order, p_created + interval '30 minutes', p_created + interval '30 minutes', p_created,
    p_created + interval '30 minutes', 'card', p_created, p_created);
  UPDATE public.checkout_attempts SET payment_order_id = v_order WHERE id = v_attempt;
  INSERT INTO public.payment_provider_transactions (payment_order_id, provider, provider_merchant_id, provider_transaction_id, created_at, updated_at)
  VALUES (v_order, 'payapp', v_mid, p_mul, p_created, p_created);
  RETURN v_order;
END $f$;

-- 결제완료 통보 기록 + 실제 지급 함수로 크레딧 지급(p_days 일 전). {order_id, source_id, mul_no}
CREATE FUNCTION pg_temp.paid(p_user uuid, p_days numeric, p_amount integer DEFAULT 9900, p_credits integer DEFAULT 10000) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_at timestamptz := now() - make_interval(secs => (p_days * 86400)::double precision);
  v_mul text := pg_temp.mul();
  v_order uuid;
  v_res jsonb;
BEGIN
  v_order := pg_temp.new_order(p_user, 'fulfillment_pending', v_at, v_mul, p_amount, p_credits);
  UPDATE public.payment_provider_transactions
     SET paid_feedback_recorded_at = v_at, provider_paid_at = v_at, paid_amount = p_amount, provider_status = '4', payment_method_type = '1'
   WHERE payment_order_id = v_order;
  v_res := public.payapp_fulfill_order_internal(v_order, v_at);
  IF v_res ? 'held' OR v_res ->> 'source_id' IS NULL THEN
    RAISE EXCEPTION 'RH FAIL 시험 지급 실패 %', v_res;
  END IF;
  UPDATE public.credit_sources SET created_at = v_at, purchased_at = v_at WHERE id = (v_res ->> 'source_id')::uuid;
  RETURN jsonb_build_object('order_id', v_order, 'source_id', v_res ->> 'source_id', 'mul_no', v_mul);
END $f$;

CREATE FUNCTION pg_temp.new_ticket(p_user uuid, p_subject text, p_message text, p_status text, p_slug text,
  p_created timestamptz DEFAULT now(), p_response text DEFAULT NULL, p_responded timestamptz DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_cat public.support_ticket_categories%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO v_cat FROM public.support_ticket_categories WHERE slug = p_slug;
  INSERT INTO public.support_tickets (user_id, subject, message, status, category_id, category_snapshot, created_at, updated_at,
                                      admin_response, responded_at)
  VALUES (p_user, p_subject, p_message, p_status, v_cat.id, jsonb_build_object('id', v_cat.id, 'slug', v_cat.slug, 'name', v_cat.name),
          p_created, p_created, p_response, p_responded)
  RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

-- 무상 크레딧(관리자 지급 함수)
CREATE FUNCTION pg_temp.grant_free(p_user uuid, p_amount integer) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM public.grant_admin_credits(pg_temp.ctx('owner')::uuid, p_user, p_amount, 'admin_grant', 'RH10 시험 지급', '{}'::jsonb,
                                     'rh10-grant-' || gen_random_uuid());
END $f$;

-- 크레딧 사용 흉내(원천 잔량과 프로필 잔액을 줄인다)
CREATE FUNCTION pg_temp.use_credits(p_source uuid, p_amount integer) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_user uuid;
BEGIN
  UPDATE public.credit_sources SET remaining_credits = remaining_credits - p_amount WHERE id = p_source RETURNING user_id INTO v_user;
  UPDATE public.profiles SET credits = credits - p_amount WHERE id = v_user;
END $f$;

CREATE FUNCTION pg_temp.market_item() RETURNS record LANGUAGE sql AS $f$
  SELECT f.id AS file_id, f.item_id, i.workspace_subject FROM public.market_item_files f JOIN public.market_items i ON i.id = f.item_id LIMIT 1
$f$;

-- 자료 주문(+이용 권한·다운로드 기록·구매 고지 동의)
CREATE FUNCTION pg_temp.market_order(p_user uuid, p_with_download boolean DEFAULT true) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_file uuid;
  v_item uuid;
  v_subject text;
  v_order uuid;
BEGIN
  SELECT f.id, f.item_id, i.workspace_subject INTO v_file, v_item, v_subject
    FROM public.market_item_files f JOIN public.market_items i ON i.id = f.item_id LIMIT 1;
  INSERT INTO public.market_purchase_orders (workspace_subject, user_id, item_id, purchase_type, original_price_credits, charged_credits, status)
  VALUES (v_subject, p_user, v_item, 'subproduct', 100, 100, 'completed') RETURNING id INTO v_order;
  INSERT INTO public.market_entitlements (workspace_subject, user_id, item_id, scope, source_order_id, status)
  VALUES (v_subject, p_user, v_item, 'item', v_order, 'active');
  INSERT INTO public.market_purchase_notice_acks (user_id, idempotency_key, notice_sha256, notice_text, refund_days)
  VALUES (p_user, gen_random_uuid(), repeat('a', 64), 'RH10 시험 구매 고지', 30);
  IF p_with_download THEN
    INSERT INTO public.market_download_events (user_id, item_id, file_id, asset_kind, ip_address, user_agent, workspace_subject, order_id)
    VALUES (p_user, v_item, v_file, 'pdf', '203.0.113.7', 'RH10 UA', v_subject, v_order);
  END IF;
  RETURN v_order;
END $f$;

-- ===== 마이그레이션 적용(1차) =====
-- 출시 전 작업 순서표 10번 묶음: 결제 회원 탈퇴(익명화)(계획 docs/plan-bundle10-member-withdrawal.md 5판, 확정 — 14절 구현 반영).
-- 만드는 것:
--   1. system_settings 'member_withdrawal_policy'(보존 기간·스스로 익명화 스위치(처음엔 꺼짐)·고지와 화면 문구 texts).
--      RESTRICTIVE FOR UPDATE 정책으로 화면 세션 직접 수정을 막는다.
--   2. 칸: profiles.withdrawn_at, support_tickets·support_ticket_revisions·refund_requests·market_refund_requests.redaction_reviewed_at.
--      CHECK: credit_transactions.type 'withdrawal_forfeit', user_consents.source 'withdrawal', payment_admin_actions.action 'withdrawn_held_order_closed'.
--   3. 표: member_withdrawal_requests(탈퇴 요청), withdrawn_member_records(보관함), withdrawn_member_record_events(추가 기록) — 모두 가드 트리거.
--      보관함·추가 기록은 service_role 도 읽지 못한다(읽기는 열람 기록을 남기는 read_withdrawn_member_record·read_withdrawn_member_ticket 로만).
--   4. 탈퇴 회원 쓰기 막기 트리거(문의·수정 이력·문제·지문·문제지·문제지 문항), 조회 기록 user_id 지우기, 크레딧 원천 늘리기 거절,
--      알림 버리기, 충전 환불 완료 → 보관함 추가 기록. RESTRICTIVE RLS 4개(탈퇴 회원 문의·환불 기록은 화면 세션에서 안 보임).
--   5. 내부 함수: member_withdrawal_policy, member_withdrawal_policy_days, member_text_has_long_number, point_charge_cash_value,
--      member_withdrawal_facts, member_withdrawal_notice_text, member_admin_event_owner, member_withdrawal_scrub_admin_events,
--      member_withdrawal_require_owner (모두 ACL postgres 만).
--   6. 재정의 20개(원래 정의에 [10번] 표시 구역만 더함, 원래 줄은 '-- [10번 원래]' 주석으로 보존): 계획 5-5 표.
--   7. service_role 함수: get_member_withdrawal_preview, get_member_withdrawal_notice, create_member_withdrawal_request,
--      record_member_withdrawal_request_reply, cancel_member_withdrawal_request, anonymize_member, redact_member_text,
--      mark_member_text_reviewed, close_withdrawn_member_held_order, add_withdrawn_member_event, mark_withdrawn_member_auth_scrubbed,
--      withdrawn_member_kakao_unlink_target, clear_withdrawn_member_kakao_unlink, read_withdrawn_member_record,
--      read_withdrawn_member_ticket, scrub_member_admin_events, withdrawn_member_account_status, resolve_member_full_delete_auth_alert,
--      withdrawn_member_held_order_ids.
-- 함수 지문은 md5(pg_get_functiondef(oid)) — 9번과 같은 측정. 사전 값이 다르면 멈춘다.
-- 순서: DB 적용 → 타입 재생성·코드 배포 → 같은 작업 창에서 약관·처리방침 문구 스크립트 → selfAnonymizeEnabled 켜기 → 시험 계정 확인.
--   DB 적용부터 코드 배포까지는 옛 코드가 돈다(결제 회원 409, 비결제 완전 삭제). 적용 직후와 문구 적용 뒤에 탈퇴 0건을 확인한다.
-- 되돌리기: 코드를 10번 이전으로 되돌려 배포 → supabase/rollback/20261126100000_member_withdrawal_down_b.sql → _down_a.sql.
--   10번 코드가 돌고 있으면 down_a 를 하지 않는다. 다시 적용하려면 같은 트랜잭션에서 schema_migrations 의 '20261126100000' 행을 지운 뒤
--   이 파일과 이력 INSERT 를 넣는다. 10번 적용 뒤에는 9번 down 을 하지 않는다.
-- 거래 로컬 설정 app.member_withdrawal_bypass(값 = 회원 id): 익명화·가림·이벤트 정리 함수가 켜고, 가드 트리거는 그 회원 행에만 예외를 둔다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
-- 적용 때 교착을 피하려고 이 파일이 강한 잠금을 받는 표를 맨 앞에서 정해진 순서(회원 → 설정 → 크레딧·동의·결제 기록 → 문의·환불 →
-- 트리거만 더하는 표)로 한 번에 잠근다. 칸·CHECK·정책을 바꾸는 표는 ACCESS EXCLUSIVE, 트리거만 더하는 표는 SHARE ROW EXCLUSIVE(읽기는 막지 않음).
-- 기다림은 lock_timeout(3초)까지만이고, 넘으면 거래 전체가 되돌려지므로 사용이 적은 시간에 다시 실행한다.
LOCK TABLE public.profiles, public.system_settings, public.credit_transactions, public.user_consents, public.payment_admin_actions,
           public.support_tickets, public.support_ticket_revisions, public.refund_requests, public.market_refund_requests
  IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.credit_sources, public.questions, public.passages, public.exam_papers, public.exam_paper_items,
           public.market_item_view_events, public.notifications
  IN SHARE ROW EXCLUSIVE MODE;

-- 0. 사전 점검 -------------------------------------------------------------------------------------------------
DO $precheck$
DECLARE
  v_sig text;
  v_md5 text;
  v_pairs text[][] := ARRAY[
    -- 재정의(원래 값 또는 10번 값 — 되돌린 뒤 재적용 허용)
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
    ARRAY['public.consent_eligible_member_count()', '56fcd7334482cb97b778c97ff8947e12'],
    -- 그대로여야 함
    ARRAY['public.credit_source_paid_root(uuid)', '8e2c5a70f1892764039711586ae74a4d'],
    ARRAY['public.get_point_charge_refund_eligibility(uuid,uuid)', '60fc28afe44e7be776c189265e87b6ec'],
    ARRAY['public.point_charge_refund_deadline(timestamp with time zone,integer)', 'a9756c29bf0bf6c5e819896715dcfcd0'],
    ARRAY['public.get_credit_balance_snapshot(uuid)', '1c30e49ad8edb7b767af6356bda2ef8d'],
    ARRAY['public.complete_manual_point_charge_refund(uuid,uuid,text,text,integer,integer)', '97967251a6478441c18e748ba322a00c'],
    ARRAY['public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)', 'a42b474d9d95753ffba5041acb0c1c77'],
    ARRAY['public.resolve_payment_alert(uuid,uuid,text)', '969fc4bd8c32160cc274162bc23854d3'],
    ARRAY['public.consent_items_error(jsonb,text)', '80d32d5a6b2105c7ba757dd605a64027'],
    ARRAY['public.consent_missing_required(uuid,jsonb)', '713ccf2fea8a7ca8d45b9b91612d440e'],
    ARRAY['public.record_payment_alert(text,text,text,jsonb)', '80ee3155bf958c47a908fba4b28935e1'],
    ARRAY['public.create_support_ticket(uuid,text,text)', '2cfac5696f3998a6fef4bc7e0617a4f6'],
    ARRAY['public.update_own_pending_support_ticket(uuid,uuid,text,text)', 'cb221135b63d2bcc590b7fa4d2a082b0'],
    ARRAY['public.soft_delete_own_support_ticket(uuid)', 'c8148308a1d4e14f2993cfb4c8397fc4'],
    ARRAY['public.create_random_bank_exam_paper(text,text,uuid,uuid,jsonb)', '5cb7986c2f183efe754583a2d220b0ad'],
    ARRAY['public.generate_member_display_tag()', '629b6fbf53f70cb9d1ec8fed4ebe8a3f']
  ];
  v_new text[][] := ARRAY[
    ARRAY['public.payapp_fulfill_order_internal(uuid,timestamp with time zone)', '657bbb07ae4b250a2697f21e2aa805e9'],
    ARRAY['public.apply_payapp_feedback(text,text,text,text,integer,integer,integer,integer,timestamp with time zone,timestamp with time zone)', '1859412411fc132dacfae4ca7a89eba4'],
    ARRAY['public.retry_payapp_fulfillment(uuid)', '93cde859327328f598e71059dcc04e6d'],
    ARRAY['public.resolve_payment_order_review(uuid,text,uuid,text,text,timestamp with time zone,text)', 'cbe116d85e140991d5993b5563296b37'],
    ARRAY['public.prepare_payment_order(uuid,uuid,text,uuid,text,text,integer,integer,text,text,text,text,text,timestamp with time zone,integer,integer,text,text)', '93e0bd5e41969f66f296f4353f3feeb9'],
    ARRAY['public.begin_payapp_request(uuid)', '679b4474c0dc42de11e5e9a14a7d1d4d'],
    ARRAY['public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)', 'be4403fd993c45d618950a5908a91591'],
    ARRAY['public.process_payapp_cancellation(uuid)', 'e0f752c7759626790a2afb86eab6aee6'],
    ARRAY['public.payapp_sales_resume_blockers()', 'edbb1eb553719198ffa9f9bc0d3aca4c'],
    ARRAY['public.enforce_payment_reconciliation_health()', 'e563ade9c072b09e26844b655e918755'],
    ARRAY['public.prevent_payment_order_snapshot_update()', '940bcad422d63c58e5d31c5756b0d473'],
    ARRAY['public.consent_record_internal(uuid,jsonb,text)', '61a9beb9d7f94cf6b0ed9b4518b52b44'],
    ARRAY['public.guard_user_consents_mutation()', '4ba21dab0a28e0c117bbead375a3fc8f'],
    ARRAY['public.guard_market_purchase_notice_acks_mutation()', '3959ac2b8139d0f81365df59ed67ef10'],
    ARRAY['public.prevent_admin_event_mutation()', 'f35f60e1461e49138635ffd4a11a27f9'],
    ARRAY['public.remind_unanswered_admin_work()', 'b950b1bfecc0ed4d470293508c0e2a60'],
    ARRAY['public.guard_support_ticket_revisions_mutation()', '1a8d96fc0bfe469e491b86c2f866e3bd'],
    ARRAY['public.cancel_incomplete_kakao_signup(uuid)', 'a83431d12c4686a0fbe57976a82038fe'],
    ARRAY['public.complete_kakao_signup_with_consents(uuid,jsonb,text,text,text,text)', 'a43e805089f08a12e22721168dbe962a'],
    ARRAY['public.consent_eligible_member_count()', '4b1c6999080f9bf6978be808997fd9ac']
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

-- 1. 탈퇴 정책 설정 ---------------------------------------------------------------------------------------------
-- 첫 적용에서만 넣는다(되돌린 뒤 재적용해도 그사이 고친 문구를 덮지 않음). selfAnonymizeEnabled 는 키가 없거나 true 가 아니면 꺼짐.
-- 기간(…Years·…Days)은 변호사 답에 따라 값만 바꾼다. 보관함에는 사건 기준 시각만 저장하고 만료일은 파기할 때 이 값으로 계산한다.
-- texts 자리표시: 고지 원문(texts.notice·noticeTitle·confirmLabel — 서버 member_withdrawal_notice_text 가 채움)은
--   {소멸크레딧} {유료소멸크레딧} {무상소멸크레딧} {유료원환산} {크레딧} {만료일} {원환산} {답변대기문의}
--   {결제문의보존기간} {환불문의보존기간} {비결제문의보존기간} {결제기록보존기간} {결제시도보존기간} {약관판}. 화면 문구(그 밖의 texts)는 코드가 {비결제문의보존기간}
--   {결제대기일}(selfWithdrawOrderQuietDays) {가능예정일}(막힘 해제 예정일)을 채운다.
INSERT INTO public.system_settings (key, value, description, updated_at)
VALUES (
  'member_withdrawal_policy',
  $json${
    "version": 1,
    "selfAnonymizeEnabled": false,
    "paymentRetentionYears": 5,
    "payerTicketRetentionYears": 3,
    "payerRefundTicketRetentionYears": 5,
    "nonPayerTicketRetentionYears": 3,
    "attemptRecordRetentionYears": 5,
    "withdrawalRecordRetentionYears": 5,
    "consentRecordRetentionYears": 5,
    "selfWithdrawOrderQuietDays": 7,
    "withdrawRefundDeadlineBufferDays": 3,
    "marketingConsentItemKey": "marketing",
    "termsConsentItemKey": "terms",
    "redactionRefundCategorySlugs": ["market_refund", "credit_refund"],
    "redactionAccountRequestKeywords": ["계좌"],
    "texts": {
      "noticeTitle": "회원 탈퇴 전에 꼭 확인해 주세요",
      "notice": {
        "downloads": "탈퇴하면 구매한 자료를 더 이상 내려받을 수 없습니다. 필요한 자료는 탈퇴 전에 내려받아 두세요.",
        "noCarryOver": "같은 이메일이나 카카오 계정으로 다시 가입해도 새 계정이 됩니다. 크레딧·구매 내역·문의 내역은 이어지지 않습니다.",
        "reviews": "작성한 후기와 추천은 모두 삭제됩니다.",
        "retainedPayer": "결제한 기록이 있어 탈퇴한 뒤에도 주문·결제·환불·크레딧·자료 구매 기록은 법에 따라 {결제기록보존기간}년 동안 보관한 뒤 파기합니다. 이메일·휴대폰 번호·카카오 이메일은 분쟁 처리, 법에 따른 환불 연락, 탈퇴·광고성 정보 수신 동의 철회 처리 결과 안내에만 쓰도록 분리해 함께 보관합니다.",
        "retainedAttemptOnly": "결제 시도 기록(주문 번호·금액·결제 진행 기록)은 개인정보를 지운 채 {결제시도보존기간}년 동안 보관한 뒤 파기합니다. 크레딧·자료 구매·동의 기록은 탈퇴와 함께 삭제합니다.",
        "ticketsPayer": "1:1 문의는 소비자 불만·분쟁 처리 기록으로 마지막 처리일부터 {결제문의보존기간}년(환불 신청과 연결된 문의는 {환불문의보존기간}년) 동안 분리해 보관한 뒤 파기합니다. 탈퇴하면 회원 화면에서는 사라집니다.",
        "ticketsKeep": "1:1 문의는 분쟁이 생겼을 때 확인하기 위해 마지막 처리일부터 {비결제문의보존기간}년 동안 분리해 보관한 뒤 파기합니다(보존에 동의함). 탈퇴하면 회원 화면에서는 사라집니다.",
        "ticketsDelete": "1:1 문의는 보존에 동의하지 않아 탈퇴와 함께 삭제됩니다.",
        "ticketsChoice": "1:1 문의 보존 여부는 회신으로 알려 주세요. 동의하면 분쟁 확인을 위해 마지막 처리일부터 {비결제문의보존기간}년 동안 분리해 보관하고, 동의하지 않거나 회신이 없으면 탈퇴와 함께 삭제합니다. 동의하지 않아도 불이익은 없습니다.",
        "pendingTickets": "답변을 기다리는 문의 {답변대기문의}건은 탈퇴와 함께 닫힙니다. 환불 요청은 탈퇴한 뒤에도 고객센터로 할 수 있습니다.",
        "pendingTicketsDelete": "답변을 기다리는 문의 {답변대기문의}건도 탈퇴와 함께 삭제됩니다. 환불 요청은 탈퇴한 뒤에도 고객센터로 할 수 있습니다.",
        "pendingTicketsChoice": "답변을 기다리는 문의 {답변대기문의}건은 보존에 동의하면 탈퇴와 함께 닫히고, 동의하지 않거나 회신이 없으면 함께 삭제됩니다. 환불 요청은 탈퇴한 뒤에도 고객센터로 할 수 있습니다.",
        "credits": "남은 크레딧 {소멸크레딧}크레딧(유료 {유료소멸크레딧}크레딧, 무상 {무상소멸크레딧}크레딧)은 탈퇴와 함께 사라지며 환불되지 않습니다. 유료 크레딧을 원으로 환산하면 {유료원환산}원입니다.",
        "creditsFreeOnly": "남은 무상 크레딧 {무상소멸크레딧}크레딧은 탈퇴와 함께 사라지며 환불되지 않습니다.",
        "creditsCashUnknown": "남은 크레딧 {소멸크레딧}크레딧(유료 {유료소멸크레딧}크레딧, 무상 {무상소멸크레딧}크레딧)은 탈퇴와 함께 사라지며 환불되지 않습니다. 유료 크레딧의 원 환산 금액은 결제 내역을 확인해 따로 안내합니다.",
        "creditLinePaid": "· 유료 {크레딧}크레딧 (만료 {만료일}, 원 환산 {원환산}원)",
        "creditLinePaidCashUnknown": "· 유료 {크레딧}크레딧 (만료 {만료일}, 원 환산 금액은 결제 내역을 확인해 따로 안내)",
        "creditLineFree": "· 무상 {크레딧}크레딧 (만료 {만료일})",
        "noExpiry": "기한 없음",
        "noCredits": "사라지는 크레딧은 없습니다.",
        "legalRefund": "미성년자 결제 취소, 자료 하자, 표시·광고와 다른 제공처럼 법에 따른 환불은 탈퇴한 뒤에도 고객센터로 요청할 수 있습니다. 이때는 원래 결제수단이나 계좌로 처리합니다.",
        "marketingSelf": "광고성 정보 수신 동의는 탈퇴와 함께 철회됩니다.",
        "marketingRequest": "광고성 정보 수신 동의는 탈퇴를 요청하는 순간 바로 철회되며, 요청을 취소해도 되돌리지 않습니다.",
        "useBeforeRequest": "남은 크레딧은 탈퇴 전에 쓸 수 있습니다. 요청한 뒤 처리 전에 크레딧을 쓰면 실제로 사라지는 크레딧이 줄어듭니다. 요청한 뒤 충전하면 다시 요청해야 합니다. 탈퇴는 요청일부터 10일 안에 처리합니다.",
        "irreversible": "탈퇴는 되돌릴 수 없습니다.",
        "termsVersion": "이 안내는 이용약관 {약관판}판을 기준으로 합니다."
      },
      "confirmLabel": "회원 탈퇴를 최종 확인합니다",
      "checks": {
        "forfeit": "위 크레딧이 사라지고 환불되지 않는 것에 동의합니다.",
        "records": "보존되는 기록과 삭제되는 기록 안내를 확인했습니다.",
        "irreversible": "탈퇴는 되돌릴 수 없음을 확인했습니다."
      },
      "ticketRetentionChoice": {
        "title": "1:1 문의 보존 선택",
        "purpose": "분쟁이 생겼을 때 확인하기 위해 1:1 문의(제목·내용·답변)를 마지막 처리일부터 {비결제문의보존기간}년 동안 분리해 보관합니다. 동의하지 않으면 문의도 함께 지우며, 동의하지 않아도 불이익은 없습니다.",
        "agree": "문의 {비결제문의보존기간}년 보존에 동의합니다",
        "disagree": "동의하지 않습니다 — 문의도 함께 지워 주세요"
      },
      "blockReasons": {
        "ADMIN": "관리자 계정은 이 화면에서 탈퇴할 수 없습니다.",
        "DISABLED": "지금은 탈퇴 신청을 받을 수 없습니다. 잠시 후 다시 이용해 주세요.",
        "IN_PROGRESS": "진행 중인 결제나 환불이 있어 지금은 탈퇴할 수 없습니다. 처리가 끝난 뒤 다시 시도해 주세요.",
        "REFUND_PERIOD_OPEN": "환불 기간이 남은 충전 건이 있어 지금은 탈퇴할 수 없습니다. 그 충전 건을 환불하거나 환불 기간이 지난 뒤({가능예정일}부터) 탈퇴할 수 있습니다.",
        "REFUND_PERIOD_BUFFER": "환불 기간이 끝난 뒤 며칠 동안은 휴일 연장 여부를 확인하느라 탈퇴가 막힐 수 있습니다. 마지막 날이 휴일이었다면 고객센터로 환불을 요청할 수 있습니다.",
        "PROVIDER_UNVERIFIED": "결제 결과를 확인해야 하는 주문이 있어 담당자가 확인한 뒤 탈퇴를 처리합니다.",
        "REDACTION_REQUIRED": "보관할 문의 기록을 담당자가 확인한 뒤 탈퇴를 처리합니다.",
        "RECENT_PAYMENT_ACTIVITY": "최근 결제 시도가 있어 {결제대기일}일이 지난 뒤({가능예정일}부터) 탈퇴할 수 있습니다.",
        "REQUEST_PENDING": "이미 접수된 탈퇴 요청이 있습니다.",
        "NOT_PAYER": "결제 이력이 없는 계정은 바로 탈퇴할 수 있습니다.",
        "CASH_VALUE_UNKNOWN": "결제 금액을 확인해야 하는 크레딧이 있어 담당자가 확인한 뒤 탈퇴를 처리합니다."
      },
      "reviewPendingNotice": "확인한 뒤 10일 안에 가입한 이메일로 안내해 드립니다.",
      "refundLinkLabel": "크레딧 화면에서 환불 신청",
      "marketingOnlyButton": "광고 수신 동의만 지금 철회",
      "marketingOnlyDone": "광고성 정보 수신 동의를 철회했습니다.",
      "objectionGuide": "처리 결과에 이의가 있으면 개인정보 처리방침에 적힌 개인정보 보호책임자나 고객센터로 알려 주세요.",
      "requestCreated": "탈퇴 요청이 접수되었습니다. 요청일부터 10일 안에 처리하고 가입한 이메일로 결과를 알려 드립니다.",
      "requestCanceled": "탈퇴 요청을 취소했습니다. 광고성 정보 수신 동의 철회는 되돌리지 않습니다.",
      "completionTitle": "회원 탈퇴가 완료되었습니다",
      "completionKept": "법에 따라 보관하는 기록(주문·결제·환불·크레딧·자료 구매 기록, 연락처, 1:1 문의)은 분리해 보관한 뒤 기간이 지나면 파기합니다.",
      "completionKeptNonPayer": "탈퇴 처리 기록(동의하신 안내 원문과 처리 일시)은 분리해 보관한 뒤 기간이 지나면 파기합니다. 크레딧·자료 구매·동의 기록은 삭제했습니다.",
      "completionKeptAttemptOnly": "결제 시도 기록은 개인정보를 지운 채 보관한 뒤 기간이 지나면 파기합니다.",
      "completionKeptTickets": "보존에 동의하신 1:1 문의는 마지막 처리일부터 {비결제문의보존기간}년 동안 분리해 보관한 뒤 파기합니다.",
      "completionDeleted": "회원 정보, 후기, 만든 문제·문제지·지문, 알림, 장바구니는 삭제했습니다.",
      "finishDeleteNotice": "탈퇴 처리가 끝나기 전에 멈췄습니다. 회원 정보는 이미 지웠고 로그인 계정 정리만 남았습니다. 이메일 주소를 입력하고 [탈퇴 마무리하기]를 눌러 주세요.",
      "finishDeleteButton": "탈퇴 마무리하기",
      "paymentReviewHeldOrder": "탈퇴한 회원의 보류 주문입니다. 여기서는 처리할 수 없고, 대표가 회원 상세에서 [보류 주문 닫기]로 정리합니다.",
      "identityNoteGuide": "본인 확인 메모에는 연락처나 신분증 내용을 적지 마세요(확인 방법과 결과만).",
      "reasonGuide": "사유에는 개인정보를 적지 마세요.",
      "ownerMailBlocked": "요청하신 회원 탈퇴는 아래 사유로 아직 처리하지 못했습니다. 처리할 수 있게 되는 날과 방법을 함께 안내드립니다. 이의가 있으면 개인정보 처리방침의 개인정보 보호책임자나 고객센터로 알려 주세요.",
      "ownerMailCompleted": "요청하신 회원 탈퇴를 처리했습니다. 광고성 정보 수신 동의 철회 결과(보낸 곳·철회 사실·처리 일시)도 함께 알려 드립니다.",
      "adminEventTitle": "탈퇴 회원 문의",
      "redactionMask": "[가림 처리됨]",
      "marketingResult": "광고성 정보 수신동의 철회",
      "forfeitDescription": "탈퇴로 소멸",
      "cleanupDescription": "탈퇴 정리",
      "alertAuthScrubPending": "탈퇴 회원의 로그인 계정 정리(소프트 삭제)가 끝나지 않았습니다. 회원 상세에서 [로그인 계정 정리 다시 시도]를 눌러 주세요.",
      "alertHeldOrderFeedbackMismatch": "탈퇴 회원 보류 주문에 검증되지 않는 페이앱 통보가 왔습니다. 주문 상태는 바꾸지 않았습니다. 페이앱 관리자 화면에서 그 거래를 확인해 주세요.",
      "alertClosedHeldOrderCancelFailed": "닫은 탈퇴 회원 보류 주문에 온 페이앱 취소 통보를 자동으로 처리하지 못했습니다. 주문은 닫힌 상태로 두었습니다. 돈을 더 보내지 말고 페이앱 관리자 화면에서 취소 금액을 확인한 뒤 경보를 해소해 주세요(런북 RB-11 10-7)."
    }
  }$json$::jsonb,
  '회원 탈퇴·익명화 정책(보존 기간·스스로 익명화 스위치·고지와 화면 문구). 고지 원문은 서버가 이 틀로 만든다. 화면 세션으로 고칠 수 없다(SQL 편집기·서버 키로만).',
  now()
)
ON CONFLICT (key) DO NOTHING;

DROP POLICY IF EXISTS system_settings_member_withdrawal_policy_no_client_write ON public.system_settings;
CREATE POLICY system_settings_member_withdrawal_policy_no_client_write
  ON public.system_settings
  AS RESTRICTIVE
  FOR UPDATE
  USING (key <> 'member_withdrawal_policy')
  WITH CHECK (key <> 'member_withdrawal_policy');

-- 2. 칸·CHECK ---------------------------------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS redaction_reviewed_at timestamptz;
ALTER TABLE public.support_ticket_revisions ADD COLUMN IF NOT EXISTS redaction_reviewed_at timestamptz;
-- 환불 사유·메모의 가림 확인 표시(계획 3절 '가림 확인 필요'의 환불 기록 — 확인함·가림을 남길 자리).
ALTER TABLE public.refund_requests ADD COLUMN IF NOT EXISTS redaction_reviewed_at timestamptz;
ALTER TABLE public.market_refund_requests ADD COLUMN IF NOT EXISTS redaction_reviewed_at timestamptz;

ALTER TABLE public.credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_type_check;
ALTER TABLE public.credit_transactions ADD CONSTRAINT credit_transactions_type_check
  CHECK ((type = ANY (ARRAY['purchase'::text, 'consume'::text, 'refund'::text, 'admin_grant'::text, 'bonus'::text, 'withdrawal_forfeit'::text])));
ALTER TABLE public.user_consents DROP CONSTRAINT IF EXISTS user_consents_source_check;
ALTER TABLE public.user_consents ADD CONSTRAINT user_consents_source_check
  CHECK ((source = ANY (ARRAY['email_signup'::text, 'kakao_signup'::text, 'consent_gate'::text, 'mypage'::text, 'withdrawal'::text])));
ALTER TABLE public.payment_admin_actions DROP CONSTRAINT IF EXISTS payment_admin_actions_action_check;
ALTER TABLE public.payment_admin_actions ADD CONSTRAINT payment_admin_actions_action_check
  CHECK ((action = ANY (ARRAY['paid_confirmed'::text, 'unpaid_confirmed'::text, 'cancel_handled'::text, 'manual_refund_completed'::text, 'manual_review_refund_rejected'::text, 'alert_resolved'::text, 'withdrawn_held_order_closed'::text])));

-- 3. 표 ---------------------------------------------------------------------------------------------------------
-- 3-1. 탈퇴 요청(추가만, 상태는 pending → completed|canceled, 회신 칸은 pending 동안 NULL → 값만)
CREATE TABLE IF NOT EXISTS public.member_withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  channel text NOT NULL,
  requester_kind text NOT NULL DEFAULT 'self',
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  notice_text text NOT NULL,
  notice_sha256 text NOT NULL,
  notice_sent_at timestamptz,
  consent_reply_received_at timestamptz,
  ticket_retention_agreed boolean,
  expected_balance integer NOT NULL,
  expected_forfeit_paid integer NOT NULL,
  expected_forfeit_free integer NOT NULL,
  marketing_withdrawn_at timestamptz,
  identity_note text,
  recorded_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT member_withdrawal_requests_channel_check CHECK (channel IN ('screen', 'email', 'phone')),
  CONSTRAINT member_withdrawal_requests_requester_check CHECK (requester_kind IN ('self', 'legal_guardian', 'agent')),
  CONSTRAINT member_withdrawal_requests_screen_self_check CHECK (channel <> 'screen' OR (requester_kind = 'self' AND recorded_by = user_id AND identity_note IS NULL)),
  CONSTRAINT member_withdrawal_requests_status_check CHECK (status IN ('pending', 'completed', 'canceled')),
  CONSTRAINT member_withdrawal_requests_sha_check CHECK (notice_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT member_withdrawal_requests_text_check CHECK (notice_text <> ''),
  CONSTRAINT member_withdrawal_requests_amount_check CHECK (expected_balance >= 0 AND expected_forfeit_paid >= 0 AND expected_forfeit_free >= 0
                                                            AND expected_balance = expected_forfeit_paid + expected_forfeit_free),
  CONSTRAINT member_withdrawal_requests_note_check CHECK (identity_note IS NULL OR length(identity_note) <= 500)
);
CREATE UNIQUE INDEX IF NOT EXISTS member_withdrawal_requests_one_pending ON public.member_withdrawal_requests (user_id) WHERE status = 'pending';

-- 3-2. 보관함(한 번에 INSERT, UPDATE 는 auth_scrubbed_at NULL→값·kakao_id_pending_unlink 값→NULL 만)
CREATE TABLE IF NOT EXISTS public.withdrawn_member_records (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE RESTRICT,
  operation_key text NOT NULL,
  withdrawn_at timestamptz NOT NULL,
  method text NOT NULL,
  actor_id uuid NOT NULL,
  request_id uuid REFERENCES public.member_withdrawal_requests(id) ON DELETE RESTRICT,
  reason text,
  consent_notice_text text,
  consent_notice_sha256 text,
  email text,
  phone text,
  kakao_email text,
  kakao_id_pending_unlink text,
  had_payment boolean NOT NULL,
  ticket_retention_agreed boolean,
  forfeited_credits integer NOT NULL DEFAULT 0,
  forfeited_paid_credits integer NOT NULL DEFAULT 0,
  forfeit_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_payment_event_at timestamptz,
  last_market_event_at timestamptz,
  last_ticket_event_at timestamptz,
  refund_ticket_ids uuid[] NOT NULL DEFAULT '{}',
  provider_unverified_confirmed boolean NOT NULL DEFAULT false,
  marketing_withdrawn_at timestamptz,
  auth_scrubbed_at timestamptz,
  result jsonb NOT NULL,
  policy_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT withdrawn_member_records_operation_key_key UNIQUE (operation_key),
  CONSTRAINT withdrawn_member_records_method_check CHECK (method IN ('self', 'owner')),
  CONSTRAINT withdrawn_member_records_sha_check CHECK (consent_notice_sha256 IS NULL OR consent_notice_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT withdrawn_member_records_amount_check CHECK (forfeited_credits >= 0 AND forfeited_paid_credits >= 0 AND forfeited_paid_credits <= forfeited_credits),
  CONSTRAINT withdrawn_member_records_contact_check CHECK (had_payment OR (email IS NULL AND phone IS NULL AND kakao_email IS NULL))
);

-- 3-3. 보관함 추가 기록(추가만, 모든 INSERT 는 ON CONFLICT DO NOTHING). (user_id, kind, ref_id) 부분 UNIQUE 는 자료 현금 정산을 뺀 종류,
--      자료 현금 정산(market_cash_refund)은 같은 주문에 여러 번 정산할 수 있어 (user_id, kind, ref_id, details.settlementKey) 로 같은 정산만 막는다.
CREATE TABLE IF NOT EXISTS public.withdrawn_member_record_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.withdrawn_member_records(user_id) ON DELETE RESTRICT,
  kind text NOT NULL,
  ref_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT withdrawn_member_record_events_kind_check CHECK (kind IN ('late_payment', 'held_order_closed', 'manual_refund', 'market_cash_refund', 'note')),
  CONSTRAINT withdrawn_member_record_events_details_check CHECK (jsonb_typeof(details) = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS withdrawn_member_record_events_ref_key
  ON public.withdrawn_member_record_events (user_id, kind, ref_id) WHERE ref_id IS NOT NULL AND kind <> 'market_cash_refund';
CREATE UNIQUE INDEX IF NOT EXISTS withdrawn_member_record_events_settlement_key
  ON public.withdrawn_member_record_events (user_id, kind, ref_id, (details ->> 'settlementKey')) WHERE kind = 'market_cash_refund';
CREATE INDEX IF NOT EXISTS withdrawn_member_record_events_ref_idx ON public.withdrawn_member_record_events (kind, ref_id);

-- 3-4. 가드
CREATE OR REPLACE FUNCTION public.guard_member_withdrawal_requests_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_member_withdrawal_requests$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'pending'
     AND NEW.id = OLD.id AND NEW.user_id = OLD.user_id AND NEW.channel = OLD.channel
     AND NEW.requester_kind = OLD.requester_kind AND NEW.received_at = OLD.received_at
     AND NEW.notice_text = OLD.notice_text AND NEW.notice_sha256 = OLD.notice_sha256
     AND NEW.expected_balance = OLD.expected_balance AND NEW.expected_forfeit_paid = OLD.expected_forfeit_paid
     AND NEW.expected_forfeit_free = OLD.expected_forfeit_free
     AND NEW.marketing_withdrawn_at IS NOT DISTINCT FROM OLD.marketing_withdrawn_at
     AND NEW.identity_note IS NOT DISTINCT FROM OLD.identity_note AND NEW.recorded_by = OLD.recorded_by
     AND NEW.created_at = OLD.created_at
     AND (OLD.notice_sent_at IS NULL OR NEW.notice_sent_at IS NOT DISTINCT FROM OLD.notice_sent_at)
     AND (OLD.consent_reply_received_at IS NULL OR NEW.consent_reply_received_at IS NOT DISTINCT FROM OLD.consent_reply_received_at)
     AND (OLD.ticket_retention_agreed IS NULL OR NEW.ticket_retention_agreed IS NOT DISTINCT FROM OLD.ticket_retention_agreed)
     AND NEW.status IN ('pending', 'completed', 'canceled') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'MEMBER_WITHDRAWAL_REQUESTS_APPEND_ONLY';
END;
$fn_guard_member_withdrawal_requests$;

DROP TRIGGER IF EXISTS guard_member_withdrawal_requests_mutation ON public.member_withdrawal_requests;
CREATE TRIGGER guard_member_withdrawal_requests_mutation
  BEFORE UPDATE OR DELETE ON public.member_withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_member_withdrawal_requests_mutation();
DROP TRIGGER IF EXISTS guard_member_withdrawal_requests_truncate ON public.member_withdrawal_requests;
CREATE TRIGGER guard_member_withdrawal_requests_truncate
  BEFORE TRUNCATE ON public.member_withdrawal_requests
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_member_withdrawal_requests_mutation();

CREATE OR REPLACE FUNCTION public.guard_withdrawn_member_records_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_withdrawn_member_records$
BEGIN
  -- 바뀌는 칸은 auth_scrubbed_at(NULL→값)과 kakao_id_pending_unlink(값→NULL)뿐이다.
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'auth_scrubbed_at' - 'kakao_id_pending_unlink') = (to_jsonb(OLD) - 'auth_scrubbed_at' - 'kakao_id_pending_unlink')
     AND (NEW.auth_scrubbed_at IS NOT DISTINCT FROM OLD.auth_scrubbed_at
          OR (OLD.auth_scrubbed_at IS NULL AND NEW.auth_scrubbed_at IS NOT NULL))
     AND (NEW.kakao_id_pending_unlink IS NOT DISTINCT FROM OLD.kakao_id_pending_unlink
          OR NEW.kakao_id_pending_unlink IS NULL) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'WITHDRAWN_MEMBER_RECORDS_APPEND_ONLY';
END;
$fn_guard_withdrawn_member_records$;

DROP TRIGGER IF EXISTS guard_withdrawn_member_records_mutation ON public.withdrawn_member_records;
CREATE TRIGGER guard_withdrawn_member_records_mutation
  BEFORE UPDATE OR DELETE ON public.withdrawn_member_records
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawn_member_records_mutation();
DROP TRIGGER IF EXISTS guard_withdrawn_member_records_truncate ON public.withdrawn_member_records;
CREATE TRIGGER guard_withdrawn_member_records_truncate
  BEFORE TRUNCATE ON public.withdrawn_member_records
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_withdrawn_member_records_mutation();

CREATE OR REPLACE FUNCTION public.guard_withdrawn_member_record_events_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_withdrawn_member_record_events$
BEGIN
  RAISE EXCEPTION 'WITHDRAWN_MEMBER_RECORD_EVENTS_APPEND_ONLY';
END;
$fn_guard_withdrawn_member_record_events$;

DROP TRIGGER IF EXISTS guard_withdrawn_member_record_events_mutation ON public.withdrawn_member_record_events;
CREATE TRIGGER guard_withdrawn_member_record_events_mutation
  BEFORE UPDATE OR DELETE ON public.withdrawn_member_record_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawn_member_record_events_mutation();
DROP TRIGGER IF EXISTS guard_withdrawn_member_record_events_truncate ON public.withdrawn_member_record_events;
CREATE TRIGGER guard_withdrawn_member_record_events_truncate
  BEFORE TRUNCATE ON public.withdrawn_member_record_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_withdrawn_member_record_events_mutation();

-- 3-5. 권한: 보관함·추가 기록은 service_role 도 읽지 못한다(정책 없음). 요청은 service_role 읽기만.
ALTER TABLE public.member_withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawn_member_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawn_member_record_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.member_withdrawal_requests FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.withdrawn_member_records FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.withdrawn_member_record_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.member_withdrawal_requests TO service_role;

-- 3-6. 탈퇴 회원 문의·환불 기록은 화면 세션(대표 포함)에서 숨긴다. 서버 route(service_role)로만 연다.
--      support_ticket_revisions·refund_requests 는 지금 authenticated 권한이 없어 효과가 없는 심층 방어용이다.
DROP POLICY IF EXISTS support_tickets_withdrawn_hidden ON public.support_tickets;
CREATE POLICY support_tickets_withdrawn_hidden
  ON public.support_tickets
  AS RESTRICTIVE
  FOR ALL
  USING (NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = support_tickets.user_id AND p.withdrawn_at IS NOT NULL))
  WITH CHECK (NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = support_tickets.user_id AND p.withdrawn_at IS NOT NULL));
DROP POLICY IF EXISTS market_refund_requests_withdrawn_hidden ON public.market_refund_requests;
CREATE POLICY market_refund_requests_withdrawn_hidden
  ON public.market_refund_requests
  AS RESTRICTIVE
  FOR SELECT
  USING (NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = market_refund_requests.user_id AND p.withdrawn_at IS NOT NULL));
DROP POLICY IF EXISTS support_ticket_revisions_withdrawn_hidden ON public.support_ticket_revisions;
CREATE POLICY support_ticket_revisions_withdrawn_hidden
  ON public.support_ticket_revisions
  AS RESTRICTIVE
  FOR SELECT
  USING (NOT EXISTS (SELECT 1 FROM public.support_tickets t JOIN public.profiles p ON p.id = t.user_id
                      WHERE t.id = support_ticket_revisions.ticket_id AND p.withdrawn_at IS NOT NULL));
DROP POLICY IF EXISTS refund_requests_withdrawn_hidden ON public.refund_requests;
CREATE POLICY refund_requests_withdrawn_hidden
  ON public.refund_requests
  AS RESTRICTIVE
  FOR SELECT
  USING (NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = refund_requests.user_id AND p.withdrawn_at IS NOT NULL));

-- 4. 내부 함수 -------------------------------------------------------------------------------------------------
-- 4-1. 정책 값(없거나 객체가 아니면 빈 객체 — 부르는 쪽이 꺼짐·막힘으로 본다)
CREATE OR REPLACE FUNCTION public.member_withdrawal_policy()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_withdrawal_policy$
DECLARE
  v_value jsonb;
BEGIN
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'member_withdrawal_policy';
  IF v_value IS NULL OR jsonb_typeof(v_value) IS DISTINCT FROM 'object' THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN v_value;
END;
$fn_member_withdrawal_policy$;

-- 4-2. 정책의 일수·연수(0~3650 정수, 아니면 NULL — 부르는 쪽이 막는 쪽으로 본다)
CREATE OR REPLACE FUNCTION public.member_withdrawal_policy_days(p_key text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_withdrawal_policy_days$
DECLARE
  v_value jsonb := public.member_withdrawal_policy();
  v_num numeric;
BEGIN
  IF jsonb_typeof(v_value -> p_key) IS DISTINCT FROM 'number' THEN
    RETURN NULL;
  END IF;
  v_num := (v_value ->> p_key)::numeric;
  IF v_num <> trunc(v_num) OR v_num < 0 OR v_num > 3650 THEN
    RETURN NULL;
  END IF;
  RETURN v_num::integer;
END;
$fn_member_withdrawal_policy_days$;

-- 4-3. 숫자·하이픈·공백만으로 된 구간에 숫자가 10개 이상 있는가(계좌·전화번호 같은 긴 번호 — 가림 확인 대상)
CREATE OR REPLACE FUNCTION public.member_text_has_long_number(p_text text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_text_has_long_number$
BEGIN
  RETURN EXISTS (
    SELECT 1
      FROM regexp_matches(COALESCE(p_text, ''), '[0-9][0-9[:space:]-]*', 'g') AS m(x)
     WHERE length(regexp_replace(m.x[1], '[^0-9]', '', 'g')) >= 10
  );
END;
$fn_member_text_has_long_number$;

-- 4-4. 유료 크레딧의 원 환산(환불정책 8절): 남은 유료 크레딧 × (결제 금액 − 환불액) ÷ (지급 − 회수), 1원 미만 버림.
--      결제 금액 = 뿌리 주문 expected_amount, 환불액 = 뿌리 주문의 completed refund_amount 합, 지급 = 뿌리 initial_credits,
--      회수 = 뿌리 + 다시 지급한 자손의 type 'refund' 음수 합. 뿌리를 찾지 못하면 NULL.
CREATE OR REPLACE FUNCTION public.point_charge_cash_value(p_source_id uuid, p_credits integer)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_point_charge_cash_value$
DECLARE
  v_root_id uuid;
  v_root_order uuid;
  v_paid integer;
  v_refunded integer;
  v_granted integer;
  v_recovered integer;
BEGIN
  IF p_credits IS NULL OR p_credits <= 0 THEN
    RETURN 0;
  END IF;
  SELECT r.root_source_id, r.payment_order_id INTO v_root_id, v_root_order
    FROM public.credit_source_paid_root(p_source_id) r
   LIMIT 1;
  IF v_root_id IS NULL OR v_root_order IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT o.expected_amount INTO v_paid FROM public.payment_orders o WHERE o.id = v_root_order;
  SELECT COALESCE(SUM(rr.refund_amount), 0)::integer INTO v_refunded
    FROM public.refund_requests rr
   WHERE rr.status = 'completed'
     AND (rr.payment_order_id = v_root_order OR rr.source_id = v_root_id);
  SELECT c.initial_credits INTO v_granted FROM public.credit_sources c WHERE c.id = v_root_id;
  SELECT COALESCE(-SUM(t.amount), 0)::integer INTO v_recovered
    FROM public.credit_transactions t
   WHERE t.type = 'refund'
     AND t.amount < 0
     AND (t.source_id = v_root_id
          OR t.source_id IN (SELECT d FROM public.credit_source_reissued_descendants(v_root_id) AS d));
  IF v_paid IS NULL OR v_granted IS NULL OR v_granted - v_recovered <= 0 OR v_paid - v_refunded <= 0 THEN
    RETURN 0;
  END IF;
  RETURN floor(p_credits::numeric * (v_paid - v_refunded) / (v_granted - v_recovered))::integer;
END;
$fn_point_charge_cash_value$;

-- 4-5. 탈퇴 판정(계획 3절). 미리보기·요청·익명화·시험이 모두 이 함수를 쓴다. 쓰기를 하지 않는다.
--      p_ticket_retention_agreed = false 이고 결제 회원이 아니면 가림 확인 필요 조건을 뺀다(문의를 지우므로).
CREATE OR REPLACE FUNCTION public.member_withdrawal_facts(p_user_id uuid, p_ticket_retention_agreed boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_withdrawal_facts$
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
$fn_member_withdrawal_facts$;

-- 4-6. 고지 원문(서버만 만든다). p_kind 'self'(스스로 익명화) | 'request'(결제 회원 탈퇴 요청·이메일·전화 요청).
--      줄은 LF 로 잇고 지문은 sha256(원문). 틀에 빠진 줄이 있거나 자리표시가 남으면 NULL(부르는 쪽이 정책 오류로 거절).
CREATE OR REPLACE FUNCTION public.member_withdrawal_notice_text(p_kind text, p_facts jsonb, p_ticket_retention_agreed boolean)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_withdrawal_notice_text$
DECLARE
  v_policy jsonb := public.member_withdrawal_policy();
  v_t jsonb := public.member_withdrawal_policy() -> 'texts';
  v_n jsonb := public.member_withdrawal_policy() -> 'texts' -> 'notice';
  v_lines text[] := ARRAY[]::text[];
  v_line text;
  v_item jsonb;
  v_balance jsonb := p_facts -> 'balance';
  v_terms integer;
  v_payer_years integer := public.member_withdrawal_policy_days('payerTicketRetentionYears');
  v_refund_years integer := public.member_withdrawal_policy_days('payerRefundTicketRetentionYears');
  v_nonpayer_years integer := public.member_withdrawal_policy_days('nonPayerTicketRetentionYears');
  v_payment_years integer := public.member_withdrawal_policy_days('paymentRetentionYears');
  v_attempt_years integer := public.member_withdrawal_policy_days('attemptRecordRetentionYears');
  v_text text;
BEGIN
  IF p_kind NOT IN ('self', 'request') OR p_facts IS NULL OR jsonb_typeof(v_t) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_n) IS DISTINCT FROM 'object' OR v_payer_years IS NULL OR v_refund_years IS NULL OR v_nonpayer_years IS NULL
     OR v_payment_years IS NULL OR v_attempt_years IS NULL THEN
    RETURN NULL;
  END IF;

  v_lines := ARRAY[v_t ->> 'noticeTitle', v_n ->> 'downloads', v_n ->> 'noCarryOver', v_n ->> 'reviews'];
  -- 남는 기록 안내(체크 ② '보존되는 기록과 삭제되는 기록 안내'가 가리키는 줄): 결제 회원 / 결제 시도만 있는 회원
  IF (p_facts ->> 'hadPayment')::boolean THEN
    v_lines := v_lines || (v_n ->> 'retainedPayer');
  ELSIF (p_facts ->> 'hasOrdersOrAttempts')::boolean THEN
    v_lines := v_lines || (v_n ->> 'retainedAttemptOnly');
  END IF;
  IF COALESCE((p_facts ->> 'ticketCount')::integer, 0) > 0 THEN
    v_lines := v_lines || CASE
      WHEN (p_facts ->> 'hadPayment')::boolean THEN v_n ->> 'ticketsPayer'
      WHEN p_ticket_retention_agreed IS TRUE THEN v_n ->> 'ticketsKeep'
      WHEN p_ticket_retention_agreed IS FALSE THEN v_n ->> 'ticketsDelete'
      ELSE v_n ->> 'ticketsChoice' END;
  END IF;
  -- 답변 대기 문의: 보존하는 경로(결제 회원·보존 동의)는 닫힘, 지우는 경로(보존 미동의)는 삭제, 회신으로 정하는 경로는 둘 다 안내
  IF COALESCE((p_facts ->> 'pendingTicketCount')::integer, 0) > 0 THEN
    v_lines := v_lines || replace(CASE
      WHEN (p_facts ->> 'hadPayment')::boolean OR p_ticket_retention_agreed IS TRUE THEN v_n ->> 'pendingTickets'
      WHEN p_ticket_retention_agreed IS FALSE THEN v_n ->> 'pendingTicketsDelete'
      ELSE v_n ->> 'pendingTicketsChoice' END, '{답변대기문의}', (p_facts ->> 'pendingTicketCount'));
  END IF;
  IF COALESCE((v_balance ->> 'forfeitTotal')::integer, 0) > 0 THEN
    -- 유료가 0 이면 무상만 말하는 줄, 원 환산을 모르는 유료가 있으면 0원 대신 '결제 내역을 확인해 따로 안내' 줄
    v_line := CASE
      WHEN COALESCE((v_balance ->> 'forfeitPaid')::integer, 0) = 0 THEN v_n ->> 'creditsFreeOnly'
      WHEN COALESCE((v_balance ->> 'paidCashValueUnknown')::boolean, false) THEN v_n ->> 'creditsCashUnknown'
      ELSE v_n ->> 'credits' END;
    v_lines := v_lines || replace(replace(replace(replace(v_line,
      '{소멸크레딧}', to_char((v_balance ->> 'forfeitTotal')::integer, 'FM999,999,999,990')),
      '{유료소멸크레딧}', to_char((v_balance ->> 'forfeitPaid')::integer, 'FM999,999,999,990')),
      '{무상소멸크레딧}', to_char((v_balance ->> 'forfeitFree')::integer, 'FM999,999,999,990')),
      '{유료원환산}', to_char((v_balance ->> 'paidCashValue')::integer, 'FM999,999,999,990'));
    FOR v_item IN SELECT e FROM jsonb_array_elements(v_balance -> 'breakdown') AS e WHERE (e ->> 'forfeited')::integer > 0 LOOP
      v_line := CASE WHEN NOT (v_item ->> 'paid')::boolean THEN v_n ->> 'creditLineFree'
                     WHEN v_item ->> 'cash_value' IS NULL THEN v_n ->> 'creditLinePaidCashUnknown'
                     ELSE v_n ->> 'creditLinePaid' END;
      -- 원 환산을 모르는 줄에 {원환산} 이 있으면 자리표시가 남아 NULL(정책 오류)이 된다 — 0원으로 채우지 않는다.
      v_line := replace(replace(replace(v_line,
        '{크레딧}', to_char((v_item ->> 'forfeited')::integer, 'FM999,999,999,990')),
        '{만료일}', CASE WHEN v_item ->> 'expires_at' IS NULL THEN COALESCE(v_n ->> 'noExpiry', '')
                         ELSE to_char((v_item ->> 'expires_at')::timestamptz AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') END),
        '{원환산}', COALESCE(to_char((v_item ->> 'cash_value')::integer, 'FM999,999,999,990'), '{원환산}'));
      v_lines := v_lines || v_line;
    END LOOP;
  ELSE
    v_lines := v_lines || (v_n ->> 'noCredits');
  END IF;
  v_lines := v_lines || (v_n ->> 'legalRefund');
  IF (p_facts ->> 'marketingAgreed')::boolean THEN
    v_lines := v_lines || CASE WHEN p_kind = 'self' THEN v_n ->> 'marketingSelf' ELSE v_n ->> 'marketingRequest' END;
  END IF;
  IF p_kind = 'request' THEN
    v_lines := v_lines || (v_n ->> 'useBeforeRequest');
  END IF;
  v_lines := v_lines || (v_n ->> 'irreversible');
  SELECT i.version INTO v_terms FROM public.signup_consent_items i WHERE i.key = (v_policy ->> 'termsConsentItemKey');
  IF v_terms IS NOT NULL THEN
    v_lines := v_lines || replace(v_n ->> 'termsVersion', '{약관판}', v_terms::text);
  END IF;
  v_lines := v_lines || (v_t ->> 'confirmLabel');

  FOREACH v_line IN ARRAY v_lines LOOP
    IF v_line IS NULL OR v_line !~ '\S' THEN
      RETURN NULL;
    END IF;
  END LOOP;
  v_text := array_to_string(v_lines, chr(10));
  v_text := replace(replace(replace(replace(replace(v_text,
    '{결제문의보존기간}', v_payer_years::text),
    '{환불문의보존기간}', v_refund_years::text),
    '{비결제문의보존기간}', v_nonpayer_years::text),
    '{결제기록보존기간}', v_payment_years::text),
    '{결제시도보존기간}', v_attempt_years::text);
  IF v_text ~ '[{}]' THEN
    RETURN NULL;
  END IF;
  RETURN v_text;
END;
$fn_member_withdrawal_notice_text$;

-- 4-7. 관리자 이벤트가 가리키는 회원(문의·충전 환불·자료 환불, 알림 포기 사본은 원래 이벤트를 따라감)
CREATE OR REPLACE FUNCTION public.member_admin_event_owner(p_ref_table text, p_ref_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_admin_event_owner$
DECLARE
  v_user uuid;
  v_table text;
  v_id uuid;
BEGIN
  IF p_ref_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_ref_table = 'admin_events' THEN
    SELECT e.ref_table, e.ref_id INTO v_table, v_id FROM public.admin_events e WHERE e.id = p_ref_id;
    IF v_table IS NULL OR v_table = 'admin_events' THEN
      RETURN NULL;
    END IF;
  ELSE
    v_table := p_ref_table;
    v_id := p_ref_id;
  END IF;
  IF v_table = 'support_tickets' THEN
    SELECT t.user_id INTO v_user FROM public.support_tickets t WHERE t.id = v_id;
  ELSIF v_table = 'refund_requests' THEN
    SELECT r.user_id INTO v_user FROM public.refund_requests r WHERE r.id = v_id;
  ELSIF v_table = 'market_refund_requests' THEN
    SELECT r.user_id INTO v_user FROM public.market_refund_requests r WHERE r.id = v_id;
  END IF;
  RETURN v_user;
END;
$fn_member_admin_event_owner$;

-- 4-8. 그 회원 문의·환불의 관리자 이벤트 제목·본문을 '탈퇴 회원 문의'(정책 문구)로 바꾼다. 알림 포기 사본은 본문만.
--      거래 로컬 설정을 켜고 가드가 그 회원 행만 받는다. 바꾼 행 수를 돌려준다.
CREATE OR REPLACE FUNCTION public.member_withdrawal_scrub_admin_events(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_withdrawal_scrub_admin_events$
DECLARE
  v_title text := NULLIF(btrim(public.member_withdrawal_policy() -> 'texts' ->> 'adminEventTitle'), '');
  v_ids uuid[];
  v_count integer := 0;
  v_n integer;
BEGIN
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_POLICY_UNAVAILABLE';
  END IF;
  PERFORM set_config('app.member_withdrawal_bypass', p_user_id::text, true);

  SELECT COALESCE(array_agg(e.id), '{}') INTO v_ids
    FROM public.admin_events e
   WHERE (e.ref_table = 'support_tickets' AND e.ref_id IN (SELECT t.id FROM public.support_tickets t WHERE t.user_id = p_user_id))
      OR (e.ref_table = 'refund_requests' AND e.ref_id IN (SELECT r.id FROM public.refund_requests r WHERE r.user_id = p_user_id))
      OR (e.ref_table = 'market_refund_requests' AND e.ref_id IN (SELECT r.id FROM public.market_refund_requests r WHERE r.user_id = p_user_id));

  UPDATE public.admin_events e
     SET title = v_title,
         body = CASE WHEN e.body IS NULL THEN NULL ELSE v_title END
   WHERE e.id = ANY (v_ids)
     AND (e.title IS DISTINCT FROM v_title OR (e.body IS NOT NULL AND e.body IS DISTINCT FROM v_title));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_count := v_count + v_n;

  UPDATE public.admin_events e
     SET body = v_title
   WHERE e.ref_table = 'admin_events'
     AND e.ref_id = ANY (v_ids)
     AND e.body IS DISTINCT FROM v_title;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_count + v_n;
END;
$fn_member_withdrawal_scrub_admin_events$;

-- 4-9. 대표 확인(관리자 + admin_role owner)
CREATE OR REPLACE FUNCTION public.member_withdrawal_require_owner(p_actor_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_withdrawal_require_owner$
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.admin_role = 'owner' AND p.withdrawn_at IS NULL
  ) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_ACTOR_NOT_OWNER';
  END IF;
END;
$fn_member_withdrawal_require_owner$;

-- 5. 탈퇴 회원 보호 트리거 --------------------------------------------------------------------------------------
-- 5-1. 쓰기 막기(문의·수정 이력·문제·지문·문제지·문제지 문항). 남은 JWT(최대 1시간)와 SECURITY DEFINER 문의·문제지 함수 경로를 함께 막는다.
--      익명화·가림 함수가 켠 거래 로컬 설정(값 = 그 회원 id)이 있을 때만 통과한다.
CREATE OR REPLACE FUNCTION public.guard_withdrawn_member_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_withdrawn_member_write$
DECLARE
  v_user uuid;
BEGIN
  IF TG_TABLE_NAME = 'support_ticket_revisions' THEN
    SELECT t.user_id INTO v_user FROM public.support_tickets t WHERE t.id = NEW.ticket_id;
  ELSIF TG_TABLE_NAME = 'exam_paper_items' THEN
    SELECT p.user_id INTO v_user FROM public.exam_papers p WHERE p.id = NEW.exam_paper_id;
  ELSE
    v_user := NEW.user_id;
  END IF;
  IF v_user IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user AND p.withdrawn_at IS NOT NULL)
     AND COALESCE(current_setting('app.member_withdrawal_bypass', true), '') IS DISTINCT FROM v_user::text THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAWN';
  END IF;
  RETURN NEW;
END;
$fn_guard_withdrawn_member_write$;

DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.support_tickets;
CREATE TRIGGER guard_withdrawn_member_write BEFORE INSERT OR UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawn_member_write();
DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.support_ticket_revisions;
CREATE TRIGGER guard_withdrawn_member_write BEFORE INSERT OR UPDATE ON public.support_ticket_revisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawn_member_write();
DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.questions;
CREATE TRIGGER guard_withdrawn_member_write BEFORE INSERT OR UPDATE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawn_member_write();
DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.passages;
CREATE TRIGGER guard_withdrawn_member_write BEFORE INSERT OR UPDATE ON public.passages
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawn_member_write();
DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.exam_papers;
CREATE TRIGGER guard_withdrawn_member_write BEFORE INSERT OR UPDATE ON public.exam_papers
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawn_member_write();
DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.exam_paper_items;
CREATE TRIGGER guard_withdrawn_member_write BEFORE INSERT OR UPDATE ON public.exam_paper_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawn_member_write();

-- 5-2. 상품 조회 기록: 탈퇴 회원이면 user_id 를 비워 넣는다.
CREATE OR REPLACE FUNCTION public.guard_withdrawn_member_view_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_withdrawn_member_view_event$
BEGIN
  IF NEW.user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.withdrawn_at IS NOT NULL) THEN
    NEW.user_id := NULL;
  END IF;
  RETURN NEW;
END;
$fn_guard_withdrawn_member_view_event$;

DROP TRIGGER IF EXISTS guard_withdrawn_member_view_event ON public.market_item_view_events;
CREATE TRIGGER guard_withdrawn_member_view_event BEFORE INSERT ON public.market_item_view_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawn_member_view_event();

-- 5-3. 크레딧 원천: 새 원천이나 잔량 증가는 탈퇴 회원이면 거절(refund_credits·자료 환불 정산·예외 환불·대표 정산·관리자 지급·카카오 지급을 덮는다).
CREATE OR REPLACE FUNCTION public.guard_withdrawn_member_credit_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_withdrawn_member_credit_source$
DECLARE
  v_withdrawn_at timestamptz;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.remaining_credits > OLD.remaining_credits THEN
    SELECT p.withdrawn_at INTO v_withdrawn_at
      FROM public.profiles p
     WHERE p.id = NEW.user_id
       FOR KEY SHARE;
    IF v_withdrawn_at IS NOT NULL THEN
      RAISE EXCEPTION 'MEMBER_WITHDRAWN';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn_guard_withdrawn_member_credit_source$;

DROP TRIGGER IF EXISTS guard_withdrawn_member_credit_source ON public.credit_sources;
CREATE TRIGGER guard_withdrawn_member_credit_source BEFORE INSERT OR UPDATE OF remaining_credits ON public.credit_sources
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawn_member_credit_source();

-- 5-4. 알림: 탈퇴 회원에게는 만들지 않는다(조용히 버림).
CREATE OR REPLACE FUNCTION public.guard_withdrawn_member_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_withdrawn_member_notification$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.withdrawn_at IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$fn_guard_withdrawn_member_notification$;

DROP TRIGGER IF EXISTS guard_withdrawn_member_notification ON public.notifications;
CREATE TRIGGER guard_withdrawn_member_notification BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawn_member_notification();

-- 5-5. 충전 환불 완료: 탈퇴 회원이면 같은 거래에 보관함 추가 기록(manual_refund)을 남긴다.
CREATE OR REPLACE FUNCTION public.record_withdrawn_member_manual_refund()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_record_withdrawn_member_manual_refund$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.withdrawn_at IS NOT NULL) THEN
    INSERT INTO public.withdrawn_member_record_events (user_id, kind, ref_id, details)
    VALUES (NEW.user_id, 'manual_refund', NEW.id,
            jsonb_build_object('refund_amount', NEW.refund_amount, 'source_id', NEW.source_id,
                               'payment_order_id', NEW.payment_order_id, 'processed_at', NEW.processed_at))
    ON CONFLICT (user_id, kind, ref_id) WHERE ref_id IS NOT NULL AND kind <> 'market_cash_refund' DO NOTHING;
  END IF;
  RETURN NULL;
END;
$fn_record_withdrawn_member_manual_refund$;

DROP TRIGGER IF EXISTS record_withdrawn_member_manual_refund ON public.refund_requests;
CREATE TRIGGER record_withdrawn_member_manual_refund AFTER UPDATE ON public.refund_requests
  FOR EACH ROW WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.record_withdrawn_member_manual_refund();

-- 6. 재정의 ---------------------------------------------------------------------------------------------------
-- 6-1. payapp_fulfill_order_internal
CREATE OR REPLACE FUNCTION public.payapp_fulfill_order_internal(p_payment_order_id uuid, p_approved_at timestamp with time zone)
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
  -- [10번] 시작
  -- 탈퇴 회원: 크레딧을 지급하지 않고 보류한다(주문 수동 확인·경보·보관함 늦은 결제 기록). 반복해도 결과가 같다.
  -- 이미 닫은 보류 주문은 상태·경보를 바꾸지 않는다(닫은 주문에 같은 통보가 다시 와도 열리지 않게).
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_order.user_id AND p.withdrawn_at IS NOT NULL) THEN
    IF EXISTS (SELECT 1 FROM public.withdrawn_member_record_events e
                WHERE e.user_id = v_order.user_id AND e.kind = 'held_order_closed' AND e.ref_id = v_order.id) THEN
      RETURN jsonb_build_object('held', 'MEMBER_WITHDRAWN', 'closed', true);
    END IF;

    UPDATE public.payment_orders
       SET status = 'manual_review',
           failure_code = 'PAYMENT_FOR_WITHDRAWN_MEMBER',
           failure_message = '탈퇴한 회원의 결제라 크레딧을 지급하지 않고 보류했습니다.',
           next_reconcile_at = NULL,
           updated_at = now()
     WHERE id = v_order.id;

    UPDATE public.checkout_attempts
       SET status = 'manual_review',
           updated_at = now()
     WHERE id = v_order.checkout_attempt_id
       AND status <> 'completed';

    PERFORM public.record_payment_alert(
      'PAYMENT_FOR_WITHDRAWN_MEMBER',
      'critical',
      '탈퇴한 회원의 결제가 들어와 크레딧을 지급하지 않고 보류했습니다. 회원 상세에서 보류 주문을 닫아 주세요.',
      jsonb_build_object('order_payment_order_id', v_order.id,
                         'dedupe_key', 'withdrawn_member_payment:' || v_order.id,
                         'user_id', v_order.user_id)
    );

    INSERT INTO public.withdrawn_member_record_events (user_id, kind, ref_id, details)
    VALUES (v_order.user_id, 'late_payment', v_order.id,
            jsonb_build_object('order_id', v_order.order_id, 'amount', v_order.expected_amount, 'approved_at', p_approved_at))
    ON CONFLICT (user_id, kind, ref_id) WHERE ref_id IS NOT NULL AND kind <> 'market_cash_refund' DO NOTHING;

    RETURN jsonb_build_object('held', 'MEMBER_WITHDRAWN');
  END IF;
  -- [10번] 끝

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
$function$
;

-- 6-2. apply_payapp_feedback
CREATE OR REPLACE FUNCTION public.apply_payapp_feedback(p_userid text, p_mul_no text, p_orig_mul_no text, p_order_id text, p_pay_state integer, p_price integer, p_orig_price integer, p_pay_type integer, p_pay_date timestamp with time zone, p_canceldate timestamp with time zone)
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
    -- 부분취소 뒤 승인취소는 price가 잔액(원금 - 부분취소 금액)으로 올 수 있어 그 값도 받는다.
    -- price가 NULL이면 지금처럼 금액 불일치로 둔다.
    ELSIF p_pay_state IN (9, 64)
      AND p_price IS DISTINCT FROM v_order.expected_amount
      AND NOT (p_price IS NOT NULL
               AND v_ppt.partial_cancel_amount IS NOT NULL
               AND p_price = v_order.expected_amount - v_ppt.partial_cancel_amount) THEN
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
      -- [10번] 시작
      -- 탈퇴 회원 보류 주문(late_payment 기록 있음 — 닫기 전·닫은 뒤 모두)은 상태를 바꾸지 않고 경보만 남긴다
      -- (취소 처리 뒤 닫기 전에 온 통보로 대표가 풀 길이 없는 manual_review 를 만들지 않게).
      IF EXISTS (SELECT 1 FROM public.withdrawn_member_record_events e
                  WHERE e.user_id = v_order.user_id AND e.kind = 'late_payment' AND e.ref_id = v_order.id) THEN
        PERFORM public.record_payment_alert(
          'WITHDRAWN_HELD_ORDER_FEEDBACK_MISMATCH',
          'critical',
          COALESCE(NULLIF(btrim(public.member_withdrawal_policy() -> 'texts' ->> 'alertHeldOrderFeedbackMismatch'), ''),
                   'WITHDRAWN_HELD_ORDER_FEEDBACK_MISMATCH'),
          jsonb_build_object('payment_order_id', v_order.id, 'reason', v_reason, 'pay_state', p_pay_state,
                             'dedupe_key', 'withdrawn_held_order_feedback:' || v_order.id)
        );
        RETURN jsonb_build_object(
          'result', 'ignored',
          'reason', v_reason,
          'payment_order_id', v_order_id,
          'order_id', v_order.order_id
        );
      END IF;
      -- [10번] 끝
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
    -- [10번] 시작
    -- 탈퇴 회원 보류 주문(늦은 결제 기록 있음)은 fulfillment_pending 으로 되돌리지 않는다.
    -- 닫은 주문이 대사에 다시 집히거나 보류 주문의 상태가 오가지 않게 하려는 것이다.
    IF EXISTS (SELECT 1 FROM public.withdrawn_member_record_events e
                WHERE e.user_id = v_order.user_id AND e.kind = 'late_payment' AND e.ref_id = v_order.id) THEN
      RETURN jsonb_build_object(
        'result', 'withdrawn_member_hold',
        'payment_order_id', v_order.id,
        'order_id', v_order.order_id,
        'closed', EXISTS (SELECT 1 FROM public.withdrawn_member_record_events e
                           WHERE e.user_id = v_order.user_id AND e.kind = 'held_order_closed' AND e.ref_id = v_order.id),
        'paid_amount_conflict', v_paid_amount_conflict
      );
    END IF;
    -- [10번] 끝

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
      -- [10번] 시작
-- [10번 원래]       'result', CASE WHEN v_fulfill IS NULL THEN 'recorded_pending' ELSE 'fulfilled' END,
      'result', CASE WHEN v_fulfill IS NULL THEN 'recorded_pending' WHEN v_fulfill ? 'held' THEN 'withdrawn_member_hold' ELSE 'fulfilled' END,
      -- [10번] 끝
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
$function$
;

-- 6-3. retry_payapp_fulfillment
CREATE OR REPLACE FUNCTION public.retry_payapp_fulfillment(p_payment_order_id uuid)
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
    -- [10번] 시작
    -- 탈퇴 회원이면 지급하지 않고 보류했다(알림 없음).
    IF v_fulfill ? 'held' THEN
      RETURN jsonb_build_object(
        'result', 'withdrawn_member_hold',
        'user_id', v_order.user_id,
        'closed', COALESCE((v_fulfill ->> 'closed')::boolean, false)
      );
    END IF;
    -- [10번] 끝
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
$function$
;

-- 6-4. resolve_payment_order_review
CREATE OR REPLACE FUNCTION public.resolve_payment_order_review(p_payment_order_id uuid, p_action text, p_actor_id uuid, p_note text, p_mul_no text DEFAULT NULL::text, p_paid_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_external_method text DEFAULT NULL::text)
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
  -- [10번] 시작
  -- 탈퇴 회원 주문은 결제확인(지급)을 하지 않는다. 탈퇴 회원 보류 주문(늦은 결제 기록 있음)은
  -- 이 함수로 정리하지 않고 close_withdrawn_member_held_order 로 닫는다(부분취소 뒤 포함).
  IF EXISTS (SELECT 1 FROM public.withdrawn_member_record_events e
              WHERE e.user_id = v_order.user_id AND e.kind = 'late_payment' AND e.ref_id = v_order.id)
     OR (p_action = 'paid_confirmed'
         AND (v_order.failure_code = 'PAYMENT_FOR_WITHDRAWN_MEMBER'
              OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_order.user_id AND p.withdrawn_at IS NOT NULL))) THEN
    RAISE EXCEPTION 'PAYMENT_REVIEW_MEMBER_WITHDRAWN';
  END IF;
  -- [10번] 끝

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
$function$
;

-- 6-5. prepare_payment_order
CREATE OR REPLACE FUNCTION public.prepare_payment_order(p_user_id uuid, p_checkout_attempt_id uuid, p_provider text, p_plan_id uuid, p_order_id text, p_plan_name_snapshot text, p_expected_amount integer, p_expected_credits integer, p_provider_environment text, p_provider_merchant_id text, p_request_fingerprint text, p_confirm_idempotency_key text, p_cancel_idempotency_key text, p_expires_at timestamp with time zone, p_tax_free_amount integer, p_vat_amount integer, p_partner_user_id text, p_payment_method_code text DEFAULT NULL::text)
 RETURNS payment_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  -- [10번] 시작
  v_withdrawn_at timestamptz;
  -- [10번] 끝
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
  -- [10번] 시작
  -- 탈퇴 회원은 새 결제도 기존 주문 재사용도 받지 않는다(결제 시도 잠금 다음, 주문 INSERT 전 — 거절하면 거래 전체가 롤백된다).
  SELECT p.withdrawn_at INTO v_withdrawn_at
    FROM public.profiles p
   WHERE p.id = p_user_id
   FOR SHARE;
  IF v_withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAWN';
  END IF;
  -- [10번] 끝

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
$function$
;

-- 6-6. begin_payapp_request
CREATE OR REPLACE FUNCTION public.begin_payapp_request(p_payment_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_runtime public.payment_runtime_config%ROWTYPE;
  -- [10번] 시작
  v_withdrawn_at timestamptz;
  -- [10번] 끝
BEGIN
  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  IF NOT FOUND OR v_order.provider <> 'payapp' THEN
    RAISE EXCEPTION 'PAYAPP_ORDER_NOT_FOUND';
  END IF;
  -- [10번] 시작
  -- 탈퇴 회원 주문은 결제창을 열지 않는다(주문 잠금 뒤 프로필을 FOR SHARE 로 읽음).
  SELECT p.withdrawn_at INTO v_withdrawn_at
    FROM public.profiles p
   WHERE p.id = v_order.user_id
   FOR SHARE;
  IF v_withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAWN';
  END IF;
  -- [10번] 끝

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
$function$
;

-- 6-7. record_point_charge_checkout_ack
CREATE OR REPLACE FUNCTION public.record_point_charge_checkout_ack(p_user_id uuid, p_checkout_attempt_id uuid, p_plan_id uuid, p_expected_amount integer, p_expected_credits integer, p_notice_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- [10번] 시작
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.withdrawn_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MEMBER_WITHDRAWN');
  END IF;
  -- [10번] 끝

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
$function$
;

-- 6-8. process_payapp_cancellation
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
  -- [10번] 시작
  v_closed_method text;
  -- [10번] 끝
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
        -- [10번] 시작
        -- 탈퇴 회원 보류 주문을 이미 닫았으면 다시 열지 않는다. 계좌 송금으로 닫았다면 이중 환불 의심 경보.
        SELECT paa.external_method INTO v_closed_method
          FROM public.payment_admin_actions paa
         WHERE paa.payment_order_id = v_order.id
           AND paa.action = 'withdrawn_held_order_closed'
         ORDER BY paa.created_at DESC
         LIMIT 1;
        IF FOUND THEN
          IF v_closed_method = 'bank_transfer' THEN
            v_result := 'double_refund_suspected';
            v_detail := jsonb_build_object('source', 'withdrawn_held_order_bank_transfer');
          ELSE
            v_result := 'cancelled_before_fulfillment';
          END IF;
        ELSE
        -- [10번] 끝
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

        -- [10번] 시작
-- [10번 원래]         v_result := 'cancelled_before_fulfillment';
-- [10번 원래]       ELSIF v_order.status = 'refunded' THEN
        v_result := 'cancelled_before_fulfillment';
        END IF;
      ELSIF v_order.status = 'refunded' THEN
        -- [10번] 끝
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
      -- [10번] 시작
-- [10번 원래]       ELSIF v_order.source_id IS NULL THEN
-- [10번 원래]         UPDATE public.payment_orders
-- [10번 원래]            SET status = 'manual_review',
-- [10번 원래]                failure_code = 'PAYAPP_PARTIAL_CANCEL',
      ELSIF v_order.source_id IS NULL
            AND EXISTS (SELECT 1 FROM public.payment_admin_actions paa
                         WHERE paa.payment_order_id = v_order.id AND paa.action = 'withdrawn_held_order_closed') THEN
        -- 닫은 탈퇴 회원 보류 주문에 온 부분취소: 주문을 다시 열지 않는다. 계좌 송금으로 닫았다면 이중 환불 의심 경보.
        SELECT paa.external_method INTO v_closed_method
          FROM public.payment_admin_actions paa
         WHERE paa.payment_order_id = v_order.id
           AND paa.action = 'withdrawn_held_order_closed'
         ORDER BY paa.created_at DESC
         LIMIT 1;
        UPDATE public.payment_provider_transactions
           SET partial_cancel_processed_at = COALESCE(partial_cancel_processed_at, now()),
               updated_at = now()
         WHERE id = v_ppt.id;
        IF v_closed_method = 'bank_transfer' THEN
          v_result := 'double_refund_suspected';
          v_detail := jsonb_build_object('source', 'withdrawn_held_order_bank_transfer');
        ELSE
          v_result := 'partial_cancel_unpaid';
        END IF;
      ELSIF v_order.source_id IS NULL THEN
        UPDATE public.payment_orders
           SET status = 'manual_review',
               failure_code = 'PAYAPP_PARTIAL_CANCEL',
      -- [10번] 끝
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

  -- [10번] 시작
  -- 닫은 탈퇴 회원 보류 주문(지급 전, 닫기 조치 기록 있음): manual_review 로 되돌리지 않고 failed 를 유지한다.
  -- 닫은 주문은 다시 닫지 않으므로(replay) 풀 길이 없는 수동 확인을 만들지 않게. 처리 시각만 남기고,
  -- 계좌 송금으로 닫았으면 이중 환불 의심 경보, 아니면 처리 실패 경보를 남긴다(돈은 더 보내지 않는다).
  IF v_order.source_id IS NULL THEN
    SELECT paa.external_method INTO v_closed_method
      FROM public.payment_admin_actions paa
     WHERE paa.payment_order_id = v_order.id
       AND paa.action = 'withdrawn_held_order_closed'
     ORDER BY paa.created_at DESC
     LIMIT 1;
    IF FOUND THEN
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
      IF v_closed_method = 'bank_transfer' THEN
        PERFORM public.record_payment_alert(
          'PAYAPP_DOUBLE_REFUND_SUSPECTED',
          'critical',
          '계좌이체로 환불한 결제가 페이앱에서도 취소되었습니다.',
          jsonb_build_object('order_id', v_order.order_id, 'payment_order_id', v_order.id,
                             'source', 'withdrawn_held_order_bank_transfer', 'error_state', v_error_state)
        );
        RETURN jsonb_build_object(
          'result', 'double_refund_suspected',
          'marker', v_marker,
          'payment_order_id', v_order.id,
          'order_id', v_order.order_id,
          'user_id', v_order.user_id,
          'source', 'withdrawn_held_order_bank_transfer',
          'error_state', v_error_state
        );
      END IF;
      PERFORM public.record_payment_alert(
        'PAYAPP_CANCEL_HANDLING_FAILED',
        'critical',
        COALESCE(NULLIF(btrim(public.member_withdrawal_policy() -> 'texts' ->> 'alertClosedHeldOrderCancelFailed'), ''),
                 'PAYAPP_CANCEL_HANDLING_FAILED'),
        jsonb_build_object('order_id', v_order.order_id, 'payment_order_id', v_order.id, 'source', 'process_payapp_cancellation',
                           'error_state', v_error_state, 'withdrawn_held_order_closed', true)
      );
      RETURN jsonb_build_object(
        'result', 'cancel_handling_failed',
        'marker', v_marker,
        'payment_order_id', v_order.id,
        'order_id', v_order.order_id,
        'error_state', v_error_state,
        'closed', true
      );
    END IF;
  END IF;
  -- [10번] 끝
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
$function$
;

-- 6-9. payapp_sales_resume_blockers
CREATE OR REPLACE FUNCTION public.payapp_sales_resume_blockers()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_scheduler public.payment_reconciliation_scheduler%ROWTYPE;
  v_scheduler_stale boolean;
  v_payapp_unfulfilled_count integer;
  v_payapp_money_review_count integer;
  v_payapp_cancel_active_count integer;
BEGIN
  SELECT *
    INTO v_scheduler
    FROM public.payment_reconciliation_scheduler
   WHERE id = 1;

  v_scheduler_stale := v_scheduler.last_started_at IS NOT NULL
    AND (
      v_scheduler.last_succeeded_at IS NULL
      OR v_scheduler.last_succeeded_at <= now() - interval '15 minutes'
    );

  SELECT COUNT(*)::integer
    INTO v_payapp_unfulfilled_count
    FROM public.payment_orders po
    JOIN public.payment_provider_transactions ppt ON ppt.payment_order_id = po.id
   WHERE po.provider = 'payapp'
     AND ppt.paid_feedback_recorded_at <= now() - interval '10 minutes'
     AND po.source_id IS NULL
     -- [10번] 시작
-- [10번 원래]      AND ppt.cancel_feedback_recorded_at IS NULL
-- [10번 원래]      AND ppt.partial_cancel_feedback_recorded_at IS NULL;
     AND ppt.cancel_feedback_recorded_at IS NULL
     AND ppt.partial_cancel_feedback_recorded_at IS NULL
     AND NOT EXISTS ( SELECT 1 FROM public.withdrawn_member_record_events wre WHERE wre.kind = 'held_order_closed' AND wre.ref_id = po.id );
     -- [10번] 끝

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
    COUNT(*) FILTER (WHERE cs.status = 'active')::integer
    INTO v_payapp_cancel_active_count
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

  RETURN jsonb_build_object(
    'paid_unfulfilled_count', v_payapp_unfulfilled_count,
    'money_review_count', v_payapp_money_review_count,
    'cancel_unprocessed_active_count', v_payapp_cancel_active_count,
    -- 점검 작업 기록 행이 없으면 건강하다고 볼 근거가 없으므로 막는다.
    'scheduler_unhealthy', COALESCE(v_scheduler_stale OR v_scheduler.consecutive_failures >= 3, true),
    'consecutive_failures', v_scheduler.consecutive_failures,
    'last_succeeded_at', v_scheduler.last_succeeded_at
  );
END;
$function$
;

-- 6-10. enforce_payment_reconciliation_health
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
  v_feedback_ack timestamptz;
  v_feedback_unprocessed_count integer;
  v_feedback_latest timestamptz;
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
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  ELSIF v_kakao_marker_frozen_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'KAKAOPAY_PARTIAL_CANCEL_UNPROCESSED_FROZEN',
      'warning',
      '카카오페이 부분취소 처리가 10분 넘게 끝나지 않았습니다(크레딧은 묶여 있음).',
      jsonb_build_object('count', v_kakao_marker_frozen_count)
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  -- 페이앱 블록: 돈이 걸린 위험만 판매를 끈다.
  SELECT COUNT(*)::integer
    INTO v_payapp_unfulfilled_count
    FROM public.payment_orders po
    JOIN public.payment_provider_transactions ppt ON ppt.payment_order_id = po.id
   WHERE po.provider = 'payapp'
     AND ppt.paid_feedback_recorded_at <= now() - interval '10 minutes'
     AND po.source_id IS NULL
     -- [10번] 시작
-- [10번 원래]      AND ppt.cancel_feedback_recorded_at IS NULL
-- [10번 원래]      AND ppt.partial_cancel_feedback_recorded_at IS NULL;
     AND ppt.cancel_feedback_recorded_at IS NULL
     AND ppt.partial_cancel_feedback_recorded_at IS NULL
     AND NOT EXISTS ( SELECT 1 FROM public.withdrawn_member_record_events wre WHERE wre.kind = 'held_order_closed' AND wre.ref_id = po.id );
     -- [10번] 끝

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

  -- change_ticket에 남길 첫 code. 경보는 아래에서 조건마다 따로 남긴다.
  IF v_payapp_unfulfilled_count > 0 THEN
    v_payapp_code := 'PAYAPP_PAID_UNFULFILLED';
  ELSIF v_payapp_cancel_active_count > 0 THEN
    v_payapp_code := 'PAYAPP_CANCEL_UNPROCESSED';
  ELSIF v_payapp_money_review_count > 0 THEN
    v_payapp_code := 'PAYAPP_MONEY_RISK_REVIEW';
  ELSIF v_payapp_scheduler_unhealthy THEN
    v_payapp_code := 'PAYAPP_RECONCILIATION_UNHEALTHY';
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
  -- 조건마다 따로 남겨 한 조건이 다른 조건(특히 취소 미처리)을 가리지 않게 한다.
  IF v_payapp_unfulfilled_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'PAYAPP_PAID_UNFULFILLED',
      'critical',
      '결제완료가 기록됐지만 10분 넘게 크레딧이 지급되지 않은 페이앱 건이 있습니다.',
      jsonb_build_object(
        'paid_unfulfilled_count', v_payapp_unfulfilled_count,
        'money_review_count', v_payapp_money_review_count,
        'cancel_unprocessed_active_count', v_payapp_cancel_active_count,
        'consecutive_failures', v_scheduler.consecutive_failures,
        'last_succeeded_at', v_scheduler.last_succeeded_at
      )
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  IF v_payapp_cancel_active_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'PAYAPP_CANCEL_UNPROCESSED',
      'critical',
      '페이앱 취소 처리가 10분 넘게 끝나지 않았고 크레딧을 쓸 수 있는 상태입니다.',
      jsonb_build_object(
        'paid_unfulfilled_count', v_payapp_unfulfilled_count,
        'money_review_count', v_payapp_money_review_count,
        'cancel_unprocessed_active_count', v_payapp_cancel_active_count,
        'consecutive_failures', v_scheduler.consecutive_failures,
        'last_succeeded_at', v_scheduler.last_succeeded_at
      )
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  IF v_payapp_money_review_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'PAYAPP_MONEY_RISK_REVIEW',
      'critical',
      '돈이 걸린 페이앱 수동 확인 건이 있습니다.',
      jsonb_build_object(
        'paid_unfulfilled_count', v_payapp_unfulfilled_count,
        'money_review_count', v_payapp_money_review_count,
        'cancel_unprocessed_active_count', v_payapp_cancel_active_count,
        'consecutive_failures', v_scheduler.consecutive_failures,
        'last_succeeded_at', v_scheduler.last_succeeded_at
      )
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  IF v_payapp_cancel_frozen_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'PAYAPP_CANCEL_UNPROCESSED_FROZEN',
      'warning',
      '페이앱 취소 처리가 10분 넘게 끝나지 않았습니다(크레딧은 묶여 있거나 지급 전).',
      jsonb_build_object('count', v_payapp_cancel_frozen_count)
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  -- 기록되지 않은 페이앱 통보: 경보만 남기고 판매는 끄지 않는다.
  -- 이미 확인(해소)된 경보가 덮은 시각 이후만 센다. 해소하면 다시 울리지 않는다.
  SELECT MAX((details->>'latest_received_at')::timestamptz)
    INTO v_feedback_ack
    FROM public.payment_reconciliation_alerts
   WHERE code = 'PAYAPP_FEEDBACK_UNPROCESSED';

  -- pending·failed는 payment_webhook_events_pending_idx, 표식 없이 ignored로 닫힌 취소 계열 통보는
  -- payment_webhook_events_ignored_cancel_idx를 타도록 두 부분으로 나눈다.
  -- PROCESS: 실패는 표식이 이미 커밋된 경우라 취소 미처리 점검과 대사가 다룬다. 사이트 밖 통보는 뺀다.
  SELECT COUNT(*)::integer, MAX(e.received_at)
    INTO v_feedback_unprocessed_count, v_feedback_latest
    FROM (
      SELECT pwe.received_at
        FROM public.payment_webhook_events pwe
       WHERE pwe.processing_status IN ('pending', 'failed')
         AND pwe.transmission_id LIKE 'payapp:%'
         AND pwe.received_at <= now() - interval '30 minutes'
         AND pwe.received_at > COALESCE(v_feedback_ack, '-infinity'::timestamptz)
         AND (pwe.processing_status = 'pending'
              OR COALESCE(pwe.last_error_code, '') NOT LIKE 'PROCESS:%')
      UNION ALL
      SELECT pwe.received_at
        FROM public.payment_webhook_events pwe
       WHERE pwe.processing_status = 'ignored'
         AND pwe.event_type IN ('PAYAPP_PAY_STATE_9', 'PAYAPP_PAY_STATE_64', 'PAYAPP_PAY_STATE_70', 'PAYAPP_PAY_STATE_71')
         AND pwe.transmission_id LIKE 'payapp:%'
         AND pwe.received_at <= now() - interval '30 minutes'
         AND pwe.received_at > COALESCE(v_feedback_ack, '-infinity'::timestamptz)
         AND COALESCE(pwe.last_error_code, '') <> 'PAYAPP_FOREIGN_FEEDBACK'
    ) e;

  IF v_feedback_unprocessed_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES ('PAYAPP_FEEDBACK_UNPROCESSED', 'critical',
            '30분 넘게 처리되지 않은 페이앱 통보가 있습니다. 페이앱 관리자 내역과 대조하세요.',
            jsonb_build_object('count', v_feedback_unprocessed_count, 'latest_received_at', v_feedback_latest))
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
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
$function$
;

-- 6-11. prevent_payment_order_snapshot_update
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
     -- [10번] 시작
-- [10번 원래]      OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
     -- 익명화 거래 로컬 설정 값이 그 주문 회원일 때만 request_fingerprint 한 칸 변경을 받는다.
     OR (NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
         AND COALESCE(current_setting('app.member_withdrawal_bypass', true), '') IS DISTINCT FROM OLD.user_id::text)
     -- [10번] 끝
     OR NEW.checkout_expires_at IS DISTINCT FROM OLD.checkout_expires_at
     OR NEW.ready_requested_at IS DISTINCT FROM OLD.ready_requested_at
     OR NEW.ready_expires_at IS DISTINCT FROM OLD.ready_expires_at
     OR NEW.payment_method_code IS DISTINCT FROM OLD.payment_method_code THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_IMMUTABLE_SNAPSHOT';
  END IF;

  RETURN NEW;
END;
$function$
;

-- 6-12. consent_record_internal
CREATE OR REPLACE FUNCTION public.consent_record_internal(p_user_id uuid, p_items jsonb, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_error text;
  v_provider text;
  v_signup_completed boolean;
  v_email_confirmed_at timestamptz;
  v_has_records boolean;
  v_mode text := 'full';
  v_elem jsonb;
  v_item public.signup_consent_items%ROWTYPE;
  v_agreed boolean;
  v_latest boolean;
  v_item_ids uuid[] := ARRAY[]::uuid[];
  v_doc_key text;
  v_doc jsonb;
  v_hash text;
  -- [10번] 시작
  v_withdrawn_at timestamptz;
  -- [10번] 끝
BEGIN
  IF p_user_id IS NULL OR p_source IS NULL
     -- [10번] 시작
-- [10번 원래]      OR p_source NOT IN ('email_signup', 'kakao_signup', 'consent_gate', 'mypage') THEN
     OR p_source NOT IN ('email_signup', 'kakao_signup', 'consent_gate', 'mypage', 'withdrawal') THEN
     -- [10번] 끝
    RAISE EXCEPTION 'CONSENT_INPUT_INVALID';
  END IF;

  -- ① 회원 advisory ② 항목 쓰기 공유(저장·개정과 겹치지 않게) ③ profiles 행
  PERFORM pg_advisory_xact_lock(hashtextextended('public.user_consents:' || p_user_id::text, 0));
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('public.signup_consent_items:write', 0));

  -- [10번] 시작
-- [10번 원래]   SELECT p.provider, p.signup_completed
-- [10번 원래]     INTO v_provider, v_signup_completed
-- [10번 원래]     FROM public.profiles p
-- [10번 원래]    WHERE p.id = p_user_id
-- [10번 원래]      FOR NO KEY UPDATE;
-- [10번 원래]   IF NOT FOUND THEN
-- [10번 원래]     RAISE EXCEPTION 'CONSENT_PROFILE_MISSING';
-- [10번 원래]   END IF;
  SELECT p.provider, p.signup_completed, p.withdrawn_at
    INTO v_provider, v_signup_completed, v_withdrawn_at
    FROM public.profiles p
   WHERE p.id = p_user_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONSENT_PROFILE_MISSING';
  END IF;
  -- 탈퇴 회원은 탈퇴(withdrawal) 기록만 받는다.
  IF v_withdrawn_at IS NOT NULL AND p_source <> 'withdrawal' THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAWN';
  END IF;
  -- [10번] 끝

  IF p_source IN ('consent_gate', 'mypage') AND v_provider = 'kakao' AND v_signup_completed IS NOT TRUE THEN
    RAISE EXCEPTION 'CONSENT_KAKAO_SIGNUP_INCOMPLETE';
  END IF;
  IF p_source = 'kakao_signup' AND v_provider IS DISTINCT FROM 'kakao' THEN
    RAISE EXCEPTION 'CONSENT_KAKAO_NOT_KAKAO';
  END IF;

  -- [10번] 시작
-- [10번 원래]   v_error := public.consent_items_error(p_items, p_source);
  -- 탈퇴: 철회만 받고 항목 검사는 마이페이지 규칙으로 한다(필수 누락 검사는 아래에서 건너뜀).
  IF p_source = 'withdrawal' THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_items) = 'array' THEN p_items ELSE '[]'::jsonb END) AS e
                WHERE (e -> 'agreed') IS DISTINCT FROM 'false'::jsonb) THEN
      RAISE EXCEPTION 'CONSENT_INPUT_INVALID';
    END IF;
    v_error := public.consent_items_error(p_items, 'mypage');
  ELSE
    v_error := public.consent_items_error(p_items, p_source);
  END IF;
  -- [10번] 끝
  IF v_error IS NOT NULL THEN
    RAISE EXCEPTION '%', v_error;
  END IF;

  SELECT array_agg((e ->> 'item_id')::uuid) INTO v_item_ids FROM jsonb_array_elements(p_items) AS e;

  -- 이메일 가입: 미인증 이메일 계정에만. 기록이 이미 있으면(같은 이메일 재가입 — 제3자일 수 있음) 선택 철회만 받는다.
  IF p_source = 'email_signup' THEN
    SELECT u.email_confirmed_at INTO v_email_confirmed_at FROM auth.users u WHERE u.id = p_user_id;
    IF v_email_confirmed_at IS NOT NULL OR v_provider IS DISTINCT FROM 'email' THEN
      RETURN '[]'::jsonb;
    END IF;
    v_has_records := EXISTS (SELECT 1 FROM public.user_consents c WHERE c.user_id = p_user_id);
    IF v_has_records THEN
      v_mode := 'withdraw_only';
    END IF;
  END IF;

  -- [10번] 시작
-- [10번 원래]   IF v_mode = 'full' AND p_source <> 'mypage'
  IF v_mode = 'full' AND p_source NOT IN ('mypage', 'withdrawal')
  -- [10번] 끝
     AND EXISTS (SELECT 1 FROM public.consent_missing_required(p_user_id, p_items)) THEN
    RAISE EXCEPTION 'CONSENT_REQUIRED_MISSING';
  END IF;

  FOR v_elem IN SELECT e FROM jsonb_array_elements(p_items) AS e LOOP
    SELECT * INTO v_item FROM public.signup_consent_items i WHERE i.id = (v_elem ->> 'item_id')::uuid;
    v_agreed := (v_elem -> 'agreed') = 'true'::jsonb;

    IF v_mode = 'withdraw_only' AND (v_item.required OR v_agreed) THEN
      CONTINUE;
    END IF;

    SELECT c.agreed INTO v_latest
      FROM public.user_consents c
     WHERE c.user_id = p_user_id AND c.item_id = v_item.id AND c.item_version = v_item.version
     ORDER BY c.seq DESC
     LIMIT 1;
    IF FOUND AND v_latest = v_agreed THEN
      CONTINUE;
    END IF;

    -- 연결 약관이 있으면 동의 제출 시점의 저장 본문 지문(sha256)을 함께 적는다(6번 묶음).
    v_hash := NULL;
    IF v_item.policy_slug IS NOT NULL THEN
      SELECT d.key, d.value INTO v_doc_key, v_doc
        FROM public.system_settings s,
             jsonb_each(CASE WHEN jsonb_typeof(s.value -> 'policyDocuments') = 'object' THEN s.value -> 'policyDocuments' ELSE '{}'::jsonb END) AS d
       WHERE s.key = 'site_footer_content'
         AND d.value ->> 'slug' = v_item.policy_slug
       LIMIT 1;
      IF FOUND AND jsonb_typeof(v_doc -> 'content') = 'string' THEN
        v_hash := encode(sha256(convert_to(v_doc ->> 'content', 'UTF8')), 'hex');
        -- 그 본문의 사본이 없으면(이론상 저장 트리거가 보장) 여기서 남긴다.
        IF NOT EXISTS (SELECT 1 FROM public.policy_document_snapshots p WHERE p.doc_key = v_doc_key AND p.content_sha256 = v_hash) THEN
          PERFORM pg_advisory_xact_lock(hashtextextended('public.policy_document_snapshots', 0));
          IF NOT EXISTS (SELECT 1 FROM public.policy_document_snapshots p WHERE p.doc_key = v_doc_key AND p.content_sha256 = v_hash) THEN
            INSERT INTO public.policy_document_snapshots (doc_key, slug, title, content, content_sha256)
            VALUES (v_doc_key, v_doc ->> 'slug', v_doc ->> 'title', v_doc ->> 'content', v_hash);
          END IF;
        END IF;
      END IF;
    END IF;

    INSERT INTO public.user_consents (user_id, item_id, item_version, agreed, source, policy_sha256)
    VALUES (p_user_id, v_item.id, v_item.version, v_agreed, p_source, v_hash);
  END LOOP;

  RETURN public.consent_latest_results(p_user_id, v_item_ids);
END;
$function$
;

-- 6-13. guard_user_consents_mutation
CREATE OR REPLACE FUNCTION public.guard_user_consents_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- [10번] 시작
    -- 익명화 거래 로컬 설정 값이 그 회원이면 DELETE 를 받는다(비결제 회원 익명화).
    IF COALESCE(current_setting('app.member_withdrawal_bypass', true), '') = OLD.user_id::text THEN
      RETURN OLD;
    END IF;
    -- [10번] 끝
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id) THEN
      RAISE EXCEPTION 'USER_CONSENTS_APPEND_ONLY';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'USER_CONSENTS_APPEND_ONLY';
END;
$function$
;

-- 6-14. guard_market_purchase_notice_acks_mutation
CREATE OR REPLACE FUNCTION public.guard_market_purchase_notice_acks_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- [10번] 시작
    -- 익명화 거래 로컬 설정 값이 그 회원이면 DELETE 를 받는다(비결제 회원 익명화).
    IF COALESCE(current_setting('app.member_withdrawal_bypass', true), '') = OLD.user_id::text THEN
      RETURN OLD;
    END IF;
    -- [10번] 끝
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id) THEN
      RAISE EXCEPTION 'MARKET_PURCHASE_NOTICE_ACKS_APPEND_ONLY';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'MARKET_PURCHASE_NOTICE_ACKS_APPEND_ONLY';
END;
$function$
;

-- 6-15. prevent_admin_event_mutation
CREATE OR REPLACE FUNCTION public.prevent_admin_event_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- [10번] 시작
  -- 익명화·가림 함수가 켠 거래 로컬 설정이 있을 때만, 그 회원 문의·환불(과 그 알림 포기 사본)의 title·body UPDATE 를 받는다.
  -- DELETE·TRUNCATE·다른 칸 변경은 계속 막는다.
  IF TG_OP = 'UPDATE'
     AND COALESCE(current_setting('app.member_withdrawal_bypass', true), '') <> ''
     AND NEW.id = OLD.id AND NEW.kind = OLD.kind AND NEW.severity = OLD.severity AND NEW.link = OLD.link
     AND NEW.ref_table IS NOT DISTINCT FROM OLD.ref_table AND NEW.ref_id IS NOT DISTINCT FROM OLD.ref_id
     AND NEW.required_permission = OLD.required_permission AND NEW.delivery = OLD.delivery
     AND NEW.dedupe_key IS NOT DISTINCT FROM OLD.dedupe_key AND NEW.created_at = OLD.created_at
     AND public.member_admin_event_owner(OLD.ref_table, OLD.ref_id)::text = current_setting('app.member_withdrawal_bypass', true) THEN
    RETURN NEW;
  END IF;
  -- [10번] 끝
  RAISE EXCEPTION 'ADMIN_EVENTS_APPEND_ONLY';
END;
$function$
;

-- 6-16. remind_unanswered_admin_work
CREATE OR REPLACE FUNCTION public.remind_unanswered_admin_work()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cfg jsonb;
  v_support_hours numeric;
  v_refund_hours numeric;
  v_from_hour numeric;
  v_until_hour numeric;
  v_now timestamptz := now();
  v_kst timestamp := now() AT TIME ZONE 'Asia/Seoul';
  v_day text;
BEGIN
  -- [10번] 시작
  -- 탈퇴 회원 로그인 계정 정리(서버의 소프트 삭제)가 10분 넘게 끝나지 않았으면 경보를 남긴다(서버가 정리 전에 멈춘 경우).
  -- 익명화 거래에서는 경보를 넣지 않는다(정리가 곧 성공하는 정상 경로마다 알림이 나가지 않게). 한 회원에 한 번만 넣는다.
  -- 보내는 시간대·알림 설정과 상관없이 먼저 본다.
  PERFORM public.record_payment_alert(
    'MEMBER_AUTH_SCRUB_PENDING',
    'warning',
    COALESCE(NULLIF(btrim(public.member_withdrawal_policy() -> 'texts' ->> 'alertAuthScrubPending'), ''), 'MEMBER_AUTH_SCRUB_PENDING'),
    jsonb_build_object('user_id', r.user_id, 'dedupe_key', 'member_auth_scrub:' || r.user_id))
    FROM public.withdrawn_member_records r
   WHERE r.auth_scrubbed_at IS NULL
     AND r.withdrawn_at <= now() - interval '10 minutes'
     AND NOT EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts a
                      WHERE a.code = 'MEMBER_AUTH_SCRUB_PENDING' AND (a.details ->> 'dedupe_key') = 'member_auth_scrub:' || r.user_id);
  -- [10번] 끝
  SELECT s.value -> 'reminders'
    INTO v_cfg
    FROM public.system_settings s
   WHERE s.key = 'admin_alert_settings';

  IF v_cfg IS NULL THEN
    RETURN;
  END IF;

  IF jsonb_typeof(v_cfg -> 'support_after_hours') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_cfg -> 'refund_after_hours') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_cfg -> 'send_from_hour') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_cfg -> 'send_until_hour') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'ADMIN_REMINDER_SETTINGS_INVALID';
  END IF;

  v_support_hours := (v_cfg ->> 'support_after_hours')::numeric;
  v_refund_hours := (v_cfg ->> 'refund_after_hours')::numeric;
  v_from_hour := (v_cfg ->> 'send_from_hour')::numeric;
  v_until_hour := (v_cfg ->> 'send_until_hour')::numeric;

  IF v_support_hours <= 0 OR v_refund_hours <= 0
     OR v_from_hour < 0 OR v_until_hour > 24 OR v_from_hour >= v_until_hour THEN
    RAISE EXCEPTION 'ADMIN_REMINDER_SETTINGS_INVALID';
  END IF;

  -- 보내는 시간대(한국 시각, 이상~미만) 밖이면 만들지 않는다.
  IF extract(hour FROM v_kst) < v_from_hour OR extract(hour FROM v_kst) >= v_until_hour THEN
    RETURN;
  END IF;

  v_day := to_char(v_kst, 'YYYY-MM-DD');

  INSERT INTO public.admin_events (kind, severity, title, body, link, ref_table, ref_id, required_permission, dedupe_key)
  SELECT
    'support_unanswered',
    'info',
    '답변 대기 문의'
      || COALESCE(' [' || COALESCE(
           t.category_snapshot ->> 'name',
           (SELECT c.name FROM public.support_ticket_categories c WHERE c.id = t.category_id)
         ) || ']', '')
      || ' ' || left(regexp_replace(t.subject, '\s+', ' ', 'g'), 30),
    format('접수 후 %s시간 지남', floor(extract(epoch FROM v_now - t.created_at) / 3600)),
    '/admin/support',
    'support_tickets',
    t.id,
    'support.manage',
    'support_unanswered:' || t.id || ':' || v_day
  FROM public.support_tickets t
  -- [10번] 시작
-- [10번 원래]   WHERE t.status = 'pending'
-- [10번 원래]     AND t.is_deleted_by_user = false
  WHERE t.status = 'pending'
    AND t.is_deleted_by_user = false
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = t.user_id AND p.withdrawn_at IS NOT NULL)
  -- [10번] 끝
    AND t.created_at <= v_now - make_interval(secs => (v_support_hours * 3600)::double precision)
  ON CONFLICT (dedupe_key) DO NOTHING;

  INSERT INTO public.admin_events (kind, severity, title, body, link, ref_table, ref_id, required_permission, dedupe_key)
  SELECT
    'refund_unanswered',
    'info',
    '처리 대기 문제마켓 환불',
    format('요청 %s크레딧 · 접수 후 %s시간 지남',
           r.requested_refund_credits,
           floor(extract(epoch FROM v_now - r.created_at) / 3600)),
    '/admin/refunds',
    'market_refund_requests',
    r.id,
    'refunds.market',
    'refund_unanswered:' || r.id || ':' || v_day
  FROM public.market_refund_requests r
  WHERE r.status = 'pending'
    AND r.created_at <= v_now - make_interval(secs => (v_refund_hours * 3600)::double precision)
  ON CONFLICT (dedupe_key) DO NOTHING;

  INSERT INTO public.admin_events (kind, severity, title, body, link, ref_table, ref_id, required_permission, dedupe_key)
  SELECT
    'refund_unanswered',
    'info',
    CASE WHEN r.status = 'pending_review' THEN '처리 대기 충전 환불' ELSE '확인이 필요한 충전 환불' END,
    concat_ws(' · ',
      '환불 금액 ' || r.refund_amount || '원',
      format('%s시간 지남', floor(extract(epoch FROM v_now - s.since) / 3600))),
    '/admin/refunds',
    'refund_requests',
    r.id,
    'refunds.payment',
    'refund_unanswered:' || r.id || ':' || v_day
  FROM public.refund_requests r
  CROSS JOIN LATERAL (
    SELECT CASE WHEN r.status = 'pending_review' THEN r.created_at ELSE COALESCE(r.updated_at, r.created_at) END AS since
  ) s
  WHERE r.status IN ('pending_review', 'retryable_failed', 'manual_review')
    AND s.since <= v_now - make_interval(secs => (v_refund_hours * 3600)::double precision)
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$function$
;

-- 6-17. guard_support_ticket_revisions_mutation
CREATE OR REPLACE FUNCTION public.guard_support_ticket_revisions_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = OLD.ticket_id) THEN
      RAISE EXCEPTION 'SUPPORT_TICKET_REVISIONS_APPEND_ONLY';
    END IF;
    RETURN OLD;
  END IF;
  -- [10번] 시작
  IF TG_OP = 'UPDATE'
     AND COALESCE(current_setting('app.member_withdrawal_bypass', true), '') <> ''
     AND current_setting('app.member_withdrawal_bypass', true)
         = (SELECT t.user_id::text FROM public.support_tickets t WHERE t.id = OLD.ticket_id)
     AND NEW.id = OLD.id AND NEW.ticket_id = OLD.ticket_id
     AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id
     AND NEW.written_at = OLD.written_at AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  -- [10번] 끝
  RAISE EXCEPTION 'SUPPORT_TICKET_REVISIONS_APPEND_ONLY';
END;
$function$
;

-- 6-18. cancel_incomplete_kakao_signup
CREATE OR REPLACE FUNCTION public.cancel_incomplete_kakao_signup(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_provider text;
  v_signup_completed boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'CONSENT_INPUT_INVALID';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('public.user_consents:' || p_user_id::text, 0));
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('public.signup_consent_items:write', 0));

  SELECT p.provider, p.signup_completed
    INTO v_provider, v_signup_completed
    FROM public.profiles p
   WHERE p.id = p_user_id
     FOR UPDATE;
  IF NOT FOUND OR v_provider IS DISTINCT FROM 'kakao' OR v_signup_completed IS TRUE THEN
    RETURN false;
  END IF;
  -- [10번] 시작
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.withdrawn_at IS NOT NULL) THEN
    RETURN false;
  END IF;
  -- [10번] 끝
  -- 관리자 계정은 여기서 지우지 않는다(탈퇴 route 와 같은 규칙).
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.is_admin IS TRUE) THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_orders o WHERE o.user_id = p_user_id)
     OR EXISTS (SELECT 1 FROM public.checkout_attempts a WHERE a.user_id = p_user_id) THEN
    RETURN false;
  END IF;

  DELETE FROM public.exam_papers WHERE user_id = p_user_id;
  DELETE FROM public.questions WHERE user_id = p_user_id;
  DELETE FROM public.support_tickets WHERE user_id = p_user_id;
  DELETE FROM public.credit_transactions WHERE user_id = p_user_id;
  RETURN true;
END;
$function$
;

-- 6-19. complete_kakao_signup_with_consents
CREATE OR REPLACE FUNCTION public.complete_kakao_signup_with_consents(p_user_id uuid, p_items jsonb, p_email text, p_phone text, p_kakao_email text, p_kakao_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_provider text;
  v_signup_completed boolean;
  v_profile jsonb;
  v_optional_ids uuid[];
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'CONSENT_INPUT_INVALID';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('public.user_consents:' || p_user_id::text, 0));
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('public.signup_consent_items:write', 0));

  SELECT p.provider, p.signup_completed
    INTO v_provider, v_signup_completed
    FROM public.profiles p
   WHERE p.id = p_user_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONSENT_PROFILE_MISSING';
  END IF;
  -- [10번] 시작
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.withdrawn_at IS NOT NULL) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAWN';
  END IF;
  -- [10번] 끝
  IF v_provider IS DISTINCT FROM 'kakao' THEN
    RAISE EXCEPTION 'CONSENT_KAKAO_NOT_KAKAO';
  END IF;

  IF v_signup_completed IS NOT TRUE THEN
    PERFORM public.consent_record_internal(p_user_id, p_items, 'kakao_signup');

    UPDATE public.profiles
       SET email = p_email,
           phone = NULLIF(btrim(COALESCE(p_phone, '')), ''),
           kakao_email = p_email,
           kakao_id = p_kakao_id,
           provider = 'kakao',
           signup_completed = true
     WHERE id = p_user_id;
  END IF;

  SELECT jsonb_build_object('id', p.id, 'email', p.email, 'phone', p.phone, 'signup_completed', p.signup_completed)
    INTO v_profile
    FROM public.profiles p
   WHERE p.id = p_user_id;

  SELECT COALESCE(array_agg(i.id), ARRAY[]::uuid[]) INTO v_optional_ids
    FROM public.signup_consent_items i
   WHERE NOT i.required;

  RETURN jsonb_build_object(
    'profile', v_profile,
    'consentResults', public.consent_latest_results(p_user_id, v_optional_ids)
  );
END;
$function$
;

-- 6-20. consent_eligible_member_count
CREATE OR REPLACE FUNCTION public.consent_eligible_member_count()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT count(*)::integer
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
   -- [10번] 시작
-- [10번 원래]    WHERE NOT public.is_internal_admin_account(u.email)
   WHERE NOT public.is_internal_admin_account(u.email)
     AND p.withdrawn_at IS NULL
   -- [10번] 끝
     AND (
       (p.provider = 'kakao' AND p.signup_completed IS TRUE)
       OR (p.provider IS DISTINCT FROM 'kakao' AND u.email_confirmed_at IS NOT NULL)
     )
$function$
;

-- 7. service_role 함수 ------------------------------------------------------------------------------------------
-- 오류는 RAISE EXCEPTION '<코드>' (필요하면 USING DETAIL = jsonb 문자열). 코드 단계에서 문구로 바꾼다.

-- 7-1. 미리보기(대표 회원 상세·회원 탈퇴 화면 판단). 회원 화면에는 서버가 필요한 값만 골라 보낸다.
CREATE OR REPLACE FUNCTION public.get_member_withdrawal_preview(p_user_id uuid, p_ticket_retention_agreed boolean DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_get_member_withdrawal_preview$
DECLARE
  v_facts jsonb;
  v_without jsonb;
  v_request jsonb;
  v_counts jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  v_facts := public.member_withdrawal_facts(p_user_id, COALESCE(p_ticket_retention_agreed, true));
  IF NOT COALESCE((v_facts ->> 'exists')::boolean, false) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_USER_NOT_FOUND';
  END IF;
  v_without := public.member_withdrawal_facts(p_user_id, false);

  SELECT jsonb_build_object(
           'id', r.id, 'channel', r.channel, 'requesterKind', r.requester_kind, 'receivedAt', r.received_at,
           'noticeSha256', r.notice_sha256, 'noticeSentAt', r.notice_sent_at, 'consentReplyReceivedAt', r.consent_reply_received_at,
           'ticketRetentionAgreed', r.ticket_retention_agreed, 'expectedBalance', r.expected_balance,
           'expectedForfeitPaid', r.expected_forfeit_paid, 'expectedForfeitFree', r.expected_forfeit_free,
           'marketingWithdrawnAt', r.marketing_withdrawn_at, 'createdAt', r.created_at)
    INTO v_request
    FROM public.member_withdrawal_requests r
   WHERE r.user_id = p_user_id AND r.status = 'pending';

  v_counts := jsonb_build_object(
    'tickets', (SELECT count(*) FROM public.support_tickets t WHERE t.user_id = p_user_id),
    'ticketRevisions', (SELECT count(*) FROM public.support_ticket_revisions rv JOIN public.support_tickets t ON t.id = rv.ticket_id WHERE t.user_id = p_user_id),
    'questions', (SELECT count(*) FROM public.questions q WHERE q.user_id = p_user_id),
    'examPapers', (SELECT count(*) FROM public.exam_papers e WHERE e.user_id = p_user_id),
    'passages', (SELECT count(*) FROM public.passages x WHERE x.user_id = p_user_id),
    'generationJobs', (SELECT count(*) FROM public.generate_listboard_generation_jobs j WHERE j.user_id = p_user_id),
    'generationRuns', (SELECT count(*) FROM public.ai_question_generation_runs g WHERE g.user_id = p_user_id),
    'testRuns', (SELECT count(*) FROM public.problem_type_test_runs x WHERE x.user_id = p_user_id),
    'reviews', (SELECT count(*) FROM public.market_item_reviews x WHERE x.user_id = p_user_id),
    'reviewVotes', (SELECT count(*) FROM public.market_item_review_votes x WHERE x.user_id = p_user_id),
    'notifications', (SELECT count(*) FROM public.notifications x WHERE x.user_id = p_user_id),
    'cartItems', (SELECT count(*) FROM public.market_cart_items x WHERE x.user_id = p_user_id),
    'viewEvents', (SELECT count(*) FROM public.market_item_view_events x WHERE x.user_id = p_user_id),
    'marketOrders', (SELECT count(*) FROM public.market_purchase_orders x WHERE x.user_id = p_user_id),
    'marketPurchases', (SELECT count(*) FROM public.market_purchases x WHERE x.user_id = p_user_id),
    'entitlements', (SELECT count(*) FROM public.market_entitlements x WHERE x.user_id = p_user_id),
    'downloads', (SELECT count(*) FROM public.market_download_events x WHERE x.user_id = p_user_id),
    'marketRefunds', (SELECT count(*) FROM public.market_refund_requests x WHERE x.user_id = p_user_id),
    'purchaseNoticeAcks', (SELECT count(*) FROM public.market_purchase_notice_acks x WHERE x.user_id = p_user_id),
    'creditSources', (SELECT count(*) FROM public.credit_sources x WHERE x.user_id = p_user_id),
    'creditTransactions', (SELECT count(*) FROM public.credit_transactions x WHERE x.user_id = p_user_id),
    'consents', (SELECT count(*) FROM public.user_consents x WHERE x.user_id = p_user_id),
    'paymentOrders', (SELECT count(*) FROM public.payment_orders x WHERE x.user_id = p_user_id),
    'checkoutAttempts', (SELECT count(*) FROM public.checkout_attempts x WHERE x.user_id = p_user_id),
    'pointRefunds', (SELECT count(*) FROM public.refund_requests x WHERE x.user_id = p_user_id),
    'checkoutAcks', (SELECT count(*) FROM public.point_charge_checkout_acks x WHERE x.user_id = p_user_id));

  RETURN v_facts || jsonb_build_object(
    'selfAllowedIfTicketsDeleted', v_without -> 'selfAllowed',
    'selfReasonsIfTicketsDeleted', v_without -> 'selfReasons',
    'fullDeleteIfTicketsDeleted', v_without -> 'fullDeleteAllowed',
    'openRequest', v_request,
    'counts', v_counts);
END;
$fn_get_member_withdrawal_preview$;

-- 7-2. 고지 원문 만들기(스스로 탈퇴 화면·결제 회원 요청 화면·대표의 [고지 원문 만들기]). 지금 값으로 만든다.
CREATE OR REPLACE FUNCTION public.get_member_withdrawal_notice(p_user_id uuid, p_kind text, p_ticket_retention_agreed boolean DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_get_member_withdrawal_notice$
DECLARE
  v_facts jsonb;
  v_text text;
BEGIN
  IF p_user_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('self', 'request') THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  v_facts := public.member_withdrawal_facts(p_user_id, COALESCE(p_ticket_retention_agreed, true));
  IF NOT COALESCE((v_facts ->> 'exists')::boolean, false) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_USER_NOT_FOUND';
  END IF;
  v_text := public.member_withdrawal_notice_text(p_kind, v_facts,
              CASE WHEN (v_facts ->> 'hadPayment')::boolean THEN NULL ELSE p_ticket_retention_agreed END);
  IF v_text IS NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_POLICY_UNAVAILABLE';
  END IF;
  RETURN jsonb_build_object(
    'kind', p_kind,
    'text', v_text,
    'sha256', encode(sha256(convert_to(v_text, 'UTF8')), 'hex'),
    'expectedBalance', (v_facts -> 'balance' ->> 'forfeitTotal')::integer,
    'expectedForfeitPaid', (v_facts -> 'balance' ->> 'forfeitPaid')::integer,
    'expectedForfeitFree', (v_facts -> 'balance' ->> 'forfeitFree')::integer,
    'paidCashValue', (v_facts -> 'balance' ->> 'paidCashValue')::integer,
    'hadPayment', (v_facts ->> 'hadPayment')::boolean);
END;
$fn_get_member_withdrawal_notice$;

-- 7-3. 탈퇴 요청 만들기. screen = 결제 회원 본인 화면(회원 세션 API), email·phone = 대표 기록(회원 종류 상관없음).
--      facts 를 다시 확인하고, 고지 원문은 서버가 다시 만들어 지문을 대조한다. 마케팅 동의 중이면 바로 철회 1건(source withdrawal).
CREATE OR REPLACE FUNCTION public.create_member_withdrawal_request(p_user_id uuid, p_channel text, p_notice_text text, p_notice_sha256 text,
  p_expected_balance integer, p_expected_forfeit_paid integer, p_expected_forfeit_free integer, p_identity_note text, p_recorded_by uuid,
  p_ticket_retention_agreed boolean DEFAULT NULL, p_requester_kind text DEFAULT 'self', p_received_at timestamp with time zone DEFAULT NULL,
  p_notice_sent_at timestamp with time zone DEFAULT NULL, p_consent_reply_received_at timestamp with time zone DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_create_member_withdrawal_request$
DECLARE
  v_policy jsonb := public.member_withdrawal_policy();
  v_profile public.profiles%ROWTYPE;
  v_facts jsonb;
  v_payer boolean;
  v_retention boolean;
  v_text text;
  v_sha text;
  v_item public.signup_consent_items%ROWTYPE;
  v_marketing_at timestamptz;
  v_id uuid;
  v_note text := NULLIF(btrim(p_identity_note), '');
BEGIN
  IF p_user_id IS NULL OR p_channel IS NULL OR p_channel NOT IN ('screen', 'email', 'phone') OR p_recorded_by IS NULL
     OR p_notice_sha256 IS NULL OR p_notice_sha256 !~ '^[0-9a-f]{64}$'
     OR p_expected_balance IS NULL OR p_expected_forfeit_paid IS NULL OR p_expected_forfeit_free IS NULL
     OR p_expected_balance < 0 OR p_expected_forfeit_paid < 0 OR p_expected_forfeit_free < 0
     OR p_expected_balance <> p_expected_forfeit_paid + p_expected_forfeit_free
     OR p_requester_kind IS NULL OR p_requester_kind NOT IN ('self', 'legal_guardian', 'agent')
     OR (v_note IS NOT NULL AND length(v_note) > 500)
     OR (p_notice_sent_at IS NOT NULL AND p_notice_sent_at > clock_timestamp())
     OR (p_consent_reply_received_at IS NOT NULL AND (p_consent_reply_received_at > clock_timestamp()
                                                      OR p_notice_sent_at IS NULL OR p_consent_reply_received_at < p_notice_sent_at))
     OR (p_received_at IS NOT NULL AND p_received_at > clock_timestamp())
     OR (p_channel = 'screen' AND (p_recorded_by <> p_user_id OR p_requester_kind <> 'self' OR v_note IS NOT NULL
                                  OR p_received_at IS NOT NULL OR p_notice_sent_at IS NOT NULL OR p_consent_reply_received_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  IF p_channel = 'screen' THEN
    IF (v_policy -> 'selfAnonymizeEnabled') IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION 'MEMBER_WITHDRAW_SELF_NOT_ALLOWED' USING DETAIL = '{"reason":"DISABLED"}';
    END IF;
  ELSE
    PERFORM public.member_withdrawal_require_owner(p_recorded_by);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('public.user_consents:' || p_user_id::text, 0));
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('public.signup_consent_items:write', 0));
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_USER_NOT_FOUND';
  END IF;
  IF v_profile.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_ALREADY_WITHDRAWN';
  END IF;
  IF v_profile.is_admin IS TRUE THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_ADMIN';
  END IF;

  v_facts := public.member_withdrawal_facts(p_user_id, true);
  v_payer := (v_facts ->> 'hadPayment')::boolean;
  IF p_channel = 'screen' AND NOT v_payer THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_REQUEST_INVALID' USING DETAIL = '{"reason":"NOT_PAYER"}';
  END IF;
  IF p_channel = 'screen' AND COALESCE((v_facts -> 'balance' ->> 'paidCashValueUnknown')::boolean, false) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_REQUEST_INVALID' USING DETAIL = '{"reason":"CASH_VALUE_UNKNOWN"}';
  END IF;
  IF v_facts ->> 'openRequestId' IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_REQUEST_EXISTS' USING DETAIL = jsonb_build_object('requestId', v_facts ->> 'openRequestId')::text;
  END IF;
  IF (v_facts ->> 'inProgressTotal')::integer > 0 THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_IN_PROGRESS' USING DETAIL = (v_facts -> 'inProgress')::text;
  END IF;
  IF jsonb_array_length(v_facts -> 'refundPeriodOpen') > 0 THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_REFUND_PERIOD_OPEN' USING DETAIL = (v_facts -> 'refundPeriodOpen')::text;
  END IF;
  IF (v_facts -> 'balance' ->> 'forfeitTotal')::integer <> p_expected_balance
     OR (v_facts -> 'balance' ->> 'forfeitPaid')::integer <> p_expected_forfeit_paid
     OR (v_facts -> 'balance' ->> 'forfeitFree')::integer <> p_expected_forfeit_free THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_BALANCE_CHANGED' USING DETAIL = jsonb_build_object(
      'forfeitTotal', v_facts -> 'balance' -> 'forfeitTotal', 'forfeitPaid', v_facts -> 'balance' -> 'forfeitPaid',
      'forfeitFree', v_facts -> 'balance' -> 'forfeitFree')::text;
  END IF;

  -- 결제 회원은 문의를 늘 보존(선택 없음). 비결제 회원(email·phone)은 회신으로 받은 선택만 남긴다.
  v_retention := CASE WHEN v_payer THEN NULL ELSE p_ticket_retention_agreed END;
  v_text := public.member_withdrawal_notice_text('request', v_facts, v_retention);
  IF v_text IS NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_POLICY_UNAVAILABLE';
  END IF;
  v_sha := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');
  IF v_sha <> p_notice_sha256 OR (p_notice_text IS NOT NULL AND p_notice_text <> v_text) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_NOTICE_INVALID';
  END IF;

  IF (v_facts ->> 'marketingAgreed')::boolean THEN
    SELECT * INTO v_item FROM public.signup_consent_items i WHERE i.key = (v_policy ->> 'marketingConsentItemKey');
    PERFORM public.consent_record_internal(p_user_id,
      jsonb_build_array(jsonb_build_object('item_id', v_item.id, 'version', v_item.version, 'agreed', false)), 'withdrawal');
    v_marketing_at := now();
  END IF;

  INSERT INTO public.member_withdrawal_requests (
    user_id, channel, requester_kind, received_at, notice_text, notice_sha256, notice_sent_at, consent_reply_received_at,
    ticket_retention_agreed, expected_balance, expected_forfeit_paid, expected_forfeit_free, marketing_withdrawn_at,
    identity_note, recorded_by
  ) VALUES (
    p_user_id, p_channel, p_requester_kind, COALESCE(p_received_at, clock_timestamp()), v_text, v_sha, p_notice_sent_at,
    p_consent_reply_received_at, v_retention, p_expected_balance, p_expected_forfeit_paid, p_expected_forfeit_free,
    v_marketing_at, v_note, p_recorded_by
  )
  RETURNING id INTO v_id;

  IF p_channel <> 'screen' THEN
    PERFORM public.record_admin_audit(p_recorded_by, 'member_withdraw_request', 'member_withdrawal_request', v_id::text, p_user_id,
      p_expected_balance, NULL, jsonb_build_object('channel', p_channel, 'requester_kind', p_requester_kind,
        'expected_forfeit_paid', p_expected_forfeit_paid, 'marketing_withdrawn', v_marketing_at IS NOT NULL), NULL);
  END IF;

  RETURN jsonb_build_object(
    'requestId', v_id,
    'status', 'pending',
    'noticeSha256', v_sha,
    'marketing', CASE WHEN v_marketing_at IS NULL THEN NULL ELSE jsonb_build_object(
      'sender', (SELECT s.value ->> 'name' FROM public.system_settings s WHERE s.key = 'site_brand'),
      'withdrawnAt', v_marketing_at,
      'result', public.member_withdrawal_policy() -> 'texts' ->> 'marketingResult') END);
END;
$fn_create_member_withdrawal_request$;

-- 7-4. email·phone 요청의 고지 발송·동의 회신·문의 보존 선택 기록(대표, pending 동안 비어 있는 칸만 채움)
CREATE OR REPLACE FUNCTION public.record_member_withdrawal_request_reply(p_actor_id uuid, p_request_id uuid,
  p_notice_sent_at timestamp with time zone, p_consent_reply_received_at timestamp with time zone, p_ticket_retention_agreed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_record_member_withdrawal_request_reply$
DECLARE
  v_request public.member_withdrawal_requests%ROWTYPE;
  v_sent timestamptz;
  v_reply timestamptz;
  v_retention boolean;
  v_payer boolean;
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  SELECT * INTO v_request FROM public.member_withdrawal_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'pending' OR v_request.channel NOT IN ('email', 'phone') THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_REQUEST_INVALID';
  END IF;
  v_payer := (public.member_withdrawal_facts(v_request.user_id, true) ->> 'hadPayment')::boolean;
  v_sent := COALESCE(v_request.notice_sent_at, p_notice_sent_at);
  v_reply := COALESCE(v_request.consent_reply_received_at, p_consent_reply_received_at);
  v_retention := CASE WHEN v_payer THEN NULL ELSE COALESCE(v_request.ticket_retention_agreed, p_ticket_retention_agreed) END;
  IF (v_request.notice_sent_at IS NOT NULL AND p_notice_sent_at IS NOT NULL AND p_notice_sent_at <> v_request.notice_sent_at)
     OR (v_request.consent_reply_received_at IS NOT NULL AND p_consent_reply_received_at IS NOT NULL
         AND p_consent_reply_received_at <> v_request.consent_reply_received_at)
     OR (v_request.ticket_retention_agreed IS NOT NULL AND p_ticket_retention_agreed IS NOT NULL
         AND p_ticket_retention_agreed <> v_request.ticket_retention_agreed)
     OR (v_sent IS NOT NULL AND v_sent > clock_timestamp())
     OR (v_reply IS NOT NULL AND (v_sent IS NULL OR v_reply < v_sent OR v_reply > clock_timestamp())) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;

  UPDATE public.member_withdrawal_requests
     SET notice_sent_at = v_sent,
         consent_reply_received_at = v_reply,
         ticket_retention_agreed = v_retention
   WHERE id = v_request.id;

  PERFORM public.record_admin_audit(p_actor_id, 'member_withdraw_request_reply', 'member_withdrawal_request', v_request.id::text,
    v_request.user_id, NULL, NULL, jsonb_build_object('notice_sent_at', v_sent, 'consent_reply_received_at', v_reply,
      'ticket_retention_agreed', v_retention), NULL);

  RETURN jsonb_build_object('requestId', v_request.id, 'noticeSentAt', v_sent, 'consentReplyReceivedAt', v_reply,
                            'ticketRetentionAgreed', v_retention);
END;
$fn_record_member_withdrawal_request_reply$;

-- 7-5. 요청 취소(회원 화면·대표). 요청 때 남긴 마케팅 철회는 되돌리지 않는다.
CREATE OR REPLACE FUNCTION public.cancel_member_withdrawal_request(p_user_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_cancel_member_withdrawal_request$
DECLARE
  v_request public.member_withdrawal_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM public.member_withdrawal_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.user_id IS DISTINCT FROM p_user_id OR v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_REQUEST_INVALID';
  END IF;
  UPDATE public.member_withdrawal_requests SET status = 'canceled' WHERE id = v_request.id;
  RETURN jsonb_build_object('requestId', v_request.id, 'status', 'canceled', 'marketingWithdrawnAt', v_request.marketing_withdrawn_at);
END;
$fn_cancel_member_withdrawal_request$;

-- 7-6. 익명화(계획 5-2). 한 거래 안에서 처리한다. 40P01·40001(MEMBER_WITHDRAW_STATE_CHANGED)은 서버가 같은 키로 2회까지 다시 시도한다.
--      p_method 'self'(비결제·결제 시도만 회원 본인, p_actor_id = p_user_id) | 'owner'(대표, 요청 필수).
CREATE OR REPLACE FUNCTION public.anonymize_member(p_actor_id uuid, p_user_id uuid, p_method text, p_request_id uuid,
  p_expected_balance integer, p_notice_text text, p_provider_unverified_confirmed boolean, p_reason text, p_operation_key text,
  p_ticket_retention_agreed boolean DEFAULT NULL, p_pending_tickets_confirmed boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_anonymize_member$
DECLARE
  v_policy jsonb := public.member_withdrawal_policy();
  v_texts jsonb := public.member_withdrawal_policy() -> 'texts';
  v_now timestamptz := now();
  v_profile public.profiles%ROWTYPE;
  v_existing public.withdrawn_member_records%ROWTYPE;
  v_request public.member_withdrawal_requests%ROWTYPE;
  v_pre jsonb;
  v_facts jsonb;
  v_pre_payer boolean;
  v_payer boolean;
  v_retention boolean;
  v_retain_tickets boolean;
  v_agreed_total integer;
  v_agreed_paid integer;
  v_agreed_free integer;
  v_total integer;
  v_paid integer;
  v_free integer;
  v_expired integer;
  v_notice text;
  v_notice_sha text;
  v_src record;
  v_last_at timestamptz;
  v_at timestamptz;
  v_forfeit_rows integer := 0;
  v_latest_balance integer;
  v_item public.signup_consent_items%ROWTYPE;
  v_marketing_at timestamptz;
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
  v_closed_tickets integer := 0;
  v_result jsonb;
  v_kakao text;
  v_reason text := NULLIF(btrim(p_reason), '');
  v_forfeit_desc text := NULLIF(btrim(public.member_withdrawal_policy() -> 'texts' ->> 'forfeitDescription'), '');
  v_cleanup_desc text := NULLIF(btrim(public.member_withdrawal_policy() -> 'texts' ->> 'cleanupDescription'), '');
  v_marketing_result text := NULLIF(btrim(public.member_withdrawal_policy() -> 'texts' ->> 'marketingResult'), '');
  v_new_sources jsonb;
BEGIN
  -- 0. 입력
  IF p_user_id IS NULL OR p_actor_id IS NULL OR p_method IS NULL OR p_method NOT IN ('self', 'owner')
     OR NULLIF(btrim(p_operation_key), '') IS NULL OR length(p_operation_key) > 200
     OR (v_reason IS NOT NULL AND length(v_reason) > 500)
     OR (p_method = 'self' AND (p_actor_id <> p_user_id OR p_request_id IS NOT NULL OR p_expected_balance IS NULL
                                OR p_expected_balance < 0 OR p_notice_text IS NULL OR p_ticket_retention_agreed IS NULL)) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  IF v_forfeit_desc IS NULL OR v_cleanup_desc IS NULL OR v_marketing_result IS NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_POLICY_UNAVAILABLE';
  END IF;

  -- 1. 잠금: 동의 advisory 두 개
  PERFORM pg_advisory_xact_lock(hashtextextended('public.user_consents:' || p_user_id::text, 0));
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('public.signup_consent_items:write', 0));

  -- 2. 재요청(같은 키는 저장한 결과, 다른 키는 거절)
  SELECT * INTO v_existing FROM public.withdrawn_member_records WHERE user_id = p_user_id;
  IF FOUND THEN
    IF v_existing.operation_key = p_operation_key THEN
      RETURN v_existing.result || jsonb_build_object('replay', true);
    END IF;
    RAISE EXCEPTION 'MEMBER_ALREADY_WITHDRAWN';
  END IF;
  IF EXISTS (SELECT 1 FROM public.withdrawn_member_records r WHERE r.operation_key = p_operation_key) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;

  -- 3. 잠금 전 임시 판정으로 경로를 고른다. 비결제·결제 시도만 경로는 주문·결제 시도를 id 순으로 먼저 잠근다(fulfill·begin 과 같은 순서).
  v_pre := public.member_withdrawal_facts(p_user_id, true);
  IF NOT COALESCE((v_pre ->> 'exists')::boolean, false) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_USER_NOT_FOUND';
  END IF;
  v_pre_payer := (v_pre ->> 'hadPayment')::boolean;
  IF NOT v_pre_payer THEN
    PERFORM 1 FROM public.payment_orders o WHERE o.user_id = p_user_id ORDER BY o.id FOR UPDATE;
    PERFORM 1 FROM public.checkout_attempts a WHERE a.user_id = p_user_id ORDER BY a.id FOR UPDATE;
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF v_profile.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_ALREADY_WITHDRAWN';
  END IF;
  PERFORM 1 FROM public.credit_sources s WHERE s.user_id = p_user_id ORDER BY s.id FOR UPDATE;
  IF p_method = 'owner' AND p_request_id IS NOT NULL THEN
    SELECT * INTO v_request FROM public.member_withdrawal_requests WHERE id = p_request_id FOR UPDATE;
  ELSIF p_method = 'self' THEN
    -- 대표가 기록한 열린 요청(email·phone)이 있으면 이 익명화로 함께 닫는다(요청 때 철회한 마케팅 시각도 결과에 쓴다).
    SELECT * INTO v_request FROM public.member_withdrawal_requests WHERE user_id = p_user_id AND status = 'pending' FOR UPDATE;
  END IF;

  -- 4. 잠금 뒤 판정
  v_facts := public.member_withdrawal_facts(p_user_id, true);
  v_payer := (v_facts ->> 'hadPayment')::boolean;
  IF v_payer AND NOT v_pre_payer THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'MEMBER_WITHDRAW_STATE_CHANGED';
  END IF;
  IF p_method = 'self' THEN
    v_retention := p_ticket_retention_agreed;
  ELSIF v_payer THEN
    v_retention := NULL;
  ELSE
    -- email·phone 경로: 회신이 없으면 '동의 안 함(삭제)'
    v_retention := COALESCE(v_request.ticket_retention_agreed, false);
  END IF;
  v_retain_tickets := v_payer OR v_retention IS TRUE;
  IF NOT v_retain_tickets THEN
    v_facts := public.member_withdrawal_facts(p_user_id, false);
  END IF;

  -- 5. 거절(계획 3절 정의)
  IF v_profile.is_admin IS TRUE THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_ADMIN';
  END IF;
  IF p_method = 'owner' THEN
    PERFORM public.member_withdrawal_require_owner(p_actor_id);
    IF p_actor_id = p_user_id THEN
      RAISE EXCEPTION 'MEMBER_WITHDRAW_ACTOR_NOT_OWNER';
    END IF;
  ELSE
    IF (v_policy -> 'selfAnonymizeEnabled') IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION 'MEMBER_WITHDRAW_SELF_NOT_ALLOWED' USING DETAIL = '{"reason":"DISABLED"}';
    END IF;
    IF v_payer THEN
      RAISE EXCEPTION 'MEMBER_WITHDRAW_SELF_NOT_ALLOWED' USING DETAIL = '{"reason":"PAYER"}';
    END IF;
    IF v_facts -> 'selfReasons' ? 'RECENT_PAYMENT_ACTIVITY' THEN
      RAISE EXCEPTION 'MEMBER_WITHDRAW_SELF_NOT_ALLOWED'
        USING DETAIL = jsonb_build_object('reason', 'RECENT_PAYMENT_ACTIVITY', 'quietUntil', v_facts -> 'quietUntil')::text;
    END IF;
  END IF;
  IF (v_facts ->> 'inProgressTotal')::integer > 0 THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_IN_PROGRESS' USING DETAIL = (v_facts -> 'inProgress')::text;
  END IF;
  IF jsonb_array_length(v_facts -> 'refundPeriodOpen') > 0 THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_REFUND_PERIOD_OPEN' USING DETAIL = (v_facts -> 'refundPeriodOpen')::text;
  END IF;
  IF jsonb_array_length(v_facts -> 'providerUnverified') > 0
     AND (p_method = 'self' OR p_provider_unverified_confirmed IS NOT TRUE) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_PROVIDER_UNVERIFIED' USING DETAIL = (v_facts -> 'providerUnverified')::text;
  END IF;
  IF jsonb_array_length(v_facts -> 'redactionRequired') > 0 THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_REDACTION_REQUIRED' USING DETAIL = (v_facts -> 'redactionRequired')::text;
  END IF;

  v_total := (v_facts -> 'balance' ->> 'forfeitTotal')::integer;
  v_paid := (v_facts -> 'balance' ->> 'forfeitPaid')::integer;
  v_free := (v_facts -> 'balance' ->> 'forfeitFree')::integer;
  v_expired := (v_facts -> 'balance' ->> 'expired')::integer;

  IF p_method = 'owner' THEN
    IF v_request.id IS NULL OR v_request.user_id <> p_user_id OR v_request.status <> 'pending'
       OR (NOT v_payer AND v_request.channel NOT IN ('email', 'phone'))
       OR (v_request.channel IN ('email', 'phone') AND (v_paid > 0 OR v_request.expected_forfeit_paid > 0)
           AND (v_request.notice_sent_at IS NULL OR v_request.consent_reply_received_at IS NULL))
       OR (NOT v_payer AND p_ticket_retention_agreed IS NOT NULL AND p_ticket_retention_agreed IS DISTINCT FROM v_retention)
       OR (p_expected_balance IS NOT NULL AND p_expected_balance <> v_request.expected_balance) THEN
      RAISE EXCEPTION 'MEMBER_WITHDRAW_REQUEST_INVALID';
    END IF;
    IF (v_facts ->> 'pendingTicketCount')::integer > 0 AND p_pending_tickets_confirmed IS NOT TRUE THEN
      RAISE EXCEPTION 'MEMBER_WITHDRAW_PENDING_TICKETS_UNCONFIRMED'
        USING DETAIL = jsonb_build_object('pendingTicketCount', v_facts -> 'pendingTicketCount')::text;
    END IF;
    -- 요청을 받은 뒤 새로 생긴 크레딧(유료는 뿌리 원천 credit_source_paid_root, 무상은 그 원천의 생성 시각이 요청보다 늦음)이
    -- 지금 소멸 대상이면 거절한다. 고지에 없던 원천이라 옛 동의로 소멸시키지 않는다(합계가 동의 값 이하여도, 대표가 지급한 무상 포함).
    -- 요청을 취소하고 회원에게 다시 요청받는다.
    SELECT COALESCE(jsonb_agg(b.e -> 'source_id' ORDER BY b.e ->> 'source_id'), '[]'::jsonb) INTO v_new_sources
      FROM jsonb_array_elements(v_facts -> 'balance' -> 'breakdown') AS b(e)
      JOIN public.credit_sources c ON c.id = COALESCE(b.e ->> 'paid_root_id', b.e ->> 'source_id')::uuid
     WHERE (b.e ->> 'forfeited')::integer > 0
       AND c.created_at > v_request.created_at;
    IF jsonb_array_length(v_new_sources) > 0 THEN
      RAISE EXCEPTION 'MEMBER_WITHDRAW_NEW_CHARGE' USING DETAIL = jsonb_build_object('sourceIds', v_new_sources)::text;
    END IF;
    v_agreed_total := v_request.expected_balance;
    v_agreed_paid := v_request.expected_forfeit_paid;
    v_agreed_free := v_request.expected_forfeit_free;
  ELSE
    v_agreed_total := p_expected_balance;
    v_agreed_paid := 0;
    v_agreed_free := p_expected_balance;
  END IF;

  -- 동의한 금액보다 크면 거절(같거나 작으면 받고 두 값을 결과에 남긴다)
  IF v_total > v_agreed_total OR v_paid > v_agreed_paid OR v_free > v_agreed_free THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_BALANCE_CHANGED' USING DETAIL = jsonb_build_object(
      'forfeitTotal', v_total, 'forfeitPaid', v_paid, 'forfeitFree', v_free,
      'agreedTotal', v_agreed_total, 'agreedPaid', v_agreed_paid, 'agreedFree', v_agreed_free)::text;
  END IF;

  IF p_method = 'self' THEN
    v_notice := public.member_withdrawal_notice_text('self', v_facts, v_retention);
    IF v_notice IS NULL THEN
      RAISE EXCEPTION 'MEMBER_WITHDRAW_POLICY_UNAVAILABLE';
    END IF;
    IF v_notice IS DISTINCT FROM p_notice_text THEN
      RAISE EXCEPTION 'MEMBER_WITHDRAW_NOTICE_INVALID';
    END IF;
    v_notice_sha := encode(sha256(convert_to(v_notice, 'UTF8')), 'hex');
  ELSE
    v_notice := v_request.notice_text;
    v_notice_sha := v_request.notice_sha256;
  END IF;

  -- 6. 처리(이 거래 안에서만 가드 예외)
  PERFORM set_config('app.member_withdrawal_bypass', p_user_id::text, true);
  -- 6-0. 그 회원 문의·환불의 관리자 이벤트 제목·본문을 먼저 '탈퇴 회원 문의'로 바꾼다(대상 행을 지우기 전에).
  v_n := public.member_withdrawal_scrub_admin_events(p_user_id);
  v_counts := v_counts || jsonb_build_object('adminEventsScrubbed', v_n);

  IF v_payer THEN
    -- 6-1. 소멸: 만료 전 잔량은 withdrawal_forfeit(음수, balance_after 0), 만료 잔량은 거래 없이 0
    SELECT max(t.created_at) INTO v_last_at FROM public.credit_transactions t WHERE t.user_id = p_user_id;
    FOR v_src IN
      SELECT s.id, s.remaining_credits, s.expires_at
        FROM public.credit_sources s
       WHERE s.user_id = p_user_id AND s.remaining_credits > 0
       ORDER BY s.id
    LOOP
      UPDATE public.credit_sources SET remaining_credits = 0 WHERE id = v_src.id;
      IF v_src.expires_at IS NULL OR v_src.expires_at > v_now THEN
        v_at := GREATEST(clock_timestamp(), COALESCE(v_last_at + interval '1 microsecond', '-infinity'::timestamptz));
        INSERT INTO public.credit_transactions (user_id, type, amount, balance_after, description, source_id, resource_type, operation_key, created_at)
        VALUES (p_user_id, 'withdrawal_forfeit', -v_src.remaining_credits, 0, v_forfeit_desc, v_src.id, 'member_withdrawal',
                p_operation_key || ':' || v_src.id, v_at);
        v_last_at := v_at;
        v_forfeit_rows := v_forfeit_rows + 1;
      END IF;
    END LOOP;
    IF v_forfeit_rows = 0 THEN
      SELECT t.balance_after INTO v_latest_balance
        FROM public.credit_transactions t
       WHERE t.user_id = p_user_id
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT 1;
      IF FOUND AND v_latest_balance <> 0 THEN
        v_at := GREATEST(clock_timestamp(), COALESCE(v_last_at + interval '1 microsecond', '-infinity'::timestamptz));
        INSERT INTO public.credit_transactions (user_id, type, amount, balance_after, description, source_id, resource_type, operation_key, created_at)
        VALUES (p_user_id, 'withdrawal_forfeit', 0, 0, v_cleanup_desc, NULL, 'member_withdrawal', p_operation_key || ':cleanup', v_at);
        v_forfeit_rows := v_forfeit_rows + 1;
      END IF;
    END IF;
    v_counts := v_counts || jsonb_build_object('forfeitTransactions', v_forfeit_rows);

    -- 6-2. 동의: 마케팅 최신 기록(판과 상관없이 최신 seq)이 동의면 철회 1건. 요청 단계에서 이미 철회해 지금 철회 상태면 건너뛰고 그 시각을 쓴다.
    IF (v_facts ->> 'marketingAgreed')::boolean THEN
      SELECT * INTO v_item FROM public.signup_consent_items i WHERE i.key = (v_policy ->> 'marketingConsentItemKey');
      PERFORM public.consent_record_internal(p_user_id,
        jsonb_build_array(jsonb_build_object('item_id', v_item.id, 'version', v_item.version, 'agreed', false)), 'withdrawal');
      v_marketing_at := now();
    ELSIF v_request.marketing_withdrawn_at IS NOT NULL THEN
      v_marketing_at := v_request.marketing_withdrawn_at;
    END IF;

    -- 6-3. 다운로드 기록은 행을 남기고 접속 정보만 지운다.
    UPDATE public.market_download_events SET ip_address = NULL, user_agent = NULL
     WHERE user_id = p_user_id AND (ip_address IS NOT NULL OR user_agent IS NOT NULL);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('downloadsScrubbed', v_n);
  ELSE
    -- 6-1'. 비결제·결제 시도만: 자료 구매·크레딧·동의 기록을 지운다(결정 6).
    IF (v_facts ->> 'marketingAgreed')::boolean THEN
      v_marketing_at := now();
    ELSIF v_request.marketing_withdrawn_at IS NOT NULL THEN
      v_marketing_at := v_request.marketing_withdrawn_at;
    END IF;
    DELETE FROM public.market_download_events WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('downloads', v_n);
    DELETE FROM public.market_entitlements WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('entitlements', v_n);
    DELETE FROM public.market_refund_requests WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('marketRefunds', v_n);
    DELETE FROM public.market_purchase_orders WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('marketOrders', v_n);
    DELETE FROM public.market_checkout_batches WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('checkoutBatches', v_n);
    DELETE FROM public.market_purchases WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('marketPurchases', v_n);
    DELETE FROM public.credit_consumption WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('creditConsumption', v_n);
    DELETE FROM public.credit_transactions WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('creditTransactions', v_n);
    DELETE FROM public.credit_sources WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('creditSources', v_n);
    DELETE FROM public.market_purchase_notice_acks WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('purchaseNoticeAcks', v_n);
    DELETE FROM public.user_consents WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('consents', v_n);
    -- 결제 시도·주문의 request_fingerprint 는 되돌릴 수 없는 임의 값으로 바꾼다(주문 쪽은 스냅숏 가드가 그 한 칸만 허용).
    UPDATE public.checkout_attempts
       SET request_fingerprint = encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex'),
           updated_at = now()
     WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('attemptFingerprints', v_n);
    UPDATE public.payment_orders
       SET request_fingerprint = encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex')
     WHERE user_id = p_user_id AND request_fingerprint IS NOT NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('orderFingerprints', v_n);
  END IF;

  -- 6-4. 모든 경로: 후기·추천, 문제·문제지·지문·생성 작업·생성 기록·시험 실행, 알림, 장바구니 삭제, 조회 기록 user_id 비움
  DELETE FROM public.market_item_review_votes WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('reviewVotes', v_n);
  DELETE FROM public.market_item_reviews WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('reviews', v_n);
  DELETE FROM public.exam_papers WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('examPapers', v_n);
  DELETE FROM public.questions WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('questions', v_n);
  DELETE FROM public.passages WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('passages', v_n);
  DELETE FROM public.generate_listboard_generation_jobs WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('generationJobs', v_n);
  DELETE FROM public.ai_question_generation_runs WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('generationRuns', v_n);
  DELETE FROM public.problem_type_test_runs WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('testRuns', v_n);
  DELETE FROM public.notifications WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('notifications', v_n);
  DELETE FROM public.market_cart_items WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('cartItems', v_n);
  UPDATE public.market_item_view_events SET user_id = NULL WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('viewEventsUnlinked', v_n);

  -- 6-5. 문의: 보존하면 대기·처리 중을 닫고(감사 기록에 건수), 아니면 지운다(수정 이력 CASCADE).
  IF v_retain_tickets THEN
    UPDATE public.support_tickets
       SET status = 'closed',
           updated_at = timezone('utc'::text, now())
     WHERE user_id = p_user_id AND status IN ('pending', 'in_progress');
    GET DIAGNOSTICS v_closed_tickets = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('ticketsClosed', v_closed_tickets,
      'ticketsKept', (SELECT count(*) FROM public.support_tickets t WHERE t.user_id = p_user_id));
  ELSE
    DELETE FROM public.support_tickets WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ticketsDeleted', v_n);
  END IF;

  -- 6-6. 프로필
  v_kakao := CASE WHEN v_profile.provider = 'kakao' THEN NULLIF(btrim(v_profile.kakao_id), '') END;
  UPDATE public.profiles
     SET email = NULL, phone = NULL, birthdate = NULL, organization = NULL, gender = NULL, address = NULL,
         kakao_id = NULL, kakao_email = NULL, avatar_url = NULL,
         display_tag = public.generate_member_display_tag(),
         withdrawn_at = v_now,
         credits = 0,
         updated_at = timezone('utc'::text, now())
   WHERE id = p_user_id;

  -- 6-7. 로그인 차단(이미 발급된 JWT 는 최대 1시간 — 그 사이 쓰기는 가드 트리거가 막는다)
  UPDATE auth.users SET banned_until = v_now + interval '100 years' WHERE id = p_user_id;
  DELETE FROM auth.sessions WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('sessions', v_n);
  DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
  DELETE FROM auth.flow_state WHERE user_id = p_user_id;
  DELETE FROM auth.one_time_tokens WHERE user_id = p_user_id;

  -- 6-8. 대표 확인 필요 경보(회원 화면에서 막혔던 기록)는 익명화로 처리가 끝났으므로 푼다.
  UPDATE public.payment_reconciliation_alerts
     SET resolved_at = now()
   WHERE resolved_at IS NULL
     AND code = 'MEMBER_WITHDRAW_REVIEW_NEEDED'
     AND (details ->> 'dedupe_key') = 'member_withdraw_review:' || p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('reviewAlertsResolved', v_n);

  -- 6-9. 결과·보관함(결과까지 계산한 뒤 한 번에 INSERT)
  v_result := jsonb_build_object(
    'withdrawn', true,
    'userId', p_user_id,
    'method', p_method,
    'withdrawnAt', v_now,
    'operationKey', p_operation_key,
    'hadPayment', v_payer,
    'forfeited', v_total,
    'forfeitedPaid', v_paid,
    'forfeitedFree', v_free,
    'expiredCleared', v_expired,
    'agreed', jsonb_build_object('balance', v_agreed_total, 'paid', v_agreed_paid, 'free', v_agreed_free),
    'ticketsRetained', v_retain_tickets,
    'counts', v_counts,
    'marketing', CASE WHEN v_marketing_at IS NULL THEN NULL ELSE jsonb_build_object(
      'sender', (SELECT s.value ->> 'name' FROM public.system_settings s WHERE s.key = 'site_brand'),
      'withdrawnAt', v_marketing_at,
      'result', v_marketing_result) END,
    'kakaoUnlinkPending', v_kakao IS NOT NULL,
    'authScrubPending', true);

  INSERT INTO public.withdrawn_member_records (
    user_id, operation_key, withdrawn_at, method, actor_id, request_id, reason, consent_notice_text, consent_notice_sha256,
    email, phone, kakao_email, kakao_id_pending_unlink, had_payment, ticket_retention_agreed,
    forfeited_credits, forfeited_paid_credits, forfeit_breakdown,
    last_payment_event_at, last_market_event_at, last_ticket_event_at, refund_ticket_ids,
    provider_unverified_confirmed, marketing_withdrawn_at, result, policy_snapshot
  ) VALUES (
    p_user_id, p_operation_key, v_now, p_method, p_actor_id, v_request.id, v_reason, v_notice, v_notice_sha,
    CASE WHEN v_payer THEN v_profile.email END, CASE WHEN v_payer THEN v_profile.phone END,
    CASE WHEN v_payer THEN v_profile.kakao_email END, v_kakao, v_payer, v_retention,
    v_total, v_paid, COALESCE(v_facts -> 'balance' -> 'breakdown', '[]'::jsonb),
    (v_facts ->> 'lastPaymentEventAt')::timestamptz, (v_facts ->> 'lastMarketEventAt')::timestamptz,
    GREATEST((v_facts ->> 'lastTicketEventAt')::timestamptz, CASE WHEN v_closed_tickets > 0 THEN v_now END),
    CASE WHEN v_retain_tickets THEN ARRAY(SELECT jsonb_array_elements_text(v_facts -> 'refundTicketIds')::uuid) ELSE '{}'::uuid[] END,
    COALESCE(p_provider_unverified_confirmed, false) AND jsonb_array_length(v_facts -> 'providerUnverified') > 0,
    v_marketing_at, v_result, v_policy - 'texts'
  );

  -- 6-10. 로그인 계정 정리(서버의 auth 소프트 삭제) 경보는 이 거래에서 넣지 않는다(정상 경로마다 관리자 알림·슬랙이 나가지 않게).
  --       서버가 정리에 실패하면 서버가, 정리 전에 멈추면 remind_unanswered_admin_work 가 10분 뒤 MEMBER_AUTH_SCRUB_PENDING 을 남기고,
  --       mark_withdrawn_member_auth_scrubbed 가 푼다. 회원 상세의 [다시 시도] 표시는 보관함 auth_scrubbed_at 으로 판단한다.

  -- 6-11. 요청(대표 경로의 요청, 스스로 익명화 때 열려 있던 요청)을 닫는다.
  IF v_request.id IS NOT NULL THEN
    UPDATE public.member_withdrawal_requests SET status = 'completed' WHERE id = v_request.id;
  END IF;
  IF p_method = 'owner' THEN
    PERFORM public.record_admin_audit(p_actor_id, 'member_withdraw', 'profile', p_user_id::text, p_user_id, v_total, v_reason,
      jsonb_build_object('method', p_method, 'request_id', v_request.id, 'channel', v_request.channel,
                         'forfeited_paid', v_paid, 'forfeited_free', v_free, 'expired_cleared', v_expired,
                         'agreed_balance', v_agreed_total, 'counts', v_counts,
                         'provider_unverified_confirmed', COALESCE(p_provider_unverified_confirmed, false),
                         'pending_tickets_confirmed', COALESCE(p_pending_tickets_confirmed, false),
                         'tickets_retained', v_retain_tickets),
      p_operation_key);
  END IF;

  RETURN v_result;
END;
$fn_anonymize_member$;

-- 7-7. 문의·환불 기록 가림(대표). p_target_text 와 정확히 같은 부분을 모두 가림 문구로 바꾸고 확인 시각을 남긴다.
--      같은 대상의 관리자 이벤트 제목·본문(알림 포기 사본 포함)에 그 문구가 있으면 함께 가린다. 감사 기록에는 글자 수만.
CREATE OR REPLACE FUNCTION public.redact_member_text(p_actor_id uuid, p_target_kind text, p_target_id uuid, p_field text,
  p_target_text text, p_operation_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_redact_member_text$
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
$fn_redact_member_text$;

-- 7-8. 가릴 것이 없다고 확인(대표, 감사 기록)
CREATE OR REPLACE FUNCTION public.mark_member_text_reviewed(p_actor_id uuid, p_target_kind text, p_target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_mark_member_text_reviewed$
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
$fn_mark_member_text_reviewed$;

-- 7-9. 탈퇴 회원 보류 주문 닫기(대표). 받는 상태:
--   (가) manual_review·PAYMENT_FOR_WITHDRAWN_MEMBER → bank_transfer
--   (나) failed 이고 취소 통보가 기록·처리됨 → payapp_cancel_request·provider_admin_cancel(통보 전이면 거절)
--   (다) 부분취소 뒤 manual_review·PAYAPP_PARTIAL_CANCEL → bank_transfer(남은 금액 송금). 전액 취소로 닫으려면 통보 뒤 (나).
--   (라) 취소 처리 실패 대체 경로의 manual_review·PAYAPP_CANCEL_HANDLING_FAILED: 승인취소가 처리됐으면(cancel_processed_at) (나)의 방법,
--        부분취소만 처리됐으면 (다)의 방법.
--   이미 닫은 주문은 늘 replay(다시 닫지 않음 — 돈을 다시 보내는 길을 만들지 않는다). 닫은 주문에 온 취소는
--   process_payapp_cancellation 이 주문을 다시 열지 않고(failed 유지) 경보만 남긴다(송금으로 닫았으면 이중 환불 의심).
CREATE OR REPLACE FUNCTION public.close_withdrawn_member_held_order(p_actor_id uuid, p_order_id uuid, p_method text, p_note text, p_operation_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_close_withdrawn_member_held_order$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_alerts integer;
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  IF p_order_id IS NULL OR p_method IS NULL OR p_method NOT IN ('payapp_cancel_request', 'provider_admin_cancel', 'bank_transfer')
     OR NULLIF(btrim(p_note), '') IS NULL OR length(p_note) > 1000
     OR NULLIF(btrim(p_operation_key), '') IS NULL OR length(p_operation_key) > 200 THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;

  SELECT * INTO v_order FROM public.payment_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND';
  END IF;
  SELECT * INTO v_ppt FROM public.payment_provider_transactions WHERE payment_order_id = v_order.id FOR UPDATE;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_order.user_id AND p.withdrawn_at IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM public.withdrawn_member_record_events e
                     WHERE e.user_id = v_order.user_id AND e.kind = 'late_payment' AND e.ref_id = v_order.id) THEN
    RAISE EXCEPTION 'MEMBER_HELD_ORDER_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.withdrawn_member_record_events e
              WHERE e.user_id = v_order.user_id AND e.kind = 'held_order_closed' AND e.ref_id = v_order.id) THEN
    RETURN jsonb_build_object('closed', true, 'replay', true, 'status', v_order.status);
  END IF;

  IF p_method = 'bank_transfer' THEN
    -- 부분취소 표식이 기록됐지만 아직 처리되지 않았으면(처리 일시 오류로 대사가 다시 집기 전) 처리된 뒤에 닫는다(송금과 겹친 이중 환불 방지).
    IF v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL AND v_ppt.partial_cancel_processed_at IS NULL THEN
      RAISE EXCEPTION 'MEMBER_HELD_ORDER_CANCEL_PENDING';
    END IF;
    IF NOT (v_order.status = 'manual_review'
            AND v_order.failure_code IN ('PAYMENT_FOR_WITHDRAWN_MEMBER', 'PAYAPP_PARTIAL_CANCEL', 'PAYAPP_CANCEL_HANDLING_FAILED')
            AND v_ppt.cancel_feedback_recorded_at IS NULL) THEN
      RAISE EXCEPTION 'MEMBER_HELD_ORDER_STATE_INVALID';
    END IF;
    IF v_order.failure_code IN ('PAYAPP_PARTIAL_CANCEL', 'PAYAPP_CANCEL_HANDLING_FAILED')
       AND (v_ppt.partial_cancel_feedback_recorded_at IS NULL OR v_ppt.partial_cancel_processed_at IS NULL) THEN
      RAISE EXCEPTION 'MEMBER_HELD_ORDER_STATE_INVALID';
    END IF;
  ELSE
    IF v_ppt.cancel_feedback_recorded_at IS NULL OR v_ppt.cancel_processed_at IS NULL THEN
      RAISE EXCEPTION 'MEMBER_HELD_ORDER_CANCEL_PENDING';
    END IF;
    IF NOT (v_order.status = 'failed'
            OR (v_order.status = 'manual_review' AND v_order.failure_code = 'PAYAPP_CANCEL_HANDLING_FAILED')) THEN
      RAISE EXCEPTION 'MEMBER_HELD_ORDER_STATE_INVALID';
    END IF;
  END IF;

  UPDATE public.payment_orders
     SET status = 'failed',
         canceled_at = COALESCE(canceled_at, now()),
         next_reconcile_at = NULL,
         updated_at = now()
   WHERE id = v_order.id;
  UPDATE public.checkout_attempts
     SET status = 'cancelled',
         updated_at = now()
   WHERE id = v_order.checkout_attempt_id
     AND status NOT IN ('completed', 'cancelled');

  INSERT INTO public.payment_admin_actions (actor_id, action, payment_order_id, before_state, after_state, note, external_method, details)
  VALUES (p_actor_id, 'withdrawn_held_order_closed', v_order.id,
          jsonb_build_object('order_status', v_order.status, 'failure_code', v_order.failure_code),
          jsonb_build_object('order_status', 'failed'),
          p_note, p_method,
          jsonb_build_object('operation_key', p_operation_key, 'mul_no', v_ppt.provider_transaction_id,
                             'partial_cancel_amount', v_ppt.partial_cancel_amount));

  INSERT INTO public.withdrawn_member_record_events (user_id, kind, ref_id, details, actor_id)
  VALUES (v_order.user_id, 'held_order_closed', v_order.id,
          jsonb_build_object('method', p_method, 'operation_key', p_operation_key, 'before_status', v_order.status,
                             'failure_code', v_order.failure_code), p_actor_id)
  ON CONFLICT (user_id, kind, ref_id) WHERE ref_id IS NOT NULL AND kind <> 'market_cash_refund' DO NOTHING;

  -- 보류 경보와, 닫기 전 대체 경로가 남긴 취소 처리 실패 경보(이 주문)를 함께 푼다.
  UPDATE public.payment_reconciliation_alerts
     SET resolved_at = now()
   WHERE resolved_at IS NULL
     AND ((details ->> 'order_payment_order_id') = v_order.id::text
          OR (details ->> 'dedupe_key') = 'withdrawn_member_payment:' || v_order.id
          OR (code = 'PAYAPP_CANCEL_HANDLING_FAILED' AND (details ->> 'payment_order_id') = v_order.id::text));
  GET DIAGNOSTICS v_alerts = ROW_COUNT;

  PERFORM public.record_admin_audit(p_actor_id, 'withdrawn_held_order_close', 'payment_order', v_order.id::text, v_order.user_id,
    v_order.expected_amount, p_note, jsonb_build_object('method', p_method, 'before_status', v_order.status,
      'failure_code', v_order.failure_code, 'alerts_resolved', v_alerts), p_operation_key);

  RETURN jsonb_build_object('closed', true, 'status', 'failed', 'method', p_method, 'alertsResolved', v_alerts);
END;
$fn_close_withdrawn_member_held_order$;

-- 7-10. 보관함 추가 기록(대표): 탈퇴 회원 자료 법정 환불의 현금 정산(market_cash_refund), 안내 메일 발송 등 메모(note).
--       현금 정산은 ref_id = 그 회원의 자료 주문 id, details.settlementKey = 정산마다 새 값(같은 주문에 여러 번 정산 가능, 같은 키는 한 번만).
CREATE OR REPLACE FUNCTION public.add_withdrawn_member_event(p_actor_id uuid, p_user_id uuid, p_kind text, p_ref_id uuid, p_details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_add_withdrawn_member_event$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  IF p_user_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('market_cash_refund', 'note')
     OR (p_details IS NOT NULL AND jsonb_typeof(p_details) <> 'object')
     OR (p_kind = 'market_cash_refund' AND (p_ref_id IS NULL
                                             OR jsonb_typeof(p_details -> 'settlementKey') IS DISTINCT FROM 'string'
                                             OR NULLIF(btrim(p_details ->> 'settlementKey'), '') IS NULL
                                             OR length(p_details ->> 'settlementKey') > 200)) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.withdrawn_member_records r WHERE r.user_id = p_user_id) THEN
    RAISE EXCEPTION 'MEMBER_NOT_WITHDRAWN';
  END IF;
  IF p_kind = 'market_cash_refund'
     AND NOT EXISTS (SELECT 1 FROM public.market_purchase_orders o WHERE o.id = p_ref_id AND o.user_id = p_user_id) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  -- 두 부분 UNIQUE(종류별 / 현금 정산 키) 중 걸리는 쪽에서 조용히 건너뛴다(recorded = false).
  INSERT INTO public.withdrawn_member_record_events (user_id, kind, ref_id, details, actor_id)
  VALUES (p_user_id, p_kind, p_ref_id, COALESCE(p_details, '{}'::jsonb), p_actor_id)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    PERFORM public.record_admin_audit(p_actor_id, 'withdrawn_member_event', 'withdrawn_member_record', p_user_id::text, p_user_id,
      NULL, NULL, jsonb_build_object('kind', p_kind, 'ref_id', p_ref_id, 'event_id', v_id), NULL);
  END IF;
  RETURN jsonb_build_object('recorded', v_id IS NOT NULL, 'eventId', v_id);
END;
$fn_add_withdrawn_member_event$;

-- 7-11. 로그인 계정 정리 완료(서버가 auth.admin.deleteUser(id, true) 성공 뒤 부른다)
CREATE OR REPLACE FUNCTION public.mark_withdrawn_member_auth_scrubbed(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_mark_withdrawn_member_auth_scrubbed$
DECLARE
  v_at timestamptz;
  v_alerts integer;
BEGIN
  SELECT r.auth_scrubbed_at INTO v_at FROM public.withdrawn_member_records r WHERE r.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_WITHDRAWN';
  END IF;
  IF v_at IS NULL THEN
    v_at := clock_timestamp();
    UPDATE public.withdrawn_member_records SET auth_scrubbed_at = v_at WHERE user_id = p_user_id;
  END IF;
  DELETE FROM auth.sessions WHERE user_id = p_user_id;
  DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
  UPDATE public.payment_reconciliation_alerts
     SET resolved_at = now()
   WHERE resolved_at IS NULL
     AND code = 'MEMBER_AUTH_SCRUB_PENDING'
     AND (details ->> 'dedupe_key') = 'member_auth_scrub:' || p_user_id;
  GET DIAGNOSTICS v_alerts = ROW_COUNT;
  RETURN jsonb_build_object('authScrubbedAt', v_at, 'alertsResolved', v_alerts);
END;
$fn_mark_withdrawn_member_auth_scrubbed$;

-- 7-11b. 완전 삭제의 로그인 계정 삭제가 끝난 뒤(서버가 auth.admin.deleteUser 성공·404 뒤 부른다) 남은 MEMBER_FULL_DELETE_AUTH_PENDING 경보를 푼다.
--        프로필이나 로그인 계정이 아직 남아 있으면 풀지 않는다.
CREATE OR REPLACE FUNCTION public.resolve_member_full_delete_auth_alert(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_resolve_member_full_delete_auth_alert$
DECLARE
  v_alerts integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id)
     OR EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
    RETURN jsonb_build_object('alertsResolved', 0, 'accountRemains', true);
  END IF;
  UPDATE public.payment_reconciliation_alerts
     SET resolved_at = now()
   WHERE resolved_at IS NULL
     AND code = 'MEMBER_FULL_DELETE_AUTH_PENDING'
     AND (details ->> 'dedupe_key') = 'member_full_delete_auth:' || p_user_id;
  GET DIAGNOSTICS v_alerts = ROW_COUNT;
  RETURN jsonb_build_object('alertsResolved', v_alerts, 'accountRemains', false);
END;
$fn_resolve_member_full_delete_auth_alert$;

-- 7-12. 카카오 연결 끊기 대상(서버 다시 시도용). 그 회원번호로 다른 계정이 새로 연결됐으면 newIdentityExists = true(끊지 말고 칸만 비움).
CREATE OR REPLACE FUNCTION public.withdrawn_member_kakao_unlink_target(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_withdrawn_member_kakao_unlink_target$
DECLARE
  v_kakao text;
BEGIN
  SELECT r.kakao_id_pending_unlink INTO v_kakao FROM public.withdrawn_member_records r WHERE r.user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_WITHDRAWN';
  END IF;
  RETURN jsonb_build_object(
    'kakaoId', v_kakao,
    'newIdentityExists', v_kakao IS NOT NULL AND EXISTS (
      SELECT 1 FROM auth.identities i WHERE i.provider = 'kakao' AND i.provider_id = v_kakao AND i.user_id <> p_user_id));
END;
$fn_withdrawn_member_kakao_unlink_target$;

CREATE OR REPLACE FUNCTION public.clear_withdrawn_member_kakao_unlink(p_user_id uuid, p_outcome text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_clear_withdrawn_member_kakao_unlink$
DECLARE
  v_n integer;
  v_alerts integer;
BEGIN
  IF p_user_id IS NULL OR p_outcome IS NULL OR p_outcome NOT IN ('unlinked', 'new_identity_exists') THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.withdrawn_member_records r WHERE r.user_id = p_user_id) THEN
    RAISE EXCEPTION 'MEMBER_NOT_WITHDRAWN';
  END IF;
  UPDATE public.withdrawn_member_records SET kakao_id_pending_unlink = NULL
   WHERE user_id = p_user_id AND kakao_id_pending_unlink IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.payment_reconciliation_alerts
     SET resolved_at = now()
   WHERE resolved_at IS NULL
     AND code = 'MEMBER_KAKAO_UNLINK_PENDING'
     AND (details ->> 'dedupe_key') = 'member_kakao_unlink:' || p_user_id;
  GET DIAGNOSTICS v_alerts = ROW_COUNT;
  RETURN jsonb_build_object('cleared', v_n = 1, 'outcome', p_outcome, 'alertsResolved', v_alerts);
END;
$fn_clear_withdrawn_member_kakao_unlink$;

-- 7-12b. 탈퇴 회원 로그인 계정 정리 상태(회원 상세의 [다시 시도] 표시, 대표 다시 시도 전 탈퇴 여부 확인).
--        탈퇴 회원이 아니면 {withdrawnAt:null, authScrubbedAt:null, kakaoUnlinkPending:false}(오류 아님).
CREATE OR REPLACE FUNCTION public.withdrawn_member_account_status(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_withdrawn_member_account_status$
DECLARE
  v_withdrawn timestamptz;
  v_record public.withdrawn_member_records%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  SELECT p.withdrawn_at INTO v_withdrawn FROM public.profiles p WHERE p.id = p_user_id;
  SELECT * INTO v_record FROM public.withdrawn_member_records r WHERE r.user_id = p_user_id;
  IF v_withdrawn IS NULL OR v_record.user_id IS NULL THEN
    RETURN jsonb_build_object('withdrawnAt', NULL, 'authScrubbedAt', NULL, 'kakaoUnlinkPending', false);
  END IF;
  RETURN jsonb_build_object(
    'withdrawnAt', v_withdrawn,
    'authScrubbedAt', v_record.auth_scrubbed_at,
    'kakaoUnlinkPending', v_record.kakao_id_pending_unlink IS NOT NULL);
END;
$fn_withdrawn_member_account_status$;

-- 7-12c. 탈퇴 회원 보류 주문(늦은 결제 기록 있음) 판정: 받은 주문 id 가운데 해당하는 것만 돌려준다.
--        결제 검토 화면이 이 주문에는 확인 처리 버튼 대신 안내를 보인다(최종 판단은 resolve_payment_order_review).
CREATE OR REPLACE FUNCTION public.withdrawn_member_held_order_ids(p_order_ids uuid[])
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_withdrawn_member_held_order_ids$
BEGIN
  IF p_order_ids IS NULL OR cardinality(p_order_ids) > 1000 THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  RETURN COALESCE((SELECT array_agg(DISTINCT e.ref_id)
                     FROM public.withdrawn_member_record_events e
                    WHERE e.kind = 'late_payment' AND e.ref_id = ANY (p_order_ids)), '{}'::uuid[]);
END;
$fn_withdrawn_member_held_order_ids$;

-- 7-13. 보관함·탈퇴 회원 문의 열람(대표 전용). 열람 기록(사유·요청 IP·기기)을 남긴 뒤 내용을 돌려준다.
CREATE OR REPLACE FUNCTION public.read_withdrawn_member_record(p_actor_id uuid, p_user_id uuid, p_reason text, p_request_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_read_withdrawn_member_record$
DECLARE
  v_record public.withdrawn_member_records%ROWTYPE;
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  IF NULLIF(btrim(p_reason), '') IS NULL OR length(p_reason) > 500
     OR (p_request_meta IS NOT NULL AND jsonb_typeof(p_request_meta) <> 'object') THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  SELECT * INTO v_record FROM public.withdrawn_member_records WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_WITHDRAWN';
  END IF;
  PERFORM public.record_admin_audit(p_actor_id, 'withdrawn_record_view', 'withdrawn_member_record', p_user_id::text, p_user_id,
    NULL, p_reason, jsonb_build_object('kind', 'record', 'request', COALESCE(p_request_meta, '{}'::jsonb)), NULL);
  RETURN to_jsonb(v_record) || jsonb_build_object('events', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'refId', e.ref_id, 'details', e.details,
                                                 'actorId', e.actor_id, 'createdAt', e.created_at) ORDER BY e.created_at), '[]'::jsonb)
      FROM public.withdrawn_member_record_events e WHERE e.user_id = p_user_id));
END;
$fn_read_withdrawn_member_record$;

CREATE OR REPLACE FUNCTION public.read_withdrawn_member_ticket(p_actor_id uuid, p_ticket_id uuid, p_reason text, p_request_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_read_withdrawn_member_ticket$
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
$fn_read_withdrawn_member_ticket$;

-- 7-14. 완전 삭제 경로(서버)가 문의를 지우기 전에 부른다: 그 회원 문의·환불의 관리자 이벤트 제목·본문을 '탈퇴 회원 문의'로.
CREATE OR REPLACE FUNCTION public.scrub_member_admin_events(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_scrub_member_admin_events$
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.is_admin IS NOT TRUE) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  RETURN jsonb_build_object('scrubbed', public.member_withdrawal_scrub_admin_events(p_user_id));
END;
$fn_scrub_member_admin_events$;

-- 8. 권한 -------------------------------------------------------------------------------------------------------
-- 내부·트리거 함수: postgres 만
REVOKE ALL ON FUNCTION public.member_withdrawal_policy() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_withdrawal_policy_days(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_text_has_long_number(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.point_charge_cash_value(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_withdrawal_facts(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_withdrawal_notice_text(text, jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_admin_event_owner(text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_withdrawal_scrub_admin_events(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_withdrawal_require_owner(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_member_withdrawal_requests_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_withdrawn_member_records_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_withdrawn_member_record_events_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_withdrawn_member_write() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_withdrawn_member_view_event() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_withdrawn_member_credit_source() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_withdrawn_member_notification() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_withdrawn_member_manual_refund() FROM PUBLIC, anon, authenticated, service_role;

-- service_role 함수
REVOKE ALL ON FUNCTION public.get_member_withdrawal_preview(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_member_withdrawal_notice(uuid, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_member_withdrawal_request(uuid, text, text, text, integer, integer, integer, text, uuid, boolean, text, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_member_withdrawal_request_reply(uuid, uuid, timestamptz, timestamptz, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_member_withdrawal_request(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.anonymize_member(uuid, uuid, text, uuid, integer, text, boolean, text, text, boolean, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.redact_member_text(uuid, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_member_text_reviewed(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.close_withdrawn_member_held_order(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.add_withdrawn_member_event(uuid, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_withdrawn_member_auth_scrubbed(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.withdrawn_member_kakao_unlink_target(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.clear_withdrawn_member_kakao_unlink(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_withdrawn_member_record(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_withdrawn_member_ticket(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.scrub_member_admin_events(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.withdrawn_member_account_status(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_member_full_delete_auth_alert(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.withdrawn_member_held_order_ids(uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_member_withdrawal_preview(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_member_withdrawal_notice(uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_member_withdrawal_request(uuid, text, text, text, integer, integer, integer, text, uuid, boolean, text, timestamptz, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_member_withdrawal_request_reply(uuid, uuid, timestamptz, timestamptz, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_member_withdrawal_request(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.anonymize_member(uuid, uuid, text, uuid, integer, text, boolean, text, text, boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.redact_member_text(uuid, text, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_member_text_reviewed(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.close_withdrawn_member_held_order(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_withdrawn_member_event(uuid, uuid, text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_withdrawn_member_auth_scrubbed(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.withdrawn_member_kakao_unlink_target(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_withdrawn_member_kakao_unlink(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_withdrawn_member_record(uuid, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_withdrawn_member_ticket(uuid, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.scrub_member_admin_events(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.withdrawn_member_account_status(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_member_full_delete_auth_alert(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.withdrawn_member_held_order_ids(uuid[]) TO service_role;

-- 9. VERIFY -----------------------------------------------------------------------------------------------------
DO $verify_member_withdrawal$
DECLARE
  v_value jsonb;
  v_text text;
  v_count integer;
  v_acl text;
  v_sig text;
  v_key text;
  v_order uuid;
  v_event uuid;
  v_ok boolean;
  v_new text[][] := ARRAY[
    ARRAY['public.payapp_fulfill_order_internal(uuid,timestamp with time zone)', '657bbb07ae4b250a2697f21e2aa805e9'],
    ARRAY['public.apply_payapp_feedback(text,text,text,text,integer,integer,integer,integer,timestamp with time zone,timestamp with time zone)', '1859412411fc132dacfae4ca7a89eba4'],
    ARRAY['public.retry_payapp_fulfillment(uuid)', '93cde859327328f598e71059dcc04e6d'],
    ARRAY['public.resolve_payment_order_review(uuid,text,uuid,text,text,timestamp with time zone,text)', 'cbe116d85e140991d5993b5563296b37'],
    ARRAY['public.prepare_payment_order(uuid,uuid,text,uuid,text,text,integer,integer,text,text,text,text,text,timestamp with time zone,integer,integer,text,text)', '93e0bd5e41969f66f296f4353f3feeb9'],
    ARRAY['public.begin_payapp_request(uuid)', '679b4474c0dc42de11e5e9a14a7d1d4d'],
    ARRAY['public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)', 'be4403fd993c45d618950a5908a91591'],
    ARRAY['public.process_payapp_cancellation(uuid)', 'e0f752c7759626790a2afb86eab6aee6'],
    ARRAY['public.payapp_sales_resume_blockers()', 'edbb1eb553719198ffa9f9bc0d3aca4c'],
    ARRAY['public.enforce_payment_reconciliation_health()', 'e563ade9c072b09e26844b655e918755'],
    ARRAY['public.prevent_payment_order_snapshot_update()', '940bcad422d63c58e5d31c5756b0d473'],
    ARRAY['public.consent_record_internal(uuid,jsonb,text)', '61a9beb9d7f94cf6b0ed9b4518b52b44'],
    ARRAY['public.guard_user_consents_mutation()', '4ba21dab0a28e0c117bbead375a3fc8f'],
    ARRAY['public.guard_market_purchase_notice_acks_mutation()', '3959ac2b8139d0f81365df59ed67ef10'],
    ARRAY['public.prevent_admin_event_mutation()', 'f35f60e1461e49138635ffd4a11a27f9'],
    ARRAY['public.remind_unanswered_admin_work()', 'b950b1bfecc0ed4d470293508c0e2a60'],
    ARRAY['public.guard_support_ticket_revisions_mutation()', '1a8d96fc0bfe469e491b86c2f866e3bd'],
    ARRAY['public.cancel_incomplete_kakao_signup(uuid)', 'a83431d12c4686a0fbe57976a82038fe'],
    ARRAY['public.complete_kakao_signup_with_consents(uuid,jsonb,text,text,text,text)', 'a43e805089f08a12e22721168dbe962a'],
    ARRAY['public.consent_eligible_member_count()', '4b1c6999080f9bf6978be808997fd9ac']
  ];
  i integer;
BEGIN
  -- 9-1. 설정 모양(스스로 익명화 스위치는 값이 아니라 boolean 키가 있는지만 본다 — 켠 뒤 재적용해도 멈추지 않게. 처음 넣는 값은 false)
  SELECT value INTO v_value FROM public.system_settings WHERE key = 'member_withdrawal_policy';
  IF v_value IS NULL OR jsonb_typeof(v_value -> 'version') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_value -> 'selfAnonymizeEnabled') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(v_value -> 'texts') IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_value -> 'texts' -> 'notice') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'VERIFY: member_withdrawal_policy shape';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['paymentRetentionYears', 'payerTicketRetentionYears', 'payerRefundTicketRetentionYears',
                               'nonPayerTicketRetentionYears', 'attemptRecordRetentionYears', 'withdrawalRecordRetentionYears',
                               'consentRecordRetentionYears', 'selfWithdrawOrderQuietDays', 'withdrawRefundDeadlineBufferDays'] LOOP
    IF public.member_withdrawal_policy_days(v_key) IS NULL THEN
      RAISE EXCEPTION 'VERIFY: policy number %', v_key;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['noticeTitle', 'confirmLabel', 'adminEventTitle', 'redactionMask', 'marketingResult',
                               'forfeitDescription', 'cleanupDescription', 'alertAuthScrubPending', 'alertHeldOrderFeedbackMismatch',
                               'alertClosedHeldOrderCancelFailed', 'finishDeleteNotice', 'finishDeleteButton', 'paymentReviewHeldOrder'] LOOP
    IF NULLIF(btrim(v_value -> 'texts' ->> v_key), '') IS NULL THEN
      RAISE EXCEPTION 'VERIFY: policy text %', v_key;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['downloads', 'noCarryOver', 'reviews', 'ticketsPayer', 'ticketsKeep', 'ticketsDelete', 'ticketsChoice',
                               'pendingTickets', 'pendingTicketsDelete', 'pendingTicketsChoice', 'credits', 'creditLinePaid', 'creditLineFree', 'noExpiry', 'noCredits', 'legalRefund',
                               'marketingSelf', 'marketingRequest', 'useBeforeRequest', 'irreversible', 'termsVersion',
                               'creditsFreeOnly', 'creditsCashUnknown', 'creditLinePaidCashUnknown', 'retainedPayer', 'retainedAttemptOnly'] LOOP
    IF NULLIF(btrim(v_value -> 'texts' -> 'notice' ->> v_key), '') IS NULL THEN
      RAISE EXCEPTION 'VERIFY: policy notice text %', v_key;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.signup_consent_items i WHERE i.key = v_value ->> 'marketingConsentItemKey')
     OR NOT EXISTS (SELECT 1 FROM public.signup_consent_items i WHERE i.key = v_value ->> 'termsConsentItemKey') THEN
    RAISE EXCEPTION 'VERIFY: consent item keys';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings'
                  AND policyname = 'system_settings_member_withdrawal_policy_no_client_write' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'VERIFY: no_client_write policy';
  END IF;

  -- 9-2. 칸·CHECK
  SELECT count(*) INTO v_count FROM information_schema.columns
   WHERE table_schema = 'public'
     AND ((table_name = 'profiles' AND column_name = 'withdrawn_at')
          OR (table_name IN ('support_tickets', 'support_ticket_revisions', 'refund_requests', 'market_refund_requests')
              AND column_name = 'redaction_reviewed_at'));
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'VERIFY: columns = %', v_count;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_transactions_type_check' AND pg_get_constraintdef(oid) LIKE '%withdrawal_forfeit%')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_consents_source_check' AND pg_get_constraintdef(oid) LIKE '%''withdrawal''%')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_admin_actions_action_check' AND pg_get_constraintdef(oid) LIKE '%withdrawn_held_order_closed%') THEN
    RAISE EXCEPTION 'VERIFY: check constraints';
  END IF;

  -- 9-3. 새 표: RLS·정책 없음·권한·가드
  FOREACH v_key IN ARRAY ARRAY['member_withdrawal_requests', 'withdrawn_member_records', 'withdrawn_member_record_events'] LOOP
    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = ('public.' || v_key)::regclass) THEN
      RAISE EXCEPTION 'VERIFY: RLS %', v_key;
    END IF;
    SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public' AND tablename = v_key;
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'VERIFY: policies on % = %', v_key, v_count;
    END IF;
    SELECT count(*) INTO v_count FROM pg_trigger WHERE tgrelid = ('public.' || v_key)::regclass AND NOT tgisinternal;
    IF v_count <> 2 THEN
      RAISE EXCEPTION 'VERIFY: triggers on % = %', v_key, v_count;
    END IF;
  END LOOP;
  SELECT string_agg(format('%s:%s:%s', table_name, grantee, privilege_type), ', ') INTO v_text
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name IN ('member_withdrawal_requests', 'withdrawn_member_records', 'withdrawn_member_record_events')
     AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
     AND NOT (table_name = 'member_withdrawal_requests' AND grantee = 'service_role' AND privilege_type = 'SELECT');
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: table grants: %', v_text;
  END IF;

  -- 9-4. 탈퇴 회원 숨김 정책(RESTRICTIVE 4개)
  SELECT count(*) INTO v_count FROM pg_policies
   WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE'
     AND (tablename, policyname) IN (('support_tickets', 'support_tickets_withdrawn_hidden'),
                                     ('market_refund_requests', 'market_refund_requests_withdrawn_hidden'),
                                     ('support_ticket_revisions', 'support_ticket_revisions_withdrawn_hidden'),
                                     ('refund_requests', 'refund_requests_withdrawn_hidden'));
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'VERIFY: withdrawn hidden policies = %', v_count;
  END IF;

  -- 9-5. 보호 트리거
  SELECT count(*) INTO v_count FROM pg_trigger t
   WHERE NOT t.tgisinternal
     AND ((t.tgname = 'guard_withdrawn_member_write'
           AND t.tgrelid IN ('public.support_tickets'::regclass, 'public.support_ticket_revisions'::regclass, 'public.questions'::regclass,
                             'public.passages'::regclass, 'public.exam_papers'::regclass, 'public.exam_paper_items'::regclass))
          OR (t.tgname = 'guard_withdrawn_member_view_event' AND t.tgrelid = 'public.market_item_view_events'::regclass)
          OR (t.tgname = 'guard_withdrawn_member_credit_source' AND t.tgrelid = 'public.credit_sources'::regclass)
          OR (t.tgname = 'guard_withdrawn_member_notification' AND t.tgrelid = 'public.notifications'::regclass)
          OR (t.tgname = 'record_withdrawn_member_manual_refund' AND t.tgrelid = 'public.refund_requests'::regclass));
  IF v_count <> 10 THEN
    RAISE EXCEPTION 'VERIFY: protection triggers = %', v_count;
  END IF;

  -- 9-6. (3a) PUBLIC/anon 이 실행할 수 있는 SECURITY DEFINER 함수는 handle_new_user 뿐
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_text
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.prosecdef
     AND (p.proacl IS NULL OR p.proacl::text ~ '(\{|,)(=|anon=)X')
     AND p.proname <> 'handle_new_user';
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: public/anon executable definer functions: %', v_text;
  END IF;

  -- 9-7. 함수 ACL·정의자·search_path
  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_member_withdrawal_preview(uuid,boolean)',
    'public.get_member_withdrawal_notice(uuid,text,boolean)',
    'public.create_member_withdrawal_request(uuid,text,text,text,integer,integer,integer,text,uuid,boolean,text,timestamp with time zone,timestamp with time zone,timestamp with time zone)',
    'public.record_member_withdrawal_request_reply(uuid,uuid,timestamp with time zone,timestamp with time zone,boolean)',
    'public.cancel_member_withdrawal_request(uuid,uuid)',
    'public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)',
    'public.redact_member_text(uuid,text,uuid,text,text,text)',
    'public.mark_member_text_reviewed(uuid,text,uuid)',
    'public.close_withdrawn_member_held_order(uuid,uuid,text,text,text)',
    'public.add_withdrawn_member_event(uuid,uuid,text,uuid,jsonb)',
    'public.mark_withdrawn_member_auth_scrubbed(uuid)',
    'public.withdrawn_member_kakao_unlink_target(uuid)',
    'public.clear_withdrawn_member_kakao_unlink(uuid,text)',
    'public.read_withdrawn_member_record(uuid,uuid,text,jsonb)',
    'public.read_withdrawn_member_ticket(uuid,uuid,text,jsonb)',
    'public.scrub_member_admin_events(uuid)',
    'public.withdrawn_member_account_status(uuid)',
    'public.resolve_member_full_delete_auth_alert(uuid)',
    'public.withdrawn_member_held_order_ids(uuid[])'] LOOP
    SELECT p.proacl::text INTO v_acl FROM pg_proc p WHERE p.oid = v_sig::regprocedure;
    IF v_acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
      RAISE EXCEPTION 'VERIFY: service acl % = %', v_sig, v_acl;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_sig::regprocedure AND p.prosecdef
                    AND p.proconfig = ARRAY['search_path=public, pg_temp']) THEN
      RAISE EXCEPTION 'VERIFY: definer/search_path %', v_sig;
    END IF;
  END LOOP;
  FOREACH v_sig IN ARRAY ARRAY[
    'public.member_withdrawal_policy()', 'public.member_withdrawal_policy_days(text)', 'public.member_text_has_long_number(text)',
    'public.point_charge_cash_value(uuid,integer)', 'public.member_withdrawal_facts(uuid,boolean)',
    'public.member_withdrawal_notice_text(text,jsonb,boolean)', 'public.member_admin_event_owner(text,uuid)',
    'public.member_withdrawal_scrub_admin_events(uuid)', 'public.member_withdrawal_require_owner(uuid)',
    'public.guard_member_withdrawal_requests_mutation()', 'public.guard_withdrawn_member_records_mutation()',
    'public.guard_withdrawn_member_record_events_mutation()'] LOOP
    SELECT p.proacl::text INTO v_acl FROM pg_proc p WHERE p.oid = v_sig::regprocedure;
    IF v_acl IS DISTINCT FROM '{postgres=X/postgres}' THEN
      RAISE EXCEPTION 'VERIFY: internal acl % = %', v_sig, v_acl;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_sig::regprocedure AND (p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'])) THEN
      RAISE EXCEPTION 'VERIFY: internal must not be definer / search_path %', v_sig;
    END IF;
  END LOOP;
  FOREACH v_sig IN ARRAY ARRAY[
    'public.guard_withdrawn_member_write()', 'public.guard_withdrawn_member_view_event()', 'public.guard_withdrawn_member_credit_source()',
    'public.guard_withdrawn_member_notification()', 'public.record_withdrawn_member_manual_refund()'] LOOP
    SELECT p.proacl::text INTO v_acl FROM pg_proc p WHERE p.oid = v_sig::regprocedure;
    IF v_acl IS DISTINCT FROM '{postgres=X/postgres}'
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_sig::regprocedure AND p.prosecdef
                       AND p.proconfig = ARRAY['search_path=public, pg_temp']) THEN
      RAISE EXCEPTION 'VERIFY: trigger function % = %', v_sig, v_acl;
    END IF;
  END LOOP;

  -- 9-8. 재정의 함수 새 지문
  FOR i IN 1 .. array_length(v_new, 1) LOOP
    IF v_new[i][1] <> '' AND md5(pg_get_functiondef(v_new[i][1]::regprocedure)) <> v_new[i][2] THEN
      RAISE EXCEPTION 'VERIFY: redefined md5 %', v_new[i][1];
    END IF;
  END LOOP;

  -- 9-9. 가드 예외는 설정이 있을 때만: 설정 없는 주문 fingerprint 변경·관리자 이벤트 UPDATE 는 거절, 다른 회원 설정도 거절
  SELECT o.id INTO v_order FROM public.payment_orders o WHERE o.request_fingerprint IS NOT NULL ORDER BY o.created_at LIMIT 1;
  IF v_order IS NOT NULL THEN
    v_ok := false;
    BEGIN
      UPDATE public.payment_orders SET request_fingerprint = request_fingerprint || 'x' WHERE id = v_order;
    EXCEPTION WHEN OTHERS THEN
      v_ok := SQLERRM = 'PAYMENT_ORDER_IMMUTABLE_SNAPSHOT';
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'VERIFY: order snapshot guard without setting';
    END IF;
    v_ok := false;
    BEGIN
      PERFORM set_config('app.member_withdrawal_bypass', gen_random_uuid()::text, true);
      UPDATE public.payment_orders SET request_fingerprint = request_fingerprint || 'x' WHERE id = v_order;
    EXCEPTION WHEN OTHERS THEN
      v_ok := SQLERRM = 'PAYMENT_ORDER_IMMUTABLE_SNAPSHOT';
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'VERIFY: order snapshot guard with other member setting';
    END IF;
  END IF;
  SELECT e.id INTO v_event FROM public.admin_events e ORDER BY e.created_at LIMIT 1;
  IF v_event IS NOT NULL THEN
    v_ok := false;
    BEGIN
      UPDATE public.admin_events SET title = title WHERE id = v_event;
    EXCEPTION WHEN OTHERS THEN
      v_ok := SQLERRM = 'ADMIN_EVENTS_APPEND_ONLY';
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'VERIFY: admin_events guard without setting';
    END IF;
    v_ok := false;
    BEGIN
      PERFORM set_config('app.member_withdrawal_bypass', gen_random_uuid()::text, true);
      UPDATE public.admin_events SET title = title WHERE id = v_event;
    EXCEPTION WHEN OTHERS THEN
      v_ok := SQLERRM = 'ADMIN_EVENTS_APPEND_ONLY';
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'VERIFY: admin_events guard with other member setting';
    END IF;
  END IF;
  IF COALESCE(current_setting('app.member_withdrawal_bypass', true), '') <> '' THEN
    RAISE EXCEPTION 'VERIFY: bypass setting leaked';
  END IF;

  -- 9-10. 원 환산·긴 번호 규칙 고정
  IF public.member_text_has_long_number('계좌 110-123-456789 입니다') IS NOT TRUE
     OR public.member_text_has_long_number('010 1234 5678') IS NOT TRUE
     OR public.member_text_has_long_number('주문 123-456 789') IS NOT FALSE
     OR public.member_text_has_long_number(NULL) IS NOT FALSE THEN
    RAISE EXCEPTION 'VERIFY: long number rule';
  END IF;
END;
$verify_member_withdrawal$;

NOTIFY pgrst, 'reload schema';

-- ===== T13 되돌리기 =====
-- T13: 되돌리기 — (1) 10번 적용 중 down_a 사전 확인 거절 (2) 보관함 행이 있으면 down_b 사전 확인 거절(만든 행은 되돌림)
--      (3) 행이 없을 때 down_b → down_a → 새 함수 0개 확인 → 재적용(아래 파일 순서)
DO $rh_t13_pre$
DECLARE
  v_err text;
  v_user uuid;
  v_res text;
  v_records integer;
BEGIN
  BEGIN
    EXECUTE $rx$DO $down_a_precheck$
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
$down_a_precheck$$rx$;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM pg_temp.check(v_err LIKE 'DOWN_A_BLOCKED:%is not the original definition%', 'T13',
    'down_a 사전 확인은 10번 적용 중이면 멈춤 — ' || COALESCE(v_err, '오류 없음'));

  v_err := NULL;
  BEGIN
    UPDATE public.system_settings SET value = jsonb_set(value, '{selfAnonymizeEnabled}', 'true'::jsonb) WHERE key = 'member_withdrawal_policy';
    v_user := pg_temp.new_user('t13');
    v_res := pg_temp.try_self(v_user, true, 'rh10-t13-' || v_user);
    SELECT count(*) INTO v_records FROM public.withdrawn_member_records;
    BEGIN
      EXECUTE $rx$DO $down_b_precheck$
DECLARE
  v_new text[][] := ARRAY[
    ARRAY['public.payapp_fulfill_order_internal(uuid,timestamp with time zone)', '657bbb07ae4b250a2697f21e2aa805e9'],
    ARRAY['public.apply_payapp_feedback(text,text,text,text,integer,integer,integer,integer,timestamp with time zone,timestamp with time zone)', '1859412411fc132dacfae4ca7a89eba4'],
    ARRAY['public.retry_payapp_fulfillment(uuid)', '93cde859327328f598e71059dcc04e6d'],
    ARRAY['public.resolve_payment_order_review(uuid,text,uuid,text,text,timestamp with time zone,text)', 'cbe116d85e140991d5993b5563296b37'],
    ARRAY['public.prepare_payment_order(uuid,uuid,text,uuid,text,text,integer,integer,text,text,text,text,text,timestamp with time zone,integer,integer,text,text)', '93e0bd5e41969f66f296f4353f3feeb9'],
    ARRAY['public.begin_payapp_request(uuid)', '679b4474c0dc42de11e5e9a14a7d1d4d'],
    ARRAY['public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)', 'be4403fd993c45d618950a5908a91591'],
    ARRAY['public.process_payapp_cancellation(uuid)', 'e0f752c7759626790a2afb86eab6aee6'],
    ARRAY['public.payapp_sales_resume_blockers()', 'edbb1eb553719198ffa9f9bc0d3aca4c'],
    ARRAY['public.enforce_payment_reconciliation_health()', 'e563ade9c072b09e26844b655e918755'],
    ARRAY['public.prevent_payment_order_snapshot_update()', '940bcad422d63c58e5d31c5756b0d473'],
    ARRAY['public.consent_record_internal(uuid,jsonb,text)', '61a9beb9d7f94cf6b0ed9b4518b52b44'],
    ARRAY['public.guard_user_consents_mutation()', '4ba21dab0a28e0c117bbead375a3fc8f'],
    ARRAY['public.guard_market_purchase_notice_acks_mutation()', '3959ac2b8139d0f81365df59ed67ef10'],
    ARRAY['public.prevent_admin_event_mutation()', 'f35f60e1461e49138635ffd4a11a27f9'],
    ARRAY['public.remind_unanswered_admin_work()', 'b950b1bfecc0ed4d470293508c0e2a60'],
    ARRAY['public.guard_support_ticket_revisions_mutation()', '1a8d96fc0bfe469e491b86c2f866e3bd'],
    ARRAY['public.cancel_incomplete_kakao_signup(uuid)', 'a83431d12c4686a0fbe57976a82038fe'],
    ARRAY['public.complete_kakao_signup_with_consents(uuid,jsonb,text,text,text,text)', 'a43e805089f08a12e22721168dbe962a'],
    ARRAY['public.consent_eligible_member_count()', '4b1c6999080f9bf6978be808997fd9ac']
  ];
  i integer;
BEGIN
  FOR i IN 1 .. array_length(v_new, 1) LOOP
    IF md5(pg_get_functiondef(v_new[i][1]::regprocedure)) <> v_new[i][2] THEN
      RAISE EXCEPTION 'DOWN_B_BLOCKED: % is not the bundle 10 definition', v_new[i][1];
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.withdrawn_member_records) THEN
    RAISE EXCEPTION 'DOWN_B_BLOCKED: withdrawn member records exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_withdrawal_requests) THEN
    RAISE EXCEPTION 'DOWN_B_BLOCKED: withdrawal requests exist';
  END IF;
END;
$down_b_precheck$$rx$;
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
    END;
    RAISE EXCEPTION 'rh_undo';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'rh_undo' THEN
      RAISE;
    END IF;
  END;
  PERFORM pg_temp.expect(v_res, 'OK', 'T13', '되돌리기 시험용 탈퇴 회원 만들기');
  PERFORM pg_temp.check(v_records >= 1 AND v_err LIKE 'DOWN_B_BLOCKED: withdrawn member records exist%', 'T13',
    '보관함 행이 있으면 down_b 사전 확인 거절 — ' || COALESCE(v_err, '오류 없음'));
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM public.withdrawn_member_records), 'T13', '시험용 탈퇴 회원은 되돌려 보관함 0행');
END $rh_t13_pre$;

-- ----- down_b -----
-- 되돌리기 (나) 함수·트리거: 20261126100000_member_withdrawal.sql 의 재정의 20개를 원래 정의로, 탈퇴 회원 보호 트리거 10개를 지우고,
-- 새 service_role 함수 전부의 EXECUTE 를 회수한다. 표·칸·설정·정책·새 함수 본문은 남긴다(지우는 것은 (가) down_a).
-- 순서: 코드를 10번 이전으로 되돌려 배포 → 이 파일 → _down_a.sql. 10번 코드가 돌고 있으면 down_a 를 하지 않는다.
-- 사전 조건: 재정의 함수가 10번 지문, 보관함 행 0·요청 행 0(탈퇴 회원이 있으면 되돌리지 않고 고쳐서 앞으로 간다).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $down_b_precheck$
DECLARE
  v_new text[][] := ARRAY[
    ARRAY['public.payapp_fulfill_order_internal(uuid,timestamp with time zone)', '657bbb07ae4b250a2697f21e2aa805e9'],
    ARRAY['public.apply_payapp_feedback(text,text,text,text,integer,integer,integer,integer,timestamp with time zone,timestamp with time zone)', '1859412411fc132dacfae4ca7a89eba4'],
    ARRAY['public.retry_payapp_fulfillment(uuid)', '93cde859327328f598e71059dcc04e6d'],
    ARRAY['public.resolve_payment_order_review(uuid,text,uuid,text,text,timestamp with time zone,text)', 'cbe116d85e140991d5993b5563296b37'],
    ARRAY['public.prepare_payment_order(uuid,uuid,text,uuid,text,text,integer,integer,text,text,text,text,text,timestamp with time zone,integer,integer,text,text)', '93e0bd5e41969f66f296f4353f3feeb9'],
    ARRAY['public.begin_payapp_request(uuid)', '679b4474c0dc42de11e5e9a14a7d1d4d'],
    ARRAY['public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)', 'be4403fd993c45d618950a5908a91591'],
    ARRAY['public.process_payapp_cancellation(uuid)', 'e0f752c7759626790a2afb86eab6aee6'],
    ARRAY['public.payapp_sales_resume_blockers()', 'edbb1eb553719198ffa9f9bc0d3aca4c'],
    ARRAY['public.enforce_payment_reconciliation_health()', 'e563ade9c072b09e26844b655e918755'],
    ARRAY['public.prevent_payment_order_snapshot_update()', '940bcad422d63c58e5d31c5756b0d473'],
    ARRAY['public.consent_record_internal(uuid,jsonb,text)', '61a9beb9d7f94cf6b0ed9b4518b52b44'],
    ARRAY['public.guard_user_consents_mutation()', '4ba21dab0a28e0c117bbead375a3fc8f'],
    ARRAY['public.guard_market_purchase_notice_acks_mutation()', '3959ac2b8139d0f81365df59ed67ef10'],
    ARRAY['public.prevent_admin_event_mutation()', 'f35f60e1461e49138635ffd4a11a27f9'],
    ARRAY['public.remind_unanswered_admin_work()', 'b950b1bfecc0ed4d470293508c0e2a60'],
    ARRAY['public.guard_support_ticket_revisions_mutation()', '1a8d96fc0bfe469e491b86c2f866e3bd'],
    ARRAY['public.cancel_incomplete_kakao_signup(uuid)', 'a83431d12c4686a0fbe57976a82038fe'],
    ARRAY['public.complete_kakao_signup_with_consents(uuid,jsonb,text,text,text,text)', 'a43e805089f08a12e22721168dbe962a'],
    ARRAY['public.consent_eligible_member_count()', '4b1c6999080f9bf6978be808997fd9ac']
  ];
  i integer;
BEGIN
  FOR i IN 1 .. array_length(v_new, 1) LOOP
    IF md5(pg_get_functiondef(v_new[i][1]::regprocedure)) <> v_new[i][2] THEN
      RAISE EXCEPTION 'DOWN_B_BLOCKED: % is not the bundle 10 definition', v_new[i][1];
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.withdrawn_member_records) THEN
    RAISE EXCEPTION 'DOWN_B_BLOCKED: withdrawn member records exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_withdrawal_requests) THEN
    RAISE EXCEPTION 'DOWN_B_BLOCKED: withdrawal requests exist';
  END IF;
END;
$down_b_precheck$;

-- 1. 탈퇴 회원 보호 트리거
DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.support_tickets;
DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.support_ticket_revisions;
DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.questions;
DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.passages;
DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.exam_papers;
DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.exam_paper_items;
DROP TRIGGER IF EXISTS guard_withdrawn_member_view_event ON public.market_item_view_events;
DROP TRIGGER IF EXISTS guard_withdrawn_member_credit_source ON public.credit_sources;
DROP TRIGGER IF EXISTS guard_withdrawn_member_notification ON public.notifications;
DROP TRIGGER IF EXISTS record_withdrawn_member_manual_refund ON public.refund_requests;

-- 2. 새 service_role 함수 EXECUTE 회수
REVOKE ALL ON FUNCTION public.get_member_withdrawal_preview(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_member_withdrawal_notice(uuid, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_member_withdrawal_request(uuid, text, text, text, integer, integer, integer, text, uuid, boolean, text, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_member_withdrawal_request_reply(uuid, uuid, timestamptz, timestamptz, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_member_withdrawal_request(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.anonymize_member(uuid, uuid, text, uuid, integer, text, boolean, text, text, boolean, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.redact_member_text(uuid, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_member_text_reviewed(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.close_withdrawn_member_held_order(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.add_withdrawn_member_event(uuid, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_withdrawn_member_auth_scrubbed(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.withdrawn_member_kakao_unlink_target(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.clear_withdrawn_member_kakao_unlink(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_withdrawn_member_record(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_withdrawn_member_ticket(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.scrub_member_admin_events(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.withdrawn_member_account_status(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_member_full_delete_auth_alert(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.withdrawn_member_held_order_ids(uuid[]) FROM PUBLIC, anon, authenticated, service_role;

-- 3. 재정의 함수 원래 정의(운영 DB pg_get_functiondef 원문)
-- 3-1. payapp_fulfill_order_internal
CREATE OR REPLACE FUNCTION public.payapp_fulfill_order_internal(p_payment_order_id uuid, p_approved_at timestamp with time zone)
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
$function$
;

-- 3-2. apply_payapp_feedback
CREATE OR REPLACE FUNCTION public.apply_payapp_feedback(p_userid text, p_mul_no text, p_orig_mul_no text, p_order_id text, p_pay_state integer, p_price integer, p_orig_price integer, p_pay_type integer, p_pay_date timestamp with time zone, p_canceldate timestamp with time zone)
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
    -- 부분취소 뒤 승인취소는 price가 잔액(원금 - 부분취소 금액)으로 올 수 있어 그 값도 받는다.
    -- price가 NULL이면 지금처럼 금액 불일치로 둔다.
    ELSIF p_pay_state IN (9, 64)
      AND p_price IS DISTINCT FROM v_order.expected_amount
      AND NOT (p_price IS NOT NULL
               AND v_ppt.partial_cancel_amount IS NOT NULL
               AND p_price = v_order.expected_amount - v_ppt.partial_cancel_amount) THEN
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
$function$
;

-- 3-3. retry_payapp_fulfillment
CREATE OR REPLACE FUNCTION public.retry_payapp_fulfillment(p_payment_order_id uuid)
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
$function$
;

-- 3-4. resolve_payment_order_review
CREATE OR REPLACE FUNCTION public.resolve_payment_order_review(p_payment_order_id uuid, p_action text, p_actor_id uuid, p_note text, p_mul_no text DEFAULT NULL::text, p_paid_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_external_method text DEFAULT NULL::text)
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
$function$
;

-- 3-5. prepare_payment_order
CREATE OR REPLACE FUNCTION public.prepare_payment_order(p_user_id uuid, p_checkout_attempt_id uuid, p_provider text, p_plan_id uuid, p_order_id text, p_plan_name_snapshot text, p_expected_amount integer, p_expected_credits integer, p_provider_environment text, p_provider_merchant_id text, p_request_fingerprint text, p_confirm_idempotency_key text, p_cancel_idempotency_key text, p_expires_at timestamp with time zone, p_tax_free_amount integer, p_vat_amount integer, p_partner_user_id text, p_payment_method_code text DEFAULT NULL::text)
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
$function$
;

-- 3-6. begin_payapp_request
CREATE OR REPLACE FUNCTION public.begin_payapp_request(p_payment_order_id uuid)
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
$function$
;

-- 3-7. record_point_charge_checkout_ack
CREATE OR REPLACE FUNCTION public.record_point_charge_checkout_ack(p_user_id uuid, p_checkout_attempt_id uuid, p_plan_id uuid, p_expected_amount integer, p_expected_credits integer, p_notice_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

-- 3-8. process_payapp_cancellation
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
$function$
;

-- 3-9. payapp_sales_resume_blockers
CREATE OR REPLACE FUNCTION public.payapp_sales_resume_blockers()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_scheduler public.payment_reconciliation_scheduler%ROWTYPE;
  v_scheduler_stale boolean;
  v_payapp_unfulfilled_count integer;
  v_payapp_money_review_count integer;
  v_payapp_cancel_active_count integer;
BEGIN
  SELECT *
    INTO v_scheduler
    FROM public.payment_reconciliation_scheduler
   WHERE id = 1;

  v_scheduler_stale := v_scheduler.last_started_at IS NOT NULL
    AND (
      v_scheduler.last_succeeded_at IS NULL
      OR v_scheduler.last_succeeded_at <= now() - interval '15 minutes'
    );

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
    COUNT(*) FILTER (WHERE cs.status = 'active')::integer
    INTO v_payapp_cancel_active_count
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

  RETURN jsonb_build_object(
    'paid_unfulfilled_count', v_payapp_unfulfilled_count,
    'money_review_count', v_payapp_money_review_count,
    'cancel_unprocessed_active_count', v_payapp_cancel_active_count,
    -- 점검 작업 기록 행이 없으면 건강하다고 볼 근거가 없으므로 막는다.
    'scheduler_unhealthy', COALESCE(v_scheduler_stale OR v_scheduler.consecutive_failures >= 3, true),
    'consecutive_failures', v_scheduler.consecutive_failures,
    'last_succeeded_at', v_scheduler.last_succeeded_at
  );
END;
$function$
;

-- 3-10. enforce_payment_reconciliation_health
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
  v_feedback_ack timestamptz;
  v_feedback_unprocessed_count integer;
  v_feedback_latest timestamptz;
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
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  ELSIF v_kakao_marker_frozen_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'KAKAOPAY_PARTIAL_CANCEL_UNPROCESSED_FROZEN',
      'warning',
      '카카오페이 부분취소 처리가 10분 넘게 끝나지 않았습니다(크레딧은 묶여 있음).',
      jsonb_build_object('count', v_kakao_marker_frozen_count)
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
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

  -- change_ticket에 남길 첫 code. 경보는 아래에서 조건마다 따로 남긴다.
  IF v_payapp_unfulfilled_count > 0 THEN
    v_payapp_code := 'PAYAPP_PAID_UNFULFILLED';
  ELSIF v_payapp_cancel_active_count > 0 THEN
    v_payapp_code := 'PAYAPP_CANCEL_UNPROCESSED';
  ELSIF v_payapp_money_review_count > 0 THEN
    v_payapp_code := 'PAYAPP_MONEY_RISK_REVIEW';
  ELSIF v_payapp_scheduler_unhealthy THEN
    v_payapp_code := 'PAYAPP_RECONCILIATION_UNHEALTHY';
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
  -- 조건마다 따로 남겨 한 조건이 다른 조건(특히 취소 미처리)을 가리지 않게 한다.
  IF v_payapp_unfulfilled_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'PAYAPP_PAID_UNFULFILLED',
      'critical',
      '결제완료가 기록됐지만 10분 넘게 크레딧이 지급되지 않은 페이앱 건이 있습니다.',
      jsonb_build_object(
        'paid_unfulfilled_count', v_payapp_unfulfilled_count,
        'money_review_count', v_payapp_money_review_count,
        'cancel_unprocessed_active_count', v_payapp_cancel_active_count,
        'consecutive_failures', v_scheduler.consecutive_failures,
        'last_succeeded_at', v_scheduler.last_succeeded_at
      )
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  IF v_payapp_cancel_active_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'PAYAPP_CANCEL_UNPROCESSED',
      'critical',
      '페이앱 취소 처리가 10분 넘게 끝나지 않았고 크레딧을 쓸 수 있는 상태입니다.',
      jsonb_build_object(
        'paid_unfulfilled_count', v_payapp_unfulfilled_count,
        'money_review_count', v_payapp_money_review_count,
        'cancel_unprocessed_active_count', v_payapp_cancel_active_count,
        'consecutive_failures', v_scheduler.consecutive_failures,
        'last_succeeded_at', v_scheduler.last_succeeded_at
      )
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  IF v_payapp_money_review_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'PAYAPP_MONEY_RISK_REVIEW',
      'critical',
      '돈이 걸린 페이앱 수동 확인 건이 있습니다.',
      jsonb_build_object(
        'paid_unfulfilled_count', v_payapp_unfulfilled_count,
        'money_review_count', v_payapp_money_review_count,
        'cancel_unprocessed_active_count', v_payapp_cancel_active_count,
        'consecutive_failures', v_scheduler.consecutive_failures,
        'last_succeeded_at', v_scheduler.last_succeeded_at
      )
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  IF v_payapp_cancel_frozen_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'PAYAPP_CANCEL_UNPROCESSED_FROZEN',
      'warning',
      '페이앱 취소 처리가 10분 넘게 끝나지 않았습니다(크레딧은 묶여 있거나 지급 전).',
      jsonb_build_object('count', v_payapp_cancel_frozen_count)
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  -- 기록되지 않은 페이앱 통보: 경보만 남기고 판매는 끄지 않는다.
  -- 이미 확인(해소)된 경보가 덮은 시각 이후만 센다. 해소하면 다시 울리지 않는다.
  SELECT MAX((details->>'latest_received_at')::timestamptz)
    INTO v_feedback_ack
    FROM public.payment_reconciliation_alerts
   WHERE code = 'PAYAPP_FEEDBACK_UNPROCESSED';

  -- pending·failed는 payment_webhook_events_pending_idx, 표식 없이 ignored로 닫힌 취소 계열 통보는
  -- payment_webhook_events_ignored_cancel_idx를 타도록 두 부분으로 나눈다.
  -- PROCESS: 실패는 표식이 이미 커밋된 경우라 취소 미처리 점검과 대사가 다룬다. 사이트 밖 통보는 뺀다.
  SELECT COUNT(*)::integer, MAX(e.received_at)
    INTO v_feedback_unprocessed_count, v_feedback_latest
    FROM (
      SELECT pwe.received_at
        FROM public.payment_webhook_events pwe
       WHERE pwe.processing_status IN ('pending', 'failed')
         AND pwe.transmission_id LIKE 'payapp:%'
         AND pwe.received_at <= now() - interval '30 minutes'
         AND pwe.received_at > COALESCE(v_feedback_ack, '-infinity'::timestamptz)
         AND (pwe.processing_status = 'pending'
              OR COALESCE(pwe.last_error_code, '') NOT LIKE 'PROCESS:%')
      UNION ALL
      SELECT pwe.received_at
        FROM public.payment_webhook_events pwe
       WHERE pwe.processing_status = 'ignored'
         AND pwe.event_type IN ('PAYAPP_PAY_STATE_9', 'PAYAPP_PAY_STATE_64', 'PAYAPP_PAY_STATE_70', 'PAYAPP_PAY_STATE_71')
         AND pwe.transmission_id LIKE 'payapp:%'
         AND pwe.received_at <= now() - interval '30 minutes'
         AND pwe.received_at > COALESCE(v_feedback_ack, '-infinity'::timestamptz)
         AND COALESCE(pwe.last_error_code, '') <> 'PAYAPP_FOREIGN_FEEDBACK'
    ) e;

  IF v_feedback_unprocessed_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES ('PAYAPP_FEEDBACK_UNPROCESSED', 'critical',
            '30분 넘게 처리되지 않은 페이앱 통보가 있습니다. 페이앱 관리자 내역과 대조하세요.',
            jsonb_build_object('count', v_feedback_unprocessed_count, 'latest_received_at', v_feedback_latest))
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
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
$function$
;

-- 3-11. prevent_payment_order_snapshot_update
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
$function$
;

-- 3-12. consent_record_internal
CREATE OR REPLACE FUNCTION public.consent_record_internal(p_user_id uuid, p_items jsonb, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_error text;
  v_provider text;
  v_signup_completed boolean;
  v_email_confirmed_at timestamptz;
  v_has_records boolean;
  v_mode text := 'full';
  v_elem jsonb;
  v_item public.signup_consent_items%ROWTYPE;
  v_agreed boolean;
  v_latest boolean;
  v_item_ids uuid[] := ARRAY[]::uuid[];
  v_doc_key text;
  v_doc jsonb;
  v_hash text;
BEGIN
  IF p_user_id IS NULL OR p_source IS NULL
     OR p_source NOT IN ('email_signup', 'kakao_signup', 'consent_gate', 'mypage') THEN
    RAISE EXCEPTION 'CONSENT_INPUT_INVALID';
  END IF;

  -- ① 회원 advisory ② 항목 쓰기 공유(저장·개정과 겹치지 않게) ③ profiles 행
  PERFORM pg_advisory_xact_lock(hashtextextended('public.user_consents:' || p_user_id::text, 0));
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('public.signup_consent_items:write', 0));

  SELECT p.provider, p.signup_completed
    INTO v_provider, v_signup_completed
    FROM public.profiles p
   WHERE p.id = p_user_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONSENT_PROFILE_MISSING';
  END IF;

  IF p_source IN ('consent_gate', 'mypage') AND v_provider = 'kakao' AND v_signup_completed IS NOT TRUE THEN
    RAISE EXCEPTION 'CONSENT_KAKAO_SIGNUP_INCOMPLETE';
  END IF;
  IF p_source = 'kakao_signup' AND v_provider IS DISTINCT FROM 'kakao' THEN
    RAISE EXCEPTION 'CONSENT_KAKAO_NOT_KAKAO';
  END IF;

  v_error := public.consent_items_error(p_items, p_source);
  IF v_error IS NOT NULL THEN
    RAISE EXCEPTION '%', v_error;
  END IF;

  SELECT array_agg((e ->> 'item_id')::uuid) INTO v_item_ids FROM jsonb_array_elements(p_items) AS e;

  -- 이메일 가입: 미인증 이메일 계정에만. 기록이 이미 있으면(같은 이메일 재가입 — 제3자일 수 있음) 선택 철회만 받는다.
  IF p_source = 'email_signup' THEN
    SELECT u.email_confirmed_at INTO v_email_confirmed_at FROM auth.users u WHERE u.id = p_user_id;
    IF v_email_confirmed_at IS NOT NULL OR v_provider IS DISTINCT FROM 'email' THEN
      RETURN '[]'::jsonb;
    END IF;
    v_has_records := EXISTS (SELECT 1 FROM public.user_consents c WHERE c.user_id = p_user_id);
    IF v_has_records THEN
      v_mode := 'withdraw_only';
    END IF;
  END IF;

  IF v_mode = 'full' AND p_source <> 'mypage'
     AND EXISTS (SELECT 1 FROM public.consent_missing_required(p_user_id, p_items)) THEN
    RAISE EXCEPTION 'CONSENT_REQUIRED_MISSING';
  END IF;

  FOR v_elem IN SELECT e FROM jsonb_array_elements(p_items) AS e LOOP
    SELECT * INTO v_item FROM public.signup_consent_items i WHERE i.id = (v_elem ->> 'item_id')::uuid;
    v_agreed := (v_elem -> 'agreed') = 'true'::jsonb;

    IF v_mode = 'withdraw_only' AND (v_item.required OR v_agreed) THEN
      CONTINUE;
    END IF;

    SELECT c.agreed INTO v_latest
      FROM public.user_consents c
     WHERE c.user_id = p_user_id AND c.item_id = v_item.id AND c.item_version = v_item.version
     ORDER BY c.seq DESC
     LIMIT 1;
    IF FOUND AND v_latest = v_agreed THEN
      CONTINUE;
    END IF;

    -- 연결 약관이 있으면 동의 제출 시점의 저장 본문 지문(sha256)을 함께 적는다(6번 묶음).
    v_hash := NULL;
    IF v_item.policy_slug IS NOT NULL THEN
      SELECT d.key, d.value INTO v_doc_key, v_doc
        FROM public.system_settings s,
             jsonb_each(CASE WHEN jsonb_typeof(s.value -> 'policyDocuments') = 'object' THEN s.value -> 'policyDocuments' ELSE '{}'::jsonb END) AS d
       WHERE s.key = 'site_footer_content'
         AND d.value ->> 'slug' = v_item.policy_slug
       LIMIT 1;
      IF FOUND AND jsonb_typeof(v_doc -> 'content') = 'string' THEN
        v_hash := encode(sha256(convert_to(v_doc ->> 'content', 'UTF8')), 'hex');
        -- 그 본문의 사본이 없으면(이론상 저장 트리거가 보장) 여기서 남긴다.
        IF NOT EXISTS (SELECT 1 FROM public.policy_document_snapshots p WHERE p.doc_key = v_doc_key AND p.content_sha256 = v_hash) THEN
          PERFORM pg_advisory_xact_lock(hashtextextended('public.policy_document_snapshots', 0));
          IF NOT EXISTS (SELECT 1 FROM public.policy_document_snapshots p WHERE p.doc_key = v_doc_key AND p.content_sha256 = v_hash) THEN
            INSERT INTO public.policy_document_snapshots (doc_key, slug, title, content, content_sha256)
            VALUES (v_doc_key, v_doc ->> 'slug', v_doc ->> 'title', v_doc ->> 'content', v_hash);
          END IF;
        END IF;
      END IF;
    END IF;

    INSERT INTO public.user_consents (user_id, item_id, item_version, agreed, source, policy_sha256)
    VALUES (p_user_id, v_item.id, v_item.version, v_agreed, p_source, v_hash);
  END LOOP;

  RETURN public.consent_latest_results(p_user_id, v_item_ids);
END;
$function$
;

-- 3-13. guard_user_consents_mutation
CREATE OR REPLACE FUNCTION public.guard_user_consents_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id) THEN
      RAISE EXCEPTION 'USER_CONSENTS_APPEND_ONLY';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'USER_CONSENTS_APPEND_ONLY';
END;
$function$
;

-- 3-14. guard_market_purchase_notice_acks_mutation
CREATE OR REPLACE FUNCTION public.guard_market_purchase_notice_acks_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id) THEN
      RAISE EXCEPTION 'MARKET_PURCHASE_NOTICE_ACKS_APPEND_ONLY';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'MARKET_PURCHASE_NOTICE_ACKS_APPEND_ONLY';
END;
$function$
;

-- 3-15. prevent_admin_event_mutation
CREATE OR REPLACE FUNCTION public.prevent_admin_event_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION 'ADMIN_EVENTS_APPEND_ONLY';
END;
$function$
;

-- 3-16. remind_unanswered_admin_work
CREATE OR REPLACE FUNCTION public.remind_unanswered_admin_work()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cfg jsonb;
  v_support_hours numeric;
  v_refund_hours numeric;
  v_from_hour numeric;
  v_until_hour numeric;
  v_now timestamptz := now();
  v_kst timestamp := now() AT TIME ZONE 'Asia/Seoul';
  v_day text;
BEGIN
  SELECT s.value -> 'reminders'
    INTO v_cfg
    FROM public.system_settings s
   WHERE s.key = 'admin_alert_settings';

  IF v_cfg IS NULL THEN
    RETURN;
  END IF;

  IF jsonb_typeof(v_cfg -> 'support_after_hours') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_cfg -> 'refund_after_hours') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_cfg -> 'send_from_hour') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_cfg -> 'send_until_hour') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'ADMIN_REMINDER_SETTINGS_INVALID';
  END IF;

  v_support_hours := (v_cfg ->> 'support_after_hours')::numeric;
  v_refund_hours := (v_cfg ->> 'refund_after_hours')::numeric;
  v_from_hour := (v_cfg ->> 'send_from_hour')::numeric;
  v_until_hour := (v_cfg ->> 'send_until_hour')::numeric;

  IF v_support_hours <= 0 OR v_refund_hours <= 0
     OR v_from_hour < 0 OR v_until_hour > 24 OR v_from_hour >= v_until_hour THEN
    RAISE EXCEPTION 'ADMIN_REMINDER_SETTINGS_INVALID';
  END IF;

  -- 보내는 시간대(한국 시각, 이상~미만) 밖이면 만들지 않는다.
  IF extract(hour FROM v_kst) < v_from_hour OR extract(hour FROM v_kst) >= v_until_hour THEN
    RETURN;
  END IF;

  v_day := to_char(v_kst, 'YYYY-MM-DD');

  INSERT INTO public.admin_events (kind, severity, title, body, link, ref_table, ref_id, required_permission, dedupe_key)
  SELECT
    'support_unanswered',
    'info',
    '답변 대기 문의'
      || COALESCE(' [' || COALESCE(
           t.category_snapshot ->> 'name',
           (SELECT c.name FROM public.support_ticket_categories c WHERE c.id = t.category_id)
         ) || ']', '')
      || ' ' || left(regexp_replace(t.subject, '\s+', ' ', 'g'), 30),
    format('접수 후 %s시간 지남', floor(extract(epoch FROM v_now - t.created_at) / 3600)),
    '/admin/support',
    'support_tickets',
    t.id,
    'support.manage',
    'support_unanswered:' || t.id || ':' || v_day
  FROM public.support_tickets t
  WHERE t.status = 'pending'
    AND t.is_deleted_by_user = false
    AND t.created_at <= v_now - make_interval(secs => (v_support_hours * 3600)::double precision)
  ON CONFLICT (dedupe_key) DO NOTHING;

  INSERT INTO public.admin_events (kind, severity, title, body, link, ref_table, ref_id, required_permission, dedupe_key)
  SELECT
    'refund_unanswered',
    'info',
    '처리 대기 문제마켓 환불',
    format('요청 %s크레딧 · 접수 후 %s시간 지남',
           r.requested_refund_credits,
           floor(extract(epoch FROM v_now - r.created_at) / 3600)),
    '/admin/refunds',
    'market_refund_requests',
    r.id,
    'refunds.market',
    'refund_unanswered:' || r.id || ':' || v_day
  FROM public.market_refund_requests r
  WHERE r.status = 'pending'
    AND r.created_at <= v_now - make_interval(secs => (v_refund_hours * 3600)::double precision)
  ON CONFLICT (dedupe_key) DO NOTHING;

  INSERT INTO public.admin_events (kind, severity, title, body, link, ref_table, ref_id, required_permission, dedupe_key)
  SELECT
    'refund_unanswered',
    'info',
    CASE WHEN r.status = 'pending_review' THEN '처리 대기 충전 환불' ELSE '확인이 필요한 충전 환불' END,
    concat_ws(' · ',
      '환불 금액 ' || r.refund_amount || '원',
      format('%s시간 지남', floor(extract(epoch FROM v_now - s.since) / 3600))),
    '/admin/refunds',
    'refund_requests',
    r.id,
    'refunds.payment',
    'refund_unanswered:' || r.id || ':' || v_day
  FROM public.refund_requests r
  CROSS JOIN LATERAL (
    SELECT CASE WHEN r.status = 'pending_review' THEN r.created_at ELSE COALESCE(r.updated_at, r.created_at) END AS since
  ) s
  WHERE r.status IN ('pending_review', 'retryable_failed', 'manual_review')
    AND s.since <= v_now - make_interval(secs => (v_refund_hours * 3600)::double precision)
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$function$
;

-- 3-17. guard_support_ticket_revisions_mutation
CREATE OR REPLACE FUNCTION public.guard_support_ticket_revisions_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = OLD.ticket_id) THEN
      RAISE EXCEPTION 'SUPPORT_TICKET_REVISIONS_APPEND_ONLY';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'SUPPORT_TICKET_REVISIONS_APPEND_ONLY';
END;
$function$
;

-- 3-18. cancel_incomplete_kakao_signup
CREATE OR REPLACE FUNCTION public.cancel_incomplete_kakao_signup(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_provider text;
  v_signup_completed boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'CONSENT_INPUT_INVALID';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('public.user_consents:' || p_user_id::text, 0));
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('public.signup_consent_items:write', 0));

  SELECT p.provider, p.signup_completed
    INTO v_provider, v_signup_completed
    FROM public.profiles p
   WHERE p.id = p_user_id
     FOR UPDATE;
  IF NOT FOUND OR v_provider IS DISTINCT FROM 'kakao' OR v_signup_completed IS TRUE THEN
    RETURN false;
  END IF;
  -- 관리자 계정은 여기서 지우지 않는다(탈퇴 route 와 같은 규칙).
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.is_admin IS TRUE) THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_orders o WHERE o.user_id = p_user_id)
     OR EXISTS (SELECT 1 FROM public.checkout_attempts a WHERE a.user_id = p_user_id) THEN
    RETURN false;
  END IF;

  DELETE FROM public.exam_papers WHERE user_id = p_user_id;
  DELETE FROM public.questions WHERE user_id = p_user_id;
  DELETE FROM public.support_tickets WHERE user_id = p_user_id;
  DELETE FROM public.credit_transactions WHERE user_id = p_user_id;
  RETURN true;
END;
$function$
;

-- 3-19. complete_kakao_signup_with_consents
CREATE OR REPLACE FUNCTION public.complete_kakao_signup_with_consents(p_user_id uuid, p_items jsonb, p_email text, p_phone text, p_kakao_email text, p_kakao_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_provider text;
  v_signup_completed boolean;
  v_profile jsonb;
  v_optional_ids uuid[];
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'CONSENT_INPUT_INVALID';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('public.user_consents:' || p_user_id::text, 0));
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('public.signup_consent_items:write', 0));

  SELECT p.provider, p.signup_completed
    INTO v_provider, v_signup_completed
    FROM public.profiles p
   WHERE p.id = p_user_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONSENT_PROFILE_MISSING';
  END IF;
  IF v_provider IS DISTINCT FROM 'kakao' THEN
    RAISE EXCEPTION 'CONSENT_KAKAO_NOT_KAKAO';
  END IF;

  IF v_signup_completed IS NOT TRUE THEN
    PERFORM public.consent_record_internal(p_user_id, p_items, 'kakao_signup');

    UPDATE public.profiles
       SET email = p_email,
           phone = NULLIF(btrim(COALESCE(p_phone, '')), ''),
           kakao_email = p_email,
           kakao_id = p_kakao_id,
           provider = 'kakao',
           signup_completed = true
     WHERE id = p_user_id;
  END IF;

  SELECT jsonb_build_object('id', p.id, 'email', p.email, 'phone', p.phone, 'signup_completed', p.signup_completed)
    INTO v_profile
    FROM public.profiles p
   WHERE p.id = p_user_id;

  SELECT COALESCE(array_agg(i.id), ARRAY[]::uuid[]) INTO v_optional_ids
    FROM public.signup_consent_items i
   WHERE NOT i.required;

  RETURN jsonb_build_object(
    'profile', v_profile,
    'consentResults', public.consent_latest_results(p_user_id, v_optional_ids)
  );
END;
$function$
;

-- 3-20. consent_eligible_member_count
CREATE OR REPLACE FUNCTION public.consent_eligible_member_count()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT count(*)::integer
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
   WHERE NOT public.is_internal_admin_account(u.email)
     AND (
       (p.provider = 'kakao' AND p.signup_completed IS TRUE)
       OR (p.provider IS DISTINCT FROM 'kakao' AND u.email_confirmed_at IS NOT NULL)
     )
$function$
;

DO $down_b_verify$
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
  v_text text;
  i integer;
BEGIN
  FOR i IN 1 .. array_length(v_orig, 1) LOOP
    IF md5(pg_get_functiondef(v_orig[i][1]::regprocedure)) <> v_orig[i][2] THEN
      RAISE EXCEPTION 'DOWN_B_VERIFY: % not restored', v_orig[i][1];
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('guard_withdrawn_member_write', 'guard_withdrawn_member_view_event',
               'guard_withdrawn_member_credit_source', 'guard_withdrawn_member_notification', 'record_withdrawn_member_manual_refund')) THEN
    RAISE EXCEPTION 'DOWN_B_VERIFY: protection triggers left';
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_text
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('get_member_withdrawal_preview', 'get_member_withdrawal_notice', 'create_member_withdrawal_request', 'record_member_withdrawal_request_reply', 'cancel_member_withdrawal_request', 'anonymize_member', 'redact_member_text', 'mark_member_text_reviewed', 'close_withdrawn_member_held_order', 'add_withdrawn_member_event', 'mark_withdrawn_member_auth_scrubbed', 'withdrawn_member_kakao_unlink_target', 'clear_withdrawn_member_kakao_unlink', 'read_withdrawn_member_record', 'read_withdrawn_member_ticket', 'scrub_member_admin_events', 'withdrawn_member_account_status', 'resolve_member_full_delete_auth_alert', 'withdrawn_member_held_order_ids')
     AND p.proacl::text LIKE '%service_role=X%';
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'DOWN_B_VERIFY: service_role still executes %', v_text;
  END IF;
END;
$down_b_verify$;

NOTIFY pgrst, 'reload schema';

-- ----- down_a -----
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

-- T13 (3): down_b·down_a 를 실행한 뒤 — 새 함수가 남지 않고 재정의 20개가 원래 지문인지
DO $rh_t13_after$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('get_member_withdrawal_preview', 'get_member_withdrawal_notice', 'create_member_withdrawal_request',
       'record_member_withdrawal_request_reply', 'cancel_member_withdrawal_request', 'anonymize_member', 'redact_member_text',
       'mark_member_text_reviewed', 'close_withdrawn_member_held_order', 'add_withdrawn_member_event', 'mark_withdrawn_member_auth_scrubbed',
       'withdrawn_member_kakao_unlink_target', 'clear_withdrawn_member_kakao_unlink', 'read_withdrawn_member_record',
       'read_withdrawn_member_ticket', 'scrub_member_admin_events', 'withdrawn_member_account_status',
       'resolve_member_full_delete_auth_alert', 'withdrawn_member_held_order_ids', 'member_withdrawal_policy', 'member_withdrawal_policy_days',
       'member_text_has_long_number', 'point_charge_cash_value', 'member_withdrawal_facts', 'member_withdrawal_notice_text',
       'member_admin_event_owner', 'member_withdrawal_scrub_admin_events', 'member_withdrawal_require_owner',
       'guard_member_withdrawal_requests_mutation', 'guard_withdrawn_member_records_mutation', 'guard_withdrawn_member_record_events_mutation',
       'guard_withdrawn_member_write', 'guard_withdrawn_member_view_event', 'guard_withdrawn_member_credit_source',
       'guard_withdrawn_member_notification', 'record_withdrawn_member_manual_refund');
  PERFORM pg_temp.check(v_n = 0, 'T13', 'down_b → down_a 뒤 pg_proc 에 10번 새 함수 0개');
  PERFORM pg_temp.check(md5(pg_get_functiondef('public.payapp_fulfill_order_internal(uuid,timestamp with time zone)'::regprocedure)) = '78cd0333f01a23a4d63228369175f517'
    AND md5(pg_get_functiondef('public.enforce_payment_reconciliation_health()'::regprocedure)) = '2c7b70c6757abc8e9f078bf5626a8a8b'
    AND md5(pg_get_functiondef('public.prevent_admin_event_mutation()'::regprocedure)) = 'c5ec0c9e2e5f1ccc057461c207c5f074',
    'T13', '재정의 함수 원래 지문 복원(지급·자동 점검·관리자 이벤트 가드 표본)');
  PERFORM pg_temp.check(to_regclass('public.withdrawn_member_records') IS NULL
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'withdrawn_at'),
    'T13', '표·칸 지움');
END $rh_t13_after$;

-- ===== 마이그레이션 재적용(2차) =====
-- 출시 전 작업 순서표 10번 묶음: 결제 회원 탈퇴(익명화)(계획 docs/plan-bundle10-member-withdrawal.md 5판, 확정 — 14절 구현 반영).
-- 만드는 것:
--   1. system_settings 'member_withdrawal_policy'(보존 기간·스스로 익명화 스위치(처음엔 꺼짐)·고지와 화면 문구 texts).
--      RESTRICTIVE FOR UPDATE 정책으로 화면 세션 직접 수정을 막는다.
--   2. 칸: profiles.withdrawn_at, support_tickets·support_ticket_revisions·refund_requests·market_refund_requests.redaction_reviewed_at.
--      CHECK: credit_transactions.type 'withdrawal_forfeit', user_consents.source 'withdrawal', payment_admin_actions.action 'withdrawn_held_order_closed'.
--   3. 표: member_withdrawal_requests(탈퇴 요청), withdrawn_member_records(보관함), withdrawn_member_record_events(추가 기록) — 모두 가드 트리거.
--      보관함·추가 기록은 service_role 도 읽지 못한다(읽기는 열람 기록을 남기는 read_withdrawn_member_record·read_withdrawn_member_ticket 로만).
--   4. 탈퇴 회원 쓰기 막기 트리거(문의·수정 이력·문제·지문·문제지·문제지 문항), 조회 기록 user_id 지우기, 크레딧 원천 늘리기 거절,
--      알림 버리기, 충전 환불 완료 → 보관함 추가 기록. RESTRICTIVE RLS 4개(탈퇴 회원 문의·환불 기록은 화면 세션에서 안 보임).
--   5. 내부 함수: member_withdrawal_policy, member_withdrawal_policy_days, member_text_has_long_number, point_charge_cash_value,
--      member_withdrawal_facts, member_withdrawal_notice_text, member_admin_event_owner, member_withdrawal_scrub_admin_events,
--      member_withdrawal_require_owner (모두 ACL postgres 만).
--   6. 재정의 20개(원래 정의에 [10번] 표시 구역만 더함, 원래 줄은 '-- [10번 원래]' 주석으로 보존): 계획 5-5 표.
--   7. service_role 함수: get_member_withdrawal_preview, get_member_withdrawal_notice, create_member_withdrawal_request,
--      record_member_withdrawal_request_reply, cancel_member_withdrawal_request, anonymize_member, redact_member_text,
--      mark_member_text_reviewed, close_withdrawn_member_held_order, add_withdrawn_member_event, mark_withdrawn_member_auth_scrubbed,
--      withdrawn_member_kakao_unlink_target, clear_withdrawn_member_kakao_unlink, read_withdrawn_member_record,
--      read_withdrawn_member_ticket, scrub_member_admin_events, withdrawn_member_account_status, resolve_member_full_delete_auth_alert,
--      withdrawn_member_held_order_ids.
-- 함수 지문은 md5(pg_get_functiondef(oid)) — 9번과 같은 측정. 사전 값이 다르면 멈춘다.
-- 순서: DB 적용 → 타입 재생성·코드 배포 → 같은 작업 창에서 약관·처리방침 문구 스크립트 → selfAnonymizeEnabled 켜기 → 시험 계정 확인.
--   DB 적용부터 코드 배포까지는 옛 코드가 돈다(결제 회원 409, 비결제 완전 삭제). 적용 직후와 문구 적용 뒤에 탈퇴 0건을 확인한다.
-- 되돌리기: 코드를 10번 이전으로 되돌려 배포 → supabase/rollback/20261126100000_member_withdrawal_down_b.sql → _down_a.sql.
--   10번 코드가 돌고 있으면 down_a 를 하지 않는다. 다시 적용하려면 같은 트랜잭션에서 schema_migrations 의 '20261126100000' 행을 지운 뒤
--   이 파일과 이력 INSERT 를 넣는다. 10번 적용 뒤에는 9번 down 을 하지 않는다.
-- 거래 로컬 설정 app.member_withdrawal_bypass(값 = 회원 id): 익명화·가림·이벤트 정리 함수가 켜고, 가드 트리거는 그 회원 행에만 예외를 둔다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
-- 적용 때 교착을 피하려고 이 파일이 강한 잠금을 받는 표를 맨 앞에서 정해진 순서(회원 → 설정 → 크레딧·동의·결제 기록 → 문의·환불 →
-- 트리거만 더하는 표)로 한 번에 잠근다. 칸·CHECK·정책을 바꾸는 표는 ACCESS EXCLUSIVE, 트리거만 더하는 표는 SHARE ROW EXCLUSIVE(읽기는 막지 않음).
-- 기다림은 lock_timeout(3초)까지만이고, 넘으면 거래 전체가 되돌려지므로 사용이 적은 시간에 다시 실행한다.
LOCK TABLE public.profiles, public.system_settings, public.credit_transactions, public.user_consents, public.payment_admin_actions,
           public.support_tickets, public.support_ticket_revisions, public.refund_requests, public.market_refund_requests
  IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.credit_sources, public.questions, public.passages, public.exam_papers, public.exam_paper_items,
           public.market_item_view_events, public.notifications
  IN SHARE ROW EXCLUSIVE MODE;

-- 0. 사전 점검 -------------------------------------------------------------------------------------------------
DO $precheck$
DECLARE
  v_sig text;
  v_md5 text;
  v_pairs text[][] := ARRAY[
    -- 재정의(원래 값 또는 10번 값 — 되돌린 뒤 재적용 허용)
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
    ARRAY['public.consent_eligible_member_count()', '56fcd7334482cb97b778c97ff8947e12'],
    -- 그대로여야 함
    ARRAY['public.credit_source_paid_root(uuid)', '8e2c5a70f1892764039711586ae74a4d'],
    ARRAY['public.get_point_charge_refund_eligibility(uuid,uuid)', '60fc28afe44e7be776c189265e87b6ec'],
    ARRAY['public.point_charge_refund_deadline(timestamp with time zone,integer)', 'a9756c29bf0bf6c5e819896715dcfcd0'],
    ARRAY['public.get_credit_balance_snapshot(uuid)', '1c30e49ad8edb7b767af6356bda2ef8d'],
    ARRAY['public.complete_manual_point_charge_refund(uuid,uuid,text,text,integer,integer)', '97967251a6478441c18e748ba322a00c'],
    ARRAY['public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)', 'a42b474d9d95753ffba5041acb0c1c77'],
    ARRAY['public.resolve_payment_alert(uuid,uuid,text)', '969fc4bd8c32160cc274162bc23854d3'],
    ARRAY['public.consent_items_error(jsonb,text)', '80d32d5a6b2105c7ba757dd605a64027'],
    ARRAY['public.consent_missing_required(uuid,jsonb)', '713ccf2fea8a7ca8d45b9b91612d440e'],
    ARRAY['public.record_payment_alert(text,text,text,jsonb)', '80ee3155bf958c47a908fba4b28935e1'],
    ARRAY['public.create_support_ticket(uuid,text,text)', '2cfac5696f3998a6fef4bc7e0617a4f6'],
    ARRAY['public.update_own_pending_support_ticket(uuid,uuid,text,text)', 'cb221135b63d2bcc590b7fa4d2a082b0'],
    ARRAY['public.soft_delete_own_support_ticket(uuid)', 'c8148308a1d4e14f2993cfb4c8397fc4'],
    ARRAY['public.create_random_bank_exam_paper(text,text,uuid,uuid,jsonb)', '5cb7986c2f183efe754583a2d220b0ad'],
    ARRAY['public.generate_member_display_tag()', '629b6fbf53f70cb9d1ec8fed4ebe8a3f']
  ];
  v_new text[][] := ARRAY[
    ARRAY['public.payapp_fulfill_order_internal(uuid,timestamp with time zone)', '657bbb07ae4b250a2697f21e2aa805e9'],
    ARRAY['public.apply_payapp_feedback(text,text,text,text,integer,integer,integer,integer,timestamp with time zone,timestamp with time zone)', '1859412411fc132dacfae4ca7a89eba4'],
    ARRAY['public.retry_payapp_fulfillment(uuid)', '93cde859327328f598e71059dcc04e6d'],
    ARRAY['public.resolve_payment_order_review(uuid,text,uuid,text,text,timestamp with time zone,text)', 'cbe116d85e140991d5993b5563296b37'],
    ARRAY['public.prepare_payment_order(uuid,uuid,text,uuid,text,text,integer,integer,text,text,text,text,text,timestamp with time zone,integer,integer,text,text)', '93e0bd5e41969f66f296f4353f3feeb9'],
    ARRAY['public.begin_payapp_request(uuid)', '679b4474c0dc42de11e5e9a14a7d1d4d'],
    ARRAY['public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)', 'be4403fd993c45d618950a5908a91591'],
    ARRAY['public.process_payapp_cancellation(uuid)', 'e0f752c7759626790a2afb86eab6aee6'],
    ARRAY['public.payapp_sales_resume_blockers()', 'edbb1eb553719198ffa9f9bc0d3aca4c'],
    ARRAY['public.enforce_payment_reconciliation_health()', 'e563ade9c072b09e26844b655e918755'],
    ARRAY['public.prevent_payment_order_snapshot_update()', '940bcad422d63c58e5d31c5756b0d473'],
    ARRAY['public.consent_record_internal(uuid,jsonb,text)', '61a9beb9d7f94cf6b0ed9b4518b52b44'],
    ARRAY['public.guard_user_consents_mutation()', '4ba21dab0a28e0c117bbead375a3fc8f'],
    ARRAY['public.guard_market_purchase_notice_acks_mutation()', '3959ac2b8139d0f81365df59ed67ef10'],
    ARRAY['public.prevent_admin_event_mutation()', 'f35f60e1461e49138635ffd4a11a27f9'],
    ARRAY['public.remind_unanswered_admin_work()', 'b950b1bfecc0ed4d470293508c0e2a60'],
    ARRAY['public.guard_support_ticket_revisions_mutation()', '1a8d96fc0bfe469e491b86c2f866e3bd'],
    ARRAY['public.cancel_incomplete_kakao_signup(uuid)', 'a83431d12c4686a0fbe57976a82038fe'],
    ARRAY['public.complete_kakao_signup_with_consents(uuid,jsonb,text,text,text,text)', 'a43e805089f08a12e22721168dbe962a'],
    ARRAY['public.consent_eligible_member_count()', '4b1c6999080f9bf6978be808997fd9ac']
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

-- 1. 탈퇴 정책 설정 ---------------------------------------------------------------------------------------------
-- 첫 적용에서만 넣는다(되돌린 뒤 재적용해도 그사이 고친 문구를 덮지 않음). selfAnonymizeEnabled 는 키가 없거나 true 가 아니면 꺼짐.
-- 기간(…Years·…Days)은 변호사 답에 따라 값만 바꾼다. 보관함에는 사건 기준 시각만 저장하고 만료일은 파기할 때 이 값으로 계산한다.
-- texts 자리표시: 고지 원문(texts.notice·noticeTitle·confirmLabel — 서버 member_withdrawal_notice_text 가 채움)은
--   {소멸크레딧} {유료소멸크레딧} {무상소멸크레딧} {유료원환산} {크레딧} {만료일} {원환산} {답변대기문의}
--   {결제문의보존기간} {환불문의보존기간} {비결제문의보존기간} {결제기록보존기간} {결제시도보존기간} {약관판}. 화면 문구(그 밖의 texts)는 코드가 {비결제문의보존기간}
--   {결제대기일}(selfWithdrawOrderQuietDays) {가능예정일}(막힘 해제 예정일)을 채운다.
INSERT INTO public.system_settings (key, value, description, updated_at)
VALUES (
  'member_withdrawal_policy',
  $json${
    "version": 1,
    "selfAnonymizeEnabled": false,
    "paymentRetentionYears": 5,
    "payerTicketRetentionYears": 3,
    "payerRefundTicketRetentionYears": 5,
    "nonPayerTicketRetentionYears": 3,
    "attemptRecordRetentionYears": 5,
    "withdrawalRecordRetentionYears": 5,
    "consentRecordRetentionYears": 5,
    "selfWithdrawOrderQuietDays": 7,
    "withdrawRefundDeadlineBufferDays": 3,
    "marketingConsentItemKey": "marketing",
    "termsConsentItemKey": "terms",
    "redactionRefundCategorySlugs": ["market_refund", "credit_refund"],
    "redactionAccountRequestKeywords": ["계좌"],
    "texts": {
      "noticeTitle": "회원 탈퇴 전에 꼭 확인해 주세요",
      "notice": {
        "downloads": "탈퇴하면 구매한 자료를 더 이상 내려받을 수 없습니다. 필요한 자료는 탈퇴 전에 내려받아 두세요.",
        "noCarryOver": "같은 이메일이나 카카오 계정으로 다시 가입해도 새 계정이 됩니다. 크레딧·구매 내역·문의 내역은 이어지지 않습니다.",
        "reviews": "작성한 후기와 추천은 모두 삭제됩니다.",
        "retainedPayer": "결제한 기록이 있어 탈퇴한 뒤에도 주문·결제·환불·크레딧·자료 구매 기록은 법에 따라 {결제기록보존기간}년 동안 보관한 뒤 파기합니다. 이메일·휴대폰 번호·카카오 이메일은 분쟁 처리, 법에 따른 환불 연락, 탈퇴·광고성 정보 수신 동의 철회 처리 결과 안내에만 쓰도록 분리해 함께 보관합니다.",
        "retainedAttemptOnly": "결제 시도 기록(주문 번호·금액·결제 진행 기록)은 개인정보를 지운 채 {결제시도보존기간}년 동안 보관한 뒤 파기합니다. 크레딧·자료 구매·동의 기록은 탈퇴와 함께 삭제합니다.",
        "ticketsPayer": "1:1 문의는 소비자 불만·분쟁 처리 기록으로 마지막 처리일부터 {결제문의보존기간}년(환불 신청과 연결된 문의는 {환불문의보존기간}년) 동안 분리해 보관한 뒤 파기합니다. 탈퇴하면 회원 화면에서는 사라집니다.",
        "ticketsKeep": "1:1 문의는 분쟁이 생겼을 때 확인하기 위해 마지막 처리일부터 {비결제문의보존기간}년 동안 분리해 보관한 뒤 파기합니다(보존에 동의함). 탈퇴하면 회원 화면에서는 사라집니다.",
        "ticketsDelete": "1:1 문의는 보존에 동의하지 않아 탈퇴와 함께 삭제됩니다.",
        "ticketsChoice": "1:1 문의 보존 여부는 회신으로 알려 주세요. 동의하면 분쟁 확인을 위해 마지막 처리일부터 {비결제문의보존기간}년 동안 분리해 보관하고, 동의하지 않거나 회신이 없으면 탈퇴와 함께 삭제합니다. 동의하지 않아도 불이익은 없습니다.",
        "pendingTickets": "답변을 기다리는 문의 {답변대기문의}건은 탈퇴와 함께 닫힙니다. 환불 요청은 탈퇴한 뒤에도 고객센터로 할 수 있습니다.",
        "pendingTicketsDelete": "답변을 기다리는 문의 {답변대기문의}건도 탈퇴와 함께 삭제됩니다. 환불 요청은 탈퇴한 뒤에도 고객센터로 할 수 있습니다.",
        "pendingTicketsChoice": "답변을 기다리는 문의 {답변대기문의}건은 보존에 동의하면 탈퇴와 함께 닫히고, 동의하지 않거나 회신이 없으면 함께 삭제됩니다. 환불 요청은 탈퇴한 뒤에도 고객센터로 할 수 있습니다.",
        "credits": "남은 크레딧 {소멸크레딧}크레딧(유료 {유료소멸크레딧}크레딧, 무상 {무상소멸크레딧}크레딧)은 탈퇴와 함께 사라지며 환불되지 않습니다. 유료 크레딧을 원으로 환산하면 {유료원환산}원입니다.",
        "creditsFreeOnly": "남은 무상 크레딧 {무상소멸크레딧}크레딧은 탈퇴와 함께 사라지며 환불되지 않습니다.",
        "creditsCashUnknown": "남은 크레딧 {소멸크레딧}크레딧(유료 {유료소멸크레딧}크레딧, 무상 {무상소멸크레딧}크레딧)은 탈퇴와 함께 사라지며 환불되지 않습니다. 유료 크레딧의 원 환산 금액은 결제 내역을 확인해 따로 안내합니다.",
        "creditLinePaid": "· 유료 {크레딧}크레딧 (만료 {만료일}, 원 환산 {원환산}원)",
        "creditLinePaidCashUnknown": "· 유료 {크레딧}크레딧 (만료 {만료일}, 원 환산 금액은 결제 내역을 확인해 따로 안내)",
        "creditLineFree": "· 무상 {크레딧}크레딧 (만료 {만료일})",
        "noExpiry": "기한 없음",
        "noCredits": "사라지는 크레딧은 없습니다.",
        "legalRefund": "미성년자 결제 취소, 자료 하자, 표시·광고와 다른 제공처럼 법에 따른 환불은 탈퇴한 뒤에도 고객센터로 요청할 수 있습니다. 이때는 원래 결제수단이나 계좌로 처리합니다.",
        "marketingSelf": "광고성 정보 수신 동의는 탈퇴와 함께 철회됩니다.",
        "marketingRequest": "광고성 정보 수신 동의는 탈퇴를 요청하는 순간 바로 철회되며, 요청을 취소해도 되돌리지 않습니다.",
        "useBeforeRequest": "남은 크레딧은 탈퇴 전에 쓸 수 있습니다. 요청한 뒤 처리 전에 크레딧을 쓰면 실제로 사라지는 크레딧이 줄어듭니다. 요청한 뒤 충전하면 다시 요청해야 합니다. 탈퇴는 요청일부터 10일 안에 처리합니다.",
        "irreversible": "탈퇴는 되돌릴 수 없습니다.",
        "termsVersion": "이 안내는 이용약관 {약관판}판을 기준으로 합니다."
      },
      "confirmLabel": "회원 탈퇴를 최종 확인합니다",
      "checks": {
        "forfeit": "위 크레딧이 사라지고 환불되지 않는 것에 동의합니다.",
        "records": "보존되는 기록과 삭제되는 기록 안내를 확인했습니다.",
        "irreversible": "탈퇴는 되돌릴 수 없음을 확인했습니다."
      },
      "ticketRetentionChoice": {
        "title": "1:1 문의 보존 선택",
        "purpose": "분쟁이 생겼을 때 확인하기 위해 1:1 문의(제목·내용·답변)를 마지막 처리일부터 {비결제문의보존기간}년 동안 분리해 보관합니다. 동의하지 않으면 문의도 함께 지우며, 동의하지 않아도 불이익은 없습니다.",
        "agree": "문의 {비결제문의보존기간}년 보존에 동의합니다",
        "disagree": "동의하지 않습니다 — 문의도 함께 지워 주세요"
      },
      "blockReasons": {
        "ADMIN": "관리자 계정은 이 화면에서 탈퇴할 수 없습니다.",
        "DISABLED": "지금은 탈퇴 신청을 받을 수 없습니다. 잠시 후 다시 이용해 주세요.",
        "IN_PROGRESS": "진행 중인 결제나 환불이 있어 지금은 탈퇴할 수 없습니다. 처리가 끝난 뒤 다시 시도해 주세요.",
        "REFUND_PERIOD_OPEN": "환불 기간이 남은 충전 건이 있어 지금은 탈퇴할 수 없습니다. 그 충전 건을 환불하거나 환불 기간이 지난 뒤({가능예정일}부터) 탈퇴할 수 있습니다.",
        "REFUND_PERIOD_BUFFER": "환불 기간이 끝난 뒤 며칠 동안은 휴일 연장 여부를 확인하느라 탈퇴가 막힐 수 있습니다. 마지막 날이 휴일이었다면 고객센터로 환불을 요청할 수 있습니다.",
        "PROVIDER_UNVERIFIED": "결제 결과를 확인해야 하는 주문이 있어 담당자가 확인한 뒤 탈퇴를 처리합니다.",
        "REDACTION_REQUIRED": "보관할 문의 기록을 담당자가 확인한 뒤 탈퇴를 처리합니다.",
        "RECENT_PAYMENT_ACTIVITY": "최근 결제 시도가 있어 {결제대기일}일이 지난 뒤({가능예정일}부터) 탈퇴할 수 있습니다.",
        "REQUEST_PENDING": "이미 접수된 탈퇴 요청이 있습니다.",
        "NOT_PAYER": "결제 이력이 없는 계정은 바로 탈퇴할 수 있습니다.",
        "CASH_VALUE_UNKNOWN": "결제 금액을 확인해야 하는 크레딧이 있어 담당자가 확인한 뒤 탈퇴를 처리합니다."
      },
      "reviewPendingNotice": "확인한 뒤 10일 안에 가입한 이메일로 안내해 드립니다.",
      "refundLinkLabel": "크레딧 화면에서 환불 신청",
      "marketingOnlyButton": "광고 수신 동의만 지금 철회",
      "marketingOnlyDone": "광고성 정보 수신 동의를 철회했습니다.",
      "objectionGuide": "처리 결과에 이의가 있으면 개인정보 처리방침에 적힌 개인정보 보호책임자나 고객센터로 알려 주세요.",
      "requestCreated": "탈퇴 요청이 접수되었습니다. 요청일부터 10일 안에 처리하고 가입한 이메일로 결과를 알려 드립니다.",
      "requestCanceled": "탈퇴 요청을 취소했습니다. 광고성 정보 수신 동의 철회는 되돌리지 않습니다.",
      "completionTitle": "회원 탈퇴가 완료되었습니다",
      "completionKept": "법에 따라 보관하는 기록(주문·결제·환불·크레딧·자료 구매 기록, 연락처, 1:1 문의)은 분리해 보관한 뒤 기간이 지나면 파기합니다.",
      "completionKeptNonPayer": "탈퇴 처리 기록(동의하신 안내 원문과 처리 일시)은 분리해 보관한 뒤 기간이 지나면 파기합니다. 크레딧·자료 구매·동의 기록은 삭제했습니다.",
      "completionKeptAttemptOnly": "결제 시도 기록은 개인정보를 지운 채 보관한 뒤 기간이 지나면 파기합니다.",
      "completionKeptTickets": "보존에 동의하신 1:1 문의는 마지막 처리일부터 {비결제문의보존기간}년 동안 분리해 보관한 뒤 파기합니다.",
      "completionDeleted": "회원 정보, 후기, 만든 문제·문제지·지문, 알림, 장바구니는 삭제했습니다.",
      "finishDeleteNotice": "탈퇴 처리가 끝나기 전에 멈췄습니다. 회원 정보는 이미 지웠고 로그인 계정 정리만 남았습니다. 이메일 주소를 입력하고 [탈퇴 마무리하기]를 눌러 주세요.",
      "finishDeleteButton": "탈퇴 마무리하기",
      "paymentReviewHeldOrder": "탈퇴한 회원의 보류 주문입니다. 여기서는 처리할 수 없고, 대표가 회원 상세에서 [보류 주문 닫기]로 정리합니다.",
      "identityNoteGuide": "본인 확인 메모에는 연락처나 신분증 내용을 적지 마세요(확인 방법과 결과만).",
      "reasonGuide": "사유에는 개인정보를 적지 마세요.",
      "ownerMailBlocked": "요청하신 회원 탈퇴는 아래 사유로 아직 처리하지 못했습니다. 처리할 수 있게 되는 날과 방법을 함께 안내드립니다. 이의가 있으면 개인정보 처리방침의 개인정보 보호책임자나 고객센터로 알려 주세요.",
      "ownerMailCompleted": "요청하신 회원 탈퇴를 처리했습니다. 광고성 정보 수신 동의 철회 결과(보낸 곳·철회 사실·처리 일시)도 함께 알려 드립니다.",
      "adminEventTitle": "탈퇴 회원 문의",
      "redactionMask": "[가림 처리됨]",
      "marketingResult": "광고성 정보 수신동의 철회",
      "forfeitDescription": "탈퇴로 소멸",
      "cleanupDescription": "탈퇴 정리",
      "alertAuthScrubPending": "탈퇴 회원의 로그인 계정 정리(소프트 삭제)가 끝나지 않았습니다. 회원 상세에서 [로그인 계정 정리 다시 시도]를 눌러 주세요.",
      "alertHeldOrderFeedbackMismatch": "탈퇴 회원 보류 주문에 검증되지 않는 페이앱 통보가 왔습니다. 주문 상태는 바꾸지 않았습니다. 페이앱 관리자 화면에서 그 거래를 확인해 주세요.",
      "alertClosedHeldOrderCancelFailed": "닫은 탈퇴 회원 보류 주문에 온 페이앱 취소 통보를 자동으로 처리하지 못했습니다. 주문은 닫힌 상태로 두었습니다. 돈을 더 보내지 말고 페이앱 관리자 화면에서 취소 금액을 확인한 뒤 경보를 해소해 주세요(런북 RB-11 10-7)."
    }
  }$json$::jsonb,
  '회원 탈퇴·익명화 정책(보존 기간·스스로 익명화 스위치·고지와 화면 문구). 고지 원문은 서버가 이 틀로 만든다. 화면 세션으로 고칠 수 없다(SQL 편집기·서버 키로만).',
  now()
)
ON CONFLICT (key) DO NOTHING;

DROP POLICY IF EXISTS system_settings_member_withdrawal_policy_no_client_write ON public.system_settings;
CREATE POLICY system_settings_member_withdrawal_policy_no_client_write
  ON public.system_settings
  AS RESTRICTIVE
  FOR UPDATE
  USING (key <> 'member_withdrawal_policy')
  WITH CHECK (key <> 'member_withdrawal_policy');

-- 2. 칸·CHECK ---------------------------------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS redaction_reviewed_at timestamptz;
ALTER TABLE public.support_ticket_revisions ADD COLUMN IF NOT EXISTS redaction_reviewed_at timestamptz;
-- 환불 사유·메모의 가림 확인 표시(계획 3절 '가림 확인 필요'의 환불 기록 — 확인함·가림을 남길 자리).
ALTER TABLE public.refund_requests ADD COLUMN IF NOT EXISTS redaction_reviewed_at timestamptz;
ALTER TABLE public.market_refund_requests ADD COLUMN IF NOT EXISTS redaction_reviewed_at timestamptz;

ALTER TABLE public.credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_type_check;
ALTER TABLE public.credit_transactions ADD CONSTRAINT credit_transactions_type_check
  CHECK ((type = ANY (ARRAY['purchase'::text, 'consume'::text, 'refund'::text, 'admin_grant'::text, 'bonus'::text, 'withdrawal_forfeit'::text])));
ALTER TABLE public.user_consents DROP CONSTRAINT IF EXISTS user_consents_source_check;
ALTER TABLE public.user_consents ADD CONSTRAINT user_consents_source_check
  CHECK ((source = ANY (ARRAY['email_signup'::text, 'kakao_signup'::text, 'consent_gate'::text, 'mypage'::text, 'withdrawal'::text])));
ALTER TABLE public.payment_admin_actions DROP CONSTRAINT IF EXISTS payment_admin_actions_action_check;
ALTER TABLE public.payment_admin_actions ADD CONSTRAINT payment_admin_actions_action_check
  CHECK ((action = ANY (ARRAY['paid_confirmed'::text, 'unpaid_confirmed'::text, 'cancel_handled'::text, 'manual_refund_completed'::text, 'manual_review_refund_rejected'::text, 'alert_resolved'::text, 'withdrawn_held_order_closed'::text])));

-- 3. 표 ---------------------------------------------------------------------------------------------------------
-- 3-1. 탈퇴 요청(추가만, 상태는 pending → completed|canceled, 회신 칸은 pending 동안 NULL → 값만)
CREATE TABLE IF NOT EXISTS public.member_withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  channel text NOT NULL,
  requester_kind text NOT NULL DEFAULT 'self',
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  notice_text text NOT NULL,
  notice_sha256 text NOT NULL,
  notice_sent_at timestamptz,
  consent_reply_received_at timestamptz,
  ticket_retention_agreed boolean,
  expected_balance integer NOT NULL,
  expected_forfeit_paid integer NOT NULL,
  expected_forfeit_free integer NOT NULL,
  marketing_withdrawn_at timestamptz,
  identity_note text,
  recorded_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT member_withdrawal_requests_channel_check CHECK (channel IN ('screen', 'email', 'phone')),
  CONSTRAINT member_withdrawal_requests_requester_check CHECK (requester_kind IN ('self', 'legal_guardian', 'agent')),
  CONSTRAINT member_withdrawal_requests_screen_self_check CHECK (channel <> 'screen' OR (requester_kind = 'self' AND recorded_by = user_id AND identity_note IS NULL)),
  CONSTRAINT member_withdrawal_requests_status_check CHECK (status IN ('pending', 'completed', 'canceled')),
  CONSTRAINT member_withdrawal_requests_sha_check CHECK (notice_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT member_withdrawal_requests_text_check CHECK (notice_text <> ''),
  CONSTRAINT member_withdrawal_requests_amount_check CHECK (expected_balance >= 0 AND expected_forfeit_paid >= 0 AND expected_forfeit_free >= 0
                                                            AND expected_balance = expected_forfeit_paid + expected_forfeit_free),
  CONSTRAINT member_withdrawal_requests_note_check CHECK (identity_note IS NULL OR length(identity_note) <= 500)
);
CREATE UNIQUE INDEX IF NOT EXISTS member_withdrawal_requests_one_pending ON public.member_withdrawal_requests (user_id) WHERE status = 'pending';

-- 3-2. 보관함(한 번에 INSERT, UPDATE 는 auth_scrubbed_at NULL→값·kakao_id_pending_unlink 값→NULL 만)
CREATE TABLE IF NOT EXISTS public.withdrawn_member_records (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE RESTRICT,
  operation_key text NOT NULL,
  withdrawn_at timestamptz NOT NULL,
  method text NOT NULL,
  actor_id uuid NOT NULL,
  request_id uuid REFERENCES public.member_withdrawal_requests(id) ON DELETE RESTRICT,
  reason text,
  consent_notice_text text,
  consent_notice_sha256 text,
  email text,
  phone text,
  kakao_email text,
  kakao_id_pending_unlink text,
  had_payment boolean NOT NULL,
  ticket_retention_agreed boolean,
  forfeited_credits integer NOT NULL DEFAULT 0,
  forfeited_paid_credits integer NOT NULL DEFAULT 0,
  forfeit_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_payment_event_at timestamptz,
  last_market_event_at timestamptz,
  last_ticket_event_at timestamptz,
  refund_ticket_ids uuid[] NOT NULL DEFAULT '{}',
  provider_unverified_confirmed boolean NOT NULL DEFAULT false,
  marketing_withdrawn_at timestamptz,
  auth_scrubbed_at timestamptz,
  result jsonb NOT NULL,
  policy_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT withdrawn_member_records_operation_key_key UNIQUE (operation_key),
  CONSTRAINT withdrawn_member_records_method_check CHECK (method IN ('self', 'owner')),
  CONSTRAINT withdrawn_member_records_sha_check CHECK (consent_notice_sha256 IS NULL OR consent_notice_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT withdrawn_member_records_amount_check CHECK (forfeited_credits >= 0 AND forfeited_paid_credits >= 0 AND forfeited_paid_credits <= forfeited_credits),
  CONSTRAINT withdrawn_member_records_contact_check CHECK (had_payment OR (email IS NULL AND phone IS NULL AND kakao_email IS NULL))
);

-- 3-3. 보관함 추가 기록(추가만, 모든 INSERT 는 ON CONFLICT DO NOTHING). (user_id, kind, ref_id) 부분 UNIQUE 는 자료 현금 정산을 뺀 종류,
--      자료 현금 정산(market_cash_refund)은 같은 주문에 여러 번 정산할 수 있어 (user_id, kind, ref_id, details.settlementKey) 로 같은 정산만 막는다.
CREATE TABLE IF NOT EXISTS public.withdrawn_member_record_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.withdrawn_member_records(user_id) ON DELETE RESTRICT,
  kind text NOT NULL,
  ref_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT withdrawn_member_record_events_kind_check CHECK (kind IN ('late_payment', 'held_order_closed', 'manual_refund', 'market_cash_refund', 'note')),
  CONSTRAINT withdrawn_member_record_events_details_check CHECK (jsonb_typeof(details) = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS withdrawn_member_record_events_ref_key
  ON public.withdrawn_member_record_events (user_id, kind, ref_id) WHERE ref_id IS NOT NULL AND kind <> 'market_cash_refund';
CREATE UNIQUE INDEX IF NOT EXISTS withdrawn_member_record_events_settlement_key
  ON public.withdrawn_member_record_events (user_id, kind, ref_id, (details ->> 'settlementKey')) WHERE kind = 'market_cash_refund';
CREATE INDEX IF NOT EXISTS withdrawn_member_record_events_ref_idx ON public.withdrawn_member_record_events (kind, ref_id);

-- 3-4. 가드
CREATE OR REPLACE FUNCTION public.guard_member_withdrawal_requests_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_member_withdrawal_requests$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'pending'
     AND NEW.id = OLD.id AND NEW.user_id = OLD.user_id AND NEW.channel = OLD.channel
     AND NEW.requester_kind = OLD.requester_kind AND NEW.received_at = OLD.received_at
     AND NEW.notice_text = OLD.notice_text AND NEW.notice_sha256 = OLD.notice_sha256
     AND NEW.expected_balance = OLD.expected_balance AND NEW.expected_forfeit_paid = OLD.expected_forfeit_paid
     AND NEW.expected_forfeit_free = OLD.expected_forfeit_free
     AND NEW.marketing_withdrawn_at IS NOT DISTINCT FROM OLD.marketing_withdrawn_at
     AND NEW.identity_note IS NOT DISTINCT FROM OLD.identity_note AND NEW.recorded_by = OLD.recorded_by
     AND NEW.created_at = OLD.created_at
     AND (OLD.notice_sent_at IS NULL OR NEW.notice_sent_at IS NOT DISTINCT FROM OLD.notice_sent_at)
     AND (OLD.consent_reply_received_at IS NULL OR NEW.consent_reply_received_at IS NOT DISTINCT FROM OLD.consent_reply_received_at)
     AND (OLD.ticket_retention_agreed IS NULL OR NEW.ticket_retention_agreed IS NOT DISTINCT FROM OLD.ticket_retention_agreed)
     AND NEW.status IN ('pending', 'completed', 'canceled') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'MEMBER_WITHDRAWAL_REQUESTS_APPEND_ONLY';
END;
$fn_guard_member_withdrawal_requests$;

DROP TRIGGER IF EXISTS guard_member_withdrawal_requests_mutation ON public.member_withdrawal_requests;
CREATE TRIGGER guard_member_withdrawal_requests_mutation
  BEFORE UPDATE OR DELETE ON public.member_withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_member_withdrawal_requests_mutation();
DROP TRIGGER IF EXISTS guard_member_withdrawal_requests_truncate ON public.member_withdrawal_requests;
CREATE TRIGGER guard_member_withdrawal_requests_truncate
  BEFORE TRUNCATE ON public.member_withdrawal_requests
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_member_withdrawal_requests_mutation();

CREATE OR REPLACE FUNCTION public.guard_withdrawn_member_records_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_withdrawn_member_records$
BEGIN
  -- 바뀌는 칸은 auth_scrubbed_at(NULL→값)과 kakao_id_pending_unlink(값→NULL)뿐이다.
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'auth_scrubbed_at' - 'kakao_id_pending_unlink') = (to_jsonb(OLD) - 'auth_scrubbed_at' - 'kakao_id_pending_unlink')
     AND (NEW.auth_scrubbed_at IS NOT DISTINCT FROM OLD.auth_scrubbed_at
          OR (OLD.auth_scrubbed_at IS NULL AND NEW.auth_scrubbed_at IS NOT NULL))
     AND (NEW.kakao_id_pending_unlink IS NOT DISTINCT FROM OLD.kakao_id_pending_unlink
          OR NEW.kakao_id_pending_unlink IS NULL) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'WITHDRAWN_MEMBER_RECORDS_APPEND_ONLY';
END;
$fn_guard_withdrawn_member_records$;

DROP TRIGGER IF EXISTS guard_withdrawn_member_records_mutation ON public.withdrawn_member_records;
CREATE TRIGGER guard_withdrawn_member_records_mutation
  BEFORE UPDATE OR DELETE ON public.withdrawn_member_records
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawn_member_records_mutation();
DROP TRIGGER IF EXISTS guard_withdrawn_member_records_truncate ON public.withdrawn_member_records;
CREATE TRIGGER guard_withdrawn_member_records_truncate
  BEFORE TRUNCATE ON public.withdrawn_member_records
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_withdrawn_member_records_mutation();

CREATE OR REPLACE FUNCTION public.guard_withdrawn_member_record_events_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_withdrawn_member_record_events$
BEGIN
  RAISE EXCEPTION 'WITHDRAWN_MEMBER_RECORD_EVENTS_APPEND_ONLY';
END;
$fn_guard_withdrawn_member_record_events$;

DROP TRIGGER IF EXISTS guard_withdrawn_member_record_events_mutation ON public.withdrawn_member_record_events;
CREATE TRIGGER guard_withdrawn_member_record_events_mutation
  BEFORE UPDATE OR DELETE ON public.withdrawn_member_record_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawn_member_record_events_mutation();
DROP TRIGGER IF EXISTS guard_withdrawn_member_record_events_truncate ON public.withdrawn_member_record_events;
CREATE TRIGGER guard_withdrawn_member_record_events_truncate
  BEFORE TRUNCATE ON public.withdrawn_member_record_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_withdrawn_member_record_events_mutation();

-- 3-5. 권한: 보관함·추가 기록은 service_role 도 읽지 못한다(정책 없음). 요청은 service_role 읽기만.
ALTER TABLE public.member_withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawn_member_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawn_member_record_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.member_withdrawal_requests FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.withdrawn_member_records FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.withdrawn_member_record_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.member_withdrawal_requests TO service_role;

-- 3-6. 탈퇴 회원 문의·환불 기록은 화면 세션(대표 포함)에서 숨긴다. 서버 route(service_role)로만 연다.
--      support_ticket_revisions·refund_requests 는 지금 authenticated 권한이 없어 효과가 없는 심층 방어용이다.
DROP POLICY IF EXISTS support_tickets_withdrawn_hidden ON public.support_tickets;
CREATE POLICY support_tickets_withdrawn_hidden
  ON public.support_tickets
  AS RESTRICTIVE
  FOR ALL
  USING (NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = support_tickets.user_id AND p.withdrawn_at IS NOT NULL))
  WITH CHECK (NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = support_tickets.user_id AND p.withdrawn_at IS NOT NULL));
DROP POLICY IF EXISTS market_refund_requests_withdrawn_hidden ON public.market_refund_requests;
CREATE POLICY market_refund_requests_withdrawn_hidden
  ON public.market_refund_requests
  AS RESTRICTIVE
  FOR SELECT
  USING (NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = market_refund_requests.user_id AND p.withdrawn_at IS NOT NULL));
DROP POLICY IF EXISTS support_ticket_revisions_withdrawn_hidden ON public.support_ticket_revisions;
CREATE POLICY support_ticket_revisions_withdrawn_hidden
  ON public.support_ticket_revisions
  AS RESTRICTIVE
  FOR SELECT
  USING (NOT EXISTS (SELECT 1 FROM public.support_tickets t JOIN public.profiles p ON p.id = t.user_id
                      WHERE t.id = support_ticket_revisions.ticket_id AND p.withdrawn_at IS NOT NULL));
DROP POLICY IF EXISTS refund_requests_withdrawn_hidden ON public.refund_requests;
CREATE POLICY refund_requests_withdrawn_hidden
  ON public.refund_requests
  AS RESTRICTIVE
  FOR SELECT
  USING (NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = refund_requests.user_id AND p.withdrawn_at IS NOT NULL));

-- 4. 내부 함수 -------------------------------------------------------------------------------------------------
-- 4-1. 정책 값(없거나 객체가 아니면 빈 객체 — 부르는 쪽이 꺼짐·막힘으로 본다)
CREATE OR REPLACE FUNCTION public.member_withdrawal_policy()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_withdrawal_policy$
DECLARE
  v_value jsonb;
BEGIN
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'member_withdrawal_policy';
  IF v_value IS NULL OR jsonb_typeof(v_value) IS DISTINCT FROM 'object' THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN v_value;
END;
$fn_member_withdrawal_policy$;

-- 4-2. 정책의 일수·연수(0~3650 정수, 아니면 NULL — 부르는 쪽이 막는 쪽으로 본다)
CREATE OR REPLACE FUNCTION public.member_withdrawal_policy_days(p_key text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_withdrawal_policy_days$
DECLARE
  v_value jsonb := public.member_withdrawal_policy();
  v_num numeric;
BEGIN
  IF jsonb_typeof(v_value -> p_key) IS DISTINCT FROM 'number' THEN
    RETURN NULL;
  END IF;
  v_num := (v_value ->> p_key)::numeric;
  IF v_num <> trunc(v_num) OR v_num < 0 OR v_num > 3650 THEN
    RETURN NULL;
  END IF;
  RETURN v_num::integer;
END;
$fn_member_withdrawal_policy_days$;

-- 4-3. 숫자·하이픈·공백만으로 된 구간에 숫자가 10개 이상 있는가(계좌·전화번호 같은 긴 번호 — 가림 확인 대상)
CREATE OR REPLACE FUNCTION public.member_text_has_long_number(p_text text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_text_has_long_number$
BEGIN
  RETURN EXISTS (
    SELECT 1
      FROM regexp_matches(COALESCE(p_text, ''), '[0-9][0-9[:space:]-]*', 'g') AS m(x)
     WHERE length(regexp_replace(m.x[1], '[^0-9]', '', 'g')) >= 10
  );
END;
$fn_member_text_has_long_number$;

-- 4-4. 유료 크레딧의 원 환산(환불정책 8절): 남은 유료 크레딧 × (결제 금액 − 환불액) ÷ (지급 − 회수), 1원 미만 버림.
--      결제 금액 = 뿌리 주문 expected_amount, 환불액 = 뿌리 주문의 completed refund_amount 합, 지급 = 뿌리 initial_credits,
--      회수 = 뿌리 + 다시 지급한 자손의 type 'refund' 음수 합. 뿌리를 찾지 못하면 NULL.
CREATE OR REPLACE FUNCTION public.point_charge_cash_value(p_source_id uuid, p_credits integer)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_point_charge_cash_value$
DECLARE
  v_root_id uuid;
  v_root_order uuid;
  v_paid integer;
  v_refunded integer;
  v_granted integer;
  v_recovered integer;
BEGIN
  IF p_credits IS NULL OR p_credits <= 0 THEN
    RETURN 0;
  END IF;
  SELECT r.root_source_id, r.payment_order_id INTO v_root_id, v_root_order
    FROM public.credit_source_paid_root(p_source_id) r
   LIMIT 1;
  IF v_root_id IS NULL OR v_root_order IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT o.expected_amount INTO v_paid FROM public.payment_orders o WHERE o.id = v_root_order;
  SELECT COALESCE(SUM(rr.refund_amount), 0)::integer INTO v_refunded
    FROM public.refund_requests rr
   WHERE rr.status = 'completed'
     AND (rr.payment_order_id = v_root_order OR rr.source_id = v_root_id);
  SELECT c.initial_credits INTO v_granted FROM public.credit_sources c WHERE c.id = v_root_id;
  SELECT COALESCE(-SUM(t.amount), 0)::integer INTO v_recovered
    FROM public.credit_transactions t
   WHERE t.type = 'refund'
     AND t.amount < 0
     AND (t.source_id = v_root_id
          OR t.source_id IN (SELECT d FROM public.credit_source_reissued_descendants(v_root_id) AS d));
  IF v_paid IS NULL OR v_granted IS NULL OR v_granted - v_recovered <= 0 OR v_paid - v_refunded <= 0 THEN
    RETURN 0;
  END IF;
  RETURN floor(p_credits::numeric * (v_paid - v_refunded) / (v_granted - v_recovered))::integer;
END;
$fn_point_charge_cash_value$;

-- 4-5. 탈퇴 판정(계획 3절). 미리보기·요청·익명화·시험이 모두 이 함수를 쓴다. 쓰기를 하지 않는다.
--      p_ticket_retention_agreed = false 이고 결제 회원이 아니면 가림 확인 필요 조건을 뺀다(문의를 지우므로).
CREATE OR REPLACE FUNCTION public.member_withdrawal_facts(p_user_id uuid, p_ticket_retention_agreed boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_withdrawal_facts$
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
$fn_member_withdrawal_facts$;

-- 4-6. 고지 원문(서버만 만든다). p_kind 'self'(스스로 익명화) | 'request'(결제 회원 탈퇴 요청·이메일·전화 요청).
--      줄은 LF 로 잇고 지문은 sha256(원문). 틀에 빠진 줄이 있거나 자리표시가 남으면 NULL(부르는 쪽이 정책 오류로 거절).
CREATE OR REPLACE FUNCTION public.member_withdrawal_notice_text(p_kind text, p_facts jsonb, p_ticket_retention_agreed boolean)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_withdrawal_notice_text$
DECLARE
  v_policy jsonb := public.member_withdrawal_policy();
  v_t jsonb := public.member_withdrawal_policy() -> 'texts';
  v_n jsonb := public.member_withdrawal_policy() -> 'texts' -> 'notice';
  v_lines text[] := ARRAY[]::text[];
  v_line text;
  v_item jsonb;
  v_balance jsonb := p_facts -> 'balance';
  v_terms integer;
  v_payer_years integer := public.member_withdrawal_policy_days('payerTicketRetentionYears');
  v_refund_years integer := public.member_withdrawal_policy_days('payerRefundTicketRetentionYears');
  v_nonpayer_years integer := public.member_withdrawal_policy_days('nonPayerTicketRetentionYears');
  v_payment_years integer := public.member_withdrawal_policy_days('paymentRetentionYears');
  v_attempt_years integer := public.member_withdrawal_policy_days('attemptRecordRetentionYears');
  v_text text;
BEGIN
  IF p_kind NOT IN ('self', 'request') OR p_facts IS NULL OR jsonb_typeof(v_t) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_n) IS DISTINCT FROM 'object' OR v_payer_years IS NULL OR v_refund_years IS NULL OR v_nonpayer_years IS NULL
     OR v_payment_years IS NULL OR v_attempt_years IS NULL THEN
    RETURN NULL;
  END IF;

  v_lines := ARRAY[v_t ->> 'noticeTitle', v_n ->> 'downloads', v_n ->> 'noCarryOver', v_n ->> 'reviews'];
  -- 남는 기록 안내(체크 ② '보존되는 기록과 삭제되는 기록 안내'가 가리키는 줄): 결제 회원 / 결제 시도만 있는 회원
  IF (p_facts ->> 'hadPayment')::boolean THEN
    v_lines := v_lines || (v_n ->> 'retainedPayer');
  ELSIF (p_facts ->> 'hasOrdersOrAttempts')::boolean THEN
    v_lines := v_lines || (v_n ->> 'retainedAttemptOnly');
  END IF;
  IF COALESCE((p_facts ->> 'ticketCount')::integer, 0) > 0 THEN
    v_lines := v_lines || CASE
      WHEN (p_facts ->> 'hadPayment')::boolean THEN v_n ->> 'ticketsPayer'
      WHEN p_ticket_retention_agreed IS TRUE THEN v_n ->> 'ticketsKeep'
      WHEN p_ticket_retention_agreed IS FALSE THEN v_n ->> 'ticketsDelete'
      ELSE v_n ->> 'ticketsChoice' END;
  END IF;
  -- 답변 대기 문의: 보존하는 경로(결제 회원·보존 동의)는 닫힘, 지우는 경로(보존 미동의)는 삭제, 회신으로 정하는 경로는 둘 다 안내
  IF COALESCE((p_facts ->> 'pendingTicketCount')::integer, 0) > 0 THEN
    v_lines := v_lines || replace(CASE
      WHEN (p_facts ->> 'hadPayment')::boolean OR p_ticket_retention_agreed IS TRUE THEN v_n ->> 'pendingTickets'
      WHEN p_ticket_retention_agreed IS FALSE THEN v_n ->> 'pendingTicketsDelete'
      ELSE v_n ->> 'pendingTicketsChoice' END, '{답변대기문의}', (p_facts ->> 'pendingTicketCount'));
  END IF;
  IF COALESCE((v_balance ->> 'forfeitTotal')::integer, 0) > 0 THEN
    -- 유료가 0 이면 무상만 말하는 줄, 원 환산을 모르는 유료가 있으면 0원 대신 '결제 내역을 확인해 따로 안내' 줄
    v_line := CASE
      WHEN COALESCE((v_balance ->> 'forfeitPaid')::integer, 0) = 0 THEN v_n ->> 'creditsFreeOnly'
      WHEN COALESCE((v_balance ->> 'paidCashValueUnknown')::boolean, false) THEN v_n ->> 'creditsCashUnknown'
      ELSE v_n ->> 'credits' END;
    v_lines := v_lines || replace(replace(replace(replace(v_line,
      '{소멸크레딧}', to_char((v_balance ->> 'forfeitTotal')::integer, 'FM999,999,999,990')),
      '{유료소멸크레딧}', to_char((v_balance ->> 'forfeitPaid')::integer, 'FM999,999,999,990')),
      '{무상소멸크레딧}', to_char((v_balance ->> 'forfeitFree')::integer, 'FM999,999,999,990')),
      '{유료원환산}', to_char((v_balance ->> 'paidCashValue')::integer, 'FM999,999,999,990'));
    FOR v_item IN SELECT e FROM jsonb_array_elements(v_balance -> 'breakdown') AS e WHERE (e ->> 'forfeited')::integer > 0 LOOP
      v_line := CASE WHEN NOT (v_item ->> 'paid')::boolean THEN v_n ->> 'creditLineFree'
                     WHEN v_item ->> 'cash_value' IS NULL THEN v_n ->> 'creditLinePaidCashUnknown'
                     ELSE v_n ->> 'creditLinePaid' END;
      -- 원 환산을 모르는 줄에 {원환산} 이 있으면 자리표시가 남아 NULL(정책 오류)이 된다 — 0원으로 채우지 않는다.
      v_line := replace(replace(replace(v_line,
        '{크레딧}', to_char((v_item ->> 'forfeited')::integer, 'FM999,999,999,990')),
        '{만료일}', CASE WHEN v_item ->> 'expires_at' IS NULL THEN COALESCE(v_n ->> 'noExpiry', '')
                         ELSE to_char((v_item ->> 'expires_at')::timestamptz AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') END),
        '{원환산}', COALESCE(to_char((v_item ->> 'cash_value')::integer, 'FM999,999,999,990'), '{원환산}'));
      v_lines := v_lines || v_line;
    END LOOP;
  ELSE
    v_lines := v_lines || (v_n ->> 'noCredits');
  END IF;
  v_lines := v_lines || (v_n ->> 'legalRefund');
  IF (p_facts ->> 'marketingAgreed')::boolean THEN
    v_lines := v_lines || CASE WHEN p_kind = 'self' THEN v_n ->> 'marketingSelf' ELSE v_n ->> 'marketingRequest' END;
  END IF;
  IF p_kind = 'request' THEN
    v_lines := v_lines || (v_n ->> 'useBeforeRequest');
  END IF;
  v_lines := v_lines || (v_n ->> 'irreversible');
  SELECT i.version INTO v_terms FROM public.signup_consent_items i WHERE i.key = (v_policy ->> 'termsConsentItemKey');
  IF v_terms IS NOT NULL THEN
    v_lines := v_lines || replace(v_n ->> 'termsVersion', '{약관판}', v_terms::text);
  END IF;
  v_lines := v_lines || (v_t ->> 'confirmLabel');

  FOREACH v_line IN ARRAY v_lines LOOP
    IF v_line IS NULL OR v_line !~ '\S' THEN
      RETURN NULL;
    END IF;
  END LOOP;
  v_text := array_to_string(v_lines, chr(10));
  v_text := replace(replace(replace(replace(replace(v_text,
    '{결제문의보존기간}', v_payer_years::text),
    '{환불문의보존기간}', v_refund_years::text),
    '{비결제문의보존기간}', v_nonpayer_years::text),
    '{결제기록보존기간}', v_payment_years::text),
    '{결제시도보존기간}', v_attempt_years::text);
  IF v_text ~ '[{}]' THEN
    RETURN NULL;
  END IF;
  RETURN v_text;
END;
$fn_member_withdrawal_notice_text$;

-- 4-7. 관리자 이벤트가 가리키는 회원(문의·충전 환불·자료 환불, 알림 포기 사본은 원래 이벤트를 따라감)
CREATE OR REPLACE FUNCTION public.member_admin_event_owner(p_ref_table text, p_ref_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_admin_event_owner$
DECLARE
  v_user uuid;
  v_table text;
  v_id uuid;
BEGIN
  IF p_ref_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_ref_table = 'admin_events' THEN
    SELECT e.ref_table, e.ref_id INTO v_table, v_id FROM public.admin_events e WHERE e.id = p_ref_id;
    IF v_table IS NULL OR v_table = 'admin_events' THEN
      RETURN NULL;
    END IF;
  ELSE
    v_table := p_ref_table;
    v_id := p_ref_id;
  END IF;
  IF v_table = 'support_tickets' THEN
    SELECT t.user_id INTO v_user FROM public.support_tickets t WHERE t.id = v_id;
  ELSIF v_table = 'refund_requests' THEN
    SELECT r.user_id INTO v_user FROM public.refund_requests r WHERE r.id = v_id;
  ELSIF v_table = 'market_refund_requests' THEN
    SELECT r.user_id INTO v_user FROM public.market_refund_requests r WHERE r.id = v_id;
  END IF;
  RETURN v_user;
END;
$fn_member_admin_event_owner$;

-- 4-8. 그 회원 문의·환불의 관리자 이벤트 제목·본문을 '탈퇴 회원 문의'(정책 문구)로 바꾼다. 알림 포기 사본은 본문만.
--      거래 로컬 설정을 켜고 가드가 그 회원 행만 받는다. 바꾼 행 수를 돌려준다.
CREATE OR REPLACE FUNCTION public.member_withdrawal_scrub_admin_events(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_withdrawal_scrub_admin_events$
DECLARE
  v_title text := NULLIF(btrim(public.member_withdrawal_policy() -> 'texts' ->> 'adminEventTitle'), '');
  v_ids uuid[];
  v_count integer := 0;
  v_n integer;
BEGIN
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_POLICY_UNAVAILABLE';
  END IF;
  PERFORM set_config('app.member_withdrawal_bypass', p_user_id::text, true);

  SELECT COALESCE(array_agg(e.id), '{}') INTO v_ids
    FROM public.admin_events e
   WHERE (e.ref_table = 'support_tickets' AND e.ref_id IN (SELECT t.id FROM public.support_tickets t WHERE t.user_id = p_user_id))
      OR (e.ref_table = 'refund_requests' AND e.ref_id IN (SELECT r.id FROM public.refund_requests r WHERE r.user_id = p_user_id))
      OR (e.ref_table = 'market_refund_requests' AND e.ref_id IN (SELECT r.id FROM public.market_refund_requests r WHERE r.user_id = p_user_id));

  UPDATE public.admin_events e
     SET title = v_title,
         body = CASE WHEN e.body IS NULL THEN NULL ELSE v_title END
   WHERE e.id = ANY (v_ids)
     AND (e.title IS DISTINCT FROM v_title OR (e.body IS NOT NULL AND e.body IS DISTINCT FROM v_title));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_count := v_count + v_n;

  UPDATE public.admin_events e
     SET body = v_title
   WHERE e.ref_table = 'admin_events'
     AND e.ref_id = ANY (v_ids)
     AND e.body IS DISTINCT FROM v_title;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_count + v_n;
END;
$fn_member_withdrawal_scrub_admin_events$;

-- 4-9. 대표 확인(관리자 + admin_role owner)
CREATE OR REPLACE FUNCTION public.member_withdrawal_require_owner(p_actor_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_withdrawal_require_owner$
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.admin_role = 'owner' AND p.withdrawn_at IS NULL
  ) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_ACTOR_NOT_OWNER';
  END IF;
END;
$fn_member_withdrawal_require_owner$;

-- 5. 탈퇴 회원 보호 트리거 --------------------------------------------------------------------------------------
-- 5-1. 쓰기 막기(문의·수정 이력·문제·지문·문제지·문제지 문항). 남은 JWT(최대 1시간)와 SECURITY DEFINER 문의·문제지 함수 경로를 함께 막는다.
--      익명화·가림 함수가 켠 거래 로컬 설정(값 = 그 회원 id)이 있을 때만 통과한다.
CREATE OR REPLACE FUNCTION public.guard_withdrawn_member_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_withdrawn_member_write$
DECLARE
  v_user uuid;
BEGIN
  IF TG_TABLE_NAME = 'support_ticket_revisions' THEN
    SELECT t.user_id INTO v_user FROM public.support_tickets t WHERE t.id = NEW.ticket_id;
  ELSIF TG_TABLE_NAME = 'exam_paper_items' THEN
    SELECT p.user_id INTO v_user FROM public.exam_papers p WHERE p.id = NEW.exam_paper_id;
  ELSE
    v_user := NEW.user_id;
  END IF;
  IF v_user IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user AND p.withdrawn_at IS NOT NULL)
     AND COALESCE(current_setting('app.member_withdrawal_bypass', true), '') IS DISTINCT FROM v_user::text THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAWN';
  END IF;
  RETURN NEW;
END;
$fn_guard_withdrawn_member_write$;

DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.support_tickets;
CREATE TRIGGER guard_withdrawn_member_write BEFORE INSERT OR UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawn_member_write();
DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.support_ticket_revisions;
CREATE TRIGGER guard_withdrawn_member_write BEFORE INSERT OR UPDATE ON public.support_ticket_revisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawn_member_write();
DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.questions;
CREATE TRIGGER guard_withdrawn_member_write BEFORE INSERT OR UPDATE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawn_member_write();
DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.passages;
CREATE TRIGGER guard_withdrawn_member_write BEFORE INSERT OR UPDATE ON public.passages
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawn_member_write();
DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.exam_papers;
CREATE TRIGGER guard_withdrawn_member_write BEFORE INSERT OR UPDATE ON public.exam_papers
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawn_member_write();
DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.exam_paper_items;
CREATE TRIGGER guard_withdrawn_member_write BEFORE INSERT OR UPDATE ON public.exam_paper_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawn_member_write();

-- 5-2. 상품 조회 기록: 탈퇴 회원이면 user_id 를 비워 넣는다.
CREATE OR REPLACE FUNCTION public.guard_withdrawn_member_view_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_withdrawn_member_view_event$
BEGIN
  IF NEW.user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.withdrawn_at IS NOT NULL) THEN
    NEW.user_id := NULL;
  END IF;
  RETURN NEW;
END;
$fn_guard_withdrawn_member_view_event$;

DROP TRIGGER IF EXISTS guard_withdrawn_member_view_event ON public.market_item_view_events;
CREATE TRIGGER guard_withdrawn_member_view_event BEFORE INSERT ON public.market_item_view_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawn_member_view_event();

-- 5-3. 크레딧 원천: 새 원천이나 잔량 증가는 탈퇴 회원이면 거절(refund_credits·자료 환불 정산·예외 환불·대표 정산·관리자 지급·카카오 지급을 덮는다).
CREATE OR REPLACE FUNCTION public.guard_withdrawn_member_credit_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_withdrawn_member_credit_source$
DECLARE
  v_withdrawn_at timestamptz;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.remaining_credits > OLD.remaining_credits THEN
    SELECT p.withdrawn_at INTO v_withdrawn_at
      FROM public.profiles p
     WHERE p.id = NEW.user_id
       FOR KEY SHARE;
    IF v_withdrawn_at IS NOT NULL THEN
      RAISE EXCEPTION 'MEMBER_WITHDRAWN';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn_guard_withdrawn_member_credit_source$;

DROP TRIGGER IF EXISTS guard_withdrawn_member_credit_source ON public.credit_sources;
CREATE TRIGGER guard_withdrawn_member_credit_source BEFORE INSERT OR UPDATE OF remaining_credits ON public.credit_sources
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawn_member_credit_source();

-- 5-4. 알림: 탈퇴 회원에게는 만들지 않는다(조용히 버림).
CREATE OR REPLACE FUNCTION public.guard_withdrawn_member_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_withdrawn_member_notification$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.withdrawn_at IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$fn_guard_withdrawn_member_notification$;

DROP TRIGGER IF EXISTS guard_withdrawn_member_notification ON public.notifications;
CREATE TRIGGER guard_withdrawn_member_notification BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawn_member_notification();

-- 5-5. 충전 환불 완료: 탈퇴 회원이면 같은 거래에 보관함 추가 기록(manual_refund)을 남긴다.
CREATE OR REPLACE FUNCTION public.record_withdrawn_member_manual_refund()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_record_withdrawn_member_manual_refund$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.withdrawn_at IS NOT NULL) THEN
    INSERT INTO public.withdrawn_member_record_events (user_id, kind, ref_id, details)
    VALUES (NEW.user_id, 'manual_refund', NEW.id,
            jsonb_build_object('refund_amount', NEW.refund_amount, 'source_id', NEW.source_id,
                               'payment_order_id', NEW.payment_order_id, 'processed_at', NEW.processed_at))
    ON CONFLICT (user_id, kind, ref_id) WHERE ref_id IS NOT NULL AND kind <> 'market_cash_refund' DO NOTHING;
  END IF;
  RETURN NULL;
END;
$fn_record_withdrawn_member_manual_refund$;

DROP TRIGGER IF EXISTS record_withdrawn_member_manual_refund ON public.refund_requests;
CREATE TRIGGER record_withdrawn_member_manual_refund AFTER UPDATE ON public.refund_requests
  FOR EACH ROW WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.record_withdrawn_member_manual_refund();

-- 6. 재정의 ---------------------------------------------------------------------------------------------------
-- 6-1. payapp_fulfill_order_internal
CREATE OR REPLACE FUNCTION public.payapp_fulfill_order_internal(p_payment_order_id uuid, p_approved_at timestamp with time zone)
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
  -- [10번] 시작
  -- 탈퇴 회원: 크레딧을 지급하지 않고 보류한다(주문 수동 확인·경보·보관함 늦은 결제 기록). 반복해도 결과가 같다.
  -- 이미 닫은 보류 주문은 상태·경보를 바꾸지 않는다(닫은 주문에 같은 통보가 다시 와도 열리지 않게).
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_order.user_id AND p.withdrawn_at IS NOT NULL) THEN
    IF EXISTS (SELECT 1 FROM public.withdrawn_member_record_events e
                WHERE e.user_id = v_order.user_id AND e.kind = 'held_order_closed' AND e.ref_id = v_order.id) THEN
      RETURN jsonb_build_object('held', 'MEMBER_WITHDRAWN', 'closed', true);
    END IF;

    UPDATE public.payment_orders
       SET status = 'manual_review',
           failure_code = 'PAYMENT_FOR_WITHDRAWN_MEMBER',
           failure_message = '탈퇴한 회원의 결제라 크레딧을 지급하지 않고 보류했습니다.',
           next_reconcile_at = NULL,
           updated_at = now()
     WHERE id = v_order.id;

    UPDATE public.checkout_attempts
       SET status = 'manual_review',
           updated_at = now()
     WHERE id = v_order.checkout_attempt_id
       AND status <> 'completed';

    PERFORM public.record_payment_alert(
      'PAYMENT_FOR_WITHDRAWN_MEMBER',
      'critical',
      '탈퇴한 회원의 결제가 들어와 크레딧을 지급하지 않고 보류했습니다. 회원 상세에서 보류 주문을 닫아 주세요.',
      jsonb_build_object('order_payment_order_id', v_order.id,
                         'dedupe_key', 'withdrawn_member_payment:' || v_order.id,
                         'user_id', v_order.user_id)
    );

    INSERT INTO public.withdrawn_member_record_events (user_id, kind, ref_id, details)
    VALUES (v_order.user_id, 'late_payment', v_order.id,
            jsonb_build_object('order_id', v_order.order_id, 'amount', v_order.expected_amount, 'approved_at', p_approved_at))
    ON CONFLICT (user_id, kind, ref_id) WHERE ref_id IS NOT NULL AND kind <> 'market_cash_refund' DO NOTHING;

    RETURN jsonb_build_object('held', 'MEMBER_WITHDRAWN');
  END IF;
  -- [10번] 끝

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
$function$
;

-- 6-2. apply_payapp_feedback
CREATE OR REPLACE FUNCTION public.apply_payapp_feedback(p_userid text, p_mul_no text, p_orig_mul_no text, p_order_id text, p_pay_state integer, p_price integer, p_orig_price integer, p_pay_type integer, p_pay_date timestamp with time zone, p_canceldate timestamp with time zone)
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
    -- 부분취소 뒤 승인취소는 price가 잔액(원금 - 부분취소 금액)으로 올 수 있어 그 값도 받는다.
    -- price가 NULL이면 지금처럼 금액 불일치로 둔다.
    ELSIF p_pay_state IN (9, 64)
      AND p_price IS DISTINCT FROM v_order.expected_amount
      AND NOT (p_price IS NOT NULL
               AND v_ppt.partial_cancel_amount IS NOT NULL
               AND p_price = v_order.expected_amount - v_ppt.partial_cancel_amount) THEN
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
      -- [10번] 시작
      -- 탈퇴 회원 보류 주문(late_payment 기록 있음 — 닫기 전·닫은 뒤 모두)은 상태를 바꾸지 않고 경보만 남긴다
      -- (취소 처리 뒤 닫기 전에 온 통보로 대표가 풀 길이 없는 manual_review 를 만들지 않게).
      IF EXISTS (SELECT 1 FROM public.withdrawn_member_record_events e
                  WHERE e.user_id = v_order.user_id AND e.kind = 'late_payment' AND e.ref_id = v_order.id) THEN
        PERFORM public.record_payment_alert(
          'WITHDRAWN_HELD_ORDER_FEEDBACK_MISMATCH',
          'critical',
          COALESCE(NULLIF(btrim(public.member_withdrawal_policy() -> 'texts' ->> 'alertHeldOrderFeedbackMismatch'), ''),
                   'WITHDRAWN_HELD_ORDER_FEEDBACK_MISMATCH'),
          jsonb_build_object('payment_order_id', v_order.id, 'reason', v_reason, 'pay_state', p_pay_state,
                             'dedupe_key', 'withdrawn_held_order_feedback:' || v_order.id)
        );
        RETURN jsonb_build_object(
          'result', 'ignored',
          'reason', v_reason,
          'payment_order_id', v_order_id,
          'order_id', v_order.order_id
        );
      END IF;
      -- [10번] 끝
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
    -- [10번] 시작
    -- 탈퇴 회원 보류 주문(늦은 결제 기록 있음)은 fulfillment_pending 으로 되돌리지 않는다.
    -- 닫은 주문이 대사에 다시 집히거나 보류 주문의 상태가 오가지 않게 하려는 것이다.
    IF EXISTS (SELECT 1 FROM public.withdrawn_member_record_events e
                WHERE e.user_id = v_order.user_id AND e.kind = 'late_payment' AND e.ref_id = v_order.id) THEN
      RETURN jsonb_build_object(
        'result', 'withdrawn_member_hold',
        'payment_order_id', v_order.id,
        'order_id', v_order.order_id,
        'closed', EXISTS (SELECT 1 FROM public.withdrawn_member_record_events e
                           WHERE e.user_id = v_order.user_id AND e.kind = 'held_order_closed' AND e.ref_id = v_order.id),
        'paid_amount_conflict', v_paid_amount_conflict
      );
    END IF;
    -- [10번] 끝

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
      -- [10번] 시작
-- [10번 원래]       'result', CASE WHEN v_fulfill IS NULL THEN 'recorded_pending' ELSE 'fulfilled' END,
      'result', CASE WHEN v_fulfill IS NULL THEN 'recorded_pending' WHEN v_fulfill ? 'held' THEN 'withdrawn_member_hold' ELSE 'fulfilled' END,
      -- [10번] 끝
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
$function$
;

-- 6-3. retry_payapp_fulfillment
CREATE OR REPLACE FUNCTION public.retry_payapp_fulfillment(p_payment_order_id uuid)
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
    -- [10번] 시작
    -- 탈퇴 회원이면 지급하지 않고 보류했다(알림 없음).
    IF v_fulfill ? 'held' THEN
      RETURN jsonb_build_object(
        'result', 'withdrawn_member_hold',
        'user_id', v_order.user_id,
        'closed', COALESCE((v_fulfill ->> 'closed')::boolean, false)
      );
    END IF;
    -- [10번] 끝
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
$function$
;

-- 6-4. resolve_payment_order_review
CREATE OR REPLACE FUNCTION public.resolve_payment_order_review(p_payment_order_id uuid, p_action text, p_actor_id uuid, p_note text, p_mul_no text DEFAULT NULL::text, p_paid_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_external_method text DEFAULT NULL::text)
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
  -- [10번] 시작
  -- 탈퇴 회원 주문은 결제확인(지급)을 하지 않는다. 탈퇴 회원 보류 주문(늦은 결제 기록 있음)은
  -- 이 함수로 정리하지 않고 close_withdrawn_member_held_order 로 닫는다(부분취소 뒤 포함).
  IF EXISTS (SELECT 1 FROM public.withdrawn_member_record_events e
              WHERE e.user_id = v_order.user_id AND e.kind = 'late_payment' AND e.ref_id = v_order.id)
     OR (p_action = 'paid_confirmed'
         AND (v_order.failure_code = 'PAYMENT_FOR_WITHDRAWN_MEMBER'
              OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_order.user_id AND p.withdrawn_at IS NOT NULL))) THEN
    RAISE EXCEPTION 'PAYMENT_REVIEW_MEMBER_WITHDRAWN';
  END IF;
  -- [10번] 끝

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
$function$
;

-- 6-5. prepare_payment_order
CREATE OR REPLACE FUNCTION public.prepare_payment_order(p_user_id uuid, p_checkout_attempt_id uuid, p_provider text, p_plan_id uuid, p_order_id text, p_plan_name_snapshot text, p_expected_amount integer, p_expected_credits integer, p_provider_environment text, p_provider_merchant_id text, p_request_fingerprint text, p_confirm_idempotency_key text, p_cancel_idempotency_key text, p_expires_at timestamp with time zone, p_tax_free_amount integer, p_vat_amount integer, p_partner_user_id text, p_payment_method_code text DEFAULT NULL::text)
 RETURNS payment_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  -- [10번] 시작
  v_withdrawn_at timestamptz;
  -- [10번] 끝
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
  -- [10번] 시작
  -- 탈퇴 회원은 새 결제도 기존 주문 재사용도 받지 않는다(결제 시도 잠금 다음, 주문 INSERT 전 — 거절하면 거래 전체가 롤백된다).
  SELECT p.withdrawn_at INTO v_withdrawn_at
    FROM public.profiles p
   WHERE p.id = p_user_id
   FOR SHARE;
  IF v_withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAWN';
  END IF;
  -- [10번] 끝

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
$function$
;

-- 6-6. begin_payapp_request
CREATE OR REPLACE FUNCTION public.begin_payapp_request(p_payment_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_runtime public.payment_runtime_config%ROWTYPE;
  -- [10번] 시작
  v_withdrawn_at timestamptz;
  -- [10번] 끝
BEGIN
  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  IF NOT FOUND OR v_order.provider <> 'payapp' THEN
    RAISE EXCEPTION 'PAYAPP_ORDER_NOT_FOUND';
  END IF;
  -- [10번] 시작
  -- 탈퇴 회원 주문은 결제창을 열지 않는다(주문 잠금 뒤 프로필을 FOR SHARE 로 읽음).
  SELECT p.withdrawn_at INTO v_withdrawn_at
    FROM public.profiles p
   WHERE p.id = v_order.user_id
   FOR SHARE;
  IF v_withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAWN';
  END IF;
  -- [10번] 끝

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
$function$
;

-- 6-7. record_point_charge_checkout_ack
CREATE OR REPLACE FUNCTION public.record_point_charge_checkout_ack(p_user_id uuid, p_checkout_attempt_id uuid, p_plan_id uuid, p_expected_amount integer, p_expected_credits integer, p_notice_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- [10번] 시작
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.withdrawn_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MEMBER_WITHDRAWN');
  END IF;
  -- [10번] 끝

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
$function$
;

-- 6-8. process_payapp_cancellation
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
  -- [10번] 시작
  v_closed_method text;
  -- [10번] 끝
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
        -- [10번] 시작
        -- 탈퇴 회원 보류 주문을 이미 닫았으면 다시 열지 않는다. 계좌 송금으로 닫았다면 이중 환불 의심 경보.
        SELECT paa.external_method INTO v_closed_method
          FROM public.payment_admin_actions paa
         WHERE paa.payment_order_id = v_order.id
           AND paa.action = 'withdrawn_held_order_closed'
         ORDER BY paa.created_at DESC
         LIMIT 1;
        IF FOUND THEN
          IF v_closed_method = 'bank_transfer' THEN
            v_result := 'double_refund_suspected';
            v_detail := jsonb_build_object('source', 'withdrawn_held_order_bank_transfer');
          ELSE
            v_result := 'cancelled_before_fulfillment';
          END IF;
        ELSE
        -- [10번] 끝
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

        -- [10번] 시작
-- [10번 원래]         v_result := 'cancelled_before_fulfillment';
-- [10번 원래]       ELSIF v_order.status = 'refunded' THEN
        v_result := 'cancelled_before_fulfillment';
        END IF;
      ELSIF v_order.status = 'refunded' THEN
        -- [10번] 끝
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
      -- [10번] 시작
-- [10번 원래]       ELSIF v_order.source_id IS NULL THEN
-- [10번 원래]         UPDATE public.payment_orders
-- [10번 원래]            SET status = 'manual_review',
-- [10번 원래]                failure_code = 'PAYAPP_PARTIAL_CANCEL',
      ELSIF v_order.source_id IS NULL
            AND EXISTS (SELECT 1 FROM public.payment_admin_actions paa
                         WHERE paa.payment_order_id = v_order.id AND paa.action = 'withdrawn_held_order_closed') THEN
        -- 닫은 탈퇴 회원 보류 주문에 온 부분취소: 주문을 다시 열지 않는다. 계좌 송금으로 닫았다면 이중 환불 의심 경보.
        SELECT paa.external_method INTO v_closed_method
          FROM public.payment_admin_actions paa
         WHERE paa.payment_order_id = v_order.id
           AND paa.action = 'withdrawn_held_order_closed'
         ORDER BY paa.created_at DESC
         LIMIT 1;
        UPDATE public.payment_provider_transactions
           SET partial_cancel_processed_at = COALESCE(partial_cancel_processed_at, now()),
               updated_at = now()
         WHERE id = v_ppt.id;
        IF v_closed_method = 'bank_transfer' THEN
          v_result := 'double_refund_suspected';
          v_detail := jsonb_build_object('source', 'withdrawn_held_order_bank_transfer');
        ELSE
          v_result := 'partial_cancel_unpaid';
        END IF;
      ELSIF v_order.source_id IS NULL THEN
        UPDATE public.payment_orders
           SET status = 'manual_review',
               failure_code = 'PAYAPP_PARTIAL_CANCEL',
      -- [10번] 끝
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

  -- [10번] 시작
  -- 닫은 탈퇴 회원 보류 주문(지급 전, 닫기 조치 기록 있음): manual_review 로 되돌리지 않고 failed 를 유지한다.
  -- 닫은 주문은 다시 닫지 않으므로(replay) 풀 길이 없는 수동 확인을 만들지 않게. 처리 시각만 남기고,
  -- 계좌 송금으로 닫았으면 이중 환불 의심 경보, 아니면 처리 실패 경보를 남긴다(돈은 더 보내지 않는다).
  IF v_order.source_id IS NULL THEN
    SELECT paa.external_method INTO v_closed_method
      FROM public.payment_admin_actions paa
     WHERE paa.payment_order_id = v_order.id
       AND paa.action = 'withdrawn_held_order_closed'
     ORDER BY paa.created_at DESC
     LIMIT 1;
    IF FOUND THEN
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
      IF v_closed_method = 'bank_transfer' THEN
        PERFORM public.record_payment_alert(
          'PAYAPP_DOUBLE_REFUND_SUSPECTED',
          'critical',
          '계좌이체로 환불한 결제가 페이앱에서도 취소되었습니다.',
          jsonb_build_object('order_id', v_order.order_id, 'payment_order_id', v_order.id,
                             'source', 'withdrawn_held_order_bank_transfer', 'error_state', v_error_state)
        );
        RETURN jsonb_build_object(
          'result', 'double_refund_suspected',
          'marker', v_marker,
          'payment_order_id', v_order.id,
          'order_id', v_order.order_id,
          'user_id', v_order.user_id,
          'source', 'withdrawn_held_order_bank_transfer',
          'error_state', v_error_state
        );
      END IF;
      PERFORM public.record_payment_alert(
        'PAYAPP_CANCEL_HANDLING_FAILED',
        'critical',
        COALESCE(NULLIF(btrim(public.member_withdrawal_policy() -> 'texts' ->> 'alertClosedHeldOrderCancelFailed'), ''),
                 'PAYAPP_CANCEL_HANDLING_FAILED'),
        jsonb_build_object('order_id', v_order.order_id, 'payment_order_id', v_order.id, 'source', 'process_payapp_cancellation',
                           'error_state', v_error_state, 'withdrawn_held_order_closed', true)
      );
      RETURN jsonb_build_object(
        'result', 'cancel_handling_failed',
        'marker', v_marker,
        'payment_order_id', v_order.id,
        'order_id', v_order.order_id,
        'error_state', v_error_state,
        'closed', true
      );
    END IF;
  END IF;
  -- [10번] 끝
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
$function$
;

-- 6-9. payapp_sales_resume_blockers
CREATE OR REPLACE FUNCTION public.payapp_sales_resume_blockers()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_scheduler public.payment_reconciliation_scheduler%ROWTYPE;
  v_scheduler_stale boolean;
  v_payapp_unfulfilled_count integer;
  v_payapp_money_review_count integer;
  v_payapp_cancel_active_count integer;
BEGIN
  SELECT *
    INTO v_scheduler
    FROM public.payment_reconciliation_scheduler
   WHERE id = 1;

  v_scheduler_stale := v_scheduler.last_started_at IS NOT NULL
    AND (
      v_scheduler.last_succeeded_at IS NULL
      OR v_scheduler.last_succeeded_at <= now() - interval '15 minutes'
    );

  SELECT COUNT(*)::integer
    INTO v_payapp_unfulfilled_count
    FROM public.payment_orders po
    JOIN public.payment_provider_transactions ppt ON ppt.payment_order_id = po.id
   WHERE po.provider = 'payapp'
     AND ppt.paid_feedback_recorded_at <= now() - interval '10 minutes'
     AND po.source_id IS NULL
     -- [10번] 시작
-- [10번 원래]      AND ppt.cancel_feedback_recorded_at IS NULL
-- [10번 원래]      AND ppt.partial_cancel_feedback_recorded_at IS NULL;
     AND ppt.cancel_feedback_recorded_at IS NULL
     AND ppt.partial_cancel_feedback_recorded_at IS NULL
     AND NOT EXISTS ( SELECT 1 FROM public.withdrawn_member_record_events wre WHERE wre.kind = 'held_order_closed' AND wre.ref_id = po.id );
     -- [10번] 끝

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
    COUNT(*) FILTER (WHERE cs.status = 'active')::integer
    INTO v_payapp_cancel_active_count
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

  RETURN jsonb_build_object(
    'paid_unfulfilled_count', v_payapp_unfulfilled_count,
    'money_review_count', v_payapp_money_review_count,
    'cancel_unprocessed_active_count', v_payapp_cancel_active_count,
    -- 점검 작업 기록 행이 없으면 건강하다고 볼 근거가 없으므로 막는다.
    'scheduler_unhealthy', COALESCE(v_scheduler_stale OR v_scheduler.consecutive_failures >= 3, true),
    'consecutive_failures', v_scheduler.consecutive_failures,
    'last_succeeded_at', v_scheduler.last_succeeded_at
  );
END;
$function$
;

-- 6-10. enforce_payment_reconciliation_health
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
  v_feedback_ack timestamptz;
  v_feedback_unprocessed_count integer;
  v_feedback_latest timestamptz;
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
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  ELSIF v_kakao_marker_frozen_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'KAKAOPAY_PARTIAL_CANCEL_UNPROCESSED_FROZEN',
      'warning',
      '카카오페이 부분취소 처리가 10분 넘게 끝나지 않았습니다(크레딧은 묶여 있음).',
      jsonb_build_object('count', v_kakao_marker_frozen_count)
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  -- 페이앱 블록: 돈이 걸린 위험만 판매를 끈다.
  SELECT COUNT(*)::integer
    INTO v_payapp_unfulfilled_count
    FROM public.payment_orders po
    JOIN public.payment_provider_transactions ppt ON ppt.payment_order_id = po.id
   WHERE po.provider = 'payapp'
     AND ppt.paid_feedback_recorded_at <= now() - interval '10 minutes'
     AND po.source_id IS NULL
     -- [10번] 시작
-- [10번 원래]      AND ppt.cancel_feedback_recorded_at IS NULL
-- [10번 원래]      AND ppt.partial_cancel_feedback_recorded_at IS NULL;
     AND ppt.cancel_feedback_recorded_at IS NULL
     AND ppt.partial_cancel_feedback_recorded_at IS NULL
     AND NOT EXISTS ( SELECT 1 FROM public.withdrawn_member_record_events wre WHERE wre.kind = 'held_order_closed' AND wre.ref_id = po.id );
     -- [10번] 끝

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

  -- change_ticket에 남길 첫 code. 경보는 아래에서 조건마다 따로 남긴다.
  IF v_payapp_unfulfilled_count > 0 THEN
    v_payapp_code := 'PAYAPP_PAID_UNFULFILLED';
  ELSIF v_payapp_cancel_active_count > 0 THEN
    v_payapp_code := 'PAYAPP_CANCEL_UNPROCESSED';
  ELSIF v_payapp_money_review_count > 0 THEN
    v_payapp_code := 'PAYAPP_MONEY_RISK_REVIEW';
  ELSIF v_payapp_scheduler_unhealthy THEN
    v_payapp_code := 'PAYAPP_RECONCILIATION_UNHEALTHY';
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
  -- 조건마다 따로 남겨 한 조건이 다른 조건(특히 취소 미처리)을 가리지 않게 한다.
  IF v_payapp_unfulfilled_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'PAYAPP_PAID_UNFULFILLED',
      'critical',
      '결제완료가 기록됐지만 10분 넘게 크레딧이 지급되지 않은 페이앱 건이 있습니다.',
      jsonb_build_object(
        'paid_unfulfilled_count', v_payapp_unfulfilled_count,
        'money_review_count', v_payapp_money_review_count,
        'cancel_unprocessed_active_count', v_payapp_cancel_active_count,
        'consecutive_failures', v_scheduler.consecutive_failures,
        'last_succeeded_at', v_scheduler.last_succeeded_at
      )
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  IF v_payapp_cancel_active_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'PAYAPP_CANCEL_UNPROCESSED',
      'critical',
      '페이앱 취소 처리가 10분 넘게 끝나지 않았고 크레딧을 쓸 수 있는 상태입니다.',
      jsonb_build_object(
        'paid_unfulfilled_count', v_payapp_unfulfilled_count,
        'money_review_count', v_payapp_money_review_count,
        'cancel_unprocessed_active_count', v_payapp_cancel_active_count,
        'consecutive_failures', v_scheduler.consecutive_failures,
        'last_succeeded_at', v_scheduler.last_succeeded_at
      )
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  IF v_payapp_money_review_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'PAYAPP_MONEY_RISK_REVIEW',
      'critical',
      '돈이 걸린 페이앱 수동 확인 건이 있습니다.',
      jsonb_build_object(
        'paid_unfulfilled_count', v_payapp_unfulfilled_count,
        'money_review_count', v_payapp_money_review_count,
        'cancel_unprocessed_active_count', v_payapp_cancel_active_count,
        'consecutive_failures', v_scheduler.consecutive_failures,
        'last_succeeded_at', v_scheduler.last_succeeded_at
      )
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  IF v_payapp_cancel_frozen_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'PAYAPP_CANCEL_UNPROCESSED_FROZEN',
      'warning',
      '페이앱 취소 처리가 10분 넘게 끝나지 않았습니다(크레딧은 묶여 있거나 지급 전).',
      jsonb_build_object('count', v_payapp_cancel_frozen_count)
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  -- 기록되지 않은 페이앱 통보: 경보만 남기고 판매는 끄지 않는다.
  -- 이미 확인(해소)된 경보가 덮은 시각 이후만 센다. 해소하면 다시 울리지 않는다.
  SELECT MAX((details->>'latest_received_at')::timestamptz)
    INTO v_feedback_ack
    FROM public.payment_reconciliation_alerts
   WHERE code = 'PAYAPP_FEEDBACK_UNPROCESSED';

  -- pending·failed는 payment_webhook_events_pending_idx, 표식 없이 ignored로 닫힌 취소 계열 통보는
  -- payment_webhook_events_ignored_cancel_idx를 타도록 두 부분으로 나눈다.
  -- PROCESS: 실패는 표식이 이미 커밋된 경우라 취소 미처리 점검과 대사가 다룬다. 사이트 밖 통보는 뺀다.
  SELECT COUNT(*)::integer, MAX(e.received_at)
    INTO v_feedback_unprocessed_count, v_feedback_latest
    FROM (
      SELECT pwe.received_at
        FROM public.payment_webhook_events pwe
       WHERE pwe.processing_status IN ('pending', 'failed')
         AND pwe.transmission_id LIKE 'payapp:%'
         AND pwe.received_at <= now() - interval '30 minutes'
         AND pwe.received_at > COALESCE(v_feedback_ack, '-infinity'::timestamptz)
         AND (pwe.processing_status = 'pending'
              OR COALESCE(pwe.last_error_code, '') NOT LIKE 'PROCESS:%')
      UNION ALL
      SELECT pwe.received_at
        FROM public.payment_webhook_events pwe
       WHERE pwe.processing_status = 'ignored'
         AND pwe.event_type IN ('PAYAPP_PAY_STATE_9', 'PAYAPP_PAY_STATE_64', 'PAYAPP_PAY_STATE_70', 'PAYAPP_PAY_STATE_71')
         AND pwe.transmission_id LIKE 'payapp:%'
         AND pwe.received_at <= now() - interval '30 minutes'
         AND pwe.received_at > COALESCE(v_feedback_ack, '-infinity'::timestamptz)
         AND COALESCE(pwe.last_error_code, '') <> 'PAYAPP_FOREIGN_FEEDBACK'
    ) e;

  IF v_feedback_unprocessed_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES ('PAYAPP_FEEDBACK_UNPROCESSED', 'critical',
            '30분 넘게 처리되지 않은 페이앱 통보가 있습니다. 페이앱 관리자 내역과 대조하세요.',
            jsonb_build_object('count', v_feedback_unprocessed_count, 'latest_received_at', v_feedback_latest))
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
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
$function$
;

-- 6-11. prevent_payment_order_snapshot_update
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
     -- [10번] 시작
-- [10번 원래]      OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
     -- 익명화 거래 로컬 설정 값이 그 주문 회원일 때만 request_fingerprint 한 칸 변경을 받는다.
     OR (NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
         AND COALESCE(current_setting('app.member_withdrawal_bypass', true), '') IS DISTINCT FROM OLD.user_id::text)
     -- [10번] 끝
     OR NEW.checkout_expires_at IS DISTINCT FROM OLD.checkout_expires_at
     OR NEW.ready_requested_at IS DISTINCT FROM OLD.ready_requested_at
     OR NEW.ready_expires_at IS DISTINCT FROM OLD.ready_expires_at
     OR NEW.payment_method_code IS DISTINCT FROM OLD.payment_method_code THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_IMMUTABLE_SNAPSHOT';
  END IF;

  RETURN NEW;
END;
$function$
;

-- 6-12. consent_record_internal
CREATE OR REPLACE FUNCTION public.consent_record_internal(p_user_id uuid, p_items jsonb, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_error text;
  v_provider text;
  v_signup_completed boolean;
  v_email_confirmed_at timestamptz;
  v_has_records boolean;
  v_mode text := 'full';
  v_elem jsonb;
  v_item public.signup_consent_items%ROWTYPE;
  v_agreed boolean;
  v_latest boolean;
  v_item_ids uuid[] := ARRAY[]::uuid[];
  v_doc_key text;
  v_doc jsonb;
  v_hash text;
  -- [10번] 시작
  v_withdrawn_at timestamptz;
  -- [10번] 끝
BEGIN
  IF p_user_id IS NULL OR p_source IS NULL
     -- [10번] 시작
-- [10번 원래]      OR p_source NOT IN ('email_signup', 'kakao_signup', 'consent_gate', 'mypage') THEN
     OR p_source NOT IN ('email_signup', 'kakao_signup', 'consent_gate', 'mypage', 'withdrawal') THEN
     -- [10번] 끝
    RAISE EXCEPTION 'CONSENT_INPUT_INVALID';
  END IF;

  -- ① 회원 advisory ② 항목 쓰기 공유(저장·개정과 겹치지 않게) ③ profiles 행
  PERFORM pg_advisory_xact_lock(hashtextextended('public.user_consents:' || p_user_id::text, 0));
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('public.signup_consent_items:write', 0));

  -- [10번] 시작
-- [10번 원래]   SELECT p.provider, p.signup_completed
-- [10번 원래]     INTO v_provider, v_signup_completed
-- [10번 원래]     FROM public.profiles p
-- [10번 원래]    WHERE p.id = p_user_id
-- [10번 원래]      FOR NO KEY UPDATE;
-- [10번 원래]   IF NOT FOUND THEN
-- [10번 원래]     RAISE EXCEPTION 'CONSENT_PROFILE_MISSING';
-- [10번 원래]   END IF;
  SELECT p.provider, p.signup_completed, p.withdrawn_at
    INTO v_provider, v_signup_completed, v_withdrawn_at
    FROM public.profiles p
   WHERE p.id = p_user_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONSENT_PROFILE_MISSING';
  END IF;
  -- 탈퇴 회원은 탈퇴(withdrawal) 기록만 받는다.
  IF v_withdrawn_at IS NOT NULL AND p_source <> 'withdrawal' THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAWN';
  END IF;
  -- [10번] 끝

  IF p_source IN ('consent_gate', 'mypage') AND v_provider = 'kakao' AND v_signup_completed IS NOT TRUE THEN
    RAISE EXCEPTION 'CONSENT_KAKAO_SIGNUP_INCOMPLETE';
  END IF;
  IF p_source = 'kakao_signup' AND v_provider IS DISTINCT FROM 'kakao' THEN
    RAISE EXCEPTION 'CONSENT_KAKAO_NOT_KAKAO';
  END IF;

  -- [10번] 시작
-- [10번 원래]   v_error := public.consent_items_error(p_items, p_source);
  -- 탈퇴: 철회만 받고 항목 검사는 마이페이지 규칙으로 한다(필수 누락 검사는 아래에서 건너뜀).
  IF p_source = 'withdrawal' THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_items) = 'array' THEN p_items ELSE '[]'::jsonb END) AS e
                WHERE (e -> 'agreed') IS DISTINCT FROM 'false'::jsonb) THEN
      RAISE EXCEPTION 'CONSENT_INPUT_INVALID';
    END IF;
    v_error := public.consent_items_error(p_items, 'mypage');
  ELSE
    v_error := public.consent_items_error(p_items, p_source);
  END IF;
  -- [10번] 끝
  IF v_error IS NOT NULL THEN
    RAISE EXCEPTION '%', v_error;
  END IF;

  SELECT array_agg((e ->> 'item_id')::uuid) INTO v_item_ids FROM jsonb_array_elements(p_items) AS e;

  -- 이메일 가입: 미인증 이메일 계정에만. 기록이 이미 있으면(같은 이메일 재가입 — 제3자일 수 있음) 선택 철회만 받는다.
  IF p_source = 'email_signup' THEN
    SELECT u.email_confirmed_at INTO v_email_confirmed_at FROM auth.users u WHERE u.id = p_user_id;
    IF v_email_confirmed_at IS NOT NULL OR v_provider IS DISTINCT FROM 'email' THEN
      RETURN '[]'::jsonb;
    END IF;
    v_has_records := EXISTS (SELECT 1 FROM public.user_consents c WHERE c.user_id = p_user_id);
    IF v_has_records THEN
      v_mode := 'withdraw_only';
    END IF;
  END IF;

  -- [10번] 시작
-- [10번 원래]   IF v_mode = 'full' AND p_source <> 'mypage'
  IF v_mode = 'full' AND p_source NOT IN ('mypage', 'withdrawal')
  -- [10번] 끝
     AND EXISTS (SELECT 1 FROM public.consent_missing_required(p_user_id, p_items)) THEN
    RAISE EXCEPTION 'CONSENT_REQUIRED_MISSING';
  END IF;

  FOR v_elem IN SELECT e FROM jsonb_array_elements(p_items) AS e LOOP
    SELECT * INTO v_item FROM public.signup_consent_items i WHERE i.id = (v_elem ->> 'item_id')::uuid;
    v_agreed := (v_elem -> 'agreed') = 'true'::jsonb;

    IF v_mode = 'withdraw_only' AND (v_item.required OR v_agreed) THEN
      CONTINUE;
    END IF;

    SELECT c.agreed INTO v_latest
      FROM public.user_consents c
     WHERE c.user_id = p_user_id AND c.item_id = v_item.id AND c.item_version = v_item.version
     ORDER BY c.seq DESC
     LIMIT 1;
    IF FOUND AND v_latest = v_agreed THEN
      CONTINUE;
    END IF;

    -- 연결 약관이 있으면 동의 제출 시점의 저장 본문 지문(sha256)을 함께 적는다(6번 묶음).
    v_hash := NULL;
    IF v_item.policy_slug IS NOT NULL THEN
      SELECT d.key, d.value INTO v_doc_key, v_doc
        FROM public.system_settings s,
             jsonb_each(CASE WHEN jsonb_typeof(s.value -> 'policyDocuments') = 'object' THEN s.value -> 'policyDocuments' ELSE '{}'::jsonb END) AS d
       WHERE s.key = 'site_footer_content'
         AND d.value ->> 'slug' = v_item.policy_slug
       LIMIT 1;
      IF FOUND AND jsonb_typeof(v_doc -> 'content') = 'string' THEN
        v_hash := encode(sha256(convert_to(v_doc ->> 'content', 'UTF8')), 'hex');
        -- 그 본문의 사본이 없으면(이론상 저장 트리거가 보장) 여기서 남긴다.
        IF NOT EXISTS (SELECT 1 FROM public.policy_document_snapshots p WHERE p.doc_key = v_doc_key AND p.content_sha256 = v_hash) THEN
          PERFORM pg_advisory_xact_lock(hashtextextended('public.policy_document_snapshots', 0));
          IF NOT EXISTS (SELECT 1 FROM public.policy_document_snapshots p WHERE p.doc_key = v_doc_key AND p.content_sha256 = v_hash) THEN
            INSERT INTO public.policy_document_snapshots (doc_key, slug, title, content, content_sha256)
            VALUES (v_doc_key, v_doc ->> 'slug', v_doc ->> 'title', v_doc ->> 'content', v_hash);
          END IF;
        END IF;
      END IF;
    END IF;

    INSERT INTO public.user_consents (user_id, item_id, item_version, agreed, source, policy_sha256)
    VALUES (p_user_id, v_item.id, v_item.version, v_agreed, p_source, v_hash);
  END LOOP;

  RETURN public.consent_latest_results(p_user_id, v_item_ids);
END;
$function$
;

-- 6-13. guard_user_consents_mutation
CREATE OR REPLACE FUNCTION public.guard_user_consents_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- [10번] 시작
    -- 익명화 거래 로컬 설정 값이 그 회원이면 DELETE 를 받는다(비결제 회원 익명화).
    IF COALESCE(current_setting('app.member_withdrawal_bypass', true), '') = OLD.user_id::text THEN
      RETURN OLD;
    END IF;
    -- [10번] 끝
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id) THEN
      RAISE EXCEPTION 'USER_CONSENTS_APPEND_ONLY';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'USER_CONSENTS_APPEND_ONLY';
END;
$function$
;

-- 6-14. guard_market_purchase_notice_acks_mutation
CREATE OR REPLACE FUNCTION public.guard_market_purchase_notice_acks_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- [10번] 시작
    -- 익명화 거래 로컬 설정 값이 그 회원이면 DELETE 를 받는다(비결제 회원 익명화).
    IF COALESCE(current_setting('app.member_withdrawal_bypass', true), '') = OLD.user_id::text THEN
      RETURN OLD;
    END IF;
    -- [10번] 끝
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id) THEN
      RAISE EXCEPTION 'MARKET_PURCHASE_NOTICE_ACKS_APPEND_ONLY';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'MARKET_PURCHASE_NOTICE_ACKS_APPEND_ONLY';
END;
$function$
;

-- 6-15. prevent_admin_event_mutation
CREATE OR REPLACE FUNCTION public.prevent_admin_event_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- [10번] 시작
  -- 익명화·가림 함수가 켠 거래 로컬 설정이 있을 때만, 그 회원 문의·환불(과 그 알림 포기 사본)의 title·body UPDATE 를 받는다.
  -- DELETE·TRUNCATE·다른 칸 변경은 계속 막는다.
  IF TG_OP = 'UPDATE'
     AND COALESCE(current_setting('app.member_withdrawal_bypass', true), '') <> ''
     AND NEW.id = OLD.id AND NEW.kind = OLD.kind AND NEW.severity = OLD.severity AND NEW.link = OLD.link
     AND NEW.ref_table IS NOT DISTINCT FROM OLD.ref_table AND NEW.ref_id IS NOT DISTINCT FROM OLD.ref_id
     AND NEW.required_permission = OLD.required_permission AND NEW.delivery = OLD.delivery
     AND NEW.dedupe_key IS NOT DISTINCT FROM OLD.dedupe_key AND NEW.created_at = OLD.created_at
     AND public.member_admin_event_owner(OLD.ref_table, OLD.ref_id)::text = current_setting('app.member_withdrawal_bypass', true) THEN
    RETURN NEW;
  END IF;
  -- [10번] 끝
  RAISE EXCEPTION 'ADMIN_EVENTS_APPEND_ONLY';
END;
$function$
;

-- 6-16. remind_unanswered_admin_work
CREATE OR REPLACE FUNCTION public.remind_unanswered_admin_work()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cfg jsonb;
  v_support_hours numeric;
  v_refund_hours numeric;
  v_from_hour numeric;
  v_until_hour numeric;
  v_now timestamptz := now();
  v_kst timestamp := now() AT TIME ZONE 'Asia/Seoul';
  v_day text;
BEGIN
  -- [10번] 시작
  -- 탈퇴 회원 로그인 계정 정리(서버의 소프트 삭제)가 10분 넘게 끝나지 않았으면 경보를 남긴다(서버가 정리 전에 멈춘 경우).
  -- 익명화 거래에서는 경보를 넣지 않는다(정리가 곧 성공하는 정상 경로마다 알림이 나가지 않게). 한 회원에 한 번만 넣는다.
  -- 보내는 시간대·알림 설정과 상관없이 먼저 본다.
  PERFORM public.record_payment_alert(
    'MEMBER_AUTH_SCRUB_PENDING',
    'warning',
    COALESCE(NULLIF(btrim(public.member_withdrawal_policy() -> 'texts' ->> 'alertAuthScrubPending'), ''), 'MEMBER_AUTH_SCRUB_PENDING'),
    jsonb_build_object('user_id', r.user_id, 'dedupe_key', 'member_auth_scrub:' || r.user_id))
    FROM public.withdrawn_member_records r
   WHERE r.auth_scrubbed_at IS NULL
     AND r.withdrawn_at <= now() - interval '10 minutes'
     AND NOT EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts a
                      WHERE a.code = 'MEMBER_AUTH_SCRUB_PENDING' AND (a.details ->> 'dedupe_key') = 'member_auth_scrub:' || r.user_id);
  -- [10번] 끝
  SELECT s.value -> 'reminders'
    INTO v_cfg
    FROM public.system_settings s
   WHERE s.key = 'admin_alert_settings';

  IF v_cfg IS NULL THEN
    RETURN;
  END IF;

  IF jsonb_typeof(v_cfg -> 'support_after_hours') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_cfg -> 'refund_after_hours') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_cfg -> 'send_from_hour') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_cfg -> 'send_until_hour') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'ADMIN_REMINDER_SETTINGS_INVALID';
  END IF;

  v_support_hours := (v_cfg ->> 'support_after_hours')::numeric;
  v_refund_hours := (v_cfg ->> 'refund_after_hours')::numeric;
  v_from_hour := (v_cfg ->> 'send_from_hour')::numeric;
  v_until_hour := (v_cfg ->> 'send_until_hour')::numeric;

  IF v_support_hours <= 0 OR v_refund_hours <= 0
     OR v_from_hour < 0 OR v_until_hour > 24 OR v_from_hour >= v_until_hour THEN
    RAISE EXCEPTION 'ADMIN_REMINDER_SETTINGS_INVALID';
  END IF;

  -- 보내는 시간대(한국 시각, 이상~미만) 밖이면 만들지 않는다.
  IF extract(hour FROM v_kst) < v_from_hour OR extract(hour FROM v_kst) >= v_until_hour THEN
    RETURN;
  END IF;

  v_day := to_char(v_kst, 'YYYY-MM-DD');

  INSERT INTO public.admin_events (kind, severity, title, body, link, ref_table, ref_id, required_permission, dedupe_key)
  SELECT
    'support_unanswered',
    'info',
    '답변 대기 문의'
      || COALESCE(' [' || COALESCE(
           t.category_snapshot ->> 'name',
           (SELECT c.name FROM public.support_ticket_categories c WHERE c.id = t.category_id)
         ) || ']', '')
      || ' ' || left(regexp_replace(t.subject, '\s+', ' ', 'g'), 30),
    format('접수 후 %s시간 지남', floor(extract(epoch FROM v_now - t.created_at) / 3600)),
    '/admin/support',
    'support_tickets',
    t.id,
    'support.manage',
    'support_unanswered:' || t.id || ':' || v_day
  FROM public.support_tickets t
  -- [10번] 시작
-- [10번 원래]   WHERE t.status = 'pending'
-- [10번 원래]     AND t.is_deleted_by_user = false
  WHERE t.status = 'pending'
    AND t.is_deleted_by_user = false
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = t.user_id AND p.withdrawn_at IS NOT NULL)
  -- [10번] 끝
    AND t.created_at <= v_now - make_interval(secs => (v_support_hours * 3600)::double precision)
  ON CONFLICT (dedupe_key) DO NOTHING;

  INSERT INTO public.admin_events (kind, severity, title, body, link, ref_table, ref_id, required_permission, dedupe_key)
  SELECT
    'refund_unanswered',
    'info',
    '처리 대기 문제마켓 환불',
    format('요청 %s크레딧 · 접수 후 %s시간 지남',
           r.requested_refund_credits,
           floor(extract(epoch FROM v_now - r.created_at) / 3600)),
    '/admin/refunds',
    'market_refund_requests',
    r.id,
    'refunds.market',
    'refund_unanswered:' || r.id || ':' || v_day
  FROM public.market_refund_requests r
  WHERE r.status = 'pending'
    AND r.created_at <= v_now - make_interval(secs => (v_refund_hours * 3600)::double precision)
  ON CONFLICT (dedupe_key) DO NOTHING;

  INSERT INTO public.admin_events (kind, severity, title, body, link, ref_table, ref_id, required_permission, dedupe_key)
  SELECT
    'refund_unanswered',
    'info',
    CASE WHEN r.status = 'pending_review' THEN '처리 대기 충전 환불' ELSE '확인이 필요한 충전 환불' END,
    concat_ws(' · ',
      '환불 금액 ' || r.refund_amount || '원',
      format('%s시간 지남', floor(extract(epoch FROM v_now - s.since) / 3600))),
    '/admin/refunds',
    'refund_requests',
    r.id,
    'refunds.payment',
    'refund_unanswered:' || r.id || ':' || v_day
  FROM public.refund_requests r
  CROSS JOIN LATERAL (
    SELECT CASE WHEN r.status = 'pending_review' THEN r.created_at ELSE COALESCE(r.updated_at, r.created_at) END AS since
  ) s
  WHERE r.status IN ('pending_review', 'retryable_failed', 'manual_review')
    AND s.since <= v_now - make_interval(secs => (v_refund_hours * 3600)::double precision)
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$function$
;

-- 6-17. guard_support_ticket_revisions_mutation
CREATE OR REPLACE FUNCTION public.guard_support_ticket_revisions_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = OLD.ticket_id) THEN
      RAISE EXCEPTION 'SUPPORT_TICKET_REVISIONS_APPEND_ONLY';
    END IF;
    RETURN OLD;
  END IF;
  -- [10번] 시작
  IF TG_OP = 'UPDATE'
     AND COALESCE(current_setting('app.member_withdrawal_bypass', true), '') <> ''
     AND current_setting('app.member_withdrawal_bypass', true)
         = (SELECT t.user_id::text FROM public.support_tickets t WHERE t.id = OLD.ticket_id)
     AND NEW.id = OLD.id AND NEW.ticket_id = OLD.ticket_id
     AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id
     AND NEW.written_at = OLD.written_at AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  -- [10번] 끝
  RAISE EXCEPTION 'SUPPORT_TICKET_REVISIONS_APPEND_ONLY';
END;
$function$
;

-- 6-18. cancel_incomplete_kakao_signup
CREATE OR REPLACE FUNCTION public.cancel_incomplete_kakao_signup(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_provider text;
  v_signup_completed boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'CONSENT_INPUT_INVALID';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('public.user_consents:' || p_user_id::text, 0));
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('public.signup_consent_items:write', 0));

  SELECT p.provider, p.signup_completed
    INTO v_provider, v_signup_completed
    FROM public.profiles p
   WHERE p.id = p_user_id
     FOR UPDATE;
  IF NOT FOUND OR v_provider IS DISTINCT FROM 'kakao' OR v_signup_completed IS TRUE THEN
    RETURN false;
  END IF;
  -- [10번] 시작
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.withdrawn_at IS NOT NULL) THEN
    RETURN false;
  END IF;
  -- [10번] 끝
  -- 관리자 계정은 여기서 지우지 않는다(탈퇴 route 와 같은 규칙).
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.is_admin IS TRUE) THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_orders o WHERE o.user_id = p_user_id)
     OR EXISTS (SELECT 1 FROM public.checkout_attempts a WHERE a.user_id = p_user_id) THEN
    RETURN false;
  END IF;

  DELETE FROM public.exam_papers WHERE user_id = p_user_id;
  DELETE FROM public.questions WHERE user_id = p_user_id;
  DELETE FROM public.support_tickets WHERE user_id = p_user_id;
  DELETE FROM public.credit_transactions WHERE user_id = p_user_id;
  RETURN true;
END;
$function$
;

-- 6-19. complete_kakao_signup_with_consents
CREATE OR REPLACE FUNCTION public.complete_kakao_signup_with_consents(p_user_id uuid, p_items jsonb, p_email text, p_phone text, p_kakao_email text, p_kakao_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_provider text;
  v_signup_completed boolean;
  v_profile jsonb;
  v_optional_ids uuid[];
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'CONSENT_INPUT_INVALID';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('public.user_consents:' || p_user_id::text, 0));
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('public.signup_consent_items:write', 0));

  SELECT p.provider, p.signup_completed
    INTO v_provider, v_signup_completed
    FROM public.profiles p
   WHERE p.id = p_user_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONSENT_PROFILE_MISSING';
  END IF;
  -- [10번] 시작
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.withdrawn_at IS NOT NULL) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAWN';
  END IF;
  -- [10번] 끝
  IF v_provider IS DISTINCT FROM 'kakao' THEN
    RAISE EXCEPTION 'CONSENT_KAKAO_NOT_KAKAO';
  END IF;

  IF v_signup_completed IS NOT TRUE THEN
    PERFORM public.consent_record_internal(p_user_id, p_items, 'kakao_signup');

    UPDATE public.profiles
       SET email = p_email,
           phone = NULLIF(btrim(COALESCE(p_phone, '')), ''),
           kakao_email = p_email,
           kakao_id = p_kakao_id,
           provider = 'kakao',
           signup_completed = true
     WHERE id = p_user_id;
  END IF;

  SELECT jsonb_build_object('id', p.id, 'email', p.email, 'phone', p.phone, 'signup_completed', p.signup_completed)
    INTO v_profile
    FROM public.profiles p
   WHERE p.id = p_user_id;

  SELECT COALESCE(array_agg(i.id), ARRAY[]::uuid[]) INTO v_optional_ids
    FROM public.signup_consent_items i
   WHERE NOT i.required;

  RETURN jsonb_build_object(
    'profile', v_profile,
    'consentResults', public.consent_latest_results(p_user_id, v_optional_ids)
  );
END;
$function$
;

-- 6-20. consent_eligible_member_count
CREATE OR REPLACE FUNCTION public.consent_eligible_member_count()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT count(*)::integer
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
   -- [10번] 시작
-- [10번 원래]    WHERE NOT public.is_internal_admin_account(u.email)
   WHERE NOT public.is_internal_admin_account(u.email)
     AND p.withdrawn_at IS NULL
   -- [10번] 끝
     AND (
       (p.provider = 'kakao' AND p.signup_completed IS TRUE)
       OR (p.provider IS DISTINCT FROM 'kakao' AND u.email_confirmed_at IS NOT NULL)
     )
$function$
;

-- 7. service_role 함수 ------------------------------------------------------------------------------------------
-- 오류는 RAISE EXCEPTION '<코드>' (필요하면 USING DETAIL = jsonb 문자열). 코드 단계에서 문구로 바꾼다.

-- 7-1. 미리보기(대표 회원 상세·회원 탈퇴 화면 판단). 회원 화면에는 서버가 필요한 값만 골라 보낸다.
CREATE OR REPLACE FUNCTION public.get_member_withdrawal_preview(p_user_id uuid, p_ticket_retention_agreed boolean DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_get_member_withdrawal_preview$
DECLARE
  v_facts jsonb;
  v_without jsonb;
  v_request jsonb;
  v_counts jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  v_facts := public.member_withdrawal_facts(p_user_id, COALESCE(p_ticket_retention_agreed, true));
  IF NOT COALESCE((v_facts ->> 'exists')::boolean, false) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_USER_NOT_FOUND';
  END IF;
  v_without := public.member_withdrawal_facts(p_user_id, false);

  SELECT jsonb_build_object(
           'id', r.id, 'channel', r.channel, 'requesterKind', r.requester_kind, 'receivedAt', r.received_at,
           'noticeSha256', r.notice_sha256, 'noticeSentAt', r.notice_sent_at, 'consentReplyReceivedAt', r.consent_reply_received_at,
           'ticketRetentionAgreed', r.ticket_retention_agreed, 'expectedBalance', r.expected_balance,
           'expectedForfeitPaid', r.expected_forfeit_paid, 'expectedForfeitFree', r.expected_forfeit_free,
           'marketingWithdrawnAt', r.marketing_withdrawn_at, 'createdAt', r.created_at)
    INTO v_request
    FROM public.member_withdrawal_requests r
   WHERE r.user_id = p_user_id AND r.status = 'pending';

  v_counts := jsonb_build_object(
    'tickets', (SELECT count(*) FROM public.support_tickets t WHERE t.user_id = p_user_id),
    'ticketRevisions', (SELECT count(*) FROM public.support_ticket_revisions rv JOIN public.support_tickets t ON t.id = rv.ticket_id WHERE t.user_id = p_user_id),
    'questions', (SELECT count(*) FROM public.questions q WHERE q.user_id = p_user_id),
    'examPapers', (SELECT count(*) FROM public.exam_papers e WHERE e.user_id = p_user_id),
    'passages', (SELECT count(*) FROM public.passages x WHERE x.user_id = p_user_id),
    'generationJobs', (SELECT count(*) FROM public.generate_listboard_generation_jobs j WHERE j.user_id = p_user_id),
    'generationRuns', (SELECT count(*) FROM public.ai_question_generation_runs g WHERE g.user_id = p_user_id),
    'testRuns', (SELECT count(*) FROM public.problem_type_test_runs x WHERE x.user_id = p_user_id),
    'reviews', (SELECT count(*) FROM public.market_item_reviews x WHERE x.user_id = p_user_id),
    'reviewVotes', (SELECT count(*) FROM public.market_item_review_votes x WHERE x.user_id = p_user_id),
    'notifications', (SELECT count(*) FROM public.notifications x WHERE x.user_id = p_user_id),
    'cartItems', (SELECT count(*) FROM public.market_cart_items x WHERE x.user_id = p_user_id),
    'viewEvents', (SELECT count(*) FROM public.market_item_view_events x WHERE x.user_id = p_user_id),
    'marketOrders', (SELECT count(*) FROM public.market_purchase_orders x WHERE x.user_id = p_user_id),
    'marketPurchases', (SELECT count(*) FROM public.market_purchases x WHERE x.user_id = p_user_id),
    'entitlements', (SELECT count(*) FROM public.market_entitlements x WHERE x.user_id = p_user_id),
    'downloads', (SELECT count(*) FROM public.market_download_events x WHERE x.user_id = p_user_id),
    'marketRefunds', (SELECT count(*) FROM public.market_refund_requests x WHERE x.user_id = p_user_id),
    'purchaseNoticeAcks', (SELECT count(*) FROM public.market_purchase_notice_acks x WHERE x.user_id = p_user_id),
    'creditSources', (SELECT count(*) FROM public.credit_sources x WHERE x.user_id = p_user_id),
    'creditTransactions', (SELECT count(*) FROM public.credit_transactions x WHERE x.user_id = p_user_id),
    'consents', (SELECT count(*) FROM public.user_consents x WHERE x.user_id = p_user_id),
    'paymentOrders', (SELECT count(*) FROM public.payment_orders x WHERE x.user_id = p_user_id),
    'checkoutAttempts', (SELECT count(*) FROM public.checkout_attempts x WHERE x.user_id = p_user_id),
    'pointRefunds', (SELECT count(*) FROM public.refund_requests x WHERE x.user_id = p_user_id),
    'checkoutAcks', (SELECT count(*) FROM public.point_charge_checkout_acks x WHERE x.user_id = p_user_id));

  RETURN v_facts || jsonb_build_object(
    'selfAllowedIfTicketsDeleted', v_without -> 'selfAllowed',
    'selfReasonsIfTicketsDeleted', v_without -> 'selfReasons',
    'fullDeleteIfTicketsDeleted', v_without -> 'fullDeleteAllowed',
    'openRequest', v_request,
    'counts', v_counts);
END;
$fn_get_member_withdrawal_preview$;

-- 7-2. 고지 원문 만들기(스스로 탈퇴 화면·결제 회원 요청 화면·대표의 [고지 원문 만들기]). 지금 값으로 만든다.
CREATE OR REPLACE FUNCTION public.get_member_withdrawal_notice(p_user_id uuid, p_kind text, p_ticket_retention_agreed boolean DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_get_member_withdrawal_notice$
DECLARE
  v_facts jsonb;
  v_text text;
BEGIN
  IF p_user_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('self', 'request') THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  v_facts := public.member_withdrawal_facts(p_user_id, COALESCE(p_ticket_retention_agreed, true));
  IF NOT COALESCE((v_facts ->> 'exists')::boolean, false) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_USER_NOT_FOUND';
  END IF;
  v_text := public.member_withdrawal_notice_text(p_kind, v_facts,
              CASE WHEN (v_facts ->> 'hadPayment')::boolean THEN NULL ELSE p_ticket_retention_agreed END);
  IF v_text IS NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_POLICY_UNAVAILABLE';
  END IF;
  RETURN jsonb_build_object(
    'kind', p_kind,
    'text', v_text,
    'sha256', encode(sha256(convert_to(v_text, 'UTF8')), 'hex'),
    'expectedBalance', (v_facts -> 'balance' ->> 'forfeitTotal')::integer,
    'expectedForfeitPaid', (v_facts -> 'balance' ->> 'forfeitPaid')::integer,
    'expectedForfeitFree', (v_facts -> 'balance' ->> 'forfeitFree')::integer,
    'paidCashValue', (v_facts -> 'balance' ->> 'paidCashValue')::integer,
    'hadPayment', (v_facts ->> 'hadPayment')::boolean);
END;
$fn_get_member_withdrawal_notice$;

-- 7-3. 탈퇴 요청 만들기. screen = 결제 회원 본인 화면(회원 세션 API), email·phone = 대표 기록(회원 종류 상관없음).
--      facts 를 다시 확인하고, 고지 원문은 서버가 다시 만들어 지문을 대조한다. 마케팅 동의 중이면 바로 철회 1건(source withdrawal).
CREATE OR REPLACE FUNCTION public.create_member_withdrawal_request(p_user_id uuid, p_channel text, p_notice_text text, p_notice_sha256 text,
  p_expected_balance integer, p_expected_forfeit_paid integer, p_expected_forfeit_free integer, p_identity_note text, p_recorded_by uuid,
  p_ticket_retention_agreed boolean DEFAULT NULL, p_requester_kind text DEFAULT 'self', p_received_at timestamp with time zone DEFAULT NULL,
  p_notice_sent_at timestamp with time zone DEFAULT NULL, p_consent_reply_received_at timestamp with time zone DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_create_member_withdrawal_request$
DECLARE
  v_policy jsonb := public.member_withdrawal_policy();
  v_profile public.profiles%ROWTYPE;
  v_facts jsonb;
  v_payer boolean;
  v_retention boolean;
  v_text text;
  v_sha text;
  v_item public.signup_consent_items%ROWTYPE;
  v_marketing_at timestamptz;
  v_id uuid;
  v_note text := NULLIF(btrim(p_identity_note), '');
BEGIN
  IF p_user_id IS NULL OR p_channel IS NULL OR p_channel NOT IN ('screen', 'email', 'phone') OR p_recorded_by IS NULL
     OR p_notice_sha256 IS NULL OR p_notice_sha256 !~ '^[0-9a-f]{64}$'
     OR p_expected_balance IS NULL OR p_expected_forfeit_paid IS NULL OR p_expected_forfeit_free IS NULL
     OR p_expected_balance < 0 OR p_expected_forfeit_paid < 0 OR p_expected_forfeit_free < 0
     OR p_expected_balance <> p_expected_forfeit_paid + p_expected_forfeit_free
     OR p_requester_kind IS NULL OR p_requester_kind NOT IN ('self', 'legal_guardian', 'agent')
     OR (v_note IS NOT NULL AND length(v_note) > 500)
     OR (p_notice_sent_at IS NOT NULL AND p_notice_sent_at > clock_timestamp())
     OR (p_consent_reply_received_at IS NOT NULL AND (p_consent_reply_received_at > clock_timestamp()
                                                      OR p_notice_sent_at IS NULL OR p_consent_reply_received_at < p_notice_sent_at))
     OR (p_received_at IS NOT NULL AND p_received_at > clock_timestamp())
     OR (p_channel = 'screen' AND (p_recorded_by <> p_user_id OR p_requester_kind <> 'self' OR v_note IS NOT NULL
                                  OR p_received_at IS NOT NULL OR p_notice_sent_at IS NOT NULL OR p_consent_reply_received_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  IF p_channel = 'screen' THEN
    IF (v_policy -> 'selfAnonymizeEnabled') IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION 'MEMBER_WITHDRAW_SELF_NOT_ALLOWED' USING DETAIL = '{"reason":"DISABLED"}';
    END IF;
  ELSE
    PERFORM public.member_withdrawal_require_owner(p_recorded_by);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('public.user_consents:' || p_user_id::text, 0));
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('public.signup_consent_items:write', 0));
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_USER_NOT_FOUND';
  END IF;
  IF v_profile.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_ALREADY_WITHDRAWN';
  END IF;
  IF v_profile.is_admin IS TRUE THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_ADMIN';
  END IF;

  v_facts := public.member_withdrawal_facts(p_user_id, true);
  v_payer := (v_facts ->> 'hadPayment')::boolean;
  IF p_channel = 'screen' AND NOT v_payer THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_REQUEST_INVALID' USING DETAIL = '{"reason":"NOT_PAYER"}';
  END IF;
  IF p_channel = 'screen' AND COALESCE((v_facts -> 'balance' ->> 'paidCashValueUnknown')::boolean, false) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_REQUEST_INVALID' USING DETAIL = '{"reason":"CASH_VALUE_UNKNOWN"}';
  END IF;
  IF v_facts ->> 'openRequestId' IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_REQUEST_EXISTS' USING DETAIL = jsonb_build_object('requestId', v_facts ->> 'openRequestId')::text;
  END IF;
  IF (v_facts ->> 'inProgressTotal')::integer > 0 THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_IN_PROGRESS' USING DETAIL = (v_facts -> 'inProgress')::text;
  END IF;
  IF jsonb_array_length(v_facts -> 'refundPeriodOpen') > 0 THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_REFUND_PERIOD_OPEN' USING DETAIL = (v_facts -> 'refundPeriodOpen')::text;
  END IF;
  IF (v_facts -> 'balance' ->> 'forfeitTotal')::integer <> p_expected_balance
     OR (v_facts -> 'balance' ->> 'forfeitPaid')::integer <> p_expected_forfeit_paid
     OR (v_facts -> 'balance' ->> 'forfeitFree')::integer <> p_expected_forfeit_free THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_BALANCE_CHANGED' USING DETAIL = jsonb_build_object(
      'forfeitTotal', v_facts -> 'balance' -> 'forfeitTotal', 'forfeitPaid', v_facts -> 'balance' -> 'forfeitPaid',
      'forfeitFree', v_facts -> 'balance' -> 'forfeitFree')::text;
  END IF;

  -- 결제 회원은 문의를 늘 보존(선택 없음). 비결제 회원(email·phone)은 회신으로 받은 선택만 남긴다.
  v_retention := CASE WHEN v_payer THEN NULL ELSE p_ticket_retention_agreed END;
  v_text := public.member_withdrawal_notice_text('request', v_facts, v_retention);
  IF v_text IS NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_POLICY_UNAVAILABLE';
  END IF;
  v_sha := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');
  IF v_sha <> p_notice_sha256 OR (p_notice_text IS NOT NULL AND p_notice_text <> v_text) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_NOTICE_INVALID';
  END IF;

  IF (v_facts ->> 'marketingAgreed')::boolean THEN
    SELECT * INTO v_item FROM public.signup_consent_items i WHERE i.key = (v_policy ->> 'marketingConsentItemKey');
    PERFORM public.consent_record_internal(p_user_id,
      jsonb_build_array(jsonb_build_object('item_id', v_item.id, 'version', v_item.version, 'agreed', false)), 'withdrawal');
    v_marketing_at := now();
  END IF;

  INSERT INTO public.member_withdrawal_requests (
    user_id, channel, requester_kind, received_at, notice_text, notice_sha256, notice_sent_at, consent_reply_received_at,
    ticket_retention_agreed, expected_balance, expected_forfeit_paid, expected_forfeit_free, marketing_withdrawn_at,
    identity_note, recorded_by
  ) VALUES (
    p_user_id, p_channel, p_requester_kind, COALESCE(p_received_at, clock_timestamp()), v_text, v_sha, p_notice_sent_at,
    p_consent_reply_received_at, v_retention, p_expected_balance, p_expected_forfeit_paid, p_expected_forfeit_free,
    v_marketing_at, v_note, p_recorded_by
  )
  RETURNING id INTO v_id;

  IF p_channel <> 'screen' THEN
    PERFORM public.record_admin_audit(p_recorded_by, 'member_withdraw_request', 'member_withdrawal_request', v_id::text, p_user_id,
      p_expected_balance, NULL, jsonb_build_object('channel', p_channel, 'requester_kind', p_requester_kind,
        'expected_forfeit_paid', p_expected_forfeit_paid, 'marketing_withdrawn', v_marketing_at IS NOT NULL), NULL);
  END IF;

  RETURN jsonb_build_object(
    'requestId', v_id,
    'status', 'pending',
    'noticeSha256', v_sha,
    'marketing', CASE WHEN v_marketing_at IS NULL THEN NULL ELSE jsonb_build_object(
      'sender', (SELECT s.value ->> 'name' FROM public.system_settings s WHERE s.key = 'site_brand'),
      'withdrawnAt', v_marketing_at,
      'result', public.member_withdrawal_policy() -> 'texts' ->> 'marketingResult') END);
END;
$fn_create_member_withdrawal_request$;

-- 7-4. email·phone 요청의 고지 발송·동의 회신·문의 보존 선택 기록(대표, pending 동안 비어 있는 칸만 채움)
CREATE OR REPLACE FUNCTION public.record_member_withdrawal_request_reply(p_actor_id uuid, p_request_id uuid,
  p_notice_sent_at timestamp with time zone, p_consent_reply_received_at timestamp with time zone, p_ticket_retention_agreed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_record_member_withdrawal_request_reply$
DECLARE
  v_request public.member_withdrawal_requests%ROWTYPE;
  v_sent timestamptz;
  v_reply timestamptz;
  v_retention boolean;
  v_payer boolean;
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  SELECT * INTO v_request FROM public.member_withdrawal_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'pending' OR v_request.channel NOT IN ('email', 'phone') THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_REQUEST_INVALID';
  END IF;
  v_payer := (public.member_withdrawal_facts(v_request.user_id, true) ->> 'hadPayment')::boolean;
  v_sent := COALESCE(v_request.notice_sent_at, p_notice_sent_at);
  v_reply := COALESCE(v_request.consent_reply_received_at, p_consent_reply_received_at);
  v_retention := CASE WHEN v_payer THEN NULL ELSE COALESCE(v_request.ticket_retention_agreed, p_ticket_retention_agreed) END;
  IF (v_request.notice_sent_at IS NOT NULL AND p_notice_sent_at IS NOT NULL AND p_notice_sent_at <> v_request.notice_sent_at)
     OR (v_request.consent_reply_received_at IS NOT NULL AND p_consent_reply_received_at IS NOT NULL
         AND p_consent_reply_received_at <> v_request.consent_reply_received_at)
     OR (v_request.ticket_retention_agreed IS NOT NULL AND p_ticket_retention_agreed IS NOT NULL
         AND p_ticket_retention_agreed <> v_request.ticket_retention_agreed)
     OR (v_sent IS NOT NULL AND v_sent > clock_timestamp())
     OR (v_reply IS NOT NULL AND (v_sent IS NULL OR v_reply < v_sent OR v_reply > clock_timestamp())) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;

  UPDATE public.member_withdrawal_requests
     SET notice_sent_at = v_sent,
         consent_reply_received_at = v_reply,
         ticket_retention_agreed = v_retention
   WHERE id = v_request.id;

  PERFORM public.record_admin_audit(p_actor_id, 'member_withdraw_request_reply', 'member_withdrawal_request', v_request.id::text,
    v_request.user_id, NULL, NULL, jsonb_build_object('notice_sent_at', v_sent, 'consent_reply_received_at', v_reply,
      'ticket_retention_agreed', v_retention), NULL);

  RETURN jsonb_build_object('requestId', v_request.id, 'noticeSentAt', v_sent, 'consentReplyReceivedAt', v_reply,
                            'ticketRetentionAgreed', v_retention);
END;
$fn_record_member_withdrawal_request_reply$;

-- 7-5. 요청 취소(회원 화면·대표). 요청 때 남긴 마케팅 철회는 되돌리지 않는다.
CREATE OR REPLACE FUNCTION public.cancel_member_withdrawal_request(p_user_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_cancel_member_withdrawal_request$
DECLARE
  v_request public.member_withdrawal_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM public.member_withdrawal_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.user_id IS DISTINCT FROM p_user_id OR v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_REQUEST_INVALID';
  END IF;
  UPDATE public.member_withdrawal_requests SET status = 'canceled' WHERE id = v_request.id;
  RETURN jsonb_build_object('requestId', v_request.id, 'status', 'canceled', 'marketingWithdrawnAt', v_request.marketing_withdrawn_at);
END;
$fn_cancel_member_withdrawal_request$;

-- 7-6. 익명화(계획 5-2). 한 거래 안에서 처리한다. 40P01·40001(MEMBER_WITHDRAW_STATE_CHANGED)은 서버가 같은 키로 2회까지 다시 시도한다.
--      p_method 'self'(비결제·결제 시도만 회원 본인, p_actor_id = p_user_id) | 'owner'(대표, 요청 필수).
CREATE OR REPLACE FUNCTION public.anonymize_member(p_actor_id uuid, p_user_id uuid, p_method text, p_request_id uuid,
  p_expected_balance integer, p_notice_text text, p_provider_unverified_confirmed boolean, p_reason text, p_operation_key text,
  p_ticket_retention_agreed boolean DEFAULT NULL, p_pending_tickets_confirmed boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_anonymize_member$
DECLARE
  v_policy jsonb := public.member_withdrawal_policy();
  v_texts jsonb := public.member_withdrawal_policy() -> 'texts';
  v_now timestamptz := now();
  v_profile public.profiles%ROWTYPE;
  v_existing public.withdrawn_member_records%ROWTYPE;
  v_request public.member_withdrawal_requests%ROWTYPE;
  v_pre jsonb;
  v_facts jsonb;
  v_pre_payer boolean;
  v_payer boolean;
  v_retention boolean;
  v_retain_tickets boolean;
  v_agreed_total integer;
  v_agreed_paid integer;
  v_agreed_free integer;
  v_total integer;
  v_paid integer;
  v_free integer;
  v_expired integer;
  v_notice text;
  v_notice_sha text;
  v_src record;
  v_last_at timestamptz;
  v_at timestamptz;
  v_forfeit_rows integer := 0;
  v_latest_balance integer;
  v_item public.signup_consent_items%ROWTYPE;
  v_marketing_at timestamptz;
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
  v_closed_tickets integer := 0;
  v_result jsonb;
  v_kakao text;
  v_reason text := NULLIF(btrim(p_reason), '');
  v_forfeit_desc text := NULLIF(btrim(public.member_withdrawal_policy() -> 'texts' ->> 'forfeitDescription'), '');
  v_cleanup_desc text := NULLIF(btrim(public.member_withdrawal_policy() -> 'texts' ->> 'cleanupDescription'), '');
  v_marketing_result text := NULLIF(btrim(public.member_withdrawal_policy() -> 'texts' ->> 'marketingResult'), '');
  v_new_sources jsonb;
BEGIN
  -- 0. 입력
  IF p_user_id IS NULL OR p_actor_id IS NULL OR p_method IS NULL OR p_method NOT IN ('self', 'owner')
     OR NULLIF(btrim(p_operation_key), '') IS NULL OR length(p_operation_key) > 200
     OR (v_reason IS NOT NULL AND length(v_reason) > 500)
     OR (p_method = 'self' AND (p_actor_id <> p_user_id OR p_request_id IS NOT NULL OR p_expected_balance IS NULL
                                OR p_expected_balance < 0 OR p_notice_text IS NULL OR p_ticket_retention_agreed IS NULL)) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  IF v_forfeit_desc IS NULL OR v_cleanup_desc IS NULL OR v_marketing_result IS NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_POLICY_UNAVAILABLE';
  END IF;

  -- 1. 잠금: 동의 advisory 두 개
  PERFORM pg_advisory_xact_lock(hashtextextended('public.user_consents:' || p_user_id::text, 0));
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('public.signup_consent_items:write', 0));

  -- 2. 재요청(같은 키는 저장한 결과, 다른 키는 거절)
  SELECT * INTO v_existing FROM public.withdrawn_member_records WHERE user_id = p_user_id;
  IF FOUND THEN
    IF v_existing.operation_key = p_operation_key THEN
      RETURN v_existing.result || jsonb_build_object('replay', true);
    END IF;
    RAISE EXCEPTION 'MEMBER_ALREADY_WITHDRAWN';
  END IF;
  IF EXISTS (SELECT 1 FROM public.withdrawn_member_records r WHERE r.operation_key = p_operation_key) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;

  -- 3. 잠금 전 임시 판정으로 경로를 고른다. 비결제·결제 시도만 경로는 주문·결제 시도를 id 순으로 먼저 잠근다(fulfill·begin 과 같은 순서).
  v_pre := public.member_withdrawal_facts(p_user_id, true);
  IF NOT COALESCE((v_pre ->> 'exists')::boolean, false) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_USER_NOT_FOUND';
  END IF;
  v_pre_payer := (v_pre ->> 'hadPayment')::boolean;
  IF NOT v_pre_payer THEN
    PERFORM 1 FROM public.payment_orders o WHERE o.user_id = p_user_id ORDER BY o.id FOR UPDATE;
    PERFORM 1 FROM public.checkout_attempts a WHERE a.user_id = p_user_id ORDER BY a.id FOR UPDATE;
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF v_profile.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_ALREADY_WITHDRAWN';
  END IF;
  PERFORM 1 FROM public.credit_sources s WHERE s.user_id = p_user_id ORDER BY s.id FOR UPDATE;
  IF p_method = 'owner' AND p_request_id IS NOT NULL THEN
    SELECT * INTO v_request FROM public.member_withdrawal_requests WHERE id = p_request_id FOR UPDATE;
  ELSIF p_method = 'self' THEN
    -- 대표가 기록한 열린 요청(email·phone)이 있으면 이 익명화로 함께 닫는다(요청 때 철회한 마케팅 시각도 결과에 쓴다).
    SELECT * INTO v_request FROM public.member_withdrawal_requests WHERE user_id = p_user_id AND status = 'pending' FOR UPDATE;
  END IF;

  -- 4. 잠금 뒤 판정
  v_facts := public.member_withdrawal_facts(p_user_id, true);
  v_payer := (v_facts ->> 'hadPayment')::boolean;
  IF v_payer AND NOT v_pre_payer THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'MEMBER_WITHDRAW_STATE_CHANGED';
  END IF;
  IF p_method = 'self' THEN
    v_retention := p_ticket_retention_agreed;
  ELSIF v_payer THEN
    v_retention := NULL;
  ELSE
    -- email·phone 경로: 회신이 없으면 '동의 안 함(삭제)'
    v_retention := COALESCE(v_request.ticket_retention_agreed, false);
  END IF;
  v_retain_tickets := v_payer OR v_retention IS TRUE;
  IF NOT v_retain_tickets THEN
    v_facts := public.member_withdrawal_facts(p_user_id, false);
  END IF;

  -- 5. 거절(계획 3절 정의)
  IF v_profile.is_admin IS TRUE THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_ADMIN';
  END IF;
  IF p_method = 'owner' THEN
    PERFORM public.member_withdrawal_require_owner(p_actor_id);
    IF p_actor_id = p_user_id THEN
      RAISE EXCEPTION 'MEMBER_WITHDRAW_ACTOR_NOT_OWNER';
    END IF;
  ELSE
    IF (v_policy -> 'selfAnonymizeEnabled') IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION 'MEMBER_WITHDRAW_SELF_NOT_ALLOWED' USING DETAIL = '{"reason":"DISABLED"}';
    END IF;
    IF v_payer THEN
      RAISE EXCEPTION 'MEMBER_WITHDRAW_SELF_NOT_ALLOWED' USING DETAIL = '{"reason":"PAYER"}';
    END IF;
    IF v_facts -> 'selfReasons' ? 'RECENT_PAYMENT_ACTIVITY' THEN
      RAISE EXCEPTION 'MEMBER_WITHDRAW_SELF_NOT_ALLOWED'
        USING DETAIL = jsonb_build_object('reason', 'RECENT_PAYMENT_ACTIVITY', 'quietUntil', v_facts -> 'quietUntil')::text;
    END IF;
  END IF;
  IF (v_facts ->> 'inProgressTotal')::integer > 0 THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_IN_PROGRESS' USING DETAIL = (v_facts -> 'inProgress')::text;
  END IF;
  IF jsonb_array_length(v_facts -> 'refundPeriodOpen') > 0 THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_REFUND_PERIOD_OPEN' USING DETAIL = (v_facts -> 'refundPeriodOpen')::text;
  END IF;
  IF jsonb_array_length(v_facts -> 'providerUnverified') > 0
     AND (p_method = 'self' OR p_provider_unverified_confirmed IS NOT TRUE) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_PROVIDER_UNVERIFIED' USING DETAIL = (v_facts -> 'providerUnverified')::text;
  END IF;
  IF jsonb_array_length(v_facts -> 'redactionRequired') > 0 THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_REDACTION_REQUIRED' USING DETAIL = (v_facts -> 'redactionRequired')::text;
  END IF;

  v_total := (v_facts -> 'balance' ->> 'forfeitTotal')::integer;
  v_paid := (v_facts -> 'balance' ->> 'forfeitPaid')::integer;
  v_free := (v_facts -> 'balance' ->> 'forfeitFree')::integer;
  v_expired := (v_facts -> 'balance' ->> 'expired')::integer;

  IF p_method = 'owner' THEN
    IF v_request.id IS NULL OR v_request.user_id <> p_user_id OR v_request.status <> 'pending'
       OR (NOT v_payer AND v_request.channel NOT IN ('email', 'phone'))
       OR (v_request.channel IN ('email', 'phone') AND (v_paid > 0 OR v_request.expected_forfeit_paid > 0)
           AND (v_request.notice_sent_at IS NULL OR v_request.consent_reply_received_at IS NULL))
       OR (NOT v_payer AND p_ticket_retention_agreed IS NOT NULL AND p_ticket_retention_agreed IS DISTINCT FROM v_retention)
       OR (p_expected_balance IS NOT NULL AND p_expected_balance <> v_request.expected_balance) THEN
      RAISE EXCEPTION 'MEMBER_WITHDRAW_REQUEST_INVALID';
    END IF;
    IF (v_facts ->> 'pendingTicketCount')::integer > 0 AND p_pending_tickets_confirmed IS NOT TRUE THEN
      RAISE EXCEPTION 'MEMBER_WITHDRAW_PENDING_TICKETS_UNCONFIRMED'
        USING DETAIL = jsonb_build_object('pendingTicketCount', v_facts -> 'pendingTicketCount')::text;
    END IF;
    -- 요청을 받은 뒤 새로 생긴 크레딧(유료는 뿌리 원천 credit_source_paid_root, 무상은 그 원천의 생성 시각이 요청보다 늦음)이
    -- 지금 소멸 대상이면 거절한다. 고지에 없던 원천이라 옛 동의로 소멸시키지 않는다(합계가 동의 값 이하여도, 대표가 지급한 무상 포함).
    -- 요청을 취소하고 회원에게 다시 요청받는다.
    SELECT COALESCE(jsonb_agg(b.e -> 'source_id' ORDER BY b.e ->> 'source_id'), '[]'::jsonb) INTO v_new_sources
      FROM jsonb_array_elements(v_facts -> 'balance' -> 'breakdown') AS b(e)
      JOIN public.credit_sources c ON c.id = COALESCE(b.e ->> 'paid_root_id', b.e ->> 'source_id')::uuid
     WHERE (b.e ->> 'forfeited')::integer > 0
       AND c.created_at > v_request.created_at;
    IF jsonb_array_length(v_new_sources) > 0 THEN
      RAISE EXCEPTION 'MEMBER_WITHDRAW_NEW_CHARGE' USING DETAIL = jsonb_build_object('sourceIds', v_new_sources)::text;
    END IF;
    v_agreed_total := v_request.expected_balance;
    v_agreed_paid := v_request.expected_forfeit_paid;
    v_agreed_free := v_request.expected_forfeit_free;
  ELSE
    v_agreed_total := p_expected_balance;
    v_agreed_paid := 0;
    v_agreed_free := p_expected_balance;
  END IF;

  -- 동의한 금액보다 크면 거절(같거나 작으면 받고 두 값을 결과에 남긴다)
  IF v_total > v_agreed_total OR v_paid > v_agreed_paid OR v_free > v_agreed_free THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_BALANCE_CHANGED' USING DETAIL = jsonb_build_object(
      'forfeitTotal', v_total, 'forfeitPaid', v_paid, 'forfeitFree', v_free,
      'agreedTotal', v_agreed_total, 'agreedPaid', v_agreed_paid, 'agreedFree', v_agreed_free)::text;
  END IF;

  IF p_method = 'self' THEN
    v_notice := public.member_withdrawal_notice_text('self', v_facts, v_retention);
    IF v_notice IS NULL THEN
      RAISE EXCEPTION 'MEMBER_WITHDRAW_POLICY_UNAVAILABLE';
    END IF;
    IF v_notice IS DISTINCT FROM p_notice_text THEN
      RAISE EXCEPTION 'MEMBER_WITHDRAW_NOTICE_INVALID';
    END IF;
    v_notice_sha := encode(sha256(convert_to(v_notice, 'UTF8')), 'hex');
  ELSE
    v_notice := v_request.notice_text;
    v_notice_sha := v_request.notice_sha256;
  END IF;

  -- 6. 처리(이 거래 안에서만 가드 예외)
  PERFORM set_config('app.member_withdrawal_bypass', p_user_id::text, true);
  -- 6-0. 그 회원 문의·환불의 관리자 이벤트 제목·본문을 먼저 '탈퇴 회원 문의'로 바꾼다(대상 행을 지우기 전에).
  v_n := public.member_withdrawal_scrub_admin_events(p_user_id);
  v_counts := v_counts || jsonb_build_object('adminEventsScrubbed', v_n);

  IF v_payer THEN
    -- 6-1. 소멸: 만료 전 잔량은 withdrawal_forfeit(음수, balance_after 0), 만료 잔량은 거래 없이 0
    SELECT max(t.created_at) INTO v_last_at FROM public.credit_transactions t WHERE t.user_id = p_user_id;
    FOR v_src IN
      SELECT s.id, s.remaining_credits, s.expires_at
        FROM public.credit_sources s
       WHERE s.user_id = p_user_id AND s.remaining_credits > 0
       ORDER BY s.id
    LOOP
      UPDATE public.credit_sources SET remaining_credits = 0 WHERE id = v_src.id;
      IF v_src.expires_at IS NULL OR v_src.expires_at > v_now THEN
        v_at := GREATEST(clock_timestamp(), COALESCE(v_last_at + interval '1 microsecond', '-infinity'::timestamptz));
        INSERT INTO public.credit_transactions (user_id, type, amount, balance_after, description, source_id, resource_type, operation_key, created_at)
        VALUES (p_user_id, 'withdrawal_forfeit', -v_src.remaining_credits, 0, v_forfeit_desc, v_src.id, 'member_withdrawal',
                p_operation_key || ':' || v_src.id, v_at);
        v_last_at := v_at;
        v_forfeit_rows := v_forfeit_rows + 1;
      END IF;
    END LOOP;
    IF v_forfeit_rows = 0 THEN
      SELECT t.balance_after INTO v_latest_balance
        FROM public.credit_transactions t
       WHERE t.user_id = p_user_id
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT 1;
      IF FOUND AND v_latest_balance <> 0 THEN
        v_at := GREATEST(clock_timestamp(), COALESCE(v_last_at + interval '1 microsecond', '-infinity'::timestamptz));
        INSERT INTO public.credit_transactions (user_id, type, amount, balance_after, description, source_id, resource_type, operation_key, created_at)
        VALUES (p_user_id, 'withdrawal_forfeit', 0, 0, v_cleanup_desc, NULL, 'member_withdrawal', p_operation_key || ':cleanup', v_at);
        v_forfeit_rows := v_forfeit_rows + 1;
      END IF;
    END IF;
    v_counts := v_counts || jsonb_build_object('forfeitTransactions', v_forfeit_rows);

    -- 6-2. 동의: 마케팅 최신 기록(판과 상관없이 최신 seq)이 동의면 철회 1건. 요청 단계에서 이미 철회해 지금 철회 상태면 건너뛰고 그 시각을 쓴다.
    IF (v_facts ->> 'marketingAgreed')::boolean THEN
      SELECT * INTO v_item FROM public.signup_consent_items i WHERE i.key = (v_policy ->> 'marketingConsentItemKey');
      PERFORM public.consent_record_internal(p_user_id,
        jsonb_build_array(jsonb_build_object('item_id', v_item.id, 'version', v_item.version, 'agreed', false)), 'withdrawal');
      v_marketing_at := now();
    ELSIF v_request.marketing_withdrawn_at IS NOT NULL THEN
      v_marketing_at := v_request.marketing_withdrawn_at;
    END IF;

    -- 6-3. 다운로드 기록은 행을 남기고 접속 정보만 지운다.
    UPDATE public.market_download_events SET ip_address = NULL, user_agent = NULL
     WHERE user_id = p_user_id AND (ip_address IS NOT NULL OR user_agent IS NOT NULL);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('downloadsScrubbed', v_n);
  ELSE
    -- 6-1'. 비결제·결제 시도만: 자료 구매·크레딧·동의 기록을 지운다(결정 6).
    IF (v_facts ->> 'marketingAgreed')::boolean THEN
      v_marketing_at := now();
    ELSIF v_request.marketing_withdrawn_at IS NOT NULL THEN
      v_marketing_at := v_request.marketing_withdrawn_at;
    END IF;
    DELETE FROM public.market_download_events WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('downloads', v_n);
    DELETE FROM public.market_entitlements WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('entitlements', v_n);
    DELETE FROM public.market_refund_requests WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('marketRefunds', v_n);
    DELETE FROM public.market_purchase_orders WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('marketOrders', v_n);
    DELETE FROM public.market_checkout_batches WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('checkoutBatches', v_n);
    DELETE FROM public.market_purchases WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('marketPurchases', v_n);
    DELETE FROM public.credit_consumption WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('creditConsumption', v_n);
    DELETE FROM public.credit_transactions WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('creditTransactions', v_n);
    DELETE FROM public.credit_sources WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('creditSources', v_n);
    DELETE FROM public.market_purchase_notice_acks WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('purchaseNoticeAcks', v_n);
    DELETE FROM public.user_consents WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('consents', v_n);
    -- 결제 시도·주문의 request_fingerprint 는 되돌릴 수 없는 임의 값으로 바꾼다(주문 쪽은 스냅숏 가드가 그 한 칸만 허용).
    UPDATE public.checkout_attempts
       SET request_fingerprint = encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex'),
           updated_at = now()
     WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('attemptFingerprints', v_n);
    UPDATE public.payment_orders
       SET request_fingerprint = encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex')
     WHERE user_id = p_user_id AND request_fingerprint IS NOT NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('orderFingerprints', v_n);
  END IF;

  -- 6-4. 모든 경로: 후기·추천, 문제·문제지·지문·생성 작업·생성 기록·시험 실행, 알림, 장바구니 삭제, 조회 기록 user_id 비움
  DELETE FROM public.market_item_review_votes WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('reviewVotes', v_n);
  DELETE FROM public.market_item_reviews WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('reviews', v_n);
  DELETE FROM public.exam_papers WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('examPapers', v_n);
  DELETE FROM public.questions WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('questions', v_n);
  DELETE FROM public.passages WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('passages', v_n);
  DELETE FROM public.generate_listboard_generation_jobs WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('generationJobs', v_n);
  DELETE FROM public.ai_question_generation_runs WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('generationRuns', v_n);
  DELETE FROM public.problem_type_test_runs WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('testRuns', v_n);
  DELETE FROM public.notifications WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('notifications', v_n);
  DELETE FROM public.market_cart_items WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('cartItems', v_n);
  UPDATE public.market_item_view_events SET user_id = NULL WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('viewEventsUnlinked', v_n);

  -- 6-5. 문의: 보존하면 대기·처리 중을 닫고(감사 기록에 건수), 아니면 지운다(수정 이력 CASCADE).
  IF v_retain_tickets THEN
    UPDATE public.support_tickets
       SET status = 'closed',
           updated_at = timezone('utc'::text, now())
     WHERE user_id = p_user_id AND status IN ('pending', 'in_progress');
    GET DIAGNOSTICS v_closed_tickets = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object('ticketsClosed', v_closed_tickets,
      'ticketsKept', (SELECT count(*) FROM public.support_tickets t WHERE t.user_id = p_user_id));
  ELSE
    DELETE FROM public.support_tickets WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('ticketsDeleted', v_n);
  END IF;

  -- 6-6. 프로필
  v_kakao := CASE WHEN v_profile.provider = 'kakao' THEN NULLIF(btrim(v_profile.kakao_id), '') END;
  UPDATE public.profiles
     SET email = NULL, phone = NULL, birthdate = NULL, organization = NULL, gender = NULL, address = NULL,
         kakao_id = NULL, kakao_email = NULL, avatar_url = NULL,
         display_tag = public.generate_member_display_tag(),
         withdrawn_at = v_now,
         credits = 0,
         updated_at = timezone('utc'::text, now())
   WHERE id = p_user_id;

  -- 6-7. 로그인 차단(이미 발급된 JWT 는 최대 1시간 — 그 사이 쓰기는 가드 트리거가 막는다)
  UPDATE auth.users SET banned_until = v_now + interval '100 years' WHERE id = p_user_id;
  DELETE FROM auth.sessions WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('sessions', v_n);
  DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
  DELETE FROM auth.flow_state WHERE user_id = p_user_id;
  DELETE FROM auth.one_time_tokens WHERE user_id = p_user_id;

  -- 6-8. 대표 확인 필요 경보(회원 화면에서 막혔던 기록)는 익명화로 처리가 끝났으므로 푼다.
  UPDATE public.payment_reconciliation_alerts
     SET resolved_at = now()
   WHERE resolved_at IS NULL
     AND code = 'MEMBER_WITHDRAW_REVIEW_NEEDED'
     AND (details ->> 'dedupe_key') = 'member_withdraw_review:' || p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('reviewAlertsResolved', v_n);

  -- 6-9. 결과·보관함(결과까지 계산한 뒤 한 번에 INSERT)
  v_result := jsonb_build_object(
    'withdrawn', true,
    'userId', p_user_id,
    'method', p_method,
    'withdrawnAt', v_now,
    'operationKey', p_operation_key,
    'hadPayment', v_payer,
    'forfeited', v_total,
    'forfeitedPaid', v_paid,
    'forfeitedFree', v_free,
    'expiredCleared', v_expired,
    'agreed', jsonb_build_object('balance', v_agreed_total, 'paid', v_agreed_paid, 'free', v_agreed_free),
    'ticketsRetained', v_retain_tickets,
    'counts', v_counts,
    'marketing', CASE WHEN v_marketing_at IS NULL THEN NULL ELSE jsonb_build_object(
      'sender', (SELECT s.value ->> 'name' FROM public.system_settings s WHERE s.key = 'site_brand'),
      'withdrawnAt', v_marketing_at,
      'result', v_marketing_result) END,
    'kakaoUnlinkPending', v_kakao IS NOT NULL,
    'authScrubPending', true);

  INSERT INTO public.withdrawn_member_records (
    user_id, operation_key, withdrawn_at, method, actor_id, request_id, reason, consent_notice_text, consent_notice_sha256,
    email, phone, kakao_email, kakao_id_pending_unlink, had_payment, ticket_retention_agreed,
    forfeited_credits, forfeited_paid_credits, forfeit_breakdown,
    last_payment_event_at, last_market_event_at, last_ticket_event_at, refund_ticket_ids,
    provider_unverified_confirmed, marketing_withdrawn_at, result, policy_snapshot
  ) VALUES (
    p_user_id, p_operation_key, v_now, p_method, p_actor_id, v_request.id, v_reason, v_notice, v_notice_sha,
    CASE WHEN v_payer THEN v_profile.email END, CASE WHEN v_payer THEN v_profile.phone END,
    CASE WHEN v_payer THEN v_profile.kakao_email END, v_kakao, v_payer, v_retention,
    v_total, v_paid, COALESCE(v_facts -> 'balance' -> 'breakdown', '[]'::jsonb),
    (v_facts ->> 'lastPaymentEventAt')::timestamptz, (v_facts ->> 'lastMarketEventAt')::timestamptz,
    GREATEST((v_facts ->> 'lastTicketEventAt')::timestamptz, CASE WHEN v_closed_tickets > 0 THEN v_now END),
    CASE WHEN v_retain_tickets THEN ARRAY(SELECT jsonb_array_elements_text(v_facts -> 'refundTicketIds')::uuid) ELSE '{}'::uuid[] END,
    COALESCE(p_provider_unverified_confirmed, false) AND jsonb_array_length(v_facts -> 'providerUnverified') > 0,
    v_marketing_at, v_result, v_policy - 'texts'
  );

  -- 6-10. 로그인 계정 정리(서버의 auth 소프트 삭제) 경보는 이 거래에서 넣지 않는다(정상 경로마다 관리자 알림·슬랙이 나가지 않게).
  --       서버가 정리에 실패하면 서버가, 정리 전에 멈추면 remind_unanswered_admin_work 가 10분 뒤 MEMBER_AUTH_SCRUB_PENDING 을 남기고,
  --       mark_withdrawn_member_auth_scrubbed 가 푼다. 회원 상세의 [다시 시도] 표시는 보관함 auth_scrubbed_at 으로 판단한다.

  -- 6-11. 요청(대표 경로의 요청, 스스로 익명화 때 열려 있던 요청)을 닫는다.
  IF v_request.id IS NOT NULL THEN
    UPDATE public.member_withdrawal_requests SET status = 'completed' WHERE id = v_request.id;
  END IF;
  IF p_method = 'owner' THEN
    PERFORM public.record_admin_audit(p_actor_id, 'member_withdraw', 'profile', p_user_id::text, p_user_id, v_total, v_reason,
      jsonb_build_object('method', p_method, 'request_id', v_request.id, 'channel', v_request.channel,
                         'forfeited_paid', v_paid, 'forfeited_free', v_free, 'expired_cleared', v_expired,
                         'agreed_balance', v_agreed_total, 'counts', v_counts,
                         'provider_unverified_confirmed', COALESCE(p_provider_unverified_confirmed, false),
                         'pending_tickets_confirmed', COALESCE(p_pending_tickets_confirmed, false),
                         'tickets_retained', v_retain_tickets),
      p_operation_key);
  END IF;

  RETURN v_result;
END;
$fn_anonymize_member$;

-- 7-7. 문의·환불 기록 가림(대표). p_target_text 와 정확히 같은 부분을 모두 가림 문구로 바꾸고 확인 시각을 남긴다.
--      같은 대상의 관리자 이벤트 제목·본문(알림 포기 사본 포함)에 그 문구가 있으면 함께 가린다. 감사 기록에는 글자 수만.
CREATE OR REPLACE FUNCTION public.redact_member_text(p_actor_id uuid, p_target_kind text, p_target_id uuid, p_field text,
  p_target_text text, p_operation_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_redact_member_text$
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
$fn_redact_member_text$;

-- 7-8. 가릴 것이 없다고 확인(대표, 감사 기록)
CREATE OR REPLACE FUNCTION public.mark_member_text_reviewed(p_actor_id uuid, p_target_kind text, p_target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_mark_member_text_reviewed$
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
$fn_mark_member_text_reviewed$;

-- 7-9. 탈퇴 회원 보류 주문 닫기(대표). 받는 상태:
--   (가) manual_review·PAYMENT_FOR_WITHDRAWN_MEMBER → bank_transfer
--   (나) failed 이고 취소 통보가 기록·처리됨 → payapp_cancel_request·provider_admin_cancel(통보 전이면 거절)
--   (다) 부분취소 뒤 manual_review·PAYAPP_PARTIAL_CANCEL → bank_transfer(남은 금액 송금). 전액 취소로 닫으려면 통보 뒤 (나).
--   (라) 취소 처리 실패 대체 경로의 manual_review·PAYAPP_CANCEL_HANDLING_FAILED: 승인취소가 처리됐으면(cancel_processed_at) (나)의 방법,
--        부분취소만 처리됐으면 (다)의 방법.
--   이미 닫은 주문은 늘 replay(다시 닫지 않음 — 돈을 다시 보내는 길을 만들지 않는다). 닫은 주문에 온 취소는
--   process_payapp_cancellation 이 주문을 다시 열지 않고(failed 유지) 경보만 남긴다(송금으로 닫았으면 이중 환불 의심).
CREATE OR REPLACE FUNCTION public.close_withdrawn_member_held_order(p_actor_id uuid, p_order_id uuid, p_method text, p_note text, p_operation_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_close_withdrawn_member_held_order$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_alerts integer;
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  IF p_order_id IS NULL OR p_method IS NULL OR p_method NOT IN ('payapp_cancel_request', 'provider_admin_cancel', 'bank_transfer')
     OR NULLIF(btrim(p_note), '') IS NULL OR length(p_note) > 1000
     OR NULLIF(btrim(p_operation_key), '') IS NULL OR length(p_operation_key) > 200 THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;

  SELECT * INTO v_order FROM public.payment_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND';
  END IF;
  SELECT * INTO v_ppt FROM public.payment_provider_transactions WHERE payment_order_id = v_order.id FOR UPDATE;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_order.user_id AND p.withdrawn_at IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM public.withdrawn_member_record_events e
                     WHERE e.user_id = v_order.user_id AND e.kind = 'late_payment' AND e.ref_id = v_order.id) THEN
    RAISE EXCEPTION 'MEMBER_HELD_ORDER_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.withdrawn_member_record_events e
              WHERE e.user_id = v_order.user_id AND e.kind = 'held_order_closed' AND e.ref_id = v_order.id) THEN
    RETURN jsonb_build_object('closed', true, 'replay', true, 'status', v_order.status);
  END IF;

  IF p_method = 'bank_transfer' THEN
    -- 부분취소 표식이 기록됐지만 아직 처리되지 않았으면(처리 일시 오류로 대사가 다시 집기 전) 처리된 뒤에 닫는다(송금과 겹친 이중 환불 방지).
    IF v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL AND v_ppt.partial_cancel_processed_at IS NULL THEN
      RAISE EXCEPTION 'MEMBER_HELD_ORDER_CANCEL_PENDING';
    END IF;
    IF NOT (v_order.status = 'manual_review'
            AND v_order.failure_code IN ('PAYMENT_FOR_WITHDRAWN_MEMBER', 'PAYAPP_PARTIAL_CANCEL', 'PAYAPP_CANCEL_HANDLING_FAILED')
            AND v_ppt.cancel_feedback_recorded_at IS NULL) THEN
      RAISE EXCEPTION 'MEMBER_HELD_ORDER_STATE_INVALID';
    END IF;
    IF v_order.failure_code IN ('PAYAPP_PARTIAL_CANCEL', 'PAYAPP_CANCEL_HANDLING_FAILED')
       AND (v_ppt.partial_cancel_feedback_recorded_at IS NULL OR v_ppt.partial_cancel_processed_at IS NULL) THEN
      RAISE EXCEPTION 'MEMBER_HELD_ORDER_STATE_INVALID';
    END IF;
  ELSE
    IF v_ppt.cancel_feedback_recorded_at IS NULL OR v_ppt.cancel_processed_at IS NULL THEN
      RAISE EXCEPTION 'MEMBER_HELD_ORDER_CANCEL_PENDING';
    END IF;
    IF NOT (v_order.status = 'failed'
            OR (v_order.status = 'manual_review' AND v_order.failure_code = 'PAYAPP_CANCEL_HANDLING_FAILED')) THEN
      RAISE EXCEPTION 'MEMBER_HELD_ORDER_STATE_INVALID';
    END IF;
  END IF;

  UPDATE public.payment_orders
     SET status = 'failed',
         canceled_at = COALESCE(canceled_at, now()),
         next_reconcile_at = NULL,
         updated_at = now()
   WHERE id = v_order.id;
  UPDATE public.checkout_attempts
     SET status = 'cancelled',
         updated_at = now()
   WHERE id = v_order.checkout_attempt_id
     AND status NOT IN ('completed', 'cancelled');

  INSERT INTO public.payment_admin_actions (actor_id, action, payment_order_id, before_state, after_state, note, external_method, details)
  VALUES (p_actor_id, 'withdrawn_held_order_closed', v_order.id,
          jsonb_build_object('order_status', v_order.status, 'failure_code', v_order.failure_code),
          jsonb_build_object('order_status', 'failed'),
          p_note, p_method,
          jsonb_build_object('operation_key', p_operation_key, 'mul_no', v_ppt.provider_transaction_id,
                             'partial_cancel_amount', v_ppt.partial_cancel_amount));

  INSERT INTO public.withdrawn_member_record_events (user_id, kind, ref_id, details, actor_id)
  VALUES (v_order.user_id, 'held_order_closed', v_order.id,
          jsonb_build_object('method', p_method, 'operation_key', p_operation_key, 'before_status', v_order.status,
                             'failure_code', v_order.failure_code), p_actor_id)
  ON CONFLICT (user_id, kind, ref_id) WHERE ref_id IS NOT NULL AND kind <> 'market_cash_refund' DO NOTHING;

  -- 보류 경보와, 닫기 전 대체 경로가 남긴 취소 처리 실패 경보(이 주문)를 함께 푼다.
  UPDATE public.payment_reconciliation_alerts
     SET resolved_at = now()
   WHERE resolved_at IS NULL
     AND ((details ->> 'order_payment_order_id') = v_order.id::text
          OR (details ->> 'dedupe_key') = 'withdrawn_member_payment:' || v_order.id
          OR (code = 'PAYAPP_CANCEL_HANDLING_FAILED' AND (details ->> 'payment_order_id') = v_order.id::text));
  GET DIAGNOSTICS v_alerts = ROW_COUNT;

  PERFORM public.record_admin_audit(p_actor_id, 'withdrawn_held_order_close', 'payment_order', v_order.id::text, v_order.user_id,
    v_order.expected_amount, p_note, jsonb_build_object('method', p_method, 'before_status', v_order.status,
      'failure_code', v_order.failure_code, 'alerts_resolved', v_alerts), p_operation_key);

  RETURN jsonb_build_object('closed', true, 'status', 'failed', 'method', p_method, 'alertsResolved', v_alerts);
END;
$fn_close_withdrawn_member_held_order$;

-- 7-10. 보관함 추가 기록(대표): 탈퇴 회원 자료 법정 환불의 현금 정산(market_cash_refund), 안내 메일 발송 등 메모(note).
--       현금 정산은 ref_id = 그 회원의 자료 주문 id, details.settlementKey = 정산마다 새 값(같은 주문에 여러 번 정산 가능, 같은 키는 한 번만).
CREATE OR REPLACE FUNCTION public.add_withdrawn_member_event(p_actor_id uuid, p_user_id uuid, p_kind text, p_ref_id uuid, p_details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_add_withdrawn_member_event$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  IF p_user_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('market_cash_refund', 'note')
     OR (p_details IS NOT NULL AND jsonb_typeof(p_details) <> 'object')
     OR (p_kind = 'market_cash_refund' AND (p_ref_id IS NULL
                                             OR jsonb_typeof(p_details -> 'settlementKey') IS DISTINCT FROM 'string'
                                             OR NULLIF(btrim(p_details ->> 'settlementKey'), '') IS NULL
                                             OR length(p_details ->> 'settlementKey') > 200)) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.withdrawn_member_records r WHERE r.user_id = p_user_id) THEN
    RAISE EXCEPTION 'MEMBER_NOT_WITHDRAWN';
  END IF;
  IF p_kind = 'market_cash_refund'
     AND NOT EXISTS (SELECT 1 FROM public.market_purchase_orders o WHERE o.id = p_ref_id AND o.user_id = p_user_id) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  -- 두 부분 UNIQUE(종류별 / 현금 정산 키) 중 걸리는 쪽에서 조용히 건너뛴다(recorded = false).
  INSERT INTO public.withdrawn_member_record_events (user_id, kind, ref_id, details, actor_id)
  VALUES (p_user_id, p_kind, p_ref_id, COALESCE(p_details, '{}'::jsonb), p_actor_id)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    PERFORM public.record_admin_audit(p_actor_id, 'withdrawn_member_event', 'withdrawn_member_record', p_user_id::text, p_user_id,
      NULL, NULL, jsonb_build_object('kind', p_kind, 'ref_id', p_ref_id, 'event_id', v_id), NULL);
  END IF;
  RETURN jsonb_build_object('recorded', v_id IS NOT NULL, 'eventId', v_id);
END;
$fn_add_withdrawn_member_event$;

-- 7-11. 로그인 계정 정리 완료(서버가 auth.admin.deleteUser(id, true) 성공 뒤 부른다)
CREATE OR REPLACE FUNCTION public.mark_withdrawn_member_auth_scrubbed(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_mark_withdrawn_member_auth_scrubbed$
DECLARE
  v_at timestamptz;
  v_alerts integer;
BEGIN
  SELECT r.auth_scrubbed_at INTO v_at FROM public.withdrawn_member_records r WHERE r.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_WITHDRAWN';
  END IF;
  IF v_at IS NULL THEN
    v_at := clock_timestamp();
    UPDATE public.withdrawn_member_records SET auth_scrubbed_at = v_at WHERE user_id = p_user_id;
  END IF;
  DELETE FROM auth.sessions WHERE user_id = p_user_id;
  DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
  UPDATE public.payment_reconciliation_alerts
     SET resolved_at = now()
   WHERE resolved_at IS NULL
     AND code = 'MEMBER_AUTH_SCRUB_PENDING'
     AND (details ->> 'dedupe_key') = 'member_auth_scrub:' || p_user_id;
  GET DIAGNOSTICS v_alerts = ROW_COUNT;
  RETURN jsonb_build_object('authScrubbedAt', v_at, 'alertsResolved', v_alerts);
END;
$fn_mark_withdrawn_member_auth_scrubbed$;

-- 7-11b. 완전 삭제의 로그인 계정 삭제가 끝난 뒤(서버가 auth.admin.deleteUser 성공·404 뒤 부른다) 남은 MEMBER_FULL_DELETE_AUTH_PENDING 경보를 푼다.
--        프로필이나 로그인 계정이 아직 남아 있으면 풀지 않는다.
CREATE OR REPLACE FUNCTION public.resolve_member_full_delete_auth_alert(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_resolve_member_full_delete_auth_alert$
DECLARE
  v_alerts integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id)
     OR EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
    RETURN jsonb_build_object('alertsResolved', 0, 'accountRemains', true);
  END IF;
  UPDATE public.payment_reconciliation_alerts
     SET resolved_at = now()
   WHERE resolved_at IS NULL
     AND code = 'MEMBER_FULL_DELETE_AUTH_PENDING'
     AND (details ->> 'dedupe_key') = 'member_full_delete_auth:' || p_user_id;
  GET DIAGNOSTICS v_alerts = ROW_COUNT;
  RETURN jsonb_build_object('alertsResolved', v_alerts, 'accountRemains', false);
END;
$fn_resolve_member_full_delete_auth_alert$;

-- 7-12. 카카오 연결 끊기 대상(서버 다시 시도용). 그 회원번호로 다른 계정이 새로 연결됐으면 newIdentityExists = true(끊지 말고 칸만 비움).
CREATE OR REPLACE FUNCTION public.withdrawn_member_kakao_unlink_target(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_withdrawn_member_kakao_unlink_target$
DECLARE
  v_kakao text;
BEGIN
  SELECT r.kakao_id_pending_unlink INTO v_kakao FROM public.withdrawn_member_records r WHERE r.user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_WITHDRAWN';
  END IF;
  RETURN jsonb_build_object(
    'kakaoId', v_kakao,
    'newIdentityExists', v_kakao IS NOT NULL AND EXISTS (
      SELECT 1 FROM auth.identities i WHERE i.provider = 'kakao' AND i.provider_id = v_kakao AND i.user_id <> p_user_id));
END;
$fn_withdrawn_member_kakao_unlink_target$;

CREATE OR REPLACE FUNCTION public.clear_withdrawn_member_kakao_unlink(p_user_id uuid, p_outcome text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_clear_withdrawn_member_kakao_unlink$
DECLARE
  v_n integer;
  v_alerts integer;
BEGIN
  IF p_user_id IS NULL OR p_outcome IS NULL OR p_outcome NOT IN ('unlinked', 'new_identity_exists') THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.withdrawn_member_records r WHERE r.user_id = p_user_id) THEN
    RAISE EXCEPTION 'MEMBER_NOT_WITHDRAWN';
  END IF;
  UPDATE public.withdrawn_member_records SET kakao_id_pending_unlink = NULL
   WHERE user_id = p_user_id AND kakao_id_pending_unlink IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.payment_reconciliation_alerts
     SET resolved_at = now()
   WHERE resolved_at IS NULL
     AND code = 'MEMBER_KAKAO_UNLINK_PENDING'
     AND (details ->> 'dedupe_key') = 'member_kakao_unlink:' || p_user_id;
  GET DIAGNOSTICS v_alerts = ROW_COUNT;
  RETURN jsonb_build_object('cleared', v_n = 1, 'outcome', p_outcome, 'alertsResolved', v_alerts);
END;
$fn_clear_withdrawn_member_kakao_unlink$;

-- 7-12b. 탈퇴 회원 로그인 계정 정리 상태(회원 상세의 [다시 시도] 표시, 대표 다시 시도 전 탈퇴 여부 확인).
--        탈퇴 회원이 아니면 {withdrawnAt:null, authScrubbedAt:null, kakaoUnlinkPending:false}(오류 아님).
CREATE OR REPLACE FUNCTION public.withdrawn_member_account_status(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_withdrawn_member_account_status$
DECLARE
  v_withdrawn timestamptz;
  v_record public.withdrawn_member_records%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  SELECT p.withdrawn_at INTO v_withdrawn FROM public.profiles p WHERE p.id = p_user_id;
  SELECT * INTO v_record FROM public.withdrawn_member_records r WHERE r.user_id = p_user_id;
  IF v_withdrawn IS NULL OR v_record.user_id IS NULL THEN
    RETURN jsonb_build_object('withdrawnAt', NULL, 'authScrubbedAt', NULL, 'kakaoUnlinkPending', false);
  END IF;
  RETURN jsonb_build_object(
    'withdrawnAt', v_withdrawn,
    'authScrubbedAt', v_record.auth_scrubbed_at,
    'kakaoUnlinkPending', v_record.kakao_id_pending_unlink IS NOT NULL);
END;
$fn_withdrawn_member_account_status$;

-- 7-12c. 탈퇴 회원 보류 주문(늦은 결제 기록 있음) 판정: 받은 주문 id 가운데 해당하는 것만 돌려준다.
--        결제 검토 화면이 이 주문에는 확인 처리 버튼 대신 안내를 보인다(최종 판단은 resolve_payment_order_review).
CREATE OR REPLACE FUNCTION public.withdrawn_member_held_order_ids(p_order_ids uuid[])
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_withdrawn_member_held_order_ids$
BEGIN
  IF p_order_ids IS NULL OR cardinality(p_order_ids) > 1000 THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  RETURN COALESCE((SELECT array_agg(DISTINCT e.ref_id)
                     FROM public.withdrawn_member_record_events e
                    WHERE e.kind = 'late_payment' AND e.ref_id = ANY (p_order_ids)), '{}'::uuid[]);
END;
$fn_withdrawn_member_held_order_ids$;

-- 7-13. 보관함·탈퇴 회원 문의 열람(대표 전용). 열람 기록(사유·요청 IP·기기)을 남긴 뒤 내용을 돌려준다.
CREATE OR REPLACE FUNCTION public.read_withdrawn_member_record(p_actor_id uuid, p_user_id uuid, p_reason text, p_request_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_read_withdrawn_member_record$
DECLARE
  v_record public.withdrawn_member_records%ROWTYPE;
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  IF NULLIF(btrim(p_reason), '') IS NULL OR length(p_reason) > 500
     OR (p_request_meta IS NOT NULL AND jsonb_typeof(p_request_meta) <> 'object') THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  SELECT * INTO v_record FROM public.withdrawn_member_records WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_WITHDRAWN';
  END IF;
  PERFORM public.record_admin_audit(p_actor_id, 'withdrawn_record_view', 'withdrawn_member_record', p_user_id::text, p_user_id,
    NULL, p_reason, jsonb_build_object('kind', 'record', 'request', COALESCE(p_request_meta, '{}'::jsonb)), NULL);
  RETURN to_jsonb(v_record) || jsonb_build_object('events', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'refId', e.ref_id, 'details', e.details,
                                                 'actorId', e.actor_id, 'createdAt', e.created_at) ORDER BY e.created_at), '[]'::jsonb)
      FROM public.withdrawn_member_record_events e WHERE e.user_id = p_user_id));
END;
$fn_read_withdrawn_member_record$;

CREATE OR REPLACE FUNCTION public.read_withdrawn_member_ticket(p_actor_id uuid, p_ticket_id uuid, p_reason text, p_request_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_read_withdrawn_member_ticket$
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
$fn_read_withdrawn_member_ticket$;

-- 7-14. 완전 삭제 경로(서버)가 문의를 지우기 전에 부른다: 그 회원 문의·환불의 관리자 이벤트 제목·본문을 '탈퇴 회원 문의'로.
CREATE OR REPLACE FUNCTION public.scrub_member_admin_events(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_scrub_member_admin_events$
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.is_admin IS NOT TRUE) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  RETURN jsonb_build_object('scrubbed', public.member_withdrawal_scrub_admin_events(p_user_id));
END;
$fn_scrub_member_admin_events$;

-- 8. 권한 -------------------------------------------------------------------------------------------------------
-- 내부·트리거 함수: postgres 만
REVOKE ALL ON FUNCTION public.member_withdrawal_policy() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_withdrawal_policy_days(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_text_has_long_number(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.point_charge_cash_value(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_withdrawal_facts(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_withdrawal_notice_text(text, jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_admin_event_owner(text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_withdrawal_scrub_admin_events(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_withdrawal_require_owner(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_member_withdrawal_requests_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_withdrawn_member_records_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_withdrawn_member_record_events_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_withdrawn_member_write() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_withdrawn_member_view_event() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_withdrawn_member_credit_source() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_withdrawn_member_notification() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_withdrawn_member_manual_refund() FROM PUBLIC, anon, authenticated, service_role;

-- service_role 함수
REVOKE ALL ON FUNCTION public.get_member_withdrawal_preview(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_member_withdrawal_notice(uuid, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_member_withdrawal_request(uuid, text, text, text, integer, integer, integer, text, uuid, boolean, text, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_member_withdrawal_request_reply(uuid, uuid, timestamptz, timestamptz, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_member_withdrawal_request(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.anonymize_member(uuid, uuid, text, uuid, integer, text, boolean, text, text, boolean, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.redact_member_text(uuid, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_member_text_reviewed(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.close_withdrawn_member_held_order(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.add_withdrawn_member_event(uuid, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_withdrawn_member_auth_scrubbed(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.withdrawn_member_kakao_unlink_target(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.clear_withdrawn_member_kakao_unlink(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_withdrawn_member_record(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_withdrawn_member_ticket(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.scrub_member_admin_events(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.withdrawn_member_account_status(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_member_full_delete_auth_alert(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.withdrawn_member_held_order_ids(uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_member_withdrawal_preview(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_member_withdrawal_notice(uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_member_withdrawal_request(uuid, text, text, text, integer, integer, integer, text, uuid, boolean, text, timestamptz, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_member_withdrawal_request_reply(uuid, uuid, timestamptz, timestamptz, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_member_withdrawal_request(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.anonymize_member(uuid, uuid, text, uuid, integer, text, boolean, text, text, boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.redact_member_text(uuid, text, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_member_text_reviewed(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.close_withdrawn_member_held_order(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_withdrawn_member_event(uuid, uuid, text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_withdrawn_member_auth_scrubbed(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.withdrawn_member_kakao_unlink_target(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_withdrawn_member_kakao_unlink(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_withdrawn_member_record(uuid, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_withdrawn_member_ticket(uuid, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.scrub_member_admin_events(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.withdrawn_member_account_status(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_member_full_delete_auth_alert(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.withdrawn_member_held_order_ids(uuid[]) TO service_role;

-- 9. VERIFY -----------------------------------------------------------------------------------------------------
DO $verify_member_withdrawal$
DECLARE
  v_value jsonb;
  v_text text;
  v_count integer;
  v_acl text;
  v_sig text;
  v_key text;
  v_order uuid;
  v_event uuid;
  v_ok boolean;
  v_new text[][] := ARRAY[
    ARRAY['public.payapp_fulfill_order_internal(uuid,timestamp with time zone)', '657bbb07ae4b250a2697f21e2aa805e9'],
    ARRAY['public.apply_payapp_feedback(text,text,text,text,integer,integer,integer,integer,timestamp with time zone,timestamp with time zone)', '1859412411fc132dacfae4ca7a89eba4'],
    ARRAY['public.retry_payapp_fulfillment(uuid)', '93cde859327328f598e71059dcc04e6d'],
    ARRAY['public.resolve_payment_order_review(uuid,text,uuid,text,text,timestamp with time zone,text)', 'cbe116d85e140991d5993b5563296b37'],
    ARRAY['public.prepare_payment_order(uuid,uuid,text,uuid,text,text,integer,integer,text,text,text,text,text,timestamp with time zone,integer,integer,text,text)', '93e0bd5e41969f66f296f4353f3feeb9'],
    ARRAY['public.begin_payapp_request(uuid)', '679b4474c0dc42de11e5e9a14a7d1d4d'],
    ARRAY['public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)', 'be4403fd993c45d618950a5908a91591'],
    ARRAY['public.process_payapp_cancellation(uuid)', 'e0f752c7759626790a2afb86eab6aee6'],
    ARRAY['public.payapp_sales_resume_blockers()', 'edbb1eb553719198ffa9f9bc0d3aca4c'],
    ARRAY['public.enforce_payment_reconciliation_health()', 'e563ade9c072b09e26844b655e918755'],
    ARRAY['public.prevent_payment_order_snapshot_update()', '940bcad422d63c58e5d31c5756b0d473'],
    ARRAY['public.consent_record_internal(uuid,jsonb,text)', '61a9beb9d7f94cf6b0ed9b4518b52b44'],
    ARRAY['public.guard_user_consents_mutation()', '4ba21dab0a28e0c117bbead375a3fc8f'],
    ARRAY['public.guard_market_purchase_notice_acks_mutation()', '3959ac2b8139d0f81365df59ed67ef10'],
    ARRAY['public.prevent_admin_event_mutation()', 'f35f60e1461e49138635ffd4a11a27f9'],
    ARRAY['public.remind_unanswered_admin_work()', 'b950b1bfecc0ed4d470293508c0e2a60'],
    ARRAY['public.guard_support_ticket_revisions_mutation()', '1a8d96fc0bfe469e491b86c2f866e3bd'],
    ARRAY['public.cancel_incomplete_kakao_signup(uuid)', 'a83431d12c4686a0fbe57976a82038fe'],
    ARRAY['public.complete_kakao_signup_with_consents(uuid,jsonb,text,text,text,text)', 'a43e805089f08a12e22721168dbe962a'],
    ARRAY['public.consent_eligible_member_count()', '4b1c6999080f9bf6978be808997fd9ac']
  ];
  i integer;
BEGIN
  -- 9-1. 설정 모양(스스로 익명화 스위치는 값이 아니라 boolean 키가 있는지만 본다 — 켠 뒤 재적용해도 멈추지 않게. 처음 넣는 값은 false)
  SELECT value INTO v_value FROM public.system_settings WHERE key = 'member_withdrawal_policy';
  IF v_value IS NULL OR jsonb_typeof(v_value -> 'version') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_value -> 'selfAnonymizeEnabled') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(v_value -> 'texts') IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_value -> 'texts' -> 'notice') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'VERIFY: member_withdrawal_policy shape';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['paymentRetentionYears', 'payerTicketRetentionYears', 'payerRefundTicketRetentionYears',
                               'nonPayerTicketRetentionYears', 'attemptRecordRetentionYears', 'withdrawalRecordRetentionYears',
                               'consentRecordRetentionYears', 'selfWithdrawOrderQuietDays', 'withdrawRefundDeadlineBufferDays'] LOOP
    IF public.member_withdrawal_policy_days(v_key) IS NULL THEN
      RAISE EXCEPTION 'VERIFY: policy number %', v_key;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['noticeTitle', 'confirmLabel', 'adminEventTitle', 'redactionMask', 'marketingResult',
                               'forfeitDescription', 'cleanupDescription', 'alertAuthScrubPending', 'alertHeldOrderFeedbackMismatch',
                               'alertClosedHeldOrderCancelFailed', 'finishDeleteNotice', 'finishDeleteButton', 'paymentReviewHeldOrder'] LOOP
    IF NULLIF(btrim(v_value -> 'texts' ->> v_key), '') IS NULL THEN
      RAISE EXCEPTION 'VERIFY: policy text %', v_key;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['downloads', 'noCarryOver', 'reviews', 'ticketsPayer', 'ticketsKeep', 'ticketsDelete', 'ticketsChoice',
                               'pendingTickets', 'pendingTicketsDelete', 'pendingTicketsChoice', 'credits', 'creditLinePaid', 'creditLineFree', 'noExpiry', 'noCredits', 'legalRefund',
                               'marketingSelf', 'marketingRequest', 'useBeforeRequest', 'irreversible', 'termsVersion',
                               'creditsFreeOnly', 'creditsCashUnknown', 'creditLinePaidCashUnknown', 'retainedPayer', 'retainedAttemptOnly'] LOOP
    IF NULLIF(btrim(v_value -> 'texts' -> 'notice' ->> v_key), '') IS NULL THEN
      RAISE EXCEPTION 'VERIFY: policy notice text %', v_key;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.signup_consent_items i WHERE i.key = v_value ->> 'marketingConsentItemKey')
     OR NOT EXISTS (SELECT 1 FROM public.signup_consent_items i WHERE i.key = v_value ->> 'termsConsentItemKey') THEN
    RAISE EXCEPTION 'VERIFY: consent item keys';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings'
                  AND policyname = 'system_settings_member_withdrawal_policy_no_client_write' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'VERIFY: no_client_write policy';
  END IF;

  -- 9-2. 칸·CHECK
  SELECT count(*) INTO v_count FROM information_schema.columns
   WHERE table_schema = 'public'
     AND ((table_name = 'profiles' AND column_name = 'withdrawn_at')
          OR (table_name IN ('support_tickets', 'support_ticket_revisions', 'refund_requests', 'market_refund_requests')
              AND column_name = 'redaction_reviewed_at'));
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'VERIFY: columns = %', v_count;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_transactions_type_check' AND pg_get_constraintdef(oid) LIKE '%withdrawal_forfeit%')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_consents_source_check' AND pg_get_constraintdef(oid) LIKE '%''withdrawal''%')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_admin_actions_action_check' AND pg_get_constraintdef(oid) LIKE '%withdrawn_held_order_closed%') THEN
    RAISE EXCEPTION 'VERIFY: check constraints';
  END IF;

  -- 9-3. 새 표: RLS·정책 없음·권한·가드
  FOREACH v_key IN ARRAY ARRAY['member_withdrawal_requests', 'withdrawn_member_records', 'withdrawn_member_record_events'] LOOP
    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = ('public.' || v_key)::regclass) THEN
      RAISE EXCEPTION 'VERIFY: RLS %', v_key;
    END IF;
    SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public' AND tablename = v_key;
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'VERIFY: policies on % = %', v_key, v_count;
    END IF;
    SELECT count(*) INTO v_count FROM pg_trigger WHERE tgrelid = ('public.' || v_key)::regclass AND NOT tgisinternal;
    IF v_count <> 2 THEN
      RAISE EXCEPTION 'VERIFY: triggers on % = %', v_key, v_count;
    END IF;
  END LOOP;
  SELECT string_agg(format('%s:%s:%s', table_name, grantee, privilege_type), ', ') INTO v_text
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name IN ('member_withdrawal_requests', 'withdrawn_member_records', 'withdrawn_member_record_events')
     AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
     AND NOT (table_name = 'member_withdrawal_requests' AND grantee = 'service_role' AND privilege_type = 'SELECT');
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: table grants: %', v_text;
  END IF;

  -- 9-4. 탈퇴 회원 숨김 정책(RESTRICTIVE 4개)
  SELECT count(*) INTO v_count FROM pg_policies
   WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE'
     AND (tablename, policyname) IN (('support_tickets', 'support_tickets_withdrawn_hidden'),
                                     ('market_refund_requests', 'market_refund_requests_withdrawn_hidden'),
                                     ('support_ticket_revisions', 'support_ticket_revisions_withdrawn_hidden'),
                                     ('refund_requests', 'refund_requests_withdrawn_hidden'));
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'VERIFY: withdrawn hidden policies = %', v_count;
  END IF;

  -- 9-5. 보호 트리거
  SELECT count(*) INTO v_count FROM pg_trigger t
   WHERE NOT t.tgisinternal
     AND ((t.tgname = 'guard_withdrawn_member_write'
           AND t.tgrelid IN ('public.support_tickets'::regclass, 'public.support_ticket_revisions'::regclass, 'public.questions'::regclass,
                             'public.passages'::regclass, 'public.exam_papers'::regclass, 'public.exam_paper_items'::regclass))
          OR (t.tgname = 'guard_withdrawn_member_view_event' AND t.tgrelid = 'public.market_item_view_events'::regclass)
          OR (t.tgname = 'guard_withdrawn_member_credit_source' AND t.tgrelid = 'public.credit_sources'::regclass)
          OR (t.tgname = 'guard_withdrawn_member_notification' AND t.tgrelid = 'public.notifications'::regclass)
          OR (t.tgname = 'record_withdrawn_member_manual_refund' AND t.tgrelid = 'public.refund_requests'::regclass));
  IF v_count <> 10 THEN
    RAISE EXCEPTION 'VERIFY: protection triggers = %', v_count;
  END IF;

  -- 9-6. (3a) PUBLIC/anon 이 실행할 수 있는 SECURITY DEFINER 함수는 handle_new_user 뿐
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_text
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.prosecdef
     AND (p.proacl IS NULL OR p.proacl::text ~ '(\{|,)(=|anon=)X')
     AND p.proname <> 'handle_new_user';
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: public/anon executable definer functions: %', v_text;
  END IF;

  -- 9-7. 함수 ACL·정의자·search_path
  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_member_withdrawal_preview(uuid,boolean)',
    'public.get_member_withdrawal_notice(uuid,text,boolean)',
    'public.create_member_withdrawal_request(uuid,text,text,text,integer,integer,integer,text,uuid,boolean,text,timestamp with time zone,timestamp with time zone,timestamp with time zone)',
    'public.record_member_withdrawal_request_reply(uuid,uuid,timestamp with time zone,timestamp with time zone,boolean)',
    'public.cancel_member_withdrawal_request(uuid,uuid)',
    'public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)',
    'public.redact_member_text(uuid,text,uuid,text,text,text)',
    'public.mark_member_text_reviewed(uuid,text,uuid)',
    'public.close_withdrawn_member_held_order(uuid,uuid,text,text,text)',
    'public.add_withdrawn_member_event(uuid,uuid,text,uuid,jsonb)',
    'public.mark_withdrawn_member_auth_scrubbed(uuid)',
    'public.withdrawn_member_kakao_unlink_target(uuid)',
    'public.clear_withdrawn_member_kakao_unlink(uuid,text)',
    'public.read_withdrawn_member_record(uuid,uuid,text,jsonb)',
    'public.read_withdrawn_member_ticket(uuid,uuid,text,jsonb)',
    'public.scrub_member_admin_events(uuid)',
    'public.withdrawn_member_account_status(uuid)',
    'public.resolve_member_full_delete_auth_alert(uuid)',
    'public.withdrawn_member_held_order_ids(uuid[])'] LOOP
    SELECT p.proacl::text INTO v_acl FROM pg_proc p WHERE p.oid = v_sig::regprocedure;
    IF v_acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
      RAISE EXCEPTION 'VERIFY: service acl % = %', v_sig, v_acl;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_sig::regprocedure AND p.prosecdef
                    AND p.proconfig = ARRAY['search_path=public, pg_temp']) THEN
      RAISE EXCEPTION 'VERIFY: definer/search_path %', v_sig;
    END IF;
  END LOOP;
  FOREACH v_sig IN ARRAY ARRAY[
    'public.member_withdrawal_policy()', 'public.member_withdrawal_policy_days(text)', 'public.member_text_has_long_number(text)',
    'public.point_charge_cash_value(uuid,integer)', 'public.member_withdrawal_facts(uuid,boolean)',
    'public.member_withdrawal_notice_text(text,jsonb,boolean)', 'public.member_admin_event_owner(text,uuid)',
    'public.member_withdrawal_scrub_admin_events(uuid)', 'public.member_withdrawal_require_owner(uuid)',
    'public.guard_member_withdrawal_requests_mutation()', 'public.guard_withdrawn_member_records_mutation()',
    'public.guard_withdrawn_member_record_events_mutation()'] LOOP
    SELECT p.proacl::text INTO v_acl FROM pg_proc p WHERE p.oid = v_sig::regprocedure;
    IF v_acl IS DISTINCT FROM '{postgres=X/postgres}' THEN
      RAISE EXCEPTION 'VERIFY: internal acl % = %', v_sig, v_acl;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_sig::regprocedure AND (p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'])) THEN
      RAISE EXCEPTION 'VERIFY: internal must not be definer / search_path %', v_sig;
    END IF;
  END LOOP;
  FOREACH v_sig IN ARRAY ARRAY[
    'public.guard_withdrawn_member_write()', 'public.guard_withdrawn_member_view_event()', 'public.guard_withdrawn_member_credit_source()',
    'public.guard_withdrawn_member_notification()', 'public.record_withdrawn_member_manual_refund()'] LOOP
    SELECT p.proacl::text INTO v_acl FROM pg_proc p WHERE p.oid = v_sig::regprocedure;
    IF v_acl IS DISTINCT FROM '{postgres=X/postgres}'
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_sig::regprocedure AND p.prosecdef
                       AND p.proconfig = ARRAY['search_path=public, pg_temp']) THEN
      RAISE EXCEPTION 'VERIFY: trigger function % = %', v_sig, v_acl;
    END IF;
  END LOOP;

  -- 9-8. 재정의 함수 새 지문
  FOR i IN 1 .. array_length(v_new, 1) LOOP
    IF v_new[i][1] <> '' AND md5(pg_get_functiondef(v_new[i][1]::regprocedure)) <> v_new[i][2] THEN
      RAISE EXCEPTION 'VERIFY: redefined md5 %', v_new[i][1];
    END IF;
  END LOOP;

  -- 9-9. 가드 예외는 설정이 있을 때만: 설정 없는 주문 fingerprint 변경·관리자 이벤트 UPDATE 는 거절, 다른 회원 설정도 거절
  SELECT o.id INTO v_order FROM public.payment_orders o WHERE o.request_fingerprint IS NOT NULL ORDER BY o.created_at LIMIT 1;
  IF v_order IS NOT NULL THEN
    v_ok := false;
    BEGIN
      UPDATE public.payment_orders SET request_fingerprint = request_fingerprint || 'x' WHERE id = v_order;
    EXCEPTION WHEN OTHERS THEN
      v_ok := SQLERRM = 'PAYMENT_ORDER_IMMUTABLE_SNAPSHOT';
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'VERIFY: order snapshot guard without setting';
    END IF;
    v_ok := false;
    BEGIN
      PERFORM set_config('app.member_withdrawal_bypass', gen_random_uuid()::text, true);
      UPDATE public.payment_orders SET request_fingerprint = request_fingerprint || 'x' WHERE id = v_order;
    EXCEPTION WHEN OTHERS THEN
      v_ok := SQLERRM = 'PAYMENT_ORDER_IMMUTABLE_SNAPSHOT';
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'VERIFY: order snapshot guard with other member setting';
    END IF;
  END IF;
  SELECT e.id INTO v_event FROM public.admin_events e ORDER BY e.created_at LIMIT 1;
  IF v_event IS NOT NULL THEN
    v_ok := false;
    BEGIN
      UPDATE public.admin_events SET title = title WHERE id = v_event;
    EXCEPTION WHEN OTHERS THEN
      v_ok := SQLERRM = 'ADMIN_EVENTS_APPEND_ONLY';
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'VERIFY: admin_events guard without setting';
    END IF;
    v_ok := false;
    BEGIN
      PERFORM set_config('app.member_withdrawal_bypass', gen_random_uuid()::text, true);
      UPDATE public.admin_events SET title = title WHERE id = v_event;
    EXCEPTION WHEN OTHERS THEN
      v_ok := SQLERRM = 'ADMIN_EVENTS_APPEND_ONLY';
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'VERIFY: admin_events guard with other member setting';
    END IF;
  END IF;
  IF COALESCE(current_setting('app.member_withdrawal_bypass', true), '') <> '' THEN
    RAISE EXCEPTION 'VERIFY: bypass setting leaked';
  END IF;

  -- 9-10. 원 환산·긴 번호 규칙 고정
  IF public.member_text_has_long_number('계좌 110-123-456789 입니다') IS NOT TRUE
     OR public.member_text_has_long_number('010 1234 5678') IS NOT TRUE
     OR public.member_text_has_long_number('주문 123-456 789') IS NOT FALSE
     OR public.member_text_has_long_number(NULL) IS NOT FALSE THEN
    RAISE EXCEPTION 'VERIFY: long number rule';
  END IF;
END;
$verify_member_withdrawal$;

NOTIFY pgrst, 'reload schema';

DO $rh_t13_reapply$ BEGIN PERFORM pg_temp.check(to_regprocedure('public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)') IS NOT NULL, 'T13', '재적용 성공(VERIFY 통과)'); END $rh_t13_reapply$;

-- ===== T1~T16 =====
-- 공통 준비: 대표·직원 시험 계정, 스스로 익명화 켬(이 거래 안에서만)
DO $rh_setup$
DECLARE
  v_owner uuid;
  v_staff uuid;
BEGIN
  v_owner := pg_temp.new_user('owner');
  UPDATE public.profiles SET is_admin = true, admin_role = 'owner' WHERE id = v_owner;
  v_staff := pg_temp.new_user('staff');
  UPDATE public.profiles SET is_admin = true, admin_role = 'staff' WHERE id = v_staff;
  PERFORM pg_temp.ctx_set('owner', v_owner::text);
  PERFORM pg_temp.ctx_set('staff', v_staff::text);
  UPDATE public.system_settings SET value = jsonb_set(value, '{selfAnonymizeEnabled}', 'true'::jsonb) WHERE key = 'member_withdrawal_policy';
  PERFORM pg_temp.check((SELECT value -> 'selfAnonymizeEnabled' FROM public.system_settings WHERE key = 'member_withdrawal_policy') = 'true'::jsonb,
    '준비', '시험 대표·직원 계정을 만들고 스스로 익명화를 켬(거래 안)');
END $rh_setup$;

-- T1: 결제 회원 익명화(보관함·소멸 원장·스냅숏 0·삭제/보존·동의 철회·세션·차단·이벤트 제목·대기 문의 닫기·미답변 알림 0)
DO $rh_t1$
DECLARE
  v_owner uuid := pg_temp.ctx('owner')::uuid;
  v_user uuid;
  v_other uuid;
  v_paid jsonb;
  v_src uuid;
  v_t1 uuid;
  v_t2 uuid;
  v_t_other uuid;
  v_req text;
  v_res text;
  v_r jsonb;
  v_rec public.withdrawn_member_records%ROWTYPE;
  v_snap jsonb;
  v_email text;
  v_phone text;
  v_tag text;
  v_item uuid;
  v_subject text;
  v_n integer;
  v_kst_hour integer;
  v_cfg jsonb;
BEGIN
  v_user := pg_temp.new_user('t1');
  SELECT email, phone, display_tag INTO v_email, v_phone, v_tag FROM public.profiles WHERE id = v_user;
  PERFORM pg_temp.consent_all(v_user, true);
  v_paid := pg_temp.paid(v_user, 30);
  v_src := (v_paid ->> 'source_id')::uuid;
  PERFORM pg_temp.use_credits(v_src, 4000);
  PERFORM pg_temp.grant_free(v_user, 500);
  INSERT INTO public.credit_sources (user_id, initial_credits, remaining_credits, status, source_category, purchased_at, expires_at, created_at)
  VALUES (v_user, 300, 300, 'active', 'bonus', now() - interval '400 days', now() - interval '1 day', now() - interval '400 days');
  v_t1 := pg_temp.new_ticket(v_user, 'RH10 시험 대기 문의', '내용입니다', 'pending', 'etc', now() - interval '2 days');
  v_t2 := pg_temp.new_ticket(v_user, 'RH10 시험 답변 문의', '내용입니다', 'resolved', 'etc', now() - interval '5 days', '답변입니다', now() - interval '4 days');
  INSERT INTO public.questions (user_id, question_text, choices, answer) VALUES (v_user, 'Q', '[]'::jsonb, 'A');
  INSERT INTO public.passages (user_id, content) VALUES (v_user, 'P');
  INSERT INTO public.exam_papers (user_id, paper_title) VALUES (v_user, 'E');
  INSERT INTO public.notifications (user_id, type, title, message) VALUES (v_user, 'test', 't', 'm');
  PERFORM pg_temp.market_order(v_user);
  SELECT f.item_id, i.workspace_subject INTO v_item, v_subject FROM public.market_item_files f JOIN public.market_items i ON i.id = f.item_id LIMIT 1;
  INSERT INTO public.market_item_view_events (item_id, user_id, workspace_subject) VALUES (v_item, v_user, v_subject);
  INSERT INTO public.market_item_reviews (workspace_subject, item_id, user_id, rating, content) VALUES (v_subject, v_item, v_user, 5, '좋아요');
  INSERT INTO auth.sessions (id, user_id, created_at, updated_at) VALUES (gen_random_uuid(), v_user, now(), now());
  INSERT INTO auth.refresh_tokens (instance_id, token, user_id, revoked, created_at, updated_at)
  VALUES ('00000000-0000-0000-0000-000000000000', 'rh10-' || v_user, v_user::text, false, now(), now());

  -- 슬랙 알림 전송 포기 사본(notify_gave_up: ref_table admin_events, 본문에 원래 제목 사본)
  INSERT INTO public.admin_events (kind, severity, title, body, link, ref_table, ref_id, required_permission, delivery, dedupe_key)
  SELECT 'notify_gave_up', 'critical', '슬랙 알림 전송 포기', left(e.title, 150), e.link, 'admin_events', e.id, 'owner', 'screen', 'gaveup:' || e.id
    FROM public.admin_events e WHERE e.ref_table = 'support_tickets' AND e.ref_id = v_t1;

  -- 다른 회원의 대기 문의(미답변 알림 대조군)
  v_other := pg_temp.new_user('t1other');
  v_t_other := pg_temp.new_ticket(v_other, 'RH10 대조군 문의', '내용', 'pending', 'etc', now() - interval '2 days');

  v_req := pg_temp.try_request(v_user, 'screen', v_user);
  PERFORM pg_temp.expect(v_req, 'OK', 'T1', '결제 회원 탈퇴 요청(화면)');
  PERFORM pg_temp.check(pg_temp.res(v_req) -> 'marketing' ->> 'withdrawnAt' IS NOT NULL AND pg_temp.marketing_latest(v_user) = 'false:withdrawal',
    'T1', '요청 순간 마케팅 철회 1건(source withdrawal)');
  -- 요청 뒤 다시 마케팅 동의 → 익명화 때 다시 철회
  PERFORM pg_temp.marketing_set(v_user, true);

  v_res := pg_temp.try_anon(v_owner, v_user, 'owner', pg_temp.req_id(v_req), NULL, NULL, false, '시험 처리', 'rh10-t1-' || v_user, NULL, false);
  PERFORM pg_temp.expect(v_res, 'ERR MEMBER_WITHDRAW_PENDING_TICKETS_UNCONFIRMED', 'T1', '답변 대기 문의가 있으면 대표 확인 체크 필요');
  v_res := pg_temp.try_anon(v_owner, v_user, 'owner', pg_temp.req_id(v_req), NULL, NULL, false, '시험 처리', 'rh10-t1-' || v_user, NULL, true);
  PERFORM pg_temp.expect(v_res, 'OK', 'T1', '대표 익명화');
  v_r := pg_temp.res(v_res);
  PERFORM pg_temp.ctx_set('t1_user', v_user::text);
  PERFORM pg_temp.ctx_set('t1_key', 'rh10-t1-' || v_user);
  PERFORM pg_temp.ctx_set('t1_req', pg_temp.req_id(v_req)::text);
  PERFORM pg_temp.ctx_set('t1_source', v_src::text);
  PERFORM pg_temp.ctx_set('t1_order', v_paid ->> 'order_id');

  PERFORM pg_temp.check((v_r ->> 'forfeited')::int = 6500 AND (v_r ->> 'forfeitedPaid')::int = 6000 AND (v_r ->> 'forfeitedFree')::int = 500
    AND (v_r ->> 'expiredCleared')::int = 300 AND (v_r -> 'marketing' ->> 'sender') = (SELECT value ->> 'name' FROM public.system_settings WHERE key = 'site_brand'),
    'T1', '결과: 소멸 6,500(유료 6,000·무상 500), 만료 정리 300, 마케팅 철회 결과(보낸 곳)');
  SELECT * INTO v_rec FROM public.withdrawn_member_records WHERE user_id = v_user;
  PERFORM pg_temp.check(v_rec.email = v_email AND v_rec.phone IS NOT DISTINCT FROM v_phone AND v_rec.had_payment AND v_rec.forfeited_credits = 6500
    AND v_rec.forfeited_paid_credits = 6000 AND jsonb_array_length(v_rec.forfeit_breakdown) = 3 AND v_rec.consent_notice_sha256 ~ '^[0-9a-f]{64}$'
    AND v_rec.last_payment_event_at IS NOT NULL AND v_rec.last_ticket_event_at IS NOT NULL AND v_rec.result = v_r AND v_rec.marketing_withdrawn_at IS NOT NULL,
    'T1', '보관함: 연락처 이동·결제 회원·원천별 소멸 3건·고지 지문·사건 시각');
  PERFORM pg_temp.check((SELECT bool_and(e ->> 'cash_value' IS NOT NULL) FROM jsonb_array_elements(v_rec.forfeit_breakdown) e WHERE (e ->> 'paid')::boolean AND (e ->> 'forfeited')::int > 0)
    AND (SELECT (e ->> 'expired_cleared')::int FROM jsonb_array_elements(v_rec.forfeit_breakdown) e WHERE e ->> 'category' = 'bonus') = 300,
    'T1', '보관함 forfeit_breakdown: 유료분 원 환산, 만료분 expired_cleared');
  SELECT count(*) INTO v_n FROM public.credit_transactions WHERE user_id = v_user AND type = 'withdrawal_forfeit' AND balance_after = 0
     AND operation_key LIKE 'rh10-t1-' || v_user || ':%';
  PERFORM pg_temp.check(v_n = 2 AND (SELECT sum(amount) FROM public.credit_transactions WHERE user_id = v_user AND type = 'withdrawal_forfeit') = -6500,
    'T1', '소멸 원장 2행(음수 합 -6,500, balance_after 0, operation_key 키:원천)');
  v_snap := public.get_credit_balance_snapshot(v_user);
  PERFORM pg_temp.check((v_snap ->> 'profile_balance')::int = 0 AND (v_snap ->> 'ledger_balance')::int = 0 AND (v_snap ->> 'spendable_balance')::int = 0
    AND (v_snap ->> 'expired_balance')::int = 0 AND (v_snap ->> 'latest_transaction_balance')::int = 0, 'T1', '잔액 스냅숏 4값 + 최근 거래 잔액 모두 0');
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user AND p.email IS NULL AND p.phone IS NULL AND p.kakao_email IS NULL
      AND p.avatar_url IS NULL AND p.withdrawn_at IS NOT NULL AND p.credits = 0 AND p.display_tag <> v_tag AND p.signup_completed),
    'T1', '프로필: 개인정보 칸 NULL, display_tag 새 값, withdrawn_at, signup_completed 그대로');
  PERFORM pg_temp.check(pg_temp.marketing_latest(v_user) = 'false:withdrawal'
    AND (SELECT count(*) FROM public.user_consents WHERE user_id = v_user AND source = 'withdrawal') = 2, 'T1', '동의 기록 보존 + 익명화 때 마케팅 철회 1건 더');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = v_user) AND NOT EXISTS (SELECT 1 FROM auth.refresh_tokens WHERE user_id = v_user::text)
    AND (SELECT isfinite(banned_until) AND banned_until > now() + interval '99 years' AND banned_until < now() + interval '101 years' FROM auth.users WHERE id = v_user),
    'T1', '세션·옛 refresh token 삭제, banned_until 유한 값(100년 뒤)');
  PERFORM pg_temp.check((SELECT count(*) FROM public.questions WHERE user_id = v_user) = 0 AND (SELECT count(*) FROM public.passages WHERE user_id = v_user) = 0
    AND (SELECT count(*) FROM public.exam_papers WHERE user_id = v_user) = 0 AND (SELECT count(*) FROM public.notifications WHERE user_id = v_user) = 0
    AND (SELECT count(*) FROM public.market_item_reviews WHERE user_id = v_user) = 0 AND (SELECT count(*) FROM public.market_item_view_events WHERE user_id = v_user) = 0,
    'T1', '삭제: 문제·지문·문제지·알림·후기, 조회 기록 user_id 비움');
  PERFORM pg_temp.check((SELECT count(*) FROM public.market_purchase_orders WHERE user_id = v_user) = 1
    AND (SELECT count(*) FROM public.market_entitlements WHERE user_id = v_user) = 1
    AND (SELECT count(*) FROM public.market_purchase_notice_acks WHERE user_id = v_user) = 1
    AND (SELECT count(*) FROM public.market_download_events WHERE user_id = v_user AND ip_address IS NULL AND user_agent IS NULL) = 1
    AND (SELECT count(*) FROM public.payment_orders WHERE user_id = v_user) = 1 AND (SELECT count(*) FROM public.credit_sources WHERE user_id = v_user) = 3,
    'T1', '보존: 자료 주문·권한·구매 고지·다운로드(접속 정보만 지움)·결제 주문·크레딧 원천');
  PERFORM pg_temp.check((SELECT status FROM public.support_tickets WHERE id = v_t1) = 'closed' AND (SELECT status FROM public.support_tickets WHERE id = v_t2) = 'resolved'
    AND NOT EXISTS (SELECT 1 FROM public.admin_events e WHERE e.ref_table = 'support_tickets' AND e.ref_id IN (v_t1, v_t2) AND e.title <> '탈퇴 회원 문의')
    AND EXISTS (SELECT 1 FROM public.admin_events e WHERE e.ref_table = 'support_tickets' AND e.ref_id = v_t1),
    'T1', '대기 문의 closed, 문의 관리자 이벤트 제목 → 탈퇴 회원 문의');
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM public.admin_events g JOIN public.admin_events e ON e.id = g.ref_id
                                 WHERE g.kind = 'notify_gave_up' AND e.ref_id = v_t1 AND g.title = '슬랙 알림 전송 포기' AND g.body = '탈퇴 회원 문의'),
    'T1', '알림 포기 사본도 본문(원래 제목 사본) → 탈퇴 회원 문의');
  PERFORM pg_temp.check((SELECT status FROM public.member_withdrawal_requests WHERE id = pg_temp.req_id(v_req)) = 'completed'
    AND EXISTS (SELECT 1 FROM public.admin_audit_log a WHERE a.action = 'member_withdraw' AND a.target_user_id = v_user AND a.amount = 6500
                 AND a.details ->> 'pending_tickets_confirmed' = 'true' AND a.details::text NOT LIKE '%' || v_email || '%'),
    'T1', '요청 completed, 감사 기록(금액·체크, 개인정보 없음)');

  -- 미답변 알림: 탈퇴 회원 문의는 대기로 되돌려도 건너뛴다(대조군은 만든다)
  SELECT s.value -> 'reminders' INTO v_cfg FROM public.system_settings s WHERE s.key = 'admin_alert_settings';
  v_kst_hour := extract(hour FROM now() AT TIME ZONE 'Asia/Seoul');
  PERFORM set_config('app.member_withdrawal_bypass', v_user::text, true);
  UPDATE public.support_tickets SET status = 'pending' WHERE id = v_t1;
  PERFORM set_config('app.member_withdrawal_bypass', '', true);
  PERFORM public.remind_unanswered_admin_work();
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM public.admin_events e WHERE e.kind = 'support_unanswered' AND e.ref_id = v_t1), 'T1',
    'remind_unanswered_admin_work 실행 뒤 탈퇴 회원 문의 새 이벤트 0건');
  IF v_kst_hour >= (v_cfg ->> 'send_from_hour')::int AND v_kst_hour < (v_cfg ->> 'send_until_hour')::int THEN
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM public.admin_events e WHERE e.kind = 'support_unanswered' AND e.ref_id = v_t_other), 'T1',
      '대조군(탈퇴 안 한 회원) 대기 문의는 미답변 이벤트 생성');
  ELSE
    PERFORM pg_temp.ok('T1', '대조군 확인 생략: 지금은 알림 보내는 시간대 밖(KST ' || v_kst_hour || '시)');
  END IF;
END $rh_t1$;

-- T1-b: 만료분만 있는 결제 회원 — 소멸 행 없이 정리 행 1건, 스냅숏 4값 0
DO $rh_t1b$
DECLARE
  v_owner uuid := pg_temp.ctx('owner')::uuid;
  v_user uuid;
  v_req text;
  v_res text;
  v_snap jsonb;
BEGIN
  v_user := pg_temp.new_user('t1b');
  PERFORM pg_temp.paid(v_user, 400);
  -- 구매 당시(만료 전) 원장 잔액처럼 최근 거래 balance_after 를 10,000 으로 둔다(지금 기준으로는 만료돼 0 으로 계산되므로)
  UPDATE public.credit_transactions SET balance_after = 10000 WHERE user_id = v_user AND type = 'purchase';
  v_req := pg_temp.try_request(v_user, 'screen', v_user);
  PERFORM pg_temp.expect(v_req, 'OK', 'T1', '만료분만 있는 회원 요청(소멸 0)');
  v_res := pg_temp.try_anon(v_owner, v_user, 'owner', pg_temp.req_id(v_req), NULL, NULL, false, NULL, 'rh10-t1b-' || v_user, NULL, false);
  PERFORM pg_temp.expect(v_res, 'OK', 'T1', '만료분만 있는 회원 익명화');
  PERFORM pg_temp.check((pg_temp.res(v_res) ->> 'forfeited')::int = 0 AND (pg_temp.res(v_res) ->> 'expiredCleared')::int = 10000
    AND (SELECT count(*) FROM public.credit_transactions WHERE user_id = v_user AND type = 'withdrawal_forfeit' AND amount = 0 AND balance_after = 0
          AND operation_key = 'rh10-t1b-' || v_user || ':cleanup') = 1, 'T1', '만료 잔량은 거래 없이 0, 정리 행 1건(키:cleanup)');
  v_snap := public.get_credit_balance_snapshot(v_user);
  PERFORM pg_temp.check((v_snap ->> 'profile_balance')::int = 0 AND (v_snap ->> 'ledger_balance')::int = 0 AND (v_snap ->> 'spendable_balance')::int = 0
    AND (v_snap ->> 'expired_balance')::int = 0 AND (v_snap ->> 'latest_transaction_balance')::int = 0, 'T1', '만료분만 있던 회원도 스냅숏 4값 0');
END $rh_t1b$;

-- T2: 재요청(같은 키 / 다른 키), 요청 상태
DO $rh_t2$
DECLARE
  v_owner uuid := pg_temp.ctx('owner')::uuid;
  v_user uuid := pg_temp.ctx('t1_user')::uuid;
  v_res text;
BEGIN
  v_res := pg_temp.try_anon(v_owner, v_user, 'owner', pg_temp.ctx('t1_req')::uuid, NULL, NULL, false, NULL, pg_temp.ctx('t1_key'), NULL, true);
  PERFORM pg_temp.expect(v_res, 'OK', 'T2', '같은 키 재요청은 저장한 결과');
  PERFORM pg_temp.check((pg_temp.res(v_res) ->> 'replay')::boolean AND (pg_temp.res(v_res) - 'replay') = (SELECT result FROM public.withdrawn_member_records WHERE user_id = v_user),
    'T2', '재요청 결과 = 보관함 result');
  v_res := pg_temp.try_anon(v_owner, v_user, 'owner', pg_temp.ctx('t1_req')::uuid, NULL, NULL, false, NULL, 'rh10-other-key', NULL, true);
  PERFORM pg_temp.expect(v_res, 'ERR MEMBER_ALREADY_WITHDRAWN', 'T2', '다른 키는 거절');
  PERFORM pg_temp.check((SELECT status FROM public.member_withdrawal_requests WHERE id = pg_temp.ctx('t1_req')::uuid) = 'completed', 'T2', '요청 상태 completed 유지');
  PERFORM pg_temp.expect(pg_temp.try_request(v_user, 'screen', v_user), 'ERR MEMBER_ALREADY_WITHDRAWN', 'T2', '탈퇴 회원은 새 요청 불가');
END $rh_t2$;

-- T3: 진행 중 1~8 종류별(각각 만들고 되돌림)
DO $rh_t3$
DECLARE
  v_owner uuid := pg_temp.ctx('owner')::uuid;
  v_user uuid;
  v_paid jsonb;
  v_order uuid;
  v_order_key text;
  v_mul text;
  v_req text;
  v_kind text;
  v_key text;
  v_f jsonb;
  v_res text;
  v_mo uuid;
BEGIN
  v_user := pg_temp.new_user('t3');
  v_paid := pg_temp.paid(v_user, 40);
  v_order := (v_paid ->> 'order_id')::uuid;
  v_mul := v_paid ->> 'mul_no';
  SELECT order_id INTO v_order_key FROM public.payment_orders WHERE id = v_order;
  v_req := pg_temp.try_request(v_user, 'screen', v_user);
  PERFORM pg_temp.expect(v_req, 'OK', 'T3', '깨끗한 상태에서 요청');
  FOREACH v_kind IN ARRAY ARRAY['orders', 'attempts', 'cancelMarkers', 'partialMarkers', 'webhookEvents', 'pointRefunds', 'marketRefunds', 'pendingSources',
                                'alert:payment_order_id', 'alert:order_payment_order_id', 'alert:mul_no', 'alert:orig_mul_no', 'alert:order_id',
                                'alert:user_id', 'generationJobs'] LOOP
    BEGIN
      v_key := v_kind;
      CASE v_kind
        WHEN 'orders' THEN PERFORM pg_temp.new_order(v_user, 'ready_unknown');
        WHEN 'attempts' THEN
          INSERT INTO public.checkout_attempts (user_id, checkout_attempt_id, claimed_provider, plan_id, request_fingerprint, status, expires_at)
          VALUES (v_user, gen_random_uuid(), 'payapp', (SELECT id FROM public.pricing_plans WHERE is_active ORDER BY price LIMIT 1), 'rhfp', 'claimed', now() + interval '20 minutes');
        WHEN 'cancelMarkers' THEN UPDATE public.payment_provider_transactions SET cancel_feedback_recorded_at = now() WHERE payment_order_id = v_order;
        WHEN 'partialMarkers' THEN
          UPDATE public.payment_provider_transactions SET partial_cancel_feedback_recorded_at = now() WHERE payment_order_id = v_order;
          v_key := 'cancelMarkers';
        WHEN 'webhookEvents' THEN
          INSERT INTO public.payment_webhook_events (transmission_id, event_type, order_id, payload_hash, processing_status)
          VALUES ('payapp:' || v_mul || ':9', 'PAYAPP_PAY_STATE_9', NULL, 'rh10', 'pending');
        WHEN 'pointRefunds' THEN
          INSERT INTO public.refund_requests (user_id, source_id, reason, status, payment_order_id, provider, refund_amount, origin)
          VALUES (v_user, (v_paid ->> 'source_id')::uuid, 'RH10', 'pending_review', v_order, 'payapp', 9900, 'user');
        WHEN 'marketRefunds' THEN
          v_mo := pg_temp.market_order(v_user, false);
          INSERT INTO public.market_refund_requests (workspace_subject, user_id, item_id, target_kind, order_id, requested_refund_credits, status)
          SELECT o.workspace_subject, v_user, o.item_id, 'v2_order', o.id, 100, 'pending' FROM public.market_purchase_orders o WHERE o.id = v_mo;
        WHEN 'pendingSources' THEN UPDATE public.credit_sources SET status = 'pending_refund' WHERE id = (v_paid ->> 'source_id')::uuid;
        WHEN 'generationJobs' THEN
          INSERT INTO public.generate_listboard_generation_jobs (post_id, user_id, status)
          VALUES ((SELECT id FROM public.generate_listboard_posts LIMIT 1), v_user, 'running');
        ELSE
          INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
          VALUES ('RH10_TEST_ALERT', 'warning', 'RH10', jsonb_build_object(split_part(v_kind, ':', 2),
            CASE split_part(v_kind, ':', 2)
              WHEN 'payment_order_id' THEN v_order::text WHEN 'order_payment_order_id' THEN v_order::text
              WHEN 'mul_no' THEN v_mul WHEN 'orig_mul_no' THEN v_mul WHEN 'order_id' THEN v_order_key ELSE v_user::text END));
          v_key := 'alerts';
      END CASE;
      v_f := public.member_withdrawal_facts(v_user, true);
      PERFORM pg_temp.check((v_f -> 'inProgress' ->> v_key)::int >= 1 AND (v_f ->> 'inProgressTotal')::int >= 1, 'T3',
        '진행 중 판정: ' || v_kind || ' = ' || (v_f -> 'inProgress' ->> v_key));
      v_res := pg_temp.try_anon(v_owner, v_user, 'owner', pg_temp.req_id(v_req), NULL, NULL, false, NULL, 'rh10-t3-' || v_kind, NULL, true);
      PERFORM pg_temp.expect(v_res, 'ERR MEMBER_WITHDRAW_IN_PROGRESS', 'T3', '익명화 거절: ' || v_kind);
      RAISE EXCEPTION 'rh_undo';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'rh_undo' THEN
        RAISE;
      END IF;
    END;
  END LOOP;
  -- 낡은 claimed 결제 시도(연결 주문 끝남)는 막지 않는다
  v_f := public.member_withdrawal_facts(v_user, true);
  PERFORM pg_temp.check((v_f ->> 'inProgressTotal')::int = 0, 'T3', '되돌린 뒤 진행 중 0');
  -- 처리 끝난 웹훅·풀린 경보는 막지 않는다
  INSERT INTO public.payment_webhook_events (transmission_id, event_type, order_id, payload_hash, processing_status)
  VALUES ('payapp:' || v_mul || ':4', 'PAYAPP_PAY_STATE_4', NULL, 'rh10', 'completed');
  INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details, resolved_at)
  VALUES ('RH10_TEST_ALERT', 'warning', 'RH10', jsonb_build_object('user_id', v_user), now());
  v_f := public.member_withdrawal_facts(v_user, true);
  PERFORM pg_temp.check((v_f ->> 'inProgressTotal')::int = 0, 'T3', '처리 끝난 웹훅·해소된 경보는 진행 중 아님');
  PERFORM pg_temp.expect(pg_temp.try_anon(v_owner, v_user, 'owner', pg_temp.req_id(v_req), NULL, NULL, false, NULL, 'rh10-t3-ok', NULL, true),
    'OK', 'T3', '진행 중 0이면 익명화');
END $rh_t3$;

-- T4: 기간 남은 유료(환불 가능 / 일부 사용 + 기간 안), 마감 = eligibility 마감, 차단 = 마감 + 여유, 지나면 요청 가능
DO $rh_t4$
DECLARE
  v_user uuid;
  v_paid jsonb;
  v_src uuid;
  v_f jsonb;
  v_el jsonb;
  v_open jsonb;
  v_buffer integer := public.member_withdrawal_policy_days('withdrawRefundDeadlineBufferDays');
BEGIN
  v_user := pg_temp.new_user('t4');
  v_paid := pg_temp.paid(v_user, 0.01);
  v_src := (v_paid ->> 'source_id')::uuid;
  v_f := public.member_withdrawal_facts(v_user, true);
  v_el := public.get_point_charge_refund_eligibility(v_user, v_src);
  v_open := v_f -> 'refundPeriodOpen' -> 0;
  PERFORM pg_temp.check((v_el ->> 'allowed')::boolean AND jsonb_array_length(v_f -> 'refundPeriodOpen') = 1
    AND (v_open ->> 'deadline')::timestamptz = (v_el ->> 'refundable_until')::timestamptz
    AND (v_open ->> 'blockedUntil')::timestamptz = (v_el ->> 'refundable_until')::timestamptz + make_interval(days => v_buffer),
    'T4', '환불 가능 건: 마감 = eligibility 마감, 차단 = 마감 + 여유 ' || v_buffer || '일');
  PERFORM pg_temp.expect(pg_temp.try_request(v_user, 'screen', v_user), 'ERR MEMBER_WITHDRAW_REFUND_PERIOD_OPEN', 'T4', '환불 가능 기간이면 요청 거절');
  PERFORM pg_temp.use_credits(v_src, 1000);
  v_el := public.get_point_charge_refund_eligibility(v_user, v_src);
  v_f := public.member_withdrawal_facts(v_user, true);
  PERFORM pg_temp.check(v_el ->> 'reason_code' = 'REFUND_CREDITS_ALREADY_USED' AND jsonb_array_length(v_f -> 'refundPeriodOpen') = 1
    AND (v_f -> 'refundPeriodOpen' -> 0 ->> 'deadline')::timestamptz = (v_el ->> 'refundable_until')::timestamptz,
    'T4', '일부 사용 + 기간 안도 막음(마감 같음)');
  PERFORM pg_temp.expect(pg_temp.try_request(v_user, 'screen', v_user), 'ERR MEMBER_WITHDRAW_REFUND_PERIOD_OPEN', 'T4', '일부 사용 + 기간 안 요청 거절');
  UPDATE public.payment_orders SET approved_at = now() - interval '20 days' WHERE id = (v_paid ->> 'order_id')::uuid;
  UPDATE public.credit_sources SET created_at = now() - interval '20 days' WHERE id = v_src;
  v_f := public.member_withdrawal_facts(v_user, true);
  PERFORM pg_temp.check(jsonb_array_length(v_f -> 'refundPeriodOpen') = 0 AND (v_f ->> 'requestAllowed')::boolean, 'T4', '기간+여유가 지나면 요청 가능');
  PERFORM pg_temp.expect(pg_temp.try_request(v_user, 'screen', v_user), 'OK', 'T4', '기간 지난 뒤 요청');
END $rh_t4$;

-- T5: 스스로 탈퇴 경우별
DO $rh_t5$
DECLARE
  v_owner uuid := pg_temp.ctx('owner')::uuid;
  v_user uuid;
  v_order uuid;
  v_fp_order text;
  v_fp_attempt text;
  v_f jsonb;
  v_res text;
  v_mul text;
  v_mid text;
BEGIN
  SELECT payapp_merchant_id INTO v_mid FROM public.payment_runtime_config WHERE id = true;
  -- a. 결제 시도만 + 낡은 claimed(318f9d38 형태: 주문 failed, 시도 claimed)
  v_user := pg_temp.new_user('t5a');
  v_order := pg_temp.new_order(v_user, 'failed', now() - interval '10 days', NULL, 9900, 10000, 'claimed');
  PERFORM pg_temp.new_order(v_user, 'failed', now() - interval '9 days', NULL, 9900, 10000, 'claimed');
  SELECT request_fingerprint INTO v_fp_order FROM public.payment_orders WHERE id = v_order;
  SELECT a.request_fingerprint INTO v_fp_attempt FROM public.checkout_attempts a WHERE a.payment_order_id = v_order;
  v_f := public.member_withdrawal_facts(v_user, true);
  PERFORM pg_temp.check(NOT (v_f ->> 'hadPayment')::boolean AND (v_f ->> 'selfAllowed')::boolean AND (v_f ->> 'inProgressTotal')::int = 0
    AND NOT (v_f ->> 'fullDeleteAllowed')::boolean, 'T5', '결제 시도만 + 낡은 claimed: 결제 회원 아님·스스로 가능·완전 삭제 아님');
  v_res := pg_temp.try_self(v_user, true, 'rh10-t5a-' || v_user);
  PERFORM pg_temp.expect(v_res, 'OK', 'T5', '결제 시도만 회원 스스로 익명화');
  PERFORM pg_temp.check((SELECT request_fingerprint FROM public.payment_orders WHERE id = v_order) <> v_fp_order
    AND (SELECT a.request_fingerprint FROM public.checkout_attempts a WHERE a.payment_order_id = v_order) <> v_fp_attempt
    AND NOT EXISTS (SELECT 1 FROM public.payment_orders WHERE user_id = v_user AND request_fingerprint LIKE 'rhfp-%')
    AND NOT EXISTS (SELECT 1 FROM public.checkout_attempts WHERE user_id = v_user AND request_fingerprint LIKE 'rhfp-%')
    AND (SELECT request_fingerprint FROM public.payment_orders WHERE id = v_order) ~ '^[0-9a-f]{64}$',
    'T5', '주문·결제 시도 fingerprint 모두 임의 값(64자)으로 바뀜');
  PERFORM pg_temp.check((SELECT email IS NULL AND phone IS NULL FROM public.withdrawn_member_records WHERE user_id = v_user)
    AND (SELECT method FROM public.withdrawn_member_records WHERE user_id = v_user) = 'self', 'T5', '비결제 보관함: 연락처 보관 안 함, method self');

  -- b. 최근 시도
  v_user := pg_temp.new_user('t5b');
  PERFORM pg_temp.new_order(v_user, 'expired', now() - interval '1 day', NULL, 9900, 10000, 'expired');
  PERFORM pg_temp.expect(pg_temp.try_self(v_user, true, 'rh10-t5b'), 'ERR MEMBER_WITHDRAW_SELF_NOT_ALLOWED', 'T5', '최근 결제 시도(7일 안)는 스스로 불가');
  v_f := public.member_withdrawal_facts(v_user, true);
  PERFORM pg_temp.check(v_f -> 'selfReasons' ? 'RECENT_PAYMENT_ACTIVITY' AND (v_f ->> 'quietUntil')::timestamptz > now(), 'T5', '이유 RECENT_PAYMENT_ACTIVITY, 가능 예정일 quietUntil');

  -- c. 돈이 오간 주문
  v_user := pg_temp.new_user('t5c');
  PERFORM pg_temp.paid(v_user, 40);
  PERFORM pg_temp.expect(pg_temp.try_self(v_user, true, 'rh10-t5c'), 'ERR MEMBER_WITHDRAW_SELF_NOT_ALLOWED', 'T5', '돈이 오간 주문 → 스스로 불가(결제 회원)');

  -- d. 지급 전 취소(canceled_at)
  v_user := pg_temp.new_user('t5d');
  v_order := pg_temp.new_order(v_user, 'failed', now() - interval '20 days', pg_temp.mul(), 9900, 10000, 'cancelled');
  UPDATE public.payment_orders SET canceled_at = now() - interval '20 days', failure_code = 'PAYAPP_CANCELLED_BEFORE_FULFILLMENT' WHERE id = v_order;
  UPDATE public.payment_provider_transactions SET cancel_feedback_recorded_at = now() - interval '20 days', cancel_processed_at = now() - interval '20 days',
         provider_status = '9' WHERE payment_order_id = v_order;
  v_f := public.member_withdrawal_facts(v_user, true);
  PERFORM pg_temp.check((v_f ->> 'hadPayment')::boolean AND v_f -> 'hadPaymentReasons' ? 'MONEY_ORDER', 'T5', '지급 전 취소 → 결제 회원');

  -- e. 페이앱 요청 미확인 두 종류
  v_user := pg_temp.new_user('t5e1');
  v_order := pg_temp.new_order(v_user, 'expired', now() - interval '20 days', pg_temp.mul(), 9900, 10000, 'expired');
  UPDATE public.payment_orders SET failure_code = 'PAYAPP_REQUEST_OUTCOME_EXPIRED' WHERE id = v_order;
  UPDATE public.payment_provider_transactions SET provider_status = '1' WHERE payment_order_id = v_order;
  PERFORM pg_temp.expect(pg_temp.try_self(v_user, true, 'rh10-t5e1'), 'ERR MEMBER_WITHDRAW_PROVIDER_UNVERIFIED', 'T5', '요청 결과 미확인(OUTCOME_EXPIRED) → 스스로 불가');
  PERFORM pg_temp.ctx_set('t5_unverified_user', v_user::text);
  v_user := pg_temp.new_user('t5e2');
  v_order := pg_temp.new_order(v_user, 'expired', now() - interval '20 days', pg_temp.mul(), 9900, 10000, 'expired');
  UPDATE public.payment_orders SET failure_code = 'PAYAPP_READY_CANCEL_FAILED' WHERE id = v_order;
  PERFORM pg_temp.expect(pg_temp.try_self(v_user, true, 'rh10-t5e2'), 'ERR MEMBER_WITHDRAW_PROVIDER_UNVERIFIED', 'T5', '요청 취소 실패(READY_CANCEL_FAILED) → 스스로 불가');
  UPDATE public.payment_provider_transactions SET provider_status = '16' WHERE payment_order_id = v_order;
  PERFORM pg_temp.expect(pg_temp.try_self(v_user, true, 'rh10-t5e2b'), 'OK', 'T5', '페이앱 상태가 요청 취소(16)로 확인되면 스스로 가능');

  -- f. 옛 결제 내역만
  v_user := pg_temp.new_user('t5f');
  INSERT INTO public.payment_history (user_id, amount, payment_method, status, created_at) VALUES (v_user, 1000, 'test', 'completed', now() - interval '400 days');
  PERFORM pg_temp.expect(pg_temp.try_self(v_user, true, 'rh10-t5f'), 'ERR MEMBER_WITHDRAW_SELF_NOT_ALLOWED', 'T5', '옛 결제 내역(amount > 0)만 있어도 결제 회원');

  -- g. plan_purchase 원천만
  v_user := pg_temp.new_user('t5g');
  INSERT INTO public.credit_sources (user_id, initial_credits, remaining_credits, status, source_category, purchased_at, expires_at, created_at)
  VALUES (v_user, 100, 0, 'active', 'plan_purchase', now() - interval '400 days', now() - interval '35 days', now() - interval '400 days');
  v_f := public.member_withdrawal_facts(v_user, true);
  PERFORM pg_temp.check(v_f -> 'hadPaymentReasons' ? 'PLAN_PURCHASE_SOURCE', 'T5', 'plan_purchase 원천만 → 결제 회원');
  PERFORM pg_temp.expect(pg_temp.try_self(v_user, true, 'rh10-t5g'), 'ERR MEMBER_WITHDRAW_SELF_NOT_ALLOWED', 'T5', 'plan_purchase 원천만 → 스스로 불가');

  -- h. 검증 실패 통보 뒤 unpaid_confirmed
  v_user := pg_temp.new_user('t5h');
  v_mul := pg_temp.mul();
  v_order := pg_temp.new_order(v_user, 'ready_unknown', now() - interval '20 days', v_mul);
  PERFORM public.apply_payapp_feedback(v_mid, v_mul, NULL, (SELECT order_id FROM public.payment_orders WHERE id = v_order), 4, 1, NULL, 1, now(), NULL);
  PERFORM pg_temp.check((SELECT status || ':' || failure_code FROM public.payment_orders WHERE id = v_order) = 'manual_review:PAYAPP_FEEDBACK_MISMATCH', 'T5', '금액 다른 결제완료 통보 → 검증 실패');
  PERFORM public.resolve_payment_order_review(v_order, 'unpaid_confirmed', v_owner, 'RH10 미결제 확인', NULL, NULL, NULL);
  UPDATE public.payment_orders SET created_at = now() - interval '20 days' WHERE id = v_order;
  v_f := public.member_withdrawal_facts(v_user, true);
  PERFORM pg_temp.check((v_f ->> 'hadPayment')::boolean AND v_f -> 'hadPaymentReasons' ? 'FEEDBACK_VERIFICATION_FAILED'
    AND v_f -> 'hadPaymentReasons' ? 'PAYMENT_ADMIN_ACTION', 'T5', '검증 실패 뒤 unpaid_confirmed 주문 → 결제 회원(검증 실패·관리자 처리)');

  -- i. selfAnonymizeEnabled = false
  v_user := pg_temp.new_user('t5i');
  BEGIN
    UPDATE public.system_settings SET value = jsonb_set(value, '{selfAnonymizeEnabled}', 'false'::jsonb) WHERE key = 'member_withdrawal_policy';
    v_res := pg_temp.try_self(v_user, true, 'rh10-t5i');
    RAISE EXCEPTION 'rh_undo';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'rh_undo' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.expect(v_res, 'ERR MEMBER_WITHDRAW_SELF_NOT_ALLOWED', 'T5', 'selfAnonymizeEnabled=false 거절');
  BEGIN
    UPDATE public.system_settings SET value = value - 'selfAnonymizeEnabled' WHERE key = 'member_withdrawal_policy';
    v_f := public.member_withdrawal_facts(v_user, true);
    RAISE EXCEPTION 'rh_undo';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'rh_undo' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.check(v_f -> 'selfReasons' ? 'DISABLED' AND NOT (v_f ->> 'selfAnonymizeEnabled')::boolean, 'T5', '키가 없으면 꺼짐으로 봄 ' || COALESCE(v_f ->> 'selfReasons', 'NULL') || ' / ' || COALESCE(v_f ->> 'selfAnonymizeEnabled', 'NULL'));

  -- 실제 회원 318f9d38(읽기만): 판정 결과 기록
  v_f := public.member_withdrawal_facts('318f9d38-5ed4-4067-8e31-6b656c409492'::uuid, true);
  PERFORM pg_temp.ok('T5', '실제 회원 318f9d38 판정(읽기만): hadPayment=' || (v_f ->> 'hadPayment') || ', inProgress=' || (v_f ->> 'inProgressTotal')
    || ', selfReasons=' || (v_f ->> 'selfReasons') || ', fullDelete=' || (v_f ->> 'fullDeleteAllowed'));
END $rh_t5$;

-- T6: 관리자·비대표·요청 오류·비결제 email 요청 처리·대리인 요청·페이앱 미확인 대표 확인
DO $rh_t6$
DECLARE
  v_owner uuid := pg_temp.ctx('owner')::uuid;
  v_staff uuid := pg_temp.ctx('staff')::uuid;
  v_user uuid;
  v_user2 uuid;
  v_paid jsonb;
  v_req text;
  v_req2 text;
  v_res text;
  v_t uuid;
BEGIN
  PERFORM pg_temp.expect(pg_temp.try_request(v_staff, 'email', v_owner), 'ERR MEMBER_WITHDRAW_ADMIN', 'T6', '관리자 계정 요청 거절');
  PERFORM pg_temp.expect(pg_temp.try_self(v_staff, true, 'rh10-t6-admin'), 'ERR MEMBER_WITHDRAW_ADMIN', 'T6', '관리자 계정 스스로 익명화 거절');

  v_user := pg_temp.new_user('t6');
  v_paid := pg_temp.paid(v_user, 40);
  PERFORM pg_temp.expect(pg_temp.try_request(v_user, 'email', v_staff), 'ERR MEMBER_WITHDRAW_ACTOR_NOT_OWNER', 'T6', '직원은 email 요청 기록 불가');
  v_req := pg_temp.try_request(v_user, 'screen', v_user);
  PERFORM pg_temp.expect(v_req, 'OK', 'T6', '결제 회원 요청');
  PERFORM pg_temp.expect(pg_temp.try_request(v_user, 'screen', v_user), 'ERR MEMBER_WITHDRAW_REQUEST_EXISTS', 'T6', 'pending 1건 제한');
  PERFORM pg_temp.expect(pg_temp.try_anon(v_staff, v_user, 'owner', pg_temp.req_id(v_req), NULL, NULL, false, NULL, 'rh10-t6-staff', NULL, true),
    'ERR MEMBER_WITHDRAW_ACTOR_NOT_OWNER', 'T6', '비대표 익명화 거절');
  PERFORM pg_temp.expect(pg_temp.try_anon(v_owner, v_user, 'owner', NULL, NULL, NULL, false, NULL, 'rh10-t6-noreq', NULL, true),
    'ERR MEMBER_WITHDRAW_REQUEST_INVALID', 'T6', '대표 경로는 요청이 있어야 함');
  v_user2 := pg_temp.new_user('t6b');
  PERFORM pg_temp.paid(v_user2, 40);
  PERFORM pg_temp.expect(pg_temp.try_anon(v_owner, v_user2, 'owner', pg_temp.req_id(v_req), NULL, NULL, false, NULL, 'rh10-t6-other', NULL, true),
    'ERR MEMBER_WITHDRAW_REQUEST_INVALID', 'T6', '남의 요청으로 처리 거절');
  -- 동의보다 큰 소멸: 요청 뒤 유료 잔량이 늘어남(시험용 직접 수정)
  UPDATE public.credit_sources SET remaining_credits = remaining_credits WHERE id = (v_paid ->> 'source_id')::uuid;
  PERFORM pg_temp.use_credits((v_paid ->> 'source_id')::uuid, 100);
  PERFORM public.cancel_member_withdrawal_request(v_user, pg_temp.req_id(v_req));
  v_req := pg_temp.try_request(v_user, 'screen', v_user);
  UPDATE public.credit_sources SET remaining_credits = remaining_credits + 100 WHERE id = (v_paid ->> 'source_id')::uuid;
  PERFORM pg_temp.expect(pg_temp.try_anon(v_owner, v_user, 'owner', pg_temp.req_id(v_req), NULL, NULL, false, NULL, 'rh10-t6-bigger', NULL, true),
    'ERR MEMBER_WITHDRAW_BALANCE_CHANGED', 'T6', '동의(9,900)보다 큰 소멸(10,000) 거절');
  PERFORM public.cancel_member_withdrawal_request(v_user, pg_temp.req_id(v_req));

  -- email 경로 유료 소멸인데 고지 발송·회신 기록 없음 → 거절, 기록하면 처리
  v_req := pg_temp.try_request(v_user, 'email', v_owner, NULL, 'self', '가입 이메일에서 보낸 요청 확인');
  PERFORM pg_temp.expect(v_req, 'OK', 'T6', 'email 요청 기록(대표)');
  PERFORM pg_temp.expect(pg_temp.try_anon(v_owner, v_user, 'owner', pg_temp.req_id(v_req), NULL, NULL, false, NULL, 'rh10-t6-email', NULL, true),
    'ERR MEMBER_WITHDRAW_REQUEST_INVALID', 'T6', 'email 경로 유료 소멸인데 회신 기록 없음 → 거절');
  PERFORM pg_temp.expect('OK ' || public.record_member_withdrawal_request_reply(v_owner, pg_temp.req_id(v_req), now() - interval '2 hours', now() - interval '1 hour', NULL)::text,
    'OK', 'T6', '고지 발송·동의 회신 시각 기록');
  PERFORM pg_temp.expect(pg_temp.try_anon(v_owner, v_user, 'owner', pg_temp.req_id(v_req), NULL, NULL, false, NULL, 'rh10-t6-email', NULL, true),
    'OK', 'T6', '회신 기록 뒤 email 요청 처리');

  -- 비결제 회원 email 요청 처리(회신 없음 → 문의 삭제 기본)
  v_user := pg_temp.new_user('t6n');
  v_t := pg_temp.new_ticket(v_user, 'RH10 비결제 문의', '내용', 'resolved', 'etc', now() - interval '20 days');
  v_req := pg_temp.try_request(v_user, 'phone', v_owner, NULL, 'self', '전화 본인 확인(가입 정보 대조)');
  PERFORM pg_temp.expect(v_req, 'OK', 'T6', '비결제 회원 전화 요청 기록');
  PERFORM pg_temp.expect(pg_temp.try_anon(v_owner, v_user, 'owner', pg_temp.req_id(v_req), NULL, NULL, false, NULL, 'rh10-t6n', true, true),
    'ERR MEMBER_WITHDRAW_REQUEST_INVALID', 'T6', '비결제 대표 경로: 문의 보존 선택이 요청 값과 다르면 거절');
  v_res := pg_temp.try_anon(v_owner, v_user, 'owner', pg_temp.req_id(v_req), NULL, NULL, false, NULL, 'rh10-t6n', NULL, true);
  PERFORM pg_temp.expect(v_res, 'OK', 'T6', '비결제 회원 전화 요청 처리');
  PERFORM pg_temp.check(NOT (pg_temp.res(v_res) ->> 'ticketsRetained')::boolean AND NOT EXISTS (SELECT 1 FROM public.support_tickets WHERE id = v_t),
    'T6', '회신 없음 → 문의 보존 동의 안 함(삭제) 기본값');

  -- 대리인 요청(위임 대리인, 유료 소멸 → 고지·회신 함께 기록)
  v_user := pg_temp.new_user('t6a');
  PERFORM pg_temp.paid(v_user, 40);
  v_req := pg_temp.try_request(v_user, 'email', v_owner, NULL, 'agent', '위임장 확인함(내용 미기재)', now() - interval '3 hours', now() - interval '1 hour');
  PERFORM pg_temp.expect(v_req, 'OK', 'T6', '위임 대리인 email 요청(고지 발송·회신 함께)');
  PERFORM pg_temp.check((SELECT requester_kind FROM public.member_withdrawal_requests WHERE id = pg_temp.req_id(v_req)) = 'agent', 'T6', '요청자 종류 agent 기록');
  PERFORM pg_temp.expect(pg_temp.try_anon(v_owner, v_user, 'owner', pg_temp.req_id(v_req), NULL, NULL, false, NULL, 'rh10-t6a', NULL, true),
    'OK', 'T6', '대리인 요청 처리');

  -- 페이앱 미확인: 대표 경로는 확인 체크를 받아야 처리
  v_user := pg_temp.ctx('t5_unverified_user')::uuid;
  v_req := pg_temp.try_request(v_user, 'email', v_owner, true);
  PERFORM pg_temp.expect(v_req, 'OK', 'T6', '페이앱 미확인 비결제 회원 email 요청');
  PERFORM pg_temp.expect(pg_temp.try_anon(v_owner, v_user, 'owner', pg_temp.req_id(v_req), NULL, NULL, false, NULL, 'rh10-t6u', NULL, true),
    'ERR MEMBER_WITHDRAW_PROVIDER_UNVERIFIED', 'T6', '확인 체크 없으면 거절');
  PERFORM pg_temp.expect(pg_temp.try_anon(v_owner, v_user, 'owner', pg_temp.req_id(v_req), NULL, NULL, true, NULL, 'rh10-t6u', NULL, true),
    'OK', 'T6', '"페이앱 판매자 화면에서 결제 없음 확인" 체크 뒤 처리');
  PERFORM pg_temp.check((SELECT provider_unverified_confirmed FROM public.withdrawn_member_records WHERE user_id = v_user), 'T6', '보관함 provider_unverified_confirmed');
END $rh_t6$;

-- T7: 탈퇴 회원 결제(apply·retry·resolve) 보류, 보류 주문 닫기 3방식, 판매 플래그, 닫은 뒤 재통보·취소 통보, 부분취소 뒤 닫기
-- 대체 경로 시험용: 지정한 주문의 거래 기록 UPDATE 를 한 번만 실패시킨다(시퀀스는 롤백되지 않으므로 서브블록이 되돌려도 다음 UPDATE 는 통과).
CREATE SEQUENCE pg_temp.rh_fail_seq;
CREATE FUNCTION pg_temp.rh_fail_ppt_once() RETURNS trigger LANGUAGE plpgsql AS $rh_fail$
BEGIN
  IF NEW.payment_order_id::text = current_setting('rh.fail_order', true) AND nextval('pg_temp.rh_fail_seq') = 1 THEN
    RAISE EXCEPTION 'RH_INJECTED_FAILURE';
  END IF;
  RETURN NEW;
END $rh_fail$;
CREATE TRIGGER rh_fail_ppt_once BEFORE UPDATE ON public.payment_provider_transactions
  FOR EACH ROW EXECUTE FUNCTION pg_temp.rh_fail_ppt_once();
CREATE FUNCTION pg_temp.rh_fail_next(p_order uuid) RETURNS void LANGUAGE plpgsql AS $rh_fail_next$
BEGIN
  PERFORM setval('pg_temp.rh_fail_seq', 1, false);
  PERFORM set_config('rh.fail_order', p_order::text, true);
END $rh_fail_next$;

DO $rh_t7$
DECLARE
  v_owner uuid := pg_temp.ctx('owner')::uuid;
  v_user uuid := pg_temp.ctx('t1_user')::uuid;
  v_mid text;
  v_o2 uuid; v_o3 uuid; v_o4 uuid; v_o5 uuid; v_o6 uuid; v_o7 uuid; v_o8 uuid; v_o9 uuid; v_o10 uuid;
  v_m2 text; v_m3 text; v_m4 text; v_m5 text; v_m6 text; v_m7 text; v_m8 text; v_m9 text; v_m10 text;
  v_state text;
  v_key text;
  v_r jsonb;
  v_res text;
  v_b jsonb;
  v_base jsonb;
  v_n integer;
  v_alerts integer;
  v_flag_test boolean;
BEGIN
  SELECT payapp_merchant_id INTO v_mid FROM public.payment_runtime_config WHERE id = true;
  -- 판매 플래그 시험: 거래 안에서 스케줄러를 건강하게 하고 판매를 켠 뒤 기준값을 본다
  UPDATE public.payment_reconciliation_scheduler SET last_started_at = now(), last_succeeded_at = now(), consecutive_failures = 0 WHERE id = 1;
  UPDATE public.payment_runtime_config SET master_accepts_new_orders = true, payapp_accepts_new_orders = true WHERE id = true;
  v_base := public.payapp_sales_resume_blockers();
  v_flag_test := (v_base ->> 'paid_unfulfilled_count')::int = 0 AND (v_base ->> 'money_review_count')::int = 0
    AND (v_base ->> 'cancel_unprocessed_active_count')::int = 0 AND NOT (v_base ->> 'scheduler_unhealthy')::boolean;
  PERFORM pg_temp.ok('T7', '판매 재개 조건 기준값(시험 주문 전): ' || v_base::text);

  -- (1) 웹훅 결제완료(apply) → 보류
  v_m2 := pg_temp.mul();
  v_o2 := pg_temp.new_order(v_user, 'ready_unknown', now(), v_m2);
  SELECT order_id INTO v_key FROM public.payment_orders WHERE id = v_o2;
  -- 결제완료 표식은 한 번만 쓸 수 있어(표식 가드) 10분 지난 시각을 먼저 넣고 통보를 반영한다.
  UPDATE public.payment_provider_transactions SET paid_feedback_recorded_at = now() - interval '20 minutes' WHERE payment_order_id = v_o2;
  v_r := public.apply_payapp_feedback(v_mid, v_m2, NULL, v_key, 4, 9900, NULL, 1, now(), NULL);
  PERFORM pg_temp.check(v_r ->> 'result' = 'withdrawn_member_hold'
    AND (SELECT status || ':' || failure_code FROM public.payment_orders WHERE id = v_o2) = 'manual_review:PAYMENT_FOR_WITHDRAWN_MEMBER'
    AND (SELECT source_id FROM public.payment_orders WHERE id = v_o2) IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.credit_sources WHERE payment_order_id = v_o2),
    'T7', 'apply 결제완료 → withdrawn_member_hold, 주문 manual_review·PAYMENT_FOR_WITHDRAWN_MEMBER, 지급 없음');
  v_r := public.apply_payapp_feedback(v_mid, v_m2, NULL, v_key, 4, 9900, NULL, 1, now(), NULL);
  SELECT count(*) INTO v_n FROM public.withdrawn_member_record_events WHERE user_id = v_user AND kind = 'late_payment' AND ref_id = v_o2;
  SELECT count(*) INTO v_alerts FROM public.payment_reconciliation_alerts WHERE code = 'PAYMENT_FOR_WITHDRAWN_MEMBER' AND resolved_at IS NULL
     AND details ->> 'order_payment_order_id' = v_o2::text AND details ->> 'dedupe_key' = 'withdrawn_member_payment:' || v_o2 AND details ->> 'user_id' = v_user::text;
  PERFORM pg_temp.check(v_r ->> 'result' = 'withdrawn_member_hold' AND v_n = 1 AND v_alerts = 1
    AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = v_user), 'T7', '같은 통보 반복 → 늦은 결제 기록 1건·경보 1건, 알림 없음');

  -- (2) 지급 재시도(retry) → 보류
  v_m3 := pg_temp.mul();
  v_o3 := pg_temp.new_order(v_user, 'fulfillment_pending', now(), v_m3);
  UPDATE public.payment_provider_transactions SET paid_feedback_recorded_at = now() - interval '20 minutes', paid_amount = 9900, provider_status = '4' WHERE payment_order_id = v_o3;
  v_r := public.retry_payapp_fulfillment(v_o3);
  PERFORM pg_temp.check(v_r ->> 'result' = 'withdrawn_member_hold' AND (SELECT status FROM public.payment_orders WHERE id = v_o3) = 'manual_review'
    AND EXISTS (SELECT 1 FROM public.withdrawn_member_record_events WHERE kind = 'late_payment' AND ref_id = v_o3), 'T7', 'retry → withdrawn_member_hold·늦은 결제 기록');

  -- (3) 수동 결제확인(resolve) → 거절(검증 실패 주문도)
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.resolve_payment_order_review(%L, %L, %L, %L)', v_o2, 'paid_confirmed', v_owner, 'RH10')),
    'ERR PAYMENT_REVIEW_MEMBER_WITHDRAWN', 'T7', '보류 주문 paid_confirmed 거절');
  v_m4 := pg_temp.mul();
  v_o4 := pg_temp.new_order(v_user, 'ready_unknown', now(), v_m4);
  SELECT order_id INTO v_key FROM public.payment_orders WHERE id = v_o4;
  PERFORM public.apply_payapp_feedback(v_mid, v_m4, NULL, v_key, 4, 1, NULL, 1, now(), NULL);
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.resolve_payment_order_review(%L, %L, %L, %L, %L)', v_o4, 'paid_confirmed', v_owner, 'RH10', v_m4)),
    'ERR PAYMENT_REVIEW_MEMBER_WITHDRAWN', 'T7', '탈퇴 회원 검증 실패 주문 paid_confirmed 거절');
  PERFORM public.resolve_payment_order_review(v_o4, 'unpaid_confirmed', v_owner, 'RH10 미결제', NULL, NULL, NULL);

  -- 10분 넘게 미지급 → 자동 점검이 판매를 끈다(의도한 동작)
  v_b := public.payapp_sales_resume_blockers();
  PERFORM pg_temp.check((v_b ->> 'paid_unfulfilled_count')::int = (v_base ->> 'paid_unfulfilled_count')::int + 2, 'T7', '보류 주문 2건은 판매 재개 차단(미지급)');
  IF v_flag_test THEN
    PERFORM public.enforce_payment_reconciliation_health();
    PERFORM pg_temp.check(NOT (SELECT payapp_accepts_new_orders FROM public.payment_runtime_config WHERE id = true), 'T7', '자동 점검 실행 → 페이앱 판매 꺼짐');
  END IF;

  -- (가) 계좌 송금으로 닫기
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.close_withdrawn_member_held_order(%L, %L, %L, %L, %L)', v_owner, v_o2, 'bank_transfer', '  ', 'k')),
    'ERR MEMBER_WITHDRAW_INPUT_INVALID', 'T7', '메모 없으면 입구에서 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.close_withdrawn_member_held_order(%L, %L, %L, %L, %L)', pg_temp.ctx('staff'), v_o2, 'bank_transfer', 'RH10', 'k')),
    'ERR MEMBER_WITHDRAW_ACTOR_NOT_OWNER', 'T7', '직원은 닫기 불가');
  v_r := public.close_withdrawn_member_held_order(v_owner, v_o2, 'bank_transfer', 'RH10 송금 완료', 'rh10-close-o2');
  PERFORM pg_temp.check((v_r ->> 'closed')::boolean AND (SELECT status FROM public.payment_orders WHERE id = v_o2) = 'failed'
    AND (SELECT canceled_at IS NOT NULL FROM public.payment_orders WHERE id = v_o2)
    AND EXISTS (SELECT 1 FROM public.payment_admin_actions WHERE payment_order_id = v_o2 AND action = 'withdrawn_held_order_closed' AND external_method = 'bank_transfer')
    AND EXISTS (SELECT 1 FROM public.withdrawn_member_record_events WHERE kind = 'held_order_closed' AND ref_id = v_o2)
    AND NOT EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts WHERE code = 'PAYMENT_FOR_WITHDRAWN_MEMBER' AND resolved_at IS NULL AND details ->> 'order_payment_order_id' = v_o2::text),
    'T7', '(가) bank_transfer 닫기: failed·canceled_at·작업 기록·닫기 기록·경보 해소');
  PERFORM pg_temp.check((public.close_withdrawn_member_held_order(v_owner, v_o2, 'bank_transfer', 'RH10 다시', 'rh10-close-o2b') ->> 'replay')::boolean,
    'T7', '닫은 주문 다시 닫기는 replay');
  -- (나) 페이앱 취소 요청으로 닫기: 통보 전 거절 → 취소 통보 처리 뒤 닫기
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.close_withdrawn_member_held_order(%L, %L, %L, %L, %L)', v_owner, v_o3, 'payapp_cancel_request', 'RH10', 'rh10-close-o3')),
    'ERR MEMBER_HELD_ORDER_CANCEL_PENDING', 'T7', '(나) 취소 통보 전 payapp_cancel_request 닫기 거절');
  PERFORM public.apply_payapp_feedback(v_mid, v_m3, NULL, NULL, 9, 9900, NULL, 1, NULL, now());
  v_r := public.process_payapp_cancellation(v_o3);
  PERFORM pg_temp.check(v_r ->> 'result' = 'cancelled_before_fulfillment' AND (SELECT status FROM public.payment_orders WHERE id = v_o3) = 'failed', 'T7', '보류 주문 취소 통보 처리 → failed');
  -- (e1) 취소 처리 뒤 닫기 전에 검증 실패 통보(금액 다름) → 아직 닫지 않은 보류 주문도 failed 유지, 경보만
  SELECT order_id, status || ':' || failure_code INTO v_key, v_state FROM public.payment_orders WHERE id = v_o3;
  v_b := public.payapp_sales_resume_blockers();
  v_r := public.apply_payapp_feedback(v_mid, v_m3, NULL, v_key, 4, 1, NULL, 1, now(), NULL);
  PERFORM pg_temp.check(v_r ->> 'result' = 'ignored'
    AND NOT EXISTS (SELECT 1 FROM public.withdrawn_member_record_events WHERE kind = 'held_order_closed' AND ref_id = v_o3)
    AND (SELECT status || ':' || failure_code FROM public.payment_orders WHERE id = v_o3) = v_state AND v_state LIKE 'failed:%'
    AND EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts WHERE code = 'WITHDRAWN_HELD_ORDER_FEEDBACK_MISMATCH' AND resolved_at IS NULL
                 AND details ->> 'payment_order_id' = v_o3::text AND details ->> 'reason' = 'PAYAPP_FEEDBACK_AMOUNT_MISMATCH')
    AND (public.payapp_sales_resume_blockers() ->> 'money_review_count')::int = (v_b ->> 'money_review_count')::int,
    'T7', '(e1) 취소 처리 뒤 닫기 전 검증 실패 통보 → failed 유지(' || v_state || ')·판매 재개 조건 변화 없음, WITHDRAWN_HELD_ORDER_FEEDBACK_MISMATCH 경보만');
  v_r := public.close_withdrawn_member_held_order(v_owner, v_o3, 'payapp_cancel_request', 'RH10 페이앱 취소', 'rh10-close-o3');
  PERFORM pg_temp.check((v_r ->> 'closed')::boolean, 'T7', '(나) 취소 통보 뒤 payapp_cancel_request 로 닫기');
  -- (나') 판매자 화면 취소로 닫기 + 닫은 뒤 같은 취소 통보 → 경보 없음
  v_m5 := pg_temp.mul();
  v_o5 := pg_temp.new_order(v_user, 'ready_unknown', now(), v_m5);
  SELECT order_id INTO v_key FROM public.payment_orders WHERE id = v_o5;
  PERFORM public.apply_payapp_feedback(v_mid, v_m5, NULL, v_key, 4, 9900, NULL, 1, now(), NULL);
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.close_withdrawn_member_held_order(%L, %L, %L, %L, %L)', v_owner, v_o5, 'provider_admin_cancel', 'RH10', 'rh10-close-o5')),
    'ERR MEMBER_HELD_ORDER_CANCEL_PENDING', 'T7', '통보 전 provider_admin_cancel 닫기 거절');
  PERFORM public.apply_payapp_feedback(v_mid, v_m5, NULL, NULL, 9, 9900, NULL, 1, NULL, now());
  PERFORM public.process_payapp_cancellation(v_o5);
  PERFORM public.close_withdrawn_member_held_order(v_owner, v_o5, 'provider_admin_cancel', 'RH10 판매자 화면 취소', 'rh10-close-o5');
  SELECT count(*) INTO v_alerts FROM public.payment_reconciliation_alerts WHERE details ->> 'payment_order_id' = v_o5::text OR details ->> 'order_payment_order_id' = v_o5::text;
  PERFORM public.apply_payapp_feedback(v_mid, v_m5, NULL, NULL, 9, 9900, NULL, 1, NULL, now());
  v_r := public.process_payapp_cancellation(v_o5);
  PERFORM pg_temp.check(v_r ->> 'result' = 'nothing_to_process'
    AND (SELECT count(*) FROM public.payment_reconciliation_alerts WHERE details ->> 'payment_order_id' = v_o5::text OR details ->> 'order_payment_order_id' = v_o5::text) = v_alerts,
    'T7', 'provider_admin_cancel 로 닫은 뒤 취소 통보 → 경보 없음');

  -- 닫은 뒤 같은 결제완료(4) 재통보 → 상태·실패 코드 유지, 대사 대상 아님, 경보 변화 없음
  SELECT count(*) INTO v_alerts FROM public.payment_reconciliation_alerts WHERE resolved_at IS NULL;
  SELECT order_id INTO v_key FROM public.payment_orders WHERE id = v_o2;
  v_r := public.apply_payapp_feedback(v_mid, v_m2, NULL, v_key, 4, 9900, NULL, 1, now(), NULL);
  PERFORM pg_temp.check(v_r ->> 'result' = 'withdrawn_member_hold' AND (v_r ->> 'closed')::boolean
    AND (SELECT status || ':' || failure_code FROM public.payment_orders WHERE id = v_o2) = 'failed:PAYMENT_FOR_WITHDRAWN_MEMBER'
    AND (SELECT next_reconcile_at FROM public.payment_orders WHERE id = v_o2) IS NULL
    AND (SELECT count(*) FROM public.payment_reconciliation_alerts WHERE resolved_at IS NULL) = v_alerts,
    'T7', '닫은 주문 결제완료 재통보 → withdrawn_member_hold(closed), failed·실패 코드 유지, 대사 대상 아님, 경보 그대로');
  v_r := public.retry_payapp_fulfillment(v_o2);
  PERFORM pg_temp.check(v_r ->> 'result' = 'not_retryable', 'T7', '닫은 주문은 지급 재시도 대상 아님');
  -- (d2) 닫은 주문에 검증 실패 통보(금액 다름) → 다시 열지 않고(failed 유지, 수동 확인 아님) 경보만
  v_b := public.payapp_sales_resume_blockers();
  v_r := public.apply_payapp_feedback(v_mid, v_m2, NULL, v_key, 4, 1, NULL, 1, now(), NULL);
  PERFORM pg_temp.check(v_r ->> 'result' = 'ignored'
    AND (SELECT status || ':' || failure_code FROM public.payment_orders WHERE id = v_o2) = 'failed:PAYMENT_FOR_WITHDRAWN_MEMBER'
    AND (SELECT status FROM public.checkout_attempts WHERE payment_order_id = v_o2) = 'cancelled'
    AND EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts WHERE code = 'WITHDRAWN_HELD_ORDER_FEEDBACK_MISMATCH' AND resolved_at IS NULL
                 AND severity = 'critical' AND details ->> 'payment_order_id' = v_o2::text AND details ->> 'reason' = 'PAYAPP_FEEDBACK_AMOUNT_MISMATCH')
    AND (public.payapp_sales_resume_blockers() ->> 'money_review_count')::int = (v_b ->> 'money_review_count')::int,
    'T7', '(d2) 닫은 보류 주문에 검증 실패 통보 → 주문 failed 유지·결제 시도 그대로·판매 재개 조건 변화 없음, WITHDRAWN_HELD_ORDER_FEEDBACK_MISMATCH 경보만');

  -- 판매 재개 조건·자동 점검: 닫은 주문은 미지급에서 빠진다
  v_b := public.payapp_sales_resume_blockers();
  PERFORM pg_temp.check((v_b ->> 'paid_unfulfilled_count')::int = (v_base ->> 'paid_unfulfilled_count')::int, 'T7', '보류 주문을 닫으면 판매 재개 차단 해제');
  IF v_flag_test THEN
    UPDATE public.payment_runtime_config SET payapp_accepts_new_orders = true WHERE id = true;
    PERFORM public.enforce_payment_reconciliation_health();
    PERFORM pg_temp.check((SELECT payapp_accepts_new_orders FROM public.payment_runtime_config WHERE id = true), 'T7', '닫은 뒤 자동 점검을 실행해도 판매가 다시 꺼지지 않음');
  ELSE
    PERFORM pg_temp.ok('T7', '판매 플래그 시험 생략: 시험 전부터 다른 차단 조건이 있음 ' || v_base::text);
  END IF;

  -- 계좌 송금으로 닫은 뒤 취소 통보 → 이중 환불 의심 경보
  PERFORM public.apply_payapp_feedback(v_mid, v_m2, NULL, NULL, 9, 9900, NULL, 1, NULL, now());
  v_r := public.process_payapp_cancellation(v_o2);
  PERFORM pg_temp.check(v_r ->> 'result' = 'double_refund_suspected'
    AND EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts WHERE code = 'PAYAPP_DOUBLE_REFUND_SUSPECTED' AND severity = 'critical'
                 AND details ->> 'payment_order_id' = v_o2::text AND details ->> 'source' = 'withdrawn_held_order_bank_transfer')
    AND (SELECT status FROM public.payment_orders WHERE id = v_o2) = 'failed',
    'T7', 'bank_transfer 로 닫은 뒤 취소 통보 → PAYAPP_DOUBLE_REFUND_SUSPECTED(source withdrawn_held_order_bank_transfer), 주문 다시 열지 않음');

  -- (다) 부분취소 뒤 닫기: cancel_handled 거절 → 남은 금액 송금으로 닫기 → 늦은 전액 취소 → 이중 환불 경보
  v_m7 := pg_temp.mul();
  v_o7 := pg_temp.new_order(v_user, 'ready_unknown', now(), v_m7);
  SELECT order_id INTO v_key FROM public.payment_orders WHERE id = v_o7;
  PERFORM public.apply_payapp_feedback(v_mid, v_m7, NULL, v_key, 4, 9900, NULL, 1, now(), NULL);
  PERFORM public.apply_payapp_feedback(v_mid, pg_temp.mul(), v_m7, NULL, 70, 3000, 9900, 1, NULL, now());
  v_r := public.process_payapp_cancellation(v_o7);
  PERFORM pg_temp.check(v_r ->> 'result' = 'partial_cancel_unpaid'
    AND (SELECT status || ':' || failure_code FROM public.payment_orders WHERE id = v_o7) = 'manual_review:PAYAPP_PARTIAL_CANCEL', 'T7', '보류 주문 부분취소 → manual_review·PAYAPP_PARTIAL_CANCEL');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.resolve_payment_order_review(%L, %L, %L, %L, NULL, NULL, %L)', v_o7, 'cancel_handled', v_owner, 'RH10', 'bank_transfer')),
    'ERR PAYMENT_REVIEW_MEMBER_WITHDRAWN', 'T7', '탈퇴 회원 보류 주문은 cancel_handled 거절(닫기 함수로)');
  v_r := public.close_withdrawn_member_held_order(v_owner, v_o7, 'bank_transfer', 'RH10 남은 6,900원 송금', 'rh10-close-o7');
  PERFORM pg_temp.check((v_r ->> 'closed')::boolean AND (SELECT status FROM public.payment_orders WHERE id = v_o7) = 'failed', 'T7', '(다) 부분취소 뒤 남은 금액 송금으로 닫기');
  PERFORM public.apply_payapp_feedback(v_mid, v_m7, NULL, NULL, 9, 6900, NULL, 1, NULL, now());
  v_r := public.process_payapp_cancellation(v_o7);
  PERFORM pg_temp.check(v_r ->> 'result' = 'double_refund_suspected'
    AND EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts WHERE code = 'PAYAPP_DOUBLE_REFUND_SUSPECTED' AND details ->> 'payment_order_id' = v_o7::text
                 AND details ->> 'source' = 'withdrawn_held_order_bank_transfer'), 'T7', '부분취소 → 송금 닫기 → 늦은 전액 취소 → 이중 환불 의심 경보');

  -- (d1) 보류 주문에 부분취소 표식이 기록됐지만 처리 전(처리 일시 오류) → 송금 닫기 거절, 처리된 뒤에는 닫힘
  v_m6 := pg_temp.mul();
  v_o6 := pg_temp.new_order(v_user, 'ready_unknown', now(), v_m6);
  SELECT order_id INTO v_key FROM public.payment_orders WHERE id = v_o6;
  PERFORM public.apply_payapp_feedback(v_mid, v_m6, NULL, v_key, 4, 9900, NULL, 1, now(), NULL);
  PERFORM public.apply_payapp_feedback(v_mid, pg_temp.mul(), v_m6, NULL, 70, 3000, 9900, 1, NULL, now());
  PERFORM pg_temp.check((SELECT partial_cancel_feedback_recorded_at IS NOT NULL AND partial_cancel_processed_at IS NULL
                           FROM public.payment_provider_transactions WHERE payment_order_id = v_o6)
    AND (SELECT status || ':' || failure_code FROM public.payment_orders WHERE id = v_o6) = 'manual_review:PAYMENT_FOR_WITHDRAWN_MEMBER',
    'T7', '(d1) 준비: 보류 주문에 부분취소 표식만 기록(처리 전)');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.close_withdrawn_member_held_order(%L, %L, %L, %L, %L)', v_owner, v_o6, 'bank_transfer', 'RH10 전액 송금', 'rh10-close-o6')),
    'ERR MEMBER_HELD_ORDER_CANCEL_PENDING', 'T7', '(d1) 부분취소 표식 미처리 중 bank_transfer 닫기 거절');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM public.withdrawn_member_record_events WHERE kind = 'held_order_closed' AND ref_id = v_o6),
    'T7', '(d1) 거절 때 닫기 기록 없음');
  v_r := public.process_payapp_cancellation(v_o6);
  PERFORM pg_temp.check(v_r ->> 'result' = 'partial_cancel_unpaid', 'T7', '(d1) 부분취소 처리 → partial_cancel_unpaid');
  v_r := public.close_withdrawn_member_held_order(v_owner, v_o6, 'bank_transfer', 'RH10 남은 6,900원 송금', 'rh10-close-o6');
  PERFORM pg_temp.check((v_r ->> 'closed')::boolean AND (SELECT status FROM public.payment_orders WHERE id = v_o6) = 'failed',
    'T7', '(d1) 부분취소 처리된 뒤에는 송금으로 닫힘');

  -- (e2) 취소 처리 실패 대체 경로: 시험용 트리거(rh_fail_ppt_once)가 서브블록 안의 첫 거래 기록 UPDATE 를 한 번 실패시켜 대체 경로를 실제로 태운다.
  --      ① 닫기 전 보류 주문 승인취소 → manual_review·PAYAPP_CANCEL_HANDLING_FAILED → 페이앱 방식으로 닫기(처리 실패 경보도 해소)
  --      ② 페이앱 방식으로 닫은 주문에 부분취소 + 대체 경로 → failed 유지·처리 실패 경보(이중 환불 아님)·다시 닫기 replay
  --      ③ 닫기 전 보류 주문 부분취소 + 대체 경로 → 남은 금액 송금으로 닫기 → 늦은 전액취소 + 대체 경로 → failed 유지·이중 환불 경보
  --      ④ 송금으로 닫은 주문에 부분취소 + 대체 경로 → failed 유지·이중 환불 경보·다시 닫기(송금·페이앱) replay
  v_m8 := pg_temp.mul();
  v_o8 := pg_temp.new_order(v_user, 'ready_unknown', now(), v_m8);
  SELECT order_id INTO v_key FROM public.payment_orders WHERE id = v_o8;
  PERFORM public.apply_payapp_feedback(v_mid, v_m8, NULL, v_key, 4, 9900, NULL, 1, now(), NULL);
  PERFORM public.apply_payapp_feedback(v_mid, v_m8, NULL, NULL, 9, 9900, NULL, 1, NULL, now());
  PERFORM pg_temp.rh_fail_next(v_o8);
  v_r := public.process_payapp_cancellation(v_o8);
  PERFORM pg_temp.check(v_r ->> 'result' = 'cancel_handling_failed'
    AND (SELECT status || ':' || failure_code FROM public.payment_orders WHERE id = v_o8) = 'manual_review:PAYAPP_CANCEL_HANDLING_FAILED'
    AND (SELECT cancel_processed_at IS NOT NULL FROM public.payment_provider_transactions WHERE payment_order_id = v_o8)
    AND EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts WHERE code = 'PAYAPP_CANCEL_HANDLING_FAILED' AND resolved_at IS NULL
                 AND details ->> 'payment_order_id' = v_o8::text),
    'T7', '(e2) ① 준비: 닫기 전 보류 주문 승인취소 + 대체 경로 → manual_review·PAYAPP_CANCEL_HANDLING_FAILED·처리 실패 경보');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.close_withdrawn_member_held_order(%L, %L, %L, %L, %L)', v_owner, v_o8, 'bank_transfer', 'RH10', 'rh10-close-o8b')),
    'ERR MEMBER_HELD_ORDER_STATE_INVALID', 'T7', '(e2) ① 승인취소 뒤 대체 경로 주문은 송금으로 닫지 않음');
  v_r := public.close_withdrawn_member_held_order(v_owner, v_o8, 'payapp_cancel_request', 'RH10 페이앱 취소(대체 경로)', 'rh10-close-o8');
  PERFORM pg_temp.check((v_r ->> 'closed')::boolean AND (SELECT status FROM public.payment_orders WHERE id = v_o8) = 'failed'
    AND EXISTS (SELECT 1 FROM public.withdrawn_member_record_events WHERE kind = 'held_order_closed' AND ref_id = v_o8)
    AND NOT EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts WHERE resolved_at IS NULL
                     AND (details ->> 'payment_order_id' = v_o8::text OR details ->> 'order_payment_order_id' = v_o8::text)),
    'T7', '(e2) ① 대체 경로 주문을 payapp_cancel_request 로 닫기 → failed, 보류 경보·PAYAPP_CANCEL_HANDLING_FAILED 경보 함께 해소');

  PERFORM public.apply_payapp_feedback(v_mid, pg_temp.mul(), v_m8, NULL, 70, 3000, 9900, 1, NULL, now());
  PERFORM pg_temp.rh_fail_next(v_o8);
  v_r := public.process_payapp_cancellation(v_o8);
  PERFORM pg_temp.check(v_r ->> 'result' = 'cancel_handling_failed' AND (v_r ->> 'closed')::boolean
    AND (SELECT status FROM public.payment_orders WHERE id = v_o8) = 'failed'
    AND (SELECT partial_cancel_processed_at IS NOT NULL FROM public.payment_provider_transactions WHERE payment_order_id = v_o8)
    AND EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts WHERE code = 'PAYAPP_CANCEL_HANDLING_FAILED' AND severity = 'critical'
                 AND resolved_at IS NULL AND details ->> 'payment_order_id' = v_o8::text AND (details ->> 'withdrawn_held_order_closed')::boolean
                 AND message = public.member_withdrawal_policy() -> 'texts' ->> 'alertClosedHeldOrderCancelFailed')
    AND NOT EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts WHERE code = 'PAYAPP_DOUBLE_REFUND_SUSPECTED' AND details ->> 'payment_order_id' = v_o8::text),
    'T7', '(e2) ② 페이앱 방식으로 닫은 주문 + 부분취소 대체 경로 → failed 유지·처리 시각·처리 실패 경보(DB 문구), 이중 환불 경보 없음');
  v_r := public.close_withdrawn_member_held_order(v_owner, v_o8, 'payapp_cancel_request', 'RH10 다시 닫기', 'rh10-close-o8c');
  PERFORM pg_temp.check((v_r ->> 'replay')::boolean AND (SELECT status FROM public.payment_orders WHERE id = v_o8) = 'failed'
    AND (SELECT count(*) FROM public.payment_admin_actions WHERE action = 'withdrawn_held_order_closed' AND payment_order_id = v_o8) = 1,
    'T7', '(e2) ② 닫은 주문 다시 닫기는 replay(닫기 조치 1건 유지)');

  v_m9 := pg_temp.mul();
  v_o9 := pg_temp.new_order(v_user, 'ready_unknown', now(), v_m9);
  SELECT order_id INTO v_key FROM public.payment_orders WHERE id = v_o9;
  PERFORM public.apply_payapp_feedback(v_mid, v_m9, NULL, v_key, 4, 9900, NULL, 1, now(), NULL);
  PERFORM public.apply_payapp_feedback(v_mid, pg_temp.mul(), v_m9, NULL, 70, 3000, 9900, 1, NULL, now());
  PERFORM pg_temp.rh_fail_next(v_o9);
  v_r := public.process_payapp_cancellation(v_o9);
  PERFORM pg_temp.check(v_r ->> 'result' = 'cancel_handling_failed'
    AND (SELECT status || ':' || failure_code FROM public.payment_orders WHERE id = v_o9) = 'manual_review:PAYAPP_CANCEL_HANDLING_FAILED'
    AND (SELECT partial_cancel_processed_at IS NOT NULL AND cancel_feedback_recorded_at IS NULL FROM public.payment_provider_transactions WHERE payment_order_id = v_o9),
    'T7', '(e2) ③ 준비: 닫기 전 보류 주문 부분취소 + 대체 경로 → manual_review·PAYAPP_CANCEL_HANDLING_FAILED');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.close_withdrawn_member_held_order(%L, %L, %L, %L, %L)', v_owner, v_o9, 'payapp_cancel_request', 'RH10', 'rh10-close-o9p')),
    'ERR MEMBER_HELD_ORDER_CANCEL_PENDING', 'T7', '(e2) ③ 부분취소만 처리된 대체 경로 주문은 승인취소 전 페이앱 방식으로 닫지 않음');
  v_r := public.close_withdrawn_member_held_order(v_owner, v_o9, 'bank_transfer', 'RH10 남은 6,900원 송금(대체 경로)', 'rh10-close-o9');
  PERFORM pg_temp.check((v_r ->> 'closed')::boolean AND (SELECT status FROM public.payment_orders WHERE id = v_o9) = 'failed'
    AND NOT EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts WHERE resolved_at IS NULL AND code = 'PAYAPP_CANCEL_HANDLING_FAILED'
                     AND details ->> 'payment_order_id' = v_o9::text),
    'T7', '(e2) ③ 부분취소 처리 뒤 대체 경로 주문을 송금으로 닫기 → failed, 처리 실패 경보 해소');
  PERFORM public.apply_payapp_feedback(v_mid, v_m9, NULL, NULL, 9, 6900, NULL, 1, NULL, now());
  PERFORM pg_temp.rh_fail_next(v_o9);
  v_r := public.process_payapp_cancellation(v_o9);
  PERFORM pg_temp.check(v_r ->> 'result' = 'double_refund_suspected' AND v_r ->> 'error_state' IS NOT NULL
    AND (SELECT status FROM public.payment_orders WHERE id = v_o9) = 'failed'
    AND (SELECT cancel_processed_at IS NOT NULL FROM public.payment_provider_transactions WHERE payment_order_id = v_o9)
    AND EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts WHERE code = 'PAYAPP_DOUBLE_REFUND_SUSPECTED' AND severity = 'critical' AND resolved_at IS NULL
                 AND details ->> 'payment_order_id' = v_o9::text AND details ->> 'source' = 'withdrawn_held_order_bank_transfer')
    AND NOT EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts WHERE resolved_at IS NULL AND code = 'PAYAPP_CANCEL_HANDLING_FAILED'
                     AND details ->> 'payment_order_id' = v_o9::text),
    'T7', '(e2) ③ 송금으로 닫은 주문 + 늦은 전액취소 대체 경로 → failed 유지·처리 시각·이중 환불 의심 경보(critical)');

  v_m10 := pg_temp.mul();
  v_o10 := pg_temp.new_order(v_user, 'ready_unknown', now(), v_m10);
  SELECT order_id INTO v_key FROM public.payment_orders WHERE id = v_o10;
  PERFORM public.apply_payapp_feedback(v_mid, v_m10, NULL, v_key, 4, 9900, NULL, 1, now(), NULL);
  v_r := public.close_withdrawn_member_held_order(v_owner, v_o10, 'bank_transfer', 'RH10 9,900원 송금', 'rh10-close-o10');
  PERFORM public.apply_payapp_feedback(v_mid, pg_temp.mul(), v_m10, NULL, 70, 3000, 9900, 1, NULL, now());
  PERFORM pg_temp.rh_fail_next(v_o10);
  v_r := public.process_payapp_cancellation(v_o10);
  PERFORM pg_temp.check(v_r ->> 'result' = 'double_refund_suspected' AND v_r ->> 'error_state' IS NOT NULL
    AND (SELECT status FROM public.payment_orders WHERE id = v_o10) = 'failed'
    AND (SELECT partial_cancel_processed_at IS NOT NULL FROM public.payment_provider_transactions WHERE payment_order_id = v_o10)
    AND EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts WHERE code = 'PAYAPP_DOUBLE_REFUND_SUSPECTED' AND severity = 'critical' AND resolved_at IS NULL
                 AND details ->> 'payment_order_id' = v_o10::text AND details ->> 'source' = 'withdrawn_held_order_bank_transfer'),
    'T7', '(e2) ④ 송금으로 닫은 주문 + 부분취소 대체 경로 → failed 유지·처리 시각·이중 환불 의심 경보');
  v_r := public.close_withdrawn_member_held_order(v_owner, v_o10, 'bank_transfer', 'RH10 남은 금액 송금 시도', 'rh10-close-o10b');
  v_res := public.close_withdrawn_member_held_order(v_owner, v_o10, 'payapp_cancel_request', 'RH10 페이앱 방식 시도', 'rh10-close-o10c') ->> 'replay';
  PERFORM pg_temp.check((v_r ->> 'replay')::boolean AND v_res = 'true'
    AND (SELECT count(*) FROM public.payment_admin_actions WHERE action = 'withdrawn_held_order_closed' AND payment_order_id = v_o10) = 1
    AND (SELECT external_method FROM public.payment_admin_actions WHERE action = 'withdrawn_held_order_closed' AND payment_order_id = v_o10) = 'bank_transfer',
    'T7', '(e2) ④ 송금으로 닫은 주문 다시 닫기(송금·페이앱)는 replay — 추가 송금 기록 없음');
  v_b := public.payapp_sales_resume_blockers();
  PERFORM pg_temp.check((v_b ->> 'money_review_count')::int = (v_base ->> 'money_review_count')::int
    AND (v_b ->> 'paid_unfulfilled_count')::int = (v_base ->> 'paid_unfulfilled_count')::int
    AND (v_b ->> 'cancel_unprocessed_active_count')::int = (v_base ->> 'cancel_unprocessed_active_count')::int,
    'T7', '(e2) 대체 경로를 탄 닫은 주문은 판매 재개 조건(수동 확인·미지급·취소 미처리)에 남지 않음');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM public.credit_sources WHERE payment_order_id IN (v_o2, v_o3, v_o4, v_o5, v_o6, v_o7, v_o8, v_o9, v_o10))
    AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = v_user), 'T7', '모든 경로에서 크레딧·알림 없음');
END $rh_t7$;
DROP TRIGGER rh_fail_ppt_once ON public.payment_provider_transactions;
SELECT set_config('rh.fail_order', '', true);

-- T8: 탈퇴 뒤 크레딧 되살리기·관리자 지급·자료 재지급 거절, 알림 버림, 수동 환불 완료 → manual_refund 기록
DO $rh_t8$
DECLARE
  v_owner uuid := pg_temp.ctx('owner')::uuid;
  v_user uuid := pg_temp.ctx('t1_user')::uuid;
  v_src uuid := pg_temp.ctx('t1_source')::uuid;
  v_rr uuid;
  v_mo uuid;
  v_other uuid;
BEGIN
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.refund_credits(%L, 100, %L, %L, %L, %L::jsonb)', v_user, 'market_refund', gen_random_uuid(), 'RH10',
    jsonb_build_array(jsonb_build_object('source_id', v_src, 'amount', 100)))), 'ERR MEMBER_WITHDRAWN', 'T8', 'refund_credits(원천 잔량 늘리기) 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.grant_admin_credits(%L, %L, 100, %L, %L, %L::jsonb, %L)', v_owner, v_user, 'admin_grant', 'RH10', '{}', 'rh10-t8-grant')),
    'ERR MEMBER_WITHDRAWN', 'T8', '관리자 지급 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('INSERT INTO public.credit_sources (user_id, initial_credits, remaining_credits, source_category) VALUES (%L, 100, 100, %L)', v_user, 'system_refund')),
    'ERR MEMBER_WITHDRAWN', 'T8', '자료 재지급(새 system_refund 원천) 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('UPDATE public.credit_sources SET remaining_credits = 10 WHERE id = %L', v_src)), 'ERR MEMBER_WITHDRAWN', 'T8', '원천 잔량 증가 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('INSERT INTO public.notifications (user_id, type, title, message) VALUES (%L, %L, %L, %L)', v_user, 'test', 't', 'm')),
    'OK rows=0', 'T8', '알림은 만들지 않음(0행)');
  INSERT INTO public.refund_requests (user_id, source_id, reason, status, payment_order_id, provider, refund_amount, origin)
  VALUES (v_user, v_src, 'RH10 미성년자 취소', 'manual_review', pg_temp.ctx('t1_order')::uuid, 'payapp', 9900, 'external_cancel') RETURNING id INTO v_rr;
  UPDATE public.refund_requests SET status = 'completed', processed_at = now() WHERE id = v_rr;
  UPDATE public.refund_requests SET admin_note = 'RH10' WHERE id = v_rr;
  PERFORM pg_temp.check((SELECT count(*) FROM public.withdrawn_member_record_events WHERE user_id = v_user AND kind = 'manual_refund' AND ref_id = v_rr) = 1,
    'T8', '수동 환불 완료 → manual_refund 추가 기록 1건(반복 없음)');
  SELECT id INTO v_mo FROM public.market_purchase_orders WHERE user_id = v_user ORDER BY created_at LIMIT 1;
  PERFORM pg_temp.check((public.add_withdrawn_member_event(v_owner, v_user, 'market_cash_refund', v_mo,
      '{"amount":3000,"method":"bank_transfer","settlementKey":"rh10-settle-1"}') ->> 'recorded')::boolean,
    'T8', '탈퇴 회원 자료 법정 환불 현금 정산 기록(1차 정산)');
  PERFORM pg_temp.check(NOT (public.add_withdrawn_member_event(v_owner, v_user, 'market_cash_refund', v_mo,
      '{"amount":3000,"method":"bank_transfer","settlementKey":"rh10-settle-1"}') ->> 'recorded')::boolean,
    'T8', '(d5) 같은 정산 키 다시 보내면 recorded=false(중복만 막음)');
  PERFORM pg_temp.check((public.add_withdrawn_member_event(v_owner, v_user, 'market_cash_refund', v_mo,
      '{"amount":2000,"method":"bank_transfer","settlementKey":"rh10-settle-2"}') ->> 'recorded')::boolean,
    'T8', '(d5) 같은 주문의 두 번째 정산(다른 키)도 기록');
  PERFORM pg_temp.check((SELECT count(*) FROM public.withdrawn_member_record_events WHERE user_id = v_user AND kind = 'market_cash_refund' AND ref_id = v_mo) = 2,
    'T8', '(d5) 주문당 정산 기록 2건');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.add_withdrawn_member_event(%L, %L, %L, %L, %L::jsonb)', v_owner, v_user, 'market_cash_refund', v_mo,
      '{"amount":1000}')), 'ERR MEMBER_WITHDRAW_INPUT_INVALID', 'T8', '(d5) 정산 키 없으면 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.add_withdrawn_member_event(%L, %L, %L, %L, %L::jsonb)', v_owner, v_user, 'market_cash_refund', gen_random_uuid(),
      '{"amount":1000,"settlementKey":"rh10-settle-3"}')), 'ERR MEMBER_WITHDRAW_INPUT_INVALID', 'T8', '(d5) 그 회원의 자료 주문이 아니면 거절');
  v_other := pg_temp.new_user('t8other');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.add_withdrawn_member_event(%L, %L, %L, %L, %L::jsonb)', v_owner, v_user, 'market_cash_refund',
      pg_temp.market_order(v_other, false), '{"amount":1000,"settlementKey":"rh10-settle-4"}')), 'ERR MEMBER_WITHDRAW_INPUT_INVALID', 'T8', '(d5) 다른 회원의 자료 주문이면 거절');
  PERFORM pg_temp.check((public.add_withdrawn_member_event(v_owner, v_user, 'note', NULL, '{"memo":"RH10 안내 메일"}') ->> 'recorded')::boolean
    AND (public.add_withdrawn_member_event(v_owner, v_user, 'note', NULL, '{"memo":"RH10 안내 메일 2"}') ->> 'recorded')::boolean,
    'T8', '메모(ref 없음)는 여러 건 기록');
END $rh_t8$;

-- T9: 탈퇴 회원 결제 준비(새 시도 / 같은 시도 재요청)·결제 전 확인 동의·페이앱 요청 시작 거절
DO $rh_t9$
DECLARE
  v_user uuid := pg_temp.ctx('t1_user')::uuid;
  v_mid text;
  v_plan public.pricing_plans%ROWTYPE;
  v_attempt public.checkout_attempts%ROWTYPE;
  v_order uuid;
  v_r jsonb;
BEGIN
  SELECT payapp_merchant_id INTO v_mid FROM public.payment_runtime_config WHERE id = true;
  SELECT * INTO v_plan FROM public.pricing_plans WHERE is_active ORDER BY price LIMIT 1;
  PERFORM pg_temp.expect(pg_temp.try_sql(format(
    'SELECT public.prepare_payment_order(%L, %L, %L, %L, %L, %L, %s, %s, %L, %L, %L, %L, %L, %L, 0, %s, NULL, %L)',
    v_user, gen_random_uuid(), 'payapp', v_plan.id, 'RH10NEW' || md5(random()::text), v_plan.name, v_plan.price, v_plan.credits, 'live', v_mid,
    'rh10fp', 'rh10c' || gen_random_uuid(), 'rh10x' || gen_random_uuid(), now() + interval '30 minutes', round(v_plan.price::numeric / 11)::int, 'card')),
    'ERR MEMBER_WITHDRAWN', 'T9', 'prepare 새 결제 시도 거절');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM public.checkout_attempts WHERE user_id = v_user AND request_fingerprint = 'rh10fp'), 'T9', '거절하면 결제 시도도 남지 않음');
  SELECT * INTO v_attempt FROM public.checkout_attempts WHERE user_id = v_user AND payment_order_id = pg_temp.ctx('t1_order')::uuid;
  PERFORM pg_temp.expect(pg_temp.try_sql(format(
    'SELECT public.prepare_payment_order(%L, %L, %L, %L, %L, %L, %s, %s, %L, %L, %L, %L, %L, %L, 0, %s, NULL, %L)',
    v_user, v_attempt.checkout_attempt_id, 'payapp', v_attempt.plan_id, 'RH10RE' || md5(random()::text), v_plan.name, 9900, 10000, 'live', v_mid,
    v_attempt.request_fingerprint, 'rh10c' || gen_random_uuid(), 'rh10x' || gen_random_uuid(), now() + interval '30 minutes', 900, 'card')),
    'ERR MEMBER_WITHDRAWN', 'T9', 'prepare 같은 결제 시도 재요청(기존 주문 재사용) 거절');
  v_r := public.record_point_charge_checkout_ack(v_user, gen_random_uuid(), v_plan.id, v_plan.price, v_plan.credits, repeat('0', 64));
  PERFORM pg_temp.check(v_r ->> 'code' = 'MEMBER_WITHDRAWN' AND NOT (v_r ->> 'ok')::boolean, 'T9', '결제 전 확인 동의 기록 거절(code MEMBER_WITHDRAWN)');
  v_order := pg_temp.new_order(v_user, 'preparing');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.begin_payapp_request(%L)', v_order)), 'ERR MEMBER_WITHDRAWN', 'T9', 'begin_payapp_request 거절');
END $rh_t9$;

-- T10: 가림·확인함(문의 4칸·이력·환불 메모·admin_events), 감사 기록, 확인 뒤 회원 수정 → 다시 확인 필요
DO $rh_t10$
DECLARE
  v_owner uuid := pg_temp.ctx('owner')::uuid;
  v_user uuid;
  v_paid jsonb;
  v_ta uuid; v_tb uuid; v_tc uuid; v_td uuid; v_rv uuid; v_rr uuid; v_mr uuid; v_mo uuid;
  v_req text;
  v_f jsonb;
  v_r jsonb;
  v_res text;
BEGIN
  v_user := pg_temp.new_user('t10');
  v_paid := pg_temp.paid(v_user, 40);
  v_ta := pg_temp.new_ticket(v_user, 'RH10 환불 요청', '환불 부탁드립니다', 'resolved', 'credit_refund', now() - interval '30 days', '처리했습니다', now() - interval '29 days');
  v_tb := pg_temp.new_ticket(v_user, '계좌 110-123-456789', '계좌 110-123-456789 로 보내 주세요', 'resolved', 'etc', now() - interval '28 days', '확인했습니다', now() - interval '27 days');
  v_tc := pg_temp.new_ticket(v_user, 'RH10 질문', '질문입니다', 'resolved', 'etc', now() - interval '26 days', '확인을 위해 계좌번호를 알려 주세요', now() - interval '25 days');
  v_td := pg_temp.new_ticket(v_user, 'RH10 답장', '알려 드립니다', 'resolved', 'etc', now() - interval '24 days', '감사합니다', now() - interval '23 days');
  INSERT INTO public.support_ticket_revisions (ticket_id, subject, message, category_id, written_at)
  VALUES (v_tb, '연락처 010-1234-5678', '이전 내용', (SELECT category_id FROM public.support_tickets WHERE id = v_tb), now() - interval '28 days') RETURNING id INTO v_rv;
  INSERT INTO public.refund_requests (user_id, source_id, reason, status, payment_order_id, provider, refund_amount, origin, processed_at, admin_note)
  VALUES (v_user, (v_paid ->> 'source_id')::uuid, '환불 계좌 333-22-1111111', 'rejected', (v_paid ->> 'order_id')::uuid, 'payapp', 9900, 'user', now() - interval '20 days', NULL)
  RETURNING id INTO v_rr;
  v_mo := pg_temp.market_order(v_user, false);
  INSERT INTO public.market_refund_requests (workspace_subject, user_id, item_id, target_kind, order_id, requested_refund_credits, status, admin_note, processed_at)
  SELECT o.workspace_subject, v_user, o.item_id, 'v2_order', o.id, 100, 'rejected', '메모 없음', now() - interval '20 days' FROM public.market_purchase_orders o WHERE o.id = v_mo
  RETURNING id INTO v_mr;
  v_f := public.member_withdrawal_facts(v_user, true);
  PERFORM pg_temp.check(jsonb_array_length(v_f -> 'redactionRequired') = 5
    AND v_f -> 'refundTicketIds' ? v_ta::text,
    'T10', '가림 확인 필요 5건: 환불 분류 문의·긴 번호 문의·계좌 요청 뒤 문의·수정 이력·충전 환불 사유 ' || (v_f -> 'redactionRequired')::text);
  v_req := pg_temp.try_request(v_user, 'screen', v_user);
  PERFORM pg_temp.expect(v_req, 'OK', 'T10', '가림 확인 필요여도 결제 회원 요청은 가능');
  PERFORM pg_temp.expect(pg_temp.try_anon(v_owner, v_user, 'owner', pg_temp.req_id(v_req), NULL, NULL, false, NULL, 'rh10-t10', NULL, true),
    'ERR MEMBER_WITHDRAW_REDACTION_REQUIRED', 'T10', '대표 처리 때 가림 확인 필요로 거절');

  -- 가림: 문의 제목(관리자 이벤트 제목도), 본문, 수정 이력, 충전 환불 사유
  v_r := public.redact_member_text(v_owner, 'support_ticket', v_tb, 'subject', '110-123-456789', 'rh10-red-1');
  PERFORM pg_temp.check((v_r ->> 'occurrences')::int = 1 AND (v_r ->> 'adminEventsUpdated')::int = 1
    AND (SELECT subject FROM public.support_tickets WHERE id = v_tb) = '계좌 [가림 처리됨]'
    AND NOT EXISTS (SELECT 1 FROM public.admin_events WHERE ref_id = v_tb AND title LIKE '%110-123%'),
    'T10', '문의 제목 가림 + 같은 대상 관리자 이벤트 제목도 가림');
  PERFORM public.redact_member_text(v_owner, 'support_ticket', v_tb, 'message', '110-123-456789', 'rh10-red-2');
  PERFORM pg_temp.check((public.redact_member_text(v_owner, 'support_ticket', v_tb, 'message', '110-123-456789', 'rh10-red-2') ->> 'replay')::boolean, 'T10', '같은 키 가림은 replay');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.redact_member_text(%L, %L, %L, %L, %L, %L)', v_owner, 'support_ticket', v_tb, 'admin_response', '없는 문구', 'rh10-red-x')),
    'ERR MEMBER_REDACTION_TEXT_NOT_FOUND', 'T10', '없는 문구는 거절');
  PERFORM public.redact_member_text(v_owner, 'support_ticket_revision', v_rv, 'subject', '010-1234-5678', 'rh10-red-3');
  PERFORM public.redact_member_text(v_owner, 'refund_request', v_rr, 'reason', '333-22-1111111', 'rh10-red-4');
  PERFORM pg_temp.check((SELECT message FROM public.support_tickets WHERE id = v_tb) NOT LIKE '%110-123%'
    AND (SELECT subject FROM public.support_ticket_revisions WHERE id = v_rv) = '연락처 [가림 처리됨]'
    AND (SELECT reason FROM public.refund_requests WHERE id = v_rr) = '환불 계좌 [가림 처리됨]',
    'T10', '본문·수정 이력·충전 환불 사유 가림');
  PERFORM pg_temp.check((SELECT count(*) FROM public.admin_audit_log WHERE action = 'member_text_redact' AND target_user_id = v_user) = 4
    AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log WHERE target_user_id = v_user AND details::text ~ '110-123|010-1234|333-22'),
    'T10', '감사 기록 4건, 글자 수만(가린 문구 없음)');
  PERFORM public.mark_member_text_reviewed(v_owner, 'support_ticket', v_ta);
  PERFORM public.mark_member_text_reviewed(v_owner, 'support_ticket', v_td);
  v_f := public.member_withdrawal_facts(v_user, true);
  PERFORM pg_temp.check(jsonb_array_length(v_f -> 'redactionRequired') = 0, 'T10', '[가림]·[확인함] 뒤 확인 필요 0');
  -- 확인 뒤 회원이 고치면 다시 확인 필요
  UPDATE public.support_tickets SET member_updated_at = clock_timestamp() + interval '1 second' WHERE id = v_td;
  v_f := public.member_withdrawal_facts(v_user, true);
  PERFORM pg_temp.check(jsonb_array_length(v_f -> 'redactionRequired') = 1 AND (v_f -> 'redactionRequired' -> 0 ->> 'id')::uuid = v_td, 'T10', '확인 뒤 회원 수정 → 다시 확인 필요');
  UPDATE public.support_tickets SET member_updated_at = now() - interval '1 day' WHERE id = v_td;
  PERFORM public.mark_member_text_reviewed(v_owner, 'support_ticket', v_td);
  PERFORM pg_temp.expect(pg_temp.try_anon(v_owner, v_user, 'owner', pg_temp.req_id(v_req), NULL, NULL, false, NULL, 'rh10-t10', NULL, true),
    'OK', 'T10', '확인을 마친 뒤 익명화');
  PERFORM pg_temp.check(ARRAY(SELECT unnest(refund_ticket_ids) FROM public.withdrawn_member_records WHERE user_id = v_user) = ARRAY[v_ta], 'T10', '보관함 refund_ticket_ids(환불 연결 문의)');
  PERFORM pg_temp.ctx_set('t10_user', v_user::text);
  PERFORM pg_temp.ctx_set('t10_ticket', v_ta::text);
  PERFORM pg_temp.ctx_set('t10_pending_ticket', v_tc::text);
END $rh_t10$;

-- T10 (RLS): CS 직원 JWT 로 탈퇴 회원 문의·자료 환불 0행·UPDATE 거절
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.ctx('staff'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $rh_t10_staff$
DECLARE
  v_user uuid := pg_temp.ctx('t10_user')::uuid;
  v_res text;
BEGIN
  PERFORM pg_temp.check(public.is_admin() AND (SELECT count(*) FROM public.support_tickets WHERE user_id = v_user) = 0
    AND (SELECT count(*) FROM public.market_refund_requests WHERE user_id = v_user) = 0
    AND (SELECT count(*) FROM public.support_tickets) > 0,
    'T10', 'CS 직원 JWT: 탈퇴 회원 문의·자료 환불 SELECT 0행(다른 문의는 보임)');
  v_res := pg_temp.try_sql(format('UPDATE public.support_tickets SET admin_response = %L WHERE user_id = %L', 'RH10', v_user));
  PERFORM pg_temp.check(v_res LIKE 'ERR%42501%' OR v_res = 'OK rows=0', 'T10', 'CS 직원 JWT: 탈퇴 회원 문의 UPDATE 거절 → ' || v_res);
END $rh_t10_staff$;
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.ctx('owner'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $rh_t10_owner$
BEGIN
  PERFORM pg_temp.check(public.is_owner() AND (SELECT count(*) FROM public.support_tickets WHERE user_id = pg_temp.ctx('t10_user')::uuid) = 0,
    'T10', '대표 JWT(is_owner)도 탈퇴 회원 문의 0행');
END $rh_t10_owner$;
RESET ROLE;

-- T10 (탈퇴 회원 JWT): 문의 함수·문제지·문제·지문 INSERT 거절
DO $rh_t10_prep$
BEGIN
  PERFORM set_config('app.member_withdrawal_bypass', pg_temp.ctx('t10_user'), true);
  UPDATE public.support_tickets SET status = 'pending' WHERE id = pg_temp.ctx('t10_pending_ticket')::uuid;
  PERFORM set_config('app.member_withdrawal_bypass', '', true);
  PERFORM pg_temp.expect(pg_temp.try_sql(format('UPDATE public.support_tickets SET status = %L WHERE id = %L', 'closed', pg_temp.ctx('t10_pending_ticket'))),
    'ERR MEMBER_WITHDRAWN', 'T10', '설정 없이 탈퇴 회원 문의 UPDATE 거절(postgres 도)');
END $rh_t10_prep$;
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.ctx('t10_user'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $rh_t10_member$
DECLARE
  v_user uuid := pg_temp.ctx('t10_user')::uuid;
  v_cat uuid;
BEGIN
  SELECT id INTO v_cat FROM public.support_ticket_categories WHERE slug = 'etc';
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.create_support_ticket(%L, %L, %L)', v_cat, 'RH10 탈퇴 뒤', '내용')),
    'ERR MEMBER_WITHDRAWN', 'T10', '탈퇴 회원 JWT: create_support_ticket 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.update_own_pending_support_ticket(%L, %L, %L, %L)', pg_temp.ctx('t10_pending_ticket'), v_cat, '수정', '수정')),
    'ERR MEMBER_WITHDRAWN', 'T10', '탈퇴 회원 JWT: update_own_pending_support_ticket 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.soft_delete_own_support_ticket(%L)', pg_temp.ctx('t10_pending_ticket'))),
    'ERR MEMBER_WITHDRAWN', 'T10', '탈퇴 회원 JWT: soft_delete_own_support_ticket 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('INSERT INTO public.exam_papers (user_id, paper_title) VALUES (%L, %L)', v_user, 'E')),
    'ERR MEMBER_WITHDRAWN', 'T10', '탈퇴 회원 JWT: 문제지 INSERT 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('INSERT INTO public.questions (user_id, question_text, choices, answer) VALUES (%L, %L, %L::jsonb, %L)', v_user, 'Q', '[]', 'A')),
    'ERR MEMBER_WITHDRAWN', 'T10', '탈퇴 회원 JWT: 문제 INSERT 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('INSERT INTO public.passages (user_id, content) VALUES (%L, %L)', v_user, 'P')),
    'ERR MEMBER_WITHDRAWN', 'T10', '탈퇴 회원 JWT: 지문 INSERT 거절');
  PERFORM pg_temp.check((SELECT count(*) FROM public.support_tickets WHERE user_id = v_user) = 0, 'T10', '탈퇴 회원 JWT: 자기 문의도 안 보임');
END $rh_t10_member$;
RESET ROLE;

-- T10 (service_role): 보관함·추가 기록 SELECT 거절, 요청은 읽기 가능, 열람 함수는 기록을 남기고 연다
SET LOCAL ROLE service_role;
DO $rh_t10_service$
DECLARE
  v_r jsonb;
BEGIN
  PERFORM pg_temp.expect(pg_temp.try_sql('SELECT count(*) FROM public.withdrawn_member_records'), 'ERR permission denied', 'T10', 'service_role 보관함 SELECT 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql('SELECT count(*) FROM public.withdrawn_member_record_events'), 'ERR permission denied', 'T10', 'service_role 추가 기록 SELECT 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql('SELECT count(*) FROM public.member_withdrawal_requests'), 'OK', 'T10', 'service_role 요청 SELECT 가능');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.member_withdrawal_facts(%L)', pg_temp.ctx('t10_user'))), 'ERR permission denied', 'T10', 'service_role 은 내부 함수 실행 불가');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.read_withdrawn_member_record(%L, %L, %L)', pg_temp.ctx('staff'), pg_temp.ctx('t10_user'), '확인')),
    'ERR MEMBER_WITHDRAW_ACTOR_NOT_OWNER', 'T10', '열람은 대표만');
  v_r := public.read_withdrawn_member_record(pg_temp.ctx('owner')::uuid, pg_temp.ctx('t10_user')::uuid, '분쟁 확인', '{"ip":"198.51.100.9","userAgent":"RH10"}');
  PERFORM pg_temp.check(v_r ->> 'email' LIKE 'rh10.t10.%' AND jsonb_typeof(v_r -> 'events') = 'array', 'T10', '대표 열람: 보관 연락처 반환');
  v_r := public.read_withdrawn_member_ticket(pg_temp.ctx('owner')::uuid, pg_temp.ctx('t10_ticket')::uuid, '분쟁 확인', '{"ip":"198.51.100.9"}');
  PERFORM pg_temp.check(v_r ->> 'subject' = 'RH10 환불 요청', 'T10', '대표 탈퇴 회원 문의 열람');
END $rh_t10_service$;
RESET ROLE;
DO $rh_t10_audit$
BEGIN
  PERFORM pg_temp.check((SELECT count(*) FROM public.admin_audit_log WHERE action = 'withdrawn_record_view' AND target_user_id = pg_temp.ctx('t10_user')::uuid
                          AND reason = '분쟁 확인' AND details -> 'request' ->> 'ip' = '198.51.100.9') = 2, 'T10', '열람 기록 2건(사유·요청 IP)');
END $rh_t10_audit$;

-- T11: 카카오 가입 미완료 함수·가입 완료 거절, 동의 대상 회원 수 제외, 카카오 연결 끊기 칸
DO $rh_t11$
DECLARE
  v_k1 uuid;
  v_k2 uuid;
  v_before integer;
  v_r jsonb;
BEGIN
  v_k1 := pg_temp.new_user('t11a', 'kakao', false);
  PERFORM pg_temp.expect(pg_temp.try_self(v_k1, true, 'rh10-t11a-' || v_k1), 'OK', 'T11', '가입 미완료 카카오 회원 익명화');
  PERFORM pg_temp.check(public.cancel_incomplete_kakao_signup(v_k1) IS FALSE, 'T11', 'cancel_incomplete_kakao_signup: 탈퇴 회원이면 false');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.complete_kakao_signup_with_consents(%L, %L::jsonb, %L, NULL, %L, %L)', v_k1, '[]', 'x@example.invalid', 'x@example.invalid', '1')),
    'ERR MEMBER_WITHDRAWN', 'T11', 'complete_kakao_signup_with_consents 거절');
  v_k2 := pg_temp.new_user('t11b', 'kakao', true);
  v_before := public.consent_eligible_member_count();
  PERFORM pg_temp.expect(pg_temp.try_self(v_k2, true, 'rh10-t11b-' || v_k2), 'OK', 'T11', '가입 완료 카카오 회원 익명화');
  PERFORM pg_temp.check(public.consent_eligible_member_count() = v_before - 1, 'T11', '동의 대상 회원 수에서 제외(' || v_before || ' → ' || public.consent_eligible_member_count() || ')');
  v_r := public.withdrawn_member_kakao_unlink_target(v_k2);
  PERFORM pg_temp.check(v_r ->> 'kakaoId' LIKE 'rhk%' AND NOT (v_r ->> 'newIdentityExists')::boolean
    AND (SELECT kakao_id FROM public.profiles WHERE id = v_k2) IS NULL, 'T11', '보관함 kakao_id_pending_unlink 에 회원번호, 프로필에서는 지움');
  -- (M1) 익명화만 끝나고 서버의 로그인 계정 정리가 아직: 상태 함수로 [다시 시도] 대상이 보인다.
  --      익명화 거래는 경보·관리자 알림(슬랙 대상)을 만들지 않는다(정리가 곧 성공하는 정상 경로마다 알림이 나가지 않게).
  v_r := public.withdrawn_member_account_status(v_k2);
  PERFORM pg_temp.check((v_r ->> 'withdrawnAt') IS NOT NULL AND v_r -> 'authScrubbedAt' = 'null'::jsonb AND (v_r ->> 'kakaoUnlinkPending')::boolean
    AND NOT EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts WHERE code = 'MEMBER_AUTH_SCRUB_PENDING'
                     AND details ->> 'dedupe_key' IN ('member_auth_scrub:' || v_k1, 'member_auth_scrub:' || v_k2))
    AND NOT EXISTS (SELECT 1 FROM public.admin_events e JOIN public.payment_reconciliation_alerts a ON a.id = e.ref_id
                     WHERE e.ref_table = 'payment_reconciliation_alerts' AND a.code = 'MEMBER_AUTH_SCRUB_PENDING'),
    'T11', '(M1) 익명화 뒤 상태 함수 authScrubbedAt=null·kakaoUnlinkPending=true, 익명화 거래의 MEMBER_AUTH_SCRUB_PENDING 경보·관리자 알림 0건');
  -- 정리 전에 서버가 멈춘 경우: 10분이 지나면 remind_unanswered_admin_work 가 경보(슬랙 대상 관리자 알림)를 한 번만 남긴다
  PERFORM public.remind_unanswered_admin_work();
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts WHERE code = 'MEMBER_AUTH_SCRUB_PENDING'
                                     AND details ->> 'dedupe_key' = 'member_auth_scrub:' || v_k2),
    'T11', '탈퇴 10분 안에는 정기 작업이 정리 지연 경보를 넣지 않음');
  ALTER TABLE public.withdrawn_member_records DISABLE TRIGGER guard_withdrawn_member_records_mutation;
  UPDATE public.withdrawn_member_records SET withdrawn_at = withdrawn_at - interval '11 minutes' WHERE user_id = v_k2;
  ALTER TABLE public.withdrawn_member_records ENABLE TRIGGER guard_withdrawn_member_records_mutation;
  PERFORM public.remind_unanswered_admin_work();
  PERFORM public.remind_unanswered_admin_work();
  PERFORM pg_temp.check((SELECT count(*) FROM public.payment_reconciliation_alerts WHERE code = 'MEMBER_AUTH_SCRUB_PENDING' AND resolved_at IS NULL
                          AND details ->> 'dedupe_key' = 'member_auth_scrub:' || v_k2 AND details ->> 'user_id' = v_k2::text) = 1
    AND EXISTS (SELECT 1 FROM public.admin_events e JOIN public.payment_reconciliation_alerts a ON a.id = e.ref_id
                 WHERE e.ref_table = 'payment_reconciliation_alerts' AND a.code = 'MEMBER_AUTH_SCRUB_PENDING'
                   AND a.details ->> 'dedupe_key' = 'member_auth_scrub:' || v_k2 AND e.delivery = 'full'),
    'T11', '정리 없이 10분 지남 → 정기 작업이 MEMBER_AUTH_SCRUB_PENDING 경보 1건(두 번 돌려도 1건)·관리자 알림(full)');
  -- (d4) 카카오 연결 끊기 대기 경보(서버가 남김) → 끊기 성공 기록이 같은 거래에서 경보를 푼다
  PERFORM public.record_payment_alert('MEMBER_KAKAO_UNLINK_PENDING', 'warning', 'RH10 카카오 연결 끊기 대기',
    jsonb_build_object('user_id', v_k2, 'dedupe_key', 'member_kakao_unlink:' || v_k2));
  v_r := public.clear_withdrawn_member_kakao_unlink(v_k2, 'unlinked');
  PERFORM pg_temp.check((v_r ->> 'cleared')::boolean AND (v_r ->> 'alertsResolved')::int = 1
    AND (SELECT kakao_id_pending_unlink FROM public.withdrawn_member_records WHERE user_id = v_k2) IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts WHERE code = 'MEMBER_KAKAO_UNLINK_PENDING' AND resolved_at IS NULL
                     AND details ->> 'dedupe_key' = 'member_kakao_unlink:' || v_k2)
    AND NOT (public.withdrawn_member_account_status(v_k2) ->> 'kakaoUnlinkPending')::boolean,
    'T11', '연결 끊기 성공 → 칸 NULL, (d4) MEMBER_KAKAO_UNLINK_PENDING 경보 해소, 상태 kakaoUnlinkPending=false');
  v_r := public.mark_withdrawn_member_auth_scrubbed(v_k2);
  PERFORM pg_temp.check((v_r ->> 'authScrubbedAt') IS NOT NULL AND (v_r ->> 'alertsResolved')::int = 1
    AND (SELECT auth_scrubbed_at FROM public.withdrawn_member_records WHERE user_id = v_k2) IS NOT NULL
    AND (public.withdrawn_member_account_status(v_k2) ->> 'authScrubbedAt') IS NOT NULL,
    'T11', '로그인 계정 정리 완료 기록·정기 작업이 남긴 MEMBER_AUTH_SCRUB_PENDING 경보 해소·상태 authScrubbedAt 값');
  -- 탈퇴 회원이 아니면 빈 값(오류 아님), 입력 없음은 거절
  PERFORM pg_temp.check(public.withdrawn_member_account_status(pg_temp.ctx('owner')::uuid)
      = '{"withdrawnAt": null, "authScrubbedAt": null, "kakaoUnlinkPending": false}'::jsonb
    AND public.withdrawn_member_account_status(gen_random_uuid()) = '{"withdrawnAt": null, "authScrubbedAt": null, "kakaoUnlinkPending": false}'::jsonb,
    'T11', '(M1) 탈퇴하지 않은 회원·없는 회원 → withdrawnAt null(오류 아님)');
  PERFORM pg_temp.expect(pg_temp.try_sql('SELECT public.withdrawn_member_account_status(NULL)'), 'ERR MEMBER_WITHDRAW_INPUT_INVALID', 'T11', '상태 함수 입력 없음 거절');
END $rh_t11$;

-- T11b: 완전 삭제 로그인 계정 경보 해소(프로필·로그인 계정이 남아 있으면 풀지 않음), 결제 검토 화면의 보류 주문 판정
DO $rh_t11b$
DECLARE
  v_owner uuid := pg_temp.ctx('owner')::uuid;
  v_gone uuid := gen_random_uuid();
  v_ids uuid[];
  v_held uuid[];
  v_r jsonb;
BEGIN
  PERFORM public.record_payment_alert('MEMBER_FULL_DELETE_AUTH_PENDING', 'warning', 'RH10', jsonb_build_object('dedupe_key', 'member_full_delete_auth:' || v_gone));
  PERFORM public.record_payment_alert('MEMBER_FULL_DELETE_AUTH_PENDING', 'warning', 'RH10', jsonb_build_object('dedupe_key', 'member_full_delete_auth:' || v_owner));
  v_r := public.resolve_member_full_delete_auth_alert(v_owner);
  PERFORM pg_temp.check((v_r ->> 'alertsResolved')::int = 0 AND (v_r ->> 'accountRemains')::boolean
    AND EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts WHERE code = 'MEMBER_FULL_DELETE_AUTH_PENDING' AND resolved_at IS NULL
                 AND details ->> 'dedupe_key' = 'member_full_delete_auth:' || v_owner),
    'T11', '완전 삭제 경보 해소: 프로필·로그인 계정이 남아 있으면 풀지 않음');
  v_r := public.resolve_member_full_delete_auth_alert(v_gone);
  PERFORM pg_temp.check((v_r ->> 'alertsResolved')::int = 1 AND NOT (v_r ->> 'accountRemains')::boolean
    AND NOT EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts WHERE code = 'MEMBER_FULL_DELETE_AUTH_PENDING' AND resolved_at IS NULL
                     AND details ->> 'dedupe_key' = 'member_full_delete_auth:' || v_gone),
    'T11', '완전 삭제 경보 해소: 프로필·로그인 계정이 모두 없으면 그 회원 경보만 해소');
  PERFORM pg_temp.expect(pg_temp.try_sql('SELECT public.resolve_member_full_delete_auth_alert(NULL)'), 'ERR MEMBER_WITHDRAW_INPUT_INVALID', 'T11', '완전 삭제 경보 해소 입력 없음 거절');

  v_ids := ARRAY(SELECT id FROM public.payment_orders WHERE user_id = pg_temp.ctx('t1_user')::uuid);
  v_held := public.withdrawn_member_held_order_ids(v_ids || gen_random_uuid());
  PERFORM pg_temp.check(cardinality(v_held) > 0 AND cardinality(v_held) < cardinality(v_ids)
    AND (SELECT bool_and(EXISTS (SELECT 1 FROM public.withdrawn_member_record_events e WHERE e.kind = 'late_payment' AND e.ref_id = h)) FROM unnest(v_held) h)
    AND (SELECT count(*) FROM public.withdrawn_member_record_events e WHERE e.kind = 'late_payment' AND e.ref_id = ANY (v_ids)) = cardinality(v_held),
    'T11', '보류 주문 판정: 늦은 결제 기록이 있는 주문만 돌려줌(' || cardinality(v_held) || '/' || cardinality(v_ids) || ')');
  PERFORM pg_temp.check(public.withdrawn_member_held_order_ids('{}'::uuid[]) = '{}'::uuid[], 'T11', '보류 주문 판정: 빈 목록 → 빈 목록');
  PERFORM pg_temp.expect(pg_temp.try_sql('SELECT public.withdrawn_member_held_order_ids(NULL)'), 'ERR MEMBER_WITHDRAW_INPUT_INVALID', 'T11', '보류 주문 판정 입력 없음 거절');
END $rh_t11b$;

-- T12: 비결제 익명화(동의·구매 고지 있는 회원, 문의 보존 동의/미동의, 완전 삭제, 요청 기록만 있는 회원)
DO $rh_t12$
DECLARE
  v_owner uuid := pg_temp.ctx('owner')::uuid;
  v_user uuid;
  v_t uuid;
  v_res text;
  v_r jsonb;
  v_f jsonb;
  v_req text;
  v_ev uuid;
BEGIN
  -- a. 가입 동의·구매 고지·자료 구매·무상 크레딧·낡은 결제 시도 + 문의(보존 동의)
  v_user := pg_temp.new_user('t12a');
  PERFORM pg_temp.consent_all(v_user, true);
  PERFORM pg_temp.grant_free(v_user, 300);
  PERFORM pg_temp.market_order(v_user, true);
  PERFORM pg_temp.new_order(v_user, 'failed', now() - interval '30 days', NULL, 9900, 10000, 'claimed');
  v_t := pg_temp.new_ticket(v_user, 'RH10 비결제 문의', '내용', 'pending', 'etc', now() - interval '3 days');
  v_res := pg_temp.try_self(v_user, true, 'rh10-t12a-' || v_user);
  PERFORM pg_temp.expect(v_res, 'OK', 'T12', '가입 동의·구매 고지 동의 있는 비결제 회원 스스로 익명화(문의 보존 동의)');
  v_r := pg_temp.res(v_res);
  PERFORM pg_temp.check((SELECT count(*) FROM public.user_consents WHERE user_id = v_user) = 0
    AND (SELECT count(*) FROM public.market_purchase_notice_acks WHERE user_id = v_user) = 0
    AND (SELECT count(*) FROM public.market_purchase_orders WHERE user_id = v_user) = 0
    AND (SELECT count(*) FROM public.market_entitlements WHERE user_id = v_user) = 0
    AND (SELECT count(*) FROM public.market_download_events WHERE user_id = v_user) = 0
    AND (SELECT count(*) FROM public.credit_sources WHERE user_id = v_user) = 0
    AND (SELECT count(*) FROM public.credit_transactions WHERE user_id = v_user) = 0,
    'T12', '삭제 성공: 동의·구매 고지·자료 주문·권한·다운로드·크레딧(가드는 설정 값 회원만 허용)');
  PERFORM pg_temp.check((v_r -> 'marketing' ->> 'withdrawnAt') IS NOT NULL AND (v_r ->> 'forfeited')::int = 300
    AND (SELECT status FROM public.support_tickets WHERE id = v_t) = 'closed'
    AND (SELECT ticket_retention_agreed FROM public.withdrawn_member_records WHERE user_id = v_user)
    AND NOT EXISTS (SELECT 1 FROM public.payment_orders WHERE user_id = v_user AND request_fingerprint LIKE 'rhfp-%'),
    'T12', '마케팅 철회 일시 결과에 남김, 문의 보존(닫힘), fingerprint 임의 값');

  -- b. 문의 보존 미동의(결제 시도 있음 → 익명화하며 문의 삭제, 관리자 이벤트는 먼저 정리)
  v_user := pg_temp.new_user('t12b');
  PERFORM pg_temp.new_order(v_user, 'expired', now() - interval '30 days', NULL, 9900, 10000, 'expired');
  v_t := pg_temp.new_ticket(v_user, 'RH10 지울 문의 제목', '내용', 'resolved', 'etc', now() - interval '3 days');
  SELECT id INTO v_ev FROM public.admin_events WHERE ref_table = 'support_tickets' AND ref_id = v_t;
  -- 답변 대기 문의 줄: 보존 미동의 원문에는 '닫힙니다' 없이 삭제 문구, 보존 동의는 닫힘 문구, 회신으로 정하는 요청 원문은 둘 다 안내
  PERFORM pg_temp.new_ticket(v_user, 'RH10 대기 문의', '내용', 'pending', 'etc', now() - interval '1 day');
  v_f := public.member_withdrawal_policy() -> 'texts' -> 'notice';
  PERFORM pg_temp.check(
    strpos(public.get_member_withdrawal_notice(v_user, 'self', false) ->> 'text', replace(v_f ->> 'pendingTicketsDelete', '{답변대기문의}', '1')) > 0
    AND strpos(public.get_member_withdrawal_notice(v_user, 'self', false) ->> 'text', '닫힙니다') = 0
    AND strpos(public.get_member_withdrawal_notice(v_user, 'self', true) ->> 'text', replace(v_f ->> 'pendingTickets', '{답변대기문의}', '1')) > 0
    AND strpos(public.get_member_withdrawal_notice(v_user, 'request', NULL) ->> 'text', replace(v_f ->> 'pendingTicketsChoice', '{답변대기문의}', '1')) > 0,
    'T12', '대기 문의 줄: 미동의 → 삭제 문구(닫힙니다 없음), 동의 → 닫힘 문구, 회신 선택 → 둘 다 안내');
  v_res := pg_temp.try_self(v_user, false, 'rh10-t12b-' || v_user);
  PERFORM pg_temp.expect(v_res, 'OK', 'T12', '문의 보존 미동의 스스로 익명화');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM public.support_tickets WHERE user_id = v_user)
    AND (SELECT title FROM public.admin_events WHERE id = v_ev) = '탈퇴 회원 문의', 'T12', '미동의 → 문의 삭제, 관리자 이벤트 제목 정리');

  -- c. 완전 삭제 대상(동의·구매 고지 있음, 결제·시도·요청 없음, 문의는 보존 미동의)
  v_user := pg_temp.new_user('t12c');
  PERFORM pg_temp.consent_all(v_user, false);
  PERFORM pg_temp.market_order(v_user, false);
  v_t := pg_temp.new_ticket(v_user, 'RH10 완전 삭제 문의', '내용', 'resolved', 'etc');
  SELECT id INTO v_ev FROM public.admin_events WHERE ref_table = 'support_tickets' AND ref_id = v_t;
  v_f := public.member_withdrawal_facts(v_user, false);
  PERFORM pg_temp.check((v_f ->> 'fullDeleteAllowed')::boolean AND NOT (public.member_withdrawal_facts(v_user, true) ->> 'fullDeleteAllowed')::boolean,
    'T12', '완전 삭제 판정: 문의 보존 미동의일 때만');
  PERFORM public.scrub_member_admin_events(v_user);
  DELETE FROM public.support_tickets WHERE user_id = v_user;
  DELETE FROM public.profiles WHERE id = v_user;
  DELETE FROM auth.users WHERE id = v_user;
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM public.user_consents WHERE user_id = v_user) AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user)
    AND (SELECT title FROM public.admin_events WHERE id = v_ev) = '탈퇴 회원 문의', 'T12', '완전 삭제(동의 기록 있음) 성공, 관리자 이벤트 제목 정리');

  -- d. 기록 없는 회원 + 탈퇴 요청 기록 → 완전 삭제가 아니라 익명화 경로
  v_user := pg_temp.new_user('t12d');
  v_req := pg_temp.try_request(v_user, 'email', v_owner, NULL, 'legal_guardian', '법정대리인 관계 확인함');
  PERFORM pg_temp.expect(v_req, 'OK', 'T12', '법정대리인 email 요청 기록(기록 없는 회원)');
  v_f := public.member_withdrawal_facts(v_user, false);
  PERFORM pg_temp.check(NOT (v_f ->> 'fullDeleteAllowed')::boolean AND (v_f ->> 'hasRequestHistory')::boolean, 'T12', '요청 기록이 있으면 완전 삭제 아님');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('DELETE FROM public.profiles WHERE id = %L', v_user)), 'ERR', 'T12', '요청이 profiles 를 RESTRICT 로 참조(완전 삭제 불가)');
  PERFORM pg_temp.expect(pg_temp.try_anon(v_owner, v_user, 'owner', pg_temp.req_id(v_req), NULL, NULL, false, NULL, 'rh10-t12d', NULL, false),
    'OK', 'T12', '요청 기록만 있는 회원 익명화');
END $rh_t12$;

-- T14: 탈퇴 요청(마케팅 즉시 철회·취소 뒤 유지·pending 1건·요청 뒤 사용·무상 초과·막힘 화면 광고 철회)
DO $rh_t14$
DECLARE
  v_owner uuid := pg_temp.ctx('owner')::uuid;
  v_user uuid;
  v_paid jsonb;
  v_paid2 jsonb;
  v_req text;
  v_res text;
  v_r jsonb;
  v_f jsonb;
  v_detail text;
  v_mo uuid;
  v_mr uuid;
  v_desc uuid;
BEGIN
  v_user := pg_temp.new_user('t14');
  PERFORM pg_temp.consent_all(v_user, true);
  v_paid := pg_temp.paid(v_user, 40);
  v_req := pg_temp.try_request(v_user, 'screen', v_user);
  PERFORM pg_temp.expect(v_req, 'OK', 'T14', '요청');
  PERFORM pg_temp.check(pg_temp.marketing_latest(v_user) = 'false:withdrawal'
    AND (pg_temp.res(v_req) -> 'marketing' ->> 'result') = '광고성 정보 수신동의 철회', 'T14', '마케팅 즉시 철회, 결과(보낸 곳·철회 사실·처리 일시) 반환');
  PERFORM pg_temp.expect(pg_temp.try_request(v_user, 'screen', v_user), 'ERR MEMBER_WITHDRAW_REQUEST_EXISTS', 'T14', 'pending 1건 제한');
  PERFORM pg_temp.check((public.cancel_member_withdrawal_request(v_user, pg_temp.req_id(v_req)) ->> 'status') = 'canceled'
    AND pg_temp.marketing_latest(v_user) = 'false:withdrawal', 'T14', '요청 취소 뒤에도 철회 유지');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('SELECT public.cancel_member_withdrawal_request(%L, %L)', v_user, pg_temp.req_id(v_req))),
    'ERR MEMBER_WITHDRAW_REQUEST_INVALID', 'T14', '취소한 요청은 다시 취소 불가');
  v_req := pg_temp.try_request(v_user, 'screen', v_user);
  PERFORM pg_temp.expect(v_req, 'OK', 'T14', '다시 요청');
  PERFORM pg_temp.use_credits((v_paid ->> 'source_id')::uuid, 3000);
  v_res := pg_temp.try_anon(v_owner, v_user, 'owner', pg_temp.req_id(v_req), NULL, NULL, false, NULL, 'rh10-t14-' || v_user, NULL, true);
  PERFORM pg_temp.expect(v_res, 'OK', 'T14', '요청 뒤 크레딧 사용(소멸액 감소) → 처리');
  v_r := pg_temp.res(v_res);
  PERFORM pg_temp.check((v_r ->> 'forfeited')::int = 7000 AND (v_r -> 'agreed' ->> 'balance')::int = 10000, 'T14', '동의 금액 10,000 과 실제 소멸 7,000 둘 다 남김');

  v_user := pg_temp.new_user('t14b');
  v_paid := pg_temp.paid(v_user, 40);
  v_req := pg_temp.try_request(v_user, 'screen', v_user);
  -- 한 거래 안에서는 요청과 새 지급의 now() 가 같으므로 요청 시각을 하루 앞으로 옮긴다(요청 표 가드는 잠깐 끔)
  ALTER TABLE public.member_withdrawal_requests DISABLE TRIGGER guard_member_withdrawal_requests_mutation;
  UPDATE public.member_withdrawal_requests SET created_at = now() - interval '1 day', received_at = now() - interval '1 day'
   WHERE id = pg_temp.req_id(v_req);
  ALTER TABLE public.member_withdrawal_requests ENABLE TRIGGER guard_member_withdrawal_requests_mutation;
  PERFORM pg_temp.use_credits((v_paid ->> 'source_id')::uuid, 2000);
  PERFORM pg_temp.grant_free(v_user, 500);
  PERFORM pg_temp.expect(pg_temp.try_anon(v_owner, v_user, 'owner', pg_temp.req_id(v_req), NULL, NULL, false, NULL, 'rh10-t14b', NULL, true),
    'ERR MEMBER_WITHDRAW_NEW_CHARGE', 'T14', '요청 뒤 유료 사용 + 관리자 무상 지급(새 원천) → MEMBER_WITHDRAW_NEW_CHARGE(전체는 줄었어도)');
  -- 요청 뒤 옛 무상을 다 쓰고 같은 양의 무상을 새로 지급 → 무상 합계는 동의 값과 같아도 새 원천이라 거절
  v_user := pg_temp.new_user('t14f');
  v_paid := pg_temp.paid(v_user, 40);
  PERFORM pg_temp.grant_free(v_user, 500);
  SELECT id INTO v_desc FROM public.credit_sources WHERE user_id = v_user AND source_category = 'admin_grant';
  UPDATE public.credit_sources SET created_at = now() - interval '2 days' WHERE id = v_desc;
  v_req := pg_temp.try_request(v_user, 'screen', v_user);
  PERFORM pg_temp.expect(v_req, 'OK', 'T14', '준비: 유료 10,000 + 무상 500(이틀 전 지급) 요청');
  ALTER TABLE public.member_withdrawal_requests DISABLE TRIGGER guard_member_withdrawal_requests_mutation;
  UPDATE public.member_withdrawal_requests SET created_at = now() - interval '1 day', received_at = now() - interval '1 day'
   WHERE id = pg_temp.req_id(v_req);
  ALTER TABLE public.member_withdrawal_requests ENABLE TRIGGER guard_member_withdrawal_requests_mutation;
  PERFORM pg_temp.use_credits(v_desc, 500);
  PERFORM pg_temp.grant_free(v_user, 500);
  PERFORM pg_temp.check((public.member_withdrawal_facts(v_user, true) -> 'balance' ->> 'forfeitFree')::int = 500, 'T14', '무상 소멸 대상 500(동의 값과 같음)');
  v_detail := NULL;
  v_res := NULL;
  BEGIN
    PERFORM public.anonymize_member(v_owner, v_user, 'owner', pg_temp.req_id(v_req), NULL, NULL, false, NULL, 'rh10-t14f', NULL, true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    v_res := 'ERR ' || SQLERRM;
  END;
  PERFORM pg_temp.expect(v_res, 'ERR MEMBER_WITHDRAW_NEW_CHARGE', 'T14', '요청 뒤 새로 지급한 무상 크레딧(합계는 동의 이하) → MEMBER_WITHDRAW_NEW_CHARGE');
  PERFORM pg_temp.check(v_detail::jsonb -> 'sourceIds' = (SELECT jsonb_agg(id::text) FROM public.credit_sources
                                                          WHERE user_id = v_user AND source_category = 'admin_grant' AND id <> v_desc),
    'T14', 'DETAIL sourceIds = 요청 뒤 지급한 무상 원천만(요청 전 무상 원천은 아님)');

  -- (M5) 요청 뒤 옛 충전을 모두 쓰고 같은 크기로 새로 충전 → 새 충전의 환불 기간이 지난 뒤 대표 처리도 거절(합계는 동의 값과 같음)
  v_user := pg_temp.new_user('t14d');
  v_paid := pg_temp.paid(v_user, 40);
  v_req := pg_temp.try_request(v_user, 'screen', v_user);
  PERFORM pg_temp.expect(v_req, 'OK', 'T14', '(M5) 준비: 유료 10,000 요청');
  -- 시간 경과 흉내: 요청을 20일 전으로(요청 표 가드는 이 시험에서만 잠깐 끔 — 이 거래에서 만든 표)
  ALTER TABLE public.member_withdrawal_requests DISABLE TRIGGER guard_member_withdrawal_requests_mutation;
  UPDATE public.member_withdrawal_requests SET created_at = now() - interval '20 days', received_at = now() - interval '20 days'
   WHERE id = pg_temp.req_id(v_req);
  ALTER TABLE public.member_withdrawal_requests ENABLE TRIGGER guard_member_withdrawal_requests_mutation;
  PERFORM pg_temp.use_credits((v_paid ->> 'source_id')::uuid, 10000);
  v_paid2 := pg_temp.paid(v_user, 15);
  v_f := public.member_withdrawal_facts(v_user, true);
  PERFORM pg_temp.check((v_f -> 'balance' ->> 'forfeitPaid')::int = 10000 AND jsonb_array_length(v_f -> 'refundPeriodOpen') = 0
    AND (v_f ->> 'inProgressTotal')::int = 0, 'T14', '(M5) 새 충전 10,000(15일 전, 기간·여유 지남) — 합계는 동의 10,000 과 같음');
  v_detail := NULL;
  BEGIN
    PERFORM public.anonymize_member(v_owner, v_user, 'owner', pg_temp.req_id(v_req), NULL, NULL, false, NULL, 'rh10-t14d', NULL, true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    v_res := 'ERR ' || SQLERRM;
  END;
  PERFORM pg_temp.expect(v_res, 'ERR MEMBER_WITHDRAW_NEW_CHARGE', 'T14', '(M5) 요청 뒤 새로 충전한 유료 크레딧이 소멸 대상 → MEMBER_WITHDRAW_NEW_CHARGE');
  PERFORM pg_temp.check(v_detail::jsonb -> 'sourceIds' = jsonb_build_array(v_paid2 ->> 'source_id')
    AND NOT EXISTS (SELECT 1 FROM public.withdrawn_member_records WHERE user_id = v_user)
    AND (SELECT status FROM public.member_withdrawal_requests WHERE id = pg_temp.req_id(v_req)) = 'pending',
    'T14', '(M5) DETAIL sourceIds = 새 충전 원천, 보관함 없음·요청 pending 유지');
  -- 대조: 요청 뒤 옛 원천에 재지급된 자손(뿌리가 요청 전)은 새 충전이 아니다
  v_user := pg_temp.new_user('t14e');
  v_paid := pg_temp.paid(v_user, 40);
  v_req := pg_temp.try_request(v_user, 'screen', v_user);
  PERFORM pg_temp.use_credits((v_paid ->> 'source_id')::uuid, 1000);
  v_mo := pg_temp.market_order(v_user, false);
  INSERT INTO public.market_refund_requests (workspace_subject, user_id, item_id, target_kind, order_id, requested_refund_credits, status, processed_at)
  SELECT o.workspace_subject, v_user, o.item_id, 'v2_order', o.id, 1000, 'approved', clock_timestamp() FROM public.market_purchase_orders o WHERE o.id = v_mo
  RETURNING id INTO v_mr;
  INSERT INTO public.credit_sources (user_id, initial_credits, remaining_credits, status, source_category, created_at)
  VALUES (v_user, 1000, 1000, 'active', 'system_refund', clock_timestamp()) RETURNING id INTO v_desc;
  INSERT INTO public.market_refund_reissued_sources (source_id, request_id, original_source_id) VALUES (v_desc, v_mr, (v_paid ->> 'source_id')::uuid);
  PERFORM pg_temp.expect(pg_temp.try_anon(v_owner, v_user, 'owner', pg_temp.req_id(v_req), NULL, NULL, false, NULL, 'rh10-t14e', NULL, true),
    'OK', 'T14', '(M5 대조) 요청 뒤 옛 충전의 재지급 자손(뿌리는 요청 전)은 새 충전 아님 → 처리');

  -- 막힘 화면의 [광고 수신 동의만 지금 철회](source mypage)
  v_user := pg_temp.new_user('t14c');
  PERFORM pg_temp.consent_all(v_user, true);
  PERFORM pg_temp.paid(v_user, 0.01);
  PERFORM pg_temp.check(NOT (public.member_withdrawal_facts(v_user, true) ->> 'requestAllowed')::boolean, 'T14', '환불 기간 안이라 요청 막힘');
  PERFORM pg_temp.marketing_set(v_user, false);
  PERFORM pg_temp.check(pg_temp.marketing_latest(v_user) = 'false:mypage', 'T14', '막힘 화면에서 광고 수신 동의만 철회(mypage)');
END $rh_t14$;

-- T15: point_charge_cash_value 계산 고정(재지급 자손 포함), 탈퇴 차단 여유일
DO $rh_t15$
DECLARE
  v_user uuid;
  v_paid jsonb;
  v_root uuid;
  v_desc uuid;
  v_mo uuid;
  v_mr uuid;
  v_f jsonb;
  v_plan uuid;
  v_src uuid;
  v_n jsonb;
  v_req text;
  v_res text;
BEGIN
  v_user := pg_temp.new_user('t15');
  v_paid := pg_temp.paid(v_user, 40, 10000, 10000);
  v_root := (v_paid ->> 'source_id')::uuid;
  v_mo := pg_temp.market_order(v_user, false);
  INSERT INTO public.market_refund_requests (workspace_subject, user_id, item_id, target_kind, order_id, requested_refund_credits, status, processed_at)
  SELECT o.workspace_subject, v_user, o.item_id, 'v2_order', o.id, 100, 'approved', now() - interval '30 days' FROM public.market_purchase_orders o WHERE o.id = v_mo
  RETURNING id INTO v_mr;
  INSERT INTO public.credit_sources (user_id, initial_credits, remaining_credits, status, source_category, created_at)
  VALUES (v_user, 3000, 3000, 'active', 'system_refund', now() - interval '30 days') RETURNING id INTO v_desc;
  INSERT INTO public.market_refund_reissued_sources (source_id, request_id, original_source_id) VALUES (v_desc, v_mr, v_root);
  INSERT INTO public.refund_requests (user_id, source_id, reason, status, payment_order_id, provider, refund_amount, origin, processed_at)
  VALUES (v_user, v_root, 'RH10 부분 환불', 'completed', (v_paid ->> 'order_id')::uuid, 'payapp', 1000, 'external_cancel', now() - interval '35 days');
  INSERT INTO public.credit_transactions (user_id, type, amount, balance_after, description, source_id)
  VALUES (v_user, 'refund', -2000, 0, 'RH10 회수', v_desc);
  -- 원 = 크레딧 × (10,000 − 1,000) ÷ (10,000 − 2,000), 1원 미만 버림
  PERFORM pg_temp.check(public.point_charge_cash_value(v_root, 3000) = 3375 AND public.point_charge_cash_value(v_desc, 1000) = 1125
    AND public.point_charge_cash_value(v_desc, 3) = 3 AND public.point_charge_cash_value(v_root, 7) = 7 AND public.point_charge_cash_value(v_root, 0) = 0,
    'T15', '원 환산 고정: 3,000→3,375원, 자손 1,000→1,125원, 3→3원(3.375 버림), 7→7원(7.875 버림)');
  PERFORM pg_temp.grant_free(v_user, 100);
  PERFORM pg_temp.check(public.point_charge_cash_value((SELECT id FROM public.credit_sources WHERE user_id = v_user AND source_category = 'admin_grant'), 100) IS NULL,
    'T15', '무상 원천(유료 뿌리 없음)은 NULL');
  v_f := public.member_withdrawal_facts(v_user, true);
  PERFORM pg_temp.check((SELECT count(*) FROM jsonb_array_elements(v_f -> 'balance' -> 'breakdown') e WHERE (e ->> 'paid')::boolean) = 2
    AND (SELECT (e ->> 'paid_root_id')::uuid FROM jsonb_array_elements(v_f -> 'balance' -> 'breakdown') e WHERE (e ->> 'source_id')::uuid = v_desc) = v_root
    AND (v_f -> 'balance' ->> 'paidCashValue')::int = public.point_charge_cash_value(v_root, 10000) + public.point_charge_cash_value(v_desc, 3000)
    AND (v_f -> 'balance' ->> 'forfeitFree')::int = 100,
    'T15', '재지급 자손은 유료(뿌리 연결)로 분류, 원 환산 합 = 원천별 합');

  -- 여유일: 기준 9일 전(마감은 지났지만 여유 안) → 막힘, 12일 전 → 풀림
  v_user := pg_temp.new_user('t15b');
  PERFORM pg_temp.paid(v_user, 9);
  v_f := public.member_withdrawal_facts(v_user, true);
  PERFORM pg_temp.check(jsonb_array_length(v_f -> 'refundPeriodOpen') = 1 AND (v_f -> 'refundPeriodOpen' -> 0 ->> 'inBuffer')::boolean
    AND (v_f -> 'refundPeriodOpen' -> 0 ->> 'deadline')::timestamptz <= now(), 'T15', '마감 뒤 여유 3일 안 → 탈퇴 차단(inBuffer)');
  v_user := pg_temp.new_user('t15c');
  PERFORM pg_temp.paid(v_user, 12);
  v_f := public.member_withdrawal_facts(v_user, true);
  PERFORM pg_temp.check(jsonb_array_length(v_f -> 'refundPeriodOpen') = 0, 'T15', '마감 + 여유가 지나면 차단 풀림');

  -- (M4) 원 환산을 모르는 유료 원천: 주문 없는 plan_purchase 10,000 + 같은 때 payment_history 9,900원(운영 회원 ef404e51 과 같은 모양)
  v_user := pg_temp.new_user('t15d');
  PERFORM pg_temp.consent_all(v_user, false);
  SELECT id INTO v_plan FROM public.pricing_plans WHERE is_active ORDER BY price LIMIT 1;
  INSERT INTO public.credit_sources (user_id, initial_credits, remaining_credits, status, source_category, plan_id, purchased_at, created_at, updated_at)
  VALUES (v_user, 10000, 10000, 'active', 'plan_purchase', v_plan, now() - interval '217 days', now() - interval '217 days', now() - interval '217 days')
  RETURNING id INTO v_src;
  INSERT INTO public.payment_history (user_id, source_id, plan_id, amount, payment_method, payment_key, status, created_at, updated_at)
  VALUES (v_user, v_src, v_plan, 9900, '계좌이체', 'rh10-tgen-' || v_user, 'completed', now() - interval '217 days', now() - interval '217 days');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM public.credit_source_paid_root(v_src)) AND public.point_charge_cash_value(v_src, 10000) IS NULL,
    'T15', '(M4) 준비: 뿌리 주문 없는 plan_purchase — 원 환산 NULL');
  v_f := public.member_withdrawal_facts(v_user, true);
  PERFORM pg_temp.check((v_f ->> 'hadPayment')::boolean AND (v_f -> 'balance' ->> 'paidCashValueUnknown')::boolean
    AND jsonb_array_length(v_f -> 'refundPeriodOpen') = 0
    AND v_f -> 'requestReasons' = '["CASH_VALUE_UNKNOWN"]'::jsonb AND NOT (v_f ->> 'requestAllowed')::boolean
    AND v_f -> 'selfReasons' ? 'CASH_VALUE_UNKNOWN',
    'T15', '(M4) facts: 결제 회원·원 환산 모름 → requestReasons [CASH_VALUE_UNKNOWN] 하나뿐(요청 막힘), selfReasons 에도 있음');
  v_n := public.get_member_withdrawal_notice(v_user, 'request', NULL);
  PERFORM pg_temp.check(strpos(v_n ->> 'text', '0원') = 0
    AND strpos(v_n ->> 'text', replace(replace(replace(public.member_withdrawal_policy() -> 'texts' -> 'notice' ->> 'creditsCashUnknown',
          '{소멸크레딧}', '10,000'), '{유료소멸크레딧}', '10,000'), '{무상소멸크레딧}', '0')) > 0
    AND strpos(v_n ->> 'text', replace(replace(public.member_withdrawal_policy() -> 'texts' -> 'notice' ->> 'creditLinePaidCashUnknown',
          '{크레딧}', '10,000'), '{만료일}', public.member_withdrawal_policy() -> 'texts' -> 'notice' ->> 'noExpiry')) > 0,
    'T15', '(M4) 고지 원문에 0원이 없고 원 환산은 결제 내역 확인 문구(합계 줄·원천 줄)');
  PERFORM pg_temp.expect(pg_temp.try_request(v_user, 'screen', v_user), 'ERR MEMBER_WITHDRAW_REQUEST_INVALID', 'T15', '(M4) 화면 요청 거절(DETAIL reason CASH_VALUE_UNKNOWN)');
  v_req := pg_temp.try_request(v_user, 'email', pg_temp.ctx('owner')::uuid, NULL, 'self', '가입 이메일 회신으로 확인',
                               now() - interval '2 hours', now() - interval '1 hour');
  PERFORM pg_temp.expect(v_req, 'OK', 'T15', '(M4) 대표 email 요청은 받음(결제 내역으로 금액 확인 뒤 고지·회신 기록)');
  v_res := pg_temp.try_anon(pg_temp.ctx('owner')::uuid, v_user, 'owner', pg_temp.req_id(v_req), NULL, NULL, false, NULL, 'rh10-t15d', NULL, false);
  PERFORM pg_temp.expect(v_res, 'OK', 'T15', '(M4) 대표 익명화');
  PERFORM pg_temp.check((pg_temp.res(v_res) ->> 'forfeitedPaid')::int = 10000
    AND (SELECT strpos(consent_notice_text, '0원') = 0 FROM public.withdrawn_member_records WHERE user_id = v_user)
    AND (SELECT (e -> 'cash_value') = 'null'::jsonb FROM public.withdrawn_member_records r, jsonb_array_elements(r.forfeit_breakdown) e
          WHERE r.user_id = v_user AND (e ->> 'source_id')::uuid = v_src),
    'T15', '(M4) 소멸 10,000, 보관함 동의 원문에 0원 없음, breakdown 원 환산 null 그대로');
END $rh_t15$;

-- T16: 1회차 수정 — d3 스스로 익명화가 열린 요청을 닫음, d4 대표 확인 필요 경보 해소, d6 고지 보존 안내·무상만 줄
DO $rh_t16$
DECLARE
  v_owner uuid := pg_temp.ctx('owner')::uuid;
  v_user uuid;
  v_req text;
  v_res text;
  v_r jsonb;
  v_n jsonb;
  v_policy jsonb := public.member_withdrawal_policy();
  v_marketing_at timestamptz;
BEGIN
  -- d3·d4: 비결제 회원에게 대표가 email 요청을 기록(마케팅 즉시 철회) → 회원이 화면에서 직접 탈퇴
  v_user := pg_temp.new_user('t16a');
  PERFORM pg_temp.consent_all(v_user, true);
  PERFORM pg_temp.grant_free(v_user, 300);
  v_req := pg_temp.try_request(v_user, 'email', v_owner, NULL, 'self', '가입 이메일 회신으로 확인');
  PERFORM pg_temp.expect(v_req, 'OK', 'T16', '준비: 비결제 회원 대표 email 요청(마케팅 즉시 철회)');
  v_marketing_at := (pg_temp.res(v_req) -> 'marketing' ->> 'withdrawnAt')::timestamptz;
  PERFORM public.record_payment_alert('MEMBER_WITHDRAW_REVIEW_NEEDED', 'warning', 'RH10 대표 확인 필요',
    jsonb_build_object('dedupe_key', 'member_withdraw_review:' || v_user));
  PERFORM pg_temp.check((public.member_withdrawal_facts(v_user, true) ->> 'selfAllowed')::boolean, 'T16', '대표 확인 필요 경보(user_id 없음)는 스스로 탈퇴를 막지 않음');
  v_res := pg_temp.try_self(v_user, true, 'rh10-t16a-' || v_user);
  PERFORM pg_temp.expect(v_res, 'OK', 'T16', '열린 요청이 있는 비결제 회원 스스로 익명화');
  v_r := pg_temp.res(v_res);
  PERFORM pg_temp.check((SELECT status FROM public.member_withdrawal_requests WHERE id = pg_temp.req_id(v_req)) = 'completed'
    AND (SELECT request_id FROM public.withdrawn_member_records WHERE user_id = v_user) = pg_temp.req_id(v_req)
    AND (v_r -> 'marketing' ->> 'withdrawnAt')::timestamptz = v_marketing_at,
    'T16', '(d3) 열린 요청 completed, 보관함 request_id 연결, 결과 marketing 은 요청 때 철회 시각');
  PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts WHERE code = 'MEMBER_WITHDRAW_REVIEW_NEEDED' AND resolved_at IS NULL
                                     AND details ->> 'dedupe_key' = 'member_withdraw_review:' || v_user)
    AND (v_r -> 'counts' ->> 'reviewAlertsResolved')::int = 1,
    'T16', '(d4) 익명화가 그 회원의 MEMBER_WITHDRAW_REVIEW_NEEDED 경보를 품');

  -- d6: 무상만 있는 비결제 회원 고지 — 유료·원 환산 줄 없음, 무상만 말하는 줄
  v_user := pg_temp.new_user('t16b');
  PERFORM pg_temp.grant_free(v_user, 10000);
  v_n := public.get_member_withdrawal_notice(v_user, 'self', true);
  PERFORM pg_temp.check(strpos(v_n ->> 'text', '유료') = 0 AND strpos(v_n ->> 'text', '원 환산') = 0
    AND strpos(v_n ->> 'text', replace(v_policy -> 'texts' -> 'notice' ->> 'creditsFreeOnly', '{무상소멸크레딧}', '10,000')) > 0
    AND strpos(v_n ->> 'text', '결제 시도 기록') = 0,
    'T16', '(d6) 무상만 → creditsFreeOnly 줄, 유료·원 환산·보존 기록 줄 없음');
  -- d6: 결제 시도만 있는 회원 — 결제 시도 기록 보존 안내
  v_user := pg_temp.new_user('t16c');
  PERFORM pg_temp.new_order(v_user, 'expired', now() - interval '30 days', NULL, 9900, 10000, 'expired');
  v_n := public.get_member_withdrawal_notice(v_user, 'self', true);
  PERFORM pg_temp.check(strpos(v_n ->> 'text', replace(v_policy -> 'texts' -> 'notice' ->> 'retainedAttemptOnly', '{결제시도보존기간}', v_policy ->> 'attemptRecordRetentionYears')) > 0
    AND strpos(v_n ->> 'text', '{') = 0,
    'T16', '(d6) 결제 시도만 → retainedAttemptOnly 줄(연수는 설정 attemptRecordRetentionYears)');
  PERFORM pg_temp.expect(pg_temp.try_self(v_user, true, 'rh10-t16c-' || v_user), 'OK', 'T16', '(d6) 같은 원문으로 스스로 익명화 통과');
  -- d6: 결제 회원 — 연락처 분리 보관·결제 기록 보존 안내
  v_user := pg_temp.new_user('t16d');
  PERFORM pg_temp.paid(v_user, 40);
  v_n := public.get_member_withdrawal_notice(v_user, 'request', NULL);
  PERFORM pg_temp.check(strpos(v_n ->> 'text', replace(v_policy -> 'texts' -> 'notice' ->> 'retainedPayer', '{결제기록보존기간}', v_policy ->> 'paymentRetentionYears')) > 0
    AND strpos(v_n ->> 'text', replace(replace(replace(replace(v_policy -> 'texts' -> 'notice' ->> 'credits', '{소멸크레딧}', '10,000'),
          '{유료소멸크레딧}', '10,000'), '{무상소멸크레딧}', '0'), '{유료원환산}', '9,900')) > 0,
    'T16', '(d6) 결제 회원 → retainedPayer 줄(연수는 설정 paymentRetentionYears), 원 환산 9,900원');
  -- 화면 문구(완료 안내)는 경로별 키가 있고 코드가 채우는 자리표시만 쓴다
  PERFORM pg_temp.check(NULLIF(v_policy -> 'texts' ->> 'completionKeptNonPayer', '') IS NOT NULL
    AND NULLIF(v_policy -> 'texts' ->> 'completionKeptAttemptOnly', '') IS NOT NULL
    AND NULLIF(v_policy -> 'texts' ->> 'completionKeptTickets', '') IS NOT NULL
    AND NULLIF(v_policy -> 'texts' -> 'blockReasons' ->> 'CASH_VALUE_UNKNOWN', '') IS NOT NULL,
    'T16', '(d6·M4) 완료 문구 경로별 키·CASH_VALUE_UNKNOWN 막힘 문구가 정책 texts 에 있음');
END $rh_t16$;

-- G: 가드 예외는 설정이 있을 때만(설정 없거나 다른 회원 값이면 거절)
DO $rh_guard$
DECLARE
  v_user uuid;
  v_other uuid;
  v_t uuid;
  v_rv uuid;
  v_ev uuid;
  v_req uuid;
  v_rec uuid := pg_temp.ctx('t1_user')::uuid;
BEGIN
  v_user := pg_temp.new_user('g');
  v_other := pg_temp.new_user('g2');
  PERFORM pg_temp.consent_all(v_user, false);
  v_t := pg_temp.new_ticket(v_user, 'RH10 가드', '내용', 'resolved', 'etc');
  INSERT INTO public.support_ticket_revisions (ticket_id, subject, message, written_at) VALUES (v_t, 'a', 'b', now()) RETURNING id INTO v_rv;
  SELECT id INTO v_ev FROM public.admin_events WHERE ref_table = 'support_tickets' AND ref_id = v_t;
  PERFORM pg_temp.expect(pg_temp.try_sql(format('DELETE FROM public.user_consents WHERE user_id = %L', v_user)), 'ERR USER_CONSENTS_APPEND_ONLY', 'G', '동의 기록 DELETE: 설정 없으면 거절');
  PERFORM set_config('app.member_withdrawal_bypass', v_other::text, true);
  PERFORM pg_temp.expect(pg_temp.try_sql(format('DELETE FROM public.user_consents WHERE user_id = %L', v_user)), 'ERR USER_CONSENTS_APPEND_ONLY', 'G', '동의 기록 DELETE: 다른 회원 설정이면 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('UPDATE public.admin_events SET title = %L WHERE id = %L', 'x', v_ev)), 'ERR ADMIN_EVENTS_APPEND_ONLY', 'G', '관리자 이벤트: 다른 회원 설정이면 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('UPDATE public.support_ticket_revisions SET subject = %L WHERE id = %L', 'x', v_rv)), 'ERR SUPPORT_TICKET_REVISIONS_APPEND_ONLY', 'G', '수정 이력: 다른 회원 설정이면 거절');
  PERFORM set_config('app.member_withdrawal_bypass', v_user::text, true);
  PERFORM pg_temp.expect(pg_temp.try_sql(format('UPDATE public.admin_events SET kind = %L WHERE id = %L', 'x', v_ev)), 'ERR ADMIN_EVENTS_APPEND_ONLY', 'G', '관리자 이벤트: 설정이 있어도 다른 칸 변경 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('DELETE FROM public.admin_events WHERE id = %L', v_ev)), 'ERR ADMIN_EVENTS_APPEND_ONLY', 'G', '관리자 이벤트: 설정이 있어도 DELETE 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('UPDATE public.admin_events SET title = %L WHERE id = %L', 'RH10 바꿈', v_ev)), 'OK rows=1', 'G', '관리자 이벤트: 그 회원 설정이면 title UPDATE 받음');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('UPDATE public.support_ticket_revisions SET written_at = now() - interval ''1 day'' WHERE id = %L', v_rv)), 'ERR SUPPORT_TICKET_REVISIONS_APPEND_ONLY', 'G', '수정 이력: 설정이 있어도 written_at 변경 거절');
  PERFORM set_config('app.member_withdrawal_bypass', '', true);
  PERFORM pg_temp.expect(pg_temp.try_sql(format('UPDATE public.admin_events SET title = %L WHERE id = %L', 'x', v_ev)), 'ERR ADMIN_EVENTS_APPEND_ONLY', 'G', '관리자 이벤트: 설정 없으면 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql('TRUNCATE public.admin_events'), 'ERR', 'G', '관리자 이벤트 TRUNCATE 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('UPDATE public.withdrawn_member_records SET email = %L WHERE user_id = %L', 'x', v_rec)), 'ERR WITHDRAWN_MEMBER_RECORDS_APPEND_ONLY', 'G', '보관함 칸 변경 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('DELETE FROM public.withdrawn_member_records WHERE user_id = %L', v_rec)), 'ERR', 'G', '보관함 DELETE 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('UPDATE public.withdrawn_member_records SET auth_scrubbed_at = now() WHERE user_id = %L', v_rec)), 'OK rows=1', 'G', '보관함 auth_scrubbed_at NULL→값만 받음');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('UPDATE public.withdrawn_member_records SET auth_scrubbed_at = NULL WHERE user_id = %L', v_rec)), 'ERR WITHDRAWN_MEMBER_RECORDS_APPEND_ONLY', 'G', '보관함 auth_scrubbed_at 값→NULL 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql('UPDATE public.withdrawn_member_record_events SET details = ''{}''::jsonb'), 'ERR WITHDRAWN_MEMBER_RECORD_EVENTS_APPEND_ONLY', 'G', '추가 기록 UPDATE 거절');
  SELECT id INTO v_req FROM public.member_withdrawal_requests WHERE status = 'completed' LIMIT 1;
  PERFORM pg_temp.expect(pg_temp.try_sql(format('UPDATE public.member_withdrawal_requests SET status = %L WHERE id = %L', 'pending', v_req)), 'ERR MEMBER_WITHDRAWAL_REQUESTS_APPEND_ONLY', 'G', '요청 completed → pending 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('UPDATE public.member_withdrawal_requests SET notice_text = %L WHERE id = %L', 'x', v_req)), 'ERR MEMBER_WITHDRAWAL_REQUESTS_APPEND_ONLY', 'G', '요청 고지 원문 변경 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('UPDATE public.payment_orders SET request_fingerprint = %L WHERE user_id = %L', 'x', pg_temp.ctx('t1_user'))), 'ERR PAYMENT_ORDER_IMMUTABLE_SNAPSHOT', 'G', '주문 fingerprint: 설정 없으면 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql(format('UPDATE public.system_settings SET value = value WHERE key = %L', 'member_withdrawal_policy')), 'OK', 'G', 'postgres 는 설정 수정 가능(정책은 화면 세션만 막음)');
END $rh_guard$;
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.ctx('owner'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $rh_guard_policy$
BEGIN
  PERFORM pg_temp.expect(pg_temp.try_sql('UPDATE public.system_settings SET value = value WHERE key = ''member_withdrawal_policy'''), 'OK rows=0', 'G',
    '화면 세션(대표 JWT)은 member_withdrawal_policy 를 고칠 수 없음(RESTRICTIVE)');
END $rh_guard_policy$;
RESET ROLE;

-- T16 (d7): 스스로 익명화 스위치를 켠 상태에서 마이그레이션 VERIFY 를 다시 실행 → 멈추지 않는다
DO $verify_member_withdrawal$
DECLARE
  v_value jsonb;
  v_text text;
  v_count integer;
  v_acl text;
  v_sig text;
  v_key text;
  v_order uuid;
  v_event uuid;
  v_ok boolean;
  v_new text[][] := ARRAY[
    ARRAY['public.payapp_fulfill_order_internal(uuid,timestamp with time zone)', '657bbb07ae4b250a2697f21e2aa805e9'],
    ARRAY['public.apply_payapp_feedback(text,text,text,text,integer,integer,integer,integer,timestamp with time zone,timestamp with time zone)', '1859412411fc132dacfae4ca7a89eba4'],
    ARRAY['public.retry_payapp_fulfillment(uuid)', '93cde859327328f598e71059dcc04e6d'],
    ARRAY['public.resolve_payment_order_review(uuid,text,uuid,text,text,timestamp with time zone,text)', 'cbe116d85e140991d5993b5563296b37'],
    ARRAY['public.prepare_payment_order(uuid,uuid,text,uuid,text,text,integer,integer,text,text,text,text,text,timestamp with time zone,integer,integer,text,text)', '93e0bd5e41969f66f296f4353f3feeb9'],
    ARRAY['public.begin_payapp_request(uuid)', '679b4474c0dc42de11e5e9a14a7d1d4d'],
    ARRAY['public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)', 'be4403fd993c45d618950a5908a91591'],
    ARRAY['public.process_payapp_cancellation(uuid)', 'e0f752c7759626790a2afb86eab6aee6'],
    ARRAY['public.payapp_sales_resume_blockers()', 'edbb1eb553719198ffa9f9bc0d3aca4c'],
    ARRAY['public.enforce_payment_reconciliation_health()', 'e563ade9c072b09e26844b655e918755'],
    ARRAY['public.prevent_payment_order_snapshot_update()', '940bcad422d63c58e5d31c5756b0d473'],
    ARRAY['public.consent_record_internal(uuid,jsonb,text)', '61a9beb9d7f94cf6b0ed9b4518b52b44'],
    ARRAY['public.guard_user_consents_mutation()', '4ba21dab0a28e0c117bbead375a3fc8f'],
    ARRAY['public.guard_market_purchase_notice_acks_mutation()', '3959ac2b8139d0f81365df59ed67ef10'],
    ARRAY['public.prevent_admin_event_mutation()', 'f35f60e1461e49138635ffd4a11a27f9'],
    ARRAY['public.remind_unanswered_admin_work()', 'b950b1bfecc0ed4d470293508c0e2a60'],
    ARRAY['public.guard_support_ticket_revisions_mutation()', '1a8d96fc0bfe469e491b86c2f866e3bd'],
    ARRAY['public.cancel_incomplete_kakao_signup(uuid)', 'a83431d12c4686a0fbe57976a82038fe'],
    ARRAY['public.complete_kakao_signup_with_consents(uuid,jsonb,text,text,text,text)', 'a43e805089f08a12e22721168dbe962a'],
    ARRAY['public.consent_eligible_member_count()', '4b1c6999080f9bf6978be808997fd9ac']
  ];
  i integer;
BEGIN
  -- 9-1. 설정 모양(스스로 익명화 스위치는 값이 아니라 boolean 키가 있는지만 본다 — 켠 뒤 재적용해도 멈추지 않게. 처음 넣는 값은 false)
  SELECT value INTO v_value FROM public.system_settings WHERE key = 'member_withdrawal_policy';
  IF v_value IS NULL OR jsonb_typeof(v_value -> 'version') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_value -> 'selfAnonymizeEnabled') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(v_value -> 'texts') IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_value -> 'texts' -> 'notice') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'VERIFY: member_withdrawal_policy shape';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['paymentRetentionYears', 'payerTicketRetentionYears', 'payerRefundTicketRetentionYears',
                               'nonPayerTicketRetentionYears', 'attemptRecordRetentionYears', 'withdrawalRecordRetentionYears',
                               'consentRecordRetentionYears', 'selfWithdrawOrderQuietDays', 'withdrawRefundDeadlineBufferDays'] LOOP
    IF public.member_withdrawal_policy_days(v_key) IS NULL THEN
      RAISE EXCEPTION 'VERIFY: policy number %', v_key;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['noticeTitle', 'confirmLabel', 'adminEventTitle', 'redactionMask', 'marketingResult',
                               'forfeitDescription', 'cleanupDescription', 'alertAuthScrubPending', 'alertHeldOrderFeedbackMismatch',
                               'alertClosedHeldOrderCancelFailed', 'finishDeleteNotice', 'finishDeleteButton', 'paymentReviewHeldOrder'] LOOP
    IF NULLIF(btrim(v_value -> 'texts' ->> v_key), '') IS NULL THEN
      RAISE EXCEPTION 'VERIFY: policy text %', v_key;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['downloads', 'noCarryOver', 'reviews', 'ticketsPayer', 'ticketsKeep', 'ticketsDelete', 'ticketsChoice',
                               'pendingTickets', 'pendingTicketsDelete', 'pendingTicketsChoice', 'credits', 'creditLinePaid', 'creditLineFree', 'noExpiry', 'noCredits', 'legalRefund',
                               'marketingSelf', 'marketingRequest', 'useBeforeRequest', 'irreversible', 'termsVersion',
                               'creditsFreeOnly', 'creditsCashUnknown', 'creditLinePaidCashUnknown', 'retainedPayer', 'retainedAttemptOnly'] LOOP
    IF NULLIF(btrim(v_value -> 'texts' -> 'notice' ->> v_key), '') IS NULL THEN
      RAISE EXCEPTION 'VERIFY: policy notice text %', v_key;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.signup_consent_items i WHERE i.key = v_value ->> 'marketingConsentItemKey')
     OR NOT EXISTS (SELECT 1 FROM public.signup_consent_items i WHERE i.key = v_value ->> 'termsConsentItemKey') THEN
    RAISE EXCEPTION 'VERIFY: consent item keys';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings'
                  AND policyname = 'system_settings_member_withdrawal_policy_no_client_write' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'VERIFY: no_client_write policy';
  END IF;

  -- 9-2. 칸·CHECK
  SELECT count(*) INTO v_count FROM information_schema.columns
   WHERE table_schema = 'public'
     AND ((table_name = 'profiles' AND column_name = 'withdrawn_at')
          OR (table_name IN ('support_tickets', 'support_ticket_revisions', 'refund_requests', 'market_refund_requests')
              AND column_name = 'redaction_reviewed_at'));
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'VERIFY: columns = %', v_count;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_transactions_type_check' AND pg_get_constraintdef(oid) LIKE '%withdrawal_forfeit%')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_consents_source_check' AND pg_get_constraintdef(oid) LIKE '%''withdrawal''%')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_admin_actions_action_check' AND pg_get_constraintdef(oid) LIKE '%withdrawn_held_order_closed%') THEN
    RAISE EXCEPTION 'VERIFY: check constraints';
  END IF;

  -- 9-3. 새 표: RLS·정책 없음·권한·가드
  FOREACH v_key IN ARRAY ARRAY['member_withdrawal_requests', 'withdrawn_member_records', 'withdrawn_member_record_events'] LOOP
    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = ('public.' || v_key)::regclass) THEN
      RAISE EXCEPTION 'VERIFY: RLS %', v_key;
    END IF;
    SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public' AND tablename = v_key;
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'VERIFY: policies on % = %', v_key, v_count;
    END IF;
    SELECT count(*) INTO v_count FROM pg_trigger WHERE tgrelid = ('public.' || v_key)::regclass AND NOT tgisinternal;
    IF v_count <> 2 THEN
      RAISE EXCEPTION 'VERIFY: triggers on % = %', v_key, v_count;
    END IF;
  END LOOP;
  SELECT string_agg(format('%s:%s:%s', table_name, grantee, privilege_type), ', ') INTO v_text
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name IN ('member_withdrawal_requests', 'withdrawn_member_records', 'withdrawn_member_record_events')
     AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
     AND NOT (table_name = 'member_withdrawal_requests' AND grantee = 'service_role' AND privilege_type = 'SELECT');
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: table grants: %', v_text;
  END IF;

  -- 9-4. 탈퇴 회원 숨김 정책(RESTRICTIVE 4개)
  SELECT count(*) INTO v_count FROM pg_policies
   WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE'
     AND (tablename, policyname) IN (('support_tickets', 'support_tickets_withdrawn_hidden'),
                                     ('market_refund_requests', 'market_refund_requests_withdrawn_hidden'),
                                     ('support_ticket_revisions', 'support_ticket_revisions_withdrawn_hidden'),
                                     ('refund_requests', 'refund_requests_withdrawn_hidden'));
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'VERIFY: withdrawn hidden policies = %', v_count;
  END IF;

  -- 9-5. 보호 트리거
  SELECT count(*) INTO v_count FROM pg_trigger t
   WHERE NOT t.tgisinternal
     AND ((t.tgname = 'guard_withdrawn_member_write'
           AND t.tgrelid IN ('public.support_tickets'::regclass, 'public.support_ticket_revisions'::regclass, 'public.questions'::regclass,
                             'public.passages'::regclass, 'public.exam_papers'::regclass, 'public.exam_paper_items'::regclass))
          OR (t.tgname = 'guard_withdrawn_member_view_event' AND t.tgrelid = 'public.market_item_view_events'::regclass)
          OR (t.tgname = 'guard_withdrawn_member_credit_source' AND t.tgrelid = 'public.credit_sources'::regclass)
          OR (t.tgname = 'guard_withdrawn_member_notification' AND t.tgrelid = 'public.notifications'::regclass)
          OR (t.tgname = 'record_withdrawn_member_manual_refund' AND t.tgrelid = 'public.refund_requests'::regclass));
  IF v_count <> 10 THEN
    RAISE EXCEPTION 'VERIFY: protection triggers = %', v_count;
  END IF;

  -- 9-6. (3a) PUBLIC/anon 이 실행할 수 있는 SECURITY DEFINER 함수는 handle_new_user 뿐
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_text
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.prosecdef
     AND (p.proacl IS NULL OR p.proacl::text ~ '(\{|,)(=|anon=)X')
     AND p.proname <> 'handle_new_user';
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: public/anon executable definer functions: %', v_text;
  END IF;

  -- 9-7. 함수 ACL·정의자·search_path
  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_member_withdrawal_preview(uuid,boolean)',
    'public.get_member_withdrawal_notice(uuid,text,boolean)',
    'public.create_member_withdrawal_request(uuid,text,text,text,integer,integer,integer,text,uuid,boolean,text,timestamp with time zone,timestamp with time zone,timestamp with time zone)',
    'public.record_member_withdrawal_request_reply(uuid,uuid,timestamp with time zone,timestamp with time zone,boolean)',
    'public.cancel_member_withdrawal_request(uuid,uuid)',
    'public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)',
    'public.redact_member_text(uuid,text,uuid,text,text,text)',
    'public.mark_member_text_reviewed(uuid,text,uuid)',
    'public.close_withdrawn_member_held_order(uuid,uuid,text,text,text)',
    'public.add_withdrawn_member_event(uuid,uuid,text,uuid,jsonb)',
    'public.mark_withdrawn_member_auth_scrubbed(uuid)',
    'public.withdrawn_member_kakao_unlink_target(uuid)',
    'public.clear_withdrawn_member_kakao_unlink(uuid,text)',
    'public.read_withdrawn_member_record(uuid,uuid,text,jsonb)',
    'public.read_withdrawn_member_ticket(uuid,uuid,text,jsonb)',
    'public.scrub_member_admin_events(uuid)',
    'public.withdrawn_member_account_status(uuid)',
    'public.resolve_member_full_delete_auth_alert(uuid)',
    'public.withdrawn_member_held_order_ids(uuid[])'] LOOP
    SELECT p.proacl::text INTO v_acl FROM pg_proc p WHERE p.oid = v_sig::regprocedure;
    IF v_acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
      RAISE EXCEPTION 'VERIFY: service acl % = %', v_sig, v_acl;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_sig::regprocedure AND p.prosecdef
                    AND p.proconfig = ARRAY['search_path=public, pg_temp']) THEN
      RAISE EXCEPTION 'VERIFY: definer/search_path %', v_sig;
    END IF;
  END LOOP;
  FOREACH v_sig IN ARRAY ARRAY[
    'public.member_withdrawal_policy()', 'public.member_withdrawal_policy_days(text)', 'public.member_text_has_long_number(text)',
    'public.point_charge_cash_value(uuid,integer)', 'public.member_withdrawal_facts(uuid,boolean)',
    'public.member_withdrawal_notice_text(text,jsonb,boolean)', 'public.member_admin_event_owner(text,uuid)',
    'public.member_withdrawal_scrub_admin_events(uuid)', 'public.member_withdrawal_require_owner(uuid)',
    'public.guard_member_withdrawal_requests_mutation()', 'public.guard_withdrawn_member_records_mutation()',
    'public.guard_withdrawn_member_record_events_mutation()'] LOOP
    SELECT p.proacl::text INTO v_acl FROM pg_proc p WHERE p.oid = v_sig::regprocedure;
    IF v_acl IS DISTINCT FROM '{postgres=X/postgres}' THEN
      RAISE EXCEPTION 'VERIFY: internal acl % = %', v_sig, v_acl;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_sig::regprocedure AND (p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'])) THEN
      RAISE EXCEPTION 'VERIFY: internal must not be definer / search_path %', v_sig;
    END IF;
  END LOOP;
  FOREACH v_sig IN ARRAY ARRAY[
    'public.guard_withdrawn_member_write()', 'public.guard_withdrawn_member_view_event()', 'public.guard_withdrawn_member_credit_source()',
    'public.guard_withdrawn_member_notification()', 'public.record_withdrawn_member_manual_refund()'] LOOP
    SELECT p.proacl::text INTO v_acl FROM pg_proc p WHERE p.oid = v_sig::regprocedure;
    IF v_acl IS DISTINCT FROM '{postgres=X/postgres}'
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_sig::regprocedure AND p.prosecdef
                       AND p.proconfig = ARRAY['search_path=public, pg_temp']) THEN
      RAISE EXCEPTION 'VERIFY: trigger function % = %', v_sig, v_acl;
    END IF;
  END LOOP;

  -- 9-8. 재정의 함수 새 지문
  FOR i IN 1 .. array_length(v_new, 1) LOOP
    IF v_new[i][1] <> '' AND md5(pg_get_functiondef(v_new[i][1]::regprocedure)) <> v_new[i][2] THEN
      RAISE EXCEPTION 'VERIFY: redefined md5 %', v_new[i][1];
    END IF;
  END LOOP;

  -- 9-9. 가드 예외는 설정이 있을 때만: 설정 없는 주문 fingerprint 변경·관리자 이벤트 UPDATE 는 거절, 다른 회원 설정도 거절
  SELECT o.id INTO v_order FROM public.payment_orders o WHERE o.request_fingerprint IS NOT NULL ORDER BY o.created_at LIMIT 1;
  IF v_order IS NOT NULL THEN
    v_ok := false;
    BEGIN
      UPDATE public.payment_orders SET request_fingerprint = request_fingerprint || 'x' WHERE id = v_order;
    EXCEPTION WHEN OTHERS THEN
      v_ok := SQLERRM = 'PAYMENT_ORDER_IMMUTABLE_SNAPSHOT';
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'VERIFY: order snapshot guard without setting';
    END IF;
    v_ok := false;
    BEGIN
      PERFORM set_config('app.member_withdrawal_bypass', gen_random_uuid()::text, true);
      UPDATE public.payment_orders SET request_fingerprint = request_fingerprint || 'x' WHERE id = v_order;
    EXCEPTION WHEN OTHERS THEN
      v_ok := SQLERRM = 'PAYMENT_ORDER_IMMUTABLE_SNAPSHOT';
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'VERIFY: order snapshot guard with other member setting';
    END IF;
  END IF;
  SELECT e.id INTO v_event FROM public.admin_events e ORDER BY e.created_at LIMIT 1;
  IF v_event IS NOT NULL THEN
    v_ok := false;
    BEGIN
      UPDATE public.admin_events SET title = title WHERE id = v_event;
    EXCEPTION WHEN OTHERS THEN
      v_ok := SQLERRM = 'ADMIN_EVENTS_APPEND_ONLY';
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'VERIFY: admin_events guard without setting';
    END IF;
    v_ok := false;
    BEGIN
      PERFORM set_config('app.member_withdrawal_bypass', gen_random_uuid()::text, true);
      UPDATE public.admin_events SET title = title WHERE id = v_event;
    EXCEPTION WHEN OTHERS THEN
      v_ok := SQLERRM = 'ADMIN_EVENTS_APPEND_ONLY';
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'VERIFY: admin_events guard with other member setting';
    END IF;
  END IF;
  IF COALESCE(current_setting('app.member_withdrawal_bypass', true), '') <> '' THEN
    RAISE EXCEPTION 'VERIFY: bypass setting leaked';
  END IF;

  -- 9-10. 원 환산·긴 번호 규칙 고정
  IF public.member_text_has_long_number('계좌 110-123-456789 입니다') IS NOT TRUE
     OR public.member_text_has_long_number('010 1234 5678') IS NOT TRUE
     OR public.member_text_has_long_number('주문 123-456 789') IS NOT FALSE
     OR public.member_text_has_long_number(NULL) IS NOT FALSE THEN
    RAISE EXCEPTION 'VERIFY: long number rule';
  END IF;
END;
$verify_member_withdrawal$;
DO $rh_t16_verify$
BEGIN
  PERFORM pg_temp.check((SELECT value -> 'selfAnonymizeEnabled' FROM public.system_settings WHERE key = 'member_withdrawal_policy') = 'true'::jsonb,
    'T16', '(d7) selfAnonymizeEnabled=true 상태에서 VERIFY 재실행 통과');
END $rh_t16_verify$;

SELECT n, test, msg FROM _rh_log ORDER BY n;
ROLLBACK;
