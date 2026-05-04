import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const routeSource = readFileSync(
  new URL('../src/app/api/questions/save-from-community/route.ts', import.meta.url),
  'utf8'
)

function functionBlock(source, name) {
  const start = source.indexOf(`export async function ${name}`)
  assert.notEqual(start, -1, `${name} export not found`)

  const signatureEnd = source.indexOf(') {', start)
  assert.notEqual(signatureEnd, -1, `${name} signature did not terminate`)
  const braceStart = signatureEnd + 2
  let depth = 0

  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}') depth--
    if (depth === 0) return source.slice(start, i + 1)
  }

  throw new Error(`${name} block did not terminate`)
}

const postBlock = functionBlock(routeSource, 'POST')
const putBlock = functionBlock(routeSource, 'PUT')

function helperBlock(source) {
  const start = source.indexOf('const getRefundConsumptions =')
  const end = source.indexOf('const getRpcErrorStatus =')
  assert.notEqual(start, -1, 'getRefundConsumptions helper not found')
  assert.notEqual(end, -1, 'getRpcErrorStatus helper marker not found')
  return source.slice(start, end)
}

function loadPureHelpers() {
  const source = helperBlock(routeSource).replace(
    /^const (getRefundConsumptions|getUniqueQuestionIds|getTotalSkippedCount) =/gm,
    'globalThis.$1 ='
  )
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const context = { globalThis: {} }
  vm.runInNewContext(output, context)
  return context.globalThis
}

const copiedFieldParityColumns = [
  'question_text',
  'question_text_forward',
  'question_text_backward',
  'choices',
  'answer',
  'explanation',
  'passage_text',
  'grade_level',
  'difficulty',
  'problem_type_id',
  'source_type',
  'source_1',
  'source_2',
  'source_3',
  'source_4',
  'tags',
  'rating',
]

const plain = (value) => JSON.parse(JSON.stringify(value))

test('save-from-community routes delegate copy semantics to metadata-preserving RPC', () => {
  for (const block of [postBlock, putBlock]) {
    assert.match(block, /\.rpc\('copy_admin_questions_to_user_bank',\s*\{[\s\S]*p_workspace_subject:\s*workspaceSubject[\s\S]*p_admin_question_ids:/)
  }

  assert.doesNotMatch(routeSource, /\.from\('questions'\)\s*\n\s*\.insert\(/)
  assert.doesNotMatch(routeSource, /\.from\('question_bank_question_metadata'\)\s*\n\s*\.(insert|update|upsert)\(/)

  for (const column of copiedFieldParityColumns) {
    assert.match(routeSource, new RegExp(`\\b${column}\\b`), `${column} parity contract must remain documented`)
  }
})

test('save-from-community routes reselect saved question rows after RPC for existing client response shapes', () => {
  assert.match(postBlock, /savedQuestionIds\[0\]/)
  assert.match(postBlock, /\.from\('questions'\)[\s\S]*\.select\('\*'\)[\s\S]*\.eq\('id',\s*savedQuestionId\)[\s\S]*\.single\(\)/)
  assert.match(postBlock, /success:\s*true[\s\S]*question:/)

  assert.match(putBlock, /\.from\('questions'\)[\s\S]*\.select\('\*'\)[\s\S]*\.in\('id',\s*savedQuestionIds\)/)
  assert.match(putBlock, /success:\s*true[\s\S]*saved_count:\s*savedCount[\s\S]*skipped_count:\s*skippedCount[\s\S]*questions:[\s\S]*saved_question_ids:\s*savedQuestionIds/)
})

test('save-from-community routes keep snapshot-backed credit response fields and balance header', () => {
  assert.match(routeSource, /const CREDIT_BALANCE_HEADER = 'x-credit-balance'/)
  assert.match(routeSource, /getCreditBalanceSnapshot/)
  assert.match(routeSource, /buildCreditBalanceResponseFields/)
  assert.match(routeSource, /\.\.\.buildCreditBalanceResponseFields\(snapshot\)/)
  assert.match(routeSource, /\[CREDIT_BALANCE_HEADER\]:\s*String\(snapshot\.displayBalance\)/)
})

test('save-from-community routes use RPC counts and saved IDs as final save truth', () => {
  for (const block of [postBlock, putBlock]) {
    assert.match(block, /copy_admin_questions_to_user_bank/)
    assert.match(block, /rpcResult/)
    assert.match(block, /saved_count/)
    assert.match(block, /skipped_count/)
    assert.match(block, /saved_question_ids/)
  }

  assert.match(postBlock, /const savedCount = rpcResult\?\.saved_count \?\? 0/)
  assert.match(postBlock, /if \(savedCount === 0 \|\| !savedQuestionId\)/)
  assert.match(putBlock, /const savedCount = rpcResult\?\.saved_count \?\? 0/)
  assert.match(putBlock, /const rpcSkippedCount = rpcResult\?\.skipped_count \?\? 0/)
  assert.match(putBlock, /const skippedCount = getTotalSkippedCount\(preflightSkippedCount,\s*rpcSkippedCount\)/)
  assert.match(putBlock, /const requestedQuestionIds = getUniqueQuestionIds\(question_ids\)/)
})

test('save-from-community routes refund deductions on RPC failure and partial duplicate reconciliation', () => {
  assert.match(postBlock, /rpcError[\s\S]*refundCredits\(/)
  assert.match(postBlock, /savedCount === 0 \|\| !savedQuestionId[\s\S]*refundCredits\(/)

  assert.match(putBlock, /rpcError[\s\S]*refundCredits\(/)
  assert.match(putBlock, /if \(savedCount < chargedCount\)[\s\S]*refundCredits\(/)
  assert.match(putBlock, /getRefundConsumptions\(deductionResult\.consumptions,\s*refundAmount\)/)
})

test('save-from-community route maps RPC contract errors to HTTP status codes', () => {
  assert.match(routeSource, /AUTH_REQUIRED[\s\S]*401/)
  assert.match(routeSource, /INVALID_SCOPE[\s\S]*400/)
  assert.match(routeSource, /INVALID_SOURCE[\s\S]*400/)
  assert.match(routeSource, /NO_METADATA[\s\S]*400/)
  assert.match(routeSource, /DUPLICATE[\s\S]*400/)
  assert.match(routeSource, /return 500/)
})

test('pure helpers refund partial bulk saves from tail consumptions', () => {
  const { getRefundConsumptions } = loadPureHelpers()

  assert.deepEqual(
    plain(getRefundConsumptions([
      { sourceId: 'oldest', amount: 100 },
      { sourceId: 'middle', amount: 100 },
      { sourceId: 'newest', amount: 100 },
    ], 100)),
    [{ sourceId: 'newest', amount: 100 }]
  )
  assert.deepEqual(
    plain(getRefundConsumptions([
      { sourceId: 'oldest', amount: 100 },
      { sourceId: 'newest', amount: 50 },
    ], 75)),
    [
      { sourceId: 'oldest', amount: 25 },
      { sourceId: 'newest', amount: 50 },
    ]
  )
})

test('pure helpers preserve skipped count and avoid duplicate request overcharge', () => {
  const { getTotalSkippedCount, getUniqueQuestionIds } = loadPureHelpers()

  assert.deepEqual(plain(getUniqueQuestionIds(['a', 'b', 'a'])), ['a', 'b'])
  assert.equal(getTotalSkippedCount(1, 0), 1)
  assert.equal(getTotalSkippedCount(1, 2), 3)
})
