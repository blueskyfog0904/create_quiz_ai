# 장바구니 구현 계획 독립 재검증 R2

- 검증 일자: 2026-09-29 KST
- 검증자 dispatch: `task_0857b407da5e` / `ctx_4ec5f6a68e6f`
- 검증 대상: `docs/cart-implementation-plan.md` v3 및 `docs/cart-db-preflight.sql`
- 판정: **PLAN PASS**
- 구현·DB·Storage·운영 검증 판정: **미수행 / 판정 대상 아님**
- 변경 범위: 이 보고서 1개만 작성했다. 애플리케이션 코드, migration, DB, Storage, 운영 데이터는 변경하거나 실행하지 않았다.

## 1. 결론

v3는 R1의 B1~B6을 모두 구현 가능한 명시적 계약으로 보완했다. 탈퇴 경합, direct quote/멱등성, 전체 선택, Storage 검증, legacy HWP/PDF 의미, 타 사용자 정보 비노출 중 더 이상 구현자가 핵심 정책을 새로 결정해야 하는 항목이나 서로 충돌하는 합격 기준을 찾지 못했다.

이전 검토에서 통과한 원자 구매, checkout 멱등성, 같은 quote/다른 key 차단, child별 원장·환불, 상품-타깃-과목 복합 FK, 실제 PDF 기준 주문, 부분 보유 bundle 정가, legacy 재구매 이력, profile-first 금융 writer, catalog phantom 방지, 종료 batch 410 정책도 유지됐다. 새 보완으로 인해 이 항목들과 충돌하는 금융·보안 규칙도 발견하지 못했다.

따라서 v3의 **구체적 구현 계획 완결성은 PLAN PASS**다. 다만 Phase 0의 실제 catalog·GRANT·함수 본문·Storage 접근 검증은 아직 수행되지 않았고, migration·RPC·동시성·실패 주입·브라우저 검증도 구현 후 별도로 통과해야 한다. 이 보고서는 그 결과를 미리 PASS 처리하지 않는다.

## 2. 입력과 검증 방법

### 2.1 입력 해시 확인

요청에 지정된 두 핵심 입력은 정확히 일치했다.

| 파일 | SHA-256 |
|---|---|
| `docs/cart-implementation-plan.md` | `a2224de1eb3947d9a5afcbb701f2b2d25104f0a7f45eb0439106f1344b514f46` |
| `docs/cart-db-preflight.sql` | `c7ffbb4527f5132956533737cb1f53330018a8d52ddbc5235838fdaabc109fa7` |

재검증에 사용한 나머지 입력은 다음과 같다.

| 파일 | SHA-256 |
|---|---|
| `AGENTS.md` | `86ff1a19d579971daa1ba6d7ac0994de0f672059bdda7759b2f9e2bc35a50314` |
| `CLAUDE.md` | `ac116392f46e8a720ca713cf12bfbd67f8b174ef3d24b40aa67404634e83583d` |
| `DESIGN.md` | `5562b20262e187aa71e9ed3b6d90722f4d8fba0c876a6bd90ab408ad84acfe12` |
| `docs/cart-plan-review-r1.md` | `6d89c4cf304dc0614287d526df9a46f2f47bf675b1ec3eb666593fa86ee37523` |
| `docs/cart-reference-ui.md` | `1eb62ab713b94a3814d6ed729068379ec81554dddb622ad163e8c4fd7ac78a27` |
| `docs/cart-live-db-evidence.json` | `16c0dee88270aeedb2379a3b367702b61b3700adc13a5a0b7847e4229885edb2` |
| `docs/cart-live-integrity-evidence.json` | `9e8e7941f15ee566b725214171e6d12ebbb0940392631c5431f20e66d02501ed` |
| `docs/cart-db-audit.md` | `7b3f7f2499ab24c834a79f670079104a1bbc4091be0f3880c8d4ef9547e7d403` |
| `docs/cart-code-audit.md` | `bf918752978f587063d70d8d1db850cf60561b274bcbcd9d88d98ea5e553f5f7` |

### 2.2 판정 기준

다음을 확인했다.

1. R1 B1~B6의 각 원인과 필수 수정이 v3 본문·스키마·HTTP 계약·Phase gate·테스트에 연결됐는가.
2. 보완끼리 기존 원자성·멱등성·환불·권한·잠금 계약을 깨지 않는가.
3. 운영에서 아직 확인하지 못한 catalog/Storage 상태를 관찰 완료로 오인하지 않는가.
4. 계획 합격 조건이 재현 가능한 SQL/API/동시성/권한/브라우저 검증으로 이어지는가.

`cart-db-preflight.sql`은 읽기만 했으며 실행하지 않았다. 실제 운영 또는 검증 DB 결과는 이 재검증의 증거로 주장하지 않는다.

## 3. R1 B1~B6 보완 검증

### B1. 탈퇴와 checkout 경합 — PASS

R1의 문제는 HTTP 사전 조회 뒤 순차 삭제하면 checkout과 경합하여 일부 데이터만 삭제될 수 있다는 점이었다.

v3는 다음 계약으로 이를 닫았다.

- `profiles.account_state`를 `active | withdrawal_pending`으로 제한하고, 모든 구매·견적·cart mutation·credit/charge writer가 profile 잠금 직후 active를 검사한다(`docs/cart-implementation-plan.md:159-170`).
- `request_account_withdrawal_atomic`이 profile을 먼저 `FOR UPDATE`하고 금융·구매·환불 보존 이력을 같은 transaction에서 재검사한다. 이력이 있거나 조회가 실패하면 삭제 0건으로 fail-closed한다.
- 허용된 개인 데이터, cart, 미사용 quote 정리와 `account_deletion_jobs` 생성은 한 DB transaction에서 commit/rollback한다. HTTP 순차 delete를 금지한다.
- 외부 Auth 삭제는 DB lock 밖에서 수행하고, 실패·응답 불명은 `202 WITHDRAWAL_PENDING`으로 남긴 뒤 service-only reconciliation이 동일 job을 제한 재시도한다.
- pending/completed tombstone을 profile 생성 경계에서도 검사해 Auth 실패 중 profile 재생성이나 mutation 재개를 막는다.
- quote의 profile FK와 미사용/소비 quote 보존 경계도 명시했다(`:115-121`).
- T28, T34, T35가 checkout 경합, DB 실패 주입, Auth 실패/응답 유실/재시도를 분리해 검증한다(`:344`, `:350-351`).

외부 Auth 호출을 DB transaction에 넣지 않으면서도 outbox/job과 tombstone으로 복구 상태를 갖는 구조이므로, R1의 TOCTOU·부분 삭제·Auth 실패 문제를 해결한다. 실제 FK/cascade 삭제 순서는 Phase 0에서 확정하도록 남겼지만 이는 현재 스키마 관찰이 필요한 구현 전 하드 게이트이며 제품·금융 정책 미정이 아니다.

### B2. direct quote·필수 멱등성 — PASS

v3는 기존 단건 UI의 서버 경계를 별도 계약으로 확정했다(`docs/cart-implementation-plan.md:249-259`).

- 신규 direct quote API는 target identity만 받는 strict union이며 가격·사용자·권한 입력을 금지한다.
- direct quote는 cart row를 만들지 않고 단일 target, item/subject, 가격, catalog revision, 파일, 소유권, upgrade base를 서버 snapshot으로 고정한다.
- 기존 purchase 확정 body는 legacy/V2 모두 `{quoteId,idempotencyKey}`만 받고 key를 필수 UUID로 강제한다. 구 raw body는 차감 없이 `QUOTE_REQUIRED`다.
- 공통 RPC는 DB quote의 mode를 읽고, direct에서는 cart row 검증·삭제만 생략하며 profile/account-state, catalog, 소유권, 환불 대기, credit, 원자성, replay 검증을 공유한다(`:191-204`).
- 같은 key/quote replay, 다른 quote·target·path·mode 위조, same quote/different key, 환불 후 replay 및 feature flag 경계가 명시됐다.
- T36이 direct legacy/V2와 응답 유실 replay를 검증한다(`:352`).

따라서 direct 단건이 기존 보상 엔진이나 optional key로 우회할 경로를 계획상 남기지 않았다.

### B3. 페이지 밖 전체 선택 — PASS

v3는 server pagination을 제거하고 최대 50행을 한 번에 반환하도록 결정했다(`docs/cart-implementation-plan.md:41-47`, `:74-86`, `:233-243`).

- 20/50 표시는 전체 snapshot을 보관한 client-local 표시일 뿐이다.
- 전체 선택/해제는 전체 snapshot의 구매 가능 ID+revision 배열을 atomic PATCH한다.
- 한 행이라도 owner/revision이 다르면 전부 미적용하고 재조회한다.
- quote는 페이지가 아니라 메모리의 전체 선택 집합을 명시적으로 보내며, 서버는 요청 밖의 selected 행을 자동 포함하지 않는다.
- 다른 탭의 새 행은 기존 quote에 들어오지 않고, 기존 선택 행 변경은 revision 충돌로 거절한다.
- T37이 20행 표시에서 50행 전체 선택과 다른 탭 변경을 검증한다(`:353`).

이로써 UI 문구, 선택 source of truth, PATCH 입력, quote 집합이 하나의 계약으로 일치한다.

### B4. Storage ACL·실접근·path 정합성 — PASS

갱신된 preflight와 Phase 0이 R1의 누락을 함께 해결한다.

- preflight는 `storage.objects/buckets`의 policy, `relacl`, anon/authenticated/service_role별 SELECT/INSERT/UPDATE/DELETE 권한을 수집한다(`docs/cart-db-preflight.sql:37-56`).
- bucket의 `public`, size, MIME 설정을 확인한다(`:85-86`).
- legacy/subproduct/sample 활성 DB 참조와 실제 object의 누락 수, 다중 참조 path, 비참조 object 수를 경로·사용자 식별자 없이 집계한다(`:88-122`).
- Phase 0은 bucket 공개성, ACL+RLS, MIME/size, 활성 path 누락, 설명되지 않은 중복·비참조 object를 하드 게이트로 둔다(`docs/cart-implementation-plan.md:278-287`).
- 별도 격리 검증에서 anon, 미구매 authenticated, 다른 구매자, 소유자 세션의 direct GET/list/createSignedUrl을 모두 차단하고 service download API만 허용한다.
- 5분 signed URL 잔여 접근과 환불 정책을 명시하며, 우회가 발견되면 해당 bucket만 최소 policy migration으로 보강한다.
- T38이 4역할 직접 접근과 path/object 정합성을 검증한다(`:354`).

preflight SQL 자체는 4역할 세션 동작을 실행하지 않지만, 계획이 이를 별도 Phase 0 실접근 gate로 요구하므로 계획 누락이 아니다. 실제 결과가 없다는 사실도 문서가 숨기지 않는다.

### B5. legacy HWP/PDF/ZIP 의미 — PASS

v3는 현재 production exact-kind를 source of truth로 선택했다(`docs/cart-implementation-plan.md:172-185`).

- legacy HWP는 별도 PDF 다운로드 권한이나 PDF→HWP 차액을 제공하지 않는다.
- HWP와 PDF는 각각 정가·독립 판매 단위이며 동시 선택도 허용한다.
- 각 purchase와 환불은 독립이고 ZIP도 독립이다.
- 이전 migration COMMENT와 `HWP & PDF` 라벨은 새 migration COMMENT와 `HWP 파일` 라벨로 정정한다.
- V2 subproduct의 PDF 포함 HWP·차액 정책은 legacy와 분리해 유지한다.
- T39가 legacy 기보유, 동시 구매, 환불, ZIP 독립을 검증한다(`:355`).

이는 migration 주석과 현재 코드의 충돌을 하나의 명시 정책으로 해소한다. 기존 migration을 고쳐 쓰지 않고 새 migration COMMENT로 바로잡는 방식도 이력 보존 원칙과 맞는다.

### B6. 타 사용자 정보 미반환 — PASS

T02는 이제 타 사용자의 cart/quote/key에서 존재 여부·항목·가격 snapshot·영수증을 모두 반환하지 않고, 없는 대상과 같은 404 및 mutation 0을 요구한다. anon은 401로 분리한다(`docs/cart-implementation-plan.md:317-319`).

신규 테이블은 owner SELECT만 허용하고 anon 접근과 사용자 직접 mutation을 회수하며, service Route Handler도 인증된 사용자 범위를 다시 적용한다(`:141-147`). 본문과 테스트 합격 기준 사이의 중의성이 제거됐다.

## 4. 이전 통과 항목 유지 및 새 모순 검사

### 4.1 원자성·멱등성·child 환불 — 유지 PASS

- 단건과 cart 모두 하나의 quote/checkout RPC를 사용하고 application 보상 엔진을 기능 공개 전에 제거한다.
- 같은 user+key 성공 replay를 quote 만료/소비 검사보다 먼저 반환하며, 같은 key의 다른 payload와 같은 quote의 다른 key를 각각 거절한다.
- 각 판매 단위 child UUID를 먼저 확정하고 같은 DB transaction 안에서 실제 source별 소비 내역을 저장한다. child 환불은 자기 consumption만 복구한다.
- 실패 시 차감·주문·entitlement·cart 삭제·quote 소비가 모두 rollback된다.
- direct 성공은 unrelated cart row를 삭제하지 않고, cart 성공은 quote의 cart ID+revision만 삭제한다.

### 4.2 잠금·가격·파일 phantom — 유지 PASS

- 모든 잔액 writer는 profile-first로 이관하며 역순 writer가 남으면 Phase 2 FAIL이다.
- checkout은 profile lock 직후의 `clock_timestamp()`를 고정해 lock 대기 전 transaction 시각으로 만료를 잘못 통과하지 않는다. T40이 이 경계를 검증한다.
- `catalog_revision`과 parent item 잠금을 child trigger에 강제하고, 신규 파일 INSERT도 revision을 올린다.
- 다중 상품 및 OLD/NEW parent 이동은 UUID 정렬 잠금, deadlock/serialization 실패는 같은 key 최대 3회 재시도로 고정한다.

### 4.3 FK·업그레이드·bundle·legacy — 유지 PASS

- SKU/target-item-subject 및 order/line/entitlement의 복합 FK를 기존 테이블까지 보강한다.
- HWP 차액은 실제 `upgrade_base_order_id`를 같은 user/item/subject로 참조하며 여러 PDF 후보의 결정적 tie-break가 있다.
- 부분 보유 bundle은 현행 정가 정책, 명시 확인, 기존 subproduct entitlement 보존, 새 item entitlement만 환불로 일관된다.
- legacy 재구매는 completed partial UNIQUE와 새 purchase ID로 과거 원장·환불 이력을 보존하며 사용자 직접 DML을 제거한다.

### 4.4 API 권한·UX·후퇴 경계 — 유지 PASS

- cart/direct route와 strict body, 401/402/404/409/422/503 의미가 구체적이다.
- 로그인 복귀, cart badge, 320/768/1440px, keyboard/focus/Dialog, 계정 전환, network failure 및 충전 CTA 검증이 Phase 3에 있다.
- `MARKET_CART_ENABLED`는 cart 진입만 끄고 direct atomic engine과 기존 receipt/library/refund는 유지한다.
- 금융 이력 DROP/delete가 아닌 additive schema와 진입점 차단을 후퇴 전략으로 사용한다.

검토 범위에서 위 계약 사이의 새로운 중대한 금융·보안 모순은 발견하지 못했다.

## 5. 구현 전후에 남은 필수 게이트

다음은 PLAN FAIL 사유가 아니라, 계획이 스스로 명시한 구현 선행·완료 조건이다.

1. 운영 권한의 읽기 전용 연결에서 preflight를 실제 실행하고 constraint/index/RLS/GRANT/function body/trigger/default ACL/migration drift를 보관해야 한다.
2. Storage 4역할 실접근과 object/path 분류를 격리 검증 환경에서 수행해야 한다.
3. `_once` 함수 drift, 모든 balance writer의 profile-first 이관 범위, 실제 FK/cascade 및 account deletion 정리 순서를 확정해야 한다.
4. fresh DB와 운영 복제본 migration, RLS/직접 DML/RPC 권한, failure injection 및 동시성 T01~T40을 통과해야 한다.
5. target tests, lint, build, 320/768/1440px 브라우저·접근성·계정 전환·네트워크 실패 검증을 통과해야 한다.

접근 불가, 결과 미수집 또는 테스트 미실행을 추정으로 PASS 처리하면 안 된다. Phase 0에서 실제 상태가 계획의 전제와 다르면 해당 Phase는 FAIL이고, 원인을 반영해 migration/계획을 보완한 뒤 다시 검증해야 한다.

## 6. 최종 판정

**R2 PLAN PASS.** v3는 R1 B1~B6을 충분히 보완했고 이전 통과 항목을 유지했으며, 구현자가 새로 내려야 할 중대한 금융·보안·UX 정책 결정이나 상호 모순되는 합격 조건을 남기지 않았다.

이 PASS는 문서화된 구현 계획의 완결성에 한정된다. 실제 SQL, DB catalog, RLS/GRANT, Storage 접근, migration, RPC, 동시성, 실패 주입, UI 및 운영 rollout은 아직 PASS가 아니다.
