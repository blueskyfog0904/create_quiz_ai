alter table public.market_item_subproducts
  add column if not exists purchase_notice_label text,
  add column if not exists purchase_notice_text text;

comment on column public.market_item_subproducts.purchase_notice_label is '구매 옵션 행에 표시할 짧은 안내 배지/라벨';
comment on column public.market_item_subproducts.purchase_notice_text is '구매 옵션 행에 표시할 구매 안내 문구';
