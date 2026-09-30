# 장바구니 구현 계획 독립 검증 R1

- 검증 일자: 2026-09-29 KST
- 검증자 dispatch: `task_18174c0aa5b2` / `ctx_eea2e325ce1c`
- 검증 대상: `docs/cart-implementation-plan.md` v2
- 판정: **PLAN FAIL**
- 구현 검증 판정: **미수행 / 판정 대상 아님**
- 변경 범위: 이 검증 문서 1개만 작성했다. 애플리케이션 코드, 마이그레이션, DB, Storage, 운영 데이터는 변경하거나 실행하지 않았다.

## 1. 판정 요약

v2 계획은 자체 검토에서 발견한 핵심 위험을 상당 부분 해결했다. 현재 단건의 HTTP 보상 방식을 제거하고 선택 구매를 한 DB 트랜잭션으로 처리하는 방향, 종료된 batch API를 410으로 유지하는 결정, checkout 멱등성·same quote/different key 차단, child별 실제 credit source 소비와 독립 환불, 상품-타깃-과목 복합 FK, 실제 PDF 기준 주문 FK, 부분 보유 bundle 정가 정책, legacy 재구매 partial UNIQUE와 직접 DML 회수, profile-first 금융 writer 이관, catalog revision+부모 잠금 프로토콜은 모두 코드·DB 감사 근거와 맞는다.

또한 service-role SELECT 증거의 한계를 숨기지 않고 Phase 0에서 catalog 접근이 안 되면 구현·공개를 금지하며, PLAN PASS와 실제 구현 검증 PASS를 분리한 점도 적절하다.

그러나 현재 문서 그대로는 여전히 구현자가 금융/소유권/UX의 핵심 결정을 새로 내려야 하는 사항이 남아 있다.

1. 회원 탈퇴는 batch 사전 조회만 추가하므로 checkout과의 TOCTOU 및 기존 순차 삭제의 부분 삭제를 막지 못한다.
2. 기존 단건 UI를 새 엔진으로 이관한다고 했지만 direct quote의 HTTP 입력, 필수 멱등 키, 재시도 계약 및 cart row가 없는 direct mode 검증 순서가 없다.
3. 페이지 밖 전체 선택을 요구하면서 PATCH/quote는 클라이언트가 아는 ID+revision 배열만 받으므로 pageSize 20에서 계약이 성립하지 않는다.
4. 추가 실측은 bucket `public=false`까지만 증명한다. 새 preflight가 Storage policy와 bucket 메타데이터는 조회하지만 `storage.objects` 역할 권한과 authenticated 실제 object 접근·경로 정합성은 하드 게이트에 없다.
5. legacy HWP 구매가 PDF 다운로드를 포함한다는 DB 문서와 현재 exact-match 코드가 충돌하지만 v2 계획은 어느 의미를 공통 엔진의 기준으로 삼을지 정하지 않았다.
6. 타 사용자 접근 T02 문구가 정보 미반환을 뜻하는지, 반환은 하되 mutation만 막는지 중의적이다.

이 항목들은 표현만 다듬는 문제가 아니다. 계정 삭제 정합성, 응답 유실 시 중복 차감, legacy 중복 구매/다운로드 권한, 타 사용자 정보 노출 및 전체 선택 금액을 바꿀 수 있다. 따라서 R1은 **PLAN FAIL**이며, 아래 수정 후 새 입력 해시로 R2 독립 검증이 필요하다. 이 판정은 구현이 실패했다는 뜻이 아니며 SQL/API/UI는 아직 구현 검증하지 않았다.

## 2. 검증 범위와 증거 한계

### 2.1 읽은 입력

- `AGENTS.md`, `CLAUDE.md`, `DESIGN.md`
- `docs/cart-implementation-plan.md`
- `docs/cart-reference-ui.md`
- `docs/cart-live-db-evidence.json`
- `docs/cart-live-integrity-evidence.json`
- `docs/cart-db-preflight.sql`
- `docs/cart-db-audit.md`
- `docs/cart-code-audit.md`

주요 소스와 마이그레이션도 읽기 전용으로 대조했다.

- `src/lib/market-purchase.ts`
- `src/lib/market-items-server.ts`
- `src/lib/market-refunds.ts`
- `src/lib/credits.ts`
- `src/app/api/market/items/[itemId]/purchase/route.ts`
- `src/app/api/market/items/[itemId]/download/route.ts`
- `src/app/api/market/purchases/batch/route.ts`
- `src/app/api/auth/withdraw/route.ts`
- `supabase/migrations/20260317113000_create_market_items_purchase_domain.sql`
- `supabase/migrations/20260525054805_add_market_zip_asset_and_sample_source.sql`
- `supabase/migrations/20260805110000_enforce_credit_expiration.sql`
- `supabase/migrations/20260818073025_add_provider_refund_processing.sql`

### 2.2 live evidence의 경계

`cart-live-db-evidence.json`은 2026-09-28의 PostgREST OpenAPI 및 service-role SELECT 증거다. 장바구니 테이블 부재, 관찰된 스키마·집계, 제한된 parent mismatch와 활성 권한 중복 0건, 운영에 노출된 `consume_credits_once`/`refund_credits_once` 시그니처를 확인할 수 있다.

`cart-live-integrity-evidence.json`은 2026-09-29의 추가 읽기 증거다. 파일 exact count 500, 주문 consumption 합계/소스 소유자, entitlement-order identity, 완료 상태 관련 검사 0건, `market-files` bucket 존재와 `public=false`, 익명 HEAD 결과 0행을 확인한다.

두 증거로도 CHECK·partial UNIQUE·RLS 본문·GRANT·함수 본문·lock 순서, authenticated 직접 DML, `storage.objects` 정책과 authenticated 직접 object read를 증명할 수 없다. 추가 증거 자체도 “authenticated write denial의 증거가 아니며 catalog/grant/function body가 미확인”이라고 제한한다. 새 `cart-db-preflight.sql`은 public catalog와 함께 storage policy 및 bucket 메타데이터를 읽도록 보완됐지만, `storage.objects`의 역할별 table privilege와 실제 object 접근·경로 정합성은 다루지 않는다.

## 3. 유지해야 할 검증 통과 방향

다음 설계 결정은 감사 근거와 일치하므로 수정 과정에서 후퇴시키면 안 된다.

1. **단건/선택 구매의 HTTP 보상 제거**  
   v2는 차감 뒤 order/line/entitlement를 별도 요청으로 만들고 실패 시 delete/refund한다(`src/lib/market-purchase.ts:232-377`). legacy도 차감 뒤 purchase insert, 실패 시 별도 환불이다(`src/app/api/market/items/[itemId]/purchase/route.ts:67-182`). 두 경로 모두 새 원자 엔진으로 이관하고 application 보상 경로를 동시에 활성화하지 않는 계획이 맞다.

2. **종료 batch 410 유지**  
   `/api/market/purchases/batch`는 현재 410만 반환한다(`src/app/api/market/purchases/batch/route.ts:1-12`). 새 cart checkout을 별도 `/api/market/cart/checkout`으로 만들고 과거 리스트 직접 결제를 복원하지 않는 결정이 맞다.

3. **quote와 checkout 멱등성**  
   `(user_id,idempotency_key)`, `UNIQUE(quote_id)`, 정규화 payload 비교, 성공 replay를 quote 만료 검사보다 먼저 반환하는 규칙과 T09~T12는 같은 key/다른 payload 및 같은 quote/다른 key를 올바르게 다룬다.

4. **판매 단위별 child/원장/환불**  
   batch 총액을 한 order에 몰지 않고 target별 legacy purchase 또는 v2 order를 만들며, 각 child가 실제 `consume_credits` 반환 source allocation을 갖는 결정은 현재 library/refund UX와 맞는다. T16/T21/T22도 유지해야 한다.

5. **복합 FK와 actual upgrade base order**  
   기존 같은 과목의 다른 상품 target 교차 연결 빈틈을 복합 후보키/FK로 막고, `market_purchase_orders.upgrade_base_order_id`가 동일 user/item/subject의 실제 기준 주문을 참조하게 한 v2 보완은 적절하다. 현재 코드는 source order를 고르지 않고 같은 item의 할인 HWP 존재 여부로 PDF 기준 주문을 추론하므로(`src/lib/market-items-server.ts:1637-1755`, `src/lib/market-refunds.ts:194-295`) 이 관계는 필수다.

6. **부분 보유 bundle 정가 정책**  
   현재 동작을 유지해 정가·기보유분 차감 없음 안내를 quote에서 확인받고, bundle 환불은 새 item entitlement만 되돌리며 기존 subproduct entitlement를 보존하는 결정과 T32가 일관된다.

7. **legacy 이력 보존과 권한 회수**  
   legacy unconditional UNIQUE를 completed partial UNIQUE로 바꾸고 환불 후 새 purchase ID를 생성하며, 사용자 직접 INSERT/UPDATE/DELETE와 느슨한 정책을 제거하는 보완은 필요하고 타당하다.

8. **profile-first와 catalog phantom 프로토콜**  
   provider refund까지 모든 잔액 writer가 profile을 먼저 잠그게 이관하고 T33으로 경합을 검증하는 결정, `catalog_revision`과 부모 item 잠금을 DB trigger로 모든 child writer에 강제하는 결정은 이전의 핵심 미정사항을 해소했다. Phase 0의 실제 함수·writer 대조가 끝나기 전에는 이 결정을 구현 완료로 간주하면 안 된다.

## 4. 차단 이슈와 필수 수정안

### B1. 회원 탈퇴가 checkout과 같은 profile lock/DB 트랜잭션을 사용하지 않음

**근거**

- 계획은 batch를 `profiles` RESTRICT로 두고 `/api/auth/withdraw` “사전 검사”에 추가한다고 한다(`docs/cart-implementation-plan.md:120-127`, `:231-240`).
- 현재 withdraw는 payment/checkout history를 조회한 뒤 여러 테이블을 순서대로 delete하고 마지막에 profile을 delete한다(`src/app/api/auth/withdraw/route.ts:33-65`). profile lock도, 하나의 DB 트랜잭션도 아니다.
- checkout은 profile을 먼저 잠그도록 계획되어 있으나 withdraw가 같은 잠금을 잡지 않으면 `사전 검사 → 일부 데이터 삭제 → 동시 checkout batch commit → profile RESTRICT 실패`가 가능하다. T28의 “일부 데이터 먼저 삭제되지 않음”을 사전 조회만으로 보장할 수 없다.
- `market_checkout_quotes.user_id`의 NOT NULL/FK/삭제 정책도 목표 스키마에 명시되지 않았다. cart는 CASCADE, batch는 RESTRICT만 결정되어 있다.

**필수 수정**

1. 사용자 DB 데이터 삭제를 service-role PostgREST 순차 호출이 아닌 **하나의 withdraw RPC/트랜잭션**으로 옮긴다.
2. RPC는 먼저 동일한 `profiles(user_id) FOR UPDATE`를 잡고 payment/order/checkout batch/환불 보존 이력을 재확인한 뒤 허용된 계정만 종속 데이터와 profile을 원자적으로 삭제한다.
3. cart와 미사용/만료 quote는 CASCADE 또는 RPC 명시 삭제 중 하나를 확정하고, batch/child/영수증은 RESTRICT 보존한다. 소비된 quote와 batch FK도 hard-delete 정책을 명시한다.
4. DB commit 뒤 `auth.admin.deleteUser` 실패 시 재시도/복구 상태를 정의한다. 최소한 부분 DB 삭제를 성공으로 응답하면 안 된다.
5. T28을 `checkout과 withdraw 동시 실행`, `cart/미사용 quote만 있는 계정`, `batch 이력 계정`, `중간 삭제 실패 주입`으로 확장한다.

### B2. direct mode의 quote·멱등 HTTP 계약이 없음

**근거**

- 계획은 기존 단건 버튼/UX를 유지하되 서버 처리를 새 원자 엔진으로 이관하고, quote에 `mode=direct`를 둔다(`docs/cart-implementation-plan.md:41-49`, `:112-118`, `:188-195`).
- 그러나 HTTP 계약은 cart row ID 기반 quote/checkout만 정의하며 기존 `/api/market/items/[itemId]/purchase`의 새 body/response/retry 계약을 정의하지 않는다(`:215-229`).
- 현재 legacy body에는 멱등 키가 없고, v2 `idempotencyKey`도 optional이다(`src/app/api/market/items/[itemId]/purchase/route.ts:24-43`). 응답 유실 후 legacy 또는 key 없는 v2 요청을 재시도하면 새 구매인지 replay인지 구분할 수 없다.
- checkout 순서 3은 cart row owner/revision/selected 검증만 설명하므로 cart row가 없는 direct quote에서 무엇을 잠그고 어떤 snapshot을 비교하는지도 빠져 있다.

**필수 수정**

- direct UI/API도 `서버 direct quote → 금액/옵션 확인 → quoteId + 필수 client-generated idempotencyKey로 확정`하는 두 단계 계약으로 고정한다. legacy와 v2 모두 key를 필수로 한다.
- 기존 purchase route를 유지할 경우 새 입력을 discriminated union으로 명시하고, body의 가격/user/권한은 받지 않는다. 예: quote 발급 입력은 target identity만, 확정 입력은 quoteId+key만 받는다.
- direct quote snapshot에는 target/item/subject/가격/파일/소유권/upgrade base order를 담고, checkout은 cart row 분기 대신 이를 다시 잠금·재계산한다. cart mode와 direct mode의 검증 순서를 각각 문서화한다.
- 응답 유실, 같은 key+같은 direct quote, 같은 key+다른 target/quote, same quote+different key, direct와 cart의 동일 target 동시 구매를 테스트에 추가한다.
- `MARKET_CART_ENABLED=OFF`여도 direct atomic engine은 동작하므로 cart endpoint flag와 공통 RPC 가용성의 경계를 명시한다.

### B3. 페이지 밖 전체 선택과 ID 배열 API가 함께 성립하지 않음

**근거**

- `/cart`는 20/50 표시와 페이지 밖까지 포함한 전체 구매 가능 행 선택을 요구한다(`docs/cart-implementation-plan.md:74-83`).
- 선택은 DB `is_selected`에 저장한다고 결정했지만 PATCH와 quote는 클라이언트가 보낸 row IDs+revisions만 받는다(`:41-46`, `:219-225`).
- pageSize 20에서 클라이언트는 나머지 최대 30행의 ID/revision을 모른다. 현재 계약만으로는 “전체 선택” mutation이나 모든 selected row의 quote를 만들 수 없다. T08은 기대 결과만 있고 이를 가능하게 하는 API 규칙이 없다.

**필수 수정**

다음 중 하나를 계획에서 선택한다.

- 가장 단순한 v1: 최대 50행을 한 번에 읽고 pagination을 제거하며, ID+revision 배열 계약을 유지한다.
- 20/50 pagination 유지: `selectAllPurchasable`/`clearAll` 같은 server-side selection RPC와 selection generation을 도입한다. quote는 client의 현재 페이지 ID가 아니라 해당 generation의 전체 selected 집합을 서버에서 고정한다.

어느 안이든 개별 toggle, 전체 선택, 다른 탭 선택 변경, 판매 불가 전환, 페이지 이동, quote 생성의 source of truth와 `CART_CHANGED` 조건을 하나로 고정해야 한다. 구현자가 client-only 선택과 DB 전체 선택 중 하나를 새로 추론하게 두면 안 된다.

### B4. Phase 0 Storage 검증이 policy 조회에 그쳐 권한·실접근·경로 정합성을 닫지 못함

**근거**

- 추가 증거는 `market-files` bucket 존재와 `public=false`만 확인한다. `storage.objects` policy, authenticated/anon 직접 object SELECT, role grant, DB path와 실제 object 대응은 실행 증거로 확인하지 않았다.
- 계획은 새 preflight 실행을 Phase 0에 추가했다(`docs/cart-implementation-plan.md:246-252`). preflight는 `pg_policies`에서 `storage.objects/buckets`와 bucket 메타데이터를 조회하지만, 역할별 `has_table_privilege` 질의는 `public` schema에만 제한되어 `storage.objects`의 SELECT/DML grant를 확인하지 않는다(`docs/cart-db-preflight.sql:37-56`, `:81-82`). 실제 authenticated object 접근 및 DB path-object 대응 질의도 없다.
- 현재 다운로드 route는 entitlement/refund를 애플리케이션에서 확인한 뒤 admin client로 signed URL을 만들고 event를 별도 insert한다(`src/app/api/market/items/[itemId]/download/route.ts:53-121`, `:133-205`). object 직접 읽기가 열려 있으면 이 경계와 최종 다운로드/환불 경합 설계를 우회한다.

**필수 수정**

- preflight에 `storage.objects/buckets`의 anon/authenticated/service_role privilege·ACL 조회와 DB bucket/path↔object orphan·중복 집계를 추가한다. Phase 0 하드 게이트에 bucket별 `public=false`, 직접 SELECT 차단, policy/ACL, MIME/size, signed URL TTL 및 환불 뒤 잔여 URL 정책을 명시한다.
- 격리 검증 환경에서 entitlement 없는 authenticated 사용자와 다른 사용자의 object 접근을 실제로 거부하는지 확인한다.
- 미확인 상태를 “Storage 변경 불필요”로 PASS 처리하지 않는다. 수정이 필요하면 승인된 policy/migration과 rollback 경계를 계획의 변경 후보에 추가한다.

### B5. legacy HWP↔PDF 소유 범위가 DB 문서와 코드 사이에서 미결정

**근거**

- 계획은 legacy PDF/HWP/ZIP을 v1 판매 단위로 포함하고 legacy 재구매/권한을 새 엔진으로 이관한다(`docs/cart-implementation-plan.md:41-49`, `:55-62`, `:146-154`).
- migration 주석은 “hwp 구매는 pdf 다운로드를 포함”한다고 한다(`supabase/migrations/20260525054805_add_market_zip_asset_and_sample_source.sql:55-57`).
- 현재 코드는 구매/다운로드 coverage를 exact kind로만 판단한다. HWP label은 `HWP & PDF`지만 `getMarketPurchaseKindsToCheck`와 `isMarketAssetCoveredByPurchaseKind`는 HWP가 PDF를 덮지 않는다(`src/lib/market-purchase.ts:40-56`).
- 계획 6.4~6.6의 PDF→HWP 차액과 base order는 V2 subproduct 규칙이다. legacy 내부의 `HWP 보유 후 PDF 담기`, `PDF 보유 후 HWP 가격`, HWP 환불 시 PDF 권한 범위를 정하지 않는다.

**필수 수정**

- legacy의 source of truth를 하나로 결정한다. 권고 최소안은 현재 production 코드의 exact-kind 동작을 유지하되 새 migration의 `COMMENT`와 UI 라벨로 문서를 바로잡고 회귀 테스트로 고정하는 것이다. HWP가 PDF를 포함하도록 바꾸려면 가격·중복 구매·다운로드 이벤트·환불 종속성을 별도로 설계해야 한다.
- `HWP 보유→PDF cart/direct`, `PDF 보유→HWP`, `HWP 환불 후 PDF`, ZIP 독립성을 quote/checkout/download/refund 테스트에 추가한다.
- legacy/V2 혼합의 `OWNERSHIP_REVIEW_REQUIRED`와 legacy 내부 coverage 오류를 서로 다른 typed reason으로 구분한다.

### B6. T02의 보안 합격 기준이 중의적

**근거**

- 본문은 quote ID를 알아도 다른 사용자로 조회/결제할 수 없고, 404가 타인/없는 대상을 함께 숨긴다고 한다(`docs/cart-implementation-plan.md:112-118`, `:227-229`).
- T02는 “정보·가격 스냅샷 반환 및 mutation 불가”라고 적혀 있다(`:282-284`). `불가`가 반환과 mutation 모두를 수식하는지, mutation만 수식하는지가 분명하지 않다.

**필수 수정**

- T02를 `타 사용자의 cart/quote/key는 존재 여부·항목·가격 스냅샷·영수증을 반환하지 않고 동일 404, mutation 0`으로 바꾼다.
- owner, 다른 authenticated 사용자, anon, service Route Handler를 나눠 RLS 직접 SELECT와 API 응답을 모두 검증한다.

## 5. R2 전 필수 체크리스트

- [ ] withdraw를 profile-first 단일 DB RPC로 설계하고 cart/quote/batch FK 삭제 정책 확정
- [ ] direct quote/checkout HTTP union, 필수 idempotency key, direct-mode 재검증 순서와 replay 테스트 추가
- [ ] pagination/DB selection/전체 선택/quote source of truth를 하나의 계약으로 통일
- [ ] Phase 0에 Storage policy·role·object 직접 접근 검증 추가
- [ ] legacy HWP/PDF/ZIP coverage와 가격·환불 의미를 확정
- [ ] T02를 명시적인 정보 미반환 기준으로 수정
- [ ] Phase 2의 “legacy batch 잠금 우회 0” 표현을 `종료 batch 410 유지`와 모순되지 않게 정리
- [ ] 신규 cart/direct API의 실제 route 파일, 기존 purchase route 변경, withdraw RPC/migration을 변경 후보에 열거
- [ ] 위 수정마다 SQL/API/동시성/브라우저 재현 절차와 합격 기준 추가

## 6. PLAN PASS와 구현 검증 PASS의 분리

R2에서 계획이 PASS하더라도 다음을 의미하지 않는다.

- 실제 catalog와 migration drift 해소
- migration 적용, RLS/GRANT/Storage policy 차단
- 원자 checkout, child별 ledger, 정확한 upgrade base order와 refund idempotency 동작
- profile-first provider writer 이관과 catalog trigger의 교착/phantom 테스트 통과
- T01~T33 및 이 문서의 추가 시나리오, 브라우저·접근성·lint·build 통과
- 운영 rollout 또는 financial drift 0

실제 구현 후에는 Phase 0~4 게이트와 실패 주입/동시성/권한/Storage 검증의 원출력을 별도 기록해야 한다. 실제 서비스 catalog/Storage 접근이 없으면 추정으로 구현 PASS 처리하지 않는다.

## 7. 검증 대상 해시

검증 중 계획이 v2로 변경되어 최신 입력을 다시 읽고 아래 해시 기준으로 판정했다. 이후 파일이 바뀌면 이 R1은 이전 입력에 대한 판정이며 새 회차가 필요하다.

| 파일 | SHA-256 |
|---|---|
| `AGENTS.md` | `86ff1a19d579971daa1ba6d7ac0994de0f672059bdda7759b2f9e2bc35a50314` |
| `CLAUDE.md` | `ac116392f46e8a720ca713cf12bfbd67f8b174ef3d24b40aa67404634e83583d` |
| `DESIGN.md` | `5562b20262e187aa71e9ed3b6d90722f4d8fba0c876a6bd90ab408ad84acfe12` |
| `docs/cart-implementation-plan.md` | `5b3d3af69cccf67daef3159e4f77fc1882ad0324634f9587bc5fe07ff9050780` |
| `docs/cart-reference-ui.md` | `1eb62ab713b94a3814d6ed729068379ec81554dddb622ad163e8c4fd7ac78a27` |
| `docs/cart-live-db-evidence.json` | `16c0dee88270aeedb2379a3b367702b61b3700adc13a5a0b7847e4229885edb2` |
| `docs/cart-live-integrity-evidence.json` | `9e8e7941f15ee566b725214171e6d12ebbb0940392631c5431f20e66d02501ed` |
| `docs/cart-db-preflight.sql` | `e3b3df206aa02fef56082766fb9c9433762847e2174261d6ab19b23f29c0c481` |
| `docs/cart-db-audit.md` | `7b3f7f2499ab24c834a79f670079104a1bbc4091be0f3880c8d4ef9547e7d403` |
| `docs/cart-code-audit.md` | `bf918752978f587063d70d8d1db850cf60561b274bcbcd9d88d98ea5e553f5f7` |

## 8. 최종 판정

**R1 PLAN FAIL.** v2가 해결한 원자성·멱등성·복합 FK·실제 base order·부분 bundle·writer lock·catalog phantom 결정을 유지하면서 B1~B6을 보완한 뒤 새 독립 검증을 수행해야 한다. 이 결과는 계획 완결성 판정이며 실제 구현·DB·Storage 검증 PASS가 아니다.
