import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const parserPath = 'src/lib/ai/json-response-parser.ts'
const providerPaths = [
  'src/lib/ai/openai.ts',
  'src/lib/ai/gemini.ts',
  'src/lib/ai/claude.ts'
]

const loadParserModule = () => {
  assert.equal(existsSync(new URL(`../${parserPath}`, import.meta.url)), true, 'parser module should exist')
  const source = readSource(parserPath)
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    }
  }).outputText
  const exports = {}
  const cjsModule = { exports }
  vm.runInNewContext(transpiled, { exports, module: cjsModule }, { filename: parserPath })
  return cjsModule.exports
}

const validQuestion = {
  questionText: 'What is the main idea?',
  passageText: 'This is a passage.',
  choices: [],
  answer: '①',
  explanation: 'Because it is the main idea.'
}

const expectFailureCode = (result, code) => {
  assert.equal(result.success, false)
  assert.equal(result.code, code)
}

const assertJsonEqual = (actual, expected) => {
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected)
}

test('common AI JSON parser accepts raw and single fenced JSON only', () => {
  const { parseAiJsonResponse } = loadParserModule()
  assert.equal(typeof parseAiJsonResponse, 'function')

  const rawObject = parseAiJsonResponse(JSON.stringify(validQuestion))
  assert.equal(rawObject.success, true)
  assertJsonEqual(rawObject.data, validQuestion)
  assert.equal(rawObject.source, 'raw')

  const rawArrayFirst = parseAiJsonResponse(JSON.stringify([validQuestion]), { arrayMode: 'first' })
  assert.equal(rawArrayFirst.success, true)
  assertJsonEqual(rawArrayFirst.data, validQuestion)

  const rawArrayReject = parseAiJsonResponse(JSON.stringify([validQuestion]), { arrayMode: 'reject' })
  expectFailureCode(rawArrayReject, 'AI_JSON_UNEXPECTED_SHAPE')

  const fencedJson = parseAiJsonResponse(`\n\`\`\`json\n${JSON.stringify(validQuestion)}\n\`\`\`\n`)
  assert.equal(fencedJson.success, true)
  assertJsonEqual(fencedJson.data, validQuestion)
  assert.equal(fencedJson.source, 'fenced')

  const fencedNoLanguage = parseAiJsonResponse(`\`\`\`\n${JSON.stringify(validQuestion)}\n\`\`\``)
  assert.equal(fencedNoLanguage.success, true)
  assertJsonEqual(fencedNoLanguage.data, validQuestion)
  assert.equal(fencedNoLanguage.source, 'fenced')
})

test('common AI JSON parser rejects unsafe or ambiguous responses', () => {
  const { parseAiJsonResponse } = loadParserModule()

  expectFailureCode(parseAiJsonResponse(''), 'AI_JSON_EMPTY_RESPONSE')
  expectFailureCode(parseAiJsonResponse('[]', { arrayMode: 'first' }), 'AI_JSON_EMPTY_ARRAY')
  expectFailureCode(parseAiJsonResponse('not json'), 'AI_JSON_PARSE_FAILED')
  expectFailureCode(parseAiJsonResponse('```json\n{ broken json }\n```'), 'AI_JSON_PARSE_FAILED')
  expectFailureCode(
    parseAiJsonResponse(`\`\`\`json\n${JSON.stringify(validQuestion)}\n\`\`\`\n\`\`\`json\n${JSON.stringify(validQuestion)}\n\`\`\``),
    'AI_JSON_MULTIPLE_FENCED_BLOCKS'
  )
  expectFailureCode(
    parseAiJsonResponse(`Here is the JSON:\n\`\`\`json\n${JSON.stringify(validQuestion)}\n\`\`\``),
    'AI_JSON_FENCE_OUTSIDE_TEXT'
  )
  expectFailureCode(
    parseAiJsonResponse(`설명입니다.\n\`\`\`\n${JSON.stringify(validQuestion)}\n\`\`\`\n감사합니다.`),
    'AI_JSON_FENCE_OUTSIDE_TEXT'
  )
  expectFailureCode(
    parseAiJsonResponse(`\`\`\`ts\n${JSON.stringify(validQuestion)}\n\`\`\``),
    'AI_JSON_UNSUPPORTED_FENCE_LANGUAGE'
  )
  expectFailureCode(
    parseAiJsonResponse(`\`\`\`javascript\n${JSON.stringify(validQuestion)}\n\`\`\``),
    'AI_JSON_UNSUPPORTED_FENCE_LANGUAGE'
  )
  expectFailureCode(
    parseAiJsonResponse(`The passage includes { an example } and { another one }.`),
    'AI_JSON_PARSE_FAILED'
  )
})

test('common AI JSON parser stays provider-agnostic and log-safe', () => {
  assert.equal(existsSync(new URL(`../${parserPath}`, import.meta.url)), true)
  const parserSource = readSource(parserPath)

  assert.doesNotMatch(parserSource, /console\./)
  assert.doesNotMatch(parserSource, /QuestionSchema|ReviewResultSchema/)
  assert.doesNotMatch(parserSource, /@google\/generative-ai|openai|Claude|Anthropic/i)
})

test('AI adapters and review parsing use the common parser without raw response preview logs', () => {
  for (const path of providerPaths) {
    const source = readSource(path)
    assert.match(source, /parseAiJsonResponse/)
    assert.doesNotMatch(source, /JSON\.parse\(rawContent\)/)
    assert.doesNotMatch(source, /console\.[a-zA-Z]+\([^\n]*rawContent/)
    assert.doesNotMatch(source, /rawContent\.substring/)
  }

  const geminiSource = readSource('src/lib/ai/gemini.ts')
  assert.doesNotMatch(geminiSource, /Raw content preview/)

  const workflowSource = readSource('src/lib/ai/question-generation-workflow.ts')
  assert.match(workflowSource, /parseAiJsonResponse/)
  assert.doesNotMatch(workflowSource, /JSON\.parse\(rawResponse\)/)
  assert.match(workflowSource, /status:\s*'generation_failed'/)
})
