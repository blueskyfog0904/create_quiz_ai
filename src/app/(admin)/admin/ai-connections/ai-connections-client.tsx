'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type ProviderName = 'openai' | 'gemini' | 'claude'

type Connection = {
  provider: ProviderName
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

const PROVIDER_LABELS: Record<ProviderName, string> = {
  openai: 'OpenAI',
  gemini: 'Gemini',
  claude: 'Claude',
}

const PROVIDER_DESCRIPTIONS: Record<ProviderName, string> = {
  openai: 'Authorization Bearer 방식으로 OpenAI API를 호출합니다.',
  gemini: 'x-goog-api-key 헤더로 Gemini API를 호출합니다.',
  claude: 'x-api-key와 anthropic-version 헤더로 Claude Models API를 호출합니다.',
}

export default function AIConnectionsClient() {
  const [connections, setConnections] = useState<Connection[]>([])
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
  const [savingProvider, setSavingProvider] = useState<string | null>(null)
  const [testingProvider, setTestingProvider] = useState<string | null>(null)

  useEffect(() => {
    fetchConnections()
  }, [])

  const fetchConnections = async () => {
    const response = await fetch('/api/admin/ai-connections')
    const payload = await response.json()
    if (!response.ok) {
      toast.error(payload.error || 'AI API 연결 정보를 불러오지 못했습니다')
      return
    }
    setConnections(payload.data || [])
  }

  const updateConnection = (provider: ProviderName, patch: Partial<Connection>) => {
    setConnections((current) => current.map((connection) => (
      connection.provider === provider ? { ...connection, ...patch } : connection
    )))
  }

  const handleSave = async (connection: Connection) => {
    try {
      setSavingProvider(connection.provider)
      const response = await fetch(`/api/admin/ai-connections/${connection.provider}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: connection.displayName,
          isEnabled: connection.isEnabled,
          apiKey: apiKeys[connection.provider] || undefined,
          baseUrl: connection.baseUrl,
          organizationId: connection.organizationId,
          projectId: connection.projectId,
          anthropicVersion: connection.anthropicVersion,
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        toast.error(payload.error || '저장에 실패했습니다')
        return
      }
      updateConnection(connection.provider, payload.data)
      setApiKeys((current) => ({ ...current, [connection.provider]: '' }))
      toast.success('AI API 연결 설정을 저장했습니다')
    } finally {
      setSavingProvider(null)
    }
  }

  const handleTest = async (provider: ProviderName) => {
    try {
      setTestingProvider(provider)
      const response = await fetch(`/api/admin/ai-connections/${provider}/test`, { method: 'POST' })
      const payload = await response.json()
      await fetchConnections()
      if (!response.ok) {
        toast.error(payload.error || '연결 테스트에 실패했습니다')
        return
      }
      toast.success('연결 테스트에 성공했습니다')
    } finally {
      setTestingProvider(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">AI API 연결 관리</h1>
        <p className="text-sm text-gray-500 mt-1">
          OpenAI, Gemini, Claude API 키와 연결 옵션을 관리합니다. API Key는 저장 후 전체값을 다시 표시하지 않습니다.
        </p>
      </div>

      <div className="grid gap-4">
        {connections.map((connection) => (
          <Card key={connection.provider} className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>{PROVIDER_LABELS[connection.provider]}</CardTitle>
              <CardDescription>{PROVIDER_DESCRIPTIONS[connection.provider]}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <input
                  id={`${connection.provider}-enabled`}
                  type="checkbox"
                  className="h-4 w-4"
                  checked={connection.isEnabled}
                  onChange={(event) => updateConnection(connection.provider, { isEnabled: event.target.checked })}
                />
                <Label htmlFor={`${connection.provider}-enabled`}>사용</Label>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor={`${connection.provider}-api-key`}>API Key</Label>
                  <Input
                    id={`${connection.provider}-api-key`}
                    type="password"
                    value={apiKeys[connection.provider] || ''}
                    placeholder={connection.hasApiKey && connection.apiKeyLast4 ? `저장됨 ••••${connection.apiKeyLast4}` : 'API Key 입력'}
                    onChange={(event) => setApiKeys((current) => ({ ...current, [connection.provider]: event.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${connection.provider}-base-url`}>Base URL</Label>
                  <Input
                    id={`${connection.provider}-base-url`}
                    value={connection.baseUrl || ''}
                    onChange={(event) => updateConnection(connection.provider, { baseUrl: event.target.value })}
                  />
                </div>
              </div>

              {connection.provider === 'openai' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="openai-organization-id">Organization ID</Label>
                    <Input
                      id="openai-organization-id"
                      value={connection.organizationId || ''}
                      onChange={(event) => updateConnection('openai', { organizationId: event.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="openai-project-id">Project ID</Label>
                    <Input
                      id="openai-project-id"
                      value={connection.projectId || ''}
                      onChange={(event) => updateConnection('openai', { projectId: event.target.value })}
                    />
                  </div>
                </div>
              )}

              {connection.provider === 'claude' && (
                <div className="space-y-2">
                  <Label htmlFor="claude-anthropic-version">Anthropic Version</Label>
                  <Input
                    id="claude-anthropic-version"
                    value={connection.anthropicVersion || ''}
                    onChange={(event) => updateConnection('claude', { anthropicVersion: event.target.value })}
                  />
                </div>
              )}

              <div className="flex items-center justify-between border-t pt-4">
                <div className="text-sm text-gray-500">
                  {connection.lastTestStatus === 'success' && '최근 연결 테스트: 성공'}
                  {connection.lastTestStatus === 'failed' && `최근 연결 테스트: 실패${connection.lastError ? ` (${connection.lastError})` : ''}`}
                  {!connection.lastTestStatus && '아직 연결 테스트를 실행하지 않았습니다.'}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleTest(connection.provider)}
                    disabled={testingProvider === connection.provider}
                  >
                    {testingProvider === connection.provider ? '테스트 중...' : '연결 테스트'}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => handleSave(connection)}
                    disabled={savingProvider === connection.provider}
                  >
                    {savingProvider === connection.provider ? '저장 중...' : '저장'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
