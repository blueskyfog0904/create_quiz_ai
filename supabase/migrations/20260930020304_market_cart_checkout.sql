-- 장바구니 Phase 1 스키마 (docs/cart-implementation-plan-v4.md 3절, 3.4, 7절 Phase 1 작업 1)
-- - market_cart_items, market_checkout_batches, market_purchase_orders.checkout_batch_id
-- - 장바구니 RPC: add_market_cart_item, set_market_cart_selection, remove_market_cart_items
--   (evaluate_market_targets, checkout_market_selection은 Phase 2 migration)
-- - P1-7: market_purchases 사용자 쓰기 정책 DROP + 판매 테이블 4개 직접 DML REVOKE
-- - P1-9: 원격 전용 grant_credits/deduct_credits DROP
--
-- 트랜잭션: 파일 안에 BEGIN/COMMIT을 두지 않는다.
--   apply_migration이 파일을 한 번의 multi-statement 쿼리로 보내면 PostgreSQL이 암묵 트랜잭션으로
--   묶고, 도구가 자체 트랜잭션으로 감싸 이력 행을 함께 기록한다면 내부 COMMIT이 그 트랜잭션을
--   조기 종료시켜 이력 기록과 분리된다. 어느 경우든 명시 BEGIN/COMMIT이 없는 쪽이 원자성을 해치지
--   않는다. 실제 트랜잭션 처리 여부는 미확인 전제이며 적용 시 P1-8 객체 체크리스트로 확인한다.
-- 재실행 안전: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS / pg_constraint 확인 DO 블록.

-- 1. 장바구니 행 (3.1). 가격·item_id·과목·파일 경로는 저장하지 않는다.
create table if not exists public.market_cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_kind text not null check (target_kind in ('subproduct', 'bundle')),
  subproduct_id uuid references public.market_item_subproducts(id) on delete cascade,
  bundle_option_id uuid references public.market_item_bundle_options(id) on delete cascade,
  is_selected boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_cart_items_target_check
    check (
      (target_kind = 'subproduct' and subproduct_id is not null and bundle_option_id is null)
      or (target_kind = 'bundle' and bundle_option_id is not null and subproduct_id is null)
    )
);

comment on table public.market_cart_items is '문제마켓 장바구니 행. 쓰기는 service role RPC 전용';

create unique index if not exists uq_market_cart_items_user_subproduct
  on public.market_cart_items(user_id, subproduct_id)
  where target_kind = 'subproduct';

create unique index if not exists uq_market_cart_items_user_bundle
  on public.market_cart_items(user_id, bundle_option_id)
  where target_kind = 'bundle';

create index if not exists idx_market_cart_items_user_created_at
  on public.market_cart_items(user_id, created_at desc, id);

-- 2. 결제 배치 (3.2). 성공 트랜잭션에서만 INSERT(Phase 2 checkout RPC).
create table if not exists public.market_checkout_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('cart', 'direct')),
  idempotency_key uuid not null,
  request_payload jsonb not null,
  total_credits integer not null check (total_credits > 0),
  result_payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

comment on table public.market_checkout_batches is '문제마켓 크레딧 구매 배치(장바구니/단건). 영수증 스냅샷은 result_payload';

-- 3. child 주문 → 배치 (3.3). 기본 NO ACTION: 배치 단독 삭제 차단, profile CASCADE는 같은 문장에서 통과.
alter table public.market_purchase_orders
  add column if not exists checkout_batch_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'market_purchase_orders_checkout_batch_id_fkey'
      and conrelid = 'public.market_purchase_orders'::regclass
  ) then
    alter table public.market_purchase_orders
      add constraint market_purchase_orders_checkout_batch_id_fkey
      foreign key (checkout_batch_id)
      references public.market_checkout_batches(id);
  end if;
end;
$$;

create index if not exists idx_market_purchase_orders_checkout_batch
  on public.market_purchase_orders(checkout_batch_id)
  where checkout_batch_id is not null;

-- 4. 권한 (3.4, baseline 10.3). 기본 ACL이 anon/authenticated에 전 권한을 주므로 생성 직후 회수하고
--    소유자 SELECT 정책이 동작하도록 authenticated SELECT만 재부여한다.
alter table public.market_cart_items enable row level security;
alter table public.market_checkout_batches enable row level security;

revoke all on table public.market_cart_items from public, anon, authenticated;
revoke all on table public.market_checkout_batches from public, anon, authenticated;
grant select on table public.market_cart_items to authenticated;
grant select on table public.market_checkout_batches to authenticated;

drop policy if exists "Users can read own market cart items" on public.market_cart_items;
create policy "Users can read own market cart items"
  on public.market_cart_items for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can read own market checkout batches" on public.market_checkout_batches;
create policy "Users can read own market checkout batches"
  on public.market_checkout_batches for select
  to authenticated
  using (user_id = auth.uid());

-- 5. 장바구니 RPC. 모든 업무 거절은 {ok:false, code}로 반환한다.

-- 담기: profile 잠금 → target 존재·활성 확인 → 중복이면 기존 행 → 50행 한도 → INSERT.
-- 중복 확인을 한도보다 먼저 해 50행 상태에서도 이미 담긴 target은 기존 행을 돌려준다.
create or replace function public.add_market_cart_item(
  p_user_id uuid,
  p_target_kind text,
  p_target_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_cart_item_id uuid;
  v_created boolean := false;
  v_count integer;
begin
  if p_user_id is null or p_target_id is null
     or p_target_kind is null or p_target_kind not in ('subproduct', 'bundle') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  perform 1 from public.profiles where id = p_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if p_target_kind = 'subproduct' then
    perform 1
    from public.market_item_subproducts s
    join public.market_items i on i.id = s.item_id
    where s.id = p_target_id
      and s.is_active and s.deleted_at is null
      and i.status = 'published' and i.is_active and i.deleted_at is null;
  else
    perform 1
    from public.market_item_bundle_options b
    join public.market_items i on i.id = b.item_id
    where b.id = p_target_id
      and b.is_active
      and i.status = 'published' and i.is_active and i.deleted_at is null;
  end if;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  select c.id into v_cart_item_id
  from public.market_cart_items c
  where c.user_id = p_user_id
    and c.target_kind = p_target_kind
    and coalesce(c.subproduct_id, c.bundle_option_id) = p_target_id;

  if v_cart_item_id is null then
    select count(*) into v_count from public.market_cart_items where user_id = p_user_id;
    if v_count >= 50 then
      return jsonb_build_object('ok', false, 'code', 'CART_LIMIT', 'count', v_count);
    end if;

    insert into public.market_cart_items (user_id, target_kind, subproduct_id, bundle_option_id)
    values (
      p_user_id,
      p_target_kind,
      case when p_target_kind = 'subproduct' then p_target_id end,
      case when p_target_kind = 'bundle' then p_target_id end
    )
    on conflict do nothing;
    v_created := found;

    -- 새 행, 또는 UNIQUE 충돌로 이미 있던 행의 ID를 반환한다.
    select c.id into v_cart_item_id
    from public.market_cart_items c
    where c.user_id = p_user_id
      and c.target_kind = p_target_kind
      and coalesce(c.subproduct_id, c.bundle_option_id) = p_target_id;
  end if;

  select count(*) into v_count from public.market_cart_items where user_id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'cartItemId', v_cart_item_id,
    'created', v_created,
    'count', v_count
  );
end;
$$;

-- 선택 변경(LWW): 소유 행만 ID 오름차순 FOR UPDATE로 잠근 뒤 갱신(checkout 4단계와 같은 잠금 순서).
create or replace function public.set_market_cart_selection(
  p_user_id uuid,
  p_ids uuid[],
  p_selected boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated uuid[];
begin
  if p_user_id is null or p_selected is null or p_ids is null
     or cardinality(p_ids) = 0 or cardinality(p_ids) > 50
     or array_position(p_ids, null) is not null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  perform 1
  from public.market_cart_items
  where user_id = p_user_id and id = any(p_ids)
  order by id
  for update;

  with updated as (
    update public.market_cart_items
    set is_selected = p_selected,
        updated_at = now()
    where user_id = p_user_id and id = any(p_ids)
    returning id
  )
  select coalesce(array_agg(id order by id), '{}') into v_updated from updated;

  return jsonb_build_object(
    'ok', true,
    'updatedIds', to_jsonb(v_updated),
    'missingIds', to_jsonb(array(
      select distinct x from unnest(p_ids) as x where x <> all(v_updated) order by x
    ))
  );
end;
$$;

-- 삭제: 소유 행만 ID 오름차순 FOR UPDATE로 잠근 뒤 삭제. 이미 없는 ID는 성공 취급.
create or replace function public.remove_market_cart_items(
  p_user_id uuid,
  p_ids uuid[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_removed uuid[];
  v_count integer;
begin
  if p_user_id is null or p_ids is null
     or cardinality(p_ids) = 0 or cardinality(p_ids) > 50
     or array_position(p_ids, null) is not null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  perform 1
  from public.market_cart_items
  where user_id = p_user_id and id = any(p_ids)
  order by id
  for update;

  with removed as (
    delete from public.market_cart_items
    where user_id = p_user_id and id = any(p_ids)
    returning id
  )
  select coalesce(array_agg(id order by id), '{}') into v_removed from removed;

  select count(*) into v_count from public.market_cart_items where user_id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'removedIds', to_jsonb(v_removed),
    'count', v_count
  );
end;
$$;

revoke all on function public.add_market_cart_item(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.set_market_cart_selection(uuid, uuid[], boolean) from public, anon, authenticated;
revoke all on function public.remove_market_cart_items(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.add_market_cart_item(uuid, text, uuid) to service_role;
grant execute on function public.set_market_cart_selection(uuid, uuid[], boolean) to service_role;
grant execute on function public.remove_market_cart_items(uuid, uuid[]) to service_role;

-- 6. P1-7: 판매 테이블 직접 쓰기 차단 (baseline 10.5 '열림'). 서버 쓰기는 이미 service role이다.
drop policy if exists "Users can insert own market purchases" on public.market_purchases;
drop policy if exists "Users can update own pending market purchases" on public.market_purchases;

revoke insert, update, delete, truncate on table public.market_purchases from anon, authenticated;
revoke insert, update, delete, truncate on table public.market_purchase_orders from anon, authenticated;
revoke insert, update, delete, truncate on table public.market_purchase_lines from anon, authenticated;
revoke insert, update, delete, truncate on table public.market_entitlements from anon, authenticated;

-- 7. P1-9: 원격에만 있는 grant_credits/deduct_credits 제거 (baseline 0절 4번, 사용자 결정 (c)).
--    시그니처는 baseline 06_functions_list의 pg_get_function_identity_arguments 기준.
drop function if exists public.grant_credits(uuid, integer, text, text, text, uuid);
drop function if exists public.deduct_credits(uuid, integer, text, text, uuid);
