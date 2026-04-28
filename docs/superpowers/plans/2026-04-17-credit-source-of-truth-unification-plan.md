# 크레딧 단일 Source of Truth 정리 계획

> **에이전트 작업 지침:** 이 계획은 read-only 분석 결과를 바탕으로 작성한다. 구현 시에는 각 단계마다 `구현 → 검증 → (검증 실패 시 문제 분석 → 재구현)` loop를 적용한다.

## 추천 결론

장기 단일 source of truth는 **`credit_sources.remaining_credits` 합계**로 채택한다.

- `profiles.credits`는 제거 대상 또는 deprecated read model로 취급한다.
- `credit_transactions`는 감사/이력 로그로 유지한다.
- 실제 잔액은 `user_id`별 `active` source의 `remaining_credits` 합계로 계산한다.

### 추천 이유
- FIFO 차감/환불의 실제 상태는 이미 `credit_sources`에 있다.
- 관리자 지급 bug처럼 `profiles.credits`는 별도 동기화 누락 시 쉽게 드리프트가 난다.
- `credit_sources.remaining_credits` 합계는 구매/지급/차감/환불의 실제 잔액 원장에 더 가깝다.

---

## 추천 구조에서 읽기/쓰기 단순화

### 읽기
아래 경로를 모두 같은 기준으로 통일한다.
- `CreditService.getBalance()`
- `/api/credits/balance`
- 헤더 잔액
- 마이페이지 현재 보유 크레딧

**통일 규칙:**
- `SUM(credit_sources.remaining_credits)`
- 조건: `user_id = ? AND status = 'active' AND remaining_credits > 0`

### 쓰기
- **구매 / 관리자 지급**
  - `credit_sources` insert
  - `credit_transactions` insert
- **차감**
  - `consume_credits` RPC가 `credit_sources.remaining_credits`만 감소
- **환불 승인 / 복구**
  - `refund_credits` RPC 또는 환불 승인 로직이 `credit_sources.status / remaining_credits`만 갱신
- **profiles**
  - `credits` 갱신 제거
  - 더 이상 UI/비즈니스 로직에서 읽지 않음

즉:
- 현재: `profiles.credits` + `credit_sources.remaining_credits` 이중 관리
- 목표: **잔액 계산은 `credit_sources` 하나만 사용**, `credit_transactions`는 로그 전용

---

## 점진 전환 단계

### Loop 1 — 읽기 경로 전환
**목표:** 잔액 조회를 전부 `credit_sources` 합계 기반으로 전환

- [ ] `CreditService.getBalance()`를 `credit_sources` 합계 기반으로 교체
- [ ] `/api/credits/balance`를 같은 기준으로 교체
- [ ] 헤더/마이페이지 잔액 읽기를 같은 helper로 통일
- [ ] 검증: 헤더 / 마이페이지 / API 잔액이 서로 일치

### Loop 2 — 쓰기 경로 정리
**목표:** balance write를 `profiles.credits`에서 제거

- [ ] `purchaseCredits()`에서 `profiles.credits` update 제거
- [ ] `grantCreditsAsAdmin()`에서 `profiles.credits` update 제거
- [ ] 환불 승인/차감/복구 경로도 `profiles.credits` update 제거
- [ ] 검증: 구매/관리자 지급/차감/환불 후 잔액이 모두 정상 반영

### Loop 3 — 정합성 검증 및 운영 안전장치
**목표:** 전환 중 불일치 감지와 대응 수단 확보

- [ ] 사용자별 비교 쿼리/점검 스크립트 준비
  - `profiles.credits`
  - `SUM(credit_sources.remaining_credits)`
- [ ] 차이가 나는 케이스 목록화
- [ ] 운영 중에는 `profiles.credits`를 legacy 비교값으로만 사용
- [ ] 검증: drift 케이스가 재발하지 않음

### Loop 4 — Deprecated 처리
**목표:** `profiles.credits`를 완전히 퇴역

- [ ] 읽기 경로에서 `profiles.credits` 참조 제거 완료
- [ ] 쓰기 경로에서 `profiles.credits` 참조 제거 완료
- [ ] 컬럼 제거 또는 legacy/debug 전용으로 유지 결정
- [ ] 검증: repo 전체에서 실사용 참조가 제거됨

---

## 리스크

### 1. 성능
- 헤더처럼 자주 읽는 경로에서 매번 `SUM(...)` 하면 비용이 생길 수 있다.
- 대응:
  - `credit_sources(user_id, status)` 인덱스 확인
  - 필요 시 materialized/cache/read model 도입

### 2. 상태 정의 불일치
- `pending_refund`를 합계에 포함할지 제외할지 정책을 명확히 해야 한다.
- 권장:
  - 현재 FIFO 차감 제외 규칙과 맞춰 `active`만 합산

### 3. 혼용 기간 드리프트
- 전환 중 일부 경로만 `profiles.credits`를 계속 만지면 다시 불일치가 생긴다.
- 대응:
  - Loop 2에서 모든 write path를 한 번에 정리
  - grep/테스트로 잔여 참조 확인

### 4. 운영 데이터 백필
- 기존에 이미 `profiles.credits`와 source 합계가 어긋난 사용자가 있을 수 있다.
- 대응:
  - 전환 전 정합성 리포트 생성
  - 필요 시 source 합계 기준으로 재동기화

---

## 성공 기준
- 잔액 read path가 모두 `credit_sources` 합계 하나로 통일된다.
- 구매/관리자 지급/차감/환불 모두 `profiles.credits`를 더 이상 갱신하지 않는다.
- 헤더 / 마이페이지 / API / 거래 흐름이 일관된 잔액을 보여준다.
- `profiles.credits` 드리프트로 인한 bug class가 제거된다.
