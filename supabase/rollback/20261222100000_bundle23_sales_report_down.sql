-- 23번 묶음 되돌리기(supabase/migrations/20261222100000_bundle23_sales_report.sql 의 down). 계획 docs/plan-bundle23-sales-csv.md 4-3.
-- 23번 코드(/admin/reports 화면·CSV route, 21번이 쓰면 21번 대시보드 코드)를 먼저 되돌려 배포한 뒤에만 실행한다(새 코드는 함수가 없으면 500).
-- 하는 것: ① 보고 함수 4개 지우기 ② 설정 행 sales_report_content 지우기(대표가 고친 문구도 지워진다 — 필요하면 먼저 값을 떠 둔다)
--   ③ 쓰기 막기 정책 지우기('[23번 기존 표 DDL]' 구역 — 표 잠금, 새벽 짧게. 정책이 남았는지 검사도 이 구역 안에 있어 리허설 light 사본은 함께 뺀다).
-- 하지 않는 것: 작업 기록(sales_report_export·sales_report_content_update)은 그대로 둔다(지울 수 없는 기록 표).
-- 이 파일은 이력 행을 지우지 않는다. 다시 적용하려면 같은 거래에서 schema_migrations 의 '20261222100000' 행을 지운 뒤 마이그레이션과 이력 INSERT 를 넣는다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $precheck_bundle23_sales_report_down$
BEGIN
  IF to_regprocedure('public.report_charge_daily(timestamptz,timestamptz)') IS NULL
     OR to_regprocedure('public.report_payment_lines(timestamptz,timestamptz)') IS NULL
     OR to_regprocedure('public.report_credit_flow(timestamptz,timestamptz)') IS NULL
     OR to_regprocedure('public.report_credit_usage_value(timestamptz,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'DOWN PRECHECK: bundle 23 report functions missing (not the bundle 23 state)';
  END IF;
END;
$precheck_bundle23_sales_report_down$;

-- [23번] 시작: 되돌림 ----------------------------------------------------------------------------------------------
DROP FUNCTION public.report_charge_daily(timestamptz, timestamptz);
DROP FUNCTION public.report_payment_lines(timestamptz, timestamptz);
DROP FUNCTION public.report_credit_flow(timestamptz, timestamptz);
DROP FUNCTION public.report_credit_usage_value(timestamptz, timestamptz);
DELETE FROM public.system_settings WHERE key = 'sales_report_content';
-- [23번] 끝: 되돌림 ------------------------------------------------------------------------------------------------

-- [23번 기존 표 DDL] 시작 ------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS system_settings_sales_report_content_no_client_write ON public.system_settings;
DO $verify_bundle23_sales_report_down_policy$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings'
              AND policyname = 'system_settings_sales_report_content_no_client_write') THEN
    RAISE EXCEPTION 'DOWN VERIFY: system_settings_sales_report_content_no_client_write policy left';
  END IF;
END;
$verify_bundle23_sales_report_down_policy$;
-- [23번 기존 표 DDL] 끝 --------------------------------------------------------------------------------------------

DO $verify_bundle23_sales_report_down$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('report_charge_daily', 'report_payment_lines', 'report_credit_flow', 'report_credit_usage_value'))
     OR EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'sales_report_content') THEN
    RAISE EXCEPTION 'DOWN VERIFY: bundle 23 leftovers';
  END IF;
END;
$verify_bundle23_sales_report_down$;

NOTIFY pgrst, 'reload schema';
