# Session Handoff — Generate Menu Sync-Safe / Listboard Rollout

작성일: 2026-03-13

## 1. 이번 세션에서 완료한 작업

### A. 설계/계획 문서 정리
아래 문서들을 작성했고, 최종 설계 기준 문서는 `plan-generate-menu-sync-safe-v2-20260313.md` 이다.

- `.omx/plans/plan-generate-menu-sync-safe-v2-20260313.md`
- `.omx/plans/spec-generate-menu-migration-20260313.md`
- `.omx/plans/spec-generate-menu-route-20260313.md`
- `.omx/plans/spec-generate-menu-admin-ui-20260313.md`
- `.omx/plans/prd-generate-menu-sync-safe-v1.md`
- `.omx/plans/test-spec-generate-menu-sync-safe-v1.md`

### B. Supabase DB 작업 완료
다음 migration을 생성했고, **실제 Supabase 프로젝트 `kzcweelnzhcmiuvjgeyi`에 적용 완료**했다.

- `supabase/migrations/20260313021000_create_generate_menu_entries.sql`

생성된 테이블:
- `public.generate_menu_entries`
- `public.generate_listboard_posts`

핵심 제약:
- `generate_listboard_posts.menu_entry_id`는 `entry_type='listboard'` 메뉴만 참조 가능하도록 trigger validation 적용됨

초기 seed / 이후 backfill 반영 결과:
- `textbook` (`교과서`) — inactive/invisible
- `mock-exams` (`모의고사`) — active/visible
- `entlec` (`수능특강`) — active/visible
- `subtextbook` (`부교재`) — inactive/invisible
- `personal` (`개인지문`) — active/visible

### C. 구현 완료된 기능

#### 1) 헤더 메뉴 source-of-truth 분리 기반 추가
- 일반 헤더 메뉴는 계속 `system_settings.header_navigation` 사용
- 문제생성 2단계 메뉴는 `generate_menu_entries` 기반으로 합성
- 관련 서버 로직 추가/수정:
  - `src/lib/header-navigation-server.ts`
  - `src/lib/generate-menu.ts`
  - `src/lib/generate-menu-server.ts`

#### 2) 관리자 메뉴관리 화면 개편
`src/app/(admin)/admin/menu-management/*`

- 일반 헤더 메뉴 관리와 문제생성 2단계 메뉴 관리를 분리
- `/generate` children은 일반 헤더 메뉴에서 직접 관리하지 않도록 변경
- 문제생성 메뉴 CRUD 추가
- 문제생성 listboard 게시글 CRUD 추가
- legacy `/generate` children -> DB backfill 버튼 추가

#### 3) 문제생성 board/listboard 라우트 MVP 추가
추가된 경로:
- `/generate/boards/[slug]`
- `/generate/boards/[slug]/posts/[postId]`
- `/generate/boards/[slug]/posts/[postId]/generate/[typeId]`

추가 파일:
- `src/app/(dashboard)/generate/boards/data.ts`
- `src/app/(dashboard)/generate/boards/[slug]/page.tsx`
- `src/app/(dashboard)/generate/boards/[slug]/textbook-listboard.tsx`
- `src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/page.tsx`
- `src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/generate/[typeId]/page.tsx`
- `src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/generate/[typeId]/textbook-generate-client.tsx`

#### 4) 타입 반영
- `src/types/supabase.ts`에 신규 테이블 타입 반영

### D. 커밋 완료
이번 세션에서 생성된 관련 커밋:
- `a1608e6` — `feat: add generate menu listboard foundation`
- `1d02871` — `feat: add generate menu backfill and post admin`

---

## 2. 현재 구조 요약

### source of truth
- 일반 헤더 메뉴: `system_settings.header_navigation`
- 문제생성 2단계 메뉴: `generate_menu_entries`
- listboard 글: `generate_listboard_posts`

### 개인지문 경로
- 메뉴 진입점: `/generate`
- 실제 생성: 기존 `/generate/[typeId]`

### 비개인 메뉴 경로
- listboard 진입: `/generate/boards/[slug]`
- 게시글 선택: `/generate/boards/[slug]/posts/[postId]`
- 교재형 생성: `/generate/boards/[slug]/posts/[postId]/generate/[typeId]`

---

## 3. 검증 상태

### 완료
- Supabase migration 적용 완료
- 신규 테이블 존재 확인 완료
- seed/backfill row 확인 완료
- 변경 파일 대상 eslint 통과
- 변경 파일 대상 TS diagnostics 통과

### 남아 있는 기존 baseline 이슈
프로젝트 전체 typecheck 기준으로 기존 레포에 아래 선행 에러가 남아 있음:
- `src/lib/export-utils.ts` 2건

이건 이번 작업과 직접 관련 없는 기존 이슈다.

또한 전체 `npm run lint`는 레포 전역의 기존 다수 lint 에러 때문에 여전히 실패한다.
다만 이번에 수정한 파일들만 대상으로 돌린 eslint는 통과했다.

---

## 4. 현재 미완료 / 다음에 진행해야 할 작업

### 우선순위 1 — 실제 운영 검증
1. 관리자 메뉴관리 페이지에서 아래 점검
   - 문제생성 메뉴 목록 렌더 정상 여부
   - backfill 버튼/상태 표시 정상 여부
   - 게시글 생성/수정/보관 정상 여부
2. 사용자 화면 점검
   - 헤더/사이드바에 문제생성 DB 메뉴가 정상 반영되는지
   - `/generate/boards/mock-exams` 진입 정상 여부
   - 게시글 선택 -> 문제 유형 선택 -> textbook_generate 진입 정상 여부

### 우선순위 2 — mock-exams 게시글 실제 데이터 입력
현재 `generate_listboard_posts`에 실제 게시글 데이터가 거의 없거나 없을 가능성이 높다.
따라서 다음 중 하나 필요:
- 관리자 UI에서 직접 등록
- 또는 Supabase SQL로 sample/published post insert

최소 1~3개 mock-exams 게시글을 넣고 검색 플로우를 확인해야 함.

### 우선순위 3 — textbook_generate 고도화
현재 `textbook-generate-client.tsx`는 MVP 수준이다.
다음 보완 가능:
- 기존 generate client와 더 많은 동작 일치
- 저장 시 post 메타(source/year/month/grade) 연계
- 생성 완료 UX 개선
- 교재형 전용 저장 정책 정리

### 우선순위 4 — cutover 준비
아직은 사실상 `hybrid_fallback` 단계로 보는 것이 안전하다.
다음 작업 필요:
- legacy generate children 전체 backfill 상태 최종 점검
- DB row count vs 운영 대상 child count 검증
- `/generate` children 편집 완전 차단 동작 확인
- 이후 `db_authoritative` 전환 준비

### 우선순위 5 — post admin UX 개선
가능한 다음 개선:
- 게시글 검색/필터 admin UI
- 게시글 pagination
- source config 연계 입력 UI
- 게시글 상세 미리보기 개선

### 우선순위 6 — 기존 baseline 정리(선택)
- `src/lib/export-utils.ts` type error 2건 수정
- 레포 전역 lint debt 정리

---

## 5. 재시작 후 바로 확인할 파일
재부팅 후 가장 먼저 보면 좋은 파일:

### 핵심 구현 파일
- `src/lib/header-navigation-server.ts`
- `src/lib/generate-menu.ts`
- `src/lib/generate-menu-server.ts`
- `src/app/(admin)/admin/menu-management/actions.ts`
- `src/app/(admin)/admin/menu-management/menu-management-client.tsx`
- `src/app/(dashboard)/generate/boards/data.ts`
- `src/app/(dashboard)/generate/boards/[slug]/page.tsx`
- `src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/page.tsx`
- `src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/generate/[typeId]/textbook-generate-client.tsx`

### 기준 문서
- `.omx/plans/plan-generate-menu-sync-safe-v2-20260313.md`
- `.omx/plans/session-handoff-20260313-generate-menu-sync-safe.md`

---

## 6. 재시작 후 추천 첫 작업
재부팅 후 이어서 한다면 추천 순서:

1. `npm run dev` 실행
2. 관리자 `/admin/menu-management` 접속
3. mock-exams 게시글 1~3개 등록
4. 사용자 `/generate/boards/mock-exams` 검증
5. 게시글 -> textbook_generate -> 저장까지 end-to-end 검증
6. 그 다음 cutover/고도화 작업 진행

---

## 7. 한 줄 요약
이번 세션에서 **DB 구조 + 관리자 메뉴관리 분리 + listboard 경로 + textbook_generate MVP + legacy menu backfill 기반**까지 완료했다.
다음 세션에서는 **실제 게시글 데이터 입력 후 end-to-end 검증과 cutover 준비**가 핵심이다.
