# Worker 2 Investigation: `/admin/menu-management?subject=korean` market menu create 500

## Scope
Investigate why creating a `market_menu_entries` row such as `slug=mock-exams` from the Korean admin workspace returns a 500, and identify the minimal safe fix plus verification plan.

## Code path
- UI submit: `src/app/(admin)/admin/menu-management/menu-management-client.tsx`
- Server action: `src/app/(admin)/admin/menu-management/actions.ts`
- Insert/backfill logic: `src/lib/market-menu-server.ts`
- Repo migrations:
  - `supabase/migrations/20260317050500_create_market_menu_entries.sql`
  - `supabase/migrations/20260331091000_add_workspace_subject_foundation.sql`

### Current create path
`createMarketMenuEntry()` inserts:
- `workspace_subject: workspaceSubject`
- `entry_key: normalized.slug`
- `slug: normalized.slug`

It does **not** set any legacy `subject_code` column.

## Repo-schema finding
The repo migrations model `market_menu_entries` as workspace-scoped:
- original table creation used global `unique` on `entry_key` and `slug`
- later workspace migration added `workspace_subject`
- later workspace migration added unique indexes on:
  - `(workspace_subject, entry_key)`
  - `(workspace_subject, slug)`

The repo contains **no current code references** to `subject_code` for `market_menu_entries`.

## Live DB finding (actual project `kzcweelnzhcmiuvjgeyi`)
The live `public.market_menu_entries` schema contains extra legacy subject-scoped fields/indexes not represented in the repo migration path:

### Columns
- `subject_code text not null default 'english'`
- `workspace_subject text not null default 'english'`

### Unique indexes still present in live DB
- `uq_market_menu_entries_subject_entry_key` on `(subject_code, entry_key)`
- `uq_market_menu_entries_subject_slug` on `(subject_code, slug)` with `where deleted_at is null`
- `uq_market_menu_entries_workspace_entry_key` on `(workspace_subject, entry_key)`
- `uq_market_menu_entries_workspace_slug` on `(workspace_subject, slug)`

### Existing conflicting row
Live query for `slug = 'mock-exams'` returned:
- `subject_code = 'english'`
- `workspace_subject = 'english'`
- `deleted_at = null`

There are currently:
- 1 total market row: `(workspace_subject='english', subject_code='english')`
- 0 Korean rows

## Exact root cause
The current create path only sets `workspace_subject`.

Because the live DB still has legacy subject-scoped unique indexes and `subject_code` defaults to `'english'`, a Korean create attempt behaves like this:
- requested logical row: `(workspace_subject='korean', slug='mock-exams')`
- actual inserted legacy subject scope: `(subject_code='english', slug='mock-exams')`

That conflicts with the existing English row on the live index:
- `uq_market_menu_entries_subject_slug(subject_code, slug)`

So the 500 is caused by **schema drift between repo and live DB**:
1. live DB still enforces legacy `subject_code` uniqueness
2. application code no longer knows about `subject_code`
3. `subject_code` silently defaults to `'english'`
4. Korean inserts collide with English rows

## Secondary risk: backfill/upsert path
`backfillMarketMenuEntriesFromHeader()` currently does:

```ts
.upsert(payload, { onConflict: 'entry_key' })
```

This is unsafe against the live schema and also unsafe for the intended workspace-scoped schema:
- there is **no** unique index on bare `entry_key`
- live uniqueness is currently on `(subject_code, entry_key)` and `(workspace_subject, entry_key)`
- after fixing the create bug by removing legacy subject uniqueness, bare `entry_key` still remains the wrong conflict target

### Consequence
Backfill can fail with an ON CONFLICT target mismatch, or accidentally depend on the wrong legacy uniqueness if the environment drifts again.

## Minimal safe fix
### 1) Align schema to workspace scope
Add a corrective migration for `market_menu_entries` that:
- drops legacy subject-scoped indexes:
  - `uq_market_menu_entries_subject_entry_key`
  - `uq_market_menu_entries_subject_slug`
- removes `subject_code` from this table if it is truly obsolete for this domain, **or** at minimum stops relying on it for uniqueness
- preserves workspace-scoped uniqueness:
  - `uq_market_menu_entries_workspace_entry_key`
  - `uq_market_menu_entries_workspace_slug`

### 2) Fix the backfill conflict target
Change:
```ts
.upsert(payload, { onConflict: 'entry_key' })
```
To:
```ts
.upsert(payload, { onConflict: 'workspace_subject,entry_key' })
```

If slug-based reconciliation is preferred, use the workspace-scoped slug index explicitly, but current backfill payload and legacy mapping are key-based, so `workspace_subject,entry_key` is the minimal correction.

### 3) Optional hardening
Improve `normalizeMarketMenuEntriesWriteError()` to map duplicate-key violations into a clear admin-facing message instead of raw Postgres text.

## Important follow-up note
`generate_menu_entries` in the live DB shows the **same legacy shape**:
- legacy `subject_code` indexes still exist
- new `workspace_subject` indexes also exist
- code uses workspace scope and backfill also upserts with `onConflict: 'entry_key'`

That likely represents the same latent bug class in the generate menu domain.

## Recommended verification plan
### Static/code verification
1. Confirm create path still passes `workspaceSubject` from admin UI to server action to insert helper.
2. Confirm corrective migration removes legacy subject uniqueness for `market_menu_entries`.
3. Confirm backfill uses `onConflict: 'workspace_subject,entry_key'`.

### DB verification
Run after migration:
1. `pg_indexes` for `market_menu_entries` no longer shows `uq_market_menu_entries_subject_*`
2. `information_schema.columns` confirms either:
   - `subject_code` removed, or
   - retained only as non-uniqueness legacy data with no active conflicting indexes

### Functional verification
1. From `/admin/menu-management?subject=english`, create `mock-exams` (or use existing row)
2. From `/admin/menu-management?subject=korean`, create `mock-exams`
3. Expect both rows to coexist because uniqueness is workspace-scoped
4. Run market backfill in both English and Korean workspaces and confirm no `ON CONFLICT` error
5. Confirm dashboard reads remain workspace-filtered (`eq('workspace_subject', ...)`)

## Suggested automated regression coverage for leader implementation
- server-level test for create helper proving same slug can exist in English and Korean scopes
- server-level test for backfill ensuring upsert conflict target is workspace-scoped
- if DB integration tests are unavailable, add focused tests around query-builder calls / mocked Supabase interactions plus migration review notes

## Evidence summary
- Repo code writes `workspace_subject`, not `subject_code`
- Live DB still contains `subject_code` column + unique indexes
- Existing English `mock-exams` row is present
- Korean create would inherit `subject_code='english'` default and collide on legacy uniqueness
- Backfill currently uses an invalid/stale conflict target (`entry_key`)
