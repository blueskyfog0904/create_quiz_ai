-- profiles.credits vs ledger/spendable balance
with source_balance as (
  select
    user_id,
    sum(case
      when status in ('active', 'pending_refund') then remaining_credits
      else 0
    end) as ledger_balance,
    sum(case
      when status = 'active' then remaining_credits
      else 0
    end) as spendable_balance
  from credit_sources
  group by user_id
),
latest_tx as (
  select distinct on (user_id)
    user_id,
    balance_after,
    created_at
  from credit_transactions
  order by user_id, created_at desc, id desc
)
select
  p.id as user_id,
  p.credits as profile_balance,
  coalesce(sb.ledger_balance, 0) as ledger_balance,
  coalesce(sb.spendable_balance, 0) as spendable_balance,
  lt.balance_after as latest_tx_balance,
  p.credits - coalesce(sb.ledger_balance, 0) as diff_profile_vs_ledger,
  p.credits - coalesce(sb.spendable_balance, 0) as diff_profile_vs_spendable,
  p.credits - coalesce(lt.balance_after, 0) as diff_profile_vs_latest_tx
from profiles p
left join source_balance sb on sb.user_id = p.id
left join latest_tx lt on lt.user_id = p.id
where p.credits <> coalesce(sb.ledger_balance, 0)
   or p.credits <> coalesce(sb.spendable_balance, 0)
   or (lt.balance_after is not null and p.credits <> lt.balance_after)
order by abs(p.credits - coalesce(sb.ledger_balance, 0)) desc;

-- credit_sources integrity check
select
  id,
  user_id,
  status,
  initial_credits,
  remaining_credits,
  (initial_credits - remaining_credits) as consumed,
  purchased_at
from credit_sources
where remaining_credits < 0
   or remaining_credits > initial_credits
   or initial_credits <= 0
order by purchased_at desc;
