import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { formatCreditInputValue, formatFileSize, formatDateTime, MANAGE_SUBPRODUCT_CATEGORIES_VALUE, MANAGE_FILE_TYPES_VALUE } from '../_lib/product-form'
import type { ProductAdminContext } from '../market-products-client'

export function SubproductTable({ ctx }: { ctx: ProductAdminContext }) {
  const {
    subproducts, isSubproductFormOpen, setIsSubproductFormOpen, editingSubproductId, subproductEditDraft,
    setSubproductEditDraft, setIsCategorySettingsOpen, setIsFileTypeSettingsOpen, isSubproductSaving,
    subproductUploadingKeys, subproductDragActiveKeys, subproductCategories, subproductDraft, setSubproductDraft,
    subproductFileDrafts, isUploadBlockedByCategory, activeSubproductCategories, activeFileTypes,
    subproductFilesBySubproductId, getSubproductCategoryName, getFileTypeLabel, getFileTypeAcceptValue,
    handleAddSubproductFileDraft, handleUpdateSubproductFileDraft, handleRemoveSubproductFileDraft,
    setSubproductDragActive, handleCreateSubproduct, handleEditSubproduct, handleCancelEditSubproduct,
    handleSaveSubproduct, handleDeleteSubproduct, handleSubproductFileUpload, handleDeleteSubproductFile,
  } = ctx

  return (
    <>
                {subproducts.length === 0 ? (
                  <div className="rounded-md border border-dashed bg-white px-4 py-8 text-center text-sm text-gray-500">
                    아직 서브상품이 없습니다. 아래에서 첫 서브상품을 추가하세요.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {subproducts.map((subproduct) => {
                      const filesForSubproduct = subproductFilesBySubproductId.get(subproduct.id) || []
                      const isEditingSubproduct = editingSubproductId === subproduct.id && subproductEditDraft

                      return (
                        <div key={subproduct.id} className="space-y-3 rounded-md border bg-white p-3">
                          {isEditingSubproduct ? (
                            <div className="space-y-3 rounded-md border bg-slate-50/80 p-3">
                              <div className="grid gap-3 md:grid-cols-2">
                                <div className="space-y-2">
                                  <Label>서브상품 카테고리</Label>
                                  <select
                                    value={subproductEditDraft.categoryId}
                                    onChange={(event) => {
                                      if (event.target.value === MANAGE_SUBPRODUCT_CATEGORIES_VALUE) {
                                        setIsCategorySettingsOpen(true)
                                        return
                                      }

                                      setSubproductEditDraft((current) => current ? { ...current, categoryId: event.target.value } : current)
                                    }}
                                    className="flex h-10 w-full rounded-md border bg-white px-3 text-sm"
                                  >
                                    <option value="">카테고리 선택</option>
                                    {subproductCategories.map((category) => (
                                      <option key={category.id} value={category.id}>{category.name}</option>
                                    ))}
                                    <option value={MANAGE_SUBPRODUCT_CATEGORIES_VALUE}>설정하기</option>
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
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-semibold text-gray-900">{getSubproductCategoryName(subproduct.category_id)}</p>
                                  <Badge variant={subproduct.is_active ? 'outline' : 'secondary'}>{subproduct.is_active ? '활성' : '비활성'}</Badge>
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
                              <div className="flex gap-2">
                                <Button type="button" variant="adminAction" size="sm" disabled={isSubproductSaving} onClick={() => handleEditSubproduct(subproduct)}>
                                  수정
                                </Button>
                                <Button type="button" variant="outline" size="sm" disabled={isSubproductSaving} onClick={() => void handleDeleteSubproduct(subproduct.id)}>
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
                              <Button type="button" variant="adminAction" size="sm" disabled={activeFileTypes.length === 0} onClick={() => handleAddSubproductFileDraft(subproduct.id)}>
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
                                      <Label>파일 유형</Label>
                                      <select
                                        value={draft.fileTypeId}
                                        disabled={isUploading}
                                        onChange={(event) => {
                                          if (event.target.value === MANAGE_FILE_TYPES_VALUE) {
                                            setIsFileTypeSettingsOpen(true)
                                            return
                                          }

                                          handleUpdateSubproductFileDraft(draft.id, { fileTypeId: event.target.value })
                                        }}
                                        className="flex h-10 w-full rounded-md border bg-white px-3 text-sm"
                                      >
                                        <option value="">파일 유형 선택</option>
                                        {activeFileTypes.map((fileType) => (
                                          <option key={fileType.id} value={fileType.id}>{fileType.label}</option>
                                        ))}
                                        <option value={MANAGE_FILE_TYPES_VALUE}>설정하기</option>
                                      </select>
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
                                    disabled={isUploading}
                                    onChange={(event) => {
                                      const selectedFiles = Array.from(event.target.files || [])
                                      event.target.value = ''
                                      void handleSubproductFileUpload(subproduct.id, draft.fileTypeId, selectedFiles, draft.id)
                                    }}
                                  />
                                  <label
                                    htmlFor={!isUploading ? inputId : undefined}
                                    onDragEnter={(event) => {
                                      if (isUploading) return
                                      event.preventDefault()
                                      setSubproductDragActive(draft.id, true)
                                    }}
                                    onDragOver={(event) => {
                                      if (isUploading) return
                                      event.preventDefault()
                                      setSubproductDragActive(draft.id, true)
                                    }}
                                    onDragLeave={(event) => {
                                      if (isUploading) return
                                      event.preventDefault()
                                      setSubproductDragActive(draft.id, false)
                                    }}
                                    onDrop={(event) => {
                                      if (isUploading) return
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
                        <Label>서브상품 카테고리</Label>
                        <select
                          value={subproductDraft.categoryId}
                          onChange={(event) => {
                            if (event.target.value === MANAGE_SUBPRODUCT_CATEGORIES_VALUE) {
                              setIsCategorySettingsOpen(true)
                              return
                            }

                            setSubproductDraft((current) => ({ ...current, categoryId: event.target.value }))
                          }}
                          className="flex h-10 w-full rounded-md border bg-white px-3 text-sm"
                        >
                          <option value="">카테고리 선택</option>
                          {activeSubproductCategories.map((category) => (
                            <option key={category.id} value={category.id}>{category.name}</option>
                          ))}
                          <option value={MANAGE_SUBPRODUCT_CATEGORIES_VALUE}>설정하기</option>
                        </select>
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
                      <Button type="button" disabled={isSubproductSaving || activeSubproductCategories.length === 0 || isUploadBlockedByCategory} onClick={() => void handleCreateSubproduct()}>
                        {isSubproductSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                        서브상품 추가
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button type="button" variant="adminAction" className="w-full border-dashed" disabled={isSubproductSaving} onClick={() => setIsSubproductFormOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    서브상품 추가
                  </Button>
                )}
    </>
  )
}
