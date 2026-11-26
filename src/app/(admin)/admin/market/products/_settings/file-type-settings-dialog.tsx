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
import type { MarketFileType } from '@/lib/market-items-server'
import { buildEmptyFileTypeSettingsForm, buildFileTypeSettingsForm } from '../_lib/product-form'
import type { ProductAdminContext } from '../market-products-client'

export function FileTypeSettingsDialog({ ctx }: { ctx: ProductAdminContext }) {
  const {
    workspaceSubject, isFileTypeSettingsOpen, setIsFileTypeSettingsOpen, fileTypeSettingsForm,
    setFileTypeSettingsForm, editingFileTypeId, setEditingFileTypeId, isFileTypeSettingsSaving,
    setIsFileTypeSettingsSaving, deletingFileTypeId, setDeletingFileTypeId, fileTypes, reloadUploadTaxonomy,
  } = ctx

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

      await reloadUploadTaxonomy()
      resetFileTypeSettingsForm()
      toast.success(isEditing ? '파일 유형을 수정했습니다.' : '파일 유형을 추가했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '파일 유형 저장 중 오류가 발생했습니다.')
    } finally {
      setIsFileTypeSettingsSaving(false)
    }
  }

  const handleDeleteFileTypeSettings = async (fileTypeId: string) => {
    if (!window.confirm('이 파일 유형을 삭제할까요? 사용 중인 파일 유형은 삭제할 수 없습니다.')) {
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

      await reloadUploadTaxonomy()
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

  return (
      <Dialog open={isFileTypeSettingsOpen} onOpenChange={(open) => {
        setIsFileTypeSettingsOpen(open)
        if (!open) {
          resetFileTypeSettingsForm()
        }
      }}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>파일 유형 설정</DialogTitle>
            <DialogDescription>서브상품에 업로드할 파일 유형을 추가, 수정, 삭제할 수 있습니다.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-900">파일 유형 목록</p>
              <div className="space-y-2">
                {fileTypes.length === 0 ? (
                  <div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-gray-500">등록된 파일 유형이 없습니다.</div>
                ) : fileTypes.map((fileType) => (
                  <div key={fileType.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-gray-900">{fileType.label}</span>
                        <Badge variant={fileType.is_active ? 'outline' : 'secondary'}>{fileType.is_active ? '활성' : '비활성'}</Badge>
                      </div>
                      <p className="truncate text-xs text-gray-500">{fileType.code} · .{fileType.extension} · 정렬 {fileType.sort_order}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button type="button" variant="ghost" size="sm" onClick={() => handleEditFileTypeSettings(fileType)}>수정</Button>
                      <Button type="button" variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 hover:text-red-700" disabled={deletingFileTypeId === fileType.id} onClick={() => void handleDeleteFileTypeSettings(fileType.id)}>
                        {deletingFileTypeId === fileType.id ? <Loader2 className="h-4 w-4 animate-spin" /> : '삭제'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-3 rounded-md border bg-slate-50/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-gray-900">{editingFileTypeId ? '파일 유형 수정' : '파일 유형 추가'}</p>
                {editingFileTypeId ? <Button type="button" variant="ghost" size="sm" onClick={resetFileTypeSettingsForm}>새로 추가</Button> : null}
              </div>
              <div className="space-y-2">
                <Label>코드</Label>
                <Input value={fileTypeSettingsForm.code} onChange={(event) => setFileTypeSettingsForm((current) => ({ ...current, code: event.target.value }))} placeholder="예: pdf" disabled={Boolean(editingFileTypeId)} />
                {editingFileTypeId ? <p className="text-xs text-gray-500">코드는 만든 뒤에 바꿀 수 없습니다.</p> : null}
              </div>
              <div className="space-y-2">
                <Label>표시명</Label>
                <Input value={fileTypeSettingsForm.label} onChange={(event) => setFileTypeSettingsForm((current) => ({ ...current, label: event.target.value }))} placeholder="예: PDF" />
              </div>
              <div className="space-y-2">
                <Label>확장자</Label>
                <Input value={fileTypeSettingsForm.extension} onChange={(event) => setFileTypeSettingsForm((current) => ({ ...current, extension: event.target.value }))} placeholder="예: pdf" />
              </div>
              <div className="space-y-2">
                <Label>필요 프로그램</Label>
                <Input value={fileTypeSettingsForm.requiredProgram} maxLength={200} onChange={(event) => setFileTypeSettingsForm((current) => ({ ...current, requiredProgram: event.target.value }))} placeholder="예: PDF 뷰어(Adobe Acrobat Reader 등)" />
                <p className="text-xs text-gray-500">상품 상세 &quot;구매 전 확인&quot;의 파일 형식 줄에 보입니다.</p>
              </div>
              <div className="space-y-2">
                <Label>MIME 허용 목록</Label>
                <Textarea value={fileTypeSettingsForm.mimeAllowlist} onChange={(event) => setFileTypeSettingsForm((current) => ({ ...current, mimeAllowlist: event.target.value }))} className="min-h-[72px]" placeholder="한 줄 또는 쉼표로 구분" />
              </div>
              <div className="space-y-2">
                <Label>정렬 순서</Label>
                <Input type="number" min={0} value={fileTypeSettingsForm.sortOrder} onChange={(event) => setFileTypeSettingsForm((current) => ({ ...current, sortOrder: event.target.value }))} />
              </div>
              <div className="flex items-center justify-between rounded-md border bg-white px-3 py-2">
                <Label>활성화</Label>
                <Switch checked={fileTypeSettingsForm.isActive} onCheckedChange={(checked) => setFileTypeSettingsForm((current) => ({ ...current, isActive: checked }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsFileTypeSettingsOpen(false)}>닫기</Button>
            <Button type="button" disabled={isFileTypeSettingsSaving} onClick={() => void handleSaveFileTypeSettings()}>
              {isFileTypeSettingsSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  )
}
