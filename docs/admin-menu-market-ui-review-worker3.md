# 문제마켓 2단계 메뉴 관리 UI 리뷰 (worker-3)

## 이번 작업 범위
- `src/app/(admin)/admin/menu-management/menu-management-client.tsx`
  - 일반 헤더 메뉴 표에서 `/market` child 편집을 분리
  - `문제마켓 2단계 메뉴 관리` 섹션 추가
  - 문제생성과 동일하게 별도 섹션에서 child row를 정렬/수정/보관/활성 토글 가능하도록 정리

## 의도
- `/generate`만 예외 처리하던 관리자 UI를 `/market`에도 동일한 패턴으로 확장
- 문제마켓은 `개인지문` 같은 special lane 없이 모두 동일한 child row 구조만 노출
- 백엔드 lane이 merge 되기 전에도 `/market` child 관리 동선을 독립 섹션으로 먼저 고정

## 현재 브랜치 기준 계약
- 이 브랜치의 문제마켓 섹션은 **현재 header config의 `/market` children** 을 별도 표에서 관리한다.
- backend lane merge 후에는 동일 섹션의 데이터 source만 `market_menu_entries`로 교체하면 된다.
- UI가 기대하는 기본 row 계약은 아래와 같다.
  - `id`
  - `title`
  - `href` 또는 slug에서 계산 가능한 preview path
  - `isActive`

## merge 시 확인 포인트
1. backend lane에서 `/market` child를 일반 헤더 저장 경로 대신 DB source로 연결할 때, 일반 헤더 표의 `/market` child 잠금 상태는 유지한다.
2. market row가 `is_visible` / `is_active`를 모두 가지게 되면, 현재 단일 `활성` column을 두 상태로 확장할지 검토한다.
3. `saveMenuManagementConfig()`가 `/market` child를 보존/무시해야 하는 시점은 backend source authoritative 여부에 맞춰 재조정한다.

## 코드 품질 메모
- `/generate` 전용 분기 일부를 `managed child parent` 개념으로 일반화했다.
- 문제마켓 섹션은 기존 dialog / move / toggle / delete 동선을 재사용해서 새 UI 전용 로직 추가를 최소화했다.
