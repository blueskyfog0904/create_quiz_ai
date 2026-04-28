# 문제지 PDF 2단 다음-단 우선 흐름 개선 계획

> **에이전트 작업 지침:** 이 계획은 체크박스(`- [ ]`) 단위로 실행합니다. 각 단계는 **분석 → 계획 → 검증** loop를 따르며, 검증을 통과하기 전에는 다음 단계로 진행하지 않습니다.

**목표:** 문제지 PDF 저장 워크스페이스에서 `시험지+답안 + 2단` 조합일 때, 긴 문제가 왼쪽 첫 단을 다 채우지 못하면 **같은 페이지의 오른쪽 다음 단으로 먼저 이어지고**, 오른쪽 단에도 다 못 들어갈 때만 **다음 페이지 첫 단**으로 넘어가도록 만든다.

**현재 관찰 증상:** 첫 페이지 이후 특정 문제에서
- 문제 본문 일부가 남아 있는데도
- 같은 페이지 오른쪽 단으로 이어지지 않고
- 바로 다음 페이지로 넘어가거나,
- 반대로 뒤 문제 번호가 먼저 보이는 현상이 있다.

**기술 스택:** Next.js App Router, TypeScript, pdfMake, 브라우저 내장 PDF viewer(iframe/new tab), Node test runner, ESLint

---

## 현재 구조와 직접 원인

### 원인 1 — 현재 2단은 “문서 흐름형 2단”이 아니라 “좌/우 독립 stack 2개” 구조
현재 `src/lib/exam-paper-pdf.ts`의 `시험지+답안 + 2단` 특수 경로는 다음 구조다.

- `leftColumn` 전체를 하나의 큰 `stack`
- `rightColumn` 전체를 하나의 큰 `stack`
- 이 둘을 `columns: [left, right]`에 넣음

이 구조에서는 왼쪽 stack 안의 긴 본문이 **같은 페이지 오른쪽 단으로 자연스럽게 흐를 수 없다.**
왜냐하면 pdfmake 입장에서는 좌/우가 “연속된 하나의 텍스트 흐름”이 아니라 “서로 독립적인 두 개의 컬럼 컨테이너”이기 때문이다.

즉, 현재 구조는 사용자가 기대하는:
- 왼쪽 단 overflow → 오른쪽 단 continuation → 다음 페이지 첫 단

흐름을 본질적으로 지원하지 못한다.

### 원인 2 — 본문/답안 분리를 해도, 컬럼 자체가 독립 stack이면 같은 페이지 다음 단 continuation이 안 됨
최근 수정으로 body/answer split과 `pageBreakBefore`를 넣어 orphan은 줄였지만, 핵심 한계는 그대로다.

- body block
- answer block

을 분리해도, 둘 다 결국 `leftColumn` 또는 `rightColumn` stack 내부에 들어간다.
따라서 “왼쪽 body의 남은 부분을 오른쪽 단으로 넘긴다”가 아니라,
- 왼쪽 stack 안에서 계속 배치되거나
- 다음 페이지로 넘어가는
경향이 유지된다.

### 원인 3 — 현재 분배 로직은 읽는 순서/컬럼 continuation/페이지 continuation을 동시에 만족시키지 못함
현재까지 거친 전략들:
- weight 균형 분배
- 홀수/짝수 읽기 순서 분배
- body/answer split + orphan 방지

이 방식들은 각각 일부 증상은 완화하지만,
**“같은 페이지의 다음 단으로 먼저 이어진다”**는 핵심 요구를 충족시키지 못한다.

왜냐하면 이 요구는 단순한 분배 문제가 아니라,
> **문제 본문을 페이지 단위·단(column) 단위로 직접 pagination 해야 하는 문제**
이기 때문이다.

---

## 요구사항 재정의

이슈를 정확히 만족하는 동작은 아래와 같다.

1. 한 문제의 본문은 가능한 한 읽는 흐름을 유지한다.
2. 왼쪽 단 공간이 부족하면, **같은 페이지 오른쪽 단으로 이어진다.**
3. 오른쪽 단까지 다 써도 부족하면, **다음 페이지 왼쪽 단으로 이어진다.**
4. 정답/해설은 본문 뒤에만 따라오며, 본문보다 먼저 나오면 안 된다.
5. 문제 번호 순서는 항상 `1 → 2 → 3 → 4` 읽는 순서를 유지해야 한다.

즉, 이건 “문항 단위 병렬 배치”가 아니라,
**문제 본문을 독서 흐름(reading flow) 기준으로 흘리는 2단 pagination**이다.

---

## 권장 설계 방향

## 방향 A — `시험지+답안 + 2단`을 전용 “가상 페이지네이터”로 처리 (권장)
현재 공통 `columns` 전략을 계속 보정하기보다,
`시험지+답안 + 2단`만 전용으로 아래 흐름을 구현한다.

### 핵심 아이디어
문제를 바로 `pdfmake columns`에 던지지 않고,
먼저 애플리케이션 레벨에서 다음 단계를 거친다.

1. 각 문제를 **본문 블록 단위**와 **답안 블록 단위**로 나눈다.
2. 본문 블록을 다시 **컬럼에 들어갈 수 있는 chunk 단위**로 나눈다.
3. 페이지를 `[left column, right column]` 슬롯으로 가정하고,
   - 현재 left에 넣고
   - 남으면 same-page right에 이어넣고
   - 더 남으면 next-page left에 넘긴다.
4. answer/explanation은 body completion 뒤에 append한다.

즉, `pdfmake`에게 자연 흐름을 기대하지 않고,
**앱이 직접 “페이지/단 배치 결과”를 만든 뒤에 pdfmake는 그 결과를 렌더만 하게 하는 방식**이다.

### 장점
- 요구사항과 가장 잘 맞는다.
- “다음 단 우선, 없으면 다음 페이지”를 직접 제어 가능하다.
- 순서 역전/answer orphan 같은 부수 문제도 함께 다룰 수 있다.

### 단점
- 구현 복잡도가 가장 높다.
- 텍스트 높이 추정 로직이 필요하다.

---

## 방향 B — HTML 기반 2단 렌더 후 브라우저 인쇄/PDF 사용 (대안)
`pdfmake` 2단 제약을 피하고,
브라우저 CSS 멀티컬럼 또는 명시적 grid/flow 기반 HTML 렌더를 만든 뒤,
브라우저 PDF 저장/인쇄를 이용하는 방법이다.

### 장점
- “다음 단으로 자연스럽게 흐름”은 HTML/CSS가 더 잘함.
- 현재 브라우저 내장 PDF viewer 흐름과도 철학이 맞음.

### 단점
- 현재 pdfmake 기반 blob 생성 경로와 이원화됨.
- 페이지 단위 정밀 제어가 또 다른 문제로 남을 수 있음.

---

## 방향 C — 현재 pdfmake 구조 유지 + pageBreakBefore를 더 공격적으로 사용 (비권장)
본문이 남아 있어도 같은 페이지 다음 단으로 넘길 수 없기 때문에,
현재 구조에서 할 수 있는 최선은 “문제가 다음 페이지로 안전하게 넘어가게” 만드는 정도다.

즉,
- 읽기 흐름은 조금 깨지더라도
- 누락/역전만 막는 보수적 전략

인데, 이번 요구사항인 “같은 페이지 다음 단 우선”을 만족시키지 못하므로 비권장이다.

---

# 권장 결론

이번 요구사항은 단순 spacing/break tweak로 해결할 수 없다.
가장 현실적인 해법은:

> **`시험지+답안 + 2단`만 전용 pagination 경로로 분리하고, 앱이 직접 페이지/단 단위 배치 결과를 만든 뒤 pdfmake에 넘기는 것**

이다.

---

# 구현 계획

## Loop 1 — 실패 조건 고정 및 전용 pagination 범위 명시

### 종료 조건
다음이 모두 만족될 때 종료:
1. `시험지+답안 + 2단`만 전용 페이지네이터 대상임이 코드/계획에 명확하다.
2. 현재 giant stack/독립 column 구조가 같은 페이지 다음 단 continuation을 지원하지 못한다는 사실이 테스트/문서에 반영된다.
3. 정적 검증 통과.

### Task 1. 현재 구조의 한계를 테스트와 계획에 고정

**파일:**
- 수정: `docs/superpowers/plans/2026-04-17-exam-paper-two-column-continuation-plan.md`
- 수정: `tests/exam-paper-browser-pdf-viewer.test.mjs`

- [ ] **Step 1: source-level test에 전용 경로 존재를 고정**
  - `시험지+답안 + 2단` 별도 함수 또는 분기 존재 확인
- [ ] **Step 2: giant stack 기반 분배에서 벗어난다는 의도를 테스트에 반영**
- [ ] **Step 3: focused 검증**
  - `node --test tests/exam-paper-browser-pdf-viewer.test.mjs`
  - `npx eslint tests/exam-paper-browser-pdf-viewer.test.mjs`

---

## Loop 2 — 본문을 “컬럼 continuation 가능한 chunk”로 분해

### 종료 조건
다음이 모두 만족될 때 종료:
1. 문제 본문이 하나의 거대한 block이 아니라 continuation 가능한 단위로 분해된다.
2. 정답/해설은 본문 뒤에만 위치한다.
3. 정적 검증 통과.

### Task 2. 본문 chunk 설계

**파일:**
- 수정: `src/lib/exam-paper-pdf.ts`
- 필요 시 신규 helper: `src/lib/exam-paper-pdf-pagination.ts`

- [ ] **Step 1: 본문 최소 단위 정의**
  - 문제 번호 + 문제문
  - 지문 문단들
  - 선택지 목록
- [ ] **Step 2: chunk 모델 정의**
  - 예: `QuestionChunk = { questionNumber, kind: 'header'|'passage'|'choices'|'answer', estimatedHeight, node }`
- [ ] **Step 3: 정답/해설은 body completion 뒤에만 enqueue 되도록 규칙 정의**
- [ ] **Step 4: focused 검증**
  - 타입/정적 검증

---

## Loop 3 — 페이지/단 슬롯 기반 가상 페이지네이터 구현

### 종료 조건
다음이 모두 만족될 때 종료:
1. 왼쪽 단 overflow 시 오른쪽 단 continuation이 우선된다.
2. 오른쪽 단도 overflow면 다음 페이지 왼쪽 단으로 이동한다.
3. 문제 번호 읽는 순서가 유지된다.
4. 정적 검증 통과.

### Task 3. `시험지+답안 + 2단` 전용 pagination 함수 구현

**파일:**
- 수정: `src/lib/exam-paper-pdf.ts`
- 신규 가능: `src/lib/exam-paper-pdf-pagination.ts`

- [ ] **Step 1: 페이지 모델 정의**
  - `pages = [{ left: Chunk[], right: Chunk[] }]`
- [ ] **Step 2: 슬롯 적재 규칙 구현**
  - left 남은 높이에 먼저 적재
  - 안 들어가면 same-page right에 continuation
  - right도 안 들어가면 next-page left 생성
- [ ] **Step 3: body 완료 후 answer/explanation append 규칙 구현**
- [ ] **Step 4: pdfmake용 최종 문서 정의 변환**
  - 각 페이지를 `columns` 2개로 만들되, 이미 앱이 pagination을 끝낸 결과만 렌더
- [ ] **Step 5: focused 검증**
  - `node --test ...`
  - `npx eslint ...`
  - `npx tsc --noEmit`

---

## Loop 4 — 긴 문제/페이지 경계 회귀 검증

### 종료 조건
다음이 모두 만족될 때 종료:
1. 긴 1번 문제가 같은 페이지 오른쪽 단으로 이어진다.
2. 오른쪽 단까지 꽉 차면 다음 페이지 왼쪽 단에서 이어진다.
3. 뒤 문제 번호가 앞질러 나오지 않는다.
4. 저장 PDF와 iframe 미리보기가 일치한다.

### Task 4. 검증 시나리오 확장

**파일:**
- 수정: `tests/exam-paper-browser-pdf-viewer.test.mjs`
- 필요 시 신규 fixture 파일

- [ ] **시나리오 1: 긴 1번 + 짧은 2번/3번/4번**
  - 기대: 1번 남은 본문이 same-page right에 먼저 이어짐
- [ ] **시나리오 2: 긴 3번이 페이지 경계 직전 시작**
  - 기대: left overflow → right continuation → next-page left
- [ ] **시나리오 3: answer-only orphan 금지**
  - 기대: 본문 없이 정답/해설만 먼저 보이는 상태 없음
- [ ] **시나리오 4: 읽기 순서 보존**
  - 기대: 1→2→3→4 순서 유지

---

# 검증 전략

## 정적 검증
- `node --test tests/exam-paper-browser-pdf-viewer.test.mjs`
- `npx eslint src/lib/exam-paper-pdf.ts tests/exam-paper-browser-pdf-viewer.test.mjs`
- `npx tsc --noEmit`

## 수동 검증
1. `시험지+답안 + 2단`
2. 1번 또는 3번을 길게 만든 시험지 사용
3. 같은 페이지 오른쪽 단으로 이어지는지 확인
4. 오른쪽 단이 없을 때만 다음 페이지 왼쪽 단으로 가는지 확인
5. 저장한 PDF와 iframe preview가 같은지 확인

---

# 리스크와 대응

## 리스크 1 — 높이 추정 오차
텍스트 높이 추정이 실제 렌더와 다르면 pagination 결과가 조금 어긋날 수 있다.

**대응:**
- 처음엔 보수적인 높이 추정 사용
- 필요 시 문단/선택지/설명별 보정계수 추가

## 리스크 2 — 구현 복잡도 증가
전용 페이지네이터는 현재보다 복잡하다.

**대응:**
- 범위를 `시험지+답안 + 2단` 전용으로 제한
- 나머지 모드는 기존 경로 유지

## 리스크 3 — pdfmake 자체 한계
최종 렌더는 여전히 pdfmake라서 100% HTML 멀티컬럼처럼 동작하지 않을 수 있다.

**대응:**
- pagination은 앱이 미리 완료한 뒤 pdfmake엔 확정 배치 결과만 전달
- 그래도 한계가 크면 다음 단계로 HTML print/PDF 경로 검토

---

# 최종 성공 기준

아래가 모두 만족될 때 성공이다.
1. 긴 문제가 왼쪽 단을 넘칠 때 **같은 페이지 오른쪽 단으로 먼저 이어진다.**
2. 오른쪽 단도 넘치면 **다음 페이지 왼쪽 단**으로 이어진다.
3. 문제 번호 읽는 순서가 뒤집히지 않는다.
4. 본문 없이 정답/해설만 먼저 나타나지 않는다.
5. iframe 미리보기와 저장 PDF 결과가 일치한다.
6. 각 loop는 검증 통과 후에만 종료된다.
