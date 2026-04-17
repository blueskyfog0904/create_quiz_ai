# 브라우저 내장 PDF Viewer 기반 문제지 미리보기/저장 UX 구현 계획

> **에이전트 작업 지침:** 이 계획은 체크박스(`- [ ]`) 단위로 실행합니다. 각 단계는 **분석 → 계획 → 구현 → 검증** loop를 따르며, 검증을 통과했을 때만 다음 단계로 진행합니다.

**목표:** 문제지 관리에서 `PDF로 저장` 클릭 시, 브라우저 내장 PDF viewer에 가까운 방식으로 문제지 PDF를 육안 확인하고 `다운로드 / 출력`까지 한 번에 처리할 수 있는 UX를 제공한다.

**아키텍처:** 현재 `exportToPDF()`는 print용 HTML을 새 창에 쓰고 즉시 `window.print()`를 호출한다. 브라우저 내장 PDF viewer 방식으로 가려면, 먼저 문제지 내용을 **실제 PDF 파일 또는 브라우저가 PDF처럼 표시할 수 있는 자산**으로 만들어 새 창/탭/iframe에 로드해야 한다. 1차 구현에서는 현재 구조와 충돌이 적은 방식부터 시작하고, 필요 시 2차에서 더 안정적인 PDF 생성 경로로 확장한다.

**기술 스택:** Next.js App Router, TypeScript, 브라우저 내장 PDF viewer(탭/iframe), 기존 export-utils, 선택적으로 서버 PDF 생성 경로

---

## 현재 상태 요약

현재 문제지 관리의 PDF 버튼 동작:
1. `exportToPDF()` 호출
2. 새 창 열기
3. print용 HTML 작성
4. 즉시 `window.print()` 호출

현재 구조의 특징:
- 브라우저 내장 PDF viewer를 쓰지 않음
- 썸네일/검색/줌/출력 UI가 브라우저 기본 UI와 연결되어 있지 않음
- 사용자가 인쇄 전에 자연스럽게 미리보기하는 흐름이 약함

관련 파일:
- `src/app/(dashboard)/library/exam-papers/[id]/export-buttons.tsx`
- `src/lib/export-utils.ts`

---

## 핵심 판단

브라우저 내장 PDF viewer를 쓰려면, 결국 브라우저가 열 수 있는 **진짜 PDF 파일(URL 또는 blob URL)** 이 필요하다.
즉 1차 단계에서 가장 먼저 해결해야 할 것은:

- **현재 print HTML 흐름을 그대로 띄우는 게 아니라**
- 브라우저가 PDF로 인식할 수 있는 자산을 만들고
- 그 자산을 새 탭/iframe으로 열어 기본 PDF UI를 사용하는 것

---

# Loop 1 — 현재 구조로 가능한 최소 브라우저 내장 viewer 흐름 만들기

## 종료 조건
다음이 모두 만족될 때 Loop 1 종료:
1. `PDF로 저장` 클릭 시 브라우저 내장 PDF viewer 또는 그에 준하는 새 창 미리보기 흐름으로 진입한다.
2. 사용자가 바로 다운로드/출력을 할 수 있다.
3. 기존 즉시 인쇄보다 UX가 명확히 개선된다.
4. lint/typecheck/기본 수동 검증을 통과한다.

---

### Task 1. 현재 `exportToPDF()` 경로를 “즉시 print”에서 “미리보기 중심”으로 완화

**파일:**
- 수정: `src/lib/export-utils.ts`
- 수정: `src/app/(dashboard)/library/exam-papers/[id]/export-buttons.tsx`
- 필요 시 `src/app/(dashboard)/exam-papers/[id]/export-buttons.tsx`

- [ ] **Step 1: 현재 자동 print 제거 여부 판단**

현재는 새 창을 열자마자 인쇄한다.
브라우저 viewer처럼 보이려면 최소한:
- 자동 print 제거
- 사용자가 새 창 안 내용을 본 후 직접 다운로드/출력하게 해야 한다.

- [ ] **Step 2: print용 새 창을 “즉시 인쇄창”이 아니라 “미리보기 창”으로 전환**

즉시 `window.print()` 제거 후:
- 툴바/다운로드/출력 버튼이 포함된 HTML 셸 제공
- 사용자가 직접 출력 버튼을 누르도록 변경

이 단계는 “브라우저 내장 PDF viewer처럼 보이는 방향으로 UX를 우선 개선”하는 최소안이다.

- [ ] **Step 3: 버튼 명칭/UX 정리**

`PDF로 저장` 클릭 시:
- 새 창/미리보기 탭 오픈
- 그 안에서
  - `다운로드`
  - `출력`
  - `닫기`
  동작 가능

---

### Task 2. 브라우저가 직접 여는 PDF 자산 경로 검토

**파일:**
- 수정: `src/lib/export-utils.ts`
- 필요 시 신규 API route

- [ ] **Step 1: 브라우저 내장 PDF viewer를 쓰려면 실제 PDF blob/url이 필요한지 확인**

판단 기준:
- HTML 문서를 새 창에 띄우는 것만으로는 브라우저 기본 PDF 툴바(썸네일, 검색, 다운로드, 출력)가 나오지 않는다.
- 따라서 진짜 PDF asset이 필요함.

- [ ] **Step 2: 1차 구현에서 실제 PDF를 만들 수 있는 최소 경로 선택**

선택지:
1. 현재 print HTML 유지 → viewer 비슷한 커스텀 창만 제공
2. 실제 PDF blob 생성 → 브라우저가 기본 PDF viewer로 열게 함

**권장:**
- 브라우저 내장 viewer를 진짜 쓰려면 결국 **2번**이 필요함.
- 따라서 1차는 “최소 구현”이라도 PDF blob 생성 경로가 있어야 한다.

---

### Task 3. Loop 1 검증

**수동 검증:**
- [ ] 문제지 관리 상세 페이지 진입
- [ ] `PDF로 저장` 클릭
- [ ] 기존처럼 즉시 인쇄되지 않고 미리보기 흐름으로 진입
- [ ] 사용자가 다운로드/출력을 직접 선택 가능
- [ ] 브라우저 탭/창 UX가 이전보다 예측 가능

**정적 검증:**
- [ ] `npx eslint <관련 파일>`
- [ ] `npx tsc --noEmit`

**실패 시 반복 규칙:**
- 새 창이 여전히 즉시 print 되면 → 분석 후 자동 print 제거 재적용
- 다운로드/출력 버튼이 불안정하면 → 버튼 핸들러 구조 수정
- UX가 브라우저 viewer에 가깝지 않으면 → Loop 2로 이동

---

# Loop 2 — 실제 브라우저 내장 PDF viewer를 사용하도록 PDF 자산 생성 경로 도입

## 종료 조건
다음이 모두 만족될 때 종료:
1. 브라우저 내장 PDF viewer가 뜬다.
2. 다운로드/출력은 브라우저 기본 PDF UI로 가능하다.
3. PDF 렌더 결과가 문제지 내용과 일치한다.
4. 한글이 정상 표시된다.

---

### Task 4. 브라우저가 여는 실제 PDF 자산 생성 경로 도입

**파일:**
- 수정: `src/lib/export-utils.ts`
- 필요 시 신규 route: `src/app/api/exam-papers/[id]/pdf/route.ts`
- 수정: export button 파일들

- [ ] **Step 1: PDF blob 또는 다운로드 가능한 PDF URL 생성**

브라우저 내장 viewer는 다음 중 하나를 열어야 한다.
- blob URL
- 같은 origin의 PDF URL

- [ ] **Step 2: 새 탭에서 PDF URL/blob URL 열기**

예:
```ts
const blobUrl = URL.createObjectURL(pdfBlob)
window.open(blobUrl, '_blank')
```

이렇게 하면 브라우저 내장 PDF viewer가 개입할 수 있다.

- [ ] **Step 3: 기존 HTML print 경로와 충돌 없게 정리**

- `print-friendly HTML` 경로는 점진적으로 제거하거나 fallback으로만 유지
- “PDF로 저장”은 PDF 자산 기반 경로 하나로 수렴

---

### Task 5. Loop 2 검증

**수동 검증:**
- [ ] 새 탭에서 브라우저 기본 PDF viewer가 열리는지
- [ ] 기본 다운로드 버튼이 보이는지
- [ ] 기본 출력 버튼이 보이는지
- [ ] 좌측 썸네일/검색 같은 브라우저 기본 기능이 노출되는지 (브라우저마다 차이 확인)
- [ ] 한글이 깨지지 않는지

**정적 검증:**
- [ ] `npx eslint <관련 파일>`
- [ ] `npx tsc --noEmit`

**실패 시 반복 규칙:**
- PDF asset 생성 실패 → blob/route 생성 경로 재분석
- 브라우저가 viewer 대신 다운로드만 하면 → blob URL/response headers 점검
- 한글 깨짐이 있으면 → 폰트 embed 경로 재분석

---

# Loop 3 — Google Drive 저장 연동 (후속 단계)

## 종료 조건
다음이 모두 만족될 때 종료:
1. Google Drive 저장이 실제 업로드까지 된다.
2. OAuth/권한 에러를 처리한다.
3. 실패 시 사용자에게 재시도 경로를 제공한다.

---

### Task 6. Google Drive 저장은 별도 단계로 분리

이 단계는 브라우저 내장 viewer와 별개입니다.
이유:
- viewer는 브라우저 기능
- Drive 저장은 Google OAuth/API 기능

즉, 브라우저 viewer 구현이 끝난 뒤에만 진행합니다.

- [ ] Google OAuth 설정
- [ ] Drive API 업로드 경로 설계
- [ ] 저장 후 링크 또는 성공 상태 제공

---

# 권장 결론

## 가장 현실적인 구현 순서
1. **Loop 1**: 즉시 print 제거 + 미리보기 흐름 정리
2. **Loop 2**: 실제 PDF asset을 브라우저 내장 PDF viewer로 열기
3. **Loop 3**: Google Drive 저장

## 핵심 포인트
브라우저 내장 PDF viewer를 “진짜로” 쓰려면 결국:
- **브라우저가 열 수 있는 실제 PDF**가 필요합니다.

즉, 최종적으로는
> `print HTML`이 아니라 `PDF blob / PDF route`
로 가야 합니다.

---

# 최종 성공 기준

이 계획은 다음이 모두 만족될 때 성공입니다.
1. `PDF로 저장`이 더 이상 즉시 인쇄가 아니라 미리보기 기반 UX를 제공한다.
2. 최종적으로 브라우저 내장 PDF viewer를 사용할 수 있다.
3. 다운로드/출력이 자연스럽게 이어진다.
4. Google Drive 저장은 별도 단계로 분리되어 리스크가 통제된다.
5. 각 loop는 검증 통과 후에만 종료된다.
