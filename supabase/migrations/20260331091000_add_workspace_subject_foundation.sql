-- Foundation step for bilingual workspaces.
-- Adds explicit workspace subject columns with a temporary English default so the
-- current English-only production behavior remains safe during compatibility.

alter table public.problem_types
  add column if not exists workspace_subject text not null default 'english'
  check (workspace_subject in ('english', 'korean'));

alter table public.passages
  add column if not exists workspace_subject text not null default 'english'
  check (workspace_subject in ('english', 'korean'));

alter table public.questions
  add column if not exists workspace_subject text not null default 'english'
  check (workspace_subject in ('english', 'korean'));

alter table public.exam_papers
  add column if not exists workspace_subject text not null default 'english'
  check (workspace_subject in ('english', 'korean'));

alter table public.exam_paper_items
  add column if not exists workspace_subject text not null default 'english'
  check (workspace_subject in ('english', 'korean'));

alter table public.display_labels
  add column if not exists workspace_subject text not null default 'english'
  check (workspace_subject in ('english', 'korean'));

alter table public.source_configs
  add column if not exists workspace_subject text not null default 'english'
  check (workspace_subject in ('english', 'korean'));

alter table public.generate_menu_entries
  add column if not exists workspace_subject text not null default 'english'
  check (workspace_subject in ('english', 'korean'));

alter table public.generate_listboard_posts
  add column if not exists workspace_subject text not null default 'english'
  check (workspace_subject in ('english', 'korean'));

alter table public.generate_listboard_post_items
  add column if not exists workspace_subject text not null default 'english'
  check (workspace_subject in ('english', 'korean'));

alter table public.generate_listboard_generation_jobs
  add column if not exists workspace_subject text not null default 'english'
  check (workspace_subject in ('english', 'korean'));

alter table public.generate_listboard_generation_job_items
  add column if not exists workspace_subject text not null default 'english'
  check (workspace_subject in ('english', 'korean'));

alter table public.market_menu_entries
  add column if not exists workspace_subject text not null default 'english'
  check (workspace_subject in ('english', 'korean'));

alter table public.market_items
  add column if not exists workspace_subject text not null default 'english'
  check (workspace_subject in ('english', 'korean'));

alter table public.market_item_files
  add column if not exists workspace_subject text not null default 'english'
  check (workspace_subject in ('english', 'korean'));

alter table public.market_purchases
  add column if not exists workspace_subject text not null default 'english'
  check (workspace_subject in ('english', 'korean'));

alter table public.market_download_events
  add column if not exists workspace_subject text not null default 'english'
  check (workspace_subject in ('english', 'korean'));

alter table public.market_item_view_events
  add column if not exists workspace_subject text not null default 'english'
  check (workspace_subject in ('english', 'korean'));

comment on column public.problem_types.workspace_subject is 'Public workspace subject scope; temporary default english during compatibility.';
comment on column public.passages.workspace_subject is 'Public workspace subject scope; temporary default english during compatibility.';
comment on column public.questions.workspace_subject is 'Public workspace subject scope; temporary default english during compatibility.';
comment on column public.exam_papers.workspace_subject is 'Public workspace subject scope; temporary default english during compatibility.';
comment on column public.exam_paper_items.workspace_subject is 'Public workspace subject scope; temporary default english during compatibility.';
comment on column public.display_labels.workspace_subject is 'Public workspace subject scope for user-facing/admin-authored labels.';
comment on column public.source_configs.workspace_subject is 'Public workspace subject scope for source config rows.';
comment on column public.generate_menu_entries.workspace_subject is 'Public workspace subject scope for generate menu rows.';
comment on column public.generate_listboard_posts.workspace_subject is 'Public workspace subject scope for generate listboard posts.';
comment on column public.generate_listboard_post_items.workspace_subject is 'Public workspace subject scope for generate listboard post items.';
comment on column public.generate_listboard_generation_jobs.workspace_subject is 'Public workspace subject scope for batch generation jobs.';
comment on column public.generate_listboard_generation_job_items.workspace_subject is 'Public workspace subject scope for batch generation job items.';
comment on column public.market_menu_entries.workspace_subject is 'Public workspace subject scope for market menu rows.';
comment on column public.market_items.workspace_subject is 'Public workspace subject scope for market items.';
comment on column public.market_item_files.workspace_subject is 'Public workspace subject scope for market file rows.';
comment on column public.market_purchases.workspace_subject is 'Public workspace subject scope for market purchase rows.';
comment on column public.market_download_events.workspace_subject is 'Public workspace subject scope for market download events.';
comment on column public.market_item_view_events.workspace_subject is 'Public workspace subject scope for market item view events.';

create index if not exists idx_problem_types_workspace_subject
  on public.problem_types(workspace_subject, is_active);

create index if not exists idx_passages_workspace_subject_user
  on public.passages(workspace_subject, user_id, created_at desc);

create index if not exists idx_questions_workspace_subject_user
  on public.questions(workspace_subject, user_id, created_at desc);

create index if not exists idx_exam_papers_workspace_subject_user
  on public.exam_papers(workspace_subject, user_id, created_at desc);

create index if not exists idx_exam_paper_items_workspace_subject
  on public.exam_paper_items(workspace_subject, exam_paper_id, question_id);

create unique index if not exists uq_display_labels_workspace_category_value
  on public.display_labels(workspace_subject, category, db_value);

create unique index if not exists uq_source_configs_workspace_type_name
  on public.source_configs(workspace_subject, type_name);

create unique index if not exists uq_generate_menu_entries_workspace_entry_key
  on public.generate_menu_entries(workspace_subject, entry_key);

create unique index if not exists uq_generate_menu_entries_workspace_slug
  on public.generate_menu_entries(workspace_subject, slug);

create index if not exists idx_generate_listboard_posts_workspace_menu_status
  on public.generate_listboard_posts(workspace_subject, menu_entry_id, status);

create index if not exists idx_generate_listboard_post_items_workspace_post
  on public.generate_listboard_post_items(workspace_subject, post_id, sort_order);

create index if not exists idx_generate_listboard_generation_jobs_workspace_post_user
  on public.generate_listboard_generation_jobs(workspace_subject, post_id, user_id, status);

create index if not exists idx_generate_listboard_generation_job_items_workspace_job
  on public.generate_listboard_generation_job_items(workspace_subject, job_id, status);

create unique index if not exists uq_market_menu_entries_workspace_entry_key
  on public.market_menu_entries(workspace_subject, entry_key);

create unique index if not exists uq_market_menu_entries_workspace_slug
  on public.market_menu_entries(workspace_subject, slug);

create index if not exists idx_market_items_workspace_menu_status
  on public.market_items(workspace_subject, menu_entry_id, status, is_active, deleted_at);

create index if not exists idx_market_item_files_workspace_item_kind
  on public.market_item_files(workspace_subject, item_id, asset_kind, is_active, deleted_at);

create index if not exists idx_market_purchases_workspace_user_created_at
  on public.market_purchases(workspace_subject, user_id, created_at desc);

create index if not exists idx_market_download_events_workspace_item_created_at
  on public.market_download_events(workspace_subject, item_id, created_at desc);

create index if not exists idx_market_item_view_events_workspace_item_created_at
  on public.market_item_view_events(workspace_subject, item_id, created_at desc);
