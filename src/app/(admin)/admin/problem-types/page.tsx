'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { Loader2, Plus, Pencil, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ProblemType {
  id: string
  type_name: string
  description: string | null
  prompt_template: string | null
  provider: string
  model_name: string | null
  output_format: string | null
  is_active: boolean
  created_at: string
}

export default function ProblemTypesPage() {
  const [types, setTypes] = useState<ProblemType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingType, setEditingType] = useState<ProblemType | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Form state
  const [formData, setFormData] = useState({
    type_name: '',
    description: '',
    prompt_template: '',
    provider: 'gemini',
    model_name: '',
    output_format: '',
    is_active: true
  })

  const fetchTypes = async () => {
    try {
      const res = await fetch('/api/admin/problem-types')
      const data = await res.json()
      if (data.types) {
        setTypes(data.types)
      }
    } catch (error) {
      toast.error('문제 유형을 불러오는데 실패했습니다')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchTypes()
  }, [])

  const handleOpenDialog = (type?: ProblemType) => {
    if (type) {
      setEditingType(type)
      setFormData({
        type_name: type.type_name,
        description: type.description || '',
        prompt_template: type.prompt_template || '',
        provider: type.provider,
        model_name: type.model_name || '',
        output_format: type.output_format || '',
        is_active: type.is_active
      })
    } else {
      setEditingType(null)
      setFormData({
        type_name: '',
        description: '',
        prompt_template: '',
        provider: 'gemini',
        model_name: '',
        output_format: '',
        is_active: true
      })
    }
    setIsDialogOpen(true)
  }

  const handleSave = async () => {
    if (!formData.type_name) {
      toast.error('문제 유형명을 입력해주세요')
      return
    }

    setIsSaving(true)
    try {
      const url = editingType 
        ? `/api/admin/problem-types/${editingType.id}`
        : '/api/admin/problem-types'
      
      const res = await fetch(url, {
        method: editingType ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })

      if (!res.ok) {
        throw new Error('저장 실패')
      }

      toast.success(editingType ? '수정되었습니다' : '추가되었습니다')
      setIsDialogOpen(false)
      fetchTypes()
    } catch (error) {
      toast.error('저장에 실패했습니다')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return

    try {
      const res = await fetch(`/api/admin/problem-types/${id}`, {
        method: 'DELETE'
      })

      if (!res.ok) throw new Error('삭제 실패')

      toast.success('삭제되었습니다')
      fetchTypes()
    } catch (error) {
      toast.error('삭제에 실패했습니다')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">AI 문제 유형 관리</h1>
          <p className="text-gray-500 mt-1">AI 문제 생성 유형 및 프롬프트를 관리합니다</p>
        </div>
        <Button onClick={() => handleOpenDialog()}>
          <Plus className="mr-2 h-4 w-4" />
          새 유형 추가
        </Button>
      </div>

      <div className="grid gap-4">
        {types.map((type) => (
          <Card key={type.id} className={!type.is_active ? 'opacity-60' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    {type.type_name}
                    {!type.is_active && (
                      <span className="text-xs bg-gray-200 px-2 py-0.5 rounded">비활성</span>
                    )}
                  </CardTitle>
                  <CardDescription>{type.description}</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(type)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(type.id)}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-gray-500 space-y-1">
                <p>Provider: {type.provider} / Model: {type.model_name}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingType ? '문제 유형 수정' : '새 문제 유형 추가'}</DialogTitle>
            <DialogDescription>AI 문제 생성에 사용될 유형을 설정합니다</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>유형명 *</Label>
              <Input
                value={formData.type_name}
                onChange={(e) => setFormData({...formData, type_name: e.target.value})}
                placeholder="예: 빈칸 추론"
              />
            </div>

            <div className="space-y-2">
              <Label>설명</Label>
              <Input
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
                placeholder="문제 유형에 대한 설명"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select 
                  value={formData.provider} 
                  onValueChange={(v) => setFormData({...formData, provider: v})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gemini">Gemini</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="admin">Admin (수동)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Model Name</Label>
                <Input
                  value={formData.model_name}
                  onChange={(e) => setFormData({...formData, model_name: e.target.value})}
                  placeholder="예: gemini-2.0-flash-exp"
                  disabled={formData.provider === 'admin'}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>프롬프트 템플릿</Label>
              <Textarea
                value={formData.prompt_template}
                onChange={(e) => setFormData({...formData, prompt_template: e.target.value})}
                placeholder="AI에게 전달할 프롬프트..."
                rows={8}
                disabled={formData.provider === 'admin'}
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={formData.is_active}
                onCheckedChange={(v) => setFormData({...formData, is_active: v})}
              />
              <Label>활성화</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              취소
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
