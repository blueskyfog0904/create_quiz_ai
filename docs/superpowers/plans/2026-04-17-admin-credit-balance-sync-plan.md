# 관리자 지급 크레딧 잔액 미반영 개선 계획

> **에이전트 작업 지침:** 이 계획은 체크박스(`- [ ]`) 단위로 실행합니다. 각 단계는 **분석 → 계획 → 검증** loop를 따르며, 검증을 통과하기 전에는 다음 단계로 진행하지 않습니다.

## 목표
관리자가 사용자에게 크레딧을 지급했을 때:
- `구매건/구매내역`에는 관리자 지급 기록이 남지만
- 헤더 크레딧 잔액, 마이페이지 `현재 보유 크레딧`, `/api/credits/balance`
에는 반영되지 않는 불일치를 해소한다.

최종적으로는 **지급 기록과 잔액 표시가 동일한 데이터 원천/동일한 업데이트 경로**를 따르도록 만든다.

---

## 현재 구조 분석

### 1. 기록 생성 경로
관리자 지급 API:
- `src/app/api/admin/users/credits/route.ts`

이 라우트는 최종적으로:
- `CreditService.purchaseCredits(...)`
를 호출한다.

`purchaseCredits()` 내부 동작:
- 파일: `src/lib/credits.ts`
- 순서:
  1. `credit_sources`에 구매/지급 source 생성
  2. `profiles.credits` 증가
  3. `payment_history` 기록
  4. `credit_transactions` 기록

즉, 관리자 지급도 현재는 **일반 충전과 같은 purchaseCredits 경로**를 재사용하고 있다.

---

### 2. 잔액 표시 경로
현재 잔액 표시는 전부 `profiles.credits`를 직접 읽는다.

확인된 경로:
- `src/lib/credits.ts#getBalance()`
- `src/app/api/credits/balance/route.ts`
- `src/app/(dashboard)/mypage/credits/page.tsx`
- `src/components/layout/header.tsx`

즉,
> 잔액 UI는 `credit_sources.remaining_credits` 합계를 보지 않고, 오직 `profiles.credits`만 신뢰한다.

---

### 3. 현재 관찰된 불일치
사용자 제보 기준:
- `credit_sources`에는 관리자 지급 source가 생성됨
- 구매내역/구매건에는 `관리자 지급`으로 보임
- 하지만 상단 헤더와 현재 보유 크레딧은 `0`

이 상황은 거의 확실하게:
> **기록(source/transaction)은 생성됐지만 `profiles.credits` 증가는 실패했거나, 무효 처리됐거나, 누락되었다**
는 뜻이다.

---

## 가장 유력한 root cause

### 원인 A — `purchaseCredits()`가 관리자 지급 시에도 일반 세션 클라이언트(`createClient`)를 사용하고 있어, 대상 사용자 `profiles` 업데이트가 RLS/권한 때문에 no-op 될 가능성
`purchaseCredits()`는 현재:
- `createClient()`로 Supabase 클라이언트를 만든다.

그런데 관리자 지급 시 호출 컨텍스트는:
- 로그인한 **관리자 계정 세션**
- 업데이트 대상은 **다른 사용자(userId)의 profile**

이다.

이때 매우 유력한 문제는:
- `credit_sources` insert는 통과하거나
- 일부 admin 관련 정책으로 다른 테이블은 쓰기가 가능해도
- `profiles` update는 RLS 정책상 실제 row update가 막힐 수 있다는 점이다.

중요한 점:
- Supabase update는 **에러 없이 0 row 업데이트**가 될 수 있다.
- 현재 코드는 `profiles.update(...).eq('id', userId)` 뒤에
  - 실제로 몇 row가 수정됐는지 확인하지 않는다.
  - `select()`도 안 한다.

즉,
> `profileError === null` 이더라도 실제 잔액 갱신은 안 됐을 가능성
이 충분히 있다.

이 가설은 사용자 증상과 매우 잘 맞는다.

---

### 원인 B — 잔액의 source of truth가 `profiles.credits` 하나뿐인데, 관리자 지급 기록은 `credit_sources`와 분리되어 있어 동기화 실패 시 바로 불일치가 발생함
현재 구조는:
- 사용 가능한 잔액: `profiles.credits`
- 구매건/잔여 건별 정보: `credit_sources.remaining_credits`

즉 source of truth가 사실상 두 개다.

문제점:
- 일반 구매/차감/환불 경로에서는 운 좋게 같이 움직일 수 있어도
- 관리자 지급처럼 별도 경로가 들어오면
- 둘 중 하나만 성공해도 UI 불일치가 생긴다.

지금 증상은 바로 이 구조적 취약점이 드러난 사례다.

---

## 검증이 필요한 핵심 질문

1. `purchaseCredits()`에서 관리자 지급 시 `profiles` row update가 실제로 1건 일어나는가?
2. 관리자 지급 후 DB에서
   - `profiles.credits`
   - `sum(credit_sources.remaining_credits where status='active')`
   값이 서로 같은가?
3. 불일치가 관리자 지급에만 있는가, 아니면 다른 경로도 잠재적으로 같은 문제를 가지는가?
4. 관리자 지급/환불/일반 충전 모두에서 잔액 갱신 로직이 같은 수준의 보장을 가지는가?

---

# 권장 개선 방향

## 방향 1 — 관리자 지급/시스템성 크레딧 변경은 `createAdminClient()` 또는 DB RPC로 일원화 (가장 권장)
핵심:
- 관리자 지급은 일반 사용자 세션 기반 `createClient()`가 아니라
- **서비스 롤/관리자 우회 클라이언트** 또는 **트랜잭션형 RPC**로 처리해야 한다.

### 구체 방향
- `src/lib/credits.ts`에 관리자 지급 전용 경로 추가
  - 예: `grantCreditsAsAdmin(...)`
- 내부에서:
  - `createAdminClient()` 사용
  - `credit_sources` insert
  - `profiles.credits` update
  - `credit_transactions` insert
  - 필요 시 `payment_history` insert
- 가능하면 DB 함수(RPC) 하나로 묶어 **원자적 처리**

### 장점
- 관리자 지급 시 대상 사용자 profile 업데이트 권한 문제가 사라짐
- 중간 단계만 성공하는 불일치가 줄어듦

### 단점
- 경로가 하나 더 생김
- 일반 구매와 관리자 지급이 완전히 같은 함수는 아니게 됨

---

## 방향 2 — 잔액 표시를 `profiles.credits`가 아니라 `credit_sources.remaining_credits` 합계 기반으로 전환 (구조적 대안)
핵심:
- 헤더/마이페이지 잔액을
  - `profiles.credits`
  대신
  - `active credit_sources.remaining_credits` 합계
  로 계산한다.

### 장점
- 구매건/잔여 크레딧과 잔액 표시의 source of truth가 일치함
- 관리자 지급/환불/차감 등에서 구조적으로 더 일관적일 수 있음

### 단점
- 현재 코드 전반이 `profiles.credits`에 의존하고 있으므로 영향 범위가 큼
- 차감/환불/마이페이지/API/헤더 모두를 재검토해야 함

### 판단
장기적으로는 더 바람직할 수 있지만,
이번 이슈의 빠른 안정화 목적에는 **범위가 크다.**

---

## 방향 3 — 단기 핫픽스: `purchaseCredits()`에서 profiles update 결과를 강하게 검증하고, 불일치 시 실패 처리
핵심:
- 관리자 지급뿐 아니라 모든 충전 경로에서
- `profiles.update()` 후 실제 업데이트 결과를 확인한다.
- 예: `.select('credits').single()` 또는 영향 row 체크
- 실패하면 source/transaction 생성 후라도 에러를 던지거나, 롤백 가능한 구조로 개선

### 장점
- 빠르게 증상을 드러낼 수 있음
- “조용히 실패하는” 문제를 줄임

### 단점
- 근본 해결은 아님
- admin 권한 문제 자체는 해결하지 못함

### 판단
방향 1과 함께 들어가면 좋다.

---

# 최종 권장안

## 단기/1차 권장
1. **관리자 지급 전용 경로를 분리**한다.
2. 그 경로는 `createAdminClient()` 또는 DB RPC를 사용한다.
3. `profiles.credits` update 결과를 **반드시 검증**한다.
4. 지급 후 `profiles.credits`와 `credit_sources.remaining_credits` 합계가 일치하는지 검증한다.

## 중기/2차 검토
5. 잔액의 source of truth를 장기적으로 `profiles.credits` 하나에 둘지,
   `credit_sources` 합계 기반으로 바꿀지 재평가한다.

---

# 구현 계획

## Loop 1 — 재현 조건과 불일치 지점 고정

### 종료 조건
다음이 모두 만족될 때 종료:
1. 관리자 지급 시 기록은 남는데 잔액이 미반영되는 경로가 코드상 명확히 설명된다.
2. `profiles.credits`와 `credit_sources`가 불일치할 수 있는 지점이 테스트/문서로 고정된다.
3. 검증 쿼리 또는 로그 포인트가 정의된다.

### Task 1. 불일치 재현/관찰 포인트 정의

**파일:**
- 수정: `docs/superpowers/plans/2026-04-17-admin-credit-balance-sync-plan.md`
- 필요 시 신규 테스트

- [ ] **Step 1: 관리자 지급 후 확인할 3개 값 고정**
  - `profiles.credits`
  - `credit_sources.remaining_credits` 합계
  - `credit_transactions.balance_after`
- [ ] **Step 2: 관리자 지급 API가 어떤 클라이언트를 쓰는지 문서화**
- [ ] **Step 3: focused 검증 경로 정의**
  - 관리자 지급 → 헤더/마이페이지/API `/api/credits/balance`

---

## Loop 2 — 관리자 지급 경로를 권한 안전한 경로로 분리

### 종료 조건
다음이 모두 만족될 때 종료:
1. 관리자 지급이 일반 `createClient()` 세션이 아니라 권한 안전한 경로를 사용한다.
2. 대상 사용자 `profiles.credits`가 실제로 갱신된다.
3. 기록과 잔액이 동시에 반영된다.
4. 검증 통과.

### Task 2. 관리자 지급 전용 서비스 경로 추가

**파일 후보:**
- `src/lib/credits.ts`
- `src/app/api/admin/users/credits/route.ts`

- [ ] **Step 1: 관리자 지급 전용 함수 추가**
  - 예: `CreditService.grantCreditsAsAdmin(...)`
- [ ] **Step 2: 내부에서 `createAdminClient()` 또는 RPC 사용**
- [ ] **Step 3: source / profile / transaction 기록을 같은 논리 단위로 처리**
- [ ] **Step 4: `profiles.update()` 실제 성공 여부를 검증**

---

## Loop 3 — 잔액 불일치 방지 가드 추가

### 종료 조건
다음이 모두 만족될 때 종료:
1. `profiles.credits` 갱신 실패가 조용히 지나가지 않는다.
2. 관리자 지급 후 `newBalance`가 실제 DB 값과 일치한다.
3. 검증 통과.

### Task 3. 잔액 갱신 강검증

**파일 후보:**
- `src/lib/credits.ts`

- [ ] **Step 1: `profiles.update()` 후 영향 row/반환값 검증**
- [ ] **Step 2: 필요 시 `select('credits').single()`로 실제 반영값 재확인**
- [ ] **Step 3: 불일치 시 실패 처리/로그 강화**

---

## Loop 4 — 회귀 및 사용자 체감 검증

### 종료 조건
다음이 모두 만족될 때 종료:
1. 관리자 지급 즉시 헤더 잔액에 반영된다.
2. `/mypage/credits` 상단 잔액에 반영된다.
3. 구매내역/거래내역/헤더/API 잔액이 일치한다.
4. 일반 충전/차감/환불 기존 동작이 깨지지 않는다.

### Task 4. 검증 시나리오

- [ ] **시나리오 1: 관리자 지급**
  - 지급 직후
  - 헤더 잔액 반영 확인
  - 마이페이지 잔액 반영 확인
- [ ] **시나리오 2: 관리자 지급 후 구매내역/거래내역 확인**
  - 기록 + 잔액 일치 확인
- [ ] **시나리오 3: 일반 요금제 충전 회귀**
  - 기존 충전 경로 정상인지 확인
- [ ] **시나리오 4: 차감/환불 회귀**
  - FIFO 차감/환불 후 잔액 일치 확인

---

# 검증 전략

## 코드/정적 검증
- 관련 단위 테스트
- `npx eslint ...`
- `npx tsc --noEmit`

## 데이터 검증
관리자 지급 직후 아래를 비교한다.

1. `profiles.credits`
2. `sum(credit_sources.remaining_credits where status='active')`
3. 최근 `credit_transactions.balance_after`

이 세 값이 모두 같아야 한다.

## UI 검증
- 헤더 잔액
- 마이페이지 크레딧 관리 상단 잔액
- 구매내역/거래내역
- `/api/credits/balance`

모두 일치해야 한다.

---

# 리스크와 대응

## 리스크 1 — 기존 충전 경로와 관리자 지급 경로가 달라져 중복 로직이 생길 수 있음
**대응:** 공통 로직은 유지하되, 권한이 필요한 래퍼만 분리

## 리스크 2 — `profiles.credits`와 `credit_sources`의 이중 source of truth 문제가 장기적으로 계속 남음
**대응:** 이번엔 빠른 안정화, 추후 source of truth 재설계 별도 검토

## 리스크 3 — 이미 누락된 사용자 데이터(backfill)가 존재할 수 있음
**대응:** 구현 후 DB 검증 쿼리/백필 계획 추가 검토

---

# 최종 성공 기준

아래가 모두 만족될 때 성공이다.
1. 관리자 지급 후 잔액이 즉시 헤더/마이페이지/API에 반영된다.
2. `credit_sources` 기록과 `profiles.credits`가 불일치하지 않는다.
3. 조용한 무효 업데이트(no-op update)를 막는다.
4. 일반 충전/차감/환불 경로는 회귀 없이 유지된다.
5. 각 loop는 검증 통과 후에만 종료된다.
