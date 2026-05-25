alter table public.market_items
  add column if not exists zip_price integer not null default 0 check (zip_price >= 0);

comment on column public.market_items.zip_price is '문제마켓 ZIP 독립 유료 자산 가격(크레딧). 0이면 미제공으로 처리한다.';
comment on column public.market_item_sample_pages.source_file_id is '유료 PDF 업로드에서 자동 생성된 샘플이면 source market_item_files.id, 별도 샘플 PDF 업로드처럼 원본 source를 저장하지 않는 경우 null.';

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.market_item_files'::regclass
      and conname = 'market_item_files_asset_kind_check'
  ) then
    alter table public.market_item_files drop constraint market_item_files_asset_kind_check;
  end if;

  alter table public.market_item_files
    add constraint market_item_files_asset_kind_check
    check (asset_kind in ('sample', 'pdf', 'hwp', 'zip'));
end $$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.market_purchases'::regclass
      and conname = 'market_purchases_asset_kind_check'
  ) then
    alter table public.market_purchases drop constraint market_purchases_asset_kind_check;
  end if;

  alter table public.market_purchases
    add constraint market_purchases_asset_kind_check
    check (asset_kind in ('pdf', 'hwp', 'zip'));
end $$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.market_download_events'::regclass
      and conname = 'market_download_events_asset_kind_check'
  ) then
    alter table public.market_download_events drop constraint market_download_events_asset_kind_check;
  end if;

  alter table public.market_download_events
    add constraint market_download_events_asset_kind_check
    check (asset_kind in ('sample', 'pdf', 'hwp', 'zip'));
end $$;

comment on table public.market_item_files is '문제마켓 파일 자산 메타데이터. paid asset은 pdf/hwp/zip, sample은 legacy cleanup/audit 호환용으로만 유지한다.';
comment on table public.market_purchases is '문제마켓 유료 자산 구매 이력. pdf/hwp/zip을 독립 구매 단위로 저장하며 hwp 구매는 pdf 다운로드를 포함한다.';
comment on table public.market_download_events is '문제마켓 다운로드 이벤트. public 유료 다운로드는 pdf/hwp/zip만 허용하고 sample은 legacy event 호환용이다.';
