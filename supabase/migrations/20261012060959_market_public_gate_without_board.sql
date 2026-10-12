-- 공개 상품 노출을 게시판(market_menu_entries) 상태와 무관하게 상품 상태만으로 판단한다
-- (docs/market-category-tree-plan.md 8.9 S3). 시그니처·반환 형태·권한은 그대로 둔다.

create or replace function public.get_market_home_popular_items(p_workspace_subject text, p_from timestamp with time zone, p_limit integer)
 returns table(item_id uuid, download_issuer_user_count bigint)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select
    items.id as item_id,
    count(distinct events.user_id)::bigint as download_issuer_user_count
  from public.market_items as items
  join public.market_download_events as events
    on events.item_id = items.id
    and events.workspace_subject = items.workspace_subject
  where items.workspace_subject = p_workspace_subject
    and p_workspace_subject in ('english', 'korean')
    and events.created_at >= p_from
    and items.status = 'published'
    and items.is_active = true
    and items.deleted_at is null
  group by items.id, items.published_at
  order by
    download_issuer_user_count desc,
    items.published_at desc nulls last,
    items.id asc
  limit greatest(0, least(coalesce(p_limit, 0), 100));
$function$;

revoke all on function public.get_market_home_popular_items(text, timestamptz, integer) from public;
revoke all on function public.get_market_home_popular_items(text, timestamptz, integer) from anon;
revoke all on function public.get_market_home_popular_items(text, timestamptz, integer) from authenticated;
grant execute on function public.get_market_home_popular_items(text, timestamptz, integer) to service_role;

drop policy if exists "Authenticated users can read published market items" on public.market_items;
create policy "Authenticated users can read published market items"
  on public.market_items for select to authenticated
  using (status = 'published' and is_active = true and deleted_at is null);
