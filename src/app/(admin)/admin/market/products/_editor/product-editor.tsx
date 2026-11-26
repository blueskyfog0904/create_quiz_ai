import { CheckCircle2, Circle, Loader2, MoreHorizontal, Trash2, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { MarketItemUsageBasisCard } from '../market-item-usage-basis-card'
import { MARKET_STATUS_LABELS, parseCreditInputValue } from '../_lib/product-form'
import type { ProductAdminContext } from '../market-products-client'
import { BasicInfoSection } from './basic-info-section'
import { BundleSection } from './bundle-section'
import { CategoryField } from './category-step'
import { MaterialInfoSection, ExamScheduleFields } from './material-info-section'
import { SampleSection } from './sample-section'
import { SubproductTable } from './subproduct-table'

// 상품 등록 폼의 단계 제목(① 기본 정보 … ⑤ 공개 전 점검)
function ProductStepHeading({ number, title, optional = false, description }: { number: number; title: string; optional?: boolean; description?: string }) {
  return (
    <div className="border-b pb-2">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white">{number}</span>
        <h3 className="font-semibold text-gray-900">{title}</h3>
        {optional ? <span className="text-xs text-gray-500">선택</span> : null}
      </div>
      {description ? <p className="mt-1 text-sm text-gray-500">{description}</p> : null}
    </div>
  )
}

export function ProductEditor({ ctx }: { ctx: ProductAdminContext }) {
  const {
    mode, workspaceSubject, canDeleteProducts, form, isSaving, isArchiving, samplePages, isSampleSourceUploading,
    sampleGenerationStep, subproducts, bundleForm, categoryItemId, selectedCategoryDefaultImage,
    subproductFilesBySubproductId, resetForm, handleSave, handleArchive,
  } = ctx

  const canOpenSamplePreview = Boolean(form.id && samplePages.length > 0 && !isSampleSourceUploading)
  const sampleGenerationStatusLabel = sampleGenerationStep === 'rendering'
    ? 'PDF 렌더링 중'
    : sampleGenerationStep === 'requesting_upload_targets'
      ? '업로드 준비 중'
      : sampleGenerationStep === 'uploading'
        ? '업로드 중'
        : sampleGenerationStep === 'finalizing'
          ? '저장 중'
          : '샘플 생성 중'
  const samplePreviewStatusLabel = isSampleSourceUploading ? sampleGenerationStatusLabel : samplePages.length > 0 ? '확인 가능' : '샘플 없음'
  const isAutoUploadDraft = Boolean(form.id && form.draftSource === 'auto_upload')
  // 공개 전 점검: required 항목이 하나라도 빠지면 공개(공개 상품은 저장)를 막는다.
  const activeSubproducts = subproducts.filter((subproduct) => subproduct.is_active)
  const publishChecks = [
    { key: 'category', label: '카테고리 선택', done: Boolean(categoryItemId), required: true },
    { key: 'title', label: '제목 입력', done: Boolean(form.title.trim()), required: true },
    { key: 'subproduct', label: '판매할 서브상품 1개 이상', done: activeSubproducts.length > 0, required: true },
    {
      key: 'files',
      label: '모든 서브상품에 파일 업로드',
      done: activeSubproducts.length > 0 && activeSubproducts.every((subproduct) => (subproductFilesBySubproductId.get(subproduct.id) || []).length > 0),
      required: true,
    },
    ...(bundleForm.enabled
      ? [{ key: 'bundle', label: '전체구매 가격 입력', done: parseCreditInputValue(bundleForm.priceCredits) > 0, required: true }]
      : []),
    { key: 'price', label: '서브상품 가격 입력(0 크레딧 없음)', done: activeSubproducts.length > 0 && activeSubproducts.every((subproduct) => subproduct.price_credits > 0), required: false },
    { key: 'image', label: '상품 이미지(없으면 카테고리 기본 이미지)', done: Boolean(form.thumbnailImageId || selectedCategoryDefaultImage), required: false },
    { key: 'sample', label: '샘플 이미지', done: samplePages.length > 0, required: false },
  ]
  const missingRequiredChecks = publishChecks.filter((check) => check.required && !check.done)
  const isPublishBlocked = missingRequiredChecks.length > 0
  // 자동 생성된 임시 상품은 DB 상태가 draft라 '공개 중'으로 보지 않는다.
  const isPublishedItem = Boolean(form.id) && !isAutoUploadDraft && form.status === 'published'
  const productSteps = [
    { id: 'product-step-basic', label: '기본 정보', done: Boolean(categoryItemId && form.title.trim()) },
    { id: 'product-step-sales', label: '판매 구성', done: publishChecks.filter((check) => check.required && ['subproduct', 'files', 'bundle'].includes(check.key)).every((check) => check.done) },
    { id: 'product-step-sample', label: '샘플', done: samplePages.length > 0 },
    { id: 'product-step-detail', label: '상세 정보', done: Boolean(form.description.trim()) },
    { id: 'product-step-publish', label: '공개', done: !isPublishBlocked },
  ]
  const scrollToProductStep = (stepId: string) => {
    document.getElementById(stepId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
        {mode === 'create' || form.id ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{form.id ? '상품 수정' : '상품 추가'}</CardTitle>
              <div className="flex items-center gap-2">
                {form.id ? <Badge variant="outline">편집 중</Badge> : null}
                {mode === 'manage' ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => resetForm()}>
                    수정 닫기
                  </Button>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-8">
            <nav aria-label="상품 등록 단계" className="flex flex-wrap gap-2">
              {productSteps.map((step, index) => (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => scrollToProductStep(step.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                    step.done
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {step.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span>{index + 1}</span>}
                  {step.label}
                </button>
              ))}
            </nav>

            <section id="product-step-basic" className="scroll-mt-24 space-y-4">
              <ProductStepHeading number={1} title="기본 정보" />
              <CategoryField ctx={ctx} />

              <BasicInfoSection ctx={ctx} />
            </section>

            <section id="product-step-sales" className="scroll-mt-24 space-y-4">
              <ProductStepHeading number={2} title="판매 구성" description="서브상품(판매 단위)을 만들고 파일을 올립니다. 첫 서브상품을 추가할 때 상품이 임시저장되므로 카테고리와 제목을 먼저 입력하세요." />
              <div className="space-y-4 rounded-lg border p-4">
                <div>
                  <p className="font-medium text-gray-900">서브상품 구성</p>
                  <p className="text-sm text-gray-500">서브상품마다 가격을 정하고, 파일 추가+로 PDF/HWP/ZIP 등 파일을 여러 개 한 번에 올립니다.</p>
                </div>

                <SubproductTable ctx={ctx} />
              </div>

              <BundleSection ctx={ctx} />
            </section>

            <section id="product-step-sample" className="scroll-mt-24 space-y-4">
              <ProductStepHeading number={3} title="샘플" optional />
              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900">샘플 생성</p>
                    <p className="text-sm text-gray-500">브라우저에서 샘플 JPG를 생성한 뒤 업로드합니다. 샘플로 사용할 페이지 번호만 JPG로 생성합니다.</p>
                  </div>
                  <Badge variant={samplePages.length > 0 ? 'outline' : 'secondary'}>{samplePreviewStatusLabel}</Badge>
                </div>

                <SampleSection ctx={ctx} canOpenSamplePreview={canOpenSamplePreview} />
              </div>
            </section>

            <section id="product-step-detail" className="scroll-mt-24 space-y-4">
              <ProductStepHeading number={4} title="상세 정보" optional />
              <MaterialInfoSection ctx={ctx} />

              {form.id
                ? <MarketItemUsageBasisCard key={form.id} itemId={form.id} workspaceSubject={workspaceSubject} />
                : <p className="rounded-lg border border-dashed p-4 text-sm text-gray-500">원저작물 이용 근거(내부)는 상품을 처음 저장한 뒤에 입력합니다.</p>}

              <ExamScheduleFields ctx={ctx} />
            </section>

            <section id="product-step-publish" className="scroll-mt-24 space-y-4">
              <ProductStepHeading number={5} title="공개 전 점검" description="필수 항목을 모두 채워야 공개할 수 있습니다." />
              <ul className="space-y-2 rounded-lg border p-4 text-sm">
                {publishChecks.map((check) => (
                  <li key={check.key} className="flex items-center gap-2">
                    {check.done
                      ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                      : check.required
                        ? <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                        : <Circle className="h-4 w-4 shrink-0 text-gray-300" />}
                    <span className={check.done ? 'text-gray-700' : check.required ? 'font-medium text-red-700' : 'text-gray-500'}>{check.label}</span>
                    {check.required ? null : <span className="text-xs text-gray-400">선택</span>}
                  </li>
                ))}
              </ul>

                {isAutoUploadDraft ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <p className="font-semibold">임시 업로드 상태</p>
                    <p className="mt-1">
                      {canDeleteProducts
                        ? '상품 등록을 완료하지 않고 업로드 파일을 삭제하려면 등록 취소 및 파일 삭제를 눌러주세요.'
                        : '등록을 취소하고 업로드 파일을 지우려면 상품 삭제 권한이 필요합니다. 대표 관리자에게 요청해 주세요.'}
                    </p>
                  </div>
                ) : null}
            </section>

            <div className="sticky bottom-4 z-10 -mx-2 space-y-2 rounded-xl border bg-white/95 px-2 py-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-white/85">
              <p className="px-1 text-xs text-gray-500">
                {form.id ? `현재 상태: ${MARKET_STATUS_LABELS[isAutoUploadDraft ? 'draft' : form.status]}` : '새 상품'}
                {isPublishBlocked ? ` · 공개 전 필수 항목 ${missingRequiredChecks.length}개가 남았습니다.` : ''}
              </p>
              <div className="flex gap-2">
                {isPublishedItem ? null : (
                  <Button type="button" variant="adminAction" className="h-11" disabled={isSaving} onClick={() => void handleSave('draft')}>
                    임시저장
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={() => void handleSave('published')}
                  disabled={isSaving || isPublishBlocked}
                  className="h-11 flex-1 text-base font-semibold shadow-sm"
                >
                  {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {isPublishedItem ? '저장' : '공개하기'}
                </Button>
                {form.id ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" size="icon" className="h-11 w-11" disabled={isSaving || isArchiving} aria-label="다른 상태로 저장·삭제">
                        {isArchiving ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {isPublishedItem ? (
                        <DropdownMenuItem onSelect={() => void handleSave('draft')}>임시저장으로 전환</DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem onSelect={() => void handleSave('hidden')}>숨김으로 저장</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void handleSave('archived')}>보관으로 저장</DropdownMenuItem>
                      {canDeleteProducts ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-red-600 focus:text-red-700" onSelect={() => void handleArchive()}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            {isAutoUploadDraft ? '등록 취소 및 파일 삭제' : '완전 삭제'}
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
        ) : null}
    </>
  )
}
