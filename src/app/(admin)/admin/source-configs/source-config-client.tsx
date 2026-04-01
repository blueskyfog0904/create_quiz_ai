'use client'

import { useState, useEffect, useCallback } from 'react'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { Plus, Loader2, Trash2, Edit } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Database } from '@/types/supabase'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'

type SourceConfig = Database['public']['Tables']['source_configs']['Row']

interface SourceConfigClientProps {
  workspaceSubject: WorkspaceSubject
}

export default function SourceConfigClient({ workspaceSubject }: SourceConfigClientProps) {
  const [configs, setConfigs] = useState<SourceConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingConfig, setEditingConfig] = useState<SourceConfig | null>(null)
  
  const [formData, setFormData] = useState({
    type_name: '',
    source_1_label: '',
    source_1_options: '',
    source_2_label: '',
    source_2_options: '',
    source_3_label: '',
    source_3_options: '',
    source_4_label: '',
    source_4_options: '',
  })
  const [isSubmitting, setIsSubmitting] = useState(false)

  const fetchConfigs = useCallback(async () => {
    try {
      const response = await fetch(withAdminWorkspaceSubject('/api/admin/source-configs', workspaceSubject))
      if (!response.ok) throw new Error('Failed to fetch configs')
      const data = await response.json()
      setConfigs(data.configs)
    } catch {
      toast.error('설정 목록을 불러오지 못했습니다.')
    } finally {
      setIsLoading(false)
    }
  }, [workspaceSubject])

  useEffect(() => {
    fetchConfigs()
  }, [fetchConfigs])

  const handleOpenDialog = (config?: SourceConfig) => {
    if (config) {
      setEditingConfig(config)
      setFormData({
        type_name: config.type_name,
        source_1_label: config.source_1_label || '',
        source_1_options: config.source_1_options?.join(', ') || '',
        source_2_label: config.source_2_label || '',
        source_2_options: config.source_2_options?.join(', ') || '',
        source_3_label: config.source_3_label || '',
        source_3_options: config.source_3_options?.join(', ') || '',
        source_4_label: config.source_4_label || '',
        source_4_options: config.source_4_options?.join(', ') || '',
      })
    } else {
      setEditingConfig(null)
      setFormData({
        type_name: '',
        source_1_label: '',
        source_1_options: '',
        source_2_label: '',
        source_2_options: '',
        source_3_label: '',
        source_3_options: '',
        source_4_label: '',
        source_4_options: '',
      })
    }
    setIsDialogOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.type_name.trim()) {
      toast.error('출처 종류 이름을 입력해주세요.')
      return
    }

    setIsSubmitting(true)

    const payload = {
      type_name: formData.type_name,
      source_1_label: formData.source_1_label || null,
      source_1_options: formData.source_1_options ? formData.source_1_options.split(',').map(s => s.trim()).filter(Boolean) : [],
      source_2_label: formData.source_2_label || null,
      source_2_options: formData.source_2_options ? formData.source_2_options.split(',').map(s => s.trim()).filter(Boolean) : [],
      source_3_label: formData.source_3_label || null,
      source_3_options: formData.source_3_options ? formData.source_3_options.split(',').map(s => s.trim()).filter(Boolean) : [],
      source_4_label: formData.source_4_label || null,
      source_4_options: formData.source_4_options ? formData.source_4_options.split(',').map(s => s.trim()).filter(Boolean) : [],
    }

    try {
      const url = editingConfig 
        ? `/api/admin/source-configs/${editingConfig.id}`
        : '/api/admin/source-configs'
      
      const method = editingConfig ? 'PATCH' : 'POST'

      const response = await fetch(withAdminWorkspaceSubject(url, workspaceSubject), {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || '저장에 실패했습니다.')
      }

      toast.success(editingConfig ? '설정이 수정되었습니다.' : '새 설정이 추가되었습니다.')
      setIsDialogOpen(false)
      fetchConfigs()
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return

    try {
      const response = await fetch(withAdminWorkspaceSubject(`/api/admin/source-configs/${id}`, workspaceSubject), {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('삭제에 실패했습니다.')
      }

      toast.success('설정이 삭제되었습니다.')
      fetchConfigs()
    } catch {
      toast.error('삭제 중 오류가 발생했습니다.')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-7">
          <div>
            <CardTitle>출처 설정 목록</CardTitle>
            <CardDescription>
              다양한 출처 종류와 해당 출처의 하위 항목 필드를 설정합니다.
            </CardDescription>
          </div>
          <Button onClick={() => handleOpenDialog()}>
            <Plus className="mr-2 h-4 w-4" />
            새 출처 설정 추가
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {configs.map((config) => (
              <Card key={config.id} className="relative group">
                <CardHeader>
                  <CardTitle className="text-xl flex justify-between items-start">
                    {config.type_name}
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleOpenDialog(config)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => handleDelete(config.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  {[1, 2, 3, 4].map((num) => {
                    const label = config[`source_${num}_label` as keyof SourceConfig] as string
                    const options = config[`source_${num}_options` as keyof SourceConfig] as string[]
                    
                    if (!label && (!options || options.length === 0)) return null

                    return (
                      <div key={num} className="space-y-1">
                        <div className="font-medium text-gray-500 flex items-center gap-2">
                          <Badge variant="outline" className="w-5 h-5 flex items-center justify-center p-0">{num}</Badge>
                          {label || `출처 ${num}`}
                        </div>
                        {options && options.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {options.map((opt, i) => (
                              <Badge key={i} variant="secondary" className="text-xs font-normal">
                                {opt}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <p className="text-gray-400 text-xs pl-7">텍스트 입력 (옵션 없음)</p>
                        )}
                      </div>
                    )
                  })}
                  {![1, 2, 3, 4].some(num => config[`source_${num}_label` as keyof SourceConfig]) && (
                     <p className="text-gray-400 italic">설정된 하위 항목이 없습니다.</p>
                  )}
                </CardContent>
              </Card>
            ))}
            {configs.length === 0 && (
              <div className="col-span-full text-center py-12 text-gray-500 border-2 border-dashed rounded-lg">
                등록된 출처 설정이 없습니다. 새 설정을 추가해주세요.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingConfig ? '출처 설정 수정' : '새 출처 설정 추가'}
            </DialogTitle>
            <DialogDescription>
              출처 종류 이름과 각 하위 항목(출처 1~4)의 라벨 및 선택 옵션을 설정하세요.
              선택 옵션은 쉼표(,)로 구분하여 입력하세요.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="type_name">출처 종류 이름 *</Label>
              <Input
                id="type_name"
                placeholder="예: 교과서, 모의고사"
                value={formData.type_name}
                onChange={(e) => setFormData({ ...formData, type_name: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[1, 2, 3, 4].map((num) => (
                <div key={num} className="space-y-3 p-4 border rounded-lg bg-gray-50">
                  <h4 className="font-medium text-sm">출처 {num} 설정</h4>
                  
                  <div className="space-y-2">
                    <Label htmlFor={`source_${num}_label`} className="text-xs text-gray-500">
                      라벨 이름 (UI에 표시될 이름)
                    </Label>
                    <Input
                      id={`source_${num}_label`}
                      placeholder={`예: ${num === 1 ? '과목명' : num === 2 ? '학년' : '항목 이름'}`}
                      value={formData[`source_${num}_label` as keyof typeof formData]}
                      onChange={(e) => setFormData({ ...formData, [`source_${num}_label`]: e.target.value })}
                      className="bg-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`source_${num}_options`} className="text-xs text-gray-500">
                      선택 옵션 (쉼표로 구분, 비워두면 텍스트 입력)
                    </Label>
                    <Input
                      id={`source_${num}_options`}
                      placeholder="예: 공통영어1, 공통영어2, 심화영어"
                      value={formData[`source_${num}_options` as keyof typeof formData]}
                      onChange={(e) => setFormData({ ...formData, [`source_${num}_options`]: e.target.value })}
                      className="bg-white"
                    />
                  </div>
                </div>
              ))}
            </div>

            <DialogFooter className="justify-center gap-2">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                취소
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                저장
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
