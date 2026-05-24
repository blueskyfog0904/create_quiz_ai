# Workspace Subject Color Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 영어 챕터는 첨부 이미지의 파란 계열, 국어 챕터는 첨부 이미지의 녹색 계열을 메인 색상으로 사용하도록 워크스페이스 랜딩과 문제마켓 상단 히어로 색상을 과목별로 분리한다.

**Architecture:** 글로벌 `--primary`, 공통 `Button` 기본 variant, 구매/결제 CTA는 유지하고, 과목별 진입 화면에 보이는 히어로/틴트/카드 accent와 문제마켓 목록·상세 상단 히어로만 색상 변경한다. 랜딩은 기존 `indigo`/`emerald` theme token 매핑을 보정하고, 문제마켓은 `WorkspaceSubject` 기반 helper로 목록/상세가 같은 색상 토큰을 소비하게 만든다.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind CSS class tokens, Node built-in test runner, Playwright/Browser manual verification.

---

## 0. 요청사항 파악 → 계획 작성 → 검증 Loop

### 요청사항 파악
- 영어 챕터 메인 색상: 첨부된 영어 메인 이미지의 파란 gradient 계열.
- 국어 챕터 메인 색상: 첨부된 국어 메인 이미지의 녹색/teal gradient 계열.
- 현재 문제점: 영어/국어 챕터 및 문제마켓 주요 히어로 영역이 검은색/슬레이트 계열로 보여 과목별 브랜드 구분이 약함.
- 범위 제한: 구매 버튼, 결제, 공통 버튼, 전역 primary 색상은 변경하지 않는다.

### 멀티에이전트 검증 요약
- **designer:** 색상 방향은 적절하나 문제마켓 label의 `text-blue-100` 같은 잔여 블루도 과목별로 정리해야 한다.
- **analyst:** `landing-page.ts` 기본값만 바꾸면 DB에 저장된 설정에는 적용되지 않을 수 있으므로 기존 `indigo`/`emerald` token 매핑을 유지하면서 색상 class를 바꾸는 것이 안전하다.
- **architect:** `workspace-theme.ts`를 과목별 UI accent 전용 helper로 한정하고, 글로벌 primary 대체 용도로 확장하지 않는다.
- **critic:** 밝은 gradient 위 흰색 텍스트 대비와 `/pricing`, 구매/결제 CTA 회귀를 브라우저에서 함께 확인해야 한다.

### 계획 작성 기준
- 최소 변경: 새 helper 1개, 랜딩 theme class 조정, 문제마켓 목록/상세 hero class 소비부만 수정.
- TDD: 색상 계약 테스트를 먼저 작성하고 실패를 확인한 뒤 구현한다.
- 검증 통과 조건:
  1. 계약 테스트가 새 색상 token과 subject-aware market helper 사용을 확인한다.
  2. `node --test` 관련 테스트가 통과한다.
  3. `npm run build`가 통과한다.
  4. 브라우저에서 `/english`, `/korean`, 영어/국어 문제마켓 목록, 영어 문제마켓 상세 상단이 지정 색상으로 보인다.
  5. 전역 `--primary`와 공통 `Button` 기본 variant가 변경되지 않았음을 테스트/소스 검증한다.

---

## File Structure

### Create
- `src/lib/workspace-theme.ts`
  - 문제마켓 등 subject-aware UI에서 사용할 영어/국어 색상 token을 중앙화한다.
  - `getWorkspaceSubjectTheme(subject)`를 export한다.

### Modify
- `src/components/features/landing/landing-view-shared.tsx`
  - 기존 `indigo`와 `emerald` theme token의 gradient, glow, tint, card accent class를 새 영어/국어 색상 방향으로 조정한다.
- `src/app/(dashboard)/market/[slug]/market-listboard.tsx`
  - 문제마켓 목록 hero가 `category.workspace_subject`에 따라 파란/녹색 gradient를 사용하도록 변경한다.
  - `workspaceLabel` 색상도 subject-aware class를 사용한다.
- `src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx`
  - 문제마켓 상세 hero가 `item.workspace_subject`에 따라 파란/녹색 gradient를 사용하도록 변경한다.
  - breadcrumb/description muted text 색상도 subject-aware class를 사용한다.
- `tests/workspace-subject-color-contract.test.mjs`
  - 새 색상 시스템 계약 테스트를 추가한다.
- `tests/market-item-detail-ui-contract.test.mjs`
  - 기존 슬레이트 hero 고정 검증을 subject-aware helper 검증으로 갱신한다.
- `tests/market-listboard-ui-contract.test.mjs`
  - 목록 hero가 subject-aware helper를 쓰는지 검증을 추가한다.

### Do Not Modify
- `src/app/globals.css`의 `--primary: #0A192F`
- `src/components/ui/button.tsx`의 기본 `bg-primary` variant
- 결제/구매 API와 credit 로직

---

## Phase 1: 색상 계약 테스트 작성

**Loop:** 계획 파악 → 실패 테스트 작성 → 실패 확인 → 다음 phase 진입

**Files:**
- Create: `tests/workspace-subject-color-contract.test.mjs`
- Modify: `tests/market-listboard-ui-contract.test.mjs`
- Modify: `tests/market-item-detail-ui-contract.test.mjs`

- [ ] **Step 1: 새 색상 계약 테스트 파일 작성**

Create `tests/workspace-subject-color-contract.test.mjs` with:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, existsSync } from 'node:fs'

const landingShared = readFileSync(
  new URL('../src/components/features/landing/landing-view-shared.tsx', import.meta.url),
  'utf8'
)
const globalsCss = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8')
const buttonSource = readFileSync(new URL('../src/components/ui/button.tsx', import.meta.url), 'utf8')
const workspaceThemeUrl = new URL('../src/lib/workspace-theme.ts', import.meta.url)

test('workspace landing themes use subject-specific blue and green hero palettes', () => {
  assert.match(landingShared, /heroGradient: 'from-blue-700 via-blue-600 to-sky-600'/)
  assert.match(landingShared, /heroGlow: 'bg-blue-500\/30'/)
  assert.match(landingShared, /cardAccentClass: 'from-blue-500\/10 via-sky-400\/5 to-cyan-400\/10'/)
  assert.match(landingShared, /sectionTintClass: 'from-blue-500\/5 via-transparent to-sky-500\/5'/)

  assert.match(landingShared, /heroGradient: 'from-emerald-700 via-teal-600 to-cyan-600'/)
  assert.match(landingShared, /heroGlow: 'bg-emerald-500\/30'/)
  assert.match(landingShared, /cardAccentClass: 'from-emerald-500\/10 via-teal-400\/5 to-cyan-400\/10'/)
  assert.match(landingShared, /sectionTintClass: 'from-emerald-500\/5 via-transparent to-cyan-500\/5'/)
})

test('subject market theme helper centralizes market hero palettes', () => {
  assert.equal(existsSync(workspaceThemeUrl), true)
  const workspaceTheme = readFileSync(workspaceThemeUrl, 'utf8')

  assert.match(workspaceTheme, /type WorkspaceSubject/)
  assert.match(workspaceTheme, /marketHeroClass: 'border-blue-200\/60 bg-gradient-to-br from-blue-700 via-blue-600 to-sky-600'/)
  assert.match(workspaceTheme, /marketHeroLabelClass: 'text-sky-100'/)
  assert.match(workspaceTheme, /marketHeroMutedTextClass: 'text-sky-100\/85'/)
  assert.match(workspaceTheme, /marketHeroClass: 'border-emerald-200\/60 bg-gradient-to-br from-emerald-700 via-teal-600 to-cyan-600'/)
  assert.match(workspaceTheme, /marketHeroLabelClass: 'text-emerald-100'/)
  assert.match(workspaceTheme, /marketHeroMutedTextClass: 'text-emerald-100\/85'/)
  assert.match(workspaceTheme, /export function getWorkspaceSubjectTheme\(subject: WorkspaceSubject\)/)
})

test('global primary and default button colors stay unchanged', () => {
  assert.match(globalsCss, /--primary:\s*#0A192F/)
  assert.match(buttonSource, /default:\s*'bg-primary text-primary-foreground shadow-xs hover:bg-primary\/90'/)
})
```

- [ ] **Step 2: 목록 contract 테스트에 subject-aware hero 검증 추가**

Append this test to `tests/market-listboard-ui-contract.test.mjs`:

```js
test('market listboard hero consumes subject-aware workspace theme classes', () => {
  assert.match(listboardServer, /getWorkspaceSubjectTheme/)
  assert.match(listboardServer, /const subjectTheme = getWorkspaceSubjectTheme\(category\.workspace_subject\)/)
  assert.match(listboardServer, /\$\{subjectTheme\.marketHeroClass\}/)
  assert.match(listboardServer, /\$\{subjectTheme\.marketHeroLabelClass\}/)
  assert.doesNotMatch(listboardServer, /bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800/)
  assert.doesNotMatch(listboardServer, /text-blue-100/)
})
```

- [ ] **Step 3: 상세 contract 테스트 갱신**

In `tests/market-item-detail-ui-contract.test.mjs`, replace this assertion inside `market item detail keeps a consistent product header and meta layout`:

```js
assert.match(itemPage, /bg-gradient-to-br from-slate-950/)
```

with:

```js
assert.match(itemPage, /getWorkspaceSubjectTheme/)
assert.match(itemPage, /const subjectTheme = getWorkspaceSubjectTheme\(item\.workspace_subject\)/)
assert.match(itemPage, /\$\{subjectTheme\.marketHeroClass\}/)
assert.match(itemPage, /\$\{subjectTheme\.marketHeroMutedTextClass\}/)
assert.doesNotMatch(itemPage, /bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800/)
```

- [ ] **Step 4: RED 검증**

Run:

```bash
node --test tests/workspace-subject-color-contract.test.mjs tests/market-listboard-ui-contract.test.mjs tests/market-item-detail-ui-contract.test.mjs
```

Expected:

```text
FAIL
```

Expected failure reason:
- `src/lib/workspace-theme.ts` does not exist yet.
- market list/detail still use slate gradient classes.
- landing theme still has old `indigo` gradient.

---

## Phase 2: 랜딩 색상 theme token 조정

**Loop:** 계획 파악 → 최소 구현 → phase 테스트 → 실패 시 색상 class만 재조정

**Files:**
- Modify: `src/components/features/landing/landing-view-shared.tsx`

- [ ] **Step 1: `indigo`와 `emerald` theme class 교체**

In `src/components/features/landing/landing-view-shared.tsx`, update only the returned class strings in `getWorkspaceLandingThemeStyles`:

```ts
export function getWorkspaceLandingThemeStyles(theme: LandingThemeToken) {
  switch (theme) {
    case 'emerald':
      return {
        heroGradient: 'from-emerald-700 via-teal-600 to-cyan-600',
        heroGlow: 'bg-emerald-500/30',
        badgeClass: 'border-white/20 bg-white/10 text-white',
        cardAccentClass: 'from-emerald-500/10 via-teal-400/5 to-cyan-400/10',
        ctaButtonClass: 'bg-white text-slate-900 hover:bg-slate-100',
        sectionTintClass: 'from-emerald-500/5 via-transparent to-cyan-500/5',
      }
    case 'neutral':
      return {
        heroGradient: 'from-slate-700 via-slate-600 to-zinc-500',
        heroGlow: 'bg-slate-500/30',
        badgeClass: 'border-white/20 bg-white/10 text-white',
        cardAccentClass: 'from-slate-500/10 via-zinc-400/5 to-slate-300/10',
        ctaButtonClass: 'bg-white text-slate-900 hover:bg-slate-100',
        sectionTintClass: 'from-slate-500/5 via-transparent to-zinc-500/5',
      }
    case 'indigo':
    default:
      return {
        heroGradient: 'from-blue-700 via-blue-600 to-sky-600',
        heroGlow: 'bg-blue-500/30',
        badgeClass: 'border-white/20 bg-white/10 text-white',
        cardAccentClass: 'from-blue-500/10 via-sky-400/5 to-cyan-400/10',
        ctaButtonClass: 'bg-white text-slate-900 hover:bg-slate-100',
        sectionTintClass: 'from-blue-500/5 via-transparent to-sky-500/5',
      }
  }
}
```

- [ ] **Step 2: main landing accent도 같은 방향으로 조정**

In the same file, update `getMainLandingAccentClass` so main page workspace cards do not keep older indigo tone:

```ts
export function getMainLandingAccentClass(theme: LandingThemeToken) {
  switch (theme) {
    case 'emerald':
      return 'from-emerald-500/20 via-teal-500/10 to-cyan-500/20'
    case 'neutral':
      return 'from-slate-500/20 via-slate-400/10 to-zinc-300/20'
    case 'indigo':
    default:
      return 'from-blue-500/20 via-sky-500/10 to-cyan-400/20'
  }
}
```

- [ ] **Step 3: 랜딩 색상 테스트 실행**

Run:

```bash
node --test tests/workspace-subject-color-contract.test.mjs
```

Expected:

```text
FAIL
```

Expected remaining failure reason:
- `src/lib/workspace-theme.ts` still does not exist.

---

## Phase 3: 문제마켓 subject-aware theme helper 추가

**Loop:** 계획 파악 → helper 추가 → market list/detail 연결 → contract 테스트 → 실패 시 helper 소비부만 재조정

**Files:**
- Create: `src/lib/workspace-theme.ts`
- Modify: `src/app/(dashboard)/market/[slug]/market-listboard.tsx`
- Modify: `src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx`

- [ ] **Step 1: subject-aware theme helper 생성**

Create `src/lib/workspace-theme.ts`:

```ts
import type { WorkspaceSubject } from './workspace-subject'

interface WorkspaceSubjectTheme {
  marketHeroClass: string
  marketHeroLabelClass: string
  marketHeroMutedTextClass: string
}

const englishWorkspaceTheme: WorkspaceSubjectTheme = {
  marketHeroClass: 'border-blue-200/60 bg-gradient-to-br from-blue-700 via-blue-600 to-sky-600',
  marketHeroLabelClass: 'text-sky-100',
  marketHeroMutedTextClass: 'text-sky-100/85',
}

const koreanWorkspaceTheme: WorkspaceSubjectTheme = {
  marketHeroClass: 'border-emerald-200/60 bg-gradient-to-br from-emerald-700 via-teal-600 to-cyan-600',
  marketHeroLabelClass: 'text-emerald-100',
  marketHeroMutedTextClass: 'text-emerald-100/85',
}

export function getWorkspaceSubjectTheme(subject: WorkspaceSubject): WorkspaceSubjectTheme {
  return subject === 'korean' ? koreanWorkspaceTheme : englishWorkspaceTheme
}
```

- [ ] **Step 2: 목록 hero에 helper 적용**

In `src/app/(dashboard)/market/[slug]/market-listboard.tsx`, add import:

```ts
import { getWorkspaceSubjectTheme } from '@/lib/workspace-theme'
```

Inside `MarketListboard`, after `workspaceLabel`:

```ts
const subjectTheme = getWorkspaceSubjectTheme(category.workspace_subject)
```

Replace the hero wrapper and label class:

```tsx
<div className={`overflow-hidden rounded-2xl border ${subjectTheme.marketHeroClass} p-6 text-white shadow-sm`}>
```

```tsx
<p className={`text-sm font-medium ${subjectTheme.marketHeroLabelClass}`}>{workspaceLabel}</p>
```

Replace the description color class:

```tsx
<p className={`mt-3 max-w-2xl text-sm leading-6 ${subjectTheme.marketHeroMutedTextClass}`}>
```

- [ ] **Step 3: 상세 hero에 helper 적용**

In `src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx`, add import:

```ts
import { getWorkspaceSubjectTheme } from '@/lib/workspace-theme'
```

After `fileLabels`:

```ts
const subjectTheme = getWorkspaceSubjectTheme(item.workspace_subject)
```

Replace `CardHeader` class:

```tsx
<CardHeader className={`border-b ${subjectTheme.marketHeroClass} py-8 text-white`}>
```

Replace breadcrumb muted text class:

```tsx
<div className={`flex flex-wrap items-center gap-2 text-sm ${subjectTheme.marketHeroMutedTextClass}`}>
```

Replace description class:

```tsx
<CardDescription className={`max-w-3xl ${subjectTheme.marketHeroMutedTextClass}`}>
```

Keep `WorkspaceLink className="hover:text-white"` unchanged.

- [ ] **Step 4: GREEN contract 검증**

Run:

```bash
node --test tests/workspace-subject-color-contract.test.mjs tests/market-listboard-ui-contract.test.mjs tests/market-item-detail-ui-contract.test.mjs
```

Expected:

```text
PASS
```

---

## Phase 4: 시각/회귀 검증

**Loop:** 계획 파악 → 브라우저 확인 → 문제가 보이면 Phase 2/3로 되돌아가 class 조정 → 재검증

**Files:**
- No code files expected unless visual check fails.

- [ ] **Step 1: 관련 테스트 전체 실행**

Run:

```bash
node --test tests/workspace-subject-color-contract.test.mjs tests/landing-page-config.test.mjs tests/workspace-landing-view-navigation.test.mjs tests/workspace-landing-layout.test.mjs tests/korean-landing-copy.test.mjs tests/market-listboard-ui-contract.test.mjs tests/market-item-detail-ui-contract.test.mjs
```

Expected:

```text
PASS
```

- [ ] **Step 2: targeted lint 실행**

Run:

```bash
npx eslint src/components/features/landing/landing-view-shared.tsx src/lib/workspace-theme.ts 'src/app/(dashboard)/market/[slug]/market-listboard.tsx' 'src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx' tests/workspace-subject-color-contract.test.mjs tests/market-listboard-ui-contract.test.mjs tests/market-item-detail-ui-contract.test.mjs
```

Expected:

```text
No errors
```

- [ ] **Step 3: production build 실행**

Run:

```bash
npm run build
```

Expected:

```text
Compiled successfully
```

- [ ] **Step 4: 전체 lint 실행 및 기존 unrelated 실패 분리**

Run:

```bash
npm run lint
```

Expected:

```text
PASS
```

If this command fails only in pre-existing unrelated files, record the failing file paths and messages separately in the final report. Do not claim full lint success in that case.

- [ ] **Step 5: 브라우저 시각 확인**

Start dev server if needed:

```bash
npm run dev
```

Open and verify:

```text
http://localhost:4000/english
http://localhost:4000/korean
http://localhost:4000/english/market/mock-exams
http://localhost:4000/korean/market/mock-exams
```

Expected visual results:
- `/english`: 상단 큰 hero가 파란 gradient 계열이다.
- `/korean`: 상단 큰 hero가 녹색/teal gradient 계열이다.
- `/english/market/mock-exams`: 문제마켓 hero가 파란 gradient 계열이고 검정/슬레이트 고정 hero가 아니다.
- `/korean/market/mock-exams`: 문제마켓 hero가 녹색/teal gradient 계열이고 검정/슬레이트 고정 hero가 아니다.
- 상단 header의 영어/국어 toggle, 구매 버튼, 결제 관련 버튼은 기존 dark primary 스타일을 유지한다.

- [ ] **Step 6: 상세 페이지 시각 확인**

Use an existing English market item URL shown in recent QA:

```text
http://localhost:4000/english/market/mock-exams/items/83bd9dde-5d44-444f-afc0-7a83aa589172
```

Expected:
- 상세 상단 hero가 파란 gradient 계열이다.
- `샘플 제공`, `PDF`, `HWP & PDF` badge는 흰색 반투명 badge로 유지된다.
- `샘플 미리보기`, `PDF 구매하기`, `HWP & PDF 구매하기` 버튼 색상은 이번 변경으로 바뀌지 않는다.

---

## Phase 5: 완료 조건 및 보고

**Loop:** 검증 결과 수집 → 변경 범위와 검증 증거 보고 → 실패 항목 있으면 원인 분리 후 재작업

- [ ] **Step 1: 변경 파일 확인**

Run:

```bash
git status --short
```

Expected changed files:

```text
 M src/components/features/landing/landing-view-shared.tsx
 M src/app/(dashboard)/market/[slug]/market-listboard.tsx
 M src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx
 M tests/market-listboard-ui-contract.test.mjs
 M tests/market-item-detail-ui-contract.test.mjs
?? src/lib/workspace-theme.ts
?? tests/workspace-subject-color-contract.test.mjs
```

- [ ] **Step 2: final report 작성**

Report in Korean:
- 요청사항 반영 범위: 영어=blue, 국어=green, 글로벌 primary 미변경.
- 실제 실행한 검증 명령과 결과.
- 브라우저 확인 URL과 확인 결과.
- `npm run lint`가 실패했다면 이번 변경과 무관한 기존 실패로 분리해 경로/메시지 요약.

- [ ] **Step 3: commit**

Because this session has a project-context directive to commit completed implementation work unless the user explicitly says not to, commit after implementation verification passes:

```bash
git add src/components/features/landing/landing-view-shared.tsx src/lib/workspace-theme.ts 'src/app/(dashboard)/market/[slug]/market-listboard.tsx' 'src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx' tests/workspace-subject-color-contract.test.mjs tests/market-listboard-ui-contract.test.mjs tests/market-item-detail-ui-contract.test.mjs
git commit -m "feat: add subject color themes"
```

Expected:

```text
[main <hash>] feat: add subject color themes
```

---

## Self-Review

### Spec coverage
- 영어 메인 색상 파란 계열: Phase 2의 `indigo` theme class 조정으로 반영한다.
- 국어 메인 색상 녹색 계열: Phase 2의 `emerald` theme class 조정으로 반영한다.
- 영어/국어 문제마켓 상단 검정 hero 제거: Phase 3의 `workspace-theme.ts` helper와 list/detail 적용으로 반영한다.
- 구매/결제/공통 버튼 회귀 방지: Phase 1 테스트와 Phase 4 브라우저 확인으로 검증한다.

### Placeholder scan
- 이 계획에는 미정 항목과 모호한 구현 위임 문구가 없다.
- 모든 변경 파일, 테스트 파일, 실행 명령, 기대 결과가 명시되어 있다.

### Type consistency
- `WorkspaceSubjectTheme`는 `marketHeroClass`, `marketHeroLabelClass`, `marketHeroMutedTextClass` 3개 필드를 정의한다.
- list/detail 컴포넌트는 모두 `getWorkspaceSubjectTheme(...)`의 동일 필드명을 소비한다.
- 테스트의 정규식도 동일 함수명과 필드명을 검증한다.
