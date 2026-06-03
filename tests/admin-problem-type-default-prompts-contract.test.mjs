import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const readIfExists = (path) => {
  const url = new URL(`../${path}`, import.meta.url)
  return existsSync(url) ? readFileSync(url, 'utf8') : ''
}

const migrationsDir = new URL('../supabase/migrations/', import.meta.url)
const actionsSource = readSource('src/app/(admin)/admin/problem-types/actions.ts')
const listClientSource = readSource('src/app/(admin)/admin/problem-types/problem-types-client.tsx')
const newPageSource = readSource('src/app/(admin)/admin/problem-types/new/page.tsx')
const editPageSource = readSource('src/app/(admin)/admin/problem-types/[id]/edit/page.tsx')
const newFormSource = readSource('src/app/(admin)/admin/problem-types/new/problem-type-form-client.tsx')
const editFormSource = readSource('src/app/(admin)/admin/problem-types/[id]/edit/problem-type-form-client.tsx')
const createRouteSource = readSource('src/app/api/admin/problem-types/route.ts')
const updateRouteSource = readSource('src/app/api/admin/problem-types/[id]/route.ts')
const defaultPromptRouteSource = readIfExists('src/app/api/admin/problem-type-default-prompts/route.ts')
const resolverSource = readIfExists('src/lib/ai/problem-type-default-prompts.ts')
const workflowSource = readSource('src/lib/ai/question-generation-workflow.ts')
const supabaseTypesSource = readSource('src/types/supabase.ts')

const modeFields = [
  'output_format_mode',
  'review_prompt_template_mode',
  'review_output_format_mode',
  'regeneration_prompt_template_mode',
]

const promptKeys = [
  'output_format',
  'review_prompt_template',
  'review_output_format',
  'regeneration_prompt_template',
]

test('migration creates workspace-scoped default prompt table, prompt modes, RLS, and seeds four prompt keys', () => {
  const migrationName = readdirSync(migrationsDir).find((name) => name.includes('create_problem_type_default_prompts'))
  assert.ok(migrationName, 'default prompt migration should exist')

  const migrationSource = readFileSync(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), 'utf8')
  assert.match(migrationSource, /create table if not exists public\.problem_type_default_prompts/i)
  assert.match(migrationSource, /workspace_subject text not null/i)
  assert.match(migrationSource, /prompt_key text not null/i)
  assert.match(migrationSource, /content text not null/i)
  assert.match(migrationSource, /problem_type_default_prompts_content_not_blank/i)
  assert.match(migrationSource, /is_enabled boolean not null default true/i)
  assert.match(migrationSource, /alter table public\.problem_type_default_prompts enable row level security/i)
  assert.match(migrationSource, /for select/i)
  assert.match(migrationSource, /is_admin/i)

  for (const modeField of modeFields) {
    assert.match(migrationSource, new RegExp(`add column if not exists ${modeField} text not null default 'custom'`, 'i'))
    assert.match(migrationSource, new RegExp(`${modeField} in \\('default', 'custom', 'disabled'\\)`, 'i'))
  }

  for (const promptKey of promptKeys) {
    assert.match(migrationSource, new RegExp(promptKey, 'i'))
  }
  assert.match(migrationSource, /'english'/i)
  assert.match(migrationSource, /'korean'/i)
})

test('generated Supabase types include default prompt table and problem type mode columns', () => {
  assert.match(supabaseTypesSource, /problem_type_default_prompts:/)
  assert.match(supabaseTypesSource, /prompt_key: string/)
  assert.match(supabaseTypesSource, /content: string/)
  assert.match(supabaseTypesSource, /is_enabled: boolean/)

  for (const modeField of modeFields) {
    assert.match(supabaseTypesSource, new RegExp(`${modeField}: string`))
    assert.match(supabaseTypesSource, new RegExp(`${modeField}\\?: string`))
  }
})

test('server actions and admin APIs persist prompt modes and default prompt settings consistently', () => {
  for (const source of [actionsSource, createRouteSource, updateRouteSource]) {
    for (const modeField of modeFields) {
      assert.match(source, new RegExp(modeField))
    }
  }

  assert.match(actionsSource, /updateProblemTypeDefaultPrompts/)
  assert.match(actionsSource, /content\.trim\(\)\.length/)
  assert.match(actionsSource, /review_prompt_template_mode.*disabled/s)
  assert.match(actionsSource, /review_output_format_mode.*disabled/s)

  assert.match(defaultPromptRouteSource, /problem_type_default_prompts/)
  assert.match(defaultPromptRouteSource, /PATCH/)
  assert.match(defaultPromptRouteSource, /is_enabled/)
  assert.match(defaultPromptRouteSource, /content\.trim\(\)\.length/)
  assert.match(defaultPromptRouteSource, /is_admin/)
})

test('problem type pages and forms expose default prompt management and per-field modes', () => {
  assert.match(listClientSource, /기본 프롬프트 관리/)
  assert.match(listClientSource, /DefaultPromptSettingsDialog/)
  assert.match(listClientSource, /initialDefaultPrompts/)

  for (const source of [newPageSource, editPageSource]) {
    assert.match(source, /problem_type_default_prompts/)
    assert.match(source, /defaultPrompts/)
  }

  for (const source of [newFormSource, editFormSource]) {
    assert.match(source, /기본값 사용/)
    assert.match(source, /개별 수정/)
    assert.match(source, /미적용/)
    assert.match(source, /defaultPrompts/)
    for (const modeField of modeFields) {
      assert.match(source, new RegExp(modeField))
    }
  }
})

test('resolver applies default custom disabled modes and workflow/routes use it consistently', () => {
  assert.match(resolverSource, /PROMPT_DEFAULT_KEYS/)
  assert.match(resolverSource, /getProblemTypeDefaultPrompts/)
  assert.match(resolverSource, /resolveProblemTypePromptBundle/)
  assert.match(resolverSource, /resolvePromptField/)
  assert.match(resolverSource, /mode === 'default'/)
  assert.match(resolverSource, /mode === 'disabled'/)
  assert.match(resolverSource, /DEFAULT_RESPONSE_STRUCTURE_PROMPT/)
  assert.match(resolverSource, /DEFAULT_REGENERATION_REQUEST_PROMPT/)

  assert.match(workflowSource, /resolveProblemTypePromptBundle/)
  assert.match(workflowSource, /defaultPrompts/)
  assert.match(workflowSource, /responseStructurePrompt\?/) 
  assert.match(workflowSource, /regenerationPrompt\?/) 

  const routePaths = [
    'src/app/api/questions/generate/route.ts',
    'src/app/api/questions/review/route.ts',
    'src/app/api/admin/problem-types/[id]/test/route.ts',
    'src/app/api/generate/listboard-jobs/[jobId]/run/route.ts',
    'src/app/api/generate/listboard-jobs/[jobId]/retry/route.ts',
  ]

  for (const path of routePaths) {
    const source = readSource(path)
    assert.match(source, /getProblemTypeDefaultPrompts/)
    assert.match(source, /defaultPrompts/)
    assert.match(source, /buildQuestionGenerationConfigFromProblemType\(problemType, \{ defaultPrompts \}\)/)
  }
})
