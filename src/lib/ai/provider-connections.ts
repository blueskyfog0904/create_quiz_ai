import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/bypass'
import type { Database } from '@/types/supabase'
import type { AIProvider } from './types'

type AiProviderConnectionRow = Database['public']['Tables']['ai_provider_connections']['Row']

export type AIProviderConnectionPublic = {
  provider: AIProvider
  displayName: string
  isEnabled: boolean
  hasApiKey: boolean
  apiKeyLast4: string | null
  baseUrl: string | null
  organizationId: string | null
  projectId: string | null
  anthropicVersion: string | null
  lastTestedAt: string | null
  lastTestStatus: string | null
  lastError: string | null
}

export type AIProviderRuntimeConfig = {
  provider: AIProvider
  baseUrl: string
  organizationId?: string
  projectId?: string
  anthropicVersion?: string
  apiKey: string
}

export type AIProviderConnectionInput = {
  provider: AIProvider
  displayName?: string
  isEnabled?: boolean
  apiKey?: string
  baseUrl?: string | null
  organizationId?: string | null
  projectId?: string | null
  anthropicVersion?: string | null
}

const PROVIDER_DEFAULTS: Record<AIProvider, { displayName: string; baseUrl: string; anthropicVersion?: string }> = {
  openai: { displayName: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  gemini: { displayName: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  claude: { displayName: 'Claude', baseUrl: 'https://api.anthropic.com', anthropicVersion: '2023-06-01' },
}

const ENV_KEY_BY_PROVIDER: Record<AIProvider, string> = {
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
}

function canUseConnectionTable() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

function getEncryptionKey() {
  const secret = process.env.AI_CREDENTIAL_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) {
    throw new Error('AI_CREDENTIAL_ENCRYPTION_KEY is not configured.')
  }
  return createHash('sha256').update(secret).digest()
}

export function encryptApiKey(apiKey: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':')
}

export function decryptApiKey(encryptedApiKey: string) {
  const [ivText, authTagText, encryptedText] = encryptedApiKey.split(':')
  if (!ivText || !authTagText || !encryptedText) {
    throw new Error('Encrypted API key format is invalid.')
  }

  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivText, 'base64'))
  decipher.setAuthTag(Buffer.from(authTagText, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

function normalizeBaseUrl(provider: AIProvider, baseUrl?: string | null) {
  return (baseUrl?.trim() || PROVIDER_DEFAULTS[provider].baseUrl).replace(/\/+$/, '')
}

function getApiKeyLast4(apiKey?: string | null) {
  const trimmed = apiKey?.trim()
  return trimmed ? trimmed.slice(-4) : null
}

function mapConnectionRow(row: AiProviderConnectionRow): AIProviderConnectionPublic {
  const provider = row.provider as AIProvider
  return {
    provider,
    displayName: row.display_name,
    isEnabled: row.is_enabled,
    hasApiKey: Boolean(row.encrypted_api_key),
    apiKeyLast4: row.api_key_last4,
    baseUrl: row.base_url,
    organizationId: row.organization_id,
    projectId: row.project_id,
    anthropicVersion: row.anthropic_version,
    lastTestedAt: row.last_tested_at,
    lastTestStatus: row.last_test_status,
    lastError: row.last_error,
  }
}

function buildEnvRuntimeConfig(provider: AIProvider): AIProviderRuntimeConfig | null {
  const apiKey = process.env[ENV_KEY_BY_PROVIDER[provider]]?.trim()
  if (!apiKey) return null

  return Object.assign({
    provider,
    baseUrl: normalizeBaseUrl(provider),
    organizationId: provider === 'openai' ? process.env.OPENAI_ORGANIZATION_ID || undefined : undefined,
    projectId: provider === 'openai' ? process.env.OPENAI_PROJECT_ID || undefined : undefined,
    anthropicVersion: provider === 'claude' ? PROVIDER_DEFAULTS.claude.anthropicVersion : undefined,
  }, { apiKey })
}

export async function getProviderRuntimeConfig(provider: AIProvider): Promise<AIProviderRuntimeConfig | null> {
  if (!canUseConnectionTable()) {
    return buildEnvRuntimeConfig(provider)
  }

  const adminSupabase = createAdminClient()
  const { data } = await adminSupabase
    .from('ai_provider_connections')
    .select('*')
    .eq('provider', provider)
    .maybeSingle()

  if (!data?.is_enabled || !data.encrypted_api_key) {
    return buildEnvRuntimeConfig(provider)
  }

  const decryptedApiKey = decryptApiKey(data.encrypted_api_key)
  return Object.assign({
    provider,
    baseUrl: normalizeBaseUrl(provider, data.base_url),
    organizationId: data.organization_id || undefined,
    projectId: data.project_id || undefined,
    anthropicVersion: data.anthropic_version || PROVIDER_DEFAULTS[provider].anthropicVersion,
  }, { apiKey: decryptedApiKey })
}

export async function listProviderConnectionsForAdmin() {
  if (!canUseConnectionTable()) {
    return (Object.entries(PROVIDER_DEFAULTS) as Array<[AIProvider, typeof PROVIDER_DEFAULTS[AIProvider]]>)
      .map(([provider, defaults]) => ({
        provider,
        displayName: defaults.displayName,
        isEnabled: false,
        hasApiKey: Boolean(process.env[ENV_KEY_BY_PROVIDER[provider]]),
        apiKeyLast4: getApiKeyLast4(process.env[ENV_KEY_BY_PROVIDER[provider]]),
        baseUrl: defaults.baseUrl,
        organizationId: null,
        projectId: null,
        anthropicVersion: defaults.anthropicVersion || null,
        lastTestedAt: null,
        lastTestStatus: null,
        lastError: null,
      }))
  }

  const adminSupabase = createAdminClient()
  const { data, error } = await adminSupabase
    .from('ai_provider_connections')
    .select('*')
    .order('provider')

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map(mapConnectionRow)
}

export async function saveProviderConnection(input: AIProviderConnectionInput) {
  if (!canUseConnectionTable()) {
    throw new Error('Supabase service role is required to save AI provider connections.')
  }

  const adminSupabase = createAdminClient()
  const providerDefaults = PROVIDER_DEFAULTS[input.provider]
  const apiKey = input.apiKey?.trim()
  const updateData: Database['public']['Tables']['ai_provider_connections']['Insert'] = {
    provider: input.provider,
    display_name: input.displayName || providerDefaults.displayName,
    is_enabled: input.isEnabled ?? false,
    base_url: normalizeBaseUrl(input.provider, input.baseUrl),
    organization_id: input.provider === 'openai' ? input.organizationId?.trim() || null : null,
    project_id: input.provider === 'openai' ? input.projectId?.trim() || null : null,
    anthropic_version: input.provider === 'claude'
      ? input.anthropicVersion?.trim() || providerDefaults.anthropicVersion || null
      : null,
    updated_at: new Date().toISOString(),
  }

  if (apiKey) {
    updateData.encrypted_api_key = encryptApiKey(apiKey)
    updateData.api_key_last4 = getApiKeyLast4(apiKey)
  }

  const { data, error } = await adminSupabase
    .from('ai_provider_connections')
    .upsert(updateData, { onConflict: 'provider' })
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return mapConnectionRow(data)
}

async function updateTestStatus(provider: AIProvider, status: 'success' | 'failed', errorMessage: string | null) {
  if (!canUseConnectionTable()) return

  await createAdminClient()
    .from('ai_provider_connections')
    .update({
      last_tested_at: new Date().toISOString(),
      last_test_status: status,
      last_error: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq('provider', provider)
}

export async function testProviderConnection(provider: AIProvider) {
  const config = await getProviderRuntimeConfig(provider)

  if (!config) {
    const message = 'API key is not configured.'
    await updateTestStatus(provider, 'failed', message)
    return { success: false, error: message }
  }

  try {
    let response: Response
    if (provider === 'openai') {
      response = await fetch(`${config.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          ...(config.organizationId ? { 'OpenAI-Organization': config.organizationId } : {}),
          ...(config.projectId ? { 'OpenAI-Project': config.projectId } : {}),
        },
      })
    } else if (provider === 'gemini') {
      response = await fetch(`${config.baseUrl}/models`, {
        headers: {
          'x-goog-api-key': config.apiKey,
        },
      })
    } else {
      response = await fetch(`${config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': config.anthropicVersion || '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      })
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText)
      const message = `Connection test failed (${response.status}): ${errorText.slice(0, 300)}`
      await updateTestStatus(provider, 'failed', message)
      return { success: false, error: message }
    }

    await updateTestStatus(provider, 'success', null)
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection test failed.'
    await updateTestStatus(provider, 'failed', message)
    return { success: false, error: message }
  }
}
