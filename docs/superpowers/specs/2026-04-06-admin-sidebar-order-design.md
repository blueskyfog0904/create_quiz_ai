# 관리자 패널 사이드바 메뉴 순서 조정 설계

## 목표
- 관리자 패널 사이드바 메뉴 순서를 관리자 화면에서 변경할 수 있게 한다.
- 순서는 영어/국어 subject별로 별도 저장한다.
- 순서 변경 방식은 각 메뉴 행의 위/아래 버튼이다.
- 모든 관리자 메뉴가 순서 변경 대상이다.

## 현재 원인
- `src/components/layout/admin-sidebar.tsx`가 관리자 메뉴 순서를 코드 상수 `menuItems`로 고정하고 있다.
- `src/app/(admin)/admin/menu-management/*`에는 이미 subject별 관리 UI와 위/아래 이동 패턴이 존재하지만, 관리자 사이드바 메뉴에는 연결되어 있지 않다.

## 접근 방식
1. 관리자 사이드바의 기본 메뉴 정의는 코드에 유지한다.
2. 별도의 workspace setting key에 subject별 관리자 메뉴 순서를 저장한다.
3. 저장된 순서가 있으면 그 순서를 우선 적용하고, 없으면 기본 순서를 사용한다.
4. 메뉴관리 화면에 "관리자 패널 메뉴 순서" 섹션을 추가하고 위/아래 버튼으로 배열을 조정 후 저장한다.

## 데이터 모델
- 저장 위치: `workspace_settings`
- key: `admin_sidebar_navigation`
- value 예시:
  ```json
  {
    "items": [
      "/admin",
      "/admin/menu-management",
      "/admin/landing-pages"
    ]
  }
  ```
- 이름/아이콘/subject 쿼리 처리 등은 기존 코드 기본 정의를 사용하고, 저장값은 순서만 담당한다.

## 구현 범위
- `src/components/layout/admin-sidebar.tsx`
- 새 서버 유틸(관리자 사이드바 설정 조회/저장)
- `src/app/(admin)/admin/menu-management/actions.ts`
- `src/app/(admin)/admin/menu-management/menu-management-client.tsx`
- 관련 회귀 테스트 추가

## 검증
- 영어/국어 subject 각각 다른 순서 저장 가능
- 메뉴관리 화면에서 위/아래 이동 가능
- 저장 후 관리자 사이드바에 같은 순서 반영
- eslint / typecheck / 관련 테스트 통과
