-- Additive v2 문제마켓 schema: subproducts, configurable file types,
-- bundle purchases, purchase orders/lines, and entitlement-based downloads.
-- Legacy market_items/market_item_files/market_purchases remain in place.

create unique index if not exists uq_market_items_id_workspace_subject
  on public.market_items(id, workspace_subject);

create table if not exists public.market_subproduct_categories (
  id uuid primary key default gen_random_uuid(),
  workspace_subject text not null check (workspace_subject in ('english', 'korean')),
  name text not null,
  slug text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_subject, slug)
);

comment on table public.market_subproduct_categories is '문제마켓 v2 서브상품 카테고리';

create table if not exists public.market_file_types (
  id uuid primary key default gen_random_uuid(),
  workspace_subject text not null check (workspace_subject in ('english', 'korean')),
  code text not null,
  label text not null,
  extension text not null,
  mime_allowlist text[] not null default '{}',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_subject, code)
);

comment on table public.market_file_types is '문제마켓 v2 파일 유형. PDF/HWP/ZIP 기본 제공 후 관리자 확장 가능';

create unique index if not exists uq_market_subproduct_categories_id_workspace_subject
  on public.market_subproduct_categories(id, workspace_subject);

create unique index if not exists uq_market_file_types_id_workspace_subject
  on public.market_file_types(id, workspace_subject);

create table if not exists public.market_item_subproducts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  workspace_subject text not null check (workspace_subject in ('english', 'korean')),
  category_id uuid not null,
  title text not null,
  description text,
  price_credits integer not null default 0 check (price_credits >= 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_item_subproducts_item_workspace_fkey
    foreign key (item_id, workspace_subject)
    references public.market_items(id, workspace_subject)
    on delete cascade,
  constraint market_item_subproducts_category_workspace_fkey
    foreign key (category_id, workspace_subject)
    references public.market_subproduct_categories(id, workspace_subject)
);

comment on table public.market_item_subproducts is '문제마켓 상품 하위 판매 단위';

create unique index if not exists uq_market_item_subproducts_id_workspace_subject
  on public.market_item_subproducts(id, workspace_subject);

create table if not exists public.market_subproduct_files (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  subproduct_id uuid not null,
  workspace_subject text not null check (workspace_subject in ('english', 'korean')),
  file_type_id uuid not null,
  storage_bucket text not null,
  storage_path text not null,
  original_file_name text not null,
  content_type text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  checksum text,
  version integer not null default 1 check (version >= 1),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_subproduct_files_item_workspace_fkey
    foreign key (item_id, workspace_subject)
    references public.market_items(id, workspace_subject)
    on delete cascade,
  constraint market_subproduct_files_subproduct_workspace_fkey
    foreign key (subproduct_id, workspace_subject)
    references public.market_item_subproducts(id, workspace_subject)
    on delete cascade,
  constraint market_subproduct_files_type_workspace_fkey
    foreign key (file_type_id, workspace_subject)
    references public.market_file_types(id, workspace_subject)
);

comment on table public.market_subproduct_files is '문제마켓 v2 서브상품별 유료 파일 메타데이터';
comment on column public.market_subproduct_files.storage_path is 'Private storage object path. 일반 사용자는 entitlement 검증 후 API를 통해서만 접근한다.';

create unique index if not exists uq_market_subproduct_files_id_workspace_subject
  on public.market_subproduct_files(id, workspace_subject);

create table if not exists public.market_item_bundle_options (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  workspace_subject text not null check (workspace_subject in ('english', 'korean')),
  label text not null default '전체 한번에 구매하기',
  description text,
  price_credits integer not null default 0 check (price_credits >= 0),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_item_bundle_options_item_workspace_fkey
    foreign key (item_id, workspace_subject)
    references public.market_items(id, workspace_subject)
    on delete cascade
);

comment on table public.market_item_bundle_options is '문제마켓 상품 단위 전체구매 옵션';

create unique index if not exists uq_market_item_bundle_options_active_item
  on public.market_item_bundle_options(item_id, workspace_subject)
  where is_active = true;

create unique index if not exists uq_market_item_bundle_options_id_workspace_subject
  on public.market_item_bundle_options(id, workspace_subject);

create table if not exists public.market_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_subject text not null check (workspace_subject in ('english', 'korean')),
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid not null,
  purchase_type text not null check (purchase_type in ('subproduct', 'bundle', 'legacy_backfill')),
  idempotency_key text,
  original_price_credits integer not null default 0 check (original_price_credits >= 0),
  charged_credits integer not null default 0 check (charged_credits >= 0),
  status text not null default 'completed' check (status in ('completed', 'refunded', 'revoked', 'failed')),
  legacy_purchase_id uuid references public.market_purchases(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_purchase_orders_item_workspace_fkey
    foreign key (item_id, workspace_subject)
    references public.market_items(id, workspace_subject)
    on delete cascade
);

comment on table public.market_purchase_orders is '문제마켓 v2 구매 주문/audit 이력';

create unique index if not exists uq_market_purchase_orders_user_idempotency
  on public.market_purchase_orders(user_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists uq_market_purchase_orders_id_workspace_subject
  on public.market_purchase_orders(id, workspace_subject);

create table if not exists public.market_purchase_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  workspace_subject text not null check (workspace_subject in ('english', 'korean')),
  item_id uuid not null,
  subproduct_id uuid,
  bundle_option_id uuid,
  line_type text not null check (line_type in ('subproduct', 'bundle')),
  price_credits integer not null default 0 check (price_credits >= 0),
  status text not null default 'completed' check (status in ('completed', 'refunded', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_purchase_lines_order_workspace_fkey
    foreign key (order_id, workspace_subject)
    references public.market_purchase_orders(id, workspace_subject)
    on delete cascade,
  constraint market_purchase_lines_item_workspace_fkey
    foreign key (item_id, workspace_subject)
    references public.market_items(id, workspace_subject)
    on delete cascade,
  constraint market_purchase_lines_subproduct_workspace_fkey
    foreign key (subproduct_id, workspace_subject)
    references public.market_item_subproducts(id, workspace_subject),
  constraint market_purchase_lines_bundle_workspace_fkey
    foreign key (bundle_option_id, workspace_subject)
    references public.market_item_bundle_options(id, workspace_subject),
  constraint market_purchase_lines_target_check
    check (
      (line_type = 'subproduct' and subproduct_id is not null and bundle_option_id is null)
      or (line_type = 'bundle' and subproduct_id is null and bundle_option_id is not null)
    )
);

comment on table public.market_purchase_lines is '문제마켓 v2 구매 주문 상세 라인';

create table if not exists public.market_entitlements (
  id uuid primary key default gen_random_uuid(),
  workspace_subject text not null check (workspace_subject in ('english', 'korean')),
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid not null,
  scope text not null check (scope in ('item', 'subproduct', 'file', 'legacy_asset')),
  subproduct_id uuid,
  file_id uuid,
  legacy_asset_kind text check (legacy_asset_kind is null or legacy_asset_kind in ('pdf', 'hwp', 'zip')),
  source_order_id uuid,
  source_purchase_id uuid references public.market_purchases(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'refunded', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_entitlements_item_workspace_fkey
    foreign key (item_id, workspace_subject)
    references public.market_items(id, workspace_subject)
    on delete cascade,
  constraint market_entitlements_subproduct_workspace_fkey
    foreign key (subproduct_id, workspace_subject)
    references public.market_item_subproducts(id, workspace_subject),
  constraint market_entitlements_file_workspace_fkey
    foreign key (file_id, workspace_subject)
    references public.market_subproduct_files(id, workspace_subject),
  constraint market_entitlements_order_workspace_fkey
    foreign key (source_order_id, workspace_subject)
    references public.market_purchase_orders(id, workspace_subject),
  constraint market_entitlements_scope_target_check
    check (
      (scope = 'item' and subproduct_id is null and file_id is null and legacy_asset_kind is null)
      or (scope = 'subproduct' and subproduct_id is not null and file_id is null and legacy_asset_kind is null)
      or (scope = 'file' and file_id is not null and legacy_asset_kind is null)
      or (scope = 'legacy_asset' and legacy_asset_kind is not null)
    )
);

comment on table public.market_entitlements is '문제마켓 v2 다운로드 권한 source of truth';

create unique index if not exists uq_market_entitlements_active_item
  on public.market_entitlements(user_id, item_id, scope)
  where scope = 'item' and status = 'active';

create unique index if not exists uq_market_entitlements_active_subproduct
  on public.market_entitlements(user_id, subproduct_id, scope)
  where scope = 'subproduct' and status = 'active';

create unique index if not exists uq_market_entitlements_active_file
  on public.market_entitlements(user_id, file_id, scope)
  where scope = 'file' and status = 'active';

create unique index if not exists uq_market_entitlements_legacy_source
  on public.market_entitlements(source_purchase_id, legacy_asset_kind, scope)
  where scope = 'legacy_asset' and source_purchase_id is not null;

create index if not exists idx_market_item_subproducts_item_active
  on public.market_item_subproducts(workspace_subject, item_id, is_active, deleted_at, sort_order);

create index if not exists idx_market_subproduct_files_subproduct_active
  on public.market_subproduct_files(workspace_subject, subproduct_id, is_active, deleted_at, sort_order);

create index if not exists idx_market_purchase_orders_user_created_at
  on public.market_purchase_orders(workspace_subject, user_id, created_at desc);

create index if not exists idx_market_entitlements_user_item_status
  on public.market_entitlements(workspace_subject, user_id, item_id, status);

insert into public.market_file_types (workspace_subject, code, label, extension, mime_allowlist, sort_order)
values
  ('english', 'pdf', 'PDF', 'pdf', array['application/pdf'], 10),
  ('english', 'hwp', 'HWP', 'hwp', array['application/x-hwp', 'application/haansofthwp', 'application/octet-stream'], 20),
  ('english', 'zip', 'ZIP', 'zip', array['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], 30),
  ('korean', 'pdf', 'PDF', 'pdf', array['application/pdf'], 10),
  ('korean', 'hwp', 'HWP', 'hwp', array['application/x-hwp', 'application/haansofthwp', 'application/octet-stream'], 20),
  ('korean', 'zip', 'ZIP', 'zip', array['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], 30)
on conflict (workspace_subject, code) do update
set label = excluded.label,
    extension = excluded.extension,
    mime_allowlist = excluded.mime_allowlist,
    sort_order = excluded.sort_order,
    updated_at = now();

insert into public.market_subproduct_categories (workspace_subject, name, slug, description, sort_order)
values
  ('english', 'PDF', 'legacy_pdf', 'Legacy PDF mirror category', 10),
  ('english', 'HWP & PDF', 'legacy_hwp_bundle', 'Legacy HWP & PDF mirror category', 20),
  ('english', 'ZIP', 'legacy_zip', 'Legacy ZIP mirror category', 30),
  ('korean', 'PDF', 'legacy_pdf', 'Legacy PDF mirror category', 10),
  ('korean', 'HWP & PDF', 'legacy_hwp_bundle', 'Legacy HWP & PDF mirror category', 20),
  ('korean', 'ZIP', 'legacy_zip', 'Legacy ZIP mirror category', 30)
on conflict (workspace_subject, slug) do update
set name = excluded.name,
    description = excluded.description,
    sort_order = excluded.sort_order,
    updated_at = now();

-- Sample v2: arbitrary pages, draft/commit, append semantics.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.market_item_sample_pages'::regclass
      and conname = 'market_item_sample_pages_page_number_check'
  ) then
    alter table public.market_item_sample_pages drop constraint market_item_sample_pages_page_number_check;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.market_item_sample_pages'::regclass
      and conname = 'market_item_sample_pages_page_number_positive_check'
  ) then
    alter table public.market_item_sample_pages
      add constraint market_item_sample_pages_page_number_positive_check
      check (page_number > 0);
  end if;
end $$;

alter table public.market_item_sample_pages
  add column if not exists display_order integer not null default 0,
  add column if not exists source_batch_id uuid,
  add column if not exists draft_token text,
  add column if not exists status text not null default 'active',
  add column if not exists committed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.market_item_sample_pages'::regclass
      and conname = 'market_item_sample_pages_status_check'
  ) then
    alter table public.market_item_sample_pages
      add constraint market_item_sample_pages_status_check
      check (status in ('draft', 'active', 'removed'));
  end if;
end $$;

drop index if exists public.uq_market_item_sample_pages_active_page;

create index if not exists idx_market_item_sample_pages_status_order
  on public.market_item_sample_pages(workspace_subject, item_id, status, is_active, display_order, page_number);

create or replace function public.set_market_subproduct_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_market_subproduct_categories_updated_at on public.market_subproduct_categories;
create trigger trg_market_subproduct_categories_updated_at
before update on public.market_subproduct_categories
for each row execute function public.set_market_subproduct_updated_at();

drop trigger if exists trg_market_file_types_updated_at on public.market_file_types;
create trigger trg_market_file_types_updated_at
before update on public.market_file_types
for each row execute function public.set_market_subproduct_updated_at();

drop trigger if exists trg_market_item_subproducts_updated_at on public.market_item_subproducts;
create trigger trg_market_item_subproducts_updated_at
before update on public.market_item_subproducts
for each row execute function public.set_market_subproduct_updated_at();

drop trigger if exists trg_market_subproduct_files_updated_at on public.market_subproduct_files;
create trigger trg_market_subproduct_files_updated_at
before update on public.market_subproduct_files
for each row execute function public.set_market_subproduct_updated_at();

drop trigger if exists trg_market_item_bundle_options_updated_at on public.market_item_bundle_options;
create trigger trg_market_item_bundle_options_updated_at
before update on public.market_item_bundle_options
for each row execute function public.set_market_subproduct_updated_at();

drop trigger if exists trg_market_purchase_orders_updated_at on public.market_purchase_orders;
create trigger trg_market_purchase_orders_updated_at
before update on public.market_purchase_orders
for each row execute function public.set_market_subproduct_updated_at();

drop trigger if exists trg_market_purchase_lines_updated_at on public.market_purchase_lines;
create trigger trg_market_purchase_lines_updated_at
before update on public.market_purchase_lines
for each row execute function public.set_market_subproduct_updated_at();

drop trigger if exists trg_market_entitlements_updated_at on public.market_entitlements;
create trigger trg_market_entitlements_updated_at
before update on public.market_entitlements
for each row execute function public.set_market_subproduct_updated_at();

alter table public.market_subproduct_categories enable row level security;
alter table public.market_file_types enable row level security;
alter table public.market_item_subproducts enable row level security;
alter table public.market_subproduct_files enable row level security;
alter table public.market_item_bundle_options enable row level security;
alter table public.market_purchase_orders enable row level security;
alter table public.market_purchase_lines enable row level security;
alter table public.market_entitlements enable row level security;

drop policy if exists "Authenticated users can read active market subproduct categories" on public.market_subproduct_categories;
create policy "Authenticated users can read active market subproduct categories"
  on public.market_subproduct_categories
  for select
  to authenticated
  using (is_active = true and deleted_at is null);

drop policy if exists "Admins can manage market subproduct categories" on public.market_subproduct_categories;
create policy "Admins can manage market subproduct categories"
  on public.market_subproduct_categories
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Authenticated users can read active market file types" on public.market_file_types;
create policy "Authenticated users can read active market file types"
  on public.market_file_types
  for select
  to authenticated
  using (is_active = true and deleted_at is null);

drop policy if exists "Admins can manage market file types" on public.market_file_types;
create policy "Admins can manage market file types"
  on public.market_file_types
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Authenticated users can read active market subproducts" on public.market_item_subproducts;
create policy "Authenticated users can read active market subproducts"
  on public.market_item_subproducts
  for select
  to authenticated
  using (
    is_active = true
    and deleted_at is null
    and exists (
      select 1
      from public.market_items items
      where items.id = item_id
        and items.workspace_subject = market_item_subproducts.workspace_subject
        and items.status = 'published'
        and items.is_active = true
        and items.deleted_at is null
    )
  );

drop policy if exists "Admins can manage market subproducts" on public.market_item_subproducts;
create policy "Admins can manage market subproducts"
  on public.market_item_subproducts
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Users can read entitled market subproduct files" on public.market_subproduct_files;
create policy "Users can read entitled market subproduct files"
  on public.market_subproduct_files
  for select
  to authenticated
  using (
    public.is_admin()
    or (
      is_active = true
      and deleted_at is null
      and exists (
        select 1
        from public.market_entitlements entitlements
        where entitlements.user_id = auth.uid()
          and entitlements.workspace_subject = market_subproduct_files.workspace_subject
          and entitlements.item_id = market_subproduct_files.item_id
          and entitlements.status = 'active'
          and (
            entitlements.scope = 'item'
            or (entitlements.scope = 'subproduct' and entitlements.subproduct_id = market_subproduct_files.subproduct_id)
            or (entitlements.scope = 'file' and entitlements.file_id = market_subproduct_files.id)
          )
      )
    )
  );

drop policy if exists "Admins can manage market subproduct files" on public.market_subproduct_files;
create policy "Admins can manage market subproduct files"
  on public.market_subproduct_files
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Authenticated users can read active market item bundle options" on public.market_item_bundle_options;
create policy "Authenticated users can read active market item bundle options"
  on public.market_item_bundle_options
  for select
  to authenticated
  using (
    is_active = true
    and exists (
      select 1
      from public.market_items items
      where items.id = item_id
        and items.workspace_subject = market_item_bundle_options.workspace_subject
        and items.status = 'published'
        and items.is_active = true
        and items.deleted_at is null
    )
  );

drop policy if exists "Admins can manage market item bundle options" on public.market_item_bundle_options;
create policy "Admins can manage market item bundle options"
  on public.market_item_bundle_options
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Users can read own market purchase orders" on public.market_purchase_orders;
create policy "Users can read own market purchase orders"
  on public.market_purchase_orders
  for select
  to authenticated
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Admins can manage market purchase orders" on public.market_purchase_orders;
create policy "Admins can manage market purchase orders"
  on public.market_purchase_orders
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Users can read own market purchase lines" on public.market_purchase_lines;
create policy "Users can read own market purchase lines"
  on public.market_purchase_lines
  for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.market_purchase_orders orders
      where orders.id = order_id
        and orders.workspace_subject = market_purchase_lines.workspace_subject
        and orders.user_id = auth.uid()
    )
  );

drop policy if exists "Admins can manage market purchase lines" on public.market_purchase_lines;
create policy "Admins can manage market purchase lines"
  on public.market_purchase_lines
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Users can read own market entitlements" on public.market_entitlements;
create policy "Users can read own market entitlements"
  on public.market_entitlements
  for select
  to authenticated
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Admins can manage market entitlements" on public.market_entitlements;
create policy "Admins can manage market entitlements"
  on public.market_entitlements
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
