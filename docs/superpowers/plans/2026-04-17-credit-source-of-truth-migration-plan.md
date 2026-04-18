# 크레딧 Source of Truth 단일화 마이그레이션 계획

> **계획 작성 방식:** 본 계획은 멀티 에이전트(architect / critic / verifier) 분석 결과를 합쳐 만든 합의안이다. 각 단계는 **분석 → 계획 → 검증** loop를 따르며, 검증을 통과하기 전에는 다음 단계로 진행하지 않는다.

## 목표
현재 크레딧 도메인에는 사실상 두 개의 source of truth가 존재한다.

- `profiles.credits`
- `credit_sources.remaining_credits` 합계

이 구조 때문에 관리자 지급처럼 특정 경로에서
- 기록은 남고
- 보이는 잔액은 갱신되지 않는
불일치가 반복될 수 있다.

이 계획의 목표는:
1. **장기 표준 source of truth를 하나로 정한다.**
2. 읽기/쓰기 경로를 그 기준에 맞춰 재설계한다.
3. 기존 데이터와 운영 경로를 안전하게 마이그레이션한다.
4. 롤백 조건과 불일치 탐지 체계를 함께 마련한다.

---

# 멀티 에이전트 합의 결론

## 최종 권장안
장기 표준은 **`credit_sources.remaining_credits` 합계 기반 원장(ledger)** 으로 전환하고,
`profiles.credits`는 **캐시/파생값**으로만 유지하거나 최종적으로 제거 후보로 본다.

### architect 관점 요약
- `credit_sources`는 충전/지급/차감/환불의 **원인과 잔액 변화 이력**을 보존한다.
- `profiles.credits`는 이 원장을 요약한 값이어야지, 별도의 동등한 source of truth가 되어서는 안 된다.
- 장기적으로는 **원장 = truth, profile = cache** 구조가 가장 안전하다.

### critic 관점 요약
- `profiles.credits`를 계속 truth로 두면 경로별 no-op update / partial update가 반복된다.
- 반대로 ledger 합계 기반 전환 시에도 `pending_refund`, `refunded` 상태 정책을 잘못 정의하면 더 큰 불일치를 만들 수 있다.
- 따라서 **정책 정의 → backfill → dual-read 검증 → read-path 전환** 순서가 필수다.

### verifier 관점 요약
- 어떤 크레딧 mutation이 끝난 뒤에도 아래 3개는 항상 같아야 한다.
  1. `profiles.credits`
  2. 최신 `credit_transactions.balance_after`
  3. 정책이 정의된 ledger 합계
- 즉, 마이그레이션의 성공 기준은 DB/API/UI가 같은 숫자를 말하는지로 판단해야 한다.

---

# 왜 ledger를 source of truth로 삼아야 하는가

## 이유 1 — 감사 가능성
`credit_sources`는 각 구매/지급 source별로
- initial_credits
- remaining_credits
- status
- purchased_at
을 보존한다.

즉, 어떤 잔액이 왜 생겼고 왜 줄었는지 재계산과 감사가 가능하다.

반면 `profiles.credits`는 최종 숫자 하나만 담고 있어서,
불일치가 생기면 원인 추적이 어렵다.

## 이유 2 — FIFO 도메인 모델과 일치
현재 차감 로직은 이미 FIFO를 기준으로 `credit_sources`를 소비한다.
즉, 실질적인 잔액 원장은 이미 `credit_sources` 쪽에 더 가깝다.

그런데 UI와 API는 `profiles.credits`를 읽고 있어,
**쓰기 경로의 실제 원장**과 **읽기 경로의 표시 잔액**이 분리되어 있다.

## 이유 3 — no-op update / partial success에 강함
`credit_sources`와 `credit_transactions`는 생성되었는데
`profiles.credits`만 갱신 실패하면 지금 같은 버그가 생긴다.

반대로 ledger를 truth로 두면:
- UI가 ledger 합계를 직접 읽거나
- profile cache를 ledger에서 재생성할 수 있어서
불일치 복구가 쉬워진다.

---

# 핵심 설계 원칙

## 원칙 1 — Source of Truth는 하나
- 장기 truth: `credit_sources.remaining_credits` 합계
- `profiles.credits`는 transitional cache 또는 derived field

## 원칙 2 — 정책 명시 없이는 집계 금지
ledger 합계를 계산할 때 **어떤 status를 포함할지**를 명시적으로 정해야 한다.

특히 `pending_refund`는 현재 차감 대상에서 제외되므로,
다음 둘을 구분해야 한다.

- **보유 잔액 (ledger balance)**
- **사용 가능 잔액 (spendable balance)**

권장 정의:
- `active` → 사용 가능 잔액 포함
- `pending_refund` → 보유 잔액에는 포함 여부를 정책으로 명시, 사용 가능 잔액에는 제외
- `refunded` → 제외

## 원칙 3 — 모든 mutation은 원장 우선
충전/지급/환불/차감은 먼저 ledger를 바꾸고,
그 결과를 기준으로:
- transaction 기록
- profile cache 동기화
- API 응답
을 만든다.

## 원칙 4 — profile cache는 검증 가능한 파생값
`profiles.credits`를 유지하는 동안에는:
- ledger 합계와 일치하는지 항상 검증 가능해야 하고,
- 불일치 시 즉시 탐지/재동기화할 수 있어야 한다.

---

# 권장 구조

## 최종 목표 구조

### 쓰기 경로
1. mutation 수행
   - `credit_sources` 변경
2. `credit_transactions` 기록
   - `balance_after`는 ledger 기반 계산값
3. `profiles.credits` 동기화
   - 캐시/파생값
4. 응답 반환
   - `newBalance`
   - 필요 시 `updatedProfileBalance`

### 읽기 경로
#### 최종 목표
- 헤더 / 마이페이지 / `/api/credits/balance`
  → ledger 합계 기반

#### 전환기 구조
- 기본은 ledger 합계 계산
- profile cache와 비교 검증 로그 남김
- mismatch 시 alert 또는 self-heal 가능하도록 설계

---

# 대안 비교

## 대안 A — `profiles.credits`를 계속 truth로 유지
### 장점
- 현재 코드 영향 범위가 작다.
- UI 변경이 적다.

### 단점
- 지금 문제의 구조 원인을 그대로 유지한다.
- no-op update / partial success / 권한 경로 차이에 계속 취약하다.
- ledger와 profile 사이 불일치가 또 생기면 매번 경로별 패치가 필요하다.

### 판단
장기 표준으로는 부적합.

---

## 대안 B — ledger 합계로 전환 (권장)
### 장점
- 원장과 표시값의 기준이 일치한다.
- 감사 가능성이 높다.
- 불일치 발생 시 원장 기준 재계산이 가능하다.

### 단점
- 집계 성능 고려 필요
- `pending_refund` 정책 정의 필요
- 마이그레이션 설계가 필요

### 판단
범위는 크지만 장기적으로 가장 맞는 방향.

---

# 구현 계획

## Loop 1 — 정책 정의와 현재 불일치 측정

### 종료 조건
1. `ledger_balance` / `spendable_balance` 정의가 문서화된다.
2. `pending_refund` 포함 여부 정책이 정해진다.
3. 현재 불일치 규모를 측정하는 쿼리와 기준이 준비된다.

### Task 1. 정책과 비교 기준 확정
- [ ] `active`, `pending_refund`, `refunded`를 보유/사용 가능 잔액에 어떻게 반영할지 확정
- [ ] `latest credit_transactions.balance_after`와 profile/ledger를 어떤 관계로 검증할지 확정
- [ ] plan 문서에 공식 기준 수치 정의 추가

### Task 2. 현재 불일치 측정 쿼리 준비
- [ ] `profiles.credits` vs ledger 합계 비교 쿼리
- [ ] `profiles.credits` vs latest transaction `balance_after` 비교 쿼리
- [ ] source 무결성 체크 쿼리

### 검증
- 샘플 계정에서 3종 쿼리 결과 확보
- mismatch 유형 분류

---

## Loop 2 — 쓰기 경로를 ledger 우선 구조로 정렬

### 종료 조건
1. 관리자 지급/일반 충전/차감/환불이 모두 ledger 우선 구조로 정렬된다.
2. 각 mutation의 `newBalance`가 ledger 기준 계산으로 통일된다.
3. profile cache는 파생값으로만 갱신된다.

### Task 3. mutation 경로 정리
- [ ] `purchaseCredits`, `grantCreditsAsAdmin`, `consume_credits`, `refund_credits`, 환불 승인/거절 경로를 inventory 작성
- [ ] 각 경로가 현재 무엇을 먼저 쓰는지 정리
- [ ] ledger 우선 → tx 기록 → profile cache 동기화 순서로 재배치 계획 수립

### Task 4. 공통 balance 계산 함수/조회 경로 설계
- [ ] ledger 합계를 계산하는 공통 함수 또는 DB view/RPC 설계
- [ ] `profiles.credits` 업데이트는 그 계산 결과를 따라가도록 정리

### 검증
- 각 mutation 경로별로 DB 3점 비교가 가능해야 함

---

## Loop 3 — 읽기 경로를 ledger 중심으로 점진 전환

### 종료 조건
1. `/api/credits/balance`, 헤더, 마이페이지가 ledger 기준 읽기로 전환된다.
2. profile cache는 transitional verify 용도로만 남는다.
3. UI/API/DB 잔액이 일치한다.

### Task 5. dual-read 단계 도입
- [ ] 먼저 읽기 경로에서 ledger와 profile을 둘 다 읽어 mismatch 로깅
- [ ] mismatch 0건 또는 허용 범위 달성 시 profile direct read 제거
- [ ] 헤더/마이페이지/API `/api/credits/balance`를 ledger 기반으로 전환

### 검증
- 관리자 지급 / 충전 / 환불 / 차감 각각 1회 이상 수행 후
  - DB
  - API
  - UI
  잔액이 일치해야 함

---

## Loop 4 — backfill + rollout + rollback gate

### 종료 조건
1. backfill 전/후 mismatch를 전수 비교한다.
2. rollback 조건이 명확하다.
3. 운영 관찰 구간 동안 신규 mismatch 0건이다.

### Task 6. backfill 계획
- [ ] 원본 스냅샷 확보
- [ ] idempotent backfill 쿼리/스크립트 설계
- [ ] 샘플 계정 검증 후 전수 실행

### Task 7. rollback / acceptance gate
- [ ] rollback 조건 정의
  - `profiles.credits != latest_tx.balance_after`
  - 또는 정책상 ledger 합계와 불일치 사용자 1명이라도 존재 시 stop
- [ ] acceptance gate 정의
  - 관리자 지급/충전/환불/차감 각각 1회 이상 후 DB/API/UI 동일 잔액
- [ ] 운영 gate 정의
  - backfill 후 mismatch query 0건
  - 24시간 신규 mutation 관찰 동안 mismatch 0건

---

# 검증 전략

## DB 레벨 비교
### 1) profile vs ledger
- `profiles.credits`
- `sum(credit_sources.remaining_credits)`
- `pending_refund` 포함/제외 두 기준 분리

### 2) latest tx vs profile
- 최신 `credit_transactions.balance_after`
- `profiles.credits`

### 3) source 무결성
- `remaining_credits < 0`
- `remaining_credits > initial_credits`
- status별 total 검증

## API 레벨 검증
- `GET /api/credits/balance`
- 관리자 지급 API
- 일반 충전 완료 응답
- 환불 승인/차감 결과

모두 DB 최신값과 같아야 한다.

## UI 레벨 검증
- 헤더 잔액
- 마이페이지 상단 잔액
- 거래내역 최신 `balance_after`
- 새로고침/탭 이동 후 동일성

---

# 치명적 실패 시나리오

1. `pending_refund/refunded` 정책을 잘못 적용해 backfill 시 실제 사용 가능 잔액보다 크게/작게 덮어씀
2. 일부 사용자만 `credit_sources` / `credit_transactions` / `profiles`가 서로 다른 값으로 남아 이후 불일치가 재증폭됨
3. 원본 스냅샷 없이 직접 overwrite하거나, idempotency 없는 backfill을 실행해 재시도 시 값이 누적 손상됨

---

# Rollback 조건

다음 중 하나라도 발생하면 즉시 중단/롤백한다.

- 샘플 검증 또는 전수 쿼리에서 `profiles.credits != latest_tx.balance_after`
- 정책상 ledger 합계와 불일치하는 사용자가 1명이라도 발견
- 관리자 지급/충전/환불/차감 중 어느 한 경로라도 UI/API/DB 잔액이 다름

---

# 최종 성공 기준

1. 장기 source of truth를 ledger(`credit_sources.remaining_credits`)로 명시한다.
2. `profiles.credits`는 cache/derived field로만 취급한다.
3. 모든 mutation 후 DB/API/UI가 동일 잔액을 보여준다.
4. backfill 후 mismatch query 결과 0건이다.
5. 신규 mutation 24시간 관찰 동안 mismatch 0건이다.
6. 각 loop는 검증 통과 후에만 종료된다.
