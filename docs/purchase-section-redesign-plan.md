# 상품 상세 구매 영역 디자인 개편 계획 (시안 A '딥 잉크')

- 작성일: 2026-10-06 · 브랜치 feature/market-cart(HEAD 7b7a143) · 상태: **검증 OK(R2) — D1·D3~D8 권장안 확정(2026-10-06), 구현 단계**
- 요청: "상품 상세페이지의 전체패키지와 개별자료 선택 구매 디자인이 너무 AI틱해. 진한 색감을 써서 다시 디자인" → 사용자가 시안 A 선택(`docs/design-mockups/purchase-options/A-deep-ink.png`).
- 원칙: **기능 무변경, 디자인만**. 선택·충돌 규칙, 장바구니·바로 구매·로그인 복귀·확인/완료 Dialog, 다운로드는 그대로 두고 화면 구조와 스타일만 바꾼다. Studio 토큰만 사용(raw hex 금지), 44px hit area, 데이터 하드코딩 금지(CLAUDE.md 2.5).
- 근거 표기: 소스 `file:line`(HEAD 7b7a143), DB는 개발 DB SELECT(2026-10-06) "직접 확인".

## 1. 시안 A 요약 (이미지 확인)

1. 카드 머리: 작은 회색 "구매 옵션" + 큰 제목 "필요한 자료를 선택하세요".
2. **전체 패키지 블록**: 진한 잉크 배경, 흰 글자. 좌상단 코랄 "추천" 태그 하나 + "전체 패키지" 제목, 부제 "워크북 · 문제(PDF) · 문제(HWP) 3개 자료를 한 번에". 우측 원가 취소선(8,000) / 큰 가격 "4,500 크레딧" / 코랄 "3,500 크레딧 절약". 아래 구분선으로 나뉜 체크 목록(✓ 워크북 PDF …). 맨 아래 흰색 전체 폭 버튼 "전체 패키지 선택".
3. 가운데 가는 선 사이 "또는 필요한 자료만".
4. **개별 자료**: 제목 "개별 자료", 테두리 있는 표형 목록. 행 = 체크박스 · 형식 문서 아이콘(PDF 빨강/HWP 파랑) · 이름 + 형식 부제("HWP · PDF 포함") · 우측 가격.
5. **하단 바**: 위 구분선, 좌측 "선택 0개 · 0 크레딧", 우측 [장바구니](흰 외곽선) [구매하기](잉크 채움).
6. 지금 화면과의 차이: 민트 그라데이션 카드·"추천/전체 포함/3개 자료" pill 3개·연보라 아이콘 상자·행마다 "선택" 체크박스 줄·"미구매" 배지가 모두 사라진다.

## 2. 현재 구조 (근거)

| 항목 | 위치 | 내용 |
|---|---|---|
| 상세 화면 | `src/app/preview/solvook-concept/_components/detail/market-material-detail.tsx` | 우측 aside 카드 `:266-283`("PURCHASE OPTIONS" 영문 eyebrow + "필요한 자료를 선택하세요" + `#purchase-options`로 이동 버튼), 본문 구매 섹션 `:314-353`("PURCHASE & DOWNLOAD" eyebrow + `PackageCheck` 아이콘 + "구매 및 다운로드" + `<MarketItemActions>`) |
| 구매 영역 컴포넌트 | `src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx`(1302줄) | 현재 디자인 상세(`market-material-detail.tsx:7, 336`)와 과거 디자인 상세(`(dashboard)/market/[slug]/items/[itemId]/page.tsx`) **두 곳이 같은 컴포넌트를 재사용** → 이번 변경은 과거 상세에도 그대로 반영된다(과거 상세는 비노출 화면, 제안서 R1 §3) |
| 무료 샘플 행 | `market-item-actions.tsx:1164-1188` | `FileOptionRow` + 하늘색 배경 + "무료"·"구매 전 확인" 배지 |
| 전체 패키지 | `:1001-1055` | 민트 그라데이션(`:1004`), 배지 3개(`:1008-1012`), `FileStack` 연보라 아이콘 상자(`:1015`, `MARKET_OPTION_ICON_CLASS :115`), 포함 자료 목록(`:1028-1045`), 가격(`:1046-1050`), 보유 시 다운로드 버튼(`:1051`) |
| 구분선 | `:1060-1066` | "또는 필요한 자료만"(이미 있음) |
| 개별 자료 | `:1067-1111` | 회색 상자 안 `FileOptionRow` 카드 반복, 카드마다 "선택" 체크박스(`renderOptionSelectControl :919-946`), "미구매/구매 완료/패키지 포함" 배지(`OptionStateBadge :244-270`), 형식 배지(`FileTypeBadges :220-242`), 안내 상자(`resolveSubproductPurchaseNotice :171-186`) |
| 하단 합계 | `:1114-1152` | "선택 N건 / 총 금액", [장바구니][구매하기], 로그인·빈 선택 안내 |
| 보관함 안내 | `:1237-1239` | "구매한 파일은 국어 라이브러리 > 구매자료에서도…" — 지금 보관함 이름("자료 보관함", `/library`)과 다르다(제안서 R1 §4 문구 누수) |
| 과거(v1) 구매 | `:1190-1235` | v2 옵션이 없을 때 보유 PDF/HWP/ZIP 다운로드만. 공개 상품은 모두 v2 서브상품이 있어(직접 확인: 공개 145개 전부 서브상품 2~3개) 사실상 쓰이지 않음 → **변경하지 않음** |
| raw hex | `:116-118` 배지 클래스에 `#E0E7FF` 등, `:121` 다운로드 버튼에 `var(--x,#hex)` 대체값 | 배지 클래스는 이번에 쓰지 않게 되어 함께 정리. 다운로드 버튼 클래스는 자료 보관함과 같은 디자인(`:120` 주석)이라 그대로 둔다 |
| 형식 아이콘 | `src/components/market/file-type-doc-icon.tsx` | PDF 빨강·HWP 파랑·ZIP 회색 문서 SVG, 크기 고정 `h-[18px] w-4`. 자료 보관함 다운로드 버튼이 사용 중 |

**DTO(바꾸지 않음)**: `MarketSubproductPublicSummary`(`market-items-server.ts:145-165`: `owned`, `ownedScope`, `upgradePriceCredits`, `fileCount`, `fileTypes`, `purchaseNotice*`), `MarketBundlePublicSummary`(`:167-175`: `owned`, `priceCredits`, `description`). 환불 진행 상태는 DTO에 없다 → 이 컴포넌트에는 "환불 대기" 표시가 없고 이번에도 추가하지 않는다(보유 상태로 보임, 지금과 같음).

## 3. 절약 금액 계산 — 결정 필요(D1)

시안은 원가를 "개별 가격 단순 합계"(2,500+2,500+3,000=8,000)로 그렸다. 그러나 이 상품군에서는 **문제(HWP)에 PDF가 포함**되어 문제(PDF)와 함께 살 수 없다(`PDF_HWP_CONFLICT_REASON :126`, 판정 `isPdfInclusiveHwp :157-160`). 같은 내용을 개별로 가장 싸게 사는 값은 단순 합계보다 작다.

공개 상품 전체를 직접 확인한 결과:

| 상품군 | 상품 수 | 패키지 활성 | 패키지 | 개별 단순 합계 | 같은 내용의 개별 최저가(문제(PDF) 제외) | 단순 합계 기준 표시 | 정직 기준 표시 |
|---|---|---|---|---|---|---|---|
| 국어 독서(워크북·문제PDF·문제HWP) | 64 | **활성**(`market_item_bundle_options.is_active = true` 64행) | 4,500 | 8,000 | 5,500(워크북+문제HWP) | 3,500 절약 | **1,000 절약** |
| 국어 문학(문제PDF·문제HWP) | 80 | **비활성**(`is_active = false` 80행) → 공개 상세에 패키지 블록 없음 | (4,500) | 5,500 | 3,000(문제HWP만) | 표시 안 됨 | 표시 안 됨 |
| 영어(패키지 없음) | 1 | — | — | — | — | — | — |

- 지금 패키지가 보이는 상품은 독서 64개뿐이다. 단순 합계 기준이면 이 64개 모두 "3,500 크레딧 절약"이라고 표시하지만, 실제로는 워크북+문제(HWP) 5,500으로 같은 자료를 모두 받을 수 있어 이득은 1,000이다. 즉 **절약액을 3.5배 부풀린 할인 표시**가 된다.
- **권장(D1-a, 정직 기준)**: 비교가 = 판매 중인 개별 자료 정가 합계에서, PDF 포함 문제(HWP)가 있으면 문제(PDF)를 뺀 값(기존 충돌 규칙과 같은 기준, 코드에는 규칙만). 비교가 > 패키지가일 때만 원가 취소선·"N 크레딧 절약"·"추천" 태그를 보인다. 아니면 셋 다 숨기고 가격만 보인다.
- 다음 경우에도 숨긴다(정확한 비교가 아님): 개별 자료 중 가격 미정(`priceCredits <= 0`)이 있음, 개별 자료 일부를 이미 보유(`ownedScope === 'subproduct'`가 하나라도, 이때 패키지는 정가 구매 `:458-459`), 패키지 보유.
- 정가 기준은 `priceCredits`(차액 업그레이드가 `upgradePriceCredits`는 개인별 값이라 쓰지 않음).
- **운영 데이터 안내(D2, 이번 범위 밖)**: 비활성인 문학 80개 패키지는 가격이 4,500으로 문제(HWP) 단독(3,000)보다 비싸다. 나중에 다시 활성화할 때 가격을 검토하면 된다. 정직 기준(D1-a)이면 활성화하더라도 절약·추천은 자동으로 숨는다. 이 계획에서 DB는 바꾸지 않는다.

## 4. 상태별 디자인 매핑 (기능 무변경)

### 4-1. 섹션 머리말과 aside

| 대상 | 지금 | A안 적용 |
|---|---|---|
| 구매 섹션 머리말(`market-material-detail.tsx:319-335`) | `PackageCheck` 아이콘 + "PURCHASE & DOWNLOAD" + "구매 및 다운로드" + 설명 | 시안대로 작은 회색 "구매 옵션"(`--studio-muted`) + 제목 "필요한 자료를 선택하세요". 아이콘·영문 eyebrow·설명 문장 제거. `id`·`aria-labelledby`·`scroll-mt-36` 유지 |
| 우측 aside(`:266-283`) | "PURCHASE OPTIONS" 영문 eyebrow(보라) | eyebrow만 "구매 옵션"(`--studio-muted`)으로 바꾸고 나머지 유지(D6). aside는 화면 위쪽 요약·이동 버튼이라 역할이 다르다 |

### 4-2. 전체 패키지 블록

| 상태 | 표시 |
|---|---|
| 기본(미보유, 선택 가능) | 잉크 배경 블록(`bg-[var(--studio-ink)]`, `rounded-[var(--studio-radius-card)]`). 1행: [추천 태그(조건부, 3절)] 제목 "전체 패키지"(지금처럼 고정 문구, `market-item-actions.tsx:1017`. `bundleOption.label`은 공개 패키지 64개 모두 "전체 한번에 구매하기"라 제목으로 쓰면 화면이 바뀐다 → 쓰지 않음, D8) / 우측 가격 묶음(원가 취소선·큰 가격·절약 문구, 조건부). 2행 부제: `bundleOption.description`이 있으면 그것, 없으면 포함 자료 이름을 " · "로 이어 "N개 자료를 한 번에"(데이터에서 생성). 구분선 목록: 포함 자료마다 ✓ + 자료 이름 + 형식(중복 PDF 숨김 규칙 `FileTypeBadges`의 siblings 규칙 유지). 맨 아래 흰 전체 폭 버튼 "전체 패키지 선택" |
| 선택됨 | 같은 버튼이 토글: `aria-pressed="true"`, 체크 아이콘 + "전체 패키지 선택됨". 블록 테두리 강조(코랄 2px). 동작은 기존 `toggleOption('bundle:…')` 그대로 |
| 선택 불가(개별 선택 중 / 가격 미정 / 파일 준비 중) | 버튼 `disabled` + 아래에 사유 문장(기존 `getBlockedReason` 문구 그대로, `aria-describedby`) |
| 개별 일부 보유 | 기존 안내 "이미 구매한 개별 자료가 있어도 기보유분 차감 없이 정가로 구매됩니다."(`:1021-1023`)를 블록 안 보조 글자로. 절약·추천 숨김(3절) |
| 잔액 확인 중 / 구매 처리 중 | 기존 `OptionStateBadge` 'checking'/'processing' 상태를 버튼 아래 작은 상태 문구로("잔액 확인 중", "구매 처리 중", `aria-live="polite"`) |
| 패키지 보유 | 태그 자리에 "보유 중", 가격 영역에 "구매 완료", 버튼 대신 다운로드 버튼 묶음(기존 `renderDownloadButtons(dedupeQuestionPdfFiles(downloadFiles))`, 흰 배경 버튼이라 잉크 위에서도 그대로 보임). 개별 섹션·하단 바는 지금처럼 숨김(`:1058`, `hasSelectableOption`) |
| 포함 자료 정보 없음 | 기존 문구 "포함 상품 정보가 아직 표시되지 않습니다." 유지 |
| 패키지 미설정 상품 | 블록·구분선 없음(지금과 같음, `bundleOption ?` 분기) |

### 4-3. 개별 자료 목록

| 상태 | 표시 |
|---|---|
| 기본 | 제목 "개별 자료"(기존 "개별 자료 선택 구매"·설명 문장 대신). 테두리 1px(`--studio-border`) 둥근 목록, 행 사이 구분선. 행 전체가 체크박스 `label`(행 높이 ≥ 64px): 체크박스 · 형식 아이콘(`FileTypeDocIcon`, `getSubproductIconKind` 결과 pdf/hwp/zip, 그 외는 lucide `FileText` 회색) · 이름(`subproduct.title`) + 부제 · 우측 가격 "2,500 크레딧" |
| 부제 | 형식 라벨을 " · "로 연결(예 "PDF"), PDF 포함 안내가 있으면 안내 라벨을 덧붙임(예 "HWP · PDF 포함", `resolveSubproductPurchaseNotice`의 `label`). 안내 본문(`text`)은 행 아래 한 줄 보조 글자로 유지(D7). 형식 배지 상자(`FileTypeBadges`)는 행에서 쓰지 않음 |
| 선택됨 | 체크박스 체크 + 행 배경 `--studio-primary-soft`는 쓰지 않고 잉크 계열 옅은 배경(`color-mix(var(--studio-ink) 4%)`)으로 시안 톤 유지 |
| 선택 불가(패키지 선택 중 / PDF·HWP 충돌 / 가격 미정 / 파일 준비 중) | 체크박스 `disabled`, 행 글자 `--studio-muted`, 사유 문장을 부제 아래(`aria-describedby`, 기존 문구 그대로) |
| 차액 업그레이드 | 가격 = `upgradePriceCredits`, 아래 작은 글자 "차액 · 정가 3,000 크레딧"(기존 `:1093-1095` 정보 유지) |
| 보유(단건) | 체크박스 자리에 체크 표시 아이콘 + "보유" 글자, 가격 자리에 다운로드 버튼(기존 `renderDownloadButtons(ownedFiles)`). 모바일에서는 버튼이 행 아래로 내려감 |
| PDF 포함 문제(HWP) 단건 보유 | 문제(PDF) 행 숨김(기존 `:1070-1072`) |
| 잔액 확인 중 / 구매 처리 중 | 선택된 행 부제 끝에 상태 글자(4-2와 같음) |
| 개별 자료 1개뿐(예: 문제(HWP)만) | 같은 목록에 행 1개. 패키지가 없으면 구분선 없음 |
| "미구매" 배지 | 없앤다(보유가 아니면 기본 상태). 상태 정보는 "보유"·사유 문장으로 충분 |

### 4-4. 하단 합계 바

- 시안대로: 상단 구분선, 좌측 "선택 **N**개 · **N** 크레딧"(숫자 강조), 우측 [장바구니](`brandOutline`) [구매하기](잉크 채움). 기존 문구 "선택 N건 / 총 금액"을 시안 표기로 바꾼다.
- 버튼은 기존 `Button` 사용. "구매하기"의 잉크 채움은 Studio에 해당 variant가 없으므로 `variant="brand"`를 유지할지(D3), 잉크로 바꿀지 결정. **권장: `brand` 유지**(DESIGN.md: 주요 행동은 brand purple, 전역 variant 추가 없이). 시안의 잉크 버튼은 패키지 블록과 색이 겹쳐 주요 행동이 덜 구분된다.
- 로그인 전 "로그인 후 담기/구매", 담는 중, 빈 선택 안내(`:1144-1150`), `disabled` 조건, `aria-describedby`는 그대로.
- 320px: 합계 줄 아래로 두 버튼이 2열(지금 `grid-cols-2`) 유지.

### 4-5. 무료 샘플·보관함 안내

- 무료 샘플(`:1164-1188`): 하늘색 카드와 배지 2개를 없애고, 패키지 블록 위 한 줄 행으로: 좌측 "무료 샘플" + "구매 전 PDF 첫 N쪽을 확인할 수 있어요", 우측 [샘플 보기](`brandOutline`, 44px). 샘플 없음이면 "샘플 준비 중" 한 줄 보조 글자(버튼 없음). 미리 불러오기(`onIntent`)·Dialog는 그대로(D4: 표지 아래 샘플 버튼과 중복이지만 기능 유지 원칙상 남김).
- 보관함 안내(`:1237-1239`): 점선 상자를 없애고 하단 바 아래 한 줄 보조 글자로. 문구의 "국어/영어 라이브러리 > 구매자료"를 지금 이름 "자료 보관함"으로 교정(D5).

## 5. 시각 규칙 (토큰)

| 요소 | 값 |
|---|---|
| 패키지 블록 배경 | `var(--studio-ink)` |
| 블록 위 본문 글자 | `var(--studio-surface)` |
| 블록 위 보조 글자·원가 | `color-mix(in srgb, var(--studio-surface) 72%, transparent)` (잉크 위 대비 약 8.9:1) |
| 블록 안 구분선 | `color-mix(in srgb, var(--studio-surface) 14%, transparent)` |
| 절약 문구 | `var(--studio-highlight)` (잉크 위 대비 약 5.6:1, AA 통과) |
| 추천 태그 | 배경 `var(--studio-highlight)`, 글자 **`var(--studio-ink)`**(대비 약 5.6:1). 시안의 흰 글자는 대비 약 2.9:1로 AA 미달이라 바꾼다(D3) |
| 선택 버튼(블록 안) | 배경 `var(--studio-surface)`, 글자 `var(--studio-ink)`, `min-h-11`, focus ring은 블록 위에서 보이도록 `var(--studio-surface)` 링 + offset 잉크 |
| 행·목록 | `--studio-border`, `--studio-text`, `--studio-muted`, 반경 `--studio-radius-card`/`-control` |
| 가격 글꼴 | `var(--studio-font-price)`(Pretendard, 기존 토큰) |

- 새 토큰은 추가하지 않는다(기존 토큰과 `color-mix` 조합만, 소비처 1곳). raw hex·tailwind 팔레트(`indigo-*`, `emerald-*`, `slate-*`, `sky-*`)는 구매 영역 v2 부분에서 0건이 목표. 과거(v1) 분기(`:1190-1235`)와 그 분기만 쓰는 `FileOptionRow`·`MarketOptionIcon`·버튼 상수는 그대로 둔다(변경하지 않는 코드).
- `FileTypeDocIcon`에 선택적 `className` prop을 추가해 행에서 크게(예 `h-8 w-7`) 쓴다. 기본값은 지금 크기라 자료 보관함 소비처는 영향 없음. 이 SVG의 형식색(PDF 빨강 등)은 Studio core 색이 아닌 파일 형식 식별색으로 기존 코드 그대로 쓴다.

## 6. 접근성·반응형

- 모든 컨트롤 44×44 이상: 행 `label` 최소 높이 64px, 체크박스 hit area `size-11` 유지(기존 `:930`), 패키지 버튼·하단 버튼 `min-h-11`.
- 패키지 선택은 `button aria-pressed`(토글 의미), 개별은 기존 `Checkbox` + `aria-label="{이름} 선택"` 유지. 개별 목록은 `role="group" aria-labelledby`(제목 "개별 자료").
- 사유·상태 문장은 `aria-describedby`/`aria-live`로 연결(기존 방식). 절약·보유는 색만이 아니라 글자로 전달.
- 원가 취소선은 `<s>`에 화면 낭독용 접두 "개별 구매 시"(`sr-only`).
- focus-visible: 밝은 영역은 `--studio-focus-ring`, 잉크 블록 안은 흰 링.
- 320px: 패키지 블록 1행은 세로 쌓기(제목·부제 → 가격 묶음 왼쪽 정렬), 개별 행은 `flex-wrap`으로 가격이 이름 아래 오른쪽으로 내려감, 가로 넘침 없음. 768px 이상은 시안 배치.
- `prefers-reduced-motion`: 새 애니메이션 없음.

## 7. 구현 단위

| 단위 | 범위 | 파일 | 검증 |
|---|---|---|---|
| U1 | 비교가·절약 계산 순수 함수(3절 규칙) + PDF 포함 문제(HWP) 판정 이전 | 신규 `src/lib/market-bundle-savings.ts`(`@/` import 없음, Node에서 직접 import 가능 — 선례 `tests/payment-history-filter.test.mjs`): 컴포넌트의 `isPdfInclusiveHwp`(`market-item-actions.tsx:156-160`, 서버 판정 `lower(ft.code) = 'pdf'`과 같은 기준)를 이 파일로 **옮기고**(판정 출처 하나) 비교가 함수가 이를 사용. 컴포넌트는 같은 함수를 import해 기존 사용처(`:455-457`, `:491`)를 그대로 유지. 타입은 필요한 필드(`categorySlug`, `fileTypes[].code`, `priceCredits`, `ownedScope`)만 받는 구조적 타입으로 정의. 신규 `tests/market-bundle-savings.test.mjs` | 단위 테스트: 독서형(8,000/5,500 → 1,000 절약), 패키지가 개별 최저가 이상인 경우(일반 규칙 → 표시 없음), HWP에 PDF 없음(단순 합계), 가격 미정 포함, 개별 일부 보유, 패키지 보유, 개별 1개 |
| U2 | 패키지 블록 + 구분선 + 개별 목록 + 하단 바(4-2~4-4) | `market-item-actions.tsx`, `src/components/market/file-type-doc-icon.tsx`(선택 `className`) | 아래 계약 테스트, tsc, eslint, 전체 테스트 기준선 비교 |
| U3 | 섹션 머리말·aside eyebrow·무료 샘플 행·보관함 문구(4-1, 4-5) | `market-material-detail.tsx`, `market-item-actions.tsx` | 계약 테스트, 브라우저 |

U2가 가장 크다(구매 영역 렌더 부분 `:999-1155` 재작성). 상태 계산(`purchaseOptions`, `getBlockedReason`, `toggleOption`, 장바구니·구매 함수)은 손대지 않는다.

## 8. 기존 계약 테스트 영향

구현 착수 전 전체 `node --test tests/*.test.mjs` 실패 목록을 기준선으로 기록하고, 아래는 **디자인 문구·클래스를 고정한 단언**이라 새 디자인에 맞게 갱신한다(기능 단언은 유지).

| 파일 | 줄 | 지금 단언 | 처리 |
|---|---|---|---|
| `tests/market-item-detail-ui-contract.test.mjs` | 74-79 | "무료 샘플", "무료 샘플 미리보기", "구매 전 PDF 첫 …쪽", "구매 전 확인", "샘플 보기", "샘플 준비 중" | "구매 전 확인" 배지 삭제에 맞춰 해당 줄 갱신, 나머지 문구는 유지되므로 그대로 |
| 같은 파일 | 82-84 | `libraryPurchaseLabel`, "국어/영어 라이브러리 > 구매자료" | D5 채택 시 "자료 보관함"으로 갱신 |
| 같은 파일 | 89-101, 105 | "전체 포함", `{subproducts.length}개 자료`, 패키지 기본 설명 문장, "포함 자료", "총 금액" 등 | 새 문구(부제 생성 규칙, "선택 N개 · N 크레딧")로 갱신. "추천", "전체 패키지", "구매하기", "장바구니", "또는 필요한 자료만", "포함 상품 정보가…"는 유지 |
| `tests/market-v2-detail-library-contract.test.mjs` | 46-51 | "전체 포함", "포함 자료", "개별 자료 선택 구매", `renderOptionSelectControl` 패키지 호출 | 새 제목 "개별 자료", 패키지 토글 버튼(`aria-pressed`)으로 갱신. 개별 행의 `renderOptionSelectControl` 호출은 유지 |
| 같은 파일 | 60-62, 64, 81-84 | `MARKET_ACTION_BUTTON_CLASS`, `sm:w-44`, `MARKET_OUTLINE_BUTTON_CLASS`, `border-indigo-500`, `text-indigo-600`, `focus-visible:ring-indigo-300`, `Eye` | v1 분기에서 상수가 계속 쓰이면 그대로 통과. v2 영역에 indigo가 없다는 새 단언을 추가 |
| 같은 파일 | 65-67 | `grid grid-cols-2 gap-2`, 하단 두 버튼 클래스 | 하단 바 구조 유지 시 그대로, 바뀌면 갱신 |
| `tests/market-detail-multiselect-contract.test.mjs` | 56-60 | 하단 바 클래스·"총 금액"·빈 선택 안내 | "총 금액" 갱신, 나머지 유지 |
| 같은 파일 | 62-72 | `selectSlot`, 행 선택이 아이콘보다 앞, 패키지 선택이 `MarketOptionIcon kind="bundle"`·`>추천</Badge>`보다 앞 | 새 구조(행 = 체크박스 → 아이콘 → 이름, 패키지 토글은 블록 하단)에 맞춰 순서 단언을 다시 쓴다 |
| 같은 파일 | 17-52 | 장바구니·구매·409·충돌 문구 | **변경 없음**(기능 무변경 확인용) |
| `tests/market-sample-pages-api-contract.test.mjs` | 59-61 | `MarketSamplePreviewDialog`, "샘플 미리보기", 쪽수 문구 | 유지 |
| `tests/market-hwp-bundle-contract.test.mjs` | 59 | "HWP & PDF"(v1 분기) | v1 분기 그대로라 통과 |
| `tests/market-board-preview-route-contract.test.mjs:35`, `tests/studio-adoption-contract.test.mjs:377` | — | 다른 파일이 구매 로직을 복제하지 않는지 | 영향 없음 |

**신규 계약 테스트**(`tests/purchase-section-redesign-contract.test.mjs`)
- v2 렌더 영역(`renderV2PurchaseOptions` 본문)에 `#[0-9a-f]{3,8}`·`(indigo|emerald|cyan|slate|sky)-\d` 없음, `var(--studio-ink)`·`var(--studio-highlight)` 사용
- 패키지 선택이 `aria-pressed` 버튼, 개별은 `Checkbox` + `aria-label`, 사유 `aria-describedby`
- 절약·원가·추천 표시가 U1 함수 결과에 묶여 있음(`market-bundle-savings` import, 숫자 리터럴 가격 없음)
- PDF 포함 판정 출처 하나: `market-item-actions.tsx`에 `function isPdfInclusiveHwp` 정의와 `categorySlug === 'question_hwp'`+`'pdf'` 조합 판정이 없고, `isPdfInclusiveHwp`를 `market-bundle-savings`에서 import. (`FileTypeBadges`의 형식 배지 중복 숨김 `:226-233`은 표시용 다른 규칙이라 대상 아님)
- 패키지 제목이 고정 문구 "전체 패키지"이고 `bundleOption.label`을 제목에 쓰지 않음
- 하단 "선택 {n}개 · {n} 크레딧" 구조
- `market-material-detail.tsx`에 `PURCHASE & DOWNLOAD`·`PURCHASE OPTIONS` 없음, "구매 옵션" 있음, `id="purchase-options"` 유지

## 9. 브라우저 확인 목록 (사용자 또는 검증 단계)

| # | 화면 | 확인 |
|---|---|---|
| 1 | 독서형 `/preview/solvook-concept/boards/entexam/items/84e15123-5913-426d-8a80-cbb77ece772f?subject=korean` | 시안 A와 같은 배치, 원가 5,500 취소선·"1,000 크레딧 절약"·추천(D1-a 채택 시) |
| 2 | 문학형(패키지 비활성) `/preview/solvook-concept/boards/entexam/items/1a5dbbaa-5aff-4b47-a30b-2bacb756a43d?subject=korean` | 패키지 블록·구분선 없이 개별 2행(문제(PDF)·문제(HWP), HWP 행 부제 "HWP · PDF 포함"), 두 행 동시 선택 시 충돌 사유 |
| 3 | 영어(패키지 없음) `/preview/solvook-concept/boards/mock-exams/items/83bd9dde-5d44-444f-afc0-7a83aa589172?subject=english` | 패키지 블록·구분선 없이 개별 목록만 |
| 4 | 비로그인 | 선택 후 "로그인 후 담기/구매" → 로그인 → 복귀 시 담기 자동 진행·구매 선택 복원(기존) |
| 5 | 로그인, 선택 | 패키지 선택 시 개별 행 비활성+사유, 개별 선택 시 패키지 버튼 비활성+사유, 문제(PDF)↔문제(HWP) 충돌 사유, 합계 숫자 |
| 6 | 장바구니 담기·구매하기 | 결과 Dialog·확인 Dialog·완료 Dialog 그대로 |
| 7 | 패키지 보유 계정 | 블록이 "보유 중" + 다운로드 버튼, 개별·하단 바 없음 |
| 8 | 개별 일부 보유 계정 | 보유 행 다운로드, 패키지 정가 안내, 절약 숨김 |
| 9 | 320px·768px·1280px | 가로 넘침 없음, 가격 줄바꿈 규칙 |
| 10 | 키보드만 | Tab 순서 = 시각 순서(샘플 → 패키지 버튼 → 개별 행 → 장바구니 → 구매하기), 흰 링이 잉크 위에서 보임, Space로 토글 |
| 11 | 과거 상세(공유 컴포넌트) | 과거 디자인 상세 경로에서도 깨지지 않음(비노출 화면, 최소 확인) |

## 10. 사용자 결정 항목

| ID | 결정 | 선택지 | 권장 | 이유 |
|---|---|---|---|---|
| D1 | 원가·절약·추천 기준 | (a) 같은 내용의 개별 최저가 기준, 이득 있을 때만 표시 / (b) 시안처럼 단순 합계 | **(a)** | (b)는 공개 패키지 64개(독서) 모두에 "3,500 절약"을 표시하지만 실제 이득은 1,000(3절) |
| D2 | 비활성 문학 패키지 80개 가격(4,500 > 문제(HWP) 3,000) | 다시 활성화할 때 가격 검토 | 활성화 시점에 운영자 검토(이번 범위 밖) | 지금은 비활성이라 화면 영향 없음, (a)면 활성화해도 오표시 없음 |
| D3 | 추천 태그 글자색·"구매하기" 색 | 태그: 잉크 글자(권장) / 흰 글자(시안). 구매하기: brand 보라(권장) / 잉크(시안) | 권장대로 | 흰 글자 대비 2.9:1 미달. 주요 행동은 brand(DESIGN.md) |
| D4 | 구매 영역 안 무료 샘플 행 | 한 줄 행으로 유지(권장) / 삭제(표지 아래 버튼만) | 유지 | 기능 무변경 원칙 |
| D5 | 보관함 안내 문구 | "자료 보관함"으로 교정(권장) / 그대로 | 교정 | 지금 메뉴 이름과 다름 |
| D6 | aside 영문 eyebrow | "구매 옵션"으로 한글화(권장) / 그대로 | 한글화 | 같은 화면 톤 통일 |
| D7 | PDF 포함 안내 본문 | 행 아래 한 줄 유지(권장) / 부제 라벨만 | 유지 | 구매 판단 정보 보존 |
| D8 | 패키지 제목에 관리자 라벨(`bundleOption.label`) 사용 | 쓰지 않고 "전체 패키지" 고정(권장, 지금과 같음) / 라벨 사용 | 고정 | 라벨 64개 모두 "전체 한번에 구매하기"라 시안과 다른 제목이 됨. 쓰려면 라벨 데이터를 먼저 정리 |

## 11. 위험

| 위험 | 대응 |
|---|---|
| 공유 컴포넌트라 과거 상세도 바뀜 | 비노출 화면, 브라우저 #11 최소 확인 |
| 구조 재작성 중 선택·충돌 동작 회귀 | 상태 계산 코드 무변경, 기능 단언 테스트(`market-detail-multiselect` 17-52) 유지, 브라우저 #4-#8 |
| 절약 표시 오류 | U1 순수 함수 단위 테스트, 브라우저 #1 숫자 대조, #2 패키지 블록 없음 확인 |
| 잉크 블록 위 포커스 링이 안 보임 | 흰 링 규칙, 브라우저 #10 |

## 12. 검증 기록

| 회차 | 대상 | 검증자 | 판정 | 비고 |
|---|---|---|---|---|
| R1 | 초안 | 독립 검증 | **FAIL** → 보완 | 사실·대비·테스트 표본 일치. 지적: 1(중간) 문학 80개 패키지는 비활성(공개 상세에 블록 없음) → 3절 표에 활성 열, D1 근거를 독서 64개(3,500 vs 실제 1,000)로, D2를 "재활성화 시 가격 검토"로, 브라우저 #2를 "패키지 없이 개별 2행"으로, U1 테스트 이름을 일반 규칙으로 2(중간) 제목을 `bundleOption.label`로 바꾸면 화면 변경 → "전체 패키지" 고정, 라벨 사용은 D8로 3(낮음) `isPdfInclusiveHwp`를 새 lib로 옮겨 출처 하나, 중복 판정 없음 계약 테스트 추가 |
| R2 | R1 보완본 | 독립 검증 | **OK** | 3건 반영 확인, 새 lib 클라이언트 안전. 낮음 1건(위험표 #2 숫자 대조 문구) 반영 |
| 사용자 결정 | D1·D3·D4·D5·D6·D7·D8 | 사용자 | 확정 | "권장안 대로 해줘" (D2는 패키지 재활성화 시 검토) |
| U1 구현 리뷰 | market-bundle-savings.ts·market-item-actions(import)·테스트 2개 | 독립 리뷰(imglib-s3-reviewer) | **OK** | 독서 64개 비교가 5,500·절약 1,000 SELECT 일치, null 조건 계획과 일치, slug는 기존 판정 범위 그대로 이동. NIT(`ownedScope` 범위 확대)은 U2에서 처리 |
| U2 구현 리뷰 | market-item-actions 렌더·아이콘 className·savings 조건·테스트 5개 | 독립 리뷰(imglib-s3-reviewer) | **OK**(MINOR 3·NIT 1 + 체크박스 대비 반영) | 로직 diff 없음, 상태 렌더 누락 없음. 반영: div group > ul, aria-live 상시 렌더, 잉크 블록 빈 파일 안내 대비, 패키지 토글 문구 고정+aria-pressed, 체크박스 테두리 --studio-control-border(약 3.7:1). 브라우저: 독서 상품 A안 배치·5,500 취소선·1,000 절약 확인 |
| U3 구현 리뷰 | market-material-detail·market-item-actions(샘플 행·보관함 안내)·테스트 2개 | 독립 리뷰(imglib-s3-reviewer) | **OK** | 로직 무변경(prefetch 3이벤트·openSamplePreview), 앵커·aria 유지, 샘플 없음 분기, 지운 코드 미사용 확인, 기존 실패 3개는 HEAD와 같은 사유. NIT(aside·섹션 h2 동일 문구)은 계획대로 유지. 브라우저: 머리말 "구매 옵션", 샘플 한 줄 행, "자료 보관함" 안내 확인 |
