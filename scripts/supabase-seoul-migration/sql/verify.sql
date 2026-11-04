-- 7절 검증 V-0(H-0)~V-6. AI가 MCP로 옛·새 프로젝트에 같은 쿼리를 실행해 결과를 비교한다(읽기 전용, 값이 아니라 개수·해시).
-- 각 블록은 SELECT 하나다. 블록 머리의 "-- [V-x]" 줄로 나눠 실행한다. 시간 값은 UTC로 문자열화한다(V-6에서 DB 시간대 UTC 확인).

-- [V-0] H-0 버전·기본값
select jsonb_build_object(
  'server_version', current_setting('server_version'),
  'auth_schema_migrations_max', (select max(version) from auth.schema_migrations),
  'storage_migrations_max', (select max(id) from storage.migrations),
  'auth_tables', (select jsonb_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'auth' and c.relkind in ('r','p')),
  'default_acl', (select jsonb_agg(jsonb_build_object('role', defaclrole::regrole::text, 'schema', coalesce(defaclnamespace::regnamespace::text, '*'),
                    'type', defaclobjtype, 'acl', defaclacl::text) order by defaclrole::regrole::text, defaclnamespace::regnamespace::text, defaclobjtype)
                   from pg_default_acl)
) as v0;

-- [V-1] 행 수(public·auth·supabase_migrations 전부). H-1에서 뺀 auth 5개 테이블은 비교 제외(새 쪽엔 시험 세션이 있을 수 있음)
select n.nspname || '.' || c.relname as tbl,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as row_count
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r','p') and n.nspname in ('public','auth','supabase_migrations')
 order by 1;

-- [V-1b] FK 고아 행(public·auth의 모든 FK, MATCH SIMPLE: 자식 키가 모두 NOT NULL인 행만 검사). 결과가 0행이어야 통과
with fk as (
  select con.conname, con.conrelid::regclass as child, con.confrelid::regclass as parent,
         array(select a.attname from unnest(con.conkey) with ordinality k(attnum, ord)
                 join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum order by k.ord) as ccols,
         array(select a.attname from unnest(con.confkey) with ordinality k(attnum, ord)
                 join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum order by k.ord) as pcols
    from pg_constraint con join pg_namespace n on n.oid = con.connamespace
   where con.contype = 'f' and n.nspname in ('public','auth')
), counted as (
  select child::text as child, conname,
         (xpath('/row/c/text()', query_to_xml(format(
            'select count(*) as c from %s ch where %s and not exists (select 1 from %s p where %s)',
            child,
            (select string_agg(format('ch.%I is not null', c), ' and ') from unnest(ccols) as c),
            parent,
            (select string_agg(format('p.%I is not distinct from ch.%I', u.pc, u.cc), ' and ') from unnest(pcols, ccols) as u(pc, cc))
          ), false, true, '')))[1]::text::bigint as orphans
    from fk
)
select child, conname, orphans from counted where orphans > 0
union all
select '(검사한 FK 수)', count(*)::text, 0 from counted;

-- [V-2] 내용 해시: public 테이블 전부
select n.nspname || '.' || c.relname as tbl,
       (xpath('/row/h/text()', query_to_xml(format(
          'select md5(coalesce(string_agg(x::text, E''\n'' order by x::text collate "C"), '''')) as h from %I.%I x',
          n.nspname, c.relname), false, true, '')))[1]::text as content_md5
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r','p') and n.nspname = 'public'
 order by 1;

-- [V-2b] 내용 해시: auth.users(고정 컬럼)·auth.identities
select 'auth.users' as tbl, md5(coalesce(string_agg(x, E'\n' order by x collate "C"), '')) as content_md5
  from (select concat_ws('|', id, email, md5(coalesce(encrypted_password, '')), email_confirmed_at, raw_app_meta_data, raw_user_meta_data) as x
          from auth.users) s
union all
select 'auth.identities', md5(coalesce(string_agg(x, E'\n' order by x collate "C"), ''))
  from (select concat_ws('|', provider, provider_id, user_id) as x from auth.identities) s;

-- [V-3] 스토리지: 버킷 설정과 (bucket_id, name, 크기) 집합
select 'buckets' as item, md5(string_agg(concat_ws('|', id, public, file_size_limit, allowed_mime_types::text), E'\n' order by id)) as md5, count(*) as n
  from storage.buckets
union all
select 'objects:' || bucket_id, md5(string_agg(name || '|' || coalesce(metadata->>'size', ''), E'\n' order by name collate "C")), count(*)
  from storage.objects group by bucket_id
order by 1;

-- [V-4] 객체 정의: 개수와 정의 해시
with f as (
  select p.oid::regprocedure::text as sig,
         concat_ws('|', md5(pg_get_functiondef(p.oid)), pg_get_userbyid(p.proowner), p.prosecdef, array_to_string(p.proconfig, ',')) as d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind in ('f','p')
), pol as (
  select concat_ws('|', tablename, policyname, permissive, roles::text, cmd, qual, with_check) as d
    from pg_policies where schemaname = 'public'
), trg as (
  select concat_ws('|', t.tgrelid::regclass::text, t.tgname, t.tgenabled, md5(pg_get_triggerdef(t.oid))) as d
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal and n.nspname in ('public','auth')
), rls as (
  select concat_ws('|', c.relname, c.relrowsecurity, c.relforcerowsecurity) as d
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p')
)
select 'tables' as item, (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p'))::text as value
union all select 'views', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('v','m'))::text
union all select 'functions', (select count(*) from f)::text
union all select 'functions_md5', (select md5(string_agg(sig || '|' || d, E'\n' order by sig collate "C")) from f)
union all select 'policies', (select count(*) from pol)::text
union all select 'policies_md5', (select md5(string_agg(d, E'\n' order by d collate "C")) from pol)
union all select 'triggers(public+auth)', (select count(*) from trg)::text
union all select 'triggers_md5', (select md5(string_agg(d, E'\n' order by d collate "C")) from trg)
union all select 'rls_md5', (select md5(string_agg(d, E'\n' order by d collate "C")) from rls)
union all select 'rls_off_tables', (select string_agg(c.relname, ',' order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                                     where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity);

-- [V-4b] V-4 해시가 다를 때만: 함수별 정의(어느 함수가 다른지 찾기)
select p.oid::regprocedure::text as sig,
       md5(concat_ws('|', md5(pg_get_functiondef(p.oid)), pg_get_userbyid(p.proowner), p.prosecdef, array_to_string(p.proconfig, ','))) as d
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind in ('f','p')
 order by 1;

-- [V-5] 권한: 함수·테이블·뷰·시퀀스·public 스키마의 ACL(PUBLIC 포함, 기본값이면 acldefault로 펼침)
with acl as (
  select 'f ' || p.oid::regprocedure::text as obj, a.*
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where n.nspname = 'public' and p.prokind in ('f','p')
  union all
  select 'r ' || c.oid::regclass::text, a.*
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join lateral aclexplode(coalesce(c.relacl, acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner))) a
   where n.nspname = 'public' and c.relkind in ('r','p','v','m','S')
  union all
  select 'n public', a.* from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a where n.nspname = 'public'
), rows as (
  select concat_ws('|', obj, case when grantee = 0 then 'PUBLIC' else grantee::regrole::text end, privilege_type, is_grantable) as d from acl
)
select 'acl_rows' as item, count(*)::text as value from rows
union all select 'acl_md5', md5(string_agg(d, E'\n' order by d collate "C")) from rows
union all select 'anon_exec_functions', (select count(*) from acl where obj like 'f %' and grantee = 'anon'::regrole and privilege_type = 'EXECUTE')::text
union all select 'authenticated_exec_functions', (select count(*) from acl where obj like 'f %' and grantee = 'authenticated'::regrole and privilege_type = 'EXECUTE')::text
union all select 'service_role_write_payment_tables', (select string_agg(distinct obj, ',') from acl
   where grantee = 'service_role'::regrole and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
     and obj in ('r payment_methods','r payment_provider_transactions','r payment_admin_actions','r payment_runtime_config',
                 'r payment_reconciliation_scheduler','r payment_reconciliation_runs','r payment_reconciliation_alerts','r payment_reconciliation_items'));

-- [V-5b] V-5 해시가 다를 때만: 객체별 ACL
select obj, string_agg(concat_ws(':', case when grantee = 0 then 'PUBLIC' else grantee::regrole::text end, privilege_type, is_grantable), ',' order by 1) as acl
  from (
    select 'f ' || p.oid::regprocedure::text as obj, a.*
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where n.nspname = 'public' and p.prokind in ('f','p')
    union all
    select 'r ' || c.oid::regclass::text, a.*
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(coalesce(c.relacl, acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner))) a
     where n.nspname = 'public' and c.relkind in ('r','p','v','m','S')
  ) x
 group by obj order by obj;

-- [V-6] 설정: 기본 권한, 확장 버전, role 설정, 시간대
select jsonb_build_object(
  'timezone', current_setting('TimeZone'),
  'db_timezone', (select setting from pg_settings where name = 'TimeZone'),
  'default_acl', (select jsonb_agg(jsonb_build_object('role', defaclrole::regrole::text, 'schema', coalesce(defaclnamespace::regnamespace::text, '*'),
                    'type', defaclobjtype, 'acl', defaclacl::text) order by defaclrole::regrole::text, defaclnamespace::regnamespace::text, defaclobjtype)
                   from pg_default_acl),
  'extensions', (select jsonb_object_agg(extname, extversion order by extname) from pg_extension),
  'role_settings', (select jsonb_object_agg(coalesce(r.rolname, '*') || '@' || coalesce(d.datname, '*'), s.setconfig order by r.rolname, d.datname)
                     from pg_db_role_setting s left join pg_roles r on r.oid = s.setrole left join pg_database d on d.oid = s.setdatabase
                    where r.rolname in ('anon','authenticated','authenticator','service_role','postgres') or s.setrole = 0)
) as v6;
