import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const promptSource = readSource('src/lib/ai/question-prompts.ts')
const workflowSource = readSource('src/lib/ai/question-generation-workflow.ts')
const newFormSource = readSource('src/app/(admin)/admin/problem-types/new/problem-type-form-client.tsx')
const editFormSource = readSource('src/app/(admin)/admin/problem-types/[id]/edit/problem-type-form-client.tsx')
const actionsSource = readSource('src/app/(admin)/admin/problem-types/actions.ts')
const createRouteSource = readSource('src/app/api/admin/problem-types/route.ts')
const updateRouteSource = readSource('src/app/api/admin/problem-types/[id]/route.ts')
const supabaseTypesSource = readSource('src/types/supabase.ts')
const migrationsDir = new URL('../supabase/migrations/', import.meta.url)

test('review prompt defaults are split into instruction prompt and response-structure prompt', () => {
  assert.match(promptSource, /export const DEFAULT_REVIEW_PROMPT/)
  assert.match(promptSource, /export const DEFAULT_REVIEW_RESPONSE_STRUCTURE_PROMPT/)
  const reviewPrompt = promptSource.match(/export const DEFAULT_REVIEW_PROMPT = `([\s\S]*?)`/)?.[1] || ''
  assert.doesNotMatch(reviewPrompt, /"passed"/)
  assert.doesNotMatch(reviewPrompt, /"issues"/)
})

test('question review workflow renders the review response structure as a separate section', () => {
  assert.match(workflowSource, /reviewResponseStructurePrompt/)
  assert.match(workflowSource, /splitReviewPromptTemplate/)
  assert.match(workflowSource, /검토 후 응답 구조 프롬프트 시작/)
  assert.match(workflowSource, /input\.promptBundle\.reviewResponseStructurePrompt/)
})

test('regeneration prompt is a separate configurable prompt for failed review retries', () => {
  assert.match(promptSource, /export const DEFAULT_REGENERATION_REQUEST_PROMPT/)
  assert.match(promptSource, /미통과.*상세 피드백/)
  assert.match(workflowSource, /regenerationPrompt/)
  assert.match(workflowSource, /미통과시 문제생성 요청 프롬프트 시작/)
  assert.match(workflowSource, /input\.promptBundle\.regenerationPrompt/)
})

test('problem type forms expose separate review prompt and review response structure fields', () => {
  for (const source of [newFormSource, editFormSource]) {
    assert.match(source, /문제 검토 프롬프트/)
    assert.match(source, /검토 후 응답 구조 프롬프트/)
    assert.match(source, /미통과시 문제생성 요청 프롬프트/)
    assert.match(source, /name="review_prompt_template"/)
    assert.match(source, /name="review_output_format"/)
    assert.match(source, /name="regeneration_prompt_template"/)
  }
  assert.match(newFormSource, /DEFAULT_REVIEW_RESPONSE_STRUCTURE_PROMPT/)
  assert.match(editFormSource, /splitReviewPromptTemplate/)
})

test('problem type actions and APIs persist review_output_format', () => {
  for (const source of [actionsSource, createRouteSource, updateRouteSource]) {
    assert.match(source, /review_output_format/)
    assert.match(source, /regeneration_prompt_template/)
  }
  assert.match(supabaseTypesSource, /review_output_format: string \| null/)
  assert.match(supabaseTypesSource, /review_output_format\?: string \| null/)
  assert.match(supabaseTypesSource, /regeneration_prompt_template: string \| null/)
  assert.match(supabaseTypesSource, /regeneration_prompt_template\?: string \| null/)
})

test('migration adds review_output_format column to problem_types', () => {
  const migrationName = readdirSync(migrationsDir).find((name) => name.includes('add_problem_type_review_output_format'))
  assert.ok(migrationName, 'add_problem_type_review_output_format migration should exist')
  assert.equal(existsSync(new URL(`../supabase/migrations/${migrationName}`, import.meta.url)), true)

  const migrationSource = readFileSync(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), 'utf8')
  assert.match(migrationSource, /add column if not exists review_output_format text/)
  assert.match(migrationSource, /comment on column public\.problem_types\.review_output_format/)
})

test('migration adds regeneration_prompt_template column to problem_types', () => {
  const migrationName = readdirSync(migrationsDir).find((name) => name.includes('add_problem_type_regeneration_prompt'))
  assert.ok(migrationName, 'add_problem_type_regeneration_prompt migration should exist')
  assert.equal(existsSync(new URL(`../supabase/migrations/${migrationName}`, import.meta.url)), true)

  const migrationSource = readFileSync(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), 'utf8')
  assert.match(migrationSource, /add column if not exists regeneration_prompt_template text/)
  assert.match(migrationSource, /comment on column public\.problem_types\.regeneration_prompt_template/)
})
