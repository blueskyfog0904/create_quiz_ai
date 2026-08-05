# 토스페이먼츠 포인트 충전 가맹점 심사 대응 구현 계획

## 1. 문서 목적

이 문서는 실제 운영 사이트의 크레딧 충전·사용·환불 흐름을 토스페이먼츠 가맹점 심사 요청사항에 맞게 보완하기 위한 구현 계획이다.

- 대상은 `/preview`가 아닌 실제 운영 라우트다.
- 크레딧은 심사 문구에서 `크레딧(충전형 포인트)`로 함께 표기한다.
- 약관 문구만 바꾸지 않고 1회 충전 한도, 1년 유효기간, 원 결제수단 환불을 서버와 DB에서도 강제한다.
- 결제·환불·원장 변경은 테스트를 먼저 추가하고 `계획 확인 → 구현 → 검증 → 실패 원인 분석 → 최소 수정 → 재검증` 순서로 진행한다.
- Docker는 사용하지 않는다.
- 본 계획은 기술 구현 계획이며 최종 약관 문구와 환불 기준은 토스페이먼츠 담당자 또는 법률 검토를 거쳐 확정한다.

## 2. 사용자 요청사항을 구현 계약으로 변환

| 심사 요청 | 구현 계약 |
| --- | --- |
| 충전 포인트 환불정책 표시 | `/terms/refund`를 크레딧 이용·환불 정책의 단일 기준 문서로 보강하고 `/pricing`, `/checkout`, `/mypage/credits`, 전역 푸터에서 연결한다. |
| 원 결제수단 환불 | 관리자 환불 승인 시 Toss 결제 취소 API가 성공한 뒤에만 내부 결제와 크레딧 원장을 환불 완료로 확정한다. |
| 충전 경로와 사용 경로 표시 | `/pricing`과 `/terms/refund`에 충전 단계와 실제 사용처를 명시하고, 심사 제출용 경로·스크린샷 목록을 만든다. |
| 1회 충전 10만원 제한 | 관리자 상품 입력, 서버 주문 생성, 결제 승인, DB 제약에서 모두 `100,000원 이하`를 강제한다. |
| 이용기간·환불가능기간 1년 이내 | 유상 구매 source에 결제 승인 시점부터 `interval '1 year'` 만료일을 저장하고 소비·잔액·환불 판정에서 만료를 강제한다. 약관에는 심사 요청 문장을 명시한다. |
| 사용자 간 양도 불가 | 약관·결제 화면에 명시하고 크레딧 source를 구매 계정에 귀속한다. 사용자 간 이전 API는 만들지 않는다. |
| 결제수단 제한 | 전용 Toss 결제위젯 `variantKey`와 MID 계약에서 허용 수단만 노출하고, 승인 응답을 서버가 재검증한다. |
| 일부 카드사 제한 및 하나카드 불가 | Toss 계약/MID에서 예방 차단하고, 서버는 승인 결과의 카드사 정보를 감사한다. 간편결제에 등록된 하나카드까지 차단되는지는 Toss의 서면 확인을 받는다. |
| 보증보험·월 정산한도 | 코드 작업이 아닌 입점 운영 작업으로 분리하고, 사용자가 월 정산한도를 확정한 뒤 보증보험 절차를 진행한다. |

## 3. 정책 해석과 구현 전 확정사항

### 3.1 권장 정책

- 충전 크레딧의 사용기한은 결제 승인 시점부터 1년으로 한다.
- 환불 요청은 현재 정책을 유지해 `결제 후 7일 이내 + 해당 충전 건 완전 미사용`일 때만 허용한다.
- 7일 정책은 1년보다 짧으므로 “환불가능기간은 결제시점부터 1년 이내”라는 상한을 충족한다. 다만 토스 담당자가 실제 1년 환불 접수를 요구하는지는 구현 전에 서면 확인한다.
- 환불 완료는 관리자의 내부 승인 시점이 아니라 Toss 취소 성공과 내부 원장 확정이 모두 끝난 시점으로 정의한다.
- 계좌이체와 가상계좌는 제외한다. 서비스 제공기간이 1년이므로 가상계좌를 제외하면 별도 환불계좌 수집·보관 범위를 만들 필요가 없다.

### 3.2 구현 전 사용자 결정이 필요한 항목

1. 기존 유상 크레딧도 `purchased_at + 1년`으로 즉시 소급할지, 별도 유예기간을 줄지
2. 현재 `7일 이내 완전 미사용` 환불 기준을 유지할지
3. 희망 월 정산한도와 보증보험 가입 금액
4. 최종 결제수단을 `신용·체크카드 + 카카오페이·네이버페이·페이코·토스페이`로 확정할지
5. 간편결제의 연결 계좌·머니까지 금지 대상인지, 최상위 계좌이체 결제수단만 금지 대상인지
6. Toss가 비회원 결제 경로를 별도로 요구하는지 여부와, 요구 시 게스트 구매를 허용할지 서면 예외를 받을지
7. 기존 `test`·결제 연결이 없는 source를 삭제·동결·관리자 지급으로 재분류할지
8. 유상·무상 source가 함께 있을 때의 소비 순서. 기술 권고 기본값은 `expires_at ASC NULLS LAST, purchased_at ASC, id ASC`로 만료가 가까운 source를 먼저 쓰는 방식이지만 사업 정책으로 확정한다.

## 4. 현재 구조 분석 결과

### 4.1 이미 존재하는 운영 화면

- 충전 상품: `src/app/pricing`
- 결제: `src/app/checkout`, `src/app/checkout/success`, `src/app/checkout/fail`
- 크레딧·환불 요청: `src/app/(dashboard)/mypage/credits`
- 결제 내역: `src/app/(dashboard)/mypage/payments`
- 약관: `src/app/terms/[documentSlug]`
- 약관·사업자정보 관리자: `src/app/(admin)/admin/footer`
- 환불 관리자: `src/app/(admin)/admin/refunds`
- 상품 관리자: `src/app/(admin)/admin/pricing`

### 4.2 재사용할 현재 기능

- `/pricing`에는 1년 사용기한, 양도 불가, 7일 이내 완전 미사용 환불, 원 결제수단 환불 요약이 이미 일부 있다.
- `/terms/service`, `/terms/refund`는 `system_settings.site_footer_content`의 운영 데이터를 읽는다.
- `/admin/footer`에서 약관과 사업자정보를 편집하고 관련 경로를 revalidate하는 기존 패턴이 있다.
- `credit_sources.expires_at` 컬럼과 FIFO 소비 RPC의 기본 골격이 있다.
- 마이페이지에는 충전 source, 거래내역, 환불 요청 UI가 있고 관리자는 환불 요청을 조회·승인·거부할 수 있다.

### 4.3 심사 제출 전 반드시 막아야 할 위험

1. `POST /api/credits/purchase`는 인증 사용자에게 Toss 결제 없이 테스트 크레딧을 지급할 수 있다.
2. 일반 사용자가 자신의 `profiles.credits`, `credit_sources`, `payment_history`, `credit_transactions`를 직접 변경할 수 있는 RLS·RPC 경로가 남아 있다.
3. `POST /api/credits/deduct`는 인증 사용자가 임의의 amount·resourceType·resourceId·description을 제출하는 범용 차감 경계라서 도메인별 서버 검증을 우회할 수 있다.
4. 결제 승인 후 크레딧 지급이 여러 개의 독립 DB 요청으로 처리되어 부분 실패와 중복 지급을 막지 못한다.
5. `payment_history.order_id`는 현재 코드에서 갱신하지만 저장소 migration과 생성 타입에는 없다.
6. `payment_key`와 `order_id`의 고유 제약과 결제 승인 멱등성이 없다.
7. 크레딧 지급 실패 시 Toss 승인 취소가 TODO로 남아 있다.
8. 관리자 환불 승인은 Toss 취소 API를 호출하지 않고 내부 상태만 `refunded`로 바꾼다.
9. `expires_at`은 구매·소비·잔액·환불 판정에서 사용되지 않는다.
10. 결제위젯은 `DEFAULT` 설정을 사용하므로 실제 허용 결제수단을 코드만으로 보장할 수 없다.
11. 초기 `user_credits`·구형 `credit_transactions`와 후속 `credit_sources`·신형 transaction migration 사이에 `CREATE TABLE IF NOT EXISTS` 기반 schema drift 가능성이 있어, 빈 DB와 운영 유사 DB의 최종 모양이 다를 수 있다.

## 5. 목표 아키텍처

### 5.1 결제 상태 모델

`payment_history`는 사용자 결제내역 화면의 완료 이력으로 유지하고, 결제 전부터 실패·재처리 상태까지 소유하는 `payment_orders`를 추가한다.

필수 필드:

- `id`, `user_id`, `order_id`
- `plan_id`, `plan_name_snapshot`, `expected_amount`, `expected_credits`
- `provider`, `environment`, `mid`
- `payment_key`, `provider_method`, `provider_status`
- `status`: `ready`, `confirming`, `fulfillment_pending`, `completed`, `cancel_pending`, `refunded`, `failed`, `manual_review`
- 영속 `confirm_idempotency_key`, `cancel_idempotency_key`
- `failure_code`, `failure_message`
- `expires_at`, `approved_at`, `fulfilled_at`, `canceled_at`, timestamps

제약:

- `order_id` UNIQUE
- non-null `payment_key` UNIQUE
- `expected_amount BETWEEN 1 AND 100000`
- 완료 주문과 `credit_sources`·`payment_history`는 각각 1:1

별도 범용 operation 테이블은 첫 구현에서 만들지 않는다. 승인과 전액 취소가 각각 1회인 현재 요구는 `payment_orders`와 `refund_requests`의 고정 멱등키·상태·재시도 필드로 처리한다.

### 5.2 크레딧 원장

- 유상 충전은 service role 전용 `finalize_toss_payment` RPC 한 번으로 source, payment history, transaction, profile cache, order 상태를 같이 확정한다.
- 유상 source의 `expires_at`은 Toss `approvedAt + interval '1 year'`로 저장한다.
- 소비 RPC는 `status = active`, `remaining_credits > 0`, `(expires_at IS NULL OR expires_at > DB now())`인 source만 대상으로 한다.
- 소비 순서는 Phase 0에서 확정된 사업 정책을 적용한다. 권고 기본값을 채택하면 `expires_at ASC NULLS LAST, purchased_at ASC, id ASC`로 차감한다.
- 표시 잔액과 부족 판정은 `profiles.credits`가 아니라 유효 source 합계를 기준으로 한다.
- `profiles.credits`는 호환용 cache로만 유지하고 mutation RPC 종료 시 원장 합으로 갱신한다.
- 만료 source는 행을 즉시 삭제하거나 잔액을 0으로 덮지 않고 유효 상태를 조회 시점에 파생한다. 첫 단계에는 scheduler를 추가하지 않는다.

### 5.3 환불 상태 모델

`refund_requests`를 다음 상태로 확장한다.

- `pending_review`
- `processing`
- `completed`
- `rejected`
- `retryable_failed`
- `manual_review`

추가 필드:

- `payment_order_id`, `refund_amount`
- `cancel_idempotency_key`
- `provider_cancel_transaction_key`
- `provider_cancelled_at`
- `attempt_count`, `next_attempt_at`
- `last_error_code`, `last_error_message`

환불 흐름:

1. 사용자가 환불을 요청하면 DB RPC가 source·order를 잠근다.
2. 유상 Toss 결제, 완전 미사용, 7일 경계, 미만료, 중복 요청 여부를 DB 시각으로 재검증한다.
3. source를 `pending_refund`로 동결하고 요청을 원자적으로 만든다.
4. 관리자가 승인하면 요청을 조건부로 `processing` 상태로 선점한다.
5. 서버가 저장된 `payment_key`와 고정 멱등키로 Toss 전액 취소를 호출한다.
6. Toss 응답의 취소 완료와 거래키를 확인한 뒤 DB RPC가 source, order, payment history, transaction, profile cache, refund request를 한 번에 확정한다.
7. Toss 성공 후 DB 확정이 실패하면 source를 동결 상태로 유지하고 재처리·대사가 동일 취소 결과를 조회해 로컬 확정만 반복한다.
8. 사용자 완료 알림은 6단계가 끝난 뒤에만 보낸다.

## 6. 단계별 구현 계획과 검증 loop

각 Phase는 아래 공통 loop를 따른다.

1. Phase 시작 시 `git status --short`와 대상 파일 diff를 저장하고, 이번 Phase의 수정 허용 파일·담당 ownership을 명시한다.
2. 허용 목록 밖 기존 modified/untracked 파일은 수정·복원·삭제하지 않고, `git reset --hard`, `git checkout --`, `git clean`과 자동 commit을 사용하지 않는다.
3. 수정 허용 파일이 이미 dirty이거나 다른 작업자의 ownership이면 덮어쓰지 않고 coordinator와 변경 범위를 조율한다. 안전하게 병합할 수 없으면 해당 Phase를 중단한다.
4. 해당 Phase의 계획과 검증 기준을 다시 확인한다.
5. 재현 테스트 또는 실패 계약을 먼저 추가해 실패를 확인한다.
6. 필요한 최소 코드만 구현한다.
7. 대상 테스트, ESLint, TypeScript, diff check를 실행한다.
8. 종료 시 `git status --short`, `git diff --name-only`, `git diff --check`를 실행하고 최초 기록과 대조해 기존 사용자·병렬 작업 변경이 보존됐는지 확인한다. 허용 목록 밖 변경이 새로 생기면 해당 Phase는 FAIL이다.
9. 독립 검증자가 요구사항·보안·회귀를 PASS/FAIL로 판정한다.
10. FAIL이면 원인을 기록하고 최소 수정 후 동일 검증을 반복한다.
11. PASS일 때만 다음 Phase로 이동한다.

### Phase 0. 운영 차단과 정책 확정

구현:

- 운영에서 `/api/credits/purchase`를 제거하거나 항상 404/410으로 차단한다.
- 범용 `/api/credits/deduct`는 도메인별 차감 경계 이관 후 제거하거나 항상 404/410으로 차단한다.
- 결제 기능 kill switch를 추가하고 기본값을 OFF로 둔 상태에서 후속 migration을 적용한다.
- test/live Toss 키 prefix와 MID가 섞이면 서버가 시작 또는 결제 준비를 거부하도록 fail-closed한다.
- 현재 유료 source, test source, payment 없는 source, 중복 payment key, 원장·cache 불일치를 읽기 전용 감사한다.
- 빈 disposable remote DB와 운영 구조를 복제한 disposable remote DB 양쪽에서 전체 migration을 재생해 `user_credits`, `profiles.credits`, `credit_sources`, 구형·신형 `credit_transactions`의 최종 schema drift를 비교한다.
- 세 잔액 표현과 transaction schema를 하나의 canonical 원장 계약으로 정규화하는 additive migration을 먼저 설계하고, 운영 데이터 분류표와 합계 대조가 통과하기 전에는 legacy 컬럼·테이블을 삭제하지 않는다.
- 사용자 결정 1~8과 비회원 결제 허용 또는 Toss 서면 예외를 기록하기 전에는 kill switch를 켜지 않는다.
- 권한 철회 전에 모든 정상 mutation 호출 지점을 분류한다.
  - AI 생성·문제은행·문제마켓 소비와 보상은 서버가 인증 사용자·목적·금액을 검증한 뒤 호출하는 좁은 service-role RPC 또는 고정 `search_path`의 최소 권한 `SECURITY DEFINER` RPC로 먼저 이관한다.
  - 이메일 가입, 카카오 가입·동기화, 마이페이지 전화번호 수정을 포함한 프로필 mutation은 사용자가 바꿀 수 있는 필드만 Zod allowlist로 받는 인증 서버 경계로 먼저 이관한다.
  - 신규 RPC는 임의 user ID, 임의 금액, 임의 source를 클라이언트가 지정할 수 없게 하고 service role 또는 필요한 정확한 role에만 EXECUTE를 부여한다.
- 정상 호출 지점 이관과 회귀 검증이 끝난 뒤에만 일반 사용자의 원장·결제·`profiles.credits` 직접 쓰기 RLS·GRANT를 철회한다.
- 정상 환불 경로가 새 요청·관리자 처리 흐름을 사용함을 확인한 뒤에만 기존 `refund_credits`의 authenticated EXECUTE를 철회한다.

검증:

- 일반 사용자의 테스트 구매, 직접 source 생성, 잔액 수정, payment/transaction 삽입, 임의 refund RPC가 모두 거부된다.
- 권한 철회 전후에 이메일 가입, 카카오 가입·동기화, 마이페이지 전화번호 수정과 기존 AI·문제은행·문제마켓 크레딧 소비·보상 계약 테스트가 모두 통과한다.
- 기존 authenticated RPC 또는 broad profile update 권한을 먼저 철회하면 실패하는 RED 테스트를 두고, 대체 서버 경계 이관 후에만 권한 철회 migration을 적용한다.
- 비회원 결제 경로를 구현할지 회원 전용 예외를 받을지가 책임자·결정일·문서 경로와 함께 확정되지 않으면 Phase 0을 PASS 처리하거나 다음 Phase로 진행하지 않고 kill switch를 OFF로 유지한다. Toss가 비회원 경로를 요구하면 별도 사용자 승인 계획 전까지 blocker로 처리한다.
- 감사 결과는 자동 삭제하지 않고 분류표로 남긴다.

### Phase 1. 주문·한도·멱등성 스키마

구현:

- `payment_orders`와 필요한 RLS·인덱스·CHECK·UNIQUE를 additive migration으로 추가한다.
- `payment_history`에 `order_id`, provider 식별과 필요한 FK를 추가한다.
- `pricing_plans.price`와 `payment_history.amount`에 100,000원 상한을 적용한다.
- 기존 고액·중복 데이터 감사 후 `NOT VALID → 정리 → VALIDATE` 순서로 제약을 올린다.
- 기존 `payment_key` 보유 건은 Toss 조회 API 결과로 확인된 provider order ID, MID, environment, status만 backfill한다. order ID를 추정하거나 새로 만들지 않는다.
- keyless 또는 결제와 연결되지 않는 기존 건은 `legacy_unverified`로 격리해 자동 환불·자동 원장 보정 대상에서 제외한다.
- `refund_requests` 상태·취소 멱등키·provider 결과 필드를 확장한다.
- 생성 타입을 원격 schema에서 다시 생성한다.

검증:

- 100,001원 상품·주문·결제 이력 write와 중복 `order_id`·`payment_key`가 DB에서 거부된다.
- 기존 이력은 유실되지 않고 마이페이지 결제내역을 계속 렌더링한다.
- 빈 disposable remote Supabase project에 Docker 없이 migration 전체를 순서대로 적용하고 generated type diff를 확인한다.

### Phase 2. 결제 준비·승인·정확히 한 번 지급

구현:

- `POST /api/payments/orders`에서 로그인 사용자와 활성 충전 상품을 서버가 조회하고 10만원 상한을 검증한 뒤 주문 스냅샷을 생성한다.
- checkout은 클라이언트에서 임의 orderId를 만들지 않고 서버 주문의 `order_id`와 `expected_amount`만 위젯에 전달한다.
- confirm API는 Zod로 입력을 제한하고 사용자 소유 주문, 만료, 상태, 금액을 Toss 호출 전에 검증한다.
- 저장된 승인 멱등키로 Toss confirm을 호출한다.
- Toss 응답의 `orderId`, `totalAmount`, `currency = KRW`, `status = DONE`, MID, 결제수단을 주문과 대조한다.
- 승인 응답에서 계약상 허용되지 않은 결제수단·카드사가 확인되면 크레딧을 지급하지 않고 고정 멱등키로 즉시 전액 취소한다. 취소 결과가 불명확하거나 실패하면 `manual_review`로 격리한다.
- `DONE`만 크레딧을 지급한다. `WAITING_FOR_DEPOSIT`은 지급하지 않는다.
- `finalize_toss_payment` RPC가 source, transaction, payment history, profile cache, order 완료를 한 transaction으로 확정한다.
- 동일 payload 재호출은 저장된 완료 결과를 200으로 반환하고, 다른 payload나 처리 중 충돌은 409로 반환한다.
- 승인 성공 후 로컬 지급 실패는 `fulfillment_pending`으로 남기고, 안전한 경우 같은 승인 조회 결과로 로컬 확정을 재시도한다. 지급 불가능 상태면 고정 취소 멱등키로 자동 취소하고 `manual_review` 경보를 남긴다.

검증:

- 타인 주문, 금액 변조, 상품 변경, 만료 주문은 Toss 네트워크 호출 전에 거부된다.
- 성공 URL 새로고침, 더블클릭, 병렬 confirm에서도 Toss 논리 승인·source·purchase transaction·잔액 증가가 각각 한 번이다.
- 승인 후 DB fault를 주입해도 재호출 또는 대사로 한 번만 지급되거나 한 번만 취소된다.
- confirm 요청·응답 원문과 secret·payment key는 사용자 응답과 일반 로그에 노출하지 않는다.

### Phase 3. 1년 유효기간과 유효 잔액

구현:

- 신규 결제 source에 Toss 승인 시각 기준 1년 만료일을 설정한다.
- 기존 유상 source는 확정된 소급 정책으로 idempotent backfill한다.
- 소비 RPC의 부족 판정과 대상에서 만료 source를 제외하되, `expires_at IS NULL`인 무상·관리자 지급 source는 유효 대상으로 유지한다.
- 정렬은 Phase 0에서 확정한 소비 순서만 사용한다. 권고 기본값 채택 시 `expires_at ASC NULLS LAST, purchased_at ASC, id ASC`를 RPC와 모든 잔액 계산에 동일하게 적용한다.
- DB now 기준 원장 잔액, 사용 가능 잔액, 만료 잔액, 다음 만료일을 반환하는 snapshot RPC를 추가한다.
- `src/lib/credit-balance.ts`, `CreditService.getBalance`, `/pricing`, 헤더, 마이페이지가 유효 원장 잔액을 사용하도록 통일한다.
- 보상 크레딧을 원 source에 복구해도 기존 만료일은 연장하지 않는다.

검증:

- `expires_at = now()` 경계에서 사용이 거부된다.
- 만료 source를 건너뛰고, 확정된 소비 순서에 따라 안정적으로 소비한다.
- `expires_at IS NULL`인 무상 source, 서로 다른 만료일, 동일 만료일·구매시각의 `id` tie-break를 포함한 순서 테스트를 통과한다.
- 시간이 지나 만료되어도 사용자 잔액과 결제·source 화면이 서로 모순되지 않는다.
- 만료 source 보상, pending refund, 동시 소비를 포함한 DB 동시성 테스트를 통과한다.

### Phase 4. 실제 원 결제수단 환불

구현:

- 환불 요청을 DB RPC 하나로 원자화하고 open 요청에 partial UNIQUE를 둔다.
- client의 7일 계산을 제거하고 서버가 `refundableUntil`, 가능 여부와 사유를 반환한다.
- 관리자 환불 승인 API가 요청을 선점하고 Toss `POST /v1/payments/{paymentKey}/cancel`을 호출한다.
- 전액 취소이므로 `cancelAmount`는 생략하고 `cancelReason`과 고정 `Idempotency-Key`를 보낸다.
- 취소 결과의 provider 상태, `balanceAmount = 0`, cancel status와 transaction key를 저장한다.
- DB 최종화 RPC가 실제 취소 성공 뒤에만 내부 상태와 잔액을 환불 완료로 바꾼다.
- timeout·5xx·409는 같은 멱등키로 재시도하고, 확정 4xx는 무한 재시도하지 않고 Toss 조회 후 `manual_review`로 보낸다.

검증:

- 사용한 source, 7일 초과, 만료, 비유상·test·관리자 지급 source는 환불 요청이 거부된다.
- 사용자와 관리자 병렬 요청에서도 요청과 취소가 각각 한 번만 처리된다.
- Toss 성공·DB 실패, 응답 유실, 중복 승인, 이미 취소된 결제를 fault injection으로 검증한다.
- Toss가 취소되지 않은 요청을 UI가 `환불 완료`로 표시하지 않는다.

### Phase 5. 웹훅·재처리·대사

구현:

- `/api/payments/webhooks/toss`와 최소 `payment_webhook_events` dedupe 테이블을 추가한다.
- 웹훅은 중복 전송 ID를 저장하고 10초 안에 durable 수신 결과를 반환한다.
- 일반 결제 웹훅 본문만 신뢰하지 않고 저장된 payment key로 Toss 조회 API를 호출해 상태를 확인한다.
- `PAYMENT_STATUS_CHANGED`를 기준으로 누락된 지급·취소 상태를 수렴시킨다.
- 보호된 내부 reconcile job이 오래된 `confirming`, `fulfillment_pending`, `cancel_pending`, `retryable_failed`를 조회·복구한다.
- provider DONE/CANCELED와 로컬 completed/refunded의 불일치를 관리자 경보로 보낸다.

검증:

- 중복·순서 역전 웹훅이 중복 지급·환불을 만들지 않는다.
- 웹훅 누락 상태를 reconcile job이 복구한다.
- 금액·사용자·주문 소유권 모순은 자동 변경하지 않고 `manual_review`로 격리한다.

### Phase 6. 운영 UI·약관·관리자

구현:

- `/pricing`
  - 제목과 버튼을 `요금제/구매`보다 `크레딧 충전 상품/충전` 중심으로 변경한다.
  - 월 구독·자동결제가 아닌 1회 충전임을 표시한다.
  - 10만원 상한, 1년, 양도 불가, 7일 완전 미사용 환불, 원 결제수단 환불을 요약한다.
  - 실제 사용처와 `/terms/refund` 링크를 제공한다.
- `/checkout`
  - 주문 정보에 1회 충전, 자동결제 없음, 10만원, 1년, 양도 불가, 환불 요약을 표시한다.
  - 지원·미지원 결제수단과 환불정책 링크를 결제 전에 확인할 수 있게 한다.
  - 결제수단과 약관 `variantKey`를 환경별 명시 설정으로 사용한다.
- `/mypage/credits`
  - source별 충전일, 만료일, 환불 신청 마감, 유효·임박·만료 상태와 서버 판정 사유를 표시한다.
  - 충전 경로, 사용 경로, 결제내역, 환불정책 링크를 제공한다.
- `/mypage/payments`
  - 주문번호, 결제금액, 실제 결제수단, provider 상태, 환불 상태를 일관되게 표시한다.
- `/terms/service`, `/terms/refund`
  - “충전된 포인트의 이용기간과 환불가능기간은 결제시점으로부터 1년 이내로 제한됩니다.”를 명시한다.
  - 7일 완전 미사용 세부 기준, 원 결제수단 환불, 양도 불가, 10만원, 지원·제한 결제수단을 구분한다.
  - 충전 경로와 실제 사용 경로를 단계별로 명시한다.
  - 문제마켓 구매 취소는 현금 환불이 아니라 사용한 크레딧 source로 복구되는 별도 정책임을 구분한다.
- `/admin/pricing`
  - 가격을 정수 1원 이상 100,000원 이하로 Zod 검증하고 폼에도 동일 안내를 제공한다.
- `/admin/refunds`
  - Toss 처리 상태, transaction key, 재시도·수동 검토 사유를 표시한다.
- 운영 약관은 코드 기본값만 바꾸지 않고 현재 `system_settings.site_footer_content` 행도 관리자 저장 또는 안전한 일회성 migration으로 갱신한다.

UI 검증:

- 기존 shadcn·Studio 패턴을 재사용하고 새 공통 abstraction을 만들지 않는다.
- 1200px, 768px, 320px에서 overflow 없이 핵심 정책과 결제 행동을 확인한다.
- 모든 버튼·링크는 44px hit area, visible focus, keyboard 조작을 제공한다.
- loading, processing, retry, completed, error 상태를 색상 외 텍스트로 구분한다.

### Phase 7. Toss 계약·결제위젯 운영 설정

운영 작업:

- 포인트 충전 전용 결제 UI와 `variantKey`를 만든다.
- 카드와 허용된 네 간편결제만 활성화한다.
- 계좌이체, 가상계좌, 휴대폰, 상품권, 해외결제 등 미허용 수단은 비활성화한다.
- 하나카드는 카드사 목록과 MID 계약에서 차단한다.
- 허용 간편결제에 연결된 하나카드·계좌·머니까지 PG 레벨에서 차단되는지 Toss에 서면 확인한다.
- live client/secret key, MID, variantKey가 같은 계약 세트인지 확인한다.
- 희망 월 정산한도를 확정하고 보증보험 가입 증빙을 준비한다.

검증:

- PC·모바일 결제위젯에 허용 수단만 보인다.
- test 환경에서 가능한 수단을 검증하고, test가 지원되지 않는 수단은 승인된 통제 live 소액 결제 후 즉시 취소한다.
- 결제위젯 어드민의 MID·결제수단·카드사 설정 화면을 내부 감사 증빙으로 보관한다.

### Phase 8. 심사 증빙과 점진 배포

외부 심사 증빙:

1. `/pricing`: 충전 상품, 금액, 사용처, 정책 링크, 푸터 사업자정보
2. `/terms/service`: 크레딧 정의와 이용기간
3. `/terms/refund`: 10만원, 1년, 양도 불가, 원수단 환불, 결제수단 제한
4. `/checkout?planId=...`: 충전량, 주문금액, 결제수단, 약관
5. `/mypage/credits`: 충전 source, 만료일, 환불 가능 여부, 사용내역
6. `/mypage/payments`: 결제금액, 실제 결제수단, 상태
7. AI 문제 생성·문제은행 가져오기·문제마켓 구매의 크레딧 사용 화면

제출 파일에는 URL, 로그인 필요 여부, 이동 단계, 캡처일, 테스트 계정을 표로 정리한다.

추가 심사 gate:

- 비회원 결제가 필수라는 Toss 확인을 받으면 게스트 주문·결제·환불 식별 설계를 별도 승인받아 구현하고, 회원 전용을 유지하면 Toss의 서면 예외를 증빙에 첨부한다.
- 전역 푸터에서 상호, 사업자등록번호, 대표자, 주소, 고객센터 전화번호가 실제 운영 `system_settings.site_footer_content` 값으로 렌더링되는지 DOM과 스크린샷으로 확인한다.
- 약관·푸터의 코드 기본값만 확인하지 않고 운영 DB 저장값을 재조회해 공개 페이지 표시와 일치하는지 확인한다.

배포:

- 기능 flag OFF 상태로 schema와 읽기 경로를 먼저 배포한다.
- disposable remote Supabase와 Toss test 환경에서 전체 E2E를 통과한다.
- 운영 내부 계정으로 최저 금액 실제 결제 1건과 즉시 전액 취소를 수행한다.
- provider와 내부 주문·원장 대사 불일치가 0인지 확인한 뒤 신규 결제를 단계적으로 활성화한다.
- 불일치 1건, 중복 지급, 환불 미완료가 발생하면 즉시 신규 결제를 OFF하고 runbook으로 복구한다.

## 7. API 응답 계약

- `401`: prepare·confirm·환불 요청 미로그인
- `403` 또는 외부 `404`: 타인 주문·source 접근, 일반 사용자의 관리자 처리
- `400`: 잘못된 형식, 비활성 상품, 100,000원 초과, 주문 스냅샷과 amount 불일치, 확정적 provider 요청 오류
- `409`: 같은 주문의 다른 payload, 처리 중 승인·취소, 이미 환불된 주문, 중복 open 환불 요청
- `201`: 결제 주문 준비, 환불 요청 생성
- `200`: 최초 승인 완료, 동일 승인 replay, 실제 환불 완료
- `202`: provider 결과는 성공했지만 로컬 재처리가 필요한 비동기 처리 상태를 채택할 경우에만 사용

외부 응답에는 Toss 원문 payload, secret, 내부 스택, 전체 payment key를 포함하지 않는다. 모든 작업은 내부 주문 ID와 correlation ID로 추적한다.

## 8. 예상 수정 파일

기존 파일:

- `src/app/pricing/page.tsx`
- `src/app/pricing/pricing-client.tsx`
- `src/app/checkout/page.tsx`
- `src/app/checkout/checkout-client.tsx`
- `src/app/checkout/success/page.tsx`
- `src/app/api/payments/confirm/route.ts`
- `src/app/api/credits/purchase/route.ts`
- `src/app/api/credits/deduct/route.ts`
- `src/app/api/refunds/request/route.ts`
- `src/app/api/admin/refunds/route.ts`
- `src/app/(dashboard)/mypage/credits/page.tsx`
- `src/app/(dashboard)/mypage/credits/credits-client.tsx`
- `src/app/(dashboard)/mypage/payments/page.tsx`
- `src/app/(dashboard)/mypage/payments/payment-list.tsx`
- `src/app/(dashboard)/mypage/profile/profile-client.tsx`
- `src/app/(auth)/signup/page.tsx`
- `src/app/(admin)/admin/pricing/actions.ts`
- `src/app/(admin)/admin/pricing/components/pricing-plan-dialog.tsx`
- `src/app/(admin)/admin/refunds/refunds-client.tsx`
- `src/lib/credits.ts`
- `src/lib/credit-balance.ts`
- `src/lib/footer-content.ts`
- `src/lib/footer-content-server.ts`
- `src/types/supabase.ts`

신규 후보:

- `src/lib/credit-policy.ts`
- `src/lib/toss-payments.ts`
- `src/app/api/payments/orders/route.ts`
- `src/app/api/payments/webhooks/toss/route.ts`
- `src/app/api/internal/payments/reconcile/route.ts`
- 관련 Supabase migration과 pgTAP·Node 계약 테스트

`src/lib/toss-payments.ts`는 confirm, cancel, query, reconcile 네 consumer가 생기므로 공통 서버 모듈로 분리할 근거가 있다. UI 공통 컴포넌트는 두 consumer가 확인되기 전 만들지 않는다.

## 9. Docker 없는 검증 전략

### 9.1 정적·로컬 검증

- 신규·관련 Node 계약 테스트
- 대상 파일 ESLint
- `npx tsc --noEmit --incremental false --pretty false`
- `git diff --check`
- `npm run build`
- 전체 `npm run lint` 실패 시 이번 변경과 기존 unrelated 실패를 분리 보고

### 9.2 DB·RLS·동시성 검증

- Docker 대신 disposable remote Supabase project 또는 branch에 migration을 적용한다.
- 원격 빈 DB migration replay와 generated types 재생성을 확인한다.
- anon, authenticated 본인, authenticated 타인, admin, service role의 RLS·RPC 권한 행렬을 실행한다.
- 병렬 confirm, consume, 환불 요청, 관리자 승인에 Promise 기반 동시성 테스트를 수행한다.
- 테스트 데이터는 별도 프로젝트에서 만들고 운영 데이터는 읽기 감사만 한다.

### 9.3 Toss 검증

- staging URL과 Toss test key/MID/variantKey를 사용한다.
- 카드 승인, 사용자 취소, 승인 오류, timeout, 중복 승인, 성공 URL 새로고침, 전액 취소, 중복 취소를 검증한다.
- 웹훅은 공개 staging HTTPS URL에 등록한다.
- provider 대시보드의 주문·결제·취소 상태와 내부 order·source·transaction을 대조한다.
- test가 지원되지 않는 결제수단의 live 소액 검증은 사용자 승인 후 수행하고 즉시 취소한다.

## 10. 최종 PASS 기준

다음 조건을 모두 만족해야 심사 제출 준비 완료로 판단한다.

- 운영 무결제 테스트 충전 경로가 차단되어 있다.
- 일반 사용자가 DB·RPC로 크레딧과 결제 상태를 직접 조작할 수 없다.
- 100,001원 충전이 UI·API·DB 모든 경계에서 거부된다.
- 유상 크레딧이 승인 시점부터 1년 후 소비·잔액에서 제외된다.
- 동일 결제 승인 재시도에서 크레딧이 정확히 한 번만 지급된다.
- Toss 취소 성공 전에는 환불 완료가 되지 않는다.
- 동일 환불 승인 재시도에서 provider 취소와 내부 차감이 정확히 한 번만 처리된다.
- 결제수단은 계약된 전용 variant와 MID에서 허용 범위만 노출된다.
- 실제 약관 운영 데이터와 화면 문구가 서버 동작과 일치한다.
- 충전 경로와 실제 사용 경로를 공개 화면에서 확인할 수 있다.
- Toss test 결제·취소와 내부 원장 대사 결과가 일치한다.
- 관련 테스트, 대상 ESLint, TypeScript, build, 접근성·반응형 검증이 통과한다.
- 독립 검증자가 계획 및 구현을 PASS로 판정한다.

## 11. 공식 참고자료

- Toss 결제 승인·조회·취소 API: https://docs.tosspayments.com/reference
- Toss 멱등키: https://docs.tosspayments.com/reference/using-api/authorization
- Toss 결제 취소: https://docs.tosspayments.com/guides/v2/cancel-payment
- Toss 결제위젯 관리자 설정: https://docs.tosspayments.com/guides/v2/payment-widget/admin
- Toss 웹훅: https://docs.tosspayments.com/guides/v2/webhook
