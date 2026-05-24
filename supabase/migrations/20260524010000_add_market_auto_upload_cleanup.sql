alter table public.market_items
add column if not exists draft_source text not null default 'manual';

alter table public.market_items
drop constraint if exists market_items_draft_source_check;

alter table public.market_items
add constraint market_items_draft_source_check
check (draft_source in ('manual', 'auto_upload'));

create index if not exists idx_market_items_auto_upload_draft_cleanup
on public.market_items(workspace_subject, draft_source, status, updated_at)
where deleted_at is null;
