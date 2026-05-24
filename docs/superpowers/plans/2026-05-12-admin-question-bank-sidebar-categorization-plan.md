# 관리자 문제은행 사이드바 카테고리화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 사이드패널에서 문제은행 관련 관리자 서비스를 `문제은행` 대메뉴 아래 소메뉴로 묶어, 문제 등록·목록·연도/교재·문제유형·백필 기능을 한 영역에서 찾을 수 있게 만든다.

**Architecture:** DB 저장 구조는 바꾸지 않는다. 기존 `workspace_settings.admin_sidebar_navigation`의 `{ items: string[] }`는 “href 순서”만 저장하고, `src/lib/admin-sidebar.ts`에 코드 정의된 virtual group resolver를 추가해 렌더링 단계에서만 `문제은행` 대메뉴와 하위 메뉴를 만든다. 이 방식은 기존 저장값·subject별 설정·RLS를 유지하면서 관리자 사이드바 UI만 계층화한다.

**Tech Stack:** Next.js App Router, React Client Component, TypeScript, Supabase `workspace_settings`, Node built-in test runner, ESLint.

---

## 0. 요구사항 파악 → 계획 작성 → 검증 루프 운영 원칙

앞으로 이 저장소의 계획 작업은 다음 루프가 통과될 때만 종료한다.

1. **요구사항 파악**
   - 사용자가 원하는 결과, 포함 범위, 제외 범위, 데이터 저장 방식, 검증 기준을 명시한다.
   - 기존 코드와 DB 구조를 읽고 Evidence / Inference를 분리한다.
2. **계획 작성**
   - 변경 파일, 작업 순서, 테스트 우선 단계, 검증 명령을 파일 단위로 작성한다.
   - DB 변경이 필요하면 migration/RLS/types 갱신을 포함한다. DB 변경이 필요 없으면 그 이유를 명시한다.
3. **검증**
   - 최소 architect, planner, critic, code-reviewer, explore 역할의 병렬 검토를 거친다.
   - 하나라도 FAIL이면 계획을 수정하고 다시 검증한다.
   - PASS 기준은 “요구사항 충족 + 기존 저장 구조 호환 + subject 보존 + 테스트 가능 + 불필요한 DB 변경 없음”이다.

이번 계획은 위 루프를 따른다.

---

## 1. 요구사항 파악

### 1.1 사용자가 원하는 것

관리자 화면의 왼쪽 사이드패널에서 문제은행 관련 기능이 현재 flat menu로 흩어져 있다. 이를 `문제은행`이라는 대메뉴 아래 소메뉴로 정리한다.

### 1.2 이번 범위에 포함되는 관리자 서비스

다음은 현재 관리자 문제은행 기능의 실제 route/API와 연결된 메뉴다.

| 소메뉴 라벨 | 관리자 route | 현재 기능 |
| --- | --- | --- |
| 문제 목록 | `/admin/questions` | 업로드된 문제은행 문제 조회/검색/필터/수정 진입 |
| 문제 업로드 | `/admin/questions/upload` | 개별/일괄 문제 등록, 템플릿 다운로드 |
| 연도·교재 설정 | `/admin/question-bank/options` | `question_bank_years`, `question_bank_books` 관리 |
| 문제유형 설정 | `/admin/question-bank/problem-types` | 문제은행 전용 `question_bank_problem_types` 관리 |
| 데이터 감사·백필 | `/admin/question-bank/backfill` | 기존 관리자 원본/저장본 문제은행 메타데이터 감사·백필 |

### 1.3 이번 범위에서 제외하는 것

- 사용자-facing 헤더 메뉴의 `/bank` 복구 또는 `영어문제마켓/라이브러리` 재편성은 하지 않는다.
- `/library/purchased`, `/library/exam-papers`를 관리자 `문제은행` 대메뉴 아래에 넣지 않는다.
- `workspace_settings.header_navigation`은 변경하지 않는다.
- 문제은행용 신규 DB 테이블은 만들지 않는다.
- 관리자 메뉴에서 카테고리명 자체를 편집하는 기능은 만들지 않는다.
- 메뉴 숨김 기능은 만들지 않는다. 현재 admin sidebar 저장 모델은 숨김이 아니라 순서 관리다.

### 1.4 기존 구조 Evidence

- `src/lib/admin-sidebar.ts:21-48`
  - 관리자 사이드바 설정 키는 `admin_sidebar_navigation`이다.
  - 저장 타입은 `AdminSidebarNavigationConfig = { items: string[] }`이다.
  - menu item 타입은 `name`, `href`, `icon`, `exact?`만 가진다.
- `src/lib/admin-sidebar.ts:50-73`, `93-116`
  - 문제은행 관련 href가 이미 기본 admin sidebar 목록에 있다.
  - 현재는 `/admin/questions`, `/admin/question-bank/options`, `/admin/question-bank/problem-types`, `/admin/question-bank/backfill`, `/admin/questions/upload`가 flat item이다.
- `src/lib/admin-sidebar.ts:119-155`
  - 저장된 href는 default href whitelist 기준으로 dedupe되고, 누락된 default는 append된다.
- `src/lib/admin-sidebar-server.ts:9-34`
  - `workspace_settings`에서 subject별 admin sidebar config를 읽고 저장한다.
- `supabase/migrations/20260331100000_create_workspace_settings.sql:3-13`, `39-68`
  - `workspace_settings.value`는 `jsonb`이고 `(workspace_subject, setting_key)`가 unique다.
  - RLS가 활성화되어 있고 admin policy만 허용된다.
- `src/components/layout/admin-sidebar-client.tsx:79-107`
  - 현재 renderer는 flat `resolvedMenuItems.map(...)`만 지원한다.
  - 모든 admin 링크는 `withAdminWorkspaceSubject(item.href, workspaceSubject)`로 subject query를 보존한다.
- `src/app/(admin)/admin/menu-management/menu-management-client.tsx:939-980`
  - 메뉴관리 화면의 “관리자 패널 메뉴 순서”도 flat table로 이동/저장한다.

### 1.5 설계 판단

**Inference:** 사용자가 요구한 것은 “관리자 사이드패널 UI 분류”다. 기존 문제은행 데이터 모델과 저장 구조는 이미 분리되어 있으므로 DB schema 변경은 필요하지 않다.

**Decision:** `workspace_settings.admin_sidebar_navigation`에는 계속 href 배열만 저장한다. `문제은행` 대메뉴는 코드 정의 virtual group으로 만든다.

---

## 2. DB 설계 계획

### 2.1 변경 없음

이번 기능을 위해 Supabase migration은 작성하지 않는다.

이유:

1. 관리자 사이드바는 이미 `workspace_settings`의 JSON config로 subject별 순서를 저장한다.
2. 이번 요구는 route를 추가하거나 문제은행 데이터를 새로 저장하는 것이 아니라, 기존 admin route를 시각적으로 그룹화하는 것이다.
3. `workspace_settings.value`를 tree schema로 바꾸면 기존 저장값과 menu-management를 크게 바꿔야 한다.
4. 새 테이블을 만들면 RLS/API/server action/UI가 모두 늘어나는데, 현재 요구 대비 과하다.

### 2.2 유지해야 할 DB contract

- `workspace_settings.setting_key = 'admin_sidebar_navigation'`
- 저장 payload:

```json
{
  "items": [
    "/admin",
    "/admin/menu-management",
    "/admin/questions",
    "/admin/questions/upload",
    "/admin/question-bank/options"
  ]
}
```

- `items`에는 query string을 저장하지 않는다.
- `items`에는 코드에서 허용한 admin href만 저장한다.
- `workspace_subject`는 `english`, `korean` 각각 별도 row로 유지한다.

### 2.3 향후 category 편집 기능이 필요할 때의 별도 범위

관리자가 카테고리명·카테고리 구성·대메뉴 자체를 DB에서 편집해야 한다면 이번 계획을 확장하지 말고 별도 계획으로 분리한다. 그때는 다음 중 하나를 선택한다.

- `workspace_settings.admin_sidebar_navigation_v2`에 tree schema 도입
- `admin_sidebar_menu_entries` 신규 테이블 도입

이번 계획은 두 방식을 채택하지 않는다.

---

## 3. 최종 UI 구조

관리자 사이드바에는 다음처럼 표시한다.

```text
대시보드
메뉴관리
랜딩페이지 관리
문제마켓 상품 관리
문제생성 상품 관리
AI 문제 유형 관리
문제은행
  문제 목록
  문제 업로드
  연도·교재 설정
  문제유형 설정
  데이터 감사·백필
영어지문 관리 / 국어지문 관리
사용자 관리
...
```

`문제은행` 대메뉴는 route를 직접 바꾸지 않는 visual group이다. 하위 링크만 실제 navigation target이다. 위 순서는 신규 기본값 기준이다. 이미 `workspace_settings.admin_sidebar_navigation`이 저장된 워크스페이스에서는 저장된 href 배열의 순서를 우선하며, 메뉴관리에서 `문제은행` group row를 이동하면 하위 href 5개가 block으로 함께 이동한다.

---

## 4. 파일 구조

### Modify

- `tests/admin-sidebar-navigation.test.mjs`
  - 문제은행 그룹 resolver 계약 테스트 추가
  - admin sidebar client가 grouped resolver를 쓰는지 확인
  - menu-management가 문제은행 그룹을 인지하는지 확인
- `src/lib/admin-sidebar.ts`
  - 문제은행 그룹 href 상수 추가
  - `AdminSidebarNavigationNode` 타입 추가
  - `resolveAdminSidebarNavigationNodes` 추가
  - `moveAdminSidebarNavigationNode`, `moveAdminSidebarHref` 이동 helper 추가
  - 문제은행 하위 메뉴 라벨 정리
  - default href 순서에서 `/admin/questions/upload`를 문제은행 구간으로 이동
- `src/components/layout/admin-sidebar-client.tsx`
  - flat renderer를 node renderer로 변경
  - `문제은행` group header와 child links 렌더링
  - active link에 `aria-current="page"` 추가
  - subject query 보존 유지
- `src/app/(admin)/admin/menu-management/menu-management-client.tsx`
  - 관리자 패널 메뉴 순서 UI에 문제은행 group header 표시
  - 이동 버튼을 group-aware로 조정
  - 저장 payload는 기존 `{ items: string[] }` 유지

### Not modified

- Supabase migrations
- `src/types/supabase.ts`
- `src/lib/admin-sidebar-server.ts`
- 문제은행 API routes
- 사용자-facing header/navigation/library routes

---

## 5. Task 0: 작업트리 보호 및 변경 범위 고정

**Files:**
- No implementation file edits in this task.

- [ ] **Step 1: 대상 파일의 기존 미커밋 diff 확인**

Run:

```bash
git status --short -- \
  tests/admin-sidebar-navigation.test.mjs \
  src/lib/admin-sidebar.ts \
  src/components/layout/admin-sidebar-client.tsx \
  'src/app/(admin)/admin/menu-management/menu-management-client.tsx'
```

Expected:

```text
# 현재 작업트리에 기존 변경이 있으면 여기에서 확인한다.
# 기존 변경이 있더라도 되돌리지 말고, 이후 edit은 이 계획 범위와 충돌하지 않게 보존한다.
```

- [ ] **Step 2: 대상 파일 기존 diff를 임시 보관**

Run:

```bash
git diff -- \
  tests/admin-sidebar-navigation.test.mjs \
  src/lib/admin-sidebar.ts \
  src/components/layout/admin-sidebar-client.tsx \
  'src/app/(admin)/admin/menu-management/menu-management-client.tsx' \
  > /tmp/admin-question-bank-sidebar-before.diff
```

Expected:

```text
# command exits 0; /tmp/admin-question-bank-sidebar-before.diff contains any pre-existing local edits for reference.
```

---

## 6. Task 1: 실패하는 계약 테스트 추가

**Files:**
- Modify: `tests/admin-sidebar-navigation.test.mjs`

- [ ] **Step 1: import에 신규 resolver/상수 추가**

`tests/admin-sidebar-navigation.test.mjs`의 import를 아래처럼 확장한다.

```js
import {
  ADMIN_QUESTION_BANK_MENU_HREFS,
  DEFAULT_ADMIN_SIDEBAR_NAVIGATION_CONFIG,
  moveAdminSidebarHref,
  moveAdminSidebarNavigationNode,
  normalizeAdminSidebarNavigationConfig,
  resolveAdminSidebarMenuItems,
  resolveAdminSidebarNavigationNodes,
} from '../src/lib/admin-sidebar.ts'
```

- [ ] **Step 2: 문제은행 그룹 계약 테스트 추가**

기존 테스트 아래에 다음 테스트를 추가한다.

```js
test('resolveAdminSidebarNavigationNodes groups question bank admin services under one parent', () => {
  const nodes = resolveAdminSidebarNavigationNodes('english', {
    items: [
      '/admin/questions/upload',
      '/admin/users',
      '/admin/questions',
      '/admin/question-bank/problem-types',
      '/admin/question-bank/options',
      '/admin/question-bank/backfill',
    ],
  })

  const questionBankNode = nodes.find((node) => node.type === 'group' && node.id === 'questionBank')

  assert.ok(questionBankNode)
  assert.equal(questionBankNode.name, '문제은행')
  assert.equal(questionBankNode.icon, 'database')
  assert.deepEqual(
    questionBankNode.items.map((item) => item.href),
    [
      '/admin/questions/upload',
      '/admin/questions',
      '/admin/question-bank/problem-types',
      '/admin/question-bank/options',
      '/admin/question-bank/backfill',
    ]
  )
  assert.deepEqual([...ADMIN_QUESTION_BANK_MENU_HREFS], [
    '/admin/questions',
    '/admin/questions/upload',
    '/admin/question-bank/options',
    '/admin/question-bank/problem-types',
    '/admin/question-bank/backfill',
  ])
  assert.equal(nodes.some((node) => node.type === 'item' && node.item.href === '/admin/questions'), false)
  assert.equal(nodes.some((node) => node.type === 'item' && node.item.href === '/admin/questions/upload'), false)
})
```

이 테스트는 “저장 순서가 있으면 그룹 내부는 저장 순서를 따른다”는 contract도 함께 고정한다. 기본 UI 예시는 신규 기본값 기준이며, 기존 `workspace_settings.admin_sidebar_navigation` 값이 이미 저장되어 있으면 저장된 하위 메뉴 순서를 우선한다.

- [ ] **Step 3: 기존 flat resolver 호환 테스트 추가**

```js
test('resolveAdminSidebarMenuItems remains a flat compatibility resolver', () => {
  const items = resolveAdminSidebarMenuItems('english', {
    items: ['/admin/questions', '/admin/questions/upload'],
  })

  assert.equal(Array.isArray(items), true)
  assert.equal(items[0].href, '/admin/questions')
  assert.equal(items[1].href, '/admin/questions/upload')
  assert.equal(items.some((item) => item.name === '문제 목록'), true)
  assert.equal(items.some((item) => item.name === '문제 업로드'), true)
})
```

- [ ] **Step 4: client/menu-management 소스 계약 테스트 추가**

```js
test('admin sidebar client renders grouped question bank navigation and preserves subject query', () => {
  assert.match(adminSidebarClientSource, /resolveAdminSidebarNavigationNodes/)
  assert.match(adminSidebarClientSource, /aria-current=\{active \? 'page' : undefined\}/)
  assert.match(adminSidebarClientSource, /href=\{withAdminWorkspaceSubject\(item\.href, workspaceSubject\)\}/)
})

test('menu management presents question bank entries as an admin sidebar group without changing storage shape', () => {
  assert.match(menuManagementSource, /resolveAdminSidebarNavigationNodes/)
  assert.match(menuManagementSource, /문제은행/)
  assert.match(menuManagementSource, /saveAdminSidebarNavigationConfigAction/)
  assert.match(menuManagementSource, /handleMoveAdminSidebarNode/)
  assert.match(menuManagementSource, /handleMoveAdminSidebarChild/)
  assert.match(menuManagementSource, /aria-label=\{`\$\{node\.name\} 대메뉴 위로 이동`\}/)
  assert.match(menuManagementSource, /aria-label=\{`\$\{node\.name\} \$\{item\.name\} 위로 이동`\}/)
})
```

- [ ] **Step 5: 문제은행 대메뉴 block 이동 계약 테스트 추가**

```js
test('moveAdminSidebarNavigationNode moves the question bank group as one href block', () => {
  const items = [
    '/admin',
    '/admin/questions',
    '/admin/questions/upload',
    '/admin/question-bank/options',
    '/admin/question-bank/problem-types',
    '/admin/question-bank/backfill',
    '/admin/passages',
  ]
  const nodes = resolveAdminSidebarNavigationNodes('english', { items })
  const moved = moveAdminSidebarNavigationNode(items, nodes, 'questionBank', 'down')

  assert.deepEqual(moved.slice(0, 2), ['/admin', '/admin/passages'])
  assert.deepEqual(moved.slice(2, 7), [...ADMIN_QUESTION_BANK_MENU_HREFS])
  assert.equal(Array.isArray(moved), true)
})
```

- [ ] **Step 6: 흩어진 legacy 저장값의 group block 이동 계약 테스트 추가**

```js
test('moveAdminSidebarNavigationNode condenses scattered question bank hrefs into one moved block', () => {
  const items = [
    '/admin/questions/upload',
    '/admin/users',
    '/admin/questions',
    '/admin/question-bank/problem-types',
    '/admin/question-bank/options',
    '/admin/question-bank/backfill',
    '/admin/passages',
  ]
  const nodes = resolveAdminSidebarNavigationNodes('english', { items })
  const moved = moveAdminSidebarNavigationNode(items, nodes, 'questionBank', 'down')
  const nonQuestionBankHrefs = moved.filter((href) => !ADMIN_QUESTION_BANK_MENU_HREFS.includes(href))

  assert.deepEqual(moved.slice(0, 6), [
    '/admin/users',
    '/admin/questions/upload',
    '/admin/questions',
    '/admin/question-bank/problem-types',
    '/admin/question-bank/options',
    '/admin/question-bank/backfill',
  ])
  assert.deepEqual(nonQuestionBankHrefs.slice(0, 2), ['/admin/users', '/admin/passages'])
  assert.equal(new Set(moved).size, moved.length)
})
```

- [ ] **Step 7: 문제은행 하위 메뉴 내부 이동 계약 테스트 추가**

```js
test('moveAdminSidebarHref reorders only question bank child href peers', () => {
  const items = [
    '/admin',
    '/admin/questions',
    '/admin/questions/upload',
    '/admin/question-bank/options',
    '/admin/passages',
  ]
  const moved = moveAdminSidebarHref(
    items,
    '/admin/questions/upload',
    ['/admin/questions', '/admin/questions/upload', '/admin/question-bank/options'],
    'up'
  )

  assert.deepEqual(moved, [
    '/admin',
    '/admin/questions/upload',
    '/admin/questions',
    '/admin/question-bank/options',
    '/admin/passages',
  ])
})
```

- [ ] **Step 8: 실패 확인**

Run:

```bash
node --test tests/admin-sidebar-navigation.test.mjs
```

Expected before implementation:

```text
not ok ... resolveAdminSidebarNavigationNodes ...
```

---

## 7. Task 2: `src/lib/admin-sidebar.ts`에 virtual group resolver 추가

**Files:**
- Modify: `src/lib/admin-sidebar.ts`

- [ ] **Step 1: 문제은행 href 상수와 node 타입 추가**

`AdminSidebarNavigationConfig` 아래에 추가한다.

```ts
export const ADMIN_QUESTION_BANK_MENU_HREFS = [
  '/admin/questions',
  '/admin/questions/upload',
  '/admin/question-bank/options',
  '/admin/question-bank/problem-types',
  '/admin/question-bank/backfill',
] as const

const ADMIN_QUESTION_BANK_MENU_HREF_SET = new Set<string>(ADMIN_QUESTION_BANK_MENU_HREFS)

export interface AdminSidebarMenuGroupNode {
  type: 'group'
  id: 'questionBank'
  name: string
  icon: AdminSidebarIconName
  items: AdminSidebarMenuItem[]
}

export interface AdminSidebarMenuItemNode {
  type: 'item'
  item: AdminSidebarMenuItem
}

export type AdminSidebarNavigationNode = AdminSidebarMenuGroupNode | AdminSidebarMenuItemNode
```

- [ ] **Step 2: default order와 labels 정리**

`DEFAULT_ADMIN_SIDEBAR_NAVIGATION_CONFIG.items`에서 문제은행 관련 항목을 한 구간으로 정리한다.

```ts
    '/admin/problem-types',
    '/admin/questions',
    '/admin/questions/upload',
    '/admin/question-bank/options',
    '/admin/question-bank/problem-types',
    '/admin/question-bank/backfill',
    '/admin/passages',
```

`getDefaultAdminSidebarMenuItems`의 문제은행 labels를 정리한다.

```ts
    { name: '문제 목록', href: '/admin/questions', icon: 'database', exact: true },
    { name: '문제 업로드', href: '/admin/questions/upload', icon: 'upload' },
    { name: '연도·교재 설정', href: '/admin/question-bank/options', icon: 'settings' },
    { name: '문제유형 설정', href: '/admin/question-bank/problem-types', icon: 'settings' },
    { name: '데이터 감사·백필', href: '/admin/question-bank/backfill', icon: 'database' },
```

- [ ] **Step 3: node resolver 추가**

`resolveAdminSidebarMenuItems` 아래에 추가한다.

```ts
export function resolveAdminSidebarNavigationNodes(
  workspaceSubject: WorkspaceSubject,
  config?: AdminSidebarNavigationConfig | null
): AdminSidebarNavigationNode[] {
  const items = resolveAdminSidebarMenuItems(workspaceSubject, config)
  const questionBankItems = items.filter((item) => ADMIN_QUESTION_BANK_MENU_HREF_SET.has(item.href))
  const firstQuestionBankIndex = items.findIndex((item) => ADMIN_QUESTION_BANK_MENU_HREF_SET.has(item.href))

  if (questionBankItems.length === 0 || firstQuestionBankIndex < 0) {
    return items.map((item) => ({ type: 'item', item }))
  }

  const nodes: AdminSidebarNavigationNode[] = []

  items.forEach((item, index) => {
    if (ADMIN_QUESTION_BANK_MENU_HREF_SET.has(item.href)) {
      if (index === firstQuestionBankIndex) {
        nodes.push({
          type: 'group',
          id: 'questionBank',
          name: '문제은행',
          icon: 'database',
          items: questionBankItems,
        })
      }
      return
    }

    nodes.push({ type: 'item', item })
  })

  return nodes
}
```

- [ ] **Step 4: 이동 helper 추가**

`resolveAdminSidebarNavigationNodes` 아래에 추가한다. `moveAdminSidebarNavigationNode`는 top-level node 이동용이다. `문제은행` group을 이동하면 group 안의 href들이 block으로 함께 이동하고, 저장값은 여전히 `string[]`이다. `moveAdminSidebarHref`는 group 내부 child 순서 조정용이다.

```ts
function getAdminSidebarNodeKey(node: AdminSidebarNavigationNode) {
  return node.type === 'group' ? node.id : node.item.href
}

function getAdminSidebarNodeHrefs(node: AdminSidebarNavigationNode) {
  return node.type === 'group' ? node.items.map((item) => item.href) : [node.item.href]
}

export function moveAdminSidebarHref(
  items: string[],
  href: string,
  peerHrefs: readonly string[],
  direction: 'up' | 'down'
) {
  const currentPeerIndex = peerHrefs.indexOf(href)
  const nextPeerIndex = direction === 'up' ? currentPeerIndex - 1 : currentPeerIndex + 1

  if (currentPeerIndex < 0 || nextPeerIndex < 0 || nextPeerIndex >= peerHrefs.length) {
    return items
  }

  const currentIndex = items.indexOf(href)
  const nextIndex = items.indexOf(peerHrefs[nextPeerIndex])

  if (currentIndex < 0 || nextIndex < 0) {
    return items
  }

  const nextItems = [...items]
  const currentHref = nextItems[currentIndex]
  nextItems[currentIndex] = nextItems[nextIndex]
  nextItems[nextIndex] = currentHref
  return nextItems
}

export function moveAdminSidebarNavigationNode(
  items: string[],
  nodes: AdminSidebarNavigationNode[],
  nodeKey: string,
  direction: 'up' | 'down'
) {
  const currentNodeIndex = nodes.findIndex((node) => getAdminSidebarNodeKey(node) === nodeKey)
  const targetNodeIndex = direction === 'up' ? currentNodeIndex - 1 : currentNodeIndex + 1

  if (currentNodeIndex < 0 || targetNodeIndex < 0 || targetNodeIndex >= nodes.length) {
    return items
  }

  const currentHrefs = getAdminSidebarNodeHrefs(nodes[currentNodeIndex])
  const targetHrefs = getAdminSidebarNodeHrefs(nodes[targetNodeIndex])
  const currentHrefSet = new Set(currentHrefs)
  const withoutCurrent = items.filter((href) => !currentHrefSet.has(href))
  const targetIndexes = targetHrefs
    .map((href) => withoutCurrent.indexOf(href))
    .filter((index) => index >= 0)

  if (targetIndexes.length === 0) {
    return items
  }

  const insertIndex = direction === 'up'
    ? Math.min(...targetIndexes)
    : Math.max(...targetIndexes) + 1
  const nextItems = [...withoutCurrent]
  nextItems.splice(insertIndex, 0, ...currentHrefs)
  return nextItems
}
```

- [ ] **Step 5: 테스트 실행**

Run:

```bash
node --test tests/admin-sidebar-navigation.test.mjs
```

Expected after Task 2:

```text
ok ... resolveAdminSidebarNavigationNodes groups question bank admin services under one parent
ok ... resolveAdminSidebarMenuItems remains a flat compatibility resolver
ok ... moveAdminSidebarNavigationNode moves the question bank group as one href block
ok ... moveAdminSidebarNavigationNode condenses scattered question bank hrefs into one moved block
ok ... moveAdminSidebarHref reorders only question bank child href peers
```

Client/menu-management source tests는 아직 FAIL이어야 한다.

---

## 8. Task 3: 관리자 사이드바 UI를 group renderer로 변경

**Files:**
- Modify: `src/components/layout/admin-sidebar-client.tsx`

- [ ] **Step 1: import 변경**

```ts
import {
  adminSidebarIconComponents,
  resolveAdminSidebarNavigationNodes,
  type AdminSidebarMenuItem,
  type AdminSidebarNavigationConfig,
} from '@/lib/admin-sidebar'
```

- [ ] **Step 2: resolved data를 nodes로 변경**

```ts
  const resolvedNavigationNodes = useMemo(
    () => resolveAdminSidebarNavigationNodes(workspaceSubject, navigationConfigs[workspaceSubject]),
    [navigationConfigs, workspaceSubject]
  )

  const isActive = (item: AdminSidebarMenuItem) => {
    if (item.exact) {
      return pathname === item.href
    }
    return pathname.startsWith(item.href)
  }
```

- [ ] **Step 3: link renderer 추가**

`return` 직전에 추가한다.

```tsx
  const renderMenuLink = (item: AdminSidebarMenuItem, variant: 'root' | 'child' = 'root') => {
    const Icon = adminSidebarIconComponents[item.icon]
    const active = isActive(item)

    return (
      <Link
        key={item.href}
        href={withAdminWorkspaceSubject(item.href, workspaceSubject)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors',
          variant === 'child' && !collapsed && 'py-2 pl-3',
          active ? 'bg-orange-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white',
          collapsed && 'md:justify-center md:px-2'
        )}
        title={collapsed ? item.name : undefined}
        onClick={() => {
          if (window.innerWidth < 768) {
            setCollapsed(true)
          }
        }}
      >
        <Icon className={cn('h-5 w-5 flex-shrink-0', variant === 'child' && !collapsed && 'h-4 w-4')} />
        <span className={cn('text-sm font-medium', collapsed && 'md:hidden')}>
          {item.name}
        </span>
      </Link>
    )
  }
```

- [ ] **Step 4: nav 렌더링 변경**

기존 `resolvedMenuItems.map` 블록을 다음으로 교체한다.

```tsx
        <nav className="space-y-1 p-2">
          {resolvedNavigationNodes.map((node) => {
            if (node.type === 'item') {
              return renderMenuLink(node.item)
            }

            const Icon = adminSidebarIconComponents[node.icon]
            const groupActive = node.items.some((item) => isActive(item))

            return (
              <div key={node.id} className="space-y-1" role="group" aria-label={`${node.name} 메뉴`}>
                {!collapsed ? (
                  <div
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold',
                      groupActive ? 'text-orange-300' : 'text-slate-400'
                    )}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    <span>{node.name}</span>
                  </div>
                ) : null}
                <div className={cn('space-y-1', !collapsed && 'ml-4 border-l border-slate-700 pl-2')}>
                  {node.items.map((item) => renderMenuLink(item, 'child'))}
                </div>
              </div>
            )
          })}
        </nav>
```

- [ ] **Step 5: 테스트 실행**

Run:

```bash
node --test tests/admin-sidebar-navigation.test.mjs
```

Expected after Task 3:

```text
ok ... admin sidebar client renders grouped question bank navigation and preserves subject query
```

menu-management source test는 아직 FAIL이어야 한다.

---

## 9. Task 4: 메뉴관리 UI를 group-aware로 조정

**Files:**
- Modify: `src/app/(admin)/admin/menu-management/menu-management-client.tsx`

**정책:** 관리자 메뉴관리에서 `문제은행`은 top-level node로 취급한다. group header의 위/아래 버튼은 문제은행 href 5개를 block으로 이동한다. group 내부 child의 위/아래 버튼은 문제은행 하위 메뉴끼리만 순서를 바꾼다. 저장 payload는 계속 `{ items: string[] }`이다.

- [ ] **Step 1: import 변경**

```ts
import {
  moveAdminSidebarHref,
  moveAdminSidebarNavigationNode,
  resolveAdminSidebarNavigationNodes,
  type AdminSidebarMenuGroupNode,
  type AdminSidebarMenuItem,
  type AdminSidebarMenuItemNode,
  type AdminSidebarNavigationConfig,
  type AdminSidebarNavigationNode,
} from '@/lib/admin-sidebar'
```

- [ ] **Step 2: 기존 `adminSidebarItems` memo를 grouped nodes memo로 교체**

기존 `adminSidebarItems = useMemo(() => resolveAdminSidebarMenuItems(...))` memo를 제거하고 다음으로 교체한다. 이 변경 후 `resolveAdminSidebarMenuItems` import도 남기지 않는다.

```ts
  const adminSidebarNavigationNodes = useMemo(
    () => resolveAdminSidebarNavigationNodes(workspaceSubject, adminSidebarConfig),
    [adminSidebarConfig, workspaceSubject]
  )
```

- [ ] **Step 3: 이동 핸들러 추가**

기존 `handleMoveAdminSidebarItem(index, direction)`를 제거하고 다음을 추가한다.

```ts
  const getAdminSidebarNodeKey = (node: AdminSidebarNavigationNode) => (
    node.type === 'group' ? node.id : node.item.href
  )

  const handleMoveAdminSidebarNode = (node: AdminSidebarMenuGroupNode | AdminSidebarMenuItemNode, direction: 'up' | 'down') => {
    setAdminSidebarConfig((current) => ({
      items: moveAdminSidebarNavigationNode(
        current.items,
        adminSidebarNavigationNodes,
        getAdminSidebarNodeKey(node),
        direction
      ),
    }))
  }

  const handleMoveAdminSidebarChild = (groupNode: AdminSidebarMenuGroupNode, item: AdminSidebarMenuItem, direction: 'up' | 'down') => {
    setAdminSidebarConfig((current) => ({
      items: moveAdminSidebarHref(
        current.items,
        item.href,
        groupNode.items.map((groupItem) => groupItem.href),
        direction
      ),
    }))
  }
```

- [ ] **Step 4: admin sidebar table 렌더링 변경**

`<TableBody>` 내부를 다음 형태로 바꾼다.

```tsx
              <TableBody>
                {adminSidebarNavigationNodes.map((node, nodeIndex) => {
                  if (node.type === 'item') {
                    return (
                      <TableRow key={node.item.href}>
                        <TableCell className="font-medium">{node.item.name}</TableCell>
                        <TableCell className="text-gray-600">{node.item.href}</TableCell>
                        <TableCell className="text-gray-500">기본</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" aria-label={`${node.item.name} 위로 이동`} onClick={() => handleMoveAdminSidebarNode(node, 'up')} disabled={nodeIndex === 0}>
                              <ArrowUp className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" aria-label={`${node.item.name} 아래로 이동`} onClick={() => handleMoveAdminSidebarNode(node, 'down')} disabled={nodeIndex === adminSidebarNavigationNodes.length - 1}>
                              <ArrowDown className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  }

                  return (
                    <Fragment key={node.id}>
                      <TableRow className="bg-slate-50">
                        <TableCell className="font-semibold text-slate-900">{node.name}</TableCell>
                        <TableCell className="text-gray-500">대메뉴</TableCell>
                        <TableCell>
                          <Badge variant="secondary">소메뉴 {node.items.length}개</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" aria-label={`${node.name} 대메뉴 위로 이동`} onClick={() => handleMoveAdminSidebarNode(node, 'up')} disabled={nodeIndex === 0}>
                              <ArrowUp className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" aria-label={`${node.name} 대메뉴 아래로 이동`} onClick={() => handleMoveAdminSidebarNode(node, 'down')} disabled={nodeIndex === adminSidebarNavigationNodes.length - 1}>
                              <ArrowDown className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {node.items.map((item, index) => (
                        <TableRow key={item.href}>
                          <TableCell className="pl-8 font-medium">{item.name}</TableCell>
                          <TableCell className="text-gray-600">{item.href}</TableCell>
                          <TableCell className="text-gray-500">{node.name}</TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" aria-label={`${node.name} ${item.name} 위로 이동`} onClick={() => handleMoveAdminSidebarChild(node, item, 'up')} disabled={index === 0}>
                                <ArrowUp className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" aria-label={`${node.name} ${item.name} 아래로 이동`} onClick={() => handleMoveAdminSidebarChild(node, item, 'down')} disabled={index === node.items.length - 1}>
                                <ArrowDown className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  )
                })}
              </TableBody>
```

`TableHeader`도 다음처럼 컬럼을 맞춘다.

```tsx
                  <TableHead>메뉴명</TableHead>
                  <TableHead>기준 경로</TableHead>
                  <TableHead>표시 그룹</TableHead>
                  <TableHead className="w-[180px] text-right">순서 조정</TableHead>
```

- [ ] **Step 5: 설명 문구 변경**

```tsx
          <p className="mt-3 text-sm text-gray-500">
            영어/국어 관리 대상별로 서로 다른 순서를 저장합니다. 문제은행 대메뉴는 위/아래 버튼으로 block 이동하고, 하위 메뉴는 문제은행 내부에서만 순서를 조정합니다. 저장값은 기존처럼 href 순서 배열만 사용합니다.
          </p>
```

- [ ] **Step 6: 테스트 실행**

Run:

```bash
node --test tests/admin-sidebar-navigation.test.mjs
```

Expected after Task 4:

```text
# pass count includes all admin sidebar navigation tests
```

---

## 10. Task 5: 회귀 검증

**Files:**
- No implementation file edits in this task.

- [ ] **Step 1: 관리자 사이드바 계약 테스트 실행**

Run:

```bash
node --test tests/admin-sidebar-navigation.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 2: 문제은행 관련 계약 테스트 실행**

Run:

```bash
node --test \
  tests/question-bank-admin-options-contract.test.mjs \
  tests/question-bank-admin-question-list-contract.test.mjs \
  tests/question-bank-problem-types-api-contract.test.mjs \
  tests/question-bank-backfill-contract.test.mjs \
  tests/question-bank-upload-metadata-contract.test.mjs \
  tests/question-bank-user-options-api-contract.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 3: Lint 실행**

Run:

```bash
npm run lint
```

Expected:

```text
No ESLint warnings or errors
```

- [ ] **Step 4: Build 실행**

Run:

```bash
npm run build
```

Expected:

```text
Compiled successfully
```

- [ ] **Step 5: 브라우저 smoke test**

Run dev server:

```bash
npm run dev
```

Open:

- `http://localhost:4000/admin?subject=english`
- `http://localhost:4000/admin/questions?subject=english`
- `http://localhost:4000/admin/questions/upload?subject=english`
- `http://localhost:4000/admin/question-bank/options?subject=english`
- `http://localhost:4000/admin/question-bank/problem-types?subject=english`
- `http://localhost:4000/admin/question-bank/backfill?subject=english`
- `http://localhost:4000/admin/question-bank/options?subject=korean`

Manual expected:

- `문제은행` 대메뉴가 보인다.
- 위 5개 하위 메뉴가 `문제은행` 아래에 표시된다.
- 현재 route의 하위 메뉴만 orange active 상태가 된다.
- active link에는 `aria-current="page"`가 붙는다.
- 링크 이동 후 `subject=english` 또는 `subject=korean` query가 유지된다.
- collapsed 상태에서도 하위 메뉴 아이콘 링크가 유지된다.
- 메뉴관리의 icon-only 위/아래 이동 버튼에는 `aria-label`로 접근 가능한 이름이 있다.

- [ ] **Step 6: 최종 변경 범위 확인**

Run:

```bash
git diff --name-only
```

Expected implementation files:

```text
tests/admin-sidebar-navigation.test.mjs
src/lib/admin-sidebar.ts
src/components/layout/admin-sidebar-client.tsx
src/app/(admin)/admin/menu-management/menu-management-client.tsx
```

If this plan document is edited in the same session, `docs/superpowers/plans/2026-05-12-admin-question-bank-sidebar-categorization-plan.md` may also appear. Any other file path must be explained as an unrelated pre-existing change or removed from this task.

---

## 11. 롤백 계획

DB migration이 없으므로 롤백은 코드 되돌리기만 하면 된다.

되돌릴 파일:

- `tests/admin-sidebar-navigation.test.mjs`
- `src/lib/admin-sidebar.ts`
- `src/components/layout/admin-sidebar-client.tsx`
- `src/app/(admin)/admin/menu-management/menu-management-client.tsx`

저장된 `workspace_settings.admin_sidebar_navigation` row는 그대로 둔다. 저장 구조가 바뀌지 않았으므로 데이터 롤백은 필요 없다.

---

## 12. 리스크와 완화

| 리스크 | 완화 |
| --- | --- |
| 기존 저장된 flat 순서와 새 group 렌더링 의미가 달라짐 | 저장값은 유지하되 문제은행 href만 virtual group으로 묶는다. 기본 UI 예시는 신규 기본값 기준이고, 기존 저장값은 group 내부 순서와 group block 위치에 그대로 반영한다. |
| 문제은행 대메뉴가 메뉴관리에서 이동 불가능해질 수 있음 | group row 위/아래 버튼으로 문제은행 href 5개를 block 이동하는 helper와 테스트를 둔다. |
| `/admin/questions`가 `/admin/questions/upload`에서도 active 되는 prefix 충돌 | `/admin/questions`는 기존처럼 `exact: true`를 유지한다. |
| subject query 누락 | 모든 링크는 계속 `withAdminWorkspaceSubject(item.href, workspaceSubject)`를 사용한다. |
| DB schema 과변경 | migration 없이 기존 `workspace_settings` JSON payload 유지. |
| user-facing `/bank`/`/library`와 혼동 | 이번 계획은 admin sidebar 전용이며 `header_navigation`, `/bank`, `/library/*`를 변경하지 않는다. |
| menu-management 저장 경로 혼동 | `saveAdminSidebarNavigationConfigAction`만 사용하고 header 저장 action과 섞지 않는다. |
| 현재 작업트리에 기존 미커밋 변경이 많음 | Task 0에서 대상 4개 파일의 기존 diff를 `/tmp/admin-question-bank-sidebar-before.diff`에 보관하고, Task 5 Step 6에서 `git diff --name-only`로 계획 범위 외 변경을 확인한다. |
| 메뉴관리 icon-only 이동 버튼이 보조기술에 설명되지 않을 수 있음 | 모든 위/아래 이동 버튼에 구체적인 `aria-label`을 붙이고 source 계약 테스트와 브라우저 smoke 기준에 포함한다. |

---

## 13. 멀티에이전트 검증 루프 기록

### Loop 1 — 요구사항 파악 / 초기 검토

- **explore:** PASS
  - 관리자 사이드바는 flat 구조이고 nested 미지원임을 확인했다.
  - 문제은행 관련 관리자 route/API 목록을 확인했다.
  - `omx explore`는 native harness 부재로 실패했고 read-only shell 탐색으로 대체했다.
- **architect:** PASS
  - `workspace_settings` schema 변경 없이 presentation-level virtual group을 추천했다.
  - `resolveAdminSidebarMenuItems` flat contract 유지와 별도 grouped helper 추가를 추천했다.
- **planner:** PASS with caveats
  - 테스트 우선 작업 순서와 no-migration 접근을 제안했다.
  - 구현 전 미커밋 변경 충돌을 주의하라고 했다.
- **code-reviewer:** FAIL / 보류
  - 실제 계획 문서가 아직 없어서 저장 구조·subject isolation·테스트 조건 포함 여부를 검증할 수 없다고 판단했다.
- **critic:** FAIL
  - user-facing `/bank`, `/library/*`, header active 중복, accessibility, 미커밋 변경 리스크를 제기했다.

### Loop 1 반영 사항

- 이번 계획의 범위를 **관리자 사이드바 전용**으로 고정했다.
- `/bank`, `/library/*`, `workspace_settings.header_navigation`은 명시적으로 제외했다.
- accessibility 보완으로 active link에 `aria-current="page"`를 추가했다.
- DB migration 없음과 기존 `{ items: string[] }` 저장 구조 유지를 명시했다.
- menu-management 저장 경로와 header 저장 경로 분리를 명시했다.
- 미커밋 변경 충돌 완화 조건을 추가했다.

### Loop 2 — 계획 검증

- **architect-validator:** FAIL
  - `문제은행` 대메뉴 자체를 top-level에서 이동할 수 없어 기존 메뉴 순서 관리 기능 회귀가 생긴다고 지적했다.
  - 기존 저장값의 하위 메뉴 순서 정책이 UI 예시와 섞여 모호하다고 지적했다.
- **critic-validator:** FAIL
  - group header 이동 규칙이 모호하고 `/admin/question-bank/backfill` 계약 테스트가 검증 목록에서 빠졌다고 지적했다.
- **code-reviewer-validator:** PASS
  - 저장 구조, subject isolation, save path 분리, no migration 판단은 타당하다고 검토했다.

### Loop 2 반영 사항

- `moveAdminSidebarNavigationNode` helper로 `문제은행` group href들을 block 단위 이동하도록 계획을 수정했다.
- group 내부 child 순서는 `moveAdminSidebarHref`로 별도 조정하도록 분리했다.
- 기본 UI 예시는 신규 기본값 기준이며, 기존 저장값이 있으면 저장된 group 내부 순서를 우선한다고 명시했다.
- `tests/question-bank-backfill-contract.test.mjs`를 회귀 검증 목록에 추가했다.

### Loop 3 — 계획 재검증

- **architect-validator-loop3:** FAIL
  - Task 4에서 기존 `adminSidebarItems` memo와 `resolveAdminSidebarMenuItems` import 제거 지시가 빠져 lint warning 가능성이 있다고 지적했다.
- **critic-validator-loop3:** FAIL
  - 문제은행 href가 기존 저장값에서 흩어져 있는 경우의 block 이동 테스트가 부족하다고 지적했다.
  - icon-only 이동 버튼에 `aria-label`이 없다고 지적했다.
  - 미커밋 변경 보호 절차가 부족하다고 지적했다.
- **code-reviewer-validator-loop3:** PASS
  - helper 설계, 테스트 계획, 저장 shape, subject isolation, no migration 판단이 코드리뷰 기준을 만족한다고 검토했다.

### Loop 3 반영 사항

- 흩어진 legacy 저장값에서 `문제은행` group이 하나의 block으로 이동하는 테스트를 추가했다.
- Task 4에서 `resolveAdminSidebarMenuItems` import와 기존 `adminSidebarItems` memo 제거를 명시했다.
- 메뉴관리 icon-only 이동 버튼에 `aria-label`을 추가하고 source/manual 검증 기준에 포함했다.
- Task 0에 대상 파일 기존 diff 보관 절차를 추가하고, Task 5에 `git diff --name-only` 변경 범위 확인을 추가했다.

### Loop 4 — 계획 재검증

- **architect-validator-loop4:** PASS
  - 흩어진 legacy 저장값 block 이동 테스트, icon-only 버튼 `aria-label`, 미커밋 diff 보호, Task 4 unused import/memo 제거 지시가 반영됐다고 검토했다.
  - 관리자 문제은행 사이드바 카테고리화, DB 변경 없음, `{ items: string[] }` 호환, subject query 보존, menu-management 회귀 방지가 충족된다고 판정했다.
- **critic-validator-loop4:** PASS
  - legacy/non-contiguous 저장값, group block 이동, child 이동, 접근성, subject query, `/bank`/`/library` 제외, backfill 테스트, 미커밋 충돌 완화, no migration 판단에서 루프 종료를 막을 반례가 없다고 판정했다.
- **code-reviewer-validator-loop4:** PASS
  - 테스트/구현 스니펫, 검증 명령, 변경 범위 제약에서 구현을 막는 명백한 결함을 발견하지 못했다고 판정했다.

### Loop 종료 조건

Loop 4에서 architect / critic / code-reviewer가 모두 PASS했으므로 `요구사항 파악 → 계획 작성 → 검증` 루프를 종료한다.

