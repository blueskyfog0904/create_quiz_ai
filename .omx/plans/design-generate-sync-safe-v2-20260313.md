# 문제생성 2단계 메뉴 동기화 안전 설계 (v2)

## 1. 핵심 판단
`system_settings` **테이블 구조 자체를 바꾸는 것보다**, `system_settings.header_navigation`의 **책임을 줄이고** 문제생성 2단계 메뉴의 **source of truth를 별도 테이블로 분리**하는 것이 더 안전하다.

즉:
- `system_settings.header_navigation` = **기본 헤더/표시 설정**
- `generate_listboards` = **문제생성 2뎁스 메뉴의 실제 원본**
- `generate_listboard_posts` = **각 메뉴에 속한 글(지문/게시물) 원본**

이렇게 해야 관리자 메뉴 생성/수정/삭제와 실제 listboard/post 데이터가 **단일 원본 기준**으로 움직여서 drift가 사라진다.

---

## 2. 현재 구조에서 왜 동기화가 깨지기 쉬운가
### 코드 근거
- `src/lib/header-navigation-server.ts`
  - `system_settings`의 `key='header_navigation'` JSON을 읽고 그대로 반환
  - 저장도 동일 JSON 전체 upsert 방식
- `src/app/(admin)/admin/menu-management/actions.ts`
  - 메뉴관리 저장 시 전체 `HeaderNavigationConfig` JSON을 그대로 저장
- `src/app/(dashboard)/generate/layout.tsx`
  - 문제생성 2뎁스 메뉴를 `header_navigation`에서 직접 읽어 사이드바 렌더링
- `src/app/(dashboard)/generate/[typeId]/page.tsx`
  - `[typeId]`가 `problem_types.id` UUID라고 가정함

### 문제
1. **DB가 메뉴-게시글 관계를 모름**
   - JSON이라 FK/참조 무결성 없음
2. **admin 수정과 business data가 이중화되면 dual-write 발생**
   - 메뉴 JSON도 바꾸고 board/post table도 바꾸면 언젠가 불일치
3. **삭제/이름변경/slug변경 정책을 안전하게 강제하기 어려움**
4. **현재 generate 상세 route는 UUID 전제**라 slug 기반 메뉴와 충돌 가능

---

## 3. 권장 아키텍처
## 3-1. Source of Truth 원칙
### A. 일반 헤더 메뉴
- 계속 `system_settings.header_navigation`에서 관리

### B. 문제생성 parent(`/generate`)의 2뎁스 메뉴
- 더 이상 JSON children을 원본으로 쓰지 않음
- `generate_listboards`를 원본으로 사용

즉, 문제생성 하위 메뉴는 **JSON 편집 대상이 아니라 DB 엔티티**가 된다.

---

## 3-2. 권장 테이블
### `generate_listboards`
문제생성 2뎁스 메뉴 = listboard = board 정의

권장 컬럼:
- `id uuid primary key`
- `board_slug text unique not null`
- `menu_path text unique not null`  
  예: `/generate/boards/mock-exams`
- `title text not null`
- `description text null`
- `sort_order int not null default 0`
- `is_active boolean not null default true`
- `board_kind text not null default 'listboard'`
- `search_config jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `deleted_at timestamptz null`

### `generate_listboard_posts`
각 listboard에 속한 실제 글/지문 데이터

권장 컬럼:
- `id uuid primary key`
- `board_id uuid not null references generate_listboards(id)`
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
- `is_active boolean not null default true`
- `published_at timestamptz null`
- `created_by uuid null references profiles(id)`
- `updated_by uuid null references profiles(id)`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `deleted_at timestamptz null`

### 선택 옵션(권장)
#### `generate_listboard_path_aliases`
slug/path 변경 시 리다이렉트 또는 backward compatibility가 필요하면 추가
- `id uuid primary key`
- `board_id uuid not null references generate_listboards(id)`
- `old_menu_path text unique not null`
- `created_at timestamptz not null default now()`

---

## 4. runtime composition 경로
## 4-1. 읽기 시점
`getHeaderNavigationConfig()` 계층에서 아래처럼 구성:

1. `system_settings.header_navigation` 로드
2. active `generate_listboards` 로드
3. JSON에서 parent menu 중 `href === '/generate'` 항목 찾기
4. 해당 parent의 `children`을 DB 결과로 **교체해서 반환**

즉, 헤더/사이드바는 여전히 `HeaderNavigationConfig`를 받지만,
`문제생성 children`만은 DB에서 합성된 결과가 들어간다.

### 장점
- UI 소비 코드는 거의 그대로 유지 가능
- 문제생성 메뉴만 sync-safe하게 교체 가능
- general header 메뉴는 기존 방식 유지

---

## 4-2. 쓰기 시점
### 일반 메뉴 저장
- `saveHeaderNavigationConfig()`는 **문제생성 children을 신뢰하지 않도록 변경**
- 저장 시 `/generate` parent의 children은 무시하거나 strip

### 문제생성 하위 메뉴 저장
- 별도 server action / admin CRUD로 `generate_listboards`를 수정

즉 저장 경로를 분리:
- 일반 헤더 메뉴 저장 → `system_settings`
- 문제생성 하위 메뉴 저장 → `generate_listboards`

이렇게 해야 dual-write를 제거할 수 있다.

---

## 5. 관리자 메뉴관리 UI 설계
현재 메뉴관리 UI는 상/하위 메뉴를 모두 한 화면에서 JSON 편집처럼 다루고 있다.

이를 아래처럼 분리 권장:

### 섹션 A. 일반 헤더 메뉴 관리
- 현재 구조 유지
- 단, `/generate` parent의 children 직접 편집 비활성화

### 섹션 B. 문제생성 2단계 메뉴 관리
- 데이터 원본: `generate_listboards`
- 컬럼 예시:
  - 메뉴명(title)
  - slug
  - path(preview)
  - 활성 여부
  - 정렬 순서
  - 게시글 수
- 작업:
  - 생성
  - 수정
  - 비활성화
  - 삭제

즉 관리자 입장에서는 여전히 “메뉴 관리”지만,
실제로는 문제생성 하위 메뉴만 DB 기반 관리로 분리된다.

---

## 6. create / update / delete semantics
## 6-1. 생성
관리자가 문제생성 하위 메뉴 생성 시:
1. `generate_listboards` row 생성
2. `board_slug` 기반으로 `menu_path` 생성
3. 다음 렌더부터 헤더/사이드바 자동 반영

**추가 JSON 동기화 작업 없음**

---

## 6-2. 제목 변경
- `title`만 변경
- 헤더/사이드바는 다음 렌더에서 자동 반영
- 게시글 영향 없음

---

## 6-3. slug/path 변경
가장 조심해야 함.

### 권장 정책
- 게시글이 없는 board: 자유 변경 가능
- 게시글이 있는 board:
  - 기본은 **guard**
  - 또는 alias/redirect row를 함께 생성하는 transaction 방식 허용

### 이유
slug/path는 메뉴 주소이자 진입점이라 변경 시 외부 링크, 즐겨찾기, 내부 이동 경로가 깨질 수 있음

### 권장 transaction
1. `generate_listboards.board_slug`, `menu_path` 갱신
2. 필요 시 `generate_listboard_path_aliases` insert
3. commit

---

## 6-4. 삭제
### 권장 기본 정책: soft delete
게시글이 있는 board는 hard delete 하지 말고:
- `is_active = false`
- 또는 `deleted_at` 세팅

### hard delete 허용 조건
- 게시글 없음
- 또는 admin이 cascade 확인

### 이유
- orphan post 방지
- 실수 복구 가능
- 메뉴 노출만 끄는 운영이 가능

---

## 7. personal flow 안정성
현재 `src/app/(dashboard)/generate/[typeId]/page.tsx`는 `problem_types.id` UUID 기반이다.

그래서 personal flow는 아래 원칙 유지가 안전:
- **현재 personal generate route는 그대로 유지**
- 비개인 메뉴는 별도 namespace 사용
  - 예: `/generate/boards/[boardSlug]`
  - 이후 게시글 선택 후 `/generate/boards/[boardSlug]/posts/[postId]/generate/[typeId]`

이렇게 하면:
- personal UUID route와 충돌 없음
- listboard slug route를 안전하게 도입 가능

---

## 8. system_settings를 바꿔야 하는 경우 / 안 바꿔야 하는 경우
## 8-1. 지금은 바꾸지 않는 게 좋은 이유
문제는 `system_settings` 테이블 스키마가 아니라,
**그 안의 JSON이 business source of truth 역할까지 맡고 있는 점**이다.

즉 지금 필요한 건:
- `system_settings` schema 변경
이 아니라
- **책임 분리 + source of truth 분리**

## 8-2. 언제 전체 메뉴 정규화가 맞나
아래 조건이면 phase 2에서 전체 헤더를 relational로 옮기는 게 맞다:
- 문제생성 외 다른 메뉴도 게시판/콘텐츠/권한과 연결됨
- 2뎁스 이상 메뉴가 많아짐
- drag/drop 정렬, 권한, 분석, FK 연계가 전 메뉴에 필요함

그 전에는 전체 정규화보다 **문제생성 하위 메뉴만 분리**가 ROI가 높다.

---

## 9. migration posture
### Phase 1
1. `generate_listboards` / `generate_listboard_posts` 생성
2. 현재 JSON 안의 문제생성 하위 child 중 **비개인 메뉴만** board로 backfill
3. 헤더 composition 로직 도입
4. menu-management UI 분리
5. personal flow untouched

### 안전장치
- boards 테이블이 비어 있으면 기존 JSON children fallback 가능
- 이렇게 하면 migration 중 blank menu 리스크 감소

### Phase 2
- 필요 시 전체 navigation table 정규화
- `system_settings.header_navigation`을 완전 대체 가능

---

## 10. 최종 권장안
### 추천안
**`system_settings`는 유지하되, 문제생성 2단계 메뉴는 더 이상 그 JSON을 원본으로 쓰지 말고 `generate_listboards`를 원본으로 삼아 read-time merge 하는 구조**

### 요약
- 바꿔야 하는 것은 `system_settings`의 컬럼 구조가 아니라 **책임 구조**
- 동기화 문제의 정답은 **dual-write를 없애는 것**
- 문제생성 하위 메뉴와 게시글은 **관계형 source of truth**로 전환
- 헤더/사이드바는 **합성된 view model**만 소비

---

## 11. 구현 단위 권장 파일 경계
- `src/lib/header-navigation-server.ts`
  - base JSON load + generate boards merge
- 신규 `src/lib/generate-listboards-server.ts`
  - board/post CRUD, admin guards, path semantics
- `src/app/(admin)/admin/menu-management/*`
  - 일반 메뉴 섹션 + 문제생성 board 섹션 분리
- `src/app/(dashboard)/generate/layout.tsx`
  - 합성된 children 그대로 사용 가능
- 신규 board/listboard route
  - `/generate/boards/[boardSlug]`

---

## 12. 승인 기준
이 설계가 만족해야 하는 조건:
1. 메뉴 create/update/delete가 post 데이터와 drift하지 않음
2. JSON과 table을 동시에 직접 수정하지 않음
3. personal generate flow가 깨지지 않음
4. slug/path 변경 정책이 명시적임
5. 삭제 정책이 orphan 데이터를 만들지 않음
6. phase 2 전체 정규화로 자연스럽게 확장 가능함
