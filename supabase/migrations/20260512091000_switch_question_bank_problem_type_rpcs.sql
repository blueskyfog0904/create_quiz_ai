-- Switch question-bank behavior from public.questions.problem_type_id to
-- public.question_bank_question_metadata.bank_problem_type_id.
-- API payloads keep the public field name problemTypeId for compatibility, but
-- the UUID now refers to question_bank_problem_types.id.

create or replace function public.get_question_bank_availability(
  p_workspace_subject text,
  p_year_id uuid,
  p_book_id uuid
)
returns table(problem_type_id uuid, available_count integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_workspace_subject not in ('english', 'korean') then
    raise exception 'INVALID_SCOPE';
  end if;

  if not exists (
    select 1
    from public.question_bank_years y
    join public.question_bank_books b on b.workspace_subject = y.workspace_subject
    where y.id = p_year_id
      and b.id = p_book_id
      and y.workspace_subject = p_workspace_subject
      and b.workspace_subject = p_workspace_subject
      and y.is_active = true
      and b.is_active = true
  ) then
    raise exception 'INACTIVE_DIMENSION';
  end if;

  return query
  select m.bank_problem_type_id as problem_type_id, count(*)::integer as available_count
  from public.questions q
  join public.question_bank_question_metadata m on m.question_id = q.id
  join public.question_bank_problem_types qbpt
    on qbpt.id = m.bank_problem_type_id
   and qbpt.workspace_subject = m.workspace_subject
  where q.user_id = v_user_id
    and q.source = 'from_community'
    and q.shared_question_id is not null
    and q.workspace_subject = p_workspace_subject
    and m.workspace_subject = p_workspace_subject
    and m.year_id = p_year_id
    and m.book_id = p_book_id
    and qbpt.is_active = true
  group by m.bank_problem_type_id;
end;
$$;

create or replace function public.create_random_bank_exam_paper(
  p_workspace_subject text,
  p_title text,
  p_year_id uuid,
  p_book_id uuid,
  p_type_counts jsonb
)
returns table(exam_paper_id uuid, selected_question_ids uuid[], total_count integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_exam_paper_id uuid;
  v_selected_question_ids uuid[] := '{}';
  v_total_count bigint := 0;
  v_type_count integer := 0;
  v_distinct_type_count integer := 0;
  v_limit constant integer := 100;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_workspace_subject not in ('english', 'korean') or nullif(btrim(p_title), '') is null then
    raise exception 'INVALID_SCOPE';
  end if;

  if jsonb_typeof(p_type_counts) <> 'array' then
    raise exception 'INVALID_SCOPE';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_type_counts) value
    where jsonb_typeof(value) <> 'object'
       or (value->>'problemTypeId') is null
       or not ((value->>'problemTypeId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
       or (value->>'count') is null
       or not ((value->>'count') ~ '^[0-9]+$')
       or length(value->>'count') > 9
       or case
         when (value->>'count') ~ '^[0-9]+$' and length(value->>'count') <= 9 then (value->>'count')::integer <= 0
         else true
       end
  ) then
    raise exception 'INVALID_SCOPE';
  end if;

  if not exists (
    select 1
    from public.question_bank_years y
    join public.question_bank_books b on b.workspace_subject = y.workspace_subject
    where y.id = p_year_id
      and b.id = p_book_id
      and y.workspace_subject = p_workspace_subject
      and b.workspace_subject = p_workspace_subject
      and y.is_active = true
      and b.is_active = true
  ) then
    raise exception 'INACTIVE_DIMENSION';
  end if;

  with requested as (
    select
      (value->>'problemTypeId')::uuid as problem_type_id,
      (value->>'count')::integer as requested_count
    from jsonb_array_elements(p_type_counts) value
  )
  select count(*), count(distinct problem_type_id), coalesce(sum(requested_count), 0)
  into v_type_count, v_distinct_type_count, v_total_count
  from requested;

  if v_type_count = 0 then
    raise exception 'INVALID_SCOPE';
  end if;

  if v_type_count <> v_distinct_type_count then
    raise exception 'DUPLICATE_TYPE';
  end if;

  if v_total_count > v_limit then
    raise exception 'COUNT_LIMIT_EXCEEDED';
  end if;

  if exists (
    with requested as (
      select (value->>'problemTypeId')::uuid as problem_type_id
      from jsonb_array_elements(p_type_counts) value
    )
    select 1
    from requested r
    left join public.question_bank_problem_types qbpt
      on qbpt.id = r.problem_type_id
     and qbpt.workspace_subject = p_workspace_subject
     and qbpt.is_active = true
    where qbpt.id is null
  ) then
    raise exception 'INACTIVE_DIMENSION';
  end if;

  if exists (
    with requested as (
      select
        (value->>'problemTypeId')::uuid as problem_type_id,
        (value->>'count')::integer as requested_count
      from jsonb_array_elements(p_type_counts) value
    ), available as (
      select m.bank_problem_type_id as problem_type_id, count(*)::integer as available_count
      from public.questions q
      join public.question_bank_question_metadata m on m.question_id = q.id
      join public.question_bank_problem_types qbpt
        on qbpt.id = m.bank_problem_type_id
       and qbpt.workspace_subject = m.workspace_subject
      where q.user_id = v_user_id
        and q.source = 'from_community'
        and q.shared_question_id is not null
        and q.workspace_subject = p_workspace_subject
        and m.workspace_subject = p_workspace_subject
        and m.year_id = p_year_id
        and m.book_id = p_book_id
        and qbpt.is_active = true
      group by m.bank_problem_type_id
    )
    select 1
    from requested r
    left join available a on a.problem_type_id = r.problem_type_id
    where coalesce(a.available_count, 0) < r.requested_count
  ) then
    raise exception 'INSUFFICIENT_QUESTIONS';
  end if;

  insert into public.exam_papers(
    paper_title,
    user_id,
    workspace_subject,
    generation_mode,
    generation_criteria
  )
  values (
    p_title,
    v_user_id,
    p_workspace_subject,
    'random_bank',
    jsonb_build_object(
      'yearId', p_year_id,
      'bookId', p_book_id,
      'typeCounts', p_type_counts,
      'MAX_RANDOM_EXAM_QUESTION_COUNT', v_limit
    )
  )
  returning id into v_exam_paper_id;

  with requested as (
    select
      row_number() over () as type_order,
      (value->>'problemTypeId')::uuid as problem_type_id,
      (value->>'count')::integer as requested_count
    from jsonb_array_elements(p_type_counts) value
  ), ranked_candidates as (
    select
      q.id,
      r.type_order,
      row_number() over (partition by m.bank_problem_type_id order by random()) as candidate_rank
    from requested r
    join public.question_bank_question_metadata m on m.bank_problem_type_id = r.problem_type_id
    join public.questions q on q.id = m.question_id
    join public.question_bank_problem_types qbpt
      on qbpt.id = m.bank_problem_type_id
     and qbpt.workspace_subject = m.workspace_subject
    where q.user_id = v_user_id
      and q.source = 'from_community'
      and q.shared_question_id is not null
      and q.workspace_subject = p_workspace_subject
      and m.workspace_subject = p_workspace_subject
      and m.year_id = p_year_id
      and m.book_id = p_book_id
      and qbpt.is_active = true
  ), selected as (
    select rc.id, rc.type_order, rc.candidate_rank
    from ranked_candidates rc
    join requested r on r.type_order = rc.type_order
    where rc.candidate_rank <= r.requested_count
  ), numbered as (
    select id, row_number() over (order by type_order, candidate_rank, id) as item_number
    from selected
  ), inserted as (
    insert into public.exam_paper_items(
      exam_paper_id,
      question_id,
      number,
      order_index,
      workspace_subject
    )
    select
      v_exam_paper_id,
      n.id,
      n.item_number,
      n.item_number,
      p_workspace_subject
    from numbered n
    order by n.item_number
    returning question_id, number
  )
  select array_agg(question_id order by number), count(*)::integer
  into v_selected_question_ids, v_total_count
  from inserted;

  exam_paper_id := v_exam_paper_id;
  selected_question_ids := coalesce(v_selected_question_ids, '{}');
  total_count := v_total_count;
  return next;
end;
$$;

create or replace function public.create_admin_bank_question(
  p_workspace_subject text,
  p_question jsonb,
  p_year_id uuid,
  p_book_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_question_id uuid;
  v_bank_problem_type_text text;
  v_bank_problem_type_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if p_workspace_subject not in ('english', 'korean') then
    raise exception 'INVALID_SCOPE';
  end if;

  v_bank_problem_type_text := coalesce(
    nullif(p_question->>'bankProblemTypeId', ''),
    nullif(p_question->>'bank_problem_type_id', ''),
    nullif(p_question->>'problem_type_id', '')
  );

  if v_bank_problem_type_text is null
    or not (v_bank_problem_type_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'INVALID_SCOPE';
  end if;

  v_bank_problem_type_id := v_bank_problem_type_text::uuid;

  if not exists (
    select 1
    from public.question_bank_years y
    join public.question_bank_books b on b.workspace_subject = y.workspace_subject
    where y.id = p_year_id
      and b.id = p_book_id
      and y.workspace_subject = p_workspace_subject
      and b.workspace_subject = p_workspace_subject
      and y.is_active = true
      and b.is_active = true
  ) then
    raise exception 'INACTIVE_DIMENSION';
  end if;

  if not exists (
    select 1
    from public.question_bank_problem_types qbpt
    where qbpt.id = v_bank_problem_type_id
      and qbpt.workspace_subject = p_workspace_subject
      and qbpt.is_active = true
  ) then
    raise exception 'INACTIVE_DIMENSION';
  end if;

  if p_question ? 'rating' and nullif(p_question->>'rating', '') is not null then
    if not ((p_question->>'rating') ~ '^[0-9]+$') or length(p_question->>'rating') > 1 then
      raise exception 'INVALID_SCOPE';
    end if;

    if (p_question->>'rating')::integer not between 0 and 3 then
      raise exception 'INVALID_SCOPE';
    end if;
  end if;

  if p_question ? 'tags' and jsonb_typeof(p_question->'tags') <> 'array' then
    raise exception 'INVALID_SCOPE';
  end if;

  insert into public.questions(
    user_id,
    source,
    workspace_subject,
    question_text,
    question_text_forward,
    question_text_backward,
    choices,
    answer,
    explanation,
    passage_text,
    grade_level,
    difficulty,
    problem_type_id,
    source_type,
    source_1,
    source_2,
    source_3,
    source_4,
    tags,
    rating,
    raw_ai_response
  )
  values (
    v_user_id,
    'admin_uploaded',
    p_workspace_subject,
    coalesce(p_question->>'question_text', ''),
    p_question->>'question_text_forward',
    p_question->>'question_text_backward',
    coalesce(p_question->'choices', '[]'::jsonb),
    coalesce(p_question->>'answer', ''),
    p_question->>'explanation',
    p_question->>'passage_text',
    p_question->>'grade_level',
    p_question->>'difficulty',
    null,
    p_question->>'source_type',
    p_question->>'source_1',
    p_question->>'source_2',
    p_question->>'source_3',
    p_question->>'source_4',
    case when p_question ? 'tags' then array(select jsonb_array_elements_text(p_question->'tags')) else null end,
    coalesce(nullif(p_question->>'rating', '')::smallint, 0),
    p_question->>'raw_ai_response'
  )
  returning id into v_question_id;

  insert into public.question_bank_question_metadata(
    question_id,
    workspace_subject,
    year_id,
    book_id,
    bank_problem_type_id
  )
  values (v_question_id, p_workspace_subject, p_year_id, p_book_id, v_bank_problem_type_id);

  return v_question_id;
end;
$$;

create or replace function public.create_admin_bank_questions_bulk(
  p_workspace_subject text,
  p_questions jsonb
)
returns table(inserted_count integer, failed_count integer, inserted_question_ids uuid[], row_errors jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_batch_limit constant integer := 500;
  v_item jsonb;
  v_question jsonb;
  v_question_id uuid;
  v_inserted_ids uuid[] := '{}';
  v_bank_problem_type_text text;
  v_bank_problem_type_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if p_workspace_subject not in ('english', 'korean') or jsonb_typeof(p_questions) <> 'array' then
    raise exception 'INVALID_SCOPE';
  end if;

  if jsonb_array_length(p_questions) > v_batch_limit then
    raise exception 'BULK_UPLOAD_BATCH_TOO_LARGE';
  end if;

  for v_item in select value from jsonb_array_elements(p_questions) value loop
    if jsonb_typeof(v_item) <> 'object'
      or (v_item->>'yearId') is null
      or not ((v_item->>'yearId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      or (v_item->>'bookId') is null
      or not ((v_item->>'bookId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      raise exception 'INVALID_SCOPE';
    end if;

    v_question := coalesce(v_item->'question', '{}'::jsonb);

    if jsonb_typeof(v_question) <> 'object' then
      raise exception 'INVALID_SCOPE';
    end if;

    v_bank_problem_type_text := coalesce(
      nullif(v_item->>'bankProblemTypeId', ''),
      nullif(v_item->>'bank_problem_type_id', ''),
      nullif(v_question->>'bankProblemTypeId', ''),
      nullif(v_question->>'bank_problem_type_id', ''),
      nullif(v_question->>'problem_type_id', '')
    );

    if v_bank_problem_type_text is null
      or not (v_bank_problem_type_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      raise exception 'INVALID_SCOPE';
    end if;

    v_bank_problem_type_id := v_bank_problem_type_text::uuid;


    if v_question ? 'rating' and nullif(v_question->>'rating', '') is not null then
      if not ((v_question->>'rating') ~ '^[0-9]+$') or length(v_question->>'rating') > 1 then
        raise exception 'INVALID_SCOPE';
      end if;

      if (v_question->>'rating')::integer not between 0 and 3 then
        raise exception 'INVALID_SCOPE';
      end if;
    end if;

    if v_question ? 'tags' and jsonb_typeof(v_question->'tags') <> 'array' then
      raise exception 'INVALID_SCOPE';
    end if;

    if not exists (
      select 1
      from public.question_bank_years y
      join public.question_bank_books b on b.workspace_subject = y.workspace_subject
      where y.id = (v_item->>'yearId')::uuid
        and b.id = (v_item->>'bookId')::uuid
        and y.workspace_subject = p_workspace_subject
        and b.workspace_subject = p_workspace_subject
        and y.is_active = true
        and b.is_active = true
    ) then
      raise exception 'INACTIVE_DIMENSION';
    end if;

    if not exists (
      select 1
      from public.question_bank_problem_types qbpt
      where qbpt.id = v_bank_problem_type_id
        and qbpt.workspace_subject = p_workspace_subject
        and qbpt.is_active = true
    ) then
      raise exception 'INACTIVE_DIMENSION';
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_questions) value loop
    v_question := coalesce(v_item->'question', '{}'::jsonb);
    v_bank_problem_type_id := coalesce(
      nullif(v_item->>'bankProblemTypeId', ''),
      nullif(v_item->>'bank_problem_type_id', ''),
      nullif(v_question->>'bankProblemTypeId', ''),
      nullif(v_question->>'bank_problem_type_id', ''),
      nullif(v_question->>'problem_type_id', '')
    )::uuid;

    insert into public.questions(
      user_id,
      source,
      workspace_subject,
      question_text,
      question_text_forward,
      question_text_backward,
      choices,
      answer,
      explanation,
      passage_text,
      grade_level,
      difficulty,
      problem_type_id,
      source_type,
      source_1,
      source_2,
      source_3,
      source_4,
      tags,
      rating,
      raw_ai_response
    )
    values (
      v_user_id,
      'admin_uploaded',
      p_workspace_subject,
      coalesce(v_question->>'question_text', ''),
      v_question->>'question_text_forward',
      v_question->>'question_text_backward',
      coalesce(v_question->'choices', '[]'::jsonb),
      coalesce(v_question->>'answer', ''),
      v_question->>'explanation',
      v_question->>'passage_text',
      v_question->>'grade_level',
      v_question->>'difficulty',
      null,
      v_question->>'source_type',
      v_question->>'source_1',
      v_question->>'source_2',
      v_question->>'source_3',
      v_question->>'source_4',
      case when v_question ? 'tags' then array(select jsonb_array_elements_text(v_question->'tags')) else null end,
      coalesce(nullif(v_question->>'rating', '')::smallint, 0),
      v_question->>'raw_ai_response'
    )
    returning id into v_question_id;

    insert into public.question_bank_question_metadata(
      question_id,
      workspace_subject,
      year_id,
      book_id,
      bank_problem_type_id
    )
    values (
      v_question_id,
      p_workspace_subject,
      (v_item->>'yearId')::uuid,
      (v_item->>'bookId')::uuid,
      v_bank_problem_type_id
    );

    v_inserted_ids := array_append(v_inserted_ids, v_question_id);
  end loop;

  inserted_count := coalesce(array_length(v_inserted_ids, 1), 0);
  failed_count := 0;
  inserted_question_ids := v_inserted_ids;
  row_errors := '[]'::jsonb;
  return next;
end;
$$;

create or replace function public.update_admin_bank_question(
  p_question_id uuid,
  p_workspace_subject text,
  p_question_patch jsonb,
  p_year_id uuid,
  p_book_id uuid
)
returns table(question_id uuid, copied_updated_count integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_copied_count integer := 0;
  v_bank_problem_type_text text;
  v_bank_problem_type_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if p_workspace_subject not in ('english', 'korean') then
    raise exception 'INVALID_SCOPE';
  end if;

  if not exists (
    select 1
    from public.questions q
    where q.id = p_question_id
      and q.workspace_subject = p_workspace_subject
      and q.source = 'admin_uploaded'
  ) then
    raise exception 'INVALID_SOURCE';
  end if;

  v_bank_problem_type_text := coalesce(
    nullif(p_question_patch->>'bankProblemTypeId', ''),
    nullif(p_question_patch->>'bank_problem_type_id', ''),
    nullif(p_question_patch->>'problem_type_id', ''),
    (
      select m.bank_problem_type_id::text
      from public.question_bank_question_metadata m
      where m.question_id = p_question_id
        and m.workspace_subject = p_workspace_subject
    )
  );

  if v_bank_problem_type_text is null
    or not (v_bank_problem_type_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'INVALID_SCOPE';
  end if;

  v_bank_problem_type_id := v_bank_problem_type_text::uuid;

  if not exists (
    select 1
    from public.question_bank_years y
    join public.question_bank_books b on b.workspace_subject = y.workspace_subject
    where y.id = p_year_id
      and b.id = p_book_id
      and y.workspace_subject = p_workspace_subject
      and b.workspace_subject = p_workspace_subject
      and y.is_active = true
      and b.is_active = true
  ) then
    raise exception 'INACTIVE_DIMENSION';
  end if;

  if not exists (
    select 1
    from public.question_bank_problem_types qbpt
    where qbpt.id = v_bank_problem_type_id
      and qbpt.workspace_subject = p_workspace_subject
      and qbpt.is_active = true
  ) then
    raise exception 'INACTIVE_DIMENSION';
  end if;

  if p_question_patch ? 'rating' and nullif(p_question_patch->>'rating', '') is not null then
    if not ((p_question_patch->>'rating') ~ '^[0-9]+$') or length(p_question_patch->>'rating') > 1 then
      raise exception 'INVALID_SCOPE';
    end if;

    if (p_question_patch->>'rating')::integer not between 0 and 3 then
      raise exception 'INVALID_SCOPE';
    end if;
  end if;

  if p_question_patch ? 'tags' and jsonb_typeof(p_question_patch->'tags') <> 'array' then
    raise exception 'INVALID_SCOPE';
  end if;

  update public.questions q
  set
    question_text = case when p_question_patch ? 'question_text' then coalesce(p_question_patch->>'question_text', '') else q.question_text end,
    question_text_forward = case when p_question_patch ? 'question_text_forward' then p_question_patch->>'question_text_forward' else q.question_text_forward end,
    question_text_backward = case when p_question_patch ? 'question_text_backward' then p_question_patch->>'question_text_backward' else q.question_text_backward end,
    choices = case when p_question_patch ? 'choices' then coalesce(p_question_patch->'choices', '[]'::jsonb) else q.choices end,
    answer = case when p_question_patch ? 'answer' then coalesce(p_question_patch->>'answer', '') else q.answer end,
    explanation = case when p_question_patch ? 'explanation' then p_question_patch->>'explanation' else q.explanation end,
    passage_text = case when p_question_patch ? 'passage_text' then p_question_patch->>'passage_text' else q.passage_text end,
    grade_level = case when p_question_patch ? 'grade_level' then p_question_patch->>'grade_level' else q.grade_level end,
    difficulty = case when p_question_patch ? 'difficulty' then p_question_patch->>'difficulty' else q.difficulty end,
    problem_type_id = null,
    source_type = case when p_question_patch ? 'source_type' then p_question_patch->>'source_type' else q.source_type end,
    source_1 = case when p_question_patch ? 'source_1' then p_question_patch->>'source_1' else q.source_1 end,
    source_2 = case when p_question_patch ? 'source_2' then p_question_patch->>'source_2' else q.source_2 end,
    source_3 = case when p_question_patch ? 'source_3' then p_question_patch->>'source_3' else q.source_3 end,
    source_4 = case when p_question_patch ? 'source_4' then p_question_patch->>'source_4' else q.source_4 end,
    tags = case when p_question_patch ? 'tags' then array(select jsonb_array_elements_text(p_question_patch->'tags')) else q.tags end,
    rating = case when p_question_patch ? 'rating' then coalesce(nullif(p_question_patch->>'rating', '')::smallint, 0) else q.rating end,
    raw_ai_response = case when p_question_patch ? 'raw_ai_response' then p_question_patch->>'raw_ai_response' else q.raw_ai_response end,
    updated_at = timezone('utc'::text, now())
  where q.id = p_question_id;

  insert into public.question_bank_question_metadata(
    question_id,
    workspace_subject,
    year_id,
    book_id,
    bank_problem_type_id
  )
  values (p_question_id, p_workspace_subject, p_year_id, p_book_id, v_bank_problem_type_id)
  on conflict (question_id) do update
  set
    workspace_subject = excluded.workspace_subject,
    year_id = excluded.year_id,
    book_id = excluded.book_id,
    bank_problem_type_id = excluded.bank_problem_type_id,
    updated_at = timezone('utc'::text, now());

  insert into public.question_bank_question_metadata(
    question_id,
    workspace_subject,
    year_id,
    book_id,
    bank_problem_type_id
  )
  select q.id, p_workspace_subject, p_year_id, p_book_id, v_bank_problem_type_id
  from public.questions q
  where q.source = 'from_community'
    and q.shared_question_id = p_question_id
    and q.workspace_subject = p_workspace_subject
  on conflict (question_id) do update
  set
    workspace_subject = excluded.workspace_subject,
    year_id = excluded.year_id,
    book_id = excluded.book_id,
    bank_problem_type_id = excluded.bank_problem_type_id,
    updated_at = timezone('utc'::text, now());

  get diagnostics v_copied_count = row_count;

  update public.questions q
  set problem_type_id = null,
      updated_at = timezone('utc'::text, now())
  where q.source = 'from_community'
    and q.shared_question_id = p_question_id
    and q.workspace_subject = p_workspace_subject;

  question_id := p_question_id;
  copied_updated_count := v_copied_count;
  return next;
end;
$$;

create or replace function public.copy_admin_questions_to_user_bank(
  p_workspace_subject text,
  p_admin_question_ids uuid[],
  p_target_user_id uuid
)
returns table(saved_count integer, skipped_count integer, saved_question_ids uuid[])
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := p_target_user_id;
  v_admin_question_id uuid;
  v_saved_question_id uuid;
  v_saved_ids uuid[] := '{}';
  v_saved_count integer := 0;
  v_skipped_count integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;

  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_workspace_subject not in ('english', 'korean') then
    raise exception 'INVALID_SCOPE';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_admin_question_ids, '{}')) source_id
    left join public.questions q on q.id = source_id
      and q.workspace_subject = p_workspace_subject
      and q.source = 'admin_uploaded'
    where q.id is null
  ) then
    raise exception 'INVALID_SOURCE';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_admin_question_ids, '{}')) source_id
    left join public.question_bank_question_metadata m on m.question_id = source_id
      and m.workspace_subject = p_workspace_subject
      and m.bank_problem_type_id is not null
    where m.question_id is null
  ) then
    raise exception 'NO_METADATA';
  end if;

  for v_admin_question_id in select distinct unnest(coalesce(p_admin_question_ids, '{}')) loop
    begin
      v_saved_question_id := null;

      if exists (
        select 1
        from public.questions q
        where q.user_id = v_user_id
          and q.workspace_subject = p_workspace_subject
          and q.source = 'from_community'
          and q.shared_question_id = v_admin_question_id
      ) then
        v_skipped_count := v_skipped_count + 1;
        continue;
      end if;

      insert into public.questions(
        user_id,
        source,
        shared_question_id,
        workspace_subject,
        question_text,
        question_text_forward,
        question_text_backward,
        choices,
        answer,
        explanation,
        passage_text,
        grade_level,
        difficulty,
        problem_type_id,
        source_type,
        source_1,
        source_2,
        source_3,
        source_4,
        tags,
        rating,
        raw_ai_response
      )
      select
        v_user_id,
        'from_community',
        q.id,
        q.workspace_subject,
        q.question_text,
        q.question_text_forward,
        q.question_text_backward,
        q.choices,
        q.answer,
        q.explanation,
        q.passage_text,
        q.grade_level,
        q.difficulty,
        null,
        q.source_type,
        q.source_1,
        q.source_2,
        q.source_3,
        q.source_4,
        q.tags,
        q.rating,
        q.raw_ai_response
      from public.questions q
      where q.id = v_admin_question_id
        and q.workspace_subject = p_workspace_subject
        and q.source = 'admin_uploaded'
      on conflict (user_id, workspace_subject, shared_question_id)
      where source = 'from_community' and shared_question_id is not null
      do nothing
      returning id into v_saved_question_id;

      if v_saved_question_id is null then
        v_skipped_count := v_skipped_count + 1;
      else
        insert into public.question_bank_question_metadata(
          question_id,
          workspace_subject,
          year_id,
          book_id,
          bank_problem_type_id
        )
        select
          v_saved_question_id,
          m.workspace_subject,
          m.year_id,
          m.book_id,
          m.bank_problem_type_id
        from public.question_bank_question_metadata m
        where m.question_id = v_admin_question_id;

        v_saved_ids := array_append(v_saved_ids, v_saved_question_id);
        v_saved_count := v_saved_count + 1;
      end if;
    exception when unique_violation then
      v_skipped_count := v_skipped_count + 1;
    end;
  end loop;

  saved_count := v_saved_count;
  skipped_count := v_skipped_count;
  saved_question_ids := v_saved_ids;
  return next;
end;
$$;

create or replace function public.admin_list_bank_questions(
  p_workspace_subject text,
  p_year_id uuid default null,
  p_book_id uuid default null,
  p_problem_type_id uuid default null,
  p_source text default 'admin_uploaded',
  p_search text default null,
  p_grade_level text default null,
  p_difficulty text default null,
  p_sort_by text default 'created_at',
  p_sort_order text default 'desc',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table(
  id uuid,
  user_id uuid,
  question_text text,
  question_text_forward text,
  question_text_backward text,
  choices jsonb,
  answer text,
  explanation text,
  passage_text text,
  grade_level text,
  difficulty text,
  source text,
  source_type text,
  source_1 text,
  source_2 text,
  source_3 text,
  source_4 text,
  tags text[],
  rating smallint,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  problem_type_id uuid,
  problem_types jsonb,
  profiles jsonb,
  year_id uuid,
  year_label text,
  book_id uuid,
  book_name text,
  total_count bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_source text := coalesce(nullif(p_source, ''), 'admin_uploaded');
  v_sort_by text := case when p_sort_by in ('created_at', 'updated_at', 'question_text', 'difficulty', 'grade_level') then p_sort_by else 'created_at' end;
  v_sort_order text := case when lower(coalesce(p_sort_order, 'desc')) = 'asc' then 'asc' else 'desc' end;
  v_limit integer := greatest(0, least(coalesce(p_limit, 20), 200));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if p_workspace_subject not in ('english', 'korean') then
    raise exception 'INVALID_SCOPE';
  end if;

  return query
  with filtered as (
    select
      q.*,
      m.bank_problem_type_id,
      qbpt.type_name,
      qbpt.description as problem_type_description,
      p.email,
      p.name,
      m.year_id,
      y.label as year_label,
      m.book_id,
      b.name as book_name,
      count(*) over () as total_count
    from public.questions q
    left join public.profiles p on p.id = q.user_id
    join public.question_bank_question_metadata m on m.question_id = q.id
    join public.question_bank_problem_types qbpt
      on qbpt.id = m.bank_problem_type_id
     and qbpt.workspace_subject = m.workspace_subject
    left join public.question_bank_years y on y.id = m.year_id and y.workspace_subject = m.workspace_subject
    left join public.question_bank_books b on b.id = m.book_id and b.workspace_subject = m.workspace_subject
    where q.workspace_subject = p_workspace_subject
      and q.source = v_source
      and m.workspace_subject = p_workspace_subject
      and (p_year_id is null or m.year_id = p_year_id)
      and (p_book_id is null or m.book_id = p_book_id)
      and (p_problem_type_id is null or m.bank_problem_type_id = p_problem_type_id)
      and (p_search is null or q.question_text ilike '%' || p_search || '%' or q.passage_text ilike '%' || p_search || '%')
      and (p_grade_level is null or q.grade_level = p_grade_level)
      and (p_difficulty is null or q.difficulty = p_difficulty)
  )
  select
    f.id,
    f.user_id,
    f.question_text,
    f.question_text_forward,
    f.question_text_backward,
    f.choices,
    f.answer,
    f.explanation,
    f.passage_text,
    f.grade_level,
    f.difficulty,
    f.source::text,
    f.source_type,
    f.source_1,
    f.source_2,
    f.source_3,
    f.source_4,
    f.tags,
    f.rating,
    f.created_at,
    f.updated_at,
    f.bank_problem_type_id,
    jsonb_build_object(
      'id', f.bank_problem_type_id,
      'type_name', f.type_name,
      'description', f.problem_type_description
    ),
    jsonb_build_object(
      'id', f.user_id,
      'email', f.email,
      'name', f.name
    ),
    f.year_id,
    f.year_label,
    f.book_id,
    f.book_name,
    f.total_count
  from filtered f
  order by
    case when v_sort_by = 'created_at' and v_sort_order = 'asc' then f.created_at end asc,
    case when v_sort_by = 'created_at' and v_sort_order = 'desc' then f.created_at end desc,
    case when v_sort_by = 'updated_at' and v_sort_order = 'asc' then f.updated_at end asc,
    case when v_sort_by = 'updated_at' and v_sort_order = 'desc' then f.updated_at end desc,
    case when v_sort_by = 'question_text' and v_sort_order = 'asc' then f.question_text end asc,
    case when v_sort_by = 'question_text' and v_sort_order = 'desc' then f.question_text end desc,
    case when v_sort_by = 'difficulty' and v_sort_order = 'asc' then f.difficulty end asc,
    case when v_sort_by = 'difficulty' and v_sort_order = 'desc' then f.difficulty end desc,
    case when v_sort_by = 'grade_level' and v_sort_order = 'asc' then f.grade_level end asc,
    case when v_sort_by = 'grade_level' and v_sort_order = 'desc' then f.grade_level end desc,
    f.created_at desc,
    f.id desc
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.get_question_bank_availability(text, uuid, uuid) from public;
grant execute on function public.get_question_bank_availability(text, uuid, uuid) to authenticated;

revoke all on function public.create_random_bank_exam_paper(text, text, uuid, uuid, jsonb) from public;
grant execute on function public.create_random_bank_exam_paper(text, text, uuid, uuid, jsonb) to authenticated;

revoke all on function public.create_admin_bank_question(text, jsonb, uuid, uuid) from public;
grant execute on function public.create_admin_bank_question(text, jsonb, uuid, uuid) to authenticated;

revoke all on function public.create_admin_bank_questions_bulk(text, jsonb) from public;
grant execute on function public.create_admin_bank_questions_bulk(text, jsonb) to authenticated;

revoke all on function public.update_admin_bank_question(uuid, text, jsonb, uuid, uuid) from public;
grant execute on function public.update_admin_bank_question(uuid, text, jsonb, uuid, uuid) to authenticated;

revoke all on function public.copy_admin_questions_to_user_bank(text, uuid[], uuid) from public;
revoke all on function public.copy_admin_questions_to_user_bank(text, uuid[], uuid) from authenticated;
grant execute on function public.copy_admin_questions_to_user_bank(text, uuid[], uuid) to service_role;

revoke all on function public.admin_list_bank_questions(text, uuid, uuid, uuid, text, text, text, text, text, text, integer, integer) from public;
grant execute on function public.admin_list_bank_questions(text, uuid, uuid, uuid, text, text, text, text, text, text, integer, integer) to authenticated;

create or replace function public.admin_audit_question_bank_metadata(
  p_workspace_subject text,
  p_filter jsonb default '{}'::jsonb
)
returns table(
  unassigned_admin_original_count integer,
  affected_saved_copy_count integer,
  excluded_ai_generated_count integer,
  duplicate_saved_copy_group_count integer,
  missing_admin_original_metadata_count integer,
  missing_saved_copy_metadata_count integer,
  mismatched_saved_copy_metadata_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if p_workspace_subject not in ('english', 'korean') then
    raise exception 'INVALID_SCOPE';
  end if;

  if jsonb_typeof(coalesce(p_filter, '{}'::jsonb)) <> 'object' then
    raise exception 'INVALID_SCOPE';
  end if;

  if nullif(p_filter->>'yearId', '') is not null
    and not ((p_filter->>'yearId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'INVALID_SCOPE';
  end if;

  if nullif(p_filter->>'bookId', '') is not null
    and not ((p_filter->>'bookId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'INVALID_SCOPE';
  end if;

  if nullif(p_filter->>'problemTypeId', '') is not null
    and not ((p_filter->>'problemTypeId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'INVALID_SCOPE';
  end if;

  return query
  with admin_originals as (
    select q.id
    from public.questions q
    left join public.question_bank_question_metadata m on m.question_id = q.id
    where q.workspace_subject = p_workspace_subject
      and q.source = 'admin_uploaded'
      and (nullif(p_filter->>'problemTypeId', '') is null or m.bank_problem_type_id = nullif(p_filter->>'problemTypeId', '')::uuid)
      and (nullif(p_filter->>'yearId', '') is null or m.year_id = nullif(p_filter->>'yearId', '')::uuid)
      and (nullif(p_filter->>'bookId', '') is null or m.book_id = nullif(p_filter->>'bookId', '')::uuid)
  ), saved_copies as (
    select q.id, q.shared_question_id
    from public.questions q
    join admin_originals ao on ao.id = q.shared_question_id
    where q.workspace_subject = p_workspace_subject
      and q.source = 'from_community'
      and q.shared_question_id is not null
  ), duplicate_groups as (
    select q.user_id, q.workspace_subject, q.shared_question_id
    from public.questions q
    join admin_originals ao on ao.id = q.shared_question_id
    where q.workspace_subject = p_workspace_subject
      and q.source = 'from_community'
      and q.shared_question_id is not null
    group by q.user_id, q.workspace_subject, q.shared_question_id
    having count(*) > 1
  ), mismatched as (
    select sc.id
    from saved_copies sc
    join public.question_bank_question_metadata cm on cm.question_id = sc.id
    join public.question_bank_question_metadata om on om.question_id = sc.shared_question_id
    where cm.year_id is distinct from om.year_id
       or cm.book_id is distinct from om.book_id
       or cm.bank_problem_type_id is distinct from om.bank_problem_type_id
       or cm.workspace_subject is distinct from om.workspace_subject
  )
  select
    (select count(*)::integer from admin_originals ao left join public.question_bank_question_metadata m on m.question_id = ao.id where m.question_id is null),
    (select count(*)::integer from saved_copies),
    (select count(*)::integer from public.questions q where q.workspace_subject = p_workspace_subject and q.source = 'ai_generated'),
    (select count(*)::integer from duplicate_groups),
    (select count(*)::integer from admin_originals ao left join public.question_bank_question_metadata m on m.question_id = ao.id where m.question_id is null),
    (select count(*)::integer from saved_copies sc left join public.question_bank_question_metadata m on m.question_id = sc.id where m.question_id is null),
    (select count(*)::integer from mismatched);
end;
$$;

create or replace function public.admin_list_question_bank_backfill_candidates(
  p_workspace_subject text,
  p_filter jsonb default '{}'::jsonb,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table(
  question_id uuid,
  question_text text,
  problem_type_id uuid,
  current_year_id uuid,
  current_book_id uuid,
  affected_saved_copy_count integer,
  missing_metadata boolean,
  has_saved_copy_mismatch boolean,
  total_count bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_limit integer := greatest(0, least(coalesce(p_limit, 100), 500));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if p_workspace_subject not in ('english', 'korean') then
    raise exception 'INVALID_SCOPE';
  end if;

  if jsonb_typeof(coalesce(p_filter, '{}'::jsonb)) <> 'object' then
    raise exception 'INVALID_SCOPE';
  end if;

  if nullif(p_filter->>'yearId', '') is not null
    and not ((p_filter->>'yearId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'INVALID_SCOPE';
  end if;

  if nullif(p_filter->>'bookId', '') is not null
    and not ((p_filter->>'bookId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'INVALID_SCOPE';
  end if;

  if nullif(p_filter->>'problemTypeId', '') is not null
    and not ((p_filter->>'problemTypeId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'INVALID_SCOPE';
  end if;

  return query
  with candidates as (
    select
      q.id,
      q.question_text,
      m.bank_problem_type_id,
      m.year_id,
      m.book_id,
      m.question_id is null as missing_metadata,
      count(*) over () as total_count
    from public.questions q
    left join public.question_bank_question_metadata m on m.question_id = q.id
    where q.workspace_subject = p_workspace_subject
      and q.source = 'admin_uploaded'
      and (nullif(p_filter->>'search', '') is null or q.question_text ilike '%' || (p_filter->>'search') || '%')
      and (nullif(p_filter->>'problemTypeId', '') is null or m.bank_problem_type_id = nullif(p_filter->>'problemTypeId', '')::uuid)
      and (nullif(p_filter->>'yearId', '') is null or m.year_id = nullif(p_filter->>'yearId', '')::uuid)
      and (nullif(p_filter->>'bookId', '') is null or m.book_id = nullif(p_filter->>'bookId', '')::uuid)
    order by q.created_at desc, q.id desc
    limit v_limit offset v_offset
  )
  select
    c.id,
    c.question_text,
    c.bank_problem_type_id,
    c.year_id,
    c.book_id,
    (
      select count(*)::integer
      from public.questions copy_q
      where copy_q.shared_question_id = c.id
        and copy_q.source = 'from_community'
        and copy_q.workspace_subject = p_workspace_subject
    ),
    c.missing_metadata,
    exists (
      select 1
      from public.questions copy_q
      join public.question_bank_question_metadata cm on cm.question_id = copy_q.id
      left join public.question_bank_question_metadata om on om.question_id = c.id
      where copy_q.shared_question_id = c.id
        and copy_q.source = 'from_community'
        and copy_q.workspace_subject = p_workspace_subject
        and (
          om.question_id is null
          or cm.year_id is distinct from om.year_id
          or cm.book_id is distinct from om.book_id
          or cm.bank_problem_type_id is distinct from om.bank_problem_type_id
          or cm.workspace_subject is distinct from om.workspace_subject
        )
    ),
    c.total_count
  from candidates c;
end;
$$;

revoke all on function public.admin_audit_question_bank_metadata(text, jsonb) from public;
grant execute on function public.admin_audit_question_bank_metadata(text, jsonb) to authenticated;

revoke all on function public.admin_list_question_bank_backfill_candidates(text, jsonb, integer, integer) from public;
grant execute on function public.admin_list_question_bank_backfill_candidates(text, jsonb, integer, integer) to authenticated;
