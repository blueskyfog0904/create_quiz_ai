# 문제마켓 카테고리 5단계 트리 · 상품 상세 주소 독립 · 게시판 의존 제거 계획

- 작성일: 2026-10-12 · 브랜치 main(HEAD 401075d) · 상태: **초안 R6 — 2차 독립 검증 지적 30건 반영(R3) + 사용자 결정 Q8·Q9·Q10 반영(R4) + R4 재검증 지적 17건 반영(R5) + R5 재검증 지적 15건 반영(R6), 재검증 대기**(구현 시작 전)
- 요청: 문제마켓 카테고리를 최대 5단계(depth1~5) 트리로 넓히고, 관리자 관리 화면을 정비하고, 상품 상세 주소를 게시판(`market_menu_entries`)과 무관한 `/items/[itemId]`로 독립시키고, 게시판 의존을 4단계에 걸쳐 걷어낸다. **이번 작업은 계획서 작성까지이며 코드·DB는 바꾸지 않는다.**
- 근거 표기: 소스는 `file:line`(HEAD 401075d, 조사 시점 기준). DB는 운영 DB(`kzcweelnzhcmiuvjgeyi`) SELECT 조회(2026-10-12) "직접 확인". 로컬 `.env.local`도 같은 운영 DB를 쓴다.
- 용어: **depth1~5는 사용자 기준**이다(과목은 단계로 세지 않는다). 지금 관리자 화면의 "그룹(2단계)"이 depth1, "항목(3단계)"이 depth2다. "게시판"은 `market_menu_entries`(상품의 `menu_entry_id`), "카테고리"는 트리 노드(상품의 `category_item_id`)만 가리킨다.

---

## 1. 목표와 범위

### 1.1 목표
1. 카테고리를 parent_id·depth(1~5)를 가진 트리 하나로 합치고, 기존 그룹·항목 ID를 그대로 depth1·depth2 ID로 보존한다.
2. 공개 사이트: 어느 depth의 카테고리 페이지든 열리고, 상위 칸은 하위 전체 상품과 합산 개수를 보여 준다. 메가메뉴는 depth1~2만 표시한다.
3. 관리자: "카테고리 메뉴 관리" 한 곳에서 트리를 편집한다. 같은 편집기를 상품 폼의 [카테고리 관리] 팝업에서 다시 쓴다. 상품의 카테고리는 필수로 바꾸고, 게시판은 화면에서 숨긴다.
4. 상세 주소를 `/items/[itemId]?subject=`로 독립시키고 예전 상세 주소 3종을 redirect한다.
5. 국어 상품 144개를 depth3·depth4로 재배치한다(일회성 DB 스크립트).
6. 게시판 의존을 4단계로 제거하고, 마지막에 `market_items.menu_entry_id`를 nullable로 바꾼다.

### 1.2 포함 / 제외

| 포함 | 제외(범위 밖) |
|---|---|
| 트리 테이블 통합 마이그레이션, 타입 재생성, SQL 테스트 | 문제은행 분류(`question_bank_years/books/problem_types`) |
| 공개 트리 조회·하위 합산·캐시, 카테고리 페이지·사이드바·메가메뉴 | 서브상품 구성 종류(`market_subproduct_categories`)와 그 `categorySlug`(question_pdf/hwp) |
| 관리자 노드 API, 공용 트리 편집기, 상품 관리 화면 개편 | `generate_menu_entries`, `generate_listboard_posts`의 `menu_entry_id` |
| `/items/[itemId]` 신설, 예전 상세 3종 redirect, 상세 링크 11곳 교체, 보관함 링크 버그 수정 | 노드 이동(부모 변경) — Q4, 후속 작업 |
| 국어 depth3·4 생성과 144개 재배치 스크립트(영어는 구조만) | 조상 기본 이미지 상속 — R14 |
| 게시판 is_visible 게이트 제거, 검색·보관함 '분류' 필터 전환 | 죽은 코드 삭제(`CampaignHero`) — 언급만 |
| '(임시) 문제마켓 메인 관리'의 '문제마켓 카테고리'(`categories.menuEntryIds`) 설정 **삭제**(S0, Q8 — 대체하지 않음. `HomeFinalCta`의 미사용 `categories` prop 제거 포함) | 메인 관리 설정을 카테고리 기준으로 바꾸는 작업 — Q8 결정으로 없어짐 |
| 예전 목록 화면 redirect(307로 시작, 308 전환은 S4 배포 2주 뒤 조건부 별도 커밋 — Q9), 공용 컴포넌트 2개(`market-item-actions.tsx`, `market-sample-preview-dialog.tsx`) `src/components/market` 이동, 예전 `market-sidebar.tsx`·예전 market `layout.tsx` 2개 삭제(Q10), 메뉴관리 '문제마켓 2단계 메뉴 관리' 카드 제거, `menu_entry_id` nullable | 게시판 행(`market_menu_entries`) hard delete — 하지 않음 |

### 1.3 사용자 결정 요약

| ID | 결정 | 계획서 반영 위치 |
|---|---|---|
| D1 | depth 값은 **실제 상품 제목에서 확인한 값** 그대로. 표시 이름은 사용자 표기(가운뎃점 포함). 사용자 목록에 없던 '현대소설'도 포함 | 7절 |
| D2 | 상품은 **어느 depth에든** 연결 가능. 하위가 있는 칸을 고르면 하위 선택 권장 안내. 상위 칸 페이지는 하위 전체 상품, 개수도 하위 합산 | 4.2, 5.3, 6.2 |
| D3 | 하위(자기 포함)에 상품이 있으면 삭제 차단 + '비활성화하거나 상품을 옮긴 뒤 삭제' 안내. 상품이 조용히 미지정으로 풀리지 않음 | 3.2(FK restrict), 4.4 |
| D4 | 상세 주소 `/items/[itemId]`. 예전 상세 3종은 새 주소로 redirect. `?subject=` 유지 여부는 계획서에서 결정 → **유지(P1)** | 6.4 |
| D5 | 트리 관리는 '카테고리 메뉴 관리' 한 곳. 편집기는 공용 컴포넌트, 상품 폼 [카테고리 관리] 팝업에서 재사용, 선택칸에 즉시 반영 | 5.1, 5.2 |
| D6 | `market_category_groups/items`를 트리 테이블 하나로 통합, 기존 ID 보존 | 3절 |
| D7 | 메가메뉴 depth1~2만. 카테고리 페이지에 하위 탐색('더 자세히 찾기'), 상단 경로, 사이드바 현재 위치까지 펼침 | 6.1~6.3 |
| D8 | 게시판 의존 제거 4단계: (1) 상세 주소 독립 (2) 관리자 상품 화면 (3) 노출 조건·필터 (4) 예전 화면 정리·카드 제거·nullable. 원래 (3)에 있던 '메인 관리 설정'은 D11(Q8)로 S0에서 설정 자체를 삭제 | 8절 |
| D9 | 국어 144개 재배치는 일회성 DB 스크립트(앱 코드에 매핑 금지), dry-run → 승인 → 실행 → 검증 쿼리 | 7절 |
| D10 | 모든 코드 변경은 국어·영어 공통. 영어는 데이터 0건이므로 구조만 | 전 단계 |
| D11 | (Q8, 2026-10-12) '(임시) 문제마켓 메인 관리'의 '문제마켓 카테고리'(`categories.menuEntryIds`) 설정은 대체하지 않고 **삭제**. S0에서 별도 커밋. 예전 형태(`categories` 키 포함) 값이 와도 popular·recent가 유지되도록 `validateMarketHomeConfig`가 `categories` 키 하나만 떼어 낸 뒤 검증한다(= 읽기 경로 normalize와 저장 API 모두 `categories` 키를 무시하고 받아들임. 그 밖의 모르는 키는 지금처럼 거절) | 5.4, 8.2-4 |
| D12 | (Q9, 2026-10-12) 모든 redirect는 **307(`permanent: false`)로 시작**. 목적지: 예전 상세 3종 → `/items/[itemId]?subject=…`, 예전 목록 → `/?subject={subject}`(과목 없는 주소는 `/`). 308 전환은 S4 배포 2주 뒤 3조건(① 2주 동안 상세 페이지 오류·이동 관련 문의 없음 ② Vercel 로그에서 예전 주소 요청이 새 주소로 정상 이동하는 것 확인 ③ 예전 화면·게시판 구조로 되돌릴 계획 없음)을 모두 만족할 때 별도 커밋. 이유: 308은 브라우저·검색엔진이 영구 기억해 서버 설정을 되돌려도 이미 기억한 사용자는 계속 새 주소로 가므로 되돌리기 어렵다. (이 칸은 결정 원문만 적는다. 과목 없는 상세 주소의 HTTP 목적지는 계획서 해석 **P11**, '2주'의 시작일은 **P12**, 조건 ③에 더한 점검은 P8에 '계획서 추가 점검'으로 따로 표시) | P8, P11, P12, 6.4, 8.10-1, 8.12 |
| D13 | (Q10, 2026-10-12) (a) `market-item-actions.tsx`·`market-sample-preview-dialog.tsx`를 `src/components/market`으로 이동(import 전체·경로를 읽는 계약 테스트 **12개 파일·15줄** 갱신 — 결정 당시 '약 15곳'은 이름이 비슷한 관리자 전용 `admin-market-sample-preview-dialog`와 금지어 `doesNotMatch` 정규식까지 grep에 걸린 수, 8.10-2a) (b) `market-sidebar.tsx`와 그것을 쓰는 예전 market `layout.tsx` 2개를 삭제하고 `tests/menu-divider-management.test.mjs` 수정. S4에서 이동 커밋(S4-2a)을 먼저, `next build`·기준선 비교 통과 뒤 삭제 커밋(S4-2b) | P9, 8.10-2 |

### 1.4 계획서에서 정한 기본값(사용자 결정이 위임된 것 또는 조사 권장안)

| ID | 기본값 | 이유 |
|---|---|---|
| P1 | 상세 주소에 `?subject=` **유지**. 없거나 상품 과목과 다르면 `/items/{id}?subject={실제과목}`으로 redirect | `PreviewHeader`가 `?subject=`로 과목 탭을 정한다(없으면 국어). 주소에 과목이 있으면 병렬 조회를 유지할 수 있다 |
| P2 | 테이블 이름 `market_category_items` **유지**(확장 방식) | FK 이름, `MARKET_THUMBNAIL_EMBED`/`MARKET_ITEM_ADMIN_SELECT` 연결 구문, `delete_market_image` RPC, `listMarketImageUsage`, 정규식 계약 테스트를 바꾸지 않아도 된다 |
| P3 | 마이그레이션은 **확장(expand) → 코드 배포 → 축소(contract)** 2개로 나눈다. **요구사항 명세와 다름**: R2는 '새 마이그레이션 하나로 처리', R15는 '트리 단계: R2 마이그레이션 → R3~R7 코드 배포 → R11'로 적혀 있다. 이 계획은 R2를 M1(T1)·M2(T3) 두 파일로 나누고 M2를 코드 배포(T2) 뒤에 둔다 → **사용자 확인 필요(Q13)**. Q13에서 '단일 마이그레이션'을 고르면 M1+M2를 한 파일로 합쳐 T2 배포 직후에 적용하고, T1~T2 사이 창은 없어진다(대신 배포와 적용 사이 몇 분간 공개 카테고리 화면이 오류) | 운영 DB 공유. 한 번에 그룹 테이블을 지우면 배포 전 코드(그룹 테이블을 읽음)가 즉시 깨진다. 확장을 먼저 하면 배포 전 코드와 새 코드가 둘 다 동작하는 창이 생긴다 |
| P4 | 상품 FK `on delete restrict`, 자식 노드 FK도 `on delete restrict`(하위 칸이 있으면 삭제 차단) | D3. Q3 권장 기본값 |
| P5 | 노드의 parent_id·depth·workspace_subject는 **생성 후 변경 불가**(트리거) | 노드 이동 미지원(Q4). 이 규칙으로 순환이 구조적으로 생길 수 없다(3.3) |
| P6 | 메가메뉴 depth1 제목을 `/categories/{depth1Id}?subject=` **링크로** 만든다 | depth1 페이지가 생긴다 |
| P7 | 기본 이미지는 **직접 연결된 칸**의 것만(상속 없음). 모든 depth에 지정 가능 | R14. 운영 기본 이미지 0건 |
| P8 | **(사용자 결정 D12·Q9)** 새 redirect(S1 상세 3종, S4 목록)는 모두 `permanent: false`(307)로 시작한다. 308(`permanent: true`) 전환은 **S4 배포 2주 뒤**(시작일 = 배포 D 운영 확인일, P12) 세 조건 — ① 2주 동안 상세 페이지 오류·이동 관련 문의 없음 ② Vercel 로그에서 예전 주소 요청이 새 주소로 정상 이동(측정 방법·통과 기준은 8.12-2. 로그로 측정할 수 없거나 트래픽이 0건이면 curl 대체 결과를 사용자에게 보여 주고, 조건 ②를 그것으로 갈음할지 **사용자가 정한다**) ③ 예전 화면·게시판 구조로 되돌릴 계획 없음 — 을 **모두** 만족할 때만 별도 커밋으로 한다(8.12). 조건 ③에는 **(계획서 추가 점검 — 308의 되돌리기 어려움이라는 결정 이유에서 나온 것, 결정 원문에는 없음)** 두 가지를 함께 묻는다: 출발 경로(`/market`, `/market/:slug`, `/{subject}/market/**`, `/preview/solvook-concept/boards/:slug`)를 다른 화면에 다시 쓸 계획이 없음(S4 뒤에도 앱 안에 남는 예전 출발 경로 링크 목록 포함, 8.12-3), 목적지 주소 형식(`/items/[itemId]?subject=`, `/?subject=`)을 바꿀 계획이 없음. 하나라도 어긋나면 307을 유지한다 | 308은 브라우저·검색엔진이 영구 기억한다. 서버 설정을 되돌려도 이미 기억한 사용자는 계속 새 주소로 가므로 되돌리기 어렵다. 307은 매 요청 서버를 거치므로 revert만으로 바로 되돌릴 수 있다 |
| P9 | **(사용자 결정 D13·Q10)** 예전 라우트 폴더의 공용 컴포넌트 2개 — `market-item-actions.tsx`(상품 상세 구매 영역, 실제 상세 페이지 `market-material-detail.tsx`가 사용)와 `market-sample-preview-dialog.tsx`(샘플 미리보기 팝업, 사용처 6곳: 실제 사이트 5곳 `market-material-list.tsx`, `detail/market-material-sample-button.tsx`, `search-view.tsx`, `category-items-view.tsx`, `market-item-actions.tsx`(상대 import) + 예전 화면 `(dashboard)/market/[slug]/market-listboard-client.tsx`(2b에서 삭제)) — 를 `src/components/market/`로 **옮긴다**. 예전 화면 전용인 `(dashboard)/market/market-sidebar.tsx`는 그것을 쓰는 예전 market `layout.tsx` 2개(`(dashboard)/market/layout.tsx`, `[workspaceSubject]/market/layout.tsx`)와 함께 **삭제**하고 `tests/menu-divider-management.test.mjs`를 고친다. 순서: S4 안에서 **이동 커밋(S4-2a)을 먼저** 하고 `next build`·기준선 비교를 통과한 뒤 예전 page·layout·사이드바 **삭제 커밋(S4-2b)**(8.10-2) | 예전 폴더를 비우려면 실제 사이트가 쓰는 컴포넌트를 먼저 옮겨야 한다. 이동(경로 변경만)과 삭제를 커밋으로 나누면, import 깨짐은 S4-2a의 `next build`에서, 예전 화면 제거의 영향은 S4-2b에서 따로 확인·revert할 수 있다. 이동 시점을 S4보다 앞당기지 않는 이유는 8.10-2. **관리자 상품 화면(`market-products-client.tsx`)은 이 컴포넌트를 쓰지 않는다** — 66행은 같은 폴더의 관리자 전용 `./admin-market-sample-preview-dialog`를 import하며, 이 파일은 옮기지 않는다(`market-sample-preview-dialog`가 그 이름의 일부라 부분 문자열 grep에 걸릴 뿐) |
| P10 | 카테고리 페이지 404는 **실제 HTTP 404**로 보장한다: `categories/[id]/layout.tsx`가 캐시된 노드 트리로 존재·조상 활성 여부를 확인해 `notFound()`(6.2) | R3·R4 acceptance '404'를 화면만이 아니라 상태 코드로 지킨다. 캐시 적중이면 0쿼리. Q15 |
| P11 | **(계획서 해석 — 사용자 확인 권장)** 과목 정보가 없는 예전 상세 주소 2종 — `/market/{slug}/items/{id}`와 `?subject` 없는 preview 상세(`/preview/solvook-concept/boards/{slug}/items/{id}`) — 는 `next.config` redirect의 HTTP 목적지(Location)를 `/items/{id}`(쿼리 없음)로 두고, `/items` page가 상품의 실제 과목으로 `/items/{id}?subject={실제}`를 맞춘다(HTTP 200 + 클라이언트 redirect — 6.4). **브라우저 최종 URL은 결정(D12의 `/items/[itemId]?subject=…`)과 같다** | 주소에 과목 정보가 없어 `next.config` 단계에서는 과목을 알 수 없는 기술적 제약(DB 조회가 필요). 결정 문구가 이 경우를 따로 다루지 않으므로 계획서가 해석한 것이다. 확인 방법: HTTP 목적지는 curl `%{redirect_url}`, `?subject=`는 브라우저 최종 URL(B-1·B-7·B-8) |
| P12 | **(계획서 해석 — 결정 문구 'S4 배포 2주 뒤'의 시작일)** 2주의 시작일 = **S4 마지막 코드 배포(배포 D, 8.10 커밋 표)가 운영에서 확인된 날**. M4(DB 단계)는 배포 D보다 먼저 끝나므로 이 날에는 M4 검증도 끝나 있다. 이 날짜를 S4 검증 기록에 적고, 같은 날 8.12-2②의 로그 수집을 시작한다(8.10 마지막 확인 항목) | S4는 배포 A(목록 redirect·이동), B(예전 page 삭제), C, DB 단계 M4, D로 나뉘어 여러 날에 걸칠 수 있다. 308은 되돌리기 어려우므로, 예전 page가 아직 남아 있거나(2b 전) S4가 아직 되돌려질 수 있는 기간을 2주에 넣지 않고 **S4의 최종 상태로 2주**를 지켜본다. 배포 A 기준(목록 redirect가 처음 운영에 올라간 날)보다 늦게 시작하므로 결정보다 엄격한 쪽이다 |

---

## 2. 요구사항 추적표

단계 ID는 8절의 실행 카드와 같다(S0 → S1 → T1 → T2 → T3 → T4 → S2 → S3 → S4).

| R-ID | 요구사항 | 구현 단계 | 변경 파일(주요) | 검증 방법 |
|---|---|---|---|---|
| R1 | 사이드바 변경 커밋 + 테스트 기준선 | S0 | `src/lib/admin-sidebar.ts`, `tests/admin-sidebar-navigation.test.mjs` | `git show --stat HEAD`, 사이드바 테스트 fail 0, 기준선 파일 저장(53개), **명세 명령 `node --test tests/*.test.mjs` 한 번 실행의 tests/fail과 파일별 합계 대조(8.2-3)** |
| R2 | 트리 테이블 통합(ID 보존, depth 1~5) | T1(확장), T3(축소) | `supabase/migrations/<ts>_market_category_tree_expand.sql`, `<ts>_market_category_tree_contract.sql`, `supabase/tests/market_category_tree.test.sql`(신규), `supabase/tests/market_images.test.sql`, `src/types/supabase.ts` | 3.6 검증 쿼리, SQL 테스트 2개, 2회 실행 무오류. **명세의 '단일 마이그레이션'과 다름 → P3·Q13** |
| R3 | 공개 트리 조회·하위 합산·캐시 | T2 | `src/lib/market-categories-server.ts`, `src/lib/market-category-tree-cache.ts`(S1 신설), `tests/category-pagination-server.test.mjs` | 하네스 쿼리 수 일정, 합산 값, 조상 비활성 숨김, 캐시 키·revalidate |
| R4 | 카테고리 페이지(모든 depth, 경로, 하위 탐색, 사이드바) | T2 | `src/app/(solvook)/categories/[id]/layout.tsx`(신규, 404)·`page.tsx`·`loading.tsx`·`_components/category-items-view.tsx`, `src/components/market/MarketCategorySidebar.tsx` | depth1 페이지 200, 없는 id·조상 비활성 id **curl 404**(B-2), 광고 2개 80/64, 경로·DetailFinder·펼침 브라우저 확인, **depth5 사이드바 w-56 확인(B-3)**, 계약 테스트, **페이지 요청 1회 쿼리 수를 401075d 기준값과 비교(8.5 T2-M, 캐시 적중·미스 두 값)** |
| R5 | 메가메뉴 depth1~2 | T2 | `src/components/layout/category-mega-menu.tsx`, `src/app/api/market/category-menu/route.ts` | API 응답 depth ≤ 2, 합산, Cache-Control·폴백 계약 |
| R6 | 관리자 노드 API·삭제 차단 | T2 | `src/app/api/admin/market-categories/route.ts`, `.../[nodeId]/route.ts`(신규), groups/items 라우트 4개 삭제, `market-categories-server.ts` | **하네스 실행 테스트**(`createFakeAdmin`·`loadRoute`: 하위 상품 있으면 409·delete 미호출, leaf 200·delete 호출, 23503 제약 이름별 409 문구, depth5 부모 400, 빈 제목·121자 제목 400, 비로그인 401·비관리자 403), `toMegaMenuTree` 단위 테스트(depth2 합산 보존), revalidateTag, 라우트 파일 부재 |
| R7 | 공용 트리 편집기, 카테고리 메뉴 관리 화면 | T2 | `src/components/admin/market-category-tree-editor.tsx`(신규), `src/app/(admin)/admin/market-categories/page.tsx`·`market-categories-client.tsx` | 용어 grep, depth5 하위 추가 불가, 409 안내, `?subject=` 링크, 국어·영어 |
| R8 | 상품 관리 화면 개편 | S2 | `src/app/(admin)/admin/market/products/market-products-client.tsx`·`page.tsx` | 필수 검증, 게시판 select 없음, 팝업 즉시 반영, 하위 포함 필터, 필터 부작용 제거 |
| R9 | 관리자 상품 API(카테고리 필수, 기본 게시판 DB 규칙) | S2 | `src/app/api/admin/market/items/route.ts`·`[id]/route.ts`, `src/lib/market-items-server.ts` | 400/201, **PATCH 다른 과목 카테고리 400(하네스 실행)**, 기본 게시판 일치, UUID 리터럴 grep 0, GET 하위 포함 |
| R10 | `/items/[itemId]` 신설, redirect 3종(307 — Q9), 링크 11곳 | S1(경로 표시 재귀화는 T2) | `src/app/(solvook)/items/[itemId]/page.tsx`·`loading.tsx`(신규), `market-material-detail.tsx`, `path-aware-site-chrome.tsx`, `next.config.ts`, 링크 생성 11곳 | 200·404·redirect, 새 계약 테스트(예전 상세 링크 조립 패턴 0건, **상세 page가 `@/lib/market-category-tree-cache`를 쓰고 `listMarketCategory(Menu|Tree)(true)`를 직접 부르지 않음**), 클릭 이동 브라우저 확인 |
| R11 | 국어 depth3·4 생성 + 144개 재배치 | T4 | `scripts/market-category-tree-backfill.mjs`(신규) | dry-run 개수표, 미매칭·중복 0, 실행 후 검증 쿼리, 2회 실행 무중복 |
| R12 | 노출 조건·분류 필터·메인 관리 설정을 카테고리 기준으로. **메인 관리 설정은 사용자 결정 Q8(D11)로 '카테고리 기준 전환' 대신 설정 자체를 삭제** | S0(메인 관리 '문제마켓 카테고리' 설정 삭제, 5.4), S3(노출 조건·분류 필터) | S0: `market-home.ts`, `market-home-server.ts`(`categories`·관리자 옵션), `home-material-sections.tsx`(`HomeFinalCta`)와 호출처 2곳, market-main-settings route·client. S3: `market-search-server.ts`, `market-categories-server.ts`, `market-home-server.ts`(게이트), `market-cart-server.ts`, `market-board-server.ts`, `market-items-server.ts`, sample-pages route, search page·view, library-view, `<ts>_market_public_gate_without_board.sql` | S0: 메인 관리 카드 없음·저장 정상, **`tests/market-home-config-normalize.test.mjs`(예전 `categories` 키가 와도 popular·recent 유지)**. S3: 게이트 grep 0, **숨김 게시판 픽스처 실행 테스트 5곳**(검색·카테고리·홈·장바구니·샘플 API, 8.9), RPC 정의 |
| R13 | 예전 화면 redirect, 게시판 카드 제거, nullable | S4(308 전환은 S4 배포 2주 뒤 조건부 — 8.12) | `next.config.ts`, `src/components/market/market-item-actions.tsx`·`market-sample-preview-dialog.tsx`(이동, Q10)와 그 import 파일, 예전 라우트 폴더 `src/app/(dashboard)/market/**`·`src/app/[workspaceSubject]/market/**`(page·layout·`market-sidebar.tsx` 삭제, Q10), preview boards page, menu-management client·actions, `api/market/[slug]/items`, legacy 보관함, `<ts>_market_items_menu_entry_nullable.sql`, `src/types/supabase.ts`, `tests/menu-divider-management.test.mjs` | redirect 307, `next build`(S4-2a 이동 커밋·S4-2b 삭제 커밋 각각), information_schema, null 상품 동작(국어·영어, B-7), 옮긴 컴포넌트 2개가 `src/components/market`에 있고 예전 폴더 파일 0·`@/app/(dashboard)/market` import 0건(retirement 계약), tsc |
| R14 | 기본 이미지 정책(직접 연결만) | T2 | 변경 없음(테이블 이름 유지). 선택: `market-image-library.tsx` 문구 | `market-images-*` 계약 통과, **`market_images.test.sql`의 depth1(c0) 기본 이미지 IN_USE·`categoryItems` 케이스(3.7)**, B-3의 depth1 이미지 지정·삭제 409 |
| R15 | 단계 구성·순서·검증 게이트 | 전체 | 이 문서 | 8절 카드마다 선행 조건, DB 단계의 dry-run·승인·검증 쿼리, 기준선 비교 명령 |

---

## 3. DB 설계

### 3.1 최종 스키마(T3 이후) — `public.market_category_items`

| 컬럼 | 타입 | 제약 | 비고 |
|---|---|---|---|
| id | uuid pk | default gen_random_uuid() | 기존 그룹·항목 ID 보존 |
| workspace_subject | text not null | check in ('english','korean') | 기존 |
| parent_id | uuid null | **복합 FK** (parent_id, workspace_subject) → (id, workspace_subject) `on delete restrict` | 신규. 같은 과목만 부모가 될 수 있다 |
| depth | smallint not null | check (depth between 1 and 5), check ((depth = 1) = (parent_id is null)) | 신규 |
| title | text not null | | 기존 |
| sort_order | integer not null default 0 | | 기존. 형제 사이 정렬 |
| is_active | boolean not null default true | | 기존 |
| default_image_id | uuid null | FK `market_category_items_default_image_id_fkey` → market_images restrict | 기존(20261002014653), 그대로 |
| created_at / updated_at | timestamptz | | 기존 트리거 `set_market_category_items_updated_at` 유지 |
| ~~group_id~~ | | | T3에서 제거 |

- 유지되는 제약: `market_category_items_id_subject_key unique (id, workspace_subject)` — 자기참조 복합 FK와 상품 복합 FK의 대상.
- 인덱스: `market_category_items_parent_sort_idx (parent_id, sort_order)` 신규. `market_category_items_group_id_idx`는 T3에서 제거.
- 상품 FK: `market_items_category_item_subject_fkey` (category_item_id, workspace_subject) → (id, workspace_subject)를 **이름은 그대로**, 동작만 `on delete set null (category_item_id)` → `on delete restrict`로 바꾼다.
- RLS: 활성화 유지, 정책 "Active market category items are publicly readable"(`for select using (is_active)`) 다시 선언. anon·authenticated는 `revoke all` 후 `grant select`만. 쓰기는 service role만. 조상 비활성 숨김은 행 단위 RLS로 표현할 수 없으므로 서버 조립 단계(4.1)에서 보장한다(앱 공개 조회는 모두 service role).
- 그룹 테이블 `market_category_groups`, 함수 `set_market_category_groups_updated_at()`, 정책 "Active market category groups are publicly readable"는 T3에서 제거.

### 3.2 확장 마이그레이션 M1(T1) — `supabase/migrations/<ts>_market_category_tree_expand.sql`

기존 관례대로 BEGIN/COMMIT 없이, `if not exists` / `create or replace` / `pg_constraint`·`information_schema` 확인 DO 블록으로 다시 실행해도 안전하게 쓴다. 기존 마이그레이션 파일은 수정하지 않는다. **이 파일은 그룹 테이블과 group_id를 지우지 않는다**(배포 전 코드가 계속 동작해야 함).

**적용 절차(M1~M4 공통, `docs/cart-implementation-plan-v4.md` P1-8 관례)**:
- **착수 전 체크리스트(T1·T3·S3·S4 공통 선행 조건)**: ① Supabase MCP가 인증된 상태인지 확인한다 — 조사 세션에서는 인증 전 상태(`authenticate` 도구만 노출)였다. 사용자에게 인증을 요청하고, `list_migrations` 조회가 성공해야 다음으로 간다. ② 그 결과(또는 `select version, name from supabase_migrations.schema_migrations order by version desc limit 5`)로 운영 적용 이력이 로컬 `supabase/migrations`와 맞는지, 최근 `20261002014653_market_image_refs`까지 적용돼 있는지 확인한다(10절의 이력 확인 항목을 여기로 합침). ③ 둘 중 하나라도 실패하면 그 DB 단계를 시작하지 않고 사용자에게 보고한다.
- 실행 도구: dry-run·검증 쿼리·SQL 테스트·재실행 확인은 Supabase MCP `execute_sql`, 실제 적용은 MCP `apply_migration`(파일 단위, `db push` 금지). `.env.local`에는 PG* 변수나 DB URL이 없고 서비스 키만 있으므로 `psql`은 **사용자가 PG* 환경변수를 따로 제공한 경우에만** 대체 수단으로 쓴다.
- dry-run: `execute_sql` 한 번에 `begin; <마이그레이션 본문>; <검증 DO 블록>; rollback;`. 검증은 DO 블록 assert(어긋나면 `raise exception`)로 한다. 마지막 문장이 rollback이라 중간 `select` 결과가 돌아오지 않을 수 있으므로, 값을 보여 줘야 하면 마지막 DO 블록에서 `raise exception 'DRYRUN_RESULT %', <json>`으로 값을 담아 강제 롤백시키고 그 메시지를 사용자에게 제시한다.
- 적용 전 **객체 체크리스트**를 만든다(그 파일이 만들거나 바꾸는 컬럼·제약·인덱스·트리거·함수·정책·GRANT·데이터 행 수). `apply_migration`의 단일 트랜잭션 실행 여부는 확인되지 않았으므로, 적용 뒤 `information_schema.columns`·`pg_constraint`·`pg_indexes`·`pg_trigger`·`pg_proc`·`pg_policies`·`count`로 대조해 **성공이면 전부 반영, 실패면 전부 미반영**인지 본다. 실패인데 일부만 반영돼 있으면 부분 적용으로 판정하고 이후 단계를 멈추고 보고한다.
- 적용 직후 `select version, name from supabase_migrations.schema_migrations where name = '<이름>'`으로 version을 조회해 로컬 파일명을 `<그 version>_<이름>.sql`로 바꾼다(`ls supabase/migrations | grep <이름>`으로 확인). 이력 행 증가 = 1.
- 재실행 안전 확인(Q-9)은 `apply_migration`이 아니라 `execute_sql`로 같은 SQL을 한 번 더 실행한다(이력 행을 추가하지 않음).

순서(순서가 중요하다 — 트리거는 데이터 이관 뒤에 만든다):

1. `alter table public.market_category_items add column if not exists parent_id uuid;` / `add column if not exists depth smallint;`
2. group_id 컬럼이 있으면(`information_schema.columns` 확인 DO 블록) `alter column group_id drop not null` — depth1 행은 group_id가 없다.
3. 그룹 → depth1(같은 id): `market_category_groups`가 있고(`to_regclass`) **`depth is null`인 행이 하나라도 있을 때만**(= 이관이 아직 끝나지 않음. 첫 실행에는 방금 추가한 depth가 기존 32행 모두 null이라 참, 이관 뒤 재실행에는 6번 이후 null이 없어 거짓) `insert into market_category_items (id, workspace_subject, title, sort_order, is_active, created_at, updated_at, parent_id, depth) select id, workspace_subject, title, sort_order, is_active, created_at, updated_at, null, 1 from market_category_groups on conflict (id) do nothing;` — 운영 DB에서 그룹·항목 ID 중복 0건 직접 확인.
4. 기존 항목 → depth2: group_id 컬럼이 있으면 `execute 'update public.market_category_items set parent_id = group_id, depth = 2 where group_id is not null and depth is null'`.
   - **updated_at 변경은 허용한다**: 기존 BEFORE UPDATE 트리거 `set_market_category_items_updated_at`가 이 32행의 `updated_at`을 적용 시각으로 바꾼다(운영 32행은 지금 모두 `created_at = updated_at` — 직접 확인). 그룹 5행은 insert라 타임스탬프가 보존되지만 항목은 보존되지 않는다. `updated_at`은 정렬·업무 로직·관리자 화면 어디에도 쓰이지 않으므로(`market-categories-server.ts`·관리자 카테고리 화면 grep 0건) 트리거를 끄지 않는다(끄면 실패 시 트리거가 꺼진 채 남는 위험이 생김). Q-3은 `updated_at`을 비교하지 않는다고 명시한다.
   - **재실행 범위 제한**: 3·4번은 `depth is null` 가드 덕분에 이관 뒤 재실행에서 아무것도 하지 않는다. 그래도 **M1 재실행(Q-9)은 적용 직후, T2 배포 전에만 한다**. T2 이후 관리자가 그룹 출신 depth1을 지운 상태에서 가드 없는 옛 버전 SQL을 다시 돌리면 그 칸이 되살아날 수 있기 때문이다(가드는 이 위험을 막는 장치이고, 운영 절차로도 금지한다).
5. 안전 확인(DO 블록, 실패 시 `raise exception`으로 전체 중단): `depth is null`인 행 0개, 모든 그룹 id가 depth1 행으로 존재.
6. `alter column depth set not null`.
7. 제약(pg_constraint 확인 후 추가): `market_category_items_depth_range` check (depth between 1 and 5), `market_category_items_root_parent` check ((depth = 1) = (parent_id is null)), `market_category_items_parent_subject_fkey` foreign key (parent_id, workspace_subject) references market_category_items(id, workspace_subject) on delete restrict.
8. `create index if not exists market_category_items_parent_sort_idx on public.market_category_items(parent_id, sort_order);`
9. 트리거 함수 `public.check_market_category_item_tree()`(plpgsql, `set search_path = public, pg_temp`) + `drop trigger if exists` / `create trigger check_market_category_item_tree before insert or update on public.market_category_items`:
   - INSERT이고 parent_id가 있으면 부모를 **`parent_id`로만** 조회해(`select depth from market_category_items where id = new.parent_id`) `new.depth = parent.depth + 1`이 아니면 `raise exception … using errcode = '23514'`. 과목은 트리거에서 보지 않는다 — **과목 불일치는 복합 FK가 23503으로 거부**한다(BEFORE 트리거가 먼저 돌지만 id로만 찾으므로 depth가 맞으면 통과하고, 이어서 FK가 거부). 부모 id가 아예 없으면 트리거는 통과시키고 FK가 23503으로 거부한다. 이렇게 고정해야 3.7 SQL 테스트의 기대 코드가 구현에 따라 달라지지 않는다.
   - UPDATE에서 parent_id·depth·workspace_subject가 바뀌면 `raise exception`(errcode 23514). 이동 미지원(P5).
10. 상품 FK 교체(DO 블록): `market_items_category_item_subject_fkey`의 `confdeltype`이 `'r'`이 아니면 drop 후 같은 이름으로 `foreign key (category_item_id, workspace_subject) references public.market_category_items(id, workspace_subject) on delete restrict` 추가. 이미 restrict면 아무것도 안 한다.
11. RLS·grant 다시 선언: `alter table … enable row level security`, `revoke all … from anon, authenticated`, `grant select … to anon, authenticated`, `drop policy if exists "Active market category items are publicly readable"` → `create policy … for select using (is_active)`.

**배포 전 코드와의 호환(T1~T2 사이 창)**: 배포 전 코드는 그룹 테이블과 `group_id`로 트리를 만든다. depth1 행은 group_id가 null이라 `itemsByGroup`에 묶이지 않고 무시된다(`market-categories-server.ts:63-77`). 메가메뉴·카테고리 페이지(항목 id)·광고 링크는 변화 없음. **예외 1건**: 배포 전 `getMarketCategoryItemDetail(옛 그룹 id)`은 이제 그 id를 depth1 행으로 찾은 뒤 `market_category_groups`를 `.eq('id', item.group_id)`(null)로 조회한다. supabase-js가 `id=eq.null`을 보내 PostgREST uuid 캐스트 오류가 나므로 `/categories/{옛 그룹 id}`가 **404 → 500**이 된다. 이 주소로 가는 링크는 없고(메가메뉴의 그룹 제목은 링크가 아님, 광고는 항목 id), 창이 T2 배포까지(수십 분)라 **허용**한다. T1 확인 항목에 '그룹 id 주소 500은 예상된 동작'으로 적고, T2 배포 뒤 같은 주소가 200(depth1 페이지)인지 확인한다. 단, 이 창에서 예전 관리자 화면으로 항목을 추가하면 depth가 null이라 insert가 **눈에 보이게 실패**하고, 그룹을 추가하면 새 트리에 반영되지 않는다 → **T1~T2 사이에는 관리자 카테고리 편집 금지**(사용자에게 알리고, T2 배포 직후 3.6의 Q-6 쿼리로 확인). 예전 코드로 상품이 연결된 항목을 삭제하면 이제 23503 오류가 난다(조용히 풀리지 않으므로 허용).

### 3.3 순환 방지와 depth 정합성 근거
- 부모는 자식보다 먼저 존재해야 하고(FK), 자식 depth = 부모 depth + 1(트리거), parent_id·depth는 이후 바뀌지 않는다(트리거). 자기 자신을 부모로 두려면 depth = depth + 1이어야 하므로 불가능하다. 따라서 순환과 depth 불일치는 생길 수 없다.
- 같은 과목 부모만 허용: 복합 FK가 (parent_id, workspace_subject) 쌍을 확인한다. parent_id가 null이면 MATCH SIMPLE이라 확인하지 않는다(depth1).
- depth 6: check 제약이 거부한다(부모 depth5 + 1 = 6). API는 그 전에 400으로 막는다(4.4).

### 3.4 축소 마이그레이션 M2(T3) — `supabase/migrations/<ts>_market_category_tree_contract.sql`

선행: T2 배포 완료 + T2 확인 통과. 배포 코드가 그룹 테이블·카테고리 group_id를 읽지 않는지 **자동 게이트 grep 두 개가 모두 0건**이어야 한다(`market_menu_entries.group_id`를 쓰는 `src/lib/market-board-server.ts`는 S4까지 남으므로 `src` 전체 `group_id` grep은 쓰지 않는다):
```bash
grep -rn "market_category_groups" src --include=*.ts --include=*.tsx --exclude=supabase.ts   # 0건 (생성 타입 src/types/supabase.ts는 T3 뒤 재생성 전이라 제외)
grep -rn "group_id" src/lib/market-categories-server.ts src/app/api/admin/market-categories "src/app/(admin)/admin/market-categories" "src/app/(admin)/admin/market/products" src/components/admin/market-category-tree-editor.tsx   # 0건
```

1. 안전 확인 DO 블록(그룹 테이블이 있을 때만). T2 배포 뒤 새 노드 API로 만든 행은 `group_id`가 null이고, 새 코드로 지운 depth1에 대응하는 그룹 행은 남아 있을 수 있다. 그래서 검사 범위를 **옛 구조에서 온 행**으로 좁힌다:
   - `exists (select 1 from market_category_items where group_id is not null and (depth <> 2 or parent_id is distinct from group_id))` → `raise exception`(옛 항목의 이관 값이 깨짐).
   - `exists (select 1 from market_category_items c join market_category_items p on p.id = c.parent_id where c.depth = 2 and p.depth <> 1)` 또는 `exists (select 1 from market_category_items where depth = 2 and parent_id is null)` → `raise exception`(모든 depth2의 부모가 depth1인지 — group_id 유무와 무관).
   - depth1 행이 없는 그룹(T2 이후 관리자가 의도적으로 지운 칸)은 **`raise notice`로 id만 남기고 진행**한다. 그 그룹 행은 3번에서 테이블과 함께 사라진다. 이 id 목록이 3.6 Q-2(T3 기준)의 '의도적으로 삭제됨'과 맞는지 대조한다.
2. group_id 컬럼이 있으면: `drop constraint if exists market_category_items_group_id_fkey`, `drop index if exists market_category_items_group_id_idx`, `drop column group_id`.
3. `drop table if exists public.market_category_groups;`(트리거·정책 함께 삭제) / `drop function if exists public.set_market_category_groups_updated_at();`
4. 적용 후 `src/types/supabase.ts` 재생성(Supabase MCP `generate_typescript_types` 또는 `supabase gen types typescript --project-id kzcweelnzhcmiuvjgeyi`). 재생성 결과에 `market_category_groups` 없음, `market_category_items`에 `parent_id`·`depth` 있음, Relationships에 자기참조 FK.

### 3.5 market_items 참조 전환
- `market_items.category_item_id` 컬럼·FK 이름은 그대로다. 값은 M1·M2에서 바뀌지 않는다(144개 그대로). 재배치는 T4 스크립트에서만 한다.
- 연결 구문 `category_item:market_category_items(default_image:market_images(...))`는 market_items → 트리 테이블 FK가 하나뿐이라 모호하지 않다. 트리 안에서 부모를 연결 구문으로 읽지 않는다(자기참조 FK가 생기면 `!fk이름` 힌트가 필요해짐) → 트리는 항상 메모리에서 조립한다.

### 3.6 검증 쿼리(T1·T3 실행 전후)

| ID | 쿼리(요지) | 기대값 |
|---|---|---|
| Q-1 | 실행 **전** 백업: 읽기 전용 스크립트로 `market_category_groups`, `market_category_items`, `market_items(id, category_item_id, workspace_subject)`를 JSON으로 저장. 위치는 **영속 경로 `~/backups/create_quiz_ai/<YYYY-MM-DD>-T1/`**(저장소 밖. scratchpad `/private/tmp`는 세션 종료·재부팅 때 사라질 수 있어 쓰지 않는다). 같은 폴더에 파일이 이미 있으면 덮어쓰지 않고 중단 | 파일 3개 |
| Q-2 | `select id from market_category_items where workspace_subject='korean' and depth=1 order by id` vs 백업 그룹 id | **T1 직후**: 5개 완전 일치. **T3 시점**: 백업 그룹 id 5개가 모두 존재하거나, 없는 것은 T2 이후 관리자가 의도적으로 삭제한 것(3.4-1의 notice 목록·사용자 확인과 일치). 백업에 없는 depth1 행은 T2 이후 새로 만든 칸으로 허용 |
| Q-3 | `select id, parent_id, title, sort_order, is_active, created_at from market_category_items where depth=2` vs 백업 항목 (id, group_id, title, sort_order, is_active, created_at) | **T1 직후**: 32행 완전 일치(`updated_at`은 M1 4번 UPDATE로 적용 시각이 되므로 비교하지 않음 — 3.2-4). **T3 시점**: 백업 32행이 (id, parent_id = 백업 group_id)로 모두 존재하거나 의도적으로 삭제됨. 추가 행은 T2 이후 생성분(group_id null)으로 허용 |
| Q-4 | `select id, depth from market_category_items where id in ('b4a73b79-5b84-4129-bfc5-a3da72f827b2','4137f03c-e938-482c-bdc6-c45f314c7fd7')` | 2행, 둘 다 depth 2 |
| Q-5 | `select count(*) from market_items where category_item_id is not null` + 백업과 (id, category_item_id) 전부 비교 | 144, 차이 0 |
| Q-6 | `select count(*) from market_category_items where depth is null` | 0 |
| Q-7 | `select conname, confdeltype from pg_constraint where conname in ('market_items_category_item_subject_fkey','market_category_items_parent_subject_fkey')` | 둘 다 `r` |
| Q-8 | (T3 후) `select to_regclass('public.market_category_groups')`, group_id 컬럼 존재 여부 | null, 없음 |
| Q-9 | 같은 마이그레이션 SQL을 **`execute_sql`로** 한 번 더 실행(`apply_migration` 재호출 금지 — 이력 중복). **M1은 적용 직후·T2 배포 전에만**(3.2-4) | 오류 없음, `schema_migrations` 행 증가 0, depth1·depth2 행 수 변화 0 |
| Q-10 | `select version, name from supabase_migrations.schema_migrations where name = '<이름>'` → 로컬 파일명 변경 | 로컬 파일명 version = 조회 version, 이력 행 +1 |
| Q-11 | 3.2 적용 절차의 객체 체크리스트 대조(M1: parent_id·depth 컬럼, group_id nullable, 제약 3개, 인덱스 1개, 트리거·함수, 상품 FK `confdeltype='r'`, 정책 1개, depth1 행 5) | 성공이면 전부 반영 |
| Q-12 | (T3 직전, S2·S4 확인 끝) `select id, title, depth from market_category_items where title like 'zz-테스트%'` | 0행(B-3·B-5·B-7에서 만든 테스트 칸이 모두 지워짐) |
| Q-13 | (S2·S4 확인 끝) `select count(*) from market_items where title like 'zz-테스트%'` | 0(테스트 상품을 관리자 DELETE로 hard delete — 8.8·8.10) |

### 3.7 SQL 테스트
- **신규** `supabase/tests/market_category_tree.test.sql`(기존 `market_images.test.sql` 방식: `begin … rollback`, DO 블록 assert, 고정 fixture UUID 접두):
  - depth 6 insert 거부(23514 — check 제약), depth1인데 parent 있는 insert 거부(23514 — check 제약), 다른 과목 부모 insert 거부(**23503** — depth는 부모+1로 맞춰 넣어 트리거를 통과시키고 복합 FK가 거부하는 것을 확인, 3.2-9), 부모 depth와 맞지 않는 insert 거부(23514 — 트리거)
  - parent_id·depth·workspace_subject UPDATE 거부
  - 상품이 연결된 노드 DELETE → 23503, 자식이 있는 노드 DELETE → 23503
  - 상품·자식 없는 leaf DELETE 성공
- **수정** `supabase/tests/market_images.test.sql`: `market_category_groups` insert 제거, 카테고리 fixture를 depth1(c0, parent null) + depth2(c1, parent c0, 기본 이미지 03)로 바꾼다. IN_USE 응답의 `categoryItems` 키 검증은 그대로.
  - **depth1 케이스 추가(R14)**: 기존 픽스처의 이미지 04(`1a6e0000-0000-4000-8000-000000000004`)는 '미사용' 이미지로 333·353·407·409행의 삭제 케이스가 쓰므로 **건드리지 않는다**. 새 이미지 **05(`1a6e0000-0000-4000-8000-000000000005`)**를 픽스처에 추가해 **depth1(c0)의 `default_image_id`**에 건 뒤 `delete_market_image(05)`가 `{ok:false, code:'IN_USE'}`이고 `categoryItems`에 c0 id가 들어 있는지 DO 블록으로 확인한다. 이어서 c0의 기본 이미지를 null로 풀면 `delete_market_image(05)`가 성공하는지도 확인한다. 파일 머리 주석(11행 이미지 목록)에 05를 추가한다.
- 실행: MCP `execute_sql`에 파일 본문(`begin … rollback` 포함)을 그대로 넣는다(3.2 적용 절차). 사용자가 PG* 환경변수를 주면 `psql -X -v ON_ERROR_STOP=1 -f <file>`도 가능. 운영 DB에서 돌지만 전부 rollback된다. **실행 전 사용자 승인**.

### 3.8 롤백
- **롤백 공통 사전 확인(상품 연결 보호 — D3 '조용히 미지정으로 풀리지 않음')**: T1·T3 롤백과 T2 코드 revert 전에 반드시 실행한다. T2 배포 뒤에는 상품을 depth1 칸이나 T2 이후 새로 만든 칸에도 연결할 수 있기 때문이다(D2, 8.5-8 최소 호환 select, `getMarketCategoryItemWorkspaceSubject`는 depth1 id도 받음).
  - 확인 A: `select count(*) from market_items where category_item_id in (select id from market_category_items where depth <> 2 or group_id is null)` (T3 롤백 때는 group_id 컬럼이 없으므로 `where depth <> 2`). **0이 아니면 중단**하고 `select id, title, category_item_id from market_items where …` 목록을 사용자에게 보여 준 뒤 각 상품을 어느 depth2 칸으로 옮길지 **승인**을 받는다. 승인된 이동은 관리자 화면(또는 승인된 일회성 SQL)으로 하고, 다시 확인 A가 0이 될 때까지 진행하지 않는다. (group_id null인 depth2에 연결된 상품은 아래 5번에서 보존되지만, 예전 코드로 되돌리는 순간부터 5번까지 카테고리 화면에서 사라지므로 같은 목록에 넣어 사용자가 판단하게 한다.)
  - 확인 B(롤백 직전 스냅샷): `select id, category_item_id from market_items where category_item_id is not null order by id`와 그 개수를 `~/backups/create_quiz_ai/<날짜>-<T1|T3>-rollback/items-before.json`에 저장한다(있으면 덮어쓰지 않음).
- **T1 롤백**(T3 전, group_id·그룹 테이블이 남아 있음): 롤백 SQL(구현 때 `supabase/rollback/` 아닌 저장소 밖 `~/backups/create_quiz_ai/<날짜>-T1/rollback.sql`로 준비). T2 배포 뒤 새 코드로 만든 칸(group_id null)과 고친 depth1 값을 옛 구조로 먼저 되돌려야 `group_id set not null`과 group_id FK가 성립한다. dry-run(`execute_sql`로 `begin; <rollback.sql>; <8번 확인 DO 블록>; rollback;`) → 승인 → 실행 → 8번 확인. 순서:
  0. 위 **롤백 공통 사전 확인 A·B**(A = 0이어야 진행).
  1. 앱 코드를 T2 이전 커밋으로 되돌리고 배포(3.9 매트릭스 — T4가 끝났으면 7.5 먼저).
  2. depth3 이상 행을 **depth 5 → 4 → 3 순서로 한 문장씩** 지운다(자식 FK가 `on delete restrict`라 즉시 검사되므로 한 문장으로 부모·자식을 함께 지우면 실패할 수 있다). T4 전이면 0행, T4 후면 7.5로 이미 0행이어야 한다. 상품이 연결돼 있으면 restrict로 실패하고 중단.
  3. T2 이후 만든 depth1을 그룹 테이블로 옮긴다: `insert into market_category_groups (id, workspace_subject, title, sort_order, is_active, created_at, updated_at) select id, workspace_subject, title, sort_order, is_active, created_at, updated_at from market_category_items where depth = 1 on conflict (id) do nothing`.
  4. T2 이후 고친 depth1 값(제목·정렬·활성)을 그룹 행에 반영: `update market_category_groups g set title = c.title, sort_order = c.sort_order, is_active = c.is_active from market_category_items c where c.id = g.id and c.depth = 1`.
  5. T2 이후 만든 depth2를 옛 구조로: `update market_category_items set group_id = parent_id where depth = 2 and group_id is null`.
  6. 트리거·함수 drop → 상품 FK를 `on delete set null (category_item_id)`로 되돌림 → 자기참조 FK·check 제약·인덱스 drop.
  7. 안전 가드 DO 블록: `exists (select 1 from market_items where category_item_id in (select id from market_category_items where depth = 1))`면 `raise exception`(6번에서 FK가 `set null`로 바뀌었으므로 이 가드 없이 지우면 상품이 조용히 미지정이 된다). 통과하면 `delete from market_category_items where depth = 1` → parent_id·depth 컬럼 drop → `alter column group_id set not null`.
  8. 확인: `select count(*) from market_category_items where group_id is null` = 0, 그룹 수 = 롤백 전 depth1 수, 백업(Q-1)과 비교해 T2 이후 의도적 변경 외 차이 0. **상품 연결 비교**: `select id, category_item_id from market_items where category_item_id is not null`의 개수와 (id, category_item_id) 목록이 사전 확인 B의 스냅샷과 **차이 0**.
- **T3 롤백**: T3이 지운 객체를 되살려 **'T1 적용 직후(T2 이후 변경 포함) 상태'**로 돌린 뒤, 필요하면 이어서 T1 롤백으로 간다. depth3 이상 노드가 있으면(T4 이후) 먼저 7.5로 T4를 되돌린다. 롤백 SQL은 `~/backups/create_quiz_ai/<날짜>-T3/rollback.sql`로 준비하고 M1·M2와 같은 절차를 따른다: **위 롤백 공통 사전 확인 A(`depth <> 2`)·B → dry-run(`execute_sql`로 `begin; <rollback.sql>; <확인 DO 블록>; rollback;`) → 사용자 승인 → 실행 → 검증 쿼리**. 다시 만들 객체 목록(원본은 `20260902045933_create_market_category_menu.sql`):
  1. 테이블 `public.market_category_groups`(id uuid pk default gen_random_uuid(), workspace_subject text not null check in ('english','korean'), title text not null, sort_order integer not null default 0, is_active boolean not null default true, created_at/updated_at timestamptz not null default now()) — 원본 DDL 그대로.
  2. 함수 `public.set_market_category_groups_updated_at()`(plpgsql, `set search_path = public, pg_temp`)와 같은 이름의 BEFORE UPDATE 트리거.
  3. RLS: `enable row level security`, `revoke all … from anon, authenticated`, `grant select … to anon, authenticated`, 정책 "Active market category groups are publicly readable"(`for select using (is_active)`).
  4. 데이터: `insert into market_category_groups (id, workspace_subject, title, sort_order, is_active, created_at, updated_at) select … from market_category_items where depth = 1`.
  5. `market_category_items.group_id uuid` 컬럼(nullable로 추가) → `update … set group_id = parent_id where depth = 2` → FK `market_category_items_group_id_fkey foreign key (group_id) references market_category_groups(id) on delete cascade` → 인덱스 `market_category_items_group_id_idx (group_id)`. `group_id`는 depth1 행이 남아 있는 동안 nullable로 둔다(T1 롤백 7번에서 `set not null`).
  - 확인 쿼리(Q-11 방식 객체 체크리스트): `to_regclass('public.market_category_groups')` not null, 그룹 행 수 = depth1 행 수, `pg_trigger`에 그룹 updated_at 트리거, `pg_policies`에 그룹 정책, `has_table_privilege('anon', 'public.market_category_groups', 'select')` 참·`insert` 거짓, `pg_constraint`에 `market_category_items_group_id_fkey`(`confdeltype = 'c'`), `pg_indexes`에 `market_category_items_group_id_idx`, `select count(*) from market_category_items where depth = 2 and group_id is distinct from parent_id` = 0, 상품 연결 스냅샷(확인 B) 차이 0. 이 상태는 3.2 M1 적용 직후와 같은 모양이므로 3.9의 T2 revert 조건을 만족한다.
- 원칙적으로 T3은 T2가 운영에서 하루 이상 문제없이 돈 뒤에 실행해, 롤백할 일이 생기지 않게 한다.
- **T4 롤백**: 7.5 참고.

### 3.9 단계별 되돌리기 가능 조건(롤백 매트릭스)

코드 되돌리기(git revert 또는 Vercel Instant Rollback — **둘 다 같은 제약**을 받는다)는 DB가 그 코드가 기대하는 모양일 때만 안전하다. 뒤 단계의 DB 변경이 이미 적용돼 있으면 **DB를 역순으로 먼저 되돌린 뒤** 코드를 되돌린다.

**S0 커밋 이전 배포로 가는 모든 revert·Instant Rollback**(아래 어느 행에서든 결과적으로 S0까지 함께 되돌려지는 경우 — 예: S1·T2 문제로 S0 이전 배포를 골라 Instant Rollback)은 S0 행의 사전 조회(5.4 '되돌리기' — 저장 금지 공지, 조회, 배포 직후 재조회)를 함께 따른다.

| 지금 상태(마지막 완료 단계) | T2 코드(트리 코드) 되돌리기 | 이유 | 필요한 순서 |
|---|---|---|---|
| S0 이후(메인 관리 '문제마켓 카테고리' 설정 삭제 커밋, 5.4) | S0 커밋만 revert(또는 Instant Rollback) **조건부 가능** — `market_home` 행이 0건일 때만 그대로 | S0 뒤 관리자가 메인 관리에서 저장하면 `categories` 없는 `market_home` 행이 생긴다. S0 이전 코드의 엄격한 `validateMarketHomeConfig`는 `isRecord(categories)` 실패로 throw하고, `normalizeMarketHomeConfig`가 popular·recent까지 **설정 전체를 기본값으로** 바꾼다(공개 홈 인기·최근 개수·집계 기간이 바뀌고, 예전 관리자 화면이 기본값을 보여 준 채 저장하면 실제 저장값도 덮어씀) | 5.4 '되돌리기': revert 배포 완료까지 메인 관리 저장 금지 공지 → 읽기 전용 조회 → 0건이면 revert, 1건 이상이면 forward-fix 또는 승인된 일회성 update 뒤 revert → **배포 직후 같은 조회 재실행**(1건 이상이면 그 자리에서 승인된 update) |
| T1만 | 해당 없음(T2 전) | | 3.8 T1 롤백 |
| T2 | **조건부 가능**(3.8 롤백 공통 사전 확인 A = 0일 때) | M1이 남아 있어도 예전 코드가 동작(3.2 호환). 단 T2 이후 만든 칸(group_id null)은 예전 화면에 안 보이고, depth1 칸이나 T2 이후 만든 칸에 연결된 상품은 예전 코드의 카테고리 페이지·개수에서 사라지며 depth1 id 주소는 500이 된다 | 사전 확인 A·B → (A ≠ 0이면 사용자 승인 아래 depth2로 이동) → T2 revert → (필요하면) 3.8 T1 롤백 |
| T2 + T4 | **바로는 불가** | 예전 코드는 `.eq('category_item_id', id)`로 조회하고 group_id 없는 depth3·4를 무시 → 상품 144개가 카테고리 페이지에서 사라지고 광고 두 링크가 0개 | **7.5(T4 롤백) → T2 revert** |
| T2 + T3 | **바로는 불가** | 예전 코드가 drop된 `market_category_groups`를 읽어 메가메뉴·카테고리 페이지·관리자 화면 오류 | **3.8 T3 롤백 → T2 revert** |
| T2 + T3 + T4 | **바로는 불가** | 위 두 가지 모두 | **7.5 → 3.8 T3 롤백 → T2 revert** |
| S2 이후 | S2 코드만 revert 가능(DB 변경 없음) | | S2 revert. T2까지 되돌리려면 위 표를 따른다 |
| S3 이후 | S3 revert는 M3 되돌리기와 함께 | 8.9 | 코드 revert + M3 되돌리기 |
| S4 이후 | 8.10 | null 상품이 있으면 M4 되돌리기 전에 기본 게시판으로 채움 | |

S1의 코드 revert는 어느 시점이든 DB와 무관하다(트리 단계 이후라면 S1만 단독 revert하지 않고 그 뒤 단계부터 역순으로).

---

## 4. 서버 로직

### 4.1 공개 트리 조회 — `src/lib/market-categories-server.ts`

```ts
// src/lib/market-category-tree.ts (신규, import 없음 — 서버·클라이언트·테스트 하네스 어디서든 쓸 수 있는 순수 함수)
export interface MarketCategoryNode { id: string; title: string; depth: number; itemCount?: number; children: MarketCategoryNode[] }
export type MarketCategoryTree = Record<'english' | 'korean', MarketCategoryNode[]>
export function buildCategoryTree(rows: { id: string; parent_id: string | null; depth: number; title: string; sort_order: number; created_at: string; workspace_subject: string }[]): MarketCategoryTree
export function toMegaMenuTree(tree: MarketCategoryTree, maxDepth = 2): MarketCategoryTree
export function findCategoryPath(nodes: MarketCategoryNode[], id: string): MarketCategoryNode[] | null // 조상→자신
export function collectSubtreeIds(node: MarketCategoryNode): string[]

// src/lib/market-categories-server.ts
export async function listMarketCategoryTree(includeCounts = false): Promise<MarketCategoryTree>
```
- 순수 함수를 `server-only`가 붙은 `market-categories-server.ts`에서 떼어 두는 이유: 상품 관리 client·공용 편집기·메가메뉴(클라이언트)와 S3의 `market-search-server`가 같은 함수를 import할 수 있게 하고, 고정 mocks로 서버 모듈을 불러오는 테스트에서 의존이 하나(`'@/lib/market-category-tree': load('src/lib/market-category-tree.ts')`)만 늘게 하기 위해서다. `category-pagination-server` 하네스는 mocks에 없는 import를 `Unexpected import`로 거부하므로(72행) 이 키를 추가한다. `market-categories-server`를 load하는 다른 테스트(`market-images-admin-wiring` 201행, 신규 node-api 테스트)도 같은 키를 넣는다(8.5).

- 노드: `market_category_items`에서 `is_active = true`인 행 전체를 **한 쿼리**로 읽는다(`id, workspace_subject, parent_id, depth, title, sort_order, created_at`, sort_order → created_at 정렬). 과목별 100행 미만.
- 조립: id → 노드 맵을 만들고, 부모가 활성 집합에 없는 노드(조상 중 비활성이 있는 노드)는 붙이지 않는다 → 그 아래 전체가 사라진다. 정렬은 메모리에서 sort_order(숫자) → created_at으로 다시 한다(테스트 하네스의 order가 문자열 비교라서).
- 활성 자식이 없는 depth1도 표시한다(이제 자기 페이지가 있음). 예전의 "항목 없는 그룹 제외"는 없앤다.
- `MegaMenuGroup`/`MarketCategoryMenu`/`listMarketCategoryMenu`는 T2에서 제거하고 사용처를 모두 새 타입으로 바꾼다.

### 4.2 하위 합산 개수(N회 count 금지)
- `includeCounts`면 공개 상품의 `category_item_id`를 `readAllQueryRows`로 **한 번에** 읽는다: `market_items.select('id, category_item_id, workspace_subject').eq('status','published').eq('is_active',true).is('deleted_at',null).in('menu_entry_id', visibleMenuIds).order('id').range(from, to)`. `category_item_id`가 null인 행은 메모리에서 뺀다(`.not()`은 테스트 하네스가 지원하지 않음). **S3 전까지**는 지금처럼 과목별 노출 게시판 id(`market_menu_entries` 1쿼리)를 먼저 읽는다. S3에서 이 조건을 뺀다.
- 메모리에서 id → 직접 개수 맵을 만들고, 후위 순회로 `itemCount = 자기 직접 개수 + Σ children.itemCount`.
- 쿼리 수: 노드 1 + 게시판 1(S3 전) + 상품 ⌈행수/페이지⌉(146행 → 1). 노드 수와 무관하다. 지금은 메뉴 2 + 항목당 count 32회다.
- 개수 계산 실패 시 메가메뉴 API는 지금처럼 개수 없이 다시 읽는다(4.6).

### 4.3 캐시 — `src/lib/market-category-tree-cache.ts`(S1에서 신설, T2에서 갱신)
- `market-categories-server.ts`는 테스트 하네스가 변환·로드하므로 `next/cache`를 넣지 않는다. 캐시는 별도 모듈에 둔다.
- S1: 지금 `categories/[id]/page.tsx:21`의 `getCachedCategoryMenu`(키 `'category-menu-with-counts'`, revalidate 60)를 이 모듈로 옮기고, 카테고리 페이지와 새 상세 페이지가 함께 쓴다. 형태가 같으므로 키는 그대로.
- T2: 두 캐시를 둔다(둘 다 같은 태그라 관리자 변경 때 함께 무효화된다).
  - `getCachedCategoryTree = unstable_cache(() => listMarketCategoryTree(true), ['category-tree-with-counts'], { revalidate: 60, tags: [MARKET_CATEGORY_TREE_CACHE_TAG] })` — 개수 포함(사이드바·DetailFinder·상세 경로). 키를 바꿔 배포 직후 옛 형태 캐시를 읽지 않게 한다.
  - `getCachedCategoryNodes = unstable_cache(() => listMarketCategoryTree(false), ['category-tree-nodes'], { revalidate: 60, tags: [MARKET_CATEGORY_TREE_CACHE_TAG] })` — 개수 없음, 미스 때 활성 노드 1쿼리. 카테고리 페이지의 노드 존재 확인(layout 404)과 `detail`(subtreeIds·조상) 계산에 쓴다. 캐시 미스 때 개수 계산(노드·게시판·상품 readAll)을 기다리지 않고 목록 조회를 시작하기 위해서다(6.2).
- **태그 상수 위치**: `export const MARKET_CATEGORY_TREE_CACHE_TAG = 'market-category-tree'`는 캐시 모듈이 아니라 **의존성 없는 `src/lib/market-images.ts`의 `MARKET_PUBLIC_LIST_CACHE_TAG` 옆**에 둔다. 상품·노드 라우트가 캐시 모듈을 import하면 `next/cache`·`market-categories-server`까지 끌려와, `loadRoute`로 상품 라우트를 부르는 테스트(`market-images-display` 136·153행, `market-images-admin-wiring` 145행)의 mocks 키를 늘려야 한다. `market-images.ts`는 하네스의 공통 mocks(`'@/lib/market-images': marketImages`)에 이미 있으므로 mocks 변경이 없다. 캐시 모듈은 이 상수를 `market-images.ts`에서 import한다.
- 무효화: 관리자 노드 POST/PATCH/DELETE 성공 시 `revalidateTag(MARKET_CATEGORY_TREE_CACHE_TAG, { expire: 0 })` + `revalidateTag(MARKET_PUBLIC_LIST_CACHE_TAG, { expire: 0 })`(항상 2회). 관리자 상품 라우트:
  - PATCH: 지금 `MARKET_PUBLIC_LIST_CACHE_TAG`를 부르는 자리(`[id]/route.ts:182`) 옆에서, **카테고리가 바뀌었거나 공개 상태(status·is_active)가 바뀌었을 때** 트리 태그도 무효화한다. 이미지만 바뀌면 목록 태그 1회, 카테고리가 바뀌면 목록+트리 2회, 변화 없으면 0회.
  - POST: published로 만들 때 트리 태그 1회 추가(이미지 지정 시 목록 태그는 지금처럼).
  - **DELETE(`[id]/route.ts:203`, hard delete)**: 상품이 사라지면 개수가 바뀌므로 성공 시 트리 태그 + 목록 태그를 무효화하도록 **추가**한다(지금은 둘 다 없음).
  - 테스트 영향: `market-images-display`의 `revalidations.length` 기대값 표를 위 규칙으로 갱신한다(카테고리 변경 행 `1 → 2`, 이미지만 바뀐 행 1 유지). 153행의 항목 라우트 케이스는 노드 라우트(`[nodeId]/route.ts`)로 옮기고 `[{ default_image_id }, 2], [{ title }, 2]`로 바꾼다. DELETE 케이스(2회)를 새로 넣는다. **64행의 라우트 경로 목록**(`revalidateTag(MARKET_PUBLIC_LIST_CACHE_TAG…)` 정규식 대상)에 있는 `src/app/api/admin/market-categories/items/[itemId]/route.ts`는 T2에서 파일이 지워지면 `readFileSync` ENOENT로 깨지므로 `src/app/api/admin/market-categories/[nodeId]/route.ts`로 바꾼다. (133행 `[IMAGE_ID, IMAGE_ID, 1, null]` 카테고리 null 케이스는 S2에서 바뀐다 — 8.8.)

### 4.4 상세(노드) 조회와 카테고리 상품 목록
- `getMarketCategoryNodeDetail(id, tree?)` → `{ id, title, depth, workspaceSubject, ancestors: {id,title}[], children: {id,title,itemCount?}[], siblings, subtreeIds: string[] } | null`. UUID 형식이 아니거나, 노드가 없거나, 자기·조상 중 비활성이면 null(공개 트리에 없으면 null).
  - 카테고리 페이지는 캐시된 노드 트리(`getCachedCategoryNodes`, 4.3)를 넘겨 **추가 쿼리 없이** 메모리에서 찾는다. 트리를 안 넘기면 활성 노드 1쿼리로 조립한다.
- `listMarketItemsForCategory(categoryId, filters, knownDetail)`: `.eq('category_item_id', id)` → `.in('category_item_id', detail.subtreeIds)`. 나머지(정렬·페이지·검색어·보강 조회)는 그대로. 게시판 게이트·`matchingMenuIds`는 S3에서 제거.
- `getMarketCategoryItemWorkspaceSubject(id)`: 그대로(비활성 포함, 과목 검증용). 이름은 바꾸지 않는다(호출처 최소화).

### 4.5 관리자 트리와 삭제 차단
- `listMarketCategoryTreeForAdmin(subject)` → 재귀 `{ id, title, depth, sortOrder, isActive, defaultImage, productCount, deletedProductCount, children }`. 비활성 포함. `productCount`는 자기+하위에 연결된 상품 **행 수**(soft delete된 상품 포함 — DB restrict와 같은 기준), `deletedProductCount`는 그중 `deleted_at is not null`인 행 수 — 노드 1쿼리 + `market_items(category_item_id, deleted_at)` readAllQueryRows 1회.
- **입력 검증(라우트 zod)**: POST `/api/admin/market-categories` = `{ workspace_subject: z.enum(['english','korean']), parent_id: z.string().uuid().nullable(), title: z.string().trim().min(1).max(120), sort_order: z.number().int().optional() }`. PATCH `[nodeId]` = `{ title: z.string().trim().min(1).max(120).optional(), sort_order: z.number().int().optional(), is_active: z.boolean().optional(), default_image_id: z.string().uuid().nullable().optional() }`. 지금 groups/items 라우트의 `title 1~120` 제약을 그대로 옮긴 것이다. 실패는 400.
- `createCategoryNode({ workspaceSubject, parentId, title, sortOrder })`: parentId가 있으면 부모를 읽어 과목 일치·depth < 5를 확인, 아니면 400('depth5 아래에는 칸을 추가할 수 없습니다'). depth = 부모 depth + 1(없으면 1)로 insert.
- `updateCategoryNode(id, { title?, sortOrder?, isActive?, defaultImageId? })`: 기본 이미지 FK 23503 → 404(지금 `updateCategoryItem`과 같음).
- `deleteCategoryNode(id)`: ① 자기+하위 상품 행 수 > 0 → `MarketCategoryError(409, '연결된 상품이 있어 삭제할 수 없습니다. 비활성화하거나 상품을 옮긴 뒤 삭제해주세요.')`. 그중 삭제된 상품이 있으면 문구 뒤에 `(삭제된 상품 N개 포함)`을 붙인다 ② 자식이 있으면 409('하위 칸을 먼저 삭제해주세요.', Q3) ③ delete. DB에서 23503이 나면(확인과 삭제 사이 경합) **제약 이름으로 구분**한다(PostgREST 오류 `message`/`details`에 제약 이름이 들어 있다 — 제약 이름은 스키마 규칙이지 데이터가 아니므로 하드코딩 금지에 걸리지 않는다):
  - `market_items_category_item_subject_fkey` → ①의 상품 문구 409
  - `market_category_items_parent_subject_fkey` → ②의 '하위 칸을 먼저 삭제해주세요.' 409
  - 둘 다 아니면 409 '다른 데이터가 이 칸을 참조하고 있어 삭제할 수 없습니다.'
- **soft delete된 상품만 연결된 칸**: 관리자 상품 목록에는 삭제된 상품이 보이지 않아 '상품을 옮길' 수단이 화면에 없다. 지금 운영의 삭제된 상품은 0건(직접 확인)이라 이번 범위에서는 ①의 `(삭제된 상품 N개 포함)` 표시까지만 한다. 실제로 이런 칸이 생기면 **사용자 승인 뒤 일회성 스크립트**(dry-run으로 대상 (id, category_item_id) 목록 제시 → 승인 → 삭제된 상품의 `category_item_id`를 같은 과목의 다른 칸으로 옮김 → 검증)로 정리하거나 후속 작업으로 넘긴다(10절).
- 그룹·항목 CRUD 함수 6개(`createCategoryGroup` 등)와 `AdminCategoryGroup` 타입은 제거한다(제거 시점은 8.5 커밋 순서).
- **광고 연결 경고는 이번 계획에 넣지 않는다(Q14, 기본값 '넣지 않음')**. 요구사항·사용자 결정에 없는 기능이기 때문이다(메인 관리 설정은 Q8 결정으로 S0에서 '문제마켓 카테고리' 설정을 삭제하므로 칸을 가리키지 않아 경고 대상이 아니다). 사용자가 Q14에서 넣기로 승인하면 그때 착수하며, 추가 작업은 다음과 같다: 관리자 GET 라우트가 `getMainAdCarouselConfig()`(`src/lib/main-ad-carousel-server.ts:72`)로 광고 `href`에서 `/categories/{uuid}` id를 규칙으로 뽑아 `listMarketCategoryTreeForAdmin(subject, { linkedIds })`에 넘기고 노드에 `linkedFrom`을 붙인다. 편집기는 배지와 비활성·삭제 전 confirm을 띄운다. 신규 node-api 테스트의 `loadRoute` mocks에 `'@/lib/main-ad-carousel-server': { getMainAdCarouselConfig: async () => (…) }`를 추가한다.

### 4.6 공개 메가메뉴 API — `src/app/api/market/category-menu/route.ts`
- `toMegaMenuTree(await listMarketCategoryTree(true), 2)`를 반환. 실패 시 `console.error` 후 `toMegaMenuTree(await listMarketCategoryTree(), 2)`(개수 없음) — 지금의 try/catch 폴백 구조 유지.
- `Cache-Control: public, max-age=60, s-maxage=60`, `force-dynamic` 유지. depth2의 `itemCount`는 하위 합산(잘라내기 전에 계산하므로 자동).

### 4.7 관리자 상품 저장 검증(S2) — `src/lib/market-items-server.ts`, 상품 API
- **순서 고정**: (2a) `createMarketItem`의 workspace_subject를 게시판이 아니라 **카테고리 과목**(`getMarketCategoryItemWorkspaceSubject(categoryItemId)`)에서 정하고, 요청의 과목(`?subject=`)이 있으면 일치를 확인한다 → (2b) 그 다음에 `menuEntryId`를 선택값으로 바꾼다.
- POST: `categoryItemId: z.string().uuid()`(필수). 카테고리가 없거나 다른 과목이면 400('상품과 같은 과목의 카테고리를 선택해주세요.'). 비활성 카테고리는 허용하되 관리자 화면에 '(비활성)'으로 보인다.
- PATCH: `categoryItemId`는 `z.string().uuid().optional()` — **null 해제 거부**(Q6 권장). 바뀌면 같은 과목 검증. 클라이언트는 `menuEntryId`를 보내지 않는다(서버 스키마에는 S4까지 optional로 남김).
- 기본 게시판 규칙(코드에는 규칙만, ID 리터럴 없음): `market_menu_entries where workspace_subject = :subject and is_active and is_visible and deleted_at is null order by sort_order, created_at limit 1`. 없으면 400('기본 게시판이 없습니다'). `is_visible`을 넣는 이유: S3 전까지는 게시판 게이트가 살아 있어 숨김 게시판에 넣으면 공개 화면에서 사라진다. S4에서 이 규칙을 지우고 null로 저장한다.
- GET `?categoryId=`: 관리자 트리에서 하위 id를 구해 `listMarketItemsForAdmin({ categoryIds })`로 `.in('category_item_id', ids)`. 기존 `?menuEntryId=` 필터는 S2에서 제거(클라이언트가 더 안 씀).

---

## 5. 관리자 화면

### 5.1 공용 트리 편집기 — `src/components/admin/market-category-tree-editor.tsx`(신규, client)
- props: `{ subject: WorkspaceSubject; onTreeChange?: (tree: AdminCategoryNode[]) => void }`. 스스로 `GET /api/admin/market-categories?subject=`를 읽고, 저장 성공마다 다시 읽어 `onTreeChange`로 알린다.
- 표시: 재귀 목록(들여쓰기 + 접기/펼치기), 각 행에 depth 배지(`depth1`~`depth5`), 제목 입력, 정렬 숫자, 활성 토글, 하위 상품 수(`상품 N`), 기본 이미지(`MarketImageField`, 모든 depth), '새 탭 열기' `/categories/{id}?subject={subject}`, [하위 추가](depth5에서는 렌더하지 않음), [삭제].
- 최상단 [depth1 추가]. 영어처럼 빈 트리면 빈 상태 안내 + [depth1 추가].
- 삭제: confirm 문구는 '이 칸을 삭제할까요?'만. 409면 서버 안내 문구를 그대로 보여 주고 트리를 다시 읽지 않는다(변화 없음). 기존 '연결된 상품은 카테고리 미지정으로 풀립니다' 문구는 제거.
- 광고 링크 경고 배지·confirm은 넣지 않는다(4.5, Q14 승인 시에만).
- 편집 중 초안 병합: 지금 `loadGroups(resetId)`의 동작(저장한 행만 서버 값으로 갱신, 나머지 행의 편집 중 값 유지)을 노드 id 기준으로 옮긴다.
- 용어: 화면 문구에 '그룹', '항목', '2단계', '3단계'를 쓰지 않는다. 안내 예: "depth1~depth5까지 칸을 만들 수 있습니다. 상품은 어느 칸에든 연결할 수 있고, 위 칸 페이지에는 아래 칸 상품이 모두 보입니다."

### 5.2 '카테고리 메뉴 관리' 화면
- `src/app/(admin)/admin/market-categories/page.tsx`: 과목별 화면(`?subject=`) 유지. 안내 문구를 depth 용어로 바꾼다.
- `market-categories-client.tsx`: 그룹 표·항목 표를 지우고 `<MarketCategoryTreeEditor subject={subject} />`만 렌더한다(파일을 남기면 얇은 래퍼, 필요 없으면 page에서 직접 렌더 — 구현 때 더 작은 쪽).

### 5.3 상품 관리 화면 — `market-products-client.tsx`, `page.tsx`(S2)
- **카테고리 선택칸(단계별)**: 라벨 '카테고리'(필수, `*`). depth1 select → 고른 칸에 자식이 있으면 다음 depth select가 나타나는 식으로 depth5까지. 아래 단계 select의 기본 옵션은 '(여기까지 선택)'. 저장 값은 가장 깊이 고른 칸. 위에 전체 경로('EBS > 수능특강 문학 변형문제 > 2부 적용학습')를 보여 준다. 비활성 칸은 '(비활성)' 표시.
- 고른 칸에 자식이 있으면 안내 '하위 칸이 있습니다. 하위 칸 선택을 권장합니다.'(저장은 가능).
- 미선택 저장 → 클라이언트에서 막고 '카테고리를 선택해주세요.' 표시(서버도 400). 생성 폼의 '미지정' 옵션 제거. 기존 미지정 상품(영어 2개)을 수정 저장할 때도 선택을 요구한다(Q6).
- **파일 업로드 초안 흐름**: 새 상품 폼에서 파일을 올리면 `ensureDraftItemForUpload`(`market-products-client.tsx:1081`, 호출 1406·1860행)가 POST로 draft 상품을 먼저 만든다. S2에서 POST의 `categoryItemId`가 필수가 되므로, **카테고리를 고르기 전에는 업로드를 막는다**: `ensureDraftItemForUpload`가 POST 전에 `form.categoryItemId`가 비어 있으면 '카테고리를 먼저 선택해주세요.'를 표시하고 업로드를 중단한다(업로드 입력도 카테고리 선택 전에는 비활성 + 같은 안내). draft에만 카테고리를 선택값으로 허용하는 방식은 서버 규칙이 둘로 갈라지고 카테고리 없는 draft가 남으므로 쓰지 않는다.
- 선택칸 옆 [카테고리 관리] → `@/components/ui/dialog`로 공용 편집기를 띄운다(`subject`는 폼의 과목). `onTreeChange`와 닫기 시점에 상품 화면의 트리 상태를 갱신 → 새로고침 없이 선택칸에 반영. 편집 중 선택한 칸이 삭제됐으면 선택을 비운다.
- `selectedCategoryDefaultImage`: 재귀 탐색(`findCategoryPath` 재사용 또는 클라이언트 동등 함수)으로 찾는다.
- **상단 필터**: '카테고리 선택' 카드의 게시판 select → 같은 단계별 선택(맨 위 옵션 '전체'). 서버 GET `?categoryId=`(하위 포함). **필터 변경 핸들러는 폼 상태를 건드리지 않는다**(지금은 폼의 `menuEntryId`까지 바꿔 저장 시 게시판이 옮겨지는 부작용).
- 표 '카테고리' 열: 카테고리 경로(없으면 '미지정').
- **게시판 정리**: 폼의 게시판 select('카테고리' 라벨)와 `form.menuEntryId`, `menuTitleMap`, `refreshItems(menuEntryId)`의 게시판 단위 조회를 없앤다. `page.tsx`는 `listMarketMenuEntriesForAdmin` 대신 관리자 카테고리 트리를 넘긴다. 업로드 초안 흐름의 `resetForm(result.menu_entry_id)`도 카테고리 기준으로 바꾼다.
- 서브상품 구성 종류의 '카테고리'/'서브상품 카테고리' 라벨은 **바꾸지 않는다**(범위 밖).

### 5.4 '(임시) 문제마켓 메인 관리'의 '문제마켓 카테고리' 설정 삭제(S0, 사용자 결정 Q8)
- 사용자 결정: 화면에 쓰이지 않는 설정이라 혼란을 막기 위해 **삭제**한다(대체하지 않음).
- 삭제해도 안전한 근거(2026-10-12 확인):
  - 공개 화면 사용처 없음: `market-home-server.ts`가 `categories`를 만들어 `HomeFinalCta`(`home-material-sections.tsx`)에 넘기지만, 컴포넌트가 `subject`·`itemCount`만 구조분해하고 `categories`는 렌더하지 않는다. 호출처는 `(solvook)/_components/solvook-home-view.tsx`, `preview/solvook-concept/page.tsx` 2곳.
  - 운영 저장값 없음: `workspace_settings`에 `setting_key = 'market_home'` 행이 0건(국어·영어 모두 기본값 사용). 그래서 저장 데이터 마이그레이션이 필요 없다.
- 변경:
  - `market-home.ts`: `MarketHomeConfig`·`DEFAULT_MARKET_HOME_CONFIG`·`validateMarketHomeConfig`에서 `categories` 섹션 제거, `MARKET_HOME_LIMITS.categories` 제거, `MarketHomeData.categories`(83행) 제거, `normalizeMarketHomeConfig`의 실패 시 기본값 객체(190행)에서 `categories` 제거.
    - **`assertUniqueStrings`(121행) 제거**: src·tests 전체에서 사용처가 `categories.menuEntryIds` 검증(159행) 하나뿐이라(2026-10-12 grep 확인) `categories` 검증(157-159행)을 지우면 쓰이지 않는 함수가 된다. 남기면 eslint `@typescript-eslint/no-unused-vars` 경고가 나고 CLAUDE.md의 '내 변경으로 쓰이지 않게 된 것은 지운다' 규칙과도 어긋난다.
    - **예전 형태 값 처리(Q8 caution — 읽기·저장 모두 '받아들인다')**: `validateMarketHomeConfig`는 `assertExactKeys(value, [...], 'config')`로 엄격히 검사하고 `normalizeMarketHomeConfig`는 검증 실패 시 **설정 전체를 기본값으로 초기화**한다. 그래서 `validateMarketHomeConfig`가 값이 객체이면 **`categories` 키 하나만** 떼어 낸 뒤 나머지를 지금처럼 엄격히 검사한다. **떼어 내는 방식은 미사용 변수가 생기지 않게** 한다 — 객체를 얕게 복사한 뒤 `delete copy.categories`(복사본에만 적용해 입력값은 바꾸지 않음). `const { categories: _x, ...rest } = value` 같은 구조분해는 이 저장소의 eslint 설정(next typescript 기본값, `ignoreRestSiblings` 미지정)에서 미사용 변수 경고가 날 수 있으므로 쓰지 않는다. normalize는 validate를 부르므로 따로 고치지 않는다. 결과: (a) 읽기 경로 — 예전 형태 값이 저장돼 있어도 popular·recent가 유지된다. (b) 저장 API — S0 배포 직후 예전 화면을 열어 둔 관리자 탭(예전 번들이 `categories`를 보냄)이 저장해도 400이 나지 않고, `categories`를 뺀 값이 저장된다. 그 밖의 모르는 키(옛 `sourceExplorer` 등)는 지금처럼 거절한다(`remove-home-source-section-contract`의 거절 단언 유지). 저장 API에서 `categories`를 거절하는 방식(예전 탭 저장 400 + 새로고침 안내)은 결정 문구 '받아들인다'와 어긋나므로 쓰지 않는다.
  - `market-home-server.ts`: `getMarketHomeData`의 `categories` 반환(307-309행)과 그것만 쓰는 `orderMenus`(160행) 제거. 관리자 옵션은 `categories` 하나뿐이므로 `MarketHomeAdminOptions` 인터페이스(54행)·`getMarketHomeAdminOptions`(316행)를 지우고, `MarketHomeAdminData`는 `extends MarketHomeAdminOptions` 없이 `{ config, preview }`로, `getMarketHomeAdminData`는 `...options` 없이 `getMarketHomeData`만 부른다. **`MarketHomeMenuEntry` 타입·`toMenuEntry`·`loadVisibleMenus`는 유지**한다 — `loadVisibleMenus`는 recent·popular·공개 개수의 게시판 게이트로 S3까지 남고, 죽은 코드 `campaign-hero.tsx`(10행 `categories: MarketHomeMenuEntry[]`)도 이 타입을 쓴다.
  - `HomeFinalCta`(`home-material-sections.tsx`): 쓰지 않는 `categories` prop(53행) 제거와 그 때문에 쓰는 곳이 없어지는 `MarketHomeMenuEntry` import(3행) 제거. 호출처 2곳(`solvook-home-view.tsx:54`, `preview/solvook-concept/page.tsx:45`)에서 `categories={homeData.categories}` 인자 제거.
  - 관리자 저장 API `api/admin/market-main-settings/route.ts`: `getMarketHomeAdminOptions` import(9행)·호출(72-76행), `validateAllowlist`(39행), `MarketHomeAdminValidationError`(23행)와 그 catch 분기(91행) 제거. 입력 검증은 `validateMarketHomeConfig` 한 번(400)만 남는다.
  - 관리자 화면 `market-main-settings-client.tsx`: '문제마켓 카테고리' 카드(230-280행 부근) 제거와 함께 그것만 쓰는 것들을 지운다 — props의 `categories`(26행)와 `MarketHomeMenuEntry` type import(19행), `withExplicitSelections`(36행), `toggleCategory`(73행), `moveCategory`(87행), `ArrowDown`·`ArrowUp` import(5행, 270·280행에서만 사용), `Checkbox` import(10행, 247행에서만 사용). `initialConfig`의 `useMemo`가 `withExplicitSelections`만 감싸고 있으면 `config`를 그대로 쓰고 `useMemo` import도 정리한다. **`Label`(165·180·209행)·`MARKET_HOME_LIMITS`(popular·recent 입력의 min/max)는 다른 카드가 계속 쓰므로 유지**. `page.tsx`는 `{...data}`를 넘기므로 `MarketHomeAdminData`에서 `categories`가 빠지면 따로 고칠 것이 없다.
  - 테스트: 착수 때 아래 두 grep으로 다시 찾아 갱신한다. 키워드 grep만으로는 관리자 client 소스의 아이콘·체크박스 단언을 찾을 수 없으므로, **관리자 client 소스를 읽는 테스트**와 **카드에서만 쓰던 식별자**를 함께 찾는다.
    ```bash
    grep -rln "menuEntryIds\|getMarketHomeAdminOptions\|homeData\.categories\|MARKET_HOME_LIMITS\|market-main-settings-client" tests
    grep -rn "Checkbox\|ArrowUp\|ArrowDown" tests/market-home-admin-route-contract.test.mjs
    ```
    조사 시점(2026-10-12) 대상:
    - `tests/market-home-admin-route-contract.test.mjs` 40·49행(`getMarketHomeAdminOptions` — 함수째 지우므로 단언을 제거하거나 `assert.doesNotMatch(serverSource, /getMarketHomeAdminOptions/)` 부재 단언으로). 같은 테스트(38행)의 이름 'strictly validates subject-scoped allowlists'는 허용 목록 검증이 없어지므로 'strictly validates the config and persists the shared setting' 식으로 고친다. 51행 `.eq('is_visible', true)`는 `loadVisibleMenus`가 S3까지 남으므로 S3에서 처리.
    - **같은 파일 59-61행**(테스트 'market home settings UI exposes only the approved controls and management links', 56-68행): `assert.match(clientSource, /Checkbox/)`·`/ArrowUp/`·`/ArrowDown/`. 이 셋은 '문제마켓 카테고리' 카드에서만 쓰여 카드와 import를 지우면 새 실패가 된다(지금은 통과 — 재검증에서 실행 확인 tests 3·fail 0). 세 단언을 지우고 `assert.doesNotMatch(clientSource, /문제마켓 카테고리|menuEntryIds/)` 부재 단언으로 바꾼다.
    - `tests/remove-home-source-section-contract.test.mjs` 41행 픽스처(`valid`에서 `categories` 제거. 남겨 두면 `validateMarketHomeConfig`가 `categories`를 떼어 낸 값을 돌려줘 44행 `assert.deepEqual(validateMarketHomeConfig(valid), valid)`가 새로 실패). 45-48행 `sourceExplorer` 거절 단언은 그대로 통과해야 한다.
    - `tests/market-home-ui-contract.test.mjs`의 'preview renders database category board navigation beside the ad carousel'(40행 `categories={homeData.categories}`)은 이미 기준선 실패다(42행 캐러셀 `categories` prop이 지금 코드에 없음 — 2026-10-12 실행 확인). S0 뒤에도 같은 이름으로 실패하므로 새 실패가 아니다. 이 테스트는 고치지 않고 S0 검증 기록에 적는다.
    - **신규 `tests/market-home-config-normalize.test.mjs`**: `normalizeMarketHomeConfig`에 예전 형태(`{ version: 1, popular: {…기본값과 다른 값}, categories: { isActive: true, menuEntryIds: ['x'] }, recent: {…기본값과 다른 값} }`)를 넣으면 popular·recent가 **넣은 값 그대로** 유지되고 결과에 `categories` 키가 없음. `validateMarketHomeConfig`(저장 API가 쓰는 함수)도 같은 값을 **받아들여** `categories` 없는 값을 돌려줌. `categories`가 아닌 모르는 키(예: `sourceExplorer`, 임의 키 `extra`)는 validate가 지금처럼 throw하고 normalize는 기본값을 돌려줌. 저장 라우트 소스에 `getMarketHomeAdminOptions`·`validateAllowlist`가 없음(정규식 부재 단언).
- 확인: `tsc`, `eslint`(변경 파일 — 오류 0에 더해 **경고도 0**. 사용하지 않는 import·변수·함수가 남지 않음), 기준선 대비 새 실패 0, `grep -rn "menuEntryIds" src` 0건, `grep -n "assertUniqueStrings" src/lib/market-home.ts` 0건, `grep -rn "getMarketHomeAdminOptions\|MarketHomeAdminOptions\|orderMenus" src` 0건, `grep -rn "MarketHomeMenuEntry" src`가 `market-home.ts`·`market-home-server.ts`·`campaign-hero.tsx`에만 남음, 관리자 메인 관리 화면에서 카드가 사라지고 저장이 정상, 공개 홈 국어·영어 정상(브라우저 절차는 8.11 **B-0**).
- 이 삭제로 S3의 '메인 관리 설정을 카테고리 기준으로' 작업은 없어진다(R12의 메인 관리 설정 항목은 S0에서 충족 — 2절).
- 되돌리기(3.9 S0 행): 이 커밋만 `git revert`(또는 Vercel Instant Rollback)하되, **그 전에 반드시** 읽기 전용 조회 `select workspace_subject, value from workspace_settings where setting_key = 'market_home'`를 실행한다. 'DB 변경 없음·데이터 복구 불필요'는 S0 배포 뒤 아무도 메인 관리에서 저장하지 않았을 때(이 조회 0건 — 2026-10-12 직접 재확인한 현재 값)만 맞다. S0 뒤에 저장하면 `categories` 없는 행이 생기고, S0 이전 코드의 엄격한 `validateMarketHomeConfig`가 `isRecord(categories)` 실패로 throw해 `normalizeMarketHomeConfig`(`market-home.ts:183-193`, 호출 `market-home-server.ts` loadConfig 138행)가 popular·recent를 포함한 **설정 전체를 기본값으로 조용히 바꾼다**. 공개 홈의 인기·최근 개수와 집계 기간이 바뀌고, 예전 관리자 화면이 기본값을 보여 준 채 저장하면 실제 저장값까지 덮어써진다.
  - **조회와 revert 배포 사이의 창**: 조회 뒤 revert 배포가 끝나기 전에 관리자가 메인 관리에서 저장하면, 조회는 0건이었는데도 `categories` 없는 행이 생긴 채 예전 코드로 돌아간다. 그래서 조회 **전에** 'revert 배포 완료(Vercel에서 확인)까지 메인 관리 저장 금지'를 사용자에게 알리고, **배포 직후 같은 조회를 한 번 더** 한다. 두 번째 조회가 1건 이상이면 아래 '1건 이상' 절차((a) forward-fix 또는 (b) 승인된 update)를 그 자리에서 진행한다(이때는 예전 코드가 이미 운영 중이므로 (b)를 곧바로 하고, 공개 홈 인기·최근 값이 저장값과 같은지 확인).
  - 0건: 그대로 revert.
  - 1건 이상: 둘 중 하나. (a) revert 대신 forward-fix 커밋 — 예전 코드 모양으로 돌리되 `categories`가 없으면 기본값(`{ isActive: true, menuEntryIds: [] }`)을 채운 뒤 검증하는 normalize를 넣는다. (b) 사용자 승인 아래 일회성 update로 해당 행 `value`에 `categories: {"isActive": true, "menuEntryIds": []}`를 추가한다(dry-run: `begin; update … ; select …; rollback;`으로 바뀔 행 제시 → 승인 → 실행 → 재조회로 popular·recent 값 불변·`categories` 존재 확인) 뒤 revert. 어느 쪽이든 revert 뒤 공개 홈 인기·최근 개수가 저장값과 같은지 확인한다.

---

## 6. 공개 사이트

### 6.1 헤더 메가메뉴(T2)
- `category-mega-menu.tsx`: 로컬 타입을 `{ id, title, depth, itemCount?, children }`로 바꾸고 depth1(h3, **링크** `/categories/{id}?subject=`, P6)과 depth2(링크 + `(N)`)만 그린다. `itemCount !== undefined`일 때만 `(N)`. 마운트 위치(`preview-header.tsx:444`)는 그대로.
- **브라우저 HTTP 캐시 대응**: 공개 API는 `Cache-Control: public, max-age=60`이라, T2 배포 직후 60초 안에 새 JS를 받은 브라우저가 캐시된 옛 형태(`{ items }`)를 받을 수 있다. 새 코드가 `node.children.map`을 실행하면 TypeError로 헤더(`preview-header`) 렌더가 깨진다. 두 가지를 함께 한다:
  1. 클라이언트 fetch 주소를 **`/api/market/category-menu?v=tree`**로 바꾼다(브라우저·CDN 캐시 키가 달라져 옛 응답을 받지 않음). 라우트는 쿼리를 무시하고 같은 응답을 준다.
  2. 응답 형태 방어: `Array.isArray(node.children) ? node.children : []`로 읽고, 최상위가 배열이 아니거나 노드에 `children`이 없으면 메뉴를 숨긴다(오류를 던지지 않음).
  - 반대 방향(되돌리기 직후 옛 번들이 새 형태를 받는 경우)은 옛 번들이 `?v=tree` 없는 주소를 쓰므로 그 주소의 캐시(새 형태)는 T2 이후에만 생긴다. 되돌린 뒤 최대 60초 동안 옛 번들이 새 형태를 받아 메뉴가 깨질 수 있다 → 되돌리기 직후 60초간 메가메뉴 오류는 예상 동작으로 기록하고 그 뒤 정상인지 확인한다(10절).
  - `category-mega-menu-count` 계약 테스트에 `?v=tree` 주소와 `Array.isArray(` 방어 코드를 단언으로 추가한다.

### 6.2 카테고리 페이지 `/categories/[id]`(T2)
- **신규 `layout.tsx`(실제 HTTP 404, P10)**: 이 세그먼트에는 401075d부터 `loading.tsx`가 있어 page는 Suspense 안에서 스트리밍되고, page에서 부른 `notFound()`는 200 헤더가 나간 뒤라 HTTP 200 + not-found UI가 된다. 그래서 404 판정은 loading 경계 밖인 `src/app/(solvook)/categories/[id]/layout.tsx`에서 한다: `params.id`가 UUID가 아니거나, `getCachedCategoryNodes()`(4.3, 적중 시 0쿼리·미스 시 활성 노드 1쿼리)의 두 과목 트리 어디에도 그 id가 없으면(= 노드가 없거나 자기·조상 중 비활성) `notFound()` → **HTTP 404**. layout은 `searchParams`를 받지 못하지만 노드 id는 과목 간에 겹치지 않으므로 두 과목 트리를 모두 보면 된다. 브라우저 확인과 함께 `curl -s -o /dev/null -w '%{http_code}'`로 404를 확인한다(B-2).
- `page.tsx`(조회 흐름):
  1. `getCachedCategoryNodes()`(layout이 같은 요청에서 이미 채웠으므로 적중) → `?subject=` 과목 트리에서 먼저, 없으면 다른 과목에서 `getMarketCategoryNodeDetail(id, nodesTree)`로 `detail`(조상·subtreeIds·자식)을 만든다. layout을 통과했으므로 null이면(60초 경계의 경합) 그대로 `notFound()`.
  2. `Promise.all([listMarketItemsForCategory(id, filters, detail), getCachedCategoryTree()])` — 401075d의 'detail 뒤 [목록, 메뉴] 병렬' 구조를 그대로 유지한다. 개수 트리는 사이드바·DetailFinder의 `(N)`에만 쓰고, 그 트리에 현재 노드가 없으면(경계 경합) 개수 없이 `detail.children`으로 그린다.
  - **캐시 미스 지연**: 노드 캐시 미스면 layout에서 활성 노드 1쿼리를 기다린 뒤 셸이 나간다(가벼운 1쿼리). 개수 트리 미스(노드 1 + 게시판 1 + 상품 readAll)는 목록 조회와 **병렬**이라 직렬 구간이 401075d보다 길어지지 않는다. 60초 캐시라 대부분 적중이다.
  - 쿼리 수 주장은 **8.5 T2-M 측정**으로 확인한다(캐시 적중·미스 두 기준의 `from()` 호출 수를 401075d 기준값과 비교).
- **(solvook) not-found 화면**: `src/app` 어디에도 `not-found.tsx`가 없어 지금은 루트 기본 404(헤더·푸터 없음)가 나온다. S1에서 `src/app/(solvook)/not-found.tsx`를 추가해(그룹 레이아웃 안의 not-found 경계 → Solvook 헤더·푸터 유지, 문구 '페이지를 찾을 수 없습니다.' + 홈 링크 `/`) `/items`와 `/categories`의 404가 같은 모양이 되게 한다(6.4, B-1·B-2).
- `category-items-view.tsx`:
  - 상단 경로: `국어 > EBS > 수능특강 문학 변형문제 > 2부 적용학습`. 과목은 `/?subject=`, 조상마다 `/categories/{id}?subject=` 링크, 현재 칸은 텍스트. h1은 현재 칸 제목.
  - '더 자세히 찾기'(DetailFinder): 현재 노드의 `children`을 4열 그리드(기존 필러 셀 계산 유지)로, 각 칸에 `(N)`. 자식이 없는 말단이면 **형제를 보여 주고 현재 칸 강조**(Q2 권장).
  - 검색·정렬·페이지 링크는 지금처럼 `/categories/${id}?...#market-results`.
- `MarketCategorySidebar.tsx`: props `{ tree: MarketCategoryNode[]; subject; activeId: string | null }`. 재귀 렌더. 첫 렌더에서 활성 노드의 조상 경로 전체를 펼친다. 노드 제목은 링크, 펼침은 별도 버튼(`aria-expanded`). 개수는 하위 합산. 들여쓰기는 depth마다 `pl-3` 정도로 depth5까지 w-56 안에서 줄바꿈 확인. 개수 마크업(`<span className="whitespace-nowrap …">({count.toLocaleString()})</span>`)은 메가메뉴와 같은 형식을 유지(계약 테스트 countSpan).
- `loading.tsx`: 경로 줄, h1, DetailFinder 그리드, 사이드바 배치에 맞춰 스켈레톤을 고친다(파일 유지).

### 6.3 메인 광고 링크
- 코드 변경 없음. 광고 두 개는 depth2 ID(`b4a73b79-…` 문학 80개, `4137f03c-…` 독서 64개)를 가리키므로, ID 보존(T1) + 하위 포함 목록(T2)이 끝나면 T4 재배치 후에도 80·64개가 그대로 보인다.

### 6.4 상세 주소 `/items/[itemId]`(S1)
- **스트리밍과 상태 코드**: 같은 세그먼트에 `loading.tsx`를 두면 page는 Suspense 안에서 스트리밍되어, page의 `notFound()`·`redirect()`는 HTTP 404·307이 아니라 200 + not-found UI / 200 + 클라이언트 redirect(meta refresh)가 된다. 그래서 **HTTP 상태가 필요한 검사는 loading 경계 밖인 `layout.tsx`에** 둔다:
  - 신규 `src/app/(solvook)/items/[itemId]/layout.tsx`: `params.itemId`가 UUID 형식이 아니면 `notFound()` → **실제 HTTP 404**. 화면은 S1에서 함께 추가하는 `src/app/(solvook)/not-found.tsx`(6.2)가 그린다 — 그룹 안의 not-found 경계라 `(solvook)/layout.tsx`의 헤더·푸터가 유지된다(`/items/`는 chrome 허용 목록에 들어가므로 이 파일이 없으면 헤더·푸터가 전혀 없는 기본 404가 된다). 구현 때 이 경계가 layout의 `notFound()`를 잡지 못하는 것으로 확인되면, 헤더 없는 기본 404를 허용한다고 S1 검증 기록에 적는다(HTTP 404 판정은 그대로)(상위 `(solvook)/layout.tsx:31-38`의 `Suspense`는 헤더만 감싸고 `children`은 감싸지 않으며, 그룹·루트에 `loading.tsx`가 없어 이 layout은 셸 렌더 단계에서 실행된다 — 직접 확인). 구현 후 `curl -s -o /dev/null -w '%{http_code}' localhost:<port>/items/not-a-uuid` = 404로 확인. DB 조회는 하지 않는다(쿼리 수 증가 없음). layout은 `searchParams`를 받지 못하므로 과목 redirect는 여기서 할 수 없다.
  - 과목 정규화 redirect와 '상품 없음' notFound는 page에 남는다(아래 2번). 이 둘은 스트리밍 뒤라 **HTTP 200 + 클라이언트 redirect / not-found UI**다. R10의 `?subject=` redirect acceptance는 **브라우저 최종 URL**(B-1)로 확인하고, curl 상태 코드로 단언하지 않는다. 예전 상세 주소 3종 redirect는 `next.config.ts`라 실제 HTTP 307이다(curl로 확인).
- 신규 `src/app/(solvook)/items/[itemId]/page.tsx`: 지금 `preview/solvook-concept/boards/[slug]/items/[itemId]/page.tsx` 본문을 옮긴다.
  1. UUID 형식 검사는 layout에서 끝났다(지금은 500). page는 형식이 맞는 id만 받는다.
  2. `?subject=`가 있으면 그 과목으로 지금처럼 병렬 조회하고, 상품이 없거나 `item.workspace_subject`가 다르면 `getPublishedMarketItemById(id)`(과목 필터 없음)로 실제 과목을 확인해 `/items/{id}?subject={실제}`로 `redirect`. `?subject=`가 없으면 같은 방식으로 실제 과목을 찾아 redirect. 상품이 아예 없으면 404.
  3. 게시판 slug 조회와 `item.menu_entry_id !== category.id` 비교를 없앤다(상세는 상품 상태만으로 판단 — 지금 게시판 4개가 모두 visible이라 화면 결과는 같다).
  4. 카테고리 트리는 `market-category-tree-cache.ts`의 60초 공유 캐시(지금 상세는 매 요청 count 32회).
- 신규 `loading.tsx`(카테고리 페이지 스켈레톤 패턴).
- `market-material-detail.tsx`: `category: MarketMenuEntry` prop 제거. 경로 표시 `홈 > depth1 > … > 현재 칸 > 상품`(카테고리가 없거나 공개 트리에 없으면 `홈 > 상품`). 홈 링크는 `/?subject=`. 썸네일 대체 문구는 현재 칸 제목, 없으면 과목명. S1에서는 트리가 2단이라 경로가 `홈 > 그룹 > 항목 > 상품`이고, T2에서 `findCategoryPath`로 바꿔 depth4까지 나온다.
- `path-aware-site-chrome.tsx:29`: `pathname.startsWith('/items/')` 추가(빠지면 헤더·푸터 이중 렌더).
- `next.config.ts` `redirects()`(모두 `permanent: false` = 307. 사용자 결정 Q9 — 308 전환은 S4 배포 2주 뒤 조건부 별도 커밋, 8.12):
  - `/preview/solvook-concept/boards/:slug/items/:itemId` → `/items/:itemId`(원래 쿼리 `?subject=`는 Next가 그대로 붙인다)
  - `/:subject(english|korean)/market/:slug/items/:itemId` → `/items/:itemId?subject=:subject`
  - `/market/:slug/items/:itemId` → `/items/:itemId`
  - **목적지의 `?subject=`(P11 — 계획서 해석, 사용자 확인 권장)**: 두 번째 규칙만 주소의 과목으로 `?subject=`를 붙인다. `/market/{slug}/items/{id}`와 `?subject` 없는 preview 상세는 주소에 과목 정보가 없으므로 HTTP 307의 목적지(Location)가 `/items/{id}`(쿼리 없음)이고, 그 뒤 `/items` page가 실제 과목으로 `/items/{id}?subject={실제}`를 맞춘다(HTTP 200 + 클라이언트 redirect). 따라서 curl `%{redirect_url}`로는 `/items/{id}`까지만 확인하고, `?subject=`는 브라우저 최종 URL로 확인한다(B-1·B-8). 원래 요청에 `?subject=`가 있으면 Next가 쿼리를 그대로 넘기므로 목적지에도 붙는다.
  - next.config redirects는 middleware보다 먼저 실행되므로 `/market → /{subject}/market` 재지정과 충돌하지 않는다. 예전 page 파일은 S4까지 남겨 두지만 redirect가 먼저 걸린다.
- **예전 preview 상세 page 처리(S1)**: `src/app/preview/solvook-concept/boards/[slug]/items/[itemId]/page.tsx`는 `market-material-detail`에 `category` prop을 넘기고 `listMarketCategoryMenu`를 import한다. S1에서 그 prop을 없애고 T2에서 `listMarketCategoryMenu`/`MegaMenuGroup`을 지우므로, 그대로 두면 S1·T2에서 `tsc`·`next build`가 깨진다. 그래서 **S1에서 본문을 얇은 stub으로 바꾼다**: `params`의 `itemId`와 `searchParams.subject`만 읽어 `redirect('/items/{itemId}' + (subject ? '?subject=' + subject : ''))`만 한다(import는 `next/navigation`의 `redirect`뿐). next.config redirect가 먼저 걸리므로 실제 동작은 같고, 파일 삭제는 S4에서 한다. 이 파일 내용을 단언하는 테스트는 S1에서 함께 고친다(`grep -ln "boards/\[slug\]/items" tests/`로 착수 때 찾음 — `solvook-real-market-detail-contract`는 새 경로 기준으로 다시 씀).
- **링크 생성 11곳 교체**(모두 `/items/${id}?subject=${subject}`):

| 파일 | 지금 형태 | 비고 |
|---|---|---|
| `src/components/market/market-item-list-row.tsx:38` | preview boards | `categorySlug` 조건 제거, 항상 링크 |
| `src/components/market/market-item-card.tsx:59` | preview boards | 같음 |
| `src/lib/market-cart-server.ts:182` | preview boards | 게시판 조회 제거, published·활성·미삭제 상품이면 링크(쿼리 1회) |
| `src/app/preview/solvook-concept/_components/home/home-material-sections.tsx:29` | preview boards | |
| `src/app/preview/solvook-concept/_components/home/popular-downloads-slider.tsx:32` | preview boards | 운영 홈도 사용 |
| `src/app/preview/solvook-concept/_components/board/real-market-board-results.tsx:152` | preview boards | |
| `src/app/(solvook)/library/_components/library-view.tsx:544` | `/{subject}/market/…` | **보관함 버그 수정**: 예전 화면으로 새던 링크. 노출 조건을 `categorySlug` 대신 상품 존재 여부로(`MarketLibraryRow`에 상세 가능 여부 필드) |
| `src/lib/workspace-routes.ts:84` | `/market/…`(`marketItem`) | 사용처는 `workspace-revalidate`의 맵뿐 — `/items/{id}`로 |
| `src/app/legacy/_library/market/market-library-client.tsx:206` | `/market/…` + prefix | prefix 없이 `/items/…?subject=`, 노출 조건 상품 존재 |
| `src/app/(dashboard)/market/[slug]/market-listboard-client.tsx:118` | `/market/…` | |
| `src/app/preview/solvook-concept/_components/home/campaign-hero.tsx:24` | `/{subject}/market/…` | 죽은 코드 — 링크만 바꾸고 삭제하지 않음 |

### 6.5 검색·보관함 '분류' 필터(S3) — 8절 S3 카드 참고

---

## 7. 데이터 작업 — 국어 depth3·4 생성과 상품 144개 재배치(T4)

### 7.1 스크립트
- 파일: `scripts/market-category-tree-backfill.mjs`(일회성). `.env.local`의 service role로 접속. 기본 동작은 **dry-run**(읽기만), `--apply`일 때만 쓰기. 매핑 표는 이 스크립트 안에만 있고 `src`에는 두지 않는다.
- 부모(depth2)는 ID가 아니라 국어 depth2 제목('수능특강 독서 변형문제', '수능특강 문학 변형문제')으로 찾고, 정확히 1개가 아니면 중단.

### 7.2 만들 노드(표시 이름은 사용자 표기, 구성은 실제값)

| depth2 | depth3(sort_order) | depth4(sort_order) | 상품 연결 위치 |
|---|---|---|---|
| 수능특강 독서 변형문제 | 1부 개념학습(1) | 독서의 방법(1), 독서의 본질(2), 독서의 분야(3), 독서의 태도(4) | depth4 |
| | 2부 적용학습(2) | 인문·예술(1), 사회·문화(2), 과학·기술(3), 주제 통합(4) | depth4 |
| | 3부 실전학습(3) | 없음 | 상품 0, 칸만 생성 |
| 수능특강 문학 변형문제 | 1부 교과서 개념학습(1) | 없음 | depth3(9개) |
| | 2부 적용학습(2) | 고전 시가(1), 현대시(2), 고전 산문(3), 극·수필(4), 갈래복합(5), 현대소설(6) | depth4 |
| | 3부 실전학습(3) | 실전학습 1부(1), 실전학습 2부(2) | depth4 |

depth5는 만들지 않는다. 표기 차이('1부 개념학습' vs '1부 교과서 개념학습')는 실제값 그대로(Q1).

### 7.3 판별 규칙(스크립트 내부 표)
- 대상: `workspace_subject='korean'`, `category_item_id`가 위 depth2 두 개 **또는 그 하위 노드**(재실행 시 이미 옮겨진 상품도 포함해 "이미 배치됨"으로 센다), `deleted_at is null` 여부와 무관(전 행).
- 각 규칙은 `{ depth2, depth3, depth4|null, token }`이고, 제목(NFC 정규화)에 `token`이 들어 있으면 매칭. 토큰은 제목 괄호 앞부분 그대로:
  - 독서: `(1부 개념학습 독서의 방법`, `(1부 개념학습 독서의 본질`, `(1부 개념학습 독서의 분야`, `(1부 개념학습 독서의 태도`, `(2부 적용학습 인문예술`, `(2부 적용학습 사회문화`, `(2부 적용학습 과학기술`, `(2부 적용학습 주제통합`
  - 문학: `(1부 교과서 개념학습 `, `(2부 적용학습 고전시가`, `(2부 적용학습 현대시`, `(2부 적용학습 고전산문`, `(2부 적용학습 극수필`, `(2부 적용학습 갈래복합`, `(2부 적용학습 현대소설`, `(3부 실전학습 1부)`, `(3부 실전학습 2부)`
- 규칙은 상품의 현재 depth2(조상) 범위 안에서만 적용한다(독서·문학의 '2부 적용학습' 혼동 방지).
- 상품마다 매칭 규칙이 **정확히 1개**여야 한다. 0개(미매칭)나 2개 이상(중복)이 하나라도 있으면 `--apply`를 거부한다.

### 7.4 실행 절차
1. **dry-run 출력**: 노드별 [생성 예정/이미 있음], 노드별 예상 상품 수, 미매칭 목록(id·제목), 중복 매칭 목록, 이미 목표 칸에 있는 상품 수. 기대값:
   - **노드 생성 예정 수(첫 실행)**: depth3 **6**(독서 3·문학 3), depth4 **16**(독서 8 = 1부 4 + 2부 4 + 3부 0, 문학 8 = 1부 0 + 2부 6 + 3부 2), depth5 0. 두 번째 실행부터는 생성 예정 0·이미 있음 22.
   - 독서: 방법 5, 본질 3, 분야 3, 태도 2, 인문·예술 13, 사회·문화 13, 과학·기술 13, 주제 통합 12(합 64), 3부 실전학습 0
   - 문학: 1부 교과서 개념학습 9, 고전 시가 11, 현대시 11, 고전 산문 11, 극·수필 8, 갈래복합 11, 현대소설 11, 실전학습 1부 4, 실전학습 2부 4(합 80)
   - 미매칭 0, 중복 0
2. **사용자 승인**(dry-run 결과를 보여 주고 승인받은 뒤에만).
3. `--apply`:
   - **백업**: 실행 전에 대상 상품의 (id, category_item_id) 백업 JSON을 **날짜와 무관한 고정 영속 경로 `~/backups/create_quiz_ai/T4/backup.json`**에 저장한다(scratchpad `/private/tmp`는 쓰지 않음. 날짜 폴더를 쓰면 다른 날 재실행 때 새 폴더가 생겨 '있으면 덮어쓰지 않음' 가드가 동작하지 않고 첫 실행 백업이 어느 것인지 헷갈린다). `--apply`·`--rollback`은 항상 이 고정 폴더만 본다. **백업 파일이 이미 있으면 덮어쓰지 않는다** — 두 번째 `--apply`의 상품 값은 이미 옮겨진 값이므로, 롤백은 항상 **첫 실행 백업만** 쓴다. 두 번째 실행은 `backup-<시각>.json`으로 따로 남기되 롤백에는 쓰지 않는다.
   - **생성 노드 기록**: 노드를 만들 때마다 새 id를 `~/backups/create_quiz_ai/T4/created-nodes.json`에 **바로 덧붙여** 기록한다(id, parent_id, depth, title). 이미 있던 노드를 재사용한 경우는 `reused`로 따로 적는다. 롤백(7.5)은 이 목록의 `created`만 지운다.
   - 노드 생성(같은 부모 아래 같은 제목이 있으면 재사용) → 상품 `category_item_id` 갱신(이미 목표 값이면 건너뜀). `updated_at`은 기존 트리거가 처리.
   - **원자성 없음**: 스크립트는 supabase-js REST로 노드 생성과 144개 갱신을 따로 보내므로 **하나의 트랜잭션이 아니다**. 중간에 실패하면 같은 명령(`--apply`)을 다시 실행해 수렴시킨다(노드는 재사용, 이미 옮긴 상품은 건너뜀 — 멱등). 중간 상태에서도 T2 코드는 depth2 하위 전체를 합산하므로 **독서 depth2 64·문학 depth2 80과 광고 두 페이지 개수는 그대로**다(상품이 depth2에 남아 있든 depth3·4로 옮겨졌든 같은 하위 트리 안). 따라서 중간 실패가 공개 화면을 깨뜨리지 않는다.
4. **실행 후 검증 쿼리**(스크립트 `--verify` 또는 SQL):
   - 독서 depth2 하위 합 64, 문학 depth2 하위 합 80, `category_item_id is not null` 144
   - 노드별 개수가 1의 기대값과 같음, 독서 '3부 실전학습' 존재·상품 0
   - 국어 depth3 노드 6개(독서 3·문학 3), depth4 노드 **16개**(독서 8: 1부 4·2부 4, 문학 8: 2부 6·3부 2), depth5 0개. depth2별로: 독서 아래 depth3 3·depth4 8, 문학 아래 depth3 3·depth4 8
   - 다시 `--apply` → "생성 0, 갱신 0"
   - 공개 확인: `/categories/b4a73b79-…?subject=korean` 80개, `/categories/4137f03c-…?subject=korean` 64개(T2 배포 코드 기준. 60초 캐시 — 트리 태그는 스크립트가 무효화하지 못하므로 최대 60초 뒤 확인)
- 선행 조건: **T1 적용 + T2 배포 완료·확인**. T2 전에 돌리면 depth2 페이지·광고·개수가 0으로 보인다.
- 영어: 데이터 작업 없음(카테고리 0건, 구조만).

### 7.5 롤백
- **첫 실행 백업**(`~/backups/create_quiz_ai/T4/backup.json`)으로 `category_item_id`를 원래 depth2 값으로 되돌린다(스크립트 `--rollback <backup>`). 그 다음 `created-nodes.json`의 `created` 노드만 depth4 → depth3 순서로 삭제한다(상품이 없어진 뒤라 restrict에 걸리지 않음). `reused` 노드는 이번 실행 전부터 있던 것이므로 지우지 않는다. 롤백도 REST 호출이라 중간에 실패할 수 있다 → 같은 `--rollback`을 다시 실행해 수렴(멱등). 되돌린 뒤 4번 검증 쿼리의 '144 그대로', 광고 페이지 80·64 확인.

---

## 8. 단계별 실행 계획(게시판 의존 제거 단계 포함)과 배포 순서

### 8.0 공통 규칙
- 순서: **S0 → S1 → T1 → T2 → T3 → T4 → S2 → S3 → S4**(그 뒤 조건부 후속 8.12 — 308 전환). 각 단계는 독립 검증 OK를 받아야 다음 단계로 간다(작성자가 자기 결과를 승인하지 않음).
- 단계 공통 확인(모든 코드 단계):
  1. `npx tsc --noEmit` 새 오류 0. **타입 생성물을 먼저 갱신한다**: `tsconfig.json`의 `include`에 `.next/types/**/*.ts`·`.next/dev/types/**/*.ts`가 들어 있고, 그 안의 `validator.ts`(`.next/types`는 `next build`·`next typegen`, `.next/dev/types`는 개발 서버가 만든다)가 `typeof import("../../src/app/(dashboard)/market/...")`처럼 라우트 파일을 직접 import한다. 그래서 라우트 파일(page·route·layout)이 사라지는 모든 변경(T2의 groups/items 라우트, S4-2b, S4-4, 그리고 라우트를 지우게 되는 revert 포함)에서는 갱신하지 않으면 코드에 문제가 없어도 TS2307이 난다. 절차:
     - tsc 전에 `npx next typegen`을 실행해 `.next/types`를 현재 라우트로 다시 만든다.
     - 개발 서버가 떠 있으면 재시작해 `.next/dev/types`도 다시 만든다. 개발 서버를 쓰지 않는 상태라면 `rm -rf .next/dev/types`로 지운다(빌드 생성물이라 안전).
     - 그 뒤에도 생성물에서 지운 경로를 가리키는 TS2307이 남으면 생성물이 갱신되지 않은 것이므로 위 절차를 다시 확인한다. 생성물 오류를 '무시해도 되는 오류'로 세지 않는다. 갱신 후 0이어야 통과다.
  2. 변경 파일 `npx eslint <files>` 오류 0
  3. 단계의 신규·수정 테스트 통과
  4. 전체 테스트 기준선 비교(macOS BSD `sed`는 `\s`를 지원하지 않으므로 POSIX 클래스 `[[:space:]]`를 쓴다. 파일별로 돌려 `파일::테스트명`으로 저장한다 — 들여쓰기된 하위 테스트의 번호가 남거나, 다른 파일의 같은 이름 테스트가 `sort -u`로 합쳐지는 것을 막는다):
     ```bash
     OUT=<tmp>; : > "$OUT/current-failures.raw"; : > "$OUT/current-summary.txt"
     for f in tests/*.test.mjs; do
       node --test --test-reporter=tap "$f" > "$OUT/one.tap" 2>&1
       grep -E '^[[:space:]]*not ok [0-9]+ - ' "$OUT/one.tap" \
         | grep -v ' # TODO' \
         | sed -E 's/^[[:space:]]*not ok [0-9]+ - //; s/ # (SKIP|TODO).*$//' \
         | sed "s|^|$f::|" >> "$OUT/current-failures.raw"
       grep -E '^# (tests|fail) ' "$OUT/one.tap" | sed "s|^|$f |" >> "$OUT/current-summary.txt"
     done
     LC_ALL=C sort -u "$OUT/current-failures.raw" > "$OUT/current-failures.txt"
     awk '$2=="#" && $3=="tests"{t+=$4} $2=="#" && $3=="fail"{f+=$4} END{print "tests", t, "fail", f}' "$OUT/current-summary.txt"
     LC_ALL=C comm -13 docs/market-category-tree-test-baseline.txt "$OUT/current-failures.txt"   # 새 실패: 반드시 0줄
     LC_ALL=C comm -23 docs/market-category-tree-test-baseline.txt "$OUT/current-failures.txt"   # 고쳐진 기준선 실패: 허용, 검증 기록에 적음
     ```
     - `# TODO` 지시문이 붙은 `not ok`는 실패가 아니므로 뺀다. 다른 지시문은 이름에서 떼어 낸다.
     - 실패한 하위 테스트가 있는 `describe`(suite)도 `not ok` 줄로 나온다. 그래서 목록 줄 수는 `# fail` 합(테스트 수 기준)보다 많을 수 있다(로컬 Node v22.22.3에서 직접 확인: 하위 1개 실패 → `not ok` 2줄, `# fail 1`). 비교는 **줄 목록끼리** 하므로 문제없고, S0에서 두 값을 모두 기록한다.
     - 정렬과 비교는 모두 `LC_ALL=C`로 고정한다(locale이 다르면 `comm` 결과가 틀어진다).
     - **명세 명령과의 대조**: 제약·R1·R15가 정한 실행 명령은 `node --test tests/*.test.mjs`(한 번에 실행)다. 파일별 반복은 이름 충돌을 막기 위한 비교용이고, 한 번에 돌릴 때와 동시 실행 여부가 달라 총 개수·흔들리는 테스트 결과가 다를 수 있다. 그래서 단계마다 명세 명령도 함께 돌린다:
       ```bash
       node --test tests/*.test.mjs > "$OUT/all.txt" 2>&1; grep -E '^ℹ (tests|pass|fail|skipped) ' "$OUT/all.txt"   # spec reporter 요약 줄
       ```
       `tests`·`fail` 값을 파일별 반복의 awk 합계와 나란히 검증 기록에 적는다. 같으면 그대로 진행한다. 다르면 차이(어느 파일·어느 테스트)를 찾아 기록하고, S0에서 정한 기준선 규칙(8.2-3)을 따른다.
     통과 기준은 "기준선 대비 새 실패 0 + 이 단계의 신규·수정 테스트 통과"다. "전체 통과"가 아니다. 의도적으로 지우거나 이름을 바꾼 테스트는 검증 기록에 적는다.
  5. scratchpad 복사본에서 `next build` 성공
  6. 브라우저 확인(연동된 Chrome). **로컬 dev도 운영 DB를 쓰므로** 관리자 CRUD 수동 확인은 사용자 승인 뒤에, 테스트용 칸 이름(예: `zz-테스트`)으로 하고 끝나면 지운다.
- DB 단계 공통(T1, T3, T4, S3, S4의 마이그레이션·스크립트): **⓪ 착수 전 체크리스트(마이그레이션 단계 T1·T3·S3·S4: Supabase MCP 인증·`list_migrations` 성공·이력 일치 — 3.2) → ① dry-run(MCP `execute_sql`로 `begin; <본문>; <검증 DO 블록>; rollback;` 또는 스크립트 기본 모드) 결과 제시 → ② 사용자 승인 → ③ 실행(`apply_migration` 또는 스크립트 `--apply`) → ④ 검증 쿼리(객체 체크리스트 대조·version 조회 후 로컬 파일명 변경·`execute_sql` 재실행 포함, 3.2 적용 절차)**. 이 네 가지가 없으면 그 단계를 시작하지 않는다. `psql`은 사용자가 PG* 환경변수를 줄 때만 대체 수단.
- **게시판(`market_menu_entries`) 행 취급 규칙**:
  - **S3 전**: 게시판의 `is_visible = false`, `is_active = false`, archive(`deleted_at` 설정) **모두 금지**. S3 전에는 공개 목록·개수·검색·홈·샘플 API의 게이트가 이 세 값을 보므로, 숨기거나 archive만 해도 그 게시판 상품이 공개 화면에서 사라진다.
  - **S3 ~ S4**: archive(`deleted_at`)만 허용(게이트가 사라져 공개 화면 영향 없음). hard delete 금지 — `menu_entry_id` FK가 `on delete cascade`라 지우면 상품도 지워진다.
  - **M4(S4, FK `on delete set null`) 이후**: hard delete는 상품을 지우지 않지만, 그래도 **사용자 승인 없이 하지 않는다**.
- 배포: main 푸시 → Vercel 배포 완료 확인 → 운영 URL에서 해당 단계 브라우저 확인.

### 8.1 배포 순서와 선행 조건

| 순서 | 단계 | 내용 | 선행 조건 | DB 변경 |
|---|---|---|---|---|
| 1 | S0 | 사이드바 커밋, 기준선, 메인 관리 '문제마켓 카테고리' 설정 삭제(Q8, 별도 커밋) | 없음 | 없음 |
| 2 | S1 | 상세 주소 독립(게시판 의존 제거 1단계) | S0 | 없음 |
| 3 | T1 | 트리 확장 마이그레이션 M1 | S1 배포 확인 | M1 |
| 4 | T2 | 트리 코드 배포(R3~R7, R14, 상세 경로 재귀) | T1 적용·검증 | 없음 |
| 5 | T3 | 트리 축소 마이그레이션 M2 + 타입 재생성 | T2 배포 후 운영 확인(권장 하루) | M2 |
| 6 | T4 | 국어 depth3·4 + 144개 재배치 | T1 + **T2 배포**(하위 합산 코드) | 데이터 |
| 7 | S2 | 상품 관리 화면·API(게시판 의존 제거 2단계) | T2(트리 API·편집기) | 없음 |
| 8 | S3 | 노출 조건·필터(3단계. 메인 관리 설정은 S0에서 삭제 — Q8) | S1(링크가 게시판 slug를 안 씀), S2 | M3(RPC·RLS) |
| 9 | S4 | 예전 화면 정리(S4-2a 공용 컴포넌트 이동 → S4-2b 예전 page·layout·사이드바 삭제, Q10)·카드 제거·nullable(4단계). redirect는 307 | S3 | M4 |
| 10 | 후속(8.12) | redirect 307 → 308 전환(별도 커밋) | S4 배포 **2주 뒤**(시작일 = S4 마지막 코드 배포인 배포 D의 운영 확인일 — P12. 이 날짜를 S4 검증 기록에 적음) + Q9의 3조건 모두 만족 + 사용자 확인 | 없음 |

T3과 T4는 서로 독립이다(둘 다 T2 뒤). 되돌리기는 단계 역순이며, 코드 되돌리기가 가능한 조건은 3.9 롤백 매트릭스를 따른다(예: T4 후 T2 revert는 7.5 먼저). S2 안에서는 **2a(과목을 카테고리에서 결정 + categoryItemId 필수) 커밋이 2b(menuEntryId 선택값 + 기본 게시판) 커밋보다 먼저**다.

### 8.2 S0 — 사이드바 커밋과 기준선(R1)
- 작업 → 확인
  1. `git add src/lib/admin-sidebar.ts tests/admin-sidebar-navigation.test.mjs` 후 커밋(`feat: 관리자 사이드바 문제마켓 그룹 추가`). `.claude/settings.local.json`, `.playwright-mcp/`는 스테이징하지 않는다 → `git show --stat HEAD`에 두 파일만.
  2. `node --test tests/admin-sidebar-navigation.test.mjs` → fail 0. tsc 기준선: 8.0-1의 생성물 갱신 절차 뒤 `npx tsc --noEmit` 오류 수를 검증 기록에 남긴다(2026-10-12 기준 0건).
  3. 전체 테스트를 8.0-4 명령으로 돌려 `docs/market-category-tree-test-baseline.txt`(`파일::테스트명`, `LC_ALL=C` 정렬)와 총 개수를 남긴다. 확인:
     - awk 합계의 `tests`(1094/1095 재측정)와 `fail`이 **53**인지 확인한다. 53이 아니면 실제 값을 기록하고 검증 기록에 차이를 적는다.
     - 기준선 파일 줄 수(`wc -l`)를 함께 기록한다. 실패한 하위 테스트를 가진 suite 줄이 섞이므로 53보다 클 수 있다(8.0-4). 줄 수 − `fail` 합 = 실패한 suite 수인지 대조한다(실패 suite는 TAP 진단에 `type: 'suite'`가 붙는다: 파일별 `grep -E -A4 '^[[:space:]]*not ok ' one.tap | grep -c "type: 'suite'"`의 합 — 로컬에서 형식 확인).
     - `grep -F 'solvook-real-market-detail-contract.test.mjs::Solvook real market detail route loads one published item in its category and subject' docs/market-category-tree-test-baseline.txt` 1줄.
     - 같은 명령을 한 번 더 돌려 두 결과가 같은지(비결정적 실패가 없는지) 확인한다. 다르면 흔들리는 테스트를 기록한다.
     - **명세 명령 대조**: `node --test tests/*.test.mjs`를 한 번 실행해(8.0-4의 명세 명령 줄) 총 `tests`·`fail`을 기록하고, 위 파일별 반복의 awk 합계(`tests`, `fail`)와 같은지 대조한다. 조사 값 1094/1095·53은 이 한 번 실행의 결과였다. **같으면** 파일별 목록을 그대로 기준선으로 쓴다. **다르면** 한 번 실행의 실패 이름 목록(`node --test --test-reporter=tap tests/*.test.mjs`의 `not ok` 줄. 파일 이름은 각 `not ok` 진단 블록의 `location:` 값에서 얻어 `파일::테스트명` 형식으로 맞춘다 — 출력 형식은 S0에서 실측 확인)과 파일별 목록을 비교해 차이 나는 테스트를 검증 기록에 적고, 기준선은 **두 목록의 합집합**으로 정한다(어느 실행 방식에서든 이미 실패하던 것은 새 실패로 세지 않기 위해서). 이후 단계도 같은 두 방식으로 돌려, 어느 쪽에서든 기준선에 없는 실패가 나오면 새 실패로 본다.
     이 파일은 S0 커밋 확인 뒤 이 계획서와 함께 별도 docs 커밋.
  4. 메인 관리의 '문제마켓 카테고리' 설정 삭제(5.4, Q8 결정) → 5.4의 확인 항목(신규 `tests/market-home-config-normalize.test.mjs` 통과, `market-home-admin-route-contract` 40·49행(`getMarketHomeAdminOptions`)과 **59-61행(`Checkbox`·`ArrowUp`·`ArrowDown` — 카드 제거로 import가 없어지므로 부재 단언 `/문제마켓 카테고리|menuEntryIds/`로 전환)**, 38행 테스트 이름의 'allowlists' 정리, `remove-home-source-section-contract` 41행 픽스처 갱신, 5.4의 착수 grep 두 개로 빠진 단언 재확인, `assertUniqueStrings` 0건, 변경 파일 eslint 경고 0) + 기준선 대비 새 실패 0 + 브라우저 **B-0**(8.11). 1~3의 기준선을 만든 **뒤에** 하는 별도 커밋(`refactor: 사용하지 않는 문제마켓 메인 카테고리 설정 삭제`) — 기준선이 이 변경 전 상태를 담아야 비교가 맞다.
- 되돌리기: 커밋 단위 `git revert`. 단 4번(메인 관리 설정 삭제) 커밋은 5.4 '되돌리기'의 `market_home` 행 조회를 먼저 한다(3.9 S0 행).

### 8.3 S1 — 상세 주소 독립(R10, 게시판 의존 제거 1단계)
- 작업 → 확인
  1. `src/lib/market-category-tree-cache.ts` 신설(4.3 S1), 카테고리 페이지가 이를 import → 카테고리 페이지 동작·쿼리 수 변화 없음.
  2. `/items/[itemId]` layout·page·loading 신설(6.4) + `src/app/(solvook)/not-found.tsx` 신설(6.2) → `/items/{운영 국어 상품}?subject=korean` 200, `/items/not-a-uuid`는 **curl 상태 404**(layout)이고 화면은 Solvook 헤더·푸터가 있는 not-found, `?subject=english`·쿼리 없음 → 브라우저 **최종 URL**이 `?subject=korean`(page의 redirect는 스트리밍 뒤라 HTTP 200 + 클라이언트 redirect — 6.4).
  3. `market-material-detail.tsx` 게시판 prop 제거, 경로 표시 변경 → 상세에 `홈 > EBS > 수능특강 문학 변형문제 > 상품명`. 같은 커밋에서 예전 preview 상세 `boards/[slug]/items/[itemId]/page.tsx`를 redirect stub으로 바꾼다(6.4) → `tsc` 새 오류 0(이 파일이 지운 prop을 넘기지 않음), `grep -n "listMarketCategoryMenu\|market-material-detail" "src/app/preview/solvook-concept/boards/[slug]/items/[itemId]/page.tsx"` 0건.
  4. `path-aware-site-chrome.tsx`에 `/items/` → 헤더 1개.
  5. `next.config.ts` redirects 3종 → 각 예전 주소가 307로 새 주소. **배포 뒤 8.12-2① 데이터 출처 검증**(Q9 조건 ②를 나중에 로그로 잴 수 있는지 지금 확인해야 한다 — 놓치면 되돌릴 수 없는 순서 의존): 운영에서 예전 상세 주소 하나(예: `/korean/market/{slug}/items/{운영 국어 id}`)를 curl로 연 뒤 Vercel Logs(대시보드 또는 `vercel logs`)에 그 요청이 307로 보이는지 확인하고, 같은 화면에서 런타임 로그 **보존 기간**과 Log Drain·Observability 설정 유무도 확인한다. 결과(보임/안 보임, 보존 기간, Drain 유무)를 S1 검증 기록에 적는다.
  6. 링크 11곳 교체(6.4 표), 장바구니 링크 단순화, 보관함 노출 조건 → 카테고리·검색·홈·장바구니·보관함에서 클릭 시 `/items/{id}?subject=`.
- 게시판 게이트는 이 단계에서 목록·검색·홈·샘플 API에 그대로 둔다(장바구니 링크와 상세 판단만 상품 상태 기준으로 바뀜).
- 테스트: 신규 **`tests/market-cart-detail-href.test.mjs`(실행 테스트)** — `market-cart-server.ts`의 상세 링크 함수(지금 비공개 함수 `getMarketCartDetailHrefs`를 테스트용으로 export하거나, `getMarketCartView`를 `createFakeAdmin`·mocks(`@/lib/market-checkout-server`, `@/lib/credit-balance`, `@/lib/supabase/server`)로 실행)를 **게시판 `is_visible=false` 픽스처**로 돌려, published·활성·미삭제 상품에 `/items/{id}?subject=` 링크가 생기고 `market_menu_entries` 조회가 ops에 없는지 단언(R12의 장바구니 항목을 S1에서 충족). mocks로 불러오기가 막히면 그 사실과 대체 검증(`market-public-gate-contract`의 grep 0건 + B-1·B-6 장바구니 클릭)을 S1 검증 기록에 적는다. / 신규 `tests/market-item-detail-url-contract.test.mjs`:
    - **상세 링크 조립만** 검사한다. `src` 아래 `.ts/.tsx` 전체에서 정규식 `/solvook-concept\/boards\/\$\{[^}]+\}\/items\//`와 `/\/market\/\$\{[^}]+\}\/items\//` 일치 0건. `'solvook-concept/boards/${'` 자체를 검사하면 S4까지 남는 **게시판 목록 링크**(`real-market-board-results.tsx:49·138`, `real-market-board.tsx:120`, `boards/[slug]/page.tsx:92`, 샘플 데모 `material-detail.tsx:40`)에 걸려 S1에서 바로 실패하므로 쓰지 않는다. 게시판 목록 링크는 S4의 `market-board-retirement-contract`에서 따로 검사한다.
    - next.config 3규칙 `permanent: false`, chrome 허용 목록 `/items/`, 새 **layout의 UUID 검사**·page의 과목 redirect, `src/app/(solvook)/not-found.tsx` 존재.
    - **공유 캐시 사용(R10 'count 쿼리 N회 금지')**: `src/app/(solvook)/items/[itemId]/page.tsx`가 `'@/lib/market-category-tree-cache'`를 import하고, `/listMarketCategory(Menu|Tree)\(true\)/`에 일치하는 직접 호출이 없음.
    - 예전 preview 상세 page가 `redirect(`만 하는 stub(`listMarketCategoryMenu`·`market-material-detail` import 없음).
  / 수정: `solvook-real-market-detail-contract`(첫 테스트를 새 경로 기준으로 — 기준선 실패 1개 해소 허용), `market-cart-detail-link-contract`(21-28행), `market-home-ui-contract`(29-30), `market-home-list-integration-contract`(42, 47), `solvook-real-market-board-ui-contract`(199), `market-library-listboard-contract`(64-69), `market-listboard-ui-contract`(171), `market-listboard-zip-contract`(23), `market-listboard-no-direct-purchase-contract`(30), `studio-adoption-contract`(373) — 각 단언을 실제로 열어 링크 형태만 바꾼다.
- 브라우저: 8.11의 B-1.
- 되돌리기: 코드 revert(DB 변경 없음). redirect가 307이라 브라우저 캐시가 남지 않는다.

### 8.4 T1 — 트리 확장 마이그레이션(R2 전반)
- 작업 → 확인
  0. **착수 전 체크리스트(3.2 적용 절차, T3·S3·S4도 같음)**: Supabase MCP 인증 → `list_migrations` 조회 성공 → 운영 이력이 `20261002014653_market_image_refs`까지 로컬 파일과 일치. 하나라도 실패하면 T1을 시작하지 않는다.
  1. 3.6 Q-1 백업 → 파일 3개.
  2. M1 작성 + 신규 SQL 테스트 + `market_images.test.sql` 수정.
  3. 적용 전 객체 체크리스트 작성(Q-11). **dry-run**: MCP `execute_sql`로 `begin; <M1>; <Q-2~Q-7 assert DO 블록>; <market_category_tree.test.sql 본문>; rollback;` 결과 제시 → **사용자 승인**.
  4. `apply_migration` 적용 → Q-10(version 조회 → 로컬 파일명 변경), Q-11(체크리스트 전부 반영, 부분 적용 아님), Q-2~Q-7 기대값, `execute_sql` 재실행(Q-9) 무오류·이력 행 증가 0. `market_images.test.sql`(depth1 케이스 포함)·`market_category_tree.test.sql`을 `execute_sql`로 실행(승인 후, rollback).
  5. **타입은 재생성해 차이만 확인하고 커밋하지 않는다.** M1 뒤 타입을 반영하면 `market_category_items.Row.group_id`가 `string | null`이 되고 `Insert`에 `depth: number`가 필수가 되어, 지금 코드가 바로 컴파일 오류를 낸다(`src/lib/market-categories-server.ts` 64·66행과 380·391행의 `itemsByGroup.get/set(item.group_id)` TS2345, 138행 `.eq('id', item.group_id)`, 515행 부근 `createCategoryItem`의 insert에 `depth` 없음 — HEAD 401075d에서 직접 확인). `next build`도 타입 검사를 하므로(`next.config.ts`에 `ignoreBuildErrors` 없음) 커밋하면 배포가 깨진다. 절차: 재생성 → `git diff src/types/supabase.ts`로 parent_id·depth·group_id nullable·자기참조 FK가 있는지 확인 → `git checkout -- src/types/supabase.ts`로 원복 → `tsc` 새 오류 0(변경 없음). 재생성한 타입은 **T2 커밋 1(서버)과 함께** 반영한다(8.5).
  6. 이 단계의 커밋은 M1 파일(version 맞춘 이름)과 SQL 테스트 2개뿐이다(코드·타입 변경 없음).
  7. 운영 공개 화면(메가메뉴·항목 id 카테고리 페이지·광고 링크) 변화 없음. `/categories/{옛 그룹 id}`가 500인 것은 예상 동작(3.2 예외 — 링크 없음, T2에서 200이 됨).
- 사용자에게 알림: T2 배포 전까지 관리자 카테고리 편집 금지(3.2).
- 되돌리기: 3.8 T1 롤백(T2 전이면 1·3~5단계는 0행).

### 8.5 T2 — 트리 코드 배포(R3·R4·R5·R6·R7·R14, 상세 경로 재귀화)
- 커밋 순서(배포는 한 번에 — 공개 조회와 관리자 쓰기가 같은 시점에 그룹 테이블을 떠나야 하므로). **게이트 기준**: 커밋 1에서 서버의 `MegaMenuGroup`·`listMarketCategoryMenu`·그룹/항목 CRUD 6개를 지우고 재생성 타입을 넣으면, 커밋 3~8에서야 고쳐지는 사용처(카테고리 page·사이드바·메가메뉴 route·상세·groups/items 라우트·상품 client)가 그 사이 컴파일 오류를 낸다. 예전 export를 호환용으로 남기려 해도 재생성 타입(`group_id` nullable, `depth` 필수) 때문에 예전 구현이 그대로 컴파일되지 않는다. 그래서 **`tsc` 새 오류 0·`next build`·전체 기준선 비교(8.0-1·4·5)는 T2 마지막 커밋(배포 단위) 기준**으로 한다. 중간 커밋은 로컬 전용(푸시는 마지막 커밋 뒤 한 번)이고, 커밋마다는 그 커밋의 신규·수정 테스트만 통과시킨다:
  0. (착수 전) **T2-M 기준값 측정**: 아직 401075d 코드일 때 `category-pagination-server` 하네스로 카테고리 페이지 요청 1회가 하는 서버 호출 순서를 그대로 실행한다 — `getMarketCategoryItemDetail(id)` → `listMarketItemsForCategory(id, filters, detail)`(캐시 적중 기준: 메뉴는 0회). 캐시 미스 기준으로 `listMarketCategoryMenu(true)`의 호출 수도 따로 센다. 하네스의 `from()` 호출 기록을 테이블별로 세어 검증 기록에 남긴다(예상: 항목·그룹 조회 2 + 게시판 1 + 목록·보강 조회). 이 측정 코드는 T2 테스트에 그대로 옮겨 새 코드와 비교하는 데 쓴다.
  1. 서버(4.1~4.5, 순수 함수 모듈 `src/lib/market-category-tree.ts` 포함) + **M1 기준으로 재생성한 `src/types/supabase.ts`**(8.4-5에서 원복해 둔 것)를 같은 커밋에 넣는다 → `category-pagination-server` 트리 픽스처 테스트 통과(mocks에 `'@/lib/market-category-tree'` 추가), 쿼리 수 일정. `tsc`는 이 커밋에서 **서버 파일 자체의 오류 0**만 본다(사용처 오류는 마지막 커밋에서 0).
     - **T2-M 비교**: 같은 픽스처로 새 호출 순서를 두 기준으로 센다. ① 캐시 적중: `getMarketCategoryNodeDetail(id, cachedNodesTree)` → `listMarketItemsForCategory(id, filters, detail)`의 `from()` 호출 수가 **0번의 기준값 이하**인지 단언(트리를 인자로 넘기므로 노드 조회 0회). ② 캐시 미스: `listMarketCategoryTree(false)`(layout·노드 캐시) + `listMarketCategoryTree(true)`(개수 캐시) + 목록 조회의 `from()` 호출 수와, 그중 **직렬 구간**(노드 1쿼리 → [개수 트리 ‖ 목록])을 기록한다. 미스 값은 단언하지 않고 401075d 미스 값(0번 측정 때 `listMarketCategoryMenu(true)` 호출 수 포함)과 나란히 검증 기록에 적는다.
  2. 캐시 키·태그(4.3) → 계약 테스트.
  3. 카테고리 페이지 layout(404)·page·사이드바·loading(6.2) → 브라우저 B-2(없는 id·조상 비활성 id curl 404 포함).
  4. 메가메뉴·API(4.6, 6.1) → 계약 테스트(`?v=tree` 주소, `Array.isArray` 방어), B-2.
  5. 상세 경로 재귀(`findCategoryPath`) → depth4 상품 경로(T4 뒤 최종 확인).
  6. 관리자 노드 API(`route.ts` GET·POST, `[nodeId]/route.ts` PATCH·DELETE, groups/items 라우트 4개 삭제) + 상품 라우트의 트리 태그 무효화(4.3, DELETE 추가 포함) → 하네스 실행 테스트(아래), revalidateTag.
  7. 공용 편집기 + 카테고리 메뉴 관리 화면(5.1, 5.2) → B-3.
  8. 상품 관리 화면은 **최소 호환만**: 지금의 '카테고리(메가메뉴)' select가 새 GET 응답(재귀)을 읽도록 경로 라벨 옵션으로 바꾼다(전면 개편은 S2). `selectedCategoryDefaultImage` 재귀 탐색. → **이 마지막 커밋에서** `grep -rn "MegaMenuGroup\|listMarketCategoryMenu\|createCategoryGroup\|createCategoryItem\|AdminCategoryGroup" src` 0건, `npx tsc --noEmit` 새 오류 0, `next build` 성공, 전체 기준선 비교 새 실패 0 → 그 뒤에만 푸시.
- 테스트: 수정 `category-pagination-server`(트리 픽스처: 64개 4페이지 중복 없음, page 보정, depth1/2/3 노드 페이지가 하위 상품 포함, 조상 비활성 숨김(`getMarketCategoryNodeDetail` null), 하위 합산, 쿼리 수가 노드 수와 무관, **T2-M 페이지 요청 쿼리 수 ≤ 401075d 기준값**), `category-mega-menu-count-contract`(타입·countSpan·폴백·Cache-Control·`?v=tree`·`Array.isArray`), `market-images-admin-wiring`(노드 함수 이름, 201행 load mocks에 `'@/lib/market-category-tree'` 추가, `loadGroups` 정규식 → 편집기 기준), `market-images-contract`, `market-images-routes`, `market-images-display`(**64행 라우트 경로 목록의 `market-categories/items/[itemId]/route.ts` → `market-categories/[nodeId]/route.ts`**, **`revalidations.length` 기대값 갱신**: 상품 PATCH 카테고리 변경 1→2, 153행 항목 라우트 케이스 → 노드 라우트 `[default_image_id 2, title 2]`, 상품 DELETE 2 추가 — 4.3), `item-type-badge-order-contract`(45-51 픽스처)
  - 신규 **`tests/market-category-tree-node-api.test.mjs`(실행 테스트, `tests/helpers/market-images-harness.mjs`의 `createFakeAdmin`·`loadRoute` 사용)**:
    - **mocks**: `loadRoute`의 공통 mocks(`@/lib/supabase/server`·`@/lib/supabase/bypass`·`@/lib/read-all-query-rows`·`@/lib/market-images`)에 없는 의존을 명시해 넣는다 — `'@/lib/admin-workspace': { resolveAdminWorkspaceSubject: () => 'korean' }`(GET 라우트가 import), `'@/lib/market-categories-server'`는 서버 함수 단위 테스트용으로 실제 모듈을 `load('src/lib/market-categories-server.ts', { …, '@/lib/market-category-tree': load('src/lib/market-category-tree.ts') })`로, 라우트 테스트용으로는 가짜 함수로 넣는다. (Q14를 승인해 광고 경고를 넣는 경우에만 `'@/lib/main-ad-carousel-server': { getMainAdCarouselConfig }`를 추가 — 4.5.)
    - `deleteCategoryNode`: 하위(depth4)에 상품 행이 있는 depth2 → `MarketCategoryError` 409 + 안내 문구, 기록된 ops에 `delete` 호출 없음(노드·상품 연결 불변). 삭제된 상품만 있는 칸 → 409 문구에 `삭제된 상품 1개 포함`. 자식 칸만 있는 노드 → 409('하위 칸을 먼저…'), `delete` 없음. 상품·자식 없는 leaf → `delete().eq('id', leaf)` 호출. delete가 `{ error: { code: '23503', message: '… "market_items_category_item_subject_fkey" …' } }`면 상품 문구 409, `market_category_items_parent_subject_fkey`면 '하위 칸을 먼저 삭제해주세요.' 409.
    - `createCategoryNode`: 부모 depth5 → 400, `insert` 없음. 부모 과목 다름 → 400. 정상 → insert 값에 `depth = 부모+1`.
    - 노드 라우트 `route.ts`(GET·POST)와 `[nodeId]/route.ts`(PATCH·DELETE)를 `loadRoute`로 불러 `loggedIn: false` → 401, `isAdmin: false` → 403(네 메서드 모두), 성공 시 `revalidations`에 두 태그, 서버 함수가 409를 던지면 응답 409·`revalidations` 0. **제목 검증**: POST·PATCH에 `title: ''`(공백만 포함)·121자 제목 → 400, 서버 함수 미호출. 120자 → 통과.
    - `toMegaMenuTree` 순수 함수: depth3 이하가 결과에 없음, depth2 `itemCount`가 잘라내기 전 하위 합산과 같음, 원본 트리 불변. `findCategoryPath`·`collectSubtreeIds` 단위 테스트(depth4 경로, 하위 id 수).
  - 신규 `tests/market-category-tree-contract.test.mjs`(groups·items 라우트 파일 없음, DELETE 409 문구, POST depth5 부모 400, 노드 변경 시 두 태그 `revalidateTag`, 캐시 키 `'category-tree-with-counts'`·`'category-tree-nodes'`·revalidate 60·tags, **카테고리 page와 상세 page가 `'@/lib/market-category-tree-cache'`를 import하고 `/listMarketCategory(Menu|Tree)\(true\)/` 직접 호출이 없음(`getCachedCategoryTree` 사용)**, 카테고리 `layout.tsx`가 `getCachedCategoryNodes`와 `notFound(`를 씀, 편집기를 카테고리 관리 화면과 상품 화면이 같은 경로로 import(S2에서 상품 쪽 단언 추가), 화면 문구에 '2단계'·'3단계'·'그룹'·'항목' 없음, 메가메뉴 API가 `toMegaMenuTree(…, 2)`).
- 배포 후 운영 확인: 3.6 Q-6(depth null 0), 메가메뉴·카테고리 페이지·광고 링크 80·64, depth1 페이지(예: 'EBS' ID) 200(T1~T2 사이 500이던 옛 그룹 id 주소가 이제 정상).
- **T2~T3 사이 관리자 편집**: 허용한다. 새 코드로 만든 칸은 group_id가 null이지만 M2 안전 확인이 옛 구조 행만 보므로(3.4-1) T3을 막지 않는다. 단 B-3에서 만든 `zz-테스트` 칸은 B-3 끝에 지우고, **T3 직전 Q-12(0행)로 확인**한다.
- 되돌리기: **T3·T4 전에만** 코드 revert 단독으로 가능(M1이 남아 있어도 예전 코드가 동작 — 3.2 호환. T2 이후 만든 칸은 예전 화면에 안 보임). T4 후면 7.5 → T2 revert, T3 후면 3.8 T3 롤백 → T2 revert(3.9 매트릭스). Vercel Instant Rollback도 같은 조건을 따른다. 되돌린 직후 60초간 메가메뉴 형태 불일치는 예상 동작(6.1).

### 8.6 T3 — 트리 축소 마이그레이션(R2 후반)
- 작업 → 확인: 착수 전 체크리스트(3.2: Supabase MCP 인증·`list_migrations` 성공·이력 일치) → 선행 grep 두 개 0건(3.4) → Q-12(`zz-테스트` 칸 0행) → 객체 체크리스트(group_id 컬럼·FK·인덱스, 그룹 테이블, 함수) 작성 → **dry-run**(`execute_sql`로 `begin; <M2>; <Q-8 assert>; rollback;` — 3.4-1의 notice로 나온 '삭제된 그룹' id 목록을 사용자에게 보여 줌) → **승인** → `apply_migration` → Q-10(파일명), Q-11(체크리스트), Q-8, Q-9(`execute_sql` 재실행), **Q-2·Q-3은 T3 기준**(백업 id가 모두 존재하거나 의도적으로 삭제됨, 추가 행은 T2 이후 생성분) → 타입 재생성(`market_category_groups` 없음) → `tsc` 새 오류 0 → 타입 커밋, `market_images.test.sql`·`market_category_tree.test.sql` 다시 통과(승인 후 `execute_sql`).
- 되돌리기: 3.8 T3 롤백.

### 8.7 T4 — 국어 데이터 재배치(R11)
- 작업 → 확인: 7.4 절차 그대로(dry-run(노드 생성 예정 depth3 6·depth4 16 대조) → 승인 → apply(백업·생성 노드 기록은 고정 경로 `~/backups/create_quiz_ai/T4/`) → 검증 쿼리 → 재실행 무변경). `grep -rn "인문예술\|극수필\|갈래복합" src` 0건.
- 브라우저: B-4.
- 되돌리기: 7.5.

### 8.8 S2 — 상품 관리 화면·API(R8·R9, 게시판 의존 제거 2단계)
- 작업 → 확인
  1. (2a) `createMarketItem` 과목 = 카테고리 과목, POST `categoryItemId` 필수 → 카테고리 없는 POST 400, 다른 과목 400.
  2. (2b) POST `menuEntryId` 선택값, 기본 게시판 규칙(4.7) → menuEntryId 없이 201, 저장된 `menu_entry_id`가 규칙 쿼리 결과와 같음. **dry-run 성격 확인**: 적용 전 규칙 쿼리를 국어·영어로 SELECT해 어느 게시판이 뽑히는지 사용자에게 보여 준다.
  3. PATCH null 해제 거부(Q6) → `categoryItemId: null` 400. **PATCH 과목 불일치** → 다른 과목 `categoryItemId` 400('상품과 같은 과목의 카테고리를 선택해주세요.', 4.7의 '카테고리 항목' → '카테고리' 문구 정리 포함).
  4. GET `?categoryId=` 하위 포함 → depth2 id로 depth3·4 상품까지.
  5. 화면(5.3, 업로드 초안 흐름의 '카테고리를 먼저 선택해주세요.' 포함) → B-5.
  6. `grep -rnE "d3d504d6-|cdff2b06-" src` 0건.
- 테스트: 수정 `market-upload-draft-source-contract`(41-42 `resetForm(result.menu_entry_id)`, `ensureDraftItemForUpload`가 카테고리 미선택이면 POST 전에 중단), `market-products-admin-pagination-contract`(51), `market-images-display`(125 body에서 `menuEntryId` 대신 `categoryItemId`, **133행 `[IMAGE_ID, IMAGE_ID, 1, null]` 카테고리 null 케이스는 이제 400이 되므로** 기대값을 `status 400 · revalidations 0`으로 바꾼다 — 그 표의 `response.status === 200` 단언을 케이스별 기대 상태로 나눈다), `market-images-admin-wiring`(153 body) / 신규 `tests/market-admin-item-category-contract.test.mjs`(zod 필수·PATCH nullable 아님, 과목 결정이 카테고리에서, 기본 게시판 규칙이 쿼리로 되어 있고 UUID 리터럴 없음, 폼에 menuEntry select 없음, 필터 핸들러가 `setForm`을 부르지 않음, 편집기 import 경로가 카테고리 관리 화면과 같음) + **실행 검증**: `loadRoute('src/app/api/admin/market/items/[id]/route.ts', { mocks: { '@/lib/admin-workspace': …, '@/lib/market-categories-server': { getMarketCategoryItemWorkspaceSubject: async () => 'english' }, '@/lib/market-items-server': { getMarketItemById: async () => ({ …, workspace_subject: 'korean' }), updateMarketItem } } })`로 PATCH에 다른 과목 `categoryItemId`를 보내 **400 + 문구 '상품과 같은 과목의 카테고리를 선택해주세요.'**, `updateMarketItem` 미호출, `categoryItemId: null` → 400. POST도 같은 방식으로 카테고리 없음·다른 과목 400.
- 관리자 CRUD 수동 확인(승인 뒤): 먼저 **전용 테스트 칸 `zz-테스트`**(국어 depth1)를 만들고, 테스트 상품(`zz-테스트 상품`)을 그 칸에 연결한 **draft**로 만든다(공개 화면에 나오지 않음). 확인이 끝나면 테스트 상품을 관리자 화면의 삭제(= `DELETE /api/admin/market/items/[id]`, `hardDeleteMarketItemWithAssets` — hard delete. 화면에 soft delete 경로는 없다)로 지운 뒤 테스트 칸을 지운다. 마지막에 Q-13(테스트 상품 0)·Q-12(테스트 칸 0행) 확인. DB에 직접 써서 soft delete하지 않는다 — 카테고리가 필수라 soft delete된 상품이 칸에 남아 `productCount`에 잡히고 restrict 때문에 그 칸과 조상을 지울 수 없게 된다.
- 되돌리기: 코드 revert(DB 변경 없음. 이 단계에서 만든 상품의 menu_entry_id는 실제 게시판이라 그대로 유효).

### 8.9 S3 — 노출 조건·분류 필터(R12, 게시판 의존 제거 3단계. 메인 관리 설정은 Q8로 S0에서 삭제)
- 노출 조건(Q5 권장): **상품 `status='published' and is_active and deleted_at is null`만**. 카테고리 활성은 요구하지 않는다(카테고리 없는 영어 published 상품 1개 유지).
- 작업 → 확인
  0. 착수 전 체크리스트(3.2: Supabase MCP 인증·`list_migrations` 성공·이력 일치).
  1. 마이그레이션 M3 `<ts>_market_public_gate_without_board.sql`: `get_market_home_popular_items`를 `create or replace`로 게시판 join 없이(현재 정의는 `pg_get_functiondef`로 읽어 시그니처·반환 형태 그대로 유지), market_items 정책 'Authenticated users can read published market items'를 `drop policy if exists` → 게시판 exists 없이 다시 생성(현재 정의는 `pg_policies`로 확인). 적용 전 옛 정의(`pg_get_functiondef`·`pg_policies` 결과)를 `~/backups/create_quiz_ai/<날짜>-S3/`에 저장. **dry-run**(`execute_sql`로 `begin; <M3>; <정의 검사 DO 블록 — 'DRYRUN_RESULT'로 새 정의 반환>; rollback;`) → **승인** → `apply_migration` → Q-10·Q-11 방식(파일명, 체크리스트), `execute_sql` 재실행 무오류 → 정의에 `market_menu_entries` 없음, 홈 인기 목록 결과가 적용 전과 같은지 비교(게시판 모두 visible이라 같아야 함).
  2. 앱 게이트 제거: `market-search-server`(menuMap 필터), `market-categories-server`(트리 개수의 `visibleMenuIds`, 목록 게이트, `matchingMenuIds`), `market-home-server`(`loadVisibleMenus` 기반 recent·popular·count, `toItem`의 게시판 없으면 제외), `market-cart-server`(남은 게시판 조회), sample-pages route, `market-board-server`(275, 307) → `grep -n "is_visible" <해당 파일>` 0건.
  3. 행 타입 정리: `MarketSearchRow`·`MarketLibraryRow`의 `categorySlug`/`categoryTitle`(게시판 값) → `categoryId`/`categoryPath`. 서브상품의 `categorySlug`(question_pdf/hwp)는 그대로. 목록 행·카드의 부제는 카테고리 경로.
     - **경로 조립 방법**: `market-search-server`(과목 전체 검색)와 `listMarketLibraryRowsForUser`는 상품 조회와 **병렬로 활성 노드를 1쿼리**(`market_category_items.select('id, workspace_subject, parent_id, depth, title, sort_order, created_at').eq('is_active', true)`) 읽고, 순수 함수 모듈 `@/lib/market-category-tree`(4.1)의 `buildCategoryTree`·`findCategoryPath`로 메모리에서 경로를 만든다. 노드마다 쿼리하지 않는다. 캐시 모듈(`next/cache`)은 import하지 않는다(하네스로 load되는 모듈이라). `market-categories-server`의 `listMarketItemsForCategory`는 이미 받은 `detail`의 조상 경로를 쓰고 추가 쿼리를 하지 않는다. 비활성 칸이나 공개 트리에 없는 칸에 연결된 상품은 경로 없이(`categoryPath: []`) 둔다(Q5 — 노출은 상품 상태만으로 판단).
  4. 검색: `?category=`를 카테고리 id로. 패싯 단위 depth1~2 묶음(Q7): 상품의 depth2 조상(없으면 depth1) 기준 값, 선택하면 그 하위 전체. 예전 slug 값은 무시(전체 결과). 키워드 매칭은 게시판 제목 대신 카테고리 경로 제목.
  5. 보관함(library-view): '카테고리' 패싯·키워드를 카테고리 경로로.
  6. (삭제됨) 메인 관리 설정은 S0에서 설정 자체를 지웠으므로 S3에서 할 일 없음(5.4, Q8). 메인 설정 관련 테스트(`market-home-config-normalize` 신규, `market-home-admin-route-contract` 40·49행, `remove-home-source-section-contract` 41행 픽스처)는 S0에서 처리했다. S3에 남는 것은 게시판 게이트 단언(`market-home-contract` 28행, `market-home-admin-route-contract` 51행)뿐이다.
- 테스트: 수정 `market-home-contract`(28 게이트), `market-home-admin-route-contract`(51 게이트), `public-market-sample`(menuFilters is_visible 단언 → 게시판 조회 없음, **숨김 게시판 픽스처에서도 200**), `category-pagination-server`(숨김 게시판 제외 테스트 → **숨김 게시판이어도 목록·트리 개수에 노출**), `market-board-contract`(45-49, 120, 137), `market-menu-group-contract`(30), **`item-type-badge-order-contract`(56행 `load('src/lib/market-search-server.ts', …)` mocks에 `'@/lib/market-category-tree': load('src/lib/market-category-tree.ts')` 추가, `createFakeAdmin` 응답에 `market_category_items` 행 추가)**, **`market-images-display`(83행 `market-search-server` load mocks에 같은 키 추가, 가짜 admin이 `market_category_items`에 빈 배열을 돌려줘도 결과가 같은지 확인)**. 착수 때 `grep -ln "market-search-server.ts\|market-items-server.ts" tests/`로 같은 모듈을 고정 mocks로 load하는 테스트를 다시 찾아 같은 키를 넣는다
  - 신규 **`tests/market-public-gate-hidden-board.test.mjs`(실행 테스트)** — R12 acceptance '게시판을 is_visible=false로 바꾼 픽스처에서도 published 상품이 그대로 나온다'를 5곳 모두 실행으로 확인한다. 게시판 행은 전부 `is_visible: false`로 둔다:
    - 검색: `market-search-server.ts`를 `createFakeAdmin`으로 로드(`item-type-badge-order-contract`·`market-images-display` 56·83행과 같은 방식) → published 상품이 결과·패싯에 있음, `market_menu_entries` 조회 없음.
    - 홈: `market-home-server.ts`의 `getMarketHomeData`를 `createFakeAdmin`(`rpc` 가짜로 `get_market_home_popular_items` 응답) + mocks(`@/lib/supabase/bypass`, `@/lib/market-item-list-enrichment`)로 실행 → 최근·인기·공개 개수에 상품이 있음, `toItem`이 게시판 없다고 빼지 않음.
    - 장바구니: S1의 `market-cart-detail-href` 테스트를 그대로 유지(게시판 숨김 픽스처).
    - 카테고리·샘플 API: 위 `category-pagination-server`·`public-market-sample` 수정분.
    - 하네스로 불러올 수 없는 모듈이 나오면(의존 import가 mocks로 대체 불가) **그 사실과 대체 검증**(`market-public-gate-contract`의 grep 0건 + B-6 브라우저)을 S3 검증 기록에 적어, acceptance와 어긋나는 부분을 남긴다.
  - 신규 `tests/market-public-gate-contract.test.mjs`(공개 조회 파일에 `market_menu_entries`·`is_visible` 게이트 0건, 새 마이그레이션의 RPC 정의에 `market_menu_entries` 없음 — 옛 마이그레이션을 읽는 `market-home-download-ranking-contract`는 그대로 두고 새 파일을 별도로 검사). (`tests/market-home-config-normalize.test.mjs`는 S0에서 만든다 — 5.4.)
- 브라우저: B-6.
- 되돌리기: 코드 revert + M3 되돌리기(옛 RPC 정의·정책을 dry-run 때 저장해 둔 `pg_get_functiondef`·`pg_policies` 결과로 다시 생성).

### 8.10 S4 — 예전 화면 정리·카드 제거·nullable(R13, 게시판 의존 제거 4단계)
- **커밋·배포 구성(순서 고정)**:

  | 커밋 | 내용(아래 작업 번호) | 배포 단위 |
  |---|---|---|
  | S4-1 | 예전 목록 redirect(1) | **배포 A**: S4-1 + S4-2a를 함께 푸시. 운영에서 1의 307 curl과 B-7의 2a 항목을 확인한 뒤에만 2b로 간다 |
  | S4-2a | 공용 컴포넌트 이동(2a) | 배포 A |
  | S4-2b | 예전 page·layout·사이드바 삭제(2b) + `market-board-retirement-contract` 신설 | **배포 B**. S4-1(목록 redirect)은 반드시 S4-2b와 같은 배포이거나 그보다 먼저 운영에 있어야 한다(예전 목록 page를 지운 뒤 redirect가 없으면 예전 목록 주소가 404가 되는 창이 생김) — 배포 A를 먼저 하므로 충족 |
  | S4-3 | 메뉴관리 카드 제거(3) | 배포 C(S4-3~5 함께) |
  | S4-4 | `api/market/[slug]/items` 삭제(4) | 배포 C |
  | S4-5 | legacy 보관함 링크(5) | 배포 C |
  | S4-6 | M4 적용(6) 뒤 version 맞춘 마이그레이션 파일 커밋 | DB 단계(코드 배포 없음) |
  | S4-7 | 타입 재생성(`menu_entry_id: string \| null`)·기본 게시판 지정 제거·`menuEntryId` 스키마 제거(7) | **배포 D**(M4 적용 뒤에만 — null 저장이 DB에서 허용돼야 함). **배포 D 운영 확인일 = 308 전환 2주 기준일**(P12, 아래 9번) |

  `market-board-retirement-contract`는 S4-2b에서 신설하되 그 시점에 참인 단언(예전 파일·사이드바·layout 부재, 옮긴 컴포넌트 위치, `@/app/(dashboard)/market` import 0건, 목록 redirect, 게시판 목록 링크 조립 0건)만 넣고, 메뉴관리 카드 부재는 S4-3 커밋에서, 상품 API `menuEntryId` 부재는 S4-7 커밋에서 같은 파일에 추가한다(아직 지우지 않은 대상 때문에 앞 커밋의 '기준선 대비 새 실패 0' 게이트가 깨지지 않게).
- 작업 → 확인
  1. 예전 목록 redirect(Q9 결정 목적지, `permanent: false` = 307 — 308 전환은 8.12, **상세 redirect 3종보다 뒤에** 선언): `/:subject(english|korean)/market` · `/:subject(english|korean)/market/:slug` · `/:subject(english|korean)/market/:slug/board-preview` → `/?subject=:subject`, `/market` · `/market/:slug` · `/market/:slug/board-preview` → `/`, `/preview/solvook-concept/boards/:slug` → `/`(쿼리 `?subject=` 유지) → 각 경로 307.
  2. **예전 화면 정리 — 이동 커밋(2a)과 삭제 커밋(2b)으로 나눈다(사용자 결정 Q10·D13, P9)**.
     - **2a — 공용 컴포넌트 이동(별도 커밋, 동작 변화 없음)**: `git mv`로 `src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx` → `src/components/market/market-item-actions.tsx`, 같은 폴더의 `market-sample-preview-dialog.tsx` → `src/components/market/market-sample-preview-dialog.tsx`(파일 이름 그대로. `market-item-actions.tsx` 안의 `./market-sample-preview-dialog` 상대 import는 같이 옮기므로 그대로 유효).
       - import 갱신: 이름만으로 찾으면 관리자 전용 `admin-market-sample-preview-dialog`(옮기지 않음)까지 부분 일치하므로, **예전 경로를 포함한 패턴**으로 찾는다:
         ```bash
         grep -rnE "items/\[itemId\]/market-(item-actions|sample-preview-dialog)|from '\./(market-item-actions|items/\[itemId\]/market-sample-preview-dialog)'" src
         ```
         찾은 파일을 `@/components/market/…`로 바꾼다. 조사 시점(2026-10-12) 결과 7곳: 실제 사이트 `preview/solvook-concept/_components/detail/market-material-detail.tsx`(`market-item-actions`), `_components/market-material-list.tsx`, `_components/detail/market-material-sample-button.tsx`, `(solvook)/search/_components/search-view.tsx`, `(solvook)/categories/[id]/_components/category-items-view.tsx`(이상 4곳 `market-sample-preview-dialog`), 그리고 2b에서 지울 예전 파일 `(dashboard)/market/[slug]/items/[itemId]/page.tsx`(`./market-item-actions`)·`(dashboard)/market/[slug]/market-listboard-client.tsx`(`./items/[itemId]/market-sample-preview-dialog`)도 2a가 단독으로 빌드되도록 함께 바꾼다. `market-item-actions.tsx` 안의 `./market-sample-preview-dialog`는 같이 옮기므로 그대로 둔다. **`(admin)/admin/market/products/market-products-client.tsx`는 대상이 아니다**(66행 `./admin-market-sample-preview-dialog` — 관리자 전용 별도 컴포넌트, P9).
       - 경로 계약 테스트 갱신: `grep -rln "market-item-actions\|market-sample-preview-dialog" tests`는 15개 파일을 돌려주지만(조사 시점 2026-10-12) 실제로 경로를 바꿀 것은 **12개 파일·15줄**이다. 나머지는 손대지 않는다.
         - **경로 갱신 12개(단언 내용은 그대로, 경로만 `src/components/market/…`로)**: `market-sample-preview-sticky-header-contract`(7), `market-purchase-complete-dialog-contract`(9), `market-v2-detail-library-contract`(11), `market-hwp-bundle-contract`(18), `market-sample-preview-performance-contract`(6), `market-listboard-ui-contract`(18), `market-sample-pages-api-contract`(12·20), `market-item-detail-ui-contract`(10), `market-bundle-savings`(77), `purchase-section-redesign-contract`(7), 그리고 **import 문을 이스케이프된 정규식으로 단언하는 2개** — `solvook-real-market-board-ui-contract`(140), `market-detail-multiselect-contract`(**8 경로 + 140 정규식**). `market-detail-multiselect-contract`는 8행 `const itemActions = read('../src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx')`(모듈 최상단 — 빠뜨리면 ENOENT로 파일 전체(현재 12개 테스트 통과)가 새로 실패)를 경로 문자열 치환으로, 140행을 정규식 재작성으로 고친다(2026-10-12 grep으로 두 줄 모두 확인). 140행 두 곳은 경로 문자열 치환으로 고쳐지지 않으므로 정규식을 `/from '@\/components\/market\/market-sample-preview-dialog'/`, `/import MarketItemActions from '@\/components\/market\/market-item-actions'/`처럼 다시 쓴다.
         - **변경 없음 2개(금지어 `doesNotMatch` 정규식이라 경로가 아님)**: `market-board-preview-route-contract`(35 — 이 파일은 2b에서 파일째 삭제), `studio-adoption-contract`(377). `market-listboard-ui-contract` 175행도 같은 금지어 정규식이라 그대로 둔다(이 파일은 18행만 갱신).
         - **관계없음 1개**: `market-admin-sample-preview-ui-contract`(17 — 관리자 전용 `admin-market-sample-preview-dialog.tsx` 경로. 바꾸면 ENOENT로 새 실패).
       - 착수 직전: 8.0-4 명령을 그대로 돌려 결과를 `"$OUT/pre-2a-failures.txt"`로 저장한다(2a 직전 실패 목록).
       - 확인: `grep -rnF "items/[itemId]/market-item-actions" src tests`·`grep -rnF "items/[itemId]/market-sample-preview-dialog" src tests` 0건, 이스케이프된 정규식 형태도 `grep -rnF 'itemId\]\/market-' tests` 0건, `tsc` 새 오류 0, eslint, **`next build` 성공**, **전체 기준선 비교 새 실패 0**(8.0-4)에 더해 **2a 직전과 실패 목록이 양방향으로 같음**: `LC_ALL=C comm -3 "$OUT/pre-2a-failures.txt" "$OUT/current-failures.txt"` 0줄(경로만 바꿨으므로 새로 생긴 실패도, 사라진 실패도 없어야 한다. S0 기준선만 보면 S1~S3에서 고쳐진 실패 때문에 판정이 흐려지고, 경로를 잘못 바꿔 같은 이름의 기준선 실패 뒤로 숨는 경우를 놓친다). 브라우저로 상세 구매 영역·샘플 미리보기 팝업(상세·검색 카드·카테고리 목록 행·홈 목록) 정상(B-7). 관리자 상품 화면의 샘플 미리보기는 별도 컴포넌트(`admin-market-sample-preview-dialog`)라 이 이동의 영향이 없으므로 확인 대상에서 뺀다. 이 게이트를 운영(배포 A)에서도 통과해야 2b로 간다. 커밋 `refactor: 상품 상세 구매 영역·샘플 미리보기 팝업을 src/components/market으로 이동`.
       - **시점을 S4보다 앞당기지 않는 이유**: 이동은 DB와 무관하고 동작이 바뀌지 않는 경로 변경이라 어느 단계에서 해도 위험이 같다. S1~S3은 이 두 파일을 고치지 않으므로(S1은 `market-material-detail.tsx`의 prop만, S3은 서버 파일) 앞당겨도 줄어드는 위험이 없고, 오히려 S1·S3의 기준선 비교에 이동 영향이 섞이며 같은 계약 테스트 파일(`market-listboard-ui-contract`, `solvook-real-market-board-ui-contract` — S1·S4-2a·S4-2b에서 모두 고침)을 손대는 횟수가 늘어난다. 2b 바로 앞에 두면 '이동 → build·기준선 → 삭제' 게이트가 한 단계 안에서 이어진다. 단, S4 전에 다른 작업이 이 두 파일을 고쳐야 하면 그 작업 전에 2a만 먼저 해도 된다(2a는 단독으로 안전).
     - **2b — 예전 page·layout·사이드바 삭제(별도 커밋, 2a 통과 뒤)**: 예전 market 라우트 폴더 두 곳을 통째로 지운다 — `src/app/(dashboard)/market/**`(`page.tsx`, `layout.tsx`, `market-sidebar.tsx`, `[slug]/page.tsx`·`loading.tsx`, `[slug]/board-preview/page.tsx`, `[slug]/items/[itemId]/page.tsx`·`loading.tsx`, 그리고 이 page들이 사라지면 사용처가 0이 되는 `[slug]/market-listboard.tsx`·`market-listboard-client.tsx` — 삭제 전 `grep -rn "market-listboard" src`로 폴더 밖 사용처 0 확인), `src/app/[workspaceSubject]/market/**`(`page.tsx`, `layout.tsx`, `[slug]/page.tsx`, `[slug]/board-preview/page.tsx`, `[slug]/items/[itemId]/page.tsx`). 그리고 `preview/solvook-concept/boards/[slug]/page.tsx`, `boards/[slug]/items/[itemId]/page.tsx`(S1의 stub). `boards/[slug]/posts/[postId]`(샘플 데모)는 남긴다. 이 삭제로 사용처가 0이 된 lib 함수(예: `getVisibleMarketMenuEntryBySlugForWorkspace`, 게시판 단위 목록 함수, `market-board-server`)도 grep으로 확인 후 제거.
       - `tests/menu-divider-management.test.mjs` 수정: 29-32행 `marketSidebarSource`(모듈 최상단 `readFileSync` — 그대로 두면 ENOENT로 파일 전체가 새로 실패)와 67행 `assert.match(marketSidebarSource, /WorkspaceSecondLevelSidebar/)`를 지운다. 나머지 사이드바 단언은 그대로.
       - **지운 파일을 읽는 그 밖의 테스트(조사 시점 2026-10-12, 줄 번호는 2a 갱신 뒤에도 같음)**. 모듈 최상단 `readFileSync`로 읽는 파일은 ENOENT로 **파일 전체**가 실패하므로, 2a에서 새 경로로 갱신한 `market-item-actions`·`market-sample-preview-dialog` 단언까지 함께 사라진다. 그래서 일반 규칙('대상이 사라진 것은 삭제')을 파일 단위로 적용하지 않는다:
         - **섞인 파일 — 지운 page·listboard를 읽는 최상단 상수와 그 상수를 쓰는 단언만 지우고, 옮긴 컴포넌트와 그 밖의 살아 있는 대상(마이그레이션·타입·관리자 API·상품 화면·`market-items-server`·batch route 등) 단언은 유지**:
           - `market-products-admin-material-info-contract` 14행 `itemPage`(예전 상세 page) — 2a의 grep에도 걸리지 않는다. 60행 테스트 'public detail page prefers explicit question_count…'는 `itemPage` 단언을 지우거나, 같은 규칙을 지금 쓰는 실제 상세(`market-material-detail.tsx` 등)로 대상을 바꾼다(구현 때 실제 코드를 열어 판단하고 기록). 16·26·37행 테스트(마이그레이션·타입·관리자 API·상품 화면)는 그대로.
           - `market-detail-multiselect-contract` 9행 `dashboardDetailPage` — 138행 테스트 'both detail routes render the shared MarketItemActions'에서 `dashboardDetailPage` 단언만 지운다(남는 상세는 `market-material-detail.tsx` 하나).
           - `market-sample-pages-api-contract` 7-10행 `itemPage` — 56행 테스트의 `itemPage` 단언만 지우고 `itemActions`·`sampleDialog` 단언은 유지.
           - `market-item-detail-ui-contract` 5-8행 `itemPage` — `itemPage` 단언만 지운다(예: 17행). `itemActions` 단언 유지. `itemPage` 단언뿐인 테스트는 삭제하고 기록.
           - `market-v2-detail-library-contract` 6-9행 `itemPage` — 같은 방식(33행 테스트 등).
           - `market-hwp-bundle-contract` 13-16행 `listboardClient` — 57행 테스트에서 listboard 단언만 지운다. `marketPurchase`·`itemActions`·download/batch route 단언 유지.
           - `market-listboard-ui-contract` 5-12행 `listboardServer`·`listboardClient` — listboard 단언만 지우고 `samplePreviewDialog`(51-67행의 포커스 복귀 단언)·`marketItemsServer` 단언은 유지.
           - `market-listboard-zip-contract` 6·7행, `market-listboard-no-direct-purchase-contract` 5-12행 — listboard 단언을 지우고 남는 `listApi`(4번에서 지움)·`itemsServer`·batch route 단언은 대상이 살아 있으면 유지.
           - `market-home-source-filter-contract` 26-41행 테스트(테스트 안에서 예전 `[slug]/page.tsx`·`market-listboard.tsx`·`[workspaceSubject]/market/[slug]/page.tsx`를 읽음) — 이 테스트만 삭제(49-51행은 4번에서 처리).
           - `studio-adoption-contract` 33-40행 `marketListboardServerUrl`·`marketListboardClientUrl`과 이를 읽는 344-380행 테스트 — 이 테스트만 삭제(나머지 테스트 유지).
         - **예전 화면 전용 — `market-board-preview-route-contract.test.mjs`는 파일째 삭제한다**(하나로 정함). 이 파일은 10·11행 존재 단언 말고도 13행(첫 테스트)과 18행(두 번째 테스트 'board preview route reuses the production market board component')에서 지울 page를 `readFileSync`로 읽으므로 10·11행만 부재 단언으로 바꾸면 두 테스트 모두 실패하고, 파일을 남기면 그 안의 `(dashboard)/market`·`[workspaceSubject]/market` 경로 문자열이 아래 확인 grep의 허용 목록(retirement 계약·`market-purchase-complete-dialog-contract`뿐)에 걸린다. 두 board-preview page(`(dashboard)/market/[slug]/board-preview/page.tsx`, `[workspaceSubject]/market/[slug]/board-preview/page.tsx`)의 **부재 단언은 신설하는 `market-board-retirement-contract`로 옮긴다**(예전 page 파일 부재 단언에 포함). 위 섞인 파일에서 단언을 지운 뒤 남는 테스트가 없으면 그 파일도 삭제한다.
         - 어느 처리든 지운 테스트 이름과 이유를 S4 검증 기록에 적는다.
       - 확인: `find "src/app/(dashboard)/market" "src/app/[workspaceSubject]/market" -type f` 결과 없음(폴더 없음), `grep -rnF "@/app/(dashboard)/market" src` 0건, `grep -rln "market-sidebar" src` 0건(tests에서는 부재를 단언하는 `market-board-retirement-contract`만 남음), `grep -rln "(dashboard)/market\|\[workspaceSubject\]/market" tests` 결과가 `market-board-retirement-contract`와 존재하지 않음을 단언하는 `market-purchase-complete-dialog-contract`(61행 `existsSync(...market-purchase-complete-dialog.tsx) === false`)뿐(`market-board-preview-route-contract`는 파일째 지웠으므로 나오지 않는다. 그 밖의 파일이 나오면 위 목록에서 빠진 것이므로 같은 규칙으로 처리), `tsc` 새 오류 0, **`next build` 성공**, 기준선 비교 새 실패 0, 예전 주소들이 1번 redirect(307)로 새 주소에 도착(B-7).
  3. 메뉴관리 '문제마켓 2단계 메뉴 관리' 카드(`menu-management-client.tsx:1245~`)와 관련 action·state 제거, `actions.ts`의 `revalidatePath('/preview/solvook-concept/boards/[slug]', 'page')` 제거 → `admin-phase1a-contract`(30) 갱신. 예전 헤더의 `/market` children 병합은 남겨도 redirect를 타므로 동작한다. 이 단계에서는 고치지 않지만, S4 뒤에도 앱 안에 남는 **예전 출발 경로 링크**(헤더 `/market` 시스템 링크와 병합된 children, WorkspaceLanding 바로가기, `workspace-routes.ts:80`의 market 경로 — 8.12-3 목록)는 308 전환 전에 사용자에게 처리 방침을 묻는다(8.12).
  4. `src/app/api/market/[slug]/items/route.ts` 삭제(호출처 0) → `market-home-source-filter-contract`(49-51) 갱신.
  5. legacy 보관함 `browseMarketHref` → `/?subject=`.
  6. (착수 전 체크리스트 3.2: Supabase MCP 인증·`list_migrations` 성공·이력 일치) 마이그레이션 M4 `<ts>_market_items_menu_entry_nullable.sql`: `alter column menu_entry_id drop not null`(재실행 안전), FK `market_items_menu_entry_id_fkey`의 `confdeltype`이 `'n'`이 아니면 drop 후 `on delete set null`로 다시 추가. **dry-run(`execute_sql`, begin…rollback) → 승인 → `apply_migration`** → Q-10·Q-11 방식(파일명, 체크리스트), `execute_sql` 재실행 무오류 → `information_schema.columns.is_nullable = 'YES'`, `information_schema.referential_constraints.delete_rule = 'SET NULL'`.
  7. 타입 재생성(`menu_entry_id: string | null`) → 남은 사용처 정리, `createMarketItem`/`updateMarketItem`의 기본 게시판 지정 제거(새 상품은 null), POST·PATCH 스키마에서 `menuEntryId` 제거 → `tsc` 새 오류 0.
  8. `menu_entry_id`가 null인 테스트 상품으로 상세·검색·카테고리·장바구니·보관함 링크 정상(국어·영어, B-7). 절차는 8.8과 같다: 승인 후 과목별 전용 칸 `zz-테스트`(영어는 빈 트리라 depth1 테스트 칸을 먼저 만듦)에 연결한 테스트 상품 `zz-테스트 상품`을 만들고(공개 경로 확인이 필요하므로 이번에는 published), 확인이 끝나면 관리자 DELETE(hard delete)로 지운 뒤 테스트 칸을 지운다 → Q-13 = 0, Q-12 = 0행.
  9. **(마지막 확인 항목 — 308 전환 2주 기준일, P12)** 배포 D가 운영에서 확인되면(M4 검증은 그 전에 끝남) 그날을 **2주 기준일**로 S4 검증 기록에 적는다(기준일 + 14일 = 8.12 점검일도 함께). 같은 날 8.12-2②의 로그 수집을 시작한다: S1에서 기록한 보존 기간·Drain 유무(8.3-5)를 대시보드에서 다시 확인하고, Log Drain(또는 보존 기간이 14일 이상인 Observability 설정)이 있으면 그 설정이 켜져 있는지 확인하고, 없으면 8.12-2②의 캡처 일정(보존 기간이 1일 이하면 매일 14회, 그보다 길면 빈틈이 없는 주기 — 예: 보존 3일 이상이면 1·4·7·10·14일)을 검증 기록에 날짜로 적고 첫날 캡처를 한다. 이 항목을 하지 않으면 S4를 완료로 보지 않는다.
- 테스트: 위 계약 테스트 갱신. 2번에서 지우는 `preview/solvook-concept/boards/[slug]/page.tsx`를 읽거나 존재를 단언하는 테스트를 **명시적으로** 고친다: `solvook-preview-flow-contract`(75행 `assertFileExists(boardPagePath)` — 7행 `boardPagePath`), `solvook-real-market-board-ui-contract`(6행 경로 상수와 그 경로를 읽는 단언), `studio-adoption-contract`(10행 `boardPageUrl`, 57행 파일 목록). 각 단언은 파일 부재·redirect 단언으로 바꾸거나, 대상이 사라져 의미가 없으면 삭제하고 검증 기록에 적는다. `boards/[slug]/posts/[postId]`(샘플 데모, 게시판 DB와 무관)는 지우지 않으므로 그 단언은 그대로. 착수 때 `grep -ln "boards/\[slug\]" tests/`로 다시 찾는다. 예전 화면을 직접 단언하던 그 밖의 테스트 중 대상이 사라진 것은 삭제하고 기록 / 신규 `tests/market-board-retirement-contract.test.mjs`(예전 page 파일 없음 — 삭제하는 `market-board-preview-route-contract`가 존재를 단언하던 board-preview page 2개 포함, **옮긴 공용 컴포넌트 2개(`src/components/market/market-item-actions.tsx`, `src/components/market/market-sample-preview-dialog.tsx`) 존재·예전 경로에 없음, `market-sidebar.tsx`와 예전 market `layout.tsx` 2개 없음, src에 `@/app/(dashboard)/market` import 0건**(Q10), next.config 목록 redirect(`permanent: false` — 8.12에서 `true`로 바꿈), 메뉴관리 카드 없음, 상품 API에 menuEntryId 없음, **src에 게시판 목록 링크 조립 `/solvook-concept\/boards\/\$\{/` 0건**(S1 계약에서 넘겨받은 검사. 게시판 DB와 무관한 샘플 데모 `src/app/preview/solvook-concept/_components/detail/material-detail.tsx`(`posts/[postId]`용, 남김)는 검사에서 제외. `real-market-board*.tsx`는 2번에서 사용처가 0이 되어 지워지거나, 남는다면 링크를 `/?subject=`로 바꾼다)). `menu-divider-management`와 위 '지운 파일을 읽는 그 밖의 테스트'는 2b에서 고친다. 2a의 경로 계약 테스트 12개는 2a 커밋에서 갱신한다. **retirement 계약의 커밋 시점**: S4-2b에서 신설(파일·사이드바·layout·import·목록 redirect·게시판 목록 링크 단언), 메뉴관리 카드 부재는 S4-3에서, 상품 API `menuEntryId` 부재는 S4-7에서 같은 파일에 추가(위 커밋 표). 2a 커밋에는 넣지 않는다(아직 지우지 않은 파일 때문에 2a 게이트가 실패). supabase/tests의 게시판 픽스처 SQL(`market_cart_checkout` 등)은 그대로 동작하는지만 확인.
- 되돌리기: 코드 revert는 **뒤 커밋부터 역순**(S4-7 → (M4 되돌리기가 필요하면 이 시점, 아래 조건) → S4-5 → S4-4 → S4-3 → S4-2b → S4-2a → S4-1)으로, 각 revert 뒤 `next build`·기준선 비교·B-7 curl을 한다. 앞 커밋만 골라 되돌리지 않는다 — 예: S4-7 뒤에 S4-2b만 되돌리면 되살아난 예전 page가 nullable 타입(`menu_entry_id: string | null`)에서 `tsc`·`next build` 오류를 낼 수 있다. **2a 단독 revert는 2b가 없을 때만** 가능하다(2b 뒤에는 2a revert가 지워진 예전 파일의 import 변경과 충돌). redirect가 307이라 revert하면 바로 예전 화면으로 돌아간다(308 전환 뒤에는 그렇지 않음 — 8.12). M4는 null 상품이 없을 때만 `set not null` + cascade FK로 되돌릴 수 있다(null 상품이 생겼으면 기본 게시판으로 채운 뒤).

### 8.11 브라우저 확인 시나리오(국어·영어)

| ID | 단계 | 시나리오 |
|---|---|---|
| B-0 | S0(Q8) | 국어·영어 각각: 관리자 '(임시) 문제마켓 메인 관리' 화면에 '문제마켓 카테고리' 카드가 **없음**, 인기·최근 카드는 그대로. (승인 후 — 로컬 dev도 운영 DB) 인기·최근 값을 기본값과 다르게 바꿔 저장 → 200 → 새로고침해도 바뀐 값 유지 → 공개 홈(`/?subject=korean`, `/?subject=english`)의 인기·최근 개수가 저장값대로. (가능하면) S0 배포 **전에** 열어 둔 관리자 탭(예전 번들 — `categories`를 함께 보냄)에서 저장해도 200이고, 재조회한 `workspace_settings.value`에 `categories` 키가 없음. 공개 홈 국어·영어가 오류 없이 정상. **정리**: 이 확인으로 `market_home` 행이 생기므로, 끝나면 승인된 일회성 delete(`select`로 대상 행 제시 → dry-run `begin; delete … where setting_key = 'market_home'; select …; rollback;` → 승인 → 실행 → 재조회 0건)로 지워 기본값 상태(5.4 '되돌리기'의 0건 전제)로 돌린다. 지우지 않기로 하면 그 사실을 S0 검증 기록에 적고, 이후 S0 revert는 5.4의 '1건 이상' 절차를 따른다 |
| B-1 | S1 | 국어: 홈 인기·최근, 검색 카드, 카테고리 목록 행, 장바구니, 보관함에서 상품 클릭 → `/items/{id}?subject=korean`, 헤더 1개, 경로 표시, 사이드바. 예전 주소 3종 직접 입력 → 새 주소(curl로 307과 Location 확인 — `/korean/market/{slug}/items/{id}`는 `/items/{id}?subject=korean`, `/market/{slug}/items/{id}`와 쿼리 없는 preview 상세는 `/items/{id}`이고 브라우저 최종 URL에서 `?subject=korean`이 붙음, 6.4). `/items/not-a-uuid` → Solvook 헤더·푸터가 있는 not-found 화면(`(solvook)/not-found.tsx`) + curl 404. `/items/{국어 id}?subject=english` → 최종 URL `?subject=korean`. 영어: published 상품 1개 상세(카테고리 없음 → `홈 > 상품`), `/items/{englishId}`(쿼리 없음) → `?subject=english`. 영어 탭 헤더 표시 확인 |
| B-2 | T2 | 국어: 메가메뉴 depth1(링크)·depth2와 `(N)`, depth1 'EBS' 페이지에서 하위 전체 상품·경로·DetailFinder(depth2 자식), 광고 두 링크 80·64, depth2 사이드바 펼침, 좁은 화면 줄바꿈. **404**: `curl -s -o /dev/null -w '%{http_code}' '<host>/categories/00000000-0000-4000-8000-000000000000?subject=korean'`(없는 id)·`/categories/not-a-uuid` = 404, 화면은 Solvook 헤더가 있는 not-found. 조상 비활성 404는 B-3에서 확인. 영어: 메가메뉴 빈 상태 오류 없음, 영어 홈·검색 정상 |
| B-3 | T2 | (승인 후) 관리자 카테고리 메뉴 관리 국어: `zz-테스트` depth1 → depth2~5 추가, depth5에 [하위 추가] 없음. **depth5 사이드바(R4)**: 테스트 칸을 지우기 전에 `/categories/{zz-테스트 depth5 id}?subject=korean`을 열어 사이드바가 depth1~5까지 펼쳐지고 w-56 안에서 들여쓰기·줄바꿈이 깨지지 않는지(넓은 화면·좁은 화면 모두) 확인한다(노드 변경은 캐시 태그 무효화로 카테고리 페이지에 즉시 반영). **조상 비활성 404(R3)**: `zz-테스트` depth2를 비활성으로 바꾼 뒤 그 아래 depth4 id의 카테고리 페이지가 curl 404·not-found 화면, 다시 활성화. 상품 있는 칸('수능특강 독서 변형문제') 삭제 시 안내·트리 그대로, 새 탭 링크 `?subject=korean`. **depth1 기본 이미지(R14)**: `zz-테스트` depth1에 이미지 라이브러리의 테스트 이미지를 기본 이미지로 지정 → '이미지 관리'에서 그 이미지의 사용처에 해당 칸이 표시 → 그 이미지 삭제 시도 → 409(IN_USE) 안내 → depth1 기본 이미지 해제. 마지막에 테스트 칸 전부 삭제(leaf부터) → T3 전 Q-12 0행. 영어: 빈 트리에서 depth1 추가 후 삭제. **반영 시점**: 카테고리 페이지 사이드바는 즉시(태그 무효화), 헤더 메가메뉴는 `/api/market/category-menu`가 `unstable_cache` 태그가 아니라 `Cache-Control: public, max-age=60, s-maxage=60`(CDN·브라우저 캐시)라 **최대 60초 뒤** 반영(10절) |
| B-4 | T4 | 국어: `수능특강 문학 변형문제` 페이지 80개·DetailFinder에 depth3 3칸, `2부 적용학습` 페이지 경로 `국어 > EBS > 수능특강 문학 변형문제 > 2부 적용학습`·자식 6칸, depth4 '현대소설' 페이지 11개·사이드바 depth1~3 펼침, 말단에서 형제 강조, depth4 상품 상세 경로 `홈 > EBS > … > 현대소설 > 상품명`, 독서 '3부 실전학습' 0개 빈 상태 |
| B-5 | S2 | (승인 후, 테스트 상품은 전용 칸 `zz-테스트`에 연결한 draft로 만들고 끝나면 관리자 DELETE로 지운 뒤 칸 삭제 → Q-13·Q-12) 상품 관리 국어: 새 상품 카테고리 미선택 저장 막힘, **카테고리를 고르기 전 파일 업로드 시도 → '카테고리를 먼저 선택해주세요.' 안내, draft가 생기지 않음(목록에 새 행 없음), 카테고리 선택 뒤 업로드하면 draft 생성**, 단계별 선택·경로·하위 권장 안내, [카테고리 관리] 팝업에서 칸 추가 → 닫으면 선택칸에 바로 보임, 상단 필터 depth2 → 하위 상품 포함, 편집 중 필터 변경 후 저장해도 카테고리·게시판 그대로, 게시판 select 없음. 영어: 미지정 상품 수정 시 카테고리 선택 요구, 빈 트리면 팝업에서 depth1 추가 후 선택 |
| B-6 | S3 | 국어·영어: 검색 '카테고리' 패싯이 카테고리 이름, 선택 시 하위 포함 결과, 예전 `?category=entexam` 주소는 전체 결과. 보관함 패싯. 홈 인기·최근 목록이 S3 전과 같음. 영어 published 상품이 검색·홈에 계속 보임 |
| B-7 | S4 | **redirect 전체 curl**(`curl -s -o /dev/null -w '%{http_code} %{redirect_url}'`, 배포 A 뒤와 배포 B 뒤 각각 — 기대 상태 **307**). 8.10-1 목록 규칙 7개와 6.4 상세 규칙 3개를 하나씩 연다: 목록 ⓐ `/korean/market` → `/?subject=korean` ⓑ `/korean/market/{slug}` → `/?subject=korean` ⓒ `/korean/market/{slug}/board-preview` → `/?subject=korean` ⓓ 영어 `/english/market`·`/english/market/{slug}`·`/english/market/{slug}/board-preview` → `/?subject=english` ⓔ `/market` → `/` ⓕ `/market/{slug}` → `/` ⓖ `/market/{slug}/board-preview` → `/` ⓗ `/preview/solvook-concept/boards/{slug}?subject=korean` → `/?subject=korean`(쿼리 유지) ⓘ `/preview/solvook-concept/boards/{slug}`(쿼리 없음) → `/`. 상세(S1 규칙이 예전 page 삭제 뒤에도 그대로 동작하는지) ⓙ `/preview/solvook-concept/boards/{slug}/items/{id}?subject=korean` → `/items/{id}?subject=korean` ⓚ `/korean/market/{slug}/items/{id}` → `/items/{id}?subject=korean` ⓛ `/market/{slug}/items/{id}`·`/preview/solvook-concept/boards/{slug}/items/{id}`(쿼리 없음) → `/items/{id}`(P11), 브라우저 최종 URL `/items/{id}?subject=korean`. 국어: 메뉴관리 카드 없음, menu_entry_id null 테스트 상품의 상세·검색·카테고리·장바구니·보관함 링크. **영어**: 위 ⓓ의 도착 화면이 영어 홈(헤더 영어 탭), 영어 `menu_entry_id` null 테스트 상품(영어 트리가 비어 있으면 depth1 테스트 칸 `zz-테스트`를 먼저 만들어 연결)의 상세(`?subject=english`, 헤더 영어 탭)·검색·카테고리·장바구니·보관함 링크. 끝나면 테스트 상품 관리자 DELETE → 테스트 칸 삭제 → Q-13·Q-12. **컴포넌트 이동(S4-2a, Q10) 확인**(배포 A 뒤, 2b 전): 국어·영어 상세의 구매 영역(담기·구매 버튼, 선택 항목), 샘플 미리보기 팝업을 상세·검색 카드·카테고리 목록 행·홈 목록에서 열어 정상. 관리자 상품 화면의 샘플 미리보기는 별도 컴포넌트(`admin-market-sample-preview-dialog`)라 이동의 영향이 없어 확인 대상이 아니다. 예전 market 화면 주소가 모두 redirect되어 예전 사이드바가 어디에도 나오지 않음 |
| B-8 | 후속(8.12) | 308 전환 배포 뒤: 아래 주소를 `curl -s -o /dev/null -w '%{http_code} %{redirect_url}'`로 열어 **308**과 `redirect_url`(Location) 확인, 이어서 브라우저 최종 URL·화면 확인. **주소별 기대값**(B-7과 같은 목록 — 6.4 상세 3규칙 + 8.10-1 목록 7규칙 전체): 상세 ① `/preview/solvook-concept/boards/{slug}/items/{id}?subject=korean` → `/items/{id}?subject=korean` ② `/korean/market/{slug}/items/{id}`·`/english/market/{slug}/items/{englishId}` → `/items/{id}?subject=korean`·`/items/{englishId}?subject=english` ③ `/market/{slug}/items/{id}`, `/preview/solvook-concept/boards/{slug}/items/{id}`(쿼리 없음) → `/items/{id}`(주소에 과목이 없어 쿼리 없음 — P11), 브라우저 최종 URL은 page가 맞춘 `/items/{id}?subject={실제 과목}`. 목록 ④ `/korean/market`·`/korean/market/{slug}`·`/korean/market/{slug}/board-preview` → `/?subject=korean` ⑤ `/english/market`·`/english/market/{slug}`·`/english/market/{slug}/board-preview` → `/?subject=english` ⑥ `/market`·`/market/{slug}`·`/market/{slug}/board-preview` → `/` ⑦ `/preview/solvook-concept/boards/{slug}?subject=korean` → `/?subject=korean`(쿼리 유지), `/preview/solvook-concept/boards/{slug}`(쿼리 없음) → `/` |

### 8.12 후속 — redirect 307 → 308 전환(사용자 결정 Q9·D12, 조건부 별도 커밋)
- 시점: **S4 배포 2주 뒤**에 아래 세 조건을 점검한다. 2주의 시작일은 **S4 마지막 코드 배포(배포 D)가 운영에서 확인된 날**이다(P12 — M4 검증은 그 전에 끝남. 배포 A 기준이 아닌 이유는 P12). 이 기준일과 점검일(기준일 + 14일)은 8.10 마지막 확인 항목(9번)에서 S4 검증 기록에 적는다.
- 조건(**모두** 만족해야 진행. 조건 1~3의 본문은 사용자 결정 원문, '계획서 추가 점검'은 따로 표시):
  1. 2주 동안 상세 페이지 오류·이동 관련 문의 없음(사용자에게 확인).
  2. Vercel 로그에서 예전 주소 요청이 새 주소로 정상 이동하는 것 확인. 측정 방법을 미리 정해 두지 않으면 사후에 확인할 수 없으므로 다음 순서를 따른다(①은 S1 카드 8.3-5, ②의 시작은 S4 카드 8.10-9에 실행 항목으로 들어 있다):
     - **① 데이터 출처 검증(S1 배포 직후, 8.3-5)**: 예전 상세 주소 하나를 curl로 연 뒤 Vercel Logs(대시보드 또는 `vercel logs`)에 그 요청이 307로 보이는지 확인한다. `next.config` redirects는 Vercel 라우팅 계층에서 처리되어 함수 로그에 남지 않을 수 있기 때문이다. 같은 때 런타임 로그 보존 기간과 Log Drain·Observability 설정 유무도 적는다. 보이지 않으면 '로그로는 측정 불가'로 검증 기록에 적는다. 이때 조건 2를 어떻게 판정할지는 계획서가 정하지 않는다 — 8.12 점검 때 **로그 측정 불가 사실과 ③의 curl 대체 결과를 사용자에게 보여 주고, 조건 2를 대체 확인으로 갈음할지 사용자가 정한다. 정하기 전에는 307을 유지한다.** (가능하면 S1 직후 결과가 나온 시점에 사용자에게 미리 알려, Log Drain 설정 같은 측정 수단을 S4 전에 마련할지 묻는다.)
     - **② 2주 동안 쌓는 방법(배포 D 확인일부터, 8.10-9)**: 런타임 로그 보존 기간은 플랜에 따라 짧다(검증 지적: Pro 약 1일, Hobby 약 1시간 — 실제 값은 S1·S4 때 대시보드에서 확인해 기록). 그래서 '2주 동안'을 마지막 날에 한 번에 볼 수 없다. Log Drain이나 보존 기간이 14일 이상인 Observability 설정이 있으면 그것을 쓴다(이 경우 2주 전체 확인). 없으면 Logs 화면에서 path가 `/market`, `/english/market`, `/korean/market`, `/preview/solvook-concept/boards`로 시작하는 요청을 필터한 결과(건수·상태 코드·예시 주소·**캡처가 덮는 기간**)를 캡처해 검증 기록에 남긴다. 캡처 주기: **보존 기간이 1일 이하이면 매일(14회)**, 그보다 길면 보존 기간 안에서 빈틈이 없도록(예: 보존 3일 이상이면 1·4·7·10·14일째). 매일 캡처를 하지 못한 날이 생기면 그것이 **표본 확인**이라는 사실과 빠진 기간(날짜)을 검증 기록과 작업 전 사용자 확인 항목에 적는다 — 2주 전체를 확인한 것처럼 보고하지 않는다.
     - **③ 통과 기준**: 확인한 기간(②의 캡처가 덮은 날짜 목록, 빠진 기간 포함)을 함께 적고, 그 기간 중 보인 예전 주소 요청이 모두 307이고 Location이 6.4·8.10-1 규칙의 목적지와 같음(과목 없는 상세는 `/items/{id}` — P11), 같은 기간 `/items/*`·`/` 응답에 5xx 0건. **예전 주소 트래픽이 0건이면** 로그 대신 B-8의 주소 목록 전체를 **307 상태 그대로** curl로 열어 상태 코드와 `redirect_url`이 기대값과 같은지 확인하고, 그 결과와 '트래픽 0건' 사실을 사용자에게 보여 준다. 조건 2를 이 대체 확인으로 갈음할지는 **사용자가 정하고**, 정하기 전에는 307을 유지한다. (트래픽 0건은 당연한 일이 아니다 — S1에서 상세 링크 11곳을 바꿨지만 S4 뒤에도 아래 조건 3의 내부 링크들이 예전 출발 경로로 보낸다. 0건이면 측정 누락(필터·보존 기간)부터 의심하고 ①의 데이터 출처 결과와 대조한다.)
  3. 예전 화면·게시판 구조로 되돌릴 계획 없음(사용자 결정 원문). 여기에 **(계획서 추가 점검 — 308의 되돌리기 어려움이라는 결정 이유에서 나온 것, 결정 원문에는 없음)** 두 가지를 함께 묻는다: 출발 경로(`/market`, `/market/:slug`, `/{subject}/market/**`, `/preview/solvook-concept/boards/:slug`와 그 아래 상세 경로)를 나중에 다른 화면 주소로 다시 쓸 계획이 없음, 목적지 주소 형식(`/items/[itemId]?subject=`, `/?subject=`)을 바꿀 계획이 없음. 308은 '예전 화면으로 되돌리기'뿐 아니라 출발 경로 재사용과 목적지 변경도 사실상 막는다(이미 308을 기억한 브라우저·검색엔진은 서버 설정과 무관하게 옛 목적지로 간다).
     - **S4 이후에도 앱 안에 남는 예전 출발 경로 링크**(조사 시점 HEAD 401075d, 착수 때 `grep -rn "'/market'" src`와 `workspace_settings` 조회로 다시 확인): ⓐ 헤더 문제마켓 시스템 링크 href `/market` — 기본값 `src/lib/header-navigation.ts:127`, 운영 `workspace_settings`의 `header_navigation`에 저장된 값(검증 지적에서 직접 조회로 확인), `(dashboard)/generate`·`[workspaceSubject]/generate` layout의 `header.tsx`에서 사용 ⓑ 그 링크에 병합되는 children(`src/lib/market-menu-server.ts:133`, 8.10-3 메모) ⓒ `[workspaceSubject]/page.tsx`의 WorkspaceLanding 바로가기 — `src/lib/workspace-landing-quick-entry.ts:25·36`(`/{subject}/market/{첫 자식}` 또는 `/market`), `src/components/features/landing/WorkspaceLandingView.tsx:47`(`workspaceHref(subject, 'market')`) ⓓ `src/lib/workspace-routes.ts:80`의 `market` 경로. 308으로 바꾸면 이 내부 메뉴·랜딩 버튼까지 영구 redirect에 묶인다. 그래서 308 전환 **전에** 이 링크들을 새 목적지(`/?subject=` 등)로 바꿀지, 그대로 둘지를 사용자에게 묻는다(바꾸기로 하면 308 커밋과 별도 커밋으로, 앞서 한다). 그대로 두기로 하면 그 결정을 검증 기록에 적는다.
  - 하나라도 어긋나면 **307을 유지**하고 그 이유를 검증 기록에 적는다(기한 없이 다시 점검 가능).
- 작업 전 사용자 확인 항목: 조건 1(문의 없음), 조건 3(되돌릴 계획 없음 — 결정 원문)과 계획서 추가 점검 두 가지(출발 경로 재사용·목적지 형식 변경 계획 없음), **조건 3의 남는 내부 링크 ⓐ~ⓓ 처리 방침**, 조건 2의 기록(①~③ 결과, 확인한 기간과 빠진 기간, 로그 측정 불가·트래픽 0건이면 대체 확인으로 갈음할지 여부).
- 작업: 조건 점검 결과를 사용자에게 보여 주고 확인을 받은 뒤, `next.config.ts`의 S1 상세 redirect 3종과 S4 목록 redirect의 `permanent: false` → `permanent: true`만 바꾸는 **별도 커밋**(`chore: 예전 문제마켓 주소 redirect를 308로 전환`). 목적지·선언 순서는 바꾸지 않는다.
- 테스트: `tests/market-item-detail-url-contract.test.mjs`(S1의 `permanent: false` 단언)와 `tests/market-board-retirement-contract.test.mjs`(S4 목록 redirect 단언)를 `permanent: true`로 갱신. 공통 확인(8.0: `tsc`, eslint, 기준선 비교 새 실패 0, `next build`).
- 브라우저·curl: B-8.
- 되돌리기: 커밋 revert로 서버 설정은 307로 돌아가지만, **이미 308을 받은 브라우저·검색엔진은 계속 새 주소로 간다**(되돌리기 어려움 — 그래서 조건을 둔다). 예전 화면을 되살려야 하는 상황이면 308 전환 전에 판단해야 한다.

---

## 9. 테스트 계획 요약

| 단계 | 신규 | 수정(깨질 것으로 예상되는 계약 테스트) |
|---|---|---|
| S0 | `tests/market-home-config-normalize.test.mjs`(예전 `categories` 키가 와도 normalize·validate 모두 받아들이고 popular·recent 유지, 그 밖의 모르는 키는 거절 — Q8) | `admin-sidebar-navigation`(작업 트리의 수정분을 커밋만), `market-home-admin-route-contract`(40·49 `getMarketHomeAdminOptions`, **59-61 `Checkbox`·`ArrowUp`·`ArrowDown` → 부재 단언 `/문제마켓 카테고리\|menuEntryIds/`**, 38 테스트 이름의 'allowlists' 정리), `remove-home-source-section-contract`(41 픽스처 `categories` 제거 — validate가 `categories`를 떼어 내 44행 `deepEqual`이 달라지므로). 착수 때 5.4의 grep 두 개(`market-main-settings-client`를 읽는 테스트 포함)로 다시 찾음. `market-home-ui-contract`의 기존 기준선 실패 1건은 그대로(5.4) |
| S1 | `tests/market-item-detail-url-contract.test.mjs`(상세 링크 조립 정규식 한정, 상세 page의 캐시 모듈 사용·`listMarketCategory(Menu|Tree)(true)` 직접 호출 없음, preview 상세 stub), `tests/market-cart-detail-href.test.mjs`(숨김 게시판 픽스처 실행) | `solvook-real-market-detail-contract`, 예전 preview 상세 page 내용을 단언하는 테스트(`grep -ln "boards/\[slug\]/items" tests/`),  `market-cart-detail-link-contract`, `market-home-ui-contract`, `market-home-list-integration-contract`, `solvook-real-market-board-ui-contract`, `market-library-listboard-contract`, `market-listboard-ui-contract`, `market-listboard-zip-contract`, `market-listboard-no-direct-purchase-contract`, `studio-adoption-contract`, (확인) `studio-browser-fixture-contract`(467-468 샘플 board 경로) |
| T1·T3 | `supabase/tests/market_category_tree.test.sql` | `supabase/tests/market_images.test.sql`(depth1 기본 이미지 IN_USE·`categoryItems` 케이스 추가) |
| T2 | `tests/market-category-tree-contract.test.mjs`, `tests/market-category-tree-node-api.test.mjs`(하네스 실행, mocks에 `@/lib/admin-workspace`·`@/lib/market-category-tree`: 삭제 409·delete 미호출, 삭제된 상품 수 표시, leaf delete, 23503 제약 이름별 409, depth5 400, 빈·121자 제목 400, 401·403, `toMegaMenuTree`·`findCategoryPath`·`collectSubtreeIds` 단위) | `category-pagination-server`(mocks `@/lib/market-category-tree` 추가, T2-M 적중·미스 쿼리 수 포함), `category-mega-menu-count-contract`(`?v=tree`·`Array.isArray`), `market-images-admin-wiring`(201행 mocks), `market-images-contract`, `market-images-routes`, `market-images-display`(64행 라우트 경로 목록, 153행 노드 라우트, `revalidations.length` 기대값), `market-images-lib`(문자열 유지 확인만), `item-type-badge-order-contract` |
| T4 | (스크립트 dry-run·검증 쿼리가 검증 수단) | 없음 |
| S2 | `tests/market-admin-item-category-contract.test.mjs`(PATCH·POST 과목 불일치 400 하네스 실행 포함) | `market-upload-draft-source-contract`(업로드 전 카테고리 확인), `market-products-admin-pagination-contract`, `market-images-display`(125 body, **133 카테고리 null 케이스 → 400**), `market-images-admin-wiring` |
| S3 | `tests/market-public-gate-contract.test.mjs`, `tests/market-public-gate-hidden-board.test.mjs`(검색·홈 실행). (메인 관리 설정 테스트는 Q8로 S0에서 처리) | `market-home-contract`(28 게이트), `market-home-admin-route-contract`(51 게이트), `public-market-sample`, `category-pagination-server`, `market-board-contract`, `market-menu-group-contract`, `item-type-badge-order-contract`(search-server load mocks), `market-images-display`(83 search-server load mocks) |
| S4 | `tests/market-board-retirement-contract.test.mjs`(**S4-2b 커밋에서 신설**, 메뉴관리 카드·`menuEntryId` 부재 단언은 S4-3·S4-7에서 추가 — 8.10 커밋 표. 옮긴 공용 컴포넌트 2개가 `src/components/market`에 존재·예전 경로에 없음, `market-sidebar.tsx`·예전 market layout 2개 없음, `@/app/(dashboard)/market` import 0건, 목록 redirect `permanent: false`, 게시판 목록 링크 조립 0건) | **S4-2a(이동)**: 경로 갱신 12개 파일(8.10-2a 목록 — 12개 파일·15줄. 그중 `solvook-real-market-board-ui-contract` 140행·`market-detail-multiselect-contract` 140행은 이스케이프된 import 정규식을 다시 쓰고, `market-detail-multiselect-contract` 8행 `itemActions` 경로는 문자열 치환). `market-board-preview-route-contract`·`studio-adoption-contract`의 금지어 `doesNotMatch`와 관리자 전용 `market-admin-sample-preview-ui-contract`는 변경 없음. **S4-2b(삭제)**: `menu-divider-management`(29-32·67 `market-sidebar.tsx` 단언 제거), **지운 page·listboard를 읽는 섞인 파일 — 해당 상수·단언만 제거하고 옮긴 컴포넌트·살아 있는 대상 단언은 유지**: `market-products-admin-material-info-contract`(14 `itemPage`), `market-detail-multiselect-contract`(9·138), `market-sample-pages-api-contract`(7-10), `market-item-detail-ui-contract`(5-8), `market-v2-detail-library-contract`(6-9), `market-hwp-bundle-contract`(13-16), `market-listboard-ui-contract`(5-12, 51-67 dialog 단언 유지), `market-listboard-zip-contract`(6·7), `market-listboard-no-direct-purchase-contract`(5-12), `market-home-source-filter-contract`(26-41 테스트 삭제), `studio-adoption-contract`(33-40 상수와 344-380 테스트 삭제), 예전 화면 전용 `market-board-preview-route-contract`(**파일째 삭제** — 13·18행에서도 지울 page를 읽음. board-preview page 부재 단언은 retirement 계약으로 옮김), `admin-phase1a-contract`, `market-home-source-filter-contract`, `market-images-display`(59 board page 캐시 태그), `solvook-preview-flow-contract`(75 board page 존재 단언), `solvook-real-market-board-ui-contract`(6 board page 경로), `studio-adoption-contract`(10·57 board page 경로), 그 밖에 예전 화면을 직접 단언하는 테스트(`grep -rln "(dashboard)/market\|\[workspaceSubject\]/market" tests`로 다시 찾음 — 2b 뒤 결과는 `market-board-retirement-contract`·`market-purchase-complete-dialog-contract`(61 부재 단언)뿐이어야 함, 삭제 시 기록). **S4-3**: retirement 계약에 메뉴관리 카드 부재 추가. **S4-7**: retirement 계약에 상품 API `menuEntryId` 부재 추가 |
| 후속(8.12) | 없음 | `market-item-detail-url-contract`·`market-board-retirement-contract`의 redirect 단언 `permanent: false` → `true`(308 전환 커밋에서만) |

- 하네스 제약: `category-pagination-server`의 가짜 Supabase는 `select/eq/is/in/order/range/maybeSingle/then`만 지원하고, `tables`에 없는 테이블을 읽으면 TypeError, `order`는 문자열 비교다 → 서버 코드는 이 메서드만으로 트리·개수를 읽고(`.not`, `.or` 없이), 숫자 정렬은 메모리에서 한다. 검색어 경로(`.or`)는 이 하네스로 검증하지 않는다(브라우저 B-2에서 확인). 쿼리 수 검증은 하네스의 호출 기록(테이블별 `from` 횟수)으로 노드 5개·40개 두 픽스처에서 같은지 본다.
- 테스트 목록은 조사 기준이다. 각 단계 착수 때 `grep -ln "<바뀌는 식별자>" tests/` 로 다시 찾아 빠진 것을 추가한다.

---

## 10. 위험과 대응

| 위험 | 대응 |
|---|---|
| ID가 바뀌거나 depth2 페이지가 하위를 모으지 않으면 광고 두 개가 비어 보임 | ID 보존 이관(M1 3~4) + Q-2~Q-4, 하위 포함 목록(T2) 뒤에만 T4 실행, T4 검증에 광고 페이지 80·64 포함 |
| 운영 DB 공유 — 로컬 실험이 곧 운영 변경 | 모든 DB 단계에 dry-run(rollback)·승인·검증 쿼리, 실행 전 백업 JSON, 관리자 수동 CRUD는 승인 후 테스트 이름으로 |
| 한 번에 그룹 테이블을 지우면 배포 전 코드가 깨짐 | 확장/축소 분리(P3). T1~T2 사이 관리자 카테고리 편집 금지 |
| 테이블 이름 변경 시 썸네일 연결 구문·RPC·FK 다수가 깨짐 | 이름 유지(P2). `market-images-*` 계약 테스트가 문자열을 지킨다 |
| 캐시 키를 그대로 두면 배포 직후 옛 형태 데이터를 새 코드가 읽어 런타임 오류 | T2에서 키를 `'category-tree-with-counts'`로 변경 |
| 노드마다 count 쿼리로 바꾸면 성능 퇴행 | 한 번 읽고 메모리 합산(4.2), 하네스 쿼리 수 테스트 |
| 관리자 변경이 공개 메뉴에 최대 60초 늦게 반영 | 캐시 tag + `revalidateTag`. CDN `s-maxage=60`인 메가메뉴 API는 최대 60초 지연이 남는다(허용) |
| 확인 후 삭제 사이 경합으로 상품이 미지정으로 풀림 | DB `on delete restrict` + 23503 → 409 |
| 노드 이동이 필요해짐 | 이번에는 트리거로 막음(P5). 필요하면 후속(depth 재계산·순환 검사) |
| 상품을 depth3·4로 옮기면 상위 칸 기본 이미지가 안 보임 | 직접 연결만(P7), 운영 기본 이미지 0건. 상속은 후속 |
| `/items/` chrome 허용 목록 누락 시 헤더 이중 | S1 계약 테스트 + B-1 |
| 예전 라우트 폴더 삭제로 공용 컴포넌트 import 깨짐 | Q10 결정대로 공용 컴포넌트 2개를 먼저 `src/components/market`으로 옮기는 **별도 커밋(S4-2a)**에서 `next build`·기준선 비교를 통과한 뒤에만 예전 page·layout·사이드바를 지움(S4-2b, P9). 두 커밋 각각 `next build` 게이트 |
| 컴포넌트 이동 때 경로를 읽는 계약 테스트(12개 파일·15줄 — `market-detail-multiselect-contract`는 8행 경로와 140행 정규식 두 곳)가 ENOENT로 깨지거나, 이름 부분 일치로 관리자 전용 `admin-market-sample-preview-dialog`의 import·테스트까지 잘못 바꿈 | S4-2a에서 예전 경로를 포함한 grep으로 대상을 찾고(8.10-2a), 경로 갱신 12개·변경 없음 2개(`doesNotMatch`)·관계없음 1개(관리자)로 나눠 처리. 이스케이프된 import 정규식 2곳은 다시 씀(`market-detail-multiselect-contract` 8행 모듈 최상단 경로도 함께 — 빠뜨리면 파일 전체 ENOENT). 2a 직전 실패 목록(`pre-2a-failures.txt`)과 `comm -3` 0줄로 실패 목록 불변 확인 |
| S4-2b에서 지운 page·listboard를 모듈 최상단에서 읽는 섞인 테스트 파일이 통째로 실패해, 2a에서 갱신한 옮긴 컴포넌트 단언까지 사라짐 | 8.10-2b의 파일·줄 목록대로 지운 대상의 상수·단언만 제거하고 살아 있는 대상 단언은 유지. 2b 뒤 `grep -rln "(dashboard)/market\|\[workspaceSubject\]/market" tests`가 retirement 계약·`market-purchase-complete-dialog-contract`(61)뿐인지 확인 |
| S4 커밋을 골라 되돌리거나 배포 순서가 바뀌어 예전 목록 주소 404 창·nullable 타입 빌드 오류 | 8.10 커밋 표: S4-1(목록 redirect)은 S4-2b와 같은 배포이거나 먼저(배포 A), revert는 뒤 커밋부터 역순, 2a 단독 revert는 2b가 없을 때만 |
| 사이드바 삭제로 `tests/menu-divider-management.test.mjs`가 모듈 최상단 `readFileSync` ENOENT로 파일 전체 실패 | S4-2b에서 29-32·67행의 `market-sidebar.tsx` 단언을 같은 커밋에서 제거 |
| 게시판 hard delete 시 상품 연쇄 삭제 | S4 전 archive만. M4에서 FK `set null` |
| `createMarketItem` 과목 결정 이전 순서가 바뀌면 과목 오저장 | S2 커밋 순서 2a → 2b, 계약 테스트 |
| 기본 게시판 ID 하드코딩 유혹 | 규칙 쿼리(4.7), UUID 리터럴 grep 0 |
| S0에서 `categories` 섹션을 지운 뒤 예전 형태(`categories` 키 포함) 값이 들어오면, 엄격한 `validateMarketHomeConfig`가 실패해 `normalizeMarketHomeConfig`가 popular·recent까지 기본값으로 초기화(또는 S0 직후 예전 탭의 저장이 400) | `validateMarketHomeConfig`가 `categories` 키 하나만 떼어 낸 뒤 검증 — 읽기·저장 모두 받아들임(5.4, Q8) + `tests/market-home-config-normalize.test.mjs`. 운영 저장값 0건(직접 확인)이라 데이터 마이그레이션 없음 |
| **역방향(S0 revert·Instant Rollback) 초기화**: S0 뒤 메인 관리에서 저장해 `categories` 없는 `market_home` 행이 생긴 상태로 S0 이전 코드로 돌아가면, 예전 엄격 검증이 실패해 popular·recent를 포함한 설정 전체가 기본값으로 바뀌고 예전 관리자 화면 저장 때 실제 값도 덮어써짐 | revert 배포 완료까지 메인 관리 저장 금지 공지 → revert 전에 `market_home` 행 읽기 전용 조회 → 0건이면 revert, 1건 이상이면 forward-fix 또는 승인된 일회성 update(`categories` 기본값 추가, dry-run→승인→실행→재조회) 뒤 revert → 배포 직후 같은 조회 재실행(1건 이상이면 그 자리에서 승인된 update). S0 이전 배포로 가는 모든 revert·Instant Rollback에 적용(5.4 되돌리기, 3.9 S0 행·표 위 문단) |
| 영어 published 상품(카테고리 없음)이 사라짐 | 노출 조건을 상품 상태만으로(Q5), B-6 |
| 308 redirect는 브라우저·검색엔진이 영구 기억해, 서버 설정을 되돌려도 이미 기억한 사용자는 계속 새 주소로 감(되돌리기 어려움) | 모든 redirect를 307로 시작(P8, Q9). 308 전환은 S4 배포 2주 뒤(시작일 = 배포 D 운영 확인일, P12) 3조건(문의 없음·Vercel 로그 정상 이동·되돌릴 계획 없음 — 결정 원문)과 계획서 추가 점검(출발 경로 재사용·목적지 형식 변경 계획 없음, S4 뒤 남는 내부 링크 처리 방침)을 모두 만족하고 사용자 확인을 받은 뒤 별도 커밋(8.12). 로그 조건은 S1 카드(8.3-5)의 데이터 출처 검증, S4 카드(8.10-9)에서 시작하는 로그 수집(보존 1일 이하면 매일, 표본이면 빠진 기간 기록), 확인한 기간을 적은 통과 기준으로 측정(8.12-2). 로그 측정 불가·트래픽 0건이면 curl 대체 결과를 보여 주고 갈음 여부는 사용자가 정함. 조건 미충족이면 307 유지 |
| 기준선 실패 53개 때문에 "전체 통과" 기준이면 loop가 안 끝남 | "새 실패 0" 기준(8.0-4) |
| `supabase/migrations` 디렉터리와 운영 적용 이력의 일치 여부 미확인, Supabase MCP 인증 전 상태(조사 세션에서 `authenticate` 도구만 노출) | T1·T3·S3·S4 착수 전 체크리스트(3.2): MCP 인증 → `list_migrations` 성공 → 20261002014653까지 이력 일치. 실패하면 그 DB 단계를 시작하지 않음 |
| T4 판별 토큰이 실제 제목과 어긋남(띄어쓰기·특수문자) | NFC 정규화, 미매칭·중복이 1개라도 있으면 `--apply` 거부, dry-run 목록을 사용자가 확인 |
| soft delete된 상품이 연결된 칸은 삭제가 막히는데, 관리자 목록에 삭제된 상품이 안 보여 옮길 수단이 없음 | 관리자 `productCount`를 DB restrict와 같은 기준(전 행)으로 표시하고 409 문구에 '삭제된 상품 N개 포함'(4.5). 실제로 생기면 사용자 승인 뒤 일회성 스크립트(dry-run → 승인 → 이동 → 검증) 또는 후속 작업. 지금 deleted 상품 0건. 테스트 상품은 DB soft delete가 아니라 관리자 DELETE(hard delete)로 지움(8.8) |
| M1 뒤 타입을 바로 반영하면 지금 코드가 컴파일 오류(group_id nullable, Insert에 depth 필수) → 배포 실패 | T1에서는 타입 차이만 확인하고 원복, T2 커밋 1과 함께 반영(8.4-5) |
| T2~T3 사이 새 코드로 만든 칸(group_id null)·지운 depth1 때문에 M2 안전 확인이 실패 | M2 확인을 옛 구조 행(`group_id is not null`)으로 좁히고 삭제된 그룹은 notice만(3.4-1). Q-2·Q-3은 T3 기준을 따로 둠(3.6). 테스트 칸은 T3 전 Q-12로 0행 확인 |
| T3·T4 뒤에 T2 코드를 revert(또는 Vercel Instant Rollback)하면 그룹 테이블 없음·depth3·4 무시로 화면이 깨지고 광고가 0개 | 3.9 롤백 매트릭스: DB를 역순으로 먼저 되돌린 뒤 코드 revert |
| T2 배포 직후 브라우저 HTTP 캐시(`max-age=60`)의 옛 형태 응답을 새 메가메뉴가 읽어 헤더 렌더 오류 | 클라이언트 주소 `?v=tree`로 캐시 키 분리 + `Array.isArray` 형태 방어(6.1). 되돌리기 직후 60초 불일치는 예상 동작으로 기록 |
| T1~T2 사이 `/categories/{옛 그룹 id}`가 404 → 500 | 링크 없음, 수십 분 창이라 허용(3.2 예외). T2 뒤 200 확인 |
| 롤백 백업이 scratchpad(`/private/tmp`)에 있으면 세션 종료·재부팅 때 사라짐 | 모든 백업을 `~/backups/create_quiz_ai/<날짜>-<단계>/`에, 있으면 덮어쓰지 않음. T4는 생성 노드 id 목록도 저장, 롤백은 첫 실행 백업만(7.4·7.5) |
| T4 스크립트가 REST 호출이라 중간 실패 시 일부만 옮겨짐 | 같은 명령 재실행으로 수렴(멱등). 중간 상태에도 depth2 합산 64·80 유지(7.4) |
| `/items`·`/categories` page의 `notFound()`·`redirect()`가 스트리밍 뒤라 HTTP 404·307이 아님 | `/items`는 UUID 검사를, `/categories`는 캐시된 노드 트리로 존재·조상 활성 검사를 `layout.tsx`로(실제 404, P10). 과목 redirect는 브라우저 최종 URL로 확인(6.4). `(solvook)/not-found.tsx`로 404 화면에 헤더·푸터 유지 |
| 광고가 가리키는 칸(또는 조상)을 비활성화·삭제하면 광고 링크 404(메인 관리 설정은 Q8로 칸을 가리키지 않음) | 상품이 있는 칸은 삭제가 이미 막힌다(D3). 비활성화 경고는 요구사항 밖이라 기본값으로 넣지 않고 Q14로 사용자에게 묻는다(승인 시 4.5의 추가 작업) |
| `apply_migration`이 부분 적용될 가능성(단일 트랜잭션 미확인) | 적용 전 객체 체크리스트, 적용 후 전부 반영/전부 미반영 대조, 부분 적용이면 중단·보고(3.2 적용 절차) |
| 기준선 비교 명령이 macOS `sed`·locale 차이로 가짜 '새 실패'를 만듦 | `[[:space:]]`, 지시문 처리, `파일::테스트명`, `LC_ALL=C`(8.0-4). 실측으로 동작 확인 |
| 파일별 반복 실행과 명세 명령(`node --test tests/*.test.mjs` 한 번 실행)의 총 개수·흔들리는 결과가 다름 | S0에서 두 방식 결과를 대조하고, 다르면 차이를 기록·기준선은 합집합(8.2-3). 단계마다 두 방식 모두 실행(8.0-4) |
| 롤백·T2 revert 때 depth1이나 T2 이후 만든 칸에 연결된 상품이 조용히 미지정(`set null`)이 되거나 화면에서 사라짐 | 3.8 롤백 공통 사전 확인 A(0이 아니면 중단·사용자 승인으로 depth2 이동)·B(스냅샷), T1 롤백 7번 가드 DO 블록, 8번 상품 연결 비교 차이 0. 3.9 T2 행은 '조건부 가능' |
| T2 중간 커밋에서 사용처가 아직 바뀌지 않아 컴파일 오류 | `tsc`·`next build`·기준선 게이트를 T2 마지막 커밋(배포 단위) 기준으로, 중간 커밋은 로컬 전용(8.5) |
| S1에서 상세 prop을, T2에서 `listMarketCategoryMenu`를 지워 예전 preview 상세 page가 빌드를 깨뜨림 | S1에서 그 page를 `redirect()`만 하는 stub으로 바꿈(6.4) |
| 검색·보관함 행에 카테고리 경로를 넣으려고 새 모듈을 import하면 고정 mocks 테스트가 `Unexpected import`로 깨짐 | 순수 함수 모듈 `@/lib/market-category-tree`(의존 없음) 하나만 import, 해당 테스트 mocks에 키 추가(8.9). 경로는 활성 노드 1쿼리로 메모리 조립 |
| 상품 폼에서 카테고리를 고르기 전 파일 업로드 시 draft POST가 400으로 실패 | 카테고리 선택 전 업로드를 막고 안내(5.3), B-5 시나리오 |
| T4 백업 폴더가 날짜에 묶여 다른 날 재실행 때 첫 백업을 혼동 | 고정 경로 `~/backups/create_quiz_ai/T4/`(7.4) |
| M1 재실행이 T2 이후 지운 depth1을 되살림 | 3·4번을 `depth is null` 행이 있을 때만 실행하는 가드 + 재실행은 적용 직후·T2 전에만(3.2-4) |

---

## 11. 미결 질문(사용자 확인 필요)

각 질문은 권장 기본값으로 계획을 진행할 수 있다. 다른 답이 오면 해당 단계 착수 전에 계획을 고친다. **결정됨**으로 표시한 질문은 사용자 결정이 계획 전체에 반영된 것이다(1.3 D11~D13).

| ID | 질문 | 권장 기본값 | 영향 단계 |
|---|---|---|---|
| Q1 | depth3 이름 통일? 독서 '1부 개념학습' vs 문학 '1부 교과서 개념학습' | 실제값 그대로. 통일은 나중에 관리자 화면에서 제목만 바꾸면 됨(진행을 막지 않음) | T4 |
| Q2 | 자식 없는 말단 칸의 '더 자세히 찾기' | 형제 칸을 보여 주고 현재 칸 강조 | T2 |
| Q3 | 상품 없는 하위 칸이 있는 노드 삭제 | 막고 '하위 칸을 먼저 삭제해주세요' 안내(자식 FK restrict) | T1, T2 |
| Q4 | 노드 이동(부모 변경) | 이번 범위에서 미지원(트리거로 차단), 필요 시 후속 | T1 |
| Q5 | 게시판 게이트 제거 뒤 노출 조건 | 상품 상태만(published + active + 미삭제). 카테고리 활성까지 요구하면 영어 published 상품 1개가 사라짐 | S3 |
| Q6 | 상품 수정에서 카테고리 null 해제 허용? | 막음. 기존 미지정 영어 상품 2개는 수정 저장 때 카테고리 선택이 필요 | S2 |
| Q7 | 검색 '카테고리' 패싯 단위 | depth1~2 묶음 | S3 |
| Q8 | '(임시) 문제마켓 메인 관리'의 '문제마켓 카테고리'(`categories.menuEntryIds`, 현재 렌더 안 됨) 설정을 어떻게 할지 | **결정됨(2026-10-12, D11): 대체하지 않고 설정 자체를 삭제. S0에서 별도 커밋**. 근거: `HomeFinalCta`가 `subject`·`itemCount`만 구조분해하고 `categories`를 렌더하지 않음(호출처 `(solvook)/_components/solvook-home-view.tsx`, `preview/solvook-concept/page.tsx`), 운영 `workspace_settings`의 `setting_key='market_home'` 행 0건. 주의: 예전 형태 값이 와도 popular·recent가 유지되도록 `validateMarketHomeConfig`가 `categories` 키를 떼어 낸 뒤 검증(읽기 normalize·저장 API 모두 받아들임) + 테스트(5.4). S0 revert 전 `market_home` 행 조회(5.4 되돌리기) | S0 |
| Q9 | 예전 상세·목록 redirect 목적지와 307→308 전환 시점 | **결정됨(2026-10-12, D12)**: 모든 redirect는 **307(`permanent: false`)로 시작**. 목적지: 예전 상세 3종 → `/items/[itemId]?subject=…`, 예전 목록 → `/?subject={subject}`(과목 없는 주소는 `/`). 308 전환은 **S4 배포 2주 뒤** ① 2주 동안 상세 페이지 오류·이동 관련 문의 없음 ② Vercel 로그에서 예전 주소 요청이 새 주소로 정상 이동하는 것 확인 ③ 예전 화면·게시판 구조로 되돌릴 계획 없음 — 을 **모두** 만족할 때 별도 커밋(8.12). 이유: 308은 브라우저·검색엔진이 영구 기억해 서버 설정을 되돌려도 이미 기억한 사용자는 계속 새 주소로 가므로 되돌리기 어렵다. (여기까지 결정 원문.) **계획서 해석·추가 점검(사용자 확인 권장, 결정 내용이 아님)**: 과목 없는 예전 상세 주소 2종의 HTTP 목적지는 `/items/{id}`이고 page가 `?subject=`를 맞춤 — 최종 URL은 결정과 같음(P11, 6.4·B-8). '2주'의 시작일 = 배포 D 운영 확인일(P12). 조건 ②의 측정 방법·통과 기준(8.12-2), 로그 측정 불가·트래픽 0건이면 curl 대체 결과로 갈음할지는 사용자가 정함. 조건 ③에 더한 출발 경로 재사용·목적지 형식 변경 점검과 S4 뒤 남는 내부 링크 처리 방침(8.12-3) | S1, S4, 후속(8.12) |
| Q10 | (a) 예전 라우트 폴더의 공용 컴포넌트를 `src/components/market`으로 옮길지 (b) `market-sidebar.tsx`와 그것을 쓰는 예전 market `layout.tsx` 2개(`(dashboard)/market/layout.tsx`, `[workspaceSubject]/market/layout.tsx`)를 함께 지울지 | **결정됨(2026-10-12, D13)**: (a) `market-item-actions.tsx`(상품 상세 구매 영역, 실제 상세 페이지가 사용)와 `market-sample-preview-dialog.tsx`(샘플 미리보기 팝업 — 결정 문구는 '실제 사이트 6곳'. 재확인 결과 사용처 6곳 = 실제 사이트 5곳 + 예전 `market-listboard-client.tsx`. 관리자 상품 화면은 별도 컴포넌트를 써서 해당 없음, P9)를 `src/components/market`으로 **옮긴다**(import하는 모든 파일과 경로를 읽는 계약 테스트 갱신 — 결정 문구 '약 15곳'은 grep 일치 수이고 실제 갱신 대상은 12개 파일, 8.10-2a) (b) `market-sidebar.tsx`(예전 화면 전용)는 예전 layout 2개와 함께 **삭제**하고 `tests/menu-divider-management.test.mjs`를 고친다. 순서: S4에서 이동 커밋(S4-2a)을 먼저 하고 `next build`·기준선 비교 통과 뒤 예전 page·layout·사이드바 삭제(S4-2b). 이동을 S4보다 앞당기지 않는 이유는 8.10-2a | S4 |
| Q11 | 기본 게시판 규칙: '과목별 활성·노출·미삭제 게시판 중 sort_order 최소'로 충분한가(국어는 entexam과 mock-exams 중 sort_order가 작은 쪽) | 규칙대로. S2 착수 때 SELECT로 어느 게시판이 뽑히는지 보여 드림 | S2 |
| Q12 | T1~T2 사이(수십 분) 관리자 카테고리 편집 중지 공지 가능? | 가능하다고 가정. 어렵다면 M1에 예전 insert 호환 트리거를 추가 | T1 |
| Q13 | **명세 변경 확인**: 요구사항 R2는 '새 마이그레이션 하나로 처리', R15는 '트리 단계: R2 마이그레이션 → R3~R7 코드 배포 → R11'이다. 이 계획은 R2를 확장 M1(T1, 코드 배포 전)과 축소 M2(T3, 코드 배포 뒤) 두 파일로 나눴다(P3). 이렇게 바꿔도 되는가? | **두 개로 분리**. 이유: 로컬·운영이 같은 DB라, 한 파일로 그룹 테이블까지 지우면 적용 순간부터 T2 배포 완료까지 배포 중인 코드(그룹 테이블을 읽음)의 메가메뉴·카테고리 페이지·관리자 화면이 오류. 단일 파일을 원하면 M1+M2를 합쳐 T2 배포 직후 적용(그 사이 수 분 공개 화면 오류 감수) | T1, T3 |
| Q14 | 메인 광고가 가리키는 칸이나 그 조상을 비활성화·삭제할 때 관리자 편집기에 '메인 광고 연결' 배지와 경고 confirm을 **넣을지**(요구사항·사용자 결정에 없는 기능. 메인 관리 설정은 Q8로 칸을 가리키지 않게 됨) | **넣지 않음**. 넣기로 승인하면 그 뒤에 착수하고 4.5의 추가 작업(광고 설정 조회·`linkedFrom`·편집기 배지·confirm, node-api 테스트 mocks에 `@/lib/main-ad-carousel-server`)을 T2에 더한다 | T2 |
| Q15 | 카테고리 페이지(조상이 비활성인 노드·없는 id)의 '404'를 **HTTP 404 상태**로 보장할지, not-found 화면(HTTP 200)으로 충분한지 | **HTTP 404 보장**(P10): `categories/[id]/layout.tsx`가 캐시된 노드 트리로 확인해 `notFound()`. 캐시 미스 때 layout에서 활성 노드 1쿼리를 기다리는 비용이 생긴다. 화면만으로 충분하다고 하면 layout을 빼고 page의 `notFound()`만 둔다 | T2 |

---

## 12. 검증 기록

| 회차 | 대상 | 검증자 | 판정 | 비고 |
|---|---|---|---|---|
| R1 | 초안 | 독립 검증(coverage·code-feasibility·data-migration-risk) | 수정 필요 | major 6·minor 20. 반영(R2 개정): depth4 기대값 18→16(7.4), M2 안전 확인을 옛 구조 행으로 한정·Q-2·Q-3 T3 기준 분리·Q-12(3.4·3.6), T1 타입 재생성 미커밋→T2 커밋 1과 함께(8.4·8.5), T1 롤백에 T2 이후 생성 칸 처리(3.8), 롤백 매트릭스 신설(3.9), 메가메뉴 브라우저 캐시 `?v=tree`·형태 방어(6.1), 기준선 명령 `[[:space:]]`·지시문·`파일::이름`·`LC_ALL=C`(8.0-4, 실측), S3 전 게시판 숨김·archive 금지(8.0), `/items` UUID 검사 layout 이동·상태 코드 확인 방법(6.2·6.4), 트리 태그 상수를 `market-images.ts`로·`revalidations.length` 갱신·상품 DELETE 무효화(4.3), 하네스 실행 테스트(노드 API·`toMegaMenuTree`, 숨김 게시판 5곳), T2-M 쿼리 수 측정, depth1 기본 이미지 SQL·B-3, S4 board page 테스트 3개, 적용 절차(execute_sql 재실행·파일명·체크리스트·실행 도구), 백업 영속 경로·생성 노드 기록·첫 백업만 롤백·멱등 재실행(7.4·7.5), 트리거는 parent_id로만 조회·과목은 FK 23503(3.2·3.7), T3 선행 grep 범위 축소(3.4), T1~T2 옛 그룹 id 404→500 예외(3.2), 광고 연결 경고·Q14, 명세 변경(단일 마이그레이션) P3·Q13 |
| R2 | 개정본 | 독립 검증(coverage·code-feasibility·data-migration-risk) | 수정 필요 | major 2·minor 28. 반영(R3 개정): `market-sidebar.tsx`·예전 market layout 2개 유지(P9·8.10-2, retirement 계약 '3개 존재', Q10 (b) 신설)(R4에서 사용자 결정 Q10으로 **삭제**로 변경 — P9·8.10-2b), 명세 명령 `node --test tests/*.test.mjs` 대조·합집합 기준선(8.0-4·8.2-3), 카테고리 페이지 HTTP 404를 `layout.tsx`+노드 캐시로 보장(P10·6.2·B-2, Q15), 노드 캐시 `getCachedCategoryNodes`로 캐시 미스 직렬 구간 단축·T2-M 미스 값 기록(4.3·6.2·8.5), `(solvook)/not-found.tsx`(6.2·6.4·B-1), R10 계약 정규식을 상세 링크 조립으로 한정·캐시 모듈 사용 단언(8.3), T2 계약에도 캐시 사용 단언, depth5 사이드바·조상 비활성 404 브라우저 확인(B-3), 노드 POST·PATCH title 1~120 zod·빈/121자 400 테스트, 23503 제약 이름별 문구(4.5·8.5), PATCH 과목 불일치 400 하네스 실행(8.8), B-7 영어, 광고 경고 기능 제외·Q14 '넣을지'로 변경, M1 항목 updated_at 변경 허용 명시·Q-3 비교 컬럼(3.2-4·3.6), M1 3·4번 `depth is null` 가드·재실행 시점 제한, `market_images.test.sql` depth1 케이스 이미지 05(3.7), preview 상세 page S1 stub(6.4·8.3), T2 tsc·build 게이트를 마지막 커밋 기준으로(8.5), `market-images-display` 64·133행(4.3·8.5·8.8), 순수 함수 모듈 `@/lib/market-category-tree`와 S3 경로 조립·mocks 추가(4.1·8.9), B-3 메가메뉴 최대 60초 반영, node-api 테스트 mocks(`@/lib/admin-workspace`), **롤백 공통 사전 확인 A·B·T1 롤백 7번 가드·8번 상품 연결 비교·3.9 T2 조건부(major)**, 테스트 상품은 전용 칸 draft + 관리자 DELETE(hard)·Q-13(8.8·8.10), 삭제된 상품 수 표시·처리 방침(4.5), T4 백업 고정 경로(7.4·7.5), T3 롤백 객체 목록·확인 쿼리·절차(3.8), 업로드 초안 흐름 카테고리 선행(5.3·B-5), DB 단계 착수 전 Supabase MCP 인증·`list_migrations` 체크리스트(3.2·8.4·8.6·8.9·8.10) |
| R3 | 개정본 | 독립 검증 | R4와 함께 재검증됨 → R5 행 | |
| R4 | 개정본(사용자 결정 반영) | 사용자 결정(2026-10-12) Q8·Q9·Q10 | 반영. R3과 함께 독립 재검증 → 수정 필요(R5 행) | Q8(D11): 메인 관리 '문제마켓 카테고리' 설정을 S0에서 삭제 — 1.2 범위 표, D8, R12(S0/S3로 나눔), 4.5·Q14 메인 설정 언급 제거, 5.4 normalize 방식·S0 테스트(`market-home-config-normalize` 신규, `market-home-admin-route-contract` 40·49, `remove-home-source-section-contract` 41, `market-home-ui-contract` 기준선 실패 유지), 8.1·8.2-4·8.9 제목·테스트 목록, 9절 S0 행 신설·S3 행, 10절. Q9(D12): 모든 redirect 307 시작, 308 전환은 S4 배포 2주 뒤 3조건 + 사용자 확인 → 별도 커밋 — P8, 6.4, 8.1 후속 행, 8.10-1, 8.12 신설, B-8, 9절 후속 행, 10절. Q10(D13): 공용 컴포넌트 2개 `src/components/market` 이동(S4-2a, import·계약 테스트 약 15개) → `next build`·기준선 통과 뒤 예전 page·layout 2개·`market-sidebar.tsx`·사용처 0이 된 `market-listboard*` 삭제(S4-2b), `menu-divider-management` 수정 — P9, 1.2, R13, 8.1, 8.10-2·테스트·되돌리기, B-7, 9절 S4 행, 10절. 이동 시점은 S4 유지(앞당겨도 위험이 줄지 않고 기준선 비교에 섞임 — 8.10-2a). Q8·Q9·Q10을 11절에서 '결정됨'으로 표시 |
| R5 | R3+R4 개정본 | 독립 재검증(decision-consistency·code-feasibility·ops-risk) | 수정 필요 → 반영, 재검증 대기 | major 7·minor 10(중복 포함 17건). 반영: **S0 새 실패 누락** — `market-home-admin-route-contract` 59-61행 `Checkbox`·`ArrowUp`·`ArrowDown` 단언을 부재 단언으로, 38행 테스트 이름 정리, 착수 grep에 `market-main-settings-client`·아이콘 식별자 추가(5.4·8.2-4·9절 S0). **Q8 caution 일치** — `validateMarketHomeConfig`가 `categories` 키만 떼어 내 읽기·저장 모두 받아들임(예전 탭 저장 400 없음), normalize 테스트·`remove-home-source-section-contract` 41행 이유 갱신(D11·5.4·10절·Q8). **S0 삭제로 쓰는 곳이 없어지는 항목 명시**(`MarketHomeData.categories`, `MarketHomeAdminOptions`·`getMarketHomeAdminOptions`·`orderMenus`, route의 `validateAllowlist`·`MarketHomeAdminValidationError`, client의 `withExplicitSelections`·`toggleCategory`·`moveCategory`·`Checkbox`·`ArrowUp`·`ArrowDown`, `home-material-sections.tsx`의 `MarketHomeMenuEntry` import). 검증 지적 중 `Label` import 제거는 사실과 달라(165·180·209행에서 계속 사용) 유지로 적음. `MarketHomeMenuEntry` 타입 유지(`loadVisibleMenus`·`campaign-hero.tsx`)(5.4). **S0 역방향 revert 초기화** — revert 전 `market_home` 행 조회, 1건 이상이면 forward-fix 또는 승인된 update(5.4·3.9 S0 행·8.2·10절). **Q10 사용처 오탐 수정** — `market-products-client.tsx`는 관리자 전용 `./admin-market-sample-preview-dialog`를 써서 대상 아님, 사용처 6곳 = 실제 사이트 5곳 + 예전 listboard-client, 예전 경로 포함 grep(실행해 7곳 확인), 테스트 12개 갱신·2개 변경 없음(`doesNotMatch`)·1개 관계없음(관리자), 이스케이프된 import 정규식 2곳 재작성과 `grep -rnF 'itemId\]\/market-' tests` 0건, B-7·2a 확인에서 관리자 상품 화면 제외(P9·D13·8.10-2a·B-7·9절·10절·Q10). **2b 섞인 테스트 파일 목록**(줄 번호, 상수·단언만 제거하고 살아 있는 대상 유지, 예전 화면 전용 파일 처리, 2b 뒤 tests grep 결과 확인)(8.10-2b·9절 S4). **S4 커밋·배포 구성 표**(S4-1은 S4-2b와 같은 배포이거나 먼저, 배포 A~D), retirement 계약 커밋 시점(S4-2b 신설, S4-3·S4-7 단언 추가), revert는 역순·2a 단독 revert는 2b 전에만(8.10). **2a 실패 목록 양방향 불변**(`pre-2a-failures.txt`, `comm -3` 0줄)(8.10-2a). **Q9 목적지 예외**(과목 없는 상세 주소는 `/items/{id}`, page가 `?subject=` 맞춤)(D12·6.4·B-1·B-8·Q9). **308 로그 조건 측정 방법**(S1 직후 데이터 출처 검증, 1·4·7·10·14일 캡처, 통과 기준, 트래픽 0건 시 curl 대체 — 보존 기간 수치는 확인하지 못해 착수 때 대시보드에서 확인으로 적음)과 **조건 3 확대**(출발 경로 재사용·목적지 형식 변경 계획 없음, 작업 전 사용자 확인 항목)(P8·8.12·10절·Q9). R2 행 '유지' 문구에 Q10 삭제 변경 주석 |
| R6 | R5 개정본 | 독립 재검증(decision-consistency·code-feasibility·ops-risk) | 수정 필요 → 반영, 재검증 대기 | major 1·minor 14(중복 포함 15건). 반영: **(major) Q9 조건 ② 측정 작업을 실행 카드로** — S1 카드 5번에 8.12-2① 데이터 출처 검증(예전 상세 curl → Vercel Logs 307·보존 기간·Drain 유무 기록, 8.3-5), S4 카드 마지막 확인 9번에 2주 기준일 기록과 로그 수집 시작(8.10-9·커밋 표). **2주 시작일 = 배포 D 운영 확인일**(P12 신설, 이유: S4 최종 상태로 2주를 보고 배포 A 기준보다 엄격) — P8·8.1 10행·8.12 시점·Q9를 같은 기준으로. **결정 원문과 계획서 해석 분리** — D12·Q9 칸에서 과목 없는 상세 HTTP 목적지 예외를 빼 P11(계획서 해석, 사용자 확인 권장)로 옮김(6.4·B-7·B-8·8.12도 P11 참조), 조건 ③에 더한 출발 경로 재사용·목적지 형식 변경을 '계획서 추가 점검'으로 표시(P8·8.12-3·10절·Q9), 로그 측정 불가·트래픽 0건 때 curl 대체로 조건 ②를 갈음할지는 사용자가 정하고 그 전엔 307 유지(P8·8.12-2①③). **로그 보존 기간** — 보존 1일 이하이고 Drain 없으면 매일 14회 캡처, 표본이면 빠진 기간을 기록·사용자 확인 항목에, 통과 기준에 확인한 기간(8.12-2②③). **S4 뒤 남는 예전 출발 경로 내부 링크**(헤더 `/market` 시스템 링크·병합 children·WorkspaceLanding 바로가기·`workspace-routes.ts:80`)를 8.12-3에 나열하고 308 전 처리 방침을 사용자에게 묻기, '트래픽 0건일 수 있음' 근거 문구 수정(8.10-3·8.12). **B-0(S0) 신설**(카드 없음·저장 유지·공개 홈·예전 탭 저장 200, 확인 뒤 승인된 delete로 `market_home` 0건 복구)과 5.4·8.2-4 참조. **B-7·B-8 주소 목록**을 6.4 상세 3규칙 + 8.10-1 목록 7규칙 전체로. **`market-detail-multiselect-contract` 8행**(모듈 최상단 `itemActions` 경로) 추가 → 12개 파일·15줄(D13·8.10-2a·9절·10절, grep으로 확인). **`assertUniqueStrings`(121행) 제거**와 grep 0건, `categories` 떼어 내기는 복사본 `delete`(구조분해 미사용 변수 경고 회피), 변경 파일 eslint 경고 0(5.4·8.2-4, grep으로 사용처 1곳 확인). **`market-board-preview-route-contract` 파일째 삭제로 확정**(13·18행도 지울 page를 읽음), board-preview page 부재 단언은 retirement 계약으로(8.10-2b·9절). **S0 revert 창** — revert 배포 완료까지 메인 관리 저장 금지 공지, 배포 직후 재조회(5.4·3.9 S0 행), 3.9 표 위에 'S0 이전 배포로 가는 모든 revert·Instant Rollback은 S0 사전 조회를 따름' |
| R7 | R6 개정본 | 독립 재검증(code-feasibility) | 수정 필요 → 반영 | major 1: `tsconfig.json` include의 `.next/types`·`.next/dev/types` 생성물(validator.ts)이 지울 라우트를 import해 tsc 게이트가 오탐 → 8.0-1에 `npx next typegen`·dev 생성물 갱신 절차, 8.2-2에 tsc 기준선 기록 추가. `npx next typegen` 실행 후 tsc 0건 직접 확인 |
| R8 | R7 개정본 | 독립 최종 검증(general-purpose) | **통과** | major 해소 확인(Next 16.0.8 `next-typegen.js`가 `.next/types`만 갱신함을 소스로 확인). minor 2건(8.0-1 생성물 날짜 문구, 적용 대상에 revert 포함) 반영 |
| S0 기록 | 구현 | — | — | 2026-10-12. 사이드바 커밋 `1759cbc`(사이드바 테스트 tests 14·fail 0). tsc 기준선 0건(`npx next typegen` 뒤). 테스트 기준선: 파일별 반복 tests **1095**·fail **53**, 실패 줄 53(실패 suite 0), 두 번 측정 결과 동일(흔들리는 테스트 없음). 명세 명령 `node --test tests/*.test.mjs` 한 번 실행: tests 1095·pass 1032·fail 53·skipped 10 — 파일별 합계와 같아 파일별 목록을 기준선으로 씀(`docs/market-category-tree-test-baseline.txt`, 53줄). 비대화형 실행에서는 요약이 spec(`ℹ`)이 아니라 TAP(`#`) 형식으로 나오므로 8.0-4의 요약 grep은 `'^(ℹ|#) (tests|pass|fail|skipped) '`로 본다 |
| S0-4 기록 | 구현 `da07c34` | 독립 검증(general-purpose) | **통과** | 2026-10-12. 대상 테스트 10/10, 전체 tests 1099·fail 53(기준선 대비 새 실패 0), tsc 0(`npx next typegen` 뒤), eslint 오류·경고 0, scratchpad `next build` 성공, localhost 관리자 국어·영어에서 카드 없음·인기·최근 유지, 공개 홈 정상. **B-0 저장 확인(운영 DB 쓰기)은 사용자 결정으로 보류**(자동 테스트로 갈음, 나중에 확인) → `market_home` 행 0건 상태 유지 |
| S1 기록 | 구현 `aa34232` | 독립 검증(general-purpose) | **통과** | 2026-10-12. 신규 `market-cart-detail-href`(3, 실행 테스트 — 숨김 게시판 픽스처, `market_menu_entries` 조회 없음)·`market-item-detail-url-contract`(9) 통과, 수정 10개 파일은 링크 형태 단언만 변경(`solvook-real-market-detail-contract` 첫 테스트는 새 경로 기준으로 다시 씀 — 이름 변경, 원래 틀려 있던 `listActiveMarketItemSamplePages` 단언도 `count…`로 정정). 전체: 파일별 tests 1111·fail 52, 명세 명령 한 번 실행도 1111·52, 새 실패 0, 고쳐진 기준선 실패 1(위 이름 변경 테스트). tsc 0, eslint 0, scratchpad `next build` 성공(`/items/[itemId]` 생성). curl(localhost): `/items/not-a-uuid` 404, 예전 상세 3종 307(`/korean/market/…`→`?subject=korean`, `/market/…`·쿼리 없는 preview→`/items/{id}`, 쿼리 있는 preview→`?subject=korean`), 정상 상세 200. 브라우저(B-1, 국어·영어): `?subject=english`·쿼리 없음 → 최종 URL `?subject=korean`, 영어 상품 → `?subject=english`·영어 탭·경로 `홈 / 상품`, 국어 경로 `홈 / EBS / 수능특강 독서 변형문제 / 상품명`, 헤더 1·푸터 있음, 404 화면은 Solvook 헤더·푸터 있음(→ (solvook) not-found 경계가 layout의 `notFound()`를 잡음). 홈·검색·카테고리·보관함·영어 홈의 상세 링크 모두 `/items/{id}?subject=`, 예전 주소 0건, 홈 클릭 이동 확인. 장바구니는 테스트 계정 장바구니가 비어 브라우저 클릭은 못 했고 실행 테스트로 갈음. minor 반영: 예전 preview stub이 `subject`를 `isWorkspaceSubject`로 거름. 미반영 minor: `workspace-revalidate.ts:26` `marketItem` 맵(사용처 없음 → S4 정리), 과목 보정 redirect에서 `reviewSort` 유지 안 함. **8.3-5(배포 뒤 Vercel 로그 307·보존 기간·Drain 확인)는 배포 전이라 미실행** — 사용자가 main에 push한 뒤 한다 |
| T1 기록 | M1 적용 `20261012042653` | 독립 검증(general-purpose, 운영 DB는 SELECT만) | **통과** | 2026-10-12. ⓪ MCP 인증·`list_migrations` 성공, 운영 이력이 `20261002014653_market_image_refs`까지 로컬과 일치(예전 `add_market_review_details`는 로컬 version이 달랐으나 이번 작업 이전 차이). Q-1 백업 `~/backups/create_quiz_ai/2026-10-12-T1/`(그룹 5·항목 32·상품 146, 연결 144). 적용 전 상태: ID 중복 0, 상품 FK `n`(set null). **dry-run**: 명시적 begin/rollback 대신 여러 문장 한 번 실행(암묵 트랜잭션) + 마지막 강제 `raise exception 'DRYRUN_RESULT …'`로 전체 롤백 — 예외 뒤 `rollback;`이 실행되지 않아 실패한 트랜잭션이 열린 채 남는 위험을 피함(사전에 PGlite로 동작 확인). 결과: Q-2~Q-7·트리 SQL 테스트 통과, 뒤 조회로 DB 무변화·`idle in transaction` 0 확인. 사용자 승인 후 `apply_migration` → Q-10 version `20261012042653`으로 로컬 파일명 변경, 이력 99→100. Q-11 체크리스트 전부 반영(적용본 md5가 로컬 파일과 같음 — 검증자 확인). Q-2~Q-6 통과, 백업과 상품 146행 `(id, category_item_id)`·항목 32·그룹 5 차이 0. Q-9 `execute_sql` 재실행 무오류·이력 100 유지·행 수 불변. SQL 테스트 2개(트리, 이미지 — depth1 기본 이미지 IN_USE 포함) 같은 방식으로 실행해 강제 마커 `TESTS_PASSED` 확인, 잔여 0. 운영 화면: 광고 두 칸 카테고리 페이지 200, 홈·상세 200, 메가메뉴 API 국어 5그룹(15·6·5·2·4) 그대로. **예측과 다름**: `/categories/{옛 그룹 id}`는 500이 아니라 HTTP 200(카테고리 세그먼트 `loading.tsx` 스트리밍 — 화면은 오류 UI). 링크 없음, T2 뒤 정상 페이지 확인 필요. **8.4-5 타입 재생성 생략**: 생성 파일 ~160KB라 information_schema·pg_constraint로 같은 내용을 확인했고, T2 커밋 1에서 재생성 diff(parent_id·depth·group_id nullable·자기참조 FK)를 반드시 확인. 알려진 한계(minor): M1 5단계 `to_regclass(...) and exists(select … from market_category_groups)`는 T3 뒤 재실행하면 42P01 — 3.2-4가 T2 전 재실행만 허용하므로 파일은 적용본 그대로 둠. 트리거 함수가 SECURITY INVOKER라 RLS를 받는 역할이 쓰면 비활성 부모를 못 보지만 anon·authenticated는 쓰기 권한이 없음. 검증 지적으로 트리 테스트에 '부모 없는 depth2 → root_parent check 23514' 케이스 추가(PGlite 통과, 운영 실행은 T3 SQL 테스트 때). **T2 배포 전까지 관리자 카테고리 편집 금지** |
