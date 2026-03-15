# Session Handoff — Generate Menu Sync-Safe / Listboard Rollout

작성일: 2026-03-15

## 1. 현재까지 완료된 작업

### A. 설계/기준 문서
기존 기준 문서 및 핸드오프 문서:

- `.omx/plans/plan-generate-menu-sync-safe-v2-20260313.md`
- `.omx/plans/spec-generate-menu-migration-20260313.md`
- `.omx/plans/spec-generate-menu-route-20260313.md`
- `.omx/plans/spec-generate-menu-admin-ui-20260313.md`
- `.omx/plans/prd-generate-menu-sync-safe-v1.md`
- `.omx/plans/test-spec-generate-menu-sync-safe-v1.md`
- `.omx/plans/session-handoff-20260313-generate-menu-sync-safe.md`

### B. Supabase DB 작업 완료 상태
이미 적용 완료된 migration:

- `supabase/migrations/20260313021000_create_generate_menu_entries.sql`

생성/사용 중인 테이블:
- `public.generate_menu_entries`
- `public.generate_listboard_posts`

핵심 구조:
- 일반 헤더 메뉴 source of truth: `system_settings.header_navigation`
- 문제생성 2단계 메뉴 source of truth: `generate_menu_entries`
- listboard 게시글 source of truth: `generate_listboard_posts`

### C. 이미 구현 완료된 기능

#### 1) generate 메뉴 분리 구조
- 일반 헤더 메뉴와 문제생성 2단계 메뉴 분리
- `/generate` children 은 일반 헤더 메뉴에서 직접 관리하지 않도록 변경
- 문제생성 2단계 메뉴는 `generate_menu_entries` 기반으로 합성

관련 핵심 파일:
- `src/lib/header-navigation-server.ts`
- `src/lib/generate-menu.ts`
- `src/lib/generate-menu-server.ts`

#### 2) 관리자 메뉴관리 개편
- 문제생성 메뉴 CRUD
- listboard 게시글 CRUD
- legacy `/generate` children -> DB backfill 버튼 추가

관련 파일:
- `src/app/(admin)/admin/menu-management/actions.ts`
- `src/app/(admin)/admin/menu-management/menu-management-client.tsx`

#### 3) 사용자 listboard 경로 MVP
추가된 경로:
- `/generate/boards/[slug]`
- `/generate/boards/[slug]/posts/[postId]`
- `/generate/boards/[slug]/posts/[postId]/generate/[typeId]`

관련 파일:
- `src/app/(dashboard)/generate/boards/data.ts`
- `src/app/(dashboard)/generate/boards/[slug]/page.tsx`
- `src/app/(dashboard)/generate/boards/[slug]/textbook-listboard.tsx`
- `src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/page.tsx`
- `src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/generate/[typeId]/page.tsx`
- `src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/generate/[typeId]/textbook-generate-client.tsx`

#### 4) 타입 반영
- `src/types/supabase.ts` 에 신규 테이블 타입 반영 완료

---

## 2. 2026-03-15 세션에서 추가로 완료한 작업

이번 세션에서는 **리스트보드 게시글 메타데이터 입력 UX**를 정리했다.

### 반영 내용

#### A. 년도/월 입력 방식 변경
리스트보드 게시글 추가/수정 다이얼로그에서:
- 년도: 스크롤형 셀렉트로 변경
- 월: 스크롤형 셀렉트로 변경
- 새 게시글 추가 시 기본값은 **오늘 기준 연도/월**로 자동 세팅

예: 2026-03-15 기준
- 기본 연도: `2026`
- 기본 월: `3`

#### B. 학년 입력 제한
학년 입력을 자유 텍스트에서 드롭다운으로 변경했고,
선택지는 아래 3개만 허용되도록 정리했다.

- `1학년`
- `2학년`
- `3학년`

#### C. 출처 입력 제거
리스트보드 게시글 추가/수정 UI에서 아래 출처 관련 입력을 제거했다.

- `source_type`
- `source_1`
- `source_2`
- `source_3`
- `source_4`

즉, 현재 listboard post admin 에서는 출처 없이도 게시글을 저장할 수 있다.

#### D. 서버측 검증 및 정규화 보강
서버 로직에서도 아래 검증/정규화를 추가했다.

- `exam_year`: 2000~2100 범위 정수 검증
- `exam_month`: 1~12 범위 정수 검증
- `grade_level`: `1학년/2학년/3학년` 외 값 차단
- 기존 legacy 값(`High1`, `High2`, `High3`, `Middle1`, `Middle2`, `Middle3`, `고1`, `고2`, `고3`)은 가능한 경우 `1학년/2학년/3학년`으로 정규화

#### E. textbook_generate 화면 학년도 정렬
기존 교재형 생성 화면에서도 grade 값이 listboard 기준과 맞도록 조정했다.
즉, 현재는 `textbook-generate-client.tsx` 도 아래 기준을 사용한다.

- `1학년`
- `2학년`
- `3학년`

---

## 3. 이번 세션에서 수정된 파일

- `src/app/(admin)/admin/menu-management/actions.ts`
- `src/app/(admin)/admin/menu-management/menu-management-client.tsx`
- `src/lib/generate-menu-server.ts`
- `src/lib/generate-menu.ts`
- `src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/generate/[typeId]/textbook-generate-client.tsx`

---

## 4. 커밋 상태

기존 관련 커밋:
- `a1608e6` — `feat: add generate menu listboard foundation`
- `1d02871` — `feat: add generate menu backfill and post admin`

이번 세션 추가 커밋:
- `b36cd75` — `feat: refine listboard post metadata inputs`

---

## 5. 검증 상태

### 이번 세션에서 확인 완료
- 대상 변경 파일 ESLint 통과
- 대상 변경 파일 TS diagnostics 통과

### 여전히 남아 있는 기존 baseline 이슈
프로젝트 전체 baseline 이슈는 이전과 동일하게 남아 있다.

- 전체 `npm run lint` 는 레포 전역 기존 lint debt 때문에 실패 가능
- `src/lib/export-utils.ts` 관련 기존 type error 2건은 별도 선행 이슈

즉, 이번 변경 자체는 통과했지만 레포 전체가 완전히 clean 한 상태는 아님.

---

## 6. 현재 구조 요약

### 메뉴/경로 구조
- 개인지문 진입: `/generate`
- listboard 진입: `/generate/boards/[slug]`
- 게시글 선택: `/generate/boards/[slug]/posts/[postId]`
- 교재형 생성: `/generate/boards/[slug]/posts/[postId]/generate/[typeId]`

### 현재 listboard post admin 입력 정책
- 제목: 입력
- 지문 내용: 입력
- 년도: 셀렉트
- 월: 셀렉트
- 학년: `1학년/2학년/3학년` 드롭다운
- 출처: 없음
- 상태: draft / published / archived
- 활성 여부: 스위치

---

## 7. 다음 세션에서 우선 진행할 작업

### 우선순위 1 — 실제 운영 화면 검증
아직 브라우저 기준 수동 검증은 남아 있다.
다음 순서로 확인하면 된다.

1. `npm run dev`
2. 관리자 `/admin/menu-management` 접속
3. 리스트보드 게시글 추가 다이얼로그 확인
   - 년도 기본값이 오늘 기준인지
   - 월 기본값이 오늘 기준인지
   - 학년이 1/2/3학년만 선택 가능한지
   - 출처 입력이 사라졌는지
4. 게시글 생성/수정/보관 동작 확인

### 우선순위 2 — mock-exams 게시글 실제 데이터 입력
현재 핵심 운영 검증을 위해 아래가 필요하다.

- `mock-exams` 게시글 1~3개 이상 등록
- 최소 published 상태 게시글 준비
- `/generate/boards/mock-exams` 사용자 화면에서 실제 노출 확인

### 우선순위 3 — end-to-end 검증
아래 흐름 전체 확인 필요:

1. `/generate/boards/mock-exams`
2. 게시글 클릭
3. 문제 유형 선택
4. `textbook_generate` 진입
5. 문제 생성
6. 저장

### 우선순위 4 — cutover 준비
아직은 사실상 `hybrid_fallback` 단계로 보는 것이 안전함.
다음 검토 필요:

- legacy generate children 전체 backfill 완료 여부
- DB row count vs 실제 운영 child count 검증
- `/generate` children 직접 편집 차단 동작 최종 확인
- 이후 `db_authoritative` 전환 준비

### 우선순위 5 — 추가 UX 개선 후보
- post admin 검색/필터
- pagination
- 게시글 상세 미리보기 개선
- textbook_generate UX 보강
- 저장 시 post 메타 활용 정책 정리

---

## 8. 다음 세션 시작 시 가장 먼저 읽을 파일

### 기준 문서
- `.omx/plans/session-handoff-20260315-generate-menu-sync-safe.md`
- `.omx/plans/session-handoff-20260313-generate-menu-sync-safe.md`
- `.omx/plans/plan-generate-menu-sync-safe-v2-20260313.md`

### 핵심 구현 파일
- `src/lib/generate-menu.ts`
- `src/lib/generate-menu-server.ts`
- `src/app/(admin)/admin/menu-management/actions.ts`
- `src/app/(admin)/admin/menu-management/menu-management-client.tsx`
- `src/app/(dashboard)/generate/boards/data.ts`
- `src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/generate/[typeId]/textbook-generate-client.tsx`

---

## 9. 한 줄 요약

현재까지 **DB 구조 + 관리자 메뉴 분리 + listboard/post CRUD + listboard 라우트 + textbook_generate MVP + listboard post 메타데이터 입력 UX 정리**까지 완료했다.
다음 세션에서는 **실제 게시글 데이터 입력과 관리자/사용자 end-to-end 검증**이 핵심이다.
