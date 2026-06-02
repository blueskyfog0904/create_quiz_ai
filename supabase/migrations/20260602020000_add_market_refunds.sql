-- 문제마켓 환불 요청과 v2 다운로드 이벤트 감사 로그 확장

alter table public.market_purchases
  add column if not exists credit_consumptions jsonb;

alter table public.market_purchase_orders
  add column if not exists credit_consumptions jsonb;

alter table public.market_download_events
  alter column file_id drop not null;

alter table public.market_download_events
  add column if not exists event_target_type text,
  add column if not exists order_id uuid references public.market_purchase_orders(id) on delete set null,
  add column if not exists entitlement_id uuid references public.market_entitlements(id) on delete set null,
  add column if not exists subproduct_file_id uuid references public.market_subproduct_files(id) on delete set null,
  add column if not exists signed_url_expires_at timestamptz,
  add column if not exists user_agent text;

update public.market_download_events
set event_target_type = 'legacy_asset'
where event_target_type is null;

alter table public.market_download_events
  alter column event_target_type set default 'legacy_asset';

alter table public.market_download_events
  drop constraint if exists market_download_events_target_check;

alter table public.market_download_events
  add constraint market_download_events_target_check
  check (
    (
      event_target_type = 'legacy_asset'
      and file_id is not null
      and subproduct_file_id is null
    )
    or (
      event_target_type = 'subproduct_file'
      and subproduct_file_id is not null
      and order_id is not null
      and entitlement_id is not null
    )
  );

alter table public.market_download_events
  drop constraint if exists market_download_events_event_target_type_check;

alter table public.market_download_events
  add constraint market_download_events_event_target_type_check
  check (event_target_type in ('legacy_asset', 'subproduct_file'));

create index if not exists idx_market_download_events_v2_order_created_at
  on public.market_download_events(order_id, created_at desc)
  where event_target_type = 'subproduct_file';

create index if not exists idx_market_download_events_v2_subproduct_file
  on public.market_download_events(subproduct_file_id, created_at desc)
  where event_target_type = 'subproduct_file';

create table if not exists public.market_refund_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_subject text not null check (workspace_subject in ('english', 'korean')),
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid not null references public.market_items(id) on delete cascade,
  target_kind text not null check (target_kind in ('legacy_purchase', 'v2_order')),
  legacy_purchase_id uuid references public.market_purchases(id) on delete cascade,
  order_id uuid references public.market_purchase_orders(id) on delete cascade,
  requested_refund_credits integer not null check (requested_refund_credits > 0),
  approved_refund_credits integer check (approved_refund_credits is null or approved_refund_credits >= 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'canceled', 'failed')),
  reason text,
  admin_note text,
  eligibility_snapshot jsonb not null default '{}'::jsonb,
  processed_by uuid references public.profiles(id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_refund_requests_target_check
    check (
      (target_kind = 'legacy_purchase' and legacy_purchase_id is not null and order_id is null)
      or
      (target_kind = 'v2_order' and order_id is not null and legacy_purchase_id is null)
    )
);

comment on table public.market_refund_requests is '문제마켓 구매 취소/크레딧 반환 환불 요청';
comment on column public.market_refund_requests.eligibility_snapshot is '요청 시점 환불 가능성 판정 및 다운로드 카운트 스냅샷';

create index if not exists idx_market_refund_requests_user_created_at
  on public.market_refund_requests(workspace_subject, user_id, created_at desc);

create index if not exists idx_market_refund_requests_status_created_at
  on public.market_refund_requests(workspace_subject, status, created_at desc);

create unique index if not exists uq_market_refund_requests_pending_order
  on public.market_refund_requests(order_id)
  where target_kind = 'v2_order' and status in ('pending', 'approved');

create unique index if not exists uq_market_refund_requests_pending_legacy
  on public.market_refund_requests(legacy_purchase_id)
  where target_kind = 'legacy_purchase' and status in ('pending', 'approved');

create or replace function public.set_market_refund_requests_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_market_refund_requests_updated_at on public.market_refund_requests;
create trigger trg_market_refund_requests_updated_at
before update on public.market_refund_requests
for each row
execute function public.set_market_refund_requests_updated_at();

alter table public.market_refund_requests enable row level security;

drop policy if exists "Users can read own market refund requests" on public.market_refund_requests;
create policy "Users can read own market refund requests"
  on public.market_refund_requests
  for select
  to authenticated
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users can insert own market refund requests" on public.market_refund_requests;
create policy "Users can insert own market refund requests"
  on public.market_refund_requests
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Admins can manage market refund requests" on public.market_refund_requests;
create policy "Admins can manage market refund requests"
  on public.market_refund_requests
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 다운로드 이벤트는 환불 판정 기준이므로 일반 사용자 직접 insert를 차단하고 서버/service role 경유만 사용한다.
drop policy if exists "Users can insert own market download events" on public.market_download_events;
