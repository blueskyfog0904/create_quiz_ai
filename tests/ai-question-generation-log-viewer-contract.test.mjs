import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const sourceUrl = (path) => new URL(`../${path}`, import.meta.url)
const readSource = (path) => readFileSync(sourceUrl(path), 'utf8')

const utilsPath = 'src/components/features/question-generation/log-viewer-utils.ts'
const viewerPath = 'src/components/features/question-generation/QuestionGenerationAttemptLogViewer.tsx'

function loadUtils() {
  const source = readSource(utilsPath)
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const cjsModule = { exports: {} }
  const sandbox = {
    exports: cjsModule.exports,
    module: cjsModule,
    require: (id) => {
      throw new Error(`Unexpected require in ${utilsPath}: ${id}`)
    },
  }
  vm.runInNewContext(transpiled, sandbox, { filename: utilsPath })
  return cjsModule.exports
}

test('AI generation log viewer files exist and expose expected source contracts', () => {
  assert.equal(existsSync(sourceUrl(utilsPath)), true, `${utilsPath} should exist`)
  assert.equal(existsSync(sourceUrl(viewerPath)), true, `${viewerPath} should exist`)

  const viewerSource = readSource(viewerPath)
  assert.match(viewerSource, /safeAttemptLogs|SafeAttemptLog/)
  assert.match(viewerSource, /groupLogsByAttemptNo/)
  assert.match(viewerSource, /getEventLabel/)
  assert.match(viewerSource, /rawText/)
  assert.match(viewerSource, /payload/)
  assert.match(viewerSource, /defaultOpenFailed/)
  assert.match(viewerSource, /defaultOpenLastAttempt/)
  assert.match(viewerSource, /회차/)
})

test('safeAttemptLogs normalizes malformed and unknown attempt log fixtures', () => {
  const {
    safeAttemptLogs,
    groupLogsByAttemptNo,
    getEventLabel,
    formatDurationMs,
  } = loadUtils()

  assert.equal(safeAttemptLogs(null).length, 0)
  assert.equal(safeAttemptLogs({ attemptNo: 1 }).length, 0)

  const logs = safeAttemptLogs([
    null,
    'invalid',
    {
      id: 'log-1',
      attemptNo: '2',
      timestamp: '2026-06-04T00:00:00.000Z',
      phase: 'generation',
      event: 'new_future_event',
      title: '미래 이벤트',
      status: 'success',
      rawText: 'raw payload',
      durationMs: '1250',
      payload: { ok: true },
    },
    {
      event: 42,
      title: 100,
      payload: { failed: true },
    },
  ])

  assert.equal(logs.length, 2)
  assert.equal(logs[0].attemptNo, 2)
  assert.equal(logs[0].durationMs, 1250)
  assert.equal(logs[0].event, 'new_future_event')
  assert.equal(getEventLabel(logs[0].event), 'new_future_event')
  assert.equal(logs[1].attemptNo, null)
  assert.equal(logs[1].event, 'unknown_event')
  assert.equal(formatDurationMs(logs[0].durationMs), '1.3초')

  const groups = groupLogsByAttemptNo(logs)
  assert.equal(groups.length, 2)
  assert.equal(groups[0].attemptNo, 2)
  assert.equal(groups[1].attemptNo, null)
})

test('getPreviewQuestion accepts camelCase, snake_case, and nullable passage fixtures', () => {
  const { getPreviewQuestion } = loadUtils()

  const camel = getPreviewQuestion({
    questionText: 'What is the main idea?',
    questionTextForward: 'Read the following.',
    questionTextBackward: null,
    passageText: 'A passage',
    choices: [{ label: '①', text: 'Choice A' }],
    answer: '①',
    explanation: 'Because...',
    gradeLevel: 'High1',
  })

  assert.equal(camel?.questionText, 'What is the main idea?')
  assert.equal(camel?.passageText, 'A passage')
  assert.equal(camel?.choices?.[0]?.label, '①')

  const snake = getPreviewQuestion({
    question_text: 'Choose the best title.',
    question_text_forward: null,
    question_text_backward: 'Additional text',
    passage_text: 'Another passage',
    choices: [{ label: '②', text: 'Choice B' }],
    answer: '②',
    explanation: null,
    grade_level: 'High2',
  })

  assert.equal(snake?.questionText, 'Choose the best title.')
  assert.equal(snake?.questionTextBackward, 'Additional text')
  assert.equal(snake?.passageText, 'Another passage')

  const nullablePassage = getPreviewQuestion({
    questionText: 'Question without passage',
    passageText: null,
    choices: [],
    answer: '①',
    explanation: 'No passage needed',
  })
  assert.equal(nullablePassage?.questionText, 'Question without passage')
  assert.equal(nullablePassage?.passageText, null)

  assert.equal(getPreviewQuestion({ passageText: 'No question text' }), null)
  assert.equal(getPreviewQuestion(null), null)
})

test('getReviewResult normalizes review result fixtures defensively', () => {
  const { getReviewResult } = loadUtils()

  assert.equal(getReviewResult(null), null)
  assert.equal(getReviewResult('invalid'), null)

  const review = getReviewResult({
    passed: false,
    feedback: 'Needs revision',
    score: '72',
    issues: [
      { field: 'choices', severity: 'error', message: 'Duplicate choice', suggestion: 'Revise one choice' },
      { field: 'ignored', severity: 'warning' },
    ],
  })

  assert.equal(review?.passed, false)
  assert.equal(review?.feedback, 'Needs revision')
  assert.equal(review?.score, 72)
  assert.equal(review?.issues.length, 1)
  assert.equal(review?.issues[0]?.message, 'Duplicate choice')
})
