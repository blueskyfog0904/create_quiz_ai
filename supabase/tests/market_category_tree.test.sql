-- 문제마켓 카테고리 트리(depth 1~5) SQL 테스트 (docs/market-category-tree-plan.md 3.2·3.7)
-- pgTAP 없이 DO 블록 assert로 검증한다. 전부 begin … rollback 안에서 실행되고 fixture는
-- tree-test- 접두 칸·상품과 아래 고정 UUID(7ee00000-…)만 쓴다.
-- 실행: psql -X -v ON_ERROR_STOP=1 -f supabase/tests/market_category_tree.test.sql
--       Supabase MCP execute_sql로 돌릴 때는 begin/rollback 줄을 빼고 끝에 강제 raise exception을 붙여
--       암묵 트랜잭션 전체가 롤백되게 한다(실패 시 열린 트랜잭션이 남지 않음). 통과 판정은 그 강제 메시지일 때만.
--       (첫 실패 assert에서 중단되고 rollback된다. 통과하면 마지막에 'market_category_tree: all passed' NOTICE)
-- 전제: market_category_tree_expand 적용 후.
--
-- fixture ID
--   국어 d1 …0001 → d2 …0002 → d3 …0003 → d4 …0004 → d5 …0005(depth5)
--   국어 leaf …0010(d1 아래 depth2, 상품·자식 없음), 영어 d1 …00e1
--   상품 a1(d2에 연결)

begin;

set local plpgsql.check_asserts = on;

-- 0. fixture
insert into public.market_category_items (id, parent_id, depth, workspace_subject, title)
values
  ('7ee00000-0000-4000-8000-000000000001', null, 1, 'korean', 'tree-test-d1'),
  ('7ee00000-0000-4000-8000-0000000000e1', null, 1, 'english', 'tree-test-en-d1');

insert into public.market_category_items (id, parent_id, depth, workspace_subject, title)
values ('7ee00000-0000-4000-8000-000000000002', '7ee00000-0000-4000-8000-000000000001', 2, 'korean', 'tree-test-d2');
insert into public.market_category_items (id, parent_id, depth, workspace_subject, title)
values ('7ee00000-0000-4000-8000-000000000003', '7ee00000-0000-4000-8000-000000000002', 3, 'korean', 'tree-test-d3');
insert into public.market_category_items (id, parent_id, depth, workspace_subject, title)
values ('7ee00000-0000-4000-8000-000000000004', '7ee00000-0000-4000-8000-000000000003', 4, 'korean', 'tree-test-d4');
insert into public.market_category_items (id, parent_id, depth, workspace_subject, title)
values ('7ee00000-0000-4000-8000-000000000005', '7ee00000-0000-4000-8000-000000000004', 5, 'korean', 'tree-test-d5');
insert into public.market_category_items (id, parent_id, depth, workspace_subject, title)
values ('7ee00000-0000-4000-8000-000000000010', '7ee00000-0000-4000-8000-000000000001', 2, 'korean', 'tree-test-leaf');

insert into public.market_items (id, menu_entry_id, title, workspace_subject, category_item_id)
select '7ee00000-0000-4000-8000-0000000000a1'::uuid, m.id, 'tree-test-item', 'korean',
       '7ee00000-0000-4000-8000-000000000002'::uuid
from (
  select id from public.market_menu_entries where workspace_subject = 'korean' order by id limit 1
) as m;

do $$
begin
  assert (select count(*) from public.market_category_items where title like 'tree-test-%') = 7,
    'fixture: 7 category nodes (depth1~5)';
  assert (select depth from public.market_category_items where id = '7ee00000-0000-4000-8000-000000000005') = 5,
    'fixture: depth5 node';
  assert exists (select 1 from public.market_items where id = '7ee00000-0000-4000-8000-0000000000a1'),
    'fixture: item linked to d2 (korean menu entry required)';
end;
$$;

-- 1. 구조: 제약·인덱스·트리거·상품 FK·정책
do $$
begin
  assert exists (select 1 from pg_constraint where conname = 'market_category_items_depth_range'),
    'depth range check exists';
  assert exists (select 1 from pg_constraint where conname = 'market_category_items_root_parent'),
    'root parent check exists';
  assert (select confdeltype from pg_constraint where conname = 'market_category_items_parent_subject_fkey') = 'r',
    'parent FK is on delete restrict';
  assert (select confdeltype from pg_constraint where conname = 'market_items_category_item_subject_fkey') = 'r',
    'item FK is on delete restrict';
  assert exists (select 1 from pg_indexes where indexname = 'market_category_items_parent_sort_idx'),
    'parent sort index exists';
  assert exists (
    select 1 from pg_trigger
    where tgname = 'check_market_category_item_tree'
      and tgrelid = 'public.market_category_items'::regclass
      and not tgisinternal
  ), 'tree trigger exists';
  assert (select count(*) from pg_policies
          where schemaname = 'public' and tablename = 'market_category_items') = 1,
    'one select policy';
  assert has_table_privilege('anon', 'public.market_category_items', 'select')
         and not has_table_privilege('anon', 'public.market_category_items', 'insert'),
    'anon can only select';
  assert not exists (select 1 from public.market_category_items where depth is null),
    'no rows without depth';
end;
$$;

-- 2. insert 거부
do $$
declare
  v_state text;
begin
  -- depth 6 → check 제약(23514)
  begin
    insert into public.market_category_items (parent_id, depth, workspace_subject, title)
    values ('7ee00000-0000-4000-8000-000000000005', 6, 'korean', 'tree-test-d6');
    raise exception 'depth 6 insert should fail';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    assert v_state = '23514', 'depth 6: ' || v_state;
  end;

  -- depth1인데 부모 있음 → check 제약(23514)
  begin
    insert into public.market_category_items (parent_id, depth, workspace_subject, title)
    values ('7ee00000-0000-4000-8000-000000000001', 1, 'korean', 'tree-test-root-with-parent');
    raise exception 'depth1 with parent insert should fail';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    assert v_state = '23514', 'depth1 with parent: ' || v_state;
  end;

  -- 부모 없는데 depth2 → 트리거는 건너뛰고 root_parent check 제약(23514)
  begin
    insert into public.market_category_items (parent_id, depth, workspace_subject, title)
    values (null, 2, 'korean', 'tree-test-orphan-depth2');
    raise exception 'depth2 without parent insert should fail';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    assert v_state = '23514', 'depth2 without parent: ' || v_state;
  end;

  -- 다른 과목 부모(depth는 맞음) → 트리거 통과, 복합 FK(23503)
  begin
    insert into public.market_category_items (parent_id, depth, workspace_subject, title)
    values ('7ee00000-0000-4000-8000-0000000000e1', 2, 'korean', 'tree-test-cross-subject');
    raise exception 'cross-subject parent insert should fail';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    assert v_state = '23503', 'cross-subject parent: ' || v_state;
  end;

  -- 부모 depth + 1이 아님 → 트리거(23514)
  begin
    insert into public.market_category_items (parent_id, depth, workspace_subject, title)
    values ('7ee00000-0000-4000-8000-000000000002', 4, 'korean', 'tree-test-skip-depth');
    raise exception 'skipped depth insert should fail';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    assert v_state = '23514', 'skipped depth: ' || v_state;
  end;

  -- 없는 부모 → 복합 FK(23503)
  begin
    insert into public.market_category_items (parent_id, depth, workspace_subject, title)
    values (gen_random_uuid(), 2, 'korean', 'tree-test-missing-parent');
    raise exception 'missing parent insert should fail';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    assert v_state = '23503', 'missing parent: ' || v_state;
  end;
end;
$$;

-- 3. 위치·과목 변경 거부(노드 이동 미지원), 제목·정렬·활성은 바꿀 수 있다
do $$
declare
  v_state text;
begin
  begin
    update public.market_category_items set parent_id = '7ee00000-0000-4000-8000-000000000010'
    where id = '7ee00000-0000-4000-8000-000000000003';
    raise exception 'parent_id update should fail';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    assert v_state = '23514', 'parent_id update: ' || v_state;
  end;

  begin
    update public.market_category_items set depth = 3
    where id = '7ee00000-0000-4000-8000-000000000010';
    raise exception 'depth update should fail';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    assert v_state = '23514', 'depth update: ' || v_state;
  end;

  begin
    update public.market_category_items set workspace_subject = 'english'
    where id = '7ee00000-0000-4000-8000-000000000010';
    raise exception 'workspace_subject update should fail';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    assert v_state = '23514', 'workspace_subject update: ' || v_state;
  end;

  update public.market_category_items
  set title = 'tree-test-leaf-renamed', sort_order = 99, is_active = false
  where id = '7ee00000-0000-4000-8000-000000000010';
  assert (select title = 'tree-test-leaf-renamed' and sort_order = 99 and not is_active
          from public.market_category_items where id = '7ee00000-0000-4000-8000-000000000010'),
    'title, sort_order, is_active can change';
end;
$$;

-- 4. 삭제: 상품이 연결된 칸·자식이 있는 칸은 거부(23503), leaf는 성공
do $$
declare
  v_state text;
begin
  begin
    delete from public.market_category_items where id = '7ee00000-0000-4000-8000-000000000005';
    delete from public.market_category_items where id = '7ee00000-0000-4000-8000-000000000004';
    delete from public.market_category_items where id = '7ee00000-0000-4000-8000-000000000003';
    -- d2에는 상품 a1이 연결돼 있다
    delete from public.market_category_items where id = '7ee00000-0000-4000-8000-000000000002';
    raise exception 'delete of node with item should fail';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    assert v_state = '23503', 'node with item: ' || v_state;
  end;
  assert exists (select 1 from public.market_category_items where id = '7ee00000-0000-4000-8000-000000000005'),
    'failed block rolled back: d5 still exists';
  assert (select category_item_id from public.market_items where id = '7ee00000-0000-4000-8000-0000000000a1')
         = '7ee00000-0000-4000-8000-000000000002',
    'item link not cleared';

  begin
    delete from public.market_category_items where id = '7ee00000-0000-4000-8000-000000000003';
    raise exception 'delete of node with child should fail';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    assert v_state = '23503', 'node with child: ' || v_state;
  end;

  delete from public.market_category_items where id = '7ee00000-0000-4000-8000-000000000005';
  assert not exists (select 1 from public.market_category_items where id = '7ee00000-0000-4000-8000-000000000005'),
    'leaf deleted';
  delete from public.market_category_items where id = '7ee00000-0000-4000-8000-000000000010';
  assert not exists (select 1 from public.market_category_items where id = '7ee00000-0000-4000-8000-000000000010'),
    'depth2 leaf without items deleted';
end;
$$;

do $$ begin raise notice 'market_category_tree: all passed'; end; $$;

rollback;
