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
