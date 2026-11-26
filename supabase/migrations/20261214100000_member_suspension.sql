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
