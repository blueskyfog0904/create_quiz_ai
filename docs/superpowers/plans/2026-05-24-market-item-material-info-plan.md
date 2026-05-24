# Market Item Material Info Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 문제마켓 상세 페이지의 `시험 정보`/`출처` 2카드 영역을 `자료 정보` 단일 카드로 바꾸고, 관리자 문제마켓 상품 등록/수정 화면에서도 `과목`, `학년`, `출처`, `자료유형`, `문항 수`, `등록일자` 기준 정보를 입력·확인할 수 있게 한다.

**Architecture:** `market_items`에 `question_count`를 추가해 문항 수를 명시 저장하고, 이미 존재하는 `source_type`, `source_1~source_4`, `grade_level`, `created_at`, `workspace_subject`를 관리자 입력/확인 UI와 상세 페이지 표시 UI에서 같은 의미로 사용한다. 기존 좌측 콘텐츠/우측 파일 선택 sticky 레이아웃은 유지하고, 상세 페이지의 `시험 정보 + 출처` 내부 2열 카드만 `자료 정보` full-width 카드 하나로 교체한다.

**Tech Stack:** Next.js App Router Server Component, TypeScript, Tailwind CSS, Node built-in test runner, ESLint, Playwright/Browser manual verification.

---

## 0. 요청사항 파악 → 계획 작성 → 검증 Loop

### 요청사항 파악
- 현재 문제마켓 상세 페이지에는 좌측 콘텐츠 영역 안에 `시험 정보` 카드와 `출처` 카드가 나란히 표시된다.
- 요청 변경:
  - `시험 정보` 제목을 `자료 정보`로 변경한다.
  - 표시 항목을 `과목`, `학년`, `출처`, `자료유형`, `문항 수`, `등록일자`로 교체한다.
  - 별도 `출처` 카드는 제거한다.
  - 기존 `시험 정보`와 `출처` 카드가 차지하던 너비를 합쳐 `자료 정보` 카드 하나가 좌측 콘텐츠 전체 폭을 사용하게 한다.

### 코드 분석 결과
- 대상 UI는 `src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx` 안에 직접 렌더링되어 있다.
- 현재 정보 카드 구조:
  - `div className="grid gap-4 md:grid-cols-2"`
  - 첫 카드 제목 `시험 정보`
  - 둘째 카드 제목 `출처`
- 사용 가능한 기존 데이터:
  - 과목: `item.workspace_subject` → `영어` / `국어`
  - 학년: `item.grade_level || '-'`
  - 출처: `collectSources(item)`가 반환하는 `source_1~source_4` 병합값
  - 자료유형: `item.source_type || category.title || '-'`
  - 등록일자: `formatDate(item.created_at)`
- 관리자 등록 화면에는 현재 `학년`, `연도`, `월`은 있지만 `자료유형(source_type)`, `출처(source_1~source_4)`, `문항 수` 입력 UI가 없다.
- 관리자 API와 서버 저장 계층은 `source_type`, `source_1~source_4`를 이미 받을 수 있으나, 클라이언트 form state와 request body에 연결되어 있지 않다.
- `market_items`에는 `문항 수` 전용 컬럼이 없다. 관리자에서 동일하게 입력하려면 `question_count integer` 컬럼을 추가하고, 상세 페이지는 `item.question_count`를 우선 표시해야 한다.

### 멀티에이전트 검증 반영
- **analyst:** `문항 수` 전용 필드가 없으므로 샘플 페이지 수와 혼동하지 않아야 하며, 관리자 입력 요구가 추가되면 `question_count` 컬럼을 두는 편이 안전하다.
- **architect:** 상세 표시 helper는 페이지 로컬 함수로 유지하되, 관리자 입력 저장을 위해 DB/API/client form 경로는 한 번에 연결한다.
- **planner:** 계약 테스트는 `자료 정보` 단일 카드, 6개 라벨, 별도 `출처` 카드 부재, 기존 파일 선택 패널 보존을 검증한다.
- **critic:** `과목`, `자료유형`, `문항 수` 매핑 기준을 계획에 명시해야 하며 구매/샘플 CTA 회귀를 피해야 한다.

### 검증 통과 조건
1. `node --test tests/market-products-admin-material-info-contract.test.mjs tests/market-item-detail-ui-contract.test.mjs`가 RED → GREEN 흐름을 거친다.
2. `자료 정보` 카드가 6개 라벨을 포함한다.
3. 별도 `출처` 카드와 기존 `시험 회차`, `출제 타입`, `카테고리`, `보유 상태` 정보 카드 항목이 사라진다.
4. `파일 선택`, 샘플 미리보기, PDF/HWP 구매 버튼 관련 계약은 유지된다.
5. 브라우저에서 상세 페이지 좌측 영역의 `자료 정보` 카드가 기존 두 카드 너비를 합친 형태로 표시된다.
6. 관리자 문제마켓 상품 등록/수정 화면에서 `자료 정보` 입력 영역이 보이고 `자료유형`, `출처 1~4`, `문항 수`를 저장 요청에 포함한다.
7. `question_count` migration, Supabase 타입, 관리자 POST/PATCH API, 서버 저장 계층, 상세 표시가 같은 필드명을 사용한다.

---

## File Structure

### Modify
- `supabase/migrations/20260524020000_add_market_item_question_count.sql`
  - `market_items.question_count` 컬럼과 non-negative check constraint 추가
- `src/types/supabase.ts`
  - `market_items` Row/Insert/Update 타입에 `question_count` 반영
- `src/lib/market-items-server.ts`
  - `createMarketItem`, `updateMarketItem` 입력/저장 payload에 `question_count` 반영
- `src/app/api/admin/market/items/route.ts`
  - POST schema/request mapping에 `questionCount` 반영
- `src/app/api/admin/market/items/[id]/route.ts`
  - PATCH schema/request mapping에 `questionCount` 반영
- `src/app/(admin)/admin/market/products/market-products-client.tsx`
  - 상품 등록/수정 form state에 `sourceType`, `source1~source4`, `questionCount` 추가
  - 관리자 입력 UI에 `자료 정보` 섹션 추가
  - request body에 `sourceType`, `source1~source4`, `questionCount` 포함
- `src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx`
  - `formatExamLabel` 제거
  - `resolveWorkspaceSubjectLabel`, `resolveQuestionCountLabel`, `formatSourcesLabel` 로컬 helper 추가
  - 기존 `시험 정보 + 출처` 2카드 블록을 `자료 정보` 단일 카드로 교체
- `tests/market-item-detail-ui-contract.test.mjs`
  - 상세 정보 카드 계약 테스트 추가/갱신
  - 기존 파일 선택/구매/샘플 계약은 유지
- `tests/market-products-admin-material-info-contract.test.mjs`
  - 관리자 등록 입력, API 저장, schema/type 계약 테스트 추가

### Do Not Modify
- 구매/다운로드/샘플 API
- `MarketItemActions` 구매/샘플 버튼 로직
- 문제마켓 목록 페이지

---

## Phase 1: 관리자 자료 정보 입력/저장 계약 테스트 작성

**Loop:** 계획 파악 → 실패 테스트 작성 → RED 확인 → RED 원인이 미구현 schema/form/API인지 확인

**Files:**
- Create: `tests/market-products-admin-material-info-contract.test.mjs`

- [ ] **Step 1: 관리자 자료 정보 계약 테스트 파일 생성**

Create `tests/market-products-admin-material-info-contract.test.mjs` with this content:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = new URL('../supabase/migrations/', import.meta.url)
const migrationName = readdirSync(migrationsDir).find((name) => name.includes('market_item_question_count'))
const migration = migrationName ? readFileSync(join(migrationsDir.pathname, migrationName), 'utf8') : ''
const types = readFileSync(new URL('../src/types/supabase.ts', import.meta.url), 'utf8')
const marketItemsServer = readFileSync(new URL('../src/lib/market-items-server.ts', import.meta.url), 'utf8')
const adminItemsRoute = readFileSync(new URL('../src/app/api/admin/market/items/route.ts', import.meta.url), 'utf8')
const adminItemRoute = readFileSync(new URL('../src/app/api/admin/market/items/[id]/route.ts', import.meta.url), 'utf8')
const adminProductsClient = readFileSync(new URL('../src/app/(admin)/admin/market/products/market-products-client.tsx', import.meta.url), 'utf8')
const itemPage = readFileSync(new URL('../src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx', import.meta.url), 'utf8')

test('market items persist an explicit question count for material information', () => {
  assert.ok(migrationName, 'market item question_count migration should exist')
  assert.match(migration, /add column if not exists question_count integer/)
  assert.match(migration, /market_items_question_count_check/)
  assert.match(migration, /question_count is null or question_count >= 0/)
  assert.match(migration, /comment on column public\.market_items\.question_count/)
  assert.match(types, /question_count: number \| null/)
  assert.match(types, /question_count\?: number \| null/)
})

test('admin market item APIs map material information fields', () => {
  assert.match(adminItemsRoute, /questionCount: z\.number\(\)\.int\(\)\.min\(0\)\.nullable\(\)\.optional\(\)/)
  assert.match(adminItemsRoute, /question_count: parsed\.data\.questionCount \?\? null/)
  assert.match(adminItemRoute, /questionCount: z\.number\(\)\.int\(\)\.min\(0\)\.nullable\(\)\.optional\(\)/)
  assert.match(adminItemRoute, /question_count: parsed\.data\.questionCount/)
  assert.doesNotMatch(adminItemRoute, /question_count: parsed\.data\.questionCount \?\? null/)
  assert.match(marketItemsServer, /'question_count'/)
  assert.match(marketItemsServer, /question_count: input\.question_count \?\? null/)
  assert.match(marketItemsServer, /question_count: input\.question_count === undefined \? current\.question_count : input\.question_count/)
})

test('admin product form exposes material information inputs', () => {
  assert.match(adminProductsClient, /sourceType: string/)
  assert.match(adminProductsClient, /source1: string/)
  assert.match(adminProductsClient, /source2: string/)
  assert.match(adminProductsClient, /source3: string/)
  assert.match(adminProductsClient, /source4: string/)
  assert.match(adminProductsClient, /questionCount: string/)
  assert.match(adminProductsClient, /자료 정보/)
  assert.match(adminProductsClient, /상세 페이지 자료 정보 카드에 노출되는 값을 입력합니다/)
  assert.match(adminProductsClient, /Label>과목<\/Label/)
  assert.match(adminProductsClient, /Label>자료유형<\/Label/)
  assert.match(adminProductsClient, /Label>출처 1<\/Label/)
  assert.match(adminProductsClient, /Label>출처 2<\/Label/)
  assert.match(adminProductsClient, /Label>출처 3<\/Label/)
  assert.match(adminProductsClient, /Label>출처 4<\/Label/)
  assert.match(adminProductsClient, /Label>문항 수<\/Label/)
  assert.match(adminProductsClient, /Label>등록일자<\/Label/)
  assert.match(adminProductsClient, /sourceType: form\.sourceType/)
  assert.match(adminProductsClient, /source1: form\.source1/)
  assert.match(adminProductsClient, /source4: form\.source4/)
  assert.match(adminProductsClient, /questionCount: form\.questionCount \? Number\(form\.questionCount\) : null/)
})

test('public detail page prefers explicit question_count for material information', () => {
  assert.match(itemPage, /item\.question_count !== null && item\.question_count !== undefined/)
  assert.match(itemPage, /`\$\{item\.question_count\}문항`/)
})
```

- [ ] **Step 2: RED 검증**

Run:

```bash
node --test tests/market-products-admin-material-info-contract.test.mjs
```

Expected:

```text
FAIL
```

Expected failure reason:
- `question_count` migration/type/API/form 연결이 아직 없다.
- 관리자 form에 `자료 정보` 입력 섹션이 아직 없다.

---

## Phase 2: `question_count` schema/API/server 저장 경로 추가

**Loop:** 계획 파악 → migration/type/API/server 수정 → 계약 테스트 일부 통과 확인 → 실패 시 필드명 불일치 수정

**Files:**
- Create: `supabase/migrations/20260524020000_add_market_item_question_count.sql`
- Modify: `src/types/supabase.ts`
- Modify: `src/lib/market-items-server.ts`
- Modify: `src/app/api/admin/market/items/route.ts`
- Modify: `src/app/api/admin/market/items/[id]/route.ts`

- [ ] **Step 1: migration 생성**

Create `supabase/migrations/20260524020000_add_market_item_question_count.sql`:

```sql
alter table public.market_items
add column if not exists question_count integer;

alter table public.market_items
drop constraint if exists market_items_question_count_check;

alter table public.market_items
add constraint market_items_question_count_check
check (question_count is null or question_count >= 0);

comment on column public.market_items.question_count is '문제마켓 상품 문항 수';
```

- [ ] **Step 2: Supabase 타입 반영**

Run after applying or against the remote project if available:

```bash
npx supabase gen types typescript --project-id kzcweelnzhcmiuvjgeyi > src/types/supabase.ts
```

If type generation is unavailable during local implementation, manually add `question_count` to `market_items` Row/Insert/Update in `src/types/supabase.ts` exactly as below:

```ts
question_count: number | null
```

```ts
question_count?: number | null
```

- [ ] **Step 3: server create/update input과 payload에 `question_count` 추가**

In `src/lib/market-items-server.ts`, add `'question_count'` to both `createMarketItem` and `updateMarketItem` Pick lists.

Add this line to the create payload near `source_4`:

```ts
question_count: input.question_count ?? null,
```

Add this line to the update payload near `source_4` so an omitted PATCH field preserves the current value while an explicit `null` clears it:

```ts
question_count: input.question_count === undefined ? current.question_count : input.question_count,
```

- [ ] **Step 4: admin POST/PATCH schema와 mapping에 `questionCount` 추가**

In both `src/app/api/admin/market/items/route.ts` and `src/app/api/admin/market/items/[id]/route.ts`, add this schema field after `source4`:

```ts
questionCount: z.number().int().min(0).nullable().optional(),
```

In the POST create payload, add this line after `source_4`:

```ts
question_count: parsed.data.questionCount ?? null,
```

In the PATCH update payload, add this line after `source_4` so list-level status updates that omit `questionCount` preserve the current value:

```ts
question_count: parsed.data.questionCount,
```

- [ ] **Step 5: schema/API/server 계약 검증**

Run:

```bash
node --test tests/market-products-admin-material-info-contract.test.mjs
```

Expected:

```text
FAIL
```

Expected remaining failure reason:
- 관리자 form UI와 상세 페이지 `question_count` 우선 표시가 아직 없다.

---

## Phase 3: 관리자 상품 등록/수정 `자료 정보` 입력 UI 추가

**Loop:** 계획 파악 → form state/request/UI 수정 → 관리자 계약 테스트 일부 통과 확인 → 실패 시 누락 field만 수정

**Files:**
- Modify: `src/app/(admin)/admin/market/products/market-products-client.tsx`

- [ ] **Step 1: form state에 자료 정보 필드 추가**

In `MarketItemFormState`, add these fields after `gradeLevel`:

```ts
sourceType: string
source1: string
source2: string
source3: string
source4: string
questionCount: string
```

- [ ] **Step 2: empty/edit form에 자료 정보 필드 연결**

In `buildEmptyForm`, add:

```ts
sourceType: '',
source1: '',
source2: '',
source3: '',
source4: '',
questionCount: '',
```

In `buildEditForm`, add:

```ts
sourceType: item.source_type || '',
source1: item.source_1 || '',
source2: item.source_2 || '',
source3: item.source_3 || '',
source4: item.source_4 || '',
questionCount: item.question_count !== null && item.question_count !== undefined ? String(item.question_count) : '',
```

- [ ] **Step 3: request body에 자료 정보 필드 포함**

In `buildRequestBody`, add after `gradeLevel`:

```ts
sourceType: form.sourceType,
source1: form.source1,
source2: form.source2,
source3: form.source3,
source4: form.source4,
questionCount: form.questionCount ? Number(form.questionCount) : null,
```

- [ ] **Step 4: 관리자 입력 UI에 `자료 정보` 섹션 추가**

Add this section after the existing `상세 설명` textarea and before price fields. `과목` and `등록일자` are not manually edited because they are derived from `workspaceSubject` and `created_at`; the section still shows them so the admin can confirm what will appear on the public detail page.

```tsx
<div className="space-y-3 rounded-lg border p-4">
  <div>
    <p className="font-medium text-gray-900">자료 정보</p>
    <p className="text-sm text-gray-500">상세 페이지 자료 정보 카드에 노출되는 값을 입력합니다. 과목과 등록일자는 자동으로 표시됩니다.</p>
  </div>
  <div className="grid gap-4 md:grid-cols-2">
    <div className="space-y-2">
      <Label>과목</Label>
      <Input value={workspaceSubject === 'korean' ? '국어' : '영어'} disabled />
    </div>
    <div className="space-y-2">
      <Label>학년</Label>
      <select
        value={form.gradeLevel}
        onChange={(event) => setForm((current) => ({ ...current, gradeLevel: event.target.value }))}
        className="flex h-10 w-full rounded-md border bg-white px-3 text-sm"
      >
        <option value="">전체</option>
        {LISTBOARD_GRADE_OPTIONS.map((grade) => (
          <option key={grade} value={grade}>{grade}</option>
        ))}
      </select>
    </div>
    <div className="space-y-2">
      <Label>자료유형</Label>
      <Input value={form.sourceType} onChange={(event) => setForm((current) => ({ ...current, sourceType: event.target.value }))} placeholder="예: 모의고사" />
    </div>
    <div className="space-y-2">
      <Label>문항 수</Label>
      <Input type="number" min={0} value={form.questionCount} onChange={(event) => setForm((current) => ({ ...current, questionCount: event.target.value }))} placeholder="예: 24" />
    </div>
    <div className="space-y-2">
      <Label>출처 1</Label>
      <Input value={form.source1} onChange={(event) => setForm((current) => ({ ...current, source1: event.target.value }))} />
    </div>
    <div className="space-y-2">
      <Label>출처 2</Label>
      <Input value={form.source2} onChange={(event) => setForm((current) => ({ ...current, source2: event.target.value }))} />
    </div>
    <div className="space-y-2">
      <Label>출처 3</Label>
      <Input value={form.source3} onChange={(event) => setForm((current) => ({ ...current, source3: event.target.value }))} />
    </div>
    <div className="space-y-2">
      <Label>출처 4</Label>
      <Input value={form.source4} onChange={(event) => setForm((current) => ({ ...current, source4: event.target.value }))} />
    </div>
    <div className="space-y-2">
      <Label>등록일자</Label>
      <Input value={form.id ? '기존 등록일자 유지' : '저장 시 자동 기록'} disabled />
    </div>
  </div>
</div>
```

- [ ] **Step 5: 기존 학년 입력 중복 제거**

In the existing `학년`/`연도` grid, remove only the `학년` select block because it moved into the `자료 정보` section. Keep the `연도`, `월`, `상태`, `활성화` fields unchanged.

- [ ] **Step 6: 관리자 form 계약 검증**

Run:

```bash
node --test tests/market-products-admin-material-info-contract.test.mjs
```

Expected:

```text
FAIL
```

Expected remaining failure reason:
- 상세 페이지가 아직 `item.question_count`를 우선 표시하지 않는다.

---

## Phase 4: 상세 정보 카드 계약 테스트 작성

**Loop:** 계획 파악 → 실패 테스트 작성 → RED 확인 → RED 원인이 구현 전 UI 구조인지 확인

**Files:**
- Modify: `tests/market-item-detail-ui-contract.test.mjs`

- [ ] **Step 1: 자료 정보 카드 계약 테스트 추가**

In `tests/market-item-detail-ui-contract.test.mjs`, add this test after `market item detail keeps a consistent product header and meta layout`:

```js
test('market item detail shows one full-width material information card', () => {
  assert.match(itemPage, /자료 정보/)
  assert.match(itemPage, /과목/)
  assert.match(itemPage, /학년/)
  assert.match(itemPage, /출처/)
  assert.match(itemPage, /자료유형/)
  assert.match(itemPage, /문항 수/)
  assert.match(itemPage, /등록일자/)
  assert.match(itemPage, /const materialInfoRows = \[/)
  assert.match(itemPage, /resolveWorkspaceSubjectLabel\(item\.workspace_subject\)/)
  assert.match(itemPage, /formatSourcesLabel\(sources\)/)
  assert.match(itemPage, /resolveQuestionCountLabel\(item\)/)
  assert.match(itemPage, /item\.question_count/)
  assert.match(itemPage, /item\.source_type \|\| category\.title \|\| '-'/)
  assert.match(itemPage, /formatDate\(item\.created_at\)/)
  assert.match(itemPage, /grid gap-3 sm:grid-cols-2 md:grid-cols-3/)
  assert.doesNotMatch(itemPage, /grid gap-4 md:grid-cols-2/)
  assert.doesNotMatch(itemPage, /시험 정보/)
  assert.doesNotMatch(itemPage, /시험 회차/)
  assert.doesNotMatch(itemPage, /출제 타입/)
  assert.doesNotMatch(itemPage, /보유 상태/)
  assert.doesNotMatch(itemPage, /등록된 출처 정보가 없습니다\./)
})
```

- [ ] **Step 2: 기존 header/meta 테스트에서 충돌 가능성 확인**

Keep this existing assertion unchanged because the right-side file panel must remain sticky:

```js
assert.match(itemPage, /lg:sticky lg:top-24/)
```

- [ ] **Step 3: RED 검증**

Run:

```bash
node --test tests/market-products-admin-material-info-contract.test.mjs tests/market-item-detail-ui-contract.test.mjs
```

Expected:

```text
FAIL
```

Expected failure reason:
- `자료 정보` 문자열이 아직 없다.
- 기존 `시험 정보`, `출처` 카드 구조가 남아 있다.

---

## Phase 5: 상세 페이지 로컬 helper 추가

**Loop:** 계획 파악 → helper 추가 → helper 계약 테스트 일부 통과 확인 → 미통과 시 helper 문자열/위치만 수정

**Files:**
- Modify: `src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx`

- [ ] **Step 1: unused가 될 `formatExamLabel` 제거**

Remove this function from `page.tsx`:

```ts
const formatExamLabel = (year?: number | null, month?: number | null) => {
  if (!year && !month) {
    return '-'
  }

  return [year ? `${year}년` : null, month ? `${month}월` : null].filter(Boolean).join(' ')
}
```

- [ ] **Step 2: 과목 라벨 helper 추가**

Add this after `collectSources`:

```ts
const resolveWorkspaceSubjectLabel = (subject: string) => subject === 'korean' ? '국어' : '영어'
```

- [ ] **Step 3: 출처 라벨 helper 추가**

Add this after `resolveWorkspaceSubjectLabel`:

```ts
const formatSourcesLabel = (sources: string[]) => sources.length > 0 ? sources.join(' · ') : '-'
```

- [ ] **Step 4: 문항 수 라벨 helper 추가**

Add this after `formatSourcesLabel`:

```ts
const resolveQuestionCountLabel = (item: Awaited<ReturnType<typeof getPublishedMarketItemById>>) => {
  if (!item) {
    return '-'
  }

  if (item.question_count !== null && item.question_count !== undefined) {
    return `${item.question_count}문항`
  }

  const text = [item.title, item.summary, item.description].filter(Boolean).join(' ')
  const match = text.match(/(\d+)\s*(?:문제|문항)/)

  return match ? `${match[1]}문항` : '-'
}
```

Rationale:
- 관리자 등록 화면에서 입력한 `question_count`를 우선 표시한다.
- Do not use `samplePages.length`; sample page count is preview page count, not question count.
- 기존 데이터 중 `question_count`가 비어 있는 상품만 제목/요약/상세설명 명시 패턴을 fallback으로 사용한다.

- [ ] **Step 5: helper-only 검증**

Run:

```bash
node --test tests/market-products-admin-material-info-contract.test.mjs tests/market-item-detail-ui-contract.test.mjs
```

Expected:

```text
FAIL
```

Expected remaining failure reason:
- `materialInfoRows` and `자료 정보` UI block are not implemented yet.

---

## Phase 6: `자료 정보` 단일 카드 구현

**Loop:** 계획 파악 → 기존 2카드 블록 교체 → GREEN 확인 → 실패 시 JSX 구조만 재조정

**Files:**
- Modify: `src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx`

- [ ] **Step 1: `materialInfoRows` 배열 생성**

Inside `MarketItemDetailPage`, after `const subjectTheme = getWorkspaceSubjectTheme(item.workspace_subject)`, add:

```ts
const materialInfoRows = [
  { label: '과목', value: resolveWorkspaceSubjectLabel(item.workspace_subject) },
  { label: '학년', value: item.grade_level || '-' },
  { label: '출처', value: formatSourcesLabel(sources) },
  { label: '자료유형', value: item.source_type || category.title || '-' },
  { label: '문항 수', value: resolveQuestionCountLabel(item) },
  { label: '등록일자', value: formatDate(item.created_at) },
]
```

- [ ] **Step 2: 기존 `시험 정보 + 출처` 2카드 블록 제거**

Remove the entire block starting with:

```tsx
<div className="grid gap-4 md:grid-cols-2">
```

through the closing `</div>` that contains both:

```tsx
<CardTitle className="flex items-center gap-2 text-lg"><FileText className="h-5 w-5 text-slate-500" />시험 정보</CardTitle>
```

and:

```tsx
<CardTitle className="text-lg">출처</CardTitle>
```

- [ ] **Step 3: `자료 정보` full-width 카드 추가**

Insert this where the removed 2-card block was:

```tsx
<Card className="border-dashed bg-slate-50/60">
  <CardHeader>
    <CardTitle className="flex items-center gap-2 text-lg"><FileText className="h-5 w-5 text-slate-500" />자료 정보</CardTitle>
  </CardHeader>
  <CardContent>
    <dl className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
      {materialInfoRows.map((row) => (
        <div key={row.label} className="rounded-xl border bg-white px-3 py-3">
          <dt className="text-xs font-medium text-gray-500">{row.label}</dt>
          <dd className="mt-2 break-words text-sm font-semibold text-gray-900">{row.value}</dd>
        </div>
      ))}
    </dl>
  </CardContent>
</Card>
```

- [ ] **Step 4: GREEN 검증**

Run:

```bash
node --test tests/market-products-admin-material-info-contract.test.mjs tests/market-item-detail-ui-contract.test.mjs
```

Expected:

```text
PASS
```

---

## Phase 7: 정적/브라우저 검증

**Loop:** 계획 파악 → 자동 검증 → 브라우저 확인 → 실패 시 Phase 2/3로 돌아가 수정

**Files:**
- No additional code files expected.

- [ ] **Step 1: targeted lint 실행**

Run:

```bash
npx eslint 'src/app/(admin)/admin/market/products/market-products-client.tsx' 'src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx' tests/market-products-admin-material-info-contract.test.mjs tests/market-item-detail-ui-contract.test.mjs
```

Expected:

```text
No errors
```

- [ ] **Step 2: build 실행**

Run:

```bash
npm run build
```

Expected:

```text
Compiled successfully
```

- [ ] **Step 3: full lint 실행 및 기존 unrelated 실패 분리**

Run:

```bash
npm run lint
```

Expected:

```text
PASS
```

If it fails only in pre-existing unrelated files, record the failing file paths/messages separately and do not claim full lint success.

- [ ] **Step 4: 브라우저 확인**

Start dev server if needed:

```bash
npm run dev
```

Open an existing detail URL:

```text
http://localhost:4000/english/market/mock-exams/items/4f794e4c-f1bf-4868-add1-d97fd8e028c9
```

Expected visual results:
- `자료 정보` 카드가 보인다.
- `과목`, `학년`, `출처`, `자료유형`, `문항 수`, `등록일자`가 카드 안에 보인다.
- `시험 정보` 카드 제목은 보이지 않는다.
- 별도 `출처` 카드가 보이지 않는다.
- `상세 설명` 카드와 우측 `파일 선택` 패널은 기존처럼 유지된다.
- `샘플 미리보기`, `PDF 구매하기`, `HWP & PDF 구매하기` 버튼이 그대로 동작 가능한 위치에 보인다.

---

## Phase 8: 완료 확인 및 보고

**Loop:** 변경 파일 확인 → 검증 결과 정리 → 실패 항목 분리 → 보고

- [ ] **Step 1: 변경 파일 확인**

Run:

```bash
git status --short
```

Expected changed files:

```text
 M src/app/(admin)/admin/market/products/market-products-client.tsx
 M src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx
 M src/app/api/admin/market/items/route.ts
 M src/app/api/admin/market/items/[id]/route.ts
 M src/lib/market-items-server.ts
 M src/types/supabase.ts
 M tests/market-item-detail-ui-contract.test.mjs
?? supabase/migrations/20260524020000_add_market_item_question_count.sql
?? tests/market-products-admin-material-info-contract.test.mjs
?? docs/superpowers/plans/2026-05-24-market-item-material-info-plan.md
```

- [ ] **Step 2: final report 작성**

Report in Korean:
- 관리자 문제마켓 상품 등록/수정 화면에 `자료 정보` 입력 섹션을 추가한 범위
- `시험 정보`/`출처` 2카드를 `자료 정보` 단일 카드로 바꾼 범위
- `문항 수`는 `market_items.question_count`에 저장하고, 기존 데이터만 명시 패턴 추출 fallback을 적용했다는 점
- 실행한 검증 명령과 결과
- full lint가 실패했다면 기존 unrelated 오류로 분리한 요약

- [ ] **Step 3: commit**

Because this session has a project-context directive to commit completed implementation work unless the user explicitly says not to, commit after implementation verification passes:

```bash
git add docs/superpowers/plans/2026-05-24-market-item-material-info-plan.md supabase/migrations/20260524020000_add_market_item_question_count.sql src/types/supabase.ts src/lib/market-items-server.ts src/app/api/admin/market/items/route.ts 'src/app/api/admin/market/items/[id]/route.ts' 'src/app/(admin)/admin/market/products/market-products-client.tsx' 'src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx' tests/market-products-admin-material-info-contract.test.mjs tests/market-item-detail-ui-contract.test.mjs
git commit -m "feat: add market item material info fields"
```

Expected:

```text
[main <hash>] feat: add market item material info fields
```

---

## Self-Review

### Spec coverage
- 관리자 등록/수정 입력: Phase 1 계약 테스트, Phase 2 schema/API/server, Phase 3 form UI.
- `문항 수` 명시 저장: Phase 2 migration/type/API/server.
- `시험 정보` → `자료 정보`: Phase 6 Step 3.
- 새 정보 항목 6개: Phase 6 Step 1 and Step 3.
- 별도 `출처` 카드 제거: Phase 6 Step 2.
- 두 카드 너비 합치기: Phase 6 Step 3의 단일 card + 내부 `dl` grid.
- 기존 구매/샘플 영역 유지: Phase 7 browser verification and existing tests.

### Placeholder scan
- 이 계획에는 미정 항목과 모호한 구현 위임 문구가 없다.
- `문항 수`의 신규 저장 경로와 기존 데이터 fallback 정책을 모두 명시했다.

### Type consistency
- `resolveWorkspaceSubjectLabel`, `formatSourcesLabel`, `resolveQuestionCountLabel`, `materialInfoRows` 이름은 테스트와 구현 단계에서 동일하게 사용한다.
- `materialInfoRows` values are strings, so the `dd` renderer can print them directly.
