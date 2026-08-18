# 크레딧 충전 결제 운영 런북

## 1. 목적과 적용 범위

이 문서는 실제 사이트의 `크레딧(충전형 포인트)` 결제를 운영하기 위한 배포·설정·장애 대응 절차다.

- 결제 기능은 전역 `PAYMENTS_ENABLED=true`, provider 환경변수, DB runtime flag가 모두 허용할 때만 신규 주문을 받는다.
- schema, 약관, Toss·KakaoPay 계약, 결제수단, 웹훅과 대사 작업을 모두 확인하기 전에는 해당 provider를 켜지 않는다.
- secret, payment key, 웹훅 token은 문서·스크린샷·일반 로그에 기록하지 않는다.
- live 환경에서의 결제·취소는 별도 승인된 담당자만 수행한다.

## 2. 배포 전 차단 조건

아래 항목 중 하나라도 미확정이면 `PAYMENTS_ENABLED`를 `false`로 유지한다.

1. 기존 유상 크레딧의 1년 만료 소급 또는 유예 정책
2. `결제 후 7일 이내 + 완전 미사용` 환불 정책의 최종 승인
3. 희망 월 정산한도와 보증보험 가입
4. 카카오페이를 제외하고 카드·네이버페이·페이코·토스페이만 허용하는 Toss 일반결제 전용 variant 설정
5. 하나카드와 미허용 결제수단의 PG 수준 차단 확인
6. 간편결제에 연결된 계좌·머니·하나카드의 허용 여부에 관한 Toss 서면 답변
7. 회원 전용 결제 유지에 관한 Toss 확인 또는 비회원 결제 요구사항
8. 운영 사업자정보, 고객센터, 이용약관과 환불정책의 최종 검수
9. KakaoPay 온라인 결제 승인, test Ready·Approve·Order·Cancel E2E와 `MONEY` 전용 계약 확인

## 3. 필요한 환경 변수

변수 값은 배포 환경의 secret 저장소에서 관리한다.

| 환경 변수 | 용도 | 필수 시점 |
| --- | --- | --- |
| `PAYMENTS_ENABLED` | 신규 결제 kill switch. 기본값은 `false` | 결제 기능 |
| `TOSS_PAYMENTS_ENABLED` | Toss 신규 주문 배포 기본값 | 일반결제 |
| `NEXT_PUBLIC_TOSS_CLIENT_KEY` | Toss 결제위젯 client key | checkout |
| `TOSS_SECRET_KEY` | 승인·조회·취소 API secret key | 서버 결제 처리 |
| `TOSS_MID` | 포인트 충전 전용 가맹점 ID | 서버 검증 |
| `NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY` | 허용 결제수단만 표시하는 전용 UI | checkout |
| `NEXT_PUBLIC_TOSS_AGREEMENT_VARIANT_KEY` | 결제 약관 UI | checkout |
| `TOSS_WEBHOOK_TOKEN` | 공개 웹훅 URL 접근 token | 웹훅 |
| `KAKAOPAY_PAYMENTS_ENABLED` | KakaoPay 신규 주문 배포 기본값. 승인 전 `false` | 카카오페이 |
| `KAKAOPAY_ENVIRONMENT` | `test` 또는 `live` provider 환경 | 카카오페이 |
| `KAKAOPAY_CID` | 환경에 맞는 KakaoPay 가맹점 CID | 카카오페이 |
| `KAKAOPAY_SECRET_KEY` | KakaoPay 결제 Secret key | 서버 결제 처리 |
| `PAYMENT_CALLBACK_ORIGIN` | 등록된 exact HTTPS callback origin | 카카오페이 |
| `PAYMENT_PARTNER_USER_SECRET` | partner user ID 가명화 서버 비밀값 | 카카오페이 |
| `CRON_SECRET` | 내부 대사 endpoint 인증 | 정기 대사 |

키는 주문의 provider 환경 및 merchant ID와 일치해야 한다. test key와 live key가 섞이면 서버와 DB finalizer가 결제를 거부하도록 유지한다. 즉시 신규 주문을 차단할 때는 환경변수만 바꾸지 말고 `payment_runtime_config`의 provider별 `*_accepts_new_orders`를 먼저 끈다.

## 4. schema 배포 순서

Docker는 사용하지 않는다. 운영 반영 전 disposable remote Supabase project 또는 branch에서 전체 migration을 순서대로 검증한다.

1. 현재 운영 schema와 유상 source, 중복 payment key, 고액 상품·결제 이력을 읽기 전용으로 감사한다.
2. 다음 migration을 순서대로 적용한다.
   - `20260805090000_harden_credit_mutation_boundaries.sql`
   - `20260805100000_create_payment_orders_and_atomic_fulfillment.sql`
   - `20260805110000_enforce_credit_expiration.sql`
   - `20260805120000_create_toss_refund_workflow.sql`
   - `20260805130000_create_payment_webhook_events.sql`
   - `20260805140000_append_point_charge_compliance_policy.sql`
   - `20260818060118_extend_payment_provider_schema.sql`부터 `20260818075102_configure_payment_reconciliation_http_cron.sql`까지의 provider·환불·대사 migration
   - `20260818085622_update_point_charge_provider_policy.sql`
3. migration 적용 후 원격 schema에서 Supabase TypeScript 타입을 재생성하고 diff를 검토한다.
4. anon, 일반 사용자, 다른 사용자, admin, service role의 RLS·RPC 권한 행렬을 검증한다.
5. 주문·source·transaction·payment history·profile cache의 합계가 일치하는지 확인한다.

운영 데이터의 자동 삭제나 임의 보정은 하지 않는다. 불명확한 기존 이력은 `legacy_unverified` 또는 수동 검토 대상으로 분리한다.

## 5. Provider 결제수단 설정

### 5.1 Toss 일반결제

포인트 충전 전용 payment widget variant를 사용한다.

허용:

- 신용·체크카드
- 네이버페이
- 페이코
- 토스페이

비활성화:

- 계좌이체와 퀵계좌이체
- 가상계좌
- 휴대폰
- 상품권
- 해외결제
- 그 밖에 심사에서 허용하지 않은 결제수단

하나카드는 계약과 카드사 설정에서 차단한다. 애플리케이션은 승인 응답의 MID·금액·통화·주문·결제수단을 재검증하지만, 카드사 사전 차단은 Toss 계약 설정을 기준으로 한다.

Toss 상점관리자에서 카카오페이와 퀵계좌이체가 실제로 제외된 variant를 저장하고 그 variant key를 `NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY`에 적용한다. 위젯 DOM을 CSS나 JavaScript로 숨기지 않는다. 실제 위젯에 두 수단이 남아 있으면 `kakaopay_accepts_new_orders=false`를 유지하고 direct Kakao 탭을 열지 않는다.

### 5.2 KakaoPay 직접결제

- 초기 제공 수단은 카카오페이머니(`MONEY`)뿐이다.
- `KAKAOPAY_PAYMENTS_ENABLED=true`만으로 노출하지 않고 DB `kakaopay_accepts_new_orders=true`도 필요하다.
- test에서는 `TC0ONETIME`, live에서는 승인된 운영 CID와 Secret을 사용한다.
- Ready가 성공해도 TID가 DB에 저장되기 전에는 redirect URL을 브라우저에 반환하지 않는다.
- KakaoPay 별도 웹훅을 가정하지 않고 5분 대사 작업의 fresh order 조회로 미완료 상태를 수렴시킨다.

## 6. 웹훅과 정기 대사 설정

### 6.1 웹훅

Toss 개발자센터에 아래 형식의 HTTPS URL을 등록한다.

```text
https://{운영도메인}/api/payments/webhooks/toss?token={TOSS_WEBHOOK_TOKEN}
```

- 이벤트: `PAYMENT_STATUS_CHANGED`
- URL의 token은 길고 예측 불가능한 값으로 생성한다.
- URL 전체를 채팅, 티켓, 분석도구, 일반 access log에 남기지 않는다.
- token이 노출되면 즉시 교체하고 Toss 웹훅 URL을 갱신한다.
- 웹훅 본문의 결제 상태만 신뢰하지 않는다. 서버가 저장된 payment key로 Toss 결제를 다시 조회한 뒤 로컬 상태를 수렴시킨다.

### 6.2 정기 대사

스케줄러가 다음 endpoint를 호출한다.

```text
POST /api/internal/payments/reconcile
Authorization: Bearer {CRON_SECRET}
Content-Type: application/json

{"limit":50}
```

- 한 번에 최대 50건만 처리한다.
- `ready`, `confirming`, `fulfillment_pending`, 취소·환불 재처리 상태를 저장된 provider의 fresh 조회 결과와 대조한다.
- 금액·주문·MID가 다르면 자동 지급·환불하지 않고 `manual_review`로 보낸다.
- 대사 실패가 연속되거나 manual review가 1건 이상이면 신규 결제를 OFF하고 원인을 조사한다.

## 7. 활성화 순서

1. DB runtime은 `accepted_provider_environment=test`, Toss 신규 주문 허용, Kakao 신규 주문 비허용으로 schema와 UI를 먼저 배포한다.
2. 공개 화면에서 `/pricing`, `/terms/service`, `/terms/refund`의 정책과 사업자정보를 검수한다.
3. 관리자에서 100,000원 이하 충전 상품과 환불 처리 화면을 확인한다.
4. Toss test 환경에서 주문 준비, 승인, 새로고침 replay, 중복 요청, 전액 취소, 웹훅, 대사를 검증한다.
5. Toss 일반결제 variant에서 카카오페이·퀵계좌이체가 제외됐음을 브라우저에서 확인한다.
6. 선택한 test deployment에서만 DB `kakaopay_accepts_new_orders=true`로 바꿔 KakaoPay Ready→Approve→fresh Order→크레딧 1회 지급→전액취소→크레딧 1회 회수를 검증하고 즉시 다시 `false`로 되돌린다.
7. provider 주문·결제·취소와 내부 `payment_orders`, `payment_history`, `credit_sources`, `credit_transactions`를 대조한다.
8. test로 검증할 수 없는 수단은 승인된 운영 계정으로 최저 금액 live 결제 1건을 수행하고 즉시 원 결제수단으로 전액 취소한다.
9. 불일치 0건, 중복 지급 0건, 미완료 환불 0건을 확인한다.
10. 책임자가 심사 증빙과 외부 미확정 항목을 승인한 뒤에만 해당 provider runtime flag를 전환한다.

## 8. 정상 운영 확인

매일 또는 정산 전에 다음을 확인한다.

- `payment_orders.completed`와 유상 `credit_sources`가 1:1인지
- `payment_orders.refunded`와 저장된 provider의 전액 취소 결과가 일치하는지
- `payment_webhook_events.failed`가 남아 있지 않은지
- `manual_review`, `retryable_failed`, 장시간 `processing` 건이 없는지
- 100,000원 초과 주문·결제 이력이 없는지
- 사용자 표시 잔액과 유효 source 합계가 일치하는지
- 만료 source가 소비 가능 잔액에 포함되지 않는지

## 9. 장애 대응

### 중복 지급 또는 금액 불일치

1. 즉시 DB `payment_runtime_config`에서 문제가 발생한 provider의 신규 주문 flag를 끈다.
2. 해당 order와 source를 수동 검토 상태로 유지한다.
3. 저장된 provider의 fresh 조회 결과와 내부 원장을 대조한다.
4. 원장을 직접 수정하지 말고 검토된 복구 migration 또는 전용 RPC로 처리한다.

### Provider 취소 성공 후 내부 환불 미완료

1. 동일 환불 요청을 유지하고 저장된 provider로 처리한다.
2. provider 결제를 먼저 조회해 전액 취소와 취소 식별자를 확인한다.
3. provider 취소가 확인된 경우에만 로컬 finalizer를 재실행한다.
4. 사용 가능 크레딧으로 되돌리거나 새 현금 환불을 만들지 않는다.

### 웹훅 장애

1. Toss 재전송 상태와 endpoint 응답을 확인한다.
2. `TOSS_WEBHOOK_TOKEN` 및 URL 등록값을 확인하되 값을 로그로 출력하지 않는다.
3. 내부 대사를 실행해 누락 상태를 수렴시킨다.
4. token 노출이 의심되면 교체한다.

## 10. 롤백 원칙

- 기능 장애 시 가장 먼저 신규 결제 flag만 OFF한다.
- 적용된 additive migration을 즉시 destructive rollback하지 않는다.
- 이미 승인된 결제와 진행 중인 환불은 대사·수동 검토로 끝까지 추적한다.
- 약관과 심사 문구는 과거 거래의 근거이므로 임의로 제거하지 않는다.
