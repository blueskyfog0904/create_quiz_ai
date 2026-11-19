'use client'

import { useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    PRICING_PAGE_PLACEHOLDERS,
    type PricingPageContent,
    type PricingPageNoticeItem,
} from '@/lib/pricing-page-content'
import { savePricingPageContentAction } from './actions'

// 문구가 아직 없을 때(설정 행 없음) 쓰는 빈 틀. 화면 문구는 넣지 않는다.
const EMPTY_CONTENT: PricingPageContent = {
    banner_eyebrow: '',
    banner_title: '',
    banner_title_no_bonus: '',
    guest_balance_text: '',
    summary_note: '',
    notice_title: '',
    notice_items: [],
    refund_title: '',
    refund_items: [],
}

const TEXT_FIELDS: Array<{ key: keyof Omit<PricingPageContent, 'notice_items' | 'refund_items'>; label: string; multiline?: boolean; hint?: string }> = [
    { key: 'banner_eyebrow', label: '배너 윗줄(작은 글씨)', hint: '비우면 표시하지 않습니다.' },
    { key: 'banner_title', label: '배너 제목 — 보너스 있는 상품이 있을 때', hint: '{최대보너스} 자리에 보너스 최대 %가 들어갑니다.' },
    { key: 'banner_title_no_bonus', label: '배너 제목 — 보너스 있는 상품이 없을 때' },
    { key: 'guest_balance_text', label: '보유 크레딧 칸 — 로그인하지 않았을 때 안내' },
    { key: 'summary_note', label: '결제 요약 아래 안내', multiline: true, hint: '비우면 표시하지 않습니다.' },
    { key: 'notice_title', label: '확인 사항 제목' },
    { key: 'refund_title', label: '환불 정책 제목' },
]

type InitialState = { status: 'ok'; content: PricingPageContent } | { status: 'missing' } | { status: 'invalid' } | { status: 'error' }

export function PricingPageContentForm({ initial }: { initial: InitialState }) {
    const [content, setContent] = useState<PricingPageContent>(initial.status === 'ok' ? initial.content : EMPTY_CONTENT)
    // 읽기에 실패했으면 빈 양식으로 저장해 기존 문구를 덮어쓰지 않도록 저장을 막는다.
    const readFailed = initial.status === 'error'
    const [saving, setSaving] = useState(false)

    const setText = (key: keyof PricingPageContent, value: string) => setContent((prev) => ({ ...prev, [key]: value }))
    const setNotice = (index: number, patch: Partial<PricingPageNoticeItem>) =>
        setContent((prev) => ({
            ...prev,
            notice_items: prev.notice_items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
        }))
    const setRefund = (index: number, value: string) =>
        setContent((prev) => ({ ...prev, refund_items: prev.refund_items.map((item, i) => (i === index ? value : item)) }))

    const handleSave = async () => {
        setSaving(true)
        try {
            const result = await savePricingPageContentAction(content)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            setContent(result.data)
            toast.success('충전 화면 문구를 저장했습니다. 충전 화면에 바로 반영됩니다.')
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '충전 화면 문구를 저장하지 못했습니다.')
        } finally {
            setSaving(false)
        }
    }

    return (
        <section className="mt-12 rounded-lg border bg-white p-6 max-md:p-4">
            <div className="mb-6">
                <h2 className="text-xl font-bold text-gray-900">충전 화면 문구</h2>
                <p className="mt-1 text-sm text-gray-500">
                    회원 크레딧 충전 화면(/pricing)에 보이는 안내 문구입니다. 상품 이름·설명·배지·강조는 위 요금제에서 고칩니다.
                </p>
                <p className="mt-2 text-xs text-gray-500">
                    쓸 수 있는 자리표시:{' '}
                    {Object.entries(PRICING_PAGE_PLACEHOLDERS).map(([placeholder, label], index) => (
                        <span key={placeholder}>
                            {index > 0 && ', '}
                            <code className="rounded bg-gray-100 px-1">{placeholder}</code> {label}
                        </span>
                    ))}
                </p>
                {initial.status === 'invalid' && (
                    <p className="mt-2 text-sm text-red-600">저장된 문구의 형식이 올바르지 않아 회원 충전 화면에서 결제 버튼이 막혀 있습니다. 문구를 다시 입력하고 저장하면 고쳐집니다.</p>
                )}
                {initial.status === 'missing' && (
                    <p className="mt-2 text-sm text-amber-700">저장된 문구가 없어 회원 충전 화면에서 결제 버튼이 막혀 있습니다. 입력하고 저장해 주세요.</p>
                )}
                {readFailed && (
                    <p className="mt-2 text-sm text-red-600">저장된 문구를 읽지 못했습니다. 기존 문구를 덮어쓰지 않도록 저장을 막았습니다. 새로고침해 주세요.</p>
                )}
            </div>

            <div className="grid gap-5">
                {TEXT_FIELDS.map((field) => (
                    <div key={field.key} className="grid gap-1.5">
                        <Label htmlFor={`pricing-content-${field.key}`}>{field.label}</Label>
                        {field.multiline ? (
                            <Textarea
                                id={`pricing-content-${field.key}`}
                                value={content[field.key]}
                                onChange={(event) => setText(field.key, event.target.value)}
                                className="min-h-20"
                            />
                        ) : (
                            <Input
                                id={`pricing-content-${field.key}`}
                                value={content[field.key]}
                                onChange={(event) => setText(field.key, event.target.value)}
                            />
                        )}
                        {field.hint && <p className="text-xs text-gray-500">{field.hint}</p>}
                    </div>
                ))}

                <fieldset className="grid gap-3">
                    <legend className="mb-1 text-sm font-medium">확인 사항(제목 + 내용)</legend>
                    {content.notice_items.map((item, index) => (
                        <div key={index} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[12rem_1fr_auto] sm:items-start">
                            <Input
                                aria-label={`확인 사항 ${index + 1}번 제목`}
                                value={item.title}
                                onChange={(event) => setNotice(index, { title: event.target.value })}
                                placeholder="제목"
                            />
                            <Textarea
                                aria-label={`확인 사항 ${index + 1}번 내용`}
                                value={item.body}
                                onChange={(event) => setNotice(index, { body: event.target.value })}
                                placeholder="내용"
                                className="min-h-16"
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`확인 사항 ${index + 1}번 삭제`}
                                onClick={() => setContent((prev) => ({ ...prev, notice_items: prev.notice_items.filter((_, i) => i !== index) }))}
                            >
                                <Trash2 className="size-4" />
                            </Button>
                        </div>
                    ))}
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-fit"
                        onClick={() => setContent((prev) => ({ ...prev, notice_items: [...prev.notice_items, { title: '', body: '' }] }))}
                    >
                        <Plus className="mr-1 size-4" /> 확인 사항 추가
                    </Button>
                </fieldset>

                <fieldset className="grid gap-3">
                    <legend className="mb-1 text-sm font-medium">환불 정책(한 줄씩, 충전 화면에 항상 펼쳐 보입니다)</legend>
                    {content.refund_items.map((item, index) => (
                        <div key={index} className="flex items-start gap-2">
                            <Textarea
                                aria-label={`환불 정책 ${index + 1}번`}
                                value={item}
                                onChange={(event) => setRefund(index, event.target.value)}
                                className="min-h-14"
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`환불 정책 ${index + 1}번 삭제`}
                                onClick={() => setContent((prev) => ({ ...prev, refund_items: prev.refund_items.filter((_, i) => i !== index) }))}
                            >
                                <Trash2 className="size-4" />
                            </Button>
                        </div>
                    ))}
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-fit"
                        onClick={() => setContent((prev) => ({ ...prev, refund_items: [...prev.refund_items, ''] }))}
                    >
                        <Plus className="mr-1 size-4" /> 환불 정책 줄 추가
                    </Button>
                </fieldset>
            </div>

            <div className="mt-6 flex justify-end">
                <Button type="button" onClick={() => void handleSave()} disabled={saving || readFailed} className="min-h-11">
                    {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                    문구 저장
                </Button>
            </div>
        </section>
    )
}
