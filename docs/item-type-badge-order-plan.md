# 자료 목록 구성 배지 순서 고정 계획

- 작성일: 2026-10-06 · 브랜치 feature/market-cart · 상태: 검증 OK(R1) — 구현 단계
- 요청: 자료 목록 행 오른쪽의 작은 네모(`문제(HWP)`·`문제(PDF)`·`워크북`) 순서를 항상 같게 한다. 순서는 **워크북 → 문제(PDF) → 문제(HWP)**.
- 용어: 이런 작은 라벨은 UI에서 **배지(Badge)** 또는 **태그(Tag)/칩(Chip)**이라고 부른다. 여기서는 상품을 이루는 판매 단위(서브상품)의 종류를 보여 주는 **구성 배지**다.

## 1. 요청 분석

**사실**
- 배지 문구는 서브상품 분류 `market_subproduct_categories.name`이다. DB에는 이미 순서값 `sort_order`가 있고, 두 과목 모두 활성 분류 기준 **워크북 10 · 문제(PDF) 20 · 문제(HWP) 30**이다(SELECT 확인). 요청 순서와 같다. 비활성 분류가 같은 값을 써서 동점이 있다(영어 'PDF' 10·'HWP 파일' 20 등) — 영어 옛 서브상품 2건에 비활성 분류 배지가 붙는 기존 동작은 이번 범위 밖.
- 그런데 목록은 이 순서를 쓰지 않는다. 상품별 서브상품을 `order('id')`로 읽어 처음 나온 순서대로 이름을 모은다.
  - 카테고리 목록: `src/lib/market-categories-server.ts:220-252` (`typeNamesByItem` Set, 삽입 순서)
  - 검색 목록: `src/lib/market-search-server.ts:96-150` (`typeSlugsByItem` → `typeNames`)
  - 그래서 상품마다 순서가 달라진다(사용자 화면 캡처).
- 표시 컴포넌트는 받은 순서 그대로 그린다: `src/components/market/market-item-list-row.tsx:74`(모바일)·데스크톱 칸, `src/components/market/market-item-card.tsx:81`.

**결정**
- D1 순서는 DB `sort_order`를 따른다(하드코딩 금지). 코드에 '워크북·PDF·HWP' 순서를 적지 않는다. 같은 `sort_order`면 이름으로 정렬해 항상 같게 한다.
- D2 정렬은 서버(목록 데이터를 만드는 곳)에서 한다. 표시 컴포넌트는 바꾸지 않는다.
- D3 파일별 처리(공용 함수 없음): 두 서버의 분류 조회에 `sort_order`를 select하고 `.order('sort_order').order('name')`을 붙인 뒤, 배지는 정렬된 분류 배열을 상품의 분류 id 집합으로 `filter`해 만든다. 이름순 보조 정렬로 동점도 항상 같은 순서.
- D4 조사 결과(검증 R1): 배지를 만드는 곳은 위 두 서버뿐, 그리는 곳은 list-row·card뿐. 게시판·홈·보관함엔 배지 없음, 장바구니·결제는 행마다 분류명 하나, 상세 구매 옵션은 서브상품 `sort_order`로 이미 정렬(상품 145개 모두 분류 순서와 일치) → 범위 밖.
- D5 검색 필터 '유형' 옵션(`market-search-server.ts:171-174`, 현재 라벨 가나다순 = 문제(HWP)→문제(PDF)→워크북)도 같은 `sort_order` 순서로 맞춘다("항상 일정하게" 요청 취지). 원치 않으면 되돌리기 쉬운 한 줄 변경.

## 2. 변경 대상(예상)
- `src/lib/market-categories-server.ts`, `src/lib/market-search-server.ts`의 배지 목록 생성부(분류 조회에 `sort_order` 포함).
- (D4 조사 결과에 따라) 같은 배지를 만드는 다른 서버 코드.
- 계약 테스트: 두 서버의 분류 조회에 `.order('sort_order')`·`.order('name')` 체인과 정렬된 분류 배열 기준 배지 생성, 검색 '유형' 옵션 정렬. 동작은 DB SELECT·브라우저 대조로 확인.

## 3. 검증
- `npx tsc --noEmit`, 변경 파일 eslint, 관련 테스트, 전체 `node --test tests/*.test.mjs` 실패 이름이 기준선과 같음, 복사본 `next build`.
- 브라우저(연동된 Chrome): 카테고리 목록(`/categories/<id>?subject=korean`)과 검색(`/search?subject=korean`)에서 모든 행이 워크북 → 문제(PDF) → 문제(HWP) 순서, 좁은 화면(모바일 배지 줄)도 같은 순서.

## 4. 위험
| 위험 | 대응 |
|---|---|
| 관리자가 분류 순서를 바꾸면 배지 순서도 바뀜 | 의도된 동작(데이터로 순서 관리). 상품 관리 화면의 분류 설정에서 sortOrder를 입력해 바꿀 수 있다(`market-products-client.tsx:468-478`) |
| 비활성·삭제된 분류에 연결된 서브상품 | 기존과 같이 분류 조회 조건을 유지(이번 변경은 순서만) |

## 5. 검증 기록
| 회차 | 대상 | 검증자 | 판정 | 비고 |
|---|---|---|---|---|
| R1 | 초안 | 독립 검증 | **OK** | 원인·범위 확인. 보완 a 비활성 동점·이름 보조 정렬 b 파일별 order 체인 c 계약 테스트+DB·브라우저 대조 d 검색 '유형' 옵션 순서도 맞춤(D5) — 반영 |
| 구현 리뷰 | market-categories-server·market-search-server·계약 테스트 | 독립 리뷰(imglib-s3-reviewer) | **OK** | 순서는 sort_order→name, 중복 제거·없는 분류 처리 유지, 유형 필터는 정렬만 변경(값·개수·URL 동일), 추가 쿼리 없음. NIT(카테고리 목록 동작 테스트)은 미반영. 브라우저: 카테고리 목록 20행·검색 카드·자료유형 필터(워크북 64·PDF 144·HWP 144) 모두 워크북→PDF→HWP |
