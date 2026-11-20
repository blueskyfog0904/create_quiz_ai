-- 출시 전 작업 순서표 4번 묶음: 회원가입 약관 동의와 동의 기록(계획 docs/plan-bundle4-signup-consent.md 18판).
-- 배경: 지금은 가입 때 약관 동의를 받지도, 기록하지도 않는다. 필수(이용약관·개인정보 수집·이용·만 14세 이상)와
--       선택(마케팅 수신) 항목을 관리자가 관리하고, 누가 어느 항목의 어느 버전에 언제 동의했는지 남긴다.
-- 이 파일은 추가만 한다(새 표·함수·설정 1행·system_settings 정책 2개). 옛 코드는 새 표를 읽지 않으므로 적용해도 지금 동작은 그대로다.
--   단, system_settings 의 site_footer_content 행은 이 파일 뒤로 화면 세션(authenticated)으로 고칠 수 없다(서버 키 저장만 — 운영은 이미 서버 키).
-- 만드는 것:
--   0. 공용 함수: consent_normalize_text(공백 규칙 — 코드 src/lib/consent-text.ts 와 같은 문자 목록), is_internal_admin_account(관리자 ID 판정 —
--      코드 ADMIN_ACCOUNT_EMAIL_DOMAIN 과 같은 도메인. 도메인을 바꾸면 이 함수도 함께 바꾼다).
--   1. signup_consent_items(현재 상태), signup_consent_item_versions(버전별 원문, 추가만), user_consents(동의 기록, 추가만).
--      user_consents 는 탈퇴 연쇄 삭제(부모 profiles 가 지워진 뒤)만 허용한다. 결제 회원은 payment_orders RESTRICT 로 profiles 가 남아 기록도 남는다.
--   2. 권한: 세 표 모두 RLS 를 켜고 anon·authenticated·service_role 의 권한을 걷은 뒤 service_role 에 SELECT 만 준다(선례 admin_audit_log).
--      쓰기는 아래 SECURITY DEFINER 함수(소유자 postgres)로만 한다.
--   3. 함수: consent_missing_required / consent_items_error / consent_latest_results / consent_record_internal(내부, 실행 권한 없음),
--      record_user_consents / consent_validate_submission / save_signup_consent_item / revise_signup_consent_item /
--      cancel_incomplete_kakao_signup / signup_consent_item_stats / complete_kakao_signup_with_consents(service_role),
--      get_my_missing_required_consents(authenticated).
--   4. 첫 값: 항목 4개(terms·privacy·age14·marketing)와 버전 1 원문, system_settings 'signup_consent_texts'(화면 안내 문구).
--   5. system_settings RESTRICTIVE FOR UPDATE 정책 2개(signup_consent_texts·site_footer_content — 세션 직접 쓰기 차단).
-- 잠금 순서(교착 방지): 회원 advisory('public.user_consents:'||회원) → 항목 쓰기 advisory('public.signup_consent_items:write', 기록은 공유·저장은 배타)
--                       → profiles 행. 저장·개정은 항목 쓰기 배타 → 행위자 profiles FOR SHARE → 항목 행 FOR UPDATE.
-- 예외 이름: CONSENT_INPUT_INVALID / CONSENT_ITEM_CHANGED / CONSENT_REQUIRED_MISSING / CONSENT_MYPAGE_REQUIRED_ITEM / CONSENT_PROFILE_MISSING
--            / CONSENT_KAKAO_SIGNUP_INCOMPLETE / CONSENT_KAKAO_NOT_KAKAO / CONSENT_AUTH_REQUIRED / CONSENT_ITEM_ACTOR_NOT_OWNER
--            / CONSENT_ITEM_NOT_FOUND / CONSENT_ITEM_VERSION_CONFLICT / CONSENT_ITEM_LOCKED / CONSENT_OPTIONAL_ITEM_IN_USE
--            / CONSENT_NOTE_REQUIRED / CONSENT_NO_REQUIRED_ITEM / CONSENT_REVISE_NOT_ALLOWED / USER_CONSENTS_APPEND_ONLY
--            / SIGNUP_CONSENT_ITEM_VERSIONS_APPEND_ONLY / SIGNUP_CONSENT_ITEM_IMMUTABLE_FIELD
-- 잠금: system_settings 에 정책을 더하며 ACCESS EXCLUSIVE 를 잡고 커밋까지 유지한다(그동안 이 표를 읽는 페이지 렌더가 잠깐 기다린다).
--       user_consents → profiles FK 를 만들며 profiles 에 SHARE ROW EXCLUSIVE 를 잡는다(그동안 가입·프로필 쓰기가 잠깐 기다린다).
--       잡지 못하면 최대 3초 대기 뒤 전체 취소.
-- 순서: 코드 배포보다 먼저 적용한다(새 코드는 새 함수를 부른다). 적용 전에 대표가 첫 값 문구(4번)를 확인한다.
-- 되돌리기: supabase/rollback/20261120120000_signup_consents_down.sql — 코드 배포 뒤에는 되돌리지 말 것(동의 기록 = 법적 증빙).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 0. 공용 함수 -----------------------------------------------------------------------------------------------------
-- 공백 규칙: CRLF→LF 뒤 앞뒤의 공백 문자(아래 목록)를 지운다. 로케일에 기대지 않도록 문자를 직접 적는다.
CREATE FUNCTION public.consent_normalize_text(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $fn_consent_normalize_text$
  SELECT regexp_replace(
    replace(COALESCE(p_value, ''), E'\r\n', E'\n'),
    '^[ \t\n\r\v\f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[ \t\n\r\v\f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
    '',
    'g'
  )
$fn_consent_normalize_text$;

-- 관리자 ID 계정 = 이메일이 내부 도메인. NULL·빈 값이면 회원.
CREATE FUNCTION public.is_internal_admin_account(p_email text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $fn_is_internal_admin_account$
  SELECT COALESCE(
    right(lower(public.consent_normalize_text(p_email)), length('@admin.summersun.local')) = '@admin.summersun.local',
    false
  )
$fn_is_internal_admin_account$;

-- 1. 표 ---------------------------------------------------------------------------------------------------------
CREATE TABLE public.signup_consent_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  label text NOT NULL,
  content text NOT NULL DEFAULT '',
  required boolean NOT NULL,
  policy_slug text,
  required_lock boolean,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT signup_consent_items_label_check CHECK (
    public.consent_normalize_text(label) <> ''
    AND char_length(label) <= 100
    AND label !~ '^[[:space:]]*\[(필수|선택)\]'
  ),
  CONSTRAINT signup_consent_items_required_content_check CHECK (NOT required OR public.consent_normalize_text(content) <> ''),
  CONSTRAINT signup_consent_items_lock_required_check CHECK (required_lock IS NULL OR required = required_lock),
  CONSTRAINT signup_consent_items_lock_active_check CHECK (NOT (required_lock IS TRUE AND NOT is_active)),
  CONSTRAINT signup_consent_items_policy_slug_check CHECK (policy_slug IS NULL OR policy_slug <> ''),
  CONSTRAINT signup_consent_items_version_check CHECK (version >= 1),
  CONSTRAINT signup_consent_items_id_version_key UNIQUE (id, version)
);

CREATE TABLE public.signup_consent_item_versions (
  item_id uuid NOT NULL REFERENCES public.signup_consent_items(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  label text NOT NULL,
  content text NOT NULL,
  required boolean NOT NULL,
  policy_slug text,
  note text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (item_id, version)
);

-- 현재 상태(id, version)의 버전 원문이 반드시 있다(커밋 때 확인 — 버전 원문 없이 version 만 올리는 일을 DB 가 막는다).
ALTER TABLE public.signup_consent_items
  ADD CONSTRAINT signup_consent_items_current_version_fkey
  FOREIGN KEY (id, version) REFERENCES public.signup_consent_item_versions(item_id, version)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.user_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  item_version integer NOT NULL,
  agreed boolean NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT user_consents_item_version_fkey FOREIGN KEY (item_id, item_version)
    REFERENCES public.signup_consent_item_versions(item_id, version) ON DELETE RESTRICT,
  CONSTRAINT user_consents_source_check CHECK (source IN ('email_signup', 'kakao_signup', 'consent_gate', 'mypage')),
  CONSTRAINT user_consents_seq_key UNIQUE (seq)
);

CREATE INDEX idx_user_consents_latest ON public.user_consents (user_id, item_id, item_version, seq DESC);
CREATE INDEX idx_user_consents_user_item ON public.user_consents (user_id, item_id, seq DESC);
CREATE INDEX idx_user_consents_item_version ON public.user_consents (item_id, item_version);

-- 1-1. 바꿀 수 없는 칸·추가만 하는 표 -------------------------------------------------------------------------------
CREATE FUNCTION public.guard_signup_consent_item_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_signup_consent_item_update$
BEGIN
  IF NEW.key IS DISTINCT FROM OLD.key
     OR NEW.required_lock IS DISTINCT FROM OLD.required_lock
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.version NOT IN (OLD.version, OLD.version + 1) THEN
    RAISE EXCEPTION 'SIGNUP_CONSENT_ITEM_IMMUTABLE_FIELD';
  END IF;
  RETURN NEW;
END;
$fn_guard_signup_consent_item_update$;

CREATE TRIGGER guard_signup_consent_item_update
  BEFORE UPDATE ON public.signup_consent_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_signup_consent_item_update();

CREATE FUNCTION public.prevent_signup_consent_item_version_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_prevent_signup_consent_item_version_mutation$
BEGIN
  RAISE EXCEPTION 'SIGNUP_CONSENT_ITEM_VERSIONS_APPEND_ONLY';
END;
$fn_prevent_signup_consent_item_version_mutation$;

CREATE TRIGGER prevent_signup_consent_item_version_mutation
  BEFORE UPDATE OR DELETE ON public.signup_consent_item_versions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_signup_consent_item_version_mutation();

CREATE TRIGGER prevent_signup_consent_item_version_truncate
  BEFORE TRUNCATE ON public.signup_consent_item_versions
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_signup_consent_item_version_mutation();

CREATE TRIGGER prevent_signup_consent_item_truncate
  BEFORE TRUNCATE ON public.signup_consent_items
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_signup_consent_item_version_mutation();

-- UPDATE·TRUNCATE 는 늘 거부. DELETE 는 부모 profiles 행이 이미 없을 때(탈퇴 연쇄 삭제)만 허용.
-- 연쇄 삭제는 이 표 소유자(postgres) 권한으로 실행되므로 DEFINER 가 아니어도 profiles 를 읽을 수 있다. VOLATILE(기본값)이라 지워진 부모를 본다.
CREATE FUNCTION public.guard_user_consents_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_user_consents_mutation$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id) THEN
      RAISE EXCEPTION 'USER_CONSENTS_APPEND_ONLY';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'USER_CONSENTS_APPEND_ONLY';
END;
$fn_guard_user_consents_mutation$;

CREATE TRIGGER guard_user_consents_mutation
  BEFORE UPDATE OR DELETE ON public.user_consents
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_consents_mutation();

CREATE TRIGGER guard_user_consents_truncate
  BEFORE TRUNCATE ON public.user_consents
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_user_consents_mutation();

-- 2. 표 권한 -----------------------------------------------------------------------------------------------------
ALTER TABLE public.signup_consent_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signup_consent_item_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.signup_consent_items FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.signup_consent_item_versions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.user_consents FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.user_consents_seq_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.signup_consent_items TO service_role;
GRANT SELECT ON TABLE public.signup_consent_item_versions TO service_role;
GRANT SELECT ON TABLE public.user_consents TO service_role;

-- 3. 함수 -------------------------------------------------------------------------------------------------------
-- 3-1. 활성 필수 항목 중 "이번 제출에서 현재 version 으로 agreed=true 도 아니고, 현재 version 의 최신(seq) 기록도 agreed=true 가 아닌" 항목.
CREATE FUNCTION public.consent_missing_required(p_user_id uuid, p_submitted jsonb DEFAULT '[]'::jsonb)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_consent_missing_required$
  SELECT i.id
    FROM public.signup_consent_items i
   WHERE i.is_active AND i.required
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_submitted) = 'array' THEN p_submitted ELSE '[]'::jsonb END) AS s
        WHERE s ->> 'item_id' = i.id::text
          AND s -> 'version' = to_jsonb(i.version)
          AND s -> 'agreed' = 'true'::jsonb
     )
     AND COALESCE((
       SELECT c.agreed
         FROM public.user_consents c
        WHERE c.user_id = p_user_id AND c.item_id = i.id AND c.item_version = i.version
        ORDER BY c.seq DESC
        LIMIT 1
     ), false) IS NOT TRUE
   ORDER BY i.sort_order, i.created_at
$fn_consent_missing_required$;

-- 3-2. 제출 형식·버전·필수 거부 검사(회원 기록 없이 제출만 본다). 문제없으면 NULL.
CREATE FUNCTION public.consent_items_error(p_items jsonb, p_source text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_consent_items_error$
DECLARE
  v_elem jsonb;
  v_item public.signup_consent_items%ROWTYPE;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0
     OR jsonb_array_length(p_items) > 50 THEN
    RETURN 'CONSENT_INPUT_INVALID';
  END IF;

  -- 형 검사를 먼저 끝낸 뒤에 값을 바꾼다(OR 계산 순서에 기대지 않는다).
  FOR v_elem IN SELECT e FROM jsonb_array_elements(p_items) AS e LOOP
    IF jsonb_typeof(v_elem) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_elem -> 'item_id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_elem -> 'version') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_elem -> 'agreed') IS DISTINCT FROM 'boolean' THEN
      RETURN 'CONSENT_INPUT_INVALID';
    END IF;
    IF (v_elem ->> 'item_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      RETURN 'CONSENT_INPUT_INVALID';
    END IF;
    IF (v_elem ->> 'version')::numeric <> trunc((v_elem ->> 'version')::numeric)
       OR (v_elem ->> 'version')::numeric < 1
       OR (v_elem ->> 'version')::numeric > 2147483647 THEN
      RETURN 'CONSENT_INPUT_INVALID';
    END IF;
  END LOOP;

  IF (SELECT count(DISTINCT lower(e ->> 'item_id')) <> count(*) FROM jsonb_array_elements(p_items) AS e) THEN
    RETURN 'CONSENT_INPUT_INVALID';
  END IF;

  FOR v_elem IN SELECT e FROM jsonb_array_elements(p_items) AS e LOOP
    SELECT * INTO v_item FROM public.signup_consent_items i WHERE i.id = (v_elem ->> 'item_id')::uuid;
    IF NOT FOUND THEN
      RETURN 'CONSENT_ITEM_CHANGED';
    END IF;

    IF p_source = 'mypage' THEN
      IF v_item.required THEN
        RETURN 'CONSENT_MYPAGE_REQUIRED_ITEM';
      END IF;
      -- 철회(agreed=false)는 숨긴 항목에도 받는다(현재 version 으로 기록). 동의는 보이는 현재 버전에만.
      IF (v_elem -> 'agreed') = 'true'::jsonb
         AND (NOT v_item.is_active OR (v_elem ->> 'version')::integer <> v_item.version) THEN
        RETURN 'CONSENT_ITEM_CHANGED';
      END IF;
    ELSE
      IF NOT v_item.is_active OR (v_elem ->> 'version')::integer <> v_item.version THEN
        RETURN 'CONSENT_ITEM_CHANGED';
      END IF;
      IF v_item.required AND (v_elem -> 'agreed') <> 'true'::jsonb THEN
        RETURN 'CONSENT_REQUIRED_MISSING';
      END IF;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$fn_consent_items_error$;

-- 3-3. 회원의 항목별 최신(seq, 버전 무관) 기록.
CREATE FUNCTION public.consent_latest_results(p_user_id uuid, p_item_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_consent_latest_results$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'item_id', l.item_id,
           'item_version', l.item_version,
           'agreed', l.agreed,
           'created_at', l.created_at
         ) ORDER BY l.item_id), '[]'::jsonb)
    FROM (
      SELECT DISTINCT ON (c.item_id) c.item_id, c.item_version, c.agreed, c.created_at
        FROM public.user_consents c
       WHERE c.user_id = p_user_id AND c.item_id = ANY (p_item_ids)
       ORDER BY c.item_id, c.seq DESC
    ) AS l
$fn_consent_latest_results$;

-- 3-4. 실제 기록(내부). 기록·카카오 완료·가입 취소가 같은 잠금 순서를 쓴다. 결과는 제출 항목별 최신 기록(건너뛴 항목 포함).
CREATE FUNCTION public.consent_record_internal(p_user_id uuid, p_items jsonb, p_source text)
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

-- 3-5. 서버(service_role)가 부르는 기록. 카카오 가입 출처는 카카오 완료 함수 안에서만 생긴다.
CREATE FUNCTION public.record_user_consents(p_user_id uuid, p_items jsonb, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_record_user_consents$
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('email_signup', 'consent_gate', 'mypage') THEN
    RAISE EXCEPTION 'CONSENT_INPUT_INVALID';
  END IF;
  RETURN public.consent_record_internal(p_user_id, p_items, p_source);
END;
$fn_record_user_consents$;

-- 3-6. 이메일 가입 사전 검사(계정을 만들기 전에). 형식·버전·필수를 record 와 같은 규칙으로. 문제없으면 NULL.
CREATE FUNCTION public.consent_validate_submission(p_items jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_consent_validate_submission$
DECLARE
  v_error text;
BEGIN
  v_error := public.consent_items_error(p_items, 'email_signup');
  IF v_error IS NOT NULL THEN
    RETURN v_error;
  END IF;
  IF EXISTS (SELECT 1 FROM public.consent_missing_required(NULL, p_items)) THEN
    RETURN 'CONSENT_REQUIRED_MISSING';
  END IF;
  RETURN NULL;
END;
$fn_consent_validate_submission$;

-- 3-7. 로그인 회원 본인의 부족한 필수 항목(미들웨어·동의 화면·돈 API 판정). 관리자 ID 계정은 빈 결과.
CREATE FUNCTION public.get_my_missing_required_consents()
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_get_my_missing_required_consents$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'CONSENT_AUTH_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user_id) THEN
    RAISE EXCEPTION 'CONSENT_PROFILE_MISSING';
  END IF;
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_user_id;
  IF public.is_internal_admin_account(v_email) THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT m FROM public.consent_missing_required(v_user_id, '[]'::jsonb) AS m;
END;
$fn_get_my_missing_required_consents$;

-- 3-8. 재동의 영향 회원 수: 로그인할 수 있는 회원(이메일 인증, 카카오는 가입 완료) 중 관리자 ID 가 아닌 회원.
CREATE FUNCTION public.consent_eligible_member_count()
 RETURNS integer
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_consent_eligible_member_count$
  SELECT count(*)::integer
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
   WHERE NOT public.is_internal_admin_account(u.email)
     AND (
       (p.provider = 'kakao' AND p.signup_completed IS TRUE)
       OR (p.provider IS DISTINCT FROM 'kakao' AND u.email_confirmed_at IS NOT NULL)
     )
$fn_consent_eligible_member_count$;

-- 3-9. 항목 저장(대표 전용). 인자 12개.
CREATE FUNCTION public.save_signup_consent_item(
  p_actor_id uuid,
  p_id uuid,
  p_expected_version integer,
  p_label text,
  p_content text,
  p_required boolean,
  p_policy_slug text,
  p_sort_order integer,
  p_is_active boolean,
  p_note text,
  p_expected_updated_at timestamptz,
  p_dry_run boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_save_signup_consent_item$
DECLARE
  v_old public.signup_consent_items%ROWTYPE;
  v_label text := public.consent_normalize_text(p_label);
  v_content text := public.consent_normalize_text(p_content);
  v_slug text := NULLIF(public.consent_normalize_text(p_policy_slug), '');
  v_note text := NULLIF(public.consent_normalize_text(p_note), '');
  v_is_new boolean := p_id IS NULL;
  v_is_active boolean := p_is_active;
  v_changed text[] := ARRAY[]::text[];
  v_text_changed boolean := false;
  v_bump boolean := false;
  v_reconsent boolean := false;
  v_required_after integer;
  v_affected integer := 0;
  v_id uuid;
  v_after_version integer;
  v_updated_at timestamptz;
BEGIN
  IF p_actor_id IS NULL OR p_required IS NULL OR p_sort_order IS NULL OR p_is_active IS NULL
     OR v_label = '' OR char_length(v_label) > 100
     OR (NOT v_is_new AND (p_expected_version IS NULL OR p_expected_updated_at IS NULL)) THEN
    RAISE EXCEPTION 'CONSENT_INPUT_INVALID';
  END IF;

  -- ① 항목 쓰기 배타 ② 행위자(대표) ③ 항목 행
  PERFORM pg_advisory_xact_lock(hashtextextended('public.signup_consent_items:write', 0));

  PERFORM 1 FROM public.profiles p
   WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.admin_role = 'owner'
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONSENT_ITEM_ACTOR_NOT_OWNER';
  END IF;

  IF v_is_new THEN
    -- 새 항목은 숨김으로 만들어 미리 본 뒤 켠다.
    v_is_active := false;
    v_changed := ARRAY['label', 'content', 'required', 'policy_slug', 'sort_order', 'is_active'];
  ELSE
    SELECT * INTO v_old FROM public.signup_consent_items i WHERE i.id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CONSENT_ITEM_NOT_FOUND';
    END IF;
    IF v_old.version <> p_expected_version OR v_old.updated_at <> p_expected_updated_at THEN
      RAISE EXCEPTION 'CONSENT_ITEM_VERSION_CONFLICT';
    END IF;

    IF public.consent_normalize_text(v_old.label) <> v_label THEN v_changed := array_append(v_changed, 'label'); END IF;
    IF public.consent_normalize_text(v_old.content) <> v_content THEN v_changed := array_append(v_changed, 'content'); END IF;
    IF v_old.required <> p_required THEN v_changed := array_append(v_changed, 'required'); END IF;
    IF v_old.policy_slug IS DISTINCT FROM v_slug THEN v_changed := array_append(v_changed, 'policy_slug'); END IF;
    IF v_old.sort_order <> p_sort_order THEN v_changed := array_append(v_changed, 'sort_order'); END IF;
    IF v_old.is_active <> p_is_active THEN v_changed := array_append(v_changed, 'is_active'); END IF;

    v_text_changed := v_changed && ARRAY['label', 'content', 'required', 'policy_slug'];

    IF (v_old.required_lock IS TRUE AND (NOT p_required OR NOT p_is_active))
       OR (v_old.required_lock IS FALSE AND p_required) THEN
      RAISE EXCEPTION 'CONSENT_ITEM_LOCKED';
    END IF;

    -- 동의 기록이 있는 선택 항목은 문구·연결 약관을 바꾸지 않는다(새 항목을 만들고 이 항목을 숨긴다).
    IF NOT v_old.required
       AND v_changed && ARRAY['label', 'content', 'policy_slug']
       AND EXISTS (SELECT 1 FROM public.user_consents c WHERE c.item_id = p_id) THEN
      RAISE EXCEPTION 'CONSENT_OPTIONAL_ITEM_IN_USE';
    END IF;

    v_bump := v_text_changed OR (p_required AND p_is_active AND NOT v_old.is_active);
    -- 회원이 다시 동의해야 하는 저장: 저장 뒤 활성 필수 (id, version) 쌍 중 저장 전에 없던 것이 생긴다.
    v_reconsent := p_is_active AND p_required AND (v_bump OR NOT (v_old.is_active AND v_old.required));
  END IF;

  IF p_required AND v_content = '' THEN
    RAISE EXCEPTION 'CONSENT_INPUT_INVALID';
  END IF;

  SELECT count(*)::integer + CASE WHEN v_is_active AND p_required THEN 1 ELSE 0 END
    INTO v_required_after
    FROM public.signup_consent_items i
   WHERE i.is_active AND i.required AND (v_is_new OR i.id <> p_id);
  IF v_required_after < 1 THEN
    RAISE EXCEPTION 'CONSENT_NO_REQUIRED_ITEM';
  END IF;

  IF v_reconsent THEN
    v_affected := public.consent_eligible_member_count();
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'dry_run', true,
      'id', p_id,
      'before_version', CASE WHEN v_is_new THEN NULL ELSE v_old.version END,
      'after_version', CASE WHEN v_is_new THEN 1 ELSE v_old.version + CASE WHEN v_bump THEN 1 ELSE 0 END END,
      'version_bump', v_bump,
      'reconsent', v_reconsent,
      'affected_members', v_affected,
      'changed_fields', to_jsonb(v_changed)
    );
  END IF;

  IF v_reconsent AND v_note IS NULL THEN
    RAISE EXCEPTION 'CONSENT_NOTE_REQUIRED';
  END IF;

  IF v_is_new THEN
    INSERT INTO public.signup_consent_items (label, content, required, policy_slug, sort_order, is_active, version)
    VALUES (v_label, v_content, p_required, v_slug, p_sort_order, false, 1)
    RETURNING id, version, updated_at INTO v_id, v_after_version, v_updated_at;
    INSERT INTO public.signup_consent_item_versions (item_id, version, label, content, required, policy_slug, note)
    VALUES (v_id, 1, v_label, v_content, p_required, v_slug, v_note);
  ELSIF cardinality(v_changed) = 0 THEN
    -- 바뀐 칸이 없으면(중복 제출) 버전 원문·작업 기록을 건너뛴다.
    RETURN jsonb_build_object(
      'dry_run', false, 'changed', false, 'id', p_id,
      'before_version', v_old.version, 'after_version', v_old.version,
      'version_bump', false, 'reconsent', false, 'changed_fields', '[]'::jsonb,
      'updated_at', v_old.updated_at
    );
  ELSE
    UPDATE public.signup_consent_items
       SET label = v_label,
           content = v_content,
           required = p_required,
           policy_slug = v_slug,
           sort_order = p_sort_order,
           is_active = p_is_active,
           version = version + CASE WHEN v_bump THEN 1 ELSE 0 END,
           updated_at = clock_timestamp()
     WHERE id = p_id AND version = p_expected_version
    RETURNING id, version, updated_at INTO v_id, v_after_version, v_updated_at;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CONSENT_ITEM_VERSION_CONFLICT';
    END IF;
    IF v_bump THEN
      INSERT INTO public.signup_consent_item_versions (item_id, version, label, content, required, policy_slug, note)
      VALUES (v_id, v_after_version, v_label, v_content, p_required, v_slug, v_note);
    END IF;
  END IF;

  PERFORM public.record_admin_audit(
    p_actor_id,
    'signup_consent_item_save',
    'signup_consent_item',
    v_id::text,
    NULL,
    NULL,
    NULL,
    jsonb_build_object(
      'label', v_label,
      'before_version', CASE WHEN v_is_new THEN NULL ELSE v_old.version END,
      'after_version', v_after_version,
      'changed_fields', to_jsonb(v_changed),
      'reconsent', v_reconsent,
      'note', v_note
    ),
    NULL
  );

  RETURN jsonb_build_object(
    'dry_run', false,
    'changed', true,
    'id', v_id,
    'before_version', CASE WHEN v_is_new THEN NULL ELSE v_old.version END,
    'after_version', v_after_version,
    'version_bump', v_bump,
    'reconsent', v_reconsent,
    'changed_fields', to_jsonb(v_changed),
    'updated_at', v_updated_at
  );
END;
$fn_save_signup_consent_item$;

-- 3-10. 개정(연결 약관 본문을 바꿨을 때 — 연결 약관이 있는 활성 필수 항목만). 사유(회원에게 보이는 변경 안내) 필수.
CREATE FUNCTION public.revise_signup_consent_item(
  p_actor_id uuid,
  p_id uuid,
  p_expected_version integer,
  p_note text,
  p_dry_run boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_revise_signup_consent_item$
DECLARE
  v_old public.signup_consent_items%ROWTYPE;
  v_note text := NULLIF(public.consent_normalize_text(p_note), '');
  v_after_version integer;
  v_updated_at timestamptz;
BEGIN
  IF p_actor_id IS NULL OR p_id IS NULL OR p_expected_version IS NULL THEN
    RAISE EXCEPTION 'CONSENT_INPUT_INVALID';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('public.signup_consent_items:write', 0));

  PERFORM 1 FROM public.profiles p
   WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.admin_role = 'owner'
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONSENT_ITEM_ACTOR_NOT_OWNER';
  END IF;

  SELECT * INTO v_old FROM public.signup_consent_items i WHERE i.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONSENT_ITEM_NOT_FOUND';
  END IF;
  IF NOT (v_old.required AND v_old.is_active AND v_old.policy_slug IS NOT NULL) THEN
    RAISE EXCEPTION 'CONSENT_REVISE_NOT_ALLOWED';
  END IF;
  IF v_old.version <> p_expected_version THEN
    RAISE EXCEPTION 'CONSENT_ITEM_VERSION_CONFLICT';
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'dry_run', true, 'id', p_id,
      'before_version', v_old.version, 'after_version', v_old.version + 1,
      'version_bump', true, 'reconsent', true,
      'affected_members', public.consent_eligible_member_count(),
      'changed_fields', '[]'::jsonb
    );
  END IF;

  IF v_note IS NULL THEN
    RAISE EXCEPTION 'CONSENT_NOTE_REQUIRED';
  END IF;

  UPDATE public.signup_consent_items
     SET version = version + 1,
         updated_at = clock_timestamp()
   WHERE id = p_id AND version = p_expected_version
  RETURNING version, updated_at INTO v_after_version, v_updated_at;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONSENT_ITEM_VERSION_CONFLICT';
  END IF;

  INSERT INTO public.signup_consent_item_versions (item_id, version, label, content, required, policy_slug, note)
  VALUES (p_id, v_after_version, v_old.label, v_old.content, v_old.required, v_old.policy_slug, v_note);

  PERFORM public.record_admin_audit(
    p_actor_id,
    'signup_consent_item_revise',
    'signup_consent_item',
    p_id::text,
    NULL,
    NULL,
    v_note,
    jsonb_build_object('label', v_old.label, 'before_version', v_old.version, 'after_version', v_after_version),
    NULL
  );

  RETURN jsonb_build_object(
    'dry_run', false, 'changed', true, 'id', p_id,
    'before_version', v_old.version, 'after_version', v_after_version,
    'version_bump', true, 'reconsent', true, 'changed_fields', '[]'::jsonb,
    'updated_at', v_updated_at
  );
END;
$fn_revise_signup_consent_item$;

-- 3-11. 카카오 가입 취소(가입을 마치지 않았고 결제 기록이 없을 때만). 통과하면 탈퇴 route 와 같은 사전 삭제를 하고 true.
--       실제 계정 삭제는 서버가 같은 요청 안에서 auth admin deleteUser 로 한다.
CREATE FUNCTION public.cancel_incomplete_kakao_signup(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_cancel_incomplete_kakao_signup$
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
$fn_cancel_incomplete_kakao_signup$;

-- 3-12. 관리 화면 표: 항목별 '현재 version 의 최신(seq) 기록이 동의인 회원 수'(관리자 ID 제외).
CREATE FUNCTION public.signup_consent_item_stats()
 RETURNS TABLE(item_id uuid, version integer, agreed_members integer)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_signup_consent_item_stats$
  SELECT i.id, i.version, (
    SELECT count(*)::integer
      FROM (
        SELECT DISTINCT ON (c.user_id) c.user_id, c.agreed
          FROM public.user_consents c
         WHERE c.item_id = i.id AND c.item_version = i.version
         ORDER BY c.user_id, c.seq DESC
      ) AS l
      JOIN auth.users u ON u.id = l.user_id
     WHERE l.agreed AND NOT public.is_internal_admin_account(u.email)
  )
    FROM public.signup_consent_items i
   ORDER BY i.sort_order, i.created_at
$fn_signup_consent_item_stats$;

-- 3-13. 카카오 가입 완료(동의 기록 + 프로필 갱신을 한 트랜잭션으로). 이미 완료면 아무것도 바꾸지 않는다.
--       결과: 프로필과 선택 항목별 최신 기록(새로 완료·이미 완료 모두 DB 값 — 처리 결과 안내는 이 값으로만 만든다).
CREATE FUNCTION public.complete_kakao_signup_with_consents(
  p_user_id uuid,
  p_items jsonb,
  p_email text,
  p_phone text,
  p_kakao_email text,
  p_kakao_id text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_complete_kakao_signup_with_consents$
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
$fn_complete_kakao_signup_with_consents$;

-- 3-14. 함수 권한: 모두 걷고 필요한 역할에만.
REVOKE ALL ON FUNCTION public.consent_normalize_text(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_internal_admin_account(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_signup_consent_item_update() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prevent_signup_consent_item_version_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_user_consents_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consent_missing_required(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consent_items_error(jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consent_latest_results(uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consent_record_internal(uuid, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consent_eligible_member_count() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_user_consents(uuid, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consent_validate_submission(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_missing_required_consents() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_signup_consent_item(uuid, uuid, integer, text, text, boolean, text, integer, boolean, text, timestamptz, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.revise_signup_consent_item(uuid, uuid, integer, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_incomplete_kakao_signup(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.signup_consent_item_stats() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_kakao_signup_with_consents(uuid, jsonb, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_my_missing_required_consents() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_user_consents(uuid, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consent_validate_submission(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_signup_consent_item(uuid, uuid, integer, text, text, boolean, text, integer, boolean, text, timestamptz, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.revise_signup_consent_item(uuid, uuid, integer, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_incomplete_kakao_signup(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.signup_consent_item_stats() TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_kakao_signup_with_consents(uuid, jsonb, text, text, text, text) TO service_role;

-- 4. 첫 값 -------------------------------------------------------------------------------------------------------
-- 문구는 대표가 확인한 뒤 적용한다(계획 2-6·2-7절). 강조 표기 **…** 는 화면에서 굵게·밑줄·크게 보인다.
WITH new_items AS (
  INSERT INTO public.signup_consent_items (key, label, content, required, policy_slug, required_lock, sort_order, is_active, version)
  VALUES
    ('terms', '이용약관 동의',
     $txt$서비스 이용약관에 동의합니다.
- 학습 자료를 크레딧으로 구매하고 내려받는 서비스입니다. 크레딧은 미리 충전해 쓰며, 사용 기한과 환불 기준은 이용약관과 취소·환불 정책을 따릅니다.
- 구매한 자료는 본인 수업용 인쇄·배포에만 쓸 수 있고, 파일 공유·재판매·온라인 게시는 할 수 없습니다.
자세한 내용은 이용약관 전문을 확인해 주세요.$txt$,
     true, 'service', true, 10, true, 1),
    ('privacy', '개인정보 수집·이용 동의',
     $txt$수집·이용 목적: 회원 식별, 자료 판매·결제, 고객 문의 응대, 구매 후기 작성자 표시(이메일 앞 일부로 만든 이름이 다른 이용자에게 공개됩니다)
수집 항목
- 이메일 가입: 이메일, 비밀번호, 휴대폰번호
- 카카오 가입: 카카오 회원번호, 카카오 계정 이메일, 휴대폰번호
- 이용 중 생성: 접속 기록, 결제 기록
**보유·이용 기간: 탈퇴 시 지체 없이 파기합니다. 단, 결제 이력이 있는 경우 전자상거래법에 따라 계약·청약철회·대금결제 기록을 5년간 보존합니다.**
동의를 거부할 수 있으나, 거부하면 회원가입을 할 수 없습니다.$txt$,
     true, NULL, true, 20, true, 1),
    ('age14', '본인은 만 14세 이상입니다',
     $txt$만 14세 미만은 가입할 수 없습니다. 사실과 다르게 가입한 것이 확인되면 이용이 제한되고 계정이 삭제될 수 있습니다.$txt$,
     true, NULL, true, 30, true, 1),
    ('marketing', '마케팅 정보 수신 동의',
     $txt$**새 자료·이벤트를 안내하기 위해 이메일·문자로 광고성 정보를 보낼 수 있습니다.**
수집·이용 항목: 이메일, 휴대폰번호
보유·이용 기간: 탈퇴하거나 동의를 철회할 때까지
동의하지 않아도 가입·이용할 수 있으며, 마이페이지 > 선택 동의 관리에서 언제든 철회할 수 있습니다.$txt$,
     false, NULL, false, 40, true, 1)
  RETURNING id, label, content, required, policy_slug
)
INSERT INTO public.signup_consent_item_versions (item_id, version, label, content, required, policy_slug, note)
SELECT id, 1, label, content, required, policy_slug, NULL FROM new_items;

-- 화면 안내 문구. 새 키라 ON CONFLICT 없이 넣는다(이미 있으면 실패 — 되돌리기가 남의 행을 지우지 않게).
INSERT INTO public.system_settings (key, value, description)
VALUES (
  'signup_consent_texts',
  $json${
    "kakaoConfirmNotice": "카카오에서 받은 정보는 가입 확인 외에는 이용하지 않으며, 가입을 취소하면 바로 삭제됩니다.",
    "kakaoCancelDoneNotice": "가입을 취소하고 카카오에서 받은 정보를 삭제했습니다. 카카오 계정 설정의 '연결된 서비스 관리'에서 연결을 끊을 수 있습니다.",
    "consentTitle": "약관 동의",
    "consentFirstIntro": "서비스를 계속 이용하려면 아래 약관에 동의해 주세요.",
    "consentRevisedIntro": "약관이 바뀌어 다시 동의가 필요합니다. 바뀐 내용을 확인해 주세요.",
    "declineConfirm": "필수 항목에 동의하지 않으면 서비스를 이용할 수 없어 로그아웃됩니다. 로그아웃 상태로 둘러보기는 계속할 수 있고, 다시 로그인하면 이 화면이 나옵니다. 구매한 자료는 다시 로그인한 뒤 자료 보관함에서 받을 수 있습니다. 남은 크레딧과 탈퇴는 1:1 문의로 도와드립니다.",
    "optionalResultTemplate": "{전송자} {항목} 처리 결과: {결과} · {처리일자}",
    "optionalReceiptTemplate": "선택하신 내용({항목}: {결과})은 이메일 인증을 마친 새 계정에 반영됩니다. 처리 결과는 로그인한 뒤 마이페이지 > 선택 동의 관리에서 확인할 수 있습니다.",
    "optionalNotRequiredHint": "선택 항목은 동의하지 않아도 가입할 수 있습니다."
  }$json$::jsonb,
  '회원가입 약관 동의 화면 안내 문구(src/lib/signup-consent.ts). 변경은 관리자 사이트 기본 정보 > 가입 동의 항목(대표 전용)에서만.'
);

-- 5. 화면 세션 직접 쓰기 차단(대표 포함 — 바꾸는 길은 검사·작업 기록을 거치는 서버 저장뿐) ----------------------------
CREATE POLICY system_settings_signup_consent_texts_no_client_write
  ON public.system_settings
  AS RESTRICTIVE
  FOR UPDATE
  USING (key <> 'signup_consent_texts')
  WITH CHECK (key <> 'signup_consent_texts');

CREATE POLICY system_settings_site_footer_content_no_client_write
  ON public.system_settings
  AS RESTRICTIVE
  FOR UPDATE
  USING (key <> 'site_footer_content')
  WITH CHECK (key <> 'site_footer_content');

-- 6. VERIFY -----------------------------------------------------------------------------------------------------
DO $verify_signup_consents$
DECLARE
  v_text text;
  v_count integer;
  v_signature text;
  v_acl text;
BEGIN
  -- 6-1. 표 권한: service_role SELECT 만, anon·authenticated 없음
  SELECT string_agg(format('%s:%s:%s', table_name, grantee, privilege_type), ', ') INTO v_text
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name IN ('signup_consent_items', 'signup_consent_item_versions', 'user_consents')
     AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
     AND NOT (grantee = 'service_role' AND privilege_type = 'SELECT');
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: unexpected table grants: %', v_text;
  END IF;
  SELECT count(*) INTO v_count
    FROM pg_class c
   WHERE c.oid IN ('public.signup_consent_items'::regclass, 'public.signup_consent_item_versions'::regclass, 'public.user_consents'::regclass)
     AND c.relrowsecurity;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'VERIFY: RLS not enabled on all consent tables';
  END IF;
  SELECT c.relacl::text INTO v_acl FROM pg_class c WHERE c.oid = 'public.user_consents_seq_seq'::regclass;
  IF v_acl IS NOT NULL AND v_acl ~ '(anon|authenticated|service_role)=' THEN
    RAISE EXCEPTION 'VERIFY: sequence grants: %', v_acl;
  END IF;

  -- 6-2. (3a) PUBLIC/anon 이 실행할 수 있는 SECURITY DEFINER 함수는 handle_new_user 뿐
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

  -- 6-3. 함수 ACL 정확히 대조
  FOREACH v_signature IN ARRAY ARRAY[
    'public.consent_missing_required(uuid,jsonb)',
    'public.consent_items_error(jsonb,text)',
    'public.consent_latest_results(uuid,uuid[])',
    'public.consent_record_internal(uuid,jsonb,text)',
    'public.consent_eligible_member_count()'
  ] LOOP
    SELECT p.proacl::text INTO v_acl FROM pg_proc p WHERE p.oid = v_signature::regprocedure;
    IF v_acl IS DISTINCT FROM '{postgres=X/postgres}' THEN
      RAISE EXCEPTION 'VERIFY: internal function acl % = %', v_signature, v_acl;
    END IF;
  END LOOP;
  FOREACH v_signature IN ARRAY ARRAY[
    'public.record_user_consents(uuid,jsonb,text)',
    'public.consent_validate_submission(jsonb)',
    'public.save_signup_consent_item(uuid,uuid,integer,text,text,boolean,text,integer,boolean,text,timestamptz,boolean)',
    'public.revise_signup_consent_item(uuid,uuid,integer,text,boolean)',
    'public.cancel_incomplete_kakao_signup(uuid)',
    'public.signup_consent_item_stats()',
    'public.complete_kakao_signup_with_consents(uuid,jsonb,text,text,text,text)'
  ] LOOP
    SELECT p.proacl::text INTO v_acl FROM pg_proc p WHERE p.oid = v_signature::regprocedure;
    IF v_acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
      RAISE EXCEPTION 'VERIFY: service function acl % = %', v_signature, v_acl;
    END IF;
  END LOOP;
  SELECT p.proacl::text INTO v_acl FROM pg_proc p WHERE p.oid = 'public.get_my_missing_required_consents()'::regprocedure;
  IF v_acl IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' THEN
    RAISE EXCEPTION 'VERIFY: get_my_missing_required_consents acl = %', v_acl;
  END IF;
  FOREACH v_signature IN ARRAY ARRAY['public.consent_normalize_text(text)', 'public.is_internal_admin_account(text)'] LOOP
    SELECT p.proacl::text INTO v_acl FROM pg_proc p WHERE p.oid = v_signature::regprocedure;
    IF v_acl IS DISTINCT FROM '{postgres=X/postgres}' THEN
      RAISE EXCEPTION 'VERIFY: helper acl % = %', v_signature, v_acl;
    END IF;
  END LOOP;

  -- 6-4. 쓰기·판정 함수는 DEFINER + search_path public, pg_temp. 판정 도우미는 DEFINER 아님.
  SELECT string_agg(p.proname, ', ') INTO v_text
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('consent_missing_required', 'consent_items_error', 'consent_latest_results', 'consent_record_internal',
                       'consent_eligible_member_count', 'record_user_consents', 'consent_validate_submission',
                       'get_my_missing_required_consents', 'save_signup_consent_item', 'revise_signup_consent_item',
                       'cancel_incomplete_kakao_signup', 'signup_consent_item_stats', 'complete_kakao_signup_with_consents')
     AND (NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']);
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: definer/search_path mismatch: %', v_text;
  END IF;
  SELECT string_agg(p.proname, ', ') INTO v_text
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('consent_normalize_text', 'is_internal_admin_account', 'guard_user_consents_mutation',
                       'guard_signup_consent_item_update', 'prevent_signup_consent_item_version_mutation')
     AND p.prosecdef;
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: helpers must not be definer: %', v_text;
  END IF;

  -- 6-5. 저장 함수: 오버로드 1개, 인자 12개
  SELECT count(*) INTO v_count FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'save_signup_consent_item';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'VERIFY: save_signup_consent_item overloads = %', v_count;
  END IF;
  SELECT p.pronargs INTO v_count FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'save_signup_consent_item';
  IF v_count <> 12 THEN
    RAISE EXCEPTION 'VERIFY: save_signup_consent_item args = %', v_count;
  END IF;

  -- 6-6. 정책 2개
  SELECT count(*) INTO v_count FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'system_settings'
     AND policyname IN ('system_settings_signup_consent_texts_no_client_write', 'system_settings_site_footer_content_no_client_write')
     AND permissive = 'RESTRICTIVE' AND cmd = 'UPDATE';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'VERIFY: restrictive policies = %', v_count;
  END IF;

  -- 6-7. 첫 값: 모든 항목의 (id, version) 원문이 있고 내용이 같음, 활성 필수 1개 이상, 잠금 첫 값
  SELECT count(*) INTO v_count
    FROM public.signup_consent_items i
    LEFT JOIN public.signup_consent_item_versions v ON v.item_id = i.id AND v.version = i.version
   WHERE v.item_id IS NULL OR v.label <> i.label OR v.content <> i.content OR v.required <> i.required
      OR v.policy_slug IS DISTINCT FROM i.policy_slug;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'VERIFY: item/version mismatch = %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.signup_consent_items WHERE is_active AND required;
  IF v_count < 1 THEN
    RAISE EXCEPTION 'VERIFY: no active required item';
  END IF;
  SELECT string_agg(key || '=' || COALESCE(required_lock::text, 'null'), ',' ORDER BY key) INTO v_text
    FROM public.signup_consent_items;
  IF v_text IS DISTINCT FROM 'age14=true,marketing=false,privacy=true,terms=true' THEN
    RAISE EXCEPTION 'VERIFY: required_lock = %', v_text;
  END IF;

  -- 6-8. 약관 원본: 활성 필수 항목이 연결한 문서와 개인정보처리방침이 있고, 켜져 있고(enabled 가 false 가 아님), 본문이 비어 있지 않음
  SELECT string_agg(s.slug, ', ') INTO v_text
    FROM (
      SELECT DISTINCT i.policy_slug AS slug FROM public.signup_consent_items i
       WHERE i.is_active AND i.required AND i.policy_slug IS NOT NULL
      UNION SELECT 'privacy'
    ) AS s
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.system_settings st,
            jsonb_each(CASE WHEN jsonb_typeof(st.value -> 'policyDocuments') = 'object' THEN st.value -> 'policyDocuments' ELSE '{}'::jsonb END) AS d(doc_key, doc)
      WHERE st.key = 'site_footer_content'
        AND d.doc ->> 'slug' = s.slug
        AND (d.doc -> 'enabled') IS DISTINCT FROM 'false'::jsonb
        AND public.consent_normalize_text(d.doc ->> 'content') <> ''
   );
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: policy documents missing/disabled/empty: %', v_text;
  END IF;

  -- 6-9. 카카오가 넘긴 값(identity_data)은 허용 목록 키만(닉네임·프로필 사진 수집 안 함의 전제)
  SELECT string_agg(DISTINCT k, ', ') INTO v_text
    FROM auth.identities i, jsonb_object_keys(COALESCE(i.identity_data, '{}'::jsonb)) AS k
   WHERE i.provider = 'kakao'
     AND k NOT IN ('email', 'email_verified', 'iss', 'phone_verified', 'provider_id', 'sub');
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: kakao identity_data has keys outside allowlist: %', v_text;
  END IF;

  -- 6-10. 안내 문구: 모든 키가 비어 있지 않음, 결과 틀 자리표시 4개
  SELECT string_agg(k, ', ') INTO v_text
    FROM unnest(ARRAY['kakaoConfirmNotice', 'kakaoCancelDoneNotice', 'consentTitle', 'consentFirstIntro', 'consentRevisedIntro',
                      'declineConfirm', 'optionalResultTemplate', 'optionalReceiptTemplate', 'optionalNotRequiredHint']) AS k
   WHERE public.consent_normalize_text((SELECT s.value ->> k FROM public.system_settings s WHERE s.key = 'signup_consent_texts')) = '';
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: empty signup_consent_texts: %', v_text;
  END IF;
  SELECT s.value ->> 'optionalResultTemplate' INTO v_text FROM public.system_settings s WHERE s.key = 'signup_consent_texts';
  IF position('{전송자}' IN v_text) = 0 OR position('{항목}' IN v_text) = 0
     OR position('{결과}' IN v_text) = 0 OR position('{처리일자}' IN v_text) = 0 THEN
    RAISE EXCEPTION 'VERIFY: optionalResultTemplate placeholders';
  END IF;

  -- 6-11. 공백 규칙
  IF public.consent_normalize_text(E' \t\n가\u00a0나\u3000\ufeff\r\n') <> E'가\u00a0나' THEN
    RAISE EXCEPTION 'VERIFY: consent_normalize_text';
  END IF;
  IF NOT public.is_internal_admin_account('Admin01@ADMIN.summersun.local') OR public.is_internal_admin_account('a@example.com')
     OR public.is_internal_admin_account(NULL) THEN
    RAISE EXCEPTION 'VERIFY: is_internal_admin_account';
  END IF;
END;
$verify_signup_consents$;

NOTIFY pgrst, 'reload schema';
