create table if not exists public.market_items (
  id uuid primary key default gen_random_uuid(),
  menu_entry_id uuid not null references public.market_menu_entries(id) on delete cascade,
  title text not null,
  summary text,
  description text,
  thumbnail_url text,
  exam_year integer,
  exam_month integer,
  grade_level text,
  source_type text,
  source_1 text,
  source_2 text,
  source_3 text,
  source_4 text,
  pdf_price integer not null default 0 check (pdf_price >= 0),
  hwp_price integer not null default 0 check (hwp_price >= 0),
  sort_order integer not null default 0,
  status text not null default 'draft' check (status in ('draft', 'published', 'hidden', 'archived')),
  is_active boolean not null default true,
  view_count integer not null default 0 check (view_count >= 0),
  published_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.market_items is '문제마켓 카테고리별 판매 상품';
comment on column public.market_items.menu_entry_id is 'market_menu_entries.id';
comment on column public.market_items.pdf_price is 'PDF 구매 크레딧';
comment on column public.market_items.hwp_price is 'HWP 구매 크레딧';
comment on column public.market_items.status is 'draft/published/hidden/archived';

create table if not exists public.market_item_files (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.market_items(id) on delete cascade,
  asset_kind text not null check (asset_kind in ('sample', 'pdf', 'hwp')),
  storage_bucket text not null,
  storage_path text not null,
  original_file_name text not null,
  mime_type text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  checksum text,
  version integer not null default 1 check (version >= 1),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.market_item_files is '문제마켓 상품별 파일 메타데이터';
comment on column public.market_item_files.asset_kind is 'sample/pdf/hwp';
comment on column public.market_item_files.storage_path is 'Supabase Storage object path';

create table if not exists public.market_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid not null references public.market_items(id) on delete cascade,
  asset_kind text not null check (asset_kind in ('pdf', 'hwp')),
  price_credits integer not null check (price_credits >= 0),
  status text not null default 'completed' check (status in ('pending', 'completed', 'refunded', 'revoked')),
  credit_resource_type text not null,
  credit_resource_id uuid,
  purchased_at timestamptz not null default now(),
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, item_id, asset_kind)
);

comment on table public.market_purchases is '문제마켓 파일 entitlement source of truth';
comment on column public.market_purchases.asset_kind is '구매한 유료 파일 타입(pdf/hwp)';
comment on column public.market_purchases.credit_resource_type is 'CreditService resource_type';
comment on column public.market_purchases.credit_resource_id is 'CreditService resource_id';

create table if not exists public.market_download_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid not null references public.market_items(id) on delete cascade,
  file_id uuid not null references public.market_item_files(id) on delete cascade,
  purchase_id uuid references public.market_purchases(id) on delete set null,
  asset_kind text not null check (asset_kind in ('sample', 'pdf', 'hwp')),
  ip_address text,
  created_at timestamptz not null default now()
);

comment on table public.market_download_events is '문제마켓 파일 다운로드 이벤트 로그';

create table if not exists public.market_item_view_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.market_items(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  session_key text,
  ip_hash text,
  created_at timestamptz not null default now()
);

comment on table public.market_item_view_events is '문제마켓 상품 조회수 이벤트 로그';

create index if not exists idx_market_items_menu_status
  on public.market_items(menu_entry_id, status, is_active, deleted_at);

create index if not exists idx_market_items_published_at
  on public.market_items(published_at desc);

create index if not exists idx_market_items_sort_order
  on public.market_items(menu_entry_id, sort_order, created_at desc);

create index if not exists idx_market_items_view_count
  on public.market_items(view_count desc);

create index if not exists idx_market_item_files_item_kind
  on public.market_item_files(item_id, asset_kind, is_active, deleted_at);

create unique index if not exists uq_market_item_files_active_kind
  on public.market_item_files(item_id, asset_kind)
  where is_active = true and deleted_at is null;

create index if not exists idx_market_purchases_user_created_at
  on public.market_purchases(user_id, created_at desc);

create index if not exists idx_market_purchases_item_kind_status
  on public.market_purchases(item_id, asset_kind, status);

create index if not exists idx_market_download_events_item_created_at
  on public.market_download_events(item_id, created_at desc);

create index if not exists idx_market_download_events_user_created_at
  on public.market_download_events(user_id, created_at desc);

create index if not exists idx_market_item_view_events_item_created_at
  on public.market_item_view_events(item_id, created_at desc);

create or replace function public.set_market_items_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_market_item_files_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_market_purchases_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_market_items_updated_at on public.market_items;
create trigger trg_market_items_updated_at
before update on public.market_items
for each row
execute function public.set_market_items_updated_at();

drop trigger if exists trg_market_item_files_updated_at on public.market_item_files;
create trigger trg_market_item_files_updated_at
before update on public.market_item_files
for each row
execute function public.set_market_item_files_updated_at();

drop trigger if exists trg_market_purchases_updated_at on public.market_purchases;
create trigger trg_market_purchases_updated_at
before update on public.market_purchases
for each row
execute function public.set_market_purchases_updated_at();

alter table public.market_items enable row level security;
alter table public.market_item_files enable row level security;
alter table public.market_purchases enable row level security;
alter table public.market_download_events enable row level security;
alter table public.market_item_view_events enable row level security;

drop policy if exists "Authenticated users can read published market items" on public.market_items;
create policy "Authenticated users can read published market items"
  on public.market_items
  for select
  to authenticated
  using (
    status = 'published'
    and is_active = true
    and deleted_at is null
    and exists (
      select 1
      from public.market_menu_entries menu_entries
      where menu_entries.id = menu_entry_id
        and menu_entries.is_visible = true
        and menu_entries.is_active = true
        and menu_entries.deleted_at is null
    )
  );

drop policy if exists "Admins can manage market items" on public.market_items;
create policy "Admins can manage market items"
  on public.market_items
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Authenticated users can read active market item files" on public.market_item_files;
create policy "Authenticated users can read active market item files"
  on public.market_item_files
  for select
  to authenticated
  using (
    is_active = true
    and deleted_at is null
    and exists (
      select 1
      from public.market_items items
      where items.id = item_id
        and items.status = 'published'
        and items.is_active = true
        and items.deleted_at is null
    )
  );

drop policy if exists "Admins can manage market item files" on public.market_item_files;
create policy "Admins can manage market item files"
  on public.market_item_files
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Users can read own market purchases" on public.market_purchases;
create policy "Users can read own market purchases"
  on public.market_purchases
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own market purchases" on public.market_purchases;
create policy "Users can insert own market purchases"
  on public.market_purchases
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own pending market purchases" on public.market_purchases;
create policy "Users can update own pending market purchases"
  on public.market_purchases
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Admins can manage market purchases" on public.market_purchases;
create policy "Admins can manage market purchases"
  on public.market_purchases
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Users can read own market download events" on public.market_download_events;
create policy "Users can read own market download events"
  on public.market_download_events
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own market download events" on public.market_download_events;
create policy "Users can insert own market download events"
  on public.market_download_events
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Admins can view all market download events" on public.market_download_events;
create policy "Admins can view all market download events"
  on public.market_download_events
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Users can insert own market item view events" on public.market_item_view_events;
create policy "Users can insert own market item view events"
  on public.market_item_view_events
  for insert
  to authenticated
  with check (auth.uid() = user_id or user_id is null);

drop policy if exists "Admins can view all market item view events" on public.market_item_view_events;
create policy "Admins can view all market item view events"
  on public.market_item_view_events
  for select
  to authenticated
  using (public.is_admin());
