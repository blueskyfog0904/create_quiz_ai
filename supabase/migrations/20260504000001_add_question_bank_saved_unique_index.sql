-- Prevent duplicate saved question-bank copies per user/workspace/original.
-- If this preflight raises DUPLICATE_SAVED_QUESTIONS_EXIST, cleanup duplicate from_community rows
-- by retaining one row for each (user_id, workspace_subject, shared_question_id) group before rerunning.

do $$
begin
  if exists (
    select 1
    from public.questions
    where source = 'from_community' and shared_question_id is not null
    group by user_id, workspace_subject, shared_question_id
    having count(*) > 1
  ) then
    raise exception using errcode = '23505', message = 'DUPLICATE_SAVED_QUESTIONS_EXIST';
  end if;
end $$;

create unique index if not exists idx_questions_from_community_unique_saved
  on public.questions(user_id, workspace_subject, shared_question_id)
  where source = 'from_community' and shared_question_id is not null;
