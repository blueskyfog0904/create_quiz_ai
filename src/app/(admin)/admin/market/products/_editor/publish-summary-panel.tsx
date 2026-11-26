import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { missingPublishChecks, type PublishCheck } from '@/lib/admin-market-publish-checks'
import { focusProductField } from '../_lib/focus-field'
import { formatCreditInputValue, parseCreditInputValue } from '../_lib/product-form'
import type { ProductAdminContext } from '../market-products-client'
import { categoryNodeLabel } from './category-step'

// 18번 8절: 고정 요약판 — 상품 카드 미리보기, 판매 구성 요약(서브상품 n개·합계·전체구매 가격), 샘플 장수, 빠진 항목 칩.
// 칩: 필수는 빨강, 경고는 노랑. 누르면 그 칸으로 스크롤하고 초점을 준다(접힌 칸이면 펼친다).
export function PublishSummaryPanel({ ctx, checks, variant, className }: {
  ctx: ProductAdminContext
  checks: PublishCheck[]
  variant: 'side' | 'collapsible'
  className?: string
}) {
  const { form, subproducts, bundleForm, samplePages, thumbnailFieldValue, selectedCategoryDefaultImage, selectedCategoryPath } = ctx
  const missing = missingPublishChecks(checks)
  const requiredCount = missing.filter((check) => check.level === 'required').length
  const activeSubproducts = subproducts.filter((subproduct) => subproduct.is_active)
  const totalPrice = activeSubproducts.reduce((sum, subproduct) => sum + subproduct.price_credits, 0)
  const imageUrl = thumbnailFieldValue?.publicUrl ?? selectedCategoryDefaultImage?.publicUrl ?? null

  const body = (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="h-16 w-12 shrink-0 overflow-hidden rounded border bg-slate-50">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- market-images 공개 버킷 URL을 그대로 보여 준다.
            <img src={imageUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>
        <div className="min-w-0 space-y-1">
          <p className="truncate text-sm font-semibold text-gray-900">{form.title.trim() || '제목 없음'}</p>
          <p className="text-xs text-gray-500">{selectedCategoryPath.length > 0 ? selectedCategoryPath.map(categoryNodeLabel).join(' > ') : '카테고리 미선택'}</p>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-gray-500">판매 구성</dt>
        <dd className="text-gray-900">서브상품 {activeSubproducts.length}개 · 합계 {formatCreditInputValue(totalPrice) || '0'}C</dd>
        <dt className="text-gray-500">전체구매</dt>
        <dd className="text-gray-900">{bundleForm.enabled ? `${formatCreditInputValue(parseCreditInputValue(bundleForm.priceCredits)) || '0'}C` : '사용 안 함'}</dd>
        <dt className="text-gray-500">샘플</dt>
        <dd className="text-gray-900">{samplePages.length}장</dd>
      </dl>
      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-700">빠진 항목</p>
        {missing.length === 0 ? (
          <p className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />모두 채웠습니다.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {missing.map((check) => (
              <button
                key={check.key}
                type="button"
                onClick={() => focusProductField(check.targetId)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                  check.level === 'required'
                    ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                    : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                }`}
              >
                {check.level === 'required' ? <XCircle className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                {check.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  if (variant === 'side') {
    return (
      <aside aria-label="상품 요약" className={`space-y-3 rounded-xl border bg-white p-4 shadow-sm ${className ?? ''}`}>
        <p className="text-sm font-semibold text-gray-900">상품 요약</p>
        {body}
      </aside>
    )
  }

  return (
    <details className={`rounded-xl border bg-white p-3 ${className ?? ''}`}>
      <summary className="cursor-pointer text-sm font-semibold text-gray-900">
        상품 요약 · 빠진 항목 {missing.length}개{requiredCount > 0 ? `(필수 ${requiredCount}개)` : ''}
      </summary>
      <div className="mt-3">{body}</div>
    </details>
  )
}
