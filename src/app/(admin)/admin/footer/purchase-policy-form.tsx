'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard'
import { CheckoutConsentEditor } from '@/components/admin/checkout-consent-editor'
import {
  MarketCheckoutConsentPreview,
  StoredCheckoutConsentFingerprint,
  type CheckoutPanelFit,
} from '@/components/admin/checkout-consent-admin-preview'
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
import {
  buildCheckoutConsentDraft,
  charLength,
  checkCheckoutConsentKeys,
  checkMarketCartTexts,
  MARKET_CART_TEXT_KEYS,
  MARKET_CART_TEXT_LABELS,
  MARKET_CART_TEXT_MAX,
} from '@/lib/checkout-consent'
import {
  CHECKOUT_CONSENT_FINGERPRINT_HINT,
  CHECKOUT_PANEL_OVERFLOW_MESSAGE,
  checkoutConsentFingerprintFields,
  describeCheckoutConsentFormat,
  MARKET_CART_TEXT_HINT,
  normalizeCheckoutConsentKeysInput,
  normalizeMarketCartTextsInput,
  pickCheckoutConsentKeys,
  pickMarketCartTexts,
  type CheckoutConsentKeysInput,
  type MarketCartTextsInput,
} from '@/lib/checkout-consent-admin'
import type { MarketPurchasePolicyAdminData } from '@/lib/market-purchase-policy-server'
import { saveMarketPurchasePolicyAction, type MarketPurchasePolicyAdminView } from './purchase-policy-actions'

const TEXT_HINTS: Record<keyof MarketPurchasePolicyTexts, string> = {
  checkboxLabel: '장바구니 결제 칸(예전 방식)의 필수 체크 문구입니다.',
  confirmNotice: '장바구니 결제 칸(예전 방식)에서 체크 위에 보이는 고지이고, 새 방식에서는 세부 항목 창의 본문입니다.',
  usageScopeNotice: '상품 상세 "구매 전 확인"의 이용 범위 줄입니다(새 방식 세부 항목 본문으로도 고를 수 있음).',
  downloadPeriodNotice: '상품 상세 "구매 전 확인"의 이용 기간 줄입니다(새 방식 세부 항목 본문으로도 고를 수 있음).',
  detailRefundNotice: '상품 상세 "구매 전 확인"의 환불 줄입니다.',
  refundExpiredReason: '환불 기간이 지난 구매 건에 보이는 안내입니다(자료 보관함·관리자 승인).',
  purchaseCompleteNotice: '상품 상세 담기 버튼 아래에 보이는 안내입니다.',
  partialRefundConfirmNotice: '자료 보관함에서 패키지의 받지 않은 자료 환불을 신청할 때 확인창에 보이는 안내입니다.',
}

// 새 방식(접는 동의)일 때 예전 방식에만 쓰는 칸. '되돌리기용'으로 접되 검사는 그대로 한다.
const LEGACY_ONLY_KEYS: readonly (keyof MarketPurchasePolicyTexts)[] = ['checkboxLabel']
const PREVIEW_SHA = '0'.repeat(64)

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

// 자료 구매 고지(장바구니 결제 칸·상품 상세·환불 안내). 환불 기간 값과 동의 방식(판)은 여기서 바꾸지 않는다.
export function PurchasePolicyForm({ initial }: { initial: MarketPurchasePolicyAdminView }) {
  const router = useRouter()
  const [saved, setSaved] = useState<MarketPurchasePolicyAdminData | null>(initial.data)
  const [draft, setDraft] = useState<MarketPurchasePolicyTexts | null>(initial.data ? pickTexts(initial.data.policy) : null)
  const [consentDraft, setConsentDraft] = useState<CheckoutConsentKeysInput | null>(initial.data ? pickCheckoutConsentKeys('market', initial.data.raw) : null)
  const [cartDraft, setCartDraft] = useState<MarketCartTextsInput | null>(initial.data ? pickMarketCartTexts(initial.data.raw) : null)
  const [legacyOpen, setLegacyOpen] = useState(false)
  const [fit, setFit] = useState<{ legacy: CheckoutPanelFit; consent: CheckoutPanelFit }>({ legacy: null, consent: null })
  const [isSaving, setIsSaving] = useState(false)
  const onFitChange = useCallback((next: { legacy: CheckoutPanelFit; consent: CheckoutPanelFit }) => setFit(next), [])

  const normalizedDraft = draft ? normalizeTexts(draft) : null
  const normalizedConsent = consentDraft ? normalizeCheckoutConsentKeysInput('market', consentDraft) : null
  const normalizedCart = cartDraft ? normalizeMarketCartTextsInput(cartDraft) : null
  const merged: Record<string, unknown> | null = saved && normalizedDraft
    ? { ...saved.raw, ...normalizedDraft, ...(normalizedConsent ?? {}), ...(normalizedCart ?? {}) }
    : null
  const consentProblems = merged && normalizedConsent ? checkCheckoutConsentKeys('market', merged) : []
  const cartProblems = merged && normalizedCart ? checkMarketCartTexts(merged) : []
  const savedConsent = saved ? pickCheckoutConsentKeys('market', saved.raw) : null
  const savedCart = saved ? pickMarketCartTexts(saved.raw) : null
  const hasChanges = Boolean(saved && normalizedDraft && (
    MARKET_PURCHASE_POLICY_TEXT_KEYS.some((key) => normalizedDraft[key] !== saved.policy[key])
    || JSON.stringify(normalizedConsent) !== JSON.stringify(savedConsent)
    || JSON.stringify(normalizedCart) !== JSON.stringify(savedCart)
  ))
  const invalid = normalizedDraft ? validateMarketPurchasePolicyTexts(normalizedDraft) : null
  const fitBlocked = fit.legacy === false || fit.consent === false
  const blocked = Boolean(invalid) || consentProblems.length > 0 || cartProblems.length > 0 || fitBlocked
  const fingerprintFields = saved && merged ? checkoutConsentFingerprintFields('market', saved.storedFormat, merged) : new Set<string>()
  const legacyCollapsed = saved?.storedFormat === 2
  const legacyInvalid = Boolean(invalid && LEGACY_ONLY_KEYS.some((key) => invalid.includes(MARKET_PURCHASE_POLICY_TEXT_LABELS[key])))
  useUnsavedChangesGuard(hasChanges)

  const refundDays = saved?.policy.refundDays ?? 0
  const previewConsentDraft = merged && normalizedConsent && consentProblems.length === 0
    ? buildCheckoutConsentDraft('market', merged, refundDays) : null
  const previewConsent = previewConsentDraft ? { ...previewConsentDraft, noticeSha256: PREVIEW_SHA } : null
  const previewLegacy = normalizedDraft && saved ? {
    checkboxLabel: fillMarketRefundDays(normalizedDraft.checkboxLabel, refundDays),
    confirmNotice: fillMarketRefundDays(normalizedDraft.confirmNotice, refundDays),
    noticeSha256: PREVIEW_SHA,
    refundDays,
  } : null

  async function handleSave() {
    if (!draft || !saved || !hasChanges || isSaving) return
    if (blocked) {
      // 접힌 '되돌리기용' 칸에 오류가 있으면 펼치고 초점을 준다.
      if (legacyInvalid) {
        setLegacyOpen(true)
        requestAnimationFrame(() => document.getElementById('market-purchase-policy-checkboxLabel')?.focus())
      }
      return
    }
    setIsSaving(true)
    try {
      const result = await saveMarketPurchasePolicyAction({
        texts: draft,
        consentKeys: consentDraft,
        cartTexts: cartDraft,
        expectedVersion: saved.policy.version,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setSaved(result.data)
      setDraft(pickTexts(result.data.policy))
      setConsentDraft(pickCheckoutConsentKeys('market', result.data.raw))
      setCartDraft(pickMarketCartTexts(result.data.raw))
      toast.success('구매 고지를 저장했습니다.')
      router.refresh()
    } catch {
      toast.error('구매 고지를 저장하지 못했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  const renderTextField = (key: keyof MarketPurchasePolicyTexts) => {
    if (!draft || !saved) return null
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
        {fingerprintFields.has(key) ? <p className="text-xs text-amber-700">{CHECKOUT_CONSENT_FINGERPRINT_HINT}</p> : null}
        {value.includes(MARKET_REFUND_DAYS_PLACEHOLDER) ? (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            보이는 문장: {fillMarketRefundDays(normalizeMarketPurchasePolicyText(value), saved.policy.refundDays)}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>구매 고지</CardTitle>
        <CardDescription>
          장바구니 결제 칸, 상품 상세 &quot;구매 전 확인&quot;, 환불 안내에 쓰입니다.
          {saved ? (
            <> {MARKET_REFUND_DAYS_PLACEHOLDER} 자리에는 자료 환불 기간 <strong>{saved.policy.refundDays}일</strong>이 들어갑니다(기간 값은 여기서 바꾸지 않습니다).</>
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
            <p className="rounded-md bg-muted px-3 py-2 text-sm">
              지금 결제 화면 동의 방식: <strong>{describeCheckoutConsentFormat(saved.storedFormat)}</strong>
              <span className="ml-1 text-xs text-muted-foreground">(방식 바꾸기는 이 화면에서 하지 않습니다)</span>
            </p>

            {MARKET_PURCHASE_POLICY_TEXT_KEYS.filter((key) => !(legacyCollapsed && LEGACY_ONLY_KEYS.includes(key))).map(renderTextField)}
            {legacyCollapsed ? (
              <details open={legacyOpen || legacyInvalid} onToggle={(event) => setLegacyOpen(event.currentTarget.open)} className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">되돌리기용(예전 방식에만 쓰는 칸)</summary>
                <div className="mt-3 space-y-4">{LEGACY_ONLY_KEYS.map(renderTextField)}</div>
              </details>
            ) : null}
            {invalid && hasChanges ? <p role="alert" className="text-sm text-destructive">{invalid}</p> : null}

            {consentDraft ? (
              <CheckoutConsentEditor
                kind="market"
                idPrefix="market-consent"
                value={consentDraft}
                onChange={setConsentDraft}
                problems={consentProblems}
                disabled={isSaving}
                inFingerprint={saved.storedFormat === 2}
              />
            ) : (
              <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">새 방식 문구가 아직 없습니다.</p>
            )}

            {cartDraft ? (
              <fieldset className="grid gap-4 rounded-md border p-4" disabled={isSaving}>
                <legend className="px-1 text-sm font-medium">장바구니 결제 칸 문구</legend>
                {MARKET_CART_TEXT_KEYS.map((key) => {
                  const id = `market-cart-text-${key}`
                  const value = cartDraft[key]
                  const problems = cartProblems.filter((problem) => problem.field === key)
                  return (
                    <div key={key} className="grid gap-1.5">
                      <Label htmlFor={id}>{MARKET_CART_TEXT_LABELS[key]}(한 줄)</Label>
                      <Input id={id} value={value} onChange={(event) => setCartDraft({ ...cartDraft, [key]: event.target.value })} />
                      <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                        <span>{MARKET_CART_TEXT_HINT}</span>
                        <span>{charLength(value)}/{MARKET_CART_TEXT_MAX}</span>
                      </div>
                      {problems.length > 0 ? <p role="alert" className="text-xs text-red-600">{problems.map((problem) => problem.message).join(' ')}</p> : null}
                    </div>
                  )
                })}
              </fieldset>
            ) : null}

            <section className="grid gap-3">
              <h3 className="text-sm font-medium">미리보기(장바구니 결제 칸 아래 묶음, 저장하지 않음)</h3>
              <MarketCheckoutConsentPreview
                legacyNotice={previewLegacy}
                consent={previewConsent}
                termsLink={initial.termsLink}
                refundPolicyLink={initial.refundPolicyLink}
                linksVisible={saved.linksVisible}
                onFitChange={onFitChange}
              />
              {fitBlocked ? <p role="alert" className="text-sm text-destructive">{CHECKOUT_PANEL_OVERFLOW_MESSAGE} 넘친 쪽의 문구를 줄여 주세요.</p> : null}
              <StoredCheckoutConsentFingerprint
                consent={saved.storedConsent}
                consentIgnoringLinks={saved.storedConsentIgnoringLinks}
                cartTextsSha256={saved.storedCartTexts?.cartTextsSha256 ?? null}
              />
            </section>

            <div className="flex justify-end">
              <Button type="button" disabled={!hasChanges || (blocked && !legacyInvalid) || isSaving} onClick={() => void handleSave()}>
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
