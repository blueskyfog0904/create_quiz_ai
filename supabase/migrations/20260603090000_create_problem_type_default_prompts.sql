create table if not exists public.problem_type_default_prompts (
  id uuid primary key default gen_random_uuid(),
  workspace_subject text not null check (workspace_subject in ('english', 'korean')),
  prompt_key text not null check (prompt_key in (
    'output_format',
    'review_prompt_template',
    'review_output_format',
    'regeneration_prompt_template'
  )),
  display_name text not null,
  description text,
  content text not null,
  constraint problem_type_default_prompts_content_not_blank
    check (length(btrim(content)) > 0),
  is_enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_subject, prompt_key)
);

alter table public.problem_types
add column if not exists output_format_mode text not null default 'custom'
check (output_format_mode in ('default', 'custom', 'disabled'));

alter table public.problem_types
add column if not exists review_prompt_template_mode text not null default 'custom'
check (review_prompt_template_mode in ('default', 'custom', 'disabled'));

alter table public.problem_types
add column if not exists review_output_format_mode text not null default 'custom'
check (review_output_format_mode in ('default', 'custom', 'disabled'));

alter table public.problem_types
add column if not exists regeneration_prompt_template_mode text not null default 'custom'
check (regeneration_prompt_template_mode in ('default', 'custom', 'disabled'));

alter table public.problem_type_default_prompts enable row level security;

drop policy if exists "Authenticated users can view problem type default prompts" on public.problem_type_default_prompts;
create policy "Authenticated users can view problem type default prompts"
  on public.problem_type_default_prompts
  for select
  to authenticated
  using (true);

drop policy if exists "Admins can manage problem type default prompts" on public.problem_type_default_prompts;
create policy "Admins can manage problem type default prompts"
  on public.problem_type_default_prompts
  for all
  to authenticated
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

insert into public.problem_type_default_prompts (
  workspace_subject,
  prompt_key,
  display_name,
  description,
  content,
  is_enabled,
  sort_order
)
values
  ('english', 'output_format', '응답 구조 프롬프트', '문제 생성 API가 반환할 JSON 응답 구조를 정의합니다.', '다음 JSON 구조로만 응답하세요. question_text, choices, answer, explanation 필드를 포함하고, 선택지가 문제 본문에 이미 포함되어 있으면 choices는 빈 배열로 반환하세요.', true, 10),
  ('english', 'review_prompt_template', '문제 검토 프롬프트', '생성된 문제가 지문과 문제 생성 프롬프트를 따랐는지 검토하는 기준입니다.', '너는 영어 교육 평가 문항 검토자입니다. 생성된 문제가 문제 생성 프롬프트와 응답 구조 프롬프트를 충실히 따랐는지 검토하세요.', true, 20),
  ('english', 'review_output_format', '검토 후 응답구조 프롬프트', '문제 검토 API가 반환할 JSON 응답 구조를 정의합니다.', '반드시 passed, feedback, issues, score 필드를 포함한 JSON 형식으로만 검토 결과를 반환하세요.', true, 30),
  ('english', 'regeneration_prompt_template', '미 통과시 문제생성 요청 프롬프트', '검토 미통과 시 이전 문제와 피드백을 반영해 재생성하도록 요청합니다.', '이전 생성 문제와 검토 피드백의 feedback 및 issues 전체를 반영해 새 문제를 생성하세요. 지문에 없는 내용은 추가하지 말고 같은 JSON 구조로 반환하세요.', true, 40),
  ('korean', 'output_format', '응답 구조 프롬프트', '문제 생성 API가 반환할 JSON 응답 구조를 정의합니다.', '다음 JSON 구조로만 응답하세요. question_text, choices, answer, explanation 필드를 포함하고, 선택지가 문제 본문에 이미 포함되어 있으면 choices는 빈 배열로 반환하세요.', true, 10),
  ('korean', 'review_prompt_template', '문제 검토 프롬프트', '생성된 문제가 지문과 문제 생성 프롬프트를 따랐는지 검토하는 기준입니다.', '너는 국어 교육 평가 문항 검토자입니다. 생성된 문제가 문제 생성 프롬프트와 응답 구조 프롬프트를 충실히 따랐는지 검토하세요.', true, 20),
  ('korean', 'review_output_format', '검토 후 응답구조 프롬프트', '문제 검토 API가 반환할 JSON 응답 구조를 정의합니다.', '반드시 passed, feedback, issues, score 필드를 포함한 JSON 형식으로만 검토 결과를 반환하세요.', true, 30),
  ('korean', 'regeneration_prompt_template', '미 통과시 문제생성 요청 프롬프트', '검토 미통과 시 이전 문제와 피드백을 반영해 재생성하도록 요청합니다.', '이전 생성 문제와 검토 피드백의 feedback 및 issues 전체를 반영해 새 문제를 생성하세요. 지문에 없는 내용은 추가하지 말고 같은 JSON 구조로 반환하세요.', true, 40)
on conflict (workspace_subject, prompt_key) do nothing;
