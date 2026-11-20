-- 되돌리기: 20261120130000_policy_document_history.sql
-- 코드 배포 뒤에는 되돌리지 말 것(약관 본문 사본과 동의 기록의 본문 지문이 사라진다 — 법적 증빙). 꼭 필요하면 먼저
-- policy_document_snapshots 와 user_consents(policy_sha256 포함)를 백업하고, 코드를 되돌린 뒤 실행한다.
-- 반드시 한 트랜잭션으로 실행한다(BEGIN … COMMIT). SET LOCAL 과 중간 검사가 그 전제다.
-- 순서가 중요하다: 동의 기록 함수를 4번 정의로 먼저 되돌린 다음 열을 지운다(plpgsql 은 지운 열 참조를 실행 때에야 알아챈다).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DROP TRIGGER IF EXISTS record_policy_document_snapshots ON public.system_settings;
DROP FUNCTION IF EXISTS public.record_policy_document_snapshots();

DO $check$
BEGIN
  IF position('policy_sha256' IN pg_get_functiondef('public.consent_record_internal(uuid,jsonb,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'CONSENT_RECORD_INTERNAL_NOT_BUNDLE6';
  END IF;
END;
$check$;

-- 4번 묶음 정의(20261120120000)로 되돌린다.
CREATE OR REPLACE FUNCTION public.consent_record_internal(p_user_id uuid, p_items jsonb, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_consent_record_internal$
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

    INSERT INTO public.user_consents (user_id, item_id, item_version, agreed, source)
    VALUES (p_user_id, v_item.id, v_item.version, v_agreed, p_source);
  END LOOP;

  RETURN public.consent_latest_results(p_user_id, v_item_ids);
END;
$fn_consent_record_internal$;

REVOKE ALL ON FUNCTION public.consent_record_internal(uuid, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.user_consents DROP CONSTRAINT IF EXISTS user_consents_policy_sha256_check;
ALTER TABLE public.user_consents DROP COLUMN IF EXISTS policy_sha256;

DROP TABLE IF EXISTS public.policy_document_snapshots;
DROP FUNCTION IF EXISTS public.prevent_policy_document_snapshot_mutation();

-- 4번 정의로 정확히 돌아왔는지 확인(다르면 전체 취소)
DO $verify_restore$
BEGIN
  IF md5(pg_get_functiondef('public.consent_record_internal(uuid,jsonb,text)'::regprocedure)) <> '5b14ce9ffa188648c781f48e7a8ef2bd' THEN
    RAISE EXCEPTION 'CONSENT_RECORD_INTERNAL_NOT_RESTORED';
  END IF;
END;
$verify_restore$;

NOTIFY pgrst, 'reload schema';
