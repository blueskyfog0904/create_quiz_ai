-- 회원 이름을 더 이상 받지도 저장하지도 않는다(회원가입 이름 칸·카카오 이름 동의 제거).
-- 화면에는 이름 대신 회원 표시 이름(이메일 앞 3글자 + 회원 id 끝 4글자, 코드에서 계산)을 쓴다.
-- 적용 순서: 이름을 읽고 쓰지 않는 코드를 먼저 배포한 뒤 이 마이그레이션을 적용한다.

-- 1) 가입 트리거: 이름 없이 프로필을 만든다(컬럼 삭제 전에 바꿔야 가입이 실패하지 않는다).
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_provider text;
  v_kakao_id text;
  v_kakao_email text;
  v_phone text;
  v_avatar_url text;
  v_signup_completed boolean;
begin
  v_provider := coalesce(
    nullif(btrim(new.raw_app_meta_data ->> 'provider'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'provider'), ''),
    'email'
  );

  v_kakao_id := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'kakao_id'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'provider_id'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'sub'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'id'), ''),
    nullif(btrim(new.raw_app_meta_data ->> 'provider_id'), ''),
    nullif(btrim(new.raw_app_meta_data ->> 'provider_uid'), ''),
    nullif(btrim(new.raw_app_meta_data ->> 'sub'), '')
  );

  v_kakao_email := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'kakao_email'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'email'), ''),
    nullif(btrim(new.raw_user_meta_data -> 'kakao_account' ->> 'email'), ''),
    nullif(btrim(new.email), '')
  );

  v_phone := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'phone'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'phone_number'), ''),
    nullif(btrim(new.raw_user_meta_data -> 'kakao_account' ->> 'phone_number'), '')
  );

  v_avatar_url := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'avatar_url'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'picture'), ''),
    nullif(btrim(new.raw_user_meta_data -> 'kakao_account' -> 'profile' ->> 'profile_image_url'), '')
  );

  v_signup_completed := case when v_provider = 'kakao' then false else true end;

  insert into public.profiles (
    id,
    email,
    phone,
    avatar_url,
    kakao_id,
    kakao_email,
    provider,
    signup_completed
  )
  values (
    new.id,
    coalesce(new.email, v_kakao_email),
    v_phone,
    v_avatar_url,
    v_kakao_id,
    v_kakao_email,
    v_provider,
    v_signup_completed
  );

  return new;
end;
$function$;

-- 2) 관리자 문제은행 목록: 업로더 정보에서 이름을 뺀다(profiles jsonb는 id·email만).
CREATE OR REPLACE FUNCTION public.admin_list_bank_questions(p_workspace_subject text, p_year_id uuid DEFAULT NULL::uuid, p_book_id uuid DEFAULT NULL::uuid, p_problem_type_id uuid DEFAULT NULL::uuid, p_source text DEFAULT 'admin_uploaded'::text, p_search text DEFAULT NULL::text, p_grade_level text DEFAULT NULL::text, p_difficulty text DEFAULT NULL::text, p_sort_by text DEFAULT 'created_at'::text, p_sort_order text DEFAULT 'desc'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, user_id uuid, question_text text, question_text_forward text, question_text_backward text, choices jsonb, answer text, explanation text, passage_text text, grade_level text, difficulty text, source text, source_type text, source_1 text, source_2 text, source_3 text, source_4 text, tags text[], rating smallint, created_at timestamp with time zone, updated_at timestamp with time zone, problem_type_id uuid, problem_types jsonb, profiles jsonb, year_id uuid, year_label text, book_id uuid, book_name text, total_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_source text := coalesce(nullif(p_source,''),'admin_uploaded');
  v_sort_by text := case when p_sort_by in ('created_at','updated_at','question_text','difficulty','grade_level') then p_sort_by else 'created_at' end;
  v_sort_order text := case when lower(coalesce(p_sort_order,'desc')) = 'asc' then 'asc' else 'desc' end;
  v_limit integer := greatest(0, least(coalesce(p_limit,20), 200));
  v_offset integer := greatest(0, coalesce(p_offset,0));
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_workspace_subject not in ('english','korean') then raise exception 'INVALID_SCOPE'; end if;
  return query
  with filtered as (
    select q.*, m.bank_problem_type_id, qbpt.type_name, qbpt.description as problem_type_description, p.email, m.year_id, y.label as year_label, m.book_id, b.name as book_name, count(*) over () as total_count
    from public.questions q
    left join public.profiles p on p.id = q.user_id
    join public.question_bank_question_metadata m on m.question_id = q.id
    join public.question_bank_problem_types qbpt on qbpt.id = m.bank_problem_type_id and qbpt.workspace_subject = m.workspace_subject
    left join public.question_bank_years y on y.id = m.year_id and y.workspace_subject = m.workspace_subject
    left join public.question_bank_books b on b.id = m.book_id and b.workspace_subject = m.workspace_subject
    where q.workspace_subject = p_workspace_subject and q.source = v_source and m.workspace_subject = p_workspace_subject
      and (p_year_id is null or m.year_id = p_year_id) and (p_book_id is null or m.book_id = p_book_id)
      and (p_problem_type_id is null or m.bank_problem_type_id = p_problem_type_id)
      and (p_search is null or q.question_text ilike '%' || p_search || '%' or q.passage_text ilike '%' || p_search || '%')
      and (p_grade_level is null or q.grade_level = p_grade_level) and (p_difficulty is null or q.difficulty = p_difficulty)
  )
  select f.id, f.user_id, f.question_text, f.question_text_forward, f.question_text_backward, f.choices, f.answer, f.explanation, f.passage_text, f.grade_level, f.difficulty, f.source::text, f.source_type, f.source_1, f.source_2, f.source_3, f.source_4, f.tags, f.rating, f.created_at, f.updated_at, f.bank_problem_type_id, jsonb_build_object('id',f.bank_problem_type_id,'type_name',f.type_name,'description',f.problem_type_description), jsonb_build_object('id',f.user_id,'email',f.email), f.year_id, f.year_label, f.book_id, f.book_name, f.total_count
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
    f.created_at desc, f.id desc
  limit v_limit offset v_offset;
end; $function$;

-- 3) 개인정보처리방침(DB 저장본)에서 수집 항목 '이름'을 뺀다.
update public.system_settings
set value = replace(
      replace(value::text, '이메일, 비밀번호, 이름, 휴대폰 번호', '이메일, 비밀번호, 휴대폰 번호'),
      '카카오 이메일·카카오 계정에서 제공되는 이름·전화번호',
      '카카오 이메일·전화번호'
    )::jsonb,
    updated_at = now()
where key = 'site_footer_content'
  and value::text like '%이름%';

-- 4) 로그인 정보(auth 메타데이터)에 남은 이름(full_name)을 지운다.
update auth.users
set raw_user_meta_data = raw_user_meta_data - 'full_name'
where raw_user_meta_data ? 'full_name';

update auth.identities
set identity_data = identity_data - 'full_name'
where identity_data ? 'full_name';

-- 5) 회원 이름 컬럼을 지운다(저장된 이름도 함께 사라진다).
alter table public.profiles drop column name;
