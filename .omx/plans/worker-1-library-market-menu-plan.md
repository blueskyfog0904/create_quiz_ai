# Worker 1 plan: library + market second-level menu analysis

## Scope
Analyze why Korean market/mock-exam style navigation appears flat, and propose a safe implementation plan for:
1. subject market/library side navigation rendering as grouped second-level navigation even when there is only one child, with only the second-level child clickable
2. admin-manageable English/Korean library second-level menu CRUD + visibility controls in `/admin/menu-management`

## Evidence-based findings

### 1) Header already supports dropdown menus with a single child
- `src/components/layout/header-shell-client.tsx` renders a dropdown whenever `item.children.length > 0`.
- `src/components/layout/header-client.tsx` mobile nav also treats any parent with children as a grouped section.
- Therefore the reported “flat single link” behavior is **not** primarily in the header.

### 2) The flat UX gap is in left sidebars, not header
- `src/app/(dashboard)/library/library-sidebar.tsx`
- `src/app/(dashboard)/market/market-sidebar.tsx`
- `src/app/(dashboard)/generate/generate-sidebar.tsx`

All three sidebar components currently render only a flat list of clickable second-level items. They do not render a non-clickable group row for the parent. So when there is only one child, the screen reads as a single flat link rather than a grouped second-level menu.

### 3) Current library source of truth is workspace header JSON with fallback defaults
- `src/lib/header-navigation.ts`
  - `createLibraryChildren()` hardcodes fallback library children
  - `withWorkspaceHeaderDefaults()` injects fallback library children when `/library` has no children
- `src/lib/header-navigation-server.ts`
  - base config comes from workspace-scoped `workspace_settings.header_navigation`
  - generate + market DB children are merged in afterward
- `src/app/[workspaceSubject]/library/layout.tsx`
  - library sidebar is built from merged header navigation children

Implication: library children currently live inside header JSON, unlike generate/market which have dedicated DB tables.

### 4) Existing admin patterns already separate “general header editing” from DB-managed child menus
- `/admin/menu-management` currently treats `/generate` and `/market` as managed-child parents via `MANAGED_CHILD_PARENT_HREFS = ['/generate', '/market']`
- separate CRUD UI + server actions already exist for:
  - `generate_menu_entries`
  - `market_menu_entries`
- child preservation is already handled by `preserveDbManagedParentChildren(..., ['/generate', '/market'])`
- child merge strategy is generalized in `src/lib/db-managed-header.ts`

Implication: library can safely follow the same architecture instead of overloading header JSON further.

## Why Korean market can look flat today
The Korean workspace header can already have a parent `/market` with children, but the left sidebar renders only `marketMenu.children` as direct links. Even if there is exactly one DB child, the sidebar still appears as a lone flat item because there is no non-clickable grouped parent row or collapsible container.

## Source-of-truth options for library children

### Option A — keep library children inside `workspace_settings.header_navigation` JSON
**Pros**
- smallest schema change
- reuses current library read path immediately

**Cons**
- inconsistent with generate/market architecture
- admin UI must keep mixing generic header editing with library child-specific rules
- harder to add per-child metadata later
- harder to enforce workspace-safe uniqueness / ordering / visibility invariants
- harder to preserve children cleanly if header JSON is edited concurrently

### Option B — add dedicated `library_menu_entries` table and merge into header config like market/generate
**Pros**
- consistent with existing DB-managed child pattern
- natural place for workspace-scoped ordering, visibility, active state, slug/href metadata
- easier `/admin/menu-management` UX: `/library` becomes another managed-child section
- safer long term because header JSON remains parent-level shell config, while child collections live in typed tables
- reuses `db-managed-header.ts` merge/preserve approach with minimal conceptual novelty

**Cons**
- requires migration + server helpers + admin section
- route model must decide whether entries are slug-based or fixed-system-route-based

### Recommendation
**Choose Option B: dedicated DB-managed `library_menu_entries` table.**

Reason: generate and market already established the project’s safest pattern for managed second-level menus. Extending that pattern to library is lower-risk than keeping a one-off JSON-only child model.

## Recommended library table shape
Prefer a table conceptually parallel to market/generate, but tuned for fixed internal destinations:
- `workspace_subject`
- compatibility `subject_code` only if live DB still requires it during transition
- `entry_key` (stable internal key)
- `title`
- `href` or `route_key`
- `sort_order`
- `is_visible`
- `is_active`
- optional `description`
- timestamps / soft delete

### route modeling recommendation
Use **explicit internal hrefs or a constrained route_key enum**, not free-form external URLs.

Likely initial allowed destinations:
- `/library/mypassages`
- `/library/purchased`
- `/library/exam-papers`
- `/library/market`

Safer variant:
- store `route_key` (`mypassages`, `purchased`, `exam-papers`, `market`)
- derive href in code

This prevents broken admin-created routes and matches current system-like library semantics.

## Sidebar UX recommendation
Use a **shared sidebar group component** for generate / market / library instead of bespoke flat lists.

### Why shared component is recommended
- all three sidebars have nearly identical layout and active-state logic
- requested UX change applies across multiple domains
- ensures identical behavior when child count is 1 or many
- reduces duplicate maintenance across:
  - `src/app/(dashboard)/generate/generate-sidebar.tsx`
  - `src/app/(dashboard)/market/market-sidebar.tsx`
  - `src/app/(dashboard)/library/library-sidebar.tsx`

### recommended behavior
- render a non-clickable parent group header in the sidebar
- render child links nested beneath it
- if only one child exists, still keep the parent group visible so the UI reads as “parent > child” rather than a flat single link
- optionally add collapsible behavior, but default-expanded is the safer first step

### Recommendation detail
Start with **shared grouped sidebar, always expanded**.
Add collapsible behavior only if product explicitly wants progressive disclosure. Collapsible state is extra complexity and not required to satisfy the request.

## File-level touchpoints

### Read/merge/navigation
- `src/lib/header-navigation.ts`
- `src/lib/header-navigation-server.ts`
- `src/lib/db-managed-header.ts`
- `src/app/[workspaceSubject]/library/layout.tsx`
- `src/app/[workspaceSubject]/market/layout.tsx`
- `src/app/[workspaceSubject]/generate/layout.tsx`
- `src/components/layout/header-shell-client.tsx`
- `src/components/layout/header-client.tsx`

### Existing sidebar implementations to consolidate
- `src/app/(dashboard)/library/library-sidebar.tsx`
- `src/app/(dashboard)/market/market-sidebar.tsx`
- `src/app/(dashboard)/generate/generate-sidebar.tsx`

### Admin menu management
- `src/app/(admin)/admin/menu-management/actions.ts`
- `src/app/(admin)/admin/menu-management/menu-management-client.tsx`
- `src/app/(admin)/admin/menu-management/page.tsx`

### New likely library menu server/client helpers
- `src/lib/library-menu.ts` (new)
- `src/lib/library-menu-server.ts` (new)

### DB / types
- `supabase/migrations/*create_library_menu_entries*.sql` (new)
- maybe compatibility migration mirroring recent subject/workspace fixes
- `src/types/supabase.ts` regeneration/update

## Migration implications
1. create `library_menu_entries` with workspace-scoped uniqueness
2. if live DB still has legacy subject-scoped compatibility requirements, mirror the current menu-table compatibility approach deliberately instead of assuming clean schema
3. backfill English and Korean defaults from current effective library children
4. switch library merge path from JSON children to DB-managed children
5. preserve `/library` parent in header JSON, but stop treating its children as authoritative
6. update admin UI so `/library` joins managed-child parents and generic child editor no longer mutates library children directly

## UX / delivery risks
- if library children remain editable in generic JSON and new DB section simultaneously, admins can face conflicting sources of truth
- free-form href editing would create broken routes; constrain values
- if sidebar refactor changes active-state behavior, generate/market regressions are possible
- if backfill uses wrong conflict target, bilingual duplicates/collisions can recur (same lesson as generate/market)

## Recommended implementation sequence
1. add shared grouped sidebar component and migrate generate/market/library to it
2. add library DB schema + server helpers
3. merge library DB children into header config after base config load
4. update `/admin/menu-management` to treat `/library` as managed-child parent
5. backfill defaults for english/korean
6. remove generic library child editing path from admin UI

## Verification plan
### Static
- `npx tsc --noEmit`
- `npm run lint`

### Functional
1. Header desktop/mobile: parent with exactly 1 child still renders grouped dropdown/section
2. Sidebar: `/generate`, `/market`, `/library` all render parent group + nested child links even with one child
3. Admin English workspace can create/reorder/hide library children
4. Admin Korean workspace can create/reorder/hide library children independently
5. `/english/library/*` and `/korean/library/*` resolve correct visible child sets
6. hiding the only child still preserves non-clickable parent shell without exposing dead links

### Regression
- generate and market managed-child CRUD still works
- generic header save does not overwrite DB-managed children for `/generate`, `/market`, `/library`
- backfill is idempotent per workspace

## Interim recommendation to leader
- Anchor the user-facing bug explanation on sidebar behavior, not header dropdown behavior.
- Recommend a shared grouped sidebar component.
- Recommend dedicated DB-managed library children rather than continuing JSON-only library child management.
