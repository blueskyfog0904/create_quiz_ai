# 장바구니 Phase 0 — 로컬(마이그레이션·코드) 기준선

- 작성일: 2026-09-30 KST
- 범위: `supabase/migrations/` 92개 파일을 파일명(버전) 순으로 추적한 **기대 최종 상태**와 `src/` 서버 코드의 writer·잠금 경로. 운영 DB에는 접속하지 않았다.
- 변경: 이 문서만 작성. 코드·마이그레이션·DB는 수정하지 않았다.
- 표기: **사실** = 파일:라인으로 확인. **추론** = SQL/PG 규칙에서 도출했으나 실행 검증 안 함. **미확인** = 로컬 근거 없음(운영 대조 필요).
- 제약 이름: `명시` = migration에 이름이 적혀 있음. `자동` = 인라인 제약이라 PostgreSQL 기본 명명(`{table}_{column}_check|fkey|key`, 복수 컬럼 UNIQUE는 `{table}_{col1}_{col2}_key`)을 따를 것으로 **추론**한 이름.

---

## 0. 가장 중요한 발견 (요약)

1. **로컬 migration만으로는 운영 스키마를 재현할 수 없다 (사실+추론).** `credit_transactions`는 `20251209000000_add_role_sessions_credits.sql:33`에서 먼저 생성되고, `20260206_credit_system.sql:77`의 `CREATE TABLE IF NOT EXISTS`는 건너뛴다. 그 결과 로컬 기준 `credit_transactions`에는 `source_id/resource_type/resource_id` 컬럼이 없고 `type` CHECK는 `('charge','use_ai_generation','use_question_purchase','refund','bonus')`인데, 최신 `consume_credits`(`20260805110000:184-200`)는 `resource_type/resource_id`와 `type='consume'`을 insert한다. 또 `20260206:191,194`의 `CREATE POLICY "Users can view own transactions"/"System can insert transactions"`는 `20251209:87,90`과 이름이 같아 fresh replay에서 오류가 날 것으로 **추론**한다. 운영 OpenAPI(`docs/cart-live-db-evidence.json`)에는 이 컬럼들이 있다.
2. **drift 컬럼·함수 (사실).** 운영/생성 타입에만 있고 migration에는 없는 것: `consume_credits_once`, `refund_credits_once`(`src/types/supabase.ts:4359,4741`), `credit_consumption.transaction_id/operation_key`, `credit_transactions.operation_key/original_operation_key`, `market_items.subject_code`. 생성 타입에는 `grant_credits`, `deduct_credits` RPC도 있다(`src/types/supabase.ts:4453,4591`). migration 정의와 코드 호출은 없다. `_once` 함수는 `src/`·`supabase/`·`tests/` 어디에서도 호출하지 않는다(타입 정의만 있음).
3. **역순 잠금은 point-charge refund finalizer에만 있는 게 아니다 (사실).** `finalize_point_charge_refund`(`20260818073025:125-202`), `quarantine_external_provider_cancellation`(`20260818073025:289-328`), 미사용이지만 service_role에 grant된 `finalize_toss_refund`(`20260805120000:340-385`)가 source→…→profile 순서다. 충전 fulfill 2종은 payment_order→profile 순서다. 구매(`consume_credits`)는 profile→source다. KakaoPay 도메인 안에서도 `claim_kakaopay_callback`(provider_tx→order)과 나머지(order→provider_tx)가 역순이다.
4. **실제로 교착 가능성이 가장 뚜렷한 쌍은 `consume_credits` ↔ `quarantine_external_provider_cancellation` (추론).** quarantine은 `status='active'`일 수 있는 source를 먼저 잠그고 profile을 기다린다. finalize는 대상 source가 이미 `pending_refund`여서 `consume_credits`의 `status='active'` 필터에 걸리지 않으므로 consume과의 교착은 드물고, `refund_credits`(JSON source는 status 무관 잠금)와의 경합이 남는다.
5. **market 구매·환불은 HTTP 다단계+보상이다 (사실).** V2: `consume_credits`→order→line→entitlement insert가 각각 별도 요청이다(`src/lib/market-purchase.ts:312-367`, `src/lib/market-items-server.ts:1935-1988`). 승인 `approveMarketRefund`는 요청 행을 잠그지 않고 `refund_credits` 후 `Promise.all`로 갱신하며, 최종 UPDATE에 `status='pending'` 조건이 없다(`src/lib/market-refunds.ts:493-563`).
6. **클라이언트 멱등 키가 매 클릭 새로 생성된다 (사실).** `market-item-actions.tsx:462,467`의 `idempotencyKey`에 `Date.now()`가 들어간다. 따라서 DB의 `(user_id,idempotency_key)` UNIQUE는 네트워크 재시도 중복을 막지 못한다. legacy 구매는 키 자체가 없다.
7. **legacy 경로는 활성이다 (사실).** 구매 route는 body에 `purchaseType`이 없으면 legacy 처리로 분기한다(`purchase/route.ts:60-64`). 상세 UI도 `{assetKind}` body를 보낸다(`market-item-actions.tsx:469`). 다운로드·환불·목록 enrichment도 legacy 테이블을 읽는다. 라벨은 `'HWP & PDF'`이지만 권한 판정은 exact-kind다(`src/lib/market-purchase.ts:40-56`).
8. **market 테이블은 명시 GRANT/REVOKE가 전혀 없다 (사실).** RLS 정책만 방어선이다. `market_purchases`에는 `auth.uid()=user_id`만 검사하는 사용자 INSERT/UPDATE 정책이 남아 있다(`20260317113000:251-264`). Supabase 기본 ACL이 authenticated에 쓰기를 주고 있다면 사용자가 legacy 구매를 위조할 수 있다(**추론, 운영 grant 미확인**).
9. **탈퇴는 payment_orders/checkout_attempts만 막는다 (사실).** V2 주문·legacy 구매·market 환불 이력·admin 지급 credit이 있는 사용자는 막지 않는다. 그 이력은 profile 삭제 CASCADE로 함께 삭제된다. 검사→삭제는 잠금 없이 순차 HTTP로 진행된다(`src/app/api/auth/withdraw/route.ts:35-72`).
10. **Storage·market-files는 migration에 없다 (사실).** `market-files` bucket 생성과 `storage.objects` 정책 migration이 없다. `storage.buckets` insert는 `main_ad_images`뿐이다(`20260725090000:1`). 운영 bucket 설정·정책은 전부 미확인이다.

---

## 1. 기대 스키마표

### 1.0 공통 규칙

- RLS 정책의 `roles`: `TO`를 적지 않은 정책은 `{public}`이다. 20260206 이전 정책 대부분이 여기에 해당한다.
- `public.is_admin()`은 `20260208000000_create_is_admin_helper.sql`에서 정의된다.
- market 계열 테이블에는 GRANT/REVOKE 문이 없다. 예외는 `market_category_*`와 `market_menu_groups`다. 이 테이블들은 프로젝트 기본 ACL을 따른다(**미확인**).

### 1.1 profiles

| 항목 | 기대값 | 정의 migration |
|---|---|---|
| PK | `profiles_pkey(id)` 자동 | `0000_initial_schema.sql:5-6` |
| FK | `profiles_id_fkey` → `auth.users(id)` ON DELETE CASCADE, 자동 | `0000:6` |
| CHECK | `profiles_role_check` role IN ('teacher','academy_instructor') 자동 | `20251209000000:5-6` |
| 주요 컬럼 | `credits integer NOT NULL DEFAULT 0`(CHECK 없음), `is_admin`, `signup_completed boolean NOT NULL DEFAULT true` | `20260206:10-11`, `20260222_require_kakao_signup_completion.sql:2-3` |
| INDEX | `idx_profiles_provider_kakao_id(provider,kakao_id)` | `20260220_kakao_oauth_meta_resilience.sql:75-76` |
| RLS | ENABLE | `0000:75` |
| 정책 | `Users can view own profile` SELECT `{public}` `auth.uid()=id` | `0000:84` |
| 정책 | `Admins can view all profiles` SELECT `{authenticated}` `is_admin()` | 최종 `20260629080806:10-16` (최초 `20251209100000:76`) |
| 정책 제거 | `Users can update own profile` DROP | `20260805090000:4` |
| GRANT | `REVOKE UPDATE ... FROM PUBLIC, anon, authenticated` | `20260805090000:12` |
| TRIGGER | `on_profile_created_init_credits` AFTER INSERT → `initialize_user_credits()` | `20251209000000:141-145` |
| 없음 | `account_state` 컬럼(계획 5.7), CHECK로 `credits>=0` 등 | — |

profiles를 참조하는 FK의 ON DELETE 동작은 탈퇴 분석(4절)에 쓴다.

| 참조 테이블.컬럼 | ON DELETE | 근거 |
|---|---|---|
| credit_sources.user_id | CASCADE | `20260206:37` |
| credit_consumption.user_id | CASCADE | `20260206:60` |
| credit_transactions.user_id | CASCADE | `20251209000000:35` (로컬 replay 기준) |
| payment_history.user_id | CASCADE | `20260206:102` |
| refund_requests.user_id / processed_by | CASCADE / SET NULL | `20260206:124,130` |
| payment_orders.user_id | **RESTRICT** | `20260805100000:6` |
| checkout_attempts.user_id | **RESTRICT** | `20260818060118:58` |
| market_purchases.user_id | CASCADE | `20260317113000:60` |
| market_download_events.user_id | CASCADE | `20260317113000:81` |
| market_purchase_orders.user_id | CASCADE | `20260528010000:140` |
| market_entitlements.user_id | CASCADE | `20260528010000:203` |
| market_refund_requests.user_id / processed_by | CASCADE / SET NULL | `20260602020000:64,75` |
| market_items/market_item_files/market_subproduct_files.created_by 등 | SET NULL | `20260317113000:23-24,48`, `20260528010000:90` |

### 1.2 credit_sources

| 항목 | 기대값 | migration |
|---|---|---|
| 컬럼 | id, user_id, plan_id, initial_credits int NOT NULL, remaining_credits int NOT NULL, status, purchased_at, expires_at, created_at, updated_at, source_category text NOT NULL DEFAULT 'plan_purchase', payment_order_id uuid | `20260206:35-47`, `20260415023000:7,40-47`, `20260805100000:72-73` |
| PK/FK | `credit_sources_pkey` 자동; `credit_sources_user_id_fkey` CASCADE 자동; `credit_sources_plan_id_fkey` SET NULL 자동; `credit_sources_payment_order_id_fkey` → payment_orders RESTRICT **명시** | `20260206:37-38`, `20260805100000:89-92` |
| CHECK | `credit_sources_status_check` ('active','pending_refund','refunded') 자동; `credit_sources_source_category_check` **명시** ('plan_purchase','admin_grant','system_refund','bonus','legacy_unknown') | `20260206:41-42`, `20260415023000:52-68` |
| **없음** | `initial_credits>=0`, `0<=remaining_credits<=initial_credits` | 계획 5.6 대상 |
| partial UNIQUE | `credit_sources_payment_order_id_key(payment_order_id) WHERE payment_order_id IS NOT NULL` | `20260805100000:98-100` |
| INDEX | idx_credit_sources_user_id / status / purchased_at | `20260206:51-53` |
| RLS/정책 | ENABLE. `Users can view own credit sources` SELECT `{public}`. `Admins can manage all credit sources` ALL `{public}`(EXISTS is_admin) | `20260206:160-177` |
| 정책 제거 | `System can insert/update credit sources` | `20260805090000:5-6` |
| GRANT | `REVOKE INSERT, UPDATE, DELETE FROM PUBLIC, anon, authenticated` (SELECT·TRUNCATE 등은 revoke 안 함) | `20260805090000:13` |
| TRIGGER | `update_credit_sources_updated_at` | `20260206:260-263` |

### 1.3 credit_consumption

| 항목 | 기대값 | migration |
|---|---|---|
| 컬럼 | id, user_id, source_id NOT NULL, amount int NOT NULL, resource_type, resource_id, description, created_at | `20260206:58-67` |
| drift | 운영/타입에만 있음: `transaction_id`(→credit_transactions.id FK로 보임), `operation_key` | `docs/cart-live-db-evidence.json:1264`, `src/types/supabase.ts` credit_consumption Row |
| FK | `credit_consumption_user_id_fkey` CASCADE, `credit_consumption_source_id_fkey` → credit_sources CASCADE (자동) | `20260206:60-61` |
| **없음** | `amount > 0` CHECK | 계획 5.6 대상 |
| RLS/정책 | ENABLE. `Users can view own consumption` SELECT `{public}` | `20260206:180-183` |
| 정책 제거 | `System can insert consumption` | `20260805090000:7` |
| GRANT | REVOKE I/U/D FROM PUBLIC, anon, authenticated | `20260805090000:14` |

### 1.4 credit_transactions (로컬 replay 불일치 있음)

| 항목 | 로컬 replay 기대값 | 비고 |
|---|---|---|
| 생성 | `20251209000000:33-42`가 먼저 생성한다. `20260206:77-89`의 CREATE는 `IF NOT EXISTS`라 건너뛴다(추론). | 운영은 `source_id/resource_type/resource_id/operation_key/original_operation_key`를 가진다(evidence). |
| 컬럼(로컬) | id DEFAULT uuid_generate_v4(), user_id, type, amount, balance_after, description, reference_id, created_at | 운영에는 `reference_id`가 보이지 않는다(evidence `tables.credit_transactions`). |
| CHECK(로컬) | `credit_transactions_type_check` IN ('charge','use_ai_generation','use_question_purchase','refund','bonus') 자동 | 최신 함수가 쓰는 'consume','purchase'와 맞지 않는다. 20260206 의도는 ('purchase','consume','refund','admin_grant','bonus')다. **운영 정의 미확인.** |
| FK | `credit_transactions_user_id_fkey` CASCADE. 운영 타입에는 `credit_transactions_source_id_fkey` → credit_sources도 있다(`src/types/supabase.ts:457`). | source_id FK의 ON DELETE는 migration 의도상 SET NULL(`20260206:85`), 운영 미확인 |
| INDEX | idx_credit_transactions_user_id, _created_at(20251209), _type(20260206) | `20251209000000:124-125`, `20260206:94` |
| 정책 | `Users can view own transactions` SELECT; `Admins can view all transactions` SELECT `{public}` | `20251209000000:87`, `20260206:197` |
| 정책 이름 충돌 | `20260206:191,194`가 20251209와 같은 이름으로 CREATE POLICY(IF NOT EXISTS 없음) | fresh replay 실패 **추론** |
| 정책 제거 | `System can insert transactions` | `20260805090000:8` |
| GRANT | REVOKE I/U/D FROM PUBLIC, anon, authenticated | `20260805090000:15` |

### 1.5 payment 계열

**payment_orders** — `20260805100000:4-70`, 확장 `20260818060118:83-160`

| 항목 | 기대값 |
|---|---|
| UNIQUE | `payment_orders_order_id_key`, `payment_orders_payment_key_key`, `payment_orders_confirm_idempotency_key_key`, `payment_orders_cancel_idempotency_key_key` 자동. partial `payment_orders_checkout_attempt_id_key` 명시(`060118:162-164`) |
| FK | `payment_orders_user_id_fkey` → profiles **RESTRICT** 자동. `payment_orders_plan_id_fkey` SET NULL 자동. `payment_orders_source_id_fkey` → credit_sources RESTRICT 명시. `payment_orders_payment_history_id_fkey` RESTRICT 명시(`0805100000:81-87`). `payment_orders_checkout_attempt_id_fkey` RESTRICT 명시(`060118:151-154`) |
| CHECK | `payment_orders_expected_amount_check`(1..100000) 자동, `payment_orders_expected_credits_check`(>0) 자동, `payment_orders_environment_check` 자동. 아래는 명시로 NOT VALID 추가 후 `20260818062254`에서 VALIDATE: `payment_orders_provider_check`('toss','kakaopay'), `payment_orders_status_check`(preparing…manual_review 11종), `payment_orders_provider_environment_check`, `payment_orders_tax_snapshot_check`, `payment_orders_provider_snapshot_check` |
| NOT NULL 변경 | provider_environment, provider_merchant_id, checkout_expires_at SET NOT NULL, mid DROP NOT NULL (`060118:114-118`) |
| TRIGGER | `update_payment_orders_updated_at`, `prevent_payment_order_snapshot_update` BEFORE UPDATE (`0805100000:120-125`, `060118:258-262`) |
| RLS/정책 | ENABLE. `Users can view own payment orders` 생성 후 DROP → **정책 없음** (`060118:522-523`) |
| GRANT | 최종 `REVOKE ALL FROM PUBLIC, anon, authenticated` + `GRANT ALL TO service_role` (`060118:529-536`). 0805100000의 `GRANT SELECT TO authenticated`는 회수됨 |

**payment_history** — `20260206:100-113`, 확장 `20260805100000:74-118`

- FK: `payment_history_user_id_fkey` CASCADE, `payment_history_source_id_fkey` SET NULL, `payment_history_plan_id_fkey` SET NULL(자동), `payment_history_payment_order_id_fkey` RESTRICT(명시).
- CHECK: `payment_history_status_check`('completed','refunded','failed')(자동), `payment_history_amount_charge_limit`(0..100000) **NOT VALID이며 VALIDATE migration 없음** → 기대 `convalidated=false`.
- partial UNIQUE: `payment_history_payment_order_id_key`, `payment_history_order_id_key`, `payment_history_payment_key_key`.
- 정책: `Admins can manage all payments` ALL `{public}`만 남는다. `Users can view own payments`는 `060118:524`에서 DROP, `System can insert payments`는 `0805090000:9`에서 DROP.
- GRANT: REVOKE ALL FROM PUBLIC, anon, authenticated; ALL TO service_role(`060118:531,537`).

**checkout_attempts** — `20260818060118:56-82`

- UNIQUE: `checkout_attempts_user_id_checkout_attempt_id_key`, `checkout_attempts_payment_order_id_key`(자동).
- FK: user_id → profiles RESTRICT, plan_id → pricing_plans RESTRICT(자동), `checkout_attempts_payment_order_id_fkey` RESTRICT(명시).
- CHECK: `checkout_attempts_claimed_provider_check`, `checkout_attempts_status_check`(자동).
- RLS ENABLE, 정책 없음. REVOKE ALL FROM PUBLIC, anon, authenticated; ALL TO service_role.

**payment_provider_transactions** — `060118:166-208`

- `payment_provider_transactions_payment_order_id_key` UNIQUE, FK RESTRICT. partial UNIQUE 4개(명시 index).
- RLS ENABLE, 정책 없음. **REVOKE ALL FROM PUBLIC, anon, authenticated, service_role; GRANT SELECT TO service_role.** 쓰기는 SECURITY DEFINER 함수로만 한다.
- TRIGGER `prevent_payment_provider_identifier_replacement`.

**기타**: `payment_runtime_config`(service_role SELECT만, `060118:4-25`), `payment_webhook_events`(REVOKE ALL FROM anon, authenticated — **PUBLIC 미포함**; ALL TO service_role, `20260805130000:22-25`), `payment_reconciliation_{scheduler,runs,items,alerts}`(REVOKE ALL incl. service_role, SELECT TO service_role, `20260818074554:70-87`), `pricing_plans_price_charge_limit` NOT VALID(`0805100000:111-114`, VALIDATE 없음).

### 1.6 refund_requests (포인트 충전 환불)

| 항목 | 기대값 | migration |
|---|---|---|
| FK | user_id CASCADE, source_id → credit_sources **CASCADE**, processed_by SET NULL(자동); `refund_requests_payment_order_id_fkey` RESTRICT(명시) | `20260206:124-130`, `20260805120000:34-38` |
| CHECK | `refund_requests_status_check` 명시: ('pending_review','processing','completed','rejected','retryable_failed','manual_review'); `refund_requests_refund_amount_check`(NULL 또는 1..100000); `refund_requests_provider_check`('toss','kakaopay') NOT VALID → VALIDATE | `0805120000:1-2,23-41`, `062122:449-453`, `062254:14-15` |
| 컬럼 | payment_order_id, refund_amount, cancel_idempotency_key, provider_cancel_transaction_key, provider_cancelled_at, attempt_count, next_attempt_at, last_error_*, provider NOT NULL | `0805120000:12-21`, `062122:436-450` |
| partial UNIQUE | `refund_requests_one_open_source(source_id) WHERE status IN (pending_review,processing,retryable_failed,manual_review)`, `refund_requests_cancel_idempotency_key` | `0805120000:43-54` |
| 정책 | `Admins can manage all refund requests` ALL만. `Users can view own refund requests`는 `060118:526` DROP, `Users can insert own refund requests`는 `0805090000:10` DROP | |
| GRANT | REVOKE ALL FROM PUBLIC, anon, authenticated; ALL TO service_role | `060118:533,538` |

### 1.7 market 카탈로그

**market_items** — `20260317113000:1-28`

| 항목 | 기대값 |
|---|---|
| FK | `market_items_menu_entry_id_fkey` → market_menu_entries CASCADE, created_by/updated_by SET NULL(자동), `market_items_category_item_subject_fkey (category_item_id, workspace_subject)` → market_category_items ON DELETE SET NULL(category_item_id)(명시, `20260902045933:84-98`) |
| UNIQUE | `uq_market_items_id_workspace_subject(id, workspace_subject)` index (`20260528010000:5-6`). 복합 FK의 참조 대상 |
| CHECK | `market_items_pdf_price_check`, `_hwp_price_check`, `_status_check`('draft','published','hidden','archived'), `_view_count_check`, `_workspace_subject_check`(자동, `20260331091000:57-59`), `_zip_price_check`(자동, `20260525054805:2`), `market_items_draft_source_check`(명시, `20260524010000:7-9`), `market_items_question_count_check`(명시, `20260524020000:7-9`) |
| drift | 운영에 `subject_code` 컬럼이 있으나 migration에 없음 |
| 없음 | `catalog_revision`(계획 7.3) |
| RLS | ENABLE. `Authenticated users can read published market items` SELECT `{authenticated}`(published+active+미삭제+메뉴 visible/active). `Admins can manage market items` ALL `{authenticated}` | `:185-216` |
| TRIGGER | `trg_market_items_updated_at` |

**market_item_files (legacy)** — `20260317113000:36-52`

- FK `market_item_files_item_id_fkey` CASCADE, created_by SET NULL.
- CHECK: `market_item_files_asset_kind_check`는 명시적으로 재생성되어 ('sample','pdf','hwp','zip')(`20260525054805:7-21`). file_size_bytes, version, workspace_subject CHECK는 자동.
- partial UNIQUE `uq_market_item_files_active_kind(item_id, asset_kind) WHERE is_active AND deleted_at IS NULL`(`:118-120`).
- 정책: `Authenticated users can read active market item files` SELECT(published item), `Admins can manage market item files` ALL(`:218-242`).

**market_item_subproducts** — `20260528010000:47-72`

- 명시 FK: `market_item_subproducts_item_workspace_fkey (item_id, workspace_subject)` → market_items CASCADE, `market_item_subproducts_category_workspace_fkey` → market_subproduct_categories.
- UNIQUE index `uq_market_item_subproducts_id_workspace_subject`. **`(id,item_id,workspace_subject)` 후보키는 없다**(계획 5.6).
- CHECK: price_credits>=0, workspace_subject(자동). 컬럼 추가: purchase_notice_label/text(`20260611004228`).
- 정책: `Authenticated users can read active market subproducts` SELECT(부모 published), `Admins can manage market subproducts` ALL(`:434-459`).

**market_subproduct_files** — `20260528010000:74-110`

- 명시 FK: `_item_workspace_fkey` CASCADE, `_subproduct_workspace_fkey` CASCADE, `_type_workspace_fkey` → market_file_types. **file.item_id와 subproduct.item_id 일치를 강제하는 FK는 없다.**
- UNIQUE index `uq_market_subproduct_files_id_workspace_subject`.
- 정책: `Users can read entitled market subproduct files` SELECT(is_admin 또는 active entitlement item/subproduct/file 범위), `Admins can manage market subproduct files` ALL(`:461-493`).

**market_item_bundle_options** — `20260528010000:112-135`

- 명시 FK `_item_workspace_fkey` CASCADE. partial UNIQUE `uq_market_item_bundle_options_active_item(item_id, workspace_subject) WHERE is_active`, UNIQUE `uq_..._id_workspace_subject`.
- 정책: 사용자 SELECT(active+published item), Admin ALL.

**market_item_sample_pages** — `20260522052059:1-59`, 확장 `20260528010000:295-343`

- FK item_id CASCADE, source_file_id → market_item_files SET NULL, created_by → auth.users. **workspace_subject CHECK 없음**(`:5`), `updated_at` 컬럼 없음.
- CHECK: `market_item_sample_pages_page_number_positive_check`(명시, 원래 1..3 CHECK는 DROP), `market_item_sample_pages_status_check`('draft','active','removed').
- `uq_market_item_sample_pages_active_page` DROP(`20260528010000:340`).
- 정책: authenticated SELECT(active+published), Admin ALL.

**market_menu_entries / groups / category**

- 메뉴 가시성은 `market_items` SELECT 정책에 포함된다(`20260317113000:200-207`).
- `market_menu_entries_group_workspace_subject_fkey`는 ON DELETE RESTRICT다(`20260730010000:30-46`).
- `market_menu_groups`: `grant insert, update, delete ... to authenticated`(`20260730010000:109`) + Admin 정책.
- `market_category_groups/items`: REVOKE ALL anon/auth 후 SELECT만 grant(`20260902045933:67-70`).

### 1.8 market 구매·권한·환불

**market_purchase_orders** — `20260528010000:137-163`, 확장 `20260602020000:6-7`

| 항목 | 기대값 |
|---|---|
| FK | `market_purchase_orders_user_id_fkey` CASCADE(자동), `market_purchase_orders_legacy_purchase_id_fkey` → market_purchases SET NULL(자동), `market_purchase_orders_item_workspace_fkey` CASCADE(명시). **item FK CASCADE이므로 상품 hard delete 시 주문도 삭제됨** |
| CHECK(자동) | workspace_subject, purchase_type('subproduct','bundle','legacy_backfill'), original_price_credits>=0, charged_credits>=0, status('completed','refunded','revoked','failed') |
| partial UNIQUE | `uq_market_purchase_orders_user_idempotency(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL` (status 무관) |
| UNIQUE | `uq_market_purchase_orders_id_workspace_subject`. `(id,user_id,item_id,workspace_subject)` 후보키 없음 |
| 컬럼 | credit_consumptions jsonb. **`upgrade_base_order_id` 없음**(계획 5.6) |
| 정책 | `Users can read own market purchase orders` SELECT `{authenticated}` (본인 또는 admin), `Admins can manage market purchase orders` ALL |

**market_purchase_lines** — `20260528010000:165-198`

- 명시 FK 4개: `_order_workspace_fkey` CASCADE, `_item_workspace_fkey` CASCADE, `_subproduct_workspace_fkey`, `_bundle_workspace_fkey`. 명시 CHECK `market_purchase_lines_target_check`. 자동 CHECK: line_type, price_credits, status('completed','refunded','revoked'), workspace_subject.
- **line.item_id=order.item_id, target∈item을 강제하지 않는다. 같은 target line 중복 UNIQUE도 없다.**
- 정책: 본인 주문 SELECT(EXISTS), Admin ALL.

**market_entitlements** — `20260528010000:200-252`

- 명시 FK: `_item_workspace_fkey` CASCADE, `_subproduct_workspace_fkey`, `_file_workspace_fkey`, `_order_workspace_fkey`(ON DELETE 미지정=NO ACTION). 자동 FK: user_id CASCADE, source_purchase_id → market_purchases SET NULL. 명시 CHECK `market_entitlements_scope_target_check`. 자동 CHECK: scope, legacy_asset_kind, status, workspace_subject.
- partial UNIQUE: `uq_market_entitlements_active_item(user_id,item_id,scope) WHERE scope='item' AND status='active'`, `_active_subproduct`, `_active_file`, `_legacy_source(source_purchase_id, legacy_asset_kind, scope) WHERE scope='legacy_asset' AND source_purchase_id IS NOT NULL`.
- **entitlement.user_id=order.user_id를 강제하지 않는다.**
- 정책: 본인/admin SELECT, Admin ALL.

**market_purchases (legacy)** — `20260317113000:58-77`

| 항목 | 기대값 |
|---|---|
| UNIQUE | `market_purchases_user_id_item_id_asset_kind_key (user_id,item_id,asset_kind)` **전체 UNIQUE**(자동) — 계획 5.6에서 completed partial로 교체 대상 |
| CHECK | `market_purchases_asset_kind_check` 명시 재생성('pdf','hwp','zip')(`20260525054805:23-37`), price_credits>=0, status('pending','completed','refunded','revoked'), workspace_subject(자동) |
| FK | user_id CASCADE, item_id CASCADE(자동) |
| 컬럼 | credit_consumptions jsonb(`20260602020000:3-4`) |
| 정책 | `Users can read own market purchases` SELECT, **`Users can insert own market purchases` INSERT WITH CHECK auth.uid()=user_id**, **`Users can update own pending market purchases` UPDATE USING/WITH CHECK auth.uid()=user_id(pending 조건 없음)**, `Admins can manage market purchases` ALL — 모두 `{authenticated}` (`:244-272`) |
| GRANT | 명시 없음 → 기본 ACL(**미확인**) |

**market_download_events** — `20260317113000:79-90`, 확장 `20260602020000:9-59`

- FK: user_id, item_id CASCADE; file_id → market_item_files CASCADE(NOT NULL 해제); purchase_id SET NULL; order_id, entitlement_id, subproduct_file_id SET NULL.
- CHECK 명시: `market_download_events_asset_kind_check`('sample','pdf','hwp','zip'), `market_download_events_target_check`, `market_download_events_event_target_type_check`.
- 정책: 본인 SELECT, Admin SELECT. **사용자 INSERT 정책은 `20260602020000:146`에서 DROP.**

**market_refund_requests** — `20260602020000:61-143`

- 명시 CHECK `market_refund_requests_target_check`. 자동 CHECK: workspace_subject, target_kind('legacy_purchase','v2_order'), requested_refund_credits>0, approved_refund_credits, status('pending','approved','rejected','canceled','failed').
- FK: user_id CASCADE, item_id → market_items CASCADE, legacy_purchase_id CASCADE, order_id CASCADE, processed_by SET NULL(모두 자동).
- partial UNIQUE: `uq_market_refund_requests_pending_order(order_id) WHERE target_kind='v2_order' AND status IN ('pending','approved')`, `uq_market_refund_requests_pending_legacy`.
- 정책: 본인/admin SELECT, Admin ALL. **사용자 INSERT 정책 DROP**(`20260602021000:4`).
- TRIGGER `trg_market_refund_requests_updated_at`.

---

## 2. 기대 함수표 (public, 이름에 market|credit|payment|refund 포함)

공통으로 "EXEC"는 최종 GRANT/REVOKE EXECUTE 대상이다. 명시 문이 없는 함수는 PostgreSQL 기본값에 따라 PUBLIC EXECUTE로 **추론**한다.

### 2.1 크레딧

| 함수(인자) | 최종 정의 | SD | search_path | EXEC | 잠금 순서 |
|---|---|---|---|---|---|
| `consume_credits(uuid,int,text,uuid,text)` | `20260805110000:78-207` (이력: `20260306000000:9` → `20260805090000:20-32` ALTER/권한 → 최종) | Y | public, pg_temp | REVOKE PUBLIC/anon/auth, GRANT service_role (`:329-340`). 20260306의 authenticated grant(`:235`)는 `0805090000:25`에서 회수 | ① `profiles(p_user_id)` FOR UPDATE(`:103-106`) ② 사용 가능 `credit_sources`를 `expires_at ASC NULLS LAST, purchased_at, id` 순 FOR UPDATE(`:112-119`, 루프에서 재잠금 `:133-141`). 만료 판정은 `now()`=트랜잭션 시작 시각(`:91,117`) |
| `refund_credits(uuid,int,text,uuid,text,jsonb,int DEFAULT NULL)` | `20260805110000:209-325` | Y | public, pg_temp | service_role only (`:332-343`) | ① `profiles` FOR UPDATE(`:243-246`) ② JSON 배열 **입력 순서대로** `credit_sources(id,user_id)` FOR UPDATE(`:263-268`). 정렬하지 않고 source status도 검사하지 않음 |
| `get_credit_balance_snapshot(uuid)` | `20260805110000:5-76` | Y, STABLE | public, pg_temp | service_role only | 없음 |
| `initialize_user_credits()` (trigger) | `20251209000000:130-138` | Y | **미설정** | 명시 없음 | user_credits insert |
| `consume_credits_once(...)`, `refund_credits_once(...)` | **로컬 정의 없음**. 타입 `src/types/supabase.ts:4359-4368, 4741-4752`에만 있음(인자 p_user_id,p_amount,p_resource_type,p_resource_id,p_description,p_operation_key / +p_original_operation_key,p_target_balance) | 미확인 | 미확인 | 미확인 | 미확인 |

`_once` 재확인(grep `consume_credits_once|refund_credits_once`, `src/ supabase/ tests/` 대상): 결과는 `src/types/supabase.ts:4359`, `:4741` 두 줄뿐이다. **코드에서 호출하지 않는다.** 모든 차감·환불은 `src/lib/credits.ts:192`(`consume_credits`), `:280`(`refund_credits`)을 거친다.

### 2.2 충전(payment) fulfill·주문

| 함수 | 최종 정의 | SD | search_path | EXEC | 잠금 순서 |
|---|---|---|---|---|---|
| `finalize_toss_payment(uuid,text,text,text,text,timestamptz)` | `20260818062122:4-204` (최초 `20260805100000:127`) | Y | public, pg_temp | service_role (`:199-204`) | `payment_orders` FOR UPDATE(`:26-28`) → runtime_config 읽기 → `profiles` FOR UPDATE(`:80-83`) → credit_sources INSERT → profiles/payment_history/credit_transactions/payment_orders/checkout_attempts 갱신 |
| `finalize_kakaopay_payment(uuid,text,text,text,text,text,timestamptz)` | `20260818062122:206-434` | Y | public, pg_temp | service_role | `payment_orders`(`:230-232`) → `payment_provider_transactions`(`:260-262`) → `profiles`(`:310-313`) → 동일 쓰기 |
| `prepare_payment_order(17인자, +p_partner_user_id)` | `20260818071513:8-160` (16인자판은 `:3` DROP) | Y | public, pg_temp | service_role | checkout_attempts INSERT ON CONFLICT DO NOTHING → checkout_attempts FOR UPDATE → payment_orders INSERT. **profile 잠금 없음** |
| `begin_kakaopay_ready`, `store_kakaopay_ready`, `record_kakaopay_approval`, `mark_kakaopay_callback_failure` | `20260818071513:163,241,425,496` | Y | public, pg_temp | service_role (`:544-571`) | payment_orders → (provider_tx) |
| `claim_kakaopay_callback(text,text,text,timestamptz)` | `20260818071513:312` | Y | public, pg_temp | service_role | **payment_provider_transactions(`:335-339`) → payment_orders(`:348-352`)** — 다른 KakaoPay 함수와 역순 |
| `get_my_payment_history()`, `get_my_refund_requests()` | `20260818060118:438,477` | Y (sql) | public, pg_temp | REVOKE PUBLIC/anon, **GRANT authenticated** (`:507-514`) | 없음 |
| reconciliation: `start_…_run(int)`, `claim_…_batch(uuid,int)`, `record_…_result(uuid,text×4)`, `mark_…_terminal(uuid,text×4)`, `finish_…_run(uuid,bool,text,text)`, `get_…_health()` | `20260818074554:123-655` | Y | public, pg_temp | service_role | claim_batch: payment_orders `FOR UPDATE SKIP LOCKED`(`:276`); record/terminal: payment_orders → ppt/checkout_attempts |
| `payment_reconciliation_backlog_count()`, `enforce_payment_reconciliation_health()` | `20260818074554:89,464` | Y | public, pg_temp | REVOKE PUBLIC/anon/auth, **grant 없음**(owner/cron 전용) | — |
| `configure_payment_reconciliation_http_cron()` | `20260818075102:1` | Y | public, extensions, vault, cron, pg_temp | REVOKE PUBLIC/anon/auth/**service_role** | — |
| `prevent_payment_order_snapshot_update()`, `prevent_payment_provider_identifier_replacement()` (trigger) | `20260818060118:229,269` | N | public, pg_temp | 명시 없음 | — |

### 2.3 환불

| 함수 | 최종 정의 | SD | EXEC | 잠금 순서 |
|---|---|---|---|---|
| `get_point_charge_refund_eligibility(uuid,uuid)` | `20260818062122:455` | Y | service_role | 읽기만 |
| `request_point_charge_refund(uuid,uuid,text)` | `20260818062122:555-634` | Y | service_role | **credit_sources(id,user) FOR UPDATE(`:573-576`) → payment_orders FOR UPDATE(`:583-586`)** → refund_requests INSERT → source status=`pending_refund`. **profile 잠금 없음** |
| `claim_point_charge_refund(uuid,uuid,text)` | `20260818073025:1-104` | Y | service_role (`:436-447`) | refund_requests(`:18-20`) → credit_sources(`:39-41`) → payment_orders(`:44-46`) → ppt(`:61-64`) |
| `finalize_point_charge_refund(uuid,text,timestamptz,text)` | `20260818073025:106-268` | Y | service_role | **refund_requests(`:125-127`) → credit_sources(`:148-150`) → payment_orders(`:153-155`) → ppt(`:179-182`) → profiles(`:199-202`)** → source refunded/0, profiles.credits, credit_transactions |
| `fail_point_charge_refund(uuid,text,text,bool)` | `20260818062122:859-885` | Y | service_role | refund_requests UPDATE(행 잠금) |
| `reject_point_charge_refund(uuid,uuid,text)` | `20260818062122:887-921` | Y | service_role | refund_requests FOR UPDATE(`:901-903`) → credit_sources UPDATE(`:909`) |
| `quarantine_external_provider_cancellation(uuid,text,timestamptz,text)` | `20260818073025:270-434` | Y | service_role | **payment_orders(`:289-291`) → credit_sources(payment_order_id)(`:309-311`) → profiles(`:317-320`) → refund_requests(`:323-328`)** |
| `get_toss_refund_eligibility`, `request_toss_refund`, `claim_toss_refund`, `finalize_toss_refund`, `fail_toss_refund`, `reject_toss_refund` | `20260805120000:56-513` | Y | **service_role에 grant된 상태로 남음**(`:516-540`) | finalize: refund_requests → credit_sources → payment_orders → profiles(`:340-385`). **코드 호출 없음**(grep `_toss_refund` in src: 0건) |
| `set_market_refund_requests_updated_at()` (trigger) | `20260602020000:104-113` | N | 명시 없음 | — |

### 2.4 market

| 함수 | 최종 정의 | SD | search_path | EXEC |
|---|---|---|---|---|
| `get_market_home_popular_items(text,timestamptz,int)` | `20260728010000:9-68` | Y | `''` | service_role only (`:65-68`) |
| `set_market_items_updated_at`, `set_market_item_files_updated_at`, `set_market_purchases_updated_at` | `20260317113000:137-165` | N | 미설정 | 명시 없음 |
| `set_market_subproduct_updated_at` | `20260528013000:3-12` (최초 `20260528010000:345`) | N | public | 명시 없음 |
| `set_market_menu_entries_updated_at`, `set_market_menu_groups_updated_at`, `set_market_item_reviews_updated_at`, `set_market_review_tags_updated_at`, `set_market_category_{groups,items}_updated_at` | `20260317050500:29`, `20260730010000:68`, `20260807090000:27`, `20260901090000:55`, `20260902045933:31,42` | N | category 2종만 public, pg_temp | 명시 없음 |

**market 구매/환불/다운로드 DB 함수는 없다.** 로컬 migration에 `purchase_market_*`, `approve_market_refund` 류 정의가 없고 코드도 호출하지 않는다. 운영 존재 여부는 미확인이다.

---

## 3. writer·lock 순서표

범례: **P**=profiles 행, **S**=credit_sources, **O**=payment_orders, **R**=refund_requests, **T**=payment_provider_transactions, **C**=checkout_attempts. "원자"=단일 DB 함수 트랜잭션, "다단계"=PostgREST/RPC를 여러 번 호출하고 요청 사이에 잠금이 없음.

### 3.1 DB 함수 writer (잔액·원장·결제)

| 경로 | 순서 | profile-first? | 원자성 |
|---|---|---|---|
| `consume_credits` | P → S(정렬) | **예** | 원자 |
| `refund_credits` | P → S(JSON 순서) | 예(단 S 비정렬) | 원자 |
| `finalize_toss_payment` | O → P → (S insert) | 아니오(O 선행) | 원자 |
| `finalize_kakaopay_payment` | O → T → P | 아니오 | 원자 |
| `request_point_charge_refund` | S → O | **P 없음**(S status 변경) | 원자 |
| `claim_point_charge_refund` | R → S → O → T | P 없음 | 원자 |
| `finalize_point_charge_refund` | R → S → O → T → **P** | **역순** | 원자 |
| `quarantine_external_provider_cancellation` | O → S → **P** → R | **역순** | 원자 |
| `reject_point_charge_refund` | R → S | P 없음 | 원자 |
| `finalize_toss_refund`(미사용, grant 유지) | R → S → O → **P** | 역순 | 원자 |
| `claim_kakaopay_callback` | **T → O** | — | 원자. 다른 KakaoPay 함수(O → T)와 역순 |

교착 판단(추론):

- (a) `consume_credits`(P 보유 → S 대기) ↔ `quarantine`(S 보유 → P 대기): 외부 취소 대상 S가 `active`면 consume이 S를 잠금 대상에 포함하므로 **순환이 가능하다.**
- (b) `consume_credits` ↔ `finalize_point_charge_refund`: finalize 대상 S는 request 단계에서 이미 `pending_refund`로 커밋되어 있다. consume의 `status='active'` 필터(`20260805110000:115,137`)가 S를 제외하므로 이 쌍의 순환은 드물다.
- (c) `refund_credits`는 JSON에 든 S를 status와 무관하게 잠근다(`:263-268`). 따라서 같은 S가 포함되면 (a)(b) 모두와 순환할 수 있다.
- (d) `claim_kakaopay_callback`(T→O) ↔ `record_kakaopay_approval`/`finalize_kakaopay_payment`/`mark_payment_reconciliation_terminal`(O→T): 같은 주문에 callback과 reconciliation이 겹치면 순환이 가능하다.

### 3.2 애플리케이션 writer (src/lib, src/app/api)

| 경로(진입점) | DB 호출 순서(파일:라인) | 잠금 | 원자성·보상 | 멱등 |
|---|---|---|---|---|
| **V2 단건 구매** `POST /api/market/items/[itemId]/purchase`(body에 purchaseType) → `handleMarketV2Purchase`(`route.ts:186-243`) → `createMarketV2PurchaseWithCompensation`(`src/lib/market-purchase.ts:232-377`) | idempotency 조회(`:248-263`) → 상품/타깃/entitlement 조회 → pair(차액) 계산(`:296-313`) → `consume_credits` RPC(`:315-321`, 경유 `credits.ts:192`) → order insert(`market-items-server.ts:1935`) → line insert(`:1954`) → entitlement insert(`:1969`) | consume RPC 안에서만 P→S. **그 밖에서는 잠금 없음** | 다단계. 실패 시 ent/line/order 순차 delete(`market-items-server.ts:1984-1989`, **delete 오류 미검사**) + `refund_credits`(`market-purchase.ts:355-366`). refund가 throw하면 주문 행은 지워지고 크레딧은 차감된 채 남는다(추론). 차감 RPC 뒤 profile cache를 별도 UPDATE한다(`credits.ts:79-95` → `credit-balance.ts:175-186`) | check-then-act. DB partial UNIQUE가 최후 방어선. **UI 키에 `Date.now()` 포함**(`market-item-actions.tsx:462,467`) |
| **legacy 단건 구매** (body에 purchaseType 없음, `route.ts:60-64`) → `handleLegacyMarketPurchase`(`route.ts:67-184`) | 구매가능·기보유 조회(`:108-127`) → `consume_credits`(`:135`) → `market_purchases` insert(admin, `:154` → `market-items-server.ts:2469-2490`) | 동일 | 다단계. 실패 시 `refund_credits`(`route.ts:77-100,169-172`). **refund 실패는 삼켜진다**(`:82-95`) | **키 없음**. status 무관 UNIQUE(user,item,asset_kind)가 최후 방어선이라 환불된 legacy 자산은 재구매할 수 없다(추론) |
| `/api/market/purchases/batch` | 없음 | — | 410 고정(`src/app/api/market/purchases/batch/route.ts:5-12`) | — |
| **market 환불 요청** `POST /api/market/refunds`(`route.ts:35`) → `requestMarketRefund`(`market-refunds.ts:414-446`) | 적격성 조회(다운로드 수·요청 상태) → `market_refund_requests` insert(admin) | 없음 | 단일 insert. partial UNIQUE(pending/approved)가 중복 방어 | — |
| **market 환불 승인** `PATCH /api/admin/market/refunds/[id]`(`route.ts:56`) → `approveMarketRefund`(`market-refunds.ts:493-563`) | 요청 read(잠금 없음, `:495`) → 적격성 재계산 → `refund_credits`(P→S)(`:516-523`) → order/line/entitlement `Promise.all` UPDATE(`:526-533`) 또는 legacy UPDATE(`:535-543`) → request `approved` UPDATE(`:546-557`, **status 조건 없음**) | refund RPC 안에서만 | 다단계, 보상 없음. 중간 실패 시 크레딧만 복구되고 주문은 completed로 남는 상태가 가능 | 없음. 동시 승인 두 건이 모두 통과할 수 있음(추론) |
| market 환불 거절 `rejectMarketRefund`(`market-refunds.ts:566-`) | request UPDATE | 없음 | 단일 | — |
| **유료 다운로드 V2** `GET /api/market/items/[itemId]/download`(`route.ts:53-121`) | 파일·entitlement 조회(`:60-78`) → pending refund 조회(`:80-90`) → signed URL 5분(`:93-98`) → `recordMarketV2DownloadEvent` insert(`:107-119`) → redirect | 없음 | 다단계. 환불 요청 생성과 다운로드 기록 사이에 잠금이 없어 교차 통과 가능(추론) | — |
| 유료 다운로드 legacy (`route.ts:140-200`) | 상품은 `deleted_at`만 검사하고 published/is_active는 검사하지 않음(`:140-148`) → `market_item_files` 조회 → `market_purchases` exact-kind 조회(`:155-166`) → pending refund(`:168`) → signed URL(`:181`) → event insert(`:195`) | 없음 | 다단계 | — |
| **관리자 크레딧 지급** `POST /api/admin/users/credits`(`route.ts:50`) → `CreditService.grantCreditsAsAdmin`(`credits.ts:396-460`) | `credit_sources` insert(`:404-415`) → `get_credit_balance_snapshot` → `profiles.update(credits)`(`credit-balance.ts:175-186`) → payment_history insert(`:424-433`) → credit_transactions insert(`:439-449`). **뒤 두 단계 오류는 로그만 남김** | **P 잠금 없음** | 다단계, 보상 없음. consume과 겹치면 cache를 stale 값으로 덮어쓸 수 있음(추론) | 없음 |
| `CreditService.purchaseCredits`(`credits.ts:317-386`) | 위와 동일 패턴 | — | — | **호출처 없음**(grep 결과 정의만) |
| AI 생성·listboard·community 저장 | `deductCredits` → 작업 → 실패 시 `refundCredits`: `api/questions/generate/route.ts:111,330`, `api/generate/listboard-jobs/[jobId]/run/route.ts:150,388`, `…/retry/route.ts:229,453`, `api/questions/save-from-community/route.ts:119-450` | RPC 내부만 | 다단계+보상 | 미확인 |
| **Toss 충전** `api/payments/orders/route.ts:125`(`prepare_payment_order`) → `api/payments/confirm/route.ts:267`(`finalize_toss_payment`) | 주문 준비 → provider HTTP 승인 → fulfill RPC | 함수 내부(O→P) | fulfill 자체는 원자, 전체는 provider HTTP 다단계 | payment_orders 키·state machine |
| **KakaoPay 충전** `api/payments/kakaopay/orders/route.ts:192,261,304,340` → `src/lib/kakaopay-callback-server.ts:147,193,212` | prepare → begin_ready → store_ready → claim_callback(T→O) → record_approval → finalize_kakaopay(O→T→P) | 함수별 | 함수별 원자 | callback state/result token hash |
| **결제 대사** `src/lib/payment-reconciliation-server.ts:89,162,215,373,385,571-653` | claim_batch(SKIP LOCKED) → provider 조회 → finalize_* / record / quarantine(O→S→P→R) / terminal | 함수별 | 함수별 원자 | run/claim |
| **포인트 환불** 사용자 `api/refunds/request/route.ts:32` → `request_point_charge_refund`(S→O). 관리자 `api/admin/refunds/route.ts:138,161` → `processPointChargeRefund`(`src/lib/point-charge-refund-processor.ts:186-230`): claim(R→S→O→T) → provider 취소 HTTP → finalize(R→S→O→T→P) 또는 fail | 함수별 | claim/finalize 사이에 provider HTTP가 있음(DB 잠금 밖) | cancel_idempotency_key |
| **카탈로그 쓰기** (admin, service-role 개별 요청) | `market-items-server.ts`: subproduct CRUD `:822,875`, 삭제 시 files→subproduct 2단계 `:903,916`, files `:985,1019,1062`, bundle upsert `:1097-1165`, items `:2189,2270,2293`, legacy files `:2326,2357`. `market-sample-pages-server.ts:342-802`, `market-menu-server.ts:303-451`, `market-menu-groups-server.ts:244-408`, `market-categories-server.ts:396-548`. hard delete `market-item-cleanup.ts:145-180` | **부모 잠금·revision 없음** | 다단계. **관리자 `DELETE /api/admin/market/items/[id]`(`route.ts:203-206`)는 `requireNoHistory` 없이 hard delete를 호출한다.** FK CASCADE로 판매된 상품의 `market_purchases`, `market_download_events`, `market_purchase_orders/lines/entitlements`, `market_refund_requests`가 함께 삭제된다(추론, FK 정의 기준). 이력 검사는 cron 정리 경로(`requireNoHistory`)에만 있고, 그마저 검사→삭제 TOCTOU(`:162-166` → `:172`) | — |

### 3.3 계획 7.2절 역순 잠금의 실제 위치 (근거)

- point-charge refund finalizer: `supabase/migrations/20260818073025_add_provider_refund_processing.sql:125-127`(R) → `:148-150`(S) → `:153-155`(O) → `:179-182`(T) → `:199-202`(P). 이것이 최신 정의이고, 이전 정의 `20260818062122:752-791`도 같은 순서다.
- 계획이 명시하지 않은 추가 역순: `quarantine_external_provider_cancellation` `20260818073025:289-320`(O→S→P), 미사용 `finalize_toss_refund` `20260805120000:340-385`, KakaoPay `claim_kakaopay_callback` `20260818071513:335-352`(T→O).
- 충전 fulfill은 O→P로 profile-first가 아니다(`20260818062122:26-83`, `:230-313`). S를 먼저 잠그지 않으므로 consume과 직접 순환하지는 않는다(추론).

---

## 4. 탈퇴 경로 현황 (`src/app/api/auth/withdraw/route.ts`)

| 단계 | 내용 | 라인 |
|---|---|---|
| 인증 | 사용자 세션 `getUser()`. 없으면 401 | `:8-16` |
| 확인 | body `confirmEmail === user.email`. 아니면 400 | `:18-27` |
| 금융 이력 검사 | admin client로 `payment_orders`, `checkout_attempts`의 user_id count(head). 1건이라도 있으면 409. **count 조회 error는 검사하지 않아 null→0으로 통과한다**(fail-open) | `:31-44` |
| 순차 삭제 | `exam_papers` → `questions` → `support_tickets` → `credit_transactions` 각각 delete. 오류 시 throw | `:46-58` |
| profile 삭제 | `profiles` delete | `:60-66` |
| Auth 삭제 | `admin.auth.admin.deleteUser` | `:69-72` |
| 오류 | 모든 예외는 500으로 응답. 이미 삭제된 단계는 되돌리지 않음 | `:79-85` |

- **막는 것**: `payment_orders`, `checkout_attempts`가 있는 사용자. 두 테이블의 FK도 profiles RESTRICT다.
- **막지 않는 것**: `market_purchase_orders/lines/entitlements`, legacy `market_purchases`, `market_refund_requests`, `market_download_events`, admin 지급 `credit_sources`, `credit_consumption`, `payment_history`(payment_order 없는 과거 test/admin 행), `refund_requests`(payment_order_id NULL인 과거 행). profile 삭제 시 1.1절 표의 CASCADE로 **모두 함께 삭제된다**(FK 정의 기준 추론).
- `credit_transactions`는 CASCADE 전에 명시적으로 먼저 삭제한다.
- **원자성**: 검사와 삭제 사이에 잠금이 없다(TOCTOU). 검사 이후 결제 주문이 생기거나 count 오류로 검사를 통과하면, 앞의 데이터·`credit_transactions`를 지운 **뒤에야** profile 삭제가 RESTRICT로 실패한다(추론). 삭제는 6번의 별도 요청이다. 중간 실패 시 일부만 삭제된 상태로 500을 응답한다. Auth 삭제가 실패하면 profile은 이미 없는데 Auth 계정은 남는다.
- **tombstone/재생성**: `account_state`, `account_deletion_jobs`는 없다. `handle_new_user()`(최신 `20260222_require_kakao_signup_completion.sql:5-87`, SECURITY DEFINER, search_path 미설정)는 auth.users INSERT 때 profiles를 무조건 insert하며 tombstone 검사가 없다.

---

## 5. legacy 현황

**코드 경로 — 사실, 모두 활성**

- 구매: `purchase/route.ts:60-64` 분기 → `handleLegacyMarketPurchase`. UI `market-item-actions.tsx:469`가 `{assetKind}`를 전송한다.
- 권한 판정: exact-kind(`src/lib/market-purchase.ts:46-56`). 라벨은 `'HWP & PDF'`(`market-purchase.ts:42`, `market-item-actions.tsx:81`)이고, 테이블 COMMENT는 "hwp 구매는 pdf 다운로드를 포함"(`20260525054805:56`)이라고 적혀 있다. **라벨·주석과 실제 판정이 불일치**한다.
- 다운로드: `download/route.ts:140-200`(`market_item_files` + `market_purchases`).
- 환불: `market-refunds.ts:134-160`(`market_purchases` 대상), 승인 `:535-543`.
- 목록 enrichment: `src/lib/market-item-list-enrichment.ts:73,117`(`market_item_files`).
- 보관함: `library-view.tsx:524,583`(legacyDownloads).
- 샘플: `market-sample-pages-server.ts`가 `market_item_files`를 참조한다.
- 미사용 legacy helper(보고만 함): `createMarketPurchases`, `rollbackMarketPurchases`(`market-items-server.ts:2498-2575`)는 외부 호출처가 없다.

**영어 공개 상품의 증거** (`docs/cart-live-db-evidence.json`, 2026-09-28T08:21:27Z)

- `summaries.publishedItemsBySubject`: korean 144, english 1.
- `activeSubproductsBySubject`와 `activeBundlesBySubject`에는 korean만 있다(352, 64). 즉 영어 공개 상품 1개에는 **활성 V2 서브상품·번들이 0개**다(사실).
- `market_purchases` 행 0건. V2 주문 8건은 모두 subproduct/bundle 유형이다.
- **"영어 상품이 legacy 파일만 가진다"는 부분은 증거 JSON으로 확인되지 않는다.** `market_item_files`는 조사 테이블 목록에 없다(`tables` 키에 없음). 활성 legacy PDF/HWP/ZIP 파일과 가격(`pdf_price/hwp_price/zip_price>0`)의 존재 여부는 **미확인**이다. 계획 2.1절의 판단은 V2 판매 단위가 없다는 사실에 근거한 추론이다.

---

## 6. 운영 대조 체크리스트

운영 preflight(`docs/cart-db-preflight.sql`) 결과를 받으면 아래 순서로 대조한다. "불일치"는 원인(수동 DDL, 미기록 migration 등)을 확인해 설명한 뒤에만 Phase 0 PASS로 판정한다.

### 6.1 migration 이력

- [ ] `supabase_migrations.schema_migrations` version 목록 = 로컬 92개 파일명 접두 버전. 운영에만 있는 버전을 식별한다(특히 `_once`, `operation_key`, `market_items.subject_code`, credit_transactions 재정의 관련).
- [ ] `credit_transactions`의 실제 컬럼과 `credit_transactions_type_check` 정의. 로컬 replay 기대값(1.4절)과 다르면 운영 정의를 새 기준 migration으로 회수해야 한다.
- [ ] fresh DB에서 로컬 migration 전체를 replay할 수 있는지 격리 환경에서 확인한다. 1.4절의 정책 이름 충돌과 컬럼 부재 때문에 실패할 것으로 추론한다.

### 6.2 제약·인덱스 (preflight 쿼리 2·3)

- [ ] 1절 표의 명시 이름 제약이 모두 존재하고 정의가 같은지 확인한다. 자동 이름은 이름이 달라도 정의가 같으면 OK로 기록한다.
- [ ] `convalidated`: 기대 **false**는 `pricing_plans_price_charge_limit`, `payment_history_amount_charge_limit`. 기대 **true**는 payment_orders 5개와 `refund_requests_provider_check`(`20260818062254`).
- [ ] 부재 확인(계획 보강 대상): `credit_sources` 음수/상한 CHECK, `credit_consumption.amount>0`, `(id,item_id,workspace_subject)` 후보키, line/entitlement의 item·user 복합 FK, `upgrade_base_order_id`, `catalog_revision`, `profiles.account_state`. **운영에 이미 있으면 중복 생성 금지**(계획 5.6).
- [ ] `market_purchases_user_id_item_id_asset_kind_key`가 전체 UNIQUE인지 확인한다(기대: 전체).
- [ ] partial UNIQUE predicate 문자열: `uq_market_purchase_orders_user_idempotency`, `uq_market_entitlements_active_*`, `uq_market_refund_requests_pending_*`, `refund_requests_one_open_source`, `credit_sources_payment_order_id_key`. 모든 인덱스가 `indisvalid=true, indisready=true`인지 확인한다.
- [ ] `credit_consumption.transaction_id`의 FK·UNIQUE와 `operation_key` UNIQUE 범위(drift 정의 회수).

### 6.3 RLS·정책 (쿼리 1·4)

- [ ] 1절 대상 테이블 모두 `relrowsecurity=true`. `relforcerowsecurity`는 기대 false이며 이를 설정한 migration은 없다.
- [ ] 정책 이름·cmd·roles가 1절과 일치하는지 확인한다. 특히 **`market_purchases`의 사용자 INSERT/UPDATE 정책 존재 여부**(기대: 존재 = 위험), `market_download_events`·`market_refund_requests` 사용자 INSERT 정책 부재, payment_orders/payment_history/refund_requests 사용자 SELECT 정책 부재.
- [ ] `storage.objects`/`storage.buckets` 정책. 로컬 기대값이 없으므로 운영 결과 전체를 새 기준으로 기록한다.

### 6.4 GRANT (쿼리 5, 기본 ACL)

- [ ] credit 3종: anon/authenticated의 INSERT/UPDATE/DELETE=false. SELECT는 true일 수 있다(revoke 대상 아님). TRUNCATE·REFERENCES·TRIGGER 권한도 `relacl`로 확인한다. `has_table_privilege` 쿼리는 I/U/D만 보므로 relacl 원문을 확인한다(추론).
- [ ] payment_orders/payment_history/refund_requests/checkout_attempts: anon·authenticated 전부 false, service_role 전부 true.
- [ ] payment_provider_transactions: service_role은 SELECT만 true.
- [ ] **market_* 전 테이블의 authenticated INSERT/UPDATE/DELETE 실제 값.** migration에 REVOKE가 없으므로 기본 ACL에 따른다. true이면 RLS만이 방어선이다. `market_purchases`는 정책까지 열려 있다.
- [ ] `profiles`: authenticated UPDATE=false, INSERT/DELETE 값 기록.
- [ ] `pg_default_acl`(쿼리 8): 신규 테이블·함수의 자동 grant 여부.

### 6.5 함수 (쿼리 6)

- [ ] 2절 표의 각 함수: `prosecdef`, `proconfig`(search_path), `proacl`, anon/authenticated/service_execute가 표와 일치하는지 확인한다. 특히 `consume_credits`/`refund_credits`의 **authenticated_execute=false**(20260306 grant 회수 여부).
- [ ] `pg_get_functiondef`로 `consume_credits`/`refund_credits` 본문이 `20260805110000`과 동일한지 확인한다. 다르면 drift로 기록한다.
- [ ] `consume_credits_once`/`refund_credits_once`: 존재, 인자(타입과 일치 여부), SD, search_path, EXECUTE, 잠금 순서, operation_key 중복 처리, 원 consume 연결 검증 여부. 본문 전문을 보관한다.
- [ ] 로컬에 없는 함수(`purchase_market_*`, `approve_market_refund` 등) 존재 여부. 있으면 로컬 누락으로 기록한다.
- [ ] 역순 잠금 함수 4종(3.3절)의 운영 본문이 로컬과 같은지 확인한다.
- [ ] `*_toss_refund` 6종이 운영에서도 service_role EXECUTE 상태인지 확인한다(미사용 표면).
- [ ] preflight 쿼리 6의 이름 정규식은 `begin/store_kakaopay_ready`, `claim_kakaopay_callback`, `record_kakaopay_approval`, `mark_kakaopay_callback_failure`, `quarantine_external_provider_cancellation`, `handle_new_user`, `is_admin`, `update_updated_at_column`을 **놓친다.** 이 함수들은 별도 `proname IN (...)` 조회로 보완한다. 쿼리 1·3·4·5·7의 테이블 정규식도 `checkout_attempts`, `pricing_plans`, `notifications`를 놓치고, 3·5·7은 `profiles`도 놓친다(profile trigger `on_profile_created_init_credits` 포함).

### 6.6 트리거 (쿼리 7)

- [ ] 기대 목록: `trg_market_{items,item_files,purchases,subproduct_categories,file_types,item_subproducts,subproduct_files,item_bundle_options,purchase_orders,purchase_lines,entitlements,refund_requests,menu_entries}_updated_at`, `update_{credit_sources,payment_history,refund_requests,payment_orders}_updated_at`, `prevent_payment_order_snapshot_update`, `prevent_payment_provider_identifier_replacement`. 부모 잠금·revision 무결성 trigger는 **없어야 정상**(아직 미구현). 운영에 추가 trigger가 있으면 drift다.

### 6.7 Storage (쿼리 9~12)

- [ ] `market-files`: `public=false`(2026-09-29 증거와 일치해야 함), `file_size_limit`, `allowed_mime_types`와 `market_file_types.mime_allowlist`(`20260528010000:266-279`) 대조.
- [ ] 활성 참조 legacy/subproduct/sample의 `missing_objects=0`, 중복 참조 수, 비참조 object 수(분류만, 삭제 금지).

### 6.8 데이터 무결성 (추가 SELECT, 집계만)

- [ ] `market_item_files`의 영어 공개 상품 활성 PDF/HWP/ZIP 수와 가격>0 여부(5절 미확인 해소).
- [ ] 계획 5.6 제약 추가 전 위반 0건: `remaining_credits<0 OR >initial_credits`, `credit_consumption.amount<=0`, file.item≠subproduct.item, line.item≠order.item, entitlement.user≠order.user, `market_purchases` completed 중복.
- [ ] 탈퇴 설계 입력: V2 주문·legacy 구매·market 환불만 있고 payment_orders가 없는 사용자 수(현재 탈퇴 API가 이력을 CASCADE 삭제할 수 있는 대상 규모).
