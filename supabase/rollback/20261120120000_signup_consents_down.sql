-- 되돌리기: 20261120120000_signup_consents.sql
-- 코드 배포 뒤에는 되돌리지 말 것(동의 기록 = 법적 증빙). 꼭 필요하면 먼저 user_consents·signup_consent_item_versions 를 백업한 뒤
-- 코드를 되돌리고(새 코드는 이 표·함수를 부른다) 이 파일을 실행한다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DROP POLICY IF EXISTS system_settings_signup_consent_texts_no_client_write ON public.system_settings;
DROP POLICY IF EXISTS system_settings_site_footer_content_no_client_write ON public.system_settings;
DELETE FROM public.system_settings WHERE key = 'signup_consent_texts';

DROP FUNCTION IF EXISTS public.complete_kakao_signup_with_consents(uuid, jsonb, text, text, text, text);
DROP FUNCTION IF EXISTS public.signup_consent_item_stats();
DROP FUNCTION IF EXISTS public.cancel_incomplete_kakao_signup(uuid);
DROP FUNCTION IF EXISTS public.revise_signup_consent_item(uuid, uuid, integer, text, boolean);
DROP FUNCTION IF EXISTS public.save_signup_consent_item(uuid, uuid, integer, text, text, boolean, text, integer, boolean, text, timestamptz, boolean);
DROP FUNCTION IF EXISTS public.consent_eligible_member_count();
DROP FUNCTION IF EXISTS public.get_my_missing_required_consents();
DROP FUNCTION IF EXISTS public.consent_validate_submission(jsonb);
DROP FUNCTION IF EXISTS public.record_user_consents(uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.consent_record_internal(uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.consent_latest_results(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.consent_items_error(jsonb, text);
DROP FUNCTION IF EXISTS public.consent_missing_required(uuid, jsonb);

-- 추가 전용 트리거가 TRUNCATE·DELETE 를 막으므로 표를 통째로 지운다(DROP 은 트리거를 거치지 않는다).
DROP TABLE IF EXISTS public.user_consents;
ALTER TABLE IF EXISTS public.signup_consent_items DROP CONSTRAINT IF EXISTS signup_consent_items_current_version_fkey;
DROP TABLE IF EXISTS public.signup_consent_item_versions;
DROP TABLE IF EXISTS public.signup_consent_items;

DROP FUNCTION IF EXISTS public.guard_user_consents_mutation();
DROP FUNCTION IF EXISTS public.prevent_signup_consent_item_version_mutation();
DROP FUNCTION IF EXISTS public.guard_signup_consent_item_update();
DROP FUNCTION IF EXISTS public.is_internal_admin_account(text);
DROP FUNCTION IF EXISTS public.consent_normalize_text(text);

NOTIFY pgrst, 'reload schema';
