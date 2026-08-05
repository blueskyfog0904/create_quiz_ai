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
import { MAX_POINT_CHARGE_AMOUNT } from '@/lib/payment-constants'
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
            })
        } else {
            setFormData({
                name: '',
                price: 0,
                credits: 0,
                description: '',
                is_active: true,
                sort_order: 0,
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
                formData.price < 1 ||
                formData.price > MAX_POINT_CHARGE_AMOUNT
            ) {
                throw new Error('가격은 1원 이상 100,000원 이하여야 합니다.')
            }
            if (formData.credits === undefined || formData.credits < 1) throw new Error('크레딧은 1 이상이어야 합니다.')

            const payload: PricingPlanInsert = {
                name: formData.name,
                price: formData.price,
                credits: formData.credits,
                description: formData.description,
                is_active: formData.is_active ?? true,
                sort_order: formData.sort_order ?? 0,
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
            <DialogContent className="sm:max-w-[425px]">
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
                                min="1"
                                max={MAX_POINT_CHARGE_AMOUNT}
                                required
                            />
                            <p className="text-xs text-muted-foreground">
                                1회 충전 한도: 100,000원
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
                            placeholder="요금제에 대한 간단한 설명을 입력하세요."
                        />
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
