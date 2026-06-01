alter table public.problem_types
add column if not exists review_output_format text;

comment on column public.problem_types.review_output_format is 'AI-generated question review response structure prompt';

notify pgrst, 'reload schema';
