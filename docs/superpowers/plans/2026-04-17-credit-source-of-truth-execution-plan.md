# 크레딧 Source of Truth 단일화 실행 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `credit_sources.remaining_credits` 합계를 장기 source of truth로 정하고, `profiles.credits`를 파생 캐시로 낮춘 뒤 DB/API/UI가 같은 잔액을 보여주도록 점진 전환한다.

**Architecture:** 먼저 정책 정의와 불일치 탐지 쿼리를 고정하고, 그 다음 mutation 쓰기 경로를 ledger 우선 구조로 정렬한다. 이후 읽기 경로를 dual-read → ledger-read로 전환하고, 마지막에 backfill 및 운영 gate를 통과시켜 source of truth를 사실상 단일화한다.

**Tech Stack:** Next.js App Router, TypeScript, Supabase Postgres, Supabase RPC/SQL, Node test runner, ESLint

---

## 선행 문서
- 참조 계획: `docs/superpowers/plans/2026-04-17-credit-source-of-truth-migration-plan.md`
- 최근 안정화 참고: `docs/superpowers/plans/2026-04-17-admin-credit-balance-sync-plan.md`

---

## 파일 구조 / 책임 분해

### 이미 존재하는 핵심 파일
- `src/lib/credits.ts`
  - 충전/지급/차감/환불 서비스 로직
- `src/app/api/credits/balance/route.ts`
  - 현재 잔액 API
- `src/components/layout/header.tsx`
  - 헤더 잔액 표시
- `src/app/(dashboard)/mypage/credits/page.tsx`
  - 마이페이지 잔액 표시
- `src/app/api/admin/users/credits/route.ts`
  - 관리자 지급 API
- `src/types/supabase.ts`
  - DB 타입

### 이번 실행에서 추가/수정될 가능성이 높은 파일
- `src/lib/credit-balance.ts` **(신규 추천)**
  - ledger/spendable/profile cache 비교와 집계 helper
- `supabase/migrations/<timestamp>_credit_balance_rpc_or_view.sql` **(신규 추천)**
  - ledger/spendable 집계용 SQL view 또는 RPC
- `tests/credit-balance-source-of-truth.test.mjs` **(신규)**
  - source of truth 규칙 고정
- `tests/credit-balance-read-paths.test.mjs` **(신규)**
  - API/UI가 ledger 기준으로 읽도록 source-level 회귀 확인
- `scripts/check-credit-balance-mismatch.sql` **(신규 추천)**
  - 운영/백필 검증용 불일치 쿼리

---

## Phase 0 — 정책 정의 고정

### Task 1: 잔액 정책 정의 문서화

**Files:**
- Modify: `docs/superpowers/plans/2026-04-17-credit-source-of-truth-migration-plan.md`
- Create: `docs/superpowers/plans/2026-04-17-credit-source-of-truth-execution-plan.md`

- [ ] **Step 1: 정책 표를 plan에 명시**
  - `ledger_balance`
  - `spendable_balance`
  - `profile_cache`
  세 개의 의미를 표로 확정한다.

- [ ] **Step 2: `pending_refund` 처리 규칙 명시**
  - 보유 잔액 포함 여부
  - 사용 가능 잔액 제외 여부
  - 환불 승인 전까지 차감 불가 규칙을 문서에 적는다.

- [ ] **Step 3: 성공 기준을 문서 맨 위에 재정의**
  - DB/API/UI가 어떤 숫자를 같다고 봐야 하는지 서술한다.

- [ ] **Step 4: 검증 기준 확인**

Run: 없음 (문서 작업)
Expected: 문서에 `ledger_balance`, `spendable_balance`, `profile cache` 정의가 명시됨

---

## Phase 1 — 불일치 탐지 쿼리와 helper 준비

### Task 2: ledger 집계 helper 추가

**Files:**
- Create: `src/lib/credit-balance.ts`
- Test: `tests/credit-balance-source-of-truth.test.mjs`

- [ ] **Step 1: failing test 작성**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const balanceSource = readFileSync(
  new URL('../src/lib/credit-balance.ts', import.meta.url),
  'utf8'
)

test('defines ledger and spendable balance helpers', () => {
  assert.match(balanceSource, /export async function getLedgerBalance/)
  assert.match(balanceSource, /export async function getSpendableBalance/)
  assert.match(balanceSource, /status in \('active', 'pending_refund'\)|status === 'active'/)
})
```

- [ ] **Step 2: test 실행해 실패 확인**

Run: `node --test tests/credit-balance-source-of-truth.test.mjs`
Expected: FAIL (helper file/function 없음)

- [ ] **Step 3: 최소 구현 작성**

```ts
import { createClient } from '@/lib/supabase/server'

export async function getLedgerBalance(userId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('credit_sources')
    .select('remaining_credits, status')
    .eq('user_id', userId)

  return (data ?? []).reduce((sum, row) => {
    return row.status === 'refunded' ? sum : sum + (row.remaining_credits ?? 0)
  }, 0)
}

export async function getSpendableBalance(userId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('credit_sources')
    .select('remaining_credits, status')
    .eq('user_id', userId)

  return (data ?? []).reduce((sum, row) => {
    return row.status === 'active' ? sum + (row.remaining_credits ?? 0) : sum
  }, 0)
}
```

- [ ] **Step 4: 테스트 재실행**

Run: `node --test tests/credit-balance-source-of-truth.test.mjs`
Expected: PASS

---

### Task 3: 운영용 mismatch 쿼리 파일 추가

**Files:**
- Create: `scripts/check-credit-balance-mismatch.sql`

- [ ] **Step 1: 프로필 vs ledger 쿼리 추가**
- [ ] **Step 2: latest tx vs profile 쿼리 추가**
- [ ] **Step 3: source 무결성 쿼리 추가**

- [ ] **Step 4: 문서에 실행법 추가**

예시 포함:
```sql
with source_balance as (
  select
    user_id,
    sum(case when status in ('active', 'pending_refund') then remaining_credits else 0 end) as ledger_balance,
    sum(case when status = 'active' then remaining_credits else 0 end) as spendable_balance
  from credit_sources
  group by user_id
)
select ...
```

---

## Phase 2 — 쓰기 경로를 ledger 우선 구조로 정렬

### Task 4: mutation inventory 문서화 및 공통 계산 경로 설계

**Files:**
- Modify: `src/lib/credits.ts`
- Modify: `docs/superpowers/plans/2026-04-17-credit-source-of-truth-migration-plan.md`

- [ ] **Step 1: 현재 mutation 함수 목록 작성**
  - `purchaseCredits`
  - `grantCreditsAsAdmin`
  - `deductCredits`
  - `refundCredits`
  - `approveRefund`
  - `rejectRefund`

- [ ] **Step 2: 각 함수에서 무엇이 먼저 쓰이는지 주석/문서로 표시**
- [ ] **Step 3: 공통 balance 계산 호출 지점 후보를 정한다**
  - `ledgerBalance`
  - `spendableBalance`
  - `profile cache sync`

- [ ] **Step 4: source-level test 추가**

```js
test('credit service centralizes ledger balance calculation', () => {
  assert.match(creditsSource, /getLedgerBalance/)
  assert.match(creditsSource, /getSpendableBalance/)
})
```

---

### Task 5: 관리자 지급/구매/환불/차감 응답에 검증 가능한 balance 반환 규칙 추가

**Files:**
- Modify: `src/lib/credits.ts`
- Modify: `src/app/api/admin/users/credits/route.ts`
- Modify: purchase/consume/refund 관련 API route들 (`src/app/api/...`)
- Test: `tests/credit-balance-read-paths.test.mjs`

- [ ] **Step 1: failing test 작성**

```js
test('credit mutation paths return verifiable balance fields', () => {
  assert.match(creditsSource, /newBalance/)
  assert.match(adminGrantRouteSource, /newBalance: result.newBalance/)
})
```

- [ ] **Step 2: test 실행해 현재 baseline 확인**
- [ ] **Step 3: 각 mutation 응답에 최소 `newBalance` + 필요시 verification field 포함**
- [ ] **Step 4: 관련 source-level test 재실행**

---

## Phase 3 — 읽기 경로를 dual-read로 전환

### Task 6: `/api/credits/balance`를 dual-read 구조로 전환

**Files:**
- Modify: `src/app/api/credits/balance/route.ts`
- Modify: `src/lib/credit-balance.ts`
- Test: `tests/credit-balance-read-paths.test.mjs`

- [ ] **Step 1: failing test 작성**

```js
test('credits balance API reads ledger and profile during transition', () => {
  assert.match(balanceRouteSource, /getLedgerBalance/)
  assert.match(balanceRouteSource, /getSpendableBalance/)
  assert.match(balanceRouteSource, /profile.*credits|profiles.*credits/s)
})
```

- [ ] **Step 2: test 실행해 실패 확인**
- [ ] **Step 3: route에서 ledger + spendable + profile cache를 함께 읽고 mismatch logging 추가**
- [ ] **Step 4: test 재실행**

### Task 7: 헤더/마이페이지를 dual-read or API-based read로 전환

**Files:**
- Modify: `src/components/layout/header.tsx`
- Modify: `src/app/(dashboard)/mypage/credits/page.tsx`
- Modify: 필요 시 `src/lib/credit-balance.ts`
- Test: `tests/credit-balance-read-paths.test.mjs`

- [ ] **Step 1: failing test 작성**

```js
test('header and mypage credits page no longer rely only on profiles.credits', () => {
  assert.match(headerSource, /getLedgerBalance|ledger/i)
  assert.match(mypageCreditsSource, /getLedgerBalance|ledger/i)
})
```

- [ ] **Step 2: 현재 의존 확인 후 실패 검증**
- [ ] **Step 3: 읽기 경로를 ledger 기반 또는 balance API 기반으로 변경**
- [ ] **Step 4: 테스트 재실행**

---

## Phase 4 — backfill 준비

### Task 8: backfill 스냅샷/검증 절차 문서화

**Files:**
- Modify: `docs/superpowers/plans/2026-04-17-credit-source-of-truth-migration-plan.md`
- Modify/Create: `scripts/check-credit-balance-mismatch.sql`

- [ ] **Step 1: backfill 전 snapshot 수집 절차 작성**
  - profiles dump
  - source aggregate dump
  - latest tx dump
- [ ] **Step 2: idempotent backfill 원칙 작성**
- [ ] **Step 3: rollback 조건 문서화**
  - mismatch 1건이라도 발생하면 중단

---

### Task 9: acceptance gate 문서화

**Files:**
- Modify: `docs/superpowers/plans/2026-04-17-credit-source-of-truth-migration-plan.md`
- Modify: `docs/superpowers/plans/2026-04-17-credit-source-of-truth-execution-plan.md`

- [ ] **Step 1: 관리자 지급 acceptance gate 작성**
- [ ] **Step 2: 일반 충전 acceptance gate 작성**
- [ ] **Step 3: 환불/차감 acceptance gate 작성**
- [ ] **Step 4: 운영 24시간 mismatch 0건 gate 작성**

---

## Phase 5 — 최종 전환 단계(나중 실행)

### Task 10: `profiles.credits`를 transitional cache로 격하

**Files:**
- Modify: `src/lib/credits.ts`
- Modify: `src/components/layout/header.tsx`
- Modify: `src/app/(dashboard)/mypage/credits/page.tsx`
- Modify: `src/app/api/credits/balance/route.ts`
- Possibly create migration/docs notes

- [ ] **Step 1: 모든 read-path가 ledger 중심인지 다시 확인**
- [ ] **Step 2: profile cache는 sync/monitoring 용도로만 남기기**
- [ ] **Step 3: 필요 시 제거 후보 문서화**

---

## 공통 검증 명령

- [ ] **Step A: source-of-truth 관련 테스트 실행**

Run:
```bash
node --test \
  tests/credit-source-category.test.mjs \
  tests/credit-source-display.test.mjs \
  tests/credit-transaction-display.test.mjs \
  tests/credit-balance-source-of-truth.test.mjs \
  tests/credit-balance-read-paths.test.mjs
```
Expected: PASS

- [ ] **Step B: lint 실행**

Run:
```bash
npx eslint \
  src/lib/credits.ts \
  src/lib/credit-balance.ts \
  src/app/api/credits/balance/route.ts \
  src/app/api/admin/users/credits/route.ts \
  src/components/layout/header.tsx \
  src/app/(dashboard)/mypage/credits/page.tsx \
  tests/credit-source-category.test.mjs \
  tests/credit-balance-source-of-truth.test.mjs \
  tests/credit-balance-read-paths.test.mjs
```
Expected: PASS

- [ ] **Step C: typecheck 실행**

Run:
```bash
npx tsc --noEmit
```
Expected: PASS

- [ ] **Step D: SQL mismatch 검증 실행**

Run:
```bash
# Supabase SQL editor or psql에서 scripts/check-credit-balance-mismatch.sql 실행
```
Expected: mismatch 0건 또는 허용 범위 내

---

## 실행 순서 권장
1. Task 1~3: 정책/집계 helper/검증 쿼리 준비
2. Task 4~5: 쓰기 경로 표준화
3. Task 6~7: 읽기 경로 dual-read 전환
4. Task 8~9: backfill/rollback/acceptance gate 확정
5. Task 10: 완전 전환(나중 단계)

---

## 지금 당장 구현을 시작할 때의 첫 묶음
가장 먼저 실행할 묶음은 아래입니다.

- Task 2: `src/lib/credit-balance.ts` 추가
- Task 3: `scripts/check-credit-balance-mismatch.sql` 추가
- Task 6: `/api/credits/balance` dual-read 전환

이 세 개를 먼저 하면,
- 읽기 기준
- 검증 기준
- 운영 관찰 기준
이 생겨서 이후 mutation 경로 정리가 훨씬 안전해집니다.
