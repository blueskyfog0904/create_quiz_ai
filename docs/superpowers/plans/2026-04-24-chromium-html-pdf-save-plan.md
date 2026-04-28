# Chromium 기반 HTML PDF 저장 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ExamPaperPdfWorkspace`의 PDF 저장/새 탭 열기 경로를 pdfmake에서 HTML/CSS source of truth + Chromium route로 전환해, 웹 미리보기와 저장 PDF의 레이아웃 드리프트를 제거한다.

**Architecture:** 현재 우측 iframe 미리보기가 생성하는 `buildExamPaperPrintHtml()` 결과를 저장용 source of truth로 삼는다. 클라이언트는 현재 preview와 동일한 HTML을 `/api/exam-papers/print-pdf`로 POST하고, route는 Playwright Chromium으로 PDF buffer를 생성한다. 브라우저 인쇄는 기존 `openExamPaperPrintPreview()`를 유지해 UX를 분리하되, 저장/새 탭 열기만 Chromium path로 통일한다.

**Tech Stack:** Next.js 16 Route Handlers, React client components, existing HTML preview builder (`src/lib/export-utils.ts`), Playwright Chromium, Node test runner, existing Playwright/PDF.js verification scripts

---

## 현재 코드 분석 요약

### 핵심 파일과 현재 역할
- `src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx`
  - iframe preview HTML 생성 (`buildExamPaperPrintHtml`)
  - 현재 저장 버튼은 `buildExamPaperPdfBlob()` + `downloadExamPaperPdf()` 경로 사용
  - 현재 새 탭 버튼도 `openExamPaperPdfInNewTab()` 경로 사용
- `src/lib/export-utils.ts`
  - HTML/CSS 기반 preview/print source of truth
  - 2단 preview는 `buildTwoColumnPreviewPages()`를 통해 shared planner를 사용
- `src/lib/exam-paper-pdf.ts`
  - 현재 direct save 전용 pdfmake renderer
  - 2단도 shared planner를 쓰지만 renderer는 pdfmake라 preview와 다름
- `src/app/api/exam-papers/print-pdf/route.ts`
  - **이미 존재하는** Chromium html→pdf route
  - 하지만 현재 클라이언트에서 호출되지 않음
- `tests/exam-paper-direct-pdf-export.test.mjs`
  - 현재 workspace가 `/api/exam-papers/print-pdf`를 호출하지 않는다고 고정
- `scripts/playwright_verify_saved_pdf_profile.cjs`
  - 실제 Chrome 저장 PDF를 내려받아 PDF.js로 진단하는 저장 경로 harness

### 루트 원인 요약
- 2단 preview와 저장 PDF는 같은 planner를 쓰지만, 실제 renderer가 다르다.
  - preview = HTML/CSS
  - save = pdfmake
- `src/lib/exam-paper-layout-contract.ts`의 `shared-default`는 `preview`/`pdf` 용량(capacity)을 동일하게 사용한다.
- 따라서 현재 2단 하단 여백 과다는 planner보다 **renderer mismatch**가 더 큰 원인이다.

---

## 계획 수립 루프 기록

### Loop 1 — 초안
- 분석 결론:
  - 기존 `/api/exam-papers/print-pdf` route를 재사용할 수 있다.
  - `ExamPaperPdfWorkspace`의 preview HTML이 이미 존재한다.
- 초안 가설:
  - 서버 route가 payload를 받아 다시 `buildExamPaperPrintHtml()`를 호출해 HTML을 재생성한다.
- 검증 결과: **FAIL**
  - 1단 preview는 `measureSingleColumnPreviewPages()`로 **클라이언트 DOM 측정 결과**를 반영한다.
  - 서버에서 동일 HTML을 재조립하면 1단 preview와 완전 동일성을 보장할 수 없다.
  - 근거:
    - `src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx:146-167`
    - `src/lib/exam-paper-single-column-measurement.ts:237-340`

### Loop 2 — 수정안
- 수정 결론:
  - route는 **구조화된 시험지 payload가 아니라, 현재 preview와 동일한 HTML 문자열**을 받는다.
  - 저장/새 탭 열기 전용 client helper를 추가하고, workspace는 `previewHtml`을 route로 POST한다.
  - preview가 갱신 중일 때 저장 버튼을 비활성화해, 사용자가 보고 있는 HTML과 저장 대상 HTML을 일치시킨다.
  - route는 Playwright를 직접 의존성으로 선언하고 `preferCSSPageSize`, `document.fonts.ready`, `Content-Disposition`까지 명시한다.
- 검증 결과: **PASS**
  - 1단/2단 모두 동일 HTML source를 저장 경로로 재사용 가능
  - 기존 route/Playwright harness를 재활용 가능
  - current direct-save test의 회귀 계약을 뒤집는 작업 범위가 명확해짐

---

## File Structure

- Create: `src/lib/exam-paper-html-pdf.ts`
  - 클라이언트 전용 HTML→Chromium PDF fetch helper
  - download / new-tab open / 에러 처리 캡슐화
- Modify: `src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx`
  - 저장/새 탭 열기를 새 helper로 교체
  - preview freshness gate 추가 (`isGeneratingPreview` 동안 저장 비활성화)
- Modify: `src/app/api/exam-papers/print-pdf/route.ts`
  - `fileName`, `disposition` schema 추가
  - Playwright print media / fonts ready / CSS page size 반영
  - 안전한 `Content-Disposition` 반환
- Modify: `package.json`
  - `playwright`를 직접 dependency로 선언
  - verification script 엔트리 추가
- Create: `tests/exam-paper-html-pdf-client.test.mjs`
  - client helper source-level contract test
- Create: `tests/exam-paper-print-pdf-route.test.mjs`
  - route source-level contract test
- Modify: `tests/exam-paper-direct-pdf-export.test.mjs`
  - workspace가 더 이상 pdfmake save helper를 쓰지 않는다고 검증
- Modify: `tests/exam-paper-browser-pdf-viewer.test.mjs`
  - preview source-of-truth + 새 helper wiring 반영
- Create: `tests/pdf-save-verification-script.test.mjs`
  - 저장 harness parameterization / package script 노출 검증
- Modify: `scripts/playwright_verify_saved_pdf_profile.cjs`
  - viewMode / columnLayout / outputPrefix 인자를 받도록 일반화

---

### Task 1: Chromium HTML PDF client/route 계약을 red 테스트로 고정하고 녹인다

**Files:**
- Create: `tests/exam-paper-html-pdf-client.test.mjs`
- Create: `tests/exam-paper-print-pdf-route.test.mjs`
- Modify: `src/app/api/exam-papers/print-pdf/route.ts`
- Create: `src/lib/exam-paper-html-pdf.ts`
- Modify: `package.json`
- Test: `tests/exam-paper-html-pdf-client.test.mjs`
- Test: `tests/exam-paper-print-pdf-route.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// tests/exam-paper-html-pdf-client.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const helperSource = readFileSync(
  new URL('../src/lib/exam-paper-html-pdf.ts', import.meta.url),
  'utf8'
)

test('HTML PDF helper posts preview HTML to the Chromium endpoint and supports download/open flows', () => {
  assert.match(helperSource, /fetch\('\/api\/exam-papers\/print-pdf'/)
  assert.match(helperSource, /body:\s*JSON\.stringify\(\{\s*html,\s*fileName,\s*disposition\s*\}\)/)
  assert.match(helperSource, /saveAs\(blob, fileName\)/)
  assert.match(helperSource, /window\.open\(blobUrl, '_blank'\)/)
  assert.match(helperSource, /URL\.revokeObjectURL\(blobUrl\)/)
})

test('HTML PDF helper surfaces route errors as user-readable exceptions', () => {
  assert.match(helperSource, /const payload = await response\.json\(\)\.catch\(\(\) => null\)/)
  assert.match(helperSource, /throw new Error\(payload\?\.message \?\? 'PDF 저장 중 오류가 발생했습니다\.'/)
})
```

```js
// tests/exam-paper-print-pdf-route.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const routeSource = readFileSync(
  new URL('../src/app/api/exam-papers/print-pdf/route.ts', import.meta.url),
  'utf8'
)

test('print-pdf route validates html, fileName and disposition before rendering Chromium PDF', () => {
  assert.match(routeSource, /html: z\.string\(\)\.min\(1\)/)
  assert.match(routeSource, /fileName: z\.string\(\)\.min\(1\)\.max\(200\)\.optional\(\)/)
  assert.match(routeSource, /disposition: z\.enum\(\['attachment', 'inline'\]\)\.default\('attachment'\)/)
})

test('print-pdf route waits for print media and css page size before returning the PDF', () => {
  assert.match(routeSource, /await page\.emulateMedia\(\{\s*media: 'print'\s*\}\)/)
  assert.match(routeSource, /document\.fonts\.ready/)
  assert.match(routeSource, /preferCSSPageSize:\s*true/)
  assert.match(routeSource, /printBackground:\s*true/)
  assert.match(routeSource, /Content-Disposition/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
node --test tests/exam-paper-html-pdf-client.test.mjs tests/exam-paper-print-pdf-route.test.mjs
```

Expected: FAIL because `src/lib/exam-paper-html-pdf.ts` does not exist and the route still only accepts `{ html }`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/lib/exam-paper-html-pdf.ts
import { saveAs } from 'file-saver'

type PdfDisposition = 'attachment' | 'inline'

interface RequestExamPaperHtmlPdfInput {
  html: string
  fileName: string
  disposition?: PdfDisposition
}

export async function requestExamPaperHtmlPdf({
  html,
  fileName,
  disposition = 'attachment',
}: RequestExamPaperHtmlPdfInput): Promise<Blob> {
  const response = await fetch('/api/exam-papers/print-pdf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ html, fileName, disposition }),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.message ?? 'PDF 저장 중 오류가 발생했습니다.')
  }

  return response.blob()
}

export async function downloadExamPaperHtmlPdf(input: Omit<RequestExamPaperHtmlPdfInput, 'disposition'>) {
  const blob = await requestExamPaperHtmlPdf({
    ...input,
    disposition: 'attachment',
  })

  saveAs(blob, input.fileName)
}

export async function openExamPaperHtmlPdfInNewTab(input: Omit<RequestExamPaperHtmlPdfInput, 'disposition'>) {
  const blob = await requestExamPaperHtmlPdf({
    ...input,
    disposition: 'inline',
  })
  const blobUrl = URL.createObjectURL(blob)
  const previewWindow = window.open(blobUrl, '_blank')

  if (!previewWindow) {
    URL.revokeObjectURL(blobUrl)
    throw new Error('팝업 차단으로 인해 PDF 미리보기 창을 열 수 없습니다. 팝업을 허용해주세요.')
  }

  setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60 * 1000)
}
```

```ts
// src/app/api/exam-papers/print-pdf/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PrintPdfSchema = z.object({
  html: z.string().min(1),
  fileName: z.string().min(1).max(200).optional(),
  disposition: z.enum(['attachment', 'inline']).default('attachment'),
})

function toSafePdfFileName(fileName?: string) {
  const normalized = (fileName ?? 'exam-paper.pdf')
    .replace(/[\r\n"]/g, '')
    .replace(/[\\/]/g, '-')
    .trim()

  if (!normalized) {
    return 'exam-paper.pdf'
  }

  return normalized.toLowerCase().endsWith('.pdf') ? normalized : `${normalized}.pdf`
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const validation = PrintPdfSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
    }

    const { html, fileName, disposition } = validation.data
    const safeFileName = toSafePdfFileName(fileName)

    const { chromium } = await import('playwright')
    const browser = await chromium.launch({ headless: true })

    try {
      const page = await browser.newPage()
      await page.emulateMedia({ media: 'print' })
      await page.setContent(html, { waitUntil: 'load' })
      await page.evaluate(async () => {
        if ('fonts' in document) {
          await document.fonts.ready
        }
      })

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: false,
      })

      return new NextResponse(pdfBuffer.buffer as ArrayBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(safeFileName)}`,
        },
      })
    } finally {
      await browser.close()
    }
  } catch (error) {
    console.error('PDF generation error:', error)
    return NextResponse.json(
      {
        error: 'PDF_GENERATION_FAILED',
        message: error instanceof Error ? error.message : 'PDF 생성 실패',
      },
      { status: 500 }
    )
  }
}
```

```json
// package.json (relevant diff only)
{
  "scripts": {
    "dev": "next dev -p 4000",
    "build": "next build",
    "start": "next start -p 4000",
    "lint": "eslint"
  },
  "dependencies": {
    "playwright": "^1.60.0"
  }
}
```

Then install the direct runtime dependency:

```bash
npm install playwright --save
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
node --test tests/exam-paper-html-pdf-client.test.mjs tests/exam-paper-print-pdf-route.test.mjs
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/exam-paper-html-pdf.ts src/app/api/exam-papers/print-pdf/route.ts tests/exam-paper-html-pdf-client.test.mjs tests/exam-paper-print-pdf-route.test.mjs
cat > /tmp/task1-lore-commit.txt <<'EOF'
Make Chromium HTML PDF generation a first-class runtime path

The repository already contained an html->pdf route, but it was not
validated or surfaced as the canonical save transport. This change
locks the route/helper contract first so subsequent workspace rewiring can
swap renderers without guessing.

Constraint: The route already imports Playwright at runtime, so the package must be a direct dependency rather than a transitive dev-only artifact
Rejected: Keep accepting only raw html without filename/disposition metadata | save/new-tab UX would stay ambiguous
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep this helper HTML-first; do not reintroduce layout decisions here
Tested: node --test tests/exam-paper-html-pdf-client.test.mjs tests/exam-paper-print-pdf-route.test.mjs
Not-tested: Real browser save flow
EOF
git commit -F /tmp/task1-lore-commit.txt
```

---

### Task 2: PDF workspace 저장/새 탭 열기를 preview HTML source of truth로 전환

**Files:**
- Modify: `src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx`
- Modify: `tests/exam-paper-direct-pdf-export.test.mjs`
- Modify: `tests/exam-paper-browser-pdf-viewer.test.mjs`
- Test: `tests/exam-paper-direct-pdf-export.test.mjs`
- Test: `tests/exam-paper-browser-pdf-viewer.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// tests/exam-paper-direct-pdf-export.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const workspaceSource = readFileSync(
  new URL('../src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx', import.meta.url),
  'utf8'
)

test('ExamPaperPdfWorkspace routes PDF save and new-tab open through the Chromium HTML PDF endpoint', () => {
  assert.match(workspaceSource, /from '@\/lib\/exam-paper-html-pdf'/)
  assert.match(workspaceSource, /buildExamPaperPrintHtml/)
  assert.match(
    workspaceSource,
    /const handleSavePdf = async \(\) => \{[\s\S]*?const fileName = `\$\{previewTitle\}\.pdf`[\s\S]*?const html = previewHtml[\s\S]*?await downloadExamPaperHtmlPdf\(\{ html, fileName \}\)/
  )
  assert.match(
    workspaceSource,
    /const handleOpenPdfInNewTab = async \(\) => \{[\s\S]*?const fileName = `\$\{previewTitle\}\.pdf`[\s\S]*?const html = previewHtml[\s\S]*?await openExamPaperHtmlPdfInNewTab\(\{ html, fileName \}\)/
  )
  assert.doesNotMatch(workspaceSource, /buildExamPaperPdfBlob/)
  assert.doesNotMatch(workspaceSource, /openExamPaperPdfInNewTab/)
})
```

```js
// tests/exam-paper-browser-pdf-viewer.test.mjs (append one new test)
test('PDF workspace keeps preview HTML as the save source of truth while preview is fresh', () => {
  assert.match(workspaceSource, /const html = previewHtml/)
  assert.match(workspaceSource, /disabled=\{isSavingPdf \|\| isOpeningPdfTab \|\| isGeneratingPreview\}/)
  assert.match(workspaceSource, /disabled=\{isOpeningPdfTab \|\| isSavingPdf \|\| isGeneratingPreview\}/)
  assert.match(workspaceSource, /buildExamPaperPrintHtml\(exportPayload, \{/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
node --test tests/exam-paper-direct-pdf-export.test.mjs tests/exam-paper-browser-pdf-viewer.test.mjs
```

Expected: FAIL because the workspace still imports `@/lib/exam-paper-pdf` and still calls `buildExamPaperPdfBlob()`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx (relevant diff only)
import {
  buildExamPaperPrintHtml,
  openExamPaperPrintPreview,
  type ColumnLayout as ExamPaperPdfColumnLayout,
  type ExamPaper as ExamPaperPrintDocument,
  type Question as ExamPaperPdfQuestion,
  type ViewMode as ExamPaperPdfViewMode,
} from '@/lib/export-utils'
import {
  downloadExamPaperHtmlPdf,
  openExamPaperHtmlPdfInNewTab,
} from '@/lib/exam-paper-html-pdf'

// remove import from '@/lib/exam-paper-pdf'

const handleSavePdf = async () => {
  setIsSavingPdf(true)

  try {
    const fileName = `${previewTitle}.pdf`
    const html = previewHtml

    if (!html) {
      throw new Error('PDF 미리보기가 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.')
    }

    await downloadExamPaperHtmlPdf({ html, fileName })
    toast.success('PDF 파일 다운로드를 시작했습니다.')
  } catch (error) {
    console.error('Chromium HTML PDF save error:', error)
    toast.error(error instanceof Error ? error.message : 'PDF 저장 중 오류가 발생했습니다.')
  } finally {
    setIsSavingPdf(false)
  }
}

const handleOpenPdfInNewTab = async () => {
  setIsOpeningPdfTab(true)

  try {
    const fileName = `${previewTitle}.pdf`
    const html = previewHtml

    if (!html) {
      throw new Error('PDF 미리보기가 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.')
    }

    await openExamPaperHtmlPdfInNewTab({ html, fileName })
  } catch (error) {
    console.error('Chromium HTML PDF new tab error:', error)
    toast.error(error instanceof Error ? error.message : 'PDF 새 탭 열기 중 오류가 발생했습니다.')
  } finally {
    setIsOpeningPdfTab(false)
  }
}
```

```tsx
// src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx (button disable states only)
<Button
  type="button"
  variant="outline"
  className="gap-2"
  disabled={isOpeningPdfTab || isSavingPdf || isGeneratingPreview}
  onClick={handleOpenPdfInNewTab}
>
  {isOpeningPdfTab ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
  새 탭에서 열기
</Button>
<Button
  type="button"
  className="gap-2"
  disabled={isSavingPdf || isOpeningPdfTab || isGeneratingPreview}
  onClick={handleSavePdf}
>
  {isSavingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
  PDF 저장
</Button>
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
node --test tests/exam-paper-direct-pdf-export.test.mjs tests/exam-paper-browser-pdf-viewer.test.mjs
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx tests/exam-paper-direct-pdf-export.test.mjs tests/exam-paper-browser-pdf-viewer.test.mjs
cat > /tmp/task2-lore-commit.txt <<'EOF'
Make the workspace save exactly what the preview renders

The PDF workspace already computes the exact preview HTML, including
single-column measurement and two-column planner output. Reusing that
HTML for save/new-tab removes the renderer split that caused layout
parity drift.

Constraint: Save must not race ahead of preview regeneration or it can serialize stale HTML
Rejected: Rebuild the HTML again inside the route from structured payload | would lose client-side single-column measurement parity
Confidence: high
Scope-risk: moderate
Reversibility: clean
Directive: Keep print preview behavior unchanged; only save/new-tab should hit the Chromium endpoint in this migration
Tested: node --test tests/exam-paper-direct-pdf-export.test.mjs tests/exam-paper-browser-pdf-viewer.test.mjs
Not-tested: Real browser save flow
EOF
git commit -F /tmp/task2-lore-commit.txt
```

---

### Task 3: 저장 검증 harness를 first-class gate로 끌어올린다

**Files:**
- Modify: `scripts/playwright_verify_saved_pdf_profile.cjs`
- Create: `tests/pdf-save-verification-script.test.mjs`
- Modify: `package.json`
- Test: `tests/pdf-save-verification-script.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/pdf-save-verification-script.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const saveVerifyScriptSource = readFileSync(
  new URL('../scripts/playwright_verify_saved_pdf_profile.cjs', import.meta.url),
  'utf8'
)
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
)

test('saved PDF verification script accepts view mode and layout arguments', () => {
  assert.match(saveVerifyScriptSource, /const viewMode = process\.argv\[3\] \|\| 'exam-with-answers'/)
  assert.match(saveVerifyScriptSource, /const columnLayout = process\.argv\[4\] \|\| 'double'/)
  assert.match(saveVerifyScriptSource, /const outputPrefix = process\.argv\[5\] \|\|/)
  assert.match(saveVerifyScriptSource, /시험지\+답안|시험지|답안/)
  assert.match(saveVerifyScriptSource, /1단|2단/)
})

test('package.json exposes preview/save verification commands', () => {
  assert.equal(packageJson.scripts['verify:pdf-preview'], 'node scripts/playwright_verify_pdf_workspace_route_profile.cjs')
  assert.equal(packageJson.scripts['verify:pdf-save'], 'node scripts/playwright_verify_saved_pdf_profile.cjs')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
node --test tests/pdf-save-verification-script.test.mjs
```

Expected: FAIL because the save verification script is still hard-coded to `시험지+답안` + `2단`, and `package.json` has no verification script entries.

- [ ] **Step 3: Write the minimal implementation**

```js
// scripts/playwright_verify_saved_pdf_profile.cjs (relevant diff only)
const targetUrl = process.argv[2] || 'http://127.0.0.1:4000/english/library/exam-papers/5a154084-ec01-4780-933e-394fbc9dfd02'
const viewMode = process.argv[3] || 'exam-with-answers'
const columnLayout = process.argv[4] || 'double'
const outputPrefix = process.argv[5] || `${viewMode}-${columnLayout}`

const VIEW_MODE_LABEL = {
  'exam-only': '시험지',
  'answer-only': '답안',
  'exam-with-answers': '시험지+답안',
}

const COLUMN_LAYOUT_LABEL = {
  single: '1단',
  double: '2단',
}

async function openPdfWorkspace(page, { viewMode, columnLayout }) {
  const pdfButton = page.getByRole('button', { name: /PDF로 저장/ })
  await pdfButton.waitFor({ state: 'visible', timeout: 15000 })
  await pdfButton.click()

  await page.getByText('PDF 저장 설정').waitFor({ state: 'visible', timeout: 15000 })

  await page.getByRole('button', { name: VIEW_MODE_LABEL[viewMode] }).click()
  await page.getByRole('button', { name: COLUMN_LAYOUT_LABEL[columnLayout] }).click()
  await page.waitForTimeout(1500)
}

// inside main()
await openPdfWorkspace(page, { viewMode, columnLayout })
await page.screenshot({ path: `output_gui_pdf_workspace_${outputPrefix}.png`, fullPage: true })
```

```json
// package.json (relevant diff only)
{
  "scripts": {
    "dev": "next dev -p 4000",
    "build": "next build",
    "start": "next start -p 4000",
    "lint": "eslint",
    "verify:pdf-preview": "node scripts/playwright_verify_pdf_workspace_route_profile.cjs",
    "verify:pdf-save": "node scripts/playwright_verify_saved_pdf_profile.cjs"
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
node --test tests/pdf-save-verification-script.test.mjs
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json scripts/playwright_verify_saved_pdf_profile.cjs tests/pdf-save-verification-script.test.mjs
cat > /tmp/task3-lore-commit.txt <<'EOF'
Promote Chromium save verification from ad hoc script to explicit gate

The migration is only safe if the repository keeps a repeatable browser
harness for real saved PDFs, not just stubbed node tests. This change
turns the save script into a parameterized verification surface and
exposes it through package scripts.

Constraint: The save harness must continue to work against the existing Chrome/CDP workflow already used in this repo
Rejected: Keep a single hard-coded 시험지+답안 2단 scenario | migration risk spans more than one mode/layout combination
Confidence: medium
Scope-risk: narrow
Reversibility: clean
Directive: If save parity regresses again, extend this harness before changing layout code
Tested: node --test tests/pdf-save-verification-script.test.mjs
Not-tested: Live Chrome/CDP run
EOF
git commit -F /tmp/task3-lore-commit.txt
```

---

## Verification Steps

1. **Node regression suite**

Run:
```bash
node --test \
  tests/exam-paper-html-pdf-client.test.mjs \
  tests/exam-paper-print-pdf-route.test.mjs \
  tests/exam-paper-direct-pdf-export.test.mjs \
  tests/exam-paper-browser-pdf-viewer.test.mjs \
  tests/exam-paper-pdf-pagination.test.mjs \
  tests/exam-paper-pdf-pagination-regression.test.mjs \
  tests/exam-paper-saved-pdf-parity.test.mjs \
  tests/ocr-preview-stage-auto-pdf-mode.test.mjs \
  tests/saved-pdf-pdfjs-diagnostic-script.test.mjs \
  tests/pdf-save-verification-script.test.mjs
```

Expected:
- PASS
- `ExamPaperPdfWorkspace` source tests now assert HTML route usage
- existing preview/pagination regression tests remain green

2. **Lint**

Run:
```bash
npm run lint -- src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx src/lib/exam-paper-html-pdf.ts src/app/api/exam-papers/print-pdf/route.ts tests/exam-paper-html-pdf-client.test.mjs tests/exam-paper-print-pdf-route.test.mjs tests/exam-paper-direct-pdf-export.test.mjs tests/exam-paper-browser-pdf-viewer.test.mjs tests/pdf-save-verification-script.test.mjs scripts/playwright_verify_saved_pdf_profile.cjs
```

Expected: exit code 0

3. **Typecheck**

Run:
```bash
npx tsc --noEmit --pretty false
```

Expected: exit code 0

4. **Preview matrix smoke**

Run:
```bash
npm run verify:pdf-preview -- http://127.0.0.1:4000/english/library/exam-papers/9a554084-ec01-4780-933e-39f4bc9dfa02
```

Expected:
- preview matrix completes without login redirect
- no empty page / overflow anomalies
- route verification screenshots emitted under `output_route_verify_*`

5. **Real saved PDF smoke — 2단 핵심 시나리오**

Run:
```bash
npm run verify:pdf-save -- http://127.0.0.1:4000/english/library/exam-papers/9a554084-ec01-4780-933e-39f4bc9dfa02 exam-with-answers double chromium-double
```

Expected:
- actual `.pdf` appears in `~/Downloads`
- `output_gui_pdf_workspace_chromium-double.png` generated
- `output_saved_pdf_page1.png`, `output_saved_pdf_page3.png`, `output_saved_pdf_page6.png` generated
- PDF.js render step succeeds without exception

6. **Real saved PDF smoke — 1단 보호 시나리오**

Run:
```bash
npm run verify:pdf-save -- http://127.0.0.1:4000/english/library/exam-papers/9a554084-ec01-4780-933e-39f4bc9dfa02 exam-only single chromium-single
```

Expected:
- actual `.pdf` appears in `~/Downloads`
- `output_gui_pdf_workspace_chromium-single.png` generated
- PDF.js render step succeeds without exception

---

## Acceptance Criteria

- `ExamPaperPdfWorkspace`가 더 이상 `src/lib/exam-paper-pdf.ts`의 pdfmake save helper를 import하지 않는다.
- 저장 버튼과 새 탭 버튼이 `/api/exam-papers/print-pdf` Chromium route를 사용한다.
- route가 `page.emulateMedia({ media: 'print' })`, `document.fonts.ready`, `preferCSSPageSize: true`를 명시한다.
- 사용자가 보고 있는 `previewHtml`이 저장 source of truth로 사용되며, preview 갱신 중에는 저장/새 탭 열기가 비활성화된다.
- 기존 preview/pagination 관련 Node tests가 그대로 green을 유지한다.
- 실제 saved PDF harness가 최소 1개의 2단 시나리오와 1개의 1단 시나리오에서 성공한다.
- 현재 2단 저장 경로의 layout parity는 더 이상 pdfmake renderer에 의존하지 않는다.

---

## Self-Review

### 1. Spec coverage
- 현재 코드 분석 파악: `현재 코드 분석 요약` + `계획 수립 루프 기록`에 반영 완료
- 1순위 계획 수립: HTML/CSS source of truth + Chromium route 전환으로 일관되게 정의 완료
- 계획 검증 loop: Loop 1 FAIL → Loop 2 PASS를 명시했고, 최종 verification bundle도 정의 완료

### 2. Placeholder scan
- 금지 placeholder 패턴 없음
- 각 코드 step에 실제 파일/코드/명령 포함

### 3. Type consistency
- client helper 이름은 전 구간 `requestExamPaperHtmlPdf`, `downloadExamPaperHtmlPdf`, `openExamPaperHtmlPdfInNewTab`로 통일
- route payload 키는 전 구간 `html`, `fileName`, `disposition`으로 통일
- workspace source-of-truth 변수는 전 구간 `previewHtml`로 통일

### 검증 판정
- **PASS** — 이 계획은 현재 코드 구조, 1단 측정 제약, 기존 Chromium route 재사용 가능성, 저장 harness 부족 문제를 모두 반영한다.
