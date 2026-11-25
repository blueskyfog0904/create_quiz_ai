# 10번 묶음 계획 · 결제 회원 탈퇴(익명화)

작성일: 2026-11-24
판: 5 (최종, 4관점 PASS)
- 이력: 1·2판 4관점 FAIL, 3판 환불 PASS·나머지 FAIL, 4판 지급·환불·법률 PASS·마이그레이션 FAIL → 지적 반영.
- 고친 곳은 문단 끝에 `(4판)`·`(5판)` 으로 표시했다.

## 0. 대표 결정(2026-11-24)
1. 결제 회원의 이메일·휴대폰 번호·카카오 이메일은 **별도 보관함**으로 옮긴다.
   - 회원 정보와 로그인 계정에서는 지운다.
   - 보관함은 대표만 본다.
2. 남은 크레딧은 **탈퇴 동의와 함께 소멸**시키고 원장에 남긴다.
   - 진행 중인 환불·결제가 있거나 풀리지 않은 결제 경보가 있으면 익명화를 막는다.
3. 1:1 문의는 **3년 보존**(소비자 불만·분쟁처리 기록)하고, 회원 화면에서는 사라진다.
   - 결제 기록이 없는 회원도 같다.
   - **후기는 삭제**한다.
4. 결제창만 열었던 회원(돈이 오간 적 없음)이 **스스로 탈퇴하면 같은 익명화**를 바로 실행한다.
5. **환불 기간이 남은 유료 충전 건이 있으면 탈퇴를 막는다.**
   - 일부를 썼어도 기간 안이면 막는다.
   - 환불하거나 기간이 지난 뒤에만 탈퇴할 수 있다.
   - 소멸 대상은 환불 기간이 지난 유료 크레딧과 무상 크레딧뿐이다.
6. **결제한 적 없는 회원의 무상 크레딧 자료 구매 기록은 지운다.**
   - 완전 삭제든 익명화든 같다.
   - 결제한 적 있는 회원의 기록은 무상분까지 모두 남긴다.

남길 항목과 기간은 변호사 확인 뒤 확정한다(13절 질문).
- 보관함에는 **사건 기준 시각만** 저장한다. 만료일은 파기할 때 DB 설정 값으로 계산한다.
- 비결제 회원 문의 보존 기간은 설정 키를 따로 둔다. 변호사 답이 '보존 대상 아님'이면 그 값만 바꿔 바로 파기할 수 있게 한다.

## 1. 지금 상태(2026-11-24 운영 DB 확인)
- 회원 19명(카카오 6명) 중 결제 주문이 있는 회원은 8명이다.
  - 회원 `318f9d38…` 은 주문 2건이 모두 failed 다. 결제 시도 2건이 `claimed` 로 남아 있다(낡은 행).
    - (구현 때 정정) 이 2건은 토스 결제가 승인(29,900원)된 뒤 결제수단 불허로 서버가 자동 취소한 주문이다(`canceled_at` 있음, 예전 토스 승인 코드 c911fb7). 돈이 승인됐다가 취소됐으므로 3절 정의대로 **결제 회원**이다. 같은 모양의 주문이 회원 c0825a85 에도 1건 있다. 정의는 그대로 둔다.
  - 비결제 회원 1명은 무상 크레딧 자료 구매 2건, 문의 3건, 남은 크레딧 10000 이 있다.
  - 마케팅 동의 중인 회원은 1명이다.
- 외래키:
  - `payment_orders`·`checkout_attempts` → `profiles` 는 RESTRICT 다.
  - `profiles.id` → `auth.users` 는 CASCADE 다.
  - `profiles` CASCADE 는 21개, `auth.users` CASCADE(public)는 4개(support_tickets·market_item_review_votes·passages·problem_type_test_runs)다.
  - `support_tickets.user_id` 는 `profiles` 도 NO ACTION 으로 참조한다. (4판)
  - `ai_question_generation_runs.user_id` 는 auth.users SET NULL 이다.
- `profiles` 개인정보 칸: `email, phone, birthdate, organization, gender, address, kakao_id, kakao_email, avatar_url`. `display_tag` 는 NOT NULL·UNIQUE 다.
- 결제 때 입력한 휴대폰 번호는 `request_fingerprint`(해시, 나머지 입력값을 회사가 알아 복원할 수 있는 가명정보)와 페이앱에 남는다.
- 추가만 받는 가드가 있는 테이블: `user_consents`, `market_purchase_notice_acks`, `support_ticket_revisions`, `point_charge_checkout_acks`, `admin_audit_log`.
  - 앞의 둘은 프로필이 있으면 DELETE 를 막는다.
- RLS:
  - `support_tickets`: 모든 관리자 SELECT(`is_admin()`), `support.manage` UPDATE.
  - `market_refund_requests`: 모든 관리자 SELECT.
  - `refund_requests`·`support_ticket_revisions`: authenticated 에 테이블 권한이 없다. 실제로 드러나는 경로는 service_role 서버 코드다. (4판)
- `payment_orders` 의 `prevent_payment_order_snapshot_update` 트리거가 `request_fingerprint` 등 스냅숏 칸 변경을 막는다. (4판)
- 자동 점검 `enforce_payment_reconciliation_health`(5분마다, 대사 완료 때)는 "결제완료 미지급" 페이앱 주문이 있으면 판매를 끈다. 조건은 `payapp_sales_resume_blockers` 와 글자까지 같다(계약 시험 `tests/payment-sales-ops-contract.test.mjs`). (4판)
- 문의·환불이 접수되면 트리거가 `admin_events.title` 에 문의 제목 앞 30자를 복사한다. (4판)
  - `admin_events` 는 추가 전용 가드 `prevent_admin_event_mutation` 이 UPDATE·DELETE 를 조건 없이 막는다. (5판)
  - cron `remind_unanswered_admin_work`(10분마다)는 대기 문의마다 하루 1건씩 `support_unanswered` 이벤트를 새로 만든다. 제목도 복사하고, 직원·Slack 으로 보낸다. (5판)
- 대표(`admin_role='owner'`) 계정은 4개다. 2개는 로그인한 적이 없고, 모두 2단계 인증이 없다. (4판)
- 카카오 연결 끊기(unlink) 코드는 지금 없다. (4판)
- 페이앱 웹훅 이벤트는 `order_id` 가 NULL 이고 `transmission_id = payapp:{mul_no}:{pay_state}` 다.
- 결제 유효시간은 30분이다. 결제수단은 카드·휴대폰·네이버페이·토스페이이고 가상계좌는 없다.

## 2. 목표
- **결제 회원**은 탈퇴 화면에서 고지를 보고 **탈퇴 요청**을 남긴다. 회원 본인 확인이고, 고지 원문·지문이 기록된다. 대표가 회원 상세에서 그 요청으로 **익명화**한다.
- **화면을 쓸 수 없는 경우**(로그인할 수 없는 회원, 법정대리인·위임 대리인)는 이메일·전화 요청을 대표가 기록한다. 회원 종류와 상관없다. (4판)
  - 유료 소멸분이 있으면 서버가 설정 틀로 고지 원문을 만든다. 대표가 그 원문을 회원(또는 대리인) 이메일로 보내고, 동의 회신을 받은 시각과 원문 지문을 요청에 기록해야 처리할 수 있다.
- **결제창만 열었던 회원**과 **문의가 있는 비결제 회원**은 스스로 탈퇴하면 바로 익명화된다.
- **결제·결제 시도·문의 기록이 모두 없는 회원**은 지금처럼 완전 삭제한다.
- 익명화한 회원은 새 로그인·토큰 갱신이 되지 않는다. 같은 이메일·카카오로 새로 가입할 수 있다(새 id).
- 탈퇴 회원에게는 크레딧·알림이 다시 생기지 않는다. 결제가 들어오면 지급하지 않고 보류하며, 보류 주문을 닫는 길이 있다.
- 보존 기록(연락처·탈퇴 회원 문의·환불 기록)은 DB 권한으로 대표만 연다. 열 때마다 기록이 남는다.

## 3. 정의 — 내부 함수 `member_withdrawal_facts(p_user_id)`
미리보기·익명화·요청·시험이 모두 이 함수를 쓴다.

- **결제 회원(`had_payment`)**: 다음 중 하나라도 해당하면 결제 회원이다.
  - 돈이 오간 주문이 있다. 돈이 오간 주문은 다음 중 하나에 해당하는 주문이다.
    - `status in (completed, refunded, cancel_pending, fulfillment_pending, confirming, manual_review)`
    - `approved_at` 또는 `canceled_at` 이 있다
    - 연결된 `payment_history` 가 있다
    - ppt 에 `paid_feedback_recorded_at`·`admin_paid_confirmed_at`·`cancel_feedback_recorded_at`·`partial_cancel_feedback_recorded_at` 중 하나가 있다
  - 주문 연결과 상관없이 `amount > 0` 인 `payment_history` 가 있다.
  - `source_category = 'plan_purchase'` 원천이 있다.
  - 주문 `failure_code in ('PAYAPP_FEEDBACK_MISMATCH','PAYAPP_MUL_NO_CONFLICT')` 이 있다. 검증에 실패한 결제완료 통보는 ppt 에 표식을 남기지 않기 때문이다. (4판)
  - 그 회원 주문에 `payment_admin_actions` 행이 있다. (4판)
- **결제 시도만**: 주문·결제 시도는 있지만 결제 회원이 아니다.
- **진행 중**(`MEMBER_WITHDRAW_IN_PROGRESS`, details 에 종류별 건수):
  1. 주문 `status not in (completed, refunded, failed, expired)`.
  2. 결제 시도 `status in (claimed, manual_review)` 중 다음 둘 가운데 하나에 해당하는 것. 연결 주문이 끝난 낡은 행은 막지 않는다.
     - 연결 주문이 없고 `expires_at > now()`
     - 연결 주문이 1번에 해당
  3. 상태와 상관없이 처리 안 된 취소·부분취소 표식.
  4. 처리 안 된 웹훅 이벤트: `payment_webhook_events.processing_status in (pending, failed)` 이고 `split_part(transmission_id, ':', 2) = ppt.provider_transaction_id`. 부분취소(70·71)는 이 규칙으로 연결되지 않으므로 7번 경보로 막는다.
  5. 충전 환불 `status in (pending_review, processing, retryable_failed, manual_review)`, 자료 환불 `status = pending`.
  6. 원천 `status = pending_refund`. 재지급 원천은 `credit_source_paid_root(source).root_in_progress` 로 본다(9번 정의).
  7. 풀리지 않은 결제 경보. 다음 중 하나가 그 회원 것이면 막는다.
     - `details->>'payment_order_id'` 또는 `'order_payment_order_id'` 가 그 회원 주문 id
     - `'mul_no'` 또는 `'orig_mul_no'` 가 그 회원 주문 `provider_transaction_id`
     - `'order_id'` 가 그 회원 주문번호
     - `'user_id'` 가 그 회원 id
  8. 실행 중·대기 중 생성 작업.
- **환불 기간이 남은 유료 충전 건**(결정 5, `MEMBER_WITHDRAW_REFUND_PERIOD_OPEN`, 건마다 마감 시각):
  - 대상: 유료 원천(`credit_source_paid_root(source).root_source_id` 가 있거나 `plan_purchase`) 중 잔량이 0보다 큰 것.
  - 마감: `point_charge_refund_deadline(GREATEST(주문 approved_at, 원천 created_at), GREATEST(설정 일수, 결제 전 확인 동의 일수))` 이 `now()` 보다 뒤인 것.
  - eligibility 함수와 같은 식으로 계산한다. 리허설에서는 eligibility 가 마감 값을 돌려주는 원천만 두 값을 대조하고, 나머지는 식으로 계산한 값을 시험에 고정한다.
  - 재지급 원천은 뿌리 원천(`credit_source_paid_root`)과 그 주문(approved_at·created_at·결제 전 확인 동의)을 기준으로 마감을 계산한다. (4판)
  - 일수는 eligibility 와 같이 `COALESCE(…, 7)` 이다. 설정을 읽지 못하면 막는 쪽으로 둔다. (4판)
  - **탈퇴 차단에만 여유를 둔다:** 마감에 설정 `withdrawRefundDeadlineBufferDays`(기본 3일)를 더해 그때까지 막는다. 민법 161조(말일이 휴일이면 연장) 답이 오기 전에, 연장될 수 있는 철회 기간 안의 크레딧이 소멸하지 않게 하려는 것이다.
    - 그래서 eligibility 마감과는 일부러 다르다. T4 대조는 "eligibility 마감 + 여유"로 한다.
    - 화면에는 "환불 기간이 끝난 뒤 며칠 동안은 휴일 연장을 확인하느라 탈퇴가 막힐 수 있음"을 적는다. (5판)
  - "환불 가능"(eligibility allowed)과 "일부 사용했지만 기간 안" 모두 여기에 해당한다.
- **페이앱 요청 미확인 주문**: 아래를 모두 만족하는 주문.
  - `status = 'expired'`
  - `failure_code in ('PAYAPP_REQUEST_OUTCOME_EXPIRED', 'PAYAPP_READY_CANCEL_FAILED')`
  - `ppt.provider_transaction_id IS NOT NULL`
  - `ppt.provider_status NOT IN ('8','16','32')`

  스스로 탈퇴는 막는다. 대표 처리는 "페이앱 판매자 화면에서 결제 없음 확인" 체크를 받는다.
- **가림 확인 필요 문의·기록**: `redaction_reviewed_at` 이 없는 것 중 다음에 해당하는 것.
  - 환불 카테고리 문의
  - 환불과 연결된 문의
  - 대표가 계좌를 요청한 답변 뒤에 그 회원이 쓴 문의
  - 제목·본문·답변·수정 이력·환불 사유·메모에 "숫자·하이픈·공백만으로 된 구간에 숫자가 10개 이상" 있는 것

  대표가 [가림] 또는 [확인함]을 하면 `redaction_reviewed_at` 이 찍혀 풀린다(감사 기록).
  `redaction_reviewed_at` 이 그 문의의 `member_updated_at`·`responded_at` 보다 이르면 다시 '확인 필요'로 본다. 회원이 확인 뒤에 본문을 고친 경우를 잡기 위해서다. (4판)
- **유료 크레딧**: 위 유료 원천.
- **비교 잔액**: `get_credit_balance_snapshot(user).spendable_balance`.
- **스스로 익명화 가능(`selfAllowed`)**: 아래를 모두 만족해야 한다.
  - 관리자 아님, `had_payment = false`
  - 진행 중 0, 기간 남은 유료 0, 페이앱 미확인 0, 가림 확인 필요 0
  - 결제 관련 **사건 시각**(주문 생성·승인·취소, 결제 시도 생성, ppt 의 결제·취소 통보 시각) 중 가장 늦은 것이 `selfWithdrawOrderQuietDays`(7일) 전

  근거: 결제 유효시간 30분, 가상계좌 없음, 만료 요청은 미확인으로 막는다. 7일은 재통보 지연 여유다. 남는 경우는 5-5 보류가 맡는다. 페이앱 재통보 정책은 출시 전에 확인한다(대표 할 일에 추가).
- **결제 회원 탈퇴 요청 가능**: 관리자 아님, `had_payment = true`, 진행 중 0, 기간 남은 유료 0. 가림 확인이나 페이앱 미확인은 대표가 처리할 때 본다.
- **스스로 탈퇴가 막힐 때**(가림 확인·페이앱 미확인·진행 중):
  - 서버가 대표 경보 `MEMBER_WITHDRAW_REVIEW_NEEDED` 를 남긴다(`dedupe_key = 'member_withdraw_review:'||id`, 개인정보 없음).
  - 회원에게는 "확인 뒤 10일 안에 이메일로 안내"라고 보여 준다. (4판)
  - 막힘 화면(결제 회원이 요청을 만들지 못한 경우 포함)에는 다음을 둔다. (5판)
    - **[광고 수신 동의만 지금 철회]** 버튼(source `mypage`, 그 화면에서 결과 통지)
    - 이의제기 방법(처리방침 DB 값의 개인정보 보호책임자·고객센터)
    - 대표가 10일 안에 보내는 안내 메일 틀에도 이의제기 방법을 넣는다.
- **보류 중인 탈퇴 회원 주문이 판매를 끄는 것은 의도한 동작이다.** 돈은 받았는데 지급하지 않은 주문이기 때문이다. 순서: 탈퇴 회원 늦은 결제 → 10분 뒤 페이앱 판매 자동 중지(경보) → 대표가 보류 주문을 닫음 → 판매 재개(런북). (4판)

## 4. 무엇을 지우고 무엇을 남기나
| 데이터 | 결제 회원 | 결제 시도만·비결제(익명화) | 근거 |
|---|---|---|---|
| 프로필 개인정보 칸 | NULL, `display_tag` 새 임의 값, `withdrawn_at` | 같음 | 결정 1 |
| 이메일·휴대폰(회원정보)·카카오 이메일 | 보관함으로 옮김 | 보관하지 않음 | 처리방침 3절 |
| 로그인 계정 | 이메일 등을 되돌릴 수 없는 해시 값으로 바꿈(가명 상태, 소프트 삭제 5-7). 보존 기간이 끝나면 완전 삭제 | 같음(문의가 auth.users CASCADE 라 보존 기간 동안 남김) | 13절 8번 (5판) |
| 결제 주문·결제 시도·ppt·결제 내역·충전 환불·결제 전 확인 동의 | 남김(`request_fingerprint` 는 13절 11번 답이 올 때까지 남김. 처리방침 보존 항목에 적음) | 남김. 단 주문·결제 시도의 `request_fingerprint` 는 되돌릴 수 없는 임의 값으로 바꾼다. 주문 쪽은 스냅숏 트리거가 막으므로 5-5 에서 그 한 칸만 허용한다(4판). 늦은 결제 대비로 최대 5년 보존하고, 처리방침에 적는다 | 결제 기록 보존 |
| 크레딧 원천·사용·거래 | 남김 + 소멸 거래 | 삭제(무상만 있음) | 결정 2·6 |
| 자료 구매 주문·묶음·구매·권한·구매 고지 동의·자료 환불 | 남김 | 삭제 | 결정 6 |
| 다운로드 기록 | 행은 남기고 `ip_address`·`user_agent` NULL | 삭제 | 받은 자료 증빙 |
| 1:1 문의·수정 이력 | 남김(가림 뒤), 5년 연결분 포함 | 회원이 보존에 동의하면 남김(가림 뒤) 3년. **동의하지 않으면 삭제**한다(13절 3번 답 전, 5판). 대기·처리 중 문의는 익명화 때 `closed` 로 바꾼다(감사 기록, 5판) | 결정 3 |
| 동의 기록 | 남김 + 마케팅 철회 1건 | 삭제(완전 삭제와 같음). 마케팅 동의 상태였으면 결과에 철회 일시를 담는다 | |
| 후기·추천, 문제·문제지·지문·생성 작업·생성 기록·시험 실행, 알림, 장바구니 | 삭제 | 삭제 | |
| 상품 조회 기록 `user_id` | NULL | NULL | |
| `auth.sessions`·옛 refresh token·`flow_state`·`one_time_tokens` | 그 회원 행 삭제 | 같음 | |
| 감사 기록 | 남김 + 익명화 1건 | 같음 | |
| 관리자 이벤트(`admin_events`) 중 그 회원 문의·환불의 제목·본문 사본 | 제목·본문을 '탈퇴 회원 문의'로 바꿈. 가드는 5-5 에서 그 칸만 허용 | 같음 | 분리 보관(4판·5판) |

## 5. DB 변경(마이그레이션 `20261126100000_member_withdrawal.sql`)
형식은 9번과 같다.
- md5 사전 확인: `v_pairs` 원래 값, `v_new` 10번 값, "그대로여야 함" 목록.
- 바꾼 곳은 `-- [10번] 시작/끝` 으로 감싼다.
- 적용 래퍼를 쓰고 VERIFY 구역을 둔다.
- 새 테이블·함수는 `REVOKE ALL FROM PUBLIC, anon, authenticated` 하고 필요한 것만 service_role 에 준다.
- VERIFY 에서 ACL·prosecdef·search_path·정책을 확인한다.

### 5-1. 설정·칸·테이블
- `system_settings` `member_withdrawal_policy`. RESTRICTIVE `…_no_client_write` 를 둔다.
  ```json
  {"version":1,"selfAnonymizeEnabled":false,"paymentRetentionYears":5,"payerTicketRetentionYears":3,"payerRefundTicketRetentionYears":5,
   "nonPayerTicketRetentionYears":3,"attemptRecordRetentionYears":5,"withdrawalRecordRetentionYears":5,"consentRecordRetentionYears":5,
   "selfWithdrawOrderQuietDays":7,"withdrawRefundDeadlineBufferDays":3,"texts":{...}}
  ```
  - `selfAnonymizeEnabled` 는 키가 없거나 형식이 틀리면 꺼짐으로 본다.
  - 서버 route 와 `create_member_withdrawal_request`·`anonymize_member(method self)` 양쪽에서 확인한다.
  - VERIFY 에서 초기 값 false 를 확인한다. (4판)
- `profiles.withdrawn_at` 을 둔다. `signup_completed` 는 바꾸지 않는다.
- **`member_withdrawal_requests`**(결제 회원의 탈퇴 요청, 추가만 받음):
  - 칸: `id`, `user_id`(profiles RESTRICT), `channel`(`screen`|`email`|`phone`), `requester_kind`(`self`|`legal_guardian`|`agent`), `received_at`, `notice_text`, `notice_sha256`, `notice_sent_at`, `consent_reply_received_at`, `expected_balance`, `expected_forfeit_paid`, `expected_forfeit_free`, `marketing_withdrawn_at`, `identity_note`, `recorded_by`, `status`(`pending`|`completed`|`canceled`), `created_at`.
  - 고지 원문은 **모든 경로에서 서버가** 설정 틀과 미리보기 값으로 만들고 지문을 계산한다(9번 방식). 틀에는 개인정보를 넣지 않는다. (4판)
  - `screen` 은 회원 세션 API 로만 만든다.
  - `email`·`phone` 은 대표가 기록한다. 회원 종류와 상관없이 받는다. 유료 소멸분이 있으면 `notice_sent_at`·`consent_reply_received_at` 이 있어야 처리할 수 있다. (4판)
  - 비결제 회원의 문의 보존 동의 여부(`ticket_retention_agreed`)를 받는 칸을 둔다. 화면에서는 체크로, email·phone 은 회신으로 받는다. (5판)
  - 요청 기록이 있는 회원은 완전 삭제가 아니라 익명화 경로로 간다. 요청이 profiles 를 RESTRICT 로 참조하기 때문이다. facts 의 완전 삭제 조건에 "탈퇴 요청 없음"을 넣는다. (5판)
  - `identity_note` 에는 연락처·신분증 내용을 적지 않는다. 폼 안내와 런북에 적는다. (4판)
  - **마케팅 철회:** 요청을 만들 때 마케팅 최신 기록이 agreed=true 면 바로 철회 1건(source `withdrawal`)을 남기고 `marketing_withdrawn_at` 을 기록한다. 요청을 취소해도 철회는 되돌리지 않는다. 화면에 그렇게 적고, 요청 완료 화면에서 철회 결과(보낸 곳·철회 사실·처리 일시)를 바로 보여 준다(정보통신망법 50조). (4판)
  - 상태 변경은 `pending → completed|canceled` 만 받는다. 회원이 화면에서 취소하거나, 대표가 처리하면 바뀐다.
- **`withdrawn_member_records`**(보관함):
  - 칸:
    - `user_id` PK, `operation_key` UNIQUE, `withdrawn_at`, `method`(`self`|`owner`), `actor_id`, `request_id`, `reason`
    - `consent_notice_text`, `consent_notice_sha256`(스스로: 탈퇴 화면 원문 / 대표: 요청의 원문)
    - `email`, `phone`, `kakao_email`
    - `had_payment`, `forfeited_credits`, `forfeited_paid_credits`, `forfeit_breakdown`(원천별 source_id·category·paid_root_id·소멸량·expired_cleared)
    - 사건 기준 시각: `last_payment_event_at`, `last_market_event_at`, `last_ticket_event_at`, `refund_ticket_ids`
    - `provider_unverified_confirmed`, `marketing_withdrawn_at`, `auth_scrubbed_at`, `result`, `policy_snapshot`, `created_at`
  - 사건 시각은 updated_at 이 아니라 사건 칸으로 계산한다.
    - 결제: 주문 approved_at·canceled_at, ppt 통보 기록 시각, 충전 환불 processed_at, 결제 시도 created_at
    - 자료: 자료 주문 created_at, 자료 환불 processed_at
    - 문의: `responded_at`·`member_updated_at`·`created_at`
  - RLS 를 켜고 정책은 두지 않는다. **service_role 도 SELECT 를 회수**한다. 읽기는 감사 기록을 남기는 `read_withdrawn_member_record` 로만 한다. 재요청 응답은 `anonymize_member` 가 돌려준다. (4판)
  - 행은 `result` 까지 계산한 뒤 **한 번에 INSERT** 한다. 가드는 `auth_scrubbed_at` NULL→값 수정만 받고, 삭제·TRUNCATE 를 막는다. (4판)
  - `forfeit_breakdown` 원천별 값에 유료분의 원 환산을 넣는다. 화면 고지에도 같은 값을 쓴다. (4판)
  - 계산은 새 내부 함수 `point_charge_cash_value(p_source_id, p_credits)` 로 한다. 환불정책 8절 식은 남은 유료 크레딧 × (결제 금액 − 환불액) ÷ (지급 − 회수)이다. 입력은 다음에서 읽는다(5판):
    - 결제 금액: 뿌리 원천(`credit_source_paid_root`)의 결제 금액
    - 환불액: completed `refund_requests.refund_amount` 합
    - 지급: 뿌리 `initial_credits`
    - 회수: `type = 'refund'` 음수 합
    - 1원 미만은 버린다. 시험으로 고정한다.
  - 카카오 회원이면 `kakao_id_pending_unlink` 칸에 회원번호를 둔다. 연결 끊기가 성공하면 NULL 로 바꾼다. 가드는 이 칸의 값→NULL 만 받는다. (5판)
- **`withdrawn_member_record_events`**(추가만 받음):
  - 칸: `user_id`(보관함 FK RESTRICT), `kind`(`late_payment`|`held_order_closed`|`manual_refund`|`market_cash_refund`|`note`), `ref_id`, `details`, `actor_id`, `created_at`.
  - `(user_id, kind, ref_id)` 부분 UNIQUE. 모든 INSERT 는 `ON CONFLICT … DO NOTHING` 이라 반복해도 1건이다(4판).
  - RLS 정책 없음, REVOKE ALL(service_role SELECT 도 회수), 추가만 받는 가드를 둔다. 기록은 SECURITY DEFINER 함수와 트리거로만 넣는다.
- `support_tickets.redaction_reviewed_at`, `support_ticket_revisions.redaction_reviewed_at` 을 둔다.
- CHECK:
  - `credit_transactions.type` 에 `withdrawal_forfeit`
  - `user_consents.source` 에 `withdrawal`
  - `payment_admin_actions.action` 에 `withdrawn_held_order_closed`. 방법 값은 기존 `payapp_cancel_request|provider_admin_cancel|bank_transfer` 를 쓴다. (4판)
- **탈퇴 회원 쓰기 막기 트리거**(BEFORE INSERT/UPDATE):
  - 대상: `support_tickets`, `support_ticket_revisions`, `questions`, `passages`, `exam_papers`, `exam_paper_items`
  - 탈퇴 회원 행이면 `MEMBER_WITHDRAWN` 으로 거절한다. 익명화·가림 함수가 켠 거래 로컬 설정이 있을 때만 통과시킨다.
  - `market_item_view_events` 는 탈퇴 회원이면 `user_id` 를 NULL 로 바꿔 넣는다.
  - 남은 JWT 시간(최대 1시간)과 SECURITY DEFINER 문의 함수 경로를 함께 막는다. 그래서 "다시 지우기"는 필요 없다. (4판)
- RLS(RESTRICTIVE, 탈퇴 회원 행은 `is_owner()` 도 막고 서버 route 로만 연다):
  - `support_tickets_withdrawn_hidden` SELECT/UPDATE: `NOT EXISTS(SELECT 1 FROM profiles p WHERE p.id = user_id AND p.withdrawn_at IS NOT NULL)`
  - `market_refund_requests_withdrawn_hidden` SELECT: 같은 조건
  - `support_ticket_revisions`·`refund_requests` 에도 같은 정책을 둔다. 지금은 authenticated 권한이 없어 효과가 없는 심층 방어용이다. (4판)
  - 실제로 드러나는 service_role 경로는 6-6 목록에서 코드로 가린다. (4판)

### 5-2. 함수 `anonymize_member(p_actor_id, p_user_id, p_method, p_request_id, p_expected_balance, p_notice_text, p_provider_unverified_confirmed, p_reason, p_operation_key)`
SECURITY DEFINER, service_role 만 실행한다. 한 거래 안에서 처리한다.

1. **잠금:**
   - 동의 advisory 잠금 두 개(`user_consents:회원`, `signup_consent_items:write` 공유)를 먼저 잡는다.
   - **비결제·결제 시도만 경로**(fingerprint 를 바꾸는 경로)는 그다음 그 회원의 `payment_orders`·`checkout_attempts` 를 id 순서로 `FOR UPDATE` 하고, 그 뒤에 프로필을 잠근다. facts 판정도 이 잠금 뒤에 한다. (5판)
     - fulfill·begin·취소 처리(주문→프로필)와 순서가 같아 순환이 없다.
     - 판단 뒤에 표식이 커밋되는 틈도 닫힌다.
     - 비결제 회원에게는 결제 원천이 없어 취소 처리의 원천 잠금과도 순환이 없다.
   - 그다음 프로필 `FOR UPDATE`, 그 회원 원천을 id 순서로 `FOR UPDATE` 한다.
   - `payment_orders`·ppt 는 잠그지 않고 읽기만 한다(fulfill 과의 순환 방지).
   - 충전 환불 함수(원천→프로필)와는 반대 순서라 40P01 이 날 수 있다. 서버가 같은 키로 2회까지 다시 시도한다.
   - 표식이 판단 뒤에 커밋되는 좁은 틈은 외부 취소 격리 경로가 맡는다.
   - (4판의 "비결제 경로 40P01" 설명은 5판 잠금 순서로 대신한다.)
   - 런북: 스스로 익명화한 회원에게 늦은 결제가 와서 송금으로 환불해야 하면, 연락처는 페이앱 관리자 화면의 구매자 번호로 찾는다. (5판)
2. **재요청:** `withdrawn_at` 이 있으면 같은 키는 `result` 를 돌려주고, 다른 키는 `MEMBER_ALREADY_WITHDRAWN`.
3. **거절**(3절 정의):
   - `MEMBER_WITHDRAW_ADMIN`
   - `…_ACTOR_NOT_OWNER`
   - `…_SELF_NOT_ALLOWED`(+이유)
   - `…_IN_PROGRESS`
   - `…_REFUND_PERIOD_OPEN`
   - `…_PROVIDER_UNVERIFIED`
   - `…_REDACTION_REQUIRED`
   - `…_REQUEST_INVALID`
     - 대표 경로는 요청이 있어야 한다. 결제 회원은 `screen`·`email`·`phone`, 비결제·결제 시도만은 `email`·`phone` 을 받는다. (4판)
     - 요청이 그 회원의 `pending` 이어야 한다.
     - email·phone 경로에 유료 소멸분이 있으면 `notice_sent_at`·`consent_reply_received_at` 이 있어야 한다. (4판)
   - `…_BALANCE_CHANGED`: 지금 소멸액(**전체·유료·무상 각각**, 5판)이 동의한 금액보다 **크면** 거절한다. 같거나 작으면 받고, 동의 금액과 실제 소멸액을 결과에 둘 다 남긴다. 회원이 요청 뒤 크레딧을 썼거나 만료된 경우다. (4판)
   - `…_NOTICE_INVALID`(스스로 경로: 서버가 다시 만든 원문의 지문과 다름)
4. **소멸(결제 회원):**
   - 만료 전 잔량이 있는 원천마다 0 으로 만들고 `withdrawal_forfeit` 거래(음수, **`balance_after = 0`**, `source_id`, `operation_key = 키||':'||source_id`)를 넣는다.
   - 만료 잔량은 거래 없이 0 으로 만들고 `expired_cleared` 에 남긴다.
   - 소멸 행이 하나도 없는데 최근 거래의 `balance_after` 가 0 이 아니면, amount 0·`balance_after = 0` 인 `withdrawal_forfeit` 1행("탈퇴 정리")을 넣는다. 잔액 스냅숏 4값이 모두 0 이 되게 하려는 것이다. (4판)
     - 정리 행의 `operation_key` 는 `키||':cleanup'` 이다. (5판)
   - 소멸·정리 행의 `created_at` 은 `GREATEST(clock_timestamp(), 그 회원 최근 거래 created_at + interval '1 microsecond')` 로 넣는다. 스냅숏의 "최근 거래"가 항상 이 행이 되게 하려는 것이다. (5판)
   - `profiles.credits = 0`.
5. **비결제·결제 시도만 — 삭제 순서:**
   1. 이용 권한
   2. 자료 환불(재지급 연결은 CASCADE)
   3. 자료 주문(줄은 CASCADE)
   4. 묶음
   5. 구매
   6. 원천·사용·거래
   7. 구매 고지 동의
   8. 동의 기록

   `user_consents`·`market_purchase_notice_acks` 가드는 5-5 에서 고친다. 기존 "프로필이 없으면 DELETE 허용" 분기는 그대로 두고, "설정 값 = OLD.user_id 이면 허용"을 더한다. 완전 삭제와 옛 코드 경로가 계속 돌게 하려는 것이다. (4판)
   결제 시도·주문의 `request_fingerprint` 는 임의 값으로 바꾼다.
6. **동의:** 요청 단계에서 이미 철회했으면 건너뛴다(4판). 그렇지 않고 마케팅 최신 기록(item_version 과 상관없이 최신 seq)이 agreed=true 면 처리한다.
   - 결제 회원: `consent_record_internal(user, [{marketing, 현재 버전, false}], 'withdrawal')` 로 철회 1건을 남긴다.
   - 비결제: 기록은 삭제하고 `marketing_withdrawn_at = now()` 만 결과에 남긴다.
7. **보관함 기록:** 결제 회원만 연락처를 옮긴다. 사건 시각을 모두 기록한다. 대표 경로는 요청을 `completed` 로 바꾼다.
8. **정리:** 4절 표대로 한다.
9. **프로필:** 개인정보 칸 NULL, `display_tag` 새 값, `withdrawn_at = now()`, `credits = 0`.
10. **차단:**
    1. `auth.users.banned_until = now() + interval '100 years'`(유한 값)
    2. `auth.sessions` 삭제(refresh token CASCADE), `session_id IS NULL` 인 옛 토큰은 `user_id = p_user_id::text` 로 삭제
    3. `flow_state`·`one_time_tokens` 삭제

    이미 발급된 JWT 는 만료(최대 1시간) 전까지 유효하다. 그 사이의 쓰기는 5-1 "탈퇴 회원 쓰기 막기 트리거"와 5-4 트리거가 막는다. (4판)
    정리 단계에서 그 회원 문의·환불의 `admin_events` 제목·본문을 '탈퇴 회원 문의'로 바꾼다. 가드는 5-5 에서 고친다. (4판·5판)
    정리 단계에서 그 회원의 `pending`·`in_progress` 문의를 우회 설정 아래에서 `closed` 로 바꾸고 감사 기록에 건수를 남긴다. 그리고 `remind_unanswered_admin_work` 가 탈퇴 회원 문의를 건너뛰게 고친다(5-5). 탈퇴 회원 문의 제목이 날마다 새로 복사되지 않게 하려는 것이다. (5판)
11. **감사:** `record_admin_audit(actor, 'member_withdraw', …)`. 금액은 소멸 크레딧이고, details 에 method·request_id·유료 소멸·건수·확인 체크를 넣는다. 개인정보는 넣지 않는다. 스스로 탈퇴는 보관함·결과로 남는다.
12. **결과:** 다음을 돌려주고 `result` 에 저장한다.
    - `withdrawn`, `method`, `forfeited`, `forfeitedPaid`, `counts`
    - `marketing`: `{sender: 사이트 운영자명(site_brand DB 값), withdrawnAt, result: '광고성 정보 수신동의 철회'}`

### 5-3. 문의·환불 기록 가림
- `redact_member_text(p_actor_id, p_target_kind, p_target_id, p_field, p_target_text, p_operation_key)`, 대표만 실행한다.
  - 대상:
    - 문의 `subject|message|admin_response`
    - 수정 이력 `subject|message`
    - `refund_requests.reason|admin_note`
    - `market_refund_requests.reason|admin_note`
  - `p_target_text` 와 정확히 같은 부분을 모두 `[가림 처리됨]` 으로 바꾸고 `redaction_reviewed_at` 을 기록한다. 같은 ref 의 `admin_events.title/body` 에 그 문구가 있으면 함께 가린다. (4판)
  - 감사 기록에는 글자 수만 남긴다.
- `mark_member_text_reviewed(p_actor_id, p_target_kind, p_target_id)`: 가릴 것이 없다고 확인한다(감사 기록).
- 탈퇴 여부와 상관없이 쓴다. 런북 5-3·5-4·미성년자 런북의 "처리 뒤 계좌·확인 자료 가림"에 쓴다. 환불 메모에는 계좌·확인 자료를 적지 않는다는 규칙도 런북에 적는다.

### 5-4. 크레딧·알림·환불 기록 보호(트리거)
- **`credit_sources` 트리거**(BEFORE INSERT, BEFORE UPDATE OF remaining_credits):
  - INSERT 이거나 `NEW.remaining_credits > OLD.remaining_credits` 일 때만 프로필을 **FOR KEY SHARE** 로 읽는다.
  - 탈퇴 회원이면 `MEMBER_WITHDRAWN` 으로 거절한다.
  - 덮는 경로: refund_credits, market_refund_settle, admin_exception_market_refund, settle_market_refund_by_owner, grant_admin_credits, finalize_kakaopay_payment.
- **`notifications` 트리거**(BEFORE INSERT): 탈퇴 회원이면 RETURN NULL.
- **`refund_requests` 트리거**(AFTER UPDATE): 상태가 completed 로 바뀌고 탈퇴 회원이면 `withdrawn_member_record_events(manual_refund, ref_id = 요청 id)` 를 같은 거래에 넣는다(`ON CONFLICT DO NOTHING`).
- **탈퇴 회원 자료 법정 환불**(하자 등): 크레딧으로 줄 수 없으므로 대표가 원래 결제수단이나 계좌로 정산한다.
  - 기록은 대표 전용 `add_withdrawn_member_event(p_actor, p_user, 'market_cash_refund'|'note', p_ref_id, p_details)` 로 남긴다.
  - 자료 주문 상태는 그대로 둔다(범위 밖, 런북에 적음).

### 5-5. 다시 정의하는 함수(md5 원래 값)
| 함수 | 바꿈 |
|---|---|
| `payapp_fulfill_order_internal` 78cd0333… | 프로필 잠금 뒤 탈퇴 회원이면 다음을 하고 **정상 반환**한다. 반복 실행해도 결과가 같다.<br>- 주문 `manual_review`, `failure_code = 'PAYMENT_FOR_WITHDRAWN_MEMBER'`<br>- 경보(critical, `{order_payment_order_id, dedupe_key: 'withdrawn_member_payment:'||id, user_id}`)<br>- `late_payment` 기록(부분 UNIQUE 로 1건)<br>- `{held: 'MEMBER_WITHDRAWN'}` 반환<br>그 주문에 `held_order_closed` 기록이 있으면 주문 상태·경보를 바꾸지 않고 `{held:'MEMBER_WITHDRAWN', closed:true}` 만 돌려준다. 닫은 주문에 같은 통보가 다시 와도 열리지 않게 하려는 것이다. (4판) |
| `apply_payapp_feedback` 179f00a9… | held 면 result `withdrawn_member_hold`. 결제완료(4) 경로에서 그 주문에 `held_order_closed` 기록이 있으면 **fulfillment_pending 되돌리기를 하지 않고** 바로 `withdrawn_member_hold`(closed)를 돌려준다. 닫은 주문이 대사에 다시 집히지 않게 하려는 것이다. (5판) |
| `retry_payapp_fulfillment` 1125573d… | 같음 |
| `resolve_payment_order_review` c9be280b… | `paid_confirmed` 이고 탈퇴 회원이거나 failure_code 가 `PAYMENT_FOR_WITHDRAWN_MEMBER` 면 `PAYMENT_REVIEW_MEMBER_WITHDRAWN` 으로 거절 |
| `prepare_payment_order` 462fed08… | 입력 검사 직후, checkout_attempts INSERT 전에 프로필을 FOR SHARE 로 읽어 탈퇴 회원이면 거절. 기존 주문 재사용 경로도 막힌다 |
| `begin_payapp_request` 6deb115e… | 주문 잠금 뒤 프로필을 FOR SHARE 로 읽어 거절 |
| `record_point_charge_checkout_ack` 0047854a… | 탈퇴 회원 거절 |
| `process_payapp_cancellation` f45eed1d… | `source_id IS NULL` 분기에서 주문이 이미 **`bank_transfer`** 로 닫혔으면 `v_result = 'double_refund_suspected'` 로 둔다. 그러면 기존 매핑(`PAYAPP_DOUBLE_REFUND_SUSPECTED`, critical, details 에 `source: 'withdrawn_held_order_bank_transfer'`)을 그대로 탄다. 다른 방법으로 닫혔으면 경보 없이 기록만 남긴다. (4판·5판) |
| `payapp_sales_resume_blockers` 22f52c89… | `held_order_closed` 로 닫힌 주문은 미지급 건수에서 뺀다 |
| `enforce_payment_reconciliation_health` 2c7b70c6… | 같은 조건으로 뺀다. blockers 와 **글자까지 같게** 고치고, 계약 시험의 조건 문자열도 함께 바꾼다. (4판) |
| `prevent_payment_order_snapshot_update` d7df22fd… | 익명화 거래 로컬 설정 값이 OLD.user_id 와 같을 때만 `request_fingerprint` 한 칸 변경을 받는다. 다른 스냅숏 칸은 계속 막고, VERIFY 에서 일반 UPDATE 가 거절되는지 본다. (4판) |
| `consent_record_internal` 254dc713… | source `withdrawal` 을 받는다. 철회만 받고, 항목 검사는 `consent_items_error(p_items, 'mypage')` 로, 필수 누락 검사는 건너뛴다. 탈퇴 회원의 다른 source 는 거절한다 |
| `guard_user_consents_mutation` e6518c87… | 기존 "프로필이 없으면 DELETE 허용" 분기는 그대로 두고, "익명화 거래 로컬 설정 값 = OLD.user_id 이면 DELETE 허용"을 더한다 (5판 문구 정리) |
| `guard_market_purchase_notice_acks_mutation` aa8e0414… | 같음 |
| `prevent_admin_event_mutation` c5ec0c9e… | 익명화·가림 함수가 켠 거래 로컬 설정이 있을 때만, `ref_table in ('support_tickets','refund_requests','market_refund_requests')` 행의 title·body UPDATE 를 받는다. DELETE·TRUNCATE·다른 칸 변경은 계속 막고, VERIFY 에서 설정 없는 UPDATE 가 거절되는지 본다. (5판) |
| `remind_unanswered_admin_work` c5f96dc4… | 탈퇴 회원 문의를 건너뛴다(`NOT EXISTS (… profiles.withdrawn_at IS NOT NULL)`). (5판) |
| `guard_support_ticket_revisions_mutation` 1104177c… | 가림 함수 설정이 있을 때만 해당 칸 UPDATE 를 받는다 |
| `cancel_incomplete_kakao_signup` 7efb18ab… | 탈퇴 회원이면 false |
| `complete_kakao_signup_with_consents` e40ece6e… | 탈퇴 회원 거절 |
| `consent_eligible_member_count` 56fcd733… | `withdrawn_at IS NULL` 조건 추가 |

"그대로여야 함" 목록:
- `credit_source_paid_root` 8e2c5a70
- `get_point_charge_refund_eligibility` 60fc28af
- `point_charge_refund_deadline` a9756c29
- `get_credit_balance_snapshot` 1c30e49a
- `complete_manual_point_charge_refund` 97967251
- `record_admin_audit` a42b474d
- `resolve_payment_alert` 969fc4bd
- `consent_items_error` 80d32d5a
- `consent_missing_required` 713ccf2f
- `record_payment_alert` 80ee3155
- `create_support_ticket` 2cfac569
- `update_own_pending_support_ticket` cb221135
- `soft_delete_own_support_ticket` c8148308
- `create_random_bank_exam_paper` 5cb7986c
- `generate_member_display_tag` 629b6fbf (5판)

(4판에서 consent_missing_required 부터 추가. 문의 함수 경로는 5-1 쓰기 막기 트리거로 덮는다.)

**보류 주문 닫기** `close_withdrawn_member_held_order(p_actor, p_order_id, p_method in ('payapp_cancel_request','provider_admin_cancel','bank_transfer'), p_note, p_operation_key)`, 대표만 실행한다. (4판)
- 할 일: 주문 `failed`·`canceled_at`, `payment_admin_actions(action = 'withdrawn_held_order_closed')`, `held_order_closed` 기록, 그 주문의 경보 해소.
  - `canceled_at` 이 이미 있으면 덮지 않는다.
  - 방법은 `external_method` 칸에 넣는다.
  - `p_note` 가 비면 입구에서 거절한다(CHECK).
  - 경보는 `order_payment_order_id`·`dedupe_key` 기준으로 해소한다. (5판)
- 받는 주문 상태(5판):
  - (가) `manual_review`·`PAYMENT_FOR_WITHDRAWN_MEMBER` → `bank_transfer` 로 닫는다.
  - (나) `failed` 이고 취소 통보가 기록·처리된 주문 → `payapp_cancel_request`·`provider_admin_cancel` 로 닫는다. 통보 전이면 "취소 통보를 기다려 주세요"로 거절한다.
  - (다) 부분취소 뒤 `manual_review(PAYAPP_PARTIAL_CANCEL)` → 기존 `cancel_handled` 로 먼저 정리한다. 그다음 남은 금액을 송금(`bank_transfer`)하거나 전액 취소(나)로 닫는다.
- 런북: 휴대폰 결제는 그달 안에 페이앱 취소를 먼저 한다.

코드 쪽:
- 웹훅 route COMPLETED_FEEDBACK_RESULTS 에 `withdrawn_member_hold` 를 더한다(알림 없음).
- 대사 코드에 같은 분기를 넣는다.
- 결제 route 휴대폰 저장에 `.is('withdrawn_at', null)` 를 더한다.

### 5-6. 미리보기·보조 함수
- `get_member_withdrawal_preview(p_user_id)`: facts, 소멸 예정(유료·무상·만료, 원천별), 기간 남은 유료 건(마감 시각), 진행 중 종류별, 가림 확인 필요 목록(id·종류·제목 앞부분), 지울 것·남길 것 건수, `selfAllowed`·`requestAllowed` 와 이유, 열린 요청.
- `create_member_withdrawal_request(p_user_id, p_channel, p_notice_text, p_notice_sha256, p_expected_balance, p_expected_forfeit_paid, p_expected_forfeit_free, p_identity_note, p_recorded_by)`: facts 를 다시 확인하고 만든다. 같은 회원의 `pending` 은 1건만 둔다.
- `cancel_member_withdrawal_request(p_user_id, p_request_id)`
- `mark_withdrawn_member_auth_scrubbed(p_user_id)`:
  - `auth_scrubbed_at` 을 기록한다.
  - 남은 세션을 다시 지운다.
  - `MEMBER_AUTH_SCRUB_PENDING` 경보(`dedupe_key = 'member_auth_scrub:'||id`)를 해소한다.
- `read_withdrawn_member_record(p_actor, p_user_id, p_reason)`, `read_withdrawn_member_ticket(p_actor, p_ticket_id, p_reason)`: 대표만 쓴다. `record_admin_audit('withdrawn_record_view', …, 사유)` 뒤에 내용을 돌려준다. 보관함·추가 기록·탈퇴 회원 문의 본문을 읽는 길은 이 두 함수뿐이다. (4판)

### 5-7. 로그인 계정 정리(서버)
1. 카카오 회원이면 익명화 함수가 회원번호를 보관함 `kakao_id_pending_unlink` 에 남긴다. 서버가 카카오 연결 끊기(`/v1/user/unlink`, 어드민 키·회원번호 기준)를 부르고, 성공하면 그 칸을 NULL 로 바꾼다. 완전 삭제 경로는 삭제 전에 연결 끊기를 먼저 한다.
   - 어드민 키 환경변수(`KAKAO_ADMIN_KEY`)가 없거나 연결 끊기가 실패하면 **소프트 삭제도 미루고** 경보를 남긴다. 다시 시도는 SECURITY DEFINER 함수로 그 칸을 읽는다.
   - 대표 할 일: Vercel 에 키를 등록한다. 코드에 값을 넣지 않는다. (4판·5판)
2. 1이 성공했거나 카카오 회원이 아니면, 서버가 `auth.admin.deleteUser(id, true)` 를 부른다.
3. 성공하면 `mark_withdrawn_member_auth_scrubbed` 를 부른다.
4. 1·2 중 하나라도 실패하면 경보(user_id·dedupe_key 만)를 남기고, 회원 상세에 "다시 시도"를 띄운다. 다시 시도는 실패한 단계만 다시 한다.

소프트 삭제는 회원 id 와 섞은 해시라 가명처리에 가깝다. 표·처리방침에 사실대로 적는다(4절).

### 5-8. 되돌리기
- **순서:** 코드를 10번 이전으로 되돌려 배포 → down_b → down_a. 10번 코드가 돌고 있으면 down_a 를 금지한다.
- **down_b**: 5-5 함수(4판에 더한 `enforce_payment_reconciliation_health`·`prevent_payment_order_snapshot_update` 포함)와 5-4·5-1 트리거를 원래대로 되돌린다. `anonymize_member`·요청·미리보기 함수의 EXECUTE 를 회수한다.
  - 사전 확인: 10번 md5 일치, **보관함 행 0·요청 행 0**. 탈퇴 회원이 있으면 되돌리지 않는다. 그때는 고쳐서 앞으로 간다.
- **down_a**: 사전 확인 — 보관함·요청·추가 기록 행, `withdrawal_forfeit`·`withdrawal` 기록, `withdrawn_held_order_closed` 행, `redaction_reviewed_at`, 미해결 `MEMBER_*`·`PAYMENT_FOR_WITHDRAWN_MEMBER` 경보, details source 가 `withdrawn_held_order_bank_transfer` 인 `PAYAPP_DOUBLE_REFUND_SUSPECTED` 경보, 5-5 md5 가 원래 값 아님. 하나라도 있으면 RAISE 한다.
- down_a 지우는 순서(5판):
  1. RESTRICTIVE 정책 4개(withdrawn_at 을 참조)
  2. 새 테이블: 추가 기록 → 보관함 → 요청
  3. CHECK 원래 값
  4. `withdrawn_at`·`redaction_reviewed_at` 칸
  5. 설정 행
- 다시 적용하려면 schema_migrations 행을 지운다. 10번 적용 뒤에는 9번 down 을 금지한다.

## 6. 코드 변경
1. `src/lib/member-withdrawal-server.ts`: 미리보기·요청·익명화(40P01 재시도)·로그인 계정 정리·다시 시도·열람·오류 문구.
2. `/api/auth/withdraw`(회원):
   - 관리자: 403
   - 결제·결제 시도·문의 모두 없음: 완전 삭제. 삭제 목록에 생성 기록을 더하고, 판정은 facts 로 한다.
   - `selfAllowed`: 익명화
   - 결제 회원·`requestAllowed`: 탈퇴 요청을 만든다(channel `screen`)
   - 그 밖: 409 와 이유, 가능 예정일(마감 시각·7일 뒤). 가림 확인·페이앱 미확인으로 막히면 대표 경보를 남기고 "10일 안에 이메일로 안내"라고 보여 준다. (4판)
   - 요청 취소 API 를 둔다.
   - `selfAnonymizeEnabled` 가 꺼져 있으면 익명화·요청 경로는 409("잠시 후 이용")이다. 완전 삭제는 지금처럼 된다. (4판)
3. 탈퇴 화면(`/mypage/withdraw`, metadata 포함):
   - 경우: 완전 삭제 / 익명화 / 탈퇴 요청(결제 회원) / 열린 요청 있음(취소 가능) / 지금은 불가(이유·예정일)
   - 익명화·요청 고지 내용:
     - 구매 자료 다운로드 불가
     - 재가입해도 크레딧·구매·문의 이어지지 않음
     - 후기 삭제
     - 문의 3년 보존(회원 화면에서 사라짐)
     - 소멸 크레딧(유료·무상, 만료일, 유료분의 원 환산)
     - '환불되지 않음'
     - 미성년자 취소·하자·표시와 다른 제공 같은 법정 환불은 탈퇴 뒤에도 고객센터로 요청 가능
     - 마케팅 수신동의 철회(요청하는 순간 철회되고, 요청을 취소해도 되돌리지 않음)
     - 되돌릴 수 없음
     - 탈퇴 전에 남은 크레딧을 쓸 수 있음. 요청 뒤 처리 전에 크레딧을 쓰면 실제 소멸액이 줄어듦. 충전하면 다시 요청해야 함. 처리 예정은 요청일부터 10일 안. (4판)
   - 체크 항목을 나눈다:
     - ① 소멸 동의(금액 포함)
     - ② 기록 보존·삭제 안내 확인. 비결제 회원은 13절 3번 답이 올 때까지 문의 보존을 **선택**으로 받는다: "문의 3년 보존에 동의" / "동의하지 않음 — 문의도 지움". 동의하지 않으면 문의를 지운다. 남는 기록이 없으면 완전 삭제로 간다. (4판·5판)
     - ③ 되돌릴 수 없음 확인
   - 새 `terms` 판에 아직 동의하지 않은 회원(동의 게이트는 탈퇴 화면을 막지 않음)에게는 ①을 별도 동의로 받고, 그 판 정보를 고지 원문에 넣는다. (4판)
   - 문구는 `member_withdrawal_policy.texts`, 없으면 기본 문구를 쓴다. 고지 원문·지문은 서버가 만든다.
   - 완료 화면에 결과를 보여 준다: 삭제·보존 항목, 마케팅 철회(보낸 곳·철회 사실·처리 일시).
4. 회원 상세(`/admin/users/[id]`, 대표만):
   - 열린 탈퇴 요청과 미리보기 표
   - 가림 확인 필요 목록: [가림](대상 문구 입력)·[확인함]
   - 페이앱 미확인 체크, 사유(개인정보 금지 안내), 확인 창(회원 이메일 입력) → 익명화
   - 이메일·전화 요청 기록 폼. 요청자 종류(본인·법정대리인·위임 대리인), 접수 시각, 본인 확인 메모(연락처·신분증 내용 금지)를 받는다. 유료 소멸분이 있으면 [고지 원문 만들기]로 서버 원문을 복사해 보낸 뒤 보낸 시각·회신 시각을 기록한다. (4판)
   - 탈퇴 회원 주문의 자료 예외 환불·승인 버튼은 '탈퇴 회원 — 현금 정산 기록'(`add_withdrawn_member_event`)으로 바뀐다. route 는 `MEMBER_WITHDRAWN` 을 안내 문구로 바꾼다. (4판)
   - 탈퇴한 회원: 날짜·방법·추가 기록 목록
     - [보관 연락처 보기](사유 입력, 열람 기록)
     - [로그인 계정 정리 다시 시도]
     - 보류 주문이 있으면 [보류 주문 닫기]
5. API(대표만, 서버에서 확인):
   - 요청 기록, 미리보기, 익명화, 다시 시도, 연락처 열람, 탈퇴 회원 문의 열람
   - 가림·확인함, 보류 주문 닫기, 추가 기록
6. 보존 기록 화면:
   - 관리자 문의 목록·상세: 탈퇴 회원 문의는 RLS 로 안 보인다. 목록에는 서버가 "탈퇴 회원 · 법정 보존 N건" 줄만 보이고, 대표가 사유를 입력하면 열린다.
   - 주문·환불 화면: "탈퇴 회원" 표시, 본문·사유·메모는 가림.
   - 자료 환불 목록(지금은 세션 클라이언트로 읽어 RLS 로 행이 사라짐)은 탈퇴 회원 행을 service_role 로 읽는다. "탈퇴 회원" 표시와 사유·메모 가림을 붙여 목록에 남긴다. (4판)
   - 충전 환불 목록(service_role)은 코드로 reason·admin_note 를 가린다. (4판)
   - service_role 로 문의 제목·본문·사유를 읽는 경로를 모두 가린다. 탈퇴 회원이면 제목을 '탈퇴 회원 문의'로 보여 준다(4판, 목록 확정):
     - 대시보드 최근 문의
     - 회원 상세 문의 목록
     - member-summary
     - `getMarketOrderRefundContext`
     - 관리자 문의 상세 링크
     - 환불 화면
   - 시험(T10·코드 시험)으로 각 응답에 본문·제목이 없는지 확인한다.
7. 수동 환불·외부 취소 격리 화면: 원천별 `withdrawal_forfeit` 합을 "탈퇴로 소멸(사용 아님)"으로 따로 보여 준다(서버 계산).
   - 탈퇴 회원 주문은 화면의 사용량을 `initial − remaining − 소멸` 로 계산한다.
   - 격리 함수의 관리자 알림 문구는 바꾸지 않는다. 대신 런북 RB-11·미성년자 런북에 "탈퇴 회원은 알림의 '사용 크레딧'에 소멸분이 들어 있음, 화면 값을 볼 것"을 적는다. (5판)
8. 크레딧 type 나열에 `withdrawal_forfeit` 를 넣는다. 시험으로 목록이 같은지 확인한다.
   - `admin-credit-transactions-server.ts`(목록·월 집계에 '탈퇴 소멸')
   - 관리자 크레딧 유형 필터
   - `admin-credit-transaction-kind.ts`
   - `credit-transaction-display.ts`("탈퇴로 소멸")
   - `credits.ts`
   - `mypage credits-view.tsx`
   - 옛 마이페이지 필터
9. 회원 목록에 "탈퇴" 표시를 단다.
10. 관리자 계정이 `/mypage/profile` 에서 비밀번호를 바꾸려 하면 관리자 비밀번호 변경 화면으로 보낸다(후속 과제 정리).

## 7. 약관·처리방침·가입 동의 문구(DB 스크립트)
> **(2026-11-25 대표 결정으로 바뀜 — 15번 계획 `docs/plan-bundle15-notice-popup.md` 0절)** 실결제 회원 4명이 있어 '바로 시행'하지 않는다. 30일 전에 고지하고 **2027-01-11(월)에 시행**한다. 스크립트는 `c_mode` 로 게시(`publish_upcoming`)·시행(`apply`)·고지 그만두기(`withdraw_upcoming`)를 하고, 시행일 문장은 상수 `c_effective_date` 로 만든다(실행한 날이 아님). 절차는 런북 RB-11 10-2·10-13. 아래 '배포 직후 같은 작업 창'·'바로 시행'·'실회원이 없어' 줄은 그 결정 전의 기록이다.

- **30일 전 고지(15번 계획 8절, 시행일 2027-01-11, 고지 마감 2026-12-10 KST)** — 대표·내가 적는 칸
  - 이메일 발송 ____(일시) · ____명 · 목록 md5 ____ (대표가 적음. 받는 사람 = 재동의 대상 − 대표가 시험 계정으로 표시한 것, 발송 직전에 뽑음)
  - 시행 직전 추가 발송(고지 기간 새 가입자) ____(일시) · ____명
  - 팝업 노출 시작 ____ (site_notice_popup_save 의 exposure_starts_at, 기록 id ____)
  - 변경 예정 글 게시 ____ (policy_upcoming_publish, 문서 지문 앞 12자리 ____ / ____ / ____)
- (아래는 2026-11-25 결정 전 기록) 배포 직후 같은 작업 창에서 적용한다.
- 적용 전에는 서버 설정 `member_withdrawal_policy.selfAnonymizeEnabled = false` 로 스스로 익명화·요청 경로를 꺼 둔다(완전 삭제는 지금과 같다). 문구를 적용한 뒤 켠다.
- (결정 전 기록, 지금은 위 30일 고지 경로) 출시 전이라 바로 시행한다. 실회원이 없어 재동의 영향이 작다.
  - **대표 확인 필요:** 비관리자 계정 14개가 모두 대표·시험 계정인지 확인한다. 확인 일시를 이 절에 적는다.
    - (2026-11-24 구현 때 정정) 실제 재동의 대상(`consent_eligible_member_count()`)은 **15명**이다. 내부 계정이 아닌 이메일을 쓰는 대표 계정 1개가 포함된다.
    - 문구 스크립트의 `c_confirmed_count`·`c_confirmed_members_md5`(정렬한 회원 id 목록의 md5)는 기본 NULL 이다. 대표가 확인한 뒤 채우며, 비어 있거나 목록이 바뀌면 스크립트가 멈춘다.
    - 확인 일시: ____ · 확인 인원: ____명 · 목록 md5: ____ · 확인한 사람: ____ (대표가 적음)
    - 리허설(2026-11-25, 운영 DB BEGIN…ROLLBACK, 임시 사본에만 15·당일 목록 md5 를 넣음, 원본과 diff 는 상수 2줄·끝 예외·ROLLBACK 뿐): VERIFY 전체 통과. 시행일 2026년 11월 25일, terms·privacy 2판, 재동의 대상 15명(새로 다시 동의 2명), 회원 15명의 `get_member_withdrawal_notice` 고지 원문 확인(결제 회원 문의 보존 줄 1건 새 문구). 롤백 뒤 변화 없음.
    - 실회원이 있으면 바로 시행하지 않는다. 30일 전에 공지하고 시행일에 스크립트를 실행하며, 그때까지 스위치를 켜지 않는다(런북 RB-11 10-2).
  - 문구를 적용할 때 시행일을 갱신하고 변경 내용을 공지한다. 스냅숏은 자동으로 남는다. (4판)
- 출시 뒤 같은 변경은 약관 3조②·처리방침 14절 고지 기간을 따른다(기록).

**이용약관 12조**
- ①: 결제 이력이 있는 계정은 탈퇴 화면에서 탈퇴를 요청하고 회사가 확인한 뒤 처리한다. 결제를 끝내지 않은 결제 시도만 있는 계정은 바로 탈퇴할 수 있다. 다만 진행 중인 결제·환불, 확인이 필요한 문의, 최근 결제 시도가 있으면 확인을 마친 뒤 탈퇴할 수 있다.
- ②: 탈퇴하면 남은 크레딧은 소멸한다. 환불 기간이 남은 충전 건이 있으면 그 건을 환불하거나 기간이 지난 뒤 탈퇴할 수 있다. 법정 환불(미성년자 취소·하자 등)은 탈퇴 뒤에도 고객센터로 요청할 수 있고, 원래 결제수단이나 계좌로 처리한다.
- 가입 동의 `terms` 새 판(②는 불리한 변경)을 만든다.

**취소/환불정책** 새 절 "탈퇴와 크레딧"(②와 같은 내용).

**처리방침 3절**
- 첫 문장을 "회원이 탈퇴하면 개인정보를 지체 없이 파기합니다. 다만 아래 기록은 정한 기간 동안 분리 보관한 뒤 파기합니다."로 바꾸고, 결제 여부별 보존 목록을 그 아래에 둔다. privacy 새 판과 6절 Supabase 보유 기간도 같은 구조로 쓴다. (5판)
- 보존 항목: 주문자 이메일·회원정보의 휴대폰 번호·카카오 계정 이메일, 결제 때 입력한 휴대폰 번호(복원할 수 있는 해시), 주문·결제·환불 내역, 자료 구매·이용 권한·다운로드 기록, 크레딧 적립·사용 내역, 결제 전 확인·구매 고지 동의.
- 기간: 마지막 거래일부터 5년(전자상거래법 6조).
- 가입·개인정보·마케팅 동의 기록은 동의 사실 확인을 위해 **5년**(설정 `consentRecordRetentionYears`) 보존한다. 전자상거래법 6조 근거로 묶지 않는다. 변호사 답이 오면 고친다. (4판·5판)
- 탈퇴 처리 기록(탈퇴 요청·고지 원문·소멸 내역)은 탈퇴일부터 5년 보존한다. (4판·5판)
  - (2026-11-25 문구 스크립트에 맞춰 정정) 결제 이력과 상관없이 기산점은 탈퇴일이다(보관함 `withdrawn_at`). 처리방침에서는 '분쟁 대응을 위해 회사가 보관하는 기록'(근거: 회사의 정당한 이익)으로 적는다. 기산점·근거는 13절 4·17번 답을 따른다.
- 결제 이력이 없는 회원의 문의는 탈퇴할 때 동의를 받아 3년 보존한다(동의하지 않으면 함께 삭제). (5판)
- 대리인 위임·본인 확인 자료는 확인을 마치면 지체 없이 파기한다. (5판)
- 문의: 결제 이력이 있는 회원은 마지막 처리일부터 3년(전자상거래법 시행령 6조 소비자 불만·분쟁처리 기록). 결제 이력이 있는 회원의 환불 신청과 연결된 문의는 5년. (5판: 비결제 회원은 아래 동의 문장으로)
- 결제를 끝내지 않은 결제 시도 기록은 개인정보를 지운 뒤 늦은 결제 확인을 위해 5년 보존한다.
- 로그인 계정은 이메일 등을 되돌릴 수 없는 해시 값으로 바꿔(가명 상태) 보존 기간 동안 두었다가 완전 삭제한다. (5판)
- 보존 기록은 분리해 보관한다. 보존 목적(분쟁·법정 환불 대응)과 탈퇴 처리 결과 안내 외에는 쓰지 않는다.
- 환불 계좌·확인 자료는 처리를 마치면 문의·기록에서 가린다.

**처리방침 6절 Supabase "보유 기간"**과 **가입 동의 `privacy` 새 판**은 3절과 같은 내용으로 맞춘다. 기존 회원은 다음 로그인 때 다시 동의한다. (4판)

## 8. 처리 결과 안내와 지연 안내
- **스스로 탈퇴:** 완료 화면.
- **결제 회원(대표 처리):** 런북 RB-11 을 고친다.
  - 요청을 받은 날부터 10일 안에 처리한다.
  - 회원이 요청 뒤 충전해서 소멸액이 동의 금액보다 커지면 거절된다. 그 사유로 10일 안에 재요청을 안내한다. (4판)
  - 가림 확인 요청 경보(`MEMBER_WITHDRAW_REVIEW_NEEDED`)는 10일 안에 처리하고 회원에게 알린다. (4판)
  - 막히면(진행 중·기간 남음) 그 사유와 예정일을 10일 안에 회원 이메일로 알린다(개인정보 보호법 36조·시행령 43조).
  - 처리 뒤 보관 연락처(열람 기록)로 대표 메일함에서 완료·마케팅 철회 결과를 보낸다.
- **이메일·전화로 요청한 회원(종류 상관없음)·대리인:** 대표가 요청을 기록하고 처리한다.
  - 결과는 익명화에 **성공한 뒤** 받은 메일 스레드에 회신해 보낸다. 보낸 시각은 `add_withdrawn_member_event(note)` 로 남긴다. (5판)
  - 요청을 기록할 때 마케팅을 철회했으면, 대표가 14일 안에 받은 메일 주소로 철회 결과(보낸 곳·철회 사실·처리 일시)를 보낸다. 보낸 시각은 같은 방법으로 남긴다. (5판)
  - 대리인 위임·본인 확인 자료와 대표 메일함의 요청 메일은 확인·처리를 마치면 지운다(런북). (5판)

## 9. 범위 밖(후속)
- 보존 만료 뒤 파기(보관함·요청·추가 기록·문의·결제 기록, auth.users 완전 삭제). 기준 시각과 설정 값으로 계산한다.
- `support_tickets.user_id` 의 auth.users FK 를 없애고 profiles FK 만 남겨, 비결제 회원 auth.users 를 바로 완전 삭제할 수 있게 하는 것.
- 관리자 2단계 인증이 생기면 보관함 열람 함수·API 가 aal2 를 요구하게 하는 것.
- 파기 목록에 `admin_events` 를 넣는 것. (4판)
- 가입 미완료 계정 자동 정리(`withdrawn_at IS NULL` 만 대상).
- 자동 완료 메일.
- 탈퇴 회원 자료 법정 환불의 주문 상태 정리.

## 10. 검증·시험
- **계획 검증:** DB 4관점 PASS 까지.
- **구현 검증:** DB 4관점 + 코드 2관점.
- **리허설(BEGIN…ROLLBACK):**
  - T1: 결제 회원 익명화. 확인할 것:
    - 보관함, 소멸 원장(`balance_after = 0`)
    - 스냅숏 4값이 모두 0(만료분만 있는 회원 포함)
    - 삭제·보존 건수, 동의 철회, 세션, `banned_until` 유한 값
    - admin_events 제목 바뀜(문의가 있는 회원 익명화 성공)
    - 대기 문의 closed, 그 뒤 `remind_unanswered_admin_work` 실행 → 새 이벤트 0건 (5판)
  - T2: 재요청(같은 키 / 다른 키), 요청 상태.
  - T3: 진행 중 1~8 종류별(order_id 가 NULL 인 웹훅 이벤트, 경보 키 종류별, 표식만 있고 처리 전).
  - T4: 잔액 변경, 기간 남은 유료(환불 가능 / 일부 사용 + 기간 안), 마감 값이 eligibility 와 같은지.
  - T5: 스스로 탈퇴. 경우:
    - 결제 시도만 + 낡은 claimed(318f9d38 형태). 주문·결제 시도 fingerprint 가 모두 바뀌는지 본다.
    - 최근 시도
    - 돈이 오간 주문
    - 지급 전 취소
    - 페이앱 미확인 두 종류
    - 옛 결제 내역만
    - plan_purchase 원천만
    - 검증 실패 통보 뒤 unpaid_confirmed 주문 → 결제 회원 판정
    - `selfAnonymizeEnabled = false` 거절
  - T6: 관리자, 비대표, 요청 오류(남의 요청 / 동의보다 큰 소멸 / email 경로 유료 소멸인데 회신 기록 없음), 비결제 email 요청 처리, 대리인 요청.
  - T7:
    - 탈퇴 회원 지급(apply·retry·resolve) → 보류, 알림 없음, 반복해도 1건.
    - 익명화 판단 뒤 늦은 결제완료 → 보류·late_payment 기록.
    - 보류 주문 닫기 3방식 → 판매 재개 차단 해제. 그 뒤 `enforce_payment_reconciliation_health` 를 실행해도 판매가 다시 꺼지지 않는지.
    - 통보 전 provider_admin_cancel 닫기 거절.
    - 계좌 송금으로 닫은 뒤 취소 통보 → 이중 환불 경보. provider_admin_cancel 로 닫은 뒤 통보 → 경보 없음.
    - 닫은 뒤 같은 결제완료(4) 통보 재처리 → status=failed·failure_code 유지, 다음 대사 회차에 집히지 않음, 경보 변화 없음. (5판)
    - 부분취소 뒤 닫기(cancel_handled → 송금). (5판)
  - T8: 탈퇴 뒤 refund_credits·관리자 지급·자료 재지급 거절, 알림 거절, 수동 환불 완료 → manual_refund 기록.
  - T9: prepare(새 요청 / 같은 결제 시도 재요청), ack·begin 거절.
  - T10: 가림·확인함(문의 4칸·이력·환불 메모·admin_events), 감사 기록, 확인 뒤 회원 수정 → 다시 확인 필요. CS 직원 JWT 로 탈퇴 회원 문의·자료 환불 SELECT 0행, UPDATE 거절. 탈퇴 회원 JWT 로 문의 함수·문제지 함수·INSERT 거절. 보관함 service_role SELECT 거절.
  - T11: 카카오 미완료 함수 거절, 동의 대상 회원 수에서 제외.
  - T12: 비결제 익명화.
    - 가입 동의·구매 고지 동의가 있는 회원 → 삭제 성공, fingerprint 임의 값
    - 문의 보존 동의 → 문의 보존 / 미동의 → 문의 삭제·완전 삭제
    - 완전 삭제 대상(동의 기록 있음) 삭제 성공
    - 요청 기록이 있는 기록 없는 회원 → 익명화 경로 (5판)
  - T14: 탈퇴 요청. 확인할 것: (4판·5판)
    - 마케팅 즉시 철회, 요청 취소 뒤에도 철회 유지
    - pending 1건 제한
    - 요청 뒤 크레딧 사용(소멸액 감소) → 처리 성공·두 금액 기록
    - 요청 뒤 유료 사용 + 관리자 무상 지급 → 무상 초과로 거절
    - 막힘 화면의 광고 철회 버튼
  - T15: `point_charge_cash_value` 계산 고정(재지급 자손 포함), 탈퇴 차단 여유일. (5판)
  - T13: 되돌리기 — 보관함 행이 있을 때 down_b RAISE / 행이 없을 때 (나)→(가)·사전 확인·재적용.
- **적용 뒤 시험 계정 확인:** 대표가 만든 계정으로 한다. 비밀번호는 Claude 가 넣지 않는다.
  - 차단 직후 `getUserById`·`deleteUser(id, true)` 가 성공하는지
  - `raw_user_meta_data`·`identity_data`·`one_time_tokens` 가 비었는지
  - 같은 이메일로 재가입되는지
- **시험 코드:** `tests/bundle10-member-withdrawal-contract.test.mjs`, 기존 탈퇴 시험 수정.

## 11. 순서
1. 계획 PASS → 구현 → 시험 → 구현 검증 PASS → 리허설.
2. (대표 승인) DB 적용 → push·배포 → 같은 창에서 7절 문구 스크립트 → `selfAnonymizeEnabled` 켜기 → 시험 계정 확인.
3. DB 적용~배포 사이에는 옛 코드가 돈다(결제 회원 409, 비결제 완전 삭제). 출시 전 예외로 두고, 적용 직후와 문구 적용 뒤에 탈퇴 0건을 확인한다.

## 12. 대표 할 일에 더할 것
- 페이앱 재통보(결제 통보 재시도) 횟수·간격 확인.
- 쓰지 않는 대표(owner) 계정 정리. 지금 4개이고 2개는 로그인한 적이 없다. (4판)
- 카카오 어드민 키를 Vercel 환경변수 `KAKAO_ADMIN_KEY` 로 등록(연결 끊기용). (4판)
- 비관리자 계정 14개가 모두 대표·시험 계정인지 확인(7절). (4판)

## 13. 변호사 확인 목록에 더할 질문
1. 회원이 스스로 해지(탈퇴)할 때, 환불 기간이 지난 미사용 유료 크레딧을 환급 없이 소멸시키는 조항이 유효한지(약관규제법 6조, 콘텐츠이용자보호지침의 해지 시 환급 취지). 환급해야 한다면 위약금(예: 10%)을 떼고 환급할 수 있는지. 보관함 `forfeit_breakdown` 으로 사후 환급액을 계산할 수 있다. 미성년 회원의 소멸 동의(민법 5조)도 묻는다.
2. 결제를 끝내지 않은 결제 시도와 무상 크레딧 자료 구매가 전자상거래법 6조 보존 대상인지.
3. 결제한 적 없는 회원의 문의가 '소비자 불만·분쟁처리 기록'(시행령 6조)인지. 아니라면 이미 익명화한 비결제 회원 문의를 바로 파기한다(설정 키 `nonPayerTicketRetentionYears`).
4. 보존 기간 기산점(거래일·탈퇴일·분쟁 종결일), 환불 신청 문의를 5년 둘지 3년 둘지.
5. 보존 문의 본문의 계좌·확인 자료 가림이 '파기'로 충분한지.
6. 통신비밀보호법 시행령 41조②의 로그기록·접속지 자료 3개월 보관 의무 대상인지. 대상이라면 탈퇴 즉시 다운로드 IP 를 지우는 것이 위반인지.
7. 동의 기록의 탈퇴 후 보존 기간.
8. 해시 치환(소프트 삭제)이 파기로 인정되는지.
9. 처리방침·약관·가입 동의 문구 변경 때 기존 가입자 재동의가 필요한지.
10. 약관 위반으로 대표가 직권 해지할 때 유료 크레딧 처리(범위 밖).
11. 보관할 휴대폰 번호가 회원정보 번호로 충분한지, 결제 때 입력한 번호(해시 `request_fingerprint`)를 보존해도 되는지와 기간.
12. 결제 회원 탈퇴를 '요청 → 회사 확인 뒤 처리'로 하고, 진행 중 환불·기간 남은 충전 건 때문에 미루는 것이 개인정보 보호법 36조·38조④와 약관규제법 9조(해지권 제한)에 맞는지, 통지 방법.
13. 보관 연락처로 완료 안내·법정 환불 연락을 하는 것이 21조3항의 목적 외 이용인지.
14. 바뀐 약관(12조② 소멸)에 동의하지 않은 회원이 3조③에 따라 해지할 때도 새 소멸 조항을 적용할 수 있는지, 옛 약관 기준으로 미사용 유료분을 환급해야 하는지. (4판)
15. 출시 전이라도 게시된 처리방침 14절·약관 3조②의 고지 기간을 생략할 수 있는지. (4판)
16. 로그인할 수 없는 회원이나 대리인의 탈퇴 요청에서 유료 크레딧 소멸 동의를 어떤 방식으로 받아야 유효한지(이메일 고지·회신으로 충분한지). (4판)
17. 탈퇴 요청 기록·고지 원문·본인 확인 메모의 보존 기간. (4판)
18. 관리자 알림(admin_events·Slack)에 복사된 문의 제목을 탈퇴 때 지워야 하는지(Slack 은 1년 자동 삭제). (4판)
19. 비결제 회원 문의 보존을 탈퇴할 때 동의로 받는 것이 유효한지, 거부 경로(문의 삭제)로 충분한지. (5판)
20. 청약철회 말일이 휴일이라 연장되는 경우 탈퇴 차단·소멸 고지를 어떻게 해야 하는지. 지금은 여유 3일을 둔다. (5판)
21. 탈퇴가 막힌 시도를 광고 수신 거부 의사로 봐야 하는지. 지금은 버튼으로 바로 철회할 수 있게 한다. (5판)
22. 막힘을 화면에 바로 보여 주는 것으로 시행령 43조 통지를 갈음할 수 있는지, 이의제기 방법 안내 방식. (5판)
23. 대리인 위임 확인 자료와 대표 메일함에 남은 요청 메일의 보존·파기 기준. (5판)

## 14. 5판 검증 결과와 구현 때 반영할 것
5판 검증 결과는 지급·환불·마이그레이션·법률 4관점 모두 **PASS** 다(2026-11-24). 아래 minor 는 계획 변경 없이 구현 때 반영한다.

1. **부분취소 뒤 보류 주문 닫기:** 탈퇴 회원 보류 주문(late_payment 기록 있음)은 `resolve_payment_order_review` 의 `cancel_handled` 를 거절한다. 닫기 함수가 `manual_review(PAYAPP_PARTIAL_CANCEL)` 를 직접 받는다(남은 금액 bank_transfer, 또는 전액 취소 통보 뒤 페이앱 방식). T7: 부분취소 → 송금 닫기 → 늦은 전액 취소 → `PAYAPP_DOUBLE_REFUND_SUSPECTED`.
2. **prepare 잠금 순서:** `prepare_payment_order` 의 탈퇴 확인은 "결제 시도 `SELECT … FOR UPDATE` 다음, payment_orders INSERT 전"에 프로필 FOR SHARE 로 둔다. 거절하면 그 거래는 롤백된다.
   - 5-2 의 "주문·ppt 는 잠그지 않음"은 **결제 회원 경로만** 해당한다.
   - 익명화는 잠금 전 임시 판정으로 경로를 고르고, 잠금 뒤 다시 판정한다. 잠금 뒤 결과가 결제 회원이면 비결제 경로는 거절하고 다시 시도한다.
3. **문의 보존 선택:**
   - `anonymize_member`·`create_member_withdrawal_request` 에 `p_ticket_retention_agreed` 를 넣는다. 스스로 경로는 필수, 대표 경로는 요청 값과 같아야 한다.
   - 보관함에 칸을 두고, 고지 원문(지문)에 선택 결과를 넣는다. email·phone 경로에서 회신이 없으면 '동의 안 함(삭제)'을 기본값으로 한다.
   - 미동의면 5-2 5단계에 '문의 삭제(수정 이력 CASCADE)'를 넣는다. 삭제 전에 admin_events 제목을 바꾼다.
   - facts 의 완전 삭제 조건: 결제·결제 시도 없음, 요청 없음, 문의 없음 또는 보존 미동의.
   - 보존을 거부하면 '가림 확인 필요' 조건을 판정에서 뺀다.
   - 선택 문구에는 목적(분쟁 대응), 항목, 기간(3년), 거부해도 불이익이 없음을 넣는다.
4. **완전 삭제 경로의 admin_events:** 문의를 지우기 전에 admin_events 제목·본문을 '탈퇴 회원 문의'로 바꾸는 내부 함수(같은 거래 로컬 설정)를 부른다.
5. **`prevent_admin_event_mutation` 예외 조건:**
   - `OLD.ref_table/ref_id` 의 대상 행 user_id 가 설정 값과 같을 때만 받는다.
   - `notify_gave_up` 사본(ref_table='admin_events', ref_id = 그 회원 이벤트 id)도 대상에 넣는다.
   - TG_OP 가 TRUNCATE·DELETE 면 먼저 거절한다.
   - VERIFY 에서 다른 회원 이벤트 UPDATE 가 거절되는지 본다.
6. **카카오 연결 끊기:** 소프트 삭제는 바로 하고, 연결 끊기만 따로 다시 시도한다(보관함 `kakao_id_pending_unlink`). 그 회원번호로 새 identities 가 생겼으면 연결 끊기를 건너뛰고 칸을 NULL 로 바꾼다. 완전 삭제 경로에서 연결 끊기가 실패하면 탈퇴는 진행하고 경보를 남긴다. 이때 회원번호는 경보 details 에 넣지 않으므로 런북 수동 처리로 간다. `selfAnonymizeEnabled` 를 켜기 전에 `KAKAO_ADMIN_KEY` 를 등록한다(대표 할 일).
7. **되돌리기:** down_b 는 새 트리거를 지우고 새 함수 전부의 EXECUTE 를 회수한다. down_a 는 새 함수·트리거 함수를 DROP 한다. T13 에서 pg_proc 에 남은 것이 없는지 본다.
8. **원 환산과 사용량:**
   - `point_charge_cash_value` 의 회수는 뿌리 + `credit_source_reissued_descendants(뿌리)` 의 refund 음수 합이다.
   - 환불액은 뿌리 주문의 completed `refund_amount` 합, 결제 금액은 `expected_amount` 다.
   - 6-7 사용량은 가족 단위로 `initial(뿌리) − Σremaining − Σ소멸` 이다. T15 에 자손 회수·소멸이 있는 경우를 넣는다.
9. **답변 대기 문의:** 미리보기에 '답변 대기 문의 N건'을 넣는다. 대표 경로는 [답변했거나 환불 요청 없음 확인] 체크를 받는다(감사 기록). 스스로 탈퇴 고지에는 '답변 대기 문의는 닫히며, 환불 요청은 탈퇴 뒤에도 가능'을 넣는다. 자동으로 닫은 시각은 `last_ticket_event_at` 에 넣는다.
10. **막힘 화면:** `REFUND_PERIOD_OPEN` 이면 [크레딧 화면에서 환불 신청] 링크를 둔다. 여유 기간이면 '마지막 날이 휴일이었다면 고객센터로 환불 요청 가능' 문구를 넣는다(DB 문구).
11. **처리방침 2절:** 탈퇴 요청 항목(접수 경로·요청자 종류·고지 원문·회신 일시, 대리인 이름·연락처·위임 확인 자료(확인 뒤 파기))을 넣는다. 동의 기록 문장은 '결제 이력이 있는 회원의 … 탈퇴일부터 5년'으로 고친다.
12. **탈퇴 확인 문구:** 모든 경우에서 '모든 약관에 동의합니다'를 빼고 '회원 탈퇴를 최종 확인합니다'로 바꾼다(DB 문구).
13. **열람 기록:** 열람 API 가 요청 IP·기기 정보를 audit details 에 넣는다. 런북에 '보관함 열람 기록 월 1회 점검'을 둔다. 관리자 전체 접속기록은 9절 후속이다.
14. **변호사 목록:** 13절 질문과 아래 질문을 `docs/launch-owner-todo.md` 6절로 옮기고, 낡은 문장('지금은 탈퇴 때 문의가 지워짐')을 고친다. 출시 직전 확인에 '13절 1·3·12·14·19번 답 반영'을 넣는다.
    - 탈퇴할 때 답변 대기 문의를 자동으로 닫는 것이 환불 의사 접수와 충돌하는지
    - 문의 보존 선택 동의의 고지 요소·증빙
    - 열람 기록이 안전성 확보조치 기준 8조를 채우는지
    - 휴일 여유 기간에 탈퇴도 환불도 막히는 상태를 피하는 방법
