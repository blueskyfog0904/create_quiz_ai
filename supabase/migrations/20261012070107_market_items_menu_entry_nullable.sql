-- 상품의 게시판(market_menu_entries) 연결을 선택값으로 바꾼다(docs/market-category-tree-plan.md 8.10-6, S4).
-- 게시판을 지워도 상품은 남고 연결만 풀린다(cascade → set null). 다시 실행해도 안전하다.

alter table public.market_items alter column menu_entry_id drop not null;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'market_items_menu_entry_id_fkey'
      and conrelid = 'public.market_items'::regclass
      and confdeltype <> 'n'
  ) then
    alter table public.market_items drop constraint market_items_menu_entry_id_fkey;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'market_items_menu_entry_id_fkey'
      and conrelid = 'public.market_items'::regclass
  ) then
    alter table public.market_items
      add constraint market_items_menu_entry_id_fkey
      foreign key (menu_entry_id) references public.market_menu_entries(id)
      on delete set null;
  end if;
end;
$$;
