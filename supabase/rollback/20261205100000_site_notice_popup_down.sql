-- 되돌리기: 20261205100000_site_notice_popup.sql(15번 공지 팝업, 계획 docs/plan-bundle15-notice-popup.md 4-5).
-- 순서: 코드를 15번 이전으로 되돌려 배포한 뒤에만 이 파일을 실행한다.
--   고지 기간(게시 행 'upcoming')에 되돌리면 고지가 끊긴 것으로 본다. 되돌리기 전에 관리자 카드에서 팝업을 끄고 저장한다(10절 되돌리기).
-- 새벽에 실행한다: DROP TRIGGER·DROP POLICY 는 system_settings·signup_consent_items 에 ACCESS EXCLUSIVE(읽기도 막음)를 잡는다.
--   lock_timeout 3초 안에 잡지 못하면 전체가 취소된다.
-- 지우는 순서: 잠금 트리거 3개 → 트리거 함수 3개 → 팝업 함수 2개·판정 함수(좋은 기록 판정 포함) → site_notice_popup 정책 → site_notice_popup 행.
-- 남기는 것: policy_upcoming_documents 행(고지 증빙)과 그 쓰기 막기 정책(…_policy_upcoming_documents_no_client_write) — 짝으로 둔다.
--   작업 기록(admin_audit_log)은 추가 전용이라 남는다.
-- 다시 적용하려면 같은 트랜잭션에서 schema_migrations 의 '20261205100000' 행을 지운 뒤 마이그레이션과 이력 INSERT 를 넣는다
--   (policy_upcoming_documents 정책은 없을 때만 만들므로 다시 적용해도 멈추지 않는다).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- 사전 점검: 팝업이 켜져 있으면 멈춘다(먼저 관리자 카드에서 끄고 저장해 끈 기록을 남긴다 — 10절 되돌리기).
DO $down_site_notice_popup_precheck$
BEGIN
  IF (SELECT value -> 'enabled' FROM public.system_settings WHERE key = 'site_notice_popup') = 'true'::jsonb THEN
    RAISE EXCEPTION 'DOWN: site_notice_popup is enabled — turn popup off first (admin card) before rollback';
  END IF;
END;
$down_site_notice_popup_precheck$;

DROP TRIGGER lock_policy_documents_during_notice ON public.system_settings;
DROP TRIGGER lock_withdrawal_texts_during_notice ON public.system_settings;
DROP TRIGGER lock_consent_items_during_notice ON public.signup_consent_items;

DROP FUNCTION public.lock_policy_documents_during_notice_fn();
DROP FUNCTION public.lock_withdrawal_texts_during_notice_fn();
DROP FUNCTION public.lock_consent_items_during_notice_fn();

DROP FUNCTION public.save_site_notice_popup(uuid, integer, boolean, text, text, text, text, timestamptz, timestamptz);
DROP FUNCTION public.site_notice_popup_content_sha256(text, text, text, text);
DROP FUNCTION public.policy_upcoming_notice_continuity(date, date);
DROP FUNCTION public.policy_upcoming_notice_record_good(jsonb, timestamptz, date, text);

DROP POLICY system_settings_site_notice_popup_no_client_write ON public.system_settings;

DELETE FROM public.system_settings WHERE key = 'site_notice_popup';

DO $down_site_notice_popup_verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
              AND tgname IN ('lock_policy_documents_during_notice', 'lock_withdrawal_texts_during_notice', 'lock_consent_items_during_notice')) THEN
    RAISE EXCEPTION 'DOWN VERIFY: lock triggers remain';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND p.proname IN ('lock_policy_documents_during_notice_fn', 'lock_withdrawal_texts_during_notice_fn', 'lock_consent_items_during_notice_fn',
                                  'save_site_notice_popup', 'site_notice_popup_content_sha256', 'policy_upcoming_notice_continuity',
                                  'policy_upcoming_notice_record_good')) THEN
    RAISE EXCEPTION 'DOWN VERIFY: functions remain';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings'
              AND policyname = 'system_settings_site_notice_popup_no_client_write') THEN
    RAISE EXCEPTION 'DOWN VERIFY: site_notice_popup policy remains';
  END IF;
  IF EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'site_notice_popup') THEN
    RAISE EXCEPTION 'DOWN VERIFY: site_notice_popup row remains';
  END IF;
  -- 게시 행 정책은 남는다(행이 있든 없든 짝으로 둔다).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings'
                  AND policyname = 'system_settings_policy_upcoming_documents_no_client_write') THEN
    RAISE EXCEPTION 'DOWN VERIFY: policy_upcoming_documents policy must stay';
  END IF;
END;
$down_site_notice_popup_verify$;

NOTIFY pgrst, 'reload schema';
