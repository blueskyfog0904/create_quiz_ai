-- 10번 묶음 7절: 회원 탈퇴(익명화)에 맞춰 이용약관 12조·취소/환불정책 8-2절·개인정보처리방침 1·2·3·6·7·10절과 시행일,
--   가입 동의 항목 terms·privacy 새 판을 한 트랜잭션으로 고친다.
-- 근거: 계획 docs/plan-bundle10-member-withdrawal.md 0·3·4·7·14절(11·12번), 실제 동작 supabase/migrations/20261126100000_member_withdrawal.sql
--   (anonymize_member 6-1~6-11, member_withdrawal_policy 보존 기간 키), 런북 docs/admin-operations-runbook.md RB-11.
--   30일 전 고지 경로: 계획 docs/plan-bundle15-notice-popup.md 4-3(15번 묶음 — 이 스크립트를 게시·시행·고지 그만두기 세 방식으로 고침).
-- 마이그레이션이 아니다(적용 이력에 넣지 않는다). 운영 SQL 편집기(postgres)에서 이 파일 전체를 한 번에 실행한다.
-- 문구는 초안이다. 최종 문구는 대표가 변호사·클라이언트와 정한다. 게시한 뒤에는 고칠 수 없다(고치면 다시 게시하고 30일을 처음부터 센다).
--
-- 실회원이 있으므로 바로 시행하지 않는다. 약관 3조②·처리방침 14절에 따라 30일 전에 고지하고 시행일에 시행한다(15번 계획 0절 6번).
-- 실행 방식 c_mode(기본 NULL — NULL 이면 멈춘다):
--   'publish_upcoming'  게시: 바뀔 전문·변경 전후 대조(changes)·변경 전 전문·동의 항목 새 글을 system_settings 'policy_upcoming_documents' 에
--                       'upcoming' 으로 넣고 작업 기록 policy_upcoming_publish 를 남긴다. 약관 본문·동의 항목·탈퇴 정책 문구는 바꾸지 않는다.
--                       15번 마이그레이션(20261205100000_site_notice_popup) 적용 뒤에만 돈다. 게시 행이 'upcoming' 인 동안
--                       잠금 트리거가 약관 문서·가입 동의 항목 terms·privacy·탈퇴 정책 잠금 경로의 수정을 막는다.
--   'apply'             시행: 시행일(c_effective_date ~ c_apply_last_date, 한국 날짜)에만 돈다. 검사 순서(앞에서 멈추면 뒤는 하지 않음):
--                       1) 상수·날짜 2) 15번 마이그레이션 3) 10번 DB·스위치 꺼짐·처리 대기 탈퇴 요청 0건·12·13번 객체(처리방침이 설명하는 기능)·대표 확인 값
--                       4) 고지 끊김 판정 5-0) 관리자 기록 보관 기간 문장('기록한 날부터 N년') = 13번 accessLogRetentionYears
--                       (4 는 policy_upcoming_notice_continuity) 5) 지문(새 본문·동의 항목·changes 를 다시 계산해 게시 행과 대조).
--                       모두 같으면 게시 행을 먼저 'applied' 로 바꾸고(잠금 트리거가 풀림) 같은 거래에서 본문·동의 항목 새 판·탈퇴 문구를 저장한다.
--   'withdraw_upcoming' 고지 그만두기: 'upcoming' 게시 행을 'reverted' 로 표시하고 기록 policy_upcoming_withdraw 를 남긴다(c_withdraw_reason 필수).
--                       같은 날 관리자 카드에서 팝업을 끄거나 안내 문구로 바꾸고, 4-6 스크립트 restore 로 탈퇴 막힘 문구를 되돌린다.
-- 시행일 문장(이용약관 부칙·처리방침 머리)은 상수 c_effective_date 로 만든다(실행한 날이 아님). 당일 안에 다시 실행해도 지문이 같다.
-- 같은 [옛, 새] 쌍과 같은 계산으로 게시와 시행을 모두 하므로, 고지한 글과 시행일에 들어갈 글이 어긋나면 시행이 멈춘다.
-- 실행 순서: 10번 마이그레이션(2026-11-24) → 15번 마이그레이션 → 10번·15번 코드 배포 → 게시(publish_upcoming) → 팝업 켜기·이메일(12-10 안)
--   → 시행일 2027-01-11 새벽 apply(BEGIN … ROLLBACK 판으로 먼저 확인) → selfAnonymizeEnabled 켜기(런북 RB-11 10-2).
-- 사전 점검: 문서 3개 본문 md5, 동의 항목 terms·privacy 의 판·본문 md5, 탈퇴 정책 문구 세 줄이 아래 값과 다르면 아무것도 바꾸지 않고 멈춘다.
--   바꿀 문장은 각각 정확히 1번 있어야 한다. 'insert' 쌍은 옛 조각이 새 조각 안에 정확히 1번 들어 있어야 한다.
-- 문구의 보존 기간(…년)·일수(…일)는 문장 그대로 적고, VERIFY 가 DB 값(member_withdrawal_policy 의 …Years·…Days)과 대조한다.
--
-- c_confirmed_count·c_confirmed_members_md5 는 시행(apply) 직전에 대표가 재동의 대상 목록(실회원 포함, 30일 고지를 마친 목록)을
--   확인한 뒤 적는 값이다(기본 NULL — 시행 때 NULL 이면 멈춤. 게시·그만두기 때는 보지 않는다).
--   두 값은 아래 조회로 얻는다(회원 id 를 파일에 적지 않으려고 정렬한 id 목록의 md5 를 쓴다. 수가 같고 사람이 바뀐 경우도 잡는다):
--     SELECT count(*) AS n, md5(string_agg(p.id::text, ',' ORDER BY p.id)) AS m
--       FROM public.profiles p JOIN auth.users u ON u.id = p.id
--      WHERE NOT public.is_internal_admin_account(u.email) AND p.withdrawn_at IS NULL
--        AND ((p.provider = 'kakao' AND p.signup_completed IS TRUE) OR (p.provider IS DISTINCT FROM 'kakao' AND u.email_confirmed_at IS NOT NULL));
--   (consent_eligible_member_count() 와 같은 조건 — 사전 점검이 두 값이 같은지도 본다.)
--   시행 전까지 스위치(selfAnonymizeEnabled)를 켜지 않는다(고지 기간에는 잠금 트리거가 켜기를 막는다).
--
-- 재동의: terms·privacy 는 필수 항목이라 판이 오르면 기존 회원(관리자 내부 계정 제외)은 다음 접속 때 /consent 로 이동하고,
--   동의하기 전에는 충전·자료 구매 API 가 CONSENT_REQUIRED 로 막힌다(탈퇴·결제 내역·크레딧·문의·자료 보관함 화면은 막지 않음).
--   COMMIT 뒤의 확인 조회가 실행 방식에 맞는 값(게시: 상태·지문·변경 건수 / 시행: 새 판·재동의 대상 수·시행일)을 보여 준다.
-- 기록자: 대표(owner) 계정 중 가장 최근에 로그인한 계정(로그인한 적 없는 대표 계정이 기록자로 남지 않게. 사람 ID 를 파일에 적지 않음).
--
-- 처리방침 3절의 '분쟁 대응을 위해 회사가 보관하는 기록'(동의 기록·탈퇴 처리 기록·환불 연결 문의 5년·결제 시도 기록·비결제 문의)의
--   처리 근거와 기간, 탈퇴 처리 기록의 기산점(탈퇴일)은 변호사 확인 대상이다(계획 13절 2·3·4·7·17·19번). 게시 문서에는 내부 표시를 넣지 않는다.
--
-- 되돌리기:
--   (1) 약관 본문: 바꾸기 전 값은 admin_audit_log(action site_footer_save, details.bundle = 'bundle10_policy_text')의 details.before 에 남는다.
--       지금 본문이 이 스크립트 결과(details.after_md5)와 같을 때만 덮는다(그 뒤 관리자 화면에서 고친 본문을 몰래 지우지 않게).
--       탈퇴 정책 문구 세 줄도 지금 값이 이 스크립트 결과(member_withdrawal_policy_update 기록의 details.after)와 같을 때만 되돌린다.
--   BEGIN;
--   SET LOCAL lock_timeout = '3s';
--   DO $revert$
--   DECLARE a jsonb; w jsonb; f jsonb; p jsonb; n integer; j integer; v_actor uuid;
--   BEGIN
--     -- 12조②(크레딧 소멸)가 없는 약관으로 되돌리기 전에 탈퇴 경로가 꺼져 있어야 한다.
--     SELECT value INTO p FROM public.system_settings WHERE key = 'member_withdrawal_policy' FOR UPDATE;
--     IF (p -> 'selfAnonymizeEnabled') IS DISTINCT FROM 'false'::jsonb THEN
--       RAISE EXCEPTION 'REVERT: turn selfAnonymizeEnabled off first';
--     END IF;
--     SELECT details INTO a FROM public.admin_audit_log WHERE action = 'site_footer_save' AND details->>'bundle' = 'bundle10_policy_text'
--      ORDER BY created_at DESC LIMIT 1;
--     SELECT details INTO w FROM public.admin_audit_log WHERE action = 'member_withdrawal_policy_update' AND details->>'bundle' = 'bundle10_policy_text'
--      ORDER BY created_at DESC LIMIT 1;
--     SELECT value INTO f FROM public.system_settings WHERE key = 'site_footer_content' FOR UPDATE;
--     IF w IS NULL THEN RAISE EXCEPTION 'REVERT: policy text audit row missing'; END IF;
--     FOR j IN 0 .. jsonb_array_length(w -> 'changed_paths') - 1 LOOP
--       IF (p #>> ((w -> 'changed_paths' ->> j)::text[])) IS DISTINCT FROM (w -> 'after' ->> j) THEN
--         RAISE EXCEPTION 'REVERT: member_withdrawal_policy % changed after bundle10 script — merge by hand', w -> 'changed_paths' ->> j;
--       END IF;
--       p := jsonb_set(p, (w -> 'changed_paths' ->> j)::text[], w -> 'before' -> j);
--     END LOOP;
--     UPDATE public.system_settings SET value = p, updated_at = now() WHERE key = 'member_withdrawal_policy';
--     IF a IS NULL OR md5(f #>> '{policyDocuments,refundPolicy,content}') <> a #>> '{after_md5,refundPolicy}'
--        OR md5(f #>> '{policyDocuments,serviceTerms,content}') <> a #>> '{after_md5,serviceTerms}'
--        OR md5(f #>> '{policyDocuments,privacyPolicy,content}') <> a #>> '{after_md5,privacyPolicy}' THEN
--       RAISE EXCEPTION 'REVERT: documents changed after bundle10 script — merge by hand';
--     END IF;
--     UPDATE public.system_settings
--        SET value = jsonb_set(jsonb_set(jsonb_set(value,
--                      '{policyDocuments,refundPolicy,content}', a #> '{before,refundPolicy}'),
--                      '{policyDocuments,serviceTerms,content}', a #> '{before,serviceTerms}'),
--                      '{policyDocuments,privacyPolicy,content}', a #> '{before,privacyPolicy}'), updated_at = now()
--      WHERE key = 'site_footer_content';
--     GET DIAGNOSTICS n = ROW_COUNT;
--     IF n <> 1 THEN RAISE EXCEPTION 'REVERT: rows %', n; END IF;
--     SELECT p.id INTO v_actor FROM public.profiles p JOIN auth.users u ON u.id = p.id
--      WHERE p.is_admin IS TRUE AND p.admin_role = 'owner' AND u.last_sign_in_at IS NOT NULL ORDER BY u.last_sign_in_at DESC LIMIT 1;
--     PERFORM public.record_admin_audit(v_actor, 'site_footer_save', 'site_footer', 'site_footer_content', NULL, NULL,
--       '10번 약관 문구 되돌리기', jsonb_build_object('bundle', 'bundle10_policy_text_revert', 'restored_md5', a -> 'before_md5'), NULL);
--     PERFORM public.record_admin_audit(v_actor, 'member_withdrawal_policy_update', 'system_settings', 'member_withdrawal_policy', NULL, NULL,
--       '10번 탈퇴 안내 문구 되돌리기', jsonb_build_object('bundle', 'bundle10_policy_text_revert', 'changed_paths', w -> 'changed_paths'), NULL);
--     -- 15번 게시 행: 시행 뒤 되돌림을 표시한다('upcoming' 으로 돌리지 않는다. /terms/upcoming 이 '시행 뒤 되돌려짐'을 보인다).
--     UPDATE public.system_settings
--        SET value = value || jsonb_build_object('status', 'reverted', 'revertedAt', clock_timestamp()), updated_at = now()
--      WHERE key = 'policy_upcoming_documents' AND value ->> 'status' = 'applied';
--   END;
--   $revert$;
--   COMMIT;
--   (사본은 추가 전용이라 되돌린 본문도 새 사본으로 남음 — 정상.)
--   (2) 동의 항목: 판은 내릴 수 없다(판 원문은 추가 전용). 옛 문구로 되돌리려면 관리자 '가입 동의 항목'에서 옛 본문
--       (signup_consent_item_versions 의 version 1 행)으로 저장한다 — 판이 하나 더 오르고 회원이 한 번 더 다시 동의한다.
--   되돌리기 블록은 selfAnonymizeEnabled 가 켜져 있으면 멈춘다(먼저 끈다 — 12조②가 없는 상태에서 크레딧을 소멸시키면 안 됨).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $policy_text$
DECLARE
  -- 실행 방식: 'publish_upcoming'(게시) | 'apply'(시행) | 'withdraw_upcoming'(고지 그만두기). NULL 이면 멈춘다.
  c_mode constant text := NULL;
  -- 시행일·고지 마감일(이 날이 끝나기 전 KST 에 고지 시작)·시행을 실행할 수 있는 마지막 한국 날짜(기본은 시행일 당일만, 15번 13절 7번)
  c_effective_date constant date := DATE '2027-01-11';
  c_notice_deadline constant date := DATE '2026-12-10';
  c_apply_last_date constant date := DATE '2027-01-11';
  -- 다시 게시(지문이 다르거나 reverted 뒤)·고지 그만두기의 사유. 기본 NULL.
  c_republish_reason constant text := NULL;
  c_withdraw_reason constant text := NULL;

  -- 사전 md5(2026-11-24 운영 DB 에서 읽은 값 — 9번 문구 스크립트 적용 뒤)
  c_refund_md5 constant text := '158f11638e9a58121a9248dc48fbaeef';
  c_terms_md5 constant text := '75271f987f170878440049cc90c84284';
  c_privacy_md5 constant text := 'ddcc8ba57de67025076f12638edeee76';
  c_item_terms_md5 constant text := '1cd29468957ec6eb081b99c68d3973fc';
  c_item_privacy_md5 constant text := '65005b2b5dd7065e6c2fa7a503986c85';
  c_item_terms_version constant integer := 1;
  c_item_privacy_version constant integer := 1;
  -- 대표가 재동의 대상 목록을 확인한 뒤 적는 값(머리 주석의 조회 결과). 시행 때 NULL 이면 실행하지 않는다.
  c_confirmed_count constant integer := NULL;
  c_confirmed_members_md5 constant text := NULL;

  v_date text := to_char(c_effective_date, 'YYYY"년" FMMM"월" FMDD"일"');
  v_weekday text := (ARRAY['일', '월', '화', '수', '목', '금', '토'])[extract(dow FROM c_effective_date)::integer + 1];

  -- ── 이용약관: [옛 조각, 새 조각, 표시 이름, 표시 방식(replace|insert)] 쌍(각 옛 조각은 정확히 1번) ─────────────────────────
  t_pairs text[][];
  -- ── 취소/환불정책 ─────────────────────────────────────────────────────────────────────────────────
  r_pairs text[][];
  -- ── 개인정보처리방침 ──────────────────────────────────────────────────────────────────────────────
  p_pairs text[][];
  -- ── 가입 동의 항목 본문 ───────────────────────────────────────────────────────────────────────────
  it_pairs text[][];
  ip_pairs text[][];
  -- ── 탈퇴 정책 문구(member_withdrawal_policy.texts): [경로, old, new] — 회원이 동의하는 고지 원문·막힘 화면 ─────
  w_paths text[][];
  v_wpolicy jsonb;
  v_wpolicy_new jsonb;
  c_tickets_payer_old_prefix constant text := '1:1 문의는 소비자 불만·분쟁 처리 기록으로 마지막 처리일부터 ';
  v_check jsonb;
  v_member uuid;
  v_member_notice jsonb;
  v_checked integer;
  v_payer_ticket_hits integer;
  v_waudit_before integer;

  c_terms_note constant text := $q$이용약관 제12조(계약 해지와 탈퇴)를 바꿨습니다. 결제 이력이 있는 계정도 탈퇴 화면에서 탈퇴를 요청할 수 있고, 탈퇴하면 남은 크레딧(유료·무상)은 소멸하며 환불되지 않습니다. 다만 미성년자 결제 취소, 자료 하자 등 법령에 따른 환불은 탈퇴한 뒤에도 고객센터로 요청할 수 있습니다. 환불 기간이 남은 충전 건은 쓰지 않았으면 환불받거나 기간이 지난 뒤, 일부를 썼으면 기간이 지난 뒤 탈퇴할 수 있고, 환불 기간이 끝난 뒤 3일 동안은 탈퇴할 수 없습니다. 탈퇴하면 받지 않은 자료의 환불 몫도 소멸하고 구매한 자료를 내려받을 수 없습니다. 취소/환불정책에 '8-2. 회원 탈퇴와 크레딧'을 더했습니다.$q$;
  c_privacy_note constant text := $q$탈퇴한 뒤에도 결제 이력이 있으면 연락처(이메일·휴대폰번호·카카오 계정 이메일)·1:1 문의·동의 기록을, 탈퇴 처리 기록·결제 시도 기록이 남는 회원은 그 기록을 정한 기간 동안 분리 보관하도록 바꿨습니다. 법령에 따라 보존하는 기록과 분쟁 대응을 위해 회사가 보관하는 기록을 나눠 적었습니다(개인정보처리방침 1·2·3·6·7·10절). 결제 이력이 없어도 결제 시도 기록과 탈퇴할 때 보존에 동의한 문의는 정한 기간 동안 보관하며, 탈퇴 요청 기록을 새로 수집합니다. 이용 제한 기록·관리자 상담 메모(이용약관에 따른 처리, 탈퇴할 때 파기)와 관리자 작업 기록·관리자의 회원 연락처 열람 기록(기록한 날부터 2년, 탈퇴한 뒤에도 보관. 결제·크레딧·환불·탈퇴 처리 내역은 그 기록의 보관 기간이 끝날 때까지, 관련 기록이 없으면 2년)의 목적·항목·보유 기간을 새로 적었습니다.$q$;

  -- 옛 표현(VERIFY: 문서·동의 항목 어디에도 남지 않아야 함)
  c_old_phrases constant text[] := ARRAY['고객센터로 탈퇴를 요청해야 합니다', '결제를 시도한 기록 포함', '5년간 보존합니다',
                                         '2026년 11월 23일', '법령 보존 기록 제외', '계약·청약철회·대금결제 기록을 5년간'];

  -- 보존 기간·일수 대조: [대상(T 약관·R 환불·P 처리방침·I 동의 항목 본문·N 동의 변경 안내·X 탈퇴 막힘 문구), 정규식, 잡을 묶음 번호, 설정 키, 최소 건수]
  c_num_checks constant text[][] := ARRAY[
    ARRAY['PI', $r$마지막 거래일부터 ([0-9]+)년$r$, '1', 'paymentRetentionYears', '2'],
    ARRAY['PI', $r$분쟁 처리 기록\)(를| —) 마지막 처리일부터 ([0-9]+)년$r$, '2', 'payerTicketRetentionYears', '2'],
    ARRAY['PI', $r$환불 신청과 연결된 1:1 문의는 마지막 처리일부터 ([0-9]+)년$r$, '1', 'payerRefundTicketRetentionYears', '2'],
    ARRAY['PI', $r$보존에 동의한 경우에만 마지막 처리일부터 ([0-9]+)년$r$, '1', 'nonPayerTicketRetentionYears', '2'],
    ARRAY['PI', $r$개인정보를 지운 채 마지막 결제 시도일부터 ([0-9]+)년$r$, '1', 'attemptRecordRetentionYears', '2'],
    ARRAY['PI', $r$동의 기록(\([^)]*\))?은 탈퇴일부터 ([0-9]+)년$r$, '2', 'consentRecordRetentionYears', '2'],
    ARRAY['PI', $r$탈퇴 처리 기록\([^)]*\)은 탈퇴일부터 ([0-9]+)년$r$, '1', 'withdrawalRecordRetentionYears', '2'],
    ARRAY['T', $r$최근 ([0-9]+)일 안에 결제 시도가 있으면 ([0-9]+)일이 지난 뒤$r$, '1', 'selfWithdrawOrderQuietDays', '1'],
    ARRAY['T', $r$최근 ([0-9]+)일 안에 결제 시도가 있으면 ([0-9]+)일이 지난 뒤$r$, '2', 'selfWithdrawOrderQuietDays', '1'],
    ARRAY['TRNX', $r$기간이 끝난 뒤 ([0-9]+)일 동안$r$, '1', 'withdrawRefundDeadlineBufferDays', '5']
  ];

  v_policy jsonb;
  v_footer jsonb;
  v_footer_before jsonb;
  v_refund text;
  v_terms text;
  v_privacy text;
  v_refund_new text;
  v_terms_new text;
  v_privacy_new text;
  v_item_terms public.signup_consent_items%ROWTYPE;
  v_item_privacy public.signup_consent_items%ROWTYPE;
  v_item_age14_before public.signup_consent_items%ROWTYPE;
  v_item_marketing_before public.signup_consent_items%ROWTYPE;
  v_item_terms_content text;
  v_item_privacy_content text;
  v_save jsonb;
  v_actor uuid;
  v_snap_before integer;
  v_audit_before integer;
  v_count integer;
  v_ok_before integer;
  v_gated_after integer;
  v_eligible integer;
  v_text text;
  v_target text;
  v_num text;
  v_expected integer;
  v_notice text;
  i integer;

  -- 15번 게시 행(policy_upcoming_documents)
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_pub_old jsonb;
  v_pub_new jsonb;
  v_pub_texts jsonb;
  v_documents jsonb;
  v_consent_items jsonb;
  v_locked_paths jsonb;
  v_changes jsonb;
  v_changes_text text;
  v_pairs text[][];
  v_doc_key text;
  v_doc_before text;
  v_doc_after text;
  v_change_after text;
  v_doc_idx integer;
  v_cont jsonb;
  v_publish_kind text;
  v_chk_terms text;
  v_chk_refund text;
  v_chk_privacy text;
  v_chk_item_terms text;
  v_chk_item_privacy text;
  v_chk_wpolicy jsonb;

BEGIN
  -- 1. 상수 검사(첫날을 넣지 않고 30일을 채우는 규칙) ─────────────────────────────────────────────────────────
  IF c_mode IS NULL OR c_mode NOT IN ('publish_upcoming', 'apply', 'withdraw_upcoming') THEN
    RAISE EXCEPTION 'POLICY_TEXT: set c_mode to publish_upcoming, apply or withdraw_upcoming';
  END IF;
  IF NOT (c_notice_deadline <= c_effective_date - 32) OR NOT (c_apply_last_date >= c_effective_date) THEN
    RAISE EXCEPTION 'POLICY_TEXT: constants — notice deadline must be <= effective date - 32 and apply last date >= effective date';
  END IF;
  -- 시행은 한국 날짜가 c_effective_date ~ c_apply_last_date 일 때만
  IF c_mode = 'apply' AND NOT (v_today BETWEEN c_effective_date AND c_apply_last_date) THEN
    RAISE EXCEPTION 'POLICY_TEXT: apply runs only on % ~ % (KST today %)', c_effective_date, c_apply_last_date, v_today;
  END IF;
  PERFORM set_config('bundle15.policy_text_mode', c_mode, false);

  -- 2. 15번 마이그레이션(저장·판정 함수, 잠금 트리거 3개, 쓰기 막기 정책 2개) ─────────────────────────────────────
  IF to_regprocedure('public.save_site_notice_popup(uuid,integer,boolean,text,text,text,text,timestamp with time zone,timestamp with time zone)') IS NULL
     OR to_regprocedure('public.policy_upcoming_notice_continuity(date,date)') IS NULL
     OR (SELECT count(*) FROM pg_trigger t
          WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
            AND ((t.tgrelid = 'public.system_settings'::regclass AND t.tgname IN ('lock_policy_documents_during_notice', 'lock_withdrawal_texts_during_notice'))
              OR (t.tgrelid = 'public.signup_consent_items'::regclass AND t.tgname = 'lock_consent_items_during_notice'))) <> 3 THEN
    RAISE EXCEPTION 'POLICY_TEXT: bundle 15 migration (functions/triggers) not applied';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings' AND permissive = 'RESTRICTIVE' AND policyname IN ('system_settings_site_notice_popup_no_client_write', 'system_settings_policy_upcoming_documents_no_client_write')) <> 2 THEN
    RAISE EXCEPTION 'POLICY_TEXT: bundle 15 migration (policies) not applied';
  END IF;

  -- 고지 그만두기: 게시 행 'upcoming' → 'reverted'(시행 전이라 appliedAt 은 null)
  IF c_mode = 'withdraw_upcoming' THEN
    IF c_withdraw_reason IS NULL OR btrim(c_withdraw_reason) = '' THEN
      RAISE EXCEPTION 'POLICY_TEXT: c_withdraw_reason required to withdraw the upcoming notice';
    END IF;
    SELECT value INTO v_pub_old FROM public.system_settings WHERE key = 'policy_upcoming_documents' FOR UPDATE;
    IF v_pub_old IS NULL OR (v_pub_old ->> 'status') IS DISTINCT FROM 'upcoming' THEN
      RAISE EXCEPTION 'POLICY_TEXT: no upcoming publication to withdraw (status %)', v_pub_old ->> 'status';
    END IF;
    SELECT p.id INTO v_actor FROM public.profiles p JOIN auth.users u ON u.id = p.id
     WHERE p.is_admin IS TRUE AND p.admin_role = 'owner' AND u.last_sign_in_at IS NOT NULL
     ORDER BY u.last_sign_in_at DESC LIMIT 1;
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'POLICY_TEXT: signed-in owner account not found';
    END IF;
    UPDATE public.system_settings
       SET value = v_pub_old || jsonb_build_object('status', 'reverted', 'revertedAt', clock_timestamp()), updated_at = now()
     WHERE key = 'policy_upcoming_documents';
    PERFORM public.record_admin_audit(v_actor, 'policy_upcoming_withdraw', 'system_settings', 'policy_upcoming_documents', NULL, NULL,
      c_withdraw_reason,
      jsonb_build_object('bundle', 'bundle15_policy_upcoming', 'reason', c_withdraw_reason,
        'published_at', v_pub_old -> 'publishedAt',
        'documents_sha256', (SELECT jsonb_object_agg(d ->> 'key', d ->> 'sha256') FROM jsonb_array_elements(v_pub_old -> 'documents') d),
        'changes_sha256', (SELECT jsonb_object_agg(d ->> 'key', d ->> 'changesSha256') FROM jsonb_array_elements(v_pub_old -> 'documents') d),
        'consent_sha256', (SELECT jsonb_object_agg(c ->> 'key', c ->> 'sha256') FROM jsonb_array_elements(v_pub_old -> 'consentItems') c)),
      NULL);
    RAISE NOTICE 'POLICY_TEXT OK: upcoming notice withdrawn';
    RETURN;
  END IF;

  -- 3. 10번 DB 가 적용돼 있고 스위치가 꺼져 있어야 한다(게시·시행). 처리 대기 탈퇴 요청·대표 확인 값은 시행 때만 본다. ──────────────
  IF to_regclass('public.withdrawn_member_records') IS NULL
     OR to_regprocedure('public.member_withdrawal_notice_text(text,jsonb,boolean)') IS NULL THEN
    RAISE EXCEPTION 'POLICY_TEXT: bundle 10 migration not applied';
  END IF;
  SELECT value INTO v_policy FROM public.system_settings WHERE key = 'member_withdrawal_policy';
  IF v_policy IS NULL THEN
    RAISE EXCEPTION 'POLICY_TEXT: member_withdrawal_policy missing';
  END IF;
  IF (v_policy -> 'selfAnonymizeEnabled') IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'POLICY_TEXT: selfAnonymizeEnabled must be false before this script (now %)', v_policy -> 'selfAnonymizeEnabled';
  END IF;
  IF c_mode = 'apply' THEN
    IF EXISTS (SELECT 1 FROM public.member_withdrawal_requests r WHERE r.status = 'pending') THEN
      RAISE EXCEPTION 'POLICY_TEXT: pending withdrawal request exists (notice text would change terms version)';
    END IF;

    -- 01-11 처리방침이 설명하는 기능이 운영에 있어야 한다: 12번 이용 제한·상담 메모 표와 탈퇴 때 지우는 profiles 트리거,
    --   12번 메모 가림 함수 redact_member_admin_note, 13번 연락처 열람 기록 표·기록 함수. 없으면 시행하지 않고 시행일을 미룬다(지문과 무관한 점검).
    IF to_regclass('public.member_suspensions') IS NULL OR to_regclass('public.member_admin_notes') IS NULL
       OR to_regclass('public.admin_member_access_log') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_proc f WHERE f.proname = 'record_admin_member_access' AND f.pronamespace = 'public'::regnamespace)
       OR NOT EXISTS (SELECT 1 FROM pg_proc f WHERE f.proname = 'redact_member_admin_note' AND f.pronamespace = 'public'::regnamespace)
       OR NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc f ON f.oid = t.tgfoid
                       WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal AND t.tgenabled = 'O'
                         AND f.prosrc LIKE '%member_suspensions%' AND f.prosrc LIKE '%member_admin_notes%') THEN
      RAISE EXCEPTION 'POLICY_TEXT: bundle 12/13 objects missing (member_suspensions, member_admin_notes, withdrawal trigger, redact_member_admin_note, admin_member_access_log, record_admin_member_access) — 시행일을 미룬다';
    END IF;

    -- 시행일 직전 확인: 재동의 대상 목록 = 대표가 확인한 목록
    IF c_confirmed_count IS NULL OR c_confirmed_members_md5 IS NULL THEN
      RAISE EXCEPTION 'POLICY_TEXT: owner confirmation not recorded — 대표가 재동의 대상 계정을 확인하고 c_confirmed_count·c_confirmed_members_md5 를 넣은 뒤 실행';
    END IF;
    SELECT count(*), md5(string_agg(p.id::text, ',' ORDER BY p.id)) INTO v_count, v_text
      FROM public.profiles p JOIN auth.users u ON u.id = p.id
     WHERE NOT public.is_internal_admin_account(u.email) AND p.withdrawn_at IS NULL
       AND ((p.provider = 'kakao' AND p.signup_completed IS TRUE) OR (p.provider IS DISTINCT FROM 'kakao' AND u.email_confirmed_at IS NOT NULL));
    IF v_count IS DISTINCT FROM c_confirmed_count OR v_text IS DISTINCT FROM c_confirmed_members_md5
       OR public.consent_eligible_member_count() IS DISTINCT FROM v_count THEN
      RAISE EXCEPTION 'POLICY_TEXT: consent-eligible members changed since owner confirmation (now % / %, confirmed % / %) — 대표가 목록을 다시 확인',
        v_count, v_text, c_confirmed_count, c_confirmed_members_md5;
    END IF;

    -- 4. 고지가 끊김 없이 이어졌는지(마이그레이션의 판정 함수 하나로 판정, 시행일·마감일 상수는 게시 행 값과 대조)
    --    팝업 행을 먼저 잠근다: 판정 뒤 COMMIT 전에 다른 거래가 팝업을 저장(끄기 등)하지 못하게(저장 함수도 같은 행을 FOR UPDATE).
    PERFORM 1 FROM public.system_settings WHERE key = 'site_notice_popup' FOR UPDATE;
    v_cont := public.policy_upcoming_notice_continuity(c_effective_date, c_notice_deadline);
    IF (v_cont -> 'ok') IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION 'POLICY_TEXT: notice continuity failed (%)', v_cont ->> 'reason';
    END IF;
  END IF;

  -- 기록자: 가장 최근에 로그인한 대표 계정(사람 ID 를 파일에 적지 않음)
  SELECT p.id INTO v_actor FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.is_admin IS TRUE AND p.admin_role = 'owner' AND u.last_sign_in_at IS NOT NULL
   ORDER BY u.last_sign_in_at DESC LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'POLICY_TEXT: signed-in owner account not found';
  END IF;

  -- ── 문구 ──────────────────────────────────────────────────────────────────────────────────────────
  t_pairs := ARRAY[
    -- 12조 전체(①②③ → ①~④)
    ARRAY[concat_ws(E'\n',
            $q$① 회원은 언제든지 서비스 화면에서 탈퇴할 수 있습니다. 결제 이력(결제를 시도한 기록 포함)이 있는 계정은 관련 법령에 따른 기록 보존 때문에 고객센터로 탈퇴를 요청해야 합니다.$q$,
            $q$② 탈퇴 시 개인정보는 개인정보처리방침에 따라 처리되고, 남은 크레딧과 환불은 취소/환불정책을 따릅니다.$q$,
            $q$③ 회원이 이 약관을 중대하게 어기면 회사는 이용 계약을 해지할 수 있습니다.$q$),
          concat_ws(E'\n',
            $q$① 회원은 언제든지 마이페이지의 회원 탈퇴 화면에서 탈퇴할 수 있습니다.$q$,
            $q$- 결제 이력이 없는 계정(결제창만 열고 결제를 마치지 않은 계정 포함)은 그 화면에서 바로 탈퇴됩니다. 다만 최근 7일 안에 결제 시도가 있으면 7일이 지난 뒤 탈퇴할 수 있습니다.$q$,
            $q$- 결제 이력이 있는 계정(결제가 승인됐거나 승인 뒤 취소·환불된 계정, 검증에 실패한 결제 통보처럼 결제가 됐을 수 있는 기록이 있는 계정 포함)은 그 화면에서 탈퇴를 요청합니다. 회사는 확인한 뒤 요청일부터 10일 안에 처리하고 가입한 이메일로 결과를 알립니다.$q$,
            $q$- 진행 중인 결제·결제 취소·환불이 있으면 그 처리가 끝난 뒤 탈퇴할 수 있습니다. 보관할 문의 기록을 회사가 확인해야 하면 확인을 마친 뒤 10일 안에 이메일로 알리고, 결제 이력이 없어도 결제 결과를 확인해야 하는 주문이 있으면 회사가 가입한 이메일로 탈퇴 요청을 받아 10일 안에 처리합니다. 회사가 탈퇴를 바로 처리하지 못하면 10일 안에 그 사유와 처리할 수 있는 날을 이메일로 알립니다.$q$,
            $q$- 탈퇴 화면을 이용할 수 없으면 고객센터(이메일·전화)로 탈퇴를 요청할 수 있습니다. 법정대리인이나 위임받은 대리인도 요청할 수 있으며, 회사는 본인 또는 대리 권한을 확인한 뒤 처리합니다.$q$,
            $q$② 탈퇴하면 남은 크레딧(유료 충전 크레딧, 자료 환불로 다시 받은 크레딧, 무상 크레딧)은 소멸하며 환불되지 않습니다. 회사는 탈퇴 전에 소멸할 크레딧과 유료 크레딧의 원 환산 금액(취소/환불정책 8절의 계산식)을 알리고 동의를 받습니다. 남은 크레딧은 탈퇴 전에 쓸 수 있습니다. 환불 기간이 남은 유료 충전 건이 있으면 쓰지 않은 건은 환불받거나 환불 기간이 지난 뒤, 일부를 쓴 건은 환불 기간이 지난 뒤 탈퇴할 수 있으며, 환불 기간 마지막 날이 휴일인지 등을 확인하기 위해 기간이 끝난 뒤 3일 동안은 탈퇴할 수 없습니다. 미성년자 결제 취소, 자료 하자, 표시·광고와 다른 제공처럼 법령에 따른 환불은 탈퇴한 뒤에도 고객센터로 요청할 수 있으며, 원래 결제수단이나 결제자 명의 계좌로 처리합니다. 자세한 기준은 취소/환불정책 8-2절을 따릅니다.$q$,
            $q$③ 탈퇴하면 구매한 자료를 더 이상 내려받을 수 없고, 작성한 후기·추천은 삭제되며, 답변을 기다리던 1:1 문의는 닫힙니다(결제 이력이 없는 회원이 보존에 동의하지 않은 문의는 삭제). 받지 않은 자료의 환불(취소/환불정책 3-2절 ①)은 탈퇴 전에 신청해야 하며, 탈퇴하면 그 환불 몫도 남은 크레딧과 함께 소멸합니다. 같은 이메일이나 카카오 계정으로 다시 가입해도 새 계정이 되며 크레딧·구매 내역·문의 내역은 이어지지 않습니다. 탈퇴 뒤 개인정보와 기록의 보관·파기는 개인정보처리방침에 따릅니다.$q$,
            $q$④ 회원이 이 약관을 중대하게 어기면 회사는 이용 계약을 해지할 수 있습니다.$q$),
          '제12조(계약 해지와 탈퇴)', 'replace'],
    -- 부칙 시행일
    ARRAY[$q$이 약관은 2026년 11월 23일부터 시행합니다.$q$,
          '이 약관은 ' || v_date || '부터 시행합니다.',
          '부칙 시행일', 'replace']
  ];

  r_pairs := ARRAY[
    -- 새 절 8-2(8절 다음, 9절 앞)
    ARRAY[E'\n\n## 9. 부정 결제 및 악용 방지',
          E'\n\n' || concat_ws(E'\n',
            $q$## 8-2. 회원 탈퇴와 크레딧$q$,
            $q$① 회원이 탈퇴하면 남은 크레딧(유료 충전 크레딧, 자료 환불로 다시 받은 크레딧, 무상 크레딧)은 소멸하며 환불되지 않습니다. 회사는 탈퇴 전에 소멸할 크레딧과, 유료 크레딧을 8절의 식으로 계산한 원 환산 금액을 알리고 동의를 받습니다. 자료 환불로 다시 받은 크레딧은 원래 충전분으로 계산합니다. 받지 않은 자료의 환불(3-2절 ①)은 탈퇴 전에 신청해야 하며, 탈퇴하면 그 환불 몫도 함께 소멸합니다.$q$,
            $q$② 단순 변심에 따른 환불 기간(3절 ①)이 남은 유료 충전 건이 있으면, 쓰지 않은 건은 환불받거나 환불 기간이 지난 뒤, 일부를 쓴 건은 환불 기간이 지난 뒤 탈퇴할 수 있습니다. 환불 기간 마지막 날이 휴일인지 등을 확인하기 위해 기간이 끝난 뒤 3일 동안은 탈퇴할 수 없습니다. 마지막 날이 휴일이면 법에 따라 기간이 휴일이 끝난 다음 날까지 늘어나며, 그 기간에는 고객센터로 환불을 요청할 수 있습니다.$q$,
            $q$③ 진행 중인 결제 취소·환불이 있으면 그 처리가 끝난 뒤 탈퇴할 수 있습니다.$q$,
            $q$④ 미성년자 결제 취소(7절), 하자가 있거나 소개 내용과 다른 자료(3-2절 ④), 표시·광고나 계약 내용과 다르게 제공된 경우(3절 ④)처럼 법령에 따른 환불은 탈퇴한 뒤에도 고객센터로 요청할 수 있습니다. 탈퇴한 회원에게는 크레딧으로 돌려드릴 수 없으므로 원 결제수단이나 결제자 명의 계좌로 처리합니다. 5절·8절의 '회원이 지정한 본인 명의 계좌'와 달리, 법정대리인 등 회원이 아닌 사람이 결제한 경우에는 그 결제자 명의 계좌로 환불합니다.$q$
          ) || E'\n\n## 9. 부정 결제 및 악용 방지',
          '8-2. 회원 탈퇴와 크레딧(신설)', 'insert']
  ];

  -- 1·2·3·10절에는 12번(이용 제한·관리자 상담 메모)·13번(관리자 작업 기록·관리자의 회원 연락처 열람 기록) 내용도 함께 넣는다(2026-11-26 대표 결정, 12번 Q9 (가)).
  --   근거: docs/plan-bundle12-member-suspension.md 4-2·4-3·4-4, docs/plan-bundle13-cs-tools.md 4-1·8절. 보존 2년은 13번 Q5 (가) — 시행(apply) 때 12·13번 객체가 없으면 멈추고(3절 객체 점검), 'support_page_content.admin.accessLogRetentionYears' 와 대조한다(5-0 보관 기간 대조).
  p_pairs := ARRAY[
    -- 머리 시행일
    ARRAY[$q$시행일: 2026년 11월 23일$q$, '시행일: ' || v_date, '시행일', 'replace'],
    -- 1절 목적 한 줄 추가
    ARRAY[$q$- 고객 문의·환불 요청·권리침해 신고 처리, 미성년자 결제 취소 확인$q$,
          $q$- 고객 문의·환불 요청·권리침해 신고 처리, 미성년자 결제 취소 확인$q$ || E'\n' ||
          $q$- 회원 탈퇴 처리와 처리 결과 안내, 탈퇴 뒤 분쟁 대응과 법령에 따른 환불 연락$q$ || E'\n' ||
          $q$- 부정 이용 방지를 위한 이용 제한(이용 제한·로그인 차단)과 이의 처리, 고객 응대 내용 기록(관리자 상담 메모)$q$ || E'\n' ||
          $q$- 개인정보 오남용 방지와 부정 이용 확인을 위한 관리자 작업 기록과 관리자의 회원 연락처 열람 기록 관리$q$,
          '1절 처리 목적(추가)', 'insert'],
    -- 2절 항목 한 줄 추가(14절 11번)
    ARRAY[$q$- 권리침해 신고: 신고인의 이름·연락처, 권리 증빙, 신고 내용$q$,
          $q$- 권리침해 신고: 신고인의 이름·연락처, 권리 증빙, 신고 내용$q$ || E'\n' ||
          $q$- 회원 탈퇴: 탈퇴 요청 기록(접수 경로, 요청자 구분(본인·법정대리인·위임 대리인), 접수·안내·회신 일시, 본인 확인 방법과 결과), 회원에게 보여 주거나 보낸 탈퇴 안내 원문, 소멸 크레딧 내역, 1:1 문의 보존 선택, 대리인이 요청한 경우 대리인의 이름·연락처와 위임 확인 자료$q$ || E'\n' ||
          $q$- 이용 제한: 제한 범위(이용 제한·로그인 차단, 다운로드 차단 여부), 사유 분류, 회원에게 알린 사유, 내부 메모, 시작·종료 일시, 해제 일시와 사유, 알림 수단·일시·내용 요약, 회원이 안내 화면을 처음 연 일시, 처리한 관리자$q$ || E'\n' ||
          $q$- 관리자 상담 메모: 회원 응대 중 확인한 사실과 처리 내용, 작성한 관리자, 작성·삭제 일시, 가림 처리 일시·처리한 관리자(삭제한 메모도 탈퇴할 때까지 보관)$q$ || E'\n' ||
          $q$- 관리자 작업 기록: 처리한 관리자, 처리 일시, 대상 회원(회원 식별 번호), 처리 내용과 사유(일부 작업은 관리자의 접속 IP·기기 정보)$q$ || E'\n' ||
          $q$- 관리자의 회원 연락처 열람 기록(회원의 이메일·휴대폰 번호를 보여 주는 관리자 화면을 열 때): 열람한 관리자, 열람 일시, 대상 회원(회원 식별 번호), 열람한 화면과 항목, 화면 정보(관련 문의 번호·쪽 등), 열람 사유(적은 경우), 관리자의 접속 IP·기기 정보$q$,
          '2절 수집 항목(회원 탈퇴·이용 제한·상담 메모·관리자 기록 추가)', 'insert'],
    -- 3절 보유 기간(첫 세 문장 → 결제 여부별 목록)
    ARRAY[concat_ws(E'\n',
            $q$회사는 회원이 탈퇴하면 개인정보를 지체 없이 파기합니다. 다만 결제 이력이 있는 경우 전자상거래 등에서의 소비자보호에 관한 법률에 따라 계약·청약철회·대금결제 및 재화 등의 공급에 관한 기록(주문자 이메일·휴대폰 번호, 주문·결제·환불 내역)을 5년간 보존합니다.$q$,
            $q$선택 동의한 마케팅 정보 수신(이메일·휴대폰 번호)은 탈퇴하거나 동의를 철회할 때까지 이용합니다.$q$,
            $q$환불 계좌, 미성년자 결제 취소 확인 자료, 권리침해 신고 자료는 처리를 마치면 지체 없이 파기하고, 환불·취소 처리 내역은 위 결제 기록과 함께 5년간 보존합니다.$q$),
          concat_ws(E'\n',
            $q$회원이 탈퇴하면 개인정보를 지체 없이 파기합니다. 다만 아래 '법령에 따라 보존하는 기록'과 '분쟁 대응을 위해 회사가 보관하는 기록'은 정한 기간 동안 다른 개인정보와 분리해 보관한 뒤 파기하며, 거기에 적은 목적 외에는 쓰지 않습니다. 탈퇴 뒤에도 남는 그 밖의 기록은 '그 밖의 보유와 파기'에 적습니다.$q$,
            $q$### 법령에 따라 보존하는 기록$q$,
            $q$- 결제 이력이 있는 회원의 계약·청약철회·대금결제·재화 공급에 관한 기록(전자상거래 등에서의 소비자보호에 관한 법률 제6조, 같은 법 시행령 제6조): 주문자 이메일, 회원정보의 휴대폰 번호, 카카오 계정 이메일, 결제 때 입력한 휴대폰 번호(다른 결제 요청 값과 함께 해시 값으로 바꿔 보관하며, 회사가 다른 기록과 대조하면 알아볼 수 있는 값입니다), 주문·결제(실패·만료된 결제 시도 포함)·환불 내역, 결제 전 확인 동의, 크레딧 충전·사용·소멸 내역, 자료 구매·이용 권한·구매 고지 동의·다운로드 기록(다운로드 때의 접속 IP·기기 정보는 지움) — 마지막 거래일부터 5년$q$,
            $q$- 결제 이력이 있는 회원의 1:1 문의(제목·내용·답변·수정 이력. 같은 법 시행령 제6조의 소비자 불만·분쟁 처리 기록) — 마지막 처리일부터 3년$q$,
            $q$위 기록은 분쟁 대응, 법령에 따른 환불, 탈퇴·광고성 정보 수신 동의 철회 처리 결과 안내에만 씁니다.$q$,
            $q$### 분쟁 대응을 위해 회사가 보관하는 기록$q$,
            $q$아래 기록은 법령상 보존 의무가 있는 기록이 아니며, 탈퇴·동의·결제 사실을 확인하고 분쟁에 대응하기 위해 보관합니다. 근거는 줄마다 적습니다(회사의 정당한 이익은 개인정보 보호법 제15조제1항제6호).$q$,
            $q$- 동의 기록(결제 이력이 있는 회원의 가입·개인정보·마케팅 동의 기록, 목적: 동의 사실 확인)은 탈퇴일부터 5년(근거: 회사의 정당한 이익)$q$,
            $q$- 탈퇴 처리 기록(탈퇴 요청 기록, 회원이 확인한 탈퇴 안내 원문, 소멸 크레딧 내역, 처리 일시, 목적: 탈퇴와 크레딧 소멸 동의 사실 확인)은 탈퇴일부터 5년(근거: 회사의 정당한 이익)$q$,
            $q$- 결제 이력이 있는 회원의 환불 신청과 연결된 1:1 문의는 마지막 처리일부터 5년(근거: 회사의 정당한 이익, 목적: 환불 기록과 함께 분쟁 확인)$q$,
            $q$- 결제 이력이 없는 회원의 결제를 마치지 않은 결제 시도 기록(주문번호·금액·결제 진행 기록, 목적: 늦게 도착한 결제 확인과 환불)은 개인정보를 지운 채 마지막 결제 시도일부터 5년(근거: 회사의 정당한 이익)$q$,
            $q$- 결제 이력이 없는 회원의 1:1 문의는 탈퇴할 때 보존에 동의한 경우에만 마지막 처리일부터 3년(근거: 회원의 동의, 목적: 분쟁 확인. 동의하지 않으면 탈퇴와 함께 삭제)$q$,
            $q$### 그 밖의 보유와 파기$q$,
            $q$탈퇴 뒤 위 기록이 하나도 남지 않는 회원은 탈퇴할 때 회원 정보와 로그인 계정을 모두 삭제합니다. 위 기록이 남는 회원의 로그인 계정은 이메일 등을 해시 값으로 바꾼 가명 상태로 로그인을 막아 두었다가 보관 기간이 끝나면 삭제합니다.$q$,
            $q$카카오 로그인 회원이 탈퇴하면 회사는 카카오에 연결 끊기를 요청하며, 연결 끊기를 마칠 때까지만 카카오 회원번호를 보관합니다.$q$,
            $q$이메일로 받은 탈퇴 요청 메일과, 대리인이 요청한 경우 대리인의 이름·연락처와 위임·본인 확인 자료는 처리 결과를 알린 뒤 지체 없이 파기합니다.$q$,
            $q$이용 제한 기록과 관리자 상담 메모(삭제한 메모 포함)는 탈퇴할 때까지 보관하고(근거: 이용약관 제9조 등에 따른 이용 계약의 이행, 개인정보 보호법 제15조제1항제4호. 삭제한 메모는 처리 사실 확인을 위한 회사의 정당한 이익, 같은 법 제15조제1항제6호), 탈퇴하면 지체 없이 파기합니다. 관리자 상담 메모에 적지 말아야 할 개인정보가 적힌 경우 그 메모의 글을 가림 처리합니다. 다만 아래 관리자 작업 기록에는 이용 제한 조치 내역(제한 범위·다운로드 차단 여부·사유 분류·기간·알림 수단, 처리한 관리자와 일시)과 상담 메모를 쓰고 지운 사실(관리자와 일시)이 남으며, 회원에게 알린 사유·내부 메모·해제 사유·알림 내용 요약·상담 메모의 글은 남기지 않고 글자 수만 남깁니다.$q$,
            $q$관리자 작업 기록(회원에 관한 처리의 내용·사유·처리자·일시)과 관리자의 회원 연락처 열람 기록은 개인정보의 안전성 확보(개인정보 보호법 제29조, 같은 법 제15조제1항제2호)와 부정 이용 확인(회사의 정당한 이익, 같은 법 제15조제1항제6호)을 위해 기록한 날부터 2년 동안 보관한 뒤 파기하며, 회원이 탈퇴한 뒤에도 이 기간 동안 남습니다. 다만 결제·크레딧·환불·탈퇴 처리에 관한 관리자 처리 내역(관리자 결제 처리 기록 포함)은 위 결제 기록·탈퇴 처리 기록의 보관 기간이 끝날 때까지(관련 기록이 없으면 기록한 날부터 2년) 보관합니다. 열람 기록에는 회원의 이메일·휴대폰 번호를 남기지 않고 회원 식별 번호로 기록합니다.$q$,
            $q$선택 동의한 마케팅 정보 수신(이메일·휴대폰 번호)은 동의를 철회하거나 탈퇴할 때까지 이용합니다. 탈퇴 요청을 접수하면 그때 바로 철회하며, 요청을 취소해도 다시 동의한 것으로 보지 않습니다.$q$,
            $q$환불 계좌, 미성년자 결제 취소 확인 자료, 권리침해 신고 자료는 처리를 마치면 지체 없이 파기하고(1:1 문의·환불 기록에 적힌 경우 그 부분을 가립니다), 환불·취소 처리 내역은 위 결제 기록과 함께 보관합니다.$q$),
          '3절 보유 기간', 'replace'],
    -- 6절 Supabase 보유 기간
    ARRAY[$q$- 보유 기간: 회원 탈퇴 시까지(법령 보존 기록 제외, 백업은 업체 보존 주기가 지나면 삭제)$q$,
          $q$- 보유 기간: 회원 탈퇴 시까지(탈퇴 뒤에도 보관하는 기록은 3절의 기간이 끝날 때까지, 백업은 업체 보존 주기가 지나면 삭제)$q$,
          '6절 국외 이전(Supabase 보유 기간)', 'replace'],
    -- 7절 10일 안 처리·통지와 이의제기(개인정보 보호법 38조④, 시행령 43조 — 계획 3절 막힘 화면의 이의제기 안내가 가리키는 곳)
    ARRAY[$q$회사는 본인 확인 후 지체 없이 조치합니다. 법령상 보존해야 하는 정보는 삭제가 제한될 수 있습니다.$q$,
          $q$회사는 본인 확인 후 지체 없이 조치합니다. 법령상 보존해야 하는 정보는 삭제가 제한될 수 있습니다. 회사가 탈퇴·삭제 요청을 바로 처리하지 못하면 요청을 받은 날부터 10일 안에 처리하거나, 처리할 수 없는 사유와 가능 예정일, 이의제기 방법을 알립니다. 처리 결과에 이의가 있으면 아래 개인정보 보호책임자나 고객센터로 이의를 제기할 수 있습니다.$q$,
          '7절 정보주체의 권리와 행사 방법(처리 기한·이의제기)', 'replace'],
    -- 10절 분리 보관 기록 접근 통제(read_withdrawn_member_record·read_withdrawn_member_ticket: 대표만, 열람 사유·기록)
    ARRAY[$q$접근 권한 관리와 관리자 권한 제한, 전송 구간 암호화(HTTPS), 비밀번호 암호화 저장, 관리자 작업 기록, 보안 업데이트 등의 조치를 합니다.$q$,
          $q$접근 권한 관리와 관리자 권한 제한, 전송 구간 암호화(HTTPS), 비밀번호 암호화 저장, 관리자 작업 기록, 보안 업데이트 등의 조치를 합니다. 탈퇴 뒤 분리 보관한 연락처와 탈퇴 회원의 1:1 문의는 대표만 열람할 수 있으며, 열람할 때마다 사유와 기록을 남깁니다. 회원의 이메일·휴대폰 번호를 보여 주는 관리자 화면을 열면 열람한 관리자, 일시, 대상 회원, 화면, 열람 항목, 접속 IP·기기를 기록하고, 이 기록을 월 1회 이상 점검합니다. 관리자 작업 기록에는 처리한 관리자와 일시를 남기며, 일부 작업은 접속 IP·기기도 함께 남깁니다.$q$,
          '10절 안전성 확보 조치(분리 보관 기록 열람·연락처 열람 기록)', 'replace']
  ];

  it_pairs := ARRAY[
    ARRAY[$q$- 학습 자료를 크레딧으로 구매하고 내려받는 서비스입니다. 크레딧은 미리 충전해 쓰며, 사용 기한과 환불 기준은 이용약관과 취소·환불 정책을 따릅니다.$q$,
          $q$- 학습 자료를 크레딧으로 구매하고 내려받는 서비스입니다. 크레딧은 미리 충전해 쓰며, 사용 기한과 환불 기준은 이용약관과 취소·환불 정책을 따릅니다.$q$ || E'\n' ||
          $q$- **탈퇴하면 남은 크레딧(유료·무상)은 소멸하며 환불되지 않습니다.** 다만 미성년자 결제 취소, 자료 하자 등 법령에 따른 환불은 탈퇴한 뒤에도 고객센터로 요청할 수 있습니다. 환불 기간이 남은 충전 건은 쓰지 않았으면 환불받거나 기간이 지난 뒤, 일부를 썼으면 기간이 지난 뒤 탈퇴할 수 있고, 환불 기간이 끝난 뒤 3일 동안은 탈퇴할 수 없습니다(이용약관 제12조).$q$,
          '탈퇴와 크레딧(추가)', 'insert']
  ];

  ip_pairs := ARRAY[
    ARRAY[$q$**보유·이용 기간: 탈퇴 시 지체 없이 파기합니다. 단, 결제 이력이 있는 경우 전자상거래법에 따라 계약·청약철회·대금결제 기록을 5년간 보존합니다.**$q$,
          $q$**보유·이용 기간: 탈퇴 시 지체 없이 파기합니다. 다만 결제 이력이 있으면 전자상거래법 제6조에 따라 주문·결제·환불·크레딧·자료 구매 기록과 이메일·휴대폰번호·카카오 계정 이메일을 마지막 거래일부터 5년, 1:1 문의(소비자 불만·분쟁 처리 기록)를 마지막 처리일부터 3년 동안 분리 보관한 뒤 파기합니다.**$q$ || E'\n' ||
          $q$이와 별도로 회사는 분쟁 대응을 위해 다음 기록을 보관합니다(법령상 보존 의무가 아니라 회사의 정당한 이익에 따른 보관으로, 이 동의와 별개입니다). 결제 이력이 있는 회원의 동의 기록은 탈퇴일부터 5년, 환불 신청과 연결된 1:1 문의는 마지막 처리일부터 5년, 탈퇴 처리 기록(탈퇴 안내 원문·소멸 크레딧 내역)은 탈퇴일부터 5년, 결제 이력이 없는 회원의 결제 시도 기록은 개인정보를 지운 채 마지막 결제 시도일부터 5년 보관합니다. 결제 이력이 없는 회원의 1:1 문의는 탈퇴할 때 보존에 동의한 경우에만 마지막 처리일부터 3년 보관합니다. 자세한 내용은 개인정보처리방침 3절을 따릅니다.$q$ || E'\n' ||
          -- 12·13번 기록(2026-11-26): 이용 제한·상담 메모는 이용약관 제9조·고객 응대(계약 이행), 관리자 기록은 안전성 확보(법 제29조)로 처리해
          --   이 동의의 범위에 넣지 않고 '이 동의와 별개'로 적는다(수집 항목 줄에 넣으면 동의가 근거인 것처럼 읽히기 때문). 목적·항목은 처리방침 1·2절과 같다.
          $q$이용약관에 따른 이용 제한(제9조)과 고객 응대를 위해 이용 제한 기록(제한 범위·사유·기간·알림·해제)과 관리자 상담 메모를 처리하며, 탈퇴할 때 파기합니다. 또 개인정보 보호법에 따른 안전성 확보와 부정 이용 확인을 위해 관리자 작업 기록(이용 제한 조치 내역 포함)과 관리자의 회원 연락처 열람 기록을 기록한 날부터 2년 보관하며, 탈퇴한 뒤에도 이 기간 동안 남습니다. 다만 결제·크레딧·환불·탈퇴 처리에 관한 관리자 처리 내역은 결제 기록·탈퇴 처리 기록의 보관 기간이 끝날 때까지(관련 기록이 없으면 기록한 날부터 2년) 보관합니다. 이 두 가지는 이 동의와 별개인 처리이며, 자세한 내용은 개인정보처리방침 2·3절을 따릅니다.$q$,
          '보유·이용 기간', 'replace'],
    -- 수집 항목 줄 추가(15번 4-3: 변경 안내의 '탈퇴 요청 기록을 새로 수집'과 같은 말 — 처리방침 1·2절과 같은 목적·항목).
    --   12·13번 기록은 동의와 별개 처리라 수집 항목 줄에 넣지 않고 위 보유 기간 쌍의 마지막 줄에 적었다.
    ARRAY[$q$- 이용 중 생성: 접속 기록, 결제 기록$q$,
          $q$- 이용 중 생성: 접속 기록, 결제 기록$q$ || E'\n' ||
          $q$- 회원 탈퇴 때: 탈퇴 요청 기록(접수 경로, 요청자 구분(본인·법정대리인·위임 대리인), 접수·안내·회신 일시, 본인 확인 방법과 결과), 회원에게 보여 주거나 보낸 탈퇴 안내 원문, 소멸 크레딧 내역, 1:1 문의 보존 선택, 대리인이 요청한 경우 대리인의 이름·연락처와 위임 확인 자료(목적: 회원 탈퇴 처리와 결과 안내, 탈퇴 뒤 분쟁 대응)$q$,
          '수집 항목(회원 탈퇴 추가)', 'insert']
  ];

  w_paths := ARRAY[
    ARRAY['{texts,blockReasons,REFUND_PERIOD_BUFFER}',
          $q$환불 기간이 끝난 뒤 며칠 동안은 휴일 연장 여부를 확인하느라 탈퇴가 막힐 수 있습니다. 마지막 날이 휴일이었다면 고객센터로 환불을 요청할 수 있습니다.$q$,
          $q$환불 기간이 끝난 뒤 3일 동안은 휴일 연장 여부를 확인하느라 탈퇴할 수 없습니다. 마지막 날이 휴일이면 법에 따라 기간이 휴일이 끝난 다음 날까지 늘어나며, 그 기간에는 고객센터로 환불을 요청할 수 있습니다.$q$],
    ARRAY['{texts,blockReasons,REFUND_PERIOD_OPEN}',
          $q$환불 기간이 남은 충전 건이 있어 지금은 탈퇴할 수 없습니다. 그 충전 건을 환불하거나 환불 기간이 지난 뒤({가능예정일}부터) 탈퇴할 수 있습니다.$q$,
          $q$환불 기간이 남은 충전 건이 있어 지금은 탈퇴할 수 없습니다. 쓰지 않은 충전 건은 환불받거나 환불 기간이 지난 뒤, 일부를 쓴 충전 건은 환불 기간이 지난 뒤({가능예정일}부터) 탈퇴할 수 있습니다.$q$],
    ARRAY['{texts,notice,ticketsPayer}',
          $q$1:1 문의는 소비자 불만·분쟁 처리 기록으로 마지막 처리일부터 {결제문의보존기간}년(환불 신청과 연결된 문의는 {환불문의보존기간}년) 동안 분리해 보관한 뒤 파기합니다. 탈퇴하면 회원 화면에서는 사라집니다.$q$,
          $q$1:1 문의는 소비자 불만·분쟁 처리 기록으로 마지막 처리일부터 {결제문의보존기간}년, 환불 신청과 연결된 문의는 분쟁 확인을 위해 마지막 처리일부터 {환불문의보존기간}년 동안 분리해 보관한 뒤 파기합니다. 탈퇴하면 회원 화면에서는 사라집니다.$q$]
  ];

  -- 게시 행 화면 글(15번 계획 9절 초안 — 날짜는 c_effective_date 로 만든다)
  v_pub_texts := jsonb_build_object(
    'heading', v_date || ' 시행 예정 약관·정책',
    'intro', $q$회원 탈퇴 절차를 정비하고 탈퇴 뒤 기록 보관 기준을 분명히 하며 이용 제한 기록·관리자 상담 메모·관리자 작업 기록·관리자의 회원 연락처 열람 기록의 처리 기준과 보관 기간(작업 기록·열람 기록은 기록한 날부터 2년, 탈퇴한 뒤에도 보관)을 더하기 위해 이용약관 제12조와 부칙, 취소/환불정책 8-2절(신설), 개인정보처리방침 머리말과 1·2·3·6·7·10절이 바뀝니다. 아래에 바뀌는 부분(변경 전 → 변경 후)과 시행일부터 적용될 전문, 시행일에 다시 동의를 받을 항목을 적었습니다. 시행일 전까지는 지금 약관이 적용됩니다. 시행일 뒤 처음 접속하시면 바뀐 이용약관·개인정보 수집·이용 동의에 다시 동의하는 화면이 나오고, 동의 전에는 충전과 자료 구매를 할 수 없습니다. 크레딧 내역·구매 내역·자료 보관함·문의 화면은 동의 전에도 볼 수 있습니다. 바뀐 약관에 동의하지 않으시면 시행일 전까지 탈퇴를 요청하실 수 있으며, 결제 이력이 있거나 탈퇴 화면에서 접수되지 않으면 고객센터(이메일·전화)로 요청해 주세요.$q$,
    'bannerText', v_date || '(' || v_weekday || ')부터 이용약관·취소/환불정책·개인정보처리방침이 바뀝니다.',
    'bannerLinkLabel', '바뀌는 부분 보기',
    'footerLinkLabel', '변경 예정 약관',
    'statusTexts', jsonb_build_object(
      'applied', v_date || '부터 시행 중입니다.',
      'revertedAfterApply', '이 변경은 시행 뒤 되돌려졌습니다. 지금 시행 중인 약관은 아래 링크에서 보실 수 있습니다.',
      'withdrawn', '예정했던 이 변경은 시행하지 않기로 했습니다. 지금 약관이 그대로 적용됩니다.',
      'historyLinkLabel', '이전 판과 바뀐 부분 보기'),
    'labels', jsonb_build_object(
      'currentLinkUpcoming', '지금 시행 중인 {제목} 보기(변경 전 전문)',
      'currentLinkApplied', '지금 시행 중인 {제목}',
      'afterFull', '바뀐 뒤 전문',
      'beforeFull', '이전 판 전문',
      'consentSection', '다시 동의를 받을 항목',
      'before', '변경 전',
      'after', '변경 후',
      'checking', '이 문서는 확인 중입니다. 잠시 뒤 다시 열어 주세요.',
      'effectiveDate', '시행일',
      'publishedAt', '게시일',
      'toc', '목차',
      'backToList', '약관 및 정책 목록'));

  -- 1. 잠그고 사전 md5
  SELECT value INTO v_footer FROM public.system_settings WHERE key = 'site_footer_content' FOR UPDATE;
  v_footer_before := v_footer;
  v_refund := v_footer #>> '{policyDocuments,refundPolicy,content}';
  v_terms := v_footer #>> '{policyDocuments,serviceTerms,content}';
  v_privacy := v_footer #>> '{policyDocuments,privacyPolicy,content}';
  IF md5(v_refund) IS DISTINCT FROM c_refund_md5 OR md5(v_terms) IS DISTINCT FROM c_terms_md5
     OR md5(v_privacy) IS DISTINCT FROM c_privacy_md5 THEN
    RAISE EXCEPTION 'POLICY_TEXT: policy documents changed since dry-run (refund %, terms %, privacy %)',
      md5(v_refund), md5(v_terms), md5(v_privacy);
  END IF;

  SELECT * INTO v_item_terms FROM public.signup_consent_items WHERE key = 'terms';
  SELECT * INTO v_item_privacy FROM public.signup_consent_items WHERE key = 'privacy';
  SELECT * INTO v_item_age14_before FROM public.signup_consent_items WHERE key = 'age14';
  SELECT * INTO v_item_marketing_before FROM public.signup_consent_items WHERE key = 'marketing';
  IF v_item_terms.id IS NULL OR v_item_privacy.id IS NULL
     OR v_item_terms.version <> c_item_terms_version OR md5(v_item_terms.content) <> c_item_terms_md5
     OR v_item_privacy.version <> c_item_privacy_version OR md5(v_item_privacy.content) <> c_item_privacy_md5
     OR NOT (v_item_terms.required AND v_item_terms.is_active AND v_item_terms.policy_slug = 'service')
     OR NOT (v_item_privacy.required AND v_item_privacy.is_active) THEN
    RAISE EXCEPTION 'POLICY_TEXT: consent items changed since dry-run (terms v% %, privacy v% %)',
      v_item_terms.version, md5(v_item_terms.content), v_item_privacy.version, md5(v_item_privacy.content);
  END IF;
  IF (v_policy ->> 'termsConsentItemKey') IS DISTINCT FROM 'terms' THEN
    RAISE EXCEPTION 'POLICY_TEXT: member_withdrawal_policy.termsConsentItemKey is not terms';
  END IF;

  -- 탈퇴 정책 행을 잠그고, 바꿀 문구 세 줄이 지금 값과 같은지 확인한다.
  SELECT value INTO v_wpolicy FROM public.system_settings WHERE key = 'member_withdrawal_policy' FOR UPDATE;
  IF v_wpolicy IS DISTINCT FROM v_policy OR (v_wpolicy -> 'selfAnonymizeEnabled') IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'POLICY_TEXT: member_withdrawal_policy changed during script';
  END IF;
  v_wpolicy_new := v_wpolicy;
  FOR i IN 1 .. array_length(w_paths, 1) LOOP
    IF (v_wpolicy #>> w_paths[i][1]::text[]) IS DISTINCT FROM w_paths[i][2] THEN
      RAISE EXCEPTION 'POLICY_TEXT: member_withdrawal_policy % differs from dry-run', w_paths[i][1];
    END IF;
    v_wpolicy_new := jsonb_set(v_wpolicy_new, w_paths[i][1]::text[], to_jsonb(w_paths[i][3]));
  END LOOP;

  -- 지금 재동의 없이 통과하는 회원 수(영향 회원 수 계산용, 판정과 같은 규칙)
  SELECT count(*) INTO v_ok_before
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE NOT public.is_internal_admin_account(u.email) AND p.withdrawn_at IS NULL
     AND ((p.provider = 'kakao' AND p.signup_completed IS TRUE) OR (p.provider IS DISTINCT FROM 'kakao' AND u.email_confirmed_at IS NOT NULL))
     AND NOT EXISTS (SELECT 1 FROM public.consent_missing_required(p.id, '[]'::jsonb));

  -- 2. 바꿀 문장이 각각 정확히 1번 있는지 확인한 뒤 바꾼다(하나씩 확인·교체).
  v_terms_new := v_terms;
  FOR i IN 1 .. array_length(t_pairs, 1) LOOP
    IF (length(v_terms_new) - length(replace(v_terms_new, t_pairs[i][1], ''))) / length(t_pairs[i][1]) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'POLICY_TEXT: serviceTerms fragment % not found exactly once', i;
    END IF;
    v_terms_new := replace(v_terms_new, t_pairs[i][1], t_pairs[i][2]);
  END LOOP;

  v_refund_new := v_refund;
  FOR i IN 1 .. array_length(r_pairs, 1) LOOP
    IF (length(v_refund_new) - length(replace(v_refund_new, r_pairs[i][1], ''))) / length(r_pairs[i][1]) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'POLICY_TEXT: refundPolicy fragment % not found exactly once', i;
    END IF;
    v_refund_new := replace(v_refund_new, r_pairs[i][1], r_pairs[i][2]);
  END LOOP;

  v_privacy_new := v_privacy;
  FOR i IN 1 .. array_length(p_pairs, 1) LOOP
    IF (length(v_privacy_new) - length(replace(v_privacy_new, p_pairs[i][1], ''))) / length(p_pairs[i][1]) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'POLICY_TEXT: privacyPolicy fragment % not found exactly once', i;
    END IF;
    v_privacy_new := replace(v_privacy_new, p_pairs[i][1], p_pairs[i][2]);
  END LOOP;

  v_item_terms_content := v_item_terms.content;
  FOR i IN 1 .. array_length(it_pairs, 1) LOOP
    IF (length(v_item_terms_content) - length(replace(v_item_terms_content, it_pairs[i][1], ''))) / length(it_pairs[i][1]) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'POLICY_TEXT: terms consent item fragment % not found exactly once', i;
    END IF;
    v_item_terms_content := replace(v_item_terms_content, it_pairs[i][1], it_pairs[i][2]);
  END LOOP;

  v_item_privacy_content := v_item_privacy.content;
  FOR i IN 1 .. array_length(ip_pairs, 1) LOOP
    IF (length(v_item_privacy_content) - length(replace(v_item_privacy_content, ip_pairs[i][1], ''))) / length(ip_pairs[i][1]) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'POLICY_TEXT: privacy consent item fragment % not found exactly once', i;
    END IF;
    v_item_privacy_content := replace(v_item_privacy_content, ip_pairs[i][1], ip_pairs[i][2]);
  END LOOP;

  -- 2-2. 게시 행 내용(15번 4-3): 문서별 changes(쌍 이름·방식 그대로), 바뀔 전문·변경 전 전문, 동의 항목 새 글, 잠금 경로, 지문.
  --      'insert' 쌍은 옛 조각이 새 조각에 정확히 1번 들어 있어야 하고, 변경 후 = 새 조각에서 옛 조각을 뺀 부분(앞뒤 줄바꿈 정리)이다.
  v_documents := '[]'::jsonb;
  FOR v_doc_idx IN 1 .. 3 LOOP
    v_doc_key := (ARRAY['serviceTerms', 'refundPolicy', 'privacyPolicy'])[v_doc_idx];
    v_pairs := CASE v_doc_idx WHEN 1 THEN t_pairs WHEN 2 THEN r_pairs ELSE p_pairs END;
    v_doc_before := CASE v_doc_idx WHEN 1 THEN v_terms WHEN 2 THEN v_refund ELSE v_privacy END;
    v_doc_after := CASE v_doc_idx WHEN 1 THEN v_terms_new WHEN 2 THEN v_refund_new ELSE v_privacy_new END;
    v_changes := '[]'::jsonb;
    v_changes_text := NULL;
    FOR i IN 1 .. array_length(v_pairs, 1) LOOP
      IF v_pairs[i][4] = 'insert' THEN
        IF (length(v_pairs[i][2]) - length(replace(v_pairs[i][2], v_pairs[i][1], ''))) / length(v_pairs[i][1]) IS DISTINCT FROM 1 THEN
          RAISE EXCEPTION 'POLICY_TEXT: % insert pair % does not contain its old fragment exactly once', v_doc_key, i;
        END IF;
        v_change_after := regexp_replace(replace(v_pairs[i][2], v_pairs[i][1], ''), '^\n+|\n+$', '', 'g');
        v_changes := v_changes || jsonb_build_array(jsonb_build_object('label', v_pairs[i][3], 'mode', 'insert',
          'before', '(없음 — 새로 생김)', 'after', v_change_after));
      ELSIF v_pairs[i][4] = 'replace' THEN
        v_changes := v_changes || jsonb_build_array(jsonb_build_object('label', v_pairs[i][3], 'mode', 'replace',
          'before', v_pairs[i][1], 'after', v_pairs[i][2]));
      ELSE
        RAISE EXCEPTION 'POLICY_TEXT: % pair % has unknown mode %', v_doc_key, i, v_pairs[i][4];
      END IF;
    END LOOP;
    -- changesSha256 = (label LF mode LF before LF after) 를 정해진 순서로 LF LF 로 이은 글의 sha256
    SELECT string_agg(concat_ws(E'\n', c ->> 'label', c ->> 'mode', c ->> 'before', c ->> 'after'), E'\n\n' ORDER BY ord)
      INTO v_changes_text FROM jsonb_array_elements(v_changes) WITH ORDINALITY AS e(c, ord);
    v_documents := v_documents || jsonb_build_array(jsonb_build_object(
      'key', v_doc_key,
      'slug', v_footer #>> ARRAY['policyDocuments', v_doc_key, 'slug'],
      'title', v_footer #>> ARRAY['policyDocuments', v_doc_key, 'title'],
      'content', v_doc_after,
      'sha256', encode(sha256(convert_to(v_doc_after, 'UTF8')), 'hex'),
      'beforeContent', v_doc_before,
      'beforeSha256', encode(sha256(convert_to(v_doc_before, 'UTF8')), 'hex'),
      'changes', v_changes,
      'changesSha256', encode(sha256(convert_to(v_changes_text, 'UTF8')), 'hex')));
  END LOOP;
  -- 동의 항목: 시행 때 쓸 이름(지금 이름)·판(+1)·변경 안내. sha256 = label LF version LF note LF content, contentSha256 = 본문만.
  v_consent_items := jsonb_build_array(
    jsonb_build_object('key', v_item_terms.key, 'label', v_item_terms.label, 'version', v_item_terms.version + 1,
      'content', v_item_terms_content, 'note', c_terms_note,
      'sha256', encode(sha256(convert_to(concat_ws(E'\n', v_item_terms.label, (v_item_terms.version + 1)::text, c_terms_note, v_item_terms_content), 'UTF8')), 'hex'),
      'contentSha256', encode(sha256(convert_to(v_item_terms_content, 'UTF8')), 'hex')),
    jsonb_build_object('key', v_item_privacy.key, 'label', v_item_privacy.label, 'version', v_item_privacy.version + 1,
      'content', v_item_privacy_content, 'note', c_privacy_note,
      'sha256', encode(sha256(convert_to(concat_ws(E'\n', v_item_privacy.label, (v_item_privacy.version + 1)::text, c_privacy_note, v_item_privacy_content), 'UTF8')), 'hex'),
      'contentSha256', encode(sha256(convert_to(v_item_privacy_content, 'UTF8')), 'hex')));
  -- 탈퇴 정책 잠금 경로(15번 4-3·4-4): w_paths 세 경로 + c_num_checks 의 숫자 키 + termsConsentItemKey + texts.notice.termsVersion
  SELECT jsonb_agg(p ORDER BY ord) INTO v_locked_paths FROM (
    SELECT w_paths[j][1] AS p, j AS ord FROM generate_subscripts(w_paths, 1) j
    UNION ALL
    SELECT '{' || k || '}', 100 + min(j) FROM (SELECT c_num_checks[j][4] AS k, j FROM generate_subscripts(c_num_checks, 1) j) n GROUP BY k
    UNION ALL SELECT '{termsConsentItemKey}', 1000
    UNION ALL SELECT '{texts,notice,termsVersion}', 1001) x;

  -- 5. VERIFY 를 돌릴 대상: 게시는 저장 전 새 본문 변수, 시행은 저장한 뒤 DB 값(아래 3~4 뒤에 다시 채움)
  v_chk_terms := v_terms_new;
  v_chk_refund := v_refund_new;
  v_chk_privacy := v_privacy_new;
  v_chk_item_terms := v_item_terms_content;
  v_chk_item_privacy := v_item_privacy_content;
  v_chk_wpolicy := v_wpolicy_new;

  IF c_mode = 'apply' THEN
    -- 5-0. 관리자 기록 보관 기간 문장('기록한 날부터 N년', 처리방침 3절·동의 privacy·변경 안내) = 13번 설정 accessLogRetentionYears
    v_num := (SELECT value #>> '{admin,accessLogRetentionYears}' FROM public.system_settings WHERE key = 'support_page_content');
    v_count := 0;
    FOR v_text IN SELECT m[1] FROM regexp_matches(v_privacy_new || E'\n' || v_item_privacy_content || E'\n' || c_privacy_note,
                                                  '기록한 날부터 ([0-9]+)년', 'g') AS m LOOP
      v_count := v_count + 1;
      IF v_num IS NULL OR v_text IS DISTINCT FROM v_num THEN
        RAISE EXCEPTION 'POLICY_TEXT: admin record retention in text % <> support_page_content.admin.accessLogRetentionYears %', v_text, v_num;
      END IF;
    END LOOP;
    IF v_count < 3 THEN
      RAISE EXCEPTION 'POLICY_TEXT: admin record retention sentences % (expected >= 3)', v_count;
    END IF;

    -- 5. 지문: 새 본문·동의 항목·changes 를 게시 행과 대조(같은 계산이라 다르면 고지한 글과 시행할 글이 다르다는 뜻)
    SELECT value INTO v_pub_old FROM public.system_settings WHERE key = 'policy_upcoming_documents' FOR UPDATE;
    IF v_pub_old IS NULL OR (v_pub_old ->> 'status') IS DISTINCT FROM 'upcoming'
       OR (SELECT jsonb_agg(jsonb_build_array(d ->> 'key', d ->> 'sha256', d ->> 'changesSha256') ORDER BY d ->> 'key') FROM jsonb_array_elements(v_pub_old -> 'documents') d)
          IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_array(d ->> 'key', d ->> 'sha256', d ->> 'changesSha256') ORDER BY d ->> 'key') FROM jsonb_array_elements(v_documents) d)
       OR (SELECT jsonb_agg(jsonb_build_array(c ->> 'key', c ->> 'sha256') ORDER BY c ->> 'key') FROM jsonb_array_elements(v_pub_old -> 'consentItems') c)
          IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_array(c ->> 'key', c ->> 'sha256') ORDER BY c ->> 'key') FROM jsonb_array_elements(v_consent_items) c) THEN
      RAISE EXCEPTION 'POLICY_TEXT: fingerprints differ from the published upcoming documents — 고지한 글과 시행할 글이 다르다';
    END IF;

    -- 게시 행을 먼저 'applied' 로 바꾼다(고지 기간 잠금 트리거 3개가 풀린다). 그 뒤 같은 거래에서 저장한다.
    UPDATE public.system_settings
       SET value = v_pub_old || jsonb_build_object('status', 'applied', 'appliedAt', clock_timestamp()), updated_at = now()
     WHERE key = 'policy_upcoming_documents';
  END IF;

  IF c_mode = 'publish_upcoming' THEN
    -- 5-3(게시). 옛 표현 0건(새 본문 변수)
    FOR i IN 1 .. array_length(c_old_phrases, 1) LOOP
      IF position(c_old_phrases[i] IN v_chk_refund) > 0 OR position(c_old_phrases[i] IN v_chk_terms) > 0
         OR position(c_old_phrases[i] IN v_chk_privacy) > 0 OR position(c_old_phrases[i] IN v_chk_item_terms) > 0
         OR position(c_old_phrases[i] IN v_chk_item_privacy) > 0 THEN
        RAISE EXCEPTION 'VERIFY: old phrase remains: %', c_old_phrases[i];
      END IF;
    END LOOP;
  END IF;

  IF c_mode = 'apply' THEN
  -- 3. 약관 본문 저장(site_footer_content 는 한 번만 UPDATE — 사본 트리거가 문서별 1행)
  SELECT count(*) INTO v_snap_before FROM public.policy_document_snapshots;
  SELECT count(*) INTO v_waudit_before FROM public.admin_audit_log WHERE action = 'member_withdrawal_policy_update';
  SELECT count(*) INTO v_audit_before FROM public.admin_audit_log
   WHERE action IN ('site_footer_save', 'signup_consent_item_save') AND actor_id = v_actor;
  UPDATE public.system_settings
     SET value = jsonb_set(jsonb_set(jsonb_set(value,
                   '{policyDocuments,refundPolicy,content}', to_jsonb(v_refund_new)),
                   '{policyDocuments,serviceTerms,content}', to_jsonb(v_terms_new)),
                   '{policyDocuments,privacyPolicy,content}', to_jsonb(v_privacy_new)),
         updated_at = now()
   WHERE key = 'site_footer_content';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'POLICY_TEXT: site_footer_content update rows %', v_count;
  END IF;

  PERFORM public.record_admin_audit(v_actor, 'site_footer_save', 'site_footer', 'site_footer_content', NULL, NULL,
    '10번 회원 탈퇴(익명화) 반영 — 이용약관 12조·부칙, 취소/환불정책 8-2절, 개인정보처리방침 1·2·3·6·7·10절·시행일 — SQL 스크립트 supabase/scripts/20261126_bundle10_policy_text.sql',
    jsonb_build_object('bundle', 'bundle10_policy_text',
      'before', jsonb_build_object('refundPolicy', v_refund, 'serviceTerms', v_terms, 'privacyPolicy', v_privacy),
      'before_md5', jsonb_build_object('refundPolicy', md5(v_refund), 'serviceTerms', md5(v_terms), 'privacyPolicy', md5(v_privacy)),
      'after_md5', jsonb_build_object('refundPolicy', md5(v_refund_new), 'serviceTerms', md5(v_terms_new), 'privacyPolicy', md5(v_privacy_new)),
      'effective_date', v_date),
    NULL);

  -- 4. 가입 동의 항목 새 판(본문이 바뀌는 필수 항목 저장 = 판 +1, 변경 안내 note 기록, 작업 기록은 함수가 남김)
  v_save := public.save_signup_consent_item(v_actor, v_item_terms.id, v_item_terms.version, v_item_terms.label,
    v_item_terms_content, v_item_terms.required, v_item_terms.policy_slug, v_item_terms.sort_order, v_item_terms.is_active,
    c_terms_note, v_item_terms.updated_at, false);
  IF (v_save ->> 'after_version')::integer IS DISTINCT FROM v_item_terms.version + 1 OR (v_save ->> 'reconsent')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'POLICY_TEXT: terms consent item save %', v_save;
  END IF;
  v_save := public.save_signup_consent_item(v_actor, v_item_privacy.id, v_item_privacy.version, v_item_privacy.label,
    v_item_privacy_content, v_item_privacy.required, v_item_privacy.policy_slug, v_item_privacy.sort_order, v_item_privacy.is_active,
    c_privacy_note, v_item_privacy.updated_at, false);
  IF (v_save ->> 'after_version')::integer IS DISTINCT FROM v_item_privacy.version + 1 OR (v_save ->> 'reconsent')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'POLICY_TEXT: privacy consent item save %', v_save;
  END IF;

  -- 4-2. 탈퇴 정책 문구 세 줄(막힘 화면 2줄, 고지 원문 1줄)
  UPDATE public.system_settings SET value = v_wpolicy_new, updated_at = now() WHERE key = 'member_withdrawal_policy';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'POLICY_TEXT: member_withdrawal_policy update rows %', v_count;
  END IF;
  PERFORM public.record_admin_audit(v_actor, 'member_withdrawal_policy_update', 'system_settings', 'member_withdrawal_policy', NULL, NULL,
    '10번 탈퇴 안내 문구를 약관 표현과 맞춤 — SQL 스크립트 supabase/scripts/20261126_bundle10_policy_text.sql',
    jsonb_build_object('bundle', 'bundle10_policy_text',
      'changed_paths', to_jsonb(ARRAY(SELECT w_paths[j][1] FROM generate_subscripts(w_paths, 1) j ORDER BY j)),
      'before', to_jsonb(ARRAY(SELECT w_paths[j][2] FROM generate_subscripts(w_paths, 1) j ORDER BY j)),
      'after', to_jsonb(ARRAY(SELECT w_paths[j][3] FROM generate_subscripts(w_paths, 1) j ORDER BY j))),
    NULL);

  -- 5. VERIFY ─────────────────────────────────────────────────────────────────────────────────────────
  SELECT value INTO v_footer FROM public.system_settings WHERE key = 'site_footer_content';
  v_refund := v_footer #>> '{policyDocuments,refundPolicy,content}';
  v_terms := v_footer #>> '{policyDocuments,serviceTerms,content}';
  v_privacy := v_footer #>> '{policyDocuments,privacyPolicy,content}';
  IF v_refund IS DISTINCT FROM v_refund_new OR v_terms IS DISTINCT FROM v_terms_new OR v_privacy IS DISTINCT FROM v_privacy_new THEN
    RAISE EXCEPTION 'VERIFY: saved documents differ';
  END IF;

  -- 5-1. 고친 곳 밖은 그대로(약관 묶음의 다른 키·문서 메타)
  IF (v_footer #- '{policyDocuments,refundPolicy,content}' #- '{policyDocuments,serviceTerms,content}' #- '{policyDocuments,privacyPolicy,content}')
     IS DISTINCT FROM
     (v_footer_before #- '{policyDocuments,refundPolicy,content}' #- '{policyDocuments,serviceTerms,content}' #- '{policyDocuments,privacyPolicy,content}') THEN
    RAISE EXCEPTION 'VERIFY: unrelated footer content changed';
  END IF;

  -- 5-2. 동의 항목: terms·privacy 판 +1, 판 원문 = 항목(본문·note), age14·marketing 그대로
  SELECT * INTO v_item_terms FROM public.signup_consent_items WHERE key = 'terms';
  SELECT * INTO v_item_privacy FROM public.signup_consent_items WHERE key = 'privacy';
  IF v_item_terms.version <> c_item_terms_version + 1 OR v_item_terms.content <> v_item_terms_content
     OR v_item_privacy.version <> c_item_privacy_version + 1 OR v_item_privacy.content <> v_item_privacy_content THEN
    RAISE EXCEPTION 'VERIFY: consent items not saved (terms v%, privacy v%)', v_item_terms.version, v_item_privacy.version;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.signup_consent_item_versions v
                  WHERE v.item_id = v_item_terms.id AND v.version = v_item_terms.version AND v.content = v_item_terms.content
                    AND v.label = v_item_terms.label AND v.required AND v.policy_slug = 'service' AND v.note = c_terms_note)
     OR NOT EXISTS (SELECT 1 FROM public.signup_consent_item_versions v
                  WHERE v.item_id = v_item_privacy.id AND v.version = v_item_privacy.version AND v.content = v_item_privacy.content
                    AND v.label = v_item_privacy.label AND v.required AND v.policy_slug IS NULL AND v.note = c_privacy_note) THEN
    RAISE EXCEPTION 'VERIFY: consent item version rows';
  END IF;
  IF (SELECT row(i.version, i.content, i.updated_at) FROM public.signup_consent_items i WHERE i.key = 'age14')
       IS DISTINCT FROM row(v_item_age14_before.version, v_item_age14_before.content, v_item_age14_before.updated_at)
     OR (SELECT row(i.version, i.content, i.updated_at) FROM public.signup_consent_items i WHERE i.key = 'marketing')
       IS DISTINCT FROM row(v_item_marketing_before.version, v_item_marketing_before.content, v_item_marketing_before.updated_at) THEN
    RAISE EXCEPTION 'VERIFY: age14/marketing consent items changed';
  END IF;
  -- 시행: 아래 5-3~5-5 는 저장한 뒤의 DB 값으로 본다.
  v_chk_terms := v_terms;
  v_chk_refund := v_refund;
  v_chk_privacy := v_privacy;
  v_chk_item_terms := v_item_terms.content;
  v_chk_item_privacy := v_item_privacy.content;
  v_chk_wpolicy := (SELECT value FROM public.system_settings WHERE key = 'member_withdrawal_policy');

  -- 5-3. 옛 표현 0건(세 문서·동의 항목 본문)
  FOR i IN 1 .. array_length(c_old_phrases, 1) LOOP
    IF position(c_old_phrases[i] IN v_chk_refund) > 0 OR position(c_old_phrases[i] IN v_chk_terms) > 0
       OR position(c_old_phrases[i] IN v_chk_privacy) > 0 OR position(c_old_phrases[i] IN v_chk_item_terms) > 0
       OR position(c_old_phrases[i] IN v_chk_item_privacy) > 0 THEN
      RAISE EXCEPTION 'VERIFY: old phrase remains: %', c_old_phrases[i];
    END IF;
  END LOOP;
  END IF;

  -- 5-4. 새 절·조가 정확히 1번, 시행일 = c_effective_date, 12조는 ①~④ (게시: 새 본문 변수 / 시행: 저장한 DB 값)
  IF (length(v_chk_refund) - length(replace(v_chk_refund, E'\n## 8-2. 회원 탈퇴와 크레딧\n', ''))) / length(E'\n## 8-2. 회원 탈퇴와 크레딧\n') <> 1
     OR position(E'\n## 8. 서비스 종료 시 처리\n' IN v_chk_refund) > position(E'\n## 8-2. 회원 탈퇴와 크레딧\n' IN v_chk_refund)
     OR position(E'\n## 8-2. 회원 탈퇴와 크레딧\n' IN v_chk_refund) > position(E'\n## 9. 부정 결제 및 악용 방지\n' IN v_chk_refund) THEN
    RAISE EXCEPTION 'VERIFY: refund section 8-2 position';
  END IF;
  -- 처리방침 3절: '법령에 따라 보존' 다음 '분쟁 대응을 위해 회사가 보관', 둘 다 3절 안(4절 앞)에 1번씩
  IF (length(v_chk_privacy) - length(replace(v_chk_privacy, E'\n### 법령에 따라 보존하는 기록\n', ''))) / length(E'\n### 법령에 따라 보존하는 기록\n') <> 1
     OR (length(v_chk_privacy) - length(replace(v_chk_privacy, E'\n### 분쟁 대응을 위해 회사가 보관하는 기록\n', ''))) / length(E'\n### 분쟁 대응을 위해 회사가 보관하는 기록\n') <> 1
     OR NOT (position(E'\n## 3. 개인정보의 보유 및 이용 기간\n' IN v_chk_privacy) < position(E'\n### 법령에 따라 보존하는 기록\n' IN v_chk_privacy)
             AND position(E'\n### 법령에 따라 보존하는 기록\n' IN v_chk_privacy) < position(E'\n### 분쟁 대응을 위해 회사가 보관하는 기록\n' IN v_chk_privacy)
             AND position(E'\n### 분쟁 대응을 위해 회사가 보관하는 기록\n' IN v_chk_privacy) < position(E'\n## 4. 개인정보의 제3자 제공\n' IN v_chk_privacy)) THEN
    RAISE EXCEPTION 'VERIFY: privacy section 3 split';
  END IF;
  v_text := split_part(substr(v_chk_terms, position(E'## 제12조(계약 해지와 탈퇴)\n' IN v_chk_terms)), E'\n## ', 1);
  IF position(E'\n① 회원은 언제든지 마이페이지의 회원 탈퇴 화면에서' IN v_text) = 0 OR position(E'\n② 탈퇴하면 남은 크레딧' IN v_text) = 0
     OR position(E'\n③ 탈퇴하면 구매한 자료를' IN v_text) = 0 OR position(E'\n④ 회원이 이 약관을 중대하게 어기면' IN v_text) = 0
     OR position('⑤' IN v_text) > 0 OR position('취소/환불정책 8-2절' IN v_text) = 0 THEN
    RAISE EXCEPTION 'VERIFY: terms article 12';
  END IF;
  IF position('이 약관은 ' || v_date || '부터 시행합니다.' IN v_chk_terms) = 0
     OR position(E'\n\n시행일: ' || v_date || E'\n' IN v_chk_privacy) = 0
     OR v_date !~ '^20[0-9]{2}년 [1-9][0-9]?월 [1-9][0-9]?일$' THEN
    RAISE EXCEPTION 'VERIFY: effective date % not written', v_date;
  END IF;

  -- 5-5. 문구의 보존 기간·일수 = DB 값(member_withdrawal_policy). X 는 새 탈퇴 정책(게시: v_wpolicy_new, 시행: 저장한 값)
  FOR i IN 1 .. array_length(c_num_checks, 1) LOOP
    v_target := '';
    IF position('T' IN c_num_checks[i][1]) > 0 THEN v_target := v_target || E'\n' || v_chk_terms || E'\n' || v_chk_item_terms; END IF;
    IF position('R' IN c_num_checks[i][1]) > 0 THEN v_target := v_target || E'\n' || v_chk_refund; END IF;
    IF position('P' IN c_num_checks[i][1]) > 0 THEN v_target := v_target || E'\n' || v_chk_privacy; END IF;
    IF position('I' IN c_num_checks[i][1]) > 0 THEN v_target := v_target || E'\n' || v_chk_item_privacy; END IF;
    IF position('N' IN c_num_checks[i][1]) > 0 THEN v_target := v_target || E'\n' || c_terms_note || E'\n' || c_privacy_note; END IF;
    IF position('X' IN c_num_checks[i][1]) > 0 THEN
      v_target := v_target || E'\n' || (v_chk_wpolicy #>> '{texts,blockReasons,REFUND_PERIOD_BUFFER}');
    END IF;
    v_expected := public.member_withdrawal_policy_days(c_num_checks[i][4]);
    IF v_expected IS NULL THEN
      RAISE EXCEPTION 'VERIFY: policy key % unreadable', c_num_checks[i][4];
    END IF;
    v_count := 0;
    FOR v_num IN SELECT m[c_num_checks[i][3]::integer] FROM regexp_matches(v_target, c_num_checks[i][2], 'g') AS m LOOP
      v_count := v_count + 1;
      IF v_num::integer <> v_expected THEN
        RAISE EXCEPTION 'VERIFY: % in text % <> policy % (pattern %)', c_num_checks[i][4], v_num, v_expected, c_num_checks[i][2];
      END IF;
    END LOOP;
    IF v_count < c_num_checks[i][5]::integer THEN
      RAISE EXCEPTION 'VERIFY: % sentences % (expected >= %)', c_num_checks[i][4], v_count, c_num_checks[i][5];
    END IF;
  END LOOP;

  IF c_mode = 'publish_upcoming' THEN
    -- 5-7-3(게시). 자리표시 검사만: 새 ticketsPayer 의 자리표시자를 정책 값으로 채운 뒤 {…} 가 남지 않고 비어 있지 않다.
    v_text := replace(replace(w_paths[3][3],
      '{결제문의보존기간}', public.member_withdrawal_policy_days('payerTicketRetentionYears')::text),
      '{환불문의보존기간}', public.member_withdrawal_policy_days('payerRefundTicketRetentionYears')::text);
    IF v_text IS NULL OR btrim(v_text) = '' OR v_text ~ '\{[^}]*\}' THEN
      RAISE EXCEPTION 'VERIFY: ticketsPayer placeholders not filled';
    END IF;

    -- 6. 게시 행 넣기(15번 4-3). 행이 이미 있으면: applied → 멈춤 / upcoming·지문 같음 → 화면 글만 바꿈(publishedAt 유지) /
    --    upcoming·지문 다름 또는 reverted → c_republish_reason 이 있어야 새로 시작(앞 지문·시각은 superseded 로).
    v_pub_new := v_pub_texts || jsonb_build_object(
      'status', 'upcoming',
      'effectiveDate', to_char(c_effective_date, 'YYYY-MM-DD'),
      'effectiveDateLabel', v_date,
      'noticeDeadline', to_char(c_notice_deadline, 'YYYY-MM-DD'),
      'publishedAt', to_jsonb(clock_timestamp()),
      'appliedAt', NULL,
      'revertedAt', NULL,
      'lockedWithdrawalPaths', v_locked_paths,
      'baseMd5', jsonb_build_object('serviceTerms', md5(v_terms), 'refundPolicy', md5(v_refund), 'privacyPolicy', md5(v_privacy)),
      'documents', v_documents,
      'consentItems', v_consent_items,
      'superseded', '[]'::jsonb);
    SELECT value INTO v_pub_old FROM public.system_settings WHERE key = 'policy_upcoming_documents' FOR UPDATE;
    IF v_pub_old IS NULL THEN
      v_publish_kind := 'new';
      INSERT INTO public.system_settings (key, value, description, updated_at)
      VALUES ('policy_upcoming_documents', v_pub_new,
              '변경 예정 약관(30일 전 고지): 바뀔 전문·변경 전후·동의 항목 새 글. 10번 약관 스크립트(publish_upcoming·apply·withdraw_upcoming)로만 고친다.',
              now());
    ELSIF (v_pub_old ->> 'status') = 'applied' THEN
      RAISE EXCEPTION 'POLICY_TEXT: upcoming documents already applied — publish a new revision only after a new plan';
    ELSIF (v_pub_old ->> 'status') = 'upcoming'
          AND (v_pub_old -> 'documents') IS NOT NULL
          AND (SELECT jsonb_agg(jsonb_build_array(d ->> 'key', d ->> 'sha256', d ->> 'changesSha256') ORDER BY d ->> 'key') FROM jsonb_array_elements(v_pub_old -> 'documents') d)
              IS NOT DISTINCT FROM (SELECT jsonb_agg(jsonb_build_array(d ->> 'key', d ->> 'sha256', d ->> 'changesSha256') ORDER BY d ->> 'key') FROM jsonb_array_elements(v_documents) d)
          AND (SELECT jsonb_agg(jsonb_build_array(c ->> 'key', c ->> 'sha256') ORDER BY c ->> 'key') FROM jsonb_array_elements(v_pub_old -> 'consentItems') c)
              IS NOT DISTINCT FROM (SELECT jsonb_agg(jsonb_build_array(c ->> 'key', c ->> 'sha256') ORDER BY c ->> 'key') FROM jsonb_array_elements(v_consent_items) c)
          AND (v_pub_old -> 'lockedWithdrawalPaths') IS NOT DISTINCT FROM v_locked_paths
          AND (v_pub_old ->> 'effectiveDate') IS NOT DISTINCT FROM (v_pub_new ->> 'effectiveDate')
          AND (v_pub_old ->> 'noticeDeadline') IS NOT DISTINCT FROM (v_pub_new ->> 'noticeDeadline') THEN
      -- 같은 지문: 머리말·한 줄 안내·하단 링크·상태별 줄·화면 글만 바꾼다(publishedAt 그대로).
      v_publish_kind := 'texts_only';
      v_pub_new := v_pub_old || v_pub_texts;
      IF v_pub_new = v_pub_old THEN
        RAISE EXCEPTION 'POLICY_TEXT: already published with the same content and texts (nothing to do)';
      END IF;
      UPDATE public.system_settings SET value = v_pub_new, updated_at = now() WHERE key = 'policy_upcoming_documents';
    ELSE
      IF c_republish_reason IS NULL OR btrim(c_republish_reason) = '' THEN
        RAISE EXCEPTION 'POLICY_TEXT: published upcoming documents differ (status %) — set c_republish_reason to restart the 30-day notice', v_pub_old ->> 'status';
      END IF;
      v_publish_kind := 'republish';
      v_pub_new := jsonb_set(v_pub_new, '{superseded}', coalesce(v_pub_old -> 'superseded', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'status', v_pub_old -> 'status',
        'publishedAt', v_pub_old -> 'publishedAt',
        'appliedAt', v_pub_old -> 'appliedAt',
        'revertedAt', v_pub_old -> 'revertedAt',
        'effectiveDate', v_pub_old -> 'effectiveDate',
        'documentsSha256', (SELECT jsonb_object_agg(d ->> 'key', d ->> 'sha256') FROM jsonb_array_elements(v_pub_old -> 'documents') d),
        'changesSha256', (SELECT jsonb_object_agg(d ->> 'key', d ->> 'changesSha256') FROM jsonb_array_elements(v_pub_old -> 'documents') d),
        'consentSha256', (SELECT jsonb_object_agg(c ->> 'key', c ->> 'sha256') FROM jsonb_array_elements(v_pub_old -> 'consentItems') c),
        'reason', c_republish_reason,
        'supersededAt', to_jsonb(clock_timestamp()))));
      UPDATE public.system_settings SET value = v_pub_new, updated_at = now() WHERE key = 'policy_upcoming_documents';
    END IF;

    -- 작업 기록: 행 전체(원문 포함)가 추가 전용 표에 남는다. 10번 확인 조회의 bundle10_policy_text 건수에는 섞이지 않는다.
    PERFORM public.record_admin_audit(v_actor, 'policy_upcoming_publish', 'system_settings', 'policy_upcoming_documents', NULL, NULL,
      CASE WHEN v_publish_kind = 'republish' THEN c_republish_reason END,
      jsonb_build_object('bundle', 'bundle15_policy_upcoming', 'kind', v_publish_kind,
        'row', v_pub_new,
        'documents_sha256', (SELECT jsonb_object_agg(d ->> 'key', d ->> 'sha256') FROM jsonb_array_elements(v_pub_new -> 'documents') d),
        'changes_sha256', (SELECT jsonb_object_agg(d ->> 'key', d ->> 'changesSha256') FROM jsonb_array_elements(v_pub_new -> 'documents') d),
        'consent_sha256', (SELECT jsonb_object_agg(c ->> 'key', c ->> 'sha256') FROM jsonb_array_elements(v_pub_new -> 'consentItems') c),
        'base_md5', v_pub_new -> 'baseMd5',
        'effective_date', v_pub_new -> 'effectiveDate',
        'saved_at', to_jsonb(clock_timestamp())),
      NULL);
    RAISE NOTICE 'POLICY_TEXT OK: published upcoming documents (%), effective %, notice deadline %', v_publish_kind, v_date, c_notice_deadline;
    RETURN;
  END IF;

  -- 5-6. 사본: 세 문서 1행씩만 늘고, 최신 사본 = 새 본문 = 게시 행 지문
  SELECT count(*) INTO v_count FROM public.policy_document_snapshots;
  IF v_count - v_snap_before <> 3 THEN
    RAISE EXCEPTION 'VERIFY: snapshots added % (expected 3)', v_count - v_snap_before;
  END IF;
  IF (SELECT content_sha256 FROM public.policy_document_snapshots WHERE doc_key = 'refundPolicy' ORDER BY seq DESC LIMIT 1)
       <> encode(sha256(convert_to(v_refund_new, 'UTF8')), 'hex')
     OR (SELECT content_sha256 FROM public.policy_document_snapshots WHERE doc_key = 'serviceTerms' ORDER BY seq DESC LIMIT 1)
       <> encode(sha256(convert_to(v_terms_new, 'UTF8')), 'hex')
     OR (SELECT content_sha256 FROM public.policy_document_snapshots WHERE doc_key = 'privacyPolicy' ORDER BY seq DESC LIMIT 1)
       <> encode(sha256(convert_to(v_privacy_new, 'UTF8')), 'hex') THEN
    RAISE EXCEPTION 'VERIFY: latest snapshots differ';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_pub_old -> 'documents') d
              WHERE (SELECT s.content_sha256 FROM public.policy_document_snapshots s WHERE s.doc_key = d ->> 'key' ORDER BY s.seq DESC LIMIT 1)
                    IS DISTINCT FROM d ->> 'sha256') THEN
    RAISE EXCEPTION 'VERIFY: latest snapshots differ from published upcoming documents';
  END IF;

  -- 5-7. 작업 기록: 약관 저장 1건 + 동의 항목 저장 2건
  SELECT count(*) INTO v_count FROM public.admin_audit_log
   WHERE action IN ('site_footer_save', 'signup_consent_item_save') AND actor_id = v_actor;
  IF v_count - v_audit_before <> 3 THEN
    RAISE EXCEPTION 'VERIFY: audit rows added % (expected 3)', v_count - v_audit_before;
  END IF;

  -- 5-7-2. 탈퇴 정책: 세 줄만 바뀌고 나머지(기간·스위치·다른 문구)는 그대로
  IF (SELECT value FROM public.system_settings WHERE key = 'member_withdrawal_policy') IS DISTINCT FROM v_wpolicy_new THEN
    RAISE EXCEPTION 'VERIFY: member_withdrawal_policy not saved';
  END IF;
  v_check := v_wpolicy_new;
  FOR i IN 1 .. array_length(w_paths, 1) LOOP
    v_check := jsonb_set(v_check, w_paths[i][1]::text[], to_jsonb(w_paths[i][2]));
  END LOOP;
  IF v_check IS DISTINCT FROM v_wpolicy THEN
    RAISE EXCEPTION 'VERIFY: unrelated member_withdrawal_policy content changed';
  END IF;
  IF (SELECT count(*) FROM public.admin_audit_log WHERE action = 'member_withdrawal_policy_update') - v_waudit_before <> 1 THEN
    RAISE EXCEPTION 'VERIFY: member_withdrawal_policy audit row';
  END IF;

  -- 5-7-3. 고지 원문(결제 회원·문의 있음)에 새 ticketsPayer 가 보존 기간 숫자로 채워져 들어간다
  v_notice := public.member_withdrawal_notice_text('request',
    jsonb_build_object('hadPayment', true, 'hasOrdersOrAttempts', true, 'ticketCount', 1, 'pendingTicketCount', 0,
                       'balance', jsonb_build_object('forfeitTotal', 0), 'marketingAgreed', false), NULL);
  IF v_notice IS NULL OR position(replace(replace(w_paths[3][3],
         '{결제문의보존기간}', public.member_withdrawal_policy_days('payerTicketRetentionYears')::text),
         '{환불문의보존기간}', public.member_withdrawal_policy_days('payerRefundTicketRetentionYears')::text) IN v_notice) = 0 THEN
    RAISE EXCEPTION 'VERIFY: payer notice does not contain new ticketsPayer line';
  END IF;

  -- 5-7-4. 실제 회원마다 get_member_withdrawal_notice 가 고지 원문을 만들고(오류 없음), 옛 ticketsPayer 표현이 없다
  v_checked := 0;
  v_payer_ticket_hits := 0;
  FOR v_member IN
    SELECT p.id FROM public.profiles p JOIN auth.users u ON u.id = p.id
     WHERE NOT public.is_internal_admin_account(u.email) AND p.withdrawn_at IS NULL
       AND ((p.provider = 'kakao' AND p.signup_completed IS TRUE) OR (p.provider IS DISTINCT FROM 'kakao' AND u.email_confirmed_at IS NOT NULL))
  LOOP
    v_member_notice := public.get_member_withdrawal_notice(v_member, 'self', NULL);
    v_text := v_member_notice ->> 'text';
    IF v_text IS NULL OR position('(환불 신청과 연결된 문의는 ' IN v_text) > 0
       OR position(replace(v_policy #>> '{texts,notice,termsVersion}', '{약관판}', (c_item_terms_version + 1)::text) IN v_text) = 0 THEN
      RAISE EXCEPTION 'VERIFY: member notice text for a member is invalid';
    END IF;
    IF position(c_tickets_payer_old_prefix IN v_text) > 0 THEN
      IF position('환불 신청과 연결된 문의는 분쟁 확인을 위해 마지막 처리일부터 ' IN v_text) = 0 THEN
        RAISE EXCEPTION 'VERIFY: member notice ticketsPayer line not updated';
      END IF;
      v_payer_ticket_hits := v_payer_ticket_hits + 1;
    END IF;
    v_checked := v_checked + 1;
  END LOOP;
  IF v_checked <> c_confirmed_count THEN
    RAISE EXCEPTION 'VERIFY: member notices checked % (expected %)', v_checked, c_confirmed_count;
  END IF;

  -- 5-8. 탈퇴 고지 원문이 새 약관 판을 가리키고, 스위치는 그대로 꺼짐
  v_notice := public.member_withdrawal_notice_text('self',
    jsonb_build_object('hadPayment', false, 'hasOrdersOrAttempts', false, 'ticketCount', 0, 'pendingTicketCount', 0,
                       'balance', jsonb_build_object('forfeitTotal', 0), 'marketingAgreed', false), NULL);
  IF v_notice IS NULL OR position(replace(v_policy #>> '{texts,notice,termsVersion}', '{약관판}', v_item_terms.version::text) IN v_notice) = 0 THEN
    RAISE EXCEPTION 'VERIFY: withdrawal notice does not cite terms version %', v_item_terms.version;
  END IF;
  IF (SELECT value -> 'selfAnonymizeEnabled' FROM public.system_settings WHERE key = 'member_withdrawal_policy') IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'VERIFY: selfAnonymizeEnabled changed';
  END IF;

  -- 5-9. 재동의 영향(정보): 동의 대상 회원 수, 지금까지 통과하던 회원 중 다시 동의해야 하는 수
  v_eligible := public.consent_eligible_member_count();
  SELECT count(*) INTO v_gated_after
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE NOT public.is_internal_admin_account(u.email) AND p.withdrawn_at IS NULL
     AND ((p.provider = 'kakao' AND p.signup_completed IS TRUE) OR (p.provider IS DISTINCT FROM 'kakao' AND u.email_confirmed_at IS NOT NULL))
     AND EXISTS (SELECT 1 FROM public.consent_missing_required(p.id, '[]'::jsonb));
  IF v_gated_after <> v_eligible THEN
    RAISE EXCEPTION 'VERIFY: % of % eligible members still pass consent gate after new versions', v_eligible - v_gated_after, v_eligible;
  END IF;

  -- 시행 기록(15번): 지문 일치, 고지 판정 S 기록 id·마지막 기록 id
  PERFORM public.record_admin_audit(v_actor, 'policy_upcoming_apply', 'system_settings', 'policy_upcoming_documents', NULL, NULL, NULL,
    jsonb_build_object('bundle', 'bundle15_policy_upcoming',
      'fingerprints_match', true,
      'documents_sha256', (SELECT jsonb_object_agg(d ->> 'key', d ->> 'sha256') FROM jsonb_array_elements(v_documents) d),
      'consent_sha256', (SELECT jsonb_object_agg(c ->> 'key', c ->> 'sha256') FROM jsonb_array_elements(v_consent_items) c),
      'continuity_s_id', v_cont -> 's_id',
      'continuity_last_id', v_cont -> 'last_id',
      'published_at', v_pub_old -> 'publishedAt',
      'effective_date', to_char(c_effective_date, 'YYYY-MM-DD'),
      'saved_at', to_jsonb(clock_timestamp())),
    NULL);
  RAISE NOTICE 'POLICY_TEXT OK: effective %, terms v%, privacy v%, eligible members %, newly re-consent % (others had not consented yet), member notices % (payer-ticket lines %)',
    v_date, v_item_terms.version, v_item_privacy.version, v_eligible, v_ok_before, v_checked, v_payer_ticket_hits;
END;
$policy_text$;

COMMIT;

-- 확인 조회(읽기만): SQL 편집기는 NOTICE 를 잘 보여 주지 않으므로 결과를 표로 본다. 실행 방식에 맞는 칸만 채운다.
--   게시 기대값: status upcoming, 문서 지문 3개·동의 항목 지문 2개·changes 지문 3개(앞 12자리)가 리허설 R4 (나) 값과 같음, 변경 건수 2/1/7.
--   시행 기대값: status applied, terms_version 2, privacy_version 2, eligible_members = c_confirmed_count,
--                audit_rows 2(약관 저장·탈퇴 정책 문구), self_anonymize_enabled false.
--   그만두기 기대값: status reverted, reverted_at 있음, applied_at 없음.
SELECT current_setting('bundle15.policy_text_mode', true) AS mode,
       u.value ->> 'status' AS status,
       u.value ->> 'publishedAt' AS published_at,
       u.value ->> 'appliedAt' AS applied_at,
       u.value ->> 'revertedAt' AS reverted_at,
       CASE WHEN current_setting('bundle15.policy_text_mode', true) = 'publish_upcoming' THEN
         (SELECT string_agg(d ->> 'key' || ' ' || left(d ->> 'sha256', 12) || ' changes ' || left(d ->> 'changesSha256', 12)
                            || ' (' || jsonb_array_length(d -> 'changes') || ')', ' / ' ORDER BY o)
            FROM jsonb_array_elements(u.value -> 'documents') WITH ORDINALITY AS e(d, o)) END AS documents,
       CASE WHEN current_setting('bundle15.policy_text_mode', true) = 'publish_upcoming' THEN
         (SELECT string_agg(c ->> 'key' || ' v' || (c ->> 'version') || ' ' || left(c ->> 'sha256', 12), ' / ' ORDER BY o)
            FROM jsonb_array_elements(u.value -> 'consentItems') WITH ORDINALITY AS e(c, o)) END AS consent_items,
       CASE WHEN current_setting('bundle15.policy_text_mode', true) = 'apply' THEN
         (SELECT version FROM public.signup_consent_items WHERE key = 'terms') END AS terms_version,
       CASE WHEN current_setting('bundle15.policy_text_mode', true) = 'apply' THEN
         (SELECT version FROM public.signup_consent_items WHERE key = 'privacy') END AS privacy_version,
       CASE WHEN current_setting('bundle15.policy_text_mode', true) = 'apply' THEN public.consent_eligible_member_count() END AS eligible_members,
       CASE WHEN current_setting('bundle15.policy_text_mode', true) = 'apply' THEN
         (SELECT count(*) FROM public.admin_audit_log WHERE details ->> 'bundle' = 'bundle10_policy_text') END AS audit_rows,
       CASE WHEN current_setting('bundle15.policy_text_mode', true) = 'apply' THEN
         (SELECT details ->> 'effective_date' FROM public.admin_audit_log WHERE action = 'site_footer_save' AND details ->> 'bundle' = 'bundle10_policy_text'
           ORDER BY created_at DESC LIMIT 1) END AS effective_date,
       (SELECT value -> 'selfAnonymizeEnabled' FROM public.system_settings WHERE key = 'member_withdrawal_policy') AS self_anonymize_enabled
  FROM (SELECT (SELECT value FROM public.system_settings WHERE key = 'policy_upcoming_documents') AS value) u;
