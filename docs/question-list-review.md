# Review & Documentation: Question List (verbose 1:designer 1:executor 테스트)

## Scope Reviewed
- `src/components/features/bank/question-list.tsx`

## Findings
1. The new `problem_type` label is displayed with a badge (`문제유형`) using `question.problem_types?.type_name` and falls back to `미분류`.
2. `scale` prop in `QuestionItem` is currently unused in the component body, which triggers a lint warning (`@typescript-eslint/no-unused-vars`).
3. There are still pre-existing lint/typecheck issues across the repository unrelated to this change.
4. `CreateExamDialog` currently accepts an empty title and relies on downstream API validation.

## Suggested follow-ups
- Consider removing the unused `scale` prop from `QuestionItem` or using it for responsive styling to satisfy lint.
- Add validation in `CreateExamDialog` for empty/whitespace `title` before submitting.
- Keep an eye on repository-wide lint/typecheck failures before final merge.

## Verification run for this review
- `npm run lint` ❌ (fails due baseline errors, no direct change in this task)
- `npm run test` ❌ (script not defined)
- `npx tsc --noEmit` ❌ (fails in existing `src/app/api/admin/problem-types/route.ts`)
