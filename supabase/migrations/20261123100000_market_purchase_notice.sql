-- 출시 전 작업 순서표 7번 묶음: 자료 구매 고지·동의와 상품 정보 표시(계획 docs/plan-bundle7-purchase-notice.md 4판).
-- 배경: 지금은 자료를 살 때 환불 제한(다운로드하면 단순 변심 환불 불가)을 확인받지도, 기록하지도 않는다.
--       환불 기간(7일)은 코드 상수라 고지 문구와 판정이 따로 논다.
-- 이 파일은 추가만 한다(설정 1행·열 1개·표 1개·함수 2개·정책 1개). 옛 코드는 새 설정·표·함수를 읽지 않으므로 적용해도 지금 동작은 그대로다.
-- 만드는 것:
--   1. system_settings 'market_purchase_policy'(환불 기간 refundDays 와 구매 고지 문구 — 자리표시는 {자료환불기간} 하나).
--      RESTRICTIVE FOR UPDATE 정책으로 화면 세션(authenticated) 직접 수정을 막는다(관리자 저장은 서버 키 + site.manage).
--   2. market_file_types.required_program(파일 형식별 필요 프로그램) 열과 두 과목 × pdf·hwp·zip 6행 첫 값.
--   3. market_purchase_notice_acks(구매 고지 동의 기록, 추가만) — 탈퇴 연쇄 삭제(부모 profiles 가 지워진 뒤)만 허용.
--      RLS 를 켜고 정책 없이 anon·authenticated·service_role 권한을 걷은 뒤 service_role 에 SELECT 만 준다.
--   4. record_purchase_notice_ack(p_user_id, p_idempotency_key, p_notice_sha256) — SECURITY DEFINER, service_role 만 실행.
--      지문 = sha256( fill(checkboxLabel) || chr(10) || fill(confirmNotice) ), fill = {자료환불기간} 을 모두 refundDays 로 바꿈.
--      코드(src/lib/market-purchase-policy.ts)가 같은 규칙으로 계산해 화면에 내려 주고, 브라우저는 그대로 돌려보낸다.
--      결과 코드(jsonb): ok(replay 여부) / NOTICE_INPUT_INVALID / NOTICE_POLICY_UNAVAILABLE / NOTICE_CHANGED / NOTICE_KEY_CONFLICT.
--      NOTICE_CHANGED·NOTICE_KEY_CONFLICT 때는 지금 정책으로 채운 checkboxLabel·confirmNotice·noticeSha256·refundDays 를 함께 돌려준다.
-- 결제 RPC(checkout_market_selection)·환불 RPC(approve_market_refund)는 바꾸지 않는다(VERIFY 에서 정의 md5 확인).
-- 잠금: system_settings 에 정책을 더하며 ACCESS EXCLUSIVE, market_file_types 에 열을 더하며 ACCESS EXCLUSIVE,
--       새 표 → profiles FK 를 만들며 profiles 에 SHARE ROW EXCLUSIVE 를 잡고 커밋까지 유지한다. 잡지 못하면 최대 3초 대기 뒤 전체 취소.
-- 순서: 코드 배포보다 먼저 적용한다(새 코드는 새 설정·열·함수를 부른다).
-- 되돌리기: supabase/rollback/20261123100000_market_purchase_notice_down.sql — 코드 배포 뒤에는 되돌리지 말 것(동의 기록 = 증빙).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 1. 구매 고지 설정 ---------------------------------------------------------------------------------------------
-- 새 키다. 이미 있으면 INSERT 가 실패해 전체가 취소된다.
INSERT INTO public.system_settings (key, value, description, updated_at)
VALUES (
  'market_purchase_policy',
  $json${
    "version": 1,
    "refundDays": 7,
    "checkboxLabel": "다운로드한 자료는 단순 변심으로 환불할 수 없고, 받지 않은 자료는 구매 후 {자료환불기간}일 안에 환불 신청할 수 있음을 확인했습니다.",
    "confirmNotice": "받지 않은 자료의 환불은 자료 보관함에서 신청하고, 하자가 있거나 소개 내용과 다른 자료는 다운로드 뒤에도 고객센터(1:1 문의)로 신청하면 환불해 드립니다. 환불은 결제에 쓴 크레딧으로 돌아오며, 환불되면 그 자료는 더 받을 수 없습니다. HWP로 업그레이드한 PDF 주문은 환불할 수 없습니다.",
    "usageScopeNotice": "본인 수업·학습용 인쇄와 본인이 가르치는 학생에게 인쇄물 배포는 할 수 있습니다. 파일 공유·재판매·온라인 게시는 고쳐서 만든 자료라도 할 수 없습니다.",
    "downloadPeriodNotice": "구매한 자료는 기간·횟수 제한 없이 자료 보관함에서 다시 받을 수 있습니다. 다만 권리침해가 확인되거나 약관 위반으로 이용이 제한된 경우에는 받을 수 없고, 서비스를 종료할 때는 안내한 기간까지 받을 수 있습니다.",
    "detailRefundNotice": "다운로드한 자료는 단순 변심으로 환불할 수 없고, 받지 않은 자료는 구매 후 {자료환불기간}일 안에 자료 보관함에서 환불 신청할 수 있습니다. 하자가 있거나 소개 내용과 다른 자료는 다운로드 뒤에도 고객센터(1:1 문의)로 신청하면 환불해 드립니다. 환불은 결제에 쓴 크레딧으로 돌아오며, 환불되면 그 자료는 더 받을 수 없습니다.",
    "refundExpiredReason": "구매 후 {자료환불기간}일이 지난 자료는 환불할 수 없습니다.",
    "purchaseCompleteNotice": "구매 후 바로 다운로드할 수 있으며, 구매한 파일은 자료 보관함에서도 확인할 수 있습니다."
  }$json$::jsonb,
  '자료 구매 고지·환불 기간(src/lib/market-purchase-policy.ts). 문구 변경은 관리자 사이트 기본 정보 > 구매 고지에서만. refundDays 변경은 8번 묶음.',
  now()
);

-- 화면 세션 직접 쓰기 차단(대표 포함 — 바꾸는 길은 검사·작업 기록을 거치는 서버 저장뿐)
CREATE POLICY system_settings_market_purchase_policy_no_client_write
  ON public.system_settings
  AS RESTRICTIVE
  FOR UPDATE
  USING (key <> 'market_purchase_policy')
  WITH CHECK (key <> 'market_purchase_policy');

-- 2. 파일 형식별 필요 프로그램 ----------------------------------------------------------------------------------
ALTER TABLE public.market_file_types ADD COLUMN required_program text;

UPDATE public.market_file_types
   SET required_program = CASE code
         WHEN 'pdf' THEN 'PDF 뷰어(Adobe Acrobat Reader 등)'
         WHEN 'hwp' THEN '한글(한컴오피스) 또는 한컴 뷰어'
         WHEN 'zip' THEN '압축 해제 프로그램과 안에 든 파일 형식(HWP·PDF)에 맞는 프로그램'
       END,
       updated_at = now()
 WHERE workspace_subject IN ('korean', 'english')
   AND code IN ('pdf', 'hwp', 'zip');

-- 3. 구매 고지 동의 기록(추가만) --------------------------------------------------------------------------------
CREATE TABLE public.market_purchase_notice_acks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  notice_sha256 text NOT NULL,
  notice_text text NOT NULL,
  refund_days integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT market_purchase_notice_acks_sha_check CHECK (notice_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT market_purchase_notice_acks_text_check CHECK (notice_text <> ''),
  CONSTRAINT market_purchase_notice_acks_refund_days_check CHECK (refund_days > 0),
  CONSTRAINT market_purchase_notice_acks_user_key UNIQUE (user_id, idempotency_key)
);

-- UPDATE·TRUNCATE 는 늘 거부. DELETE 는 부모 profiles 행이 이미 없을 때(탈퇴 연쇄 삭제)만 허용(user_consents 와 같은 규칙).
CREATE FUNCTION public.guard_market_purchase_notice_acks_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_market_purchase_notice_acks_mutation$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id) THEN
      RAISE EXCEPTION 'MARKET_PURCHASE_NOTICE_ACKS_APPEND_ONLY';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'MARKET_PURCHASE_NOTICE_ACKS_APPEND_ONLY';
END;
$fn_guard_market_purchase_notice_acks_mutation$;

CREATE TRIGGER guard_market_purchase_notice_acks_mutation
  BEFORE UPDATE OR DELETE ON public.market_purchase_notice_acks
  FOR EACH ROW EXECUTE FUNCTION public.guard_market_purchase_notice_acks_mutation();

CREATE TRIGGER guard_market_purchase_notice_acks_truncate
  BEFORE TRUNCATE ON public.market_purchase_notice_acks
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_market_purchase_notice_acks_mutation();

ALTER TABLE public.market_purchase_notice_acks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.market_purchase_notice_acks FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.market_purchase_notice_acks TO service_role;

-- 4. 동의 기록 함수 ---------------------------------------------------------------------------------------------
-- 순서: ① 입력 검사 → ② 같은 (회원, 키) 행이 있고 지문이 같으면 replay → ③ 지금 정책을 읽어 문장·지문 계산
--       (못 읽으면 NOTICE_POLICY_UNAVAILABLE) → ④ 같은 키의 다른 지문 행이면 NOTICE_KEY_CONFLICT → ⑤ 요청 지문이 지금과 다르면 NOTICE_CHANGED
--       → ⑥ INSERT … ON CONFLICT DO NOTHING, 넣지 못했으면(동시 같은 키) 다시 읽어 ②·④ 와 같은 판정.
-- 오류는 jsonb code 로만 나눈다(메시지 정규식 금지). 회원이 없으면 FK 오류가 그대로 나간다(부르는 쪽은 503).
CREATE FUNCTION public.record_purchase_notice_ack(p_user_id uuid, p_idempotency_key uuid, p_notice_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_record_purchase_notice_ack$
DECLARE
  v_existing_sha text;
  v_value jsonb;
  v_days_numeric numeric;
  v_days integer;
  v_label text;
  v_notice text;
  v_text text;
  v_sha text;
  v_inserted_id uuid;
  v_details jsonb;
BEGIN
  -- ① 입력 검사
  IF p_user_id IS NULL OR p_idempotency_key IS NULL OR p_notice_sha256 IS NULL OR p_notice_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_INPUT_INVALID');
  END IF;

  -- ② 같은 키로 이미 기록했고 지문이 같으면 그대로 통과(402 뒤 다시 누르기, 503 뒤 재시도)
  SELECT a.notice_sha256 INTO v_existing_sha
    FROM public.market_purchase_notice_acks a
   WHERE a.user_id = p_user_id AND a.idempotency_key = p_idempotency_key;
  IF FOUND AND v_existing_sha = p_notice_sha256 THEN
    RETURN jsonb_build_object('ok', true, 'replay', true);
  END IF;

  -- ③ 지금 정책: refundDays 는 숫자·정수·양수, 두 문구는 비어 있지 않은 글자
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'market_purchase_policy';
  IF v_value IS NULL OR jsonb_typeof(v_value) <> 'object'
     OR jsonb_typeof(v_value -> 'refundDays') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_value -> 'checkboxLabel') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_value -> 'confirmNotice') IS DISTINCT FROM 'string' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE');
  END IF;
  v_days_numeric := (v_value ->> 'refundDays')::numeric;
  IF v_days_numeric <> trunc(v_days_numeric) OR v_days_numeric <= 0 OR v_days_numeric > 3650 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE');
  END IF;
  v_days := v_days_numeric::integer;
  v_label := replace(v_value ->> 'checkboxLabel', '{자료환불기간}', v_days::text);
  v_notice := replace(v_value ->> 'confirmNotice', '{자료환불기간}', v_days::text);
  IF btrim(v_label) = '' OR btrim(v_notice) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE');
  END IF;
  v_text := v_label || chr(10) || v_notice;
  v_sha := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');
  v_details := jsonb_build_object('checkboxLabel', v_label, 'confirmNotice', v_notice, 'noticeSha256', v_sha, 'refundDays', v_days);

  -- ④ 같은 키를 다른 화면(지문)으로 다시 쓰면 거절 — 화면은 새 키를 만든다
  IF v_existing_sha IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details);
  END IF;

  -- ⑤ 화면에 보인 문구가 지금 문구와 다르면 거절
  IF v_sha <> p_notice_sha256 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_CHANGED', 'details', v_details);
  END IF;

  -- ⑥ 기록
  INSERT INTO public.market_purchase_notice_acks (user_id, idempotency_key, notice_sha256, notice_text, refund_days)
  VALUES (p_user_id, p_idempotency_key, v_sha, v_text, v_days)
  ON CONFLICT (user_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_inserted_id;
  IF v_inserted_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'replay', false);
  END IF;

  SELECT a.notice_sha256 INTO v_existing_sha
    FROM public.market_purchase_notice_acks a
   WHERE a.user_id = p_user_id AND a.idempotency_key = p_idempotency_key;
  IF v_existing_sha = p_notice_sha256 THEN
    RETURN jsonb_build_object('ok', true, 'replay', true);
  END IF;
  RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details);
END;
$fn_record_purchase_notice_ack$;

REVOKE ALL ON FUNCTION public.guard_market_purchase_notice_acks_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_purchase_notice_ack(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_purchase_notice_ack(uuid, uuid, text) TO service_role;

-- 5. VERIFY -----------------------------------------------------------------------------------------------------
DO $verify_market_purchase_notice$
DECLARE
  v_text text;
  v_count integer;
  v_acl text;
  v_value jsonb;
  v_key text;
BEGIN
  -- 5-1. 표 권한: service_role SELECT 만, anon·authenticated 없음, RLS 켬, 정책 없음
  SELECT string_agg(format('%s:%s', grantee, privilege_type), ', ') INTO v_text
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'market_purchase_notice_acks'
     AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
     AND NOT (grantee = 'service_role' AND privilege_type = 'SELECT');
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: unexpected table grants: %', v_text;
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.market_purchase_notice_acks'::regclass) THEN
    RAISE EXCEPTION 'VERIFY: RLS not enabled on market_purchase_notice_acks';
  END IF;
  SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public' AND tablename = 'market_purchase_notice_acks';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'VERIFY: market_purchase_notice_acks policies = %', v_count;
  END IF;

  -- 5-2. (3a) PUBLIC/anon 이 실행할 수 있는 SECURITY DEFINER 함수는 handle_new_user 뿐
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

  -- 5-3. 함수 ACL·DEFINER·search_path
  SELECT p.proacl::text INTO v_acl FROM pg_proc p WHERE p.oid = 'public.record_purchase_notice_ack(uuid,uuid,text)'::regprocedure;
  IF v_acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'VERIFY: record_purchase_notice_ack acl = %', v_acl;
  END IF;
  SELECT p.proacl::text INTO v_acl FROM pg_proc p WHERE p.oid = 'public.guard_market_purchase_notice_acks_mutation()'::regprocedure;
  IF v_acl IS DISTINCT FROM '{postgres=X/postgres}' THEN
    RAISE EXCEPTION 'VERIFY: guard acl = %', v_acl;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = 'public.record_purchase_notice_ack(uuid,uuid,text)'::regprocedure
       AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp']
  ) THEN
    RAISE EXCEPTION 'VERIFY: record_purchase_notice_ack definer/search_path';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.guard_market_purchase_notice_acks_mutation()'::regprocedure AND p.prosecdef) THEN
    RAISE EXCEPTION 'VERIFY: guard must not be definer';
  END IF;
  SELECT count(*) INTO v_count FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'record_purchase_notice_ack';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'VERIFY: record_purchase_notice_ack overloads = %', v_count;
  END IF;

  -- 5-4. 트리거 2개(BEFORE UPDATE OR DELETE 행 단위, BEFORE TRUNCATE), FK 연쇄 삭제, (회원, 키) 유일
  SELECT count(*) INTO v_count FROM pg_trigger t
   WHERE t.tgrelid = 'public.market_purchase_notice_acks'::regclass AND NOT t.tgisinternal;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'VERIFY: append-only triggers = %', v_count;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'public.market_purchase_notice_acks'::regclass AND t.tgname = 'guard_market_purchase_notice_acks_mutation'
                    AND pg_get_triggerdef(t.oid) LIKE '%BEFORE DELETE OR UPDATE%FOR EACH ROW%')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t
                     WHERE t.tgrelid = 'public.market_purchase_notice_acks'::regclass AND t.tgname = 'guard_market_purchase_notice_acks_truncate'
                       AND pg_get_triggerdef(t.oid) LIKE '%BEFORE TRUNCATE%') THEN
    RAISE EXCEPTION 'VERIFY: append-only trigger definitions';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid = 'public.market_purchase_notice_acks'::regclass AND c.contype = 'f'
                    AND c.confrelid = 'public.profiles'::regclass AND c.confdeltype = 'c')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint c
                     WHERE c.conrelid = 'public.market_purchase_notice_acks'::regclass AND c.contype = 'u'
                       AND c.conname = 'market_purchase_notice_acks_user_key') THEN
    RAISE EXCEPTION 'VERIFY: acks FK cascade / unique';
  END IF;

  -- 5-5. system_settings 쓰기 차단 정책
  SELECT count(*) INTO v_count FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'system_settings'
     AND policyname = 'system_settings_market_purchase_policy_no_client_write'
     AND permissive = 'RESTRICTIVE' AND cmd = 'UPDATE'
     AND qual = '(key <> ''market_purchase_policy''::text)'
     AND with_check = '(key <> ''market_purchase_policy''::text)';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'VERIFY: market_purchase_policy restrictive policy = %', v_count;
  END IF;

  -- 5-6. 설정 첫 값: refundDays 7, 문구는 모두 비지 않은 글자·CR 없음·앞뒤 공백 없음, 자리표시는 {자료환불기간} 만
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'market_purchase_policy';
  IF v_value -> 'refundDays' IS DISTINCT FROM '7'::jsonb OR v_value -> 'version' IS DISTINCT FROM '1'::jsonb THEN
    RAISE EXCEPTION 'VERIFY: refundDays/version = % / %', v_value -> 'refundDays', v_value -> 'version';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['checkboxLabel', 'confirmNotice', 'usageScopeNotice', 'downloadPeriodNotice',
                               'detailRefundNotice', 'refundExpiredReason', 'purchaseCompleteNotice'] LOOP
    IF jsonb_typeof(v_value -> v_key) IS DISTINCT FROM 'string'
       OR btrim(v_value ->> v_key) = ''
       OR v_value ->> v_key <> btrim(v_value ->> v_key, E' \t\n\r')
       OR strpos(v_value ->> v_key, chr(13)) > 0
       OR replace(v_value ->> v_key, '{자료환불기간}', '') ~ '[{}]' THEN
      RAISE EXCEPTION 'VERIFY: policy text %', v_key;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['checkboxLabel', 'detailRefundNotice', 'refundExpiredReason'] LOOP
    IF strpos(v_value ->> v_key, '{자료환불기간}') = 0 THEN
      RAISE EXCEPTION 'VERIFY: placeholder missing in %', v_key;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_count FROM jsonb_object_keys(v_value);
  IF v_count <> 9 THEN
    RAISE EXCEPTION 'VERIFY: policy keys = %', v_count;
  END IF;

  -- 5-7. 필요 프로그램: 두 과목 × pdf·hwp·zip 6행 모두 채움
  SELECT count(*) INTO v_count FROM public.market_file_types
   WHERE workspace_subject IN ('korean', 'english') AND code IN ('pdf', 'hwp', 'zip')
     AND required_program IS NOT NULL AND btrim(required_program) <> '';
  IF v_count <> 6 THEN
    RAISE EXCEPTION 'VERIFY: required_program rows = %', v_count;
  END IF;

  -- 5-8. 결제·환불 RPC 는 그대로
  IF md5(pg_get_functiondef('public.checkout_market_selection(uuid,text,uuid,jsonb,uuid)'::regprocedure)) <> '0cda5ff7689d998cc6cf2fd213b0004d' THEN
    RAISE EXCEPTION 'VERIFY: checkout_market_selection changed';
  END IF;
  IF md5(pg_get_functiondef('public.approve_market_refund(uuid,uuid,text,integer)'::regprocedure)) <> '3639ac2383927d33f065012f0c59d1e9' THEN
    RAISE EXCEPTION 'VERIFY: approve_market_refund changed';
  END IF;
END;
$verify_market_purchase_notice$;

NOTIFY pgrst, 'reload schema';
