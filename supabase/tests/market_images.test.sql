-- 관리자 상품 이미지 라이브러리 M1·M2 SQL 테스트 (docs/admin-product-image-library-plan.md 2절, 6절 M1·M2)
-- pgTAP 없이 DO 블록 assert로 검증한다. 전부 begin … rollback 안에서 실행되고 fixture는
-- img-test- 접두 폴더·이미지·상품·카테고리와 아래 고정 UUID(1a6e0000-…)만 쓴다.
-- 실행: PG* 환경변수(PGHOST·PGPORT·PGUSER·PGPASSWORD·PGDATABASE) 또는 PGSERVICE로 접속 정보를 넘기고
--       psql -X -v ON_ERROR_STOP=1 -f supabase/tests/market_images.test.sql
--       (첫 실패 assert에서 중단되고 rollback된다. 통과하면 마지막에 'market_images: all passed' NOTICE)
-- 전제: 20261002014044_market_image_library, 20261002014653_market_image_refs 적용 후.
--
-- fixture ID
--   폴더 fa(이미지 있음) 1a6e0000-0000-4000-8000-0000000000fa / fe(빈 폴더) …00fe
--   이미지 01(살아 있는 상품이 사용) 02(삭제된 상품만 사용) 03(카테고리 항목이 사용) 04(미사용) …0001~0004
--   상품 e1(살아 있음, 이미지 01) e2(삭제됨, 이미지 02), 카테고리 그룹 c0, 항목 c1(기본 이미지 03)
--   해시는 encode(sha256('img-test-<n>'), 'hex')로 만든다.

begin;

set local plpgsql.check_asserts = on;

-- 0. fixture (postgres)
insert into public.market_image_folders (id, name)
values
  ('1a6e0000-0000-4000-8000-0000000000fa', 'img-test-folder-a'),
  ('1a6e0000-0000-4000-8000-0000000000fe', 'img-test-folder-empty');

insert into public.market_images (
  id, folder_id, display_name, storage_path, content_sha256, source_sha256, width, height, bytes
)
select
  ('1a6e0000-0000-4000-8000-00000000000' || v.n)::uuid,
  v.folder_id::uuid,
  'img-test-' || v.n || '.png',
  'thumbnails/' || left(h.content, 2) || '/' || h.content || '.webp',
  h.content,
  h.source,
  800, 600, 40000
from (values
  ('1', '1a6e0000-0000-4000-8000-0000000000fa'),
  ('2', null),
  ('3', null),
  ('4', '1a6e0000-0000-4000-8000-0000000000fa')
) as v(n, folder_id)
cross join lateral (
  select
    encode(sha256(convert_to('img-test-' || v.n, 'UTF8')), 'hex') as content,
    encode(sha256(convert_to('img-test-source-' || v.n, 'UTF8')), 'hex') as source
) as h;

insert into public.market_items (id, menu_entry_id, title, workspace_subject, thumbnail_image_id, deleted_at)
select v.id::uuid, m.id, v.title, m.workspace_subject, v.image_id::uuid, v.deleted_at
from (values
  ('1a6e0000-0000-4000-8000-0000000000e1', 'img-test-item-live', '1a6e0000-0000-4000-8000-000000000001', null::timestamptz),
  ('1a6e0000-0000-4000-8000-0000000000e2', 'img-test-item-deleted', '1a6e0000-0000-4000-8000-000000000002', now())
) as v(id, title, image_id, deleted_at)
cross join (
  select id, workspace_subject from public.market_menu_entries order by id limit 1
) as m;

insert into public.market_category_groups (id, workspace_subject, title)
values ('1a6e0000-0000-4000-8000-0000000000c0', 'korean', 'img-test-group');

insert into public.market_category_items (id, group_id, workspace_subject, title, default_image_id)
values ('1a6e0000-0000-4000-8000-0000000000c1', '1a6e0000-0000-4000-8000-0000000000c0', 'korean',
        'img-test-category-item', '1a6e0000-0000-4000-8000-000000000003');

do $$
begin
  assert (select count(*) from public.market_images where display_name like 'img-test-%') = 4,
    'fixture: 4 images';
  assert (select count(*) from public.market_items where title like 'img-test-item-%') = 2,
    'fixture: 2 items (menu entry required)';
end;
$$;

-- 1. M1 구조·권한: RLS, 정책 0건, 직접 권한 회수, 버킷, 제약·인덱스
do $$
declare
  t text;
  p text;
  r text;
  v_bucket record;
begin
  assert (select bool_and(relrowsecurity) from pg_class
          where oid in ('public.market_image_folders'::regclass, 'public.market_images'::regclass)),
    'M1: RLS enabled on both tables';
  assert (select count(*) from pg_policies
          where schemaname = 'public' and tablename in ('market_image_folders', 'market_images')) = 0,
    'M1: no policies on image tables';

  foreach t in array array['public.market_image_folders', 'public.market_images'] loop
    foreach r in array array['anon', 'authenticated'] loop
      foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
        assert not has_table_privilege(r, t, p), format('M1: %s has no %s on %s', r, p, t);
      end loop;
    end loop;
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      assert has_table_privilege('service_role', t, p), format('M1: service_role has %s on %s', p, t);
    end loop;
    assert not exists (
      select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
      where c.oid = t::regclass
        and a.grantee in (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
    ), format('M1: relacl of %s has no PUBLIC/anon/authenticated entry', t);
  end loop;

  select public, file_size_limit, allowed_mime_types into v_bucket
  from storage.buckets where id = 'market-images';
  assert found, 'M1: bucket market-images exists';
  assert v_bucket.public and v_bucket.file_size_limit = 2097152
         and v_bucket.allowed_mime_types = array['image/webp'],
    format('M1: bucket public/2MB/webp (got %s)', v_bucket);

  assert exists (
    select 1 from pg_constraint
    where conrelid = 'public.market_images'::regclass
      and pg_get_constraintdef(oid) = 'UNIQUE (content_sha256)'
  ), 'M1: content_sha256 unique';
  assert exists (
    select 1 from pg_constraint
    where conrelid = 'public.market_images'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%content_sha256 ~ %^[0-9a-f]{64}$%'
  ), 'M1: content_sha256 hex check';
  assert exists (
    select 1 from pg_constraint
    where conrelid = 'public.market_images'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%source_sha256 ~ %^[0-9a-f]{64}$%'
  ), 'M1: source_sha256 hex check';
  assert exists (
    select 1 from pg_index x
    join pg_attribute a on a.attrelid = x.indrelid and a.attnum = x.indkey[0]
    where x.indrelid = 'public.market_images'::regclass
      and x.indnatts = 1 and a.attname = 'source_sha256' and not x.indisunique
  ), 'M1: source_sha256 non-unique index';
  assert not exists (
    select 1 from pg_index x
    join pg_attribute a on a.attrelid = x.indrelid and a.attnum = x.indkey[0]
    where x.indrelid = 'public.market_images'::regclass
      and x.indnatts = 1 and a.attname = 'source_sha256' and x.indisunique
  ), 'M1: source_sha256 is not unique';
  assert exists (
    select 1 from pg_constraint
    where conrelid = 'public.market_images'::regclass
      and confrelid = 'public.market_image_folders'::regclass
      and contype = 'f' and confdeltype = 'r'
  ), 'M1: folder_id FK ON DELETE RESTRICT';
  assert exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'market_image_folders'
      and indexdef like 'CREATE UNIQUE INDEX%lower(name)%'
  ), 'M1: unique (lower(name)) on folders';
end;
$$;

-- 2. M2 구조·권한: FK restrict, RPC 속성·EXECUTE 권한
do $$
declare
  f constant text := 'public.delete_market_image(uuid)';
  r text;
begin
  assert exists (
    select 1 from pg_constraint
    where conname = 'market_items_thumbnail_image_id_fkey'
      and conrelid = 'public.market_items'::regclass
      and confrelid = 'public.market_images'::regclass
      and confdeltype = 'r'
  ), 'M2: market_items.thumbnail_image_id FK ON DELETE RESTRICT';
  assert exists (
    select 1 from pg_constraint
    where conname = 'market_category_items_default_image_id_fkey'
      and conrelid = 'public.market_category_items'::regclass
      and confrelid = 'public.market_images'::regclass
      and confdeltype = 'r'
  ), 'M2: market_category_items.default_image_id FK ON DELETE RESTRICT';

  assert (select prosecdef and provolatile = 'v'
                 and proconfig = array['search_path=public, pg_temp']
          from pg_proc where oid = f::regprocedure),
    'M2: delete_market_image is SECURITY DEFINER, VOLATILE, search_path=public, pg_temp';
  foreach r in array array['anon', 'authenticated'] loop
    assert not has_function_privilege(r, f, 'execute'), format('M2: %s cannot execute %s', r, f);
  end loop;
  assert has_function_privilege('service_role', f, 'execute'), 'M2: service_role can execute';
  assert (select proacl is not null from pg_proc where oid = f::regprocedure)
         and not exists (
           select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
           where p.oid = f::regprocedure and a.grantee = 0
         ), 'M2: proacl has no PUBLIC (=X) entry';
end;
$$;

-- 3. 제약 동작 (postgres)
do $$
declare
  v_h1 constant text := encode(sha256(convert_to('img-test-1', 'UTF8')), 'hex');
  v_s1 constant text := encode(sha256(convert_to('img-test-source-1', 'UTF8')), 'hex');
  v_h5 constant text := encode(sha256(convert_to('img-test-5', 'UTF8')), 'hex');
  v_name text;
begin
  -- 해시 중복 거부 (content_sha256 unique)
  begin
    insert into public.market_images (display_name, storage_path, content_sha256, source_sha256, width, height, bytes)
    values ('img-test-dup.png', 'thumbnails/dup/img-test-dup.webp', v_h1, v_h5, 1, 1, 1);
    raise exception 'duplicate content_sha256: expected 23505';
  exception when unique_violation then
    null;
  end;

  -- 경로 중복 거부 (storage_path unique)
  begin
    insert into public.market_images (display_name, storage_path, content_sha256, source_sha256, width, height, bytes)
    values ('img-test-dup.png', 'thumbnails/' || left(v_h1, 2) || '/' || v_h1 || '.webp', v_h5, v_h5, 1, 1, 1);
    raise exception 'duplicate storage_path: expected 23505';
  exception when unique_violation then
    null;
  end;

  -- 형식 거부: 대문자/짧은 해시, png, 0 크기
  begin
    insert into public.market_images (display_name, storage_path, content_sha256, source_sha256, width, height, bytes)
    values ('img-test-bad.png', 'thumbnails/bad/1.webp', upper(v_h5), v_h5, 1, 1, 1);
    raise exception 'uppercase content_sha256: expected 23514';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.market_images (display_name, storage_path, content_sha256, source_sha256, width, height, bytes)
    values ('img-test-bad.png', 'thumbnails/bad/2.webp', v_h5, 'abc', 1, 1, 1);
    raise exception 'short source_sha256: expected 23514';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.market_images (display_name, storage_path, content_sha256, source_sha256, width, height, bytes, mime_type)
    values ('img-test-bad.png', 'thumbnails/bad/3.webp', v_h5, v_h5, 1, 1, 1, 'image/png');
    raise exception 'mime_type png: expected 23514';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.market_images (display_name, storage_path, content_sha256, source_sha256, width, height, bytes)
    values ('img-test-bad.png', 'thumbnails/bad/4.webp', v_h5, v_h5, 0, 1, 1);
    raise exception 'width 0: expected 23514';
  exception when check_violation then
    null;
  end;

  -- source_sha256은 비유니크: 다른 결과물이 같은 원본 해시를 가질 수 있다
  insert into public.market_images (display_name, storage_path, content_sha256, source_sha256, width, height, bytes)
  values ('img-test-5.png', 'thumbnails/' || left(v_h5, 2) || '/' || v_h5 || '.webp', v_h5, v_s1, 1, 1, 1);
  delete from public.market_images where content_sha256 = v_h5;

  -- 폴더 이름: 대소문자 무시 중복 거부, 앞뒤 공백·빈 값·61자 거부
  begin
    insert into public.market_image_folders (name) values ('IMG-TEST-Folder-A');
    raise exception 'folder name case-insensitive duplicate: expected 23505';
  exception when unique_violation then
    null;
  end;
  foreach v_name in array array[' img-test-pad', 'img-test-pad ', '', repeat('x', 61)] loop
    begin
      insert into public.market_image_folders (name) values (v_name);
      raise exception 'folder name %: expected 23514', quote_literal(v_name);
    exception when check_violation then
      null;
    end;
  end loop;

  -- 이미지가 있는 폴더 삭제 거부 (restrict), 빈 폴더 삭제 성공
  begin
    delete from public.market_image_folders where id = '1a6e0000-0000-4000-8000-0000000000fa';
    raise exception 'delete non-empty folder: expected 23503';
  exception when foreign_key_violation then
    null;
  end;
  delete from public.market_image_folders where id = '1a6e0000-0000-4000-8000-0000000000fe';
  assert not exists (select 1 from public.market_image_folders where id = '1a6e0000-0000-4000-8000-0000000000fe'),
    'empty folder deleted';

  -- 참조 중인 이미지 직접 삭제는 FK가 거부한다(삭제된 상품의 참조 포함 — RPC가 필요한 이유)
  begin
    delete from public.market_images where id = '1a6e0000-0000-4000-8000-000000000001';
    raise exception 'delete image used by live item: expected 23503';
  exception when foreign_key_violation then
    null;
  end;
  begin
    delete from public.market_images where id = '1a6e0000-0000-4000-8000-000000000002';
    raise exception 'delete image used by deleted item: expected 23503';
  exception when foreign_key_violation then
    null;
  end;
  begin
    delete from public.market_images where id = '1a6e0000-0000-4000-8000-000000000003';
    raise exception 'delete image used by category item: expected 23503';
  exception when foreign_key_violation then
    null;
  end;
end;
$$;

-- 4. 일반 사용자 직접 접근 거부 (authenticated, anon)
set local role authenticated;

do $$
begin
  begin
    perform 1 from public.market_images;
    raise exception 'authenticated select market_images: expected 42501';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform 1 from public.market_image_folders;
    raise exception 'authenticated select market_image_folders: expected 42501';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.market_image_folders (name) values ('img-test-by-user');
    raise exception 'authenticated insert market_image_folders: expected 42501';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.market_images (display_name, storage_path, content_sha256, source_sha256, width, height, bytes)
    values ('img-test-user.png', 'thumbnails/u/u.webp', repeat('0', 64), repeat('0', 64), 1, 1, 1);
    raise exception 'authenticated insert market_images: expected 42501';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.delete_market_image('1a6e0000-0000-4000-8000-000000000004');
    raise exception 'authenticated execute delete_market_image: expected 42501';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
set local role anon;

do $$
begin
  begin
    perform 1 from public.market_images;
    raise exception 'anon select market_images: expected 42501';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.delete_market_image('1a6e0000-0000-4000-8000-000000000004');
    raise exception 'anon execute delete_market_image: expected 42501';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;

-- 5. delete_market_image RPC (service_role)
set local role service_role;

do $$
declare
  v_r jsonb;
  v_h2 constant text := encode(sha256(convert_to('img-test-2', 'UTF8')), 'hex');
begin
  v_r := public.delete_market_image(null);
  assert v_r->>'code' = 'INVALID_INPUT', 'null id: ' || v_r::text;
  v_r := public.delete_market_image(gen_random_uuid());
  assert v_r->>'code' = 'NOT_FOUND', 'unknown id: ' || v_r::text;

  -- 살아 있는 상품이 사용 → IN_USE + 상품 목록
  v_r := public.delete_market_image('1a6e0000-0000-4000-8000-000000000001');
  assert v_r->>'code' = 'IN_USE'
         and v_r->'items' = jsonb_build_array(jsonb_build_object(
           'id', '1a6e0000-0000-4000-8000-0000000000e1', 'title', 'img-test-item-live'))
         and v_r->'categoryItems' = '[]'::jsonb,
    'IN_USE by live item: ' || v_r::text;
  assert exists (select 1 from public.market_images where id = '1a6e0000-0000-4000-8000-000000000001'),
    'IN_USE keeps image row';

  -- 카테고리 항목이 사용 → IN_USE + 항목 목록
  v_r := public.delete_market_image('1a6e0000-0000-4000-8000-000000000003');
  assert v_r->>'code' = 'IN_USE'
         and v_r->'items' = '[]'::jsonb
         and v_r->'categoryItems' = jsonb_build_array(jsonb_build_object(
           'id', '1a6e0000-0000-4000-8000-0000000000c1', 'title', 'img-test-category-item')),
    'IN_USE by category item: ' || v_r::text;

  -- 삭제된 상품만 사용 → 참조를 비우고 삭제
  v_r := public.delete_market_image('1a6e0000-0000-4000-8000-000000000002');
  assert (v_r->>'ok')::boolean
         and (v_r->>'clearedDeletedItems')::int = 1
         and v_r->>'storagePath' = 'thumbnails/' || left(v_h2, 2) || '/' || v_h2 || '.webp',
    'deleted-item-only image removed: ' || v_r::text;
  assert not exists (select 1 from public.market_images where id = '1a6e0000-0000-4000-8000-000000000002'),
    'image 02 row deleted';
  assert (select thumbnail_image_id is null from public.market_items
          where id = '1a6e0000-0000-4000-8000-0000000000e2'),
    'deleted item reference cleared';

  -- 미사용 → 삭제, 두 번째 호출은 NOT_FOUND
  v_r := public.delete_market_image('1a6e0000-0000-4000-8000-000000000004');
  assert (v_r->>'ok')::boolean and (v_r->>'clearedDeletedItems')::int = 0, 'unused image removed: ' || v_r::text;
  v_r := public.delete_market_image('1a6e0000-0000-4000-8000-000000000004');
  assert v_r->>'code' = 'NOT_FOUND', 'second delete NOT_FOUND: ' || v_r::text;

  -- 상품을 소프트 삭제하면 더 이상 사용 중이 아니다
  update public.market_items set deleted_at = now() where id = '1a6e0000-0000-4000-8000-0000000000e1';
  v_r := public.delete_market_image('1a6e0000-0000-4000-8000-000000000001');
  assert (v_r->>'ok')::boolean and (v_r->>'clearedDeletedItems')::int = 1,
    'image freed after item soft delete: ' || v_r::text;
end;
$$;

reset role;

do $$ begin raise notice 'market_images: all passed'; end; $$;

rollback;
