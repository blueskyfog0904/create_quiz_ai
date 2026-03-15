# Context Snapshot — generate-textbook-listboard-sync-v2

- Task statement: Design a sync-safe architecture for 문제생성 2-depth menus so that admin create/update/delete operations stay synchronized with actual generate listboards and posts, while preserving current personal generate flow.
- User concern: If `system_settings.header_navigation` remains JSON, admin changes to 문제생성 child menus may not stay synchronized with actual listboard business data. Need a stronger design and explicit verdict on whether to change `system_settings` structure or solve synchronization another way.
- Current code facts:
  - `src/lib/header-navigation-server.ts` reads/writes `system_settings` row `key='header_navigation'` as JSON.
  - `src/app/(admin)/admin/menu-management/actions.ts` saves the full header navigation JSON in one write.
  - `src/app/(dashboard)/generate/layout.tsx` and `generate-sidebar.tsx` render generate child menus directly from that JSON.
  - `src/app/(dashboard)/generate/[typeId]/page.tsx` assumes `typeId` is a `problem_types.id` UUID and renders current personal generate flow.
- Prior plan conclusion: keep `header_navigation` as presentation config and introduce relational `generate_listboards` / `generate_listboard_posts`, but this now needs a stronger synchronization design.
- New design question: choose between (A) changing `system_settings`/menu source of truth toward relational, or (B) keeping `system_settings` JSON but redesigning synchronization so menu management and listboards cannot drift.
- Constraints:
  - 개인지문 current flow should remain stable.
  - Non-personal 2-depth menus should be listboard-driven.
  - Need operationally safe admin create/update/delete behavior.
  - Need final plan validated by planner, architect, and three critics total (original + 2 extra) until they are satisfied.
