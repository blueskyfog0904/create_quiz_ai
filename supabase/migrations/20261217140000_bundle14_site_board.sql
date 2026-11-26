-- 출시 전 작업 순서표 14번 묶음: 공지 게시판 + FAQ(계획 docs/plan-bundle14-notice-faq.md 3판, 5절).
-- 만드는 것(추가만 — 기존 표의 칸·정책·트리거·FK 를 건드리지 않는다):
--   1. 표 site_board_posts(지금 글, board = notice·faq)와 site_board_post_revisions(판 이력, 가릴 수 있음).
--      RLS 켬·정책 0, PUBLIC·anon·authenticated·service_role 전부 회수 뒤 service_role 에 SELECT 만(쓰기는 아래 DEFINER 함수만).
--      행위자 칸(created_by·updated_by·deleted_by·redacted_by·saved_by)은 FK 없는 uuid(관리자 계정을 지워도 기록이 남음 — 12번·작업 기록과 같음).
--   2. 판 이력 가드 트리거: DELETE·TRUNCATE 거부, UPDATE 는 가림 함수 거래(app.site_board_redact = 그 post_id)의 가림 칸만.
--   3. 설정 행 system_settings.site_board_content(화면 문구 초안·FAQ 분류·고정 상한, revision 1 — 있으면 그대로). 정책은 만들지 않는다(5-4).
--   4. 함수 7개(SECURITY DEFINER, search_path 고정, service_role 만 EXECUTE): site_board_actor_allowed·member_facing_text_pii_hits·
--      save_site_board_post·delete_site_board_post·reorder_site_board_posts·redact_site_board_post·save_site_board_content.
-- 잠금 순서(5-6): 쓰기 함수 다섯은 권한 확인 직후, 글 행 FOR UPDATE·설정 행 읽기·sort_order 계산보다 먼저
--   pg_advisory_xact_lock(hashtext('site_board_order')) 를 잡는다(교착·분류 지우기/상한 낮추기 경합 방지).
-- 작업 기록(admin_audit_log)에는 제목·본문 원문도 본문 지문도 넣지 않는다(가릴 수 없는 표 — 짧은 본문은 지문으로 되찾을 수 있음).
--   글자 수·바뀐 칸·판 이력 행 id 만. 원문과 지문(body_sha256)은 판 이력 표에 두고, 가림 때 지문도 함께 지운다(NULL).
-- 지문 사전 점검은 md5(pg_get_functiondef(oid))(2026-11-26 운영 읽기 전용 값, 계획 1절). 다르면 멈춘다.
-- 잠금: 새 표 2개를 만들고 system_settings 에 행 1개를 넣는다(행 잠금). 기존 표에 거는 DDL 은 없다.
-- 되돌리기: supabase/rollback/20261217140000_bundle14_site_board_down.sql(코드를 14번 전으로 되돌린 뒤).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 0. 사전 점검(5-1) -----------------------------------------------------------------------------------------------
DO $precheck_bundle14_site_board$
DECLARE
  v_new_functions text[] := ARRAY[
    'site_board_actor_allowed', 'member_facing_text_pii_hits', 'save_site_board_post', 'delete_site_board_post',
    'reorder_site_board_posts', 'redact_site_board_post', 'save_site_board_content', 'guard_site_board_post_revisions_mutation'];
BEGIN
  IF to_regprocedure('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)') IS NULL
     OR md5(pg_get_functiondef(to_regprocedure('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)')))
        <> 'a42b474d9d95753ffba5041acb0c1c77' THEN
    RAISE EXCEPTION 'PRECHECK: record_admin_audit changed (%)',
      CASE WHEN to_regprocedure('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)') IS NULL THEN 'missing'
           ELSE md5(pg_get_functiondef(to_regprocedure('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)'))) END;
  END IF;
  IF to_regclass('public.admin_permission_grants') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'admin_role')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'withdrawn_at') THEN
    RAISE EXCEPTION 'PRECHECK: admin_permission_grants / profiles.admin_role / profiles.withdrawn_at missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'site_footer_content') THEN
    RAISE EXCEPTION 'PRECHECK: site_footer_content missing';
  END IF;
  IF to_regclass('public.site_board_posts') IS NOT NULL OR to_regclass('public.site_board_post_revisions') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECHECK: bundle 14 tables already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (v_new_functions)) THEN
    RAISE EXCEPTION 'PRECHECK: bundle 14 functions already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'site_board_content') THEN
    RAISE EXCEPTION 'PRECHECK: site_board_content row already exists';
  END IF;
END;
$precheck_bundle14_site_board$;

-- [14번] 시작 ---------------------------------------------------------------------------------------------------
-- 1. 지금 글(5-2) ------------------------------------------------------------------------------------------------
CREATE TABLE public.site_board_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board text NOT NULL CHECK (board IN ('notice', 'faq')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100 AND btrim(title) <> '' AND strpos(title, E'\n') = 0),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 20000 AND btrim(body) <> ''),
  link_url text CHECK (link_url IS NULL OR char_length(link_url) BETWEEN 1 AND 200),
  link_label text CHECK (link_label IS NULL OR (char_length(link_label) BETWEEN 1 AND 30 AND strpos(link_label, E'\n') = 0)),
  faq_category_key text CHECK (faq_category_key IS NULL OR faq_category_key ~ '^[a-z][a-z0-9_]{0,29}$'),
  is_pinned boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  content_updated_at timestamptz,
  deleted_at timestamptz,
  redacted_at timestamptz,
  created_by uuid NOT NULL,
  updated_by uuid,
  deleted_by uuid,
  redacted_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CONSTRAINT site_board_posts_link_pair CHECK ((link_url IS NULL) = (link_label IS NULL)),
  CONSTRAINT site_board_posts_category CHECK ((board = 'faq') = (faq_category_key IS NOT NULL)),
  CONSTRAINT site_board_posts_faq_not_pinned CHECK (board = 'notice' OR NOT is_pinned),
  CONSTRAINT site_board_posts_published_at CHECK (NOT is_published OR published_at IS NOT NULL),
  CONSTRAINT site_board_posts_deleted CHECK ((deleted_at IS NULL) = (deleted_by IS NULL) AND (deleted_at IS NULL OR (NOT is_published AND NOT is_pinned))),
  CONSTRAINT site_board_posts_redacted CHECK ((redacted_at IS NULL) = (redacted_by IS NULL) AND (redacted_at IS NULL OR NOT is_published))
);
-- 글 수가 적다. 정렬은 5-5 규칙으로 쿼리에서 한다.
CREATE INDEX site_board_posts_published ON public.site_board_posts (board) WHERE is_published AND deleted_at IS NULL;

COMMENT ON TABLE public.site_board_posts IS
  '14번: 공지사항·FAQ 지금 글. 쓰기는 save/delete/reorder/redact_site_board_post 함수만(service_role 은 SELECT 만).';

ALTER TABLE public.site_board_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.site_board_posts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.site_board_posts TO service_role;

-- 2. 판 이력(5-3) — 저장·삭제마다 그 뒤 상태 1행. 순서만 바꾼 것은 넣지 않는다. post_id 는 같은 묶음 안이라 FK(ON DELETE 없음). --------
CREATE TABLE public.site_board_post_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.site_board_posts(id),
  revision integer NOT NULL CHECK (revision >= 1),
  title text NOT NULL,
  body text NOT NULL,
  link_url text,
  link_label text,
  faq_category_key text,
  is_pinned boolean NOT NULL,
  is_published boolean NOT NULL,
  body_sha256 text CHECK (body_sha256 IS NULL OR body_sha256 ~ '^[0-9a-f]{64}$'),
  saved_by uuid NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  redacted_at timestamptz,
  redacted_by uuid,
  CONSTRAINT site_board_post_revisions_post_revision UNIQUE (post_id, revision),
  CONSTRAINT site_board_post_revisions_redacted CHECK ((redacted_at IS NULL) = (redacted_by IS NULL)),
  -- 지문은 가리지 않은 행에만 있다(가림 때 NULL — 짧은 본문을 사전 대입으로 되찾지 못하게)
  CONSTRAINT site_board_post_revisions_sha256 CHECK ((body_sha256 IS NULL) = (redacted_at IS NOT NULL))
);

COMMENT ON TABLE public.site_board_post_revisions IS
  '14번: 공지·FAQ 판 이력(게시 증빙, 기한 없음). DELETE·TRUNCATE 거부, 가림(redact_site_board_post)만 제목·본문·링크를 바꾼다.';

ALTER TABLE public.site_board_post_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.site_board_post_revisions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.site_board_post_revisions TO service_role;

--    UPDATE 는 거래 로컬 설정 app.site_board_redact 가 그 post_id 와 같을 때만: 제목·본문 → 지금 가림 문구, 링크·지문 → NULL,
--    redacted_* NULL→값. 다른 칸은 그대로여야 한다(13번 가림 방식과 같음).
CREATE FUNCTION public.guard_site_board_post_revisions_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_site_board_post_revisions_mutation$
BEGIN
  IF TG_OP = 'UPDATE'
     AND COALESCE(current_setting('app.site_board_redact', true), '') <> ''
     AND current_setting('app.site_board_redact', true) = OLD.post_id::text
     AND (NEW.id, NEW.post_id, NEW.revision, NEW.faq_category_key, NEW.is_pinned, NEW.is_published, NEW.saved_by, NEW.saved_at)
         IS NOT DISTINCT FROM (OLD.id, OLD.post_id, OLD.revision, OLD.faq_category_key, OLD.is_pinned, OLD.is_published, OLD.saved_by, OLD.saved_at)
     AND OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL AND NEW.redacted_by IS NOT NULL
     AND NEW.link_url IS NULL AND NEW.link_label IS NULL AND NEW.body_sha256 IS NULL
     AND NEW.title = NEW.body
     AND NEW.title = (SELECT s.value ->> 'redactedText' FROM public.system_settings s WHERE s.key = 'site_board_content') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'SITE_BOARD_REVISIONS_APPEND_ONLY';
END;
$fn_guard_site_board_post_revisions_mutation$;

CREATE TRIGGER guard_site_board_post_revisions_mutation
  BEFORE UPDATE OR DELETE ON public.site_board_post_revisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_site_board_post_revisions_mutation();
CREATE TRIGGER guard_site_board_post_revisions_truncate
  BEFORE TRUNCATE ON public.site_board_post_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_site_board_post_revisions_mutation();
REVOKE ALL ON FUNCTION public.guard_site_board_post_revisions_mutation() FROM PUBLIC, anon, authenticated, service_role;

-- 3. 설정 행(5-4, 11절 초안) — 문구는 초안이다. 대표가 관리자 '공지사항'·'자주 묻는 질문' 화면의 안내 문구 탭에서 고친다. -----------------
--    하단·고객지원 링크는 스위치가 아니라 게시 글이 1개 이상일 때만 보인다(Q4). FAQ 글은 넣지 않는다(답이 약관 숫자와 어긋나면 안 됨).
INSERT INTO public.system_settings (key, value, description)
VALUES ('site_board_content', $json_site_board_content$
{
  "revision": 1,
  "notice": {
    "pageTitle": "공지사항",
    "pageDescription": "서비스 변경, 점검, 약관 개정 소식을 알려 드립니다.",
    "emptyTitle": "아직 공지사항이 없습니다",
    "emptyDescription": "새 소식이 생기면 이곳에 올리겠습니다.",
    "pinnedLabel": "중요",
    "updatedLabel": "수정",
    "backToListLabel": "목록으로",
    "notFoundTitle": "공지를 찾을 수 없습니다",
    "notFoundDescription": "내려갔거나 주소가 바뀐 공지입니다. 공지 목록에서 다시 찾아 주세요.",
    "footerLinkLabel": "공지사항",
    "maxPinned": 5
  },
  "faq": {
    "pageTitle": "자주 묻는 질문",
    "pageDescription": "크레딧·결제·자료 다운로드·계정에 관해 자주 받는 질문입니다.",
    "emptyTitle": "아직 등록된 질문이 없습니다",
    "allCategoryLabel": "전체",
    "categories": [
      { "key": "credit", "label": "크레딧·결제" },
      { "key": "refund", "label": "환불" },
      { "key": "download", "label": "자료·다운로드" },
      { "key": "account", "label": "계정·회원" }
    ],
    "supportPrompt": "찾는 답이 없으면 1:1 문의를 남겨 주세요.",
    "supportLinkLabel": "1:1 문의하기",
    "footerLinkLabel": "자주 묻는 질문"
  },
  "footer": {
    "navLabel": "공지와 도움말"
  },
  "redactedText": "개인정보가 포함되어 가린 글입니다."
}
$json_site_board_content$::jsonb, '14번: 공지사항·FAQ 회원 화면 문구·FAQ 분류·고정 상한(저장은 save_site_board_content 만)')
ON CONFLICT (key) DO NOTHING;

-- 4. 함수(5-6) ----------------------------------------------------------------------------------------------------
-- 4-1. 행위자 판정: 12번 member_suspension_actor_allowed 와 같은 식. admin_role 이 빈 관리자는 거절(TS buildAdminAccess 보다 엄격).
CREATE FUNCTION public.site_board_actor_allowed(p_actor_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_site_board_actor_allowed$
  SELECT p_actor_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.withdrawn_at IS NULL
       AND (p.admin_role = 'owner'
            OR (p.admin_role = 'staff'
                AND EXISTS (SELECT 1 FROM public.admin_permission_grants g WHERE g.user_id = p.id AND g.permission = 'content.manage'))))
$fn_site_board_actor_allowed$;

-- 4-2. 회원에게 보이는 글의 개인정보 모양(이메일·휴대폰·일반 전화·주민번호). TS src/lib/member-facing-text-pii.ts 와 같은 규칙.
--      회사 고객센터 연락처(site_footer_content.fixedFields.customerCenter.value·orderEmail.value)는 뺀다. 전화는 숫자만 남겨 비교한다.
--      돌려주는 순서: email·mobile·phone·rrn(겹치지 않게). 16번이 같은 함수를 쓴다.
CREATE FUNCTION public.member_facing_text_pii_hits(p_text text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_facing_text_pii_hits$
DECLARE
  v_fixed jsonb := (SELECT s.value -> 'fixedFields' FROM public.system_settings s WHERE s.key = 'site_footer_content');
  v_allowed_phone text := regexp_replace(COALESCE(v_fixed #>> '{customerCenter,value}', ''), '[^0-9]', '', 'g');
  v_allowed_email text := lower(btrim(COALESCE(v_fixed #>> '{orderEmail,value}', '')));
  v_hits text[] := ARRAY[]::text[];
  v_m text[];
BEGIN
  IF p_text IS NULL OR p_text = '' THEN
    RETURN v_hits;
  END IF;
  FOR v_m IN SELECT regexp_matches(p_text, '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:[.][A-Za-z0-9-]+)*[.][A-Za-z]{2,}', 'g') LOOP
    IF lower(v_m[1]) <> v_allowed_email THEN
      v_hits := v_hits || 'email'::text;
      EXIT;
    END IF;
  END LOOP;
  FOR v_m IN SELECT regexp_matches(p_text, '(?<![0-9])01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}(?![0-9])', 'g') LOOP
    IF regexp_replace(v_m[1], '[^0-9]', '', 'g') <> v_allowed_phone THEN
      v_hits := v_hits || 'mobile'::text;
      EXIT;
    END IF;
  END LOOP;
  FOR v_m IN SELECT regexp_matches(p_text, '(?<![0-9])0(?:2|[3-6][1-5]|70)[-. ]?[0-9]{3,4}[-. ]?[0-9]{4}(?![0-9])', 'g') LOOP
    IF regexp_replace(v_m[1], '[^0-9]', '', 'g') <> v_allowed_phone THEN
      v_hits := v_hits || 'phone'::text;
      EXIT;
    END IF;
  END LOOP;
  IF p_text ~ '(?<![0-9])[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])[- ]?[1-8][0-9]{6}(?![0-9])' THEN
    v_hits := v_hits || 'rrn'::text;
  END IF;
  RETURN v_hits;
END;
$fn_member_facing_text_pii_hits$;

-- 4-3. 글 저장(새 글·고침). 순서: 요청 정보 → 행위자 → advisory lock → 글 행 FOR UPDATE(판·삭제·종류) → 설정 행 → 다듬기·검사 →
--      개인정보 → 바뀐 것 없음이면 그대로 → 고정 상한 → sort_order(5-5) → 날짜 → 저장·판 이력·작업 기록(같은 거래).
--      오류: SITE_BOARD_INPUT_INVALID:칸, SITE_BOARD_PII_SUSPECTED:종류(글자는 돌려주지 않음).
CREATE FUNCTION public.save_site_board_post(p_actor_id uuid, p_id uuid, p_expected_revision integer, p_board text, p_title text, p_body text,
  p_link_url text, p_link_label text, p_faq_category_key text, p_is_pinned boolean, p_is_published boolean, p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_save_site_board_post$
DECLARE
  v_old public.site_board_posts%ROWTYPE;
  v_new public.site_board_posts%ROWTYPE;
  v_content jsonb;
  v_created boolean := p_id IS NULL;
  v_title text := regexp_replace(replace(replace(COALESCE(p_title, ''), E'\r\n', E'\n'), E'\r', E'\n'), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_body text := regexp_replace(replace(replace(COALESCE(p_body, ''), E'\r\n', E'\n'), E'\r', E'\n'), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_link_url text := NULLIF(regexp_replace(COALESCE(p_link_url, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_link_label text := NULLIF(regexp_replace(COALESCE(p_link_label, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_category text := NULLIF(btrim(COALESCE(p_faq_category_key, '')), '');
  v_pinned boolean := COALESCE(p_is_pinned, false);
  v_published boolean := COALESCE(p_is_published, false);
  v_hits text[];
  v_link_decoded text;
  v_changed text[] := ARRAY[]::text[];
  v_max_pinned integer;
  v_sort integer;
  v_published_at timestamptz;
  v_content_updated_at timestamptz;
  v_revision_row uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:request';
  END IF;
  IF NOT public.site_board_actor_allowed(p_actor_id) THEN
    RAISE EXCEPTION 'SITE_BOARD_ACTOR_NOT_ALLOWED';
  END IF;
  -- 잠금 순서(5-6): 권한 확인 직후, 글 행 FOR UPDATE·설정 행 읽기·sort_order 계산보다 먼저
  PERFORM pg_advisory_xact_lock(hashtext('site_board_order'));

  IF p_board IS NULL OR p_board NOT IN ('notice', 'faq') THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:board';
  END IF;
  IF v_created THEN
    IF p_expected_revision IS NOT NULL THEN
      RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:revision';
    END IF;
  ELSE
    SELECT * INTO v_old FROM public.site_board_posts WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SITE_BOARD_POST_NOT_FOUND';
    END IF;
    IF v_old.deleted_at IS NOT NULL OR v_old.redacted_at IS NOT NULL THEN
      RAISE EXCEPTION 'SITE_BOARD_POST_DELETED';
    END IF;
    IF v_old.board <> p_board THEN
      RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:board';
    END IF;
    IF p_expected_revision IS DISTINCT FROM v_old.revision THEN
      RAISE EXCEPTION 'SITE_BOARD_REVISION_CONFLICT';
    END IF;
  END IF;

  SELECT s.value INTO v_content FROM public.system_settings s WHERE s.key = 'site_board_content';
  IF v_content IS NULL THEN
    RAISE EXCEPTION 'SITE_BOARD_CONTENT_MISSING';
  END IF;

  -- 다듬기·검사(src/lib/site-board.ts validateSiteBoardPostInput 과 같은 순서)
  IF v_title = '' OR char_length(v_title) > 100 OR strpos(v_title, E'\n') > 0 THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:title';
  END IF;
  IF v_body = '' OR char_length(v_body) > 20000 THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:body';
  END IF;
  -- 링크: 사이트 안 경로만(isAllowedNoticeLink 와 같은 규칙) + 제어문자 퍼센트 인코딩(%00-%1F·%7F) 거절(TS isAllowedSiteBoardLink 와 같음).
  --   링크가 없으면 이름도 버린다.
  IF v_link_url IS NOT NULL AND (left(v_link_url, 1) <> '/' OR left(v_link_url, 2) = '//' OR left(v_link_url, 2) = '/\'
     OR v_link_url ~ '[[:space:]]' OR v_link_url ~ '[\x01-\x1f\x7f]' OR char_length(v_link_url) > 200
     OR v_link_url ~* '%(0[0-9a-f]|1[0-9a-f]|7f)') THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:linkUrl';
  END IF;
  IF v_link_url IS NULL THEN
    v_link_label := NULL;
  ELSIF v_link_label IS NULL OR char_length(v_link_label) > 30 OR strpos(v_link_label, E'\n') > 0 THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:linkLabel';
  END IF;
  IF p_board = 'faq' THEN
    IF v_category IS NULL OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_content #> '{faq,categories}') = 'array' THEN v_content #> '{faq,categories}' ELSE '[]'::jsonb END) c
       WHERE c ->> 'key' = v_category) THEN
      RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:faqCategoryKey';
    END IF;
    IF v_pinned THEN
      RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:isPinned';
    END IF;
  ELSIF v_category IS NOT NULL THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:faqCategoryKey';
  END IF;

  -- 개인정보: 제목·본문·링크 주소(원문과 퍼센트 인코딩을 푼 값 둘 다)·링크 이름(종류만 돌려줌).
  --   푸는 규칙은 TS decodeSiteBoardLinkForPii 와 같다: %XX(16진 2자리)는 바이트로, 나머지는 그대로 UTF-8 로 이어 붙여 풀고,
  --   UTF-8 이 아니면 원문 그대로 본다.
  v_link_decoded := v_link_url;
  IF v_link_url IS NOT NULL AND strpos(v_link_url, '%') > 0 THEN
    BEGIN
      SELECT convert_from(string_agg(CASE WHEN t.m[1] IS NOT NULL THEN decode(substr(t.m[1], 2), 'hex') ELSE convert_to(t.m[2], 'UTF8') END,
                                     ''::bytea ORDER BY t.ord), 'UTF8')
        INTO v_link_decoded
        FROM regexp_matches(v_link_url, '(%[0-9A-Fa-f]{2})|([^%]+|%)', 'g') WITH ORDINALITY AS t(m, ord);
    EXCEPTION WHEN OTHERS THEN
      v_link_decoded := v_link_url;
    END;
  END IF;
  v_hits := public.member_facing_text_pii_hits(v_title) || public.member_facing_text_pii_hits(v_body)
    || public.member_facing_text_pii_hits(v_link_url) || public.member_facing_text_pii_hits(v_link_decoded)
    || public.member_facing_text_pii_hits(v_link_label);
  IF cardinality(v_hits) > 0 THEN
    RAISE EXCEPTION 'SITE_BOARD_PII_SUSPECTED:%', array_to_string(ARRAY(SELECT DISTINCT h FROM unnest(v_hits) h ORDER BY h), ',');
  END IF;

  IF NOT v_created THEN
    IF v_old.title IS DISTINCT FROM v_title THEN v_changed := v_changed || 'title'::text; END IF;
    IF v_old.body IS DISTINCT FROM v_body THEN v_changed := v_changed || 'body'::text; END IF;
    IF v_old.link_url IS DISTINCT FROM v_link_url THEN v_changed := v_changed || 'linkUrl'::text; END IF;
    IF v_old.link_label IS DISTINCT FROM v_link_label THEN v_changed := v_changed || 'linkLabel'::text; END IF;
    IF v_old.faq_category_key IS DISTINCT FROM v_category THEN v_changed := v_changed || 'faqCategoryKey'::text; END IF;
    IF v_old.is_pinned IS DISTINCT FROM v_pinned THEN v_changed := v_changed || 'isPinned'::text; END IF;
    IF v_old.is_published IS DISTINCT FROM v_published THEN v_changed := v_changed || 'isPublished'::text; END IF;
    -- 바뀐 것이 없으면 기록·판 이력 없이 돌려준다.
    IF cardinality(v_changed) = 0 THEN
      RETURN jsonb_build_object('changed', false, 'created', false, 'id', v_old.id, 'revision', v_old.revision);
    END IF;
  END IF;

  -- 고정 상한: 잠금 뒤 읽은 maxPinned 로 '미삭제이고 고정인 글(숨김 포함)'을 센다(5-5).
  IF v_pinned AND (v_created OR NOT v_old.is_pinned) THEN
    v_max_pinned := CASE WHEN jsonb_typeof(v_content #> '{notice,maxPinned}') = 'number' THEN (v_content #>> '{notice,maxPinned}')::integer END;
    IF v_max_pinned IS NULL OR (SELECT count(*) FROM public.site_board_posts p
                                  WHERE p.board = 'notice' AND p.is_pinned AND p.deleted_at IS NULL) >= v_max_pinned THEN
      RAISE EXCEPTION 'SITE_BOARD_PIN_LIMIT';
    END IF;
  END IF;

  -- sort_order(5-5): 고정으로 바뀌면 고정 맨 뒤, 고정이 풀리면 0, FAQ 가 새로 생기거나 분류가 바뀌면 새 분류 맨 뒤.
  IF p_board = 'notice' THEN
    IF NOT v_pinned THEN
      v_sort := 0;
    ELSIF v_created OR NOT v_old.is_pinned THEN
      v_sort := COALESCE((SELECT max(p.sort_order) FROM public.site_board_posts p
                           WHERE p.board = 'notice' AND p.is_pinned AND p.deleted_at IS NULL), 0) + 1;
    ELSE
      v_sort := v_old.sort_order;
    END IF;
  ELSE
    IF v_created OR v_old.faq_category_key IS DISTINCT FROM v_category THEN
      v_sort := COALESCE((SELECT max(p.sort_order) FROM public.site_board_posts p
                           WHERE p.board = 'faq' AND p.faq_category_key = v_category AND p.deleted_at IS NULL
                             AND p.id IS DISTINCT FROM p_id), 0) + 1;
    ELSE
      v_sort := v_old.sort_order;
    END IF;
  END IF;

  -- 날짜: 처음 게시 때 published_at. 게시된 적이 있는 글의 제목·본문·링크가 바뀌면 content_updated_at.
  v_published_at := CASE WHEN v_created THEN NULL ELSE v_old.published_at END;
  IF v_published AND v_published_at IS NULL THEN
    v_published_at := v_now;
  END IF;
  v_content_updated_at := CASE WHEN v_created THEN NULL ELSE v_old.content_updated_at END;
  IF NOT v_created AND v_old.published_at IS NOT NULL
     AND v_changed && ARRAY['title', 'body', 'linkUrl', 'linkLabel']::text[] THEN
    v_content_updated_at := v_now;
  END IF;

  IF v_created THEN
    INSERT INTO public.site_board_posts (board, title, body, link_url, link_label, faq_category_key, is_pinned, sort_order,
      is_published, published_at, created_by, updated_by, created_at, updated_at, revision)
    VALUES (p_board, v_title, v_body, v_link_url, v_link_label, v_category, v_pinned, v_sort,
      v_published, v_published_at, p_actor_id, p_actor_id, v_now, v_now, 1)
    RETURNING * INTO v_new;
  ELSE
    UPDATE public.site_board_posts
       SET title = v_title, body = v_body, link_url = v_link_url, link_label = v_link_label, faq_category_key = v_category,
           is_pinned = v_pinned, sort_order = v_sort, is_published = v_published, published_at = v_published_at,
           content_updated_at = v_content_updated_at, updated_by = p_actor_id, updated_at = v_now, revision = revision + 1
     WHERE id = p_id
    RETURNING * INTO v_new;
  END IF;

  INSERT INTO public.site_board_post_revisions (post_id, revision, title, body, link_url, link_label, faq_category_key,
    is_pinned, is_published, body_sha256, saved_by, saved_at)
  VALUES (v_new.id, v_new.revision, v_new.title, v_new.body, v_new.link_url, v_new.link_label, v_new.faq_category_key,
    v_new.is_pinned, v_new.is_published, encode(sha256(convert_to(v_new.body, 'UTF8')), 'hex'), p_actor_id, v_now)
  RETURNING id INTO v_revision_row;

  -- 작업 기록: 제목·본문 원문은 넣지 않는다(지문·글자 수·바뀐 칸만).
  PERFORM public.record_admin_audit(p_actor_id, 'site_board_post_save', 'site_board_post', v_new.id::text, NULL, NULL, NULL,
    jsonb_build_object(
      'board', v_new.board,
      'post_id', v_new.id,
      'created', v_created,
      'revision_before', v_old.revision,
      'revision_after', v_new.revision,
      'revision_row_id', v_revision_row,
      'changed_fields', to_jsonb(CASE WHEN v_created THEN ARRAY['title', 'body', 'linkUrl', 'linkLabel', 'faqCategoryKey', 'isPinned', 'isPublished']::text[] ELSE v_changed END),
      'title_length', char_length(v_new.title),
      'body_length', char_length(v_new.body),
      'body_length_before', CASE WHEN v_created THEN NULL ELSE char_length(v_old.body) END,
      'is_published_before', v_old.is_published,
      'is_published_after', v_new.is_published,
      'is_pinned_before', v_old.is_pinned,
      'is_pinned_after', v_new.is_pinned,
      'request', p_request_meta,
      'saved_at', v_now),
    NULL);

  RETURN jsonb_build_object('changed', true, 'created', v_created, 'id', v_new.id, 'revision', v_new.revision);
END;
$fn_save_site_board_post$;

-- 4-4. 글 삭제(숨김 보관): deleted_at, 게시 끔, 고정 해제·sort_order 0, 판 이력 1행, 작업 기록(지문·글자 수만).
CREATE FUNCTION public.delete_site_board_post(p_actor_id uuid, p_id uuid, p_expected_revision integer, p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_delete_site_board_post$
DECLARE
  v_old public.site_board_posts%ROWTYPE;
  v_new public.site_board_posts%ROWTYPE;
  v_revision_row uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:request';
  END IF;
  IF NOT public.site_board_actor_allowed(p_actor_id) THEN
    RAISE EXCEPTION 'SITE_BOARD_ACTOR_NOT_ALLOWED';
  END IF;
  -- 잠금 순서(5-6): 권한 확인 직후, 글 행 FOR UPDATE 보다 먼저
  PERFORM pg_advisory_xact_lock(hashtext('site_board_order'));

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:id';
  END IF;
  SELECT * INTO v_old FROM public.site_board_posts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SITE_BOARD_POST_NOT_FOUND';
  END IF;
  IF v_old.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'SITE_BOARD_POST_DELETED';
  END IF;
  IF p_expected_revision IS DISTINCT FROM v_old.revision THEN
    RAISE EXCEPTION 'SITE_BOARD_REVISION_CONFLICT';
  END IF;

  UPDATE public.site_board_posts
     SET deleted_at = v_now, deleted_by = p_actor_id, is_published = false, is_pinned = false, sort_order = 0,
         updated_by = p_actor_id, updated_at = v_now, revision = revision + 1
   WHERE id = p_id
  RETURNING * INTO v_new;

  INSERT INTO public.site_board_post_revisions (post_id, revision, title, body, link_url, link_label, faq_category_key,
    is_pinned, is_published, body_sha256, saved_by, saved_at, redacted_at, redacted_by)
  VALUES (v_new.id, v_new.revision, v_new.title, v_new.body, v_new.link_url, v_new.link_label, v_new.faq_category_key,
    v_new.is_pinned, v_new.is_published,
    CASE WHEN v_new.redacted_at IS NULL THEN encode(sha256(convert_to(v_new.body, 'UTF8')), 'hex') END, p_actor_id, v_now,
    v_new.redacted_at, v_new.redacted_by)
  RETURNING id INTO v_revision_row;

  PERFORM public.record_admin_audit(p_actor_id, 'site_board_post_delete', 'site_board_post', v_new.id::text, NULL, NULL, NULL,
    jsonb_build_object(
      'board', v_new.board,
      'post_id', v_new.id,
      'revision_before', v_old.revision,
      'revision_after', v_new.revision,
      'revision_row_id', v_revision_row,
      'title_length', char_length(v_new.title),
      'body_length', char_length(v_new.body),
      'was_published', v_old.is_published,
      'was_pinned', v_old.is_pinned,
      'request', p_request_meta,
      'deleted_at', v_now),
    NULL);

  RETURN jsonb_build_object('changed', true, 'id', v_new.id, 'revision', v_new.revision);
END;
$fn_delete_site_board_post$;

-- 4-5. 순서 바꾸기: 범위는 공지 'pinned'(미삭제 고정 글, 숨김 포함), FAQ 는 분류 key(그 분류의 미삭제 글, 숨김 포함).
--      id 집합이 범위와 정확히 같아야 한다(빠짐·더함·중복 → SITE_BOARD_REORDER_MISMATCH). 판 이력·revision 은 바꾸지 않는다.
CREATE FUNCTION public.reorder_site_board_posts(p_actor_id uuid, p_board text, p_scope text, p_ids uuid[], p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_reorder_site_board_posts$
DECLARE
  v_before uuid[];
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:request';
  END IF;
  IF NOT public.site_board_actor_allowed(p_actor_id) THEN
    RAISE EXCEPTION 'SITE_BOARD_ACTOR_NOT_ALLOWED';
  END IF;
  -- 잠금 순서(5-6): 권한 확인 직후, 글 행 FOR UPDATE 보다 먼저
  PERFORM pg_advisory_xact_lock(hashtext('site_board_order'));

  IF NOT ((p_board = 'notice' AND p_scope = 'pinned') OR (p_board = 'faq' AND p_scope ~ '^[a-z][a-z0-9_]{0,29}$')) THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:scope';
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) > 500 OR array_position(p_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:ids';
  END IF;

  PERFORM 1 FROM public.site_board_posts p
   WHERE p.board = p_board AND p.deleted_at IS NULL
     AND ((p_board = 'notice' AND p.is_pinned) OR (p_board = 'faq' AND p.faq_category_key = p_scope))
   FOR UPDATE;
  SELECT COALESCE(array_agg(p.id ORDER BY p.sort_order, p.id), '{}') INTO v_before
    FROM public.site_board_posts p
   WHERE p.board = p_board AND p.deleted_at IS NULL
     AND ((p_board = 'notice' AND p.is_pinned) OR (p_board = 'faq' AND p.faq_category_key = p_scope));

  IF cardinality(p_ids) <> cardinality(v_before)
     OR (SELECT count(DISTINCT x) FROM unnest(p_ids) x) <> cardinality(p_ids)
     OR (SELECT array_agg(x ORDER BY x) FROM unnest(p_ids) x) IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(v_before) x) THEN
    RAISE EXCEPTION 'SITE_BOARD_REORDER_MISMATCH';
  END IF;
  IF p_ids = v_before THEN
    RETURN jsonb_build_object('changed', false);
  END IF;

  UPDATE public.site_board_posts p
     SET sort_order = o.ord
    FROM unnest(p_ids) WITH ORDINALITY AS o(id, ord)
   WHERE p.id = o.id AND p.sort_order IS DISTINCT FROM o.ord;

  PERFORM public.record_admin_audit(p_actor_id, 'site_board_post_reorder', 'site_board', p_board || ':' || p_scope, NULL, NULL, NULL,
    jsonb_build_object(
      'board', p_board,
      'scope', p_scope,
      'ids_before', to_jsonb(v_before),
      'ids_after', to_jsonb(p_ids),
      'request', p_request_meta,
      'reordered_at', v_now),
    NULL);

  RETURN jsonb_build_object('changed', true);
END;
$fn_reorder_site_board_posts$;

-- 4-6. 가림(대표만, 숨김·삭제한 글만): 지금 글과 모든 판 이력의 제목·본문을 redactedText 로, 링크 주소·이름·본문 지문을 NULL 로. 되돌릴 수 없다.
--      사유는 정해진 코드만(자유 글 없음, src/lib/site-board.ts SITE_BOARD_REDACT_REASON_CODES 와 같음).
CREATE FUNCTION public.redact_site_board_post(p_actor_id uuid, p_id uuid, p_reason_code text, p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_redact_site_board_post$
DECLARE
  v_old public.site_board_posts%ROWTYPE;
  v_new public.site_board_posts%ROWTYPE;
  v_text text;
  v_count integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:request';
  END IF;
  IF p_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.withdrawn_at IS NULL AND p.admin_role = 'owner') THEN
    RAISE EXCEPTION 'SITE_BOARD_ACTOR_NOT_ALLOWED';
  END IF;
  -- 잠금 순서(5-6): 권한 확인 직후, 글 행 FOR UPDATE 보다 먼저
  PERFORM pg_advisory_xact_lock(hashtext('site_board_order'));

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:id';
  END IF;
  IF p_reason_code IS NULL OR p_reason_code NOT IN ('pii', 'other') THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:reasonCode';
  END IF;
  SELECT * INTO v_old FROM public.site_board_posts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SITE_BOARD_POST_NOT_FOUND';
  END IF;
  IF v_old.is_published THEN
    RAISE EXCEPTION 'SITE_BOARD_REDACT_PUBLISHED';
  END IF;
  IF v_old.redacted_at IS NOT NULL THEN
    RETURN jsonb_build_object('changed', false, 'id', v_old.id, 'revision', v_old.revision);
  END IF;

  v_text := (SELECT s.value ->> 'redactedText' FROM public.system_settings s WHERE s.key = 'site_board_content');
  IF v_text IS NULL OR btrim(v_text) = '' OR char_length(v_text) > 100 OR strpos(v_text, E'\n') > 0 THEN
    RAISE EXCEPTION 'SITE_BOARD_CONTENT_MISSING';
  END IF;

  PERFORM set_config('app.site_board_redact', p_id::text, true);
  UPDATE public.site_board_post_revisions
     SET title = v_text, body = v_text, link_url = NULL, link_label = NULL, body_sha256 = NULL, redacted_at = v_now, redacted_by = p_actor_id
   WHERE post_id = p_id AND redacted_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('app.site_board_redact', '', true);

  UPDATE public.site_board_posts
     SET title = v_text, body = v_text, link_url = NULL, link_label = NULL, redacted_at = v_now, redacted_by = p_actor_id,
         updated_by = p_actor_id, updated_at = v_now, revision = revision + 1
   WHERE id = p_id
  RETURNING * INTO v_new;

  PERFORM public.record_admin_audit(p_actor_id, 'site_board_post_redact', 'site_board_post', v_new.id::text, NULL, NULL, NULL,
    jsonb_build_object(
      'board', v_new.board,
      'post_id', v_new.id,
      'reason_code', p_reason_code,
      'revisions_redacted', v_count,
      'revision_before', v_old.revision,
      'revision_after', v_new.revision,
      'request', p_request_meta,
      'redacted_at', v_now),
    NULL);

  RETURN jsonb_build_object('changed', true, 'id', v_new.id, 'revision', v_new.revision, 'revisionsRedacted', v_count);
END;
$fn_redact_site_board_post$;

-- 4-7. 안내 문구 저장(관리자 '안내 문구' 탭): 판 비교, 필수 키 빈 값 거부(SITE_BOARD_REQUIRED_KEYS 와 같은 목록), 분류 key 형식·중복,
--      글이 남은 분류 지우기 거부, maxPinned 1~20 이고 지금 고정 글 수 이상, redactedText 한 줄·100자 이하, 모든 문구 개인정보 검사.
--      저장하는 값은 아는 키만으로 다시 만든다. 기록에는 before·after(회사가 쓰는 화면 문구라 그대로, 개인정보 검사 통과).
CREATE FUNCTION public.save_site_board_content(p_actor_id uuid, p_expected_revision integer, p_value jsonb, p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_save_site_board_content$
DECLARE
  v_notice_keys text[] := ARRAY['pageTitle', 'pageDescription', 'emptyTitle', 'emptyDescription', 'pinnedLabel', 'updatedLabel',
    'backToListLabel', 'notFoundTitle', 'notFoundDescription', 'footerLinkLabel'];
  v_faq_keys text[] := ARRAY['pageTitle', 'pageDescription', 'emptyTitle', 'allCategoryLabel', 'supportPrompt', 'supportLinkLabel', 'footerLinkLabel'];
  v_footer_keys text[] := ARRAY['navLabel'];
  v_old jsonb;
  v_revision integer;
  v_notice jsonb := '{}'::jsonb;
  v_faq jsonb := '{}'::jsonb;
  v_footer jsonb := '{}'::jsonb;
  v_categories jsonb := '[]'::jsonb;
  v_new jsonb;
  v_key text;
  v_text text;
  v_item jsonb;
  v_max_pinned integer;
  v_redacted text;
  v_texts text[] := ARRAY[]::text[];
  v_hits text[] := ARRAY[]::text[];
  v_in_use text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:request';
  END IF;
  IF NOT public.site_board_actor_allowed(p_actor_id) THEN
    RAISE EXCEPTION 'SITE_BOARD_ACTOR_NOT_ALLOWED';
  END IF;
  -- 잠금 순서(5-6): 권한 확인 직후, 설정 행 읽기·분류 사용 중 검사·고정 수 검사보다 먼저(글 저장과 같은 잠금)
  PERFORM pg_advisory_xact_lock(hashtext('site_board_order'));

  SELECT s.value INTO v_old FROM public.system_settings s WHERE s.key = 'site_board_content' FOR UPDATE;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'SITE_BOARD_CONTENT_MISSING';
  END IF;
  v_revision := CASE WHEN jsonb_typeof(v_old -> 'revision') = 'number' THEN (v_old ->> 'revision')::integer END;
  IF p_expected_revision IS NULL OR p_expected_revision IS DISTINCT FROM v_revision THEN
    RAISE EXCEPTION 'SITE_BOARD_REVISION_CONFLICT';
  END IF;
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' OR jsonb_typeof(p_value -> 'notice') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_value -> 'faq') IS DISTINCT FROM 'object' OR jsonb_typeof(p_value -> 'footer') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:value';
  END IF;

  -- 필수 키: 비지 않은 한 줄 글, 300자 이하
  FOREACH v_key IN ARRAY v_notice_keys LOOP
    v_text := CASE WHEN jsonb_typeof(p_value -> 'notice' -> v_key) = 'string' THEN btrim(p_value -> 'notice' ->> v_key) END;
    IF v_text IS NULL OR v_text = '' OR char_length(v_text) > 300 OR v_text ~ '[\r\n]' THEN
      RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:notice.%', v_key;
    END IF;
    v_notice := v_notice || jsonb_build_object(v_key, v_text);
    v_texts := v_texts || v_text;
  END LOOP;
  FOREACH v_key IN ARRAY v_faq_keys LOOP
    v_text := CASE WHEN jsonb_typeof(p_value -> 'faq' -> v_key) = 'string' THEN btrim(p_value -> 'faq' ->> v_key) END;
    IF v_text IS NULL OR v_text = '' OR char_length(v_text) > 300 OR v_text ~ '[\r\n]' THEN
      RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:faq.%', v_key;
    END IF;
    v_faq := v_faq || jsonb_build_object(v_key, v_text);
    v_texts := v_texts || v_text;
  END LOOP;
  FOREACH v_key IN ARRAY v_footer_keys LOOP
    v_text := CASE WHEN jsonb_typeof(p_value -> 'footer' -> v_key) = 'string' THEN btrim(p_value -> 'footer' ->> v_key) END;
    IF v_text IS NULL OR v_text = '' OR char_length(v_text) > 300 OR v_text ~ '[\r\n]' THEN
      RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:footer.%', v_key;
    END IF;
    v_footer := v_footer || jsonb_build_object(v_key, v_text);
    v_texts := v_texts || v_text;
  END LOOP;

  -- 가림 문구: 한 줄·100자 이하(가림이 제목 CHECK 에 걸려 실패하지 않게)
  v_redacted := CASE WHEN jsonb_typeof(p_value -> 'redactedText') = 'string' THEN btrim(p_value ->> 'redactedText') END;
  IF v_redacted IS NULL OR v_redacted = '' OR char_length(v_redacted) > 100 OR v_redacted ~ '[\r\n]' THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:redactedText';
  END IF;
  v_texts := v_texts || v_redacted;

  -- FAQ 분류: 1~20개, key 형식·중복, 이름 한 줄 30자 이하
  IF jsonb_typeof(p_value -> 'faq' -> 'categories') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_value -> 'faq' -> 'categories') NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:faq.categories';
  END IF;
  FOR v_item IN SELECT e FROM jsonb_array_elements(p_value -> 'faq' -> 'categories') e LOOP
    v_key := CASE WHEN jsonb_typeof(v_item -> 'key') = 'string' THEN v_item ->> 'key' END;
    v_text := CASE WHEN jsonb_typeof(v_item -> 'label') = 'string' THEN btrim(v_item ->> 'label') END;
    IF jsonb_typeof(v_item) <> 'object' OR v_key IS NULL OR v_key !~ '^[a-z][a-z0-9_]{0,29}$'
       OR v_text IS NULL OR v_text = '' OR char_length(v_text) > 30 OR v_text ~ '[\r\n]'
       OR v_categories @> jsonb_build_array(jsonb_build_object('key', v_key)) THEN
      RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:faq.categories';
    END IF;
    v_categories := v_categories || jsonb_build_array(jsonb_build_object('key', v_key, 'label', v_text));
    v_texts := v_texts || v_text;
  END LOOP;
  -- 글(숨김 포함, 삭제 글 제외)이 남은 분류는 지울 수 없다(5-5 '분류 사용 중').
  SELECT p.faq_category_key INTO v_in_use
    FROM public.site_board_posts p
   WHERE p.board = 'faq' AND p.deleted_at IS NULL
     AND NOT (v_categories @> jsonb_build_array(jsonb_build_object('key', p.faq_category_key)))
   ORDER BY p.faq_category_key
   LIMIT 1;
  IF v_in_use IS NOT NULL THEN
    RAISE EXCEPTION 'SITE_BOARD_CATEGORY_IN_USE:%', v_in_use;
  END IF;
  v_faq := v_faq || jsonb_build_object('categories', v_categories);

  -- 고정 상한: 1~20 이고 지금 고정 글 수(미삭제 고정, 숨김 포함) 이상
  v_max_pinned := CASE WHEN jsonb_typeof(p_value -> 'notice' -> 'maxPinned') = 'number'
                        AND (p_value -> 'notice' ->> 'maxPinned') ~ '^[0-9]{1,2}$'
                       THEN (p_value -> 'notice' ->> 'maxPinned')::integer END;
  IF v_max_pinned IS NULL OR v_max_pinned < 1 OR v_max_pinned > 20
     OR v_max_pinned < (SELECT count(*) FROM public.site_board_posts p WHERE p.board = 'notice' AND p.is_pinned AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'SITE_BOARD_INPUT_INVALID:notice.maxPinned';
  END IF;
  v_notice := v_notice || jsonb_build_object('maxPinned', v_max_pinned);

  -- 회원에게 보이는 모든 문구에 개인정보 검사(종류만 돌려줌)
  FOREACH v_text IN ARRAY v_texts LOOP
    v_hits := v_hits || public.member_facing_text_pii_hits(v_text);
  END LOOP;
  IF cardinality(v_hits) > 0 THEN
    RAISE EXCEPTION 'SITE_BOARD_PII_SUSPECTED:%', array_to_string(ARRAY(SELECT DISTINCT h FROM unnest(v_hits) h ORDER BY h), ',');
  END IF;

  v_new := jsonb_build_object('revision', v_revision + 1, 'notice', v_notice, 'faq', v_faq, 'footer', v_footer, 'redactedText', v_redacted);
  IF (v_new - 'revision') = (v_old - 'revision') THEN
    RETURN jsonb_build_object('changed', false, 'revision', v_revision);
  END IF;

  UPDATE public.system_settings SET value = v_new, updated_at = v_now WHERE key = 'site_board_content';

  PERFORM public.record_admin_audit(p_actor_id, 'site_board_content_update', 'system_settings', 'site_board_content', NULL, NULL, NULL,
    jsonb_build_object(
      'revision_before', v_revision,
      'revision_after', v_revision + 1,
      'before', v_old,
      'after', v_new,
      'request', p_request_meta,
      'saved_at', v_now),
    NULL);

  RETURN jsonb_build_object('changed', true, 'revision', v_revision + 1);
END;
$fn_save_site_board_content$;

-- 4-8. 함수 권한: PUBLIC·anon·authenticated(와 기본 권한으로 받은 service_role)을 회수한 뒤 service_role 만 EXECUTE.
REVOKE ALL ON FUNCTION public.site_board_actor_allowed(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_facing_text_pii_hits(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_site_board_post(uuid, uuid, integer, text, text, text, text, text, text, boolean, boolean, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_site_board_post(uuid, uuid, integer, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reorder_site_board_posts(uuid, text, text, uuid[], jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.redact_site_board_post(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_site_board_content(uuid, integer, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.site_board_actor_allowed(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.member_facing_text_pii_hits(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_site_board_post(uuid, uuid, integer, text, text, text, text, text, text, boolean, boolean, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_site_board_post(uuid, uuid, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reorder_site_board_posts(uuid, text, text, uuid[], jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.redact_site_board_post(uuid, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_site_board_content(uuid, integer, jsonb, jsonb) TO service_role;

-- 5. VERIFY(5-7) ---------------------------------------------------------------------------------------------------
DO $verify_bundle14_site_board$
DECLARE
  v_rel text;
  v_fn text;
  v_value jsonb;
  v_key text;
  v_notice_keys text[] := ARRAY['pageTitle', 'pageDescription', 'emptyTitle', 'emptyDescription', 'pinnedLabel', 'updatedLabel',
    'backToListLabel', 'notFoundTitle', 'notFoundDescription', 'footerLinkLabel'];
  v_faq_keys text[] := ARRAY['pageTitle', 'pageDescription', 'emptyTitle', 'allCategoryLabel', 'supportPrompt', 'supportLinkLabel', 'footerLinkLabel'];
  v_footer_keys text[] := ARRAY['navLabel'];
  v_functions text[] := ARRAY[
    'public.site_board_actor_allowed(uuid)',
    'public.member_facing_text_pii_hits(text)',
    'public.save_site_board_post(uuid,uuid,integer,text,text,text,text,text,text,boolean,boolean,jsonb)',
    'public.delete_site_board_post(uuid,uuid,integer,jsonb)',
    'public.reorder_site_board_posts(uuid,text,text,uuid[],jsonb)',
    'public.redact_site_board_post(uuid,uuid,text,jsonb)',
    'public.save_site_board_content(uuid,integer,jsonb,jsonb)'];
BEGIN
  -- 표 2개: RLS·정책 0·권한 = service_role SELECT 만(anon·authenticated·PUBLIC 0)
  FOREACH v_rel IN ARRAY ARRAY['public.site_board_posts', 'public.site_board_post_revisions'] LOOP
    IF to_regclass(v_rel) IS NULL OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass(v_rel))
       OR (SELECT count(*) FROM pg_policy pol WHERE pol.polrelid = to_regclass(v_rel)) <> 0
       OR NOT has_table_privilege('service_role', v_rel, 'SELECT')
       OR has_table_privilege('service_role', v_rel, 'INSERT') OR has_table_privilege('service_role', v_rel, 'UPDATE')
       OR has_table_privilege('service_role', v_rel, 'DELETE') OR has_table_privilege('service_role', v_rel, 'TRUNCATE')
       OR has_table_privilege('anon', v_rel, 'SELECT') OR has_table_privilege('anon', v_rel, 'INSERT')
       OR has_table_privilege('authenticated', v_rel, 'SELECT') OR has_table_privilege('authenticated', v_rel, 'INSERT')
       OR has_table_privilege('authenticated', v_rel, 'UPDATE') OR has_table_privilege('authenticated', v_rel, 'DELETE')
       OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = to_regclass(v_rel) AND a.grantee = 0) THEN
      RAISE EXCEPTION 'VERIFY: % table / RLS / privileges', v_rel;
    END IF;
  END LOOP;
  -- CHECK·인덱스·FK: 글 표는 FK 0(행위자 칸 FK 없음), 판 이력은 글 표를 가리키는 FK 1개뿐
  IF (SELECT count(*) FROM pg_constraint c WHERE c.conrelid = 'public.site_board_posts'::regclass AND c.contype = 'c') <> 14
     OR (SELECT count(*) FROM pg_constraint c WHERE c.conrelid = 'public.site_board_post_revisions'::regclass AND c.contype = 'c'
           AND c.conname = 'site_board_post_revisions_sha256') <> 1
     OR (SELECT count(*) FROM pg_constraint c WHERE c.conrelid = 'public.site_board_posts'::regclass AND c.contype = 'f') <> 0
     OR (SELECT count(*) FROM pg_constraint c WHERE c.conrelid = 'public.site_board_post_revisions'::regclass AND c.contype = 'f') <> 1
     OR (SELECT count(*) FROM pg_constraint c WHERE c.conrelid = 'public.site_board_post_revisions'::regclass AND c.contype = 'f'
           AND c.confrelid = 'public.site_board_posts'::regclass) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'site_board_posts' AND indexname = 'site_board_posts_published'
                     AND indexdef LIKE '%WHERE (is_published AND (deleted_at IS NULL))%') THEN
    RAISE EXCEPTION 'VERIFY: site_board CHECK / FK / index';
  END IF;
  -- 판 이력 가드 트리거 2개
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.site_board_post_revisions'::regclass AND NOT t.tgisinternal AND t.tgenabled = 'O'
       AND t.tgname IN ('guard_site_board_post_revisions_mutation', 'guard_site_board_post_revisions_truncate')) <> 2 THEN
    RAISE EXCEPTION 'VERIFY: revisions guard triggers';
  END IF;
  -- 함수 7개: SECURITY DEFINER·search_path·EXECUTE 는 service_role 만. 가드 함수는 아무도.
  FOREACH v_fn IN ARRAY v_functions LOOP
    IF to_regprocedure(v_fn) IS NULL
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS NOT TRUE
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND 'search_path=public, pg_temp' = ANY (p.proconfig))
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = to_regprocedure(v_fn) AND a.grantee = 0) THEN
      RAISE EXCEPTION 'VERIFY: % SECURITY DEFINER / search_path / EXECUTE', v_fn;
    END IF;
  END LOOP;
  v_fn := 'public.guard_site_board_post_revisions_mutation()';
  IF has_function_privilege('service_role', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND 'search_path=public, pg_temp' = ANY (p.proconfig)) THEN
    RAISE EXCEPTION 'VERIFY: guard function privileges / search_path';
  END IF;
  -- 설정 행: revision·필수 키(비지 않은 글)·maxPinned·분류·가림 문구, 개인정보 없음
  SELECT value INTO v_value FROM public.system_settings WHERE key = 'site_board_content';
  IF v_value IS NULL OR jsonb_typeof(v_value -> 'revision') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'VERIFY: site_board_content shape';
  END IF;
  FOREACH v_key IN ARRAY v_notice_keys LOOP
    IF jsonb_typeof(v_value -> 'notice' -> v_key) IS DISTINCT FROM 'string' OR btrim(v_value -> 'notice' ->> v_key) = '' THEN
      RAISE EXCEPTION 'VERIFY: site_board_content notice.%', v_key;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY v_faq_keys LOOP
    IF jsonb_typeof(v_value -> 'faq' -> v_key) IS DISTINCT FROM 'string' OR btrim(v_value -> 'faq' ->> v_key) = '' THEN
      RAISE EXCEPTION 'VERIFY: site_board_content faq.%', v_key;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY v_footer_keys LOOP
    IF jsonb_typeof(v_value -> 'footer' -> v_key) IS DISTINCT FROM 'string' OR btrim(v_value -> 'footer' ->> v_key) = '' THEN
      RAISE EXCEPTION 'VERIFY: site_board_content footer.%', v_key;
    END IF;
  END LOOP;
  IF jsonb_typeof(v_value -> 'redactedText') IS DISTINCT FROM 'string' OR char_length(v_value ->> 'redactedText') NOT BETWEEN 1 AND 100
     OR jsonb_typeof(v_value -> 'notice' -> 'maxPinned') IS DISTINCT FROM 'number'
     OR (v_value #>> '{notice,maxPinned}')::integer NOT BETWEEN 1 AND 20
     OR jsonb_typeof(v_value -> 'faq' -> 'categories') IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_value -> 'faq' -> 'categories') < 1
     -- 개인정보 검사 범위는 save_site_board_content 와 같다(필수 키·footer·FAQ 분류 이름·가림 문구 — 설정 행의 모든 글 값)
     OR EXISTS (SELECT 1 FROM jsonb_path_query(v_value, '$.** ? (@.type() == "string")') s
                 WHERE cardinality(public.member_facing_text_pii_hits(s #>> '{}')) > 0) THEN
    RAISE EXCEPTION 'VERIFY: site_board_content values';
  END IF;
END;
$verify_bundle14_site_board$;

NOTIFY pgrst, 'reload schema';
