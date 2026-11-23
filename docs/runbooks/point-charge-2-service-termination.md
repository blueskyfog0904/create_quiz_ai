# 런북 2 — 서비스 종료 때 남은 유료 크레딧 환불

- 작성일: 2026-11-23 · 9번 묶음(문구 초안 F2)
- 서비스 상태: **출시 전**. 출시 뒤에 쓸 절차를 미리 적은 문서입니다.
- 읽는 사람: 대표. 근거 조항: 취소·환불정책 8절(환산식), 이용약관 13조.

## 순서

### 1. 종료 공지
- 종료일과 사유를 **30일 전부터** 서비스 화면에 알립니다. 구매 자료를 내려받을 수 있는 기간도 함께 알립니다.
- 공지일부터 충전 판매를 끕니다(관리자 대시보드 '충전 판매 중지' — 이유: 서비스 종료 예정).

### 2. 회원별 남은 유료 크레딧 계산
- **유효기간이 지나지 않은** 원천만 셉니다(종료일 기준).
- 자료 환불로 다시 받은 크레딧(재지급분)은 **원래 충전분으로** 계산합니다 — 재지급 연결(`market_refund_reissued_sources`)을 따라 원래 충전 결제를 찾습니다(사슬이면 끝까지).
- 무상 지급·이벤트 크레딧은 빼고, 충전 결제별로 묶습니다.

### 3. 결제별 환불 금액(8절 식)
환불 금액 = 남은 유료 크레딧 × (그 충전의 결제 금액 − 이미 환불한 금액) ÷ (지급 크레딧(보너스 포함) − 회수한 크레딧), **1원 미만 버림**.

- 이미 환불한 금액 = 그 결제의 **완료된** `refund_requests.refund_amount` 합만(열린 요청은 0으로 봄).
- 회수한 크레딧 = 그 결제의 `payment_admin_actions.recovered_credits` 합(수동 완료로 회수한 양). 만료 정리(`details.sources[].expired_cleared`)는 회수가 아닙니다.
- 계산 근거(원천별 값·식·결과)를 결제별로 기록해 둡니다(5년 보관).

참고 조회(SQL 편집기, 읽기만):
```sql
-- 결제별: 결제 금액, 완료된 환불액 합, 회수 크레딧 합
SELECT o.id, o.order_id, o.user_id, o.expected_amount, o.expected_credits,
       COALESCE((SELECT sum(rr.refund_amount) FROM public.refund_requests rr
                  WHERE rr.payment_order_id = o.id AND rr.status = 'completed'), 0) AS refunded_amount,
       COALESCE((SELECT sum(a.recovered_credits) FROM public.payment_admin_actions a
                  WHERE a.payment_order_id = o.id AND a.action = 'manual_refund_completed'), 0) AS recovered_credits
  FROM public.payment_orders o
 WHERE o.status IN ('completed', 'manual_review');
```

### 4. 환불
- 회원 요청을 받아 원 결제수단으로 취소(부분 취소)하고, 안 되면 회원 본인 명의 계좌로 송금합니다.
- 처리 기록은 결제마다 수동 완료(부분 모드, 회수 크레딧 = 그 결제의 남은 유료 크레딧)로 남깁니다.
- 계좌 정보는 송금 확인 뒤 바로 파기합니다.
