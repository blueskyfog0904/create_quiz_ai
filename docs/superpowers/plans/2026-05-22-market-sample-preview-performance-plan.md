# 문제마켓 샘플 미리보기 로딩 속도 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 문제마켓 상품 상세의 `샘플 미리보기` 클릭 후 첫 샘플 JPG가 보이기까지의 체감 지연을 줄인다.

**Architecture:** 1차 개선은 기존 private Supabase signed URL 보안 경계를 유지하면서, `sample-pages` API 응답에 만료 정보와 파일 크기 메타데이터를 추가하고, 클라이언트에서 TTL-aware 메모리 캐시·intent prefetch·이미지 로딩 우선순위를 적용한다. 서버 캐시, public bucket, 이미지 프록시는 실제 측정 후 2차 범위로 미룬다.

**Tech Stack:** Next.js App Router, React Client Components, Supabase Auth/Storage signed URL, TypeScript, Node `node:test`, ESLint.

---

## 1. 분석 내용 파악

### 1.1 현재 로딩 경로

- `src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx:67-72`에서 상세 페이지 SSR 단계가 `listMarketItemFiles`, `listActiveMarketItemSamplePages`, 구매 정보를 조회한다.
- `src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx:185-198`은 `MarketItemActions`에 `hasSamplePages`, `samplePageCount`만 전달한다. signed URL이나 샘플 page metadata는 전달하지 않는다.
- `src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx:281-288`은 `샘플 미리보기` 클릭 시 로그인 확인 후 `setIsSamplePreviewOpen(true)`만 수행한다.
- `src/app/(dashboard)/market/[slug]/items/[itemId]/market-sample-preview-dialog.tsx:38-78`은 다이얼로그가 열릴 때마다 `/api/market/items/${itemId}/sample-pages?subject=${workspaceSubject}`를 `cache: 'no-store'`로 호출한다.
- `src/app/api/market/items/[itemId]/sample-pages/route.ts:14-50`은 요청마다 로그인 확인, published item 조회, active sample page 조회, 각 페이지별 `createSignedUrl(..., 60 * 5)`를 수행한다.
- `src/app/(dashboard)/market/[slug]/items/[itemId]/market-sample-preview-dialog.tsx:95-108`은 응답 후 모든 페이지를 `<img src={page.signedUrl}>`로 즉시 렌더링한다.
- `src/app/api/admin/market/items/[id]/files/route.ts:80-82`, `:117-160`에 따르면 PDF→JPG 변환은 관리자 PDF 업로드 시점에 끝난다. 사용자 미리보기 클릭 시점의 지연은 변환 비용이 아니다.

### 1.2 병목 원인 순위

| 순위 | 원인 | 확신도 | 근거 |
|---|---|---:|---|
| 1 | 클릭 후에야 API 호출과 signed URL 발급이 시작된다 | 높음 | `market-sample-preview-dialog.tsx:38-78`, `sample-pages/route.ts:14-50` |
| 2 | 열 때마다 `cache: 'no-store'` API 호출을 반복해 재오픈 캐시가 없다 | 높음 | `market-sample-preview-dialog.tsx:49-51` |
| 3 | 상세 페이지에서 이미 샘플 존재 여부를 조회했지만 미리보기 API에서 item/page를 다시 조회한다 | 높음 | `page.tsx:67-72`, `sample-pages/route.ts:24-30` |
| 4 | signed URL이 매번 새로 발급되어 이미지 URL이 바뀌고 브라우저 캐시 적중률이 낮다 | 중간~높음 | `sample-pages/route.ts:31-48` |
| 5 | 1~3장 원본 JPG를 한 번에 렌더링해 첫 페이지 표시가 이미지 다운로드와 decode에 묶인다 | 중간 | `market-sample-preview-dialog.tsx:95-108` |
| 6 | JPG 품질/해상도가 미리보기 용도 대비 무거울 수 있다 | 중간 | `market-pdf-sample-generator.ts:132-150`의 scale `1.5`, JPEG quality `0.9` |

### 1.3 실제 측정 기준선

로컬 브라우저에서 공개 샘플 상품 `83bd9dde-5d44-444f-afc0-7a83aa589172` 기준으로 측정한 참고값이다.

- `/sample-pages` API 3회 반복: 약 540~995ms.
- signed JPG 3장 로드: 각 약 970~992ms.
- DB `market_item_sample_pages`의 활성 샘플 크기: 256,904 / 288,878 / 267,919 bytes, 총 약 814KB, 이미지 크기 893x1262.

이 값은 네트워크와 dev 환경 영향을 받으므로 구현 전/후 같은 환경에서 다시 측정한다.

---

## 2. RALPLAN-DR 요약

### Principles

1. 기존 private bucket + signed URL 보안 경계를 유지한다.
2. 1차 개선은 체감 지연을 줄이는 최소 변경으로 제한한다.
3. 캐시는 signed URL TTL을 인식하고 만료 임박 URL을 재사용하지 않는다.
4. API 인증, published item 검증, workspace subject 검증은 우회하지 않는다.
5. 실제 개선 여부는 API 시간과 첫 이미지 로드 시간을 분리 측정한다.

### Decision Drivers

1. 클릭 후 첫 이미지 표시 시간 단축.
2. 보안/권한 회귀 없음.
3. 서버/DB/Storage 구조 변경 최소화.

### Viable Options

#### Option A — 클라이언트 TTL 캐시 + prefetch + 이미지 우선순위 제어

**Pros**
- 기존 API와 private signed URL 모델을 유지한다.
- 재오픈과 hover/focus 후 클릭의 체감 속도가 바로 개선된다.
- 구현 범위가 `sample-pages` API, 다이얼로그, 액션 컴포넌트, 계약 테스트로 제한된다.

**Cons**
- 완전 cold click은 API 왕복이 여전히 필요하다.
- signed URL 만료 처리가 필요하다.

#### Option B — 서버 signed URL 캐시

**Pros**
- 여러 사용자/여러 요청의 `createSignedUrl` 비용을 줄일 수 있다.
- prefetch 요청 증가 시 서버 부하 완화에 도움이 된다.

**Cons**
- Next 서버리스/분산 환경에서 in-memory cache 일관성이 낮다.
- Redis/KV를 쓰면 운영 복잡도가 커진다.
- item hidden/deleted 직후 짧은 URL 생존 창이 생긴다.

#### Option C — 샘플 전용 public bucket/path

**Pros**
- signed URL API가 필요 없어 가장 빠르다.
- CDN/browser cache 전략이 단순해진다.

**Cons**
- 로그인 사용자만 샘플을 보는 현재 정책과 달라진다.
- 샘플이 원문 일부라 public 노출 정책 결정이 필요하다.
- URL 유출과 삭제 후 캐시 회수 문제가 생긴다.

### Decision

1차 구현은 **Option A**로 진행한다. Option B와 C는 실제 측정 후 별도 제품/운영 결정이 필요한 2차 계획으로 둔다.

---

## 3. Acceptance Criteria

- [ ] API 응답은 기존 `pages[].pageNumber`, `pages[].signedUrl`, `pages[].widthPx`, `pages[].heightPx`를 유지하면서 `expiresAt`과 `pages[].fileSizeBytes`를 제공한다.
- [ ] 동일 `itemId + workspaceSubject`에서 TTL safety margin 내 재오픈하면 `/sample-pages` API를 다시 호출하지 않고 즉시 cached pages를 표시한다.
- [ ] signed URL 만료 30초 이내이거나 만료 후에는 cache를 사용하지 않고 API를 재호출한다.
- [ ] 샘플 버튼 hover/focus/touch intent 또는 상세 페이지 idle 시점에 로그인 사용자 한정 prefetch가 발생하며, 동일 `itemId + workspaceSubject`의 in-flight 요청은 하나의 Promise를 공유해 중복 `/sample-pages` 호출을 만들지 않는다.
- [ ] 첫 번째 샘플 이미지는 eager/high priority로, 2~3번째 이미지는 lazy/async로 렌더링한다.
- [ ] 비로그인 사용자의 샘플 클릭은 기존 로그인 리다이렉트를 유지한다.
- [ ] unpublished/hidden/deleted item에 signed URL을 발급하지 않는 기존 서버 검증을 유지한다.
- [ ] 구현 전/후 Playwright 또는 브라우저 Performance API로 `click/open → first image load`와 `/sample-pages` API 시간을 측정하고 결과를 보고한다.

---

## 4. File Structure

### Modify

- `src/app/api/market/items/[itemId]/sample-pages/route.ts`
  - signed URL TTL 상수화.
  - `expiresAt`, `fileSizeBytes` 응답 추가.
  - 인증/상품/workspace 검증 유지.

- `src/app/(dashboard)/market/[slug]/items/[itemId]/market-sample-preview-dialog.tsx`
  - `SamplePage` 타입 확장.
  - module-level TTL-aware cache 추가.
  - module-level in-flight request dedupe map 추가.
  - open/prefetch 시 같은 loader와 같은 in-flight Promise 사용.
  - image `loading`, `decoding`, `fetchPriority` 속성 추가.

- `src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx`
  - `FileOptionRow`에 intent handler prop 추가.
  - 샘플 row hover/focus/touch intent에서 prefetch signal 증가.
  - 비로그인 사용자는 prefetch하지 않음.

### Test

- `tests/market-sample-pages-api-contract.test.mjs`
  - API 응답 계약 확장 테스트.

- `tests/market-sample-preview-performance-contract.test.mjs`
  - 신규 성능 계약 테스트.

- `tests/market-item-detail-ui-contract.test.mjs`
  - `FileOptionRow`가 `onIntent` prop을 받고 버튼 `onFocus`, `onMouseEnter`, `onTouchStart`에 연결하는지 검증.
  - `MarketItemActions`가 `samplePreviewPrefetchKey`, `prefetchSamplePreview`, `!isLoggedIn || !hasSamplePages` guard를 갖고 `prefetchKey={samplePreviewPrefetchKey}`를 다이얼로그에 전달하는지 검증.

### No DB migration in Phase 1

- `market_item_sample_pages.file_size_bytes`는 이미 존재한다.
- signed URL을 DB/localStorage에 저장하지 않는다.

---

## 5. 구현 계획: 분석 → 계획 → 검증 Loop

### Loop 0 — Baseline 분석 고정

- [ ] **Step 0.1: 현재 동작 측정**

  Run local dev server:

  ```bash
  npm run dev
  ```

  Browser/Playwright에서 동일 상품을 대상으로 다음을 기록한다.

  ```text
  /sample-pages API duration
  first signed JPG duration
  dialog open → first image load
  dialog open → all images load
  reopen within 1 minute → API call count
  ```

  Exit condition:

  ```text
  기준선 수치를 구현 결과 보고서에 남길 수 있어야 한다.
  ```

### Loop 1 — API 계약 확장

- [ ] **Step 1.1: RED 테스트 작성**

  Modify: `tests/market-sample-pages-api-contract.test.mjs`

  Add assertions equivalent to:

  ```js
  test('market sample pages api exposes ttl and file size metadata for client caching', () => {
    assert.match(route, /SAMPLE_PAGE_SIGNED_URL_TTL_SECONDS/)
    assert.match(route, /expiresAt/)
    assert.match(route, /fileSizeBytes/)
    assert.match(route, /file_size_bytes/)
    assert.match(route, /createSignedUrl\(page\.storage_path, SAMPLE_PAGE_SIGNED_URL_TTL_SECONDS\)/)
  })
  ```

- [ ] **Step 1.2: RED 확인**

  Run:

  ```bash
  node --test tests/market-sample-pages-api-contract.test.mjs
  ```

  Expected:

  ```text
  FAIL: expiresAt/fileSizeBytes/TTL 상수 관련 assertion 실패
  ```

- [ ] **Step 1.3: API 최소 구현**

  Modify: `src/app/api/market/items/[itemId]/sample-pages/route.ts`

  Implement shape:

  ```ts
  const SAMPLE_PAGE_SIGNED_URL_TTL_SECONDS = 60 * 5

  export async function GET(request: NextRequest, { params }: RouteContext) {
    const supabase = await createClient()
    const { itemId } = await params
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
    }

    try {
      const workspaceSubject = resolveWorkspaceSubject(request.nextUrl.searchParams.get('subject'))
      const item = await getPublishedMarketItemById(itemId, workspaceSubject)
      if (!item) {
        return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
      }

      const samplePages = await listActiveMarketItemSamplePages(item.id, item.workspace_subject)
      const expiresAt = new Date(Date.now() + SAMPLE_PAGE_SIGNED_URL_TTL_SECONDS * 1000).toISOString()
      const adminSupabase = createAdminClient()
      const pages = await Promise.all(samplePages.map(async (page) => {
        const { data, error } = await adminSupabase
          .storage
          .from(page.storage_bucket)
          .createSignedUrl(page.storage_path, SAMPLE_PAGE_SIGNED_URL_TTL_SECONDS)

        if (error || !data?.signedUrl) {
          throw new Error(error?.message || '샘플 이미지 URL 생성에 실패했습니다.')
        }

        return {
          pageNumber: page.page_number,
          signedUrl: data.signedUrl,
          fileSizeBytes: page.file_size_bytes,
          widthPx: page.width_px,
          heightPx: page.height_px,
        }
      }))

      return NextResponse.json({ success: true, pages, expiresAt })
    } catch (error) {
      return NextResponse.json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : '샘플 페이지를 불러오지 못했습니다.',
        },
      }, { status: 500 })
    }
  }
  ```

- [ ] **Step 1.4: GREEN 확인**

  Run:

  ```bash
  node --test tests/market-sample-pages-api-contract.test.mjs
  ```

  Expected:

  ```text
  PASS
  ```

### Loop 2 — 클라이언트 TTL 캐시

- [ ] **Step 2.1: RED 성능 계약 테스트 작성**

  Create: `tests/market-sample-preview-performance-contract.test.mjs`

  Include assertions equivalent to:

  ```js
  import assert from 'node:assert/strict'
  import test from 'node:test'
  import { readFileSync } from 'node:fs'

  const dialog = readFileSync(
    new URL('../src/app/(dashboard)/market/[slug]/items/[itemId]/market-sample-preview-dialog.tsx', import.meta.url),
    'utf8'
  )
  const actions = readFileSync(
    new URL('../src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx', import.meta.url),
    'utf8'
  )

  test('market sample preview uses ttl-aware in-memory cache', () => {
    assert.match(dialog, /SAMPLE_PAGE_CACHE_SAFETY_MARGIN_MS/)
    assert.match(dialog, /samplePagePreviewCache/)
    assert.match(dialog, /samplePagePreviewRequests/)
    assert.match(dialog, /buildSamplePageCacheKey/)
    assert.match(dialog, /workspaceSubject.*itemId|itemId.*workspaceSubject/)
    assert.match(dialog, /expiresAt/)
    assert.match(dialog, /finally\(\(\) => \{\s*samplePagePreviewRequests\.delete\(cacheKey\)/s)
  })

  test('market sample preview supports intent prefetch and image loading priorities', () => {
    assert.match(actions, /onIntent/)
    assert.match(actions, /samplePreviewPrefetchKey/)
    assert.match(actions, /prefetchSamplePreview/)
    assert.match(actions, /!isLoggedIn \|\| !hasSamplePages/)
    assert.match(dialog, /prefetchKey/)
    assert.match(dialog, /loading=\{index === 0 \? 'eager' : 'lazy'\}/)
    assert.match(dialog, /decoding="async"/)
  })
  ```

- [ ] **Step 2.2: RED 확인**

  Run:

  ```bash
  node --test tests/market-sample-preview-performance-contract.test.mjs
  ```

  Expected:

  ```text
  FAIL: cache/prefetch/image priority 관련 assertion 실패
  ```

- [ ] **Step 2.3: Dialog cache 구현**

  Modify: `src/app/(dashboard)/market/[slug]/items/[itemId]/market-sample-preview-dialog.tsx`

  Add types/helpers near the top:

  ```ts
  interface SamplePage {
    pageNumber: number
    signedUrl: string
    fileSizeBytes: number | null
    widthPx: number | null
    heightPx: number | null
  }

  interface SamplePagesPayload {
    success?: boolean
    pages?: SamplePage[]
    expiresAt?: string
    error?: { message?: string }
  }

  interface CachedSamplePages {
    pages: SamplePage[]
    expiresAt: number
  }

  const SAMPLE_PAGE_CACHE_SAFETY_MARGIN_MS = 30 * 1000
  const samplePagePreviewCache = new Map<string, CachedSamplePages>()
  const samplePagePreviewRequests = new Map<string, Promise<SamplePage[]>>()

  function buildSamplePageCacheKey(itemId: string, workspaceSubject: WorkspaceSubject) {
    return `${workspaceSubject}:${itemId}`
  }

  function getCachedSamplePages(cacheKey: string) {
    const cached = samplePagePreviewCache.get(cacheKey)
    if (!cached) return null
    if (cached.expiresAt - Date.now() <= SAMPLE_PAGE_CACHE_SAFETY_MARGIN_MS) {
      samplePagePreviewCache.delete(cacheKey)
      return null
    }
    return cached.pages
  }

  async function fetchSamplePages(itemId: string, workspaceSubject: WorkspaceSubject, cacheKey: string) {
    const existingRequest = samplePagePreviewRequests.get(cacheKey)
    if (existingRequest) {
      return existingRequest
    }

    const request = (async () => {
      const response = await fetch(`/api/market/items/${itemId}/sample-pages?subject=${workspaceSubject}`, {
        cache: 'no-store',
      })
      const payload: SamplePagesPayload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '샘플 미리보기를 불러오지 못했습니다.')
      }

      const nextPages = payload.pages ?? []
      if (payload.expiresAt) {
        samplePagePreviewCache.set(cacheKey, {
          pages: nextPages,
          expiresAt: new Date(payload.expiresAt).getTime(),
        })
      }
      return nextPages
    })().finally(() => {
      samplePagePreviewRequests.delete(cacheKey)
    })

    samplePagePreviewRequests.set(cacheKey, request)
    return request
  }
  ```

  Extend props:

  ```ts
  interface MarketSamplePreviewDialogProps {
    itemId: string
    workspaceSubject: WorkspaceSubject
    open: boolean
    prefetchKey: number
    onOpenChange: (open: boolean) => void
  }
  ```

  Replace current `useEffect` loader with one loader function shared by open and prefetch. The loader must use `fetchSamplePages` so hover/focus/touch/open events sharing the same cache key reuse one in-flight Promise:

  ```ts
  const loadSamplePages = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    const cacheKey = buildSamplePageCacheKey(itemId, workspaceSubject)
    const cachedPages = getCachedSamplePages(cacheKey)
    if (cachedPages) {
      setPages(cachedPages)
      setErrorMessage(null)
      return
    }

    if (!silent) {
      setIsLoading(true)
    }
    setErrorMessage(null)

    try {
      const nextPages = await fetchSamplePages(itemId, workspaceSubject, cacheKey)
      setPages(nextPages)
    } catch (error) {
      if (!silent) {
        setPages([])
        setErrorMessage(error instanceof Error ? error.message : '샘플 미리보기를 불러오지 못했습니다.')
      }
    } finally {
      if (!silent) {
        setIsLoading(false)
      }
    }
  }, [itemId, workspaceSubject])
  ```

  Use effects:

  ```ts
  useEffect(() => {
    if (!open) return
    void loadSamplePages()
  }, [loadSamplePages, open])

  useEffect(() => {
    if (prefetchKey <= 0 || open) return
    void loadSamplePages({ silent: true })
  }, [loadSamplePages, open, prefetchKey])
  ```

  If the implementation needs `useCallback`, update import:

  ```ts
  import { useCallback, useEffect, useState } from 'react'
  ```

- [ ] **Step 2.4: GREEN 확인**

  Run:

  ```bash
  node --test tests/market-sample-preview-performance-contract.test.mjs
  ```

  Expected:

  ```text
  PASS for cache assertions
  ```

### Loop 3 — Prefetch intent wiring

- [ ] **Step 3.1: FileOptionRow intent prop 추가와 UI 계약 테스트 보강**

  Modify: `src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx`

  Modify: `tests/market-item-detail-ui-contract.test.mjs`

  Add assertions equivalent to:

  ```js
  test('market item sample preview prefetch intent is wired only for eligible users', () => {
    assert.match(actions, /onIntent\?: \(\) => void/)
    assert.match(actions, /onFocus=\{onIntent\}/)
    assert.match(actions, /onMouseEnter=\{onIntent\}/)
    assert.match(actions, /onTouchStart=\{onIntent\}/)
    assert.match(actions, /samplePreviewPrefetchKey/)
    assert.match(actions, /prefetchSamplePreview/)
    assert.match(actions, /!isLoggedIn \|\| !hasSamplePages/)
    assert.match(actions, /prefetchKey=\{samplePreviewPrefetchKey\}/)
  })
  ```

  Extend `FileOptionRow` props:

  ```ts
  function FileOptionRow({
    title,
    description,
    priceLabel,
    state,
    icon,
    actionLabel,
    href,
    disabled,
    onAction,
    onIntent,
  }: {
    title: string
    description: string
    priceLabel: string
    state: OptionState
    icon: ReactNode
    actionLabel: string
    href?: string
    disabled?: boolean
    onAction?: () => void
    onIntent?: () => void
  }) {
  ```

  Add handlers to the non-link `Button`:

  ```tsx
  <Button
    className={`h-10 rounded-lg px-4 ${buttonClassName}`}
    disabled={disabled}
    onClick={onAction}
    onFocus={onIntent}
    onMouseEnter={onIntent}
    onTouchStart={onIntent}
    aria-label={`${title} ${actionLabel}`}
  >
    {actionLabel}
  </Button>
  ```

- [ ] **Step 3.2: Prefetch key state 추가**

  In `MarketItemActions`, add:

  ```ts
  const [samplePreviewPrefetchKey, setSamplePreviewPrefetchKey] = useState(0)

  const prefetchSamplePreview = () => {
    if (!isLoggedIn || !hasSamplePages) {
      return
    }

    setSamplePreviewPrefetchKey((value) => value + 1)
  }
  ```

  Wire sample row:

  ```tsx
  <FileOptionRow
    title="샘플 미리보기"
    description={hasSamplePages
      ? `PDF 첫 1~3페이지 JPG 샘플 ${samplePageCount}장을 확인할 수 있습니다.`
      : hasLegacySample
        ? '기존 샘플 PDF는 판매용 PDF 재업로드 후 JPG 미리보기로 대체됩니다.'
        : '현재 제공되는 샘플 JPG가 없습니다.'}
    priceLabel="무료"
    state={hasSamplePages ? 'instant' : 'unavailable'}
    icon={<Sparkles className="h-5 w-5" />}
    actionLabel={hasSamplePages ? '샘플 미리보기' : '샘플 없음'}
    disabled={!hasSamplePages}
    onAction={hasSamplePages ? openSamplePreview : undefined}
    onIntent={hasSamplePages ? prefetchSamplePreview : undefined}
  />
  ```

  Pass prop:

  ```tsx
  <MarketSamplePreviewDialog
    itemId={itemId}
    workspaceSubject={workspaceSubject}
    open={isSamplePreviewOpen}
    prefetchKey={samplePreviewPrefetchKey}
    onOpenChange={setIsSamplePreviewOpen}
  />
  ```

- [ ] **Step 3.3: 계약 테스트 GREEN 확인**

  Run:

  ```bash
  node --test tests/market-sample-preview-performance-contract.test.mjs tests/market-item-detail-ui-contract.test.mjs
  ```

  Expected:

  ```text
  PASS
  ```

### Loop 4 — 이미지 로딩 제어

- [ ] **Step 4.1: 이미지 속성 추가**

  Modify: `market-sample-preview-dialog.tsx`

  Use index in `pages.map`:

  ```tsx
  {pages.map((page, index) => (
    <figure key={page.pageNumber} className="overflow-hidden rounded-xl border bg-white">
      <figcaption className="border-b bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">
        샘플 페이지 {page.pageNumber}
      </figcaption>
      {/* eslint-disable-next-line @next/next/no-img-element -- Signed Supabase preview URLs are short-lived and not suitable for Next image optimization. */}
      <img
        src={page.signedUrl}
        alt={`샘플 페이지 ${page.pageNumber}`}
        width={page.widthPx ?? undefined}
        height={page.heightPx ?? undefined}
        loading={index === 0 ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={index === 0 ? 'high' : 'low'}
        className="h-auto w-full"
      />
    </figure>
  ))}
  ```

- [ ] **Step 4.2: 계약 테스트 GREEN 확인**

  Run:

  ```bash
  node --test tests/market-sample-preview-performance-contract.test.mjs
  ```

  Expected:

  ```text
  PASS
  ```

### Loop 5 — 통합 검증

- [ ] **Step 5.1: 관련 Node tests 실행**

  Run:

  ```bash
  node --test \
    tests/market-sample-pages-api-contract.test.mjs \
    tests/market-sample-pages-schema-contract.test.mjs \
    tests/market-item-detail-ui-contract.test.mjs \
    tests/market-sample-preview-performance-contract.test.mjs \
    tests/market-auto-sample-generation-contract.test.mjs
  ```

  Expected:

  ```text
  PASS
  ```

- [ ] **Step 5.2: 대상 ESLint 실행**

  Run:

  ```bash
  npx eslint \
    'src/app/(dashboard)/market/[slug]/items/[itemId]/market-sample-preview-dialog.tsx' \
    'src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx' \
    'src/app/api/market/items/[itemId]/sample-pages/route.ts' \
    tests/market-sample-pages-api-contract.test.mjs \
    tests/market-sample-preview-performance-contract.test.mjs
  ```

  Expected:

  ```text
  exit code 0
  ```

- [ ] **Step 5.3: 전체 lint는 별도 분리 보고**

  Run:

  ```bash
  npm run lint
  ```

  Expected:

  ```text
  기존 unrelated lint 오류가 있으면 전체 실패와 대상 lint 통과를 분리해 보고한다.
  ```

- [ ] **Step 5.4: 빌드 실행**

  Run:

  ```bash
  npm run build
  ```

  Expected:

  ```text
  PASS. sandbox의 Turbopack process/port 제한 오류가 나오면 승인된 escalation으로 재실행한다.
  ```

- [ ] **Step 5.5: 브라우저 성능 검증**

  Use Browser/Playwright with a published item that has 3 sample pages.

  Measure:

  ```text
  cold open: click/open → first image load
  warm reopen: close → open within TTL → first image load
  prefetched open: hover/focus → click → first image load
  API call count during TTL reopen
  API call count during hover + focus + touch + click/open on the same row
  TTL safety margin 이후 reopen API call count
  subject=english item open 후 subject=korean 같은 itemId cache miss 여부
  ```

  Pass condition:

  ```text
  TTL 내 재오픈 API 호출 0회.
  같은 cache key의 hover/focus/touch/open 연속 이벤트는 in-flight 상태에서 /sample-pages 호출 1회 이하.
  TTL safety margin 이후 재오픈은 /sample-pages를 1회 재호출하고 샘플을 정상 표시.
  subject=english와 subject=korean은 서로 cache hit를 공유하지 않음.
  prefetched open 또는 warm reopen의 첫 이미지 표시가 baseline 대비 30% 이상 개선.
  ```

---

## 6. 수동 검증 시나리오

- [ ] 로그인 사용자: 샘플 버튼 hover/focus 후 클릭하면 다이얼로그가 빠르게 표시된다.
- [ ] 로그인 사용자: 닫고 1분 안에 다시 열면 `/sample-pages` API 재요청 없이 표시된다.
- [ ] 로그인 사용자: hover/focus/touch 연속 발생 후 클릭해도 동일 `itemId + workspaceSubject` 기준 `/sample-pages` 요청은 1회 이하로 유지된다.
- [ ] 로그인 사용자: URL 만료 safety margin 이후 다시 열면 API 재요청 후 정상 표시된다.
- [ ] 비로그인 사용자: 샘플 클릭 시 기존 로그인 리다이렉트가 유지된다.
- [ ] hidden/draft item: sample-pages API가 signed URL을 발급하지 않는다.
- [ ] `subject=english`와 `subject=korean` 캐시가 섞이지 않는다.
- [ ] PDF/HWP 구매 버튼, 잔액 확인, 구매 완료 후 `router.refresh()` 동작이 변하지 않는다.

---

## 7. 리스크와 완화

| 리스크 | 완화 |
|---|---|
| 만료된 signed URL cache 사용 | `expiresAt - 30초` safety margin 이전까지만 cache hit |
| subject 혼선 | cache key에 `${workspaceSubject}:${itemId}` 사용 |
| prefetch API 과다 호출 | 상세 페이지 단일 item에서 로그인 + 샘플 있음 + cache miss일 때만 요청하고, 같은 cache key의 in-flight Promise를 공유 |
| 비로그인 401 prefetch noise | parent에서 `isLoggedIn` 확인 후 prefetch signal 증가 |
| public/shared cache에 signed URL JSON 저장 | 1차 계획에서 HTTP shared cache를 도입하지 않고 `cache: 'no-store'` 유지 |
| 과도한 인프라 도입 | server-side cache/public bucket/image proxy는 1차 제외 |

---

## 8. ADR

### Decision

문제마켓 샘플 미리보기 1차 개선은 **private signed URL 유지 + 클라이언트 TTL cache + intent prefetch + 이미지 로딩 우선순위 제어**로 진행한다.

### Drivers

- 첫 이미지 표시 시간 개선.
- 인증/권한/상품 공개 상태 검증 유지.
- 작은 변경으로 빠른 체감 개선.

### Alternatives considered

- Server-side signed URL cache: API 비용 절감 효과는 있으나 인프라/TTL invalidation 리스크가 커서 후순위.
- Public sample bucket/path: 가장 빠르지만 샘플 공개 정책 변경이 필요해 1차 제외.
- Next Image/proxy: signed URL 만료와 서버 bandwidth/cache 설계가 복잡해 1차 제외.
- JPG 품질/해상도 조정: 효과가 있지만 가독성 검토와 기존 샘플 재생성 이슈가 있어 2차.

### Why chosen

현재 병목은 클릭 이후 API·signed URL·이미지 로딩 체인이 체감되는 구조다. 1차 개선안은 이 체인을 클릭 전으로 당기고, TTL 내 반복 호출을 제거하며, 첫 페이지 표시 우선순위를 높인다.

### Consequences

- 최초 cold click은 완전히 제거되지 않는다.
- prefetch로 클릭하지 않은 사용자에게도 일부 API 요청이 발생할 수 있다.
- signed URL cache 만료 처리 테스트가 필요하다.

### Follow-ups

- 실제 traffic에서 API p75/p95와 image load p75/p95를 수집한다.
- API 병목이 계속 크면 server-side short TTL cache를 별도 계획으로 검토한다.
- 이미지 다운로드가 병목이면 JPG 품질/해상도 또는 WebP/AVIF 생성 계획을 별도로 작성한다.

---

## 9. 검증 Loop 종료 기준

계획 구현 후 아래가 모두 통과하면 loop를 종료한다.

1. 관련 Node tests 통과.
2. 대상 ESLint 통과.
3. `npm run build` 통과.
4. 브라우저에서 TTL 내 재오픈 API 호출 0회 확인.
5. hover/focus/touch/open 연속 이벤트의 in-flight 중복 요청 방지 확인.
6. TTL safety margin 이후 재요청 1회와 정상 표시 확인.
7. prefetched/warm open 첫 이미지 표시 시간이 baseline 대비 30% 이상 개선.
8. 비로그인, hidden/draft item, workspace subject 회귀 없음.

검증 미통과 시 해당 단계의 원인을 재분석하고, 구현 범위를 넓히기 전에 같은 단계에서 재수정한다.

---

## 10. Multi-agent 분석 반영 기록

- analyst: 클릭 후 API/signed URL/image chain이 주 병목이며 PDF 변환은 클릭 병목이 아님을 확인.
- architect: 1차는 클라이언트 TTL cache + prefetch + lazy/async가 적절하고, server cache/public bucket은 후순위라고 판단.
- planner: API `expiresAt`, 클라이언트 cache, prefetch signal, image loading attributes를 단계별 구현 계획으로 분해.
- critic: 측정 없는 서버/DB/public URL 확장은 reject하고, signed URL 보안 경계와 TTL-aware cache를 승인 기준으로 제시.
- final critic loop: 1차 검토에서 in-flight dedupe, exact UI 계약 assertions, TTL/subject 검증 강화를 요구했고, 반영 후 `APPROVED`로 loop 종료.

---

## 11. Implementation handoff guidance

### Recommended subagent-driven execution

- Worker 1: `src/app/api/market/items/[itemId]/sample-pages/route.ts`, `tests/market-sample-pages-api-contract.test.mjs`
- Worker 2: `market-sample-preview-dialog.tsx`, `tests/market-sample-preview-performance-contract.test.mjs`
- Worker 3: `market-item-actions.tsx`, `tests/market-item-detail-ui-contract.test.mjs`
- Critic/verifier: 전체 diff, signed URL TTL, 권한 회귀, 브라우저 성능 측정 검토

### Suggested verification commands

```bash
node --test \
  tests/market-sample-pages-api-contract.test.mjs \
  tests/market-sample-pages-schema-contract.test.mjs \
  tests/market-item-detail-ui-contract.test.mjs \
  tests/market-sample-preview-performance-contract.test.mjs \
  tests/market-auto-sample-generation-contract.test.mjs

npx eslint \
  'src/app/(dashboard)/market/[slug]/items/[itemId]/market-sample-preview-dialog.tsx' \
  'src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx' \
  'src/app/api/market/items/[itemId]/sample-pages/route.ts' \
  tests/market-sample-pages-api-contract.test.mjs \
  tests/market-sample-preview-performance-contract.test.mjs

npm run build
```
