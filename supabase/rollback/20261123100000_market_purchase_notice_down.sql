-- 되돌리기: 20261123100000_market_purchase_notice.sql
-- 코드 배포 뒤에는 되돌리지 말 것(구매 고지 동의 기록 = 증빙, 새 코드는 이 설정·열·함수를 부른다).
-- 꼭 필요하면 먼저 market_purchase_notice_acks 를 백업하고 코드를 되돌린 뒤 이 파일을 실행한다.
-- 실행 뒤 다시 적용하려면 supabase_migrations.schema_migrations 의 '20261123100000' 행도 지운다
-- (남겨 두면 다시 적용할 때 이력 INSERT 가 중복으로 실패하거나 db push 가 건너뛴다).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DROP FUNCTION IF EXISTS public.record_purchase_notice_ack(uuid, uuid, text);

-- 추가 전용 트리거가 TRUNCATE·DELETE 를 막으므로 표를 통째로 지운다(DROP 은 트리거를 거치지 않는다).
DROP TABLE IF EXISTS public.market_purchase_notice_acks;
DROP FUNCTION IF EXISTS public.guard_market_purchase_notice_acks_mutation();

ALTER TABLE public.market_file_types DROP COLUMN IF EXISTS required_program;

DROP POLICY IF EXISTS system_settings_market_purchase_policy_no_client_write ON public.system_settings;
DELETE FROM public.system_settings WHERE key = 'market_purchase_policy';

NOTIFY pgrst, 'reload schema';
