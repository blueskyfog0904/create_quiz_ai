# 문제생성 > 개인지문 / 교재형(listboard) 분리 계획

## Team Inputs
- **Analyst lane:** 현재 `/generate/[typeId]` 흐름은 `problem_types` UUID 중심이며, 헤더/사이드바는 `system_settings.header_navigation` JSON 기반이라는 점을 확인함.
- **Architect lane:** `listboard`/`post`는 검색·정렬·RLS·메타데이터가 필요하므로 별도 relational table이 필요하다고 판단함.
- **Critic lens:** JSON 설정값에 직접 FK를 거는 구조는 취약하므로 피하고, phase 1은 presentation JSON + business tables 분리 전략이 가장 안전함.

## Evidence / Current Codebase Facts
- 현재 문제생성 진입점: `src/app/(dashboard)/generate/page.tsx`
- 현재 개인 문제생성 상세: `src/app/(dashboard)/generate/[typeId]/page.tsx`
- 현재 생성 컴포넌트: `src/app/(dashboard)/generate/[typeId]/generate-client.tsx`
- 생성 레이아웃/2뎁스 사이드바: `src/app/(dashboard)/generate/layout.tsx`, `src/app/(dashboard)/generate/generate-sidebar.tsx`
- 헤더 메뉴 저장/조회: `src/lib/header-navigation-server.ts`, `src/lib/header-navigation.ts`
- 관리자 메뉴관리 저장 액션: `src/app/(admin)/admin/menu-management/actions.ts`
- 헤더 메뉴 DB 저장 위치: `public.system_settings` (`key='header_navigation'`)

---

## Requirements Summary
1. **개인지문**은 현재 AI문제생성 흐름을 그대로 유지한다.
2. **개인지문 제외 나머지 문제생성 2뎁스 메뉴**는 직접 생성 페이지로 들어가지 않고 먼저 `textbook_listboard` 페이지로 진입한다.
3. `textbook_listboard` 상단에는 **문제 검색** 문구와 검색 UI가 있어야 한다.
4. 1차 구현 대상은 **모의고사** 메뉴이며, 검색 조건은:
   - 드롭다운: `년도`, `월`, `학년`
   - 키워드: `제목`
5. 리스트보드의 글을 선택한 뒤에는 기존 생성 컴포넌트를 복제/수정한 **`textbook_generate`** 흐름으로 들어간다.
6. 리스트보드(2뎁스 메뉴 대응)와 게시글용 DB 테이블이 필요하다.
7. `system_settings.header_navigation` JSON은 당장 FK 대상이 되기 어렵기 때문에, 구조 타당성을 검토해 DB 구조를 분리해야 한다.

---

## Architecture Decision (ADR)
### Decision
**Phase 1에서는 `header_navigation`은 그대로 JSON(presentation config)로 유지하고, 실제 business data는 별도 relational table로 분리한다.**

### Drivers
- 현재 메뉴 ID는 관리자 UI에서 `crypto.randomUUID()`로 생성되어 **DB FK 기준키로 안정적이지 않음**
- listboard/post는 검색, 정렬, 인덱스, RLS, 확장 메타데이터가 필요함
- 기존 헤더/사이드바 렌더링은 JSON만으로 충분하며, 이를 한 번에 전면 정규화하면 변경 범위가 너무 커짐

### Alternatives Considered
1. **전부 JSON 유지**
   - 장점: 빠름
   - 단점: 검색/필터/정렬/FK/RLS/확장성 모두 취약 → **기각**
2. **헤더 메뉴까지 전면 관계형 정규화**
   - 장점: FK 일관성 최고
   - 단점: 메뉴관리/헤더/사이드바/admin 저장 로직 전체를 한 번에 갈아야 함 → **phase 1 과도**
3. **Hybrid(채택)**
   - `header_navigation` = 화면 표시/순서/노출
   - `generate_listboards`, `generate_listboard_posts` = 실제 도메인 데이터

### Why Chosen
가장 작은 변경으로 사용자 요구를 충족하면서, 이후 phase 2에서 메뉴 정규화 여부를 다시 결정할 수 있다.

### Consequences
- 메뉴 href와 listboard `menu_path` 간 동기화 규칙이 필요함
- phase 2에서 필요 시 메뉴 전면 정규화를 재검토할 수 있음

### Follow-ups
- 메뉴관리에서 나중에 `menu_path` 유효성 검사 또는 listboard 연결 UI 추가 검토
- 메뉴 경로 변경 시 orphan board 방지 규칙 추가 검토

---

## Recommended Route Strategy
현재 `src/app/(dashboard)/generate/[typeId]/page.tsx`는 **UUID problem_type** 전제를 갖고 있어서, 비개인 메뉴를 같은 세그먼트로 넣으면 충돌 위험이 큼.

### 권장 경로
- **개인지문 유지**
  - 기존 유지: `/generate/[typeId]`
  - 또는 이후 명확화를 원하면 `/generate/personal/[typeId]`로 이동 가능하나 phase 1 필수는 아님
- **비개인(listboard) 신규 네임스페이스**
  - 리스트보드: `/generate/boards/[boardSlug]`
  - 게시글 기반 생성: `/generate/boards/[boardSlug]/posts/[postId]/generate/[typeId]`

### 이유
- 기존 personal flow를 안 건드리고 유지 가능
- slug 기반 board/post 라우팅과 UUID 기반 problem_type 라우팅을 분리 가능
- phase 1에서 회귀 위험 최소화

---

## Recommended DB Schema

### 1) `generate_listboards`
2뎁스 메뉴와 1:1 또는 1:many 대응되는 리스트보드 정의 테이블

권장 컬럼:
- `id uuid primary key`
- `board_slug text unique not null` — 예: `mock-exams`
- `menu_path text unique not null` — 예: `/generate/boards/mock-exams`
- `title text not null`
- `description text null`
- `board_type text not null default 'textbook'`
- `sort_order int not null default 0`
- `is_active boolean not null default true`
- `search_config jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### 2) `generate_listboard_posts`
리스트보드에 등록되는 실제 글/지문/문제원본 테이블

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
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### Indexes
- `generate_listboards(menu_path)` unique
- `generate_listboards(board_slug)` unique
- `generate_listboard_posts(board_id, exam_year, exam_month, grade_level)`
- `generate_listboard_posts(title)` text search or trigram-ready index (phase 1은 `ilike`, phase 2 최적화 가능)

### RLS
- listboards/posts 조회: 일반 사용자 read 허용(활성 + 공개 기준)
- 생성/수정/삭제: admin only
- 초기에 admin CRUD 미구현이면 seed/SQL 등록으로 시작 가능하지만, 운영상 결국 admin tool 필요

---

## User Flow Plan

### Personal flow (유지)
- 사용자 → 개인지문 메뉴 → 기존 문제생성 페이지 → 기존 `GenerateClient` 사용
- 기존 API(`/api/questions/generate`) 및 저장 로직 유지

### Non-personal flow (신규)
1. 사용자 → 예: 모의고사 메뉴 클릭
2. `/generate/boards/mock-exams` 진입
3. `textbook_listboard` 렌더링
4. 상단 `문제 검색` + 필터(년도/월/학년/제목)
5. 검색 결과 목록에서 게시글 선택
6. 선택 게시글의 `passage_text`를 기반으로 `textbook_generate` 진입
7. 기존 생성 로직을 최대한 재사용하되, 지문 입력/불러오기 UX는 게시글 기반으로 단순화

---

## Implementation Phases

### Phase 1A — 데이터 모델/경로 뼈대
1. Supabase migration 추가
   - `generate_listboards`
   - `generate_listboard_posts`
   - index + RLS + admin policy
2. `src/types/supabase.ts` 타입 갱신
3. mock-exams seed 데이터 최소 1~3건 준비
4. 비개인 메뉴용 route namespace 생성
   - `src/app/(dashboard)/generate/boards/[boardSlug]/page.tsx`
   - 필요시 게시글 generate route도 동시 생성

### Phase 1B — `textbook_listboard` UI
1. `textbook_listboard` 컴포넌트 생성
   - 헤더: `문제 검색`
   - 드롭다운 3개: `년도`, `월`, `학년`
   - 검색 input: `제목`
2. mock-exams 전용 query 구현
3. 결과 목록 UI 구성
   - 제목
   - 시험 메타(년도/월/학년)
   - 클릭 시 상세/생성 페이지 진입

### Phase 1C — `textbook_generate` 도입
1. 기존 `generate-client.tsx` 복사 → `textbook_generate` 계열 컴포넌트 생성
2. 차이점 최소화:
   - 지문 source = 게시글의 `passage_text`
   - 내 지문 불러오기/등록하기 버튼은 phase 1에서 제거 또는 비노출
   - 게시글 메타 표시 추가 가능
3. 기존 질문 생성 API 재사용 여부 검토
   - 가능하면 `/api/questions/generate` 재사용
   - 필요 시 post metadata 포함 정도만 확장

### Phase 1D — 메뉴 연결
1. 관리자 메뉴관리의 비개인 child menu href를 신규 board path로 연결
   - 예: `/generate/boards/mock-exams`
2. personal 메뉴만 기존 personal generate route 유지
3. `generate/layout.tsx` / `generate-sidebar.tsx`에서 신규 board path도 자연스럽게 active 처리되는지 확인

### Phase 1E — 운영 입력 경로
선택지 2개:
- **빠른 시작(권장)**: seed/DB 직접 등록으로 mock-exams 먼저 운영
- **정식 운영**: admin listboard/post CRUD 추가

권장: **phase 1에서는 seed 또는 간단 admin CRUD 중 하나만 선택**

---

## File Touchpoints
- 기존 유지/참조
  - `src/app/(dashboard)/generate/[typeId]/page.tsx`
  - `src/app/(dashboard)/generate/[typeId]/generate-client.tsx`
  - `src/app/(dashboard)/generate/layout.tsx`
  - `src/app/(dashboard)/generate/generate-sidebar.tsx`
  - `src/lib/header-navigation-server.ts`
  - `src/app/(admin)/admin/menu-management/actions.ts`
- 신규 예상
  - `src/app/(dashboard)/generate/boards/[boardSlug]/page.tsx`
  - `src/app/(dashboard)/generate/boards/[boardSlug]/textbook-listboard.tsx`
  - `src/app/(dashboard)/generate/boards/[boardSlug]/posts/[postId]/generate/[typeId]/page.tsx`
  - `src/app/(dashboard)/generate/boards/[boardSlug]/posts/[postId]/generate/[typeId]/textbook-generate.tsx`
  - `supabase/migrations/<timestamp>_create_generate_listboards.sql`

---

## Acceptance Criteria
1. 개인지문 메뉴는 기존 생성 화면/동작이 깨지지 않는다.
2. 모의고사 메뉴 진입 시 기존 생성 화면이 아니라 `textbook_listboard`가 먼저 보인다.
3. `textbook_listboard` 상단에 `문제 검색` 문구와 필터 UI가 보인다.
4. 모의고사 게시글 검색이 `년도`, `월`, `학년`, `제목` 기준으로 동작한다.
5. 게시글 선택 후 `textbook_generate` 흐름으로 진입할 수 있다.
6. listboard/post 데이터는 별도 relational table에 저장된다.
7. phase 1에서 `system_settings.header_navigation` JSON에는 FK를 걸지 않는다.
8. 메뉴 경로와 listboard `menu_path` 규칙이 문서화된다.

---

## Risks & Mitigations

### Risk 1 — route collision
- 원인: 기존 `[typeId]` route가 UUID 전제
- 대응: board namespace를 분리(`/generate/boards/...`)

### Risk 2 — 메뉴 JSON과 board 데이터 불일치
- 원인: 메뉴 href 변경 시 board path 미동기화
- 대응: `menu_path` 규칙 고정 + phase 1 운영 체크리스트 + phase 2 validation 고려

### Risk 3 — component copy 후 중복 유지보수 증가
- 원인: `GenerateClient`를 그대로 복사하면 divergence 발생
- 대응: phase 1은 복사 허용, phase 2에서 shared core 추출 검토

### Risk 4 — post schema 과소설계
- 원인: mock-exams 이후 다른 메뉴 메타데이터가 늘어날 수 있음
- 대응: 공통 컬럼 + `search_config`/추가 metadata 확장 여지 확보

### Risk 5 — admin 입력 경로 부재
- 원인: 게시글 등록 필요
- 대응: phase 1 범위에서 seed/manual insert 또는 최소 CRUD 중 하나를 결정

---

## Critic Notes / Scope Cuts
- **한 번에 메뉴 전면 정규화까지 하지 말 것**: phase 1 범위를 초과함
- **현재 personal route는 가능한 건드리지 말 것**: 회귀 위험이 큼
- **mock-exams 한 종류만 먼저 성공시키고 나머지 메뉴 확장**: 수평확장은 다음 단계
- **board/post admin CRUD는 사용자 플로우와 분리해서 단계화**: 없으면 seed로 먼저 검증 가능

---

## Verification Plan
1. DB migration 적용 확인
2. Supabase 타입 갱신 확인
3. mock-exams seed 데이터 조회 확인
4. `/generate/boards/mock-exams` 진입 시 listboard 렌더 확인
5. 필터 조합별 검색 결과 확인
6. 게시글 선택 → `textbook_generate` 진입 확인
7. 기존 personal generate flow 회귀 테스트
8. `npm run lint` 수행
9. 필요 시 generate 관련 경로 수동 QA 캡처

---

## Recommended MVP Slice
**가장 먼저 구현할 범위:**
- mock-exams board 1개
- board/post 테이블 2개
- `textbook_listboard` 1개
- `textbook_generate` 1개
- 메뉴 href 1개 연결
- personal flow untouched

이 범위로 먼저 성공시키고, 이후 다른 2뎁스 메뉴를 동일 패턴으로 확장하는 것이 가장 안전하다.
