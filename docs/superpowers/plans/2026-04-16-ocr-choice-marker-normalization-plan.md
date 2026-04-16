# OCR 선택지 번호 표기 통일 구현 계획

> **에이전트 작업 지침:** 이 계획은 체크박스(`- [ ]`) 단위로 실행합니다. 각 loop는 **분석 → 계획 → 구현 → 검증** 순서를 따르며, 검증 통과 전에는 종료하지 않습니다.

**목표:** OCR 결과에서 선택지 번호가 `① ② ③`, `(1) (2) (3)`, `1. 2. 3.`처럼 섞여 나오는 문제를 해결하고, 내부 표준을 **`(1) (2) (3) (4)`** 형식으로 통일합니다.

**아키텍처:** OCR 후처리 정규화 계층에서 선택지 번호 표현을 통일합니다. 모델 prompt에는 번호를 보존하되, 최종적으로는 응답 normalization에서 `(1)` 형식으로 재작성하여 visual/auto OCR 결과가 동일한 표준을 따르도록 합니다.

**기술 스택:** Next.js App Router, TypeScript, OCR response normalization helper, Node test runner, ESLint

---

## 문제 요약

현재 OCR 결과에는 선택지 번호가 다음처럼 혼재될 수 있습니다.
- `① ② ③ ④`
- `(1) (2) (3) (4)`
- `1. 2. 3. 4.`
- `1) 2) 3) 4)`

이 상태는 이후 문제 편집/저장/가공 단계에서 일관성을 깨고, 화면상 보기에도 통일감이 없습니다.

따라서 OCR 결과가 passage로 들어오기 전에 번호 표기를 하나의 내부 표준으로 정규화해야 합니다.

---

## 표준 결정

### 최종 표준
- `(1)`
- `(2)`
- `(3)`
- `(4)`

### 선택 이유
- OCR/유니코드 변형에 가장 덜 민감함
- 후처리 정규식이 단순함
- 에디터/저장/검색/추가 후가공에서 안정적임

---

# Loop 1 — 번호 정규화 helper 도입

## 종료 조건
다음이 모두 참일 때 Loop 1 종료:
1. 다양한 번호 표기가 `(1)` 형식으로 정규화된다.
2. 일반 숫자 문장(예: 2025, 100 grams)은 잘못 변환되지 않는다.
3. 테스트/lint/typecheck 통과.

---

### Task 1. 선택지 번호 정규화 helper 추가

**파일:**
- 수정: `src/lib/ocr/response-normalization.ts`
- 테스트: `tests/ocr-response-normalization.test.mjs`

- [ ] **Step 1: 선택지 번호 변환 helper 추가**

```ts
export function normalizeChoiceMarkers(text: string): string {
  return text
    .replace(/(^|\n)\s*①\s+/g, '$1(1) ')
    .replace(/(^|\n)\s*②\s+/g, '$1(2) ')
    .replace(/(^|\n)\s*③\s+/g, '$1(3) ')
    .replace(/(^|\n)\s*④\s+/g, '$1(4) ')
    .replace(/(^|\n)\s*⑤\s+/g, '$1(5) ')
    .replace(/(^|\n)\s*([1-5])[\.)]\s+/g, '$1($2) ')
}
```

주의:
- 줄 시작(or 개행 직후)의 번호만 변환해야 함
- 본문 중 일반 숫자는 건드리지 않아야 함

- [ ] **Step 2: 기존 OCR passage 정규화 파이프라인에 helper 연결**

`normalizeOcrPassageText()` 내부에서:
1. blank 정규화
2. 선택지 번호 정규화
3. trim
순서로 실행

예시:

```ts
export function normalizeOcrPassageText(passage: string): string {
  return normalizeChoiceMarkers(
    passage
      .replace(/\[(?:blank|BLANK)\]/g, '_____')
      .replace(/\((?:blank|BLANK)\)/g, '_____')
      .replace(/_{2,}/g, '_____')
  ).trim()
}
```

- [ ] **Step 3: helper 단위 테스트 추가**

```js
test('circled numbers are normalized to parenthesized digits', () => {
  assert.equal(
    normalizeOcrPassageText('① held ten times more iron\n② had significantly less iron'),
    '(1) held ten times more iron\n(2) had significantly less iron'
  )
})

test('plain numbered choices are normalized to parenthesized digits', () => {
  assert.equal(
    normalizeOcrPassageText('1. first choice\n2) second choice'),
    '(1) first choice\n(2) second choice'
  )
})

test('ordinary numbers inside passage sentences are preserved', () => {
  assert.equal(
    normalizeOcrPassageText('In 1890, 100 grams of spinach contained 35 milligrams of iron.'),
    'In 1890, 100 grams of spinach contained 35 milligrams of iron.'
  )
})
```

- [ ] **Step 4: focused 테스트 실행**

Run:
- `node --test tests/ocr-response-normalization.test.mjs`

Expected: PASS

---

# Loop 2 — OCR prompt와 실제 응답 간의 흔들림 보정

## 종료 조건
다음이 모두 참일 때 Loop 2 종료:
1. prompt가 번호를 보존하도록 유도한다.
2. 모델이 다른 형식으로 반환해도 후처리에서 `(1)`로 통일된다.
3. 테스트/lint/typecheck 통과.

---

### Task 2. OCR prompt에 번호 보존 규칙 추가

**파일:**
- 수정: `src/app/api/ocr/actions.ts`

- [ ] **Step 1: visual prompt 보강**

규칙 추가 예시:

```ts
7. If answer choices or numbered options are visible, preserve them in order.
8. Normalize choice numbering conceptually as (1), (2), (3), ... in the output.
```

- [ ] **Step 2: auto prompt 보강**

규칙 추가 예시:

```ts
6. If the extracted passage contains numbered answer choices, preserve them and prefer the format (1), (2), (3), ...
```

- [ ] **Step 3: source-level 회귀 테스트 추가**

`tests/ocr-actions-choice-marker.test.mjs` 같은 파일에서,
OCR action prompt source에 번호 보존/표준화 의도가 들어있는지 확인

예:

```js
assert.match(source, /\(1\), \(2\), \(3\)/)
```

- [ ] **Step 4: 정적 검증 실행**

Run:
- `node --test tests/ocr-response-normalization.test.mjs tests/ocr-actions-choice-marker.test.mjs`
- `npx eslint src/lib/ocr/response-normalization.ts src/app/api/ocr/actions.ts tests/ocr-response-normalization.test.mjs tests/ocr-actions-choice-marker.test.mjs`
- `npx tsc --noEmit`

Expected: PASS

---

# Loop 3 — 실문서 회귀 검증

## 종료 조건
다음이 모두 참일 때 Loop 3 종료:
1. 실제 PDF/이미지에서 혼재된 번호 형식이 `(1)`로 통일된다.
2. 번호 없는 일반 지문은 손상되지 않는다.
3. 빈칸(`_____`)과 번호 정규화가 서로 충돌하지 않는다.

---

### Task 3. 실제 문서 기준 수동 검증

**파일:**
- 코드 수정 없음 (문제 발견 시만 수정)

- [ ] **Step 1: 원 있는 숫자 포함 문서 테스트**

시나리오:
1. 선택지 번호가 `① ② ③`로 보이는 문서 업로드
2. `전체 영역 자동 추출` 또는 `선택 영역 추출`
3. 결과가 `(1) (2) (3)`로 바뀌는지 확인

- [ ] **Step 2: 일반 숫자 포함 지문 테스트**

시나리오:
1. 연도/수치(예: 2025, 100 grams, 35 milligrams)가 있는 지문 추출
2. 일반 숫자가 망가지지 않는지 확인

- [ ] **Step 3: 빈칸 + 선택지 동시 포함 문서 테스트**

시나리오:
1. 밑줄 빈칸 + 선택지 번호가 같이 있는 지문 추출
2. 빈칸은 `_____`
3. 선택지 번호는 `(1)` 형식 유지되는지 확인

- [ ] **Step 4: 실패 시 반복 규칙**

아래 중 하나라도 발생하면 Loop 3 실패:
- `①`가 그대로 남음
- 일반 숫자가 잘못 `(1)` 등으로 변환됨
- 빈칸 처리와 번호 처리 충돌
- multi-line 선택지 순서가 깨짐

실패 시 반복:
1. 분석: 어떤 정규식이 과도하게 매칭했는지 확인
2. 계획: 줄 시작 anchor, 공백 규칙, 번호 범위 조정
3. 구현: helper 수정
4. 검증: 동일 시나리오 재실행

---

# 구현 원칙

1. **OCR 후처리 중심으로 해결**
   - 모델 출력은 흔들릴 수 있으므로 정규화 계층에서 마무리
2. **본문 숫자는 보존**
   - 줄 시작/선택지 패턴만 대상으로 제한
3. **번호 형식은 단일 표준으로 수렴**
   - `(1)` 계열만 남김
4. **빈칸 정규화와 충돌 금지**
   - `_____` 보존이 우선

---

# 최종 성공 기준

이 계획은 아래가 모두 만족될 때 성공입니다.
1. OCR 결과의 선택지 번호가 `(1)` 형식으로 통일된다.
2. 일반 숫자 본문은 변형되지 않는다.
3. 빈칸(`_____`)은 유지된다.
4. 테스트/lint/typecheck/실문서 검증이 통과한다.
