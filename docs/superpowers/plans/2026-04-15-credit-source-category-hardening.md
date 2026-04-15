# Credit Source Category Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the remaining classification risk in `/mypage/credits` by replacing inferred credit-source labels with explicit persisted source-category data on `credit_sources`.

**Architecture:** Add an explicit `source_category` field to `credit_sources`, backfill existing rows from trustworthy linked records, and update all source-creation paths to write the category directly. Then switch the mypage credit UI to render from `credit_sources.source_category` instead of inferring from `payment_history.payment_method`.

**Tech Stack:** Next.js App Router, TypeScript, Supabase Postgres migrations, Supabase generated types, Node test runner, ESLint

---

## File Map

### Create
- `supabase/migrations/<timestamp>_add_credit_source_category.sql` — add and backfill explicit source-category data
- `tests/credit-source-category.test.mjs` — regression tests for display mapping and backfill-facing logic (pure helper tests)

### Modify
- `src/types/supabase.ts` — sync generated types after migration
- `src/lib/credits.ts` — require/propagate explicit `sourceCategory` when creating `credit_sources`
- `src/lib/credit-source-display.ts` — switch to explicit source-category mapping instead of payment-method inference
- `src/app/(dashboard)/mypage/credits/page.tsx` — stop joining `payment_history` for source labels; read the explicit category from `credit_sources`
- `src/app/(dashboard)/mypage/credits/credits-client.tsx` — consume the explicit category field and keep refund gating rules clear
- `src/app/api/admin/users/credits/route.ts` — pass `admin_grant` category explicitly
- `src/app/api/credits/purchase/route.ts` — pass `plan_purchase` category explicitly
- `src/app/api/payments/confirm/route.ts` — pass `plan_purchase` category explicitly
- `tests/credit-source-display.test.mjs` — update existing label tests to target `sourceCategory`

---

### Task 1: Add explicit source-category storage and backfill legacy rows

**Files:**
- Create: `supabase/migrations/<timestamp>_add_credit_source_category.sql`
- Modify: `src/types/supabase.ts`

- [ ] **Step 1: Write the migration to add the new column and default**

```sql
alter table public.credit_sources
add column source_category text;

update public.credit_sources
set source_category = case
  when plan_id is not null then 'plan_purchase'
  else 'legacy_unknown'
end
where source_category is null;

alter table public.credit_sources
alter column source_category set not null;

alter table public.credit_sources
alter column source_category set default 'plan_purchase';

alter table public.credit_sources
add constraint credit_sources_source_category_check
check (source_category in (
  'plan_purchase',
  'admin_grant',
  'system_refund',
  'bonus',
  'legacy_unknown'
));
```

- [ ] **Step 2: Extend the migration with trustworthy backfill rules**

Use linked records in priority order so existing rows stop depending on UI inference:

```sql
update public.credit_sources cs
set source_category = 'admin_grant'
from public.payment_history ph
where ph.source_id = cs.id
  and ph.payment_method = 'admin_grant';

update public.credit_sources cs
set source_category = 'system_refund'
from public.payment_history ph
where ph.source_id = cs.id
  and ph.payment_method = 'system_refund';

update public.credit_sources cs
set source_category = 'bonus'
from public.credit_transactions ct
where ct.source_id = cs.id
  and ct.type = 'bonus';
```

- [ ] **Step 3: Run the migration on local/dev database**

Run: `npx supabase db push`

Expected: migration applies cleanly and `credit_sources.source_category` exists with no null rows.

- [ ] **Step 4: Regenerate Supabase TypeScript types**

Run:

```bash
npx supabase gen types typescript --project-id kzcweelnzhcmiuvjgeyi > src/types/supabase.ts
```

Expected: `credit_sources.Row/Insert/Update` include `source_category`.

- [ ] **Step 5: Verify type surface reflects the new field**

Run: `rg -n "source_category" src/types/supabase.ts`

Expected: matches in `credit_sources` row/insert/update definitions.

---

### Task 2: Write source-category explicitly at creation time

**Files:**
- Modify: `src/lib/credits.ts`
- Modify: `src/app/api/admin/users/credits/route.ts`
- Modify: `src/app/api/credits/purchase/route.ts`
- Modify: `src/app/api/payments/confirm/route.ts`

- [ ] **Step 1: Extend `CreditService.purchaseCredits` to accept a typed category parameter**

Update the signature and insert payload:

```ts
export type CreditSourceCategory =
  | 'plan_purchase'
  | 'admin_grant'
  | 'system_refund'
  | 'bonus'
  | 'legacy_unknown'

static async purchaseCredits(
  userId: string,
  planId: string | null,
  credits: number,
  price: number,
  paymentMethod: string = 'test',
  paymentKey?: string,
  sourceCategory: CreditSourceCategory = 'plan_purchase'
): Promise<{ sourceId: string; newBalance: number }> {
  // ...
  .insert({
    user_id: userId,
    plan_id: planId,
    initial_credits: credits,
    remaining_credits: credits,
    status: 'active',
    source_category: sourceCategory,
  })
}
```

- [ ] **Step 2: Update user-paid purchase paths to store `plan_purchase`**

Patch both purchase routes:

```ts
await CreditService.purchaseCredits(
  user.id,
  planId,
  plan.credits,
  plan.price,
  'test',
  undefined,
  'plan_purchase'
)
```

and

```ts
await CreditService.purchaseCredits(
  user.id,
  planId,
  plan.credits,
  plan.price,
  confirmData.method || 'card',
  paymentKey,
  'plan_purchase'
)
```

- [ ] **Step 3: Update admin credit grants to store `admin_grant`**

Patch the admin grant route:

```ts
await CreditService.purchaseCredits(
  userId,
  null,
  amount,
  0,
  'admin_grant',
  undefined,
  'admin_grant'
)
```

- [ ] **Step 4: Search for any remaining creation sites and classify them**

Run: `rg -n "purchaseCredits\(" src`

Expected: every call passes an explicit `sourceCategory`, or the call site is intentionally unreachable / updated.

- [ ] **Step 5: Type-check the creation-path changes**

Run: `npx tsc --noEmit`

Expected: no type errors from the new function signature or generated Supabase types.

---

### Task 3: Remove UI inference and render the explicit category in mypage credits

**Files:**
- Modify: `src/lib/credit-source-display.ts`
- Modify: `src/app/(dashboard)/mypage/credits/page.tsx`
- Modify: `src/app/(dashboard)/mypage/credits/credits-client.tsx`
- Modify: `tests/credit-source-display.test.mjs`
- Create: `tests/credit-source-category.test.mjs`

- [ ] **Step 1: Refactor display helper to use `sourceCategory` directly**

Replace payment-method inference with category-based logic:

```ts
export interface CreditSourceDisplayInput {
  status: 'active' | 'pending_refund' | 'refunded'
  plan: { name: string; price: number } | null
  sourceCategory: 'plan_purchase' | 'admin_grant' | 'system_refund' | 'bonus' | 'legacy_unknown'
}

function getNonPlanSourceLabel(sourceCategory: CreditSourceDisplayInput['sourceCategory']): string {
  switch (sourceCategory) {
    case 'admin_grant':
      return '관리자 지급'
    case 'system_refund':
      return '환불'
    case 'bonus':
      return '보너스'
    default:
      return '기타 지급'
  }
}
```

- [ ] **Step 2: Stop joining `payment_history` in the credits page**

Delete the temporary enrichment block and pass `sources` directly from `credit_sources`:

```ts
const { data: sources } = await supabase
  .from('credit_sources')
  .select(`
    *,
    plan:pricing_plans(name, price)
  `)
  .eq('user_id', user.id)
  .order('purchased_at', { ascending: false })

<CreditsClient
  balance={profile?.credits ?? 0}
  sources={sources || []}
  transactions={transactions || []}
  refundRequests={refundRequests || []}
/>
```

- [ ] **Step 3: Update the credits client to consume `sourceCategory` and keep the `구분` column**

Adjust the local source type and label usage:

```ts
interface CreditSource {
  id: string
  initial_credits: number
  remaining_credits: number
  status: 'active' | 'pending_refund' | 'refunded'
  purchased_at: string
  source_category: 'plan_purchase' | 'admin_grant' | 'system_refund' | 'bonus' | 'legacy_unknown'
  plan: { name: string; price: number } | null
}

const getSourceCategoryLabel = (source: CreditSource) => getCreditSourceCategoryLabel({
  status: source.status,
  plan: source.plan,
  sourceCategory: source.source_category,
})
```

Keep the existing refund restriction for non-plan sources:

```ts
if (!source.plan) return false
```

- [ ] **Step 4: Update and expand tests for the explicit category model**

Refresh `tests/credit-source-display.test.mjs` to target `sourceCategory` instead of `paymentMethod`, then add a focused regression test file for end-user labels:

```js
test('maps admin grant rows with no plan to 관리자 지급', () => {
  assert.equal(getCreditSourceCategoryLabel({
    status: 'active',
    plan: null,
    sourceCategory: 'admin_grant',
  }), '관리자 지급')
})

test('maps legacy unknown rows with no plan to 기타 지급', () => {
  assert.equal(getCreditSourceCategoryLabel({
    status: 'active',
    plan: null,
    sourceCategory: 'legacy_unknown',
  }), '기타 지급')
})
```

- [ ] **Step 5: Verify the UI path after removing inference**

Run:

```bash
npx eslint src/lib/credit-source-display.ts src/app/(dashboard)/mypage/credits/page.tsx src/app/(dashboard)/mypage/credits/credits-client.tsx tests/credit-source-display.test.mjs tests/credit-source-category.test.mjs
node --test tests/credit-source-display.test.mjs tests/credit-source-category.test.mjs tests/payment-history-filter.test.mjs
npx tsc --noEmit
```

Expected:
- ESLint: no errors (warnings acceptable only if pre-existing and documented)
- Node tests: PASS
- TypeScript: PASS

---

### Task 4: Validate migrated behavior with real data and document follow-up

**Files:**
- Modify: `src/app/(dashboard)/mypage/credits/page.tsx` (only if extra query fields are needed)
- Optional note: `docs/superpowers/plans/2026-04-15-credit-source-category-hardening.md` (checklist updates only)

- [ ] **Step 1: Inspect real source-category distribution after migration**

Run a quick SQL check (via Supabase SQL editor or trusted local flow):

```sql
select source_category, count(*)
from public.credit_sources
group by source_category
order by source_category;
```

Expected: no null `source_category`, and legacy rows are classified into concrete buckets or `legacy_unknown`.

- [ ] **Step 2: Manually inspect `/mypage/credits` with mixed data**

Checklist:
- `구분` shows `Basic` for normal plan purchases
- `구분` shows `Basic / 환불` for refunded plan purchases
- planless admin rows show `관리자 지급`
- legacy unknown rows show `기타 지급`
- non-plan rows do not offer active refund requests

- [ ] **Step 3: Record any backfill misses before broader rollout**

If unexpected labels remain, capture representative `credit_sources.id`, linked `payment_history.source_id`, and `credit_transactions.source_id` so a follow-up migration can refine `legacy_unknown` rows without reopening UI logic.

---

## Self-Review Checklist

- Covers schema, backfill, service writes, UI read path, tests, and manual verification
- Removes the current `payment_history` inference from `/mypage/credits`
- Keeps `/mypage/payments` behavior unchanged
- Leaves room for future category expansion without more UI fallbacks
