# 2단 지문 Widow-Safe Body Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2단 PDF 미리보기/저장 시 영어 지문이 페이지·컬럼 끝에서 `the` 같은 짧은 단어만 고립되어 끊기는 문제를, 현재 measured pagination 구조 안에서 DOM 측정 기반으로 개선한다.

**Architecture:** 현재 2단 measured path는 `body`를 line chunk로 선분할한 뒤 높이만 보고 페이지/컬럼에 배치한다. 이 계획은 우선 고립 단어/약한 trailing fragment를 감지하는 widow guard를 추가하고, body line chunk pagination이 column break 직전에 약한 fragment를 현재 컬럼에 남기지 않도록 `paginateMeasuredTwoColumnChunks()`에 body-aware rollback 규칙을 넣는다. 이후 필요 시 prefix-fit 방식으로 확장할 수 있도록 테스트와 metadata contract를 명확히 고정한다.

**Tech Stack:** Next.js, TypeScript, browser DOM measurement, Node test runner, Playwright/Chromium runtime harness.

---

## Loop Contract: 원인분석 → 해결책 계획 수립 → 검증

이 계획은 아래 루프를 따른다.

1. **원인분석:** 실제 실패 조건을 자동화 테스트로 재현한다. 테스트가 실패하지 않으면 원인분석이 잘못된 것이므로 계획을 수정한다.
2. **해결책 계획 수립/구현:** 하나의 원인에 대한 하나의 최소 변경만 적용한다.
3. **검증:** focused test → targeted regression → typecheck/lint/build 순서로 검증한다.
4. **검증 미통과 시:** 새 수정부터 추가하지 말고 원인분석 단계로 돌아가 실패 DOM/페이지 plan을 다시 계측한다.
5. **검증 통과 시에만:** 루프를 종료하고 커밋한다.

---

## Current Root Cause Analysis

### 관찰된 증상

첨부 화면에서 2단 `exam-only` 출력 중 3번 지문이 오른쪽 컬럼 하단에서 다음처럼 끊긴다.

```text
... contain many different types of culture is to recognize
the
```

문맥상 다음 단어/문장이 이어져야 하지만 다음 페이지로 넘어가며, 현재 컬럼에는 `the`만 남는다.

### 현재 코드 흐름

- `src/lib/exam-paper-two-column-measurement.ts`
  - `splitMeasuredBodyElementIntoLineChunks()`가 body를 line chunk로 변환한다.
  - `measureBodyLines()` → `findLargestFittingOffset()` → `snapOffsetToWordBoundary()`가 줄 단위 문자열 조각을 만든다.
- `src/lib/exam-paper-pdf-pagination.js`
  - `paginateMeasuredTwoColumnChunks()`가 chunk의 `measuredHeightPx`만 보고 현재 컬럼에 넣거나 다음 컬럼으로 이동시킨다.
- `src/lib/export-utils.ts`
  - `renderMeasuredColumnChunksHtml()`가 같은 컬럼에 들어온 인접 body line chunks를 다시 `.two-column-measured-body-flow`로 병합한다.

### 원인 가설

`paginateMeasuredTwoColumnChunks()`는 세로 높이만 보고 배치하므로, 컬럼 끝에서 의미상 약한 body line chunk가 고립되는 것을 막지 못한다.

예상 내부 분할:

```text
line chunk N: ... to recognize 
line chunk N+1: the 
line chunk N+2: functional operations ...
```

컬럼 남은 높이가 `line chunk N+1` 하나만 수용하면, 최종 HTML은 `line chunk N + N+1`만 병합해서 렌더링하고 `N+2`는 다음 페이지/컬럼으로 이동한다. 따라서 `the`만 현재 페이지 끝에 남는다.

### 해결 원칙

- chunk height만으로 배치하지 말고 body line chunk의 semantic weakness를 같이 본다.
- 컬럼/페이지 끝에 약한 body fragment가 남을 경우, 그 fragment를 다음 slot으로 이동시킨다.
- 너무 많은 하단 여백을 만들지 않도록 guard는 “짧은 단어/약한 function word/문장부호 없는 짧은 꼬리”에만 적용한다.
- 기존 1단 경로와 answer-only/exam-with-answers 구조는 건드리지 않는다.

---

## File Structure

### Modify

- `src/lib/exam-paper-pdf-pagination.js`
  - measured 2단 paginator에 body-aware widow/orphan guard 추가.
  - 현재 column의 마지막 chunk가 약한 body line이면 해당 **마지막 line chunk만** next slot으로 이동. 전체 body run을 이동하지 않는다.

- `src/lib/exam-paper-two-column-measurement.ts`
  - 필요 시 body line chunk metadata를 보강한다.
  - 현재 `bodyRawText`, `bodyLineIndex`, `bodyLineCount`, `sourceSectionId`가 있으므로 우선 추가 변경 없이 사용한다.

- `src/lib/export-utils.ts`
  - 필요 시 debug/test용 data attribute를 유지한다.
  - 최종 grouped body flow 렌더링은 유지한다.

### Modify Tests

- `tests/exam-paper-two-column-line-measurement.test.mjs`
  - 약한 trailing word가 컬럼 끝에 고립되지 않는 production measured path 테스트 추가.

- `tests/exam-paper-two-column-reproduction.test.mjs`
  - screenshot-like fixture에서 body group의 마지막 token이 약한 단어로 끝나는지 검사하는 회귀 테스트 추가.

- `tests/helpers/exam-paper-two-column-runtime-harness.mjs`
  - 현재 production browser runtime harness를 그대로 사용한다. 필요 시 page/column text 분석 helper만 추가한다.

---

## Task 1: Failing Test로 `the` 고립 재현

**Files:**
- Modify: `tests/exam-paper-two-column-line-measurement.test.mjs`

- [ ] **Step 1: Add a focused failing test for weak trailing body word isolation**

Append this test to `tests/exam-paper-two-column-line-measurement.test.mjs`.

```js
test('measured two-column pagination does not leave a weak body word alone at a column break', async () => {
  const passage = [
    'From an organizational viewpoint, one of the most fascinating examples of how any organization may contain many different types of culture is to recognize the functional operations of different departments within the organization.',
    'The varying departments and divisions within an organization will inevitably view any given situation from their own biased and prejudiced perspective.',
    'A department and its members will acquire “tunnel vision” which disallows them to see things as others see them.',
    'The very structure of organizations can create conflict.',
    'The choice of whether the structure is “mechanistic” or “organic” can have a profound influence on conflict management.',
  ].join(' ')

  const examPaper = {
    title: 'Widow guard regression',
    description: 'regression',
    viewMode: 'exam-only',
    columnLayout: 'double',
    questions: [
      {
        number: 1,
        questionText: '다음 글을 읽고 물음에 답하시오.',
        questionTextForward: null,
        passageText: `${passage} ${passage}`,
        questionTextBackward: null,
        choices: [
          { label: '①', text: 'first option' },
          { label: '②', text: 'second option' },
          { label: '③', text: 'third option' },
          { label: '④', text: 'fourth option' },
          { label: '⑤', text: 'fifth option' },
        ],
        answer: '①',
        explanation: 'explanation',
      },
      {
        number: 2,
        questionText: '다음 글을 읽고 요약문의 빈칸을 완성하시오.',
        questionTextForward: null,
        passageText: `${passage} ${passage}`,
        questionTextBackward: null,
        choices: [
          { label: '①', text: 'first option' },
          { label: '②', text: 'second option' },
          { label: '③', text: 'third option' },
          { label: '④', text: 'fourth option' },
          { label: '⑤', text: 'fifth option' },
        ],
        answer: '①',
        explanation: 'explanation',
      },
      {
        number: 3,
        questionText: '다음 글의 [단어] 친 부분 중, 문맥상 낱말의 쓰임이 적절하지 않은 것은?',
        questionTextForward: null,
        passageText: passage,
        questionTextBackward: null,
        choices: [
          { label: '①', text: 'fascinating' },
          { label: '②', text: 'inevitably' },
          { label: '③', text: 'allows' },
          { label: '④', text: 'insignificant' },
          { label: '⑤', text: 'upright' },
        ],
        answer: '③',
        explanation: 'explanation',
      },
    ],
  }

  const { document, cleanup } = await renderProductionMeasuredHtmlInBrowser(examPaper)

  try {
    const columns = [...document.querySelectorAll('.two-column-column')]
    const weakTailPattern = /(?:^|\s)(?:a|an|the|of|to|in|on|for|with|and|or)$/i
    const badColumn = columns.find((column) => {
      const bodyFlows = [...column.querySelectorAll('.two-column-measured-body-flow .flow-body-text')]
      const lastBodyText = bodyFlows.at(-1)?.textContent?.trim() ?? ''
      return weakTailPattern.test(lastBodyText)
    })

    assert.equal(
      badColumn,
      undefined,
      'expected no measured body flow at a column break to end with an isolated weak word such as "the"'
    )
  } finally {
    await cleanup()
  }
})
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test tests/exam-paper-two-column-line-measurement.test.mjs
```

Expected before implementation:

```text
FAIL measured two-column pagination does not leave a weak body word alone at a column break
```

If the test unexpectedly passes, return to 원인분석 and add instrumentation that logs each page/column's last body text.

---

## Task 2: Body line chunk semantic guard 추가

**Files:**
- Modify: `src/lib/exam-paper-pdf-pagination.js`
- Test: `tests/exam-paper-two-column-line-measurement.test.mjs`

- [ ] **Step 1: Add helper functions to detect measured body line chunks and weak trailing text**

In `src/lib/exam-paper-pdf-pagination.js`, above `paginateMeasuredTwoColumnChunks()`, add:

```js
const WEAK_BODY_TRAILING_WORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'and',
  'or',
  'but',
  'as',
  'by',
  'from',
])

function isMeasuredBodyLineChunk(chunk) {
  return chunk &&
    chunk.kind === 'body' &&
    typeof chunk.bodyLineIndex === 'number' &&
    typeof chunk.sourceSectionId === 'string' &&
    typeof chunk.bodyRawText === 'string'
}

function getTextWords(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function getLastWord(text) {
  const words = getTextWords(text)
  return words.at(-1)?.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '').toLowerCase() ?? ''
}

function endsWithSentenceBoundary(text) {
  return /[.!?。！？]\s*$/.test(String(text || '').trim())
}

function isWeakTrailingBodyText(text) {
  const normalized = String(text || '').trim()

  if (!normalized) {
    return false
  }

  const words = getTextWords(normalized)
  const lastWord = getLastWord(normalized)

  return (
    words.length <= 1 ||
    (normalized.length <= 14 && !endsWithSentenceBoundary(normalized)) ||
    WEAK_BODY_TRAILING_WORDS.has(lastWord)
  )
}
```

- [ ] **Step 2: Add current-column body tail analysis helper**

Still in `src/lib/exam-paper-pdf-pagination.js`, above `paginateMeasuredTwoColumnChunks()`, add:

```js
function getTrailingBodyLineChunk(chunks) {
  const lastChunk = chunks.at(-1)

  return isMeasuredBodyLineChunk(lastChunk) ? lastChunk : null
}

function getTrailingBodyLineText(chunks) {
  return getTrailingBodyLineChunk(chunks)?.bodyRawText?.trim() ?? ''
}
```

- [ ] **Step 3: Add rollback helper inside measured paginator**

Inside `paginateMeasuredTwoColumnChunks()`, after `moveToNextSlot()`, add this helper:

```js
  const rollbackWeakTrailingBodyLine = () => {
    const currentColumnChunks = pages[pageIndex][columnKey]
    const trailingChunk = getTrailingBodyLineChunk(currentColumnChunks)

    if (!trailingChunk || !isWeakTrailingBodyText(trailingChunk.bodyRawText)) {
      return false
    }

    const removed = currentColumnChunks.pop()

    if (removed !== trailingChunk) {
      if (removed) {
        currentColumnChunks.push(removed)
      }
      return false
    }

    const removedHeight = Math.ceil(trailingChunk.measuredHeightPx || trailingChunk.estimatedHeight || 0)
    usage[pageIndex][columnKey] = Math.max(0, usage[pageIndex][columnKey] - removedHeight)

    moveToNextSlot()
    ensurePage(pageIndex)

    pages[pageIndex][columnKey].push(trailingChunk)
    usage[pageIndex][columnKey] += removedHeight

    return true
  }
```

- [ ] **Step 4: Invoke rollback before switching because of a non-fitting next body line**

In `paginateMeasuredTwoColumnChunks()`, replace the existing overflow condition:

```js
    if (usage[pageIndex][columnKey] > 0 && height > remaining) {
      moveToNextSlot()
      ensurePage(pageIndex)
    }
```

with:

```js
    if (usage[pageIndex][columnKey] > 0 && height > remaining) {
      const previousPageIndex = pageIndex
      const previousColumnKey = columnKey
      const rolledBackWeakTail = isMeasuredBodyLineChunk(chunk)
        ? rollbackWeakTrailingBodyLine()
        : false

      if (!rolledBackWeakTail || (previousPageIndex === pageIndex && previousColumnKey === columnKey)) {
        moveToNextSlot()
        ensurePage(pageIndex)
      }
    }
```

- [ ] **Step 5: Run focused test**

Run:

```bash
node --test tests/exam-paper-two-column-line-measurement.test.mjs
```

Expected:

```text
PASS measured two-column pagination does not leave a weak body word alone at a column break
```

If this fails because the current column still ends with a weak word, return to Task 1 원인분석 and log the exact `bodyRawText`, `sourceSectionId`, `bodyLineIndex`, and page/column index. Do **not** move the entire body run; adjust only the final weak line or add a second-line rollback rule if evidence proves one line is insufficient.

---

## Task 3: Guard가 과도한 하단 여백을 만들지 않는지 회귀 검증

**Files:**
- Modify: `tests/exam-paper-two-column-reproduction.test.mjs`

- [ ] **Step 1: Add helper to assert no weak body tail at measured column boundaries**

In `tests/exam-paper-two-column-reproduction.test.mjs`, add this helper near the existing analysis helpers:

```js
function assertNoWeakBodyTailAtColumnBreak(pages) {
  const weakTailPattern = /(?:^|\s)(?:a|an|the|of|to|in|on|for|with|and|or|but|as|by|from)$/i

  pages.forEach((page, pageIndex) => {
    page.columns.forEach((column, columnIndex) => {
      const lastSection = column.sections.at(-1)

      if (!lastSection || (
        lastSection.kind !== 'body' &&
        !lastSection.className.includes('two-column-measured-body-flow')
      )) {
        return
      }

      assert.doesNotMatch(
        lastSection.text.trim(),
        weakTailPattern,
        `expected page ${pageIndex + 1} column ${columnIndex + 1} not to end body flow with a weak isolated word`
      )
    })
  })
}
```

- [ ] **Step 2: Use helper in realistic measured preview tests**

In each measured realistic two-column test that already calls `analyzeDoublePreviewPages(html)`, add:

```js
assertNoWeakBodyTailAtColumnBreak(pages)
```

At minimum add it to:

```js
test('exam-with-answers double preview places realistic answers after all question chunks without overflow', async () => {
  // existing code
  assertNoWeakBodyTailAtColumnBreak(pages)
})

test('measured two-column preview should use rendered DOM heights before final pagination', async () => {
  // existing code
  assertNoWeakBodyTailAtColumnBreak(pages)
})
```

- [ ] **Step 3: Run reproduction tests**

Run:

```bash
node --test tests/exam-paper-two-column-reproduction.test.mjs
```

Expected:

```text
PASS all tests
```

If this fails due excessive blank space or a weak tail remains, return to 원인분석 and inspect whether one-line rollback is insufficient. Prefer a bounded two-line rollback only with evidence; do not move the entire body run because that can recreate large bottom gaps.

---

## Task 4: 기존 2단/1단 동작 회귀 방지 검증

**Files:**
- No production changes unless tests fail.

- [ ] **Step 1: Run targeted exam-paper suite**

Run:

```bash
node --test --test-concurrency=1 \
  tests/exam-paper-two-column-line-measurement.test.mjs \
  tests/exam-paper-two-column-spacing.test.mjs \
  tests/exam-paper-two-column-reproduction.test.mjs \
  tests/exam-paper-browser-pdf-viewer.test.mjs \
  tests/exam-paper-exam-with-answers-separated.test.mjs \
  tests/exam-paper-single-column-regression.test.mjs
```

Expected:

```text
pass, fail 0
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
./node_modules/.bin/tsc --noEmit --pretty false
```

Expected:

```text
exit code 0
```

- [ ] **Step 3: Run targeted lint**

Run:

```bash
./node_modules/.bin/eslint \
  src/lib/exam-paper-pdf-pagination.js \
  tests/exam-paper-two-column-line-measurement.test.mjs \
  tests/exam-paper-two-column-reproduction.test.mjs
```

Expected:

```text
exit code 0
```

A `baseline-browser-mapping` freshness warning is acceptable if eslint exits 0.

- [ ] **Step 4: Run production build**

Run:

```bash
npm run build
```

Expected:

```text
Compiled successfully
exit code 0
```

If Turbopack fails in sandbox with process/port permission, rerun with escalated execution and record that the sandbox failure was environmental.

---

## Task 5: Optional visual/debug verification before commit

**Files:**
- No production changes unless manual visual verification fails.

- [ ] **Step 1: Enable debug logging if visual issue persists**

In browser console on `localhost:4000`, run:

```js
localStorage.setItem('exam-paper-pdf-debug', '1')
```

Then reopen the PDF workspace and inspect console logs from `src/lib/exam-paper-pdf-pagination.js`.

- [ ] **Step 2: Check the specific visual condition**

In the 2단 PDF workspace:

1. Select `시험지` mode.
2. Select `2단` layout.
3. Scroll to the page containing question 3.
4. Confirm no body paragraph/column ends with only one weak word such as `the`, `of`, `to`, `a`, `an`.

Expected:

```text
Question 3 passage does not end a page/column with isolated "the".
```

- [ ] **Step 3: If visual verification fails, return to 원인분석**

Collect:

```js
[...document.querySelectorAll('.two-column-column')].map((column, index) => ({
  index,
  text: column.innerText.slice(-300),
}))
```

Use that output to adjust Task 2 guard rules. Do not add unrelated layout changes.

---

## Task 6: Commit

**Files:**
- Production and test files modified above.

- [ ] **Step 1: Review staged diff**

Run:

```bash
git diff -- src/lib/exam-paper-pdf-pagination.js tests/exam-paper-two-column-line-measurement.test.mjs tests/exam-paper-two-column-reproduction.test.mjs
```

Expected:

```text
Only widow-safe measured pagination and related tests changed.
```

- [ ] **Step 2: Commit with Lore protocol**

Run:

```bash
git add \
  src/lib/exam-paper-pdf-pagination.js \
  tests/exam-paper-two-column-line-measurement.test.mjs \
  tests/exam-paper-two-column-reproduction.test.mjs

git commit -m "Prevent weak body words at two-column page breaks" \
  -m "Measured two-column pagination could leave a short function word such as 'the' at the bottom of a page because chunks were placed by height only. Add a body-aware widow guard so weak trailing body runs move with the following body line instead of being stranded at the column break." \
  -m "Constraint: Keep dense two-column pagination while improving readable passage flow" \
  -m "Rejected: Disable line-based body pagination | would reintroduce large two-column bottom gaps" \
  -m "Rejected: Increase global bottom guard | fixes one case by wasting space across all pages" \
  -m "Confidence: medium" \
  -m "Scope-risk: moderate" \
  -m "Directive: Keep weak-tail detection limited to measured body line chunks, not question headers or answer chunks" \
  -m "Tested: node --test --test-concurrency=1 targeted exam-paper tests" \
  -m "Tested: ./node_modules/.bin/tsc --noEmit --pretty false" \
  -m "Tested: targeted eslint" \
  -m "Not-tested: User's exact authenticated browser session unless visual verification is performed"
```

---

## Verification Gate

The loop is complete only when all conditions pass.

- [ ] Focused failing test fails before implementation and passes after implementation.
- [ ] No measured body flow at a page/column break ends with weak isolated words: `a`, `an`, `the`, `of`, `to`, `in`, `on`, `for`, `with`, `and`, `or`.
- [ ] Existing 2단 하단 여백 regression tests still pass.
- [ ] 1단 preview tests still pass.
- [ ] `exam-with-answers` still keeps all answers after all questions.
- [ ] TypeScript check passes.
- [ ] Targeted lint passes.
- [ ] Production build passes.
- [ ] If any gate fails, return to **Current Root Cause Analysis** and update the hypothesis before editing more code.

---

## Self-Review

### Spec coverage

- 원인분석: documented in `Current Root Cause Analysis`, Task 1 requires failing repro.
- 해결책 계획 수립: Task 2 adds measured body-aware widow guard; Task 3 checks realistic regression.
- 검증 loop: Tasks 4-5 define automated and optional visual verification, with explicit return-to-analysis rules.
- 2단 only: guard is limited to `paginateMeasuredTwoColumnChunks()` and `isMeasuredBodyLineChunk()`.

### Placeholder scan

No `TBD`, `TODO`, or unspecified “write tests” steps remain. Every test step includes concrete code or command.

### Type/name consistency

- `bodyRawText`, `bodyLineIndex`, `sourceSectionId`, `kind`, `measuredHeightPx` match current `HtmlPaginationChunk` metadata.
- `paginateMeasuredTwoColumnChunks()` is the only production pagination function modified.
- Test helper `renderProductionMeasuredHtmlInBrowser()` already exists in `tests/helpers/exam-paper-two-column-runtime-harness.mjs` and is imported by `tests/exam-paper-two-column-line-measurement.test.mjs`.
- The rollback algorithm moves only the final weak measured body line chunk; moving an entire body run is explicitly rejected because it can reintroduce large bottom gaps.
