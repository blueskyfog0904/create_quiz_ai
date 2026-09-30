# 장바구니 Phase 0 — 개발 DB 기준선 (실측)

> 대상 Supabase 프로젝트 `kzcweelnzhcmiuvjgeyi`는 **운영 전 개발 DB**다(사용자 결정 2026-09-30). 이 문서의 '개발 DB'·'원격'은 이 DB를 뜻한다. 원시 결과 JSON(`docs/cart-phase0-db-results/`)은 수집 당시 그대로 두고 수정하지 않았다.

- 수집 시각(UTC): 2026-09-30 00:39:29 ~ 00:54:41
- 접속: Supabase MCP `execute_sql` / `list_migrations`. DB `postgres`, PostgreSQL 17.6.
- 접속 역할: `supabase_read_only_user`. `transaction_read_only=on`, `rolsuper=false`, **`rolbypassrls=true`**, `pg_read_all_data`와 `pg_monitor`의 멤버. BYPASSRLS이므로 아래 집계는 RLS와 무관한 전체 행 기준이다.
- 실행한 것: SELECT와 catalog 조회만. 코드, migration, DB 데이터는 바꾸지 않았다.
- 원본 결과: `docs/cart-phase0-db-results/` 안의 JSON 23개(00~22). 사용자 식별자, 이메일, Storage 경로, 키는 저장하지 않았고 집계값만 남겼다. 저장 후 UUID·이메일·경로 패턴을 grep해 0건임을 확인했다.
- 함수 본문 전사는 DB의 `md5(pg_get_functiondef)`와 바이트 단위로 같음을 확인했다(`07_function_bodies_core.json`의 `md5_match=true`, 11개).
- 표기: **사실** = 이번 조회 결과. **추론** = 조회 결과에서 도출했으나 실행으로 검증하지 않음. **미확인** = 이번 세션에서 확인하지 못함.

---

## 0. 주목할 발견 (위험·drift)

1. **[위험, 사실+추론] legacy 구매를 위조할 수 있다.** `market_purchases`는 anon과 authenticated 모두 SIUD 권한을 가진다(`05`). authenticated용 정책 `Users can insert own market purchases`(WITH CHECK `auth.uid()=user_id`)와 `Users can update own pending market purchases`(USING/CHECK `auth.uid()=user_id`, **status 조건 없음**)가 존재한다(`04`). `status`의 기본값은 `'completed'`다(`14`). 상태·가격을 막는 trigger는 없다(`08`). 이 조건과 로컬 기준선이 확인한 legacy 다운로드 경로(`market_purchases` exact-kind 조회)가 맞물린다. 따라서 로그인 사용자가 PostgREST로 자기 `market_purchases` 행을 넣으면 영어 공개 상품(활성 legacy pdf/hwp, 가격 > 0)을 무료로 내려받을 수 있다고 **추론**한다. 실제 공격 재현은 하지 않았다(**미확인**). 현재 `market_purchases`는 0행이다.
2. **[위험, 사실] public 스키마의 기본 ACL이 anon과 authenticated에 전부 부여한다.** 테이블은 `arwdDxtm`, 함수는 `X`, 시퀀스는 `rwU`를 받는다(`09`). 신규 cart 테이블과 RPC는 명시적으로 REVOKE하지 않으면 anon과 authenticated에 DML/EXECUTE가 열린다. market 테이블 대부분이 이미 이 상태이고 RLS만이 방어선이다.
3. **[drift, 사실] `consume_credits_once`/`refund_credits_once`의 출처가 확인됐다.** 로컬에는 없고 개발 DB에만 있는 migration `20260605023722 harden_listboard_generation_jobs`, `…033647`, `…034001`에서 왔다. 같은 migration이 `credit_transactions.operation_key/original_operation_key`, `credit_consumption.transaction_id/operation_key`, `uq_credit_transactions_user_operation_key`, `uq_credit_transactions_refund_original_operation_key`도 만들었다(`21`). 두 함수는 모두 **SECURITY INVOKER**다.
   - `consume_credits_once`: EXECUTE가 PUBLIC, anon, authenticated, service_role에 열려 있다.
   - `refund_credits_once`: anon과 service_role만 EXECUTE할 수 있다. anon만 revoke에서 빠졌다.
   - `consume_credits_once` 본문의 결함: 만료 필터가 없다. 잔액을 `profiles.credits - amount`로 계산하고 원장 합으로 계산하지 않는다. source를 `purchased_at`만으로 정렬하고, service_role 예외도 없다.
   - 사용 이력: listboard에서 2026-06-05~06-07에만 쓰였다(consume 56건, refund 24건). 이후 호출이 없다.
   - 결론: **재사용 금지** 근거가 확정됐다.
4. **[중대 발견, drift, 사실] `grant_credits`/`deduct_credits`가 개발 DB에 존재하고 anon과 authenticated가 실행할 수 있다.**
   - 속성: 두 함수 모두 SECURITY DEFINER이고 search_path가 설정되지 않았다. EXECUTE는 PUBLIC, anon, authenticated, service_role에 있다(`06`).
   - 시그니처: `grant_credits(p_user_id uuid, p_amount int, p_description text, p_type text DEFAULT 'admin_grant', p_resource_type text, p_resource_id uuid)`, `deduct_credits(p_user_id uuid, p_amount int, p_description text, p_resource_type text, p_resource_id uuid)`.
   - 본문 요약(`07`): `grant_credits`는 `public.user_credits`에 upsert하고 잠근 뒤 잔액을 더한다. 이어서 `credit_transactions`에 INSERT하는데, `p_type`은 호출자가 지정하고 권한 검사는 없다. `deduct_credits`도 `public.user_credits`를 잠그고 잔액을 뺀 뒤 `credit_transactions`에 `type='use'`로 INSERT한다. `'use'`는 CHECK 위반이다.
   - 참조 대상: 두 함수는 스키마를 명시해 `public.user_credits`를 참조하지만, 이 relation은 어떤 스키마에도 없다. 따라서 지금은 첫 문장에서 42P01 오류로 실패하고 부작용은 없을 것으로 **추론**한다. 실제 호출은 하지 않았다(**미확인**).
   - 위험: 누군가 `user_credits`를 다시 만들면 anon이 임의 사용자에게 크레딧 원장 행을 쓸 수 있는 SECURITY DEFINER 경로가 즉시 열린다. 즉시 DROP(또는 최소 REVOKE)해야 한다.
   - 출처: **미확인**이다. `supabase/migrations/` 전체에 두 함수의 정의가 없다. 로컬 `20251209000000_add_role_sessions_credits.sql`은 `user_credits` 테이블과 `initialize_user_credits`만 정의한다. *(2026-09-30 정정: 이전 판은 이 파일이 두 함수를 정의한다고 잘못 적었다.)* 확인된 사실은 하나다. 개발 DB에만 있는 migration `reset_credits_feature`가 `DROP FUNCTION IF EXISTS public.grant_credits();`처럼 인자 없는 시그니처로 DROP해서 실제 함수를 지우지 못했고, `user_credits` 테이블만 삭제됐다(`21`, 추론).
   - 결론은 그대로다. **즉시 DROP해야 한다.**
5. **[결손, 사실] 원장에 음수·상한 CHECK가 없다.** `credit_sources`에는 status와 source_category CHECK만 있다. `credit_consumption`에는 CHECK가 없다. `credit_transactions`에는 type CHECK만 있고, `profiles.credits` CHECK도 없다. 다만 현재 위반 데이터는 0건이다(remaining < 0, remaining > initial, initial <= 0, amount <= 0, profiles.credits < 0 모두 0). `credit_consumption`에는 UNIQUE가 없다(`16`).
6. **[drift, 사실] 로컬 migration과 원격 migration history가 크게 다르다.** 원격 93개, 로컬 92개다. version과 이름이 모두 같은 것은 16개뿐이고, 이름만 같고 version이 다른 것이 52개다. **원격에만 25개, 로컬에만 24개**가 있다(`13`).
   - 로컬에만 있는 `20260730010000_create_market_menu_groups.sql`은 개발 DB에 적용되지 않았다. `market_menu_groups` 테이블이 없다.
   - 로컬이 기대하는 `initialize_user_credits`와 `on_profile_created_init_credits`는 개발 DB에 없다.
7. **[일치, 사실] 핵심 결제·크레딧 함수 본문은 로컬과 바이트 단위로 같다.** 로컬 최종 정의와 `prosrc` md5를 비교한 20개 중 **19개가 일치**했다. `consume_credits`, `refund_credits`, 포인트 환불 계열, Toss/KakaoPay fulfill, `quarantine_*`, `claim_kakaopay_callback`, `handle_new_user`, `is_admin` 등이 포함된다. 따라서 로컬 기준선의 잠금 순서표(역순 잠금 포함)는 개발 DB에도 그대로 적용된다. 불일치는 `get_market_home_popular_items` 1개다. 개발 DB판은 sql 함수이고 search_path가 `public, pg_temp`이며 service_role 검사가 없다. EXECUTE는 service_role에만 있다(`20`).
8. **[데이터, 사실] P4에 해당하는 상품은 영어 1개다.** 이 상품은 활성 legacy pdf/hwp 파일이 있고 가격 > 0이며 V2 판매 단위가 없다. 국어 144개는 모두 V2만 있다. V2와 legacy를 함께 가진 상품은 0개다(`15`). 추가로 **국어 게시 상품 144개 전부가 `subject_code='english'`**다. `workspace_subject='korean'`과 맞지 않는다. 출처는 원격에만 있는 migration `add_subject_code_to_core_content_tables_v2`로 보인다.
9. **[Storage, 사실] `market-files` 상태.**
   - 설정: `public=false`, `file_size_limit=52428800`(50MiB), `allowed_mime_types=null`이다. 버킷 수준에는 MIME 제한이 없다.
   - 정책: `storage` 스키마의 정책 수는 **0**이다. objects/buckets에 RLS는 켜져 있다.
   - 참조 정합성: 활성 참조 1,125건(legacy 2, subproduct 496, sample 627) 중 missing object는 0건이다. 한 path를 여러 행이 참조하는 경우도 0건이다.
   - 참조되지 않는 object는 7개다. 이미지 6개는 2026-05-22, pdf 1개는 2026-05-28에 생성됐다. 별도로 비활성 subproduct 행만 참조하는 object가 4개 있다. 합계 1125 + 4 + 7 = 1136이다(`11`).
   - 사용자 세션으로 Storage API에 직접 접근했을 때 차단되는지는 **미확인**이다. 정책이 0개이므로 차단될 것으로 추론한다.
10. **[탈퇴 입력, 사실] 삭제 시 RESTRICT가 걸리는 곳은 두 테이블뿐이다.** profiles 삭제는 `payment_orders`와 `checkout_attempts`에서만 막힌다. market 주문, 권한, 환불, credit 원장, `payment_history`는 CASCADE로 함께 지워진다(`17`). payment_orders와 checkout 이력 없이 market 이력만 가진 사용자가 **2명**, payment_orders 없이 credit_sources만 가진 사용자가 **4명**이다(`20`).

---

## 1. preflight SQL 항목별 결과 (`docs/cart-db-preflight.sql`, BEGIN/COMMIT 제외 개별 실행)

| # | 항목 | 결과 파일 | 결과 요약 | 실패 |
|---|---|---|---|---|
| 1 | 세션 정보 | `00_session.json` | postgres / supabase_read_only_user / 17.6 / read_only=on | 없음 |
| 2 | 테이블·RLS·owner | `01_tables_rls_owner.json` | 대상 35개 전부 `relrowsecurity=true`, `relforcerowsecurity=false`, owner=postgres. 이름에 cart가 들어간 테이블 0 | 없음 |
| 3 | 제약 | `02_constraints.json` | 218행(총 건수를 교차 확인함). `convalidated=false`는 `payment_history_amount_charge_limit` 하나. 보완 조회(`22`)에서 `pricing_plans_price_charge_limit`도 false | 없음 |
| 4 | 인덱스 | `03_indexes.json` | PK 제외 124개(PK 포함 158개). 전부 `indisvalid=true`, `indisready=true` | 없음 |
| 5 | 정책 | `04_policies.json` | 48개, 전부 PERMISSIVE. **storage.objects/buckets 정책 0** | 없음 |
| 6 | 테이블 GRANT | `05_table_grants.json` | 2절 참조 | 없음 |
| 7 | 함수 | `06_functions_list.json`(목록 47개, 본문 제외, md5/길이), `07_function_bodies_core.json`(본문 11개) | 3절 참조 | 없음 |
| 8 | 트리거 | `08_triggers.json` | 23개, 전부 updated_at 계열 또는 payment 스냅샷 보호용. 무결성·revision trigger 없음 | 없음 |
| 9 | 기본 ACL | `09_default_acl.json` | public/storage는 owner postgres와 supabase_admin 모두 anon과 authenticated에 테이블 `arwdDxtm`, 함수 `X`, 시퀀스 `rwU` 부여 | 없음 |
| 10 | market-files bucket | `10_bucket_market_files.json` | public=false, 50MiB, MIME 제한 없음 | 없음 |
| 11~13 | 파일 참조 정합성 | `11_storage_integrity.json` | missing 0, 중복 참조 0, 비참조 7 | 없음 |
| 14 | migration 테이블 위치 | `12_migration_history_tables.json` | `supabase_migrations.schema_migrations`, `seed_files` | 없음 |

**권한 때문에 실패한 조회는 없다.** 실패한 2건은 모두 내가 쓴 SQL의 오류였고 고쳐서 다시 실행했다.
- GROUP BY 해시 불가: `aclitem[]` 타입 때문이었다. 서브쿼리로 바꿔 재실행했다.
- 잘못된 placeholder 테이블명으로 인한 42P01: 작성 실수였다. 올바른 쿼리로 재실행했다.

---

## 2. GRANT·RLS 현황 (사실)

| 대상 | anon | authenticated | service_role | 비고 |
|---|---|---|---|---|
| credit_sources / credit_consumption / credit_transactions | S | S | SIUD | relacl `rDxtm`: **TRUNCATE(D), REFERENCES, TRIGGER, MAINTAIN은 anon/auth에 남아 있음** |
| market_items, market_item_files, market_item_subproducts, market_subproduct_files, market_item_bundle_options, market_item_sample_pages, market_menu_entries, market_file_types, market_subproduct_categories, market_purchase_orders, market_purchase_lines, market_entitlements, market_purchases, market_refund_requests, market_download_events, market_item_view_events | SIUD | SIUD | SIUD | 기본 ACL 그대로. RLS 정책만 방어선 |
| market_category_groups/items, market_item_reviews, market_review_tags | S | S | SIUD | |
| market_item_review_votes | - | S | SIUD | |
| payment_history, payment_orders, payment_webhook_events, refund_requests, checkout_attempts | - | - | SIUD | |
| payment_provider_transactions, payment_reconciliation_*, payment_runtime_config | - | - | S | 쓰기는 SECURITY DEFINER 함수로만 |
| profiles | SI-D | SI-D | SIUD | UPDATE는 회수됨. INSERT/DELETE 정책이 없어서 RLS가 차단함(추론) |
| pricing_plans, notifications | SIUD | SIUD | SIUD | |
| storage.objects / storage.buckets | SIUD | SIUD | SIUD | RLS on, **정책 0** |

사용자 쓰기 정책이 있는 market 테이블은 두 곳이다.
- `market_purchases`: INSERT와 UPDATE(0절 1번)
- `market_item_view_events`: INSERT(`auth.uid()=user_id OR user_id IS NULL`)

`market_download_events`와 `market_refund_requests`에는 사용자 INSERT 정책이 없다.

---

## 3. 함수 (사실)

| 함수 | SD | search_path | EXECUTE | 비고 |
|---|---|---|---|---|
| consume_credits | Y | public, pg_temp | service_role | 로컬 `20260805110000`과 본문 동일. 잠금 P→S(expires_at NULLS LAST, purchased_at, id). 멱등 키 없음 |
| refund_credits | Y | public, pg_temp | service_role | 본문 동일. 잠금 P→S(JSON 순서) |
| consume_credits_once | **N** | public | **PUBLIC, anon, authenticated, service_role** | 로컬 정의 없음. 만료 필터 없음. auth.uid()/is_admin 가드. 잔액 = profiles.credits - amount |
| refund_credits_once | **N** | public | **anon**, service_role | 로컬 정의 없음. 가드에 service_role 예외 있음. `p_target_balance`로 잔액을 덮어쓸 수 있음 |
| grant_credits / deduct_credits | Y | **미설정** | **PUBLIC, anon, authenticated, service_role** | 없는 `user_credits`를 참조함. deduct는 CHECK에 없는 type `'use'`를 씀 |
| finalize_point_charge_refund | Y | public, pg_temp | service_role | 본문 동일. 잠금 R→S→O→T→P(역순) |
| claim_point_charge_refund, get_point_charge_refund_eligibility, request/reject/fail_point_charge_refund, quarantine_external_provider_cancellation | Y | public, pg_temp | service_role | 본문 동일 |
| *_toss_refund 6종 | Y | public, pg_temp | service_role | 미사용 상태로 남은 표면(로컬 기준선과 일치) |
| get_my_payment_history, get_my_refund_requests, is_admin | Y | public, pg_temp | authenticated, service_role | |
| handle_new_user | Y | **미설정** | anon, authenticated, service_role | trigger 함수. 로컬 본문과 동일 |
| set_market_*_updated_at, update_updated_at_column, prevent_payment_* | N | 일부 미설정 | PUBLIC, anon, authenticated | trigger 함수 |
| market 구매·환불 DB 함수 | — | — | — | **없음**(`purchase_market_*`, `approve_market_refund` 없음) |

잠금 순서 요약(개발 DB 본문 기준, 로컬 기준선 3절과 같음):
- `consume_credits`는 P→S이고, `finalize_point_charge_refund`와 `quarantine_external_provider_cancellation`은 S→…→P 역순이다.
- `consume_credits_once`는 P를 잠근 뒤 credit_transactions에 INSERT하고, 그 다음 S를 purchased_at 순으로 잠근다.

---

## 4. 추가 확인 항목

### a) P4: legacy 유료 판매만 남은 상품 (`15_p4_legacy_vs_v2.json`)

정의:
- 대상 상품: 게시(`published`)·활성·미삭제
- legacy 유료: 활성·미삭제 `market_item_files`(asset_kind pdf/hwp/zip)가 있고, 대응 가격 `pdf_price`/`hwp_price`/`zip_price`가 0보다 큼
- V2 없음: 활성·미삭제 subproduct와 활성 bundle option이 모두 없음

| workspace_subject | 게시·활성 | **P4 (legacy 유료 & V2 없음)** | legacy & V2 둘 다 | V2만 | 해당 없음 |
|---|---|---|---|---|---|
| english | 1 | **1** (활성 pdf와 hwp, 둘 다 가격 > 0) | 0 | 0 | 0 |
| korean | 144 | 0 | 0 | 144 | 0 |

미삭제 상품은 전체 146개다. 영어 draft 1개, 영어 게시 1개, 국어 게시 144개다. 모든 상품의 메뉴가 가시·활성 상태다. V2 판매 단위를 가진 상품 중 활성 subproduct 파일이 없는 상품은 0개다.

### b) once 함수·컬럼 (`16`, `07`, `21`)

- 두 함수는 존재한다. 정의, 권한, 출처는 0절 3번과 3절에 적었다.
- 컬럼: `credit_consumption.transaction_id`는 존재한다(FK → credit_transactions ON DELETE SET NULL, non-unique index). `credit_consumption.operation_key`도 존재한다(non-unique partial index `(user_id, operation_key)`).
- `market_purchase_orders`에는 `operation_key`가 없고 `idempotency_key`만 있다.

### c) market_entitlements 활성 partial UNIQUE (`18`)

`uq_market_entitlements_active_item`, `_active_subproduct`, `_active_file`, `_legacy_source` 4개가 모두 존재하고 valid다. predicate는 `scope=… AND status='active'`이고 workspace_subject는 포함하지 않는다.

### d) market_purchase_orders idempotency (`18`)

`uq_market_purchase_orders_user_idempotency ON (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`. status와 무관하다. 컬럼은 nullable이며 현재 NULL 행은 0이다.

### e) credit 원장 CHECK (`02`, `16`)

음수·상한 CHECK는 **없다**. 현재 위반 데이터는 0건이다. 0절 5번 참조.

### f) profiles/auth.users 참조 FK의 ON DELETE (`17`)

| 동작 | 대상 |
|---|---|
| **RESTRICT** | payment_orders.user_id, checkout_attempts.user_id |
| CASCADE | credit_sources, credit_consumption, credit_transactions, payment_history, refund_requests.user_id, market_purchase_orders, market_purchases, market_entitlements, market_download_events, market_refund_requests.user_id, market_item_reviews (이상 → profiles). market_item_review_votes, profiles.id (이상 → auth.users) |
| SET NULL | market_items.created_by/updated_by, market_item_files.created_by, market_subproduct_files.created_by, market_item_view_events.user_id, market_refund_requests.processed_by, refund_requests.processed_by |
| NO ACTION | market_item_sample_pages.created_by(→auth.users) |

market 내부 FK 중 ON DELETE 없이 NO ACTION인 것:
- `market_entitlements`의 `file_workspace_fkey`, `subproduct_workspace_fkey`, `order_workspace_fkey`
- `market_purchase_lines`의 `subproduct_workspace_fkey`, `bundle_workspace_fkey`

반면 `market_purchase_orders/lines/entitlements → market_items`는 **CASCADE**다. 상품을 hard delete하면 판매 이력이 함께 삭제된다.

---

## 5. migration history 대조 (`13_migration_history_diff.json`, `21`)

- 원격 93개, 로컬 92개. version과 이름이 모두 같은 것 16개. 이름은 같고 version이 다른 것 52개(원격 version은 적용 시각).
- **원격에만 25개**: 예) `reset_credits_feature`, `add_subject_code_to_core_content_tables_v2`, `question_bank_random_exam_*` 5개, `harden_listboard_generation_*` 3개, `restrict_*_anon` 계열, `allow_v2_subproduct_file_download_asset_kind`, `append_point_charge_compliance_policy_retry`.
- **로컬에만 24개**: 예) `20251209000000_add_role_sessions_credits`, `20260306000000_add_credit_ledger_rpc_functions`, `20260725090000_create_main_ad_images_bucket`, `20260730010000_create_market_menu_groups`(개발 DB 미적용), `20260805140000_append_point_charge_compliance_policy`(원격은 `_retry` 이름으로 적용).
- 이름이 같아도 내용이 같다는 뜻은 아니다. 파일 전체 내용 비교는 하지 않았다(**미확인**). 대신 함수 20개 본문은 비교했다(0절 7번).

---

## 6. 로컬 기준선(`docs/cart-phase0-local-baseline.md`)과의 차이표

| 항목 | 로컬 기대값 | 개발 DB 실측 | 판정 |
|---|---|---|---|
| credit_transactions 컬럼 | replay 기준 `reference_id` 있음, source_id/resource_* 없음 | source_id, resource_type, resource_id, operation_key, original_operation_key. reference_id 없음 | **불일치** (개발 DB는 20260206 의도와 원격 전용 20260605 기준) |
| credit_transactions_type_check | replay 기준 ('charge','use_ai_generation',…) | ('purchase','consume','refund','admin_grant','bonus') | **불일치** (개발 DB 정의를 새 기준으로 삼아야 함) |
| credit_transactions_source_id_fkey | 의도 SET NULL, 개발 DB 미확인 | SET NULL | 일치 |
| credit_consumption.transaction_id/operation_key | 없음(drift 표시) | 있음. FK SET NULL, UNIQUE 없음 | drift 출처 확인(원격 전용 20260605023722) |
| consume/refund_credits_once | 로컬 정의 없음, 속성 미확인 | 존재. INVOKER. EXEC는 각각 PUBLIC/anon/auth/service, anon/service | drift 확인 |
| grant_credits/deduct_credits | migration 정의 없음(생성 타입에만 존재). *(2026-09-30 정정: 이전 판의 '20251209에 정의'는 오류)* | 존재. SD, search_path 없음, anon EXEC, 없는 테이블 참조. 출처 미확인 | drift 확인 |
| initialize_user_credits, on_profile_created_init_credits | 존재 기대 | **없음** | **불일치** (원격 reset_credits_feature가 삭제) |
| market_items.subject_code | migration에 없음 | 있음. 국어 144개 전부 값이 'english' | drift, 데이터 불일치 |
| market_menu_groups 테이블 | 존재 기대(20260730010000) | **없음** | **불일치** (로컬 migration 미적용) |
| get_market_home_popular_items | plpgsql, search_path='', service_role 검사, limit 1..24 | sql, search_path='public, pg_temp', 검사 없음, limit 0..100 | **불일치** (EXEC는 양쪽 모두 service_role) |
| idx_market_download_events_home_ranking | 존재 기대 | 없음. 같은 컬럼의 `idx_market_download_events_workspace_created_item_user`가 있음 | 이름 불일치 |
| consume/refund_credits 등 핵심 함수 19개 본문 | 로컬 최종 정의 | prosrc 바이트 동일 | 일치 |
| consume/refund_credits EXEC | authenticated=false | service_role만 | 일치 |
| *_toss_refund 6종 | service_role EXEC 유지 | 동일 | 일치 |
| convalidated=false | pricing_plans_price_charge_limit, payment_history_amount_charge_limit | 두 개 모두 false. 나머지는 전부 true | 일치 |
| market_purchases UNIQUE | 전체 UNIQUE(user,item,asset_kind) | 전체 UNIQUE | 일치 |
| market_purchases 사용자 INSERT/UPDATE 정책 | 존재(위험), grant 미확인 | 존재. authenticated SIUD. status 기본값 'completed' | 일치. **위험 확정** |
| market_* authenticated DML | 미확인(기본 ACL 의존) | 대부분 SIUD | 확인됨: RLS만이 방어선 |
| market_category_* | SELECT만 | anon/auth S | 일치 |
| credit 3종 anon/auth I/U/D | false, relacl 확인 필요 | I/U/D false, SELECT true. relacl에 TRUNCATE·REFERENCES·TRIGGER·MAINTAIN 잔존 | 일치. TRUNCATE 잔존은 추가 발견 |
| payment_orders/history/refund_requests/checkout_attempts | anon/auth 없음, service 전체 | 동일 | 일치 |
| payment_provider_transactions | service_role SELECT만 | 동일 | 일치 |
| profiles authenticated UPDATE | false | false. INSERT/DELETE는 true(정책 없음) | 일치 |
| relforcerowsecurity | false | 전부 false | 일치 |
| 트리거 | 기대 목록, 무결성 trigger 없음 | 기대 목록과 category/review 계열이 있고 무결성 trigger 없음. profiles trigger 없음 | profiles trigger만 불일치 |
| market 구매·환불 DB 함수 | 없음 | 없음 | 일치 |
| market-files bucket·storage 정책 | 로컬 정의 없음 | public=false, 50MiB, MIME null, storage 정책 0 | 새 기준 |
| 영어 상품 legacy 파일·가격 | 미확인 | 활성 pdf/hwp, 가격 > 0 | 미확인 해소 |
| 무결성 0건 검사(file↔subproduct item, line↔order item, line target∈item, ent↔order user/item, line 중복, completed legacy 중복) | 0 기대 | 전부 0 | 일치 |
| market_file_types.mime_allowlist | bucket 설정과 대조 | pdf `{application/pdf}`, hwp/zip은 `application/octet-stream` 포함. bucket은 MIME 제한 없음. object mimetype: image/jpeg 633, pdf 357, octet-stream 146 | bucket 수준에 제한 없음. 판매 파일 validator와의 합치는 미확인 |

---

## 7. 미확인 항목

- 사용자 세션별 실제 접근 차단. anon, 미구매 authenticated, 다른 구매자, 소유자 각각에 대해 PostgREST와 Storage API(object GET/list/createSignedUrl)로 확인해야 한다. 읽기 전용 catalog로는 검증할 수 없다. 격리 DB가 필요하다.
- 0절 1번 legacy 구매 위조의 실제 재현.
- `grant_credits`/`deduct_credits`, `consume_credits_once`/`refund_credits_once`를 실제로 호출했을 때의 결과(오류 여부). 호출하지 않았다.
- 원격에만 있는 migration 25개 전체 내용과, 이름은 같고 version이 다른 52개의 내용 동일성. 키워드 매칭으로 drift 출처만 확인했다.
- 비참조 object 7개와 비활성 전용 object 4개의 분류(업로드 초안인지 구버전인지). 경로를 저장하지 않는 원칙에 따라 prefix, 확장자, 날짜까지만 집계했다.
- 동시성, 교착, 실패 주입 검증.
- 복구 가능한 백업과 격리 검증 DB의 준비 여부.
- 로컬 migration을 fresh DB에 전체 replay할 수 있는지.

---

## 8. 팀 리드 지정 확인 항목 대응표

| 요청 | 결과 | 근거 파일 |
|---|---|---|
| kakaopay 함수 5종(begin/store_kakaopay_ready, claim_kakaopay_callback, record_kakaopay_approval, mark_kakaopay_callback_failure)과 finalize_kakaopay_payment | 전부 SD, search_path=`public, pg_temp`, EXEC는 service_role만. claim_kakaopay_callback과 finalize_kakaopay_payment 본문은 로컬과 동일 | `20`, `06` |
| quarantine_external_provider_cancellation, finalize_toss_refund | 둘 다 SD, `public, pg_temp`, service_role만. 본문은 로컬과 동일 | `20`, `06` |
| handle_new_user | SD, **search_path 미설정**, EXEC anon/auth/service(trigger 함수라 RPC로 직접 호출할 수는 없음). 본문은 로컬 `20260222_require_kakao_signup_completion`과 동일 | `20` |
| checkout_attempts | RLS on, 정책 0, trigger 0, anon/auth 권한 없음, service SIUD. 제약: user_id→profiles RESTRICT, plan_id RESTRICT, payment_order_id RESTRICT와 UNIQUE, status CHECK 5종, claimed_provider CHECK, UNIQUE(user_id, checkout_attempt_id) | `20`, `22` |
| profiles | 제약: pkey, id→auth.users CASCADE, role CHECK. **credits CHECK 없음**. 정책: `Users can view own profile`(SELECT {public}), `Admins can view all profiles`(SELECT {authenticated}). grant: anon/auth SI-D(UPDATE 회수됨, INSERT/DELETE 정책 없음). trigger 없음 | `02`, `04`, `20` |
| (1) credit_transactions 컬럼·type CHECK | 컬럼: id, user_id, type, amount, balance_after, description, **source_id, resource_type, resource_id**, created_at, **operation_key, original_operation_key**. reference_id 없음. CHECK: type IN ('purchase','consume','refund','admin_grant','bonus') | `14`, `02` |
| (2) credit_consumption.transaction_id/operation_key, market_items.subject_code | 모두 존재. transaction_id는 FK→credit_transactions ON DELETE SET NULL. subject_code는 NOT NULL DEFAULT 'english'이고 국어 144개가 'english' | `14`, `02`, `19` |
| (3) market_purchases 사용자 정책·grant | INSERT 정책(CHECK `auth.uid()=user_id`)과 UPDATE 정책(USING/CHECK `auth.uid()=user_id`, status 조건 없음)이 존재. authenticated와 anon 모두 SIUD. status 기본값 'completed' | `04`, `05`, `14` |
| (4) market_* 실제 table privilege | 2절 표 참조. 16개 테이블이 anon/auth SIUD, 4개가 S만, review_votes는 auth S | `05` |
| (5) 원격 전용 migration과 drift의 연결 | `statements`로 확인함. `_once` 함수와 `operation_key`/`transaction_id` 컬럼·UNIQUE는 `20260605023722`·`033647`·`034001`, `market_items.subject_code`는 `20260330055624`, `user_credits`·trigger 삭제는 `20260206043619 reset_credits_feature`에서 왔다. `market_menu_groups`는 원격 migration 어디에도 없다(로컬 미적용) | `21` |
| grant_credits/deduct_credits | 존재. **anon/authenticated EXECUTE 가능 → 중대 발견**(0절 4번) | `06`, `07`, `21` |

---

## 9. Phase 0 게이트 관점 요약

- 실제 스키마와 migration의 차이는 **대부분 설명된다**(원격 전용 migration 5개로 출처 확인, 로컬 미적용 1개). 다만 원격에만 있는 25개의 전체 내용은 미확인이다.
- Storage 하드 게이트에서 DB 측 조건은 확인됐다. 버킷 비공개, missing 0, 중복 참조 0이다. 비참조 7개와 비활성 전용 4개는 분류가 필요하다. 세션별 접근 차단은 미확인이다.
- 접근 불가 항목을 추측으로 PASS 처리하지 않는다. 7절의 항목이 남아 있으므로 **Phase 0은 아직 PASS가 아니다.**

---

## 10. v4 P0 체크리스트 (`docs/cart-implementation-plan-v4.md` 7절 Phase 0)

v4 기준으로는 백업, 격리 DB, fresh replay, 세션별 Storage 실측, 동시성이 Phase 0 게이트에서 빠졌다. 따라서 이 절의 판정이 7절과 9절의 v3 기준 '미확인'보다 우선한다. 추가 조회도 모두 읽기 전용이다. 결과 원본은 `23_v4_p0_checks.json`에 있다.

### 10.1 판정표

| 항목 | 결과 | 근거 | 판정 |
|---|---|---|---|
| **P0-1** consume_credits / get_credit_balance_snapshot / refund_credits 정의 | 세 함수의 `prosrc`가 로컬 `20260805110000_enforce_credit_expiration.sql`과 **바이트 단위로 같다**. 줄 단위 차이는 0줄이다. 속성(SECURITY DEFINER, `search_path=public, pg_temp`, service_role 전용 EXECUTE)도 로컬 기대값과 같다. `consume_credits` 본문에 `v_now timestamptz := now();`가 있다 | `07`, `20`(prosrc_vs_local), `06` | **PASS** |
| **P0-2** 유일 인덱스 | `uq_market_entitlements_active_item/_subproduct/_file`, `uq_market_purchase_orders_user_idempotency`, `uq_market_refund_requests_pending_order/_pending_legacy`가 모두 존재하고 valid다 | `03`, `18` | **PASS** |
| **P0-3** `_once` 함수 | `consume_credits_once`(INVOKER, `search_path=public`, EXECUTE PUBLIC/anon/auth/service), `refund_credits_once`(INVOKER, `search_path=public`, EXECUTE anon/service). `grep -rn "_once" src/`의 결과는 `src/types/supabase.ts:4359`, `:4741` 두 줄뿐이고 호출처는 없다. 신규 RPC는 이 함수들을 호출하지 않는다(재사용 금지 근거는 0절 3번) | `06`, `07`, `16` | **PASS** (기록 완료) |
| **P0-4** REVOKE 목록 / pgTAP | 기본 ACL(public): 테이블 `arwdDxtm`, 함수 `X`, 시퀀스 `rwU`를 anon과 authenticated에 준다. `information_schema.role_table_grants`는 현재 역할의 가시성 제한 때문인지 0행이 나와서, `aclexplode(relacl)`로 확인했다: `market_purchase_orders`는 anon/authenticated에 INSERT·UPDATE·DELETE·TRUNCATE·SELECT·REFERENCES·TRIGGER·MAINTAIN 전부. **pgTAP은 설치돼 있지 않다**(`pg_available_extensions`에는 1.2.0이 있어 설치할 수는 있다). 설치된 확장: pg_cron, pg_net, pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp | `09`, `23` | **PASS** (Phase 1 REVOKE 목록은 10.3) |
| **P0-5** P4 대상·구매·backfill | 대상 상품 **1개**(english). 이 상품의 completed legacy 구매 **0건**(상태 무관으로도 0건, V2 주문·환불·다운로드도 0건). `market_cart_items`와 `market_checkout_batches`는 없다. backfill dry-run 결과는 서브상품 2, 파일 2, entitlement 0(10.2) | `23`, `15` | **PASS** (2.2-2 중단 조건 해당 없음. 2.2-3 진행 가능) |
| **P0-6** migration 이력·drift | drift 객체와 그 출처는 확정했다(0절 3·4·6번, 5절, `21`). 로컬만으로 원격을 재현할 수 없는 원인도 기록했다(10.4). 다만 이력 정합(52/25/24)은 **사용자 결정 없이는 해소되지 않는다**. `supabase db push --dry-run`은 **비밀번호 프롬프트에서 실패**해 결과가 없다 | `13`, `21`, `23`, 10.6 결정 기록 | **사용자 결정으로 해소(개별 적용 방식). 이력 정합은 별도 트랙** (2026-09-30 갱신. 이전 판정은 FAIL) |
| **P0-7** 판매 테이블 직접 DML | **열림.** 근거는 10.5 | `04`, `05`, `08`, `14`, `23` | **열림 → Phase 1 선행 조건 P1-7로 격상** |

### 10.2 P0-5 상세

대상 수와 completed 구매 수를 구한 쿼리 원문:

```sql
WITH target AS (
  SELECT i.id, i.workspace_subject
  FROM public.market_items i
  WHERE i.status = 'published' AND i.is_active AND i.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.market_item_files f
      WHERE f.item_id = i.id AND f.is_active AND f.deleted_at IS NULL
        AND f.asset_kind IN ('pdf','hwp','zip')
        AND CASE f.asset_kind WHEN 'pdf' THEN i.pdf_price WHEN 'hwp' THEN i.hwp_price WHEN 'zip' THEN i.zip_price END > 0)
    AND NOT EXISTS (
      SELECT 1 FROM public.market_item_subproducts s
      WHERE s.item_id = i.id AND s.workspace_subject = i.workspace_subject AND s.is_active AND s.deleted_at IS NULL)
    AND NOT EXISTS (
      SELECT 1 FROM public.market_item_bundle_options b
      WHERE b.item_id = i.id AND b.workspace_subject = i.workspace_subject AND b.is_active)
)
SELECT
  (SELECT count(*) FROM target) AS target_items,                                   -- 1
  (SELECT count(*) FROM public.market_purchases p JOIN target t ON t.id = p.item_id
     WHERE p.status = 'completed') AS target_completed_legacy_purchases;           -- 0
```

backfill dry-run은 `src/lib/market-subproduct-backfill.ts`의 `buildMarketSubproductBackfillDryRunReport` 규칙을 SELECT로 재현했다. 규칙은 다음과 같다. 대상은 kind ∈ {pdf, hwp, zip}이다. (가격 > 0 **이고** 활성·미삭제 legacy 파일이 있으면) 서브상품 1개와 파일 1개를 만든다. entitlement 수는 completed 구매의 (user, item, kind) 고유 조합 수다. 데이터는 바꾸지 않았다. 경로와 UUID는 적지 않았다.

| kind | 가격 | 카테고리(slug / 표시명 / 활성) | 활성 legacy 파일 | 파일(mime, 크기, object 존재) | 생성 여부 |
|---|---|---|---|---|---|
| pdf | 1000 | legacy_pdf / PDF(is_active=false) | 1 | application/pdf 208011B, storage object 존재 | 서브상품 1 + 파일 1 |
| hwp | 1500 | legacy_hwp_bundle / HWP & PDF(is_active=false) | 1 | application/octet-stream 110592B, storage object 존재 | 서브상품 1 + 파일 1 |
| zip | 0 | legacy_zip / ZIP(is_active=false) | 0 | — | 건너뜀(가격 0, 파일 없음) |

리포트: `wouldCreateSubproducts=2`, `wouldCreateFiles=2`, `wouldCreateEntitlements=0`, `skippedItems=[]`, `subproductCategories={legacy_pdf:1, legacy_hwp_bundle:1, legacy_zip:0}`.
선행 조건: english의 `market_file_types` pdf/hwp/zip이 각 1행 존재하고 활성이다. legacy 카테고리 3종이 각 1행 존재하고 `is_active=false`, 미삭제다. 대상 상품에 이미 있는 legacy 카테고리 서브상품은 0이다. 참고로 `legacy_hwp_bundle`의 표시명이 `HWP & PDF`인데 이관되는 파일은 HWP 1개뿐이다. v4 2.2-4의 표시명 UPDATE 대상과 일치한다.

### 10.3 P0-4 → Phase 1 REVOKE 목록 (확정안)

- 신규 `market_cart_items`, `market_checkout_batches`: `REVOKE ALL ... FROM PUBLIC, anon, authenticated`. 기본 ACL이 생성 시점에 전 권한을 주기 때문에 **생성 직후 REVOKE가 반드시 필요하다**. 필요한 권한만 다시 GRANT한다.
- 신규 RPC(`add_market_cart_item`, `set_market_cart_selection`, `remove_market_cart_items`, 구매 RPC): `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` 후 호출 주체에 맞춰 GRANT한다. PUBLIC 회수를 빠뜨리면 anon이 PUBLIC을 통해 실행할 수 있다(`refund_credits_once` 선례: anon만 남음).
- P0-7이 '열림'이므로 기존 판매 테이블 4개(`market_purchases`, `market_purchase_orders`, `market_purchase_lines`, `market_entitlements`)에 대해 `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ... FROM anon, authenticated`를 하고, `market_purchases`의 사용자 INSERT/UPDATE 정책 2개를 DROP한다.
- 테스트: pgTAP이 없으므로 v4 계획대로 `DO` 블록 assert를 쓴다. `CREATE EXTENSION pgtap`은 DDL이라 사용자 결정 사항이다.
- `grant_credits`/`deduct_credits`: Phase 1 migration에서 DROP한다(2026-09-30 사용자 결정 (c)).
- 별도 검토(9절 후보, 이번 범위 밖): `ALTER DEFAULT PRIVILEGES` 조정, credit 3종 anon/auth TRUNCATE 회수.

### 10.4 P0-6 migration 이력 정합 계획

**요약:** 원격 93, 로컬 92. version과 이름이 모두 일치 16, 이름만 일치하고 version이 다름 **52**, 원격 전용 **25**, 로컬 전용 **24**.

**로컬만으로 원격을 재현할 수 없는 원인**(로컬 기준선 0절, 이번 실측으로 보강):
1. `credit_transactions`를 로컬 `20251209000000`이 먼저 생성해 `20260206`의 `CREATE TABLE IF NOT EXISTS`가 건너뛰어진다. 컬럼과 type CHECK가 개발 DB와 달라진다(개발 DB는 20260206 정의).
2. `20260206`이 `20251209`와 같은 이름의 정책을 IF NOT EXISTS 없이 CREATE한다(replay 실패로 추론).
3. 원격 전용 25개가 로컬에 없다. `_once`, `operation_key`, `subject_code`, `reset_credits_feature` 등이 여기에 해당한다.
4. 로컬 전용 일부는 원격에서 migration 이력 밖으로(수동으로) 적용됐다. display_labels, user_roles, ai_models, providers, main-ad-images 버킷, header navigation 행 등이다.

#### (a) 이름만 같고 version이 다른 52개

양쪽 내용은 같은 목적으로 보이나 파일 전체 동일성은 **미확인**이다(함수 20개만 본문 일치 확인). 해소 방법은 둘 중 하나이고 **사용자 결정 사항**이다.
- 안 A(원격 쓰기 없음): 로컬 파일명을 원격 version으로 바꾼다. 로컬만 변경한다.
- 안 B(원격 이력 수정): 쌍마다 `supabase migration repair --status reverted <원격 version>`과 `--status applied <로컬 version>`을 실행한다(52 × 2회).

| 이름 | 원격 version | 로컬 파일 |
|---|---|---|
| add_ai_provider_connections_and_split_problem_type_models | 20260601050230 | 20260601020000_add_ai_provider_connections_and_split_problem_type_models.sql |
| add_credit_source_category | 20260415023948 | 20260415023000_add_credit_source_category.sql |
| add_market_auto_upload_cleanup | 20260524024814 | 20260524010000_add_market_auto_upload_cleanup.sql |
| add_market_home_download_ranking | 20260728003504 | 20260728010000_add_market_home_download_ranking.sql |
| add_market_item_question_count | 20260524075335 | 20260524020000_add_market_item_question_count.sql |
| add_market_refunds | 20260602051408 | 20260602020000_add_market_refunds.sql |
| add_market_review_details | 20260901000228 | 20260901090000_add_market_review_details.sql |
| add_market_subproduct_purchase_notice | 20260611063702 | 20260611004228_add_market_subproduct_purchase_notice.sql |
| add_problem_type_regeneration_prompt | 20260601115202 | 20260601035000_add_problem_type_regeneration_prompt.sql |
| add_problem_type_review_output_format | 20260601070741 | 20260601034000_add_problem_type_review_output_format.sql |
| add_problem_type_review_prompt | 20260601060313 | 20260601010000_add_problem_type_review_prompt.sql |
| add_problem_type_sort_order | 20260603081225 | 20260603100000_add_problem_type_sort_order.sql |
| add_source_configs | 20260112083929 | 20260113_add_source_configs.sql |
| add_source_fields | 20260112075723 | 20260113_add_source_fields.sql |
| add_subject_code_compat_to_menu_entry_tables | 20260403010819 | 20260403013000_add_subject_code_compat_to_menu_entry_tables.sql |
| add_support_ticket_categories | 20260602062644 | 20260602023000_add_support_ticket_categories.sql |
| add_tags_rating_to_questions | 20260107061440 | 20260107_add_tags_rating_to_questions.sql |
| allow_bank_metadata_read_for_admin_uploaded_questions | 20260512015846 | 20260512093000_allow_bank_metadata_read_for_admin_uploaded_questions.sql |
| create_ai_question_generation_runs | 20260601135322 | 20260601043000_create_ai_question_generation_runs.sql |
| create_generate_menu_entries | 20260313021449 | 20260313021000_create_generate_menu_entries.sql |
| create_is_admin_helper | 20260505044012 | 20260208000000_create_is_admin_helper.sql |
| create_market_item_reviews | 20260807052937 | 20260807090000_create_market_item_reviews.sql |
| create_market_items_purchase_domain | 20260317095337 | 20260317113000_create_market_items_purchase_domain.sql |
| create_market_menu_entries | 20260317072347 | 20260317050500_create_market_menu_entries.sql |
| create_market_subproduct_v2_schema | 20260528032512 | 20260528010000_create_market_subproduct_v2_schema.sql |
| create_passages_table | 20251229012201 | 20251229_create_passages_table.sql |
| create_payment_orders_and_atomic_fulfillment | 20260805070824 | 20260805100000_create_payment_orders_and_atomic_fulfillment.sql |
| create_payment_webhook_events | 20260805071105 | 20260805130000_create_payment_webhook_events.sql |
| create_problem_type_default_prompts | 20260603073416 | 20260603090000_create_problem_type_default_prompts.sql |
| create_problem_type_test_runs | 20260601063958 | 20260601033000_create_problem_type_test_runs.sql |
| create_question_bank_problem_types | 20260512014519 | 20260512090000_create_question_bank_problem_types.sql |
| create_support_tickets | 20260102054126 | 20260102_create_support_tickets.sql |
| create_system_prompts | 20251229071704 | 20251229_create_system_prompts.sql |
| create_system_settings | 20251229072420 | 20251229_create_system_settings.sql |
| create_toss_refund_workflow | 20260805071104 | 20260805120000_create_toss_refund_workflow.sql |
| credit_system | 20260206050536 | 20260206_credit_system.sql |
| enforce_credit_expiration | 20260805070844 | 20260805110000_enforce_credit_expiration.sql |
| enforce_question_bank_problem_type_metadata | 20260512015023 | 20260512092000_enforce_question_bank_problem_type_metadata.sql |
| fix_market_item_reviews_anon_select | 20260807053412 | 20260807092000_fix_market_item_reviews_anon_select.sql |
| fix_market_subproduct_v2_indexes | 20260528032703 | 20260528013000_fix_market_subproduct_v2_indexes.sql |
| harden_credit_mutation_boundaries | 20260805070823 | 20260805090000_harden_credit_mutation_boundaries.sql |
| harden_market_item_reviews_rls | 20260807053158 | 20260807091000_harden_market_item_reviews_rls.sql |
| harden_market_refund_request_rls | 20260602051553 | 20260602021000_harden_market_refund_request_rls.sql |
| initial_schema | 20251120070315 | 0000_initial_schema.sql |
| order_legacy_ai_models_after_current_defaults | 20260601054101 | 20260601032000_order_legacy_ai_models_after_current_defaults.sql |
| restrict_is_admin_public_policies | 20260505044020 | 20260210000000_restrict_is_admin_public_policies.sql |
| restrict_support_ticket_rpc_anon | 20260602062840 | 20260602024500_restrict_support_ticket_rpc_anon.sql |
| seed_current_ai_models | 20260601054025 | 20260601031000_seed_current_ai_models.sql |
| switch_question_bank_problem_type_rpcs | 20260512014839 | 20260512091000_switch_question_bank_problem_type_rpcs.sql |
| update_ai_question_generation_run_sources_and_retention | 20260601140255 | 20260601050000_update_ai_question_generation_run_sources_and_retention.sql |
| update_handle_new_user | 20251120070443 | 0001_update_handle_new_user.sql |
| update_market_subproduct_category_defaults | 20260528103201 | 20260528021000_update_market_subproduct_category_defaults.sql |

#### (b) 원격 전용 25개

25개 모두 `schema_migrations.statements`가 1건 이상 저장돼 있다(`23`). 권장안은 **`--status reverted`를 쓰지 않는 것**이다. 대신 원격 statements를 그대로 담은 로컬 stub 파일을 같은 version으로 만든다. 근거는 다음과 같다.
- reverted는 이력 행만 지우고 객체는 남긴다. 그러면 drift의 출처(예: `_once`, `reset_credits_feature`)가 기록에서 사라진다.
- stub를 만들면 이력이 일치하고 재현 근거도 보존된다.
- '로컬 겹침' 항목은 대응하는 로컬 파일을 `applied`로 처리하거나(10.4c) 로컬 파일을 정리하는 것과 짝을 맞춰야 한다.

| 원격 version | 이름 | 로컬 겹침 | 권장 |
|---|---|---|---|
| 20251125003546 | allow_view_admin_uploaded_questions | 없음 | stub |
| 20251205062542 | add_question_text_forward_backward | 로컬 20260504000000의 컬럼 추가와 겹침 | stub |
| 20251209053800 | add_role_column_to_profiles | 로컬 20251209000000의 일부와 중복 | stub |
| 20260205073516 | relax_support_tickets_rls | 없음 | stub |
| 20260205074931 | add_notifications_update_policy | 없음 | stub |
| 20260206043619 | reset_credits_feature | 없음 | stub |
| 20260220002227 | add_signup_completed_for_kakao_flow | 로컬 kakao 4개 파일과 기능이 겹침 | stub |
| 20260330055624 | add_subject_code_to_core_content_tables_v2 | 없음 | stub |
| 20260505044142 | question_bank_random_exam_runtime_schema | 로컬 20260504000000·000001과 같은 목적(분할) | stub |
| 20260505044213 | question_bank_random_exam_runtime_functions | 로컬 20260504000000과 같은 목적 | stub |
| 20260505044246 | question_bank_random_exam_user_functions | 로컬 20260504000000과 같은 목적 | stub |
| 20260505044325 | question_bank_random_exam_admin_list_functions | 로컬 20260504000000과 같은 목적 | stub |
| 20260505044411 | restrict_question_bank_rpc_anon_execute | 없음 | stub |
| 20260512015101 | index_question_bank_metadata_bank_type_fk | 없음 | stub |
| 20260512015558 | switch_question_bank_backfill_helpers_to_bank_types | 없음 | stub |
| 20260601140357 | restrict_ai_question_generation_run_retention_function | 없음 | stub |
| 20260601140454 | revoke_public_ai_question_generation_run_retention_function | 없음 | stub |
| 20260605023722 | harden_listboard_generation_jobs | 없음 | stub |
| 20260605033647 | harden_listboard_generation_followups | 없음 | stub |
| 20260605034001 | harden_listboard_generation_advisor_indexes | 없음 | stub |
| 20260605060259 | add_ai_generation_run_failure_summary | 없음 | stub |
| 20260608053436 | allow_v2_subproduct_file_download_asset_kind | 없음 | stub |
| 20260618232827 | replace_generate_listboard_post_items_rpc | 없음 | stub |
| 20260618232909 | restrict_generate_listboard_reupload_rpcs_anon | 없음 | stub |
| 20260805071113 | append_point_charge_compliance_policy_retry | 로컬 20260805140000과 같은 목적(_retry) | stub |

#### (c) 로컬 전용 24개: 원격에 객체가 있는지에 따른 분류

'applied' = 객체가 이미 있거나(다른 버전으로 또는 이력 밖에서 적용), 이후 원격 변경으로 대체·제거됐다. `supabase migration repair --status applied <로컬 version>` 후보다. '미적용' = 객체가 없다. 이 경우 push할 때 함께 적용될 위험이 있다.

| 로컬 파일 | 원격 상태 | 근거 | 권장 | push 시 위험 |
|---|---|---|---|---|
| 20250101000000_create_ai_models.sql | 존재 | ai_models 테이블·idx 존재. 이를 만든 원격 migration 없음(이력 밖 적용) | applied | CREATE TABLE에 IF NOT EXISTS가 없어 push하면 즉시 실패 |
| 20250101000001_create_providers.sql | 존재 | providers 테이블·idx 존재. 원격 migration 없음(이력 밖 적용) | applied | CREATE TABLE에 IF NOT EXISTS가 없어 push하면 실패 |
| 20251124114920_add_source_and_shared_question_id.sql | 존재 | questions.source, shared_question_id 존재 | applied | IF NOT EXISTS라 재실행해도 무해 |
| 20251124155428_add_admin_provider.sql | 대체됨 | problem_types_provider_check는 원격 20260601050230이 ('openai','gemini','claude','admin')로 대체 | applied | push하면 CHECK를 ('gemini','openai','admin')로 좁혀 'claude'가 빠짐 → 위험 |
| 20251209000000_add_role_sessions_credits.sql | 부분 | profiles.role 존재(원격 add_role_column_to_profiles). user_sessions·support_tickets 인덱스 없음. user_credits·initialize_user_credits·trigger는 원격 reset_credits_feature가 삭제 | applied(의도적 제거 반영) | 이 파일은 `grant_credits`/`deduct_credits`를 정의하지 않는다. 다만 push하면 `user_credits`를 재생성해, 개발 DB에 **이미 남아 있는** 두 함수(출처 미확인, anon 실행 가능)가 동작하게 된다 → 중대 위험. 정책명이 중복되면 실패할 수도 있음 |
| 20251209000001_update_handle_new_user_with_role.sql | 대체됨 | handle_new_user 최종 본문 = 로컬 20260222_require_kakao_signup_completion | applied | push하면 handle_new_user가 구버전으로 되돌아감 |
| 20251209100000_add_admin_logs.sql | 없음 | admin_logs 테이블 없음. 원격 migration에도 언급 없음. 코드 src/app/api/admin/stats/route.ts가 참조 | 미적용 → 사용자 결정 | push하면 admin_logs 생성 + profiles/questions 정책 추가 시도(정책명 중복 가능) |
| 20260107_create_display_labels.sql | 존재 | display_labels 존재. 원격 migration 없음(이력 밖 적용) | applied | IF NOT EXISTS. INSERT 재실행 여부는 미확인 |
| 20260121134000_fix_settings_rls.sql | 없음(대체 정책 존재) | 'Enable insert/update for admins' 없음. system_settings에는 'Admins can update system settings', 'Authenticated users can view system settings'가 있음 | 미적용 → 사용자 결정(권장: applied 처리로 폐기) | push하면 admin INSERT 정책이 추가됨 |
| 20260209_create_user_roles.sql | 존재 | user_roles 존재. 원격 migration 없음(이력 밖 적용) | applied | CREATE TABLE에 IF NOT EXISTS가 없어 push하면 실패 |
| 20260220_kakao_oauth_meta_resilience.sql | 대체됨 | idx_profiles_provider_kakao_id 존재. handle_new_user는 이후 버전으로 대체 | applied | push하면 handle_new_user가 구버전으로 되돌아감 |
| 20260221_simplify_signup_profile_mapping.sql | 대체됨 | handle_new_user 이후 버전으로 대체 | applied | push하면 구버전으로 되돌아감(순서상 최종은 20260222_require라 결과적으로 같을 수 있음) |
| 20260222_enhance_kakao_profile_fallbacks.sql | 대체됨 | 동일 | applied | 동일 |
| 20260222_require_kakao_signup_completion.sql | 존재 | signup_completed 존재. handle_new_user prosrc가 이 파일과 바이트 동일 | applied | 재실행 결과는 동일 |
| 20260306000000_add_credit_ledger_rpc_functions.sql | 대체됨 | consume_credits/refund_credits 최종 = 20260805110000(바이트 동일) | applied | push하면 구버전 consume_credits로 교체되고 authenticated EXECUTE가 다시 부여됨 → 위험 |
| 20260310000000_add_header_navigation_setting.sql | 존재 | system_settings의 header navigation 행 존재. 원격 migration 없음 | applied | 재실행 영향은 미확인 |
| 20260316021500_add_generate_listboard_batch_generation_schema.sql | 부분 | jobs/post_items 테이블 존재. validate_generate_listboard_generation_job_item 함수와 trigger는 없음(다른 경로로 생성 후 변경된 것으로 추정) | applied | push하면 검증 trigger가 재도입되어 동작이 바뀜 |
| 20260316033000_add_generate_listboard_job_options.sql | 존재 | difficulty, grade_level 존재 | applied | IF NOT EXISTS |
| 20260316071000_add_generate_listboard_job_item_staging_fields.sql | 존재 | save_status 등과 idx 존재 | applied | IF NOT EXISTS |
| 20260504000000_create_question_bank_random_exam_schema.sql | 존재 | question_bank_* 존재. 원격은 20260505044142~044411의 5개로 분할 적용 | applied | push하면 함수 10여 개가 로컬판으로 교체될 수 있음 |
| 20260504000001_add_question_bank_saved_unique_index.sql | 존재 | idx_questions_from_community_unique_saved 존재(원격 20260505044142) | applied | IF NOT EXISTS |
| 20260725090000_create_main_ad_images_bucket.sql | 존재 | main-ad-images 버킷 존재(public=true). 원격 migration 없음 | applied | INSERT의 ON CONFLICT 여부는 미확인 |
| 20260730010000_create_market_menu_groups.sql | 없음 | market_menu_groups 테이블, market_menu_entries.group_id, 관련 idx 모두 없음. 코드(market-board-server.ts)는 테이블이 없을 때 fallback으로 동작 | 미적용 → 사용자 결정 | push하면 새 테이블·컬럼·정책이 함께 적용되어 cart migration과 섞임 |
| 20260805140000_append_point_charge_compliance_policy.sql | 존재(다른 버전) | 원격 20260805071113 append_point_charge_compliance_policy_retry로 적용 | applied 처리 후보 | 두 UPDATE 모두 `NOT LIKE` 가드가 있어서(문구가 이미 반영됐으면 no-op) 재실행해도 무해하다. *(2026-09-30 정정: 이전 판은 '비멱등, 약관 중복'이라고 잘못 적었다.)* |

분류 결과: applied 후보 21개, 미적용 3개(`20251209100000_add_admin_logs`, `20260121134000_fix_settings_rls`, `20260730010000_create_market_menu_groups`). 미적용 3개 중 admin_logs와 market_menu_groups는 코드가 참조한다(`src/app/api/admin/stats/route.ts`, `src/lib/market-board-server.ts`는 테이블이 없으면 fallback). `user_sessions`(`20251209000000` 일부)도 `src/app/api/auth/sessions/route.ts`가 참조하지만 테이블이 없다.

**push의 치명적 위험(repair 전에 push 금지):** 현재 상태에서 push하면 로컬 전용 파일이 다시 실행된다.
- `20251209000000`: `user_credits`를 재생성해, 개발 DB에 이미 남아 있는 `grant_credits`/`deduct_credits`(출처 미확인, anon 실행 가능)를 동작하게 만든다.
- `20260306000000`: `consume_credits`가 구버전으로 되돌아가고 authenticated EXECUTE가 다시 부여된다.
- `20251124155428`: provider CHECK에서 claude가 빠진다.
- 그 밖에 IF NOT EXISTS가 없는 CREATE TABLE에서 실패한다.
CLI는 원격 전용 version이 로컬에 없거나 원격 최신 version보다 오래된 로컬 파일이 있으면 push를 거부할 가능성이 높다. 하지만 dry-run이 실패했기 때문에 **미확인**이다.

**`supabase db push --dry-run` 시도 기록:**
- 명령: `supabase db push --dry-run --linked < /dev/null` (CLI 2.34.3, linked ref 존재)
- 출력: `Initialising cli_login_postgres role...` 다음 `Enter your database password:` 프롬프트가 떴다. stdin이 비어 있어 `failed SASL auth (28P01)`로 exit 1. **우회하지 않았다.**
- 원격 부작용 확인: `pg_roles`에 `cli_login%` 역할이 0개다(흔적 없음).
- 결과: 원격 pending 목록은 **미확인**이다. 실행하려면 DB 비밀번호(`SUPABASE_DB_PASSWORD` 또는 대화형 입력)가 필요하다.
- 실제 repair와 push는 실행하지 않았다.

### 10.5 P0-7 '열림' 판정 근거

| 조건 | 실측 |
|---|---|
| authenticated table privilege | `market_purchases`, `market_purchase_orders`, `market_purchase_lines`, `market_entitlements` 모두 `has_table_privilege('authenticated', t, 'INSERT/UPDATE/DELETE')` = true(`05`). `aclexplode`로 봐도 anon과 authenticated에 INSERT·UPDATE·DELETE·TRUNCATE 등 전부 있음(grantor postgres) |
| 정책(authenticated 대상 쓰기) | `market_purchases`: `Users can insert own market purchases`(INSERT, WITH CHECK `auth.uid() = user_id`), `Users can update own pending market purchases`(UPDATE, USING/CHECK `auth.uid() = user_id`, **status 조건 없음**). 나머지 3개 테이블의 쓰기 정책은 `Admins can manage …`(ALL, `is_admin()`)뿐이라 일반 사용자는 RLS로 거부됨 |
| 기본값 | `market_purchases.status DEFAULT 'completed'`. `price_credits`는 NOT NULL이고 CHECK는 `>= 0`이라 **0을 넣을 수 있음**(`14`, `02`) |
| trigger | `market_purchases`에는 `trg_market_purchases_updated_at`만 있음. 가격·상태·구매 검증 trigger 없음(`08`) |
| 결론 | GRANT와 정책이 함께 열린 테이블은 `market_purchases` 하나다. 사용자가 `price_credits=0`, `status` 기본값 `completed`로 자기 구매 행을 만들 수 있어 가격 우회가 가능하다(재현은 하지 않음). → **열림**. v4대로 Phase 1 migration에서 정책 DROP과 네 테이블 REVOKE를 하고 P1-7로 검증한다 |

### 10.6 사용자 결정이 필요한 사항

1. **이름만 같은 52개**: 안 A(로컬 파일명을 원격 version으로 변경) 또는 안 B(원격 repair 104회) 중 선택.
2. **원격 전용 25개**: stub 생성(권장) 또는 `--status reverted` 중 선택.
3. **로컬 전용 미적용 3개**:
   - `create_market_menu_groups`: 이번 cart migration과 함께 올릴지(코드가 이미 참조함), applied로 처리해 보류할지, 파일을 폐기할지.
   - `add_admin_logs`, `fix_settings_rls`: 같은 선택.
4. **로컬 전용 applied 후보 21개**: `repair --status applied`(원격 이력 쓰기)를 승인할지. 특히 위험 파일 3개(`20251209000000`, `20260306000000`, `20251124155428`)는 push 전에 반드시 처리해야 한다. `20260805140000`은 NOT LIKE 가드가 있어 위험 목록에서 뺐고 applied 처리 후보로만 둔다.
5. `supabase db push --dry-run`을 다시 시도하기 위한 DB 비밀번호 제공 방법.
6. pgTAP을 설치할지(`CREATE EXTENSION`), 아니면 DO 블록 assert를 유지할지.
7. (범위 밖, 권고) `grant_credits`/`deduct_credits` DROP 또는 REVOKE를 어느 트랙에서 할지.

#### 사용자 결정 기록 (2026-09-30)

| # | 결정 | 반영 |
|---|---|---|
| (a) | P0-6 이력 정합(이름만 같은 52, 원격 전용 25, 로컬 전용 24)은 **미해소 상태로 별도 트랙**에서 다룬다. 장바구니 migration은 **Supabase MCP `apply_migration`으로 단건 적용**하고, 로컬 파일 version을 원격에 기록된 version에 맞춘다. `supabase db push`와 `supabase migration repair`는 **사용하지 않는다**. | P0-6 판정을 'FAIL'에서 '사용자 결정으로 해소(개별 적용 방식), 이력 정합은 별도 트랙'으로 갱신. 10.6의 1·2·4·5번 항목은 별도 트랙으로 넘김 |
| (b) | **(h)로 대체됨.** 미적용 3개(`20260730010000_create_market_menu_groups`, `20251209100000_add_admin_logs`, `20260121134000_fix_settings_rls`)는 **내용을 검토한 뒤 각각 `apply_migration`으로 함께 적용**한다. | 10.6의 3번 항목 해소. 적용 전 검토 항목: 정책명 중복(예: add_admin_logs의 `Admins can view all profiles`는 개발 DB에 이미 있음), 기존 정책과의 관계(fix_settings_rls와 개발 DB의 `Admins can update system settings`) |
| (c) | `grant_credits`/`deduct_credits`는 **Phase 1 migration에서 DROP**한다. | 10.6의 7번 항목 해소. 0절 4번의 '즉시 DROP' 결론 유지 |
| (d) | **pgTAP은 설치하지 않고 유지**하며, SQL 테스트는 `DO` 블록 assert로 한다. | 10.6의 6번 항목 해소. P0-4 결론과 일치 |
| (e) | 대상 DB `kzcweelnzhcmiuvjgeyi`는 **운영 전 개발 DB**다. migration 적용과 SQL·동시성 테스트를 이 DB에서 직접 수행한다(기존 데이터 삭제 작업만 사전 확인). | 제목·본문 표기를 '개발 DB'로 정정 |
| (f) | 개발 DB이므로 **별도 백업은 두지 않는다**. | v4 7절 Phase 1 적용 방식에 명시 |
| (g) | `supabase db push --dry-run`은 **사용하지 않는다**(DB 비밀번호 제공 불필요). 대신 migration을 단일 트랜잭션 실행 전제·재실행 안전하게 작성하고, 적용마다 객체 체크리스트로 부분 적용 흔적 0을 확인한다. | 10.6의 5번 항목 해소. v4 P1-8 |
| (h) | 로컬 전용·원격 미적용 3개는 장바구니와 무관하므로 **이번 작업에서 제외**(적용하지 않음, 로컬 파일 유지). (b)를 대체한다. 조사: `add_admin_logs`(커밋 `632944e`) 쓰기 코드 0·불필요, `fix_settings_rls`(커밋 `c483fb2`) 원격 기존 정책으로 대체·불필요, `create_market_menu_groups`(커밋 `c911fb7`) 관리자 `MarketMenuGroupsManager`가 사용하나 원격에 테이블 없음, `market_category_groups/items`와의 관계는 사용자 결정 대기. | v4 9절 별도 트랙으로 이동. P1-0·N15 삭제 |

push와 repair를 쓰지 않으므로 10.4c의 'push 시 위험'은 현재 작업 절차에서는 발생하지 않는다. 다만 이력 정합 트랙에서 push를 다시 도입하려면 먼저 해소해야 할 조건으로 남겨 둔다.
