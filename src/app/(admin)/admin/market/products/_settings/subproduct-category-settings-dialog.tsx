import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { MarketSubproductCategory } from '@/lib/market-items-server'
import { buildEmptyCategorySettingsForm, buildCategorySettingsForm } from '../_lib/product-form'
import type { ProductAdminContext } from '../market-products-client'

export function SubproductCategorySettingsDialog({ ctx }: { ctx: ProductAdminContext }) {
  const {
    workspaceSubject, isCategorySettingsOpen, setIsCategorySettingsOpen, categorySettingsForm,
    setCategorySettingsForm, editingCategoryId, setEditingCategoryId, isCategorySettingsSaving,
    setIsCategorySettingsSaving, deletingCategoryId, setDeletingCategoryId, subproductCategories,
    reloadUploadTaxonomy,
  } = ctx

  const resetCategorySettingsForm = () => {
    setEditingCategoryId(null)
    setCategorySettingsForm(buildEmptyCategorySettingsForm())
  }

  const handleEditCategorySettings = (category: MarketSubproductCategory) => {
    setEditingCategoryId(category.id)
    setCategorySettingsForm(buildCategorySettingsForm(category))
  }

  const handleSaveCategorySettings = async () => {
    if (!categorySettingsForm.name.trim() || !categorySettingsForm.slug.trim()) {
      toast.error('카테고리 이름과 slug를 입력해주세요.')
      return
    }

    setIsCategorySettingsSaving(true)
    try {
      const isEditing = Boolean(editingCategoryId)
      const response = await fetch(withAdminWorkspaceSubject(
        editingCategoryId
          ? `/api/admin/market/subproduct-categories/${editingCategoryId}`
          : '/api/admin/market/subproduct-categories',
        workspaceSubject
      ), {
        method: editingCategoryId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: categorySettingsForm.name,
          slug: categorySettingsForm.slug,
          description: categorySettingsForm.description,
          sortOrder: Number(categorySettingsForm.sortOrder || 0),
          isActive: categorySettingsForm.isActive,
        }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '서브상품 카테고리 저장에 실패했습니다.')
      }

      await reloadUploadTaxonomy()
      resetCategorySettingsForm()
      toast.success(isEditing ? '서브상품 카테고리를 수정했습니다.' : '서브상품 카테고리를 추가했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '서브상품 카테고리 저장 중 오류가 발생했습니다.')
    } finally {
      setIsCategorySettingsSaving(false)
    }
  }

  const handleDeleteCategorySettings = async (categoryId: string) => {
    if (!window.confirm('이 서브상품 카테고리를 삭제할까요? 사용 중인 카테고리는 삭제할 수 없습니다.')) {
      return
    }

    setDeletingCategoryId(categoryId)
    try {
      const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/subproduct-categories/${categoryId}`, workspaceSubject), {
        method: 'DELETE',
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '서브상품 카테고리 삭제에 실패했습니다.')
      }

      await reloadUploadTaxonomy()
      if (editingCategoryId === categoryId) {
        resetCategorySettingsForm()
      }
      toast.success('서브상품 카테고리를 삭제했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '서브상품 카테고리 삭제 중 오류가 발생했습니다.')
    } finally {
      setDeletingCategoryId(null)
    }
  }

  return (
      <Dialog open={isCategorySettingsOpen} onOpenChange={(open) => {
        setIsCategorySettingsOpen(open)
        if (!open) {
          resetCategorySettingsForm()
        }
      }}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>서브상품 카테고리 설정</DialogTitle>
            <DialogDescription>서브상품 카테고리를 추가, 수정, 삭제할 수 있습니다. 사용 중인 카테고리는 삭제가 제한될 수 있습니다.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-900">카테고리 목록</p>
              <div className="space-y-2">
                {subproductCategories.length === 0 ? (
                  <div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-gray-500">등록된 카테고리가 없습니다.</div>
                ) : subproductCategories.map((category) => (
                  <div key={category.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-gray-900">{category.name}</span>
                        <Badge variant={category.is_active ? 'outline' : 'secondary'}>{category.is_active ? '활성' : '비활성'}</Badge>
                      </div>
                      <p className="truncate text-xs text-gray-500">{category.slug} · 정렬 {category.sort_order}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button type="button" variant="ghost" size="sm" onClick={() => handleEditCategorySettings(category)}>수정</Button>
                      <Button type="button" variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 hover:text-red-700" disabled={deletingCategoryId === category.id} onClick={() => void handleDeleteCategorySettings(category.id)}>
                        {deletingCategoryId === category.id ? <Loader2 className="h-4 w-4 animate-spin" /> : '삭제'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-3 rounded-md border bg-slate-50/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-gray-900">{editingCategoryId ? '카테고리 수정' : '카테고리 추가'}</p>
                {editingCategoryId ? <Button type="button" variant="ghost" size="sm" onClick={resetCategorySettingsForm}>새로 추가</Button> : null}
              </div>
              <div className="space-y-2">
                <Label>이름</Label>
                <Input value={categorySettingsForm.name} onChange={(event) => setCategorySettingsForm((current) => ({ ...current, name: event.target.value }))} placeholder="예: 워크북" />
              </div>
              <div className="space-y-2">
                <Label>slug</Label>
                <Input value={categorySettingsForm.slug} onChange={(event) => setCategorySettingsForm((current) => ({ ...current, slug: event.target.value }))} placeholder="예: workbook" disabled={Boolean(editingCategoryId)} />
                {editingCategoryId ? <p className="text-xs text-gray-500">slug는 만든 뒤에 바꿀 수 없습니다.</p> : null}
              </div>
              <div className="space-y-2">
                <Label>설명</Label>
                <Textarea value={categorySettingsForm.description} onChange={(event) => setCategorySettingsForm((current) => ({ ...current, description: event.target.value }))} className="min-h-[72px]" />
              </div>
              <div className="space-y-2">
                <Label>정렬 순서</Label>
                <Input type="number" min={0} value={categorySettingsForm.sortOrder} onChange={(event) => setCategorySettingsForm((current) => ({ ...current, sortOrder: event.target.value }))} />
              </div>
              <div className="flex items-center justify-between rounded-md border bg-white px-3 py-2">
                <Label>활성화</Label>
                <Switch checked={categorySettingsForm.isActive} onCheckedChange={(checked) => setCategorySettingsForm((current) => ({ ...current, isActive: checked }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsCategorySettingsOpen(false)}>닫기</Button>
            <Button type="button" disabled={isCategorySettingsSaving} onClick={() => void handleSaveCategorySettings()}>
              {isCategorySettingsSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  )
}
