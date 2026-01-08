'use client'

import { useState, useEffect, useCallback } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Settings, Plus, Trash2, ArrowUp, ArrowDown, Save } from 'lucide-react'

interface AIModel {
  id: string
  name: string
  provider: string
  display_order: number
}

interface ModelSelectorProps {
  value?: string
  onValueChange: (value: string) => void
  provider: string
  required?: boolean
}

export function ModelSelector({ value, onValueChange, provider, required }: ModelSelectorProps) {
  const [models, setModels] = useState<AIModel[]>([])
  const [loading, setLoading] = useState(true)
  const [manageOpen, setManageOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<AIModel | null>(null)
  const [newModelName, setNewModelName] = useState('')
  const [newModelOrder, setNewModelOrder] = useState(1)

  // 모델 목록 불러오기
  const fetchModels = useCallback(async () => {
    // provider가 없으면 모델을 로드하지 않음
    if (!provider || provider.trim() === '') {
      setModels([])
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const response = await fetch(`/api/admin/ai-models?provider=${provider}`)
      const result = await response.json()
      if (result.error) {
        toast.error(result.error)
        setModels([])
      } else {
        setModels(result.data || [])
      }
    } catch (error: any) {
      toast.error('모델 목록을 불러오는데 실패했습니다')
      setModels([])
    } finally {
      setLoading(false)
    }
  }, [provider])

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  // provider 변경 시 모델 목록이 로드되면 첫 번째 모델 자동 선택
  useEffect(() => {
    if (!loading && models.length > 0) {
      const sortedModels = [...models].sort((a, b) => a.display_order - b.display_order)
      const currentModelExists = value && models.some(m => m.name === value)
      
      // 현재 선택된 모델이 목록에 없거나, value가 비어있으면 첫 번째 모델 선택
      if (!currentModelExists && sortedModels.length > 0) {
        onValueChange(sortedModels[0].name)
      }
    }
  }, [models, loading, value, onValueChange])

  // 모델 추가
  const handleAddModel = async () => {
    if (!newModelName.trim()) {
      toast.error('모델 이름을 입력하세요')
      return
    }

    try {
      const response = await fetch('/api/admin/ai-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newModelName.trim(),
          provider,
          display_order: newModelOrder
        })
      })

      const result = await response.json()
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('모델이 추가되었습니다')
        setNewModelName('')
        setNewModelOrder(1)
        fetchModels()
      }
    } catch (error: any) {
      toast.error('모델 추가에 실패했습니다')
    }
  }

  // 모델 수정
  const handleUpdateModel = async () => {
    if (!editingModel || !editingModel.name.trim()) {
      toast.error('모델 이름을 입력하세요')
      return
    }

    try {
      const response = await fetch('/api/admin/ai-models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingModel.id,
          name: editingModel.name.trim(),
          display_order: editingModel.display_order
        })
      })

      const result = await response.json()
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('모델이 수정되었습니다')
        setEditingModel(null)
        fetchModels()
        // 현재 선택된 모델이 수정된 모델이면 값 업데이트
        if (value === editingModel.name) {
          onValueChange(editingModel.name.trim())
        }
      }
    } catch (error: any) {
      toast.error('모델 수정에 실패했습니다')
    }
  }

  // 모델 삭제
  const handleDeleteModel = async (id: string) => {
    if (!confirm('정말 이 모델을 삭제하시겠습니까?')) {
      return
    }

    try {
      const response = await fetch(`/api/admin/ai-models?id=${id}`, {
        method: 'DELETE'
      })

      const result = await response.json()
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('모델이 삭제되었습니다')
        fetchModels()
        // 삭제된 모델이 현재 선택된 모델이면 초기화
        const deletedModel = models.find(m => m.id === id)
        if (deletedModel && value === deletedModel.name) {
          const remainingModels = models.filter(m => m.id !== id)
          if (remainingModels.length > 0) {
            onValueChange(remainingModels[0].name)
          } else {
            onValueChange('')
          }
        }
      }
    } catch (error: any) {
      toast.error('모델 삭제에 실패했습니다')
    }
  }

  // 순서 변경
  const handleMoveOrder = async (model: AIModel, direction: 'up' | 'down') => {
    const currentIndex = models.findIndex(m => m.id === model.id)
    if (currentIndex === -1) return

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (newIndex < 0 || newIndex >= models.length) return

    const targetModel = models[newIndex]
    const newOrder = targetModel.display_order
    const targetNewOrder = model.display_order

    try {
      // 두 모델의 순서를 교환
      await Promise.all([
        fetch('/api/admin/ai-models', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: model.id,
            display_order: newOrder
          })
        }),
        fetch('/api/admin/ai-models', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: targetModel.id,
            display_order: targetNewOrder
          })
        })
      ])

      fetchModels()
    } catch (error: any) {
      toast.error('순서 변경에 실패했습니다')
    }
  }

  const sortedModels = [...models].sort((a, b) => a.display_order - b.display_order)
  const isDisabled = !provider || provider.trim() === ''

  return (
    <div className="flex gap-2">
      <Select 
        value={value || undefined} 
        onValueChange={onValueChange} 
        required={required}
        disabled={isDisabled}
      >
        <SelectTrigger className="flex-1">
          <SelectValue placeholder={isDisabled ? "제공자를 먼저 선택하세요" : "모델 선택"} />
        </SelectTrigger>
        <SelectContent>
          {isDisabled ? (
            <SelectItem value="__disabled__" disabled>제공자를 먼저 선택하세요</SelectItem>
          ) : loading ? (
            <SelectItem value="__loading__" disabled>로딩 중...</SelectItem>
          ) : sortedModels.length === 0 ? (
            <SelectItem value="__empty__" disabled>모델이 없습니다</SelectItem>
          ) : (
            sortedModels.map((model) => (
              <SelectItem key={model.id} value={model.name}>
                {model.name}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
      
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="icon" title="모델 관리">
            <Settings className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>모델 관리</DialogTitle>
            <DialogDescription>
              AI 모델을 추가, 수정, 삭제하고 드롭다운 표시 순서를 변경할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6 mt-4">
            {/* 모델 추가 */}
            <div className="space-y-4">
              <h3 className="font-semibold">모델 추가</h3>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Label htmlFor="new-model-name">모델 이름</Label>
                  <Input
                    id="new-model-name"
                    value={newModelName}
                    onChange={(e) => setNewModelName(e.target.value)}
                    placeholder="gpt-4o, gemini-pro..."
                  />
                </div>
                <div>
                  <Label htmlFor="new-model-order">순번</Label>
                  <Input
                    id="new-model-order"
                    type="number"
                    value={newModelOrder}
                    onChange={(e) => setNewModelOrder(parseInt(e.target.value) || 1)}
                    min="1"
                  />
                </div>
              </div>
              <Button onClick={handleAddModel} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                추가
              </Button>
            </div>

            {/* 모델 목록 */}
            <div className="space-y-4">
              <h3 className="font-semibold">모델 목록</h3>
              <div className="space-y-2">
                {sortedModels.map((model, index) => (
                  <div
                    key={model.id}
                    className="flex items-center gap-2 p-3 border rounded-lg"
                  >
                    <div className="flex-1">
                      {editingModel?.id === model.id ? (
                        <div className="flex gap-2">
                          <Input
                            value={editingModel.name}
                            onChange={(e) => setEditingModel({ ...editingModel, name: e.target.value })}
                            className="flex-1"
                          />
                          <Input
                            type="number"
                            value={editingModel.display_order}
                            onChange={(e) => setEditingModel({ ...editingModel, display_order: parseInt(e.target.value) || 1 })}
                            className="w-20"
                            min="1"
                          />
                          <Button
                            onClick={handleUpdateModel}
                            size="sm"
                            variant="default"
                          >
                            <Save className="h-4 w-4" />
                          </Button>
                          <Button
                            onClick={() => setEditingModel(null)}
                            size="sm"
                            variant="outline"
                          >
                            취소
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-medium">{model.name}</span>
                            <span className="text-sm text-gray-500 ml-2">(순번: {model.display_order})</span>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              onClick={() => handleMoveOrder(model, 'up')}
                              size="sm"
                              variant="ghost"
                              disabled={index === 0}
                              title="위로 이동"
                            >
                              <ArrowUp className="h-4 w-4" />
                            </Button>
                            <Button
                              onClick={() => handleMoveOrder(model, 'down')}
                              size="sm"
                              variant="ghost"
                              disabled={index === sortedModels.length - 1}
                              title="아래로 이동"
                            >
                              <ArrowDown className="h-4 w-4" />
                            </Button>
                            <Button
                              onClick={() => setEditingModel(model)}
                              size="sm"
                              variant="ghost"
                              title="수정"
                            >
                              수정
                            </Button>
                            <Button
                              onClick={() => handleDeleteModel(model.id)}
                              size="sm"
                              variant="ghost"
                              title="삭제"
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {sortedModels.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-4">등록된 모델이 없습니다</p>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
