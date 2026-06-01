import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const newFormSource = readSource('src/app/(admin)/admin/problem-types/new/problem-type-form-client.tsx')
const editFormSource = readSource('src/app/(admin)/admin/problem-types/[id]/edit/problem-type-form-client.tsx')
const listClientSource = readSource('src/app/(admin)/admin/problem-types/problem-types-client.tsx')
const actionsSource = readSource('src/app/(admin)/admin/problem-types/actions.ts')
const createRouteSource = readSource('src/app/api/admin/problem-types/route.ts')
const updateRouteSource = readSource('src/app/api/admin/problem-types/[id]/route.ts')
const migrationSource = readSource('supabase/migrations/20260601020000_add_ai_provider_connections_and_split_problem_type_models.sql')

test('problem type forms collect separate generation and review API provider/model settings', () => {
  for (const source of [newFormSource, editFormSource]) {
    assert.match(source, /문제 생성 API 설정/)
    assert.match(source, /문제 검토 API 설정/)
    assert.match(source, /name="generation_provider"/)
    assert.match(source, /name="generation_model_name"/)
    assert.match(source, /name="review_provider"/)
    assert.match(source, /name="review_model_name"/)
    assert.match(source, /generationProvider/)
    assert.match(source, /reviewProvider/)
    assert.match(source, /generationModelName/)
    assert.match(source, /reviewModelName/)
  }
})

test('problem type server actions persist split model fields while keeping legacy provider/model columns', () => {
  assert.match(actionsSource, /generation_provider/)
  assert.match(actionsSource, /generation_model_name/)
  assert.match(actionsSource, /review_provider/)
  assert.match(actionsSource, /review_model_name/)
  assert.match(actionsSource, /provider:\s*validated\.data\.generation_provider/)
  assert.match(actionsSource, /model_name:\s*validated\.data\.generation_model_name/)
})

test('problem type admin APIs validate split provider fields and accept claude', () => {
  for (const source of [createRouteSource, updateRouteSource]) {
    assert.match(source, /generation_provider/)
    assert.match(source, /generation_model_name/)
    assert.match(source, /review_provider/)
    assert.match(source, /review_model_name/)
    assert.match(source, /claude/)
  }
})

test('problem type bulk model update changes generation and review API settings together', () => {
  assert.match(listClientSource, /bulkGenerationProvider/)
  assert.match(listClientSource, /bulkGenerationModelName/)
  assert.match(listClientSource, /bulkReviewProvider/)
  assert.match(listClientSource, /bulkReviewModelName/)
  assert.match(listClientSource, /generation_provider:\s*bulkGenerationProvider/)
  assert.match(listClientSource, /generation_model_name:\s*bulkGenerationModelName/)
  assert.match(listClientSource, /review_provider:\s*bulkReviewProvider/)
  assert.match(listClientSource, /review_model_name:\s*bulkReviewModelName/)
  assert.match(createRouteSource, /generation_provider:[\s\S]*review_provider:[\s\S]*review_model_name:/)
  assert.match(createRouteSource, /review_provider:\s*reviewProvider/)
  assert.match(createRouteSource, /review_model_name:\s*reviewModelName/)
})

test('problem type migration backfills only generation config and leaves review config nullable', () => {
  assert.match(migrationSource, /add\s+column\s+if\s+not\s+exists\s+generation_provider\s+text/i)
  assert.match(migrationSource, /add\s+column\s+if\s+not\s+exists\s+generation_model_name\s+text/i)
  assert.match(migrationSource, /add\s+column\s+if\s+not\s+exists\s+review_provider\s+text/i)
  assert.match(migrationSource, /add\s+column\s+if\s+not\s+exists\s+review_model_name\s+text/i)
  assert.match(migrationSource, /set\s+generation_provider\s+=\s+coalesce\(generation_provider,\s+provider\)/i)
  assert.doesNotMatch(migrationSource, /set\s+review_provider\s+=\s+coalesce\(review_provider,\s+provider\)/i)
  assert.doesNotMatch(migrationSource, /set\s+review_model_name\s+=\s+coalesce\(review_model_name,\s+model_name\)/i)
})
