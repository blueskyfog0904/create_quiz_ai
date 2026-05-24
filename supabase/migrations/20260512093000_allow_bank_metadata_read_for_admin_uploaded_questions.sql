-- Allow authenticated users to read question-bank metadata for admin-uploaded
-- questions that are already visible through the public.questions bank policy.
-- This keeps writes admin-only while allowing /bank filters and labels to use
-- question_bank_question_metadata.bank_problem_type_id under normal user RLS.

drop policy if exists "Authenticated users can view admin uploaded question bank metadata"
  on public.question_bank_question_metadata;

create policy "Authenticated users can view admin uploaded question bank metadata"
  on public.question_bank_question_metadata
  for select to authenticated
  using (
    exists (
      select 1
      from public.questions q
      where q.id = question_bank_question_metadata.question_id
        and q.source = 'admin_uploaded'
        and q.workspace_subject = question_bank_question_metadata.workspace_subject
    )
  );
