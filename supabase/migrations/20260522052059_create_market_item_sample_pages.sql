create table if not exists public.market_item_sample_pages (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.market_items(id) on delete cascade,
  source_file_id uuid references public.market_item_files(id) on delete set null,
  workspace_subject text not null default 'english',
  page_number integer not null check (page_number between 1 and 3),
  storage_bucket text not null,
  storage_path text not null,
  original_file_name text not null,
  mime_type text not null default 'image/jpeg',
  file_size_bytes bigint not null,
  width_px integer,
  height_px integer,
  version integer not null default 1,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.market_item_sample_pages is '문제마켓 판매 PDF에서 자동 생성된 JPG 샘플 페이지';
comment on column public.market_item_sample_pages.source_file_id is '샘플 페이지의 원본 PDF 파일 row';
comment on column public.market_item_sample_pages.page_number is 'PDF에서 추출한 샘플 페이지 번호(1~3)';

create index if not exists idx_market_item_sample_pages_item_active
  on public.market_item_sample_pages(workspace_subject, item_id, is_active, page_number);

create unique index if not exists uq_market_item_sample_pages_active_page
  on public.market_item_sample_pages(item_id, page_number)
  where is_active = true and deleted_at is null;

alter table public.market_item_sample_pages enable row level security;

drop policy if exists "Authenticated users can read active market item sample pages" on public.market_item_sample_pages;
create policy "Authenticated users can read active market item sample pages"
  on public.market_item_sample_pages
  for select
  to authenticated
  using (
    is_active = true
    and deleted_at is null
    and exists (
      select 1
      from public.market_items items
      where items.id = item_id
        and items.workspace_subject = market_item_sample_pages.workspace_subject
        and items.status = 'published'
        and items.is_active = true
        and items.deleted_at is null
    )
  );

drop policy if exists "Admins can manage market item sample pages" on public.market_item_sample_pages;
create policy "Admins can manage market item sample pages"
  on public.market_item_sample_pages
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
