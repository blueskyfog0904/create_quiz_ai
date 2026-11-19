'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { upsertPricingPlan, PricingPlan, PricingPlanInsert } from '../actions'
import { Loader2 } from 'lucide-react'
import { MAX_POINT_CHARGE_AMOUNT, MIN_POINT_CHARGE_AMOUNT } from '@/lib/payment-constants'
import { PRICING_PLAN_DESCRIPTION_MAX_LENGTH, PRICING_PLAN_DISPLAY_TEXT_MAX_LENGTH } from '@/lib/pricing-plan-display'
// If sonner not installed, I might need to check. But standard shadcn often uses sonner or useToast.
// Let's implement a simple error message in the UI.

export interface PricingPlanDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    planToEdit?: PricingPlan | null
    onSuccess: () => void
}

export function PricingPlanDialog({
    open,
    onOpenChange,
    planToEdit,
    onSuccess,
}: PricingPlanDialogProps) {
    const [formData, setFormData] = useState<Partial<PricingPlanInsert>>({
        name: '',
        price: 0,
        credits: 0,
        description: '',
        is_active: true,
        sort_order: 0,
        badge_text: '',
        is_highlighted: false,
        discount_text: '',
    })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (planToEdit) {
            setFormData({
                name: planToEdit.name,
                price: planToEdit.price,
                credits: planToEdit.credits,
                description: planToEdit.description || '',
                is_active: planToEdit.is_active,
                sort_order: planToEdit.sort_order,
                badge_text: planToEdit.badge_text || '',
                is_highlighted: planToEdit.is_highlighted ?? false,
                discount_text: planToEdit.discount_text || '',
            })
        } else {
            setFormData({
                name: '',
                price: 0,
                credits: 0,
                description: '',
                is_active: true,
                sort_order: 0,
                badge_text: '',
                is_highlighted: false,
                discount_text: '',
            })
        }
        setError(null)
    }, [planToEdit, open])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError(null)

        try {
            if (!formData.name) throw new Error('상품명은 필수입니다.')
            if (
                formData.price === undefined ||
                formData.price < MIN_POINT_CHARGE_AMOUNT ||
                formData.price > MAX_POINT_CHARGE_AMOUNT
            ) {
                throw new Error('가격은 1,000원 이상 100,000원 이하여야 합니다.')
            }
            if (formData.credits === undefined || formData.credits < 1) throw new Error('크레딧은 1 이상이어야 합니다.')

            const payload: PricingPlanInsert = {
                name: formData.name,
                price: formData.price,
                credits: formData.credits,
                description: formData.description,
                is_active: formData.is_active ?? true,
                sort_order: formData.sort_order ?? 0,
                badge_text: formData.badge_text,
                is_highlighted: formData.is_highlighted ?? false,
                discount_text: formData.discount_text,
            }

            if (planToEdit) {
                payload.id = planToEdit.id
            }

            await upsertPricingPlan(payload)
            onSuccess()
            onOpenChange(false)
        } catch (err: unknown) {
            console.error(err)
            setError(err instanceof Error ? err.message : '저장 중 오류가 발생했습니다.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px] max-h-[calc(100dvh-2rem)] max-md:max-w-[calc(100vw-2rem)] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{planToEdit ? '요금제 수정' : '새 요금제 추가'}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="name">상품명</Label>
                        <Input
                            id="name"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder="예: Basic Plan"
                            required
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="price">가격 (원)</Label>
                            <Input
                                id="price"
                                type="number"
                                value={formData.price}
                                onChange={(e) => setFormData({ ...formData, price: parseInt(e.target.value) || 0 })}
                                min={MIN_POINT_CHARGE_AMOUNT}
                                max={MAX_POINT_CHARGE_AMOUNT}
                                required
                            />
                            <p className="text-xs text-muted-foreground">
                                1회 충전 한도: 1,000원 ~ 100,000원 (결제 최소 금액 1,000원)
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="credits">제공 크레딧</Label>
                            <Input
                                id="credits"
                                type="number"
                                value={formData.credits}
                                onChange={(e) => setFormData({ ...formData, credits: parseInt(e.target.value) || 0 })}
                                min="1"
                                required
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="description">설명</Label>
                        <Textarea
                            id="description"
                            value={formData.description || ''}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            placeholder="예: 수업 자료 10개 정도"
                            maxLength={PRICING_PLAN_DESCRIPTION_MAX_LENGTH}
                        />
                        <p className="text-xs text-muted-foreground">
                            회원 충전 화면에서 금액 위 작은 글씨로 &lsquo;상품명 · 설명&rsquo;처럼 보입니다. 비우면 상품명만 보입니다.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="sort_order">정렬 순서</Label>
                            <Input
                                id="sort_order"
                                type="number"
                                value={formData.sort_order}
                                onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
                            />
                        </div>
                        <div className="flex items-center justify-between space-y-0 pt-8">
                            <Label htmlFor="is_active" className="cursor-pointer">판매 활성화</Label>
                            <Switch
                                id="is_active"
                                checked={formData.is_active}
                                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="badge_text">배지 문구 (선택)</Label>
                        <Input
                            id="badge_text"
                            value={formData.badge_text || ''}
                            onChange={(e) => setFormData({ ...formData, badge_text: e.target.value })}
                            placeholder="예: 가장 인기"
                            maxLength={PRICING_PLAN_DISPLAY_TEXT_MAX_LENGTH}
                        />
                        <p className="text-xs text-muted-foreground">
                            회원 충전 화면에서 금액·보너스 옆에 배지로 보입니다(강조 상품은 불꽃, 그 외는 보석 이모지). 비우면 배지가 없습니다. (20자 이내)
                        </p>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label htmlFor="is_highlighted" className="cursor-pointer">강조 카드</Label>
                            <Switch
                                id="is_highlighted"
                                checked={formData.is_highlighted ?? false}
                                onCheckedChange={(checked) => setFormData({ ...formData, is_highlighted: checked })}
                            />
                        </div>
                        <p className="text-xs text-muted-foreground">
                            켜면 회원 충전 화면을 열었을 때 이 상품이 먼저 선택되어 있고, 배지가 연한 주황색과 불꽃 이모지로 보입니다. 하나만 켜는 것을 권합니다.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="discount_text">할인·혜택 문구 (선택)</Label>
                        <Input
                            id="discount_text"
                            value={formData.discount_text || ''}
                            onChange={(e) => setFormData({ ...formData, discount_text: e.target.value })}
                            placeholder="예: 10% 추가 적립"
                            maxLength={PRICING_PLAN_DISPLAY_TEXT_MAX_LENGTH}
                        />
                        <p className="text-xs text-muted-foreground">
                            회원 충전 화면에서 배지 옆에 주황 글씨로 보입니다. 보너스 크레딧과 %는 가격·제공 크레딧으로 자동 표시되므로 여기에 다시 적지 않는 것을 권합니다. 비우면 없습니다. (20자 이내)
                        </p>
                    </div>

                    {error && (
                        <div className="text-sm text-red-500 bg-red-50 p-2 rounded">
                            {error}
                        </div>
                    )}

                    <div className="flex justify-center gap-2 pt-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            취소
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {planToEdit ? '수정하기' : '생성하기'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}
