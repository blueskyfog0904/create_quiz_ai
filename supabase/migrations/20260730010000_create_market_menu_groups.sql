create extension if not exists pgcrypto;

create table if not exists public.market_menu_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_subject text not null
    check (workspace_subject in ('english', 'korean')),
  group_key text not null,
  title text not null,
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint market_menu_groups_group_key_not_blank
    check (btrim(group_key) <> ''),
  constraint market_menu_groups_title_not_blank
    check (btrim(title) <> ''),
  constraint market_menu_groups_workspace_group_key_unique
    unique (workspace_subject, group_key),
  constraint market_menu_groups_id_workspace_subject_unique
    unique (id, workspace_subject)
);

comment on table public.market_menu_groups is '문제마켓 게시판의 과목별 상위 카테고리 그룹';
comment on column public.market_menu_groups.group_key is '과목 안에서 불변인 상위 카테고리 key';

alter table public.market_menu_entries
  add column if not exists group_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'market_menu_entries_group_workspace_subject_fkey'
      and conrelid = 'public.market_menu_entries'::regclass
  ) then
    alter table public.market_menu_entries
      add constraint market_menu_entries_group_workspace_subject_fkey
      foreign key (group_id, workspace_subject)
      references public.market_menu_groups (id, workspace_subject)
      on update cascade
      on delete restrict;
  end if;
end
$$;

create index if not exists idx_market_menu_groups_workspace_visibility_sort
  on public.market_menu_groups (
    workspace_subject,
    is_visible,
    is_active,
    sort_order,
    created_at
  )
  where deleted_at is null;

create index if not exists idx_market_menu_entries_workspace_group_sort
  on public.market_menu_entries (
    workspace_subject,
    group_id,
    sort_order,
    created_at
  )
  where deleted_at is null;

create or replace function public.set_market_menu_groups_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_market_menu_groups_updated_at
  on public.market_menu_groups;
create trigger trg_market_menu_groups_updated_at
before update on public.market_menu_groups
for each row
execute function public.set_market_menu_groups_updated_at();

alter table public.market_menu_groups enable row level security;

drop policy if exists "Public can read visible market menu groups"
  on public.market_menu_groups;
create policy "Public can read visible market menu groups"
  on public.market_menu_groups
  for select
  to anon, authenticated
  using (
    is_visible = true
    and is_active = true
    and deleted_at is null
  );

drop policy if exists "Admins can manage market menu groups"
  on public.market_menu_groups;
create policy "Admins can manage market menu groups"
  on public.market_menu_groups
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.market_menu_groups to anon, authenticated;
grant insert, update, delete on public.market_menu_groups to authenticated;
