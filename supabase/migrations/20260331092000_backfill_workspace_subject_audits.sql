-- English compatibility backfill and audit helpers for bilingual workspace rollout.
-- This migration keeps current production behavior English-scoped while exposing
-- simple audit surfaces for later cutover verification.

update public.problem_types
set workspace_subject = 'english'
where workspace_subject is distinct from 'english';

update public.passages
set workspace_subject = 'english'
where workspace_subject is distinct from 'english';

update public.questions
set workspace_subject = coalesce(
  (
    select posts.workspace_subject
    from public.generate_listboard_posts posts
    where posts.id = public.questions.generate_listboard_post_id
  ),
  (
    select passages.workspace_subject
    from public.passages passages
    where passages.id = public.questions.passage_id
  ),
  'english'
)
where workspace_subject is distinct from coalesce(
  (
    select posts.workspace_subject
    from public.generate_listboard_posts posts
    where posts.id = public.questions.generate_listboard_post_id
  ),
  (
    select passages.workspace_subject
    from public.passages passages
    where passages.id = public.questions.passage_id
  ),
  'english'
);

update public.exam_papers
set workspace_subject = 'english'
where workspace_subject is distinct from 'english';

update public.exam_paper_items items
set workspace_subject = coalesce(
  (
    select papers.workspace_subject
    from public.exam_papers papers
    where papers.id = items.exam_paper_id
  ),
  (
    select questions.workspace_subject
    from public.questions questions
    where questions.id = items.question_id
  ),
  'english'
)
where items.workspace_subject is distinct from coalesce(
  (
    select papers.workspace_subject
    from public.exam_papers papers
    where papers.id = items.exam_paper_id
  ),
  (
    select questions.workspace_subject
    from public.questions questions
    where questions.id = items.question_id
  ),
  'english'
);

update public.display_labels
set workspace_subject = 'english'
where workspace_subject is distinct from 'english';

update public.source_configs
set workspace_subject = 'english'
where workspace_subject is distinct from 'english';

update public.generate_menu_entries
set workspace_subject = 'english'
where workspace_subject is distinct from 'english';

update public.generate_listboard_posts posts
set workspace_subject = coalesce(
  (
    select entries.workspace_subject
    from public.generate_menu_entries entries
    where entries.id = posts.menu_entry_id
  ),
  'english'
)
where posts.workspace_subject is distinct from coalesce(
  (
    select entries.workspace_subject
    from public.generate_menu_entries entries
    where entries.id = posts.menu_entry_id
  ),
  'english'
);

update public.generate_listboard_post_items items
set workspace_subject = coalesce(
  (
    select posts.workspace_subject
    from public.generate_listboard_posts posts
    where posts.id = items.post_id
  ),
  'english'
)
where items.workspace_subject is distinct from coalesce(
  (
    select posts.workspace_subject
    from public.generate_listboard_posts posts
    where posts.id = items.post_id
  ),
  'english'
);

update public.generate_listboard_generation_jobs jobs
set workspace_subject = coalesce(
  (
    select posts.workspace_subject
    from public.generate_listboard_posts posts
    where posts.id = jobs.post_id
  ),
  'english'
)
where jobs.workspace_subject is distinct from coalesce(
  (
    select posts.workspace_subject
    from public.generate_listboard_posts posts
    where posts.id = jobs.post_id
  ),
  'english'
);

update public.generate_listboard_generation_job_items items
set workspace_subject = coalesce(
  (
    select jobs.workspace_subject
    from public.generate_listboard_generation_jobs jobs
    where jobs.id = items.job_id
  ),
  (
    select posts.workspace_subject
    from public.generate_listboard_posts posts
    where posts.id = items.post_id
  ),
  'english'
)
where items.workspace_subject is distinct from coalesce(
  (
    select jobs.workspace_subject
    from public.generate_listboard_generation_jobs jobs
    where jobs.id = items.job_id
  ),
  (
    select posts.workspace_subject
    from public.generate_listboard_posts posts
    where posts.id = items.post_id
  ),
  'english'
);

update public.market_menu_entries
set workspace_subject = 'english'
where workspace_subject is distinct from 'english';

update public.market_items items
set workspace_subject = coalesce(
  (
    select entries.workspace_subject
    from public.market_menu_entries entries
    where entries.id = items.menu_entry_id
  ),
  'english'
)
where items.workspace_subject is distinct from coalesce(
  (
    select entries.workspace_subject
    from public.market_menu_entries entries
    where entries.id = items.menu_entry_id
  ),
  'english'
);

update public.market_item_files files
set workspace_subject = coalesce(
  (
    select items.workspace_subject
    from public.market_items items
    where items.id = files.item_id
  ),
  'english'
)
where files.workspace_subject is distinct from coalesce(
  (
    select items.workspace_subject
    from public.market_items items
    where items.id = files.item_id
  ),
  'english'
);

update public.market_purchases purchases
set workspace_subject = coalesce(
  (
    select items.workspace_subject
    from public.market_items items
    where items.id = purchases.item_id
  ),
  'english'
)
where purchases.workspace_subject is distinct from coalesce(
  (
    select items.workspace_subject
    from public.market_items items
    where items.id = purchases.item_id
  ),
  'english'
);

update public.market_download_events events
set workspace_subject = coalesce(
  (
    select purchases.workspace_subject
    from public.market_purchases purchases
    where purchases.id = events.purchase_id
  ),
  (
    select items.workspace_subject
    from public.market_items items
    where items.id = events.item_id
  ),
  'english'
)
where events.workspace_subject is distinct from coalesce(
  (
    select purchases.workspace_subject
    from public.market_purchases purchases
    where purchases.id = events.purchase_id
  ),
  (
    select items.workspace_subject
    from public.market_items items
    where items.id = events.item_id
  ),
  'english'
);

update public.market_item_view_events events
set workspace_subject = coalesce(
  (
    select items.workspace_subject
    from public.market_items items
    where items.id = events.item_id
  ),
  'english'
)
where events.workspace_subject is distinct from coalesce(
  (
    select items.workspace_subject
    from public.market_items items
    where items.id = events.item_id
  ),
  'english'
);

create or replace view public.workspace_subject_backfill_audit as
select 'problem_types'::text as table_name, count(*)::bigint as non_english_count
from public.problem_types
where workspace_subject <> 'english'
union all
select 'passages', count(*)::bigint
from public.passages
where workspace_subject <> 'english'
union all
select 'questions', count(*)::bigint
from public.questions
where workspace_subject <> 'english'
union all
select 'exam_papers', count(*)::bigint
from public.exam_papers
where workspace_subject <> 'english'
union all
select 'exam_paper_items', count(*)::bigint
from public.exam_paper_items
where workspace_subject <> 'english'
union all
select 'display_labels', count(*)::bigint
from public.display_labels
where workspace_subject <> 'english'
union all
select 'source_configs', count(*)::bigint
from public.source_configs
where workspace_subject <> 'english'
union all
select 'generate_menu_entries', count(*)::bigint
from public.generate_menu_entries
where workspace_subject <> 'english'
union all
select 'generate_listboard_posts', count(*)::bigint
from public.generate_listboard_posts
where workspace_subject <> 'english'
union all
select 'generate_listboard_post_items', count(*)::bigint
from public.generate_listboard_post_items
where workspace_subject <> 'english'
union all
select 'generate_listboard_generation_jobs', count(*)::bigint
from public.generate_listboard_generation_jobs
where workspace_subject <> 'english'
union all
select 'generate_listboard_generation_job_items', count(*)::bigint
from public.generate_listboard_generation_job_items
where workspace_subject <> 'english'
union all
select 'market_menu_entries', count(*)::bigint
from public.market_menu_entries
where workspace_subject <> 'english'
union all
select 'market_items', count(*)::bigint
from public.market_items
where workspace_subject <> 'english'
union all
select 'market_item_files', count(*)::bigint
from public.market_item_files
where workspace_subject <> 'english'
union all
select 'market_purchases', count(*)::bigint
from public.market_purchases
where workspace_subject <> 'english'
union all
select 'market_download_events', count(*)::bigint
from public.market_download_events
where workspace_subject <> 'english'
union all
select 'market_item_view_events', count(*)::bigint
from public.market_item_view_events
where workspace_subject <> 'english';

comment on view public.workspace_subject_backfill_audit is 'Compatibility audit view: counts rows that are not yet English-scoped during the initial backfill stage.';
