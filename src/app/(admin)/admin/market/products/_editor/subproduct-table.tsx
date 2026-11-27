import { ArrowDown, ArrowUp, ExternalLink, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { AdminStatusBadge } from '@/components/admin/kit/admin-status-badge'
import { adminStatusTone } from '@/lib/admin-status-tone'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { formatCreditInputValue, formatFileSize, formatDateTime } from '../_lib/product-form'
import type { ProductAdminContext } from '../market-products-client'
import { UploadQueueList } from './upload-queue-list'

// 19번 Q7·6-2: 구성·파일 유형 관리는 '상품 표시 설정' [구성·파일 유형] 탭(새 탭)으로 옮겼다. 돌아오면 편집 화면이 목록을 다시 읽는다.
function TaxonomyManageLinks({ workspaceSubject, onRefresh }: { workspaceSubject: WorkspaceSubject; onRefresh: () => void }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <a
        href={withAdminWorkspaceSubject('/admin/market/product-settings?tab=taxonomy', workspaceSubject)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-indigo-700 underline-offset-2 hover:underline"
      >
        구성·파일 유형 관리(새 탭)
        <ExternalLink aria-hidden="true" className="h-3 w-3" />
      </a>
      <button type="button" className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900" onClick={onRefresh}>
        <RefreshCw aria-hidden="true" className="h-3 w-3" />
        목록 새로고침
      </button>
    </span>
  )
}

export function SubproductTable({ ctx }: { ctx: ProductAdminContext }) {
  const {
    workspaceSubject, subproducts, isSubproductFormOpen, setIsSubproductFormOpen, editingSubproductId, subproductEditDraft,
    setSubproductEditDraft, isSubproductSaving, refreshUploadTaxonomy,
    subproductOrderIds, isSubproductOrderChanged, isOrderSaving, isEditingPublishedItem, moveSubproduct, saveSubproductOrder,
    subproductUploadingKeys, subproductDragActiveKeys, subproductCategories, subproductDraft, setSubproductDraft,
    subproductFileDrafts, isUploadBlockedByCategory, activeSubproductCategories, activeFileTypes,
    subproductFilesBySubproductId, getSubproductCategoryName, getFileTypeLabel, getFileTypeAcceptValue,
    handleAddSubproductFileDraft, handleUpdateSubproductFileDraft, handleRemoveSubproductFileDraft,
    setSubproductDragActive, handleCreateSubproduct, handleEditSubproduct, handleCancelEditSubproduct,
    handleSaveSubproduct, handleDeleteSubproduct, handleSubproductFileUpload, handleDeleteSubproductFile,
    uploadQueues, uploadLimitText, handleRetryUploadEntry, handleRemoveUploadEntry,
  } = ctx

  return (
    <>
                {subproducts.length === 0 ? (
                  <div className="rounded-md border border-dashed bg-white px-4 py-8 text-center text-sm text-gray-500">
                    아직 서브상품이 없습니다. 아래에서 첫 서브상품을 추가하세요.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* 19번 6-2: 순서는 [위로]·[아래로] 뒤 [순서 저장](상품 저장과 따로) */}
                    {isSubproductOrderChanged ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        <span className="font-semibold">순서 바뀜 — 저장 필요</span>
                        <Button type="button" size="sm" disabled={isOrderSaving} onClick={() => void saveSubproductOrder()}>
                          {isOrderSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          순서 저장
                        </Button>
                        {isEditingPublishedItem ? <p className="w-full text-xs">회원 상세에 바로 반영됩니다.</p> : null}
                      </div>
                    ) : null}
                    {subproductOrderIds.map((subproductId, orderIndex) => {
                      const subproduct = subproducts.find((candidate) => candidate.id === subproductId)
                      if (!subproduct) return null
                      const filesForSubproduct = subproductFilesBySubproductId.get(subproduct.id) || []
                      const isEditingSubproduct = editingSubproductId === subproduct.id && subproductEditDraft

                      return (
                        <div key={subproduct.id} className="space-y-3 rounded-md border bg-white p-3">
                          {isEditingSubproduct ? (
                            <div className="space-y-3 rounded-md border bg-slate-50/80 p-3">
                              <div className="grid gap-3 md:grid-cols-2">
                                <div className="space-y-2">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <Label>서브상품 카테고리</Label>
                                    <TaxonomyManageLinks workspaceSubject={workspaceSubject} onRefresh={() => void refreshUploadTaxonomy()} />
                                  </div>
                                  <select
                                    value={subproductEditDraft.categoryId}
                                    onChange={(event) => setSubproductEditDraft((current) => current ? { ...current, categoryId: event.target.value } : current)}
                                    className="flex h-10 w-full rounded-md border bg-white px-3 text-sm"
                                  >
                                    <option value="">카테고리 선택</option>
                                    {subproductCategories.map((category) => (
                                      <option key={category.id} value={category.id}>{category.name}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="space-y-2">
                                  <Label>서브상품 가격</Label>
                                  <Input
                                    type="text"
                                    inputMode="numeric"
                                    value={subproductEditDraft.priceCredits}
                                    onChange={(event) => setSubproductEditDraft((current) => current ? { ...current, priceCredits: formatCreditInputValue(event.target.value) } : current)}
                                  />
                                </div>
                                <div className="space-y-2 md:col-span-2">
                                  <Label>서브상품 설명</Label>
                                  <Textarea
                                    value={subproductEditDraft.description}
                                    onChange={(event) => setSubproductEditDraft((current) => current ? { ...current, description: event.target.value } : current)}
                                    className="min-h-[72px]"
                                  />
                                </div>
                                <details className="md:col-span-2" open={Boolean(subproductEditDraft.purchaseNoticeLabel || subproductEditDraft.purchaseNoticeText)}>
                                  <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-900">고급 설정 (구매 안내 문구)</summary>
                                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                                    <div className="space-y-2">
                                      <Label>구매 안내 라벨</Label>
                                      <Input
                                        value={subproductEditDraft.purchaseNoticeLabel}
                                        onChange={(event) => setSubproductEditDraft((current) => current ? { ...current, purchaseNoticeLabel: event.target.value } : current)}
                                        maxLength={24}
                                        placeholder="예: PDF 포함"
                                      />
                                    </div>
                                    <div className="space-y-2 md:col-span-2">
                                      <Label>구매 안내 문구</Label>
                                      <Textarea
                                        value={subproductEditDraft.purchaseNoticeText}
                                        onChange={(event) => setSubproductEditDraft((current) => current ? { ...current, purchaseNoticeText: event.target.value } : current)}
                                        className="min-h-[72px]"
                                        maxLength={160}
                                        placeholder="예: 편집 가능한 HWP와 문제(PDF)를 함께 제공합니다. PDF는 따로 구매하지 않아도 됩니다."
                                      />
                                      <p className="text-xs text-gray-500">사용자 상세 페이지의 구매 옵션 행에 표시됩니다. 비워두면 HWP+PDF 구성에서는 기본 안내 문구가 표시됩니다.</p>
                                    </div>
                                  </div>
                                </details>
                                <div className="flex items-center gap-3">
                                  <Switch
                                    checked={subproductEditDraft.isActive}
                                    onCheckedChange={(checked) => setSubproductEditDraft((current) => current ? { ...current, isActive: checked } : current)}
                                  />
                                  <Label>활성화</Label>
                                </div>
                              </div>
                              <div className="flex justify-end gap-2">
                                <Button type="button" variant="ghost" size="sm" disabled={isSubproductSaving} onClick={handleCancelEditSubproduct}>
                                  취소
                                </Button>
                                <Button type="button" size="sm" disabled={isSubproductSaving} onClick={() => void handleSaveSubproduct(subproduct.id)}>
                                  {isSubproductSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                  저장
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                              <div className="flex min-w-0 gap-2">
                                <div className="flex shrink-0 flex-col gap-1">
                                  <Button type="button" variant="outline" size="icon" className="h-7 w-7" aria-label="위로" disabled={isOrderSaving || orderIndex === 0} onClick={() => moveSubproduct(subproduct.id, -1)}>
                                    <ArrowUp className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button type="button" variant="outline" size="icon" className="h-7 w-7" aria-label="아래로" disabled={isOrderSaving || orderIndex === subproductOrderIds.length - 1} onClick={() => moveSubproduct(subproduct.id, 1)}>
                                    <ArrowDown className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-semibold text-gray-900">{getSubproductCategoryName(subproduct.category_id)}</p>
                                  <AdminStatusBadge label={subproduct.is_active ? '활성' : '비활성'} tone={adminStatusTone('productSetting', subproduct.is_active ? 'active' : 'inactive')} />
                                </div>
                                <p className="mt-1 text-sm text-gray-500">{subproduct.description || '설명이 없습니다.'}</p>
                                {subproduct.purchase_notice_text ? (
                                  <p className="mt-1 text-sm text-indigo-700">
                                    {subproduct.purchase_notice_label ? `${subproduct.purchase_notice_label} · ` : ''}
                                    {subproduct.purchase_notice_text}
                                  </p>
                                ) : null}
                                <p className="mt-1 text-sm font-medium text-gray-900">{formatCreditInputValue(subproduct.price_credits)} 크레딧 · 파일 {filesForSubproduct.length}개</p>
                              </div>
                              </div>
                              <div className="flex gap-2">
                                <Button type="button" variant="adminTable" size="sm" disabled={isSubproductSaving} onClick={() => handleEditSubproduct(subproduct)}>
                                  수정
                                </Button>
                                <Button type="button" variant="adminTable" size="sm" className="text-[var(--admin-tone-danger-text)]" disabled={isSubproductSaving} onClick={() => void handleDeleteSubproduct(subproduct.id)}>
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  삭제
                                </Button>
                              </div>
                            </div>
                          )}

                          <div className="space-y-3">
                            {filesForSubproduct.length > 0 ? (
                              <div className="space-y-2 rounded-md border bg-slate-50/70 p-3">
                                <p className="text-sm font-medium text-gray-900">업로드된 파일</p>
                                <div className="space-y-2">
                                  {filesForSubproduct.map((file) => (
                                    <div key={file.id} className="flex flex-col gap-2 rounded-md border bg-white px-3 py-2 text-sm md:flex-row md:items-center md:justify-between">
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <Badge variant="outline">{getFileTypeLabel(file.file_type_id)}</Badge>
                                          <span className="truncate font-medium text-gray-900">{file.original_file_name}</span>
                                          <Badge variant="secondary">v{file.version}</Badge>
                                        </div>
                                        <p className="mt-1 text-xs text-gray-500">{formatFileSize(file.file_size_bytes)} · {formatDateTime(file.created_at)}</p>
                                      </div>
                                      <Button type="button" variant="ghost" size="sm" onClick={() => void handleDeleteSubproductFile(subproduct.id, file.id)}>
                                        제거
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <div className="rounded-md border border-dashed bg-slate-50 px-4 py-6 text-center text-sm text-gray-500">
                                아직 업로드된 파일이 없습니다. 파일 추가+를 누른 뒤 여러 파일을 한 번에 끌어놓을 수 있습니다.
                              </div>
                            )}

                            <div className="flex justify-end">
                              <Button type="button" variant="brandOutline" size="sm" disabled={activeFileTypes.length === 0} onClick={() => handleAddSubproductFileDraft(subproduct.id)}>
                                <Plus className="mr-2 h-4 w-4" />
                                파일 추가+
                              </Button>
                            </div>

                            {activeFileTypes.length === 0 ? (
                              <div className="rounded-md border border-dashed bg-slate-50 px-4 py-6 text-center text-sm text-gray-500">
                                등록된 파일 유형이 없습니다. 파일 유형 설정에서 PDF/HWP/ZIP 등의 유형을 먼저 등록하세요.
                              </div>
                            ) : null}

                            {subproductFileDrafts.filter((draft) => draft.subproductId === subproduct.id).map((draft) => {
                              const isUploading = subproductUploadingKeys.includes(draft.id)
                              const isDragActive = subproductDragActiveKeys.includes(draft.id)
                              const inputId = `subproduct-file-draft-${draft.id}`

                              return (
                                <div key={draft.id} className="space-y-3 rounded-md border p-3">
                                  <div className="flex flex-col gap-3 md:flex-row md:items-end">
                                    <div className="flex-1 space-y-2">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <Label>파일 유형</Label>
                                        <TaxonomyManageLinks workspaceSubject={workspaceSubject} onRefresh={() => void refreshUploadTaxonomy()} />
                                      </div>
                                      <select
                                        value={draft.fileTypeId}
                                        disabled={isUploading}
                                        aria-invalid={draft.needsReselect ? true : undefined}
                                        onChange={(event) => handleUpdateSubproductFileDraft(draft.id, { fileTypeId: event.target.value, needsReselect: false })}
                                        className="flex h-10 w-full rounded-md border bg-white px-3 text-sm"
                                      >
                                        <option value="">파일 유형 선택</option>
                                        {activeFileTypes.map((fileType) => (
                                          <option key={fileType.id} value={fileType.id}>{fileType.label}</option>
                                        ))}
                                      </select>
                                      {draft.needsReselect ? <p className="text-xs font-semibold text-red-700">고르던 파일 유형이 숨겨지거나 지워졌습니다. 다시 골라 주세요.</p> : null}
                                    </div>
                                    <Button type="button" variant="ghost" size="sm" disabled={isUploading} onClick={() => handleRemoveSubproductFileDraft(draft.id)}>
                                      row 삭제
                                    </Button>
                                  </div>
                                  <input
                                    id={inputId}
                                    type="file"
                                    className="hidden"
                                    multiple
                                    accept={activeFileTypes.map(getFileTypeAcceptValue).join(',')}
                                    disabled={isUploading || !draft.fileTypeId}
                                    onChange={(event) => {
                                      const selectedFiles = Array.from(event.target.files || [])
                                      event.target.value = ''
                                      void handleSubproductFileUpload(subproduct.id, draft.fileTypeId, selectedFiles, draft.id)
                                    }}
                                  />
                                  <label
                                    htmlFor={!isUploading && draft.fileTypeId ? inputId : undefined}
                                    onDragEnter={(event) => {
                                      if (isUploading || !draft.fileTypeId) return
                                      event.preventDefault()
                                      setSubproductDragActive(draft.id, true)
                                    }}
                                    onDragOver={(event) => {
                                      if (isUploading || !draft.fileTypeId) return
                                      event.preventDefault()
                                      setSubproductDragActive(draft.id, true)
                                    }}
                                    onDragLeave={(event) => {
                                      if (isUploading || !draft.fileTypeId) return
                                      event.preventDefault()
                                      setSubproductDragActive(draft.id, false)
                                    }}
                                    onDrop={(event) => {
                                      if (isUploading || !draft.fileTypeId) return
                                      event.preventDefault()
                                      setSubproductDragActive(draft.id, false)
                                      void handleSubproductFileUpload(subproduct.id, draft.fileTypeId, Array.from(event.dataTransfer.files || []), draft.id)
                                    }}
                                    className={`flex min-h-32 flex-col justify-center rounded-md border border-dashed px-4 py-4 text-left transition ${
                                      isUploading
                                        ? 'cursor-not-allowed border-emerald-300 bg-emerald-50 text-emerald-700'
                                        : isDragActive
                                          ? 'cursor-pointer border-primary bg-primary/5'
                                          : 'cursor-pointer border-red-200 bg-red-50/40 hover:border-red-300 hover:bg-red-50'
                                    }`}
                                  >
                                    <p className={`text-sm font-medium ${isUploading ? 'text-emerald-900' : 'text-red-900'}`}>드래그앤드랍 또는 클릭하여 업로드 (여러 파일 한 번에 가능)</p>
                                    <p className={`mt-1 text-xs ${isUploading ? 'text-emerald-700' : 'text-red-700'}`}>허용 형식: {activeFileTypes.map(getFileTypeAcceptValue).join(', ')} · 파일 유형은 확장자로 정해집니다.</p>
                                    {isUploading ? <p className="mt-2 text-xs text-emerald-700">업로드 중입니다...</p> : null}
                                  </label>
                                  <p className="text-xs text-gray-500">{uploadLimitText}</p>
                                  <UploadQueueList
                                    entries={uploadQueues[draft.id] ?? []}
                                    busy={isUploading}
                                    onRetry={(entryId) => void handleRetryUploadEntry(subproduct.id, draft.id, entryId)}
                                    onRemove={(entryId) => handleRemoveUploadEntry(draft.id, entryId)}
                                  />
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                {subproducts.length === 0 || isSubproductFormOpen ? (
                  <div className="rounded-md border bg-slate-50/60 p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="font-medium text-gray-900">새 서브상품</p>
                      {subproducts.length > 0 ? (
                        <Button type="button" variant="ghost" size="sm" disabled={isSubproductSaving} onClick={() => setIsSubproductFormOpen(false)}>
                          닫기
                        </Button>
                      ) : null}
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Label>서브상품 카테고리</Label>
                          <TaxonomyManageLinks workspaceSubject={workspaceSubject} onRefresh={() => void refreshUploadTaxonomy()} />
                        </div>
                        <select
                          value={subproductDraft.categoryId}
                          aria-invalid={subproductDraft.needsReselect ? true : undefined}
                          onChange={(event) => setSubproductDraft((current) => ({ ...current, categoryId: event.target.value, needsReselect: false }))}
                          className="flex h-10 w-full rounded-md border bg-white px-3 text-sm"
                        >
                          <option value="">카테고리 선택</option>
                          {activeSubproductCategories.map((category) => (
                            <option key={category.id} value={category.id}>{category.name}</option>
                          ))}
                        </select>
                        {subproductDraft.needsReselect ? <p className="text-xs font-semibold text-red-700">고르던 구성이 숨겨지거나 지워졌습니다. 다시 골라 주세요.</p> : null}
                      </div>
                      <div className="space-y-2">
                        <Label>서브상품 가격</Label>
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={subproductDraft.priceCredits}
                          placeholder="예: 1,000"
                          onChange={(event) => setSubproductDraft((current) => ({ ...current, priceCredits: formatCreditInputValue(event.target.value) }))}
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label>서브상품 설명</Label>
                        <Textarea value={subproductDraft.description} onChange={(event) => setSubproductDraft((current) => ({ ...current, description: event.target.value }))} className="min-h-[72px]" />
                      </div>
                      <details className="md:col-span-2">
                        <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-900">고급 설정 (구매 안내 문구)</summary>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label>구매 안내 라벨</Label>
                            <Input
                              value={subproductDraft.purchaseNoticeLabel}
                              onChange={(event) => setSubproductDraft((current) => ({ ...current, purchaseNoticeLabel: event.target.value }))}
                              maxLength={24}
                              placeholder="예: PDF 포함"
                            />
                          </div>
                          <div className="space-y-2 md:col-span-2">
                            <Label>구매 안내 문구</Label>
                            <Textarea
                              value={subproductDraft.purchaseNoticeText}
                              onChange={(event) => setSubproductDraft((current) => ({ ...current, purchaseNoticeText: event.target.value }))}
                              className="min-h-[72px]"
                              maxLength={160}
                              placeholder="예: 편집 가능한 HWP와 문제(PDF)를 함께 제공합니다. PDF는 따로 구매하지 않아도 됩니다."
                            />
                            <p className="text-xs text-gray-500">사용자 상세 페이지의 구매 옵션 행에 표시됩니다. 비워두면 HWP+PDF 구성에서는 기본 안내 문구가 표시됩니다.</p>
                          </div>
                        </div>
                      </details>
                    </div>
                    <div className="mt-3 flex items-center justify-end gap-3">
                      {isUploadBlockedByCategory ? <p className="text-xs text-amber-700">카테고리를 먼저 선택해주세요.</p> : null}
                      <Button type="button" disabled={isSubproductSaving || activeSubproductCategories.length === 0 || isUploadBlockedByCategory || !subproductDraft.categoryId} onClick={() => void handleCreateSubproduct()}>
                        {isSubproductSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                        서브상품 추가
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button type="button" variant="brandOutline" className="w-full border-dashed" disabled={isSubproductSaving} onClick={() => setIsSubproductFormOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    서브상품 추가
                  </Button>
                )}
    </>
  )
}
