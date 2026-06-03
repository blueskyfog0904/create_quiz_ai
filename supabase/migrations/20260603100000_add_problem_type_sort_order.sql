alter table public.problem_types
  add column if not exists sort_order integer not null default 0;

alter table public.problem_types
  drop constraint if exists problem_types_sort_order_non_negative;

alter table public.problem_types
  add constraint problem_types_sort_order_non_negative
  check (sort_order >= 0);

create index if not exists idx_problem_types_workspace_sort_order
  on public.problem_types(workspace_subject, sort_order, created_at desc, id);
