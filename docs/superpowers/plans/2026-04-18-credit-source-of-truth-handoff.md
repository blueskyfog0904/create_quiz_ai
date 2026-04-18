# 크레딧 Source of Truth 작업 중단/재개용 핸드오프 문서

## 목적
이 문서는 현재 세션에서 진행한 **크레딧 source of truth 정리 작업**의 상태를 기록하고,
다음 세션에서 **Supabase MCP 인증 완료 후 바로 이어서** 작업할 수 있도록 만드는 핸드오프입니다.

---

## 1. 현재 상태 요약

### 현재까지 완료된 것
이번 세션에서 **코드/테스트/SQL/runbook 기준**으로는 다음이 완료되었습니다.

#### A. 읽기 경로 정리
다음 읽기 경로가 `profiles.credits` 직접 조회에서 벗어나,
`CreditBalanceSnapshot` 기반 **dual-read** 구조로 바뀌었습니다.

- `src/app/api/credits/balance/route.ts`
- `src/components/layout/header.tsx`
- `src/app/(dashboard)/mypage/credits/page.tsx`

현재 읽기 규칙:
- `profileBalance`
- `ledgerBalance`
- `spendableBalance`
- `latestTransactionBalance`
- `hasMismatch`
- `mismatchReasons`
를 동시에 계산
- 표시값은 아직 과도기라서 **기본적으로 profile cache 기반**
- 단, `selectDisplayBalance()`를 통해 **feature flag + cohort + mismatch 없음** 조건일 때만 ledger 표시로 전환 가능

#### B. 공통 balance helper 추가
새 파일:
- `src/lib/credit-balance.ts`

핵심 helper:
- `getLedgerBalance(userId)`
- `getSpendableBalance(userId)`
- `getLatestTransactionBalance(userId)`
- `getCreditBalanceSnapshot(userId)`
- `buildCreditBalanceResponseFields(snapshot, displayBalance?)`
- `selectDisplayBalance(userId, snapshot)`
- `logCreditBalanceMismatch(...)`
- `reportCreditBalanceMismatch(...)`
- `syncProfileBalanceCacheFromLedger(userId, client)`

정책:
- `ledgerBalance = active + pending_refund`
- `spendableBalance = active`
- `displayBalance = profile cache` (과도기 기본)

#### C. 주요 쓰기 경로 정리
다음 쓰기 경로는 **snapshot-backed response**와 **post-write snapshot 검증**이 들어간 상태입니다.

- `src/app/api/admin/users/credits/route.ts`
- `src/app/api/credits/purchase/route.ts`
- `src/app/api/credits/deduct/route.ts`
- `src/app/api/payments/confirm/route.ts`
- `src/app/api/market/items/[itemId]/purchase/route.ts`
- `src/app/api/market/purchases/batch/route.ts`
- `src/app/api/questions/generate/route.ts`
- `src/app/api/questions/save-from-community/route.ts`
- `src/app/api/generate/listboard-jobs/[jobId]/run/route.ts`
- `src/app/api/generate/listboard-jobs/[jobId]/retry/route.ts`

#### D. `CreditService` 내부 정리
다음 경로는 `finalizeCreditBalanceMutation(...)` 또는 동등한 ledger-sync + snapshot verify 패턴으로 정리됐습니다.

- `purchaseCredits`
- `grantCreditsAsAdmin`
- `deductCredits`
- `refundCredits`
- `approveRefund`

또한 mismatch는 이제 **throw하지 않고**, 운영상 partial success를 숨기지 않도록
- structured helper (`reportCreditBalanceMismatch`)를 통해
- 관리자 알림 테이블(`notifications`)에 적재하는 방향으로 바뀌었습니다.

#### E. backfill / mismatch 검증 준비물 추가
새 파일:
- `scripts/check-credit-balance-mismatch.sql`
- `scripts/backfill-profile-credits-from-ledger.sql`
- `docs/superpowers/runbooks/credit-balance-backfill.md`

이 문서/스크립트로:
- mismatch 사전 확인
- backfill 실행
- rollback 조건
- 운영 관찰 gate
를 수행할 수 있게 준비했습니다.

---

## 2. 아직 완료되지 않은 것

### 아직 안 한 것
1. **Supabase MCP를 통해 실제 DB 구조/권한/함수/정책 확인**
2. **실제 DB에 대해 mismatch query 실행**
3. **실제 backfill 실행 여부 판단 및 dry-run/샘플 검증**
4. `payments/confirm`과 `market/purchases/batch`를 더 깊게 **공통 ledger-first write helper**로 통합
5. `profiles.credits`를 완전히 cache로만 격하하는 마지막 단계
6. `selectDisplayBalance()`의 ledger 표시 cohort rollout 실제 적용 여부 검증

즉,
- **코드/테스트/준비물은 많이 진행됨**
- 하지만 **실제 DB 검증과 migration 실행은 아직 전혀 안 함**

---

## 3. 현재 가장 큰 blocker

### Supabase MCP 인증 안 됨
현재 세션에서 Supabase MCP 호출 결과:
- `supabase/list_projects` → `Auth required`

즉 상태는:
- MCP는 “설정 흔적은 있음”
- 하지만 **현재 세션에서는 인증이 안 되어 실제 DB 접근 불가**

그래서 이번 세션에서는:
- DB introspection
- 실제 SQL 적용
- 실제 데이터 검증
을 못 했습니다.

---

## 4. 다음 세션 시작 즉시 해야 할 것

### Step 1. Supabase MCP 인증 확인
다음 세션에서 제일 먼저 확인할 것:
- `supabase/list_projects`
- 필요 시 project id 확인
- target project 선택

### Step 2. 현재 DB 구조/권한 확인
확인 대상:
1. `profiles.credits`가 여전히 주요 truth처럼 사용되는지
2. `credit_sources` / `credit_transactions` / `payment_history` 스키마 상태
3. `consume_credits`, `refund_credits` RPC 정의
4. RLS 정책 / service role 우회가 필요한 지점
5. `notifications` insert 정책

### Step 3. mismatch query 실행
아래 SQL 실행:
- `scripts/check-credit-balance-mismatch.sql`

확인 포인트:
- `profiles.credits`
- ledger 합계
- latest tx balance_after
- source 무결성

### Step 4. backfill dry-run 판단
- mismatch 규모 파악
- 샘플 사용자 검증
- `pending_refund` 정책이 현재 데이터와 맞는지 확인

### Step 5. 다음 구현 우선순위 결정
DB 확인 후 아래 중 선택:
1. **DB/RPC/권한 정리 우선**
2. **backfill 준비/샘플 실행 우선**
3. **공통 ledger-first write helper 통합 우선**

---

## 5. 현재 테스트/검증 상태

### 마지막 통과한 검증 명령
```bash
node --test \
  tests/credit-balance-source-of-truth.test.mjs \
  tests/credit-balance-read-paths.test.mjs \
  tests/credit-mutation-routes.test.mjs \
  tests/credit-mutation-snapshot-contract.test.mjs \
  tests/credit-source-category.test.mjs \
  tests/credit-source-display.test.mjs \
  tests/credit-transaction-display.test.mjs
```

```bash
noglob npx eslint \
  src/lib/credit-balance.ts \
  src/lib/credits.ts \
  src/app/api/credits/balance/route.ts \
  src/app/api/credits/purchase/route.ts \
  src/app/api/credits/deduct/route.ts \
  src/app/api/admin/users/credits/route.ts \
  src/app/api/payments/confirm/route.ts \
  src/app/api/market/items/[itemId]/purchase/route.ts \
  src/app/api/market/purchases/batch/route.ts \
  src/app/api/questions/generate/route.ts \
  src/app/api/questions/save-from-community/route.ts \
  src/app/api/generate/listboard-jobs/[jobId]/run/route.ts \
  src/app/api/generate/listboard-jobs/[jobId]/retry/route.ts \
  src/components/layout/header.tsx \
  src/app/(dashboard)/mypage/credits/page.tsx \
  tests/credit-balance-source-of-truth.test.mjs \
  tests/credit-balance-read-paths.test.mjs \
  tests/credit-mutation-routes.test.mjs \
  tests/credit-mutation-snapshot-contract.test.mjs \
  tests/credit-source-category.test.mjs \
  tests/credit-source-display.test.mjs \
  tests/credit-transaction-display.test.mjs
```

```bash
npx tsc --noEmit
```

### 결과
- 테스트: PASS
- lint: PASS
- typecheck: PASS

주의:
- 이건 **코드/정적 검증만 통과한 상태**입니다.
- 실제 DB와 데이터에 대해선 아직 검증 못 했습니다.

---

## 6. 현재 작업 파일 범위 (크레딧 source-of-truth 관련)

### 핵심 수정 파일
- `src/lib/credit-balance.ts`
- `src/lib/credits.ts`
- `src/app/api/credits/balance/route.ts`
- `src/app/api/credits/purchase/route.ts`
- `src/app/api/credits/deduct/route.ts`
- `src/app/api/admin/users/credits/route.ts`
- `src/app/api/payments/confirm/route.ts`
- `src/app/api/market/items/[itemId]/purchase/route.ts`
- `src/app/api/market/purchases/batch/route.ts`
- `src/app/api/questions/generate/route.ts`
- `src/app/api/questions/save-from-community/route.ts`
- `src/app/api/generate/listboard-jobs/[jobId]/run/route.ts`
- `src/app/api/generate/listboard-jobs/[jobId]/retry/route.ts`
- `src/components/layout/header.tsx`
- `src/app/(dashboard)/mypage/credits/page.tsx`

### 테스트/운영 파일
- `tests/credit-balance-source-of-truth.test.mjs`
- `tests/credit-balance-read-paths.test.mjs`
- `tests/credit-mutation-routes.test.mjs`
- `tests/credit-mutation-snapshot-contract.test.mjs`
- `scripts/check-credit-balance-mismatch.sql`
- `scripts/backfill-profile-credits-from-ledger.sql`
- `docs/superpowers/runbooks/credit-balance-backfill.md`
- `docs/superpowers/plans/2026-04-17-credit-source-of-truth-migration-plan.md`
- `docs/superpowers/plans/2026-04-17-credit-source-of-truth-execution-plan.md`

---

## 7. 다음 세션에서 바로 쓸 수 있는 시작 프롬프트

다음 세션에서 아래처럼 시작하면 바로 이어가기 쉽습니다.

### 추천 재시작 프롬프트
> Supabase MCP 인증 완료했어. `docs/superpowers/plans/2026-04-18-credit-source-of-truth-handoff.md` 기준으로 이어서 진행해줘. 먼저 MCP로 DB 구조/RPC/RLS/데이터 불일치부터 확인하고, 그 결과를 기준으로 다음 slice를 진행해줘.

---

## 8. 주의사항

- 현재 repo에는 **크레딧 작업 외 다른 변경도 섞여 있음**
  - PDF 관련 변경
  - 문서 추가
  - 기타 파일들
- 다음 세션에서는 **크레딧 source-of-truth 범위만 분리해서 보고 작업**하는 것이 안전함
- 실제 backfill 실행은 반드시:
  1. MCP 인증
  2. DB 확인
  3. 샘플 검증
  4. rollback 조건 재확인
  후 진행해야 함

---

## 9. 한 줄 결론

현재는 **코드/계약/검증 준비는 꽤 많이 끝났고**,  
다음 세션에서 **Supabase MCP 인증 후 실제 DB 구조와 데이터 상태를 확인하는 것**이 가장 중요합니다.  
그 확인이 끝나야 실제 source-of-truth 전환의 다음 단계(backfill / rollout / 최종 cache 격하)를 안전하게 진행할 수 있습니다.
