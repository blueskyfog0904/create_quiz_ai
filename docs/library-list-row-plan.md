# 자료 보관함 목록 한 줄 행(썸네일 + 제목 + 버튼) 계획

- 작성일: 2026-10-02 · 브랜치 feature/market-cart(HEAD 5cfb6c6) · 상태: 1~6절은 초안 구현(5cfb6c6)의 기준이고, **샘플 이미지 대체(D1 ②·D2)는 사용자 결정으로 폐기되어 7절이 갈음한다**.
- 요청: 보관함 행이 3줄(카테고리 배지 / 상품명 / 구매일)이라 한 줄로 바꾸고, `수능특강` 배지와 구매일을 없애며, 맨 왼쪽에 상품 이미지를 둔다. 솔북 보관함 디자인 참고(왼쪽 세로형 썸네일 / 상품명 / 오른쪽 버튼).

## 1. 요청 분석

**사실(근거)**
- 대상은 `src/app/(solvook)/library/_components/library-view.tsx`(671줄)의 `<ul>`/`<li>` 블록(약 513-600행)이다. 행은 `[카테고리 배지 + (환불 심사 중 배지)] / 상품명(Link 또는 span) / 구매일·최근 다운로드 줄`의 3줄 + 오른쪽 `환불 신청`·파일별 다운로드 버튼이다. 목록 컨테이너는 `divide-y` + 카드 외곽(`border`·`shadow`)이다.
- 제거 대상: 배지의 `row.categoryTitle`(`수능특강`)과 `구매일 … · 최근 다운로드 …` 줄 전체. `categoryTitle`은 카테고리 필터(`LIBRARY_FACETS`)에서, `purchasedAt`은 `최근 구매 순` 정렬(`b.purchasedAt.localeCompare`)에서, `formatDate`는 환불 Dialog의 구매일(`target.purchasedAt`)에서 계속 쓰이므로 데이터·함수는 남는다. 이 파일을 읽는 계약 테스트는 없다(`market-library-listboard-contract`는 legacy `market-library-client`를 읽는다).
- 상품명은 이미 상세 링크다(`/${subject}/market/${categorySlug}/items/${itemId}`, `categorySlug`가 없으면 span). 이번에 경로는 바꾸지 않는다.
- **이미지 출처(DB SELECT 확인, 2026-10-02)**: `market_items.thumbnail_url`(어드민이 외부 URL을 입력, `market-products-client.tsx`) 컬럼은 있지만 **삭제되지 않은 146개 상품 전부 NULL**이다. 목록·카드(`market-item-card`, `market-item-list-row`)도 이 컬럼을 쓰고 없으면 `FileImage` 점선 박스를 보여 준다(`h-[96px] w-[72px]`, `object-contain`). 한편 `market_item_sample_pages`(무료 샘플 JPG 페이지)는 145개 상품에 있고 **구매한 8개 상품 모두에 있다**. 파일은 비공개 Storage 버킷(`MARKET_STORAGE_BUCKET`)이고 `/api/market/items/[itemId]/sample-pages`가 `createSignedUrls(…, 3600)`로 서명 URL을 준다.
- `MarketLibraryRow`(DTO)에는 이미지 필드가 없다. `listMarketLibraryRowsForUser`는 `market_items`를 `select('*')`로 읽는다(thumbnail_url 포함). 이 함수는 legacy `/legacy/_library/market`도 호출한다.
- `MaterialCover`(preview 홈)는 hex 팔레트를 쓰는 목업 표지라 재사용하지 않는다.

**결정**
- D1 **[② 샘플 대체는 7절에서 폐기]** **이미지 우선순위**: ① `thumbnail_url`(있으면) ② 없으면 **첫 활성 샘플 페이지 이미지**(`display_order`, `page_number` 오름차순 첫 장)의 서명 URL ③ 둘 다 없으면 기존 점선 박스 + `FileImage`(같은 클래스·토큰). 하드코딩 없이 모두 DB 값이다. 현재 데이터로는 ②가 실제 표시되는 경로다. **사용자 확인 필요**: 샘플 첫 페이지가 문제지 첫 장이라 솔북 같은 '표지'와는 모양이 다르다. 어드민이 `thumbnail_url`을 등록하면 자동으로 ①이 우선한다.
- D2 **[7절에서 폐기: 샘플 조회·서명 함수는 없앤다]** **서버 구현**: `src/lib/market-items-server.ts`에 `attachMarketLibraryCoverUrls(rows, subject)`를 추가하고 `/library` page에서만 호출한다(legacy 보관함은 서명 비용 없음). 동작: `thumbnail_url`이 없는 `itemId`만 모아 `market_item_sample_pages`(`item_id, storage_bucket, storage_path`만 select, `is_active`·`deleted_at is null`·과목 조건, 정렬)를 한 번 조회해 항목별 첫 장을 고르고 버킷별 `createSignedUrls`를 1회 호출한다. 실패하면 해당 항목만 `null`(보관함 자체는 정상 표시). `MarketLibraryRow`에 `coverUrl?: string | null`을 추가한다. 상품 수는 보관함 항목 수(수십)라 쿼리 2개 + 서명 1회로 충분하다. (R1 N1) 보관함 페이지네이션은 클라이언트 slice이므로 서명 범위는 현재 페이지가 아니라 보관함 전체 행이다. 현재 페이지분만 서명하려면 서버 페이지네이션이 필요하다(후속). (R1 N2) 보유자에게는 비공개·판매 중지 상품의 샘플도 서명해 표시한다. 구매한 자료의 표지이므로 의도한 결정이다. 두 사항은 `attachMarketLibraryCoverUrls` 주석에도 남긴다.
- D3 **행 레이아웃(데스크톱, `sm` 이상)**: `li`는 `flex items-center gap-4`의 한 줄이다. `[썸네일 h-16 w-12] [상품명 flex-1 min-w-0, line-clamp-1(말줄임) + title 속성] [환불 심사 중 배지(있을 때만) + 환불 신청 + 다운로드 버튼들 shrink-0 flex-wrap justify-end]`. 썸네일은 `rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] object-cover object-top`, `loading="lazy"`, `alt=""`(장식, 제목이 같은 정보), `<img>`는 목록 행과 같은 `eslint-disable-next-line @next/next/no-img-element` 관례를 따른다. 서명 URL 만료·로드 실패 시 `onError`로 점선 박스로 대체한다. 파일이 많아 버튼이 넘치면 버튼 영역만 `sm:max-w-[55%]`에서 줄바꿈하고 상품명은 계속 한 줄이다.
- D4 **모바일(`sm` 미만)**: `li`는 `flex-wrap items-center gap-x-3 gap-y-2`. 1줄째 `[썸네일][상품명 line-clamp-2]`, 2줄째 버튼 영역이 `w-full justify-start`. 가로 넘침 없이 320px에서 동작해야 하고 상품명은 `min-w-0`이다.
- D5 **터치 영역**: 환불 신청·다운로드 버튼을 `min-h-9`에서 `min-h-11`(44px)로 올린다(DESIGN.md). 환불 버튼의 기존 `red-*` 클래스는 이번에 건드리지 않는다. 비활성 다운로드(환불 심사 중)의 `cursor-not-allowed opacity-50`도 그대로다.
- D6 **유지**: 필터·검색·정렬(`최근 구매 순`)·페이지네이션·과목 전환, 환불 Dialog(구매일 표시 포함), 다운로드 링크와 `scheduleDownloadRefresh`, `환불 심사 중 (다운로드 제한)` 배지(기능 상태라 제거하지 않고 버튼 영역 맨 앞에 둔다). 목록 컨테이너의 `divide-y`·카드 외곽도 유지한다.
- D7 **판매자명 열은 넣지 않는다**(요청 없음). **사용자 확인 필요(낮음)**: 솔북처럼 구분선 없는 목록, 판매자명 표시 여부.
- D8 `최근 다운로드` 문구도 제거되는 줄에 있었으므로 함께 사라진다(`lastDownloadedAt` 데이터는 DTO에 남긴다).

**불명확점**: D1(이미지 모양)은 7절 결정으로 해소됐다. D7 두 가지만 사용자 확인 대상이다.

## 2. 대상 경로
- 변경: `src/app/(solvook)/library/_components/library-view.tsx`(행 마크업·버튼 높이), `src/app/(solvook)/library/page.tsx`(커버 URL 부착 호출), `src/lib/market-items-server.ts`(`MarketLibraryRow.coverUrl?`, `attachMarketLibraryCoverUrls`).
- 무변경: legacy `/legacy/_library/market`, 환불 API, 다운로드 API, DB 스키마·migration.

## 3. 단계별 작업과 검증
- **S0 기준선**: `git status --porcelain`, `node --test tests/market-*.test.mjs tests/studio-adoption-contract.test.mjs 2>&1 | tail -5`, `npx tsc --noEmit` 기록. 구매 보유 계정으로 현재 /library 스크린샷을 남긴다.
- **S1 테스트 먼저**(4절): 신규 계약 테스트가 현 구현에서 실패한다.
- **S2 서버 커버 URL** [7절 C2로 대체됨, 아래 내용은 폐기]
- **S3 행 UI**: 위 D3~D6. 검증: tsc·eslint exit 0, 신규 계약 테스트 통과.
- **S4 브라우저**(구매 8건 계정, 1280/768/320px): ① 각 행이 한 줄(썸네일 / 상품명 / 버튼)이고 `수능특강` 배지·`구매일`·`최근 다운로드`가 없다 ② [샘플 첫 장 이미지는 7절에서 폐기, 7절 C4 ①③으로 대체] 맨 왼쪽에 샘플 첫 장 이미지가 보이고 이미지가 없는 상품은 점선 박스다(어드민 테스트 상품에 `thumbnail_url`을 임시 입력해 ①순위 확인 후 복구) ③ 긴 상품명이 말줄임이고 마우스를 올리면 title이 보인다 ④ 환불 신청·HWP/PDF 다운로드가 동작한다(다운로드 후 `최근` 갱신 로직 유지) ⑤ `환불 심사 중` 상태 행의 배지·비활성 버튼 ⑥ 필터(카테고리 포함)·검색·`최근 구매 순`/이름순·페이지네이션·과목 전환 ⑦ 환불 Dialog에 구매일이 그대로 있다 ⑧ 320px에서 `document.documentElement.scrollWidth <= innerWidth`, 버튼 `getBoundingClientRect().height ≥ 44` ⑨ [서명 URL 만료 확인은 7절에서 폐기, 깨진 외부 URL은 C4 ④] 서명 URL을 만료시킨 이미지(잘못된 token)가 점선 박스로 대체된다 ⑩ `/legacy/_library/market`이 이전과 같다.
- **S5 통합**: `npm run lint`·`npm run build` 새 실패 0, `node --test` 새 실패 0(S0 대비), 사용자 기존 변경 보존(`git checkout`/`restore` 금지).

## 4. 테스트
- 신규 `tests/library-list-row-contract.test.mjs`(소스 계약): `library-view.tsx`에 `row.categoryTitle` 배지(`rounded-full bg-[var(--studio-primary-soft)]` 안 `{row.categoryTitle}`)와 `구매일 {formatDate(row.purchasedAt)}` 줄이 없다 · `formatDate`·`LIBRARY_FACETS`·`purchasedAt` 정렬은 남아 있다 · `row.coverUrl`을 쓰는 `<img>`가 상품명보다 소스상 앞에 있고 `loading="lazy"`·`alt=""`·`onError`가 있다 · 상품명에 `title={row.title}`와 `line-clamp` · 버튼 클래스에 `min-h-11` · raw hex·새 Tailwind 색 팔레트 추가 없음(기존 `red-*`는 허용 목록) · `page.tsx`가 `attachMarketLibraryCoverUrls`를 호출하고 legacy page는 호출하지 않는다 · [7절에서 폐기·교체] 서버 함수가 `thumbnail_url`을 우선하고 `market_item_sample_pages`·`createSignedUrls`로 대체하며 `is_active`·`deleted_at` 조건을 둔다. 또한 `row.coverUrl`·`page.tsx`의 attach 호출 assert도 7절 기준(`thumbnailUrl`, 샘플 미조회)으로 바꾼다.
- 기존 테스트 영향: 없음(보관함 UI를 읽는 계약 테스트 없음). `market-library-listboard-contract`(legacy)와 `studio-adoption-contract`는 수정 없이 통과해야 한다.
- 브라우저로만 확인: S4 ②③⑨(실제 이미지·서명 URL·레이아웃).

## 5. 위험
| 위험 | 대응 |
|---|---|
| ~~샘플 첫 장이 표지처럼 보이지 않는다~~ [7절에서 폐기] | D1 사용자 확인. `thumbnail_url` 등록 시 자동 우선 |
| ~~서명 URL이 1시간 뒤 만료되어 깨진 이미지가 보인다~~ [7절에서 폐기] | `onError`로 점선 박스 대체, 페이지 재진입 시 재발급 |
| ~~보관함 항목이 많을 때 서명·쿼리 비용 증가~~ [7절에서 폐기] | 첫 장만 select·버킷별 1회 서명, 실패는 항목 단위로 무시. 100건 이상이면 후속에서 현재 페이지분만 서명 |
| 버튼이 많은 행이 한 줄에 들어가지 않는다 | 버튼 영역만 줄바꿈 허용(D3), 상품명은 한 줄 유지 |
| 카테고리 배지 제거로 카테고리를 알 수 없다 | 카테고리 필터(칩)는 유지, 요청에 따른 의도된 변경 |
| 버튼 44px 확대로 행 높이가 늘어 한 줄 느낌이 약해진다 | 썸네일 높이(64px)가 이미 더 커서 행 높이는 거의 변하지 않음, S4 육안 확인 |
| 사용자 기존 변경 덮어쓰기 | S0 기록, 행 블록과 버튼 클래스만 수정 |

## 6. 검증 기록
| 회차 | 대상 | 검증자 | 판정 | 근거·보완 사항 |
|---|---|---|---|---|
| R1 | 계획 초안 | (대기) | | 샘플 서명 범위 관련 R1 N1·N2가 나오더라도 7절 결정으로 폐기(해당 코드 삭제) |
| 구현 | library-view·library/page·market-items-server·계약 테스트 | 독립 검증 | OK | 한 줄 행, 배지·구매일 제거, 표지(thumbnail→샘플 첫 장 서명→점선 박스), 버튼 44px. tsc·eslint·build 통과, node 991건 fail 39(새 실패 0). 비차단: sample_pages 전체 페이지 조회(행 多 시 1000행 제한), 표지 failed 상태가 src 변경 시 미초기화. 로그인 실화면은 사용자 확인 |
| 사용자 결정 | 샘플 이미지 대체 폐기(2026-10-02) | 사용자(팀 리드 전달) | 반영 | "왜 샘플이미지를 가져오지? 이미지 등록이 안 되어 있으니 상품 리스트처럼 나와야 한다" → D1 ②·D2·R1 N1·N2 폐기, 7절 |

## 7. 추가 결정(샘플 대체 폐기, 2026-10-02)
사용자 지시: 이미지가 등록되지 않았으므로 보관함은 **상품 목록·카드와 같은 모양**(이미지 있으면 이미지, 없으면 점선 박스 플레이스홀더)으로 나와야 한다. 샘플 문제지 첫 장은 쓰지 않는다. 구현(5cfb6c6)에는 `attachMarketLibraryCoverUrls`·`coverUrl`·`LibraryCover`(onError 포함)가 이미 있어 아래대로 되돌려 단순화한다.

**사실(근거)**
- 상품 목록 행·카드의 규칙은 `thumbnailUrl ? <img src alt="" loading="lazy" class="… border … object-contain"/> : <div class="flex … items-center justify-center rounded-[var(--studio-radius-control)] border border-dashed border-[var(--studio-border)] bg-[var(--studio-background)] text-[var(--studio-muted)]"><FileImage aria-hidden class="h-5 w-5"/></div>`이다(`market-item-list-row.tsx`, `market-item-card.tsx`). 이미지는 `next/image`가 아니라 **`<img>` + `// eslint-disable-next-line @next/next/no-img-element -- 어드민이 등록한 외부 썸네일 URL`** 이다. 두 곳은 크기만 다르다(72×96, 92×130).
- `listMarketLibraryRowsForUser`는 이미 `market_items`를 `select('*')`로 읽으므로 `thumbnail_url`이 추가 쿼리 없이 손에 있다. 현재 DB는 `thumbnail_url`이 전부 NULL이라 보관함 전 행이 점선 박스가 되고, 홈 '최근 등록된 수업 자료'와 같은 모습이 된다(의도된 결과).

**결정**
- D9 **샘플 대체 폐기**: `market_item_sample_pages` 조회, 서명 URL 생성, 첫 장 선택 로직을 모두 삭제한다. D1 ②·D2와 그에 딸린 S2·S4 ⑨(서명 만료)·위험 3행을 폐기한다.
- D10 **더 단순한 방법 선택**: ① `attachMarketLibraryCoverUrls`를 thumbnail만 조회하게 축소하는 안은 이미 읽은 값을 다시 쿼리하고 함수·page 호출이 남아 불필요하다. ② **함수를 없앤다**: `MarketLibraryRow`에 `thumbnailUrl: string | null`(`MarketSearchRow`와 같은 이름)을 필수로 두고 `listMarketLibraryRowsForUser`가 `item?.thumbnail_url ?? null`로 채운다. `/library` `page.tsx`는 원래 형태(attach import·호출 삭제)로 돌아가고, `coverUrl?`·주석을 지운다. legacy 보관함도 같은 DTO를 받지만 쓰지 않는다. 추가 쿼리 0개. **②를 택한다.**
- D11 **플레이스홀더·이미지 마크업**: `LibraryCover`를 목록 행과 같은 토큰·클래스(`border-dashed border-[var(--studio-border)] bg-[var(--studio-background)] text-[var(--studio-muted)]`, `FileImage h-5 w-5`)로 맞추고 크기만 보관함 행에 맞춰 `h-16 w-12`로 둔다. 이미지는 `<img loading="lazy" alt="">`에 `object-contain`(목록과 같음, 샘플용 `object-cover object-top`은 삭제)과 같은 `eslint-disable` 주석을 쓴다. 외부 URL이 깨질 때를 위한 `onError` 대체는 로컬 상태 3줄이라 유지한다(목록 행에는 없으므로 이 차이만 남긴다).
- D12 **공통 컴포넌트는 만들지 않는다**: 같은 마크업이 목록 행·카드·보관함 3곳이지만 크기가 모두 다르고 보관함만 `onError` 상태를 소유해 props·상태 소유권이 대응하지 않는다(DESIGN.md Components 절). 기존 두 곳 수정은 이번 요청 범위 밖이다. 통합이 필요하면 별도 정리 요청으로 제안한다.

**작업 단계와 검증**
- **C1 테스트 먼저**(아래): 현 구현에서 새 assert가 실패한다.
- **C2 서버 단순화**: `attachMarketLibraryCoverUrls`·`coverUrl` 삭제, DTO `thumbnailUrl` 추가와 채움, `page.tsx` 원복. 검증: `npx tsc --noEmit`, `npx eslint`(세 파일) exit 0, `grep -n "attachMarketLibraryCoverUrls\|coverUrl\|createSignedUrl" src/lib/market-items-server.ts "src/app/(solvook)/library"` 결과에 라이브러리 관련 항목이 없다.
- **C3 뷰 정리**: `row.coverUrl`→`row.thumbnailUrl`, `LibraryCover` 마크업 정리. 검증: tsc·eslint exit 0, `node --test tests/library-list-row-contract.test.mjs tests/studio-adoption-contract.test.mjs` 통과.
- **C4 브라우저**: ① 구매 8건 계정의 /library 모든 행이 점선 박스 + `FileImage`이고 샘플 이미지가 없다(Network에서 `/storage/v1/object/sign` 요청 0건) ② 홈 '최근 등록된 수업 자료' 행의 플레이스홀더와 테두리·배경·아이콘이 같다(크기만 다름) ③ 구매 상품 1건에 임시로 `thumbnail_url`(접근 가능한 이미지 URL)을 넣으면 그 행에 이미지가 나오고, 복구한다 ④ 깨진 URL은 점선 박스로 대체된다 ⑤ 한 줄 행·말줄임·버튼·필터·정렬·320px 넘침은 4절 S4 ①③~⑧⑩과 같다.
- **C5 통합**: `npm run lint`·`npm run build` 새 실패 0, `node --test` 새 실패 0, 사용자 기존 변경 보존.

**테스트 갱신**(`tests/library-list-row-contract.test.mjs`)
- 제거: 'cover URL prefers thumbnail_url and falls back to … sample page signed URL', 'only the /library page attaches cover URLs', `row.coverUrl` 관련 assert.
- 신규: `listMarketLibraryRowsForUser` 본문에 `thumbnailUrl:`이 `thumbnail_url`에서 채워진다 · 같은 함수 본문(함수 시작~다음 `export` 사이)에 `market_item_sample_pages`·`createSignedUrl`이 없다(**sample_pages 미조회**) · `market-items-server.ts`에 `attachMarketLibraryCoverUrls`·`coverUrl`이 없고 `page.tsx`에도 없다 · `library-view.tsx`가 `row.thumbnailUrl`을 쓰고 목록 행과 같은 플레이스홀더 클래스·`FileImage`·`<img … loading="lazy" alt="">`·`eslint-disable-next-line @next/next/no-img-element`가 있으며 `object-top`·`signedUrl`이 없다 · 기존 배지·구매일 제거, 한 줄 순서, `min-h-11`, 팔레트 assert는 유지한다.

**위험**: 현재 전 행이 플레이스홀더라 단조로워 보일 수 있다(사용자가 원한 모습이며 이미지는 어드민 등록 데이터로 해결). 레거시 보관함이 DTO 필드를 받지만 영향이 없다. 5cfb6c6 이후 사용자 변경은 C2·C3에서 해당 블록만 고친다.
| 7절 구현 | market-items-server·library page·view·계약 테스트 | 독립 검증 | OK | 표지 thumbnail_url→목록 행과 같은 점선 박스, 샘플·서명 코드 제거(grep 0), page.tsx 원복, 추가 쿼리 0. tsc·eslint·build 통과, node 991건 fail 39(새 실패 0) |
