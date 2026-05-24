# HWPX AI 문제은행 템플릿 변환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자가 HWPX 파일을 업로드하면 API 기반 AI가 문항을 구조화하고, 기존 문제은행 업로드 미리보기/저장 흐름에 맞는 템플릿 행 초안을 생성한다.

**Architecture:** v1은 DB 마이그레이션 없이 관리자 전용 parse-only API를 추가한다. 서버는 HWPX ZIP/XML에서 안전하게 텍스트만 추출하고, OpenAI Structured Outputs(JSON Schema)로 기존 `ParsedQuestion` 형태의 초안을 만든 뒤, 관리자는 기존 업로드 화면에서 검수/수정/제외 후 기존 `/api/admin/questions/upload` RPC 저장 경로로 저장한다.

**Tech Stack:** Next.js App Router Route Handlers, TypeScript, JSZip, OpenAI Chat Completions Structured Outputs, Zod, XLSX, existing Supabase RPCs, Node `node:test` contract/unit tests.

---

## 요구사항 파악

### 목표

- HWPX 파일을 문제은행 업로드 템플릿 초안으로 변환한다.
- AI 결과는 자동 저장하지 않는다.
- `valid` 문항만 기본 저장 가능하다.
- `needs_review` 문항은 경고/원문/신뢰도를 보여주고, 관리자가 명시적으로 `검수 완료` 처리해야 저장 가능하다.
- 최종 저장은 기존 `/api/admin/questions/upload`와 `create_admin_bank_questions_bulk` RPC만 사용한다.
- 채워진 XLSX를 다운로드해도 기존 bulk upload가 읽을 수 있도록 `yearId`, `bookId`, `bankProblemTypeId`를 보존한다.

### v1 지원 범위

- 텍스트 기반 HWPX
- HWPX 내부 `Contents/section*.xml` 텍스트 추출
- 문제은행 전용 `question_bank_problem_types` 기준 유형 매핑
- 관리자 선택 `yearId`, `bookId`를 모든 분석 row에 적용
- OpenAI Structured Outputs + Zod 검증
- 파일/ZIP/XML/AI 호출/출력 토큰 하드 제한

### v1 제외 범위

- HWP 원본 직접 업로드
- 이미지 OCR
- 복잡한 표/수식/도형/머리말/각주 구조 보존
- 정답이 없는 문제에서 AI가 정답 생성
- DB staging/job table
- 검수 없는 자동 저장

### 설계 검증에서 반영한 필수 보완

- ZIP bomb 방어: JSZip entry metadata의 `uncompressedSize`/`compressedSize`를 inflate 전에 검사한다.
- AI 비용/토큰 제한: 입력 추정 토큰, 호출 수, 출력 토큰 cap, 총 토큰 cap을 사전/사후로 검사한다.
- AI 호출 전 예산은 원문뿐 아니라 system prompt, user wrapper, Structured Outputs JSON Schema, 보수적 chat request overhead reserve, output token cap까지 합산한다. 사후 `usage.totalTokens` 검사는 감사/이상 감지용이며, 사전 예산 초과 시 API를 호출하지 않는다.
- `needs_review` 저장 게이트: API에서 `isValid: false`로 내려보내고 UI에서 명시적 `검수 완료` 시에만 `isValid: true`가 된다.
- 채워진 템플릿: `yearId`, `bookId` 컬럼을 포함해 재업로드 가능성을 보장한다.
- 테스트 강화: source-regex만 쓰지 않고 pure helper unit test로 row 변환, filled workbook round-trip, extractor security를 검증한다.

---

## 파일 구조

### 생성

- `src/lib/question-bank/hwpx-upload-types.ts` — 한도, 공유 타입, preview row 타입.
- `src/lib/question-bank/hwpx-extractor.ts` — HWPX ZIP/XML 보안 검증과 텍스트 추출.
- `src/lib/question-bank/hwpx-ai.ts` — OpenAI structured output 호출, AI token budget guard.
- `src/lib/question-bank/hwpx-preview.ts` — AI row를 기존 `ParsedQuestion` 호환 row로 변환하고 `needs_review` 저장 gate 적용.
- `src/lib/question-bank/filled-template.ts` — 기존 템플릿 헤더 상수, 채워진 XLSX workbook row 생성/검증.
- `src/app/api/admin/questions/hwpx-analyze/route.ts` — 관리자 전용 HWPX 분석 parse-only API.
- `src/app/api/admin/questions/filled-template/route.ts` — preview rows를 XLSX로 다운로드.
- `tests/question-bank-hwpx-extractor.test.mjs`
- `tests/question-bank-hwpx-ai-contract.test.mjs`
- `tests/question-bank-hwpx-ai-budget.test.mjs`
- `tests/question-bank-hwpx-preview.test.mjs`
- `tests/question-bank-filled-template.test.mjs`
- `tests/question-bank-hwpx-api-contract.test.mjs`
- `tests/question-bank-hwpx-upload-ui-contract.test.mjs`

### 수정

- `src/app/(admin)/admin/questions/upload/admin-upload-client.tsx` — HWPX AI 분석 카드, `needs_review` 표시/검수 완료, filled template download.
- `src/app/api/admin/questions/template/route.ts` — `문제입력` 기본 헤더를 shared constant로 맞춰 filled template와 호환성 고정.
- `tests/question-bank-upload-metadata-contract.test.mjs` — 기존 `.xlsx/.csv` 회귀 보호.
- `tests/question-bank-filled-template.test.mjs` — 헤더 중복 없음과 기존 템플릿 헤더 순서 호환성 검증.

### 변경하지 않음

- Supabase migrations — v1은 DB 변경 없음.
- `src/app/api/admin/questions/upload/route.ts` — 최종 저장 API 재사용.
- `src/lib/ai/gemini.ts` — HWPX 분석은 원문 로그를 피하기 위해 별도 OpenAI 경로 사용.

---

## Task 0: 작업 보호

- [ ] **Step 1: 상태 확인**

Run:

```bash
git status --short
```

Expected: 기존 작업 변경이 있으면 이번 plan 관련 파일과 분리해 기록한다.

- [ ] **Step 2: 대상 파일 사전 diff 저장**

Run:

```bash
git diff -- \
  'src/app/(admin)/admin/questions/upload/admin-upload-client.tsx' \
  src/app/api/admin/questions/bulk-upload/route.ts \
  src/app/api/admin/questions/template/route.ts \
  src/lib/question-bank \
  tests/question-bank-upload-metadata-contract.test.mjs \
  > /tmp/hwpx-ai-question-bank-before.diff
```

Expected: exit 0.

---

## Task 1: 공유 타입과 보안 한도

**Files:**
- Create: `src/lib/question-bank/hwpx-upload-types.ts`

- [ ] **Step 1: 타입/한도 파일 생성**

Create `src/lib/question-bank/hwpx-upload-types.ts`:

```ts
export const HWPX_UPLOAD_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxZipEntries: 300,
  maxXmlEntryBytes: 1024 * 1024,
  maxXmlBytes: 4 * 1024 * 1024,
  maxZipCompressionRatio: 80,
  maxExtractedChars: 60_000,
  maxAiChunkChars: 12_000,
  maxAiChunks: 8,
  maxAiOutputTokens: 6000,
  minimumOutputTokenBudget: 1000,
  chatRequestOverheadTokens: 12_000,
  maxEstimatedInputTokens: 40_000,
  maxTotalTokens: 70_000,
  maxQuestions: 120,
  maxFilledTemplatePayloadChars: 1_500_000,
} as const

export const HWPX_ALLOWED_XML_ENTRY_PATTERN = /^Contents\/section\d+\.xml$/i

export type HwpxQuestionStatus = 'valid' | 'needs_review' | 'invalid'

export interface HwpxExtractedSection {
  path: string
  text: string
}

export interface HwpxExtractedDocument {
  text: string
  sections: HwpxExtractedSection[]
  warnings: string[]
}

export interface HwpxAnalysisUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  callCount: number
}

export interface HwpxAnalyzedQuestion {
  id: string
  clientRowId: string
  bankProblemTypeId?: string
  problem_type_id: string
  problem_type_name: string
  passage_text: string
  question_text: string
  question_text_forward: string
  question_text_backward: string
  choices: string[]
  answer: string
  explanation: string
  grade_level: string
  difficulty: string
  yearId: string
  bookId: string
  isValid: boolean
  errorMessage?: string
  source_type?: string
  source_1?: string
  source_2?: string
  source_3?: string
  source_4?: string
  conversionStatus: HwpxQuestionStatus
  confidence: number
  warnings: string[]
  sourceSnippet: string
}
```

- [ ] **Step 2: 타입 파일 lint 확인**

Run:

```bash
npx eslint src/lib/question-bank/hwpx-upload-types.ts
```

Expected: exit 0.

---

## Task 2: HWPX extractor TDD

**Files:**
- Create: `src/lib/question-bank/hwpx-extractor.ts`
- Test: `tests/question-bank-hwpx-extractor.test.mjs`

- [ ] **Step 1: failing extractor test 작성**

Create `tests/question-bank-hwpx-extractor.test.mjs`:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import JSZip from 'jszip'
import '../src/components/features/passages/node-test-register.mjs'

import {
  extractHwpxTextFromBuffer,
  validateHwpxUploadFile,
} from '../src/lib/question-bank/hwpx-extractor.ts'

async function createHwpx(entries) {
  const zip = new JSZip()
  for (const [path, content] of Object.entries(entries)) {
    zip.file(path, content)
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

test('extractHwpxTextFromBuffer reads whitelisted section XML text in order', async () => {
  const buffer = await createHwpx({
    'Contents/section0.xml': '<hp:p><hp:run><hp:t>1. 다음 글의 제목으로 알맞은 것은?</hp:t></hp:run></hp:p><hp:p><hp:run><hp:t>① Technology</hp:t></hp:run></hp:p>',
    'Contents/section1.xml': '<hp:p><hp:run><hp:t>정답 1</hp:t></hp:run></hp:p>',
    'BinData/image1.png': 'ignored',
  })

  const result = await extractHwpxTextFromBuffer(buffer)

  assert.equal(result.sections.length, 2)
  assert.match(result.text, /1\. 다음 글의 제목/)
  assert.match(result.text, /① Technology/)
  assert.match(result.text, /정답 1/)
})

test('validateHwpxUploadFile rejects non-hwpx oversized and non-zip files', () => {
  assert.deepEqual(validateHwpxUploadFile('exam.pdf', Buffer.from('PK')), {
    ok: false,
    reason: 'HWPX 파일만 업로드할 수 있습니다.',
  })

  assert.deepEqual(validateHwpxUploadFile('exam.hwpx', Buffer.alloc(10 * 1024 * 1024 + 1)), {
    ok: false,
    reason: 'HWPX 파일은 10MB 이하만 업로드할 수 있습니다.',
  })

  assert.deepEqual(validateHwpxUploadFile('exam.hwpx', Buffer.from('not zip')), {
    ok: false,
    reason: '올바른 HWPX ZIP 파일이 아닙니다.',
  })
})

test('extractHwpxTextFromBuffer rejects too many entries missing section and unsafe paths', async () => {
  const manyEntries = {}
  for (let i = 0; i < 301; i++) {
    manyEntries[`Contents/section${i}.xml`] = '<hp:t>x</hp:t>'
  }

  await assert.rejects(
    () => createHwpx(manyEntries).then((buffer) => extractHwpxTextFromBuffer(buffer)),
    /HWPX 내부 파일 수가 너무 많습니다/
  )

  const empty = await createHwpx({ 'mimetype': 'application/hwp+zip' })
  await assert.rejects(() => extractHwpxTextFromBuffer(empty), /본문 XML을 찾을 수 없습니다/)

  const unsafe = await createHwpx({ 'Contents/../section0.xml': '<hp:t>x</hp:t>' })
  await assert.rejects(() => extractHwpxTextFromBuffer(unsafe), /허용되지 않는 HWPX 내부 경로/)
})

test('extractHwpxTextFromBuffer rejects oversized uncompressed XML before reading content', async () => {
  const hugeXml = `<hp:p><hp:run><hp:t>${'x'.repeat(1024 * 1024 + 1)}</hp:t></hp:run></hp:p>`
  const buffer = await createHwpx({ 'Contents/section0.xml': hugeXml })

  await assert.rejects(
    () => extractHwpxTextFromBuffer(buffer),
    /HWPX XML 항목 크기가 너무 큽니다/
  )
})
```

- [ ] **Step 2: 실패 확인**

Run:

```bash
node --test tests/question-bank-hwpx-extractor.test.mjs
```

Expected: module not found failure.

- [ ] **Step 3: extractor 구현**

Create `src/lib/question-bank/hwpx-extractor.ts`:

```ts
import JSZip from 'jszip'
import {
  HWPX_ALLOWED_XML_ENTRY_PATTERN,
  HWPX_UPLOAD_LIMITS,
  type HwpxExtractedDocument,
} from './hwpx-upload-types'

type ZipObject = JSZip.JSZipObject

type ZipObjectWithSizes = ZipObject & {
  _data?: {
    compressedSize?: number
    uncompressedSize?: number
  }
}

const XML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

export function validateHwpxUploadFile(fileName: string, buffer: Buffer | Uint8Array) {
  if (!fileName.toLowerCase().endsWith('.hwpx')) {
    return { ok: false as const, reason: 'HWPX 파일만 업로드할 수 있습니다.' }
  }

  if (buffer.byteLength > HWPX_UPLOAD_LIMITS.maxFileBytes) {
    return { ok: false as const, reason: 'HWPX 파일은 10MB 이하만 업로드할 수 있습니다.' }
  }

  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    return { ok: false as const, reason: '올바른 HWPX ZIP 파일이 아닙니다.' }
  }

  return { ok: true as const }
}

function getZipEntrySizes(entry: ZipObject) {
  const data = (entry as ZipObjectWithSizes)._data
  return {
    compressedSize: data?.compressedSize ?? 0,
    uncompressedSize: data?.uncompressedSize ?? 0,
  }
}

function assertSafeZipEntry(path: string, entry: ZipObject) {
  if (path.includes('..') || path.startsWith('/')) {
    throw new Error('허용되지 않는 HWPX 내부 경로입니다.')
  }

  const { compressedSize, uncompressedSize } = getZipEntrySizes(entry)

  if (uncompressedSize > HWPX_UPLOAD_LIMITS.maxXmlEntryBytes) {
    throw new Error('HWPX XML 항목 크기가 너무 큽니다.')
  }

  if (compressedSize > 0 && uncompressedSize / compressedSize > HWPX_UPLOAD_LIMITS.maxZipCompressionRatio) {
    throw new Error('HWPX XML 압축 비율이 비정상적으로 높습니다.')
  }
}

function decodeXmlText(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (_, name) => XML_ENTITY_MAP[name] ?? `&${name};`)
}

function extractTextFromSectionXml(xml: string) {
  const parts: string[] = []
  const tokenPattern = /<hp:t\b[^>]*>([\s\S]*?)<\/hp:t>|<hp:lineBreak\b[^>]*\/?>|<hp:tab\b[^>]*\/?>|<hp:p\b[^>]*>/g
  let match: RegExpExecArray | null

  while ((match = tokenPattern.exec(xml)) !== null) {
    const token = match[0]

    if (token.startsWith('<hp:t')) {
      parts.push(decodeXmlText(match[1].replace(/<[^>]+>/g, '')))
      continue
    }

    if (token.startsWith('<hp:tab')) {
      parts.push('\t')
      continue
    }

    parts.push('\n')
  }

  return parts
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function extractHwpxTextFromBuffer(buffer: Buffer | Uint8Array): Promise<HwpxExtractedDocument> {
  const zip = await JSZip.loadAsync(buffer)
  const entries = Object.keys(zip.files)

  if (entries.length > HWPX_UPLOAD_LIMITS.maxZipEntries) {
    throw new Error('HWPX 내부 파일 수가 너무 많습니다.')
  }

  for (const path of entries) {
    if (path.includes('..') || path.startsWith('/')) {
      throw new Error('허용되지 않는 HWPX 내부 경로입니다.')
    }
  }

  const sectionPaths = entries
    .filter((entry) => HWPX_ALLOWED_XML_ENTRY_PATTERN.test(entry) && !zip.files[entry].dir)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

  if (sectionPaths.length === 0) {
    throw new Error('HWPX 본문 XML을 찾을 수 없습니다.')
  }

  let totalXmlBytes = 0
  for (const path of sectionPaths) {
    assertSafeZipEntry(path, zip.files[path])
    totalXmlBytes += getZipEntrySizes(zip.files[path]).uncompressedSize
  }

  if (totalXmlBytes > HWPX_UPLOAD_LIMITS.maxXmlBytes) {
    throw new Error('HWPX XML 크기가 너무 큽니다.')
  }

  const sections = []

  for (const path of sectionPaths) {
    const xml = await zip.files[path].async('string')
    const text = extractTextFromSectionXml(xml)
    if (text) {
      sections.push({ path, text })
    }
  }

  const text = sections.map((section) => section.text).join('\n\n').trim()

  if (!text) {
    throw new Error('HWPX에서 추출 가능한 텍스트가 없습니다.')
  }

  if (text.length > HWPX_UPLOAD_LIMITS.maxExtractedChars) {
    throw new Error('추출된 텍스트가 너무 깁니다. 문서를 나누어 업로드해주세요.')
  }

  return { text, sections, warnings: [] }
}
```

- [ ] **Step 4: extractor test 통과 확인**

Run:

```bash
node --test tests/question-bank-hwpx-extractor.test.mjs
```

Expected: pass 4, fail 0.

---

## Task 3: AI analyzer와 토큰 예산 guard TDD

**Files:**
- Create: `src/lib/question-bank/hwpx-ai.ts`
- Test: `tests/question-bank-hwpx-ai-contract.test.mjs`
- Test: `tests/question-bank-hwpx-ai-budget.test.mjs`

- [ ] **Step 1: contract test 작성**

Create `tests/question-bank-hwpx-ai-contract.test.mjs`:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const source = () => readFileSync(new URL('../src/lib/question-bank/hwpx-ai.ts', import.meta.url), 'utf8')

test('hwpx AI analyzer uses OpenAI structured outputs with strict schema and output token cap', () => {
  const file = source()

  assert.match(file, /new OpenAI/)
  assert.match(file, /response_format:\s*\{\s*type:\s*'json_schema'/)
  assert.match(file, /strict:\s*true/)
  assert.match(file, /max_completion_tokens:\s*outputTokenCap/)
  assert.match(file, /additionalProperties:\s*false/)
  assert.match(file, /safeParse/)
})

test('hwpx AI analyzer enforces input and total token budget before and after calls', () => {
  const file = source()

  assert.match(file, /estimateTokenCount/)
  assert.match(file, /maxEstimatedInputTokens/)
  assert.match(file, /maxTotalTokens/)
  assert.match(file, /estimateHwpxAiTokenBudget/)
  assert.match(file, /projectedTotalTokens/)
  assert.match(file, /buildSystemPrompt/)
  assert.match(file, /buildUserPrompt/)
  assert.match(file, /JSON\.stringify\(jsonSchema\)/)
  assert.match(file, /chatRequestOverheadTokens/)
  assert.match(file, /maxAiOutputTokens/)
  assert.match(file, /remainingTokenBudget/)
  assert.match(file, /outputTokenCap/)
  assert.match(file, /minimumOutputTokenBudget/)
  assert.match(file, /usage\.totalTokens/)
  assert.match(file, /AI 분석 토큰 한도를 초과했습니다/)
})

test('hwpx AI analyzer avoids full prompt logging and tells model not to invent fields', () => {
  const file = source()

  assert.doesNotMatch(file, /AIGenerationService/)
  assert.doesNotMatch(file, /GeminiAdapter/)
  assert.doesNotMatch(file, /console\.log\([^\n]*(prompt|raw|response|text)/i)
  assert.match(file, /절대 만들지 마세요|추론해서 생성하지 마세요/)
  assert.match(file, /문서에 없으면 빈 문자열/)
  assert.match(file, /needs_review/)
  assert.match(file, /question_bank_problem_types/)
})
```

Create `tests/question-bank-hwpx-ai-budget.test.mjs`:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import '../src/components/features/passages/node-test-register.mjs'

import {
  assertHwpxAiTokenBudgetWithinLimit,
  estimateHwpxAiTokenBudget,
  estimateTokenCount,
} from '../src/lib/question-bank/hwpx-ai.ts'
import { HWPX_UPLOAD_LIMITS } from '../src/lib/question-bank/hwpx-upload-types.ts'

test('estimateTokenCount uses conservative utf8 byte length rather than length divided by three', () => {
  assert.equal(estimateTokenCount('가나다'), Buffer.byteLength('가나다', 'utf8'))
})

test('estimateHwpxAiTokenBudget includes schema and request overhead beyond raw chunk and output tokens', () => {
  const rawMinimum = Buffer.byteLength('short', 'utf8') + HWPX_UPLOAD_LIMITS.maxAiOutputTokens
  const projected = estimateHwpxAiTokenBudget({ chunks: ['short'], problemTypes: [] })

  assert.ok(projected > rawMinimum + HWPX_UPLOAD_LIMITS.chatRequestOverheadTokens)
})

test('assertHwpxAiTokenBudgetWithinLimit rejects projected over-budget calls before OpenAI is called', () => {
  assert.throws(() => assertHwpxAiTokenBudgetWithinLimit({
    chunks: Array.from({ length: HWPX_UPLOAD_LIMITS.maxAiChunks }, () => 'x'.repeat(HWPX_UPLOAD_LIMITS.maxAiChunkChars)),
    problemTypes: [],
  }), /AI 분석 토큰 한도/)
})
```

- [ ] **Step 2: 실패 확인**

Run:

```bash
node --test tests/question-bank-hwpx-ai-contract.test.mjs tests/question-bank-hwpx-ai-budget.test.mjs
```

Expected: module not found failure.

- [ ] **Step 3: AI analyzer 구현**

Create `src/lib/question-bank/hwpx-ai.ts` with this exact structure:

```ts
import OpenAI from 'openai'
import { z } from 'zod'
import { HWPX_UPLOAD_LIMITS, type HwpxAnalysisUsage } from './hwpx-upload-types'

export interface HwpxProblemTypeOption {
  id: string
  type_name: string
}

export interface AnalyzeHwpxChunkInput {
  text: string
  chunkIndex: number
  problemTypes: HwpxProblemTypeOption[]
  defaultGradeLevel?: string
  defaultDifficulty?: string
  sourceType?: string
}

export const HwpxAiQuestionSchema = z.object({
  sourceSnippet: z.string().default(''),
  passage_text: z.string().default(''),
  question_text: z.string().default(''),
  question_text_forward: z.string().default(''),
  question_text_backward: z.string().default(''),
  choices: z.array(z.string()).default([]),
  answer: z.string().default(''),
  explanation: z.string().default(''),
  grade_level: z.enum(['', '중1', '중2', '중3', '고1', '고2', '고3']).default(''),
  difficulty: z.enum(['', '하', '중', '상']).default(''),
  bankProblemTypeId: z.string().default(''),
  problem_type_name: z.string().default(''),
  source_type: z.string().default(''),
  source_1: z.string().default(''),
  source_2: z.string().default(''),
  source_3: z.string().default(''),
  source_4: z.string().default(''),
  conversionStatus: z.enum(['valid', 'needs_review', 'invalid']).default('needs_review'),
  confidence: z.number().min(0).max(1).default(0),
  warnings: z.array(z.string()).default([]),
}).strict()

export type HwpxAiQuestion = z.infer<typeof HwpxAiQuestionSchema>

const HwpxAiResponseSchema = z.object({
  questions: z.array(HwpxAiQuestionSchema).max(HWPX_UPLOAD_LIMITS.maxQuestions),
  warnings: z.array(z.string()).default([]),
}).strict()

const jsonSchema = {
  name: 'hwpx_question_bank_rows',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['questions', 'warnings'],
    properties: {
      questions: {
        type: 'array',
        maxItems: HWPX_UPLOAD_LIMITS.maxQuestions,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'sourceSnippet', 'passage_text', 'question_text', 'question_text_forward', 'question_text_backward',
            'choices', 'answer', 'explanation', 'grade_level', 'difficulty', 'bankProblemTypeId',
            'problem_type_name', 'source_type', 'source_1', 'source_2', 'source_3', 'source_4',
            'conversionStatus', 'confidence', 'warnings',
          ],
          properties: {
            sourceSnippet: { type: 'string' },
            passage_text: { type: 'string' },
            question_text: { type: 'string' },
            question_text_forward: { type: 'string' },
            question_text_backward: { type: 'string' },
            choices: { type: 'array', items: { type: 'string' } },
            answer: { type: 'string' },
            explanation: { type: 'string' },
            grade_level: { type: 'string', enum: ['', '중1', '중2', '중3', '고1', '고2', '고3'] },
            difficulty: { type: 'string', enum: ['', '하', '중', '상'] },
            bankProblemTypeId: { type: 'string' },
            problem_type_name: { type: 'string' },
            source_type: { type: 'string' },
            source_1: { type: 'string' },
            source_2: { type: 'string' },
            source_3: { type: 'string' },
            source_4: { type: 'string' },
            conversionStatus: { type: 'string', enum: ['valid', 'needs_review', 'invalid'] },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            warnings: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      warnings: { type: 'array', items: { type: 'string' } },
    },
  },
} as const

export function estimateTokenCount(text: string) {
  // Conservative upper-bound approximation for mixed Korean/English prompts.
  // OpenAI BPE tokens cannot exceed UTF-8 byte length because each token covers at least one byte.
  return Math.max(1, Buffer.byteLength(text, 'utf8'))
}

export function chunkHwpxTextForAi(text: string) {
  const estimatedTokens = estimateTokenCount(text)
  if (estimatedTokens > HWPX_UPLOAD_LIMITS.maxEstimatedInputTokens) {
    throw new Error('AI 분석 입력 토큰 한도를 초과했습니다. 문서를 나누어 업로드해주세요.')
  }

  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  const chunks: string[] = []
  let current = ''

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line
    if (next.length > HWPX_UPLOAD_LIMITS.maxAiChunkChars && current) {
      chunks.push(current)
      current = line
    } else {
      current = next
    }
  }

  if (current) chunks.push(current)

  if (chunks.length > HWPX_UPLOAD_LIMITS.maxAiChunks) {
    throw new Error('AI 분석 호출 수가 너무 많습니다. 문서를 나누어 업로드해주세요.')
  }

  return chunks
}

function buildSystemPrompt(problemTypes: HwpxProblemTypeOption[]) {
  return [
    '당신은 문제은행 업로드 템플릿 변환기입니다.',
    'HWPX에서 추출된 텍스트를 읽고 문제은행 업로드 row JSON으로만 반환합니다.',
    '문서에 없는 지문, 정답, 해설, 선택지를 절대 만들지 마세요. 추론해서 생성하지 마세요.',
    '문서에 없으면 빈 문자열로 두고 warnings에 이유를 적으세요.',
    '확실하지 않으면 conversionStatus를 needs_review로 설정하세요.',
    '문제유형은 아래 question_bank_problem_types 중 하나만 선택합니다.',
    JSON.stringify(problemTypes.map((type) => ({ bankProblemTypeId: type.id, problem_type_name: type.type_name }))),
  ].join('\n')
}

function buildUserPrompt(input: AnalyzeHwpxChunkInput) {
  return [
    `chunkIndex: ${input.chunkIndex}`,
    `defaultGradeLevel: ${input.defaultGradeLevel || ''}`,
    `defaultDifficulty: ${input.defaultDifficulty || ''}`,
    `sourceType: ${input.sourceType || ''}`,
    '아래 HWPX 추출 텍스트를 문항 단위로 분리하세요.',
    '각 문항의 원문 일부를 sourceSnippet에 500자 이하로 넣으세요.',
    '<HWPX_TEXT>',
    input.text,
    '</HWPX_TEXT>',
  ].join('\n')
}

export function estimateHwpxAiTokenBudget(input: {
  chunks: string[]
  problemTypes: HwpxProblemTypeOption[]
  defaultGradeLevel?: string
  defaultDifficulty?: string
  sourceType?: string
}) {
  const systemPrompt = buildSystemPrompt(input.problemTypes)
  const schemaBudgetTokens = estimateTokenCount(JSON.stringify(jsonSchema))
  return input.chunks.reduce((total, chunk, index) => {
    const userPrompt = buildUserPrompt({
      text: chunk,
      chunkIndex: index,
      problemTypes: input.problemTypes,
      defaultGradeLevel: input.defaultGradeLevel,
      defaultDifficulty: input.defaultDifficulty,
      sourceType: input.sourceType,
    })

    return total
      + estimateTokenCount(systemPrompt)
      + estimateTokenCount(userPrompt)
      + schemaBudgetTokens
      + HWPX_UPLOAD_LIMITS.chatRequestOverheadTokens
      + HWPX_UPLOAD_LIMITS.maxAiOutputTokens
  }, 0)
}

export function assertHwpxAiTokenBudgetWithinLimit(input: Parameters<typeof estimateHwpxAiTokenBudget>[0]) {
  const projectedTotalTokens = estimateHwpxAiTokenBudget(input)
  if (projectedTotalTokens > HWPX_UPLOAD_LIMITS.maxTotalTokens) {
    throw new Error('AI 분석 토큰 한도를 초과했습니다. 문서를 나누어 업로드해주세요.')
  }
  return projectedTotalTokens
}

export async function analyzeHwpxTextWithOpenAI(input: {
  text: string
  problemTypes: HwpxProblemTypeOption[]
  defaultGradeLevel?: string
  defaultDifficulty?: string
  sourceType?: string
  modelName?: string
}) {
  const chunks = chunkHwpxTextForAi(input.text)
  assertHwpxAiTokenBudgetWithinLimit({
    chunks,
    problemTypes: input.problemTypes,
    defaultGradeLevel: input.defaultGradeLevel,
    defaultDifficulty: input.defaultDifficulty,
    sourceType: input.sourceType,
  })

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY가 설정되어 있지 않습니다.')
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const questions = []
  const warnings: string[] = []
  const usage: HwpxAnalysisUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 }
  const model = input.modelName || process.env.QUESTION_BANK_HWPX_AI_MODEL || 'gpt-4o-mini'

  for (let index = 0; index < chunks.length; index++) {
    const systemPrompt = buildSystemPrompt(input.problemTypes)
    const userPrompt = buildUserPrompt({ ...input, text: chunks[index], chunkIndex: index })
    const estimatedCallInputTokens = estimateTokenCount(systemPrompt)
      + estimateTokenCount(userPrompt)
      + estimateTokenCount(JSON.stringify(jsonSchema))
      + HWPX_UPLOAD_LIMITS.chatRequestOverheadTokens
    const remainingTokenBudget = HWPX_UPLOAD_LIMITS.maxTotalTokens - usage.totalTokens - estimatedCallInputTokens

    if (remainingTokenBudget < HWPX_UPLOAD_LIMITS.minimumOutputTokenBudget) {
      throw new Error('AI 분석 토큰 한도를 초과했습니다. 문서를 나누어 업로드해주세요.')
    }

    const outputTokenCap = Math.min(HWPX_UPLOAD_LIMITS.maxAiOutputTokens, remainingTokenBudget)

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_schema', json_schema: jsonSchema },
      temperature: 0,
      max_completion_tokens: outputTokenCap,
    })

    usage.callCount += 1
    usage.promptTokens += response.usage?.prompt_tokens ?? 0
    usage.completionTokens += response.usage?.completion_tokens ?? 0
    usage.totalTokens += response.usage?.total_tokens ?? 0

    if (usage.totalTokens > HWPX_UPLOAD_LIMITS.maxTotalTokens) {
      throw new Error('AI 분석 토큰 한도를 초과했습니다. 문서를 나누어 업로드해주세요.')
    }

    const content = response.choices[0]?.message?.content
    if (!content) {
      warnings.push(`chunk ${index + 1}: AI 응답이 비어 있습니다.`)
      continue
    }

    const parsed = HwpxAiResponseSchema.safeParse(JSON.parse(content))
    if (!parsed.success) {
      throw new Error(`AI 응답 형식이 올바르지 않습니다: ${parsed.error.message}`)
    }

    questions.push(...parsed.data.questions)
    warnings.push(...parsed.data.warnings)
  }

  return { questions, warnings, usage }
}
```

- [ ] **Step 4: AI contract test 통과 확인**

Run:

```bash
node --test tests/question-bank-hwpx-ai-contract.test.mjs tests/question-bank-hwpx-ai-budget.test.mjs
```

Expected: pass 6, fail 0.

---

## Task 4: Preview 변환 helper TDD

**Files:**
- Create: `src/lib/question-bank/hwpx-preview.ts`
- Test: `tests/question-bank-hwpx-preview.test.mjs`

- [ ] **Step 1: helper behavior test 작성**

Create `tests/question-bank-hwpx-preview.test.mjs`:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import '../src/components/features/passages/node-test-register.mjs'

import { buildHwpxPreviewQuestion } from '../src/lib/question-bank/hwpx-preview.ts'

const type = { id: '11111111-1111-4111-8111-111111111111', type_name: '빈칸 추론' }
const context = {
  yearId: '22222222-2222-4222-8222-222222222222',
  bookId: '33333333-3333-4333-8333-333333333333',
  problemTypeById: new Map([[type.id, type]]),
  problemTypeByName: new Map([[type.type_name, type]]),
  defaultGradeLevel: '고1',
  defaultDifficulty: '중',
  sourceType: '수능특강',
}

test('buildHwpxPreviewQuestion marks valid AI rows saveable and applies defaults', () => {
  const row = buildHwpxPreviewQuestion({
    row: {
      bankProblemTypeId: type.id,
      problem_type_name: '',
      passage_text: 'passage',
      question_text: 'question',
      question_text_forward: '',
      question_text_backward: '',
      choices: ['① a', '② b'],
      answer: '1',
      explanation: '',
      grade_level: '',
      difficulty: '',
      source_type: '',
      source_1: '',
      source_2: '',
      source_3: '',
      source_4: '',
      conversionStatus: 'valid',
      confidence: 0.9,
      warnings: [],
      sourceSnippet: 'snippet',
    },
    rowIndex: 0,
    ...context,
  })

  assert.equal(row.isValid, true)
  assert.equal(row.conversionStatus, 'valid')
  assert.equal(row.grade_level, '고1')
  assert.equal(row.difficulty, '중')
  assert.equal(row.source_type, '수능특강')
  assert.equal(row.problem_type_id, type.id)
})

test('buildHwpxPreviewQuestion blocks needs_review rows from bulk save until explicit UI approval', () => {
  const row = buildHwpxPreviewQuestion({
    row: {
      bankProblemTypeId: type.id,
      problem_type_name: '',
      passage_text: '',
      question_text: 'question',
      question_text_forward: '',
      question_text_backward: '',
      choices: ['① a', '② b'],
      answer: '1',
      explanation: '',
      grade_level: '고2',
      difficulty: '상',
      source_type: '',
      source_1: '',
      source_2: '',
      source_3: '',
      source_4: '',
      conversionStatus: 'needs_review',
      confidence: 0.55,
      warnings: ['선택지 경계 확인 필요'],
      sourceSnippet: 'snippet',
    },
    rowIndex: 1,
    ...context,
  })

  assert.equal(row.isValid, false)
  assert.equal(row.conversionStatus, 'needs_review')
  assert.match(row.errorMessage, /검수 완료가 필요합니다/)
  assert.deepEqual(row.warnings, ['선택지 경계 확인 필요'])
})

test('buildHwpxPreviewQuestion marks missing problem type invalid', () => {
  const row = buildHwpxPreviewQuestion({
    row: {
      bankProblemTypeId: '',
      problem_type_name: '없는 유형',
      passage_text: '',
      question_text: 'question',
      question_text_forward: '',
      question_text_backward: '',
      choices: [],
      answer: '1',
      explanation: '',
      grade_level: '',
      difficulty: '',
      source_type: '',
      source_1: '',
      source_2: '',
      source_3: '',
      source_4: '',
      conversionStatus: 'valid',
      confidence: 0.7,
      warnings: [],
      sourceSnippet: '',
    },
    rowIndex: 2,
    ...context,
  })

  assert.equal(row.isValid, false)
  assert.equal(row.conversionStatus, 'invalid')
  assert.match(row.errorMessage, /문제은행 문제유형/)
})
```

- [ ] **Step 2: 실패 확인**

Run:

```bash
node --test tests/question-bank-hwpx-preview.test.mjs
```

Expected: module not found failure.

- [ ] **Step 3: helper 구현**

Create `src/lib/question-bank/hwpx-preview.ts`:

```ts
import type { HwpxAnalyzedQuestion } from './hwpx-upload-types'
import type { HwpxAiQuestion } from './hwpx-ai'

type AiRow = HwpxAiQuestion

type ProblemType = { id: string, type_name: string }

export function buildHwpxPreviewQuestion(input: {
  row: AiRow
  rowIndex: number
  yearId: string
  bookId: string
  problemTypeById: Map<string, ProblemType>
  problemTypeByName: Map<string, ProblemType>
  defaultGradeLevel?: string
  defaultDifficulty?: string
  sourceType?: string
}): HwpxAnalyzedQuestion {
  const problemType = input.problemTypeById.get(input.row.bankProblemTypeId)
    || input.problemTypeByName.get(input.row.problem_type_name)
  const warnings = [...input.row.warnings]

  if (!problemType) warnings.push('문제은행 문제유형을 확인해야 합니다.')
  if (!input.row.question_text.trim()) warnings.push('문제내용을 확인해야 합니다.')
  if (!input.row.answer.trim()) warnings.push('정답을 확인해야 합니다.')

  const hasRequiredFields = Boolean(problemType && input.row.question_text.trim() && input.row.answer.trim())
  const conversionStatus = !hasRequiredFields
    ? 'invalid'
    : input.row.conversionStatus === 'valid'
      ? 'valid'
      : 'needs_review'
  const isValid = conversionStatus === 'valid'

  return {
    id: `hwpx-${input.rowIndex + 1}`,
    clientRowId: `hwpx-row-${input.rowIndex + 1}`,
    bankProblemTypeId: problemType?.id,
    problem_type_id: problemType?.id ?? '',
    problem_type_name: problemType?.type_name ?? input.row.problem_type_name,
    passage_text: input.row.passage_text,
    question_text: input.row.question_text,
    question_text_forward: input.row.question_text_forward,
    question_text_backward: input.row.question_text_backward,
    choices: input.row.choices.map((choice) => choice.trim()).filter(Boolean),
    answer: input.row.answer,
    explanation: input.row.explanation,
    grade_level: input.row.grade_level || input.defaultGradeLevel || '',
    difficulty: input.row.difficulty || input.defaultDifficulty || '',
    yearId: input.yearId,
    bookId: input.bookId,
    source_type: input.row.source_type || input.sourceType || '',
    source_1: input.row.source_1,
    source_2: input.row.source_2,
    source_3: input.row.source_3,
    source_4: input.row.source_4,
    conversionStatus,
    confidence: input.row.confidence,
    warnings,
    sourceSnippet: input.row.sourceSnippet,
    isValid,
    errorMessage: isValid ? undefined : conversionStatus === 'needs_review'
      ? 'AI 분석 결과 검수 완료가 필요합니다.'
      : warnings.join(' / ') || '필수 항목을 확인해주세요.',
  }
}
```

- [ ] **Step 4: preview helper test 통과 확인**

Run:

```bash
node --test tests/question-bank-hwpx-preview.test.mjs
```

Expected: pass 3, fail 0.

---

## Task 5: HWPX analyze API route

**Files:**
- Create: `src/app/api/admin/questions/hwpx-analyze/route.ts`
- Test: `tests/question-bank-hwpx-api-contract.test.mjs`

- [ ] **Step 1: API contract test 작성**

Create `tests/question-bank-hwpx-api-contract.test.mjs`:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const route = () => readFileSync(new URL('../src/app/api/admin/questions/hwpx-analyze/route.ts', import.meta.url), 'utf8')

test('hwpx analyze route is admin-only parse-only and uses safe helpers', () => {
  const source = route()

  assert.match(source, /auth\.getUser\(\)/)
  assert.match(source, /select\('is_admin'\)/)
  assert.match(source, /validateHwpxUploadFile/)
  assert.match(source, /extractHwpxTextFromBuffer/)
  assert.match(source, /analyzeHwpxTextWithOpenAI/)
  assert.match(source, /buildHwpxPreviewQuestion/)
  assert.doesNotMatch(source, /\.rpc\('create_admin_bank_question/)
  assert.doesNotMatch(source, /\.from\('questions'\)\s*\n\s*\.(insert|upsert|update)/)
})

test('hwpx analyze route validates active dimensions and problem bank types', () => {
  const source = route()

  assert.match(source, /question_bank_years/)
  assert.match(source, /question_bank_books/)
  assert.match(source, /question_bank_problem_types/)
  assert.match(source, /yearId/)
  assert.match(source, /bookId/)
  assert.match(source, /is_active/)
  assert.match(source, /workspaceSubject/)
})

test('hwpx analyze route returns needsReview summary and usage without raw prompt logging', () => {
  const source = route()

  assert.match(source, /needsReview/)
  assert.match(source, /usage/)
  assert.match(source, /conversionStatus/)
  assert.match(source, /confidence/)
  assert.match(source, /sourceSnippet/)
  assert.doesNotMatch(source, /console\.log\([^\n]*(text|prompt|response)/i)
})
```

- [ ] **Step 2: 실패 확인**

Run:

```bash
node --test tests/question-bank-hwpx-api-contract.test.mjs
```

Expected: module not found failure.

- [ ] **Step 3: route 구현**

Create `src/app/api/admin/questions/hwpx-analyze/route.ts`:

```ts
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { extractHwpxTextFromBuffer, validateHwpxUploadFile } from '@/lib/question-bank/hwpx-extractor'
import { analyzeHwpxTextWithOpenAI } from '@/lib/question-bank/hwpx-ai'
import { buildHwpxPreviewQuestion } from '@/lib/question-bank/hwpx-preview'

async function requireAdminUser(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return { error: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }) }

  return { user }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const admin = await requireAdminUser(supabase)
    if (admin.error) return admin.error

    const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const yearId = String(formData.get('yearId') || '')
    const bookId = String(formData.get('bookId') || '')
    const defaultGradeLevel = String(formData.get('defaultGradeLevel') || '')
    const defaultDifficulty = String(formData.get('defaultDifficulty') || '')
    const sourceType = String(formData.get('sourceType') || '')

    if (!file) return NextResponse.json({ error: 'HWPX 파일이 필요합니다.' }, { status: 400 })
    if (!yearId || !bookId) return NextResponse.json({ error: '연도와 교재를 선택해주세요.' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const fileValidation = validateHwpxUploadFile(file.name, buffer)
    if (!fileValidation.ok) return NextResponse.json({ error: fileValidation.reason }, { status: 400 })

    const [{ data: years }, { data: books }, { data: problemTypes, error: problemTypesError }] = await Promise.all([
      supabase.from('question_bank_years').select('id, year, label, is_active').eq('workspace_subject', workspaceSubject).eq('is_active', true),
      supabase.from('question_bank_books').select('id, name, is_active').eq('workspace_subject', workspaceSubject).eq('is_active', true),
      supabase.from('question_bank_problem_types').select('id, type_name, is_active').eq('workspace_subject', workspaceSubject).eq('is_active', true).order('type_name'),
    ])

    if (problemTypesError) return NextResponse.json({ error: '문제은행 문제유형을 불러오지 못했습니다.' }, { status: 500 })
    if (!years?.some((year) => year.id === yearId)) return NextResponse.json({ error: '활성 연도를 찾을 수 없습니다.' }, { status: 400 })
    if (!books?.some((book) => book.id === bookId)) return NextResponse.json({ error: '활성 교재를 찾을 수 없습니다.' }, { status: 400 })

    const extracted = await extractHwpxTextFromBuffer(buffer)
    const analysis = await analyzeHwpxTextWithOpenAI({ text: extracted.text, problemTypes: problemTypes || [], defaultGradeLevel, defaultDifficulty, sourceType })
    const problemTypeById = new Map((problemTypes || []).map((type) => [type.id, type]))
    const problemTypeByName = new Map((problemTypes || []).map((type) => [type.type_name, type]))
    const questions = analysis.questions.map((row, rowIndex) => buildHwpxPreviewQuestion({ row, rowIndex, yearId, bookId, problemTypeById, problemTypeByName, defaultGradeLevel, defaultDifficulty, sourceType }))

    const valid = questions.filter((question) => question.conversionStatus === 'valid').length
    const invalid = questions.filter((question) => question.conversionStatus === 'invalid').length
    const needsReview = questions.filter((question) => question.conversionStatus === 'needs_review').length

    return NextResponse.json({ success: true, summary: { total: questions.length, valid, invalid, needsReview }, questions, warnings: [...extracted.warnings, ...analysis.warnings], usage: analysis.usage })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'HWPX 분석 중 오류가 발생했습니다.'
    const status = /크기가 너무 큽니다|너무 많습니다|나누어 업로드|한도를 초과/.test(message) ? 413 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
```

- [ ] **Step 4: route contract 통과 확인**

Run:

```bash
node --test tests/question-bank-hwpx-api-contract.test.mjs
```

Expected: pass 3, fail 0.

---

## Task 6: Filled template helper와 route TDD

**Files:**
- Create: `src/lib/question-bank/filled-template.ts`
- Create: `src/app/api/admin/questions/filled-template/route.ts`
- Test: `tests/question-bank-filled-template.test.mjs`
- Test: `tests/question-bank-filled-template-contract.test.mjs`

- [ ] **Step 1: filled template behavior test 작성**

Create `tests/question-bank-filled-template.test.mjs`:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import * as XLSX from 'xlsx'
import '../src/components/features/passages/node-test-register.mjs'

import {
  QUESTION_UPLOAD_TEMPLATE_HEADERS,
  FILLED_QUESTION_UPLOAD_TEMPLATE_HEADERS,
  buildFilledTemplateWorkbook,
  buildFilledTemplateRows,
  validateFilledTemplateQuestions,
} from '../src/lib/question-bank/filled-template.ts'

test('filled template headers are unique and preserve the base upload template order', () => {
  assert.equal(new Set(FILLED_QUESTION_UPLOAD_TEMPLATE_HEADERS).size, FILLED_QUESTION_UPLOAD_TEMPLATE_HEADERS.length)
  assert.deepEqual(
    FILLED_QUESTION_UPLOAD_TEMPLATE_HEADERS.filter((header) => header !== 'yearId' && header !== 'bookId'),
    QUESTION_UPLOAD_TEMPLATE_HEADERS,
  )
})

test('buildFilledTemplateRows preserves yearId bookId and bankProblemTypeId for re-upload', () => {
  const rows = buildFilledTemplateRows([{ yearId: 'year-1', bookId: 'book-1', bankProblemTypeId: 'type-1', problem_type_name: '빈칸 추론', passage_text: 'p', question_text_forward: 'front', question_text: 'q', question_text_backward: 'back', choices: ['a', 'b'], answer: '1', explanation: 'e' }])

  assert.equal(rows[0].yearId, 'year-1')
  assert.equal(rows[0].bookId, 'book-1')
  assert.equal(rows[0].bankProblemTypeId, 'type-1')
  assert.equal(rows[0].지문앞텍스트, 'front')
  assert.equal(rows[0].지문뒤텍스트, 'back')
})

test('buildFilledTemplateWorkbook round-trips through xlsx sheet_to_json', () => {
  const workbook = buildFilledTemplateWorkbook([{ yearId: 'year-1', bookId: 'book-1', bankProblemTypeId: 'type-1', problem_type_name: '빈칸 추론', passage_text: 'p', question_text: 'q', choices: ['a', 'b'], answer: '1' }])
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  const parsed = XLSX.read(buffer, { type: 'buffer' })
  const headerRows = XLSX.utils.sheet_to_json(parsed.Sheets.문제입력, { header: 1 })
  const rows = XLSX.utils.sheet_to_json(parsed.Sheets.문제입력)

  assert.deepEqual(headerRows[0], [...FILLED_QUESTION_UPLOAD_TEMPLATE_HEADERS])
  assert.equal(rows[0].yearId, 'year-1')
  assert.equal(rows[0].bookId, 'book-1')
  assert.equal(rows[0].bankProblemTypeId, 'type-1')
  assert.equal(rows[0].문제내용, 'q')
})

test('validateFilledTemplateQuestions rejects too many or oversized rows', () => {
  assert.throws(() => validateFilledTemplateQuestions(Array.from({ length: 121 }, () => ({ question_text: 'q' }))), /문항 수는 120개 이하/)
  assert.throws(() => validateFilledTemplateQuestions([{ question_text: 'x'.repeat(1_500_001) }]), /템플릿 데이터가 너무 큽니다/)
})
```

- [ ] **Step 2: route contract test 작성**

Create `tests/question-bank-filled-template-contract.test.mjs`:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const route = () => readFileSync(new URL('../src/app/api/admin/questions/filled-template/route.ts', import.meta.url), 'utf8')
const templateRoute = () => readFileSync(new URL('../src/app/api/admin/questions/template/route.ts', import.meta.url), 'utf8')

test('filled template route is admin-only parse-only and delegates workbook construction', () => {
  const source = route()

  assert.match(source, /auth\.getUser\(\)/)
  assert.match(source, /select\('is_admin'\)/)
  assert.match(source, /validateFilledTemplateQuestions/)
  assert.match(source, /buildFilledTemplateWorkbook/)
  assert.doesNotMatch(source, /\.rpc\('create_admin_bank_question/)
  assert.doesNotMatch(source, /\.from\('questions'\)\s*\n\s*\.(insert|update|upsert)/)
})

test('base template route uses the same shared header constant as filled template', () => {
  const source = templateRoute()

  assert.match(source, /QUESTION_UPLOAD_TEMPLATE_HEADERS/)
})
```

- [ ] **Step 3: 실패 확인**

Run:

```bash
node --test tests/question-bank-filled-template.test.mjs tests/question-bank-filled-template-contract.test.mjs
```

Expected: module not found failures.

- [ ] **Step 4: helper 구현**

Create `src/lib/question-bank/filled-template.ts`:

```ts
import * as XLSX from 'xlsx'
import { HWPX_UPLOAD_LIMITS } from './hwpx-upload-types'

export const QUESTION_UPLOAD_TEMPLATE_HEADERS = [
  'year', '교재명', 'bankProblemTypeId', '문제유형', '지문', '지문앞텍스트', '문제내용', '지문뒤텍스트',
  'option', '선택지1', '선택지2', '선택지3', '선택지4', '선택지5', '정답', '해설', '학년', '난이도',
  '출처종류', '출처1', '출처2', '출처3', '출처4',
] as const

export const FILLED_QUESTION_UPLOAD_TEMPLATE_HEADERS = [
  'yearId', 'bookId', ...QUESTION_UPLOAD_TEMPLATE_HEADERS,
] as const

type QuestionRowInput = Record<string, unknown>

function text(value: unknown) {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
}

function choices(input: unknown) {
  return Array.isArray(input) ? input.map((choice) => text(choice)).filter(Boolean) : []
}

export function validateFilledTemplateQuestions(questions: QuestionRowInput[]) {
  if (questions.length === 0) throw new Error('다운로드할 문제가 없습니다.')
  if (questions.length > HWPX_UPLOAD_LIMITS.maxQuestions) throw new Error('문항 수는 120개 이하만 지원합니다.')

  const payloadSize = Buffer.byteLength(JSON.stringify(questions), 'utf8')
  if (payloadSize > HWPX_UPLOAD_LIMITS.maxFilledTemplatePayloadChars) throw new Error('템플릿 데이터가 너무 큽니다.')
}

export function buildFilledTemplateRows(questions: QuestionRowInput[]) {
  validateFilledTemplateQuestions(questions)

  return questions.map((question) => {
    const rowChoices = choices(question.choices)
    return {
      yearId: text(question.yearId),
      bookId: text(question.bookId),
      year: text(question.year),
      교재명: text(question.bookName),
      bankProblemTypeId: text(question.bankProblemTypeId || question.problem_type_id),
      문제유형: text(question.problem_type_name),
      지문: text(question.passage_text),
      지문앞텍스트: text(question.question_text_forward),
      문제내용: text(question.question_text),
      지문뒤텍스트: text(question.question_text_backward),
      option: JSON.stringify(rowChoices),
      선택지1: rowChoices[0] || '',
      선택지2: rowChoices[1] || '',
      선택지3: rowChoices[2] || '',
      선택지4: rowChoices[3] || '',
      선택지5: rowChoices[4] || '',
      정답: text(question.answer),
      해설: text(question.explanation),
      학년: text(question.grade_level),
      난이도: text(question.difficulty),
      출처종류: text(question.source_type),
      출처1: text(question.source_1),
      출처2: text(question.source_2),
      출처3: text(question.source_3),
      출처4: text(question.source_4),
    }
  })
}

export function buildFilledTemplateWorkbook(questions: QuestionRowInput[]) {
  const workbook = XLSX.utils.book_new()
  const rows = buildFilledTemplateRows(questions)
  const sheet = XLSX.utils.json_to_sheet(rows, { header: [...FILLED_QUESTION_UPLOAD_TEMPLATE_HEADERS] })
  sheet['!cols'] = FILLED_QUESTION_UPLOAD_TEMPLATE_HEADERS.map((header) => ({ wch: ['지문', 'option', '해설'].includes(header) ? 50 : 20 }))
  XLSX.utils.book_append_sheet(workbook, sheet, '문제입력')
  return workbook
}
```

- [ ] **Step 5: 기존 템플릿 route 헤더 공유화**

Modify `src/app/api/admin/questions/template/route.ts`:

```ts
import { QUESTION_UPLOAD_TEMPLATE_HEADERS } from '@/lib/question-bank/filled-template'
```

Replace the existing `mainSheetHeaders = [...]` block with:

```ts
const mainSheetHeaders = [...QUESTION_UPLOAD_TEMPLATE_HEADERS]
```

Expected: 기존 템플릿의 `문제입력` 헤더 순서는 변하지 않고, filled template과 같은 base header source를 사용한다.

- [ ] **Step 6: filled template route 구현**

Create `src/app/api/admin/questions/filled-template/route.ts`:

```ts
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { buildFilledTemplateWorkbook, validateFilledTemplateQuestions } from '@/lib/question-bank/filled-template'

async function requireAdminUser(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return { error: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }) }

  return { user }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const admin = await requireAdminUser(supabase)
    if (admin.error) return admin.error

    const body = await request.json()
    const questions = Array.isArray(body?.questions) ? body.questions : []
    validateFilledTemplateQuestions(questions)

    const workbook = buildFilledTemplateWorkbook(questions)
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="question_upload_template_filled.xlsx"',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '템플릿 생성 중 오류가 발생했습니다.'
    const status = /너무 큽니다|120개 이하/.test(message) ? 413 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
```

- [ ] **Step 7: filled template tests 통과 확인**

Run:

```bash
node --test tests/question-bank-filled-template.test.mjs tests/question-bank-filled-template-contract.test.mjs
```

Expected: all pass, fail 0.

---

## Task 7: 관리자 업로드 UI 연동과 검수 게이트

**Files:**
- Modify: `src/app/(admin)/admin/questions/upload/admin-upload-client.tsx`
- Test: `tests/question-bank-hwpx-upload-ui-contract.test.mjs`

- [ ] **Step 1: UI contract test 작성**

Create `tests/question-bank-hwpx-upload-ui-contract.test.mjs`:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const uploadClient = () => readFileSync(new URL('../src/app/(admin)/admin/questions/upload/admin-upload-client.tsx', import.meta.url), 'utf8')

test('admin upload UI exposes HWPX AI analysis without replacing xlsx upload', () => {
  const source = uploadClient()

  assert.match(source, /AI 템플릿 변환/)
  assert.match(source, /\.hwpx/)
  assert.match(source, /\/api\/admin\/questions\/hwpx-analyze/)
  assert.match(source, /setParsedQuestions/)
  assert.match(source, /AI provider로 전송/)
  assert.match(source, /accept="\.xlsx,\.csv"/)
})

test('admin upload UI requires year and book before HWPX analysis', () => {
  const source = uploadClient()

  assert.match(source, /hwpxYearId/)
  assert.match(source, /hwpxBookId/)
  assert.match(source, /연도와 교재를 선택해주세요/)
  assert.match(source, /formData\.append\('yearId'/)
  assert.match(source, /formData\.append\('bookId'/)
})

test('admin upload UI shows conversion review metadata and blocks needs_review until approved', () => {
  const source = uploadClient()

  assert.match(source, /conversionStatus/)
  assert.match(source, /needs_review/)
  assert.match(source, /sourceSnippet/)
  assert.match(source, /confidence/)
  assert.match(source, /warnings/)
  assert.match(source, /검수 완료/)
  assert.match(source, /handleMarkHwpxQuestionReviewed/)
  assert.match(source, /type ChangeEvent/)
})

test('admin upload UI can download filled xlsx from parsed AI rows', () => {
  const source = uploadClient()

  assert.match(source, /채워진 템플릿 다운로드/)
  assert.match(source, /\/api\/admin\/questions\/filled-template/)
  assert.match(source, /parsedQuestions/)
})
```

- [ ] **Step 2: 실패 확인**

Run:

```bash
node --test tests/question-bank-hwpx-upload-ui-contract.test.mjs
```

Expected: missing strings failure.

- [ ] **Step 3: `ParsedQuestion` 타입 확장**

Modify the existing React import in `admin-upload-client.tsx` to include the type-only event import:

```ts
import { useState, useRef, useEffect, useCallback, type ChangeEvent } from 'react'
```

Modify the existing `ParsedQuestion` interface in `admin-upload-client.tsx` by adding:

```ts
  conversionStatus?: 'valid' | 'needs_review' | 'invalid'
  confidence?: number
  warnings?: string[]
  sourceSnippet?: string
```

- [ ] **Step 4: HWPX state와 handlers 추가**

Add state near existing bulk states:

```ts
const [isAnalyzingHwpx, setIsAnalyzingHwpx] = useState(false)
const [isDownloadingFilledTemplate, setIsDownloadingFilledTemplate] = useState(false)
const [hwpxYearId, setHwpxYearId] = useState('')
const [hwpxBookId, setHwpxBookId] = useState('')
const [hwpxDefaultGradeLevel, setHwpxDefaultGradeLevel] = useState('')
const [hwpxDefaultDifficulty, setHwpxDefaultDifficulty] = useState('')
const [hwpxSourceType, setHwpxSourceType] = useState('')
const hwpxFileInputRef = useRef<HTMLInputElement>(null)
```

Add handlers near existing bulk handlers:

```ts
const hasRequiredParsedFields = (question: ParsedQuestion) => Boolean(
  (question.bankProblemTypeId || question.problem_type_id) && question.question_text && question.answer
)

const handleMarkHwpxQuestionReviewed = (questionId: string) => {
  setParsedQuestions((current) => current.map((question) => {
    if (question.id !== questionId) return question
    if (!hasRequiredParsedFields(question)) {
      return { ...question, isValid: false, conversionStatus: 'invalid', errorMessage: '필수 항목을 먼저 입력해주세요.' }
    }
    return { ...question, isValid: true, conversionStatus: 'valid', errorMessage: undefined, warnings: [] }
  }))
}

const handleHwpxAnalyze = async (file: File) => {
  if (!hwpxYearId || !hwpxBookId) {
    toast.error('연도와 교재를 선택해주세요.')
    return
  }

  setIsAnalyzingHwpx(true)
  setParsedQuestions([])

  try {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('yearId', hwpxYearId)
    formData.append('bookId', hwpxBookId)
    formData.append('defaultGradeLevel', hwpxDefaultGradeLevel)
    formData.append('defaultDifficulty', hwpxDefaultDifficulty)
    formData.append('sourceType', hwpxSourceType)

    const response = await fetch(withAdminWorkspaceSubject('/api/admin/questions/hwpx-analyze', workspaceSubject), { method: 'POST', body: formData })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'HWPX 분석에 실패했습니다.')

    setParsedQuestions(data.questions || [])
    toast.success(`HWPX 분석 결과 ${data.summary?.total || 0}개의 문제 초안을 만들었습니다. 저장 전 반드시 검수해주세요.`)
  } catch (error: unknown) {
    toast.error(getErrorMessage(error))
  } finally {
    setIsAnalyzingHwpx(false)
    if (hwpxFileInputRef.current) hwpxFileInputRef.current.value = ''
  }
}

const handleHwpxFileChange = (event: ChangeEvent<HTMLInputElement>) => {
  const file = event.target.files?.[0]
  if (file) handleHwpxAnalyze(file)
}

const handleDownloadFilledTemplate = async () => {
  if (parsedQuestions.length === 0) {
    toast.error('다운로드할 분석 결과가 없습니다.')
    return
  }

  setIsDownloadingFilledTemplate(true)
  try {
    const response = await fetch(withAdminWorkspaceSubject('/api/admin/questions/filled-template', workspaceSubject), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: parsedQuestions }),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || '채워진 템플릿 다운로드에 실패했습니다.')
    }

    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'question_upload_template_filled.xlsx'
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
    toast.success('채워진 템플릿이 다운로드되었습니다.')
  } catch (error: unknown) {
    toast.error(getErrorMessage(error))
  } finally {
    setIsDownloadingFilledTemplate(false)
  }
}
```

- [ ] **Step 5: HWPX 카드 UI 추가**

Add a new card before the existing Excel bulk upload card. Use existing `Select`, `Input`, `Button`, `Loader2`, `Upload` imports already present.

```tsx
<Card className="mb-8 border-blue-200 bg-blue-50/30">
  <CardHeader>
    <CardTitle>AI 템플릿 변환</CardTitle>
    <CardDescription>HWPX 파일에서 텍스트를 추출해 AI가 문제은행 업로드 초안을 만듭니다. 문서 내용은 AI provider로 전송되며, 저장 전 반드시 검수해야 합니다.</CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        <Label>연도 *</Label>
        <Select value={hwpxYearId} onValueChange={setHwpxYearId}>
          <SelectTrigger><SelectValue placeholder="연도 선택" /></SelectTrigger>
          <SelectContent>{bankYears.map((year) => <SelectItem key={year.id} value={year.id}>{year.label || year.year}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div>
        <Label>교재 *</Label>
        <Select value={hwpxBookId} onValueChange={setHwpxBookId}>
          <SelectTrigger><SelectValue placeholder="교재 선택" /></SelectTrigger>
          <SelectContent>{bankBooks.map((book) => <SelectItem key={book.id} value={book.id}>{book.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <div><Label>기본 학년</Label><Select value={hwpxDefaultGradeLevel} onValueChange={setHwpxDefaultGradeLevel}><SelectTrigger><SelectValue placeholder="선택 안 함" /></SelectTrigger><SelectContent>{gradeLevels.map((grade) => <SelectItem key={grade} value={grade}>{grade}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>기본 난이도</Label><Select value={hwpxDefaultDifficulty} onValueChange={setHwpxDefaultDifficulty}><SelectTrigger><SelectValue placeholder="선택 안 함" /></SelectTrigger><SelectContent>{difficulties.map((difficulty) => <SelectItem key={difficulty} value={difficulty}>{difficulty}</SelectItem>)}</SelectContent></Select></div>
      <div><Label>기본 출처종류</Label><Input value={hwpxSourceType} onChange={(event) => setHwpxSourceType(event.target.value)} placeholder="예: 수능특강" /></div>
    </div>
    <input ref={hwpxFileInputRef} type="file" accept=".hwpx" onChange={handleHwpxFileChange} className="hidden" />
    <Button type="button" onClick={() => hwpxFileInputRef.current?.click()} disabled={isAnalyzingHwpx || !hwpxYearId || !hwpxBookId}>
      {isAnalyzingHwpx ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
      HWPX 업로드 후 AI 분석
    </Button>
  </CardContent>
</Card>
```

- [ ] **Step 6: preview 카드에 AI 검수 정보 표시**

Inside each parsed question card, near header badges, add:

```tsx
{question.conversionStatus && (
  <Badge variant={question.conversionStatus === 'valid' ? 'default' : question.conversionStatus === 'needs_review' ? 'secondary' : 'destructive'}>
    {question.conversionStatus === 'valid' ? 'AI 검수 완료' : question.conversionStatus === 'needs_review' ? '검수 필요' : '변환 오류'}
  </Badge>
)}
{typeof question.confidence === 'number' && <Badge variant="outline">신뢰도 {Math.round(question.confidence * 100)}%</Badge>}
```

Below the header content, add:

```tsx
{question.warnings && question.warnings.length > 0 && (
  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
    <p className="font-medium">AI 경고</p>
    <ul className="mt-1 list-disc pl-5">{question.warnings.map((warning, warningIndex) => <li key={warningIndex}>{warning}</li>)}</ul>
  </div>
)}
{question.sourceSnippet && (
  <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
    <p className="font-medium text-slate-900">원문 스니펫</p>
    <p className="mt-1 whitespace-pre-wrap">{question.sourceSnippet}</p>
  </div>
)}
{question.conversionStatus === 'needs_review' && (
  <Button type="button" variant="outline" onClick={() => handleMarkHwpxQuestionReviewed(question.id)}>
    검수 완료
  </Button>
)}
```

- [ ] **Step 7: parsed action에 filled template button 추가**

Add to existing parsed summary action buttons:

```tsx
<Button variant="outline" onClick={handleDownloadFilledTemplate} disabled={isDownloadingFilledTemplate || parsedQuestions.length === 0}>
  {isDownloadingFilledTemplate ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
  채워진 템플릿 다운로드
</Button>
```

- [ ] **Step 8: UI contract 통과 확인**

Run:

```bash
node --test tests/question-bank-hwpx-upload-ui-contract.test.mjs
```

Expected: pass 4, fail 0.

---

## Task 8: 기존 bulk upload 회귀 보호

**Files:**
- Modify: `tests/question-bank-upload-metadata-contract.test.mjs`

- [ ] **Step 1: 기존 upload route와 client contract 보강**

Add to existing bulk upload route test:

```js
assert.doesNotMatch(bulkUploadRoute, /hwpx-analyze/)
assert.match(bulkUploadRoute, /\.xlsx/)
assert.match(bulkUploadRoute, /\.csv/)
assert.match(bulkUploadRoute, /yearId/)
assert.match(bulkUploadRoute, /bookId/)
```

Add to existing upload client test:

```js
assert.match(uploadClient, /accept="\.xlsx,\.csv"/)
assert.match(uploadClient, /accept="\.hwpx"/)
assert.match(uploadClient, /handleBulkSave/)
assert.match(uploadClient, /validQuestions\.map/)
```

- [ ] **Step 2: 회귀 test 실행**

Run:

```bash
node --test tests/question-bank-upload-metadata-contract.test.mjs
```

Expected: pass 7, fail 0.

---

## Task 9: 통합 검증

- [ ] **Step 1: 신규 및 관련 테스트 실행**

Run:

```bash
node --test \
  tests/question-bank-hwpx-extractor.test.mjs \
  tests/question-bank-hwpx-ai-contract.test.mjs \
  tests/question-bank-hwpx-ai-budget.test.mjs \
  tests/question-bank-hwpx-preview.test.mjs \
  tests/question-bank-hwpx-api-contract.test.mjs \
  tests/question-bank-filled-template.test.mjs \
  tests/question-bank-filled-template-contract.test.mjs \
  tests/question-bank-hwpx-upload-ui-contract.test.mjs \
  tests/question-bank-upload-metadata-contract.test.mjs
```

Expected: all pass, fail 0.

- [ ] **Step 2: 대상 파일 lint 실행**

Run:

```bash
npx eslint \
  src/lib/question-bank/hwpx-upload-types.ts \
  src/lib/question-bank/hwpx-extractor.ts \
  src/lib/question-bank/hwpx-ai.ts \
  src/lib/question-bank/hwpx-preview.ts \
  src/lib/question-bank/filled-template.ts \
  src/app/api/admin/questions/hwpx-analyze/route.ts \
  src/app/api/admin/questions/filled-template/route.ts \
  src/app/api/admin/questions/template/route.ts \
  'src/app/(admin)/admin/questions/upload/admin-upload-client.tsx' \
  tests/question-bank-hwpx-extractor.test.mjs \
  tests/question-bank-hwpx-ai-contract.test.mjs \
  tests/question-bank-hwpx-ai-budget.test.mjs \
  tests/question-bank-hwpx-preview.test.mjs \
  tests/question-bank-hwpx-api-contract.test.mjs \
  tests/question-bank-filled-template.test.mjs \
  tests/question-bank-filled-template-contract.test.mjs \
  tests/question-bank-hwpx-upload-ui-contract.test.mjs \
  tests/question-bank-upload-metadata-contract.test.mjs
```

Expected: exit 0.

- [ ] **Step 3: build 실행**

Run:

```bash
npm run build
```

Expected: `Compiled successfully`, exit 0.

- [ ] **Step 4: 전체 lint 분리 보고**

Run:

```bash
npm run lint
```

Expected: 기존 repo-wide lint debt로 실패할 수 있다. 실패하면 이번 변경 대상 lint 통과와 기존 오류를 분리해 보고한다.

- [ ] **Step 5: 브라우저 smoke**

Run:

```bash
npm run dev
```

Open:

```txt
http://localhost:4000/admin/questions/upload?subject=english
```

Expected:

```txt
1. 관리자 로그인 후 문제 업로드 페이지 접근
2. AI 템플릿 변환 카드 표시
3. 연도/교재 선택 전 HWPX 분석 버튼 disabled
4. 연도/교재 선택 후 .hwpx 선택 가능
5. 분석 결과가 기존 preview에 표시
6. valid / needs_review / invalid badge 표시
7. needs_review는 일괄 업로드 카운트에 포함되지 않음
8. 검수 완료 클릭 후 valid 카운트 증가
9. 채워진 템플릿 다운로드 가능
10. 유효 문항만 기존 일괄 업로드로 저장 가능
```

---

## PASS / FAIL 게이트

### PASS

- HWPX 분석 API가 DB 저장을 하지 않는다.
- HWPX parser가 확장자, ZIP magic, 파일 크기, entry 수, entry uncompressed size, compression ratio, total XML size, 추출 텍스트 길이를 제한한다.
- AI 호출이 structured outputs, Zod 검증, 출력 token cap, 입력/총 token cap을 사용한다.
- `needs_review`는 기본 저장 대상이 아니며, 관리자 검수 완료 후에만 저장 가능하다.
- 채워진 XLSX가 `yearId`, `bookId`, `bankProblemTypeId`를 보존한다.
- 기존 `.xlsx/.csv` 업로드 흐름이 유지된다.
- 신규 테스트, 대상 lint, build가 통과한다.

### FAIL

- 분석 API가 `questions` 또는 metadata에 직접 write한다.
- ZIP/XML 안전 검증 전에 큰 XML을 무제한 inflate한다.
- AI 출력 token cap이 없다.
- `needs_review`가 자동 저장된다.
- filled template이 year/book metadata를 잃어 재업로드할 수 없다.
- 기존 bulk upload preview/save 흐름을 새 저장 로직으로 우회한다.

---

## 멀티에이전트 검증 반영

- explore: 현재 HWPX는 export 전용이고 업로드/AI 분류 흐름이 없음을 확인했다.
- architect: v1은 DB/job table 없이 synchronous parse-only API가 적합하다고 판단했다.
- planner: pure helper behavior tests가 필요하고 source-regex만으로는 부족하다고 지적했다.
- critic/code-reviewer: ZIP bomb, AI token cap, needs_review 저장 gate, filled-template metadata, 기존 bulk 회귀 보호를 blocker로 지적했고 본 plan에 반영했다.

## 참고 문서

- OpenAI Structured Outputs: https://platform.openai.com/docs/guides/structured-outputs
- OpenAI Responses API response format: https://platform.openai.com/docs/api-reference/responses
