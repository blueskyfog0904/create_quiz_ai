# 관리자 문제마켓 상품 목록 페이지네이션 계획

- 작성일: 2026-10-02 · 브랜치 feature/market-cart(HEAD 84d2baa 이후) · 상태: 검증 OK(R2), 구현 단계
- 요청: `/admin/market/products`의 상품 목록에 페이지네이션을 넣는다. 페이지를 바꿀 때 화면 전체가 이동(새로 불러오기)하지 않고 상품 목록 영역 안의 내용만 바뀌게 한다.

## 1. 요청 분석

**사실(코드 확인)**
- `page.tsx`가 서버에서 `listMarketItemsForAdmin(undefined, workspaceSubject)`로 해당 과목 상품을 **전부** 읽어 `initialItems`로 넘긴다. 이후 `refreshItems`도 `/api/admin/market/items`(전체 또는 `menuEntryId`별)를 받아 `items`를 통째로 바꾼다.
- 목록은 `filteredItems`(선택한 메뉴 `selectedMenuEntryId`로 거른 결과)를 그대로 `filteredItems.map(...)`으로 전부 그린다(`market-products-client.tsx` 2891~). 페이지 나눔이 없다. 현재 국어 상품은 146개, 그중 한 메뉴에 144개가 몰려 있다.
- 다중 선택: 행 체크박스 + 머리글 `상품 전체 선택`(현재는 `filteredItems` 전체를 선택/해제). 일괄 숨김·이미지 일괄 지정/해제·완전 삭제는 `selectedItems`(= `filteredItems` 중 선택된 것)에 적용된다.
- 재사용할 기존 부품
  - `src/components/design-system/studio-list-pagination.tsx`의 `StudioListPagination`: `총 N개 · p / P 페이지`, `표시 개수`(20/50) 선택, 페이지 버튼(`StudioPagination`). `getPageHref`를 주지 않으면 링크가 아니라 버튼으로 동작한다.
  - `src/hooks/use-list-query.ts`의 `useListQuery`: 페이지·표시 개수를 URL 쿼리(`page`, `pageSize`)에 `window.history.pushState`로 기록한다. **Next 라우터 이동·서버 요청·스크롤 이동이 없고**, 기존 쿼리(`subject` 등)는 유지된다. 새로고침·뒤로 가기 시 페이지가 복원된다(메뉴는 URL에 없어 첫 메뉴에서만 정확, 4절 위험 참조).
  - `src/lib/list-pagination.ts`: `LIST_PAGE_SIZES = [20, 50]`, 기본 20.
  - 관리자 리뷰 화면(`reviews-admin-client.tsx`)이 같은 조합을 이미 쓴다.

**결정(기본안)**
- D1 **클라이언트 페이지 나눔**: 데이터는 이미 전부 받아 와 있으므로 `filteredItems`를 잘라 그린다(API·서버 변경 없음). 상품이 수천 개로 늘면 서버 페이지네이션으로 바꾸는 것을 후속으로 제안한다(현재 146개).
- D2 **목록 영역만 바뀜**: `useListQuery` + 버튼형 `StudioListPagination`. 화면 새로고침이나 라우트 이동이 없고(RSC 요청 없음, 기존 `router.refresh()`도 `page` 쿼리와 무관), 위쪽 상품 편집 폼 상태도 유지된다. 페이지·표시 개수를 바꾸면 목록 카드 머리글로 `scrollIntoView({ block: 'start' })` 한 번만 호출해 새 페이지 첫 행부터 보이게 한다. 호출은 `setPage`·`setPageSize`를 감싸는 핸들러에서만 한다(렌더·`useEffect`에서 부르면 첫 로드 때도 스크롤됨)(선례: `market-image-library.tsx`의 `headingRef.scrollIntoView`).
- D3 **표시 개수**: 기존 표준 20/50(기본 20)을 그대로 쓴다.
- D4 **페이지 초기화·보정**: 메뉴 선택 `select`의 `onChange`(이미 `setSelectedItemIds([])`를 부르는 곳)에서 `setPage(1)`을 호출한다. `useEffect([selectedMenuEntryId])`로 만들면 마운트 때도 실행되어 URL의 `page`가 지워지므로 쓰지 않는다. 상품 열기(`loadItemDetail`)는 같은 메뉴 값을 넣으므로 영향이 없고, 저장(`persistForm`)으로 메뉴가 바뀌는 경우는 이전 값과 다를 때만 `setPage(1)`. 삭제·새로고침으로 페이지 수가 줄면 렌더 시점의 `getListPagination`이 마지막 페이지로 보정한다(URL에 남은 더 큰 `page` 값은 무해). 목록은 `created_at desc`라 저장해도 행 위치가 바뀌지 않고, 새 상품은 1페이지 맨 위에 생긴다.
- D5 **선택**: 머리글 체크박스는 **현재 페이지의 상품만** 선택/해제한다(문구 `현재 페이지 상품 전체 선택`). `allFilteredSelected`·`someFilteredSelected`·`toggleFilteredSelection`을 현재 페이지 상품(`pagedItems`) 기준으로 바꿔, 다른 페이지 선택 때문에 머리글이 부분 선택(indeterminate)으로 보이지 않게 한다. 다른 페이지에서 고른 선택은 페이지를 옮겨도 유지되고, `선택 N개`와 일괄 작업은 지금처럼 현재 메뉴의 선택 전체에 적용된다(예: 80개 상품에 이미지 일괄 지정 → 50개씩 두 페이지에서 선택). 이미지 일괄 지정·해제와 완전 삭제는 확인 Dialog에서 대상 수를 보여 주지만, **선택 숨김은 확인 없이 바로 실행**된다(되돌릴 수 있음).
- D6 **편집 연동**: 연필 버튼으로 상품을 열거나 저장해도 같은 메뉴라면 현재 페이지를 유지한다.

## 2. 변경 대상
- `src/app/(admin)/admin/market/products/market-products-client.tsx`(목록 영역): `useListQuery`, `getListPagination`으로 `pagedItems = filteredItems.slice(offset, offset + pageSize)`, 머리글 체크박스 세 값과 토글을 `pagedItems` 기준으로, 목록 아래 `StudioListPagination`, 목록 카드 머리글 ref와 스크롤, 메뉴 `onChange`·저장 시 메뉴 변경에서 `setPage(1)`. 별도 순수 함수는 만들지 않는다(`getListPagination`이 이미 순수 함수).
- `tests/market-products-admin-hide-action.test.mjs`(52, 58행): `allFilteredSelected = filteredItems…`·`aria-label="상품 전체 선택"` 정규식을 새 구현(현재 페이지 기준, 새 문구)에 맞게 갱신.
- `StudioListPagination`은 `studio-theme` 래퍼를 가진 Studio 부품이다. 관리자 화면에서 시각적으로 어색하면(배경색 등) 기존 리뷰 관리자 화면과 같은 방식으로 그대로 둔다(같은 부품을 이미 관리자에서 사용 중).
- API·서버·DB 변경 없음.

## 3. 검증
- 계약 테스트(`node --test`): 목록이 `filteredItems.map`이 아니라 페이지 조각을 그린다, `useListQuery`·`StudioListPagination` 사용, `getPageHref` 미전달(버튼형), 머리글 체크박스가 현재 페이지 기준, 메뉴 변경 시 1페이지, `router.push`·`router.replace`로 페이지를 바꾸지 않음.
- `npx tsc --noEmit`, 변경 파일 eslint, 관련 테스트, 전체 `node --test tests/*.test.mjs` 실패 목록이 기준선(39)과 동일, scratchpad 복사본에서 `next build`.
- 브라우저(사용자): 20개씩 나뉘는지, 페이지 버튼을 눌러도 화면이 새로고침되지 않고 목록만 바뀌는지, 주소창에 `page`가 바뀌고 첫 메뉴에서 뒤로 가기·새로고침 시 같은 페이지, 50개 보기, 메뉴 변경 시 1페이지, 다른 페이지 선택 유지와 `선택 N개`, 일괄 작업, 편집 후 페이지 유지, 키보드 조작.

## 4. 위험
| 위험 | 대응 |
|---|---|
| 페이지를 넘긴 뒤 보이지 않는 선택이 일괄 작업에 포함됨 | 목록 머리글 `선택 N개`로 인지. 이미지 지정·해제·삭제는 확인 Dialog가 대상 수를 보여 주고, 선택 숨김은 확인 없이 실행되지만 숨김 해제로 되돌릴 수 있다. 필요하면 후속으로 버튼에 개수 표시·`선택 해제` 버튼 |
| 메뉴 선택은 URL에 없고 첫 메뉴로 초기화됨 | 새로고침·뒤로 가기 시 페이지 복원은 **첫 메뉴에서만** 정확하다. 다른 메뉴에서 새로고침하면 첫 메뉴의 같은 page 번호(범위 보정됨)가 열린다. 메뉴를 URL에 넣는 것은 이번 범위 밖 |
| `useListQuery`의 `useSearchParams` 때문에 Suspense 경계 경고/빌드 오류 | 리뷰 관리자 화면과 같은 구조인지 확인, 빌드로 검증 |
| 상품 수가 크게 늘어 전체를 한 번에 받는 비용 | 현재 146개라 문제없음. 1,000개 이상이면 서버 페이지네이션 후속 |

## 5. 검증 기록
| 회차 | 대상 | 검증자 | 판정 | 비고 |
|---|---|---|---|---|
| R1 | 초안 | 독립 검증(pagination-plan-verifier) | OK(조건부) → 보완 | 1 기존 계약 테스트 갱신 누락, 2 someFilteredSelected·toggle 현재 페이지 기준, 3 선택 숨김은 확인 Dialog 없음, 4 useEffect 대신 onChange에서 setPage(1), 5 메뉴 미보존 한계, 6 보정·정렬 명시, 7 스크롤 단순화 |
| R2 | R1 보완본 | 독립 검증(pagination-plan-verifier) | **OK** | 사소한 점 a(복원 문구 단서)·b(상태)·c(스크롤은 핸들러에서만) 반영 |
| 구현 | `market-products-client.tsx` 목록 영역, 계약 테스트 | 독립 리뷰(imglib-s3-reviewer) | **OK**(MINOR 1·NIT 1 반영) | 메뉴 변경·저장 시 메뉴 변경의 1페이지 초기화는 `replaceState`(기록 없음), 라우터 이동 금지 검사를 페이지 핸들러로 한정. tsc 0, 관련 테스트 통과, 전체 실패 39 = 기준선, 복사본 next build OK. 버튼 실제 동작은 브라우저 확인 필요 |
