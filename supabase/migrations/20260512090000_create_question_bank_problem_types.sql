-- Create a dedicated problem-type dimension for question-bank classification.
-- Existing public.problem_types remains the AI-generation configuration table.

create table if not exists public.question_bank_problem_types (
  id uuid default uuid_generate_v4() primary key,
  workspace_subject text not null check (workspace_subject in ('english', 'korean')),
  type_name text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint question_bank_problem_types_workspace_type_name_key unique (workspace_subject, type_name),
  constraint question_bank_problem_types_id_workspace_subject_key unique (id, workspace_subject)
);

alter table public.question_bank_question_metadata
  add column if not exists bank_problem_type_id uuid;

create index if not exists idx_question_bank_problem_types_workspace_active
  on public.question_bank_problem_types(workspace_subject, is_active, sort_order, type_name);

create index if not exists idx_qb_metadata_scope_type_lookup
  on public.question_bank_question_metadata(workspace_subject, year_id, book_id, bank_problem_type_id, question_id);

alter table public.question_bank_problem_types enable row level security;

drop policy if exists "Authenticated users can view active question bank problem types" on public.question_bank_problem_types;
create policy "Authenticated users can view active question bank problem types"
  on public.question_bank_problem_types
  for select to authenticated
  using (is_active = true);

drop policy if exists "Admins can manage question bank problem types" on public.question_bank_problem_types;
create policy "Admins can manage question bank problem types"
  on public.question_bank_problem_types
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

with legacy_bank_types as (
  select
    q.workspace_subject,
    pt.type_name,
    max(pt.description) as description
  from public.questions q
  join public.question_bank_question_metadata m on m.question_id = q.id
  join public.problem_types pt on pt.id = q.problem_type_id
  where q.source in ('admin_uploaded', 'from_community')
    and q.workspace_subject in ('english', 'korean')
    and q.problem_type_id is not null
    and nullif(btrim(pt.type_name), '') is not null
  group by q.workspace_subject, pt.type_name
)
insert into public.question_bank_problem_types(
  workspace_subject,
  type_name,
  description,
  sort_order,
  is_active
)
select
  workspace_subject,
  type_name,
  description,
  row_number() over (partition by workspace_subject order by type_name)::integer,
  true
from legacy_bank_types
on conflict (workspace_subject, type_name) do update
set
  description = coalesce(excluded.description, public.question_bank_problem_types.description),
  is_active = true,
  updated_at = timezone('utc'::text, now());

update public.question_bank_question_metadata m
set
  bank_problem_type_id = qbpt.id,
  updated_at = timezone('utc'::text, now())
from public.questions q
join public.problem_types pt on pt.id = q.problem_type_id
join public.question_bank_problem_types qbpt
  on qbpt.workspace_subject = q.workspace_subject
 and qbpt.type_name = pt.type_name
where m.question_id = q.id
  and q.source in ('admin_uploaded', 'from_community')
  and q.problem_type_id is not null
  and m.bank_problem_type_id is null;
