create table if not exists public.problem_type_test_runs (
  id uuid primary key default gen_random_uuid(),
  problem_type_id uuid not null references public.problem_types(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_subject text not null default 'english',
  status text not null,
  stop_reason text,
  input jsonb not null default '{}'::jsonb,
  model_config jsonb not null default '{}'::jsonb,
  final_question jsonb,
  last_question jsonb,
  final_review jsonb,
  attempts jsonb not null default '[]'::jsonb,
  raw_generation_response text,
  raw_review_response text,
  created_at timestamptz not null default now()
);

create index if not exists problem_type_test_runs_problem_type_created_idx
  on public.problem_type_test_runs (problem_type_id, created_at desc);

create index if not exists problem_type_test_runs_subject_created_idx
  on public.problem_type_test_runs (workspace_subject, created_at desc);

alter table public.problem_type_test_runs enable row level security;

drop policy if exists "Admins can manage problem type test runs" on public.problem_type_test_runs;
create policy "Admins can manage problem type test runs"
  on public.problem_type_test_runs
  for all
  using (public.is_admin())
  with check (public.is_admin());

comment on table public.problem_type_test_runs is 'Admin AI problem type generation test run logs';
comment on column public.problem_type_test_runs.attempts is 'Full generation, review, feedback, and regeneration trace logs for the test run';
