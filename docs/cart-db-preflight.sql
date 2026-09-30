-- 장바구니 구현 Phase 0용. 권한 있는 별도 연결에서 읽기 전용으로 실행한다.
-- 이 계획 작성 작업에서는 실행하지 않았다. 결과에 운영 사용자/잔액 행을 포함하지 않는다.
BEGIN TRANSACTION READ ONLY;

SELECT current_database() AS database_name, current_user AS audit_role,
       current_setting('server_version') AS postgres_version;

-- 테이블 존재·RLS·owner. 향후 신규 cart 테이블도 같은 질의로 확인한다.
SELECT n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity,
       pg_catalog.pg_get_userbyid(c.relowner) AS owner
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
  AND (c.relname ~ '^(market_|credit_|payment_|refund_)' OR c.relname = 'profiles')
ORDER BY c.relname;

-- 실제 FK/check/unique 정의와 convalidated=false 여부를 확인한다.
SELECT r.relname AS table_name, c.conname, c.contype, c.convalidated,
       pg_catalog.pg_get_constraintdef(c.oid, true) AS definition
FROM pg_catalog.pg_constraint c
JOIN pg_catalog.pg_class r ON r.oid = c.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = r.relnamespace
WHERE n.nspname = 'public'
  AND (r.relname ~ '^(market_|credit_|payment_|refund_)' OR r.relname = 'profiles')
ORDER BY r.relname, c.conname;

SELECT t.relname AS table_name, i.relname AS index_name,
       x.indisunique, x.indisvalid, x.indisready,
       pg_catalog.pg_get_indexdef(i.oid) AS definition
FROM pg_catalog.pg_index x
JOIN pg_catalog.pg_class t ON t.oid=x.indrelid
JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid
JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname='public' AND t.relname ~ '^(market_|credit_|payment_|refund_)'
ORDER BY t.relname, i.relname;

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname IN ('public','storage')
  AND (tablename ~ '^(market_|credit_|payment_|refund_)' OR tablename IN ('profiles','objects','buckets'))
ORDER BY schemaname, tablename, policyname;

-- RLS와 별도로 authenticated의 직접 DML 권한이 열려 있는지 확인한다.
SELECT n.nspname AS schema_name, c.relname AS table_name, c.relacl, r.role_name,
       pg_catalog.has_table_privilege(r.role_name, c.oid, 'SELECT') AS can_select,
       pg_catalog.has_table_privilege(r.role_name, c.oid, 'INSERT') AS can_insert,
       pg_catalog.has_table_privilege(r.role_name, c.oid, 'UPDATE') AS can_update,
       pg_catalog.has_table_privilege(r.role_name, c.oid, 'DELETE') AS can_delete
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) r(role_name)
WHERE c.relkind IN ('r','p') AND (
  (n.nspname='public' AND c.relname ~ '^(market_|credit_|payment_|refund_)')
  OR (n.nspname='storage' AND c.relname IN ('objects','buckets'))
)
ORDER BY n.nspname, c.relname, r.role_name;

SELECT n.nspname, p.proname,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef, p.proconfig, p.proacl,
       pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
       pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
       pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute,
       pg_catalog.pg_get_functiondef(p.oid) AS function_definition
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prokind='f'
  AND p.proname ~ '(market|credit|payment|refund)'
ORDER BY p.proname, arguments;

SELECT c.relname AS table_name, t.tgname,
       pg_catalog.pg_get_triggerdef(t.oid, true) AS definition
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND NOT t.tgisinternal
  AND c.relname ~ '^(market_|credit_|payment_|refund_)'
ORDER BY c.relname, t.tgname;

SELECT n.nspname, pg_catalog.pg_get_userbyid(d.defaclrole) AS owner,
       d.defaclobjtype, d.defaclacl
FROM pg_catalog.pg_default_acl d
LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace;

SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets WHERE id='market-files';

-- 활성 파일 참조와 실제 object의 정합성. 경로나 사용자 식별자는 출력하지 않는다.
WITH refs AS (
  SELECT 'legacy' AS kind, storage_bucket, storage_path
  FROM public.market_item_files WHERE is_active AND deleted_at IS NULL
  UNION ALL
  SELECT 'subproduct', storage_bucket, storage_path
  FROM public.market_subproduct_files WHERE is_active AND deleted_at IS NULL
  UNION ALL
  SELECT 'sample', storage_bucket, storage_path
  FROM public.market_item_sample_pages WHERE is_active AND deleted_at IS NULL
)
SELECT r.kind, count(*) AS active_references,
       count(*) FILTER (WHERE o.id IS NULL) AS missing_objects
FROM refs r LEFT JOIN storage.objects o
  ON o.bucket_id=r.storage_bucket AND o.name=r.storage_path
GROUP BY r.kind ORDER BY r.kind;

WITH refs AS (
  SELECT storage_bucket, storage_path FROM public.market_item_files WHERE is_active AND deleted_at IS NULL
  UNION ALL
  SELECT storage_bucket, storage_path FROM public.market_subproduct_files WHERE is_active AND deleted_at IS NULL
  UNION ALL
  SELECT storage_bucket, storage_path FROM public.market_item_sample_pages WHERE is_active AND deleted_at IS NULL
), duplicate_paths AS (
  SELECT storage_bucket, storage_path FROM refs GROUP BY storage_bucket, storage_path HAVING count(*)>1
)
SELECT count(*) AS multiply_referenced_paths FROM duplicate_paths;

-- 중복 object 참조는 기존 PDF 공유일 수도 있으므로 자동 삭제/UNIQUE 추가하지 않는다.
-- 비참조 object는 업로드 초안/구버전 여부를 분류하고 데이터 변경 없이 보고한다.
SELECT count(*) AS unreferenced_market_objects
FROM storage.objects o WHERE o.bucket_id='market-files'
AND NOT EXISTS (SELECT 1 FROM public.market_item_files f WHERE f.storage_bucket=o.bucket_id AND f.storage_path=o.name)
AND NOT EXISTS (SELECT 1 FROM public.market_subproduct_files f WHERE f.storage_bucket=o.bucket_id AND f.storage_path=o.name)
AND NOT EXISTS (SELECT 1 FROM public.market_item_sample_pages f WHERE f.storage_bucket=o.bucket_id AND f.storage_path=o.name);

-- migration history 테이블의 위치를 확인한 뒤 별도로 version 목록을 조회한다.
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema='supabase_migrations';

COMMIT;
