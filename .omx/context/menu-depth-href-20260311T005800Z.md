# Task Snapshot: menu-depth-href

- Task: In admin menu management, make depth-2 menu links inherit the depth-1 path.
- Desired outcome: If a parent menu has `/generate` and a child is entered as `/textbook`, the effective child route becomes `/generate/textbook`.
- Known facts:
  - Menu management UI is `src/app/(admin)/admin/menu-management/menu-management-client.tsx`.
  - Shared config helpers are in `src/lib/header-navigation.ts`.
  - Header rendering uses `child.href` directly today in `src/components/layout/header.tsx` and `src/components/layout/header-client.tsx`.
  - Current logic erases parent `href` when children exist.
- Constraints:
  - Keep existing 2-depth architecture.
  - Follow project style: TypeScript, 2 spaces, single quotes, no semicolons.
- Unknowns/open questions:
  - Best UX for displaying raw child segment vs. resolved full path.
  - How to treat external URLs and already fully-qualified nested paths.
- Likely touchpoints:
  - `src/app/(admin)/admin/menu-management/menu-management-client.tsx`
  - `src/lib/header-navigation.ts`
  - `src/components/layout/header.tsx`
  - `src/components/layout/header-client.tsx`
