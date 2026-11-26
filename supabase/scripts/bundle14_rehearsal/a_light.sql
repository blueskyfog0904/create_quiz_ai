-- 14번 묶음 리허설: A light — 마이그레이션 원본 그대로, 경우 A·B1~B8(B7 기록은 각 경우 안에서)
-- 생성 파일(손으로 고치지 않는다): node supabase/scripts/bundle14_rehearsal/generate.mjs 가 원본에서 만든다.
-- 실행: supabase db query --remote --yes -o json --file supabase/scripts/bundle14_rehearsal/<이 파일> (COMMIT 없음, 마지막 SELECT 가 결과)
-- 언제: 지금 돌려도 됨(새 표 2개·새 함수·system_settings 행 1개 — 기존 표의 LOCK/ALTER TABLE·TRIGGER·POLICY·FK 없음, 시험 계정 행·권한 행의 행 잠금뿐). 이력 표는 쓰지 않는다.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '300s';
CREATE TEMP TABLE _rh_log (n serial PRIMARY KEY, test text NOT NULL, msg text NOT NULL, payload jsonb) ON COMMIT DROP;
CREATE TEMP TABLE _rh_ctx (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON _rh_log, _rh_ctx TO PUBLIC;
GRANT USAGE ON SEQUENCE _rh_log_n_seq TO PUBLIC;

CREATE FUNCTION pg_temp.ctx_set(p_k text, p_v text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO _rh_ctx (k, v) VALUES (p_k, p_v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v
$f$;
CREATE FUNCTION pg_temp.ctx(p_k text) RETURNS text LANGUAGE sql AS $f$ SELECT v FROM _rh_ctx WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.uid(p_k text) RETURNS uuid LANGUAGE sql AS $f$ SELECT v::uuid FROM _rh_ctx WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.fail(p_test text, p_msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  RAISE EXCEPTION 'RH FAIL [%] %', p_test, left(p_msg, 850);
END $f$;
-- 동적 SQL 을 실행하고 'OK' 또는 'ERR 메시지 [SQLSTATE]'(앞 300자)를 돌려준다. 실패하면 그 문장의 변경은 되돌려진다.
CREATE FUNCTION pg_temp.try_sql(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR ' || left(SQLERRM, 300) || ' [' || SQLSTATE || ']';
END $f$;
-- 결과(jsonb)를 돌려주는 함수 호출: 'OK {json}' 또는 'ERR 메시지'
CREATE FUNCTION pg_temp.try_json(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v jsonb;
BEGIN
  EXECUTE p_sql INTO v;
  RETURN 'OK ' || coalesce(v::text, 'null');
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR ' || left(SQLERRM, 300) || ' [' || SQLSTATE || ']';
END $f$;
CREATE FUNCTION pg_temp.res(p_result text) RETURNS jsonb LANGUAGE sql AS $f$ SELECT substr(p_result, 4)::jsonb $f$;
CREATE FUNCTION pg_temp.new_id(p_result text) RETURNS uuid LANGUAGE sql AS $f$ SELECT (substr(p_result, 4)::jsonb ->> 'id')::uuid $f$;
CREATE FUNCTION pg_temp.expect(p_actual text, p_prefix text, p_test text, p_msg text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_actual IS NULL OR p_actual NOT LIKE p_prefix || '%' THEN
    PERFORM pg_temp.fail(p_test, p_msg || ' — 기대 "' || p_prefix || '", 실제 "' || left(coalesce(p_actual, 'NULL'), 400) || '"');
  END IF;
  RETURN p_msg || ' → ' || left(p_actual, 120);
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
CREATE FUNCTION pg_temp.grants(p_owner uuid, p_staff uuid, p_keys text[]) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.replace_admin_permission_grants(%L, %L, %L::jsonb)', p_owner, p_staff,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('permission', k)), '[]'::jsonb) FROM unnest(p_keys) k)))
$f$;
-- 이 거래에서 남긴 작업 기록(created_at 기본값 now() = 거래 시작 시각, 앞 경우들은 되돌려져 없다)
CREATE FUNCTION pg_temp.audit_count(p_action text) RETURNS integer LANGUAGE sql AS $f$
  SELECT count(*)::integer FROM public.admin_audit_log WHERE action = p_action AND created_at >= now()
$f$;
-- 그 종류의 기록이 모두: reason NULL, details 키가 정한 목록과 같음, request 가 객체, 넘긴 제목·본문 글이 들어 있지 않음
CREATE FUNCTION pg_temp.audit_ok(p_action text, p_keys text[], p_forbidden text[]) RETURNS boolean LANGUAGE sql AS $f$
  SELECT count(*) > 0 AND bool_and(a.reason IS NULL
     AND ARRAY(SELECT k FROM jsonb_object_keys(a.details) k ORDER BY k COLLATE "C") = p_keys
     AND jsonb_typeof(a.details -> 'request') = 'object'
     AND NOT EXISTS (SELECT 1 FROM unnest(p_forbidden) f WHERE strpos(a.details::text, f) > 0))
    FROM public.admin_audit_log a WHERE a.action = p_action AND a.created_at >= now()
$f$;
-- 글 저장(결과 'OK {json}' 또는 'ERR …')
CREATE FUNCTION pg_temp.save(p_actor uuid, p_board text, p_title text, p_body text, p_id uuid DEFAULT NULL, p_rev integer DEFAULT NULL,
  p_link text DEFAULT NULL, p_label text DEFAULT NULL, p_cat text DEFAULT NULL, p_pinned boolean DEFAULT false, p_published boolean DEFAULT true)
  RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.save_site_board_post(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L::jsonb)',
    p_actor, p_id, p_rev, p_board, p_title, p_body, p_link, p_label, p_cat, p_pinned, p_published, '{"ip": "203.0.113.14", "user_agent": "rh14"}'))
$f$;
CREATE FUNCTION pg_temp.del(p_actor uuid, p_id uuid, p_rev integer) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.delete_site_board_post(%L, %L, %L, %L::jsonb)', p_actor, p_id, p_rev, '{"ip": "203.0.113.14", "user_agent": "rh14"}'))
$f$;
CREATE FUNCTION pg_temp.reorder(p_actor uuid, p_board text, p_scope text, p_ids uuid[]) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.reorder_site_board_posts(%L, %L, %L, %L::uuid[], %L::jsonb)', p_actor, p_board, p_scope, p_ids, '{"ip": "203.0.113.14", "user_agent": "rh14"}'))
$f$;
CREATE FUNCTION pg_temp.redact(p_actor uuid, p_id uuid, p_code text DEFAULT 'pii') RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.redact_site_board_post(%L, %L, %L, %L::jsonb)', p_actor, p_id, p_code, '{"ip": "203.0.113.14", "user_agent": "rh14"}'))
$f$;
CREATE FUNCTION pg_temp.content(p_actor uuid, p_rev integer, p_value jsonb) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.save_site_board_content(%L, %L, %L::jsonb, %L::jsonb)', p_actor, p_rev, p_value, '{"ip": "203.0.113.14", "user_agent": "rh14"}'))
$f$;
-- 새 표를 읽는 도우미는 plpgsql(만들 때 본문을 검사하지 않음 — 표는 마이그레이션 뒤에 생긴다)
CREATE FUNCTION pg_temp.rev(p_id uuid) RETURNS integer LANGUAGE plpgsql AS $f$
BEGIN
  RETURN (SELECT revision FROM public.site_board_posts WHERE id = p_id);
END $f$;
CREATE FUNCTION pg_temp.content_value() RETURNS jsonb LANGUAGE sql AS $f$ SELECT value FROM public.system_settings WHERE key = 'site_board_content' $f$;
CREATE FUNCTION pg_temp.content_rev() RETURNS integer LANGUAGE sql AS $f$ SELECT (value ->> 'revision')::integer FROM public.system_settings WHERE key = 'site_board_content' $f$;
-- 회원 공지 목록 순서(코드 site-board-server.ts 와 같은 규칙: 고정 sort_order,id → 비고정 published_at DESC,id)
CREATE FUNCTION pg_temp.notice_order() RETURNS uuid[] LANGUAGE plpgsql AS $f$
BEGIN
  RETURN (SELECT coalesce(array_agg(id ORDER BY NOT is_pinned, CASE WHEN is_pinned THEN sort_order END, CASE WHEN NOT is_pinned THEN published_at END DESC, id), '{}')
            FROM public.site_board_posts WHERE board = 'notice' AND is_published AND deleted_at IS NULL);
END $f$;
-- 화면 세션처럼(역할 + JWT claims) 한 값을 읽는다: 'OK 값' 또는 'ERR … [SQLSTATE]'. 끝나면 역할·claims 를 되돌린다.
CREATE FUNCTION pg_temp.as_session(p_sub uuid, p_role text, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v text;
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN p_sub IS NULL THEN '' ELSE jsonb_build_object('sub', p_sub, 'role', p_role)::text END, true);
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql INTO v;
    RESET ROLE;
    v := 'OK ' || coalesce(v, 'null');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v := 'ERR ' || left(SQLERRM, 300) || ' [' || SQLSTATE || ']';
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v;
END $f$;

-- 원본 사본(생성기가 원본 파일에서 꺼낸 글 그대로)
SELECT pg_temp.ctx_set('src_migration', $rh_src_migration$-- 출시 전 작업 순서표 14번 묶음: 공지 게시판 + FAQ(계획 docs/plan-bundle14-notice-faq.md 3판, 5절).
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
$rh_src_migration$);
SELECT pg_temp.ctx_set('src_down', $rh_src_down$-- 14번 묶음 되돌리기(supabase/migrations/20261217140000_bundle14_site_board.sql 의 down). 계획 docs/plan-bundle14-notice-faq.md 5-7.
-- 코드를 14번 전으로 되돌린 뒤에만 실행한다(새 코드는 표·함수가 없으면 하단 링크만 빼고, 공지·FAQ 화면은 오류가 난다).
-- 머리 확인(하나라도 어기면 멈춤):
--   ① 14번 표 2개가 있음(14번 적용 상태)
--   ② 16번 함수가 없음 — member_facing_text_pii_hits 를 부르는 16번 함수는 plpgsql 본문이라 의존성으로 잡히지 않으므로 이름으로 본다:
--      send_member_broadcast·save_member_notification_texts·retract_member_broadcast·member_broadcast_preview, 5인자 reject_point_charge_refund(16번 5-8).
--      개인정보 판정 함수를 지워 환불 거절이 실행 중에 깨지는 일을 막는다.
--   ③ site_board_posts 를 가리키는 FK 가운데 14번 판 이력 표(site_board_post_revisions)의 것이 아닌 것이 없음.
--      16번 down 은 함수와 post_id FK 를 지우고 기록 표는 증빙으로 남기므로, 기록 표가 있는 것만으로는 멈추지 않는다.
--   ④ 글이 1건이라도 있으면 대표 확인(c_allow_drop_posts = true) 전 멈춤. 지울 때 16번 기록 표에 post_id 가 남으면 그 값은 지워진 글을
--      가리키게 된다(기록 표는 가드로 고칠 수 없음) — 그래서 16번을 다시 적용할 때 FK 를 NOT VALID 로 붙인다(16번 5-1).
-- 순서: 함수 → 표 2개(가드 트리거는 표와 함께) → 가드 함수 → 설정 행.
-- 이 파일은 이력 행을 지우지 않는다. 다시 적용하려면 같은 거래에서 schema_migrations 의 '20261217140000' 행을 지운 뒤 마이그레이션과 이력 INSERT 를 넣는다.
-- 잠금: 14번 표만 지운다(ACCESS EXCLUSIVE, 새 표). system_settings 는 행 1개 삭제뿐.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $precheck_bundle14_site_board_down$
DECLARE
  c_allow_drop_posts constant boolean := false;
  v_bundle16_functions text[] := ARRAY['send_member_broadcast', 'save_member_notification_texts', 'retract_member_broadcast', 'member_broadcast_preview'];
BEGIN
  IF to_regclass('public.site_board_posts') IS NULL OR to_regclass('public.site_board_post_revisions') IS NULL THEN
    RAISE EXCEPTION 'DOWN PRECHECK: bundle 14 tables missing (not the bundle 14 state)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (v_bundle16_functions))
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'reject_point_charge_refund' AND p.pronargs = 5) THEN
    RAISE EXCEPTION 'DOWN PRECHECK: bundle 16 functions exist — roll back bundle 16 first';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint c
              WHERE c.contype = 'f' AND c.confrelid = 'public.site_board_posts'::regclass
                AND c.conrelid <> 'public.site_board_post_revisions'::regclass) THEN
    RAISE EXCEPTION 'DOWN PRECHECK: other foreign keys reference site_board_posts — roll back that bundle first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.site_board_posts) AND NOT c_allow_drop_posts THEN
    RAISE EXCEPTION 'DOWN PRECHECK: posts exist — owner confirms (c_allow_drop_posts)';
  END IF;
END;
$precheck_bundle14_site_board_down$;

-- [14번] 시작: 되돌림 ----------------------------------------------------------------------------------------------
-- 1. 함수
DROP FUNCTION public.save_site_board_content(uuid, integer, jsonb, jsonb);
DROP FUNCTION public.redact_site_board_post(uuid, uuid, text, jsonb);
DROP FUNCTION public.reorder_site_board_posts(uuid, text, text, uuid[], jsonb);
DROP FUNCTION public.delete_site_board_post(uuid, uuid, integer, jsonb);
DROP FUNCTION public.save_site_board_post(uuid, uuid, integer, text, text, text, text, text, text, boolean, boolean, jsonb);
DROP FUNCTION public.member_facing_text_pii_hits(text);
DROP FUNCTION public.site_board_actor_allowed(uuid);

-- 2. 표(판 이력 먼저 — 글 표를 가리킨다). 가드 트리거는 표와 함께 지워진다.
DROP TABLE public.site_board_post_revisions;
DROP TABLE public.site_board_posts;
DROP FUNCTION public.guard_site_board_post_revisions_mutation();

-- 3. 설정 행
DELETE FROM public.system_settings WHERE key = 'site_board_content';

DO $verify_bundle14_site_board_down$
BEGIN
  IF to_regclass('public.site_board_posts') IS NOT NULL OR to_regclass('public.site_board_post_revisions') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN (
       'site_board_actor_allowed', 'member_facing_text_pii_hits', 'save_site_board_post', 'delete_site_board_post',
       'reorder_site_board_posts', 'redact_site_board_post', 'save_site_board_content', 'guard_site_board_post_revisions_mutation'))
     OR EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'site_board_content') THEN
    RAISE EXCEPTION 'DOWN VERIFY: bundle 14 objects remain';
  END IF;
END;
$verify_bundle14_site_board_down$;

NOTIFY pgrst, 'reload schema';
$rh_src_down$);
SELECT pg_temp.ctx_set('mode', 'light');

-- ===== 계정: @test.com 시험 계정만(관리자·탈퇴 아님, 가입 완료) 4개 — 대표(owner)·직원(staff)·회원(E)·행위자 예시용(X).
--       모자라면 멈춘다(실회원 id 로 대신하지 않음). =====
DO $rh_setup$
DECLARE
  v_pool uuid[];
BEGIN
  SELECT coalesce(array_agg(p.id ORDER BY u.created_at), '{}') INTO v_pool
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE u.email LIKE '%@test.com' AND p.withdrawn_at IS NULL AND p.is_admin IS NOT TRUE AND p.signup_completed IS TRUE;
  IF cardinality(v_pool) < 4 THEN
    RAISE EXCEPTION 'RH FAIL [setup] @test.com 시험 계정이 모자람(%개, 필요 4) — 실회원 id 로 대신하지 않고 멈춘다', cardinality(v_pool);
  END IF;
  PERFORM pg_temp.ctx_set('owner', v_pool[1]::text);
  PERFORM pg_temp.ctx_set('staff', v_pool[2]::text);
  PERFORM pg_temp.ctx_set('E', v_pool[3]::text);
  PERFORM pg_temp.ctx_set('X', v_pool[4]::text);
  INSERT INTO _rh_log (test, msg, payload) VALUES ('setup', '시험 계정 배정(@test.com 만)', jsonb_build_object('pool', cardinality(v_pool)));
END
$rh_setup$;

-- ===== 14번 마이그레이션(원본 그대로) =====
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


DO $rh_roles$
BEGIN
  UPDATE public.profiles SET is_admin = true, admin_role = 'owner' WHERE id = pg_temp.uid('owner');
  UPDATE public.profiles SET is_admin = true, admin_role = 'staff' WHERE id = pg_temp.uid('staff');
  PERFORM pg_temp.expect(pg_temp.grants(pg_temp.uid('owner'), pg_temp.uid('staff'), ARRAY['content.manage']), 'OK', 'setup', '직원에게 content.manage');
END
$rh_roles$;

DO $rh_a$
BEGIN
  PERFORM pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'ERR PRECHECK: bundle 14 tables already exist', 'A', '다시 적용 거절');
  PERFORM pg_temp.ensure(pg_temp.content_rev() = 1 AND jsonb_array_length(pg_temp.content_value() #> '{faq,categories}') = 4
    AND (pg_temp.content_value() #>> '{notice,maxPinned}')::integer = 5, 'A', '설정 행 revision 1·FAQ 분류 4개·고정 상한 5');
  INSERT INTO _rh_log (test, msg, payload)
  SELECT 'A', '적용 뒤 함수 지문(md5(pg_get_functiondef))', jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)))
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('site_board_actor_allowed', 'member_facing_text_pii_hits', 'save_site_board_post',
     'delete_site_board_post', 'reorder_site_board_posts', 'redact_site_board_post', 'save_site_board_content', 'guard_site_board_post_revisions_mutation');
  INSERT INTO _rh_log (test, msg) VALUES ('A', 'VERIFY 통과(마이그레이션 안 블록)·다시 적용 거절·설정 행');
END
$rh_a$;

DO $rh_b1$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_at timestamptz;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    -- 글이 있으면 멈춤(대표 확인 상수 전)
    v_r := pg_temp.save(v_owner, 'notice', '되돌리기 시험 공지', '본문');
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'B1', '글 1건');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: posts exist', 'B1', '글 있으면 down 멈춤');
    -- 16번 함수(이름)가 있으면 멈춤
    EXECUTE 'CREATE FUNCTION public.send_member_broadcast() RETURNS void LANGUAGE sql AS $x$ SELECT $x$';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.subst_once(pg_temp.ctx('src_down'), '  c_allow_drop_posts constant boolean := false;', '  c_allow_drop_posts constant boolean := true;')),
      'ERR DOWN PRECHECK: bundle 16 functions exist', 'B1', '16번 함수 있으면 멈춤');
    EXECUTE 'DROP FUNCTION public.send_member_broadcast()';
    EXECUTE 'CREATE FUNCTION public.reject_point_charge_refund(uuid, uuid, text, text, jsonb) RETURNS void LANGUAGE sql AS $x$ SELECT $x$';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.subst_once(pg_temp.ctx('src_down'), '  c_allow_drop_posts constant boolean := false;', '  c_allow_drop_posts constant boolean := true;')),
      'ERR DOWN PRECHECK: bundle 16 functions exist', 'B1', '5인자 reject_point_charge_refund 있으면 멈춤');
    EXECUTE 'DROP FUNCTION public.reject_point_charge_refund(uuid, uuid, text, text, jsonb)';
    -- 판 이력 표가 아닌 FK 가 글 표를 가리키면 멈춤
    EXECUTE 'CREATE TABLE public._rh14_broadcast_fk (id serial PRIMARY KEY, post_id uuid REFERENCES public.site_board_posts(id))';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.subst_once(pg_temp.ctx('src_down'), '  c_allow_drop_posts constant boolean := false;', '  c_allow_drop_posts constant boolean := true;')),
      'ERR DOWN PRECHECK: other foreign keys reference site_board_posts', 'B1', '다른 FK 있으면 멈춤');
    EXECUTE 'DROP TABLE public._rh14_broadcast_fk';
    -- 16번 down 뒤 상태(기록 표만 남고 FK 없음)는 통과 — 판 이력 표의 FK 는 세지 않는다
    EXECUTE 'CREATE TABLE public._rh14_member_broadcasts (id serial PRIMARY KEY, post_id uuid)';
    EXECUTE format('INSERT INTO public._rh14_member_broadcasts (post_id) VALUES (%L)', pg_temp.new_id(v_r));
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.subst_once(pg_temp.ctx('src_down'), '  c_allow_drop_posts constant boolean := false;', '  c_allow_drop_posts constant boolean := true;')),
      'OK', 'B1', '16번 down 뒤 상태(기록 표만, FK 없음)·대표 확인 뒤 down 통과');
    v_log := v_log || pg_temp.ensure(to_regclass('public.site_board_posts') IS NULL AND to_regclass('public.site_board_post_revisions') IS NULL
      AND to_regprocedure('public.member_facing_text_pii_hits(text)') IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'site_board_content'), 'B1', '남는 것 0(표·함수·설정 행)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'B1', '다시 적용(VERIFY 통과)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'B1', '글 없는 상태 down 은 확인 상수 없이 통과');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: bundle 14 tables missing', 'B1', '두 번째 down 은 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'B1', '다시 적용');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'B1', m FROM unnest(v_log) m;
END
$rh_b1$;

DO $rh_b2_0$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_at timestamptz;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    UPDATE public.profiles SET is_admin = true, admin_role = 'owner' WHERE id = v_x;
    v_log := v_log || pg_temp.ensure(public.site_board_actor_allowed(v_x) IS TRUE, 'B2', '대표 — 판정 통과');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_x, 'notice', '권한 시험', '본문'), 'OK', 'B2', '대표 — 저장');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_x, 1, pg_temp.content_value()), 'OK', 'B2', '대표 — 안내 문구 저장');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'B2', m FROM unnest(v_log) m;
END
$rh_b2_0$;

DO $rh_b2_1$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_at timestamptz;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    UPDATE public.profiles SET is_admin = true, admin_role = 'staff' WHERE id = v_x;
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_x, ARRAY['content.manage']::text[]), 'OK', 'B2', 'content.manage 직원 — 권한 주기');
    v_log := v_log || pg_temp.ensure(public.site_board_actor_allowed(v_x) IS TRUE, 'B2', 'content.manage 직원 — 판정 통과');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_x, 'notice', '권한 시험', '본문'), 'OK', 'B2', 'content.manage 직원 — 저장');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_x, 1, pg_temp.content_value()), 'OK', 'B2', 'content.manage 직원 — 안내 문구 저장');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'B2', m FROM unnest(v_log) m;
END
$rh_b2_1$;

DO $rh_b2_2$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_at timestamptz;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    UPDATE public.profiles SET is_admin = true, admin_role = 'staff' WHERE id = v_x;
    v_log := v_log || pg_temp.ensure(public.site_board_actor_allowed(v_x) IS FALSE, 'B2', '권한 0 직원 — 판정 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_x, 'notice', '권한 시험', '본문'), 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED', 'B2', '권한 0 직원 — 저장');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_x, 1, pg_temp.content_value()), 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED', 'B2', '권한 0 직원 — 안내 문구 저장');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'B2', m FROM unnest(v_log) m;
END
$rh_b2_2$;

DO $rh_b2_3$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_at timestamptz;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    UPDATE public.profiles SET is_admin = true, admin_role = 'staff' WHERE id = v_x;
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_x, ARRAY['support.manage']::text[]), 'OK', 'B2', '다른 권한만 받은 직원 — 권한 주기');
    v_log := v_log || pg_temp.ensure(public.site_board_actor_allowed(v_x) IS FALSE, 'B2', '다른 권한만 받은 직원 — 판정 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_x, 'notice', '권한 시험', '본문'), 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED', 'B2', '다른 권한만 받은 직원 — 저장');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_x, 1, pg_temp.content_value()), 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED', 'B2', '다른 권한만 받은 직원 — 안내 문구 저장');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'B2', m FROM unnest(v_log) m;
END
$rh_b2_3$;

DO $rh_b2_4$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_at timestamptz;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    -- admin_role 이 빈 관리자(DB 가 더 엄격 — TS buildAdminAccess 는 staff 로 봄, DB CHECK 가 이 상태를 막음): profiles CHECK((is_admin IS TRUE) = (admin_role IS NOT NULL)) 가 이 상태를 막는다(DB 가 TS 보다 엄격)
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.profiles SET is_admin = true, admin_role = NULL WHERE id = %L', v_x)),
      'ERR', 'B2', 'admin_role 이 빈 관리자(DB 가 더 엄격 — TS buildAdminAccess 는 staff 로 봄, DB CHECK 가 이 상태를 막음) — 상태 자체가 CHECK 로 거절');
    v_log := v_log || pg_temp.ensure(public.site_board_actor_allowed(v_x) IS FALSE, 'B2', 'admin_role 이 빈 관리자(DB 가 더 엄격 — TS buildAdminAccess 는 staff 로 봄, DB CHECK 가 이 상태를 막음) — 판정 거절');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'B2', m FROM unnest(v_log) m;
END
$rh_b2_4$;

DO $rh_b2_5$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_at timestamptz;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    UPDATE public.profiles SET is_admin = true, admin_role = 'staff' WHERE id = v_x;
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_x, ARRAY['content.manage']::text[]), 'OK', 'B2', 'is_admin=false 인데 권한 행 남음 — 권한 주기');
    UPDATE public.profiles SET is_admin = false, admin_role = NULL WHERE id = v_x;
    v_log := v_log || pg_temp.ensure(EXISTS (SELECT 1 FROM public.admin_permission_grants g WHERE g.user_id = v_x AND g.permission = 'content.manage'), 'B2', 'is_admin=false 인데 권한 행 남음 — 권한 행 남음');
    v_log := v_log || pg_temp.ensure(public.site_board_actor_allowed(v_x) IS FALSE, 'B2', 'is_admin=false 인데 권한 행 남음 — 판정 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_x, 'notice', '권한 시험', '본문'), 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED', 'B2', 'is_admin=false 인데 권한 행 남음 — 저장');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_x, 1, pg_temp.content_value()), 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED', 'B2', 'is_admin=false 인데 권한 행 남음 — 안내 문구 저장');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'B2', m FROM unnest(v_log) m;
END
$rh_b2_5$;

DO $rh_b2_6$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_at timestamptz;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    UPDATE public.profiles SET is_admin = true, admin_role = 'owner' WHERE id = v_x;
    PERFORM set_config('app.member_withdrawal_bypass', v_x::text, true);
    UPDATE public.profiles SET withdrawn_at = now() WHERE id = v_x;
    PERFORM set_config('app.member_withdrawal_bypass', '', true);
    v_log := v_log || pg_temp.ensure(public.site_board_actor_allowed(v_x) IS FALSE, 'B2', '탈퇴 관리자(대표) — 판정 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_x, 'notice', '권한 시험', '본문'), 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED', 'B2', '탈퇴 관리자(대표) — 저장');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_x, 1, pg_temp.content_value()), 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED', 'B2', '탈퇴 관리자(대표) — 안내 문구 저장');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'B2', m FROM unnest(v_log) m;
END
$rh_b2_6$;

DO $rh_b2_7$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_at timestamptz;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.ensure(public.site_board_actor_allowed(v_x) IS FALSE, 'B2', '일반 회원 — 판정 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_x, 'notice', '권한 시험', '본문'), 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED', 'B2', '일반 회원 — 저장');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_x, 1, pg_temp.content_value()), 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED', 'B2', '일반 회원 — 안내 문구 저장');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'B2', m FROM unnest(v_log) m;
END
$rh_b2_7$;

DO $rh_b2_more$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_at timestamptz;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.save(gen_random_uuid(), 'notice', '없는 id', '본문'), 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED', 'B2', '없는 id 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save(NULL, 'notice', 'NULL', '본문'), 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED', 'B2', 'NULL 행위자 거절');
    v_r := pg_temp.save(v_staff, 'notice', '직원 글', '본문', NULL, NULL, NULL, NULL, NULL, false, false);
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'B2', 'content.manage 직원 저장(숨김)');
    v_log := v_log || pg_temp.expect(pg_temp.redact(v_staff, pg_temp.new_id(v_r)), 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED', 'B2', '가림은 직원 거절(대표만)');
    v_log := v_log || pg_temp.expect(pg_temp.redact(v_e, pg_temp.new_id(v_r)), 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED', 'B2', '가림은 회원 거절');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY[]::text[]), 'OK', 'B2', '직원 권한 회수');
    v_log := v_log || pg_temp.expect(pg_temp.del(v_staff, pg_temp.new_id(v_r), 1), 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED', 'B2', '권한 회수 뒤 삭제 거절');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_staff, 'notice', 'pinned', ARRAY[pg_temp.new_id(v_r)]), 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED', 'B2', '권한 회수 뒤 순서 거절');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'B2', m FROM unnest(v_log) m;
END
$rh_b2_more$;

DO $rh_b3$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_at timestamptz;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    -- 새 글: revision 1, 판 이력 1행, 처음 게시 날짜, 작업 기록 1건
    v_r := pg_temp.save(v_owner, 'notice', '새 공지 제목 RH14', '새 공지 본문 RH14');
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'B3', '새 글');
    v_id := pg_temp.new_id(v_r);
    v_log := v_log || pg_temp.ensure((SELECT revision = 1 AND published_at IS NOT NULL AND content_updated_at IS NULL AND created_by = v_owner AND sort_order = 0
      FROM public.site_board_posts WHERE id = v_id)
      AND (SELECT count(*) FROM public.site_board_post_revisions WHERE post_id = v_id) = 1
      AND pg_temp.audit_count('site_board_post_save') = 1, 'B3', 'revision 1·판 이력 1·게시 날짜·기록 1');
    -- 판 충돌·종류 바꾸기·없는 글
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '고침', '본문', v_id, 9), 'ERR SITE_BOARD_REVISION_CONFLICT', 'B3', '판 다르면 충돌');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '고침', '본문', v_id, NULL), 'ERR SITE_BOARD_REVISION_CONFLICT', 'B3', '판 없으면 충돌');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'faq', '고침', '본문', v_id, 1, NULL, NULL, 'credit'), 'ERR SITE_BOARD_INPUT_INVALID:board', 'B3', '종류 바꾸기 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '고침', '본문', gen_random_uuid(), 1), 'ERR SITE_BOARD_POST_NOT_FOUND', 'B3', '없는 글');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '새 글', '본문', NULL, 1), 'ERR SITE_BOARD_INPUT_INVALID:revision', 'B3', '새 글에 판');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'board', '새 글', '본문'), 'ERR SITE_BOARD_INPUT_INVALID:board', 'B3', '모르는 종류');
    -- 바뀐 것 없음: 기록·판 이력 0
    v_r := pg_temp.save(v_owner, 'notice', '  새 공지 제목 RH14  ', E'새 공지 본문 RH14\n', v_id, 1);
    v_log := v_log || pg_temp.ensure(v_r LIKE 'OK%' AND (pg_temp.res(v_r) -> 'changed') = 'false'::jsonb AND pg_temp.rev(v_id) = 1
      AND (SELECT count(*) FROM public.site_board_post_revisions WHERE post_id = v_id) = 1 AND pg_temp.audit_count('site_board_post_save') = 1,
      'B3', '바뀐 것 없음(다듬은 뒤 같음) → 기록·판 이력 0 ' || left(v_r, 80));
    -- 처음 게시 날짜 유지: 숨김 → 다시 게시
    SELECT published_at INTO v_at FROM public.site_board_posts WHERE id = v_id;
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '새 공지 제목 RH14', '새 공지 본문 RH14', v_id, 1, NULL, NULL, NULL, false, false), 'OK', 'B3', '숨김');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '새 공지 제목 RH14', '새 공지 본문 RH14', v_id, 2), 'OK', 'B3', '다시 게시');
    v_log := v_log || pg_temp.ensure((SELECT published_at = v_at AND content_updated_at IS NULL AND revision = 3 FROM public.site_board_posts WHERE id = v_id),
      'B3', '처음 게시 날짜 유지·게시 여부만 바뀌면 수정 날짜 없음');
    -- 게시 뒤 본문 수정 → content_updated_at, 고정만 바뀌면 그대로
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '새 공지 제목 RH14', '고친 본문 RH14', v_id, 3), 'OK', 'B3', '게시 뒤 본문 수정');
    SELECT content_updated_at INTO v_at FROM public.site_board_posts WHERE id = v_id;
    v_log := v_log || pg_temp.ensure(v_at IS NOT NULL, 'B3', '본문 수정 → 수정 날짜');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '새 공지 제목 RH14', '고친 본문 RH14', v_id, 4, NULL, NULL, NULL, true), 'OK', 'B3', '고정만 바꿈');
    v_log := v_log || pg_temp.ensure((SELECT content_updated_at = v_at FROM public.site_board_posts WHERE id = v_id)
      AND (SELECT count(*) FROM public.site_board_post_revisions WHERE post_id = v_id) = 5, 'B3', '고정만 → 수정 날짜 그대로, 판 이력 5행');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_ok('site_board_post_save', ARRAY['board', 'body_length', 'body_length_before', 'changed_fields', 'created', 'is_pinned_after', 'is_pinned_before', 'is_published_after', 'is_published_before', 'post_id', 'request', 'revision_after', 'revision_before', 'revision_row_id', 'saved_at', 'title_length']::text[], ARRAY['새 공지 제목 RH14', '새 공지 본문 RH14', '고친 본문 RH14']),
      'B3', '저장 기록 details 키·request·원문 없음');
    v_log := v_log || pg_temp.ensure((SELECT bool_and(r.body_sha256 = encode(sha256(convert_to(r.body, 'UTF8')), 'hex')) FROM public.site_board_post_revisions r WHERE r.post_id = v_id),
      'B3', '판 이력 지문 = 본문 sha256');
    -- 칸별 입력 오류
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '   ', '본문'), 'ERR SITE_BOARD_INPUT_INVALID:title', 'B3', '빈 제목');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', E'두\n줄', '본문'), 'ERR SITE_BOARD_INPUT_INVALID:title', 'B3', '두 줄 제목');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', repeat('가', 101), '본문'), 'ERR SITE_BOARD_INPUT_INVALID:title', 'B3', '101자 제목');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', repeat('가', 100), '본문'), 'OK', 'B3', '100자 제목');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '제목', ''), 'ERR SITE_BOARD_INPUT_INVALID:body', 'B3', '빈 본문');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '제목', repeat('가', 20001)), 'ERR SITE_BOARD_INPUT_INVALID:body', 'B3', '20001자 본문');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '제목', '본문', NULL, NULL, '/terms', NULL), 'ERR SITE_BOARD_INPUT_INVALID:linkLabel', 'B3', '링크 이름 없음');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '제목', '본문', NULL, NULL, '/terms', repeat('가', 31)), 'ERR SITE_BOARD_INPUT_INVALID:linkLabel', 'B3', '31자 링크 이름');
    v_r := pg_temp.save(v_owner, 'notice', '제목', '본문', NULL, NULL, NULL, '이름만');
    v_log := v_log || pg_temp.ensure(v_r LIKE 'OK%' AND (SELECT link_label IS NULL FROM public.site_board_posts WHERE id = pg_temp.new_id(v_r)), 'B3', '링크 없이 이름만 → 이름 버림');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '제목', '본문', NULL, NULL, NULL, NULL, 'credit'), 'ERR SITE_BOARD_INPUT_INVALID:faqCategoryKey', 'B3', '공지에 분류');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'faq', '질문', '답'), 'ERR SITE_BOARD_INPUT_INVALID:faqCategoryKey', 'B3', 'FAQ 분류 없음');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'faq', '질문', '답', NULL, NULL, NULL, NULL, 'nope'), 'ERR SITE_BOARD_INPUT_INVALID:faqCategoryKey', 'B3', 'FAQ 없는 분류');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'faq', '질문', '답', NULL, NULL, NULL, NULL, 'credit', true), 'ERR SITE_BOARD_INPUT_INVALID:isPinned', 'B3', 'FAQ 고정');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.save_site_board_post(%L, NULL, NULL, %L, %L, %L, NULL, NULL, NULL, false, true, %L::jsonb)',
      v_owner, 'notice', '제목', '본문', '[]')), 'ERR SITE_BOARD_INPUT_INVALID:request', 'B3', '요청 정보가 객체가 아님');
    -- 삭제한 글 고치기
    v_log := v_log || pg_temp.expect(pg_temp.del(v_owner, v_id, pg_temp.rev(v_id)), 'OK', 'B3', '삭제');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '고침', '본문', v_id, pg_temp.rev(v_id)), 'ERR SITE_BOARD_POST_DELETED', 'B3', '삭제 글 고치기 거절');
    -- 링크 예시 묶음(isAllowedNoticeLink 와 같은 표)
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 시험', '본문', NULL, NULL, '/terms/upcoming', '보기'), 'OK', 'B3', '링크 "/terms/upcoming"');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 시험', '본문', NULL, NULL, '/notices/abc?from=popup#top', '보기'), 'OK', 'B3', '링크 "/notices/abc?from=popup#top"');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 시험', '본문', NULL, NULL, '/', '보기'), 'OK', 'B3', '링크 "/"');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 시험', '본문', NULL, NULL, '/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '보기'), 'OK', 'B3', '링크 "/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 시험', '본문', NULL, NULL, '/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '보기'), 'ERR SITE_BOARD_INPUT_INVALID:linkUrl', 'B3', '링크 "/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 시험', '본문', NULL, NULL, 'https://example.com', '보기'), 'ERR SITE_BOARD_INPUT_INVALID:linkUrl', 'B3', '링크 "https://example.com"');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 시험', '본문', NULL, NULL, '//example.com', '보기'), 'ERR SITE_BOARD_INPUT_INVALID:linkUrl', 'B3', '링크 "//example.com"');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 시험', '본문', NULL, NULL, '/\example.com', '보기'), 'ERR SITE_BOARD_INPUT_INVALID:linkUrl', 'B3', '링크 "/\\example.com"');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 시험', '본문', NULL, NULL, '/a b', '보기'), 'ERR SITE_BOARD_INPUT_INVALID:linkUrl', 'B3', '링크 "/a b"');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 시험', '본문', NULL, NULL, '/a	b', '보기'), 'ERR SITE_BOARD_INPUT_INVALID:linkUrl', 'B3', '링크 "/a\tb"');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 시험', '본문', NULL, NULL, 'javascript:alert(1)', '보기'), 'ERR SITE_BOARD_INPUT_INVALID:linkUrl', 'B3', '링크 "javascript:alert(1)"');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 시험', '본문', NULL, NULL, 'notices', '보기'), 'ERR SITE_BOARD_INPUT_INVALID:linkUrl', 'B3', '링크 "notices"');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 시험', '본문', NULL, NULL, '/x?a=%00&q=hong%40naver.com', '보기'), 'ERR SITE_BOARD_INPUT_INVALID:linkUrl', 'B3', '링크 "/x?a=%00&q=hong%40naver.com"');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 시험', '본문', NULL, NULL, '/x?a=%1F', '보기'), 'ERR SITE_BOARD_INPUT_INVALID:linkUrl', 'B3', '링크 "/x?a=%1F"');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 시험', '본문', NULL, NULL, '/x?a=%7f', '보기'), 'ERR SITE_BOARD_INPUT_INVALID:linkUrl', 'B3', '링크 "/x?a=%7f"');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 시험', '본문', NULL, NULL, '/x?a=%20b', '보기'), 'OK', 'B3', '링크 "/x?a=%20b"');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'B3', m FROM unnest(v_log) m;
END
$rh_b3$;

DO $rh_b4$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_at timestamptz;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_cc text;
  v_mail text;
  v_cc_digits text;
BEGIN
  BEGIN

    v_cc := (SELECT value #>> '{fixedFields,customerCenter,value}' FROM public.system_settings WHERE key = 'site_footer_content');
    v_mail := (SELECT value #>> '{fixedFields,orderEmail,value}' FROM public.system_settings WHERE key = 'site_footer_content');
    v_cc_digits := regexp_replace(coalesce(v_cc, ''), '[^0-9]', '', 'g');
    v_log := v_log || pg_temp.ensure(coalesce(v_cc, '') <> '' AND coalesce(v_mail, '') <> '', 'B4', '하단 정보 고객센터 값 있음(운영 DB)');
    v_r := replace(replace(replace(replace('문의는 hello@example.com 으로 보내 주세요', '{customerCenterDigits}', v_cc_digits), '{customerCenter}', v_cc), '{orderEmailUpper}', upper(v_mail)), '{orderEmail}', v_mail);
    v_log := v_log || pg_temp.ensure(public.member_facing_text_pii_hits(v_r) = ARRAY['email']::text[], 'B4', '판정 문의는 hello@example.com 으로 → [email]');
    v_r := replace(replace(replace(replace('주문 메일 {orderEmail} 로 보내 주세요', '{customerCenterDigits}', v_cc_digits), '{customerCenter}', v_cc), '{orderEmailUpper}', upper(v_mail)), '{orderEmail}', v_mail);
    v_log := v_log || pg_temp.ensure(public.member_facing_text_pii_hits(v_r) = ARRAY[]::text[], 'B4', '판정 주문 메일 {orderEmail} 로 보내  → []');
    v_r := replace(replace(replace(replace('주문 메일 {orderEmailUpper}', '{customerCenterDigits}', v_cc_digits), '{customerCenter}', v_cc), '{orderEmailUpper}', upper(v_mail)), '{orderEmail}', v_mail);
    v_log := v_log || pg_temp.ensure(public.member_facing_text_pii_hits(v_r) = ARRAY[]::text[], 'B4', '판정 주문 메일 {orderEmailUpper} → []');
    v_r := replace(replace(replace(replace('휴대폰 010-1234-5678', '{customerCenterDigits}', v_cc_digits), '{customerCenter}', v_cc), '{orderEmailUpper}', upper(v_mail)), '{orderEmail}', v_mail);
    v_log := v_log || pg_temp.ensure(public.member_facing_text_pii_hits(v_r) = ARRAY['mobile']::text[], 'B4', '판정 휴대폰 010-1234-5678 → [mobile]');
    v_r := replace(replace(replace(replace('휴대폰 01012345678', '{customerCenterDigits}', v_cc_digits), '{customerCenter}', v_cc), '{orderEmailUpper}', upper(v_mail)), '{orderEmail}', v_mail);
    v_log := v_log || pg_temp.ensure(public.member_facing_text_pii_hits(v_r) = ARRAY['mobile']::text[], 'B4', '판정 휴대폰 01012345678 → [mobile]');
    v_r := replace(replace(replace(replace('휴대폰 010 1234 5678', '{customerCenterDigits}', v_cc_digits), '{customerCenter}', v_cc), '{orderEmailUpper}', upper(v_mail)), '{orderEmail}', v_mail);
    v_log := v_log || pg_temp.ensure(public.member_facing_text_pii_hits(v_r) = ARRAY['mobile']::text[], 'B4', '판정 휴대폰 010 1234 5678 → [mobile]');
    v_r := replace(replace(replace(replace('휴대폰 010.123.4567', '{customerCenterDigits}', v_cc_digits), '{customerCenter}', v_cc), '{orderEmailUpper}', upper(v_mail)), '{orderEmail}', v_mail);
    v_log := v_log || pg_temp.ensure(public.member_facing_text_pii_hits(v_r) = ARRAY['mobile']::text[], 'B4', '판정 휴대폰 010.123.4567 → [mobile]');
    v_r := replace(replace(replace(replace('고객센터 {customerCenter}', '{customerCenterDigits}', v_cc_digits), '{customerCenter}', v_cc), '{orderEmailUpper}', upper(v_mail)), '{orderEmail}', v_mail);
    v_log := v_log || pg_temp.ensure(public.member_facing_text_pii_hits(v_r) = ARRAY[]::text[], 'B4', '판정 고객센터 {customerCenter} → []');
    v_r := replace(replace(replace(replace('고객센터 {customerCenterDigits}', '{customerCenterDigits}', v_cc_digits), '{customerCenter}', v_cc), '{orderEmailUpper}', upper(v_mail)), '{orderEmail}', v_mail);
    v_log := v_log || pg_temp.ensure(public.member_facing_text_pii_hits(v_r) = ARRAY[]::text[], 'B4', '판정 고객센터 {customerCenterDigi → []');
    v_r := replace(replace(replace(replace('서울 02-123-4567', '{customerCenterDigits}', v_cc_digits), '{customerCenter}', v_cc), '{orderEmailUpper}', upper(v_mail)), '{orderEmail}', v_mail);
    v_log := v_log || pg_temp.ensure(public.member_facing_text_pii_hits(v_r) = ARRAY['phone']::text[], 'B4', '판정 서울 02-123-4567 → [phone]');
    v_r := replace(replace(replace(replace('경기 031-1234-5678', '{customerCenterDigits}', v_cc_digits), '{customerCenter}', v_cc), '{orderEmailUpper}', upper(v_mail)), '{orderEmail}', v_mail);
    v_log := v_log || pg_temp.ensure(public.member_facing_text_pii_hits(v_r) = ARRAY['phone']::text[], 'B4', '판정 경기 031-1234-5678 → [phone]');
    v_r := replace(replace(replace(replace('인터넷전화 070-1234-5678', '{customerCenterDigits}', v_cc_digits), '{customerCenter}', v_cc), '{orderEmailUpper}', upper(v_mail)), '{orderEmail}', v_mail);
    v_log := v_log || pg_temp.ensure(public.member_facing_text_pii_hits(v_r) = ARRAY['phone']::text[], 'B4', '판정 인터넷전화 070-1234-5678 → [phone]');
    v_r := replace(replace(replace(replace('주민번호 900101-1234567', '{customerCenterDigits}', v_cc_digits), '{customerCenter}', v_cc), '{orderEmailUpper}', upper(v_mail)), '{orderEmail}', v_mail);
    v_log := v_log || pg_temp.ensure(public.member_facing_text_pii_hits(v_r) = ARRAY['rrn']::text[], 'B4', '판정 주민번호 900101-1234567 → [rrn]');
    v_r := replace(replace(replace(replace('주민번호 9001011234567', '{customerCenterDigits}', v_cc_digits), '{customerCenter}', v_cc), '{orderEmailUpper}', upper(v_mail)), '{orderEmail}', v_mail);
    v_log := v_log || pg_temp.ensure(public.member_facing_text_pii_hits(v_r) = ARRAY['rrn']::text[], 'B4', '판정 주민번호 9001011234567 → [rrn]');
    v_r := replace(replace(replace(replace('주문번호 20261126-1234567', '{customerCenterDigits}', v_cc_digits), '{customerCenter}', v_cc), '{orderEmailUpper}', upper(v_mail)), '{orderEmail}', v_mail);
    v_log := v_log || pg_temp.ensure(public.member_facing_text_pii_hits(v_r) = ARRAY[]::text[], 'B4', '판정 주문번호 20261126-1234567 → []');
    v_r := replace(replace(replace(replace('가격 20,000원, 2026-11-26 시행', '{customerCenterDigits}', v_cc_digits), '{customerCenter}', v_cc), '{orderEmailUpper}', upper(v_mail)), '{orderEmail}', v_mail);
    v_log := v_log || pg_temp.ensure(public.member_facing_text_pii_hits(v_r) = ARRAY[]::text[], 'B4', '판정 가격 20,000원, 2026-11-26 시 → []');
    v_r := replace(replace(replace(replace('대표번호 1588-1234', '{customerCenterDigits}', v_cc_digits), '{customerCenter}', v_cc), '{orderEmailUpper}', upper(v_mail)), '{orderEmail}', v_mail);
    v_log := v_log || pg_temp.ensure(public.member_facing_text_pii_hits(v_r) = ARRAY[]::text[], 'B4', '판정 대표번호 1588-1234 → []');
    v_r := replace(replace(replace(replace('긴 숫자 0101234567890123', '{customerCenterDigits}', v_cc_digits), '{customerCenter}', v_cc), '{orderEmailUpper}', upper(v_mail)), '{orderEmail}', v_mail);
    v_log := v_log || pg_temp.ensure(public.member_facing_text_pii_hits(v_r) = ARRAY[]::text[], 'B4', '판정 긴 숫자 0101234567890123 → []');
    v_r := replace(replace(replace(replace('섞임 a.b@c.co.kr 그리고 010-9999-8888 그리고 02-555-1234', '{customerCenterDigits}', v_cc_digits), '{customerCenter}', v_cc), '{orderEmailUpper}', upper(v_mail)), '{orderEmail}', v_mail);
    v_log := v_log || pg_temp.ensure(public.member_facing_text_pii_hits(v_r) = ARRAY['email', 'mobile', 'phone']::text[], 'B4', '판정 섞임 a.b@c.co.kr 그리고 010-9 → [email,mobile,phone]');
    v_r := replace(replace(replace(replace('', '{customerCenterDigits}', v_cc_digits), '{customerCenter}', v_cc), '{orderEmailUpper}', upper(v_mail)), '{orderEmail}', v_mail);
    v_log := v_log || pg_temp.ensure(public.member_facing_text_pii_hits(v_r) = ARRAY[]::text[], 'B4', '판정  → []');
    -- 저장 거절(본문·링크 주소·링크 이름·제목), 응답에는 종류만
    v_r := pg_temp.save(v_owner, 'notice', '제목', '연락은 rh14person@example.com 으로');
    v_log := v_log || pg_temp.expect(v_r, 'ERR SITE_BOARD_PII_SUSPECTED:email', 'B4', '본문 이메일 거절');
    v_log := v_log || pg_temp.ensure(strpos(v_r, 'rh14person') = 0, 'B4', '응답에 글자 없음');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '제목', '본문', NULL, NULL, '/search?q=01012345678', '보기'), 'ERR SITE_BOARD_PII_SUSPECTED:mobile', 'B4', '링크 주소 휴대폰 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '제목', '본문', NULL, NULL, '/terms', 'a@b.co'), 'ERR SITE_BOARD_PII_SUSPECTED:email', 'B4', '링크 이름 이메일 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '주민 900101-1234567', '본문'), 'ERR SITE_BOARD_PII_SUSPECTED:rrn', 'B4', '제목 주민번호 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '제목', '서울 02-123-4567 그리고 010-1234-5678'), 'ERR SITE_BOARD_PII_SUSPECTED:mobile,phone', 'B4', '여러 종류는 이름순 목록');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '제목', '고객센터 ' || v_cc || ' / ' || v_cc_digits || ' / ' || v_mail), 'OK', 'B4', '고객센터 번호(하이픈 있음·없음)·주문 이메일 통과');
    -- 링크 주소는 퍼센트 인코딩을 푼 값도 검사(예시 묶음 linkPii 와 같은 표)
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 개인정보', '본문', NULL, NULL, '/search?q=hong%40naver.com', '보기'), 'ERR SITE_BOARD_PII_SUSPECTED:email', 'B4', '링크 /search?q=hong%40naver.com → ERR SITE_BOARD_PII_SUSPECTED:email');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 개인정보', '본문', NULL, NULL, '/x?p=010%2D1234%2D5678', '보기'), 'ERR SITE_BOARD_PII_SUSPECTED:mobile', 'B4', '링크 /x?p=010%2D1234%2D5678 → ERR SITE_BOARD_PII_SUSPECTED:mobile');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 개인정보', '본문', NULL, NULL, '/x?p=02%2E123%2E4567', '보기'), 'ERR SITE_BOARD_PII_SUSPECTED:phone', 'B4', '링크 /x?p=02%2E123%2E4567 → ERR SITE_BOARD_PII_SUSPECTED:phone');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 개인정보', '본문', NULL, NULL, '/x?p=%EC%95%88%EB%85%95', '보기'), 'OK', 'B4', '링크 /x?p=%EC%95%88%EB%85%95 → OK');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 개인정보', '본문', NULL, NULL, '/x?p=%zz%40a.com', '보기'), 'ERR SITE_BOARD_PII_SUSPECTED:email', 'B4', '링크 /x?p=%zz%40a.com → ERR SITE_BOARD_PII_SUSPECTED:email');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 개인정보', '본문', NULL, NULL, '/x?p=%FF%40a', '보기'), 'OK', 'B4', '링크 /x?p=%FF%40a → OK');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 개인정보', '본문', NULL, NULL, '/search?q=hong@naver.com', '보기'), 'ERR SITE_BOARD_PII_SUSPECTED:email', 'B4', '링크 /search?q=hong@naver.com → ERR SITE_BOARD_PII_SUSPECTED:email');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 개인정보', '본문', NULL, NULL, '/faq#00000000-0000-4000-8000-000000000201', '보기'), 'OK', 'B4', '링크 /faq#00000000-0000-4000-8000-000 → OK');
    -- 설정 문구도 검사
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 1, jsonb_set(pg_temp.content_value(), '{notice,pageDescription}', to_jsonb('문의 010-2222-3333'::text))),
      'ERR SITE_BOARD_PII_SUSPECTED:mobile', 'B4', '설정 문구 휴대폰 거절');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 1, jsonb_set(pg_temp.content_value(), '{faq,categories,0,label}', to_jsonb('x@y.co'::text))),
      'ERR SITE_BOARD_PII_SUSPECTED:email', 'B4', 'FAQ 분류 이름도 검사');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'B4', m FROM unnest(v_log) m;
END
$rh_b4$;

DO $rh_b5$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_at timestamptz;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    -- 고정 5개(그중 1개 숨김) → 6번째 고정 거절(숨긴 고정 포함)
    FOR v_n IN 1 .. 5 LOOP
      v_r := pg_temp.save(v_owner, 'notice', '고정 ' || v_n, '본문', NULL, NULL, NULL, NULL, NULL, true, v_n <> 3);
      PERFORM pg_temp.expect(v_r, 'OK', 'B5', '고정 ' || v_n);
      v_ids := coalesce(v_ids, '{}') || pg_temp.new_id(v_r);
    END LOOP;
    v_log := v_log || pg_temp.ensure((SELECT array_agg(sort_order ORDER BY created_at) FROM public.site_board_posts WHERE id = ANY (v_ids)) = ARRAY[1, 2, 3, 4, 5],
      'B5', '새 고정 글은 고정 맨 뒤(1~5)');
    v_r := pg_temp.save(v_owner, 'notice', '비고정 1', '본문');
    v_p := pg_temp.new_id(v_r);
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '고정 6', '본문', NULL, NULL, NULL, NULL, NULL, true), 'ERR SITE_BOARD_PIN_LIMIT', 'B5', '상한 초과(숨긴 고정 포함)');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '비고정 1', '본문', v_p, 1, NULL, NULL, NULL, true), 'ERR SITE_BOARD_PIN_LIMIT', 'B5', '기존 글 고정도 상한');
    -- 고정 해제 → 0·날짜 자리, 기존 글 고정 → 맨 뒤
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '고정 2', '본문', v_ids[2], 1, NULL, NULL, NULL, false), 'OK', 'B5', '고정 2 해제');
    v_log := v_log || pg_temp.ensure((SELECT sort_order = 0 FROM public.site_board_posts WHERE id = v_ids[2]), 'B5', '해제 → sort_order 0');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '비고정 1', '본문', v_p, 1, NULL, NULL, NULL, true), 'OK', 'B5', '기존 글 고정');
    v_log := v_log || pg_temp.ensure((SELECT sort_order = 6 FROM public.site_board_posts WHERE id = v_p), 'B5', '기존 글 고정 → 고정 맨 뒤(6)');
    v_log := v_log || pg_temp.ensure(pg_temp.notice_order() = ARRAY[v_ids[1], v_ids[4], v_ids[5], v_p, v_ids[2]],
      'B5', '회원 순서: 게시 고정(sort_order) → 비고정(게시일 최신순, 해제한 글은 날짜 자리)');
    -- 순서 바꾸기: 범위 = 미삭제 고정(숨김 포함) [1,3,4,5,p]
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, 'notice', 'pinned', ARRAY[v_ids[1], v_ids[3], v_ids[4], v_ids[5]]), 'ERR SITE_BOARD_REORDER_MISMATCH', 'B5', '빠짐 거절');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, 'notice', 'pinned', ARRAY[v_ids[1], v_ids[3], v_ids[4], v_ids[5], v_p, v_ids[2]]), 'ERR SITE_BOARD_REORDER_MISMATCH', 'B5', '더함 거절');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, 'notice', 'pinned', ARRAY[v_ids[1], v_ids[3], v_ids[4], v_ids[5], v_ids[5]]), 'ERR SITE_BOARD_REORDER_MISMATCH', 'B5', '중복 거절');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, 'notice', 'faq', ARRAY[v_p]), 'ERR SITE_BOARD_INPUT_INVALID:scope', 'B5', '공지 범위는 pinned 만');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, 'notice', 'pinned', ARRAY[v_p, v_ids[5], v_ids[4], v_ids[3], v_ids[1]]), 'OK', 'B5', '숨긴 고정 포함 순서 저장');
    v_log := v_log || pg_temp.ensure((SELECT array_agg(id ORDER BY sort_order) FROM public.site_board_posts WHERE board = 'notice' AND is_pinned AND deleted_at IS NULL)
      = ARRAY[v_p, v_ids[5], v_ids[4], v_ids[3], v_ids[1]] AND pg_temp.rev(v_p) = 2 AND pg_temp.audit_count('site_board_post_reorder') = 1,
      'B5', '순서 반영·revision 그대로·기록 1');
    v_r := pg_temp.reorder(v_owner, 'notice', 'pinned', ARRAY[v_p, v_ids[5], v_ids[4], v_ids[3], v_ids[1]]);
    v_log := v_log || pg_temp.ensure(v_r LIKE 'OK%' AND (pg_temp.res(v_r) -> 'changed') = 'false'::jsonb AND pg_temp.audit_count('site_board_post_reorder') = 1, 'B5', '같은 순서 → 기록 없음');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_ok('site_board_post_reorder', ARRAY['board', 'ids_after', 'ids_before', 'reordered_at', 'request', 'scope']::text[], ARRAY['고정 1']), 'B5', '순서 기록 details 키');
    -- 상한 낮추기: 지금 고정 5개보다 작게는 거절
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 1, jsonb_set(pg_temp.content_value(), '{notice,maxPinned}', '4')), 'ERR SITE_BOARD_INPUT_INVALID:notice.maxPinned', 'B5', '상한 < 고정 수 거절');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 1, jsonb_set(pg_temp.content_value(), '{notice,maxPinned}', '21')), 'ERR SITE_BOARD_INPUT_INVALID:notice.maxPinned', 'B5', '상한 21 거절');
    -- FAQ: 새 글은 분류 맨 뒤, 분류 바꾸면 새 분류 맨 뒤, 숨긴 FAQ 포함 범위 순서 저장
    v_r := pg_temp.save(v_owner, 'faq', '크레딧 1', '답', NULL, NULL, NULL, NULL, 'credit'); v_q := pg_temp.new_id(v_r);
    v_r := pg_temp.save(v_owner, 'faq', '크레딧 2(숨김)', '답', NULL, NULL, NULL, NULL, 'credit', false, false); v_id := pg_temp.new_id(v_r);
    v_r := pg_temp.save(v_owner, 'faq', '환불 1', '답', NULL, NULL, NULL, NULL, 'refund');
    v_log := v_log || pg_temp.ensure((SELECT sort_order FROM public.site_board_posts WHERE id = v_q) = 1 AND (SELECT sort_order FROM public.site_board_posts WHERE id = v_id) = 2
      AND (SELECT sort_order FROM public.site_board_posts WHERE id = pg_temp.new_id(v_r)) = 1, 'B5', 'FAQ 새 글 → 분류 맨 뒤');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, 'faq', 'credit', ARRAY[v_id, v_q]), 'OK', 'B5', '숨긴 FAQ 포함 분류 순서 저장');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'faq', '크레딧 1', '답', v_q, 1, NULL, NULL, 'refund'), 'OK', 'B5', 'FAQ 분류 바꿈');
    v_log := v_log || pg_temp.ensure((SELECT sort_order FROM public.site_board_posts WHERE id = v_q) = 2, 'B5', '분류 바꿈 → 새 분류 맨 뒤(2)');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, 'faq', 'credit', ARRAY[v_id, v_q]), 'ERR SITE_BOARD_REORDER_MISMATCH', 'B5', '옮긴 글은 옛 분류 범위 밖');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, 'faq', 'Credit', ARRAY[v_id]), 'ERR SITE_BOARD_INPUT_INVALID:scope', 'B5', 'FAQ 범위 key 형식');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'B5', m FROM unnest(v_log) m;
END
$rh_b5$;

DO $rh_b6$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_at timestamptz;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    -- 삭제: 회원 목록에서 빠짐, 판 이력 1행, 기록(지문·글자 수만)
    v_r := pg_temp.save(v_owner, 'notice', '삭제할 공지 RH14', '삭제할 본문 RH14', NULL, NULL, '/terms', '약관');
    v_id := pg_temp.new_id(v_r);
    v_log := v_log || pg_temp.expect(pg_temp.del(v_owner, v_id, 9), 'ERR SITE_BOARD_REVISION_CONFLICT', 'B6', '삭제 판 충돌');
    v_log := v_log || pg_temp.expect(pg_temp.del(v_owner, v_id, 1), 'OK', 'B6', '삭제');
    v_log := v_log || pg_temp.ensure(NOT (v_id = ANY (pg_temp.notice_order()))
      AND (SELECT deleted_at IS NOT NULL AND NOT is_published AND NOT is_pinned AND sort_order = 0 AND revision = 2 AND deleted_by = v_owner
             FROM public.site_board_posts WHERE id = v_id)
      AND (SELECT count(*) FROM public.site_board_post_revisions WHERE post_id = v_id) = 2, 'B6', '목록에서 빠짐·판 이력 2행');
    v_log := v_log || pg_temp.expect(pg_temp.del(v_owner, v_id, 2), 'ERR SITE_BOARD_POST_DELETED', 'B6', '두 번 삭제 거절');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_ok('site_board_post_delete', ARRAY['board', 'body_length', 'deleted_at', 'post_id', 'request', 'revision_after', 'revision_before', 'revision_row_id', 'title_length', 'was_pinned', 'was_published']::text[], ARRAY['삭제할 공지 RH14', '삭제할 본문 RH14']),
      'B6', '삭제 기록 details 키·원문 없음');
    -- 분류 사용 중: 숨긴 글만 있어도 지우기 거절, 삭제 글만 남으면 통과
    v_r := pg_temp.save(v_owner, 'faq', '다운로드 질문', '답', NULL, NULL, NULL, NULL, 'download', false, false);
    v_q := pg_temp.new_id(v_r);
    v_j := jsonb_set(pg_temp.content_value(), '{faq,categories}',
      (SELECT jsonb_agg(c) FROM jsonb_array_elements(pg_temp.content_value() #> '{faq,categories}') c WHERE c ->> 'key' <> 'download'));
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 1, v_j), 'ERR SITE_BOARD_CATEGORY_IN_USE:download', 'B6', '숨긴 글 있는 분류 지우기 거절');
    v_log := v_log || pg_temp.expect(pg_temp.del(v_owner, v_q, 1), 'OK', 'B6', '그 글 삭제');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 1, v_j), 'OK', 'B6', '삭제 글만 남은 분류 지우기 통과');
    v_log := v_log || pg_temp.ensure(pg_temp.content_rev() = 2 AND jsonb_array_length(pg_temp.content_value() #> '{faq,categories}') = 3
      AND (SELECT faq_category_key = 'download' FROM public.site_board_posts WHERE id = v_q), 'B6', 'revision 2·분류 3개·삭제 글의 옛 key 그대로');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 1, v_j), 'ERR SITE_BOARD_REVISION_CONFLICT', 'B6', '안내 문구 판 충돌');
    v_r := pg_temp.content(v_owner, 2, pg_temp.content_value());
    v_log := v_log || pg_temp.ensure(v_r LIKE 'OK%' AND (pg_temp.res(v_r) -> 'changed') = 'false'::jsonb AND pg_temp.content_rev() = 2, 'B6', '안내 문구 바뀐 것 없음');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('site_board_content_update') = 1
      AND pg_temp.audit_ok('site_board_content_update', ARRAY['after', 'before', 'request', 'revision_after', 'revision_before', 'saved_at']::text[], ARRAY[]::text[]), 'B6', '안내 문구 기록 details 키');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 2, jsonb_set(pg_temp.content_value(), '{faq,categories}', '[{"key":"a","label":"가"},{"key":"a","label":"나"}]')),
      'ERR SITE_BOARD_INPUT_INVALID:faq.categories', 'B6', '분류 key 중복 거절');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 2, jsonb_set(pg_temp.content_value(), '{faq,categories}', '[{"key":"Bad","label":"가"}]')),
      'ERR SITE_BOARD_INPUT_INVALID:faq.categories', 'B6', '분류 key 형식 거절');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 2, jsonb_set(pg_temp.content_value(), '{notice,pageTitle}', '"  "')),
      'ERR SITE_BOARD_INPUT_INVALID:notice.pageTitle', 'B6', '필수 키 빈 값 거절');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 2, pg_temp.content_value() #- '{footer,navLabel}'),
      'ERR SITE_BOARD_INPUT_INVALID:footer.navLabel', 'B6', '필수 키 없음 거절');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 2, jsonb_set(pg_temp.content_value(), '{redactedText}', to_jsonb(repeat('가', 101)))),
      'ERR SITE_BOARD_INPUT_INVALID:redactedText', 'B6', '101자 가림 문구 거절');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 2, jsonb_set(pg_temp.content_value(), '{redactedText}', to_jsonb(E'두\n줄'::text))),
      'ERR SITE_BOARD_INPUT_INVALID:redactedText', 'B6', '여러 줄 가림 문구 거절');
    -- 가림: 게시 중 거절 → 숨김 → 가림(모든 판 제목·본문 = 가림 문구, 링크 NULL)
    v_r := pg_temp.save(v_owner, 'notice', '개인정보 실수 RH14', '홍길동 님 안내 RH14', NULL, NULL, '/search?q=hong', '보기');
    v_p := pg_temp.new_id(v_r);
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '개인정보 실수 RH14', '홍길동 님 안내 RH14 고침', v_p, 1, '/search?q=hong', '보기'), 'OK', 'B6', '한 번 고침(판 2)');
    v_log := v_log || pg_temp.expect(pg_temp.redact(v_owner, v_p), 'ERR SITE_BOARD_REDACT_PUBLISHED', 'B6', '게시 중 가림 거절');
    v_log := v_log || pg_temp.expect(pg_temp.redact(v_owner, v_p, 'free text'), 'ERR SITE_BOARD_INPUT_INVALID:reasonCode', 'B6', '정해진 사유 코드만');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '개인정보 실수 RH14', '홍길동 님 안내 RH14 고침', v_p, 2, '/search?q=hong', '보기', NULL, false, false), 'OK', 'B6', '숨김');
    v_r := pg_temp.redact(v_owner, v_p);
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'B6', '가림');
    v_log := v_log || pg_temp.ensure((pg_temp.res(v_r) ->> 'revisionsRedacted')::integer = 3
      AND (SELECT bool_and(r.title = (pg_temp.content_value() ->> 'redactedText') AND r.body = r.title AND r.link_url IS NULL AND r.link_label IS NULL
             AND r.body_sha256 IS NULL AND r.redacted_at IS NOT NULL AND r.redacted_by = v_owner) FROM public.site_board_post_revisions r WHERE r.post_id = v_p)
      AND (SELECT title = (pg_temp.content_value() ->> 'redactedText') AND link_url IS NULL AND redacted_at IS NOT NULL FROM public.site_board_posts WHERE id = v_p),
      'B6', '가림 뒤 판 이력 3행 전부 가림 문구·링크·지문 NULL, 지금 글도');
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM public.site_board_post_revisions r WHERE r.post_id = v_p AND (r.body LIKE '%홍길동%' OR r.title LIKE '%RH14%')),
      'B6', '원문이 판 이력에 남지 않음');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_ok('site_board_post_redact', ARRAY['board', 'post_id', 'reason_code', 'redacted_at', 'request', 'revision_after', 'revision_before', 'revisions_redacted']::text[], ARRAY['홍길동', '개인정보 실수 RH14'])
      AND pg_temp.audit_ok('site_board_post_save', ARRAY['board', 'body_length', 'body_length_before', 'changed_fields', 'created', 'is_pinned_after', 'is_pinned_before', 'is_published_after', 'is_published_before', 'post_id', 'request', 'revision_after', 'revision_before', 'revision_row_id', 'saved_at', 'title_length']::text[], ARRAY['홍길동', '개인정보 실수 RH14', '/search?q=hong']), 'B6', '가림·저장 기록에 원문 없음');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '되살리기', '본문', v_p, pg_temp.rev(v_p)), 'ERR SITE_BOARD_POST_DELETED', 'B6', '가린 글 고치기 거절');
    v_r := pg_temp.redact(v_owner, v_p);
    v_log := v_log || pg_temp.ensure(v_r LIKE 'OK%' AND (pg_temp.res(v_r) -> 'changed') = 'false'::jsonb AND pg_temp.audit_count('site_board_post_redact') = 1, 'B6', '다시 가림 → 바뀐 것 없음');
    v_log := v_log || pg_temp.expect(pg_temp.del(v_owner, v_p, pg_temp.rev(v_p)), 'OK', 'B6', '가린 글 삭제(판 이력 4행째도 가린 상태)');
    v_log := v_log || pg_temp.ensure((SELECT bool_and(redacted_at IS NOT NULL AND body_sha256 IS NULL) FROM public.site_board_post_revisions WHERE post_id = v_p)
      AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log a WHERE a.action LIKE 'site_board_%' AND a.created_at >= now() AND a.details::text LIKE '%sha256%'),
      'B6', '가린 뒤 판 이력도 가린 표시·지문 NULL, 작업 기록에 지문 없음');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.site_board_post_revisions SET body_sha256 = %L WHERE post_id = %L', repeat('0', 64), v_p)),
      'ERR SITE_BOARD_REVISIONS_APPEND_ONLY', 'B6', '가린 판 이력에 지문 되살리기 거절');
    -- 판 이력 가드: 소유자도 DELETE·TRUNCATE·다른 UPDATE 거절
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('DELETE FROM public.site_board_post_revisions WHERE post_id = %L', v_id)), 'ERR SITE_BOARD_REVISIONS_APPEND_ONLY', 'B6', '판 이력 DELETE 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('TRUNCATE public.site_board_post_revisions'), 'ERR SITE_BOARD_REVISIONS_APPEND_ONLY', 'B6', '판 이력 TRUNCATE 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.site_board_post_revisions SET title = %L WHERE post_id = %L', '바꿈', v_id)), 'ERR SITE_BOARD_REVISIONS_APPEND_ONLY', 'B6', '판 이력 UPDATE 거절');
    PERFORM set_config('app.site_board_redact', v_id::text, true);
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.site_board_post_revisions SET title = %L, body = %L, link_url = NULL, link_label = NULL, redacted_at = now(), redacted_by = %L, saved_by = %L WHERE post_id = %L',
      pg_temp.content_value() ->> 'redactedText', pg_temp.content_value() ->> 'redactedText', v_owner, v_e, v_id)), 'ERR SITE_BOARD_REVISIONS_APPEND_ONLY', 'B6', '가림 표지가 있어도 다른 칸(saved_by) 바꾸기 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.site_board_post_revisions SET title = %L, body = %L, link_url = NULL, link_label = NULL, redacted_at = now(), redacted_by = %L WHERE post_id = %L',
      '다른 글', '다른 글', v_owner, v_id)), 'ERR SITE_BOARD_REVISIONS_APPEND_ONLY', 'B6', '가림 문구가 아닌 글로 바꾸기 거절');
    PERFORM set_config('app.site_board_redact', '', true);
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'B6', m FROM unnest(v_log) m;
END
$rh_b6$;

DO $rh_b8$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_at timestamptz;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_q_text text;
BEGIN
  BEGIN

    v_r := pg_temp.save(v_owner, 'notice', '권한 표 시험', '본문');
    v_id := pg_temp.new_id(v_r);
    FOREACH v_q_text IN ARRAY ARRAY['public.site_board_posts', 'public.site_board_post_revisions'] LOOP
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'anon', format('SELECT count(*)::text FROM %s', v_q_text)), 'ERR', 'B8', v_q_text || ' anon SELECT 거절');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', format('SELECT count(*)::text FROM %s', v_q_text)), 'ERR', 'B8', v_q_text || ' 대표 세션 SELECT 거절');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role', format('SELECT count(*)::text FROM %s', v_q_text)), 'OK', 'B8', v_q_text || ' service_role SELECT');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role', format('WITH d AS (DELETE FROM %s RETURNING 1) SELECT count(*)::text FROM d', v_q_text)), 'ERR', 'B8', v_q_text || ' service_role DELETE 거절');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role', format('WITH u AS (UPDATE %s SET title = title RETURNING 1) SELECT count(*)::text FROM u', v_q_text)), 'ERR', 'B8', v_q_text || ' service_role UPDATE 거절');
    END LOOP;
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated',
      format('WITH i AS (INSERT INTO public.site_board_posts (board, title, body, created_by) VALUES (%L, %L, %L, %L) RETURNING 1) SELECT count(*)::text FROM i', 'notice', 't', 'b', v_owner)),
      'ERR', 'B8', 'authenticated INSERT 거절');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role',
      format('WITH i AS (INSERT INTO public.site_board_posts (board, title, body, created_by) VALUES (%L, %L, %L, %L) RETURNING 1) SELECT count(*)::text FROM i', 'notice', 't', 'b', v_owner)),
      'ERR', 'B8', 'service_role INSERT 거절');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role',
      format('WITH i AS (INSERT INTO public.site_board_post_revisions (post_id, revision, title, body, is_pinned, is_published, body_sha256, saved_by) VALUES (%L, 9, %L, %L, false, true, %L, %L) RETURNING 1) SELECT count(*)::text FROM i',
        v_id, 't', 'b', repeat('0', 64), v_owner)), 'ERR', 'B8', 'service_role 판 이력 INSERT 거절');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated',
      format('SELECT public.save_site_board_post(%L, NULL, NULL, %L, %L, %L, NULL, NULL, NULL, false, true, %L::jsonb)::text', v_owner, 'notice', 't', 'b', '{}')),
      'ERR', 'B8', 'authenticated 는 저장 함수를 부를 수 없음');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'anon', 'SELECT public.member_facing_text_pii_hits(''x'')::text'), 'ERR', 'B8', 'anon 은 판정 함수를 부를 수 없음');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', format('SELECT public.site_board_actor_allowed(%L)::text', v_owner)), 'ERR', 'B8', 'authenticated 는 행위자 판정을 부를 수 없음');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role',
      format('SELECT public.save_site_board_post(%L, NULL, NULL, %L, %L, %L, NULL, NULL, NULL, false, true, %L::jsonb)::text', v_owner, 'notice', 'service 글', '본문', '{}')),
      'OK', 'B8', 'service_role 은 저장 함수를 부름');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role', 'SELECT public.guard_site_board_post_revisions_mutation()::text'), 'ERR', 'B8', '가드 함수는 아무도 못 부름');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'B8', m FROM unnest(v_log) m;
END
$rh_b8$;

DO $rh_leftover$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_at timestamptz;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.site_board_posts) = 0 AND (SELECT count(*) FROM public.site_board_post_revisions) = 0
      AND (SELECT count(*) FROM public.admin_audit_log WHERE action LIKE 'site_board_%' AND created_at >= now()) = 0
      AND pg_temp.content_rev() = 1, 'Z', '경우 밖에 남은 글·판 이력·14번 기록 0, 설정 행 revision 1(ROLLBACK 전)');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'Z', m FROM unnest(v_log) m;
END
$rh_leftover$;

SELECT n, test, msg, payload FROM _rh_log ORDER BY n;
ROLLBACK;
