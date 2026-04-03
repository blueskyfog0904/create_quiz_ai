alter table public.generate_menu_entries
  add column if not exists subject_code text not null default 'english';

alter table public.market_menu_entries
  add column if not exists subject_code text not null default 'english';

update public.generate_menu_entries
set subject_code = coalesce(workspace_subject, 'english')
where subject_code is distinct from coalesce(workspace_subject, 'english');

update public.market_menu_entries
set subject_code = coalesce(workspace_subject, 'english')
where subject_code is distinct from coalesce(workspace_subject, 'english');

alter table public.generate_menu_entries
  alter column subject_code set default 'english';

alter table public.market_menu_entries
  alter column subject_code set default 'english';

alter table public.generate_menu_entries
  alter column subject_code set not null;

alter table public.market_menu_entries
  alter column subject_code set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'generate_menu_entries_subject_code_check'
  ) then
    alter table public.generate_menu_entries
      add constraint generate_menu_entries_subject_code_check
      check (subject_code in ('english', 'korean'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'market_menu_entries_subject_code_check'
  ) then
    alter table public.market_menu_entries
      add constraint market_menu_entries_subject_code_check
      check (subject_code in ('english', 'korean'));
  end if;
end $$;

comment on column public.generate_menu_entries.subject_code is 'Legacy subject scope kept in sync with workspace_subject for compatibility.';
comment on column public.market_menu_entries.subject_code is 'Legacy subject scope kept in sync with workspace_subject for compatibility.';

create index if not exists idx_generate_menu_entries_subject_visibility
  on public.generate_menu_entries(subject_code, is_visible, is_active, deleted_at);

create index if not exists idx_market_menu_entries_subject_visibility
  on public.market_menu_entries(subject_code, is_visible, is_active, deleted_at);

create unique index if not exists uq_generate_menu_entries_subject_entry_key
  on public.generate_menu_entries(subject_code, entry_key);

create unique index if not exists uq_generate_menu_entries_subject_slug
  on public.generate_menu_entries(subject_code, slug)
  where deleted_at is null;

create unique index if not exists uq_market_menu_entries_subject_entry_key
  on public.market_menu_entries(subject_code, entry_key);

create unique index if not exists uq_market_menu_entries_subject_slug
  on public.market_menu_entries(subject_code, slug)
  where deleted_at is null;
