'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { deleteProblemType, updateProblemTypeSortOrder } from './actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { Database } from '@/types/supabase'
import { DefaultPromptSettingsDialog } from './default-prompt-settings-dialog'

type ProblemType = Database['public']['Tables']['problem_types']['Row']
type AIModel = Database['public']['Tables']['ai_models']['Row']
type DefaultPrompt = Database['public']['Tables']['problem_type_default_prompts']['Row']
type AIProvider = 'openai' | 'gemini' | 'claude'

interface ProblemTypesClientProps {
  initialTypes: ProblemType[]
  initialModels: AIModel[]
  initialDefaultPrompts: DefaultPrompt[]
  workspaceSubject: WorkspaceSubject
}

export default function ProblemTypesClient({
  initialTypes,
  initialModels,
  initialDefaultPrompts,
  workspaceSubject,
}: ProblemTypesClientProps) {
  const router = useRouter()
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)
  const [bulkUpdating, setBulkUpdating] = useState(false)
  const [selectedTypeIds, setSelectedTypeIds] = useState<string[]>([])
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [sortOrderValues, setSortOrderValues] = useState<Record<string, string>>({})
  const [savingSortOrderIds, setSavingSortOrderIds] = useState<string[]>([])
  const [bulkGenerationProvider, setBulkGenerationProvider] = useState<AIProvider>('openai')
  const [bulkGenerationModelName, setBulkGenerationModelName] = useState('')
  const [bulkReviewProvider, setBulkReviewProvider] = useState<AIProvider>('openai')
  const [bulkReviewModelName, setBulkReviewModelName] = useState('')

  const aiTypeCount = useMemo(
    () => initialTypes.filter((type) => ['openai', 'gemini', 'claude'].includes(type.generation_provider || type.provider)).length,
    [initialTypes]
  )
  const selectedTypeCount = selectedTypeIds.length

  const providerOptions = useMemo(() => {
    const providers = (['openai', 'gemini', 'claude'] as const).filter((provider) =>
      initialModels.some((model) => model.provider === provider)
    )
    return providers.length > 0 ? providers : (['openai', 'gemini', 'claude'] as const)
  }, [initialModels])

  const generationModels = useMemo(
    () => initialModels
      .filter((model) => model.provider === bulkGenerationProvider)
      .sort((a, b) => a.display_order - b.display_order),
    [initialModels, bulkGenerationProvider]
  )

  const reviewModels = useMemo(
    () => initialModels
      .filter((model) => model.provider === bulkReviewProvider)
      .sort((a, b) => a.display_order - b.display_order),
    [initialModels, bulkReviewProvider]
  )

  useEffect(() => {
    if (providerOptions.length > 0 && !providerOptions.includes(bulkGenerationProvider)) {
      setBulkGenerationProvider(providerOptions[0])
      return
    }

    if (generationModels.length === 0) {
      setBulkGenerationModelName('')
      return
    }

    const currentModelExists = generationModels.some((model) => model.name === bulkGenerationModelName)
    if (!currentModelExists) {
      setBulkGenerationModelName(generationModels[0].name)
    }
  }, [providerOptions, bulkGenerationProvider, generationModels, bulkGenerationModelName])

  useEffect(() => {
    if (providerOptions.length > 0 && !providerOptions.includes(bulkReviewProvider)) {
      setBulkReviewProvider(providerOptions[0])
      return
    }

    if (reviewModels.length === 0) {
      setBulkReviewModelName('')
      return
    }

    const currentModelExists = reviewModels.some((model) => model.name === bulkReviewModelName)
    if (!currentModelExists) {
      setBulkReviewModelName(reviewModels[0].name)
    }
  }, [providerOptions, bulkReviewProvider, reviewModels, bulkReviewModelName])

  useEffect(() => {
    const typeIds = new Set(initialTypes.map((type) => type.id))
    setSelectedTypeIds((current) => current.filter((id) => typeIds.has(id)))
    setSortOrderValues(Object.fromEntries(
      initialTypes.map((type) => [type.id, String(type.sort_order ?? 0)])
    ))
  }, [initialTypes])

  const toggleSelectedType = (id: string) => {
    setSelectedTypeIds((current) =>
      current.includes(id) ? current.filter((typeId) => typeId !== id) : [...current, id]
    )
  }

  const handleDelete = async (id: string) => {
    if (!confirm("이 문제 유형을 정말 삭제하시겠습니까?")) return
    const result = await deleteProblemType(id)
    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success("문제 유형이 삭제되었습니다")
      setSelectedTypeIds((current) => current.filter((typeId) => typeId !== id))
      router.refresh()
    }
  }

  const handleSaveSortOrder = async (id: string) => {
    const rawValue = sortOrderValues[id] ?? '0'
    const nextSortOrder = Number(rawValue)

    if (!Number.isInteger(nextSortOrder) || nextSortOrder < 0) {
      toast.error('번호는 0 이상의 정수로 입력해주세요')
      return
    }

    setSavingSortOrderIds((current) => [...current, id])
    try {
      const result = await updateProblemTypeSortOrder(id, workspaceSubject, nextSortOrder)
      if (result?.error) {
        toast.error(result.error)
        return
      }

      toast.success('번호가 저장되었습니다')
      router.refresh()
    } finally {
      setSavingSortOrderIds((current) => current.filter((typeId) => typeId !== id))
    }
  }

  const handleBulkDelete = async () => {
    if (selectedTypeIds.length === 0 || bulkDeleting) return
    if (!confirm(`선택한 문제 유형 ${selectedTypeIds.length}개를 삭제하시겠습니까?`)) return

    setBulkDeleting(true)
    try {
      for (const id of selectedTypeIds) {
        const result = await deleteProblemType(id)
        if (result?.error) {
          throw new Error(result.error)
        }
      }

      toast.success(`문제 유형 ${selectedTypeIds.length}개가 삭제되었습니다`)
      setSelectedTypeIds([])
      router.refresh()
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '선택한 문제 유형 삭제에 실패했습니다')
    } finally {
      setBulkDeleting(false)
    }
  }

  const handleCreate = () => {
    router.push(withAdminWorkspaceSubject('/admin/problem-types/new', workspaceSubject))
  }

  const handleEdit = (id: string) => {
    router.push(withAdminWorkspaceSubject(`/admin/problem-types/${id}/edit`, workspaceSubject))
  }

  const handleTest = (id: string) => {
    router.push(withAdminWorkspaceSubject(`/admin/problem-types/${id}/test`, workspaceSubject))
  }

  const handleOpenBulkDialog = () => {
    if (aiTypeCount === 0) {
      toast.error('변경할 AI 문제 유형이 없습니다')
      return
    }
    setBulkDialogOpen(true)
  }

  const getProviderLabel = (provider: AIProvider) => {
    if (provider === 'openai') return 'OpenAI'
    if (provider === 'gemini') return 'Gemini'
    return 'Claude'
  }

  const handleGenerationProviderChange = (value: string) => {
    if (value === 'openai' || value === 'gemini' || value === 'claude') {
      setBulkGenerationProvider(value)
      setBulkGenerationModelName('')
    }
  }

  const handleReviewProviderChange = (value: string) => {
    if (value === 'openai' || value === 'gemini' || value === 'claude') {
      setBulkReviewProvider(value)
      setBulkReviewModelName('')
    }
  }

  const handleOpenConfirm = () => {
    if (!bulkGenerationModelName) {
      toast.error('문제 생성 API 모델을 선택해주세요')
      return
    }
    if (!bulkReviewModelName) {
      toast.error('문제 검토 API 모델을 선택해주세요')
      return
    }
    setBulkConfirmOpen(true)
  }

  const handleBulkUpdate = async () => {
    if (!bulkGenerationModelName || !bulkReviewModelName) return

    try {
      setBulkUpdating(true)

      const response = await fetch(withAdminWorkspaceSubject('/api/admin/problem-types', workspaceSubject), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generation_provider: bulkGenerationProvider,
          generation_model_name: bulkGenerationModelName,
          review_provider: bulkReviewProvider,
          review_model_name: bulkReviewModelName,
        }),
      })

      const result = await response.json()

      if (!response.ok || result.error) {
        throw new Error(result.error || '일괄 변경에 실패했습니다')
      }

      toast.success(`${result.updated_count ?? 0}개 AI 문제 유형의 생성/검토 모델을 일괄 변경했습니다`)
      setBulkConfirmOpen(false)
      setBulkDialogOpen(false)
      router.refresh()
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '일괄 변경 중 오류가 발생했습니다')
    } finally {
      setBulkUpdating(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">등록된 유형</h2>
        <div className="flex flex-col gap-2">
          <Button
            variant="destructive"
            onClick={() => void handleBulkDelete()}
            disabled={selectedTypeCount === 0 || bulkDeleting}
          >
            {bulkDeleting ? '삭제 중...' : `선택 삭제${selectedTypeCount > 0 ? ` (${selectedTypeCount})` : ''}`}
          </Button>
          <Button
            variant="outline"
            onClick={handleOpenBulkDialog}
            disabled={aiTypeCount === 0}
          >
            AI 모델 일괄 변경
          </Button>
          <div aria-label="기본 프롬프트 관리">
            <DefaultPromptSettingsDialog
              initialDefaultPrompts={initialDefaultPrompts}
              workspaceSubject={workspaceSubject}
            />
          </div>
          <Button onClick={handleCreate}>새 유형 추가</Button>
        </div>
      </div>

      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>AI 모델 일괄 변경</DialogTitle>
            <DialogDescription>
              등록된 AI 문제 유형 {aiTypeCount}개의 문제 생성 API와 문제 검토 API 모델을 한 번에 변경합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-3 rounded-lg border p-4">
              <h3 className="text-sm font-semibold">문제 생성 API</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>제공자</Label>
                  <Select value={bulkGenerationProvider} onValueChange={handleGenerationProviderChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="제공자 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {providerOptions.map((provider) => (
                        <SelectItem key={provider} value={provider}>
                          {getProviderLabel(provider)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>모델 이름</Label>
                  <Select value={bulkGenerationModelName || undefined} onValueChange={setBulkGenerationModelName}>
                    <SelectTrigger>
                      <SelectValue placeholder="모델 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {generationModels.length === 0 ? (
                        <SelectItem value="__empty__" disabled>선택 가능한 모델이 없습니다</SelectItem>
                      ) : (
                        generationModels.map((model) => (
                          <SelectItem key={model.id} value={model.name}>
                            {model.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border p-4">
              <h3 className="text-sm font-semibold">문제 검토 API</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>제공자</Label>
                  <Select value={bulkReviewProvider} onValueChange={handleReviewProviderChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="제공자 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {providerOptions.map((provider) => (
                        <SelectItem key={provider} value={provider}>
                          {getProviderLabel(provider)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>모델 이름</Label>
                  <Select value={bulkReviewModelName || undefined} onValueChange={setBulkReviewModelName}>
                    <SelectTrigger>
                      <SelectValue placeholder="모델 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {reviewModels.length === 0 ? (
                        <SelectItem value="__empty__" disabled>선택 가능한 모델이 없습니다</SelectItem>
                      ) : (
                        reviewModels.map((model) => (
                          <SelectItem key={model.id} value={model.name}>
                            {model.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="justify-center gap-2">
            <Button variant="outline" onClick={() => setBulkDialogOpen(false)} disabled={bulkUpdating}>
              취소
            </Button>
            <Button onClick={handleOpenConfirm} disabled={!bulkGenerationModelName || !bulkReviewModelName || bulkUpdating}>
              일괄 변경 적용
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>일괄 변경을 적용할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              등록된 AI 문제 유형 {aiTypeCount}개의 문제 생성 API를 {getProviderLabel(bulkGenerationProvider)} / {bulkGenerationModelName},
              문제 검토 API를 {getProviderLabel(bulkReviewProvider)} / {bulkReviewModelName}으로 변경합니다.
              기존 설정은 덮어써집니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkUpdating}>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkUpdating}
              onClick={(event) => {
                event.preventDefault()
                handleBulkUpdate()
              }}
            >
              {bulkUpdating ? '적용 중...' : '일괄 적용'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {initialTypes.map((type) => (
          <Card
            key={type.id}
            className={selectedTypeIds.includes(type.id) ? 'border-primary ring-1 ring-primary/30' : undefined}
          >
            <CardHeader>
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={selectedTypeIds.includes(type.id)}
                  onCheckedChange={() => toggleSelectedType(type.id)}
                  aria-label={`${type.type_name} 선택`}
                  disabled={bulkDeleting}
                  className="mt-1"
                />
                <div className="space-y-1">
                  <Label htmlFor={`sort-order-${type.id}`} className="text-xs text-gray-500">번호</Label>
                  <div className="flex items-center gap-1">
                    <Input
                      id={`sort-order-${type.id}`}
                      type="number"
                      min={0}
                      step={1}
                      value={sortOrderValues[type.id] ?? String(type.sort_order ?? 0)}
                      onChange={(event) => setSortOrderValues((current) => ({
                        ...current,
                        [type.id]: event.target.value,
                      }))}
                      className="h-8 w-16 text-center tabular-nums"
                      disabled={savingSortOrderIds.includes(type.id)}
                      aria-label={`${type.type_name} 번호`}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleSaveSortOrder(type.id)}
                      disabled={
                        savingSortOrderIds.includes(type.id) ||
                        (sortOrderValues[type.id] ?? String(type.sort_order ?? 0)) === String(type.sort_order ?? 0)
                      }
                    >
                      {savingSortOrderIds.includes(type.id) ? '저장 중...' : '저장'}
                    </Button>
                  </div>
                </div>
                <CardTitle className="flex flex-1 justify-between gap-3">
                  <span>{type.type_name}</span>
                  <span className={`text-xs px-2 py-1 rounded ${type.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                    {type.is_active ? '활성' : '비활성'}
                  </span>
                </CardTitle>
              </div>
              <CardDescription className="space-y-1">
                <span className="block">생성: {type.generation_provider || type.provider} / {type.generation_model_name || type.model_name}</span>
                <span className="block">검토: {type.review_provider && type.review_model_name ? `${type.review_provider} / ${type.review_model_name}` : '미설정'}</span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500 line-clamp-2 mb-4">{type.description}</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => handleTest(type.id)}>테스트</Button>
                <Button variant="outline" size="sm" onClick={() => handleEdit(type.id)}>수정</Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(type.id)}
                  disabled={bulkDeleting}
                >
                  삭제
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
