# Admin UI Spec — Generate Menu Management Split

## Goal
현재 메뉴관리 화면에서 일반 헤더 메뉴와 문제생성 2단계 메뉴를 분리해, sync-safe 구조를 유지한다.

## Screen Scope
Existing page:
- `src/app/(admin)/admin/menu-management/page.tsx`
- `src/app/(admin)/admin/menu-management/menu-management-client.tsx`

## New UX Structure
### Section A — 일반 헤더 메뉴 관리
대상:
- 로고 문구
- 일반 상위/하위 메뉴
- `/generate` parent row 자체

Rules:
- `/generate` parent children은 read-only
- save 시 `/generate` children은 저장/신뢰 대상이 아님
- helper text:
  - "문제생성 하위 메뉴는 아래 문제생성 메뉴 섹션에서 관리됩니다."

### Section B — 문제생성 2단계 메뉴 관리
대상:
- `generate_menu_entries`

Columns:
- 메뉴명
- 유형 (`개인지문` / `리스트보드`)
- slug
- 경로 preview
- 노출 여부
- 활성 여부
- 정렬 순서
- 게시글 수
- 관리 액션

## Create Flow
### Create personal menu
- usually fixed row only
- phase 1 권장: 별도 생성 금지, seed row 유지

### Create listboard menu
inputs:
- title
- slug
- description
- visibility
- active
- sort_order
- search preset

derived values:
- href preview = `/generate/boards/{slug}`

## Edit Flow
### Editable
- title
- description
- sort_order
- visible
- active
- search preset

### Conditionally editable
- slug
  - phase 1: linked/published post exists -> edit blocked
  - no linked post -> edit allowed with warning

### Non-editable
- href 직접 입력
- `entry_key`
- `personal_generate` route

## Delete / Archive Flow
### Personal row
- delete disabled
- archive disabled or restricted
- 최소 1개 유지

### Listboard row
- no posts -> archive allowed, hard delete optional only if explicitly enabled later
- has posts -> hard delete blocked, archive only

## Blocking States
### Self-heal warning
If runtime had to synthesize `/generate` parent because base JSON is inconsistent:
- show blocking warning in admin menu page
- ask admin to fix/save base header state before normal completion

### Cutover safety state
When source mode is `hybrid_fallback`:
- general header save must not modify `/generate` children
- show info badge:
  - `문제생성 메뉴 전환 중 (fallback active)`

## Supporting Admin APIs
### Existing
- `getMenuManagementConfig()`
- `saveMenuManagementConfig()`

### New
- `listGenerateMenuEntries()`
- `createGenerateMenuEntry()`
- `updateGenerateMenuEntry()`
- `archiveGenerateMenuEntry()`
- `reorderGenerateMenuEntries()`
- optional: `getGenerateMenuAdminStatus()`
  - source mode
  - self-heal status
  - backfill completeness

## Table / List UX Notes
- sort buttons or drag reorder okay
- preview path should be derived from `entry_type + slug`
- personal row should visually indicate fixed/system row
- listboard row should show attached post count

## Phase 1 Out of Scope
- post CRUD in same screen if too large
- redirect/alias management UI
- global navigation full normalization

## Acceptance Criteria
1. 관리자에서 `/generate` children을 일반 메뉴처럼 직접 수정할 수 없다.
2. 문제생성 하위 메뉴는 별도 섹션에서 DB CRUD로 관리된다.
3. slug/href drift를 유발하는 직접 href 편집이 없다.
4. linked post가 있는 row는 hard delete 불가다.
5. `personal_generate` row는 보호된다.
6. source mode / self-heal warning이 관리자에게 보인다.
