# 19번 묶음 계획 · 상품 표시 설정

작성일: 2026-11-26
판: 2 (검증 PASS, 2026-11-26) — 1판은 화면 FAIL(major 4)·결제 FAIL(major 2), 2판은 두 관점 PASS 였다. 반영은 13절 표, 2판 검증 minor 는 같은 판에서 반영했다(14절). 고친 곳 끝에 `(2판)`.
- 2판 큰 변경: **장바구니·결제 경로는 표시 설정을 읽지 않는다.** 표시명 기본 제목 규칙은 상품 상세에만 쓴다.
- 작업 순서표 19번: 상세 안내 문구(샘플 "첫 N쪽" 수정), 자료 정보 항목, 전체구매 표시명을 상세에도, 서브상품 순서 변경
- 출처
  - `docs/admin-content-management-plan.md` 1절 9·10번, 2-2 '상품 표시 설정(신설)', 3절 2-2·2-3
  - 같은 문서 5절 3번 대표 결정(2026-11-20): **전체구매는 관리자가 입력한 표시명을 상세에도 쓰고, 비어 있으면 "전체 패키지"**
- 앞 묶음
  - 17번: '상품 표시 설정' 화면, 설정 행 `market_item_display`, 행위자 함수 `market_catalog_actor_allowed`
  - 18번: 나눈 편집 부품 `_editor/*`·`_settings/*`
- 국어·영어 같은 구조: 표시 설정은 두 과목 공통 행 하나다(17번 Q7). 서브상품 순서는 상품마다 정한다.

## 0. 대표 결정이 필요한 것(질문)
답이 오기 전에는 '기본안'으로 진행한다. 문구는 초안으로 넣고 최종은 대표가 관리자 화면에서 고친다.

| # | 질문 | 기본안 | 이유 |
|---|---|---|---|
| Q1 | DB 로 옮길 상세 안내 문구 | **샘플 줄**(제목·설명·버튼, 샘플 있음/없음/옛 샘플), **HWP+PDF 기본 안내**(이름표·본문), **전체구매 기본 제목**, **자료 정보 위 요약 두 줄 이름**(포함 문항·샘플 페이지) | 1절 9번 목록. '구매 하단 안내'는 이미 DB(`market_purchase_policy.purchaseCompleteNotice`, 구매 고지 카드, 11번)라 그대로 둔다 |
| Q2 | 샘플 "첫 N쪽" 대신 쓸 말 | **"샘플 {장수}장을 미리 볼 수 있어요."**(자리표시 `{장수}`) | 샘플은 1·5·7쪽처럼 고를 수 있어서 '첫 N쪽'이 틀릴 수 있다 |
| Q3 | 자료 정보 항목 관리 범위 | **항목 6개(과목·학년·출처·자료유형·문항 수·등록일자)의 이름·보이기·순서.** 항목을 더하거나 지우는 기능은 없다. 숨긴 학년·자료유형은 위 배지에서도, 숨긴 등록일자는 위쪽 등록일 줄(`market-material-detail.tsx:253-259`)에서도 숨긴다 (2판) | 항목은 상품 칸과 1:1 이라 새 항목은 코드가 필요하다 |
| Q4 | 지금 전체구매 표시명(145행 모두 "전체 한번에 구매하기") | **옛 기본 글자를 코드에서 모두 지운 뒤(5절), 코드 배포 다음에 스크립트로 이 글자인 행을 '전체 패키지'로 바꾼다**(되돌림 포함, 4-5) (2판) | 그대로 쓰면 상세 제목이 "전체 한번에 구매하기"로 바뀐다(2026-10-06 D8 의 걱정). 코드가 옛 글자를 다시 채우면 스크립트 뒤에도 되살아난다 |
| Q5 | 표시명을 비우면 | **비운 채 저장할 수 있다(빈 문자열). 상품 상세는 DB 의 `bundleDefaultTitle` 을 보인다.** 장바구니·결제 완료 창은 지금처럼 빈 이름 줄을 숨기고 위 꼬리표만 보인다(설정을 읽지 않음) (2판) | 대표 결정 그대로다. 결제 경로에 설정 읽기를 넣으면 읽기 실패가 장바구니 고장이나 '돈은 빠졌는데 실패 응답'이 될 수 있다(결제 관점 major) |
| Q6 | 서브상품 순서 | **상품 편집의 서브상품 표에서 [위로]·[아래로] → [순서 저장]. 저장하면 그 상품 서브상품 전부를 10·20·30… 으로 다시 매긴다. 새 서브상품은 그 상품의 맨 뒤(지우지 않은 서브상품 `max(sort_order) + 10`, 없으면 10)로 만든다.** 기존 상품을 한꺼번에 정리하지 않는다 (2판) | 지금 값이 0~3 으로 섞여 있고, 같은 값이면 만든 순서로 보인다. 일괄 정리는 다른 안(구성 순서대로 다시 매기는 스크립트) |
| Q7 | 구성·파일 유형 설정 창 | **'상품 표시 설정'으로 옮긴다**(탭 하나). 상품 편집 선택칸 안의 '설정하기' 세 곳은 선택칸 옆 링크(새 탭)로 바꾸고, 편집 화면은 돌아오면 목록을 다시 읽는다(6-2). slug·code 는 읽기만 (2판) | 2-2 계획. 잠금은 17번 DB 트리거가 맡는다. 지금은 같은 화면에서 만들고 바로 고르는 흐름이라 다시 읽기가 없으면 새 구성을 고를 수 없다 |
| Q8 | 안내 문구 속 '전체 패키지' | **상품 종류 이름으로 그대로 둔다.** 표시명은 제목·체크박스 이름에만 쓴다. 상세의 선택 불가 이유 두 줄(`BUNDLE_SELECTED_REASON`·`SUBPRODUCT_SELECTED_REASON`)과 11번 장바구니 동의 문구(`partialOwnedConfirmLabel` '부분 보유 전체 패키지 정가 확인', DB)는 바꾸지 않는다 (2판) | 11번 동의 문구는 동의 지문에 들어가고 정책 문서 잠금 기간이다. 표시명은 상품마다 달라질 수 있어 고정 문장에 끼울 수 없다 |

## 1. 지금 상태(코드·운영 DB 읽기 전용 확인, 2026-11-26)
- **상세 구매 칸** `src/components/market/market-item-actions.tsx`(1,113줄, 11번 뒤 장바구니 담기만)
  - 샘플 줄 1000~1015행
    - 제목: '무료 샘플 미리보기'/'샘플 준비 중'
    - 설명: "구매 전 PDF 첫 {samplePageCount}쪽을 확인할 수 있어요."·옛 샘플 안내·'현재 이 자료는 미리보기를 제공하지 않습니다.'
    - 버튼: '샘플 보기'
  - HWP+PDF 기본 안내 `DEFAULT_HWP_PDF_NOTICE`(104~107행): 'PDF 포함' / '편집 가능한 HWP와 문제(PDF)를 함께 제공합니다. …'
    - 서브상품에 `purchase_notice_text` 가 있으면 그것을 쓴다(`resolveSubproductPurchaseNotice` 136~151행). 운영에서 그 칸은 0건이다.
  - 전체구매 제목은 771~791행 고정 '전체 패키지'(D8, `docs/purchase-section-redesign-plan.md:194`)다. 체크박스 이름은 '전체 패키지 선택'이다.
  - 아래 안내는 `purchasePolicy.purchaseCompleteNotice`(DB, 11번)다.
- **상세 본문** `src/app/preview/solvook-concept/_components/detail/market-material-detail.tsx`
  - 자료 정보 표 122~149행: 이름 6개가 코드 글자다. 빈 값은 행을 뺀다.
  - 배지 220~241행: 연도·자료유형·학년
  - 요약 262~271행: '포함 문항'·'샘플 페이지'·'정보 없음'·'제공 없음'
  - 표지 아래 버튼 `market-material-sample-button.tsx:47`: '샘플 {n}장 보기'/'샘플 없음'
- **전체구매 표시명**
  - 운영 `market_item_bundle_options.label` 145행(사용 64·안 씀 81)이 모두 "전체 한번에 구매하기"다. 칸은 NOT NULL 이고 CHECK 는 없다(빈 문자열 가능).
  - 관리자 route(`items/[id]/bundle-option/route.ts:16`)는 `label` 을 선택으로 받는다.
  - 회원 쪽에서 쓰는 곳: `listMarket…BundlePublicSummary`(`market-items-server.ts:1525`) → 상세 `bundleOption.label`(지금은 안 씀), DB `evaluate_market_targets` 의 `b.label` → 장바구니 줄·결제 완료 창 `optionTitle`(`market-checkout-server.ts:23`, `cart-checkout-panel.ts:333`)
    - 빈 `optionTitle` 은 세 곳 모두 숨긴다(`cart-line-list-view.tsx:95`, `cart-checkout-panel-view.tsx:241`, `market-purchase-complete-dialog.tsx:80`). 장바구니 줄 위 꼬리표는 묶음이면 고정 '전체 패키지'다(`cart-line-list-view.tsx:83`). (2판)
  - 관리자 주문 화면도 지금 표시명을 읽는다(`admin-orders-server.ts:363·616`, `?? ` 라 빈 문자열을 거르지 못함). 과거 구매 줄 이름이 스냅숏이 아니라 지금 표시명이다. 운영 묶음 구매 줄 1건, 결제 묶음 결과(`market_checkout_batches.result_payload`) 1건에 옛 글자가 있다. 그 결과 기록은 바꾸지 않는다. (2판)
  - **옛 기본 글자를 다시 채우는 곳**(2판): 서버 `upsertMarketItemBundleOption`(`market-items-server.ts:1126` `normalizeText(input.label) || '전체 한번에 구매하기'`), 관리자 폼 `market-products-client.tsx:520`(새 폼 첫 값)·`530`(불러올 때)·`1058`(저장 때)·`2753`(고정 글자), DB 칸 기본값(`20260528010000_create_market_subproduct_v2_schema.sql:116`)
  - **동의·결제 판정과의 관계**(2판, 운영 `pg_proc` 확인): `build_checkout_consent_v2`·`checkout_market_selection` 은 `market_item_bundle_options` 를 읽지 않는다. 11번 동의 지문에는 상품 표시명이 들어가지 않는다. 금액·판정은 표시명과 무관하다. 장바구니 동의 문구 `partialOwnedConfirmLabel` 은 '전체 패키지'를 상품 종류 이름으로 쓴다(Q8).
  - 자료 보관함·환불 목록은 묶음을 고정 글자 '전체구매'로 보인다(`market-items-server.ts:2738`).
- **서브상품 순서**
  - `market_item_subproducts.sort_order` 가 있다. 공개 읽기는 `sort_order, created_at` 순이다(`market-items-server.ts:1303-1304`).
  - 운영 값: 국어 `question_hwp` 0~3, `question_pdf` 0~2, `workbook` 0~1 이 섞여 있다.
  - 관리자 화면에는 순서를 바꾸는 곳이 없다(PATCH route 는 `sortOrder` 를 받음, `market-items-server.ts:896`). 새 서브상품은 늘 0 으로 만들어진다(`market-items-server.ts:843`, 화면이 `sortOrder` 를 보내지 않음). (2판)
  - 서브상품 공개 읽기는 캐시가 없다(상세가 요청마다 읽음). 서브상품 route 도 태그를 갱신하지 않는다. (2판)
  - DB 함수 가운데 서브상품 `sort_order` 를 읽는 것은 없다(운영 `pg_proc` 확인). 결제·환불 판정과 무관하다.
- **구성·파일 유형 설정 창**은 상품 편집 안(18번 뒤 `_settings/*`)에 있다. 서브상품 구성·파일 유형 선택칸 안의 '설정하기' 항목(`MANAGE_*_VALUE`, 2426~2439·2585~2598·2678~2691행)으로 연다. 편집 화면 목록은 `subproductCategories`·`activeFileTypes` 상태값이다. (2판)
- **설정 행** `market_item_display`(17번, 공통): `facetLabels`·`libraryEmptyFilterHint`. 저장 함수 `save_market_item_display`(필수 키 검사), 작업 기록 `market_item_display_update`
- **localhost**: 상품 상세를 열면 조회 기록이 운영 DB 에 쓰인다(15번 11-3). 화면 시험은 미리보기로 한다.

## 2. 목표
1. 상세의 샘플 안내·HWP+PDF 기본 안내·전체구매 기본 제목·요약 이름이 DB 에 있다. '상품 표시 설정'에서 고친다. 샘플 문장이 장수를 정확히 말한다.
2. 자료 정보 표 6항목의 이름·보이기·순서를 관리자가 정한다. 상세 표와 배지가 이를 따른다.
3. 상세의 전체구매 제목이 표시명이다. 비어 있으면 기본 제목이 보인다. 체크박스 이름도 같은 글자다.
4. 옛 기본 글자 '전체 한번에 구매하기'가 코드에서 사라지고, 운영 데이터는 '전체 패키지'로 바뀐다. 장바구니·결제 경로는 설정을 읽지 않고 지금 규칙(빈 이름은 숨김) 그대로다. 장바구니 묶음 줄에 같은 이름이 두 번 보이지 않는다. (2판)
5. 관리자가 상품마다 서브상품 순서를 바꾸면 상세·관리자 화면이 그 순서로 보인다.
6. 구성·파일 유형 관리가 '상품 표시 설정' 안으로 옮겨진다.

## 3. 범위
**넣는 것**: 설정 행 키 추가·저장 함수 교체, 서브상품 순서 함수·새 서브상품 맨 뒤, 옛 기본 글자 지우기, 표시명 데이터 스크립트와 되돌림, 상세 표시 규칙, 장바구니 줄 이름 겹침 정리, 관리자 탭 3개, 시험. (2판)
**넣지 않는 것**
- 구매 고지 문구(`market_purchase_policy`, 11번 카드에서 관리)
- 자료 정보 새 항목
- 홈 진열(22번)
- 서브상품 순서 일괄 정리(Q6 다른 안)
- 검색 결과 카드 문구
- 보관함의 '전체구매' 고정 글자(DB 화는 후속)

## 4. DB 변경(마이그레이션 `<버전: 적용 순서에 맞춰 정함>_bundle19_product_display.sql`)
기존 표에는 DDL 이 없다. `system_settings` 한 행 UPDATE 와 함수 만들기·교체만 하므로 light 리허설로 충분하다(낮 가능).

### 4-1. 사전 점검(다르면 멈춤)
- 17번 행 `market_item_display` 가 있고 `detail` 키가 없다.
- `save_market_item_display` 지문이 17번 적용 값과 같다. 상수로 두고 17번 적용 뒤 채운다.
- 18번 `duplicate_market_item` 이 있다. 순서 확인용이다(18 → 19).
- `reorder_market_item_subproducts` 가 없다.

### 4-2. 설정 행에 `detail` 더하기(`value || jsonb_build_object('detail', …)`, `revision + 1`)
```
"detail": {
  "sampleTitle": "무료 샘플 미리보기", "sampleTitleEmpty": "샘플 준비 중",
  "sampleDescription": "샘플 {장수}장을 미리 볼 수 있어요.",
  "sampleDescriptionLegacy": "기존 샘플 PDF는 판매용 PDF 재업로드 후 JPG 미리보기로 대체됩니다.",
  "sampleDescriptionEmpty": "현재 이 자료는 미리보기를 제공하지 않습니다.",
  "sampleRowButton": "샘플 보기",                                   // 구매 칸 샘플 줄 (2판)
  "sampleButton": "샘플 {장수}장 보기", "sampleButtonEmpty": "샘플 없음",   // 표지 아래 버튼
  "hwpPdfNoticeLabel": "PDF 포함",
  "hwpPdfNoticeText": "편집 가능한 HWP와 문제(PDF)를 함께 제공합니다. PDF는 따로 구매하지 않아도 됩니다.",
  "bundleDefaultTitle": "전체 패키지",
  "summaryLabels": { "questionCount": "포함 문항", "samplePages": "샘플 페이지", "unknown": "정보 없음", "noSample": "제공 없음" },
  "infoItems": [ { "key": "subject", "label": "과목", "visible": true }, { "key": "grade", … }, { "key": "sources", "label": "출처", … },
                 { "key": "materialType", "label": "자료유형", … }, { "key": "questionCount", "label": "문항 수", … }, { "key": "registeredAt", "label": "등록일자", … } ]
}
```
- 첫 값은 지금 화면 글자 그대로다(샘플 설명만 Q2 새 문장). 그래서 배포해도 화면이 바뀌지 않는다(샘플 문장 제외).
- `infoItems` 는 6개 key 가 정확히 한 번씩 있어야 한다. 배열 순서가 화면 순서다.
- 자리표시는 `{장수}` 만 받는다. `sampleDescription`·`sampleButton` 두 키에서만 받는다. `detail` 안의 `{type}` 은 거절한다. (2판)
- **글자 수**: 제목·이름 1~30자, 설명·안내 1~200자, 모두 한 줄.

### 4-3. `save_market_item_display` 교체(`CREATE OR REPLACE`, 표 잠금 없음)
- **합치기 규칙**: `p_value` 에 없는 최상위 키는 지금 값을 그대로 둔다. 그래서 [검색 필터 이름] 탭은 17번 키만, [상세 안내 문구]·[자료 정보 항목] 탭은 `detail` 만 보낸다. 판 충돌 검사는 그대로다. DB 적용부터 push 사이에 17번 화면이 필터 이름을 저장해도 `detail` 이 지워지지 않는다.
- 17번 규칙(필터 이름 20자·안내 60자·`{type}`)은 `facetLabels`·`libraryEmptyFilterHint` 에만 그대로 적용한다. `detail` 에는 4-2 규칙(필수 키·`infoItems` 집합·`{장수}`·글자 수)만 적용한다. (2판)
- 코드 `MARKET_ITEM_DISPLAY_REQUIRED_KEYS` 와 계약 시험으로 대조한다.
- 작업 기록 종류는 그대로 `market_item_display_update` 다.

### 4-4. `reorder_market_item_subproducts(p_actor_id, p_item_id, p_ids, p_request_meta)` → jsonb
- SECURITY DEFINER, `search_path` 고정, service_role 만 EXECUTE. 행위자는 17번 `market_catalog_actor_allowed` 로 판정한다.
- 상품 행 `FOR UPDATE`(같은 상품의 동시 순서 저장을 줄 세움)
- `p_ids` 가 그 상품의 **지우지 않은 서브상품 전부**(사용 안 함 포함)와 정확히 같아야 한다. 다르면 `MARKET_SUBPRODUCT_REORDER_MISMATCH`.
- `sort_order = 10 × 순번` 으로 매긴다. 이미 그 순서·값이면 기록 없이 돌려준다.
- **새 서브상품 순서**(2판): 서버 생성 함수(`market-items-server.ts:843` 근처)가 `sortOrder` 가 없으면 그 상품의 지우지 않은 서브상품 `max(sort_order) + 10`(없으면 10)으로 만든다. 코드 변경이고 DB 변경은 없다. 18번 복제는 자기 규칙(10×순번)을 쓴다.
- 작업 기록 `market_subproduct_reorder`(details: `item_id`, `before`·`after` id 순서, `request`)

### 4-5. 표시명 데이터 스크립트(Q4, 마이그레이션 밖, **5절 코드 배포 뒤에만**) (2판)
- **실행** `supabase/scripts/<날짜>_bundle19_bundle_label.sql`
  - 사전 점검: 대상 = `label = '전체 한번에 구매하기'` 인 행. 실행 직전 읽기 조회로 센 건수·id 목록 md5 를 상수로 넣고 대조한다(다르면 멈춤).
  - 한 거래에서 작업 기록 `market_bundle_label_bulk_update` 1건(details: `ids`, `old_label`, `new_label`, 건수)을 남기고 `label = '전체 패키지'` 로 바꾼다. 행위자는 대표 id 상수다.
  - VERIFY: 대상 0건, 바뀐 건수 = 기록 건수
- **두 번 돌리는 까닭**: 배포 전 옛 코드는 새 상품·빈 칸 저장 때 옛 글자를 다시 채운다(비어 있지 않은 표시명은 덮지 않음). 그래서 push 직전에 한 번, 배포 직후 다시 세어 0이 될 때까지 한 번 더 돌린다(11절).
- **되돌림** `…_bundle19_bundle_label_revert.sql`: 그 기록의 `ids` 가운데 **지금도 '전체 패키지'인 행만** 옛 글자로 되돌린다(그 사이 관리자가 고친 행은 두고, 남긴 건수를 보고). 되돌림도 기록 1건을 남긴다.
- **DB 칸 기본값**('전체 한번에 구매하기')은 바꾸지 않는다. `ALTER TABLE … SET DEFAULT` 는 결제 판정이 읽는 표를 잠근다. 대신 코드가 INSERT 때 늘 `label` 을 넘긴다는 계약 시험을 둔다(9-1).
- **영향(표시만)**
  - 상세 제목: 스크립트 뒤 기준으로 지금 고정 '전체 패키지'와 같은 글자라 바뀌지 않는다(그래서 스크립트를 배포 전에 한 번 돌림, 11절).
  - 장바구니 줄·결제 완료 창의 줄 이름: '전체 한번에 구매하기' → '전체 패키지'. 장바구니 줄은 꼬리표와 같은 이름이면 한 번만 보인다(5절).
  - 관리자 주문 화면의 과거 묶음 줄 이름도 '전체 패키지'로 보인다(지금 표시명을 읽음). 결제 묶음 결과 기록(1건)은 옛 글자 그대로 남는다.
  - 금액·결제 판정·동의 기록 지문은 바뀌지 않는다(1절 '동의·결제 판정과의 관계'). 장바구니를 연 채 스크립트가 돌아도 결제가 막히지 않는다(R6).
- 실회원이 적은 시간에 돌린다. 결제·환불 함수는 바꾸지 않는다.

### 4-6. VERIFY·되돌리기·리허설
- **VERIFY**: `detail` 필수 키·`infoItems` 6개, 함수 2개의 SECURITY DEFINER·search_path·EXECUTE(service_role 만), `revision` 이 1 올랐음
- **되돌리기** `supabase/rollback/<버전>_bundle19_product_display_down.sql`(코드를 먼저 되돌린 뒤)
  - `reorder_market_item_subproducts` 를 지운다.
  - `save_market_item_display` 를 17번 정의로 되돌린다(down 파일에 전문).
  - 설정 행에서 `detail` 키를 뺀다(`value - 'detail'`, 판 +1). 다른 키는 그대로 둔다.
  - 바뀐 서브상품 순서는 되돌리지 않는다(기록에 이전 순서가 있음, 표시만의 차이).
  - 표시명은 4-5 되돌림 스크립트로 따로 되돌린다.
- **리허설**(light, `BEGIN … ROLLBACK`)

| 경우 | 기대 결과 |
|---|---|
| R1 적용 | VERIFY 통과, down → 17번 상태와 같음(행 값·함수 지문) → 다시 적용 |
| R2 표시 설정 저장 | 정상 판 +1 / 17번 키만 보낸 저장 → `detail` 그대로, `detail` 만 보낸 저장 → 17번 키 그대로 / `infoItems` 빠짐·겹침·모르는 key, 모르는 자리표시, 자리표시를 받지 않는 키의 `{장수}`, 201자, 줄바꿈 → 거절 / 판 충돌 |
| R3 순서 | 권한 경우(17번 P1 과 같은 표), 집합 불일치 3종(빠짐·더함·다른 상품 서브상품), 지운 서브상품 넣기 거절, 사용 안 함 포함 성공, 같은 순서 다시 저장 → 기록 0 |
| R4 공개 읽기 | 순서 저장 뒤 공개 읽기 쿼리(`sort_order, created_at`)가 새 순서 |
| R3b 새 서브상품 | (코드 시험으로) 순서 저장 뒤 서브상품 추가 → 맨 뒤 (2판) |
| R5 표시명 스크립트 | 대상 건수 대조, 실행 뒤 0건, 기록 1건, 되돌림 → 원래 글자, 그 사이 다른 글자로 고친 행은 남김 |
| R6 결제 판정 | 스크립트 전후 `evaluate_market_targets` 의 가격·살 수 있음 값이 같고 줄 이름만 바뀜. `build_checkout_consent_v2` 가 돌려주는 동의 문구·지문이 스크립트 전후 글자까지 같음(읽기만, 결제 함수는 부르지 않음) (2판) |

## 5. 코드 변경
- **규칙은 17번 순수 파일 `src/lib/market-item-options.ts` 에 더한다**(17번 구현 때 이름이 바뀌면 그 파일). 필수 키 목록 `MARKET_ITEM_DISPLAY_REQUIRED_KEYS` 는 이 한 곳에만 둔다. 읽기는 17번 `src/lib/market-item-options-server.ts` 의 `getMarketItemDisplay()` 다. 장바구니 줄 이름 겹침 정리 함수는 server 모듈을 가져오지 않는 별도 순수 파일(`src/lib/cart-line-title.ts`)에 둔다.
  - 필수 키, `{장수}` 채우기
  - `buildMaterialInfoRows(item, display)`: 보이는 항목만, 설정 순서대로, 빈 값 행은 지금처럼 뺌
  - `resolveBundleTitle(label, display)`: 앞뒤 공백을 뺀 표시명, 비면 `bundleDefaultTitle`
  - `isInfoItemVisible`
- **읽기**(2판): 17번 `getMarketItemDisplay()`(60초 캐시, 태그 `market_item_display`)를 **상품 상세 page 에서만** 부른다. 필수 키 검사는 17번처럼 객체 전체로 한다.
  - 상세 page 는 `try/catch` 로 감싸 실패하면 `display = null` 로 넘기고 오류만 기록한다.
  - `display` 가 null 이면 설정에 기대는 것을 숨긴다: 구매 칸 샘플 줄 전체(제목·설명·[샘플 보기]), 표지 아래 샘플 버튼, 자료 정보 표와 배지, 위쪽 등록일 줄, 요약 두 줄, HWP+PDF 기본 안내. 장바구니 담기·가격·전체구매 선택은 그대로다.
  - 전체구매 제목은 표시명을 쓴다. 표시명과 설정이 함께 없는 드문 경우에는 제목 자리에 상품 제목(`item.title`)을 써서 체크박스 이름·`aria-labelledby` 가 비지 않게 한다(오류 기록).
  - 돈·법 문구가 아니라 막지 않는다(content 계획 2-1 기준).
- **장바구니·결제 경로는 설정을 읽지 않는다**(2판, 결제 관점 major)
  - `market-cart-server.ts`·`market-checkout-server.ts`·`runMarketCheckout` 영수증에 읽기를 넣지 않는다. 차감 뒤 I/O 가 생기지 않는다.
  - 묶음 줄 이름은 지금처럼 DB 표시명을 그대로 쓰고, 빈 이름은 지금처럼 숨긴다.
  - 장바구니 줄(`cart-line-list-view.tsx:83·95`): 묶음이고 줄 이름이 꼬리표 글자와 같으면 한 번만 보인다. 표시만 바뀐다.
- **상세**
  - `market-material-detail.tsx`: 자료 정보 표·배지·요약 이름, 위쪽 등록일 줄을 설정에서 그린다.
  - `market-item-actions.tsx`
    - 샘플 줄은 `sampleTitle*`·`sampleDescription*`·`sampleRowButton` 을 쓴다.
    - `DEFAULT_HWP_PDF_NOTICE` 상수를 지우고 설정 값을 쓴다. 판정(`hasHwpAndPdf`)은 그대로다.
    - 전체구매 제목(771~791행)과 담기 선택 제목(388행 `bundleOption.label || '전체 패키지'`)을 `resolveBundleTitle` 로 바꾼다. 체크박스 이름은 `${제목} 선택`.
    - 선택 불가 이유 두 줄은 그대로 둔다(Q8).
    - D8 주석은 "2026-11-20 대표 결정으로 표시명 사용"으로 바꾼다.
  - `market-material-sample-button.tsx`: `sampleButton`·`sampleButtonEmpty` 를 쓴다.
- **옛 기본 글자 지우기**(2판, 화면·결제 major)
  - 서버 `upsertMarketItemBundleOption`: 대체 글자를 지우고 빈 값은 '' 로 저장한다. INSERT 때 늘 `label` 칸을 넘긴다(DB 기본값에 기대지 않음).
  - 관리자 폼(18번 뒤 `_editor/bundle-section.tsx`·`_hooks/use-product-form.ts`·`_lib/product-form.ts`): 새 폼 첫 값·불러오기·저장의 대체 글자를 지우고 첫 값은 ''. 칸 placeholder 와 미리보기 한 줄에 `bundleDefaultTitle` 을 보인다. 2753행 고정 글자는 `resolveBundleTitle` 미리보기로 바꾼다.
  - 전체구매 route 는 NULL 을 '' 로 바꿔 NOT NULL 을 지킨다.
- **관리자 주문 화면 한 줄**: `admin-orders-server.ts:616` 의 `line.bundle?.label ??` 를 `(line.bundle?.label || null) ??` 로 바꾼다. 빈 표시명이면 화면이 이미 있는 줄 종류 이름(`MARKET_PURCHASE_LINE_TYPE_LABELS`)을 보인다(새 하드코딩 없음). 새 폼 첫 값이 '' 라 배포 직후부터 빈 표시명이 생길 수 있어서다. 이 파일은 작업 트리에서 다른 묶음 변경이 있으므로, 그 커밋 위에 이 한 줄만 얹는다. (2판)
- **관리자 route**
  - 새 `PUT /api/admin/market/items/[id]/subproducts/order`(`products.edit`, 본문 `{ ids }`)
    - 4-4 함수를 부른다.
    - 서브상품 공개 읽기는 캐시가 없어 갱신할 태그가 없다. 표시 설정 저장만 17번 `market_item_display` 태그를 무효화한다. (2판)
  - 표시 설정 저장은 17번 route 그대로다. 탭마다 자기 키만 보낸다(4-3 합치기 규칙).
- 관리자 조작 문구(버튼·확인 창)는 코드에 둔다.

## 6. 관리자 화면
### 6-1. '상품 표시 설정'에 더하는 탭
- **[상세 안내 문구]**
  - 4-2 의 글 칸들을 '샘플'·'HWP+PDF 기본 안내'·'전체구매'·'요약' 묶음으로 나눈다.
  - 칸마다 글자 수와 자리표시 안내("{장수} 는 샘플 장수로 바뀝니다")를 둔다.
  - 오른쪽 미리보기는 회원 부품을 메모리 값으로 그린다(저장 없음). 샘플 0장·3장·옛 샘플 세 경우를 바꿔 본다.
- **[자료 정보 항목]**: 6행 표(이름·보이기 스위치·[위로]/[아래로]). '등록일자'를 숨기면 위쪽 등록일 줄도 숨는다는 안내를 둔다. (2판)
- [상세 안내 문구]·[자료 정보 항목] 탭 머리에도 '국어·영어 공통 설정입니다'(17번 7-1)를 적는다.
- **[구성·파일 유형]**(Q7)
  - 18번 `_settings/*` 창 내용을 이 탭에 그대로 둔다.
  - slug·code 칸은 읽기 전용이다. 새로 만들 때만 입력한다.
  - 지금 서버 route·규칙(사용 중 유형의 확장자 잠금 등)은 그대로다.
- 모두 `products.edit`. 저장은 17번 방식(판 충돌이면 다시 읽기)이다.

### 6-2. 상품 편집
- **서브상품 표**(18번 `_editor/subproduct-table.tsx`)
  - 행마다 [위로]·[아래로]가 있다. 바꾸면 '순서 바뀜 — 저장 필요' 표시와 [순서 저장]이 나온다.
  - 공개 중 상품이면 "회원 상세에 바로 반영됩니다" 한 줄이 뜬다.
  - 순서 저장은 상품 저장과 따로다. 저장 안 된 순서가 있는데 다른 상품을 열면 18번 범위의 확인 없이 버려진다. 그래서 표시를 눈에 띄게 한다(B-03 은 범위 밖).
- **전체구매**
  - 표시명 칸 설명: "상세·장바구니에 보이는 이름입니다. 비우면 '{bundleDefaultTitle}'로 보입니다."
  - 미리보기 한 줄에 실제로 보일 제목을 보인다.
- **구성·파일 유형 고르기**(2판)
  - 선택칸 안 '설정하기' 항목 세 곳을 지우고, 선택칸 옆에 '구성·파일 유형 관리(새 탭)' 링크를 둔다. 링크에는 지금 과목(`?subject=`)을 넘긴다.
  - 편집 화면은 창이 다시 보일 때(`visibilitychange`·`focus`) 구성·파일 유형 목록을 다시 읽는다. [목록 새로고침] 버튼도 둔다. 고르던 값·올리던 파일 초안은 그대로 둔다.
  - 다시 읽은 목록에 고르던 항목이 없으면(숨김·삭제) 고른 값을 비우고 그 칸에 '다시 골라 주세요'를 보인다. 다시 고를 때까지 그 행의 추가·올리기를 막는다. 지금 `reloadUploadTaxonomy`(761~799행)가 첫 사용 중 항목으로 조용히 바꿔 끼우는 동작은 없앤다(잘못된 유형으로 저장되지 않게).

## 7. 회원 화면
- **상세**
  - 샘플 설명이 "샘플 3장을 미리 볼 수 있어요." 꼴로 바뀐다. 그 밖의 글자는 첫 값이 지금 글자라 그대로다.
  - 전체구매 제목은 4-5 뒤 '전체 패키지'(같은 글자)이고, 관리자가 고치면 그 이름이 보인다.
  - 서브상품은 저장된 순서로 보인다.
- **장바구니·결제 완료 창**: 스크립트 뒤 전체구매 줄 이름이 '전체 패키지'(또는 관리자 표시명)로 보인다. 장바구니 줄은 꼬리표와 같으면 한 번만 보인다. 표시명을 비운 상품은 지금처럼 꼬리표만 보인다. (2판)
- 선택 불가 이유와 장바구니 동의 문구의 '전체 패키지'는 상품 종류 이름으로 그대로다(Q8).
- 자료 정보 항목을 숨기면 그 행과 (학년·자료유형이면) 배지가 사라진다.
- 375px 가로 스크롤 없음, 긴 표시명(40자)이 제목 줄에서 줄바꿈된다.

## 8. 작업 기록 종류(`src/lib/admin-audit-log.ts`)
| 종류 | 이름 | 남기는 곳 |
|---|---|---|
| `market_subproduct_reorder` | 서브상품 순서 변경 | DB 함수 |
| `market_bundle_label_bulk_update` | 전체구매 표시명 일괄 변경(SQL 스크립트) | SQL 스크립트(실행·되돌림) |
| (그대로) `market_item_display_update` | 상품 표시 설정 수정 | 17번 DB 함수 |
- 두 새 종류를 `DB_FUNCTION_ACTIONS` 에 등록한다. 스크립트 종류는 11번 `checkout_consent_*` 처럼 스크립트 파일을 대조 대상으로 둔다.

## 9. 시험
### 9-1. 계약·단위 시험 `tests/bundle19-product-display-contract.test.mjs`
- **마이그레이션**
  - 기존 표 DDL 없음, `detail` 필수 키 = 코드 목록
  - 함수 EXECUTE 회수, 기록 종류 글자 꼴, down 이 17번 함수 전문을 가짐
- **스크립트**: 사전 건수·md5 대조, 되돌림이 '지금도 새 글자인 행만', 기록 1건
- **순수 함수**
  - `buildMaterialInfoRows`: 순서·숨김·빈 값·출처 이음
  - `resolveBundleTitle`: 공백·빈 값·40자
  - `{장수}` 채우기: 0·1·12, 자리표시 없는 문구
- **글자 고정**
  - 상세·구매 칸·샘플 버튼 파일에 '첫 ' + 쪽 문장, `DEFAULT_HWP_PDF_NOTICE` 가 없다. 전체구매 **제목 span·체크박스 이름·388행 선택 제목**에 고정 '전체 패키지'가 없다(이유 문장은 Q8 로 남음). (2판)
  - `src/` 에 '전체 한번에 구매하기' 글자가 없다. 전체구매 INSERT 가 늘 `label` 을 넘긴다. (2판)
  - 자료 정보 이름 6개가 코드 글자로 없다.
- **결제 경로 고정**(2판): 장바구니·결제 경로 파일 전부(`src/app/(solvook)/cart/page.tsx`·`cart/_components/*`, `src/app/api/market/cart/route.ts`·`cart/items/route.ts`·`checkout/route.ts`·`checkouts/[key]/route.ts`, `src/lib/market-cart-server.ts`·`market-checkout-server.ts`)가 `market-item-options-server`(`getMarketItemDisplay`)를 가져오지 않는다. 표시 설정 필수 키 목록이 한 파일에만 있다. 장바구니 줄 이름 겹침 정리는 순수 함수 단위 시험(같음 → 한 번, 다름 → 둘, 빈 이름 → 꼬리표만).
- **상세 읽기 실패**(2판): `display = null` 일 때 상세 부품이 예외 없이 그려지고 담기 버튼이 있다. 이름 없는 버튼·체크박스가 없다(표시명도 빈 경우 포함)(단위 시험).
- **새 서브상품 순서**(2판): 생성 함수가 `sortOrder` 없이 부르면 `max + 10`.
- **설정 다시 읽기**(2판): 편집 화면에 `visibilitychange` 다시 읽기와 [목록 새로고침]이 있고 `MANAGE_*_VALUE` 가 없다. 다시 읽기가 고르던 값을 첫 항목으로 바꿔 끼우지 않는다.
- **바뀌는 기존 시험**
  - 원칙: 화면 글자 단언은 '설정에서 읽음'으로 바꾸고, 동작 단언(체크박스 연결·충돌 판정)은 그대로 둔다.
  - 대상: `purchase-section-redesign-contract`(D8 고정 제목 단언), `market-item-detail-ui-contract`, `market-detail-multiselect-contract`, `market-products-admin-material-info-contract`, `market-sample-v2-arbitrary-pages-contract`, `market-v2-detail-library-contract`('전체 패키지 선택'), `market-sample-pages-api-contract`('첫 …쪽'), `scholarly-library-preview-contract`('전체 패키지'), 구성·파일 유형 설정 창을 읽는 `market-file-type-admin-contract`·`market-admin-subproduct-ui-contract` (2판)
  - 구현 전에 `grep -rlE "전체 패키지|전체 한번에|쪽을 확인|포함 문항|등록일자|샘플 보기|MANAGE_(SUBPRODUCT|FILE)" tests` 로 목록을 다시 뽑는다. (2판)
- 사이드바·가드 시험: 새 route 권한 표 한 줄
### 9-2. 화면 시험(Claude in Chrome, 내가 먼저 → 대표)
- localhost 는 개발 전용 미리보기(`PRODUCT_DISPLAY_PREVIEW=1`, `NODE_ENV === 'development'` 일 때만)
  - 예시 상품·설정 값을 메모리에서 그린다. 상세 주소를 열지 않아 조회 기록이 쓰이지 않는다.
  - 관리자 탭은 열어 보기만 한다.
- 확인할 것
  - V1 샘플 0·3장·옛 샘플
  - V2 자료 정보 순서·숨김과 배지
  - V3 전체구매 표시명 있음·없음·40자(키보드로 선택, 화면 읽기 이름)
  - V4 서브상품 순서 바꾸기 표시
  - V5 장바구니 묶음 줄 이름(미리보기 뷰, 꼬리표와 같으면 한 번)
  - V7 상품 편집에서 '구성·파일 유형 관리' 링크 → 새 탭 → 돌아오면 선택칸 목록이 새것(미리보기 값으로 흉내) (2판)
  - V6 375×667·1366×768
- **운영 확인**(배포 뒤, 대표 승인)
  - 대표가 시험 계정 장바구니에서 묶음 줄 이름을 본다(담기·빼기만 하고 결제하지 않음).
  - 시험 카테고리 상품의 서브상품 순서를 바꾼다.

## 10. 검증 관점(계획·구현 모두 PASS 까지)
1. **DB·스크립트**: 설정 키 추가·down 이 17번 상태로 돌아가는지, 순서 함수 집합 검사·잠금, 표시명 스크립트 대조·되돌림
2. **결제 영향(1명)**: 결제 경로가 설정을 읽지 않는지(차감 뒤 I/O 없음), 표시명이 금액·판정·11번 동의 지문에 들어가지 않는지(R6), 옛 기본 글자가 되살아나지 않는지, 스크립트 시점(코드 배포 뒤·재집계), 관리자 주문 화면 표시 변화. 결제·환불 함수 변경은 없다. (2판)
3. **회원 화면**: 문구 첫 값이 지금 화면과 같은지(샘플 문장 제외), 읽기 실패 때 담기 동작 유지, 접근성(체크박스 이름 = 보이는 제목), 두 과목 같음
- 결제 함수를 바꾸지 않으므로 결제 검증 3명 전체는 두지 않는다. 2관점이 '장바구니 표시만 바뀜'을 확인하지 못하면 3명으로 올린다.

## 11. 배포 순서
1. 계획 검증 PASS → 0절 답 반영
2. 구현(18번 2단계 배포 뒤) → 시험 → 구현 검증 PASS
3. light 리허설(낮, R1~R6) → **DB 적용**(마이그레이션만, 대표 승인)
   - 추가 키·함수뿐이라 옛 코드 영향은 없다. 옛 코드는 `detail` 을 읽지 않는다.
4. **표시명 스크립트 1차**(4-5, push 직전): 옛 코드는 비어 있지 않은 표시명을 덮지 않으므로(`||` 대체) 배포 전에 돌려도 안전하다. 그래야 새 상세가 처음부터 '전체 패키지'를 보인다.
5. 로컬 확인(미리보기, 나 → 대표) → 대표 승인 → push·배포
6. **표시명 스크립트 2차**(배포 직후): 읽기 조회로 다시 세어 0이 아니면(1차와 배포 사이 옛 코드로 만든 행) 새 상수로 다시 돌린다. 0 확인. 배포는 실회원이 적은 시간에 한다.
7. 운영 확인(9-2 마지막) → 대표가 '상세 안내 문구'·'자료 정보 항목' 최종 문구를 관리자 화면에서 정한다.
8. 진행 기록 갱신. `docs/purchase-section-redesign-plan.md` D8 줄 옆에 '2026-11-20 대표 결정으로 19번에서 바뀜'을 한 줄 더한다.
- 되돌리기: 코드 revert → (필요하면) 표시명 되돌림 스크립트 → down

## 12. 열린 질문·범위 밖
1. 서브상품 순서를 기존 상품 전체에서 구성 순서(워크북 → 문제(PDF) → 문제(HWP))로 한 번 정리할지(Q6 다른 안, 데이터 스크립트·되돌림 필요)
2. 자료 보관함·환불 목록의 고정 '전체구매' 글자를 표시명 규칙으로 바꿀지(후속)
3. 범위 밖: 자료 정보 새 항목(교재명·단원 등), 검색 결과 카드 문구, 홈 진열 문구(22번), 샘플 미리보기 창 문구

## 13. 1판 검증 반영 (2판)
| 관점·등급 | 지적 | 반영 |
|---|---|---|
| 화면 major / 결제 major | 옛 기본 글자 '전체 한번에 구매하기'가 코드 5곳·DB 기본값에 남아 스크립트 뒤에도 되살아남, Q5 가 route 만으로 안 됨, 스크립트가 코드 배포 전이라 사이에 생긴 행이 빠짐 | 1절 목록, 5절 '옛 기본 글자 지우기'(서버·폼·미리보기, INSERT 때 늘 label), DB 기본값은 표 잠금을 피해 그대로 두고 계약 시험, 4-5·11절: 스크립트를 코드 배포 뒤로·다시 세기, 9-1 글자 시험 |
| 화면 major / 결제 major | 장바구니·영수증에서 설정 읽기 실패 시 장바구니 고장·결제 뒤 실패 응답 | 5절: 결제 경로는 설정을 읽지 않음(줄 이름은 DB 표시명, 빈 이름은 지금처럼 숨김), 상세만 try/catch, 9-1 결제 경로 고정·읽기 실패 시험, Q5 |
| 결제(코디 지시) | 표시명 변경이 11번 동의 장바구니 문구 지문에 미치는 영향 | 1절: 동의·판정 함수가 표시명을 읽지 않음(운영 확인), Q8: `partialOwnedConfirmLabel` 은 상품 종류 이름으로 그대로, R6 에 스크립트 전후 동의 문구·지문 같음 |
| 화면 major | 새 서브상품이 늘 0 이라 순서를 정한 상품에서 맨 위로 옴 | Q6·4-4: `max + 10`, R3b·9-1 |
| 화면 major | 설정 창을 새 탭으로 옮기면 편집 화면 목록이 낡음, '설정하기' 처리 없음 | Q7·6-2: 링크로 바꾸기, 다시 보일 때 다시 읽기·[목록 새로고침], 과목 넘기기, V7 |
| 화면 minor | 샘플 버튼 두 개인데 키 하나 | 4-2 `sampleRowButton` 추가 |
| 화면 minor | 안내 문구의 '전체 패키지'와 제목 불일치 | Q8 대표 결정 질문(종류 이름으로 유지), 388행도 `resolveBundleTitle`, 시험 범위 좁힘 |
| 화면 minor | 서브상품 route 캐시 태그가 실제로 없음 | 5절 관리자 route 문장 고침 |
| 화면 minor | 고정 글자를 단언하는 기존 시험 누락 | 9-1 목록에 3개+2개, grep 절차 |
| 화면 minor | 등록일 줄 별도, 17번 규칙 적용 범위 모호 | Q3·6-1: 등록일 줄도 숨김, 4-3: 17번 규칙은 17번 키에만 |
| 결제 minor | 관리자 주문 화면이 지금 표시명을 읽음, 빈 이름이면 빈칸 | 1절·4-5 영향. 2판 검증 뒤 5절 한 줄로 범위에 넣음(14절) |
| 결제 minor | 장바구니 줄에 '전체 패키지'가 두 번, 388행 고정 글자 | 5절 겹침 정리, 388행 대상에 넣음 |

## 14. 2판 검증 minor 반영 (같은 판)
| 관점 | 지적 | 반영 |
|---|---|---|
| 화면 | `display = null` 숨김 목록에 샘플 줄 제목·버튼, 표지 아래 버튼, 등록일 줄이 빠짐, 빈 표시명이면 체크박스 이름이 빔 | 5절 읽기: 숨김 목록 확장, 제목 자리에 상품 제목, 9-1 이름 없는 버튼·체크박스 없음 |
| 화면 | `reloadUploadTaxonomy` 가 첫 항목으로 바꿔 끼움 | 6-2: 바꿔 끼우기 없애고 비운 뒤 다시 고르게, 9-1 |
| 화면 | 탭별 저장과 전체 값 저장 방식 미정 | 4-3 합치기 규칙(없는 최상위 키는 유지), R2 두 경우 |
| 화면·결제 | 규칙 파일 이름이 17번과 다름, 결제 경로 시험 범위가 흐림 | 5절: 17번 파일 이름, 겹침 정리는 별도 순수 파일, 9-1 결제 경로 파일 목록 전부 |
| 결제 | 배포부터 스크립트까지 상세가 옛 글자를 보임 | 11절: push 직전 1차·배포 직후 2차, 4-5 '스크립트 뒤 기준' |
| 결제 | 관리자 주문 화면 빈칸은 배포 직후부터 생김 | 5절: `admin-orders-server.ts:616` 한 줄을 19번 범위로, 12절 후속 줄 삭제 |
