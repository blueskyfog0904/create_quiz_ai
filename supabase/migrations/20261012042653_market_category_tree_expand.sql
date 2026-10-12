-- 문제마켓 카테고리를 parent_id·depth(1~5) 트리 하나로 넓힌다(확장 단계 — docs/market-category-tree-plan.md 3.2).
-- - 그룹(market_category_groups) 행을 같은 id의 depth1 행으로 옮기고, 기존 항목은 depth2(parent_id = group_id)가 된다.
-- - 배포 전 코드가 계속 동작하도록 그룹 테이블과 group_id는 지우지 않는다(축소 단계에서 제거).
-- - 다시 실행해도 안전하게 쓴다(if not exists, depth is null 가드, pg_constraint 확인).

-- 1. 트리 컬럼
alter table public.market_category_items
  add column if not exists parent_id uuid;

alter table public.market_category_items
  add column if not exists depth smallint;

-- 2. depth1 행은 group_id가 없다
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'market_category_items' and column_name = 'group_id'
  ) then
    alter table public.market_category_items alter column group_id drop not null;
  end if;
end;
$$;

-- 3·4. 그룹 → depth1(같은 id), 기존 항목 → depth2. depth is null 행이 있을 때(= 이관 전)만 한다.
do $$
begin
  if exists (select 1 from public.market_category_items where depth is null) then
    if to_regclass('public.market_category_groups') is not null then
      insert into public.market_category_items
        (id, workspace_subject, title, sort_order, is_active, created_at, updated_at, parent_id, depth)
      select id, workspace_subject, title, sort_order, is_active, created_at, updated_at, null, 1
      from public.market_category_groups
      on conflict (id) do nothing;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'market_category_items' and column_name = 'group_id'
    ) then
      execute 'update public.market_category_items
        set parent_id = group_id, depth = 2
        where group_id is not null and depth is null';
    end if;
  end if;
end;
$$;

-- 5. 안전 확인: 이관되지 않은 행이 없고, 모든 그룹이 depth1 행으로 있다
do $$
begin
  if exists (select 1 from public.market_category_items where depth is null) then
    raise exception 'market_category_items: depth is null rows remain after migration';
  end if;

  if to_regclass('public.market_category_groups') is not null and exists (
    select 1 from public.market_category_groups g
    where not exists (
      select 1 from public.market_category_items c where c.id = g.id and c.depth = 1
    )
  ) then
    raise exception 'market_category_items: some market_category_groups are missing as depth1 rows';
  end if;
end;
$$;

-- 6. depth 필수
alter table public.market_category_items
  alter column depth set not null;

-- 7. 제약: depth 범위, 루트만 부모 없음, 같은 과목 부모(자식이 있으면 삭제 차단)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'market_category_items_depth_range'
      and conrelid = 'public.market_category_items'::regclass
  ) then
    alter table public.market_category_items
      add constraint market_category_items_depth_range check (depth between 1 and 5);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'market_category_items_root_parent'
      and conrelid = 'public.market_category_items'::regclass
  ) then
    alter table public.market_category_items
      add constraint market_category_items_root_parent check ((depth = 1) = (parent_id is null));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'market_category_items_parent_subject_fkey'
      and conrelid = 'public.market_category_items'::regclass
  ) then
    alter table public.market_category_items
      add constraint market_category_items_parent_subject_fkey
      foreign key (parent_id, workspace_subject)
      references public.market_category_items(id, workspace_subject)
      on delete restrict;
  end if;
end;
$$;

-- 8. 형제 정렬 조회용
create index if not exists market_category_items_parent_sort_idx
  on public.market_category_items(parent_id, sort_order);

-- 9. depth = 부모 depth + 1 강제, 생성 후 위치·과목 변경 금지(노드 이동 미지원 — 순환이 생길 수 없다).
--    과목 불일치와 없는 부모는 복합 FK가 23503으로 거부한다.
create or replace function public.check_market_category_item_tree()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_parent_depth smallint;
begin
  if tg_op = 'INSERT' then
    if new.parent_id is not null then
      select depth into v_parent_depth
      from public.market_category_items
      where id = new.parent_id;

      if found and new.depth is distinct from v_parent_depth + 1 then
        raise exception 'market category depth must be parent depth + 1'
          using errcode = '23514';
      end if;
    end if;
  elsif new.parent_id is distinct from old.parent_id
    or new.depth is distinct from old.depth
    or new.workspace_subject is distinct from old.workspace_subject then
    raise exception 'market category parent, depth and subject cannot be changed'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists check_market_category_item_tree on public.market_category_items;
create trigger check_market_category_item_tree
  before insert or update on public.market_category_items
  for each row execute function public.check_market_category_item_tree();

-- 10. 상품이 연결된 칸은 삭제를 막는다(연결이 조용히 풀리지 않게 set null → restrict)
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'market_items_category_item_subject_fkey'
      and conrelid = 'public.market_items'::regclass
      and confdeltype <> 'r'
  ) then
    alter table public.market_items
      drop constraint market_items_category_item_subject_fkey;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'market_items_category_item_subject_fkey'
      and conrelid = 'public.market_items'::regclass
  ) then
    alter table public.market_items
      add constraint market_items_category_item_subject_fkey
      foreign key (category_item_id, workspace_subject)
      references public.market_category_items(id, workspace_subject)
      on delete restrict;
  end if;
end;
$$;

-- 11. RLS: 활성 행 공개 읽기, 쓰기는 service role 전용(다시 선언)
alter table public.market_category_items enable row level security;

revoke all on table public.market_category_items from anon, authenticated;
grant select on table public.market_category_items to anon, authenticated;

drop policy if exists "Active market category items are publicly readable" on public.market_category_items;
create policy "Active market category items are publicly readable"
  on public.market_category_items for select
  using (is_active);
