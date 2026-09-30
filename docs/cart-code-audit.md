# 장바구니 도입 코드·사용자 흐름 감사

## 1. 결론

장바구니는 **로그인 사용자 전용 서버 저장**을 기본안으로 하고, 결제는 외부 PG가 아니라 사용자가 이미 보유한 **크레딧으로 선택 행을 일괄 구매**하는 방식이 적합하다. 외부 PG(Toss/카카오페이)는 `/pricing → /checkout`에서 크레딧을 충전할 때만 사용하고, 장바구니 구매 API에서는 `payment_orders`, PG 승인 API, 원화 결제를 호출하지 않아야 한다.

도입 방식은 기존 단건 구매를 제거하는 전환보다 다음의 additive rollout을 권고한다.

1. 상세 화면의 기존 단건 크레딧 구매를 유지하면서 `장바구니 담기`를 추가한다.
2. `/cart`에서 선택한 행만 서버 견적을 받은 뒤 한 번 더 확인한다.
3. 최종 구매 시 서버가 가격·판매 상태·파일 존재·이미 보유 여부·차액 업그레이드·잔액을 다시 계산한다.
4. 선택 전체를 하나의 DB 트랜잭션으로 처리하되, 구매/환불 단위는 장바구니 전체가 아니라 **선택한 판매 단위별 주문**으로 남긴다.
5. 성공한 트랜잭션 안에서 요청에 포함된 장바구니 행 ID만 삭제한다. 요청 도중 다른 탭에서 새로 담은 행과 미선택 행은 보존한다.

현재 `/api/market/purchases/batch`는 의도적으로 `410 BATCH_PURCHASE_DEPRECATED`를 반환한다. 과거 리스트 직접 결제를 복원하지 말고, 장바구니에서 명시적으로 선택한 서버 장바구니 행 ID만 받는 새 계약으로 이 경로를 재사용하는 것이 가장 작은 변경이다. 리스트 화면은 계속 상세 페이지로만 이동해야 한다.

## 2. 조사 범위와 전제

먼저 루트 `AGENTS.md`, `CLAUDE.md`, `DESIGN.md`를 읽고 다음을 조사했다.

- `src/app/api/market`의 단건 구매, 폐기된 batch 구매, 다운로드, 환불
- `market-item-actions.tsx`의 가격 표시, 잔액 확인, 로그인 이동, 구매 확인 UI
- `market-purchase.ts`, `market-items-server.ts`, `credits.ts`, `credit-balance.ts`, `market-refunds.ts`
- 로그인 `next` 처리와 OAuth callback
- 전역 헤더와 Solvook 헤더
- `/library`, `/mypage/credits`, `/pricing`, `/checkout`
- 구매/다운로드/환불/크레딧 관련 계약 테스트와 DB migration

현재 worktree에는 다른 작업자의 dirty 변경이 다수 있다. 특히 상세 액션, Solvook 보관함·크레딧 화면, 헤더·로고, pagination 관련 변경은 읽기만 했고 수정하거나 되돌리지 않았다. 이 감사가 수정한 파일은 이 문서 하나뿐이다.

동시에 생성된 읽기 전용 증적 `docs/cart-live-db-evidence.json`도 참고했다. 감사 시점의 live schema에는 cart 테이블이 없었고(`cartTables: []`), published 상품은 국어 144개·영어 1개, 활성 v2 서브상품 352개, 활성 번들 64개로 기록되어 있다. 다만 해당 증적도 명시하듯 PostgREST만으로 RLS 식·인덱스·함수 본문과 lock 동작을 증명할 수 없으므로, 구현 전 `pg_catalog` 검증은 별도로 필요하다.

## 3. 현재 사용자 흐름

### 3.1 상세 화면과 로그인

`src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx`가 공개 상품, 파일, v2 서브상품/번들, 사용자 소유권을 서버에서 읽어 `market-item-actions.tsx`에 전달한다.

- legacy: `pdf`, `hwp`, `zip` 파일별 가격과 소유 여부
- v2: `subproduct` 또는 `bundle`, 서버가 계산한 `priceCredits`, `owned`, HWP 차액 업그레이드 금액
- 비로그인 구매 클릭: `useLoginRedirect()`가 현재 pathname과 query를 `next`로 넣어 `/login`으로 보낸다.
- 로그인 페이지와 `/auth/callback`은 `next`의 query/hash를 보존하고 로그인 완료 후 원래 위치로 돌아온다.

장바구니 담기도 이 로그인 이동을 재사용할 수 있다. 기본안에서는 비로그인 사용자의 담기 의도를 저장하지 않고 로그인 후 같은 상세로 돌아오게 하며, 사용자가 다시 `장바구니 담기`를 누르게 한다. 자동 담기까지 요구되면 URL에 raw mutation을 넣기보다 별도의 단기 서명 intent가 필요하므로 1차 범위에서는 제외하는 편이 단순하고 안전하다.

### 3.2 단건 자료 구매

`POST /api/market/items/[itemId]/purchase`가 legacy와 v2를 body 모양으로 분기한다.

| 구분 | 요청 | 서버 가격 | 구매 기록 | 소유권 |
|---|---|---|---|---|
| legacy | `{ assetKind: 'pdf'|'hwp'|'zip' }` | `market_items.*_price` | `market_purchases` | 완료 purchase 행 |
| v2 서브상품 | `{ purchaseType:'subproduct', subproductId, idempotencyKey? }` | `market_item_subproducts.price_credits`, 필요 시 서버 차액 | `market_purchase_orders` + line | `market_entitlements(scope='subproduct')` |
| v2 번들 | `{ purchaseType:'bundle', bundleOptionId, idempotencyKey? }` | `market_item_bundle_options.price_credits` | `market_purchase_orders` + line | `market_entitlements(scope='item')` |

클라이언트는 구매 확인 전에 `/api/credits/balance`를 호출해 잔액을 표시한다. 최종 구매에서는 서버가 DB 가격으로 크레딧을 차감하므로 클라이언트 가격으로 과소 청구되지는 않는다. 그러나 클라이언트가 확인한 가격과 서버가 실제 차감한 가격이 달라도 현재 계약에는 `PRICE_CHANGED`가 없어서, **사용자가 본 금액과 다른 금액이 그대로 차감될 수 있다.** 장바구니뿐 아니라 유지할 단건 구매에도 expected price 검증을 추가해야 한다.

v2 구매는 `createMarketV2PurchaseWithCompensation()`이 크레딧 차감 후 order/line/entitlement를 만들고 실패 시 삭제와 크레딧 반환을 시도한다. 이는 여러 DB 호출을 보상하는 방식이지 한 트랜잭션이 아니다. 한 건에는 실용적이지만 선택 일괄 구매의 all-or-nothing 기반으로 그대로 반복 호출해서는 안 된다.

### 3.3 다운로드

`GET /api/market/items/[itemId]/download`는 다음 두 계약을 유지한다.

- v2: `?fileId=` → 활성 파일 확인 → entitlement 확인 → pending 환불 확인 → 5분 signed URL → download event 기록 → redirect
- legacy: `?assetKind=pdf|hwp|zip` → 완료 purchase 확인 → pending 환불 확인 → signed URL → download event 기록 → redirect

Storage path는 공개 DTO에 포함되지 않으며 entitlement 확인 후에만 signed URL을 만든다. 장바구니 도입에는 Storage 변경이 필요하지 않다. 성공 응답에 signed URL을 넣지 말고, 기존 자료 보관함과 다운로드 API를 그대로 사용해야 한다.

### 3.4 자료 보관함과 환불

`/library`는 로그인 필수이고 `listMarketLibraryRowsForUser()`가 legacy purchases와 v2 entitlements를 item별로 합쳐 보여준다. 한 상품에 구매 건이 여러 개면 `refundTargets` 배열로 보존하며, 현재 Solvook 보관함 Dialog도 사용자가 **환불할 구매 건 하나**를 선택하게 되어 있다.

현재 환불 단위는 다음과 같다.

- legacy: `market_purchases.id` 한 건, 즉 한 asset
- v2: `market_purchase_orders.id` 한 건, 즉 서브상품 하나 또는 번들 하나
- v2 번들은 그 주문으로 받은 파일 중 하나라도 다운로드하면 번들 전체가 환불 불가
- 구매 후 7일 이내, download event 0건, 완료 상태, credit consumption snapshot 존재가 필요
- HWP 차액 업그레이드의 기준이 된 PDF 주문은 별도 보호 규칙으로 환불 불가
- 승인 시 외부 PG 환불이 아니라 소비했던 credit source에 크레딧을 복구

따라서 장바구니 전체를 v2 order 하나로 만들면 파일 하나 다운로드가 장바구니 전체 환불을 막고 부분 환불도 불가능해진다. **checkout group은 하나로 묶되 order는 장바구니 판매 단위마다 생성**해야 현재 환불 UX와 정확히 맞는다.

### 3.5 크레딧 충전과 자료 구매의 경계

| 항목 | 크레딧 충전 | 문제마켓 자료 구매 |
|---|---|---|
| 사용자가 지불하는 것 | 원화 | 보유 크레딧 |
| 진입 | `/pricing` → `/checkout` | 상세 단건 또는 `/cart` |
| 외부 시스템 | Toss/카카오페이 | 없음 |
| 주 기록 | `payment_orders`, provider transaction, `payment_history`, `credit_sources` | `market_purchases` 또는 v2 order/line/entitlement, credit consumption |
| 잔액 변화 | 증가 | 감소 |
| 환불 | 원 결제수단 | 크레딧 복구 |

`POST /api/credits/purchase`는 테스트 충전 종료로 410을 반환한다. 장바구니에서 이 API를 사용해서는 안 된다. 잔액 부족 시에는 장바구니와 선택 상태를 유지하고 `/pricing`으로 안내한 뒤, 기존 PG 충전이 끝난 사용자가 장바구니로 돌아와 다시 견적을 받게 해야 한다.

## 4. 현재 계약의 문제와 장바구니에서 막아야 할 오류

### 4.1 응답 오류 매핑

현재 단건 구매의 주요 응답은 다음과 같다.

- 400 `INVALID_INPUT`
- 401 `UNAUTHORIZED`
- 402 `INSUFFICIENT_CREDITS`
- 409 `ALREADY_PURCHASED`
- 503 `V2_PURCHASE_DISABLED`
- 500 `INTERNAL_SERVER_ERROR`

다음 문제를 고쳐야 한다.

1. v2는 exception message에 `크레딧|부족|이미`가 있는지 정규식으로 status/code를 정한다. 판매 중단, 파일 없음, 잘못된 target도 대부분 500이 된다. typed domain error로 바꿔야 한다.
2. legacy는 `deductCreditsForMarketPurchase()`가 던진 모든 오류를 402로 취급한다. 실제 원장 장애도 잔액 부족으로 오인할 수 있다.
3. 가격이 바뀌어도 expected price 비교가 없어 409가 없다.
4. `/api/credits/balance`의 401은 `{ error: 'Unauthorized' }`로, market API의 `{ success:false,error:{code,message} }`와 다르다. 장바구니 API는 market 형식을 일관되게 사용해야 한다.
5. `createMarketV2PurchaseWithCompensation()`의 idempotency 선조회와 unique index는 순차 retry는 막지만, 동시에 같은 key가 들어오는 전 과정을 하나의 트랜잭션으로 직렬화하지 않는다. batch는 checkout-level idempotency가 별도로 필요하다.
6. `rollbackMarketV2PurchaseArtifacts()`는 세 delete 결과의 오류를 확인하지 않는다. 선택 구매 전체를 application-level 보상 루프로 구현하면 불완전 복구 위험이 커진다.
7. legacy `market_purchases`의 unique `(user_id,item_id,asset_kind)`는 refunded 행에도 계속 적용된다. 환불 승인 후 `findCompletedMarketPurchase()`는 소유하지 않은 것으로 보지만 재구매 insert는 unique 위반이 된다. 장바구니 출시 전 partial unique(active/completed)로 바꾸거나 기존 행을 안전하게 재활성화하는 재구매 정책을 결정해야 한다.

### 4.2 로그인 `next` 오류

`src/lib/auth-paths.ts`, 로그인 페이지, OAuth callback 자체는 internal path를 정규화하고 `next`를 잘 보존한다. 호출부에는 두 가지 불일치가 있다.

- `src/app/preview/solvook-concept/_components/preview-header.tsx`는 로그인/회원가입 `next`를 현재 위치가 아니라 항상 `/`로 하드코딩한다.
- `src/app/pricing/pricing-client.tsx`와 `src/app/checkout/page.tsx`는 `/login?redirect=...`를 사용하지만 로그인 페이지는 `next`만 읽는다. 비로그인 충전 사용자는 로그인 후 checkout으로 돌아가지 못한다.

장바구니 링크와 충전 연결을 넣기 전에 모두 `buildAuthRedirectPath()` 또는 `next=`로 통일해야 한다. 새로운 cart page는 `requireAuth('/cart')`를 사용하고, API는 각 route에서 다시 `auth.getUser()`를 검증해야 한다.

### 4.3 현재 테스트 부채

조사 중 관련 계약 테스트 40개를 실행해 39개가 통과했다. 실패한 `tests/market-v2-purchase-entitlement-contract.test.mjs`의 “bundle full price” 테스트는 `market-purchase.ts` 전체에서 `차액`이라는 단어가 없어야 한다고 검사하지만, 현재 코드에는 의도적으로 PDF→HWP 차액 업그레이드가 구현되어 있다. 장바구니 변경과 무관한 기존 stale assertion이며, bundle 계산 함수 범위만 검사하도록 먼저 고쳐야 정확한 회귀 기준이 된다.

## 5. 권고 사용자 흐름

### 5.1 담기

1. 상세 페이지는 서버가 제공한 판매 옵션과 소유 상태를 표시한다.
2. 로그인 사용자가 `장바구니 담기`를 누르면 target identity만 POST한다. 가격은 보내지 않거나 서버가 무시한다.
3. 서버는 현재 판매 상태, 파일 존재, 소유권, 같은 item의 bundle/subproduct 충돌을 확인하고 idempotent upsert한다.
4. 성공 시 cart count를 반환하고 `market-cart-updated` 이벤트로 두 헤더의 badge를 갱신한다.
5. 이미 담긴 동일 target은 오류 대신 200 `alreadyInCart:true`가 자연스럽다.
6. 이미 보유한 target은 409 `ALREADY_PURCHASED`, 번들과 그 구성 서브상품이 동시에 담기는 경우 409 `SELECTION_CONFLICT`와 충돌 행을 반환한다.

legacy `assetKind`, v2 `subproduct`, v2 `bundle`을 모두 cart target으로 표현해야 상세 화면의 fallback 상품이 빠지지 않는다. 디지털 상품이므로 quantity는 두지 않는다.

### 5.2 장바구니 보기와 선택

- 서버 저장 행은 target identity와 추가 시각만 보관한다.
- 제목, 카테고리, 현재 가격, 차액 가격, 파일 유형, 판매 가능, 이미 보유는 매 조회마다 서버가 계산한다.
- 선택 checkbox는 client state로 둔다. DB에 `selected`를 저장하지 않으면 다른 탭과 선택 상태가 충돌하지 않고, 최종 요청의 명시적 ID만 처리할 수 있다.
- owned/unavailable/conflict 행은 선택 불가로 표시하고 제거 또는 상세 이동을 제공한다.
- 전체 선택은 구매 가능한 행만 포함한다.
- cart는 영어/국어를 함께 담을 수 있는 전역 보관함으로 두는 것이 헤더와 `/cart` 구조에 맞다. 각 행에 과목을 표시한다.

### 5.3 확인 시점과 409 가격 변경

페이지 최초 조회 값만으로 확인 Dialog를 열면 안 된다.

1. 사용자가 `선택 자료 구매`를 누르는 시점에 `POST /api/market/cart/quote`를 호출한다.
2. 서버가 선택 행을 다시 읽고 현재 가격·소유·판매 가능·잔액을 계산한다.
3. 성공한 quote의 서버 총액과 잔액으로 확인 Dialog를 연다.
4. confirm 요청에도 quote의 행별 expected price와 idempotency key를 보낸다.
5. 최종 transaction 직전에 다시 계산한 가격이 하나라도 다르면 차감 없이 409 `PRICE_CHANGED`를 반환한다.
6. UI는 변경 전/후 금액을 행별로 표시하고 새 총액으로 **두 번째 명시적 확인**을 받아야 한다. 자동 재시도 또는 자동 동의는 금지한다.

가격이 내려간 경우도 동일하게 409로 다시 확인받는 편이 계약이 단순하고 audit 가능하다.

### 5.4 잔액 부족

- quote 또는 최종 단계에서 402 `INSUFFICIENT_CREDITS`
- 응답에 `requiredCredits`, `balance`, `shortfall`과 `buildCreditBalanceResponseFields()`의 잔액 필드를 포함
- 선택과 cart 행을 그대로 유지
- Dialog에 `크레딧 충전` → `/pricing` 링크 제공
- 충전 후에는 cart가 서버에 남아 있으므로 다시 `/cart`에서 quote
- cart 구매 API가 PG 주문을 생성하거나 부족분을 원화로 직접 결제하지 않음

충전 완료 후 자동 복귀는 별도 UX 개선이다. 최소 범위는 Toss/Kakao 결과 화면 모두에 `장바구니로 돌아가기`를 제공하는 것이다. `returnTo=/cart`를 provider 왕복 전체에 전달하려면 Toss success URL뿐 아니라 Kakao callback/result에도 안전한 return target 보존이 필요하므로, payment 주문 스키마까지 건드리는 확대 변경은 별도 phase로 분리하는 편이 낫다.

### 5.5 성공과 동시 변경

최종 요청은 `cartItemIds`를 명시하고 DB transaction은 정확히 그 ID만 lock한다.

- 전부 성공: 구매 기록·entitlement·크레딧 차감·선택 cart 행 삭제를 commit
- 하나라도 가격/소유/판매/잔액 검증 실패: 아무 구매도 하지 않고 cart를 유지
- 요청 중 다른 탭에서 추가된 다른 ID: 삭제하지 않고 보존
- 미선택 행: 보존
- retry: 같은 checkout idempotency key면 기존 성공 결과를 200 `alreadyCompleted:true`로 반환하고 다시 차감하지 않음
- 성공 UI: 반환된 `removedCartItemIds`만 local state에서 제거하고 서버의 `remainingCartCount`로 badge 갱신 후 `/library` 이동 선택지 제공

부분 성공 응답을 기본으로 만들지 않는 것을 권고한다. application loop + 보상 방식밖에 선택할 수 없다면 성공/실패 행을 명시하고 성공 행만 삭제해야 하지만, 이는 환불 snapshot과 재시도 UX를 복잡하게 하므로 차선책이다.

## 6. API 계약 제안

### 6.1 Cart CRUD

`GET /api/market/cart`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "cartItemId": "uuid",
        "workspaceSubject": "korean",
        "itemId": "uuid",
        "itemTitle": "상품명",
        "categorySlug": "slug",
        "targetKind": "subproduct",
        "targetId": "uuid",
        "targetLabel": "문제(PDF)",
        "priceCredits": 1200,
        "owned": false,
        "purchasable": true,
        "reason": null,
        "addedAt": "ISO-8601"
      }
    ],
    "count": 1
  }
}
```

`POST /api/market/cart`

```json
{
  "itemId": "uuid",
  "targetKind": "legacy_asset | subproduct | bundle",
  "assetKind": "pdf | hwp | zip",
  "subproductId": "uuid",
  "bundleOptionId": "uuid"
}
```

target 종류에 맞지 않는 nullable 필드는 허용하지 않는 discriminated union으로 검증한다. 응답은 `cartItem`, `count`, `alreadyInCart`를 포함한다.

`DELETE /api/market/cart/items/[cartItemId]`

- 다른 사용자 행은 존재 여부를 노출하지 않도록 404
- 성공 시 삭제한 ID와 새 count 반환

### 6.2 Quote

`POST /api/market/cart/quote`

```json
{
  "cartItemIds": ["uuid", "uuid"]
}
```

200 응답은 서버가 다시 계산한 행, `totalCredits`, balance snapshot, `shortfall`, `quotedAt`을 반환한다. 빈 배열, 중복 ID, 상한 초과는 400이다. 권고 상한은 운영 확인 후 정하되 임의 hardcode가 아니라 API schema와 정책 상수 한 곳에서 관리한다.

### 6.3 선택 일괄 구매

기존 `POST /api/market/purchases/batch`의 410 body를 다음 cart-only 계약으로 교체한다.

```json
{
  "cartItemIds": ["uuid", "uuid"],
  "expectedPrices": [
    { "cartItemId": "uuid", "priceCredits": 1200 },
    { "cartItemId": "uuid", "priceCredits": 800 }
  ],
  "idempotencyKey": "client-generated-uuid"
}
```

성공:

```json
{
  "success": true,
  "data": {
    "checkoutId": "uuid",
    "orders": [
      {
        "cartItemId": "uuid",
        "orderId": "uuid",
        "targetKind": "subproduct",
        "chargedCredits": 1200
      }
    ],
    "totalCredits": 2000,
    "removedCartItemIds": ["uuid", "uuid"],
    "remainingCartCount": 3
  },
  "alreadyCompleted": false,
  "balance": 5000,
  "spendableBalance": 5000
}
```

권고 오류:

| HTTP | code | 의미와 mutation |
|---|---|---|
| 400 | `INVALID_INPUT`, `EMPTY_SELECTION`, `SELECTION_LIMIT_EXCEEDED` | 차감 없음 |
| 401 | `UNAUTHORIZED` | 차감 없음, login next 제공은 client 책임 |
| 404 | `CART_ITEM_NOT_FOUND` | 사용자 소유가 아닌/사라진 선택, 차감 없음 |
| 402 | `INSUFFICIENT_CREDITS` | balance/required/shortfall 반환, cart 유지 |
| 409 | `PRICE_CHANGED` | 변경 행과 새 quote 반환, 재확인 필요 |
| 409 | `ALREADY_PURCHASED` | 서버 소유 정보 반환, cart 유지 |
| 409 | `TARGET_UNAVAILABLE` | 비공개/비활성/파일 없음, cart 유지 |
| 409 | `SELECTION_CONFLICT` | bundle↔subproduct 또는 PDF↔PDF 포함 HWP 중복 |
| 503 | `V2_PURCHASE_DISABLED` | v2 대상이 포함된 경우 전체 중단 |
| 500 | `INTERNAL_SERVER_ERROR` | transaction rollback, cart 유지 |

모든 mutation 응답은 가능한 경우 `buildCreditBalanceResponseFields()`를 포함하고 market API의 `{ success, error:{code,message} }` 형식을 유지한다.

## 7. 데이터·트랜잭션 권고

### 7.1 장바구니 행

새 migration에 `market_cart_items`를 추가한다.

- `id`, `user_id`, `workspace_subject`, `item_id`
- `target_kind`: `legacy_asset | subproduct | bundle`
- target별 nullable `asset_kind`, `subproduct_id`, `bundle_option_id`
- target 조합 check constraint
- `(item_id, workspace_subject)`와 각 target의 composite FK로 다른 과목·다른 부모 item을 참조하지 못하게 함
- target별 partial unique index로 사용자 중복 담기 방지
- `created_at`, `updated_at`
- 가격, 제목, owned, 파일 경로는 저장하지 않음
- RLS enabled
- own SELECT만 허용하거나, 모든 mutation을 서버 API/service role로 제한

직접 authenticated insert를 허용하면 API의 상품 상태·부모 item·충돌 검증을 우회할 수 있다. 환불 요청을 API-only로 harden한 기존 패턴처럼 cart mutation도 API-only가 안전하다.

### 7.2 Checkout group과 환불 단위

`market_cart_checkouts`와 `market_cart_checkout_lines`를 권고한다.

- checkout: `user_id`, `idempotency_key`, `status`, `total_credits`, timestamps, unique `(user_id,idempotency_key)`
- checkout line: checkout, 원 cart item, target snapshot, 최종 가격, 생성된 legacy purchase 또는 v2 order 중 하나
- 하나의 checkout이 여러 과목과 여러 item을 묶을 수 있음
- 각 v2 target은 기존처럼 order 하나, legacy target은 purchase 하나
- 각 주문에 해당 판매 단위의 `credit_consumptions` snapshot 저장

이 구조는 영수증/재시도는 checkout으로 묶고, 다운로드·환불은 기존 order/purchase 단위로 유지한다.

### 7.3 원자성

Next route에서 기존 단건 helper를 순차 호출하는 것으로는 DB transaction을 공유할 수 없다. 다음을 하나의 SECURITY DEFINER RPC 안에서 처리해야 한다.

1. checkout idempotency row 생성/기존 완료 결과 반환
2. 선택 cart 행을 `FOR UPDATE`, user ID 일치 확인
3. 상품/target/파일/entitlement와 현재 가격 재검증
4. expected price 비교
5. bundle/subproduct/PDF-HWP 중복 선택 정규화 또는 conflict
6. 판매 단위별 FIFO 크레딧 차감과 consumption snapshot 생성
7. purchase/order/line/entitlement 생성
8. checkout line 연결
9. 선택 cart ID만 삭제
10. 완료 상태와 새 잔액 반환

같은 RPC transaction에서 한 단계라도 실패하면 전부 rollback되어야 한다. 함수 execute 권한은 일반 `anon/authenticated`에서 회수하고 서버 service role만 호출하게 한다. 구현 전 live DB에 보이는 `consume_credits_once`와 repository migration 간 drift를 확인하고, 의존 함수 정의를 migration source of truth로 먼저 맞춰야 한다.

## 8. 정확한 변경 후보 파일

### 8.1 신규 파일

| 파일 | 역할 |
|---|---|
| `src/app/(solvook)/cart/page.tsx` | `requireAuth('/cart')`, 서버 cart DTO·잔액 로드 |
| `src/app/(solvook)/cart/_components/cart-view.tsx` | 선택, 제거, quote, 확인, 409/402/성공 UX |
| `src/app/api/market/cart/route.ts` | GET/POST cart |
| `src/app/api/market/cart/items/[cartItemId]/route.ts` | DELETE |
| `src/app/api/market/cart/quote/route.ts` | 서버 재견적 |
| `src/lib/market-cart-server.ts` | cart CRUD, DTO masking, batch 조회/견적 |
| `src/components/market/market-cart-indicator.tsx` | 두 헤더가 함께 쓰는 cart link/badge/event sync |
| `supabase/migrations/<timestamp>_create_market_cart_checkout.sql` | cart/checkout schema, RLS, indexes, atomic RPC |
| `tests/market-cart-schema-contract.test.mjs` | schema/RLS/function 정적 계약 |
| `tests/market-cart-api-contract.test.mjs` | CRUD/quote/batch 응답 계약 |
| `tests/market-cart-ui-contract.test.mjs` | 선택/확인/오류/행 보존 UI 계약 |
| `supabase/tests/market_cart_checkout.test.sql` | 실제 DB transaction·idempotency·rollback 검증 |

`src/types/supabase.ts`는 migration 적용 후 공식 gen 명령으로 재생성한다.

### 8.2 기존 파일

| 파일 | 최소 변경 |
|---|---|
| `src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx` | legacy/v2 옵션별 담기, cart count event; 기존 direct 구매 유지 |
| `src/app/api/market/purchases/batch/route.ts` | 410 stub을 cart 선택 전용 atomic checkout으로 교체 |
| `src/app/api/market/items/[itemId]/purchase/route.ts` | expected price/`PRICE_CHANGED`, typed domain error; 단건 회귀 유지 |
| `src/lib/market-purchase.ts` | 단건과 cart가 공유하는 target resolve/price/ownership 규칙; message regex 제거 기반 |
| `src/lib/market-items-server.ts` | 기존 context/entitlement/order helper 재사용, cart용 bulk 조회가 필요하면 N+1 없이 추가 |
| `src/lib/credits.ts` | atomic checkout RPC가 잔액 mutation을 소유하면 기존 public method는 유지; application batch loop 추가는 금지 |
| `src/components/layout/header.tsx` | 로그인 사용자 초기 cart count 조회 |
| `src/components/layout/header-client.tsx` | desktop/mobile cart indicator 배치 |
| `src/app/(solvook)/layout.tsx` | PreviewHeader에 초기 cart count 전달 |
| `src/app/preview/solvook-concept/_components/preview-header.tsx` | desktop/mobile cart indicator, 현재 위치 기반 login `next` |
| `src/components/layout/path-aware-site-chrome.tsx` | `/cart`가 Solvook 자체 header/footer를 쓰도록 제외 |
| `src/components/features/credits/credit-confirmation-dialog.tsx` | 두 번째 consumer인 cart에 총액·부족 시 충전 action을 additive prop/slot으로 지원하거나 cart local Dialog 사용 |
| `src/app/pricing/pricing-client.tsx` | 잘못된 `redirect`를 `next`/`buildAuthRedirectPath`로 수정 |
| `src/app/checkout/page.tsx` | 잘못된 `redirect`를 `next`로 수정 |
| `src/app/checkout/success/page.tsx` | 최소 범위의 `장바구니로 돌아가기` CTA 검토 |
| `src/app/checkout/kakaopay/result/result-client.tsx` | Toss와 동일한 cart 복귀 CTA 검토 |
| `src/app/(solvook)/library/_components/library-view.tsx` | 기능 변경 불필요; 선택 행별 refund target 표시 회귀 검증 |
| `src/app/api/market/items/[itemId]/download/route.ts` | 기능 변경 불필요; 신규 주문의 entitlement/download event 회귀 검증 |
| `src/lib/market-refunds.ts` | 기능 변경 최소화; checkout group이 아닌 order별 snapshot/환불 규칙 회귀 검증 |

legacy 재구매 unique 문제를 수정한다면 같은 cart migration 또는 별도 migration에서 constraint 정책을 명시하고 그에 맞는 테스트를 추가해야 한다.

## 9. 재사용 가능한 UI와 만들지 말아야 할 추상화

재사용 권고:

- `StudioContainer`, `StudioEmptyState`
- shadcn `Button`, `Checkbox`, `Dialog`, `AlertDialog`, `Badge`
- `FileTypeDocIcon`
- `CreditConfirmationDialog`: required/current/remaining 구조는 일괄 총액에도 맞는다. cart가 두 번째 실제 consumer가 되므로 optional 부족 action을 additive하게 넣을 근거가 생긴다.
- `MarketPurchaseCompleteDialog`: 단순 성공 안내로는 재사용 가능하나, 남은 cart와 자료 보관함 CTA가 필요하면 cart local success Dialog가 더 명확하다.
- `market-cart-indicator`: 전역 헤더와 PreviewHeader라는 실제 consumer 2곳이 있으므로 새 공통 component gate를 충족한다.

직접 재사용하지 않을 것:

- `market-item-actions.tsx`의 `FileOptionRow`, `SectionHeading`은 현재 local이고 상세 전용 props/state를 가진다. cart 행과 정보 구조가 다르므로 억지로 공통화하지 않는다.
- `LibraryView`의 행 markup도 download/refund 중심이라 cart의 select/remove/price 상태와 다르다. 시각 토큰만 따르고 component는 공유하지 않는다.
- cart 초기 버전에 pagination을 넣지 않는다. 필요 데이터와 실제 규모가 확인되기 전에는 `StudioListPagination`을 추가할 이유가 없다.

모든 새 UI는 `DESIGN.md`에 따라 Studio semantic token, 1200px container, 44px hit area, keyboard/focus-visible, mobile 320px 무가로스크롤을 지켜야 한다. raw hex, 임의 radius/width, 새 base library는 추가하지 않는다.

## 10. 로그인 필수 기본안과 게스트안 비교

| 항목 | 로그인 필수 서버 저장(권고) | 게스트 장바구니 |
|---|---|---|
| 저장 | `market_cart_items` | localStorage 또는 anonymous token/server cart |
| 여러 기기 | 가능 | 로그인 전 불가 또는 복잡한 guest token 필요 |
| SSR header count | 안정적 | hydration 후 표시, flicker 가능 |
| 소유권 판정 | 사용자 기준 즉시 가능 | 로그인 전 불가 |
| 로그인 병합 | 불필요 | dedupe/owned/unavailable/충돌 merge 필요 |
| 보안 | API auth + RLS 단순 | client payload를 모두 불신하고 재검증 필요 |
| 개인정보/만료 | 사용자 계정 정책 | guest token, 만료, cookie 동의 범위 검토 |
| 구현 범위 | 작음 | 큼 |

게스트안을 선택해도 가격과 소유권은 localStorage 값이 source of truth가 될 수 없다. 로그인 직후 guest target ID를 서버 cart에 idempotent merge하고, 서버가 반환한 성공 target만 localStorage에서 지워야 한다. bundle/subproduct 충돌, 이미 보유, 판매 중단을 merge 결과로 보여줘야 한다.

현재 제품은 자료 구매·보관함·환불·크레딧이 모두 사용자 계정에 귀속된다. 따라서 1차 도입에서 게스트 cart가 주는 이익보다 로그인 병합과 상태 불일치 비용이 크다. 로그인 필수안을 기본으로 권고한다.

## 11. 테스트 확장과 회귀 기준

### 11.1 기존 테스트 갱신

- `market-batch-purchase-zip-rollback-contract.test.mjs`: 410 고정 assertion을 cart-only atomic batch 계약으로 교체
- `market-listboard-no-direct-purchase-contract.test.mjs`: 리스트가 batch를 직접 호출하지 않는 조건은 유지, batch 자체 410 assertion만 제거
- `credit-mutation-snapshot-contract.test.mjs`: batch 폐기 대신 checkout 응답의 snapshot-backed balance 확인
- `market-zip-purchase-entitlement-contract.test.mjs`, `market-hwp-bundle-contract.test.mjs`: batch 410 전제를 cart target/정확한 entitlement 전제로 갱신
- `market-v2-purchase-entitlement-contract.test.mjs`: stale `차액` 전역 금지 assertion을 bundle 계산 범위로 축소
- `auth-login-complete-dialog-contract.test.mjs`: `/cart`, `/pricing`, `/checkout`의 `next` 보존 추가
- `solvook-preview-flow-contract.test.mjs`: cart indicator와 current-location login next 추가

### 11.2 DB/API 필수 시나리오

1. cart unique/RLS/API-only mutation
2. 다른 사용자의 cart ID 구매·삭제 404
3. legacy/v2/subproduct/bundle 각각 담기와 구매
4. 동일 target 두 번 담기 idempotent
5. bundle+구성 subproduct, PDF+PDF 포함 HWP 선택 conflict
6. 기존 PDF 소유자의 HWP 차액을 서버가 계산
7. 이미 보유/환불 pending/비공개/비활성/파일 없음 차단
8. quote 후 가격 변경 → 409, 차감·주문·삭제 모두 0
9. 잔액 부족 → 402, cart/선택/잔액 mutation 없음
10. 중간 order/entitlement insert 강제 실패 → 전체 rollback
11. 같은 idempotency key 동시/반복 요청 → 1회 차감, 같은 결과
12. 선택 2행 성공 → 각 order consumption 합이 각 charged credits와 일치
13. 성공 시 선택 ID만 삭제, 미선택과 요청 중 신규 ID 보존
14. refund는 checkout 전체가 아니라 order/legacy purchase 한 건만 복구
15. 한 order 다운로드는 그 order 환불만 차단하고 다른 cart 주문은 차단하지 않음
16. 성공 주문은 기존 `/library`에 나타나고 기존 download API로 내려받음
17. public DTO와 cart API에 storage path/checksum/original private metadata가 노출되지 않음

### 11.3 UI/수동 회귀

- 비로그인 담기 → 안전한 `next` 로그인 → 원 상세 복귀
- desktop/mobile 두 header badge 동기화
- 개별/전체 선택, 선택 가능 행만 총액 반영
- quote loading, empty, owned, unavailable, 409, 402, 500 상태 문구
- 409 후 변경 행 강조와 재확인 없이는 구매 불가
- 충전 이동 후 cart 유지
- 성공 후 선택 행만 사라지고 새로 담은 행 유지
- 구매 완료 후 자료 보관함, 다운로드, 환불 Dialog 정상
- 320px, 768px, desktop에서 가로 overflow 없음
- keyboard만으로 checkbox, 제거 확인, 구매 Dialog, 닫기, 충전 링크 수행
- `credit-balance-updated`와 `market-cart-updated` 후 header가 최신 값 표시

### 11.4 완료 전 명령

구현 phase마다 관련 `node --test ...`를 먼저 통과시키고, 최종적으로 최소 다음을 실행해야 한다.

```bash
node --test tests/market-cart-*.test.mjs tests/market-v2-*.test.mjs tests/market-refund-*.test.mjs tests/credit-*.test.mjs tests/auth-*.test.mjs tests/solvook-preview-flow-contract.test.mjs
npm run lint
npm run build
```

DB 변경은 local/검증 DB에서 migration 후 `supabase/tests/market_cart_checkout.test.sql`을 실행하고, RLS/함수 execute 권한/인덱스를 `pg_catalog`로 확인한다. 실제 PG 승인 요청은 장바구니 회귀에서 호출하지 않는다.

## 12. 구현 순서와 phase별 종료 조건

### Phase 0. 기존 계약 정리

- login `redirect`/고정 `/` next 오류 수정
- typed purchase error와 단건 expected price 409 추가
- legacy 환불 후 재구매 unique 정책 결정/수정
- stale 차액 테스트 수정

종료 조건: 기존 단건 구매·가격 변경·로그인 복귀 테스트가 통과하고, 다운로드/환불 테스트가 그대로 통과한다.

### Phase 1. 서버 cart

- migration/RLS/생성 타입
- cart helper와 CRUD/quote API
- cart page read-only 목록/선택/제거
- 두 header indicator

종료 조건: 다른 사용자 격리, server price/owned DTO, login 필수, multi-device 조회, header count가 검증된다.

### Phase 2. atomic 선택 구매

- checkout group/line과 atomic RPC
- `/api/market/purchases/batch` cart-only 계약
- 409/402/idempotency/선택 ID 삭제
- 성공/오류 UI

종료 조건: 강제 실패에서도 부분 주문·부분 차감·부분 삭제가 0이고, retry가 1회 차감이며, 요청 중 신규 행이 남는다.

### Phase 3. 보관함·충전 회귀

- order별 library/refund 확인
- insufficient → pricing 연결과 cart 복귀 CTA
- responsive/accessibility/manual validation

종료 조건: cart에서 산 각 판매 단위가 독립 환불 target으로 보이고, 다운로드가 해당 target만 환불 불가로 만들며, PG 충전과 자료 구매 기록이 섞이지 않는다.

## 13. 최종 권고 요약

- 로그인 필수 서버 cart를 먼저 도입한다.
- 가격·소유권·판매 상태·잔액은 조회/quote/final 세 시점 모두 서버가 source of truth다.
- 확인 Dialog는 구매 버튼 시점의 서버 quote로 열고, final 가격 변경은 409 후 재확인한다.
- 선택 일괄 구매는 크레딧 사용이며 외부 PG 직접 결제가 아니다.
- batch는 하나의 DB transaction, 환불은 선택 판매 단위별 기존 order/purchase를 유지한다.
- 성공 시 선택 ID만 삭제하고 미선택/신규 cart 행은 보존한다.
- 다운로드/Storage/자료 보관함/환불은 기존 계약을 재사용하고 회귀 검증한다.
- 기존 단건 구매는 1차에서 유지해 안전하게 additive rollout한다.
