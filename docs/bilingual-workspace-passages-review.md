# Bilingual Workspace Passages Lane Review

## Scope Reviewed
- `src/app/api/passages/actions.ts`
- `src/app/library/mypassages/page.tsx`
- `src/app/library/mypassages/passage-list-container.tsx`
- `src/components/features/passages/**`

## Review Summary
- Passage CRUD, tag lookup, and library reads now use the Team Run 1 `workspace_subject` contract instead of relying on globally English behavior.
- Passage revalidation now expands through `workspaceRevalidatePaths('libraryMypassages')`, which keeps invalidation aligned with the workspace routing helper contract.
- Passage UI entry points derive workspace from route params or pathname and fall back to English only for pre-cutover unscoped routes.
- A narrow helper test was added for passage workspace resolution and canonical library href generation.

## Code Quality Notes
1. The passages lane now reuses the shared workspace helpers from the foundation commit rather than introducing a local subject/context API.
2. Low-value lint noise in touched passage components was reduced by removing unused imports and unused caught error bindings.
3. Existing React hook dependency warnings remain in some older passage components; they were not expanded in this review because the current lane change was focused on workspace isolation, not broader client-state refactors.

## Remaining Follow-ups
- If Team Run 2 adds more passage-specific routes, keep using `resolvePassageWorkspaceSubject()` and `workspaceRevalidatePaths()` instead of hard-coded `/library/mypassages` assumptions.
- If the app later exposes scoped source-config APIs, the passage UI should prefer those over the current shared admin source-config endpoint.
- Consider a future cleanup pass for the remaining passage-component lint warnings that predate this review.

## Verification
- `node --test --import ./src/components/features/passages/node-test-register.mjs ./src/components/features/passages/workspace-subject.test.ts` — PASS
- `npx tsc --noEmit` — PASS
- `npx eslint src/app/api/passages/actions.ts src/app/library/mypassages/page.tsx src/app/library/mypassages/passage-list-container.tsx src/components/features/passages/workspace-subject.ts src/components/features/passages/workspace-subject.test.ts src/components/features/passages/passage-selector.tsx src/components/features/passages/ocr-result-view.tsx src/components/features/passages/passage-selector-modal.tsx src/components/features/passages/passage-register-modal.tsx src/components/features/passages/passage-detail-modal.tsx src/components/features/passages/tag-input.tsx` — PASS with remaining warnings only
- `npm run build` — PASS
