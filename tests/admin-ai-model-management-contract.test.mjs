import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const aiConnectionsClientPath = 'src/app/(admin)/admin/ai-connections/ai-connections-client.tsx'
const aiModelsRoutePath = 'src/app/api/admin/ai-models/route.ts'
const seedMigrationPath = 'supabase/migrations/20260601031000_seed_current_ai_models.sql'

test('AI API connection admin page manages models per provider company', () => {
  const source = readSource(aiConnectionsClientPath)

  assert.match(source, /AIModel/)
  assert.match(source, /fetchModels/)
  assert.match(source, /handleAddModel/)
  assert.match(source, /handleUpdateModel/)
  assert.match(source, /handleDeleteModel/)
  assert.match(source, /handleMoveModel/)
  assert.match(source, /사용 가능 모델 관리/)
  assert.match(source, /newModelNames/)
  assert.match(source, /editingModel/)
})

test('AI models admin API continues to expose create update delete operations for managed model options', () => {
  const source = readSource(aiModelsRoutePath)

  assert.match(source, /export async function POST/)
  assert.match(source, /export async function PUT/)
  assert.match(source, /export async function DELETE/)
  assert.match(source, /\.from\('ai_models'\)/)
})

test('current default AI model seed includes OpenAI, Gemini, and Claude model families', () => {
  assert.equal(existsSync(new URL(`../${seedMigrationPath}`, import.meta.url)), true)
  const source = readSource(seedMigrationPath)

  assert.match(source, /gpt-5\.2/)
  assert.match(source, /gpt-5-mini/)
  assert.match(source, /gemini-2\.5-flash/)
  assert.match(source, /gemini-2\.5-pro/)
  assert.match(source, /gemini-3-pro-preview/)
  assert.match(source, /claude-opus-4-8/)
  assert.match(source, /claude-sonnet-4-6/)
  assert.match(source, /claude-haiku-4-5-20251001/)
  assert.match(source, /on conflict\s*\(name,\s*provider\)/i)
})
