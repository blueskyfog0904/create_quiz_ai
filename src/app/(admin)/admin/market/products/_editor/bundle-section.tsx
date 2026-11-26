import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { resolveBundleTitle } from '@/lib/market-item-options'
import { formatCreditInputValue, buildBundleFormFromOption, isSameBundleForm } from '../_lib/product-form'
import type { ProductAdminContext } from '../market-products-client'

export function BundleSection({ ctx }: { ctx: ProductAdminContext }) {
  const {
    bundleOption, bundleForm, setBundleForm, bundleDefaultTitle,
  } = ctx
  // 19번: 상세 전체구매 제목 미리보기(표시명, 비면 DB 기본 제목). 기본 제목을 읽지 못했으면 '(기본 제목)'.
  const bundleTitlePreview = resolveBundleTitle(bundleForm.label, bundleDefaultTitle ? { bundleDefaultTitle } : null) ?? '(기본 제목)'

  return (
              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900">전체구매 · {bundleTitlePreview}</p>
                    <p className="text-sm text-gray-500">옵션을 켜고 금액을 입력하면 등록된 서브상품의 모든 파일을 한 번에 구매할 수 있습니다.</p>
                    <p className="text-xs text-gray-500">서브상품·파일은 누르는 즉시 저장되고, 전체구매 설정은 아래 저장 버튼을 눌러야 저장됩니다.</p>
                  </div>
                  {!isSameBundleForm(bundleForm, buildBundleFormFromOption(bundleOption))
                    ? <Badge className="border-amber-300 bg-amber-50 text-amber-800" variant="outline">저장 안 됨</Badge>
                    : bundleOption ? <Badge variant="outline">저장됨</Badge> : <Badge variant="secondary">미설정</Badge>}
                </div>
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">전체구매 옵션 사용</p>
                    <p className="text-xs text-gray-500">기본값은 미사용입니다. 켜고 가격을 입력하면 사용자 상세페이지에 전체구매 카드가 노출됩니다.</p>
                  </div>
                  <Switch checked={bundleForm.enabled} onCheckedChange={(checked) => setBundleForm((current) => ({ ...current, enabled: checked }))} />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="product-bundle-label">표시명</Label>
                    <Input
                      id="product-bundle-label"
                      disabled={!bundleForm.enabled}
                      value={bundleForm.label}
                      placeholder={bundleDefaultTitle ?? undefined}
                      aria-describedby="product-bundle-label-help"
                      onChange={(event) => setBundleForm((current) => ({ ...current, label: event.target.value }))}
                    />
                    <p id="product-bundle-label-help" className="text-xs text-gray-500">
                      상세·장바구니에 보이는 이름입니다.{bundleDefaultTitle ? ` 비우면 '${bundleDefaultTitle}'로 보입니다.` : ''}
                    </p>
                    <p className="text-xs text-gray-700">상세 제목 미리보기: <span className="font-semibold">{bundleTitlePreview}</span></p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="product-bundle-price">전체구매 가격</Label>
                    <Input
                      id="product-bundle-price"
                      disabled={!bundleForm.enabled}
                      type="text"
                      inputMode="numeric"
                      value={bundleForm.priceCredits}
                      placeholder="예: 10,000"
                      onChange={(event) => setBundleForm((current) => ({ ...current, priceCredits: formatCreditInputValue(event.target.value) }))}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>전체구매 설명</Label>
                    <Textarea disabled={!bundleForm.enabled} value={bundleForm.description} onChange={(event) => setBundleForm((current) => ({ ...current, description: event.target.value }))} className="min-h-[72px]" />
                  </div>
                </div>
              </div>
  )
}
