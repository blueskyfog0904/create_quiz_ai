# Credit Balance Backfill Runbook

## 목적
`credit_sources.remaining_credits` 합계를 기준으로 `profiles.credits` 캐시를 동기화할 때,
운영에서 안전하게 실행하고 즉시 검증/롤백하기 위한 절차서입니다.

## 선행 조건
- 정책 확정:
  - `ledger_balance = active + pending_refund`
  - `spendable_balance = active`
- 최신 mismatch 쿼리 준비:
  - `scripts/check-credit-balance-mismatch.sql`
- idempotent backfill SQL 준비:
  - `scripts/backfill-profile-credits-from-ledger.sql`

## 1. 실행 전 스냅샷
아래를 별도 파일로 저장합니다.

### 1-1. profile 잔액 스냅샷
```sql
select id, credits
from profiles
order by id;
```

### 1-2. ledger/spendable 스냅샷
```sql
with source_balance as (
  select
    user_id,
    sum(case when status in ('active', 'pending_refund') then remaining_credits else 0 end) as ledger_balance,
    sum(case when status = 'active' then remaining_credits else 0 end) as spendable_balance
  from credit_sources
  group by user_id
)
select *
from source_balance
order by user_id;
```

### 1-3. 최신 transaction balance 스냅샷
```sql
with latest_tx as (
  select distinct on (user_id)
    user_id,
    balance_after,
    created_at
  from credit_transactions
  order by user_id, created_at desc, id desc
)
select *
from latest_tx
order by user_id;
```

## 2. Dry-run mismatch 확인
먼저 아래 스크립트를 실행합니다.

```sql
-- scripts/check-credit-balance-mismatch.sql
```

### 기대 결과
- mismatch 사용자 목록 파악
- `pending_refund` 정책에 대한 예상 diff 확인

## 3. 샘플 계정 검증
전수 실행 전에 샘플 10~20개 계정으로 아래를 점검합니다.

- 일반 충전 사용자
- 관리자 지급 사용자
- 환불 대기 사용자
- 환불 완료 사용자
- 최근 차감 이력이 있는 사용자

### 샘플 검증 기준
- `profiles.credits`
- ledger 합계
- latest transaction `balance_after`
세 값의 관계가 정책대로 설명 가능해야 함

## 4. Backfill 실행
다음 SQL을 실행합니다.

```sql
-- scripts/backfill-profile-credits-from-ledger.sql
```

이 SQL은
- `active + pending_refund` 합계 기준으로
- `profiles.credits`를 덮어쓰되,
- 값이 실제로 다른 경우에만 update 합니다.

## 5. 실행 직후 검증
즉시 다시 아래를 실행합니다.

```sql
-- scripts/check-credit-balance-mismatch.sql
```

### 통과 조건
- `profiles.credits != latest_tx.balance_after` 사용자 0건
- 정책상 ledger 합계와 불일치 사용자 0건
- source 무결성 오류 0건

## 6. API/UI 검증
실행 직후 아래를 확인합니다.

- `/api/credits/balance`
- 헤더 잔액
- `/mypage/credits` 상단 잔액
- 최근 transaction `balance_after`

### 샘플 시나리오
- 관리자 지급 1건
- 일반 충전 1건
- 환불 승인 1건
- 차감 1건

모든 시나리오에서 DB/API/UI 잔액이 일치해야 합니다.

## 7. Rollback 조건
아래 중 하나라도 발생하면 즉시 rollback 또는 중단합니다.

1. `profiles.credits != latest_tx.balance_after` 사용자 1명 이상
2. 정책상 ledger 합계와 불일치 사용자 1명 이상
3. 관리자 지급/충전/환불/차감 중 어느 한 경로라도 UI/API 잔액이 다름

## 8. Rollback 방법
backfill 전 저장한 스냅샷을 기준으로 `profiles.credits`를 복원합니다.

### 예시 절차
1. 사전 스냅샷 테이블/CSV 준비
2. `profiles`에 대해 id 기준 restore update 실행
3. mismatch query 재실행
4. rollout 중단

## 9. 운영 관찰 gate
backfill 후 최소 24시간 동안 아래를 모니터링합니다.

- 신규 mismatch 0건
- 관리자 지급/충전/환불/차감 후 mismatch 로그 0건
- UI 고객 문의/오류 신고 0건

## 10. 다음 단계
이 runbook이 통과하면 그 다음엔:
- read-path를 ledger 중심으로 더 전환
- `profiles.credits`는 cache/derived field로만 유지
- 장기적으로 direct profile reads 제거
