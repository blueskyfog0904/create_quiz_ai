create extension if not exists pgcrypto;

create table if not exists public.workspace_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_subject text not null check (workspace_subject in ('english', 'korean')),
  setting_key text not null,
  value jsonb not null,
  description text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_subject, setting_key)
);

comment on table public.workspace_settings is 'Workspace-scoped shell/config settings for English and Korean services';
comment on column public.workspace_settings.workspace_subject is 'Workspace subject code: english or korean';
comment on column public.workspace_settings.setting_key is 'Workspace-specific setting key';
comment on column public.workspace_settings.value is 'JSON configuration payload for the workspace setting';

create index if not exists idx_workspace_settings_subject_key
  on public.workspace_settings(workspace_subject, setting_key);

create or replace function public.set_workspace_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_workspace_settings_updated_at on public.workspace_settings;
create trigger trg_workspace_settings_updated_at
before update on public.workspace_settings
for each row
execute function public.set_workspace_settings_updated_at();

alter table public.workspace_settings enable row level security;

drop policy if exists "Admins can view workspace settings" on public.workspace_settings;
create policy "Admins can view workspace settings"
  on public.workspace_settings
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Admins can insert workspace settings" on public.workspace_settings;
create policy "Admins can insert workspace settings"
  on public.workspace_settings
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "Admins can update workspace settings" on public.workspace_settings;
create policy "Admins can update workspace settings"
  on public.workspace_settings
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can delete workspace settings" on public.workspace_settings;
create policy "Admins can delete workspace settings"
  on public.workspace_settings
  for delete
  to authenticated
  using (public.is_admin());

insert into public.workspace_settings (
  workspace_subject,
  setting_key,
  value,
  description
)
select
  'english',
  'header_navigation',
  value,
  description
from public.system_settings
where key = 'header_navigation'
on conflict (workspace_subject, setting_key) do nothing;
