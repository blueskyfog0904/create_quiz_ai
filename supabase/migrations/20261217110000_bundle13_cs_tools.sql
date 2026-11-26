-- 출시 전 작업 순서표 13번 묶음 M1: CS 도구 추가분(계획 docs/plan-bundle13-cs-tools.md 3판, 4-2~4-4).
-- 만드는 것:
--   1. support_tickets.response_edited_at(기본값 없는 칸 — 짧은 ACCESS EXCLUSIVE).
--   2. 표 support_ticket_answer_revisions(답변 이력, 추가 전용): 그때 회원이 보던 글·보이기 시작한 시각·고친 사람·사유. RLS 켬·정책 0,
--      service_role 은 SELECT 만(쓰기는 save_support_ticket_answer 만). 가드: UPDATE·DELETE·TRUNCATE 거부 — 부모 문의 연쇄 삭제와
--      가림 함수(app.member_withdrawal_bypass = 그 회원 id)의 previous_response·reason·redaction_reviewed_at UPDATE 만 예외.
--   3. 표 support_reply_templates(답변 템플릿): RLS SELECT 정책 has_admin_permission('support.manage'), 쓰기 정책 없음(서버 키만).
--      비어 있을 때만 런북 12절 14개를 넣는다(10-2).
--   4. 설정 행 system_settings.support_page_content(회원 화면 문구 10-1·관리자 값, revision 1 — 있으면 그대로).
--   5. slug 지키기 트리거 guard_support_category_slug(문의가 있거나 탈퇴 가림 정책 slug 이면 slug 변경 거부).
--   6. 답변 저장 함수 save_support_ticket_answer(service_role 만, 4-3).
--   7. 10번 함수 재정의 4개(4-4): member_withdrawal_facts·redact_member_text·mark_member_text_reviewed·read_withdrawn_member_ticket.
--      운영 원문(pg_get_functiondef)에서 바뀐 곳만 '-- [13번]' 표시로 고쳤다. anonymize_member 는 고치지 않고 지문만 본다.
-- 작업 기록(admin_audit_log)에는 답변 글·수정 사유 원문을 넣지 않는다(가릴 수 없는 표) — 글자 수와 이력 id 만.
-- 함수 지문은 md5(pg_get_functiondef(oid))(2026-11-26 운영 읽기 전용 값, 1-3). 다르면 멈춘다.
-- 잠금: support_tickets 에 칸 추가(ACCESS EXCLUSIVE)·FK(SHARE ROW EXCLUSIVE), support_ticket_categories 에 FK·트리거(SHARE ROW EXCLUSIVE).
--   새벽 짧은 창에서 적용하고, 잡지 못하면(lock_timeout 3초) 전체가 취소된다.
-- 옛 코드와 함께 돌아간다(추가만 함 — 옛 답변 route 의 세션 UPDATE 도 M2 전까지 허용).
-- 되돌리기: supabase/rollback/20261217110000_bundle13_cs_tools_down.sql(M3·M2 를 먼저 되돌린 뒤).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 0. 사전 점검(4-2) -----------------------------------------------------------------------------------------------
DO $precheck_bundle13_cs_tools$
DECLARE
  -- 재정의할 4개(10번 원문)와 그대로여야 하는 anonymize_member
  v_same text[][] := ARRAY[
    ARRAY['public.member_withdrawal_facts(uuid,boolean)', 'a7674770964dac2fe5c9179b8403c3b4'],
    ARRAY['public.redact_member_text(uuid,text,uuid,text,text,text)', '90778a74269a727608f028b21b43b8f6'],
    ARRAY['public.mark_member_text_reviewed(uuid,text,uuid)', 'b626dc43a8bb8402575f99a58bb5969b'],
    ARRAY['public.read_withdrawn_member_ticket(uuid,uuid,text,jsonb)', 'cce39fd0ab514d2c9cdd9e42d225688e'],
    ARRAY['public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)', '1346d870d3623abae580a011b0484339'],
    ARRAY['public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)', 'a42b474d9d95753ffba5041acb0c1c77'],
    ARRAY['public.guard_withdrawn_member_write()', '764d47be26a0254ba61c71bbd005ee9b']
  ];
  i integer;
BEGIN
  FOR i IN 1 .. array_length(v_same, 1) LOOP
    IF to_regprocedure(v_same[i][1]) IS NULL OR md5(pg_get_functiondef(to_regprocedure(v_same[i][1]))) <> v_same[i][2] THEN
      RAISE EXCEPTION 'PRECHECK: % changed (%)', v_same[i][1],
        CASE WHEN to_regprocedure(v_same[i][1]) IS NULL THEN 'missing' ELSE md5(pg_get_functiondef(to_regprocedure(v_same[i][1]))) END;
    END IF;
  END LOOP;
  IF to_regclass('public.support_ticket_answer_revisions') IS NOT NULL OR to_regclass('public.support_reply_templates') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECHECK: bundle 13 tables already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('save_support_ticket_answer', 'guard_support_ticket_answer_revisions_mutation', 'guard_support_category_slug')) THEN
    RAISE EXCEPTION 'PRECHECK: bundle 13 functions already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'support_tickets' AND column_name = 'response_edited_at') THEN
    RAISE EXCEPTION 'PRECHECK: support_tickets.response_edited_at already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'support_page_content') THEN
    RAISE EXCEPTION 'PRECHECK: support_page_content row already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.support_ticket_categories'::regclass AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'PRECHECK: support_ticket_categories triggers changed';
  END IF;
  IF to_regclass('public.admin_member_access_log') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK: M0 (20261217100000) is not applied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'member_withdrawal_policy') THEN
    RAISE EXCEPTION 'PRECHECK: member_withdrawal_policy missing';
  END IF;
END;
$precheck_bundle13_cs_tools$;

-- [13번 M1] 시작 ------------------------------------------------------------------------------------------------
-- 1. 답변 수정 시각 칸(4-2 의 1) --------------------------------------------------------------------------------------
ALTER TABLE public.support_tickets ADD COLUMN response_edited_at timestamptz;

-- 2. 답변 이력(4-2 의 2) -------------------------------------------------------------------------------------------
--    edited_by 는 FK 없는 uuid(관리자 계정을 지워도 이력이 남음).
CREATE TABLE public.support_ticket_answer_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  previous_response text NOT NULL,
  previous_shown_at timestamptz NOT NULL,
  edited_by uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  redaction_reviewed_at timestamptz
);
CREATE INDEX support_ticket_answer_revisions_ticket ON public.support_ticket_answer_revisions (ticket_id, created_at);

COMMENT ON TABLE public.support_ticket_answer_revisions IS
  '13번: 문의 답변 수정 이력(그때 회원이 보던 글). 쓰기는 save_support_ticket_answer 만, 탈퇴 가림 대상(support_ticket_answer_revision).';

ALTER TABLE public.support_ticket_answer_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.support_ticket_answer_revisions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.support_ticket_answer_revisions TO service_role;

--    DELETE: 부모 문의가 이미 없으면(연쇄 삭제) 통과. UPDATE: 가림 함수 거래(bypass = 부모 문의의 회원)에서 가릴 칸만.
CREATE FUNCTION public.guard_support_ticket_answer_revisions_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_support_ticket_answer_revisions_mutation$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = OLD.ticket_id) THEN
      RAISE EXCEPTION 'SUPPORT_ANSWER_REVISIONS_APPEND_ONLY';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
     AND COALESCE(current_setting('app.member_withdrawal_bypass', true), '') <> ''
     AND current_setting('app.member_withdrawal_bypass', true)
         = (SELECT t.user_id::text FROM public.support_tickets t WHERE t.id = OLD.ticket_id)
     AND (NEW.id, NEW.ticket_id, NEW.previous_shown_at, NEW.edited_by, NEW.created_at)
         IS NOT DISTINCT FROM (OLD.id, OLD.ticket_id, OLD.previous_shown_at, OLD.edited_by, OLD.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'SUPPORT_ANSWER_REVISIONS_APPEND_ONLY';
END;
$fn_guard_support_ticket_answer_revisions_mutation$;

CREATE TRIGGER guard_support_ticket_answer_revisions_mutation
  BEFORE UPDATE OR DELETE ON public.support_ticket_answer_revisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_support_ticket_answer_revisions_mutation();
CREATE TRIGGER guard_support_ticket_answer_revisions_truncate
  BEFORE TRUNCATE ON public.support_ticket_answer_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_support_ticket_answer_revisions_mutation();
REVOKE ALL ON FUNCTION public.guard_support_ticket_answer_revisions_mutation() FROM PUBLIC, anon, authenticated, service_role;

-- 3. 답변 템플릿(4-2 의 3, 6절) ---------------------------------------------------------------------------------------
CREATE TABLE public.support_reply_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60 AND btrim(title) <> ''),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000 AND btrim(body) <> ''),
  category_id uuid REFERENCES public.support_ticket_categories(id),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1)
);
CREATE INDEX support_reply_templates_sort ON public.support_reply_templates (sort_order, created_at);

COMMENT ON TABLE public.support_reply_templates IS
  '13번: 문의 답변 템플릿(○○ 빈칸·{사이트이름}·{문의제목}·{접수일}). 쓰기는 서버 키(관리자 고객지원 화면 서버 액션)만.';

ALTER TABLE public.support_reply_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.support_reply_templates FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.support_reply_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.support_reply_templates TO service_role;
CREATE POLICY support_reply_templates_admin_select ON public.support_reply_templates
  FOR SELECT TO authenticated
  USING ((SELECT public.has_admin_permission('support.manage')));

--    첫 값: 런북 12절 중 1:1 답변용 12-2~12-7·12-10(14개). '써머썬 연구소' → {사이트이름}, 한 글자 빈칸 '○' 도 '○○' 로 맞춤(빈칸 검사),
--    12-5 의 '구매 후 7일' → 30일(8번 이후 기준). category_id 는 칸이 하나라 두 카테고리(market_refund·credit_refund)에 함께 쓰는 글은 비운다
--    (모든 문의에서 보임). 회원 화면 문구처럼 데이터다 — 대표·직원이 '답변 템플릿' 탭에서 고친다.
INSERT INTO public.support_reply_templates (title, body, category_id, sort_order)
SELECT s.title, s.body, (SELECT c.id FROM public.support_ticket_categories c WHERE c.slug = s.slug), s.sort_order
  FROM (VALUES
    ('크레딧 미반영 — 접수', E'안녕하세요, {사이트이름}입니다.\n결제 후 크레딧이 반영되지 않아 불편을 드려 죄송합니다. 결제 내역을 확인하고 있으며, 확인되는 대로 크레딧을 지급해 드리겠습니다.\n빠른 확인을 위해 결제하신 일시와 금액, 결제수단을 알려 주시면 감사하겠습니다.', 'credit_error', 10),
    ('크레딧 미반영 — 처리 완료', E'결제가 확인되어 ○○ 크레딧을 지급해 드렸습니다. 마이페이지의 크레딧 내역에서 확인하실 수 있습니다. 기다려 주셔서 감사합니다.', 'credit_error', 20),
    ('크레딧 미반영 — 결제 확인 안 됨', E'확인 결과 해당 일시에 완료된 결제 내역이 없습니다. 카드사나 결제 앱에서 결제가 승인되었는지 한 번 더 확인해 주시고, 승인 내역이 있다면 승인 일시와 금액을 알려 주시면 다시 확인하겠습니다.', 'credit_error', 30),
    ('환불 접수', E'안녕하세요, {사이트이름}입니다.\n환불 요청이 접수되었습니다. 확인 후 영업일 기준 ○○일 이내에 처리해 드리겠습니다. 처리되는 동안 해당 크레딧은 사용하실 수 없습니다.', NULL, 40),
    ('환불 접수 — 계좌 송금 안내', E'고객님의 결제는 결제 수단의 사정(휴대폰 결제의 경우 결제하신 달이 지난 경우 등)으로 결제 취소가 되지 않아, 계좌로 환불해 드리고자 합니다.\n환불받으실 은행명, 계좌번호, 예금주(결제하신 본인 명의)를 알려 주시면 확인 후 송금해 드리겠습니다.', 'credit_refund', 50),
    ('환불 완료 — 결제 취소', E'○○원 결제 취소가 완료되었습니다. 카드사·결제수단에 따라 실제 반영까지 며칠이 걸릴 수 있습니다. 해당 크레딧은 회수되었습니다.', 'credit_refund', 60),
    ('환불 완료 — 계좌 송금', E'○○월 ○○일 알려 주신 계좌로 ○○원을 송금해 드렸습니다. 해당 크레딧은 회수되었습니다. 확인 부탁드립니다.', 'credit_refund', 70),
    ('환불 완료 — 자료 문제로 크레딧 환불', E'구매하신 「○○」 자료의 문제를 확인했습니다. 불편을 드려 죄송합니다. 사용하신 ○○ 크레딧을 돌려 드렸으며, 마이페이지의 크레딧 내역에서 확인하실 수 있습니다.', 'market_refund', 80),
    ('환불 거절', E'안녕하세요, {사이트이름}입니다.\n요청하신 환불은 아래 사유로 처리해 드리기 어렵습니다.\n- 사유: ○○ (예: 충전하신 크레딧 중 일부를 이미 사용하셨습니다 / 구매 후 30일이 지났습니다 / 자료를 이미 내려받으셨습니다)\n자세한 기준은 사이트의 취소/환불정책에서 확인하실 수 있습니다. 양해 부탁드립니다.', NULL, 90),
    ('잘못 지급한 크레딧 회수 — 안내', E'안녕하세요, {사이트이름}입니다.\n○○월 ○○일 고객님 계정에 ○○ 크레딧이 지급되었는데, 이는 저희의 처리 실수로 잘못 지급된 것입니다. 혼란을 드려 죄송합니다.\n해당 크레딧은 며칠 안에 회수될 예정이오니, 그때까지 사용하지 말아 주시기를 부탁드립니다. 회수가 끝나면 다시 안내해 드리겠습니다.\n고객님께서 직접 충전하신 크레딧에는 영향이 없습니다.', NULL, 100),
    ('잘못 지급한 크레딧 회수 — 완료', E'잘못 지급되었던 ○○ 크레딧의 회수를 마쳤습니다. 현재 잔액은 ○○ 크레딧입니다. 불편을 드려 다시 한번 죄송합니다.', NULL, 110),
    ('영수증 안내', E'안녕하세요, {사이트이름}입니다.\n요청하신 ○○월 ○○일 ○○원 결제 건의 영수증(매출전표)을 보내 드립니다. (첨부 / 아래 주소에서 확인하실 수 있습니다.)\n다른 형태의 증빙이 필요하시면 말씀해 주세요.', NULL, 120),
    ('비밀번호 분실 — 카카오 가입', E'고객님은 카카오 계정으로 가입하셨습니다. 로그인 화면에서 "카카오로 시작하기"를 눌러 로그인해 주세요. 별도의 비밀번호는 없습니다.', 'account', 130),
    ('비밀번호 분실 — 이메일 가입', E'안녕하세요, {사이트이름}입니다.\n죄송하게도 현재 비밀번호 재설정 기능을 준비하고 있어, 고객님 계정은 저희가 직접 확인해 도와 드려야 합니다. 본인 확인을 위해 가입하신 이메일 주소로 이 안내에 답장해 주시면, 확인 후 처리 방법을 안내해 드리겠습니다.', 'account', 140)
  ) AS s(title, body, slug, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM public.support_reply_templates);

-- 4. 설정 행(4-2 의 4, 10-1) — 문구는 초안이다. 대표가 관리자 고객지원 화면 '안내 문구' 탭에서 고친다. -----------------------------
--    member: 회원 화면 문구(필수 키가 비면 저장 거부, 선택 키가 비면 그 칸을 숨김). 자리표시는 알림 문구의 {문의제목} 하나.
--    admin: templateBlankMarker(관리자 화면에서 고치지 않음 — 템플릿과 함께 스크립트로), answerEditReasonGuide, notifyOnAnswerEdit,
--           accessLogRetentionYears(2 — 01-11 시행 처리방침 3절 '기록한 날부터 2년'과 같아야 함, 관리자 화면에서 고치지 않음).
INSERT INTO public.system_settings (key, value, description)
VALUES ('support_page_content', $json_support_page_content$
{
  "revision": 1,
  "member": {
    "pageTitle": "고객지원",
    "pageDescription": "1:1 문의를 남기고 답변을 확인합니다.",
    "formTitle": "1:1 문의하기",
    "formNotice": "답변은 이메일로 보내지 않습니다. 화면 위쪽 알림(종 모양)과 아래 문의 내역에서 확인해 주세요.",
    "responseTimeNote": "",
    "defaultCategoryHelp": "선택한 문의 유형에 맞춰 내용을 적어 주세요.",
    "historyTitle": "문의 내역",
    "historyIntro": "남겨 주신 문의와 답변을 확인하실 수 있습니다.",
    "emptyTitle": "아직 문의하신 내역이 없습니다",
    "emptyDescription": "궁금한 점이 있으시면 언제든지 문의해 주세요.",
    "categoryLabel": "문의 카테고리",
    "categoryPlaceholder": "문의 유형을 선택해 주세요",
    "subjectLabel": "제목",
    "messageLabel": "내용",
    "defaultSubjectPlaceholder": "문의 제목을 입력해 주세요",
    "defaultMessagePlaceholder": "문의 내용을 자세히 적어 주세요",
    "submitLabel": "문의 등록하기",
    "submittingLabel": "접수 중…",
    "uncategorizedLabel": "미분류",
    "editCategoryLabel": "문의 카테고리 수정",
    "editSubjectLabel": "제목 수정",
    "editMessageLabel": "내용 수정",
    "editSubjectPlaceholder": "제목을 입력하세요",
    "editMessagePlaceholder": "내용을 입력하세요",
    "cancelLabel": "취소",
    "saveEditLabel": "수정 완료",
    "editIconTitle": "문의 수정",
    "deleteIconTitle": "문의 내역 삭제",
    "needCategoryToast": "문의 카테고리를 선택해 주세요.",
    "needContentToast": "제목과 내용을 모두 입력해 주세요.",
    "deletedToast": "문의 내역이 삭제되었습니다.",
    "updatedToast": "문의 내용이 수정되었습니다.",
    "submittedTitle": "문의가 등록되었습니다",
    "submittedDescription": "빠른 시일 내에 답변드리겠습니다. 답변은 이메일로 보내지 않으니, 화면 위쪽 알림(종 모양)과 아래 문의 내역에서 확인해 주세요.",
    "deleteConfirmTitle": "문의 내역을 삭제할까요?",
    "deleteConfirmDescription": "삭제하면 내 문의 내역에서 사라지고 되돌릴 수 없습니다. 처리에 필요한 기록은 개인정보 처리방침에 따라 보관될 수 있습니다.",
    "deleteConfirmLabel": "삭제",
    "submitFailedToast": "문의 등록에 실패했습니다.",
    "updateFailedToast": "수정에 실패했습니다.",
    "deleteFailedToast": "삭제에 실패했습니다.",
    "answerLabel": "관리자 답변",
    "answerEditedLabel": "수정됨",
    "answerCreatedNotificationTitle": "문의하신 내용에 답변이 등록되었습니다.",
    "answerCreatedNotificationMessage": "제목: {문의제목}\n\n답변을 확인해보세요.",
    "answerEditedNotificationTitle": "문의 답변이 수정되었습니다.",
    "answerEditedNotificationMessage": "제목: {문의제목}\n\n수정된 답변을 확인해 보세요."
  },
  "admin": {
    "templateBlankMarker": "○○",
    "answerEditReasonGuide": "회원에게 보이지 않는 내부 기록입니다. 왜 고쳤는지 짧게 적어 주세요. 계좌·전화 같은 개인정보는 적지 마세요.",
    "notifyOnAnswerEdit": true,
    "accessLogRetentionYears": 2
  }
}
$json_support_page_content$::jsonb, '고객지원 회원 화면 문구·답변 설정(13번, 관리자 고객지원 화면 안내 문구 탭에서 수정)')
ON CONFLICT (key) DO NOTHING;

-- 5. 카테고리 slug 지키기(4-2 의 5, Q11) — slug 가 바뀔 때만 본다. SECURITY DEFINER 라 직원 세션의 RLS 와 상관없이 센다. -------------
--    문의(회원 삭제·탈퇴 회원 문의 포함)가 1건이라도 있거나, 옛 slug 가 탈퇴 가림 정책 redactionRefundCategorySlugs 에 있으면 거부.
CREATE FUNCTION public.guard_support_category_slug()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_support_category_slug$
DECLARE
  v_slugs jsonb;
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    IF EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.category_id = OLD.id) THEN
      RAISE EXCEPTION 'SUPPORT_CATEGORY_SLUG_LOCKED';
    END IF;
    v_slugs := (SELECT s.value -> 'redactionRefundCategorySlugs' FROM public.system_settings s WHERE s.key = 'member_withdrawal_policy');
    IF jsonb_typeof(v_slugs) = 'array' AND v_slugs ? OLD.slug THEN
      RAISE EXCEPTION 'SUPPORT_CATEGORY_SLUG_LOCKED';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn_guard_support_category_slug$;
REVOKE ALL ON FUNCTION public.guard_support_category_slug() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER guard_support_category_slug
  BEFORE UPDATE OF slug ON public.support_ticket_categories
  FOR EACH ROW EXECUTE FUNCTION public.guard_support_category_slug();

-- 6. 답변 저장 함수(4-3) -------------------------------------------------------------------------------------------
--    순서: 입력 → 행위자(owner 이거나 support.manage) → 문의 FOR UPDATE → 회원 삭제·탈퇴 → 재요청(작업 기록의 action·target_id·request_id·actor_id) →
--    충돌(sha256) → 첫 답변 / 수정(이력 1행·redaction_reviewed_at 비움) → 작업 기록(같은 거래).
--    app.support_answer_write = 문의 id 는 M2 잠금 트리거가 보는 표지다(거래 로컬).
CREATE FUNCTION public.save_support_ticket_answer(p_actor_id uuid, p_ticket_id uuid, p_response text, p_status text,
  p_expected_sha256 text, p_reason text, p_operation_key text, p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_save_support_ticket_answer$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
  v_audit public.admin_audit_log%ROWTYPE;
  v_key text := btrim(p_operation_key);
  v_reason text := NULLIF(btrim(p_reason), '');
  v_previous text;
  v_history uuid;
  v_is_edit boolean;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_actor_id IS NULL OR p_ticket_id IS NULL OR p_response IS NULL OR btrim(p_response) = '' OR char_length(p_response) > 10000
     OR (p_status IS NOT NULL AND p_status NOT IN ('in_progress', 'resolved', 'closed'))
     OR p_expected_sha256 IS NULL OR p_expected_sha256 !~ '^[0-9a-f]{64}$'
     OR NULLIF(v_key, '') IS NULL OR char_length(v_key) > 200
     OR p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'SUPPORT_ANSWER_INPUT_INVALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = p_actor_id AND p.is_admin IS TRUE
                    AND (p.admin_role = 'owner'
                         OR (p.admin_role = 'staff' AND EXISTS (SELECT 1 FROM public.admin_permission_grants g
                                                                  WHERE g.user_id = p.id AND g.permission = 'support.manage')))) THEN
    RAISE EXCEPTION 'SUPPORT_ANSWER_ACTOR_NOT_ALLOWED';
  END IF;

  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPPORT_TICKET_NOT_FOUND';
  END IF;

  IF v_ticket.is_deleted_by_user IS TRUE THEN
    RAISE EXCEPTION 'SUPPORT_TICKET_DELETED_BY_MEMBER';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_ticket.user_id AND p.withdrawn_at IS NOT NULL) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAWN';
  END IF;

  -- 재요청: 같은 처리자·같은 문의·같은 키의 기록이 있으면 그 결과를 다시 만든다(이력·작업 기록·알림 추가 없음).
  --   회원 삭제·탈퇴 검사 뒤에 둔다 — 탈퇴 회원 문의는 재요청이어도 본문을 돌려주지 않는다.
  SELECT a.* INTO v_audit
    FROM public.admin_audit_log a
   WHERE a.action IN ('support_ticket_reply', 'support_ticket_reply_edit')
     AND a.target_id = p_ticket_id::text
     AND a.request_id = v_key
     AND a.actor_id = p_actor_id
   ORDER BY a.created_at
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ticket', jsonb_build_object('id', v_ticket.id, 'user_id', v_ticket.user_id, 'subject', v_ticket.subject, 'status', v_ticket.status,
        'admin_response', v_ticket.admin_response, 'responded_at', v_ticket.responded_at, 'response_edited_at', v_ticket.response_edited_at,
        'updated_at', v_ticket.updated_at, 'created_at', v_ticket.created_at, 'category_id', v_ticket.category_id),
      'isEdit', v_audit.action = 'support_ticket_reply_edit',
      'historyId', v_audit.details -> 'historyId',
      'replayed', true);
  END IF;

  IF encode(sha256(convert_to(COALESCE(v_ticket.admin_response, ''), 'UTF8')), 'hex') <> p_expected_sha256 THEN
    RAISE EXCEPTION 'SUPPORT_ANSWER_CONFLICT';
  END IF;

  PERFORM set_config('app.support_answer_write', p_ticket_id::text, true);
  IF v_ticket.admin_response IS NULL THEN
    -- 첫 답변
    UPDATE public.support_tickets
       SET admin_response = p_response,
           status = COALESCE(p_status, 'resolved'),
           responded_at = v_now,
           updated_at = v_now
     WHERE id = p_ticket_id
    RETURNING * INTO v_ticket;
    PERFORM public.record_admin_audit(p_actor_id, 'support_ticket_reply', 'support_ticket', p_ticket_id::text, v_ticket.user_id, NULL, NULL,
      jsonb_build_object('status', v_ticket.status, 'length', char_length(p_response), 'request', p_request_meta), v_key);
    v_is_edit := false;
  ELSE
    -- 수정: 사유 필수, 같은 글 거부, 상태는 그대로
    IF v_reason IS NULL OR char_length(v_reason) > 300 THEN
      RAISE EXCEPTION 'SUPPORT_ANSWER_REASON_REQUIRED';
    END IF;
    IF p_response = v_ticket.admin_response THEN
      RAISE EXCEPTION 'SUPPORT_ANSWER_UNCHANGED';
    END IF;
    v_previous := v_ticket.admin_response;
    INSERT INTO public.support_ticket_answer_revisions (ticket_id, previous_response, previous_shown_at, edited_by, reason)
    VALUES (p_ticket_id, v_previous,
            COALESCE(v_ticket.response_edited_at, v_ticket.responded_at, v_ticket.updated_at, v_ticket.created_at), p_actor_id, v_reason)
    RETURNING id INTO v_history;
    UPDATE public.support_tickets
       SET admin_response = p_response,
           response_edited_at = v_now,
           updated_at = v_now,
           redaction_reviewed_at = NULL
     WHERE id = p_ticket_id
    RETURNING * INTO v_ticket;
    PERFORM public.record_admin_audit(p_actor_id, 'support_ticket_reply_edit', 'support_ticket', p_ticket_id::text, v_ticket.user_id, NULL, NULL,
      jsonb_build_object('historyId', v_history, 'lengthBefore', char_length(v_previous), 'lengthAfter', char_length(p_response),
                         'reasonLength', char_length(v_reason), 'request', p_request_meta), v_key);
    v_is_edit := true;
  END IF;
  PERFORM set_config('app.support_answer_write', '', true);

  RETURN jsonb_build_object(
    'ticket', jsonb_build_object('id', v_ticket.id, 'user_id', v_ticket.user_id, 'subject', v_ticket.subject, 'status', v_ticket.status,
      'admin_response', v_ticket.admin_response, 'responded_at', v_ticket.responded_at, 'response_edited_at', v_ticket.response_edited_at,
      'updated_at', v_ticket.updated_at, 'created_at', v_ticket.created_at, 'category_id', v_ticket.category_id),
    'isEdit', v_is_edit,
    'historyId', v_history,
    'replayed', false);
END;
$fn_save_support_ticket_answer$;
REVOKE ALL ON FUNCTION public.save_support_ticket_answer(uuid, uuid, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_support_ticket_answer(uuid, uuid, text, text, text, text, text, jsonb) TO service_role;

-- 7. 10번 함수 재정의(4-4) — 운영 원문 그대로에 '-- [13번]' 줄만 더하거나 바꿨다. 권한(EXECUTE)은 CREATE OR REPLACE 가 그대로 둔다. ------
-- 7-1. member_withdrawal_facts: (가) 계좌 요청 시각에 이력, (나) 가림 항목 support_ticket_answer_revision, (다) v_last_ticket 에 수정 시각,
--      문의 '확인됨' 판정에 수정 시각.
CREATE OR REPLACE FUNCTION public.member_withdrawal_facts(p_user_id uuid, p_ticket_retention_agreed boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_policy jsonb := public.member_withdrawal_policy();
  v_now timestamptz := now();
  v_profile public.profiles%ROWTYPE;
  v_order_ids uuid[];
  v_order_id_texts text[];
  v_order_keys text[];
  v_mul_nos text[];
  v_paid_reasons text[] := ARRAY[]::text[];
  v_had_payment boolean;
  v_has_orders boolean;
  v_in_orders integer;
  v_in_attempts integer;
  v_in_markers integer;
  v_in_webhooks integer;
  v_in_point_refunds integer;
  v_in_market_refunds integer;
  v_in_sources integer;
  v_in_alerts integer;
  v_in_jobs integer;
  v_in_total integer;
  v_open_periods jsonb := '[]'::jsonb;
  v_unverified jsonb;
  v_redaction jsonb := '[]'::jsonb;
  v_slugs text[];
  v_keywords text[];
  v_account_at timestamptz;
  v_quiet integer := public.member_withdrawal_policy_days('selfWithdrawOrderQuietDays');
  v_buffer integer := public.member_withdrawal_policy_days('withdrawRefundDeadlineBufferDays');
  v_setting_days integer := public.point_charge_refund_days();
  v_src record;
  v_order public.payment_orders%ROWTYPE;
  v_root_created timestamptz;
  v_ack_days integer;
  v_days integer;
  v_deadline timestamptz;
  v_until timestamptz;
  v_breakdown jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_paid integer := 0;
  v_free integer := 0;
  v_expired integer := 0;
  v_cash integer := 0;
  v_cash_unknown boolean := false;
  v_is_paid boolean;
  v_value integer;
  v_last_activity timestamptz;
  v_quiet_until timestamptz;
  v_recent boolean;
  v_last_payment timestamptz;
  v_last_market timestamptz;
  v_last_ticket timestamptz;
  v_refund_tickets uuid[];
  v_ticket_count integer;
  v_pending_tickets integer;
  v_open_request uuid;
  v_has_request boolean;
  v_marketing_agreed boolean;
  v_self_enabled boolean;
  v_self_reasons text[] := ARRAY[]::text[];
  v_request_reasons text[] := ARRAY[]::text[];
  v_retain_tickets boolean;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('userId', p_user_id, 'exists', false);
  END IF;

  SELECT COALESCE(array_agg(o.id), '{}'), COALESCE(array_agg(o.id::text), '{}'), COALESCE(array_agg(o.order_id), '{}')
    INTO v_order_ids, v_order_id_texts, v_order_keys
    FROM public.payment_orders o
   WHERE o.user_id = p_user_id;
  SELECT COALESCE(array_agg(t.provider_transaction_id) FILTER (WHERE t.provider_transaction_id IS NOT NULL), '{}')
    INTO v_mul_nos
    FROM public.payment_provider_transactions t
   WHERE t.payment_order_id = ANY (v_order_ids);
  v_has_orders := cardinality(v_order_ids) > 0
    OR EXISTS (SELECT 1 FROM public.checkout_attempts a WHERE a.user_id = p_user_id);

  -- 결제 회원(had_payment)
  IF EXISTS (
    SELECT 1 FROM public.payment_orders o
     WHERE o.user_id = p_user_id
       AND (o.status IN ('completed', 'refunded', 'cancel_pending', 'fulfillment_pending', 'confirming', 'manual_review')
            OR o.approved_at IS NOT NULL
            OR o.canceled_at IS NOT NULL
            OR EXISTS (SELECT 1 FROM public.payment_history h WHERE h.payment_order_id = o.id)
            OR EXISTS (SELECT 1 FROM public.payment_provider_transactions t
                        WHERE t.payment_order_id = o.id
                          AND (t.paid_feedback_recorded_at IS NOT NULL OR t.admin_paid_confirmed_at IS NOT NULL
                               OR t.cancel_feedback_recorded_at IS NOT NULL OR t.partial_cancel_feedback_recorded_at IS NOT NULL)))
  ) THEN
    v_paid_reasons := v_paid_reasons || 'MONEY_ORDER'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_history h WHERE h.user_id = p_user_id AND h.amount > 0) THEN
    v_paid_reasons := v_paid_reasons || 'PAYMENT_HISTORY'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.credit_sources s WHERE s.user_id = p_user_id AND s.source_category = 'plan_purchase') THEN
    v_paid_reasons := v_paid_reasons || 'PLAN_PURCHASE_SOURCE'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_orders o
              WHERE o.user_id = p_user_id AND o.failure_code IN ('PAYAPP_FEEDBACK_MISMATCH', 'PAYAPP_MUL_NO_CONFLICT')) THEN
    v_paid_reasons := v_paid_reasons || 'FEEDBACK_VERIFICATION_FAILED'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_admin_actions paa WHERE paa.payment_order_id = ANY (v_order_ids)) THEN
    v_paid_reasons := v_paid_reasons || 'PAYMENT_ADMIN_ACTION'::text;
  END IF;
  v_had_payment := cardinality(v_paid_reasons) > 0;
  v_retain_tickets := v_had_payment OR p_ticket_retention_agreed IS NOT FALSE;

  -- 진행 중(종류별)
  SELECT count(*)::integer INTO v_in_orders
    FROM public.payment_orders o
   WHERE o.user_id = p_user_id AND o.status NOT IN ('completed', 'refunded', 'failed', 'expired');
  SELECT count(*)::integer INTO v_in_attempts
    FROM public.checkout_attempts a
   WHERE a.user_id = p_user_id
     AND a.status IN ('claimed', 'manual_review')
     AND ((a.payment_order_id IS NULL AND a.expires_at > v_now)
          OR EXISTS (SELECT 1 FROM public.payment_orders o
                      WHERE o.id = a.payment_order_id AND o.status NOT IN ('completed', 'refunded', 'failed', 'expired')));
  SELECT count(*)::integer INTO v_in_markers
    FROM public.payment_provider_transactions t
   WHERE t.payment_order_id = ANY (v_order_ids)
     AND ((t.cancel_feedback_recorded_at IS NOT NULL AND t.cancel_processed_at IS NULL)
          OR (t.partial_cancel_feedback_recorded_at IS NOT NULL AND t.partial_cancel_processed_at IS NULL));
  SELECT count(*)::integer INTO v_in_webhooks
    FROM public.payment_webhook_events w
   WHERE w.processing_status IN ('pending', 'failed')
     AND w.transmission_id LIKE 'payapp:%'
     AND split_part(w.transmission_id, ':', 2) = ANY (v_mul_nos);
  SELECT count(*)::integer INTO v_in_point_refunds
    FROM public.refund_requests rr
   WHERE rr.user_id = p_user_id AND rr.status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review');
  SELECT count(*)::integer INTO v_in_market_refunds
    FROM public.market_refund_requests mr
   WHERE mr.user_id = p_user_id AND mr.status = 'pending';
  SELECT count(*)::integer INTO v_in_sources
    FROM public.credit_sources s
   WHERE s.user_id = p_user_id
     AND (s.status = 'pending_refund'
          OR (s.source_category = 'system_refund'
              AND COALESCE((SELECT r.root_in_progress FROM public.credit_source_paid_root(s.id) r LIMIT 1), false)));
  SELECT count(*)::integer INTO v_in_alerts
    FROM public.payment_reconciliation_alerts a
   WHERE a.resolved_at IS NULL
     AND ((a.details ->> 'payment_order_id') = ANY (v_order_id_texts)
          OR (a.details ->> 'order_payment_order_id') = ANY (v_order_id_texts)
          OR (a.details ->> 'mul_no') = ANY (v_mul_nos)
          OR (a.details ->> 'orig_mul_no') = ANY (v_mul_nos)
          OR (a.details ->> 'order_id') = ANY (v_order_keys)
          OR (a.details ->> 'user_id') = p_user_id::text);
  SELECT count(*)::integer INTO v_in_jobs
    FROM public.generate_listboard_generation_jobs j
   WHERE j.user_id = p_user_id AND j.status IN ('queued', 'running');
  v_in_total := v_in_orders + v_in_attempts + v_in_markers + v_in_webhooks + v_in_point_refunds
    + v_in_market_refunds + v_in_sources + v_in_alerts + v_in_jobs;

  -- 크레딧(원천별, 만료 순)과 환불 기간이 남은 유료 충전 건
  FOR v_src IN
    SELECT s.id, s.source_category, s.status, s.remaining_credits, s.expires_at, s.created_at, s.payment_order_id,
           r.root_source_id, r.payment_order_id AS root_order_id
      FROM public.credit_sources s
      LEFT JOIN LATERAL (SELECT x.root_source_id, x.payment_order_id FROM public.credit_source_paid_root(s.id) x LIMIT 1) r ON true
     WHERE s.user_id = p_user_id AND s.remaining_credits > 0
     ORDER BY s.expires_at NULLS LAST, s.id
  LOOP
    v_is_paid := v_src.root_source_id IS NOT NULL OR v_src.source_category = 'plan_purchase';
    IF v_src.expires_at IS NOT NULL AND v_src.expires_at <= v_now THEN
      v_expired := v_expired + v_src.remaining_credits;
      v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
        'source_id', v_src.id, 'category', v_src.source_category, 'paid', v_is_paid, 'paid_root_id', v_src.root_source_id,
        'credits', v_src.remaining_credits, 'forfeited', 0, 'expired_cleared', v_src.remaining_credits,
        'expires_at', v_src.expires_at, 'cash_value', NULL));
    ELSE
      v_total := v_total + v_src.remaining_credits;
      v_value := NULL;
      IF v_is_paid THEN
        v_paid := v_paid + v_src.remaining_credits;
        v_value := public.point_charge_cash_value(v_src.id, v_src.remaining_credits);
        IF v_value IS NULL THEN
          v_cash_unknown := true;
        ELSE
          v_cash := v_cash + v_value;
        END IF;
      ELSE
        v_free := v_free + v_src.remaining_credits;
      END IF;
      v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
        'source_id', v_src.id, 'category', v_src.source_category, 'paid', v_is_paid, 'paid_root_id', v_src.root_source_id,
        'credits', v_src.remaining_credits, 'forfeited', v_src.remaining_credits, 'expired_cleared', 0,
        'expires_at', v_src.expires_at, 'cash_value', v_value));
    END IF;

    IF v_is_paid THEN
      -- eligibility 와 같은 식: 뿌리 주문·뿌리 원천 기준, 일수 COALESCE(GREATEST(설정, 결제 전 동의), 7)
      v_order := NULL;
      SELECT * INTO v_order FROM public.payment_orders o WHERE o.id = COALESCE(v_src.root_order_id, v_src.payment_order_id);
      SELECT c.created_at INTO v_root_created FROM public.credit_sources c WHERE c.id = COALESCE(v_src.root_source_id, v_src.id);
      v_ack_days := NULL;
      SELECT a.refund_days INTO v_ack_days
        FROM public.checkout_attempts ca
        JOIN public.point_charge_checkout_acks a
          ON a.user_id = ca.user_id AND a.checkout_attempt_id = ca.checkout_attempt_id
       WHERE ca.id = v_order.checkout_attempt_id;
      v_days := COALESCE(GREATEST(v_setting_days, v_ack_days), 7);
      v_deadline := public.point_charge_refund_deadline(GREATEST(v_order.approved_at, v_root_created), v_days);
      v_until := CASE WHEN v_deadline IS NULL OR v_buffer IS NULL THEN NULL ELSE v_deadline + make_interval(days => v_buffer) END;
      IF v_until IS NULL OR v_until > v_now THEN
        v_open_periods := v_open_periods || jsonb_build_array(jsonb_build_object(
          'sourceId', v_src.id, 'rootSourceId', COALESCE(v_src.root_source_id, v_src.id), 'paymentOrderId', v_order.id,
          'deadline', v_deadline, 'blockedUntil', v_until, 'refundDays', v_days,
          'inBuffer', v_deadline IS NOT NULL AND v_deadline <= v_now));
      END IF;
    END IF;
  END LOOP;

  -- 페이앱 요청 미확인 주문
  SELECT COALESCE(jsonb_agg(o.id ORDER BY o.created_at), '[]'::jsonb) INTO v_unverified
    FROM public.payment_orders o
    JOIN public.payment_provider_transactions t ON t.payment_order_id = o.id
   WHERE o.user_id = p_user_id
     AND o.status = 'expired'
     AND o.failure_code IN ('PAYAPP_REQUEST_OUTCOME_EXPIRED', 'PAYAPP_READY_CANCEL_FAILED')
     AND t.provider_transaction_id IS NOT NULL
     AND COALESCE(t.provider_status, '') NOT IN ('8', '16', '32');

  -- 문의
  v_slugs := ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_policy -> 'redactionRefundCategorySlugs') = 'array'
                                                         THEN v_policy -> 'redactionRefundCategorySlugs' ELSE '[]'::jsonb END));
  v_keywords := ARRAY(SELECT k FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_policy -> 'redactionAccountRequestKeywords') = 'array'
                                                                  THEN v_policy -> 'redactionAccountRequestKeywords' ELSE '[]'::jsonb END) AS k
                       WHERE btrim(k) <> '');
  -- [13번] (가) 계좌 요청 시각: 지금 답변과 답변 수정 이력(그때 회원이 보던 글·보이기 시작한 시각)을 함께 본다.
  SELECT min(x.at) INTO v_account_at
    FROM (SELECT t.responded_at AS at
            FROM public.support_tickets t
           WHERE t.user_id = p_user_id
             AND t.responded_at IS NOT NULL
             AND EXISTS (SELECT 1 FROM unnest(v_keywords) AS k WHERE strpos(COALESCE(t.admin_response, ''), k) > 0)
          UNION ALL
          SELECT ar.previous_shown_at
            FROM public.support_ticket_answer_revisions ar
            JOIN public.support_tickets t ON t.id = ar.ticket_id
           WHERE t.user_id = p_user_id
             AND EXISTS (SELECT 1 FROM unnest(v_keywords) AS k WHERE strpos(ar.previous_response, k) > 0)) x;

  SELECT count(*)::integer,
         count(*) FILTER (WHERE t.status IN ('pending', 'in_progress'))::integer,
         max(GREATEST(t.responded_at, t.response_edited_at, t.member_updated_at, t.created_at)) -- [13번] (다) 답변 수정 시각
    INTO v_ticket_count, v_pending_tickets, v_last_ticket
    FROM public.support_tickets t
   WHERE t.user_id = p_user_id;

  SELECT COALESCE(array_agg(t.id ORDER BY t.created_at), '{}') INTO v_refund_tickets
    FROM public.support_tickets t
   WHERE t.user_id = p_user_id
     AND (COALESCE(t.category_snapshot ->> 'slug', (SELECT c.slug FROM public.support_ticket_categories c WHERE c.id = t.category_id)) = ANY (v_slugs)
          OR EXISTS (SELECT 1 FROM public.market_refund_requests mr WHERE mr.support_ticket_id = t.id));

  -- 가림 확인 필요(확인 뒤 회원이 고쳤거나 답변이 달렸으면 다시 필요)
  IF v_retain_tickets THEN
    WITH tk AS (
      SELECT t.*,
             (t.id = ANY (v_refund_tickets)) AS refund_related,
             (v_account_at IS NOT NULL AND (t.created_at > v_account_at OR t.member_updated_at > v_account_at)) AS after_account,
             (t.redaction_reviewed_at IS NOT NULL
              AND t.redaction_reviewed_at >= COALESCE(GREATEST(t.member_updated_at, t.responded_at, t.response_edited_at), '-infinity'::timestamptz)) AS reviewed -- [13번] 수정 시각
        FROM public.support_tickets t
       WHERE t.user_id = p_user_id
    ), items AS (
      SELECT 'support_ticket'::text AS kind, tk.id, tk.created_at,
             left(regexp_replace(tk.subject, '\s+', ' ', 'g'), 30) AS preview,
             array_remove(ARRAY[
               CASE WHEN tk.refund_related THEN 'REFUND_RELATED' END,
               CASE WHEN tk.after_account THEN 'AFTER_ACCOUNT_REQUEST' END,
               CASE WHEN public.member_text_has_long_number(tk.subject) OR public.member_text_has_long_number(tk.message)
                         OR public.member_text_has_long_number(tk.admin_response) THEN 'LONG_NUMBER' END], NULL) AS reasons
        FROM tk
       WHERE NOT tk.reviewed
      UNION ALL
      SELECT 'support_ticket_revision', rv.id, rv.created_at,
             left(regexp_replace(COALESCE(rv.subject, ''), '\s+', ' ', 'g'), 30),
             array_remove(ARRAY[
               CASE WHEN tk.refund_related THEN 'REFUND_RELATED' END,
               CASE WHEN tk.after_account THEN 'AFTER_ACCOUNT_REQUEST' END,
               CASE WHEN public.member_text_has_long_number(rv.subject) OR public.member_text_has_long_number(rv.message) THEN 'LONG_NUMBER' END], NULL)
        FROM public.support_ticket_revisions rv
        JOIN tk ON tk.id = rv.ticket_id
       WHERE rv.redaction_reviewed_at IS NULL
      -- [13번] (나) 답변 수정 이력: 부모 문의의 환불 관련·계좌 요청 뒤, 이전 답변·수정 사유의 긴 숫자
      UNION ALL
      SELECT 'support_ticket_answer_revision', ar.id, ar.created_at,
             left(regexp_replace(COALESCE(tk.subject, ''), '\s+', ' ', 'g'), 30),
             array_remove(ARRAY[
               CASE WHEN tk.refund_related THEN 'REFUND_RELATED' END,
               CASE WHEN tk.after_account THEN 'AFTER_ACCOUNT_REQUEST' END,
               CASE WHEN public.member_text_has_long_number(ar.previous_response) OR public.member_text_has_long_number(ar.reason) THEN 'LONG_NUMBER' END], NULL)
        FROM public.support_ticket_answer_revisions ar
        JOIN tk ON tk.id = ar.ticket_id
       WHERE ar.redaction_reviewed_at IS NULL
      UNION ALL
      SELECT 'refund_request', rr.id, rr.created_at, NULL::text,
             ARRAY['LONG_NUMBER']::text[]
        FROM public.refund_requests rr
       WHERE v_had_payment
         AND rr.user_id = p_user_id
         AND (rr.redaction_reviewed_at IS NULL OR rr.redaction_reviewed_at < rr.updated_at)
         AND (public.member_text_has_long_number(rr.reason) OR public.member_text_has_long_number(rr.admin_note))
      UNION ALL
      SELECT 'market_refund_request', mr.id, mr.created_at, NULL::text,
             ARRAY['LONG_NUMBER']::text[]
        FROM public.market_refund_requests mr
       WHERE v_had_payment
         AND mr.user_id = p_user_id
         AND (mr.redaction_reviewed_at IS NULL OR mr.redaction_reviewed_at < mr.updated_at)
         AND (public.member_text_has_long_number(mr.reason) OR public.member_text_has_long_number(mr.admin_note))
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', i.kind, 'id', i.id, 'preview', i.preview, 'reasons', to_jsonb(i.reasons))
                              ORDER BY i.created_at, i.id), '[]'::jsonb)
      INTO v_redaction
      FROM items i
     WHERE cardinality(i.reasons) > 0;
  END IF;

  -- 사건 시각
  SELECT GREATEST(max(o.created_at), max(o.approved_at), max(o.canceled_at),
                  (SELECT max(a.created_at) FROM public.checkout_attempts a WHERE a.user_id = p_user_id),
                  max(t.paid_feedback_recorded_at), max(t.cancel_feedback_recorded_at),
                  max(t.partial_cancel_feedback_recorded_at), max(t.admin_paid_confirmed_at))
    INTO v_last_activity
    FROM public.payment_orders o
    LEFT JOIN public.payment_provider_transactions t ON t.payment_order_id = o.id
   WHERE o.user_id = p_user_id;
  IF v_last_activity IS NULL THEN
    SELECT max(a.created_at) INTO v_last_activity FROM public.checkout_attempts a WHERE a.user_id = p_user_id;
  END IF;
  v_quiet_until := CASE WHEN v_last_activity IS NULL THEN NULL
                        WHEN v_quiet IS NULL THEN 'infinity'::timestamptz
                        ELSE v_last_activity + make_interval(days => v_quiet) END;
  v_recent := v_quiet_until IS NOT NULL AND v_quiet_until > v_now;

  SELECT GREATEST(max(o.approved_at), max(o.canceled_at),
                  max(t.paid_feedback_recorded_at), max(t.cancel_feedback_recorded_at),
                  max(t.partial_cancel_feedback_recorded_at), max(t.admin_paid_confirmed_at),
                  (SELECT max(rr.processed_at) FROM public.refund_requests rr WHERE rr.user_id = p_user_id),
                  (SELECT max(a.created_at) FROM public.checkout_attempts a WHERE a.user_id = p_user_id))
    INTO v_last_payment
    FROM public.payment_orders o
    LEFT JOIN public.payment_provider_transactions t ON t.payment_order_id = o.id
   WHERE o.user_id = p_user_id;
  IF v_last_payment IS NULL THEN
    SELECT GREATEST((SELECT max(rr.processed_at) FROM public.refund_requests rr WHERE rr.user_id = p_user_id),
                    (SELECT max(a.created_at) FROM public.checkout_attempts a WHERE a.user_id = p_user_id))
      INTO v_last_payment;
  END IF;
  SELECT GREATEST((SELECT max(mo.created_at) FROM public.market_purchase_orders mo WHERE mo.user_id = p_user_id),
                  (SELECT max(mr.processed_at) FROM public.market_refund_requests mr WHERE mr.user_id = p_user_id))
    INTO v_last_market;

  -- 요청·마케팅·스위치
  SELECT r.id INTO v_open_request FROM public.member_withdrawal_requests r WHERE r.user_id = p_user_id AND r.status = 'pending';
  v_has_request := EXISTS (SELECT 1 FROM public.member_withdrawal_requests r WHERE r.user_id = p_user_id);
  SELECT c.agreed INTO v_marketing_agreed
    FROM public.user_consents c
    JOIN public.signup_consent_items i ON i.id = c.item_id
   WHERE c.user_id = p_user_id
     AND i.key = (v_policy ->> 'marketingConsentItemKey')
   ORDER BY c.seq DESC
   LIMIT 1;
  v_self_enabled := COALESCE((v_policy -> 'selfAnonymizeEnabled') = 'true'::jsonb, false);

  -- 스스로 익명화·결제 회원 탈퇴 요청 가능 여부와 이유
  IF v_profile.is_admin IS TRUE THEN
    v_self_reasons := v_self_reasons || 'ADMIN'::text;
    v_request_reasons := v_request_reasons || 'ADMIN'::text;
  END IF;
  IF v_profile.withdrawn_at IS NOT NULL THEN
    v_self_reasons := v_self_reasons || 'WITHDRAWN'::text;
    v_request_reasons := v_request_reasons || 'WITHDRAWN'::text;
  END IF;
  IF NOT v_self_enabled THEN
    v_self_reasons := v_self_reasons || 'DISABLED'::text;
    v_request_reasons := v_request_reasons || 'DISABLED'::text;
  END IF;
  IF v_had_payment THEN
    v_self_reasons := v_self_reasons || 'PAYER'::text;
  ELSE
    v_request_reasons := v_request_reasons || 'NOT_PAYER'::text;
  END IF;
  IF v_in_total > 0 THEN
    v_self_reasons := v_self_reasons || 'IN_PROGRESS'::text;
    v_request_reasons := v_request_reasons || 'IN_PROGRESS'::text;
  END IF;
  IF jsonb_array_length(v_open_periods) > 0 THEN
    v_self_reasons := v_self_reasons || 'REFUND_PERIOD_OPEN'::text;
    v_request_reasons := v_request_reasons || 'REFUND_PERIOD_OPEN'::text;
  END IF;
  IF jsonb_array_length(v_unverified) > 0 THEN
    v_self_reasons := v_self_reasons || 'PROVIDER_UNVERIFIED'::text;
  END IF;
  IF jsonb_array_length(v_redaction) > 0 THEN
    v_self_reasons := v_self_reasons || 'REDACTION_REQUIRED'::text;
  END IF;
  IF v_recent THEN
    v_self_reasons := v_self_reasons || 'RECENT_PAYMENT_ACTIVITY'::text;
  END IF;
  IF v_open_request IS NOT NULL THEN
    v_request_reasons := v_request_reasons || 'REQUEST_PENDING'::text;
  END IF;
  -- 원 환산을 계산할 수 없는 유료 원천(주문 없는 옛 plan_purchase 등): 화면에서는 받지 않고 대표가 결제 내역으로 금액을 확인해 처리한다.
  IF v_cash_unknown THEN
    v_self_reasons := v_self_reasons || 'CASH_VALUE_UNKNOWN'::text;
    v_request_reasons := v_request_reasons || 'CASH_VALUE_UNKNOWN'::text;
  END IF;

  RETURN jsonb_build_object(
    'userId', p_user_id,
    'exists', true,
    'isAdmin', v_profile.is_admin IS TRUE,
    'withdrawnAt', v_profile.withdrawn_at,
    'provider', v_profile.provider,
    'hadPayment', v_had_payment,
    'hadPaymentReasons', to_jsonb(v_paid_reasons),
    'hasOrdersOrAttempts', v_has_orders,
    'hasRequestHistory', v_has_request,
    'openRequestId', v_open_request,
    'ticketCount', v_ticket_count,
    'pendingTicketCount', v_pending_tickets,
    'ticketRetentionAgreed', p_ticket_retention_agreed,
    'inProgress', jsonb_build_object(
      'orders', v_in_orders, 'attempts', v_in_attempts, 'cancelMarkers', v_in_markers, 'webhookEvents', v_in_webhooks,
      'pointRefunds', v_in_point_refunds, 'marketRefunds', v_in_market_refunds, 'pendingSources', v_in_sources,
      'alerts', v_in_alerts, 'generationJobs', v_in_jobs),
    'inProgressTotal', v_in_total,
    'refundPeriodOpen', v_open_periods,
    'providerUnverified', v_unverified,
    'redactionRequired', v_redaction,
    'refundTicketIds', to_jsonb(v_refund_tickets),
    'lastPaymentActivityAt', v_last_activity,
    'quietUntil', v_quiet_until,
    'lastPaymentEventAt', v_last_payment,
    'lastMarketEventAt', v_last_market,
    'lastTicketEventAt', v_last_ticket,
    'balance', jsonb_build_object(
      'spendable', (public.get_credit_balance_snapshot(p_user_id) ->> 'spendable_balance')::integer,
      'forfeitTotal', v_total, 'forfeitPaid', v_paid, 'forfeitFree', v_free, 'expired', v_expired,
      'paidCashValue', v_cash, 'paidCashValueUnknown', v_cash_unknown, 'breakdown', v_breakdown),
    'marketingAgreed', COALESCE(v_marketing_agreed, false),
    'selfAnonymizeEnabled', v_self_enabled,
    'fullDeleteAllowed', v_profile.is_admin IS NOT TRUE AND v_profile.withdrawn_at IS NULL AND NOT v_had_payment
                         AND NOT v_has_orders AND NOT v_has_request
                         AND (v_ticket_count = 0 OR p_ticket_retention_agreed IS FALSE),
    'selfAllowed', cardinality(v_self_reasons) = 0,
    'selfReasons', to_jsonb(v_self_reasons),
    'requestAllowed', cardinality(v_request_reasons) = 0,
    'requestReasons', to_jsonb(v_request_reasons)
  );
END;
$function$
;

-- 7-2. redact_member_text: 대상 종류 support_ticket_answer_revision(칸 previous_response·reason), 관리자 이벤트 가림은 부모 문의 기준.
CREATE OR REPLACE FUNCTION public.redact_member_text(p_actor_id uuid, p_target_kind text, p_target_id uuid, p_field text, p_target_text text, p_operation_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mask text := NULLIF(btrim(public.member_withdrawal_policy() -> 'texts' ->> 'redactionMask'), '');
  v_table text;
  v_user uuid;
  v_value text;
  v_ref_table text;
  v_ref_id uuid;
  v_occurrences integer;
  v_events integer;
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  IF p_target_id IS NULL OR p_target_text IS NULL OR btrim(p_target_text) = '' OR length(p_target_text) > 2000
     OR NULLIF(btrim(p_operation_key), '') IS NULL OR length(p_operation_key) > 200
     OR NOT ((p_target_kind = 'support_ticket' AND p_field IN ('subject', 'message', 'admin_response'))
             OR (p_target_kind = 'support_ticket_revision' AND p_field IN ('subject', 'message'))
             OR (p_target_kind = 'support_ticket_answer_revision' AND p_field IN ('previous_response', 'reason')) -- [13번]
             OR (p_target_kind IN ('refund_request', 'market_refund_request') AND p_field IN ('reason', 'admin_note'))) THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  IF v_mask IS NULL THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_POLICY_UNAVAILABLE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_audit_log a WHERE a.action = 'member_text_redact' AND a.request_id = p_operation_key) THEN
    RETURN jsonb_build_object('redacted', true, 'replay', true);
  END IF;

  v_table := CASE p_target_kind WHEN 'support_ticket' THEN 'support_tickets' WHEN 'support_ticket_revision' THEN 'support_ticket_revisions'
                                WHEN 'support_ticket_answer_revision' THEN 'support_ticket_answer_revisions' -- [13번]
                                WHEN 'refund_request' THEN 'refund_requests' ELSE 'market_refund_requests' END;
  IF p_target_kind = 'support_ticket_revision' THEN
    SELECT t.user_id, t.id INTO v_user, v_ref_id
      FROM public.support_ticket_revisions rv JOIN public.support_tickets t ON t.id = rv.ticket_id
     WHERE rv.id = p_target_id;
    v_ref_table := 'support_tickets';
    EXECUTE format('SELECT %I FROM public.support_ticket_revisions WHERE id = $1 FOR UPDATE', p_field) INTO v_value USING p_target_id;
  -- [13번] 답변 수정 이력: 관리자 이벤트 가림은 수정 이력처럼 부모 문의 기준
  ELSIF p_target_kind = 'support_ticket_answer_revision' THEN
    SELECT t.user_id, t.id INTO v_user, v_ref_id
      FROM public.support_ticket_answer_revisions ar JOIN public.support_tickets t ON t.id = ar.ticket_id
     WHERE ar.id = p_target_id;
    v_ref_table := 'support_tickets';
    EXECUTE format('SELECT %I FROM public.support_ticket_answer_revisions WHERE id = $1 FOR UPDATE', p_field) INTO v_value USING p_target_id;
  ELSE
    EXECUTE format('SELECT user_id, %I FROM public.%I WHERE id = $1 FOR UPDATE', p_field, v_table) INTO v_user, v_value USING p_target_id;
    v_ref_table := v_table;
    v_ref_id := p_target_id;
  END IF;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'MEMBER_REDACTION_TARGET_NOT_FOUND';
  END IF;
  IF v_value IS NULL OR strpos(v_value, p_target_text) = 0 THEN
    RAISE EXCEPTION 'MEMBER_REDACTION_TEXT_NOT_FOUND';
  END IF;
  v_occurrences := (length(v_value) - length(replace(v_value, p_target_text, ''))) / length(p_target_text);

  PERFORM set_config('app.member_withdrawal_bypass', v_user::text, true);
  EXECUTE format('UPDATE public.%I SET %I = replace(%I, $1, $2), redaction_reviewed_at = clock_timestamp() WHERE id = $3',
                 v_table, p_field, p_field)
    USING p_target_text, v_mask, p_target_id;

  UPDATE public.admin_events e
     SET title = replace(e.title, p_target_text, v_mask),
         body = replace(e.body, p_target_text, v_mask)
   WHERE ((e.ref_table = v_ref_table AND e.ref_id = v_ref_id)
          OR (e.ref_table = 'admin_events'
              AND e.ref_id IN (SELECT x.id FROM public.admin_events x WHERE x.ref_table = v_ref_table AND x.ref_id = v_ref_id)))
     AND (strpos(e.title, p_target_text) > 0 OR strpos(COALESCE(e.body, ''), p_target_text) > 0);
  GET DIAGNOSTICS v_events = ROW_COUNT;

  PERFORM public.record_admin_audit(p_actor_id, 'member_text_redact', p_target_kind, p_target_id::text, v_user, NULL, NULL,
    jsonb_build_object('field', p_field, 'length', length(p_target_text), 'occurrences', v_occurrences, 'admin_events', v_events),
    p_operation_key);

  RETURN jsonb_build_object('redacted', true, 'occurrences', v_occurrences, 'adminEventsUpdated', v_events);
END;
$function$
;

-- 7-3. mark_member_text_reviewed: 대상 종류 support_ticket_answer_revision 만 더함.
CREATE OR REPLACE FUNCTION public.mark_member_text_reviewed(p_actor_id uuid, p_target_kind text, p_target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_table text;
  v_user uuid;
  v_at timestamptz := clock_timestamp();
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  IF p_target_id IS NULL OR p_target_kind IS NULL
     OR p_target_kind NOT IN ('support_ticket', 'support_ticket_revision', 'support_ticket_answer_revision', 'refund_request', 'market_refund_request') THEN -- [13번]
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  v_table := CASE p_target_kind WHEN 'support_ticket' THEN 'support_tickets' WHEN 'support_ticket_revision' THEN 'support_ticket_revisions'
                                WHEN 'support_ticket_answer_revision' THEN 'support_ticket_answer_revisions' -- [13번]
                                WHEN 'refund_request' THEN 'refund_requests' ELSE 'market_refund_requests' END;
  IF p_target_kind = 'support_ticket_revision' THEN
    SELECT t.user_id INTO v_user FROM public.support_ticket_revisions rv JOIN public.support_tickets t ON t.id = rv.ticket_id WHERE rv.id = p_target_id;
  ELSIF p_target_kind = 'support_ticket_answer_revision' THEN -- [13번]
    SELECT t.user_id INTO v_user FROM public.support_ticket_answer_revisions ar JOIN public.support_tickets t ON t.id = ar.ticket_id WHERE ar.id = p_target_id;
  ELSE
    EXECUTE format('SELECT user_id FROM public.%I WHERE id = $1 FOR UPDATE', v_table) INTO v_user USING p_target_id;
  END IF;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'MEMBER_REDACTION_TARGET_NOT_FOUND';
  END IF;
  PERFORM set_config('app.member_withdrawal_bypass', v_user::text, true);
  EXECUTE format('UPDATE public.%I SET redaction_reviewed_at = $1 WHERE id = $2', v_table) USING v_at, p_target_id;
  PERFORM public.record_admin_audit(p_actor_id, 'member_text_reviewed', p_target_kind, p_target_id::text, v_user, NULL, NULL, '{}'::jsonb, NULL);
  RETURN jsonb_build_object('reviewed', true, 'reviewedAt', v_at);
END;
$function$
;

-- 7-4. read_withdrawn_member_ticket: 결과에 answerRevisions(답변 수정 이력) 더함.
CREATE OR REPLACE FUNCTION public.read_withdrawn_member_ticket(p_actor_id uuid, p_ticket_id uuid, p_reason text, p_request_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
BEGIN
  PERFORM public.member_withdrawal_require_owner(p_actor_id);
  IF NULLIF(btrim(p_reason), '') IS NULL OR length(p_reason) > 500
     OR (p_request_meta IS NOT NULL AND jsonb_typeof(p_request_meta) <> 'object') THEN
    RAISE EXCEPTION 'MEMBER_WITHDRAW_INPUT_INVALID';
  END IF;
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_ticket.user_id AND p.withdrawn_at IS NOT NULL) THEN
    RAISE EXCEPTION 'MEMBER_NOT_WITHDRAWN';
  END IF;
  PERFORM public.record_admin_audit(p_actor_id, 'withdrawn_record_view', 'support_ticket', p_ticket_id::text, v_ticket.user_id,
    NULL, p_reason, jsonb_build_object('kind', 'ticket', 'request', COALESCE(p_request_meta, '{}'::jsonb)), NULL);
  RETURN to_jsonb(v_ticket) || jsonb_build_object('revisions', (
    SELECT COALESCE(jsonb_agg(to_jsonb(rv) ORDER BY rv.written_at), '[]'::jsonb)
      FROM public.support_ticket_revisions rv WHERE rv.ticket_id = p_ticket_id),
    -- [13번] 답변 수정 이력(그때 회원이 보던 글·수정 사유)
    'answerRevisions', (
    SELECT COALESCE(jsonb_agg(to_jsonb(ar) ORDER BY ar.created_at, ar.id), '[]'::jsonb)
      FROM public.support_ticket_answer_revisions ar WHERE ar.ticket_id = p_ticket_id));
END;
$function$
;

-- [13번 M1] 끝 ------------------------------------------------------------------------------------------------

-- 8. VERIFY ---------------------------------------------------------------------------------------------------------
DO $verify_bundle13_cs_tools$
DECLARE
  v_rel text;
  v_fn text;
  v_value jsonb;
  v_key text;
  -- 회원 화면 필수 키(10-1 표 '필수', 코드 SUPPORT_PAGE_REQUIRED_KEYS 와 같은 목록·순서 — 계약 시험이 대조)
  v_required text[] := ARRAY[
    'pageTitle', 'formTitle', 'historyTitle', 'emptyTitle', 'categoryLabel', 'categoryPlaceholder', 'subjectLabel', 'messageLabel',
    'submitLabel', 'submittingLabel', 'uncategorizedLabel', 'editCategoryLabel', 'editSubjectLabel', 'editMessageLabel',
    'editSubjectPlaceholder', 'editMessagePlaceholder', 'cancelLabel', 'saveEditLabel', 'editIconTitle', 'deleteIconTitle',
    'needCategoryToast', 'needContentToast', 'deletedToast', 'updatedToast', 'submittedTitle', 'submittedDescription',
    'deleteConfirmTitle', 'deleteConfirmDescription', 'deleteConfirmLabel', 'submitFailedToast', 'updateFailedToast', 'deleteFailedToast',
    'answerLabel', 'answerCreatedNotificationTitle', 'answerCreatedNotificationMessage', 'answerEditedNotificationTitle',
    'answerEditedNotificationMessage'];
  v_optional text[] := ARRAY[
    'pageDescription', 'formNotice', 'responseTimeNote', 'defaultCategoryHelp', 'historyIntro', 'emptyDescription',
    'defaultSubjectPlaceholder', 'defaultMessagePlaceholder', 'answerEditedLabel'];
BEGIN
  -- 답변 이력: RLS·정책 0·service_role SELECT 만·가드 2개
  v_rel := 'public.support_ticket_answer_revisions';
  IF to_regclass(v_rel) IS NULL OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass(v_rel))
     OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = to_regclass(v_rel))
     OR NOT has_table_privilege('service_role', v_rel, 'SELECT')
     OR has_table_privilege('service_role', v_rel, 'INSERT') OR has_table_privilege('service_role', v_rel, 'UPDATE')
     OR has_table_privilege('service_role', v_rel, 'DELETE') OR has_table_privilege('service_role', v_rel, 'TRUNCATE')
     OR has_table_privilege('anon', v_rel, 'SELECT') OR has_table_privilege('authenticated', v_rel, 'SELECT')
     OR has_table_privilege('authenticated', v_rel, 'INSERT') OR has_table_privilege('authenticated', v_rel, 'UPDATE') THEN
    RAISE EXCEPTION 'VERIFY: answer revisions table / RLS / privileges';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = to_regclass(v_rel) AND NOT t.tgisinternal AND t.tgenabled = 'O'
       AND t.tgname IN ('guard_support_ticket_answer_revisions_mutation', 'guard_support_ticket_answer_revisions_truncate')) <> 2 THEN
    RAISE EXCEPTION 'VERIFY: answer revisions guard triggers';
  END IF;

  -- 템플릿: RLS·SELECT 정책 1개(support.manage)·anon 없음·authenticated SELECT 만·service_role 은 DELETE 없음·첫 값 14개
  v_rel := 'public.support_reply_templates';
  IF to_regclass(v_rel) IS NULL OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass(v_rel))
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_reply_templates') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_reply_templates'
                     AND policyname = 'support_reply_templates_admin_select' AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'
                     AND roles = '{authenticated}' AND qual LIKE '%has_admin_permission(''support.manage''::text)%')
     OR has_table_privilege('anon', v_rel, 'SELECT')
     OR NOT has_table_privilege('authenticated', v_rel, 'SELECT')
     OR has_table_privilege('authenticated', v_rel, 'INSERT') OR has_table_privilege('authenticated', v_rel, 'UPDATE')
     OR has_table_privilege('authenticated', v_rel, 'DELETE')
     OR NOT has_table_privilege('service_role', v_rel, 'INSERT') OR NOT has_table_privilege('service_role', v_rel, 'UPDATE')
     OR has_table_privilege('service_role', v_rel, 'DELETE') OR has_table_privilege('service_role', v_rel, 'TRUNCATE') THEN
    RAISE EXCEPTION 'VERIFY: reply templates table / policy / privileges';
  END IF;
  IF (SELECT count(*) FROM public.support_reply_templates WHERE created_by IS NULL AND revision = 1) <> 14
     OR EXISTS (SELECT 1 FROM public.support_reply_templates WHERE body ~ '써머썬|[^○]○[^○]|^○[^○]|[^○]○$') THEN
    RAISE EXCEPTION 'VERIFY: reply template seed';
  END IF;

  -- 설정 행: revision·필수 키(비지 않은 글)·선택 키(글)·관리자 값
  SELECT value INTO v_value FROM public.system_settings WHERE key = 'support_page_content';
  IF v_value IS NULL OR jsonb_typeof(v_value -> 'revision') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_value -> 'member') IS DISTINCT FROM 'object' OR jsonb_typeof(v_value -> 'admin') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'VERIFY: support_page_content shape';
  END IF;
  FOREACH v_key IN ARRAY v_required LOOP
    IF jsonb_typeof(v_value -> 'member' -> v_key) IS DISTINCT FROM 'string' OR btrim(v_value -> 'member' ->> v_key) = '' THEN
      RAISE EXCEPTION 'VERIFY: support_page_content required member key %', v_key;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY v_optional LOOP
    IF jsonb_typeof(v_value -> 'member' -> v_key) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'VERIFY: support_page_content optional member key %', v_key;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_object_keys(v_value -> 'member')) <> cardinality(v_required) + cardinality(v_optional)
     OR btrim(COALESCE(v_value -> 'admin' ->> 'templateBlankMarker', '')) = ''
     OR jsonb_typeof(v_value -> 'admin' -> 'answerEditReasonGuide') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_value -> 'admin' -> 'notifyOnAnswerEdit') IS DISTINCT FROM 'boolean'
     OR (v_value -> 'admin' -> 'accessLogRetentionYears') IS DISTINCT FROM '2'::jsonb THEN
    RAISE EXCEPTION 'VERIFY: support_page_content keys / admin values';
  END IF;

  -- 함수: 저장 함수는 service_role 만, 트리거 함수는 아무도. 모두 search_path 고정.
  v_fn := 'public.save_support_ticket_answer(uuid,uuid,text,text,text,text,text,jsonb)';
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS NOT TRUE THEN
    RAISE EXCEPTION 'VERIFY: save_support_ticket_answer EXECUTE / SECURITY DEFINER';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY['public.guard_support_category_slug()', 'public.guard_support_ticket_answer_revisions_mutation()'] LOOP
    IF has_function_privilege('service_role', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'VERIFY: % must not be executable by API roles', v_fn;
    END IF;
  END LOOP;
  IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.guard_support_category_slug()'::regprocedure) IS NOT TRUE THEN
    RAISE EXCEPTION 'VERIFY: guard_support_category_slug must be SECURITY DEFINER';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY['public.save_support_ticket_answer(uuid,uuid,text,text,text,text,text,jsonb)', 'public.guard_support_category_slug()',
                              'public.guard_support_ticket_answer_revisions_mutation()'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND 'search_path=public, pg_temp' = ANY (p.proconfig)) THEN
      RAISE EXCEPTION 'VERIFY: % search_path', v_fn;
    END IF;
  END LOOP;

  -- 재정의 4개: 본문 md5(prosrc)(로컬 계산 값)와 anonymize_member 그대로
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.member_withdrawal_facts(uuid,boolean)'::regprocedure) IS DISTINCT FROM '15147d898bdd615963fd7173e154d9f5'
     OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure) IS DISTINCT FROM '7ddf1b9245c429205af6b36fa01bfb21'
     OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.mark_member_text_reviewed(uuid,text,uuid)'::regprocedure) IS DISTINCT FROM '1284e5d70af808bb2b949432d92e255b'
     OR (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.read_withdrawn_member_ticket(uuid,uuid,text,jsonb)'::regprocedure) IS DISTINCT FROM 'ba416c661c7e9fb4c036c8516cd85d2c' THEN
    RAISE EXCEPTION 'VERIFY: bundle 10 redefinitions body';
  END IF;
  IF md5(pg_get_functiondef('public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)'::regprocedure))
     <> '1346d870d3623abae580a011b0484339' THEN
    RAISE EXCEPTION 'VERIFY: anonymize_member changed';
  END IF;
END;
$verify_bundle13_cs_tools$;

-- 기존 표에 거는 것(칸·FK·slug 트리거) 검사는 이름 붙인 별도 블록이다(리허설 light 사본은 이 DDL 과 이 블록을 뺀다).
DO $verify_bundle13_cs_tools_existing_tables$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'support_tickets'
                  AND column_name = 'response_edited_at' AND data_type = 'timestamp with time zone' AND is_nullable = 'YES' AND column_default IS NULL) THEN
    RAISE EXCEPTION 'VERIFY: support_tickets.response_edited_at';
  END IF;
  IF (SELECT count(*) FROM pg_constraint c WHERE c.contype = 'f' AND c.conrelid = 'public.support_ticket_answer_revisions'::regclass
       AND c.confrelid = 'public.support_tickets'::regclass AND c.confdeltype = 'c') <> 1
     OR (SELECT count(*) FROM pg_constraint c WHERE c.contype = 'f' AND c.conrelid = 'public.support_reply_templates'::regclass
       AND c.confrelid = 'public.support_ticket_categories'::regclass) <> 1 THEN
    RAISE EXCEPTION 'VERIFY: foreign keys';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t
       WHERE t.tgrelid = 'public.support_ticket_categories'::regclass AND NOT t.tgisinternal AND t.tgenabled = 'O'
         AND t.tgname = 'guard_support_category_slug'
         AND pg_get_triggerdef(t.oid) LIKE '%BEFORE UPDATE OF slug ON public.support_ticket_categories FOR EACH ROW%') <> 1 THEN
    RAISE EXCEPTION 'VERIFY: slug guard trigger';
  END IF;
END;
$verify_bundle13_cs_tools_existing_tables$;

NOTIFY pgrst, 'reload schema';
