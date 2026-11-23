# 런북 4 — 고객센터로 접수된 충전 철회 · 충전 정책 설정 장애

- 작성일: 2026-11-23 · 9번 묶음(문구 초안 F4)
- 서비스 상태: **출시 전**. 출시 뒤에 쓸 절차를 미리 적은 문서입니다.
- 읽는 사람: 대표·CS 담당. 근거: 취소·환불정책 3절①·5절, 전자상거래법 17·18조.
- 보류·해제 템플릿은 [런북 3의 0절](point-charge-3-reissued-credit-cancellation.md#0-공통-사용-보류-수단).

## 1. 기간 셈법(사이트와 같음)
- 마감 = **결제일(한국 날짜) 다음 날부터 {충전환불기간}일째 되는 날 24시**. 지금 일수는 DB `system_settings.point_charge_policy.refundDays`(약관 문장도 같은 값).
- 크레딧 지급이 결제보다 늦었으면 지급일이 기준(`GREATEST(결제 승인 시각, 크레딧 지급 시각)`).
- 회원이 결제 때 동의한 일수가 지금 설정보다 길면 동의한 일수로 봅니다.
- 손으로 확인할 때(SQL 편집기, 읽기만):
```sql
SELECT o.order_id, o.approved_at, c.created_at AS supplied_at,
       public.point_charge_refund_deadline(GREATEST(o.approved_at, c.created_at), public.point_charge_refund_days()) AS deadline,
       c.initial_credits, c.remaining_credits, c.status
  FROM public.payment_orders o JOIN public.credit_sources c ON c.id = o.source_id
 WHERE o.order_id = '<주문번호>';
```

## 2. 고객센터로 받은 철회(크레딧 화면 대신)
대상: 크레딧 화면에서 신청하지 못하고 1:1 문의·이메일·전화로 알린 경우. 아래 3절(마지막 날이 토·일·공휴일)도 이 순서로 처리합니다.

1. **접수 시각 증빙**을 남깁니다(문의 작성 시각·메일 수신 시각·통화 시각). 이 시각을 신청 시각으로 봅니다.
2. 그 시각 기준으로 기간·미사용(이 충전 건의 크레딧을 하나도 안 씀)을 확인합니다(1절 조회).
3. 맞으면 **바로 페이앱 콘솔 전취소** → 취소 통보로 격리 → 격리 결과로 접수 뒤 사용 여부 확인 → 수동 완료 전액.
4. 회원 안내: 신청일부터 3영업일 안에 원 결제수단 취소 요청, 카드사 반영 2~5영업일.
5. **휴대폰 결제가 결제한 달을 넘겨 PG 취소가 안 되면**: 보류 템플릿(요청 생성 포함) → 본인 명의 계좌 받기 → **계좌를 받은 날부터 3영업일 안에 송금**(늦으면 지연배상 계산 — 정책 5절) → 수동 완료(bank_transfer) → 계좌 정보 파기.

## 3. 마지막 날이 토·일·공휴일인 경우(민법 161조) — 수동 처리
- 사이트 판정은 날짜만 셉니다(주말·공휴일 연장 없음). 그래서 마감일이 토·일·공휴일이고 **다음 평일**에 들어온 신청은 크레딧 화면에서 '기간 지남'으로 막힙니다.
- **변호사 확인 전까지 이 신청은 기간 안으로 봅니다.** 회원이 고객센터로 알리면 2절 순서대로 처리하고, 수동 완료 메모에 '민법 161조 — 마감일 <날짜>(토/일/공휴일), 다음 평일 <날짜> 접수'를 적습니다.
- 크레딧 화면 거절 문구를 본 회원이 문의하면 같은 기준으로 안내합니다.
- 자동화(판정에 공휴일 반영) 여부는 대표 결정 사항입니다(변호사 확인 목록).

## 4. 충전 정책 설정 장애 — 경보 `POINT_CHARGE_POLICY_UNAVAILABLE` (critical)
뜻: `point_charge_policy` 설정을 읽지 못했거나 형식이 깨졌습니다.
- 결제 화면은 결제 버튼을 막습니다(결제 전 확인 문구 없이 결제하지 않음).
- 환불 판정은 **법정 7일(또는 그 결제에 동의한 일수)로 대체**해 계속 돌고, 판정마다 이 경보가 주문별로 쌓입니다(details: `payment_order_id`·`user_id`·`source_id`·`attempted_at`, 결제 화면은 `screen: checkout`).

할 일:
1. 설정 복구: 관리자 요금제 화면의 '결제 전 확인 문구'를 열어 빈 칸·중괄호 오류를 고쳐 저장합니다. 화면이 열리지 않으면 SQL 편집기에서 현재 값을 확인합니다(`SELECT value FROM public.system_settings WHERE key = 'point_charge_policy'`) — **refundDays 는 낮추지 않습니다**(약관 문장과 같은 값, 365 이하).
2. 장애 기간 확인: 경보의 첫 `created_at`·마지막 `attempted_at`.
```sql
SELECT created_at, details->>'payment_order_id' AS payment_order_id, details->>'user_id' AS user_id,
       details->>'attempted_at' AS attempted_at, details->>'screen' AS screen
  FROM public.payment_reconciliation_alerts
 WHERE code = 'POINT_CHARGE_POLICY_UNAVAILABLE'
 ORDER BY created_at;
```
3. **경보가 있는 기간에 '기간 지남(PERIOD_EXPIRED)'으로 막힌 신청은 현재 약관 일수로 다시 판단합니다.** 대체 판정(7일)이 약관 일수보다 짧았을 수 있기 때문입니다.
   - **경보 시각(`attempted_at`)을 신청 시각으로 봅니다** — 회원이 화면을 처음 연 시각일 수 있지만, 회원에게 유리하게 그 시각을 신청 시각으로 봅니다.
   - 그 시각 기준으로 기간 안·미사용이면 회원에게 연락해 2절 순서로 환불합니다.
4. 대체 판정으로 **허용되어 들어온 신청**은 평소처럼 처리합니다(법정 기간 이상이라 회원에게 불리하지 않음).
5. 복구 뒤 경보를 해소 처리합니다.

## 5. DB 적용 ~ 코드 배포 사이 결제(출시 전 예외)
9번 마이그레이션을 적용한 뒤 새 코드가 배포되기 전까지 들어온 충전 결제에는 **결제 전 확인 동의 기록(`point_charge_checkout_acks`)이 없습니다**(옛 결제 화면으로 결제). 출시 전이고 판매가 꺼져 있어 보통 0건입니다.
- 이 결제의 환불 판정은 지금 설정 일수(동의 일수 없음)로 합니다 — 옛 화면 안내('구매 후 7일 이내')보다 넓거나 같아 회원에게 불리하지 않습니다.
- 결제 내역 화면은 이 결제에 '이 결제는 결제 전 확인 기록 이전 결제입니다 — 기준은 취소·환불정책'으로 표시합니다(지금 문구를 동의 문구로 보여 주지 않음).
- 확인 조회(적용 시각·배포 시각을 넣어서):
```sql
SELECT o.order_id, o.user_id, o.approved_at, o.status
  FROM public.payment_orders o
  LEFT JOIN public.checkout_attempts ca ON ca.id = o.checkout_attempt_id
  LEFT JOIN public.point_charge_checkout_acks a
         ON a.user_id = ca.user_id AND a.checkout_attempt_id = ca.checkout_attempt_id
 WHERE o.approved_at >= '<마이그레이션 적용 시각>' AND o.approved_at < '<배포 완료 시각>'
   AND a.id IS NULL;
```
- 건이 있으면 주문번호를 이 문서 아래 '기록'에 적어 두고, 대표·시험 결제인지 확인합니다.

### 기록
- (없음)
