# 자료 보관함 다운로드 버튼 이름 정리 계획

- 작성일: 2026-10-06 · 브랜치 feature/market-cart · 상태: 검증 OK(R2) — 구현 단계
- 요청: 자료 보관함 다운로드 버튼이 ① `문제(PDF) (PDF)`·`문제(HWP) (HWP)`처럼 형식이 두 번 붙고, ② 다른 상품은 `HWP 다운로드`·`PDF 다운로드`처럼 종류(문제/워크북)가 안 보인다. 종류가 보이게 고친다.

## 1. 요청 분석

**사실**
- 버튼 이름 규칙: `src/app/(solvook)/library/_components/library-view.tsx:547-548`
  - 보이는 서브상품(구성)이 2개 이상: `${subproductTitle} (${fileTypeLabel})`
  - 1개: `${fileTypeLabel} 다운로드`
- `subproductTitle`은 서브상품 분류 이름(`market_subproduct_categories.name`: `워크북`·`문제(PDF)`·`문제(HWP)`)이고(`market-items-server.ts:2717,2742`, `resolveMarketSubproductDisplayTitle`), `fileTypeLabel`은 파일 형식 라벨(`PDF`·`HWP`)이다.
- 사용자 보관함(DB 확인, 모두 v2 구성 구매, 옛 구매 없음):
  - 현재: '디지털 읽기': 워크북(pdf)·문제(PDF)(pdf)·문제(HWP)(hwp, pdf) → 구성 3개 → `워크북 (PDF)`, `문제(PDF) (PDF)`, `문제(HWP) (HWP)`(문제(HWP)의 PDF는 `dedupeQuestionPdfFiles`로 숨김)
  - 현재: 나머지 6개: 문제(HWP)만(hwp, pdf) → 구성 1개 → `HWP 다운로드`, `PDF 다운로드`
- 분류 이름에 이미 형식이 들어 있는 경우가 있어서 ①이 생기고, 구성이 1개일 때 분류 이름을 빼서 ②가 생긴다.
- 옛 구매(legacy) 버튼 `PDF 다운로드`·`HWP 다운로드`·`ZIP 다운로드`(`:550-552`)는 이번 사용자 데이터에는 없다(옛 방식은 구성 개념이 없어 형식 이름만 있음).

**결정(R1 검증 반영)**
- D1 **구성 수와 관계없이 같은 규칙**을 쓴다.
- D2 **상세 페이지의 기존 규칙을 공유한다(새 규칙을 만들지 않음).** 상세 구매 영역에 이미 같은 문제를 푸는 `getMarketDownloadButtonLabel`(`src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx:187-200`, 동작 테스트 `tests/market-v2-detail-library-contract.test.mjs:119-134`)이 있다. 구성 이름 끝 괄호의 형식이 파일 형식과 같으면 그대로, 다르면 괄호 안을 파일 형식으로 바꾸고, 괄호가 없으면 `(형식)`을 붙인 뒤 ` 다운로드`를 붙인다. 이 함수를 `src/lib/market-download-label.ts`로 옮겨 상세와 보관함이 함께 쓴다. 단순 포함 검사(초안 D2)는 'HWP & PDF'·'HWPX' 같은 이름에서 오동작하므로 폐기.
  - 결과: '디지털 읽기' → `워크북(PDF) 다운로드` · `문제(PDF) 다운로드` · `문제(HWP) 다운로드`. 문제(HWP)만 산 6개 → `문제(HWP) 다운로드` · `문제(PDF) 다운로드`.
- D3 **순서**: 서버 보관함 조회의 분류 select(`market-items-server.ts:2685` 부근)에 `sort_order`를 추가하고, 상품별 파일 배열을 분류 순서로 **안정 정렬**한다(응답 타입 변경 없음). 상세의 `listMarketSubproductDownloadFilesForUser`도 같은 규칙이므로 같은 정렬을 적용한다(같은 함수·헬퍼를 공유할 수 있으면 공유).
- D4 아이콘(`FileTypeDocIcon`)은 그대로.
- D5 옛 구매 버튼(`PDF/HWP/ZIP 다운로드`)은 구성 정보가 없어 그대로 둔다.
- 영향 없음 확인: 환불 Dialog `target.label`·`v2OwnedLabels`는 서버 `subproductTitleMap`을 써서 무관, 다른 소비처 없음(grep).

## 2. 변경 대상
- 새 `src/lib/market-download-label.ts`(기존 `getMarketDownloadButtonLabel` 이동, export), `market-item-actions.tsx`는 import로 교체.
- `src/app/(solvook)/library/_components/library-view.tsx`: `buildV2DownloadLabel` 제거, 공유 함수 사용.
- `src/lib/market-items-server.ts`: 보관함·상세 다운로드 파일 조회의 분류 select에 `sort_order`, 상품별 안정 정렬.
- 테스트: `market-v2-detail-library-contract.test.mjs`의 runInNewContext 추출(:24-27) 경로·정규식을 새 lib 파일로 갱신(기존 3개 기대값 유지), 보관함이 공유 함수를 쓰는지 계약, 정렬 계약.

## 3. 검증
- `npx tsc --noEmit`, 변경 파일 eslint, 관련 테스트, 전체 `node --test tests/*.test.mjs` 실패 이름 기준선과 같음, 복사본 `next build`.
- 브라우저(사용자 로그인 상태의 연동 Chrome): `/library?subject=korean`에서 '디지털 읽기' 행이 `워크북(PDF) 다운로드` → `문제(PDF) 다운로드` → `문제(HWP) 다운로드`, 나머지 6행이 `문제(HWP) 다운로드`·`문제(PDF) 다운로드`(같은 구성 안이라 기존 파일 순서 유지)로 보이고 각 버튼 다운로드 동작은 그대로.

## 4. 위험
| 위험 | 대응 |
|---|---|
| 관리자가 분류 이름을 형식 없이 바꾸면(예: `문제`) `(형식)`이 자동으로 붙음 | 의도된 동작(기존 상세 규칙과 동일) |
| 같은 구성에 같은 형식 파일이 여러 개면 이름이 같아짐 | 기존에도 같음. 발생 시 후속(파일명 표시) |

## 5. 검증 기록
| 회차 | 대상 | 검증자 | 판정 | 비고 |
|---|---|---|---|---|
| R1 | 초안 | 독립 검증 | **FAIL** → 보완 | 상세의 기존 `getMarketDownloadButtonLabel` 규칙 누락(높음) → 공유로 변경, 포함 검사 결함(중간) → 폐기, 정렬 데이터 `sort_order` 미조회(중간) → 서버 select·안정 정렬, 테스트 추출 경로 갱신 |
| R2 | R1 보완본 | 독립 검증 | **OK** | 반영 확인, 번들 안전. 보완: 새 lib는 구조 타입 `{ fileTypeLabel; subproductTitle }` 매개변수(의존 없음), 테스트 :24-27 추출과 :110-113 정의 검사를 새 lib 대상으로(가능하면 node-test-register로 직접 import), 1절 현재 동작에 '현재:' 접두 — 반영 |
| 구현 리뷰 | market-download-label.ts·market-item-actions·library-view·market-items-server·계약 테스트 | 독립 리뷰(imglib-s3-reviewer) | **OK** | 라벨 함수 본문 동일 이동, dedupe→라벨 순 적용, 안정 정렬·분류 없음 뒤로, 응답 타입 불변, 번들 안전. NIT: 정렬 동작 테스트(미반영), 기존 dedupe의 slug 하드코딩(범위 밖, 보고). 브라우저: 디지털 읽기 워크북(PDF)→문제(PDF)→문제(HWP), 나머지 문제(HWP)·문제(PDF) 다운로드 확인 |

## 6. 후속 요청: 버튼 뒤 '다운로드' 문구 제거 (2026-10-06)
- 요청: "뒤에 '다운로드' 문구는 없애줘. 칸을 너무 많이 차지한다."
- 사실: 문구는 공용 `getMarketDownloadButtonLabel`(`src/lib/market-download-label.ts`)이 붙인다. 소비처는 보관함 버튼 2곳(`library-view.tsx:588,593`)과 상세 구매 영역(`market-item-actions.tsx:984-990`, `aria-label={downloadLabel}`과 보이는 글자).
- 결정
  - F1 공용 함수가 `다운로드`를 붙이지 않고 `워크북(PDF)`·`문제(PDF)`·`문제(HWP)`만 돌려준다. 두 화면이 같은 이름을 쓰므로 상세 구매 영역 버튼도 함께 짧아진다(규칙 일관성).
  - F2 접근성: 화면 낭독기용 이름에는 `다운로드`를 남긴다. **`<a>` 링크에만** `aria-label={`${label} 다운로드`}`(보관함 링크, 상세는 기존 `aria-label={downloadLabel}`을 `${downloadLabel} 다운로드`로). 환불 대기 중 비활성 `<span>`에는 aria-label을 주지 않는다(role 없는 span의 aria-label은 ARIA상 금지·무시됨). 아이콘은 그대로.
  - F3 옛 구매 버튼(`library-view.tsx:550-552` `PDF/HWP/ZIP 다운로드`)도 같은 화면 일관성을 위해 보이는 글자에서 `다운로드`를 빼고(`PDF`·`HWP`·`ZIP`) 링크에 같은 방식의 aria-label을 단다(현재 데이터 0건).
- 테스트: `market-v2-detail-library-contract.test.mjs`의 기대값 4개를 `다운로드` 없는 값으로 바꾸고, 두 화면의 `aria-label`에 `다운로드`가 붙는지 계약 검사 추가.
- 검증: tsc, eslint, 관련·전체 테스트(기준선 39), 복사본 build, 브라우저(보관함 버튼이 `문제(HWP)`·`문제(PDF)` 등으로 짧아짐).

| 회차 | 대상 | 검증자 | 판정 | 비고 |
|---|---|---|---|---|
| R1 | 6절 | 독립 검증 | **OK** | 소비처 3곳·테스트 기대값 4개 확인. 보완: aria-label은 `<a>`에만(F2), 상세도 짧아짐을 완료 보고에 명시, 옛 구매 버튼도 맞춤(F3) — 반영 |
| 6절 구현 리뷰 | 4파일 | 독립 리뷰(imglib-s3-reviewer) | **OK** | 보이는 글자에서 다운로드 제거, `<a>` 3곳에만 aria-label(Label in Name), 환불 대기 span 제외, 옛 구매 PDF/HWP/ZIP. 브라우저: 보관함 버튼 `워크북(PDF)`·`문제(PDF)`·`문제(HWP)` 확인 |
