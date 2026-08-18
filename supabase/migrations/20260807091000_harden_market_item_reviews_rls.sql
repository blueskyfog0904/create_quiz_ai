create index if not exists idx_market_item_reviews_item_workspace
  on public.market_item_reviews(item_id, workspace_subject);

drop policy if exists "Admins can manage market item reviews" on public.market_item_reviews;

drop policy if exists "Public can read active market item reviews" on public.market_item_reviews;
create policy "Public can read active market item reviews"
  on public.market_item_reviews
  for select
  to anon, authenticated
  using (
    (select public.is_admin())
    or (
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
    )
  );

drop policy if exists "Purchasers can create market item reviews" on public.market_item_reviews;
create policy "Purchasers can create market item reviews"
  on public.market_item_reviews
  for insert
  to authenticated
  with check (
    (select public.is_admin())
    or (
      user_id = (select auth.uid())
      and deleted_at is null
      and exists (
        select 1
        from public.market_entitlements entitlements
        where entitlements.user_id = (select auth.uid())
          and entitlements.item_id = market_item_reviews.item_id
          and entitlements.workspace_subject = market_item_reviews.workspace_subject
          and entitlements.status = 'active'
      )
    )
  );

drop policy if exists "Purchasers can update own market item reviews" on public.market_item_reviews;
create policy "Purchasers can update own market item reviews"
  on public.market_item_reviews
  for update
  to authenticated
  using (
    (select public.is_admin())
    or (user_id = (select auth.uid()) and deleted_at is null)
  )
  with check (
    (select public.is_admin())
    or (
      user_id = (select auth.uid())
      and deleted_at is null
      and exists (
        select 1
        from public.market_entitlements entitlements
        where entitlements.user_id = (select auth.uid())
          and entitlements.item_id = market_item_reviews.item_id
          and entitlements.workspace_subject = market_item_reviews.workspace_subject
          and entitlements.status = 'active'
      )
    )
  );

drop policy if exists "Purchasers can delete own market item reviews" on public.market_item_reviews;
create policy "Purchasers can delete own market item reviews"
  on public.market_item_reviews
  for delete
  to authenticated
  using (
    (select public.is_admin())
    or user_id = (select auth.uid())
  );
