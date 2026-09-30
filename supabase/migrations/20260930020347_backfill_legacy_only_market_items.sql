-- legacy 전용 상품을 V2 서브상품으로 이관 (docs/cart-implementation-plan-v4.md 2.2-3·4, 7절 Phase 1 작업 2)
-- 대상 = 게시·활성·미삭제 상품 중 활성·미삭제 legacy 유료 파일(해당 kind 가격 > 0)이 있고
--        활성·미삭제 V2 서브상품과 활성 번들이 모두 없는 상품. ID·제목은 쓰지 않고 이 조건으로만 고른다.
-- kind 규칙은 src/lib/market-subproduct-backfill.ts와 같다: kind ∈ {pdf, hwp, zip}, 가격 > 0 이고
-- 활성 파일이 있을 때만 서브상품 1 + 파일 1(같은 storage path 참조, 파일 복사 없음),
-- 카테고리 pdf → legacy_pdf, hwp → legacy_hwp_bundle, zip → legacy_zip.
-- Phase 0 dry-run(P0-5): 대상 1개, 서브상품 2(legacy_pdf 1000, legacy_hwp_bundle 1500), 파일 2, zip 건너뜀.
--
-- 트랜잭션: 20260930020304_market_cart_checkout.sql 머리 주석과 같은 이유로 BEGIN/COMMIT을 두지 않는다.
-- 재실행 안전: 이관 후 대상 조건(V2 서브상품 없음)이 거짓이 되고, (상품, 카테고리) NOT EXISTS 가드도 둔다.

-- 1. 중단 가드 (둘 중 하나라도 해당하면 파일 전체를 중단한다)
--    a) 2.2-2: 대상 상품에 completed legacy 구매가 있으면 소유권 매핑이 필요하다.
--    b) 같은 (상품, kind)의 활성 유료 legacy 파일이 2개 이상이면 어느 파일을 옮길지 규칙이 없다
--       (TS 규칙은 item:kind 키당 서브상품 1·파일 1). 3의 조인이 행을 중복 생성하지 않도록 막는다.
do $$
begin
  if exists (
    with target_item as (
      select i.id, i.pdf_price, i.hwp_price, i.zip_price
      from public.market_items i
      where i.status = 'published' and i.is_active and i.deleted_at is null
        and exists (
          select 1 from public.market_item_files f
          where f.item_id = i.id and f.is_active and f.deleted_at is null
            and case f.asset_kind
                  when 'pdf' then i.pdf_price
                  when 'hwp' then i.hwp_price
                  when 'zip' then i.zip_price
                end > 0
        )
        and not exists (
          select 1 from public.market_item_subproducts s
          where s.item_id = i.id and s.is_active and s.deleted_at is null
        )
        and not exists (
          select 1 from public.market_item_bundle_options b
          where b.item_id = i.id and b.is_active
        )
    )
    select 1
    from target_item t
    join public.market_purchases p on p.item_id = t.id and p.status = 'completed'
  ) then
    raise exception 'LEGACY_BACKFILL_BLOCKED: target items have completed legacy purchases';
  end if;

  if exists (
    select 1
    from public.market_items i
    join public.market_item_files f
      on f.item_id = i.id and f.is_active and f.deleted_at is null
     and f.asset_kind in ('pdf', 'hwp', 'zip')
    where i.status = 'published' and i.is_active and i.deleted_at is null
      and case f.asset_kind
            when 'pdf' then i.pdf_price
            when 'hwp' then i.hwp_price
            when 'zip' then i.zip_price
          end > 0
      and not exists (
        select 1 from public.market_item_subproducts s
        where s.item_id = i.id and s.is_active and s.deleted_at is null
      )
      and not exists (
        select 1 from public.market_item_bundle_options b
        where b.item_id = i.id and b.is_active
      )
    group by i.id, f.asset_kind
    having count(*) > 1
  ) then
    raise exception 'LEGACY_BACKFILL_BLOCKED: multiple active legacy files for the same item and kind';
  end if;
end;
$$;

-- 2. 2.2-4 표시명 정정: 이관 파일이 HWP 1개뿐이므로 legacy_hwp_bundle 'HWP & PDF' → 'HWP 파일'.
--    [적용 전 사용자 보고 필요 — 계획 2.2-4 "삭제 아님, 실행 전 보고"]
--    미삭제 행 중 기존 이름이 그대로일 때만 바꿔 재실행·관리자 수정값을 덮어쓰지 않는다.
--    서브상품 제목은 카테고리 표시명을 쓰므로 3보다 먼저 실행한다.
update public.market_subproduct_categories
set name = 'HWP 파일',
    updated_at = now()
where slug = 'legacy_hwp_bundle'
  and name = 'HWP & PDF'
  and deleted_at is null;

-- 3. 서브상품 + 파일 생성 (한 문장).
with target_item as (
  select i.id, i.workspace_subject, i.pdf_price, i.hwp_price, i.zip_price
  from public.market_items i
  where i.status = 'published' and i.is_active and i.deleted_at is null
    and not exists (
      select 1 from public.market_item_subproducts s
      where s.item_id = i.id and s.is_active and s.deleted_at is null
    )
    and not exists (
      select 1 from public.market_item_bundle_options b
      where b.item_id = i.id and b.is_active
    )
),
legacy_target as (
  select
    t.id as item_id,
    t.workspace_subject,
    k.price,
    c.id as category_id,
    c.name as category_name,
    c.sort_order as category_sort_order,
    ft.id as file_type_id,
    f.storage_bucket,
    f.storage_path,
    f.original_file_name,
    f.mime_type,
    f.file_size_bytes,
    f.checksum
  from target_item t
  join public.market_item_files f
    on f.item_id = t.id
   and f.is_active and f.deleted_at is null
   and f.asset_kind in ('pdf', 'hwp', 'zip')
  cross join lateral (
    select
      case f.asset_kind
        when 'pdf' then t.pdf_price
        when 'hwp' then t.hwp_price
        when 'zip' then t.zip_price
      end as price,
      case f.asset_kind
        when 'pdf' then 'legacy_pdf'
        when 'hwp' then 'legacy_hwp_bundle'
        when 'zip' then 'legacy_zip'
      end as category_slug
  ) k
  join public.market_subproduct_categories c
    on c.workspace_subject = t.workspace_subject
   and c.slug = k.category_slug
   and c.deleted_at is null
  join public.market_file_types ft
    on ft.workspace_subject = t.workspace_subject
   and ft.code = f.asset_kind
   and ft.deleted_at is null
  where k.price > 0
    and not exists (
      select 1 from public.market_item_subproducts s
      where s.item_id = t.id and s.category_id = c.id and s.deleted_at is null
    )
),
new_subproduct as (
  insert into public.market_item_subproducts (
    item_id, workspace_subject, category_id, title, price_credits, sort_order
  )
  select item_id, workspace_subject, category_id, category_name, price, category_sort_order
  from legacy_target
  returning id, item_id, category_id
)
insert into public.market_subproduct_files (
  item_id, subproduct_id, workspace_subject, file_type_id,
  storage_bucket, storage_path, original_file_name, content_type, file_size_bytes, checksum
)
select
  lt.item_id, ns.id, lt.workspace_subject, lt.file_type_id,
  lt.storage_bucket, lt.storage_path, lt.original_file_name, lt.mime_type, lt.file_size_bytes, lt.checksum
from new_subproduct ns
join legacy_target lt on lt.item_id = ns.item_id and lt.category_id = ns.category_id;
