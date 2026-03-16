alter table public.generate_listboard_generation_job_items
  add column if not exists generated_question jsonb,
  add column if not exists raw_ai_response text,
  add column if not exists save_status text not null default 'unsaved' check (save_status in ('unsaved', 'saving', 'saved', 'save_failed')),
  add column if not exists saved_at timestamptz,
  add column if not exists save_error_message text;

comment on column public.generate_listboard_generation_job_items.question_id is '선택 저장 완료 시 questions.id';
comment on column public.generate_listboard_generation_job_items.generated_question is '선택 저장 전 검토용 AI 생성 결과';
comment on column public.generate_listboard_generation_job_items.raw_ai_response is '선택 저장 전 검토/디버깅용 원본 AI 응답';
comment on column public.generate_listboard_generation_job_items.save_status is '선택 저장 상태';
comment on column public.generate_listboard_generation_job_items.saved_at is 'questions 저장 완료 시각';
comment on column public.generate_listboard_generation_job_items.save_error_message is 'questions 저장 실패 메시지';

create index if not exists idx_generate_listboard_generation_job_items_job_save_status
  on public.generate_listboard_generation_job_items(job_id, save_status);
