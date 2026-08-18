create table if not exists public.market_item_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_subject text not null check (workspace_subject in ('english', 'korean')),
  item_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint market_item_reviews_item_workspace_fkey
    foreign key (item_id, workspace_subject)
    references public.market_items(id, workspace_subject)
    on delete cascade
);

comment on table public.market_item_reviews is '구매자가 문제마켓 상품에 남긴 평점';
comment on column public.market_item_reviews.rating is '1점부터 5점까지의 구매자 상품 평점';

create unique index if not exists uq_market_item_reviews_active_user_item
  on public.market_item_reviews(user_id, item_id)
  where deleted_at is null;

create index if not exists idx_market_item_reviews_item_rating
  on public.market_item_reviews(workspace_subject, item_id, rating)
  where deleted_at is null;

create or replace function public.set_market_item_reviews_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_market_item_reviews_updated_at on public.market_item_reviews;
create trigger trg_market_item_reviews_updated_at
before update on public.market_item_reviews
for each row execute function public.set_market_item_reviews_updated_at();

alter table public.market_item_reviews enable row level security;

drop policy if exists "Public can read active market item reviews" on public.market_item_reviews;
create policy "Public can read active market item reviews"
  on public.market_item_reviews
  for select
  to anon, authenticated
  using (
    deleted_at is null
    and exists (
      select 1
      from public.market_items items
      where items.id = item_id
        and items.workspace_subject = market_item_reviews.workspace_subject
        and items.status = 'published'
        and items.is_active = true
        and items.deleted_at is null
    )
  );

drop policy if exists "Purchasers can create market item reviews" on public.market_item_reviews;
create policy "Purchasers can create market item reviews"
  on public.market_item_reviews
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and deleted_at is null
    and exists (
      select 1
      from public.market_entitlements entitlements
      where entitlements.user_id = auth.uid()
        and entitlements.item_id = market_item_reviews.item_id
        and entitlements.workspace_subject = market_item_reviews.workspace_subject
        and entitlements.status = 'active'
    )
  );

drop policy if exists "Purchasers can update own market item reviews" on public.market_item_reviews;
create policy "Purchasers can update own market item reviews"
  on public.market_item_reviews
  for update
  to authenticated
  using (user_id = auth.uid() and deleted_at is null)
  with check (
    user_id = auth.uid()
    and deleted_at is null
    and exists (
      select 1
      from public.market_entitlements entitlements
      where entitlements.user_id = auth.uid()
        and entitlements.item_id = market_item_reviews.item_id
        and entitlements.workspace_subject = market_item_reviews.workspace_subject
        and entitlements.status = 'active'
    )
  );

drop policy if exists "Purchasers can delete own market item reviews" on public.market_item_reviews;
create policy "Purchasers can delete own market item reviews"
  on public.market_item_reviews
  for delete
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Admins can manage market item reviews" on public.market_item_reviews;
create policy "Admins can manage market item reviews"
  on public.market_item_reviews
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.market_item_reviews from anon, authenticated;
grant select on public.market_item_reviews to anon, authenticated;
grant insert, update, delete on public.market_item_reviews to authenticated;
