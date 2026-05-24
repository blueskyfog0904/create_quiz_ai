-- Enforce the dedicated question-bank problem type after the backfill and RPC
-- transition have completed.

do $$
begin
  if exists (
    select 1
    from public.question_bank_question_metadata m
    where m.bank_problem_type_id is null
  ) then
    raise exception 'BANK_PROBLEM_TYPE_BACKFILL_REQUIRED';
  end if;
end $$;

alter table public.question_bank_question_metadata
  alter column bank_problem_type_id set not null;

create index if not exists idx_qb_metadata_bank_type_workspace
  on public.question_bank_question_metadata (bank_problem_type_id, workspace_subject);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'question_bank_metadata_bank_type_workspace_fkey'
      and conrelid = 'public.question_bank_question_metadata'::regclass
  ) then
    alter table public.question_bank_question_metadata
      add constraint question_bank_metadata_bank_type_workspace_fkey
      foreign key (bank_problem_type_id, workspace_subject)
      references public.question_bank_problem_types(id, workspace_subject)
      on delete restrict;
  end if;
end $$;

update public.questions q
set
  problem_type_id = null,
  updated_at = timezone('utc'::text, now())
from public.question_bank_question_metadata m
where m.question_id = q.id
  and q.source in ('admin_uploaded', 'from_community')
  and q.problem_type_id is not null;
