# 문제지 PDF 2단 레이아웃 개선 계획

> **에이전트 작업 지침:** 이 계획은 체크박스(`- [ ]`) 단위로 실행합니다. 각 단계는 **분석 → 계획 → 구현 → 검증** loop를 따르며, 검증을 통과하기 전에는 다음 단계로 진행하지 않습니다.

**목표:** 문제지 PDF 저장 워크스페이스에서 `2단`을 선택했을 때 특정 문제(예: 2번)가 공백처럼 보이거나 누락되는 현상을 해결하고, 사용자가 기대하는 실제 2단 문서 흐름으로 개선한다.

**아키텍처:** 현재 구현은 `columnLayout === 'double'`일 때 문제를 두 개씩 `columns` 배열에 병렬 배치하는 방식이다. 이 구조는 “문서 전체 2단 흐름”이 아니라 “문제 2개를 한 row에 강제 배치”하는 방식이기 때문에, 문제 길이 차이와 `unbreakable` 설정이 페이지 경계와 충돌할 때 공백/누락처럼 보이는 현상을 만들 수 있다. 개선 방향은 **pair-based columns 배치를 버리고**, 문서 전체가 2단 컬럼으로 자연스럽게 흐르도록 바꾸는 것이다.

**기술 스택:** Next.js App Router, TypeScript, pdfMake, 브라우저 내장 PDF viewer(iframe/new tab), Node test runner, ESLint

---

## 문제 요약

현재 `src/lib/exam-paper-pdf.ts`의 `2단` 구현은 아래와 같은 구조다.

```ts
for (let index = 0; index < questionNodes.length; index += 2) {
  content.push({
    columns: [
      questionNodes[index],
      questionNodes[index + 1] ?? { text: '' },
    ],
    columnGap: 18,
  })
}
```

또한 각 문제 노드는 다음과 같이 묶여 있다.

```ts
return {
  stack,
  unbreakable: true,
  margin: [0, 0, 0, 14],
}
```

이 구조의 결과:
- 사용자는 “문서 전체 2단”을 기대하지만,
- 실제로는 “문제 2개 병렬 배치”임
- 문제 길이가 다르거나 페이지 경계와 만나면 오른쪽 문제(예: 2번)가 비어 보이거나 레이아웃이 어긋날 수 있음

---

# Loop 1 — 현재 2단 문제를 재현 가능한 형태로 고정하고 원인을 테스트로 명시

## 종료 조건
다음이 모두 만족될 때 Loop 1 종료:
1. 현재 2단 구현이 pair-based columns 방식임이 테스트/코드 상에서 명확하다.
2. 공백처럼 보이는 문제의 원인 후보가 문서화된다.
3. 정적 검증 통과.

---

### Task 1. 현재 구조를 테스트와 계획 문서에 명시

**파일:**
- 수정: `tests/exam-paper-browser-pdf-viewer.test.mjs`
- 수정: `docs/superpowers/plans/2026-04-17-exam-paper-double-column-fix-plan.md`

- [ ] **Step 1: 현재 2단 구현이 pair-based columns라는 사실을 테스트로 고정**

예시:

```js
assert.match(pdfSource, /columnLayout === 'double'/)
assert.match(pdfSource, /columns:\s*\[/)
```

- [ ] **Step 2: 계획 문서에 원인 가설을 명시**

핵심 가설:
- `columns` 병렬 배치 구조
- `unbreakable: true`
- 문제 길이 불균형
- 페이지 경계와의 충돌

- [ ] **Step 3: focused 검증 실행**

Run:
- `node --test tests/exam-paper-browser-pdf-viewer.test.mjs`
- `npx eslint tests/exam-paper-browser-pdf-viewer.test.mjs`

Expected: PASS

---

# Loop 2 — 2단 구현을 “문제 2개 병렬 배치”에서 “문서 전체 2단 흐름”으로 변경

## 종료 조건
다음이 모두 만족될 때 Loop 2 종료:
1. `2단` 선택 시 더 이상 문제를 2개씩 강제 pair 배치하지 않는다.
2. 문제 흐름이 문서 전체 기준의 2단으로 해석된다.
3. 1단 레이아웃은 회귀가 없다.
4. 정적 검증 통과.

---

### Task 2. PDF 생성 로직 재구성

**파일:**
- 수정: `src/lib/exam-paper-pdf.ts`

- [ ] **Step 1: pair-based columns 제거**

현재:

```ts
content.push({
  columns: [leftQuestion, rightQuestion],
  columnGap: 18,
})
```

이를 제거하고, questionNodes를 순차적으로 content에 넣는 방향으로 되돌린다.

- [ ] **Step 2: 문서 전체 2단 column flow 적용**

pdfMake에서 가능한 범위 안에서, 문서 정의 레벨에 2단 흐름을 설정한다.

예시 방향:

```ts
return {
  pageSize: 'A4',
  pageMargins: [36, 40, 36, 40],
  content: [...questionNodes],
  ...(
    columnLayout === 'double'
      ? {
          pageOrientation: 'portrait',
          pageBreakBefore: undefined,
          // pdfmake column-flow 지원 방식에 맞는 구조 적용
        }
      : {}
  )
}
```

주의:
- pdfMake가 실제 신문형 다단을 얼마나 지원하는지 코드/문서 기준으로 확인 후 가장 안정적인 형태를 선택해야 함
- 만약 직접 다단 흐름이 제한적이면, 다른 안정적인 문서 분할 전략이 필요할 수 있음

- [ ] **Step 3: `unbreakable` 범위 재검토**

현재는 문제 전체가 `unbreakable: true`라 페이지 경계에서 충돌 가능성이 큼.

후보:
1. 문제 전체 `unbreakable` 제거
2. passage/answer section만 부분적으로 유지
3. 아주 긴 문제는 break 허용

권장:
- 문제 전체 `unbreakable`는 완화 또는 제거
- 최소한 2단 모드에서는 더 보수적으로 사용

- [ ] **Step 4: 1단/2단 경로를 분기 명확화**

`single`:
- 현재처럼 단일 흐름 유지

`double`:
- 별도 빌드 경로로 처리
- 같은 데이터라도 구조를 다르게 만듦

---

### Task 3. Loop 2 검증

**정적 검증:**
- `node --test tests/exam-paper-browser-pdf-viewer.test.mjs`
- `npx eslint src/lib/exam-paper-pdf.ts tests/exam-paper-browser-pdf-viewer.test.mjs`
- `npx tsc --noEmit`

**수동 검증:**
1. PDF 저장 워크스페이스 열기
2. `1단` 선택 → 정상 표시 확인
3. `2단` 선택 → iframe PDF 갱신 확인
4. 기존에 공백처럼 보이던 2번 문제가 실제로 렌더되는지 확인
5. 다운로드한 PDF도 같은 결과인지 확인

**실패 시 반복 규칙:**
- 특정 문제가 비어 보임 → `unbreakable`/page break 분석
- 2단인데 여전히 병렬 row처럼 보임 → 문서 정의 구조 재분석
- 1단이 깨짐 → single/double 분기 분리 강화

---

# Loop 3 — 실제 문서 시각 품질 조정

## 종료 조건
다음이 모두 만족될 때 Loop 3 종료:
1. 2단 문서가 시각적으로 자연스럽다.
2. 문제 길이가 달라도 공백/누락처럼 보이지 않는다.
3. iframe 미리보기와 저장 결과가 일치한다.

---

### Task 4. 시각 품질 조정

**파일:**
- 수정: `src/lib/exam-paper-pdf.ts`
- 필요 시 `src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx`

- [ ] **Step 1: column gap / margin 조정**
- [ ] **Step 2: 문제 블록 간 간격 조정**
- [ ] **Step 3: 너무 긴 passage/해설의 break 허용 여부 조정**
- [ ] **Step 4: 미리보기 갱신 지연(debounce) 유지 여부 점검**

---

# 검증 loop 운영 규칙

## 1) 분석
- 어떤 문제 번호가 왜 비어 보였는지 구조적으로 파악
- pair columns vs true 2-column flow 차이를 명확히 함

## 2) 계획
- 최소 수정으로 레이아웃 방식 자체를 교정
- single mode 회귀가 없도록 분기 전략을 정의

## 3) 구현
- `src/lib/exam-paper-pdf.ts` 중심으로 수정
- 필요 시 워크스페이스는 상태 반영만 유지

## 4) 검증
- source test
- lint
- typecheck
- iframe 미리보기 수동 검증
- 다운로드한 PDF 수동 검증

검증 실패 시:
- 다시 분석 → 계획 → 구현 → 검증으로 반복

---

# 최종 권장 결론

현재 문제는 단순 버그가 아니라,
**2단 레이아웃을 구현한 방식이 사용자 기대와 다르기 때문에 생긴 구조 문제**다.

즉,
- 지금: 문제 2개 병렬 배치
- 사용자가 기대하는 것: 문서 전체 2단 흐름

따라서 가장 좋은 해결책은
> `columns`로 문제를 2개씩 묶는 방식을 버리고,
> 문서 전체가 2단으로 흐르는 방향으로 PDF 생성 구조를 바꾸는 것

이다.

---

# 최종 성공 기준

이 계획은 아래가 모두 만족될 때 성공입니다.
1. `2단` 선택 시 특정 문제가 공백처럼 보이지 않는다.
2. 문제들이 순서대로 자연스럽게 2단 흐름으로 보인다.
3. `1단`은 회귀 없이 유지된다.
4. iframe 미리보기와 다운로드 PDF 결과가 일치한다.
5. 각 loop는 검증 통과 후에만 종료된다.
