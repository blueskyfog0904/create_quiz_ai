# 장바구니 Phase 4 — 통합 게이트 검증 보고서

- 작성일: 2026-09-30 · 검증자: phase4-verifier(독립 검증, 코드·DB 무변경)
- 기준: [cart-implementation-plan-v4.md](./cart-implementation-plan-v4.md) 7절 Phase 4(P4-1~P4-3), 10절 Phase 1~3 기록
- 대상 DB: 개발 DB `kzcweelnzhcmiuvjgeyi`. Supabase MCP `execute_sql`로 SELECT만 실행했다.
- 판정: **조건부 OK**. 자동 게이트는 모두 통과했다. 동시성 테스트와 로그인이 필요한 확인은 미실행이며 5절의 **권장 검증**으로 남는다.
- 추가 결정(2026-09-30): 사용자 지시 "배포 안전장치 없애줘. 지금은 개발이라 상관없고, 문제 발생시 git으로 다시 되돌리면 돼."에 따라 `MARKET_CART_ENABLED` 플래그를 코드에서 완전히 제거했다. 장바구니는 항상 켜지고 `MARKET_V2_PURCHASE_ENABLED`는 유지된다. 1~4절은 제거 전 검증 시점의 기록이다.

## 1. 게이트별 결과

| 게이트 | 명령·방법 | 결과 | 판정 |
|---|---|---|---|
| 타입 | `npx tsc --noEmit -p .` (재생성된 `src/types/supabase.ts` 기준) | exit 0, 출력 0줄 | PASS |
| lint | `npm run lint` | exit 1, **112 problems (69 errors, 43 warnings)**. 장바구니 작업 전 스냅샷(scratchpad `pre/`)에서도 112건(69/43)이고 문제 파일 목록이 같다. 장바구니 신규·변경 파일을 따로 lint하면 0건이다. `preview-header.tsx`의 `react-hooks/set-state-in-effect` 2건은 HEAD에도 있는 기존 오류이며 줄 번호만 바뀌었다(HEAD 44·73 → 현재 53·91) | PASS(새 실패 0) |
| build | `npm run build` | exit 0, `Compiled successfully`, 정적 페이지 115/115. `/cart`, `/api/market/cart`, `/cart/checkout`, `/cart/checkouts/[key]`, `/cart/items`가 생성됨. 경고는 기존 turbopack root 추론 1건뿐 | PASS |
| node 테스트 | `node --test tests/*.test.mjs` | tests 940 / pass 889 / **fail 41**. 실패 이름 집합이 Phase 3 시작 전 기준(`phase3-backup/all-fails-before.txt`)과 Phase 3 재검증(`p3rev/r2/f`)의 41건과 **같다**. 장바구니 작업 전 스냅샷 `pre/`의 전체 실행은 fail 43이고, 현재 41건은 그 부분집합이다. 줄어든 2건 중 하나는 Phase 2에서 SQL 계약 기준으로 갱신한 stale 테스트 | PASS(새 실패 0) |
| migration 이력 | `supabase_migrations.schema_migrations` | **96행**. 최신 3개 `20260930020304 market_cart_checkout`, `20260930020347 backfill_legacy_only_market_items`, `20260930024829 market_checkout_rpc`가 로컬 파일명과 일치한다. 원격 `statements` md5와 로컬 파일 md5가 3개 모두 같다(a05bdf59…, 30b4b248…, 214575fe…) | PASS |
| 타입 파일 | `src/types/supabase.ts` grep | `market_cart_items`, `market_checkout_batches`, RPC 5개(`add_market_cart_item`, `set_market_cart_selection`, `remove_market_cart_items`, `evaluate_market_targets`, `checkout_market_selection`)와 `checkout_batch_id`가 있다. `grant_credits`·`deduct_credits`는 0건이며 `src` 전체 grep도 0건이다. 재생성 부수 변경으로 원격에 이미 있던 `configure_payment_reconciliation_http_cron` 타입이 추가됐고 `market_category_groups/items` 순서가 바뀌었다(무해) | PASS |
| DB 권한 재확인 | `pg_proc`, `has_*_privilege` | 신규 함수 5개 모두 `SECURITY DEFINER`, `VOLATILE`, `search_path=public, pg_temp`이다. anon·authenticated EXECUTE는 false, service_role은 true다. 신규 테이블 2개는 anon 전 권한 false, authenticated SELECT만 true다. 판매 테이블 4개는 anon·authenticated INSERT/UPDATE/DELETE/TRUNCATE가 false다. `grant_credits`·`deduct_credits`는 `pg_proc`에 0행이다 | PASS |
| legacy 이관 | 카탈로그 조회 | `legacy_pdf` 1000, `legacy_hwp_bundle` 1500(표시명 `HWP 파일`) 두 서브상품이 모두 활성이고 파일은 각각 1개다 | PASS |
| diff 범위 | `git status`, `git diff --stat`, 계획 9절(v3) 대조 | 3절 참조. 계획 밖 파일은 모두 v4 요구사항으로 설명된다. 디버그 코드·TODO는 0건이다. 정리할 임시 산출물은 1건(`supabase/migrations/.omc/`)이다 | PASS(정리 1건) |

## 2. financial drift

집계만 기록했다. Phase 0 스냅샷은 `docs/cart-phase0-db-results/16_*.json`, `19_*.json`이다.

| 불변식·항목 | Phase 0 | 현재 | 판정 |
|---|---|---|---|
| `credit_sources` remaining < 0 / remaining > initial / initial ≤ 0 | 0 / 0 / 0 | 0 / 0 / 0 | OK |
| `profiles.credits` < 0 | 0 | 0 | OK |
| completed 주문의 `credit_consumptions` 합(`amount`) ≠ `charged_credits` | – | 0 (빈 배열 0) | OK |
| 주문 청구액 ≠ 라인 합 / 라인 없는 주문 | 0 / 0 | 0 / 0 | OK |
| `checkout_batch_id` 있는 주문 합 ≠ batch `total_credits` | – | 0 (batch 0건) | OK |
| child 주문 중 `idempotency_key` NOT NULL | – | 0 (child 0건) | OK |
| batch 밖 주문의 `idempotency_key` NULL | 0 | 0 | OK |
| 활성 entitlement의 source_order가 completed가 아님 | – | 0 | OK |
| 활성 entitlement의 source 없음 | – | 0 | OK |
| 중복 활성 entitlement(item/subproduct/file) | – | 0 / 0 / 0 | OK |
| child 없는 batch | – | 0 | OK |
| fixture 잔존(`cart-test%`, `ca7e0000-%`): auth.users, profiles, items, subproducts, bundles, files, credit_sources, 주문, batch, cart, credit_transactions, 주입 trigger | – | 전부 0 | OK |
| 2026-09-30 이후 생성: 주문 / batch / cart / entitlement / credit_transactions / credit_consumption | – | 0 / 0 / 0 / 0 / 0 / 0 | 브라우저 구매 없음 |
| V2 주문 | 8 (completed 7, refunded 1) | 8 (completed 7, refunded 1) | 동일 |
| entitlement | 8 (item/active 1, subproduct/active 6, subproduct/refunded 1) | 동일 | 동일 |
| 라인 / legacy 구매 | 8 / 0 | 8 / 0 | 동일 |
| `credit_transactions` / `credit_consumption` | 384 / 330 | 384 / 330 | 동일 |
| 상품 / 번들 옵션 / legacy 파일 / 환불요청 / 다운로드 이벤트 | 146 / 144 / 2 / 1 / 6 | 146 / 144 / 2 / 1 / 6 | 동일 |
| 서브상품 / 서브상품 파일 | 355 / 500 | 357 / 502 | +2/+2 = legacy 이관(P1-6) 예상치 |
| `market_checkout_batches` / `market_cart_items` | 테이블 없음 | 0 / 0 | 신규 |

**결론: 예상하지 못한 financial drift 0.** 원장·잔액·주문·권한 수치가 Phase 0과 같다. 카탈로그 변화는 계획된 legacy 이관 +2/+2뿐이다.

## 3. 변경 파일 분류

분류 근거는 네 가지다: `git diff`(HEAD 대비), 장바구니 작업 전 스냅샷 `scratchpad/pre/`, Phase 3 백업 `scratchpad/phase3-backup/*.orig`와 `status-before.txt`, hunk 내용.

### 3.1 장바구니 작업 — 신규(untracked)

| 파일 | Phase |
|---|---|
| `supabase/migrations/20260930020304_market_cart_checkout.sql`, `20260930020347_backfill_legacy_only_market_items.sql` | 1 |
| `supabase/tests/market_cart_checkout.test.sql`, `cart_concurrency.sh` | 1 |
| `supabase/migrations/20260930024829_market_checkout_rpc.sql`, `supabase/tests/market_checkout_rpc.test.sql`, `checkout_concurrency.sh` | 2 |
| `src/lib/market-checkout-server.ts` | 2 |
| `src/lib/market-cart-server.ts`, `src/lib/market-cart-flag.ts` | 3 |
| `src/app/api/market/cart/route.ts`, `items/route.ts`, `checkout/route.ts`, `checkouts/[key]/route.ts` | 3 |
| `src/app/(solvook)/cart/page.tsx`, `_components/cart-view.tsx` | 3 |
| `src/components/market/market-cart-indicator.tsx`, `market-cart-return-link.tsx` | 3 |
| `docs/cart-*.md`, `docs/cart-*.json`, `docs/cart-db-preflight.sql`, `docs/cart-phase0-db-results/` | 계획·기록 |

### 3.2 장바구니 작업 — 기존 파일 수정(사용자 기존 변경 없음, 작업 전 = HEAD)

| 파일 | 내용 |
|---|---|
| `src/app/api/market/items/[itemId]/purchase/route.ts` | direct를 RPC로 전환, legacy body 410, 키 없는 body 400 |
| `src/lib/market-purchase.ts`(−297), `src/lib/market-items-server.ts`(−317) | 보상 경로·orphan 함수 제거(P2-4) |
| `src/lib/market-refunds.ts`, `src/app/api/admin/market/refunds/[id]/route.ts` | 환불 최소 CAS, 409 매핑(2.3(d)) |
| `src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx` | Phase 2(direct 새 body·Dialog 키·legacy 버튼 숨김)와 Phase 3(담기 버튼) |
| `src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx` | `cartEnabled`, legacy `has*` prop 제거 |
| `src/app/(solvook)/layout.tsx`, `src/app/preview/solvook-concept/layout.tsx`, `src/app/terms/layout.tsx`, `src/components/layout/header.tsx` | 헤더 배지 데이터 전달 |
| `src/app/checkout/success/page.tsx`, `src/app/checkout/kakaopay/result/result-client.tsx` | `/cart` 복귀 CTA |
| `src/app/checkout/page.tsx`, `src/app/pricing/pricing-client.tsx` | 로그인 복귀 `redirect` → `buildAuthRedirectPath` |
| `src/middleware.ts` | flag OFF일 때 `/cart` 503(P3-3) |
| `src/types/supabase.ts` | Phase 4 재생성 |
| `tests/market-hwp-bundle-contract`, `market-refund-credit-snapshot-contract`, `market-v2-detail-library-contract`, `market-v2-purchase-entitlement-contract`, `market-v2-purchase-idempotency-contract`, `market-zip-purchase-entitlement-contract`, `solvook-preview-flow-contract` (`.test.mjs`) | 새 계약에 맞춘 테스트 갱신 |

### 3.3 혼합 파일 — 사용자 기존 변경과 장바구니 hunk가 한 파일에 있음(커밋 시 `git add -p` 필요)

| 파일 | 장바구니 hunk |
|---|---|
| `src/app/preview/solvook-concept/_components/preview-header.tsx` | 배지, 로그인 `next`=현재 위치, `credit-balance-updated` 이벤트 |
| `src/components/layout/header-shell-client.tsx` | 배지(PC·모바일) |
| `src/components/layout/path-aware-site-chrome.tsx` | 조건에 `/cart` 추가. `/pricing`과 주석 변경은 사용자 기존 변경 |
| `src/app/preview/solvook-concept/_components/detail/market-material-detail.tsx` | `cartEnabled` 전달 |
| `tests/market-item-detail-ui-contract.test.mjs` | legacy 구매 버튼 제거 계약(80–81, 127–133, 146행) |

### 3.4 사용자 기존 변경(장바구니 무관, 작업 전 스냅샷과 현재가 같음)

`.mcp.json`, `AGENTS.md`, `package.json`, `package-lock.json`, `src/app/layout.tsx`, admin(menu-management·questions·reviews) 클라이언트와 API, `generate/boards` listboard, `market-listboard-client.tsx`, `(solvook)` footer·categories·library·mypage(credits·payments)·search, `sample-pages/route.ts`, preview board(`real-market-board*`, `market-material-sample-button`, `boards/[slug]/page.tsx`, `boards/[slug]/items/[itemId]/page.tsx`), `studio-pagination.tsx`, `studio-detail-page-frame.tsx`, `market-board(-server).ts`, `market-categories-server.ts`, `market-search-server.ts`, tests(`market-board`, `solvook-real-market-*`, `studio-*`). untracked: site-logo 계열, pagination 계열, `MarketCategorySidebar.tsx`, `src/app/pricing/layout.tsx`, 루트 `solvook-product-*.png`, `써머썬자료/`, `.omc/`.

### 3.5 계획 대조와 정리 항목

- v3 9절 '변경 후보'에 없는 장바구니 파일은 네 개다: `src/lib/market-cart-flag.ts`, `src/lib/market-checkout-server.ts`, `src/middleware.ts`, layout 3개(`(solvook)`, `preview/solvook-concept`, `terms`). 각각 v4 요구사항인 `MARKET_CART_ENABLED`(2.1), direct·cart 공용 RPC 호출(Phase 2), P3-3 `/cart` 503, 헤더 배지(6절)로 설명된다. 범위 이탈은 아니다. 계획의 `src/lib/market-cart.ts`는 만들지 않았다(불필요). v3의 quote·탈퇴·Storage 파일은 v4에서 제외됐고 변경도 없다.
- 디버그 코드: 신규·변경 장바구니 파일의 추가 줄에서 `console.log`/`debug`, `TODO`/`FIXME`, `debugger`, `.only(`는 0건이다. `console.error`는 기존 route 관례와 같은 오류 로깅이다.
- **정리 필요:** `supabase/migrations/.omc/state/sessions/<세션ID>/pre-tool-advisory-throttle.json`. OMC hook이 migrations 폴더 안에 만든 상태 파일(09-30 11:03)이다. 커밋하지 말고 삭제를 권장한다.
- `supabase/.temp`: tracked 파일이며 내용 변경은 0이다(`git diff` 없음). `cli-latest`의 mtime만 11:57로 바뀌었다.
- 리포 밖 잔여물: 개발 서버 프로세스 없음(4000 포트 LISTEN 없음). `.env.local`에 `MARKET_CART_ENABLED` 없음(flag OFF 유지).

## 4. 미실행 항목과 사유

| 항목 | 내용 | 사유 |
|---|---|---|
| P1-2 | 동일 target 동시 담기, 50행 한도 동시 추가(T01, T05) | DB 접속 정보(PG* 환경변수) 대기. `supabase/tests/cart_concurrency.sh` 준비 완료 |
| P2-2 | T09, T13, T14, T25, T27, N1 | 같은 사유. `supabase/tests/checkout_concurrency.sh` 준비 완료 |
| P2-3(로그인 필요 부분) | legacy body 410(N3), 키 없는 direct 400, 상세 단건 구매 200, kill switch OFF 503 | 테스트 계정 없음. 비로그인 batch 410·direct 401은 Phase 2에서 확인했다 |
| P3-1 | 401/404/400, T02, T12, T36 | 로그인 필요 |
| P3-2 | 320/768/1440, 키보드, 배지 계정 전환, 409 새 가격 Dialog, 오프라인 재시도 차감 1회, N3 구매·다운로드 | 브라우저·계정 필요 |
| P3-3(로그인 부분) | flag OFF에서 direct 구매·보관함 정상 | 로그인 필요 |
| P2-5 N6 | 상품 hard delete 후 영수증 스냅샷 | 실제 구매 1건과 상품 삭제가 필요. Phase 3 게이트로 이동했지만 계정이 없어 미실행 |
| P2-5·P4-3 N7(실행) | 동시 승인 시 환불 1회·409, 선점 후 실패 시 `approved` 유지 | Phase 2에서는 코드 대조로만 OK. 실행 검증은 미실시 |
| P4-2 T21 | cart child 하나 환불 시 다른 child 유지 | 실제 cart 구매·환불 승인 필요 |

## 5. 권장 검증(미실행)

`MARKET_CART_ENABLED` 플래그는 제거됐다(사용자 결정 2026-09-30). 사용자는 개발 단계임을 이유로 배포 안전장치 대신 git 되돌리기를 롤백 수단으로 선택했다. 따라서 아래 항목은 공개 전 필수 조건이 아니라 **권장 검증**이며, 현재 모두 미실행이다.

1. **동시성 테스트:** P1-2(`cart_concurrency.sh`)와 P2-2(`checkout_concurrency.sh`)를 PG* 또는 `PGSERVICE` 환경변수로 실행해 all passed를 확인한다. 실행 후 fixture 잔존 0도 확인한다(부록 A 쿼리).
2. **사용자 브라우저·계정 확인:** [cart-user-verification-checklist.md](./cart-user-verification-checklist.md) 전 항목 PASS. 대상은 P2-3·P3-1·P3-2·P3-3·T02·T12·T36·N3·N6이다.
3. **N7 실행 확인(P4-3):** 같은 환불 요청을 관리자 두 탭에서 동시에 승인해 `credit_transactions` 환불 1건과 한쪽 409를 확인한다(체크리스트 8절).
4. **T21 회귀:** cart로 산 child 하나만 환불하고 다른 child 권한이 유지되는지 확인한다(체크리스트 8절).
5. 확인이 끝나면 부록 A drift 쿼리를 다시 실행한다. 사용자 테스트 구매분을 빼고 불변식 위반 0을 확인한다.
6. 커밋 전 `supabase/migrations/.omc/`를 삭제한다. 9절 경고에 따라 `supabase db push`와 `migration repair`는 계속 금지한다.
7. 문제가 생기면 git으로 코드 변경을 되돌린다(플래그 제거에 따른 사용자 결정). DB는 additive 스키마를 남기며 테이블 DROP이나 금융 이력 삭제는 롤백 수단으로 쓰지 않는다(계획 7절).

## 6. 커밋 제안 단위 (예시만, 커밋하지 않았다)

혼합 파일(3.3)은 `git add -p`로 장바구니 hunk만 담는다. 사용자 기존 변경(3.4)은 이 커밋들에 넣지 않는다.

1. `feat(db): 장바구니 스키마·판매 테이블 권한 정리·legacy 이관 migration`
   - migrations `20260930020304`, `20260930020347`, `supabase/tests/market_cart_checkout.test.sql`, `cart_concurrency.sh`
2. `feat(db): 원자 구매 RPC(checkout_market_selection) migration과 SQL 테스트`
   - migration `20260930024829`, `supabase/tests/market_checkout_rpc.test.sql`, `checkout_concurrency.sh`, `src/types/supabase.ts`
3. `feat(market): 단건 구매를 원자 RPC로 전환, legacy 구매 410, 환불 승인 CAS`
   - purchase route, `market-checkout-server.ts`, `market-purchase.ts`, `market-items-server.ts`, `market-refunds.ts`, admin refunds route, `market-item-actions.tsx`, 관련 tests
   - 참고: `market-item-actions.tsx`에는 Phase 3 담기 hunk도 있다. 3과 4를 한 커밋으로 합치는 편이 단순하다.
4. `feat(cart): 장바구니 API·화면·헤더 배지·MARKET_CART_ENABLED`
   - cart route 4개, `/cart`, `market-cart-server.ts`, `market-cart-flag.ts`, `middleware.ts`, indicator·return-link, layout 3개, `header.tsx`, 혼합 파일 hunk, 충전 CTA·로그인 복귀, 관련 tests
5. `docs: 장바구니 계획 v4·Phase 0 기준선·Phase 4 보고서·사용자 확인 체크리스트`

각 커밋 메시지 끝에는 저장소 규칙의 Co-Authored-By 줄을 붙인다.

## 부록 A. drift 재확인 쿼리 (SELECT 전용, 집계만)

```sql
with o as (
  select o.*, (select coalesce(sum((e->>'amount')::int),0)
               from jsonb_array_elements(o.credit_consumptions) e) cons_sum
  from market_purchase_orders o)
select
 (select count(*) from credit_sources where remaining_credits < 0) cs_negative_remaining,
 (select count(*) from credit_sources where remaining_credits > initial_credits) cs_remaining_gt_initial,
 (select count(*) from o where status='completed' and cons_sum <> charged_credits) completed_cons_ne_charged,
 (select count(*) from market_checkout_batches b
   where (select coalesce(sum(charged_credits),0) from o where o.checkout_batch_id=b.id) <> b.total_credits) batch_sum_ne_total,
 (select count(*) from o where checkout_batch_id is not null and idempotency_key is not null) child_with_idem_key,
 (select count(*) from market_entitlements e where e.status='active' and e.source_order_id is not null
   and not exists (select 1 from o where o.id=e.source_order_id and o.status='completed')) active_ent_noncompleted_order,
 (select count(*) from (select user_id,subproduct_id from market_entitlements
   where status='active' and scope='subproduct' group by 1,2 having count(*)>1) d) dup_active_sub,
 (select count(*) from market_checkout_batches b
   where not exists (select 1 from o where o.checkout_batch_id=b.id)) batches_without_child,
 (select count(*) from auth.users where id::text like 'ca7e0000-%' or email like 'cart-test%') fixture_users;
```

`batches_without_child`는 관리자가 상품을 hard delete하면(N6) 정상적으로 1 이상이 될 수 있다(계획 3.2).
