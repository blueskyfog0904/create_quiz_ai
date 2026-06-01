alter table public.ai_question_generation_runs
  drop constraint if exists ai_question_generation_runs_source_check;

alter table public.ai_question_generation_runs
  add constraint ai_question_generation_runs_source_check
  check (source in ('single', 'multi', 'textbook', 'listboard_run', 'listboard_retry'));

create or replace function public.prune_expired_ai_question_generation_runs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_count integer;
begin
  update public.ai_question_generation_runs
  set
    input = '{}'::jsonb,
    model_config = '{}'::jsonb,
    final_question = null,
    last_question = null,
    final_review = null,
    attempts = '[]'::jsonb,
    truncated_flags = coalesce(truncated_flags, '{}'::jsonb) || '{"expired": true}'::jsonb
  where expires_at is not null
    and expires_at < now()
    and (
      input <> '{}'::jsonb
      or model_config <> '{}'::jsonb
      or final_question is not null
      or last_question is not null
      or final_review is not null
      or attempts <> '[]'::jsonb
    );

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

comment on function public.prune_expired_ai_question_generation_runs() is 'Clears detailed AI question generation trace payloads after expires_at while retaining summary audit metadata.';

revoke all on function public.prune_expired_ai_question_generation_runs() from anon, authenticated;
revoke all on function public.prune_expired_ai_question_generation_runs() from public;
