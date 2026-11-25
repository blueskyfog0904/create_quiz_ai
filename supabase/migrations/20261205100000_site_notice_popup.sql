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
