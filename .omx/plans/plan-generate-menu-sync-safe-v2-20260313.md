# 문제생성 메뉴/리스트보드 동기화 안전 설계 v2

## 목표
관리자에서 **문제생성 2단계 메뉴를 생성/수정/삭제할 때**, 실제 사용자 화면의 헤더/사이드바/listboard/post 데이터가 어긋나지 않도록 **single source of truth** 구조로 전환한다.

핵심은 **`system_settings` 테이블 구조를 바꾸는 게 아니라, 문제생성 2단계 메뉴의 소유권을 JSON에서 관계형 테이블로 이동**하는 것이다.

---

## 현재 코드 기준 문제 요약
- `src/lib/header-navigation-server.ts`
  - `system_settings.key = 'header_navigation'`의 `value jsonb`를 그대로 읽고 씀
- `src/app/(admin)/admin/menu-management/actions.ts`
  - 헤더 메뉴 전체를 JSON 한 번에 저장함
- `src/app/(dashboard)/generate/layout.tsx`
  - 헤더 JSON에서 `/generate` 하위 children을 읽어 사이드바를 구성함
- `src/app/(dashboard)/generate/[typeId]/page.tsx`
  - 현재 route param을 `problem_types.id` UUID로 간주함

즉, 지금 구조에서는:
1. 문제생성 하위 메뉴가 JSON에 묶여 있고
2. listboard/post는 별도 테이블이 필요하며
3. 두 군데를 같이 수정하면 dual-write가 되어 어긋날 위험이 커진다.

---

## 최종 권장안
### 결론
- **`system_settings` 테이블 컬럼 구조는 유지**한다.
- 대신 **문제생성 2단계 메뉴 전용 관계형 테이블**을 새로 만든다.
- 헤더/사이드바는 더 이상 `header_navigation`의 문제생성 children을 source of truth로 쓰지 않고, **DB 기반 메뉴를 동적으로 합성**한다.

### 왜 이 안이 맞나
- 메뉴 create/update/delete와 listboard/post 연결을 DB FK로 안전하게 관리 가능
- JSON과 DB를 동시에 수정하는 dual-write 제거 가능
- 개인지문 플로우는 유지하면서 비개인 메뉴만 구조 전환 가능
- 나중에 전체 헤더 메뉴를 정규화할지 여부를 phase 2 이후로 미룰 수 있음

---

## Source of Truth 경계
- **일반 헤더 메뉴** → `system_settings.header_navigation`
- **문제생성 2단계 메뉴** → `generate_menu_entries`
- **리스트보드 글** → `generate_listboard_posts`

즉, 문제생성 하위 메뉴는 더 이상 JSON child item이 아니라 **DB row**다.

---

## 권장 스키마

### 1) `generate_menu_entries`
문제생성 2단계 메뉴의 실제 원본 테이블

권장 컬럼:
- `id uuid primary key default gen_random_uuid()`
- `entry_key text unique not null`
  - 내부 고정 키. 예: `personal`, `mock-exams`
- `slug text unique not null`
  - route 세그먼트. 예: `personal`, `mock-exams`
- `title text not null`
- `entry_type text not null check (entry_type in ('personal_generate', 'listboard'))`
- `description text null`
- `sort_order int not null default 0`
- `is_visible boolean not null default true`
- `is_active boolean not null default true`
- `search_config jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `deleted_at timestamptz null`

#### 설계 포인트
- 문제생성 하위 메뉴 = 이 테이블의 row
- `href`는 저장하지 않고 서비스에서 파생
  - `personal_generate` → `/generate`
  - `listboard` → `/generate/boards/{slug}`
- `entry_key`는 불변 internal key, `slug`는 route용

### 2) `generate_listboard_posts`
listboard 메뉴에 속한 글/지문 데이터

권장 컬럼:
- `id uuid primary key default gen_random_uuid()`
- `menu_entry_id uuid not null references generate_menu_entries(id)`
- `title text not null`
- `passage_text text not null`
- `exam_year int null`
- `exam_month int null`
- `grade_level text null`
- `source_type text null`
- `source_1 text null`
- `source_2 text null`
- `source_3 text null`
- `source_4 text null`
- `status text not null default 'draft' check (status in ('draft','published','archived'))`
- `is_active boolean not null default true`
- `published_at timestamptz null`
- `created_by uuid null references profiles(id)`
- `updated_by uuid null references profiles(id)`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `deleted_at timestamptz null`

#### 무결성 규칙
- `generate_listboard_posts.menu_entry_id`는 **반드시 `entry_type='listboard'`인 row만 참조**해야 한다.
- phase 1에서는:
  1. `generateListboardPostService`에서 app/service validation 수행
  2. DB 레벨에서는 trigger 또는 helper function으로 동일 규칙 강제
- 즉, `personal_generate` entry에는 post를 연결할 수 없다.

### 3) 인덱스
- `generate_menu_entries(entry_key)` unique
- `generate_menu_entries(slug)` unique
- `generate_menu_entries(sort_order)`
- `generate_listboard_posts(menu_entry_id, status)`
- `generate_listboard_posts(menu_entry_id, exam_year, exam_month, grade_level)`

### 4) RLS
- `generate_menu_entries`
  - 일반 사용자: `is_visible = true and is_active = true and deleted_at is null` read only
  - 관리자: full CRUD
- `generate_listboard_posts`
  - 일반 사용자: `status = 'published' and is_active = true and deleted_at is null` read only
  - 관리자: full CRUD

---

## 서비스 경계

### A. `headerNavigationBaseService`
역할:
- `system_settings.header_navigation`에서 **기본 헤더 구조만** 읽음
- migration 중 fallback children 보존 여부를 `generate_children_source_mode`로 제어

추천 함수:
- `getBaseHeaderNavigationConfig()`
- `saveBaseHeaderNavigationConfig()`
- `getGenerateChildrenSourceMode()`

#### source mode 규칙
- `legacy_json`: 기존 JSON children 사용
- `hybrid_fallback`: DB 우선 + 비어 있으면 JSON fallback 허용
- `db_authoritative`: DB만 사용, 이 시점부터 저장 시 `/generate` children strip/ignore 허용

### B. `generateMenuService`
역할:
- 문제생성 2단계 메뉴 CRUD
- slug/path 파생 규칙 관리
- 메뉴 정렬/노출/활성 상태 관리
- header/sidebar용 child items 생성

추천 함수:
- `listGenerateMenuEntries()`
- `getGenerateMenuEntryBySlug(slug)`
- `createGenerateMenuEntry(input)`
- `updateGenerateMenuEntry(id, input)`
- `archiveGenerateMenuEntry(id)`
- `reorderGenerateMenuEntries(ids)`
- `buildGenerateHeaderChildren(entries)`

### C. `generateListboardPostService`
역할:
- listboard 게시글 CRUD/검색
- `menu_entry_id -> listboard only` invariant 강제

추천 함수:
- `searchGenerateListboardPosts({ menuEntryId, year, month, grade, title })`
- `getGenerateListboardPost(id)`
- `createGenerateListboardPost(input)`
- `updateGenerateListboardPost(id, input)`
- `archiveGenerateListboardPost(id)`

### D. `resolvedHeaderNavigationService`
역할:
- base JSON + DB 기반 generate menu entries를 합성해 **최종 헤더/사이드바 모델**을 반환

추천 함수:
- `getResolvedHeaderNavigationConfig()`

합성 규칙:
1. base header JSON 로드
2. `AI문제생성` parent 찾기 (`href === '/generate'`)
3. 해당 parent의 children을 **DB 기반 generate menu entries로 교체**
4. 나머지 메뉴는 그대로 유지
5. parent가 없으면 메모리에서 self-heal하되 관리자 UI에 blocking warning 노출

---

## 관리자 UX 변경안

### 1) 일반 헤더 메뉴 관리
- 기존 `system_settings.header_navigation` 편집 방식 유지
- 단, `AI문제생성`의 children 직접 편집 UI는 제거 또는 read-only 처리
- 안내 문구:
  - "문제생성 하위 메뉴는 아래 '문제생성 메뉴' 섹션에서 관리됩니다."
- runtime self-heal이 발생한 경우 관리자 UI에 **blocking warning** 노출

### 2) 문제생성 2단계 메뉴 관리
대상: `generate_menu_entries`

필드:
- 메뉴명
- entry type (`개인지문` / `리스트보드`)
- slug
- 설명
- 노출 여부
- 활성 여부
- 정렬 순서
- 검색 옵션 preset

UX 규칙:
- `href` 직접 입력 금지
- derived preview만 노출
  - 개인지문: `/generate`
  - 리스트보드: `/generate/boards/{slug}`
- `personal_generate`는 최소 1개 유지
- 게시글이 연결된 listboard는 hard delete 금지, archive 우선
- phase 1에서는 게시글(특히 published/linked post)이 1건이라도 존재하면 `slug` 수정 금지
- redirect/alias 지원은 phase 2 과제로 미룸

---

## 렌더링 / 라우팅 흐름

### Personal flow
- `personal_generate` entry의 파생 href는 phase 1에서 **항상 `/generate` 고정**
- 개인지문 메뉴 클릭 → `/generate`
- 사용자는 기존 generate home에서 문제 유형을 선택
- 실제 생성 화면은 기존 `src/app/(dashboard)/generate/[typeId]/page.tsx`로 진입
- 즉, phase 1에서 personal flow의 실경로 구조는 유지하고 메뉴 진입점만 `generate_menu_entries(entry_type='personal_generate')`가 대표한다

### Non-personal flow
- 예: 모의고사 메뉴 클릭 → `/generate/boards/mock-exams`
- `textbook_listboard` 렌더
- 검색/필터로 게시글 조회
- 게시글 선택 후 `textbook_generate` 진입

### Namespace 분리
- 개인지문은 기존 `/generate/[typeId]` 전제를 유지
- 비개인 메뉴는 별도 namespace 사용
  - `/generate/boards/[slug]`
  - `/generate/boards/[slug]/posts/[postId]`
  - `/generate/boards/[slug]/posts/[postId]/generate/[typeId]`

---

## 동기화 정책 (가장 중요)
### 절대 원칙
**문제생성 하위 메뉴는 dual-write 금지**

즉, 아래는 금지:
- `generate_menu_entries` 수정
- 동시에 `system_settings.header_navigation.children`도 직접 수정

### 올바른 방식
- source of truth: `generate_menu_entries`
- derived view: resolved header config

### create
- 관리자에서 새 listboard menu 생성
- `generate_menu_entries` insert
- header/sidebar는 다음 read 시 자동 반영

### update
- 제목 변경 → `generate_menu_entries.title` 수정
- slug 변경 → derived href 자동 변경
- phase 1에서는 게시글 존재 시 slug 변경 금지

### delete
- 게시글 없는 entry: archive 또는 soft delete
- 게시글 있는 entry: hard delete 금지, archive 처리
- 사용자 화면에서는 hidden 처리

---

## Migration Plan

### Phase 0 — 설계 고정
- 문제생성 하위 메뉴의 source of truth를 DB로 옮긴다는 원칙 확정
- `system_settings`는 일반 헤더용 base config로만 사용하기로 결정
- `generate_children_source_mode` 운영 모드 정의
  - `legacy_json`
  - `hybrid_fallback`
  - `db_authoritative`

### Phase 1 — 스키마 추가
- `generate_menu_entries` 생성
- `generate_listboard_posts` 생성
- RLS/인덱스/정책 추가
- seed: `personal`, `mock-exams`
- post는 `entry_type='listboard'`에만 연결 가능하도록 service + DB invariant 추가

### Phase 2 — Backfill
- 기존 JSON의 문제생성 child를 `generate_menu_entries`로 1회성 backfill
- `personal_generate` + 최소 1개 listboard row 존재 확인
- 이 시점까지는 `generate_children_source_mode = 'legacy_json'` 또는 `hybrid_fallback` 유지

### Phase 3 — 읽기 경로 전환
- `getResolvedHeaderNavigationConfig()` 추가
- `generate/layout.tsx`가 resolved config 사용하도록 변경
- sidebar가 DB-derived children을 사용하도록 전환
- **임시 fallback:** rollout 중 active `generate_menu_entries`가 비어 있으면 기존 JSON children을 계속 렌더링
- 이 단계에서는 `generate_children_source_mode = 'hybrid_fallback'`로 유지
- **동시에 즉시 적용:** 일반 메뉴 저장 경로에서 `/generate` children 수정은 차단하거나 무시하여 stale JSON 편집을 막음
- 즉, `hybrid_fallback` 시작 시점부터 `/generate` children은 운영상 read-only 취급

### Phase 4 — 관리자 UX 전환
- 메뉴관리 UI 분리
- 일반 메뉴 vs 문제생성 메뉴 섹션 분리
- `AI문제생성` children의 자유 href 편집 제거
- runtime self-heal이 발생하면 관리자 UI에서 blocking warning 노출

### Phase 5 — cutover gate
아래 조건을 모두 만족할 때만 `generate_children_source_mode = 'db_authoritative'`로 전환
1. **기존 운영 대상 generate children 전부** `generate_menu_entries`로 backfill 완료
2. backfill 대상 개수와 DB row 개수가 일치함을 검증
3. `personal_generate` + 필요한 listboard seed 확인
4. resolved header가 운영 환경에서 정상 렌더 확인
5. 관리자 UI 분리 적용 완료

이 시점부터 `saveBaseHeaderNavigationConfig()`는 `/generate` children을 strip/ignore

### Phase 6 — listboard/post 사용자 플로우 연결
- `/generate/boards/[slug]` 추가
- mock-exams `textbook_listboard` 구현
- `textbook_generate` 연결

### Phase 7 — 기존 JSON child 정리
- `header_navigation`에 남아 있는 generate children은 무시하거나 cleanup
- 운영 검증 후 JSON에서 실제로 제거 가능
- 제거 전까지는 fallback 대상이라는 점을 명시하고, cutover 완료 후 cleanup 실행

---

## Backfill 방식
현재 JSON에 이미 문제생성 child menu가 있다면:
1. `AI문제생성` parent 아래 child items 추출
2. `href` 패턴이 `/generate/...`인 항목만 후보로 삼음
3. `personal_generate` 또는 `listboard`로 매핑
4. `generate_menu_entries`로 insert
5. 이후 resolved config에서는 DB rows만 사용

> 중요: backfill은 1회성 마이그레이션이고, 이후에는 JSON child를 더 이상 source of truth로 사용하지 않는다.

---

## 삭제/rename 안전장치
### slug 변경
phase 1 권장:
- 게시글(특히 published/linked post)이 하나라도 존재하면 slug 변경 금지
- 정말 필요하면 새 entry 생성 + 이전 entry archive

phase 2 선택:
- `generate_menu_redirects` 테이블 추가 후 redirect 관리

### delete
- hard delete 기본 금지
- `deleted_at` 기반 soft delete 권장
- 게시글 존재 시 archive만 허용

### personal entry
- 최소 1개 personal entry 유지 권장
- `personal_generate`의 href는 항상 `/generate`
- phase 1 personal flow는 `/generate` -> 기존 generate home -> `/generate/[typeId]` 구조 유지

---

## 왜 `system_settings` 자체는 안 바꾸는가
이 문제의 본질은 **테이블 구조가 아니라 데이터의 성격** 때문이다.

`system_settings`는 설정 저장소로는 괜찮지만, 문제생성 2단계 메뉴는 이제:
- 정렬됨
- 검색됨
- 게시글과 연결됨
- 삭제 정책이 필요함
- route 안정성이 필요함

즉 설정값이 아니라 **도메인 엔티티**다.

따라서 `system_settings.value` JSON 구조를 고쳐도, 결국 listboard/post/menu sync 문제는 관계형 도메인 테이블 없이는 깔끔히 해결되지 않는다.

---

## Acceptance Criteria
1. 관리자에서 문제생성 2단계 메뉴 create/update/delete 시 별도 JSON 수동 수정 없이 헤더/사이드바가 자동 반영된다.
2. 문제생성 하위 메뉴는 `generate_menu_entries`가 유일한 source of truth다.
3. personal flow는 기존과 동일하게 동작한다.
4. listboard type 메뉴는 `/generate/boards/[slug]`로 안정적으로 라우팅된다.
5. 게시글이 있는 메뉴는 hard delete되지 않는다.
6. slug/path drift를 유발하는 자유 href 편집이 제거된다.
7. `system_settings`는 일반 헤더 base config 역할만 유지한다.
8. `generate_listboard_posts`는 `entry_type='listboard'`에만 연결된다.
9. cutover 중 DB row가 비어도 fallback으로 문제생성 메뉴가 공백이 되지 않는다.

---

## Risks / Critic Checks
- dual-write가 남아 있으면 실패
- slug와 href를 둘 다 editable로 두면 실패
- 게시글 있는 메뉴 삭제 정책이 없으면 실패
- personal flow를 board 체계로 억지 통합하면 회귀 위험 증가
- JSON child를 렌더 시 그대로 남겨두면 drift 재발
- cutover gate 없이 strip/ignore를 먼저 켜면 fallback이 사라져 blank menu 위험 발생

---

## 추천 구현 순서
1. `generate_menu_entries` / `generate_listboard_posts` 마이그레이션
2. service + DB invariant 추가 (`listboard`만 post 연결 가능)
3. header resolved composition 추가
4. 관리자 메뉴관리 UI 분리
5. `hybrid_fallback` 모드에서 운영 검증
6. cutover gate 통과 후 `db_authoritative` 전환
7. old generate JSON children cleanup

---

## 최종 판단
- **`system_settings` 테이블 구조 변경은 지금 안 하는 것이 맞다.**
- 대신 **문제생성 하위 메뉴의 소유권을 별도 테이블로 옮기고**, 헤더/사이드바는 이를 동적으로 합성해야 한다.
- 이렇게 해야 관리자 메뉴 생성/수정/삭제와 실제 listboard/post가 **항상 같은 원본**을 보게 된다.

---

## Critic-Driven Revisions (Applied)
### Revision 1 — `entry_key` vs `slug` 규칙 명확화
- `entry_key`는 **불변 internal key**로 정의한다.
- `slug`는 사용자-facing route 세그먼트다.
- phase 1에서는 게시글(특히 published/linked post)이 1건 이상 존재하면 `slug` 변경을 금지한다.
- `personal_generate` entry의 `slug`는 수정 불가로 둔다.

### Revision 2 — `AI문제생성` parent fallback 규칙 추가
- resolved composition 시 base JSON에 `/generate` parent가 없으면:
  1. 경고 로그를 남기고
  2. 기본 parent (`title: AI문제생성`, `href: /generate`)를 메모리에서 보정 생성한다.
- 동시에 관리자 UI에는 blocking warning을 노출해 저장 전까지 불일치 상태를 명확히 표시한다.

### Revision 3 — generate children 영속 저장 금지의 cutover 조건 명시
- `saveBaseHeaderNavigationConfig()`는 **`generate_children_source_mode = 'db_authoritative'` 이후에만** `/generate` parent의 children을 제거하거나 무시한다.
- cutover 전(`legacy_json`/`hybrid_fallback`)에는 fallback JSON children을 보존한다.
- 단, `hybrid_fallback` 시작 시점부터는 일반 메뉴 저장 경로에서 `/generate` children 편집을 차단/무시해 stale JSON drift를 막는다.
- 관리자 일반 메뉴 저장 로직이 cutover 이후 generate children을 다시 JSON에 밀어넣지 못하도록 한다.

### Revision 4 — personal entry 특수 정책 명시
- `personal_generate`는 최소 1개 유지
- 삭제 금지 또는 archive 금지(비활성만 허용) 중 하나로 운영정책 고정
- `href`는 항상 `/generate`로 파생되며 수정 불가
- phase 1 personal flow는 `/generate` -> 기존 generate home -> `/generate/[typeId]` 구조를 유지한다.

### Revision 5 — delete semantics 강화
- listboard entry 삭제는 기본적으로 soft delete/archive만 허용
- 게시글이 존재하면 hard delete 금지
- archive된 entry는 header/sidebar에서 숨기되, 관리자에서만 조회 가능

### Revision 6 — post-to-menu invariant + cutover fallback 추가
- `generate_listboard_posts.menu_entry_id`는 반드시 `entry_type='listboard'` row만 참조하도록 service + DB invariant를 둔다.
- cutover 중 active `generate_menu_entries`가 비어 있으면 JSON children fallback을 유지하고, cutover gate를 통과한 뒤에만 `db_authoritative`로 전환한다.
- read-path switch는 partial backfill 상태에서 켜지지 않도록, 기존 운영 대상 generate children 전체 backfill 완료를 전제조건으로 둔다.

이 revisions를 반영한 상태를 critic approval 기준안으로 사용한다.
