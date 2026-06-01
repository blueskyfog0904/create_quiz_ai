create table if not exists public.ai_question_generation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  workspace_subject text not null default 'english',
  source text not null check (source in ('single', 'multi', 'textbook', 'listboard_run', 'listboard_retry')),
  problem_type_id uuid references public.problem_types(id) on delete set null,
  problem_type_name text,
  question_id uuid references public.questions(id) on delete set null,
  listboard_job_id uuid references public.generate_listboard_generation_jobs(id) on delete set null,
  listboard_job_item_id uuid references public.generate_listboard_generation_job_items(id) on delete set null,
  status text not null,
  stop_reason text,
  input jsonb not null default '{}'::jsonb,
  model_config jsonb not null default '{}'::jsonb,
  final_question jsonb,
  last_question jsonb,
  final_review jsonb,
  attempts jsonb not null default '[]'::jsonb,
  redaction_flags jsonb not null default '{}'::jsonb,
  truncated_flags jsonb not null default '{}'::jsonb,
  credit_charged integer not null default 0 check (credit_charged >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists ai_question_generation_runs_subject_created_idx
  on public.ai_question_generation_runs (workspace_subject, created_at desc);

create index if not exists ai_question_generation_runs_user_created_idx
  on public.ai_question_generation_runs (user_id, created_at desc);

create index if not exists ai_question_generation_runs_problem_type_created_idx
  on public.ai_question_generation_runs (problem_type_id, created_at desc);

create index if not exists ai_question_generation_runs_status_created_idx
  on public.ai_question_generation_runs (status, created_at desc);

create index if not exists ai_question_generation_runs_source_created_idx
  on public.ai_question_generation_runs (source, created_at desc);

create index if not exists ai_question_generation_runs_job_idx
  on public.ai_question_generation_runs (listboard_job_id);

create index if not exists ai_question_generation_runs_job_item_idx
  on public.ai_question_generation_runs (listboard_job_item_id);

create index if not exists ai_question_generation_runs_question_idx
  on public.ai_question_generation_runs (question_id);

create index if not exists ai_question_generation_runs_expires_idx
  on public.ai_question_generation_runs (expires_at);

alter table public.ai_question_generation_runs enable row level security;

drop policy if exists "Admins can manage AI question generation runs" on public.ai_question_generation_runs;
create policy "Admins can manage AI question generation runs"
  on public.ai_question_generation_runs
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

comment on table public.ai_question_generation_runs is 'Admin-only sanitized logs for user-facing AI question generation runs';
comment on column public.ai_question_generation_runs.attempts is 'Sanitized generation, review, feedback, and regeneration trace events. Original unredacted raw provider responses are not stored separately.';
comment on column public.ai_question_generation_runs.redaction_flags is 'Flags indicating which sensitive patterns were redacted from the stored trace.';
comment on column public.ai_question_generation_runs.truncated_flags is 'Flags indicating which trace fields were truncated before storage.';
comment on column public.ai_question_generation_runs.expires_at is 'Recommended cleanup deadline for detailed trace retention; default policy is 30 days.';
