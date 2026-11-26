-- 21번 묶음 되돌리기(supabase/migrations/20261223100000_bundle21_dashboard_reports.sql 의 down). 계획 docs/plan-bundle21-dashboard.md 5·11절.
-- 21번 대시보드 코드를 먼저 되돌려 배포한 뒤에만 실행한다(새 코드는 함수가 없으면 해당 카드가 '확인 불가'가 된다).
-- 하는 것: 보고 함수 3개 지우기. 23번 함수(report_charge_daily 등)는 남긴다.
-- 하지 않는 것: 문구 설정 행(admin_dashboard_content)은 데이터 스크립트가 넣으므로 여기서 지우지 않는다.
-- 이 파일은 이력 행을 지우지 않는다. 다시 적용하려면 같은 거래에서 schema_migrations 의 '20261223100000' 행을 지운 뒤 마이그레이션과 이력 INSERT 를 넣는다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $precheck_bundle21_dashboard_down$
BEGIN
  IF to_regprocedure('public.report_market_daily(timestamptz,timestamptz,text)') IS NULL
     OR to_regprocedure('public.report_activity_daily(timestamptz,timestamptz,text)') IS NULL
     OR to_regprocedure('public.report_market_item_ranking(timestamptz,timestamptz,text,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'DOWN PRECHECK: bundle 21 report functions missing (not the bundle 21 state)';
  END IF;
END;
$precheck_bundle21_dashboard_down$;

-- [21번] 시작: 되돌림 ----------------------------------------------------------------------------------------------
DROP FUNCTION public.report_market_daily(timestamptz, timestamptz, text);
DROP FUNCTION public.report_activity_daily(timestamptz, timestamptz, text);
DROP FUNCTION public.report_market_item_ranking(timestamptz, timestamptz, text, text, integer);
-- [21번] 끝: 되돌림 ------------------------------------------------------------------------------------------------

DO $verify_bundle21_dashboard_down$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('report_market_daily', 'report_activity_daily', 'report_market_item_ranking')) THEN
    RAISE EXCEPTION 'DOWN VERIFY: bundle 21 leftovers';
  END IF;
END;
$verify_bundle21_dashboard_down$;

NOTIFY pgrst, 'reload schema';
