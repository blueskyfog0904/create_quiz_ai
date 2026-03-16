alter table public.generate_listboard_generation_jobs
  add column if not exists grade_level text,
  add column if not exists difficulty text;

comment on column public.generate_listboard_generation_jobs.grade_level is '배치 생성 요청에 사용한 학년 옵션';
comment on column public.generate_listboard_generation_jobs.difficulty is '배치 생성 요청에 사용한 난이도 옵션';
