-- Backfill missing credit_transactions rows and recompute running balances
-- Covers two detected patterns:
-- 1) credit_sources with no matching purchase tx (e.g. historical admin grants)
-- 2) refunded credit_sources with no matching refund tx

-- Step 1. insert missing rows
with missing_purchase_tx as (
  select
    s.user_id,
    s.id as source_id,
    'purchase'::text as type,
    s.initial_credits as amount,
    0::integer as balance_after,
    concat('크레딧 ', to_char(s.initial_credits, 'FM999,999,999'), '개 구매') as description,
    coalesce(ph.created_at, s.purchased_at) as created_at
  from credit_sources s
  left join credit_transactions purchase_tx
    on purchase_tx.source_id = s.id
   and purchase_tx.type = 'purchase'
  left join payment_history ph
    on ph.source_id = s.id
  where purchase_tx.id is null
    and s.status in ('active', 'pending_refund', 'refunded')
),
missing_refund_tx as (
  select
    s.user_id,
    s.id as source_id,
    'refund'::text as type,
    -s.initial_credits as amount,
    0::integer as balance_after,
    concat('환불 승인 (', to_char(s.initial_credits, 'FM999,999,999'), ' 크레딧)') as description,
    coalesce(rr.processed_at, s.purchased_at) as created_at
  from credit_sources s
  left join credit_transactions refund_tx
    on refund_tx.source_id = s.id
   and refund_tx.type = 'refund'
  left join refund_requests rr
    on rr.source_id = s.id
   and rr.status = 'approved'
  where s.status = 'refunded'
    and refund_tx.id is null
)
insert into credit_transactions (user_id, type, amount, balance_after, description, source_id, created_at)
select user_id, type, amount, balance_after, description, source_id, created_at
from (
  select * from missing_purchase_tx
  union all
  select * from missing_refund_tx
) rows_to_insert
where created_at is not null;

-- Step 2. recompute balance_after across all rows (idempotent)
with recomputed as (
  select
    ct.id,
    sum(ct.amount) over (
      partition by ct.user_id
      order by ct.created_at asc, ct.id asc
      rows between unbounded preceding and current row
    ) as recomputed_balance
  from credit_transactions ct
)
update credit_transactions target
set balance_after = recomputed.recomputed_balance
from recomputed
where target.id = recomputed.id
  and target.balance_after is distinct from recomputed.recomputed_balance;
