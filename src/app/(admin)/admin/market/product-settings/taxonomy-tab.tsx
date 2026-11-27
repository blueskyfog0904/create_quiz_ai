'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAdminConfirm } from '@/components/admin/kit/admin-confirm-dialog'
import { AdminSaveBar, countChangedFields } from '@/components/admin/kit/admin-save-bar'
import { AdminStatusBadge } from '@/components/admin/kit/admin-status-badge'
import { AdminTableState } from '@/components/admin/kit/admin-table-state'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { adminStatusTone } from '@/lib/admin-status-tone'
import type { MarketFileType, MarketSubproductCategory } from '@/lib/market-items-server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import {
  buildCategorySettingsForm,
  buildEmptyCategorySettingsForm,
  buildEmptyFileTypeSettingsForm,
  buildFileTypeSettingsForm,
} from '../products/_lib/product-form'
import type { CategorySettingsFormState, FileTypeSettingsFormState } from '../products/_lib/types'

// 19번 Q7·6-1 [구성·파일 유형]: 18번 상품 편집 안 설정 창(_settings/*)의 내용을 이 탭으로 옮겼다(동작·route·문구 그대로).
// 상품 편집 화면은 선택칸 옆 '구성·파일 유형 관리(새 탭)' 링크로 여기를 열고, 돌아오면 목록을 다시 읽는다.
// slug·code 는 만든 뒤 읽기만(잠금은 17번 DB 트리거). 사용 중 유형의 확장자 잠금 등 서버 규칙은 그대로다.

async function readList<T>(url: string, fallback: string): Promise<T[]> {
  const response = await fetch(url, { cache: 'no-store' })
  const payload = await response.json()
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message || fallback)
  }
  return (payload.data || []) as T[]
}

export function TaxonomyTab({ workspaceSubject, preview }: { workspaceSubject: WorkspaceSubject; preview: boolean }) {
  return (
    <div className="space-y-6">
      <SubproductCategorySettingsPanel workspaceSubject={workspaceSubject} preview={preview} />
      <FileTypeSettingsPanel workspaceSubject={workspaceSubject} preview={preview} />
    </div>
  )
}

function SubproductCategorySettingsPanel({ workspaceSubject, preview }: { workspaceSubject: WorkspaceSubject; preview: boolean }) {
  const [subproductCategories, setSubproductCategories] = useState<MarketSubproductCategory[]>([])
  const [categorySettingsForm, setCategorySettingsForm] = useState<CategorySettingsFormState>(buildEmptyCategorySettingsForm())
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [isCategorySettingsSaving, setIsCategorySettingsSaving] = useState(false)
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null)
  // 20번 6단계: 삭제 확인(유형 가)·저장 상태 줄(마지막 저장 시각·실패 문구). 알림(toast)은 그대로 띄운다.
  const { ask, dialog: confirmDialog } = useAdminConfirm()
  const [categorySavedAt, setCategorySavedAt] = useState<number | null>(null)
  const [categorySaveError, setCategorySaveError] = useState<string | null>(null)

  const reloadCategories = useCallback(async () => {
    setSubproductCategories(await readList<MarketSubproductCategory>(
      withAdminWorkspaceSubject('/api/admin/market/subproduct-categories', workspaceSubject),
      '서브상품 카테고리 목록을 불러오지 못했습니다.'
    ))
  }, [workspaceSubject])

  useEffect(() => {
    reloadCategories().catch((error) => toast.error(error instanceof Error ? error.message : '서브상품 카테고리 목록을 불러오지 못했습니다.'))
  }, [reloadCategories])

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
    setCategorySaveError(null)
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

      await reloadCategories()
      resetCategorySettingsForm()
      setCategorySavedAt(Date.now())
      toast.success(isEditing ? '서브상품 카테고리를 수정했습니다.' : '서브상품 카테고리를 추가했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '서브상품 카테고리 저장 중 오류가 발생했습니다.')
      setCategorySaveError(error instanceof Error ? error.message : '서브상품 카테고리 저장 중 오류가 발생했습니다.')
    } finally {
      setIsCategorySettingsSaving(false)
    }
  }

  const handleDeleteCategorySettings = async (categoryId: string) => {
    const confirmed = await ask({
      title: '이 서브상품 카테고리를 삭제할까요?',
      description: '사용 중인 카테고리는 삭제할 수 없습니다.',
      confirmLabel: '삭제',
      danger: true,
    })
    if (!confirmed) {
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

      await reloadCategories()
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

  // 저장 안 된 변경 = 고르기 전(새로 추가면 빈 칸, 수정이면 그 카테고리 값)과 다른 칸 수
  const editingCategory = subproductCategories.find((category) => category.id === editingCategoryId)
  const categoryChangedCount = countChangedFields(
    categorySettingsForm,
    editingCategory ? buildCategorySettingsForm(editingCategory) : buildEmptyCategorySettingsForm()
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>서브상품 카테고리 설정</CardTitle>
        <CardDescription>서브상품 카테고리를 추가, 수정, 삭제할 수 있습니다. 사용 중인 카테고리는 삭제가 제한될 수 있습니다.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-900">카테고리 목록</p>
          <div className="space-y-2">
            {subproductCategories.length === 0 ? (
              <AdminTableState kind="empty" message="등록된 카테고리가 없습니다." className="py-6" />
            ) : subproductCategories.map((category) => (
              <div key={category.id} className="flex items-center justify-between gap-3 rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{category.name}</span>
                    <AdminStatusBadge label={category.is_active ? '활성' : '비활성'} tone={adminStatusTone('productSetting', category.is_active ? 'active' : 'inactive')} />
                  </div>
                  <p className="truncate text-xs text-gray-500">{category.slug} · 정렬 {category.sort_order}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button type="button" variant="adminTable" size="sm" onClick={() => handleEditCategorySettings(category)}>수정</Button>
                  <Button type="button" variant="adminTable" size="sm" className="text-[var(--admin-tone-danger-text)]" disabled={preview || deletingCategoryId === category.id} onClick={() => void handleDeleteCategorySettings(category.id)}>
                    {deletingCategoryId === category.id ? <Loader2 className="h-4 w-4 animate-spin" /> : '삭제'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3 rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] bg-[var(--studio-background)] p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-gray-900">{editingCategoryId ? '카테고리 수정' : '카테고리 추가'}</p>
            {editingCategoryId ? <Button type="button" variant="brandGhost" size="sm" onClick={resetCategorySettingsForm}>새로 추가</Button> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="taxonomy-category-name">이름</Label>
            <Input id="taxonomy-category-name" value={categorySettingsForm.name} onChange={(event) => setCategorySettingsForm((current) => ({ ...current, name: event.target.value }))} placeholder="예: 워크북" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="taxonomy-category-slug">slug</Label>
            <Input id="taxonomy-category-slug" value={categorySettingsForm.slug} onChange={(event) => setCategorySettingsForm((current) => ({ ...current, slug: event.target.value }))} placeholder="예: workbook" readOnly={Boolean(editingCategoryId)} disabled={Boolean(editingCategoryId)} />
            {editingCategoryId ? <p className="text-xs text-gray-500">slug는 만든 뒤에 바꿀 수 없습니다.</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="taxonomy-category-description">설명</Label>
            <Textarea id="taxonomy-category-description" value={categorySettingsForm.description} onChange={(event) => setCategorySettingsForm((current) => ({ ...current, description: event.target.value }))} className="min-h-[72px]" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="taxonomy-category-sort">정렬 순서</Label>
            <Input id="taxonomy-category-sort" type="number" min={0} value={categorySettingsForm.sortOrder} onChange={(event) => setCategorySettingsForm((current) => ({ ...current, sortOrder: event.target.value }))} />
          </div>
          <div className="flex items-center justify-between rounded-md border bg-white px-3 py-2">
            <Label>활성화</Label>
            <Switch checked={categorySettingsForm.isActive} onCheckedChange={(checked) => setCategorySettingsForm((current) => ({ ...current, isActive: checked }))} />
          </div>
          {/* 저장 함수 하나 = 인라인 저장 줄 하나. 전처럼 변경이 없어도 누를 수 있다(빈 칸이면 안내 알림). 막힘은 미리보기·저장 중. */}
          <AdminSaveBar
            variant="inline"
            dirtyCount={categoryChangedCount}
            status={isCategorySettingsSaving ? 'saving' : categorySaveError ? 'error' : categorySavedAt ? 'saved' : 'idle'}
            savedAt={categorySavedAt}
            errorMessage={categorySaveError}
            onSave={() => void handleSaveCategorySettings()}
            saveDisabled={preview}
            saveWhenClean
          />
        </div>
      </CardContent>
      {confirmDialog}
    </Card>
  )
}

function FileTypeSettingsPanel({ workspaceSubject, preview }: { workspaceSubject: WorkspaceSubject; preview: boolean }) {
  const [fileTypes, setFileTypes] = useState<MarketFileType[]>([])
  const [fileTypeSettingsForm, setFileTypeSettingsForm] = useState<FileTypeSettingsFormState>(buildEmptyFileTypeSettingsForm())
  const [editingFileTypeId, setEditingFileTypeId] = useState<string | null>(null)
  const [isFileTypeSettingsSaving, setIsFileTypeSettingsSaving] = useState(false)
  const [deletingFileTypeId, setDeletingFileTypeId] = useState<string | null>(null)
  // 20번 6단계: 삭제 확인(유형 가)·저장 상태 줄(마지막 저장 시각·실패 문구). 알림(toast)은 그대로 띄운다.
  const { ask, dialog: confirmDialog } = useAdminConfirm()
  const [fileTypeSavedAt, setFileTypeSavedAt] = useState<number | null>(null)
  const [fileTypeSaveError, setFileTypeSaveError] = useState<string | null>(null)

  const reloadFileTypes = useCallback(async () => {
    setFileTypes(await readList<MarketFileType>(
      withAdminWorkspaceSubject('/api/admin/market/file-types', workspaceSubject),
      '파일 유형 목록을 불러오지 못했습니다.'
    ))
  }, [workspaceSubject])

  useEffect(() => {
    reloadFileTypes().catch((error) => toast.error(error instanceof Error ? error.message : '파일 유형 목록을 불러오지 못했습니다.'))
  }, [reloadFileTypes])

  const resetFileTypeSettingsForm = () => {
    setEditingFileTypeId(null)
    setFileTypeSettingsForm(buildEmptyFileTypeSettingsForm())
  }

  const handleEditFileTypeSettings = (fileType: MarketFileType) => {
    setEditingFileTypeId(fileType.id)
    setFileTypeSettingsForm(buildFileTypeSettingsForm(fileType))
  }

  const handleSaveFileTypeSettings = async () => {
    if (!fileTypeSettingsForm.code.trim() || !fileTypeSettingsForm.label.trim() || !fileTypeSettingsForm.extension.trim()) {
      toast.error('파일 유형 코드, 표시명, 확장자를 입력해주세요.')
      return
    }
    // 새 유형은 필요 프로그램 필수(수정은 비워 둔 채 다른 칸만 바꿀 수 있음 — 서버 PATCH 와 같은 규칙)
    if (!editingFileTypeId && !fileTypeSettingsForm.requiredProgram.trim()) {
      toast.error('필요 프로그램을 입력해주세요. 상품 상세 "구매 전 확인"에 보입니다.')
      return
    }

    setIsFileTypeSettingsSaving(true)
    setFileTypeSaveError(null)
    try {
      const isEditing = Boolean(editingFileTypeId)
      const response = await fetch(withAdminWorkspaceSubject(
        editingFileTypeId
          ? `/api/admin/market/file-types/${editingFileTypeId}`
          : '/api/admin/market/file-types',
        workspaceSubject
      ), {
        method: editingFileTypeId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: fileTypeSettingsForm.code,
          label: fileTypeSettingsForm.label,
          extension: fileTypeSettingsForm.extension.replace(/^\./, ''),
          ...(fileTypeSettingsForm.requiredProgram.trim() ? { requiredProgram: fileTypeSettingsForm.requiredProgram } : {}),
          mimeAllowlist: fileTypeSettingsForm.mimeAllowlist
            .split(/\n|,/)
            .map((mime) => mime.trim())
            .filter(Boolean),
          sortOrder: Number(fileTypeSettingsForm.sortOrder || 0),
          isActive: fileTypeSettingsForm.isActive,
        }),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '파일 유형 저장에 실패했습니다.')
      }

      await reloadFileTypes()
      resetFileTypeSettingsForm()
      setFileTypeSavedAt(Date.now())
      toast.success(isEditing ? '파일 유형을 수정했습니다.' : '파일 유형을 추가했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '파일 유형 저장 중 오류가 발생했습니다.')
      setFileTypeSaveError(error instanceof Error ? error.message : '파일 유형 저장 중 오류가 발생했습니다.')
    } finally {
      setIsFileTypeSettingsSaving(false)
    }
  }

  const handleDeleteFileTypeSettings = async (fileTypeId: string) => {
    const confirmed = await ask({
      title: '이 파일 유형을 삭제할까요?',
      description: '사용 중인 파일 유형은 삭제할 수 없습니다.',
      confirmLabel: '삭제',
      danger: true,
    })
    if (!confirmed) {
      return
    }

    setDeletingFileTypeId(fileTypeId)
    try {
      const response = await fetch(withAdminWorkspaceSubject(`/api/admin/market/file-types/${fileTypeId}`, workspaceSubject), {
        method: 'DELETE',
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '파일 유형 삭제에 실패했습니다.')
      }

      await reloadFileTypes()
      if (editingFileTypeId === fileTypeId) {
        resetFileTypeSettingsForm()
      }
      toast.success('파일 유형을 삭제했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '파일 유형 삭제 중 오류가 발생했습니다.')
    } finally {
      setDeletingFileTypeId(null)
    }
  }

  // 저장 안 된 변경 = 고르기 전(새로 추가면 빈 칸, 수정이면 그 유형 값)과 다른 칸 수
  const editingFileType = fileTypes.find((fileType) => fileType.id === editingFileTypeId)
  const fileTypeChangedCount = countChangedFields(
    fileTypeSettingsForm,
    editingFileType ? buildFileTypeSettingsForm(editingFileType) : buildEmptyFileTypeSettingsForm()
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>파일 유형 설정</CardTitle>
        <CardDescription>서브상품에 업로드할 파일 유형을 추가, 수정, 삭제할 수 있습니다.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-900">파일 유형 목록</p>
          <div className="space-y-2">
            {fileTypes.length === 0 ? (
              <AdminTableState kind="empty" message="등록된 파일 유형이 없습니다." className="py-6" />
            ) : fileTypes.map((fileType) => (
              <div key={fileType.id} className="flex items-center justify-between gap-3 rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{fileType.label}</span>
                    <AdminStatusBadge label={fileType.is_active ? '활성' : '비활성'} tone={adminStatusTone('productSetting', fileType.is_active ? 'active' : 'inactive')} />
                  </div>
                  <p className="truncate text-xs text-gray-500">{fileType.code} · .{fileType.extension} · 정렬 {fileType.sort_order}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button type="button" variant="adminTable" size="sm" onClick={() => handleEditFileTypeSettings(fileType)}>수정</Button>
                  <Button type="button" variant="adminTable" size="sm" className="text-[var(--admin-tone-danger-text)]" disabled={preview || deletingFileTypeId === fileType.id} onClick={() => void handleDeleteFileTypeSettings(fileType.id)}>
                    {deletingFileTypeId === fileType.id ? <Loader2 className="h-4 w-4 animate-spin" /> : '삭제'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3 rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] bg-[var(--studio-background)] p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-gray-900">{editingFileTypeId ? '파일 유형 수정' : '파일 유형 추가'}</p>
            {editingFileTypeId ? <Button type="button" variant="brandGhost" size="sm" onClick={resetFileTypeSettingsForm}>새로 추가</Button> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="taxonomy-file-type-code">코드</Label>
            <Input id="taxonomy-file-type-code" value={fileTypeSettingsForm.code} onChange={(event) => setFileTypeSettingsForm((current) => ({ ...current, code: event.target.value }))} placeholder="예: pdf" readOnly={Boolean(editingFileTypeId)} disabled={Boolean(editingFileTypeId)} />
            {editingFileTypeId ? <p className="text-xs text-gray-500">코드는 만든 뒤에 바꿀 수 없습니다.</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="taxonomy-file-type-label">표시명</Label>
            <Input id="taxonomy-file-type-label" value={fileTypeSettingsForm.label} onChange={(event) => setFileTypeSettingsForm((current) => ({ ...current, label: event.target.value }))} placeholder="예: PDF" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="taxonomy-file-type-extension">확장자</Label>
            <Input id="taxonomy-file-type-extension" value={fileTypeSettingsForm.extension} onChange={(event) => setFileTypeSettingsForm((current) => ({ ...current, extension: event.target.value }))} placeholder="예: pdf" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="taxonomy-file-type-program">필요 프로그램</Label>
            <Input id="taxonomy-file-type-program" value={fileTypeSettingsForm.requiredProgram} maxLength={200} onChange={(event) => setFileTypeSettingsForm((current) => ({ ...current, requiredProgram: event.target.value }))} placeholder="예: PDF 뷰어(Adobe Acrobat Reader 등)" />
            <p className="text-xs text-gray-500">상품 상세 &quot;구매 전 확인&quot;의 파일 형식 줄에 보입니다.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="taxonomy-file-type-mime">MIME 허용 목록</Label>
            <Textarea id="taxonomy-file-type-mime" value={fileTypeSettingsForm.mimeAllowlist} onChange={(event) => setFileTypeSettingsForm((current) => ({ ...current, mimeAllowlist: event.target.value }))} className="min-h-[72px]" placeholder="한 줄 또는 쉼표로 구분" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="taxonomy-file-type-sort">정렬 순서</Label>
            <Input id="taxonomy-file-type-sort" type="number" min={0} value={fileTypeSettingsForm.sortOrder} onChange={(event) => setFileTypeSettingsForm((current) => ({ ...current, sortOrder: event.target.value }))} />
          </div>
          <div className="flex items-center justify-between rounded-md border bg-white px-3 py-2">
            <Label>활성화</Label>
            <Switch checked={fileTypeSettingsForm.isActive} onCheckedChange={(checked) => setFileTypeSettingsForm((current) => ({ ...current, isActive: checked }))} />
          </div>
          {/* 저장 함수 하나 = 인라인 저장 줄 하나. 전처럼 변경이 없어도 누를 수 있다(빈 칸이면 안내 알림). 막힘은 미리보기·저장 중. */}
          <AdminSaveBar
            variant="inline"
            dirtyCount={fileTypeChangedCount}
            status={isFileTypeSettingsSaving ? 'saving' : fileTypeSaveError ? 'error' : fileTypeSavedAt ? 'saved' : 'idle'}
            savedAt={fileTypeSavedAt}
            errorMessage={fileTypeSaveError}
            onSave={() => void handleSaveFileTypeSettings()}
            saveDisabled={preview}
            saveWhenClean
          />
        </div>
      </CardContent>
      {confirmDialog}
    </Card>
  )
}
