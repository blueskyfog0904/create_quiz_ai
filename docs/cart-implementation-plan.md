# 장바구니 구현 계획 — DB 정합성 우선

- 작성일: 2026-09-28
- 범위: 솔북 참고 조사 → 현재 코드·연결 DB 분석 → 구현 계획 → 독립 검증·보완
- 수정일: 2026-09-29 / v3
- 현재 상태: **PLAN PASS — 독립 R2 검증 통과 (2026-09-29)**
- 이번 작업에서 애플리케이션 코드·스키마·운영 데이터는 변경하지 않는다.
- 계획 검증 PASS와 구현·운영 검증 PASS는 별개다. 아래 구현 게이트는 실제 구현 시 통과해야 한다.

## 1. 핵심 결론

장바구니를 화면 배열로만 추가하지 않는다. 계정별 서버 저장 장바구니, 서버 견적, **한 DB 트랜잭션으로 끝나는 선택 상품 구매**를 도입한다. 기존 단건 주문·다운로드 권한·환불 단위는 유지하고 그 위에 일괄 구매 묶음을 추가한다.

가장 중요한 이유는 현재 `createMarketV2PurchaseWithCompensation`이 크레딧 차감→주문→상세→권한을 별도 요청으로 기록하기 때문이다. 실패 보상은 원자적 커밋이 아니다. 이 함수를 HTTP 루프로 여러 번 호출하는 구현은 채택하지 않는다.

## 2. 근거와 확인 범위

- [솔북 UI 관찰](./cart-reference-ui.md): https://solvook.com/products/3482476214105408716 및 https://solvook.com/shop/cart
- [실제 DB 읽기 전용 증거](./cart-live-db-evidence.json): 2026-09-28T08:21:27Z, service-role SELECT 및 PostgREST OpenAPI. 사용자 식별자·키·Storage 경로는 저장하지 않았다.
- [추가 무결성 증거](./cart-live-integrity-evidence.json): 주문 소비 합계·소유자·권한 상태·익명 읽기·Storage 메타데이터 검사.
- DB 감사: `docs/cart-db-audit.md`, 코드 감사: `docs/cart-code-audit.md`. 감사 보고서의 대안이 충돌하면 이 계획의 명시적 결정이 구현 기준이다.
- 소스: `src/lib/market-purchase.ts`, `src/lib/market-items-server.ts`, `src/lib/market-refunds.ts`, `src/lib/credits.ts`, 구매/다운로드 API와 관련 마이그레이션.

| 실제 DB에서 확인한 사항 | 결과 |
|---|---|
| 장바구니 테이블 | 없음 |
| 상품 / 서브상품 / 서브상품 파일 | 146 / 355 / 500행 |
| 공개·활성·미삭제 상품 | 국어 144 / 영어 1 |
| 활성 서브상품 / 활성 번들 | 국어 352 / 국어 64 |
| V2 주문 / 주문 상세 / 권한 | 8 / 8 / 8행 |
| V2 주문 상태 | 완료 7 / 환불 1 |
| 레거시 구매 | 0행 — 레거시 코드가 없다는 뜻은 아님 |
| 이번 검사 범위의 부모 불일치·중복 활성 권한 | 0건 |

현재 주문 테이블의 정확한 이름은 `market_purchase_orders`, `market_purchase_lines`다. 전자는 `item_id`, `workspace_subject`가 필수여서 여러 상품·과목을 한 주문 행에 억지로 넣지 않는다.

**실측 한계:** REST 스키마와 행 집계로 현재 CHECK·partial UNIQUE·RLS 정책 본문·GRANT·RPC 함수 본문까지 증명할 수는 없다. 관리 API 토큰은 설정되지 않았고 `exec_sql`은 존재하지 않았다. 실 DB에는 `consume_credits_once` / `refund_credits_once`가 노출되지만 로컬 마이그레이션에서 정의를 찾지 못했으므로, 이름만 보고 재사용하지 않는다. Phase 0에서 `pg_catalog` 대조가 끝나기 전 DDL 적용·구매 경로 전환·기능 공개는 금지한다.

추가 실측에서는 order 소비 snapshot 합계/원장 소스 소유자, entitlement-order 사용자·상품·과목, 환불 완료 상태의 불일치가 0건이었다. `market-files` bucket은 `public=false`이고 익명 HEAD는 검사한 금융/권한 테이블에서 모두 0행을 반환했다. 이는 authenticated 직접 쓰기 권한이나 storage.objects 정책을 검증한 것은 아니다. 파일 500개는 조회 batch 크기 추정이 아니라 별도 `count:'exact',head:true` 응답으로 재확인했다.

## 2.1 감사의 대안 충돌에 대한 결정

- legacy를 무조건 제외하지 않는다. 실제 공개 영어 상품에 활성 V2 판매 단위가 없는 상황을 고려해 세 타깃을 지원한다. 대신 레거시 재구매 UNIQUE와 직접 쓰기 권한을 출시 전 보강한다.
- 종료된 `/api/market/purchases/batch`는 **410을 유지**한다. 새 `/api/market/cart/checkout`을 도입하고 과거 리스트 직접 결제를 되살리지 않는다.
- 선택은 다른 기기에서도 복원하도록 DB `is_selected`로 저장한다. 결제 승인 대상은 별도로 quote에 고정된 행 ID+revision이며, 선택 변경은 기존 quote를 무효화한다.
- 서버는 장바구니 최대 50행을 **한 번에 모두 반환**한다. 공통 20/50개 표시는 클라이언트에서만 나누며 전체 행 ID·revision·선택 집합은 유지한다. 서버 페이지 조회와 전체 선택을 혼용하지 않는다.
- 부분 보유 번들의 기존 **정가 구매 정책을 유지**한다. 별도 할인 또는 구매 금지 정책으로 조용히 변경하지 않는다.
- 기존 단건 구매 버튼/UX는 유지하되 서버 처리는 새 원자 엔진으로 이관한다. application 보상 엔진을 동시에 활성화하는 additive rollout은 허용하지 않는다.
- 충전 복귀는 양 결제수단 결과 화면의 `/cart` CTA를 기본으로 한다. 결제 주문에 임의 returnTo 필드를 넣는 확장은 하지 않는다.

## 3. 제품 결정과 범위

다음은 이번 계획의 권고 기본값이다. 임의로 다른 정책을 구현하지 않으며, 변경 요청 시 계획·테스트를 함께 수정한다.

1. 로그인 계정별 DB 장바구니. 비회원 샘플 보기는 계속 허용한다. 비로그인 담기는 로그인 후 원래 상품/옵션으로 돌아오고, 사용자가 다시 담기를 확정한다. 로그인만으로 구매하지 않는다.
2. 과목 통합 장바구니에서 영어/국어를 그룹화한다. 선택 상품은 같은 계정의 사용 가능 크레딧으로 구매한다.
3. 디지털 상품 수량은 1. 동일 판매 단위 반복 담기는 기존 행을 반환한다. 장바구니·한 번의 구매 모두 최대 50개 판매 단위.
4. 판매 단위: V2 서브상품, V2 번들, 레거시 PDF/HWP/ZIP. 샘플과 Storage 파일 경로는 판매 타깃이 아니다.
5. 선택 상품 전부 성공하거나 전부 실패한다. 한 항목이라도 가격·보유·판매 상태가 달라지면 차감 없이 재확인을 요청한다.
6. 결제는 **자료의 크레딧 구매**다. Toss/KakaoPay는 기존 크레딧 충전 흐름으로만 사용한다. 쿠폰·현금 직접 결제·배송·제본·대여권은 이번 범위가 아니다.
7. 충전 후에는 장바구니로 돌아와 새 견적을 확인한다. 자동 구매 재개 금지.
8. 구매한 상품·옵션 및 환불 상태는 기존 라이브러리와 환불 화면에서 확인한다. 장바구니 묶음 때문에 기존 환불 단위를 합치지 않는다.

## 4. UI와 동작 계약

### 4.1 상세·헤더

- 상품 상세의 실제 옵션 행에 `장바구니 담기`를 제공한다. 서브상품인지 전체 번들인지 구분해 담는다.
- 이미 보유·판매 중지·파일 없음 상태에서는 구매 불가 사유를 표시한다.
- 담기 성공 시 `계속 둘러보기 / 장바구니 보기`를 제공한다. 담았다고 차감하지 않는다.
- 메인과 공유하는 헤더에 장바구니 아이콘·계정 장바구니 전체 행 수 배지를 제공한다. 로그인·로그아웃·담기·삭제·구매 완료 시 재조회한다. 계정 전환 시 이전 계정 캐시를 폐기한다.
- 기존 카테고리 사이드바·공개 샘플·구매 파일 권한을 보존한다.

### 4.2 `/cart`

- 메인 공통 레이아웃/StudioContainer, 기존 Checkbox·Button·Dialog·EmptyState·공통 페이지네이션을 재사용한다.
- PC: 좌측 과목별 상품 목록 / 우측 선택 건수·선택 크레딧 합계·현재 사용 가능 크레딧·부족액·구매 버튼.
- 모바일: 한 열 카드 목록 / safe-area를 고려한 하단 요약·구매 버튼. 320px 가로 넘침 금지, 조작 영역 44px 이상.
- 행: 선택, 상품명/옵션, 샘플, 현재 서버 가격, 상태·사유, 삭제. 수량 조절 없음.
- GET으로 받은 최대 50행을 메모리에 보관하고 20/50개씩 로컬 표시한다. 전체 선택은 현재 페이지가 아니라 **마지막 전체 조회 snapshot의 구매 가능한 모든 행**에 적용한다.
- 전체 선택/해제는 해당 snapshot의 ID+revision 배열을 PATCH한다. 한 행이라도 소유자/revision이 다르면 전부 적용하지 않고 409/404 후 전체 재조회한다.
- quote 요청도 페이지와 무관하게 메모리 snapshot에서 선택된 모든 ID+revision을 보낸다. DB가 그 명시적 집합의 소유·revision·selected 상태를 검사한다. 서버가 요청에 없는 selected 행을 몰래 포함하지 않는다.
- 다른 탭의 새 담기 행은 다음 GET에서 보이지만 이미 열려 있는 quote에는 자동 추가되지 않는다. 다른 탭이 기존 선택 행을 변경하면 revision 충돌로 기존 quote를 거부한다.
- 검색 필터처럼 과목별 부분 표시를 추가하지 않는다. 두 과목을 동시에 담았다는 사실이 합계에서 숨겨지지 않게 한다.
- 판매 불가 행은 자동 삭제하지 않고 선택 불가로 표시한다. 사용자가 제거한다.
- 선택·선택 삭제는 소유 행 ID 배열을 보낸다. 페이지와 선택 상태는 독립적이다.

### 4.3 확인·실패·복원

- 구매 버튼 → 서버 견적 발급 → 확정 Dialog에 항목·합계·잔액·업그레이드/불가 사유 표시 → 구매 확정.
- `PRICE_CHANGED`, `OWNERSHIP_CHANGED`, `CART_CHANGED`, `QUOTE_EXPIRED`는 새 견적을 보여주고 다시 확인한다.
- 잔액 부족: 현재 차감 가능 원장 잔액과 부족액을 보여주고 기존 충전 경로로 이동한다. `/cart` 복귀 경로를 안전한 내부 경로로 검증한다.
- 네트워크 단절/응답 유실: 완료 여부 확인 중으로 표시하고 **같은 멱등 키**로 재조회/재시도한다. 새 키를 자동 발급해 재구매하지 않는다.
- 성공 후 배지·잔액·라이브러리 재조회. 해당 구매에 포함된 원래 cart row ID만 제거한다. 미선택 행과 견적 후 새로 담긴 행은 남긴다.

## 5. DB 모델

다음은 목표 스키마 계약이다. SQL 파일을 만들고 대상 DB에 적용하는 것은 후속 구현 Phase에 속한다.

### 5.1 `market_cart_items`

- `id uuid PK`, `user_id uuid NOT NULL`, `workspace_subject text NOT NULL`, `item_id uuid NOT NULL`.
- `target_kind text NOT NULL`: `subproduct | bundle | legacy`.
- `subproduct_id uuid NULL`, `bundle_option_id uuid NULL`, `legacy_asset_kind text NULL` (`pdf | hwp | zip`).
- `is_selected boolean NOT NULL DEFAULT true`, `revision bigint NOT NULL DEFAULT 1`, `created_at`, `updated_at`.
- 가격·크레딧 소비 원장·파일 경로·다운로드 권한은 저장하지 않는다. 표시 금액은 조회 때 계산한다.
- CHECK로 세 타깃 중 정확히 하나만 유효하도록 보장한다. NOT NULL/명시적 `IS NULL` 분기 사용: SQL의 NULL CHECK 우회를 허용하지 않는다.
- `(item_id, workspace_subject)` → 상품 복합 FK.
- `(subproduct_id, item_id, workspace_subject)` / `(bundle_option_id, item_id, workspace_subject)` → 타깃 복합 FK. 대상에 `(id, item_id, workspace_subject)` UNIQUE를 먼저 추가한다. 기존 `(id, workspace_subject)` FK만으로는 다른 상품의 서브상품을 가리키는 오류를 막지 못한다.
- 소유자는 `profiles` 참조. 장바구니만 있는 계정 탈퇴는 CASCADE 허용. 구매 이력의 보존 정책과 분리한다.
- 부분 UNIQUE 3개: `(user_id, workspace_subject, subproduct_id) WHERE target_kind='subproduct'`, 번들 대응 키, `(user_id, workspace_subject, item_id, legacy_asset_kind) WHERE target_kind='legacy'`.
- 인덱스 `(user_id, created_at DESC, id)` 및 사용되는 FK 열. `revision`은 타깃/선택 변경마다 DB에서 증가한다. 클라이언트 임의 버전 대입 금지.
- 추가/수정/삭제 RPC는 사용자 잠금을 잡고 50개 제한과 소유권을 검사한다. 중복 담기는 `ON CONFLICT`의 해당 부분 인덱스 조건을 사용해 기존 ID를 반환한다.

### 5.2 `market_checkout_quotes`

- `id uuid PK`, `user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE`, `mode text NOT NULL CHECK(cart|direct)`, `selection jsonb NOT NULL`, `total_credits bigint NOT NULL CHECK(total_credits > 0)`, `expires_at timestamptz NOT NULL`, `created_at timestamptz NOT NULL DEFAULT now()`, `consumed_at timestamptz NULL`.
- 서버/DB 전용 불변 견적. 선택 행 ID·revision·상품/판매 타깃·가격·보유/업그레이드 기준·활성 파일 식별/버전 등 구매 판정에 필요한 스냅샷을 저장한다. 파일 경로는 저장/반환하지 않는다.
- 유효 시간 5분, DB 시각 사용. 견적은 잔액이나 판매 상태를 예약하지 않는다. 미사용/만료 quote는 계정의 허용된 탈퇴 때 삭제하며, batch가 참조하는 소비된 quote는 FK RESTRICT로 보존한다.
- 생성은 DB 계산 RPC만 허용한다. JSONB의 구조·길이·허용 키는 RPC에서 검증하고, 핵심 총액·만료·소유자에는 관계형 제약을 둔다.
- 견적 ID를 알아도 다른 사용자로 조회/결제할 수 없다. 직접 모드도 명시적 서버 견적을 사용해 단건 UI의 금액 불일치를 막는다.

### 5.3 `market_checkout_batches`

- `id uuid PK`, `user_id NOT NULL`, `idempotency_key uuid NOT NULL`, `quote_id NOT NULL`, `request_payload jsonb NOT NULL`, `total_credits bigint NOT NULL`, `created_at`.
- `UNIQUE(user_id, idempotency_key)`, `UNIQUE(quote_id)`, `UNIQUE(id, user_id)`.
- `request_payload`는 소유자·견적·정렬된 중복 없는 선택 타깃의 정규화 JSONB. 같은 키에 다른 payload이면 409. 단순히 총액만 비교하지 않는다.
- 원자적 성공 때만 행이 커밋된다. 별도의 오래 살아 있는 `processing` 행/보상 워커를 만들지 않는다. 실패하면 batch도 롤백된다.
- 사용자 FK는 기존 금융 이력과 같은 RESTRICT. 회원 탈퇴는 5.7절의 profile-first DB 트랜잭션으로 금융 이력을 재검사한다. HTTP 사전 SELECT만으로 부분 삭제 방지를 주장하지 않는다.
- 완료 영수증 조회는 저장된 결과를 반환한다. 재시도 때문에 기존 child 주문·원장을 재생성하지 않는다.

### 5.4 `market_checkout_batch_lines`

- `id`, `batch_id`, `user_id`, `source_cart_item_id NULL`, `item_id`, `workspace_subject`, 타깃 종류/ID, 상품명·옵션명 스냅샷, 정가·실청구액.
- `v2_order_id NULL` / `legacy_purchase_id NULL` 중 정확히 하나. 각 child는 전체 batch 관계에서 UNIQUE.
- `(batch_id,user_id)` 복합 FK, child의 `(id,user_id,item_id,workspace_subject)` 복합 FK를 위한 UNIQUE 추가. 소유자/과목/상품 교차 연결을 DB에서 거부한다.
- `source_cart_item_id`는 이미 지워질 cart 행의 감사용 UUID 스냅샷이므로 살아 있는 cart FK가 아니다. `(batch_id,source_cart_item_id)` 부분 UNIQUE로 중복 소비를 거부한다.
- 영수증의 상품·기존 구매·quote 참조는 hard delete를 제한하고 soft delete 상태를 보여준다. 장바구니 삭제가 주문·원장·권한을 지우면 안 된다.
- 각 구매 단위의 기존 `market_purchase_orders + market_purchase_lines + market_entitlements` 또는 `market_purchases`를 연결한다. 장바구니 가격 합계를 기존 단일 상품 order에 몰아넣지 않는다.

### 5.5 권한

- 신규 테이블 전부 RLS 활성화, 소유자 SELECT 정책만 허용. anon 접근 없음.
- authenticated/anon/PUBLIC의 직접 INSERT·UPDATE·DELETE는 REVOKE. 로그인 검증된 Route Handler가 service-role RPC를 호출한다.
- RPC는 PUBLIC·anon·authenticated EXECUTE REVOKE, service_role만 허용. `SECURITY DEFINER`, 고정 search_path, 모든 테이블·함수 이름을 명시적 schema로 한정한다.
- `user_id`는 `auth.getUser()`의 결과만 사용하며 요청 body의 user_id·가격·권한·차감내역은 받지 않는다.
- CRUD/RPC owner 조건 누락이 없도록 모든 쿼리/삭제를 사용자 범위로 제한한다. 0건 삭제를 성공적인 타인 행 삭제처럼 보고하지 않는다.

### 5.6 기존 테이블 보강 — 신규 cart 테이블만으로 끝내지 않는다

- `market_subproduct_files`, 기존 `market_purchase_lines`, `market_entitlements`도 item/subject/user와 타깃의 실제 부모를 묶는 복합 FK를 추가한다. 신규 batch line만 올바르고 entitlement는 다른 사용자에게 연결되는 상태를 허용하지 않는다.
- `market_purchases`의 기존 `(user_id,item_id,asset_kind)` 전체 UNIQUE는 이력 보존 재구매를 막는다. 기존 completed 중복 0을 검증한 뒤 **completed에만 적용하는 partial UNIQUE**로 교체하고, 환불 후 재구매는 새 purchase ID를 생성한다. 이전 행/원장/환불 요청을 재활성화하지 않는다.
- legacy `market_purchases`와 V2 order/line/entitlement의 authenticated 직접 INSERT/UPDATE/DELETE를 명시적으로 REVOKE한다. 사용자 소유만 검사하는 legacy INSERT/UPDATE 정책도 제거한다. admin UI의 쓰기는 서버 경계로 유지한다.
- `credit_sources`의 `initial_credits >= 0`, `remaining_credits >= 0 AND remaining_credits <= initial_credits`, `credit_consumption.amount > 0` 제약은 기존 데이터 검증 후 적용한다. 실제 DB에 동등한 제약이 있으면 중복 생성하지 않는다.
- V2 order에 nullable `upgrade_base_order_id`와 `(upgrade_base_order_id,user_id,item_id,workspace_subject)` 자기참조 FK를 추가한다. `id <> upgrade_base_order_id`; 할인된 HWP 신규 주문은 기준 주문 필수. 기존 할인 주문은 실측 0건이지만 migration 직전 다시 확인한다.
- 유효한 기준 PDF가 여러 개면 **현재 PDF 가격 내림차순 → 기준 주문 created_at 오름차순 → 기준 주문 ID 오름차순**으로 한 개를 선택한다. quote 및 receipt에 선택 근거·기준 ID를 고정한다.
- `credit_consumption.transaction_id/operation_key`와 실제 `_once` 함수가 있는 drift를 해소한 후, 신규 child 주문의 resource_id/소비 operation/transaction 연결을 하나로 기록한다. 확인하지 못한 `_once`를 호출하지 않는다. 완전한 신규 SQL에서 일반 consume 호출 결과를 받아 쓸 경우에도 원장 행과 child ID의 연결을 회귀 테스트한다.

### 5.7 계정 탈퇴와 구매의 경합 — 원자 DB 정리 + Auth 정리 작업

- `profiles.account_state text NOT NULL DEFAULT 'active'`를 추가하고 `active | withdrawal_pending`만 허용한다. 기존 사용자 데이터는 active로 유지한다.
- 모든 구매/견적/장바구니 mutation/크레딧·충전 writer는 profile 잠금 직후 active 여부를 검사한다. withdrawal_pending이면 아무 mutation 없이 `ACCOUNT_WITHDRAWAL_PENDING`을 반환한다.
- `account_deletion_jobs`에는 `id uuid PK`, `user_id uuid NOT NULL UNIQUE`, `status(pending_auth|completed|manual_review)`, attempts/next_retry_at/last_error_code/created_at/completed_at을 둔다. user_id는 Auth/profile 삭제 뒤에도 복구 식별자를 유지해야 하므로 **의도적으로 FK를 두지 않는 tombstone**이며 이메일·인증정보를 저장하지 않는다. RLS 활성화, 직접 사용자 접근 없음, service-only RPC.
- `request_account_withdrawal_atomic(p_user_id)`는 profile을 먼저 FOR UPDATE하고 payment_orders/기존 checkout_attempts/market checkout batch/market orders/legacy purchases/보존 대상 환불 이력을 같은 transaction에서 재검사한다. 한 건이라도 있으면 삭제 0건, 기존 방식의 지원 안내 409. 조회 오류도 fail-closed다.
- 금융 이력이 없으면 같은 transaction 안에서 삭제가 허용된 개인 데이터·cart·미사용 quote를 정리하고 profile은 개인 필드를 비운 withdrawal_pending tombstone으로 남긴다. credit source/transaction 등 cascade/삭제 순서는 Phase 0에서 실제 FK와 기존 탈퇴 계약을 대조해 확정한다. job 생성과 이 모든 DB 변경은 함께 commit/rollback하며 HTTP 순차 delete를 사용하지 않는다.
- DB commit 뒤 Auth admin deleteUser를 호출한다. 성공/확실한 USER_NOT_FOUND일 때만 job을 completed로 갱신한다. Auth 삭제에 의한 profile cascade는 마지막 provider 단계이며 profile/quote/batch FK와 함께 staging 검증한다.
- Auth 실패/응답 불명은 성공으로 응답하지 않고 `202 WITHDRAWAL_PENDING`과 본인 요청 ID를 반환한다. 계정 재사용·프로필 재생성은 pending/completed tombstone으로 차단한다. signup/auth callback/profile upsert를 포함한 모든 profile 생성 경계에도 tombstone 검사를 강제하며, 진행 중 탈퇴를 active로 되돌리는 자동 복구는 없다.
- 인증된 내부 reconciliation 작업이 pending_auth를 제한 재시도(최대 5회 후 manual_review)한다. 호출 비밀키·작업 claim·attempt 증가·상태 갱신을 검증하고 키를 클라이언트에 전달하지 않는다. user_id 기준 Auth 존재 여부가 불명확하면 계속 pending으로 유지한다.
- 이미 pending인 동일 사용자의 재요청은 같은 job을 반환한다. checkout과 경합하면 profile 잠금을 먼저 얻은 쪽이 상태를 확정한다: 구매가 먼저면 탈퇴 409, 탈퇴가 먼저면 구매/새 충전 주문 생성이 차단된다. Auth 작업을 DB lock을 잡은 채 호출하지 않는다.
- 이 변경은 장바구니 출시의 정합성 선행 조건이다. 기존 개인정보 삭제 정책을 새로 정하는 것이 아니라 허용된 삭제의 원자성과 외부 Auth 실패의 복구 상태를 명시하는 것이다.

## 6. 견적·중복·업그레이드 정책

1. 실제 공개·활성·미삭제 상품/메뉴, 활성 타깃, 과목 일치, 활성 판매 파일 존재, 유효한 양수 가격을 검사한다. 0원은 기존 판매 정책대로 구매 불가로 처리한다.
2. 이미 보유한 동일 서브상품, 전체 보유 후 개별 재구매, 중복 legacy 권한은 구매 불가.
3. 같은 상품의 번들+개별 옵션 동시 선택은 충돌이다. 자동으로 더 비싼 옵션을 남기지 않는다. UI에서 사용자가 하나를 선택하게 한다.
4. PDF가 포함된 HWP와 PDF를 같은 batch에서 동시에 사는 것도 충돌로 처리한다. 첫 번째 행 처리 순서에 따라 차액이 달라지지 않게 한다.
5. 기존 PDF 보유자의 HWP 차액은 현재 `getMarketSubproductPairContext` 규칙을 SQL 공통 가격 계산으로 옮긴다: 유일한 HWP, 활성 PDF 포함 파일, item scope 미보유, 해당 HWP 미보유, 보유 PDF 현재가의 최대값, 양수 차액 조건. 현재 코드가 과거 지불액이 아닌 **현재 PDF 판매가**를 사용한다는 점을 명시한다.
6. 차액의 기준이 된 실제 활성 주문 ID를 스냅샷/관계로 저장한다. 환불 대기·환불된 주문은 기준으로 쓰지 않는다. 기준 PDF 주문 환불은 관련 차액 주문이 살아 있는 동안 거부한다. 차액 주문 환불은 실제 차액만 원래 소비 소스에 복구한다.
7. 일부 구성품을 보유한 번들은 기존 정책대로 정가 구매를 허용한다. quote에 기보유 구성품과 **기보유분 차감 없음**을 표시하고 명시적으로 확인받는다. 기존 개별 entitlement는 그대로 남긴다. 번들 환불은 새 bundle child의 청구액과 item entitlement만 되돌리며 기존 개별 소유권은 유지한다. 같은 batch의 번들+개별 동시 선택은 3번대로 금지한다.
8. 같은 상품의 legacy/V2 혼합 구매는 명시적 소유권 매핑 없이 허용하지 않는다. `legacy_asset` 권한과 legacy 구매가 남아 있으면 재구매 판정에 포함한다. 전환 상품의 불명확한 소유 범위는 `OWNERSHIP_REVIEW_REQUIRED`로 차감 없이 차단한다.
9. batch 안의 선택 타깃은 정규화된 순서로 검사한다. 요청 순서를 바꿔도 총액과 충돌 판정이 같아야 한다.
10. 총액은 bigint로 합산하되 기존 크레딧 RPC integer 범위를 넘으면 차감 전에 거부한다.
11. **legacy 내부 coverage는 현재 production 코드의 exact-kind가 기준**이다. HWP 구매는 별도의 PDF asset 다운로드 권한을 부여하지 않는다. HWP 기보유 후 PDF는 PDF 정가로 구매 가능하고, PDF 기보유 후 HWP도 HWP 정가로 구매 가능하다. legacy에는 PDF→HWP 차액을 도입하지 않는다. HWP 환불은 그 HWP purchase만 해제하며 별도 PDF purchase와 ZIP은 독립적이다.
12. legacy HWP/PDF 동시 선택은 서로 다른 정확한 asset 판매 단위이므로 허용한다. 4번의 PDF 포함 HWP 중복 차단은 **V2 subproduct 포함 관계**에 적용한다. 새 migration COMMENT와 legacy UI 라벨(`HWP 파일`)에서 이전 `HWP & PDF`의 권한 오해를 바로잡는다. V2 HWP의 PDF 포함/차액 규칙은 그대로 유지한다.

## 7. 트랜잭션·멱등성·동시성

### 7.1 공통 구매 엔진

`quote_market_selection(...)`, `checkout_market_selection(p_user_id, p_quote_id, p_idempotency_key)` RPC를 도입한다. API 레벨에서 여러 상품의 기존 구매 함수를 호출하지 않는다.

최종 구매 트랜잭션 순서:

1. `profiles(user_id) FOR UPDATE` — 기존 `consume_credits`와 같은 사용자 직렬화 기준.
2. 같은 user+key의 커밋된 batch가 있으면 payload 일치를 검증하고 기존 영수증 반환. 이 재시도 검사는 quote 만료/이미 소비 여부보다 먼저 수행한다.
3. quote 소유자·만료·미사용을 검사한다. cart mode는 선택 행 소유자/revision·selected 상태를 잠금 하에 검증하고 관련 없는 새 cart 행은 보존한다. direct mode는 cart row 잠금/삭제 없이 quote의 단일 target과 URL itemId 일치만 검사한 뒤 같은 catalog/소유권 검증으로 진행한다.
4. 타깃 상품·판매 옵션·활성 파일·메뉴·가격·보유·환불 대기를 다시 계산하고 quote 스냅샷과 비교한다. 차이가 있으면 명확한 오류로 전체 롤백한다.
5. profile 잠금 획득 직후의 DB `clock_timestamp()`를 해당 checkout의 판정 시각으로 고정하고 quote 만료와 credit 유효성을 같은 시각으로 평가한다. lock 대기 전 transaction 시작 시각만으로 만료를 판정하지 않는다. consume SQL helper도 이 잠금 후 시각을 일관되게 사용하도록 이관한다. 소비 가능한 credit_sources의 DB 잔액으로 총액을 검사한다. active, remaining>0, 미만료, pending_refund 제외. 만료 임박 순 `expires_at ASC NULLS LAST, purchased_at ASC, id ASC`를 보존한다.
6. batch와 child 주문 UUID를 확정한다. 각 child에 대해 **같은 SQL 트랜잭션 안에서** `public.consume_credits`를 호출하고 반환된 정확한 소스별 소비 내역을 해당 child의 `credit_consumptions`에 저장한다. 총액을 비례 배분해 환불 내역을 추정하지 않는다.
7. 기존 단위 주문·상세·entitlement·batch line을 생성한다. 신규 원장 resource_id는 실제 child 구매 ID와 대응시키고 기존 내역 표시/조회 계약도 점검한다.
8. quote 소비 처리, 해당 quote에 포함된 cart ID+revision만 삭제, 잔액/영수증 생성 후 커밋.

어느 단계든 예외면 차감·주문·권한·cart 삭제·quote 소비가 모두 롤백된다. PL/pgSQL EXCEPTION을 잡아 성공처럼 반환하거나, 부분 결과를 바깥 트랜잭션에 커밋하지 않는다.

### 7.2 기존 진입점 이관이 선행 조건

- `/api/market/items/[itemId]/purchase`의 legacy/V2 단건을 공통 엔진으로 이관한다. `/api/market/purchases/batch`는 이미 410이며 그대로 유지한다. 기존 HTTP 보상 방식과 새 엔진이 동시에 주문을 만들면 profile 잠금만으로 중복 구매를 막을 수 없다.
- 사용자별 lock은 소유권 검사 **전부터 권한 커밋까지** 유지해야 한다. 크레딧 차감 RPC가 반환된 후 주문을 따로 쓰는 경로는 기능 공개 전에 제거/비활성화한다.
- 자료 환불 요청·승인과 다운로드 최종 승인도 같은 사용자 잠금 기준으로 조정한다. 기존 `approveMarketRefund`의 크레딧 복구→상태 변경 분리 처리도 batch child에 그대로 사용하지 않는다.
- 기존 point-charge refund finalizer의 source→profile 순서는 구매의 profile→source와 역전된다. 따라서 **모든 사용자 잔액 writer는 profile(user) 잠금을 가장 먼저 획득**하도록 관련 최신 함수도 이관한다. 충전 fulfill, provider refund claim/finalize/fail/reject, grant/consume/refund, 자료 구매/자료 환불/최종 다운로드 승인을 writer 목록으로 추적한다. provider HTTP 호출을 DB transaction에 넣지는 않는다.
- user_id 확인용 unlocked read 후 profile을 잠그고, 대상 주문/요청을 다시 잠가 사용자 일치를 재검증한다. 둘 이상의 사용자를 한 transaction에서 다루는 관리 작업은 profile UUID 정렬 잠금이 선행한다. 같은 사용자 안에서는 profile 잠금이 주문/원장 경합을 직렬화한다.
- 신규 자료 구매는 payment_orders를 변경하지 않는다. 각 도메인의 하위 lock 순서와 source 정렬을 기록하고 반대 순서가 남으면 Phase 2 FAIL이다.

### 7.3 가격·파일 변경 동시성 — 부모 상품 잠금 프로토콜로 확정

- 상품에 `catalog_revision bigint`를 추가한다. checkout은 선택 상품 UUID 오름차순으로 `market_items FOR SHARE`를 획득하고 quote의 revision 및 현재 계산값을 비교한다.
- 가격/활성/파일 구성을 바꾸는 child INSERT/UPDATE/DELETE에는 부모 상품 `FOR UPDATE` 및 revision 증가를 수행하는 DB trigger를 둔다. 이동 UPDATE는 OLD/NEW 부모 ID를 정렬해 잠근다.
- 적용 대상: `market_item_subproducts`, `market_subproduct_files`, `market_item_bundle_options`, `market_item_files`. `market_items` 자체 변경은 동일 row UPDATE 잠금을 사용한다. 메뉴 가시성·subproduct category slug·file type code/활성 변경도 영향을 받는 상품 ID를 정렬 잠금/증분 처리한다.
- checkout은 부모 잠금 뒤 child/menu/type 값을 일반 SELECT로 읽는다. child를 잡고 부모를 기다리는 관리 UPDATE와 교착하지 않도록 별도의 child FOR UPDATE를 취하지 않는다. uncommitted child 변경은 MVCC로 보이지 않고 writer는 부모 잠금이 풀릴 때까지 완료할 수 없다.
- 신규 파일/옵션 추가도 부모를 잠그므로 기존 행만 잠그는 방식의 phantom을 막는다. 기존 admin service-role 경로도 trigger 적용 대상이며 API에서만 흉내내지 않는다.
- 선택 행 잠금 순서: profile → quote → cart row UUID 순 → item UUID 순 → 해당 사용자 child 주문/권한 → credit sources 만료/구매/ID 순. 동일 profile은 transaction 종료까지 유지한다.
- 관리자 다중 상품 변경도 부모 UUID 정렬 잠금을 선행한다. 예외적으로 발생하는 교착/serialization 실패는 전체 롤백 후 같은 키로 최대 3회 재시도하고, 완료 불명 상태에서 새 키를 발급하지 않는다.

### 7.4 다운로드·환불

- 샘플은 계속 공개된다. 유료 다운로드는 소유권·활성 상태·환불 대기를 최종 검증해야 한다.
- signed URL을 준비하더라도 클라이언트에 전달하기 전에 공통 사용자/주문 잠금 하에서 최종 승인과 다운로드 이벤트를 기록한다. 서명 생성 실패는 사용 이력으로 기록하지 않는다.
- 환불 승인 RPC는 요청 상태, child 소유자, 7일 조건·다운로드 이력·업그레이드 의존성을 재검사한 뒤 **복구 원장과 child/권한/요청 상태를 한 번에** 갱신한다. 동일 승인 재시도는 이미 처리된 결과를 반환한다.
- cart batch 전체 환불 기능은 추가하지 않는다. 환불 단위는 기존 child 주문/legacy 구매다. batch 화면의 환불 표시는 child 상태로 계산한다.
- source가 만료/환불 대기/원결제 취소 상태인 경우 복구 규칙은 기존 원장의 정책을 유지한다. 만료된 크레딧에 새 유효기간을 부여하지 않는다.

## 8. HTTP 계약

| API | 입력 | 주요 응답 |
|---|---|---|
| `GET /api/market/cart` | 인증 세션, 페이지 인자 없음 | 전체 최대 50행·ID/revision·서버 현재가·가능 여부·선택 상태·합계·행 수 |
| `POST /api/market/cart/items` | itemId + 판별 가능한 타깃 union | 생성/중복 기존 행, 최신 count |
| `PATCH /api/market/cart/items` | 소유 row IDs + expectedRevision + isSelected | 새 revisions / 409 충돌 |
| `DELETE /api/market/cart/items` | 소유 row IDs + expectedRevision | 삭제 결과·최신 count |
| `POST /api/market/cart/quote` | 선택 row IDs + revisions | quoteId·만료·항목별 금액·총액·잔액·실패 사유 |
| `POST /api/market/cart/checkout` | quoteId + idempotencyKey | batch 영수증·child 결과·잔액 |
| `GET /api/market/cart/checkouts/[key]` | 본인 멱등 키 | 완료 결과 / 미확인 404 |

`404` 조회 결과만으로 진행 중인 원래 POST의 실패를 단정하지 않는다. 같은 키 POST 재시도가 최종 판정 수단이다. body에는 가격·userId·권한·원장 내역을 허용하지 않는다. Zod strict union, UUID·배열 길이·중복·정수 범위를 검증한다.

오류: 401 로그인 필요, 404 타인/없는 대상, 409 가격/행/보유/quote/키 충돌, 402 잔액 부족, 422 선택 중복·지원 불가 조합, 503 기능 비활성 또는 확정 불가. 예상하지 못한 DB 오류를 메시지 정규식만으로 잔액 부족에 분류하지 않는다.

### 8.1 기존 단건 구매의 direct 계약

- 신규 `POST /api/market/items/[itemId]/quote`: body는 strict union `{targetKind:'legacy',assetKind:'pdf'|'hwp'|'zip'}`, `{targetKind:'subproduct',subproductId:uuid}`, `{targetKind:'bundle',bundleOptionId:uuid}`. 가격/user/권한 필드 금지.
- 서버가 path itemId에 실제로 속한 target을 조회해 `mode=direct`, 길이 1의 selection, 상품/과목/가격/catalog revision/파일/소유권/upgrade base snapshot을 가진 quote를 생성한다. cart row는 생성하지 않는다.
- 기존 `POST /api/market/items/[itemId]/purchase`의 새 확정 body는 **`{quoteId:uuid,idempotencyKey:uuid}`만** 받는다. legacy/V2 모두 키 필수. 오래된 raw assetKind/purchaseType body는 차감 없이 `400 QUOTE_REQUIRED`를 반환한다.
- direct UI는 quote 요청→서버 금액 확인→필수 키 1회 생성→확정 순서로 이관한다. refresh/network 재시도에서도 동일 quote+key를 재사용한다. 같은 키 다른 quote/target은 409, 같은 quote 다른 키도 409다.
- API는 quote.mode가 direct이고 quote의 단일 itemId가 URL itemId와 같은지 검증한다. cart quote를 direct endpoint로 제출하거나 다른 상품 path로 바꾸면 차감 없이 거절한다.
- 공통 구매 RPC는 mode를 DB quote에서 읽으며 클라이언트가 바꾸지 못한다. direct는 cart owner/revision/selected 검사를 생략하지만 profile/account-state, catalog, 가격, 보유, 환불 대기, credit 잠금·원자성·멱등 검증은 동일하다.
- direct 성공은 cart 행을 임의 삭제하지 않는다. 다음 cart GET에서 이미 보유 상태로 보여주며 사용자가 제거할 수 있다.
- 영수증은 원래 청구 결과와 현재 child 상태를 함께 반환한다. 완료 후 환불된 구매의 같은 키 replay를 새 구매로 실행하지 않고 `alreadyCompleted:true`와 refunded 상태를 반환한다.
- `MARKET_CART_ENABLED`는 cart CRUD/quote/checkout 진입만 제어한다. direct quote/purchase와 공통 구매 엔진은 이 flag와 독립적으로 동작한다. 기존 V2 구매 kill switch는 direct/cart에서 V2 타깃이 포함될 때 동일하게 검증한다.

## 9. 변경 후보

- DB: 신규 `supabase/migrations/*_market_cart_checkout.sql`, `supabase/tests/market_cart_checkout.test.sql`, 별도의 동시성 테스트 실행 스크립트.
- 타입/도메인: `src/types/supabase.ts` 재생성, `src/lib/market-cart.ts`, `src/lib/market-cart-server.ts`.
- API: `src/app/api/market/cart/route.ts`, `cart/items/route.ts`, `cart/quote/route.ts`, `cart/checkout/route.ts`, `cart/checkouts/[key]/route.ts`, `src/app/api/market/items/[itemId]/quote/route.ts`, 기존 단건 purchase route.
- UI: `src/app/(solvook)/cart/page.tsx`, cart client, 공통 헤더, 기존 market-item-actions 및 상세 옵션 영역, `path-aware-site-chrome`의 `/cart` 중복 헤더 방지.
- 구매 경계: 기존 단건 API, `market-purchase.ts`, 필요한 `market-items-server.ts` 생성/조회 어댑터. 폐기된 batch API는 410 회귀 테스트만 수행한다.
- 환불/다운로드 경계: `market-refunds.ts`, market refund API, 유료 다운로드 API. 샘플 공개 경로는 변경하지 않는다.
- 충전 복귀: pricing/checkout 호출부의 잘못된 login `redirect`를 기존 `next`/`buildAuthRedirectPath`로 통일하고 공통 헤더의 고정 `/` next를 현재 내부 경로로 수정한다. Toss success와 Kakao result에 `/cart` CTA를 제공한다. payment_orders/외부 PG payload에 returnTo 필드를 추가하지 않는다.
- 탈퇴: `src/app/api/auth/withdraw/route.ts`의 원자 RPC/outbox 호출, profile/auth callback 생성 경계의 tombstone 검사, 신규 `src/app/api/internal/account-withdrawals/reconcile/route.ts`, `account_deletion_jobs`/account_state/RPC migration과 서버 전용 reconciliation secret 설정.
- Storage: Phase 0에서 우회가 확인되면 `storage.objects` bucket별 RLS policy를 최소 범위로 보강하는 별도 migration. 다른 bucket의 정상 접근은 보존한다.
- 테스트: 기존 구매·PDF↔HWP·보유·다운로드·환불·크레딧 만료/중복 처리 테스트의 실제 계약을 보존한다.

## 10. 구현 → 검증 loop

각 Phase는 아래 검증이 통과하기 전 다음 Phase로 진행하지 않는다. 실패 시 원인·수정·재실행 결과를 기록한다.

### Phase 0 — 실제 DB 기준선 확정

- 운영 권한을 가진 읽기 전용 연결로 `pg_constraint`, `pg_indexes`, `pg_policies`, `pg_class.relrowsecurity`, `information_schema.role_table_grants`, `pg_proc/pg_get_functiondef` 및 migration history를 수집한다.
- 제공한 [읽기 전용 preflight SQL](./cart-db-preflight.sql)을 해당 연결에서 실행하고 결과를 보관한다. 이 파일은 계획 작성 중 실행하지 않았다.
- credit once 함수 drift, 최신 consume/refund 본문·보안 권한·유효기간·잠금 순서를 확정한다. 익명/다른 사용자 RLS 테스트는 격리된 검증 DB에서 수행한다.
- **Storage 하드 게이트:** 유료 파일 bucket public=false, storage.objects/buckets role ACL+RLS, MIME/size 설정과 판매 파일 validator의 합치, 활성 DB path→object 누락 0, 설명되지 않은 중복/비참조 object 0을 확인한다. 의도된 동일 PDF 공유·업로드 초안·구버전은 일반 규칙으로 분류하고 자동 삭제하지 않는다.
- 격리 검증에서 anon, 미구매 authenticated, 다른 구매자 및 소유자 세션 모두 market-files에 대한 직접 object GET/list/createSignedUrl이 차단되는지 확인한다. 유료 파일은 서버 다운로드 API만으로 제공해 환불용 사용 이벤트 기록을 우회하지 못하게 한다. 테이블 grant가 존재해도 bucket별 RLS가 차단해야 하며, 다른 공개 bucket 때문에 storage 전체 grant를 무조건 제거하지 않는다.
- 유료 signed URL은 최대 5분 TTL을 유지한다. URL 발급 사용 이력이 있으면 일반 환불 불가라는 기존 정책과 맞추고, 관리 취소/권한 철회 후 이미 발급된 URL의 최대 5분 잔여 접근 창을 명시한다. 공개 샘플의 별도 TTL/공개 API는 이 유료 정책과 혼동하지 않는다.
- 모든 구매/차감/권한/환불/카탈로그 writer 목록 및 lock 순서표를 작성한다. item/subproduct/file/order의 복합 FK를 실제로 비교하고 기존 데이터 위반 건수 0을 확인한다.
- 게이트: 실제 스키마와 마이그레이션 차이가 설명되고, 필요한 접근 권한·복구 가능한 백업·격리 DB가 준비돼야 PASS. 접근 불가 상태를 추측으로 PASS 처리하지 않는다.

### Phase 1 — 장바구니·견적·영수증 스키마

- additive migration, UNIQUE/FK/CHECK, 소유자 SELECT와 service-only mutation RPC 구현.
- 기존 금융 테이블 이름/의미를 바꾸지 않는다. 정상 데이터에만 새 제약을 적용하며 위반 데이터가 나오면 자동 삭제/수정하지 않고 보완 절차를 별도 승인받는다.
- 게이트: fresh DB와 운영 스키마 복제본 양쪽에서 적용, FK 불일치/NULL CHECK/중복 담기/타인 접근/직접 쓰기 거부, 기존 상품·보유·환불 회귀 테스트 통과.

### Phase 2 — 원자 구매 및 기존 경로 이관

- 공통 견적·구매 RPC, 구매 경계·카탈로그 변경 경계·환불/다운로드 경계 이관.
- 가격 변경, PDF/HWP·번들·legacy 겹침, 다중 과목, 50행·정수 한도 구현.
- 게이트: 아래 DB 실패 주입·동시성 테스트 전부 PASS. 기존 legacy/V2 단건을 통한 잠금 우회가 0이고 종료 batch의 410 응답이 유지되어야 한다.

### Phase 3 — API와 UI

- 로그인 복귀, `/cart`, 상세 담기, 헤더 배지, 페이지별 선택 유지, 견적 확인·부족액·결과 확인 처리.
- 게이트: 320/768/1440px, 키보드·포커스·Dialog, 다른 계정으로 전환, 새로고침·뒤로가기·네트워크 실패 시나리오 PASS. 충전은 실제 결제 없이 테스트 모드/fixture로 검증.

### Phase 4 — 통합·점진 공개

- `MARKET_CART_ENABLED` 서버 플래그로 UI/endpoint 공개를 함께 제어한다. 비활성 상태에도 기존 구매는 새 원자 엔진을 사용한다.
- 쓰기 유실/중복 차감/정합성 오류가 있으면 신규 cart checkout을 끈다. 이미 발급한 receipt·소유권·환불 조회는 유지한다.
- DB 변경 롤백을 테이블 DROP이나 금융 이력 삭제로 하지 않는다. additive 스키마를 남기고 진입점만 차단한다.
- 게이트: migration/types/lint/build/타깃 테스트/SQL·동시성·브라우저 검증 및 diff 범위 검토 PASS, 예상하지 못한 financial drift 0. 기존 unrelated lint/test 실패는 사전 기준선과 비교하여 분리하되 새 실패는 0.

## 11. 필수 DB/통합 테스트 매트릭스

| 번호 | 시나리오 | 합격 기준 |
|---|---|---|
| T01 | 동일 타깃 동시 담기 | 행 1개, 두 응답의 cart ID 동일 |
| T02 | 다른 사용자 cart/quote/key 접근 | 존재 여부·항목·가격 스냅샷·영수증 모두 미반환, 타인/없는 대상 동일 404, mutation 0; anon은 401 |
| T03 | 같은 과목이지만 다른 상품의 타깃 FK | DB INSERT 자체 거부 |
| T04 | nullable 타깃 조합/허용되지 않은 legacy kind | CHECK 위반 |
| T05 | 50개 한도에서 동시 두 번 추가 | 최대 50개 유지 |
| T06 | 선택 A+B, 하나가 판매 중지 | 전체 차감·주문·권한·삭제 0 |
| T07 | 견적 후 가격/파일/소유 상태 변경 | 409, 재확인 전 차감 0 |
| T08 | 마지막 페이지/페이지 밖 선택 | 서버 선택 집합과 금액 일치 |
| T09 | 같은 키 같은 payload 동시 20회 | batch 1개, 각 child/차감 1회 |
| T10 | 같은 키 다른 quote/선택 | 충돌, 기존 영수증을 다른 구매 성공으로 반환하지 않음 |
| T11 | 같은 quote 다른 키 | 두 번째 차감 불가 |
| T12 | 응답 유실 후 새로고침/동일 키 재시도 | 같은 영수증, 중복 차감·소유권 0 |
| T13 | 서로 다른 키로 동일 타깃 동시 구매 | 한 번만 소유권 부여·차감 |
| T14 | cart와 기존 legacy/V2 단건 동시 구매 및 종료 batch 호출 | 동일 사용자 직렬화, 이중 구매 0, 종료 batch는 계속 410 |
| T15 | A 주문 생성 뒤 B 차감/권한/line 생성 실패 주입 | 원장·잔액·주문·권한·cart·quote 모두 이전 상태 |
| T16 | 서로 다른 credit_source를 사용하는 여러 child | 각 소비 snapshot 합계=child 청구액, 전체 합=총액 |
| T17 | 만료/pending_refund/잔액 부족 | 유효 소스만 소비, 음수/만료 크레딧 소비 0 |
| T18 | PDF+PDF 포함 HWP / 번들+개별 동시 선택 | 전체 실패, 순서 바꿔도 같은 결과 |
| T19 | PDF 기보유→HWP 차액 | SQL/UI 견적 동일, 기준 주문 기록, 실제 차액만 차감 |
| T20 | PDF 기준 주문 환불과 HWP 업그레이드 동시 실행 | 일관된 한쪽 결과, 공짜 권한/중복 복구 0 |
| T21 | child 환불 중 다른 child 유지 | 해당 child 금액·권한만 복구/해제 |
| T22 | 동일 환불 승인 재시도/동시 요청 | 복구 1회, 원장·권한·요청 상태 원자적 |
| T23 | 유료 다운로드와 환불 승인 경합 | 다운로드 허용/환불 허용이 모순되지 않음 |
| T24 | 영/국어 혼합 | 각 child 과목/FK 정확, 합계 1개, 타과목 파일 노출 0 |
| T25 | 구매 중 다른 탭에서 새 항목 추가/재담기 | 새 ID 및 미선택 행 보존 |
| T26 | 정수 합계 한도 초과/잘못된 body/중복 ID | 차감 전에 일관된 입력 오류 |
| T27 | 카탈로그 파일 추가·가격 수정·비활성화와 checkout 경합 | 검증한 버전으로 완료 또는 명확한 충돌, 무검증 중간 상태 구매 0 |
| T28 | 탈퇴와 checkout 동시 실행 | profile 선행 획득 순서대로 구매 완료→탈퇴 409 또는 탈퇴 pending→구매 차단, 부분 정리 0 |
| T29 | 서비스 플래그 OFF / quote 만료 | 신규 구매 차단, 기존 영수증·보관함·환불 유지 |
| T30 | 관리자/사용자/anon 직접 DML·RPC 호출 | 승인된 권한만 성공, 소유권 위조·가격 조작 불가 |
| T31 | legacy 환불 후 재구매 | 새 purchase/원장 생성, 과거 환불/구매 이력 보존, completed 중복 0 |
| T32 | 부분 보유 후 정가 번들 구매·환불 | 할인 없음 명시 확인, 기존 subproduct 소유권 보존, 새 bundle만 복구 |
| T33 | 충전/provider 환불과 cart 소비 동시 실행 | profile 선행 잠금, 의도된 멱등 재시도, source 잔액/상태 정합 |
| T34 | cart/미사용 quote만 가진 계정 탈퇴·삭제 실패 주입 | 허용된 DB 정리와 job이 전부 commit/rollback, 소비 quote/batch 보존 |
| T35 | Auth 삭제 실패·응답 유실·재시도 | 202 pending, 계정 mutation/프로필 재생성 차단, 동일 job 재시도 후 완료/수동 처리 |
| T36 | direct legacy/V2 quote→구매 및 응답 유실 | 필수 key, 동일 replay 1회 차감, 다른 quote/target/path/mode 위조 차단 |
| T37 | 20행 표시에서 50행 전체 선택·다른 탭 변경 | GET의 전체 ID/revision 집합으로 PATCH/quote, 페이지 밖 포함, 변경 충돌 시 전부 미적용 |
| T38 | Storage 직접 접근 4역할 및 path/object 정합 | API 우회 불가, 활성 참조 누락 0, 설명된 공유/초안만 허용 |
| T39 | legacy HWP↔PDF 기보유/동시 구매/환불, ZIP | exact-kind·각각 정가·독립 권한 및 환불, V2 포함/차액 정책과 분리 |
| T40 | profile lock 대기 중 quote/credit 만료 경계 | 잠금 획득 후 같은 DB 시각으로 판정, 대기 전 now() 때문에 만료를 통과하지 않음 |

## 12. 계획 검증 게이트 및 기록

계획 PASS 조건: (a) 실제 관찰·추론·미확인 사항 분리, (b) 실제 스키마 명칭·제약·권한·migration 경로 명시, (c) 원자성·멱등성·중복·업그레이드·환불·다운로드 경합의 실행 가능한 규칙, (d) 변경 파일/배포·후퇴 경계, (e) 각 Phase의 재현 가능한 합격 기준. 독립 검토자가 중대한 누락을 찾으면 FAIL로 기록하고 보완한 뒤 새 검증 작업으로 재검토한다.

| 회차 | 입력 | 결과 | 후속 |
|---|---|---|---|
| 1 | 자체 검토: 감사 보고서와 초안 대조 | FAIL | 종료 batch 오인, 부분보유 번들 정책 변경, legacy 재구매 UNIQUE, 기준 주문 FK, provider refund 잠금 역전, catalog phantom 프로토콜 미확정 |
| 2 | 독립 R1, v2 SHA-256 `5b3d3af69cccf67daef3159e4f77fc1882ad0324634f9587bc5fe07ff9050780` | PLAN FAIL | [R1 보고서](./cart-plan-review-r1.md)의 B1~B6: 탈퇴 경합, direct 계약, 전체 선택, Storage, legacy coverage, 보안 문구 |
| 3 | v3: B1~B6의 명시적 계약·보안 gate·T34~40 추가 | PLAN PASS | [독립 R2 검증](./cart-plan-review-r2.md), 정책/DB 계약 본문 변경 없이 상태만 확정 |

최종 PASS는 문서 해시·검증자 task/dispatch·통과 근거를 별도 검증 기록에 남긴다. 후속 구현의 실제 SQL/동시성/운영 테스트를 수행한 것으로 표현하지 않는다.
