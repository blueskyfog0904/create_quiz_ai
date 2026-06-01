alter table public.problem_types
add column if not exists regeneration_prompt_template text;

comment on column public.problem_types.regeneration_prompt_template is 'Prompt appended when a generated question fails review and the generation API is asked to regenerate with prior question and review feedback context';
