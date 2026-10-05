# 헤더 카테고리 메가메뉴 상품 수 표시 계획

- 작성일: 2026-10-06 · 브랜치 feature/market-cart · 상태: 검증 OK(R1) — 구현 단계
- 요청: 헤더 '카테고리'에 마우스를 올렸을 때 나오는 메뉴에서, 각 카테고리 항목 옆에 해당 상품 수를 `(48)`처럼 표시한다.

## 1. 요청 분석

**사실(코드 확인)**
- 메가메뉴: `src/components/layout/category-mega-menu.tsx`. 마운트 시 `/api/market/category-menu`를 1회 조회해 과목별 그룹·항목(`{ id, title }`)을 그린다. 항목은 `/categories/{id}?subject=` 링크다.
- API: `src/app/api/market/category-menu/route.ts`가 `listMarketCategoryMenu()`(상품 수 없이)를 호출하고 `Cache-Control: public, max-age=60`으로 응답한다.
- 상품 수 계산은 이미 있다: `listMarketCategoryMenu(true)`(`src/lib/market-categories-server.ts:37-102`)가 항목별 `itemCount`와 그룹 `itemCount`를 채운다. 기준은 공개 게시판 메뉴(`market_menu_entries` 노출·활성·미삭제)에 속한 공개(`published`)·활성·미삭제 상품이다. 카테고리 페이지(`(solvook)/categories/[id]/page.tsx:42`)와 preview 상세(`boards/[slug]/items/[itemId]/page.tsx:74`)가 이미 이 값을 쓴다.
- 같은 수를 보여 주는 기존 화면: `src/components/market/MarketCategorySidebar.tsx:74` — `{item.title} <span className="whitespace-nowrap text-[var(--studio-muted)]">({count.toLocaleString()})</span>`.

**결정**
- D1 계산 재사용: API를 `listMarketCategoryMenu(true)`로 바꾼다. 새 계산·쿼리를 만들지 않아 왼쪽 목록과 숫자가 항상 같다.
- D2 표시: 항목 이름 뒤에 `(N)`. 왼쪽 목록과 같은 형식(`toLocaleString()`, 회색 `--studio-muted`, 줄바꿈 방지). 0개 항목도 `(0)`으로 보인다(왼쪽 목록과 동일). 현재 국어 활성 항목 32개 중 30개가 `(0)`이라 대부분 0으로 보인다 — 사용자 확인 사항.
- D3 범위: 요청대로 **항목만** 표시한다. 그룹 제목 옆 합계는 넣지 않는다(필요하면 후속).
- D4 타입: 메가메뉴의 로컬 `CategoryMenuItem`에 `itemCount?: number`를 더하고, 사이드바와 같이 `(item.itemCount ?? 0)`으로 표시한다(옛 응답은 최대 60초만 남음).

## 2. 변경 대상
- `src/app/api/market/category-menu/route.ts`: `listMarketCategoryMenu(true)`.
- `src/components/layout/category-mega-menu.tsx`: 타입 필드 추가, 항목 링크 안에 `(N)` 표시.
- 새 계약 테스트 파일 `tests/category-mega-menu-count-contract.test.mjs`(기존 메가메뉴 테스트 없음): API가 `listMarketCategoryMenu(true)`를 호출, 메가메뉴가 `(item.itemCount ?? 0).toLocaleString()`으로 `(N)` 표시.

## 3. 검증
- `npx tsc --noEmit`, 변경 파일 eslint, 관련 테스트, 전체 `node --test tests/*.test.mjs` 실패 이름이 기준선과 같음, 복사본 `next build`.
- DB: 항목별 수가 왼쪽 목록 계산과 같은지 SELECT로 대조(예: 국어 '수능특강 문학 변형문제' 80, '수능특강 독서 변형문제' 64).
- 브라우저(연동된 Chrome): 헤더 '카테고리'에 마우스를 올려 국어·영어 각 항목 옆 `(N)` 확인, 카테고리 페이지 왼쪽 목록 숫자와 일치, 좁은 화면에서 줄바꿈 깨짐 없음.

## 4. 위험
| 위험 | 대응 |
|---|---|
| 상품 수 계산이 항목마다 count 쿼리 1개(지금 메뉴 2 + count 32 = 34개)라 API가 느려질 수 있음 | `max-age=60`은 **브라우저 캐시**뿐이라 방문자의 페이지 로드마다(메가메뉴를 열지 않아도 마운트 시 조회) 이 쿼리가 돈다. 지금 규모에서는 허용 가능하고 카테고리 페이지도 매 요청 같은 계산을 한다. `s-maxage` 추가나 단일 쿼리 집계는 후속 |
| 숫자가 늦게 바뀜(최대 60초) | 기존 캐시 정책 유지. 상품 공개·숨김 직후 1분 이내 차이는 허용 |

## 5. 검증 기록
| 회차 | 대상 | 검증자 | 판정 | 비고 |
|---|---|---|---|---|
| R1 | 초안 | 독립 검증 | **OK** | 사실·SELECT(문학 80·독서 64, 국어 활성 32개 중 30개 0) 일치. 보완 a 캐시 표현 정정 b 새 테스트 파일 확정 c (0) 다수 사용자 확인 d `?? 0`으로 단순화 — 반영 |
| 구현 리뷰 | route.ts·category-mega-menu.tsx·계약 테스트 | 독립 리뷰(imglib-s3-reviewer) | **OK**(MINOR 1·NIT 1 반영) | 상품 수 계산 실패 시 수 없이 메뉴 재조회(폴백), `itemCount !== undefined`일 때만 (N) 표시, `s-maxage=60` 추가. 숫자 색 NIT은 미반영. 브라우저: 국어 문학 (80)·독서 (64)·나머지 (0) 확인 |
