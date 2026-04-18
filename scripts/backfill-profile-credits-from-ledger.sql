-- Idempotent backfill: align profile cache (`profiles.credits`) to ledger balance.
-- Transitional policy:
--   ledger_balance   = active + pending_refund
--   spendable_balance = active only

with source_balance as (
  select
    user_id,
    sum(case
      when status in ('active', 'pending_refund') then remaining_credits
      else 0
    end) as ledger_balance
  from credit_sources
  group by user_id
)
update profiles p
set credits = source_balance.ledger_balance
from source_balance
where p.id = source_balance.user_id
  and p.credits is distinct from source_balance.ledger_balance;
