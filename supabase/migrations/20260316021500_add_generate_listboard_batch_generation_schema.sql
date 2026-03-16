create table if not exists public.generate_listboard_post_items (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.generate_listboard_posts(id) on delete cascade,
  question_number text not null,
  passage_text text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.generate_listboard_post_items is '리스트보드 게시글 하위 CSV 문항 행';
comment on column public.generate_listboard_post_items.question_number is 'CSV 첫 열 문항 번호';
comment on column public.generate_listboard_post_items.passage_text is 'CSV 둘째 열 영어 지문 원문';

create table if not exists public.generate_listboard_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.generate_listboard_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'partially_completed', 'failed', 'cancelled')),
  selected_problem_type_ids uuid[] not null default '{}'::uuid[],
  requested_item_count integer not null default 0 check (requested_item_count >= 0),
  requested_type_count integer not null default 0 check (requested_type_count >= 0),
  requested_generation_count integer not null default 0 check (requested_generation_count >= 0),
  completed_count integer not null default 0 check (completed_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  cancelled_count integer not null default 0 check (cancelled_count >= 0),
  credit_reserved integer not null default 0 check (credit_reserved >= 0),
  credit_charged integer not null default 0 check (credit_charged >= 0),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.generate_listboard_generation_jobs is '리스트보드 게시글 상세에서 생성된 배치 문제 생성 요청';
comment on column public.generate_listboard_generation_jobs.selected_problem_type_ids is '사용자가 선택한 문제 유형 id 목록';

create table if not exists public.generate_listboard_generation_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.generate_listboard_generation_jobs(id) on delete cascade,
  post_id uuid not null references public.generate_listboard_posts(id) on delete cascade,
  post_item_id uuid not null references public.generate_listboard_post_items(id) on delete cascade,
  problem_type_id uuid not null references public.problem_types(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  question_id uuid references public.questions(id) on delete set null,
  error_code text,
  error_message text,
  credit_charged integer not null default 0 check (credit_charged >= 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.generate_listboard_generation_job_items is '배치 문제 생성 요청의 실제 문항 x 문제유형 작업 단위';
comment on column public.generate_listboard_generation_job_items.question_id is '생성 성공 시 questions.id';

create unique index if not exists uq_generate_listboard_post_items_post_question_number_active
  on public.generate_listboard_post_items(post_id, question_number)
  where deleted_at is null;

create index if not exists idx_generate_listboard_post_items_post_sort
  on public.generate_listboard_post_items(post_id, sort_order);

create index if not exists idx_generate_listboard_post_items_post_visibility
  on public.generate_listboard_post_items(post_id, is_active, deleted_at);

create index if not exists idx_generate_listboard_generation_jobs_post_user_status
  on public.generate_listboard_generation_jobs(post_id, user_id, status);

create index if not exists idx_generate_listboard_generation_jobs_created_at
  on public.generate_listboard_generation_jobs(created_at desc);

create unique index if not exists uq_generate_listboard_generation_job_items_triplet
  on public.generate_listboard_generation_job_items(job_id, post_item_id, problem_type_id);

create index if not exists idx_generate_listboard_generation_job_items_job_status
  on public.generate_listboard_generation_job_items(job_id, status);

create index if not exists idx_generate_listboard_generation_job_items_post_item_problem_type
  on public.generate_listboard_generation_job_items(post_item_id, problem_type_id);

create index if not exists idx_generate_listboard_generation_job_items_question
  on public.generate_listboard_generation_job_items(question_id);

alter table public.questions
  add column if not exists generate_listboard_post_id uuid references public.generate_listboard_posts(id) on delete set null,
  add column if not exists generate_listboard_post_item_id uuid references public.generate_listboard_post_items(id) on delete set null,
  add column if not exists generate_generation_job_item_id uuid references public.generate_listboard_generation_job_items(id) on delete set null;

comment on column public.questions.generate_listboard_post_id is '원본 리스트보드 게시글 id';
comment on column public.questions.generate_listboard_post_item_id is '원본 리스트보드 게시글 문항 행 id';
comment on column public.questions.generate_generation_job_item_id is '해당 문제를 만든 배치 생성 job item id';

create index if not exists idx_questions_generate_listboard_post_id
  on public.questions(generate_listboard_post_id);

create index if not exists idx_questions_generate_listboard_post_item_id
  on public.questions(generate_listboard_post_item_id);

create index if not exists idx_questions_generate_generation_job_item_id
  on public.questions(generate_generation_job_item_id);

create or replace function public.set_generate_listboard_post_items_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_generate_listboard_generation_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_generate_listboard_generation_job_items_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.validate_generate_listboard_generation_job_item()
returns trigger
language plpgsql
as $$
declare
  v_job_post_id uuid;
  v_post_item_post_id uuid;
begin
  select post_id
    into v_job_post_id
  from public.generate_listboard_generation_jobs
  where id = new.job_id;

  if v_job_post_id is null then
    raise exception 'Invalid generate listboard generation job: %', new.job_id;
  end if;

  select post_id
    into v_post_item_post_id
  from public.generate_listboard_post_items
  where id = new.post_item_id
    and deleted_at is null;

  if v_post_item_post_id is null then
    raise exception 'Invalid generate listboard post item: %', new.post_item_id;
  end if;

  if new.post_id <> v_job_post_id or new.post_id <> v_post_item_post_id then
    raise exception 'Generation job item post mismatch';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_generate_listboard_post_items_updated_at on public.generate_listboard_post_items;
create trigger trg_generate_listboard_post_items_updated_at
before update on public.generate_listboard_post_items
for each row
execute function public.set_generate_listboard_post_items_updated_at();

drop trigger if exists trg_generate_listboard_generation_jobs_updated_at on public.generate_listboard_generation_jobs;
create trigger trg_generate_listboard_generation_jobs_updated_at
before update on public.generate_listboard_generation_jobs
for each row
execute function public.set_generate_listboard_generation_jobs_updated_at();

drop trigger if exists trg_generate_listboard_generation_job_items_updated_at on public.generate_listboard_generation_job_items;
create trigger trg_generate_listboard_generation_job_items_updated_at
before update on public.generate_listboard_generation_job_items
for each row
execute function public.set_generate_listboard_generation_job_items_updated_at();

drop trigger if exists trg_validate_generate_listboard_generation_job_item on public.generate_listboard_generation_job_items;
create trigger trg_validate_generate_listboard_generation_job_item
before insert or update on public.generate_listboard_generation_job_items
for each row
execute function public.validate_generate_listboard_generation_job_item();

alter table public.generate_listboard_post_items enable row level security;
alter table public.generate_listboard_generation_jobs enable row level security;
alter table public.generate_listboard_generation_job_items enable row level security;

drop policy if exists "Authenticated users can read published generate listboard post items" on public.generate_listboard_post_items;
create policy "Authenticated users can read published generate listboard post items"
  on public.generate_listboard_post_items
  for select
  to authenticated
  using (
    is_active = true
    and deleted_at is null
    and exists (
      select 1
      from public.generate_listboard_posts posts
      where posts.id = post_id
        and posts.status = 'published'
        and posts.is_active = true
        and posts.deleted_at is null
    )
  );

drop policy if exists "Admins can manage generate listboard post items" on public.generate_listboard_post_items;
create policy "Admins can manage generate listboard post items"
  on public.generate_listboard_post_items
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Users can read own generate listboard generation jobs" on public.generate_listboard_generation_jobs;
create policy "Users can read own generate listboard generation jobs"
  on public.generate_listboard_generation_jobs
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own generate listboard generation jobs" on public.generate_listboard_generation_jobs;
create policy "Users can insert own generate listboard generation jobs"
  on public.generate_listboard_generation_jobs
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.generate_listboard_posts posts
      where posts.id = post_id
        and posts.status = 'published'
        and posts.is_active = true
        and posts.deleted_at is null
    )
  );

drop policy if exists "Users can update own generate listboard generation jobs" on public.generate_listboard_generation_jobs;
create policy "Users can update own generate listboard generation jobs"
  on public.generate_listboard_generation_jobs
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Admins can manage generate listboard generation jobs" on public.generate_listboard_generation_jobs;
create policy "Admins can manage generate listboard generation jobs"
  on public.generate_listboard_generation_jobs
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Users can read own generate listboard generation job items" on public.generate_listboard_generation_job_items;
create policy "Users can read own generate listboard generation job items"
  on public.generate_listboard_generation_job_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.generate_listboard_generation_jobs jobs
      where jobs.id = job_id
        and jobs.user_id = auth.uid()
    )
  );

drop policy if exists "Users can insert own generate listboard generation job items" on public.generate_listboard_generation_job_items;
create policy "Users can insert own generate listboard generation job items"
  on public.generate_listboard_generation_job_items
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.generate_listboard_generation_jobs jobs
      where jobs.id = job_id
        and jobs.user_id = auth.uid()
    )
  );

drop policy if exists "Users can update own generate listboard generation job items" on public.generate_listboard_generation_job_items;
create policy "Users can update own generate listboard generation job items"
  on public.generate_listboard_generation_job_items
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.generate_listboard_generation_jobs jobs
      where jobs.id = job_id
        and jobs.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.generate_listboard_generation_jobs jobs
      where jobs.id = job_id
        and jobs.user_id = auth.uid()
    )
  );

drop policy if exists "Admins can manage generate listboard generation job items" on public.generate_listboard_generation_job_items;
create policy "Admins can manage generate listboard generation job items"
  on public.generate_listboard_generation_job_items
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

insert into public.generate_listboard_post_items (
  post_id,
  question_number,
  passage_text,
  sort_order,
  is_active,
  created_by,
  updated_by,
  created_at,
  updated_at,
  deleted_at
)
select
  posts.id,
  '1',
  posts.passage_text,
  1,
  posts.is_active,
  posts.created_by,
  posts.updated_by,
  posts.created_at,
  posts.updated_at,
  null
from public.generate_listboard_posts posts
where posts.deleted_at is null
  and not exists (
    select 1
    from public.generate_listboard_post_items items
    where items.post_id = posts.id
  );
