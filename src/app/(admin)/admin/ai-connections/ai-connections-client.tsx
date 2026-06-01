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

type AIModel = {
  id: string
  name: string
  provider: ProviderName
  display_order: number
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
  const [models, setModels] = useState<AIModel[]>([])
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
  const [newModelNames, setNewModelNames] = useState<Record<string, string>>({})
  const [newModelOrders, setNewModelOrders] = useState<Record<string, number>>({})
  const [editingModel, setEditingModel] = useState<AIModel | null>(null)
  const [savingProvider, setSavingProvider] = useState<string | null>(null)
  const [testingProvider, setTestingProvider] = useState<string | null>(null)
  const [addingModelProvider, setAddingModelProvider] = useState<string | null>(null)
  const [modelActionId, setModelActionId] = useState<string | null>(null)

  useEffect(() => {
    fetchConnections()
    fetchModels()
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

  const fetchModels = async () => {
    const response = await fetch('/api/admin/ai-models')
    const payload = await response.json()
    if (!response.ok) {
      toast.error(payload.error || 'AI 모델 목록을 불러오지 못했습니다')
      return
    }
    setModels(payload.data || [])
  }

  const getProviderModels = (provider: ProviderName) => {
    return models
      .filter((model) => model.provider === provider)
      .sort((a, b) => a.display_order - b.display_order)
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

  const handleAddModel = async (provider: ProviderName) => {
    const name = newModelNames[provider]?.trim()
    if (!name) {
      toast.error('추가할 모델 이름을 입력해주세요')
      return
    }

    try {
      setAddingModelProvider(provider)
      const response = await fetch('/api/admin/ai-models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider,
          name,
          display_order: newModelOrders[provider] || getProviderModels(provider).length + 1,
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        toast.error(payload.error || '모델 추가에 실패했습니다')
        return
      }
      setNewModelNames((current) => ({ ...current, [provider]: '' }))
      await fetchModels()
      toast.success('AI 모델을 추가했습니다')
    } finally {
      setAddingModelProvider(null)
    }
  }

  const handleUpdateModel = async () => {
    if (!editingModel?.name.trim()) {
      toast.error('모델 이름을 입력해주세요')
      return
    }

    try {
      setModelActionId(editingModel.id)
      const response = await fetch('/api/admin/ai-models', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: editingModel.id,
          name: editingModel.name.trim(),
          display_order: editingModel.display_order,
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        toast.error(payload.error || '모델 수정에 실패했습니다')
        return
      }
      setEditingModel(null)
      await fetchModels()
      toast.success('AI 모델을 수정했습니다')
    } finally {
      setModelActionId(null)
    }
  }

  const handleDeleteModel = async (model: AIModel) => {
    if (!confirm(`${model.name} 모델을 삭제할까요?`)) return

    try {
      setModelActionId(model.id)
      const response = await fetch(`/api/admin/ai-models?id=${model.id}`, { method: 'DELETE' })
      const payload = await response.json()
      if (!response.ok) {
        toast.error(payload.error || '모델 삭제에 실패했습니다')
        return
      }
      await fetchModels()
      toast.success('AI 모델을 삭제했습니다')
    } finally {
      setModelActionId(null)
    }
  }

  const handleMoveModel = async (providerModels: AIModel[], model: AIModel, direction: 'up' | 'down') => {
    const currentIndex = providerModels.findIndex((item) => item.id === model.id)
    const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (currentIndex === -1 || nextIndex < 0 || nextIndex >= providerModels.length) return

    const targetModel = providerModels[nextIndex]
    try {
      setModelActionId(model.id)
      const responses = await Promise.all([
        fetch('/api/admin/ai-models', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: model.id, display_order: targetModel.display_order }),
        }),
        fetch('/api/admin/ai-models', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: targetModel.id, display_order: model.display_order }),
        }),
      ])
      const failed = responses.find((response) => !response.ok)
      if (failed) {
        const payload = await failed.json().catch(() => null)
        toast.error(payload?.error || '모델 순서 변경에 실패했습니다')
        return
      }
      await fetchModels()
    } finally {
      setModelActionId(null)
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
        {connections.map((connection) => {
          const providerModels = getProviderModels(connection.provider)
          const nextOrder = providerModels.length + 1

          return (
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

              <div className="space-y-3 border-t pt-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">사용 가능 모델 관리</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    {PROVIDER_LABELS[connection.provider]}에서 문제 생성/검토에 사용할 모델을 추가, 수정, 삭제하고 순서를 관리합니다.
                  </p>
                </div>

                <div className="grid grid-cols-[1fr_100px_auto] gap-2">
                  <Input
                    value={newModelNames[connection.provider] || ''}
                    placeholder="모델 이름 입력"
                    onChange={(event) => setNewModelNames((current) => ({
                      ...current,
                      [connection.provider]: event.target.value,
                    }))}
                  />
                  <Input
                    type="number"
                    min="1"
                    value={newModelOrders[connection.provider] || nextOrder}
                    onChange={(event) => setNewModelOrders((current) => ({
                      ...current,
                      [connection.provider]: Number(event.target.value) || nextOrder,
                    }))}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleAddModel(connection.provider)}
                    disabled={addingModelProvider === connection.provider}
                  >
                    {addingModelProvider === connection.provider ? '추가 중...' : '모델 추가'}
                  </Button>
                </div>

                <div className="space-y-2">
                  {providerModels.length === 0 ? (
                    <p className="rounded border border-dashed py-4 text-center text-sm text-gray-500">
                      등록된 모델이 없습니다.
                    </p>
                  ) : (
                    providerModels.map((model, index) => (
                      <div key={model.id} className="flex items-center gap-2 rounded-lg border p-3">
                        {editingModel?.id === model.id ? (
                          <>
                            <Input
                              value={editingModel.name}
                              onChange={(event) => setEditingModel({
                                ...editingModel,
                                name: event.target.value,
                              })}
                            />
                            <Input
                              className="w-24"
                              type="number"
                              min="1"
                              value={editingModel.display_order}
                              onChange={(event) => setEditingModel({
                                ...editingModel,
                                display_order: Number(event.target.value) || 1,
                              })}
                            />
                            <Button
                              type="button"
                              size="sm"
                              onClick={handleUpdateModel}
                              disabled={modelActionId === model.id}
                            >
                              저장
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setEditingModel(null)}
                            >
                              취소
                            </Button>
                          </>
                        ) : (
                          <>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-gray-900">{model.name}</p>
                              <p className="text-xs text-gray-500">순번 {model.display_order}</p>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={index === 0 || modelActionId === model.id}
                              onClick={() => handleMoveModel(providerModels, model, 'up')}
                            >
                              위로
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={index === providerModels.length - 1 || modelActionId === model.id}
                              onClick={() => handleMoveModel(providerModels, model, 'down')}
                            >
                              아래로
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setEditingModel(model)}
                            >
                              수정
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              disabled={modelActionId === model.id}
                              onClick={() => handleDeleteModel(model)}
                            >
                              삭제
                            </Button>
                          </>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
