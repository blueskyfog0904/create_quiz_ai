create index if not exists idx_market_download_events_home_ranking
  on public.market_download_events (
    workspace_subject,
    created_at desc,
    item_id,
    user_id
  );

create or replace function public.get_market_home_popular_items(
  p_workspace_subject text,
  p_from timestamptz,
  p_limit integer
)
returns table (
  item_id uuid,
  download_issuer_user_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;

  if p_workspace_subject not in ('english', 'korean') then
    raise exception 'unsupported workspace subject' using errcode = '22023';
  end if;

  if p_from is null or p_from > now() or p_limit < 1 or p_limit > 24 then
    raise exception 'ranking arguments out of range' using errcode = '22023';
  end if;

  return query
  select
    items.id as item_id,
    count(distinct events.user_id)::bigint as download_issuer_user_count
  from public.market_download_events as events
  join public.market_items as items
    on items.id = events.item_id
   and items.workspace_subject = p_workspace_subject
   and items.status = 'published'
   and items.is_active = true
   and items.deleted_at is null
  join public.market_menu_entries as menus
    on menus.id = items.menu_entry_id
   and menus.workspace_subject = p_workspace_subject
   and menus.is_visible = true
   and menus.is_active = true
   and menus.deleted_at is null
  where events.workspace_subject = p_workspace_subject
    and events.created_at >= p_from
  group by
    items.id,
    items.published_at
  order by
    download_issuer_user_count desc,
    items.published_at desc nulls last,
    items.id asc
  limit p_limit;
end;
$$;

revoke all on function public.get_market_home_popular_items(text, timestamptz, integer) from public;
revoke all on function public.get_market_home_popular_items(text, timestamptz, integer) from anon;
revoke all on function public.get_market_home_popular_items(text, timestamptz, integer) from authenticated;
grant execute on function public.get_market_home_popular_items(text, timestamptz, integer) to service_role;
