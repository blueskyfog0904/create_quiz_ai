# 장바구니 사용자 확인 체크리스트

- 작성일: 2026-09-30 · 대상: 계획 v4의 P2-3·P3-1·P3-2, 매트릭스 T02·T12·T36·N3·N6, N7·T21
- 목적: 자동 검증이 할 수 없는 로그인·브라우저 확인을 사용자가 자기 계정으로 직접 한다. **권장 검증**이다. `MARKET_CART_ENABLED` 플래그는 제거되어(사용자 결정 2026-09-30) 장바구니는 항상 켜져 있고, 문제 시 git으로 되돌린다([cart-phase4-report.md](./cart-phase4-report.md) 5절).

> **경고 — 크레딧이 실제로 차감된다.** 이 앱은 개발 DB `kzcweelnzhcmiuvjgeyi`에 연결되어 있고, 구매 단계에서 계정 크레딧이 실제로 차감되어 주문·권한이 남는다. 가장 싼 상품으로 확인한다. 이관된 영어 legacy 상품 **「샘플 테스트」**의 `PDF` 1000크레딧, `HWP 파일` 1500크레딧이 가장 싸고, 그다음 V2 서브상품은 2500크레딧이다. 확인 후 되돌리려면 보관함에서 환불을 요청하고 관리자가 승인한다(8절).

## 0. 준비

1. 계정 세 개를 준비한다.
   - **A**: 주 확인용. 5,000크레딧 이상 보유.
   - **B**: 타인 접근 확인용.
   - **C**: 잔액 부족 확인용. 가장 싼 상품(1000)보다 잔액이 적어야 한다. 새로 가입한 0크레딧 계정이면 된다.
   - 관리자 계정 하나. A가 관리자여도 된다.
2. 개발 서버를 실행한다.
   ```bash
   npm run dev
   ```
   - 브라우저로 `http://localhost:4000`을 연다.
   - `MARKET_V2_PURCHASE_ENABLED`는 설정하지 않는다. 값이 `false`일 때만 구매가 중지된다.
3. 개발자도구(F12)를 연다.
   - **Network** 탭에서 `Preserve log`를 켠다.
   - **Console** 탭은 아래 fetch 코드 실행에 쓴다. 같은 origin에서 실행하므로 로그인 쿠키가 자동으로 붙는다.
4. 「샘플 테스트」 상품은 영어 카테고리 목록에서 찾는다. 찾기 어려우면 SQL 편집기에서 아래 조회를 실행한다(읽기 전용).
   ```sql
   select i.id, i.title from market_items i
   where exists (select 1 from market_item_subproducts s
                 join market_subproduct_categories c on c.id = s.category_id
                 where s.item_id = i.id and c.slug like 'legacy_%');
   ```
5. 상세 URL 형식은 `/preview/solvook-concept/boards/<카테고리 slug>/items/<itemId>?subject=<english|korean>`이다. 목록에서 상품을 누르면 이 주소로 이동한다.

## 1. 담기·헤더 배지·계정 전환 (P3-2 일부, 6절)

| # | 단계 | 기대 결과 | 결과 | 비고 |
|---|---|---|---|---|
| 1-1 | 로그아웃 상태에서 상세 화면의 `장바구니 담기`를 누른다 | 로그인 화면으로 이동한다. 로그인하면 **같은 상세 화면**으로 돌아온다. 자동으로 담기지는 않는다 | ☐ | |
| 1-2 | A로 로그인해 V2 서브상품 1개를 `장바구니 담기` | "…장바구니에 담았습니다" 안내와 `계속 둘러보기`/`장바구니 보기` Dialog가 뜬다. 헤더 배지가 1 증가한다 | ☐ | |
| 1-3 | 같은 상품을 한 번 더 담는다 | "이미 장바구니에 있습니다". 배지 수는 변하지 않는다 | ☐ | |
| 1-4 | 다른 상품의 전체 패키지(번들)를 담고, 「샘플 테스트」의 `PDF`도 담는다 | 배지가 3이 된다. `/cart`에서 영어/국어 과목 그룹이 나뉘어 보인다 | ☐ | |
| 1-5 | 로그아웃 후 B로 로그인한다 | 배지가 B의 행 수(0이면 숨김)로 바뀐다. A의 수가 남아 있으면 FAIL | ☐ | |
| 1-6 | 다시 A로 로그인한다 | 배지가 3으로 돌아온다 | ☐ | |

## 2. 반응형·키보드 (P3-2)

### 2-1. 폭 320 / 768 / 1440

개발자도구 Device Toolbar(Ctrl/Cmd+Shift+M)에서 폭을 320, 768, 1440으로 바꾼다. `/cart`, 상세 화면, 구매 확인 Dialog를 각각 연 상태에서 Console에 아래를 실행한다.

```js
document.documentElement.scrollWidth <= window.innerWidth
```

| 폭 | `/cart` true | 상세 true | Dialog true | 레이아웃 기대 | 결과 |
|---|---|---|---|---|---|
| 320 | ☐ | ☐ | ☐ | 한 열. 하단에 요약·구매 버튼이 고정되고 safe-area를 침범하지 않는다. 버튼 높이 44px 이상 | ☐ |
| 768 | ☐ | ☐ | ☐ | 한 열 또는 요약 하단. 가로 스크롤 0 | ☐ |
| 1440 | ☐ | ☐ | ☐ | 왼쪽 목록, 오른쪽 요약(`선택 자료 요약`) | ☐ |

### 2-2. 키보드만으로 구매

마우스를 쓰지 않는다. 구매는 3절에서 실제로 하므로 여기서는 Esc로 닫아도 된다.

| # | 단계 | 기대 결과 | 결과 |
|---|---|---|---|
| 2-2a | `/cart`에서 Tab으로 `구매 가능한 자료 전체 선택`과 각 행 체크박스로 이동하고 Space로 선택을 토글한다 | 포커스 링이 보인다. 합계가 바뀐다 | ☐ |
| 2-2b | Tab으로 `N건 구매` 버튼에 가서 Enter | 확인 Dialog가 열리고 포커스가 Dialog 안에 갇힌다 | ☐ |
| 2-2c | Dialog 안에서 Tab으로 이동한 뒤 Esc | Dialog가 닫히고 포커스가 구매 버튼으로 돌아온다 | ☐ |
| 2-2d | 다시 열어 Enter로 `N 크레딧 구매` 확정 | 3-1과 같은 결과(실제 차감) | ☐ |

## 3. cart 구매·같은 키 재시도 (P3-1, P3-2, T12)

| # | 단계 | 기대 결과 | 결과 | 비고 |
|---|---|---|---|---|
| 3-1 | A로 `/cart`에서 「샘플 테스트」 `PDF` 1행만 선택하고 구매 → 확인 | 성공 toast, `자료 보관함` 액션. 구매한 행만 cart에서 사라지고 미선택 행은 남는다. 헤더 잔액이 1000 줄어든다 | ☐ | 구매 전 잔액: ___ / 후: ___ |
| 3-2 | Network 탭에서 3-1의 `POST /api/market/cart/checkout` 요청 body를 본다 | `{items:[{cartItemId, expectedCredits, acknowledgeNoDiscount}], idempotencyKey:"<UUID>"}`. body에 `userId`·`priceCredits`가 없다 | ☐ | key: ___ |
| 3-3 | **응답 유실 재현(T12):** 3-2의 요청을 우클릭 → Copy → Copy as fetch로 복사해 Console에서 그대로 한 번 더 실행하고 `.then(r=>r.json()).then(console.log)`를 붙인다 | 200, `alreadyCompleted: true`, 3-1과 **같은** 주문 ID. 잔액 변화 없음. cart 행이 이미 지워졌어도 `CART_CHANGED`가 나오지 않는다 | ☐ | |
| 3-4 | Console: `fetch('/api/market/cart/checkouts/<3-2의 key>').then(r=>r.json()).then(console.log)` | 200, 같은 영수증 | ☐ | |
| 3-5 | **오프라인 재시도(cart):** V2 서브상품 1행을 담고 Dialog를 연다. Network 탭 Throttling을 `Offline`으로 바꾸고 구매 확정 | "네트워크 오류로 구매 결과를 확인하지 못했습니다…" 안내와 `같은 요청으로 다시 시도` 버튼이 보인다. 차감 없음 | ☐ | |
| 3-6 | Throttling을 `No throttling`으로 되돌리고 `같은 요청으로 다시 시도` | 성공. Network 탭에서 실패 요청과 성공 요청의 `idempotencyKey`가 **같다**. 잔액은 상품 가격만큼 **1회만** 줄었다 | ☐ | 가격 ___ / 잔액 차이 ___ |

## 4. 409 가격 변경과 402 잔액 부족 (P3-2, T07, T17)

### 4-1. 409 — 방법 ① 관리자 가격 변경(실제 흐름)

카탈로그를 실제로 바꾸므로 끝나면 원래 가격으로 되돌린다.

| # | 단계 | 기대 결과 | 결과 |
|---|---|---|---|
| a | A로 V2 서브상품을 담고 `/cart`에서 구매 확인 Dialog를 연 채로 둔다 | Dialog에 현재 가격 표시 | ☐ |
| b | 다른 탭의 관리자 `/admin/market/products`에서 그 서브상품 가격을 바꾼다(예: +100) | 저장 성공 | ☐ |
| c | 첫 탭에서 구매 확정 | 차감 없음. "가격이 변경되었습니다…" 안내와 함께 Dialog가 새 가격으로 갱신된다. Network 응답은 409 `PRICE_CHANGED` | ☐ |
| d | 갱신된 Dialog에서 확정 | 새 요청의 `idempotencyKey`가 c와 **다르다**. 새 가격으로 1회 차감 | ☐ |
| e | 관리자에서 가격을 원래대로 되돌린다 | – | ☐ |

### 4-2. 409 — 방법 ② 카탈로그를 바꾸지 않는 방법

`/cart` Console에서 담긴 행 ID를 확인하고 일부러 틀린 금액을 보낸다.

```js
const cart = await (await fetch('/api/market/cart')).json(); cart.data.items.map(i => [i.id, i.chargedCredits])
await (await fetch('/api/market/cart/checkout', {method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({items:[{cartItemId:'<행 ID>', expectedCredits: 1}], idempotencyKey: crypto.randomUUID()})})).json()
```

기대: 409 `PRICE_CHANGED`, 최신 항목별 가격 포함, 차감 없음. ☐

### 4-3. 402 — 잔액 부족

| # | 단계 | 기대 결과 | 결과 |
|---|---|---|---|
| a | C(잔액 부족)로 로그인해 가장 싼 상품을 담고 `/cart`에서 구매 확정 | 402. Dialog에 부족액과 `크레딧 충전하기`(→`/pricing`) 링크, "충전 후 장바구니로 돌아오면…" 문구. 차감 0, cart 행 유지 | ☐ |
| b | `크레딧 충전하기`를 누른다(결제는 하지 않는다) | `/pricing`으로 이동. 비로그인이었다면 로그인 복귀 주소가 `next` 파라미터로 붙는다 | ☐ |
| c | (선택) 충전을 마친 경우: Toss 성공 화면 또는 Kakao 결과 화면 | `/cart` 복귀 CTA가 보인다 | ☐ |

## 5. direct 단건 구매 (P2-3, P3-1, T36)

| # | 단계 | 기대 결과 | 결과 | 비고 |
|---|---|---|---|---|
| 5-1 | A로 상세 화면에서 V2 옵션(또는 「샘플 테스트」 `HWP 파일`)의 구매 버튼 → 확인 Dialog → 확정 | 200, 구매 완료 문구, 잔액 차감 1회, 보관함에 표시 | ☐ | |
| 5-2 | Network 탭에서 5-1의 `POST /api/market/items/<itemId>/purchase` body를 본다 | `{target:{targetKind:'subproduct', subproductId} 또는 {targetKind:'bundle', bundleOptionId}, expectedCredits, acknowledgeNoDiscount, idempotencyKey:"<UUID>"}`. `assetKind`·`purchaseType`·`Date.now()` 형태 키가 없다 | ☐ | |
| 5-3 | Dialog를 열고 닫기를 두 번 반복한 뒤 확정한다 | 확정 요청 1건만 나간다. Dialog를 열 때마다 키가 새로 만들어진다(열 때 1회 생성) | ☐ | |
| 5-4 | **오프라인 재시도(direct):** 다른 옵션으로 Dialog를 열고 Offline에서 확정 → Online 복귀 → 다시 열린 Dialog에서 확정 | 두 요청의 `idempotencyKey`가 같다. 차감 1회 | ☐ | |
| 5-5 | **replay:** 5-1 요청을 Copy as fetch로 다시 실행 | 200, `alreadyCompleted: true`, 같은 주문. 차감 없음 | ☐ | |
| 5-6 | **키 없는 옛 body:** `fetch('/api/market/items/<itemId>/purchase',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target:{targetKind:'subproduct',subproductId:'<id>'},expectedCredits:2500})}).then(r=>r.status)` | 400. 잔액 변화 없음 | ☐ | |
| 5-7 | **path 위조:** 5-2 body를 그대로 두고 URL의 `<itemId>`만 다른 상품 ID로 바꿔 실행(새 `idempotencyKey`) | 404 `NOT_FOUND`. 차감 없음 | ☐ | |
| 5-8 | **legacy body(N3):** `…/purchase`에 `{assetKind:'pdf'}` POST | 410 `LEGACY_PURCHASE_CLOSED`. 차감 없음 | ☐ | |
| 5-9 | **kill switch:** 서버를 `MARKET_V2_PURCHASE_ENABLED=false npm run dev`로 재시작하고 5-1(새 옵션)과 3-1을 시도 | direct와 cart 모두 503. 차감 없음. 확인 후 원래 명령으로 재시작 | ☐ | |
| 5-10 | `fetch('/api/market/purchases/batch',{method:'POST'}).then(r=>r.status)` | 410 | ☐ | |

## 6. 권한·입력 검증 (P3-1, T02)

| # | 단계 | 기대 결과 | 결과 |
|---|---|---|---|
| 6-1 | 로그아웃 상태 Console: `fetch('/api/market/cart').then(r=>r.status)`, `/api/market/cart/checkouts/<A의 key>` | 둘 다 401 | ☐ |
| 6-2 | A의 cart 행 ID 하나(4-2 조회)와 3-2의 key를 적어 둔다. B로 로그인한다 | – | ☐ |
| 6-3 | B Console: `fetch('/api/market/cart/items',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:['<A 행 ID>'],isSelected:false})}).then(r=>r.json())` | A의 ID가 `missingIds`에 들어가고 갱신 0. A로 돌아가면 선택 상태가 그대로다 | ☐ |
| 6-4 | B Console: 같은 ID로 `method:'DELETE'`, body `{ids:[…]}` | 성공 응답이어도 A의 행은 남아 있다(A로 확인) | ☐ |
| 6-5 | B Console: `fetch('/api/market/cart/checkouts/<A의 key>').then(r=>r.status)` | 404 | ☐ |
| 6-6 | B Console: checkout body에 A의 행 ID를 넣어 POST(새 key) | 409 `CART_CHANGED` 또는 404. 차감 0 | ☐ |
| 6-7 | A Console: checkout body에 `userId` 또는 `priceCredits` 필드를 추가해 POST | 400 `INVALID_INPUT` | ☐ |
| 6-8 | A Console: 담기 `POST /api/market/cart/items` body에 `userId` 추가 | 400 | ☐ |

## 7. legacy 이관 상품 (N3)

| # | 단계 | 기대 결과 | 결과 |
|---|---|---|---|
| 7-1 | 「샘플 테스트」 상세를 연다 | 옵션이 `PDF` 1000, `HWP 파일` 1500 V2 옵션으로 보인다. 옛 `PDF 구매하기`/`HWP & PDF 구매하기` legacy 버튼이 없다 | ☐ |
| 7-2 | 3-1(cart로 `PDF`)과 5-1(direct로 `HWP 파일`) 구매 후 `/library` | 두 자료가 보관함에 있다 | ☐ |
| 7-3 | 보관함에서 각각 다운로드 | 파일이 정상으로 열린다(PDF, HWP) | ☐ |
| 7-4 | 상세 화면을 새로고침한다 | 두 옵션이 보유 상태로 표시되고 구매 버튼이 없다. 재구매 시 409 `ALREADY_OWNED` | ☐ |

## 8. 환불 회귀 (T21, N7)

크레딧을 되돌리는 절차이기도 하다.

| # | 단계 | 기대 결과 | 결과 |
|---|---|---|---|
| 8-1 | **T21:** A로 cart에서 2개를 한 번에 구매한 뒤, 보관함에서 그중 하나만 환불 요청 → 관리자 `/admin/refunds`에서 승인 | 환불한 자료만 보관함에서 빠지고 다른 하나는 유지된다. 크레딧은 환불한 child 금액만 돌아온다 | ☐ |
| 8-2 | **N7:** 새 환불 요청 하나를 만든다. 관리자 화면을 두 탭으로 열고 거의 동시에 승인을 누른다 | 한쪽 성공, 다른 쪽 409(이미 처리). `/mypage/credits`에서 환불 내역이 **1건**이다 | ☐ |
| 8-3 | 승인된 요청의 같은 주문으로 환불을 다시 요청한다 | 불가("이미 처리된 환불 요청") | ☐ |

## 9. 상품 삭제 후 영수증 (N6, 선택·주의)

> 관리자 상품 삭제는 hard delete다. 그 상품의 주문·권한·환불요청이 CASCADE로 함께 삭제된다. **직접 만든 버리는 테스트 상품으로만** 한다. 실제 판매 상품으로는 하지 않는다.

| # | 단계 | 기대 결과 | 결과 |
|---|---|---|---|
| 9-1 | 관리자에서 테스트 상품(서브상품 1개, 파일 1개, 최소 가격)을 만들어 게시한다. A가 cart로 그 상품과 다른 상품 1개를 한 번에 구매하고 key를 적는다 | 구매 성공 | ☐ |
| 9-2 | 관리자에서 테스트 상품을 삭제한다 | 삭제 성공 | ☐ |
| 9-3 | A Console: `fetch('/api/market/cart/checkouts/<key>').then(r=>r.json()).then(console.log)` | 200. 스냅샷의 상품명·금액이 그대로 있고 삭제된 child는 `deleted`로 표시된다. 다른 child는 정상 | ☐ |

## 10. 기록

| 항목 | 내용 |
|---|---|
| 확인 일시 | |
| 확인자 / 사용 계정(A·B·C, 이메일 대신 별칭) | |
| 브라우저·버전 | |
| 전체 판정(모든 ☐ PASS 여부) | |
| FAIL 항목 번호와 증상 | |
| 사용한 크레딧 합계 / 환불로 돌려받은 크레딧 | |
| 확인 후 원복한 것(가격, 테스트 상품 등) | |

확인이 끝나면 [cart-phase4-report.md](./cart-phase4-report.md) 부록 A의 drift 쿼리를 다시 실행해 불변식 위반 0을 확인하고 결과를 팀 리드에 전달한다.
