import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MarketImageField } from '@/components/admin/market-image-field'
import type { ProductAdminContext } from '../market-products-client'

export function BasicInfoSection({ ctx }: { ctx: ProductAdminContext }) {
  const {
    form, setForm, setThumbnailPreview, thumbnailFieldValue, selectedCategoryDefaultImage,
  } = ctx

  return (
    <>
              <div className="space-y-2">
                <Label htmlFor="product-title-input">제목 <span className="text-red-500">*</span></Label>
                <Input id="product-title-input" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
              </div>

              <div className="space-y-2">
                <Label>요약</Label>
                <Input value={form.summary} onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))} />
                <p className="text-xs text-gray-500">상세 페이지 제목 아래에 한두 줄로 표시됩니다.</p>
              </div>

              <div id="product-image-field" tabIndex={-1}>
              <MarketImageField
                label="상품 이미지"
                value={thumbnailFieldValue}
                onChange={(image) => {
                  setThumbnailPreview(image)
                  setForm((current) => ({ ...current, thumbnailImageId: image?.id ?? null }))
                }}
                fallback={selectedCategoryDefaultImage
                  ? { image: selectedCategoryDefaultImage, description: '상품 이미지가 없어 카테고리 기본 이미지가 표시됩니다.' }
                  : null}
              />
              </div>
    </>
  )
}
