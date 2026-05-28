# 문제마켓 샘플 페이지 고유 key 오류 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 문제마켓 샘플 미리보기에서 동일한 `pageNumber` 샘플이 여러 개 존재해도 React key 중복 경고 없이 올바르게 표시·선택되도록 수정한다.

**Architecture:** 샘플 페이지의 화면 식별자와 선택 기준을 `pageNumber`에서 DB row 고유값인 `id`로 전환한다. public/admin 샘플 페이지 API가 모두 `id`를 내려주고, 사용자/관리자 미리보기 다이얼로그는 `id`를 React key 및 선택 상태로 사용한다.

**Tech Stack:** Next.js App Router, TypeScript, React, Supabase Storage signed URL, node:test 계약 테스트.

---

## 내용 파악

### 확인된 현상
- 사용자 상세페이지 샘플 미리보기에서 React console error 발생:
  - `Encountered two children with the same key, '1'`
  - 발생 위치: `src/app/(dashboard)/market/[slug]/items/[itemId]/market-sample-preview-dialog.tsx:165`

### 원인 근거
- 사용자 샘플 미리보기 다이얼로그는 `pages.map()` 렌더링에서 `key={page.pageNumber}`를 사용한다.
- 현재 샘플 생성 구조는 여러 PDF에서 임의 페이지를 추가할 수 있으므로 같은 상품 안에 `pageNumber = 1`이 여러 개 존재할 수 있다.
- v2 마이그레이션에서 기존 `item_id + page_number` active unique index를 제거했으므로, DB 설계상 같은 `page_number` 중복은 허용된다.
- public API는 현재 `id`를 응답하지 않고 `pageNumber`만 내려준다.
- 관리자 샘플 미리보기 다이얼로그도 `key={page.pageNumber}` 및 `selectedPageNumber`를 사용하므로 같은 문제 가능성이 있다.

### 수정 원칙
- 데이터 정책을 되돌려 `page_number` 중복을 금지하지 않는다.
- UI 식별자는 `pageNumber`가 아니라 `id`로 통일한다.
- 표시 문구는 기존처럼 원본 PDF 페이지 번호를 보여주되, 내부 key/선택 상태만 `id`로 바꾼다.

---

## 계획 작성

### Task 1: public 샘플 페이지 API에 고유 id 포함

**Files:**
- Modify: `src/app/api/market/items/[itemId]/sample-pages/route.ts`
- Test: `tests/market-sample-pages-api-contract.test.mjs`

- [ ] **Step 1: API 계약 테스트를 먼저 보강한다**

`tests/market-sample-pages-api-contract.test.mjs`의 `market sample pages api returns ordered signed jpg preview urls` 테스트에 `id` 응답 계약을 추가한다.

```js
assert.match(route, /id: page\.id/)
```

- [ ] **Step 2: 실패 확인**

Run:

```bash
node --test tests/market-sample-pages-api-contract.test.mjs
```

Expected:

```text
FAIL ... id: page\.id
```

- [ ] **Step 3: public API 응답에 `id` 추가**

`src/app/api/market/items/[itemId]/sample-pages/route.ts`의 `return { ... }`에 `id`를 추가한다.

```ts
return {
  id: page.id,
  pageNumber: page.page_number,
  signedUrl: data.signedUrl,
  fileSizeBytes: page.file_size_bytes,
  widthPx: page.width_px,
  heightPx: page.height_px,
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run:

```bash
node --test tests/market-sample-pages-api-contract.test.mjs
```

Expected:

```text
pass
```

---

### Task 2: 사용자 샘플 미리보기 key를 `id`로 변경

**Files:**
- Modify: `src/app/(dashboard)/market/[slug]/items/[itemId]/market-sample-preview-dialog.tsx`
- Test: `tests/market-sample-pages-api-contract.test.mjs`

- [ ] **Step 1: UI 계약 테스트 보강**

`tests/market-sample-pages-api-contract.test.mjs`에서 다이얼로그 파일을 읽도록 추가한다.

```js
const sampleDialog = readFileSync(
  new URL('../src/app/(dashboard)/market/[slug]/items/[itemId]/market-sample-preview-dialog.tsx', import.meta.url),
  'utf8'
)
```

그리고 새 테스트를 추가한다.

```js
test('market sample preview dialog uses stable sample page ids for react keys', () => {
  assert.match(sampleDialog, /id: string/)
  assert.match(sampleDialog, /key=\{page\.id\}/)
  assert.doesNotMatch(sampleDialog, /key=\{page\.pageNumber\}/)
})
```

- [ ] **Step 2: 실패 확인**

Run:

```bash
node --test tests/market-sample-pages-api-contract.test.mjs
```

Expected:

```text
FAIL ... key={page.id}
```

- [ ] **Step 3: 타입과 key 수정**

`SamplePage` 인터페이스에 `id`를 추가한다.

```ts
interface SamplePage {
  id: string
  pageNumber: number
  signedUrl: string
  fileSizeBytes: number | null
  widthPx: number | null
  heightPx: number | null
}
```

렌더링 key를 `page.id`로 바꾼다.

```tsx
<figure key={page.id} className="overflow-hidden rounded-xl border bg-white">
```

- [ ] **Step 4: 테스트 통과 확인**

Run:

```bash
node --test tests/market-sample-pages-api-contract.test.mjs
```

Expected:

```text
pass
```

---

### Task 3: 관리자 샘플 미리보기 선택 기준도 `id`로 변경

**Files:**
- Modify: `src/app/(admin)/admin/market/products/admin-market-sample-preview-dialog.tsx`
- Test: `tests/market-admin-sample-preview-ui-contract.test.mjs`

- [ ] **Step 1: 관리자 UI 계약 테스트 보강**

`tests/market-admin-sample-preview-ui-contract.test.mjs`의 `admin sample preview dialog fetches fresh admin signed sample urls` 테스트에 아래 assertions를 추가한다.

```js
assert.match(dialog, /id: string/)
assert.match(dialog, /selectedPageId/)
assert.match(dialog, /key=\{page\.id\}/)
assert.match(dialog, /aria-pressed=\{selectedPageId === page\.id\}/)
assert.doesNotMatch(dialog, /key=\{page\.pageNumber\}/)
assert.doesNotMatch(dialog, /selectedPageNumber/)
```

- [ ] **Step 2: 실패 확인**

Run:

```bash
node --test tests/market-admin-sample-preview-ui-contract.test.mjs
```

Expected:

```text
FAIL ... selectedPageId / key={page.id}
```

- [ ] **Step 3: 관리자 다이얼로그 타입 수정**

`SamplePagePreview`에 `id`를 추가한다.

```ts
interface SamplePagePreview {
  id: string
  pageNumber: number
  signedUrl: string
  fileSizeBytes: number | null
  widthPx: number | null
  heightPx: number | null
}
```

- [ ] **Step 4: 선택 상태를 `selectedPageId`로 변경**

기존 상태:

```ts
const [selectedPageNumber, setSelectedPageNumber] = useState<number | null>(null)
```

수정:

```ts
const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
```

선택 페이지 계산도 id 기준으로 변경한다.

```ts
const selectedPage = pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null
```

- [ ] **Step 5: 초기화/로드 시 선택 id 설정**

`itemId`가 없거나 오류가 났을 때:

```ts
setSelectedPageId(null)
```

정상 로드 시:

```ts
const nextPages = (payload.pages ?? []) as SamplePagePreview[]
setPages(nextPages)
setSelectedPageId(nextPages[0]?.id ?? null)
```

- [ ] **Step 6: 썸네일 버튼 key와 선택 처리 수정**

```tsx
<button
  key={page.id}
  type="button"
  aria-pressed={selectedPageId === page.id}
  aria-label={`샘플 페이지 ${page.pageNumber} 보기`}
  onClick={() => setSelectedPageId(page.id)}
  className={`rounded-lg border p-2 text-left text-xs transition ${
    selectedPageId === page.id
      ? 'border-primary ring-2 ring-primary/40'
      : 'hover:border-primary/50'
  }`}
>
```

- [ ] **Step 7: 관리자 테스트 통과 확인**

Run:

```bash
node --test tests/market-admin-sample-preview-ui-contract.test.mjs
```

Expected:

```text
pass
```

---

### Task 4: 회귀 검증 범위 실행

**Files:**
- No source changes unless verification fails.

- [ ] **Step 1: 샘플/마켓 관련 계약 테스트 실행**

Run:

```bash
node --test tests/market-*.test.mjs
```

Expected:

```text
fail 0
```

- [ ] **Step 2: 타입체크 실행**

Run:

```bash
npx tsc --noEmit --pretty false
```

Expected:

```text
exit code 0
```

- [ ] **Step 3: 변경 파일 scoped ESLint 실행**

Run:

```bash
npx eslint \
  'src/app/(dashboard)/market/[slug]/items/[itemId]/market-sample-preview-dialog.tsx' \
  'src/app/(admin)/admin/market/products/admin-market-sample-preview-dialog.tsx' \
  'src/app/api/market/items/[itemId]/sample-pages/route.ts' \
  tests/market-sample-pages-api-contract.test.mjs \
  tests/market-admin-sample-preview-ui-contract.test.mjs
```

Expected:

```text
exit code 0
```

- [ ] **Step 4: 전체 빌드 실행**

Run:

```bash
npm run build
```

Expected:

```text
Compiled successfully
exit code 0
```

- [ ] **Step 5: 전체 lint는 별도 참고로 실행**

Run:

```bash
npm run lint
```

Expected:

```text
현재 저장소에는 기존 repo-wide lint 문제가 있으므로 실패할 수 있음.
이번 변경 파일 scoped ESLint가 통과하면 이번 수정 범위 검증은 통과로 분리 보고한다.
```

---

## 검증 loop

### 검증 체크리스트
- [ ] public API 응답에 `id`가 포함된다.
- [ ] 사용자 샘플 미리보기의 React key가 `page.id`다.
- [ ] 관리자 샘플 미리보기의 React key가 `page.id`다.
- [ ] 관리자 샘플 미리보기 선택 상태가 `pageNumber`가 아니라 `id` 기준이다.
- [ ] 같은 `pageNumber`를 가진 샘플이 여러 개 있어도 key 중복 가능성이 없다.
- [ ] 사용자 표시 문구는 기존처럼 `pageNumber`를 보여준다.
- [ ] DB unique 제약이나 샘플 생성 정책을 되돌리지 않는다.
- [ ] `node --test tests/market-*.test.mjs` 통과.
- [ ] `npx tsc --noEmit --pretty false` 통과.
- [ ] 변경 파일 scoped ESLint 통과.
- [ ] `npm run build` 통과.

### 계획 자체 검증 결과
- 요구사항 원인: `pageNumber` key 중복 문제를 직접 겨냥한다.
- 영향 범위: public API, 사용자 다이얼로그, 관리자 다이얼로그, 계약 테스트로 한정한다.
- 데이터 정책: 동일 pageNumber 허용 구조를 유지한다.
- 회귀 방지: key와 선택 기준이 다시 pageNumber로 돌아가지 않도록 테스트에 명시한다.

### loop 종료 조건
위 체크리스트가 모두 충족되면 loop를 종료한다. 하나라도 실패하면 실패 지점만 재분석해서 같은 loop를 반복한다.
