# 문제마켓 2단계 메뉴 관리 확장안 (worker-1)

## 결론
- `문제마켓`도 `AI문제생성`과 동일하게 **헤더 JSON을 최종 렌더링 대상으로 두고**, 실제 2단계 메뉴의 소스 오브 트루스는 **별도 DB 테이블**로 분리하는 안을 권장합니다.
- 개인용/예외용 lane 없이 `listboard` 계열만 허용하는 구조로 시작하는 것이 현재 `문제마켓` UX와 데이터 모델에 가장 안전합니다.
- 1차 구현은 `문제마켓`용 메뉴 엔트리 테이블 + (필요 시) 게시글/상품 연결 FK 추가 + 하이브리드 fallback + 관리자 화면 탭 확장 순서가 적절합니다.

## 근거 요약
1. 현재 헤더는 `system_settings.header_navigation` JSON을 읽지만, `AI문제생성`은 실제 표시 시 DB 엔트리를 merge 하는 하이브리드 구조입니다.
2. `AI문제생성`은 `generate_menu_entries`가 2단계 메뉴 source of truth이고, header 저장 시에도 `/generate` 자식은 JSON 직접 편집 대신 기존 DB 연동 자식을 보존합니다.
3. `문제마켓`은 아직 별도 메뉴 소스가 없고, 관리자 사이드바에서도 단순 `출처 관리`로만 노출됩니다.
4. 사용자 화면에서는 이미 `문제마켓(from_community)` 필터/개념이 존재하므로, 관리자용 2단계 메뉴를 DB로 승격해도 도메인 명세와 충돌이 적습니다.

## 권장 데이터 구조
### 1) 신규 테이블
`market_menu_entries` (가칭)
- `id uuid pk`
- `entry_key text unique not null` — 불변 내부 키
- `slug text unique not null` — `/library/purchased?market=<slug>` 또는 향후 `/market/<slug>` 대응
- `title text not null`
- `description text null`
- `sort_order integer not null default 0`
- `is_visible boolean not null default true`
- `is_active boolean not null default true`
- `search_config jsonb not null default '{}'::jsonb`
- `created_at/updated_at/deleted_at`

### 2) 데이터 ownership
- **header JSON (`system_settings`)**: 상위 네비게이션 순서/라벨/활성 여부의 최종 저장소
- **`market_menu_entries`**: `문제마켓` 하위 메뉴 source of truth
- **문항/상품 본문 테이블**: 기존 `questions`/구매 라이브러리/커뮤니티 출처 데이터 유지
- 필요 시 후속으로 `questions.market_menu_entry_id` 같은 nullable FK 추가 검토

### 3) why 별도 테이블인가
- 기존 `source_configs`는 출처 입력 폼용 라벨/옵션 저장소라 2단계 메뉴 정렬/활성화/slug/노출 제어를 담당하기 어렵습니다.
- `generate_menu_entries`는 `personal_generate | listboard` 제약과 `/generate/...` 경로 규칙이 강해 `문제마켓` 재사용보다 복제가 안전합니다.

## 마이그레이션 / 백필 경로
1. `market_menu_entries` 생성
2. 기본 seed는 비우거나, 필요 시 기존 `source_configs.type_name`을 읽어 `entry_key/slug/title`만 1회 백필
3. 헤더 JSON에 `/library/purchased` 또는 별도 `문제마켓` parent가 있으면, generate와 동일하게 `hybrid_fallback` 기간 운영
4. 관리자 UI에서 DB 엔트리 저장 성공 후 header 렌더 시 merge
5. 운영 안정화 후 `db_authoritative` 전환

## 관리자 UX 권장안
- `/admin/menu-management` 내부에 섹션/탭을 추가
  - `공통 헤더 메뉴`
  - `AI문제생성 2단계 메뉴`
  - `문제마켓 2단계 메뉴`
- `문제마켓 2단계 메뉴`는 generate와 같은 패턴으로:
  - 목록/정렬/활성화/노출
  - slug 편집
  - 설명/검색설정
  - 백필 상태 표시
- `출처 관리` 화면은 유지하되, 메뉴 관리와 역할을 분리

## 구현 순서 제안
1. DB: `market_menu_entries` migration + RLS/admin policy
2. server lib: `market-menu.ts`, `market-menu-server.ts`
3. header merge: `getHeaderNavigationConfig()`에서 `/generate`와 같은 방식으로 `문제마켓` parent children merge
4. admin action/UI: `/admin/menu-management`에 market section 추가
5. optional backfill: `source_configs` 기반 1회 변환 도구 추가

## 주의점
- `generate_menu_entries`에 market 타입을 억지로 넣으면 기존 trigger/route/build 함수가 `/generate/...` 전제를 많이 가져 리스크가 큽니다.
- `source_configs`를 그대로 2단계 메뉴 source로 쓰면 UX용 slug/sort_order/is_visible/is_active 관리가 비정규적으로 흩어집니다.
- header 저장 로직은 현재 `/generate` 자식을 보존하므로, `문제마켓`도 동일한 preserve/merge 규칙이 필요합니다.

## 증거
- Header base + generate merge: `src/lib/header-navigation-server.ts:27-56`
- Header save 시 `/generate` children 보존: `src/lib/header-navigation-server.ts:58-107`
- Generate 2단계 메뉴 source of truth 및 제약: `supabase/migrations/20260313021000_create_generate_menu_entries.sql:3-23`
- Generate posts가 listboard entry만 참조하도록 강제: `supabase/migrations/20260313021000_create_generate_menu_entries.sql:87-128`
- Generate menu merge/fallback 로직: `src/lib/generate-menu.ts:18-167`
- 관리자 사이드바에는 아직 `출처 관리`만 존재: `src/components/layout/admin-sidebar.tsx:79-83`
- 출처 관리는 단순 라벨/옵션 CRUD: `src/app/(admin)/admin/source-configs/source-config-client.tsx:23-220`, `src/app/api/admin/source-configs/route.ts:5-117`
- 사용자 화면에는 이미 `문제마켓` 필터가 존재: `src/app/(dashboard)/library/purchased/purchased-client.tsx:337-346`
- Supabase MCP: this worker session에서 `list_mcp_resources` 결과가 비어 있어 로컬 schema evidence로 판단
