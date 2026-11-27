'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AdminNotice } from '@/components/admin/kit/admin-notice'
import { AdminSaveBar, countChangedFields } from '@/components/admin/kit/admin-save-bar'
import { ADMIN_TONE_TEXT_CLASSES } from '@/components/admin/kit/admin-tone-classes'
import {
    normalizePointChargePolicyText,
    POINT_CHARGE_CHECKOUT_ITEM_KEYS,
    POINT_CHARGE_CHECKOUT_ITEM_LABELS,
    POINT_CHARGE_REFUND_DAYS_PLACEHOLDER,
    validatePointChargePolicyTexts,
    type PointChargePolicy,
    type PointChargePolicyTexts,
} from '@/lib/point-charge-policy'
import { buildCheckoutConsentDraft, checkCheckoutConsentKeys } from '@/lib/checkout-consent'
import {
    CHECKOUT_CONSENT_FINGERPRINT_HINT,
    checkoutConsentFingerprintFields,
    checkPointChargeValidityYears,
    describeCheckoutConsentFormat,
    normalizeCheckoutConsentKeysInput,
    pickCheckoutConsentKeys,
    type CheckoutConsentKeysInput,
} from '@/lib/checkout-consent-admin'
import type { PointChargePolicyAdminData } from '@/lib/point-charge-policy-server'
import { CheckoutConsentEditor } from '@/components/admin/checkout-consent-editor'
import {
    PointChargeCheckoutConsentPreview,
    StoredCheckoutConsentFingerprint,
} from '@/components/admin/checkout-consent-admin-preview'
import { savePointChargePolicyTextsAction, type PointChargePolicyAdminView } from './actions'

const PREVIEW_SHA = '0'.repeat(64)

function normalizeTexts(texts: PointChargePolicyTexts): PointChargePolicyTexts {
    const text = normalizePointChargePolicyText
    const checkoutItems = { ...texts.checkoutItems }
    for (const key of POINT_CHARGE_CHECKOUT_ITEM_KEYS) checkoutItems[key] = text(checkoutItems[key])
    return {
        ...texts,
        checkoutTitle: text(texts.checkoutTitle),
        checkoutItems,
        minorNotice: text(texts.minorNotice),
        agreeLabel: text(texts.agreeLabel),
    }
}

function toTexts(policy: PointChargePolicy): PointChargePolicyTexts {
    return {
        checkoutTitle: policy.checkoutTitle,
        checkoutItems: { ...policy.checkoutItems },
        minorNotice: policy.minorNotice,
        agreeLabel: policy.agreeLabel,
        creditsGuide: policy.creditsGuide,
        refundRequestConfirm: [...policy.refundRequestConfirm],
        refundRequestAccepted: policy.refundRequestAccepted,
        refundBlockReasons: { ...policy.refundBlockReasons },
    }
}

function RequiredMark() {
    return <span className={`ml-1 ${ADMIN_TONE_TEXT_CLASSES.danger}`} aria-hidden="true">*</span>
}

// 결제 전 확인·크레딧 화면 문구(system_settings 'point_charge_policy'). 결제 고지 문구라 결제 화면이 동의 기록과 함께 지문을 남긴다.
// 결제 전 확인 칸마다 빠지면 안 되는 내용(계획 docs/plan-bundle9-payment-refund-notice.md 2-1·6절). 저장 검사는 형식만 보므로 관리자가 지우지 않게 칸 아래에 보인다.
const CHECKOUT_ITEM_REQUIRED_CONTENT: Record<(typeof POINT_CHARGE_CHECKOUT_ITEM_KEYS)[number], string> = {
    product: '한 번만 결제(자동결제 없음), 1회 충전 한도, 결제 금액·받는 크레딧, 결제 즉시 지급.',
    validity: '결제한 때부터 1년 동안 사용, 지나면 남은 크레딧은 못 씀, 다른 회원에게 양도 불가.',
    refund: '신청 기간, 하나도 쓰지 않았을 때, 신청 방법, 결제 금액 전액, 3영업일 안 취소 요청, 휴대폰 결제 계좌 환불 단서.',
    restriction: '하나라도 쓰면 단순 변심 취소 불가, 유효기간이 먼저 끝나는 것부터 쓰임.',
    otherCases: '결제 오류·중복 결제·표시와 다른 제공·서비스 종료는 취소·환불정책의 별도 기준.',
}

export function PointChargePolicyForm({ initial }: { initial: PointChargePolicyAdminView }) {
    const [admin, setAdmin] = useState<PointChargePolicyAdminData | null>(initial.data)
    const policy = admin?.policy ?? null
    const [texts, setTexts] = useState<PointChargePolicyTexts | null>(initial.data ? toTexts(initial.data.policy) : null)
    const [consentDraft, setConsentDraft] = useState<CheckoutConsentKeysInput | null>(initial.data ? pickCheckoutConsentKeys('point_charge', initial.data.raw) : null)
    const [legacyOpen, setLegacyOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    // 저장 상태 표시(20번 저장 바): 마지막 저장 시각·실패 글. 저장 동작은 그대로.
    const [savedAt, setSavedAt] = useState<number | null>(null)
    const [saveError, setSaveError] = useState<string | null>(null)

    if (!admin || !policy || !texts) {
        return (
            <section className="mt-12 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 max-md:p-4">
                <h2 className="text-xl font-bold text-[var(--studio-ink)]">결제 전 확인·크레딧 화면 문구</h2>
                <AdminNotice kind="error" className="mt-2">
                    충전 정책 설정을 읽지 못했거나 형식이 올바르지 않습니다. 결제 화면의 결제 버튼이 막혀 있을 수 있습니다.
                    기존 문구를 덮어쓰지 않도록 이 화면에서는 저장을 막았습니다. 새로고침해도 같으면 개발 담당에게 알려 주세요.
                </AdminNotice>
            </section>
        )
    }

    const set = (patch: Partial<PointChargePolicyTexts>) => setTexts((prev) => (prev ? { ...prev, ...patch } : prev))
    const fieldId = (key: string) => `point-charge-policy-${key}`

    // 11번 9절: 새 방식(접는 동의) 키가 있으면 방식과 관계없이 늘 검사하고, 지문에 드는 칸에는 힌트를 보인다.
    const normalized = normalizeTexts(texts)
    const normalizedConsent = consentDraft ? normalizeCheckoutConsentKeysInput('point_charge', consentDraft) : null
    const merged: Record<string, unknown> = { ...admin.raw, ...normalized, ...(normalizedConsent ?? {}) }
    const consentProblems = normalizedConsent ? checkCheckoutConsentKeys('point_charge', merged) : []
    const legacyInvalid = validatePointChargePolicyTexts(normalized)
    const validityInvalid = checkPointChargeValidityYears(normalized.checkoutItems.validity)
    const fingerprintFields = checkoutConsentFingerprintFields('point_charge', admin.storedFormat, merged)
    const fingerprintHint = (field: string) => (fingerprintFields.has(field)
        ? <p className={`text-xs ${ADMIN_TONE_TEXT_CLASSES.warning}`}>{CHECKOUT_CONSENT_FINGERPRINT_HINT}</p> : null)
    const legacyCollapsed = admin.storedFormat === 2
    const legacyFieldsInvalid = Boolean(legacyInvalid && /결제 전 확인 제목|결제 동의 문구/.test(legacyInvalid))
    const previewDraft = normalizedConsent && consentProblems.length === 0
        ? buildCheckoutConsentDraft('point_charge', merged, policy.refundDays) : null
    const blocked = Boolean(legacyInvalid || validityInvalid) || consentProblems.length > 0
    // 저장 안 된 변경 수: 마지막으로 저장된 문구(admin)와 다른 칸 수(문구 칸 + 새 방식 동의 칸).
    const dirtyCount = countChangedFields(texts, toTexts(policy))
        + (consentDraft ? countChangedFields(consentDraft, pickCheckoutConsentKeys('point_charge', admin.raw) ?? {}) : 0)

    const handleSave = async () => {
        if (blocked) {
            if (legacyCollapsed && legacyFieldsInvalid) {
                setLegacyOpen(true)
                requestAnimationFrame(() => document.getElementById(fieldId('checkoutTitle'))?.focus())
            }
            toast.error(legacyInvalid ?? validityInvalid ?? '새 방식 동의 문구를 확인해 주세요.')
            return
        }
        setSaving(true)
        setSaveError(null)
        try {
            const result = await savePointChargePolicyTextsAction({ texts, expectedVersion: policy.version, consentKeys: consentDraft })
            if (!result.success) {
                toast.error(result.error)
                setSaveError(result.error)
                return
            }
            setAdmin(result.data)
            setTexts(toTexts(result.data.policy))
            setConsentDraft(pickCheckoutConsentKeys('point_charge', result.data.raw))
            setSavedAt(Date.now())
            toast.success('결제 전 확인·크레딧 화면 문구를 저장했습니다. 이후 결제부터 새 문구로 동의를 받습니다.')
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '충전 정책 문구를 저장하지 못했습니다.')
            setSaveError(error instanceof Error ? error.message : '충전 정책 문구를 저장하지 못했습니다.')
        } finally {
            setSaving(false)
        }
    }

    return (
        <section className="mt-12 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-6 max-md:p-4">
            <div className="mb-6">
                <h2 className="text-xl font-bold text-[var(--studio-ink)]">결제 전 확인·크레딧 화면 문구</h2>
                <p className="mt-1 text-sm text-[var(--studio-muted)]">
                    결제(충전) 화면의 동의 체크 바로 위에 보이는 결제 고지 문구와, 크레딧 화면의 환불 안내 문구입니다.
                    결제 고지 문구를 바꾸면 그 뒤 결제부터 새 문구로 동의를 받고 기록합니다.
                </p>
                <p className="mt-3 rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] px-3 py-2 text-sm text-[var(--studio-ink)]">
                    지금 결제 화면 동의 방식: <strong>{describeCheckoutConsentFormat(admin.storedFormat)}</strong>
                    <span className="ml-1 text-xs text-[var(--studio-muted)]">(방식 바꾸기는 이 화면에서 하지 않습니다)</span>
                </p>
                <p className="mt-2 text-xs text-[var(--studio-muted)]">
                    충전 환불 기간: {policy.refundDays}일(이 화면에서 바꾸지 않습니다 — 약관 문장과 함께 바꿉니다) ·
                    쓸 수 있는 자리표시: <code className="rounded bg-[var(--studio-background-sunken)] px-1">{POINT_CHARGE_REFUND_DAYS_PLACEHOLDER}</code> 충전 환불 기간(일) ·
                    <RequiredMark /> 필수
                </p>
            </div>

            <div className="grid gap-5">
                <fieldset className="grid gap-4">
                    <legend className="mb-1 text-sm font-medium text-[var(--studio-ink)]">결제 전 확인(결제 화면)</legend>
                    {!legacyCollapsed ? (
                        <div className="grid gap-1.5">
                            <Label htmlFor={fieldId('checkoutTitle')}>제목<RequiredMark /></Label>
                            <Input id={fieldId('checkoutTitle')} value={texts.checkoutTitle} onChange={(event) => set({ checkoutTitle: event.target.value })} />
                            {fingerprintHint('checkoutTitle')}
                        </div>
                    ) : null}
                    {POINT_CHARGE_CHECKOUT_ITEM_KEYS.map((key) => (
                        <div key={key} className="grid gap-1.5">
                            <Label htmlFor={fieldId(key)}>{POINT_CHARGE_CHECKOUT_ITEM_LABELS[key]}<RequiredMark /></Label>
                            <Textarea
                                id={fieldId(key)}
                                value={texts.checkoutItems[key]}
                                onChange={(event) => set({ checkoutItems: { ...texts.checkoutItems, [key]: event.target.value } })}
                                className="min-h-20"
                            />
                            <p className="text-xs text-[var(--studio-muted)]">꼭 들어갈 내용: {CHECKOUT_ITEM_REQUIRED_CONTENT[key]}</p>
                            {fingerprintHint(`checkoutItems.${key}`)}
                            {key === 'validity' && validityInvalid ? <p role="alert" className={`text-xs ${ADMIN_TONE_TEXT_CLASSES.danger}`}>{validityInvalid}</p> : null}
                            {key === 'refund' && (
                                <p className="text-xs text-[var(--studio-muted)]">기간은 숫자로 적지 말고 {POINT_CHARGE_REFUND_DAYS_PLACEHOLDER}을(를) 넣어 주세요.</p>
                            )}
                        </div>
                    ))}
                    <div className="grid gap-1.5">
                        <Label htmlFor={fieldId('minorNotice')}>미성년자 안내<RequiredMark /></Label>
                        <Textarea id={fieldId('minorNotice')} value={texts.minorNotice} onChange={(event) => set({ minorNotice: event.target.value })} className="min-h-20" />
                        <p className="text-xs text-[var(--studio-muted)]">꼭 들어갈 내용: 법정대리인 동의 없는 결제는 본인·법정대리인이 취소할 수 있음, 예외(허락한 돈·속인 경우 등), 연락 방법, 남은 크레딧 회수, 취소·환불정책 7절.</p>
                        {fingerprintHint('minorNotice')}
                    </div>
                    {!legacyCollapsed ? (
                        <div className="grid gap-1.5">
                            <Label htmlFor={fieldId('agreeLabel')}>결제 동의 체크 문구<RequiredMark /></Label>
                            <Input id={fieldId('agreeLabel')} value={texts.agreeLabel} onChange={(event) => set({ agreeLabel: event.target.value })} />
                            <p className="text-xs text-[var(--studio-muted)]">꼭 들어갈 내용: &lsquo;취소·환불정책&rsquo;(결제 화면에서 정책 전문 링크로 바뀝니다)과 결제 동의. &lsquo;(필수)&rsquo; 표시는 화면이 붙입니다.</p>
                            {fingerprintHint('agreeLabel')}
                        </div>
                    ) : (
                        // 새 방식일 때 예전 방식에만 쓰는 칸은 '되돌리기용'으로 접는다(검사는 그대로, 오류면 펼치고 초점).
                        <details open={legacyOpen || legacyFieldsInvalid} onToggle={(event) => setLegacyOpen(event.currentTarget.open)} className="rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] p-3">
                            <summary className="cursor-pointer text-sm font-medium text-[var(--studio-ink)]">되돌리기용(예전 방식에만 쓰는 칸)</summary>
                            <div className="mt-3 grid gap-4">
                                <div className="grid gap-1.5">
                                    <Label htmlFor={fieldId('checkoutTitle')}>제목<RequiredMark /></Label>
                                    <Input id={fieldId('checkoutTitle')} value={texts.checkoutTitle} onChange={(event) => set({ checkoutTitle: event.target.value })} />
                                </div>
                                <div className="grid gap-1.5">
                                    <Label htmlFor={fieldId('agreeLabel')}>결제 동의 체크 문구<RequiredMark /></Label>
                                    <Input id={fieldId('agreeLabel')} value={texts.agreeLabel} onChange={(event) => set({ agreeLabel: event.target.value })} />
                                </div>
                            </div>
                        </details>
                    )}
                    {legacyInvalid ? <p role="alert" className={`text-sm ${ADMIN_TONE_TEXT_CLASSES.danger}`}>{legacyInvalid}</p> : null}
                </fieldset>

                {consentDraft ? (
                    <CheckoutConsentEditor
                        kind="point_charge"
                        idPrefix="point-charge-consent"
                        value={consentDraft}
                        onChange={setConsentDraft}
                        problems={consentProblems}
                        disabled={saving}
                        inFingerprint={admin.storedFormat === 2}
                    />
                ) : (
                    <p className="rounded-[var(--studio-radius-control)] border border-dashed border-[var(--studio-border)] px-3 py-2 text-sm text-[var(--studio-muted)]">새 방식 문구가 아직 없습니다.</p>
                )}

                <section className="grid gap-3">
                    <h3 className="text-sm font-medium text-[var(--studio-ink)]">미리보기(충전 결제 화면 동의, 저장하지 않음)</h3>
                    {previewDraft ? (
                        <PointChargeCheckoutConsentPreview
                            consent={{ ...previewDraft, noticeSha256: PREVIEW_SHA }}
                            termsLink={initial.termsLink}
                            refundPolicyLink={initial.refundPolicyLink}
                            linksVisible={admin.linksVisible}
                        />
                    ) : (
                        <p className="text-xs text-[var(--studio-muted)]">새 방식 문구가 없거나 검사에 걸려 미리보기를 그리지 않습니다.</p>
                    )}
                    <StoredCheckoutConsentFingerprint
                        consent={admin.storedConsent}
                        consentIgnoringLinks={admin.storedConsentIgnoringLinks}
                    />
                </section>

                <fieldset className="grid gap-4">
                    <legend className="mb-1 text-sm font-medium text-[var(--studio-ink)]">크레딧 화면(환불 안내)</legend>
                    <div className="grid gap-1.5">
                        <Label htmlFor={fieldId('creditsGuide')}>구매건 목록 안내</Label>
                        <Textarea id={fieldId('creditsGuide')} value={texts.creditsGuide} onChange={(event) => set({ creditsGuide: event.target.value })} className="min-h-16" />
                    </div>
                    <div className="grid gap-2">
                        <span className="text-sm font-medium text-[var(--studio-ink)]">환불 신청 확인창(한 줄씩)</span>
                        {texts.refundRequestConfirm.map((line, index) => (
                            <div key={index} className="flex items-start gap-2">
                                <Textarea
                                    aria-label={`환불 신청 확인 ${index + 1}번째 줄`}
                                    value={line}
                                    onChange={(event) => set({ refundRequestConfirm: texts.refundRequestConfirm.map((item, i) => (i === index ? event.target.value : item)) })}
                                    className="min-h-14"
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`환불 신청 확인 ${index + 1}번째 줄 삭제`}
                                    onClick={() => set({ refundRequestConfirm: texts.refundRequestConfirm.filter((_, i) => i !== index) })}
                                >
                                    <Trash2 className="size-4" />
                                </Button>
                            </div>
                        ))}
                        <Button
                            type="button"
                            variant="brandOutline"
                            size="sm"
                            className="w-fit"
                            onClick={() => set({ refundRequestConfirm: [...texts.refundRequestConfirm, ''] })}
                        >
                            <Plus className="mr-1 size-4" /> 줄 추가
                        </Button>
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor={fieldId('refundRequestAccepted')}>환불 신청 접수 안내</Label>
                        <Textarea id={fieldId('refundRequestAccepted')} value={texts.refundRequestAccepted} onChange={(event) => set({ refundRequestAccepted: event.target.value })} className="min-h-16" />
                    </div>
                    {Object.keys(texts.refundBlockReasons).length > 0 && (
                        <div className="grid gap-3">
                            <span className="text-sm font-medium text-[var(--studio-ink)]">환불 불가 사유(사유 코드별)</span>
                            {Object.entries(texts.refundBlockReasons).map(([code, value]) => (
                                <div key={code} className="grid gap-1.5">
                                    <Label htmlFor={fieldId(code)} className="font-mono text-xs text-[var(--studio-text)]">{code}</Label>
                                    <Input
                                        id={fieldId(code)}
                                        value={value}
                                        onChange={(event) => set({ refundBlockReasons: { ...texts.refundBlockReasons, [code]: event.target.value } })}
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                </fieldset>
            </div>

            <AdminSaveBar
                variant="inline"
                className="mt-6"
                dirtyCount={dirtyCount}
                status={saving ? 'saving' : saveError ? 'error' : savedAt ? 'saved' : 'idle'}
                savedAt={savedAt}
                errorMessage={saveError}
                applyNote="저장한 뒤 결제부터 새 문구로 동의를 받습니다."
                onSave={() => void handleSave()}
                saveLabel="결제 고지 문구 저장"
                saveDisabled={saving || (blocked && !legacyFieldsInvalid)}
                // 변경이 없어도 예전 칸 검사에 걸리면 전처럼 눌러서 그 칸을 펼치고 초점을 옮긴다.
                saveWhenClean={blocked && legacyFieldsInvalid}
            />
        </section>
    )
}
