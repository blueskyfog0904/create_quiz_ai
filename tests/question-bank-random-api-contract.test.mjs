import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { existsSync, readFileSync } from 'node:fs'

import {
  MAX_RANDOM_EXAM_QUESTION_COUNT,
  normalizeTypeCountPayload,
  validateRandomExamRequest,
} from '../src/lib/question-bank/random-exam.ts'

const routePath = new URL('../src/app/api/exam-papers/random-bank/route.ts', import.meta.url)
const grammarTypeId = '11111111-1111-4111-8111-111111111111'
const vocabTypeId = '22222222-2222-4222-8222-222222222222'

function readRouteSource() {
  assert.equal(existsSync(routePath), true, 'random-bank route file must exist')
  return readFileSync(routePath, 'utf8')
}

function extractPostFunction(source) {
  const start = source.indexOf('export async function POST')
  assert.notEqual(start, -1, 'POST function must exist')

  const bodyStart = source.indexOf('{', start)
  assert.notEqual(bodyStart, -1, 'POST function body must exist')

  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]

    if (char === '{') {
      depth += 1
    }

    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return source.slice(start, index + 1)
          .replace(
            'export async function POST(request: Request)',
            'async function POST(request)'
          )
          .replace(/\blet body: unknown\b/g, 'let body')
      }
    }
  }

  throw new Error('Could not extract POST function')
}

async function runPostWithMalformedJson() {
  const source = readRouteSource()
  const postFunction = extractPostFunction(source)
  const context = {
    console: { error() {} },
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-id' } } }),
      },
    }),
    NextResponse: {
      json(body, init = {}) {
        return {
          status: init.status ?? 200,
          async json() {
            return body
          },
        }
      },
    },
  }

  vm.createContext(context)
  vm.runInContext(`${postFunction}; this.POST = POST`, context)

  return context.POST({
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
  })
}

function assertCodeMapsToStatus(source, code, status) {
  assert.match(
    source,
    new RegExp(String.raw`case ['"]${code}['"]:\s*\n\s*return ${status}\b`),
    `${code} must map to ${status}`
  )
}

test('random-bank route exists and exports POST with the required request shape', () => {
  const source = readRouteSource()

  assert.match(source, /export\s+async\s+function\s+POST\s*\(/)
  assert.match(source, /title:\s*z\.string\(\)/)
  assert.match(source, /yearId:\s*z\.string\(\)\.uuid\(/)
  assert.match(source, /bookId:\s*z\.string\(\)\.uuid\(/)
  assert.match(source, /typeCounts:\s*z\.array\(/)
  assert.match(source, /problemTypeId:\s*z\.string\(\)\.uuid\(/)
  assert.match(source, /count:\s*z\.number\(\)\.int\(\)\.positive\(/)
  assert.match(source, /workspaceSubject:\s*z\.enum\(\['english', 'korean'\]\)\.optional\(\)/)
  assert.match(source, /subject:\s*z\.enum\(\['english', 'korean'\]\)\.optional\(\)/)
})

test('random-bank POST returns INVALID_INPUT for malformed JSON before schema or RPC work', async () => {
  const response = await runPostWithMalformedJson()
  const body = await response.json()

  assert.equal(response.status, 400)
  assert.equal(body.success, false)
  assert.equal(body.code, 'INVALID_INPUT')
  assert.match(body.message, /입력값|요청|JSON|올바르지/)
})

test('random-bank route requires auth before creating the paper', () => {
  const source = readRouteSource()

  assert.match(source, /supabase\.auth\.getUser\s*\(\s*\)/)
  assert.match(source, /if\s*\(\s*!user\s*\)/)
  assert.match(source, /AUTH_REQUIRED/)
  assert.match(source, /status:\s*401/)
})

test('random-bank route validates invalid scope, duplicate type, and total cap before RPC', () => {
  const source = readRouteSource()

  assert.match(source, /safeParse\(body\)/)
  assert.match(source, /status:\s*400/)
  assert.match(source, /INVALID_INPUT/)
  assert.match(source, /DUPLICATE_TYPE/)
  assert.match(source, /COUNT_LIMIT_EXCEEDED/)
  assert.match(source, /MAX_RANDOM_EXAM_QUESTION_COUNT/)
  assert.match(source, /new\s+Set<.*>\(\)/)
})

test('random-bank route delegates creation only to create_random_bank_exam_paper RPC', () => {
  const source = readRouteSource()

  assert.match(source, /rpc\(\s*['"]create_random_bank_exam_paper['"]\s*,\s*\{/)
  assert.match(source, /p_workspace_subject:\s*workspaceSubject/)
  assert.match(source, /p_title:\s*title/)
  assert.match(source, /p_year_id:\s*yearId/)
  assert.match(source, /p_book_id:\s*bookId/)
  assert.match(source, /p_type_counts:\s*typeCounts/)
  assert.doesNotMatch(source, /from\(\s*['"]exam_papers['"]\s*\)[\s\S]*\.insert\s*\(/)
  assert.doesNotMatch(source, /from\(\s*['"]exam_paper_items['"]\s*\)[\s\S]*\.insert\s*\(/)
  assert.doesNotMatch(source, /from\(\s*['"]exam_papers['"]\s*\)[\s\S]*\.delete\s*\(/)
  assert.doesNotMatch(source, /from\(\s*['"]questions['"]\s*\)/)
})

test('random-bank route maps known RPC errors to route statuses', () => {
  const source = readRouteSource()

  assertCodeMapsToStatus(source, 'AUTH_REQUIRED', 401)
  assertCodeMapsToStatus(source, 'INVALID_SCOPE', 400)
  assertCodeMapsToStatus(source, 'INACTIVE_DIMENSION', 400)
  assertCodeMapsToStatus(source, 'DUPLICATE_TYPE', 400)
  assertCodeMapsToStatus(source, 'COUNT_LIMIT_EXCEEDED', 400)
  assertCodeMapsToStatus(source, 'INSUFFICIENT_QUESTIONS', 409)
  assert.match(source, /INSUFFICIENT_QUESTIONS[\s\S]*문항/)
})

test('random-bank route returns top-level random paper fields', () => {
  const source = readRouteSource()

  assert.match(source, /examPaperId:\s*rpcRow\.exam_paper_id/)
  assert.match(source, /selectedQuestionIds:\s*rpcRow\.selected_question_ids/)
  assert.match(source, /totalCount:\s*rpcRow\.total_count/)
  assert.match(source, /NextResponse\.json\(\s*\{[\s\S]*success:\s*true,[\s\S]*examPaperId:\s*rpcRow\.exam_paper_id,[\s\S]*selectedQuestionIds:\s*rpcRow\.selected_question_ids,[\s\S]*totalCount:\s*rpcRow\.total_count,[\s\S]*\}/)
})

test('random exam helper covers duplicate, over-limit, and insufficient normalization contracts', () => {
  const duplicate = validateRandomExamRequest({
    title: 'Random exam',
    typeCounts: [
      { problemTypeId: grammarTypeId, count: 1 },
      { problemTypeId: grammarTypeId, count: 2 },
    ],
    availability: [{ problemTypeId: grammarTypeId, availableCount: 10 }],
  })

  assert.equal(duplicate.isValid, false)
  assert.ok(duplicate.errors.some((error) => error.code === 'duplicate_problem_type'))

  const overLimit = validateRandomExamRequest({
    title: 'Random exam',
    typeCounts: [
      { problemTypeId: grammarTypeId, count: MAX_RANDOM_EXAM_QUESTION_COUNT },
      { problemTypeId: vocabTypeId, count: 1 },
    ],
    availability: [
      { problemTypeId: grammarTypeId, availableCount: MAX_RANDOM_EXAM_QUESTION_COUNT },
      { problemTypeId: vocabTypeId, availableCount: 1 },
    ],
  })

  assert.equal(overLimit.isValid, false)
  assert.ok(overLimit.errors.some((error) => error.code === 'total_over_limit'))

  const insufficient = validateRandomExamRequest({
    title: 'Random exam',
    typeCounts: normalizeTypeCountPayload([{ problem_type_id: grammarTypeId, count: '3' }]),
    availability: [{ problem_type_id: grammarTypeId, available_count: '2' }],
  })

  assert.equal(insufficient.isValid, false)
  assert.deepEqual(insufficient.errors, [
    {
      code: 'insufficient_availability',
      field: 'typeCounts',
      problemTypeId: grammarTypeId,
      message: '요청 문항 수가 사용 가능한 문항 수(2)를 초과했습니다.',
    },
  ])
})
