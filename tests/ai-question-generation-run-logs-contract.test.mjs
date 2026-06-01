import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const migrationsDir = new URL('../supabase/migrations/', import.meta.url)
const helperPath = 'src/lib/ai/question-generation-run-logs.ts'
const generateRoutePath = 'src/app/api/questions/generate/route.ts'
const saveQuestionRoutePath = 'src/app/api/questions/route.ts'
const listboardRunRoutePath = 'src/app/api/generate/listboard-jobs/[jobId]/run/route.ts'
const listboardRetryRoutePath = 'src/app/api/generate/listboard-jobs/[jobId]/retry/route.ts'
const listboardStatusRoutePath = 'src/app/api/generate/listboard-jobs/[jobId]/route.ts'

const readMaybe = (path) => existsSync(new URL(`../${path}`, import.meta.url)) ? readSource(path) : ''

const helperSource = readMaybe(helperPath)
const generateRouteSource = readSource(generateRoutePath)
const saveQuestionRouteSource = readSource(saveQuestionRoutePath)
const listboardRunRouteSource = readSource(listboardRunRoutePath)
const listboardRetryRouteSource = readSource(listboardRetryRoutePath)
const listboardStatusRouteSource = readSource(listboardStatusRoutePath)

test('ai question generation run migration stores admin-only sanitized traces with retention metadata', () => {
  const migrationName = readdirSync(migrationsDir).find((name) => name.includes('create_ai_question_generation_runs'))
  assert.ok(migrationName, 'create_ai_question_generation_runs migration should exist')

  const migrationSource = readFileSync(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), 'utf8')
  assert.match(migrationSource, /create table(?: if not exists)? public\.ai_question_generation_runs/)
  assert.match(migrationSource, /source text not null/)
  assert.match(migrationSource, /textbook/)
  assert.match(migrationSource, /attempts jsonb not null default '\[\]'::jsonb/)
  assert.match(migrationSource, /redaction_flags jsonb not null default '\{\}'::jsonb/)
  assert.match(migrationSource, /truncated_flags jsonb not null default '\{\}'::jsonb/)
  assert.match(migrationSource, /expires_at timestamptz/)
  assert.match(migrationSource, /alter table public\.ai_question_generation_runs enable row level security/)
  assert.match(migrationSource, /public\.is_admin\(\)/)
  assert.doesNotMatch(migrationSource, /raw_generation_response/)
  assert.doesNotMatch(migrationSource, /raw_review_response/)
})

test('ai generation log helper sanitizes traces and writes to dedicated run table only', () => {
  assert.equal(existsSync(new URL(`../${helperPath}`, import.meta.url)), true)
  assert.match(helperSource, /logAiQuestionGenerationRun/)
  assert.match(helperSource, /AiQuestionGenerationRunLogError/)
  assert.match(helperSource, /pruneExpiredAiQuestionGenerationRuns/)
  assert.match(helperSource, /linkAiQuestionGenerationRunToQuestion/)
  assert.match(helperSource, /sanitizeGenerationRunTrace/)
  assert.match(helperSource, /ai_question_generation_runs/)
  assert.match(helperSource, /\[REDACTED_EMAIL\]/)
  assert.match(helperSource, /\[REDACTED_PHONE\]/)
  assert.match(helperSource, /\[REDACTED_RRN\]/)
  assert.match(helperSource, /\[REDACTED_TOKEN\]/)
  assert.match(helperSource, /expires_at/)
  assert.match(helperSource, /\[TRUNCATED /)
  assert.doesNotMatch(helperSource, /admin_logs/)
})

test('public question generation captures server-side trace logs without returning full attempts', () => {
  assert.match(generateRouteSource, /logAiQuestionGenerationRun/)
  assert.match(generateRouteSource, /generationSource:\s*z\.enum\(\['single', 'multi', 'textbook'\]\)/)
  assert.match(generateRouteSource, /traceMode:\s*'admin_full'/)
  assert.match(generateRouteSource, /includeTrace:\s*true/)
  assert.match(generateRouteSource, /generationRunId/)
  assert.match(generateRouteSource, /AI_GENERATION_LOG_FAILED/)
  assert.match(generateRouteSource, /status:\s*isCancelledError \? 'cancelled' : 'generation_failed'/)
  assert.match(generateRouteSource, /attempts:\s*loopResult\.attempts/)
  assert.match(generateRouteSource, /lastQuestion:\s*loopResult\.lastQuestion/)
  assert.doesNotMatch(generateRouteSource, /return jsonWithBalance(?:Snapshot)?\([\s\S]{0,500}attempts:\s*loopResult\.attempts/)
  assert.doesNotMatch(generateRouteSource, /return jsonWithBalance(?:Snapshot)?\([\s\S]{0,500}lastQuestion:\s*loopResult\.lastQuestion/)
})

test('question save route links generationRunId to saved question with server-side validation helper', () => {
  assert.match(saveQuestionRouteSource, /generationRunId/)
  assert.match(saveQuestionRouteSource, /linkAiQuestionGenerationRunToQuestion/)
  assert.match(saveQuestionRouteSource, /workspaceSubject/)
  assert.match(saveQuestionRouteSource, /problemTypeId/)
  assert.match(saveQuestionRouteSource, /'textbook'/)
})

test('listboard run and retry persist item-level generation logs while status API selects safe columns', () => {
  for (const source of [listboardRunRouteSource, listboardRetryRouteSource]) {
    assert.match(source, /logAiQuestionGenerationRun/)
    assert.match(source, /listboard_job_id|listboardJobId/)
    assert.match(source, /listboard_job_item_id|listboardJobItemId/)
    assert.match(source, /traceMode:\s*'admin_full'/)
    assert.match(source, /includeTrace:\s*true/)
  }

  assert.doesNotMatch(listboardStatusRouteSource, /\.from\('generate_listboard_generation_job_items'\)[\s\S]{0,120}\.select\('\*'\)/)
  assert.match(listboardStatusRouteSource, /generated_question/)
  assert.match(listboardStatusRouteSource, /raw_ai_response/)
})
