'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import {
  fillMarketRefundDays,
  MARKET_PURCHASE_POLICY_PLACEHOLDER_REQUIRED,
  MARKET_PURCHASE_POLICY_TEXT_KEYS,
  MARKET_PURCHASE_POLICY_TEXT_LABELS,
  MARKET_PURCHASE_POLICY_TEXT_LIMITS,
  MARKET_REFUND_DAYS_PLACEHOLDER,
  normalizeMarketPurchasePolicyText,
  validateMarketPurchasePolicyTexts,
  type MarketPurchasePolicy,
  type MarketPurchasePolicyTexts,
} from '@/lib/market-purchase-policy'
import { saveMarketPurchasePolicyAction } from './purchase-policy-actions'

const TEXT_HINTS: Record<keyof MarketPurchasePolicyTexts, string> = {
  checkboxLabel: '구매 확인창의 필수 체크 문구입니다. 바꾸면 그 뒤 구매는 새 문구로 동의를 받습니다.',
  confirmNotice: '구매 확인창에서 체크 위에 보이는 고지입니다.',
  usageScopeNotice: '상품 상세 "구매 전 확인"의 이용 범위 줄입니다.',
  downloadPeriodNotice: '상품 상세 "구매 전 확인"의 이용 기간 줄입니다.',
  detailRefundNotice: '상품 상세 "구매 전 확인"의 환불 줄입니다.',
  refundExpiredReason: '환불 기간이 지난 구매 건에 보이는 안내입니다(자료 보관함·관리자 승인).',
  purchaseCompleteNotice: '상품 상세 자료 선택 아래에 보이는 안내입니다.',
  partialRefundConfirmNotice: '자료 보관함에서 패키지의 받지 않은 자료 환불을 신청할 때 확인창에 보이는 안내입니다.',
}

function pickTexts(policy: MarketPurchasePolicy): MarketPurchasePolicyTexts {
  const texts = {} as MarketPurchasePolicyTexts
  for (const key of MARKET_PURCHASE_POLICY_TEXT_KEYS) texts[key] = policy[key]
  return texts
}

function normalizeTexts(texts: MarketPurchasePolicyTexts): MarketPurchasePolicyTexts {
  const normalized = {} as MarketPurchasePolicyTexts
  for (const key of MARKET_PURCHASE_POLICY_TEXT_KEYS) normalized[key] = normalizeMarketPurchasePolicyText(texts[key])
  return normalized
}

// 자료 구매 고지(구매 확인창·상품 상세·환불 안내). 환불 기간 값은 여기서 바꾸지 않는다.
export function PurchasePolicyForm({ initial }: { initial: MarketPurchasePolicy | null }) {
  const router = useRouter()
  const [saved, setSaved] = useState<MarketPurchasePolicy | null>(initial)
  const [draft, setDraft] = useState<MarketPurchasePolicyTexts | null>(initial ? pickTexts(initial) : null)
  const [isSaving, setIsSaving] = useState(false)

  const normalizedDraft = draft ? normalizeTexts(draft) : null
  const hasChanges = Boolean(saved && normalizedDraft
    && MARKET_PURCHASE_POLICY_TEXT_KEYS.some((key) => normalizedDraft[key] !== saved[key]))
  const invalid = normalizedDraft ? validateMarketPurchasePolicyTexts(normalizedDraft) : null
  useUnsavedChangesGuard(hasChanges)

  async function handleSave() {
    if (!draft || !hasChanges || invalid || isSaving) return
    setIsSaving(true)
    try {
      const result = await saveMarketPurchasePolicyAction(draft)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setSaved(result.data)
      setDraft(pickTexts(result.data))
      toast.success('구매 고지를 저장했습니다.')
      router.refresh()
    } catch {
      toast.error('구매 고지를 저장하지 못했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>구매 고지</CardTitle>
        <CardDescription>
          자료 구매 확인창, 상품 상세 &quot;구매 전 확인&quot;, 환불 안내에 쓰입니다.
          {saved ? (
            <> {MARKET_REFUND_DAYS_PLACEHOLDER} 자리에는 자료 환불 기간 <strong>{saved.refundDays}일</strong>이 들어갑니다(기간 값은 여기서 바꾸지 않습니다).</>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!saved || !draft ? (
          <p role="alert" className="text-sm text-destructive">
            구매 고지 설정을 읽지 못했습니다. 새로고침한 뒤 다시 시도해 주세요. (덮어쓰지 않도록 저장을 막았습니다)
          </p>
        ) : (
          <>
            {MARKET_PURCHASE_POLICY_TEXT_KEYS.map((key) => {
              const id = `market-purchase-policy-${key}`
              const value = draft[key]
              const required = MARKET_PURCHASE_POLICY_PLACEHOLDER_REQUIRED.includes(key)
              return (
                <div key={key} className="space-y-2">
                  <Label htmlFor={id}>
                    {MARKET_PURCHASE_POLICY_TEXT_LABELS[key]}
                    {required ? <span className="ml-1 text-xs font-normal text-muted-foreground">({MARKET_REFUND_DAYS_PLACEHOLDER} 필수)</span> : null}
                  </Label>
                  <Textarea
                    id={id}
                    value={value}
                    rows={key === 'confirmNotice' || key === 'detailRefundNotice' || key === 'partialRefundConfirmNotice' ? 4 : 2}
                    maxLength={MARKET_PURCHASE_POLICY_TEXT_LIMITS[key]}
                    disabled={isSaving}
                    onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                  />
                  <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                    <span>{TEXT_HINTS[key]}</span>
                    <span>{value.length}/{MARKET_PURCHASE_POLICY_TEXT_LIMITS[key]}</span>
                  </div>
                  {value.includes(MARKET_REFUND_DAYS_PLACEHOLDER) ? (
                    <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                      보이는 문장: {fillMarketRefundDays(normalizeMarketPurchasePolicyText(value), saved.refundDays)}
                    </p>
                  ) : null}
                </div>
              )
            })}
            {invalid && hasChanges ? <p role="alert" className="text-sm text-destructive">{invalid}</p> : null}
            <div className="flex justify-end">
              <Button type="button" disabled={!hasChanges || Boolean(invalid) || isSaving} onClick={() => void handleSave()}>
                {isSaving ? <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" /> : <Save aria-hidden="true" className="mr-2 h-4 w-4" />}
                구매 고지 저장
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
