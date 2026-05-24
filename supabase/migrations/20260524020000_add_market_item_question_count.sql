alter table public.market_items
add column if not exists question_count integer;

alter table public.market_items
drop constraint if exists market_items_question_count_check;

alter table public.market_items
add constraint market_items_question_count_check
check (question_count is null or question_count >= 0);

comment on column public.market_items.question_count is '문제마켓 상품 문항 수';
