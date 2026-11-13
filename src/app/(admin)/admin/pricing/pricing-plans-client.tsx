'use client'

import { useState, useEffect } from 'react'
import { PricingPlan, getPricingPlans, togglePlanStatus } from './actions'
import { Button } from '@/components/ui/button'
import { Plus, Pencil, Loader2 } from 'lucide-react'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { PricingPlanDialog } from './components/pricing-plan-dialog'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

export function PricingPlansClient() {
    const [plans, setPlans] = useState<PricingPlan[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Dialog State
    const [dialogOpen, setDialogOpen] = useState(false)
    const [selectedPlan, setSelectedPlan] = useState<PricingPlan | null>(null)

    const fetchPlans = async () => {
        try {
            setLoading(true)
            const data = await getPricingPlans()
            setPlans(data)
            setError(null)
        } catch (err: any) {
            console.error(err)
            setError(err.message || '데이터를 불러오는데 실패했습니다.')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchPlans()
    }, [])

    const handleCreate = () => {
        setSelectedPlan(null)
        setDialogOpen(true)
    }

    const handleEdit = (plan: PricingPlan) => {
        setSelectedPlan(plan)
        setDialogOpen(true)
    }

    // 판매 상태는 바꾸는 즉시 고객의 충전 화면에 반영된다. 스위치를 눌러도 바로 바꾸지 않고 확인 창을 거친다.
    const [toggleTarget, setToggleTarget] = useState<PricingPlan | null>(null)
    const [toggling, setToggling] = useState(false)

    const handleConfirmToggle = async () => {
        if (!toggleTarget) return
        const nextActive = !toggleTarget.is_active
        setToggling(true)
        try {
            await togglePlanStatus(toggleTarget.id, nextActive)
            toast.success(`'${toggleTarget.name}' 요금제를 ${nextActive ? '판매중' : '비활성'}으로 바꿨습니다.`)
            setToggleTarget(null)
        } catch (err) {
            console.error(err)
            toast.error('판매 상태를 바꾸지 못했습니다. 목록의 현재 상태를 확인해 주세요.')
        } finally {
            setToggling(false)
            // 성공·실패와 무관하게 DB의 실제 상태를 다시 읽어 보여 준다.
            fetchPlans()
        }
    }

    const handleSuccess = () => {
        fetchPlans()
    }

    if (loading && plans.length === 0) {
        return (
            <div className="flex justify-center items-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
            </div>
        )
    }

    if (error) {
        return (
            <div className="text-center py-12 text-red-500">
                <p>{error}</p>
                <Button onClick={fetchPlans} variant="outline" className="mt-4">다시 시도</Button>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-800">요금제 목록</h2>
                <Button onClick={handleCreate}>
                    <Plus className="h-4 w-4 mr-2" />
                    새 요금제 추가
                </Button>
            </div>

            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[80px]">순서</TableHead>
                            <TableHead>상품명</TableHead>
                            <TableHead>크레딧</TableHead>
                            <TableHead>가격</TableHead>
                            <TableHead>상태</TableHead>
                            <TableHead className="text-right">관리</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {plans.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center text-gray-500 py-8">
                                    등록된 요금제가 없습니다.
                                </TableCell>
                            </TableRow>
                        ) : (
                            plans.map((plan) => (
                                <TableRow key={plan.id}>
                                    <TableCell>{plan.sort_order}</TableCell>
                                    <TableCell className="font-medium">
                                        {plan.name}
                                        {plan.description && (
                                            <p className="text-xs text-gray-500 truncate max-w-[200px]">{plan.description}</p>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="secondary" className="font-mono">
                                            {plan.credits.toLocaleString()} C
                                        </Badge>
                                    </TableCell>
                                    <TableCell>₩{plan.price.toLocaleString()}</TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <Switch
                                                checked={plan.is_active}
                                                aria-label={`${plan.name} 판매 상태`}
                                                onCheckedChange={() => setToggleTarget(plan)}
                                            />
                                            <span className={`text-xs ${plan.is_active ? 'text-green-600' : 'text-gray-400'}`}>
                                                {plan.is_active ? '판매중' : '비활성'}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="sm" onClick={() => handleEdit(plan)}>
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            <Dialog open={toggleTarget !== null} onOpenChange={(open) => !open && !toggling && setToggleTarget(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {toggleTarget?.is_active ? '요금제 판매 중지' : '요금제 판매 시작'}
                        </DialogTitle>
                        <DialogDescription>
                            {toggleTarget && (
                                <>
                                    <strong>{toggleTarget.name}</strong> (₩{toggleTarget.price.toLocaleString()} · {toggleTarget.credits.toLocaleString()} C)
                                </>
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <p className="text-sm text-gray-700">
                        {toggleTarget?.is_active
                            ? '중지하면 고객의 충전 화면에서 이 요금제가 바로 사라지고 새로 결제할 수 없습니다. 이미 결제한 건에는 영향이 없습니다.'
                            : '시작하면 고객의 충전 화면에 이 요금제가 바로 나타나고 누구나 결제할 수 있습니다.'}
                    </p>
                    <DialogFooter className="justify-center gap-2">
                        <Button variant="outline" onClick={() => setToggleTarget(null)} disabled={toggling}>
                            취소
                        </Button>
                        <Button onClick={handleConfirmToggle} disabled={toggling}>
                            {toggling ? '처리 중...' : toggleTarget?.is_active ? '판매 중지' : '판매 시작'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <PricingPlanDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                planToEdit={selectedPlan}
                onSuccess={handleSuccess}
            />
        </div>
    )
}
