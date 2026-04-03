# Worker 4 - Verification & Regression Scope

## Observed codebase facts
- Workspace library sidebar renders only `libraryMenu.children`; if the library parent has no children, the sidebar disappears. (`src/app/[workspaceSubject]/library/layout.tsx`)
- Workspace market sidebar renders only `marketMenu.children`; if market children collapse to a single direct link or empty array, grouped sidebar UX disappears. (`src/app/[workspaceSubject]/market/layout.tsx`)
- Desktop header renders a dropdown whenever a top-level item has `children.length > 0`; otherwise it renders a direct link. (`src/components/layout/header-shell-client.tsx`)
- Mobile header renders child sections only when `item.children.length > 0`; otherwise it renders the parent as a direct button. (`src/components/layout/header-client.tsx`)
- Admin menu management already treats `/generate` and `/market` second-level menus as DB-managed, but `/library` remains fallback/header-config-driven. (`src/app/(admin)/admin/menu-management/menu-management-client.tsx`, `src/app/(admin)/admin/menu-management/actions.ts`)
- Menu save/reorder/create/update actions already revalidate `/`, `/generate`, `/market`, and `/library/purchased`, but not the full library subtree. (`src/app/(admin)/admin/menu-management/actions.ts`)

## Why the current Korean market can appear flat
- The header and sidebars infer grouped UX strictly from the presence of child items.
- If Korean market navigation resolves to a parent `/market` item with zero children or a single direct route not preserved as a child node, both desktop/mobile header and sidebar fall back to flat-link behavior.

## Plan-level acceptance criteria

### A. Market single-child grouped UX
1. Korean market navigation preserves a top-level market parent plus at least one second-level child node even when only one visible child exists.
2. Desktop header shows the Korean market parent as a dropdown trigger, not a direct navigable top-level link, when grouped mode is expected.
3. Mobile header shows the Korean market parent as a labeled section with child entries, not a single direct button, when grouped mode is expected.
4. Workspace market sidebar renders a grouped panel for the Korean market even when only one visible child exists.
5. Only the second-level child is the clickable destination in grouped mode; clicking the parent trigger itself must not navigate unexpectedly.

### B. English/Korean library second-level admin CRUD
1. `/admin/menu-management?subject=english` exposes library second-level menu CRUD and visibility controls.
2. `/admin/menu-management?subject=korean` exposes the same library second-level menu CRUD and visibility controls independently per workspace subject.
3. Library child creation/edit/reorder/archive/visibility updates change the library header/sidebar output for the matching subject only.
4. Library child href/path generation remains deterministic and consistent with current workspace route conventions.
5. Hidden/inactive library children do not appear in header dropdowns, mobile menus, or library sidebars.

### C. Header + sidebar consistency
1. Desktop header, mobile header, and sidebar consume the same effective child set for each subject and section.
2. Menu order is preserved across desktop header, mobile header, and sidebar.
3. Subject switching (English/Korean) does not leak the other subject's library or market child set.
4. Existing generate/market admin-managed second-level menus remain unaffected by the library change.

### D. Revalidation/cache behavior
1. Admin mutations affecting library second-level menus visibly update the corresponding subject's header/sidebar without manual cache busting.
2. Admin mutations affecting market second-level menus continue to update both English and Korean market surfaces correctly.
3. Revalidation covers all library routes whose layouts derive navigation from header/menu config, not only `/library/purchased`.

## Concrete verification steps

### Manual / E2E checks
1. Open English workspace header and library page; record current desktop header, mobile sheet, and library sidebar items.
2. Open Korean workspace header and market page with exactly one visible market child; verify grouped dropdown/sidebar behavior still appears.
3. In admin menu management (English), create a library child, toggle visibility off/on, reorder it, and verify desktop header, mobile menu, and library sidebar all reflect the change.
4. Repeat the same CRUD flow for Korean library children; verify English menus remain unchanged.
5. Archive a library child and verify it disappears from all user-facing navigation surfaces.
6. Reorder market child entries and verify Korean single-child grouped mode still uses child navigation rather than parent navigation.
7. Test subject toggle transitions between English and Korean from a page under `/[workspaceSubject]/library/*` and `/[workspaceSubject]/market/*`.
8. Validate parent trigger behavior: top-level market/library grouped parents should open menu sections/dropdowns and should not perform accidental navigation when child-only clickability is intended.

### Suggested automated coverage
1. Unit tests for navigation normalization/merge helpers:
   - grouped mode preserved with one visible child
   - hidden/inactive children filtered consistently
   - subject-specific child sets stay isolated
2. Component tests for:
   - desktop header rendering dropdown vs direct link
   - mobile menu rendering section vs direct button
   - library/market sidebar rendering child list from effective config
3. Server/action tests for admin mutations:
   - library CRUD persists per subject
   - reorder/visibility/archive semantics
   - revalidation path list includes affected library routes/layouts

## Regression watchlist
- `/generate` child management behavior must remain unchanged.
- Existing market DB backfill/status flows must continue working.
- Legacy library fallback children for subjects without custom library entries must still render until replaced by the new source of truth.
- Route resolution via `resolveHeaderMenuHref` and workspace prefixing must not generate broken nested paths.
- Logged-out behavior should still hide library access where intended while preserving logged-in subject navigation.

## File-level touchpoints likely needing verification attention
- `src/lib/header-navigation.ts`
- `src/components/layout/header-shell-client.tsx`
- `src/components/layout/header-client.tsx`
- `src/app/[workspaceSubject]/library/layout.tsx`
- `src/app/[workspaceSubject]/market/layout.tsx`
- `src/app/(dashboard)/library/library-sidebar.tsx`
- `src/app/(dashboard)/market/market-sidebar.tsx`
- `src/app/(admin)/admin/menu-management/actions.ts`
- `src/app/(admin)/admin/menu-management/menu-management-client.tsx`
