# 상품 상세 다중 선택 → 일괄 장바구니 담기·바로 구매 계획

- 작성일: 2026-09-30 · 상위 계획: [cart-implementation-plan-v4.md](./cart-implementation-plan-v4.md)(v4). v4와 충돌하면 이 문서가 **상세 화면 선택 UI와 direct mode**에 한해 우선한다.
- 상태: **R1 OK + 비차단 N1~N8 반영본**(10절). 코드·DB는 아직 변경하지 않았다. `MARKET_CART_ENABLED`가 없는 상태(장바구니 항상 ON)를 전제로 한다.

## 1. 요청 분석

**사실(근거)**
- 두 상세 경로 `/market/[slug]/items/[itemId]`(dashboard `page.tsx:159`)와 `/preview/solvook-concept/boards/[slug]/items/[itemId]`(`market-material-detail.tsx:335`)는 같은 `MarketItemActions`를 렌더한다. 이 컴포넌트만 바꾸면 두 경로에 모두 적용된다.
- 지금은 행마다 [장바구니 담기][이 자료만 구매]가 있고, 번들 카드에는 [장바구니 담기][전체 패키지 구매]가 있다(`market-item-actions.tsx:676-697, 765-786`). 확인 Dialog는 단일 금액용 `CreditConfirmationDialog`이고, 멱등 키는 Dialog 단위 `randomUUID`다(`:419`).
- 번들은 상품당 활성 1개다(`uq_market_item_bundle_options_active_item`). 선택 대상은 활성·미삭제 V2 서브상품 N개와 번들 0~1개다.
- `checkout_market_selection` direct mode는 정확히 1줄만 받는다(`20260930024829:291`). payload 형태는 `{mode,itemId,target_kind,target_id,expectedCredits,ack}`다(`:354-361`). batch 내 충돌 검사(6단계)와 전부 성공/전부 롤백(9단계 RAISE)은 이미 여러 줄을 전제로 작성되어 있다.
- direct route를 호출하는 곳은 `market-item-actions.tsx` 하나다(grep 확인). 개발 DB의 `market_checkout_batches`는 **0행**이다(2026-09-30 조회). 따라서 payload 형태를 바꿔도 기존 키 replay와 호환할 문제가 없다.
- `POST /api/market/cart/items`는 target 1개를 받는다. `add_market_cart_item`은 중복이면 기존 행을 돌려주고(한도 검사보다 먼저 한다), 50행이면 `CART_LIMIT`을 돌려준다(`20260930020304:154-164`).
- 공개 DTO(`MarketSubproductPublicSummary`)에는 `priceCredits`, `upgradePriceCredits`(R5와 같은 규칙, `market-items-server.ts:1560-1578`), `owned/ownedScope`, `fileCount`, `fileTypes`, `categorySlug`가 있다.

**사용자 확정 결정**: ① 구매하기는 장바구니를 거치지 않는 바로 구매다. 장바구니 내용은 바꾸지 않고 direct mode를 1..N으로 확장한다(migration 1개). ② 행별 버튼은 체크박스로 대체한다. 행에는 체크박스와 가격만 두고, 보유 옵션은 기존 다운로드 버튼을 유지한다.

**이 계획의 결정(D)**
- D1 **표시 가격은 기존 DTO로 클라이언트에서 계산한다**: 행 가격 = `upgradePriceCredits ?? priceCredits`, 번들 = `priceCredits`, 총 금액 = 선택 행의 합이다. 이 값은 표시용이고 `expectedCredits` 비교값으로만 쓴다. 차감액은 RPC가 `evaluate_market_targets`로 다시 계산하며, 값이 다르면 409 `PRICE_CHANGED`로 최신가를 Dialog에 반영한다(v4 4절 7단계). 페이지에서 RPC를 추가로 호출하는 방식은 서버 호출과 prop만 늘리므로 채택하지 않는다.
- D2 **일괄 담기는 클라이언트가 기존 POST를 target별로 순차 호출한다**(API·DB 변경 없음). 근거: 상세 한 곳의 선택은 수 건이다. 담기는 원자성이 필요 없다(중복은 기존 행을 반환한다). 결과를 target별로 받아야 부분 성공(`CART_LIMIT`)을 정확히 안내할 수 있다. 병렬로 보내면 profile 잠금에서 경합하므로 순차로 호출한다.
- D3 **direct HTTP body를 배열 하나로 일원화한다**: `{lines:[{target, expectedCredits, acknowledgeNoDiscount?}] (1..50), idempotencyKey}`. 옛 `{target,…}` body는 strict 검사로 400을 받는다(호출처 1곳을 같은 단계에서 전환한다). legacy `assetKind`는 410을 유지한다.
- D4 **확인 Dialog의 표시부를 공통 컴포넌트로 뺀다**: `src/components/market/market-checkout-confirm-dialog.tsx`, 소비처는 `cart-view`와 상세 2곳이다. 두 소비처의 props(줄 목록·합계·잔액·ack·notice·부족액·재시도·제출 중)가 대응하므로 DESIGN.md의 2-consumer gate를 통과한다. 요청·오류 분기(409/402/5xx)와 상태 소유는 각 소비처에 남긴다(cart는 `cartItemId` 키와 `reload`, 상세는 `targetKind:targetId` 키와 `router.refresh`).
- D5 비로그인 사용자도 선택과 총 금액 표시는 할 수 있다. [장바구니]·[구매하기]를 누르면 `redirectToLogin()`으로 같은 상세에 복귀하며, 자동으로 담거나 구매하지 않고 선택도 복원하지 않는다(v4 2.1).
- D6 금액 단위는 **크레딧**이다(첨부 이미지는 '원'이지만 구매는 크레딧 전용, v4 2.1). 버튼 색은 DESIGN.md를 따라 `Button variant="brandOutline"`/`"brand"`(Studio purple)로 한다(이미지는 파랑).

**불명확점**: 없음. R1에서 **확정**: (a) 구매하기 버튼은 DESIGN.md brand purple(이미지의 파랑 아님) (b) 총 금액 영역은 non-sticky, 옵션 목록 바로 아래 (c) 금액 단위는 '크레딧'.

## 2. 범위와 비범위
- 범위: `checkout_market_selection` direct 1..N(migration 1개), direct route body, `MarketItemActions` 선택 UI·하단 합계·2버튼·일괄 담기·바로 구매 Dialog, 공통 확인 Dialog 추출과 cart-view 적용, SQL·계약 테스트 갱신.
- 비범위: cart API와 `add_market_cart_item` 변경, 장바구니 화면 동작 변경(표시부 교체만 한다), `evaluate_market_targets` 규칙 변경, legacy 행, preview 우측 aside 카드(`구매·다운로드 확인` 앵커는 유지), 선택 상태 영속화, 전체 선택 체크박스, 수량.

## 3. DB 변경 — `supabase/migrations/<version>_market_checkout_direct_multi.sql`
`create or replace function public.checkout_market_selection(uuid, text, uuid, jsonb, uuid)`를 **시그니처를 바꾸지 않고** 재정의하고, REVOKE/GRANT(service_role만)를 다시 실행한다. **cart 분기와 5~10단계는 무변경**이다. 바꾸는 곳은 1·3·4단계의 direct 분기뿐이다.
1. 1단계: direct 조건을 `p_item_id is null or jsonb_array_length(p_lines) <> 1`에서 `p_item_id is null`로 바꾼다. 줄 수는 공통 1~50 검사를 그대로 쓴다.
2. 1단계: direct에서 `(targetKind, targetId::uuid)` 중복이 있으면 `INVALID_INPUT`을 돌려준다(cart의 cartItemId 중복 검사와 대칭).
3. 정규화 payload(입력값만 사용): `{mode:'direct', itemId:p_item_id, lines: [{targetKind, targetId(uuid→소문자), expectedCredits, ack(미지정 false)}] ORDER BY targetKind, targetId::uuid}`. 같은 선택을 순서나 대소문자만 바꿔 보내도 같은 payload가 되어 replay된다.
4. 4단계: direct의 `v_work`는 정렬된 `v_payload->'lines'`로 한다. child 주문 생성 순서가 결정적이 된다.
5. 그대로 유지하는 것: 모든 줄의 `itemId = p_item_id`가 아니면 `NOT_FOUND`, 번들+서브상품·PDF+PDF포함HWP이면 `CONFLICTING_SELECTION`, 이어서 `ACK_REQUIRED` → `ALREADY_OWNED` → `PRICE_CHANGED` → 잔액 순으로 검사한다. child 주문은 줄마다 하나씩(`checkout_batch_id` 설정, `idempotency_key` NULL) 만들고, batch mode는 `'direct'`다. 9단계 이후의 실패는 `RAISE`로 전체를 롤백한다.
- 적용: Supabase MCP `apply_migration`으로 단건 적용하고, 적용 직후 `schema_migrations.version`에 맞춰 로컬 파일명을 바꾼다(v4 P1-8). 적용 전에 객체 체크리스트(함수 정의 md5, ACL)를 작성하고, 적용 후 대조해 부분 적용 흔적이 없는지 확인한다.

## 4. HTTP 계약 변경
| API | 변경 |
|---|---|
| `POST /api/market/items/[itemId]/purchase` | 입력 `{lines:[{target:{targetKind:'subproduct',subproductId}\|{targetKind:'bundle',bundleOptionId}, expectedCredits:int 1..2^31-1, acknowledgeNoDiscount?:boolean}] min1 max50, idempotencyKey:uuid}` strict. `runMarketCheckout({mode:'direct', itemId, lines})`. 성공 응답은 기존과 같은 영수증에 잔액 필드를 더하고, 메시지는 `"<상품명> 자료 N건 구매가 완료되었습니다."`로 한다. 오류 분류는 v4 5절 그대로다(422 CONFLICTING_SELECTION·INVALID_INPUT, 409, 402, 404, 503). 옛 단건 body는 400, `assetKind`는 410이다 |
| `POST /api/market/cart/items` 외 cart API | 변경 없음(D2) |
`src/lib/market-checkout-server.ts`는 이미 `lines[]`를 받으므로 변경하지 않는다.

## 5. UI 명세 (`market-item-actions.tsx`, 두 상세 경로 공통)
- **상태**: `selected: Set<'subproduct:<id>'|'bundle:<id>'>`(컴포넌트 로컬). 구매 성공, 담기 완료(1건 이상 성공), `router.refresh()`를 부르는 오류 뒤에 초기화한다.
- **행**: 번들 카드와 개별 행의 `actionSlot`에서 [장바구니 담기]·[구매] 버튼을 없애고, `<label className="grid size-11 …"><Checkbox aria-label="<옵션명> 선택"/></label>`과 `선택` 텍스트를 둔다. 가격 표기(개별가, 차액 업그레이드와 정가 표기, 패키지 이용가)는 유지한다. 보유 행(`owned`, 번들 보유 시 `included`)은 체크박스 없이 기존 다운로드 버튼을 둔다. 번들을 보유하면 개별 섹션을 숨기고, PDF 포함 HWP를 보유하면 PDF 카드를 숨긴다(기존 동작 유지).
- **선택 불가와 사유**(체크박스 disabled, 행 안에 사유 텍스트, 색만으로 전달하지 않음):
  - 가격 ≤ 0 → `가격이 정해지지 않아 선택할 수 없습니다.`
  - 서브상품 `fileCount === 0`, 또는 번들인데 모든 서브상품이 `fileCount === 0` → `파일 준비 중이라 선택할 수 없습니다.`
  - 충돌: 규칙은 아래에 따로 적는다.
- **충돌 규칙**(서버 R-규칙과 같고, 자동 교체는 없다):
  - 번들이 선택되어 있으면 모든 개별 체크박스를 disabled로 두고 `전체 패키지에 포함되어 함께 선택할 수 없습니다. 개별 구매는 전체 패키지 선택을 해제하세요.`를 표시한다.
  - 개별이 1개 이상 선택되어 있으면 번들을 disabled로 두고 `개별 자료를 선택한 상태에서는 전체 패키지를 함께 선택할 수 없습니다.`를 표시한다.
  - PDF↔HWP는 **카테고리 단위**로 막는다. `question_pdf`가 하나라도 선택되면 PDF 포함 `question_hwp` **전부**를 disabled로 두고, PDF 포함 HWP가 하나라도 선택되면 `question_pdf` 전부를 disabled로 둔다. 사유는 `문제(HWP)에 PDF가 포함되어 있어 함께 선택할 수 없습니다.`다. PDF 포함 판정은 `categorySlug==='question_hwp' && fileTypes.some(t => t.code.toLowerCase()==='pdf')`로 한다(서버 `lower(ft.code)='pdf'`와 같음).
  - 사용자가 선택을 해제하면 제약도 즉시 풀린다.
- **부분보유 번들**(`ownedScope==='subproduct'`인 서브상품 존재): 번들 행에 `이미 구매한 개별 자료가 있어도 기보유분 차감 없이 정가로 구매됩니다.`를 표시한다. Dialog에는 ack 체크박스를 둔다.
- **하단 합계 영역**(옵션 섹션 바로 아래, 보관함 안내 문구 위. 첨부 이미지 배치):
  - `border-t border-[var(--studio-border)] pt-4` 안에 한 줄로 `선택 N건`과 `총 금액` `X 크레딧`(`text-lg font-extrabold text-[var(--studio-ink)]`)을 둔다.
  - 그 아래 `grid grid-cols-2 gap-2`에 `[장바구니]`(brandOutline, ShoppingCart 아이콘)와 `[구매하기]`(brand)를 둔다. 둘 다 `h-11 w-full`이다.
  - 선택이 0건이면 두 버튼을 disabled로 두고, `aria-describedby`로 연결한 `구매하거나 담을 옵션을 선택하세요.`를 표시한다.
  - 구매 가능한 옵션이 하나도 없으면(모두 보유 등) 영역 전체를 숨긴다.
- **[장바구니]**: 비로그인은 로그인으로 보낸다. 로그인 상태면 선택 순서대로 `POST /api/market/cart/items`를 순차 호출하고, 버튼에 `담는 중`을 표시하며 전부 disabled로 둔다.
  - 결과 집계: created, 기존 행, `CART_LIMIT`, 기타 실패. 401이 오면 즉시 로그인으로 보낸다.
  - 마지막 성공 응답의 `count`로 `dispatchMarketCartUpdated`를 호출한다.
  - 기존 `장바구니 담기` Dialog에 집계 문구를 표시한다. 예: `3건을 담았습니다. 1건은 이미 장바구니에 있습니다.` / `장바구니가 가득 차(최대 50개) 2건을 담지 못했습니다. 장바구니를 정리한 뒤 다시 담아 주세요.` 버튼은 `계속 둘러보기`와 `장바구니 보기`다.
  - 네트워크 오류가 나면 그 target을 실패로 집계하고 계속 진행한다. 모두 실패하면 toast만 띄우고 선택을 유지한다.
- **[구매하기]**: 비로그인은 로그인으로 보낸다. 로그인 상태면 `fetchBalance()`가 성공한 뒤 Dialog를 열고, 이때 `randomUUID()` 키 1개를 만든다.
  - Dialog 내용: 줄마다 옵션명과 금액, 합계, 보유, 구매 후 잔액을 보여 주고, 부분보유 번들이면 ack 체크박스를 둔다. 확정 버튼 문구는 `X 크레딧 구매`다.
  - 성공: `MarketPurchaseCompleteDialog(payload.message)`, `credit-balance-updated`, `router.refresh()`, 선택 초기화.
  - 409 `PRICE_CHANGED`: `details.items`를 `targetKind:targetId`로 대조해 가격을 갱신하고(이전가는 취소선), 구매 불가 줄은 제외하고 notice를 띄운 뒤 **새 키**를 만든다. 남은 줄이 없으면 Dialog를 닫고 toast와 refresh를 한다.
  - `ACK_REQUIRED`: 해당 줄을 `partiallyOwned`로 표시하고 ack를 해제한 뒤 새 키를 만든다.
  - 402: `details.shortfall`이 숫자면 그대로 쓰고, 아니면 잔액을 다시 조회해 `합계−잔액`으로 계산한다. 부족액과 `크레딧 충전하기`(`/pricing`)를 보여 주고 확정 버튼을 disabled로 둔다.
  - 네트워크 오류와 5xx: **같은 키**로 `같은 요청으로 다시 시도`. retryable 상태에서는 ack 체크박스를 **잠근다**(disabled). 같은 키로 보내는 payload가 바뀌면 409 `IDEMPOTENCY_CONFLICT`가 나기 때문이다.
  - `ALREADY_OWNED`·`CONFLICTING_SELECTION`·`NOT_FOUND`·`IDEMPOTENCY_CONFLICT`·422: Dialog를 닫고 toast, `router.refresh()`, 선택 초기화.
  - 401: 로그인으로 보낸다.
- **공통 Dialog**(D4): props는 `open, title, description, lines[{key,title,optionTitle,expectedCredits,previousCredits}], total, balance, needsAcknowledgement, acknowledged, onAcknowledgedChange, notice, shortfall, chargeHref, chargeHint?, submitting, retryable, onCancel, onConfirm`이다. cart-view의 기존 markup(`cart-view.tsx:502-603`)을 옮기되 문구와 class는 그대로 둔다. 도메인 fetch는 넣지 않는다.
  - 다음 규칙은 **그대로 옮긴다**. `canConfirm = !submitting && shortfall === null && (!needsAcknowledgement || acknowledged)`이고, 오버레이·ESC 닫기는 `!submitting`일 때만 `onCancel`을 부른다(`cart-view.tsx:325-328, 504-507`). ack 체크박스는 `submitting || retryable`이면 disabled다(N6: cart-view에도 같이 적용되는 유일한 동작 변경).
- **정리**: 이번 변경으로 쓰이지 않게 되는 `CreditConfirmationDialog` import, `pendingV2PurchaseIntent`, `addingCartTargetId`, `renderAddToCartButton`, `MARKET_PRIMARY_BUTTON_CLASS`(번들 구매 버튼에서만 쓰임)는 제거한다. `OptionState` 타입은 유지한다(제출 중에는 선택 행을 'processing'으로, 잔액 확인 중에는 'checking'으로 표시한다).
- **규칙**: Studio 토큰과 기존 primitive(Button, Checkbox, Dialog)를 쓰고 raw hex를 새로 쓰지 않는다. 터치 영역은 44px 이상, 320px에서 가로 넘침이 없어야 하고, 키보드로 선택→버튼→Dialog→확정까지 할 수 있어야 한다. 기존 사용자 미커밋 변경(`git diff` 상 market-item-actions.tsx 등)은 되돌리지 않고 그 위에 수정한다.

## 6. 단계별 작업과 검증 기준
각 단계는 독립 검증 에이전트의 OK를 받은 뒤 다음 단계로 간다(AGENTS 작업 Loop).

**S0 기준선**
- 작업: 아래 명령의 결과를 기록한다.
  - `git diff --stat`, 대상 파일별 `git diff | shasum`
  - `node --test tests/market-*.test.mjs tests/studio-adoption-contract.test.mjs 2>&1 | tail -5`(pass/fail 수)
  - `npx tsc --noEmit`
  - untracked 대상 파일(`git status --porcelain | grep '^??'`, 예: `src/app/(solvook)/cart/_components/cart-view.tsx`, `src/components/market/market-cart-indicator.tsx`, `src/app/api/market/cart/**`)은 diff가 없으므로 파일 자체의 `shasum -a 256`을 기록하고, 사본을 `.omc/research/multiselect-s0/`에 저장한다(S3·S5 비교용).
- **선행 조건**: `grep -rn "MARKET_CART_ENABLED\|market-cart-flag\|isMarketCartEnabled" src tests` 결과가 0건이다. 1건이라도 있으면 플래그 제거 작업이 끝나지 않은 것이므로 중단하고 보고한다.
- 검증: 기록이 남아 있다. 이후 단계의 "새 실패 0"은 이 기준으로 판정한다.

**S1 migration + SQL 테스트**
- 작업: 3절 migration을 작성한다. `supabase/tests/market_checkout_rpc.test.sql`을 갱신한다(7절 SQL).
- 검증:
  - ① `apply_migration` 후 `select version,name from supabase_migrations.schema_migrations where name='market_checkout_direct_multi'`의 version이 로컬 파일명과 같다.
  - ② `select prosecdef, proconfig, provolatile, proacl from pg_proc where proname='checkout_market_selection'` → `t`, `{search_path=public, pg_temp}`, `v`이고, authenticated/anon EXECUTE가 없다. `has_function_privilege('authenticated','public.checkout_market_selection(uuid,text,uuid,jsonb,uuid)','execute')=false`.
  - ③ 테스트 SQL을 원격에서 `begin … rollback`으로 실행한 결과가 all passed이고, `cart-test-` fixture 잔존이 0이다.
  - ④ 같은 migration을 `execute_sql`로 한 번 더 실행해도 오류가 0이다(재실행 안전).
  - ⑤ `pg_get_functiondef` diff 결과 cart 분기 본문이 변경 전과 같다.

**S2 direct route + client body 전환**
- 작업: 4절 schema와 `lines` 매핑, 성공 메시지. **같은 단계에서** `market-item-actions.tsx`의 현 단건 구매 요청 body를 `{lines:[{target, expectedCredits, acknowledgeNoDiscount}], idempotencyKey}`(1줄)로 바꾼다. route만 바뀌어 기존 UI가 400을 받는 중간 상태를 만들지 않는다(N1). 다중 선택 UI는 S4에서 한다.
- 검증:
  - `npx tsc --noEmit` exit 0.
  - 비로그인 `curl -s -o /dev/null -w '%{http_code}' -X POST localhost:4000/api/market/items/<uuid>/purchase -H 'content-type: application/json' -d '{}'` → 401.
  - 계약 테스트(7절)가 통과한다.
  - `market-v2-purchase-entitlement-contract`(route regex 갱신분)와 `market-item-detail-ui-contract`가 통과한다.
  - (로그인 필요분, 권장) 옛 `{target,…}` body → 400이고 차감 0. 상세 화면의 기존 행 구매 버튼이 1줄 `lines` body로 200(네트워크 탭 확인). `lines` 2건을 직접 보내면 200이고 `data.orders.length===2`.

**S3 공통 Dialog 추출 + cart-view 적용**
- 작업: D4 컴포넌트를 만들고 cart-view의 Dialog markup을 이것으로 교체한다. 상태와 핸들러는 변경하지 않는다.
- 검증:
  - cart-view.tsx는 untracked이므로 S0 사본과 비교한다. `diff .omc/research/multiselect-s0/cart-view.tsx 'src/app/(solvook)/cart/_components/cart-view.tsx'`에 Dialog markup 교체, import, ack 잠금(N6) 외의 변경이 없다.
  - tsc와 eslint(대상 파일) exit 0.
  - 브라우저 `/cart`에서 Dialog의 줄, 합계, ack, 402 CTA가 교체 전과 같다(스크린샷 비교).

**S4 상세 선택 UI**
- 작업: 5절 전부.
- 검증:
  - 계약 테스트와 tsc/eslint가 통과한다.
  - 브라우저에서 두 경로(`/market/<slug>/items/<id>`, `/preview/solvook-concept/boards/<slug>/items/<id>`)를 각각 확인한다.
    - (a) 선택에 따라 총 금액이 즉시 합산된다. PDF 보유자의 HWP는 차액으로 합산된다.
    - (b) 번들↔개별, PDF↔PDF포함HWP 선택 시 상대 체크박스가 disabled가 되고 사유가 보인다. 해제하면 복구된다.
    - (c) 보유 행에 다운로드 버튼이 있다.
    - (d) 비로그인이 버튼을 누르면 `/login?next=<상세>`로 가고, 로그인 후 상세로 돌아오며 자동 담기나 구매는 없다.
    - (e) 3건 담기 → Dialog 집계가 표시되고 헤더 배지가 +3이 된다. 다시 담으면 '이미 있음'이 표시되고 배지는 그대로다. 49행 상태에서 2건을 담으면 1건 성공, 1건 한도로 표시된다.
    - (f) 2건 구매 → 네트워크 탭의 body가 `lines` 2건과 키 1개이고, 완료 Dialog가 뜨고 두 행이 다운로드로 바뀐다. `market_checkout_batches`에 mode `direct` 1행, child 주문 2행, 장바구니 행 수는 전후 같다(SQL).
    - (g) DevTools offline → 확정 → online → `같은 요청으로 다시 시도` 시 두 요청의 `idempotencyKey`가 같고 차감은 1회다.
    - (h) 관리자가 가격을 바꾼 뒤 확정하면 409가 나고 새 가격으로 Dialog가 갱신되며 키가 바뀐다.
    - (i) 잔액이 부족하면 부족액과 충전 CTA가 보인다.
    - (j) 320/768/1440px에서 `document.documentElement.scrollWidth <= innerWidth`이고, 체크박스와 버튼의 `getBoundingClientRect()`가 44px 이상이다. 키보드만으로 (f)를 완료할 수 있다.

**S5 통합**
- 작업: 없음(재검증만).
- 검증:
  - `npm run lint`, `npm run build`가 S0 대비 새 실패 0이다.
  - `node --test` 새 실패 0.
  - `git diff --stat`이 8절 파일 범위 안에 있고, S0 이전의 사용자 변경이 보존되어 있다(tracked 파일은 해당 hunk 유지, untracked 파일은 S0 사본과 `diff`해 계획된 변경 외 차이 없음).
  - (권장) `supabase/tests/checkout_concurrency.sh`의 T09/T13/T14 재실행 PASS.

## 7. 테스트 목록
- **SQL `supabase/tests/market_checkout_rpc.test.sql`**
  - 기존 assert 수정: `direct with 2 lines`(INVALID_INPUT) → 이제 유효하므로 삭제하고 아래 D-M1로 대체한다. `3.2 normalized direct payload` → `lines` 형태로 바꾼다.
  - 기존의 단건 성공, replay, T10, NOT_FOUND 위조, R1~R5, ACK assert는 1줄 배열 입력으로 그대로 통과해야 한다.
  - 신규 assert:
    - D-M1: 서브상품 2건 성공이면 child 2, 줄별 `charged_credits`, 줄별 `credit_consumptions` 합 = `total_credits`, 권한 2, batch mode `direct`, cart 무변경.
    - D-M2: 역순·대문자로 같은 키를 보내면 replay되고 쓰기 0.
    - D-M3: 같은 target 2줄 → `INVALID_INPUT`. direct 51줄 → `INVALID_INPUT`. 줄별 `expectedCredits`는 유효하지만 합계가 2147483647을 넘는 direct 2줄 → `INVALID_INPUT`. 세 경우 모두 쓰기 0.
    - D-M4: 번들+서브상품, PDF+PDF포함HWP(순서 2가지) → `CONFLICTING_SELECTION`, 쓰기 0.
    - D-M5: 한 줄의 가격 불일치 → `PRICE_CHANGED`(두 줄 모두 items 포함), 쓰기 0.
    - D-M6: 한 줄 보유 → `ALREADY_OWNED`, 쓰기 0.
    - D-M7: 다른 상품의 target 포함 → `NOT_FOUND`.
    - D-M8: 합계만 잔액 초과 → `INSUFFICIENT_CREDITS`(balance, shortfall).
    - D-M9: 두 번째 child의 entitlement INSERT에 실패를 주입하면(fixture 한정 임시 trigger) 원장, 잔액, 주문, 권한, batch가 전후 동일하다(T15 direct 판).
    - D-M10: PDF 보유자가 HWP(차액)+다른 서브상품을 사면 HWP child `charged_credits` = 차액, `upgradeBaseOrderId`가 기록된다.
- **Node 계약 테스트 갱신**(제거된 행 버튼을 전제로 한 assert만 새 UI 기준으로 바꾼다)
  - `market-item-detail-ui-contract`: `전체 패키지 구매`·`이 자료만 구매` 대신 `구매하기`·`장바구니`·`총 금액`을 확인한다. `setPurchaseCompleteMessage(payload.message` 패턴은 유지한다.
  - `market-v2-detail-library-contract`: `이 자료만 구매`, `MARKET_PRIMARY_BUTTON_CLASS`, `bg-indigo-600` 계열, `setPendingV2PurchaseIntent(null)` → 새 UI 식별자로 바꾼다.
  - `market-v2-purchase-entitlement-contract`: route regex를 `lines: z.array(` + `.min(1).max(50)` + `idempotencyKey` strict로 바꾼다.
  - `market-item-detail-ui-contract:146`: `pendingV2PurchaseIntent.title` regex를 새 완료 메시지 fallback 식으로 바꾼다(`payload.message ||` 유지).
  - `market-v2-detail-library-contract:58`(`MARKET_PRIMARY_BUTTON_CLASS`)과 `:69-71`(`bg-indigo-600`·`hover:bg-indigo-700`·`active:bg-indigo-800`): 제거되는 식별자를 하단 버튼(`variant="brand"`/`"brandOutline"`, `grid-cols-2`) assert로 바꾼다.
  - `market-v2-purchase-idempotency-contract`·`market-v2-purchase-entitlement-contract`·`market-refund-credit-snapshot-contract`: 지금은 `20260930024829` 파일만 읽는다. **새 migration 파일도 읽어** 같은 가드를 검사하게 한다. 새 파일은 함수 전체를 재정의하므로 `-- 3. 멱등 확인`·`-- 4. 대상 확정` 표지 주석을 유지하고, 다음을 확인한다: 멱등 확인이 4단계와 `consume_credits(`보다 앞, `when raise_exception … 'P0402' … else raise;` 핸들러, `when others` 없음, `credit_consumptions`·`checkout_batch_id` 기록 형식.
- **신규 `tests/market-detail-multiselect-contract.test.mjs`**
  - 상세가 `/api/market/cart/items`를 target별로 호출한다(배열 body 없음).
  - direct body에 `lines`와 Dialog 단위 `crypto.randomUUID()`가 있다.
  - 충돌 사유 문구 3종이 있다.
  - `grid-cols-2`와 `variant="brand"`·`variant="brandOutline"`를 쓴다.
  - 두 상세 경로가 모두 `MarketItemActions`를 렌더한다.
  - `market-checkout-confirm-dialog`를 cart-view와 상세가 함께 import한다.
  - 새 raw hex가 없다(diff 기준).

## 8. 변경 파일(예상)
- DB: `supabase/migrations/<version>_market_checkout_direct_multi.sql`(신규), `supabase/tests/market_checkout_rpc.test.sql`
- 코드: `src/app/api/market/items/[itemId]/purchase/route.ts`, `src/components/market/market-checkout-confirm-dialog.tsx`(신규), `src/app/(solvook)/cart/_components/cart-view.tsx`(Dialog markup 교체와 N6 ack 잠금만), `src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx`
- 테스트: 7절의 갱신 5개(detail-ui, detail-library, entitlement, idempotency, refund-credit-snapshot)와 신규 1개. page.tsx 두 개와 `market-material-detail.tsx`는 변경하지 않는다.

## 9. 위험과 대응
| 위험 | 대응 |
|---|---|
| 클라이언트 표시가와 서버 차감가가 다르다(DTO 조건과 SQL 조건의 미세한 차이, 예: 번들 파일이 비활성 서브상품에만 있는 경우) | 차감은 서버만 한다. 불일치는 409로 잡고 최신가로 재확인한다(S4-h). DTO의 R5 규칙은 SQL과 같은 조건을 쓴다(D-M10과 브라우저 (a)로 대조) |
| payload 형태 변경으로 기존 키 replay가 깨진다 | 개발 DB batch 0행이라 영향이 없다. 적용 직전 `select count(*) from market_checkout_batches where mode='direct'`를 다시 확인하고, 0이 아니면 중단하고 보고한다 |
| 공통 Dialog 추출로 검증된 `/cart`가 회귀한다 | markup 이동만 하고 상태와 핸들러는 무변경이다. diff 범위 검사와 스크린샷 비교(S3)로 확인한다 |
| 순차 담기 중 일부만 성공한다 | 의도된 동작이다. target별 집계를 Dialog로 안내하고, 담기는 금전 영향이 없다 |
| 두 탭이나 다른 기기에서 같은 target을 동시에 구매한다 | 기존 entitlement UNIQUE와 profile 잠금으로 막힌다(v4 T13/T14). S5에서 권장 재실행 |
| 사용자 미커밋 변경이 덮어써진다 | S0에 hunk를 기록하고 S5에서 보존을 확인한다. `git checkout`/`restore`는 금지한다 |
| 320px에서 하단 2버튼이 넘친다 | `grid-cols-2`, `w-full`, 짧은 문구(`장바구니`/`구매하기`)를 쓰고 S4-j에서 측정한다 |

## 10. 검증 기록
| 회차 | 대상 | 검증자 | 판정 | 근거·보완 사항 |
|---|---|---|---|---|
| R1 | 초안 196줄 | 독립 검증(팀 리드 전달) | OK(차단 없음) → 비차단 N1~N8 반영 | N1 client body 전환을 S2로 이동(중간 400 금지). N2 3절 "cart 분기와 5~10단계 무변경". N3 PDF↔HWP 카테고리 단위 비활성, code 소문자 비교. N4 S0에 untracked 파일 sha256, 플래그 grep 0건 선행 조건. N5 계약 테스트 갱신 목록 추가(idempotency·entitlement·refund-snapshot의 새 migration 가드, detail-ui:146, detail-library:58·69-71). N6 retryable 시 ack 잠금. N7 direct 51줄·합계 overflow `INVALID_INPUT`. N8 Dialog 추출 시 canConfirm·오버레이 닫기 조건 그대로 이동. 작성자 제안 (a) brand purple (b) non-sticky (c) '크레딧' 확정 |
| R2 | N1~N8 반영본 197줄 | 독립 검증 | OK | 사본은 저장소 밖(scratchpad)에 둘 것(비차단) |
| 구현 | S0~S5 + migration `20260930080434_market_checkout_direct_multi.sql` | 적용 전·후 독립 검증 | OK | 원격 begin…rollback 테스트 통과·흔적 0, 이력 97, 함수 md5 일치. 비차단 N1(stale 선택 정리)·N2(계약 assert) 반영. 커밋 c5e6f34 |
| R3 | 11절 추가(체크박스 좌상단·로그인 선행·복귀) | 독립 검증 | OK | 비차단 N1(비보유 행 기본 버튼 생성 금지)·N2(기준선 c5e6f34)·N3(비로그인 안내 교체)를 구현에 반영 |
| 11절 구현 | market-item-actions.tsx·계약 테스트 2개 | 독립 검증 | OK | tsc·eslint·build 통과, node 956건 fail 39(새 실패 0), 4010 비로그인 상세 두 경로 확인. 실제 로그인 복귀·320px·키보드는 미실행(사용자 확인) |
| R4 | 12절 추가(장바구니 상세 링크·로그인 복귀 자동 담기) | 독립 검증 | OK | 비차단 N1(StrictMode cleanup 취소 플래그 금지)·N2(menu 순차 조회)·N3(의도 모듈 순수화)를 구현에 반영 |
| 12절 구현 | market-cart-server.ts·cart-view.tsx·market-item-actions.tsx·market-cart-intent.ts·테스트 3개 | 독립 검증 | OK | 링크 조건=상세 404 조건, useEffectEvent는 React 19.2 정식 API, 구매 자동 실행 0, tsc·eslint·build 통과, node 967건 fail 39(새 실패 0). 로그인 브라우저 시나리오는 미실행(사용자 확인) |

## 11. 추가 요청(2026-10-01)
요청: ① 선택 체크박스를 카드 **왼쪽 상단**으로 ② 장바구니 담기 전에 로그인 ③ 로그인 뒤 그 상품 상세로 복귀. 변경 파일은 `market-item-actions.tsx`(FileOptionRow 포함)와 계약 테스트뿐이다. DB·API·`use-login-redirect`·로그인 페이지는 바꾸지 않는다. 5절·D5는 아래 결정으로 갈음한다.

**분석(사실)**
- 지금 선택 컨트롤은 카드 footer의 `actionSlot`(가격 오른쪽 아래)에 있다(`renderOptionSelectControl` 807행, 호출 933·985행). `FileOptionRow`는 `actionSlot ?? 기본 Button`이라 slot을 비우면 기본 버튼이 생긴다(343-366행).
- 하단 두 버튼은 `disabled={selectedOptions.length === 0 || isBusy}`라 비로그인 0건이면 눌러도 동작하지 않는다(1009·1019행). 핸들러는 이미 `!isLoggedIn`을 길이 검사보다 먼저 본다(533·607행).
- 복귀 경로는 이미 있다. `useLoginRedirect`가 경로+쿼리를 `/login?next=`로 보내고, 이메일 로그인(`login/page.tsx:64-68`)과 OAuth callback(`route.ts:98`)이 `next`로 이동하며 `login=success`를 붙인다. `LoginCompleteDialog`(`template.tsx:21`)가 이 쿼리로 완료 Dialog를 띄우고 확인 시 쿼리를 지운다. 두 상세 경로 모두 `MarketItemActions` 공유.

**결정**
- D7 **체크박스 위치**: 카드 **맨 위 첫 줄 왼쪽**에 `☐ 선택` 행을 둔다. 아이콘·제목·우상단 '미구매' 배지 줄은 그 아래에서 그대로 둔다. 번들 카드는 '추천' 배지 줄 위에 둔다. 사유 문구는 같은 행 아래에 왼쪽 정렬(`text-left text-xs leading-5`)로 넣고 `aria-describedby`를 유지한다. 근거: 제목 앞 열에 넣으면 320px에서 아이콘·제목·배지와 경쟁하고, 모서리 절대배치는 44px 터치 영역과 겹친다.
- D8 **구현 형태**: `renderOptionSelectControl`은 `flex w-full flex-col items-start gap-1`(우측정렬·`sm:w-auto sm:max-w-64` 제거)로 바꾸고, `FileOptionRow`에 `selectSlot` prop을 추가해 header 위에 렌더한다. `selectSlot`이 있으면 footer는 가격만 남기고 기본 Button을 만들지 않는다. 보유 행은 `actionSlot`(다운로드)을 그대로 쓴다. `label`(min-h-11, 체크박스 `size-11` 셀)·`aria-label="<옵션명> 선택"`·disabled 상태는 유지한다. 새 class는 Studio 토큰·기존 class만 쓰고 raw hex·임의 radius를 쓰지 않는다.
- D9 **로그인 선행**: 비로그인은 선택 건수와 무관하게 [장바구니]·[구매하기]가 **활성**이고, 누르면 즉시 `redirectToLogin()`한다. `disabled={(isLoggedIn && selectedOptions.length === 0) || isBusy}`. 구매하기도 같은 규칙이다. 근거: 사용자가 "구매하려면 아이디가 있어야"라고 했고, 두 버튼이 같은 로그인 전제를 공유하며, 핸들러가 이미 같은 순서로 구현돼 있다.
- D10 **비로그인 체크박스는 계속 허용**한다(체크 시 로그인 요구 안 함). 근거: 요청은 '담기할 때'로 한정됐고, 체크는 금액 확인용 탐색이며, 선택이 복원되지 않으므로 체크 단계에서 로그인을 강제할 이유가 없다. 단순성 우선(추가 코드 0).
- D11 **문구**: 비로그인 버튼은 `로그인 후 담기`·`로그인 후 구매`(아이콘 유지), 안내는 `담기·구매는 로그인이 필요합니다. 로그인하면 이 페이지로 돌아옵니다.`를 `aria-describedby`로 연결한다. 로그인 상태 문구(`장바구니`·`구매하기`·`구매하거나 담을 옵션을 선택하세요.`)는 그대로다. 320px에서 버튼 문구가 넘치면 `h-auto min-h-11 whitespace-normal`로 줄바꿈을 허용한다(아이콘은 빼지 않는다).
- D12 **복귀**: 선택 복원·자동 담기는 하지 않는다(기존 결정 유지). **사용자 확인 필요(비차단)**: 요청은 "상품페이지로 돌아가게"까지이므로 이대로 진행하되, 돌아온 뒤 선택이 비어 있다는 점을 보고에 알리고 원하면 후속으로 sessionStorage 복원을 제안한다.

**작업 단계와 검증**
1. **A 위치 이동**(D7·D8): 위 결정대로 수정. 검증: `npx tsc --noEmit` exit 0, `npx eslint 'src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx'` exit 0. 브라우저(미구매·보유·비활성 사유·번들 카드): 체크박스가 카드 좌상단, 배지는 우상단 유지, 보유 행은 다운로드 버튼 유지, 비활성 사유가 행 아래 왼쪽에 보인다. 320/768/1440px에서 `document.documentElement.scrollWidth <= innerWidth`이고 체크박스 label의 `getBoundingClientRect()` 높이 ≥ 44. Tab→Space로 선택되고 label 글자 클릭으로도 토글된다.
2. **B 로그인 선행**(D9~D11): 검증(비로그인 브라우저): 선택 0건에서 두 버튼이 활성이며 각각 클릭하면 `/login?next=<인코딩된 상세 경로+쿼리>`로 이동한다. 1건 선택 후에도 동일하고, `POST /api/market/cart/items` 요청이 네트워크 탭에 0건이다. 로그인 상태에서는 0건이면 두 버튼이 disabled이고 기존 문구가 보인다.
3. **C 복귀 확인**(코드 변경 없음): 이메일 로그인과 Kakao OAuth 각각 ① 상세(`/market/<slug>/items/<id>?subject=…`와 preview 경로 1곳)에서 [장바구니] ② 로그인 완료 ③ 주소가 `next` 경로+기존 쿼리+`login=success`와 같고 404·빈 화면이 없다 ④ '로그인 완료' Dialog 확인 후 `login` 쿼리만 제거되고 기존 쿼리는 남는다 ⑤ 선택은 비어 있고 장바구니 수(SQL `select count(*) from market_cart_items where user_id=…`)가 전후 같다. 테스트용 Kakao 계정이 없으면 OAuth는 `/login` 페이지의 `redirectTo`에 `next`가 실리는지만 확인하고 '실로그인 미검증'으로 기록한다.
4. **D 테스트 갱신**: 아래 목록 반영 후 `node --test tests/market-*.test.mjs tests/auth-login-complete-dialog-contract.test.mjs 2>&1 | tail -5`가 S0 대비 새 실패 0, `npm run lint` 새 실패 0.

**테스트 갱신**
- `market-detail-multiselect-contract`(신규 assert): 선택 행이 소스상 아이콘·제목보다 앞에 온다(`selectSlot` 렌더 위치 < `{icon}`, 번들은 `renderOptionSelectControl(`bundle:` < `MarketOptionIcon kind="bundle"`). `renderOptionSelectControl`에 `items-end`·`text-right`가 없다. `FileOptionRow`에 `selectSlot`이 있다. 하단 버튼 disabled가 `isLoggedIn && selectedOptions.length === 0`을 포함한다. `로그인 후 담기`·`로그인 후 구매` 문구가 있다. 두 핸들러에서 `!isLoggedIn`이 `selectedOptions.length === 0`보다 앞선다. 기존 `구매하거나 담을 옵션을 선택하세요.`·`variant="brand*"`·`grid-cols-2` assert는 유지한다.
- `market-v2-detail-library-contract:47-48`(`renderOptionSelectControl(`…`)` 호출 regex)과 `market-item-detail-ui-contract:110`(`aria-label=… 선택`)은 호출 식·aria-label을 유지하므로 수정하지 않는다. 깨지면 식별자를 되돌리지 말고 assert를 새 구조로 고친다.
- `auth-login-complete-dialog-contract`: 변경 없음. 복귀(`next`+`login=success`)는 코드 변경이 없으므로 3단계 브라우저 증거로만 검증한다.

**위험**: ① 비로그인 0건 클릭으로 로그인 이동이 잦아 보일 수 있다(안내 문구 D11로 완화). ② `redirectToLogin` toast가 error 스타일이다(기존 동작이라 유지, 거슬리면 메시지 인자만 후속 조정). ③ 선택 복원이 없어 돌아오면 다시 선택해야 한다(D12). ④ 320px 버튼 줄바꿈(D11 대안 지정). ⑤ 회원가입 링크 경유 시 `next` 유지 여부는 이번 범위 밖이라 미확인이다. ⑥ 기존 사용자 변경 보존: 파일은 커밋 상태(c5e6f34)이며 `git checkout/restore`는 쓰지 않는다.

## 12. 추가 요청 2(2026-10-01)
요청: ① 장바구니 행의 상품명을 상세 링크로 ② 비로그인 담기 → 로그인 → 복귀 시 담기 완료 팝업. **사용자 결정으로 v4 2.1-1("로그인 뒤 다시 담기 확정")과 11절 D12("자동 담기 없음")를 *담기에 한해* 변경한다.** 구매 자동 실행 금지는 유지한다. 11절 D5·D12의 해당 문장은 이 절이 갈음한다.

**분석(사실)**
- `MarketCartItem`에는 `itemId`·`workspaceSubject`가 있으나 **상세 경로의 board slug가 없다**. `evaluate_market_targets`의 `c.slug`는 서브상품 카테고리 slug라 board slug가 아니다. 상세 경로의 slug는 `market_menu_entries.slug`이고(`getVisibleMarketMenuEntryBySlugForWorkspace`), 상세 page는 `item.menu_entry_id === category.id`가 아니면 404다. 따라서 서버에서 `market_items.menu_entry_id → market_menu_entries.slug`를 조회해야 한다.
- 목록 행·카드는 `/preview/solvook-concept/boards/${slug}/items/${itemId}?subject=${subject}`를 쓴다(`market-item-list-row.tsx:38`, `market-item-card.tsx:59`). cart(`(solvook)/cart`)도 solvook 영역이므로 같은 경로를 쓴다. 기존 2곳은 건드리지 않는다.
- 상세는 item이 `published`·`is_active`·미삭제이고 menu entry가 `is_visible`·`is_active`·미삭제이며 둘의 `workspace_subject`가 같아야 열린다.
- 담기 Dialog는 `cartAddedMessage` 상태(`market-item-actions.tsx` 408·1159행)로 열고, 담기 루프는 `addSelectedToCart` 안에 있다. `LoginCompleteDialog`(`template.tsx`)는 `login=success`일 때 열리고 확인 시 `login` 쿼리를 지운다. 로그인 복귀 시 두 Dialog가 겹칠 수 있다.
- node 24는 `.ts`를 직접 import하므로 순수 함수 모듈은 단위 테스트가 가능하다(`tests/admin-question-pagination.test.mjs` 선례). `market-cart-server.ts`는 `server-only`라 소스 계약 테스트로 검증한다.

**결정**
- D13 **링크 생성은 서버**: `getMarketCartView`가 `MarketCartItem.detailHref: string | null`을 만든다. `rows.length > 0`일 때만 쿼리 2개(`market_items` `.in('id', itemIds)` + `status='published'`·`is_active`·`deleted_at is null`, `market_menu_entries` `.in('id', menuIds)` + `is_visible`·`is_active`·`deleted_at is null`)를 `Promise.all`/순차로 호출하고, subject가 같을 때만 경로를 만든다. slug를 코드에 넣지 않고, DB·migration은 바꾸지 않는다. 응답 `GET /api/market/cart`에는 자동 포함된다.
- D14 **링크 표시**: `detailHref`가 있으면 상품명을 `Link`(목록 행과 같은 `text-[var(--studio-ink)] hover:text-[var(--studio-primary)] focus-visible:ring-2` 토큰)로, 없으면 지금처럼 텍스트로 둔다. 옵션명은 텍스트 그대로다. `ALREADY_OWNED`는 상세가 정상이라 링크를 유지하고, 비게시·삭제·`NOT_FOUND`·subject 불일치는 `detailHref=null`이라 기존 사유 문구(`현재 판매하지 않는 자료…`)가 근거다. 체크박스·삭제 버튼과 겹치지 않게 `after:absolute` 방식은 쓰지 않는다. 텍스트 링크 높이는 `leading-6`(24px) 이상이다.
- D15 **담기 의도 저장**: 신규 `src/lib/market-cart-intent.ts`(client-safe 순수 모듈, storage 주입 가능). sessionStorage 키 `market-cart-intent:v1`, 값 `{action:'cart'|'purchase', itemId, workspaceSubject, targets:[{targetKind,targetId}] (1..50), createdAt}`. 가격·제목은 저장하지 않는다. 비로그인에서 [로그인 후 담기]·[로그인 후 구매]를 누를 때 선택이 1건 이상이면 `redirectToLogin()` 직전에 저장하고, 0건이면 기존 값을 지우고 저장하지 않는다. storage 접근 실패는 try/catch로 무시하고 로그인 이동은 그대로 한다(기존 동작으로 퇴화).
- D16 **소비 규칙**(상세 컴포넌트 마운트 시 1회, `useRef` 가드): 로그인 상태에서만 동작한다. 읽는 즉시 storage에서 **삭제**한다(새로고침·StrictMode 이중 실행 방지). 실행 조건은 모두 만족해야 한다: `login=success`가 URL에 있음, `itemId`·`workspaceSubject` 일치, 생성 후 30분 이내(`TTL=30분`, 근거: 로그인 폼 작성·OAuth 왕복에 충분하고 공용 PC 잔존 위험을 줄임), 형식 유효. 하나라도 어긋나면 삭제만 하고 아무것도 하지 않는다. 로그아웃 상태의 마운트는 storage를 건드리지 않는다. `login=success`를 요구하는 이유는 '방금 완료된 로그인'의 증거이기 때문이다(다른 계정이 나중에 같은 탭에서 상세를 열어 우연히 담는 일을 막는다).
- D17 **담기 실행**: `addSelectedToCart`의 루프를 `addTargetsToCart(options)`로 추출해 선택 담기와 의도 소비가 공유한다(집계 문구·`dispatchMarketCartUpdated`·`CART_LIMIT` 처리 동일). 대상은 현재 `purchaseOptions` 중 선택 가능한 것(`unavailableReason===null`)만 쓴다. 보유·판매중지로 바뀐 대상은 제외하고, 전부 제외되면 Dialog 없이 `toast.error('선택했던 자료를 지금은 담을 수 없습니다.')`만 한다. 의도 소비 중 401은 로그인으로 다시 보내지 않고 toast만 한다(무한 이동 방지).
- D18 **Dialog 순서**: 담기는 복귀 즉시 실행(헤더 배지가 바로 갱신)하되, 담기 완료 Dialog는 `LoginCompleteDialog`가 닫힌 뒤(`login` 쿼리 없음)에 연다. `open={cartAddedMessage !== null && searchParams.get('login') !== 'success'}`로 한다. 두 모달이 겹치지 않고, 확인을 누르면 이어서 '계속 둘러보기/장바구니 보기'가 뜬다.
- D19 **[로그인 후 구매]**: 자동 실행하지 않는다(금전 차감, 확인 Dialog·`idempotencyKey` 생성은 사용자 클릭 뒤여야 한다). 복귀 시 **선택 체크 상태만 복원**한다(`action:'purchase'`, 같은 조건·같은 소비 규칙). 근거: 같은 저장 구조에서 코드 몇 줄이고 금전 영향이 없으며, 사용자는 [구매하기]를 다시 눌러야 한다. 불필요하다고 판단되면 이 결정만 빼도 나머지에 영향이 없다.
- D20 다른 계정·다른 탭: sessionStorage는 탭 단위라 다른 탭은 소비하지 못한다. 같은 탭에서 다른 계정으로 로그인해도 D16 조건을 만족하면 그 계정 장바구니에 담긴다(익명 의도라 계정 구분이 불가능하며, 담기는 금전 영향이 없고 TTL 30분과 `login=success` 조건으로 한정). OAuth(Kakao)는 같은 탭 이동이므로 sessionStorage가 유지된다(3단계에서 확인).

**작업 단계와 검증**(각 단계 후 독립 검증자 OK)
1. **링크(D13·D14)** — `market-cart-server.ts`, `cart-view.tsx`. 검증: `npx tsc --noEmit`·`npx eslint <두 파일>` exit 0. 로그인 브라우저에서 `fetch('/api/market/cart').then(r=>r.json())`의 모든 행에 `detailHref`(문자열 또는 null)가 있고, SQL로 같은 item의 `menu_entry.slug`와 일치한다. `/cart`에서 상품명 클릭 → 해당 상세가 열리고(제목 일치), Tab+Enter로도 열린다. fixture 상품 1건을 임시 비게시로 바꾼 행(복구 필수)은 링크가 없고 사유 문구가 보인다. 보유 행은 링크가 있다.
2. **의도 모듈(D15·D16)** — `src/lib/market-cart-intent.ts`와 `tests/market-cart-intent.test.mjs`. 검증: `node --test tests/market-cart-intent.test.mjs` 통과(저장 후 take는 1회만 값, 두 번째는 null이고 삭제됨 / 31분 경과는 null / 깨진 JSON·51건·잘못된 kind는 null / storage가 throw해도 예외 없음 / 빈 targets는 저장 안 함).
3. **상세 연결(D16~D19)** — `market-item-actions.tsx`(저장 호출, 마운트 소비 effect, `addTargetsToCart` 추출, Dialog open 조건, 531행 주석 갱신). 검증: tsc·eslint exit 0, 계약 테스트 통과, 아래 브라우저 시나리오(dev 4000, 두 상세 경로 중 각 1곳 이상):
   - (a) 비로그인 2건 선택 → [로그인 후 담기] → `sessionStorage['market-cart-intent:v1']` 존재 → 이메일 로그인 → 복귀 URL = 기존 경로+쿼리+`login=success`. 로그인 완료 Dialog가 먼저 보이고 네트워크에 `POST /api/market/cart/items` 2건이 있다. 확인을 누르면 `2건을 담았습니다.` Dialog(계속 둘러보기/장바구니 보기)가 뜨고 헤더 배지가 +2다. storage 키는 null이다. SQL `market_cart_items` 행이 +2다. '장바구니 보기' → `/cart`에 2건이 있고 상품명 링크로 다시 상세에 돌아온다.
   - (b) 새로고침·뒤로가기·`login=success` 제거 후 재방문: POST 추가 0건, Dialog 없음. 같은 선택을 다시 [장바구니]로 담으면 `이미 장바구니에 있습니다.`다.
   - (c) 0건에서 [로그인 후 담기] → 로그인 → 복귀: storage 키가 없고 POST 0건이며 Dialog가 뜨지 않는다.
   - (d) [로그인 후 구매] 2건 → 로그인 → 복귀: `POST …/purchase` 0건, 체크박스 2건 복원, 확인 Dialog 없음, 크레딧 잔액 불변.
   - (e) createdAt을 31분 전으로 수정하고 로그인 → 담기 0건. 다른 itemId로 저장된 값을 가진 채 다른 상세에 로그인 복귀 → 담기 0건, 키 삭제.
   - (f) Kakao OAuth(테스트 계정이 있을 때)로 (a)를 반복한다. 없으면 `/login`의 `redirectTo`에 `next`가 실리는지만 확인하고 '실로그인 미검증'으로 기록한다. 새 탭에서 상세를 열면 담기가 일어나지 않는다.
   - (g) 대상 중 1건을 로그인 계정이 이미 보유(fixture)한 경우 보유분은 제외되고 나머지만 담긴다. 장바구니 49행 상태에서 2건 → `1건 담음 + 한도 안내`. DevTools에서 storage 차단 시에도 로그인 이동은 된다.
4. **통합** — `node --test tests/market-*.test.mjs tests/auth-login-complete-dialog-contract.test.mjs` S0 대비 새 실패 0, `npm run lint` 새 실패 0, `npm run build` 통과. 사용자 기존 변경 보존, `git checkout/restore` 금지.

**테스트 갱신**
- 신규 `tests/market-cart-intent.test.mjs`(2단계 단위), 신규 `tests/market-cart-detail-link-contract.test.mjs`: `MarketCartItem`에 `detailHref: string | null`, 서버가 `menu_entry_id`·`market_menu_entries`·`is_visible`·`is_active`·`deleted_at` 조건과 `/preview/solvook-concept/boards/`·`?subject=`를 쓰고, cart-view가 `item.detailHref ?`로 `Link`/텍스트를 분기하며, 상세 컴포넌트가 `after:absolute` 없이 토큰 class를 쓰고 slug 하드코딩이 없다.
- `market-detail-multiselect-contract` 갱신: 1번 assert의 `for (const option of selectedOptions)` 루프 위치를 `addTargetsToCart` 안의 루프로 바꾸고(순차 POST·배열 body 없음 유지), 신규 assert를 더한다: `redirectToLogin()` 앞에 의도 저장 호출, `login` 쿼리 확인, Dialog open 조건에 `login`이 포함, 구매 경로는 `openCheckout`/`submitCheckout`을 소비 effect에서 호출하지 않음. 구매 자동 실행 금지는 이 마지막 assert로 고정한다.
- `auth-login-complete-dialog-contract`는 변경 없음(`login=success` 계약 유지).

**위험**: ① 자동 담기로 사용자가 의도하지 않은 상품이 담길 수 있다(담기뿐이고 Dialog로 알리며 장바구니에서 삭제 가능). ② 로그인 완료 Dialog를 닫기 전에는 담기 완료 Dialog가 안 보인다(배지는 갱신). ③ sessionStorage 미지원·차단 환경은 기존 동작으로 퇴화한다. ④ 상세 조회 쿼리 2개 증가(행 ≤50, `in` 조회). ⑤ 이메일 인증 링크·회원가입 흐름은 다른 탭/`signup=1`이라 자동 담기 대상이 아니다(범위 밖). ⑥ `login=success`가 없는 로그인 경로(회원가입 모드)는 담기 없이 의도만 삭제된다.
