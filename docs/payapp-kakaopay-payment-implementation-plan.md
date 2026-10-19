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
  - `enforce_payment_reconciliation_health`는 `manual_review` 주문이 1건만 있어도 해당 결제사(현재 카카오페이)의 신규 주문을 자동으로 끈다. 다시 켜려면 마이그레이션이 필요하다. 페이앱은 5.7의 기준을 따른다.
- DB 기본 권한(`pg_default_acl`)은 public 스키마에 새로 만든 함수를 anon·authenticated에 실행 가능하게 연다. 기존 결제 함수는 모두 마이그레이션에서 명시적으로 회수해 service_role 전용이다.
- `refund_requests_cancel_idempotency_key`는 상태와 무관한 unique 인덱스다(기존 결함, 5.5).
- `payment_reconciliation_alerts`는 service_role 읽기 전용이고, 미해소 경보가 code당 1건으로 제한된다. 2026-09-11·12 스케줄러 경보 2건이 미해소로 남아 같은 code의 새 경보를 막고 있었으나, 스케줄러 정상(연속 실패 0)을 확인하고 2026-10-19 마이그레이션 `20261019061626_resolve_stale_reconciliation_scheduler_alerts`로 해소했다(현재 미해소 0건).
- `mark_payment_reconciliation_terminal`은 기대 상태 비교 없이 `completed`·`refunded`가 아니면 덮어쓴다. `completed` 주문에는 아무것도 하지 않는다.
- 카카오 지급(`finalize_kakaopay_payment`)은 크레딧 원천 생성과 `completed` 전환을 한 트랜잭션에서 한다. 운영에서 `completed`·`refunded`·`manual_review`가 아닌 주문에 붙은 원천은 0건이다.
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
   │        인증 → apply_payapp_feedback (검증·기록·크레딧 지급, 멱등) → 'SUCCESS'
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
- 제약:
  - `UNIQUE(code, provider)`
  - `CHECK (provider IN ('payapp','kakaopay'))`
  - `CHECK ((provider='payapp') = (provider_open_pay_type IS NOT NULL AND coalesce(cardinality(provider_pay_types),0) > 0))`
- 권한: `ENABLE RLS`, `REVOKE ALL … FROM PUBLIC, anon, authenticated`, `GRANT SELECT … TO service_role` (`payment_runtime_config`와 같은 패턴). checkout 서버 컴포넌트와 API가 service role로 읽는다. 사용자 결제내역 라벨은 `get_my_payment_history` RPC 안에서 join한다.
- 행 추가·수정은 마이그레이션으로 한다.
- 통보의 `pay_type`이 고른 수단의 `provider_pay_types`와 다르면 지급은 하고(금액·주문·인증이 맞으므로), 실제 `pay_type`을 기록하고 경보만 남긴다. `manual_review`로 보내면 health 점검이 판매를 멈추기 때문이다. 금액·`mul_no` 불일치는 이와 달리 검증 실패다(5.5.1 2단계).

### 5.2 결제사 값 `'payapp'` 추가

- CHECK 제약 5곳에 `'payapp'`을 추가한다. 토스 이력 행 때문에 `'toss'`는 남긴다.
- `payment_orders.provider` 기본값 `'toss'`를 제거한다.
- `payment_orders_provider_snapshot_check`의 payapp 분기: `mid IS NULL`, `provider_merchant_id` = 페이앱 판매자 아이디, `provider_environment = 'live'`, `tax_free_amount = 0`, `vat_amount = round(expected_amount/11)`.
- `payapp` 분기의 `vat_amount`는 `IS NOT NULL`을 명시한다. NULL이면 비교식이 NULL이 되어 CHECK를 통과하기 때문이다.
- `payment_orders`에 `payment_method_code text`를 추가한다. 주문 시점에 고른 수단이며, 스냅샷 불변 트리거 대상이다. 기존 행은 채우지 않는다.
  - DB 강제 1: `FOREIGN KEY (payment_method_code, provider) REFERENCES payment_methods(code, provider)`. MATCH SIMPLE이라 카카오·토스의 null은 통과한다.
  - DB 강제 2: `CHECK (provider <> 'payapp' OR payment_method_code IS NOT NULL)`.
  - 카카오페이 route는 바꾸지 않으므로, 카카오 주문은 null을 허용하고 `'kakaopay'`로 간주한다.
- 페이앱 거래 정보는 기존 `payment_provider_transactions`에 저장한다. 카카오페이와 같은 테이블이다.

| 컬럼 | 저장 값 |
|---|---|
| `provider_transaction_id` | `mul_no` (null에서 값으로 한 번만 설정 허용) |
| `paid_feedback_recorded_at` (신규 컬럼) | 결제완료(4) 통보를 검증·저장한 시각. "결제 확인됨" 판단은 이 컬럼으로만 한다(`provider_status`는 대사가 덮어쓸 수 있음) |
| `paid_amount` (신규 컬럼) | 검증을 통과한 통보 금액. 대사·관리자 재지급은 이 값이 `expected_amount`와 같을 때만 한다 |
| `cancel_feedback_recorded_at` (신규 컬럼) | 승인취소(9·64) 통보를 저장한 시각. 이 값이 있으면 어떤 경로로도 지급하지 않는다 |
| `partial_cancel_feedback_recorded_at` (신규 컬럼) | 부분취소(70·71) 통보를 저장한 시각. 이 값이 있어도 어떤 경로로도 지급하지 않는다 |
| `admin_paid_confirmed_at` (신규 컬럼) | 통보 없이 관리자가 결제를 확인해 지급한 시각(6.4). 결제완료 컬럼에 관리자 값을 넣지 않는다 |
| `fulfillment_attempt_count` (신규 컬럼, 기본 0) | 대사의 지급 재시도 실패 횟수. 웹훅은 세지 않는다. `retry_payapp_fulfillment`가 서브블록이 롤백된 뒤 바깥 트랜잭션에서 +1 하고, `>= 3`이면 같은 트랜잭션에서 `manual_review` CAS를 한다. 기존 `reconcile_attempt_count`는 ready 단계부터 누적돼 쓰지 않는다 |
| `cancel_processed_at`, `partial_cancel_processed_at` (신규 컬럼) | 각각 승인취소(9·64)·부분취소(70·71) 표식의 처리(5.5.2)를 끝낸 시각. 표식은 있는데 짝이 되는 처리 시각이 없으면 대사가 처리를 다시 시도한다. 두 종류를 한 컬럼으로 덮지 않는다(70 처리 뒤 9가 와도 9가 "처리됨"으로 보이지 않게) |
| `provider_paid_at`, `provider_cancelled_at` (신규 컬럼) | 통보의 `pay_date`, `canceldate` (KST로 해석). `provider_cancelled_at`은 `COALESCE(기존 값, 새 값)`으로만 쓴다 |
| `next_redirect_pc_url` | `payurl` |
| `provider_status` | 최근 `pay_state` (표시용, 판단에 쓰지 않음, 되돌리지 않음) |
| `payment_method_type` | 통보의 `pay_type` |

- 기존 트리거 `prevent_payment_provider_identifier_replacement`에 조건을 더한다: `paid_feedback_recorded_at`, `paid_amount`, `cancel_feedback_recorded_at`, `partial_cancel_feedback_recorded_at`, `admin_paid_confirmed_at`, `provider_paid_at`, `cancel_processed_at`, `partial_cancel_processed_at`은 한 번 설정하면 바꿀 수 없다(되돌리면 같은 처리가 다시 실행된다). 카카오는 이 중 `partial_cancel_feedback_recorded_at`·`partial_cancel_processed_at` 두 개만 쓴다(대사가 확인한 부분취소 표식, 6.5 "카카오 대사 부분취소"). 나머지는 카카오에서 늘 NULL이다.
  - RPC는 이 값들을 "NULL일 때만 설정하고, 이미 있으면 비교해서 다르면 경보만" 남긴다. 같은 사실이 두 번 오면서 시각이 다를 때 트리거 예외로 `FAIL`이 반복되지 않게 하기 위해서다.
- 기존 `(provider, provider_transaction_id)` unique와 null→값 1회 트리거가 `mul_no` 유일성을 이미 DB에서 강제한다.
- **지급 차단 표식:** `cancel_feedback_recorded_at`과 `partial_cancel_feedback_recorded_at`을 합쳐 "취소 기록"이라 부른다. 지급하는 모든 경로(`apply_payapp_feedback`의 4, `retry_payapp_fulfillment`, `resolve_payment_order_review`의 `paid_confirmed`)는 취소 기록이 있으면 거부한다.
- `refund_requests`에 `origin text not null default 'user'`(`user`/`external_cancel`/`partial_cancel`)를 추가한다. 거절 가드와 사용자 화면 라벨은 이 컬럼으로 판단한다(`last_error_code`는 claim·fail이 덮어쓴다).
  - 트리거 규칙: `'user'` → `'external_cancel'` 또는 `'partial_cancel'`로의 **단방향 전환만 허용**하고, 그 밖의 변경과 되돌리기는 막는다. 격리 함수가 열린 사용자 요청을 UPDATE해서 격리로 바꾸는 기존 경로가 있기 때문이다.
  - 격리 함수 전부(카카오 분기 포함 `quarantine_external_provider_cancellation`, `quarantine_payapp_partial_cancellation`, 5.5.2의 실패 대체 처리)가 INSERT·UPDATE 때 `origin`을 설정한다.

### 5.3 운영 스위치 `payment_runtime_config`

- 추가 컬럼: `payapp_accepts_new_orders boolean not null default false`, `payapp_merchant_id text`.
- **결제 환경:**
  - 기존 `accepted_provider_environment`는 그대로 두고, 카카오페이(그리고 제거 전까지 토스)만 적용받는 값으로 의미를 좁힌다. 카카오페이 코드와 RPC는 바꾸지 않는다.
  - 페이앱은 이 값을 보지 않고 항상 `live`다. live CID를 받으면 이 값을 `live`로 바꾼다.
- 토스 컬럼(`toss_accepts_new_orders`, `toss_merchant_id`)은 토스 코드를 제거한 배포 뒤의 정리 단계에서 삭제한다. `accepted_provider_environment`는 삭제하지 않는다.
- 스위치 변경과 `payapp_merchant_id` 설정은 마이그레이션(`changed_by`, `change_ticket` 기록)으로 한다.

### 5.4 RPC 공통 규칙 (모든 신규·재정의 결제 함수)

- **권한:**
  - `SECURITY DEFINER`, `SET search_path = public, pg_temp`
  - `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role`
  - authenticated 예외: `get_my_payment_history`, `get_my_refund_requests`(사용자 세션에서 호출, authenticated와 service_role).
  - 트리거 함수(`prevent_payment_order_snapshot_update`, `prevent_payment_provider_identifier_replacement`, 신규 append-only·origin 트리거)는 SECURITY INVOKER 그대로 둔다. 직접 호출할 수 없어 PUBLIC 실행 권한이 있어도 무해하다.
  - 이유: 이 DB의 기본 권한(`pg_default_acl`)은 새 함수를 anon·authenticated에 열어 둔다. 하나라도 빠뜨리면 사용자가 지급·환불 함수를 직접 호출할 수 있다.
  - 강제 방법: 계약 테스트 + 마이그레이션 안 검증 블록 + 적용 후 `proacl` 확인.
- **잠금 순서:**
  - 지급 경로: `payment_orders → payment_provider_transactions → profiles → credit_sources`
  - 환불·취소 경로: `refund_requests → credit_sources → payment_orders → payment_provider_transactions → profiles` (`finalize_point_charge_refund`와 같다).
  - 기존 `quarantine_external_provider_cancellation`은 반대 순서(`payment_orders → credit_sources → profiles → refund_requests`)다. payapp 분기, `quarantine_payapp_partial_cancellation`, `quarantine_kakaopay_partial_cancellation`은 열린 환불 요청을 잠금 없이 찾은 뒤, 위 환불 순서로 잠그고 다시 검증한다(다르면 40001). 카카오 외부 전취소 분기는 그대로 둔다.
  - **취소 통보는 두 단계로 처리한다.** ① `apply_payapp_feedback`이 검증 후 `payment_provider_transactions` 한 행만 잠그고 표식을 기록·커밋한다(다른 행을 기다리지 않으므로 교착 고리가 생기지 않는다). 이 트랜잭션은 주문 행을 쓰지 않는다. 취소 통보의 검증 실패도 주문을 바꾸지 않고 표식 없이 `ignored`와 경보만 남긴다. ② 별도 트랜잭션의 `process_payapp_cancellation`(5.5.2)이 환불 순서로 잠그고 처리한다. 이렇게 해야 관리자 환불 처리(`finalize`)와 동시에 온 취소 통보가 교착되지 않고, 지급 중에 온 취소가 미지급으로 오판되지 않는다.
  - 4·1·8·16·32·10 분기와 `retry_payapp_fulfillment`, `paid_confirmed`, `mark_payapp_order_terminal`, `store_payapp_request`는 `payment_orders FOR UPDATE` → `payment_provider_transactions FOR UPDATE` 순으로 잠근 뒤 **잠근 행을 다시 읽어** 취소 표식, `source_id`, `mul_no`를 판단한다. 잠그기 전에 읽은 값은 주문 id를 찾는 데만 쓴다.
  - 두 경로가 엇갈려 교착(40P01)이 나면 PostgreSQL이 한쪽을 롤백한다. 롤백된 쪽은 재시도 가능 오류로 처리한다. 통보는 `FAIL` 응답으로 재통보를 받고, 대사는 다음 회차에 재시도한다.
- **트랜잭션:**
  - RPC 하나가 트랜잭션 하나다. 예외가 나면 부분 커밋 없이 전부 롤백된다.
  - 결제완료(4)는 "기록"과 "지급"을 나눈다. 기록은 바깥 블록, 지급은 `BEGIN … EXCEPTION WHEN OTHERS` 서브블록이다. 지급 서브블록은 **모든 예외를 잡는다.** 기록은 남고 주문은 `fulfillment_pending`이 되어 대사가 다시 시도한다(재통보가 끊겨도 대사가 집는다).
  - 취소 처리(5.5.2)의 서브블록은 `WHEN OTHERS`로 잡는다. 그중 40P01·40001·55P03(교착·직렬화·잠금 실패)만 다시 던져 재시도하고, 나머지는 **모두** 실패 대체 처리로 넘긴다. 알려진 오류 목록에 의존하지 않는다. 그러지 않으면 예상하지 못한 오류로 재시도가 끝없이 실패하는 동안 취소된 결제의 크레딧이 계속 쓰인다.
- **경보와 상태 변경 분리:** 경보 INSERT는 지급·환불 트랜잭션 안에서 하지 않는다(5.6). 대사는 잠금 없이 읽어 분기만 정하고, 상태 변경은 모두 기대 상태 비교(CAS) RPC로 한다.
- **입력 변환:**
  - 금액·코드는 `^[0-9]+$`로 엄격하게 파싱한 뒤 integer로 넘긴다.
  - `pay_date`, `canceldate`는 시간대가 없으므로 `Asia/Seoul`로 해석해 timestamptz로 넘긴다. 잘못 해석하면 1년 만료와 7일 환불 기한이 9시간 어긋난다.

### 5.5 RPC 목록

| RPC | 변경 |
|---|---|
| `prepare_payment_order` | 기존 17개 인자 함수를 DROP하고, 끝에 `p_payment_method_code text DEFAULT NULL`을 더해 같은 트랜잭션에서 다시 만든다(오버로드 금지, 권한 재적용). provider 분기 5곳(허용 목록, `mid`, `partner_user_id`, 초기 상태, `ready_*`)에 payapp을 명시한다. ELSE에 기대지 않는다. payapp 규칙: 초기 `preparing`, `ready_requested_at`·`ready_expires_at` 채움, `provider_environment='live'`, 결제수단이 `payment_methods`에 있고 사용 중이며 provider가 같음, `vat_amount` NOT NULL. 토스·카카오 동작은 그대로다 |
| `begin_payapp_request` (신규) | `preparing` → `ready_unknown`. 운영 검사는 `master_accepts_new_orders`, `payapp_accepts_new_orders`, `payapp_merchant_id = provider_merchant_id`, 환경 `'live'` 고정값만 본다. `claimed:false`면 route는 payrequest를 보내지 않는다 |
| `store_payapp_request` (신규) | `ready_unknown` → `ready`, `mul_no`·`payurl` 저장. 통보 1이 먼저 와서 같은 `mul_no`가 이미 있으면 `payurl`만 저장하고 `ready`로 바꾼다. 다른 `mul_no`면 `PAYAPP_MUL_NO_CONFLICT` 예외 |
| `fail_payapp_request` (신규) | payrequest가 `state=0`(요청 미생성 확정)이면 `ready_unknown` → `failed` (CAS) |
| `apply_payapp_feedback` (신규) | 통보 처리 진입점. 검증·기록과 결제완료 지급. 5.5.1 |
| `process_payapp_cancellation` (신규) | 취소 표식(9·64·70·71)의 처리. 웹훅이 표식 기록 직후 호출하고, 대사가 미처리 표식을 다시 호출한다. 5.5.2 |
| `retry_payapp_fulfillment` (신규) | 대사가 `fulfillment_pending` 주문을 저장된 검증값으로 다시 지급한다. 5.5.1의 4와 같은 잠금·재확인·서브블록 구조와 같은 내부 함수를 쓴다. 서브블록이 롤백되면 바깥 트랜잭션에서 `fulfillment_attempt_count + 1`, `>= 3`이면 같은 트랜잭션에서 `manual_review`(`PAYAPP_FULFILLMENT_RETRY_EXHAUSTED`) CAS. TS는 그 전 실패를 `retry_required`(백오프)로 처리한다 |
| 지급 내부 함수 (`payapp_fulfill_order_internal`, 직접 호출 금지) | `finalize_kakaopay_payment`와 같은 일을 한다: `credit_sources`(1년), `profiles.credits`(원천 합계로 재계산), `payment_history`, `credit_transactions`, `payment_orders.source_id`·`payment_history_id`·`approved_at`(=`provider_paid_at` 또는 `admin_paid_confirmed_at`)·`provider_method`·`fulfilled_at`, `checkout_attempts.status='completed'`. `SECURITY DEFINER SET search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`(소유자 postgres는 유지, 기대 `proacl = {postgres=X/postgres}`). postgres 소유 SECURITY DEFINER 호출자만 부를 수 있다 |
| `mark_payapp_order_terminal` (신규) | 대사 전용 종료 처리. 주문 `FOR UPDATE` 후 `status = p_expected_status`일 때만 바꾼다. 아니면 `{changed:false, status}`를 돌려주고, TS는 이를 성공이 아니라 `provider_not_final`로 처리한다. 결제완료가 기록됐는데 미지급·미취소인 주문은 `expired`/`failed`로 바꾸지 않고 `PAYMENT_PAID_ORDER_NOT_TERMINABLE` 예외. `ppt.provider_status`는 건드리지 않는다 |
| `mark_payment_reconciliation_terminal` | 2차 방어선. 위와 같은 결제완료 가드를 payapp 분기에만 추가한다. 카카오·토스 동작은 그대로다 |
| `requeue_stuck_point_charge_refund` (신규) | `processing` 환불이 10분 넘게 멈춰 있으면 `retryable_failed`로 바꾼다(CAS). 서버가 claim 직후 죽은 경우를 위한 것이다 |
| `fail_point_charge_refund` | 변경 없음. payapp `retryable_failed`는 자동 재시도하지 않고 관리자 재승인으로만 재시도한다(아래 대사 후보 조건에서 제외) |
| `claim_payment_reconciliation_batch`, `payment_reconciliation_backlog_count` | 조건 두 가지를 더한다. ① (`cancel_feedback_recorded_at` 있음 AND `cancel_processed_at` NULL) 또는 (`partial_cancel_feedback_recorded_at` 있음 AND `partial_cancel_processed_at` NULL)인 payapp·**kakaopay** 주문을 후보로 포함한다(지급 완료 주문도 포함. 카카오는 부분취소 표식만 쓴다). ② payapp 환불의 `retryable_failed`는 후보에서 뺀다(자동 재시도 없음). 기존 카카오·토스 조건은 그대로 두고 ①만 카카오에도 적용한다. `'infinity'` 같은 특수 시각은 쓰지 않는다(TS에서 Invalid Date). 작성 규칙: 인자·반환형 유지(`CREATE OR REPLACE`, DROP 불필요). ①은 `OR (po.provider IN ('payapp','kakaopay') AND EXISTS (… ppt 표식 AND 짝 처리 시각 IS NULL))`, ②는 기존 환불 EXISTS 안에 `AND NOT (rr.provider='payapp' AND rr.status='retryable_failed')`만 더한다(provider 한정을 빼면 카카오 자동 재시도가 사라진다). ①과 ②는 OR 관계다. 환불이 `retryable_failed`여도 취소 표식이 미처리면 ①로 후보가 된다. ①은 기존 백오프 조건(`next_reconcile_at IS NULL OR <= now()`) **밖에** 둔다: `WHERE (기존 후보 조건 AND 백오프 조건) OR (payapp·kakaopay 미처리 표식 조건)`. 누적된 `reconcile_attempt_count` 때문에 최대 60분을 기다리면 취소된 결제의 크레딧 동결이 늦어지기 때문이다. 계약 테스트: `reconcile_attempt_count=10`이고 `next_reconcile_at`이 미래인 주문도 미처리 취소 표식이 있으면 다음 회차 후보가 된다. 잠금은 `FOR UPDATE OF po SKIP LOCKED`(ppt를 잠그지 않음). 후보 정렬은 기존 `ORDER BY po.updated_at ASC`를 유지한다. claim UPDATE 때 `update_payment_orders_updated_at` 트리거가 `updated_at`을 now()로 바꾸므로, 처리에 계속 실패하는 주문도 매 회차 뒤로 밀려 limit을 독점하지 않는다. 이 순환은 트리거 동작에 기대므로 계약 테스트로 고정한다(① 주문 수가 `p_limit` 이상이어도 기존 후보가 몇 회차 안에 잡힌다). TS는 `process_payapp_cancellation`의 보류·일시 오류 결과를 성공이 아니라 `retry_required`/`provider_not_final`로 매핑한다. 두 함수의 조건식은 글자 그대로 같아야 한다(계약 테스트) |
| `get_point_charge_refund_eligibility`, `request_point_charge_refund`, `claim_point_charge_refund` | payapp 조건: `mul_no` 있음, `paid_feedback_recorded_at` 또는 `admin_paid_confirmed_at` 있음, 취소 기록 없음, `approved_at` 있음. claim은 `mul_no`를 반환한다. 모든 provider 공통으로, 원천에 `completed` 환불 요청이 있으면 기존 reason_code `REFUND_SOURCE_NOT_ACTIVE`로 불가(마이그레이션 A, 6.5, 기존 코드라 TS 매핑 변경 없음). 토스 원천 "환불 불가"는 마이그레이션 B2에 넣는다(A에 넣으면 지금 배포된 토스 환불이 바뀐다) |
| `finalize_point_charge_refund` | payapp은 provider 상태 `'CANCELED'`, 취소 키 `payapp-cancel:${mul_no}`, 취소 시각은 `canceldate` 또는 now(). `payment_provider_transactions.provider_cancelled_at`은 `COALESCE(기존 값, 인자)`로 쓴다. `provider='kakaopay' AND origin='partial_cancel'` 요청은 `REFUND_REQUIRES_MANUAL_COMPLETION` 예외로 거부한다(카카오 부분취소 격리는 수동 완료로만 끝난다. 실제 환불액이 아닌 `refund_amount`가 완료 금액으로 남는 것을 막음). payapp 부분취소 격리 요청은 5.5.2의 승인취소(9) 처리 경로가 있으므로 이 거부를 적용하지 않는다 |
| `quarantine_external_provider_cancellation` | payapp 분기 추가(잠금은 5.4 환불 순서). 미지급 payapp 주문에는 호출하지 않는다(5.5.2에서 "지급 전 취소"로 처리). 카카오 분기를 포함한 모든 INSERT·UPDATE가 `origin='external_cancel'`을 설정한다. **지금 배포된 카카오 경로도 바뀌는 변경**이다. 기존 반환 키(`already_completed`, `already_quarantined`, `request_id`, `credits_used`, `used_credit_amount`)는 유지하고 추가만 한다 |
| `quarantine_payapp_partial_cancellation` (신규) | 지급된 주문의 부분취소 70·71. 원천을 `pending_refund`로 묶고, `manual_review` 환불 요청(`origin='partial_cancel'`)을 만든다. 주문은 `manual_review`(`PAYAPP_PARTIAL_CANCEL_QUARANTINED`). 잠금은 5.4 환불 순서. 열린 환불 상태별: `processing`이면 전취소가 진행 중이므로 아무것도 바꾸지 않고 경보만 남기고, **처리 시각(`partial_cancel_processed_at`)을 설정하지 않는다.** 환불이 끝난 뒤 대사가 다시 집는다. 그때 환불이 `completed`면 처리 시각만 설정하고(전액 환불로 부분취소가 흡수됨, 크레딧은 전액 회수가 맞다), 실제 환불액(`expected_amount` − 부분취소 금액)을 감사 기록에 남긴다(`refund_amount`는 신청 때 값으로 남으므로), `retryable_failed`·`manual_review`면 이 격리로 전환한다. `pending_review`·`retryable_failed`·일반 `manual_review`면 이 격리로 전환(`origin` 단방향 전환), 이미 외부 취소 격리 건이면 그대로 둔다 |
| `record_kakaopay_partial_cancel_marker(p_payment_order_id, p_provider_status)` (신규) | 카카오 대사가 `PART_CANCEL_PAYMENT`를 확인하면 **먼저 별도 트랜잭션으로** 부른다. `p_provider_status`는 `'PART_CANCEL_PAYMENT'`만 받는다. `payment_provider_transactions` 카카오 행 한 개만 잠그고 `partial_cancel_feedback_recorded_at`이 NULL이면 now()로 설정해 커밋한다(이미 있으면 그대로, 멱등). 주문 행은 쓰지 않는다(잠금 한 개뿐이라 교착 고리가 없다). 이 표식이 남아 있는 동안 대사 후보 ①이 매 회차 백오프 밖에서 주문을 다시 집는다 |
| `quarantine_kakaopay_partial_cancellation(p_payment_order_id, p_provider_status, p_cancelled_amount)` (신규) | 표식 기록 다음에 부른다. 표식이 없으면 예외. `p_provider_status`는 대사가 조회한 현재 상태를 그대로 받는다(빈 값만 거부). 표식이 있다는 것은 부분취소를 이미 확인했다는 뜻이므로, 그 뒤 결제사에서 잔액까지 취소돼 `CANCEL_PAYMENT`가 됐거나 조회 결과가 스냅샷과 어긋나도 분기는 같고 격리로 끝낸다(표식이 영구히 닫히지 않는 경로를 없앰). 주문·ppt `provider_status`에는 `PART_CANCEL_PAYMENT`·`CANCEL_PAYMENT`일 때만 그 값을 쓰고, 그 밖이면 기존 값을 두고 경보 `KAKAOPAY_PARTIAL_CANCEL_STATE_UNEXPECTED`를 남긴다. 표식이 이미 처리됐으면 아무것도 바꾸지 않고 `already_quarantined=true`. `p_cancelled_amount`는 카카오 응답 `canceled_amount.total`(없으면 NULL, 있으면 1 이상 `expected_amount` 미만)이고, 관리자 알림과 요청 `last_error_message`에 "카카오 부분취소 N원"으로만 남긴다(`refund_amount`에는 쓰지 않는다). 잠금은 5.4 환불 순서이고, **분기는 잠근 뒤 다시 읽은 상태로 정한다**(잠금 전 판단과 다르면 40001). ① `refunded`: 처리 시각 설정, `already_completed`. ② 미지급(`completed`·`manual_review`·`refunded` 아님, 원천 없음): 주문을 `manual_review`(`KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW`)로 바꾸고 처리 시각 설정. 승인 콜백은 `manual_review` 주문을 지급하지 못한다(`record_kakaopay_approval`·`finalize_kakaopay_payment` 상태 가드). ②′ 주문 `manual_review`이고 원천 없음: 변경 없이 처리 시각만 설정, `outcome='manual_review'`, `already_quarantined=true`. ③ 지급됨(원천 있음): 열린 환불(`pending_review`·`processing`·`retryable_failed`·`manual_review`, `completed`·`rejected`는 무시)이 `pending_review`·`processing`·`retryable_failed`·`origin='user'`인 `manual_review`면 `manual_review`·`origin='partial_cancel'`로 전환한다(단방향). `processing`도 바로 전환한다: 처리기는 원금 전액(`refund_amount`=`expected_amount`)을 취소하는데 부분취소 뒤에는 취소 가능액이 모자라 성공할 수 없고, 처리기의 `fail`은 `status='processing'` 가드에 걸려 아무것도 하지 않으며, 카카오에는 멈춘 `processing`을 되살리는 경로가 없기 때문이다(외부 전취소 격리와 같은 근거). 이미 `external_cancel`·`partial_cancel`이면 요청은 그대로 두고 처리 시각만 설정한다(멱등, 알림 없음). 열린 환불이 없으면 `manual_review`·`origin='partial_cancel'` 요청을 만든다(`refund_amount`=`expected_amount`, `cancel_idempotency_key`=`v_order.cancel_idempotency_key`로 `quarantine_external_provider_cancellation`·`request_point_charge_refund`와 같다. 같은 마이그레이션 A에서 `refund_requests_cancel_idempotency_key`를 열린 상태 partial unique로 먼저 재생성하므로 거절·완료 요청이 있어도 23505가 나지 않는다). 전환·생성 모두 `refund_amount`는 신청 기준액(`expected_amount`) 의미 하나로 두고, 실제 고객 총 환불액은 수동 완료 때 확정한다. 원천은 `pending_refund`, 주문은 `manual_review`(같은 code), `last_error_code`도 같은 code(거절 가드·회수량 인자 목록에 이미 있음). 주문과 ppt의 `provider_status`는 위 머리말 규칙대로 현재 상태(`PART_CANCEL_PAYMENT` 또는 `CANCEL_PAYMENT`)로 바꾼다(잔액까지 취소됐다는 사실이 관리자 수동 완료의 판단 근거로 남는다). 그래서 이 주문의 `claim_point_charge_refund`(`SUCCESS_PAYMENT` 요구)와 `finalize_point_charge_refund`는 반드시 실패하고, 종료 경로는 `complete_manual_point_charge_refund`(회수량 인자, ppt 상태를 요구하지 않음)뿐이다. 그 뒤 결제사 관리자에서 잔액이 취소돼 `CANCEL_PAYMENT`가 돼도 주문·환불이 `manual_review`라 자동으로는 잡히지 않고, 관리자가 수동 완료로 끝낸다. ③은 전환·생성·멱등 어느 경우든 끝나면 처리 시각(`partial_cancel_processed_at`)을 설정한다. 처리 시각을 두지 않는 결과는 예외(롤백)뿐이다. 모든 분기에서 처리 시각은 `COALESCE(partial_cancel_processed_at, now())`로 쓴다(불변 트리거와 충돌하지 않게. 처리기와 대사가 같은 주문을 두 번 불러도 멱등). 관리자 알림은 처음 격리할 때 1회. 40001·40P01·55P03이나 중단으로 실패해도 표식이 남아 다음 회차에 다시 처리된다. 반환은 `quarantine_external_provider_cancellation`과 같은 키 + `outcome` |
| `resolve_payment_order_review` (신규) | 6.4 |
| `complete_manual_point_charge_refund` (신규) | 6.5 |
| `reject_point_charge_refund` | `manual_review` 환불 거절을 허용한다(크레딧 동결 해제). **지금 배포된 카카오 환불 동작도 바뀌는 변경**이다. 다음 중 하나라도 해당하면 거부한다: `origin <> 'user'`, `payment_orders.canceled_at IS NOT NULL`, payapp 취소 기록, 카카오 `ppt.provider_status = 'CANCEL_PAYMENT'`, `last_error_code IN ('KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW')`(현재 코드에 있는 부분취소 코드 전부, 명시 목록). 카카오 `CANCEL_PAYMENT` 조건은 `canceled_at`과 겹치지만 그대로 둔다. payapp `provider_status`(숫자)에는 이 비교를 적용하지 않는다. 관리자 확인 항목("결제사 관리자에서 미취소 확인")을 필수로 받고 감사 기록에 남긴다. 기존 반환 키는 유지한다 |
| `enforce_payment_reconciliation_health` | 5.7 |
| `record_payment_alert` (신규) | 5.6 |
| `get_my_payment_history` | 반환 컬럼이 늘어 `CREATE OR REPLACE`가 안 되므로 DROP + CREATE 한다. 기존 컬럼 순서를 유지하고 끝에 `payment_method_label`, `refunded_amount`(6.5의 스칼라 서브쿼리, `source_id` 기준이라 `payment_order_id`가 없는 과거 토스 환불도 포함, NULL 금액은 COALESCE로 0)를 더한 뒤, `authenticated, service_role` 권한을 다시 준다. 라벨 경로: `payment_history.payment_order_id → payment_orders.payment_method_code`(카카오는 `'kakaopay'`로 COALESCE) → `payment_methods.label`. 라벨이 없는 과거 토스 건의 문구("일반결제(이전)")는 SQL이 아니라 TS 표시 로직 한 곳에서 정한다 |
| `get_my_refund_requests` | 끝에 `origin` 컬럼을 더한다. 반환형이 바뀌므로 DROP + CREATE(기존 컬럼 순서 유지), `authenticated, service_role` 재부여. 화면 라벨("결제사 취소 확인 중")은 TS가 `origin`으로 정한다 |
| 토스 전용 7개 | B2에서 drop: `finalize_toss_payment`, `get_toss_refund_eligibility`, `request_toss_refund`, `claim_toss_refund`, `finalize_toss_refund`, `fail_toss_refund`, `reject_toss_refund` |

인덱스 수정 (기존 결함, 마이그레이션 A):
- **문제:** `refund_requests_cancel_idempotency_key`는 환불 상태와 상관없는 unique다. 그래서 다음이 23505로 실패한다.
  - 거절된 환불을 다시 신청하는 경우
  - 거절 뒤 외부 취소가 와서 격리하는 경우 (토스·카카오도 같은 문제가 있다)
- **수정:** 열린 상태(`pending_review`, `processing`, `retryable_failed`, `manual_review`)로 한정한 partial unique로 다시 만든다.
- **안전성:** 조건을 좁히는 것이라 기존 행은 모두 통과한다.

#### 5.5.1 `apply_payapp_feedback`

인자: `p_userid`, `p_mul_no`, `p_orig_mul_no`, `p_order_id`(`var1`), `p_pay_state`, `p_price`, `p_orig_price`, `p_pay_type`, `p_pay_date`, `p_canceldate`.
- `linkkey`·`linkval` 검증은 route가 먼저 끝낸다. 비밀값은 RPC로 넘기지 않는다.

1. **주문 찾기 (잠금 없이):**
   - 기본은 `(provider='payapp', provider_transaction_id=mul_no)`로 찾고, 없으면 `order_id = var1`로 찾는다. 둘 다 있으면 서로 일치해야 한다.
   - 70·71은 `orig_mul_no`로 찾는다.
   - 여기서 얻은 것은 주문 id뿐이다. 판단은 2단계에서 잠근 행으로 한다.
2. **잠금과 검증:** 4·1·8·16·32·10은 `payment_orders FOR UPDATE` → `payment_provider_transactions FOR UPDATE`(주문 상태 변경은 CAS). 9·64·70·71은 `payment_provider_transactions FOR UPDATE`만 잡고, 주문은 불변 스냅샷 값(`expected_amount`, `provider_merchant_id`)만 잠금 없이 읽으며 주문 행을 쓰지 않는다. 검증:
   - `userid = provider_merchant_id`
   - 금액 = `expected_amount`. 4·9·64는 `price`, 70·71은 `orig_price`로 비교한다.
   - `mul_no`가 저장된 값과 같아야 한다. 저장된 값이 없으면 이때 저장한다. 다른 주문이 이미 쓰는 값이면 unique_violation을 잡아 `PAYAPP_MUL_NO_CONFLICT`로 돌려준다.
   - 실패 처리: 4·1·8·16·32에서 미지급 주문이면 `manual_review`(`PAYAPP_FEEDBACK_MISMATCH`)로 보낸다. 지급이나 환불이 끝난 주문, 그리고 9·64·70·71(표식 경로)은 주문 상태를 바꾸지 않고 표식도 남기지 않는다. 결과는 모두 `ignored`이고, route가 경보를 남긴다.
3. **기록 (전용 컬럼, 한 번 설정하면 트리거로 변경 금지):**
   - 4: `paid_feedback_recorded_at`, `provider_paid_at`, `paid_amount`, `payment_method_type`(`pay_type`)
   - 9·64: `cancel_feedback_recorded_at`, `provider_cancelled_at`
   - 70·71: `partial_cancel_feedback_recorded_at`
   - `provider_status`는 숫자를 거꾸로 되돌리지 않는다(늦게 온 1이 4를 덮지 않음). 판단에는 쓰지 않는다.
4. **상태별 처리:**

| `pay_state` | 처리 |
|---|---|
| 1 | `ready_unknown`이면 `mul_no` 저장만 한다 |
| 4 | 취소 기록(9·64 또는 70·71)이 있으면 지급하지 않는다(`cancelled_before_fulfillment`). 이미 지급됐으면(`source_id` 있음) `already_fulfilled`. 그 밖에는 `fulfillment_pending`으로 바꾸고 지급 서브블록을 실행한다. 성공하면 `fulfilled`, 실패하면 서브블록만 롤백되고 `fulfillment_pending`으로 남는다(`recorded_pending`, 대사가 재시도). 지급을 허용하는 상태는 `completed`/`refunded`를 뺀 전부다(`failed`·`expired`·`manual_review` 포함). 돈을 받았으면 지급한다 |
| 8, 16, 32 | 미결제(`ready`, `ready_unknown`)이거나, 결제완료·취소 기록 없이 `manual_review`(`PAYAPP_READY_CANCEL_FAILED`)인 주문이면 `expired`(CAS). 그 외에는 무시한다 |
| 9, 64, 70, 71 | 표식만 기록하고 커밋한다(`cancel_marker_recorded`). 처리는 5.5.2 `process_payapp_cancellation`이 별도 트랜잭션에서 한다. 표식이 남으므로 이후 4가 와도 지급되지 않는다 |
| 10, 기타 | 기록만 한다 |

#### 5.5.2 `process_payapp_cancellation(p_order_id)`

- **호출:** 웹훅이 표식 기록 직후 한 번 부르고, 대사가 (`cancel_feedback_recorded_at` 있음 AND `cancel_processed_at` NULL) 또는 (`partial_cancel_feedback_recorded_at` 있음 AND `partial_cancel_processed_at` NULL)인 주문에 다시 부른다. 멱등이다.
- **잠금:**
  - 열린 환불 요청과 원천 id를 잠금 없이 찾는다.
  - 그다음 5.4 환불 순서(`refund_requests → credit_sources → payment_orders → payment_provider_transactions → profiles`)로 잠근다.
  - 잠근 뒤 `status`, `source_id`, 열린 환불 id·상태, 표식을 **다시 읽는다.** 잠금 전 판단과 다르면 아무것도 쓰지 않고 `40001`을 던져 재시도한다. 웹훅은 `FAIL`을 응답하고, 대사는 다음 회차에 다시 처리한다.
- **처리:** 모든 결과에서 해당 표식의 처리 시각(9·64 → `cancel_processed_at`, 70·71 → `partial_cancel_processed_at`)을 설정한다. 두 표식이 다 미처리면 9·64를 먼저 처리한다. 70 처리 뒤 9가 오면 9는 "지급된 주문" 표로 처리하고(부분취소 격리 건이면 아무것도 바꾸지 않고 경보), 9 처리 뒤 70이 오면 아무것도 바꾸지 않고 경보만 남긴다.

| 표식 | 주문 상태(잠금 후) | 처리 |
|---|---|---|
| 9·64 | 미지급(`source_id IS NULL`) | 주문 `failed`(`PAYAPP_CANCELLED_BEFORE_FULFILLMENT`) |
| 9·64 | 지급됨 | 아래 표 |
| 70·71 | 미지급 | 주문 `manual_review`(`PAYAPP_PARTIAL_CANCEL`). 해소는 6.4 `cancel_handled` |
| 70·71 | 지급됨 | `quarantine_payapp_partial_cancellation` |

지급된 주문에 9·64가 오면:

| 주문·환불 상태 | 처리 |
|---|---|
| 열린 환불이 `processing`, `retryable_failed`, 일반 `manual_review` | `finalize_point_charge_refund` |
| 열린 환불이 `pending_review`이거나 열린 환불 없음 | `quarantine_external_provider_cancellation` |
| 격리 건 `manual_review` | 아무것도 안 함(`already_quarantined`) |
| 주문이 `refunded` | 아무것도 안 함. 완료된 요청의 취소 키가 NULL이고 감사 기록의 외부 처리 방식이 "계좌 송금"이면 이중 환불 의심 결과를 돌려준다. "페이앱 취소 요청(paycancelreq)"이면 정상이다 |

**실패 대체 처리:** 40P01·40001·55P03을 뺀 모든 오류로 처리가 실패하면 서브블록을 롤백하고, 바깥에서 환불 순서로 다시 잠근 뒤 다음을 한다.
- 원천: `UPDATE credit_sources SET status='pending_refund' WHERE id = … AND status = 'active'`. 원천이 없거나 이미 `refunded`면 건드리지 않는다.
- 환불 요청: 열린 요청이 있으면 그것을 `manual_review`로 바꾸고 `origin`이 `'user'`일 때만 `'external_cancel'`로 전환한다(이미 격리 origin이면 유지). `processing` 요청을 `manual_review`로 바꿔도 안전하다. 진행 중인 처리기의 `fail`은 `status='processing'` 가드에 걸려 아무것도 하지 않고, `finalize`는 `manual_review`에서도 허용된다. 열린 요청이 없으면 새로 `manual_review`(`origin='external_cancel'`)로 만든다. `refund_requests_one_open_source` 때문에 기존 열린 요청을 먼저 찾는다. 원천이 묶였을 때만 만든다.
- 주문: `manual_review`(`PAYAPP_CANCEL_HANDLING_FAILED`).
- 해소: 환불 요청이 있으면 `complete_manual_point_charge_refund`, 원천이 없거나 이미 환불된 건이면 6.4 `cancel_handled`로 해소한다.

route는 결과 코드로 이벤트 상태와 응답을 정한다(취소 표식은 기록 후 `process_payapp_cancellation`까지 부른 결과로 정한다).
- **일시 오류**(예외, 40P01·40001·55P03 포함): 이벤트 `failed`, 응답 `FAIL`.
- **그 밖의 모든 결과:** 이벤트 `completed`(검증 실패는 `ignored`), 응답 `SUCCESS`.
- 이벤트 갱신은 `WHERE processing_status <> 'completed'` 조건을 건다. 늦게 끝난 쪽이 completed를 되돌리지 않게 하기 위해서다.
- 이미 `completed`·`ignored`인 이벤트에 같은 통보가 다시 오면 처리를 생략하고 `SUCCESS`를 응답한다.
- `payload_hash`는 `linkkey`, `linkval`, `feedbacktype`을 빼고 계산한다.

### 5.6 경보와 감사 기록

- **현재 경보 테이블의 제약:**
  - `payment_reconciliation_alerts`는 지금 service_role이 읽기만 할 수 있다.
  - 미해소 경보는 code당 1건만 둘 수 있다(partial unique).
  - 남아 있던 미해소 경보 2건(2026-09-11·12, 스케줄러 관련)은 2026-10-19에 해소했다.
- **신규 `record_payment_alert(p_code, p_severity, p_message, p_details)`:**
  - `ON CONFLICT DO NOTHING`으로 쓴다.
  - route와 대사가 지급·환불과 **별도 트랜잭션**으로 호출한다. 경보 실패가 결제 처리를 실패시키지 않는다.
- **주문별 이상**(금액·`pay_type` 불일치, 이중 환불 의심)은 code 1건 제한에 묻히지 않도록 주문 id를 담아 관리자 `notifications`로도 남긴다.
- **관리자 결제 확인 화면:** 미해소 경보와 `manual_review` 주문을 함께 보여준다. `resolve_payment_order_review`가 관련 경보를 해소한다.
- **기존 미해소 2건:** 사용자 승인을 받아 2026-10-19에 해소했다(2장 기준선). 출시 전에는 미해소 0건만 다시 확인한다.
- **감사 테이블 `payment_admin_actions` (신규, append-only):**
  - 컬럼: actor, action, `payment_order_id`, `refund_request_id`, 변경 전후 상태, note, 회수·미회수 크레딧, 외부 처리 방식, `created_at`.
  - 대상: 관리자 해소, 수동 환불 완료, 관리자 지급, `manual_review` 거절.
  - 권한: RLS를 켜고 service_role은 SELECT만 받는다. 쓰기는 관리 RPC(SECURITY DEFINER) 안에서만 한다. UPDATE·DELETE를 막는 트리거로 append-only를 강제한다.
  - 수동 환불 완료와 지급처럼 `profiles.credits`를 다시 계산하는 조치는 재계산 전후 잔액을 둘 다 남긴다. 기존 잔액 드리프트가 함께 정정될 수 있기 때문이다.
  - `refund_requests.processed_by`·`admin_note`는 재승인 때 덮어써지므로 감사 기록으로 쓰지 않는다.

### 5.7 health 점검 (페이앱)

- **카카오페이 블록은 한 글자도 바꾸지 않는다.** 계약 테스트로 본문을 비교하고, 반환 키 `kakaopay_disabled`도 유지한다.
- **페이앱은 별도로 둔다:** 변수, UPDATE, 경보 code(`PAYAPP_…`), 반환 키 `payapp_disabled` 모두 따로다.

페이앱 신규 주문을 끄는 조건(돈이 걸린 위험만):
1. **결제완료가 기록됐는데 미지급:** `paid_feedback_recorded_at <= now() - 10분`, `source_id IS NULL`, 취소 기록 없음. 주문 상태는 보지 않는다.
   - `updated_at`은 쓰지 않는다. 대사가 돌 때마다 트리거가 갱신하기 때문이다.
2. **돈 위험 `manual_review`:** failure_code가 `PAYAPP_FEEDBACK_MISMATCH`, `PAYAPP_MUL_NO_CONFLICT`, `PAYAPP_PARTIAL_CANCEL`, `PAYAPP_READY_CANCEL_FAILED`, `PAYAPP_FULFILLMENT_RETRY_EXHAUSTED`, `PAYAPP_CANCEL_HANDLING_FAILED` 중 하나.
3. **대사 스케줄러 이상:** 기존 stale·연속 실패 3회 조건. 통보가 유실됐을 때 대사가 유일한 백업이기 때문이다.
4. **취소 표식 미처리 + 크레딧 사용 가능:** (`cancel_feedback_recorded_at <= now() - 10분 AND cancel_processed_at IS NULL` 또는 `partial_cancel_feedback_recorded_at <= now() - 10분 AND partial_cancel_processed_at IS NULL`) 이면서 그 주문의 원천이 아직 `active`(`EXISTS (SELECT 1 FROM credit_sources cs WHERE cs.payment_order_id = po.id AND cs.status = 'active')`). 경보 code `PAYAPP_CANCEL_UNPROCESSED`. 취소된 결제의 크레딧이 쓰일 수 있기 때문이다.
   - 원천이 이미 `pending_refund`이거나(환불 처리 중 부분취소 등) 미지급 주문(원천 없음, 표식이 지급을 막음)의 미처리 표식은 돈 위험이 없으므로 판매는 끄지 않고 경보만 남긴다.

카카오 부분취소 표식 블록(신규, 기존 카카오 블록과 별도로 둔다):
- `po.provider='kakaopay' AND ppt.partial_cancel_feedback_recorded_at <= now() - 10분 AND ppt.partial_cancel_processed_at IS NULL`이면서 원천이 `active`면 `kakaopay_accepts_new_orders=false`, 경보 code `KAKAOPAY_PARTIAL_CANCEL_UNPROCESSED`. 원천이 없거나 `pending_refund`·`refunded`면 경보만 남긴다.
- 기존 카카오 블록 본문 비교 계약 테스트는 그대로 통과해야 한다. 비교 범위는 기존 카카오 `SELECT COUNT …`부터 경보 INSERT의 `END IF`까지다. 새 블록은 그 밖에 두고 자기 변수(`v_kakao_marker_disable`)와 자기 code만 쓴다(기존 `v_should_disable`·`v_code`를 재사용하지 않는다).
- 반환: `'kakaopay_disabled', v_should_disable OR v_kakao_marker_disable`, `'healthy', NOT (v_should_disable OR v_kakao_marker_disable)`(payapp 조건은 `payapp_disabled`로 따로). 반환값을 읽는 TS는 없다(`record_payment_reconciliation_result`가 그대로 넘길 뿐).

끄지 않는 것:
- 외부 취소·부분취소 격리(`EXTERNAL_PROVIDER_CANCELLATION`, `PAYAPP_PARTIAL_CANCEL_QUARANTINED`): 크레딧이 이미 묶여 있다.
- 지급 전 취소(`PAYAPP_CANCELLED_BEFORE_FULFILLMENT`)
- 환불 수동 처리 대기

2장의 "manual_review 1건이면 끈다"는 카카오페이의 현재 동작을 설명한 것이다. 페이앱은 이 기준을 따른다.

## 6. 서버 모듈과 route

### 6.1 `src/lib/payapp-server.ts` (신규)

- **설정 확인 함수 두 개:**
  - `getPayAppConfig()`: `PAYAPP_USERID`, `PAYAPP_LINKKEY`, `PAYAPP_LINKVAL`, `PAYMENT_CALLBACK_ORIGIN`(https)만 확인한다. 통보, 대사, 환불, `paycancel`은 이것만 쓴다. 그래서 사고 대응으로 `PAYMENTS_ENABLED=false`를 해도 이미 결제된 건의 통보와 환불은 계속 처리된다.
  - `assertPayAppReady()`: 위 조건에 `PAYMENTS_ENABLED==='true'`를 더한다. 주문 생성에만 쓴다.
- **`requestPayAppPayment({ orderId, goodname, price, vat, recvphone, openPayType })`:** `payrequest`를 보낸다.
  - 회원 식별값(`buyerid`)과 이메일은 보내지 않는다(개인정보 최소 제공).
  - 보내는 값: `smsuse=n`, `checkretry=y`, `skip_cstpage=y`
  - 주소: `feedbackurl=${origin}/api/payments/webhooks/payapp`, `returnurl=${origin}/api/payments/payapp/return?orderId=…`
  - 금액: `amount_taxable`, `amount_vat`
  - 타임아웃: 10초
- **`cancelPayAppPayment({ mulNo, memo, mode })`:** `paycancel` 전취소. `mode='ready'`는 미결제 요청 취소다.
- **`parsePayAppResponse()`:** `state !== '1'`이면 실패로 돌려주고 `errorCode`·`errorMessage`를 보존한다. 네트워크 오류·타임아웃·5xx는 "재시도 가능" 실패로 따로 구분한다.
- **`verifyPayAppFeedback(form)`:** `userid`·`linkkey`·`linkval`을 timing-safe로 비교한다. 이어서 숫자 필드를 엄격하게 파싱하고, 날짜를 KST로 해석한다(5.4).

### 6.2 route

| 경로 | 역할 |
|---|---|
| `POST /api/payments/payapp/orders` (신규) | 아래 순서 참고 |
| `POST /api/payments/webhooks/payapp` (신규) | 아래 순서 참고 |
| `GET·POST /api/payments/payapp/return` (신규) | 페이앱 복귀. 받은 값은 신뢰하지 않고, `orderId`만 붙여 `/checkout/payapp/result`로 303 이동한다 |
| `GET /api/payments/payapp/status` (신규) | 본인 주문 상태(`completed`/`pending`/`failed`/`expired`). 카카오페이 status route와 같은 모양. `fulfillment_pending`·`manual_review`는 `pending`("결제 확인 중")으로 보인다. `failed`·`expired`는 "결제되지 않았습니다. 이미 결제하셨다면 확인 후 자동 반영됩니다"로 안내해 재결제를 서두르지 않게 한다 |
| `/checkout/payapp/result` (신규 페이지) | 카카오페이 결과 화면과 같은 패턴. 완료면 충전된 크레딧을 보여준다. 대기면 최대 약 60초 폴링한 뒤 "결제 확인 중. 마이페이지 결제내역에서 확인" 안내를 띄운다 |

`POST /api/payments/payapp/orders`:
1. **검증:** 로그인, 요금제, 결제수단(`payment_methods`, `provider='payapp'`, 사용 중), 휴대폰 번호(01X 형식), 운영 스위치(`assertPayAppReady`).
2. **요청 흐름:** `prepare_payment_order`(fingerprint에 결제수단·휴대폰 번호 포함) → `begin_payapp_request` → `payrequest` → `store_payapp_request` → `{ payurl }` 반환.
   - `begin`이 `claimed:false`: payrequest를 보내지 않고 `PAYMENT_ATTEMPT_UNKNOWN`을 반환한다. 클라이언트는 새 결제 시도 ID로 다시 요청한다.
   - `state=0`: `fail_payapp_request`로 실패 처리하고 오류를 보여준다.
   - 타임아웃·응답 유실·`store` 실패: `payurl`을 돌려주지 않는다. 주문은 `ready_unknown`으로 남고, 사용자에게 "결제 요청을 확인하지 못했습니다. 다시 시도해 주세요"를 보여준다(새 시도 ID).
3. **같은 결제 시도로 다시 요청했을 때:**

| 기존 주문 상태 | 응답 |
|---|---|
| `ready`, 만료 전 | 기존 `payurl` 재사용 |
| `completed`, `fulfillment_pending` | 결과 화면 주소. 다시 결제하지 않게 한다 |
| `ready_unknown`, `preparing` | `PAYMENT_ATTEMPT_UNKNOWN` |
| 만료·실패 | `PAYMENT_ATTEMPT_EXPIRED` |

4. 휴대폰 번호가 프로필에 없을 때 "다음에도 이 번호 사용"을 고르면 `profiles.phone`에 저장한다.

`POST /api/payments/webhooks/payapp`:
1. **인증:** form을 파싱하고 인증한다(`getPayAppConfig`). 실패하면 `FAIL`을 응답하고 `record_payment_alert`를 남긴다. 페이앱이 재통보하므로, 우리 키 설정이 틀린 경우 고칠 시간을 번다.
2. **이벤트 기록:** `payment_webhook_events`에 `payapp:${mul_no}:${pay_state}`로 기록한다.
   - `order_id`는 비워 둔다. 기존 대사 함수가 이 이벤트를 덮어쓰지 않게 하기 위해서다. 주문 연결은 `payment_provider_transactions`로 한다.
   - 이미 `completed`·`ignored`인 이벤트면 처리를 생략하고 `SUCCESS`를 응답한다.
3. **처리:** `apply_payapp_feedback`를 호출한다. 결과가 `cancel_marker_recorded`면 이어서 `process_payapp_cancellation`을 별도 호출한다. 처리가 일시 오류로 실패하면 `FAIL`을 응답한다. 표식은 이미 커밋돼 있어서 재통보나 대사가 처리를 다시 시도한다. 그 밖에는 결과 코드로 이벤트 상태와 응답을 정한다(5.5.1).
4. **후속 처리(별도 트랜잭션):** 경보(`record_payment_alert`), 관리자 알림, 사용자 알림(충전 완료, 환불 완료). 이 단계가 실패해도 응답은 바뀌지 않는다.
5. 토스 route의 "중복이면 바로 성공" 방식은 쓰지 않는다. 그 방식이면 첫 처리가 실패한 뒤 온 재통보가 유실된다.

### 6.3 대사 (조회 API가 없는 대신)

`reconcilePaymentOrder`에 payapp 분기를 추가한다.
- 대사는 잠금 없이 읽어서 분기만 정한다. 상태 변경은 모두 CAS RPC로 한다.
- 기존 `reconcileCancellation`은 payapp에 쓰지 않는다. `pending_review`에도 finalize를 불러 실패하기 때문이다.

| 주문 상태 | 처리 |
|---|---|
| (`cancel_feedback_recorded_at` 있음 AND `cancel_processed_at` NULL) 또는 (`partial_cancel_feedback_recorded_at` 있음 AND `partial_cancel_processed_at` NULL) (주문 상태 무관) | `process_payapp_cancellation`. 가장 먼저 처리한다 |
| `fulfillment_pending` | `retry_payapp_fulfillment`. 실패하면 백오프로 재시도하고, 3회 실패하면 `manual_review`(`PAYAPP_FULFILLMENT_RETRY_EXHAUSTED`) + 경보 |
| `preparing`, 30분 경과 | `mark_payapp_order_terminal(expected='preparing', 'expired')` |
| `ready_unknown`, 30분 경과 | `mul_no`가 있으면 `cancelmode=ready`를 시도한 뒤 `expired`(CAS), 없으면 바로 `expired`(CAS). 결제완료 기록이 있으면 terminal RPC가 거부하므로 지급 경로로 넘어간다 |
| `ready`, 결제 만료 경과 | `paycancel cancelmode=ready`. 성공하면 `expired`(CAS). 실패하면 다음 회차에 다시 시도하고, 2시간 뒤에도 그대로면 `manual_review`(`PAYAPP_READY_CANCEL_FAILED`, CAS) |
| `completed`, 환불이 `processing`으로 10분 이상 | `requeue_stuck_point_charge_refund` → `retryable_failed`. 재시도는 관리자 재승인으로 한다(자동 재시도 없음, 대사 후보에서 빠짐). 전취소는 두 번 되지 않으므로 재승인해도 안전하다 |
| 그 밖의 `completed` | 아무것도 하지 않는다(`provider_not_final`) |

### 6.4 `manual_review` 해소와 판매 재개

관리자 결제 확인 화면에서 `resolve_payment_order_review(p_order_id, p_action, p_actor, p_note, p_mul_no?, p_paid_at?)`로 처리한다.
- 주문을 `FOR UPDATE`로 잠근다.
- 처리자와 메모는 필수다.
- 모든 조치는 `payment_admin_actions`에 기록하고, 관련 경보를 해소한다.

| 조치 | 가드와 처리 |
|---|---|
| `paid_confirmed` (결제 확인됨) | 취소 기록이 있거나 격리 건이면 거부한다. 결제완료 기록이 있으면 그 값으로 지급한다. 없으면 관리자 지급이다: `mul_no` 필수(unique라 다른 주문에 다시 쓸 수 없음), 지급액은 `expected_amount`, `admin_paid_confirmed_at`·`approved_at`은 관리자가 입력한 결제 시각(없으면 now()), 감사 기록에 지급 방식 admin을 남긴다. 환불 자격은 일반 건과 같다(`admin_paid_confirmed_at`으로 인정) |
| `unpaid_confirmed` (미결제 확인) | `source_id`, 결제완료 기록, 취소 기록 중 하나라도 있으면 거부한다. 그 밖에는 `expired` |
| `cancel_handled` (취소 처리 확인) | 대상: 미지급 부분취소(`PAYAPP_PARTIAL_CANCEL`), 원천이 없거나 이미 환불된 `PAYAPP_CANCEL_HANDLING_FAILED`, 그리고 원천이 없는 카카오 `KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW`(5.5 ②·②′, 처리된 부분취소 표식이 있어 `unpaid_confirmed`가 거부되므로 이것이 유일한 해소 경로). 활성·묶인 원천이 있으면 거부하고 `complete_manual_point_charge_refund`로 보낸다. 처리자·메모·외부 처리 방식이 필수다. 결과는 미지급이면 `failed`, 지급 후 환불됐으면 `refunded`. 감사 기록을 남긴다 |

- 외부 취소·부분취소 격리 건은 이 RPC가 아니라 `complete_manual_point_charge_refund`(6.5)로 해소한다.
- **판매 재개:** 5.7 조건이 0건인지 확인한 뒤 마이그레이션으로 `payapp_accepts_new_orders=true`를 설정한다(`changed_by`, `change_ticket` 기록, 사용자 승인 후 적용).

### 6.5 환불

`point-charge-refund-processor.ts`에 payapp 분기를 추가한다.
- **요청:** `claim_point_charge_refund` → `paycancel`(전취소, `cancelmemo`=환불 요청 번호).
- **성공(`state=1`):** `finalize_point_charge_refund`(`'CANCELED'`, 키 `payapp-cancel:${mul_no}`). 뒤에 오는 9·64 통보는 이미 완료된 환불이라 아무것도 하지 않는다.
- **실패(`state=0`):** 정산 후, 휴대폰 당월 경과 등의 경우다. `fail_point_charge_refund`로 `manual_review` 처리하고 `errorCode`·`errorMessage`를 저장한다. 오류 코드로 분기하지 않는다.
- **네트워크 오류·타임아웃·5xx:** `retryable_failed`로 둔다. 재시도에서 "이미 취소" 실패가 나더라도, 9·64 통보가 그 환불을 완료 처리한다.
- **오류 코드 보존:** `callRefundRpc`가 RPC 오류 코드를 일반 문구로 뭉개지 않게 원래 코드를 보존한다. 웹훅과 처리기가 영구 실패와 일시 오류를 구분해야 하기 때문이다.
- **처리기 오류 응답:** 처리기 catch에서 환불 요청 상태를 다시 읽는다. 그사이 웹훅이 완료했으면(교착으로 처리기 쪽이 롤백된 경우 등) 관리자에게 성공으로 응답한다.
- **사용자 알림:** 9·64 통보나 수동 완료로 끝난 환불도 완료 알림을 보낸다. 지금은 관리자 route에서만 보낸다.

**수동 환불 완료 `complete_manual_point_charge_refund`:**
- 관리자 환불 화면의 "수동 환불 완료 처리" 버튼으로 실행한다. 메모와 외부 처리 방식(페이앱 취소 요청 / 계좌 송금)이 필수다.
- 가드:
  - 환불 요청이 `manual_review`일 때만 진행한다. 이미 `completed`면 그대로 성공을 돌려준다(멱등).
  - 주문은 `completed` 또는 `manual_review`, 원천은 `pending_refund`여야 한다.
- 처리:
  - 환불 요청의 `provider_cancel_transaction_key`는 NULL로 둔다. 외부 처리 방식은 감사 기록에만 남긴다(이중 환불 판정 근거, 5.5.1).
  - 회수량 인자: `origin='partial_cancel'`이거나, 주문에 부분취소 표식(`partial_cancel_feedback_recorded_at`)이 있거나, `last_error_code IN ('KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW')`(거절 가드와 같은 목록)이면 회수량과 실제 환불 금액을 인자로 받는다(회수량은 0 이상 remaining 이하). 실제로 일부만 환불됐을 수 있기 때문이다. 그 밖에는 남은 크레딧을 전부 회수한다.
  - 원장 처리:
    - `credit_sources.remaining_credits -= 회수량`
    - 남은 값이 0보다 크면 `status='active'`(동결 해제, 다시 쓸 수 있음), 0이면 `refunded`
    - `credit_transactions`에 `-회수량`을 기록한다(회수량이 0이면 원장 행 없이 감사 기록만)
    - 주문과 `payment_history`: 전액 회수(남은 값 0, 원천 `refunded`)면 `refunded`, 부분이면 `completed`로 되돌린다
    - 환불 요청: `completed`, `refund_amount`는 페이앱 부분취소 금액을 포함한 고객 총 환불액(1 이상). 0이면 RPC 입력 검증에서 거부한다(`refund_requests_refund_amount_check`가 NULL 또는 1~100000만 허용). 실제 금액은 감사 기록에도 남긴다
  - 감사 기록에는 이미 쓴 양(initial − 처리 전 remaining), 회수량, 사용자에게 남긴 양(처리 후 remaining), 실제 환불 금액을 따로 남긴다.
  - 재신청 차단: `get_point_charge_refund_eligibility`는 그 원천에 `completed` 환불 요청이 하나라도 있으면 기존 reason_code `REFUND_SOURCE_NOT_ACTIVE`로 환불 불가를 반환한다(모든 provider, 카카오에도 적용되는 규칙 변경이지만 현재 데이터 영향 0건. 기존 코드를 써서 TS 문구 매핑 변경이 필요 없다). 회수량 0으로 remaining=initial이 돼도 신청 → 부분취소 오류 → MR이 반복되지 않게 하기 위함이다.
  - 사용자 결제내역: `get_my_payment_history`가 끝에 `refunded_amount`를 더 돌려준다. JOIN하면 행이 중복돼 페이지 나눔이 틀어지므로 스칼라 서브쿼리 `COALESCE((SELECT SUM(rr.refund_amount) FROM refund_requests rr WHERE rr.source_id = ph.source_id AND rr.status = 'completed'), 0)`로 계산한다(계약 테스트: 완료 환불 2건이어도 결제내역 행은 1개). 그리고 TS가 "부분 환불 N원"으로 표시한다(DROP + CREATE 대상에 이미 포함). 회수할 크레딧이 0이면 원장 행 없이 감사 기록만 남긴다.
  - `profiles.credits`는 원천 합계로 다시 계산한다(음수 없음). 주문은 전액 회수일 때만 `refunded`가 된다. 부분 회수로 `completed`에 되돌릴 때는 `failure_code`·`failure_message`(`PAYAPP_PARTIAL_CANCEL_QUARANTINED`)를 지운다(관리자 화면과 health 집계 오해 방지).
- 안내 문구: "페이앱 관리자에서 취소 요청(정산금 반환) 또는 고객 계좌 송금 후 완료 처리"

**`manual_review` 환불 거절:** 확장한 `reject_point_charge_refund`로 처리한다. 환불하지 않기로 했을 때 크레딧 동결을 푼다. 격리 건은 거절할 수 없다.

**카카오 대사 부분취소 (사용자 결정 2026-10-19: 페이앱처럼 크레딧을 묶는다, 마이그레이션 A + 단계 4):**
- 지금 동작(`payment-reconciliation-server.ts:473-479`, `PART_CANCEL_PAYMENT` → `markManualReview`)을 운영 함수 정의로 다시 확인한 결과:
  - 미지급 주문: 원천이 없으므로 크레딧 노출은 없다. 다만 대사가 `PART_CANCEL_PAYMENT`를 읽은 뒤 승인 콜백이 지급을 끝내면, `mark_payment_reconciliation_terminal`이 `completed` 주문을 건너뛰어 부분취소가 기록되지 않고 원천이 `active`로 남는다(경합).
  - 지급된 주문(열린 환불이 `processing`·`retryable_failed`라 대사 후보가 된 경우): 같은 함수가 `completed` 주문을 건너뛰어 아무것도 바뀌지 않는다. 결과 `manual_review`는 `next_reconcile_at`을 NULL로 두므로 매 회차 다시 집혀 카카오 조회를 반복하고, 환불 요청이 `manual_review`가 아니라 `complete_manual`로 끝낼 수도 없다. 원천은 사용자 신청 때 `pending_refund`로 묶여 있어 크레딧 노출은 없다.
- 수정 (페이앱 취소 통보와 같은 2단계):
  1. 대사가 `PART_CANCEL_PAYMENT`를 확인하면 `record_kakaopay_partial_cancel_marker`로 표식을 먼저 커밋한다.
  - 대사 카카오 분기는 결제사 조회 직후, 조회 상태 분기보다 먼저 ppt 표식을 본다. 표식이 미처리면 조회 상태가 무엇이든(스냅샷 검증 실패 포함) 2번을 그 상태로 부르고, `reconcileCancellation`·`markManualReview`로 가지 않는다. 조회 자체가 실패(네트워크)한 경우만 `retry_required`다.
  2. 이어서 `quarantine_kakaopay_partial_cancellation`(5.5)을 부르고 결과를 대사 결과로 쓴다(40001·40P01·55P03은 `retry_required`).
  3. 환불 처리기(`src/lib/point-charge-refund-processor.ts`)도 같은 두 RPC를 부른다. 사전 조회가 `PART_CANCEL_PAYMENT`인 분기(지금은 `fail`만 해서 사용자 `origin`·주문 `completed`로 남고 판매도 멈추지 않음), 그리고 취소 API가 확정 실패(`retryable:false`)했을 때 결제사 주문을 다시 조회해 `PART_CANCEL_PAYMENT`인 경우다. 둘 다 `fail` 뒤에 부르고, 실패해도 표식이 남아 대사가 이어받는다.
  - 표식이 처리 시각 없이 남아 있으면 대사 후보 ①이 백오프 밖에서 매 회차 다시 집는다. 그래서 대사가 읽은 뒤 승인 콜백이 지급을 끝낸 경합(40001), 교착, 중단이 있어도 다음 회차에 지급된 주문 경로로 격리된다. 지금 후보 조건만으로는 `completed`·열린 환불 없음 주문이 후보에서 영구히 빠지므로 표식이 꼭 필요하다.
  - 표식 덕분에 `completed` 주문 + `pending_review`·사용자 `manual_review` 환불도 재처리 때 격리 분기에 도달한다. 환불 처리기가 부분취소 뒤 전취소에 실패해 사용자 `manual_review`가 된 경우도 처리기(3) 또는 다음 회차 대사가 `partial_cancel`로 전환한다.
  - 지급된 주문은 원천 `pending_refund` + `manual_review`·`origin='partial_cancel'` 환불로 격리돼 `complete_manual`(회수량 인자)로 끝낼 수 있다.
- health 영향: 카카오 health 함수 본문(기존 카카오 블록)은 그대로지만 **효과가 넓어진다.** 지금은 지급된 주문의 부분취소가 건너뛰어져 판매가 꺼지지 않았는데, 변경 뒤에는 ③이 주문을 `manual_review`로 바꾸므로 카카오 신규 주문이 꺼진다(외부 전취소 격리와 같은 동작, 다시 켜려면 마이그레이션). 또 5.7의 카카오 표식 블록이 미처리 표식 + 원천 `active`가 10분 넘으면 판매를 끈다.
- 범위 밖 한계: 카카오는 통보가 없어, 지급 완료·열린 환불 없음 주문이 카카오 관리자에서 부분취소되면 대사 후보가 아니므로 감지되지 않는다(지금도 같다). 결제사 관리자 취소는 운영 절차로 우리 관리자 화면에 반영한다.
- 배포 순서: RPC는 마이그레이션 A에 추가만 하고, TS 호출 변경은 단계 4(A 적용 뒤 배포)에 넣는다. A만 적용된 동안은 지금 동작과 같다.

**크레딧 함수 권한 (사용자 결정 2026-10-19: 회수, 마이그레이션 A):**
- `consume_credits_once(uuid,integer,text,uuid,text,text)`, `refund_credits_once(uuid,integer,text,uuid,text,text,text,integer)`는 운영에만 있는 함수(마이그레이션 정의 없음, `docs/cart-db-audit.md`)이고 SECURITY INVOKER다. 현재 ACL: `consume_credits_once`는 PUBLIC·anon·authenticated·service_role, `refund_credits_once`는 anon·service_role.
- 저장소 코드·다른 DB 함수에서 호출하는 곳이 없다(2026-10-19 확인: `src` grep 0건, `pg_proc.prosrc` 참조 0건).
- 마이그레이션 A에서 `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`를 하고 service_role·postgres는 남긴다. 함수 본문은 건드리지 않는다. 롤백 파일은 기존 ACL을 그대로 되돌린다.
- 두 함수는 저장소 마이그레이션에 없어 로컬 `supabase db reset`에는 존재하지 않는다. 그래서 회수·검증·롤백 GRANT를 모두 `to_regprocedure('<인자 타입까지 쓴 서명>') IS NOT NULL`일 때만 실행하는 DO 블록으로 감싼다(없으면 `RAISE NOTICE`). 서명이 틀려 운영에서 조용히 건너뛰는 일을 막기 위해, 운영 리허설과 적용 뒤 확인(체크리스트 A-post 3)에서는 두 `to_regprocedure`가 NOT NULL인지를 필수로 확인한다.

**기존 결함 (이번 범위 밖, 기록만):**
- `refund_credits`가 원천 상태를 보지 않고 remaining을 복원한다.
- `consume_credits`와 환불 함수의 잠금 순서가 서로 반대다.

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
- 테스트: 토스를 읽는 테스트를 페이앱 기준으로 교체하거나 삭제한다. 대상은 `payment-confirm`, `payment-order`, `payment-reconciliation`, `provider-reconciliation-scheduler`, `provider-refund-processing`, `toss-refund-workflow`, `payment-provider-schema`, `checkout-payment-methods`, `credit-mutation-snapshot`, `credit-source-category`, `payment-history-filter`, `point-charge-operations`, `payment-provider-policy`, `point-charge-compliance-ui` 등이며, 정확한 목록은 단계 0에서 고정했다([`payapp-phase0-baseline.md`](payapp-phase0-baseline.md) 4장, `footer-content`·`admin-phase1a-contract` 추가로 16개, 단언은 읽는 파일을 바꾸는 단계에서 교체).
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
| 0 | 토스를 읽는 테스트 목록 고정, 충돌 테스트 2개 정리 방침 확정 | 현재 실패 목록 baseline 기록. 완료: [`payapp-phase0-baseline.md`](payapp-phase0-baseline.md) (1169개 중 실패 48, 타입 오류 0) |
| 1 | 마이그레이션 A(추가 + 기존 결함 수정): `payment_methods`와 초기 행, `'payapp'` CHECK, 복합 FK, runtime 컬럼(스위치 false), `prepare_payment_order` 재정의, `payment_provider_transactions` 전용 컬럼과 트리거, `payment_admin_actions`, 5.5의 새 RPC와 기존 RPC payapp 분기, `refund_requests_cancel_idempotency_key` partial 재생성, `get_my_payment_history` 재생성, `record_kakaopay_partial_cancel_marker`·`quarantine_kakaopay_partial_cancellation`(호출은 단계 4), 대사 후보 ①의 카카오 확장, health 카카오 표식 블록, `*_credits_once` 실행 권한 회수. 토스·카카오 동작은 그대로 | [`docs/payapp-db-migration-checklist.md`](payapp-db-migration-checklist.md)의 A-pre·A-post 전체. 로컬 `supabase db reset` + 계약 테스트 → 운영 리허설(`BEGIN … ROLLBACK`, 사용자 승인) → 적용(사용자 승인) |
| 2 | `payapp-server.ts` + 단위 테스트(응답 파싱, 통보 인증, 요청 파라미터) | 가짜 fetch로 정상·`state=0`·타임아웃 |
| 3 | 주문·통보·복귀·상태 route와 결과 화면 | 가짜 통보 시나리오(아래) |
| 4 | 대사 payapp 분기, 카카오 대사 부분취소와 환불 처리기의 카카오 부분취소 분기를 표식 기록 → `quarantine_kakaopay_partial_cancellation` 2단계 호출로 교체, 환불 payapp 분기, 수동 환불 완료와 `manual_review` 해소 관리자 UI | 대사·환불 계약 테스트, 성공·`state=0`·네트워크 오류별 상태 |
| 5 | 결제 화면 UI 교체(9장), 결제내역 라벨 | 로컬 화면 확인(데스크톱·모바일 폭), 접근성(라벨·포커스·44px), 수단 변경 시 새 시도 ID |
| 6 | 토스 코드·테스트·문구 제거, `env.local.example` 갱신 | `grep -ri toss src` 결과가 이력 라벨 외 0건, 전체 테스트 baseline 대비 신규 실패 0 |
| 7 | 배포 → 마이그레이션 B2(정리): 토스 RPC 7개와 `toss_*` 컬럼 2개 drop, 토스 원천 환불 불가, `prepare_payment_order`의 `'toss'` 입력 거부. `payment_orders.mid`·`payment_key`, CHECK의 `'toss'`, 스냅샷 CHECK의 toss 분기는 남긴다 | 체크리스트 B-pre·B-post. Production과 살아 있는 Preview 배포가 토스 객체를 참조하지 않는지 확인 후 적용 |
| 8 | 출시: 마이그레이션 B1(약관·푸터 문구, `jsonb_set` + md5 조건) → 미해소 경보 0건 확인 → Vercel Production에 페이앱 변수 → 마이그레이션으로 `payapp_merchant_id` 설정과 `payapp_accepts_new_orders=true` → 운영자가 실결제 1건(카드) → 크레딧 지급 확인 → 관리자 환불 → 취소 통보 확인 | 체크리스트 출시 항목. 실패 시 마이그레이션으로 스위치 off |

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
- `pay_state=1` 통보로 `mul_no`를 저장하고, 그 뒤 온 payrequest 응답의 `store`가 `ready`로 바꾼다.
- 승인취소(9)가 결제완료(4)보다 먼저 오거나, 4 처리 실패 뒤에 오면 어떤 경로로도 지급되지 않는다(대사·재통보·관리자 지급 포함).
- 대사가 오래된 읽기로 `expired`를 시도해도 결제완료 기록이 있으면 거부된다(CAS·결제완료 가드).
- 부분취소는 크레딧을 묶고 `manual_review` 환불을 만든다.
- 부분취소(70)가 결제완료(4)보다 먼저 오거나 4 처리 실패 뒤에 오면, 이후 4 재통보·대사·관리자 `paid_confirmed` 어느 경로로도 지급되지 않는다.
- 관리자 환불 처리 중 같은 주문의 9 통보가 동시에 와도 교착 없이 한 번만 완료된다.
- 4 지급 중 9가 오면, 9는 표식만 남기고 처리는 지급이 끝난 뒤 "지급된 주문" 경로로 한다(지급된 주문이 `failed`가 되지 않는다).
- 9 표식이 커밋된 뒤 잠금을 기다리던 4는 `cancelled_before_fulfillment`로 끝난다.
- 취소 처리가 일시 오류로 실패하고 재통보도 끊기면, 대사가 미처리 표식을 집어 처리한다.
- 사용자 신청(PR) 위에 카카오 외부 취소가 오면 요청이 `origin='external_cancel'`로 격리된다(트리거 단방향 전환).
- 지급 재시도 실패가 3회를 넘으면 `manual_review`로 가고, 웹훅 실패는 세지 않는다.
- 취소 처리가 예상하지 못한 오류로 실패해도 실패 대체 처리로 크레딧이 묶이고, 처리 시각이 남는다. 10분 넘게 미처리면 판매가 멈추고 경보가 뜬다.
- 부분취소 처리 뒤 승인취소가 오는 순서와 그 반대 순서가 각각 따로 처리된다.
- 환불 처리(`processing`) 중에 온 부분취소는 처리 시각 없이 남았다가, 환불이 끝난 뒤 대사가 정리한다. 그동안 판매는 멈추지 않는다(원천이 이미 묶여 있음).
- 부분 회수 수동 완료에서 총 환불액 0은 입력 검증에서 거부된다.
- 백오프가 커진 오래된 주문도 미처리 취소 표식이 생기면 다음 대사 회차에 처리된다.
- 카카오 부분취소 `manual_review`도 회수량을 받아 수동 완료되고, 그 원천은 다시 환불 신청할 수 없다.
- 카카오 대사 부분취소(표식 → `quarantine_kakaopay_partial_cancellation`):
  - 미지급 주문은 `manual_review`만 되고 원천이 생기지 않으며 처리 시각이 남는다. 그 뒤 승인 콜백이 와도 지급되지 않는다.
  - 대사가 미지급으로 읽은 뒤 승인 콜백이 지급을 끝내면 40001로 끝나고, 주문이 `completed`·열린 환불 없음이어도 표식 때문에 다음 회차 후보가 되어 지급된 주문 경로로 격리된다(원천이 `active`로 남지 않는다). 계약 테스트로 고정한다.
  - 표식 기록 뒤 격리 함수가 실패(40P01·중단)해도 다음 회차에 처리된다. `reconcile_attempt_count`가 크고 `next_reconcile_at`이 미래여도 후보가 된다.
  - 지급 + 환불 `retryable_failed`·`pending_review`·사용자 `manual_review`: 환불이 `manual_review`·`origin='partial_cancel'`, 원천 `pending_refund`, 주문 `manual_review`가 되고 처리 시각이 남아 후보에서 빠진다.
  - 지급 + 환불 `processing`: 바로 `manual_review`·`origin='partial_cancel'`로 전환되고, 그 뒤 처리기의 `fail`은 아무것도 바꾸지 않는다.
  - 환불 처리기가 사전 조회나 확정 실패 재조회에서 `PART_CANCEL_PAYMENT`를 보면 `fail` 뒤 격리되어 주문이 `manual_review`가 된다.
  - 격리된 요청에 `finalize_point_charge_refund`를 부르면 `REFUND_REQUIRES_MANUAL_COMPLETION`으로 거부되고, `complete_manual`로만 끝난다.
  - 거절된 요청이 있는 주문에도 새 `partial_cancel` 요청이 23505 없이 만들어진다.
  - 주문 `manual_review`·원천 없음: 변경 없이 처리 시각만 남는다.
  - 표식 미처리인 채 결제사 상태가 `CANCEL_PAYMENT`가 되면, 한 회차 뒤 `partial_cancel` 격리(또는 `refunded`·`external_cancel`이면 처리 시각만)로 끝나고 후보에서 빠진다. `reconcileCancellation`·외부 전취소 격리는 타지 않는다.
  - 같은 주문을 두 번 처리해도 요청·알림이 1건이다. 대사가 처리 시각을 설정한 뒤 환불 처리기가 두 RPC를 다시 불러도 트리거 예외 없이 성공한다.
  - 표식 미처리 + 조회 결과가 스냅샷과 어긋남 → 한 회차 뒤 격리되고 처리 시각이 남는다.
  - 표식 미처리 + 원천 `active` 10분이면 카카오 판매가 꺼진다. 기존 카카오 health 블록 본문은 그대로다.
- 부분 회수 수동 완료 뒤 남은 크레딧은 다시 쓸 수 있고, 원장·감사 기록이 사용·회수·잔여를 따로 보여 준다.
- 대사 후보 수정 전후로 카카오·토스 후보 집합이 같다.
- 취소 처리 실패 대체 처리는 이미 환불된 원천을 되살리지 않는다.
- 취소 처리 중 영구 오류가 나도 취소 표식이 남고 크레딧이 묶이며 `FAIL`이 반복되지 않는다.
- 지급 실패 3회 전에는 판매가 멈추지 않는다(전용 카운터).
- 관리자 지급 건도 7일 안에 사용자가 환불을 신청할 수 있다.
- 격리 건·카카오 취소 확인 건의 `manual_review` 환불은 거절할 수 없다.
- 거절된 환불이 있는 주문에 외부 취소가 와도 격리된다(인덱스 수정).
- 일반 사용자 키로 신규 결제 RPC를 호출하면 권한 오류가 난다.
- 교착(40P01)·직렬화 실패는 `FAIL` 응답으로 재통보를 받는다.
- 취소 통보(환불 진행 중, 외부 취소)를 처리한다.
- 주문 없는 공통 통보는 기록과 경보만 남긴다.

순서 규칙:
- 마이그레이션 A는 기존 코드와 호환되므로 먼저 적용할 수 있다.
- 페이앱 스위치는 통보·대사·환불 분기가 모두 운영에 배포된 뒤에만 켠다. 그 전에는 대사가 모르는 provider를 `manual_review`로 보낸다.
- B1(문구)은 출시 직전에 적용한다. B2(drop)는 토스 제거 코드가 배포된 뒤에만 적용한다. 두 개를 묶지 않는다.
- 모든 운영 마이그레이션은 [`docs/payapp-db-migration-checklist.md`](payapp-db-migration-checklist.md)의 공통 규칙(잠금 제한, 단일 트랜잭션, 검증 블록, 롤백 파일)을 따른다.

## 11. 위험과 대응

| 위험 | 대응 |
|---|---|
| 조회 API 없음 → 통보 유실 시 결제됐는데 미지급 | `checkretry=y`(10회). 실패한 이벤트는 재통보로 재처리. 만료 시 `cancelmode=ready`로 결제 여부 간접 확인. 결제 가능성이 남은 건만 `manual_review` + 경보 |
| 위조 통보 | `linkkey`·`linkval` timing-safe 비교 + 저장된 `mul_no`·주문번호·금액 일치 |
| 페이앱 요청 응답 유실(요청은 생성됐는데 `mul_no` 모름) | `ready_unknown`으로 남긴다. `pay_state=1`·4 통보가 `var1`로 주문을 찾아 `mul_no`를 채운다. 결제되면 지급하고, 아니면 만료 처리한다 |
| 늦게 온 결제완료 통보 | 만료·`manual_review` 주문이라도 조건이 맞으면 지급한다(5.5.1) |
| 지급 전 승인취소 | 취소 기록이 있으면 모든 지급 경로가 거부한다(5.5.1) |
| 권한 누락으로 RPC 노출 | 공통 규칙 + 계약 테스트 + 적용 후 `proacl` 검증(5.4) |
| 마이그레이션 잠금 대기로 결제 화면 정지 | `lock_timeout=3s`, cron 직후 적용, 긴 트랜잭션 사전 확인(체크리스트) |
| 정산 후·휴대폰 당월 경과 환불 | 자동 취소 실패 → 수동 처리 + 완료 표시 기능 |
| 판매자 관리 사이트에서 직접 취소 | 공통 통보 9·64 → 외부 취소 격리 RPC(크레딧 회수 또는 경보) |
| health 점검의 자동 판매 중단 | 돈 위험 조건만 센다(5.7). 다시 켜는 것은 마이그레이션으로 한다 |
| 샌드박스 없음 | 가짜 통보 자동 테스트 + 출시 직후 실결제 1건과 환불로 확인 |

## 12. 범위 제외

정기결제, 등록결제(BILL), 현금영수증 API(`cashStRegist`), 우리 쪽에서 하는 부분취소(들어오는 부분취소 통보는 격리 처리함), 가상계좌·계좌이체, `paycancelreq` 자동 호출, 마켓 상품 직접 결제, 카카오페이 연동 변경.

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
- 적용 방법(마이그레이션 B1):
  - 문자열 치환을 하지 않는다. 운영 DB 문구(`site_footer_content`, jsonb)는 코드 기본값과 다르다. 그래서 실제 DB 문구를 읽어 `jsonb_set`으로 정확한 경로(`policyDocuments.refundPolicy.content` 등)만 고친다.
  - `WHERE key='site_footer_content' AND md5(value::text)='<dry-run 시점 해시>'` 조건을 걸어, 관리자 화면 수정과 덮어쓰기 충돌을 막는다. 바뀐 행이 1건이 아니면 RAISE 한다.
  - dry-run 검사어 '토스페이먼츠', '페이코', '일반결제', '카카오페이머니만'이 0건 남는지 확인한다.
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
- 전환 전 확인: 진행 중인 카카오 주문이 0건이어야 한다(`provider='kakaopay' and status not in ('completed','failed','expired','refunded')`). 남아 있으면 test 주문이 `manual_review`가 되고, health가 카카오페이를 자동으로 끈다.
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
- 2026-10-19 결제 DB 전문 검증 3건(지급 정합성, 환불·취소 정합성, 마이그레이션 안전성; 합계 blocker 5, major 19, minor 30) 반영:
  - RPC 공통 권한 규칙, 잠금 순서, 통보 단일 진입점 `apply_payapp_feedback`(취소 표식, 지급 서브블록)
  - CAS 종료 처리와 결제완료 가드, 부분취소 격리, 멈춘 환불 탈출
  - 경보 RPC 분리와 감사 테이블, health 기준 통일
  - 환불 키 인덱스 수정, `get_my_payment_history` 재생성, 복합 FK·CHECK
  - 마이그레이션 안전 규칙과 체크리스트 분리, B1·B2 분리
- 2026-10-19 결제 DB 전문 2회차 재검증(지급: blocker 1·major 3·minor 7, 환불: major 4·minor 6, 마이그레이션: major 3·minor 12) 반영:
  - 부분취소 지급 차단 표식, 관리자 지급 표식, 지급 실패 전용 카운터
  - 취소 분기 잠금 순서 재정의와 처리 서브블록, 영구 오류 결과 코드화
  - `refund_requests.origin`과 거절 가드(카카오 포함), 이중 환불 판정 근거
  - authenticated 예외 2개와 트리거 함수 예외, `get_my_refund_requests` 재생성
  - 상태 화면 매핑, 감사 테이블 쓰기 제한, 문구 하드코딩 제거, 표 깨짐 수정
  - 체크리스트: 권한 검증 3분할, 롤백 범위 확장, 쿼리 오류 수정
- 2026-10-19 결제 DB 전문 3회차 재검증(지급: major 2·minor 4, 환불: major 3·minor 4, 마이그레이션: major 1·minor 5) 반영:
  - 취소 처리 2단계 분리(`process_payapp_cancellation`, `cancel_processed_at`, 대사 후보 추가), 잠근 행 재확인 규칙
  - `origin` 단방향 전환과 카카오 격리의 `origin` 설정
  - 실패 대체 처리와 `cancel_handled` 해소 조치, 부분취소 회수량 인자
  - 지급 재시도 카운터를 바깥 트랜잭션에서 `>= 3`로, payapp `retryable_failed`를 대사 후보에서 제외(`infinity` 미사용)
  - 내부 함수 권한, 거절 가드 명시 목록
- 2026-10-19 4회차 재검증(지급: major 1·minor 3, 마이그레이션: major 1·minor 4) 반영:
  - health 조건 4(취소 표식 미처리), 취소 처리 `WHEN OTHERS` 대체 처리
  - 표식 경로만 ppt 단독 잠금, 표식 종류별 처리 시각과 불변
  - 대사 후보 수정 작성 규칙, 격리 origin 유지, 카카오 반환 키 유지
  - (환불 4회차 major 2·minor 3) 부분 회수 원장 의미, 환불 진행 중 부분취소 후속 처리, 대체 처리의 `processing` 전환 안전성, 대사 후보 OR 범위
- 2026-10-19 5회차 재검증(마이그레이션: PASS·minor 3, 지급: major 1·minor 4) 반영: health 조건 4를 크레딧 사용 가능 건으로 한정(그 밖은 경보만), 대사 후보·호출 문구를 표식별 짝 처리 시각으로 통일, 대체 처리 문구 통일, 부분 회수 주문 상태·`failure_code` 정리, `refund_amount` CHECK 대응, 흡수된 부분취소의 실제 환불액 기록
  - (환불 5회차 major 1·minor 5) 미처리 취소 표식 후보를 백오프 밖으로, 카카오 부분취소 회수량 인자와 재신청 차단, 총 환불액 정의, 결제내역 부분 환불 표시. P 중 부분취소와 health 조건 4의 겹침은 '원천 active일 때만' 규칙으로 이미 해소됨
- 2026-10-19 6회차 재검증: 마이그레이션 PASS(minor 3), 환불 PASS(minor 3) 반영 — 재신청 차단 reason_code를 기존 `REFUND_SOURCE_NOT_ACTIVE`로 정하고 RPC 표에 명시, `refunded_amount` 스칼라 서브쿼리(`source_id` 기준), 출시 쿼리 `blocks_launch`, 후보 정렬 회전 근거
- 2026-10-19 6회차 재검증 결과: 결제·지급 PASS, 환불·취소 PASS, 마이그레이션 PASS. 남은 minor는 반영했다(후보 순환 계약 테스트, 보류 결과 매핑, 카카오 대사 부분취소·`*_credits_once` 권한을 기존 결함으로 기록).
- 2026-10-19 사용자 결정 반영: 카카오 대사 부분취소를 `quarantine_kakaopay_partial_cancellation`으로 격리(운영 함수 재확인으로 실제 결함을 '완료 주문 건너뜀으로 인한 반복·미기록과 지급 경합'으로 정정), `*_credits_once` 실행 권한 회수를 마이그레이션 A에 포함, 미해소 경보 2건 해소 완료.
- 2026-10-19 사용자 결정분 검증 1회차(지급: major 1·minor 3, 마이그레이션: major 1·minor 4) 반영: 카카오 부분취소를 표식 → 격리 2단계로 바꾸고 대사 후보 ①을 카카오에 확장(40001·교착·중단 뒤 후보 이탈 방지), 주문 `manual_review`·원천 없음 분기 정의, health 효과 확대 명시와 카카오 표식 블록, `*_credits_once` 회수의 `to_regprocedure` 존재 가드와 운영 필수 확인, 롤백 GRANT 목록·롤백 조건(단계 4 배포 전, 격리 origin 0건), 리허설 예외 확인 방법·한 번 호출. (환불: major 2·minor 3) `processing` 환불도 바로 격리(멈춘 환불 방지), 환불 처리기의 카카오 부분취소 분기 연결, `origin='partial_cancel'` 요청의 `finalize` 거부, `refund_amount` 의미 통일, `provider_status` 기록과 종료 경로, INSERT 키·열린 환불 정의.
- 사용자 결정분 검증 2회차(환불: major 1·minor 2) 반영: 표식 미처리 + 결제사 `CANCEL_PAYMENT`도 같은 격리로 끝내도록 대사 카카오 분기에서 표식을 먼저 확인, ③ 멱등 분기의 처리 시각 설정 명시, 카카오 표식 블록의 `refunded` 원천, 리허설 ⑦ 서브트랜잭션.
- 사용자 결정분 검증 2회차(지급: major 1·minor 2, 마이그레이션: PASS·minor 3) 반영: 표식이 있으면 조회 상태·스냅샷과 무관하게 격리로 닫음, 처리 시각 `COALESCE`, 후보 의사식 카카오 포함, health 반환식·비교 범위, 단계 4 코드 되돌림 전 미처리 표식 0건 확인, 롤백 조건 "세 조건", 예외 확인 일반화.
- 사용자 결정분 검증 3회차: 마이그레이션 PASS(minor 1), 환불 PASS(minor 3) 반영 — 리허설 ④를 표식 RPC·격리 RPC 계약별로 나누고 ⑧(`CANCEL_PAYMENT`로 닫기) 추가, ③의 `provider_status` 문구 통일, 원천 없는 카카오 부분취소 `manual_review`의 `cancel_handled` 해소 경로.
