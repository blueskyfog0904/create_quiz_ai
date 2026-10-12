-- 문제마켓 카테고리 트리 축소 단계(docs/market-category-tree-plan.md 3.4).
-- 트리 코드 배포 뒤 그룹 테이블과 market_category_items.group_id를 지운다. 다시 실행해도 안전하다.

-- 1. 안전 확인(그룹 테이블과 group_id가 있을 때만). 새 코드로 만든 칸은 group_id가 null이라 검사 대상이 아니다.
do $$
declare
  v_deleted_group record;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'market_category_items' and column_name = 'group_id'
  ) then
    if exists (
      select 1 from public.market_category_items
      where group_id is not null and (depth <> 2 or parent_id is distinct from group_id)
    ) then
      raise exception 'market_category_items: migrated rows no longer match group_id';
    end if;

    if to_regclass('public.market_category_groups') is not null then
      -- 트리 코드 배포 뒤 관리자가 지운 depth1에 대응하는 그룹 행: 기록만 하고 테이블과 함께 지운다.
      for v_deleted_group in
        execute 'select g.id from public.market_category_groups g
          where not exists (select 1 from public.market_category_items c where c.id = g.id and c.depth = 1)'
      loop
        raise notice 'group without depth1 row (deleted after tree deploy): %', v_deleted_group.id;
      end loop;
    end if;
  end if;

  if exists (select 1 from public.market_category_items where depth = 2 and parent_id is null)
    or exists (
      select 1 from public.market_category_items c
      join public.market_category_items p on p.id = c.parent_id
      where c.depth = 2 and p.depth <> 1
    ) then
    raise exception 'market_category_items: every depth2 row must have a depth1 parent';
  end if;
end;
$$;

-- 2. group_id 제거
alter table public.market_category_items drop constraint if exists market_category_items_group_id_fkey;
drop index if exists public.market_category_items_group_id_idx;
alter table public.market_category_items drop column if exists group_id;

-- 3. 그룹 테이블(트리거·정책 포함)과 updated_at 함수 제거
drop table if exists public.market_category_groups;
drop function if exists public.set_market_category_groups_updated_at();
