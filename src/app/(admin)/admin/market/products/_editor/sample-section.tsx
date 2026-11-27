import { Loader2, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ProductAdminContext } from '../market-products-client'

export function SampleSection({ ctx, canOpenSamplePreview }: { ctx: ProductAdminContext; canOpenSamplePreview: boolean }) {
  const {
    form, setIsSamplePreviewOpen, setSamplePreviewItemId, samplePages, samplePageSelection, setSamplePageSelection,
    selectedSampleSourceFile, isSampleSourceDragActive, setIsSampleSourceDragActive, samplePageDragId,
    setSamplePageDragId, isSampleSourceUploading, deletingSamplePageId, sampleSourceInputRef,
    isUploadBlockedByCategory, handleSelectSampleSourceFile, handleGenerateSampleImages, handleDeleteSamplePage,
    handleDeleteAllSamplePages, handleMoveSamplePage,
  } = ctx

  return (
    <>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="product-sample-pages">샘플 페이지</Label>
                    <Input
                      id="product-sample-pages"
                      value={samplePageSelection}
                      onChange={(event) => setSamplePageSelection(event.target.value)}
                      placeholder="예: 1,5,7"
                    />
                    <p className="text-xs text-gray-500">쉼표로 페이지 번호를 입력합니다. 예: 1,5,7</p>
                  </div>
                  <input
                    ref={sampleSourceInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,application/pdf"
                    disabled={isSampleSourceUploading || isUploadBlockedByCategory}
                    onChange={(event) => handleSelectSampleSourceFile(event.target.files?.[0])}
                  />
                  <label
                    onDragEnter={(event) => {
                      if (isSampleSourceUploading || isUploadBlockedByCategory) return
                      event.preventDefault()
                      setIsSampleSourceDragActive(true)
                    }}
                    onDragOver={(event) => {
                      // 막힌 상태에서도 기본 동작(브라우저가 파일을 여는 것)은 막는다.
                      event.preventDefault()
                      if (isSampleSourceUploading || isUploadBlockedByCategory) return
                      setIsSampleSourceDragActive(true)
                    }}
                    onDragLeave={(event) => {
                      if (isSampleSourceUploading || isUploadBlockedByCategory) return
                      event.preventDefault()
                      setIsSampleSourceDragActive(false)
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (isUploadBlockedByCategory) {
                        toast.error('카테고리를 먼저 선택해주세요.')
                        return
                      }
                      if (isSampleSourceUploading) return
                      setIsSampleSourceDragActive(false)
                      handleSelectSampleSourceFile(event.dataTransfer.files?.[0])
                    }}
                    className={`flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-4 py-4 text-center transition ${
                      isSampleSourceDragActive
                        ? 'border-primary bg-primary/5'
                        : selectedSampleSourceFile
                          ? 'border-emerald-300 bg-emerald-50 hover:border-emerald-400 hover:bg-emerald-100'
                        : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100'
                    }`}
                    onClick={() => sampleSourceInputRef.current?.click()}
                  >
                    <Upload className={`mb-2 h-5 w-5 ${selectedSampleSourceFile ? 'text-emerald-700' : 'text-slate-500'}`} />
                    <p className={`text-sm font-medium ${selectedSampleSourceFile ? 'text-emerald-900' : 'text-gray-900'}`}>샘플 PDF를 드래그앤드롭하거나 클릭해서 선택하세요.</p>
                    <p className={`mt-1 text-xs ${selectedSampleSourceFile ? 'text-emerald-700' : 'text-gray-500'}`}>
                      {selectedSampleSourceFile ? `선택 파일: ${selectedSampleSourceFile.name}` : 'PDF를 선택한 뒤 샘플 이미지 생성 버튼을 클릭해야 JPG가 생성됩니다.'}
                    </p>
                  </label>
                  {isUploadBlockedByCategory ? <p className="text-xs text-amber-700">카테고리를 먼저 선택해주세요.</p> : null}
                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <Button
                      type="button"
                      variant="brandOutline"
                      className="text-[var(--admin-tone-danger-text)]"
                      disabled={samplePages.length === 0 || deletingSamplePageId === '__all__'}
                      onClick={() => void handleDeleteAllSamplePages()}
                    >
                      {deletingSamplePageId === '__all__' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                      샘플 이미지 전체 삭제
                    </Button>
                    <Button
                      type="button"
                      variant="brand"
                      disabled={isSampleSourceUploading || !selectedSampleSourceFile || isUploadBlockedByCategory}
                      onClick={() => void handleGenerateSampleImages()}
                    >
                      {isSampleSourceUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                      샘플 이미지 생성
                    </Button>
                    <Button
                      type="button"
                      variant="brandOutline"
                      disabled={!canOpenSamplePreview}
                      aria-label={`${form.title || '문제마켓 상품'} 샘플 JPG 확인`}
                      onClick={() => {
                        if (!form.id) {
                          return
                        }
                        setSamplePreviewItemId(form.id)
                        setIsSamplePreviewOpen(true)
                      }}
                    >
                      샘플 확인
                    </Button>
                  </div>
                </div>

                {samplePages.length > 0 ? (
                  <div className="flex flex-wrap gap-3 pt-2">
                    {samplePages.map((page) => (
                      <div
                        key={page.id}
                        draggable
                        onDragStart={(event) => {
                          setSamplePageDragId(page.id)
                          event.dataTransfer.effectAllowed = 'move'
                        }}
                        onDragOver={(event) => {
                          event.preventDefault()
                          event.dataTransfer.dropEffect = 'move'
                        }}
                        onDrop={(event) => {
                          event.preventDefault()
                          if (samplePageDragId) {
                            handleMoveSamplePage(samplePageDragId, page.id)
                          }
                          setSamplePageDragId(null)
                        }}
                        onDragEnd={() => setSamplePageDragId(null)}
                        className={`relative h-24 w-20 cursor-move overflow-hidden rounded border bg-slate-50 shadow-sm transition ${
                          samplePageDragId === page.id ? 'scale-95 opacity-60' : ''
                        }`}
                        title="드래그해서 샘플 이미지 순서를 변경할 수 있습니다."
                      >
                        <div
                          aria-label={`샘플 ${page.pageNumber}페이지`}
                          role="img"
                          className="h-full w-full bg-cover bg-center"
                          style={{ backgroundImage: `url(${page.signedUrl})` }}
                        />
                        <Badge className="absolute bottom-1 left-1 bg-black/60 text-white hover:bg-black/60">p.{page.pageNumber}</Badge>
                        <button
                          type="button"
                          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white"
                          disabled={deletingSamplePageId === page.id || deletingSamplePageId === '__all__'}
                          aria-label={`${page.pageNumber}페이지 샘플 삭제`}
                          onClick={() => void handleDeleteSamplePage(page)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed bg-slate-50 px-4 py-6 text-center text-sm text-gray-500">
                    아직 생성된 샘플 JPG가 없습니다.
                  </div>
                )}
    </>
  )
}
