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

interface Provider {
  id: string
  name: string
  display_name: string
  display_order: number
  is_active: boolean
}

interface ProviderSelectorProps {
  value?: string
  onValueChange: (value: string) => void
  required?: boolean
}

export function ProviderSelector({ value, onValueChange, required }: ProviderSelectorProps) {
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [manageOpen, setManageOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null)
  const [newProviderName, setNewProviderName] = useState('')
  const [newProviderDisplayName, setNewProviderDisplayName] = useState('')
  const [newProviderOrder, setNewProviderOrder] = useState(1)

  // Provider 목록 불러오기
  const fetchProviders = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/admin/providers')
      const result = await response.json()
      if (result.error) {
        toast.error(result.error)
      } else {
        setProviders(result.data || [])
      }
    } catch (error: any) {
      toast.error('제공자 목록을 불러오는데 실패했습니다')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

  // 첫 번째 provider 자동 선택 (초기 로드 시에만)
  useEffect(() => {
    if (!loading && providers.length > 0 && !value) {
      const sortedProviders = [...providers].sort((a, b) => a.display_order - b.display_order)
      if (sortedProviders.length > 0) {
        onValueChange(sortedProviders[0].name)
      }
    }
  }, [loading, providers, value, onValueChange])

  // Provider 추가
  const handleAddProvider = async () => {
    if (!newProviderName.trim() || !newProviderDisplayName.trim()) {
      toast.error('제공자 이름과 표시 이름을 입력하세요')
      return
    }

    try {
      const response = await fetch('/api/admin/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProviderName.trim(),
          display_name: newProviderDisplayName.trim(),
          display_order: newProviderOrder
        })
      })

      const result = await response.json()
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('제공자가 추가되었습니다')
        setNewProviderName('')
        setNewProviderDisplayName('')
        setNewProviderOrder(1)
        fetchProviders()
      }
    } catch (error: any) {
      toast.error('제공자 추가에 실패했습니다')
    }
  }

  // Provider 수정
  const handleUpdateProvider = async () => {
    if (!editingProvider || !editingProvider.name.trim() || !editingProvider.display_name.trim()) {
      toast.error('제공자 이름과 표시 이름을 입력하세요')
      return
    }

    try {
      const response = await fetch('/api/admin/providers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingProvider.id,
          name: editingProvider.name.trim(),
          display_name: editingProvider.display_name.trim(),
          display_order: editingProvider.display_order
        })
      })

      const result = await response.json()
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('제공자가 수정되었습니다')
        setEditingProvider(null)
        fetchProviders()
        // 현재 선택된 제공자가 수정된 제공자면 값 업데이트
        if (value === editingProvider.name) {
          onValueChange(editingProvider.name.trim())
        }
      }
    } catch (error: any) {
      toast.error('제공자 수정에 실패했습니다')
    }
  }

  // Provider 삭제
  const handleDeleteProvider = async (id: string) => {
    if (!confirm('정말 이 제공자를 삭제하시겠습니까?')) {
      return
    }

    try {
      const response = await fetch(`/api/admin/providers?id=${id}`, {
        method: 'DELETE'
      })

      const result = await response.json()
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('제공자가 삭제되었습니다')
        fetchProviders()
        // 삭제된 제공자가 현재 선택된 제공자면 초기화
        const deletedProvider = providers.find(p => p.id === id)
        if (deletedProvider && value === deletedProvider.name) {
          const remainingProviders = providers.filter(p => p.id !== id)
          if (remainingProviders.length > 0) {
            const sortedProviders = [...remainingProviders].sort((a, b) => a.display_order - b.display_order)
            onValueChange(sortedProviders[0].name)
          } else {
            onValueChange('')
          }
        }
      }
    } catch (error: any) {
      toast.error('제공자 삭제에 실패했습니다')
    }
  }

  // 순서 변경
  const handleMoveOrder = async (provider: Provider, direction: 'up' | 'down') => {
    const currentIndex = providers.findIndex(p => p.id === provider.id)
    if (currentIndex === -1) return

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (newIndex < 0 || newIndex >= providers.length) return

    const targetProvider = providers[newIndex]
    const newOrder = targetProvider.display_order
    const targetNewOrder = provider.display_order

    try {
      // 두 제공자의 순서를 교환
      await Promise.all([
        fetch('/api/admin/providers', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: provider.id,
            display_order: newOrder
          })
        }),
        fetch('/api/admin/providers', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: targetProvider.id,
            display_order: targetNewOrder
          })
        })
      ])

      fetchProviders()
    } catch (error: any) {
      toast.error('순서 변경에 실패했습니다')
    }
  }

  const sortedProviders = [...providers].sort((a, b) => a.display_order - b.display_order)

  return (
    <div className="flex gap-2">
      <Select value={value || undefined} onValueChange={onValueChange} required={required}>
        <SelectTrigger className="flex-1">
          <SelectValue placeholder="제공자 선택" />
        </SelectTrigger>
        <SelectContent>
          {loading ? (
            <SelectItem value="__loading__" disabled>로딩 중...</SelectItem>
          ) : sortedProviders.length === 0 ? (
            <SelectItem value="__empty__" disabled>제공자가 없습니다</SelectItem>
          ) : (
            sortedProviders.map((provider) => (
              <SelectItem key={provider.id} value={provider.name}>
                {provider.display_name}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
      
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="icon" title="제공자 관리">
            <Settings className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>제공자 관리</DialogTitle>
            <DialogDescription>
              AI 제공자를 추가, 수정, 삭제하고 드롭다운 표시 순서를 변경할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6 mt-4">
            {/* 제공자 추가 */}
            <div className="space-y-4">
              <h3 className="font-semibold">제공자 추가</h3>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label htmlFor="new-provider-name">제공자 이름</Label>
                  <Input
                    id="new-provider-name"
                    value={newProviderName}
                    onChange={(e) => setNewProviderName(e.target.value)}
                    placeholder="openai, gemini..."
                  />
                </div>
                <div>
                  <Label htmlFor="new-provider-display-name">표시 이름</Label>
                  <Input
                    id="new-provider-display-name"
                    value={newProviderDisplayName}
                    onChange={(e) => setNewProviderDisplayName(e.target.value)}
                    placeholder="OpenAI, Gemini..."
                  />
                </div>
                <div>
                  <Label htmlFor="new-provider-order">순번</Label>
                  <Input
                    id="new-provider-order"
                    type="number"
                    value={newProviderOrder}
                    onChange={(e) => setNewProviderOrder(parseInt(e.target.value) || 1)}
                    min="1"
                  />
                </div>
              </div>
              <Button onClick={handleAddProvider} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                추가
              </Button>
            </div>

            {/* 제공자 목록 */}
            <div className="space-y-4">
              <h3 className="font-semibold">제공자 목록</h3>
              <div className="space-y-2">
                {sortedProviders.map((provider, index) => (
                  <div
                    key={provider.id}
                    className="flex items-center gap-2 p-3 border rounded-lg"
                  >
                    <div className="flex-1">
                      {editingProvider?.id === provider.id ? (
                        <div className="flex gap-2">
                          <Input
                            value={editingProvider.name}
                            onChange={(e) => setEditingProvider({ ...editingProvider, name: e.target.value })}
                            placeholder="제공자 이름"
                            className="flex-1"
                          />
                          <Input
                            value={editingProvider.display_name}
                            onChange={(e) => setEditingProvider({ ...editingProvider, display_name: e.target.value })}
                            placeholder="표시 이름"
                            className="flex-1"
                          />
                          <Input
                            type="number"
                            value={editingProvider.display_order}
                            onChange={(e) => setEditingProvider({ ...editingProvider, display_order: parseInt(e.target.value) || 1 })}
                            className="w-20"
                            min="1"
                          />
                          <Button
                            onClick={handleUpdateProvider}
                            size="sm"
                            variant="default"
                          >
                            <Save className="h-4 w-4" />
                          </Button>
                          <Button
                            onClick={() => setEditingProvider(null)}
                            size="sm"
                            variant="outline"
                          >
                            취소
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-medium">{provider.display_name}</span>
                            <span className="text-sm text-gray-500 ml-2">({provider.name})</span>
                            <span className="text-sm text-gray-500 ml-2">(순번: {provider.display_order})</span>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              onClick={() => handleMoveOrder(provider, 'up')}
                              size="sm"
                              variant="ghost"
                              disabled={index === 0}
                              title="위로 이동"
                            >
                              <ArrowUp className="h-4 w-4" />
                            </Button>
                            <Button
                              onClick={() => handleMoveOrder(provider, 'down')}
                              size="sm"
                              variant="ghost"
                              disabled={index === sortedProviders.length - 1}
                              title="아래로 이동"
                            >
                              <ArrowDown className="h-4 w-4" />
                            </Button>
                            <Button
                              onClick={() => setEditingProvider(provider)}
                              size="sm"
                              variant="ghost"
                              title="수정"
                            >
                              수정
                            </Button>
                            <Button
                              onClick={() => handleDeleteProvider(provider.id)}
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
                {sortedProviders.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-4">등록된 제공자가 없습니다</p>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
