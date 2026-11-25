-- 15번 묶음 리허설: A — R1 적용·R3 쓰기 막기와 잠금·R5-2 되돌리기 → 다시 적용(실제 마이그레이션)
-- 생성 파일(손으로 고치지 않는다): node supabase/scripts/bundle15_rehearsal/generate.mjs 가 원본에서 만든다.
-- 실행: supabase db query --remote --yes --file supabase/scripts/bundle15_rehearsal/<이 파일> (COMMIT 없음, 마지막 SELECT 가 결과)
-- 언제: 새벽 03~04시만. CREATE/DROP POLICY·DROP TRIGGER 가 system_settings·signup_consent_items 읽기까지 막는다. lock_timeout 3초.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE _rh_log (n serial PRIMARY KEY, test text NOT NULL, msg text NOT NULL, payload jsonb) ON COMMIT DROP;
CREATE TEMP TABLE _rh_ctx (k text PRIMARY KEY, v text) ON COMMIT DROP;

CREATE FUNCTION pg_temp.ctx_set(p_k text, p_v text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO _rh_ctx (k, v) VALUES (p_k, p_v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v
$f$;
CREATE FUNCTION pg_temp.ctx(p_k text) RETURNS text LANGUAGE sql AS $f$ SELECT v FROM _rh_ctx WHERE k = p_k $f$;

-- 실패는 RAISE EXCEPTION 'RH FAIL …'(900자 안 요약), 성공 기록은 _rh_log.
CREATE FUNCTION pg_temp.log(p_test text, p_msg text, p_payload jsonb DEFAULT NULL) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO _rh_log (test, msg, payload) VALUES (p_test, left(p_msg, 900), p_payload)
$f$;
CREATE FUNCTION pg_temp.fail(p_test text, p_msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  RAISE EXCEPTION 'RH FAIL [%] %', p_test, left(p_msg, 850);
END $f$;
-- 동적 SQL 을 실행하고 'OK' 또는 'ERR 메시지'(앞 300자)를 돌려준다. 실패하면 그 문장의 변경은 되돌려진다.
CREATE FUNCTION pg_temp.try_sql(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR ' || left(SQLERRM, 300);
END $f$;
-- 결과 문자열이 기대 접두어로 시작하는지 본다(case 안에서 쓰는 로그는 변수에 모았다가 표지 예외 뒤에 남긴다).
CREATE FUNCTION pg_temp.expect(p_actual text, p_prefix text, p_test text, p_msg text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_actual IS NULL OR p_actual NOT LIKE p_prefix || '%' THEN
    PERFORM pg_temp.fail(p_test, p_msg || ' — 기대 "' || p_prefix || '", 실제 "' || left(coalesce(p_actual, 'NULL'), 400) || '"');
  END IF;
  RETURN p_msg || ' → ' || left(p_actual, 160);
END $f$;
CREATE FUNCTION pg_temp.ensure(p_cond boolean, p_test text, p_msg text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_cond IS NOT TRUE THEN
    PERFORM pg_temp.fail(p_test, p_msg);
  END IF;
  RETURN p_msg;
END $f$;
CREATE FUNCTION pg_temp.subst_once(p_src text, p_from text, p_to text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_from = '' OR (length(p_src) - length(replace(p_src, p_from, ''))) / length(p_from) <> 1 THEN
    RAISE EXCEPTION 'RH FAIL copy line not found exactly once: %', left(p_from, 200);
  END IF;
  RETURN replace(p_src, p_from, p_to);
END $f$;
CREATE FUNCTION pg_temp.kst_label(p_date date) RETURNS text LANGUAGE sql AS $f$
  SELECT to_char(p_date, 'YYYY"년" FMMM"월" FMDD"일"')
$f$;
CREATE FUNCTION pg_temp.kst_today() RETURNS date LANGUAGE sql AS $f$ SELECT (now() AT TIME ZONE 'Asia/Seoul')::date $f$;
-- 기록자: 가장 최근에 로그인한 대표(스크립트와 같은 규칙)
CREATE FUNCTION pg_temp.owner_id() RETURNS uuid LANGUAGE sql AS $f$
  SELECT p.id FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.is_admin IS TRUE AND p.admin_role = 'owner' AND u.last_sign_in_at IS NOT NULL
   ORDER BY u.last_sign_in_at DESC LIMIT 1
$f$;

-- 원본 DO 블록(생성기가 원본 파일에서 꺼낸 글 그대로)
SELECT pg_temp.ctx_set('src_policy_text', $rh_src_policy_text$DO $policy_text$
DECLARE
  -- 실행 방식: 'publish_upcoming'(게시) | 'apply'(시행) | 'withdraw_upcoming'(고지 그만두기). NULL 이면 멈춘다.
  c_mode constant text := NULL;
  -- 시행일·고지 마감일(이 날이 끝나기 전 KST 에 고지 시작)·시행을 실행할 수 있는 마지막 한국 날짜(기본은 시행일 당일만, 15번 13절 7번)
  c_effective_date constant date := DATE '2027-01-11';
  c_notice_deadline constant date := DATE '2026-12-10';
  c_apply_last_date constant date := DATE '2027-01-11';
  -- 다시 게시(지문이 다르거나 reverted 뒤)·고지 그만두기의 사유. 기본 NULL.
  c_republish_reason constant text := NULL;
  c_withdraw_reason constant text := NULL;

  -- 사전 md5(2026-11-24 운영 DB 에서 읽은 값 — 9번 문구 스크립트 적용 뒤)
  c_refund_md5 constant text := '158f11638e9a58121a9248dc48fbaeef';
  c_terms_md5 constant text := '75271f987f170878440049cc90c84284';
  c_privacy_md5 constant text := 'ddcc8ba57de67025076f12638edeee76';
  c_item_terms_md5 constant text := '1cd29468957ec6eb081b99c68d3973fc';
  c_item_privacy_md5 constant text := '65005b2b5dd7065e6c2fa7a503986c85';
  c_item_terms_version constant integer := 1;
  c_item_privacy_version constant integer := 1;
  -- 대표가 재동의 대상 목록을 확인한 뒤 적는 값(머리 주석의 조회 결과). 시행 때 NULL 이면 실행하지 않는다.
  c_confirmed_count constant integer := NULL;
  c_confirmed_members_md5 constant text := NULL;

  v_date text := to_char(c_effective_date, 'YYYY"년" FMMM"월" FMDD"일"');
  v_weekday text := (ARRAY['일', '월', '화', '수', '목', '금', '토'])[extract(dow FROM c_effective_date)::integer + 1];

  -- ── 이용약관: [옛 조각, 새 조각, 표시 이름, 표시 방식(replace|insert)] 쌍(각 옛 조각은 정확히 1번) ─────────────────────────
  t_pairs text[][];
  -- ── 취소/환불정책 ─────────────────────────────────────────────────────────────────────────────────
  r_pairs text[][];
  -- ── 개인정보처리방침 ──────────────────────────────────────────────────────────────────────────────
  p_pairs text[][];
  -- ── 가입 동의 항목 본문 ───────────────────────────────────────────────────────────────────────────
  it_pairs text[][];
  ip_pairs text[][];
  -- ── 탈퇴 정책 문구(member_withdrawal_policy.texts): [경로, old, new] — 회원이 동의하는 고지 원문·막힘 화면 ─────
  w_paths text[][];
  v_wpolicy jsonb;
  v_wpolicy_new jsonb;
  c_tickets_payer_old_prefix constant text := '1:1 문의는 소비자 불만·분쟁 처리 기록으로 마지막 처리일부터 ';
  v_check jsonb;
  v_member uuid;
  v_member_notice jsonb;
  v_checked integer;
  v_payer_ticket_hits integer;
  v_waudit_before integer;

  c_terms_note constant text := $q$이용약관 제12조(계약 해지와 탈퇴)를 바꿨습니다. 결제 이력이 있는 계정도 탈퇴 화면에서 탈퇴를 요청할 수 있고, 탈퇴하면 남은 크레딧(유료·무상)은 소멸하며 환불되지 않습니다. 다만 미성년자 결제 취소, 자료 하자 등 법령에 따른 환불은 탈퇴한 뒤에도 고객센터로 요청할 수 있습니다. 환불 기간이 남은 충전 건은 쓰지 않았으면 환불받거나 기간이 지난 뒤, 일부를 썼으면 기간이 지난 뒤 탈퇴할 수 있고, 환불 기간이 끝난 뒤 3일 동안은 탈퇴할 수 없습니다. 탈퇴하면 받지 않은 자료의 환불 몫도 소멸하고 구매한 자료를 내려받을 수 없습니다. 취소/환불정책에 '8-2. 회원 탈퇴와 크레딧'을 더했습니다.$q$;
  c_privacy_note constant text := $q$탈퇴한 뒤에도 결제 이력이 있으면 연락처(이메일·휴대폰번호·카카오 계정 이메일)·1:1 문의·동의 기록을, 탈퇴 처리 기록·결제 시도 기록이 남는 회원은 그 기록을 정한 기간 동안 분리 보관하도록 바꿨습니다. 법령에 따라 보존하는 기록과 분쟁 대응을 위해 회사가 보관하는 기록을 나눠 적었습니다(개인정보처리방침 1·2·3·6·7·10절). 결제 이력이 없어도 결제 시도 기록과 탈퇴할 때 보존에 동의한 문의는 정한 기간 동안 보관하며, 탈퇴 요청 기록을 새로 수집합니다.$q$;

  -- 옛 표현(VERIFY: 문서·동의 항목 어디에도 남지 않아야 함)
  c_old_phrases constant text[] := ARRAY['고객센터로 탈퇴를 요청해야 합니다', '결제를 시도한 기록 포함', '5년간 보존합니다',
                                         '2026년 11월 23일', '법령 보존 기록 제외', '계약·청약철회·대금결제 기록을 5년간'];

  -- 보존 기간·일수 대조: [대상(T 약관·R 환불·P 처리방침·I 동의 항목 본문·N 동의 변경 안내·X 탈퇴 막힘 문구), 정규식, 잡을 묶음 번호, 설정 키, 최소 건수]
  c_num_checks constant text[][] := ARRAY[
    ARRAY['PI', $r$마지막 거래일부터 ([0-9]+)년$r$, '1', 'paymentRetentionYears', '2'],
    ARRAY['PI', $r$분쟁 처리 기록\)(를| —) 마지막 처리일부터 ([0-9]+)년$r$, '2', 'payerTicketRetentionYears', '2'],
    ARRAY['PI', $r$환불 신청과 연결된 1:1 문의는 마지막 처리일부터 ([0-9]+)년$r$, '1', 'payerRefundTicketRetentionYears', '2'],
    ARRAY['PI', $r$보존에 동의한 경우에만 마지막 처리일부터 ([0-9]+)년$r$, '1', 'nonPayerTicketRetentionYears', '2'],
    ARRAY['PI', $r$개인정보를 지운 채 마지막 결제 시도일부터 ([0-9]+)년$r$, '1', 'attemptRecordRetentionYears', '2'],
    ARRAY['PI', $r$동의 기록(\([^)]*\))?은 탈퇴일부터 ([0-9]+)년$r$, '2', 'consentRecordRetentionYears', '2'],
    ARRAY['PI', $r$탈퇴 처리 기록\([^)]*\)은 탈퇴일부터 ([0-9]+)년$r$, '1', 'withdrawalRecordRetentionYears', '2'],
    ARRAY['T', $r$최근 ([0-9]+)일 안에 결제 시도가 있으면 ([0-9]+)일이 지난 뒤$r$, '1', 'selfWithdrawOrderQuietDays', '1'],
    ARRAY['T', $r$최근 ([0-9]+)일 안에 결제 시도가 있으면 ([0-9]+)일이 지난 뒤$r$, '2', 'selfWithdrawOrderQuietDays', '1'],
    ARRAY['TRNX', $r$기간이 끝난 뒤 ([0-9]+)일 동안$r$, '1', 'withdrawRefundDeadlineBufferDays', '5']
  ];

  v_policy jsonb;
  v_footer jsonb;
  v_footer_before jsonb;
  v_refund text;
  v_terms text;
  v_privacy text;
  v_refund_new text;
  v_terms_new text;
  v_privacy_new text;
  v_item_terms public.signup_consent_items%ROWTYPE;
  v_item_privacy public.signup_consent_items%ROWTYPE;
  v_item_age14_before public.signup_consent_items%ROWTYPE;
  v_item_marketing_before public.signup_consent_items%ROWTYPE;
  v_item_terms_content text;
  v_item_privacy_content text;
  v_save jsonb;
  v_actor uuid;
  v_snap_before integer;
  v_audit_before integer;
  v_count integer;
  v_ok_before integer;
  v_gated_after integer;
  v_eligible integer;
  v_text text;
  v_target text;
  v_num text;
  v_expected integer;
  v_notice text;
  i integer;

  -- 15번 게시 행(policy_upcoming_documents)
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_pub_old jsonb;
  v_pub_new jsonb;
  v_pub_texts jsonb;
  v_documents jsonb;
  v_consent_items jsonb;
  v_locked_paths jsonb;
  v_changes jsonb;
  v_changes_text text;
  v_pairs text[][];
  v_doc_key text;
  v_doc_before text;
  v_doc_after text;
  v_change_after text;
  v_doc_idx integer;
  v_cont jsonb;
  v_publish_kind text;
  v_chk_terms text;
  v_chk_refund text;
  v_chk_privacy text;
  v_chk_item_terms text;
  v_chk_item_privacy text;
  v_chk_wpolicy jsonb;

BEGIN
  -- 1. 상수 검사(첫날을 넣지 않고 30일을 채우는 규칙) ─────────────────────────────────────────────────────────
  IF c_mode IS NULL OR c_mode NOT IN ('publish_upcoming', 'apply', 'withdraw_upcoming') THEN
    RAISE EXCEPTION 'POLICY_TEXT: set c_mode to publish_upcoming, apply or withdraw_upcoming';
  END IF;
  IF NOT (c_notice_deadline <= c_effective_date - 32) OR NOT (c_apply_last_date >= c_effective_date) THEN
    RAISE EXCEPTION 'POLICY_TEXT: constants — notice deadline must be <= effective date - 32 and apply last date >= effective date';
  END IF;
  -- 시행은 한국 날짜가 c_effective_date ~ c_apply_last_date 일 때만
  IF c_mode = 'apply' AND NOT (v_today BETWEEN c_effective_date AND c_apply_last_date) THEN
    RAISE EXCEPTION 'POLICY_TEXT: apply runs only on % ~ % (KST today %)', c_effective_date, c_apply_last_date, v_today;
  END IF;
  PERFORM set_config('bundle15.policy_text_mode', c_mode, false);

  -- 2. 15번 마이그레이션(저장·판정 함수, 잠금 트리거 3개, 쓰기 막기 정책 2개) ─────────────────────────────────────
  IF to_regprocedure('public.save_site_notice_popup(uuid,integer,boolean,text,text,text,text,timestamp with time zone,timestamp with time zone)') IS NULL
     OR to_regprocedure('public.policy_upcoming_notice_continuity(date,date)') IS NULL
     OR (SELECT count(*) FROM pg_trigger t
          WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
            AND ((t.tgrelid = 'public.system_settings'::regclass AND t.tgname IN ('lock_policy_documents_during_notice', 'lock_withdrawal_texts_during_notice'))
              OR (t.tgrelid = 'public.signup_consent_items'::regclass AND t.tgname = 'lock_consent_items_during_notice'))) <> 3 THEN
    RAISE EXCEPTION 'POLICY_TEXT: bundle 15 migration (functions/triggers) not applied';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings' AND permissive = 'RESTRICTIVE' AND policyname IN ('system_settings_site_notice_popup_no_client_write', 'system_settings_policy_upcoming_documents_no_client_write')) <> 2 THEN
    RAISE EXCEPTION 'POLICY_TEXT: bundle 15 migration (policies) not applied';
  END IF;

  -- 고지 그만두기: 게시 행 'upcoming' → 'reverted'(시행 전이라 appliedAt 은 null)
  IF c_mode = 'withdraw_upcoming' THEN
    IF c_withdraw_reason IS NULL OR btrim(c_withdraw_reason) = '' THEN
      RAISE EXCEPTION 'POLICY_TEXT: c_withdraw_reason required to withdraw the upcoming notice';
    END IF;
    SELECT value INTO v_pub_old FROM public.system_settings WHERE key = 'policy_upcoming_documents' FOR UPDATE;
    IF v_pub_old IS NULL OR (v_pub_old ->> 'status') IS DISTINCT FROM 'upcoming' THEN
      RAISE EXCEPTION 'POLICY_TEXT: no upcoming publication to withdraw (status %)', v_pub_old ->> 'status';
    END IF;
    SELECT p.id INTO v_actor FROM public.profiles p JOIN auth.users u ON u.id = p.id
     WHERE p.is_admin IS TRUE AND p.admin_role = 'owner' AND u.last_sign_in_at IS NOT NULL
     ORDER BY u.last_sign_in_at DESC LIMIT 1;
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'POLICY_TEXT: signed-in owner account not found';
    END IF;
    UPDATE public.system_settings
       SET value = v_pub_old || jsonb_build_object('status', 'reverted', 'revertedAt', clock_timestamp()), updated_at = now()
     WHERE key = 'policy_upcoming_documents';
    PERFORM public.record_admin_audit(v_actor, 'policy_upcoming_withdraw', 'system_settings', 'policy_upcoming_documents', NULL, NULL,
      c_withdraw_reason,
      jsonb_build_object('bundle', 'bundle15_policy_upcoming', 'reason', c_withdraw_reason,
        'published_at', v_pub_old -> 'publishedAt',
        'documents_sha256', (SELECT jsonb_object_agg(d ->> 'key', d ->> 'sha256') FROM jsonb_array_elements(v_pub_old -> 'documents') d),
        'changes_sha256', (SELECT jsonb_object_agg(d ->> 'key', d ->> 'changesSha256') FROM jsonb_array_elements(v_pub_old -> 'documents') d),
        'consent_sha256', (SELECT jsonb_object_agg(c ->> 'key', c ->> 'sha256') FROM jsonb_array_elements(v_pub_old -> 'consentItems') c)),
      NULL);
    RAISE NOTICE 'POLICY_TEXT OK: upcoming notice withdrawn';
    RETURN;
  END IF;

  -- 3. 10번 DB 가 적용돼 있고 스위치가 꺼져 있어야 한다(게시·시행). 처리 대기 탈퇴 요청·대표 확인 값은 시행 때만 본다. ──────────────
  IF to_regclass('public.withdrawn_member_records') IS NULL
     OR to_regprocedure('public.member_withdrawal_notice_text(text,jsonb,boolean)') IS NULL THEN
    RAISE EXCEPTION 'POLICY_TEXT: bundle 10 migration not applied';
  END IF;
  SELECT value INTO v_policy FROM public.system_settings WHERE key = 'member_withdrawal_policy';
  IF v_policy IS NULL THEN
    RAISE EXCEPTION 'POLICY_TEXT: member_withdrawal_policy missing';
  END IF;
  IF (v_policy -> 'selfAnonymizeEnabled') IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'POLICY_TEXT: selfAnonymizeEnabled must be false before this script (now %)', v_policy -> 'selfAnonymizeEnabled';
  END IF;
  IF c_mode = 'apply' THEN
    IF EXISTS (SELECT 1 FROM public.member_withdrawal_requests r WHERE r.status = 'pending') THEN
      RAISE EXCEPTION 'POLICY_TEXT: pending withdrawal request exists (notice text would change terms version)';
    END IF;

    -- 시행일 직전 확인: 재동의 대상 목록 = 대표가 확인한 목록
    IF c_confirmed_count IS NULL OR c_confirmed_members_md5 IS NULL THEN
      RAISE EXCEPTION 'POLICY_TEXT: owner confirmation not recorded — 대표가 재동의 대상 계정을 확인하고 c_confirmed_count·c_confirmed_members_md5 를 넣은 뒤 실행';
    END IF;
    SELECT count(*), md5(string_agg(p.id::text, ',' ORDER BY p.id)) INTO v_count, v_text
      FROM public.profiles p JOIN auth.users u ON u.id = p.id
     WHERE NOT public.is_internal_admin_account(u.email) AND p.withdrawn_at IS NULL
       AND ((p.provider = 'kakao' AND p.signup_completed IS TRUE) OR (p.provider IS DISTINCT FROM 'kakao' AND u.email_confirmed_at IS NOT NULL));
    IF v_count IS DISTINCT FROM c_confirmed_count OR v_text IS DISTINCT FROM c_confirmed_members_md5
       OR public.consent_eligible_member_count() IS DISTINCT FROM v_count THEN
      RAISE EXCEPTION 'POLICY_TEXT: consent-eligible members changed since owner confirmation (now % / %, confirmed % / %) — 대표가 목록을 다시 확인',
        v_count, v_text, c_confirmed_count, c_confirmed_members_md5;
    END IF;

    -- 4. 고지가 끊김 없이 이어졌는지(마이그레이션의 판정 함수 하나로 판정, 시행일·마감일 상수는 게시 행 값과 대조)
    --    팝업 행을 먼저 잠근다: 판정 뒤 COMMIT 전에 다른 거래가 팝업을 저장(끄기 등)하지 못하게(저장 함수도 같은 행을 FOR UPDATE).
    PERFORM 1 FROM public.system_settings WHERE key = 'site_notice_popup' FOR UPDATE;
    v_cont := public.policy_upcoming_notice_continuity(c_effective_date, c_notice_deadline);
    IF (v_cont -> 'ok') IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION 'POLICY_TEXT: notice continuity failed (%)', v_cont ->> 'reason';
    END IF;
  END IF;

  -- 기록자: 가장 최근에 로그인한 대표 계정(사람 ID 를 파일에 적지 않음)
  SELECT p.id INTO v_actor FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.is_admin IS TRUE AND p.admin_role = 'owner' AND u.last_sign_in_at IS NOT NULL
   ORDER BY u.last_sign_in_at DESC LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'POLICY_TEXT: signed-in owner account not found';
  END IF;

  -- ── 문구 ──────────────────────────────────────────────────────────────────────────────────────────
  t_pairs := ARRAY[
    -- 12조 전체(①②③ → ①~④)
    ARRAY[concat_ws(E'\n',
            $q$① 회원은 언제든지 서비스 화면에서 탈퇴할 수 있습니다. 결제 이력(결제를 시도한 기록 포함)이 있는 계정은 관련 법령에 따른 기록 보존 때문에 고객센터로 탈퇴를 요청해야 합니다.$q$,
            $q$② 탈퇴 시 개인정보는 개인정보처리방침에 따라 처리되고, 남은 크레딧과 환불은 취소/환불정책을 따릅니다.$q$,
            $q$③ 회원이 이 약관을 중대하게 어기면 회사는 이용 계약을 해지할 수 있습니다.$q$),
          concat_ws(E'\n',
            $q$① 회원은 언제든지 마이페이지의 회원 탈퇴 화면에서 탈퇴할 수 있습니다.$q$,
            $q$- 결제 이력이 없는 계정(결제창만 열고 결제를 마치지 않은 계정 포함)은 그 화면에서 바로 탈퇴됩니다. 다만 최근 7일 안에 결제 시도가 있으면 7일이 지난 뒤 탈퇴할 수 있습니다.$q$,
            $q$- 결제 이력이 있는 계정(결제가 승인됐거나 승인 뒤 취소·환불된 계정, 검증에 실패한 결제 통보처럼 결제가 됐을 수 있는 기록이 있는 계정 포함)은 그 화면에서 탈퇴를 요청합니다. 회사는 확인한 뒤 요청일부터 10일 안에 처리하고 가입한 이메일로 결과를 알립니다.$q$,
            $q$- 진행 중인 결제·결제 취소·환불이 있으면 그 처리가 끝난 뒤 탈퇴할 수 있습니다. 보관할 문의 기록을 회사가 확인해야 하면 확인을 마친 뒤 10일 안에 이메일로 알리고, 결제 이력이 없어도 결제 결과를 확인해야 하는 주문이 있으면 회사가 가입한 이메일로 탈퇴 요청을 받아 10일 안에 처리합니다. 회사가 탈퇴를 바로 처리하지 못하면 10일 안에 그 사유와 처리할 수 있는 날을 이메일로 알립니다.$q$,
            $q$- 탈퇴 화면을 이용할 수 없으면 고객센터(이메일·전화)로 탈퇴를 요청할 수 있습니다. 법정대리인이나 위임받은 대리인도 요청할 수 있으며, 회사는 본인 또는 대리 권한을 확인한 뒤 처리합니다.$q$,
            $q$② 탈퇴하면 남은 크레딧(유료 충전 크레딧, 자료 환불로 다시 받은 크레딧, 무상 크레딧)은 소멸하며 환불되지 않습니다. 회사는 탈퇴 전에 소멸할 크레딧과 유료 크레딧의 원 환산 금액(취소/환불정책 8절의 계산식)을 알리고 동의를 받습니다. 남은 크레딧은 탈퇴 전에 쓸 수 있습니다. 환불 기간이 남은 유료 충전 건이 있으면 쓰지 않은 건은 환불받거나 환불 기간이 지난 뒤, 일부를 쓴 건은 환불 기간이 지난 뒤 탈퇴할 수 있으며, 환불 기간 마지막 날이 휴일인지 등을 확인하기 위해 기간이 끝난 뒤 3일 동안은 탈퇴할 수 없습니다. 미성년자 결제 취소, 자료 하자, 표시·광고와 다른 제공처럼 법령에 따른 환불은 탈퇴한 뒤에도 고객센터로 요청할 수 있으며, 원래 결제수단이나 결제자 명의 계좌로 처리합니다. 자세한 기준은 취소/환불정책 8-2절을 따릅니다.$q$,
            $q$③ 탈퇴하면 구매한 자료를 더 이상 내려받을 수 없고, 작성한 후기·추천은 삭제되며, 답변을 기다리던 1:1 문의는 닫힙니다(결제 이력이 없는 회원이 보존에 동의하지 않은 문의는 삭제). 받지 않은 자료의 환불(취소/환불정책 3-2절 ①)은 탈퇴 전에 신청해야 하며, 탈퇴하면 그 환불 몫도 남은 크레딧과 함께 소멸합니다. 같은 이메일이나 카카오 계정으로 다시 가입해도 새 계정이 되며 크레딧·구매 내역·문의 내역은 이어지지 않습니다. 탈퇴 뒤 개인정보와 기록의 보관·파기는 개인정보처리방침에 따릅니다.$q$,
            $q$④ 회원이 이 약관을 중대하게 어기면 회사는 이용 계약을 해지할 수 있습니다.$q$),
          '제12조(계약 해지와 탈퇴)', 'replace'],
    -- 부칙 시행일
    ARRAY[$q$이 약관은 2026년 11월 23일부터 시행합니다.$q$,
          '이 약관은 ' || v_date || '부터 시행합니다.',
          '부칙 시행일', 'replace']
  ];

  r_pairs := ARRAY[
    -- 새 절 8-2(8절 다음, 9절 앞)
    ARRAY[E'\n\n## 9. 부정 결제 및 악용 방지',
          E'\n\n' || concat_ws(E'\n',
            $q$## 8-2. 회원 탈퇴와 크레딧$q$,
            $q$① 회원이 탈퇴하면 남은 크레딧(유료 충전 크레딧, 자료 환불로 다시 받은 크레딧, 무상 크레딧)은 소멸하며 환불되지 않습니다. 회사는 탈퇴 전에 소멸할 크레딧과, 유료 크레딧을 8절의 식으로 계산한 원 환산 금액을 알리고 동의를 받습니다. 자료 환불로 다시 받은 크레딧은 원래 충전분으로 계산합니다. 받지 않은 자료의 환불(3-2절 ①)은 탈퇴 전에 신청해야 하며, 탈퇴하면 그 환불 몫도 함께 소멸합니다.$q$,
            $q$② 단순 변심에 따른 환불 기간(3절 ①)이 남은 유료 충전 건이 있으면, 쓰지 않은 건은 환불받거나 환불 기간이 지난 뒤, 일부를 쓴 건은 환불 기간이 지난 뒤 탈퇴할 수 있습니다. 환불 기간 마지막 날이 휴일인지 등을 확인하기 위해 기간이 끝난 뒤 3일 동안은 탈퇴할 수 없습니다. 마지막 날이 휴일이면 법에 따라 기간이 휴일이 끝난 다음 날까지 늘어나며, 그 기간에는 고객센터로 환불을 요청할 수 있습니다.$q$,
            $q$③ 진행 중인 결제 취소·환불이 있으면 그 처리가 끝난 뒤 탈퇴할 수 있습니다.$q$,
            $q$④ 미성년자 결제 취소(7절), 하자가 있거나 소개 내용과 다른 자료(3-2절 ④), 표시·광고나 계약 내용과 다르게 제공된 경우(3절 ④)처럼 법령에 따른 환불은 탈퇴한 뒤에도 고객센터로 요청할 수 있습니다. 탈퇴한 회원에게는 크레딧으로 돌려드릴 수 없으므로 원 결제수단이나 결제자 명의 계좌로 처리합니다. 5절·8절의 '회원이 지정한 본인 명의 계좌'와 달리, 법정대리인 등 회원이 아닌 사람이 결제한 경우에는 그 결제자 명의 계좌로 환불합니다.$q$
          ) || E'\n\n## 9. 부정 결제 및 악용 방지',
          '8-2. 회원 탈퇴와 크레딧(신설)', 'insert']
  ];

  p_pairs := ARRAY[
    -- 머리 시행일
    ARRAY[$q$시행일: 2026년 11월 23일$q$, '시행일: ' || v_date, '시행일', 'replace'],
    -- 1절 목적 한 줄 추가
    ARRAY[$q$- 고객 문의·환불 요청·권리침해 신고 처리, 미성년자 결제 취소 확인$q$,
          $q$- 고객 문의·환불 요청·권리침해 신고 처리, 미성년자 결제 취소 확인$q$ || E'\n' ||
          $q$- 회원 탈퇴 처리와 처리 결과 안내, 탈퇴 뒤 분쟁 대응과 법령에 따른 환불 연락$q$,
          '1절 처리 목적(추가)', 'insert'],
    -- 2절 항목 한 줄 추가(14절 11번)
    ARRAY[$q$- 권리침해 신고: 신고인의 이름·연락처, 권리 증빙, 신고 내용$q$,
          $q$- 권리침해 신고: 신고인의 이름·연락처, 권리 증빙, 신고 내용$q$ || E'\n' ||
          $q$- 회원 탈퇴: 탈퇴 요청 기록(접수 경로, 요청자 구분(본인·법정대리인·위임 대리인), 접수·안내·회신 일시, 본인 확인 방법과 결과), 회원에게 보여 주거나 보낸 탈퇴 안내 원문, 소멸 크레딧 내역, 1:1 문의 보존 선택, 대리인이 요청한 경우 대리인의 이름·연락처와 위임 확인 자료$q$,
          '2절 수집 항목(회원 탈퇴 추가)', 'insert'],
    -- 3절 보유 기간(첫 세 문장 → 결제 여부별 목록)
    ARRAY[concat_ws(E'\n',
            $q$회사는 회원이 탈퇴하면 개인정보를 지체 없이 파기합니다. 다만 결제 이력이 있는 경우 전자상거래 등에서의 소비자보호에 관한 법률에 따라 계약·청약철회·대금결제 및 재화 등의 공급에 관한 기록(주문자 이메일·휴대폰 번호, 주문·결제·환불 내역)을 5년간 보존합니다.$q$,
            $q$선택 동의한 마케팅 정보 수신(이메일·휴대폰 번호)은 탈퇴하거나 동의를 철회할 때까지 이용합니다.$q$,
            $q$환불 계좌, 미성년자 결제 취소 확인 자료, 권리침해 신고 자료는 처리를 마치면 지체 없이 파기하고, 환불·취소 처리 내역은 위 결제 기록과 함께 5년간 보존합니다.$q$),
          concat_ws(E'\n',
            $q$회원이 탈퇴하면 개인정보를 지체 없이 파기합니다. 다만 아래 기록은 정한 기간 동안 다른 개인정보와 분리해 보관한 뒤 파기하며, 아래에 적은 목적 외에는 쓰지 않습니다.$q$,
            $q$### 법령에 따라 보존하는 기록$q$,
            $q$- 결제 이력이 있는 회원의 계약·청약철회·대금결제·재화 공급에 관한 기록(전자상거래 등에서의 소비자보호에 관한 법률 제6조, 같은 법 시행령 제6조): 주문자 이메일, 회원정보의 휴대폰 번호, 카카오 계정 이메일, 결제 때 입력한 휴대폰 번호(다른 결제 요청 값과 함께 해시 값으로 바꿔 보관하며, 회사가 다른 기록과 대조하면 알아볼 수 있는 값입니다), 주문·결제(실패·만료된 결제 시도 포함)·환불 내역, 결제 전 확인 동의, 크레딧 충전·사용·소멸 내역, 자료 구매·이용 권한·구매 고지 동의·다운로드 기록(다운로드 때의 접속 IP·기기 정보는 지움) — 마지막 거래일부터 5년$q$,
            $q$- 결제 이력이 있는 회원의 1:1 문의(제목·내용·답변·수정 이력. 같은 법 시행령 제6조의 소비자 불만·분쟁 처리 기록) — 마지막 처리일부터 3년$q$,
            $q$위 기록은 분쟁 대응, 법령에 따른 환불, 탈퇴·광고성 정보 수신 동의 철회 처리 결과 안내에만 씁니다.$q$,
            $q$### 분쟁 대응을 위해 회사가 보관하는 기록$q$,
            $q$아래 기록은 법령상 보존 의무가 있는 기록이 아니며, 탈퇴·동의·결제 사실을 확인하고 분쟁에 대응하기 위해 보관합니다. 근거는 줄마다 적습니다(회사의 정당한 이익은 개인정보 보호법 제15조제1항제6호).$q$,
            $q$- 동의 기록(결제 이력이 있는 회원의 가입·개인정보·마케팅 동의 기록, 목적: 동의 사실 확인)은 탈퇴일부터 5년(근거: 회사의 정당한 이익)$q$,
            $q$- 탈퇴 처리 기록(탈퇴 요청 기록, 회원이 확인한 탈퇴 안내 원문, 소멸 크레딧 내역, 처리 일시, 목적: 탈퇴와 크레딧 소멸 동의 사실 확인)은 탈퇴일부터 5년(근거: 회사의 정당한 이익)$q$,
            $q$- 결제 이력이 있는 회원의 환불 신청과 연결된 1:1 문의는 마지막 처리일부터 5년(근거: 회사의 정당한 이익, 목적: 환불 기록과 함께 분쟁 확인)$q$,
            $q$- 결제 이력이 없는 회원의 결제를 마치지 않은 결제 시도 기록(주문번호·금액·결제 진행 기록, 목적: 늦게 도착한 결제 확인과 환불)은 개인정보를 지운 채 마지막 결제 시도일부터 5년(근거: 회사의 정당한 이익)$q$,
            $q$- 결제 이력이 없는 회원의 1:1 문의는 탈퇴할 때 보존에 동의한 경우에만 마지막 처리일부터 3년(근거: 회원의 동의, 목적: 분쟁 확인. 동의하지 않으면 탈퇴와 함께 삭제)$q$,
            $q$### 그 밖의 보유와 파기$q$,
            $q$탈퇴 뒤 위 기록이 하나도 남지 않는 회원은 탈퇴할 때 회원 정보와 로그인 계정을 모두 삭제합니다. 위 기록이 남는 회원의 로그인 계정은 이메일 등을 해시 값으로 바꾼 가명 상태로 로그인을 막아 두었다가 보관 기간이 끝나면 삭제합니다.$q$,
            $q$카카오 로그인 회원이 탈퇴하면 회사는 카카오에 연결 끊기를 요청하며, 연결 끊기를 마칠 때까지만 카카오 회원번호를 보관합니다.$q$,
            $q$이메일로 받은 탈퇴 요청 메일과, 대리인이 요청한 경우 대리인의 이름·연락처와 위임·본인 확인 자료는 처리 결과를 알린 뒤 지체 없이 파기합니다.$q$,
            $q$선택 동의한 마케팅 정보 수신(이메일·휴대폰 번호)은 동의를 철회하거나 탈퇴할 때까지 이용합니다. 탈퇴 요청을 접수하면 그때 바로 철회하며, 요청을 취소해도 다시 동의한 것으로 보지 않습니다.$q$,
            $q$환불 계좌, 미성년자 결제 취소 확인 자료, 권리침해 신고 자료는 처리를 마치면 지체 없이 파기하고(1:1 문의·환불 기록에 적힌 경우 그 부분을 가립니다), 환불·취소 처리 내역은 위 결제 기록과 함께 보관합니다.$q$),
          '3절 보유 기간', 'replace'],
    -- 6절 Supabase 보유 기간
    ARRAY[$q$- 보유 기간: 회원 탈퇴 시까지(법령 보존 기록 제외, 백업은 업체 보존 주기가 지나면 삭제)$q$,
          $q$- 보유 기간: 회원 탈퇴 시까지(탈퇴 뒤 분리 보관하는 기록은 3절의 기간이 끝날 때까지, 백업은 업체 보존 주기가 지나면 삭제)$q$,
          '6절 국외 이전(Supabase 보유 기간)', 'replace'],
    -- 7절 10일 안 처리·통지와 이의제기(개인정보 보호법 38조④, 시행령 43조 — 계획 3절 막힘 화면의 이의제기 안내가 가리키는 곳)
    ARRAY[$q$회사는 본인 확인 후 지체 없이 조치합니다. 법령상 보존해야 하는 정보는 삭제가 제한될 수 있습니다.$q$,
          $q$회사는 본인 확인 후 지체 없이 조치합니다. 법령상 보존해야 하는 정보는 삭제가 제한될 수 있습니다. 회사가 탈퇴·삭제 요청을 바로 처리하지 못하면 요청을 받은 날부터 10일 안에 처리하거나, 처리할 수 없는 사유와 가능 예정일, 이의제기 방법을 알립니다. 처리 결과에 이의가 있으면 아래 개인정보 보호책임자나 고객센터로 이의를 제기할 수 있습니다.$q$,
          '7절 정보주체의 권리와 행사 방법(처리 기한·이의제기)', 'replace'],
    -- 10절 분리 보관 기록 접근 통제(read_withdrawn_member_record·read_withdrawn_member_ticket: 대표만, 열람 사유·기록)
    ARRAY[$q$접근 권한 관리와 관리자 권한 제한, 전송 구간 암호화(HTTPS), 비밀번호 암호화 저장, 관리자 작업 기록, 보안 업데이트 등의 조치를 합니다.$q$,
          $q$접근 권한 관리와 관리자 권한 제한, 전송 구간 암호화(HTTPS), 비밀번호 암호화 저장, 관리자 작업 기록, 보안 업데이트 등의 조치를 합니다. 탈퇴 뒤 분리 보관한 연락처와 탈퇴 회원의 1:1 문의는 대표만 열람할 수 있으며, 열람할 때마다 사유와 기록을 남깁니다.$q$,
          '10절 안전성 확보 조치(분리 보관 기록 열람)', 'replace']
  ];

  it_pairs := ARRAY[
    ARRAY[$q$- 학습 자료를 크레딧으로 구매하고 내려받는 서비스입니다. 크레딧은 미리 충전해 쓰며, 사용 기한과 환불 기준은 이용약관과 취소·환불 정책을 따릅니다.$q$,
          $q$- 학습 자료를 크레딧으로 구매하고 내려받는 서비스입니다. 크레딧은 미리 충전해 쓰며, 사용 기한과 환불 기준은 이용약관과 취소·환불 정책을 따릅니다.$q$ || E'\n' ||
          $q$- **탈퇴하면 남은 크레딧(유료·무상)은 소멸하며 환불되지 않습니다.** 다만 미성년자 결제 취소, 자료 하자 등 법령에 따른 환불은 탈퇴한 뒤에도 고객센터로 요청할 수 있습니다. 환불 기간이 남은 충전 건은 쓰지 않았으면 환불받거나 기간이 지난 뒤, 일부를 썼으면 기간이 지난 뒤 탈퇴할 수 있고, 환불 기간이 끝난 뒤 3일 동안은 탈퇴할 수 없습니다(이용약관 제12조).$q$,
          '탈퇴와 크레딧(추가)', 'insert']
  ];

  ip_pairs := ARRAY[
    ARRAY[$q$**보유·이용 기간: 탈퇴 시 지체 없이 파기합니다. 단, 결제 이력이 있는 경우 전자상거래법에 따라 계약·청약철회·대금결제 기록을 5년간 보존합니다.**$q$,
          $q$**보유·이용 기간: 탈퇴 시 지체 없이 파기합니다. 다만 결제 이력이 있으면 전자상거래법 제6조에 따라 주문·결제·환불·크레딧·자료 구매 기록과 이메일·휴대폰번호·카카오 계정 이메일을 마지막 거래일부터 5년, 1:1 문의(소비자 불만·분쟁 처리 기록)를 마지막 처리일부터 3년 동안 분리 보관한 뒤 파기합니다.**$q$ || E'\n' ||
          $q$이와 별도로 회사는 분쟁 대응을 위해 다음 기록을 보관합니다(법령상 보존 의무가 아니라 회사의 정당한 이익에 따른 보관으로, 이 동의와 별개입니다). 결제 이력이 있는 회원의 동의 기록은 탈퇴일부터 5년, 환불 신청과 연결된 1:1 문의는 마지막 처리일부터 5년, 탈퇴 처리 기록(탈퇴 안내 원문·소멸 크레딧 내역)은 탈퇴일부터 5년, 결제 이력이 없는 회원의 결제 시도 기록은 개인정보를 지운 채 마지막 결제 시도일부터 5년 보관합니다. 결제 이력이 없는 회원의 1:1 문의는 탈퇴할 때 보존에 동의한 경우에만 마지막 처리일부터 3년 보관합니다. 자세한 내용은 개인정보처리방침 3절을 따릅니다.$q$,
          '보유·이용 기간', 'replace'],
    -- 수집 항목 줄 추가(15번 4-3: 변경 안내의 '탈퇴 요청 기록을 새로 수집'과 같은 말 — 처리방침 1·2절과 같은 목적·항목)
    ARRAY[$q$- 이용 중 생성: 접속 기록, 결제 기록$q$,
          $q$- 이용 중 생성: 접속 기록, 결제 기록$q$ || E'\n' ||
          $q$- 회원 탈퇴 때: 탈퇴 요청 기록(접수 경로, 요청자 구분(본인·법정대리인·위임 대리인), 접수·안내·회신 일시, 본인 확인 방법과 결과), 회원에게 보여 주거나 보낸 탈퇴 안내 원문, 소멸 크레딧 내역, 1:1 문의 보존 선택, 대리인이 요청한 경우 대리인의 이름·연락처와 위임 확인 자료(목적: 회원 탈퇴 처리와 결과 안내, 탈퇴 뒤 분쟁 대응)$q$,
          '수집 항목(회원 탈퇴 추가)', 'insert']
  ];

  w_paths := ARRAY[
    ARRAY['{texts,blockReasons,REFUND_PERIOD_BUFFER}',
          $q$환불 기간이 끝난 뒤 며칠 동안은 휴일 연장 여부를 확인하느라 탈퇴가 막힐 수 있습니다. 마지막 날이 휴일이었다면 고객센터로 환불을 요청할 수 있습니다.$q$,
          $q$환불 기간이 끝난 뒤 3일 동안은 휴일 연장 여부를 확인하느라 탈퇴할 수 없습니다. 마지막 날이 휴일이면 법에 따라 기간이 휴일이 끝난 다음 날까지 늘어나며, 그 기간에는 고객센터로 환불을 요청할 수 있습니다.$q$],
    ARRAY['{texts,blockReasons,REFUND_PERIOD_OPEN}',
          $q$환불 기간이 남은 충전 건이 있어 지금은 탈퇴할 수 없습니다. 그 충전 건을 환불하거나 환불 기간이 지난 뒤({가능예정일}부터) 탈퇴할 수 있습니다.$q$,
          $q$환불 기간이 남은 충전 건이 있어 지금은 탈퇴할 수 없습니다. 쓰지 않은 충전 건은 환불받거나 환불 기간이 지난 뒤, 일부를 쓴 충전 건은 환불 기간이 지난 뒤({가능예정일}부터) 탈퇴할 수 있습니다.$q$],
    ARRAY['{texts,notice,ticketsPayer}',
          $q$1:1 문의는 소비자 불만·분쟁 처리 기록으로 마지막 처리일부터 {결제문의보존기간}년(환불 신청과 연결된 문의는 {환불문의보존기간}년) 동안 분리해 보관한 뒤 파기합니다. 탈퇴하면 회원 화면에서는 사라집니다.$q$,
          $q$1:1 문의는 소비자 불만·분쟁 처리 기록으로 마지막 처리일부터 {결제문의보존기간}년, 환불 신청과 연결된 문의는 분쟁 확인을 위해 마지막 처리일부터 {환불문의보존기간}년 동안 분리해 보관한 뒤 파기합니다. 탈퇴하면 회원 화면에서는 사라집니다.$q$]
  ];

  -- 게시 행 화면 글(15번 계획 9절 초안 — 날짜는 c_effective_date 로 만든다)
  v_pub_texts := jsonb_build_object(
    'heading', v_date || ' 시행 예정 약관·정책',
    'intro', $q$회원 탈퇴 절차를 정비하고 탈퇴 뒤 기록 보관 기준을 분명히 하기 위해 이용약관 제12조와 부칙, 취소/환불정책 8-2절(신설), 개인정보처리방침 머리말과 1·2·3·6·7·10절이 바뀝니다. 아래에 바뀌는 부분(변경 전 → 변경 후)과 시행일부터 적용될 전문, 시행일에 다시 동의를 받을 항목을 적었습니다. 시행일 전까지는 지금 약관이 적용됩니다. 시행일 뒤 처음 접속하시면 바뀐 이용약관·개인정보 수집·이용 동의에 다시 동의하는 화면이 나오고, 동의 전에는 충전과 자료 구매를 할 수 없습니다. 크레딧 내역·구매 내역·자료 보관함·문의 화면은 동의 전에도 볼 수 있습니다. 바뀐 약관에 동의하지 않으시면 시행일 전까지 탈퇴를 요청하실 수 있으며, 결제 이력이 있거나 탈퇴 화면에서 접수되지 않으면 고객센터(이메일·전화)로 요청해 주세요.$q$,
    'bannerText', v_date || '(' || v_weekday || ')부터 이용약관·취소/환불정책·개인정보처리방침이 바뀝니다.',
    'bannerLinkLabel', '바뀌는 부분 보기',
    'footerLinkLabel', '변경 예정 약관',
    'statusTexts', jsonb_build_object(
      'applied', v_date || '부터 시행 중입니다.',
      'revertedAfterApply', '이 변경은 시행 뒤 되돌려졌습니다. 지금 시행 중인 약관은 아래 링크에서 보실 수 있습니다.',
      'withdrawn', '예정했던 이 변경은 시행하지 않기로 했습니다. 지금 약관이 그대로 적용됩니다.',
      'historyLinkLabel', '이전 판과 바뀐 부분 보기'),
    'labels', jsonb_build_object(
      'currentLinkUpcoming', '지금 시행 중인 {제목} 보기(변경 전 전문)',
      'currentLinkApplied', '지금 시행 중인 {제목}',
      'afterFull', '바뀐 뒤 전문',
      'beforeFull', '이전 판 전문',
      'consentSection', '다시 동의를 받을 항목',
      'before', '변경 전',
      'after', '변경 후',
      'checking', '이 문서는 확인 중입니다. 잠시 뒤 다시 열어 주세요.',
      'effectiveDate', '시행일',
      'publishedAt', '게시일',
      'toc', '목차',
      'backToList', '약관 및 정책 목록'));

  -- 1. 잠그고 사전 md5
  SELECT value INTO v_footer FROM public.system_settings WHERE key = 'site_footer_content' FOR UPDATE;
  v_footer_before := v_footer;
  v_refund := v_footer #>> '{policyDocuments,refundPolicy,content}';
  v_terms := v_footer #>> '{policyDocuments,serviceTerms,content}';
  v_privacy := v_footer #>> '{policyDocuments,privacyPolicy,content}';
  IF md5(v_refund) IS DISTINCT FROM c_refund_md5 OR md5(v_terms) IS DISTINCT FROM c_terms_md5
     OR md5(v_privacy) IS DISTINCT FROM c_privacy_md5 THEN
    RAISE EXCEPTION 'POLICY_TEXT: policy documents changed since dry-run (refund %, terms %, privacy %)',
      md5(v_refund), md5(v_terms), md5(v_privacy);
  END IF;

  SELECT * INTO v_item_terms FROM public.signup_consent_items WHERE key = 'terms';
  SELECT * INTO v_item_privacy FROM public.signup_consent_items WHERE key = 'privacy';
  SELECT * INTO v_item_age14_before FROM public.signup_consent_items WHERE key = 'age14';
  SELECT * INTO v_item_marketing_before FROM public.signup_consent_items WHERE key = 'marketing';
  IF v_item_terms.id IS NULL OR v_item_privacy.id IS NULL
     OR v_item_terms.version <> c_item_terms_version OR md5(v_item_terms.content) <> c_item_terms_md5
     OR v_item_privacy.version <> c_item_privacy_version OR md5(v_item_privacy.content) <> c_item_privacy_md5
     OR NOT (v_item_terms.required AND v_item_terms.is_active AND v_item_terms.policy_slug = 'service')
     OR NOT (v_item_privacy.required AND v_item_privacy.is_active) THEN
    RAISE EXCEPTION 'POLICY_TEXT: consent items changed since dry-run (terms v% %, privacy v% %)',
      v_item_terms.version, md5(v_item_terms.content), v_item_privacy.version, md5(v_item_privacy.content);
  END IF;
  IF (v_policy ->> 'termsConsentItemKey') IS DISTINCT FROM 'terms' THEN
    RAISE EXCEPTION 'POLICY_TEXT: member_withdrawal_policy.termsConsentItemKey is not terms';
  END IF;

  -- 탈퇴 정책 행을 잠그고, 바꿀 문구 세 줄이 지금 값과 같은지 확인한다.
  SELECT value INTO v_wpolicy FROM public.system_settings WHERE key = 'member_withdrawal_policy' FOR UPDATE;
  IF v_wpolicy IS DISTINCT FROM v_policy OR (v_wpolicy -> 'selfAnonymizeEnabled') IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'POLICY_TEXT: member_withdrawal_policy changed during script';
  END IF;
  v_wpolicy_new := v_wpolicy;
  FOR i IN 1 .. array_length(w_paths, 1) LOOP
    IF (v_wpolicy #>> w_paths[i][1]::text[]) IS DISTINCT FROM w_paths[i][2] THEN
      RAISE EXCEPTION 'POLICY_TEXT: member_withdrawal_policy % differs from dry-run', w_paths[i][1];
    END IF;
    v_wpolicy_new := jsonb_set(v_wpolicy_new, w_paths[i][1]::text[], to_jsonb(w_paths[i][3]));
  END LOOP;

  -- 지금 재동의 없이 통과하는 회원 수(영향 회원 수 계산용, 판정과 같은 규칙)
  SELECT count(*) INTO v_ok_before
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE NOT public.is_internal_admin_account(u.email) AND p.withdrawn_at IS NULL
     AND ((p.provider = 'kakao' AND p.signup_completed IS TRUE) OR (p.provider IS DISTINCT FROM 'kakao' AND u.email_confirmed_at IS NOT NULL))
     AND NOT EXISTS (SELECT 1 FROM public.consent_missing_required(p.id, '[]'::jsonb));

  -- 2. 바꿀 문장이 각각 정확히 1번 있는지 확인한 뒤 바꾼다(하나씩 확인·교체).
  v_terms_new := v_terms;
  FOR i IN 1 .. array_length(t_pairs, 1) LOOP
    IF (length(v_terms_new) - length(replace(v_terms_new, t_pairs[i][1], ''))) / length(t_pairs[i][1]) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'POLICY_TEXT: serviceTerms fragment % not found exactly once', i;
    END IF;
    v_terms_new := replace(v_terms_new, t_pairs[i][1], t_pairs[i][2]);
  END LOOP;

  v_refund_new := v_refund;
  FOR i IN 1 .. array_length(r_pairs, 1) LOOP
    IF (length(v_refund_new) - length(replace(v_refund_new, r_pairs[i][1], ''))) / length(r_pairs[i][1]) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'POLICY_TEXT: refundPolicy fragment % not found exactly once', i;
    END IF;
    v_refund_new := replace(v_refund_new, r_pairs[i][1], r_pairs[i][2]);
  END LOOP;

  v_privacy_new := v_privacy;
  FOR i IN 1 .. array_length(p_pairs, 1) LOOP
    IF (length(v_privacy_new) - length(replace(v_privacy_new, p_pairs[i][1], ''))) / length(p_pairs[i][1]) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'POLICY_TEXT: privacyPolicy fragment % not found exactly once', i;
    END IF;
    v_privacy_new := replace(v_privacy_new, p_pairs[i][1], p_pairs[i][2]);
  END LOOP;

  v_item_terms_content := v_item_terms.content;
  FOR i IN 1 .. array_length(it_pairs, 1) LOOP
    IF (length(v_item_terms_content) - length(replace(v_item_terms_content, it_pairs[i][1], ''))) / length(it_pairs[i][1]) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'POLICY_TEXT: terms consent item fragment % not found exactly once', i;
    END IF;
    v_item_terms_content := replace(v_item_terms_content, it_pairs[i][1], it_pairs[i][2]);
  END LOOP;

  v_item_privacy_content := v_item_privacy.content;
  FOR i IN 1 .. array_length(ip_pairs, 1) LOOP
    IF (length(v_item_privacy_content) - length(replace(v_item_privacy_content, ip_pairs[i][1], ''))) / length(ip_pairs[i][1]) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'POLICY_TEXT: privacy consent item fragment % not found exactly once', i;
    END IF;
    v_item_privacy_content := replace(v_item_privacy_content, ip_pairs[i][1], ip_pairs[i][2]);
  END LOOP;

  -- 2-2. 게시 행 내용(15번 4-3): 문서별 changes(쌍 이름·방식 그대로), 바뀔 전문·변경 전 전문, 동의 항목 새 글, 잠금 경로, 지문.
  --      'insert' 쌍은 옛 조각이 새 조각에 정확히 1번 들어 있어야 하고, 변경 후 = 새 조각에서 옛 조각을 뺀 부분(앞뒤 줄바꿈 정리)이다.
  v_documents := '[]'::jsonb;
  FOR v_doc_idx IN 1 .. 3 LOOP
    v_doc_key := (ARRAY['serviceTerms', 'refundPolicy', 'privacyPolicy'])[v_doc_idx];
    v_pairs := CASE v_doc_idx WHEN 1 THEN t_pairs WHEN 2 THEN r_pairs ELSE p_pairs END;
    v_doc_before := CASE v_doc_idx WHEN 1 THEN v_terms WHEN 2 THEN v_refund ELSE v_privacy END;
    v_doc_after := CASE v_doc_idx WHEN 1 THEN v_terms_new WHEN 2 THEN v_refund_new ELSE v_privacy_new END;
    v_changes := '[]'::jsonb;
    v_changes_text := NULL;
    FOR i IN 1 .. array_length(v_pairs, 1) LOOP
      IF v_pairs[i][4] = 'insert' THEN
        IF (length(v_pairs[i][2]) - length(replace(v_pairs[i][2], v_pairs[i][1], ''))) / length(v_pairs[i][1]) IS DISTINCT FROM 1 THEN
          RAISE EXCEPTION 'POLICY_TEXT: % insert pair % does not contain its old fragment exactly once', v_doc_key, i;
        END IF;
        v_change_after := regexp_replace(replace(v_pairs[i][2], v_pairs[i][1], ''), '^\n+|\n+$', '', 'g');
        v_changes := v_changes || jsonb_build_array(jsonb_build_object('label', v_pairs[i][3], 'mode', 'insert',
          'before', '(없음 — 새로 생김)', 'after', v_change_after));
      ELSIF v_pairs[i][4] = 'replace' THEN
        v_changes := v_changes || jsonb_build_array(jsonb_build_object('label', v_pairs[i][3], 'mode', 'replace',
          'before', v_pairs[i][1], 'after', v_pairs[i][2]));
      ELSE
        RAISE EXCEPTION 'POLICY_TEXT: % pair % has unknown mode %', v_doc_key, i, v_pairs[i][4];
      END IF;
    END LOOP;
    -- changesSha256 = (label LF mode LF before LF after) 를 정해진 순서로 LF LF 로 이은 글의 sha256
    SELECT string_agg(concat_ws(E'\n', c ->> 'label', c ->> 'mode', c ->> 'before', c ->> 'after'), E'\n\n' ORDER BY ord)
      INTO v_changes_text FROM jsonb_array_elements(v_changes) WITH ORDINALITY AS e(c, ord);
    v_documents := v_documents || jsonb_build_array(jsonb_build_object(
      'key', v_doc_key,
      'slug', v_footer #>> ARRAY['policyDocuments', v_doc_key, 'slug'],
      'title', v_footer #>> ARRAY['policyDocuments', v_doc_key, 'title'],
      'content', v_doc_after,
      'sha256', encode(sha256(convert_to(v_doc_after, 'UTF8')), 'hex'),
      'beforeContent', v_doc_before,
      'beforeSha256', encode(sha256(convert_to(v_doc_before, 'UTF8')), 'hex'),
      'changes', v_changes,
      'changesSha256', encode(sha256(convert_to(v_changes_text, 'UTF8')), 'hex')));
  END LOOP;
  -- 동의 항목: 시행 때 쓸 이름(지금 이름)·판(+1)·변경 안내. sha256 = label LF version LF note LF content, contentSha256 = 본문만.
  v_consent_items := jsonb_build_array(
    jsonb_build_object('key', v_item_terms.key, 'label', v_item_terms.label, 'version', v_item_terms.version + 1,
      'content', v_item_terms_content, 'note', c_terms_note,
      'sha256', encode(sha256(convert_to(concat_ws(E'\n', v_item_terms.label, (v_item_terms.version + 1)::text, c_terms_note, v_item_terms_content), 'UTF8')), 'hex'),
      'contentSha256', encode(sha256(convert_to(v_item_terms_content, 'UTF8')), 'hex')),
    jsonb_build_object('key', v_item_privacy.key, 'label', v_item_privacy.label, 'version', v_item_privacy.version + 1,
      'content', v_item_privacy_content, 'note', c_privacy_note,
      'sha256', encode(sha256(convert_to(concat_ws(E'\n', v_item_privacy.label, (v_item_privacy.version + 1)::text, c_privacy_note, v_item_privacy_content), 'UTF8')), 'hex'),
      'contentSha256', encode(sha256(convert_to(v_item_privacy_content, 'UTF8')), 'hex')));
  -- 탈퇴 정책 잠금 경로(15번 4-3·4-4): w_paths 세 경로 + c_num_checks 의 숫자 키 + termsConsentItemKey + texts.notice.termsVersion
  SELECT jsonb_agg(p ORDER BY ord) INTO v_locked_paths FROM (
    SELECT w_paths[j][1] AS p, j AS ord FROM generate_subscripts(w_paths, 1) j
    UNION ALL
    SELECT '{' || k || '}', 100 + min(j) FROM (SELECT c_num_checks[j][4] AS k, j FROM generate_subscripts(c_num_checks, 1) j) n GROUP BY k
    UNION ALL SELECT '{termsConsentItemKey}', 1000
    UNION ALL SELECT '{texts,notice,termsVersion}', 1001) x;

  -- 5. VERIFY 를 돌릴 대상: 게시는 저장 전 새 본문 변수, 시행은 저장한 뒤 DB 값(아래 3~4 뒤에 다시 채움)
  v_chk_terms := v_terms_new;
  v_chk_refund := v_refund_new;
  v_chk_privacy := v_privacy_new;
  v_chk_item_terms := v_item_terms_content;
  v_chk_item_privacy := v_item_privacy_content;
  v_chk_wpolicy := v_wpolicy_new;

  IF c_mode = 'apply' THEN
    -- 5. 지문: 새 본문·동의 항목·changes 를 게시 행과 대조(같은 계산이라 다르면 고지한 글과 시행할 글이 다르다는 뜻)
    SELECT value INTO v_pub_old FROM public.system_settings WHERE key = 'policy_upcoming_documents' FOR UPDATE;
    IF v_pub_old IS NULL OR (v_pub_old ->> 'status') IS DISTINCT FROM 'upcoming'
       OR (SELECT jsonb_agg(jsonb_build_array(d ->> 'key', d ->> 'sha256', d ->> 'changesSha256') ORDER BY d ->> 'key') FROM jsonb_array_elements(v_pub_old -> 'documents') d)
          IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_array(d ->> 'key', d ->> 'sha256', d ->> 'changesSha256') ORDER BY d ->> 'key') FROM jsonb_array_elements(v_documents) d)
       OR (SELECT jsonb_agg(jsonb_build_array(c ->> 'key', c ->> 'sha256') ORDER BY c ->> 'key') FROM jsonb_array_elements(v_pub_old -> 'consentItems') c)
          IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_array(c ->> 'key', c ->> 'sha256') ORDER BY c ->> 'key') FROM jsonb_array_elements(v_consent_items) c) THEN
      RAISE EXCEPTION 'POLICY_TEXT: fingerprints differ from the published upcoming documents — 고지한 글과 시행할 글이 다르다';
    END IF;

    -- 게시 행을 먼저 'applied' 로 바꾼다(고지 기간 잠금 트리거 3개가 풀린다). 그 뒤 같은 거래에서 저장한다.
    UPDATE public.system_settings
       SET value = v_pub_old || jsonb_build_object('status', 'applied', 'appliedAt', clock_timestamp()), updated_at = now()
     WHERE key = 'policy_upcoming_documents';
  END IF;

  IF c_mode = 'publish_upcoming' THEN
    -- 5-3(게시). 옛 표현 0건(새 본문 변수)
    FOR i IN 1 .. array_length(c_old_phrases, 1) LOOP
      IF position(c_old_phrases[i] IN v_chk_refund) > 0 OR position(c_old_phrases[i] IN v_chk_terms) > 0
         OR position(c_old_phrases[i] IN v_chk_privacy) > 0 OR position(c_old_phrases[i] IN v_chk_item_terms) > 0
         OR position(c_old_phrases[i] IN v_chk_item_privacy) > 0 THEN
        RAISE EXCEPTION 'VERIFY: old phrase remains: %', c_old_phrases[i];
      END IF;
    END LOOP;
  END IF;

  IF c_mode = 'apply' THEN
  -- 3. 약관 본문 저장(site_footer_content 는 한 번만 UPDATE — 사본 트리거가 문서별 1행)
  SELECT count(*) INTO v_snap_before FROM public.policy_document_snapshots;
  SELECT count(*) INTO v_waudit_before FROM public.admin_audit_log WHERE action = 'member_withdrawal_policy_update';
  SELECT count(*) INTO v_audit_before FROM public.admin_audit_log
   WHERE action IN ('site_footer_save', 'signup_consent_item_save') AND actor_id = v_actor;
  UPDATE public.system_settings
     SET value = jsonb_set(jsonb_set(jsonb_set(value,
                   '{policyDocuments,refundPolicy,content}', to_jsonb(v_refund_new)),
                   '{policyDocuments,serviceTerms,content}', to_jsonb(v_terms_new)),
                   '{policyDocuments,privacyPolicy,content}', to_jsonb(v_privacy_new)),
         updated_at = now()
   WHERE key = 'site_footer_content';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'POLICY_TEXT: site_footer_content update rows %', v_count;
  END IF;

  PERFORM public.record_admin_audit(v_actor, 'site_footer_save', 'site_footer', 'site_footer_content', NULL, NULL,
    '10번 회원 탈퇴(익명화) 반영 — 이용약관 12조·부칙, 취소/환불정책 8-2절, 개인정보처리방침 1·2·3·6·7·10절·시행일 — SQL 스크립트 supabase/scripts/20261126_bundle10_policy_text.sql',
    jsonb_build_object('bundle', 'bundle10_policy_text',
      'before', jsonb_build_object('refundPolicy', v_refund, 'serviceTerms', v_terms, 'privacyPolicy', v_privacy),
      'before_md5', jsonb_build_object('refundPolicy', md5(v_refund), 'serviceTerms', md5(v_terms), 'privacyPolicy', md5(v_privacy)),
      'after_md5', jsonb_build_object('refundPolicy', md5(v_refund_new), 'serviceTerms', md5(v_terms_new), 'privacyPolicy', md5(v_privacy_new)),
      'effective_date', v_date),
    NULL);

  -- 4. 가입 동의 항목 새 판(본문이 바뀌는 필수 항목 저장 = 판 +1, 변경 안내 note 기록, 작업 기록은 함수가 남김)
  v_save := public.save_signup_consent_item(v_actor, v_item_terms.id, v_item_terms.version, v_item_terms.label,
    v_item_terms_content, v_item_terms.required, v_item_terms.policy_slug, v_item_terms.sort_order, v_item_terms.is_active,
    c_terms_note, v_item_terms.updated_at, false);
  IF (v_save ->> 'after_version')::integer IS DISTINCT FROM v_item_terms.version + 1 OR (v_save ->> 'reconsent')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'POLICY_TEXT: terms consent item save %', v_save;
  END IF;
  v_save := public.save_signup_consent_item(v_actor, v_item_privacy.id, v_item_privacy.version, v_item_privacy.label,
    v_item_privacy_content, v_item_privacy.required, v_item_privacy.policy_slug, v_item_privacy.sort_order, v_item_privacy.is_active,
    c_privacy_note, v_item_privacy.updated_at, false);
  IF (v_save ->> 'after_version')::integer IS DISTINCT FROM v_item_privacy.version + 1 OR (v_save ->> 'reconsent')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'POLICY_TEXT: privacy consent item save %', v_save;
  END IF;

  -- 4-2. 탈퇴 정책 문구 세 줄(막힘 화면 2줄, 고지 원문 1줄)
  UPDATE public.system_settings SET value = v_wpolicy_new, updated_at = now() WHERE key = 'member_withdrawal_policy';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'POLICY_TEXT: member_withdrawal_policy update rows %', v_count;
  END IF;
  PERFORM public.record_admin_audit(v_actor, 'member_withdrawal_policy_update', 'system_settings', 'member_withdrawal_policy', NULL, NULL,
    '10번 탈퇴 안내 문구를 약관 표현과 맞춤 — SQL 스크립트 supabase/scripts/20261126_bundle10_policy_text.sql',
    jsonb_build_object('bundle', 'bundle10_policy_text',
      'changed_paths', to_jsonb(ARRAY(SELECT w_paths[j][1] FROM generate_subscripts(w_paths, 1) j ORDER BY j)),
      'before', to_jsonb(ARRAY(SELECT w_paths[j][2] FROM generate_subscripts(w_paths, 1) j ORDER BY j)),
      'after', to_jsonb(ARRAY(SELECT w_paths[j][3] FROM generate_subscripts(w_paths, 1) j ORDER BY j))),
    NULL);

  -- 5. VERIFY ─────────────────────────────────────────────────────────────────────────────────────────
  SELECT value INTO v_footer FROM public.system_settings WHERE key = 'site_footer_content';
  v_refund := v_footer #>> '{policyDocuments,refundPolicy,content}';
  v_terms := v_footer #>> '{policyDocuments,serviceTerms,content}';
  v_privacy := v_footer #>> '{policyDocuments,privacyPolicy,content}';
  IF v_refund IS DISTINCT FROM v_refund_new OR v_terms IS DISTINCT FROM v_terms_new OR v_privacy IS DISTINCT FROM v_privacy_new THEN
    RAISE EXCEPTION 'VERIFY: saved documents differ';
  END IF;

  -- 5-1. 고친 곳 밖은 그대로(약관 묶음의 다른 키·문서 메타)
  IF (v_footer #- '{policyDocuments,refundPolicy,content}' #- '{policyDocuments,serviceTerms,content}' #- '{policyDocuments,privacyPolicy,content}')
     IS DISTINCT FROM
     (v_footer_before #- '{policyDocuments,refundPolicy,content}' #- '{policyDocuments,serviceTerms,content}' #- '{policyDocuments,privacyPolicy,content}') THEN
    RAISE EXCEPTION 'VERIFY: unrelated footer content changed';
  END IF;

  -- 5-2. 동의 항목: terms·privacy 판 +1, 판 원문 = 항목(본문·note), age14·marketing 그대로
  SELECT * INTO v_item_terms FROM public.signup_consent_items WHERE key = 'terms';
  SELECT * INTO v_item_privacy FROM public.signup_consent_items WHERE key = 'privacy';
  IF v_item_terms.version <> c_item_terms_version + 1 OR v_item_terms.content <> v_item_terms_content
     OR v_item_privacy.version <> c_item_privacy_version + 1 OR v_item_privacy.content <> v_item_privacy_content THEN
    RAISE EXCEPTION 'VERIFY: consent items not saved (terms v%, privacy v%)', v_item_terms.version, v_item_privacy.version;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.signup_consent_item_versions v
                  WHERE v.item_id = v_item_terms.id AND v.version = v_item_terms.version AND v.content = v_item_terms.content
                    AND v.label = v_item_terms.label AND v.required AND v.policy_slug = 'service' AND v.note = c_terms_note)
     OR NOT EXISTS (SELECT 1 FROM public.signup_consent_item_versions v
                  WHERE v.item_id = v_item_privacy.id AND v.version = v_item_privacy.version AND v.content = v_item_privacy.content
                    AND v.label = v_item_privacy.label AND v.required AND v.policy_slug IS NULL AND v.note = c_privacy_note) THEN
    RAISE EXCEPTION 'VERIFY: consent item version rows';
  END IF;
  IF (SELECT row(i.version, i.content, i.updated_at) FROM public.signup_consent_items i WHERE i.key = 'age14')
       IS DISTINCT FROM row(v_item_age14_before.version, v_item_age14_before.content, v_item_age14_before.updated_at)
     OR (SELECT row(i.version, i.content, i.updated_at) FROM public.signup_consent_items i WHERE i.key = 'marketing')
       IS DISTINCT FROM row(v_item_marketing_before.version, v_item_marketing_before.content, v_item_marketing_before.updated_at) THEN
    RAISE EXCEPTION 'VERIFY: age14/marketing consent items changed';
  END IF;
  -- 시행: 아래 5-3~5-5 는 저장한 뒤의 DB 값으로 본다.
  v_chk_terms := v_terms;
  v_chk_refund := v_refund;
  v_chk_privacy := v_privacy;
  v_chk_item_terms := v_item_terms.content;
  v_chk_item_privacy := v_item_privacy.content;
  v_chk_wpolicy := (SELECT value FROM public.system_settings WHERE key = 'member_withdrawal_policy');

  -- 5-3. 옛 표현 0건(세 문서·동의 항목 본문)
  FOR i IN 1 .. array_length(c_old_phrases, 1) LOOP
    IF position(c_old_phrases[i] IN v_chk_refund) > 0 OR position(c_old_phrases[i] IN v_chk_terms) > 0
       OR position(c_old_phrases[i] IN v_chk_privacy) > 0 OR position(c_old_phrases[i] IN v_chk_item_terms) > 0
       OR position(c_old_phrases[i] IN v_chk_item_privacy) > 0 THEN
      RAISE EXCEPTION 'VERIFY: old phrase remains: %', c_old_phrases[i];
    END IF;
  END LOOP;
  END IF;

  -- 5-4. 새 절·조가 정확히 1번, 시행일 = c_effective_date, 12조는 ①~④ (게시: 새 본문 변수 / 시행: 저장한 DB 값)
  IF (length(v_chk_refund) - length(replace(v_chk_refund, E'\n## 8-2. 회원 탈퇴와 크레딧\n', ''))) / length(E'\n## 8-2. 회원 탈퇴와 크레딧\n') <> 1
     OR position(E'\n## 8. 서비스 종료 시 처리\n' IN v_chk_refund) > position(E'\n## 8-2. 회원 탈퇴와 크레딧\n' IN v_chk_refund)
     OR position(E'\n## 8-2. 회원 탈퇴와 크레딧\n' IN v_chk_refund) > position(E'\n## 9. 부정 결제 및 악용 방지\n' IN v_chk_refund) THEN
    RAISE EXCEPTION 'VERIFY: refund section 8-2 position';
  END IF;
  -- 처리방침 3절: '법령에 따라 보존' 다음 '분쟁 대응을 위해 회사가 보관', 둘 다 3절 안(4절 앞)에 1번씩
  IF (length(v_chk_privacy) - length(replace(v_chk_privacy, E'\n### 법령에 따라 보존하는 기록\n', ''))) / length(E'\n### 법령에 따라 보존하는 기록\n') <> 1
     OR (length(v_chk_privacy) - length(replace(v_chk_privacy, E'\n### 분쟁 대응을 위해 회사가 보관하는 기록\n', ''))) / length(E'\n### 분쟁 대응을 위해 회사가 보관하는 기록\n') <> 1
     OR NOT (position(E'\n## 3. 개인정보의 보유 및 이용 기간\n' IN v_chk_privacy) < position(E'\n### 법령에 따라 보존하는 기록\n' IN v_chk_privacy)
             AND position(E'\n### 법령에 따라 보존하는 기록\n' IN v_chk_privacy) < position(E'\n### 분쟁 대응을 위해 회사가 보관하는 기록\n' IN v_chk_privacy)
             AND position(E'\n### 분쟁 대응을 위해 회사가 보관하는 기록\n' IN v_chk_privacy) < position(E'\n## 4. 개인정보의 제3자 제공\n' IN v_chk_privacy)) THEN
    RAISE EXCEPTION 'VERIFY: privacy section 3 split';
  END IF;
  v_text := split_part(substr(v_chk_terms, position(E'## 제12조(계약 해지와 탈퇴)\n' IN v_chk_terms)), E'\n## ', 1);
  IF position(E'\n① 회원은 언제든지 마이페이지의 회원 탈퇴 화면에서' IN v_text) = 0 OR position(E'\n② 탈퇴하면 남은 크레딧' IN v_text) = 0
     OR position(E'\n③ 탈퇴하면 구매한 자료를' IN v_text) = 0 OR position(E'\n④ 회원이 이 약관을 중대하게 어기면' IN v_text) = 0
     OR position('⑤' IN v_text) > 0 OR position('취소/환불정책 8-2절' IN v_text) = 0 THEN
    RAISE EXCEPTION 'VERIFY: terms article 12';
  END IF;
  IF position('이 약관은 ' || v_date || '부터 시행합니다.' IN v_chk_terms) = 0
     OR position(E'\n\n시행일: ' || v_date || E'\n' IN v_chk_privacy) = 0
     OR v_date !~ '^20[0-9]{2}년 [1-9][0-9]?월 [1-9][0-9]?일$' THEN
    RAISE EXCEPTION 'VERIFY: effective date % not written', v_date;
  END IF;

  -- 5-5. 문구의 보존 기간·일수 = DB 값(member_withdrawal_policy). X 는 새 탈퇴 정책(게시: v_wpolicy_new, 시행: 저장한 값)
  FOR i IN 1 .. array_length(c_num_checks, 1) LOOP
    v_target := '';
    IF position('T' IN c_num_checks[i][1]) > 0 THEN v_target := v_target || E'\n' || v_chk_terms || E'\n' || v_chk_item_terms; END IF;
    IF position('R' IN c_num_checks[i][1]) > 0 THEN v_target := v_target || E'\n' || v_chk_refund; END IF;
    IF position('P' IN c_num_checks[i][1]) > 0 THEN v_target := v_target || E'\n' || v_chk_privacy; END IF;
    IF position('I' IN c_num_checks[i][1]) > 0 THEN v_target := v_target || E'\n' || v_chk_item_privacy; END IF;
    IF position('N' IN c_num_checks[i][1]) > 0 THEN v_target := v_target || E'\n' || c_terms_note || E'\n' || c_privacy_note; END IF;
    IF position('X' IN c_num_checks[i][1]) > 0 THEN
      v_target := v_target || E'\n' || (v_chk_wpolicy #>> '{texts,blockReasons,REFUND_PERIOD_BUFFER}');
    END IF;
    v_expected := public.member_withdrawal_policy_days(c_num_checks[i][4]);
    IF v_expected IS NULL THEN
      RAISE EXCEPTION 'VERIFY: policy key % unreadable', c_num_checks[i][4];
    END IF;
    v_count := 0;
    FOR v_num IN SELECT m[c_num_checks[i][3]::integer] FROM regexp_matches(v_target, c_num_checks[i][2], 'g') AS m LOOP
      v_count := v_count + 1;
      IF v_num::integer <> v_expected THEN
        RAISE EXCEPTION 'VERIFY: % in text % <> policy % (pattern %)', c_num_checks[i][4], v_num, v_expected, c_num_checks[i][2];
      END IF;
    END LOOP;
    IF v_count < c_num_checks[i][5]::integer THEN
      RAISE EXCEPTION 'VERIFY: % sentences % (expected >= %)', c_num_checks[i][4], v_count, c_num_checks[i][5];
    END IF;
  END LOOP;

  IF c_mode = 'publish_upcoming' THEN
    -- 5-7-3(게시). 자리표시 검사만: 새 ticketsPayer 의 자리표시자를 정책 값으로 채운 뒤 {…} 가 남지 않고 비어 있지 않다.
    v_text := replace(replace(w_paths[3][3],
      '{결제문의보존기간}', public.member_withdrawal_policy_days('payerTicketRetentionYears')::text),
      '{환불문의보존기간}', public.member_withdrawal_policy_days('payerRefundTicketRetentionYears')::text);
    IF v_text IS NULL OR btrim(v_text) = '' OR v_text ~ '\{[^}]*\}' THEN
      RAISE EXCEPTION 'VERIFY: ticketsPayer placeholders not filled';
    END IF;

    -- 6. 게시 행 넣기(15번 4-3). 행이 이미 있으면: applied → 멈춤 / upcoming·지문 같음 → 화면 글만 바꿈(publishedAt 유지) /
    --    upcoming·지문 다름 또는 reverted → c_republish_reason 이 있어야 새로 시작(앞 지문·시각은 superseded 로).
    v_pub_new := v_pub_texts || jsonb_build_object(
      'status', 'upcoming',
      'effectiveDate', to_char(c_effective_date, 'YYYY-MM-DD'),
      'effectiveDateLabel', v_date,
      'noticeDeadline', to_char(c_notice_deadline, 'YYYY-MM-DD'),
      'publishedAt', to_jsonb(clock_timestamp()),
      'appliedAt', NULL,
      'revertedAt', NULL,
      'lockedWithdrawalPaths', v_locked_paths,
      'baseMd5', jsonb_build_object('serviceTerms', md5(v_terms), 'refundPolicy', md5(v_refund), 'privacyPolicy', md5(v_privacy)),
      'documents', v_documents,
      'consentItems', v_consent_items,
      'superseded', '[]'::jsonb);
    SELECT value INTO v_pub_old FROM public.system_settings WHERE key = 'policy_upcoming_documents' FOR UPDATE;
    IF v_pub_old IS NULL THEN
      v_publish_kind := 'new';
      INSERT INTO public.system_settings (key, value, description, updated_at)
      VALUES ('policy_upcoming_documents', v_pub_new,
              '변경 예정 약관(30일 전 고지): 바뀔 전문·변경 전후·동의 항목 새 글. 10번 약관 스크립트(publish_upcoming·apply·withdraw_upcoming)로만 고친다.',
              now());
    ELSIF (v_pub_old ->> 'status') = 'applied' THEN
      RAISE EXCEPTION 'POLICY_TEXT: upcoming documents already applied — publish a new revision only after a new plan';
    ELSIF (v_pub_old ->> 'status') = 'upcoming'
          AND (v_pub_old -> 'documents') IS NOT NULL
          AND (SELECT jsonb_agg(jsonb_build_array(d ->> 'key', d ->> 'sha256', d ->> 'changesSha256') ORDER BY d ->> 'key') FROM jsonb_array_elements(v_pub_old -> 'documents') d)
              IS NOT DISTINCT FROM (SELECT jsonb_agg(jsonb_build_array(d ->> 'key', d ->> 'sha256', d ->> 'changesSha256') ORDER BY d ->> 'key') FROM jsonb_array_elements(v_documents) d)
          AND (SELECT jsonb_agg(jsonb_build_array(c ->> 'key', c ->> 'sha256') ORDER BY c ->> 'key') FROM jsonb_array_elements(v_pub_old -> 'consentItems') c)
              IS NOT DISTINCT FROM (SELECT jsonb_agg(jsonb_build_array(c ->> 'key', c ->> 'sha256') ORDER BY c ->> 'key') FROM jsonb_array_elements(v_consent_items) c)
          AND (v_pub_old -> 'lockedWithdrawalPaths') IS NOT DISTINCT FROM v_locked_paths
          AND (v_pub_old ->> 'effectiveDate') IS NOT DISTINCT FROM (v_pub_new ->> 'effectiveDate')
          AND (v_pub_old ->> 'noticeDeadline') IS NOT DISTINCT FROM (v_pub_new ->> 'noticeDeadline') THEN
      -- 같은 지문: 머리말·한 줄 안내·하단 링크·상태별 줄·화면 글만 바꾼다(publishedAt 그대로).
      v_publish_kind := 'texts_only';
      v_pub_new := v_pub_old || v_pub_texts;
      IF v_pub_new = v_pub_old THEN
        RAISE EXCEPTION 'POLICY_TEXT: already published with the same content and texts (nothing to do)';
      END IF;
      UPDATE public.system_settings SET value = v_pub_new, updated_at = now() WHERE key = 'policy_upcoming_documents';
    ELSE
      IF c_republish_reason IS NULL OR btrim(c_republish_reason) = '' THEN
        RAISE EXCEPTION 'POLICY_TEXT: published upcoming documents differ (status %) — set c_republish_reason to restart the 30-day notice', v_pub_old ->> 'status';
      END IF;
      v_publish_kind := 'republish';
      v_pub_new := jsonb_set(v_pub_new, '{superseded}', coalesce(v_pub_old -> 'superseded', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'status', v_pub_old -> 'status',
        'publishedAt', v_pub_old -> 'publishedAt',
        'appliedAt', v_pub_old -> 'appliedAt',
        'revertedAt', v_pub_old -> 'revertedAt',
        'effectiveDate', v_pub_old -> 'effectiveDate',
        'documentsSha256', (SELECT jsonb_object_agg(d ->> 'key', d ->> 'sha256') FROM jsonb_array_elements(v_pub_old -> 'documents') d),
        'changesSha256', (SELECT jsonb_object_agg(d ->> 'key', d ->> 'changesSha256') FROM jsonb_array_elements(v_pub_old -> 'documents') d),
        'consentSha256', (SELECT jsonb_object_agg(c ->> 'key', c ->> 'sha256') FROM jsonb_array_elements(v_pub_old -> 'consentItems') c),
        'reason', c_republish_reason,
        'supersededAt', to_jsonb(clock_timestamp()))));
      UPDATE public.system_settings SET value = v_pub_new, updated_at = now() WHERE key = 'policy_upcoming_documents';
    END IF;

    -- 작업 기록: 행 전체(원문 포함)가 추가 전용 표에 남는다. 10번 확인 조회의 bundle10_policy_text 건수에는 섞이지 않는다.
    PERFORM public.record_admin_audit(v_actor, 'policy_upcoming_publish', 'system_settings', 'policy_upcoming_documents', NULL, NULL,
      CASE WHEN v_publish_kind = 'republish' THEN c_republish_reason END,
      jsonb_build_object('bundle', 'bundle15_policy_upcoming', 'kind', v_publish_kind,
        'row', v_pub_new,
        'documents_sha256', (SELECT jsonb_object_agg(d ->> 'key', d ->> 'sha256') FROM jsonb_array_elements(v_pub_new -> 'documents') d),
        'changes_sha256', (SELECT jsonb_object_agg(d ->> 'key', d ->> 'changesSha256') FROM jsonb_array_elements(v_pub_new -> 'documents') d),
        'consent_sha256', (SELECT jsonb_object_agg(c ->> 'key', c ->> 'sha256') FROM jsonb_array_elements(v_pub_new -> 'consentItems') c),
        'base_md5', v_pub_new -> 'baseMd5',
        'effective_date', v_pub_new -> 'effectiveDate',
        'saved_at', to_jsonb(clock_timestamp())),
      NULL);
    RAISE NOTICE 'POLICY_TEXT OK: published upcoming documents (%), effective %, notice deadline %', v_publish_kind, v_date, c_notice_deadline;
    RETURN;
  END IF;

  -- 5-6. 사본: 세 문서 1행씩만 늘고, 최신 사본 = 새 본문 = 게시 행 지문
  SELECT count(*) INTO v_count FROM public.policy_document_snapshots;
  IF v_count - v_snap_before <> 3 THEN
    RAISE EXCEPTION 'VERIFY: snapshots added % (expected 3)', v_count - v_snap_before;
  END IF;
  IF (SELECT content_sha256 FROM public.policy_document_snapshots WHERE doc_key = 'refundPolicy' ORDER BY seq DESC LIMIT 1)
       <> encode(sha256(convert_to(v_refund_new, 'UTF8')), 'hex')
     OR (SELECT content_sha256 FROM public.policy_document_snapshots WHERE doc_key = 'serviceTerms' ORDER BY seq DESC LIMIT 1)
       <> encode(sha256(convert_to(v_terms_new, 'UTF8')), 'hex')
     OR (SELECT content_sha256 FROM public.policy_document_snapshots WHERE doc_key = 'privacyPolicy' ORDER BY seq DESC LIMIT 1)
       <> encode(sha256(convert_to(v_privacy_new, 'UTF8')), 'hex') THEN
    RAISE EXCEPTION 'VERIFY: latest snapshots differ';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_pub_old -> 'documents') d
              WHERE (SELECT s.content_sha256 FROM public.policy_document_snapshots s WHERE s.doc_key = d ->> 'key' ORDER BY s.seq DESC LIMIT 1)
                    IS DISTINCT FROM d ->> 'sha256') THEN
    RAISE EXCEPTION 'VERIFY: latest snapshots differ from published upcoming documents';
  END IF;

  -- 5-7. 작업 기록: 약관 저장 1건 + 동의 항목 저장 2건
  SELECT count(*) INTO v_count FROM public.admin_audit_log
   WHERE action IN ('site_footer_save', 'signup_consent_item_save') AND actor_id = v_actor;
  IF v_count - v_audit_before <> 3 THEN
    RAISE EXCEPTION 'VERIFY: audit rows added % (expected 3)', v_count - v_audit_before;
  END IF;

  -- 5-7-2. 탈퇴 정책: 세 줄만 바뀌고 나머지(기간·스위치·다른 문구)는 그대로
  IF (SELECT value FROM public.system_settings WHERE key = 'member_withdrawal_policy') IS DISTINCT FROM v_wpolicy_new THEN
    RAISE EXCEPTION 'VERIFY: member_withdrawal_policy not saved';
  END IF;
  v_check := v_wpolicy_new;
  FOR i IN 1 .. array_length(w_paths, 1) LOOP
    v_check := jsonb_set(v_check, w_paths[i][1]::text[], to_jsonb(w_paths[i][2]));
  END LOOP;
  IF v_check IS DISTINCT FROM v_wpolicy THEN
    RAISE EXCEPTION 'VERIFY: unrelated member_withdrawal_policy content changed';
  END IF;
  IF (SELECT count(*) FROM public.admin_audit_log WHERE action = 'member_withdrawal_policy_update') - v_waudit_before <> 1 THEN
    RAISE EXCEPTION 'VERIFY: member_withdrawal_policy audit row';
  END IF;

  -- 5-7-3. 고지 원문(결제 회원·문의 있음)에 새 ticketsPayer 가 보존 기간 숫자로 채워져 들어간다
  v_notice := public.member_withdrawal_notice_text('request',
    jsonb_build_object('hadPayment', true, 'hasOrdersOrAttempts', true, 'ticketCount', 1, 'pendingTicketCount', 0,
                       'balance', jsonb_build_object('forfeitTotal', 0), 'marketingAgreed', false), NULL);
  IF v_notice IS NULL OR position(replace(replace(w_paths[3][3],
         '{결제문의보존기간}', public.member_withdrawal_policy_days('payerTicketRetentionYears')::text),
         '{환불문의보존기간}', public.member_withdrawal_policy_days('payerRefundTicketRetentionYears')::text) IN v_notice) = 0 THEN
    RAISE EXCEPTION 'VERIFY: payer notice does not contain new ticketsPayer line';
  END IF;

  -- 5-7-4. 실제 회원마다 get_member_withdrawal_notice 가 고지 원문을 만들고(오류 없음), 옛 ticketsPayer 표현이 없다
  v_checked := 0;
  v_payer_ticket_hits := 0;
  FOR v_member IN
    SELECT p.id FROM public.profiles p JOIN auth.users u ON u.id = p.id
     WHERE NOT public.is_internal_admin_account(u.email) AND p.withdrawn_at IS NULL
       AND ((p.provider = 'kakao' AND p.signup_completed IS TRUE) OR (p.provider IS DISTINCT FROM 'kakao' AND u.email_confirmed_at IS NOT NULL))
  LOOP
    v_member_notice := public.get_member_withdrawal_notice(v_member, 'self', NULL);
    v_text := v_member_notice ->> 'text';
    IF v_text IS NULL OR position('(환불 신청과 연결된 문의는 ' IN v_text) > 0
       OR position(replace(v_policy #>> '{texts,notice,termsVersion}', '{약관판}', (c_item_terms_version + 1)::text) IN v_text) = 0 THEN
      RAISE EXCEPTION 'VERIFY: member notice text for a member is invalid';
    END IF;
    IF position(c_tickets_payer_old_prefix IN v_text) > 0 THEN
      IF position('환불 신청과 연결된 문의는 분쟁 확인을 위해 마지막 처리일부터 ' IN v_text) = 0 THEN
        RAISE EXCEPTION 'VERIFY: member notice ticketsPayer line not updated';
      END IF;
      v_payer_ticket_hits := v_payer_ticket_hits + 1;
    END IF;
    v_checked := v_checked + 1;
  END LOOP;
  IF v_checked <> c_confirmed_count THEN
    RAISE EXCEPTION 'VERIFY: member notices checked % (expected %)', v_checked, c_confirmed_count;
  END IF;

  -- 5-8. 탈퇴 고지 원문이 새 약관 판을 가리키고, 스위치는 그대로 꺼짐
  v_notice := public.member_withdrawal_notice_text('self',
    jsonb_build_object('hadPayment', false, 'hasOrdersOrAttempts', false, 'ticketCount', 0, 'pendingTicketCount', 0,
                       'balance', jsonb_build_object('forfeitTotal', 0), 'marketingAgreed', false), NULL);
  IF v_notice IS NULL OR position(replace(v_policy #>> '{texts,notice,termsVersion}', '{약관판}', v_item_terms.version::text) IN v_notice) = 0 THEN
    RAISE EXCEPTION 'VERIFY: withdrawal notice does not cite terms version %', v_item_terms.version;
  END IF;
  IF (SELECT value -> 'selfAnonymizeEnabled' FROM public.system_settings WHERE key = 'member_withdrawal_policy') IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'VERIFY: selfAnonymizeEnabled changed';
  END IF;

  -- 5-9. 재동의 영향(정보): 동의 대상 회원 수, 지금까지 통과하던 회원 중 다시 동의해야 하는 수
  v_eligible := public.consent_eligible_member_count();
  SELECT count(*) INTO v_gated_after
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE NOT public.is_internal_admin_account(u.email) AND p.withdrawn_at IS NULL
     AND ((p.provider = 'kakao' AND p.signup_completed IS TRUE) OR (p.provider IS DISTINCT FROM 'kakao' AND u.email_confirmed_at IS NOT NULL))
     AND EXISTS (SELECT 1 FROM public.consent_missing_required(p.id, '[]'::jsonb));
  IF v_gated_after <> v_eligible THEN
    RAISE EXCEPTION 'VERIFY: % of % eligible members still pass consent gate after new versions', v_eligible - v_gated_after, v_eligible;
  END IF;

  -- 시행 기록(15번): 지문 일치, 고지 판정 S 기록 id·마지막 기록 id
  PERFORM public.record_admin_audit(v_actor, 'policy_upcoming_apply', 'system_settings', 'policy_upcoming_documents', NULL, NULL, NULL,
    jsonb_build_object('bundle', 'bundle15_policy_upcoming',
      'fingerprints_match', true,
      'documents_sha256', (SELECT jsonb_object_agg(d ->> 'key', d ->> 'sha256') FROM jsonb_array_elements(v_documents) d),
      'consent_sha256', (SELECT jsonb_object_agg(c ->> 'key', c ->> 'sha256') FROM jsonb_array_elements(v_consent_items) c),
      'continuity_s_id', v_cont -> 's_id',
      'continuity_last_id', v_cont -> 'last_id',
      'published_at', v_pub_old -> 'publishedAt',
      'effective_date', to_char(c_effective_date, 'YYYY-MM-DD'),
      'saved_at', to_jsonb(clock_timestamp())),
    NULL);
  RAISE NOTICE 'POLICY_TEXT OK: effective %, terms v%, privacy v%, eligible members %, newly re-consent % (others had not consented yet), member notices % (payer-ticket lines %)',
    v_date, v_item_terms.version, v_item_privacy.version, v_eligible, v_ok_before, v_checked, v_payer_ticket_hits;
END;
$policy_text$;$rh_src_policy_text$);
SELECT pg_temp.ctx_set('src_withdraw_text', $rh_src_withdraw_text$DO $withdraw_disabled_text$
DECLARE
  c_mode constant text := NULL;
  -- 고지 문구의 날짜: 바뀔 약관의 시행일, 지금(바뀌기 전) 약관의 시행일
  c_effective_date constant date := DATE '2027-01-11';
  c_current_terms_date constant date := DATE '2026-11-23';
  -- 10번 마이그레이션이 넣은 운영 문구(2026-11-25 읽기 조회로 확인)
  c_original constant text := $q$지금은 탈퇴 신청을 받을 수 없습니다. 잠시 후 다시 이용해 주세요.$q$;
  c_path constant text[] := ARRAY['texts', 'blockReasons', 'DISABLED'];
  v_notice text;
  v_policy jsonb;
  v_new jsonb;
  v_current text;
  v_last_after text;
  v_target text;
  v_actor uuid;
  v_audit_before integer;
BEGIN
  IF c_mode IS NULL OR c_mode NOT IN ('notice', 'restore') THEN
    RAISE EXCEPTION 'WITHDRAW_TEXT: set c_mode to notice or restore';
  END IF;
  v_notice := '지금은 이 화면에서 탈퇴를 받을 수 없습니다. 고객센터(이메일·전화)로 탈퇴를 요청해 주세요. 요청일부터 10일 안에 처리해 이메일로 알려 드립니다. '
    || to_char(c_effective_date, 'YYYY"년" FMMM"월" FMDD"일"') || ' 전에 요청하시면 바뀌기 전 약관('
    || to_char(c_current_terms_date, 'YYYY"년" FMMM"월" FMDD"일"') || ' 시행)이 적용됩니다.';

  SELECT p.id INTO v_actor FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.is_admin IS TRUE AND p.admin_role = 'owner' AND u.last_sign_in_at IS NOT NULL
   ORDER BY u.last_sign_in_at DESC LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'WITHDRAW_TEXT: signed-in owner account not found';
  END IF;

  SELECT value INTO v_policy FROM public.system_settings WHERE key = 'member_withdrawal_policy' FOR UPDATE;
  IF v_policy IS NULL OR jsonb_typeof(v_policy #> c_path) IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'WITHDRAW_TEXT: member_withdrawal_policy texts.blockReasons.DISABLED missing';
  END IF;
  v_current := v_policy #>> c_path;
  SELECT a.details ->> 'after' INTO v_last_after FROM public.admin_audit_log a
   WHERE a.action = 'member_withdrawal_policy_update' AND a.details ->> 'bundle' = 'bundle15_withdraw_disabled_text'
   ORDER BY (a.details ->> 'saved_at')::timestamptz DESC LIMIT 1;

  IF c_mode = 'notice' THEN
    IF v_current IS DISTINCT FROM c_original AND v_current IS DISTINCT FROM v_last_after THEN
      RAISE EXCEPTION 'WITHDRAW_TEXT: DISABLED is neither the original text nor the last notice text — merge by hand';
    END IF;
    IF v_current = v_notice THEN
      RAISE EXCEPTION 'WITHDRAW_TEXT: DISABLED is already this notice text (nothing to do)';
    END IF;
    v_target := v_notice;
  ELSE
    IF v_last_after IS NULL OR v_current IS DISTINCT FROM v_last_after OR v_current = c_original THEN
      RAISE EXCEPTION 'WITHDRAW_TEXT: DISABLED is not the last notice text — nothing to restore or changed by hand';
    END IF;
    v_target := c_original;
  END IF;

  v_new := jsonb_set(v_policy, c_path, to_jsonb(v_target));
  -- 그 한 경로만 바뀐다(바꾼 경로를 되돌린 값 = 처음 값)
  IF jsonb_set(v_new, c_path, to_jsonb(v_current)) IS DISTINCT FROM v_policy THEN
    RAISE EXCEPTION 'WITHDRAW_TEXT: unexpected change outside DISABLED';
  END IF;

  SELECT count(*) INTO v_audit_before FROM public.admin_audit_log
   WHERE action = 'member_withdrawal_policy_update' AND details ->> 'bundle' = 'bundle15_withdraw_disabled_text';
  UPDATE public.system_settings SET value = v_new, updated_at = now() WHERE key = 'member_withdrawal_policy';
  PERFORM public.record_admin_audit(v_actor, 'member_withdrawal_policy_update', 'system_settings', 'member_withdrawal_policy', NULL, NULL,
    '15번 탈퇴 화면 막힘 문구(' || c_mode || ') — SQL 스크립트 supabase/scripts/20261205_bundle15_withdraw_disabled_text.sql',
    jsonb_build_object('bundle', 'bundle15_withdraw_disabled_text',
      'mode', c_mode,
      'changed_paths', jsonb_build_array('{texts,blockReasons,DISABLED}'),
      'before', v_current,
      'after', v_target,
      'saved_at', to_jsonb(clock_timestamp())),
    NULL);

  -- VERIFY
  IF (SELECT value FROM public.system_settings WHERE key = 'member_withdrawal_policy') IS DISTINCT FROM v_new THEN
    RAISE EXCEPTION 'VERIFY: member_withdrawal_policy not saved';
  END IF;
  IF (SELECT count(*) FROM public.admin_audit_log
       WHERE action = 'member_withdrawal_policy_update' AND details ->> 'bundle' = 'bundle15_withdraw_disabled_text') - v_audit_before <> 1 THEN
    RAISE EXCEPTION 'VERIFY: audit row';
  END IF;
  RAISE NOTICE 'WITHDRAW_TEXT OK: % → %', c_mode, v_target;
END;
$withdraw_disabled_text$;$rh_src_withdraw_text$);
SELECT pg_temp.ctx_set('src_revert', $rh_src_revert$DO $revert$
DECLARE a jsonb; w jsonb; f jsonb; p jsonb; n integer; j integer; v_actor uuid;
BEGIN
  -- 12조②(크레딧 소멸)가 없는 약관으로 되돌리기 전에 탈퇴 경로가 꺼져 있어야 한다.
  SELECT value INTO p FROM public.system_settings WHERE key = 'member_withdrawal_policy' FOR UPDATE;
  IF (p -> 'selfAnonymizeEnabled') IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'REVERT: turn selfAnonymizeEnabled off first';
  END IF;
  SELECT details INTO a FROM public.admin_audit_log WHERE action = 'site_footer_save' AND details->>'bundle' = 'bundle10_policy_text'
   ORDER BY created_at DESC LIMIT 1;
  SELECT details INTO w FROM public.admin_audit_log WHERE action = 'member_withdrawal_policy_update' AND details->>'bundle' = 'bundle10_policy_text'
   ORDER BY created_at DESC LIMIT 1;
  SELECT value INTO f FROM public.system_settings WHERE key = 'site_footer_content' FOR UPDATE;
  IF w IS NULL THEN RAISE EXCEPTION 'REVERT: policy text audit row missing'; END IF;
  FOR j IN 0 .. jsonb_array_length(w -> 'changed_paths') - 1 LOOP
    IF (p #>> ((w -> 'changed_paths' ->> j)::text[])) IS DISTINCT FROM (w -> 'after' ->> j) THEN
      RAISE EXCEPTION 'REVERT: member_withdrawal_policy % changed after bundle10 script — merge by hand', w -> 'changed_paths' ->> j;
    END IF;
    p := jsonb_set(p, (w -> 'changed_paths' ->> j)::text[], w -> 'before' -> j);
  END LOOP;
  UPDATE public.system_settings SET value = p, updated_at = now() WHERE key = 'member_withdrawal_policy';
  IF a IS NULL OR md5(f #>> '{policyDocuments,refundPolicy,content}') <> a #>> '{after_md5,refundPolicy}'
     OR md5(f #>> '{policyDocuments,serviceTerms,content}') <> a #>> '{after_md5,serviceTerms}'
     OR md5(f #>> '{policyDocuments,privacyPolicy,content}') <> a #>> '{after_md5,privacyPolicy}' THEN
    RAISE EXCEPTION 'REVERT: documents changed after bundle10 script — merge by hand';
  END IF;
  UPDATE public.system_settings
     SET value = jsonb_set(jsonb_set(jsonb_set(value,
                   '{policyDocuments,refundPolicy,content}', a #> '{before,refundPolicy}'),
                   '{policyDocuments,serviceTerms,content}', a #> '{before,serviceTerms}'),
                   '{policyDocuments,privacyPolicy,content}', a #> '{before,privacyPolicy}'), updated_at = now()
   WHERE key = 'site_footer_content';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'REVERT: rows %', n; END IF;
  SELECT p.id INTO v_actor FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.is_admin IS TRUE AND p.admin_role = 'owner' AND u.last_sign_in_at IS NOT NULL ORDER BY u.last_sign_in_at DESC LIMIT 1;
  PERFORM public.record_admin_audit(v_actor, 'site_footer_save', 'site_footer', 'site_footer_content', NULL, NULL,
    '10번 약관 문구 되돌리기', jsonb_build_object('bundle', 'bundle10_policy_text_revert', 'restored_md5', a -> 'before_md5'), NULL);
  PERFORM public.record_admin_audit(v_actor, 'member_withdrawal_policy_update', 'system_settings', 'member_withdrawal_policy', NULL, NULL,
    '10번 탈퇴 안내 문구 되돌리기', jsonb_build_object('bundle', 'bundle10_policy_text_revert', 'changed_paths', w -> 'changed_paths'), NULL);
  -- 15번 게시 행: 시행 뒤 되돌림을 표시한다('upcoming' 으로 돌리지 않는다. /terms/upcoming 이 '시행 뒤 되돌려짐'을 보인다).
  UPDATE public.system_settings
     SET value = value || jsonb_build_object('status', 'reverted', 'revertedAt', clock_timestamp()), updated_at = now()
   WHERE key = 'policy_upcoming_documents' AND value ->> 'status' = 'applied';
END;
$revert$;$rh_src_revert$);

-- 10번 약관 스크립트 사본: 바꾸는 줄은 생성기 POLICY_TEXT_LINES 뿐이다.
--   p_flags: 'relax_const'(상수 검사 끔 — R4 (가) 리허설 날 시행), 'skip_policies'(정책 없는 사본), 'skip_triggers'(트리거 없는 light 사본)
--   p_extra: 멈춤 경우용 [from, to] 쌍 배열(각 from 은 정확히 1번)
CREATE FUNCTION pg_temp.pt_sql(p_mode text, p_eff date, p_deadline date, p_last date, p_flags text[] DEFAULT '{}',
  p_extra jsonb DEFAULT '[]'::jsonb, p_republish text DEFAULT NULL, p_withdraw text DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v text := pg_temp.ctx('src_policy_text');
  e jsonb;
  c_eligible constant text := 'FROM public.profiles p JOIN auth.users u ON u.id = p.id WHERE NOT public.is_internal_admin_account(u.email) AND p.withdrawn_at IS NULL AND ((p.provider = ''kakao'' AND p.signup_completed IS TRUE) OR (p.provider IS DISTINCT FROM ''kakao'' AND u.email_confirmed_at IS NOT NULL))';
BEGIN
  v := pg_temp.subst_once(v, '  c_mode constant text := NULL;', '  c_mode constant text := ' || quote_nullable(p_mode) || ';');
  v := pg_temp.subst_once(v, '  c_effective_date constant date := DATE ''2027-01-11'';', '  c_effective_date constant date := DATE ' || quote_literal(p_eff::text) || ';');
  v := pg_temp.subst_once(v, '  c_notice_deadline constant date := DATE ''2026-12-10'';', '  c_notice_deadline constant date := DATE ' || quote_literal(p_deadline::text) || ';');
  v := pg_temp.subst_once(v, '  c_apply_last_date constant date := DATE ''2027-01-11'';', '  c_apply_last_date constant date := DATE ' || quote_literal(p_last::text) || ';');
  v := pg_temp.subst_once(v, '  c_republish_reason constant text := NULL;', '  c_republish_reason constant text := ' || quote_nullable(p_republish) || ';');
  v := pg_temp.subst_once(v, '  c_withdraw_reason constant text := NULL;', '  c_withdraw_reason constant text := ' || quote_nullable(p_withdraw) || ';');
  v := pg_temp.subst_once(v, '  c_confirmed_count constant integer := NULL;', '  c_confirmed_count constant integer := (SELECT count(*)::integer ' || c_eligible || ');');
  v := pg_temp.subst_once(v, '  c_confirmed_members_md5 constant text := NULL;', '  c_confirmed_members_md5 constant text := (SELECT md5(string_agg(p.id::text, '','' ORDER BY p.id)) ' || c_eligible || ');');
  IF 'relax_const' = ANY (p_flags) THEN
    v := pg_temp.subst_once(v, '  IF NOT (c_notice_deadline <= c_effective_date - 32) OR NOT (c_apply_last_date >= c_effective_date) THEN', '  IF false THEN');
  END IF;
  IF 'skip_policies' = ANY (p_flags) THEN
    v := pg_temp.subst_once(v, '  IF (SELECT count(*) FROM pg_policies WHERE schemaname = ''public'' AND tablename = ''system_settings'' AND permissive = ''RESTRICTIVE'' AND policyname IN (''system_settings_site_notice_popup_no_client_write'', ''system_settings_policy_upcoming_documents_no_client_write'')) <> 2 THEN', '  IF false THEN');
  END IF;
  IF 'skip_triggers' = ANY (p_flags) THEN
    v := pg_temp.subst_once(v, '              OR (t.tgrelid = ''public.signup_consent_items''::regclass AND t.tgname = ''lock_consent_items_during_notice''))) <> 3 THEN', replace('              OR (t.tgrelid = ''public.signup_consent_items''::regclass AND t.tgname = ''lock_consent_items_during_notice''))) <> 3 THEN', ') <> 3 THEN', ') < 0 THEN'));
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p_extra) x LOOP
    v := pg_temp.subst_once(v, e ->> 0, e ->> 1);
  END LOOP;
  RETURN v;
END $f$;

-- 4-6 작은 스크립트 사본: 바꾸는 줄은 WITHDRAW_TEXT_LINES 뿐이다.
CREATE FUNCTION pg_temp.wd_sql(p_mode text, p_eff date DEFAULT DATE '2027-01-11') RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v text := pg_temp.ctx('src_withdraw_text');
BEGIN
  v := pg_temp.subst_once(v, '  c_mode constant text := NULL;', '  c_mode constant text := ' || quote_nullable(p_mode) || ';');
  v := pg_temp.subst_once(v, '  c_effective_date constant date := DATE ''2027-01-11'';', '  c_effective_date constant date := DATE ' || quote_literal(p_eff::text) || ';');
  RETURN v;
END $f$;
CREATE FUNCTION pg_temp.disabled_text() RETURNS text LANGUAGE sql AS $f$
  SELECT value #>> '{texts,blockReasons,DISABLED}' FROM public.system_settings WHERE key = 'member_withdrawal_policy'
$f$;
-- ===== R1: 15번 마이그레이션(원본 그대로) =====
-- 출시 전 작업 순서표 15번 묶음(먼저 할 부분): 공지 팝업과 약관 변경 30일 전 고지(계획 docs/plan-bundle15-notice-popup.md 6판 4절).
-- 만드는 것:
--   1. system_settings 'site_notice_popup'(공지 팝업 문구·노출 기간·켜기, 처음엔 꺼짐). 9절 초안을 ON CONFLICT DO NOTHING 으로 넣는다.
--   2. 함수: site_notice_popup_content_sha256(내용 지문, STABLE), save_site_notice_popup(대표만, 작업 기록 함께, service_role),
--      policy_upcoming_notice_record_good(좋은 기록 한 건 판정, 내부용), policy_upcoming_notice_continuity(고지 끊김 판정, service_role).
--   3. RESTRICTIVE FOR UPDATE 정책 2개(site_notice_popup·policy_upcoming_documents — 화면 세션 직접 쓰기 차단).
--      policy_upcoming_documents 정책은 되돌리기(down)가 일부러 남기므로 pg_policies 에 없을 때만 만든다(다시 적용해도 멈추지 않게).
--   4. 고지 기간 잠금 트리거 3개(게시 행 policy_upcoming_documents 가 'upcoming' 일 때만 막음, 오류 POLICY_UPCOMING_LOCKED):
--      약관 문서(site_footer_content), 가입 동의 항목(signup_consent_items), 탈퇴 정책 문구(member_withdrawal_policy).
--      막을 문서 key·동의 항목 key·탈퇴 정책 경로는 게시 행에서 읽는다(트리거 안에 상수로 두지 않음).
-- 게시 행(policy_upcoming_documents)은 이 마이그레이션이 만들지 않는다. 10번 약관 스크립트(publish_upcoming)가 넣는다.
-- 잠금: CREATE POLICY 는 system_settings 에 ACCESS EXCLUSIVE(읽기도 막음), CREATE TRIGGER 는 SHARE ROW EXCLUSIVE(쓰기만 막음)를 잡는다.
--   그래서 새벽에 짧게 적용하고, 잡지 못하면(lock_timeout 3초) 전체가 취소된다. 새 트리거라 DROP TRIGGER IF EXISTS 를 쓰지 않는다.
-- 되돌리기: 코드를 먼저 되돌린 뒤 supabase/rollback/20261205100000_site_notice_popup_down.sql(새벽).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 0. 사전 점검: 10번(회원 탈퇴)·4번(가입 동의) DB 가 있어야 한다. -------------------------------------------------
DO $precheck_site_notice_popup$
BEGIN
  IF to_regclass('public.signup_consent_items') IS NULL
     OR to_regprocedure('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'member_withdrawal_policy') THEN
    RAISE EXCEPTION 'SITE_NOTICE_POPUP: bundle 4/10 objects missing';
  END IF;
END;
$precheck_site_notice_popup$;

-- 1. 내용 지문(4-2): 제목·링크·링크 이름에는 줄바꿈을 받지 않으므로 글자 경계가 섞이지 않는다. 노출 시작·끝·켜기는 넣지 않는다. ----------
CREATE FUNCTION public.site_notice_popup_content_sha256(p_title text, p_body text, p_link_url text, p_link_label text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_site_notice_popup_content_sha256$
  SELECT encode(sha256(convert_to(
    'site_notice_popup:v1' || E'\n' || p_title || E'\n' || coalesce(p_link_url, '') || E'\n' || coalesce(p_link_label, '') || E'\n' || p_body,
    'UTF8')), 'hex')
$fn_site_notice_popup_content_sha256$;
REVOKE ALL ON FUNCTION public.site_notice_popup_content_sha256(text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- 2. 팝업 설정 행(9절 초안, 꺼짐). 노출 끝 2027-01-12 00:00 KST(13절 1번 기본안). ---------------------------------------------
INSERT INTO public.system_settings (key, value, description, updated_at)
SELECT 'site_notice_popup',
       jsonb_build_object(
         'enabled', false,
         'title', d.title,
         'body', d.body,
         'linkUrl', d.link_url,
         'linkLabel', d.link_label,
         'startsAt', NULL,
         'endsAt', to_jsonb(timestamptz '2027-01-12 00:00:00+09'),
         'contentSha256', public.site_notice_popup_content_sha256(d.title, d.body, d.link_url, d.link_label),
         'revision', 1),
       '회원 화면 공지 팝업(제목·본문·링크·노출 기간·켜기). 대표만 관리자 화면(save_site_notice_popup)으로 고친다. 화면 세션으로 고칠 수 없다.',
       now()
  FROM (SELECT $t$정식 오픈 전 안내와 약관 변경 안내$t$ AS title,
               $b$써머썬연구소는 아직 정식 오픈 전이라 기능과 화면을 다듬고 있습니다. 약관을 바꿀 때는 이용약관 제3조에 따라 미리 알려 드리고, 회원님께 불리하거나 중요한 변경은 30일 전부터 알리며 다시 동의를 받습니다.

회원 탈퇴 절차와 탈퇴 뒤 기록 보관 기준을 정비하기 위해 2027년 1월 11일(월)부터 이용약관·취소/환불정책·개인정보처리방침이 바뀝니다.
- 결제 이력이 있는 계정은 탈퇴 화면에서 탈퇴를 요청하고, 회사가 확인한 뒤 요청일부터 10일 안에 처리합니다.
- 결제 이력이 없는 계정은 바로 탈퇴되지만, 최근 7일 안에 결제 시도가 있으면 7일이 지난 뒤 탈퇴할 수 있습니다. 진행 중인 결제·환불이 있으면 끝난 뒤 탈퇴할 수 있습니다.
- 탈퇴하면 남은 크레딧(유료 충전·자료 환불로 다시 받은 크레딧·무상)은 소멸하며 환불되지 않습니다. 다만 미성년자 결제 취소, 자료 하자 등 법령에 따른 환불은 탈퇴한 뒤에도 고객센터로 요청할 수 있습니다.
- 환불 기간이 남은 충전 건은 쓰지 않았으면 환불받거나 기간이 지난 뒤, 일부를 썼으면 기간이 지난 뒤 탈퇴할 수 있고, 환불 기간이 끝난 뒤 3일 동안도 탈퇴할 수 없습니다(마지막 날이 휴일이면 환불 기간이 늘어나 그동안 고객센터로 환불을 요청할 수 있습니다).
- 탈퇴하면 구매한 자료를 내려받을 수 없고, 받지 않은 자료의 환불은 탈퇴 전에 신청해야 합니다. 후기·추천은 삭제되고 답변을 기다리던 문의는 닫히며, 같은 계정으로 다시 가입해도 크레딧·구매 내역은 이어지지 않습니다.
- 탈퇴 뒤 보관하는 기록과 기간(결제 이력이 없어도 결제 시도 기록, 보존에 동의한 문의 등), 새로 받는 탈퇴 요청 기록을 개인정보처리방침에 적었습니다.
- 시행일 뒤 접속하면 바뀐 약관에 다시 동의하는 화면이 나오며, 동의 전에는 충전과 자료 구매를 할 수 없습니다.

시행일 전까지는 지금 약관이 그대로 적용되고, 충전하신 크레딧과 구매하신 자료도 지금처럼 이용하실 수 있습니다. 바뀐 약관에 동의하지 않으시면 시행일 전까지 탈퇴를 요청하실 수 있습니다. 결제 이력이 있거나 탈퇴 화면에서 접수되지 않으면 고객센터(이메일·전화)로 요청해 주세요.$b$ AS body,
               '/terms/upcoming'::text AS link_url,
               $l$바뀌는 부분 보기$l$ AS link_label) d
ON CONFLICT (key) DO NOTHING;

-- 3. 저장 함수(4-2): 대표만, 판(revision) 비교, 입력 검사, 지문 계산, 같은 거래 안에서 작업 기록. 바뀐 것이 없으면 저장·기록하지 않는다. --
CREATE FUNCTION public.save_site_notice_popup(
  p_actor_id uuid,
  p_expected_revision integer,
  p_enabled boolean,
  p_title text,
  p_body text,
  p_link_url text,
  p_link_label text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_save_site_notice_popup$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_title text;
  v_body text;
  v_link text;
  v_label text;
  v_old_rev integer;
  v_sha text;
  v_now timestamptz := now();
  v_saved_at timestamptz;
  v_visible_before boolean;
  v_visible_after boolean;
  v_audit uuid;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'NOTICE_POPUP_ACTOR_NOT_OWNER';
  END IF;
  -- ① 행위자(대표) ② 설정 행
  PERFORM 1 FROM public.profiles p
   WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.admin_role = 'owner'
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOTICE_POPUP_ACTOR_NOT_OWNER';
  END IF;

  SELECT s.value INTO v_old FROM public.system_settings s WHERE s.key = 'site_notice_popup' FOR UPDATE;
  IF NOT FOUND OR v_old IS NULL THEN
    RAISE EXCEPTION 'NOTICE_POPUP_NOT_FOUND';
  END IF;
  v_old_rev := (v_old ->> 'revision')::integer;
  IF p_expected_revision IS NULL OR v_old_rev IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'NOTICE_POPUP_REVISION_CONFLICT';
  END IF;

  -- 다듬기: CRLF → LF, 앞뒤 공백
  v_title := regexp_replace(replace(coalesce(p_title, ''), E'\r\n', E'\n'), '^\s+|\s+$', '', 'g');
  v_body := regexp_replace(replace(coalesce(p_body, ''), E'\r\n', E'\n'), '^\s+|\s+$', '', 'g');
  v_link := nullif(regexp_replace(replace(coalesce(p_link_url, ''), E'\r\n', E'\n'), '^\s+|\s+$', '', 'g'), '');
  v_label := nullif(regexp_replace(replace(coalesce(p_link_label, ''), E'\r\n', E'\n'), '^\s+|\s+$', '', 'g'), '');

  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'NOTICE_POPUP_INPUT_INVALID: enabled';
  END IF;
  IF char_length(v_title) NOT BETWEEN 1 AND 60 OR v_title ~ '[\r\n]' THEN
    RAISE EXCEPTION 'NOTICE_POPUP_INPUT_INVALID: title';
  END IF;
  IF char_length(v_body) NOT BETWEEN 1 AND 1200 THEN
    RAISE EXCEPTION 'NOTICE_POPUP_INPUT_INVALID: body';
  END IF;
  -- 링크는 사이트 안 주소만: '/' 로 시작, '//'·'/\' 로 시작하지 않음(밖 주소로 해석됨), 공백·제어문자 없음, 200자 이하
  -- (밖 주소·javascript: 는 '/' 로 시작하지 않아 걸림). 관리자 화면 검사 isAllowedNoticeLink 와 같은 규칙.
  IF v_link IS NOT NULL AND (left(v_link, 1) <> '/' OR left(v_link, 2) IN ('//', '/\')
                             OR v_link ~ '[[:space:][:cntrl:]]' OR char_length(v_link) > 200) THEN
    RAISE EXCEPTION 'NOTICE_POPUP_INPUT_INVALID: linkUrl';
  END IF;
  IF v_link IS NULL THEN
    v_label := NULL;
  ELSIF v_label IS NULL OR char_length(v_label) > 20 OR v_label ~ '[\r\n]' THEN
    RAISE EXCEPTION 'NOTICE_POPUP_INPUT_INVALID: linkLabel';
  END IF;
  IF p_starts_at IS NOT NULL AND p_ends_at IS NOT NULL AND p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'NOTICE_POPUP_INPUT_INVALID: endsAt';
  END IF;
  IF p_enabled AND (p_ends_at IS NULL OR p_ends_at <= v_now) THEN
    RAISE EXCEPTION 'NOTICE_POPUP_INPUT_INVALID: endsAt';
  END IF;

  -- 바뀐 것이 없으면 그대로 돌려준다(기록 없음).
  IF (v_old -> 'enabled') = to_jsonb(p_enabled)
     AND v_old ->> 'title' IS NOT DISTINCT FROM v_title
     AND v_old ->> 'body' IS NOT DISTINCT FROM v_body
     AND v_old ->> 'linkUrl' IS NOT DISTINCT FROM v_link
     AND v_old ->> 'linkLabel' IS NOT DISTINCT FROM v_label
     AND (v_old ->> 'startsAt')::timestamptz IS NOT DISTINCT FROM p_starts_at
     AND (v_old ->> 'endsAt')::timestamptz IS NOT DISTINCT FROM p_ends_at THEN
    RETURN jsonb_build_object('changed', false, 'value', v_old, 'auditId', NULL);
  END IF;

  v_sha := public.site_notice_popup_content_sha256(v_title, v_body, v_link, v_label);
  v_new := jsonb_build_object(
    'enabled', p_enabled,
    'title', v_title,
    'body', v_body,
    'linkUrl', v_link,
    'linkLabel', v_label,
    'startsAt', to_jsonb(p_starts_at),
    'endsAt', to_jsonb(p_ends_at),
    'contentSha256', v_sha,
    'revision', v_old_rev + 1);

  v_visible_before := (v_old -> 'enabled') = 'true'::jsonb
    AND ((v_old ->> 'startsAt') IS NULL OR (v_old ->> 'startsAt')::timestamptz <= v_now)
    AND (v_old ->> 'endsAt') IS NOT NULL AND v_now < (v_old ->> 'endsAt')::timestamptz;
  v_visible_after := p_enabled AND (p_starts_at IS NULL OR p_starts_at <= v_now) AND p_ends_at IS NOT NULL AND v_now < p_ends_at;

  UPDATE public.system_settings SET value = v_new, updated_at = v_now WHERE key = 'site_notice_popup';

  -- saved_at 은 clock_timestamp(): 한 거래 안의 여러 저장도 순서가 생긴다(4-3 끊김 판정).
  v_saved_at := clock_timestamp();
  v_audit := public.record_admin_audit(p_actor_id, 'site_notice_popup_save', 'system_settings', 'site_notice_popup', NULL, NULL, NULL,
    jsonb_build_object(
      'revision_before', v_old_rev,
      'revision_after', v_old_rev + 1,
      'before', v_old,
      'after', v_new,
      'content_sha256_before', v_old ->> 'contentSha256',
      'content_sha256_after', v_sha,
      'content_changed', (v_old ->> 'contentSha256') IS DISTINCT FROM v_sha,
      'visible_before', v_visible_before,
      'visible_after', v_visible_after,
      'exposure_starts_at', CASE WHEN p_enabled THEN to_jsonb(GREATEST(v_now, p_starts_at)) ELSE 'null'::jsonb END,
      'saved_at', to_jsonb(v_saved_at)),
    NULL);
  IF v_audit IS NULL THEN
    RAISE EXCEPTION 'NOTICE_POPUP_AUDIT_FAILED';
  END IF;

  RETURN jsonb_build_object('changed', true, 'value', v_new, 'auditId', v_audit);
END;
$fn_save_site_notice_popup$;
REVOKE ALL ON FUNCTION public.save_site_notice_popup(uuid, integer, boolean, text, text, text, text, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_site_notice_popup(uuid, integer, boolean, text, text, text, text, timestamptz, timestamptz)
  TO service_role;

-- 4. 좋은 기록 한 건(4-3 판정 3): 켜짐, 링크가 글자까지 '/terms/upcoming', 끝 ≥ 시행일 00:00 KST, 본문에 시행일 글자, 시작 없음 또는 ≤ 저장 시각.
--    관리자 카드 경고의 isNoticeRecordGood(src/lib/site-notice-popup.ts)과 같은 규칙이다(같은 예시 묶음으로 시험).
CREATE FUNCTION public.policy_upcoming_notice_record_good(p_after jsonb, p_saved_at timestamptz, p_effective_date date, p_effective_date_label text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_policy_upcoming_notice_record_good$
  SELECT coalesce(
    (p_after -> 'enabled') = 'true'::jsonb
    AND (p_after ->> 'linkUrl') = '/terms/upcoming'
    AND (p_after ->> 'endsAt') IS NOT NULL
    AND (p_after ->> 'endsAt')::timestamptz >= (p_effective_date::timestamp AT TIME ZONE 'Asia/Seoul')
    AND p_effective_date_label IS NOT NULL AND p_effective_date_label <> ''
    AND position(p_effective_date_label IN coalesce(p_after ->> 'body', '')) > 0
    AND ((p_after ->> 'startsAt') IS NULL OR (p_after ->> 'startsAt')::timestamptz <= p_saved_at),
    false)
$fn_policy_upcoming_notice_record_good$;
REVOKE ALL ON FUNCTION public.policy_upcoming_notice_record_good(jsonb, timestamptz, date, text) FROM PUBLIC, anon, authenticated, service_role;

-- 5. 고지 끊김 판정(4-2·4-3): 시행 스크립트·런북 조회(notice_continuity_check)·관리자 카드가 이 함수만 부른다. 읽기만 한다.
--    시행일·고지 마감일은 게시 행의 effectiveDate·noticeDeadline 을 읽는다. 인자를 받으면 행 값과 같은지만 대조한다(ARG_MISMATCH).
CREATE FUNCTION public.policy_upcoming_notice_continuity(p_effective_date date DEFAULT NULL, p_notice_deadline date DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_policy_upcoming_notice_continuity$
DECLARE
  v_row jsonb;
  v_effective date;
  v_deadline date;
  v_label text;
  v_published timestamptz;
  v_rec record;
  v_n integer := 0;
  v_last_id uuid;
  v_last_rev integer;
  v_s_id uuid;
  v_s_saved timestamptz;
  v_s_start timestamptz;
  v_popup jsonb;
BEGIN
  SELECT s.value INTO v_row FROM public.system_settings s WHERE s.key = 'policy_upcoming_documents';
  IF v_row IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_PUBLICATION', 's_id', NULL, 'last_id', NULL, 's_saved_at', NULL);
  END IF;
  v_effective := (v_row ->> 'effectiveDate')::date;
  v_deadline := (v_row ->> 'noticeDeadline')::date;
  v_label := v_row ->> 'effectiveDateLabel';
  IF (p_effective_date IS NOT NULL AND p_effective_date IS DISTINCT FROM v_effective)
     OR (p_notice_deadline IS NOT NULL AND p_notice_deadline IS DISTINCT FROM v_deadline) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ARG_MISMATCH', 's_id', NULL, 'last_id', NULL, 's_saved_at', NULL);
  END IF;
  -- 1) 게시 행 upcoming, 게시일(한국 날짜) ≤ 고지 마감일
  IF (v_row ->> 'status') IS DISTINCT FROM 'upcoming' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_UPCOMING', 's_id', NULL, 'last_id', NULL, 's_saved_at', NULL);
  END IF;
  v_published := (v_row ->> 'publishedAt')::timestamptz;
  IF v_published IS NULL OR v_effective IS NULL OR v_deadline IS NULL
     OR (v_published AT TIME ZONE 'Asia/Seoul')::date > v_deadline THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'PUBLISHED_AFTER_DEADLINE', 's_id', NULL, 'last_id', NULL, 's_saved_at', NULL);
  END IF;

  -- 2)~4) 게시 뒤 팝업 저장 기록을 (saved_at, id) 순으로 세우고, 마지막 기록부터 거꾸로 좋은 기록이 이어지는 가장 앞 기록 S 를 찾는다.
  FOR v_rec IN
    SELECT a.id, a.details, (a.details ->> 'saved_at')::timestamptz AS saved_at
      FROM public.admin_audit_log a
     WHERE a.action = 'site_notice_popup_save'
       AND (a.details ->> 'saved_at')::timestamptz > v_published
     ORDER BY (a.details ->> 'saved_at')::timestamptz DESC, a.id DESC
  LOOP
    v_n := v_n + 1;
    IF v_n = 1 THEN
      v_last_id := v_rec.id;
      v_last_rev := (v_rec.details ->> 'revision_after')::integer;
    END IF;
    IF public.policy_upcoming_notice_record_good(v_rec.details -> 'after', v_rec.saved_at, v_effective, v_label) THEN
      v_s_id := v_rec.id;
      v_s_saved := v_rec.saved_at;
      v_s_start := v_rec.saved_at;
    ELSE
      -- S 기록에서는 미래 시작도 받는다: 시작만 빼면 좋은 기록이고 시작이 저장 시각 뒤면 그 기록이 S 다.
      -- 다만 그 기록이 마지막 기록이거나, 시작이 바로 뒤(이미 찾은) 좋은 기록의 저장 시각 이하일 때만이다.
      -- 그렇지 않으면 바로 뒤 좋은 기록이 이미 보이기 시작한 때이므로 앞서 잡은 S 를 그대로 둔다(거짓 멈춤 방지).
      IF (v_rec.details #>> '{after,startsAt}') IS NOT NULL
         AND (v_rec.details #>> '{after,startsAt}')::timestamptz > v_rec.saved_at
         AND (v_s_id IS NULL OR (v_rec.details #>> '{after,startsAt}')::timestamptz <= v_s_saved)
         AND public.policy_upcoming_notice_record_good((v_rec.details -> 'after') - 'startsAt', v_rec.saved_at, v_effective, v_label) THEN
        v_s_id := v_rec.id;
        v_s_saved := v_rec.saved_at;
        v_s_start := (v_rec.details #>> '{after,startsAt}')::timestamptz;
      END IF;
      EXIT;
    END IF;
  END LOOP;

  IF v_n = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_RECORDS', 's_id', NULL, 'last_id', NULL, 's_saved_at', NULL);
  END IF;
  IF v_s_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'LAST_NOT_GOOD', 's_id', NULL, 'last_id', v_last_id, 's_saved_at', NULL);
  END IF;
  -- 5) GREATEST(S.saved_at, S.after.startsAt)(한국 날짜) ≤ 고지 마감일
  IF (GREATEST(v_s_saved, v_s_start) AT TIME ZONE 'Asia/Seoul')::date > v_deadline THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'START_AFTER_DEADLINE', 's_id', v_s_id, 'last_id', v_last_id, 's_saved_at', to_jsonb(v_s_saved));
  END IF;
  -- 6) 지금 팝업 행의 revision = 마지막 기록의 revision_after(기록 밖에서 바뀌지 않았음)
  SELECT s.value INTO v_popup FROM public.system_settings s WHERE s.key = 'site_notice_popup';
  IF v_popup IS NULL OR (v_popup ->> 'revision')::integer IS DISTINCT FROM v_last_rev THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'REVISION_MISMATCH', 's_id', v_s_id, 'last_id', v_last_id, 's_saved_at', to_jsonb(v_s_saved));
  END IF;
  RETURN jsonb_build_object('ok', true, 'reason', NULL, 's_id', v_s_id, 'last_id', v_last_id, 's_saved_at', to_jsonb(v_s_saved));
END;
$fn_policy_upcoming_notice_continuity$;
REVOKE ALL ON FUNCTION public.policy_upcoming_notice_continuity(date, date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.policy_upcoming_notice_continuity(date, date) TO service_role;

-- 6. 고지 기간 잠금 트리거(4-4). 게시 행이 'upcoming' 일 때만 막는다. 행이 없거나 다른 상태면 그대로 둔다. ------------------------------
-- 6-1. 약관 문서: 게시 행 documents[].key 에 든 문서의 content·slug·title·enabled 가 바뀌면 막는다(다른 칸은 그대로 저장됨).
CREATE FUNCTION public.lock_policy_documents_during_notice_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_lock_policy_documents_during_notice$
DECLARE
  v_pub jsonb;
  v_key text;
  v_field text;
BEGIN
  SELECT s.value INTO v_pub FROM public.system_settings s WHERE s.key = 'policy_upcoming_documents';
  IF v_pub IS NULL OR (v_pub ->> 'status') IS DISTINCT FROM 'upcoming' THEN
    RETURN NEW;
  END IF;
  FOR v_key IN SELECT d ->> 'key' FROM jsonb_array_elements(coalesce(v_pub -> 'documents', '[]'::jsonb)) d LOOP
    FOREACH v_field IN ARRAY ARRAY['content', 'slug', 'title', 'enabled'] LOOP
      IF (NEW.value #> ARRAY['policyDocuments', v_key, v_field]) IS DISTINCT FROM (OLD.value #> ARRAY['policyDocuments', v_key, v_field]) THEN
        RAISE EXCEPTION 'POLICY_UPCOMING_LOCKED: policy document % % is locked during notice', v_key, v_field;
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$fn_lock_policy_documents_during_notice$;
REVOKE ALL ON FUNCTION public.lock_policy_documents_during_notice_fn() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER lock_policy_documents_during_notice
  BEFORE UPDATE ON public.system_settings
  FOR EACH ROW WHEN (NEW.key = 'site_footer_content')
  EXECUTE FUNCTION public.lock_policy_documents_during_notice_fn();

-- 6-2. 가입 동의 항목: 게시 행 consentItems 의 key 행에서 content·label·version·required·is_active·policy_slug 가 바뀌면 막는다.
CREATE FUNCTION public.lock_consent_items_during_notice_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_lock_consent_items_during_notice$
DECLARE
  v_pub jsonb;
BEGIN
  SELECT s.value INTO v_pub FROM public.system_settings s WHERE s.key = 'policy_upcoming_documents';
  IF v_pub IS NULL OR (v_pub ->> 'status') IS DISTINCT FROM 'upcoming' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_pub -> 'consentItems', '[]'::jsonb)) c
              WHERE c ->> 'key' IN (OLD.key, NEW.key))
     AND (NEW.content IS DISTINCT FROM OLD.content OR NEW.label IS DISTINCT FROM OLD.label OR NEW.version IS DISTINCT FROM OLD.version
          OR NEW.required IS DISTINCT FROM OLD.required OR NEW.is_active IS DISTINCT FROM OLD.is_active
          OR NEW.policy_slug IS DISTINCT FROM OLD.policy_slug OR NEW.key IS DISTINCT FROM OLD.key) THEN
    RAISE EXCEPTION 'POLICY_UPCOMING_LOCKED: consent item % is locked during notice', OLD.key;
  END IF;
  RETURN NEW;
END;
$fn_lock_consent_items_during_notice$;
REVOKE ALL ON FUNCTION public.lock_consent_items_during_notice_fn() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER lock_consent_items_during_notice
  BEFORE UPDATE ON public.signup_consent_items
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_consent_items_during_notice_fn();

-- 6-3. 탈퇴 정책 문구: 게시 행 lockedWithdrawalPaths 의 경로가 바뀌거나, selfAnonymizeEnabled 를 켜면 막는다.
--      blockReasons.DISABLED(4-6 작은 스크립트)와 목록에 없는 다른 값은 막지 않는다.
CREATE FUNCTION public.lock_withdrawal_texts_during_notice_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_lock_withdrawal_texts_during_notice$
DECLARE
  v_pub jsonb;
  v_path text;
BEGIN
  SELECT s.value INTO v_pub FROM public.system_settings s WHERE s.key = 'policy_upcoming_documents';
  IF v_pub IS NULL OR (v_pub ->> 'status') IS DISTINCT FROM 'upcoming' THEN
    RETURN NEW;
  END IF;
  IF (NEW.value -> 'selfAnonymizeEnabled') = 'true'::jsonb AND (OLD.value -> 'selfAnonymizeEnabled') IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'POLICY_UPCOMING_LOCKED: selfAnonymizeEnabled cannot be turned on during notice';
  END IF;
  FOR v_path IN SELECT p FROM jsonb_array_elements_text(coalesce(v_pub -> 'lockedWithdrawalPaths', '[]'::jsonb)) p LOOP
    IF (NEW.value #> v_path::text[]) IS DISTINCT FROM (OLD.value #> v_path::text[]) THEN
      RAISE EXCEPTION 'POLICY_UPCOMING_LOCKED: member_withdrawal_policy % is locked during notice', v_path;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$fn_lock_withdrawal_texts_during_notice$;
REVOKE ALL ON FUNCTION public.lock_withdrawal_texts_during_notice_fn() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER lock_withdrawal_texts_during_notice
  BEFORE UPDATE ON public.system_settings
  FOR EACH ROW WHEN (NEW.key = 'member_withdrawal_policy')
  EXECUTE FUNCTION public.lock_withdrawal_texts_during_notice_fn();

-- 7. 쓰기 막기 정책(4-4): 화면 세션(대표 포함)이 두 키를 직접 고치지 못한다. ------------------------------------------------------
CREATE POLICY system_settings_site_notice_popup_no_client_write
  ON public.system_settings
  AS RESTRICTIVE
  FOR UPDATE
  USING (key <> 'site_notice_popup')
  WITH CHECK (key <> 'site_notice_popup');

-- 게시 행 정책은 되돌리기가 남기므로 없을 때만 만든다(DROP 없이).
DO $create_policy_upcoming_documents_policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'system_settings'
                    AND policyname = 'system_settings_policy_upcoming_documents_no_client_write') THEN
    CREATE POLICY system_settings_policy_upcoming_documents_no_client_write
      ON public.system_settings
      AS RESTRICTIVE
      FOR UPDATE
      USING (key <> 'policy_upcoming_documents')
      WITH CHECK (key <> 'policy_upcoming_documents');
  END IF;
END;
$create_policy_upcoming_documents_policy$;

-- 8. VERIFY ------------------------------------------------------------------------------------------------------
DO $verify_site_notice_popup$
DECLARE
  v_row jsonb;
  v_fn text;
BEGIN
  SELECT value INTO v_row FROM public.system_settings WHERE key = 'site_notice_popup';
  IF v_row IS NULL OR (v_row -> 'enabled') IS DISTINCT FROM 'false'::jsonb OR (v_row ->> 'revision') IS NULL
     OR (v_row ->> 'contentSha256') !~ '^[0-9a-f]{64}$'
     OR (v_row ->> 'contentSha256') IS DISTINCT FROM public.site_notice_popup_content_sha256(v_row ->> 'title', v_row ->> 'body', v_row ->> 'linkUrl', v_row ->> 'linkLabel') THEN
    RAISE EXCEPTION 'VERIFY: site_notice_popup row';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.site_notice_popup_content_sha256(text,text,text,text)'::regprocedure) <> 's' THEN
    RAISE EXCEPTION 'VERIFY: content sha256 function must be STABLE';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY['public.save_site_notice_popup(uuid,integer,boolean,text,text,text,text,timestamp with time zone,timestamp with time zone)',
                              'public.policy_upcoming_notice_continuity(date,date)'] LOOP
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'VERIFY: % EXECUTE must be service_role only', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY['public.site_notice_popup_content_sha256(text,text,text,text)',
                              'public.policy_upcoming_notice_record_good(jsonb,timestamp with time zone,date,text)',
                              'public.lock_policy_documents_during_notice_fn()', 'public.lock_consent_items_during_notice_fn()',
                              'public.lock_withdrawal_texts_during_notice_fn()'] LOOP
    IF has_function_privilege('service_role', v_fn, 'EXECUTE') OR has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'VERIFY: % must not be executable by API roles', v_fn;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_trigger t
       WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
         AND ((t.tgrelid = 'public.system_settings'::regclass AND t.tgname IN ('lock_policy_documents_during_notice', 'lock_withdrawal_texts_during_notice'))
           OR (t.tgrelid = 'public.signup_consent_items'::regclass AND t.tgname = 'lock_consent_items_during_notice'))) <> 3 THEN
    RAISE EXCEPTION 'VERIFY: notice lock triggers';
  END IF;
  -- 게시 행이 없으면 판정은 NO_PUBLICATION 이다(적용 직후).
  IF NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'policy_upcoming_documents')
     AND (public.policy_upcoming_notice_continuity() ->> 'reason') IS DISTINCT FROM 'NO_PUBLICATION' THEN
    RAISE EXCEPTION 'VERIFY: continuity without publication';
  END IF;
END;
$verify_site_notice_popup$;

-- 정책 검사는 이름 붙인 별도 블록이다(리허설의 '정책 뺀 사본'은 CREATE POLICY 2개와 이 블록을 뺀다 — 계획 4절 머리).
DO $verify_site_notice_popup_policies$
BEGIN
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'system_settings' AND permissive = 'RESTRICTIVE' AND cmd = 'UPDATE'
         AND ((policyname = 'system_settings_site_notice_popup_no_client_write'
               AND qual = '(key <> ''site_notice_popup''::text)' AND with_check = '(key <> ''site_notice_popup''::text)')
           OR (policyname = 'system_settings_policy_upcoming_documents_no_client_write'
               AND qual = '(key <> ''policy_upcoming_documents''::text)' AND with_check = '(key <> ''policy_upcoming_documents''::text)'))) <> 2 THEN
    RAISE EXCEPTION 'VERIFY: site_notice_popup / policy_upcoming_documents RESTRICTIVE policies';
  END IF;
END;
$verify_site_notice_popup_policies$;

NOTIFY pgrst, 'reload schema';


CREATE FUNCTION pg_temp.popup() RETURNS jsonb LANGUAGE sql AS $f$
  SELECT value FROM public.system_settings WHERE key = 'site_notice_popup'
$f$;
CREATE FUNCTION pg_temp.try_save(p_actor uuid, p_enabled boolean, p_title text, p_body text, p_link text, p_label text,
  p_starts timestamptz, p_ends timestamptz, p_rev integer DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  RETURN 'OK ' || public.save_site_notice_popup(p_actor, coalesce(p_rev, (pg_temp.popup() ->> 'revision')::integer), p_enabled,
    p_title, p_body, p_link, p_label, p_starts, p_ends)::text;
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR ' || left(SQLERRM, 300);
END $f$;
CREATE FUNCTION pg_temp.res(p_result text) RETURNS jsonb LANGUAGE sql AS $f$ SELECT substr(p_result, 4)::jsonb $f$;
-- 고지 끊김 판정용 가짜 저장 기록(시각을 정해 남김 — 작업 기록 표는 추가 전용이라 이 거래가 되돌려질 때 함께 사라진다)
CREATE FUNCTION pg_temp.fake_save(p_after jsonb, p_saved_at timestamptz, p_rev_after integer) RETURNS uuid LANGUAGE sql AS $f$
  SELECT public.record_admin_audit(pg_temp.owner_id(), 'site_notice_popup_save', 'system_settings', 'site_notice_popup', NULL, NULL,
    'RH15 가짜 기록', jsonb_build_object('after', p_after, 'saved_at', to_jsonb(p_saved_at), 'revision_after', p_rev_after,
                                         'revision_before', p_rev_after - 1), NULL)
$f$;
-- 게시 행을 정한 값으로 둔다(고지 끊김 판정 경우용 가짜 게시 행)
CREATE FUNCTION pg_temp.fake_publication(p_published timestamptz, p_status text DEFAULT 'upcoming') RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.system_settings (key, value, description, updated_at)
  VALUES ('policy_upcoming_documents', jsonb_build_object('status', p_status, 'effectiveDate', '2027-01-11', 'effectiveDateLabel', '2027년 1월 11일',
            'noticeDeadline', '2026-12-10', 'publishedAt', to_jsonb(p_published), 'documents', '[]'::jsonb, 'consentItems', '[]'::jsonb), 'RH15', now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
$f$;
CREATE FUNCTION pg_temp.set_popup_revision(p_rev integer) RETURNS void LANGUAGE sql AS $f$
  UPDATE public.system_settings SET value = jsonb_set(value, '{revision}', to_jsonb(p_rev)) WHERE key = 'site_notice_popup'
$f$;
CREATE FUNCTION pg_temp.continuity_reason(p_eff date DEFAULT NULL, p_deadline date DEFAULT NULL) RETURNS text LANGUAGE sql AS $f$
  SELECT coalesce(r ->> 'reason', CASE WHEN (r -> 'ok') = 'true'::jsonb THEN 'OK' END)
    FROM (SELECT public.policy_upcoming_notice_continuity(p_eff, p_deadline) AS r) x
$f$;

-- R1 결과 확인(마이그레이션 VERIFY 두 블록이 이미 통과함)
DO $rh_r1$
BEGIN
  PERFORM pg_temp.log('R1', pg_temp.ensure((SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings'
    AND policyname IN ('system_settings_site_notice_popup_no_client_write', 'system_settings_policy_upcoming_documents_no_client_write')) = 2, 'R1', '정책 2개'));
  PERFORM pg_temp.log('R1', pg_temp.ensure((SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
    AND tgname IN ('lock_policy_documents_during_notice', 'lock_withdrawal_texts_during_notice', 'lock_consent_items_during_notice')) = 3, 'R1', '트리거 3개'));
  PERFORM pg_temp.log('R1', pg_temp.ensure((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
    AND p.proname IN ('save_site_notice_popup', 'site_notice_popup_content_sha256', 'policy_upcoming_notice_continuity', 'policy_upcoming_notice_record_good',
                      'lock_policy_documents_during_notice_fn', 'lock_withdrawal_texts_during_notice_fn', 'lock_consent_items_during_notice_fn')) = 7,
    'R1', '함수 7개(팝업 2·판정 2·트리거 3)'));
  PERFORM pg_temp.log('R1', pg_temp.ensure((SELECT value -> 'enabled' FROM public.system_settings WHERE key = 'site_notice_popup') = 'false'::jsonb, 'R1', '팝업 행 꺼짐'));
END
$rh_r1$;

DO $rh_r3_locks$
DECLARE
  v_log text[] := '{}';
  v_r text;
BEGIN
  BEGIN

    DECLARE
      v_owner uuid := pg_temp.owner_id();
      v_n integer;
      v_item public.signup_consent_items%ROWTYPE;
    BEGIN
      -- 게시 행(사본으로 게시) → 두 키가 모두 있는 상태
      v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.pt_sql('publish_upcoming', pg_temp.kst_today() + 40, pg_temp.kst_today() + 3, pg_temp.kst_today() + 40)),
        'OK', 'R3', '게시');
      -- authenticated(대표 세션)로 두 키 UPDATE → 0행, postgres 로는 1행
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      UPDATE public.system_settings SET updated_at = updated_at WHERE key = 'site_notice_popup';
      GET DIAGNOSTICS v_n = ROW_COUNT;
      RESET ROLE;
      v_log := v_log || pg_temp.ensure(v_n = 0, 'R3', 'authenticated → site_notice_popup UPDATE 0행');
      SET LOCAL ROLE authenticated;
      UPDATE public.system_settings SET updated_at = updated_at WHERE key = 'policy_upcoming_documents';
      GET DIAGNOSTICS v_n = ROW_COUNT;
      RESET ROLE;
      v_log := v_log || pg_temp.ensure(v_n = 0, 'R3', 'authenticated → policy_upcoming_documents UPDATE 0행');
      SET LOCAL ROLE authenticated;
      UPDATE public.system_settings SET updated_at = updated_at WHERE key = 'site_brand';
      GET DIAGNOSTICS v_n = ROW_COUNT;
      RESET ROLE;
      v_log := v_log || pg_temp.ensure(v_n = 1, 'R3', '대조: authenticated(대표) → site_brand UPDATE 1행');
      UPDATE public.system_settings SET updated_at = updated_at WHERE key IN ('site_notice_popup', 'policy_upcoming_documents');
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_log := v_log || pg_temp.ensure(v_n = 2, 'R3', 'postgres → 두 키 UPDATE 2행');
      -- 약관 문서: 게시 행의 문서 content·slug·title·enabled → 막힘, 다른 칸 → 통과
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{policyDocuments,refundPolicy,content}', to_jsonb((value #>> '{policyDocuments,refundPolicy,content}') || ' ')) WHERE key = 'site_footer_content'$s$),
        'ERR POLICY_UPCOMING_LOCKED', 'R3', '환불정책 본문 → 막힘');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{policyDocuments,privacyPolicy,slug}', '"privacy2"') WHERE key = 'site_footer_content'$s$),
        'ERR POLICY_UPCOMING_LOCKED', 'R3', '처리방침 slug → 막힘');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{policyDocuments,serviceTerms,title}', '"이용약관2"') WHERE key = 'site_footer_content'$s$),
        'ERR POLICY_UPCOMING_LOCKED', 'R3', '이용약관 title → 막힘');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{policyDocuments,serviceTerms,enabled}', 'false') WHERE key = 'site_footer_content'$s$),
        'ERR POLICY_UPCOMING_LOCKED', 'R3', '이용약관 enabled → 막힘');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{extraNotices}', '["RH"]') WHERE key = 'site_footer_content'$s$),
        'OK', 'R3', '추가 안내 문구 → 통과');
      -- 가입 동의 항목: terms 본문(저장 함수) → 막힘, age14 정렬 → 통과
      SELECT * INTO v_item FROM public.signup_consent_items WHERE key = 'terms';
      v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('SELECT public.save_signup_consent_item(%L, %L, %s, %L, %L, %L, %L, %s, %L, %L, %L, false)',
          v_owner, v_item.id, v_item.version, v_item.label, v_item.content || ' RH', v_item.required, v_item.policy_slug, v_item.sort_order, v_item.is_active, 'RH', v_item.updated_at)),
        'ERR POLICY_UPCOMING_LOCKED', 'R3', '동의 항목 terms 본문 저장 → 막힘');
      SELECT * INTO v_item FROM public.signup_consent_items WHERE key = 'age14';
      v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('SELECT public.save_signup_consent_item(%L, %L, %s, %L, %L, %L, %L, %s, %L, %L, %L, false)',
          v_owner, v_item.id, v_item.version, v_item.label, v_item.content, v_item.required, v_item.policy_slug, v_item.sort_order + 1, v_item.is_active, NULL, v_item.updated_at)),
        'OK', 'R3', '동의 항목 age14 정렬 → 통과');
      -- 탈퇴 정책: 잠금 경로(숫자 키·문구·termsVersion)·스위치 켜기 → 막힘, DISABLED·목록 밖 → 통과
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{paymentRetentionYears}', '6') WHERE key = 'member_withdrawal_policy'$s$),
        'ERR POLICY_UPCOMING_LOCKED', 'R3', '숫자 키 paymentRetentionYears → 막힘');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{texts,blockReasons,REFUND_PERIOD_OPEN}', '"x"') WHERE key = 'member_withdrawal_policy'$s$),
        'ERR POLICY_UPCOMING_LOCKED', 'R3', 'w_paths 문구 → 막힘');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{texts,notice,termsVersion}', '"x"') WHERE key = 'member_withdrawal_policy'$s$),
        'ERR POLICY_UPCOMING_LOCKED', 'R3', 'texts.notice.termsVersion → 막힘');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{selfAnonymizeEnabled}', 'true') WHERE key = 'member_withdrawal_policy'$s$),
        'ERR POLICY_UPCOMING_LOCKED', 'R3', '스위치 켜기 → 막힘');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{texts,blockReasons,DISABLED}', '"RH"') WHERE key = 'member_withdrawal_policy'$s$),
        'OK', 'R3', 'DISABLED → 통과');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{redactionAccountRequestKeywords}', value -> 'redactionAccountRequestKeywords') WHERE key = 'member_withdrawal_policy'$s$),
        'OK', 'R3', '목록 밖 키 → 통과');
      -- 시행 순서: applied 먼저 → 저장 성공
      UPDATE public.system_settings SET value = jsonb_set(value, '{status}', '"applied"') WHERE key = 'policy_upcoming_documents';
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{policyDocuments,refundPolicy,content}', to_jsonb((value #>> '{policyDocuments,refundPolicy,content}') || ' ')) WHERE key = 'site_footer_content'$s$),
        'OK', 'R3', 'applied 먼저 → 본문 저장 성공');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{selfAnonymizeEnabled}', 'true') WHERE key = 'member_withdrawal_policy'$s$),
        'OK', 'R3', 'applied 뒤 스위치 켜기 → 통과');
    END;
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R3', m FROM unnest(v_log) m;
END
$rh_r3_locks$;

-- R5-2 (앞): 팝업이 켜진 채 down → 사전 점검에서 멈춤(바뀌는 것 없음)

DO $rh_r52_enabled_stop$
DECLARE
  v_log text[] := '{}';
  v_r text;
BEGIN
  BEGIN

    BEGIN
      UPDATE public.system_settings SET value = jsonb_set(value, '{enabled}', 'true') WHERE key = 'site_notice_popup';
      v_r := pg_temp.try_sql($rh_down_precheck$DO $down_site_notice_popup_precheck$
BEGIN
  IF (SELECT value -> 'enabled' FROM public.system_settings WHERE key = 'site_notice_popup') = 'true'::jsonb THEN
    RAISE EXCEPTION 'DOWN: site_notice_popup is enabled — turn popup off first (admin card) before rollback';
  END IF;
END;
$down_site_notice_popup_precheck$;$rh_down_precheck$);
      v_log := v_log || pg_temp.expect(v_r, 'ERR DOWN: site_notice_popup is enabled — turn popup off first', 'R5-2', '켜진 채 down → 멈춤');
      UPDATE public.system_settings SET value = jsonb_set(value, '{enabled}', 'false') WHERE key = 'site_notice_popup';
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($rh_down_precheck2$DO $down_site_notice_popup_precheck$
BEGIN
  IF (SELECT value -> 'enabled' FROM public.system_settings WHERE key = 'site_notice_popup') = 'true'::jsonb THEN
    RAISE EXCEPTION 'DOWN: site_notice_popup is enabled — turn popup off first (admin card) before rollback';
  END IF;
END;
$down_site_notice_popup_precheck$;$rh_down_precheck2$), 'OK', 'R5-2', '꺼진 상태 → 사전 점검 통과');
    END;
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R5-2', m FROM unnest(v_log) m;
END
$rh_r52_enabled_stop$;

-- R5-2: 4-5 되돌리기(down) → 지울 것 0건, policy_upcoming_documents 정책은 남음 → 다시 적용(그 정책은 1개)
-- 되돌리기: 20261205100000_site_notice_popup.sql(15번 공지 팝업, 계획 docs/plan-bundle15-notice-popup.md 4-5).
-- 순서: 코드를 15번 이전으로 되돌려 배포한 뒤에만 이 파일을 실행한다.
--   고지 기간(게시 행 'upcoming')에 되돌리면 고지가 끊긴 것으로 본다. 되돌리기 전에 관리자 카드에서 팝업을 끄고 저장한다(10절 되돌리기).
-- 새벽에 실행한다: DROP TRIGGER·DROP POLICY 는 system_settings·signup_consent_items 에 ACCESS EXCLUSIVE(읽기도 막음)를 잡는다.
--   lock_timeout 3초 안에 잡지 못하면 전체가 취소된다.
-- 지우는 순서: 잠금 트리거 3개 → 트리거 함수 3개 → 팝업 함수 2개·판정 함수(좋은 기록 판정 포함) → site_notice_popup 정책 → site_notice_popup 행.
-- 남기는 것: policy_upcoming_documents 행(고지 증빙)과 그 쓰기 막기 정책(…_policy_upcoming_documents_no_client_write) — 짝으로 둔다.
--   작업 기록(admin_audit_log)은 추가 전용이라 남는다.
-- 다시 적용하려면 같은 트랜잭션에서 schema_migrations 의 '20261205100000' 행을 지운 뒤 마이그레이션과 이력 INSERT 를 넣는다
--   (policy_upcoming_documents 정책은 없을 때만 만들므로 다시 적용해도 멈추지 않는다).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- 사전 점검: 팝업이 켜져 있으면 멈춘다(먼저 관리자 카드에서 끄고 저장해 끈 기록을 남긴다 — 10절 되돌리기).
DO $down_site_notice_popup_precheck$
BEGIN
  IF (SELECT value -> 'enabled' FROM public.system_settings WHERE key = 'site_notice_popup') = 'true'::jsonb THEN
    RAISE EXCEPTION 'DOWN: site_notice_popup is enabled — turn popup off first (admin card) before rollback';
  END IF;
END;
$down_site_notice_popup_precheck$;

DROP TRIGGER lock_policy_documents_during_notice ON public.system_settings;
DROP TRIGGER lock_withdrawal_texts_during_notice ON public.system_settings;
DROP TRIGGER lock_consent_items_during_notice ON public.signup_consent_items;

DROP FUNCTION public.lock_policy_documents_during_notice_fn();
DROP FUNCTION public.lock_withdrawal_texts_during_notice_fn();
DROP FUNCTION public.lock_consent_items_during_notice_fn();

DROP FUNCTION public.save_site_notice_popup(uuid, integer, boolean, text, text, text, text, timestamptz, timestamptz);
DROP FUNCTION public.site_notice_popup_content_sha256(text, text, text, text);
DROP FUNCTION public.policy_upcoming_notice_continuity(date, date);
DROP FUNCTION public.policy_upcoming_notice_record_good(jsonb, timestamptz, date, text);

DROP POLICY system_settings_site_notice_popup_no_client_write ON public.system_settings;

DELETE FROM public.system_settings WHERE key = 'site_notice_popup';

DO $down_site_notice_popup_verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
              AND tgname IN ('lock_policy_documents_during_notice', 'lock_withdrawal_texts_during_notice', 'lock_consent_items_during_notice')) THEN
    RAISE EXCEPTION 'DOWN VERIFY: lock triggers remain';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND p.proname IN ('lock_policy_documents_during_notice_fn', 'lock_withdrawal_texts_during_notice_fn', 'lock_consent_items_during_notice_fn',
                                  'save_site_notice_popup', 'site_notice_popup_content_sha256', 'policy_upcoming_notice_continuity',
                                  'policy_upcoming_notice_record_good')) THEN
    RAISE EXCEPTION 'DOWN VERIFY: functions remain';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings'
              AND policyname = 'system_settings_site_notice_popup_no_client_write') THEN
    RAISE EXCEPTION 'DOWN VERIFY: site_notice_popup policy remains';
  END IF;
  IF EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'site_notice_popup') THEN
    RAISE EXCEPTION 'DOWN VERIFY: site_notice_popup row remains';
  END IF;
  -- 게시 행 정책은 남는다(행이 있든 없든 짝으로 둔다).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings'
                  AND policyname = 'system_settings_policy_upcoming_documents_no_client_write') THEN
    RAISE EXCEPTION 'DOWN VERIFY: policy_upcoming_documents policy must stay';
  END IF;
END;
$down_site_notice_popup_verify$;

NOTIFY pgrst, 'reload schema';

DO $rh_r52_after_down$
BEGIN
  PERFORM pg_temp.log('R5-2', 'down 통과(down VERIFY: 트리거·함수·정책·행 0건, policy_upcoming_documents 정책 남음)');
END
$rh_r52_after_down$;
-- 출시 전 작업 순서표 15번 묶음(먼저 할 부분): 공지 팝업과 약관 변경 30일 전 고지(계획 docs/plan-bundle15-notice-popup.md 6판 4절).
-- 만드는 것:
--   1. system_settings 'site_notice_popup'(공지 팝업 문구·노출 기간·켜기, 처음엔 꺼짐). 9절 초안을 ON CONFLICT DO NOTHING 으로 넣는다.
--   2. 함수: site_notice_popup_content_sha256(내용 지문, STABLE), save_site_notice_popup(대표만, 작업 기록 함께, service_role),
--      policy_upcoming_notice_record_good(좋은 기록 한 건 판정, 내부용), policy_upcoming_notice_continuity(고지 끊김 판정, service_role).
--   3. RESTRICTIVE FOR UPDATE 정책 2개(site_notice_popup·policy_upcoming_documents — 화면 세션 직접 쓰기 차단).
--      policy_upcoming_documents 정책은 되돌리기(down)가 일부러 남기므로 pg_policies 에 없을 때만 만든다(다시 적용해도 멈추지 않게).
--   4. 고지 기간 잠금 트리거 3개(게시 행 policy_upcoming_documents 가 'upcoming' 일 때만 막음, 오류 POLICY_UPCOMING_LOCKED):
--      약관 문서(site_footer_content), 가입 동의 항목(signup_consent_items), 탈퇴 정책 문구(member_withdrawal_policy).
--      막을 문서 key·동의 항목 key·탈퇴 정책 경로는 게시 행에서 읽는다(트리거 안에 상수로 두지 않음).
-- 게시 행(policy_upcoming_documents)은 이 마이그레이션이 만들지 않는다. 10번 약관 스크립트(publish_upcoming)가 넣는다.
-- 잠금: CREATE POLICY 는 system_settings 에 ACCESS EXCLUSIVE(읽기도 막음), CREATE TRIGGER 는 SHARE ROW EXCLUSIVE(쓰기만 막음)를 잡는다.
--   그래서 새벽에 짧게 적용하고, 잡지 못하면(lock_timeout 3초) 전체가 취소된다. 새 트리거라 DROP TRIGGER IF EXISTS 를 쓰지 않는다.
-- 되돌리기: 코드를 먼저 되돌린 뒤 supabase/rollback/20261205100000_site_notice_popup_down.sql(새벽).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 0. 사전 점검: 10번(회원 탈퇴)·4번(가입 동의) DB 가 있어야 한다. -------------------------------------------------
DO $precheck_site_notice_popup$
BEGIN
  IF to_regclass('public.signup_consent_items') IS NULL
     OR to_regprocedure('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'member_withdrawal_policy') THEN
    RAISE EXCEPTION 'SITE_NOTICE_POPUP: bundle 4/10 objects missing';
  END IF;
END;
$precheck_site_notice_popup$;

-- 1. 내용 지문(4-2): 제목·링크·링크 이름에는 줄바꿈을 받지 않으므로 글자 경계가 섞이지 않는다. 노출 시작·끝·켜기는 넣지 않는다. ----------
CREATE FUNCTION public.site_notice_popup_content_sha256(p_title text, p_body text, p_link_url text, p_link_label text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_site_notice_popup_content_sha256$
  SELECT encode(sha256(convert_to(
    'site_notice_popup:v1' || E'\n' || p_title || E'\n' || coalesce(p_link_url, '') || E'\n' || coalesce(p_link_label, '') || E'\n' || p_body,
    'UTF8')), 'hex')
$fn_site_notice_popup_content_sha256$;
REVOKE ALL ON FUNCTION public.site_notice_popup_content_sha256(text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- 2. 팝업 설정 행(9절 초안, 꺼짐). 노출 끝 2027-01-12 00:00 KST(13절 1번 기본안). ---------------------------------------------
INSERT INTO public.system_settings (key, value, description, updated_at)
SELECT 'site_notice_popup',
       jsonb_build_object(
         'enabled', false,
         'title', d.title,
         'body', d.body,
         'linkUrl', d.link_url,
         'linkLabel', d.link_label,
         'startsAt', NULL,
         'endsAt', to_jsonb(timestamptz '2027-01-12 00:00:00+09'),
         'contentSha256', public.site_notice_popup_content_sha256(d.title, d.body, d.link_url, d.link_label),
         'revision', 1),
       '회원 화면 공지 팝업(제목·본문·링크·노출 기간·켜기). 대표만 관리자 화면(save_site_notice_popup)으로 고친다. 화면 세션으로 고칠 수 없다.',
       now()
  FROM (SELECT $t$정식 오픈 전 안내와 약관 변경 안내$t$ AS title,
               $b$써머썬연구소는 아직 정식 오픈 전이라 기능과 화면을 다듬고 있습니다. 약관을 바꿀 때는 이용약관 제3조에 따라 미리 알려 드리고, 회원님께 불리하거나 중요한 변경은 30일 전부터 알리며 다시 동의를 받습니다.

회원 탈퇴 절차와 탈퇴 뒤 기록 보관 기준을 정비하기 위해 2027년 1월 11일(월)부터 이용약관·취소/환불정책·개인정보처리방침이 바뀝니다.
- 결제 이력이 있는 계정은 탈퇴 화면에서 탈퇴를 요청하고, 회사가 확인한 뒤 요청일부터 10일 안에 처리합니다.
- 결제 이력이 없는 계정은 바로 탈퇴되지만, 최근 7일 안에 결제 시도가 있으면 7일이 지난 뒤 탈퇴할 수 있습니다. 진행 중인 결제·환불이 있으면 끝난 뒤 탈퇴할 수 있습니다.
- 탈퇴하면 남은 크레딧(유료 충전·자료 환불로 다시 받은 크레딧·무상)은 소멸하며 환불되지 않습니다. 다만 미성년자 결제 취소, 자료 하자 등 법령에 따른 환불은 탈퇴한 뒤에도 고객센터로 요청할 수 있습니다.
- 환불 기간이 남은 충전 건은 쓰지 않았으면 환불받거나 기간이 지난 뒤, 일부를 썼으면 기간이 지난 뒤 탈퇴할 수 있고, 환불 기간이 끝난 뒤 3일 동안도 탈퇴할 수 없습니다(마지막 날이 휴일이면 환불 기간이 늘어나 그동안 고객센터로 환불을 요청할 수 있습니다).
- 탈퇴하면 구매한 자료를 내려받을 수 없고, 받지 않은 자료의 환불은 탈퇴 전에 신청해야 합니다. 후기·추천은 삭제되고 답변을 기다리던 문의는 닫히며, 같은 계정으로 다시 가입해도 크레딧·구매 내역은 이어지지 않습니다.
- 탈퇴 뒤 보관하는 기록과 기간(결제 이력이 없어도 결제 시도 기록, 보존에 동의한 문의 등), 새로 받는 탈퇴 요청 기록을 개인정보처리방침에 적었습니다.
- 시행일 뒤 접속하면 바뀐 약관에 다시 동의하는 화면이 나오며, 동의 전에는 충전과 자료 구매를 할 수 없습니다.

시행일 전까지는 지금 약관이 그대로 적용되고, 충전하신 크레딧과 구매하신 자료도 지금처럼 이용하실 수 있습니다. 바뀐 약관에 동의하지 않으시면 시행일 전까지 탈퇴를 요청하실 수 있습니다. 결제 이력이 있거나 탈퇴 화면에서 접수되지 않으면 고객센터(이메일·전화)로 요청해 주세요.$b$ AS body,
               '/terms/upcoming'::text AS link_url,
               $l$바뀌는 부분 보기$l$ AS link_label) d
ON CONFLICT (key) DO NOTHING;

-- 3. 저장 함수(4-2): 대표만, 판(revision) 비교, 입력 검사, 지문 계산, 같은 거래 안에서 작업 기록. 바뀐 것이 없으면 저장·기록하지 않는다. --
CREATE FUNCTION public.save_site_notice_popup(
  p_actor_id uuid,
  p_expected_revision integer,
  p_enabled boolean,
  p_title text,
  p_body text,
  p_link_url text,
  p_link_label text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_save_site_notice_popup$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_title text;
  v_body text;
  v_link text;
  v_label text;
  v_old_rev integer;
  v_sha text;
  v_now timestamptz := now();
  v_saved_at timestamptz;
  v_visible_before boolean;
  v_visible_after boolean;
  v_audit uuid;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'NOTICE_POPUP_ACTOR_NOT_OWNER';
  END IF;
  -- ① 행위자(대표) ② 설정 행
  PERFORM 1 FROM public.profiles p
   WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.admin_role = 'owner'
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOTICE_POPUP_ACTOR_NOT_OWNER';
  END IF;

  SELECT s.value INTO v_old FROM public.system_settings s WHERE s.key = 'site_notice_popup' FOR UPDATE;
  IF NOT FOUND OR v_old IS NULL THEN
    RAISE EXCEPTION 'NOTICE_POPUP_NOT_FOUND';
  END IF;
  v_old_rev := (v_old ->> 'revision')::integer;
  IF p_expected_revision IS NULL OR v_old_rev IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'NOTICE_POPUP_REVISION_CONFLICT';
  END IF;

  -- 다듬기: CRLF → LF, 앞뒤 공백
  v_title := regexp_replace(replace(coalesce(p_title, ''), E'\r\n', E'\n'), '^\s+|\s+$', '', 'g');
  v_body := regexp_replace(replace(coalesce(p_body, ''), E'\r\n', E'\n'), '^\s+|\s+$', '', 'g');
  v_link := nullif(regexp_replace(replace(coalesce(p_link_url, ''), E'\r\n', E'\n'), '^\s+|\s+$', '', 'g'), '');
  v_label := nullif(regexp_replace(replace(coalesce(p_link_label, ''), E'\r\n', E'\n'), '^\s+|\s+$', '', 'g'), '');

  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'NOTICE_POPUP_INPUT_INVALID: enabled';
  END IF;
  IF char_length(v_title) NOT BETWEEN 1 AND 60 OR v_title ~ '[\r\n]' THEN
    RAISE EXCEPTION 'NOTICE_POPUP_INPUT_INVALID: title';
  END IF;
  IF char_length(v_body) NOT BETWEEN 1 AND 1200 THEN
    RAISE EXCEPTION 'NOTICE_POPUP_INPUT_INVALID: body';
  END IF;
  -- 링크는 사이트 안 주소만: '/' 로 시작, '//'·'/\' 로 시작하지 않음(밖 주소로 해석됨), 공백·제어문자 없음, 200자 이하
  -- (밖 주소·javascript: 는 '/' 로 시작하지 않아 걸림). 관리자 화면 검사 isAllowedNoticeLink 와 같은 규칙.
  IF v_link IS NOT NULL AND (left(v_link, 1) <> '/' OR left(v_link, 2) IN ('//', '/\')
                             OR v_link ~ '[[:space:][:cntrl:]]' OR char_length(v_link) > 200) THEN
    RAISE EXCEPTION 'NOTICE_POPUP_INPUT_INVALID: linkUrl';
  END IF;
  IF v_link IS NULL THEN
    v_label := NULL;
  ELSIF v_label IS NULL OR char_length(v_label) > 20 OR v_label ~ '[\r\n]' THEN
    RAISE EXCEPTION 'NOTICE_POPUP_INPUT_INVALID: linkLabel';
  END IF;
  IF p_starts_at IS NOT NULL AND p_ends_at IS NOT NULL AND p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'NOTICE_POPUP_INPUT_INVALID: endsAt';
  END IF;
  IF p_enabled AND (p_ends_at IS NULL OR p_ends_at <= v_now) THEN
    RAISE EXCEPTION 'NOTICE_POPUP_INPUT_INVALID: endsAt';
  END IF;

  -- 바뀐 것이 없으면 그대로 돌려준다(기록 없음).
  IF (v_old -> 'enabled') = to_jsonb(p_enabled)
     AND v_old ->> 'title' IS NOT DISTINCT FROM v_title
     AND v_old ->> 'body' IS NOT DISTINCT FROM v_body
     AND v_old ->> 'linkUrl' IS NOT DISTINCT FROM v_link
     AND v_old ->> 'linkLabel' IS NOT DISTINCT FROM v_label
     AND (v_old ->> 'startsAt')::timestamptz IS NOT DISTINCT FROM p_starts_at
     AND (v_old ->> 'endsAt')::timestamptz IS NOT DISTINCT FROM p_ends_at THEN
    RETURN jsonb_build_object('changed', false, 'value', v_old, 'auditId', NULL);
  END IF;

  v_sha := public.site_notice_popup_content_sha256(v_title, v_body, v_link, v_label);
  v_new := jsonb_build_object(
    'enabled', p_enabled,
    'title', v_title,
    'body', v_body,
    'linkUrl', v_link,
    'linkLabel', v_label,
    'startsAt', to_jsonb(p_starts_at),
    'endsAt', to_jsonb(p_ends_at),
    'contentSha256', v_sha,
    'revision', v_old_rev + 1);

  v_visible_before := (v_old -> 'enabled') = 'true'::jsonb
    AND ((v_old ->> 'startsAt') IS NULL OR (v_old ->> 'startsAt')::timestamptz <= v_now)
    AND (v_old ->> 'endsAt') IS NOT NULL AND v_now < (v_old ->> 'endsAt')::timestamptz;
  v_visible_after := p_enabled AND (p_starts_at IS NULL OR p_starts_at <= v_now) AND p_ends_at IS NOT NULL AND v_now < p_ends_at;

  UPDATE public.system_settings SET value = v_new, updated_at = v_now WHERE key = 'site_notice_popup';

  -- saved_at 은 clock_timestamp(): 한 거래 안의 여러 저장도 순서가 생긴다(4-3 끊김 판정).
  v_saved_at := clock_timestamp();
  v_audit := public.record_admin_audit(p_actor_id, 'site_notice_popup_save', 'system_settings', 'site_notice_popup', NULL, NULL, NULL,
    jsonb_build_object(
      'revision_before', v_old_rev,
      'revision_after', v_old_rev + 1,
      'before', v_old,
      'after', v_new,
      'content_sha256_before', v_old ->> 'contentSha256',
      'content_sha256_after', v_sha,
      'content_changed', (v_old ->> 'contentSha256') IS DISTINCT FROM v_sha,
      'visible_before', v_visible_before,
      'visible_after', v_visible_after,
      'exposure_starts_at', CASE WHEN p_enabled THEN to_jsonb(GREATEST(v_now, p_starts_at)) ELSE 'null'::jsonb END,
      'saved_at', to_jsonb(v_saved_at)),
    NULL);
  IF v_audit IS NULL THEN
    RAISE EXCEPTION 'NOTICE_POPUP_AUDIT_FAILED';
  END IF;

  RETURN jsonb_build_object('changed', true, 'value', v_new, 'auditId', v_audit);
END;
$fn_save_site_notice_popup$;
REVOKE ALL ON FUNCTION public.save_site_notice_popup(uuid, integer, boolean, text, text, text, text, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_site_notice_popup(uuid, integer, boolean, text, text, text, text, timestamptz, timestamptz)
  TO service_role;

-- 4. 좋은 기록 한 건(4-3 판정 3): 켜짐, 링크가 글자까지 '/terms/upcoming', 끝 ≥ 시행일 00:00 KST, 본문에 시행일 글자, 시작 없음 또는 ≤ 저장 시각.
--    관리자 카드 경고의 isNoticeRecordGood(src/lib/site-notice-popup.ts)과 같은 규칙이다(같은 예시 묶음으로 시험).
CREATE FUNCTION public.policy_upcoming_notice_record_good(p_after jsonb, p_saved_at timestamptz, p_effective_date date, p_effective_date_label text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_policy_upcoming_notice_record_good$
  SELECT coalesce(
    (p_after -> 'enabled') = 'true'::jsonb
    AND (p_after ->> 'linkUrl') = '/terms/upcoming'
    AND (p_after ->> 'endsAt') IS NOT NULL
    AND (p_after ->> 'endsAt')::timestamptz >= (p_effective_date::timestamp AT TIME ZONE 'Asia/Seoul')
    AND p_effective_date_label IS NOT NULL AND p_effective_date_label <> ''
    AND position(p_effective_date_label IN coalesce(p_after ->> 'body', '')) > 0
    AND ((p_after ->> 'startsAt') IS NULL OR (p_after ->> 'startsAt')::timestamptz <= p_saved_at),
    false)
$fn_policy_upcoming_notice_record_good$;
REVOKE ALL ON FUNCTION public.policy_upcoming_notice_record_good(jsonb, timestamptz, date, text) FROM PUBLIC, anon, authenticated, service_role;

-- 5. 고지 끊김 판정(4-2·4-3): 시행 스크립트·런북 조회(notice_continuity_check)·관리자 카드가 이 함수만 부른다. 읽기만 한다.
--    시행일·고지 마감일은 게시 행의 effectiveDate·noticeDeadline 을 읽는다. 인자를 받으면 행 값과 같은지만 대조한다(ARG_MISMATCH).
CREATE FUNCTION public.policy_upcoming_notice_continuity(p_effective_date date DEFAULT NULL, p_notice_deadline date DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_policy_upcoming_notice_continuity$
DECLARE
  v_row jsonb;
  v_effective date;
  v_deadline date;
  v_label text;
  v_published timestamptz;
  v_rec record;
  v_n integer := 0;
  v_last_id uuid;
  v_last_rev integer;
  v_s_id uuid;
  v_s_saved timestamptz;
  v_s_start timestamptz;
  v_popup jsonb;
BEGIN
  SELECT s.value INTO v_row FROM public.system_settings s WHERE s.key = 'policy_upcoming_documents';
  IF v_row IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_PUBLICATION', 's_id', NULL, 'last_id', NULL, 's_saved_at', NULL);
  END IF;
  v_effective := (v_row ->> 'effectiveDate')::date;
  v_deadline := (v_row ->> 'noticeDeadline')::date;
  v_label := v_row ->> 'effectiveDateLabel';
  IF (p_effective_date IS NOT NULL AND p_effective_date IS DISTINCT FROM v_effective)
     OR (p_notice_deadline IS NOT NULL AND p_notice_deadline IS DISTINCT FROM v_deadline) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ARG_MISMATCH', 's_id', NULL, 'last_id', NULL, 's_saved_at', NULL);
  END IF;
  -- 1) 게시 행 upcoming, 게시일(한국 날짜) ≤ 고지 마감일
  IF (v_row ->> 'status') IS DISTINCT FROM 'upcoming' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_UPCOMING', 's_id', NULL, 'last_id', NULL, 's_saved_at', NULL);
  END IF;
  v_published := (v_row ->> 'publishedAt')::timestamptz;
  IF v_published IS NULL OR v_effective IS NULL OR v_deadline IS NULL
     OR (v_published AT TIME ZONE 'Asia/Seoul')::date > v_deadline THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'PUBLISHED_AFTER_DEADLINE', 's_id', NULL, 'last_id', NULL, 's_saved_at', NULL);
  END IF;

  -- 2)~4) 게시 뒤 팝업 저장 기록을 (saved_at, id) 순으로 세우고, 마지막 기록부터 거꾸로 좋은 기록이 이어지는 가장 앞 기록 S 를 찾는다.
  FOR v_rec IN
    SELECT a.id, a.details, (a.details ->> 'saved_at')::timestamptz AS saved_at
      FROM public.admin_audit_log a
     WHERE a.action = 'site_notice_popup_save'
       AND (a.details ->> 'saved_at')::timestamptz > v_published
     ORDER BY (a.details ->> 'saved_at')::timestamptz DESC, a.id DESC
  LOOP
    v_n := v_n + 1;
    IF v_n = 1 THEN
      v_last_id := v_rec.id;
      v_last_rev := (v_rec.details ->> 'revision_after')::integer;
    END IF;
    IF public.policy_upcoming_notice_record_good(v_rec.details -> 'after', v_rec.saved_at, v_effective, v_label) THEN
      v_s_id := v_rec.id;
      v_s_saved := v_rec.saved_at;
      v_s_start := v_rec.saved_at;
    ELSE
      -- S 기록에서는 미래 시작도 받는다: 시작만 빼면 좋은 기록이고 시작이 저장 시각 뒤면 그 기록이 S 다.
      -- 다만 그 기록이 마지막 기록이거나, 시작이 바로 뒤(이미 찾은) 좋은 기록의 저장 시각 이하일 때만이다.
      -- 그렇지 않으면 바로 뒤 좋은 기록이 이미 보이기 시작한 때이므로 앞서 잡은 S 를 그대로 둔다(거짓 멈춤 방지).
      IF (v_rec.details #>> '{after,startsAt}') IS NOT NULL
         AND (v_rec.details #>> '{after,startsAt}')::timestamptz > v_rec.saved_at
         AND (v_s_id IS NULL OR (v_rec.details #>> '{after,startsAt}')::timestamptz <= v_s_saved)
         AND public.policy_upcoming_notice_record_good((v_rec.details -> 'after') - 'startsAt', v_rec.saved_at, v_effective, v_label) THEN
        v_s_id := v_rec.id;
        v_s_saved := v_rec.saved_at;
        v_s_start := (v_rec.details #>> '{after,startsAt}')::timestamptz;
      END IF;
      EXIT;
    END IF;
  END LOOP;

  IF v_n = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_RECORDS', 's_id', NULL, 'last_id', NULL, 's_saved_at', NULL);
  END IF;
  IF v_s_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'LAST_NOT_GOOD', 's_id', NULL, 'last_id', v_last_id, 's_saved_at', NULL);
  END IF;
  -- 5) GREATEST(S.saved_at, S.after.startsAt)(한국 날짜) ≤ 고지 마감일
  IF (GREATEST(v_s_saved, v_s_start) AT TIME ZONE 'Asia/Seoul')::date > v_deadline THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'START_AFTER_DEADLINE', 's_id', v_s_id, 'last_id', v_last_id, 's_saved_at', to_jsonb(v_s_saved));
  END IF;
  -- 6) 지금 팝업 행의 revision = 마지막 기록의 revision_after(기록 밖에서 바뀌지 않았음)
  SELECT s.value INTO v_popup FROM public.system_settings s WHERE s.key = 'site_notice_popup';
  IF v_popup IS NULL OR (v_popup ->> 'revision')::integer IS DISTINCT FROM v_last_rev THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'REVISION_MISMATCH', 's_id', v_s_id, 'last_id', v_last_id, 's_saved_at', to_jsonb(v_s_saved));
  END IF;
  RETURN jsonb_build_object('ok', true, 'reason', NULL, 's_id', v_s_id, 'last_id', v_last_id, 's_saved_at', to_jsonb(v_s_saved));
END;
$fn_policy_upcoming_notice_continuity$;
REVOKE ALL ON FUNCTION public.policy_upcoming_notice_continuity(date, date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.policy_upcoming_notice_continuity(date, date) TO service_role;

-- 6. 고지 기간 잠금 트리거(4-4). 게시 행이 'upcoming' 일 때만 막는다. 행이 없거나 다른 상태면 그대로 둔다. ------------------------------
-- 6-1. 약관 문서: 게시 행 documents[].key 에 든 문서의 content·slug·title·enabled 가 바뀌면 막는다(다른 칸은 그대로 저장됨).
CREATE FUNCTION public.lock_policy_documents_during_notice_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_lock_policy_documents_during_notice$
DECLARE
  v_pub jsonb;
  v_key text;
  v_field text;
BEGIN
  SELECT s.value INTO v_pub FROM public.system_settings s WHERE s.key = 'policy_upcoming_documents';
  IF v_pub IS NULL OR (v_pub ->> 'status') IS DISTINCT FROM 'upcoming' THEN
    RETURN NEW;
  END IF;
  FOR v_key IN SELECT d ->> 'key' FROM jsonb_array_elements(coalesce(v_pub -> 'documents', '[]'::jsonb)) d LOOP
    FOREACH v_field IN ARRAY ARRAY['content', 'slug', 'title', 'enabled'] LOOP
      IF (NEW.value #> ARRAY['policyDocuments', v_key, v_field]) IS DISTINCT FROM (OLD.value #> ARRAY['policyDocuments', v_key, v_field]) THEN
        RAISE EXCEPTION 'POLICY_UPCOMING_LOCKED: policy document % % is locked during notice', v_key, v_field;
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$fn_lock_policy_documents_during_notice$;
REVOKE ALL ON FUNCTION public.lock_policy_documents_during_notice_fn() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER lock_policy_documents_during_notice
  BEFORE UPDATE ON public.system_settings
  FOR EACH ROW WHEN (NEW.key = 'site_footer_content')
  EXECUTE FUNCTION public.lock_policy_documents_during_notice_fn();

-- 6-2. 가입 동의 항목: 게시 행 consentItems 의 key 행에서 content·label·version·required·is_active·policy_slug 가 바뀌면 막는다.
CREATE FUNCTION public.lock_consent_items_during_notice_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_lock_consent_items_during_notice$
DECLARE
  v_pub jsonb;
BEGIN
  SELECT s.value INTO v_pub FROM public.system_settings s WHERE s.key = 'policy_upcoming_documents';
  IF v_pub IS NULL OR (v_pub ->> 'status') IS DISTINCT FROM 'upcoming' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_pub -> 'consentItems', '[]'::jsonb)) c
              WHERE c ->> 'key' IN (OLD.key, NEW.key))
     AND (NEW.content IS DISTINCT FROM OLD.content OR NEW.label IS DISTINCT FROM OLD.label OR NEW.version IS DISTINCT FROM OLD.version
          OR NEW.required IS DISTINCT FROM OLD.required OR NEW.is_active IS DISTINCT FROM OLD.is_active
          OR NEW.policy_slug IS DISTINCT FROM OLD.policy_slug OR NEW.key IS DISTINCT FROM OLD.key) THEN
    RAISE EXCEPTION 'POLICY_UPCOMING_LOCKED: consent item % is locked during notice', OLD.key;
  END IF;
  RETURN NEW;
END;
$fn_lock_consent_items_during_notice$;
REVOKE ALL ON FUNCTION public.lock_consent_items_during_notice_fn() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER lock_consent_items_during_notice
  BEFORE UPDATE ON public.signup_consent_items
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_consent_items_during_notice_fn();

-- 6-3. 탈퇴 정책 문구: 게시 행 lockedWithdrawalPaths 의 경로가 바뀌거나, selfAnonymizeEnabled 를 켜면 막는다.
--      blockReasons.DISABLED(4-6 작은 스크립트)와 목록에 없는 다른 값은 막지 않는다.
CREATE FUNCTION public.lock_withdrawal_texts_during_notice_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_lock_withdrawal_texts_during_notice$
DECLARE
  v_pub jsonb;
  v_path text;
BEGIN
  SELECT s.value INTO v_pub FROM public.system_settings s WHERE s.key = 'policy_upcoming_documents';
  IF v_pub IS NULL OR (v_pub ->> 'status') IS DISTINCT FROM 'upcoming' THEN
    RETURN NEW;
  END IF;
  IF (NEW.value -> 'selfAnonymizeEnabled') = 'true'::jsonb AND (OLD.value -> 'selfAnonymizeEnabled') IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'POLICY_UPCOMING_LOCKED: selfAnonymizeEnabled cannot be turned on during notice';
  END IF;
  FOR v_path IN SELECT p FROM jsonb_array_elements_text(coalesce(v_pub -> 'lockedWithdrawalPaths', '[]'::jsonb)) p LOOP
    IF (NEW.value #> v_path::text[]) IS DISTINCT FROM (OLD.value #> v_path::text[]) THEN
      RAISE EXCEPTION 'POLICY_UPCOMING_LOCKED: member_withdrawal_policy % is locked during notice', v_path;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$fn_lock_withdrawal_texts_during_notice$;
REVOKE ALL ON FUNCTION public.lock_withdrawal_texts_during_notice_fn() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER lock_withdrawal_texts_during_notice
  BEFORE UPDATE ON public.system_settings
  FOR EACH ROW WHEN (NEW.key = 'member_withdrawal_policy')
  EXECUTE FUNCTION public.lock_withdrawal_texts_during_notice_fn();

-- 7. 쓰기 막기 정책(4-4): 화면 세션(대표 포함)이 두 키를 직접 고치지 못한다. ------------------------------------------------------
CREATE POLICY system_settings_site_notice_popup_no_client_write
  ON public.system_settings
  AS RESTRICTIVE
  FOR UPDATE
  USING (key <> 'site_notice_popup')
  WITH CHECK (key <> 'site_notice_popup');

-- 게시 행 정책은 되돌리기가 남기므로 없을 때만 만든다(DROP 없이).
DO $create_policy_upcoming_documents_policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'system_settings'
                    AND policyname = 'system_settings_policy_upcoming_documents_no_client_write') THEN
    CREATE POLICY system_settings_policy_upcoming_documents_no_client_write
      ON public.system_settings
      AS RESTRICTIVE
      FOR UPDATE
      USING (key <> 'policy_upcoming_documents')
      WITH CHECK (key <> 'policy_upcoming_documents');
  END IF;
END;
$create_policy_upcoming_documents_policy$;

-- 8. VERIFY ------------------------------------------------------------------------------------------------------
DO $verify_site_notice_popup$
DECLARE
  v_row jsonb;
  v_fn text;
BEGIN
  SELECT value INTO v_row FROM public.system_settings WHERE key = 'site_notice_popup';
  IF v_row IS NULL OR (v_row -> 'enabled') IS DISTINCT FROM 'false'::jsonb OR (v_row ->> 'revision') IS NULL
     OR (v_row ->> 'contentSha256') !~ '^[0-9a-f]{64}$'
     OR (v_row ->> 'contentSha256') IS DISTINCT FROM public.site_notice_popup_content_sha256(v_row ->> 'title', v_row ->> 'body', v_row ->> 'linkUrl', v_row ->> 'linkLabel') THEN
    RAISE EXCEPTION 'VERIFY: site_notice_popup row';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.site_notice_popup_content_sha256(text,text,text,text)'::regprocedure) <> 's' THEN
    RAISE EXCEPTION 'VERIFY: content sha256 function must be STABLE';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY['public.save_site_notice_popup(uuid,integer,boolean,text,text,text,text,timestamp with time zone,timestamp with time zone)',
                              'public.policy_upcoming_notice_continuity(date,date)'] LOOP
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'VERIFY: % EXECUTE must be service_role only', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY['public.site_notice_popup_content_sha256(text,text,text,text)',
                              'public.policy_upcoming_notice_record_good(jsonb,timestamp with time zone,date,text)',
                              'public.lock_policy_documents_during_notice_fn()', 'public.lock_consent_items_during_notice_fn()',
                              'public.lock_withdrawal_texts_during_notice_fn()'] LOOP
    IF has_function_privilege('service_role', v_fn, 'EXECUTE') OR has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'VERIFY: % must not be executable by API roles', v_fn;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_trigger t
       WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
         AND ((t.tgrelid = 'public.system_settings'::regclass AND t.tgname IN ('lock_policy_documents_during_notice', 'lock_withdrawal_texts_during_notice'))
           OR (t.tgrelid = 'public.signup_consent_items'::regclass AND t.tgname = 'lock_consent_items_during_notice'))) <> 3 THEN
    RAISE EXCEPTION 'VERIFY: notice lock triggers';
  END IF;
  -- 게시 행이 없으면 판정은 NO_PUBLICATION 이다(적용 직후).
  IF NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'policy_upcoming_documents')
     AND (public.policy_upcoming_notice_continuity() ->> 'reason') IS DISTINCT FROM 'NO_PUBLICATION' THEN
    RAISE EXCEPTION 'VERIFY: continuity without publication';
  END IF;
END;
$verify_site_notice_popup$;

-- 정책 검사는 이름 붙인 별도 블록이다(리허설의 '정책 뺀 사본'은 CREATE POLICY 2개와 이 블록을 뺀다 — 계획 4절 머리).
DO $verify_site_notice_popup_policies$
BEGIN
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'system_settings' AND permissive = 'RESTRICTIVE' AND cmd = 'UPDATE'
         AND ((policyname = 'system_settings_site_notice_popup_no_client_write'
               AND qual = '(key <> ''site_notice_popup''::text)' AND with_check = '(key <> ''site_notice_popup''::text)')
           OR (policyname = 'system_settings_policy_upcoming_documents_no_client_write'
               AND qual = '(key <> ''policy_upcoming_documents''::text)' AND with_check = '(key <> ''policy_upcoming_documents''::text)'))) <> 2 THEN
    RAISE EXCEPTION 'VERIFY: site_notice_popup / policy_upcoming_documents RESTRICTIVE policies';
  END IF;
END;
$verify_site_notice_popup_policies$;

NOTIFY pgrst, 'reload schema';

DO $rh_r52_reapply$
BEGIN
  PERFORM pg_temp.log('R5-2', pg_temp.ensure((SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings'
    AND policyname = 'system_settings_policy_upcoming_documents_no_client_write') = 1, 'R5-2', '다시 적용 성공·게시 행 정책 1개'));
  PERFORM pg_temp.log('R5-2', pg_temp.ensure((SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
    AND tgname IN ('lock_policy_documents_during_notice', 'lock_withdrawal_texts_during_notice', 'lock_consent_items_during_notice')) = 3
    AND (SELECT value -> 'enabled' FROM public.system_settings WHERE key = 'site_notice_popup') = 'false'::jsonb, 'R5-2', 'R1 과 같은 값(트리거 3·팝업 행 꺼짐)'));
END
$rh_r52_reapply$;

SELECT n, test, msg, payload FROM _rh_log ORDER BY n;
ROLLBACK;
