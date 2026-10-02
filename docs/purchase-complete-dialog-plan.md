# 자료 구매 완료 알림을 중앙 Studio Dialog로 통일하는 계획

- 작성일: 2026-10-02 · 브랜치 feature/market-cart(HEAD df76fb6) · 상태: 계획 초안. 코드는 아직 변경하지 않았다.
- 요청: "자료가 구매되고 나서 팝업이 오른쪽 아래에 작게 나와. 구매 확인 팝업이 중앙에 나오게 해줘. 팝업 디자인도 현재 디자인 스타일에 맞게 해줘."

## 1. 요청 분석

**사실(근거)**
- 오른쪽 아래 작은 팝업은 sonner toast다. `src/app/layout.tsx`의 `<Toaster />`는 position을 지정하지 않아 기본(오른쪽 아래)이다. `src/components/ui/sonner.tsx`도 position이 없다.
- 구매 성공 알림 경로는 둘이다. ① 장바구니 결제 `cart-view.tsx:217`은 `toast.success(payload.message …, { action: { label: '자료 보관함' … } })`이고 **이것이 사용자가 본 오른쪽 아래 팝업**이다. ② 상품 상세 바로 구매 `market-item-actions.tsx:802`는 이미 중앙 `MarketPurchaseCompleteDialog`(`(dashboard)/market/[slug]/market-purchase-complete-dialog.tsx`)를 쓴다. 이 Dialog는 문구 한 줄 + `확인`이고 `bg-emerald-50 text-emerald-600` Tailwind 팔레트를 쓰므로 Studio 토큰 스타일이 아니다. 소비처는 상세 1곳이다.
- 그 밖의 `구매 완료`류 문구: 두 API(`/api/market/cart/checkout`, `/api/market/items/[itemId]/purchase`)의 `message`뿐이다. `credits-view.tsx:284`의 `toast.success`는 **환불 요청** 결과이고, 크레딧 충전(/pricing)은 자료 구매가 아니다. legacy 화면은 이 두 API를 호출하지 않는다(호출처는 위 2곳뿐).
- 영수증 응답(`payload.data`)에는 `orders[{itemTitle, optionTitle, categoryName, chargedCredits, workspaceSubject}]`, `totalCredits`, `alreadyCompleted`가 있고, `payload.balance`는 표시용 잔액(헤더 `credit-balance-updated`로 보내는 값, `balanceAfter`와 별개)이다. API 변경은 필요 없다.
- `alreadyCompleted`는 같은 멱등 키 재요청의 replay 응답이다. 두 소비처 모두 지금은 신규 구매와 같은 성공 경로로 처리한다.
- 선례: 확인 Dialog `market-checkout-confirm-dialog.tsx`는 `ul`(`divide-[var(--studio-border)]`)·`dl` 합계 구조를 쓰고, `Button variant="brand"/"brandOutline"`을 쓴다. Studio 토큰은 `:root`에 있어 Portal 안에서도 유효하다(DESIGN.md 접근성 절). `--studio-success`(#63cdb7)는 흰 배경 아이콘 대비가 약 1.9:1이라 아이콘 색으로 쓰지 않는다.
- 자료 보관함 경로는 `/library`이고 국어는 `?subject=korean`이다(`preview-header.tsx`의 `libraryHref`와 같은 규칙). 구매 직후 상세 화면의 옵션 행은 `router.refresh()`로 다운로드 버튼이 된다.

**결정**
- D1 **범위**: 자료 구매 성공 알림만 바꾼다(장바구니 결제 + 상세 바로 구매). 오류·409·402 안내, 환불·충전 등 다른 toast, `Toaster` 설정은 바꾸지 않는다.
- D2 **공통 컴포넌트**: 소비처가 상세·장바구니 2곳이고 props(영수증 줄·합계·잔액·이동 링크·닫기)가 대응하므로 DESIGN.md 2-consumer gate를 통과한다. `src/components/market/market-purchase-complete-dialog.tsx`(named export `MarketPurchaseCompleteDialog`)를 만들고 기존 `(dashboard)/market/[slug]/market-purchase-complete-dialog.tsx`는 삭제한다(내가 소비처를 옮겨 고아가 되므로). 도메인 fetch·router는 넣지 않고 상태·요청은 소비처가 소유한다.
- D3 **내용**: 서버 `message` 문자열 대신 영수증으로 렌더한다. 성공 아이콘(`CheckCircle2`, `bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]` 원형), 제목 `구매 완료`, 설명 `{N}건 구매가 완료되었습니다.`, 자료 목록(제목 + 옵션/카테고리 + `chargedCredits`, `max-h-60` 스크롤), `dl`로 `사용 크레딧`(`totalCredits`)·`남은 크레딧`(`payload.balance`가 숫자일 때만, 아니면 줄 생략).
- D4 **버튼**: `계속 둘러보기`(brandOutline, 닫기)와 `자료 보관함에서 받기`(brand, `Link` → `libraryHref`). 소비처가 `orders[].workspaceSubject`가 모두 `korean`이면 `/library?subject=korean`, 아니면 `/library`를 넘긴다(공통 순수 함수 `resolveMarketLibraryHref(subjects)`를 같은 파일에서 export). 상세에서는 닫으면 `router.refresh()`로 바뀐 다운로드 행이 보이고, 장바구니에서는 닫으면 갱신된 장바구니가 보인다.
- D5 **스타일**: `DialogContent`에 `sm:max-w-md rounded-[var(--studio-radius-card)] border-[var(--studio-border)] bg-[var(--studio-surface)] shadow-[var(--studio-shadow-card)]`, 글자 `--studio-ink`·`--studio-text`·`--studio-muted`, 포커스 링 `--studio-focus-ring`. raw hex·Tailwind 색 팔레트(emerald 등)·임의 radius 금지. 확인 Dialog(`market-checkout-confirm-dialog`)의 기본 스타일은 이번에 바꾸지 않는다.
- D6 **접근성**: Radix `DialogTitle`(`구매 완료`)·`DialogDescription`으로 `aria-labelledby/describedby`를 연결하고, DOM 순서를 `[계속 둘러보기][자료 보관함에서 받기]`로 둬 초기 포커스를 닫기 버튼에 둔다(확정 버튼을 누른 Enter가 곧바로 이동 링크를 활성화하지 않게 한다). Esc·오버레이 클릭·닫기는 모두 `onClose`다. 닫은 뒤 포커스는 Radix 기본(직전 포커스 요소, 비활성이면 body)이고 문서 맨 위로 튀지 않는지만 확인한다. 모든 버튼 `min-h-11`(44px)이다.
- D7 **순서**: 성공 분기에서 `setCheckout(null)`(확인 Dialog 닫힘)과 완료 상태 설정을 같은 틱에 하고(현재 상세와 같다), 잔액 이벤트 → 선택 초기화/`reload()` → `router.refresh()`는 지금 순서를 유지한다. 두 Dialog가 겹쳐 깜박이면 완료 Dialog 열림 조건에 `checkout === null`을 더한다.
- D8 **alreadyCompleted**: 같은 Dialog를 띄우되 설명을 `이미 처리된 구매입니다. 같은 요청이 중복으로 차감되지는 않았습니다.`로 바꾼다. 목록·합계는 replay 영수증 값이고 잔액 이벤트·갱신은 기존과 같다.
- D9 멱등 키 생성·같은 키 재시도·구매 자동 실행 금지·오류 분기는 건드리지 않는다.

**불명확점**: 없음(문구와 버튼 라벨은 요청 예시를 따랐다). 장바구니에서 `계속 둘러보기`는 Dialog만 닫고 /cart에 머문다.

## 2. 대상 경로
- 변경: `src/components/market/market-purchase-complete-dialog.tsx`(신규), `src/app/(solvook)/cart/_components/cart-view.tsx`(성공 분기만), `src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx`(성공 분기·상태·Dialog 사용), 삭제 `(dashboard)/market/[slug]/market-purchase-complete-dialog.tsx`.
- 무변경: API 두 개, `Toaster`, 확인 Dialog, 장바구니 담기 결과 Dialog, 환불·충전 toast.

## 3. 단계별 작업과 검증
- **S0 기준선**: `git status --porcelain`, `node --test tests/market-*.test.mjs 2>&1 | tail -5`, `npx tsc --noEmit` 기록. 검증: 기록 존재.
- **S1 테스트 먼저**(4절): 신규 계약 테스트와 갱신분이 현 구현에서 실패한다(레드).
- **S2 공통 Dialog**: 컴포넌트 작성. 검증: `npx tsc --noEmit`, `npx eslint 'src/components/market/market-purchase-complete-dialog.tsx'` exit 0, 신규 테스트 중 컴포넌트 assert 통과.
- **S3 상세 연결**: 소비처 전환, 옛 파일 삭제. 검증: tsc·eslint exit 0, `node --test tests/market-item-detail-ui-contract.test.mjs tests/market-listboard-zip-contract.test.mjs tests/market-detail-multiselect-contract.test.mjs` 통과.
- **S4 장바구니 연결**: `toast.success` 구매 알림 제거 후 Dialog 연결. 검증: tsc·eslint exit 0, 계약 테스트 통과, `git diff`에서 cart-view는 성공 분기·상태·import만 바뀌었고 오류 분기는 동일.
- **S5 브라우저**(로그인 계정, 소액 크레딧): ① 상세에서 2건 선택 → 구매 → 확인 Dialog가 닫히고 **화면 중앙**에 `구매 완료` Dialog(아이콘·목록·사용 크레딧·남은 크레딧)가 뜨며 오른쪽 아래 toast가 없다 ② 장바구니 결제도 같은 Dialog이고 toast가 없다 ③ 헤더 크레딧과 `남은 크레딧`이 같다 ④ `자료 보관함에서 받기` → `/library`(국어 자료는 `?subject=korean`)에 구매 자료가 있다 ⑤ 상세에서 닫으면 옵션 행이 다운로드 버튼이다 ⑥ DevTools offline → 확정 → online → `같은 요청으로 다시 시도`(차감 1회, 같은 키) 후 Dialog 1회 ⑦ 같은 키 replay(이미 처리된 요청) 시 `이미 처리된 구매입니다…` 문구 ⑧ 키보드: 초기 포커스가 `계속 둘러보기`, Tab 이동, Esc로 닫힘, 포커스가 body 맨 위로 튀지 않음 ⑨ 1280/768/320px에서 Dialog가 중앙이고 `scrollWidth <= innerWidth`, 버튼·목록 항목 높이 ≥ 44 ⑩ 402·409·재시도 안내와 다른 toast(담기 실패 등)는 그대로.
- **S6 통합**: `npm run lint`·`npm run build` 새 실패 0, `node --test` 새 실패 0(S0 대비), 사용자 기존 변경 보존(`git checkout`/`restore` 금지).

## 4. 테스트
- 신규 `tests/market-purchase-complete-dialog-contract.test.mjs`: 컴포넌트가 `src/components/market/`에 있고 `DialogTitle` `구매 완료`, `DialogDescription`, `Link`+`libraryHref`, `resolveMarketLibraryHref`, `alreadyCompleted` 문구, DOM에서 닫기 버튼이 링크보다 앞, Studio 토큰(`--studio-`)을 쓰며 raw hex·`emerald-`·`slate-` 등 팔레트와 `fetch(`·`useRouter`가 없다 · `cart-view.tsx`와 `market-item-actions.tsx`가 둘 다 이 컴포넌트를 import해 렌더하고 cart-view에 `toast.success(`가 없다(`toast.error`는 유지) · 옛 파일이 없다 · `layout.tsx`·`sonner.tsx`에 `position`이 추가되지 않았다.
- 갱신 `tests/market-item-detail-ui-contract.test.mjs:146-153`: 새 import 경로와 상태 형태로 바꾼다(`setPurchaseCompleteMessage(payload.message …)`·`message={…}` assert를 영수증 상태 assert로 교체, `doesNotMatch(/toast\.success\(payload\.message/)`는 유지). `tests/market-listboard-zip-contract.test.mjs:37-39`(목록 클라이언트에 이 Dialog가 없어야 함)는 그대로 통과해야 한다.
- 유지: `market-detail-multiselect-contract`의 멱등 키·같은 키 재시도·자동 실행 금지·cart 공통 Dialog assert, `market-v2-*` 구매 계약.

## 5. 위험
| 위험 | 대응 |
|---|---|
| 확인 Dialog 닫힘과 완료 Dialog 열림이 겹쳐 포커스가 튄다 | D7 같은 틱 + 필요 시 `checkout === null` 조건, S5 ⑧ |
| 상세에서 `router.refresh()`로 상태가 바뀌며 Dialog가 닫힌다 | 상태는 클라이언트에 있고 컴포넌트가 리마운트되지 않음, S5 ⑤로 확인 |
| 닫은 뒤 직전 포커스 요소(구매하기 버튼)가 비활성이라 포커스가 사라진다 | Radix 기본 수용, S5 ⑧에서 튀지 않는지만 확인 |
| 잔액 표시가 헤더와 다르다 | `payload.balance`(헤더와 같은 값)만 쓰고 `balanceAfter`는 쓰지 않는다. 값이 없으면 줄 생략 |
| 긴 자료 목록이 Dialog를 넘친다 | `max-h-60 overflow-y-auto`(확인 Dialog와 같은 방식), 320px 확인 |
| 문구(`message`) 의존 테스트가 깨진다 | 4절 갱신 목록으로 한정 |

## 6. 검증 기록
| 회차 | 대상 | 검증자 | 판정 | 근거·보완 사항 |
|---|---|---|---|---|
| R1 | 계획 초안 | (대기) | | |
| 구현 | 공용 market-purchase-complete-dialog·상세·cart·계약 테스트 | 독립 검증 | OK | cart toast 제거·중앙 Dialog, 영수증 필드 일치, 초기 포커스·모바일 순서, Studio 토큰. tsc·eslint·build 통과, node 986건 fail 39(새 실패 0). 브라우저 S5는 사용자 확인 |
