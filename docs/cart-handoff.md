# 장바구니 기능 인수인계

작성일: 2026-09-30 KST · 설계·검증 기준: 2026-09-29 확정본

## 1. 지금 어디까지 했는가

**장바구니 설계와 계획 검증을 완료했고, 실제 구현은 아직 시작하지 않았다. 다음 단계는 구현 계획의 Phase 0, 실제 DB 기준선 검증이다.**

| 항목 | 현재 상태 |
|---|---|
| 솔북 상품 상세·장바구니 UI 조사 | 완료. 비로그인으로 확인 가능한 범위 관찰 |
| 현재 저장소 코드·DB 마이그레이션 분석 | 완료 |
| 연결된 DB의 읽기 전용 스키마·집계·일부 무결성 조사 | 완료. 검증 범위와 한계 별도 기록 |
| 구현 계획 | v3 확정 |
| 계획 작성 → 검증 loop | 자체 검토 FAIL → 독립 R1 FAIL → 보완 → 독립 R2 **PLAN PASS** |
| 장바구니 UI/API·신규 DB 테이블·RPC | **미구현** |
| 신규 migration 적용 | **미실행** |
| 계획에 정의된 T01~T40 구현 검증 | **아직 실행하지 않음** |
| 배포·운영 공개 | **미실행** |

PLAN PASS는 **구현 계획이 실행 가능한 수준으로 정리됐다는 뜻**이다. 실제 DB 권한, 트랜잭션, 동시성, UI가 구현되어 검증을 통과했다는 뜻이 아니다.

인수인계 작성 시 `src/app/(solvook)/cart/page.tsx`, `src/app/api/market/cart/route.ts`, `src/lib/market-cart-server.ts`가 아직 없는 것을 확인했다. 이번 인수인계 작업도 문서만 작성하며 구현을 시작하지 않는다.

## 2. 목표와 작업 위치

- 저장소 루트: `/Users/mac/Documents/project/create_quiz_ai`
- 확인한 브랜치/HEAD: `main` / `bbddeee`
- 개발 주소: `http://localhost:4000`
- 목표: 상품의 판매 옵션을 장바구니에 보관하고, 선택한 자료를 기존 크레딧으로 안전하게 일괄 구매하는 기능.
- 솔북 참고 주소:
  - `https://solvook.com/products/3482476214105408716`
  - `https://solvook.com/shop/cart`

현재 구매는 크레딧 차감, 주문, 주문 상세, 다운로드 권한을 여러 DB 요청으로 처리하고 실패하면 보상 환불을 시도한다. **이 단건 함수를 여러 번 호출하는 방식으로 장바구니를 만들면 부분 차감·부분 구매가 발생할 수 있다.** 따라서 장바구니 화면보다 원자적 구매 처리 기반을 먼저 구현해야 한다.

### 보존해야 할 기존 작업

작업 트리에는 앞선 로고 업로드, 공통 헤더, 페이지네이션, 카테고리 개수·상세 사이드바, 비로그인 샘플 보기 등의 미커밋 변경이 있다. 이들은 장바구니 구현물이 아니다. 장바구니 개발을 위해 기존 변경을 되돌리거나 덮어쓰지 않는다. 자동 커밋하지 않는다.

## 3. 문서 지도와 읽는 순서

아래 링크는 이 인수인계 파일이 있는 `docs/` 기준 상대 경로다. 절대 위치는 저장소 루트에 `docs/파일명`을 붙이면 된다.

| 순서 | 문서 | 용도 |
|---|---|---|
| 1 | [cart-implementation-plan.md](./cart-implementation-plan.md) | **최종 구현 기준**. DB 계약, 정책, API, Phase 0~4, T01~T40 |
| 2 | [cart-plan-validation.md](./cart-plan-validation.md) | 완료된 검증 loop, 전달본 해시, 실제 수행/미수행 구분 |
| 3 | [cart-plan-review-r2.md](./cart-plan-review-r2.md) | 독립 재검증 PLAN PASS의 근거 |
| 4 | [cart-db-audit.md](./cart-db-audit.md) | 기존 DB 제약·권한·원자성·환불·잠금 위험 분석 |
| 5 | [cart-code-audit.md](./cart-code-audit.md) | 현재 사용자 흐름, 코드 위치, 로그인 복귀 및 API 문제 |
| 6 | [cart-live-db-evidence.json](./cart-live-db-evidence.json) | 실제 DB OpenAPI·행 수·참조 무결성 스냅샷 |
| 7 | [cart-live-integrity-evidence.json](./cart-live-integrity-evidence.json) | 추가 원장/소유자/권한 검사, 익명 HEAD, Storage 비공개 확인 |
| 8 | [cart-db-preflight.sql](./cart-db-preflight.sql) | **아직 실행하지 않은** Phase 0용 읽기 전용 SQL |
| 9 | [cart-reference-ui.md](./cart-reference-ui.md) | 솔북에서 직접 관찰한 UI와 프로젝트 적용 제안 |
| 참고 | [cart-plan-review-r1.md](./cart-plan-review-r1.md) | 첫 독립 검증의 FAIL 항목 B1~B6와 수정 이유 |

**문서가 다르게 보이면:** DB·코드 감사에 있는 대안은 당시의 검토 의견이다. 최종 정책은 `cart-implementation-plan.md` v3를 따른다. 예를 들어 옛 batch API 재사용, 클라이언트에만 선택 저장, legacy 제외 등의 감사 대안을 최종 결정으로 착각하지 않는다.

최종 계획 전달본 SHA-256:

```text
cf036d1600998a202d31519479492baa1d96c40e8858451b4cebc47bc3e4f09a
```

R2가 검증한 입력과 전달본의 차이는 PASS 상태를 확정한 문서 메타데이터 2줄뿐이다. 기능·DB·정책 본문이 동일함을 검증했으며 상세 해시는 `cart-plan-validation.md`에 있다. 본 인수인계는 기존 계획을 요약하며 새 설계 결정을 추가하지 않는다.

## 4. 확정된 사용자 기능

1. **로그인 계정별 서버 저장** 장바구니. 게스트 장바구니는 1차 범위가 아니다. 비로그인 샘플 보기는 계속 허용한다.
2. 영어·국어 자료를 한 장바구니에 담고 과목별로 표시한다.
3. 판매 단위는 V2 서브상품, V2 번들, legacy PDF/HWP/ZIP. 파일 경로와 샘플은 판매 단위가 아니다.
4. 디지털 상품 수량은 1. 같은 타깃 반복 담기는 기존 행을 반환한다. 장바구니/구매 선택은 최대 50개.
5. 서버는 전체 최대 50행을 반환하고, 화면만 공통 20/50개씩 나눈다. 페이지 밖 전체 선택을 위해 전체 ID·revision·선택 집합을 유지한다.
6. 선택은 DB `is_selected`에 저장한다. 최종 결제는 quote에 고정된 ID·revision 집합만 대상으로 한다.
7. 선택 구매는 **기존 크레딧 사용**이다. Toss/KakaoPay는 크레딧 충전용이며 장바구니가 원화 부족분을 직접 결제하지 않는다.
8. 구매 전에 서버 견적을 받고 확정 Dialog를 보여준다. 가격·판매 상태·보유권 변경은 차감 없이 재확인한다.
9. 성공하면 구매에 포함된 원래 cart 행만 삭제한다. 미선택 행과 다른 탭에서 새로 담은 행은 보존한다.
10. PC 목록/금액 요약, 모바일 한 열/하단 요약, 헤더 배지를 구성한다. 기존 Studio 컴포넌트·토큰을 재사용한다.

### 구매 옵션별 중요한 정책

- 같은 상품의 번들+개별 서브상품 동시 선택은 거절한다.
- V2의 PDF 포함 HWP와 PDF 동시 선택도 거절한다.
- 기존 PDF 보유자의 V2 HWP 차액은 현재 서버 규칙을 유지한다. 기준은 과거 지불액이 아닌 **현재 PDF 판매가**이며, 실제 기준 주문 ID를 기록하고 환불 의존성을 검증한다.
- 일부 구성품을 이미 보유한 번들은 기존처럼 **정가**로 구매 가능하다. 기보유분 차감이 없음을 확인받는다. 번들 환불이 기존 개별 소유권을 없애면 안 된다.
- legacy는 **exact-kind**다. HWP 구매로 별도 PDF asset 권한을 받지 않으며 PDF/HWP/ZIP은 각각 정가·독립 권한·독립 환불이다. V2 차액 규칙을 legacy에 적용하지 않는다.
- 같은 상품의 legacy/V2 소유 범위가 명확히 매핑되지 않으면 임의로 결제하지 않고 `OWNERSHIP_REVIEW_REQUIRED`로 차단한다.
- 쿠폰·배송·제본·대여권·외부 PG 직접 자료 결제는 범위 밖이다.

## 5. DB 설계 핵심

### 신규 모델 — 모두 계획 상태

| 모델 | 책임 | 주의점 |
|---|---|---|
| `market_cart_items` | 사용자·상품·타깃·선택·revision | 가격/원장/다운로드 권한 저장 금지, 타깃별 UNIQUE와 복합 FK |
| `market_checkout_quotes` | 서버가 계산한 5분 견적 | `cart/direct` 모드, 소유자·선택·가격·보유·파일 버전 snapshot |
| `market_checkout_batches` | 한 번의 일괄 구매·멱등 결과 | user+key UNIQUE, quote UNIQUE, 성공 때만 커밋 |
| `market_checkout_batch_lines` | batch와 기존 단위 구매 연결 | child별 청구액/환불 연결, 원래 cart ID는 감사용 snapshot |
| `account_deletion_jobs` | 외부 Auth 삭제 실패 복구 | 사용자 직접 접근 금지, 삭제 뒤에도 필요한 user UUID는 FK 없는 tombstone |

기존 주문은 `market_purchase_orders`, `market_purchase_lines`, `market_entitlements`, legacy `market_purchases`다. **서로 다른 상품/과목을 기존 단일 item 주문 한 행으로 합치지 않는다.** 각 판매 단위의 기존 주문을 유지하고 batch가 그들을 묶는다.

### 기존 DB도 함께 보강해야 한다

- 타깃-상품-과목, 주문-사용자-상품-과목을 묶는 복합 FK/후보키를 보강한다. 과목만 맞는 FK로는 충분하지 않다.
- legacy 구매 UNIQUE는 completed partial UNIQUE로 바꾸고, 환불 후 재구매는 새 purchase ID를 만든다.
- 기존 금융/권한 테이블의 사용자 직접 DML을 명시적으로 차단한다.
- 원장 음수·상한 제약을 실제 DB와 대조해 보강한다.
- V2 주문에 `upgrade_base_order_id`를 추가해 HWP 차액과 PDF 기준 주문을 연결한다.
- 상품에 `catalog_revision` 및 카탈로그 변경 잠금 프로토콜을 도입한다.
- `profiles.account_state`와 원자 탈퇴/복구 처리를 추가해 구매와 탈퇴가 경합해도 일부 데이터만 삭제되지 않게 한다.

### 구매 트랜잭션

```text
로그인/계정 확인
→ 서버 quote 생성·사용자 확인
→ profile 잠금
→ 멱등 재시도 확인
→ quote·cart/direct 대상·catalog·보유권·환불 상태 재검증
→ 유효 credit_sources 잔액 확인
→ 단위별 차감 + 기존 주문/권한 + batch 연결
→ quote 소비 + 선택 cart 행 삭제
→ 전체 커밋
```

- 중간 오류는 전체 롤백이다. HTTP 요청을 여러 번 호출하는 보상 루프가 아니다.
- 각 child는 자신의 실제 credit source 소비 내역을 보관한다. 총액 소비 JSON을 모든 주문에 복사하지 않는다.
- 동일 키 재시도는 기존 결과를 반환한다. 응답 유실 후 새 키로 자동 재구매하지 않는다.
- 모든 잔액 writer의 `profile-first` 잠금 순서를 맞춘다. 충전/provider 환불도 검토 대상이다.
- 잠금 획득 후 DB 시각을 기준으로 quote/credit 만료를 판단한다.
- 카탈로그 child 변경은 부모 상품 잠금·revision 증가를 거치게 해 구매 중 가격·파일 변경을 검출한다.
- 샘플은 공개를 유지한다. 유료 다운로드·환불 승인도 최종 권한 검사/사용 기록/원장 갱신의 경합을 검증한다.
- 회원 탈퇴는 profile 잠금 아래 허용된 DB 정리와 job을 원자 처리하고, 외부 Auth 실패는 `202 WITHDRAWAL_PENDING`으로 복구한다. 자세한 삭제 경계는 최종 계획 5.7절을 그대로 따른다.

## 6. 실제 DB에서 확인한 것과 아직 모르는 것

아래 수치는 **2026-09-28~29에 수집한 과거 스냅샷**이다. 인수인계 작성 시 DB를 다시 조회한 값이 아니므로 구현 시작 시 재확인한다.

- cart 테이블 없음.
- 상품 146개, 서브상품 355개, 서브상품 파일 exact count 500개.
- 공개·활성 상품: 국어 144개, 영어 1개.
- V2 주문/라인/권한 각 8건, 주문 completed 7건/refunded 1건. legacy 구매 0건.
- 조사 범위의 부모·소유자 불일치, 주문별 소비 합계 불일치, 활성 권한 상태 불일치 등은 0건.
- `market-files`는 `public=false`. 검사한 금융/권한 테이블의 익명 HEAD는 모두 0행.

**아직 검증하지 못한 항목:** 실제 FK/CHECK/partial UNIQUE/RLS/GRANT/함수 본문/trigger/default ACL, 인증된 사용자별 Storage 실접근, 모든 object/path 정합성, 동시성·실패 주입.

특히 운영에는 `consume_credits_once`, `refund_credits_once` 등이 보이나 로컬 마이그레이션에 해당 정의가 없는 drift가 있다. 이름만 보고 안전한 함수라고 가정하거나 바로 재사용하지 않는다.

당시 Supabase 관리 API 토큰/DB catalog 접근 경로가 준비되지 않았고 `exec_sql`도 없었다. 다음 작업자는 현재 접근 가능 여부를 다시 확인해야 한다. **service-role REST 조회가 된다는 이유만으로 DB catalog·권한 검증이 완료된 것은 아니다.**

## 7. API와 코드 위치

### 새로 만들 API

| 경로 | 역할 |
|---|---|
| `GET /api/market/cart` | 전체 최대 50행 조회 |
| `POST/PATCH/DELETE /api/market/cart/items` | 담기·선택 변경·삭제 |
| `POST /api/market/cart/quote` | 선택 전체의 서버 견적 |
| `POST /api/market/cart/checkout` | quote+멱등 키로 원자 구매 |
| `GET /api/market/cart/checkouts/[key]` | 본인 완료 결과 재조회 |
| `POST /api/market/items/[itemId]/quote` | 기존 단건 구매용 direct 견적 |

기존 `POST /api/market/items/[itemId]/purchase`도 `{quoteId,idempotencyKey}` 확정 계약과 같은 원자 엔진으로 이관한다. direct는 cart 행을 생성/삭제하지 않는다. **`/api/market/purchases/batch`는 계속 410을 반환한다.**

### 먼저 읽어야 할 기존 파일

| 위치 | 확인할 내용 |
|---|---|
| `src/lib/market-purchase.ts` | 현재 HTTP 보상 구매, 중복 보유, legacy/V2 의미 |
| `src/lib/market-items-server.ts` | 상품·옵션·가격·차액·주문·보관함 조회 |
| `src/lib/credits.ts`, `src/lib/credit-balance.ts` | 원장 RPC 호출과 잔액 표시 경계 |
| `src/lib/market-refunds.ts` | 현재 분리된 환불 처리와 기준 PDF 주문 보호 |
| `src/app/api/market/items/[itemId]/purchase/route.ts` | 단건 구매 계약 |
| `src/app/api/market/items/[itemId]/download/route.ts` | 유료 파일 권한·signed URL·사용 이벤트 |
| `src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx` | 담기/견적/확정 UI 연결 지점 |
| `src/app/preview/solvook-concept/_components/preview-header.tsx` | 메인 공유 헤더 배지·로그인 복귀 |
| `src/components/layout/header.tsx`, `header-client.tsx`, `path-aware-site-chrome.tsx` | 다른 헤더 경로와 `/cart` 중복 헤더 방지 |
| `src/app/(solvook)/library/_components/library-view.tsx` | 구매 결과·단위별 환불 회귀 |
| `src/app/pricing/pricing-client.tsx`, `src/app/checkout/page.tsx` | login `redirect`를 기존 `next` 계약으로 정리 |
| `src/app/checkout/success/page.tsx`, `src/app/checkout/kakaopay/result/result-client.tsx` | 충전 후 `/cart` 복귀 CTA |
| `src/app/api/auth/withdraw/route.ts` | 탈퇴 원자성·Auth 복구 경계 |
| `supabase/migrations/`, `src/types/supabase.ts` | 실제 DB와 대조할 기준 |

신규 UI는 `src/app/(solvook)/cart/`, 도메인 코드는 계획의 `src/lib/market-cart*.ts`, 신규 migration/SQL 테스트는 `supabase/migrations/`와 `supabase/tests/`에 둔다. 탈퇴 복구 경로와 DB 변경 후보의 전체 목록은 최종 계획 9절에 있다. 위 신규 경로는 존재하는 구현물이 아니라 예정 위치다.

## 8. 구현 순서와 다음 행동

| Phase | 해야 할 일 | 종료 조건 | 현 상태 |
|---|---|---|---|
| 0 | 실제 DB catalog·함수·권한·Storage·writer/잠금·migration drift 확인 | 근거 수집, 차이 설명, 격리 DB/백업/접근 권한 준비 | **다음 시작점 / 미통과** |
| 1 | cart/quote/batch/line 및 기존 제약·권한 보강 | fresh DB·운영 복제본 migration, FK/UNIQUE/RLS 검증 | 미착수 |
| 2 | 공통 원자 구매, 기존 단건·환불·다운로드·탈퇴 경계 이관 | 중복·경합·실패 주입 테스트 통과, 종료 batch 410 유지 | 미착수 |
| 3 | API·cart UI·헤더·로그인 복귀·충전 CTA | PC/모바일·키보드·계정 전환·네트워크 실패 검증 | 미착수 |
| 4 | 통합 검증·feature flag로 점진 공개 | 구현 계획의 모든 gate와 회귀 검증 통과 | 미착수 |

다음 작업자가 구현 요청을 받으면 다음 순서로 시작한다.

1. `AGENTS.md`, `CLAUDE.md`, `DESIGN.md`, 최종 계획과 R2 보고서를 읽는다. 새 UI 작업 전 `/preview/design-system`도 확인한다.
2. `git status`로 기존 dirty 변경을 확인하고 장바구니와 구분한다. 현재 브랜치·DB 대상 프로젝트가 인수인계 시점과 같은지도 확인한다.
3. 검증 DB와 복구 가능한 백업, 대상 프로젝트의 읽기 전용 catalog 접근을 준비한다. 키·비밀번호는 문서/로그에 남기지 않는다.
4. 권한 있는 연결에서 `docs/cart-db-preflight.sql`을 실행해 결과를 저장한다. 이 파일은 migration이 아니다.
5. 실제 DB 정의와 마이그레이션의 차이, `_once` 함수, writer/잠금 순서, Storage 직접 접근을 대조한다.
6. Phase 0 결과를 기록한다. 접근 불가·미해결 drift를 추측으로 PASS 처리하지 않는다.
7. Phase 0 통과 후에만 Phase 1로 이동한다. 각 단계는 **계획 확인 → 구현 → 검증 → 실패 원인 분석·수정 → 재검증** 순서로 수행한다.

운영 DB에 곧바로 `supabase db push`하지 않는다. 계획 PASS만 근거로 DDL·금융 경로 전환·배포를 수행하지 않는다.

## 9. 검증 기록과 주의할 함정

- 독립 R1은 탈퇴 경합, direct 계약, 전체 선택, Storage, legacy coverage, 정보 비노출 기준을 FAIL로 지적했다.
- v3에서 모두 보완했고 독립 R2가 PLAN PASS로 판정했다.
- 테스트 T01~T40은 최종 계획 11절에 **정의된 합격 기준**이며 실행된 테스트 40개가 아니다.
- 실제로 수행한 것은 솔북 관찰, 읽기 전용 DB 조사, 문서 검토, JSON/링크/해시 및 문서 diff 검증이다.
- 향후 구현에서는 SQL/동시성/실패 주입/권한/브라우저 테스트와 lint/build를 실행해야 한다. 기존 unrelated 실패는 기준선과 분리하고 새 실패를 남기지 않는다.
- 이전 감사 에이전트의 일부 worker_done 통신은 실패했지만 보고서와 최종 판정을 확인해 명시적 recovery로 완료 처리했다. 이미 종료된 이전 task/dispatch를 새 작업의 실행 문맥으로 재사용하지 않는다.

### 금지할 구현

- 기존 단건 구매를 N번 HTTP 호출해 전체 성공처럼 처리하기.
- 장바구니 저장 가격이나 클라이언트 합계로 차감하기.
- 한 child 환불에 batch 전체 소비 내역을 복사해 사용하기.
- 같은 사용자·키의 다른 구매를 같은 성공으로 반환하기.
- quote 이후 새로 추가한 행까지 장바구니 전체 삭제하기.
- 현재 과목만 맞으면 다른 상품의 서브상품 FK도 유효하다고 보기.
- `_once` 이름, `public=false`, 익명 0행만 보고 전체 DB/Storage 보안이 검증됐다고 판단하기.
- 금융 이력 삭제나 테이블 DROP을 롤백 전략으로 삼기.

## 10. 다음 담당자에게 전달할 짧은 문구

> 장바구니 계획은 `docs/cart-implementation-plan.md` v3이며 독립 R2 PLAN PASS 상태입니다. 아직 UI/API/신규 DB/RPC 구현은 하지 않았습니다. `docs/cart-handoff.md`와 최종 검증 기록을 먼저 읽고 기존 dirty 변경을 보존하세요. 구현은 Phase 0 실제 DB catalog·권한·함수·Storage·잠금 기준선 검증부터 시작하며, 통과 전에는 DDL을 적용하지 마세요. 단건 API 반복 호출이 아니라 한 DB 트랜잭션으로 크레딧 차감·개별 주문/권한·선택 cart 삭제를 처리하고, 각 Phase를 검증 통과 후 다음 단계로 진행해야 합니다.
