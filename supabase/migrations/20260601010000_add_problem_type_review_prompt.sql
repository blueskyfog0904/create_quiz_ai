alter table public.problem_types
add column if not exists review_prompt_template text;

comment on column public.problem_types.output_format is 'AI question response structure prompt';
comment on column public.problem_types.review_prompt_template is 'AI-generated question review prompt';
