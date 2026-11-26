-- 12번 묶음 리허설: B full — 실제 마이그레이션(FK·profiles 트리거·RESTRICTIVE 정책)과 S1~S13(실제 익명화 self·owner, CASCADE 포함)
-- 생성 파일(손으로 고치지 않는다): node supabase/scripts/bundle12_rehearsal/generate.mjs 가 원본에서 만든다.
-- 실행: supabase db query --remote --yes -o json --file supabase/scripts/bundle12_rehearsal/<이 파일> (COMMIT 없음, 마지막 SELECT 가 결과)
-- 언제: 새벽 03~04시만, DB 적용 전 필수(S8·S12·S10). profiles 는 처음부터 SHARE ROW EXCLUSIVE(쓰기 막음), 마지막 경우 S13 되돌리기부터 끝까지 ACCESS EXCLUSIVE(읽기도 막음). system_settings 는 ACCESS EXCLUSIVE. 거래 끝까지 잡는다(lock_timeout 3초).
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
CREATE FUNCTION pg_temp.md5_def(p_sig text) RETURNS text LANGUAGE sql AS $f$
  SELECT CASE WHEN to_regprocedure(p_sig) IS NULL THEN 'missing' ELSE md5(pg_get_functiondef(to_regprocedure(p_sig))) END
$f$;
CREATE FUNCTION pg_temp.md5_src(p_sig text) RETURNS text LANGUAGE sql AS $f$
  SELECT CASE WHEN to_regprocedure(p_sig) IS NULL THEN 'missing' ELSE (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure(p_sig)) END
$f$;
-- 정지·메모 함수 호출 도우미(결과 'OK {json}' 또는 'ERR …')
CREATE FUNCTION pg_temp.suspend(p_actor uuid, p_user uuid, p_scope text, p_download boolean, p_code text, p_ends timestamptz,
  p_key text DEFAULT NULL, p_reason text DEFAULT '시험 사유(회원에게 보임)', p_note text DEFAULT '시험 내부 메모') RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.suspend_member(%L, %L, %L, %L, %L, %L, %L, %L, %L)', p_actor, p_user, p_scope, p_download, p_code,
    p_reason, p_note, p_ends, coalesce(p_key, 'rh12-' || gen_random_uuid())))
$f$;
CREATE FUNCTION pg_temp.lift(p_actor uuid, p_id uuid, p_reason text DEFAULT '시험 해제') RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.lift_member_suspension(%L, %L, %L)', p_actor, p_id, p_reason))
$f$;
CREATE FUNCTION pg_temp.notice(p_actor uuid, p_id uuid, p_via text) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.record_member_suspension_notice(%L, %L, %L, %L, %L)', p_actor, p_id, p_via, now(), '시험 알림 요약'))
$f$;
CREATE FUNCTION pg_temp.note_add(p_actor uuid, p_user uuid, p_body text DEFAULT '시험 메모: 확인한 사실') RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.add_member_admin_note(%L, %L, %L)', p_actor, p_user, p_body))
$f$;
CREATE FUNCTION pg_temp.grants(p_owner uuid, p_staff uuid, p_keys text[]) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.replace_admin_permission_grants(%L, %L, %L::jsonb)', p_owner, p_staff,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('permission', k)), '[]'::jsonb) FROM unnest(p_keys) k)))
$f$;
-- 이 거래에서 남긴 작업 기록(created_at 기본값 now() = 거래 시작 시각, 앞 경우들은 되돌려져 없다)
CREATE FUNCTION pg_temp.audit_count(p_action text, p_user uuid DEFAULT NULL) RETURNS integer LANGUAGE sql AS $f$
  SELECT count(*)::integer FROM public.admin_audit_log
   WHERE action = p_action AND created_at >= now() AND (p_user IS NULL OR target_user_id = p_user)
$f$;
-- 그 종류의 기록이 모두: reason NULL, details 키가 정한 목록과 같음(자유 글·지문 키 없음), 넘긴 자유 글이 들어 있지 않음
CREATE FUNCTION pg_temp.audit_ok(p_action text, p_keys text[], p_forbidden text[]) RETURNS boolean LANGUAGE sql AS $f$
  SELECT count(*) > 0 AND bool_and(a.reason IS NULL
     AND ARRAY(SELECT k FROM jsonb_object_keys(a.details) k ORDER BY k COLLATE "C") = p_keys
     AND NOT EXISTS (SELECT 1 FROM unnest(p_forbidden) f WHERE strpos(a.details::text, f) > 0))
    FROM public.admin_audit_log a WHERE a.action = p_action AND a.created_at >= now()
$f$;

-- 원본 사본(생성기가 원본 파일에서 꺼낸 글 그대로, 바꾼 곳은 생성기가 정함)
SELECT pg_temp.ctx_set('src_migration', $rh_src_migration$-- 출시 전 작업 순서표 12번 묶음: 회원 이용 정지·관리자 메모(계획 docs/plan-bundle12-member-suspension.md 3판, 4절).
-- 만드는 것:
--   1. 표 member_suspensions(정지 이력, 회원마다 해제 안 된 행 1건)·member_admin_notes(관리자 상담 메모). RLS 켬·정책 0,
--      anon·authenticated 권한 없음, service_role 은 SELECT 만. 쓰기는 DEFINER 함수와 탈퇴 트리거뿐(쓰기 막기 트리거가 두 번째 방어).
--   2. 함수(SECURITY DEFINER, search_path 고정): suspend_member·lift_member_suspension·record_member_suspension_notice·
--      mark_member_suspension_seen·add_member_admin_note·delete_member_admin_note·redact_member_admin_note·member_active_suspension·
--      member_refund_deadlines·save_member_suspension_policy(service_role), get_my_member_gate(authenticated), 내부 member_suspension_actor_allowed.
--   3. 설정 행 member_suspension_policy(9절 초안, revision 1 — 있으면 그대로)와 RESTRICTIVE 정책(화면 세션 직접 쓰기 막음).
--   4. replace_admin_permission_grants 재정의: 권한 이름 목록에 members.memo·members.suspend 만 더했다(20261118120000 정의 그대로).
--   5. profiles AFTER UPDATE OF withdrawn_at 트리거: 익명화(anonymize_member 6-6)하는 거래에서 그 회원의 메모·정지 행을 지운다(예외 없음).
-- 작업 기록(admin_audit_log)에는 자유 글을 넣지 않는다: p_reason NULL, details 에는 범위·분류·기간·알림 수단과 글자 수만(지문 없음).
-- 함수 지문은 md5(pg_get_functiondef(oid)) — 9·10·11번과 같은 측정(2026-11-26 운영 읽기 전용 값). 다르면 멈춘다.
--   재정의한 replace_admin_permission_grants 는 md5(prosrc)(본문 글, 로컬 계산 가능)로 VERIFY·되돌리기 머리에서 대조한다.
-- 잠금: 새 표 2개(새로 만듦), profiles 에 FK 2개·트리거 1개(SHARE ROW EXCLUSIVE — 쓰기를 잠깐 막음), system_settings 에 정책 1개
--   (ACCESS EXCLUSIVE — 읽기도 잠깐 막음). 새벽 짧은 창에서 적용하고, 잡지 못하면(lock_timeout 3초) 전체가 취소된다.
-- 버전: 20261214100000 은 이미 들어간 20261216100000(11번)보다 앞이다. 이 저장소는 db push 를 쓰지 않고 파일 단위로 적용하며
--   이력은 같은 거래의 schema_migrations INSERT 로 넣으므로 순서가 문제 되지 않는다(13번 20261215… 도 같은 방식, 12번 먼저).
-- 되돌리기: supabase/rollback/20261214100000_member_suspension_down.sql(코드를 12번 전으로 되돌린 뒤에만, 13번이 있으면 13번 먼저).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

-- 0. 사전 점검(4-1) -----------------------------------------------------------------------------------------------
DO $precheck_member_suspension$
DECLARE
  -- 그대로여야 하거나(새 관문 함수가 부름·탈퇴 트리거가 그 거래에서 돎), 이 파일이 바꾸는 바탕 값(2026-11-26 운영)
  v_same text[][] := ARRAY[
    ARRAY['public.get_my_missing_required_consents()', 'a94b8de5fcfd4e5a81c4d988fabcb89f'],
    ARRAY['public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)', '1346d870d3623abae580a011b0484339'],
    ARRAY['public.replace_admin_permission_grants(uuid,uuid,jsonb)', 'dcb2155fae26443c98231627d102a821'],
    ARRAY['public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)', 'a42b474d9d95753ffba5041acb0c1c77'],
    ARRAY['public.member_withdrawal_facts(uuid,boolean)', 'a7674770964dac2fe5c9179b8403c3b4'],
    ARRAY['public.get_point_charge_refund_eligibility(uuid,uuid)', '60fc28afe44e7be776c189265e87b6ec']
  ];
  v_new_functions text[] := ARRAY[
    'member_suspension_actor_allowed', 'suspend_member', 'lift_member_suspension', 'record_member_suspension_notice',
    'mark_member_suspension_seen', 'add_member_admin_note', 'delete_member_admin_note', 'redact_member_admin_note',
    'member_active_suspension', 'member_refund_deadlines', 'get_my_member_gate', 'save_member_suspension_policy',
    'guard_member_suspensions_mutation', 'guard_member_admin_notes_mutation', 'member_suspension_withdrawal_cleanup'];
  i integer;
BEGIN
  FOR i IN 1 .. array_length(v_same, 1) LOOP
    IF to_regprocedure(v_same[i][1]) IS NULL OR md5(pg_get_functiondef(to_regprocedure(v_same[i][1]))) <> v_same[i][2] THEN
      RAISE EXCEPTION 'PRECHECK: % changed (%)', v_same[i][1],
        CASE WHEN to_regprocedure(v_same[i][1]) IS NULL THEN 'missing' ELSE md5(pg_get_functiondef(to_regprocedure(v_same[i][1]))) END;
    END IF;
  END LOOP;
  IF to_regclass('public.member_suspensions') IS NOT NULL OR to_regclass('public.member_admin_notes') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECHECK: member_suspensions / member_admin_notes already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (v_new_functions)) THEN
    RAISE EXCEPTION 'PRECHECK: bundle 12 functions already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'member_suspension_policy') THEN
    RAISE EXCEPTION 'PRECHECK: member_suspension_policy row already exists';
  END IF;
  IF (SELECT array_agg(t.tgname::text ORDER BY t.tgname) FROM pg_trigger t
       WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal) IS DISTINCT FROM ARRAY['profiles_keep_admin_owner'] THEN
    RAISE EXCEPTION 'PRECHECK: profiles triggers changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_permission_grants g WHERE g.permission IN ('members.memo', 'members.suspend')) THEN
    RAISE EXCEPTION 'PRECHECK: members.memo / members.suspend grants already exist';
  END IF;
  IF to_regprocedure('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'member_withdrawal_policy') THEN
    RAISE EXCEPTION 'PRECHECK: record_admin_audit / member_withdrawal_policy missing';
  END IF;
END;
$precheck_member_suspension$;

-- [12번] 시작 ---------------------------------------------------------------------------------------------------
-- 1. 표(4-2) ----------------------------------------------------------------------------------------------------
-- 행위자 칸(created_by·lifted_by·deleted_by·redacted_by)은 FK 없는 uuid 다(관리자 계정을 지워도 이력이 남음).
CREATE TABLE public.member_suspensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('restricted', 'login_blocked')),
  blocks_download boolean NOT NULL,
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_]{1,39}$'),
  reason_label text NOT NULL CHECK (char_length(reason_label) BETWEEN 1 AND 60),
  member_reason text NOT NULL CHECK (char_length(member_reason) BETWEEN 1 AND 500 AND btrim(member_reason) <> ''),
  internal_note text NOT NULL DEFAULT '' CHECK (char_length(internal_note) <= 2000),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  created_by uuid NOT NULL,
  lifted_at timestamptz,
  lifted_by uuid,
  lift_reason text CHECK (lift_reason IS NULL OR (char_length(lift_reason) BETWEEN 1 AND 500 AND btrim(lift_reason) <> '')),
  operation_key text NOT NULL CHECK (char_length(operation_key) BETWEEN 8 AND 200),
  notified_via text CHECK (notified_via IS NULL OR notified_via IN ('screen', 'email', 'phone')),
  notified_at timestamptz,
  notice_summary text CHECK (notice_summary IS NULL OR char_length(notice_summary) <= 500),
  first_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_suspensions_operation_key_key UNIQUE (operation_key),
  CONSTRAINT member_suspensions_login_blocked_download CHECK (scope <> 'login_blocked' OR blocks_download),
  CONSTRAINT member_suspensions_restricted_ends CHECK (scope <> 'restricted' OR ends_at IS NOT NULL),
  CONSTRAINT member_suspensions_period CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT member_suspensions_lifted CHECK ((lifted_at IS NULL) = (lift_reason IS NULL) AND (lifted_at IS NOT NULL OR lifted_by IS NULL)),
  CONSTRAINT member_suspensions_notified CHECK ((notified_via IS NULL) = (notified_at IS NULL) AND (notified_at IS NOT NULL OR notice_summary IS NULL))
);
CREATE UNIQUE INDEX member_suspensions_one_open ON public.member_suspensions (user_id) WHERE lifted_at IS NULL;
CREATE INDEX member_suspensions_user_created ON public.member_suspensions (user_id, created_at DESC);

CREATE TABLE public.member_admin_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000 AND btrim(body) <> ''),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  redacted_at timestamptz,
  redacted_by uuid,
  CONSTRAINT member_admin_notes_deleted CHECK ((deleted_at IS NULL) = (deleted_by IS NULL)),
  CONSTRAINT member_admin_notes_redacted CHECK ((redacted_at IS NULL) = (redacted_by IS NULL))
);
CREATE INDEX member_admin_notes_user_created ON public.member_admin_notes (user_id, created_at DESC);

COMMENT ON TABLE public.member_suspensions IS '12번: 회원 이용 정지 이력(이용 제한·로그인 차단). 쓰기는 DEFINER 함수만, 탈퇴(익명화)하면 지운다.';
COMMENT ON TABLE public.member_admin_notes IS '12번: 회원 관리자 상담 메모. 지우기는 deleted_at 만, 가림은 대표 함수만, 탈퇴(익명화)하면 지운다.';

ALTER TABLE public.member_suspensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_admin_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.member_suspensions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.member_admin_notes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.member_suspensions TO service_role;
GRANT SELECT ON TABLE public.member_admin_notes TO service_role;

-- 2. 쓰기 막기 트리거(4-2, 두 번째 방어) ---------------------------------------------------------------------------
--   INSERT: 함수 안 거래 설정 app.member_suspension_write = 그 회원 id 일 때만.
--   UPDATE: 묶음별로 비어 있을 때(NULL→값)만 채울 수 있다 — 해제(lifted_*), 알림(notified_*·notice_summary), first_seen_at.
--   DELETE: 부모 프로필이 이미 없거나(완전 삭제의 CASCADE), app.member_withdrawal_bypass = OLD.user_id(익명화 트리거)일 때만.
CREATE FUNCTION public.guard_member_suspensions_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_member_suspensions_mutation$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(current_setting('app.member_suspension_write', true), '') IS DISTINCT FROM NEW.user_id::text THEN
      RAISE EXCEPTION 'MEMBER_SUSPENSION_DIRECT_WRITE';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id)
       OR COALESCE(current_setting('app.member_withdrawal_bypass', true), '') = OLD.user_id::text THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'MEMBER_SUSPENSION_DIRECT_WRITE';
  END IF;
  IF (NEW.id, NEW.user_id, NEW.scope, NEW.blocks_download, NEW.reason_code, NEW.reason_label, NEW.member_reason, NEW.internal_note,
      NEW.starts_at, NEW.ends_at, NEW.created_by, NEW.operation_key, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.user_id, OLD.scope, OLD.blocks_download, OLD.reason_code, OLD.reason_label, OLD.member_reason, OLD.internal_note,
      OLD.starts_at, OLD.ends_at, OLD.created_by, OLD.operation_key, OLD.created_at) THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_DIRECT_WRITE';
  END IF;
  IF (OLD.lifted_at IS NOT NULL OR NEW.lifted_at IS NULL)
     AND (NEW.lifted_at, NEW.lifted_by, NEW.lift_reason) IS DISTINCT FROM (OLD.lifted_at, OLD.lifted_by, OLD.lift_reason) THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_DIRECT_WRITE';
  END IF;
  IF (OLD.notified_at IS NOT NULL OR NEW.notified_at IS NULL)
     AND (NEW.notified_via, NEW.notified_at, NEW.notice_summary) IS DISTINCT FROM (OLD.notified_via, OLD.notified_at, OLD.notice_summary) THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_DIRECT_WRITE';
  END IF;
  IF OLD.first_seen_at IS NOT NULL AND NEW.first_seen_at IS DISTINCT FROM OLD.first_seen_at THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_DIRECT_WRITE';
  END IF;
  RETURN NEW;
END;
$fn_guard_member_suspensions_mutation$;

--   메모 UPDATE: 지우기(deleted_*) NULL→값, 가림(대표 함수가 app.member_note_redact = 그 메모 id 로 켠 거래에서 body·redacted_* 한 번)만.
CREATE FUNCTION public.guard_member_admin_notes_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_member_admin_notes_mutation$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(current_setting('app.member_suspension_write', true), '') IS DISTINCT FROM NEW.user_id::text THEN
      RAISE EXCEPTION 'MEMBER_NOTE_DIRECT_WRITE';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id)
       OR COALESCE(current_setting('app.member_withdrawal_bypass', true), '') = OLD.user_id::text THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'MEMBER_NOTE_DIRECT_WRITE';
  END IF;
  IF (NEW.id, NEW.user_id, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'MEMBER_NOTE_DIRECT_WRITE';
  END IF;
  IF (OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL)
     AND (NEW.deleted_at, NEW.deleted_by) IS DISTINCT FROM (OLD.deleted_at, OLD.deleted_by) THEN
    RAISE EXCEPTION 'MEMBER_NOTE_DIRECT_WRITE';
  END IF;
  IF (NEW.body, NEW.redacted_at, NEW.redacted_by) IS DISTINCT FROM (OLD.body, OLD.redacted_at, OLD.redacted_by)
     AND (OLD.redacted_at IS NOT NULL OR NEW.redacted_at IS NULL OR NEW.redacted_by IS NULL
          OR COALESCE(current_setting('app.member_note_redact', true), '') IS DISTINCT FROM OLD.id::text) THEN
    RAISE EXCEPTION 'MEMBER_NOTE_DIRECT_WRITE';
  END IF;
  RETURN NEW;
END;
$fn_guard_member_admin_notes_mutation$;

CREATE TRIGGER guard_member_suspensions_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_suspensions
  FOR EACH ROW EXECUTE FUNCTION public.guard_member_suspensions_mutation();
CREATE TRIGGER guard_member_admin_notes_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_admin_notes
  FOR EACH ROW EXECUTE FUNCTION public.guard_member_admin_notes_mutation();

-- 3. 설정 행(4-5, 9절 초안). 문구·분류는 데이터다 — 대표가 관리자 화면(6-3)에서 고친다. -------------------------------
--   reasonCategories[]: code(코드 형식)·label·clause(관련 조항)·blocksDownloadDefault(정지 창 '다운로드도 막기' 미리 체크)·
--   hidden(새 정지에서 숨김, 쓰는 중인 코드는 지우지 않고 숨김만)·underageGuide(정지 창에 adminUnderageGuide 를 보임).
--   texts.deadline*: 기한 종류 이름(안내 화면의 기한 줄, 대표 이메일 틀 ownerMailDeadlines 의 {기한 종류}) — 회원이 읽는 글이라 데이터로 둔다.
INSERT INTO public.system_settings (key, value, description, updated_at)
VALUES ('member_suspension_policy', $policy${
  "revision": 1,
  "maxRestrictedDays": 30,
  "texts": {
    "bannerRestricted": "이 계정은 이용이 제한되어 충전·구매 등 일부 기능을 쓸 수 없습니다.",
    "noticeTitle": "계정 이용 제한 안내",
    "noticeIntro": "이용약관 제9조에 따라 이 계정의 이용을 제한했습니다. 제한 내용과 사유는 아래와 같습니다.",
    "noticeBlockedList": "크레딧 충전, 자료 구매·장바구니 담기, 구매 후기 작성·추천",
    "noticeBlockedDownload": "자료 다운로드",
    "noticeAvailableList": "1:1 문의, 결제·크레딧·구매 내역 보기, 충전·자료 환불 신청(정해진 기간 안의 건), 내 후기 삭제, 선택 동의 관리, 회원 탈퇴",
    "noticeDeadlines": "충전 환불은 결제 다음 날부터 7일 안에 크레딧을 쓰지 않은 건, 자료 환불은 구매 뒤 30일 안에 받지 않은 자료만 신청할 수 있습니다. 기한이 걱정되시면 1:1 문의로 알려 주세요.",
    "noticeObjection": "제한 내용에 이의가 있으시면 1:1 문의나 화면 하단의 고객센터 연락처로 알려 주세요. 회사는 내용을 검토해 제한을 유지·변경·해제하고 결과를 알려 드립니다.",
    "noticeUntilLifted": "해제할 때까지",
    "noticeNone": "지금 이 계정에는 이용 제한이 없습니다.",
    "noticeCheckFailed": "이용 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    "apiBlocked": "이용이 제한된 계정이라 이 기능을 쓸 수 없습니다. 자세한 내용은 '계정 이용 제한 안내'에서 확인해 주세요.",
    "loginBlocked": "이 계정은 이용약관 제9조에 따라 로그인이 제한되었습니다. 이의, 충전·자료 환불, 탈퇴는 화면 하단의 고객센터 이메일·전화로 신청하실 수 있으며, 접수한 시각을 신청 시각으로 봅니다. 충전 환불(결제 다음 날부터 7일 안, 쓰지 않은 건)과 자료 환불(구매 뒤 30일 안, 받지 않은 자료)은 기간이 정해져 있으니 서둘러 연락해 주세요.",
    "deadlineChargeRefund": "충전 환불 신청 기한",
    "deadlineMaterialRefund": "자료 환불 신청 기한",
    "deadlineCreditExpiry": "유료 크레딧 소멸일",
    "ownerMailDeadlines": "고객님 계정의 가장 빠른 기한은 {기한 종류} {날짜}입니다. 이 메일에 답장하거나 고객센터로 전화하시면 접수한 시각을 신청 시각으로 보고 충전·자료 환불과 탈퇴를 처리해 드립니다.",
    "adminMemoGuide": "확인한 사실과 처리 내용만 적어 주세요. 새로 알게 된 개인정보(주민등록번호·계좌번호 등)는 적지 마세요. 회원이 열람을 요청하면 보여 줄 수 있습니다. 탈퇴하면 메모는 지워지고, 작업 기록에는 글자 수만 남습니다.",
    "adminSuspendConfirm": "정지해도 진행 중인 결제 통보와 환불은 그대로 처리됩니다. 회원에게 알릴 사유는 회원 화면에 그대로 보입니다.",
    "adminDeadlineWarning": "정지 기간이 이 회원의 환불·소멸 기한을 넘습니다. 기한 전 해제, 계약 해지와 환불, 만료 연장 가운데 하나를 정해 메모에 적어 주세요(런북 RB-12).",
    "adminUnderageGuide": "만 14세 미만 가입은 정지를 임시 조치로만 쓰고, 미성년자 결제 취소 안내와 탈퇴 처리로 바로 넘겨 주세요."
  },
  "reasonCategories": [
    {"code": "account_misuse", "label": "계정 도용·양도·공유", "clause": "제4조②", "blocksDownloadDefault": true, "hidden": false, "underageGuide": false},
    {"code": "material_sharing", "label": "구매 자료 무단 공유·게시", "clause": "제7조", "blocksDownloadDefault": true, "hidden": false, "underageGuide": false},
    {"code": "scraping", "label": "자동 수집", "clause": "제8조", "blocksDownloadDefault": true, "hidden": false, "underageGuide": false},
    {"code": "payment_abuse", "label": "결제·환불·크레딧 악용", "clause": "제8조, 환불정책 9절", "blocksDownloadDefault": false, "hidden": false, "underageGuide": false},
    {"code": "operation_interference", "label": "서비스 운영 방해", "clause": "제8조", "blocksDownloadDefault": false, "hidden": false, "underageGuide": false},
    {"code": "underage", "label": "만 14세 미만 가입 확인", "clause": "제4조①", "blocksDownloadDefault": false, "hidden": false, "underageGuide": true},
    {"code": "other", "label": "그 밖의 약관·법령 위반", "clause": "제9조", "blocksDownloadDefault": false, "hidden": false, "underageGuide": false}
  ]
}$policy$::jsonb, '12번: 회원 이용 정지 안내 문구·사유 분류·최대 정지 일수(저장은 save_member_suspension_policy 만)', now())
ON CONFLICT (key) DO NOTHING;

-- 4. 함수(4-3) ----------------------------------------------------------------------------------------------------
-- 4-0. 행위자 판정(내부): 대표면 통과. 직원은 그 권한과 members.view 를 모두 받았을 때만(admin-permissions.ts 의 requires 와 같음).
--      p_permission = 'owner' 는 대표만(로그인 차단·가림·문구 저장).
CREATE FUNCTION public.member_suspension_actor_allowed(p_actor_id uuid, p_permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_suspension_actor_allowed$
  SELECT p_actor_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.withdrawn_at IS NULL
       AND (p.admin_role = 'owner'
            OR (p.admin_role = 'staff'
                AND p_permission IN ('members.view', 'members.memo', 'members.suspend')
                AND EXISTS (SELECT 1 FROM public.admin_permission_grants g WHERE g.user_id = p.id AND g.permission = p_permission)
                AND EXISTS (SELECT 1 FROM public.admin_permission_grants g WHERE g.user_id = p.id AND g.permission = 'members.view'))))
$fn_member_suspension_actor_allowed$;

-- 4-1. 정지(이용 제한·로그인 차단). 순서: 입력 검사 → 행위자 → 프로필 FOR UPDATE → operation_key → 지난 행 닫기 → 넣기.
--      로그인 차단은 같은 거래에서 auth.users.banned_until 과 세션·토큰·진행 중 흐름을 지운다(10번 6-7 과 같음).
CREATE FUNCTION public.suspend_member(
  p_actor_id uuid,
  p_user_id uuid,
  p_scope text,
  p_blocks_download boolean,
  p_reason_code text,
  p_member_reason text,
  p_internal_note text,
  p_ends_at timestamptz,
  p_operation_key text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_suspend_member$
DECLARE
  v_now timestamptz := now();
  v_policy jsonb;
  v_category jsonb;
  v_max integer;
  v_member_reason text := btrim(replace(coalesce(p_member_reason, ''), E'\r\n', E'\n'));
  v_internal_note text := btrim(replace(coalesce(p_internal_note, ''), E'\r\n', E'\n'));
  v_blocks boolean;
  v_profile public.profiles%ROWTYPE;
  v_existing public.member_suspensions%ROWTYPE;
  v_id uuid;
BEGIN
  -- ① 입력
  IF p_actor_id IS NULL OR p_user_id IS NULL OR p_scope IS NULL OR p_scope NOT IN ('restricted', 'login_blocked')
     OR p_reason_code IS NULL OR char_length(v_member_reason) NOT BETWEEN 1 AND 500 OR char_length(v_internal_note) > 2000
     OR p_operation_key IS NULL OR char_length(p_operation_key) NOT BETWEEN 8 AND 200
     OR (p_scope = 'restricted' AND p_blocks_download IS NULL) THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_INPUT_INVALID';
  END IF;
  IF p_actor_id = p_user_id THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_TARGET_INVALID';
  END IF;
  -- ② 행위자: 이용 제한은 members.suspend, 로그인 차단은 대표만
  IF NOT public.member_suspension_actor_allowed(p_actor_id, CASE WHEN p_scope = 'login_blocked' THEN 'owner' ELSE 'members.suspend' END) THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_ACTOR_NOT_ALLOWED';
  END IF;
  -- ③ 정책: 분류(숨기지 않은 것)·최대 일수
  SELECT s.value INTO v_policy FROM public.system_settings s WHERE s.key = 'member_suspension_policy';
  IF v_policy IS NULL OR jsonb_typeof(v_policy -> 'reasonCategories') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_policy -> 'maxRestrictedDays') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_POLICY_UNAVAILABLE';
  END IF;
  v_max := CASE WHEN (v_policy ->> 'maxRestrictedDays')::numeric = trunc((v_policy ->> 'maxRestrictedDays')::numeric)
                 AND (v_policy ->> 'maxRestrictedDays')::numeric BETWEEN 1 AND 365
                THEN (v_policy ->> 'maxRestrictedDays')::numeric::integer END;
  IF v_max IS NULL THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_POLICY_UNAVAILABLE';
  END IF;
  SELECT c INTO v_category
    FROM jsonb_array_elements(v_policy -> 'reasonCategories') AS c
   WHERE c ->> 'code' = p_reason_code AND (c -> 'hidden') IS DISTINCT FROM 'true'::jsonb
   LIMIT 1;
  IF v_category IS NULL OR jsonb_typeof(v_category -> 'label') IS DISTINCT FROM 'string'
     OR char_length(v_category ->> 'label') NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_REASON_UNKNOWN';
  END IF;
  -- ④ 기간: 끝나는 날은 지금보다 뒤. 이용 제한은 필수이고 최대 일수 이하(로그인 차단은 비울 수 있음).
  IF (p_ends_at IS NOT NULL AND p_ends_at <= v_now)
     OR (p_scope = 'restricted' AND (p_ends_at IS NULL OR p_ends_at > v_now + make_interval(days => v_max))) THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_PERIOD_INVALID';
  END IF;
  v_blocks := CASE WHEN p_scope = 'login_blocked' THEN true ELSE p_blocks_download END;

  -- ⑤ 프로필 잠금(익명화와 같은 순서) 뒤 대상 확인: 가입을 마친 회원, 관리자·탈퇴 회원 아님
  SELECT * INTO v_profile FROM public.profiles p WHERE p.id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_profile.is_admin IS TRUE OR v_profile.withdrawn_at IS NOT NULL OR v_profile.signup_completed IS NOT TRUE THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_TARGET_INVALID';
  END IF;

  -- ⑥ 같은 operation_key(잠금 뒤): 같은 회원·범위면 그 행을 그대로 돌려주고, 다르면 거절
  SELECT * INTO v_existing FROM public.member_suspensions s WHERE s.operation_key = p_operation_key;
  IF FOUND THEN
    IF v_existing.user_id = p_user_id AND v_existing.scope = p_scope THEN
      RETURN jsonb_build_object('suspensionId', v_existing.id, 'scope', v_existing.scope, 'replay', true);
    END IF;
    RAISE EXCEPTION 'MEMBER_SUSPEND_INPUT_INVALID';
  END IF;

  -- ⑦ 기간이 지난 행은 먼저 닫는다(lifted_at = ends_at, 'expired')
  UPDATE public.member_suspensions s
     SET lifted_at = s.ends_at, lift_reason = 'expired'
   WHERE s.user_id = p_user_id AND s.lifted_at IS NULL AND s.ends_at IS NOT NULL AND s.ends_at <= v_now;
  IF EXISTS (SELECT 1 FROM public.member_suspensions s WHERE s.user_id = p_user_id AND s.lifted_at IS NULL) THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_ALREADY_ACTIVE';
  END IF;

  -- ⑧ 넣기
  PERFORM set_config('app.member_suspension_write', p_user_id::text, true);
  INSERT INTO public.member_suspensions (user_id, scope, blocks_download, reason_code, reason_label, member_reason, internal_note,
                                         starts_at, ends_at, created_by, operation_key)
  VALUES (p_user_id, p_scope, v_blocks, p_reason_code, v_category ->> 'label', v_member_reason, v_internal_note,
          v_now, p_ends_at, p_actor_id, p_operation_key)
  RETURNING id INTO v_id;
  PERFORM set_config('app.member_suspension_write', '', true);

  -- ⑨ 로그인 차단: 인증 계정을 같은 거래에서 막는다(재설정 링크·진행 중 카카오 흐름 포함)
  IF p_scope = 'login_blocked' THEN
    UPDATE auth.users SET banned_until = COALESCE(p_ends_at, v_now + interval '100 years') WHERE id = p_user_id;
    DELETE FROM auth.sessions WHERE user_id = p_user_id;
    DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
    DELETE FROM auth.flow_state WHERE user_id = p_user_id;
    DELETE FROM auth.one_time_tokens WHERE user_id = p_user_id;
  END IF;

  -- ⑩ 작업 기록(자유 글 없음 — 글자 수만)
  PERFORM public.record_admin_audit(p_actor_id, 'member_suspend', 'member', p_user_id::text, p_user_id, NULL, NULL,
    jsonb_build_object(
      'suspension_id', v_id,
      'scope', p_scope,
      'blocks_download', v_blocks,
      'reason_code', p_reason_code,
      'ends_at', p_ends_at,
      'member_reason_length', char_length(v_member_reason),
      'internal_note_length', char_length(v_internal_note)),
    NULL);

  RETURN jsonb_build_object('suspensionId', v_id, 'scope', p_scope, 'replay', false);
END;
$fn_suspend_member$;

-- 4-2. 해제. 잠금 순서: 프로필 FOR UPDATE → withdrawn_at 다시 확인 → 정지 행 FOR UPDATE(익명화와 교착 없음, 탈퇴 차단을 풀지 않음).
CREATE FUNCTION public.lift_member_suspension(p_actor_id uuid, p_suspension_id uuid, p_lift_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_lift_member_suspension$
DECLARE
  v_now timestamptz := now();
  v_reason text := btrim(replace(coalesce(p_lift_reason, ''), E'\r\n', E'\n'));
  v_user uuid;
  v_scope text;
  v_profile public.profiles%ROWTYPE;
  v_row public.member_suspensions%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_suspension_id IS NULL OR char_length(v_reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_INPUT_INVALID';
  END IF;
  SELECT s.user_id, s.scope INTO v_user, v_scope FROM public.member_suspensions s WHERE s.id = p_suspension_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_NOT_FOUND';
  END IF;
  IF NOT public.member_suspension_actor_allowed(p_actor_id, CASE WHEN v_scope = 'login_blocked' THEN 'owner' ELSE 'members.suspend' END) THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_ACTOR_NOT_ALLOWED';
  END IF;
  SELECT * INTO v_profile FROM public.profiles p WHERE p.id = v_user FOR UPDATE;
  IF NOT FOUND OR v_profile.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_TARGET_INVALID';
  END IF;
  SELECT * INTO v_row FROM public.member_suspensions s WHERE s.id = p_suspension_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_NOT_FOUND';
  END IF;
  IF v_row.lifted_at IS NOT NULL OR (v_row.ends_at IS NOT NULL AND v_row.ends_at <= v_now) THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_NOT_ACTIVE';
  END IF;

  UPDATE public.member_suspensions s
     SET lifted_at = v_now, lifted_by = p_actor_id, lift_reason = v_reason
   WHERE s.id = p_suspension_id;

  -- 로그인 차단 해제: 잠근 프로필이 탈퇴 회원이 아닐 때만(위에서 확인) 인증 차단을 푼다.
  IF v_row.scope = 'login_blocked' AND v_profile.withdrawn_at IS NULL THEN
    UPDATE auth.users SET banned_until = NULL WHERE id = v_user;
  END IF;

  PERFORM public.record_admin_audit(p_actor_id, 'member_suspension_lift', 'member', v_user::text, v_user, NULL, NULL,
    jsonb_build_object(
      'suspension_id', v_row.id,
      'scope', v_row.scope,
      'blocks_download', v_row.blocks_download,
      'reason_code', v_row.reason_code,
      'ends_at', v_row.ends_at,
      'lift_reason_length', char_length(v_reason)),
    NULL);

  RETURN jsonb_build_object('suspensionId', v_row.id, 'scope', v_row.scope, 'liftedAt', v_now);
END;
$fn_lift_member_suspension$;

-- 4-3. 알림 기록(수단·보낸 시각·요약). 권한은 그 정지를 할 수 있는 권한과 같다. 비어 있을 때만 채운다. 잠금 순서는 해제와 같다.
CREATE FUNCTION public.record_member_suspension_notice(p_actor_id uuid, p_suspension_id uuid, p_via text, p_sent_at timestamptz, p_summary text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_record_member_suspension_notice$
DECLARE
  v_summary text := btrim(replace(coalesce(p_summary, ''), E'\r\n', E'\n'));
  v_user uuid;
  v_scope text;
  v_profile public.profiles%ROWTYPE;
  v_row public.member_suspensions%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_suspension_id IS NULL OR p_via IS NULL OR p_via NOT IN ('screen', 'email', 'phone')
     OR p_sent_at IS NULL OR p_sent_at > now() + interval '5 minutes' OR char_length(v_summary) > 500 THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_INPUT_INVALID';
  END IF;
  SELECT s.user_id, s.scope INTO v_user, v_scope FROM public.member_suspensions s WHERE s.id = p_suspension_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_NOT_FOUND';
  END IF;
  IF NOT public.member_suspension_actor_allowed(p_actor_id, CASE WHEN v_scope = 'login_blocked' THEN 'owner' ELSE 'members.suspend' END) THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_ACTOR_NOT_ALLOWED';
  END IF;
  SELECT * INTO v_profile FROM public.profiles p WHERE p.id = v_user FOR UPDATE;
  IF NOT FOUND OR v_profile.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_TARGET_INVALID';
  END IF;
  SELECT * INTO v_row FROM public.member_suspensions s WHERE s.id = p_suspension_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_NOT_FOUND';
  END IF;
  IF v_row.notified_at IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_NOTICE_ALREADY_RECORDED';
  END IF;
  IF p_sent_at < v_row.starts_at - interval '1 day' THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_INPUT_INVALID';
  END IF;

  UPDATE public.member_suspensions s
     SET notified_via = p_via, notified_at = p_sent_at, notice_summary = NULLIF(v_summary, '')
   WHERE s.id = p_suspension_id;

  PERFORM public.record_admin_audit(p_actor_id, 'member_suspension_notice_record', 'member', v_user::text, v_user, NULL, NULL,
    jsonb_build_object(
      'suspension_id', v_row.id,
      'scope', v_row.scope,
      'notified_via', p_via,
      'notified_at', p_sent_at,
      'notice_summary_length', char_length(v_summary)),
    NULL);

  RETURN jsonb_build_object('suspensionId', v_row.id, 'notifiedVia', p_via, 'notifiedAt', p_sent_at);
END;
$fn_record_member_suspension_notice$;

-- 4-4. 안내 화면을 처음 연 시각(화면 알림의 증빙). 활성 행이 비어 있을 때만 채우고 작업 기록은 남기지 않는다.
CREATE FUNCTION public.mark_member_suspension_seen(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_mark_member_suspension_seen$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.member_suspensions s
     SET first_seen_at = now()
   WHERE s.user_id = p_user_id AND s.lifted_at IS NULL AND (s.ends_at IS NULL OR s.ends_at > now()) AND s.first_seen_at IS NULL;
  RETURN FOUND;
END;
$fn_mark_member_suspension_seen$;

-- 4-5. 메모 추가: members.memo. 대상은 회원(관리자 아님)이고 탈퇴하지 않은 사람. 프로필 FOR SHARE 로 익명화와 겹치지 않게.
CREATE FUNCTION public.add_member_admin_note(p_actor_id uuid, p_user_id uuid, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_add_member_admin_note$
DECLARE
  v_body text := btrim(replace(coalesce(p_body, ''), E'\r\n', E'\n'));
  v_profile public.profiles%ROWTYPE;
  v_id uuid;
  v_created timestamptz;
BEGIN
  IF p_actor_id IS NULL OR p_user_id IS NULL OR char_length(v_body) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'MEMBER_NOTE_INPUT_INVALID';
  END IF;
  IF NOT public.member_suspension_actor_allowed(p_actor_id, 'members.memo') THEN
    RAISE EXCEPTION 'MEMBER_NOTE_ACTOR_NOT_ALLOWED';
  END IF;
  SELECT * INTO v_profile FROM public.profiles p WHERE p.id = p_user_id FOR SHARE;
  IF NOT FOUND OR v_profile.is_admin IS TRUE OR v_profile.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_NOTE_TARGET_INVALID';
  END IF;

  PERFORM set_config('app.member_suspension_write', p_user_id::text, true);
  INSERT INTO public.member_admin_notes (user_id, body, created_by)
  VALUES (p_user_id, v_body, p_actor_id)
  RETURNING id, created_at INTO v_id, v_created;
  PERFORM set_config('app.member_suspension_write', '', true);

  PERFORM public.record_admin_audit(p_actor_id, 'member_note_add', 'member', p_user_id::text, p_user_id, NULL, NULL,
    jsonb_build_object('note_id', v_id, 'body_length', char_length(v_body)), NULL);

  RETURN jsonb_build_object('noteId', v_id, 'createdAt', v_created);
END;
$fn_add_member_admin_note$;

-- 4-6. 메모 지우기: 작성자 본인(members.memo)이나 대표만. deleted_at 만 채운다(본문은 탈퇴할 때까지 남음 — 처리방침 2·3절).
CREATE FUNCTION public.delete_member_admin_note(p_actor_id uuid, p_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_delete_member_admin_note$
DECLARE
  v_user uuid;
  v_note public.member_admin_notes%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_note_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOTE_INPUT_INVALID';
  END IF;
  SELECT n.user_id INTO v_user FROM public.member_admin_notes n WHERE n.id = p_note_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOTE_NOT_FOUND';
  END IF;
  PERFORM 1 FROM public.profiles p WHERE p.id = v_user FOR SHARE;
  SELECT * INTO v_note FROM public.member_admin_notes n WHERE n.id = p_note_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOTE_NOT_FOUND';
  END IF;
  IF NOT (public.member_suspension_actor_allowed(p_actor_id, 'owner')
          OR (v_note.created_by = p_actor_id AND public.member_suspension_actor_allowed(p_actor_id, 'members.memo'))) THEN
    RAISE EXCEPTION 'MEMBER_NOTE_ACTOR_NOT_ALLOWED';
  END IF;
  IF v_note.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_NOTE_ALREADY_DELETED';
  END IF;

  UPDATE public.member_admin_notes n SET deleted_at = now(), deleted_by = p_actor_id WHERE n.id = p_note_id;

  PERFORM public.record_admin_audit(p_actor_id, 'member_note_delete', 'member', v_user::text, v_user, NULL, NULL,
    jsonb_build_object('note_id', p_note_id, 'body_length', char_length(v_note.body)), NULL);

  RETURN jsonb_build_object('noteId', p_note_id, 'deleted', true);
END;
$fn_delete_member_admin_note$;

-- 4-7. 메모 가림(대표만, 2026-11-26): 적지 말아야 할 개인정보가 적힌 메모의 본문을 가림 문구로 바꾼다(지운 메모도 가릴 수 있음).
--      가림 문구 = COALESCE(NULLIF(btrim(member_withdrawal_policy.texts.redactionMask), ''), '[가림 처리됨]'). 처리방침 2·3절의 근거.
CREATE FUNCTION public.redact_member_admin_note(p_actor_id uuid, p_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_redact_member_admin_note$
DECLARE
  v_user uuid;
  v_note public.member_admin_notes%ROWTYPE;
  v_mask text;
BEGIN
  IF p_actor_id IS NULL OR p_note_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOTE_INPUT_INVALID';
  END IF;
  IF NOT public.member_suspension_actor_allowed(p_actor_id, 'owner') THEN
    RAISE EXCEPTION 'MEMBER_NOTE_ACTOR_NOT_ALLOWED';
  END IF;
  SELECT n.user_id INTO v_user FROM public.member_admin_notes n WHERE n.id = p_note_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOTE_NOT_FOUND';
  END IF;
  PERFORM 1 FROM public.profiles p WHERE p.id = v_user FOR SHARE;
  SELECT * INTO v_note FROM public.member_admin_notes n WHERE n.id = p_note_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOTE_NOT_FOUND';
  END IF;
  IF v_note.redacted_at IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_NOTE_ALREADY_REDACTED';
  END IF;
  SELECT left(COALESCE(NULLIF(btrim(s.value #>> '{texts,redactionMask}'), ''), '[가림 처리됨]'), 2000) INTO v_mask
    FROM public.system_settings s WHERE s.key = 'member_withdrawal_policy';
  v_mask := COALESCE(v_mask, '[가림 처리됨]');

  PERFORM set_config('app.member_note_redact', p_note_id::text, true);
  UPDATE public.member_admin_notes n
     SET body = v_mask, redacted_at = now(), redacted_by = p_actor_id
   WHERE n.id = p_note_id;
  PERFORM set_config('app.member_note_redact', '', true);

  PERFORM public.record_admin_audit(p_actor_id, 'member_note_redact', 'member', v_user::text, v_user, NULL, NULL,
    jsonb_build_object('note_id', p_note_id, 'body_length_before', char_length(v_note.body)), NULL);

  RETURN jsonb_build_object('noteId', p_note_id, 'redacted', true);
END;
$fn_redact_member_admin_note$;

-- 4-8. 활성 정지(서버 가드·안내 화면). 활성 = lifted_at IS NULL AND (ends_at IS NULL OR ends_at > now()). 없으면 NULL.
CREATE FUNCTION public.member_active_suspension(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_active_suspension$
  SELECT jsonb_build_object(
           'id', s.id, 'scope', s.scope, 'blocksDownload', s.blocks_download,
           'reasonCode', s.reason_code, 'reasonLabel', s.reason_label, 'memberReason', s.member_reason,
           'startsAt', s.starts_at, 'endsAt', s.ends_at, 'firstSeenAt', s.first_seen_at)
    FROM public.member_suspensions s
   WHERE s.user_id = p_user_id AND s.lifted_at IS NULL AND (s.ends_at IS NULL OR s.ends_at > now())
   LIMIT 1
$fn_member_active_suspension$;

-- 4-9. 환불·소멸 기한(읽기만, 6-2 표시용). 규칙을 새로 쓰지 않고 기존 함수 값을 쓴다:
--   paidBalance·earliestCreditExpiry = member_withdrawal_facts(유료 잔액·원천별 만료),
--   chargeRefundUntil = get_point_charge_refund_eligibility(allowed 인 충전 원천의 refundable_until 가장 빠른 것),
--   materialRefundUntil = market_refund_deadline(구매 시각, market_purchase_refund_days()) 가장 빠른 것. 대상: 완료 주문 중
--     단품(subproduct 등)은 환불 확정 0·다운로드 없음·심사 중/승인 요청 없음, 묶음(bundle)은 일부를 받았거나 일부 환불돼도 받지 않은 구성의
--     부분 환불이 같은 마감까지 되므로 그 조건 없이 넣는다(남은 구성 판정 대신 더 이른 쪽으로 근사 — 기한 표시는 보수적).
CREATE FUNCTION public.member_refund_deadlines(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_refund_deadlines$
DECLARE
  v_facts jsonb;
  v_expiry timestamptz;
  v_charge timestamptz;
  v_days integer := public.market_purchase_refund_days();
  v_material timestamptz;
BEGIN
  v_facts := public.member_withdrawal_facts(p_user_id, true);
  IF v_facts IS NULL OR (v_facts ->> 'exists') IS DISTINCT FROM 'true' THEN
    RETURN NULL;
  END IF;
  SELECT min((b.e ->> 'expires_at')::timestamptz) INTO v_expiry
    FROM jsonb_array_elements(v_facts -> 'balance' -> 'breakdown') AS b(e)
   WHERE (b.e ->> 'paid')::boolean AND (b.e ->> 'forfeited')::integer > 0;
  SELECT min((x.e ->> 'refundable_until')::timestamptz) INTO v_charge
    FROM public.credit_sources s,
         LATERAL (SELECT public.get_point_charge_refund_eligibility(p_user_id, s.id) AS e) x
   WHERE s.user_id = p_user_id AND s.source_category = 'plan_purchase' AND s.remaining_credits > 0
     AND (x.e -> 'allowed') = 'true'::jsonb;
  IF v_days IS NOT NULL THEN
    SELECT min(public.market_refund_deadline(o.created_at, v_days)) INTO v_material
      FROM public.market_purchase_orders o
     WHERE o.user_id = p_user_id AND o.status = 'completed'
       AND (o.purchase_type = 'bundle'
            OR (COALESCE(o.refund_committed_credits, 0) = 0
                AND NOT EXISTS (SELECT 1 FROM public.market_download_events d WHERE d.order_id = o.id)
                AND NOT EXISTS (SELECT 1 FROM public.market_refund_requests r WHERE r.order_id = o.id AND r.status IN ('pending', 'approved'))))
       AND public.market_refund_deadline(o.created_at, v_days) > now();
  END IF;
  RETURN jsonb_build_object(
    'paidBalance', COALESCE((v_facts -> 'balance' ->> 'forfeitPaid')::integer, 0),
    'earliestCreditExpiry', v_expiry,
    'chargeRefundUntil', v_charge,
    'materialRefundUntil', v_material);
END;
$fn_member_refund_deadlines$;

-- 4-10. 미들웨어 관문(authenticated, auth.uid() 기준): 동의 부족 목록(기존 함수 그대로)과 활성 정지의 범위를 한 번에.
CREATE FUNCTION public.get_my_member_gate()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_get_my_member_gate$
DECLARE
  v_user uuid := auth.uid();
  v_missing jsonb;
  v_restriction jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'MEMBER_GATE_AUTH_REQUIRED';
  END IF;
  SELECT COALESCE(jsonb_agg(m.id), '[]'::jsonb) INTO v_missing FROM public.get_my_missing_required_consents() AS m(id);
  SELECT jsonb_build_object('scope', s.scope, 'blocksDownload', s.blocks_download, 'endsAt', s.ends_at) INTO v_restriction
    FROM public.member_suspensions s
   WHERE s.user_id = v_user AND s.lifted_at IS NULL AND (s.ends_at IS NULL OR s.ends_at > now())
   LIMIT 1;
  RETURN jsonb_build_object('missingRequired', v_missing, 'restriction', v_restriction);
END;
$fn_get_my_member_gate$;

-- 4-11. 문구·분류·최대 일수 저장(대표만, revision 비교 — 15번 저장 함수와 같은 틀). 바뀐 것이 없으면 기록하지 않는다.
CREATE FUNCTION public.save_member_suspension_policy(p_actor_id uuid, p_expected_revision integer, p_value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_save_member_suspension_policy$
DECLARE
  c_text_keys constant text[] := ARRAY[
    'bannerRestricted', 'noticeTitle', 'noticeIntro', 'noticeBlockedList', 'noticeBlockedDownload', 'noticeAvailableList',
    'noticeDeadlines', 'noticeObjection', 'noticeUntilLifted', 'noticeNone', 'noticeCheckFailed', 'apiBlocked', 'loginBlocked',
    'deadlineChargeRefund', 'deadlineMaterialRefund', 'deadlineCreditExpiry', 'ownerMailDeadlines', 'adminMemoGuide', 'adminSuspendConfirm', 'adminDeadlineWarning', 'adminUnderageGuide'];
  v_old jsonb;
  v_old_rev integer;
  v_texts jsonb := '{}'::jsonb;
  v_categories jsonb := '[]'::jsonb;
  v_codes text[] := '{}';
  v_key text;
  v_text text;
  v_c jsonb;
  v_max integer;
  v_new jsonb;
  v_used text;
BEGIN
  IF p_actor_id IS NULL OR NOT public.member_suspension_actor_allowed(p_actor_id, 'owner') THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_ACTOR_NOT_OWNER';
  END IF;
  PERFORM 1 FROM public.profiles p WHERE p.id = p_actor_id FOR SHARE;
  SELECT s.value INTO v_old FROM public.system_settings s WHERE s.key = 'member_suspension_policy' FOR UPDATE;
  IF NOT FOUND OR v_old IS NULL THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_NOT_FOUND';
  END IF;
  v_old_rev := CASE WHEN jsonb_typeof(v_old -> 'revision') = 'number' THEN (v_old ->> 'revision')::numeric::integer END;
  IF p_expected_revision IS NULL OR v_old_rev IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_REVISION_CONFLICT';
  END IF;

  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' OR jsonb_typeof(p_value -> 'texts') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_value -> 'reasonCategories') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_value -> 'maxRestrictedDays') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_INPUT_INVALID: shape';
  END IF;
  -- 문구: 정해진 키만, 비어 있지 않은 글자 1000자 이하
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_value -> 'texts') AS k WHERE NOT (k = ANY (c_text_keys))) THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_INPUT_INVALID: texts';
  END IF;
  FOREACH v_key IN ARRAY c_text_keys LOOP
    IF jsonb_typeof(p_value -> 'texts' -> v_key) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_INPUT_INVALID: texts.%', v_key;
    END IF;
    v_text := btrim(replace(p_value -> 'texts' ->> v_key, E'\r\n', E'\n'));
    IF char_length(v_text) NOT BETWEEN 1 AND 1000 THEN
      RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_INPUT_INVALID: texts.%', v_key;
    END IF;
    v_texts := v_texts || jsonb_build_object(v_key, v_text);
  END LOOP;
  -- 분류: 1~30개, 코드 형식·중복 없음, 이름 1~60자, 조항 0~100자, blocksDownloadDefault·hidden boolean 필수, underageGuide boolean(없으면 false)
  IF jsonb_array_length(p_value -> 'reasonCategories') NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_INPUT_INVALID: reasonCategories';
  END IF;
  FOR v_c IN SELECT c FROM jsonb_array_elements(p_value -> 'reasonCategories') AS c LOOP
    IF jsonb_typeof(v_c) <> 'object'
       OR jsonb_typeof(v_c -> 'code') IS DISTINCT FROM 'string' OR (v_c ->> 'code') !~ '^[a-z][a-z0-9_]{1,39}$'
       OR (v_c ->> 'code') = ANY (v_codes)
       OR jsonb_typeof(v_c -> 'label') IS DISTINCT FROM 'string' OR char_length(btrim(v_c ->> 'label')) NOT BETWEEN 1 AND 60
       OR (v_c ? 'clause' AND jsonb_typeof(v_c -> 'clause') <> 'string')
       OR char_length(btrim(COALESCE(v_c ->> 'clause', ''))) > 100
       OR jsonb_typeof(v_c -> 'blocksDownloadDefault') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(v_c -> 'hidden') IS DISTINCT FROM 'boolean'
       OR (v_c ? 'underageGuide' AND jsonb_typeof(v_c -> 'underageGuide') <> 'boolean') THEN
      RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_INPUT_INVALID: reasonCategories';
    END IF;
    v_codes := v_codes || (v_c ->> 'code');
    v_categories := v_categories || jsonb_build_array(jsonb_build_object(
      'code', v_c ->> 'code', 'label', btrim(v_c ->> 'label'), 'clause', btrim(COALESCE(v_c ->> 'clause', '')),
      'blocksDownloadDefault', v_c -> 'blocksDownloadDefault', 'hidden', v_c -> 'hidden',
      'underageGuide', COALESCE(v_c -> 'underageGuide', 'false'::jsonb)));
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_categories) c WHERE (c -> 'hidden') = 'false'::jsonb) THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_INPUT_INVALID: reasonCategories';
  END IF;
  -- 쓰는 중인(정지 행에 남은) 코드는 지우지 않는다(숨김만)
  SELECT s.reason_code INTO v_used FROM public.member_suspensions s WHERE NOT (s.reason_code = ANY (v_codes)) LIMIT 1;
  IF v_used IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_CODE_IN_USE: %', v_used;
  END IF;
  -- 최대 일수 1~365 정수
  IF (p_value ->> 'maxRestrictedDays')::numeric <> trunc((p_value ->> 'maxRestrictedDays')::numeric)
     OR (p_value ->> 'maxRestrictedDays')::numeric NOT BETWEEN 1 AND 365 THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_INPUT_INVALID: maxRestrictedDays';
  END IF;
  v_max := (p_value ->> 'maxRestrictedDays')::numeric::integer;

  IF (v_old -> 'texts') = v_texts AND (v_old -> 'reasonCategories') = v_categories
     AND (v_old -> 'maxRestrictedDays') = to_jsonb(v_max) THEN
    RETURN jsonb_build_object('changed', false, 'value', v_old);
  END IF;
  v_new := jsonb_build_object('revision', v_old_rev + 1, 'maxRestrictedDays', v_max, 'texts', v_texts, 'reasonCategories', v_categories);
  UPDATE public.system_settings SET value = v_new, updated_at = now() WHERE key = 'member_suspension_policy';

  PERFORM public.record_admin_audit(p_actor_id, 'member_suspension_policy_update', 'system_settings', 'member_suspension_policy', NULL, NULL, NULL,
    jsonb_build_object('revision_before', v_old_rev, 'revision_after', v_old_rev + 1, 'before', v_old, 'after', v_new), NULL);

  RETURN jsonb_build_object('changed', true, 'value', v_new);
END;
$fn_save_member_suspension_policy$;

-- 4-12. 탈퇴와 맞물림(4-4): 익명화(6-6, app.member_withdrawal_bypass 가 켜진 거래)에서 withdrawn_at 이 NULL→값 으로 바뀔 때
--       그 회원의 member_admin_notes 와 member_suspensions 를 모두 지운다. DELETE 만 하므로 예외를 내지 않는다(쓰기 막기는 bypass 로 통과).
--       남는 것은 작업 기록의 범위·분류·기간·처리자·시각·글자 수다. 활성 로그인 차단의 banned_until 은 바로 뒤 6-7 이 100년으로 덮는다.
CREATE FUNCTION public.member_suspension_withdrawal_cleanup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_suspension_withdrawal_cleanup$
BEGIN
  DELETE FROM public.member_admin_notes WHERE user_id = NEW.id;
  DELETE FROM public.member_suspensions WHERE user_id = NEW.id;
  RETURN NULL;
END;
$fn_member_suspension_withdrawal_cleanup$;

-- 4-13. EXECUTE: get_my_member_gate 만 authenticated, 나머지 바깥 함수는 service_role, 내부·트리거 함수는 아무도.
REVOKE ALL ON FUNCTION public.member_suspension_actor_allowed(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_member_suspensions_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_member_admin_notes_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_suspension_withdrawal_cleanup() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.suspend_member(uuid, uuid, text, boolean, text, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.lift_member_suspension(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_member_suspension_notice(uuid, uuid, text, timestamptz, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_member_suspension_seen(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.add_member_admin_note(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_member_admin_note(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.redact_member_admin_note(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_active_suspension(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_refund_deadlines(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_member_gate() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_member_suspension_policy(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.suspend_member(uuid, uuid, text, boolean, text, text, text, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lift_member_suspension(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_member_suspension_notice(uuid, uuid, text, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_member_suspension_seen(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_member_admin_note(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_member_admin_note(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.redact_member_admin_note(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.member_active_suspension(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.member_refund_deadlines(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_member_suspension_policy(uuid, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_my_member_gate() TO authenticated;

-- 5. 권한 교체 함수(4-5): 20261118120000 정의 그대로, 권한 이름 목록에 members.memo·members.suspend 만 더했다. ---------------------
--    md5 는 0번 사전 점검(바탕 dcb2155f…)에서 확인했다. 새 본문 md5(prosrc) 는 VERIFY·되돌리기 머리가 대조한다.
CREATE OR REPLACE FUNCTION public.replace_admin_permission_grants(p_actor_id uuid, p_user_id uuid, p_grants jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_replace_admin_permission_grants$
DECLARE
  v_is_admin boolean;
  v_role text;
  v_email text;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_user_id IS NULL OR p_grants IS NULL OR jsonb_typeof(p_grants) <> 'array' THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_INVALID_ARGUMENT';
  END IF;
  IF p_actor_id = p_user_id THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_SELF_NOT_ALLOWED';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_grants) AS g
     WHERE jsonb_typeof(g) <> 'object'
        OR jsonb_typeof(g -> 'permission') IS DISTINCT FROM 'string'
        OR btrim(g ->> 'permission') = ''
        OR (g ? 'limits' AND jsonb_typeof(g -> 'limits') <> 'object')
  ) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_INVALID_ARGUMENT';
  END IF;
  IF (SELECT count(DISTINCT btrim(g ->> 'permission')) <> count(*) FROM jsonb_array_elements(p_grants) AS g) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_INVALID_ARGUMENT';
  END IF;
  -- 한도 값은 1 이상 2147483647 이하의 정수만(앱 ADMIN_PERMISSION_LIMIT_MAX와 같은 값). 지급 함수가 integer로 비교한다.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_grants) AS g,
           jsonb_each(COALESCE(g -> 'limits', '{}'::jsonb)) AS l(limit_key, limit_value)
     WHERE jsonb_typeof(l.limit_value) <> 'number'
        OR (l.limit_value #>> '{}')::numeric <> trunc((l.limit_value #>> '{}')::numeric)
        OR (l.limit_value #>> '{}')::numeric < 1
        OR (l.limit_value #>> '{}')::numeric > 2147483647
  ) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_INVALID_ARGUMENT';
  END IF;
  -- 코드 목록(src/lib/admin-permissions.ts ADMIN_PERMISSIONS)과 같은 이름만 받는다.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_grants) AS g
     WHERE NOT (btrim(g ->> 'permission') = ANY (ARRAY[
       'support.manage', 'content.manage', 'orders.view', 'members.view', 'credits.view',
       'credits.grant', 'credits.revoke', 'refunds.market', 'refunds.payment',
       'products.edit', 'products.delete', 'storefront.edit', 'reviews.manage',
       'pricing.manage', 'site.manage', 'reports.view', 'credits.limits.manage',
       'members.memo', 'members.suspend'
     ]::text[]))
  ) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_UNKNOWN';
  END IF;

  -- 행위자 확인은 행을 잠그며 한다(FOR SHARE): 확인한 직후 그 대표가 삭제·강등되는 틈을 막는다.
  PERFORM 1 FROM public.profiles p
   WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.admin_role = 'owner'
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_ACTOR_NOT_OWNER';
  END IF;

  -- 잠금: 권한 행 → 프로필 행. 같은 계정의 동시 저장·해제는 프로필 행에서 차례를 기다린다.
  PERFORM 1 FROM public.admin_permission_grants g WHERE g.user_id = p_user_id FOR UPDATE;
  SELECT p.is_admin, p.admin_role, p.email
    INTO v_is_admin, v_role, v_email
    FROM public.profiles p
   WHERE p.id = p_user_id
     FOR UPDATE;
  IF NOT FOUND OR v_is_admin IS NOT TRUE OR v_role IS DISTINCT FROM 'staff' THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_TARGET_NOT_STAFF';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('permission', g.permission, 'limits', g.limits) ORDER BY g.permission), '[]'::jsonb)
    INTO v_before
    FROM public.admin_permission_grants g
   WHERE g.user_id = p_user_id;

  DELETE FROM public.admin_permission_grants g WHERE g.user_id = p_user_id;

  INSERT INTO public.admin_permission_grants (user_id, permission, limits, granted_by)
  SELECT p_user_id, btrim(g ->> 'permission'), COALESCE(g -> 'limits', '{}'::jsonb), p_actor_id
    FROM jsonb_array_elements(p_grants) AS g;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('permission', g.permission, 'limits', g.limits) ORDER BY g.permission), '[]'::jsonb)
    INTO v_after
    FROM public.admin_permission_grants g
   WHERE g.user_id = p_user_id;

  PERFORM public.record_admin_audit(
    p_actor_id,
    'admin_permissions_replace',
    'admin_account',
    p_user_id::text,
    NULL,
    NULL,
    NULL,
    jsonb_build_object('target_email', v_email, 'before', v_before, 'after', v_after),
    NULL
  );

  RETURN jsonb_build_object('before', v_before, 'after', v_after);
END;
$fn_replace_admin_permission_grants$;

-- 6. 탈퇴 트리거(4-4) — profiles 에 SHARE ROW EXCLUSIVE ---------------------------------------------------------------
CREATE TRIGGER member_suspension_withdrawal_cleanup
  AFTER UPDATE OF withdrawn_at ON public.profiles
  FOR EACH ROW
  WHEN (OLD.withdrawn_at IS NULL AND NEW.withdrawn_at IS NOT NULL)
  EXECUTE FUNCTION public.member_suspension_withdrawal_cleanup();

-- 7. 쓰기 막기 정책(4-5): 화면 세션(대표 포함)이 설정 행을 직접 고치지 못한다 — system_settings 에 ACCESS EXCLUSIVE -------------
CREATE POLICY system_settings_member_suspension_policy_no_client_write
  ON public.system_settings
  AS RESTRICTIVE
  FOR UPDATE
  USING (key <> 'member_suspension_policy')
  WITH CHECK (key <> 'member_suspension_policy');
-- [12번] 끝 -----------------------------------------------------------------------------------------------------

-- 8. VERIFY(4-6) -------------------------------------------------------------------------------------------------
DO $verify_member_suspension$
DECLARE
  v_rel text;
  v_fn text;
  v_policy jsonb;
BEGIN
  -- 표·RLS(정책 0)·부분 UNIQUE·operation_key UNIQUE·쓰기 막기 트리거 2개
  FOREACH v_rel IN ARRAY ARRAY['public.member_suspensions', 'public.member_admin_notes'] LOOP
    IF to_regclass(v_rel) IS NULL OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass(v_rel))
       OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = to_regclass(v_rel)) THEN
      RAISE EXCEPTION 'VERIFY: % table / RLS / no policies', v_rel;
    END IF;
    -- service_role 은 SELECT 만, API 역할은 아무 권한 없음
    IF NOT has_table_privilege('service_role', v_rel, 'SELECT')
       OR has_table_privilege('service_role', v_rel, 'INSERT') OR has_table_privilege('service_role', v_rel, 'UPDATE')
       OR has_table_privilege('service_role', v_rel, 'DELETE') OR has_table_privilege('service_role', v_rel, 'TRUNCATE')
       OR has_table_privilege('anon', v_rel, 'SELECT') OR has_table_privilege('authenticated', v_rel, 'SELECT')
       OR has_table_privilege('anon', v_rel, 'INSERT') OR has_table_privilege('authenticated', v_rel, 'INSERT')
       OR has_table_privilege('authenticated', v_rel, 'UPDATE') OR has_table_privilege('authenticated', v_rel, 'DELETE') THEN
      RAISE EXCEPTION 'VERIFY: % privileges', v_rel;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'member_suspensions'
                  AND indexname = 'member_suspensions_one_open' AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%WHERE (lifted_at IS NULL)%')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.member_suspensions'::regclass
                     AND conname = 'member_suspensions_operation_key_key' AND contype = 'u') THEN
    RAISE EXCEPTION 'VERIFY: partial unique / operation_key unique';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
       AND ((t.tgrelid = 'public.member_suspensions'::regclass AND t.tgname = 'guard_member_suspensions_mutation')
         OR (t.tgrelid = 'public.member_admin_notes'::regclass AND t.tgname = 'guard_member_admin_notes_mutation'))) <> 2 THEN
    RAISE EXCEPTION 'VERIFY: write guard triggers';
  END IF;

  -- EXECUTE: get_my_member_gate 만 authenticated, 바깥 함수는 service_role 만, 내부·트리거 함수는 아무도
  FOREACH v_fn IN ARRAY ARRAY[
    'public.suspend_member(uuid,uuid,text,boolean,text,text,text,timestamp with time zone,text)',
    'public.lift_member_suspension(uuid,uuid,text)',
    'public.record_member_suspension_notice(uuid,uuid,text,timestamp with time zone,text)',
    'public.mark_member_suspension_seen(uuid)',
    'public.add_member_admin_note(uuid,uuid,text)',
    'public.delete_member_admin_note(uuid,uuid)',
    'public.redact_member_admin_note(uuid,uuid)',
    'public.member_active_suspension(uuid)',
    'public.member_refund_deadlines(uuid)',
    'public.save_member_suspension_policy(uuid,integer,jsonb)',
    'public.replace_admin_permission_grants(uuid,uuid,jsonb)'] LOOP
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'VERIFY: % EXECUTE must be service_role only', v_fn;
    END IF;
    IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS NOT TRUE
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND 'search_path=public, pg_temp' = ANY (p.proconfig)) THEN
      RAISE EXCEPTION 'VERIFY: % must be SECURITY DEFINER with fixed search_path', v_fn;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', 'public.get_my_member_gate()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_my_member_gate()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.get_my_member_gate()', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY: get_my_member_gate EXECUTE must be authenticated only';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY['public.member_suspension_actor_allowed(uuid,text)', 'public.guard_member_suspensions_mutation()',
                              'public.guard_member_admin_notes_mutation()', 'public.member_suspension_withdrawal_cleanup()'] LOOP
    IF has_function_privilege('service_role', v_fn, 'EXECUTE') OR has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'VERIFY: % must not be executable by API roles', v_fn;
    END IF;
  END LOOP;

  -- 권한 교체 함수: 새 본문(목록에 두 키) 그대로
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.replace_admin_permission_grants(uuid,uuid,jsonb)'::regprocedure)
     IS DISTINCT FROM 'd6cd294fb5cb60c7e17356c895bf259b' THEN
    RAISE EXCEPTION 'VERIFY: replace_admin_permission_grants body (%)',
      (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.replace_admin_permission_grants(uuid,uuid,jsonb)'::regprocedure);
  END IF;

  -- 설정 행: revision·최대 일수·분류(blocksDownloadDefault 가 boolean)·문구 키 21개
  SELECT value INTO v_policy FROM public.system_settings WHERE key = 'member_suspension_policy';
  IF v_policy IS NULL OR jsonb_typeof(v_policy -> 'revision') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_policy -> 'maxRestrictedDays') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_policy -> 'reasonCategories') IS DISTINCT FROM 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_policy -> 'reasonCategories') c
                 WHERE jsonb_typeof(c -> 'blocksDownloadDefault') IS DISTINCT FROM 'boolean')
     OR (SELECT count(*) FROM jsonb_object_keys(v_policy -> 'texts')) <> 21 THEN
    RAISE EXCEPTION 'VERIFY: member_suspension_policy row';
  END IF;
END;
$verify_member_suspension$;

-- 탈퇴 트리거 검사는 이름 붙인 별도 블록이다(리허설 light 사본은 profiles 트리거와 이 블록을 뺀다).
DO $verify_member_suspension_profiles_trigger$
BEGIN
  IF (SELECT count(*) FROM pg_trigger t JOIN pg_proc f ON f.oid = t.tgfoid
       WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal AND t.tgenabled = 'O'
         AND t.tgname = 'member_suspension_withdrawal_cleanup'
         AND f.prosrc LIKE '%member_suspensions%' AND f.prosrc LIKE '%member_admin_notes%') <> 1
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal) <> 2 THEN
    RAISE EXCEPTION 'VERIFY: profiles withdrawal trigger';
  END IF;
  -- 두 표의 FK 는 profiles(id) ON DELETE CASCADE
  IF (SELECT count(*) FROM pg_constraint c
       WHERE c.contype = 'f' AND c.confrelid = 'public.profiles'::regclass AND c.confdeltype = 'c'
         AND c.conrelid IN ('public.member_suspensions'::regclass, 'public.member_admin_notes'::regclass)) <> 2 THEN
    RAISE EXCEPTION 'VERIFY: profiles foreign keys';
  END IF;
END;
$verify_member_suspension_profiles_trigger$;

-- 정책 검사는 이름 붙인 별도 블록이다(리허설 light 사본은 CREATE POLICY 와 이 블록을 뺀다).
DO $verify_member_suspension_policy$
BEGIN
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'system_settings' AND permissive = 'RESTRICTIVE' AND cmd = 'UPDATE'
         AND policyname = 'system_settings_member_suspension_policy_no_client_write'
         AND qual = '(key <> ''member_suspension_policy''::text)' AND with_check = '(key <> ''member_suspension_policy''::text)') <> 1 THEN
    RAISE EXCEPTION 'VERIFY: member_suspension_policy RESTRICTIVE policy';
  END IF;
END;
$verify_member_suspension_policy$;

NOTIFY pgrst, 'reload schema';
$rh_src_migration$);
SELECT pg_temp.ctx_set('src_down', $rh_src_down$-- 12번 묶음 되돌리기(supabase/migrations/20261214100000_member_suspension.sql 의 down). 계획 docs/plan-bundle12-member-suspension.md 4-6·10절.
-- 코드를 12번 전으로 되돌린 뒤에만 실행한다(새 코드는 함수가 없으면 구매를 막는다 — 10절). 13번 묶음이 적용돼 있으면 13번을 먼저 되돌린다.
-- 머리 확인(하나라도 어기면 멈춤):
--   ① 활성 정지 0건 ② scope = 'login_blocked' 이면서 banned_until 이 남은 탈퇴 안 한 회원 0건 ③ members.memo·members.suspend 권한 행 0건
--   ④ replace_admin_permission_grants 의 지금 md5(prosrc)가 12번 적용 뒤 값(d6cd294f…)과 같음 — 다르면 뒤 묶음이 다시 정의한 것이므로 멈춘다
--   ⑤ 13번 마이그레이션 version(20261215100000·110000·120000·130000, 시각이 바뀌어도 12번 뒤 이름에 bundle13 이 든 것)과 13번 표 admin_member_access_log 가 없음
-- 지난 정지 이력·메모가 있으면 대표가 내보내기를 확인한 뒤에만 지운다(아래 두 상수를 true 로 바꿔 실행). 뼈대는 작업 기록에 남는다(4-3).
--   내보내기 파일 규칙(4-6): 탈퇴 회원 행은 내보내지 않는다(이미 지워짐). 표를 다시 만들 때 되돌려 넣은 뒤 바로 파기하고, 다시 만들지 않기로
--   하면 그때 파기한다. 보관 중에 그 회원이 탈퇴하면 그 회원 행을 파일에서 지운다. 파일은 대표만 갖고 런북 RB-12 에 파기 날짜를 적는다.
-- 순서: 트리거 → 함수 → replace_admin_permission_grants 를 20261118120000 정의로 되돌림 → 정책 → 설정 행 → 표.
-- 이 파일은 이력 행을 지우지 않는다. 다시 적용하려면 같은 거래에서 schema_migrations 의 '20261214100000' 행을 지운 뒤 마이그레이션과 이력 INSERT 를 넣는다.
-- 잠금: profiles 트리거 삭제(ACCESS EXCLUSIVE), system_settings 정책 삭제(ACCESS EXCLUSIVE). 새벽 짧은 창에서 실행한다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $precheck_member_suspension_down$
DECLARE
  c_suspensions_export_confirmed constant boolean := false;
  c_notes_export_confirmed constant boolean := false;
BEGIN
  IF to_regclass('public.member_suspensions') IS NULL OR to_regclass('public.member_admin_notes') IS NULL THEN
    RAISE EXCEPTION 'DOWN PRECHECK: bundle 12 tables missing (not the bundle 12 state)';
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations m
              WHERE m.version IN ('20261215100000', '20261215110000', '20261215120000', '20261215130000')
                 OR (m.version > '20261214100000' AND m.name LIKE '%bundle13%'))
     OR to_regclass('public.admin_member_access_log') IS NOT NULL THEN
    RAISE EXCEPTION 'DOWN PRECHECK: bundle 13 is applied — roll back bundle 13 first';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure('public.replace_admin_permission_grants(uuid,uuid,jsonb)'))
     IS DISTINCT FROM 'd6cd294fb5cb60c7e17356c895bf259b' THEN
    RAISE EXCEPTION 'DOWN PRECHECK: replace_admin_permission_grants is not the bundle 12 definition (%)',
      (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure('public.replace_admin_permission_grants(uuid,uuid,jsonb)'));
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_suspensions s WHERE s.lifted_at IS NULL AND (s.ends_at IS NULL OR s.ends_at > now())) THEN
    RAISE EXCEPTION 'DOWN PRECHECK: active suspensions exist — lift them first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_suspensions s
               JOIN auth.users u ON u.id = s.user_id
               JOIN public.profiles p ON p.id = s.user_id
              WHERE s.scope = 'login_blocked' AND p.withdrawn_at IS NULL
                AND u.banned_until IS NOT NULL AND u.banned_until > now()) THEN
    RAISE EXCEPTION 'DOWN PRECHECK: login_blocked member still banned (banned_until) — check the runbook first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_permission_grants g WHERE g.permission IN ('members.memo', 'members.suspend')) THEN
    RAISE EXCEPTION 'DOWN PRECHECK: members.memo / members.suspend grants exist — owner revokes them first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_suspensions) AND NOT c_suspensions_export_confirmed THEN
    RAISE EXCEPTION 'DOWN PRECHECK: suspension history exists — owner confirms export (c_suspensions_export_confirmed)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_admin_notes) AND NOT c_notes_export_confirmed THEN
    RAISE EXCEPTION 'DOWN PRECHECK: admin notes exist — owner confirms export (c_notes_export_confirmed)';
  END IF;
END;
$precheck_member_suspension_down$;

-- [12번] 시작: 되돌림 ----------------------------------------------------------------------------------------------
-- 1. 탈퇴 트리거(profiles)
DROP TRIGGER member_suspension_withdrawal_cleanup ON public.profiles;

-- 2. 함수(쓰기 막기 트리거는 표와 함께 지워진다)
DROP FUNCTION public.get_my_member_gate();
DROP FUNCTION public.save_member_suspension_policy(uuid, integer, jsonb);
DROP FUNCTION public.member_refund_deadlines(uuid);
DROP FUNCTION public.member_active_suspension(uuid);
DROP FUNCTION public.redact_member_admin_note(uuid, uuid);
DROP FUNCTION public.delete_member_admin_note(uuid, uuid);
DROP FUNCTION public.add_member_admin_note(uuid, uuid, text);
DROP FUNCTION public.mark_member_suspension_seen(uuid);
DROP FUNCTION public.record_member_suspension_notice(uuid, uuid, text, timestamptz, text);
DROP FUNCTION public.lift_member_suspension(uuid, uuid, text);
DROP FUNCTION public.suspend_member(uuid, uuid, text, boolean, text, text, text, timestamptz, text);
DROP FUNCTION public.member_suspension_actor_allowed(uuid, text);
DROP FUNCTION public.member_suspension_withdrawal_cleanup();

-- 3. 권한 교체 함수: 20261118120000 정의 그대로(본문 md5(prosrc) 54540b6b…)
CREATE OR REPLACE FUNCTION public.replace_admin_permission_grants(p_actor_id uuid, p_user_id uuid, p_grants jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_replace_admin_permission_grants$
DECLARE
  v_is_admin boolean;
  v_role text;
  v_email text;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_user_id IS NULL OR p_grants IS NULL OR jsonb_typeof(p_grants) <> 'array' THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_INVALID_ARGUMENT';
  END IF;
  IF p_actor_id = p_user_id THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_SELF_NOT_ALLOWED';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_grants) AS g
     WHERE jsonb_typeof(g) <> 'object'
        OR jsonb_typeof(g -> 'permission') IS DISTINCT FROM 'string'
        OR btrim(g ->> 'permission') = ''
        OR (g ? 'limits' AND jsonb_typeof(g -> 'limits') <> 'object')
  ) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_INVALID_ARGUMENT';
  END IF;
  IF (SELECT count(DISTINCT btrim(g ->> 'permission')) <> count(*) FROM jsonb_array_elements(p_grants) AS g) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_INVALID_ARGUMENT';
  END IF;
  -- 한도 값은 1 이상 2147483647 이하의 정수만(앱 ADMIN_PERMISSION_LIMIT_MAX와 같은 값). 지급 함수가 integer로 비교한다.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_grants) AS g,
           jsonb_each(COALESCE(g -> 'limits', '{}'::jsonb)) AS l(limit_key, limit_value)
     WHERE jsonb_typeof(l.limit_value) <> 'number'
        OR (l.limit_value #>> '{}')::numeric <> trunc((l.limit_value #>> '{}')::numeric)
        OR (l.limit_value #>> '{}')::numeric < 1
        OR (l.limit_value #>> '{}')::numeric > 2147483647
  ) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_INVALID_ARGUMENT';
  END IF;
  -- 코드 목록(src/lib/admin-permissions.ts ADMIN_PERMISSIONS)과 같은 이름만 받는다.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_grants) AS g
     WHERE NOT (btrim(g ->> 'permission') = ANY (ARRAY[
       'support.manage', 'content.manage', 'orders.view', 'members.view', 'credits.view',
       'credits.grant', 'credits.revoke', 'refunds.market', 'refunds.payment',
       'products.edit', 'products.delete', 'storefront.edit', 'reviews.manage',
       'pricing.manage', 'site.manage', 'reports.view', 'credits.limits.manage'
     ]::text[]))
  ) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_UNKNOWN';
  END IF;

  -- 행위자 확인은 행을 잠그며 한다(FOR SHARE): 확인한 직후 그 대표가 삭제·강등되는 틈을 막는다.
  PERFORM 1 FROM public.profiles p
   WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.admin_role = 'owner'
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_ACTOR_NOT_OWNER';
  END IF;

  -- 잠금: 권한 행 → 프로필 행. 같은 계정의 동시 저장·해제는 프로필 행에서 차례를 기다린다.
  PERFORM 1 FROM public.admin_permission_grants g WHERE g.user_id = p_user_id FOR UPDATE;
  SELECT p.is_admin, p.admin_role, p.email
    INTO v_is_admin, v_role, v_email
    FROM public.profiles p
   WHERE p.id = p_user_id
     FOR UPDATE;
  IF NOT FOUND OR v_is_admin IS NOT TRUE OR v_role IS DISTINCT FROM 'staff' THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_TARGET_NOT_STAFF';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('permission', g.permission, 'limits', g.limits) ORDER BY g.permission), '[]'::jsonb)
    INTO v_before
    FROM public.admin_permission_grants g
   WHERE g.user_id = p_user_id;

  DELETE FROM public.admin_permission_grants g WHERE g.user_id = p_user_id;

  INSERT INTO public.admin_permission_grants (user_id, permission, limits, granted_by)
  SELECT p_user_id, btrim(g ->> 'permission'), COALESCE(g -> 'limits', '{}'::jsonb), p_actor_id
    FROM jsonb_array_elements(p_grants) AS g;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('permission', g.permission, 'limits', g.limits) ORDER BY g.permission), '[]'::jsonb)
    INTO v_after
    FROM public.admin_permission_grants g
   WHERE g.user_id = p_user_id;

  PERFORM public.record_admin_audit(
    p_actor_id,
    'admin_permissions_replace',
    'admin_account',
    p_user_id::text,
    NULL,
    NULL,
    NULL,
    jsonb_build_object('target_email', v_email, 'before', v_before, 'after', v_after),
    NULL
  );

  RETURN jsonb_build_object('before', v_before, 'after', v_after);
END;
$fn_replace_admin_permission_grants$;
-- 4. 정책 → 설정 행 → 표(쓰기 막기 트리거·함수 포함)
DROP POLICY system_settings_member_suspension_policy_no_client_write ON public.system_settings;
DELETE FROM public.system_settings WHERE key = 'member_suspension_policy';
DROP TABLE public.member_admin_notes;
DROP TABLE public.member_suspensions;
DROP FUNCTION public.guard_member_admin_notes_mutation();
DROP FUNCTION public.guard_member_suspensions_mutation();
-- [12번] 끝 -----------------------------------------------------------------------------------------------------

DO $verify_member_suspension_down$
BEGIN
  IF to_regclass('public.member_suspensions') IS NOT NULL OR to_regclass('public.member_admin_notes') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN (
          'member_suspension_actor_allowed', 'suspend_member', 'lift_member_suspension', 'record_member_suspension_notice',
          'mark_member_suspension_seen', 'add_member_admin_note', 'delete_member_admin_note', 'redact_member_admin_note',
          'member_active_suspension', 'member_refund_deadlines', 'get_my_member_gate', 'save_member_suspension_policy',
          'guard_member_suspensions_mutation', 'guard_member_admin_notes_mutation', 'member_suspension_withdrawal_cleanup'))
     OR EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'member_suspension_policy')
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings'
                 AND policyname = 'system_settings_member_suspension_policy_no_client_write')
     OR (SELECT array_agg(t.tgname::text ORDER BY t.tgname) FROM pg_trigger t
          WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal) IS DISTINCT FROM ARRAY['profiles_keep_admin_owner'] THEN
    RAISE EXCEPTION 'DOWN VERIFY: bundle 12 objects remain';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.replace_admin_permission_grants(uuid,uuid,jsonb)'::regprocedure)
     IS DISTINCT FROM '54540b6b0286f81f243575f1c03a568c'
     OR md5(pg_get_functiondef('public.replace_admin_permission_grants(uuid,uuid,jsonb)'::regprocedure)) <> 'dcb2155fae26443c98231627d102a821' THEN
    RAISE EXCEPTION 'DOWN VERIFY: replace_admin_permission_grants is not the 20261118120000 definition';
  END IF;
END;
$verify_member_suspension_down$;

NOTIFY pgrst, 'reload schema';
$rh_src_down$);
SELECT pg_temp.ctx_set('mode', 'full');

-- ===== 계정: @test.com 시험 계정만(관리자·탈퇴 아님, 가입 완료). 결제·결제 시도·자료 구매·탈퇴 요청이 없는 계정 둘(A·B)은 익명화(S8)용,
--       나머지 셋은 대표(C)·직원(D)·대상 회원(E). 모자라면 멈춘다(실회원 id 로 대신하지 않음). =====
DO $rh_setup$
DECLARE
  v_clean uuid[];
  v_rest uuid[];
  v_pool uuid[];
BEGIN
  SELECT coalesce(array_agg(p.id ORDER BY u.created_at), '{}') INTO v_clean
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE u.email LIKE '%@test.com' AND p.withdrawn_at IS NULL AND p.is_admin IS NOT TRUE AND p.signup_completed IS TRUE
     AND NOT EXISTS (SELECT 1 FROM public.payment_orders o WHERE o.user_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM public.checkout_attempts a WHERE a.user_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM public.market_purchase_orders m WHERE m.user_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM public.member_withdrawal_requests r WHERE r.user_id = p.id);
  SELECT coalesce(array_agg(p.id ORDER BY u.created_at), '{}') INTO v_rest
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE u.email LIKE '%@test.com' AND p.withdrawn_at IS NULL AND p.is_admin IS NOT TRUE AND p.signup_completed IS TRUE
     AND NOT (p.id = ANY (v_clean));
  IF cardinality(v_clean) < 2 OR cardinality(v_clean) + cardinality(v_rest) < 5 THEN
    RAISE EXCEPTION 'RH FAIL [setup] @test.com 시험 계정이 모자람(결제 없는 계정 %개·전체 %개, 필요 2·5) — 실회원 id 로 대신하지 않고 멈춘다',
      cardinality(v_clean), cardinality(v_clean) + cardinality(v_rest);
  END IF;
  v_pool := v_rest || v_clean[3:];
  PERFORM pg_temp.ctx_set('A', v_clean[1]::text);
  PERFORM pg_temp.ctx_set('B', v_clean[2]::text);
  PERFORM pg_temp.ctx_set('owner', v_pool[1]::text);
  PERFORM pg_temp.ctx_set('staff', v_pool[2]::text);
  PERFORM pg_temp.ctx_set('E', v_pool[3]::text);
  INSERT INTO _rh_log (test, msg, payload) VALUES ('setup', '시험 계정 배정(@test.com 만)',
    jsonb_build_object('clean', cardinality(v_clean), 'total', cardinality(v_clean) + cardinality(v_rest)));
END
$rh_setup$;

DO $rh_s13_before$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
BEGIN
  BEGIN

    v_r := pg_temp.try_sql(pg_temp.ctx('src_down'));
    v_log := v_log || pg_temp.expect(v_r, 'ERR DOWN PRECHECK: bundle 12 tables missing', 'S13', '적용 전 down 은 머리 확인에서 멈춤');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'S13', m FROM unnest(v_log) m;
END
$rh_s13_before$;

-- ===== 12번 마이그레이션(원본 그대로) =====
-- 출시 전 작업 순서표 12번 묶음: 회원 이용 정지·관리자 메모(계획 docs/plan-bundle12-member-suspension.md 3판, 4절).
-- 만드는 것:
--   1. 표 member_suspensions(정지 이력, 회원마다 해제 안 된 행 1건)·member_admin_notes(관리자 상담 메모). RLS 켬·정책 0,
--      anon·authenticated 권한 없음, service_role 은 SELECT 만. 쓰기는 DEFINER 함수와 탈퇴 트리거뿐(쓰기 막기 트리거가 두 번째 방어).
--   2. 함수(SECURITY DEFINER, search_path 고정): suspend_member·lift_member_suspension·record_member_suspension_notice·
--      mark_member_suspension_seen·add_member_admin_note·delete_member_admin_note·redact_member_admin_note·member_active_suspension·
--      member_refund_deadlines·save_member_suspension_policy(service_role), get_my_member_gate(authenticated), 내부 member_suspension_actor_allowed.
--   3. 설정 행 member_suspension_policy(9절 초안, revision 1 — 있으면 그대로)와 RESTRICTIVE 정책(화면 세션 직접 쓰기 막음).
--   4. replace_admin_permission_grants 재정의: 권한 이름 목록에 members.memo·members.suspend 만 더했다(20261118120000 정의 그대로).
--   5. profiles AFTER UPDATE OF withdrawn_at 트리거: 익명화(anonymize_member 6-6)하는 거래에서 그 회원의 메모·정지 행을 지운다(예외 없음).
-- 작업 기록(admin_audit_log)에는 자유 글을 넣지 않는다: p_reason NULL, details 에는 범위·분류·기간·알림 수단과 글자 수만(지문 없음).
-- 함수 지문은 md5(pg_get_functiondef(oid)) — 9·10·11번과 같은 측정(2026-11-26 운영 읽기 전용 값). 다르면 멈춘다.
--   재정의한 replace_admin_permission_grants 는 md5(prosrc)(본문 글, 로컬 계산 가능)로 VERIFY·되돌리기 머리에서 대조한다.
-- 잠금: 새 표 2개(새로 만듦), profiles 에 FK 2개·트리거 1개(SHARE ROW EXCLUSIVE — 쓰기를 잠깐 막음), system_settings 에 정책 1개
--   (ACCESS EXCLUSIVE — 읽기도 잠깐 막음). 새벽 짧은 창에서 적용하고, 잡지 못하면(lock_timeout 3초) 전체가 취소된다.
-- 버전: 20261214100000 은 이미 들어간 20261216100000(11번)보다 앞이다. 이 저장소는 db push 를 쓰지 않고 파일 단위로 적용하며
--   이력은 같은 거래의 schema_migrations INSERT 로 넣으므로 순서가 문제 되지 않는다(13번 20261215… 도 같은 방식, 12번 먼저).
-- 되돌리기: supabase/rollback/20261214100000_member_suspension_down.sql(코드를 12번 전으로 되돌린 뒤에만, 13번이 있으면 13번 먼저).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

-- 0. 사전 점검(4-1) -----------------------------------------------------------------------------------------------
DO $precheck_member_suspension$
DECLARE
  -- 그대로여야 하거나(새 관문 함수가 부름·탈퇴 트리거가 그 거래에서 돎), 이 파일이 바꾸는 바탕 값(2026-11-26 운영)
  v_same text[][] := ARRAY[
    ARRAY['public.get_my_missing_required_consents()', 'a94b8de5fcfd4e5a81c4d988fabcb89f'],
    ARRAY['public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)', '1346d870d3623abae580a011b0484339'],
    ARRAY['public.replace_admin_permission_grants(uuid,uuid,jsonb)', 'dcb2155fae26443c98231627d102a821'],
    ARRAY['public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)', 'a42b474d9d95753ffba5041acb0c1c77'],
    ARRAY['public.member_withdrawal_facts(uuid,boolean)', 'a7674770964dac2fe5c9179b8403c3b4'],
    ARRAY['public.get_point_charge_refund_eligibility(uuid,uuid)', '60fc28afe44e7be776c189265e87b6ec']
  ];
  v_new_functions text[] := ARRAY[
    'member_suspension_actor_allowed', 'suspend_member', 'lift_member_suspension', 'record_member_suspension_notice',
    'mark_member_suspension_seen', 'add_member_admin_note', 'delete_member_admin_note', 'redact_member_admin_note',
    'member_active_suspension', 'member_refund_deadlines', 'get_my_member_gate', 'save_member_suspension_policy',
    'guard_member_suspensions_mutation', 'guard_member_admin_notes_mutation', 'member_suspension_withdrawal_cleanup'];
  i integer;
BEGIN
  FOR i IN 1 .. array_length(v_same, 1) LOOP
    IF to_regprocedure(v_same[i][1]) IS NULL OR md5(pg_get_functiondef(to_regprocedure(v_same[i][1]))) <> v_same[i][2] THEN
      RAISE EXCEPTION 'PRECHECK: % changed (%)', v_same[i][1],
        CASE WHEN to_regprocedure(v_same[i][1]) IS NULL THEN 'missing' ELSE md5(pg_get_functiondef(to_regprocedure(v_same[i][1]))) END;
    END IF;
  END LOOP;
  IF to_regclass('public.member_suspensions') IS NOT NULL OR to_regclass('public.member_admin_notes') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECHECK: member_suspensions / member_admin_notes already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (v_new_functions)) THEN
    RAISE EXCEPTION 'PRECHECK: bundle 12 functions already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'member_suspension_policy') THEN
    RAISE EXCEPTION 'PRECHECK: member_suspension_policy row already exists';
  END IF;
  IF (SELECT array_agg(t.tgname::text ORDER BY t.tgname) FROM pg_trigger t
       WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal) IS DISTINCT FROM ARRAY['profiles_keep_admin_owner'] THEN
    RAISE EXCEPTION 'PRECHECK: profiles triggers changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_permission_grants g WHERE g.permission IN ('members.memo', 'members.suspend')) THEN
    RAISE EXCEPTION 'PRECHECK: members.memo / members.suspend grants already exist';
  END IF;
  IF to_regprocedure('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'member_withdrawal_policy') THEN
    RAISE EXCEPTION 'PRECHECK: record_admin_audit / member_withdrawal_policy missing';
  END IF;
END;
$precheck_member_suspension$;

-- [12번] 시작 ---------------------------------------------------------------------------------------------------
-- 1. 표(4-2) ----------------------------------------------------------------------------------------------------
-- 행위자 칸(created_by·lifted_by·deleted_by·redacted_by)은 FK 없는 uuid 다(관리자 계정을 지워도 이력이 남음).
CREATE TABLE public.member_suspensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('restricted', 'login_blocked')),
  blocks_download boolean NOT NULL,
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_]{1,39}$'),
  reason_label text NOT NULL CHECK (char_length(reason_label) BETWEEN 1 AND 60),
  member_reason text NOT NULL CHECK (char_length(member_reason) BETWEEN 1 AND 500 AND btrim(member_reason) <> ''),
  internal_note text NOT NULL DEFAULT '' CHECK (char_length(internal_note) <= 2000),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  created_by uuid NOT NULL,
  lifted_at timestamptz,
  lifted_by uuid,
  lift_reason text CHECK (lift_reason IS NULL OR (char_length(lift_reason) BETWEEN 1 AND 500 AND btrim(lift_reason) <> '')),
  operation_key text NOT NULL CHECK (char_length(operation_key) BETWEEN 8 AND 200),
  notified_via text CHECK (notified_via IS NULL OR notified_via IN ('screen', 'email', 'phone')),
  notified_at timestamptz,
  notice_summary text CHECK (notice_summary IS NULL OR char_length(notice_summary) <= 500),
  first_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_suspensions_operation_key_key UNIQUE (operation_key),
  CONSTRAINT member_suspensions_login_blocked_download CHECK (scope <> 'login_blocked' OR blocks_download),
  CONSTRAINT member_suspensions_restricted_ends CHECK (scope <> 'restricted' OR ends_at IS NOT NULL),
  CONSTRAINT member_suspensions_period CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT member_suspensions_lifted CHECK ((lifted_at IS NULL) = (lift_reason IS NULL) AND (lifted_at IS NOT NULL OR lifted_by IS NULL)),
  CONSTRAINT member_suspensions_notified CHECK ((notified_via IS NULL) = (notified_at IS NULL) AND (notified_at IS NOT NULL OR notice_summary IS NULL))
);
CREATE UNIQUE INDEX member_suspensions_one_open ON public.member_suspensions (user_id) WHERE lifted_at IS NULL;
CREATE INDEX member_suspensions_user_created ON public.member_suspensions (user_id, created_at DESC);

CREATE TABLE public.member_admin_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000 AND btrim(body) <> ''),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  redacted_at timestamptz,
  redacted_by uuid,
  CONSTRAINT member_admin_notes_deleted CHECK ((deleted_at IS NULL) = (deleted_by IS NULL)),
  CONSTRAINT member_admin_notes_redacted CHECK ((redacted_at IS NULL) = (redacted_by IS NULL))
);
CREATE INDEX member_admin_notes_user_created ON public.member_admin_notes (user_id, created_at DESC);

COMMENT ON TABLE public.member_suspensions IS '12번: 회원 이용 정지 이력(이용 제한·로그인 차단). 쓰기는 DEFINER 함수만, 탈퇴(익명화)하면 지운다.';
COMMENT ON TABLE public.member_admin_notes IS '12번: 회원 관리자 상담 메모. 지우기는 deleted_at 만, 가림은 대표 함수만, 탈퇴(익명화)하면 지운다.';

ALTER TABLE public.member_suspensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_admin_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.member_suspensions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.member_admin_notes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.member_suspensions TO service_role;
GRANT SELECT ON TABLE public.member_admin_notes TO service_role;

-- 2. 쓰기 막기 트리거(4-2, 두 번째 방어) ---------------------------------------------------------------------------
--   INSERT: 함수 안 거래 설정 app.member_suspension_write = 그 회원 id 일 때만.
--   UPDATE: 묶음별로 비어 있을 때(NULL→값)만 채울 수 있다 — 해제(lifted_*), 알림(notified_*·notice_summary), first_seen_at.
--   DELETE: 부모 프로필이 이미 없거나(완전 삭제의 CASCADE), app.member_withdrawal_bypass = OLD.user_id(익명화 트리거)일 때만.
CREATE FUNCTION public.guard_member_suspensions_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_member_suspensions_mutation$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(current_setting('app.member_suspension_write', true), '') IS DISTINCT FROM NEW.user_id::text THEN
      RAISE EXCEPTION 'MEMBER_SUSPENSION_DIRECT_WRITE';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id)
       OR COALESCE(current_setting('app.member_withdrawal_bypass', true), '') = OLD.user_id::text THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'MEMBER_SUSPENSION_DIRECT_WRITE';
  END IF;
  IF (NEW.id, NEW.user_id, NEW.scope, NEW.blocks_download, NEW.reason_code, NEW.reason_label, NEW.member_reason, NEW.internal_note,
      NEW.starts_at, NEW.ends_at, NEW.created_by, NEW.operation_key, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.user_id, OLD.scope, OLD.blocks_download, OLD.reason_code, OLD.reason_label, OLD.member_reason, OLD.internal_note,
      OLD.starts_at, OLD.ends_at, OLD.created_by, OLD.operation_key, OLD.created_at) THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_DIRECT_WRITE';
  END IF;
  IF (OLD.lifted_at IS NOT NULL OR NEW.lifted_at IS NULL)
     AND (NEW.lifted_at, NEW.lifted_by, NEW.lift_reason) IS DISTINCT FROM (OLD.lifted_at, OLD.lifted_by, OLD.lift_reason) THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_DIRECT_WRITE';
  END IF;
  IF (OLD.notified_at IS NOT NULL OR NEW.notified_at IS NULL)
     AND (NEW.notified_via, NEW.notified_at, NEW.notice_summary) IS DISTINCT FROM (OLD.notified_via, OLD.notified_at, OLD.notice_summary) THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_DIRECT_WRITE';
  END IF;
  IF OLD.first_seen_at IS NOT NULL AND NEW.first_seen_at IS DISTINCT FROM OLD.first_seen_at THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_DIRECT_WRITE';
  END IF;
  RETURN NEW;
END;
$fn_guard_member_suspensions_mutation$;

--   메모 UPDATE: 지우기(deleted_*) NULL→값, 가림(대표 함수가 app.member_note_redact = 그 메모 id 로 켠 거래에서 body·redacted_* 한 번)만.
CREATE FUNCTION public.guard_member_admin_notes_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_member_admin_notes_mutation$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(current_setting('app.member_suspension_write', true), '') IS DISTINCT FROM NEW.user_id::text THEN
      RAISE EXCEPTION 'MEMBER_NOTE_DIRECT_WRITE';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id)
       OR COALESCE(current_setting('app.member_withdrawal_bypass', true), '') = OLD.user_id::text THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'MEMBER_NOTE_DIRECT_WRITE';
  END IF;
  IF (NEW.id, NEW.user_id, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'MEMBER_NOTE_DIRECT_WRITE';
  END IF;
  IF (OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL)
     AND (NEW.deleted_at, NEW.deleted_by) IS DISTINCT FROM (OLD.deleted_at, OLD.deleted_by) THEN
    RAISE EXCEPTION 'MEMBER_NOTE_DIRECT_WRITE';
  END IF;
  IF (NEW.body, NEW.redacted_at, NEW.redacted_by) IS DISTINCT FROM (OLD.body, OLD.redacted_at, OLD.redacted_by)
     AND (OLD.redacted_at IS NOT NULL OR NEW.redacted_at IS NULL OR NEW.redacted_by IS NULL
          OR COALESCE(current_setting('app.member_note_redact', true), '') IS DISTINCT FROM OLD.id::text) THEN
    RAISE EXCEPTION 'MEMBER_NOTE_DIRECT_WRITE';
  END IF;
  RETURN NEW;
END;
$fn_guard_member_admin_notes_mutation$;

CREATE TRIGGER guard_member_suspensions_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_suspensions
  FOR EACH ROW EXECUTE FUNCTION public.guard_member_suspensions_mutation();
CREATE TRIGGER guard_member_admin_notes_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.member_admin_notes
  FOR EACH ROW EXECUTE FUNCTION public.guard_member_admin_notes_mutation();

-- 3. 설정 행(4-5, 9절 초안). 문구·분류는 데이터다 — 대표가 관리자 화면(6-3)에서 고친다. -------------------------------
--   reasonCategories[]: code(코드 형식)·label·clause(관련 조항)·blocksDownloadDefault(정지 창 '다운로드도 막기' 미리 체크)·
--   hidden(새 정지에서 숨김, 쓰는 중인 코드는 지우지 않고 숨김만)·underageGuide(정지 창에 adminUnderageGuide 를 보임).
--   texts.deadline*: 기한 종류 이름(안내 화면의 기한 줄, 대표 이메일 틀 ownerMailDeadlines 의 {기한 종류}) — 회원이 읽는 글이라 데이터로 둔다.
INSERT INTO public.system_settings (key, value, description, updated_at)
VALUES ('member_suspension_policy', $policy${
  "revision": 1,
  "maxRestrictedDays": 30,
  "texts": {
    "bannerRestricted": "이 계정은 이용이 제한되어 충전·구매 등 일부 기능을 쓸 수 없습니다.",
    "noticeTitle": "계정 이용 제한 안내",
    "noticeIntro": "이용약관 제9조에 따라 이 계정의 이용을 제한했습니다. 제한 내용과 사유는 아래와 같습니다.",
    "noticeBlockedList": "크레딧 충전, 자료 구매·장바구니 담기, 구매 후기 작성·추천",
    "noticeBlockedDownload": "자료 다운로드",
    "noticeAvailableList": "1:1 문의, 결제·크레딧·구매 내역 보기, 충전·자료 환불 신청(정해진 기간 안의 건), 내 후기 삭제, 선택 동의 관리, 회원 탈퇴",
    "noticeDeadlines": "충전 환불은 결제 다음 날부터 7일 안에 크레딧을 쓰지 않은 건, 자료 환불은 구매 뒤 30일 안에 받지 않은 자료만 신청할 수 있습니다. 기한이 걱정되시면 1:1 문의로 알려 주세요.",
    "noticeObjection": "제한 내용에 이의가 있으시면 1:1 문의나 화면 하단의 고객센터 연락처로 알려 주세요. 회사는 내용을 검토해 제한을 유지·변경·해제하고 결과를 알려 드립니다.",
    "noticeUntilLifted": "해제할 때까지",
    "noticeNone": "지금 이 계정에는 이용 제한이 없습니다.",
    "noticeCheckFailed": "이용 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    "apiBlocked": "이용이 제한된 계정이라 이 기능을 쓸 수 없습니다. 자세한 내용은 '계정 이용 제한 안내'에서 확인해 주세요.",
    "loginBlocked": "이 계정은 이용약관 제9조에 따라 로그인이 제한되었습니다. 이의, 충전·자료 환불, 탈퇴는 화면 하단의 고객센터 이메일·전화로 신청하실 수 있으며, 접수한 시각을 신청 시각으로 봅니다. 충전 환불(결제 다음 날부터 7일 안, 쓰지 않은 건)과 자료 환불(구매 뒤 30일 안, 받지 않은 자료)은 기간이 정해져 있으니 서둘러 연락해 주세요.",
    "deadlineChargeRefund": "충전 환불 신청 기한",
    "deadlineMaterialRefund": "자료 환불 신청 기한",
    "deadlineCreditExpiry": "유료 크레딧 소멸일",
    "ownerMailDeadlines": "고객님 계정의 가장 빠른 기한은 {기한 종류} {날짜}입니다. 이 메일에 답장하거나 고객센터로 전화하시면 접수한 시각을 신청 시각으로 보고 충전·자료 환불과 탈퇴를 처리해 드립니다.",
    "adminMemoGuide": "확인한 사실과 처리 내용만 적어 주세요. 새로 알게 된 개인정보(주민등록번호·계좌번호 등)는 적지 마세요. 회원이 열람을 요청하면 보여 줄 수 있습니다. 탈퇴하면 메모는 지워지고, 작업 기록에는 글자 수만 남습니다.",
    "adminSuspendConfirm": "정지해도 진행 중인 결제 통보와 환불은 그대로 처리됩니다. 회원에게 알릴 사유는 회원 화면에 그대로 보입니다.",
    "adminDeadlineWarning": "정지 기간이 이 회원의 환불·소멸 기한을 넘습니다. 기한 전 해제, 계약 해지와 환불, 만료 연장 가운데 하나를 정해 메모에 적어 주세요(런북 RB-12).",
    "adminUnderageGuide": "만 14세 미만 가입은 정지를 임시 조치로만 쓰고, 미성년자 결제 취소 안내와 탈퇴 처리로 바로 넘겨 주세요."
  },
  "reasonCategories": [
    {"code": "account_misuse", "label": "계정 도용·양도·공유", "clause": "제4조②", "blocksDownloadDefault": true, "hidden": false, "underageGuide": false},
    {"code": "material_sharing", "label": "구매 자료 무단 공유·게시", "clause": "제7조", "blocksDownloadDefault": true, "hidden": false, "underageGuide": false},
    {"code": "scraping", "label": "자동 수집", "clause": "제8조", "blocksDownloadDefault": true, "hidden": false, "underageGuide": false},
    {"code": "payment_abuse", "label": "결제·환불·크레딧 악용", "clause": "제8조, 환불정책 9절", "blocksDownloadDefault": false, "hidden": false, "underageGuide": false},
    {"code": "operation_interference", "label": "서비스 운영 방해", "clause": "제8조", "blocksDownloadDefault": false, "hidden": false, "underageGuide": false},
    {"code": "underage", "label": "만 14세 미만 가입 확인", "clause": "제4조①", "blocksDownloadDefault": false, "hidden": false, "underageGuide": true},
    {"code": "other", "label": "그 밖의 약관·법령 위반", "clause": "제9조", "blocksDownloadDefault": false, "hidden": false, "underageGuide": false}
  ]
}$policy$::jsonb, '12번: 회원 이용 정지 안내 문구·사유 분류·최대 정지 일수(저장은 save_member_suspension_policy 만)', now())
ON CONFLICT (key) DO NOTHING;

-- 4. 함수(4-3) ----------------------------------------------------------------------------------------------------
-- 4-0. 행위자 판정(내부): 대표면 통과. 직원은 그 권한과 members.view 를 모두 받았을 때만(admin-permissions.ts 의 requires 와 같음).
--      p_permission = 'owner' 는 대표만(로그인 차단·가림·문구 저장).
CREATE FUNCTION public.member_suspension_actor_allowed(p_actor_id uuid, p_permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_suspension_actor_allowed$
  SELECT p_actor_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.withdrawn_at IS NULL
       AND (p.admin_role = 'owner'
            OR (p.admin_role = 'staff'
                AND p_permission IN ('members.view', 'members.memo', 'members.suspend')
                AND EXISTS (SELECT 1 FROM public.admin_permission_grants g WHERE g.user_id = p.id AND g.permission = p_permission)
                AND EXISTS (SELECT 1 FROM public.admin_permission_grants g WHERE g.user_id = p.id AND g.permission = 'members.view'))))
$fn_member_suspension_actor_allowed$;

-- 4-1. 정지(이용 제한·로그인 차단). 순서: 입력 검사 → 행위자 → 프로필 FOR UPDATE → operation_key → 지난 행 닫기 → 넣기.
--      로그인 차단은 같은 거래에서 auth.users.banned_until 과 세션·토큰·진행 중 흐름을 지운다(10번 6-7 과 같음).
CREATE FUNCTION public.suspend_member(
  p_actor_id uuid,
  p_user_id uuid,
  p_scope text,
  p_blocks_download boolean,
  p_reason_code text,
  p_member_reason text,
  p_internal_note text,
  p_ends_at timestamptz,
  p_operation_key text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_suspend_member$
DECLARE
  v_now timestamptz := now();
  v_policy jsonb;
  v_category jsonb;
  v_max integer;
  v_member_reason text := btrim(replace(coalesce(p_member_reason, ''), E'\r\n', E'\n'));
  v_internal_note text := btrim(replace(coalesce(p_internal_note, ''), E'\r\n', E'\n'));
  v_blocks boolean;
  v_profile public.profiles%ROWTYPE;
  v_existing public.member_suspensions%ROWTYPE;
  v_id uuid;
BEGIN
  -- ① 입력
  IF p_actor_id IS NULL OR p_user_id IS NULL OR p_scope IS NULL OR p_scope NOT IN ('restricted', 'login_blocked')
     OR p_reason_code IS NULL OR char_length(v_member_reason) NOT BETWEEN 1 AND 500 OR char_length(v_internal_note) > 2000
     OR p_operation_key IS NULL OR char_length(p_operation_key) NOT BETWEEN 8 AND 200
     OR (p_scope = 'restricted' AND p_blocks_download IS NULL) THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_INPUT_INVALID';
  END IF;
  IF p_actor_id = p_user_id THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_TARGET_INVALID';
  END IF;
  -- ② 행위자: 이용 제한은 members.suspend, 로그인 차단은 대표만
  IF NOT public.member_suspension_actor_allowed(p_actor_id, CASE WHEN p_scope = 'login_blocked' THEN 'owner' ELSE 'members.suspend' END) THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_ACTOR_NOT_ALLOWED';
  END IF;
  -- ③ 정책: 분류(숨기지 않은 것)·최대 일수
  SELECT s.value INTO v_policy FROM public.system_settings s WHERE s.key = 'member_suspension_policy';
  IF v_policy IS NULL OR jsonb_typeof(v_policy -> 'reasonCategories') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_policy -> 'maxRestrictedDays') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_POLICY_UNAVAILABLE';
  END IF;
  v_max := CASE WHEN (v_policy ->> 'maxRestrictedDays')::numeric = trunc((v_policy ->> 'maxRestrictedDays')::numeric)
                 AND (v_policy ->> 'maxRestrictedDays')::numeric BETWEEN 1 AND 365
                THEN (v_policy ->> 'maxRestrictedDays')::numeric::integer END;
  IF v_max IS NULL THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_POLICY_UNAVAILABLE';
  END IF;
  SELECT c INTO v_category
    FROM jsonb_array_elements(v_policy -> 'reasonCategories') AS c
   WHERE c ->> 'code' = p_reason_code AND (c -> 'hidden') IS DISTINCT FROM 'true'::jsonb
   LIMIT 1;
  IF v_category IS NULL OR jsonb_typeof(v_category -> 'label') IS DISTINCT FROM 'string'
     OR char_length(v_category ->> 'label') NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_REASON_UNKNOWN';
  END IF;
  -- ④ 기간: 끝나는 날은 지금보다 뒤. 이용 제한은 필수이고 최대 일수 이하(로그인 차단은 비울 수 있음).
  IF (p_ends_at IS NOT NULL AND p_ends_at <= v_now)
     OR (p_scope = 'restricted' AND (p_ends_at IS NULL OR p_ends_at > v_now + make_interval(days => v_max))) THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_PERIOD_INVALID';
  END IF;
  v_blocks := CASE WHEN p_scope = 'login_blocked' THEN true ELSE p_blocks_download END;

  -- ⑤ 프로필 잠금(익명화와 같은 순서) 뒤 대상 확인: 가입을 마친 회원, 관리자·탈퇴 회원 아님
  SELECT * INTO v_profile FROM public.profiles p WHERE p.id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_profile.is_admin IS TRUE OR v_profile.withdrawn_at IS NOT NULL OR v_profile.signup_completed IS NOT TRUE THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_TARGET_INVALID';
  END IF;

  -- ⑥ 같은 operation_key(잠금 뒤): 같은 회원·범위면 그 행을 그대로 돌려주고, 다르면 거절
  SELECT * INTO v_existing FROM public.member_suspensions s WHERE s.operation_key = p_operation_key;
  IF FOUND THEN
    IF v_existing.user_id = p_user_id AND v_existing.scope = p_scope THEN
      RETURN jsonb_build_object('suspensionId', v_existing.id, 'scope', v_existing.scope, 'replay', true);
    END IF;
    RAISE EXCEPTION 'MEMBER_SUSPEND_INPUT_INVALID';
  END IF;

  -- ⑦ 기간이 지난 행은 먼저 닫는다(lifted_at = ends_at, 'expired')
  UPDATE public.member_suspensions s
     SET lifted_at = s.ends_at, lift_reason = 'expired'
   WHERE s.user_id = p_user_id AND s.lifted_at IS NULL AND s.ends_at IS NOT NULL AND s.ends_at <= v_now;
  IF EXISTS (SELECT 1 FROM public.member_suspensions s WHERE s.user_id = p_user_id AND s.lifted_at IS NULL) THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_ALREADY_ACTIVE';
  END IF;

  -- ⑧ 넣기
  PERFORM set_config('app.member_suspension_write', p_user_id::text, true);
  INSERT INTO public.member_suspensions (user_id, scope, blocks_download, reason_code, reason_label, member_reason, internal_note,
                                         starts_at, ends_at, created_by, operation_key)
  VALUES (p_user_id, p_scope, v_blocks, p_reason_code, v_category ->> 'label', v_member_reason, v_internal_note,
          v_now, p_ends_at, p_actor_id, p_operation_key)
  RETURNING id INTO v_id;
  PERFORM set_config('app.member_suspension_write', '', true);

  -- ⑨ 로그인 차단: 인증 계정을 같은 거래에서 막는다(재설정 링크·진행 중 카카오 흐름 포함)
  IF p_scope = 'login_blocked' THEN
    UPDATE auth.users SET banned_until = COALESCE(p_ends_at, v_now + interval '100 years') WHERE id = p_user_id;
    DELETE FROM auth.sessions WHERE user_id = p_user_id;
    DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
    DELETE FROM auth.flow_state WHERE user_id = p_user_id;
    DELETE FROM auth.one_time_tokens WHERE user_id = p_user_id;
  END IF;

  -- ⑩ 작업 기록(자유 글 없음 — 글자 수만)
  PERFORM public.record_admin_audit(p_actor_id, 'member_suspend', 'member', p_user_id::text, p_user_id, NULL, NULL,
    jsonb_build_object(
      'suspension_id', v_id,
      'scope', p_scope,
      'blocks_download', v_blocks,
      'reason_code', p_reason_code,
      'ends_at', p_ends_at,
      'member_reason_length', char_length(v_member_reason),
      'internal_note_length', char_length(v_internal_note)),
    NULL);

  RETURN jsonb_build_object('suspensionId', v_id, 'scope', p_scope, 'replay', false);
END;
$fn_suspend_member$;

-- 4-2. 해제. 잠금 순서: 프로필 FOR UPDATE → withdrawn_at 다시 확인 → 정지 행 FOR UPDATE(익명화와 교착 없음, 탈퇴 차단을 풀지 않음).
CREATE FUNCTION public.lift_member_suspension(p_actor_id uuid, p_suspension_id uuid, p_lift_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_lift_member_suspension$
DECLARE
  v_now timestamptz := now();
  v_reason text := btrim(replace(coalesce(p_lift_reason, ''), E'\r\n', E'\n'));
  v_user uuid;
  v_scope text;
  v_profile public.profiles%ROWTYPE;
  v_row public.member_suspensions%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_suspension_id IS NULL OR char_length(v_reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_INPUT_INVALID';
  END IF;
  SELECT s.user_id, s.scope INTO v_user, v_scope FROM public.member_suspensions s WHERE s.id = p_suspension_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_NOT_FOUND';
  END IF;
  IF NOT public.member_suspension_actor_allowed(p_actor_id, CASE WHEN v_scope = 'login_blocked' THEN 'owner' ELSE 'members.suspend' END) THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_ACTOR_NOT_ALLOWED';
  END IF;
  SELECT * INTO v_profile FROM public.profiles p WHERE p.id = v_user FOR UPDATE;
  IF NOT FOUND OR v_profile.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_TARGET_INVALID';
  END IF;
  SELECT * INTO v_row FROM public.member_suspensions s WHERE s.id = p_suspension_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_NOT_FOUND';
  END IF;
  IF v_row.lifted_at IS NOT NULL OR (v_row.ends_at IS NOT NULL AND v_row.ends_at <= v_now) THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_NOT_ACTIVE';
  END IF;

  UPDATE public.member_suspensions s
     SET lifted_at = v_now, lifted_by = p_actor_id, lift_reason = v_reason
   WHERE s.id = p_suspension_id;

  -- 로그인 차단 해제: 잠근 프로필이 탈퇴 회원이 아닐 때만(위에서 확인) 인증 차단을 푼다.
  IF v_row.scope = 'login_blocked' AND v_profile.withdrawn_at IS NULL THEN
    UPDATE auth.users SET banned_until = NULL WHERE id = v_user;
  END IF;

  PERFORM public.record_admin_audit(p_actor_id, 'member_suspension_lift', 'member', v_user::text, v_user, NULL, NULL,
    jsonb_build_object(
      'suspension_id', v_row.id,
      'scope', v_row.scope,
      'blocks_download', v_row.blocks_download,
      'reason_code', v_row.reason_code,
      'ends_at', v_row.ends_at,
      'lift_reason_length', char_length(v_reason)),
    NULL);

  RETURN jsonb_build_object('suspensionId', v_row.id, 'scope', v_row.scope, 'liftedAt', v_now);
END;
$fn_lift_member_suspension$;

-- 4-3. 알림 기록(수단·보낸 시각·요약). 권한은 그 정지를 할 수 있는 권한과 같다. 비어 있을 때만 채운다. 잠금 순서는 해제와 같다.
CREATE FUNCTION public.record_member_suspension_notice(p_actor_id uuid, p_suspension_id uuid, p_via text, p_sent_at timestamptz, p_summary text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_record_member_suspension_notice$
DECLARE
  v_summary text := btrim(replace(coalesce(p_summary, ''), E'\r\n', E'\n'));
  v_user uuid;
  v_scope text;
  v_profile public.profiles%ROWTYPE;
  v_row public.member_suspensions%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_suspension_id IS NULL OR p_via IS NULL OR p_via NOT IN ('screen', 'email', 'phone')
     OR p_sent_at IS NULL OR p_sent_at > now() + interval '5 minutes' OR char_length(v_summary) > 500 THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_INPUT_INVALID';
  END IF;
  SELECT s.user_id, s.scope INTO v_user, v_scope FROM public.member_suspensions s WHERE s.id = p_suspension_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_NOT_FOUND';
  END IF;
  IF NOT public.member_suspension_actor_allowed(p_actor_id, CASE WHEN v_scope = 'login_blocked' THEN 'owner' ELSE 'members.suspend' END) THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_ACTOR_NOT_ALLOWED';
  END IF;
  SELECT * INTO v_profile FROM public.profiles p WHERE p.id = v_user FOR UPDATE;
  IF NOT FOUND OR v_profile.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_TARGET_INVALID';
  END IF;
  SELECT * INTO v_row FROM public.member_suspensions s WHERE s.id = p_suspension_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_NOT_FOUND';
  END IF;
  IF v_row.notified_at IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_NOTICE_ALREADY_RECORDED';
  END IF;
  IF p_sent_at < v_row.starts_at - interval '1 day' THEN
    RAISE EXCEPTION 'MEMBER_SUSPEND_INPUT_INVALID';
  END IF;

  UPDATE public.member_suspensions s
     SET notified_via = p_via, notified_at = p_sent_at, notice_summary = NULLIF(v_summary, '')
   WHERE s.id = p_suspension_id;

  PERFORM public.record_admin_audit(p_actor_id, 'member_suspension_notice_record', 'member', v_user::text, v_user, NULL, NULL,
    jsonb_build_object(
      'suspension_id', v_row.id,
      'scope', v_row.scope,
      'notified_via', p_via,
      'notified_at', p_sent_at,
      'notice_summary_length', char_length(v_summary)),
    NULL);

  RETURN jsonb_build_object('suspensionId', v_row.id, 'notifiedVia', p_via, 'notifiedAt', p_sent_at);
END;
$fn_record_member_suspension_notice$;

-- 4-4. 안내 화면을 처음 연 시각(화면 알림의 증빙). 활성 행이 비어 있을 때만 채우고 작업 기록은 남기지 않는다.
CREATE FUNCTION public.mark_member_suspension_seen(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_mark_member_suspension_seen$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.member_suspensions s
     SET first_seen_at = now()
   WHERE s.user_id = p_user_id AND s.lifted_at IS NULL AND (s.ends_at IS NULL OR s.ends_at > now()) AND s.first_seen_at IS NULL;
  RETURN FOUND;
END;
$fn_mark_member_suspension_seen$;

-- 4-5. 메모 추가: members.memo. 대상은 회원(관리자 아님)이고 탈퇴하지 않은 사람. 프로필 FOR SHARE 로 익명화와 겹치지 않게.
CREATE FUNCTION public.add_member_admin_note(p_actor_id uuid, p_user_id uuid, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_add_member_admin_note$
DECLARE
  v_body text := btrim(replace(coalesce(p_body, ''), E'\r\n', E'\n'));
  v_profile public.profiles%ROWTYPE;
  v_id uuid;
  v_created timestamptz;
BEGIN
  IF p_actor_id IS NULL OR p_user_id IS NULL OR char_length(v_body) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'MEMBER_NOTE_INPUT_INVALID';
  END IF;
  IF NOT public.member_suspension_actor_allowed(p_actor_id, 'members.memo') THEN
    RAISE EXCEPTION 'MEMBER_NOTE_ACTOR_NOT_ALLOWED';
  END IF;
  SELECT * INTO v_profile FROM public.profiles p WHERE p.id = p_user_id FOR SHARE;
  IF NOT FOUND OR v_profile.is_admin IS TRUE OR v_profile.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_NOTE_TARGET_INVALID';
  END IF;

  PERFORM set_config('app.member_suspension_write', p_user_id::text, true);
  INSERT INTO public.member_admin_notes (user_id, body, created_by)
  VALUES (p_user_id, v_body, p_actor_id)
  RETURNING id, created_at INTO v_id, v_created;
  PERFORM set_config('app.member_suspension_write', '', true);

  PERFORM public.record_admin_audit(p_actor_id, 'member_note_add', 'member', p_user_id::text, p_user_id, NULL, NULL,
    jsonb_build_object('note_id', v_id, 'body_length', char_length(v_body)), NULL);

  RETURN jsonb_build_object('noteId', v_id, 'createdAt', v_created);
END;
$fn_add_member_admin_note$;

-- 4-6. 메모 지우기: 작성자 본인(members.memo)이나 대표만. deleted_at 만 채운다(본문은 탈퇴할 때까지 남음 — 처리방침 2·3절).
CREATE FUNCTION public.delete_member_admin_note(p_actor_id uuid, p_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_delete_member_admin_note$
DECLARE
  v_user uuid;
  v_note public.member_admin_notes%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR p_note_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOTE_INPUT_INVALID';
  END IF;
  SELECT n.user_id INTO v_user FROM public.member_admin_notes n WHERE n.id = p_note_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOTE_NOT_FOUND';
  END IF;
  PERFORM 1 FROM public.profiles p WHERE p.id = v_user FOR SHARE;
  SELECT * INTO v_note FROM public.member_admin_notes n WHERE n.id = p_note_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOTE_NOT_FOUND';
  END IF;
  IF NOT (public.member_suspension_actor_allowed(p_actor_id, 'owner')
          OR (v_note.created_by = p_actor_id AND public.member_suspension_actor_allowed(p_actor_id, 'members.memo'))) THEN
    RAISE EXCEPTION 'MEMBER_NOTE_ACTOR_NOT_ALLOWED';
  END IF;
  IF v_note.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_NOTE_ALREADY_DELETED';
  END IF;

  UPDATE public.member_admin_notes n SET deleted_at = now(), deleted_by = p_actor_id WHERE n.id = p_note_id;

  PERFORM public.record_admin_audit(p_actor_id, 'member_note_delete', 'member', v_user::text, v_user, NULL, NULL,
    jsonb_build_object('note_id', p_note_id, 'body_length', char_length(v_note.body)), NULL);

  RETURN jsonb_build_object('noteId', p_note_id, 'deleted', true);
END;
$fn_delete_member_admin_note$;

-- 4-7. 메모 가림(대표만, 2026-11-26): 적지 말아야 할 개인정보가 적힌 메모의 본문을 가림 문구로 바꾼다(지운 메모도 가릴 수 있음).
--      가림 문구 = COALESCE(NULLIF(btrim(member_withdrawal_policy.texts.redactionMask), ''), '[가림 처리됨]'). 처리방침 2·3절의 근거.
CREATE FUNCTION public.redact_member_admin_note(p_actor_id uuid, p_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_redact_member_admin_note$
DECLARE
  v_user uuid;
  v_note public.member_admin_notes%ROWTYPE;
  v_mask text;
BEGIN
  IF p_actor_id IS NULL OR p_note_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOTE_INPUT_INVALID';
  END IF;
  IF NOT public.member_suspension_actor_allowed(p_actor_id, 'owner') THEN
    RAISE EXCEPTION 'MEMBER_NOTE_ACTOR_NOT_ALLOWED';
  END IF;
  SELECT n.user_id INTO v_user FROM public.member_admin_notes n WHERE n.id = p_note_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOTE_NOT_FOUND';
  END IF;
  PERFORM 1 FROM public.profiles p WHERE p.id = v_user FOR SHARE;
  SELECT * INTO v_note FROM public.member_admin_notes n WHERE n.id = p_note_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOTE_NOT_FOUND';
  END IF;
  IF v_note.redacted_at IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_NOTE_ALREADY_REDACTED';
  END IF;
  SELECT left(COALESCE(NULLIF(btrim(s.value #>> '{texts,redactionMask}'), ''), '[가림 처리됨]'), 2000) INTO v_mask
    FROM public.system_settings s WHERE s.key = 'member_withdrawal_policy';
  v_mask := COALESCE(v_mask, '[가림 처리됨]');

  PERFORM set_config('app.member_note_redact', p_note_id::text, true);
  UPDATE public.member_admin_notes n
     SET body = v_mask, redacted_at = now(), redacted_by = p_actor_id
   WHERE n.id = p_note_id;
  PERFORM set_config('app.member_note_redact', '', true);

  PERFORM public.record_admin_audit(p_actor_id, 'member_note_redact', 'member', v_user::text, v_user, NULL, NULL,
    jsonb_build_object('note_id', p_note_id, 'body_length_before', char_length(v_note.body)), NULL);

  RETURN jsonb_build_object('noteId', p_note_id, 'redacted', true);
END;
$fn_redact_member_admin_note$;

-- 4-8. 활성 정지(서버 가드·안내 화면). 활성 = lifted_at IS NULL AND (ends_at IS NULL OR ends_at > now()). 없으면 NULL.
CREATE FUNCTION public.member_active_suspension(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_active_suspension$
  SELECT jsonb_build_object(
           'id', s.id, 'scope', s.scope, 'blocksDownload', s.blocks_download,
           'reasonCode', s.reason_code, 'reasonLabel', s.reason_label, 'memberReason', s.member_reason,
           'startsAt', s.starts_at, 'endsAt', s.ends_at, 'firstSeenAt', s.first_seen_at)
    FROM public.member_suspensions s
   WHERE s.user_id = p_user_id AND s.lifted_at IS NULL AND (s.ends_at IS NULL OR s.ends_at > now())
   LIMIT 1
$fn_member_active_suspension$;

-- 4-9. 환불·소멸 기한(읽기만, 6-2 표시용). 규칙을 새로 쓰지 않고 기존 함수 값을 쓴다:
--   paidBalance·earliestCreditExpiry = member_withdrawal_facts(유료 잔액·원천별 만료),
--   chargeRefundUntil = get_point_charge_refund_eligibility(allowed 인 충전 원천의 refundable_until 가장 빠른 것),
--   materialRefundUntil = market_refund_deadline(구매 시각, market_purchase_refund_days()) 가장 빠른 것. 대상: 완료 주문 중
--     단품(subproduct 등)은 환불 확정 0·다운로드 없음·심사 중/승인 요청 없음, 묶음(bundle)은 일부를 받았거나 일부 환불돼도 받지 않은 구성의
--     부분 환불이 같은 마감까지 되므로 그 조건 없이 넣는다(남은 구성 판정 대신 더 이른 쪽으로 근사 — 기한 표시는 보수적).
CREATE FUNCTION public.member_refund_deadlines(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_refund_deadlines$
DECLARE
  v_facts jsonb;
  v_expiry timestamptz;
  v_charge timestamptz;
  v_days integer := public.market_purchase_refund_days();
  v_material timestamptz;
BEGIN
  v_facts := public.member_withdrawal_facts(p_user_id, true);
  IF v_facts IS NULL OR (v_facts ->> 'exists') IS DISTINCT FROM 'true' THEN
    RETURN NULL;
  END IF;
  SELECT min((b.e ->> 'expires_at')::timestamptz) INTO v_expiry
    FROM jsonb_array_elements(v_facts -> 'balance' -> 'breakdown') AS b(e)
   WHERE (b.e ->> 'paid')::boolean AND (b.e ->> 'forfeited')::integer > 0;
  SELECT min((x.e ->> 'refundable_until')::timestamptz) INTO v_charge
    FROM public.credit_sources s,
         LATERAL (SELECT public.get_point_charge_refund_eligibility(p_user_id, s.id) AS e) x
   WHERE s.user_id = p_user_id AND s.source_category = 'plan_purchase' AND s.remaining_credits > 0
     AND (x.e -> 'allowed') = 'true'::jsonb;
  IF v_days IS NOT NULL THEN
    SELECT min(public.market_refund_deadline(o.created_at, v_days)) INTO v_material
      FROM public.market_purchase_orders o
     WHERE o.user_id = p_user_id AND o.status = 'completed'
       AND (o.purchase_type = 'bundle'
            OR (COALESCE(o.refund_committed_credits, 0) = 0
                AND NOT EXISTS (SELECT 1 FROM public.market_download_events d WHERE d.order_id = o.id)
                AND NOT EXISTS (SELECT 1 FROM public.market_refund_requests r WHERE r.order_id = o.id AND r.status IN ('pending', 'approved'))))
       AND public.market_refund_deadline(o.created_at, v_days) > now();
  END IF;
  RETURN jsonb_build_object(
    'paidBalance', COALESCE((v_facts -> 'balance' ->> 'forfeitPaid')::integer, 0),
    'earliestCreditExpiry', v_expiry,
    'chargeRefundUntil', v_charge,
    'materialRefundUntil', v_material);
END;
$fn_member_refund_deadlines$;

-- 4-10. 미들웨어 관문(authenticated, auth.uid() 기준): 동의 부족 목록(기존 함수 그대로)과 활성 정지의 범위를 한 번에.
CREATE FUNCTION public.get_my_member_gate()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_get_my_member_gate$
DECLARE
  v_user uuid := auth.uid();
  v_missing jsonb;
  v_restriction jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'MEMBER_GATE_AUTH_REQUIRED';
  END IF;
  SELECT COALESCE(jsonb_agg(m.id), '[]'::jsonb) INTO v_missing FROM public.get_my_missing_required_consents() AS m(id);
  SELECT jsonb_build_object('scope', s.scope, 'blocksDownload', s.blocks_download, 'endsAt', s.ends_at) INTO v_restriction
    FROM public.member_suspensions s
   WHERE s.user_id = v_user AND s.lifted_at IS NULL AND (s.ends_at IS NULL OR s.ends_at > now())
   LIMIT 1;
  RETURN jsonb_build_object('missingRequired', v_missing, 'restriction', v_restriction);
END;
$fn_get_my_member_gate$;

-- 4-11. 문구·분류·최대 일수 저장(대표만, revision 비교 — 15번 저장 함수와 같은 틀). 바뀐 것이 없으면 기록하지 않는다.
CREATE FUNCTION public.save_member_suspension_policy(p_actor_id uuid, p_expected_revision integer, p_value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_save_member_suspension_policy$
DECLARE
  c_text_keys constant text[] := ARRAY[
    'bannerRestricted', 'noticeTitle', 'noticeIntro', 'noticeBlockedList', 'noticeBlockedDownload', 'noticeAvailableList',
    'noticeDeadlines', 'noticeObjection', 'noticeUntilLifted', 'noticeNone', 'noticeCheckFailed', 'apiBlocked', 'loginBlocked',
    'deadlineChargeRefund', 'deadlineMaterialRefund', 'deadlineCreditExpiry', 'ownerMailDeadlines', 'adminMemoGuide', 'adminSuspendConfirm', 'adminDeadlineWarning', 'adminUnderageGuide'];
  v_old jsonb;
  v_old_rev integer;
  v_texts jsonb := '{}'::jsonb;
  v_categories jsonb := '[]'::jsonb;
  v_codes text[] := '{}';
  v_key text;
  v_text text;
  v_c jsonb;
  v_max integer;
  v_new jsonb;
  v_used text;
BEGIN
  IF p_actor_id IS NULL OR NOT public.member_suspension_actor_allowed(p_actor_id, 'owner') THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_ACTOR_NOT_OWNER';
  END IF;
  PERFORM 1 FROM public.profiles p WHERE p.id = p_actor_id FOR SHARE;
  SELECT s.value INTO v_old FROM public.system_settings s WHERE s.key = 'member_suspension_policy' FOR UPDATE;
  IF NOT FOUND OR v_old IS NULL THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_NOT_FOUND';
  END IF;
  v_old_rev := CASE WHEN jsonb_typeof(v_old -> 'revision') = 'number' THEN (v_old ->> 'revision')::numeric::integer END;
  IF p_expected_revision IS NULL OR v_old_rev IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_REVISION_CONFLICT';
  END IF;

  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' OR jsonb_typeof(p_value -> 'texts') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_value -> 'reasonCategories') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_value -> 'maxRestrictedDays') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_INPUT_INVALID: shape';
  END IF;
  -- 문구: 정해진 키만, 비어 있지 않은 글자 1000자 이하
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_value -> 'texts') AS k WHERE NOT (k = ANY (c_text_keys))) THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_INPUT_INVALID: texts';
  END IF;
  FOREACH v_key IN ARRAY c_text_keys LOOP
    IF jsonb_typeof(p_value -> 'texts' -> v_key) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_INPUT_INVALID: texts.%', v_key;
    END IF;
    v_text := btrim(replace(p_value -> 'texts' ->> v_key, E'\r\n', E'\n'));
    IF char_length(v_text) NOT BETWEEN 1 AND 1000 THEN
      RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_INPUT_INVALID: texts.%', v_key;
    END IF;
    v_texts := v_texts || jsonb_build_object(v_key, v_text);
  END LOOP;
  -- 분류: 1~30개, 코드 형식·중복 없음, 이름 1~60자, 조항 0~100자, blocksDownloadDefault·hidden boolean 필수, underageGuide boolean(없으면 false)
  IF jsonb_array_length(p_value -> 'reasonCategories') NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_INPUT_INVALID: reasonCategories';
  END IF;
  FOR v_c IN SELECT c FROM jsonb_array_elements(p_value -> 'reasonCategories') AS c LOOP
    IF jsonb_typeof(v_c) <> 'object'
       OR jsonb_typeof(v_c -> 'code') IS DISTINCT FROM 'string' OR (v_c ->> 'code') !~ '^[a-z][a-z0-9_]{1,39}$'
       OR (v_c ->> 'code') = ANY (v_codes)
       OR jsonb_typeof(v_c -> 'label') IS DISTINCT FROM 'string' OR char_length(btrim(v_c ->> 'label')) NOT BETWEEN 1 AND 60
       OR (v_c ? 'clause' AND jsonb_typeof(v_c -> 'clause') <> 'string')
       OR char_length(btrim(COALESCE(v_c ->> 'clause', ''))) > 100
       OR jsonb_typeof(v_c -> 'blocksDownloadDefault') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(v_c -> 'hidden') IS DISTINCT FROM 'boolean'
       OR (v_c ? 'underageGuide' AND jsonb_typeof(v_c -> 'underageGuide') <> 'boolean') THEN
      RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_INPUT_INVALID: reasonCategories';
    END IF;
    v_codes := v_codes || (v_c ->> 'code');
    v_categories := v_categories || jsonb_build_array(jsonb_build_object(
      'code', v_c ->> 'code', 'label', btrim(v_c ->> 'label'), 'clause', btrim(COALESCE(v_c ->> 'clause', '')),
      'blocksDownloadDefault', v_c -> 'blocksDownloadDefault', 'hidden', v_c -> 'hidden',
      'underageGuide', COALESCE(v_c -> 'underageGuide', 'false'::jsonb)));
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_categories) c WHERE (c -> 'hidden') = 'false'::jsonb) THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_INPUT_INVALID: reasonCategories';
  END IF;
  -- 쓰는 중인(정지 행에 남은) 코드는 지우지 않는다(숨김만)
  SELECT s.reason_code INTO v_used FROM public.member_suspensions s WHERE NOT (s.reason_code = ANY (v_codes)) LIMIT 1;
  IF v_used IS NOT NULL THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_CODE_IN_USE: %', v_used;
  END IF;
  -- 최대 일수 1~365 정수
  IF (p_value ->> 'maxRestrictedDays')::numeric <> trunc((p_value ->> 'maxRestrictedDays')::numeric)
     OR (p_value ->> 'maxRestrictedDays')::numeric NOT BETWEEN 1 AND 365 THEN
    RAISE EXCEPTION 'MEMBER_SUSPENSION_POLICY_INPUT_INVALID: maxRestrictedDays';
  END IF;
  v_max := (p_value ->> 'maxRestrictedDays')::numeric::integer;

  IF (v_old -> 'texts') = v_texts AND (v_old -> 'reasonCategories') = v_categories
     AND (v_old -> 'maxRestrictedDays') = to_jsonb(v_max) THEN
    RETURN jsonb_build_object('changed', false, 'value', v_old);
  END IF;
  v_new := jsonb_build_object('revision', v_old_rev + 1, 'maxRestrictedDays', v_max, 'texts', v_texts, 'reasonCategories', v_categories);
  UPDATE public.system_settings SET value = v_new, updated_at = now() WHERE key = 'member_suspension_policy';

  PERFORM public.record_admin_audit(p_actor_id, 'member_suspension_policy_update', 'system_settings', 'member_suspension_policy', NULL, NULL, NULL,
    jsonb_build_object('revision_before', v_old_rev, 'revision_after', v_old_rev + 1, 'before', v_old, 'after', v_new), NULL);

  RETURN jsonb_build_object('changed', true, 'value', v_new);
END;
$fn_save_member_suspension_policy$;

-- 4-12. 탈퇴와 맞물림(4-4): 익명화(6-6, app.member_withdrawal_bypass 가 켜진 거래)에서 withdrawn_at 이 NULL→값 으로 바뀔 때
--       그 회원의 member_admin_notes 와 member_suspensions 를 모두 지운다. DELETE 만 하므로 예외를 내지 않는다(쓰기 막기는 bypass 로 통과).
--       남는 것은 작업 기록의 범위·분류·기간·처리자·시각·글자 수다. 활성 로그인 차단의 banned_until 은 바로 뒤 6-7 이 100년으로 덮는다.
CREATE FUNCTION public.member_suspension_withdrawal_cleanup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_member_suspension_withdrawal_cleanup$
BEGIN
  DELETE FROM public.member_admin_notes WHERE user_id = NEW.id;
  DELETE FROM public.member_suspensions WHERE user_id = NEW.id;
  RETURN NULL;
END;
$fn_member_suspension_withdrawal_cleanup$;

-- 4-13. EXECUTE: get_my_member_gate 만 authenticated, 나머지 바깥 함수는 service_role, 내부·트리거 함수는 아무도.
REVOKE ALL ON FUNCTION public.member_suspension_actor_allowed(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_member_suspensions_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_member_admin_notes_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_suspension_withdrawal_cleanup() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.suspend_member(uuid, uuid, text, boolean, text, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.lift_member_suspension(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_member_suspension_notice(uuid, uuid, text, timestamptz, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_member_suspension_seen(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.add_member_admin_note(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_member_admin_note(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.redact_member_admin_note(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_active_suspension(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.member_refund_deadlines(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_member_gate() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_member_suspension_policy(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.suspend_member(uuid, uuid, text, boolean, text, text, text, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lift_member_suspension(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_member_suspension_notice(uuid, uuid, text, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_member_suspension_seen(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_member_admin_note(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_member_admin_note(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.redact_member_admin_note(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.member_active_suspension(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.member_refund_deadlines(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_member_suspension_policy(uuid, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_my_member_gate() TO authenticated;

-- 5. 권한 교체 함수(4-5): 20261118120000 정의 그대로, 권한 이름 목록에 members.memo·members.suspend 만 더했다. ---------------------
--    md5 는 0번 사전 점검(바탕 dcb2155f…)에서 확인했다. 새 본문 md5(prosrc) 는 VERIFY·되돌리기 머리가 대조한다.
CREATE OR REPLACE FUNCTION public.replace_admin_permission_grants(p_actor_id uuid, p_user_id uuid, p_grants jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_replace_admin_permission_grants$
DECLARE
  v_is_admin boolean;
  v_role text;
  v_email text;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_user_id IS NULL OR p_grants IS NULL OR jsonb_typeof(p_grants) <> 'array' THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_INVALID_ARGUMENT';
  END IF;
  IF p_actor_id = p_user_id THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_SELF_NOT_ALLOWED';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_grants) AS g
     WHERE jsonb_typeof(g) <> 'object'
        OR jsonb_typeof(g -> 'permission') IS DISTINCT FROM 'string'
        OR btrim(g ->> 'permission') = ''
        OR (g ? 'limits' AND jsonb_typeof(g -> 'limits') <> 'object')
  ) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_INVALID_ARGUMENT';
  END IF;
  IF (SELECT count(DISTINCT btrim(g ->> 'permission')) <> count(*) FROM jsonb_array_elements(p_grants) AS g) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_INVALID_ARGUMENT';
  END IF;
  -- 한도 값은 1 이상 2147483647 이하의 정수만(앱 ADMIN_PERMISSION_LIMIT_MAX와 같은 값). 지급 함수가 integer로 비교한다.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_grants) AS g,
           jsonb_each(COALESCE(g -> 'limits', '{}'::jsonb)) AS l(limit_key, limit_value)
     WHERE jsonb_typeof(l.limit_value) <> 'number'
        OR (l.limit_value #>> '{}')::numeric <> trunc((l.limit_value #>> '{}')::numeric)
        OR (l.limit_value #>> '{}')::numeric < 1
        OR (l.limit_value #>> '{}')::numeric > 2147483647
  ) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_INVALID_ARGUMENT';
  END IF;
  -- 코드 목록(src/lib/admin-permissions.ts ADMIN_PERMISSIONS)과 같은 이름만 받는다.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_grants) AS g
     WHERE NOT (btrim(g ->> 'permission') = ANY (ARRAY[
       'support.manage', 'content.manage', 'orders.view', 'members.view', 'credits.view',
       'credits.grant', 'credits.revoke', 'refunds.market', 'refunds.payment',
       'products.edit', 'products.delete', 'storefront.edit', 'reviews.manage',
       'pricing.manage', 'site.manage', 'reports.view', 'credits.limits.manage',
       'members.memo', 'members.suspend'
     ]::text[]))
  ) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_UNKNOWN';
  END IF;

  -- 행위자 확인은 행을 잠그며 한다(FOR SHARE): 확인한 직후 그 대표가 삭제·강등되는 틈을 막는다.
  PERFORM 1 FROM public.profiles p
   WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.admin_role = 'owner'
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_ACTOR_NOT_OWNER';
  END IF;

  -- 잠금: 권한 행 → 프로필 행. 같은 계정의 동시 저장·해제는 프로필 행에서 차례를 기다린다.
  PERFORM 1 FROM public.admin_permission_grants g WHERE g.user_id = p_user_id FOR UPDATE;
  SELECT p.is_admin, p.admin_role, p.email
    INTO v_is_admin, v_role, v_email
    FROM public.profiles p
   WHERE p.id = p_user_id
     FOR UPDATE;
  IF NOT FOUND OR v_is_admin IS NOT TRUE OR v_role IS DISTINCT FROM 'staff' THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_TARGET_NOT_STAFF';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('permission', g.permission, 'limits', g.limits) ORDER BY g.permission), '[]'::jsonb)
    INTO v_before
    FROM public.admin_permission_grants g
   WHERE g.user_id = p_user_id;

  DELETE FROM public.admin_permission_grants g WHERE g.user_id = p_user_id;

  INSERT INTO public.admin_permission_grants (user_id, permission, limits, granted_by)
  SELECT p_user_id, btrim(g ->> 'permission'), COALESCE(g -> 'limits', '{}'::jsonb), p_actor_id
    FROM jsonb_array_elements(p_grants) AS g;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('permission', g.permission, 'limits', g.limits) ORDER BY g.permission), '[]'::jsonb)
    INTO v_after
    FROM public.admin_permission_grants g
   WHERE g.user_id = p_user_id;

  PERFORM public.record_admin_audit(
    p_actor_id,
    'admin_permissions_replace',
    'admin_account',
    p_user_id::text,
    NULL,
    NULL,
    NULL,
    jsonb_build_object('target_email', v_email, 'before', v_before, 'after', v_after),
    NULL
  );

  RETURN jsonb_build_object('before', v_before, 'after', v_after);
END;
$fn_replace_admin_permission_grants$;

-- 6. 탈퇴 트리거(4-4) — profiles 에 SHARE ROW EXCLUSIVE ---------------------------------------------------------------
CREATE TRIGGER member_suspension_withdrawal_cleanup
  AFTER UPDATE OF withdrawn_at ON public.profiles
  FOR EACH ROW
  WHEN (OLD.withdrawn_at IS NULL AND NEW.withdrawn_at IS NOT NULL)
  EXECUTE FUNCTION public.member_suspension_withdrawal_cleanup();

-- 7. 쓰기 막기 정책(4-5): 화면 세션(대표 포함)이 설정 행을 직접 고치지 못한다 — system_settings 에 ACCESS EXCLUSIVE -------------
CREATE POLICY system_settings_member_suspension_policy_no_client_write
  ON public.system_settings
  AS RESTRICTIVE
  FOR UPDATE
  USING (key <> 'member_suspension_policy')
  WITH CHECK (key <> 'member_suspension_policy');
-- [12번] 끝 -----------------------------------------------------------------------------------------------------

-- 8. VERIFY(4-6) -------------------------------------------------------------------------------------------------
DO $verify_member_suspension$
DECLARE
  v_rel text;
  v_fn text;
  v_policy jsonb;
BEGIN
  -- 표·RLS(정책 0)·부분 UNIQUE·operation_key UNIQUE·쓰기 막기 트리거 2개
  FOREACH v_rel IN ARRAY ARRAY['public.member_suspensions', 'public.member_admin_notes'] LOOP
    IF to_regclass(v_rel) IS NULL OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass(v_rel))
       OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = to_regclass(v_rel)) THEN
      RAISE EXCEPTION 'VERIFY: % table / RLS / no policies', v_rel;
    END IF;
    -- service_role 은 SELECT 만, API 역할은 아무 권한 없음
    IF NOT has_table_privilege('service_role', v_rel, 'SELECT')
       OR has_table_privilege('service_role', v_rel, 'INSERT') OR has_table_privilege('service_role', v_rel, 'UPDATE')
       OR has_table_privilege('service_role', v_rel, 'DELETE') OR has_table_privilege('service_role', v_rel, 'TRUNCATE')
       OR has_table_privilege('anon', v_rel, 'SELECT') OR has_table_privilege('authenticated', v_rel, 'SELECT')
       OR has_table_privilege('anon', v_rel, 'INSERT') OR has_table_privilege('authenticated', v_rel, 'INSERT')
       OR has_table_privilege('authenticated', v_rel, 'UPDATE') OR has_table_privilege('authenticated', v_rel, 'DELETE') THEN
      RAISE EXCEPTION 'VERIFY: % privileges', v_rel;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'member_suspensions'
                  AND indexname = 'member_suspensions_one_open' AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%WHERE (lifted_at IS NULL)%')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.member_suspensions'::regclass
                     AND conname = 'member_suspensions_operation_key_key' AND contype = 'u') THEN
    RAISE EXCEPTION 'VERIFY: partial unique / operation_key unique';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
       AND ((t.tgrelid = 'public.member_suspensions'::regclass AND t.tgname = 'guard_member_suspensions_mutation')
         OR (t.tgrelid = 'public.member_admin_notes'::regclass AND t.tgname = 'guard_member_admin_notes_mutation'))) <> 2 THEN
    RAISE EXCEPTION 'VERIFY: write guard triggers';
  END IF;

  -- EXECUTE: get_my_member_gate 만 authenticated, 바깥 함수는 service_role 만, 내부·트리거 함수는 아무도
  FOREACH v_fn IN ARRAY ARRAY[
    'public.suspend_member(uuid,uuid,text,boolean,text,text,text,timestamp with time zone,text)',
    'public.lift_member_suspension(uuid,uuid,text)',
    'public.record_member_suspension_notice(uuid,uuid,text,timestamp with time zone,text)',
    'public.mark_member_suspension_seen(uuid)',
    'public.add_member_admin_note(uuid,uuid,text)',
    'public.delete_member_admin_note(uuid,uuid)',
    'public.redact_member_admin_note(uuid,uuid)',
    'public.member_active_suspension(uuid)',
    'public.member_refund_deadlines(uuid)',
    'public.save_member_suspension_policy(uuid,integer,jsonb)',
    'public.replace_admin_permission_grants(uuid,uuid,jsonb)'] LOOP
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'VERIFY: % EXECUTE must be service_role only', v_fn;
    END IF;
    IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS NOT TRUE
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND 'search_path=public, pg_temp' = ANY (p.proconfig)) THEN
      RAISE EXCEPTION 'VERIFY: % must be SECURITY DEFINER with fixed search_path', v_fn;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', 'public.get_my_member_gate()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_my_member_gate()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.get_my_member_gate()', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY: get_my_member_gate EXECUTE must be authenticated only';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY['public.member_suspension_actor_allowed(uuid,text)', 'public.guard_member_suspensions_mutation()',
                              'public.guard_member_admin_notes_mutation()', 'public.member_suspension_withdrawal_cleanup()'] LOOP
    IF has_function_privilege('service_role', v_fn, 'EXECUTE') OR has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'VERIFY: % must not be executable by API roles', v_fn;
    END IF;
  END LOOP;

  -- 권한 교체 함수: 새 본문(목록에 두 키) 그대로
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.replace_admin_permission_grants(uuid,uuid,jsonb)'::regprocedure)
     IS DISTINCT FROM 'd6cd294fb5cb60c7e17356c895bf259b' THEN
    RAISE EXCEPTION 'VERIFY: replace_admin_permission_grants body (%)',
      (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.replace_admin_permission_grants(uuid,uuid,jsonb)'::regprocedure);
  END IF;

  -- 설정 행: revision·최대 일수·분류(blocksDownloadDefault 가 boolean)·문구 키 21개
  SELECT value INTO v_policy FROM public.system_settings WHERE key = 'member_suspension_policy';
  IF v_policy IS NULL OR jsonb_typeof(v_policy -> 'revision') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_policy -> 'maxRestrictedDays') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_policy -> 'reasonCategories') IS DISTINCT FROM 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_policy -> 'reasonCategories') c
                 WHERE jsonb_typeof(c -> 'blocksDownloadDefault') IS DISTINCT FROM 'boolean')
     OR (SELECT count(*) FROM jsonb_object_keys(v_policy -> 'texts')) <> 21 THEN
    RAISE EXCEPTION 'VERIFY: member_suspension_policy row';
  END IF;
END;
$verify_member_suspension$;

-- 탈퇴 트리거 검사는 이름 붙인 별도 블록이다(리허설 light 사본은 profiles 트리거와 이 블록을 뺀다).
DO $verify_member_suspension_profiles_trigger$
BEGIN
  IF (SELECT count(*) FROM pg_trigger t JOIN pg_proc f ON f.oid = t.tgfoid
       WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal AND t.tgenabled = 'O'
         AND t.tgname = 'member_suspension_withdrawal_cleanup'
         AND f.prosrc LIKE '%member_suspensions%' AND f.prosrc LIKE '%member_admin_notes%') <> 1
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal) <> 2 THEN
    RAISE EXCEPTION 'VERIFY: profiles withdrawal trigger';
  END IF;
  -- 두 표의 FK 는 profiles(id) ON DELETE CASCADE
  IF (SELECT count(*) FROM pg_constraint c
       WHERE c.contype = 'f' AND c.confrelid = 'public.profiles'::regclass AND c.confdeltype = 'c'
         AND c.conrelid IN ('public.member_suspensions'::regclass, 'public.member_admin_notes'::regclass)) <> 2 THEN
    RAISE EXCEPTION 'VERIFY: profiles foreign keys';
  END IF;
END;
$verify_member_suspension_profiles_trigger$;

-- 정책 검사는 이름 붙인 별도 블록이다(리허설 light 사본은 CREATE POLICY 와 이 블록을 뺀다).
DO $verify_member_suspension_policy$
BEGIN
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'system_settings' AND permissive = 'RESTRICTIVE' AND cmd = 'UPDATE'
         AND policyname = 'system_settings_member_suspension_policy_no_client_write'
         AND qual = '(key <> ''member_suspension_policy''::text)' AND with_check = '(key <> ''member_suspension_policy''::text)') <> 1 THEN
    RAISE EXCEPTION 'VERIFY: member_suspension_policy RESTRICTIVE policy';
  END IF;
END;
$verify_member_suspension_policy$;

NOTIFY pgrst, 'reload schema';


-- ===== 적용 직후: 관리자 역할(거래 안에서만), 다시 적용 거절, 새 함수 지문(구현 메모용) =====
DO $rh_after_apply$
DECLARE
  v_r text;
BEGIN
  UPDATE public.profiles SET is_admin = true, admin_role = 'owner' WHERE id = pg_temp.uid('owner');
  UPDATE public.profiles SET is_admin = true, admin_role = 'staff' WHERE id = pg_temp.uid('staff');
  v_r := pg_temp.try_sql(pg_temp.ctx('src_migration'));
  PERFORM pg_temp.expect(v_r, 'ERR PRECHECK:', 'S0', '같은 파일을 다시 적용하면 사전 점검에서 멈춤');
  INSERT INTO _rh_log (test, msg, payload)
  SELECT 'S0', '적용 뒤 함수 지문(md5(pg_get_functiondef))', jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)))
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN (
     'member_suspension_actor_allowed', 'suspend_member', 'lift_member_suspension', 'record_member_suspension_notice',
     'mark_member_suspension_seen', 'add_member_admin_note', 'delete_member_admin_note', 'redact_member_admin_note',
     'member_active_suspension', 'member_refund_deadlines', 'get_my_member_gate', 'save_member_suspension_policy',
     'guard_member_suspensions_mutation', 'guard_member_admin_notes_mutation', 'member_suspension_withdrawal_cleanup',
     'replace_admin_permission_grants');
  INSERT INTO _rh_log (test, msg, payload) VALUES ('S0', 'replace_admin_permission_grants 본문 md5(prosrc)',
    to_jsonb(pg_temp.md5_src('public.replace_admin_permission_grants(uuid,uuid,jsonb)')));
END
$rh_after_apply$;

DO $rh_s1$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
BEGIN
  BEGIN

    v_r := pg_temp.suspend(v_owner, v_e, 'restricted', false, 'payment_abuse', now() + interval '7 days', 'rh12-s1-key-0001', '회원에게 알린 사유 S1', '내부 메모 S1');
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S1', '대표 이용 제한(7일, 다운로드 열림)');
    v_j := public.member_active_suspension(v_e);
    v_log := v_log || pg_temp.ensure(v_j ->> 'scope' = 'restricted' AND (v_j -> 'blocksDownload') = 'false'::jsonb
      AND v_j ->> 'reasonCode' = 'payment_abuse' AND v_j ->> 'memberReason' = '회원에게 알린 사유 S1', 'S1', '활성 값(member_active_suspension)');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('member_suspend', v_e) = 1
      AND pg_temp.audit_ok('member_suspend', '{blocks_download,ends_at,internal_note_length,member_reason_length,reason_code,scope,suspension_id}'::text[], ARRAY['회원에게 알린 사유 S1', '내부 메모 S1']),
      'S1', '작업 기록 1건(reason NULL, details 키 고정, 자유 글 없음)');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_a, 'restricted', true, 'payment_abuse', NULL), 'ERR MEMBER_SUSPEND_PERIOD_INVALID', 'S1', '이용 제한 끝나는 날 없음 거절');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_a, 'restricted', true, 'payment_abuse', now() + interval '31 days'), 'ERR MEMBER_SUSPEND_PERIOD_INVALID', 'S1', '최대 일수(30) 초과 거절');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_a, 'restricted', true, 'payment_abuse', now() - interval '1 hour'), 'ERR MEMBER_SUSPEND_PERIOD_INVALID', 'S1', '지난 날 거절');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_a, 'restricted', true, 'no_such_code', now() + interval '1 day'), 'ERR MEMBER_SUSPEND_REASON_UNKNOWN', 'S1', '없는 분류 거절');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_a, 'restricted', NULL, 'payment_abuse', now() + interval '1 day'), 'ERR MEMBER_SUSPEND_INPUT_INVALID', 'S1', '이용 제한 다운로드 선택 없음 거절');
    v_r := pg_temp.suspend(v_owner, v_a, 'restricted', true, 'material_sharing', now() + interval '30 days');
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S1', '최대 일수 그대로(30일)는 받음');
    v_log := v_log || pg_temp.ensure((public.member_active_suspension(v_a) -> 'blocksDownload') = 'true'::jsonb, 'S1', '다운로드 막기 켬 값');
    -- 환불·소멸 기한(기존 판정 함수 값, 읽기만): 결제 회원 E·결제 없는 A 모두 네 키
    FOREACH v_id IN ARRAY ARRAY[v_e, v_a] LOOP
      v_j := public.member_refund_deadlines(v_id);
      v_log := v_log || pg_temp.ensure(ARRAY(SELECT k FROM jsonb_object_keys(v_j) k ORDER BY k COLLATE "C")
        = '{chargeRefundUntil,earliestCreditExpiry,materialRefundUntil,paidBalance}'::text[], 'S1', 'member_refund_deadlines 네 키 ' || left(v_j::text, 160));
    END LOOP;
    v_log := v_log || pg_temp.ensure(public.member_refund_deadlines(gen_random_uuid()) IS NULL, 'S1', '없는 회원 → NULL');
    -- 묶음 주문은 일부 환불·다운로드가 있어도 같은 마감이 후보(부분 환불) — 단품은 같은 조건이면 빠진다
    v_r := pg_temp.try_sql(format($s$INSERT INTO public.market_purchase_orders (workspace_subject, user_id, item_id, purchase_type, idempotency_key,
        original_price_credits, charged_credits, status, refund_committed_credits, created_at)
      SELECT i.workspace_subject, %L, i.id, 'bundle', gen_random_uuid(), 100, 100, 'completed', 10, now() FROM public.market_items i ORDER BY i.created_at LIMIT 1$s$, v_a));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S1', '거래 안 묶음 주문(일부 환불 확정) 넣기');
    v_log := v_log || pg_temp.ensure((public.member_refund_deadlines(v_a) ->> 'materialRefundUntil')::timestamptz
      = public.market_refund_deadline(now(), public.market_purchase_refund_days()), 'S1', '묶음: 일부 환불돼도 자료 환불 기한 후보(보수적)');
    UPDATE public.market_purchase_orders SET purchase_type = 'subproduct' WHERE user_id = v_a AND created_at = now() AND purchase_type = 'bundle';
    v_log := v_log || pg_temp.ensure((public.member_refund_deadlines(v_a) ->> 'materialRefundUntil') IS NULL, 'S1', '단품: 일부 환불 확정이면 후보 아님');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'S1', m FROM unnest(v_log) m;
END
$rh_s1$;

DO $rh_s2$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
BEGIN
  BEGIN

    v_r := pg_temp.suspend(v_owner, v_e, 'restricted', false, 'other', now() + interval '3 days', 'rh12-s2-key-0001');
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S2', '첫 정지');
    v_id := (pg_temp.res(v_r) ->> 'suspensionId')::uuid;
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_e, 'restricted', false, 'other', now() + interval '3 days'), 'ERR MEMBER_SUSPEND_ALREADY_ACTIVE', 'S2', '다른 키로 중복 정지 거절');
    v_r := pg_temp.suspend(v_owner, v_e, 'restricted', false, 'other', now() + interval '3 days', 'rh12-s2-key-0001');
    v_log := v_log || pg_temp.ensure(v_r LIKE 'OK%' AND (pg_temp.res(v_r) ->> 'suspensionId')::uuid = v_id AND (pg_temp.res(v_r) -> 'replay') = 'true'::jsonb,
      'S2', '같은 operation_key → 첫 행 그대로(오류 아님) ' || left(v_r, 100));
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.member_suspensions WHERE user_id = v_e) = 1
      AND pg_temp.audit_count('member_suspend', v_e) = 1, 'S2', '행·작업 기록 1건 그대로');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_a, 'restricted', false, 'other', now() + interval '3 days', 'rh12-s2-key-0001'),
      'ERR MEMBER_SUSPEND_INPUT_INVALID', 'S2', '같은 키 다른 회원 거절');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_e, 'login_blocked', true, 'other', NULL, 'rh12-s2-key-0001'),
      'ERR MEMBER_SUSPEND_INPUT_INVALID', 'S2', '같은 키 다른 범위 거절');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'S2', m FROM unnest(v_log) m;
END
$rh_s2$;

DO $rh_s3$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_staff, 'restricted', false, 'other', now() + interval '1 day'), 'ERR MEMBER_SUSPEND_TARGET_INVALID', 'S3', '관리자 대상 거절');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_owner, 'restricted', false, 'other', now() + interval '1 day'), 'ERR MEMBER_SUSPEND_TARGET_INVALID', 'S3', '본인 거절');
    UPDATE public.profiles SET signup_completed = false WHERE id = v_e;
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_e, 'restricted', false, 'other', now() + interval '1 day'), 'ERR MEMBER_SUSPEND_TARGET_INVALID', 'S3', '가입 미완료 거절');
    UPDATE public.profiles SET signup_completed = true WHERE id = v_e;
    -- 탈퇴 회원(정지·메모 행이 없어 탈퇴 트리거가 지울 것도 없다)
    UPDATE public.profiles SET withdrawn_at = now() WHERE id = v_b;
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_b, 'restricted', false, 'other', now() + interval '1 day'), 'ERR MEMBER_SUSPEND_TARGET_INVALID', 'S3', '탈퇴 회원 거절');
    v_log := v_log || pg_temp.expect(pg_temp.note_add(v_owner, v_b), 'ERR MEMBER_NOTE_TARGET_INVALID', 'S3', '탈퇴 회원 메모 거절');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_e, v_a, 'restricted', false, 'other', now() + interval '1 day'), 'ERR MEMBER_SUSPEND_ACTOR_NOT_ALLOWED', 'S3', '관리자가 아닌 행위자 거절');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'S3', m FROM unnest(v_log) m;
END
$rh_s3$;

DO $rh_s4$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['members.view', 'members.suspend']), 'OK', 'S4', '대표가 직원에게 members.view+members.suspend 저장(권한 함수가 새 키 받음)');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['members.view', 'members.bogus']), 'ERR ADMIN_PERMISSION_UNKNOWN', 'S4', '모르는 키는 그대로 거절');
    v_r := pg_temp.suspend(v_staff, v_e, 'restricted', true, 'scraping', now() + interval '5 days');
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S4', '직원 이용 제한 성공');
    v_id := (pg_temp.res(v_r) ->> 'suspensionId')::uuid;
    v_log := v_log || pg_temp.expect(pg_temp.notice(v_staff, v_id, 'screen'), 'OK', 'S4', '직원 알림 기록(이용 제한)');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_ok('member_suspension_notice_record', '{notice_summary_length,notified_at,notified_via,scope,suspension_id}'::text[], ARRAY['시험 알림 요약']),
      'S4', '알림 작업 기록(요약 글 없음, 글자 수만)');
    v_log := v_log || pg_temp.expect(pg_temp.lift(v_staff, v_id), 'OK', 'S4', '직원 이용 제한 해제');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_ok('member_suspension_lift', '{blocks_download,ends_at,lift_reason_length,reason_code,scope,suspension_id}'::text[], ARRAY['시험 해제']),
      'S4', '해제 작업 기록(해제 사유 글 없음)');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_staff, v_a, 'login_blocked', true, 'account_misuse', NULL), 'ERR MEMBER_SUSPEND_ACTOR_NOT_ALLOWED', 'S4', '직원 로그인 차단 거절');
    v_r := pg_temp.suspend(v_owner, v_a, 'login_blocked', true, 'account_misuse', NULL);
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S4', '대표 로그인 차단');
    v_id := (pg_temp.res(v_r) ->> 'suspensionId')::uuid;
    v_log := v_log || pg_temp.expect(pg_temp.notice(v_staff, v_id, 'email'), 'ERR MEMBER_SUSPEND_ACTOR_NOT_ALLOWED', 'S4', '직원 로그인 차단 알림 기록 거절');
    v_log := v_log || pg_temp.expect(pg_temp.lift(v_staff, v_id), 'ERR MEMBER_SUSPEND_ACTOR_NOT_ALLOWED', 'S4', '직원 로그인 차단 해제 거절');
    -- members.view 없는 직원(권한 함수는 의존을 검사하지 않음 — DB 판정이 막는다)
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['members.suspend']), 'OK', 'S4', 'members.suspend 만 저장');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_staff, v_b, 'restricted', false, 'other', now() + interval '1 day'), 'ERR MEMBER_SUSPEND_ACTOR_NOT_ALLOWED', 'S4', 'members.view 없는 직원 거절');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['members.view']), 'OK', 'S4', 'members.view 만 저장');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_staff, v_b, 'restricted', false, 'other', now() + interval '1 day'), 'ERR MEMBER_SUSPEND_ACTOR_NOT_ALLOWED', 'S4', 'members.suspend 없는 직원 거절');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'S4', m FROM unnest(v_log) m;
END
$rh_s4$;

DO $rh_s5$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
BEGIN
  BEGIN

    -- 지울 행을 거래 안에서 먼저 만든다(시험 계정에는 원래 없을 수 있어 '0행'이 늘 참이 되지 않게). flow_state 는 만들기 어려워 0행만 본다.
    v_id := gen_random_uuid();
    INSERT INTO auth.sessions (id, user_id, created_at, updated_at) VALUES (v_id, v_e, now(), now());
    INSERT INTO auth.refresh_tokens (token, user_id, revoked, created_at, updated_at, session_id) VALUES ('rh12-' || v_id, v_e::text, false, now(), now(), v_id);
    DELETE FROM auth.one_time_tokens WHERE user_id = v_e AND token_type = 'recovery_token';
    INSERT INTO auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to, created_at, updated_at)
    VALUES (gen_random_uuid(), v_e, 'recovery_token', 'rh12-' || v_id, 'rh12@test.com', now(), now());
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM auth.sessions WHERE user_id = v_e) > 0
      AND (SELECT count(*) FROM auth.refresh_tokens WHERE user_id = v_e::text) > 0
      AND (SELECT count(*) FROM auth.one_time_tokens WHERE user_id = v_e) > 0, 'S5', '정지 전 세션·토큰·일회용 토큰 행 있음');
    v_r := pg_temp.suspend(v_owner, v_e, 'login_blocked', true, 'account_misuse', NULL);
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S5', '대표 로그인 차단(끝나는 날 없음)');
    v_id := (pg_temp.res(v_r) ->> 'suspensionId')::uuid;
    v_log := v_log || pg_temp.ensure((SELECT banned_until FROM auth.users WHERE id = v_e) >= now() + interval '99 years', 'S5', 'banned_until 100년');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM auth.sessions WHERE user_id = v_e) = 0
      AND (SELECT count(*) FROM auth.refresh_tokens WHERE user_id = v_e::text) = 0
      AND (SELECT count(*) FROM auth.flow_state WHERE user_id = v_e) = 0
      AND (SELECT count(*) FROM auth.one_time_tokens WHERE user_id = v_e) = 0, 'S5', 'sessions·refresh_tokens·flow_state·one_time_tokens 0행');
    v_log := v_log || pg_temp.ensure((SELECT blocks_download FROM public.member_suspensions WHERE id = v_id), 'S5', '로그인 차단은 다운로드도 막음(true)');
    v_log := v_log || pg_temp.expect(pg_temp.notice(v_owner, v_id, 'email'), 'OK', 'S5', '대표 알림 기록(이메일)');
    v_log := v_log || pg_temp.expect(pg_temp.notice(v_owner, v_id, 'phone'), 'ERR MEMBER_SUSPENSION_NOTICE_ALREADY_RECORDED', 'S5', '두 번째 알림 기록 거절');
    v_log := v_log || pg_temp.expect(pg_temp.lift(v_owner, v_id), 'OK', 'S5', '대표 해제');
    v_log := v_log || pg_temp.ensure((SELECT banned_until FROM auth.users WHERE id = v_e) IS NULL, 'S5', '해제 → banned_until NULL');
    v_log := v_log || pg_temp.expect(pg_temp.lift(v_owner, v_id), 'ERR MEMBER_SUSPENSION_NOT_ACTIVE', 'S5', '다시 해제 거절');
    -- 끝나는 날 있는 로그인 차단: banned_until = 그 날
    v_r := pg_temp.suspend(v_owner, v_e, 'login_blocked', false, 'scraping', now() + interval '10 days');
    v_log := v_log || pg_temp.ensure(v_r LIKE 'OK%' AND (SELECT banned_until FROM auth.users WHERE id = v_e) = now() + interval '10 days'
      AND (SELECT blocks_download FROM public.member_suspensions WHERE id = (pg_temp.res(v_r) ->> 'suspensionId')::uuid),
      'S5', '끝나는 날 있는 로그인 차단 → banned_until = 그 날, 다운로드 막음 강제');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'S5', m FROM unnest(v_log) m;
END
$rh_s5$;

DO $rh_s6$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
BEGIN
  BEGIN

    -- 지난 정지 행(거래 안의 now() 는 고정이라 지난 행은 쓰기 설정으로 직접 넣는다)
    PERFORM set_config('app.member_suspension_write', v_e::text, true);
    INSERT INTO public.member_suspensions (user_id, scope, blocks_download, reason_code, reason_label, member_reason, starts_at, ends_at, created_by, operation_key)
    VALUES (v_e, 'restricted', true, 'other', '그 밖의 약관·법령 위반', '지난 정지', now() - interval '10 days', now() - interval '1 day', v_owner, 'rh12-s6-old-0001')
    RETURNING id INTO v_id;
    PERFORM set_config('app.member_suspension_write', '', true);
    v_log := v_log || pg_temp.ensure(public.member_active_suspension(v_e) IS NULL, 'S6', '기간이 지나면 비활성');
    v_log := v_log || pg_temp.expect(pg_temp.lift(v_owner, v_id), 'ERR MEMBER_SUSPENSION_NOT_ACTIVE', 'S6', '지난 행 해제 거절');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_e, 'restricted', false, 'other', now() + interval '2 days'), 'OK', 'S6', '새 정지 받음');
    v_log := v_log || pg_temp.ensure((SELECT lifted_at = ends_at AND lift_reason = 'expired' AND lifted_by IS NULL FROM public.member_suspensions WHERE id = v_id),
      'S6', '지난 행을 expired 로 닫음(lifted_at = ends_at)');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'S6', m FROM unnest(v_log) m;
END
$rh_s6$;

DO $rh_s7$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.note_add(v_staff, v_e), 'ERR MEMBER_NOTE_ACTOR_NOT_ALLOWED', 'S7', 'members.memo 없는 직원 거절');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['members.view', 'members.memo']), 'OK', 'S7', '직원에게 members.view+members.memo');
    v_r := pg_temp.note_add(v_staff, v_e, '직원 메모 본문 S7');
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S7', '직원 메모 추가');
    v_id := (pg_temp.res(v_r) ->> 'noteId')::uuid;
    v_log := v_log || pg_temp.ensure(pg_temp.audit_ok('member_note_add', '{body_length,note_id}'::text[], ARRAY['직원 메모 본문 S7']), 'S7', '메모 작업 기록(본문 없음)');
    v_r := pg_temp.note_add(v_owner, v_e, '대표 메모 본문 S7');
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S7', '대표 메모 추가');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.delete_member_admin_note(%L, %L)', v_staff, (pg_temp.res(v_r) ->> 'noteId')::uuid)),
      'ERR MEMBER_NOTE_ACTOR_NOT_ALLOWED', 'S7', '직원이 대표 메모 지우기 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.delete_member_admin_note(%L, %L)', v_staff, v_id)), 'OK', 'S7', '작성자 지우기');
    v_log := v_log || pg_temp.ensure((SELECT deleted_at IS NOT NULL AND body = '직원 메모 본문 S7' FROM public.member_admin_notes WHERE id = v_id), 'S7', '지운 메모가 남음(deleted_at 만)');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.delete_member_admin_note(%L, %L)', v_staff, v_id)), 'ERR MEMBER_NOTE_ALREADY_DELETED', 'S7', '다시 지우기 거절');
    v_log := v_log || pg_temp.expect(pg_temp.note_add(v_owner, v_staff), 'ERR MEMBER_NOTE_TARGET_INVALID', 'S7', '관리자 대상 거절');
    -- 가림(대표만, 지운 메모도)
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.redact_member_admin_note(%L, %L)', v_staff, v_id)), 'ERR MEMBER_NOTE_ACTOR_NOT_ALLOWED', 'S7', '직원 가림 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.redact_member_admin_note(%L, %L)', v_owner, v_id)), 'OK', 'S7', '대표 가림(지운 메모)');
    v_log := v_log || pg_temp.ensure((SELECT n.body = COALESCE(NULLIF(btrim(s.value #>> '{texts,redactionMask}'), ''), '[가림 처리됨]') AND n.redacted_at IS NOT NULL AND n.redacted_by = v_owner
                                        FROM public.member_admin_notes n, public.system_settings s WHERE n.id = v_id AND s.key = 'member_withdrawal_policy'),
      'S7', '본문 → 가림 문구, redacted_at·redacted_by');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_ok('member_note_redact', '{body_length_before,note_id}'::text[], ARRAY['직원 메모 본문 S7']), 'S7', '가림 작업 기록(글자 수만)');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.redact_member_admin_note(%L, %L)', v_owner, v_id)), 'ERR MEMBER_NOTE_ALREADY_REDACTED', 'S7', '다시 가림 거절');
    -- 쓰기 막기(postgres 직접 쓰기도)
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.member_admin_notes SET body = %L WHERE id = %L', 'x', v_id)), 'ERR MEMBER_NOTE_DIRECT_WRITE', 'S7', '본문 직접 UPDATE 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.member_admin_notes SET deleted_at = NULL, deleted_by = NULL WHERE id = %L', v_id)), 'ERR MEMBER_NOTE_DIRECT_WRITE', 'S7', '지우기 되돌림 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('INSERT INTO public.member_admin_notes (user_id, body, created_by) VALUES (%L, %L, %L)', v_e, 'x', v_owner)), 'ERR MEMBER_NOTE_DIRECT_WRITE', 'S7', '직접 INSERT 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('DELETE FROM public.member_admin_notes WHERE id = %L', v_id)), 'ERR MEMBER_NOTE_DIRECT_WRITE', 'S7', '직접 DELETE 거절');
    v_r := pg_temp.suspend(v_owner, v_e, 'restricted', false, 'other', now() + interval '2 days');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.member_suspensions SET ends_at = ends_at + interval ''1 day'' WHERE id = %L', (pg_temp.res(v_r) ->> 'suspensionId')::uuid)),
      'ERR MEMBER_SUSPENSION_DIRECT_WRITE', 'S7', '정지 기간 직접 UPDATE 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('DELETE FROM public.member_suspensions WHERE id = %L', (pg_temp.res(v_r) ->> 'suspensionId')::uuid)),
      'ERR MEMBER_SUSPENSION_DIRECT_WRITE', 'S7', '정지 행 직접 DELETE 거절');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'S7', m FROM unnest(v_log) m;
END
$rh_s7$;

DO $rh_s8_full$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
BEGIN
  BEGIN

    -- self 경로: 스위치를 켠다(고지 기간 잠금이면 이 거래에서만 잠금 트리거를 끄고 켠다)
    v_r := pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{selfAnonymizeEnabled}', 'true') WHERE key = 'member_withdrawal_policy'$s$);
    IF v_r LIKE 'ERR POLICY_UPCOMING_LOCKED%' THEN
      ALTER TABLE public.system_settings DISABLE TRIGGER lock_withdrawal_texts_during_notice;
      UPDATE public.system_settings SET value = jsonb_set(value, '{selfAnonymizeEnabled}', 'true') WHERE key = 'member_withdrawal_policy';
      ALTER TABLE public.system_settings ENABLE TRIGGER lock_withdrawal_texts_during_notice;
      v_log := v_log || '고지 기간 잠금 — 이 거래에서만 잠금 트리거를 끄고 스위치를 켬'::text;
    ELSE
      v_log := v_log || pg_temp.expect(v_r, 'OK', 'S8', 'selfAnonymizeEnabled 켬(거래 안)');
    END IF;
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_b, 'restricted', true, 'other', now() + interval '5 days'), 'OK', 'S8', 'B 이용 제한');
    v_log := v_log || pg_temp.expect(pg_temp.note_add(v_owner, v_b, 'B 메모'), 'OK', 'S8', 'B 메모');
    DECLARE
      v_notice jsonb := public.get_member_withdrawal_notice(v_b, 'self', NULL);
    BEGIN
      v_r := pg_temp.try_json(format('SELECT public.anonymize_member(%L, %L, %L, NULL, %s, %L, false, NULL, %L, NULL, false)',
        v_b, v_b, 'self', (v_notice ->> 'expectedBalance')::integer, v_notice ->> 'text', 'rh12-s8-self-' || v_b));
    END;
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S8', '실제 anonymize_member(self) 성공');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.member_suspensions WHERE user_id = v_b) = 0
      AND (SELECT count(*) FROM public.member_admin_notes WHERE user_id = v_b) = 0, 'S8', 'self: 정지·메모 0행');
    v_log := v_log || pg_temp.ensure((SELECT banned_until FROM auth.users WHERE id = v_b) >= now() + interval '99 years', 'S8', 'self: banned_until 100년');
    -- owner 경로: 로그인 차단 + 메모가 있는 A, 대표가 이메일 요청을 기록한 뒤 익명화
    v_r := pg_temp.suspend(v_owner, v_a, 'login_blocked', true, 'account_misuse', NULL);
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S8', 'A 로그인 차단');
    v_id := (pg_temp.res(v_r) ->> 'suspensionId')::uuid;
    v_log := v_log || pg_temp.expect(pg_temp.note_add(v_owner, v_a, 'A 메모'), 'OK', 'S8', 'A 메모');
    DECLARE
      v_notice jsonb := public.get_member_withdrawal_notice(v_a, 'request', NULL);
      v_req jsonb;
    BEGIN
      v_req := public.create_member_withdrawal_request(v_a, 'email', v_notice ->> 'text', v_notice ->> 'sha256',
        (v_notice ->> 'expectedBalance')::integer, (v_notice ->> 'expectedForfeitPaid')::integer, (v_notice ->> 'expectedForfeitFree')::integer,
        '시험 요청', v_owner, NULL, 'self', NULL, NULL, NULL);
      v_r := pg_temp.try_json(format('SELECT public.anonymize_member(%L, %L, %L, %L, NULL, NULL, false, %L, %L, NULL, true)',
        v_owner, v_a, 'owner', (v_req ->> 'requestId')::uuid, '시험 처리', 'rh12-s8-owner-' || v_a));
    END;
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S8', '실제 anonymize_member(owner) 성공');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.member_suspensions WHERE user_id = v_a) = 0
      AND (SELECT count(*) FROM public.member_admin_notes WHERE user_id = v_a) = 0, 'S8', 'owner: 정지·메모 0행');
    v_log := v_log || pg_temp.ensure((SELECT banned_until FROM auth.users WHERE id = v_a) >= now() + interval '99 years', 'S8', 'owner: banned_until 100년(로그인 차단 해제 값이 아님)');
    v_log := v_log || pg_temp.expect(pg_temp.note_add(v_owner, v_a), 'ERR MEMBER_NOTE_TARGET_INVALID', 'S8', '익명화 뒤 메모 추가 거절');
    v_log := v_log || pg_temp.expect(pg_temp.lift(v_owner, v_id), 'ERR MEMBER_SUSPENSION_NOT_FOUND', 'S8', '익명화 뒤 로그인 차단 해제 불가(행 없음 — 탈퇴 차단을 풀지 않음)');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_a, 'login_blocked', true, 'account_misuse', NULL), 'ERR MEMBER_SUSPEND_TARGET_INVALID', 'S8', '익명화 뒤 정지 거절');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('member_suspend', v_a) = 1,
      'S8', '작업 기록 뼈대는 남음');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'S8', m FROM unnest(v_log) m;
END
$rh_s8_full$;

DO $rh_s9$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_e, 'restricted', true, 'scraping', now() + interval '4 days'), 'OK', 'S9', 'E 이용 제한');
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_e, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_j := public.get_my_member_gate();
    RESET ROLE;
    v_log := v_log || pg_temp.ensure(jsonb_typeof(v_j -> 'missingRequired') = 'array' AND v_j #>> '{restriction,scope}' = 'restricted'
      AND (v_j #> '{restriction,blocksDownload}') = 'true'::jsonb AND (v_j #>> '{restriction,endsAt}') IS NOT NULL,
      'S9', 'E 세션: 동의 부족 목록과 정지가 함께 나옴 ' || left(v_j::text, 120));
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_a, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_j := public.get_my_member_gate();
    RESET ROLE;
    v_log := v_log || pg_temp.ensure((v_j -> 'restriction') = 'null'::jsonb, 'S9', '다른 회원(A) 세션: E 의 정지는 안 보임');
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.member_active_suspension(v_e);
      v_r := 'OK';
    EXCEPTION WHEN OTHERS THEN
      v_r := 'ERR ' || SQLERRM;
    END;
    RESET ROLE;
    v_log := v_log || pg_temp.expect(v_r, 'ERR permission denied', 'S9', 'authenticated 는 member_active_suspension 실행 불가');
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.suspend_member(v_e, v_a, 'restricted', true, 'other', 'x', '', now() + interval '1 day', 'rh12-s9-key-0001');
      v_r := 'OK';
    EXCEPTION WHEN OTHERS THEN
      v_r := 'ERR ' || SQLERRM;
    END;
    RESET ROLE;
    v_log := v_log || pg_temp.expect(v_r, 'ERR permission denied', 'S9', 'authenticated 는 suspend_member 실행 불가');
    SET LOCAL ROLE anon;
    BEGIN
      PERFORM public.get_my_member_gate();
      v_r := 'OK';
    EXCEPTION WHEN OTHERS THEN
      v_r := 'ERR ' || SQLERRM;
    END;
    RESET ROLE;
    v_log := v_log || pg_temp.expect(v_r, 'ERR permission denied', 'S9', 'anon 은 get_my_member_gate 실행 불가');
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'S9', m FROM unnest(v_log) m;
END
$rh_s9$;

DO $rh_s10$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
BEGIN
  BEGIN

    v_j := (SELECT value FROM public.system_settings WHERE key = 'member_suspension_policy');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.save_member_suspension_policy(%L, %s, %L::jsonb)', v_owner, (v_j ->> 'revision')::integer,
      jsonb_set(v_j, '{texts,noticeTitle}', '"계정 이용 제한 안내(시험)"'))), 'OK {"value"', 'S10', '대표 저장(revision +1)');
    v_log := v_log || pg_temp.ensure((SELECT (value ->> 'revision')::integer FROM public.system_settings WHERE key = 'member_suspension_policy') = (v_j ->> 'revision')::integer + 1
      AND pg_temp.audit_count('member_suspension_policy_update') = 1, 'S10', 'revision 올라감·작업 기록');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.save_member_suspension_policy(%L, %s, %L::jsonb)', v_owner, (v_j ->> 'revision')::integer, v_j)),
      'ERR MEMBER_SUSPENSION_POLICY_REVISION_CONFLICT', 'S10', '옛 revision 거절');
    v_j := (SELECT value FROM public.system_settings WHERE key = 'member_suspension_policy');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.save_member_suspension_policy(%L, %s, %L::jsonb)', v_staff, (v_j ->> 'revision')::integer, v_j)),
      'ERR MEMBER_SUSPENSION_POLICY_ACTOR_NOT_OWNER', 'S10', '직원 저장 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.save_member_suspension_policy(%L, %s, %L::jsonb)', v_owner, (v_j ->> 'revision')::integer,
      jsonb_set(v_j, '{reasonCategories,0}', (v_j #> '{reasonCategories,0}') - 'blocksDownloadDefault'))), 'ERR MEMBER_SUSPENSION_POLICY_INPUT_INVALID', 'S10', 'blocksDownloadDefault 빠짐 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.save_member_suspension_policy(%L, %s, %L::jsonb)', v_owner, (v_j ->> 'revision')::integer,
      jsonb_set(v_j, '{reasonCategories,0,blocksDownloadDefault}', '"yes"'))), 'ERR MEMBER_SUSPENSION_POLICY_INPUT_INVALID', 'S10', 'blocksDownloadDefault 가 boolean 아님 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.save_member_suspension_policy(%L, %s, %L::jsonb)', v_owner, (v_j ->> 'revision')::integer,
      jsonb_set(v_j, '{maxRestrictedDays}', '366'))), 'ERR MEMBER_SUSPENSION_POLICY_INPUT_INVALID', 'S10', '최대 일수 366 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.save_member_suspension_policy(%L, %s, %L::jsonb)', v_owner, (v_j ->> 'revision')::integer,
      v_j #- '{texts,apiBlocked}')), 'ERR MEMBER_SUSPENSION_POLICY_INPUT_INVALID', 'S10', '문구 키 빠짐 거절');
    -- 쓰는 중인 코드(payment_abuse)를 지우기 → 거절, 숨김은 받음
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_e, 'restricted', false, 'payment_abuse', now() + interval '1 day'), 'OK', 'S10', '분류 payment_abuse 로 정지');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.save_member_suspension_policy(%L, %s, %L::jsonb)', v_owner, (v_j ->> 'revision')::integer,
      jsonb_set(v_j, '{reasonCategories}', (SELECT jsonb_agg(c) FROM jsonb_array_elements(v_j -> 'reasonCategories') c WHERE c ->> 'code' <> 'payment_abuse')))),
      'ERR MEMBER_SUSPENSION_POLICY_CODE_IN_USE', 'S10', '쓰는 중인 코드 지우기 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.save_member_suspension_policy(%L, %s, %L::jsonb)', v_owner, (v_j ->> 'revision')::integer,
      jsonb_set(v_j, '{reasonCategories}', (SELECT jsonb_agg(CASE WHEN c ->> 'code' = 'payment_abuse' THEN jsonb_set(c, '{hidden}', 'true') ELSE c END)
                                             FROM jsonb_array_elements(v_j -> 'reasonCategories') c)))),
      'OK', 'S10', '쓰는 중인 코드 숨김은 받음');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_a, 'restricted', false, 'payment_abuse', now() + interval '1 day'), 'ERR MEMBER_SUSPEND_REASON_UNKNOWN', 'S10', '숨긴 분류로 새 정지 거절');

    -- RESTRICTIVE: 대표 세션(authenticated) 직접 UPDATE 는 0행, postgres 는 1행
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.system_settings SET updated_at = updated_at WHERE key = 'member_suspension_policy';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RESET ROLE;
    v_log := v_log || pg_temp.ensure(v_n = 0, 'S10', '대표 세션 직접 UPDATE → 0행(RESTRICTIVE)');
    SET LOCAL ROLE authenticated;
    UPDATE public.system_settings SET updated_at = updated_at WHERE key = 'site_brand';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RESET ROLE;
    v_log := v_log || pg_temp.ensure(v_n = 1, 'S10', '대조: 대표 세션 site_brand UPDATE 1행');
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'S10', m FROM unnest(v_log) m;
END
$rh_s10$;

DO $rh_s11$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
BEGIN
  BEGIN

    v_r := pg_temp.suspend(v_owner, v_e, 'restricted', false, 'other', now() + interval '1 day');
    v_id := (pg_temp.res(v_r) ->> 'suspensionId')::uuid;
    SET LOCAL ROLE service_role;
    BEGIN
      INSERT INTO public.member_admin_notes (user_id, body, created_by) VALUES (v_e, 'x', v_owner);
      v_r := 'OK';
    EXCEPTION WHEN OTHERS THEN
      v_r := 'ERR ' || SQLERRM || ' [' || SQLSTATE || ']';
    END;
    RESET ROLE;
    v_log := v_log || pg_temp.expect(v_r, 'ERR permission denied', 'S11', 'service_role 메모 INSERT 권한 오류');
    SET LOCAL ROLE service_role;
    BEGIN
      UPDATE public.member_suspensions SET first_seen_at = now() WHERE id = v_id;
      v_r := 'OK';
    EXCEPTION WHEN OTHERS THEN
      v_r := 'ERR ' || SQLERRM || ' [' || SQLSTATE || ']';
    END;
    RESET ROLE;
    v_log := v_log || pg_temp.expect(v_r, 'ERR permission denied', 'S11', 'service_role 정지 UPDATE 권한 오류');
    SET LOCAL ROLE service_role;
    BEGIN
      DELETE FROM public.member_suspensions WHERE id = v_id;
      v_r := 'OK';
    EXCEPTION WHEN OTHERS THEN
      v_r := 'ERR ' || SQLERRM || ' [' || SQLSTATE || ']';
    END;
    RESET ROLE;
    v_log := v_log || pg_temp.expect(v_r, 'ERR permission denied', 'S11', 'service_role 정지 DELETE 권한 오류');
    SET LOCAL ROLE service_role;
    BEGIN
      SELECT count(*) INTO v_n FROM public.member_suspensions WHERE id = v_id;
      v_r := 'OK ' || v_n;
    EXCEPTION WHEN OTHERS THEN
      v_r := 'ERR ' || SQLERRM;
    END;
    RESET ROLE;
    v_log := v_log || pg_temp.expect(v_r, 'OK 1', 'S11', 'service_role SELECT 는 됨(RLS 정책 0이어도 BYPASSRLS)');
    -- 서비스 키 경로: 함수로는 됨(mark_member_suspension_seen)
    SET LOCAL ROLE service_role;
    BEGIN
      v_r := 'OK ' || public.mark_member_suspension_seen(v_e)::text;
    EXCEPTION WHEN OTHERS THEN
      v_r := 'ERR ' || SQLERRM;
    END;
    RESET ROLE;
    v_log := v_log || pg_temp.expect(v_r, 'OK true', 'S11', 'service_role mark_member_suspension_seen(처음 연 시각) 채움');
    v_log := v_log || pg_temp.ensure(public.mark_member_suspension_seen(v_e) IS FALSE
      AND (SELECT first_seen_at IS NOT NULL FROM public.member_suspensions WHERE id = v_id), 'S11', '두 번째는 그대로(false)');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'S11', m FROM unnest(v_log) m;
END
$rh_s11$;

DO $rh_s12$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_a, 'restricted', true, 'other', now() + interval '3 days'), 'OK', 'S12', 'A 이용 제한');
    v_log := v_log || pg_temp.expect(pg_temp.note_add(v_owner, v_a), 'OK', 'S12', 'A 메모');
    DELETE FROM public.exam_papers WHERE user_id = v_a;
    DELETE FROM public.questions WHERE user_id = v_a;
    DELETE FROM public.support_tickets WHERE user_id = v_a;
    DELETE FROM public.credit_transactions WHERE user_id = v_a;
    DELETE FROM public.ai_question_generation_runs WHERE user_id = v_a;
    SET LOCAL ROLE service_role;
    BEGIN
      DELETE FROM public.profiles WHERE id = v_a;
      v_r := 'OK';
    EXCEPTION WHEN OTHERS THEN
      v_r := 'ERR ' || SQLERRM || ' [' || SQLSTATE || ']';
    END;
    RESET ROLE;
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S12', 'service_role 프로필 삭제(fullDeleteMember 와 같은 길)');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.member_suspensions WHERE user_id = v_a) = 0
      AND (SELECT count(*) FROM public.member_admin_notes WHERE user_id = v_a) = 0, 'S12', 'CASCADE 로 정지·메모 0행');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'S12', m FROM unnest(v_log) m;
END
$rh_s12$;

DO $rh_s13$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
BEGIN
  BEGIN

    v_r := pg_temp.suspend(v_owner, v_e, 'restricted', false, 'other', now() + interval '1 day');
    v_id := (pg_temp.res(v_r) ->> 'suspensionId')::uuid;
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: active suspensions', 'S13', '활성 정지 있으면 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.lift(v_owner, v_id), 'OK', 'S13', '해제');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['members.view', 'members.memo']), 'OK', 'S13', '권한 행 만들기');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: members.memo', 'S13', '새 권한 행 있으면 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['members.view']), 'OK', 'S13', '권한 회수');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: suspension history exists', 'S13', '이력 있으면 내보내기 확인 전 멈춤');
    INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261215100000', 'rh12_bundle13_marker', ARRAY[]::text[]);
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: bundle 13 is applied', 'S13', '13번 version 있으면 멈춤');
    DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261215100000' AND name = 'rh12_bundle13_marker';
    -- 내보내기 확인 상수만 바꾼 사본으로 되돌리기 → 남은 것 0 → 다시 적용
    v_r := pg_temp.try_sql(pg_temp.subst_once(pg_temp.subst_once(pg_temp.ctx('src_down'),
      '  c_suspensions_export_confirmed constant boolean := false;', '  c_suspensions_export_confirmed constant boolean := true;'),
      '  c_notes_export_confirmed constant boolean := false;', '  c_notes_export_confirmed constant boolean := true;'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S13', '되돌리기(내보내기 확인 뒤)');
    v_log := v_log || pg_temp.ensure(to_regclass('public.member_suspensions') IS NULL AND to_regclass('public.member_admin_notes') IS NULL
      AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('suspend_member', 'get_my_member_gate', 'redact_member_admin_note'))
      AND NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'member_suspension_policy')
      AND pg_temp.md5_src('public.replace_admin_permission_grants(uuid,uuid,jsonb)') = '54540b6b0286f81f243575f1c03a568c'
      AND pg_temp.md5_def('public.replace_admin_permission_grants(uuid,uuid,jsonb)') = 'dcb2155fae26443c98231627d102a821',
      'S13', '남은 객체 0, 권한 함수는 20261118120000 정의');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['members.memo']), 'ERR ADMIN_PERMISSION_UNKNOWN', 'S13', '되돌린 뒤 새 키는 다시 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'S13', '다시 적용');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_e, 'restricted', false, 'other', now() + interval '1 day'), 'OK', 'S13', '다시 적용 뒤 정지');
    -- 권한 함수가 뒤 묶음에서 다시 정의됐으면 down 은 멈춘다(덮어쓰지 않음)
    EXECUTE replace(pg_get_functiondef('public.replace_admin_permission_grants(uuid,uuid,jsonb)'::regprocedure), '-- 코드 목록', '-- rh12 바뀐 정의: 코드 목록');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: replace_admin_permission_grants is not the bundle 12 definition', 'S13', '권한 함수 md5 다르면 멈춤');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'S13', m FROM unnest(v_log) m;
END
$rh_s13$;

SELECT n, test, msg, payload FROM _rh_log ORDER BY n;
ROLLBACK;
