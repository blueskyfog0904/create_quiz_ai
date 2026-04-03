# Worker 2 Follow-up: generate menu regression scope and post-patch verification

## Finding
`generate_menu_entries` has the same latent schema-drift bug class as `market_menu_entries`.

### Code path
- `src/lib/generate-menu-server.ts`
  - `createGenerateMenuEntry()` writes `workspace_subject`, `entry_key`, `slug`, `entry_type`, etc.
  - it does **not** write legacy `subject_code`
  - `backfillGenerateMenuEntriesFromHeader()` still uses:
    ```ts
    .upsert(payload, { onConflict: 'entry_key' })
    ```

### Live DB evidence
Live `public.generate_menu_entries` still has:
- column `subject_code text not null default 'english'`
- column `workspace_subject text not null default 'english'`
- unique indexes:
  - `uq_generate_menu_entries_subject_entry_key` on `(subject_code, entry_key)`
  - `uq_generate_menu_entries_subject_slug` on `(subject_code, slug)` where `deleted_at is null`
  - `uq_generate_menu_entries_workspace_entry_key` on `(workspace_subject, entry_key)`
  - `uq_generate_menu_entries_workspace_slug` on `(workspace_subject, slug)`

Existing English rows already include:
- `personal`
- `mock-exams`
- `textbook`
- `entlec`
- `subtextbook`

## Regression scope
If only `market_menu_entries` is patched and `generate_menu_entries` is not:

1. **Korean generate-menu create remains broken**
   - a Korean create of `mock-exams` or `textbook` still defaults `subject_code='english'`
   - it collides with the existing English row on `uq_generate_menu_entries_subject_slug`

2. **Korean personal-generate create/backfill is also at risk**
   - `createGenerateMenuEntry()` forces `personal_generate` slug to `personal`
   - Korean create/backfill of the personal entry would collide with existing English `personal`

3. **Generate backfill remains wrong even after schema cleanup if only indexes are fixed**
   - `onConflict: 'entry_key'` does not match the intended scoped uniqueness
   - it should be workspace-scoped (`workspace_subject,entry_key`) to remain correct once legacy subject uniqueness is removed

## Minimal expectation for the leader patch
For both `market_menu_entries` and `generate_menu_entries`:
1. remove legacy `subject_code` uniqueness from the affected menu table
2. preserve workspace-scoped uniqueness
3. update backfill upsert conflict target to `workspace_subject,entry_key`

## Exact post-patch verification commands / evidence

### 1) Schema verification SQL
Run for both tables after migration:

```sql
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('generate_menu_entries', 'market_menu_entries')
order by tablename, indexname;
```

Expected evidence:
- no `uq_*_subject_entry_key`
- no `uq_*_subject_slug`
- yes `uq_*_workspace_entry_key`
- yes `uq_*_workspace_slug`

Optional column verification:

```sql
select table_name, column_name, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('generate_menu_entries', 'market_menu_entries')
  and column_name in ('subject_code', 'workspace_subject')
order by table_name, column_name;
```

Expected evidence:
- either `subject_code` removed from these domains, or retained without uniqueness responsibility

### 2) Data coexistence verification SQL
After creating Korean rows, verify English + Korean can coexist for the same slugs:

```sql
select workspace_subject, slug, entry_key, deleted_at
from public.generate_menu_entries
where slug in ('personal', 'mock-exams', 'textbook', 'entlec', 'subtextbook')
order by slug, workspace_subject;

select workspace_subject, slug, entry_key, deleted_at
from public.market_menu_entries
where slug in ('mock-exams')
order by slug, workspace_subject;
```

Expected evidence:
- same slug appears once for `english` and once for `korean`
- no duplicate rows within the same workspace

### 3) Admin UI/manual verification
#### Generate menu
- open `/admin/menu-management?subject=english`
- open `/admin/menu-management?subject=korean`
- in Korean workspace, create or backfill rows matching existing English slugs:
  - `personal` (implicit via personal_generate or backfill)
  - `mock-exams`
  - `textbook`
  - `entlec`
  - `subtextbook`
- expect success, not 500

#### Market menu
- open `/admin/menu-management?subject=korean`
- create `mock-exams`
- expect success, not 500

### 4) Backfill verification
Run the header backfill action in both workspaces for both domains.

Expected evidence:
- no `ON CONFLICT` error
- rerunning backfill is idempotent
- no extra duplicates created in the same workspace

Suggested SQL evidence after rerun:

```sql
select workspace_subject, slug, count(*)
from public.generate_menu_entries
where deleted_at is null
group by workspace_subject, slug
having count(*) > 1;

select workspace_subject, slug, count(*)
from public.market_menu_entries
where deleted_at is null
group by workspace_subject, slug
having count(*) > 1;
```

Expected evidence:
- zero rows returned

### 5) Static verification
- `npx tsc --noEmit`
- `npm run lint` (currently repo has unrelated baseline failures; capture separately)

## Recommendation
Treat the fix as a two-table regression patch, not a market-only patch. Otherwise the same Korean create/backfill failure will remain in `generate_menu_entries`, including the `personal` entry path.
