-- 출시 전 작업 순서표 6번 묶음: 약관 본문 이력(계획 docs/plan-bundle6-terms-revision.md 3판).
-- 배경: 하단 정보의 약관 본문(system_settings.site_footer_content)은 덮어쓰기라 이력이 없고, 동의 기록은 '항목·버전'만 가리켜
--       회원이 동의한 그 당시 약관 본문을 증명할 수 없다. 환불정책처럼 동의 항목에 연결되지 않은 문서는 시행 순서도 남지 않는다.
-- 만드는 것:
--   1. policy_document_snapshots(추가 전용): 약관 문서 본문 사본. 같은 문서의 직전 사본과 본문이 다를 때마다 한 행.
--      UNIQUE 를 두지 않아 예전 본문으로 되돌려 저장해도(A→B→A) 새 행이 남는다 — 언제 어떤 본문이 시행됐는지 시간 순서가 정확하다.
--   2. system_settings 저장 트리거(site_footer_content 행만): 저장 경로(관리자 서버 액션 upsert·SQL)와 무관하게 사본을 남긴다.
--      문서·본문이 문자열이 아니면 그 문서만 건너뛴다(저장은 막지 않음). 사본 기록이 실패하면 저장도 실패한다.
--   3. user_consents.policy_sha256: 동의 제출 시점에 연결 약관 저장 본문의 sha256(hex). 연결 약관이 없는 항목은 NULL.
--   4. consent_record_internal 교체(정의 md5 확인): 위 해시를 함께 적는다. 나머지 규칙은 4번 묶음과 같다.
-- 해시 규칙: encode(sha256(convert_to(content, 'UTF8')), 'hex') — 저장된 원본 문자열 그대로(공백 정리 없음).
-- 권한: 새 표는 RLS 를 켜고 모든 역할 권한을 걷은 뒤 service_role SELECT 만. seq 시퀀스 권한도 걷는다(setval 로 시간 순서가 흔들리지 않게).
--       쓰기는 postgres 소유 SECURITY DEFINER 함수(트리거·동의 기록)로만.
-- 잠금: user_consents ADD COLUMN·CHECK 는 ACCESS EXCLUSIVE(행이 적어 짧음 — 그동안 미들웨어 판정 RPC 가 기다리다 1.5초 뒤 통과),
--       system_settings CREATE TRIGGER 는 SHARE ROW EXCLUSIVE(읽기는 막지 않고 저장만 잠깐 막음). 3초 안에 잡지 못하면 전체 취소.
-- 순서: 코드 배포보다 먼저(새 코드는 새 표·열을 읽는다), 약관 문구 개정보다 먼저(개정 전후 본문이 모두 남게).
-- 되돌리기: supabase/rollback/20261120130000_policy_document_history_down.sql — 코드 배포 뒤에는 되돌리지 말 것(사본·해시가 사라짐).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 0. 4번 묶음의 동의 기록 함수가 그대로인지 확인(다르면 전체 취소)
DO $check_cri$
BEGIN
  IF md5(pg_get_functiondef('public.consent_record_internal(uuid,jsonb,text)'::regprocedure)) <> '5b14ce9ffa188648c781f48e7a8ef2bd' THEN
    RAISE EXCEPTION 'CONSENT_RECORD_INTERNAL_DEFINITION_CHANGED';
  END IF;
END;
$check_cri$;

-- 1. 본문 사본 표 --------------------------------------------------------------------------------------------------
CREATE TABLE public.policy_document_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  doc_key text NOT NULL,
  slug text,
  title text,
  content text NOT NULL,
  content_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT policy_document_snapshots_seq_key UNIQUE (seq),
  CONSTRAINT policy_document_snapshots_sha256_check CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT policy_document_snapshots_hash_matches CHECK (content_sha256 = encode(sha256(convert_to(content, 'UTF8')), 'hex'))
);
CREATE INDEX idx_policy_document_snapshots_doc ON public.policy_document_snapshots (doc_key, seq DESC);
CREATE INDEX idx_policy_document_snapshots_hash ON public.policy_document_snapshots (content_sha256);

CREATE FUNCTION public.prevent_policy_document_snapshot_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_prevent_policy_document_snapshot_mutation$
BEGIN
  RAISE EXCEPTION 'POLICY_DOCUMENT_SNAPSHOTS_APPEND_ONLY';
END;
$fn_prevent_policy_document_snapshot_mutation$;

CREATE TRIGGER prevent_policy_document_snapshot_mutation
  BEFORE UPDATE OR DELETE ON public.policy_document_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.prevent_policy_document_snapshot_mutation();
CREATE TRIGGER prevent_policy_document_snapshot_truncate
  BEFORE TRUNCATE ON public.policy_document_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_policy_document_snapshot_mutation();

ALTER TABLE public.policy_document_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.policy_document_snapshots FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.policy_document_snapshots_seq_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.policy_document_snapshots TO service_role;

-- 2. 저장 트리거 ----------------------------------------------------------------------------------------------------
CREATE FUNCTION public.record_policy_document_snapshots()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_record_policy_document_snapshots$
DECLARE
  v_doc record;
  v_hash text;
  v_latest text;
BEGIN
  IF jsonb_typeof(NEW.value -> 'policyDocuments') IS DISTINCT FROM 'object' THEN
    RETURN NULL;
  END IF;
  FOR v_doc IN SELECT d.key AS doc_key, d.value AS doc FROM jsonb_each(NEW.value -> 'policyDocuments') AS d LOOP
    IF jsonb_typeof(v_doc.doc) IS DISTINCT FROM 'object' THEN
      CONTINUE;
    END IF;
    IF jsonb_typeof(v_doc.doc -> 'content') IS DISTINCT FROM 'string' THEN
      CONTINUE;
    END IF;
    v_hash := encode(sha256(convert_to(v_doc.doc ->> 'content', 'UTF8')), 'hex');
    SELECT p.content_sha256 INTO v_latest
      FROM public.policy_document_snapshots p
     WHERE p.doc_key = v_doc.doc_key
     ORDER BY p.seq DESC
     LIMIT 1;
    IF v_latest IS DISTINCT FROM v_hash THEN
      INSERT INTO public.policy_document_snapshots (doc_key, slug, title, content, content_sha256)
      VALUES (v_doc.doc_key, v_doc.doc ->> 'slug', v_doc.doc ->> 'title', v_doc.doc ->> 'content', v_hash);
    END IF;
  END LOOP;
  RETURN NULL;
END;
$fn_record_policy_document_snapshots$;

CREATE TRIGGER record_policy_document_snapshots
  AFTER INSERT OR UPDATE ON public.system_settings
  FOR EACH ROW
  WHEN (NEW.key = 'site_footer_content')
  EXECUTE FUNCTION public.record_policy_document_snapshots();

REVOKE ALL ON FUNCTION public.prevent_policy_document_snapshot_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_policy_document_snapshots() FROM PUBLIC, anon, authenticated, service_role;

-- 지금 본문을 첫 사본으로 남긴다(트리거를 그대로 태운다).
UPDATE public.system_settings SET value = value WHERE key = 'site_footer_content';

-- 3. 동의 기록에 본문 지문 ------------------------------------------------------------------------------------------
ALTER TABLE public.user_consents ADD COLUMN policy_sha256 text;
ALTER TABLE public.user_consents
  ADD CONSTRAINT user_consents_policy_sha256_check CHECK (policy_sha256 IS NULL OR policy_sha256 ~ '^[0-9a-f]{64}$');

-- 4. 동의 기록 함수 교체(4번 정의 + 본문 지문). SECURITY DEFINER·search_path 를 다시 명시한다.
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
$fn_consent_record_internal$;

REVOKE ALL ON FUNCTION public.consent_record_internal(uuid, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;

-- 5. VERIFY ---------------------------------------------------------------------------------------------------------
DO $verify_policy_history$
DECLARE
  v_text text;
  v_count integer;
  v_acl text;
BEGIN
  SELECT string_agg(format('%s:%s', grantee, privilege_type), ', ') INTO v_text
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'policy_document_snapshots'
     AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
     AND NOT (grantee = 'service_role' AND privilege_type = 'SELECT');
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: unexpected grants: %', v_text;
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.policy_document_snapshots'::regclass) THEN
    RAISE EXCEPTION 'VERIFY: RLS off';
  END IF;
  SELECT c.relacl::text INTO v_acl FROM pg_class c WHERE c.oid = 'public.policy_document_snapshots_seq_seq'::regclass;
  IF v_acl IS NOT NULL AND v_acl ~ '(anon|authenticated|service_role)=' THEN
    RAISE EXCEPTION 'VERIFY: sequence grants: %', v_acl;
  END IF;
  SELECT count(*) INTO v_count FROM pg_trigger
   WHERE tgrelid = 'public.policy_document_snapshots'::regclass AND NOT tgisinternal;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'VERIFY: append-only triggers = %', v_count;
  END IF;

  -- (3a) PUBLIC/anon 이 실행할 수 있는 SECURITY DEFINER 함수는 handle_new_user 뿐
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_text
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.prosecdef
     AND (p.proacl IS NULL OR p.proacl::text ~ '(\{|,)(=|anon=)X')
     AND p.proname <> 'handle_new_user';
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: public/anon executable definer functions: %', v_text;
  END IF;

  FOREACH v_text IN ARRAY ARRAY['public.record_policy_document_snapshots()', 'public.consent_record_internal(uuid,jsonb,text)'] LOOP
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = v_text::regprocedure) IS DISTINCT FROM '{postgres=X/postgres}'
       OR NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_text::regprocedure)
       OR (SELECT p.proconfig FROM pg_proc p WHERE p.oid = v_text::regprocedure) IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
      RAISE EXCEPTION 'VERIFY: function % acl/definer/search_path', v_text;
    END IF;
  END LOOP;

  -- 첫 사본: 지금 문서 수와 같고, 해시가 원본에서 다시 계산한 값과 같다
  SELECT count(*) INTO v_count
    FROM public.system_settings s, jsonb_each(s.value -> 'policyDocuments') AS d
   WHERE s.key = 'site_footer_content' AND jsonb_typeof(d.value -> 'content') = 'string'
     AND NOT EXISTS (
       SELECT 1 FROM public.policy_document_snapshots p
        WHERE p.doc_key = d.key AND p.content_sha256 = encode(sha256(convert_to(d.value ->> 'content', 'UTF8')), 'hex')
     );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'VERIFY: missing first snapshots = %', v_count;
  END IF;
  IF (SELECT count(*) FROM public.policy_document_snapshots) < 3 THEN
    RAISE EXCEPTION 'VERIFY: snapshots < 3';
  END IF;

  -- 동의 기록의 지문은 모두 사본이 있다
  SELECT count(*) INTO v_count FROM public.user_consents c
   WHERE c.policy_sha256 IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.policy_document_snapshots p WHERE p.content_sha256 = c.policy_sha256);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'VERIFY: consent hashes without snapshot = %', v_count;
  END IF;
END;
$verify_policy_history$;

NOTIFY pgrst, 'reload schema';
