# 페이앱(PayApp) 일반결제 + 카카오페이 직접결제 전환 구현 계획

## 1. 목적과 결정 사항

크레딧 충전 결제의 일반결제 PG를 토스페이먼츠에서 페이앱으로 바꾸고, 토스 코드를 걷어낸다. 카카오페이는 기존 직접 연동(카카오페이 API)을 유지한다.

사용자 결정(2026-10-19):

| 항목 | 결정 |
|---|---|
| 카카오페이 | 페이앱과 별도로 카카오페이 직접 연동 유지 (페이앱의 카카오페이는 사용 불가) |
| 페이앱 결제수단 | 신용·체크카드, 네이버페이, 토스페이, 휴대폰. 계좌이체·가상계좌 등은 미사용, 필요 시 DB에 추가 |
| 휴대폰 번호 | 회원가입에서 받음. 번호 없는 기존 회원은 결제 화면에서 입력 |
| 환불 | 페이앱 즉시 취소(`paycancel`)가 되면 자동, 실패(정산 후·휴대폰 당월 경과 등)는 관리자 수동 처리 |
| 테스트 | 페이앱은 샌드박스가 없으므로 자동 테스트(가짜 통보)로 검증하고, 출시 시 실결제 1건 후 환불로 확인 |
| 환경변수 | `PAYAPP_PAYMENTS_ENABLED` 같은 전용 on/off 변수는 두지 않는다. 키 존재 + DB 스위치로 판단 |
| 공통 통보 URL | 사용자가 페이앱 관리자에 `https://www.summersuninst.com/api/payments/webhooks/payapp` 등록 완료 |

## 2. 기준선 (2026-10-19 확인)

- 결제로 판매하는 것은 `pricing_plans`의 크레딧 충전뿐이다(9,900 / 29,900 / 49,900원). 마켓 상품은 크레딧으로 사므로 이번 범위가 아니다. 페이앱 최소 결제금액 1,000원 조건을 모두 만족한다.
- 운영 DB `payment_orders`는 토스 test 주문 12건뿐이다(completed 1, expired 8, failed 3). 실결제 이력이 없으므로 토스 코드는 전부 제거하고 행은 이력으로 남긴다.
- `payment_runtime_config`: `accepted_provider_environment='test'`, `master_accepts_new_orders=true`, `toss_accepts_new_orders=true`, `kakaopay_accepts_new_orders=false`.
  - 쓰기는 마이그레이션 담당자만 할 수 있다. service_role은 SELECT만 가능하다.
- `profiles.phone`: 회원 14명 중 6명 보유.
- 카카오페이 직접 연동은 주문·콜백·승인·지급·환불·대사까지 구현돼 있다(`src/lib/kakaopay-*.ts`, `src/app/api/payments/kakaopay/*`, `src/app/checkout/kakaopay/result`).
  - 상태 흐름: `preparing` → `begin_kakaopay_ready`가 `ready_unknown`으로 바꾸고 → `store_kakaopay_ready`가 `ready`로 바꾼다.
- 대사:
  - pg_cron `payment-reconciliation-http-5m`이 `/api/internal/payments/reconcile`(`CRON_SECRET`)을 호출하고, `reconcilePaymentOrder`가 `order.provider`로 분기한다. 모르는 provider는 `manual_review`로 보낸다.
  - `enforce_payment_reconciliation_health`는 `manual_review` 주문이 1건만 있어도 해당 결제사의 신규 주문을 자동으로 끈다. 다시 켜려면 마이그레이션이 필요하다.
- 결제사 값 `'toss'`, `'kakaopay'`가 박혀 있는 곳:
  - CHECK 제약: `payment_orders`, `checkout_attempts`, `payment_provider_transactions`, `refund_requests`, `payment_reconciliation_items`
  - RPC 분기
  - TS union: `payment-orders-server.ts`, `point-charge-refunds-server.ts:41`, `refunds-client.tsx:61`
- 관리자 환불 API는 `approve`/`reject`만 있다. 수동 처리 후 "환불 완료" 표시 기능이 없다.
- `payment_webhook_events`는 `transmission_id` unique이고, payload 원문 없이 `payload_hash`만 저장한다. 토스 route는 23505(중복)이면 바로 성공 응답한다.
- 기존 테스트 충돌: `point-charge-compliance-ui-contract.test.mjs:89`(`/Toss 취소 거래키/` 기대)와 `provider-refund-processing-contract.test.mjs:105`(부재 기대)가 서로 반대다. 이번에 토스 문구 제거와 함께 정리한다.
- middleware는 `/api` 경로에 인증 리다이렉트를 하지 않는다. `/checkout`은 과목별 경로가 아니므로 국어·영어 분기가 없다.

## 3. 페이앱 연동 사실 (매뉴얼 oapi-0044, docs.payapp.kr)

- 모든 서버 호출: `POST https://api.payapp.kr/oapi/apiLoad.html`, `application/x-www-form-urlencoded`, UTF-8. 응답은 URL 인코딩 query 문자열(`state=1&errorMessage=&mul_no=…&payurl=…`). 매뉴얼에 문서화된 오류 코드는 거의 없으므로 코드 분기에 의존하지 않는다.
- 사용하는 cmd:
  - `payrequest`: 필수 `userid`, `goodname`, `price`, `recvphone`. 사용 옵션 `feedbackurl`, `returnurl`, `var1`, `smsuse=n`, `openpaytype`, `checkretry=y`, `skip_cstpage=y`, `amount_taxable`, `amount_vat`, `amount_taxfree`, `buyerid`. REST 방식에는 `shopname` 인자가 없다. 응답 `mul_no`(결제요청번호), `payurl`(결제창).
  - `paycancel`: 필수 `userid`, `linkkey`, `mul_no`, `cancelmemo`. `cancelmode=ready`면 결제 전 요청만 취소. 정산 전에만 된다. 응답은 `state`, `errorMessage`뿐이다.
  - `paycancelreq`: 정산 후 환불 요청(정산금 반환 필요). 이번 범위에서는 자동 호출하지 않고 수동 처리 안내만 한다.
- **결제 상태 조회 API가 없다.** 결제 확정 근거는 통보(feedbackurl/공통 통보)뿐이다.
- 통보(POST form): `userid`, `linkkey`, `linkval`, `price`, `mul_no`, `var1`, `var2`, `pay_state`, `pay_type`, `pay_date`, `feedbacktype`(0 요청 연동, 1 공통 통보), `orig_mul_no`, `canceldate`, `csturl` 등.
  - 검증: `userid`·`linkkey`·`linkval` 일치 + `price`가 주문 금액과 일치.
  - 응답 본문이 `SUCCESS`가 아니면 **무조건** 실패로 보고, `checkretry=y`면 최대 10회 재통보한다. 같은 통보가 여러 번 올 수 있고, feedbacktype 0과 1이 둘 다 올 수 있다.
  - redirect 응답 금지.
  - `pay_state`: 1 요청, 4 결제완료, 8·16·32 요청취소, 9·64 승인취소, 10 결제대기(가상계좌), 70·71 부분취소.
  - `pay_type`: 1 신용카드(페이코 포함), 2 휴대전화, 16 네이버페이, 25 토스페이 (그 외 6, 7, 15, 21, 23, 24, 26).
- `skip_cstpage=y`이면 결제 완료 후 브라우저가 `returnurl`로 **POST** 이동한다. 그래서 `returnurl`은 페이지가 아니라 GET·POST를 받는 route handler로 두고 결과 화면으로 303 redirect한다.
- 판매자 관리 사이트의 결제수단 설정이 `openpaytype`보다 우선한다.

## 4. 목표 구조

```
[결제 화면] 결제수단 선택 (카드 / 카카오페이 / 네이버페이 / 토스페이 / 휴대폰)
   ├─ 카카오페이 → 기존 /api/payments/kakaopay/orders → 카카오 인증 → 콜백 → 지급 (변경 없음)
   └─ 그 외 → POST /api/payments/payapp/orders
            → prepare_payment_order(provider='payapp')            status: preparing
            → begin_payapp_request                               status: ready_unknown
            → 페이앱 payrequest (openpaytype=선택한 수단 1개, var1=order_id)
            → store_payapp_request(mul_no, payurl)                status: ready
            → 브라우저 location.assign(payurl)
   페이앱 결제창에서 결제
   ├─ (서버) 페이앱 → POST /api/payments/webhooks/payapp
   │        검증 → finalize_payapp_payment (크레딧 지급, 멱등) → 'SUCCESS'
   └─ (브라우저) returnurl → /api/payments/payapp/return → 303 /checkout/payapp/result?orderId=…
            → /api/payments/payapp/status 폴링 (본인 주문만) → 완료·대기·실패 표시
```

원칙:
- 크레딧 지급은 **통보 처리에서만** 한다. 브라우저 복귀(returnurl)는 상태를 보여주기만 한다.
- 지급 RPC는 행 잠금으로 멱등이다. 같은 통보가 반복되거나 두 통보가 동시에 와도 한 번만 지급한다.
- **돈을 받았으면 지급한다:** 인증·금액·주문번호가 맞는 결제완료 통보는 주문이 `ready`가 아니어도 지급한다(`ready_unknown`, `manual_review`, 결제 없이 만료된 `expired` 포함). 운영 스위치를 꺼도 이미 결제된 건은 지급한다.
- 비밀값(`linkkey`, `linkval`)은 서버 전용이다. 클라이언트로 보내는 건 `payurl`뿐이다. 통보 원문은 비밀값을 담고 있으므로 저장하거나 로그에 남기지 않는다.

## 5. 데이터 모델 변경

### 5.1 결제수단 목록 테이블 `payment_methods` (신규, 하드코딩 금지 규칙)

결제 화면의 선택지를 DB 데이터로 정한다. 나중에 결제수단을 추가할 때 코드를 고치지 않고 행만 추가한다.

| 컬럼 | 설명 |
|---|---|
| `code` (PK) | `card`, `kakaopay`, `naverpay`, `tosspay`, `phone` |
| `label` | 화면 이름 (신용·체크카드, 네이버페이 …) |
| `description` | 보조 문구 (예: 휴대폰 "결제한 달이 지나면 환불이 늦어질 수 있음") |
| `provider` | `payapp` 또는 `kakaopay` |
| `provider_open_pay_type` | 페이앱 `openpaytype` 값 (`card`, `naverpay`, `tosspay`, `phone`), 카카오페이는 null |
| `provider_pay_types` | 통보에서 기대하는 `pay_type` 배열 (`{1}`, `{16}`, `{25}`, `{2}`), 카카오페이는 null |
| `sort_order`, `is_enabled` | 표시 순서, 사용 여부 |

- 초기 데이터: 카드 → 카카오페이 → 네이버페이 → 토스페이 → 휴대폰 순서(9장 UI안 근거).
- RLS: 일반 사용자 접근 없음. checkout 서버 컴포넌트와 API가 service role로 읽는다. 사용자 결제내역 라벨은 `get_my_payment_history` RPC 안에서 join한다.
- 통보의 `pay_type`이 고른 수단의 `provider_pay_types`와 다르면 지급은 하고(금액·주문·인증이 맞으므로), 실제 `pay_type`을 기록하고 경보만 남긴다. `manual_review`로 보내면 health 점검이 판매를 멈추기 때문이다.

### 5.2 결제사 값 `'payapp'` 추가

- CHECK 제약 5곳에 `'payapp'`을 추가한다. 토스 이력 행 때문에 `'toss'`는 남긴다.
- `payment_orders.provider` 기본값 `'toss'`를 제거한다.
- `payment_orders_provider_snapshot_check`의 payapp 분기: `mid IS NULL`, `provider_merchant_id` = 페이앱 판매자 아이디, `provider_environment = 'live'`, `tax_free_amount = 0`, `vat_amount = round(expected_amount/11)`.
- `payment_orders`에 `payment_method_code text references payment_methods(code)`를 추가한다. 주문 시점에 고른 수단이며, 스냅샷 불변 트리거 대상이다.
  - payapp 주문은 필수이고 provider가 일치해야 한다.
  - 카카오페이 route는 바꾸지 않으므로, 카카오 주문은 null을 허용하고 `'kakaopay'`로 간주한다.
- 페이앱 거래 정보는 기존 `payment_provider_transactions`에 저장한다. 카카오페이와 같은 테이블이다.

| 컬럼 | 저장 값 |
|---|---|
| `provider_transaction_id` | `mul_no` (null에서 값으로 한 번만 설정 허용) |
| `paid_feedback_recorded_at` (신규 컬럼) | 결제완료(4) 통보를 저장한 시각. "결제 확인됨" 판단은 이 컬럼으로만 한다(`provider_status`는 대사가 덮어쓸 수 있음) |
| `provider_paid_at`, `provider_cancelled_at` (신규 컬럼) | 통보의 `pay_date`, `canceldate` |
| `next_redirect_pc_url` | `payurl` |
| `provider_status` | 마지막 `pay_state` |
| `payment_method_type` | 통보의 `pay_type` |

### 5.3 운영 스위치 `payment_runtime_config`

- 추가 컬럼: `payapp_accepts_new_orders boolean not null default false`, `payapp_merchant_id text`.
- **결제 환경:**
  - 기존 `accepted_provider_environment`는 그대로 두고, 카카오페이(그리고 제거 전까지 토스)만 적용받는 값으로 의미를 좁힌다. 카카오페이 코드와 RPC는 바꾸지 않는다.
  - 페이앱은 이 값을 보지 않고 항상 `live`다. live CID를 받으면 이 값을 `live`로 바꾼다.
- 토스 컬럼(`toss_accepts_new_orders`, `toss_merchant_id`)은 토스 코드를 제거한 배포 뒤의 정리 단계에서 삭제한다. `accepted_provider_environment`는 삭제하지 않는다.
- 스위치 변경과 `payapp_merchant_id` 설정은 마이그레이션(`changed_by`, `change_ticket` 기록)으로 한다.

### 5.4 RPC

| RPC | 변경 |
|---|---|
| `prepare_payment_order` | 기존 17개 인자 시그니처를 DROP하고, 끝에 `p_payment_method_code text DEFAULT NULL`을 더해 다시 만든다(오버로드 금지). GRANT/REVOKE를 다시 적용한다. `'payapp'` 허용, payapp 초기 상태 `preparing`, payapp이면 결제수단 필수와 provider 일치를 검사한다. 기존 토스·카카오 호출은 그대로 동작한다 |
| `begin_payapp_request`, `store_payapp_request` (신규) | `begin_kakaopay_ready`/`store_kakaopay_ready`와 같은 흐름. 요청 직전 `ready_unknown`, 응답 받으면 `mul_no`·`payurl` 저장 후 `ready`. 운영 검사는 `master_accepts_new_orders`, `payapp_accepts_new_orders`, `payapp_merchant_id = provider_merchant_id`만 하고, 결제 환경은 `accepted_provider_environment`가 아니라 `'live'` 고정값과 비교한다 |
| `record_payapp_feedback` (신규) | 인증·금액 검증을 통과한 통보의 비밀 아닌 값(`mul_no`, `pay_state`, `pay_type`, `pay_date`, `canceldate`)을 지급 전에 `payment_provider_transactions`에 먼저 저장한다(5.2 전용 컬럼). 결제완료(4)이고 아직 지급 전인 주문(`source_id IS NULL`, `completed`/`refunded` 아님)은 같은 트랜잭션에서 `fulfillment_pending`으로 바꾼다. 이 상태는 기존 대사 후보·backlog 조건에 이미 들어 있어서, 지급이 실패하고 재통보가 끊겨도 대사가 다시 집어 지급한다 |
| `resolve_payment_order_review` (신규) | `manual_review` 주문 해소(6.4). 처리자·메모 필수 |
| `finalize_payapp_payment` (신규) | `pay_state=4` 통보로만 호출한다. 아래 조건과 기록 참고 |
| `get_point_charge_refund_eligibility`, `request_point_charge_refund`, `claim_point_charge_refund` | payapp 분기 추가. claim은 `mul_no`를 반환. toss 원천은 환불 불가 반환(토스 처리 코드 제거 후) |
| `finalize_point_charge_refund` | payapp은 provider 상태 `'CANCELED'` 요구. 취소 키 `payapp-cancel:${mul_no}`, 취소 시각은 통보 `canceldate` 또는 now() |
| `quarantine_external_provider_cancellation` | payapp 분기 추가(판매자 관리 사이트에서 직접 취소한 건). 같은 키·시각 규칙 |
| `complete_manual_point_charge_refund` (신규) | `manual_review` 환불을 관리자가 외부(페이앱 관리자·계좌 송금)에서 처리한 뒤 완료로 표시. 처리자·메모 필수. 남은 크레딧만 회수하고, 이미 쓴 크레딧이 있으면(외부 취소 격리 건) 그 양을 감사 기록에 남긴 채 완료한다. `finalize_point_charge_refund`의 "전부 미사용" 조건은 적용하지 않는다 |
| `enforce_payment_reconciliation_health` | payapp도 점검한다. 대상은 결제 완료 후 미지급 건(`fulfillment_pending` 10분 이상, 카카오페이 stale 조건과 같은 모양)과 금액 불일치 같은 진짜 이상 건뿐이다. 이런 건이 생기면 `payapp_accepts_new_orders`를 끈다. 결제가 일어날 수 없는 건(요청 응답 유실 등)은 `manual_review`로 보내지 않는다(6.3) |
| 토스 전용 (`finalize_toss_payment`, `*_toss_refund` 6종) | 정리 단계에서 drop |

`finalize_payapp_payment`:
- 지급 조건:
  - provider `payapp`, `provider_environment='live'`
  - `userid` = `provider_merchant_id`, 금액 = `expected_amount`
  - 주문 상태가 `ready`, `ready_unknown`, `fulfillment_pending`, `manual_review`, `expired` 중 하나
  - `mul_no`: 저장된 값이 있으면 일치해야 하고, 없으면 이때 저장한다
- 지급 조건이 아닌 것: 결제 만료 시각(`checkout_expires_at`) 경과와 운영 스위치는 지급 거부 사유가 아니다.
- 이미 `completed`이거나 `source_id`·`payment_history_id`가 이미 있으면(지급 후 외부 취소 격리로 `manual_review`가 된 주문 등) 지급 없이 "이미 지급됨" 성공을 반환한다(멱등, 재통보 무한 반복 방지).
- 주문 INSERT 시점에 payapp 주문도 `ready_requested_at`, `ready_expires_at`(불변 스냅샷)을 채운다. 지금은 카카오페이 주문에만 넣는다(`20260818071513` 140-141행).
- 기록: `credit_sources`(1년), `profiles.credits`, `payment_history`(provider `payapp`, `payment_method`=결제수단 코드, 실제 `pay_type`), `credit_transactions`.

## 6. 서버 모듈과 route

### 6.1 `src/lib/payapp-server.ts` (신규)

- `getPayAppConfig()`, `assertPayAppReady()`: 아래가 모두 있어야 준비 완료로 본다. 키 값 자체가 페이앱 사용 여부 스위치 역할을 한다.
  - `PAYMENTS_ENABLED==='true'`
  - `PAYAPP_USERID`, `PAYAPP_LINKKEY`, `PAYAPP_LINKVAL`
  - `PAYMENT_CALLBACK_ORIGIN`(https)
- `requestPayAppPayment({ orderId, goodname, price, vat, recvphone, openPayType })`: `payrequest`. 회원 식별값(`buyerid`)과 이메일은 보내지 않는다(개인정보 최소 제공).
  - 보내는 값: `smsuse=n`, `checkretry=y`, `skip_cstpage=y`
  - 주소: `feedbackurl=${origin}/api/payments/webhooks/payapp`, `returnurl=${origin}/api/payments/payapp/return?orderId=…`
  - 금액: `amount_taxable`, `amount_vat`
  - 타임아웃: 10초
- `cancelPayAppPayment({ mulNo, memo, mode })`: `paycancel` 전취소. `mode='ready'`는 미결제 요청 취소.
- `parsePayAppResponse()`: query 문자열을 파싱한다. `state !== '1'`이면 실패(`errorCode`·`errorMessage` 보존)로 돌려준다. 네트워크 오류·타임아웃·5xx는 별도의 "재시도 가능" 실패로 구분한다.
- `verifyPayAppFeedback(form)`: `userid`·`linkkey`·`linkval`을 timing-safe 비교한다.

### 6.2 route

| 경로 | 역할 |
|---|---|
| `POST /api/payments/payapp/orders` (신규) | 아래 순서 참고 |
| `POST /api/payments/webhooks/payapp` (신규) | 아래 순서 참고 |
| `GET·POST /api/payments/payapp/return` (신규) | 페이앱 복귀. 받은 값은 신뢰하지 않고 `orderId`만 붙여 `/checkout/payapp/result`로 303 |
| `GET /api/payments/payapp/status` (신규) | 본인 주문 상태 (`completed`/`pending`/`failed`/`expired`). 카카오페이 status route와 같은 모양 |
| `/checkout/payapp/result` (신규 페이지) | 카카오페이 결과 화면 패턴. 완료면 충전 크레딧 표시, 대기면 폴링(최대 약 60초) 후 "결제 확인 중. 마이페이지 결제내역에서 확인" 안내 |

`POST /api/payments/payapp/orders`:
1. 로그인, 요금제, 결제수단(`payment_methods`, `provider='payapp'`, 사용 중), 휴대폰 번호(01X 형식), 운영 스위치를 검증한다.
2. `prepare_payment_order`(fingerprint에 결제수단·휴대폰 번호 포함) → `begin_payapp_request` → `payrequest` → `store_payapp_request` → `{ payurl }`를 반환한다. `store_payapp_request`가 실패하면 `payurl`을 반환하지 않는다(`ready_unknown` 상태에서 결제가 일어나지 않게).
3. 같은 결제 시도로 다시 요청하면, 주문이 만료 전 `ready`일 때만 기존 `payurl`을 재사용한다. 이미 만료·종료된 주문이면 `PAYMENT_ATTEMPT_EXPIRED`를 돌려주고, 클라이언트가 새 결제 시도 ID로 다시 요청한다.
4. 휴대폰 번호가 프로필에 없을 때 "다음에도 이 번호 사용"을 고르면 `profiles.phone`에 저장한다.

`POST /api/payments/webhooks/payapp`:
1. form을 파싱하고 인증한다. 실패하면 `FAIL`을 응답하고 경보를 남긴다(코드별 1건). 페이앱이 재통보하므로, 우리 키 설정이 틀린 경우 고칠 시간을 번다.
2. 주문을 찾는다. `payment_provider_transactions(provider='payapp', provider_transaction_id=mul_no)`로 먼저 찾고, 없으면 `var1`(order_id)로 찾는다. 둘 다 있으면 서로 일치해야 한다. 부분취소(70·71)는 `mul_no`가 바뀌므로 `orig_mul_no`로 찾는다.
3. `payment_webhook_events`에 `payapp:${mul_no}:${pay_state}`로 기록한다. 페이앱 이벤트는 `order_id`를 비워 두고(주문 연결은 `payment_provider_transactions`로 한다), 기존 `claim_payment_reconciliation_batch`·`record_payment_reconciliation_result`가 대사 결과로 이 이벤트를 `completed`로 덮어쓰지 않게 한다. 처리를 끝낸 웹훅만 이벤트를 `completed`로 바꾼다.
   - 검증 실패(금액·`mul_no`·주문번호 불일치)는 재통보해도 결과가 같으므로 이벤트를 `ignored`, 주문을 `manual_review`로 두고 경보를 남긴 뒤 `SUCCESS`를 응답한다.
   - 이미 `completed`인 이벤트면 처리를 생략하고 `SUCCESS`를 응답한다.
   - `pending`/`failed`인 이벤트면 이번 통보로 다시 처리한다. 지급 RPC가 멱등이라 안전하다.
4. 상태별 처리(아래 표)를 끝낸 뒤 이벤트를 `completed`로 바꾸고 `SUCCESS`를 응답한다. 일시 오류(DB 등)는 `failed`로 두고 `FAIL`을 응답해 재통보를 받는다.
5. 토스 route의 "중복이면 바로 성공" 방식은 쓰지 않는다. 그 방식이면 첫 처리 실패 후 온 재통보가 유실된다.

| `pay_state` | 처리 |
|---|---|
| 4 | `record_payapp_feedback` → `finalize_payapp_payment` (`pay_type`이 기대와 다르면 지급 후 경보) |
| 1 | `ready_unknown` 주문이면 `mul_no`를 저장한다(요청 응답 유실 복구) |
| 8, 16, 32 | 미결제 주문이면 `expired` 처리 |
| 9, 64 | 저장된 `mul_no`와 일치할 때만 처리한다. 진행 중이거나 `retryable_failed`/`manual_review`인 환불이 있으면 `finalize_point_charge_refund`, 없으면 `quarantine_external_provider_cancellation` |
| 70, 71 | 부분취소는 우리가 하지 않으므로 `manual_review` + 경보 |
| 10, 기타 | 기록만 하고 `SUCCESS` |

주문을 못 찾는 통보(결제요청 연동이 아닌 공통 통보 건)는 기록하고 경보를 남긴 뒤 `SUCCESS`를 응답한다.

### 6.3 대사 (조회 API가 없는 대신)

`payment-reconciliation-server.ts`의 `reconcilePaymentOrder`에 payapp 분기를 추가한다.

가장 먼저 확인하는 것: `paid_feedback_recorded_at`이 있는데 아직 지급되지 않은 주문(`record_payapp_feedback`가 `fulfillment_pending`으로 바꿔 둔 주문)은 **절대 `expired`로 바꾸지 않는다.** 저장된 값으로 `finalize_payapp_payment`를 다시 실행하고, 그래도 실패하면 `manual_review` + 경보로 보낸다.

| 주문 상태 | 처리 |
|---|---|
| `preparing` (요청 전) 오래됨 | 페이앱에 요청을 보내지 않았으므로 `expired` |
| `ready_unknown` (요청 응답 유실) | 결제 만료(30분)가 지난 뒤 처리한다. `mul_no`가 생겼으면(`pay_state=1` 통보) `cancelmode=ready`로 취소 후 `expired`, 없으면 바로 `expired`. `smsuse=n`이고 `payurl`을 클라이언트에 주지 않았으므로 결제가 일어날 수 없다. 만에 하나 결제되면 4 통보가 지급한다(5.4) |
| `ready`, 결제 만료 경과 | `paycancel cancelmode=ready`. 성공하면 `expired`. 실패하면 결제됐을 수 있으므로 통보 재시도를 기다리고, 일정 시간(예: 2시간) 뒤에도 그대로면 `manual_review` + 경보 |

### 6.4 `manual_review` 해소와 판매 재개

- `manual_review` 주문이 생기면 health 점검이 페이앱 신규 주문을 끈다(2장).
- 관리자 결제 화면에 `manual_review` 주문 목록과 해소 버튼을 둔다. 신규 RPC `resolve_payment_order_review`가 처리하며, 처리자·메모는 필수다.
  - **결제 확인됨:** 페이앱 관리자에서 결제를 확인한 경우.
    - 저장된 통보 값(`paid_feedback_recorded_at`)이 있으면 그 값으로 `finalize_payapp_payment`를 실행한다.
    - 통보가 없으면 관리자 지급 분기로 처리한다. 근거는 관리자 메모와 `mul_no`이고, 지급액은 주문의 `expected_amount`다. 통보 검증(`userid`·금액)을 거치지 않으므로 처리자·메모를 감사 기록으로 남긴다. `mul_no`는 unique index라 다른 주문에 다시 쓸 수 없다.
  - **미결제 확인:** 결제가 없었던 경우. `expired`로 처리한다.
  - **외부 취소 확인:** 판매자 관리 사이트에서 직접 취소해 격리된 건. 함께 `manual_review`가 된 환불 요청을 `complete_manual_point_charge_refund`로 완료하고, 주문은 `refunded`가 된다.
- 판매 재개: 해소한 뒤 마이그레이션으로 `payapp_accepts_new_orders=true`(`change_ticket` 기록)를 설정한다. 사용자 승인 후 적용한다.

### 6.5 환불

`point-charge-refund-processor.ts`에 payapp 분기를 추가한다.
- `claim_point_charge_refund` → `paycancel`(전취소, `cancelmemo`=환불 요청 번호).
- **성공(`state=1`):** `finalize_point_charge_refund`(`'CANCELED'`, 키 `payapp-cancel:${mul_no}`). 뒤에 오는 9·64 통보는 이미 완료된 환불이라 아무것도 하지 않는다.
- **실패(`state=0`):** 정산 후, 휴대폰 당월 경과 등의 경우다. `fail_point_charge_refund`로 `manual_review` 처리하고 `errorCode`·`errorMessage`를 저장한다. 오류 코드로 분기하지 않는다.
- **네트워크 오류·타임아웃·5xx:** `retryable_failed`로 둔다. 응답 유실 후 재시도에서 "이미 취소" 실패가 나더라도, 9·64 통보가 그 환불을 완료 처리한다.
- 관리자 환불 화면에 수동 처리 안내와 **"수동 환불 완료 처리"** 버튼을 추가한다(`complete_manual_point_charge_refund`, 메모 필수).
  - 안내 문구: "페이앱 관리자에서 취소 요청(정산금 반환) 또는 고객 계좌 송금 후 완료 처리"

## 7. 토스 제거 범위

- 삭제할 파일:
  - `src/lib/toss-payments-server.ts`
  - `src/app/api/payments/orders/route.ts`, `src/app/api/payments/confirm/route.ts`
  - `src/app/api/payments/webhooks/toss/route.ts`
  - `src/app/checkout/success/page.tsx`, `src/app/checkout/fail/page.tsx` (토스 쿼리 전용)
- 수정할 파일:
  - `checkout/page.tsx`, `checkout-client.tsx`: 토스 위젯과 '일반결제' 문구 제거, 9장 UI로 교체
  - `payment-reconciliation-server.ts`, `point-charge-refund-processor.ts`: 토스 분기 제거
  - `payment-orders-server.ts`, `point-charge-refunds-server.ts:41`, `refunds-client.tsx:61`: provider union을 `'kakaopay' | 'payapp'`과 이력용 `'toss'`로 바꾼다. `payment-orders-server.ts`의 `FinalizeTossPaymentResult`도 제거한다
  - `refunds-client.tsx:116`: 결제사 라벨(카카오페이 외 '일반결제')을 결제수단 라벨로 교체
  - `src/types/supabase.ts`: 마이그레이션 후 재생성
- 문구:
  - 대상: `checkout-client.tsx`의 "토스페이먼츠 안전결제", `src/app/terms/[documentSlug]/page.tsx:88`
  - 결제내역(`payments-view.tsx`, `payment-list.tsx`): 결제수단 라벨은 `get_my_payment_history`가 join한 `payment_methods.label`로 표시하고, 과거 건은 `provider='toss'`면 "일반결제(이전)"로 표시한다. 기존 `payment_method === 'toss'` 분기는 원래 동작하지 않던 코드라 교체한다. 토스 상태값 라벨도 교체한다.
  - 약관·푸터 문구는 DB(`system_settings`의 footer content)에 있으므로 마이그레이션으로 수정한다(하드코딩 금지). `src/lib/footer-content.ts`의 기본값도 맞춘다.
  - 결제대행사 표기(상호·사업자 정보)는 사용자 확인 값을 받는다.
- 환경변수 삭제(Vercel·`.env.local`·`env.local.example`): `TOSS_PAYMENTS_ENABLED`, `NEXT_PUBLIC_TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY`, `TOSS_MID`, `NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY`, `NEXT_PUBLIC_TOSS_AGREEMENT_VARIANT_KEY`, `TOSS_WEBHOOK_TOKEN`. `PAYMENTS_ENABLED`는 배포 단위 전체 차단용으로 유지한다.
- 테스트: 토스를 읽는 테스트를 페이앱 기준으로 교체하거나 삭제한다. 대상은 `payment-confirm`, `payment-order`, `payment-reconciliation`, `provider-reconciliation-scheduler`, `provider-refund-processing`, `toss-refund-workflow`, `payment-provider-schema`, `checkout-payment-methods`, `credit-mutation-snapshot`, `credit-source-category`, `payment-history-filter`, `point-charge-operations`, `payment-provider-policy`, `point-charge-compliance-ui` 등이며, 정확한 목록은 단계 0에서 `grep -il toss tests`로 고정한다.
- 토스 전용 docs 3개(`docs/tosspayments-*.md`)를 읽는 테스트는 이 문서 기준으로 바꾼다. `docs/toss-kakaopay-dual-payment-implementation-plan.md`는 이력으로 남긴다.

## 8. 환경변수와 외부 설정

| 변수 | 범위 | 비고 |
|---|---|---|
| `PAYAPP_USERID` | 서버 | 판매자 아이디 |
| `PAYAPP_LINKKEY` | 서버 | 연동 KEY (취소 API, 통보 검증) |
| `PAYAPP_LINKVAL` | 서버 | 연동 VALUE (통보 검증) |
| `PAYMENT_CALLBACK_ORIGIN` | 서버 | 기존 값 재사용 (`https://www.summersuninst.com`) |
| `PAYMENTS_ENABLED`, `CRON_SECRET`, `KAKAOPAY_*` | 서버 | 기존 유지 |

- `PAYAPP_SHOPNAME`은 REST 방식에 쓰이지 않으므로 필요 없다.
- Vercel에는 Production 범위에만 넣는다. 로컬은 사용자가 설정 완료.
- 로컬에서 결제를 만들어도 통보는 공통 통보 URL(운영)로 간다. DB를 공유하므로 운영이 처리하지만, 운영에 통보 코드가 배포된 뒤에만 시험한다. 시험하려고 DB 스위치를 켜면 운영 사용자에게도 페이앱이 열린다는 점에 주의한다.
- 페이앱 관리자: 결제수단을 카드·네이버페이·토스페이·휴대폰으로 설정. 공통 통보 URL은 등록 완료.

## 9. 결제 화면 UI안

### 9.1 문제

- 지금 화면은 `일반결제 | 카카오페이` 탭이다. "일반결제"는 PG 관점의 말이라 사용자가 그 안에 무엇이 있는지 모르고, 탭을 바꿔야 카카오페이가 보인다.
- 페이앱은 결제창 안에서 다시 결제수단을 고르게 한다. 우리 화면과 페이앱 창에서 두 번 고르게 된다.

### 9.2 제안: 결제수단 한 줄 목록 + 버튼 하나

```
┌ 결제수단 ─────────────────────────────┐   ┌ 주문 요약 ──────────┐
│ ○ 신용·체크카드                         │   │ Basic 33,000 크레딧  │
│ ○ 카카오페이                            │   │ 결제금액 29,900원     │
│ ○ 네이버페이                            │   │ (부가세 포함)         │
│ ○ 토스페이                              │   │ 휴대폰 010-****-1234  │
│ ○ 휴대폰 결제   달 지나면 환불 지연 가능  │   │   [변경]             │
└────────────────────────────────────────┘   └─────────────────────┘
 ☐ 주문 내용과 취소·환불정책을 확인했으며 결제에 동의합니다 (필수)
 [ 카카오페이로 29,900원 결제하기 ]
```

- **결제사를 감춘다:** 사용자는 "어떤 수단으로 낼지"만 고른다. 카카오페이를 고르면 직접 연동으로, 나머지는 페이앱으로 서버가 나눠 보낸다.
- **두 번 고르지 않는다:** 페이앱 요청에 `openpaytype`을 고른 수단 하나만 보내 페이앱 창이 바로 그 수단 결제로 열린다.
- **버튼 문구에 수단과 금액을 넣는다:** "네이버페이로 29,900원 결제하기". 무엇이 일어날지 버튼만 봐도 안다.
- **순서:** 카드 → 카카오페이 → 네이버페이 → 토스페이 → 휴대폰. `payment_methods.sort_order`로 바꿀 수 있다.
- **마지막에 쓴 수단을 기본 선택:** 브라우저 저장(localStorage, 실패 시 무시). 처음이면 아무것도 고르지 않은 상태로 두어 버튼을 비활성화한다.
- **브랜드 표시:** 카카오페이·네이버페이·토스페이는 각 사 결제 버튼 가이드의 공식 로고를 쓴다. 받기 전에는 텍스트와 아이콘만 쓴다.
- **휴대폰 번호:** 프로필 번호를 가려서 보여주고 [변경]으로 고친다. 번호가 없으면 결제 버튼 위에 입력칸을 연다. 카카오페이는 번호가 필요 없으므로 카카오페이를 고르면 숨긴다.
- **동의 체크:** 토스 위젯이 해 주던 약관 동의를 우리 화면에서 직접 받는다(전자상거래 결제 전 확인).
- **휴대폰 결제 안내:** 보조 문구(`payment_methods.description`)로 환불 제약을 미리 알린다.
- **이동 방식:** 페이앱과 카카오페이 모두 같은 창 이동(`location.assign`)이다. 모바일 팝업 차단을 피하고, 돌아오면 결과 화면이 상태를 보여준다.
- **결제 시도와 수단 변경:**
  - 결제 요청 중에는 수단을 바꾸지 못하게 잠근다(기존 상태 머신 재사용).
  - 결제창에서 뒤로 돌아온 뒤 수단이나 휴대폰 번호를 바꾸면 클라이언트가 새 결제 시도 ID를 만든다. 이전 주문은 대사가 정리한다.
  - 같은 수단이면 같은 시도를 이어서 할 수 있다.
- **모바일:** 목록이 한 줄씩 쌓이고 주문 요약이 위로 온다. 행 높이는 44px 이상이다.
- **사용 불가 수단:** 운영 스위치나 키 미설정으로 쓸 수 없는 결제사의 수단은 목록에서 뺀다. 전부 없으면 기존 "결제 기능을 준비 중입니다" 화면을 보여준다.

## 10. 단계별 구현과 검증

각 단계: 구현 → 테스트(`node --test` 해당 파일 + 전체 baseline 비교) → `npx tsc --noEmit` → 독립 검증 → 통과까지 반복. 운영 DB 쓰기는 dry-run과 사용자 승인 후 적용한다.

| 단계 | 내용 | 검증 |
|---|---|---|
| 0 | 토스를 읽는 테스트 목록 고정, 충돌 테스트 2개 정리 방침 확정 | 현재 실패 목록 baseline 기록 |
| 1 | 마이그레이션 A(추가만): `payment_methods`와 초기 행, `'payapp'` CHECK, runtime 컬럼(스위치 false), `prepare_payment_order` 재정의(기본값 인자), `payment_provider_transactions` 전용 컬럼, 새 RPC(`resolve_payment_order_review` 포함), 기존 RPC payapp 분기. 기존 토스·카카오 동작은 그대로 | 마이그레이션 계약 테스트. 운영 적용 전 dry-run: 현재 행이 새 CHECK를 통과하는지, `prepare_payment_order` 오버로드가 1개인지. 적용 후 함수 정의 확인 |
| 2 | `payapp-server.ts` + 단위 테스트(응답 파싱, 통보 인증, 요청 파라미터) | 가짜 fetch로 정상·`state=0`·타임아웃 |
| 3 | 주문·통보·복귀·상태 route와 결과 화면 | 가짜 통보 시나리오(아래) |
| 4 | 대사 payapp 분기, 환불 payapp 분기, 수동 환불 완료와 `manual_review` 해소 관리자 UI | 대사·환불 계약 테스트, 성공·`state=0`·네트워크 오류별 상태 |
| 5 | 결제 화면 UI 교체(9장), 결제내역 라벨 | 로컬 화면 확인(데스크톱·모바일 폭), 접근성(라벨·포커스·44px), 수단 변경 시 새 시도 ID |
| 6 | 토스 코드·테스트·문구 제거, `env.local.example` 갱신 | `grep -ri toss src` 결과가 이력 라벨 외 0건, 전체 테스트 baseline 대비 신규 실패 0 |
| 7 | 배포 → 마이그레이션 B(정리): 토스 RPC·컬럼 drop, 약관·푸터 DB 문구 | 배포된 코드가 토스 객체를 참조하지 않는지 확인 후 적용 |
| 8 | 출시: Vercel Production에 페이앱 변수 → 마이그레이션으로 `payapp_merchant_id` 설정과 `payapp_accepts_new_orders=true` → 운영자가 실결제 1건(카드) → 크레딧 지급 확인 → 관리자 환불 → 취소 통보 확인 | 실패 시 마이그레이션으로 스위치 off |

단계 3의 가짜 통보 시나리오:
- 정상 결제는 1회 지급된다.
- 중복 통보, feedbacktype 0·1 동시 도착도 1회만 지급된다.
- 첫 처리 실패 후 재통보가 오면 지급된다.
- 금액 불일치와 `linkval` 불일치는 거부한다.
- 기대와 다른 `pay_type`은 지급 후 경보를 남긴다.
- `ready_unknown`·`expired`·`manual_review` 주문에 늦게 온 결제완료 통보는 지급된다.
- 결제완료 통보 처리가 실패한 뒤 대사가 돌고 재통보가 오는 경우에도 지급된다(주문이 `expired`가 되지 않음).
- 이미 지급된 `manual_review` 주문에 결제완료 통보가 다시 오면 "이미 지급됨" 성공을 응답한다.
- 검증에 실패한 통보는 `ignored`로 두고 `SUCCESS`를 응답한다.
- 부분취소 통보는 `orig_mul_no`로 주문을 찾는다.
- `expired` 주문에 결제완료 통보가 와서 저장됐는데 지급이 실패하고 재통보가 끊긴 경우, 대사가 `fulfillment_pending` 주문을 집어 지급한다.
- `pay_state=1` 통보로 `mul_no`를 저장한다.
- 취소 통보(환불 진행 중, 외부 취소)를 처리한다.
- 주문 없는 공통 통보는 기록과 경보만 남긴다.

순서 규칙:
- 마이그레이션 A는 기존 코드와 호환되므로 먼저 적용할 수 있다.
- 페이앱 스위치는 통보·대사·환불 분기가 모두 운영에 배포된 뒤에만 켠다. 그 전에는 대사가 모르는 provider를 `manual_review`로 보낸다.
- 정리용 마이그레이션 B는 토스 제거 코드가 배포된 뒤에만 적용한다.

## 11. 위험과 대응

| 위험 | 대응 |
|---|---|
| 조회 API 없음 → 통보 유실 시 결제됐는데 미지급 | `checkretry=y`(10회). 실패한 이벤트는 재통보로 재처리. 만료 시 `cancelmode=ready`로 결제 여부 간접 확인. 결제 가능성이 남은 건만 `manual_review` + 경보 |
| 위조 통보 | `linkkey`·`linkval` timing-safe 비교 + 저장된 `mul_no`·주문번호·금액 일치 |
| 페이앱 요청 응답 유실(요청은 생성됐는데 `mul_no` 모름) | `ready_unknown`으로 남긴다. `pay_state=1`·4 통보가 `var1`로 주문을 찾아 `mul_no`를 채운다. 결제되면 지급하고, 아니면 만료 처리한다 |
| 늦게 온 결제완료 통보 | 만료·`manual_review` 주문이라도 조건이 맞으면 지급한다(5.4) |
| 정산 후·휴대폰 당월 경과 환불 | 자동 취소 실패 → 수동 처리 + 완료 표시 기능 |
| 판매자 관리 사이트에서 직접 취소 | 공통 통보 9·64 → 외부 취소 격리 RPC(크레딧 회수 또는 경보) |
| health 점검의 자동 판매 중단 | 진짜 이상 건만 `manual_review`로 보내 불필요한 중단을 막는다. 다시 켜는 것은 마이그레이션으로 한다 |
| 샌드박스 없음 | 가짜 통보 자동 테스트 + 출시 직후 실결제 1건과 환불로 확인 |

## 12. 범위 제외

정기결제, 등록결제(BILL), 현금영수증 API(`cashStRegist`), 부분취소, 가상계좌·계좌이체, `paycancelreq` 자동 호출, 마켓 상품 직접 결제, 카카오페이 연동 변경.

## 13. 확인한 외부 값과 문구 (2026-10-19)

### 13.1 페이앱 운영사 (payapp.kr 하단 표기)

- (주)유디아이디, 사업자등록번호 113-86-56537
- PG 전자지급결제대행업 등록번호 02-004-00096
- 통신과금서비스제공업 등록번호 058
- 고객센터 1800-3772

### 13.2 정산과 수수료 (payapp.kr 정산안내·비용안내·이용약관)

- 기본 정산 D+3, 비실물·리스크 업종 D+5. 크레딧은 비실물이므로 D+5로 본다.
- 휴대폰결제는 결제월 기준 D+5(영업일) 정산이다(이용약관 15조).
- 비실물 상품은 수수료가 오를 수 있다.
- 따라서 "7일 이내 환불" 요청 중 정산 이후 건은 `paycancel`이 실패할 수 있고, 6.5대로 수동 처리로 넘어간다.
- 문서화되지 않은 것: 휴대폰 결제 당월 취소 제한, 취소 수수료, 부분취소 규정. 코드는 `paycancel` 결과(성공이면 자동, 실패면 수동)로만 판단하므로 이 값에 의존하지 않는다.

### 13.3 문구 교체 (DB `system_settings.site_footer_content` + `src/lib/footer-content.ts` 기본값 + 약관 페이지)

**개인정보처리방침 6조(위탁)**
- 변경: "토스페이먼츠: …" → "(주)유디아이디(페이앱): 크레딧 결제 승인, 결제수단 처리, 결제 결과 통보 및 환불 처리 (제공 정보: 주문번호, 상품명, 결제금액, 휴대폰 번호)"
- 적용 방법: 정해 둔 문자열로 치환하지 않는다. 운영 DB 문구(`site_footer_content`)는 코드 기본값과 다르기 때문에, 마이그레이션 B를 만들 때 실제 DB 문구를 읽어 그 문장을 기준으로 고친다. dry-run에서 '토스페이먼츠'가 0건 남는지 확인한다.
- 결정(2026-10-19): 사용자가 이 절의 추천 문구를 그대로 쓰기로 했다.
- 추가: "(주)카카오페이: 카카오페이 결제 승인, 결제 결과 확인 및 환불 처리". 지금 위탁 목록에 빠져 있다.

**환불정책**
- "토스페이먼츠 등 결제대행사" → "결제대행사(페이앱) 또는 카카오페이"
- 결제수단 문장: "포인트 충전에는 신용·체크카드, 네이버페이, 토스페이, 휴대폰 결제와 카카오페이를 사용할 수 있습니다. 계좌이체, 가상계좌 등 그 밖의 결제수단은 지원하지 않습니다."
- 휴대폰 결제 문장: "휴대폰 결제는 결제한 달이 지나면 승인 취소가 되지 않을 수 있으며, 이 경우 회사가 별도 확인 후 환불합니다."

**충전 경로 문구**
- "토스페이먼츠 결제 승인" → "결제수단 선택 → 결제 승인"

**`src/app/terms/[documentSlug]/page.tsx:88` 결제수단 안내**
- 위 환불정책 결제수단 문장과 같게 맞춘다.
- 카카오페이 문구 "별도 운영 승인 후 카카오페이머니만"은 live 승인 후 상태에 맞게 고친다.

### 13.4 카카오페이 live 일정

- 사용자 확인: 승인은 2026-10-26 이전으로 예상한다.
- 승인되면 `KAKAOPAY_ENVIRONMENT=live`, live CID·키를 Vercel에 넣는다.
- 그다음 마이그레이션으로 `accepted_provider_environment='live'`, `kakaopay_merchant_id`, `kakaopay_accepts_new_orders=true`를 설정한다.
- 페이앱 출시(단계 8)와 같은 날 해도 되고 따로 해도 된다. 서로 독립적이다.

## 14. 작성·검토 기록

- 2026-10-19 초안 작성 → 독립 검증에서 NEEDS_CHANGES(blocker 2, major 6, minor 10).
- 반영:
  - 늦은 결제완료 통보 지급 경로, 통보 재처리 규칙
  - 결제 환경 컬럼 유지, `prepare_payment_order` 오버로드 방지
  - `ready_unknown` 상태 사용과 `manual_review` 축소
  - 오류 코드 비의존, RPC 필수 인자 값 매핑
  - 수단 변경 시 새 결제 시도, 요청취소 16 추가, 인증 실패 응답 설명 수정, 누락된 토스 제거 대상 추가
- 2026-10-19 재검증 NEEDS_CHANGES(major 1, minor 8) 반영: 대사가 페이앱 통보 이벤트를 덮어쓰지 않게 분리하고 결제완료 값을 먼저 저장(`record_payapp_feedback`), 이미 지급된 주문 멱등, 검증 실패·부분취소 통보 처리, `begin_payapp_request` 환경 검사, `payurl` 반환 조건과 만료 시도 응답, INSERT 스냅샷 값, `manual_review` 해소·재개 절차(6.4), 휴대폰 문구 통일, `buyerid` 미전송, DB 문구 교체 방법.
- 2026-10-19 3차 재검증 NEEDS_CHANGES(major 1, minor 2) 반영: `record_payapp_feedback`가 미지급 주문을 `fulfillment_pending`으로 바꿔 대사 후보에 넣음, health 점검에 미지급 10분 조건, 결제완료 판단용 전용 컬럼, `resolve_payment_order_review`를 RPC 표·단계 1·4에 연결, 외부 취소 해소 경로, 관리자 지급 근거, 6.4·6.5 절 순서.
- 2026-10-19 4차 재검증 PASS. minor 2건 반영: 절 번호(6.4), 수동 환불 완료 시 이미 쓴 크레딧 처리.
