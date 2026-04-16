# Selected Region Extraction Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `선택 영역 추출` in 지문 관리 및 추가 extract only the user-selected passage area instead of leaking neighboring passages from the full page.

**Architecture:** Replace the current “full page + dimmed overlay” visual extraction path with a deterministic crop pipeline. Visual mode should build one cropped image per selection, send only those crops to OCR, and keep auto mode unchanged. Add geometry helpers and tests so zoom/padding/clamping logic is verifiable outside the React component.

**Tech Stack:** Next.js App Router, React client components, TypeScript, react-pdf, Supabase server actions, Gemini OCR prompt flow, Node test runner, ESLint

---

## File Map

### Create
- `src/lib/ocr/selection-crop.ts` — pure helpers for converting user selections into intrinsic crop rectangles and rendering crop blobs
- `tests/selection-crop.test.mjs` — unit tests for crop math (scale, padding, clamping, ordering)

### Modify
- `src/components/features/passages/ocr-preview-stage.tsx` — switch visual extraction from full-page overlay prompt to selection crop pipeline
- `src/app/api/ocr/actions.ts` — simplify visual-mode OCR prompt for cropped inputs and keep auto mode separate
- `docs/superpowers/plans/2026-04-16-selected-region-extraction-hardening.md` — update checklist progress only while implementing

---

## Root Cause Summary

Current visual extraction does **not** crop the selected region. `mergeImageWithSelections()` redraws the entire source page, dims non-selected areas, draws borders, then uploads the whole page image. The OCR prompt asks Gemini to ignore dimmed text, but the model can still read it, so nearby passages leak into the result.

Therefore the fix must remove prompt-reliant “attention control” and replace it with real crop isolation.

---

### Task 1: Isolate and test crop geometry logic

**Files:**
- Create: `src/lib/ocr/selection-crop.ts`
- Test: `tests/selection-crop.test.mjs`

- [ ] **Step 1: Add a pure helper for intrinsic crop rectangle calculation**

```ts
export interface SelectionRect {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface IntrinsicSize {
  width: number
  height: number
}

export interface VisualSize {
  width: number
  height: number
}

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export function selectionToCropRect(
  selection: SelectionRect,
  visualSize: VisualSize,
  intrinsicSize: IntrinsicSize,
  padding = 12
): CropRect {
  const scaleX = intrinsicSize.width / visualSize.width
  const scaleY = intrinsicSize.height / visualSize.height

  const rawX = selection.x * scaleX
  const rawY = selection.y * scaleY
  const rawWidth = selection.width * scaleX
  const rawHeight = selection.height * scaleY

  const x = Math.max(0, Math.floor(rawX - padding))
  const y = Math.max(0, Math.floor(rawY - padding))
  const maxX = Math.min(intrinsicSize.width, Math.ceil(rawX + rawWidth + padding))
  const maxY = Math.min(intrinsicSize.height, Math.ceil(rawY + rawHeight + padding))

  return {
    x,
    y,
    width: Math.max(1, maxX - x),
    height: Math.max(1, maxY - y),
  }
}
```

- [ ] **Step 2: Add a helper for building ordered crop rectangles from selections**

```ts
export function buildOrderedCropRects(
  selections: SelectionRect[],
  visualSize: VisualSize,
  intrinsicSize: IntrinsicSize,
  padding = 12
): CropRect[] {
  return [...selections]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((selection) => selectionToCropRect(selection, visualSize, intrinsicSize, padding))
}
```

- [ ] **Step 3: Write crop-math tests before wiring React code**

```js
test('selectionToCropRect converts visual coordinates into intrinsic coordinates with padding', () => {
  const rect = selectionToCropRect(
    { id: 's1', x: 100, y: 200, width: 300, height: 120 },
    { width: 800, height: 1000 },
    { width: 1600, height: 2000 },
    10
  )

  assert.deepEqual(rect, {
    x: 190,
    y: 390,
    width: 620,
    height: 260,
  })
})

test('selectionToCropRect clamps to image boundaries', () => {
  const rect = selectionToCropRect(
    { id: 's1', x: 5, y: 5, width: 40, height: 30 },
    { width: 100, height: 100 },
    { width: 1000, height: 1000 },
    20
  )

  assert.equal(rect.x, 30)
  assert.equal(rect.y, 30)
  assert.ok(rect.width > 0)
  assert.ok(rect.height > 0)
})

test('buildOrderedCropRects preserves top-to-bottom selection order', () => {
  const rects = buildOrderedCropRects([
    { id: 'b', x: 100, y: 400, width: 100, height: 50 },
    { id: 'a', x: 100, y: 100, width: 100, height: 50 },
  ], { width: 800, height: 1000 }, { width: 1600, height: 2000 })

  assert.equal(rects.length, 2)
  assert.ok(rects[0].y < rects[1].y)
})
```

- [ ] **Step 4: Run focused tests to lock the geometry contract**

Run: `node --test tests/selection-crop.test.mjs`

Expected: PASS

---

### Task 2: Replace visual-mode full-page overlay extraction with actual crop blobs

**Files:**
- Modify: `src/components/features/passages/ocr-preview-stage.tsx`
- Create/Modify: `src/lib/ocr/selection-crop.ts`

- [ ] **Step 1: Replace `mergeImageWithSelections()` for visual mode with crop generation**

Introduce a crop helper:

```ts
export async function buildSelectionCropBlobs(options: {
  sourceElement: HTMLCanvasElement | HTMLImageElement
  selections: SelectionRect[]
  visualSize: VisualSize
  padding?: number
}): Promise<Blob[]> {
  const { sourceElement, selections, visualSize, padding = 12 } = options

  const intrinsicSize = sourceElement instanceof HTMLCanvasElement
    ? { width: sourceElement.width, height: sourceElement.height }
    : { width: sourceElement.naturalWidth, height: sourceElement.naturalHeight }

  const cropRects = buildOrderedCropRects(selections, visualSize, intrinsicSize, padding)

  return Promise.all(cropRects.map(async (rect) => {
    const canvas = document.createElement('canvas')
    canvas.width = rect.width
    canvas.height = rect.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('crop canvas context unavailable')

    ctx.drawImage(
      sourceElement,
      rect.x, rect.y, rect.width, rect.height,
      0, 0, rect.width, rect.height
    )

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('failed to create crop blob'))
          return
        }
        resolve(blob)
      }, 'image/jpeg', 0.95)
    })
  }))
}
```

- [ ] **Step 2: Resolve the correct source element explicitly**

In `OCRPreviewStage`, replace generic `querySelector('canvas')` for PDFs with the actual PDF page canvas:

```ts
const pdfCanvas = containerRef.current?.querySelector('.react-pdf__Page__canvas') as HTMLCanvasElement | null
```

For images, keep `imageRef.current`.

- [ ] **Step 3: Split visual mode and auto mode into different pipelines**

```ts
const handleExtraction = async (mode: 'visual' | 'auto') => {
  if (mode === 'visual') {
    const sourceElement = resolveSourceElement()
    const visualSize = {
      width: sourceElement.clientWidth,
      height: sourceElement.clientHeight,
    }

    const cropBlobs = await buildSelectionCropBlobs({
      sourceElement,
      selections,
      visualSize,
      padding: 12,
    })

    const formData = new FormData()
    cropBlobs.forEach((blob, index) => {
      formData.append('files', blob, `selection-${index + 1}.jpg`)
    })
    formData.append('mode', 'visual')

    const result = await extractTextFromFile(formData)
    // ...
    return
  }

  // auto mode keeps using whole-page image
}
```

- [ ] **Step 4: Keep auto mode unchanged except for using a dedicated whole-image helper**

Refactor the current full-page merge path into a clearly named helper such as `buildWholeImageBlob()` so visual and auto modes do not share the same generation path anymore.

- [ ] **Step 5: Verify selection-count to crop-count relationship in code**

Add a guard/logging check:

```ts
if (mode === 'visual' && cropBlobs.length !== selections.length) {
  throw new Error('선택 영역 crop 생성 수가 일치하지 않습니다.')
}
```

- [ ] **Step 6: Run focused lint/type checks**

Run:
- `npx eslint src/components/features/passages/ocr-preview-stage.tsx src/lib/ocr/selection-crop.ts`
- `npx tsc --noEmit`

Expected: PASS

---

### Task 3: Simplify the OCR prompt for cropped visual inputs

**Files:**
- Modify: `src/app/api/ocr/actions.ts`

- [ ] **Step 1: Replace the visual-mode fallback prompt with crop-oriented instructions**

Current prompt assumes full-page dimming. Replace it with a crop-only prompt:

```ts
const visualPrompt = `
You are an expert OCR assistant for English education materials.
Each provided image is already cropped to a user-selected passage region.

YOUR TASK:
1. Extract only the English passage text visible in each cropped image.
2. Do not invent or merge text that is not visible in the crop.
3. Preserve reading order within each crop.
4. Return a JSON object: { "passages": ["text1", "text2"] }
`
```

- [ ] **Step 2: Add a strict post-parse cleanup for visual mode**

```ts
const passages = jsonResponse.passages
  .map((passage: unknown) => typeof passage === 'string' ? passage.trim() : '')
  .filter(Boolean)
```

- [ ] **Step 3: Add a safety check for over-generation in visual mode**

```ts
if (mode === 'visual' && passages.length > files.length) {
  console.warn('[OCR] Visual mode returned more passages than crop images', {
    cropCount: files.length,
    passageCount: passages.length,
  })
}
```

- [ ] **Step 4: Verify action-level behavior remains compatible with auto mode**

Run:
- `npx eslint src/app/api/ocr/actions.ts`
- `npx tsc --noEmit`

Expected: PASS

---

### Task 4: Add regression coverage for the selected-region bug

**Files:**
- Create: `tests/selection-crop.test.mjs`
- Modify: existing OCR-related tests only if already present and relevant

- [ ] **Step 1: Add regression tests for isolated crop extraction geometry**

Include cases for:
- single centered selection
- selection near another passage area
- selection near edges
- multiple ordered selections

- [ ] **Step 2: Add a smoke test that visual mode no longer depends on dimmed-overlay language**

Read the source file as text and assert the old full-page dimming assumptions are not the only visual-mode mechanism anymore.

```js
const previewStageSource = readFileSync(
  new URL('../src/components/features/passages/ocr-preview-stage.tsx', import.meta.url),
  'utf8'
)

assert.match(previewStageSource, /buildSelectionCropBlobs|selectionToCropRect/)
```

- [ ] **Step 3: Run all focused regression tests**

Run:

```bash
node --test tests/selection-crop.test.mjs
```

Expected: PASS

---

### Task 5: Execute the verification loop before shipping

**Files:**
- Modify only if verification finds defects

- [ ] **Step 1: Verification loop — geometry correctness**

Proof required:
- crop math tests pass
- zoom/padding/clamp logic validated by test output

Run:
- `node --test tests/selection-crop.test.mjs`

Expected: PASS

- [ ] **Step 2: Verification loop — static quality gates**

Run:
- `npx eslint src/components/features/passages/ocr-preview-stage.tsx src/app/api/ocr/actions.ts src/lib/ocr/selection-crop.ts tests/selection-crop.test.mjs`
- `npx tsc --noEmit`

Expected: PASS

- [ ] **Step 3: Verification loop — manual behavior check for the reported bug**

Manual checklist in the browser:
1. Open `지문 관리 및 추가`
2. Upload the same PDF/image type used in the reported issue
3. Box-select only passage 2
4. Click `선택 영역 추출`
5. Confirm the result contains only passage 2
6. Repeat with passage 4 only
7. Repeat with passages 2 and 4 together
8. Confirm `전체 영역 자동 추출` still returns multiple passages normally

Expected:
- visual mode returns only selected passages
- neighboring passages do not leak in
- auto mode unchanged

- [ ] **Step 4: If verification fails, iterate instead of shipping**

Failure handling order:
1. If wrong passage count → inspect crop rectangle math and padding
2. If truncated text → increase padding slightly (e.g. 12 → 16)
3. If neighboring text leaks → reduce padding or add per-crop prompt tightening
4. Re-run the full verification set after every fix

Stop only when all three are true:
- focused tests pass
- lint/typecheck pass
- manual reproduction no longer shows extra passages

---

## Recommended Initial Defaults

- crop padding: `12px`
- order: top-to-bottom, then left-to-right
- visual mode output expectation: max one logical passage per crop image
- auto mode: unchanged

---

## Risks / Watch Items

- Some passages may need slightly larger padding if selection boxes are drawn tightly.
- If a selected region contains both question stem and passage, OCR will still return both; this is expected unless the selection excludes the question.
- PDF rendering scale must be based on the actual `.react-pdf__Page__canvas`, not generic container size assumptions.

---

## Completion Standard

This work is complete only if:
1. A single selected passage no longer returns neighboring passages.
2. Multi-selection returns only the selected regions.
3. Auto extraction still behaves as before.
4. Geometry tests + lint + typecheck pass.
5. Manual reproduction of the reported case is successful.
