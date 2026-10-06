# 관리자 정리 Phase 1a 상세 계획 (P0 결함)

- 작성일: 2026-10-02 · 브랜치 feature/market-cart(HEAD fcadad5) · 상태: **검증 OK(R2) — 구현 단계**
- 상위 문서: `docs/admin-redesign-proposal.md` 5절 P0-1~P0-5, 7절 Phase 1a. 사용자 결정 D9(대시보드 지표 제작), D12(미적용 마이그레이션은 Phase 4), D14(출처 섹션 삭제, d128874에서 완료).
- 범위: P0-1 대시보드 지표, P0-2 회원 목록 서버 페이지네이션·검색, P0-3 "문제마켓 그룹" 관리자 카드 제거, P0-4 과거 화면으로 새는 링크 2곳, P0-5 `/checkout` 현재 크롬. **범위 밖**: 사이드바·과목 전환(1b), 디자인 이관(Phase 2), 공개 게시판 lib의 그룹 분기·미적용 마이그레이션(Phase 4).
- 근거 표기: 소스는 `file:line`(HEAD fcadad5 기준), DB는 개발 DB SELECT(2026-10-02) "직접 확인".

## 0. 공통 원칙과 검증 방법

- AGENTS.md 구현 loop: 단위별로 구현 → 독립 검증 OK → 다음 단위. 작성자는 자기 결과를 승인하지 않는다.
- 하드코딩 금지(CLAUDE.md 2.5): 상태값·경로 규칙만 코드에, 데이터(카테고리 slug 등)는 DB에서 읽는다. 새 테이블·마이그레이션 없음.
- 단순성: 새 공용 부품을 만들지 않는다. 디자인(팔레트·카드 모양)은 Phase 2에서 바꾸므로 이번에는 기존 마크업을 그대로 쓰고 **새 tailwind 팔레트 클래스를 추가하지 않는다**(지운 블록의 클래스는 함께 사라짐).
- 단위 공통 검증
  1. `npx tsc --noEmit` 오류 0
  2. 변경 파일 `npx eslint <files>` 오류 0
  3. 단위의 신규·수정 계약 테스트 통과
  4. 전체 `node --test tests/*.test.mjs`의 **실패 목록이 착수 전 기준선과 동일**(기준선은 U1 착수 전에 기록. 이번 계획으로 의도적으로 지우거나 고친 테스트는 기록에 명시)
  5. scratchpad 복사본에서 `next build` 성공(포트 4000 서버는 띄우지 않음)
  6. 브라우저 확인은 사용자 또는 별도 검증 단계에서 수행(항목별 체크리스트는 각 절)

## 1. 구현 순서

| 단위 | 항목 | 이유 |
|---|---|---|
| U1 | P0-3 그룹 카드 제거 | 삭제만 있는 가장 작은 변경, 다른 단위와 파일 겹침 없음 |
| U2 | P0-4 새는 링크 2곳 | 2파일 한 줄씩, 독립 |
| U3 | P0-5 `/checkout` 크롬 | 결제 흐름 화면이라 따로 검증 |
| U4 | P0-2 회원 목록 | 페이지·클라이언트 재작성, 기존 패턴 재사용 |
| U5 | P0-1 대시보드 | API 응답 형식이 바뀌는 가장 큰 단위 |

U1·U2는 한 검증 회차로 묶어도 된다(서로 다른 파일, 각자 계약 테스트).

## 2. U1 — P0-3 "문제마켓 그룹" 관리자 카드 제거

**현재 근거**
- 메뉴관리 화면이 그룹 관리자 카드를 그린다: `menu-management-client.tsx:101`(import), `:251-252`(props), `:1245-1250`(`<MarketMenuGroupsManager … />`).
- 데이터·액션: `menu-management/actions.ts:58-67`(import `@/lib/market-menu-groups-server`), `:82-86`(타입 필드 `marketMenuEntryGroupAssignments`, `marketMenuGroups`), `:147-153`(조회), `:166-167`(반환), `:394-450`(그룹 액션 5개: create/update/archive/reorder/assign).
- 테이블이 없다: 직접 확인 `to_regclass('public.market_menu_groups')` = null, `market_menu_entries`에 `group_id` 컬럼 없음(컬럼 목록 SELECT). 조회는 빈 배열, 쓰기는 실패한다(R2 F5).
- `src/lib/market-menu-groups-server.ts`를 import하는 곳은 `actions.ts` 1곳뿐(직접 확인 grep). 공개 게시판은 `market-board-server.ts:181-247`이 자체적으로 그룹 분기를 갖고 있어 이 lib를 쓰지 않는다.

**변경 방안**
- 카드와 그에 딸린 데이터·액션을 제거한다. 메뉴관리의 나머지 영역(사이드바 순서, 로고, 헤더 메뉴, 문제생성·문제마켓 2단계 메뉴)은 그대로.
- 이번 변경으로 쓰이지 않게 되는 것만 정리(CLAUDE.md 3절): 매니저 컴포넌트 파일, 관리자 전용 lib, `actions.ts`의 `assertWorkspaceSubject` import(그룹 액션에서만 사용, `:69, 399-445`), `MarketMenuEntryAdminRow & { group_id }` 매핑.
- **건드리지 않음**: 미적용 마이그레이션 `supabase/migrations/20260730010000_create_market_menu_groups.sql`, 공개 lib `market-board-server.ts`의 그룹 분기, `tests/market-board-contract.test.mjs`(Phase 4, D12).

**변경 파일**
- 수정: `src/app/(admin)/admin/menu-management/menu-management-client.tsx`, `src/app/(admin)/admin/menu-management/actions.ts`
- 삭제: `src/app/(admin)/admin/menu-management/market-menu-groups-manager.tsx`, `src/lib/market-menu-groups-server.ts`
- 테스트: `tests/market-menu-group-admin-ui-contract.test.mjs` 삭제(검증 대상 화면이 없어짐), `tests/market-menu-group-contract.test.mjs`에서 server helper·actions를 검사하는 3개 test 삭제(마이그레이션 검사 test는 마이그레이션 보관 기간 동안 유지), 신규 `tests/admin-phase1a-contract.test.mjs`에 U1 test 추가

**위험**: 낮음. 같은 파일의 다른 카드가 쓰는 상태를 실수로 지울 수 있음 → tsc·기존 메뉴관리 계약 테스트로 확인.

**계약 테스트(U1)**
- `menu-management-client.tsx`에 `MarketMenuGroupsManager`, `marketMenuGroups`, `marketMenuEntryGroupAssignments` 없음
- `actions.ts`에 `market-menu-groups-server` import와 그룹 액션 5개 이름 없음
- `market-menu-groups-manager.tsx`, `src/lib/market-menu-groups-server.ts` 파일 없음
- 미적용 마이그레이션 파일은 **남아 있음**(Phase 4 보관 확인)

**브라우저 확인**: `/admin/menu-management?subject=korean`·`english`에서 "문제마켓 카테고리 그룹" 카드가 없고, 바로 아래 "문제마켓 2단계 메뉴 관리" 카드의 목록·저장이 전처럼 동작.

## 3. U2 — P0-4 과거 화면으로 새는 링크 2곳

**현재 근거**
- 결제 성공 화면: `src/app/checkout/success/page.tsx:170` `href={isSuccess ? '/market' : '/mypage/support'}` → `/market`은 미들웨어가 `/{subject}/market`(과거 디자인 "준비 중" 화면)으로 보낸다(R1 §0-2, `src/app/(dashboard)/market/page.tsx:4-18`).
- 홈 광고가 없을 때 버튼: `src/app/preview/solvook-concept/_components/home/main-ad-carousel.tsx:96-98` `marketHref = categories[0] ? /${subject}/market/${slug} : /${subject}/market` → `:588`. 과거 디자인 게시판으로 간다.
- 출처 카드(3번째 누수)는 d128874에서 섹션 삭제로 해결됨.

**변경 방안**
- 성공 화면 "문제마켓 둘러보기" → `/`(현재 디자인 홈). 크레딧 충전은 과목과 무관하고, 홈은 헤더 과목 탭과 `preferred_workspace` 쿠키로 과목을 정한다(R1 §1).
- 광고 빈 상태 "{과목} 문제마켓 보기" → `/search?subject=${subject}`. 검색어 없이 열면 해당 과목 공개 상품 전체가 나온다(`market-search-server.ts:126, 151` 빈 keyword는 전부 통과). 홈 안의 버튼이라 `/`로 보내면 제자리이고, 첫 카테고리 slug에 의존하지 않아 데이터가 비어도 동작한다.
- 이로써 `MainAdCarousel`의 `categories` prop은 쓰는 곳이 없어진다(직접 확인: 파일 안 사용처는 `:27, 88, 96-97`뿐). prop과 두 호출부의 `categories={homeData.categories}` 인자를 지운다(`src/app/(solvook)/_components/solvook-home-view.tsx:46`, `src/app/preview/solvook-concept/page.tsx:37`). 같은 줄 아래 `HomeFinalCta`의 `categories` 인자는 이번 범위가 아니므로 그대로 둔다.

**변경 파일**: `src/app/checkout/success/page.tsx`, `src/app/preview/solvook-concept/_components/home/main-ad-carousel.tsx`, `src/app/(solvook)/_components/solvook-home-view.tsx`, `src/app/preview/solvook-concept/page.tsx`, `tests/admin-phase1a-contract.test.mjs`

**기존 테스트 영향**: `tests/market-home-ui-contract.test.mjs`의 "preview renders database category board navigation beside the ad carousel" test가 carousel의 `categories: MarketHomeMenuEntry[]`(:42)와 이미 없는 `ProblemMarketMenu`(:43)를 검사한다. 이 test는 착수 전 기준선에서 이미 실패하는지 확인하고, 실패라면 기준선 그대로(실패 사유만 바뀜) 기록한다. 통과 중이라면 :42 줄을 새 구현에 맞게 갱신한다.

**위험**: 낮음. 광고가 있는 정상 상태에는 영향 없음.

**계약 테스트(U2)**
- `checkout/success/page.tsx`에 `'/market'` 없음, 성공 링크가 `'/'`
- `main-ad-carousel.tsx`에 `/${subject}/market` 형태 없음, `/search?subject=${subject}` 있음
- 두 파일 모두 `/(english|korean)/market` 리터럴 없음

**브라우저 확인**: 토스 결제 성공 화면에서 "문제마켓 둘러보기" → 현재 홈. 광고를 모두 비활성화한 과목(개발 DB에서 확인 가능한 과목 또는 관리자 화면에서 임시 비활성화 후 복구)에서 빈 상태 버튼 → `/search?subject=…` 목록.

## 4. U3 — P0-5 `/checkout`에 현재 디자인 크롬

**현재 근거**
- 전역 `template.tsx:14-19`가 모든 경로에 `PathAwareSiteChrome`(과거 `Header`/`Footer`)을 씌우고, 예외 목록 `path-aware-site-chrome.tsx:29`에 `/checkout`이 없다.
- `src/app/checkout/`에는 layout이 없다(파일 목록: `page.tsx`, `checkout-client.tsx`, `success/page.tsx`, `fail/page.tsx`, `kakaopay/result/{page,result-client}.tsx`).
- `/pricing`은 `src/app/pricing/layout.tsx:1` `export { default } from '@/app/(solvook)/layout'` + 예외 목록 등록으로 현재 크롬(`PreviewHeader` + `SolvookFooter` + `StudioThemeShell`)을 쓴다.
- 결제 본문은 이미 Studio 프레임: `checkout-client.tsx:561`, `success/page.tsx:22`, `fail/page.tsx:31`, `kakaopay/result/page.tsx:6` 모두 `studio-theme min-h-screen bg-[var(--studio-background)]`. 계약 테스트가 이를 강제한다(`tests/checkout-payment-methods-contract.test.mjs:42-48`, `tests/kakaopay-checkout-contract.test.mjs:93-98`).

**변경 방안**
- `src/app/checkout/layout.tsx` 신설: `/pricing`과 같은 한 줄 재export. 하위 `success`, `fail`, `kakaopay/result`에 자동 적용.
- `path-aware-site-chrome.tsx:29` 예외에 `pathname === '/checkout' || pathname.startsWith('/checkout/')` 추가(기존 계약 테스트의 "식별자 인자 startsWith 금지" 규칙 `solvook-preview-flow-contract.test.mjs:343-346`에 맞게 문자열 리터럴 사용).
- **헤더 잔액 갱신(포함 결정)**: 새 헤더는 마운트 시 `/api/credits/balance`를 한 번 호출하고 이후에는 `credit-balance-updated` 이벤트로만 갱신한다(`preview-header.tsx:60-79`). 그런데 결제 결과 화면은 이 이벤트를 보내지 않는다(직접 확인: `src/app/checkout/**`에 `dispatchEvent` 0건). 헤더의 첫 조회가 승인 처리(`success/page.tsx:52` `/api/payments/confirm`)나 카카오페이 상태 폴링(`kakaopay/result/result-client.tsx:35`)보다 먼저 끝나면 **충전 전 잔액이 남는다**. 그래서 두 화면에서 결제 완료가 확인된 직후 `/api/credits/balance`를 한 번 호출해 그 `balance`로 `window.dispatchEvent(new CustomEvent('credit-balance-updated', { detail: { balance } }))`를 보낸다.
  - 승인 응답의 `newBalance`(`api/payments/confirm/route.ts:42, 130`)를 쓰지 않는 이유: 이미 완료된 주문은 `profiles.credits` 캐시를 돌려주고(`:130`), 카카오페이 상태 응답에는 잔액이 없다(`api/payments/kakaopay/status/route.ts`, `result-client.tsx:11-17`). 헤더가 쓰는 같은 API(`/api/credits/balance`, 사용 가능 잔액)로 맞추면 두 화면이 같은 값을 보낸다.
  - 기존 선례: `market-item-actions.tsx:462, 804`가 구매 후 같은 이벤트를 보낸다.
- 본문 프레임은 바꾸지 않는다. `min-h-screen`은 지금도 과거 헤더 아래에서 같은 높이로 그려지고 있어 동작 차이가 없다. `kakaopay/result/page.tsx`의 `<main>`은 지금도 `PathAwareSiteChrome`의 `<main>` 안에 중첩돼 있으며 새 layout(`(solvook)/layout.tsx`의 `<main>`)에서도 같은 상태다 → 이번 범위에서 바꾸지 않고 9절 후속으로 기록.

**영향 분석**
| 화면 | 바뀌는 것 | 확인할 것 |
|---|---|---|
| `/checkout?planId=` | 헤더가 현재 디자인(검색·과목 탭·크레딧·장바구니), 푸터가 `SolvookFooter` | 토스 결제위젯·카카오페이 버튼 동작, 결제창(팝업/오버레이)이 헤더 위에 뜨는지 |
| `/checkout/success` | 같음 + 승인 성공 시 헤더 잔액 갱신 이벤트(아래) | 승인 후 헤더 크레딧이 충전 후 잔액인지 |
| `/checkout/fail` | 같음 | 링크 2개 정상 |
| `/checkout/kakaopay/result` | 같음 + 완료 시 헤더 잔액 갱신 이벤트(아래) | 상태 폴링 후 결과 표시, 헤더 크레딧이 충전 후 잔액인지 |
| 서버 비용 | layout이 요청마다 `getRequestAuthUserId`, `getSolvookFooterData`(60초 캐시), `getMarketCartBadgeCount`를 호출(`(solvook)/layout.tsx:16-21`) | `/pricing`과 같은 수준이라 허용 |

**변경 파일**: `src/app/checkout/layout.tsx`(신규), `src/components/layout/path-aware-site-chrome.tsx`, `src/app/checkout/success/page.tsx`(U2와 같은 파일, 다른 위치), `src/app/checkout/kakaopay/result/result-client.tsx`, `tests/admin-phase1a-contract.test.mjs`

**위험**: 중간(결제 흐름). 결제 승인·폴링 로직은 바꾸지 않고, 성공 확인 뒤에 잔액 조회·이벤트 발송만 덧붙인다(조회가 실패해도 결과 화면 표시는 그대로, 헤더만 기존 값 유지). 위험은 외형·헤더 상호작용에 한정. 문제가 생기면 두 파일 되돌리기로 즉시 복구.

**계약 테스트(U3)**
- `src/app/checkout/layout.tsx`가 `@/app/(solvook)/layout`을 default 재export
- `path-aware-site-chrome.tsx`에 `pathname === '/checkout'`과 `pathname.startsWith('/checkout/')` 존재
- `success/page.tsx`와 `kakaopay/result/result-client.tsx`에 각각 `fetch('/api/credits/balance')`와 `new CustomEvent('credit-balance-updated'`가 있고, 이벤트 발송이 성공 분기(승인 성공 / `status === 'completed'`) 안에 있음
- 기존 `auth-chrome-contract`, `solvook-preview-flow-contract`, `checkout-payment-methods-contract`, `kakaopay-checkout-contract` 통과(기준선 대비)

**브라우저 확인(사용자, 테스트 결제 환경)**: 위 영향 분석 표 4행 전부, 320px·데스크톱 폭에서 가로 넘침 없음, 헤더 로그인 상태 표시.

## 5. U4 — P0-2 회원 목록 서버 페이지네이션·검색

**현재 근거**
- `users/page.tsx:8-14`: 최신 20명만 조회, `.limit(20)` 2회 중복.
- `users-client.tsx:62-70`: 검색이 로드된 20명 안에서만 클라이언트 필터. `:263-279`: 페이지네이션 placeholder(버튼 `disabled`, "1 / 1").
- **추가 발견(같은 쿼리 블록)**: `users/page.tsx:21-24`가 `user_credits` 테이블에서 잔액을 읽는데, 이 테이블은 없다(직접 확인: relation does not exist). 그래서 모든 회원 잔액이 0으로 표시된다. 실제로는 13명 중 5명이 잔액 보유(직접 확인: `get_credit_balance_snapshot`의 `spendable_balance` 15900·10200·10000·7100·5600). 같은 값이 `profiles.credits`에도 있지만 이는 **현재 `credit_sources`에 만료일이 있는 행이 0건**이라 우연히 같은 것이다(직접 확인). 사용자 화면 잔액은 `selectDisplayBalance`(`credit-balance.ts:22-24`) = `spendable_balance` = `credit_sources`에서 `status = 'active'`이고 만료 전(`expires_at is null or > now`)인 `remaining_credits` 합이다(직접 확인: DB 함수 `get_credit_balance_snapshot` 정의). `profiles.credits`는 캐시이고 `pending_refund`·만료분을 구분하지 않는다.

**재사용할 기존 패턴**
- 서버 페이지네이션: `src/lib/market-categories-server.ts:203-212` — count(head) 조회 → `getListPagination(count, page, pageSize)` → `.range(offset, offset + pageSize - 1)`.
- 검색 이스케이프: 같은 파일 `:195-200` — `\ % _` 이스케이프 후 `JSON.stringify`로 감싸 `.or()`에 넣기(쉼표·괄호가 들어간 검색어도 안전).
- 클라이언트: `src/app/(solvook)/categories/[id]/_components/category-items-view.tsx:90-99, 269-274` — `router.push(hrefFor(changes))` + `StudioListPagination`에 `getPageHref`(링크형). `useListQuery`는 `pushState`만 하고 서버를 다시 부르지 않으므로(`src/hooks/use-list-query.ts`) 서버 페이지네이션에는 쓰지 않는다.
- `LIST_PAGE_SIZES = [20, 50]`, 기본 20(`src/lib/list-pagination.ts:1-2`).

**변경 방안**
- `page.tsx`: `searchParams`에서 `q`, `page`, `pageSize`를 읽는다. 검색어가 있으면 `email, name, phone, organization` 4개 컬럼 `ilike`를 `.or()`로(현재 클라이언트 검색과 같은 컬럼). 정렬은 `created_at desc, id`. count → pagination → range 순서. 범위를 넘는 `page`는 `getListPagination`이 마지막 페이지로 보정한다.
- 잔액은 없는 `user_credits` 대신 **사용자 화면과 같은 사용 가능 잔액**을 쓴다. 현재 페이지 회원 id로 `credit_sources`를 1회 조회(`.in('user_id', ids)`, `.eq('status', 'active')`, `.gt('remaining_credits', 0)`, `.or('expires_at.is.null,expires_at.gt.<now ISO>')`, `user_id, remaining_credits`만)하고 회원별로 합산한다. 조건은 기존 `CreditService.getActiveSources`(`src/lib/credits.ts:116-131`)와 같다. 이 함수는 한 사용자용이고 `createClient()`를 내부에서 만들어 재사용하면 회원 수만큼 쿼리가 생기므로, 같은 조건을 여러 id에 거는 한 번의 쿼리로 쓴다. `get_credit_balance_snapshot`을 행마다 부르면 페이지당 최대 50회 RPC라 쓰지 않는다.
- 권한: `credit_sources`는 authenticated SELECT grant와 관리자 RLS(`Admins can manage all credit sources`, ALL)가 있어 세션 클라이언트로 읽는다(직접 확인).
- `now`는 앱 서버 시간이라 DB 함수(`now()`)와 수 초 차이가 날 수 있다. 만료 직전 몇 초의 차이는 목록 표시에 영향이 작아 허용.
- `users-client.tsx`: 클라이언트 필터 제거, 검색은 폼 제출(Enter/검색 버튼)로 `q`를 URL에 넣고 1페이지로 이동. 하단 placeholder를 `StudioListPagination`(링크형 `getPageHref`, 표시 개수 변경은 `router.push`)으로 교체. 크레딧 지급 후 현재 페이지 행 갱신은 지금 방식(로컬 상태 교체) 유지, 서버에서 새 `initialUsers`가 오면 상태를 다시 맞춘다(`key`를 쿼리 문자열로 두어 재마운트).
- "총 N명" 배지는 서버 count(검색 결과 수)를 그대로 표시.

**데이터·쿼리**: `profiles` 13행, `credit_sources` 상태 `active`·`refunded`, 만료일 있는 행 0건(직접 확인). 쿼리 3회(profiles count head + range, credit_sources 1회). 모두 세션 클라이언트(관리자 RLS).

**변경 파일**: `src/app/(admin)/admin/users/page.tsx`, `src/app/(admin)/admin/users/users-client.tsx`, `tests/admin-phase1a-contract.test.mjs`

**위험**
| 위험 | 대응 |
|---|---|
| 잔액 조건이 DB 함수와 어긋남 | 조건을 `get_credit_balance_snapshot`의 `spendable_balance` 정의와 같게 두고, 검증자가 같은 페이지 회원의 RPC 값과 대조 |
| `useSearchParams` 사용으로 Suspense 경계 경고 | 기존 카테고리 화면과 같은 구조인지 확인, `next build`로 검증 |
| 검색어 특수문자 | 기존 이스케이프 패턴 재사용 + 테스트 |

**계약 테스트(U4)**
- `page.tsx`에 `.limit(20)`·`user_credits`·`profiles.credits`를 잔액으로 쓰는 코드 없음, `from('credit_sources')`와 `.in('user_id'`·`.eq('status', 'active')`·`expires_at.is.null` 조건 있음, `getListPagination`·`.range(` 사용, `searchParams` 사용, 검색어 이스케이프(`replace(/[\\%_]/g` 형태)와 `JSON.stringify`
- `users-client.tsx`에 `Pagination (placeholder)`·`disabled>` placeholder 버튼·`users.filter(` 없음, `StudioListPagination`과 `getPageHref` 사용

**브라우저 확인**: 20명 초과 상황은 개발 DB에 13명뿐이라 표시 개수 20/50 전환과 1페이지 표시까지 확인하고, 다중 페이지는 표시 개수를 바꿔도 13명이 한 페이지에 나오는지 + URL에 `?page=2`를 직접 넣었을 때 1페이지로 보정되는지로 대신 확인. 이메일 일부·이름·전화번호로 검색, 검색어에 `,`·`(` 포함 시 오류 없음, 잔액이 0이 아닌 회원 5명이 `get_credit_balance_snapshot`의 `spendable_balance`와 같은 값으로 표시, 크레딧 지급 후 잔액 갱신.

## 6. U5 — P0-1 대시보드 지표 재설계 (D9)

**현재 근거**
- API `src/app/api/admin/stats/route.ts`: 가입 수(`:44-54`)는 유효. 나머지는 레거시 `questions` 기반(`:56-93`, 최근 문제·학년 통계·AI 생성 수), 없는 `admin_logs` 조회(`:110-145`, 직접 확인: 테이블 없음 → 항상 0), 매출은 `payment_history`를 `amount.sum()`으로 집계(`:171-192`)하나 집계 함수 비활성으로 항상 0(직접 확인: `authenticator` 역할 설정에 `pgrst.db_aggregates_enabled` 없음).
- 날짜 경계가 서버 로컬 시간(`:26-32` `setHours(0,0,0,0)`)이라 배포 서버가 UTC면 "오늘"이 한국 시간 오전 9시에 바뀐다.
- 화면 `src/app/(admin)/admin/dashboard-client.tsx`: 카드 5개(`:102-143`) 중 "문제 판매/다운로드"·"에러/실패 로그"는 `admin_logs` 기반, "AI 문제 생성"은 레거시. "최근 업로드된 문제"(`:185-246`)·"학년 TOP 5"(`:248-298`)는 레거시, "시스템 상태"(`:301-331`)는 "정상 작동 중" 고정 문구.
- API 소비처는 `dashboard-client.tsx:67` 하나뿐(직접 확인 grep).

**지표 정의(D9 제안 목록 확정판)** — 기간은 한국 시간 기준 오늘(00:00 KST~)과 이번 달(1일 00:00 KST~). 대시보드는 공통 화면이라 두 과목 합계를 보여 주고, 과목 컬럼이 있는 지표만 과목별 분해를 보조 문구로 표시.

| 카드 | 정의 | 테이블·조건 | 현재 값(직접 확인) |
|---|---|---|---|
| 신규 가입 | 오늘/이번 달 가입 수 | `profiles.created_at` | 13명 누적 |
| 충전 결제 | 오늘/이번 달 결제 금액 합계와 건수 | `payment_history` `status = 'completed'`, `created_at` 기준(환불되면 `refunded`로 바뀌어 제외) | completed 28건 96,500원(2026-02-06~08-17), refunded 3건 |
| 자료 구매 | 오늘/이번 달 구매 건수와 사용 크레딧 합계, 과목별 건수 | `market_purchase_orders` `status = 'completed'` | completed 9건 28,000C(국어), refunded 1건 |
| 다운로드 | 오늘/이번 달 다운로드 수, 과목별 | `market_download_events` | 6건(국어) |
| 처리 대기 | 충전 환불 심사 대기·확인 필요, 자료 환불 대기, 미답변 문의 — 각각 해당 관리 화면 링크 | `refund_requests` `pending_review` / `retryable_failed, manual_review`(환불 화면 기준 `refunds/page.tsx:49-54`), `market_refund_requests` `pending`(`market-refunds.ts:8`), `support_tickets` `status = 'pending' and is_deleted_by_user = false`(문의 화면 기준 `support-client.tsx:156`) | 모두 0건 |

- **service role로 읽는 것**: `payment_history`, `refund_requests`. 두 테이블은 authenticated grant가 없어 세션 클라이언트로 읽으면 permission denied다(직접 확인: `information_schema.role_table_grants`에 authenticated 행 없음). 그래서 지금 매출 조회처럼 `createPaymentAdminClient()`(service role, `payment-orders-server.ts:66`)를 쓰고, 환불 화면도 같은 방식이다(`refunds/page.tsx:31-33`).
- **세션 클라이언트로 읽는 것**: `profiles`, `market_purchase_orders`, `market_download_events`, `market_refund_requests`, `support_tickets`. 모두 authenticated grant와 관리자 SELECT 정책(`is_admin()` 등)이 있다(직접 확인).
- `payment_orders`(7건 모두 expired)는 주문 시도 기록이라 매출에 쓰지 않는다. 완료된 결제는 `payment_history`에 남는다(`payment_orders.payment_history_id` 연결).

**쿼리 비용 설계**
- 합계는 DB 집계 대신 **이번 달 행만 읽어 서버에서 합산**: `payment_history`(`amount, created_at`), `market_purchase_orders`(`charged_credits, workspace_subject, created_at`)를 `status`·`created_at >= 이번 달 시작` 조건으로 1회씩 조회하고, 오늘 값은 같은 행에서 다시 거른다. 누적(전체 기간) 매출은 만들지 않는다(행 수가 계속 늘어나는 조회를 피함).
- 건수만 필요한 것은 `count: 'exact', head: true`: 가입 2회, 다운로드는 과목별 분해가 필요하므로 이번 달 `workspace_subject, created_at`만 읽어 합산(현재 6행), 처리 대기 4회.
- 총 쿼리 약 9회, 모두 `Promise.all` 병렬. 인덱스: `payment_history(status)`, `refund_requests(status)`, `market_refund_requests(workspace_subject, status, created_at)` 존재. `market_download_events`·`market_purchase_orders`는 과목 없이 `created_at` 범위만 거는 인덱스가 없어 행이 수만 건 이상으로 늘면 느려질 수 있음 → 그때 인덱스 추가 마이그레이션을 별도 계획으로(지금은 수 행이라 불필요).

**변경 방안**
- `src/lib/admin-dashboard-stats.ts` 신설(`@/` import 없는 순수 함수만, `tests`에서 Node로 직접 import 가능 — 선례 `tests/payment-history-filter.test.mjs`가 `src/lib/payment-history.ts`를 직접 import):
  - `getKstPeriodStarts(now: Date)` → `{ todayStart, monthStart }` ISO 문자열. 한국은 서머타임이 없어 UTC+9 고정 계산.
  - `summarizeAmountRows(rows, amountKey, todayStart)` → `{ todayCount, todayAmount, monthCount, monthAmount }`
  - `countBySubject(rows, todayStart)` → 오늘/이번 달 합계와 과목별 건수
  - 상태값 목록 상수(`처리 대기` 조건)는 위 표의 기존 화면 기준을 그대로 옮긴 코드 규칙
- `api/admin/stats/route.ts`: 위 쿼리로 교체. 응답 형식 `{ period: { todayStart, monthStart }, signups, chargePayments, marketPurchases, downloads, pending }`. `questions`·`admin_logs` 조회와 `amount.sum()` 제거. 인증 확인(`:7-23`)은 그대로. 한 쿼리가 실패하면 0으로 숨기지 않고 500을 돌려 화면이 오류 상태를 보이게 한다(지금처럼 실패를 0으로 감추는 `try/catch` 제거).
- `dashboard-client.tsx`: `Stats` 타입을 새 응답에 맞춤. 카드 4개(신규 가입·충전 결제·자료 구매·다운로드) + "처리 대기" 카드(항목별 숫자와 `/admin/refunds`, `/admin/support` 링크). 레거시 카드·최근 문제·학년 TOP 5·시스템 상태 블록 삭제. 기존 `Card` 마크업·로딩·오류·새로고침 버튼은 유지(디자인은 Phase 2). 금액은 `₩` + `toLocaleString('ko-KR')`, 크레딧은 `C`. 상단에 "기준: 한국 시간" 문구.
- `page.tsx` 스켈레톤은 그대로.

**변경 파일**: `src/lib/admin-dashboard-stats.ts`(신규), `src/app/api/admin/stats/route.ts`, `src/app/(admin)/admin/dashboard-client.tsx`, `tests/admin-dashboard-stats.test.mjs`(신규, 순수 함수 단위 테스트), `tests/admin-phase1a-contract.test.mjs`

**위험**
| 위험 | 대응 |
|---|---|
| 과거 `payment_history` 행의 `created_at`이 결제 승인 시각과 다를 수 있음 | 새 결제 흐름은 이행 시 행을 만든다(추정). 승인 시각 `approved_at`은 과거 행에 비어 있을 수 있어 `created_at`으로 통일하고 화면에 "결제 기록 기준" 표기 |
| KST 계산 오류(월말·자정 경계) | 순수 함수 단위 테스트: UTC 14:59/15:00(=KST 23:59/00:00), 월 첫날·말일, 1월 1일 |
| 한 쿼리 실패로 대시보드 전체 오류 | 운영 지표를 0으로 속이는 것보다 낫다. 오류 화면에 "다시 시도" 버튼 유지 |
| service role 사용 범위 확대 | grant가 없는 2개 테이블(`payment_history`, `refund_requests`)에만 사용(둘 다 기존 관리자 코드가 이미 service role로 읽음). 나머지 5개 테이블은 세션 클라이언트 |

**계약 테스트(U5)**
- `route.ts`에 `admin_logs`, `.sum()`, `from('questions')` 없음. `payment_history`와 `refund_requests` 조회는 `createPaymentAdminClient()`로 만든 클라이언트에서, 나머지 5개 테이블 조회는 세션 클라이언트(`createClient`)에서 수행. `payment_history` 조건 `status`가 `'completed'`. `market_purchase_orders`, `market_download_events`, `refund_requests`, `market_refund_requests`, `support_tickets` 조회 존재. `getKstPeriodStarts` 사용, `setHours(0, 0, 0, 0)` 없음
- `dashboard-client.tsx`에 `정상 작동 중`, `AI 문제 생성`, `최근 업로드된 문제`, `학년 TOP 5`, `에러/실패 로그`, `/admin/questions` 없음. `/admin/refunds`, `/admin/support` 링크 있음
- `tests/admin-dashboard-stats.test.mjs`: KST 경계 5사례, 금액 합산(오늘/이번 달 분리), 과목별 건수

**브라우저 확인**: 카드 숫자가 같은 시점의 SELECT 결과와 일치(검증자가 개발 DB에서 같은 조건으로 SELECT해 대조), 처리 대기 링크 이동, 새로고침 버튼, API를 강제로 실패시킬 수 없으면 오류 화면은 코드 확인으로 대신.

## 7. 변경 파일 요약

| 단위 | 수정 | 신규 | 삭제 |
|---|---|---|---|
| U1 | `menu-management-client.tsx`, `menu-management/actions.ts`, `tests/market-menu-group-contract.test.mjs` | — | `market-menu-groups-manager.tsx`, `src/lib/market-menu-groups-server.ts`, `tests/market-menu-group-admin-ui-contract.test.mjs` |
| U2 | `checkout/success/page.tsx`, `main-ad-carousel.tsx`, `(solvook)/_components/solvook-home-view.tsx`, `preview/solvook-concept/page.tsx` | — | — |
| U3 | `path-aware-site-chrome.tsx`, `checkout/success/page.tsx`, `checkout/kakaopay/result/result-client.tsx` | `src/app/checkout/layout.tsx` | — |
| U4 | `users/page.tsx`, `users/users-client.tsx` | — | — |
| U5 | `api/admin/stats/route.ts`, `dashboard-client.tsx` | `src/lib/admin-dashboard-stats.ts`, `tests/admin-dashboard-stats.test.mjs` | — |
| 공통 | — | `tests/admin-phase1a-contract.test.mjs`(단위별 test 추가) | — |

DB 변경·마이그레이션·환경변수 변경 없음.

## 8. 위험 요약

| 위험 | 단위 | 대응 |
|---|---|---|
| 결제 화면 헤더 교체로 결제창·위젯 상호작용 이상 | U3 | 본문 무변경, 테스트 결제 환경 브라우저 확인, 2파일 되돌리기로 복구 |
| 대시보드 응답 형식 변경 | U5 | 소비처 1곳(직접 확인), 같은 단위에서 함께 변경 |
| 기존 계약 테스트가 지운 코드에 묶여 있음 | U1, U2 | 삭제·수정한 테스트를 검증 기록에 명시, 기준선 대비 실패 목록 비교 |
| 회원 잔액 계산이 사용자 화면과 다름 | U4 | `spendable_balance`와 같은 조건으로 `credit_sources` 합산, RPC 값과 대조 |

## 9. 후속(이번 범위 밖, 기록만)

- `kakaopay/result/page.tsx`의 중첩 `<main>`(현재도 중첩) → Phase 2 셸 정리 때.
- `payment_orders`의 `manual_review` 상태(결제 확인 필요)를 처리 대기에 넣을지 → 운영 필요 시.
- 다운로드·구매 테이블의 `created_at` 단독 인덱스 → 행 수가 늘면.
- 회원 상세 화면에서 정확한 사용 가능 잔액(`get_credit_balance_snapshot`) 표시 → Phase 1b 이후.

## 10. 검증 기록

| 회차 | 대상 | 검증자 | 판정 | 비고 |
|---|---|---|---|---|
| R1 | 초안 | 독립 검증 | **FAIL** → 보완 | 표본 사실 모두 일치. 지적: 1(높음) U5 `refund_requests`는 authenticated grant가 없어 세션으로 못 읽음 → `payment_history`와 함께 service role로, 세션 5개 테이블 명시, 위험표·계약 테스트 수정 2(중간) U3 결제 결과 화면이 `credit-balance-updated`를 보내지 않아 헤더가 충전 전 잔액을 보일 수 있음 → 완료 확인 후 `/api/credits/balance` 조회·이벤트 발송(2파일) 포함, 계약 테스트 추가 3(중간) U4 `profiles.credits`는 사용 가능 잔액과 다름(지금 일치는 만료일 행 0건 때문) → `credit_sources` 1회 조회로 `spendable_balance`와 같은 조건 합산, 근거 문장 정정 |
| R2 | R1 보완본 | 독립 검증 | **OK** | U5 서비스 롤 2개·세션 5개 구분, U3 이벤트 payload `{detail:{balance}}`가 헤더 리스너와 일치, U4 조건이 get_credit_balance_snapshot spendable과 동일(pending_refund 제외) |
| 구현 리뷰·배포 | U1+U2 | 독립 리뷰(imglib-s3-reviewer) OK + MINOR(revalidate 검사 이전) 반영 | **커밋** | 사용자: "커밋해서 같이 배포"(브라우저 확인 전 배포 결정). 메뉴관리 화면은 배포 후 확인 |
