# 장바구니 구현 계획 v4 — 범위 축소·개발 DB 직접 검증

- 작성일: 2026-09-30 · 이전 판: [v3](./cart-implementation-plan.md) (이력으로 보존, 독립 R2 PLAN PASS)
- 상태: **R3 OK + Phase 0 결과·사용자 결정 반영본** (10절). Phase 0 실측: [cart-phase0-db-baseline.md](./cart-phase0-db-baseline.md) 10절
- 이 문서는 계획이다. 코드·migration·DB는 아직 변경하지 않았다.
- v3와 충돌하면 v4가 우선한다. v4가 언급하지 않은 세부 UI 문구·솔북 관찰은 v3와 [cart-reference-ui.md](./cart-reference-ui.md)를 따른다.

## 1. 결론과 v3 대비 변경

장바구니는 **V2 서브상품/번들만** 담고, 선택 항목을 **한 DB 트랜잭션의 원자 구매 RPC**로 크레딧 차감·주문·권한·cart 삭제까지 끝낸다. 기존 단건 구매도 같은 RPC(direct mode)로 옮긴다. v3의 quote 테이블, cart revision, legacy 판매, catalog revision, 탈퇴·잠금 재정렬·Storage 게이트는 MVP에서 빼거나 별도 트랙(9절)으로 넘긴다.

| v3 항목 | v4 | 이유 |
|---|---|---|
| 격리 DB·staging·백업 준비 게이트 | **삭제**. `kzcweelnzhcmiuvjgeyi`(운영 전 개발 DB)에 직접 적용·테스트 | 사용자 결정. 기존 데이터 삭제 작업만 사전 확인 |
| `market_checkout_quotes`, quote API, 5분 만료 | **삭제**. 항목별 `expectedCredits`를 DB가 잠금 하에 재계산·비교 | 가격 확인은 1회 계산 비교로 충분 |
| cart `revision`, ID+revision PATCH, 20/50 로컬 페이지 | **삭제**. `is_selected` last-writer-wins, 50행 한 화면 표시 | 구매 대상은 확인 Dialog의 명시적 ID 집합이 결정 |
| legacy PDF/HWP/ZIP 판매 단위, exact-kind, `OWNERSHIP_REVIEW_REQUIRED` | **삭제(조건부)**. legacy 전용 상품은 `legacy_*` 서브상품으로 DB 데이터 이관 후 legacy 단건 구매 410 | 판매 단위를 V2 하나로 통일 |
| `market_purchases` partial UNIQUE 교체 | **삭제** | legacy 신규 구매 없음 |
| `catalog_revision`, child trigger, `market_items FOR SHARE` | **삭제**. 트랜잭션 안에서 활성·게시·파일·가격 재검증 | 가격 비교가 불일치를 잡는다 |
| `market_checkout_batch_lines` | **변경**. `market_purchase_orders.checkout_batch_id` nullable FK | child는 이미 주문 1행 |
| `upgrade_base_order_id` 컬럼·자기참조 FK | **삭제**. 기준 PDF 주문을 결정적으로 선택해 `result_payload`에만 기록 | 스키마 변경 최소화 |
| 기존 테이블 복합 FK 보강(v3 5.6) | **별도 트랙**. cart는 target ID만 저장 | item/과목은 join으로 도출해 불일치 자체가 불가 |
| 탈퇴 원자화, 전 writer profile-first, Storage 하드게이트, 다운로드·환불 승인 잠금 | **별도 트랙** | 장바구니 원자성과 독립. 최소 안전장치만 유지(2.3) |
| 배치 FK RESTRICT | **변경**. `profiles ON DELETE CASCADE` | RESTRICT면 현 탈퇴의 순차 삭제 도중 profile 삭제 실패 → 새 부분 삭제 |

## 2. 범위와 결정

### 2.1 v3에서 유지
- 로그인 계정별 **서버 저장** 장바구니, 최대 50행, 영어/국어 과목 그룹 표시, 수량 1(중복 담기는 기존 행 반환).
- **크레딧 구매만**. Toss/KakaoPay는 충전 전용. 쿠폰·현금 결제·배송·대여권 제외.
- 선택 항목 **전부 성공/전부 롤백**. 성공 시 구매된 cart 행만 삭제, 미선택·새로 담긴 행 보존.
- 같은 상품의 번들+개별, PDF+PDF 포함 HWP 동시 선택은 **거절**(자동 선택 없음, 순서 무관).
- 부분 보유 번들은 **정가** 구매, 기보유분 차감 없음을 명시 확인(`acknowledgeNoDiscount`). 번들 환불은 새 번들 child만 되돌리고 기존 개별 권한 유지.
- PDF 보유자의 V2 HWP 차액 등 기존 보유·차단 규칙은 4절 R1~R6로 그대로 옮긴다.
- `/api/market/purchases/batch`는 **410 유지**. 단건 구매 HTTP 반복 호출로 장바구니를 만들지 않는다.
- 보안: 신규 테이블 RLS(소유자 SELECT만), 직접 DML REVOKE, RPC는 service_role만 EXECUTE, `SECURITY DEFINER` + `SET search_path = public, pg_temp` + 스키마 한정 이름. body의 userId·가격 권한·차감내역 불허(`expectedCredits`는 비교값일 뿐 차감 근거가 아니다).
- `MARKET_CART_ENABLED` 플래그는 **제거됨(사용자 결정 2026-09-30)**. 장바구니 화면·CRUD·checkout은 항상 켜진다. direct 단건 구매도 새 RPC를 사용한다. 기존 env kill switch `MARKET_V2_PURCHASE_ENABLED`는 **Route Handler가 RPC 호출 전에** 두 모드 모두 검사한다(DB는 env를 읽지 않음).
- 비로그인 담기는 로그인 후 원래 상품으로 복귀(기존 `next`/`buildAuthRedirectPath`로 통일), 충전 결과 화면(Toss success, Kakao result)에 `/cart` CTA. 자동 구매 재개 없음.

### 2.2 legacy 제외 조건 (P4)
1. Phase 0에서 **대상 상품** = "활성·게시·미삭제 + 활성 legacy 유료 파일 + 해당 kind 가격>0 + 활성 V2 서브상품/번들 없음" 수와, **대상 상품의** `market_purchases` completed 수를 센다. 대상 선정은 기존 `src/lib/market-subproduct-backfill.ts`의 `buildMarketSubproductBackfillDryRunReport` 규칙(kind별 가격>0 + 활성 파일, kind당 서브상품 1·파일 1)을 재사용하고 dry-run 결과를 Phase 0 기록에 첨부한다.
2. 대상 상품의 completed legacy 구매가 1건 이상이면 소유권 매핑이 필요하므로 **중단하고 사용자에게 보고**한다.
   - **Phase 0 결과(P0-5):** 대상 상품 1개(english), 대상 상품의 completed legacy 구매 0건. dry-run = 서브상품 2·파일 2·entitlement 0(`legacy_pdf` 1000 크레딧, `legacy_hwp_bundle` 1500 크레딧, `legacy_zip`은 가격 0·파일 없음으로 건너뜀). 2의 중단 조건에 해당하지 않는다.
3. 0건이면 규칙 기반 데이터 migration으로 `legacy_pdf`/`legacy_hwp_bundle`/`legacy_zip` 카테고리 서브상품과 파일 행(같은 storage path 참조, 파일 복사 없음)을 만든다. **ID·제목 하드코딩 금지**, 선택 조건만 코드에 둔다. 이관 서브상품은 `question_pdf`/`question_hwp` slug가 아니므로 R4·R5에 걸리지 않고 각각 정가·독립 권한이다.
4. 이 카테고리들은 `is_active=false`다(`20260528021000:20-25`). 구매 판정은 기존 코드와 같이 **카테고리 활성 여부를 보지 않는다**(4절 5단계). `legacy_hwp_bundle`의 표시명 `HWP & PDF`(`20260528010000:284,287`)는 이관 파일이 HWP 1개뿐이므로 DB 데이터 UPDATE로 `HWP 파일`로 고친다(삭제 아님, 실행 전 보고).
5. 재집계 0건 확인 후 `src/app/api/market/items/[itemId]/purchase/route.ts:64`의 legacy 분기를 `410 LEGACY_PURCHASE_CLOSED`로 바꾼다. 차단은 **구매 경로만**이다. legacy `market_item_files`/`market_purchases`를 읽는 다운로드·보관함·환불 경로는 기존 구매자 보호를 위해 유지한다. 상세 UI의 legacy 구매 버튼(`market-item-actions.tsx:785-831`)은 같은 단계에서 숨긴다.

### 2.3 별도 트랙으로 넘기며 유지하는 최소 안전장치
- (a) `market_checkout_batches.user_id`는 기존 V2 주문처럼 `profiles ON DELETE CASCADE`.
- (b) 교착(`40P01`)/serialization(`40001`) 실패는 Route Handler가 **같은 idempotency key로 최대 3회** 재시도, 소진 시 503. batch UNIQUE 위반(`23505`)도 같은 키로 1회 재호출해 4절 3단계 replay로 처리한다.
- (c) 각 child 주문은 **자기 `consume_credits` 반환값만** `credit_consumptions`에 저장.
- (d) batch child 환불은 기존 `approveMarketRefund` 경로를 쓴다. 이 경로는 원장 복구→상태 변경이 분리되고 최종 update에 status 조건이 없어 **동시 승인 시 이중 환불이 가능**하다(`src/lib/market-refunds.ts:516-557`). child 주문 수가 늘어나므로 **Phase 4 공개 전 최소 CAS를 선행 조건**으로 둔다.
  - `refundCredits` 호출 전에 `market_refund_requests`를 `status='pending'` 조건부 UPDATE로 `approved`(processed_by·processed_at 포함) 선점한다. 0행이면 409(이미 처리).
  - 선점 이후 어떤 단계가 실패해도 **`approved`를 유지**하고 `admin_note`에 실패 단계를 기록해 수동 처리한다. `failed`로 바꾸지 않는다: `failed`는 재요청 허용 상태이고(`market-refunds.ts:348`) pending 유일 인덱스(`20260602020000:96-102`, `pending|approved`) 밖이므로, "복구 성공 + 주문 상태 갱신 실패 → 주문 completed + 요청 failed → 재요청·재승인" 이중 환불이 재발한다. `approved`는 eligibility가 "이미 처리된 환불 요청"으로 막는다.
  - 스키마 변경 없음. 원자 RPC화는 9절.

## 3. DB 모델

### 3.1 `market_cart_items`
- `id uuid PK`, `user_id uuid NOT NULL REFERENCES profiles ON DELETE CASCADE`, `target_kind text NOT NULL CHECK (target_kind IN ('subproduct','bundle'))`.
- `subproduct_id uuid NULL REFERENCES market_item_subproducts(id) ON DELETE CASCADE`, `bundle_option_id uuid NULL REFERENCES market_item_bundle_options(id) ON DELETE CASCADE`.
- CHECK: `(target_kind='subproduct' AND subproduct_id IS NOT NULL AND bundle_option_id IS NULL) OR (target_kind='bundle' AND bundle_option_id IS NOT NULL AND subproduct_id IS NULL)`.
- `is_selected boolean NOT NULL DEFAULT true`, `created_at`, `updated_at`. 가격·item_id·과목·파일 경로는 저장하지 않는다.
- partial UNIQUE `(user_id, subproduct_id) WHERE target_kind='subproduct'`, `(user_id, bundle_option_id) WHERE target_kind='bundle'`. 인덱스 `(user_id, created_at DESC, id)`.

### 3.2 `market_checkout_batches`
- `id uuid PK`, `user_id uuid NOT NULL REFERENCES profiles ON DELETE CASCADE`, `mode text NOT NULL CHECK (mode IN ('cart','direct'))`, `idempotency_key uuid NOT NULL`, `request_payload jsonb NOT NULL`, `total_credits integer NOT NULL CHECK (total_credits > 0)`, `result_payload jsonb NOT NULL`, `created_at`. `UNIQUE(user_id, idempotency_key)`.
- **정규화 `request_payload`는 요청 입력값만으로 만든다**(DB 상태를 읽지 않음). 미지정 ack는 `false`.
  - cart: `{mode:'cart', lines: cartItemId 오름차순 [{cartItemId, expectedCredits, ack}]}`
  - direct: `{mode:'direct', itemId(path), target_kind, target_id, expectedCredits, ack}`
  - 같은 키·다른 payload는 409 `IDEMPOTENCY_CONFLICT`. Route Handler는 RPC 호출 전에 cart 행을 해석하지 않고 입력을 그대로 넘긴다.
- 성공 트랜잭션에서만 INSERT. processing 상태·보상 워커 없음.
- `result_payload`: child 주문 ID별 상품명·옵션명·원가·청구액·HWP 차액 기준 주문 ID(감사용, FK 없음) 스냅샷과 구매 후 잔액. batch에는 item FK를 두지 않는다.
- **상품 hard delete와의 관계:** 관리자 상품 DELETE는 이력 검사 없이 hard delete하며(`src/app/api/admin/market/items/[id]/route.ts:203-206`) 주문·라인·권한·환불요청이 item FK CASCADE로 삭제된다. batch는 남고 child 주문만 사라진다. 영수증 조회는 `result_payload` 스냅샷으로 표시하고 없는 child는 `deleted`로 표시한다(합계 불일치를 오류로 처리하지 않음). hard delete 차단은 9절.

### 3.3 기존 테이블 변경
- `market_purchase_orders.checkout_batch_id uuid NULL REFERENCES market_checkout_batches(id)`(기본 NO ACTION: batch 단독 삭제 차단, profile CASCADE 시 같은 문장에서 주문도 삭제되어 통과) + 인덱스.
- child 주문의 `idempotency_key`는 **NULL**. batch 키를 복사하면 `uq_market_purchase_orders_user_idempotency`(v2 schema:158-160)와 충돌한다.
- 그 외 기존 테이블 제약·이름·의미는 바꾸지 않는다.

### 3.4 권한
- 두 신규 테이블 `ENABLE ROW LEVEL SECURITY`, 정책은 `user_id = auth.uid()` SELECT만. 기본 ACL이 anon/authenticated에 전 권한을 주므로(P0-4) 생성 직후 `REVOKE ALL … FROM PUBLIC, anon, authenticated` 후 **`GRANT SELECT … TO authenticated`만 재부여**한다(소유자 SELECT 정책이 동작하도록). 쓰기는 service role RPC만.
- 신규 함수 `add_market_cart_item`, `set_market_cart_selection`, `remove_market_cart_items`, `evaluate_market_targets`, `checkout_market_selection`: `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role`. 모두 **`VOLATILE` 명시**(STABLE이면 잠금 대기 후에도 호출 시점 스냅샷을 써서 커밋된 변경을 못 볼 수 있음).
- PATCH/DELETE는 `set_market_cart_selection(p_user_id, p_ids, p_selected)`/`remove_market_cart_items(p_user_id, p_ids)`로 처리한다. `user_id = p_user_id AND id = ANY(p_ids)` 대상을 **`ORDER BY id FOR UPDATE`로 잠근 뒤** 갱신·삭제해 다건 잠금 순서를 checkout 4단계와 같게 고정한다.

## 4. 구매 트랜잭션

**가격·판정 공통 함수** `evaluate_market_targets(p_user_id, p_targets jsonb)`: target마다 item·과목·표시명·구매 가능 여부/사유·원가·청구액·부분보유 여부·차액 기준 주문을 계산한다. `GET /api/market/cart` 표시 가격과 checkout 비교·차감 가격이 **같은 SQL**에서 나온다. 규칙은 현 코드(`ensureUserCanPurchaseMarketV2Target` `market-purchase.ts:200-230`, `getMarketSubproductPairContext` `market-items-server.ts:1637-1755`)를 그대로 옮긴다. 보유 = 해당 사용자·상품의 `market_entitlements.status='active'`.
- **R1** 번들 target: item scope 권한 보유 → `ALREADY_OWNED`.
- **R2** 서브상품 target: item scope 권한 보유 → `ALREADY_OWNED`.
- **R3** 서브상품 target: 같은 subproduct scope 권한 보유 → `ALREADY_OWNED`.
- 공통 정의(`market-items-server.ts:1644-1650`, `:1678-1717`): 비교 대상 서브상품은 그 상품의 **활성·미삭제 서브상품만**이다. "PDF 포함 HWP" = 활성·미삭제 `market_subproduct_files` 중 `market_file_types.code`가 대소문자 무관 `pdf`인 파일이 있는 `question_hwp`. 파일 타입 자체의 `is_active`는 보지 않는다.
- **R4** `question_pdf` target: item scope 없음 + 활성·미삭제 PDF 포함 `question_hwp` 서브상품 보유 → `ALREADY_OWNED`(현 `blockedByOwnedHwp`, `market-purchase.ts:302-304`).
- **R5** HWP 차액: target이 상품의 **유일한** 활성·미삭제 `question_hwp` + 그 HWP가 PDF 포함 + item scope 없음 + 그 HWP 미보유 + 보유 중인 활성·미삭제 `question_pdf` 존재 + `HWP 가격 − 보유 PDF 현재가 최대값 > 0` → 청구액 = 차액. 하나라도 불충족이면 정가(차액 ≤ 0도 정가). 환불 대기 PDF도 현 코드처럼 제외하지 않는다(기준 PDF 환불은 기존 `isUpgradeBaseOrder` 승인 시 재검사가 막음). 기준 주문 = 최대가 PDF 권한의 `source_order_id`, 동률이면 주문 `created_at` → `id` 오름차순.
- **R6** 번들 target에 보유 서브상품이 있으면 부분보유 = true(정가 유지).

`checkout_market_selection(p_user_id, p_mode, p_item_id, p_lines jsonb, p_idempotency_key uuid)`:
1. 입력 검증: 1~50줄, UUID·정수 범위, 중복 ID/target 거절, 합계가 integer 범위를 넘으면 거절.
2. `SELECT … FROM profiles WHERE id = p_user_id FOR UPDATE`.
3. 입력에서 정규화 payload를 만들고 같은 `(user_id, key)` batch가 있으면 비교 → 같으면 `result_payload` + `alreadyCompleted:true`, 다르면 `IDEMPOTENCY_CONFLICT`. **cart·가격 읽기보다 먼저** 한다.
4. cart mode: `market_cart_items WHERE user_id AND id = ANY(...) ORDER BY id FOR UPDATE`. 누락 ID가 있으면 `CART_CHANGED(missingIds)`. `is_selected`는 보지 않는다. direct mode: cart를 읽지도 지우지도 않고, target이 `p_item_id` 소속이 아니면 `NOT_FOUND`.
5. `evaluate_market_targets`로 활성·게시·미삭제·활성 파일 존재·가격>0과 R1~R6를 판정한다(서브상품 카테고리 활성 여부는 보지 않음). 파일 존재 조건은 현 코드와 같다: 서브상품 = 그 서브상품의 활성·미삭제 파일 1개 이상(`market-items-server.ts:1828-1831`), 번들 = **상품 내 활성·미삭제 서브상품 파일 1개 이상, 파일이 속한 서브상품의 활성 여부 무관**(`:1870-1871`).
6. batch 내 충돌: 같은 상품 번들+서브상품, 같은 상품 `question_pdf`+PDF 포함 `question_hwp` → `CONFLICTING_SELECTION`. 부분보유 번들에 ack=false → `ACK_REQUIRED`. R1~R4 → `ALREADY_OWNED`.
7. 5의 청구액을 **한 번만** 계산해 비교·차감·기록에 동일하게 쓴다. 한 줄이라도 `expectedCredits`와 다르면 `PRICE_CHANGED(최신 항목별 가격)`.
8. 잔액 사전 확인: `consume_credits`와 같은 조건·같은 기준 시각 `now()`(active, remaining>0, 미만료, pending_refund 제외)으로 합계를 비교해 부족하면 `INSUFFICIENT_CREDITS(balance, shortfall)`.
9. batch INSERT(`result_payload`는 `'{}'`, 10에서 채움) → 줄마다 child 주문 UUID 생성 → `public.consume_credits(p_user_id, 청구액, 기존 resource_type, item_id, '<상품명> … 구매 #<child 주문 ID 앞 8자>')` → 반환값을 그 child의 `credit_consumptions`에 저장 → order·line·entitlement INSERT(`checkout_batch_id` 설정, `idempotency_key` NULL). resource_type/resource_id는 기존 단건 계약(`buildMarketV2PurchaseResourceType`, itemId)을 유지해 이용내역 표시를 바꾸지 않는다.
10. cart mode: 4에서 잠근 ID만 DELETE. `result_payload` UPDATE 후 반환.

**규칙:** 1~8의 업무 거절은 쓰기 전에 jsonb 오류 코드로 반환한다. 9의 `consume_credits`가 `RAISE EXCEPTION 'INSUFFICIENT_CREDITS'`(SQLSTATE `P0001`, `20260805110000:130`)를 내면 `consume_credits` 호출을 감싼 블록의 핸들러는 **`EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'INSUFFICIENT_CREDITS' THEN RAISE EXCEPTION USING ERRCODE = 'P0402', MESSAGE = 'INSUFFICIENT_CREDITS'; ELSE RAISE; END IF;` 형태만 허용**하고 `WHEN OTHERS`는 금지한다(`40P01` 등이 삼켜지면 차감 없이 주문이 생길 수 있음). 이렇게 다시 던져 전체 롤백하고, route는 PostgREST 오류의 `code = 'P0402'`로만 402를 분류한다. 9 이후 실패는 반드시 `RAISE`로 전체 롤백하고 `EXCEPTION`으로 잡아 성공처럼 반환하지 않는다. 잠금 순서는 profile → cart row(ID순) → credit source(`consume_credits` 내부 순서). catalog는 잠그지 않는다.

**멱등 흐름(T09/T12):** payload가 입력만으로 정해지고 3단계가 cart 읽기보다 앞서므로, 성공 후 cart 행이 삭제된 뒤의 같은 키 재시도도 `CART_CHANGED`가 아니라 저장된 영수증을 받는다(T12). 같은 키 동시 20회는 profile 잠금에서 직렬화되어 첫 요청만 9~10을 실행하고, 나머지는 잠금 획득 후 READ COMMITTED 새 스냅샷으로 커밋된 batch를 보고 replay한다(T09). UNIQUE는 최후 방어선이며 `23505`는 2.3(b)로 replay된다.

**만료 기준 시각(T40):** `consume_credits`는 `v_now := now()`(트랜잭션 시작 시각, `20260805110000:91`)로 만료를 판정한다. 8단계도 같은 `now()`를 써서 사전 확인과 실제 차감이 어긋나지 않게 한다. profile 잠금 대기 중 만료되는 크레딧이 소비될 수 있는 잔여 창(대기 시간만큼)은 공용 함수 변경이 필요하므로 9절로 넘긴다.

**동시성 근거(P6 정정):** 같은 대상 이중구매는 기존 entitlement partial UNIQUE가 이미 막는다. 새 RPC가 메우는 공백은 (1) 번들↔서브상품·PDF↔HWP 겹침의 무잠금 보유검사(`market-purchase.ts:280-318`)로 생기는 동시 구매, (2) 보상 실패 시 부분 차감·크레딧 유실: V2 보상 환불 예외 미처리(`market-purchase.ts:359`), 롤백 delete 오류 무시(`market-items-server.ts:1984-1989`), legacy 환불 실패 삼킴(`purchase/route.ts:82-95`). catalog를 잠그지 않으므로 관리자 가격 변경이 5단계 읽기 직후 커밋되면 사용자가 확인한 직전 가격으로 체결된다(의도된 동작).

`add_market_cart_item(p_user_id, p_target_kind, p_target_id)`: profile FOR UPDATE → target 존재·활성 확인 → 50행 제한 → `ON CONFLICT DO NOTHING` 후 기존/신규 ID 반환.

## 5. HTTP 계약

| API | 입력 (Zod strict) | 응답 |
|---|---|---|
| `GET /api/market/cart` | 세션 | ≤50행: id, item/과목/제목/옵션, targetKind/Id, `evaluate_market_targets` 가격·구매 가능·사유·부분보유, isSelected + 잔액 |
| `POST /api/market/cart/items` | `{targetKind:'subproduct',subproductId}` \| `{targetKind:'bundle',bundleOptionId}` | 행 ID(중복 시 기존), 행 수 / 422 `CART_LIMIT` |
| `PATCH /api/market/cart/items` | `{ids[], isSelected}` | 갱신 ID, `missingIds`(LWW, 소유 행만) |
| `DELETE /api/market/cart/items` | `{ids[]}` | 삭제 ID, 행 수(이미 없는 ID는 성공 취급) |
| `POST /api/market/cart/checkout` | `{items:[{cartItemId,expectedCredits,acknowledgeNoDiscount?}], idempotencyKey:uuid}` | 영수증(child 주문·금액·잔액) |
| `GET /api/market/cart/checkouts/[key]` | 본인 키 | 저장된 영수증 / 404 |
| `POST /api/market/items/[itemId]/purchase` (direct) | `{target:{…위 union}, expectedCredits, acknowledgeNoDiscount?, idempotencyKey:uuid}` | 같은 영수증 형식. path itemId와 target 소속 불일치는 404 |
| `/api/market/purchases/batch` | – | 410 유지 |

오류: 401 로그인, 404 타인/없는 대상, 409 `PRICE_CHANGED`·`CART_CHANGED`·`ALREADY_OWNED`·`ACK_REQUIRED`·`IDEMPOTENCY_CONFLICT`, 402 `INSUFFICIENT_CREDITS`, 410 `LEGACY_PURCHASE_CLOSED`, 422 `CONFLICTING_SELECTION`·입력 오류, 503 kill switch(`MARKET_V2_PURCHASE_ENABLED=false`)·재시도 소진(`MARKET_CART_ENABLED` 플래그는 제거됨, 사용자 결정). RPC의 jsonb 코드 필드 또는 SQLSTATE(`P0402` → 402, `40P01`/`40001` → 재시도, `23505` → replay)로만 분류하고 메시지 정규식으로 분류하지 않는다. `idempotencyKey`가 없는 옛 direct body는 차감 없이 400.

## 6. UI

- 상세 옵션 행에 `장바구니 담기`(서브상품/번들 구분), 성공 시 `계속 둘러보기 / 장바구니 보기`. 보유·판매 불가 사유 표시.
- 공유 헤더에 장바구니 배지(행 수). 로그인·로그아웃·담기·삭제·구매 후 재조회, 계정 전환 시 캐시 폐기. `path-aware-site-chrome`의 `/cart` 헤더 중복 방지.
- `/cart`: 50행 전부 한 화면(페이지네이션 없음), 과목 그룹. PC 좌 목록/우 요약, 모바일 한 열 + safe-area 하단 요약, 320px 가로 넘침 없음, 터치 44px 이상. 판매 불가 행은 자동 삭제하지 않고 선택 불가 표시.
- 구매 버튼 → 확인 Dialog(항목·금액·합계·잔액·부분보유 번들 체크박스) → **Dialog를 열 때 `crypto.randomUUID()` 키 1개를 생성**하고 확정·재시도 모두 그 키를 재사용해 checkout. 409는 최신 가격으로 Dialog를 갱신하고 **새 키**로 재확인. 네트워크 유실은 **같은 키**로 재시도/`checkouts/[key]` 조회. 402는 부족액 + 충전 링크(복귀 `/cart`).
- direct 단건도 같은 규칙이다. 현재 V2 키는 `Date.now()`를 포함해 재시도마다 달라지고(`market-item-actions.tsx:462,467`) legacy는 키가 없어 중복 방지가 무력하다. 이를 Dialog 단위 키로 교체한다. direct UI 전환은 route 변경과 함께 Phase 2에서 한다(T36, P2-3·P3-1·P3-2).
- 재사용: StudioContainer, Checkbox, Button, Dialog, EmptyState 등 기존 primitive와 `DESIGN.md` 토큰. raw hex·임의 폭/radius 금지. 착수 전 `/preview/design-system` 확인.

## 7. Phase별 작업과 검증 기준

DDL·데이터 migration은 개발 DB `kzcweelnzhcmiuvjgeyi`에 **Supabase MCP `apply_migration`으로 파일 단위 적용**하고, 조회·테스트 SQL은 MCP `execute_sql` 또는 `psql`로 실행한다. `psql`은 접속 정보를 명령 인자로 넘기지 않고 `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` 또는 `PGSERVICE` 환경변수로만 받는다(`supabase/tests/cart_concurrency.sh`, `market_cart_checkout.test.sql`과 같은 방식, 접속 정보는 문서·로그에 남기지 않음). SQL 테스트는 **`DO` 블록 assert**로 작성한다(pgTAP 미설치 확정, 설치하지 않음). 테스트 데이터는 `cart-test-` 접두 fixture 사용자·상품으로 만들고 **그 fixture만** 정리한다. 실패 주입은 fixture ID에만 `RAISE`하는 임시 trigger로 하고 테스트 종료 시 DROP한다. 기존 데이터 DELETE/UPDATE는 사용자 확인 후에만 한다. 각 Phase는 독립 검증 OK 후 다음으로 진행한다(AGENTS.md 작업 Loop). 아래 `P<phase>-<n>` 번호가 8절 매트릭스의 배정 기준이다.

### Phase 0 — 개발 DB 기준선 (DDL 없음)
- 작업: 결과를 `docs/cart-phase0-db-baseline.md`에 기록. 로컬 lint/build 기준선은 `docs/cart-phase0-local-baseline.md`.
- **P0-1** `select pg_get_functiondef('public.consume_credits(uuid,integer,text,uuid,text)'::regprocedure)`가 `20260805110000_enforce_credit_expiration.sql` 정의와 의미상 같음(차이는 줄 단위 기록, `v_now := now()` 포함 확인). `get_credit_balance_snapshot`, `refund_credits`도 동일.
- **P0-2** `pg_indexes`(`market_entitlements`, `market_purchase_orders`, `market_refund_requests`)에 active entitlement partial UNIQUE 3개, `uq_market_purchase_orders_user_idempotency`, refund pending/approved 유일 인덱스 2개 존재.
- **P0-3** `select proname, prosecdef, proconfig, proacl from pg_proc where proname like '%\_once'`와 `grep -rn "_once" src/` 호출처 기록(로컬 기준 `src/types/supabase.ts:4359`, `:4741`에만 등장). 신규 RPC는 `_once`를 호출하지 않음.
- **P0-4** `pg_default_acl`과 `market_purchase_orders`의 `information_schema.role_table_grants`로 Phase 1 REVOKE 목록 확정. `pg_extension`에서 pgTAP 유무 확인. → 결과: 기본 ACL이 신규 테이블·함수에 anon/authenticated 전 권한을 줌, pgTAP 미설치. REVOKE 확정안은 baseline 10.3.
- **P0-5** 2.2-1 대상 상품 수·대상 상품의 completed legacy 구매 수(쿼리 원문 포함), backfill dry-run 결과, `market_cart_items`/`market_checkout_batches` 미존재.
- **P0-6** migration 이력·drift: `select version from supabase_migrations.schema_migrations order by version`과 `supabase/migrations/` 파일 목록 대조, 원격 전용 객체(`_once` 함수, `credit_consumption.transaction_id/operation_key`, `credit_transactions.operation_key`, `market_items.subject_code` 등)를 `information_schema.columns`·`pg_proc`로 확정. 로컬만으로 원격 재현이 안 되는 원인(`docs/cart-phase0-local-baseline.md` 0절: `credit_transactions` 생성 순서, `20260206` 정책명 중복)을 기록.
- **P0-7** 기존 판매 테이블 직접 DML: `market_purchases`, `market_purchase_orders`, `market_purchase_lines`, `market_entitlements`에 대해 `has_table_privilege('authenticated', t, 'INSERT'|'UPDATE'|'DELETE')`와 `pg_policies`(cmd INSERT/UPDATE/DELETE, roles authenticated)를 기록. 로컬 기준 `market_purchases`에 사용자 INSERT/UPDATE 정책이 남아 있다(`20260317113000:251-264`). **GRANT와 정책이 함께 열려 있으면 가격 우회 구매가 가능하므로 Phase 1 선행 조건(P1-7)으로 격상**, 닫혀 있으면 9절.
- PASS: P0-1~7 결과와 차이 설명이 기록됨. 미해결 drift나 2.2-2 중단 조건이면 FAIL로 두고 보고. → 실측 결과 P0-1~5 PASS, P0-7 열림, P0-6 이력 불일치는 사용자 결정(Phase 1 `apply_migration` 단건 적용, 전체 정합은 9절)으로 처리.

### Phase 1 — 스키마 (migration `supabase/migrations/20260930020304_market_cart_checkout.sql`, 적용 완료(2026-09-30))
- **migration 적용 방식(사용자 결정):** 이번 대상 파일만 Supabase MCP `apply_migration`으로 **한 파일씩** 적용한다. 신규 migration은 원격 실제 스키마(P0-1·P0-6)를 기준으로 작성한다. 개발 DB이므로 별도 백업은 두지 않는다(사용자 결정).
  - **작성 규칙:** 사전 dry-run이 없으므로 각 파일은 단일 트랜잭션 실행을 전제로 하며(P1-8 절차로 확인) 재실행해도 안전해야 한다. `CREATE TABLE/INDEX … IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP POLICY/FUNCTION … IF EXISTS`, `ADD COLUMN IF NOT EXISTS`, 제약·정책 추가 전 `pg_constraint`/`pg_policies` 존재 확인(`DO` 블록), 데이터 INSERT는 `NOT EXISTS`/`ON CONFLICT` 가드. 하나라도 실패하면 파일 전체가 롤백된다.
  - **version 맞춤:** `apply_migration`은 적용 시각으로 version을 기록한다. 적용 직후 `select version, name from supabase_migrations.schema_migrations where name = '<이름>'`로 version을 조회해 로컬 파일명을 `<그 version>_<이름>.sql`로 바꾼다(P1-8에서 검증).
  - 이력 전체 정합(52/25/24)과 fresh replay는 9절이다.
- 작업 순서(각각 별도 `apply_migration`). 로컬 전용·원격 미적용 migration 3개는 장바구니와 무관해 **이번 작업에서 적용하지 않는다**(사용자 결정 2026-09-30, 9절).
  1. **장바구니 migration** `20260930020304_market_cart_checkout.sql`(적용 완료(2026-09-30). Phase 1의 첫 `apply_migration`이므로 P1-8의 단일 트랜잭션 확인 절차를 여기서 먼저 적용): 3절 테이블·컬럼·RLS, 신규 함수 `add_market_cart_item`·`set_market_cart_selection`·`remove_market_cart_items`(Phase 2 함수는 Phase 2 migration). baseline 10.3 확정안대로 신규 테이블 생성 직후 `REVOKE ALL … FROM PUBLIC, anon, authenticated` 후 `GRANT SELECT … TO authenticated`(3.4), 신규 함수 `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` 후 service_role GRANT. **P0-7 '열림' 확정**에 따라 `market_purchases`의 `Users can insert own market purchases`·`Users can update own pending market purchases` 정책 DROP과 네 판매 테이블 `REVOKE INSERT, UPDATE, DELETE, TRUNCATE … FROM anon, authenticated`(서버 쓰기는 이미 service role: `createMarketPurchase` 등 `getAdminSupabase`). 사용자 결정에 따라 `DROP FUNCTION IF EXISTS public.grant_credits(uuid, integer, text, text, text, uuid)`, `DROP FUNCTION IF EXISTS public.deduct_credits(uuid, integer, text, text, uuid)`(원격에만 존재하고 로컬 migration에는 정의가 없어 출처 미확인. 존재하지 않는 `user_credits` 참조, anon EXECUTE 가능. 시그니처는 적용 직전 `pg_get_function_identity_arguments`로 재확인).
  2. **legacy 이관 데이터 migration** `20260930020347_backfill_legacy_only_market_items.sql`(적용 완료(2026-09-30)): 2.2-3·4 규칙 SQL(대상 조건으로 선택, `NOT EXISTS` 가드로 재실행 무해), `legacy_hwp_bundle` 표시명 `HWP 파일` UPDATE.
  3. `src/types/supabase.ts` 재생성, SQL 테스트 `supabase/tests/market_cart_checkout.test.sql`(`begin … rollback`, `DO` 블록 assert)와 동시성 스크립트 `supabase/tests/cart_concurrency.sh`(psql 병렬 세션) 신설.
- **P1-1** CHECK 위반: 두 target 동시/모두 NULL/kind 불일치 INSERT가 `23514`.
- **P1-2** (권장 검증 — 공개 전 필수 아님. 사용자가 개발 단계임을 이유로 배포 안전장치 대신 git 되돌리기를 롤백 수단으로 선택(2026-09-30)) 동시성 스크립트: 동일 target 2세션 동시 담기 → 행 1·두 응답 ID 동일, 49행에서 2세션 동시 담기 → 최종 50행·한쪽 `CART_LIMIT`, 순차 51번째 거부.
- **P1-3** `set role authenticated` + 다른 `request.jwt.claims`로 타인 행 SELECT 0, 직접 INSERT/UPDATE/DELETE `42501`. 두 신규 테이블 `has_table_privilege('anon', t, 'SELECT'|'INSERT'|'UPDATE'|'DELETE'|'TRUNCATE') = false`, `has_table_privilege('authenticated', t, 'INSERT'|'UPDATE'|'DELETE'|'TRUNCATE') = false`, `has_table_privilege('authenticated', t, 'SELECT') = true`. 신규 함수 전부 `has_function_privilege('authenticated'|'anon', …, 'execute') = false`. PATCH/DELETE RPC가 타인 ID를 섞어도 타인 행 변경 0.
- **P1-4** 신규 함수 전부 `pg_get_functiondef`에 `SECURITY DEFINER`, `search_path=public, pg_temp`, `VOLATILE`(`pg_proc.provolatile = 'v'`).
- **P1-5** fixture 사용자에 batch·주문이 있을 때 `delete from profiles where id = fixture` 성공, batch·주문 함께 삭제.
- **P1-6** 이관 후 대상 상품 재집계 0건, 이관 서브상품 2개(`legacy_pdf` 1000, `legacy_hwp_bundle` 1500)·파일 2개로 dry-run과 일치, zip 서브상품 0, `legacy_hwp_bundle` 표시명 `HWP 파일`.
- **P1-7** (P0-7 '열림' 확정, 필수) 두 정책이 `pg_policies`에 없고, `has_table_privilege('authenticated'|'anon', t, 'INSERT'|'UPDATE'|'DELETE'|'TRUNCATE') = false`(네 테이블, migration의 REVOKE에 TRUNCATE 포함 확인), `set role authenticated`로 네 판매 테이블 직접 INSERT/UPDATE가 `42501` 또는 RLS 거부, 기존 단건 구매·보관함 조회 정상.
- **P1-8** 이번에 `apply_migration`한 각 파일(장바구니, legacy 이관)에 대해 적용 직후 조회한 `schema_migrations.version`과 로컬 파일명 version이 일치하고(`ls supabase/migrations | grep <이름>`), 원격 이력 행 수 증가 = 적용 파일 수. 같은 파일을 `execute_sql`로 한 번 더 실행해도 오류·중복 행 0(재실행 안전 확인, 이력 행은 추가하지 않음).
  - **미확인 전제 — `apply_migration`의 단일 트랜잭션 실행 여부:** 확인하지 않았다. 의도적 실패 구문을 넣어 시험하지 않는다. 대신 첫 적용 전 MCP 도구 설명으로 트랜잭션 처리 여부를 확인해 기록하고, 모든 적용마다 ① 적용 전 그 파일이 만들거나 바꾸는 객체 체크리스트(테이블·컬럼·인덱스·제약·정책·함수·GRANT/REVOKE·데이터 행)를 작성하고 ② 성공이면 체크리스트 전부 반영, 실패면 전부 미반영(`pg_class`/`to_regclass`, `information_schema.columns`, `pg_indexes`, `pg_constraint`, `pg_policies`, `pg_proc`, `aclexplode`, 데이터 `count`로 확인)임을 대조한다. 실패인데 하나라도 반영돼 있으면 **부분 적용으로 판정해 이후 적용을 중단하고 보고**한다.
- **P1-9** `grant_credits`·`deduct_credits`가 `pg_proc`에 0행, `grep -rn "grant_credits\|deduct_credits" src`가 `src/types/supabase.ts`(재생성 후 제거) 외 0건.

### Phase 2 — 원자 구매 RPC + 단건 이관 (migration `supabase/migrations/20260930024829_market_checkout_rpc.sql`, 적용 완료(2026-09-30))
- 작업: `evaluate_market_targets`, `checkout_market_selection`(4절)을 별도 migration `20260930024829_market_checkout_rpc.sql`로 만들어 `apply_migration` 단건 적용(P1-8과 같은 이력·파일명 확인, 신규 함수 REVOKE/GRANT·`VOLATILE`은 P1-3·P1-4 기준으로 재확인), direct route를 RPC 호출로 교체하면서 **같은 변경에서 direct 구매 UI(`market-item-actions.tsx`)의 요청 body를 `{target, expectedCredits, idempotencyKey(Dialog 단위 UUID)}`로 전환**(route만 바뀌어 기존 UI가 400을 받는 중간 상태 금지), legacy 구매 분기 410·버튼 숨김, 재시도 래퍼(2.3(b)), `market-purchase.ts`의 V2 보상 경로를 호출처 없는 상태로. 2.3(d) 환불 최소 CAS(`market-refunds.ts`).
- **P2-1** SQL 테스트(단일 세션): T06, T07, T10, T12(성공 후 cart 행 삭제 상태에서 같은 키 재호출 → 같은 영수증), T15(entitlement INSERT 실패 주입 → 원장·잔액·주문·권한·cart 전후 동일), T16, T17, T18(순서 바꿔 2회), T19, T24, T26, T32, T40(만료 과거/미래/NULL·pending_refund 소스 조합에서 8단계 합계 = `get_credit_balance_snapshot` 사용 가능액, 통과 후 consume 부족 0), N2, N5, R1~R5 각 행(N8~N12), consume 부족 주입 시 `P0402` → 402, 다른 예외(예: `40P01`·다른 `RAISE`) 주입 시 전체 롤백·원래 SQLSTATE 보존.
- **P2-2** (권장 검증 — 공개 전 필수 아님. 사용자가 개발 단계임을 이유로 배포 안전장치 대신 git 되돌리기를 롤백 수단으로 선택(2026-09-30)) 동시성 스크립트: T09, T13, T14(번들 vs 서브상품, cart vs direct 동시 → 하나만 성공), T25, T27(가격 UPDATE와 checkout 동시 → 확인 가격 체결 또는 409), N1(두 세션 교착 유도 → 같은 키 재시도로 차감 1).
- **P2-3** `curl -X POST /api/market/purchases/batch` → 410, legacy body → 410(N3), 키 없는 direct body → 400(차감 0), 상세 화면 단건 구매 버튼이 새 body로 성공(200), kill switch OFF → 503(RPC 미호출).
- **P2-4** `grep -rn "createMarketV2PurchaseWithCompensation" src/` 호출처 0.
- **P2-5** N6(fixture 상품 hard delete 후 `GET /api/market/cart/checkouts/[key]` 200, 스냅샷 + `deleted` child), N7(① 같은 요청 동시 승인 2회 → `credit_transactions` 환불 1건·한쪽 409 ② 복구 후 주문 상태 UPDATE 실패 주입 → 요청 `approved` 유지·`admin_note` 기록, 같은 주문 환불 재요청 불가).

### Phase 3 — API·UI
- 작업: 5절 route, `src/lib/market-cart-server.ts`, `/cart`, 상세 담기, 헤더 배지, 로그인 복귀·충전 CTA. `MARKET_CART_ENABLED`는 구현 후 **제거됨(사용자 결정 2026-09-30)**.
- **P3-1** (로그인 필요분은 사용자 확인, 권장 검증) route 확인(`curl`/fetch): 401(비로그인), 404(타인 행), body에 `userId`/`priceCredits` 추가 시 400, T02, T12(HTTP 응답 유실 후 같은 키), T36.
- **P3-2** (사용자 브라우저 확인, 권장 검증) 브라우저 `http://localhost:4000`: 320/768/1440px 가로 스크롤 0, 키보드만으로 선택→Dialog→확정, 계정 전환 후 배지 갱신, 409 후 새 가격 Dialog, 오프라인 전환 후 같은 키 재시도로 차감 1회(cart·direct 모두, 네트워크 탭에서 재시도 요청의 `idempotencyKey` 동일 확인), 이관 상품(N3)을 담아 구매·다운로드.
- **P3-3** **제거됨(사용자 결정 2026-09-30)**: 플래그 제거로 flag OFF 검증 대상이 없다. kill switch OFF 시 503은 P2-3에서 확인한다.

### Phase 4 — 통합
- **P4-1** `npm run lint`, `npm run build`가 Phase 0 기준선 대비 새 실패 0.
- **P4-2** P1~P3 전 항목 재실행 PASS, 보관함·단건 환불·다운로드 회귀(T21), `git diff --stat`이 계획 파일 범위 안.
- **P4-3** N7: 2.3(d) 최소 CAS 구현·코드 대조 OK(Phase 2). 동시 승인 실행 확인은 권장 검증 — 공개 전 필수 아님. 사용자가 개발 단계임을 이유로 배포 안전장치 대신 git 되돌리기를 롤백 수단으로 선택(2026-09-30).
- 문제 시 git으로 코드 변경을 되돌린다(플래그 제거에 따른 사용자 결정, 개발 단계). DB는 additive 스키마를 남기며 테이블 DROP·금융 이력 삭제를 롤백 수단으로 쓰지 않는다.

## 8. 테스트 매트릭스 (v3 T번호 매핑)

| 번호 | 시나리오 → 합격 기준 | v4 | 검증 |
|---|---|---|---|
| T01 | 동일 target 동시 담기 → 행 1, 같은 ID | 유지 | P1-2 |
| T02 | 타인 cart/batch/key 접근 → 404·mutation 0, anon 401 | 변경(quote 제외) | P3-1 |
| T03 | 다른 상품 target FK | 삭제(item/과목 미저장) | – |
| T04 | target 조합 CHECK | 변경(legacy kind 제외) | P1-1 |
| T05 | 50 한도 동시 추가 → 최대 50 | 유지 | P1-2 |
| T06 | A+B 중 B 판매 중지 → 전체 차감·주문·삭제 0 | 유지 | P2-1 |
| T07 | Dialog 후 가격/파일/보유 변경 → 409 + 최신 가격, 차감 0 | 변경 | P2-1 |
| T08, T37 | 페이지 밖 선택 | 삭제(페이지네이션 없음) | – |
| T09 | 같은 키 동시 20회 → batch 1, 차감 1 | 유지 | P2-2 |
| T10 | 같은 키 다른 payload → 409 | 변경 | P2-1 |
| T11 | 같은 quote 다른 키 | 삭제(T13으로 흡수) | – |
| T12 | cart 삭제·응답 유실 후 같은 키 → 같은 영수증 | 변경 | P2-1, P3-1 |
| T13 | 다른 키 동일 target 동시 → 소유권·차감 1회 | 유지 | P2-2 |
| T14 | cart vs direct 겹침 동시, batch 410 | 변경 | P2-2, P2-3 |
| T15 | child 기록 중 실패 주입 → 전부 이전 상태 | 유지 | P2-1 |
| T16 | child별 소비 합 = 청구액, 총합 = total | 유지 | P2-1 |
| T17 | 만료/pending_refund/부족 → 유효 소스만, 402 | 유지 | P2-1 |
| T18 | PDF+포함 HWP / 번들+개별 → 거절, 순서 무관 | 유지 | P2-1 |
| T19 | PDF 보유 → HWP 차액, 기준 주문 결정적 선택 | 변경 | P2-1 |
| T20, T23 | 환불 기준 주문·다운로드 승인 경합 | 삭제 → 9절 | – |
| T21 | child 하나 환불, 다른 child 유지 | 유지 | P4-2 |
| T22 | 동일 환불 승인 동시 요청 | 변경 → N7 | P2-5 |
| T24 | 영/국 혼합 → child 과목 정확 | 유지 | P2-1 |
| T25 | 구매 중 다른 탭 담기 → 새 행 보존 | 유지 | P2-2 |
| T26 | 정수 한도·잘못된 body·중복 ID → 차감 전 거절 | 유지 | P2-1 |
| T27 | 가격/활성/파일 변경과 checkout 경합 → 확인 가격 체결 또는 409 | 변경 | P2-2 |
| T28, T33, T34, T35, T38 | 탈퇴·writer 재정렬·Storage | 삭제 → 9절 | – |
| T29 | flag OFF → 신규 cart 차단, 기존 조회 유지 | 삭제(플래그 제거, 사용자 결정 2026-09-30) | – |
| T30 | anon/authenticated 직접 DML·RPC → 거부 | 유지 | P1-3 |
| T31, T39 | legacy 재구매·exact-kind | 삭제 | – |
| T32 | 부분보유 번들 ack 없음 409, ack 시 정가·기존 권한 보존 | 변경 | P2-1 |
| T36 | direct: 키 필수·Dialog 단위 1회 생성, replay 1회, path/target 위조 차단 | 변경 | P2-3, P3-1, P3-2 |
| N13 | 판매 테이블 anon/authenticated 직접 INSERT/UPDATE 거부(P0-7 열림 확정) | 신규 | P1-7 |
| N14 | `grant_credits`·`deduct_credits` DROP, 호출처 0 | 신규 | P1-9 |
| T40 | 8단계 잔액 확인과 `consume_credits`가 같은 조건·`now()` 사용. 잠금 대기 중 만료 창은 9절 | 변경 | P2-1 |
| N1 | 40P01 유도 → 같은 키 재시도 ≤3, 차감 1 | 신규 | P2-2 |
| N2 | child `idempotency_key` NULL, 같은 사용자 연속 batch 성공 | 신규 | P2-1 |
| N3 | legacy 이관 상품 V2 담기·구매, legacy 단건 410 | 신규 | P1-6, P2-3, P3-2 |
| N4 | batch 보유 fixture의 profile 삭제 성공(CASCADE) | 신규 | P1-5 |
| N5 | 확인 후 삭제된 cart ID 포함 checkout → 409 `CART_CHANGED` | 신규 | P2-1 |
| N6 | 상품 hard delete 후 영수증 → 스냅샷, 없는 child `deleted` | 신규 | P2-5 |
| N7 | 환불 동시 승인 → 복구 1회·409, 선점 후 실패 → `approved` 유지·재요청 불가 | 신규 | P2-5, P4-3 |
| N8 | R1: item scope 보유자의 번들 → `ALREADY_OWNED` | 신규 | P2-1 |
| N9 | R2: item scope 보유자의 서브상품 → `ALREADY_OWNED` | 신규 | P2-1 |
| N10 | R3: 같은 서브상품 보유 → `ALREADY_OWNED` | 신규 | P2-1 |
| N11 | R4: PDF 포함 HWP 보유자의 `question_pdf` → `ALREADY_OWNED`(HWP에 PDF 파일 없으면 구매 가능) | 신규 | P2-1 |
| N12 | R5 미적용: 활성 HWP 2개 / HWP에 PDF 파일 없음 / 차액 ≤ 0 → 정가 | 신규 | P2-1 |

## 9. 별도 트랙 (후속 과제)

| 항목 | 근거·현 위험 | MVP에서의 처리 |
|---|---|---|
| 배포 안전장치(feature flag) | `MARKET_CART_ENABLED` 제거(사용자 결정 2026-09-30). 장바구니가 항상 켜져 문제 시 즉시 차단 수단이 없음 | 개발 단계라 git 되돌리기로 롤백. 공유·운영 배포 전에 재도입 여부 재검토 |
| 탈퇴 원자화(account_state, account_deletion_jobs, tombstone, 202 `WITHDRAWAL_PENDING`, T28/T34/T35) | `withdraw/route.ts:46-66` HTTP 순차 삭제, Auth 실패 시 부분 상태 | batch CASCADE로 새 실패 지점 추가 안 함 |
| 기존 탈퇴가 V2 주문을 CASCADE 삭제(금융이력 보존) | `market_purchase_orders.user_id … on delete cascade`(v2 schema:140) | 현행 유지, 정책 결정 필요 |
| 모든 잔액 writer profile-first 재정렬(T33) | point-charge refund finalizer가 source→profile 순서(`20260818073025:124-203`) | 교착은 같은 키 3회 재시도로 흡수 |
| 잠금 대기 중 크레딧 만료(v3 T40) | `consume_credits`의 `now()`는 트랜잭션 시작 시각 | 공용 함수 미변경, 잔여 창 = profile 잠금 대기 시간 |
| Storage RLS 하드게이트(T38) | `market-files` 정책이 migration에 없음 | 기존 서버 다운로드 API 경로 유지 |
| 다운로드·환불 승인 잠금 재정렬(T20/T23) | 다운로드 최종 승인과 환불 승인의 경합 | 기존 `isUpgradeBaseOrder` 동적 보호 유지 |
| `approveMarketRefund` 원자 RPC화 | 원장 복구·상태 변경 분리, 보상 없음(`market-refunds.ts:516-557`) | 최소 CAS만 선행(2.3(d)) |
| 관리자 상품 hard delete가 구매·주문·권한·환불요청 CASCADE 삭제 | `src/app/api/admin/market/items/[id]/route.ts:203-206`, 이력 검사 없음 | batch는 남고 영수증은 스냅샷 표시(3.2) |
| `grantCreditsAsAdmin` 비원자·비멱등 | `src/lib/credits.ts:396-448` | 변경 없음 |
| 기존 테이블 복합 FK 보강(v3 5.6) | 과목만 맞는 FK | cart는 target ID만 저장 |
| migration 이력 전체 정합(52/25/24)·fresh replay | 이름만 같고 version 다름 52, 원격 전용 25, 로컬 전용 24(baseline 10.4). `credit_transactions` 생성 순서·`20260206` 정책명 중복. **경고:** 정합 전 누군가 `supabase db push`를 실행하면 로컬 전용 migration이 함께 적용된다 — `20251209000000`(`user_credits` 재생성), `20260306000000`(`consume_credits` 구버전 회귀·authenticated EXECUTE), `20251124155428`(provider CHECK에서 claude 제거)의 3건(`20260805140000`은 두 UPDATE에 `NOT LIKE` 가드가 있어 no-op, baseline 정정본과 일치) | Phase 1~2는 개별 `apply_migration`만. 정합 완료 전 `db push`·`migration repair` 금지 |
| 로컬 전용·원격 미적용 migration 3개(사용자 결정: 이번 작업 제외, 로컬 파일 유지) | ① `20251209100000_add_admin_logs`(2025-12-09 커밋 `632944e`): 원격 미적용, 테이블에 쓰는 코드 0(`src/app/api/admin/stats/route.ts`만 fallback 읽기) → 과거 파일로 불필요 판단. ② `20260121134000_fix_settings_rls`(2026-02-04 커밋 `c483fb2`): `src/app/api/admin/settings/actions.ts:64-66`는 UPDATE만 하고 원격 기존 `Admins can update system settings`가 허용, 로고는 service role → 대체되어 불필요. ③ `20260730010000_create_market_menu_groups`(2026-08-05 커밋 `c911fb7`): 관리자 menu-management의 `MarketMenuGroupsManager`가 여전히 쓰는데 원격에 테이블이 없음(쓰기 실패 추론). 2026-09-02 `market_category_groups/items`와의 관계는 사용자 결정 대기 | 적용하지 않음. 이력 정합 전 `db push` 금지 경고 동일 적용 |
| 기본 권한·credit 테이블 권한 정리 | `ALTER DEFAULT PRIVILEGES`가 신규 객체에 anon/authenticated 전 권한 부여, credit 3종 anon/authenticated TRUNCATE(baseline 10.3) | 신규 객체는 생성 직후 명시 REVOKE |
| `refund_credits` 잠금 순서 | JSON source를 status 무관·비정렬로 잠금(추론, `20260805110000`) | 변경 없음 |
| 탈퇴 금융이력 count 오류 미검사(fail-open) | `withdraw/route.ts:35-44`가 count `error`를 보지 않음 | 장바구니 범위 밖, 기록만 |
| legacy 다운로드 게시·활성 미검사 | `download/route.ts:140-148`가 `deleted_at`만 검사 | 장바구니 범위 밖, 기록만 |
| `upgrade_base_order_id` 관계 기록 | 기준 주문의 영구 연결 부재 | `result_payload` 감사 기록만 |

## 10. 검증 기록

| 회차 | 대상 | 검증자 | 판정 | 근거·보완 사항 |
|---|---|---|---|---|
| R1 | v4 초안 | 독립 검증(plan-critic) | FAIL(B1~B4) | B1: 정규화 payload를 입력값만으로 정의, route 선해석 금지, 3단계를 cart 읽기 앞에 두고 T09/T12 성립 근거 추가(3.2, 4절). B2: CAS 선점 후 실패 시 `failed` 대신 `approved` 유지 + `admin_note`, N7에 실패 주입·재요청 불가 추가(2.3(d)). B3: 현 코드 보유·차단 규칙 R1~R6 열거(R4 blockedByOwnedHwp 포함)와 N8~N12 추가(4절). B4: 매트릭스 전 행에 `P<phase>-<n>` 배정, T01/T05 동시성은 P1-2, T40은 `now()` 일치 유지 + 잠금 대기 창 9절. 비차단: 대상 상품 한정 집계·backfill 재사용·카테고리 비활성·`HWP & PDF` 명칭(2.2), R5 환불 대기 규칙을 코드와 일치·GET/checkout 공통 SQL(4절), kill switch route 검사·`23505` replay(2.1, 2.3(b)), consume 설명에 child ID 앞자리(4절 9) |
| R1 추가 | v4 R1 보완본 + 로컬 기준선 | 팀 리드 전달 | 반영 | `cart-phase0-local-baseline.md` 발견 반영: Phase 1 migration 전략(원격 스키마 기준·`db push`, fresh replay 제외, `db pull`/`migration repair`), P0-6 drift·P0-7 판매 테이블 DML 실측과 조건부 선행 조건(P1-7, N13), direct/cart UI 키를 Dialog 단위 `randomUUID`로(6절, T36), 9절에 fresh replay·refund_credits 잠금·탈퇴 count fail-open·legacy 다운로드 게시 미검사 추가 |
| R2 | v4 265줄 `33d60d1f…` | 독립 검증 | OK | 비차단 N1~N9 반영: `db push --dry-run` 확인·이력 불일치는 `migration repair`만(7절 Phase 1, 9절), direct UI body 전환을 Phase 2 route 변경과 함께(P2-3), R4·R5 활성·미삭제 서브상품·파일 타입 `is_active` 미검사 문구(4절), 번들 파일 존재 조건(5단계), `INSUFFICIENT_CREDITS` → `P0402` SQLSTATE 분류(4·5절), PATCH/DELETE RPC `ORDER BY id FOR UPDATE`(3.4), 신규 함수 `VOLATILE`(3.4, P1-4), 2.1 R1~R6, schema_migrations 확인을 P1-8로 분리 |
| R3 | v4 267줄 `66f8a6e8…` | 독립 검증 | OK | N10: `consume_credits` 예외 핸들러를 `WHEN raise_exception` + `SQLERRM` 비교 + `ELSE RAISE` 형태로 고정, `WHEN OTHERS` 금지, P2-1에 다른 예외 주입 시 롤백·SQLSTATE 보존 테스트. N11: Phase 1 작업에 `set_market_cart_selection`·`remove_market_cart_items`. N12: T36 검증 열에 P2-3 |
| Phase 0 결과·사용자 결정 | v4 268줄 `c836cb4b…` + baseline 10절 | 팀 리드 전달(사용자 결정) | 반영 | ① Phase 1 적용 방식을 MCP `apply_migration` 파일 단위로 변경, `db push`·`--dry-run`·`migration repair` 미사용(push 시 로컬 전용 24개 동반 적용 위험 4건 명시), 적용 후 로컬 파일명을 원격 version으로 맞춤, 이력 전체 정합은 9절. P1-8 변경 ② 로컬 전용 미적용 3개를 사전 검토 후 개별 적용(P1-0, N15) ③ `grant_credits`·`deduct_credits` DROP(P1-9, N14) ④ SQL 테스트는 `DO` 블록 assert로 확정 ⑤ P0-7 열림 확정 → 정책 DROP·REVOKE 필수(P1-7, N13) ⑥ P0-5 결과(대상 1개, 서브상품 2) 반영(2.2, P1-6) |
| Phase 0 독립 검증 조건 | 위 개정본 | 팀 리드 전달 | 반영 | Phase 1 적용 방식 문구를 개별 `apply_migration` 기준으로 교체(push 위험은 9절 경고로 이동), 적용 직후 version 조회·로컬 파일명 맞춤과 P1-8 검증, 단일 트랜잭션·재실행 안전 작성 규칙, 백업 불필요(사용자 결정) 명시, `grant_credits`·`deduct_credits` 출처를 '로컬 migration에 정의 없음(미확인)'으로 정정 |
| Phase 0 검증 추가 정정 | 282줄 `1f2c86de…` | 팀 리드 전달 | 반영 | push 위험 목록에서 `20260805140000` 제외(`NOT LIKE` 가드로 no-op) → 3건(9절). 로컬 전용 3개 검토에 `add_admin_logs`의 `Admins can view all profiles` 정책명 중복, `fix_settings_rls`와 원격 `Admins can update system settings`의 중복 명시, 충돌 시 적용 중단·보고 |
| Phase 0 검증 추가 정정 2 | 283줄 `8b7efa18…` | 팀 리드 전달 | 반영 | (a) push 위험 목록 3건 정정과 (b) add_admin_logs·fix_settings_rls 중복 명시는 283줄본에 이미 반영됨을 확인. (c) `apply_migration` 단일 트랜잭션 실행 여부를 미확인 전제로 P1-8에 기록하고, 객체 체크리스트 대조로 부분 적용 흔적 0을 확인하는 방법 명시(P1-0 첫 적용부터 적용) |
| R5 이후 사용자 결정·R5 비차단 | 285줄 `e8725aa6…`(R5: 계획 OK·Phase 0 PASS) | 팀 리드 전달 | 반영 | 로컬 전용 3개 migration 제외(Phase 1 작업 1단계·P1-0·N15 삭제, 9절로 이동·조사 결과 기록), 단일 트랜잭션 확인 절차를 장바구니 migration(첫 적용)에 연결. N2: 신규 테이블 `REVOKE ALL` 후 authenticated `SELECT`만 재GRANT(3.4·Phase 1 통일), P1-3·P1-7에 `TRUNCATE` 검사. N3: 작성 규칙 문구 '단일 트랜잭션 실행 전제, P1-8로 확인'. N4: Phase 0 기록 파일명 `docs/cart-phase0-db-baseline.md`. N5: baseline '운영' → '개발 DB' 정정·10.6 결정 추가(별도 파일). N6: P1-9 grep 대상에서 `supabase/functions` 제거 |
| 문서 동기화 | 284줄 `8b74e5fa…` | 팀 리드 전달 | 반영(내용 변경 없음) | 7절 `psql` 접속을 PG*/`PGSERVICE` 환경변수 방식(인자 미사용)으로 표기, Phase 1 migration 파일명을 `20260930020304_market_cart_checkout.sql`·`20260930020347_backfill_legacy_only_market_items.sql`(적용 완료(2026-09-30))로 맞춤 |
| Phase 1 적용 | `20260930020304_market_cart_checkout.sql`, `20260930020347_backfill_legacy_only_market_items.sql` | 팀 리드 전달 | 적용 완료(2026-09-30) | 원격 이력 93→95, `apply_migration` 2회 모두 객체 체크리스트 전부 존재(부분 적용 흔적 없음), 로컬 파일명 version과 원격 version 일치 |
| Phase 1 적용 후 검증 | 원격 적용분(`20260930020304`, `20260930020347`) | 독립 검증 | OK(**P1-2 조건부 PASS**) | P1-1·P1-3~P1-9 PASS. `market_cart_checkout.test.sql` 원격 실행 all passed, fixture 잔존 0. 두 migration 재실행(`begin … rollback`) 오류 0. 회귀 확인: 판매 테이블 writer 전부 service role, legacy 상품 상세가 V2 분기로 전환. **P1-2 동시성(`cart_concurrency.sh`)은 DB 접속 정보가 없어 미실행** → 장바구니 route/UI를 노출하는 Phase 3 전에 P1-2 실행이 필수 선행 조건 |
| Phase 2 적용·검증 | `20260930024829_market_checkout_rpc.sql` | 독립 검증 | 적용 전 FAIL → 수정 → OK. 적용 후 OK(**P2-2 미실행**) | 적용 전 검증 FAIL: B1 계약 테스트 13건, B2 orphan 함수 9개, B3 reject 경로 CAS 없음 → 수정 후 재검증 OK, N5 대소문자·순서 replay assert 추가. 적용: 원격 이력 96, 부분 적용 없음, `schema_migrations.statements` md5 = 로컬 파일 md5. 적용 후: P2-1 원격 all passed·fixture 0, P2-4 grep 0, `tsc`/`eslint`/`npm run build` exit 0, node market 테스트 실패 9건(기존 실패 10건의 부분집합, stale 'v2 purchase duplicate policy' 테스트를 SQL 계약 기준으로 갱신해 통과), P2-3 비로그인 `curl`(batch 410, direct 401) 확인·로그인 필요 4건은 계정이 없어 미실행, P2-5 N7 코드 대조 OK·N6은 Phase 3 게이트로 이동. **P2-2 동시성은 DB 접속 정보 대기로 미실행 — P1-2와 함께 `MARKET_CART_ENABLED` ON 전 필수 선행 조건** |
| Phase 3 구현·검증 | Phase 3 구현분 | 독립 검증 | 1차 FAIL → 수정 → 재검증 OK(**P3-1 로그인 필요분·P3-2 미실행**) | 1차 FAIL: B1 preview/terms layout 헤더에 배지 누락. 수정: B1, N1(402 부족액 서버 재조회·충전 CTA·확정 버튼 비활성), N7(409 후 잔액 갱신). 재검증 OK: `tsc`, `eslint`, node test 새 실패 0, build 통과, 사용자 기존 변경 보존. flag OFF: `/cart`·cart API 503, 상세 담기 버튼 숨김, direct 구매 정상. flag ON·비로그인: API 401, `/cart`는 로그인으로 307. middleware는 `/cart` 정확 일치만 처리, 회귀 없음. 채택한 이탈: `/cart` 503은 middleware에서 처리 / `checkouts/[key]`는 flag OFF에서도 열림(P3-3 예외) / 충전 CTA는 GET cart 성공 시에만 노출 / 부분보유 확인 체크박스 1개로 통합 / PreviewHeader가 `credit-balance-updated` 수신. T02 해석: 타인 cart ID로 checkout하면 409 `CART_CHANGED`, 없는 행과 같은 응답이라 존재 여부가 노출되지 않음. 미실행: P3-1 로그인 필요분, P3-2 브라우저 전체 — 사용자가 본인 계정으로 직접 확인 예정. Phase 4 선행 작업: `src/types/supabase.ts` 재생성(+248/-133, 신규 테이블 2개·RPC 5개 추가, `grant_credits`/`deduct_credits` 삭제), `tsc`·build 통과 |
| 플래그 제거 | 사용자 결정(2026-09-30) | 팀 리드 전달 | 반영 | 사용자 지시 "배포 안전장치 없애줘. 지금은 개발이라 상관없고, 문제 발생시 git으로 다시 되돌리면 돼."에 따라 `MARKET_CART_ENABLED`를 코드에서 완전히 제거, 장바구니 항상 ON, `MARKET_V2_PURCHASE_ENABLED` 유지. 2.1·5절·Phase 3 작업·P3-3(제거)·Phase 4 롤백 문구(git 되돌리기)·T29(삭제)·9절(재도입 검토 행) 갱신. P1-2·P2-2 동시성, P3-1 로그인분·P3-2 브라우저, N7 실행 확인은 '공개 전 필수'에서 '권장 검증'으로 변경 |
