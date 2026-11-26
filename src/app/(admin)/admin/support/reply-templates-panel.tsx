'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  findUnknownPlaceholders,
  SUPPORT_REPLY_PLACEHOLDERS,
  SUPPORT_REPLY_TEMPLATE_BODY_MAX,
  SUPPORT_REPLY_TEMPLATE_TITLE_MAX,
} from '@/lib/support-reply-template'
import { hideSupportReplyTemplateAction, saveSupportReplyTemplateAction } from './actions'
import { TemplateBlankPreview, type SupportReplyTemplateRow } from './reply-template-tools'

type TemplateForm = { title: string; body: string; categoryId: string; sortOrder: string; isActive: boolean }

const emptyForm: TemplateForm = { title: '', body: '', categoryId: '', sortOrder: '0', isActive: true }

// 13번 6절 '답변 템플릿' 탭: 목록·추가·수정·숨김·순서·카테고리. 저장은 서버 액션(support.manage, revision 비교, 작업 기록).
export function ReplyTemplatesPanel({ templates, onTemplatesChange, categories, blankMarker }: {
  templates: SupportReplyTemplateRow[] | null
  onTemplatesChange: (templates: SupportReplyTemplateRow[]) => void
  categories: { id: string; name: string; deleted_at: string | null }[]
  blankMarker: string | null
}) {
  const [editing, setEditing] = useState<SupportReplyTemplateRow | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<TemplateForm>(emptyForm)
  const [saving, setSaving] = useState(false)

  if (templates === null) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="p-6 text-sm text-red-700" role="alert">답변 템플릿을 불러오지 못했습니다. 새로고침해 주세요.</CardContent>
      </Card>
    )
  }

  const categoryName = (id: string | null) => (id ? categories.find((category) => category.id === id)?.name ?? '알 수 없는 카테고리' : '모든 문의')
  const sorted = [...templates].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
  const unknownPlaceholders = findUnknownPlaceholders(form.body)

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setDialogOpen(true)
  }

  const openEdit = (template: SupportReplyTemplateRow) => {
    setEditing(template)
    setForm({
      title: template.title,
      body: template.body,
      categoryId: template.category_id ?? '',
      sortOrder: String(template.sort_order),
      isActive: template.is_active,
    })
    setDialogOpen(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const result = await saveSupportReplyTemplateAction({
        id: editing?.id ?? null,
        revision: editing?.revision ?? null,
        title: form.title,
        body: form.body,
        categoryId: form.categoryId || null,
        sortOrder: Number.parseInt(form.sortOrder || '0', 10),
        isActive: form.isActive,
      })
      if (!result.ok) throw new Error(result.error)
      onTemplatesChange(editing ? templates.map((item) => (item.id === result.data.id ? result.data : item)) : [...templates, result.data])
      setDialogOpen(false)
      toast.success('템플릿을 저장했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '템플릿을 저장하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const hide = async (template: SupportReplyTemplateRow) => {
    if (!confirm(`'${template.title}' 템플릿을 숨길까요? 답변 창의 템플릿 목록에서 빠집니다.`)) return
    try {
      const result = await hideSupportReplyTemplateAction({ id: template.id, revision: template.revision })
      if (!result.ok) throw new Error(result.error)
      onTemplatesChange(templates.filter((item) => item.id !== template.id))
      toast.success('템플릿을 숨겼습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '템플릿을 숨기지 못했습니다.')
    }
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg">답변 템플릿</CardTitle>
            <p className="mt-1 text-sm text-gray-500">
              답변 창의 [템플릿 넣기]에 보입니다. 자리표시 {SUPPORT_REPLY_PLACEHOLDERS.join(' · ')} 는 자동으로 채워지고,
              {blankMarker ? ` 직원이 채울 곳은 ${blankMarker} 로 적습니다(채우지 않으면 저장되지 않음).` : ' 빈칸 표시 설정을 읽지 못했습니다.'}
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            템플릿 추가
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {sorted.length === 0 ? (
          <div className="p-8 text-center text-gray-500">등록된 템플릿이 없습니다.</div>
        ) : (
          <div className="divide-y">
            {sorted.map((template) => (
              <div key={template.id} className="flex items-start justify-between gap-4 p-4 max-md:flex-col max-md:gap-3">
                <div className="min-w-0 space-y-1 break-words">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-gray-900">{template.title}</span>
                    <Badge variant="outline">{categoryName(template.category_id)}</Badge>
                    <Badge variant={template.is_active ? 'default' : 'secondary'}>{template.is_active ? '사용' : '사용 안 함'}</Badge>
                    <span className="text-xs text-gray-400">순서 {template.sort_order}</span>
                  </div>
                  <p className="line-clamp-2 whitespace-pre-wrap text-sm text-gray-500">{template.body}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="adminAction" size="sm" onClick={() => openEdit(template)}>
                    <Pencil className="mr-1 h-4 w-4" />
                    수정
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void hide(template)}>
                    <Trash2 className="mr-1 h-4 w-4" />
                    숨김
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto max-md:max-w-[calc(100vw-2rem)]">
          <DialogHeader>
            <DialogTitle>{editing ? '템플릿 수정' : '템플릿 추가'}</DialogTitle>
            <DialogDescription>회원 개인정보(이메일·전화·계좌)는 템플릿에 넣지 않습니다.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="template-title">이름</Label>
              <Input id="template-title" value={form.title} maxLength={SUPPORT_REPLY_TEMPLATE_TITLE_MAX} onChange={(event) => setForm({ ...form, title: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-category">카테고리</Label>
              <select
                id="template-category"
                value={form.categoryId}
                onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">모든 문의</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}{category.deleted_at ? ' (숨김)' : ''}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-sort">순서</Label>
              <Input id="template-sort" type="number" min={0} max={9999} value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: event.target.value })} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="template-body">본문</Label>
              <Textarea id="template-body" rows={10} value={form.body} maxLength={SUPPORT_REPLY_TEMPLATE_BODY_MAX} onChange={(event) => setForm({ ...form, body: event.target.value })} />
              <p className="text-right text-xs text-gray-400">{form.body.length}/{SUPPORT_REPLY_TEMPLATE_BODY_MAX}</p>
              {unknownPlaceholders.length > 0 && (
                <p role="alert" className="text-sm text-red-700">쓸 수 없는 자리표시: {unknownPlaceholders.join(', ')}</p>
              )}
              <TemplateBlankPreview text={form.body} marker={blankMarker} message={(count) => `직원이 채울 빈칸 ${count}곳(답변 창에서 채워야 저장됨)`} />
            </div>
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
              답변 창에서 사용
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>취소</Button>
            <Button onClick={() => void save()} disabled={saving || !form.title.trim() || !form.body.trim() || unknownPlaceholders.length > 0}>
              {saving ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
