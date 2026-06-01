alter table public.ai_models
drop constraint if exists ai_models_provider_check;

alter table public.ai_models
add constraint ai_models_provider_check
check (provider in ('openai', 'gemini', 'claude'));

alter table public.problem_types
drop constraint if exists problem_types_provider_check;

alter table public.problem_types
add constraint problem_types_provider_check
check (provider in ('openai', 'gemini', 'claude', 'admin'));

alter table public.problem_types
add column if not exists generation_provider text,
add column if not exists generation_model_name text,
add column if not exists review_provider text,
add column if not exists review_model_name text;

update public.problem_types
set generation_provider = coalesce(generation_provider, provider),
    generation_model_name = coalesce(generation_model_name, model_name)
where provider in ('openai', 'gemini', 'claude');

alter table public.problem_types
drop constraint if exists problem_types_generation_provider_check;

alter table public.problem_types
add constraint problem_types_generation_provider_check
check (generation_provider is null or generation_provider in ('openai', 'gemini', 'claude'));

alter table public.problem_types
drop constraint if exists problem_types_review_provider_check;

alter table public.problem_types
add constraint problem_types_review_provider_check
check (review_provider is null or review_provider in ('openai', 'gemini', 'claude'));

comment on column public.problem_types.generation_provider is 'AI provider used by the question generation API';
comment on column public.problem_types.generation_model_name is 'AI model used by the question generation API';
comment on column public.problem_types.review_provider is 'AI provider used by the question review API';
comment on column public.problem_types.review_model_name is 'AI model used by the question review API';

insert into public.providers (name, display_name, display_order, is_active)
values ('claude', 'Claude', 3, true)
on conflict (name) do update
set display_name = excluded.display_name,
    is_active = true,
    updated_at = now();

create table if not exists public.ai_provider_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique check (provider in ('openai', 'gemini', 'claude')),
  display_name text not null,
  is_enabled boolean not null default false,
  encrypted_api_key text,
  api_key_last4 text,
  base_url text,
  organization_id text,
  project_id text,
  anthropic_version text,
  last_tested_at timestamptz,
  last_test_status text check (last_test_status is null or last_test_status in ('success', 'failed')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_provider_connections enable row level security;

drop policy if exists "Admins can view AI provider connections" on public.ai_provider_connections;
create policy "Admins can view AI provider connections"
  on public.ai_provider_connections
  for select
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.is_admin = true
    )
  );

drop policy if exists "Admins can manage AI provider connections" on public.ai_provider_connections;
create policy "Admins can manage AI provider connections"
  on public.ai_provider_connections
  for all
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.is_admin = true
    )
  )
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.is_admin = true
    )
  );

insert into public.ai_provider_connections (provider, display_name, is_enabled, base_url, anthropic_version)
values
  ('openai', 'OpenAI', false, 'https://api.openai.com/v1', null),
  ('gemini', 'Gemini', false, 'https://generativelanguage.googleapis.com/v1beta', null),
  ('claude', 'Claude', false, 'https://api.anthropic.com', '2023-06-01')
on conflict (provider) do nothing;
