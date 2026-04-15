-- ============================================================================
-- Add explicit source_category to credit_sources
-- 생성일: 2026-04-15
-- 설명: credit_sources에 명시적 출처 구분을 저장해 마이페이지 표시가 다른 테이블 추론에 의존하지 않도록 정리
-- ============================================================================

alter table public.credit_sources
add column if not exists source_category text;

comment on column public.credit_sources.source_category is '크레딧 출처 구분 (plan_purchase, admin_grant, system_refund, bonus, legacy_unknown)';

update public.credit_sources
set source_category = case
  when plan_id is not null then 'plan_purchase'
  else 'legacy_unknown'
end
where source_category is null;

update public.credit_sources cs
set source_category = 'admin_grant'
from public.payment_history ph
where ph.source_id = cs.id
  and ph.payment_method = 'admin_grant'
  and (cs.source_category is null or cs.source_category = 'legacy_unknown');

update public.credit_sources cs
set source_category = 'system_refund'
from public.payment_history ph
where ph.source_id = cs.id
  and ph.payment_method = 'system_refund'
  and (cs.source_category is null or cs.source_category = 'legacy_unknown');

update public.credit_sources cs
set source_category = 'bonus'
from public.credit_transactions ct
where ct.source_id = cs.id
  and ct.type = 'bonus'
  and (cs.source_category is null or cs.source_category = 'legacy_unknown');

alter table public.credit_sources
alter column source_category set default 'plan_purchase';

update public.credit_sources
set source_category = 'legacy_unknown'
where source_category is null;

alter table public.credit_sources
alter column source_category set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'credit_sources_source_category_check'
  ) then
    alter table public.credit_sources
      add constraint credit_sources_source_category_check
      check (
        source_category in (
          'plan_purchase',
          'admin_grant',
          'system_refund',
          'bonus',
          'legacy_unknown'
        )
      );
  end if;
end
$$;
