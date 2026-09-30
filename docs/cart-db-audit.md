# 장바구니 도입 DB 읽기 전용 감사

작성 기준 시각: 2026-09-28 (KST)  
검토 범위: 저장소 마이그레이션/생성 타입/구매·환불 서버 코드와 `docs/cart-live-db-evidence.json`  
변경 범위: 이 문서만 작성. DB, Storage, 운영 데이터, 마이그레이션은 변경하거나 실행하지 않았다.

## 1. 결론

**현재 상태는 PASS가 아니다. 장바구니의 선택 구매를 단건 구매 API 여러 번 호출하는 방식으로 출시하면 안 된다.**

가장 큰 이유는 다음과 같다.

1. 현재 v2 구매는 크레딧 차감, 주문, 주문 라인, entitlement 생성이 서로 다른 DB 트랜잭션/HTTP 요청으로 이어지고 실패 시 별도 환불로 보상한다. 단건에서도 crash window가 있고, 여러 장바구니 항목을 반복 호출하면 일부 항목만 구매·차감되는 결과가 정상적으로 발생할 수 있다 (`src/lib/market-purchase.ts:312-369`, `src/lib/market-items-server.ts:1935-1988`).
2. 저장소 마이그레이션과 생성 타입 어디에도 `purchase_market_*` 함수 정의/시그니처가 없다. 운영 증거도 이 함수들의 본문·권한을 수집하지 않았다. 따라서 “기존 `purchase_market_*` RPC에 연결”할 수 있다고 전제할 근거가 현재 감사 자료에는 없다. 실제 DB `pg_proc` 확인 전에는 미확인 사항이다.
3. 현재 멱등성은 차감 전 조회 후 차감 뒤 주문 insert를 하는 check-then-act 구조다. 동일 사용자 동시 요청은 둘 다 조회를 통과한 뒤 둘 다 차감할 수 있고, 두 번째 요청은 unique 충돌 뒤 보상 환불에 의존한다 (`src/lib/market-purchase.ts:248-263,312-367`; unique는 `supabase/migrations/20260528010000_create_market_subproduct_v2_schema.sql:158-160`). 프로세스 중단이나 보상 환불 실패 시 차감만 남을 수 있다.
4. 환불 승인도 하나의 DB 트랜잭션이 아니다. 크레딧 복구 후 주문·라인·entitlement를 세 개의 별도 요청으로 갱신하고 다시 환불 요청을 갱신한다 (`src/lib/market-refunds.ts:493-563`). 동시 승인과 중간 실패에 취약하다.
5. 마이그레이션이 설명하는 최신 `consume_credits`/`refund_credits`와 운영 스키마 간 drift가 있다. 운영 OpenAPI와 생성 타입에는 `consume_credits_once`, `refund_credits_once`, `operation_key`, `original_operation_key`, `transaction_id`가 보이지만 이 저장소에는 해당 함수/컬럼을 만드는 마이그레이션이 없다 (`docs/cart-live-db-evidence.json:1540-1742`, `src/types/supabase.ts:284-335,412-469,4359-4368,4741-4752`). 운영 함수 본문, unique, grant, lock 순서는 아직 검증되지 않았다.

출시 전 최소 조건은 **선택한 모든 항목을 한 번의 DB RPC/트랜잭션으로 검증·가격확정·차감·주문·entitlement 생성·선택 장바구니 삭제까지 완료**하고, 실제 DB catalog로 함수/제약/RLS/grant를 확인하는 것이다.

## 2. 증거의 범위와 한계

### 확인된 운영 스냅샷

`docs/cart-live-db-evidence.json`은 2026-09-28T08:21:27.780Z에 PostgREST OpenAPI와 service-role SELECT만 사용한 읽기 전용 스냅샷이다. 문서 자체가 active unique/check/index, RLS 식, grant, 함수 본문, lock을 증명할 수 없다고 명시한다 (`docs/cart-live-db-evidence.json:2-5`).

- 장바구니 테이블: 0개 (`cartTables: []`, 같은 파일 `:7`)
- 게시 상품: 한국어 144, 영어 1
- 활성 서브상품: 한국어 352
- 활성 번들: 한국어 64
- v2 주문/라인/entitlement: 각각 8건
- 주문 상태: completed 7, refunded 1
- 주문 유형: subproduct 7, bundle 1
- entitlement: subproduct 7, item 1
- completed 주문 중 idempotency key와 credit consumption snapshot 보유: 각각 7건
- upgrade 차액 주문: 0건
- legacy `market_purchases`: 0건
- 데이터 스냅샷상 subproduct-item/file-parent/order-line parent mismatch, active entitlement exact-key 중복, order 없는 active v2 entitlement는 모두 0건 (`docs/cart-live-db-evidence.json:1745-1777`).

이는 **현재 조회된 데이터가 깨져 있지 않다는 제한된 신호**일 뿐, 제약이 잘못된 행을 막는다는 증거가 아니다. 특히 파일 수가 정확히 500건이므로 조회 페이지 상한 여부를 실제 `count(*)`로 재확인해야 한다.

### 명칭 대응

요구사항의 `orders`/`order_items`는 현재 스키마에서 각각 다음과 대응한다.

| 개념 | 현재 테이블 |
|---|---|
| 주문 | `market_purchase_orders` |
| 주문 항목 | `market_purchase_lines` |
| 보유권 | `market_entitlements` |
| legacy 단건 구매 | `market_purchases` |
| 환불 요청 | `market_refund_requests` |

운영 스냅샷에도 이 이름과 컬럼이 확인된다 (`docs/cart-live-db-evidence.json:1000-1134`; 생성 타입은 `src/types/supabase.ts:2074-2375`).

## 3. 현재 스키마의 보장과 빈틈

### 3.1 FK와 과목 경계

좋은 점은 v2 주요 테이블이 `workspace_subject`를 가지고, 대부분 `(id, workspace_subject)` 복합 FK를 사용한다는 것이다 (`supabase/migrations/20260528010000_create_market_subproduct_v2_schema.sql:41-45,60-67,93-104,150-153,177-190,214-226`). 따라서 영어 대상 ID에 한국어 subject를 붙이는 단순 오염은 상당 부분 차단된다.

그러나 다음 관계는 DB가 보장하지 않는다.

- `market_subproduct_files.item_id`가 참조한 상품과 `subproduct_id`의 실제 `item_id`가 동일한지
- `market_purchase_lines.item_id`가 주문 header의 `item_id`와 동일한지
- 주문 라인의 `subproduct_id`/`bundle_option_id`가 라인의 `item_id`에 속하는지
- `market_entitlements.item_id`가 `subproduct_id`/`file_id`/`source_order_id`의 실제 상품 및 사용자와 동일한지

현재 FK는 각 대상의 `workspace_subject`만 맞추므로 같은 과목의 다른 상품을 교차 연결할 수 있다. 현재 운영 스냅샷의 mismatch 0은 애플리케이션이 지금까지 정상 행을 썼다는 뜻이지 DB 방어가 있다는 뜻이 아니다.

권장 제약은 다음과 같다.

- 서브상품/번들/파일에 `(id, item_id, workspace_subject)` unique 후보키 추가
- 파일의 `(subproduct_id, item_id, workspace_subject)` 복합 FK 추가
- 주문에 `(id, user_id, item_id, workspace_subject)` unique 후보키 추가
- 라인의 `(order_id, item_id, workspace_subject)` 복합 FK 및 target의 `(target_id, item_id, workspace_subject)` 복합 FK 추가
- entitlement의 source order와 `(source_order_id, user_id, item_id, workspace_subject)`를 함께 묶는 FK 또는 동등한 trigger/RPC 검증 추가

이 제약은 새 마이그레이션을 작성하기 전에 실제 mismatch를 다시 조회하고 `NOT VALID`/검증 순서를 설계해야 한다.

### 3.2 check와 unique

마이그레이션상 확인되는 핵심 보장은 다음과 같다.

- 상품/서브상품/번들 가격은 0 이상 (`supabase/migrations/20260528010000_create_market_subproduct_v2_schema.sql:54,118,144-146,173-174`). 구매 애플리케이션은 0원을 판매 불가로 처리한다 (`src/lib/market-items-server.ts:1831-1837,1873-1878`).
- 주문 유형은 `subproduct|bundle|legacy_backfill`, 주문 상태는 `completed|refunded|revoked|failed` (`supabase/migrations/20260528010000_create_market_subproduct_v2_schema.sql:142-147`).
- 주문 라인은 유형에 따라 subproduct 또는 bundle 대상 하나만 갖는다 (`:172-195`).
- entitlement는 `item|subproduct|file|legacy_asset`별 null 패턴을 검사한다 (`:200-233`).
- 사용자별 idempotency key는 null이 아닐 때 unique다 (`:158-160`).
- exact active entitlement는 item/subproduct/file별 partial unique다 (`:238-252`).
- 활성 번들 옵션은 상품별 하나다 (`:130-135`).
- legacy 구매는 `(user_id,item_id,asset_kind)` unique다 (`supabase/migrations/20260317113000_create_market_items_purchase_domain.sql:58-72`).

빈틈은 다음과 같다.

- item-scope와 subproduct-scope entitlement가 동시에 active인 것은 허용된다. 부분 보유 후 번들 구매를 지원하기 위한 현재 정책과 맞지만, cart 중복 제거는 unique만으로 해결되지 않는다.
- 한 주문에 같은 target line을 여러 번 넣는 unique가 없다.
- idempotency key에 요청 fingerprint가 없다. 같은 키를 다른 상품/가격/선택 집합에 재사용하면 현재 코드는 사용자+키로 찾은 기존 completed 주문을 새 요청의 결과처럼 반환한다 (`src/lib/market-items-server.ts:1884-1907`).
- refunded/failed 주문이 같은 키를 점유한 경우 completed 조회에는 잡히지 않지만 unique는 재사용을 막는다. 현재 흐름은 차감 후 insert 충돌과 보상 환불로 빠질 수 있다.
- `credit_sources`에는 저장소 마이그레이션 기준 `initial_credits >= 0`, `0 <= remaining_credits <= initial_credits` check가 없다. `credit_consumption.amount > 0` check도 없다 (`supabase/migrations/20260206_credit_system.sql:35-67`). 쓰기 grant가 service role로 제한된 것은 완화 요소지만 catalog 확인과 제약 보강이 필요하다.

크레딧 원장은 source → consumption/transaction으로 연결되지만 시장 주문은 FK가 아니라 `credit_consumptions` JSON snapshot만 보관한다. 운영 생성 타입에는 `credit_consumption.transaction_id`, `operation_key`와 `credit_transactions.operation_key`, `original_operation_key`가 존재한다 (`src/types/supabase.ts:284-335,412-469`). 반면 저장소상 최신 일반 `consume_credits`는 consumption을 먼저 insert한 뒤 transaction을 만들며 둘을 연결하는 ID/operation key를 기록하지 않는다 (`supabase/migrations/20260805110000_enforce_credit_expiration.sql:151-200`). 따라서 market order snapshot과 실제 ledger row의 1:1 추적은 운영의 미확인 `*_once` 구현 또는 별도 검증 없이는 보장되지 않는다.

### 3.3 RLS와 grant

v2 테이블은 RLS가 활성화되고, 사용자는 자신의 주문/라인/entitlement를 읽을 수 있으며 쓰기는 admin 정책만 존재한다 (`supabase/migrations/20260528010000_create_market_subproduct_v2_schema.sql:395-402,521-573`). 파일 메타데이터 SELECT도 active entitlement와 item/subproduct/file scope를 확인한다 (같은 파일 `:461-485`).

반면 legacy `market_purchases`는 다음 위험이 있다.

- 사용자 INSERT 정책은 `auth.uid() = user_id`만 검사하며 status, 가격, 상품 상태, 실제 차감 여부를 검사하지 않는다.
- “pending만 update”라는 정책 이름과 달리 실제 `USING`/`WITH CHECK`는 사용자 ID만 검사한다 (`supabase/migrations/20260317113000_create_market_items_purchase_domain.sql:244-264`).
- 테이블 INSERT/UPDATE grant가 authenticated에 남아 있다면 사용자가 completed 구매를 위조하거나 refunded를 completed로 바꿔 다운로드 권한을 만들 수 있다. 저장소에는 이 테이블에 대한 명시적 revoke가 없다. 실제 grant를 조회하기 전에는 취약 여부를 확정할 수 없다.

크레딧 테이블은 2026-08-05 마이그레이션에서 anon/authenticated의 INSERT/UPDATE/DELETE와 `consume_credits`/`refund_credits` EXECUTE를 revoke하고 service role만 허용했다 (`supabase/migrations/20260805090000_harden_credit_mutation_boundaries.sql:4-32`). 그 다음 최신 함수 재정의도 service role grant를 다시 설정한다 (`supabase/migrations/20260805110000_enforce_credit_expiration.sql:327-343`).

시장 환불 요청의 직접 사용자 INSERT 정책은 후속 마이그레이션에서 제거되었다 (`supabase/migrations/20260602021000_harden_market_refund_request_rls.sql:1-4`). 다만 모든 RLS/grant 판단은 운영 `pg_policy`, `relrowsecurity`, ACL 조회로 확정해야 한다.

### 3.4 함수 재정의 추적 결과

동일 이름 함수는 최초 정의가 아니라 시간상 마지막 `CREATE OR REPLACE`를 기준으로 검토했다.

| 함수 | 저장소 정의 흐름 | 저장소상 최신 정의/권한 |
|---|---|---|
| `consume_credits` | `20260306000000` 최초 정의 → `20260805090000` search_path/권한 hardening → `20260805110000` 만료 정책 포함 재정의 | `20260805110000_enforce_credit_expiration.sql:78-207,327-343` |
| `refund_credits` | `20260306000000` 최초 정의 → `20260805090000` search_path/권한 hardening → `20260805110000` 재정의 | `20260805110000_enforce_credit_expiration.sql:209-343` |
| `get_credit_balance_snapshot` | `20260805110000` 정의 | `20260805110000_enforce_credit_expiration.sql:5-76,327-337` |
| point-charge refund eligibility/request/fail/reject | `20260818062122` 정의 | `20260818062122_guard_payment_environment_and_add_kakaopay_fulfillment.sql:455-635,859-946` |
| `claim_point_charge_refund` | `20260818062122` 정의 → `20260818073025` provider 공통화 재정의 | `20260818073025_add_provider_refund_processing.sql:1-104,436-447` |
| `finalize_point_charge_refund` | `20260818062122` 정의 → `20260818073025` provider 공통화 재정의 | `20260818073025_add_provider_refund_processing.sql:106-268,436-447` |
| `consume_credits_once`, `refund_credits_once` | 마이그레이션 정의 없음; 운영 OpenAPI/생성 타입에만 존재 | 본문·권한·lock·unique 미확인 |
| `purchase_market_*` | 마이그레이션/생성 타입/서버 호출 없음 | 운영 catalog 조회 전 존재 여부 미확인 |

애플리케이션의 현재 결제수단 환불 경로는 toss 전용 구형 이름이 아니라 `*_point_charge_refund` 함수군을 호출한다 (`src/lib/point-charge-refunds-server.ts:6-13,69-80,111-211`). 따라서 cart/credit lock 순서를 비교할 때는 2026-08-18의 마지막 point-charge 정의를 기준으로 해야 한다.

### 3.5 Storage

v2 유료 파일 경로는 private storage로 설명되고 entitlement 검증 후 API 접근을 전제로 한다 (`supabase/migrations/20260528010000_create_market_subproduct_v2_schema.sql:74-107`). 실제 다운로드 API도 entitlement와 pending refund를 확인한 뒤 admin client로 5분 signed URL을 발급한다 (`src/app/api/market/items/[itemId]/download/route.ts:53-121`).

그러나 저장소 마이그레이션에는 `market-files` bucket 생성/`public=false`/`storage.objects` 정책이 없다. 실제 bucket과 storage policy는 미확인이다. 장바구니 작업이 구매 메타데이터만 안전하게 만들어도 bucket이 public이거나 직접 SELECT가 열려 있으면 entitlement가 무의미하다.

## 4. 구매 원자성·멱등성·동시성 감사

### 4.1 현재 단건 v2 흐름

현재 순서는 다음과 같다.

1. idempotency key의 completed 주문 조회
2. 상품/서브상품 또는 번들/파일/현재 entitlement 조회
3. 중복 보유와 PDF→HWP 차액 규칙 계산
4. `consume_credits` RPC로 차감
5. 주문 insert
6. 주문 라인 insert
7. entitlement insert
8. 5~7 실패 시 생성된 행을 delete하고 `refund_credits` 호출

근거는 `src/lib/market-purchase.ts:232-377`이다. 5~7의 insert/delete도 각각 별도 PostgREST 요청이다 (`src/lib/market-items-server.ts:1935-1988`). 따라서 보상 로직은 원자적 rollback이 아니다.

### 4.2 단건 RPC 여러 번 HTTP 호출 방식의 부분 차감

선택 항목 A/B/C를 HTTP 세 번 호출하는 경우 다음 결과가 가능하다.

- A 성공, B 성공, C 가격변경/중복/잔액부족 실패 → A/B만 구매되고 총 checkout은 실패
- A 차감 뒤 서버 프로세스 중단 → 주문 없이 credit만 차감
- A 주문 생성 뒤 entitlement 생성 실패, 보상 환불도 실패 → 주문/차감/권한 상태 불일치
- 병렬 호출 시 각 호출의 가격·보유권 snapshot이 서로 다름 → 입력 순서와 타이밍에 따라 청구 결과가 달라짐

`consume_credits` 한 번 자체는 DB 트랜잭션이며 profile row와 credit source를 잠근다 (`20260805110000_enforce_credit_expiration.sql:78-207`). 하지만 구매 도메인 전체가 그 함수 트랜잭션 안에 있지 않으므로 cart checkout의 원자성을 만들지 못한다.

### 4.3 재시도와 동일 사용자 동시구매

현재 unique index는 마지막 방어선일 뿐 안전한 멱등 처리기가 아니다.

- 두 요청이 동시에 completed idempotency 조회를 통과할 수 있다.
- entitlement 중복 조회도 둘 다 통과할 수 있다.
- profile lock 때문에 credit 차감은 직렬화되지만 두 요청 모두 차감될 수 있다.
- 이후 order idempotency unique 또는 active entitlement unique에서 한쪽이 실패하고 별도 환불에 의존한다.

또한 현재 차감은 `consume_credits`, 보상은 `refund_credits`를 쓰며 operation key를 전달하지 않는다 (`src/lib/credits.ts:177-233,243-307`). 운영에 존재하는 `*_once` 함수가 이 문제를 해결할 가능성은 있지만, 본문·unique·grant가 마이그레이션에 없어 확인할 수 없고 현재 시장 구매 코드도 이를 호출하지 않는다.

### 4.4 lock 순서

저장소에서 확인되는 최신 일반 크레딧 함수 순서는 다음과 같다.

- `consume_credits`: profile → 사용 가능한 source들을 만료일/구매일/ID 순서로 lock (`supabase/migrations/20260805110000_enforce_credit_expiration.sql:103-141`)
- `refund_credits`: profile → 전달된 JSON 순서대로 source lock (`:243-284`)

반면 최신 결제수단 환불 finalizer는 refund request → credit source → payment order → (provider transaction) → profile 순서다 (`supabase/migrations/20260818073025_add_provider_refund_processing.sql:124-203`). 즉 같은 source를 대상으로 checkout/소비(profile→source)와 결제수단 환불(source→profile)이 겹치면 lock inversion으로 deadlock이 가능하다. PostgreSQL이 한 트랜잭션을 중단하므로 재시도·멱등성이 필수다.

권장 전역 순서는 **profile(user) → source(ID 정렬) → checkout/order/line/entitlement(정렬된 key) → refund request**처럼 하나로 통일해야 한다. 정확한 순서는 모든 credit/payment/refund RPC의 실제 운영 함수 본문을 확인한 후 결정해야 한다.

## 5. 다중파일·중복보유·번들부분보유

### 5.1 판매 단위는 파일이 아니라 subproduct/bundle이어야 한다

한 subproduct는 여러 active 파일을 가질 수 있고, subproduct entitlement는 그 subproduct의 모든 active 파일을, item entitlement는 상품의 모든 active 파일을 허용한다 (`src/lib/market-purchase.ts:58-89`; RLS도 `supabase/migrations/20260528010000_create_market_subproduct_v2_schema.sql:461-485`). 따라서 cart line을 파일별로 만들면 같은 판매 단위를 여러 번 청구할 위험이 있다.

권장 cart target은 다음 두 가지만 사용한다.

- `subproduct_id` 한 개
- `bundle_option_id` 한 개

파일 ID는 구성/다운로드 대상이며 결제 단위로 받지 않는다. DB에는 동일 storage path나 동일 파일 유형의 중복 행을 막는 unique가 없으므로 실제 중복 파일 데이터도 별도 조회해야 한다.

legacy 의미도 그대로 cart에 끌어오면 안 된다. 마이그레이션 주석은 HWP 구매가 PDF 다운로드를 포함한다고 설명하지만 (`supabase/migrations/20260525054805_add_market_zip_asset_and_sample_source.sql:55-57`), 현재 legacy 판정 코드는 구매/다운로드 asset kind를 exact match로만 본다 (`src/lib/market-purchase.ts:46-56`). 운영 legacy 구매가 0건인 현재는 cart를 v2 subproduct/bundle 대상으로 제한하고, legacy 호환 다운로드·환불만 유지하는 편이 안전하다.

### 5.2 같은 checkout 안의 중복 선택

현재 단건 규칙은 이미 item entitlement가 있으면 모든 subproduct 구매를 막고, 같은 subproduct entitlement를 막는다 (`src/lib/market-purchase.ts:200-230`). 그러나 선택 집합 전체를 먼저 정규화하지 않으면 다음이 입력 순서에 따라 달라진다.

- 같은 상품의 bundle + subproduct
- PDF를 포함한 HWP subproduct + PDF subproduct
- 같은 target 중복

예를 들어 subproduct를 먼저 처리하고 bundle을 나중에 처리하면 현재 정책상 둘 다 구매되며 bundle은 정가다. bundle을 먼저 처리하면 뒤 subproduct는 실패해 checkout 전체가 부분 성공한다. 따라서 RPC 진입 시 전체 선택 집합을 먼저 canonicalize해야 한다.

권장 규칙은 다음과 같다.

1. 같은 target 중복은 제거가 아니라 `DUPLICATE_SELECTION`으로 거절해 클라이언트 버그를 드러낸다.
2. 같은 item의 bundle과 subproduct가 함께 선택되면 자동 청구하지 말고 `OVERLAPPING_SELECTION`과 제거 후보를 반환한다.
3. HWP가 PDF 파일을 포함하고 PDF/HWP를 동시에 선택하면 HWP만 남길지 거절할지 상품 정책을 확정하고 입력 순서와 무관하게 적용한다.
4. 보유 중인 item entitlement가 있으면 해당 item의 모든 새 선택을 거절한다.

### 5.3 부분 보유 후 bundle

현재 정책은 부분 소유 가격을 bundle에서 차감하지 않고 bundle 정가를 청구한다. 테스트도 이 계약을 명시한다 (`tests/market-v2-purchase-entitlement-contract.test.mjs:47-53`, `tests/market-subproduct-schema-contract.test.mjs:102-107`). DB는 item entitlement와 기존 subproduct entitlement의 동시 active 상태를 허용한다.

이 정책을 유지한다면 cart/checkout에 “기보유 서브상품 차감 없음”을 명확히 보여 주고 RPC 응답에도 `original_price_credits == charged_credits`를 보존해야 한다. 할인 정책으로 바꾸려면 환불 종속성(할인 기준이 된 기존 주문을 나중에 환불하지 못하게 하는 규칙)을 먼저 설계해야 한다. 현재 환불 코드는 PDF→HWP upgrade base만 별도로 막으며 일반 bundle 할인 종속성은 없다 (`src/lib/market-refunds.ts:194-295`).

## 6. 타과목 항목과 가격 변경

### 타과목

현재 order header는 `workspace_subject` 하나와 `item_id` 하나를 갖는다 (`supabase/migrations/20260528010000_create_market_subproduct_v2_schema.sql:137-154`). 따라서 영어/한국어 또는 서로 다른 상품의 선택을 하나의 기존 order로 표현하면 의미가 깨진다.

정책 선택지는 두 가지다.

- 혼합 과목 선택을 checkout에서 명시적으로 거절한다.
- 하나의 상위 checkout 아래에 target별 기존 order를 여러 개 만들고 각 order의 실제 subject를 서버가 DB join으로 확정한다.

장바구니 자체는 혼합 과목을 담을 수 있게 하되 결제가 지원하지 않는다면 사용자에게 checkout 전에 알려야 한다. 어떤 경우에도 클라이언트가 보낸 `workspace_subject`를 신뢰하지 말고 item/target에서 도출해야 한다.

### 가격 변경

현재 단건 구매는 클라이언트 가격을 받지 않고 DB의 현재 `price_credits`를 다시 읽으므로 조작 방어에는 유리하다 (`src/lib/market-purchase.ts:265-318`). 하지만 cart에 보인 가격이 변경된 뒤 사용자가 모르는 새 가격으로 즉시 차감될 수 있다.

권장 방식은 다음과 같다.

- cart 저장 가격은 표시 snapshot일 뿐 authoritative하지 않다.
- checkout 요청은 선택 target ID와 `expected_price_credits` 또는 quote hash를 보낸다.
- RPC는 target/price row를 lock하고 현재 가격으로 전체 quote를 재계산한다.
- 하나라도 다르면 아무것도 차감하지 않고 `PRICE_CHANGED`와 old/current line diff를 반환한다.
- 사용자가 새 가격을 확인한 후 새 checkout attempt로 다시 승인한다.

## 7. 환불 연계 위험

### 7.1 시장 구매 환불은 현재 비원자적

`approveMarketRefund`는 pending 요청을 잠그지 않고 읽은 뒤 적격성을 다시 계산하고 `refund_credits`를 호출한다. 이어 주문/라인/entitlement를 `Promise.all`로 각각 갱신하고 마지막에 요청을 approved로 바꾼다 (`src/lib/market-refunds.ts:493-563`).

위험은 다음과 같다.

- 같은 요청을 두 관리자가 동시에 승인하면 둘 다 pending을 읽고 적격성 검사를 통과할 수 있다.
- 일반 `refund_credits`는 원래 consumption row 또는 소비 operation과의 1:1 관계를 검증하지 않고 전달된 source/amount를 복구한다.
- 최신 저장소 함수는 source 잔액을 `LEAST(initial_credits, ...)`로 cap하지만 `v_total_refunded`는 요청 금액만큼 증가시킨다 (`supabase/migrations/20260805110000_enforce_credit_expiration.sql:252-284`). 반복 환불 시 실제 source 증가 없이 중복 refund transaction이 기록될 수 있다.
- 주문만 refunded, entitlement는 active, 요청은 pending 같은 부분 상태가 가능하다.

### 7.2 cart checkout과 환불 단위

현재 시장 환불 대상은 legacy purchase 또는 v2 order 하나다 (`supabase/migrations/20260602020000_add_market_refunds.sql:61-102`). 장바구니 checkout이 여러 target을 샀더라도 기존 환불 정책을 유지하려면 **target별 order를 하나씩 생성**하고 상위 checkout ID로 묶는 편이 가장 작은 변경이다. 그러면 기존 다운로드 이벤트·환불 단위를 보존할 수 있다.

총액을 `consume_credits` 한 번으로 차감한 뒤 동일한 consumption JSON 전체를 모든 order에 복사하면 안 된다. 한 order 환불이 checkout 전체 source allocation을 복구할 수 있기 때문이다. 선택지는 다음 둘 중 하나다.

1. 단일 outer DB transaction 안에서 target별 내부 구매 helper가 target별 credit consumption을 만들고 각 order에 저장한다.
2. 총액을 한 번 차감하되 RPC가 source allocation을 line별로 결정론적으로 분배하고 각 order에 정확한 부분 snapshot을 저장한다.

환불 승인은 `approve_market_refund` 같은 DB RPC 하나로 request row를 `FOR UPDATE`하고, 다운로드/상태를 재검증하고, operation key 기반으로 credit를 한 번만 복구한 후 order/line/entitlement/request를 같은 트랜잭션에서 갱신해야 한다. 운영의 `refund_credits_once`를 사용할 수 있는지는 실제 본문과 unique를 확인한 뒤 결정한다.

### 7.3 결제수단 환불과의 상호작용

결제수단 환불은 원 credit source가 전액 남아 있어야 진행되는 별도 도메인이다. 시장 구매로 사용한 credit를 시장 환불이 복원하면 결제수단 환불 가능 상태가 될 수 있다. 이 연결 자체는 합리적이지만, 두 흐름의 lock 순서가 현재 반대이고 market refund가 애플리케이션 보상 방식이라 동시 실행 시 재시도/상태 불일치 위험이 있다.

`claim_point_charge_refund`/`finalize_point_charge_refund`의 저장소상 최신 재정의는 `20260818073025_add_provider_refund_processing.sql:1-268`, service-role revoke/grant는 `:436-447`이다. `fail`/`reject` 최신 정의와 grant는 `20260818062122_guard_payment_environment_and_add_kakaopay_fulfillment.sql:859-946`이다. 이 provider 환불 RPC는 시장 구매 환불을 대체하지 않는다.

## 8. 권장 cart + selected checkout 연결 설계

### 8.1 전제: `purchase_market_*`는 현재 자료에서 확인되지 않음

저장소 전체에서 `purchase_market_` 문자열과 함수 정의를 찾지 못했고 생성 타입의 Functions에도 해당 RPC가 없다. 운영 증거는 credit RPC 5개만 선택적으로 수집했으므로 운영에 out-of-band 함수가 없다고 단정할 수는 없다.

따라서 다음 제안은 조건부다.

- 실제 DB에 `purchase_market_subproduct`/`purchase_market_bundle` 같은 함수가 있고 각 함수가 한 DB 트랜잭션에서 차감·주문·권한을 끝낸다면, 새 bulk RPC가 이들을 **DB 함수 호출로 같은 outer transaction 안에서** 호출한다.
- 함수가 없거나 현재 TypeScript 보상 흐름만 있다면, 공통 구매 core를 DB 내부 helper로 만들고 buy-now와 cart checkout이 같은 helper를 사용한다.
- HTTP로 기존 단건 endpoint/RPC를 N번 호출하는 연결은 금지한다.

### 8.2 최소 데이터 모델

권장 최소 모델은 다음과 같다.

1. `market_cart_items`
   - `id`, `user_id`, `item_id`, `workspace_subject`, `target_kind`, `subproduct_id` 또는 `bundle_option_id`, `created_at`, `updated_at`
   - target null 패턴 check
   - 사용자+target active unique
   - item/subject/target 복합 FK
   - 자신의 cart만 SELECT/INSERT/DELETE 가능한 RLS 또는 서버 전용 mutation
   - `selected`는 결제 권한이 아니다. checkout은 명시적인 cart item ID 목록을 받는다.
2. `market_checkout_attempts`(또는 동등한 상위 purchase batch)
   - `id`, `user_id`, `idempotency_key`, `request_fingerprint`, `status`, `quoted_total`, `charged_total`, `created_at`, `completed_at`
   - unique `(user_id, idempotency_key)`
   - 같은 key+같은 fingerprint 재시도는 같은 결과, 같은 key+다른 fingerprint는 `IDEMPOTENCY_CONFLICT`
3. 기존 `market_purchase_orders`
   - 선택 target별 order 한 개 유지
   - `checkout_attempt_id` FK 추가
   - 각 order에 자기 target의 정확한 `credit_consumptions` 유지
   - 기존 order 단위 환불/다운로드 이력을 보존

### 8.3 단일 RPC 계약

예시 역할은 `purchase_market_checkout(p_user_id, p_idempotency_key, p_cart_item_ids, p_expected_quote_hash)`이다. 이름은 확정된 기존 함수 명명과 맞춰야 한다.

한 트랜잭션 안에서 다음 순서로 처리한다.

1. service-role 전용 실행 권한 확인; API가 인증 사용자 ID를 넣고 DB가 모든 cart row의 소유자를 다시 확인
2. profile row를 먼저 lock해 동일 사용자 checkout/credit mutation 직렬화
3. idempotency row 조회/생성 및 request fingerprint 확인
4. 선택 cart row를 ID 정렬로 lock하고 소유자 검증; 미선택 행은 건드리지 않음
5. item/target/price/active/deleted/file 존재/subject를 DB join으로 다시 조회하고 일정한 key 순서로 lock
6. 선택 집합 전체에서 exact duplicate, bundle+subproduct, HWP+PDF 포함 관계, 이미 보유한 item/subproduct를 입력 순서와 무관하게 검증
7. 현재 가격과 기대 quote 비교; 변경 시 mutation 없이 반환
8. 잔액/credit source를 전역 lock 순서로 확인
9. target별 내부 `purchase_market_*` core 호출 또는 동등한 로직으로 credit allocation, order, line, entitlement 생성
10. checkout 합계/status 확정
11. 성공한 선택 cart row만 삭제
12. 전체 결과와 새 balance를 반환; 어느 단계든 예외면 전부 rollback

혼합 과목을 지원한다면 상위 checkout만 과목 비종속으로 두고 각 order는 target의 실제 subject를 가진다. 지원하지 않는다면 5단계에서 전체 subject가 하나인지 검사하고 아무 차감 없이 거절한다.

### 8.4 RPC 보안 및 멱등 조건

- `SECURITY DEFINER`, 고정 `search_path = public, pg_temp`
- `PUBLIC`, `anon`, `authenticated` EXECUTE revoke 후 `service_role`만 grant
- 모든 테이블 이름 schema-qualified
- p_user_id를 신뢰할 수 있는 서버 경계에서만 호출
- 가격/과목/소유권/상태는 클라이언트 payload가 아니라 DB로 확정
- operation key는 checkout과 line에 안정적으로 파생하고 unique로 강제
- replay는 새 transaction/consumption/order를 만들지 않고 기존 결과를 반환
- request fingerprint가 다르면 기존 결과를 반환하지 말고 충돌 처리
- serialization/deadlock failure는 같은 idempotency key로 제한 재시도 가능해야 함

## 9. 실제 DB 읽기 전용 조회 체크리스트

다음 결과를 확보하기 전에는 제약/RLS/grant/함수에 대해 PASS로 판정하지 않는다.

### 함수와 권한

- [ ] `pg_proc` + `pg_get_function_identity_arguments`로 `purchase_market_%`, `consume_credits%`, `refund_credits%`, `%market%refund%`, `%point_charge_refund%` 전체 overload 목록 조회
- [ ] `pg_get_functiondef(oid)`로 각 함수의 실제 최신 본문, `SECURITY DEFINER`, `search_path`, 예외/replay 동작, lock 순서 확인
- [ ] `proacl`/`information_schema.routine_privileges`로 PUBLIC/anon/authenticated/service_role EXECUTE 확인
- [ ] `consume_credits_once`의 operation key unique 범위와 같은 key+다른 payload 처리 확인
- [ ] `refund_credits_once`가 원 consume operation/transaction/consumption을 실제로 연결·검증하는지 확인
- [ ] `purchase_market_*`가 없다면 그 사실을 catalog 결과로 확정; 있다면 저장소 마이그레이션 누락으로 기록

### 제약·인덱스·트리거

- [ ] `pg_constraint` + `pg_get_constraintdef`로 이 문서의 market/credit/refund 테이블 FK/check/unique, `convalidated` 확인
- [ ] `pg_index`/`pg_indexes`로 partial unique의 실제 predicate, `indisvalid`, `indisready` 확인
- [ ] idempotency/operation key unique가 사용자와 request fingerprint를 어떤 범위로 묶는지 확인
- [ ] `pg_trigger` + `pg_get_triggerdef`로 updated_at 및 무결성 trigger 확인
- [ ] `credit_sources`의 음수/상한 check와 `credit_consumption.amount > 0` check 존재 여부 확인

### RLS와 table grant

- [ ] `pg_class.relrowsecurity/relforcerowsecurity`, `pg_policy.qual/with_check`로 모든 market/cart/credit/refund 정책 확인
- [ ] `information_schema.role_table_grants`와 `relacl`로 legacy `market_purchases` 및 v2 주문/entitlement의 anon/authenticated 쓰기 grant 확인
- [ ] schema/default ACL을 확인해 새 cart 테이블/함수에 예상 밖 자동 grant가 생기지 않는지 확인
- [ ] staging에서 authenticated 사용자가 legacy completed purchase를 직접 INSERT/UPDATE할 수 없는지 rollback 기반 권한 테스트

### 운영 데이터 무결성

- [ ] 각 테이블 실제 `count(*)`로 500행 pagination 의심 제거
- [ ] file.item과 subproduct.item, line.order/item/target, entitlement.item/target/source order/user/subject mismatch 재조회
- [ ] active exact entitlement 중복과 item+subproduct/file overlap 현황을 구분해 집계
- [ ] 한 order의 line 수, 같은 target line 중복, order/header-line 가격·유형·상태 불일치 확인
- [ ] completed order마다 idempotency key, credit consumption snapshot, active entitlement가 있는지 확인
- [ ] `sum(credit_consumptions.amount) = charged_credits`인지 order별 확인
- [ ] snapshot의 source/user가 실제 order user와 같고 실제 consumption/transaction에 대응하는지 확인
- [ ] 같은 idempotency/operation key의 payload fingerprint 충돌 및 중복 transaction 확인
- [ ] `remaining_credits < 0`, `remaining_credits > initial_credits`, profile cache와 ledger balance mismatch 확인
- [ ] refunded/revoked order에 active entitlement가 남거나 active entitlement의 source order가 completed가 아닌 행 확인
- [ ] 환불 요청과 대상 주문 상태, approved 금액, refund transaction, entitlement 상태의 1:1 대응 확인
- [ ] 다운로드 이벤트가 entitlement/order/file/item/user/subject와 일치하는지, 환불 뒤 다운로드 이벤트가 있는지 확인
- [ ] 동일 storage path/checksum이 여러 sellable target에 중복 연결된 현황 확인

### Storage

- [ ] `storage.buckets`에서 실제 market bucket ID, `public = false`, 파일 크기/MIME 제한 확인
- [ ] `storage.objects`의 policy/role grant에서 anon/authenticated 직접 SELECT가 불가능한지 확인
- [ ] DB에 저장된 bucket/path가 실제 object와 대응하는지, orphan/중복 path가 있는지 확인
- [ ] signed URL TTL과 환불/권한 취소 후 남는 접근 창을 정책적으로 수용하는지 확인

### 마이그레이션 drift

- [ ] 운영 migration history와 저장소 `supabase/migrations` 목록 대조
- [ ] 운영에만 있는 `*_once` 함수와 operation/transaction 컬럼의 생성 SQL 회수
- [ ] `src/types/supabase.ts`를 실제 대상 프로젝트에서 다시 생성했을 때 diff 확인
- [ ] 확인된 운영 정의를 새 기준 마이그레이션으로 재현할 수 있는지 dry-run/staging에서 검증

## 10. 출시 게이트

다음 조건을 모두 충족해야 장바구니 DB 설계를 승인할 수 있다.

- [ ] 선택 checkout 하나가 단일 DB 트랜잭션이며 일부 성공이 불가능하다.
- [ ] 동일 key 재시도와 동일 사용자 동시구매가 중복 차감/중복 권한을 만들지 않는다.
- [ ] 같은 key의 다른 payload는 명시적 충돌이 된다.
- [ ] bundle/subproduct/PDF-HWP 중복 선택 규칙이 입력 순서와 무관하다.
- [ ] 혼합 과목 정책이 명시되고 DB가 item-target-subject 일치를 강제한다.
- [ ] stale cart 가격은 무통보로 청구되지 않는다.
- [ ] order별 credit consumption snapshot이 부분 환불 단위와 정확히 맞는다.
- [ ] 시장 환불 승인도 원자적·멱등이고 provider 환불과 lock 순서가 일치한다.
- [ ] legacy purchase 직접 쓰기, v2 entitlement 위조, Storage 직접 읽기가 차단됨을 실제 권한 조회로 확인한다.
- [ ] 운영 catalog와 저장소 마이그레이션 drift가 해소되거나 명시적으로 인수된다.

## 11. 남은 불확실성

- 운영 `purchase_market_*` 존재 여부와 본문/권한은 제공된 증거로 확인할 수 없다.
- 운영 `consume_credits_once`/`refund_credits_once`의 본문, unique, lock, grant는 확인할 수 없다.
- 운영의 실제 RLS 식, table/routine grant, Storage bucket/policy는 확인할 수 없다.
- 운영 데이터 집계는 한 시점의 스냅샷이며 동시 쓰기 이후 상태를 보장하지 않는다.
- bundle 부분 보유 정가 정책과 혼합 과목 checkout 허용 여부는 기술 문제가 아니라 제품 정책 결정이 필요하다.

따라서 이 감사의 판정은 **“현행 단건 구매를 반복 호출하는 cart checkout은 출시 차단, 단일 원자 RPC 설계와 실제 DB catalog 감사 후 재검토”**이다.
