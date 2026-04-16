# OCR 503 대응 안정화 구현 계획

> **에이전트 작업 지침:** 이 계획은 체크박스(`- [ ]`) 단위로 실행합니다. 구현은 가능하면 작은 단위로 나누고, 각 loop의 검증을 통과했을 때만 다음 단계로 진행합니다.

**목표:** Gemini OCR 호출 중 503/과부하(high demand) 오류가 발생해도 사용자 요청이 즉시 실패하지 않도록, 재시도/백오프/오류 메시지/관측성을 강화합니다.

**아키텍처:** 우선 현재의 동기식 OCR 경로를 유지한 채, Gemini의 429/500/503 같은 일시 장애를 공통 retry helper로 감싸고, 서버 로그와 사용자 메시지를 분리합니다. 이후 검증 결과가 충분하지 않을 때만 비동기 OCR job 또는 모델 fallback을 2차 단계로 확장합니다.

**기술 스택:** Next.js App Router, TypeScript, Gemini API SDK, Supabase server action, Node test runner, ESLint

---

## 문제 요약

현재 `src/app/api/ocr/actions.ts` 흐름은 다음과 같습니다.
1. 파일 업로드
2. Google 파일 처리 완료 대기
3. `model.generateContent(...)` 호출
4. 이 시점에 Gemini가 `503 Service Unavailable` 또는 high demand를 반환하면 즉시 실패

즉, 현재는 OCR 안정성이 “그 순간 Gemini shared capacity가 비어 있느냐”에 강하게 의존합니다.

---

## 구현 전략

다음 **3개 loop**로 나눠 진행합니다.
각 loop는 **분석 → 계획 → 구현 → 검증** 순서로 반복하며, 검증 통과 전에는 종료하지 않습니다.

- **Loop 1 (필수):** 재시도/백오프 + 사용자 메시지 정리
- **Loop 2 (권장):** 관측성(로그/메트릭) + UX 회복력 강화
- **Loop 3 (조건부):** OCR job 비동기화 또는 fallback 모델 도입

---

## 파일 범위

### 생성
- `src/lib/ocr/gemini-retry.ts` — Gemini 일시 장애용 retry/backoff helper
- `tests/gemini-retry.test.mjs` — retry 분류/지연 로직 테스트
- `tests/ocr-actions-retry.test.mjs` — OCR action이 retry helper를 쓰는지 확인하는 회귀 테스트

### 수정
- `src/app/api/ocr/actions.ts` — Gemini 호출을 retry helper로 감싸고 오류 메시지 정리
- `src/components/features/passages/ocr-preview-stage.tsx` — transient 오류 안내 메시지 보강(필요 시)
- `docs/superpowers/plans/2026-04-16-ocr-503-resilience-plan.md` — 체크 항목 업데이트용

### 조건부 확장 (Loop 3)
- `supabase/migrations/<timestamp>_create_ocr_jobs.sql`
- `src/app/api/ocr/jobs/...`
- `src/lib/ocr/job-runner.ts`
- OCR 상태 polling UI 파일들

---

# Loop 1 — 현재 OCR 경로의 일시 장애 대응 강화

## 종료 조건
다음이 모두 참일 때만 Loop 1을 종료합니다.
1. Gemini 429/500/503은 자동 재시도된다.
2. 비일시 오류는 즉시 실패한다.
3. 테스트, lint, typecheck가 모두 통과한다.
4. 수동/주입 테스트에서 “첫 시도 실패 후 재시도 성공”이 확인된다.

---

### Task 1. 재시도 가능 오류를 분류하는 helper 추가

**파일:**
- 생성: `src/lib/ocr/gemini-retry.ts`
- 테스트: `tests/gemini-retry.test.mjs`

- [ ] **Step 1: status code 추출 helper 추가**

```ts
export function getErrorStatusCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as { status?: unknown }
  return typeof candidate.status === 'number' ? candidate.status : null
}
```

- [ ] **Step 2: retry 가능 오류 분류 helper 추가**

```ts
export function isRetryableGeminiError(error: unknown): boolean {
  const status = getErrorStatusCode(error)
  return status === 429 || status === 500 || status === 503
}
```

- [ ] **Step 3: exponential backoff + jitter helper 추가**

```ts
export function getBackoffDelayMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, 8000)
  const jitter = Math.floor(Math.random() * 250)
  return base + jitter
}
```

- [ ] **Step 4: helper 단위 테스트 작성**

검증 포인트:
- 503은 retry 대상
- 400은 retry 대상 아님
- backoff는 증가하되 상한이 있음

- [ ] **Step 5: helper 테스트 실행**

Run: `node --test tests/gemini-retry.test.mjs`

Expected: PASS

---

### Task 2. OCR action에 공통 retry wrapper 적용

**파일:**
- 수정: `src/lib/ocr/gemini-retry.ts`
- 수정: `src/app/api/ocr/actions.ts`
- 테스트: `tests/ocr-actions-retry.test.mjs`

- [ ] **Step 1: `withGeminiRetry` helper 구현**

```ts
export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number
    onRetry?: (attempt: number, delayMs: number, error: unknown) => void
  } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3

  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (!isRetryableGeminiError(error) || attempt === maxAttempts - 1) {
        throw error
      }

      const delayMs = getBackoffDelayMs(attempt)
      options.onRetry?.(attempt + 1, delayMs, error)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Gemini request failed after retries')
}
```

- [ ] **Step 2: OCR action의 모든 `generateContent(...)` 호출을 retry helper로 감싸기**

대상:
- visual mode per-crop 호출
- auto mode batch 호출

예시:

```ts
const result = await withGeminiRetry(
  () => model.generateContent(requestParts),
  {
    maxAttempts: 3,
    onRetry: (attempt, delayMs, error) => {
      console.warn('[OCR] Retrying Gemini request', {
        mode,
        attempt,
        delayMs,
        status: getErrorStatusCode(error),
        fileCount: files.length,
      })
    },
  }
)
```

- [ ] **Step 3: 재시도 소진 시 사용자용 오류 문구 정리**

```ts
if (isRetryableGeminiError(error)) {
  return {
    success: false,
    error: 'AI 서버가 일시적으로 혼잡합니다. 잠시 후 다시 시도해주세요.',
  }
}
```

- [ ] **Step 4: OCR action 소스 회귀 테스트 추가**

검증 포인트:
- `withGeminiRetry` 사용 여부
- `maxAttempts: 3` 존재 여부

- [ ] **Step 5: Loop 1 정적 검증 실행**

Run:
- `node --test tests/gemini-retry.test.mjs tests/ocr-actions-retry.test.mjs`
- `npx eslint src/lib/ocr/gemini-retry.ts src/app/api/ocr/actions.ts tests/gemini-retry.test.mjs tests/ocr-actions-retry.test.mjs`
- `npx tsc --noEmit`

Expected: PASS

---

### Task 3. Loop 1 수동 검증

- [ ] **Step 1: retry 로그가 보이도록 서버 로그 확인 포인트 추가**

확인할 로그:
- 첫 시도
- retry attempt 번호
- retry delay
- 최종 성공/최종 실패

- [ ] **Step 2: 503 주입 시나리오 검증**

방법 예시:
1. `generateContent`를 1회만 `{ status: 503 }` throw 하도록 임시 주입
2. 다음 호출은 성공 반환

기대 결과:
- 첫 시도 실패
- 자동 retry 수행
- 사용자 입장에서는 즉시 실패하지 않음
- 후속 시도 성공 시 OCR 완료

- [ ] **Step 3: 실패 조건 확인**

아래 중 하나라도 발생하면 Loop 1 실패:
- retry 미동작
- 무한 retry
- 400 같은 비일시 오류도 retry
- 사용자에게 raw Gemini overload 문구 그대로 노출

---

# Loop 2 — 관측성 및 UX 회복력 강화

## 종료 조건
다음이 모두 참일 때 종료합니다.
1. transient OCR 실패가 로그에서 명확히 구분된다.
2. 사용자 메시지가 일시적 혼잡/치명적 실패를 구분한다.
3. 수동 검증에서 UX가 불안정하지 않다.

---

### Task 4. 구조화된 OCR retry 로그 추가

**파일:**
- 수정: `src/app/api/ocr/actions.ts`

- [ ] **Step 1: retry 로그 구조화**

포함 항목:
- mode
- modelName
- fileCount
- status code
- retry attempt
- delayMs

- [ ] **Step 2: 완료 요약 로그 추가**

포함 항목:
- success/failure
- retryCount
- mode
- modelName
- fileCount

---

### Task 5. 클라이언트 UX 보강

**파일:**
- 수정: `src/components/features/passages/ocr-preview-stage.tsx`

- [ ] **Step 1: transient 오류 문구를 사용자 친화적으로 정리**

예:
- `AI 서버가 일시적으로 혼잡합니다. 잠시 후 다시 시도해주세요.`

- [ ] **Step 2: 필요하면 retry 중 안내 문구 추가**

예:
- `일시적 혼잡으로 자동 재시도 중입니다...`

단, 상태 관리가 과도하게 복잡해지면 이번 loop에서는 보류 가능.

- [ ] **Step 3: 수동 UX 검증**

확인 포인트:
- transient 오류 메시지 자연스러움
- parse/file 오류와 구분됨
- progress UI가 멈춘 것처럼 보이지 않음

---

# Loop 3 — 조건부 확장 (Loop 1로 충분하지 않을 때만)

## 종료 조건
아래 중 하나라도 만족하면 종료합니다.
- 비동기 OCR job 흐름 도입 완료
- fallback 모델 전략 도입 완료

---

### Option A. OCR job 비동기화 (권장 고도화)

- [ ] job 테이블 생성
- [ ] 업로드 시 즉시 job 생성 후 응답 반환
- [ ] 백그라운드 worker가 OCR 처리 + retry
- [ ] 클라이언트는 polling으로 상태 확인
- [ ] 503이 사용자 request latency를 직접 깨지 않는지 검증

### Option B. 모델 fallback 도입 (중간 수준 개선)

- [ ] 1차 모델 실패 시 fallback 모델 시도
- [ ] primary/fallback 성공률 로그 추가
- [ ] 출력 품질 수동 검증

---

# Loop 운영 규칙

모든 loop는 아래 순서를 반복합니다.

## 1) 분석
- 실패 로그 확인
- 현재 실패가 transient인지 구조적 문제인지 분류

## 2) 계획
- 가장 작은 수정으로 reliability 개선 가능한 방안 선택
- 대상 파일/테스트/성공 조건 명시

## 3) 구현
- 작은 diff 우선
- helper 분리 우선

## 4) 검증
반드시 아래를 확인합니다.
- focused tests PASS
- lint PASS (새 에러 없음)
- typecheck PASS
- loop별 수동 시나리오 PASS

## 반복 규칙
- 하나라도 실패하면 즉시 다음 loop로 넘어가지 않고
- **다시 분석 → 계획 → 구현 → 검증**으로 되돌아갑니다.

---

# 권장 실행 순서

1. **Loop 1 먼저 구현**
   - retry/backoff
   - transient message 정리
2. **503 1회 실패 후 성공 시나리오 검증**
3. **운영 로그 확인성 보강 (Loop 2)**
4. **필요할 때만 Loop 3로 확장**

---

# 최종 성공 기준

이 계획은 다음이 모두 만족될 때 성공입니다.
1. Gemini 503가 나와도 일반적인 경우 즉시 사용자 실패로 끝나지 않는다.
2. retry는 bounded하고, 로그로 추적 가능하다.
3. visual/auto OCR 기존 기능이 깨지지 않는다.
4. 테스트/lint/typecheck/수동 검증이 모두 통과한다.
