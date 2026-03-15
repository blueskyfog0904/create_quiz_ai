# Test Spec — Generate Menu Sync-Safe Rollout

## Acceptance Tests
1. `generate_menu_entries` rows render into header/sidebar under `/generate`.
2. General header save cannot mutate `/generate` children during hybrid fallback.
3. Personal menu points to `/generate` and existing `/generate/[typeId]` flow still works.
4. Mock-exams board page loads and filters by year/month/grade/title.
5. Post detail page lists active problem types.
6. Textbook generate page creates and saves a question.
7. Admin can create/update/archive generate menu entries.
8. Admin can create/update/archive listboard posts.
9. Listboard posts cannot reference `personal_generate` entry.
10. Full typecheck has no new errors in changed files; project baseline errors may remain outside touched scope.

## Manual QA Focus
- header preview and actual header/sidebar alignment
- inactive/archived generate menu rows hidden from user UI
- slug edit blocked when linked posts exist
- archived listboard rows remain out of user navigation
