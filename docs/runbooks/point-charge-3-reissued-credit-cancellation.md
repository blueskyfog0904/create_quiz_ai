# 런북 3 — 다시 지급한 크레딧이 얽힌 충전 결제 취소·수동 완료

- 작성일: 2026-11-23 · 9번 묶음(문구 초안 F0·F3)
- 서비스 상태: **출시 전**. 출시 뒤에 쓸 절차를 미리 적은 문서입니다.
- 읽는 사람: 대표. 근거 조항: 취소·환불정책 3-2절 ⑥.
- 말뜻: **다시 지급한 크레딧(재지급분)** = 자료 환불 때 원래 크레딧의 유효기간이 지났거나 짧아서 새로 지급한 크레딧. 원래 충전 크레딧과 같게 봅니다.

## 0. 공통: 사용 보류 수단
- **PG 로 취소할 수 있으면 '접수 즉시 페이앱 콘솔 전취소'가 보류입니다.** 취소 통보 → 사이트가 원래 원천과 그 결제에서 비롯한 재지급분(사슬 전체)을 함께 사용 보류(`pending_refund`)하고 요청을 '수동 확인'에 올립니다.
- 접수부터 격리까지 사이에 쓴 몫은 수동 완료 화면의 원천별 원자료(사용 합 = `credit_consumption`, 자료 환불 복구·재지급으로 넘긴 양 = `market_refund_requests.allocated_items`·재지급 연결, 순사용 = 처음 − 남은)로 대표가 판단합니다. **이미 쓴 몫은 화면이 자동 계산하지 않습니다.**
- **PG 로 취소할 수 없으면** 대표 승인 뒤, 리허설한 SQL 템플릿을 SQL 편집기(postgres)에서 씁니다.
  - 보류: `supabase/scripts/bundle9_point_charge_hold.sql` (한 트랜잭션)
    - 그 원천에 열린 요청이 이미 `manual_review` 면 멈춤 — "이미 격리됨, 수동 완료로".
    - `processing` 이면 멈춤(결제사 취소 진행 중).
    - `pending_review`·`retryable_failed` 이면 새로 만들지 않고 그 요청을 `manual_review`·origin `external_cancel`·last_error_code `MANUAL_TEMPLATE_HOLD` 로 바꿈(바꾸기 전 origin·status·취소/부분취소 표식 값은 작업 기록 details 에).
    - 열린 요청이 없으면 같은 값으로 요청을 만듦.
    - 잠금 순서: 원래 원천 → 주문 → profiles → 재지급분 중 active 를 id 순으로 `pending_refund`, 요청의 `held_reissued_source_ids` 에 기록, 작업 기록 `point_charge_source_hold`.
  - 해제: `supabase/scripts/bundle9_point_charge_release.sql`
    - 먼저 확인: 요청이 `manual_review`·`MANUAL_TEMPLATE_HOLD`, 주문이 refunded 아님, 취소·부분취소 통보 표식이 보류 때 기록한 값과 같음.
    - 보류 전 요청이 회원이 낸 신청(origin `user`)이었으면 **해제하지 말고** 회원에게 연락한 뒤 수동 완료로.
    - 하나라도 어긋나면 멈추고 수동 완료로 보냅니다.
    - 해제하면 요청을 rejected 로 닫고 원래 원천과 `held_reissued_source_ids` 중 `pending_refund` 인 것만 active 로, 작업 기록 `point_charge_source_release`.
- 앞선 부분취소 표식이 있는 결제는 수동 완료를 **부분 모드**로 하고, 쓸 수 있는 몫 합 전체를 회수량으로 입력합니다.

## 1. 경보별 할 일

| 경보 코드 | 뜻 | 할 일 |
|---|---|---|
| `REISSUED_CREDIT_HELD` (warning) | 취소된 결제에서 비롯한 재지급분을 함께 보류함 | 아래 2절 순서대로 수동 완료 |
| `REISSUED_CREDIT_HOLD_FAILED` (critical) | 원래 크레딧은 묶었지만 재지급분을 못 묶음(실패 대체 경로) | **바로** 0절 보류 템플릿으로 재지급분을 묶고, 그 뒤 2절 |
| `REISSUED_CREDIT_SETTLE_REVIEW` (warning) | 재지급분이 있는 결제를 수동 완료함 | 3절 정산 확인 |
| `REISSUED_CREDIT_ALERT_FAILED` (warning) | 위 경보를 남기지 못함 | 주문을 직접 찾아 위 표대로 |

경보 details 에는 `refund_request_id`, `order_id`, `root_source_id`, `reissued_sources`(원천별 처음·남은·상태·만료)가 들어 있습니다.

## 2. 수동 완료
1. `/admin/refunds` 수동 완료 화면을 엽니다. 미리보기에 원래 + 재지급분(사슬 전체) 원천별 원자료, 이 결제의 앞선 수동 완료 기록, 부분취소 금액, 처리 모드(전액/부분), 남은 환불 가능 금액이 나옵니다.
2. 전액 모드(승인취소): 화면이 쓸 수 있는 몫 합을 그대로 보냅니다. 그사이 값이 바뀌면 `MANUAL_REFUND_RECOVERY_INVALID` → 새로고침 후 다시.
3. 부분 모드(부분취소): 회수량은 8절 식과 같은 기준으로 대표가 정합니다(쓸 수 있는 몫 합 이하).
4. 회수는 유효기간이 먼저 끝나는 원천부터 합니다. 만료된 잔량은 0 으로 정리되며 회수량이 아니라 관리 기록(`payment_admin_actions.details.sources[].expired_cleared`)에만 남습니다.
5. 원래 원천은 원래 + 재지급분 남은 합이 0 일 때만 refunded 가 됩니다(남아 있으면 active — 이어서 승인취소가 오면 같은 경로로 다시 보류).
6. 같은 결제의 완료된 환불액 합 + 이번 환불액은 결제 금액을 넘을 수 없습니다.

## 3. 정산 확인(SETTLE_REVIEW)
1. 실제로 쓴 몫 확인. 근거:
   - 원천별 사용 = `credit_consumption`
   - 자료 환불 복구 = `market_refund_requests.allocated_items` 와 재지급 연결
   - 앞선 회수·만료 정리 = `payment_admin_actions.details` — **쓴 몫이 아닙니다**
2. 회원에게 연락해 회수한 양·이미 쓴 몫·정산 방법을 알립니다.
3. 정산 결과를 수동 완료 메모(또는 문의 답변)에 기록합니다.

## 4. 이 경로를 바꾸는 DB 되돌리기 (가) 기간
9번 마이그레이션 되돌리기 (가)를 실행한 뒤 재적용 전까지는 **수동 완료를 하지 않습니다**(새 화면의 부분 모드가 옛 함수에서 재지급분을 빼고 통과할 수 있음).

## 참고: 수동 완료 원장 행의 잔액
수동 완료는 원천마다 회수 행을 하나씩 `credit_transactions` 에 남기며, 여러 행의 `balance_after` 는 모두 **완료 직후 최종 잔액**입니다(행마다 누적 잔액이 아님). 원장을 행 순서로 이어 읽을 때 잔액 흐름이 맞지 않아 보여도 금액은 맞습니다. 원천별 회수량·만료 정리량은 `payment_admin_actions.details.sources[]` 를 기준으로 봅니다.
