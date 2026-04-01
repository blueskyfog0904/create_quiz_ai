'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { deleteProblemType } from './actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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

type ProblemType = Database['public']['Tables']['problem_types']['Row']
type AIModel = Database['public']['Tables']['ai_models']['Row']
type AIProvider = 'openai' | 'gemini'

interface ProblemTypesClientProps {
  initialTypes: ProblemType[]
  initialModels: AIModel[]
  workspaceSubject: WorkspaceSubject
}

export default function ProblemTypesClient({ initialTypes, initialModels, workspaceSubject }: ProblemTypesClientProps) {
  const router = useRouter()
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)
  const [bulkUpdating, setBulkUpdating] = useState(false)
  const [bulkProvider, setBulkProvider] = useState<AIProvider>('openai')
  const [bulkModelName, setBulkModelName] = useState('')

  const aiTypeCount = useMemo(
    () => initialTypes.filter((type) => type.provider === 'openai' || type.provider === 'gemini').length,
    [initialTypes]
  )

  const providerOptions = useMemo(() => {
    const providers = (['openai', 'gemini'] as const).filter((provider) =>
      initialModels.some((model) => model.provider === provider)
    )
    return providers.length > 0 ? providers : (['openai', 'gemini'] as const)
  }, [initialModels])

  const filteredModels = useMemo(
    () => initialModels
      .filter((model) => model.provider === bulkProvider)
      .sort((a, b) => a.display_order - b.display_order),
    [initialModels, bulkProvider]
  )

  useEffect(() => {
    if (providerOptions.length > 0 && !providerOptions.includes(bulkProvider)) {
      setBulkProvider(providerOptions[0])
      return
    }

    if (filteredModels.length === 0) {
      setBulkModelName('')
      return
    }

    const currentModelExists = filteredModels.some((model) => model.name === bulkModelName)
    if (!currentModelExists) {
      setBulkModelName(filteredModels[0].name)
    }
  }, [providerOptions, bulkProvider, filteredModels, bulkModelName])

  const handleDelete = async (id: string) => {
    if (!confirm("이 문제 유형을 정말 삭제하시겠습니까?")) return
    const result = await deleteProblemType(id)
    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success("문제 유형이 삭제되었습니다")
    }
  }

  const handleCreate = () => {
    router.push(withAdminWorkspaceSubject('/admin/problem-types/new', workspaceSubject))
  }

  const handleEdit = (id: string) => {
    router.push(withAdminWorkspaceSubject(`/admin/problem-types/${id}/edit`, workspaceSubject))
  }

  const handleOpenBulkDialog = () => {
    if (aiTypeCount === 0) {
      toast.error('변경할 AI 문제 유형이 없습니다')
      return
    }
    setBulkDialogOpen(true)
  }

  const handleProviderChange = (value: string) => {
    if (value === 'openai' || value === 'gemini') {
      setBulkProvider(value)
      setBulkModelName('')
    }
  }

  const handleOpenConfirm = () => {
    if (!bulkModelName) {
      toast.error('변경할 모델을 선택해주세요')
      return
    }
    setBulkConfirmOpen(true)
  }

  const handleBulkUpdate = async () => {
    if (!bulkModelName) return

    try {
      setBulkUpdating(true)

      const response = await fetch(withAdminWorkspaceSubject('/api/admin/problem-types', workspaceSubject), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: bulkProvider,
          model_name: bulkModelName,
        }),
      })

      const result = await response.json()

      if (!response.ok || result.error) {
        throw new Error(result.error || '일괄 변경에 실패했습니다')
      }

      toast.success(`${result.updated_count ?? 0}개 AI 문제 유형의 모델을 일괄 변경했습니다`)
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
            variant="outline"
            onClick={handleOpenBulkDialog}
            disabled={aiTypeCount === 0}
          >
            AI 모델 일괄 변경
          </Button>
          <Button onClick={handleCreate}>새 유형 추가</Button>
        </div>
      </div>

      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>AI 모델 일괄 변경</DialogTitle>
            <DialogDescription>
              등록된 AI 문제 유형 {aiTypeCount}개의 제공자/모델을 한 번에 변경합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>AI 제공자</Label>
              <Select value={bulkProvider} onValueChange={handleProviderChange}>
                <SelectTrigger>
                  <SelectValue placeholder="제공자 선택" />
                </SelectTrigger>
                <SelectContent>
                  {providerOptions.map((provider) => (
                    <SelectItem key={provider} value={provider}>
                      {provider === 'openai' ? 'OpenAI' : 'Gemini'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>모델 이름</Label>
              <Select value={bulkModelName || undefined} onValueChange={setBulkModelName}>
                <SelectTrigger>
                  <SelectValue placeholder="모델 선택" />
                </SelectTrigger>
                <SelectContent>
                  {filteredModels.length === 0 ? (
                    <SelectItem value="__empty__" disabled>선택 가능한 모델이 없습니다</SelectItem>
                  ) : (
                    filteredModels.map((model) => (
                      <SelectItem key={model.id} value={model.name}>
                        {model.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="justify-center gap-2">
            <Button variant="outline" onClick={() => setBulkDialogOpen(false)} disabled={bulkUpdating}>
              취소
            </Button>
            <Button onClick={handleOpenConfirm} disabled={!bulkModelName || bulkUpdating}>
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
              등록된 AI 문제 유형 {aiTypeCount}개의 모델을 {bulkProvider} / {bulkModelName}으로 변경합니다.
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
          <Card key={type.id}>
            <CardHeader>
              <CardTitle className="flex justify-between">
                <span>{type.type_name}</span>
                <span className={`text-xs px-2 py-1 rounded ${type.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                  {type.is_active ? '활성' : '비활성'}
                </span>
              </CardTitle>
              <CardDescription>{type.provider} / {type.model_name}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500 line-clamp-2 mb-4">{type.description}</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => handleEdit(type.id)}>수정</Button>
                <Button variant="destructive" size="sm" onClick={() => handleDelete(type.id)}>삭제</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
