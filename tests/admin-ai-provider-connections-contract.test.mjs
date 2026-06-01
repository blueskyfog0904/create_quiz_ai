import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const migrationPath = 'supabase/migrations/20260601020000_add_ai_provider_connections_and_split_problem_type_models.sql'
const connectionsLibPath = 'src/lib/ai/provider-connections.ts'
const connectionsPagePath = 'src/app/(admin)/admin/ai-connections/page.tsx'
const connectionsClientPath = 'src/app/(admin)/admin/ai-connections/ai-connections-client.tsx'
const connectionsRoutePath = 'src/app/api/admin/ai-connections/route.ts'
const connectionProviderRoutePath = 'src/app/api/admin/ai-connections/[provider]/route.ts'
const connectionTestRoutePath = 'src/app/api/admin/ai-connections/[provider]/test/route.ts'

test('AI provider connection migration stores encrypted provider credentials with RLS', () => {
  assert.equal(existsSync(new URL(`../${migrationPath}`, import.meta.url)), true)

  const migration = readSource(migrationPath)

  assert.match(migration, /create\s+table\s+if\s+not\s+exists\s+public\.ai_provider_connections/i)
  assert.match(migration, /provider\s+text\s+not\s+null/i)
  assert.match(migration, /encrypted_api_key\s+text/i)
  assert.match(migration, /api_key_last4\s+text/i)
  assert.match(migration, /base_url\s+text/i)
  assert.match(migration, /organization_id\s+text/i)
  assert.match(migration, /project_id\s+text/i)
  assert.match(migration, /anthropic_version\s+text/i)
  assert.match(migration, /last_tested_at\s+timestamptz/i)
  assert.match(migration, /last_test_status\s+text/i)
  assert.match(migration, /alter\s+table\s+public\.ai_provider_connections\s+enable\s+row\s+level\s+security/i)
  assert.match(migration, /provider\s+in\s*\(\s*'openai'\s*,\s*'gemini'\s*,\s*'claude'\s*\)/i)
})

test('provider connection library encrypts keys and keeps env fallback per official API requirements', () => {
  assert.equal(existsSync(new URL(`../${connectionsLibPath}`, import.meta.url)), true)

  const source = readSource(connectionsLibPath)

  assert.match(source, /createCipheriv\('aes-256-gcm'/)
  assert.match(source, /createDecipheriv\('aes-256-gcm'/)
  assert.match(source, /AI_CREDENTIAL_ENCRYPTION_KEY/)
  assert.match(source, /OPENAI_API_KEY/)
  assert.match(source, /GEMINI_API_KEY/)
  assert.match(source, /ANTHROPIC_API_KEY/)
  assert.match(source, /organizationId/)
  assert.match(source, /projectId/)
  assert.match(source, /anthropicVersion/)
  assert.match(source, /apiKeyLast4/)
  assert.doesNotMatch(source, /return\s+\{[\s\S]{0,200}apiKey:[\s\S]{0,200}\}/)
})

test('Claude connection test validates credentials through the current Models API without hardcoded message models', () => {
  const source = readSource(connectionsLibPath)
  const clientSource = readSource(connectionsClientPath)

  assert.match(source, /provider === 'claude'[\s\S]{0,500}\/v1\/models/)
  assert.doesNotMatch(source, /claude-3-haiku-20240307/)
  assert.doesNotMatch(source, /provider === 'claude'[\s\S]{0,500}\/v1\/messages/)
  assert.match(clientSource, /Claude Models API/)
})

test('admin AI connection UI and APIs expose provider-specific fields without returning plaintext keys', () => {
  for (const path of [connectionsPagePath, connectionsClientPath, connectionsRoutePath, connectionProviderRoutePath, connectionTestRoutePath]) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true, `${path} should exist`)
  }

  const clientSource = readSource(connectionsClientPath)
  const routeSource = readSource(connectionsRoutePath)
  const providerRouteSource = readSource(connectionProviderRoutePath)
  const testRouteSource = readSource(connectionTestRoutePath)

  for (const provider of ['openai', 'gemini', 'claude']) {
    assert.match(clientSource, new RegExp(provider))
  }

  assert.match(clientSource, /Organization ID/)
  assert.match(clientSource, /Project ID/)
  assert.match(clientSource, /Anthropic Version/)
  assert.match(clientSource, /Base URL/)
  assert.match(clientSource, /연결 테스트/)
  assert.match(routeSource, /select\('is_admin'\)/)
  assert.match(providerRouteSource, /saveProviderConnection/)
  assert.match(providerRouteSource, /apiKey/)
  assert.doesNotMatch(routeSource, /api_key:[\s\S]{0,80}encrypted_api_key/)
  assert.doesNotMatch(providerRouteSource, /return NextResponse\.json\(\{[\s\S]{0,120}apiKey/)
  assert.match(testRouteSource, /testProviderConnection/)
})
