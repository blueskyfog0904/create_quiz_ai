create extension if not exists pgcrypto;

create table if not exists public.generate_menu_entries (
  id uuid primary key default gen_random_uuid(),
  entry_key text not null unique,
  slug text not null unique,
  title text not null,
  entry_type text not null check (entry_type in ('personal_generate', 'listboard')),
  description text,
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  is_active boolean not null default true,
  search_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.generate_menu_entries is '문제생성 2단계 메뉴 source of truth';
comment on column public.generate_menu_entries.entry_key is '불변 internal key';
comment on column public.generate_menu_entries.slug is '문제생성 listboard route slug';
comment on column public.generate_menu_entries.entry_type is 'personal_generate 또는 listboard';
comment on column public.generate_menu_entries.search_config is '리스트보드 검색 UI/필터 설정';

create table if not exists public.generate_listboard_posts (
  id uuid primary key default gen_random_uuid(),
  menu_entry_id uuid not null references public.generate_menu_entries(id),
  title text not null,
  passage_text text not null,
  exam_year integer,
  exam_month integer,
  grade_level text,
  source_type text,
  source_1 text,
  source_2 text,
  source_3 text,
  source_4 text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  is_active boolean not null default true,
  published_at timestamptz,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.generate_listboard_posts is '문제생성 listboard 글/지문 source of truth';
comment on column public.generate_listboard_posts.menu_entry_id is 'generate_menu_entries.id, 단 listboard entry만 허용';
comment on column public.generate_listboard_posts.passage_text is 'textbook_generate로 넘길 원문 지문';

create index if not exists idx_generate_menu_entries_sort_order
  on public.generate_menu_entries(sort_order);

create index if not exists idx_generate_menu_entries_visibility
  on public.generate_menu_entries(is_visible, is_active, deleted_at);

create index if not exists idx_generate_listboard_posts_menu_status
  on public.generate_listboard_posts(menu_entry_id, status);

create index if not exists idx_generate_listboard_posts_filters
  on public.generate_listboard_posts(menu_entry_id, exam_year, exam_month, grade_level);

create index if not exists idx_generate_listboard_posts_visibility
  on public.generate_listboard_posts(is_active, deleted_at);

create or replace function public.set_generate_menu_entries_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_generate_listboard_posts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.validate_generate_listboard_post_menu_entry()
returns trigger
language plpgsql
as $$
declare
  v_entry_type text;
begin
  select entry_type
    into v_entry_type
  from public.generate_menu_entries
  where id = new.menu_entry_id
    and deleted_at is null;

  if v_entry_type is null then
    raise exception 'Invalid generate menu entry: %', new.menu_entry_id;
  end if;

  if v_entry_type <> 'listboard' then
    raise exception 'generate_listboard_posts can reference only listboard entries';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_generate_menu_entries_updated_at on public.generate_menu_entries;
create trigger trg_generate_menu_entries_updated_at
before update on public.generate_menu_entries
for each row
execute function public.set_generate_menu_entries_updated_at();

drop trigger if exists trg_generate_listboard_posts_updated_at on public.generate_listboard_posts;
create trigger trg_generate_listboard_posts_updated_at
before update on public.generate_listboard_posts
for each row
execute function public.set_generate_listboard_posts_updated_at();

drop trigger if exists trg_validate_generate_listboard_post_menu_entry on public.generate_listboard_posts;
create trigger trg_validate_generate_listboard_post_menu_entry
before insert or update on public.generate_listboard_posts
for each row
execute function public.validate_generate_listboard_post_menu_entry();

alter table public.generate_menu_entries enable row level security;
alter table public.generate_listboard_posts enable row level security;

drop policy if exists "Authenticated users can read visible generate menu entries" on public.generate_menu_entries;
create policy "Authenticated users can read visible generate menu entries"
  on public.generate_menu_entries
  for select
  to authenticated
  using (
    is_visible = true
    and is_active = true
    and deleted_at is null
  );

drop policy if exists "Admins can manage generate menu entries" on public.generate_menu_entries;
create policy "Admins can manage generate menu entries"
  on public.generate_menu_entries
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Authenticated users can read published generate listboard posts" on public.generate_listboard_posts;
create policy "Authenticated users can read published generate listboard posts"
  on public.generate_listboard_posts
  for select
  to authenticated
  using (
    status = 'published'
    and is_active = true
    and deleted_at is null
  );

drop policy if exists "Admins can manage generate listboard posts" on public.generate_listboard_posts;
create policy "Admins can manage generate listboard posts"
  on public.generate_listboard_posts
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

insert into public.generate_menu_entries (
  entry_key,
  slug,
  title,
  entry_type,
  description,
  sort_order,
  is_visible,
  is_active,
  search_config
)
values
  (
    'personal',
    'personal',
    '개인지문',
    'personal_generate',
    '기존 개인지문 AI 문제생성 진입점',
    10,
    true,
    true,
    '{"entryHref":"/generate"}'::jsonb
  ),
  (
    'mock-exams',
    'mock-exams',
    '모의고사',
    'listboard',
    '모의고사 리스트보드 진입점',
    20,
    true,
    true,
    '{"filters":["year","month","grade","title"],"entryHref":"/generate/boards/mock-exams"}'::jsonb
  )
on conflict (entry_key) do update
set
  slug = excluded.slug,
  title = excluded.title,
  entry_type = excluded.entry_type,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_visible = excluded.is_visible,
  is_active = excluded.is_active,
  search_config = excluded.search_config,
  updated_at = now();
