create extension if not exists pgcrypto;

create table if not exists public.market_menu_entries (
  id uuid primary key default gen_random_uuid(),
  entry_key text not null unique,
  slug text not null unique,
  title text not null,
  description text,
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  is_active boolean not null default true,
  search_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.market_menu_entries is '문제마켓 2단계 메뉴 source of truth';
comment on column public.market_menu_entries.entry_key is '불변 internal key';
comment on column public.market_menu_entries.slug is '문제마켓 하위 메뉴 slug';
comment on column public.market_menu_entries.search_config is '문제마켓 검색 preset 설정';

create index if not exists idx_market_menu_entries_sort_order
  on public.market_menu_entries(sort_order);

create index if not exists idx_market_menu_entries_visibility
  on public.market_menu_entries(is_visible, is_active, deleted_at);

create or replace function public.set_market_menu_entries_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_market_menu_entries_updated_at on public.market_menu_entries;
create trigger trg_market_menu_entries_updated_at
before update on public.market_menu_entries
for each row
execute function public.set_market_menu_entries_updated_at();

alter table public.market_menu_entries enable row level security;

drop policy if exists "Authenticated users can read visible market menu entries" on public.market_menu_entries;
create policy "Authenticated users can read visible market menu entries"
  on public.market_menu_entries
  for select
  to authenticated
  using (
    is_visible = true
    and is_active = true
    and deleted_at is null
  );

drop policy if exists "Admins can manage market menu entries" on public.market_menu_entries;
create policy "Admins can manage market menu entries"
  on public.market_menu_entries
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
