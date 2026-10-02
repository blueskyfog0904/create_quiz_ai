-- 관리자 상품 이미지 라이브러리 M2 (docs/admin-product-image-library-plan.md 2절, 4절 DELETE, 6절 M2)
-- - market_items.thumbnail_image_id, market_category_items.default_image_id → market_images (restrict)
-- - delete_market_image RPC: 사용 중이면 IN_USE, 아니면 삭제된 상품 참조를 비우고 이미지 행 삭제
-- 전제: 20261002014044_market_image_library 적용 후.
--
-- 트랜잭션: 파일 안에 BEGIN/COMMIT을 두지 않는다(20260930020304_market_cart_checkout와 같은 이유).
-- 재실행 안전: IF NOT EXISTS / CREATE OR REPLACE / pg_constraint 확인 DO 블록.

-- 1. 참조 컬럼 (D1, 제안 E). 이미지는 과목과 무관하므로 단일 컬럼 FK다.
alter table public.market_items
  add column if not exists thumbnail_image_id uuid;

alter table public.market_category_items
  add column if not exists default_image_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'market_items_thumbnail_image_id_fkey'
      and conrelid = 'public.market_items'::regclass
  ) then
    alter table public.market_items
      add constraint market_items_thumbnail_image_id_fkey
      foreign key (thumbnail_image_id)
      references public.market_images(id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'market_category_items_default_image_id_fkey'
      and conrelid = 'public.market_category_items'::regclass
  ) then
    alter table public.market_category_items
      add constraint market_category_items_default_image_id_fkey
      foreign key (default_image_id)
      references public.market_images(id)
      on delete restrict;
  end if;
end;
$$;

create index if not exists idx_market_items_thumbnail_image_id
  on public.market_items(thumbnail_image_id)
  where thumbnail_image_id is not null;

create index if not exists idx_market_category_items_default_image_id
  on public.market_category_items(default_image_id)
  where default_image_id is not null;

-- 2. 이미지 삭제 RPC. 업무 거절은 {ok:false, code}로 반환한다.
-- 사용 중 = 삭제되지 않은 상품(deleted_at is null)의 thumbnail_image_id + 카테고리 항목의 default_image_id.
-- 이미지 행을 FOR UPDATE로 잠가, FK 확인(FOR KEY SHARE)으로 동시에 지정하려는 트랜잭션과 직렬화한다.
-- 그래도 남는 경합은 FK restrict가 23503으로 막고 API가 409 IN_USE로 변환한다.
-- storage 객체 삭제는 API가 반환된 storagePath로 한다.
create or replace function public.delete_market_image(p_image_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_storage_path text;
  v_items jsonb;
  v_category_items jsonb;
  v_cleared integer;
begin
  if p_image_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  select storage_path into v_storage_path
  from public.market_images
  where id = p_image_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title) order by i.title, i.id), '[]'::jsonb)
  into v_items
  from public.market_items i
  where i.thumbnail_image_id = p_image_id
    and i.deleted_at is null;

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title) order by c.title, c.id), '[]'::jsonb)
  into v_category_items
  from public.market_category_items c
  where c.default_image_id = p_image_id;

  if jsonb_array_length(v_items) > 0 or jsonb_array_length(v_category_items) > 0 then
    return jsonb_build_object(
      'ok', false,
      'code', 'IN_USE',
      'items', v_items,
      'categoryItems', v_category_items
    );
  end if;

  -- 소프트 삭제된 상품의 참조가 이미지를 영구 사용 중으로 만들지 않도록 비운다(N2).
  update public.market_items
  set thumbnail_image_id = null
  where thumbnail_image_id = p_image_id
    and deleted_at is not null;
  get diagnostics v_cleared = row_count;

  delete from public.market_images where id = p_image_id;

  return jsonb_build_object(
    'ok', true,
    'imageId', p_image_id,
    'storagePath', v_storage_path,
    'clearedDeletedItems', v_cleared
  );
end;
$$;

revoke all on function public.delete_market_image(uuid) from public, anon, authenticated;
grant execute on function public.delete_market_image(uuid) to service_role;
