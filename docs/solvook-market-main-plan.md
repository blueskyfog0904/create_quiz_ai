# Solvook 컨셉 문제마켓 임시 메인 재구현 계획

## 0. 문서 상태

- 작성일: 2026-07-28
- 구현 대상: `/preview/solvook-concept?subject=english|korean`
- 상태: 구현 및 독립 최종 검증 PASS
- 기준: Git `HEAD`의 기존 Solvook 컨셉 시각 구조를 보존하고, 내용·데이터·동작만 실제 문제마켓에 연결한다.
- 제외: 루트 `/`, `/english/market`, `/korean/market`의 메인 교체

이 문서는 사용자 요청 파악 → 현재 구조 감사 → 계획 작성 → 독립 계획 검증 과정을 거친 뒤 구현 기준으로 사용한다. 구현은 각 Phase에서 계획 확인 → 구현 → 검증 → 실패 분석 및 재구현 loop를 반복하고, 검증을 통과한 뒤에만 다음 Phase로 넘어간다.

## 1. 사용자 요청을 구현 계약으로 변환

### 1.1 반드시 달성할 결과

1. 프리뷰 상단의 영어·국어를 누르면 같은 페이지의 `subject`가 바뀐다.
2. 선택 과목에 맞춰 광고, 검색 목적지, 인기 자료, 출처, 카테고리, 최근 자료, CTA 링크가 한 번에 바뀐다.
3. 인기 자료는 최근 30일 다운로드 URL 발급 사용자 수를 기준으로 순위를 표시하고 슬라이드로 이동한다.
4. 교재·출처 탐색은 기존 `source_configs`와 상품의 `source_type`, `source_1..4`를 재사용한다.
5. 문제마켓 카테고리 링크와 최근 등록 자료는 실제 공개 상품 데이터를 사용한다.
6. 관리자에서 과목별 메인 노출 여부·개수·출처 유형·카테고리 순서를 설정한다.
7. 신규 관리자 메뉴와 화면 제목은 정확히 `(임시) 문제마켓 메인 관리`로 표시한다.
8. 기존 광고 메뉴명 `(임시)메인광고설정`은 바꾸지 않는다.

### 1.2 시각 구조 보존 계약

이번 작업은 리디자인이 아니다. 다음 Git `HEAD` 구조를 복구·보존한다.

- 모바일/데스크톱이 분리된 2단 상단 헤더
- 좌측 4개 안내 카드와 우측 보라색 패널로 이루어진 `CampaignHero`
- `TEACHER'S PICK`의 4:5 책 표지형 카드
- 둥근 외곽 카드와 2열→4열 그라데이션 타일의 `TextbookExplorer`
- 하나의 테두리 컨테이너 안에 쌓이는 최근 자료 행 목록
- 기존 어두운 `HomeFinalCta`
- 기존 3열 footer와 `StudioContainer`/`StudioLandingPageFrame` 여백

새 파란색·초록색 범용 hero, 큰 카테고리 카드 grid, 좌측 selector형 출처 explorer, 최근 자료 카드 grid를 만들지 않는다. 기존 JSX hierarchy와 `className`은 가능한 한 그대로 두고 props, 문구, href, 반복 데이터와 필요한 최소 상태만 바꾼다.

### 1.3 본문 순서

사용자가 지정한 정보 순서를 기존 시각 문법으로 조립한다.

1. 과목별 광고 또는 원본 모양의 `CampaignHero`
2. 원본 Teacher’s Pick 카드 모양의 인기 다운로드 슬라이더
3. 원본 행 목록 모양의 최근 등록 자료
4. 원본 TextbookExplorer 모양의 교재·출처 탐색
5. 원본 HomeFinalCta

## 2. 현재 구조 감사 결과

### 2.1 원본 프리뷰

- `layout.tsx`는 `PreviewHeader → main → PreviewFooter` 구조다.
- `page.tsx`는 `StudioLandingPageFrame` 안에서 광고 fallback hero와 목데이터 섹션을 조립한다.
- `campaign-hero.tsx`에는 좌측 4개 안내 카드, 보라 hero, 검색창, 대표 자료 white card가 있다.
- 원본의 `quick-access-grid.tsx`는 작은 아이콘형 4→8열 타일이지만 최신 사용자 결정에 따라 메인 본문에서는 제거한다.
- `home-material-sections.tsx`에는 Teacher’s Pick cover cards, TextbookExplorer gradient cards, 최근 행 목록, CTA가 있다.
- 현재 Git working tree의 이전 구현은 위 구조 대부분을 새 DOM으로 바꿨으므로 사용자의 최신 의도와 맞지 않는다.

### 2.2 재사용 가능한 실제 데이터

- 상품: `market_items`
- 문제마켓 카테고리: `market_menu_entries`
- 출처 설정: `source_configs`
- 과목 경계: `workspace_subject = english | korean`
- 다운로드 이벤트: `market_download_events`
- 메인 편성 설정: 기존 `workspace_settings`의 과목별 `market_home` JSON
- 광고 설정: 기존 `system_settings.main_ad_carousel`

공개 메인에는 같은 과목이면서 `published`, `is_active=true`, `deleted_at is null`인 상품과 visible/active 카테고리만 전달한다.

### 2.3 실제 운영 데이터 상태

읽기 전용 감사에서 확인된 현재 상태는 다음과 같다.

- 공개 상품: 영어 1건, 국어 144건
- 공개 카테고리: 영어 2건, 국어 2건
- 최근 30일 다운로드 이벤트: 양 과목 0건
- 공개 상품의 `source_type`, `source_1..4`: 현재 모두 공란
- 광고 설정 row: 없음

따라서 0건 상태가 정상 운영 상태다. 조회수나 샘플 자료로 위장하지 않고 각 원본 컴포넌트 모양 안에서 명시적 empty state를 보여준다.

### 2.4 이전 구현에서 재사용할 부분

- `MarketHomeConfig`의 normalize/validate
- 과목별 공개 DTO 조회와 섹션별 오류 격리
- 최근 30일 `count(distinct user_id)` 인기 RPC
- `sourceType`, `source1..4` exact 목록 필터
- 광고 설정의 영어/국어 분리
- `(임시) 문제마켓 메인 관리` 관리자 page/API와 과목별 설정 저장

### 2.5 이전 구현에서 폐기할 부분

- 원본 hero/header/footer를 대체한 새 시각 구조
- 큰 `MarketCategoryGrid`
- selector/sidebar 방식의 새 `SourceExplorer`
- 4:3 범용 인기 카드와 최근 자료 grid
- CTA 삭제
- 원본 컴포넌트 존재를 전제로 한 기존 시각 회귀 테스트를 stale로 취급하는 접근

## 3. 데이터와 동작 계약

### 3.1 과목 전환

- 기본값과 잘못된 `subject` 값은 `english`로 정규화한다.
- 영어/국어 링크는 각각 `/preview/solvook-concept?subject=english|korean`이다.
- 활성 상태는 기존 밑줄·텍스트 스타일과 `aria-current="page"`로 표시한다.
- 상단 검색은 `/{subject}/market/{첫 공개 카테고리 slug 또는 entexam}`로 보낸다.
- root와 운영 market index는 건드리지 않는다.

### 3.2 광고와 hero fallback

- 광고가 있으면 기존 `MainAdCarousel`을 그대로 사용한다.
- 광고는 선택 과목 데이터만 반환한다.
- 광고가 없으면 Git `HEAD`의 `CampaignHero`를 렌더한다.
- hero 좌측 4개 카드는 같은 모양으로 인기, 출처, 최근 섹션과 첫 문제마켓 카테고리 route로 연결한다.
- 보라 패널 대표 자료는 실제 인기 첫 상품 또는 최근 첫 상품을 사용한다.
- 실제 상품이 없으면 같은 white card 틀 안에 “자료 준비 중”을 표시한다.

### 3.3 인기 다운로드 슬라이더

- 기준: 현재 시점부터 최근 30일의 다운로드 URL 발급 이벤트
- 중복 제거: 같은 상품의 `count(distinct user_id)`
- 정렬: 사용자 수 내림차순 → `published_at` 내림차순 → item id 오름차순
- 후보: 같은 과목의 공개·활성·미삭제 상품이며 visible/active 카테고리에 속한 상품
- 표기: “최근 30일 다운로드 URL 발급 사용자 기준”
- 카드: 원본 Teacher’s Pick의 4:5 cover, badge, 제목, 출처, 문항 meta를 유지하고 순위와 집계 수만 넣는다.
- viewport: 원본 밀도를 보존해 모바일/태블릿 2개, 데스크톱 4개
- 동작: 이전·다음, page 상태, 5초 순환
- pause: hover, rail 내부 focus, document hidden, reduced motion
- 한 page 이하이면 자동 전환과 조작을 숨긴다.
- 이벤트가 없으면 해당 section 자리에서 “아직 다운로드 집계가 없습니다”를 표시한다.

이 값은 파일 전송 완료 수가 아니라 다운로드 URL 발급 사용자 proxy다.

### 3.4 교재·출처 탐색

- 새 taxonomy 테이블을 만들지 않는다.
- 출처 유형과 단계 label은 선택 과목의 `source_configs`를 사용한다.
- 실제 탐색 path는 공개 상품의 `source_type`, `source_1..4`에서 완전한 조합만 만든다.
- 카드와 path 선택 UI는 원본 TextbookExplorer의 rounded shell과 gradient tile 문법 안에서 구현한다.
- 결과 링크는 `/{subject}/market/{categorySlug}?sourceType=...&source1=...` 형식이다.
- 운영 목록 page/API는 NFC normalize + exact `.eq`로 같은 필터를 적용한다.
- 설정만 있고 실제 path가 없으면 원본 tile에 “자료 0개”를 표시한다.
- 국어처럼 출처 설정도 없으면 원본 외곽 shell 안에 준비 안내를 표시한다.
- 공란을 자동 추론하거나 backfill하지 않는다.

### 3.5 문제마켓 카테고리

- `market_menu_entries`의 같은 과목, visible, active, not deleted row만 사용한다.
- 설정된 ID 배열 순서를 우선하고, 기본값은 `sort_order → title → id`다.
- 선택 과목의 카테고리를 광고 왼쪽의 테두리 없는 `과목 → 문제마켓 → 하위 카테고리` 세로 메뉴로 표시하고, 공간이 부족한 화면에서는 광고 위에 표시한다.
- 각 메뉴는 `/{subject}/market/{slug}`의 실제 카테고리 게시판으로 이동한다.
- 첫 카테고리는 hero의 카테고리 안내와 CTA의 `/{subject}/market/{slug}` 기본 목적지로도 사용한다.

### 3.6 최근 등록 자료

- 같은 과목의 공개·활성·미삭제 상품만 사용한다.
- 정렬: `published_at desc nulls last → created_at desc → id asc`
- 원본의 112px급 row, 순번, cover/icon, 제목, category/source, 문항 수, 게시일, 화살표를 유지한다.
- 클릭은 실제 상품 상세 route로 이동한다.
- 0건이면 같은 bordered list shell 안에 empty row를 표시한다.

### 3.7 CTA와 footer

- `HomeFinalCta`는 삭제하지 않는다.
- 과목명·공개 자료 수·첫 카테고리 링크만 바꾼다.
- footer의 grid/spacing/brand block은 유지하고, 문제은행 목데이터 안내를 문제마켓 프리뷰 안내와 과목별 market 링크로 바꾼다.

## 4. 관리자 계약

### 4.1 route와 이름

- 신규 route: `/admin/market-main-settings`
- 사이드바: `(임시) 문제마켓 메인 관리`
- 화면 h1: `(임시) 문제마켓 메인 관리`
- 기존 `(임시)메인광고설정`은 변경하지 않는다.

### 4.2 저장 모델

과목별 `workspace_settings`의 `setting_key='market_home'`에 다음 최소 설정만 저장한다.

```ts
interface MarketHomeConfig {
  version: 1
  popular: {
    isActive: boolean
    limit: number
    rankingWindowDays: number
  }
  sourceExplorer: {
    isActive: boolean
    sourceTypes: string[]
  }
  categories: {
    isActive: boolean
    menuEntryIds: string[]
  }
  recent: {
    isActive: boolean
    limit: number
  }
}
```

section 순서 변경, 인기/최근 수동 상품 지정, taxonomy CRUD는 추가하지 않는다.

### 4.3 권한과 검증

- 관리자 page와 POST API 각각 인증 및 `profiles.is_admin`을 검증한다.
- `subject`는 `english | korean`만 허용한다.
- category ID와 source type은 서버에서 해당 과목 allowlist로 재검증한다.
- 중복, 교차 과목 ID, 비공개 category, limit/window 범위 오류는 400이다.
- 저장 성공 후 관리자와 프리뷰 route를 revalidate한다.
- UI는 과목 전환, section Switch, 인기 limit/window, 최근 limit, 출처 checkbox, 카테고리 선택·위/아래 정렬, 실제 데이터 수와 결손 경고만 제공한다.
- 기존 상품·출처·카테고리·광고 관리 화면 링크를 제공하되 CRUD를 복제하지 않는다.

## 5. 보안과 DB 계약

- 인기 집계는 DB 함수에서 수행하고 raw 다운로드 이벤트를 browser에 전달하지 않는다.
- 함수는 subject, 기간, limit을 입력받고 공개 조건을 함수 안에서 다시 검증한다.
- 함수 execute 권한은 `service_role`에만 허용하고 anon/authenticated/public은 revoke한다.
- 조회 인덱스는 `(workspace_subject, created_at desc, item_id, user_id)` 하나만 추가한다.
- 새 테이블이나 RLS 변경은 하지 않는다.
- 원격 DB에 이미 같은 함수 migration이 적용된 상태이므로 Git 원복과 DB 원복을 혼동하지 않는다. 로컬 migration을 최종 코드에 다시 포함해 저장소와 원격 상태를 일치시킨다.
- `source_configs`의 기존 RLS 비활성 상태는 별도 보안 후속 항목으로 보고하며, 이번 홈 구현 범위에서 임의 변경하지 않는다.

## 6. 정확한 변경 경계

### 6.1 프리뷰

- `src/app/preview/solvook-concept/page.tsx`
- `src/app/preview/solvook-concept/layout.tsx`
- `src/app/preview/solvook-concept/_components/preview-header.tsx`
- `src/app/preview/solvook-concept/_components/preview-footer.tsx`
- `src/app/preview/solvook-concept/_components/home/campaign-hero.tsx`
- `src/app/preview/solvook-concept/_components/home/quick-access-grid.tsx`
- `src/app/preview/solvook-concept/_components/home/home-material-sections.tsx`
- slider 상태를 위한 preview-local client component 1개

`material-cover.tsx`, `section-heading.tsx`는 class/DOM 변경 없이 타입 adapter가 꼭 필요할 때만 최소 수정한다.

### 6.2 데이터/목록/광고

- `src/lib/market-home.ts`
- `src/lib/market-home-server.ts`
- `src/lib/main-ad-carousel.ts`
- `src/lib/main-ad-carousel-server.ts`
- `src/lib/market-items-server.ts`
- 관련 과목 market list page와 API의 exact source filter 연결
- `supabase/migrations/20260728010000_add_market_home_download_ranking.sql`
- 필요 시 생성 Supabase 타입의 해당 RPC signature

### 6.3 관리자

- `src/app/(admin)/admin/market-main-settings/**`
- `src/app/api/admin/market-main-settings/**`
- 기존 광고 관리자 과목 분리 관련 파일
- `src/lib/admin-sidebar.ts`

### 6.4 변경 금지

- `src/app/page.tsx`
- `src/app/[workspaceSubject]/market/page.tsx`
- legacy `/market` index
- 상품 상세·구매·다운로드·환불 동작
- 기존 공통 디자인 token과 container 폭

## 7. 구현 Phase와 검증 loop

### Phase 0. 이전 잘못된 UI 변경 원복

계획 확인:

- 현재 diff에서 이전 Solvook 작업 소유 파일만 정확히 식별한다.
- `git reset --hard`, broad restore, unrelated 변경 삭제를 금지한다.
- 원복 직전 `git status --short`, `git diff --name-status`, 이전 orchestration의 `filesModified` 기록을 대조한다. 아래 목록 밖의 경로가 보이면 원복하지 않고 사용자에게 보고한다.

구현:

- 아래 tracked 파일은 이전 Solvook 구현 task가 수정한 것으로 기록되어 있으므로 각 exact path만 `git restore -- <path>`로 Git `HEAD`에 복구한다.

  - `src/app/(admin)/admin/main-ad-settings/main-ad-settings-client.tsx`
  - `src/app/(admin)/admin/main-ad-settings/page.tsx`
  - `src/app/(dashboard)/market/[slug]/market-listboard.tsx`
  - `src/app/(dashboard)/market/[slug]/page.tsx`
  - `src/app/[workspaceSubject]/market/[slug]/page.tsx`
  - `src/app/api/admin/main-ad-settings/route.ts`
  - `src/app/api/market/[slug]/items/route.ts`
  - `src/app/preview/solvook-concept/_components/home/campaign-hero.tsx`
  - `src/app/preview/solvook-concept/_components/home/home-material-sections.tsx`
  - `src/app/preview/solvook-concept/_components/preview-header.tsx`
  - `src/app/preview/solvook-concept/layout.tsx`
  - `src/app/preview/solvook-concept/page.tsx`
  - `src/lib/admin-sidebar.ts`
  - `src/lib/main-ad-carousel-server.ts`
  - `src/lib/main-ad-carousel.ts`
  - `src/lib/market-items-server.ts`
  - `src/types/supabase.ts`
  - `tests/admin-sidebar-navigation.test.mjs`
  - `tests/main-ad-carousel-contract.test.mjs`
  - `tests/main-ad-settings-route-contract.test.mjs`
  - `tests/solvook-preview-flow-contract.test.mjs`

- 아래 untracked 파일은 이전 Solvook 구현 task의 생성 기록과 현재 status가 일치하므로 각 exact path만 제거한다.

  - `src/app/(admin)/admin/market-main-settings/market-main-settings-client.tsx`
  - `src/app/(admin)/admin/market-main-settings/page.tsx`
  - `src/app/api/admin/market-main-settings/route.ts`
  - `src/app/preview/solvook-concept/_components/home/market-category-grid.tsx`
  - `src/app/preview/solvook-concept/_components/home/popular-downloads-slider.tsx`
  - `src/app/preview/solvook-concept/_components/home/source-explorer.tsx`
  - `src/lib/market-home-server.ts`
  - `src/lib/market-home.ts`
  - `supabase/migrations/20260728010000_add_market_home_download_ranking.sql`
  - `supabase/tests/market_home_download_ranking.test.sql`
  - `tests/market-home-admin-route-contract.test.mjs`
  - `tests/market-home-browser.test.mjs`
  - `tests/market-home-contract.test.mjs`
  - `tests/market-home-download-ranking-contract.test.mjs`
  - `tests/market-home-source-filter-contract.test.mjs`
  - `tests/market-home-ui-contract.test.mjs`

- `docs/solvook-market-main-plan.md`는 새 기준 문서이므로 보존한다.
- backend/admin 변경도 먼저 원복한 뒤 Phase 1·2·4에서 검증된 최소 구현을 다시 적용한다. 이전 generic UI를 간접적으로 보존하지 않는다.
- 원격 Supabase에 이미 적용된 ranking 함수는 삭제하지 않는다. Phase 1에서 동일 local migration을 다시 만들어 저장소와 원격 상태를 맞춘다.

검증:

- Git `HEAD`와 프리뷰 layout/header/hero/QuickAccess/Teacher’s Pick/Textbook/recent/CTA/footer 구조가 일치한다.
- 원복 직후 `git status --short`에는 이 계획 문서만 남아야 한다. 목록 밖의 변경이 있었던 경우에는 그 파일을 보존하고 예외를 기록한다.
- root와 운영 market index diff가 없다.
- 브라우저에서 기존 프리뷰 화면이 원본 모양으로 보인다.

실패하면 차이가 나는 파일만 다시 복구하고 재검증한다.

### Phase 1. 홈 데이터와 DB 집계

계획 확인:

- 공개 DTO, config, empty fallback, 인기 proxy 의미, 권한을 다시 확인한다.

구현:

- config/DTO/server query, 인기 RPC/index, 최근/category/source query를 추가한다.
- section 하나가 실패해도 다른 section은 렌더되는 empty fallback을 둔다.

검증:

- config normalize/validate, 과목 격리, 공개 조건, 결정적 정렬, DTO private-field 부재 테스트
- RPC SQL 계약과 권한 테스트
- TypeScript와 대상 ESLint
- 가능한 환경에서 migration/pgTAP; Docker가 없으면 원격 함수 권한과 read-only 실행 결과를 별도 확인

### Phase 2. 광고와 출처 목록 연결

계획 확인:

- 기존 광고 설정 보존과 source exact filter 목적지를 확인한다.

구현:

- 광고 JSON을 과목별로 분리하되 legacy v1은 영어에 보존한다.
- 관리자 저장은 선택 과목 slice만 바꾼다.
- market list/API에 source exact filters를 연결한다.

검증:

- 영어/국어 광고 격리, 반대 과목 보존, invalid subject, 교차 과목 slug, NFC exact filter 계약 테스트
- 기존 광고 관리자 회귀 테스트

### Phase 3. 원본 시각 구조 안에 실제 데이터 주입

계획 확인:

- 1.2의 시각 구조 보존 계약과 1.3의 section 순서를 대조한다.

구현:

- layout shell을 유지한 채 header/footer를 subject-aware로 만든다.
- 원본 CampaignHero DOM에 실제 과목·상품·카테고리 데이터를 넣는다.
- Teacher’s Pick 카드 rail에 인기 slider 상태만 감싼다.
- 최근 list를 인기 slider 바로 다음에 실제 데이터로 연결한다.
- TextbookExplorer shell에 source type/path 동작을 넣는다.
- 본문의 QuickAccessGrid는 렌더하지 않고 CTA를 실제 데이터에 연결한다.
- sample data를 홈 화면에 섞지 않는다.

검증:

- 원본 시각 구조 계약 테스트
- 영어/국어 모두 실제 HTTP 200 및 모든 internal href의 subject 일치
- empty data에서도 원본 shell 유지
- 320px, 390px, 768px에서는 인기 카드가 정확히 2개, 1200px과 1280px에서는 정확히 4개가 한 page에 보이는 코드 assertion과 브라우저 assertion
- 320px, 390px, 768px, 1200px, 1280px screenshot 비교
- keyboard-only, focus-visible, 44px target, reduced motion, slider pause 검증

새 generic hero/card/grid가 발견되면 실패로 보고 해당 section을 HEAD markup 기준으로 재구현한다.

### Phase 4. `(임시) 문제마켓 메인 관리`

계획 확인:

- 저장 모델, 권한, 접두형 이름과 비범위를 확인한다.

구현:

- 관리자 page/client/API, sidebar 항목, 과목별 미리보기·경고를 추가한다.

검증:

- 401/403/400/success
- 과목 교차 ID 거부
- 저장 후 재조회와 preview revalidate
- category 순서, Switch, limit/window, source 선택
- 메뉴와 h1 exact text `(임시) 문제마켓 메인 관리`
- 기존 광고 이름 exact text `(임시)메인광고설정`

### Phase 5. 통합 및 독립 최종 검증

자동 검증:

1. 관련 Node 계약 테스트 전체
2. 변경 TS/TSX/테스트 대상 ESLint
3. `npx tsc --noEmit`
4. `git diff --check`
5. `npm run build`

브라우저 검증:

1. 영어와 국어 전환
2. header 검색, hero, 인기, 출처, category, recent, CTA의 과목 일치
3. 인기 0건, 출처 0건, 광고 0건 상태
4. 상품·카테고리·출처 링크 목적지
5. 320/390/768px에서 인기 카드 2개, 1200/1280px에서 4개와 각 viewport의 overflow·원본 시각 구조
6. slider 수동 이동·pause·reduced motion

독립 리뷰:

- 별도 검증 에이전트가 계획의 모든 acceptance criterion과 Git diff를 확인한다.
- FAIL이면 지적 항목만 수정하고 Phase 5 전체 검증을 다시 실행한다.
- PASS일 때만 구현 완료로 보고한다.

## 8. 최종 acceptance criteria

- [x] `/preview/solvook-concept`의 원본 보라 hero, 2단 header, Teacher’s Pick cover, Textbook gradient cards, QuickAccess tiles, recent list, CTA, footer가 유지된다.
- [x] 영어·국어 전환 시 같은 프리뷰 URL에서 모든 데이터와 링크가 함께 바뀐다.
- [x] 실제 공개 market item/menu/source/download 데이터만 사용하고 sample data를 홈에 섞지 않는다.
- [x] 인기 순위는 최근 30일 distinct 다운로드 URL 발급 사용자 proxy이며 결정적으로 정렬된다.
- [x] 인기 슬라이더는 320/390/768px에서 page당 2개, 1200/1280px에서 page당 4개를 표시하고 접근성·pause·reduced motion 계약을 지킨다.
- [x] 출처 링크와 목록/API exact filter가 연결된다.
- [x] 카테고리와 최근 자료가 실제 과목별 상세 route로 연결된다.
- [x] 0건 상태에서도 원본 section shell이 유지된다.
- [x] 관리자 설정이 과목별로 저장되고 교차 과목 입력을 거부한다.
- [x] 메뉴와 h1은 `(임시) 문제마켓 메인 관리`, 광고 메뉴는 `(임시)메인광고설정`이다.
- [x] root와 운영 market index는 변경되지 않는다.
- [x] 관련 테스트, 대상 ESLint, TypeScript, diff check, production build가 통과한다.
- [x] 독립 최종 리뷰가 PASS다.

## 9. 최종 검증 기록

- 관련 Node 계약 테스트: root 통합 75/75 PASS, 독립 데이터·관리자 검증 95/95 PASS, 독립 UI 검증 50/50 PASS
- 변경 TS/TSX 대상 ESLint: PASS
- `npx tsc --noEmit`: PASS
- `git diff --check`: PASS
- `npm run build`: PASS
- Chrome 실제 화면: 영어·국어 탭 클릭 전환, 실제 과목별 데이터·링크, 320/390/768/1200/1280px horizontal overflow 없음 PASS
- root `/`, 과목별 운영 market index, legacy market index diff 없음
- 전체 `npm run lint`는 이번 변경과 무관한 기존 파일의 77 errors/44 warnings로 실패했으며, 이번 변경 파일 대상 ESLint 오류는 없다.
- 로컬 Docker daemon이 없어 pgTAP은 실행하지 못했다. 원격 함수 signature, service-role 실행, anon 권한 거부는 읽기 전용으로 확인했다.
- 현재 최근 30일 다운로드 이벤트가 0건이므로 인기 카드의 실제 데이터 화면은 empty state로 검증했고, 2/4개 paging은 코드 계약 테스트로 검증했다.

## 10. 후속 작업

프리뷰 최종 검증 후 루트 `/`로 옮기는 작업은 자동으로 진행하지 않는다. 사용자의 별도 확인을 받은 뒤 route/layout 경계와 운영 배포 계획을 다시 세운다.
