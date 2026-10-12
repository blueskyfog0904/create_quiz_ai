-- 카테고리 기본 이미지 상속: 자기 칸부터 상위 칸으로 올라가며 가장 가까운 기본 이미지를 돌려준다.
-- PostgREST computed relationship(rows 1 = to-one)으로 쓴다:
--   category_item:market_category_items(default_image:effective_default_image(storage_path))
-- 데이터는 바꾸지 않는다.
create or replace function public.effective_default_image(public.market_category_items)
returns setof public.market_images
language sql
stable
rows 1
set search_path = ''
as $$
  with recursive chain as (
    select $1.id, $1.parent_id, $1.workspace_subject, $1.default_image_id, 0 as hops
    union all
    select parent.id, parent.parent_id, parent.workspace_subject, parent.default_image_id, chain.hops + 1
    from public.market_category_items parent
    join chain on parent.id = chain.parent_id and parent.workspace_subject = chain.workspace_subject
  )
  select image.*
  from chain
  join public.market_images image on image.id = chain.default_image_id
  order by chain.hops
  limit 1
$$;

grant execute on function public.effective_default_image(public.market_category_items) to anon, authenticated, service_role;
